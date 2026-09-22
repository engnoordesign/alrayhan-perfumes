require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readTable, writeTable } = require('./db');
const { initMailer, verifyMailer, sendOrderEmail } = require('./mailer');
const { checkAgentAvailable, streamAgent, productsMentioned } = require('./agent');

const app = express();
const PORT = process.env.PORT || 3000;
// No password is hardcoded. Set ADMIN_PASSWORD in server/.env.
// If it is missing, a random one-time password is generated at each start
// and printed in the console, so the admin panel is never left on a known default.
const ADMIN_PASSWORD_FROM_ENV = Boolean(process.env.ADMIN_PASSWORD);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
const DELIVERY_FEE = parseInt(process.env.DELIVERY_FEE, 10) || 5000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------------------------------------------------------
   helpers
--------------------------------------------------------- */
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}
function fmtIQD(n) {
  return `${Number(n || 0).toLocaleString('en-US')} د.ع`;
}
/* normalises a scent-pyramid layer: { notes, pct } */
function cleanPyramid(input) {
  if (!input || typeof input !== 'object') return null;
  const layer = (l) => {
    const src = input[l] || {};
    const notes = String(src.notes || '').trim();
    let pct = parseInt(String(src.pct || '').replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(pct)) pct = 0;
    pct = Math.max(0, Math.min(100, pct));
    return { notes, pct: pct + '%' };
  };
  const out = { top: layer('top'), heart: layer('heart'), base: layer('base') };
  // if nothing was actually filled in, treat it as "no pyramid"
  if (!out.top.notes && !out.heart.notes && !out.base.notes) return null;
  return out;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\u0600-\u06FF]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'brand';
}

/* ---------------------------------------------------------
   admin auth (single shared password -> short-lived tokens)
--------------------------------------------------------- */
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }
  const token = genId('admtok');
  adminTokens.add(token);
  res.json({ token });
});

/* ---------------------------------------------------------
   user auth (phone OTP demo + social demo) + wallet
   NOTE: this is a local/dev auth system. Phone codes are
   returned directly in the API response because there is no
   SMS provider configured. Wire up a real provider (e.g.
   Twilio) before ever deploying this publicly.
--------------------------------------------------------- */
const otpStore = new Map(); // phone -> { code, expiresAt }

function findUserByKey(users, key) {
  return users.find(u => u.key === key);
}
function findUserByToken(users, token) {
  return users.find(u => u.token === token);
}
function publicUser(u) {
  if (!u) return null;
  const { token, ...rest } = u;
  return rest;
}

function requireUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const users = readTable('users');
  const user = token ? findUserByToken(users, token) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  req.users = users;
  next();
}

app.post('/api/auth/phone/send-code', (req, res) => {
  const phone = String((req.body || {}).phone || '').trim();
  if (!/^0?7\d{9}$/.test(phone.replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح' });
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  otpStore.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
  // dev-mode only: real deployments must NOT return the code in the response
  res.json({ ok: true, devCode: code });
});

app.post('/api/auth/phone/verify', (req, res) => {
  const phone = String((req.body || {}).phone || '').trim();
  const code = String((req.body || {}).code || '').trim();
  const entry = otpStore.get(phone);
  if (!entry || entry.code !== code || entry.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'الكود غير صحيح أو منتهي' });
  }
  otpStore.delete(phone);

  const users = readTable('users');
  const key = 'phone:' + phone.replace(/\D/g, '');
  let user = findUserByKey(users, key);
  const token = genId('usrtok');
  if (!user) {
    user = { id: genId('user'), key, method: 'phone', phone, name: 'زبون عطور الريحان', wallet: 0, transactions: [], token };
    users.push(user);
  } else {
    user.token = token;
  }
  writeTable('users', users);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/social', (req, res) => {
  const { provider, name, email } = req.body || {};
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }
  const users = readTable('users');
  const key = `${provider}:${String(email).toLowerCase()}`;
  let user = findUserByKey(users, key);
  const token = genId('usrtok');
  if (!user) {
    user = { id: genId('user'), key, method: provider, email, name, wallet: 0, transactions: [], token };
    users.push(user);
  } else {
    user.token = token;
  }
  writeTable('users', users);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.put('/api/me', requireUser, (req, res) => {
  const { name } = req.body || {};
  if (name && name.trim()) req.user.name = name.trim();
  writeTable('users', req.users);
  res.json({ user: publicUser(req.user) });
});

app.post('/api/wallet/topup', requireUser, (req, res) => {
  const amount = Math.max(0, parseInt((req.body || {}).amount, 10) || 0);
  if (!amount) return res.status(400).json({ error: 'مبلغ غير صحيح' });
  req.user.wallet = (req.user.wallet || 0) + amount;
  req.user.transactions = req.user.transactions || [];
  req.user.transactions.push({ note: 'شحن المحفظة (تجريبي)', amount, date: new Date().toLocaleDateString('ar-IQ') });
  writeTable('users', req.users);
  res.json({ user: publicUser(req.user) });
});

/* ---------------------------------------------------------
   brands (groups) — full CRUD, admin only for writes
--------------------------------------------------------- */
app.get('/api/brands', (req, res) => {
  const brands = readTable('brands').sort((a, b) => a.order - b.order);
  res.json(brands);
});

app.post('/api/admin/brands', requireAdmin, (req, res) => {
  const { label, tag, color } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'اسم الخط مطلوب' });
  const brands = readTable('brands');
  const key = slugify(label) + '_' + Date.now().toString(36).slice(-4);
  const brand = {
    key, label: label.trim(), tag: (tag || '').trim(),
    color: color || '#C9A227', order: brands.length, custom: true
  };
  brands.push(brand);
  writeTable('brands', brands);
  res.status(201).json(brand);
});

