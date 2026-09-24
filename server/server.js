require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readTable, writeTable } = require('./db');
const {
  initMailer, verifyMailer, sendOrderEmail, sendTestEmail, isMailConfigured, sendOtpEmail,
  saveMailSettings, publicMailSettings
} = require('./mailer');
const { checkAgentAvailable, streamAgent, warmUpAgent, productsMentioned } = require('./agent');
const whatsapp = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;
// No password is hardcoded. Set ADMIN_PASSWORD in server/.env.
// If it is missing, a random one-time password is generated at each start
// and printed in the console, so the admin panel is never left on a known default.
const ADMIN_PASSWORD_FROM_ENV = Boolean(process.env.ADMIN_PASSWORD);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
const DELIVERY_FEE = parseInt(process.env.DELIVERY_FEE, 10) || 5000;

/* ---------------------------------------------------------
   security basics
--------------------------------------------------------- */
app.disable('x-powered-by');
// behind a reverse proxy (nginx, Codespaces) on this same machine the real
// client IP comes in X-Forwarded-For; never trust it from anywhere else
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '100kb' }));

// uploads: only real image files, served as images, never as pages
const UPLOADS_DIR = path.join(__dirname, 'uploads');
app.use('/uploads', (req, res, next) => {
  if (!/^\/[\w.-]+\.(jpe?g|png|webp|gif)$/i.test(req.path)) return res.status(404).end();
  next();
}, express.static(UPLOADS_DIR, { dotfiles: 'deny', index: false }));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------------------------------------------------------
   helpers
--------------------------------------------------------- */
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}
/* login tokens: 256 random bits — impossible to guess */
function genToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

/* simple in-memory rate limiter, per client IP */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: message || 'طلبات كثيرة — حاول بعد قليل' });
    }
    next();
  };
}
const limitCodes = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: 'طلبت أكواداً كثيرة — حاول بعد ساعة' });
const limitAuth = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'محاولات كثيرة — حاول بعد ربع ساعة' });
const limitOrders = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, message: 'طلبات كثيرة من نفس الجهاز — حاول بعد قليل أو تواصل معنا على واتساب' });
const limitChat = rateLimit({ windowMs: 60 * 1000, max: 12, message: 'رسائل كثيرة — انتظر دقيقة' });
const limitLookup = rateLimit({ windowMs: 60 * 1000, max: 60 });
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
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json'); // git-ignored
const ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000;                   // admin sessions last 12 hours
const adminTokens = new Map();                                   // token -> expiresAt

function readAdminHash() {
  try { const a = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); return a.hash && a.salt ? a : null; }
  catch (e) { return null; }
}
/* the password set in the admin panel wins; .env ADMIN_PASSWORD is only the first-run fallback */
function checkAdminPassword(password) {
  const pw = String(password || '');
  const saved = readAdminHash();
  if (saved) {
    const h = crypto.scryptSync(pw, saved.salt, 64);
    return crypto.timingSafeEqual(h, Buffer.from(saved.hash, 'hex'));
  }
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const exp = token && adminTokens.get(token);
  if (!exp || exp < Date.now()) {
    if (token) adminTokens.delete(token);
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// 5 wrong passwords from one IP → that IP is locked out for 15 minutes
const adminFails = new Map(); // ip -> { n, until }
app.post('/api/admin/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const f = adminFails.get(ip);
  if (f && f.until > Date.now()) {
    return res.status(429).json({ error: 'محاولات كثيرة — حاول بعد 15 دقيقة' });
  }
  const { password } = req.body || {};
  if (!checkAdminPassword(password)) {
    const n = (f && f.until && f.until <= Date.now() ? 0 : (f ? f.n : 0)) + 1;
    adminFails.set(ip, { n, until: n >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
    console.warn(`  🔒 فشل دخول الإدارة من ${ip} (${n})`);
    await new Promise(r => setTimeout(r, 700)); // slow down guessing
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }
  adminFails.delete(ip);
  const token = genToken('admtok');
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
  res.json({ token });
});

/* change the admin password from the panel (saved hashed, never in GitHub) */
app.put('/api/admin/password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  if (!checkAdminPassword(current)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  const pw = String(next || '');
  if (pw.length < 10) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل' });
  if (pw === String(current)) return res.status(400).json({ error: 'اختر كلمة مرور مختلفة عن الحالية' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_FILE + '.tmp', JSON.stringify({ hash, salt, updatedAt: Date.now() }), { mode: 0o600 });
  fs.renameSync(ADMIN_FILE + '.tmp', ADMIN_FILE);
  // log out every other session (e.g. someone who knew the old password)
  adminTokens.clear();
  const token = genToken('admtok');
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
  res.json({ ok: true, token });
});

app.post('/api/admin/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) adminTokens.delete(auth.slice(7));
  res.json({ ok: true });
});

app.get('/api/admin/security', requireAdmin, (req, res) => {
  res.json({ passwordSetInPanel: Boolean(readAdminHash()) });
});

/* ---------------------------------------------------------
   user auth (phone OTP demo + social demo)
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
  // wallet/transactions: leftovers from the removed wallet feature, never sent to the browser
  const { token, passHash, passSalt, wallet, transactions, ...rest } = u;
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

/* sign-up / login code: sent by WhatsApp when it's configured in .env,
   otherwise shown on screen (local demo mode) */
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_TRIES = 5;
// Showing codes on screen lets ANYONE log into ANY account — only for local testing.
const DEMO_CODES = String(process.env.DEMO_CODES || '').toLowerCase() === 'on';

app.post('/api/auth/phone/send-code', limitCodes, async (req, res) => {
  const phone = String((req.body || {}).phone || '').replace(/\s/g, '');
  if (!/^0?7\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'رقم هاتف غير صحيح' });
  }
  const prev = otpStore.get(phone);
  if (prev && Date.now() - prev.sentAt < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - prev.sentAt)) / 1000);
    return res.status(429).json({ error: `انتظر ${wait} ثانية قبل طلب كود جديد` });
  }
  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  const entry = { code, expiresAt: Date.now() + 5 * 60 * 1000, sentAt: Date.now(), tries: 0 };

  if (whatsapp.isConfigured()) {
    try {
      await whatsapp.sendOtp(phone, code);
    } catch (e) {
      console.warn('  ⚠️ WhatsApp OTP failed:', e.message);
      return res.status(502).json({ error: 'تعذر إرسال الكود عبر واتساب — تأكد أن الرقم عليه واتساب وحاول مجدداً' });
    }
    otpStore.set(phone, entry);
    return res.json({ ok: true, channel: 'whatsapp' });
  }

  if (!DEMO_CODES) {
    return res.status(503).json({ error: 'الدخول برقم الهاتف غير متاح حالياً — سجّل الدخول بكلمة المرور أو بالبريد الإلكتروني' });
  }
  // demo mode (DEMO_CODES=on, local testing only): the code is shown on screen
  otpStore.set(phone, entry);
  res.json({ ok: true, channel: 'demo', devCode: code });
});

