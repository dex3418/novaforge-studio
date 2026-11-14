'use strict';
// The planner decides, for every scene, which scene type to draw and with what data,
// plus the overall template / palette / texture / transition.
//
// rulePlan()     = fixed rules (no AI, always available, same result every time)
// validatePlan() = makes any plan safe to render. The AI director will later write a
//                  plan in this same shape; anything invalid falls back to a plain caption.

const { FAMILIES, PALETTES, TEXTURES, TEMPLATES, TRANSITIONS, SCHEMES, DECORS, HEADERS, CSTYLES, ALIGNS, KINDS, EMOTIONS } = require('./catalog');
const { ICONS, pickIcon } = require('./icons');
const cal = require('./calibration');

const hash = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

// ------------------------------------------------------------ extraction helpers

const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)';
const DASH = '(?:[\\-\\u2010-\\u2015\\u2212]|\\bto\\b)';
const UNIT = '(?:\\s?(lakhs?|lacs?|crores?|cr\\b|thousand|million|billion|k\\b))?';
const SYM = `(?:\\u20B9|\\bRs\\.?)\\s?${NUM}${UNIT}(?:\\s*${DASH}\\s*(?:\\u20B9|\\bRs\\.?)?\\s?${NUM}${UNIT})?`;
const WORD = `${NUM}${UNIT}(?:\\s*${DASH}\\s*${NUM}${UNIT})?\\s*(?:rupees|rupee|rs\\b)`;
const SUFFIX = { lakh: ' Lakh', lac: ' Lakh', crore: ' Crore', cr: ' Crore', thousand: ' Thousand', million: ' Million', billion: ' Billion', k: 'K' };
const suffixOf = (u) => (u ? SUFFIX[String(u).toLowerCase().replace(/s$/, '')] || '' : '');
const AMT = new RegExp(`${SYM}|${WORD}`, 'gi');

function amounts(text) {
  const out = [];
  for (const m of String(text).matchAll(AMT)) {
    // SYM groups 1-5 (num, unit, num, unit), WORD groups 5-8 offset by the SYM branch
    const g = m.slice(1);
    const symB = g[0] !== undefined;
    const n1 = symB ? g[0] : g[4];
    const u1 = symB ? g[1] : g[5];
    const n2 = symB ? g[2] : g[6];
    const u2 = symB ? g[3] : g[7];
    const raw = [n1, n2].filter(Boolean);
    out.push({ values: raw.map((x) => parseFloat(x.replace(/,/g, ''))), suffix: suffixOf(u2 || u1), text: m[0], index: m.index });
  }
  return out;
}

function percents(text) {
  return [...String(text).matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)].map((m) => ({ value: parseFloat(m[1]), text: m[0], index: m.index }));
}

const sentences = (t) =>
  String(t)
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const words = (t) => String(t).split(/\s+/).filter(Boolean);
const strip = (s) => String(s).replace(/[\s.:;,\-–—]+$/, '').replace(/^[\s:;,\-–—]+/, '').trim();

function withFracs(items) {
  const total = items.reduce((a, s) => a + s.length, 0) || 1;
  let before = 0;
  return items.map((text) => {
    const o = { text: strip(text), frac: Math.min(0.95, before / total) };
    before += text.length;
    return o;
  });
}

function listItems(sc) {
  const paras = String(sc.body || '').split(/\n\n/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 3 && paras.length <= 6) return withFracs(paras);

  const full = `${sc.body || ''}`;
  const colon = full.match(/:\s*([^:]+?)[.!?]?$/);
  if (colon) {
    const parts = colon[1].split(/,(?!\d)|;|\band\b/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3 && parts.length <= 6 && parts.every((p) => words(p).length <= 8)) return withFracs(parts);
  }
  const ss = sentences(full);
  if (ss.length >= 3 && ss.length <= 5 && ss.every((s) => words(s).length <= 14)) return withFracs(ss);
  return null;
}

// ------------------------------------------------------------ per-scene decision

