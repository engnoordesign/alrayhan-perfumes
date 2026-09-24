const { readTable } = require('./db');

/* ---------------------------------------------------------
   Light Agent — a real local AI via Ollama (https://ollama.com).

   Why this design:
   - The full catalog is far too big to send on every message:
     Ollama's default context window (2–4k tokens) silently cuts
     off the start of the prompt, which is where the instructions
     live. So instead we RETRIEVE only the products relevant to
     the current question and send those, plus a compact overview
     of every brand.
   - Replies are STREAMED token-by-token so customers see Light
     "typing" instead of staring at a spinner on slow machines.
   - If the configured model isn't installed but another one is,
     we use that one rather than failing.
--------------------------------------------------------- */

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
const CONFIGURED_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX, 10) || 8192;
const REQUEST_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 180000;
const MAX_DETAILED_PRODUCTS = 12;

function fmtIQD(n) {
  return `${Number(n || 0).toLocaleString('en-US')} د.ع`;
}

/* ---------- Arabic-aware text normalisation for matching ---------- */
function norm(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')   // diacritics + tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ؤئ]/g, 'ي')
    .replace(/ڤ/g, 'ف')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(norm(
  'شنو شو ما ماذا هل في من على الى عن مع او و ب ل ك هذا هذه ذلك التي الذي انا انت احنا عندكم عندك عدكم ' +
  'اريد ابي ابغي بدي تنصحني تقترح اقترح افضل احسن بين قارن مقارنه الفرق عطر عطور ريحه ريحة لو اذا ليش ' +
  'الف الاف دينار د ع سعر بسعر ميزانيه ميزانيتي حدود تقريبا اقل اكثر من تحت فوق ' +
  'the a an is are of for to and or which what best better compare between perfume'
).split(' '));

/* Splits text into meaningful words. Arabic glues "و" (and) and "ب" (with)
   onto the next word ("وبلاك" = "and Black"), so we also emit the word
   with that prefix removed. */
function tokens(text) {
  const out = [];
  for (const t of norm(text).split(' ')) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(t);
    if (/^(و|ب|ف|ل)/.test(t) && t.length > 3) {
      const stripped = t.slice(1);
      if (!STOPWORDS.has(stripped)) out.push(stripped);
    }
    if (t.startsWith('ال') && t.length > 4) out.push(t.slice(2));
  }
  return [...new Set(out)];
}

/* Scent-family hints: common customer words → note words that appear in descriptions */
const FAMILY_HINTS = [
  { q: ['صيف', 'حار', 'منعش', 'خفيف', 'صباح', 'نهار', 'summer', 'fresh'], n: ['منعش', 'حمضي', 'حمضيات', 'مائي', 'بحري', 'ليمون', 'نعناع', 'برغموت'] },
  { q: ['شتاء', 'بارد', 'مساء', 'ليل', 'سهره', 'دافي', 'دافئ', 'winter', 'night'], n: ['دافئ', 'عنبر', 'فانيليا', 'خشب', 'توابل', 'كثيف', 'عود', 'تبغ'] },
  { q: ['عود', 'بخور', 'شرقي', 'oud'], n: ['عود', 'بخور', 'شرقي', 'عنبر'] },
  { q: ['نسائي', 'بنات', 'زوجتي', 'امي', 'اختي', 'حبيبتي', 'women'], n: ['زهري', 'نسائي', 'ورد', 'ياسمين', 'فاوانيا', 'انثوي'] },
  { q: ['رجالي', 'زوجي', 'ابي', 'اخوي', 'men'], n: ['رجالي', 'خشب', 'جلد', 'توابل'] },
  { q: ['عمل', 'دوام', 'مكتب', 'مقابله', 'رسمي', 'office'], n: ['نظيف', 'انيق', 'هادئ', 'خفيف', 'يومي', 'رسمي'] },
  { q: ['هديه', 'هدية', 'gift'], n: ['باقه', 'هدايا', 'تغليف'] },
  { q: ['ثبات', 'يدوم', 'قوي', 'long'], n: ['ثبات', 'كثيف', 'مكثف', 'اطول', 'قوي'] }
];

/* Checks the whole sentence (not exact words) so glued prefixes like
   "للصيف" ("for summer") still trigger the summer hint. */
function familyNoteTokens(text) {
  const nt = ' ' + norm(text) + ' ';
  const out = new Set();
  for (const fam of FAMILY_HINTS) {
    if (fam.q.some(w => nt.includes(norm(w)))) fam.n.forEach(n => out.add(norm(n)));
  }
  return out;
}

function parseBudget(text) {
  const m = String(text).match(/(\d{2,3}(?:[,.]\d{3})?)\s*(الف|ألف|k)?/i);
  if (!m) return null;
  let n = parseInt(m[1].replace(/[,.]/g, ''), 10);
  if (!n) return null;
  if (m[2] || n < 1000) n *= 1000;
  return n;
}

/* Scores every product against the question (+ recent conversation)
   and returns the most relevant ones to describe in detail. */