app.post('/api/auth/phone/verify', limitAuth, (req, res) => {
  const phone = String((req.body || {}).phone || '').replace(/\s/g, '');
  const code = String((req.body || {}).code || '').trim();
  const entry = otpStore.get(phone);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'الكود غير صحيح أو منتهي' });
  }
  if (entry.code !== code) {
    entry.tries = (entry.tries || 0) + 1;
    if (entry.tries >= OTP_MAX_TRIES) otpStore.delete(phone);
    return res.status(400).json({ error: entry.tries >= OTP_MAX_TRIES ? 'محاولات كثيرة — اطلب كوداً جديداً' : 'الكود غير صحيح أو منتهي' });
  }
  otpStore.delete(phone);

  const users = readTable('users');
  const key = 'phone:' + phone.replace(/\D/g, '');
  let user = findUserByKey(users, key) || findByContact(users, key.startsWith('email:') ? 'email' : 'phone', key.slice(key.indexOf(':') + 1));
  if (user && user.passHash) {
    return res.status(403).json({ error: 'هذا الحساب محمي بكلمة مرور — سجّل الدخول باسم المستخدم وكلمة المرور' });
  }
  const token = genToken('usrtok');
  if (!user) {
    user = { id: genId('user'), key, method: 'phone', phone, name: 'زبون عطور الريحان', token };
    users.push(user);
  } else {
    user.token = token;
  }
  writeTable('users', users);
  res.json({ token, user: publicUser(user) });
});

/* ---- sign up / log in with an email address + a code sent by email ---- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post('/api/auth/email/send-code', limitCodes, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return res.status(400).json({ error: 'بريد إلكتروني غير صحيح' });
  }
  const key = 'email:' + email;
  const prev = otpStore.get(key);
  if (prev && Date.now() - prev.sentAt < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - prev.sentAt)) / 1000);
    return res.status(429).json({ error: `انتظر ${wait} ثانية قبل طلب كود جديد` });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const entry = { code, expiresAt: Date.now() + 5 * 60 * 1000, sentAt: Date.now(), tries: 0 };

  if (isMailConfigured()) {
    try {
      await sendOtpEmail(email, code);
    } catch (e) {
      console.warn('  ⚠️ OTP email failed:', e.message);
      return res.status(502).json({ error: 'تعذر إرسال الكود إلى بريدك — تأكد من العنوان وحاول مجدداً' });
    }
    otpStore.set(key, entry);
    return res.json({ ok: true, channel: 'email' });
  }

  if (!DEMO_CODES) {
    return res.status(503).json({ error: 'الدخول بالكود غير متاح حالياً — سجّل الدخول بكلمة المرور' });
  }
  // demo mode (DEMO_CODES=on, local testing only): show the code on screen
  otpStore.set(key, entry);
  res.json({ ok: true, channel: 'demo', devCode: code });
});

app.post('/api/auth/email/verify', limitAuth, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  const otpKey = 'email:' + email;
  const entry = otpStore.get(otpKey);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'الكود غير صحيح أو منتهي' });
  }
  if (entry.code !== code) {
    entry.tries = (entry.tries || 0) + 1;
    if (entry.tries >= OTP_MAX_TRIES) otpStore.delete(otpKey);
    return res.status(400).json({ error: entry.tries >= OTP_MAX_TRIES ? 'محاولات كثيرة — اطلب كوداً جديداً' : 'الكود غير صحيح أو منتهي' });
  }
  otpStore.delete(otpKey);

  const users = readTable('users');
  const key = 'email:' + email;
  let user = findUserByKey(users, key) || findByContact(users, key.startsWith('email:') ? 'email' : 'phone', key.slice(key.indexOf(':') + 1));
  if (user && user.passHash) {
    return res.status(403).json({ error: 'هذا الحساب محمي بكلمة مرور — سجّل الدخول باسم المستخدم وكلمة المرور' });
  }
  const token = genToken('usrtok');
  if (!user) {
    user = { id: genId('user'), key, method: 'email', email, name: 'زبون عطور الريحان', token };
    users.push(user);
  } else {
    user.token = token;
  }
  writeTable('users', users);
  res.json({ token, user: publicUser(user) });
});

/* ---------------------------------------------------------
   accounts with username + password. Sign-up is confirmed with a
   one-time code sent to the phone (WhatsApp) or email the user
   chooses. Log in with username / phone / email + password.
   --------------------------------------------------------- */
