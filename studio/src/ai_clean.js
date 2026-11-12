'use strict';
// AI script cleaner: paste ANY raw script (ChatGPT style, with Spoken:/On-screen: labels,
// timestamps, notes, tables...) and Gemini turns it into a clean studio script.
// The AI only SORTS the text: it keeps what is spoken, drops production notes, and splits
// scenes. It may not reword anything: every word it returns is checked against your
// original, and any invented or changed wording throws the AI answer away. If the AI is
// unavailable or fails any check, the rule-based cleaner (clean.js) is used instead.

const { cleanScript, tidy } = require('./clean');

const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []).concat(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
const MAX_CHARS = 24000;
const MAX_MISS = 0.05; // at most 5% of returned words may be absent from the original

function buildPrompt(raw) {
  return `You prepare a pasted script for a text-to-speech video tool. Output JSON only.

TASK: keep ONLY the words a narrator says out loud, split into scenes.

REMOVE (never include): on-screen text, visual / shot / b-roll / focus / overlay directions, labels such as "Spoken:" "Voiceover:" "On-screen:", timestamps, [bracket notes], title options, outlines, tables, descriptions, checklists, sources, editor notes, and hashtags (hashtags go in "caption").

STRICT RULES
1. Copy every spoken line EXACTLY as written. Never reword, translate, shorten, add, fix or invent anything. You may only remove labels, numbering and surrounding quote marks.
2. One scene per natural unit of the script: hook, each beat or point, payoff, call to action. If the script already has sections, follow them. Number repeated list items as "Beat 1", "Beat 2"...
3. "heading" is a short label of at most 4 words, taken from the script's own headings when they exist.
4. "title": the first title option if the script offers any, otherwise "".
5. "caption": the post caption or hashtags if present, otherwise "".
6. If nothing in the text is meant to be spoken, return an empty "scenes" list.

OUTPUT SHAPE
{"title":"","scenes":[{"heading":"Hook","spoken":["first spoken paragraph","next one if any"]}],"caption":""}

SCRIPT:
<<<
${raw}
>>>
`;
}

async function callModel(model, key, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  const j = await res.json();
  const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  const text = parts && parts.map((p) => p.text || '').join('');
  if (!text) throw new Error('empty answer');
  return text;
}

function parseJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch (e) {
    const a = t.indexOf('{');
    const z = t.lastIndexOf('}');
    if (a >= 0 && z > a) return JSON.parse(t.slice(a, z + 1));
    throw e;
  }
}

const words = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// Throws if the AI answer is unusable. Returns { title, scenes, caption } cleaned.
function validate(raw, src) {
  if (!src || typeof src !== 'object' || !Array.isArray(src.scenes)) throw new Error('answer has no scenes list');
  const known = new Set(words(raw));
  let total = 0;
  let miss = 0;
  const scenes = [];
  src.scenes.forEach((sc, i) => {
    const paras = (Array.isArray(sc && sc.spoken) ? sc.spoken : []).map((p) => String(p || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!paras.length) return;
    for (const p of paras) {
      for (const w of words(p)) {
        total++;
        if (!known.has(w)) miss++;
      }
    }
    const heading = String((sc && sc.heading) || '').replace(/[#\r\n*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || `Scene ${i + 1}`;
    scenes.push({ heading, paras });
  });
  if (!scenes.length) throw new Error('no spoken text found');
  if (total < 5) throw new Error('too little spoken text');
  if (miss / total > MAX_MISS) throw new Error(`AI changed the wording (${miss} of ${total} words are not in your script)`);
  const caption = String(src.caption || '').replace(/\s+/g, ' ').trim();
  const title = String(src.title || '').replace(/[#\r\n*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return { title, scenes, caption, miss, total };
}

function toStudio(v) {
  const stats = { notes: 0, timestamps: 0, tables: 0, dropped: [] };
  const scenes = v.scenes.map((s) => ({ h: s.heading, paras: s.paras.map((p) => tidy(p, stats)).filter(Boolean) })).filter((s) => s.paras.length);
  let title = v.title ? tidy(v.title, stats) : '';
  if (!title && scenes.length) {
    const first = scenes[0].paras[0] || '';
    title = (first.match(/^.*?[.!?](?=\s|$)/) || [first])[0].replace(/[.!?]+$/, '').slice(0, 80);
  }
  const lines = [];
  if (title) lines.push('---', `title: ${title}`, '---', '');
  for (const s of scenes) lines.push(`## ${s.h}`, ...s.paras.flatMap((p) => [p, '']));
  if (v.caption) lines.push('### Caption', v.caption, '');
  return { text: lines.join('\n').trim() + '\n', scenes: scenes.length };
}

// Returns { ok, text, model, scenes, note }. Never throws.
async function aiClean(raw, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!opts.call && !key) return { ok: false, note: 'GEMINI_API_KEY is not set' };
  if (String(raw).length > MAX_CHARS) return { ok: false, note: `script too long for AI cleaning (${String(raw).length} characters, limit ${MAX_CHARS})` };
  const prompt = buildPrompt(raw);
  const tried = [];
  for (const model of opts.models || MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const answer = parseJson(await (opts.call || callModel)(model, key, prompt));
        const v = validate(raw, answer);
        const out = toStudio(v);
        return { ok: true, text: out.text, model, scenes: out.scenes, wordsChecked: v.total };
      } catch (e) {
        tried.push(`${model}: ${String(e.message).slice(0, 140)}`);
        const s = e.status;
        if (s === 404 || s === 400 || s === 403 || s === 401) break;
        if (s === 429 && /limit: 0/.test(e.message)) break;
        if (!s) break; // answer problem (bad JSON, changed wording): another model may do better, retrying the same one will not
        await new Promise((r) => setTimeout(r, (opts.wait === undefined ? 4000 : opts.wait) * attempt));
      }
    }
  }
  return { ok: false, note: tried.join(' | ') || 'no answer' };
}

// Step 1 of the pipeline. Studio-format scripts skip the AI (nothing to fix).
async function prepareScript(raw, opts = {}) {
  const rules = cleanScript(raw);
  const r = rules.report;
  const forceRules = process.env.AI_CLEAN === 'off' || /^\s*---[\s\S]{0,600}?\n\s*clean:\s*rules\s*(?:\r?\n)/i.test(raw);
  const details = [];
  const ruleDetails = () => {
    if (r.dropped && r.dropped.length) details.push('removed sections: ' + r.dropped.join(', '));
    if (r.tables) details.push(`removed ${r.tables} table lines`);
    if (r.timestamps) details.push(`removed ${r.timestamps} timestamps`);
    if (r.notes) details.push(`removed ${r.notes} bracket notes (UNVERIFIED etc.)`);
  };

  if (r.kind === 'studio-format') {
    ruleDetails();
    return { text: rules.text, status: 'ok', summary: 'already in studio format', details };
  }
  if (forceRules) {
    ruleDetails();
    return { text: rules.text, status: 'ok', summary: `rules cleaner (AI off): ${r.scenes} scenes`, details };
  }
  const ai = await aiClean(raw, opts);
  if (ai.ok) {
    details.push(`AI cleaner model: ${ai.model}, ${ai.wordsChecked} words checked against your original`);
    return { text: ai.text, status: 'ok', summary: `AI cleaned your script to ${ai.scenes} scenes (spoken text only)`, details };
  }
  ruleDetails();
  details.unshift(`AI cleaner failed, rules cleaner used: ${ai.note}`);
  return { text: rules.text, status: 'warn', summary: `AI cleaner unavailable, rules cleaner made ${r.scenes} scenes`, details };
}

module.exports = { aiClean, prepareScript, validate };