app.put('/api/admin/brands/:key', requireAdmin, (req, res) => {
  const brands = readTable('brands');
  const brand = brands.find(b => b.key === req.params.key);
  if (!brand) return res.status(404).json({ error: 'الخط غير موجود' });
  const { label, tag, color } = req.body || {};
  if (label && label.trim()) brand.label = label.trim();
  if (typeof tag === 'string') brand.tag = tag.trim();
  if (color) brand.color = color;
  writeTable('brands', brands);
  res.json(brand);
});

app.delete('/api/admin/brands/:key', requireAdmin, (req, res) => {
  const brands = readTable('brands');
  const idx = brands.findIndex(b => b.key === req.params.key);
  if (idx === -1) return res.status(404).json({ error: 'الخط غير موجود' });
  const removedBrand = brands[idx];
  brands.splice(idx, 1);
  writeTable('brands', brands);

  // remove the brand's advertising photo, if any
  if (removedBrand.bannerUrl) {
    const bannerPath = path.join(__dirname, removedBrand.bannerUrl.replace(/^\/uploads\//, 'uploads/'));
    fs.unlink(bannerPath, () => {});
  }

  // cascade delete every product that belonged to this brand (and their photos)
  const products = readTable('products');
  const remaining = products.filter(p => p.brand !== req.params.key);
  const removedCount = products.length - remaining.length;
  products.filter(p => p.brand === req.params.key && p.photoUrl).forEach(p => {
    fs.unlink(path.join(__dirname, p.photoUrl.replace(/^\/uploads\//, 'uploads/')), () => {});
  });
  writeTable('products', remaining);

  res.json({ ok: true, removedProducts: removedCount });
});

/* ---------------------------------------------------------
   products — full CRUD, admin only for writes
--------------------------------------------------------- */
app.get('/api/products', (req, res) => {
  res.json(readTable('products'));
});

/* public shop settings the storefront needs (delivery fee, etc.) */
app.get('/api/config', (req, res) => {
  res.json({ deliveryFee: DELIVERY_FEE });
});

app.get('/api/diamonds', (req, res) => {
  res.json(readTable('diamonds'));
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const body = req.body || {};
  const ar = (body.ar || '').trim();
  const priceNum = Math.max(0, parseInt(body.priceNum, 10) || 0);
  if (!ar || !priceNum || !body.brand) {
    return res.status(400).json({ error: 'الخط، الاسم، والسعر مطلوبة' });
  }
  const products = readTable('products');
  const product = {
    id: genId('prod'),
    brand: body.brand,
    ar,
    name: (body.name || '').trim(),
    notes: (body.notes || '').trim() || 'عطر مضاف حديثاً — لا يوجد وصف بعد.',
    priceNum,
    price: fmtIQD(priceNum),
    vol: (body.vol || '').trim() || '100 مل',
    icon: body.icon || 'bottle',
    shape: body.shape || 'classic',
    color: body.color || '#C9A227',
    available: typeof body.available === 'boolean' ? body.available : true,
    original: !!body.original,
    limited: !!body.limited,
    custom: true
  };
  if (typeof body.qty === 'number') {
    product.qty = Math.max(0, body.qty);
    product.available = product.qty > 0;
  }
  const pyr = cleanPyramid(body.pyramid);
  if (pyr) product.pyramid = pyr;
  products.push(product);
  writeTable('products', products);
  res.status(201).json(product);
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readTable('products');
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'العطر غير موجود' });

  const body = req.body || {};
  if (typeof body.priceNum === 'number') {
    product.priceNum = Math.max(0, body.priceNum);
    product.price = fmtIQD(product.priceNum);
  }
  if (typeof body.qty !== 'undefined') {
    if (body.qty === null) {
      delete product.qty;
    } else {
      product.qty = Math.max(0, parseInt(body.qty, 10) || 0);
      product.available = product.qty > 0;
    }
  }
  if (typeof body.available === 'boolean') product.available = body.available;
  if (typeof body.ar === 'string' && body.ar.trim()) product.ar = body.ar.trim();
  if (typeof body.name === 'string') product.name = body.name.trim();
  if (typeof body.notes === 'string' && body.notes.trim()) product.notes = body.notes.trim();
  if (typeof body.vol === 'string' && body.vol.trim()) product.vol = body.vol.trim();
  if (typeof body.brand === 'string') product.brand = body.brand;
  if (typeof body.original === 'boolean') product.original = body.original;
  if (typeof body.limited === 'boolean') product.limited = body.limited;
  if (typeof body.color === 'string') product.color = body.color;
  if (typeof body.pyramid !== 'undefined') {
    const pyr = cleanPyramid(body.pyramid);
    if (pyr) product.pyramid = pyr; else delete product.pyramid;
  }

  writeTable('products', products);
  res.json(product);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readTable('products');
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'العطر غير موجود' });
  products.splice(idx, 1);
  writeTable('products', products);
  res.json({ ok: true });
});

/* photo upload */
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => cb(null, `${req.params.id}_${Date.now()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('نوع الملف غير مدعوم — استخدم صورة JPG أو PNG أو WEBP.'));
  }
});

app.post('/api/admin/products/:id/photo', requireAdmin, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'تعذر رفع الصورة' });
    const products = readTable('products');
    const product = products.find(p => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'العطر غير موجود' });
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال صورة' });

    // remove the previous photo file so uploads/ doesn't accumulate orphans
    if (product.photoUrl) {
      const old = path.join(__dirname, product.photoUrl.replace(/^\/uploads\//, 'uploads/'));
      fs.unlink(old, () => {});
    }
    product.photoUrl = `/uploads/${req.file.filename}`;
    writeTable('products', products);
    res.json(product);
  });
});

/* remove a product photo — the card falls back to its generated symbol */
app.delete('/api/admin/products/:id/photo', requireAdmin, (req, res) => {
  const products = readTable('products');
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'العطر غير موجود' });
  if (product.photoUrl) {
    const old = path.join(__dirname, product.photoUrl.replace(/^\/uploads\//, 'uploads/'));
    fs.unlink(old, () => {});
    delete product.photoUrl;
    writeTable('products', products);
  }
  res.json(product);
});

/* brand advertising photo — shown as the background image for that
   brand's slide in the homepage hero/advertising section. Falls back
   to the generated gradient + icon when no photo is set. */
const uploadBrandPhoto = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => cb(null, `brand_${req.params.key}_${Date.now()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('نوع الملف غير مدعوم — استخدم صورة JPG أو PNG أو WEBP.'));
  }
});