const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/;
const pendingSignups = new Map(); // contactKey -> { username, passHash, passSalt, code, expiresAt, sentAt, tries }

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const passHash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { passHash, passSalt: salt };
}
function checkPassword(user, password) {
  if (!user || !user.passHash || !user.passSalt) return false;
  const { passHash } = hashPassword(password, user.passSalt);
  return crypto.timingSafeEqual(Buffer.from(passHash, 'hex'), Buffer.from(user.passHash, 'hex'));
}
function normPhone(p) { return String(p || '').replace(/\D/g, '').replace(/^964/, '0').replace(/^7/, '07'); }
function contactKeyOf(method, contact) {
  return method === 'email' ? 'email:' + String(contact).trim().toLowerCase() : 'phone:' + normPhone(contact).replace(/\D/g, '');
}
function findByUsername(users, username) {
  const u = String(username || '').toLowerCase();
  return users.find(x => x.username && x.username.toLowerCase() === u);
}
function findByContact(users, method, contact) {
  if (method === 'email') {
    const e = String(contact).trim().toLowerCase();
    return users.find(x => x.key === 'email:' + e || (x.email && x.email.toLowerCase() === e));
  }
  const ph = normPhone(contact).replace(/\D/g, '');
  return users.find(x => x.key === 'phone:' + ph || (x.phone && normPhone(x.phone).replace(/\D/g, '') === ph));
}

/* sends a code by WhatsApp (phone) or email; returns the channel used */
async function deliverCode(method, contact, code) {
  if (method === 'email') {
    if (!isMailConfigured()) return 'demo';
    await sendOtpEmail(String(contact).trim(), code);
    return 'email';
  }
  if (!whatsapp.isConfigured()) return 'demo';
  await whatsapp.sendOtp(normPhone(contact), code);
  return 'whatsapp';
}

app.get('/api/auth/username-available', limitLookup, (req, res) => {
  const username = String(req.query.u || '').trim();
  if (!USERNAME_RE.test(username)) return res.json({ available: false, reason: 'invalid' });
  res.json({ available: !findByUsername(readTable('users'), username) });
});

app.post('/api/auth/register/start', limitCodes, async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const method = body.method === 'email' ? 'email' : 'phone';
  const contact = String(body.contact || '').trim();

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'اسم المستخدم من 3 إلى 20 حرفاً إنجليزياً أو رقماً (ويُسمح بـ _ و .)' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
  if (typeof body.confirm === 'string' && body.confirm !== password) {
    return res.status(400).json({ error: 'تأكيد كلمة المرور غير مطابق' });
  }
  if (method === 'email' ? !EMAIL_RE.test(contact) : !/^0?7\d{9}$/.test(contact.replace(/\s/g, ''))) {
    return res.status(400).json({ error: method === 'email' ? 'بريد إلكتروني غير صحيح' : 'رقم هاتف غير صحيح' });
  }

  const users = readTable('users');
  const taken = findByUsername(users, username);
  if (taken) return res.status(409).json({ error: 'اسم المستخدم محجوز — اختر اسماً آخر' });
  const existing = findByContact(users, method, contact);
  if (existing && existing.passHash) {
    return res.status(409).json({ error: method === 'email' ? 'هذا البريد مسجّل مسبقاً — سجّل الدخول' : 'هذا الرقم مسجّل مسبقاً — سجّل الدخول' });
  }
  // another pending sign-up already reserved this username
  for (const [k, v] of pendingSignups) {
    if (v.expiresAt > Date.now() && v.username.toLowerCase() === username.toLowerCase() && k !== contactKeyOf(method, contact)) {
      return res.status(409).json({ error: 'اسم المستخدم محجوز — اختر اسماً آخر' });
    }
  }

  const ckey = contactKeyOf(method, contact);
  const prev = pendingSignups.get(ckey);
  if (prev && Date.now() - prev.sentAt < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - prev.sentAt)) / 1000);
    return res.status(429).json({ error: `انتظر ${wait} ثانية قبل طلب كود جديد` });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  let channel;
  try {
    channel = await deliverCode(method, contact, code);
  } catch (e) {
    console.warn('  ⚠️ sign-up code failed:', e.message);
    return res.status(502).json({ error: 'تعذر إرسال كود التحقق — تأكد من البيانات وحاول مجدداً' });
  }
  if (channel === 'demo' && !DEMO_CODES) {
    return res.status(503).json({ error: method === 'email'
      ? 'التسجيل بالبريد غير متاح حالياً — تواصل معنا على واتساب'
      : 'التسجيل برقم الهاتف غير متاح حالياً — سجّل بالبريد الإلكتروني' });
  }
  pendingSignups.set(ckey, {
    username, method, contact, ...hashPassword(password),
    code, expiresAt: Date.now() + 10 * 60 * 1000, sentAt: Date.now(), tries: 0
  });
  res.json(channel === 'demo' ? { ok: true, channel, devCode: code } : { ok: true, channel });
});

