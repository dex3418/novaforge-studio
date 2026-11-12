'use strict';
// The planner decides, for every scene, which scene type to draw and with what data,
// plus the overall template / palette / texture / transition.
//
// rulePlan()     = fixed rules (no AI, always available, same result every time)
// validatePlan() = makes any plan safe to render. The AI director will later write a
//                  plan in this same shape; anything invalid falls back to a plain caption.

const { PALETTES, TEXTURES, TEMPLATES, TRANSITIONS, KINDS, EMOTIONS } = require('./catalog');

const hash = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

// ------------------------------------------------------------ extraction helpers

const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)';
const DASH = '(?:[\\-\\u2010-\\u2015\\u2212]|\\bto\\b)';
const SYM = `(?:\\u20B9|\\bRs\\.?)\\s?${NUM}(?:\\s*${DASH}\\s*(?:\\u20B9|\\bRs\\.?)?\\s?${NUM})?`;
const WORD = `${NUM}(?:\\s*${DASH}\\s*${NUM})?\\s*(?:rupees|rupee|rs\\b)`;
const AMT = new RegExp(`${SYM}|${WORD}`, 'gi');

function amounts(text) {
  const out = [];
  for (const m of String(text).matchAll(AMT)) {
    const raw = [m[1] || m[3], m[2] || m[4]].filter(Boolean);
    out.push({ values: raw.map((x) => parseFloat(x.replace(/,/g, ''))), text: m[0], index: m.index });
  }
  return out;
}

function percents(text) {
  return [...String(text).matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)].map((m) => ({ value: parseFloat(m[1]), text: m[0] }));
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
    return { kind: 'counter', data: { values: a.values, prefix: '₹', suffix: '', label, sub: body } };
  }

  const items = listItems(sc);
  if (items && STEP_RE.test(all)) return { kind: 'steps', data: { items } };
  if (items) return { kind: 'checklist', data: { items } };

  if (i === 0 && wc <= 16 && amts.length === 0) {
    return { kind: 'kinetic', data: { text: sc.narration || all } };
  }
  return { kind: 'caption', data: {} };
}

// ------------------------------------------------------------ template choice

const TEMPLATE_RULES = [
  ['budget', /₹|rupee|\bcost|price|budget|fee\b|save|afford|spend/gi],
  ['jobs', /recruit|vacanc|\bjob|apply|exam|police|bharti|career|syllabus|admit card|eligib/gi],
  ['steps', /\bstep|first|then|next|how to|guide|process/gi],
  ['myth', /\bmyth|\bfact\b|truth|misconception/gi],
  ['quote', /\bquote|\bsaid\b|inspir|motivat|“/gi],
  ['event', /\bdate\b|deadline|schedule|last day|register by|event|\bon \d/gi],
  ['news', /announc|launch|\bnew\b|update|breaking|notice|introducing/gi],
];

