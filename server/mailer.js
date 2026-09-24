const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

/* ---------------------------------------------------------
   Mail setup — order notifications + sign-up codes.

   Where the settings live (first match wins):
     1. server/data/mail-settings.json — saved from the admin
        panel (tab "البريد"). This file is in .gitignore, so it
        is NEVER uploaded to GitHub and never overwritten by a
        git pull / re-upload. It survives every server restart.
     2. server/.env — SMTP_HOST, SMTP_PORT, SMTP_SECURE,
        SMTP_USER, SMTP_PASS, MAIL_FROM, OWNER_EMAIL (fallback).

   If nothing is configured the server still works normally:
   orders are saved and their emails wait in the queue until
   mail is set up (see retryPendingOrderEmails in server.js).
--------------------------------------------------------- */

const SETTINGS_FILE = path.join(__dirname, 'data', 'mail-settings.json');

function readSavedSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; }
  catch (e) { return {}; }
}

function cleanPass(p) {
  // Gmail shows app passwords as "abcd efgh ijkl mnop" — the spaces are not part of it
  return String(p || '').replace(/\s+/g, '');
}

/* the effective config the mailer uses right now */
function getMailConfig() {
  const saved = readSavedSettings();
  if (saved.user && saved.pass) {
    const port = parseInt(saved.port, 10) || 465;
    return {
      source: 'panel',
      host: saved.host || 'smtp.gmail.com',
      port,
      secure: typeof saved.secure === 'boolean' ? saved.secure : port === 465,
      user: saved.user,
      pass: cleanPass(saved.pass),
      ownerEmail: saved.ownerEmail || saved.user,
      from: `${saved.fromName || 'عطور الريحان'} <${saved.user}>`,
      fromName: saved.fromName || 'عطور الريحان'
    };
  }
  const e = process.env;
  if (e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS) {
    return {
      source: 'env',
      host: e.SMTP_HOST,
      port: parseInt(e.SMTP_PORT, 10) || 587,
      secure: String(e.SMTP_SECURE || '').toLowerCase() === 'true',
      user: e.SMTP_USER,
      pass: cleanPass(e.SMTP_PASS),
      ownerEmail: e.OWNER_EMAIL || e.SMTP_USER,
      from: e.MAIL_FROM || e.SMTP_USER,
      fromName: ''
    };
  }
  return null;
}

/* saves settings from the admin panel. An empty password keeps the stored one. */
function saveMailSettings(input) {
  const prev = readSavedSettings();
  const next = {
    user: String(input.user || '').trim(),
    pass: input.pass ? cleanPass(input.pass) : (prev.pass || ''),
    ownerEmail: String(input.ownerEmail || '').trim(),
    fromName: String(input.fromName || '').trim() || 'عطور الريحان',
    host: String(input.host || '').trim() || 'smtp.gmail.com',
    port: parseInt(input.port, 10) || 465,
    secure: input.secure === undefined ? undefined : Boolean(input.secure),
    updatedAt: Date.now()
  };
  if (next.secure === undefined) next.secure = next.port === 465;
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // write to a temp file then rename, so a crash mid-write can never wipe the settings
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
  transporterKey = null; // force a fresh connection with the new settings
  return next;
}

/* what the admin panel is allowed to see — never the password itself */
function publicMailSettings() {
  const saved = readSavedSettings();
  const cfg = getMailConfig();
  return {
    configured: Boolean(cfg),
    source: cfg ? cfg.source : 'none',
    user: saved.user || (cfg && cfg.source === 'env' ? cfg.user : ''),
    hasPass: Boolean(saved.pass),
    ownerEmail: saved.ownerEmail || (cfg ? cfg.ownerEmail : ''),
    fromName: saved.fromName || 'عطور الريحان',
    host: saved.host || 'smtp.gmail.com',
    port: saved.port || 465,
    secure: typeof saved.secure === 'boolean' ? saved.secure : true
  };
}

let transporter = null;
let transporterKey = null;

function getTransporter() {
  const cfg = getMailConfig();
  if (!cfg) return null;
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass]);
  if (key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      // fail fast when offline instead of hanging for minutes — the queue retries later
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
    transporterKey = key;
  }
  return transporter;
}

/* turns Gmail's cryptic errors into a clear Arabic hint for the admin panel */
function explainMailError(err) {
  const msg = String((err && err.message) || err || '');
  if (/535|BadCredentials|Username and Password not accepted|Invalid login/i.test(msg)) {
    return 'Gmail رفض كلمة مرور التطبيق — أنشئ كلمة مرور تطبيق جديدة من حساب Google وأدخلها هنا.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout|ENETUNREACH/i.test(msg)) {
    return 'لا يوجد اتصال بخادم البريد (الإنترنت مقطوع؟) — سيُعاد الإرسال تلقائياً عند عودة الاتصال.';
  }
  return msg;
}