app.post('/api/auth/register/verify', limitAuth, (req, res) => {
  const body = req.body || {};
  const method = body.method === 'email' ? 'email' : 'phone';
  const ckey = contactKeyOf(method, body.contact || '');
  const code = String(body.code || '').trim();
  const pending = pendingSignups.get(ckey);
  if (!pending || pending.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'الكود غير صحيح أو منتهي — ابدأ التسجيل من جديد' });
  }
  if (pending.code !== code) {
    pending.tries += 1;
    if (pending.tries >= OTP_MAX_TRIES) pendingSignups.delete(ckey);
    return res.status(400).json({ error: pending.tries >= OTP_MAX_TRIES ? 'محاولات كثيرة — ابدأ التسجيل من جديد' : 'الكود غير صحيح' });
  }

  const users = readTable('users');
  if (findByUsername(users, pending.username)) {
    pendingSignups.delete(ckey);
    return res.status(409).json({ error: 'اسم المستخدم محجوز — اختر اسماً آخر' });
  }
  const token = genToken('usrtok');
  let user = findByContact(users, method, pending.contact);
  if (user && user.passHash) {
    pendingSignups.delete(ckey);
    return res.status(409).json({ error: 'هذا الحساب مسجّل مسبقاً — سجّل الدخول' });
  }
  if (!user) {
    user = { id: genId('user'), key: ckey, method, name: pending.username };
    users.push(user);
  }
  // an older code-only account with this phone/email is upgraded in place (keeps orders)
  user.username = pending.username;
  user.passHash = pending.passHash;
  user.passSalt = pending.passSalt;
  if (method === 'email') user.email = String(pending.contact).trim().toLowerCase();
  else user.phone = normPhone(pending.contact);
  if (!user.name || user.name === 'زبون عطور الريحان') user.name = pending.username;
  user.verified = true;
  user.token = token;
  writeTable('users', users);
  pendingSignups.delete(ckey);
  res.status(201).json({ token, user: publicUser(user) });
});

const loginFails = new Map(); // login -> { n, until }
app.post('/api/auth/login', limitAuth, (req, res) => {
  const login = String((req.body || {}).login || '').trim();
  const password = String((req.body || {}).password || '');
  if (!login || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
  const lk = login.toLowerCase();
  const f = loginFails.get(lk);
  if (f && f.until > Date.now()) {
    return res.status(429).json({ error: 'محاولات كثيرة — حاول بعد بضع دقائق' });
  }
  const users = readTable('users');
  let user = findByUsername(users, login);
  if (!user && login.includes('@')) user = findByContact(users, 'email', login);
  if (!user && /^[\d+\s]+$/.test(login)) user = findByContact(users, 'phone', login);
  if (!checkPassword(user, password)) {
    const n = ((f && f.n) || 0) + 1;
    loginFails.set(lk, { n, until: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  loginFails.delete(lk);
  user.token = genToken('usrtok');
  writeTable('users', users);
  res.json({ token: user.token, user: publicUser(user) });
});

/* ---- the signed-in customer's orders, favourites and pre-orders ---- */
app.get('/api/me/orders', requireUser, (req, res) => {
  const mine = readTable('orders')
    .filter(o => o.userKey === req.user.key)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(mine);
});

app.get('/api/me/favorites', requireUser, (req, res) => {
  res.json(req.user.favorites || []);
});
app.put('/api/me/favorites', requireUser, (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids : [];
  const known = new Set(readTable('products').map(p => p.id));
  req.user.favorites = [...new Set(ids.map(String))].filter(id => known.has(id)).slice(0, 300);
  writeTable('users', req.users);
  res.json(req.user.favorites);
});

app.get('/api/me/preorders', requireUser, (req, res) => {
  res.json((req.user.preorders || []).slice().sort((a, b) => b.createdAt - a.createdAt));
});
app.post('/api/me/preorders', requireUser, (req, res) => {
  const productId = String((req.body || {}).productId || '');
  const qty = Math.min(20, Math.max(1, parseInt((req.body || {}).qty, 10) || 1));
  const product = readTable('products').find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'العطر غير موجود' });
  req.user.preorders = req.user.preorders || [];
  const open = req.user.preorders.find(x => x.productId === productId && x.status === 'waiting');
  if (open) {
    open.qty = qty;
  } else {
    req.user.preorders.push({ id: genId('pre'), productId, ar: product.ar, priceNum: product.priceNum, qty, status: 'waiting', createdAt: Date.now() });
  }
  writeTable('users', req.users);
  res.status(201).json(req.user.preorders);
});
app.delete('/api/me/preorders/:id', requireUser, (req, res) => {
  const list = req.user.preorders || [];
  const item = list.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'الطلب المسبق غير موجود' });
  item.status = 'cancelled';
  writeTable('users', req.users);
  res.json(list);
});

/* admin: every customer's pre-orders, newest first */
app.get('/api/admin/preorders', requireAdmin, (req, res) => {
  const out = [];
  readTable('users').forEach(u => (u.preorders || []).forEach(p => out.push({
    ...p, user: u.username || u.name, contact: u.phone || u.email || ''
  })));
  res.json(out.sort((a, b) => b.createdAt - a.createdAt));
});

