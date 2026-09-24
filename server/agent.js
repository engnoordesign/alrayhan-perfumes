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
// prompts are now small (~600 tokens), so a small window is plenty and much faster on CPUs
const NUM_CTX = Math.min(parseInt(process.env.OLLAMA_NUM_CTX, 10) || 2048, 4096);
// cap the answer length: short replies are what customers want, and each token costs time
const MAX_TOKENS = parseInt(process.env.OLLAMA_MAX_TOKENS, 10) || 220;
const REQUEST_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 180000;
// keep the model loaded in memory so replies never wait for a cold start (-1 = forever)
const KEEP_ALIVE_RAW = String(process.env.OLLAMA_KEEP_ALIVE || '-1').trim();
// Ollama wants a plain number (seconds, -1 = forever) or a duration like "24h" — never the text "-1"
const KEEP_ALIVE = /^-?\d+$/.test(KEEP_ALIVE_RAW) ? Number(KEEP_ALIVE_RAW) : KEEP_ALIVE_RAW;
const MAX_DETAILED_PRODUCTS = 5;

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
  'the a an is are of for to and or which what best better compare between perfume ' +
  'do does you your have has any in on stock available there please want need me my i we it this that ' +
  'how much price cost'
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

function isInStock(p) {
  return !(p.available === false || (typeof p.qty === 'number' && p.qty <= 0));
}

/* one compact line per product — every token here costs time on a CPU */
function productLine(p, brandLabel, withPyramid) {
  const flags = [p.original ? 'أصلي مستورد' : '', p.limited ? 'نسخة محدودة' : ''].filter(Boolean).join('، ');
  const pyr = withPyramid && p.pyramid
    ? ` | مقدمة: ${p.pyramid.top && p.pyramid.top.notes || '-'}، قلب: ${p.pyramid.heart && p.pyramid.heart.notes || '-'}، قاعدة: ${p.pyramid.base && p.pyramid.base.notes || '-'}`
    : '';
  return `- ${p.ar}${p.name ? ` (${p.name})` : ''} | ${brandLabel} | ${fmtIQD(p.priceNum)} | ${p.vol || ''} | ${stockLabel(p)}${flags ? ' | ' + flags : ''} | ${String(p.notes || '').slice(0, 90)}${pyr}`;
}

/* ---------- what is the customer asking? ---------- */
const INTENT_WORDS = {
  stock: ['متوفر', 'متوفره', 'موجود', 'موجوده', 'عندكم', 'عدكم', 'اكو', 'يتوفر', 'توفر', 'نفذ', 'نفذت', 'خلص', 'خلصان', 'باقي', 'available', 'in stock', 'stock', 'do you have'],
  outList: ['غير متوفر', 'الغير متوفر', 'نافذ', 'نفذت', 'خلصان', 'مو متوفر', 'ما متوفر', 'out of stock', 'sold out'],
  cheap: ['ارخص', 'رخيص', 'اقل سعر', 'cheapest', 'cheap'],
  pricey: ['اغلى', 'غالي', 'افخم', 'most expensive'],
  notes: ['نوتات', 'مكونات', 'هرم', 'ريحته', 'رائحته', 'ريحتها', 'notes'],
  compare: ['قارن', 'مقارنه', 'الفرق', 'فرق', 'افضل من', 'احسن من', 'compare', 'vs']
};
function hasAny(nq, words) {
  const padded = ` ${nq} `;
  return words.some(w => padded.includes(norm(w)));
}

/* products the customer named explicitly (strong, unambiguous matches).
   Customers shorten names ("بلو دايموند" for "بلو أكوا دايموند"), so besides
   exact names we also look at each PAIR of neighbouring words: if only one
   or two perfumes contain both words, that pair names them. */
