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
    const parts = colon[1].split(/,|;|\band\b/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3 && parts.length <= 6 && parts.every((p) => words(p).length <= 8)) return withFracs(parts);
  }
  const ss = sentences(full);
  if (ss.length >= 3 && ss.length <= 5 && ss.every((s) => words(s).length <= 14)) return withFracs(ss);
  return null;
}

// ------------------------------------------------------------ per-scene decision

const CTA_RE = /\b(follow|subscribe|tap|click|link in|bio|share|comment|visit|download|join|contact|start training|sign up|apply now)\b/i;
const WARN_RE = /\b(warning|beware|careful|caution|scam|fraud|never|don'?t|do not|avoid|danger|mistake)\b/i;
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
  if (wc <= 40 && (WARN_RE.test(headStart) || NOTE_RE.test(heading))) {
    return { kind: 'alert', data: { text: body || heading, tone: WARN_RE.test(headStart) ? 'warning' : 'note' } };
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
    return {
      index: sc.index,
      kind: d.kind,
      data: d.data,
      emotion,
      emphasis,
      voice: { rateDelta: RATE_DELTA[emotion], style: STYLE[emotion] },
    };
  });

  return validatePlan({ version: 1, source: 'rules', template: tid, palette, texture, transition: t.transition, scenes }, parsed);
}

const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const CHECK = {
  caption: () => true,
  kinetic: () => true,
  counter: (d) => Array.isArray(d.values) && d.values.length > 0 && d.values.every((v) => isFinite(Number(v))),
  checklist: (d) => Array.isArray(d.items) && d.items.length >= 1 && d.items.length <= 8 && d.items.every((i) => isStr(i.text)),
  steps: (d) => Array.isArray(d.items) && d.items.length >= 1 && d.items.length <= 8 && d.items.every((i) => isStr(i.text)),
  quote: (d) => isStr(d.text),
  qa: (d) => isStr(d.q) && isStr(d.a),
  mythfact: (d) => isStr(d.myth) && isStr(d.fact),
  compare: (d) => d.left && d.right && isStr(d.left.title) && isStr(d.left.text) && isStr(d.right.title) && isStr(d.right.text),
  progress: (d) => isFinite(Number(d.value)) && Number(d.value) >= 0 && Number(d.value) <= 100,
  alert: (d) => isStr(d.text),
  cta: (d) => isStr(d.text),
};

// Makes any plan (rules now, AI later) safe: unknown things are replaced, never trusted.
function validatePlan(plan, parsed) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const tid = TEMPLATES[p.template] ? p.template : 'tips';
  const out = {
    version: 1,
    source: p.source === 'ai' ? 'ai' : 'rules',
    template: tid,
    palette: PALETTES[p.palette] ? p.palette : TEMPLATES[tid].palette,
    texture: TEXTURES[p.texture] ? p.texture : TEMPLATES[tid].textures[0],
    transition: TRANSITIONS.includes(p.transition) ? p.transition : TEMPLATES[tid].transition,
    scenes: [],
  };
  const given = Array.isArray(p.scenes) ? p.scenes : [];
  parsed.scenes.forEach((sc, i) => {
    const g = given.find((x) => x && Number(x.index) === sc.index) || given[i] || {};
    let kind = KINDS.includes(g.kind) ? g.kind : 'caption';
    let data = g.data && typeof g.data === 'object' ? g.data : {};
    if (!CHECK[kind](data)) {
      kind = 'caption';
      data = {};
    }
    const emotion = EMOTIONS.includes(g.emotion) ? g.emotion : 'neutral';
    const v = g.voice && typeof g.voice === 'object' ? g.voice : {};
    out.scenes.push({
      index: sc.index,
      kind,
      data,
      emotion,
      emphasis: Array.isArray(g.emphasis) ? g.emphasis.filter(isStr).slice(0, 12) : [],
      voice: {
        rateDelta: Math.max(-15, Math.min(15, Number(v.rateDelta) || 0)),
        style: isStr(v.style) ? String(v.style).slice(0, 120) : STYLE[emotion],
      },
    });
  });
  return out;
}

function describePlan(plan) {
  const head = `template=${plan.template} palette=${plan.palette} texture=${plan.texture} transition=${plan.transition} (${plan.source})`;
  return [head, ...plan.scenes.map((s) => `  scene ${s.index}: ${s.kind} / ${s.emotion}`)].join('\n');
}

module.exports = { rulePlan, validatePlan, describePlan, amounts };