/* (the simulated Google/Apple sign-in was removed: it accepted any email without checking it) */

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.put('/api/me', requireUser, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'الاسم طويل جداً (60 حرفاً كحد أقصى)' });
  if (name) req.user.name = name;
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
    const bannerPath = uploadFile(removedBrand.bannerUrl);
    fs.unlink(bannerPath, () => {});
  }

  // cascade delete every product that belonged to this brand (and their photos)
  const products = readTable('products');
  const remaining = products.filter(p => p.brand !== req.params.key);
  const removedCount = products.length - remaining.length;
  products.filter(p => p.brand === req.params.key && p.photoUrl).forEach(p => {
    fs.unlink(uploadFile(p.photoUrl), () => {});
  });
  writeTable('products', remaining);

  // remove this brand's showcase ads too (and their photos)
  const brandAds = readTable('ads');
  if (brandAds.some(a => a.brand === req.params.key)) {
    brandAds.filter(a => a.brand === req.params.key).forEach(removeAdImage);
    writeTable('ads', brandAds.filter(a => a.brand !== req.params.key));
  }

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
/* ---------------------------------------------------------
   image uploads (admin only) — hardened:
   - the file name is random; the customer-supplied name/id is never used
     (stops "../../" path tricks)
   - the extension comes from the checked type, and the file's first bytes
     must really be a JPG/PNG/WEBP/GIF (stops web pages disguised as images)
--------------------------------------------------------- */
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function imageUpload(prefix, maxMB) {
  return multer({
    storage: multer.diskStorage({
      destination: UPLOADS_DIR,
      filename: (req, file, cb) => cb(null, `${prefix}_${crypto.randomBytes(12).toString('hex')}${IMAGE_EXT[file.mimetype]}`)
    }),
    limits: { fileSize: maxMB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (IMAGE_EXT[file.mimetype]) return cb(null, true);
      cb(new Error('نوع الملف غير مدعوم — استخدم صورة JPG أو PNG أو WEBP أو GIF.'));
    }
  });
}

function isRealImage(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    fs.closeSync(fd);
    return (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) ||                                  // JPG
      (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') ||                                  // PNG
      b.toString('ascii', 0, 4) === 'GIF8' ||                                                    // GIF
      (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP');           // WEBP
  } catch (e) { return false; }
}

/* runs the upload and rejects anything that isn't a genuine image */
function receiveImage(uploader, req, res, done) {
  uploader.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'تعذر رفع الصورة' });
    if (req.file && !isRealImage(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'الملف ليس صورة حقيقية.' });
    }
    done();
  });
}

/* maps a stored "/uploads/x.jpg" URL to its file, never outside uploads/ */
function uploadFile(url) {
  return path.join(UPLOADS_DIR, path.basename(String(url || '')));
}

const upload = imageUpload('prod', 5);

app.post('/api/admin/products/:id/photo', requireAdmin, (req, res) => {
  receiveImage(upload, req, res, () => {
    const products = readTable('products');
    const product = products.find(p => p.id === req.params.id);
    if (!product) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'العطر غير موجود' }); }
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال صورة' });

    // remove the previous photo file so uploads/ doesn't accumulate orphans
    if (product.photoUrl) {
      const old = uploadFile(product.photoUrl);
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
    const old = uploadFile(product.photoUrl);
    fs.unlink(old, () => {});
    delete product.photoUrl;
    writeTable('products', products);
  }
  res.json(product);
});

/* brand advertising photo — shown as the background image for that
   brand's slide in the homepage hero/advertising section. Falls back
   to the generated gradient + icon when no photo is set. */
const uploadBrandPhoto = imageUpload('brand', 5);

app.post('/api/admin/brands/:key/photo', requireAdmin, (req, res) => {
  receiveImage(uploadBrandPhoto, req, res, () => {
    const brands = readTable('brands');
    const brand = brands.find(b => b.key === req.params.key);
    if (!brand) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'الخط غير موجود' }); }
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال صورة' });

    if (brand.bannerUrl) {
      const old = uploadFile(brand.bannerUrl);
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
    const old = uploadFile(brand.bannerUrl);
    fs.unlink(old, () => {});
    delete brand.bannerUrl;
    writeTable('brands', brands);
  }
  res.json(brand);
});

/* ---------------------------------------------------------
   advertisements — slides shown first in the homepage
   showcase, managed from the admin app's الإعلانات tab
   --------------------------------------------------------- */
const AD_EFFECTS = ['none', 'brand', 'zoom', 'pan', 'float', 'shine', 'sparkle', 'glow'];
const AD_THEMES = ['both', 'dark', 'light'];

function cleanAd(body, ad) {
  ad = ad || {};
  if (typeof body.title === 'string') ad.title = body.title.trim().slice(0, 120);
  if (typeof body.desc === 'string') ad.desc = body.desc.trim().slice(0, 400);
  if (typeof body.buttonText === 'string') ad.buttonText = body.buttonText.trim().slice(0, 40);
  if (typeof body.link === 'string') {
    const link = body.link.trim().slice(0, 300);
    // only store-internal paths, brand links, or http(s) URLs — never javascript: etc.
    ad.link = /^(https?:\/\/|\/|brand:)/i.test(link) ? link : '';
  }
  if (typeof body.effect === 'string') ad.effect = AD_EFFECTS.includes(body.effect) ? body.effect : 'none';
  if (typeof body.theme === 'string') ad.theme = AD_THEMES.includes(body.theme) ? body.theme : 'both';
  if (typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color)) ad.color = body.color;
  if (typeof body.active === 'boolean') ad.active = body.active;
  return ad;
}