function namedProducts(question) {
  const nq = norm(question);
  const products = readTable('products');
  const nameTexts = products.map(p => ' ' + norm(`${p.ar} ${p.name || ''}`) + ' ');
  const has = (i, t) => nameTexts[i].includes(' ' + t) || (t.length >= 4 && nameTexts[i].includes(t));
  // keep the customer's word order (and repeats) so neighbouring pairs stay intact;
  // strip glued prefixes (و/ب/ف/ل/ال) when that turns a word into a name word
  const inAnyName = t => t.length >= 3 && !STOPWORDS.has(t) && nameTexts.some((_, i) => has(i, t));
  const nameWords = [...new Set(nameTexts.join(' ').split(' ').filter(w => w.length >= 4))];
  // tolerate one typo in longer words ("ساوفاج" → "سافاج")
  const fixTypo = w => {
    if (w.length < 5 || STOPWORDS.has(w)) return '';
    return nameWords.find(n => Math.abs(n.length - w.length) <= 1 && editDistance(n, w) <= (w.length >= 7 ? 2 : 1)) || '';
  };
  const qTokens = nq.split(' ').map(w => (/^[وبفل]/.test(w)
    ? [w, w.slice(1), w.startsWith('ال') ? w.slice(2) : '', w.startsWith('وال') ? w.slice(3) : '']
    : [w, w.startsWith('ال') ? w.slice(2) : '']).find(inAnyName) || fixTypo(w)).filter(Boolean);
  const score = new Array(products.length).fill(0);

  // exact names — but "هواس" inside "هواس آيس" only counts for the longer one
  const exact = products.map(p => {
    const ar = norm(p.ar).replace(/ المعروف ب .*$/, ''), en = norm(p.name || '');
    return (ar.length > 2 && nq.includes(ar)) ? ar : (en.length >= 3 && (' ' + nq + ' ').includes(' ' + en + ' ')) ? en : '';
  });
  exact.forEach((e, i) => {
    if (e && !exact.some((o, j) => j !== i && o.length > e.length && o.includes(e))) score[i] += 100;
  });
  // a single word that only one perfume has ("ساڤاج", "كاربون")
  for (const t of qTokens) {
    const owners = products.map((_, i) => i).filter(i => has(i, t));
    if (owners.length === 1) score[owners[0]] += 60;
  }
  // neighbouring word pairs ("بلو دايموند", "كلوب نوي")
  for (let k = 0; k < qTokens.length - 1; k++) {
    const [t1, t2] = [qTokens[k], qTokens[k + 1]];
    if (t1 === t2 || t2.endsWith(t1) || t1.endsWith(t2)) continue;
    const owners = products.map((_, i) => i).filter(i => has(i, t1) && has(i, t2));
    if (owners.length && owners.length <= 2) owners.forEach(i => { score[i] += 50; });
  }
  const hits = products.map((p, i) => ({ p, score: score[i] })).filter(h => h.score >= 50).sort((a, b) => b.score - a.score);
  if (!hits.length) return [];
  const best = hits[0].score;
  return hits.filter(h => h.score >= Math.min(best * 0.5, 50)).slice(0, 4).map(h => h.p);
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/* does the question mention any perfume-name word or brand at all? */
function mentionsCatalog(question) {
  const products = readTable('products'), brands = readTable('brands');
  const hay = ' ' + norm(products.map(p => `${p.ar} ${p.name || ''}`).join(' ') + ' ' +
    brands.map(b => `${b.label} ${b.key} ${b.tag || ''}`).join(' ')) + ' ';
  return norm(question).split(' ').some(w => w.length >= 3 && !STOPWORDS.has(w) &&
    [w, w.slice(1), w.startsWith('ال') ? w.slice(2) : ''].some(v => v.length >= 3 && hay.includes(' ' + v)));
}

/* in-stock perfumes closest to one that's sold out (same brand, shared notes) */
function alternativesFor(p, exclude) {
  const products = readTable('products');
  const noteWords = new Set(tokens(`${p.notes || ''}`).filter(t => t.length >= 4));
  return products
    .filter(x => x.id !== p.id && isInStock(x) && !exclude.has(x.id))
    .map(x => {
      let sc = x.brand === p.brand ? 3 : 0;
      for (const t of tokens(x.notes || '')) if (noteWords.has(t)) sc += 1;
      sc -= Math.abs((x.priceNum || 0) - (p.priceNum || 0)) / 50000;
      return { x, sc };
    })
    .sort((a, b) => b.sc - a.sc).slice(0, 3).map(r => r.x);
}

/* Builds the store facts for THIS question. The server checks stock
   itself, so the model only has to phrase an answer that is already
   correct — it never guesses availability. */
function buildFacts(question, history) {
  const products = readTable('products');
  const brands = readTable('brands');
  const brandLabel = p => { const b = brands.find(x => x.key === p.brand); return b ? b.label : p.brand; };
  const nq = norm(question);
  const lines = [];

  const named = namedProducts(question);
  const askStock = hasAny(nq, INTENT_WORDS.stock);
  const askOutList = hasAny(nq, INTENT_WORDS.outList) && !named.length;

  if (named.length) {
    lines.push('حالة التوفر الآن (من المخزون — انقلها كما هي؛ إذا ذكر الزبون ماركة ثانية وضّح أن هذا هو الموجود عندنا بهذا الاسم):');
    for (const p of named) {
      lines.push(isInStock(p)
        ? `- ${p.ar}: ✅ ${stockLabel(p)} — ${fmtIQD(p.priceNum)}، ${p.vol || ''}`
        : `- ${p.ar}: ❌ نفذت الكمية حالياً (يقدر الزبون يطلبه طلب مسبق من الموقع)`);
    }
  } else if (askStock && !askOutList && !hasAny(nq, INTENT_WORDS.cheap) && !hasAny(nq, INTENT_WORDS.pricey)) {
    // asked about the availability of something that isn't in the catalog at all
    if (!mentionsCatalog(question)) lines.push('حالة التوفر: العطر الذي يسأل عنه الزبون غير موجود في متجرنا. قل ذلك بوضوح واقترح بديلاً متوفراً من القائمة أدناه.');
  }

  if (askOutList) {
    const out = products.filter(p => !isInStock(p));
    lines.push(out.length
      ? `العطور غير المتوفرة حالياً (${out.length}): ${out.slice(0, 15).map(p => p.ar).join('، ')}`
      : 'كل العطور متوفرة حالياً، لا يوجد عطر نافذ.');
  }

  let list;
  if (hasAny(nq, INTENT_WORDS.cheap)) {
    list = products.filter(isInStock).sort((a, b) => a.priceNum - b.priceNum).slice(0, MAX_DETAILED_PRODUCTS);
    lines.push('أرخص العطور المتوفرة:');
  } else if (hasAny(nq, INTENT_WORDS.pricey)) {
    list = products.filter(isInStock).sort((a, b) => b.priceNum - a.priceNum).slice(0, MAX_DETAILED_PRODUCTS);
    lines.push('أغلى العطور المتوفرة:');
  } else {
    const seen = new Set(named.map(p => p.id));
    // a sold-out perfume the customer asked for → offer the closest ones in stock
    const alts = [];
    for (const p of named) if (!isInStock(p)) for (const a of alternativesFor(p, seen)) { seen.add(a.id); alts.push(a); }
    const related = named.length ? [] : retrieveProducts(question, history);
    list = named.concat(alts, related.filter(p => !seen.has(p.id))).slice(0, Math.max(named.length, MAX_DETAILED_PRODUCTS));
    lines.push(alts.length ? 'العطور المطلوبة وبدائل متوفرة قريبة منها:' : 'العطور ذات الصلة:');
  }
  const detailed = list.length <= 2 || hasAny(nq, INTENT_WORDS.notes) || hasAny(nq, INTENT_WORDS.compare);
  for (const p of list) lines.push(productLine(p, brandLabel(p), detailed && (named.includes(p) || list.length <= 2)));
  return lines.join('\n');
}

/* The system prompt never changes between questions, so Ollama keeps it
   cached and only has to read the short facts + question each time. */
function buildSystemPrompt() {
  const brands = readTable('brands').sort((a, b) => a.order - b.order).map(b => b.label).join('، ');
  return `أنت "لايت"، مساعد المبيعات لمتجر "عطور الريحان" في الموصل.
تكلّم بلهجة عراقية بسيطة ومهذبة (أو بالإنكليزية إذا كتب الزبون بالإنكليزية). ردك قصير: جملة إلى ثلاث جمل، أو قائمة قصيرة.

قواعد:
1. اعتمد فقط على "بيانات المتجر" المرفقة مع السؤال. لا تخترع عطراً أو سعراً أو نوتة.
2. "حالة التوفر" محسوبة من المخزون الآن: انقلها كما هي بالضبط ولا تخمّن أبداً.
3. إذا العطر غير موجود أو نافذ، قل ذلك بوضوح واقترح بديلاً متوفراً من البيانات.
4. اذكر اسم العطر كما هو مكتوب مع سعره.
5. عند المقارنة أعطِ رأياً واضحاً: أيهما أنسب ولماذا، من الوصف فقط.
6. الأسئلة البعيدة عن العطور: اعتذر بلطف وارجع للعطور.

معلومات المتجر:
- الفرعان: حي البلديات (شارع جامع سليمان، مقابل صيدلية الحرة) وحي المثنى (الشارع العام) — الموصل.
- التوصيل للمنزل 5,000 د.ع، والاستلام من الفرع مجاني.
- الدفع: عند الاستلام، زين كاش / آسيا حوالة، تحويل بنكي.
- واتساب: 07718302002.
- الخطوط: ${brands}.`;
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
    .slice(-4)                                            // last 2 exchanges are enough context
    .map(m => ({ role: m.role, content: m.content.slice(0, 300) }));
  const question = String(message || '').slice(0, 500);
  return [
    { role: 'system', content: buildSystemPrompt() },
    ...cleanHistory,
    { role: 'user', content: `بيانات المتجر:\n${buildFacts(question, cleanHistory)}\n\nسؤال الزبون: ${question}` }
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
async function openChatStream(message, history) {
  const model = await ensureModel();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: buildMessages(message, history),
      stream: true,
      keep_alive: KEEP_ALIVE,
      options: { temperature: 0.3, num_ctx: NUM_CTX, num_predict: MAX_TOKENS }
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

async function streamAgent(message, history, onToken) {
  let res;
  try {
    res = await openChatStream(message, history);
  } catch (e) {
    // Ollama may be restarting or the model was removed/renamed:
    // re-discover the model and try once more before giving up
    resolvedModel = null;
    await new Promise(r => setTimeout(r, 1000));
    try {
      res = await openChatStream(message, history);
    } catch (e2) {
      resolvedModel = null;
      throw e2;
    }
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

/* Makes sure Ollama is running and has a model, so Light works after any
   restart without anyone touching it:
   - Ollama not answering on this machine → start "ollama serve" ourselves
   - Ollama running but no model installed → download the configured one */
let ollamaSpawned = false;
let pullStarted = false;

function isLocalOllama() {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(OLLAMA_URL).hostname); }
  catch (e) { return false; }
}

async function ensureOllama() {
  let installed;
  try {
    installed = await listModels();
  } catch (e) {
    if (isLocalOllama() && !ollamaSpawned) {
      ollamaSpawned = true;
      try {
        const { spawn } = require('child_process');
        const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', err => console.warn('  ⚠️  تعذر تشغيل Ollama تلقائياً:', err.code === 'ENOENT' ? 'Ollama غير مثبّت على هذا الجهاز' : err.message));
        child.on('spawn', () => console.log('  🧠 Ollama لم يكن يعمل — تم تشغيله تلقائياً.'));
        child.unref();
        await new Promise(r => setTimeout(r, 3000)); // give it a moment to start listening
        return ensureOllama();
      } catch (err) { /* reported by the warm-up loop */ }
    }
    return;
  }
  if (!installed.length && !pullStarted) {
    pullStarted = true;
    console.log(`  🧠 لا يوجد نموذج في Ollama — جارٍ تنزيل ${CONFIGURED_MODEL} (مرة واحدة فقط، قد يأخذ دقائق)…`);
    fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIGURED_MODEL, stream: false })
    }).then(r => r.json())
      .then(j => { pullStarted = false; console.log(`  🧠 تنزيل ${CONFIGURED_MODEL}: ${j.status || j.error}`); })
      .catch(e => { pullStarted = false; console.warn('  ⚠️  فشل تنزيل النموذج:', e.message); });
  }
}