function initMailer() {
  const cfg = getMailConfig();
  if (!cfg) {
    console.warn('  ⚠️  البريد غير مضبوط — الطلبات تُحفظ وتنتظر الإرسال.');
    console.warn('      اضبطه من لوحة الإدارة ← تبويب "البريد".\n');
    return;
  }
  getTransporter();
  console.log(`  📧 البريد: ${cfg.user} ← الإشعارات إلى ${cfg.ownerEmail} (${cfg.source === 'panel' ? 'من لوحة الإدارة' : 'من ملف .env'})`);
}

async function verifyMailer() {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'البريد غير مضبوط' };
  try {
    await t.verify();
    console.log('  ✅ إعدادات البريد سليمة — إشعارات الطلبات مفعّلة.\n');
    return { ok: true };
  } catch (err) {
    // never disable mail permanently: the mail server may just be unreachable for now
    console.warn('  ⚠️  تعذر التحقق من إعدادات البريد الآن:', err.message);
    return { ok: false, error: explainMailError(err) };
  }
}

function fmtIQD(n) {
  return `${Number(n || 0).toLocaleString('en-US')} د.ع`;
}

const DELIVERY_LABELS = { delivery: 'توصيل للمنزل', pickup: 'استلام من الفرع' };
const PAYMENT_LABELS = {
  cod: 'الدفع عند الاستلام',
  zaincash: 'زين كاش / آسيا حوالة',
  bank: 'تحويل بنكي'
};
const BRANCH_LABELS = { 'البلديات': 'فرع حي البلديات', 'المثنى': 'فرع حي المثنى' };

function buildOrderEmailHTML(order) {
  const rows = order.items.map(it => `
    <tr>
      <td style="padding:10px 12px; border-bottom:1px solid #E5E0D4;">${it.ar}</td>
      <td style="padding:10px 12px; border-bottom:1px solid #E5E0D4; text-align:center;">${it.qty}</td>
      <td style="padding:10px 12px; border-bottom:1px solid #E5E0D4; text-align:left; white-space:nowrap;">${fmtIQD(it.lineTotal)}</td>
    </tr>`).join('');

  const deliveryLine = order.deliveryMethod === 'pickup'
    ? `<p style="margin:6px 0;"><b>الاستلام:</b> ${DELIVERY_LABELS.pickup} — ${BRANCH_LABELS[order.branch] || order.branch || ''}</p>`
    : `<p style="margin:6px 0;"><b>الاستلام:</b> ${DELIVERY_LABELS.delivery}${order.address ? ` — ${order.address}` : ''}</p>`;

  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif; background:#0C0B09; padding:24px; color:#EFE8D8;">
    <div style="max-width:620px; margin:0 auto; background:#161310; border:1px solid rgba(201,162,39,0.35); border-radius:10px; overflow:hidden;">
      <div style="background:#1D1712; padding:20px 24px; border-bottom:1px solid rgba(201,162,39,0.35);">
        <h1 style="margin:0; font-size:20px; color:#E9C766;">طلب جديد — عطور الريحان</h1>
        <p style="margin:6px 0 0; font-size:12px; color:#B8AF9C;">رقم الطلب: ${order.id}</p>
      </div>

      <div style="padding:22px 24px; font-size:14px; line-height:1.9;">
        <p style="margin:6px 0;"><b>الاسم:</b> ${order.name}</p>
        <p style="margin:6px 0;"><b>الهاتف:</b> ${order.phone}</p>
        ${deliveryLine}
        <p style="margin:6px 0;"><b>طريقة الدفع:</b> ${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</p>
        ${order.notes ? `<p style="margin:6px 0;"><b>ملاحظات الزبون:</b> ${order.notes}</p>` : ''}

        <table style="width:100%; border-collapse:collapse; margin-top:18px; font-size:13.5px; background:#0C0B09; border:1px solid #2A241C;">
          <thead>
            <tr style="background:#1D1712; color:#E9C766;">
              <th style="padding:10px 12px; text-align:right;">العطر</th>
              <th style="padding:10px 12px; text-align:center;">الكمية</th>
              <th style="padding:10px 12px; text-align:left;">المجموع</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="margin-top:16px; font-size:13.5px; color:#B8AF9C;">
          <div style="display:flex; justify-content:space-between; padding:3px 0;"><span>مجموع المنتجات</span><span>${fmtIQD(order.subtotal != null ? order.subtotal : order.total)}</span></div>
          <div style="display:flex; justify-content:space-between; padding:3px 0;"><span>رسوم التوصيل</span><span>${order.deliveryFee ? fmtIQD(order.deliveryFee) : 'مجاناً (استلام من الفرع)'}</span></div>
        </div>
        <p style="margin-top:12px; font-size:17px; color:#E9C766;"><b>الإجمالي: ${fmtIQD(order.total)}</b></p>
        <p style="margin-top:20px; font-size:11.5px; color:#8A7433;">
          تم إرسال هذا الإشعار تلقائياً من موقع عطور الريحان بتاريخ ${new Date(order.createdAt).toLocaleString('ar-IQ')}.
        </p>
      </div>
    </div>
  </div>`;
}

function buildOrderEmailText(order) {
  const lines = order.items.map(it => `- ${it.ar} × ${it.qty} = ${fmtIQD(it.lineTotal)}`).join('\n');
  const place = order.deliveryMethod === 'pickup'
    ? `${DELIVERY_LABELS.pickup} — ${BRANCH_LABELS[order.branch] || order.branch || ''}`
    : `${DELIVERY_LABELS.delivery}${order.address ? ` — ${order.address}` : ''}`;
  return [
    `طلب جديد — عطور الريحان`,
    `رقم الطلب: ${order.id}`,
    ``,
    `الاسم: ${order.name}`,
    `الهاتف: ${order.phone}`,
    `الاستلام: ${place}`,
    `طريقة الدفع: ${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}`,
    order.notes ? `ملاحظات: ${order.notes}` : '',
    ``,
    `المنتجات:`,
    lines,
    ``,
    `مجموع المنتجات: ${fmtIQD(order.subtotal != null ? order.subtotal : order.total)}`,
    `رسوم التوصيل: ${order.deliveryFee ? fmtIQD(order.deliveryFee) : 'مجاناً (استلام من الفرع)'}`,
    `الإجمالي: ${fmtIQD(order.total)}`
  ].filter(Boolean).join('\n');
}

/* Sends the new-order notification to the shop owner.
   Never throws — a mail failure must not break a real order. */
async function sendOrderEmail(order) {
  const cfg = getMailConfig();
  const t = getTransporter();
  if (!cfg || !t) return { sent: false, reason: 'البريد غير مضبوط' };
  try {
    const info = await t.sendMail({
      from: cfg.from,
      to: cfg.ownerEmail,
      subject: `طلب جديد #${order.id} — ${order.name} — ${fmtIQD(order.total)}`,
      text: buildOrderEmailText(order),
      html: buildOrderEmailHTML(order)
    });
    console.log(`  📧 تم إرسال إشعار الطلب ${order.id} إلى ${cfg.ownerEmail} (${info.messageId})`);
    return { sent: true };
  } catch (err) {
    console.error(`  ❌ فشل إرسال إيميل الطلب ${order.id}:`, err.message);
    return { sent: false, reason: explainMailError(err) };
  }
}