const CTA_RE = /\b(follow|subscribe|tap|click|link in|bio|share|comment|visit|download|join|contact|start training|sign up|apply now)\b/i;
const WARN_RE = /\b(warning|beware|careful|caution|scam|fraud|never|don'?t|do not|avoid|danger|mistake)\b/i;
const STRONG_WARN_RE = /\b(warning|beware|careful|caution|scam|fraud|danger|mistake)\b/i;
const NOTE_RE = /\b(note|tip|remember|reminder|good to know|pro tip|important)\b/i;
const STEP_RE = /\b(step|steps|first|then|next|finally|how to|process)\b/i;

function emotionOf(text) {
  if (/!/.test(text)) return 'excited';
  if (WARN_RE.test(text)) return 'serious';
  if (/\?/.test(text)) return 'curious';
  if (/\b(calm|relax|peace|slow|gentle|breathe)\b/i.test(text)) return 'calm';
  return 'neutral';
}

const RATE_DELTA = { excited: 6, serious: -6, curious: 2, calm: -4, neutral: 0 };
const STYLE = {
  excited: 'Say in an energetic, upbeat tone',
  serious: 'Say in a calm, serious tone',
  curious: 'Say in a curious, engaging tone',
  calm: 'Say in a warm, calm tone',
  neutral: 'Say clearly and naturally',
};

function decide(sc, i, n) {
  const heading = sc.heading || '';
  const body = sc.body || '';
  const all = `${heading} ${body}`.trim();
  const wc = words(sc.narration || all).length;
  const amts = amounts(all);
  const pcts = percents(all);
  const last = i === n - 1;

  if (last && n > 1 && CTA_RE.test(all)) {
    return { kind: 'cta', data: { text: heading || body, sub: heading ? body : '', button: '' } };
  }

  const mf = all.match(/myth\s*[:\-–—]\s*([\s\S]*?)\s*fact\s*[:\-–—]\s*([\s\S]*)/i);
  if (mf && strip(mf[1]) && strip(mf[2])) {
    const m = strip(mf[1]);
    const f = strip(mf[2]);
    return { kind: 'mythfact', data: { myth: m, fact: f, factFrac: m.length / (m.length + f.length) } };
  }

  if (/\?$/.test(heading.trim()) && body) {
    return { kind: 'qa', data: { q: heading.trim(), a: body, aFrac: heading.length / (heading.length + body.length) } };
  }
  const ss = sentences(body);
  if (ss.length >= 2 && /\?$/.test(ss[0])) {
    const a = ss.slice(1).join(' ');
    return { kind: 'qa', data: { q: ss[0], a, aFrac: ss[0].length / (ss[0].length + a.length) } };
  }

  const vs = heading.match(/^(.*?)\s+(?:vs\.?|versus)\s+(.*)$/i);
  if (vs && ss.length >= 2) {
    const half = Math.ceil(ss.length / 2);
    return {
      kind: 'compare',
      data: { left: { title: strip(vs[1]), text: ss.slice(0, half).join(' ') }, right: { title: strip(vs[2]), text: ss.slice(half).join(' ') } },
    };
  }
  const ba = body.match(/before\s*[:\-–]\s*([\s\S]*?)\s*after\s*[:\-–]\s*([\s\S]*)/i);
  if (ba) {
    return { kind: 'compare', data: { left: { title: 'Before', text: strip(ba[1]) }, right: { title: 'After', text: strip(ba[2]) } } };
  }

  const q = body.match(/^[“"‘]\s*([\s\S]+?)\s*[”"’]\s*(?:[—–\-]+\s*(.+))?$/);
  if (q || /^quote\b/i.test(heading)) {
    return { kind: 'quote', data: { text: q ? q[1] : body, author: q && q[2] ? strip(q[2]) : '' } };
  }

  const headStart = `${heading} ${words(body).slice(0, 6).join(' ')}`;
  if (wc <= 40 && (STRONG_WARN_RE.test(headStart) || WARN_RE.test(heading) || NOTE_RE.test(heading))) {
    return { kind: 'alert', data: { text: body || heading, tone: STRONG_WARN_RE.test(headStart) || WARN_RE.test(heading) ? 'warning' : 'note' } };
  }

  if (pcts.length === 1 && amts.length === 0 && wc <= 45) {
    const label = strip(heading.replace(pcts[0].text, '')) || strip(sentences(body)[0] || '');
    return { kind: 'progress', data: { value: pcts[0].value, label } };
  }

  if (amts.length === 1 && wc <= 45) {
    const a = amts[0];
    const label = strip(heading.replace(a.text, '')) || strip((sentences(body)[0] || '').replace(a.text, ''));
    return { kind: 'counter', data: { values: a.values, prefix: '₹', suffix: a.suffix || '', label, sub: body } };
  }

  const items = listItems(sc);
  if (items && STEP_RE.test(all)) return { kind: 'steps', data: { items } };
  if (items) return { kind: 'checklist', data: { items } };

  if (i === 0 && wc <= 26 && amts.length === 0) {
    return { kind: 'kinetic', data: { text: sc.narration || all } };
  }
  return { kind: 'caption', data: {} };
}

// what the plan may use from outside the script: pictures and who is speaking
const CTX = { pics: 0, person: '', role: '', meta: {} };
function setContext(parsed) {
  const m = (parsed && parsed.meta) || {};
  CTX.meta = m;
  CTX.pics = parsed && Array.isArray(parsed.pictures) ? parsed.pictures.length : 0;
  CTX.person = String(m.person || m.brand || '').trim();
  CTX.role = String(m.role || '').trim();
}

// ------------------------------------------------------------ seeded randomness
// Every run draws a fresh seed (recorded in the plan and report), so the same topic
// does not always get the same look. Put "seed: 123" in the script header to repeat a look.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffled = (arr, r) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ------------------------------------------------------------ template choice

const TEMPLATE_RULES = [
  ['budget', /₹|rupee|\bcost|price|budget|fee\b|save|afford|spend/gi],
  ['jobs', /recruit|vacanc|\bjob|apply|exam|police|bharti|career|syllabus|admit card|eligib/gi],
  ['steps', /\bstep|first|then|next|how to|guide|process/gi],
  ['myth', /\bmyth|\bfact\b|truth|misconception/gi],
  ['quote', /\bquote|\bsaid\b|inspir|“/gi],
  ['event', /\bdate\b|deadline|schedule|last day|register by|event|\bon \d/gi],
  ['news', /announc|breaking|notice|introducing/gi],
  ['explainer', /\bwhy\b|\bwhat is|explain|because|means|\bhow\b/gi],
  ['story', /story|journey|years ago|\bonce\b|began|founders?|started with/gi],
  ['finance', /invest|funding|revenue|profit|loan|\bbank|stock|returns?|crore|series [a-d]/gi],
  ['tech', /\bai\b|\bapp\b|software|startup|sensor|device|\bcode\b|\bdata\b|\bchip|cloud|tech|hardware/gi],
  ['education', /learn|study|exam|course|class|syllabus|tutorial|lesson|practice/gi],
  ['launch', /launch|introducing|new feature|release|available now|\bnew\b/gi],
  ['motivation', /dream|goal|never give up|success|hustle|believe|discipline|motivat/gi],
  ['lifestyle', /routine|habit|morning|health|\bhome\b|\bfood|travel|daily life/gi],
  ['review', /review|\bvs\b|compare|better|\bpros\b|\bcons\b|rating/gi],
  ['daily', /today|this week|\bupdate|latest|\bnews\b|report/gi],
  ['terminal', /\bcode\b|terminal|command|developer|\bgit\b|\bapi\b|deploy|debug|\bbug|repo|github|script|stack/gi],
  ['circuit', /embedded|hardware|\bchip|sensor|arduino|esp-?32|\biot\b|robot|circuit|microcontroller|raspberry|firmware/gi],
  ['founder', /founder|my journey|i started|i built|dantewada|vouchr|novaforge|our team|startup story|my story/gi],
  ['gallery', /photo|picture|gallery|moments|\bvisit|memories|behind the scenes|\bevent\b/gi],
];

function pickTemplate(text, r, hint = {}) {
  // your ratings count too: a liked template gets a bonus, a disliked one is dropped when there is a choice
  const scored = TEMPLATE_RULES.map(([id, re]) => [id, (text.match(re) || []).length + (hint.pics && id === 'founder' ? 2 : 0) + (hint.pics && id === 'gallery' ? 1 : 0)]).filter(([, n]) => n > 0).map(([id, n]) => [id, n + 2 * cal.score('template', id)]).sort((a, b) => b[1] - a[1]);
  const fine = scored.filter(([id]) => !cal.avoided('template', id));
  const list = fine.length ? fine : scored;
  if (!list.length || list[0][1] <= 0) {
    const pool = cal.pool('template', ['tips', 'explainer', 'story', 'tech', 'education', 'daily'], 2);
    return cal.order('template', shuffled(pool, r))[0];
  }
  const best = list[0][1];
  const top = list.filter(([, n]) => n >= best * 0.5).slice(0, 3);
  return top[Math.floor(r() * top.length)][0];
}

// ------------------------------------------------------------ segments and beats
// A scene's spoken text is cut into short numbered "lines" (a sentence, or part of a long
// sentence cut at a comma / "and" / "which"). Beats are groups of lines, each with its own
// visual, so one long scene shows a counter, then a line of kinetic text, then an icon...

const CONJ = new Set('and but which while because so then that plus or yet'.split(' '));

function splitLong(ws, max) {
  if (ws.length <= max) return [ws];
  const isBreak = (i) => /[,;:–—]$/.test(ws[i]) || (i + 1 < ws.length && CONJ.has(ws[i + 1].toLowerCase().replace(/[^a-z]/g, '')));
  const chunks = [];
  let start = 0;
  while (ws.length - start > max) {
    let cut = -1;
    for (let i = start + max - 1; i >= start + 4; i--) {
      if (isBreak(i)) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = start + max - 1;
    chunks.push(ws.slice(start, cut + 1));
    start = cut + 1;
  }
  const tail = ws.slice(start);
  if (tail.length < 4 && chunks.length) chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(tail);
  else chunks.push(tail);
  return chunks;
}

function segmentRanges(narration, maxWords = 16) {
  const out = [];
  let w = 0;
  for (const sentence of sentences(narration)) {
    for (const c of splitLong(words(sentence), maxWords)) {
      out.push({ text: c.join(' '), from: w, to: w + c.length });
      w += c.length;
    }
  }
  return out;
}

const tokens = (s) => String(s).toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
const numbersIn = (s) => new Set((String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => parseFloat(x.replace(/,/g, ''))));

// true when (almost) every word of `str` appears in the script text: the AI may pick and
// trim text for the screen, but never invent it.
function grounded(str, src, minRatio = 0.6) {
  const t = tokens(str).filter((w) => w.length >= 3 || /\d/.test(w));
  if (!t.length) return true;
  const have = new Set(tokens(src));
  const hit = t.filter((w) => have.has(w)).length;
  return hit / t.length >= minRatio && t.filter((w) => /\d/.test(w)).every((w) => have.has(w));
}

function strings(kind, d) {
  switch (kind) {
    case 'kinetic': case 'quote': case 'alert': case 'cta': return [d.text];
    case 'keyword': return [d.word, d.line];
    case 'spot': return [d.line];
    case 'qa': return [d.q, d.a];
    case 'mythfact': return [d.myth, d.fact];
    case 'compare': return [d.left && d.left.text, d.right && d.right.text];
    case 'checklist': case 'steps': return (d.items || []).map((i) => i && i.text);
    case 'stats': case 'bars': return (d.items || []).map((i) => i && i.label);
    case 'terminal': return (d.lines || []).map((l) => l && l.out);
    case 'photo': return [d.line];
    case 'profile': return [d.line];
    default: return [];
  }
}

const cap = (s, n) => words(s).slice(0, n).join(' ');

function groundedData(kind, d, src) {
  const have = numbersIn(src);
  if (kind === 'counter' && !d.values.every((v) => have.has(Number(v)))) return false;
  if (kind === 'progress' && !have.has(Number(d.value))) return false;
  if ((kind === 'stats' || kind === 'bars') && !d.items.every((i) => have.has(Number(i.value)))) return false;
  return strings(kind, d).every((x) => !x || grounded(x, src, 0.5));
}

function locate(text, beatText) {
  const hay = String(beatText).toLowerCase();
  const probe = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  let i = hay.indexOf(probe.slice(0, 18));
  if (i < 0) {
    const w = tokens(probe).find((x) => x.length >= 4);
    if (w) i = hay.indexOf(w);
  }
  return i < 0 ? null : Math.min(0.95, i / Math.max(1, hay.length));
}

// fills the timing fractions the renderer needs and trims anything too long for the screen
function finalize(kind, d, beatText) {
  const o = JSON.parse(JSON.stringify(d));
  const spread = (items, key) => {
    let prev = -1;
    items.forEach((it, i) => {
      let f = Number.isFinite(it.frac) ? it.frac : locate(it[key] || '', beatText);
      if (f == null) f = i / items.length;
      f = Math.max(f, prev + 0.02);
      it.frac = Math.min(0.95, f);
      prev = it.frac;
    });
  };
  if (kind === 'counter') {
    o.values = o.values.map(Number).slice(0, 2);
    o.prefix = isStr(o.prefix) ? String(o.prefix).slice(0, 3) : '';
    o.suffix = isStr(o.suffix) ? String(o.suffix).slice(0, 10) : '';
    o.label = isStr(o.label) ? cap(o.label, 9) : '';
  }
  if (kind === 'checklist' || kind === 'steps') {
    o.items = o.items.slice(0, 6).map((it) => ({ text: cap(it.text, 14), frac: it.frac }));
    spread(o.items, 'text');
  }
  if (kind === 'stats') {
    o.items = o.items.slice(0, 4).map((it) => ({ value: Number(it.value), prefix: isStr(it.prefix) ? String(it.prefix).slice(0, 3) : '', suffix: isStr(it.suffix) ? String(it.suffix).slice(0, 10) : '', label: cap(it.label, 5), frac: it.frac }));
    spread(o.items, 'label');
  }
  if (kind === 'bars') {
    o.items = o.items.slice(0, 5).map((it) => ({ value: Number(it.value), label: cap(it.label, 4), frac: it.frac }));
    o.prefix = isStr(o.prefix) ? String(o.prefix).slice(0, 3) : '';
    o.suffix = isStr(o.suffix) ? String(o.suffix).slice(0, 10) : '';
    spread(o.items, 'label');
  }
  if (kind === 'terminal') {
    o.lines = o.lines.slice(0, 8).map((l) => (isStr(l.cmd) ? { cmd: String(l.cmd).slice(0, 40), frac: l.frac } : { out: cap(l.out, 14), frac: l.frac }));
    let prev = -1;
    o.lines.forEach((l, i) => {
      let f = Number.isFinite(l.frac) ? l.frac : l.out ? locate(l.out, beatText) : null;
      if (f == null) f = i / o.lines.length;
      f = Math.max(f, prev + 0.02);
      l.frac = Math.min(0.95, f);
      prev = l.frac;
    });
  }
  if (kind === 'photo') {
    o.pic = Number.isInteger(Number(o.pic)) && Number(o.pic) >= 0 && Number(o.pic) < Math.max(1, CTX.pics) ? Number(o.pic) : 0;
    o.line = isStr(o.line) ? cap(o.line, 16) : '';
  }
  if (kind === 'profile') {
    o.pic = Number.isInteger(Number(o.pic)) && Number(o.pic) >= 0 && Number(o.pic) < Math.max(1, CTX.pics) ? Number(o.pic) : 0;
    o.name = CTX.person; // name and role come from the header, never from the AI
    o.role = CTX.role;
    o.line = isStr(o.line) ? cap(o.line, 16) : '';
  }
  if (kind === 'spot') {
    o.line = cap(o.line, 14);
    if (!ICONS[o.icon]) o.icon = pickIcon(o.line + ' ' + beatText) || 'star';
  }
  if (kind === 'qa') {
    o.q = cap(o.q, 22);
    o.a = cap(o.a, 40);
    if (!Number.isFinite(o.aFrac)) o.aFrac = locate(o.a, beatText) ?? 0.4;
  }
  if (kind === 'mythfact') {
    o.myth = cap(o.myth, 24);
    o.fact = cap(o.fact, 36);
    if (!Number.isFinite(o.factFrac)) o.factFrac = locate(o.fact, beatText) ?? 0.5;
  }
  if (kind === 'kinetic') {
    o.text = cap(o.text, 18);
    if (!['pop', 'slam', 'rise'].includes(o.style)) delete o.style;
  }
  if (kind === 'keyword') {
    o.word = cap(o.word, 2);
    o.line = isStr(o.line) ? cap(o.line, 14) : '';
  }
  if (kind === 'quote' || kind === 'alert') o.text = cap(o.text, 40);
  if (kind === 'cta') {
    o.text = cap(o.text, 24);
    o.sub = isStr(o.sub) ? cap(o.sub, 24) : '';
    o.button = isStr(o.button) ? cap(o.button, 6) : '';
  }
  if (kind === 'progress') {
    o.value = Number(o.value);
    o.label = isStr(o.label) ? cap(o.label, 9) : '';
  }
  if (kind === 'compare') {
    o.left = { title: cap(o.left.title, 4), text: cap(o.left.text, 30) };
    o.right = { title: cap(o.right.title, 4), text: cap(o.right.text, 30) };
  }
  return o;
}

// motion options an AI (or the box) may set for one beat/scene; invalid ones are dropped
function motionFields(g) {
  const o = {};
  if (TRANSITIONS.includes(g.transition)) o.transition = g.transition;
  if (SCHEMES.includes(g.scheme)) o.scheme = g.scheme;
  if (DECORS.includes(g.decor)) o.decor = g.decor;
  if (CSTYLES.includes(g.cstyle)) o.cstyle = g.cstyle;
  if (ALIGNS.includes(g.align)) o.align = g.align;
  if (ICONS[g.icon]) o.icon = g.icon;
  return o;
}

// ------------------------------------------------------------ pacing and motion
// Fills in whatever the plan left open. Each axis (colour, texture, animation, objects,
// caption look, colour scheme) is drawn on its own from a shuffled pool, so they do not
// move in lockstep. An "energy" curve keeps the start punchy, adds a pattern-interrupt
// every few beats so the middle never goes flat, and builds to the end.

const BOLD_T = ['bounce', 'spin', 'drop', 'circle', 'shake', 'elastic', 'rise'];
const SOFT_T = ['slide', 'wipe', 'zoom', 'split', 'blinds', 'swipeup', 'flip', 'fade'];
const BOLD_D = ['sparks', 'rings', 'confetti', 'comets', 'bars', 'shapes'];
const SOFT_D = ['orbs', 'sweep', 'waves', 'orbit', 'shapes'];
const NO_SCHEME = new Set(['photo', 'profile', 'terminal']);
const POP_OK = new Set(['counter', 'kinetic', 'alert', 'quote', 'progress', 'keyword', 'cta', 'mythfact', 'spot', 'stats']);
const A_CAPTION = ['bottom', 'center', 'top'];
const MID = { low: 0.32, mid: 0.48, high: 0.62 };

function energyAt(k, n, base) {
  const pos = n > 1 ? k / (n - 1) : 0;
  if (k < 2 || pos < 0.1) return 0.95;
  if (pos > 0.85) return 0.7 + 0.3 * ((pos - 0.85) / 0.15);
  if (k % 5 === 4) return 0.95; // pattern interrupt
  return base + 0.12 * Math.sin(pos * Math.PI * 7);
}

function assignMotion(plan, parsed, seed) {
  const r = rng(seed ^ 0x9e3779b9);
  const meta = parsed.meta || {};
  const tpl = TEMPLATES[plan.template] || TEMPLATES.tips;
  const fam = FAMILIES[tpl.family] || FAMILIES.night;

  const first = PALETTES[plan.palette] && (PALETTES[meta.palette] || !cal.avoided('palette', plan.palette)) ? plan.palette : cal.order('palette', fam)[0];
  const palOrder = [first, ...cal.pool('palette', cal.order('palette', shuffled(fam.filter((p) => p !== first), r)), 2)];
  const allTex = Object.keys(TEXTURES).filter((x) => x !== 'none');
  const t0 = TEXTURES[plan.texture] && plan.texture !== 'none' ? plan.texture : tpl.textures[0];
  const texOrder = [t0, ...cal.pool('texture', [...cal.order('texture', shuffled(tpl.textures.filter((x) => x !== t0), r)), ...cal.order('texture', shuffled(allTex.filter((x) => x !== t0 && !tpl.textures.includes(x)), r))], 6)];
  const fixedPal = PALETTES[meta.palette] ? meta.palette : null;
  const fixedTex = TEXTURES[meta.texture] ? meta.texture : null;

  plan.scenes.forEach((s, si) => {
    if (!PALETTES[s.palette]) s.palette = fixedPal || palOrder[si % palOrder.length];
    if (!TEXTURES[s.texture]) s.texture = fixedTex || texOrder[(si * 2) % texOrder.length];
  });
  plan.palette = plan.scenes[0].palette;
  plan.texture = plan.scenes[0].texture;

  const textOf = (s) => {
    const sc = parsed.scenes.find((x) => x.index === s.index);
    return sc ? sc.narration : '';
  };
  const units = [];
  plan.scenes.forEach((s) => {
    if (s.beats && s.beats.length > 1) s.beats.forEach((b) => units.push({ u: b, text: b.text || textOf(s) }));
    else units.push({ u: s, text: textOf(s) });
  });

  const base = MID[tpl.energy] || MID.mid;
  const n = units.length;
  let prevT = '';
  let prevScheme = 'base';
  let prevIcon = '';
  let prevD = '';
  units.forEach(({ u, text }, k) => {
    const e = energyAt(k, n, base);
    const high = e >= 0.85;
    if (!u.transition) {
      const pool = cal.pool('transition', (high ? BOLD_T : e > 0.55 ? BOLD_T.concat(SOFT_T) : SOFT_T).filter((x) => x !== prevT));
      u.transition = pool[Math.floor(r() * pool.length)];
    }
    prevT = u.transition;
    if (!u.scheme) {
      let sch = 'base';
      if (NO_SCHEME.has(u.kind)) u.scheme = 'base';
    }
    if (!u.scheme) {
      let sch = 'base';
      const roll = r();
      if (high) sch = POP_OK.has(u.kind) ? 'pop' : 'flip';
      else if (roll < 0.15 + (e > 0.55 ? 0.1 : 0)) sch = POP_OK.has(u.kind) ? 'pop' : 'flip';
      else if (roll < 0.38) sch = 'flip';
      if (sch !== 'base' && sch === prevScheme) sch = 'base';
      u.scheme = sch;
    }
    prevScheme = u.scheme;
    if (!u.decor) {
      const pool = plan.decor ? [plan.decor] : cal.pool('decor', (high ? BOLD_D : e > 0.55 ? BOLD_D.concat(SOFT_D) : SOFT_D).filter((x) => x !== prevD));
      u.decor = pool[Math.floor(r() * pool.length)];
    }
    prevD = u.decor;
    if (!u.cstyle) u.cstyle = CSTYLES[Math.floor(r() * CSTYLES.length)];
    if (!u.align) u.align = u.kind === 'caption' ? A_CAPTION[Math.floor(r() * A_CAPTION.length)] : 'center';
    if (!u.icon) {
      const ic = pickIcon(text);
      if (ic && ic !== prevIcon && r() < 0.75) u.icon = ic;
    }
    if (u.icon) prevIcon = u.icon;
    u.energy = Math.round(e * 100) / 100;
  });
}

// raw beats (line ranges) -> checked beats with word ranges, or null
function normalizeBeats(g, sc, trust, diag) {
  const raw = Array.isArray(g.beats) ? g.beats.filter((b) => b && typeof b === 'object') : [];
  if (!raw.length || raw.length > 40) {
    if (diag && Array.isArray(g.beats)) diag.push({ scene: sc.index, reason: `${raw.length} beats (need 1 to 40)` });
    return null;
  }
  const rng_ = segmentRanges(sc.narration);
  if (rng_.length < 1) return null;
  const sorted = raw
    .map((b) => ({ ...b, a: Number(b.fromSentence), z: Number(b.toSentence) }))
    .sort((x, y) => x.a - y.a);
  let at = 0;
  for (const b of sorted) {
    if (!Number.isInteger(b.a) || !Number.isInteger(b.z) || b.a !== at || b.z <= b.a || b.z > rng_.length) {
      if (diag) diag.push({ scene: sc.index, reason: `beat ranges do not line up with the ${rng_.length} lines` });
      return null;
    }
    at = b.z;
  }
  if (at !== rng_.length) {
    if (diag) diag.push({ scene: sc.index, reason: `beats cover ${at} of ${rng_.length} lines` });
    return null;
  }

  const ws = words(sc.narration);
  const src = `${sc.heading} ${sc.body} ${sc.narration}`;
  const mk = (a, z, kind, data, extra) => {
    const from = rng_[a].from;
    const to = rng_[z - 1].to;
    return { ...extra, fromSentence: a, toSentence: z, from, to, kind, data, text: ws.slice(from, to).join(' ') };
  };
  const SPLITTABLE = new Set(['counter', 'progress', 'kinetic', 'keyword', 'spot', 'alert', 'quote']);
  // groups of lines up to `max` words
  const groups = (a, z, max) => {
    const out = [];
    let s0 = a;
    let w = 0;
    for (let i = a; i < z; i++) {
      const lw = rng_[i].to - rng_[i].from;
      if (i > s0 && w + lw > max) {
        out.push([s0, i]);
        s0 = i;
        w = 0;
      }
      w += lw;
    }
    out.push([s0, z]);
    return out;
  };

  const out = [];
  for (const b of sorted) {
    const text = ws.slice(rng_[b.a].from, rng_[b.z - 1].to).join(' ');
    const wcb = text.split(' ').length;
    let kind = KINDS.includes(b.kind) ? b.kind : 'caption';
    let data = b.data && typeof b.data === 'object' ? b.data : {};
    const why = !KINDS.includes(b.kind) ? `unknown kind "${b.kind}"` : !CHECK[kind](data) ? `${kind}: data missing or wrong shape` : !trust && !groundedData(kind, data, src) ? `${kind}: text or number not found in the script` : '';
    if (why) {
      if (diag && b.kind !== 'caption') diag.push({ scene: sc.index, reason: why });
      kind = 'caption';
      data = {};
    } else {
      data = finalize(kind, data, text);
    }
    const extra = {
      ...motionFields(b),
      emotion: EMOTIONS.includes(b.emotion) ? b.emotion : null,
      emphasis: Array.isArray(b.emphasis) ? b.emphasis.filter(isStr).slice(0, 8) : [],
    };
    // keep every beat short: long captions are cut into several, long single-point visuals
    // keep their first lines and hand the rest to kinetic text
    if (kind === 'caption' && wcb > 18) {
      for (const [a, z] of groups(b.a, b.z, 16)) out.push(mk(a, z, 'caption', {}, { ...extra, ...(out.length ? { transition: undefined, scheme: undefined, decor: undefined, icon: undefined } : {}) }));
      continue;
    }
    if (SPLITTABLE.has(kind) && wcb > 24 && b.z - b.a > 1) {
      const [head, ...rest] = groups(b.a, b.z, 16);
      out.push(mk(head[0], head[1], kind, data, extra));
      for (const [a, z] of rest) {
        const t = ws.slice(rng_[a].from, rng_[z - 1].to).join(' ');
        out.push(mk(a, z, 'kinetic', { text: cap(t, 18) }, { emotion: extra.emotion, emphasis: extra.emphasis }));
      }
      continue;
    }
    out.push(mk(b.a, b.z, kind, data, extra));
  }
  // merge neighbouring plain captions, but never into something long
  const merged = [];
  for (const b of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === 'caption' && b.kind === 'caption' && prev.to - prev.from + (b.to - b.from) <= 14) {
      prev.to = b.to;
      prev.toSentence = b.toSentence;
      prev.text = ws.slice(prev.from, prev.to).join(' ');
      continue;
    }
    merged.push(b);
  }
  if (merged.every((b) => b.kind === 'caption') && merged.length <= 1) return null;
  return merged;
}

// ------------------------------------------------------------ rule beats

const STOP = new Set('once when which that because and but from the a an of for to with while after before so as by in on is was are were will'.split(' '));
// a short label from the words right after the amount ("per unit", "grant")
function labelAfter(text, a) {
  const rest = text.slice(a.index + a.text.length).split(/[,.;:!?(]/)[0];
  const out = [];
  for (const w of words(rest)) {
    if (STOP.has(w.toLowerCase()) || out.length >= 3) break;
    out.push(w);
  }
  const l = out.join(' ');
  return l ? l[0].toUpperCase() + l.slice(1) : '';
}

function numbersOf(text) {
  const am = amounts(text).map((a) => ({ ...a, kind: 'amt' }));
  const pc = percents(text).map((p) => ({ ...p, kind: 'pct' }));
  return [...am, ...pc].sort((x, y) => x.index - y.index);
}

function groupLines(rng_) {
  const groups = [];
  let cur = null;
  rng_.forEach((r, i) => {
    const wc = r.to - r.from;
    const nums = numbersOf(r.text);
    const special = nums.length >= 1 && nums.length <= 4;
    if (special) {
      if (cur) groups.push(cur);
      groups.push({ a: i, z: i + 1, special: true });
      cur = null;
    } else if (cur && cur.words + wc <= 16 && cur.z - cur.a < 2) {
      cur.z = i + 1;
      cur.words += wc;
    } else {
      if (cur) groups.push(cur);
      cur = { a: i, z: i + 1, words: wc };
    }
  });
  if (cur) groups.push(cur);
  return groups;
}

function ruleBeats(sc) {
  const rng_ = segmentRanges(sc.narration);
  const wc = words(sc.narration).length;
  if (rng_.length < 2 || wc < 20) return null;
  let spots = 0;
  const beats = groupLines(rng_).map((g, gi) => {
    const text = rng_.slice(g.a, g.z).map((r) => r.text).join(' ');
    const nums = numbersOf(text);
    let kind = 'caption';
    let data = {};
    if (nums.length >= 2 && nums.length <= 4 && nums.every((x) => x.kind === 'pct' || x.values.length === 1)) {
      const items = nums.map((x) => ({ value: x.values ? x.values[0] : x.value, prefix: x.kind === 'amt' ? '₹' : '', suffix: x.kind === 'amt' ? x.suffix || '' : '%', label: labelAfter(text, x) }));
      if (items.every((i) => i.label) && new Set(items.map((i) => i.label.toLowerCase())).size === items.length) {
        kind = 'stats';
        data = { items };
      }
    } else if (nums.length === 1 && nums[0].kind === 'amt') {
      kind = 'counter';
      data = { values: nums[0].values, prefix: '₹', suffix: nums[0].suffix || '', label: labelAfter(text, nums[0]) };
    } else if (nums.length === 1 && nums[0].kind === 'pct') {
      kind = 'progress';
      data = { value: nums[0].value, label: labelAfter(text, nums[0]) };
    }
    if (kind === 'caption') {
      const w = words(text).length;
      const ic = w <= 11 && spots < 1 ? pickIcon(text, 2) : null;
      if (ic) {
        kind = 'spot';
        data = { icon: ic, line: text };
        spots++;
      } else if (gi % 3 !== 2 && w <= 18) {
        kind = 'kinetic';
        data = { text };
      }
    }
    return { fromSentence: g.a, toSentence: g.z, kind, data };
  });
  return beats;
}

// ------------------------------------------------------------ plans

const SPLIT_KINDS = new Set(['counter', 'progress', 'alert', 'kinetic', 'caption', 'quote']);

// picture and terminal beats (rules): swaps some plain caption / kinetic beats
function enrich(scenes, parsed, tpl) {
  const pics = CTX.pics;
  const usePics = pics > 0 && (tpl.pics || !!parsed.meta.picture);
  if (!usePics && !tpl.terminal) return;
  const units = [];
  scenes.forEach((s) => {
    const sc = parsed.scenes.find((x) => x.index === s.index);
    const segs = segmentRanges(sc.narration);
    if (s.beats && s.beats.length > 1) s.beats.forEach((b) => units.push({ u: b, text: segs.slice(b.fromSentence, b.toSentence).map((x) => x.text).join(' ') || sc.narration, sc }));
    else units.push({ u: s, text: sc.narration, sc });
  });
  if (units.length < 3) return;
  const segText = (t) => segmentRanges(t).map((x) => x.text);
  const slug = (h) => {
    const x = String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
    return x || 'note';
  };
  let photos = 0;
  let terms = 0;
  let profiled = false;
  const every = tpl.photoEvery || 4;
  let sinceP = 0;
  let sinceT = 0;
  units.forEach(({ u, text, sc }, k) => {
    const plain = u.kind === 'caption' || u.kind === 'kinetic';
    const wc = words(text).length;
    sinceP++;
    sinceT++;
    if (!plain || k === 0 || wc < 5) return;
    if (usePics && tpl.profile && !profiled && CTX.person && k >= 1) {
      profiled = true;
      u.kind = 'profile';
      u.data = { pic: 0, line: cap(segText(text)[0] || text, 14) };
      sinceP = 0;
      return;
    }
    if (usePics && sinceP >= every && wc <= 40) {
      u.kind = 'photo';
      u.data = { pic: photos % pics, line: cap(text, 14) };
      photos++;
      sinceP = 0;
      return;
    }
    if (tpl.terminal && sinceT >= 3 && wc >= 8 && wc <= 40) {
      const outs = segText(text).slice(0, 4).map((x) => ({ out: cap(x, 14) }));
      u.kind = 'terminal';
      u.data = { lines: [{ cmd: `cat ${slug(sc.heading)}.txt` }, ...outs] };
      terms++;
      sinceT = 0;
    }
  });
}

function rulePlan(parsed, opts = {}) {
  const meta = parsed.meta || {};
  const seed = Number.isFinite(Number(meta.seed)) && meta.seed !== '' && meta.seed != null ? Number(meta.seed) : opts.seed != null ? opts.seed : Math.floor(Math.random() * 2147483647);
  const r = rng(seed);
  const n = parsed.scenes.length;
  const text = `${parsed.title} ${parsed.scenes.map((s) => `${s.heading} ${s.body}`).join(' ')}`;

  setContext(parsed);
  const tid = TEMPLATES[meta.template] ? meta.template : pickTemplate(text, r, { pics: CTX.pics > 0 && !!meta.picture });
  const t = TEMPLATES[tid];

  const scenes = parsed.scenes.map((sc, i) => {
    const d = decide(sc, i, n);
    const emotion = emotionOf(`${sc.heading} ${sc.body}`);
    const emphasis = [...new Set((`${sc.heading} ${sc.body}`.match(/[^\s]*\d[^\s]*/g) || []).map((x) => x.replace(/[^\p{L}\p{N}]/gu, '')))].filter(Boolean);
    const long = words(sc.narration).length > 24;
    const beats = SPLIT_KINDS.has(d.kind) && (long || d.kind === 'caption') ? ruleBeats(sc) : null;
    return {
      index: sc.index, kind: d.kind, data: d.data, emotion, emphasis, beats,
      voice: { rateDelta: RATE_DELTA[emotion], style: STYLE[emotion] },
    };
  });

  enrich(scenes, parsed, t);
  return validatePlan({ version: 3, source: 'rules', seed, template: tid, palette: PALETTES[meta.palette] ? meta.palette : FAMILIES[t.family][0], texture: TEXTURES[meta.texture] ? meta.texture : t.textures[0], transition: 'slide', scenes }, parsed);
}

const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const okItems = (a, lo, hi, f) => Array.isArray(a) && a.length >= lo && a.length <= hi && a.every((i) => i && f(i));
const CHECK = {
  caption: () => true,
  kinetic: (d) => isStr(d.text),
  counter: (d) => Array.isArray(d.values) && d.values.length > 0 && d.values.every((v) => isFinite(Number(v))),
  checklist: (d) => okItems(d.items, 1, 8, (i) => isStr(i.text)),
  steps: (d) => okItems(d.items, 1, 8, (i) => isStr(i.text)),
  stats: (d) => okItems(d.items, 2, 4, (i) => isFinite(Number(i.value)) && isStr(i.label)),
  bars: (d) => okItems(d.items, 2, 5, (i) => isFinite(Number(i.value)) && isStr(i.label)),
  spot: (d) => isStr(d.line),
  terminal: (d) => okItems(d.lines, 1, 8, (l) => (isStr(l.cmd) && /^[\w.\-\/ ]{1,40}$/.test(String(l.cmd).trim())) || isStr(l.out)),
  photo: (d) => CTX.pics > 0 && (d.pic == null || (Number.isInteger(Number(d.pic)) && Number(d.pic) >= 0 && Number(d.pic) < CTX.pics)),
  profile: (d) => CTX.person.length > 0 && (d.pic == null || (Number.isInteger(Number(d.pic)) && Number(d.pic) >= 0 && Number(d.pic) < Math.max(1, CTX.pics))),
  keyword: (d) => isStr(d.word),
  quote: (d) => isStr(d.text),
  qa: (d) => isStr(d.q) && isStr(d.a),
  mythfact: (d) => isStr(d.myth) && isStr(d.fact),
  compare: (d) => d.left && d.right && isStr(d.left.title) && isStr(d.left.text) && isStr(d.right.title) && isStr(d.right.text),
  progress: (d) => isFinite(Number(d.value)) && Number(d.value) >= 0 && Number(d.value) <= 100,
  alert: (d) => isStr(d.text),
  cta: (d) => isStr(d.text),
};

// Makes any plan (rules or AI) safe: unknown things are replaced, never trusted.
// `fallback` = a validated rule plan; used wherever the given plan has nothing usable.
function validatePlan(plan, parsed, fallback, diag) {
  setContext(parsed);
  const p = plan && typeof plan === 'object' ? plan : {};
  const fb = fallback || null;
  const trust = p.source !== 'ai';
  const seed = Number.isFinite(Number(p.seed)) ? Number(p.seed) : fb && Number.isFinite(fb.seed) ? fb.seed : hash(parsed.slug || parsed.title);
  const tid = TEMPLATES[p.template] ? p.template : fb ? fb.template : 'tips';
  const out = {
    version: 3,
    source: p.source === 'ai' ? 'ai' : 'rules',
    seed,
    template: tid,
    palette: PALETTES[p.palette] ? p.palette : fb ? fb.palette : FAMILIES[TEMPLATES[tid].family][0],
    texture: TEXTURES[p.texture] ? p.texture : fb ? fb.texture : TEMPLATES[tid].textures[0],
    transition: TRANSITIONS.includes(p.transition) ? p.transition : 'slide',
    scenes: [],
    header: HEADERS.includes(p.header) ? p.header : fb && fb.header ? fb.header : HEADERS[seed % HEADERS.length],
    decor: DECORS.includes(p.decor) ? p.decor : null,
    captions: (parsed.meta && parsed.meta.captions === 'always') || p.captions === 'always' ? 'always' : 'smart',
  };
  const given = Array.isArray(p.scenes) ? p.scenes : [];
  parsed.scenes.forEach((sc, i) => {
    const g = given.find((x) => x && Number(x.index) === sc.index) || given[i] || {};
    const f = fb ? fb.scenes.find((x) => x.index === sc.index) : null;
    const src = `${sc.heading} ${sc.body} ${sc.narration}`;

    const nb = normalizeBeats(g, sc, trust, diag);
    let kind;
    let data;
    let beats;
    if (nb && nb.length === 1) {
      kind = nb[0].kind;
      data = nb[0].data;
    } else {
      const okOwn = KINDS.includes(g.kind) && g.data && typeof g.data === 'object' && CHECK[g.kind](g.data) && (trust || groundedData(g.kind, g.data, src));
      if (okOwn) {
        kind = g.kind;
        data = finalize(g.kind, g.data, sc.narration);
      } else if (f) {
        kind = f.kind;
        data = f.data;
      } else {
        kind = 'caption';
        data = {};
      }
      beats = nb || (f && f.beats) || undefined;
      // the carousel shows one visual per scene: let a picture / terminal beat represent a plain scene
      if (beats && ['caption', 'kinetic', 'keyword'].includes(kind)) {
        const pick = beats.find((x) => x.kind === 'profile') || beats.find((x) => x.kind === 'photo') || beats.find((x) => x.kind === 'terminal');
        if (pick) {
          kind = pick.kind;
          data = JSON.parse(JSON.stringify(pick.data));
        }
      }
    }
    const emotion = EMOTIONS.includes(g.emotion) ? g.emotion : f ? f.emotion : 'neutral';
    const v = g.voice && typeof g.voice === 'object' ? g.voice : {};
    const rd = Number.isFinite(Number(g.rateDelta)) ? Number(g.rateDelta) : Number.isFinite(Number(v.rateDelta)) ? Number(v.rateDelta) : f ? f.voice.rateDelta : RATE_DELTA[emotion];
    out.scenes.push({
      ...motionFields(g),
      ...(PALETTES[g.palette] ? { palette: g.palette } : {}),
      ...(TEXTURES[g.texture] ? { texture: g.texture } : {}),
      index: sc.index,
      kind,
      data,
      emotion,
      emphasis: Array.isArray(g.emphasis) ? g.emphasis.filter(isStr).slice(0, 12) : f ? f.emphasis : [],
      beats,
      voice: {
        rateDelta: Math.max(-15, Math.min(15, rd)),
        style: isStr(v.style) ? String(v.style).slice(0, 120) : STYLE[emotion],
      },
    });
  });
  assignMotion(out, parsed, seed);
  return out;
}

function describePlan(plan) {
  const head = `template=${plan.template} seed=${plan.seed} header=${plan.header} captions=${plan.captions} (${plan.source})`;
  const lines = plan.scenes.map((s) => {
    const one = (x) => `${x.kind}[${x.transition},${x.scheme}${x.icon ? ',' + x.icon : ''}]`;
    const b = s.beats && s.beats.length > 1 ? ' ' + s.beats.map(one).join(' > ') : ' ' + one(s);
    return `  scene ${s.index} (${s.palette}/${s.texture}):${b}`;
  });
  return [head, ...lines].join('\n');
}

module.exports = { rulePlan, validatePlan, describePlan, amounts, sentenceRanges: segmentRanges, segmentRanges, grounded, assignMotion, rng };