function sortedAds() {
  ensureAdsSeeded();
  return readTable('ads').sort((a, b) => (a.order || 0) - (b.order || 0));
}

function removeAdImage(ad) {
  if (ad && ad.imageUrl) {
    fs.unlink(uploadFile(ad.imageUrl), () => {});
    delete ad.imageUrl;
  }
}

/* the homepage showcase used to be built only from the brands. On first run
   those slides are imported as editable ads (same text, colour, photo and
   the brand's original motion), so everything in the showcase is managed
   from the الإعلانات tab. */
const BRAND_AD_COPY = {
  ibraq: 'عشر روائح، كل واحدة بحجر كريم يميّزها — من الماس الأزرق المنعش إلى العنبر الأسود الكثيف.',
  assaf: 'فخامة بطابع فرنسي بلمسة شرقية جريئة، بثلاث شخصيات مختلفة تناسب كل الأذواق.',
  armaf: 'من أشهر خطوط Club de Nuit عالمياً — حضور فاخر بسعر يناسب الجميع.',
  afnan: 'من دفء 9pm إلى انتعاش 9am — عطر لكل ساعة من يومك.',
  hawas: 'حمضيات جريئة تنتهي بقاعدة خشبية مائية لا تُنسى، بعدة نسخ لكل مزاج.',
  alhambra: 'أناقة أوروبية بخطوط متعددة، من الزهري الناعم إلى الخشبي القوي.',
  bold: 'لمن يريد الحضور القوي من أول رشة حتى آخر النهار.',
  nightdeparis: 'دفء باريسي يلفّك في ليالي الشتاء، عنبر وفانيليا بثبات طويل.',
  aurora: 'خط جديد بإطلالة عصرية وروائح متجددة لكل الأذواق.',
  nitro: 'طاقة وحيوية في كل رشة، بعلب أنيقة وإصدارات محدودة.',
  designer: 'ساڤاج، بلو دو شانيل، وأشهر الأسماء العالمية — أصلية ومستوردة مباشرة.'
};

function brandAdFrom(b, order) {
  const ad = {
    id: genId('ad'),
    title: String(b.label || '').slice(0, 120),
    desc: BRAND_AD_COPY[b.key] || b.tag || 'تصفّحوا أحدث العطور من هذا الخط.',
    buttonText: ('تسوّق ' + String(b.label || '').split(' —')[0]).slice(0, 40),
    link: 'brand:' + b.key,
    brand: b.key,
    effect: 'brand',
    theme: 'both',
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#C9A227',
    active: true,
    createdAt: Date.now(),
    order
  };
  if (b.bannerUrl) {
    // copy the brand's photo so deleting the ad never deletes the brand's own file
    try {
      const src = uploadFile(b.bannerUrl);
      const name = `ad_${crypto.randomBytes(12).toString('hex')}${path.extname(src).toLowerCase()}`;
      fs.copyFileSync(src, path.join(UPLOADS_DIR, name));
      ad.imageUrl = `/uploads/${name}`;
      ad.effect = 'zoom';
    } catch (e) { /* photo missing on disk — keep the generated look */ }
  }
  return ad;
}

/* adds an ad for every brand that doesn't have one yet; returns how many */
function importBrandAds() {
  const ads = readTable('ads');
  const have = new Set(ads.map(a => a.brand).filter(Boolean));
  let order = ads.reduce((m, a) => Math.max(m, a.order || 0), -1) + 1;
  let added = 0;
  readTable('brands').sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(b => {
    if (have.has(b.key)) return;
    ads.push(brandAdFrom(b, order++));
    added++;
  });
  writeTable('ads', ads);
  return added;
}

function ensureAdsSeeded() {
  if (fs.existsSync(path.join(__dirname, 'data', 'ads.json'))) return;
  writeTable('ads', []);
  importBrandAds();
}

app.post('/api/admin/ads/import-brands', requireAdmin, (req, res) => {
  ensureAdsSeeded();
  const added = importBrandAds();
  res.json({ added, ads: sortedAds() });
});

/* public: only the ads switched on */
app.get('/api/ads', (req, res) => {
  res.json(sortedAds().filter(a => a.active !== false));
});

app.get('/api/admin/ads', requireAdmin, (req, res) => {
  res.json(sortedAds());
});

app.post('/api/admin/ads', requireAdmin, (req, res) => {
  const ads = readTable('ads');
  const ad = cleanAd(req.body || {}, {
    id: genId('ad'), effect: 'zoom', theme: 'both', color: '#C9A227', active: true, createdAt: Date.now()
  });
  if (!ad.title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  ad.order = ads.reduce((m, a) => Math.max(m, a.order || 0), -1) + 1;
  ads.push(ad);
  writeTable('ads', ads);
  res.status(201).json(ad);
});

app.put('/api/admin/ads/:id', requireAdmin, (req, res) => {
  const ads = readTable('ads');
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'الإعلان غير موجود' });
  const before = ad.title;
  cleanAd(req.body || {}, ad);
  if (!ad.title) ad.title = before;
  writeTable('ads', ads);
  res.json(ad);
});