app.post('/api/admin/brands/:key/photo', requireAdmin, (req, res) => {
  uploadBrandPhoto.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'تعذر رفع الصورة' });
    const brands = readTable('brands');
    const brand = brands.find(b => b.key === req.params.key);
    if (!brand) return res.status(404).json({ error: 'الخط غير موجود' });
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال صورة' });

    if (brand.bannerUrl) {
      const old = path.join(__dirname, brand.bannerUrl.replace(/^\/uploads\//, 'uploads/'));
      fs.unlink(old, () => {});
    }
    brand.bannerUrl = `/uploads/${req.file.filename}`;
    writeTable('brands', brands);
    res.json(brand);
  });
});

app.delete('/api/admin/brands/:key/photo', requireAdmin, (req, res) => {
  const brands = readTable('brands');
  const brand = brands.find(b => b.key === req.params.key);
  if (!brand) return res.status(404).json({ error: 'الخط غير موجود' });
  if (brand.bannerUrl) {
    const old = path.join(__dirname, brand.bannerUrl.replace(/^\/uploads\//, 'uploads/'));
    fs.unlink(old, () => {});
    delete brand.bannerUrl;
    writeTable('brands', brands);
  }
  res.json(brand);
});

/* ---------------------------------------------------------
   admin: stats + orders list
--------------------------------------------------------- */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const products = readTable('products');
  const brands = readTable('brands');
  const orders = readTable('orders');
  const counts = {};
  brands.forEach(b => { counts[b.key] = products.filter(p => p.brand === b.key).length; });
  res.json({
    totalProducts: products.length,
    totalBrands: brands.length,
    outOfStock: products.filter(p => typeof p.qty === 'number' && p.qty <= 0).length,
    totalOrders: orders.length,
    countsByBrand: counts
  });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = readTable('orders').sort((a, b) => b.createdAt - a.createdAt);
  res.json(orders);
});

