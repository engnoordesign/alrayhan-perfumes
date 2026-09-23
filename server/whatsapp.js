/* ---------------------------------------------------------
   WhatsApp OTP — sends sign-up verification codes through the
   official WhatsApp Business Cloud API (Meta).

   Needs in .env:
     WHATSAPP_TOKEN            permanent access token (System User)
     WHATSAPP_PHONE_NUMBER_ID  the sender number's ID (not the number itself)
     WHATSAPP_OTP_TEMPLATE     approved "Authentication" template name
     WHATSAPP_TEMPLATE_LANG    template language code, e.g. ar or en_US
     WHATSAPP_OTP_BUTTON       true if the template has a "Copy code" button

   If WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is empty, isConfigured()
   is false and the server keeps its on-screen demo code instead.
   --------------------------------------------------------- */
const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

function isConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/* 07XXXXXXXXX / 7XXXXXXXXX / +9647XXXXXXXXX  ->  9647XXXXXXXXX (Iraq) */
function toInternational(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('964')) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return '964' + d;
}

async function sendOtp(phone, code) {
  if (!isConfigured()) throw new Error('WhatsApp is not configured');

  const components = [
    { type: 'body', parameters: [{ type: 'text', text: code }] }
  ];
  if (String(process.env.WHATSAPP_OTP_BUTTON || 'true').toLowerCase() !== 'false') {
    // authentication templates with a "Copy code" button need the code here too
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
  }

  const body = {
    messaging_product: 'whatsapp',
    to: toInternational(phone),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_OTP_TEMPLATE || 'otp_code',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'ar' },
      components
    }
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && (data.error.error_user_msg || data.error.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return { id: data.messages && data.messages[0] && data.messages[0].id };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, sendOtp, toInternational };