/* move an ad one step up (dir: -1) or down (dir: 1) in the showcase order */
app.post('/api/admin/ads/:id/move', requireAdmin, (req, res) => {
  const ads = sortedAds();
  const i = ads.findIndex(a => a.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'الإعلان غير موجود' });
  const j = i + (Number((req.body || {}).dir) < 0 ? -1 : 1);
  if (j >= 0 && j < ads.length) [ads[i], ads[j]] = [ads[j], ads[i]];
  ads.forEach((a, k) => { a.order = k; });
  writeTable('ads', ads);
  res.json(ads);
});

app.delete('/api/admin/ads/:id', requireAdmin, (req, res) => {
  const ads = readTable('ads');
  const idx = ads.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'الإعلان غير موجود' });
  removeAdImage(ads[idx]);
  ads.splice(idx, 1);
  writeTable('ads', ads);
  res.json({ ok: true });
});

const uploadAdPhoto = imageUpload('ad', 8);

app.post('/api/admin/ads/:id/photo', requireAdmin, (req, res) => {
  receiveImage(uploadAdPhoto, req, res, () => {
    const ads = readTable('ads');
    const ad = ads.find(a => a.id === req.params.id);
    if (!ad) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'الإعلان غير موجود' });
    }
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال صورة' });
    removeAdImage(ad);
    ad.imageUrl = `/uploads/${req.file.filename}`;
    writeTable('ads', ads);
    res.json(ad);
  });
});

app.delete('/api/admin/ads/:id/photo', requireAdmin, (req, res) => {
  const ads = readTable('ads');
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'الإعلان غير موجود' });
  removeAdImage(ad);
  writeTable('ads', ads);
  res.json(ad);
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

function orderUserKey(req) {
  const auth = req.headers.authorization || '';
  const t = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!t) return null;
  const u = findUserByToken(readTable('users'), t);
  return u ? u.key : null;
}

/* ---------------------------------------------------------
   orders / checkout — server recomputes totals
--------------------------------------------------------- */
const MAX_QTY_PER_ITEM = 20;
const MAX_ITEMS_PER_ORDER = 30;
app.post('/api/orders', limitOrders, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'السلة فارغة' });
  if (items.length > MAX_ITEMS_PER_ORDER) return res.status(400).json({ error: 'عدد العطور في الطلب كبير جداً — تواصل معنا على واتساب' });
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').replace(/[\s-]/g, '');
  if (!name || !phone) return res.status(400).json({ error: 'الاسم والهاتف مطلوبان' });
  if (name.length > 80) return res.status(400).json({ error: 'الاسم طويل جداً' });
  if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'رقم الهاتف غير صحيح' });

  const products = readTable('products');
  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const product = products.find(p => p.id === item.id);
    if (!product || product.available === false) continue;
    const qty = Math.min(MAX_QTY_PER_ITEM, Math.max(1, parseInt(item.qty, 10) || 1));
    subtotal += product.priceNum * qty;
    lines.push({ id: product.id, ar: product.ar, qty, priceNum: product.priceNum, lineTotal: product.priceNum * qty });
  }
  if (!lines.length) return res.status(400).json({ error: 'لا توجد عطور صالحة بالسلة' });

  // home delivery carries a flat fee; branch pickup is free.
  // Computed server-side so the client can never skip it.
  const deliveryMethod = body.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';
  const deliveryFee = deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;

  // accepted payment methods (the old wallet option was removed)
  const PAYMENT_METHODS = ['cod', 'zaincash', 'bank'];
  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : 'cod';

  const order = {
    id: genId('order'),
    createdAt: Date.now(),
    name,
    phone,
    deliveryMethod,
    branch: ['البلديات', 'المثنى'].includes(body.branch) ? body.branch : null,
    address: body.address ? String(body.address).trim().slice(0, 300) : null,
    paymentMethod,
    notes: String(body.notes || '').trim().slice(0, 500),
    items: lines,
    subtotal,
    deliveryFee,
    total,
    userKey: orderUserKey(req),
    status: 'new',
    emailSent: false
  };
  const orders = readTable('orders');
  orders.push(order);
  writeTable('orders', orders);

  // answer the customer right away; the owner's email goes through the
  // queue, which keeps retrying until it is delivered (see below)
  res.status(201).json({ order });
  retryPendingOrderEmails();
});

/* ---------------------------------------------------------
   order-email queue
   Every order is saved with emailSent:false. This queue sends
   the notification and keeps retrying (every 2 minutes, and
   right after the server starts) until it succeeds — so orders
   that came in while the internet or Gmail was down are still
   emailed once the connection is back.
--------------------------------------------------------- */
const EMAIL_RETRY_EVERY_MS = 2 * 60 * 1000;
const EMAIL_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // stop after a week
let emailQueueRunning = false;
let emailQueueAgain = false;
let lastMailError = null;

function pendingEmailOrders() {
  const cutoff = Date.now() - EMAIL_RETRY_MAX_AGE_MS;
  return readTable('orders').filter(o =>
    !o.emailSent && (o.status || 'new') === 'new' && (o.createdAt || 0) >= cutoff);
}