function retrieveProducts(question, history) {
  const products = readTable('products');
  const brands = readTable('brands');
  const recentUser = (Array.isArray(history) ? history : [])
    .filter(m => m && m.role === 'user').slice(-2).map(m => m.content).join(' ');
  const qTokens = tokens(question);
  const ctxTokens = tokens(recentUser);
  const noteHints = familyNoteTokens(`${question} ${recentUser}`);
  const budget = parseBudget(question);
  const nq = norm(question);

  // rarity weighting: a word that matches only one product name is a far
  // stronger signal than one shared by ten (e.g. "دايموند")
  const nameTexts = products.map(p => norm(`${p.ar} ${p.name || ''}`));
  const rarity = t => {
    const hits = nameTexts.filter(n => n.includes(t)).length;
    return hits ? 1 / hits : 0;
  };

  const scored = products.map(p => {
    const brand = brands.find(b => b.key === p.brand);
    const nameText = norm(`${p.ar} ${p.name || ''}`);
    const brandText = norm(brand ? `${brand.label} ${brand.tag || ''} ${brand.key}` : p.brand);
    const noteText = norm(`${p.notes || ''} ${p.pyramid ? Object.values(p.pyramid).map(l => l && l.notes).join(' ') : ''}`);
    let score = 0;

    // an exact product-name hit is the strongest signal
    if (nameText.length > 2 && nq.includes(nameText)) score += 40;
    for (const t of qTokens) {
      if (nameText.includes(t)) score += 6 + 30 * rarity(t);
      if (brandText.includes(t)) score += 8;
      if (noteText.includes(t)) score += 3;
    }
    for (const t of ctxTokens) {
      if (nameText.includes(t)) score += 5;
      if (brandText.includes(t)) score += 3;
    }
    for (const h of noteHints) if (noteText.includes(h)) score += 6;
    if (budget) score += p.priceNum <= budget ? 6 : -10;
    if (p.available === false || (typeof p.qty === 'number' && p.qty <= 0)) score -= 3;
    return { p, score };
  });

  let picked = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.p);

  // nothing matched (e.g. "hello" or a general question): give a small,
  // varied sample — the cheapest in-stock item from each brand
  if (!picked.length) {
    picked = brands.map(b => products
      .filter(p => p.brand === b.key && p.available !== false)
      .sort((a, c) => a.priceNum - c.priceNum)[0]).filter(Boolean);
  }
  return picked.slice(0, MAX_DETAILED_PRODUCTS);
}

function stockLabel(p) {
  if (typeof p.qty === 'number') {
    if (p.qty <= 0) return 'نفذت الكمية';
    if (p.qty <= 2) return `متبقي ${p.qty} فقط`;
    return 'متوفر';
  }
  return p.available === false ? 'غير متوفر' : 'متوفر';
}

function productLine(p, brandLabel) {
  const flags = [p.original ? 'أصلي مستورد' : '', p.limited ? 'نسخة محدودة' : ''].filter(Boolean).join('، ');
  const pyr = p.pyramid
    ? ` | الهرم: مقدمة (${p.pyramid.top && p.pyramid.top.notes || '-'})، قلب (${p.pyramid.heart && p.pyramid.heart.notes || '-'})، قاعدة (${p.pyramid.base && p.pyramid.base.notes || '-'})`
    : '';
  return `- ${p.ar}${p.name ? ` (${p.name})` : ''} | الخط: ${brandLabel} | ${fmtIQD(p.priceNum)} | ${p.vol || ''} | ${stockLabel(p)}${flags ? ' | ' + flags : ''}\n  الوصف: ${String(p.notes || '').slice(0, 160)}${pyr}`;
}

/* Compact one-line-per-brand overview, so the model always knows the
   full range of what's sold even when it only sees a few in detail. */
function brandOverview() {
  const products = readTable('products');
  const brands = readTable('brands').sort((a, b) => a.order - b.order);
  return brands.map(b => {
    const items = products.filter(p => p.brand === b.key);
    if (!items.length) return null;
    const prices = items.map(p => p.priceNum).filter(Boolean);
    const range = prices.length ? `${fmtIQD(Math.min(...prices))} – ${fmtIQD(Math.max(...prices))}` : '';
    const names = items.slice(0, 8).map(p => p.ar).join('، ') + (items.length > 8 ? `، و${items.length - 8} غيرها` : '');
    return `- ${b.label}: ${items.length} عطر، الأسعار ${range}. أمثلة: ${names}`;
  }).filter(Boolean).join('\n');
}

