const nodemailer = require('nodemailer');

/* ---------------------------------------------------------
   Mail setup.

   Configure these in server/.env :
     SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
     MAIL_FROM     - the "from" address shown on the email
     OWNER_EMAIL   - where new-order notifications are sent

   If SMTP is not configured, the server still works normally:
   orders are saved as usual and the email step is skipped with
   a console warning instead of crashing the checkout.
--------------------------------------------------------- */

let transporter = null;
let mailReady = false;

function initMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('  ⚠️  لم يتم ضبط إعدادات البريد (SMTP) — سيتم حفظ الطلبات بدون إرسال إيميل.');
    console.warn('      اضبط SMTP_HOST و SMTP_USER و SMTP_PASS في ملف server/.env لتفعيل الإشعارات.\n');
    return;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  mailReady = true;
}

function verifyMailer() {
  if (!transporter) return Promise.resolve(false);
  return transporter.verify()
    .then(() => { console.log('  ✅ إعدادات البريد سليمة — إشعارات الطلبات مفعّلة.\n'); return true; })
    .catch(err => {
      // don't permanently disable mail: the mail server may just be
      // temporarily unreachable. Each order will retry the send itself.
      console.warn('  ⚠️  تعذر التحقق من إعدادات البريد الآن:', err.message);
      console.warn('      سيُعاد المحاولة تلقائياً عند كل طلب جديد.\n');
      return false;
    });
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
  if (!mailReady || !transporter) {
    console.warn(`  ⚠️  الطلب ${order.id} حُفظ بدون إرسال إيميل (البريد غير مضبوط).`);
    return { sent: false, reason: 'not_configured' };
  }
  const to = process.env.OWNER_EMAIL;
  if (!to) {
    console.warn(`  ⚠️  الطلب ${order.id} حُفظ بدون إرسال إيميل (OWNER_EMAIL غير مضبوط).`);
    return { sent: false, reason: 'no_recipient' };
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: `طلب جديد #${order.id} — ${order.name} — ${fmtIQD(order.total)}`,
      text: buildOrderEmailText(order),
      html: buildOrderEmailHTML(order)
    });
    console.log(`  📧 تم إرسال إشعار الطلب ${order.id} إلى ${to} (${info.messageId})`);
    return { sent: true };
  } catch (err) {
    console.error(`  ❌ فشل إرسال إيميل الطلب ${order.id}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

/* sign-up verification code by email */
function isMailConfigured() {
  return Boolean(transporter);
}

async function sendOtpEmail(to, code) {
  if (!transporter) throw new Error('mail is not configured');
  const html = `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif; background:#F7F3E9; padding:24px; color:#2A241C;">
    <div style="max-width:460px; margin:0 auto; background:#FFFDF7; border:1px solid rgba(166,124,30,0.35); border-radius:10px; padding:28px 24px; text-align:center;">
      <h1 style="margin:0 0 6px; font-size:20px; color:#8A6414;">عطور الريحان</h1>
      <p style="margin:0 0 20px; font-size:13px; color:#6E6354;">كود التحقق الخاص بك لإنشاء الحساب أو تسجيل الدخول:</p>
      <div style="font-size:32px; font-weight:bold; letter-spacing:10px; color:#2A241C; background:#F1EADA; border-radius:8px; padding:14px 0; direction:ltr;">${code}</div>
      <p style="margin:18px 0 0; font-size:12px; color:#6E6354;">الكود صالح لمدة 5 دقائق. إذا لم تطلب هذا الكود، تجاهل هذه الرسالة.</p>
    </div>
  </div>`;
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `كود التحقق: ${code} — عطور الريحان`,
    text: `كود التحقق الخاص بك في عطور الريحان هو: ${code}\nصالح لمدة 5 دقائق.`,
    html
  });
}

module.exports = { initMailer, verifyMailer, sendOrderEmail, isMailConfigured, sendOtpEmail };