/* Loads the model into memory ahead of the first customer question, so the
   first reply isn't slowed by a cold start. Safe to call repeatedly. */
async function warmUpAgent() {
  await ensureOllama();
  try {
    const model = await ensureModel();
    // already loaded? then don't queue a request behind a customer's question
    const ps = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(4000) }).then(r => r.json()).catch(() => null);
    if (ps && Array.isArray(ps.models) && ps.models.some(m => m.name === model || m.model === model)) {
      return { ok: true, model, alreadyLoaded: true };
    }
    // load the model AND read the fixed system prompt once, so Ollama caches it
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, keep_alive: KEEP_ALIVE,
        messages: [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: 'مرحبا' }],
        options: { num_ctx: NUM_CTX, num_predict: 1 }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `Ollama ${res.status}: ${body.slice(0, 160)}` };
    return { ok: true, model };
  } catch (e) {
    resolvedModel = null;
    return { ok: false, error: e.message };
  }
}

/* Non-streaming convenience wrapper (used by the diagnostic script). */
async function askAgent(message, history) {
  return streamAgent(message, history, () => {});
}

module.exports = {
  checkAgentAvailable, streamAgent, askAgent, warmUpAgent, productsMentioned,
  retrieveProducts, buildSystemPrompt, buildFacts, buildMessages, namedProducts, OLLAMA_URL, CONFIGURED_MODEL, NUM_CTX
};