function buildSystemPrompt(question, history) {
  const brands = readTable('brands');
  const relevant = retrieveProducts(question, history);
  const detail = relevant.map(p => {
    const b = brands.find(x => x.key === p.brand);
    return productLine(p, b ? b.label : p.brand);
  }).join('\n');

  return `أنت "لايت"، مساعد المبيعات لمتجر "عطور الريحان" في الموصل.
تكلّم بالعربية بلهجة عراقية بسيطة ومهذبة (أو بالإنكليزية إذا سألك الزبون بالإنكليزية). اجعل ردك قصيراً: من جملتين إلى خمس جمل، أو قائمة قصيرة عند المقارنة.

قواعد إلزامية:
1. استخدم فقط المعلومات الموجودة أدناه. لا تخترع عطراً أو سعراً أو نوتة أو سياسة غير مذكورة.
2. إذا سُئلت عن عطر غير موجود في القوائم أدناه، قل بصراحة إنه غير متوفر لدينا حالياً واقترح بديلاً قريباً من القائمة.
3. عند ذكر أي عطر، اذكر اسمه كما هو مكتوب بالضبط مع سعره وحالته (متوفر/نفذت الكمية).
4. عند المقارنة أو التوصية، اشرح السبب اعتماداً على الوصف والنوتات المكتوبة فقط، ثم أعطِ رأياً واضحاً: أيّهما أنسب ولماذا.
5. لا تنصح بعطر نفذت كميته إلا مع التنبيه لذلك.
6. للأسئلة البعيدة عن العطور والمتجر، اعتذر بلطف وأعد الحديث إلى العطور.

معلومات المتجر:
- الفرعان: حي البلديات (شارع جامع سليمان، مقابل صيدلية الحرة) وحي المثنى (الشارع العام) — الموصل.
- التوصيل للمنزل برسوم ثابتة 5,000 د.ع، والاستلام من الفرع مجاني.
- الدفع: عند الاستلام، زين كاش / آسيا حوالة، تحويل بنكي.
- الاستبدال خلال فترة قصيرة إذا لم يُفتح العطر. للتواصل المباشر: واتساب 07718302002.

كل خطوط العطور في المتجر (نظرة عامة):
${brandOverview()}

العطور الأكثر صلة بسؤال الزبون (بيانات دقيقة ومحدّثة الآن):
${detail}`;
}

/* ---------- model discovery ---------- */
let resolvedModel = null;

async function listModels() {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json();
  return (data.models || []).map(m => m.name);
}

/* Picks the configured model if it's installed (with or without a
   ":tag"), otherwise falls back to the first installed model. */
function pickModel(installed) {
  const want = CONFIGURED_MODEL;
  const exact = installed.find(m => m === want || m === `${want}:latest`);
  if (exact) return exact;
  const prefix = installed.find(m => m.split(':')[0] === want.split(':')[0]);
  if (prefix) return prefix;
  return installed[0] || null;
}

async function checkAgentAvailable() {
  try {
    const installed = await listModels();
    const model = pickModel(installed);
    resolvedModel = model;
    return {
      available: !!model,
      reachable: true,
      model,
      configuredModel: CONFIGURED_MODEL,
      usingFallbackModel: !!model && model.split(':')[0] !== CONFIGURED_MODEL.split(':')[0],
      installedModels: installed
    };
  } catch (e) {
    resolvedModel = null;
    return { available: false, reachable: false, configuredModel: CONFIGURED_MODEL, error: e.message };
  }
}

async function ensureModel() {
  if (resolvedModel) return resolvedModel;
  const status = await checkAgentAvailable();
  if (!status.available) throw new Error(status.reachable ? 'no model installed in Ollama' : 'Ollama is not reachable');
  return resolvedModel;
}

function buildMessages(message, history) {
  const cleanHistory = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-6)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1200) }));
  const question = String(message || '').slice(0, 800);
  return [
    { role: 'system', content: buildSystemPrompt(question, cleanHistory) },
    ...cleanHistory,
    { role: 'user', content: question }
  ];
}

/* Products whose names appear in the model's reply — used to show
   tappable product cards under the answer. */
function productsMentioned(replyText) {
  const nr = norm(replyText);
  return readTable('products')
    .filter(p => {
      const a = norm(p.ar);
      const e = norm(p.name || '');
      return (a.length > 2 && nr.includes(a)) || (e.length > 3 && nr.includes(e));
    })
    .slice(0, 4)
    .map(p => p.id);
}

/* Streams a reply. onToken(text) is called as pieces arrive.
   Resolves with the full reply text. Throws on any failure. */
async function streamAgent(message, history, onToken) {
  const model = await ensureModel();
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildMessages(message, history),
        stream: true,
        keep_alive: '30m',
        options: { temperature: 0.4, num_ctx: NUM_CTX }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (e) {
    resolvedModel = null; // force a fresh check next time
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    resolvedModel = null;
    throw new Error(`Ollama returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let chunk;
      try { chunk = JSON.parse(line); } catch (e) { continue; }
      if (chunk.error) throw new Error(chunk.error);
      const piece = chunk.message && chunk.message.content;
      if (piece) { full += piece; onToken(piece); }
    }
  }
  if (!full.trim()) throw new Error('empty response from model');
  return full.trim();
}

/* Non-streaming convenience wrapper (used by the diagnostic script). */
async function askAgent(message, history) {
  return streamAgent(message, history, () => {});
}

module.exports = {
  checkAgentAvailable, streamAgent, askAgent, productsMentioned,
  retrieveProducts, buildSystemPrompt, OLLAMA_URL, CONFIGURED_MODEL, NUM_CTX
};