/* a short test message so the owner can confirm everything works */
async function sendTestEmail() {
  const cfg = getMailConfig();
  const t = getTransporter();
  if (!cfg || !t) return { sent: false, error: 'البريد غير مضبوط' };
  try {
    await t.sendMail({
      from: cfg.from,
      to: cfg.ownerEmail,
      subject: 'رسالة تجريبية — عطور الريحان',
      text: 'إعدادات البريد تعمل. ستصلك إشعارات الطلبات الجديدة على هذا العنوان.',
      html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">✅ إعدادات البريد تعمل.<br>ستصلك إشعارات الطلبات الجديدة على هذا العنوان.</div>'
    });
    return { sent: true, to: cfg.ownerEmail };
  } catch (err) {
    return { sent: false, error: explainMailError(err) };
  }
}

/* sign-up verification code by email */
function isMailConfigured() {
  return Boolean(getMailConfig());
}

async function sendOtpEmail(to, code) {
  const cfg = getMailConfig();
  const t = getTransporter();
  if (!cfg || !t) throw new Error('mail is not configured');
  const html = `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif; background:#F7F3E9; padding:24px; color:#2A241C;">
    <div style="max-width:460px; margin:0 auto; background:#FFFDF7; border:1px solid rgba(166,124,30,0.35); border-radius:10px; padding:28px 24px; text-align:center;">
      <h1 style="margin:0 0 6px; font-size:20px; color:#8A6414;">عطور الريحان</h1>
      <p style="margin:0 0 20px; font-size:13px; color:#6E6354;">كود التحقق الخاص بك لإنشاء الحساب أو تسجيل الدخول:</p>
      <div style="font-size:32px; font-weight:bold; letter-spacing:10px; color:#2A241C; background:#F1EADA; border-radius:8px; padding:14px 0; direction:ltr;">${code}</div>
      <p style="margin:18px 0 0; font-size:12px; color:#6E6354;">الكود صالح لمدة 5 دقائق. إذا لم تطلب هذا الكود، تجاهل هذه الرسالة.</p>
    </div>
  </div>`;
  await t.sendMail({
    from: cfg.from,
    to,
    subject: `كود التحقق: ${code} — عطور الريحان`,
    text: `كود التحقق الخاص بك في عطور الريحان هو: ${code}\nصالح لمدة 5 دقائق.`,
    html
  });
}

module.exports = {
  initMailer, verifyMailer, sendOrderEmail, sendTestEmail, isMailConfigured, sendOtpEmail,
  saveMailSettings, publicMailSettings, getMailConfig
};