/* ---------------------------------------------------------
   orders / checkout — server recomputes totals & validates wallet
--------------------------------------------------------- */
app.post('/api/orders', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'السلة فارغة' });
  if (!body.name || !body.phone) return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });

  const products = readTable('products');
  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const product = products.find(p => p.id === item.id);
    if (!product || product.available === false) continue;
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    subtotal += product.priceNum * qty;
    lines.push({ id: product.id, ar: product.ar, qty, priceNum: product.priceNum, lineTotal: product.priceNum * qty });
  }
  if (!lines.length) return res.status(400).json({ error: 'لا توجد عطور صالحة بالسلة' });

  // home delivery carries a flat fee; branch pickup is free.
  // Computed server-side so the client can never skip it.
  const deliveryMethod = body.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';
  const deliveryFee = deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;

  // wallet payment must be validated & deducted server-side (never trust the client)
  let user = null;
  let users = null;
  if (body.paymentMethod === 'wallet') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    users = readTable('users');
    user = token ? findUserByToken(users, token) : null;
    if (!user) return res.status(401).json({ error: 'يجب تسجيل الدخول للدفع من المحفظة' });
    if ((user.wallet || 0) < total) return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ' });
    user.wallet -= total;
    user.transactions = user.transactions || [];
    user.transactions.push({ note: 'شراء من المتجر', amount: -total, date: new Date().toLocaleDateString('ar-IQ') });
    writeTable('users', users);
  }

  const order = {
    id: genId('order'),
    createdAt: Date.now(),
    name: body.name,
    phone: body.phone,
    deliveryMethod,
    branch: body.branch || null,
    address: body.address || null,
    paymentMethod: body.paymentMethod || 'cod',
    notes: body.notes || '',
    items: lines,
    subtotal,
    deliveryFee,
    total,
    userKey: user ? user.key : null,
    status: 'new',
    emailSent: false
  };
  const orders = readTable('orders');
  orders.push(order);
  writeTable('orders', orders);

  // notify the shop owner by email — a mail failure must never fail a real order
  const mailResult = await sendOrderEmail(order);
  if (mailResult.sent) {
    const fresh = readTable('orders');
    const saved = fresh.find(o => o.id === order.id);
    if (saved) { saved.emailSent = true; writeTable('orders', fresh); }
    order.emailSent = true;
  }

  res.status(201).json({ order, user: user ? publicUser(user) : null });
});

/* update an order's status (new / confirmed / delivered / cancelled) */
app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = readTable('orders');
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const allowed = ['new', 'confirmed', 'delivered', 'cancelled'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
  order.status = status;
  writeTable('orders', orders);
  res.json(order);
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = readTable('orders');
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'الطلب غير موجود' });
  orders.splice(idx, 1);
  writeTable('orders', orders);
  res.json({ ok: true });
});

/* ---------------------------------------------------------
   Light Agent — local AI chat (via Ollama). See agent.js.
--------------------------------------------------------- */
app.get('/api/chat/status', async (req, res) => {
  const status = await checkAgentAvailable();
  res.json(status);
});

/* Streams the reply as newline-delimited JSON:
     {"t":"token text"}          — repeated, as the model writes
     {"done":true,"products":[]} — once, at the end (ids to show as cards)
     {"error":"..."}             — if the model fails part-way
   If the agent can't even start, it answers HTTP 503 instead, and the
   storefront falls back to the fast rule-based Light for that message. */
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'الرسالة فارغة' });
  }

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no'); // stop nginx buffering the stream when hosted
    res.flushHeaders();
  };

  try {
    const full = await streamAgent(message, history, (piece) => {
      start();
      res.write(JSON.stringify({ t: piece }) + '\n');
    });
    start();
    res.write(JSON.stringify({ done: true, products: productsMentioned(full) }) + '\n');
    res.end();
  } catch (e) {
    console.warn('  ⚠️  Light agent error:', e.message);
    if (!started) {
      res.status(503).json({ error: 'agent unavailable', detail: e.message });
    } else {
      res.write(JSON.stringify({ error: e.message }) + '\n');
      res.end();
    }
  }
});

/* ---------------------------------------------------------
   fallback: serve the storefront for any other GET route
   (the /admin app is served as static files above)
--------------------------------------------------------- */
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/admin')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

initMailer();

app.listen(PORT, async () => {
  console.log(`\n  عطور الريحان — يعمل الآن على http://localhost:${PORT}`);
  console.log(`  لوحة الإدارة المستقلة: http://localhost:${PORT}/admin\n`);
  if (ADMIN_PASSWORD_FROM_ENV) {
    console.log('  كلمة مرور الإدارة: مأخوذة من ملف .env\n');
  } else {
    console.log(`  ⚠ لم يتم تعيين ADMIN_PASSWORD في .env — كلمة مرور مؤقتة لهذه الجلسة: ${ADMIN_PASSWORD}`);
    console.log('    (No ADMIN_PASSWORD set in .env — temporary password shown above. Set one in server/.env.)\n');
  }
  await verifyMailer();
});