async function retryPendingOrderEmails() {
  if (emailQueueRunning) { emailQueueAgain = true; return; }
  emailQueueRunning = true;
  try {
    do {
      emailQueueAgain = false;
      if (!isMailConfigured()) break;
      for (const order of pendingEmailOrders()) {
        const result = await sendOrderEmail(order);
        // re-read before writing so we never overwrite a status change made meanwhile
        const fresh = readTable('orders');
        const saved = fresh.find(o => o.id === order.id);
        if (saved) {
          saved.emailAttempts = (saved.emailAttempts || 0) + 1;
          if (result.sent) {
            saved.emailSent = true;
            saved.emailSentAt = Date.now();
            delete saved.emailError;
          } else {
            saved.emailError = result.reason;
          }
          writeTable('orders', fresh);
        }
        if (!result.sent) { lastMailError = result.reason; break; } // offline: stop, try again later
        lastMailError = null;
      }
    } while (emailQueueAgain);
  } catch (e) {
    console.error('  ❌ email queue error:', e.message);
  } finally {
    emailQueueRunning = false;
  }
}

/* ---------------------------------------------------------
   mail settings — admin panel tab "البريد"
   Stored in server/data/mail-settings.json (git-ignored), so the
   app password survives restarts and is never pushed to GitHub.
--------------------------------------------------------- */
app.get('/api/admin/mail-settings', requireAdmin, (req, res) => {
  res.json({ ...publicMailSettings(), pending: pendingEmailOrders().length, lastError: lastMailError });
});

app.put('/api/admin/mail-settings', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const user = String(b.user || '').trim();
  const ownerEmail = String(b.ownerEmail || '').trim();
  if (!EMAIL_RE.test(user)) return res.status(400).json({ error: 'أدخل عنوان Gmail المُرسِل بشكل صحيح' });
  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) return res.status(400).json({ error: 'بريد استلام الطلبات غير صحيح' });
  if (!b.pass && !publicMailSettings().hasPass) return res.status(400).json({ error: 'أدخل كلمة مرور التطبيق' });
  saveMailSettings({
    user, pass: b.pass, ownerEmail, fromName: b.fromName,
    host: b.host, port: b.port, secure: typeof b.secure === 'boolean' ? b.secure : undefined
  });
  const check = await verifyMailer();
  lastMailError = check.ok ? null : check.error;
  if (check.ok) retryPendingOrderEmails();
  res.json({ ...publicMailSettings(), pending: pendingEmailOrders().length, verified: check.ok, lastError: lastMailError });
});

app.post('/api/admin/mail-settings/test', requireAdmin, async (req, res) => {
  const result = await sendTestEmail();
  if (!result.sent) { lastMailError = result.error; return res.status(502).json({ error: result.error }); }
  lastMailError = null;
  retryPendingOrderEmails();
  res.json({ ok: true, to: result.to });
});

app.post('/api/admin/mail/retry', requireAdmin, async (req, res) => {
  await retryPendingOrderEmails();
  res.json({ pending: pendingEmailOrders().length, lastError: lastMailError });
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
   If the agent can't even start, it answers HTTP 503 instead and the
   storefront tells the customer Light is reconnecting (there is no
   rule-based fallback — Light always answers through Ollama). */
const CHAT_MAX_ACTIVE = 2;   // answers generated at the same time
const CHAT_MAX_WAITING = 6;  // questions allowed to wait in line
let chatActive = 0;
const chatQueue = [];
function chatSlot() {
  if (chatActive < CHAT_MAX_ACTIVE) { chatActive++; return Promise.resolve(); }
  if (chatQueue.length >= CHAT_MAX_WAITING) return null;
  return new Promise(resolve => chatQueue.push(resolve));
}
function chatRelease() {
  const nextInLine = chatQueue.shift();
  if (nextInLine) nextInLine(); else chatActive--;
}

app.post('/api/chat', limitChat, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'الرسالة فارغة' });
  }
  const slot = chatSlot();
  if (!slot) return res.status(503).json({ error: 'لايت مشغول الآن — جرّب بعد لحظات' });
  await slot;
  let released = false;
  const release = () => { if (!released) { released = true; chatRelease(); } };
  res.on('close', release);

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
    release();
  } catch (e) {
    release();
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
  // "/.env", "/server.js", "/package.json"… are not pages: answer "not found"
  if (/(^|\/)\.|\.[a-z0-9]{1,5}$/i.test(req.path)) return res.status(404).type('text').send('Not found');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/* unknown API routes and every error: short JSON, never stack traces or file paths */
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'البيانات كبيرة جداً' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بيانات غير صالحة' });
  console.error('  ❌ خطأ في الخادم:', err && err.message);
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
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
  // send anything that was left unsent before the server went offline
  retryPendingOrderEmails();

  // Light: load the AI model now and keep checking it, so it's ready for customers
  const keepLightReady = async () => {
    const w = await warmUpAgent();
    if (w.ok) { if (!lightWasReady) console.log(`  🧠 لايت جاهز — النموذج ${w.model} محمّل في الذاكرة.\n`); }
    else if (lightWasReady !== false) console.warn(`  ⚠️  لايت لا يستطيع الوصول إلى Ollama (${w.error}) — سيُعاد المحاولة كل دقيقة.\n`);
    lightWasReady = w.ok;
  };
  let lightWasReady = null;
  keepLightReady();
  setInterval(keepLightReady, 60 * 1000);
  setInterval(retryPendingOrderEmails, EMAIL_RETRY_EVERY_MS);
});