function pickTemplate(text) {
  let best = 'tips';
  let bestScore = 0;
  for (const [id, re] of TEMPLATE_RULES) {
    const s = (text.match(re) || []).length;
    if (s > bestScore) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

// ------------------------------------------------------------ beats
// A scene's spoken text is cut into "beats" (whole sentences). Each beat gets its own
// visual, so one long scene can show a counter, then captions, then a checklist.

function sentenceRanges(narration) {
  const out = [];
  let w = 0;
  for (const text of sentences(narration)) {
    const n = words(text).length;
    out.push({ text, from: w, to: w + n });
    w += n;
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
    case 'qa': return [d.q, d.a];
    case 'mythfact': return [d.myth, d.fact];
    case 'compare': return [d.left && d.left.text, d.right && d.right.text];
    case 'checklist': case 'steps': return (d.items || []).map((i) => i && i.text);
    default: return [];
  }
}

const cap = (s, n) => words(s).slice(0, n).join(' ');

function groundedData(kind, d, src) {
  if (kind === 'counter') {
    const have = numbersIn(src);
    if (!d.values.every((v) => have.has(Number(v)))) return false;
  }
  if (kind === 'progress') {
    if (!numbersIn(src).has(Number(d.value))) return false;
  }
  return strings(kind, d).every((x) => !x || grounded(x, src));
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
  if (kind === 'counter') {
    o.values = o.values.map(Number).slice(0, 2);
    o.prefix = isStr(o.prefix) ? String(o.prefix).slice(0, 3) : '';
    o.suffix = isStr(o.suffix) ? String(o.suffix).slice(0, 10) : '';
    o.label = isStr(o.label) ? cap(o.label, 9) : '';
  }
  if (kind === 'checklist' || kind === 'steps') {
    o.items = o.items.slice(0, 6).map((it) => ({ text: cap(it.text, 14), frac: Number.isFinite(it.frac) ? it.frac : null }));
    let prev = -1;
    o.items.forEach((it, i) => {
      let f = it.frac;
      if (f == null) f = locate(it.text, beatText);
      if (f == null) f = i / o.items.length;
      f = Math.max(f, prev + 0.02);
      it.frac = Math.min(0.95, f);
      prev = it.frac;
    });
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
  if (kind === 'kinetic') o.text = cap(o.text, 18);
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

// raw beats (sentence ranges) -> checked beats with word ranges, or null
function normalizeBeats(g, sc, trust) {
  const raw = Array.isArray(g.beats) ? g.beats.filter((b) => b && typeof b === 'object') : [];
  if (!raw.length || raw.length > 10) return null;
  const rng = sentenceRanges(sc.narration);
  if (rng.length < 1) return null;
  const sorted = raw
    .map((b) => ({ ...b, a: Number(b.fromSentence), z: Number(b.toSentence) }))
    .sort((x, y) => x.a - y.a);
  let at = 0;
  for (const b of sorted) {
    if (!Number.isInteger(b.a) || !Number.isInteger(b.z) || b.a !== at || b.z <= b.a || b.z > rng.length) return null;
    at = b.z;
  }
  if (at !== rng.length) return null;

  const ws = words(sc.narration);
  const src = `${sc.heading} ${sc.body} ${sc.narration}`;
  const out = [];
  for (const b of sorted) {
    const from = rng[b.a].from;
    const to = rng[b.z - 1].to;
    const text = ws.slice(from, to).join(' ');
    let kind = KINDS.includes(b.kind) ? b.kind : 'caption';
    let data = b.data && typeof b.data === 'object' ? b.data : {};
    if (!CHECK[kind](data) || (!trust && !groundedData(kind, data, src))) {
      kind = 'caption';
      data = {};
    } else {
      data = finalize(kind, data, text);
    }
    const prev = out[out.length - 1];
    if (prev && prev.kind === 'caption' && kind === 'caption') {
      prev.to = to;
      prev.toSentence = b.z;
      continue;
    }
    out.push({
      fromSentence: b.a, toSentence: b.z, from, to, kind, data,
      emotion: EMOTIONS.includes(b.emotion) ? b.emotion : null,
      emphasis: Array.isArray(b.emphasis) ? b.emphasis.filter(isStr).slice(0, 8) : [],
    });
  }
  if (out.every((b) => b.kind === 'caption')) return null;
  return out;
}

// ------------------------------------------------------------ rule beats

function groupSentences(rng) {
  const groups = [];
  let cur = null;
  rng.forEach((r, i) => {
    const wc = r.to - r.from;
    const special = amounts(r.text).length === 1 || percents(r.text).length === 1 || (i === 0 && wc <= 14);
    if (special) {
      if (cur) groups.push(cur);
      groups.push({ a: i, z: i + 1 });
      cur = null;
    } else if (cur && cur.words + wc <= 38 && cur.z - cur.a < 2) {
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

const STOP = new Set('once when which that because and but from the a an of for to with while after before so as by in on is was are were will'.split(' '));
// a short label from the words right after the amount ("per unit", "grant")
function labelAfter(text, a) {
  const rest = text.slice(a.index + a.text.length).split(/[,.;:!?]/)[0];
  const out = [];
  for (const w of words(rest)) {
    if (STOP.has(w.toLowerCase()) || out.length >= 3) break;
    out.push(w);
  }
  const l = out.join(' ');
  return l ? l[0].toUpperCase() + l.slice(1) : '';
}

function ruleBeats(sc) {
  const rng = sentenceRanges(sc.narration);
  const wc = words(sc.narration).length;
  if (rng.length < 2 || wc < 28) return null;
  const beats = groupSentences(rng).map((g, gi) => {
    const text = rng.slice(g.a, g.z).map((r) => r.text).join(' ');
    const am = amounts(text);
    const pc = percents(text);
    let kind = 'caption';
    let data = {};
    if (am.length === 1) {
      kind = 'counter';
      data = { values: am[0].values, prefix: '₹', suffix: '', label: labelAfter(text, am[0]) };
    } else if (pc.length === 1 && am.length === 0) {
      kind = 'progress';
      data = { value: pc[0].value, label: '' };
    } else if (gi === 0 && words(text).length <= 14) {
      kind = 'kinetic';
      data = { text };
    }
    return { fromSentence: g.a, toSentence: g.z, kind, data };
  });
  return beats;
}

// ------------------------------------------------------------ plans

function rulePlan(parsed) {
  const meta = parsed.meta || {};
  const n = parsed.scenes.length;
  const text = `${parsed.title} ${parsed.scenes.map((s) => `${s.heading} ${s.body}`).join(' ')}`;

  const tid = TEMPLATES[meta.template] ? meta.template : pickTemplate(text);
  const t = TEMPLATES[tid];
  const palette = PALETTES[meta.palette] ? meta.palette : t.palette;
  const texture = TEXTURES[meta.texture] ? meta.texture : t.textures[hash(parsed.slug) % t.textures.length];

  const scenes = parsed.scenes.map((sc, i) => {
    const d = decide(sc, i, n);
    const emotion = emotionOf(`${sc.heading} ${sc.body}`);
    const emphasis = [...new Set((`${sc.heading} ${sc.body}`.match(/[^\s]*\d[^\s]*/g) || []).map((x) => x.replace(/[^\p{L}\p{N}]/gu, '')))].filter(Boolean);
    const beats = d.kind === 'caption' ? ruleBeats(sc) : null;
    return {
      index: sc.index, kind: d.kind, data: d.data, emotion, emphasis, beats,
      voice: { rateDelta: RATE_DELTA[emotion], style: STYLE[emotion] },
    };
  });

  return validatePlan({ version: 2, source: 'rules', template: tid, palette, texture, transition: t.transition, scenes }, parsed);
}

const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const CHECK = {
  caption: () => true,
  kinetic: (d) => isStr(d.text),
  counter: (d) => Array.isArray(d.values) && d.values.length > 0 && d.values.every((v) => isFinite(Number(v))),
  checklist: (d) => Array.isArray(d.items) && d.items.length >= 1 && d.items.length <= 8 && d.items.every((i) => i && isStr(i.text)),
  steps: (d) => Array.isArray(d.items) && d.items.length >= 1 && d.items.length <= 8 && d.items.every((i) => i && isStr(i.text)),
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
function validatePlan(plan, parsed, fallback) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const fb = fallback || null;
  const trust = p.source !== 'ai';
  const tid = TEMPLATES[p.template] ? p.template : fb ? fb.template : 'tips';
  const out = {
    version: 2,
    source: p.source === 'ai' ? 'ai' : 'rules',
    template: tid,
    palette: PALETTES[p.palette] ? p.palette : fb ? fb.palette : TEMPLATES[tid].palette,
    texture: TEXTURES[p.texture] ? p.texture : fb ? fb.texture : TEMPLATES[tid].textures[0],
    transition: TRANSITIONS.includes(p.transition) ? p.transition : fb ? fb.transition : TEMPLATES[tid].transition,
    scenes: [],
  };
  const given = Array.isArray(p.scenes) ? p.scenes : [];
  parsed.scenes.forEach((sc, i) => {
    const g = given.find((x) => x && Number(x.index) === sc.index) || given[i] || {};
    const f = fb ? fb.scenes.find((x) => x.index === sc.index) : null;
    const src = `${sc.heading} ${sc.body} ${sc.narration}`;

    const nb = normalizeBeats(g, sc, trust);
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
    }
    const emotion = EMOTIONS.includes(g.emotion) ? g.emotion : f ? f.emotion : 'neutral';
    const v = g.voice && typeof g.voice === 'object' ? g.voice : {};
    const rd = Number.isFinite(Number(g.rateDelta)) ? Number(g.rateDelta) : Number.isFinite(Number(v.rateDelta)) ? Number(v.rateDelta) : f ? f.voice.rateDelta : RATE_DELTA[emotion];
    out.scenes.push({
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
  return out;
}

function describePlan(plan) {
  const head = `template=${plan.template} palette=${plan.palette} texture=${plan.texture} transition=${plan.transition} (${plan.source})`;
  const lines = plan.scenes.map((s) => {
    const b = s.beats && s.beats.length ? ' beats: ' + s.beats.map((x) => x.kind).join(' > ') : '';
    return `  scene ${s.index}: ${s.kind} / ${s.emotion}${b}`;
  });
  return [head, ...lines].join('\n');
}

module.exports = { rulePlan, validatePlan, describePlan, amounts, sentenceRanges, grounded };
