'use strict';
// AI director: asks a Gemini text model to plan the visuals, then checks everything it
// says. The AI only chooses visuals and copies/trims words from your script for the
// screen. The spoken text is never changed, and anything invented or invalid is
// replaced by the rule-based plan, so a bad AI answer can never break or alter a post.

const { PALETTES, TEXTURES, TEMPLATES, TRANSITIONS, EMOTIONS, SCHEMES, DECORS } = require('./catalog');
const { ICON_NAMES } = require('./icons');
const calibration = require('./calibration');
const { validatePlan, segmentRanges } = require('./plan');

const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []).concat(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-4-argon']);
const MAX_CHARS = 24000;

const LIBRARY = `
VISUAL TYPES (kind) and their "data":
- caption  {}  plain spoken captions. Use for explanation or filler between visuals.
- kinetic  {"text": "short punchy phrase, max 12 words, copied from the beat"}  hooks, bold claims.
- counter  {"values":[number] or [low,high], "prefix":"₹" or "$" or "", "suffix":"%" or "x" or " crore" or " lakh" or "", "label":"max 6 words"}  ONE key number the beat is about. The number must appear in the spoken text.
- checklist {"items":[{"text":"max 10 words"}, ...]}  3 to 6 things to do, carry or have. Items copied/trimmed from the beat.
- steps    {"items":[{"text":"max 10 words"}, ...]}  3 to 6 ordered steps.
- quote    {"text":"...", "author":""}  a quotable line.
- qa       {"q":"question","a":"answer"}  a question and its answer, both from the beat.
- mythfact {"myth":"...","fact":"..."}  a wrong belief and the truth.
- compare  {"left":{"title":"max 3 words","text":"..."},"right":{"title":"max 3 words","text":"..."}}  two options side by side.
- progress {"value":0-100,"label":"max 6 words"}  one percentage that appears in the text.
- alert    {"text":"...","tone":"warning" or "note"}  a warning or tip.
- keyword  {"word":"1-2 words","line":"max 12 words"}  the ONE key term of the beat shown huge (a name, a number word, a concept). Both copied from the beat.
- stats    {"items":[{"value":number,"prefix":"₹" or "","suffix":"%" or " crore" or "","label":"max 4 words"}, ... 2 to 4]}  several numbers in one beat shown as count-up cards. Every value must appear in the spoken text.
- bars     {"items":[{"value":number,"label":"max 3 words"}, ... 2 to 5],"prefix":"","suffix":""}  compare amounts as horizontal bars. Values must appear in the text.
- spot     {"icon":"one of: ${ICON_NAMES.join(', ')}","line":"max 12 words copied from the beat"}  a big icon with one line, for a concrete thing (money, time, place, document, phone, safety).
- cta      {"text":"...","sub":"","button":"short handle or phrase"}  final call to action, last beat of the last scene only.
`;

function buildPrompt(parsed) {
  const scenes = parsed.scenes.map((sc) => {
    const ss = segmentRanges(sc.narration).map((r, i) => `    ${i}: ${r.text}`);
    return `SCENE ${sc.index} (heading: ${sc.heading || '-'})\n${ss.join('\n')}`;
  });
  return `You are the motion-graphics director for short social videos made from a spoken script.
Decide how each part of the script should look on screen. Output JSON only.

${LIBRARY}
RULES
1. The script is cut into numbered LINES inside each scene. Split every scene into "beats": consecutive groups of lines (usually 1 or 2 lines, at most 3). A beat should last about 4 seconds, so keep a beat under ~18 spoken words. Beats must cover every line of the scene, in order, with no gaps and no overlap. fromSentence is inclusive, toSentence is exclusive (they count lines).
2. Give each beat one visual kind. It must feel like motion graphics, not subtitles: at least 2 of every 3 beats must be a real visual (counter, stats, bars, spot, checklist, steps, qa, mythfact, compare, progress, alert, kinetic, keyword, quote). Use kinetic for punchy statements, keyword for a key term, spot when a concrete thing (money, time, place, document, phone, safety) is mentioned, stats when 2-4 numbers appear together. Caption only when nothing else fits, and never more than 2 captions in a row. Do not use the same kind twice in a row.
3. PACING: open strong (first 2 beats are bold visuals), keep the middle moving with a bold visual every 3rd or 4th beat, and build energy toward the end. Long scenes need MORE beats with different kinds, never one long caption.
4. NEVER invent anything. Every number, name and phrase you put in "data" must come from the spoken text of that scene. You may trim and pick, not add. If nothing fits, use caption with data {}.
5. Use a counter only when the beat's key point is one number (or one range). Use checklist/steps only when the beat really lists items.
6. For each scene also give "emotion" (one of ${EMOTIONS.join(', ')}) and "rateDelta" (-10 to 10, speaking speed change in percent). Excited +5, serious -5.
7. Pick one "template" (${Object.keys(TEMPLATES).join(', ')}) and "palette" (${Object.keys(PALETTES).join(', ')}) and "texture" (${Object.keys(TEXTURES).join(', ')}) for the post. Colours and textures are independent of the template: you may also set "palette" and "texture" per scene to change the look as the video goes on, and "icon" per beat.
8. Optional per beat: "transition" (one of ${TRANSITIONS.join(', ')}), "scheme" (${SCHEMES.join(', ')}: pop = accent-colour background for a punchy beat, flip = light/dark swap), "decor" (${DECORS.join(', ')}), "cstyle" (chunk, pill, stack: caption look). Vary them across beats; leave out to let the system rotate them.
9. Optional "emphasis": up to 6 words/numbers from the beat to highlight.

OUTPUT SHAPE
{"template":"..","palette":"..","texture":"..","transition":"..",
 "scenes":[{"index":1,"emotion":"neutral","rateDelta":0,
   "beats":[{"fromSentence":0,"toSentence":2,"kind":"counter","emotion":"neutral","emphasis":["..."],"data":{...}}]}]}

${calibration.promptText()}${parsed.meta && parsed.meta.note ? `REQUEST FOR THIS VIDEO (from the user, follow it as far as the rules allow): ${parsed.meta.note}\n\n` : ''}POST TITLE: ${parsed.title}

SCRIPT (sentences are numbered inside each scene):
${scenes.join('\n\n')}
`;
}

async function callModel(model, key, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }, // temperature/top_p/top_k are deprecated on newer Gemini models
    }),
  });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
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

// returns { plan, note }. Never throws: any problem returns the rules plan.
async function direct(parsed, rules, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { plan: rules, status: 'warn', note: 'AI director skipped: GEMINI_API_KEY is not set, using rules', details: ['Add the GEMINI_API_KEY secret in the repo (Settings > Secrets and variables > Actions).'] };
  const size = parsed.scenes.reduce((a, s) => a + s.narration.length, 0);
  if (size > MAX_CHARS) return { plan: rules, status: 'warn', note: 'AI director skipped: script too long, using rules', details: [`${size} characters of speech, limit ${MAX_CHARS}`] };

  const prompt = buildPrompt(parsed);
  let raw = null;
  let lastErr = null;
  let usedModel = '';
  const tried = [];
  const models = opts.models || MODELS;
  for (const model of models) {
    for (let attempt = 1; attempt <= 3 && !raw; attempt++) {
      try {
        raw = parseJson(await (opts.call || callModel)(model, key, prompt));
        usedModel = model;
      } catch (e) {
        lastErr = e;
        tried.push(`${model}: ${e.message}`);
        if (e.status === 404 || e.status === 400 || e.status === 403 || e.status === 401) break;
        if (e.status === 429 && /limit: 0/.test(e.message)) break; // no free quota on this model: retrying won't help
        await new Promise((r) => setTimeout(r, 4000 * attempt)); // 503 = busy, usually clears in seconds
      }
    }
    if (raw) break;
  }
  if (!raw) return { plan: rules, status: 'warn', note: `AI director failed (${tried.length ? tried.map((t) => t.slice(0, 110)).join(' | ') : lastErr ? lastErr.message : 'no answer'}), using rules`, details: tried.concat(['404 = model name not available: add a GEMINI_MODEL secret. 400/403 = key problem. 429 = rate limit.']) };

  const meta = parsed.meta || {};
  const ai = { ...raw, source: 'ai', version: 3 };
  // what you chose in the box or the script header wins over the AI
  if (TEMPLATES[meta.template]) ai.template = meta.template;
  if (PALETTES[meta.palette]) {
    ai.palette = meta.palette;
    (ai.scenes || []).forEach((sc) => sc && delete sc.palette);
  }
  if (TEXTURES[meta.texture]) {
    ai.texture = meta.texture;
    (ai.scenes || []).forEach((sc) => sc && delete sc.texture);
  }
  if (Number.isFinite(Number(meta.seed)) && meta.seed !== '') ai.seed = Number(meta.seed);
  else if (rules && Number.isFinite(rules.seed)) ai.seed = rules.seed;

  const diag = [];
  const plan = validatePlan(ai, parsed, rules, diag);
  const proposed = (Array.isArray(raw.scenes) ? raw.scenes : []).reduce((a, s) => a + (Array.isArray(s.beats) ? s.beats.filter((b) => b && b.kind && b.kind !== 'caption').length : 0), 0);
  const beats = plan.scenes.reduce((a, s) => a + (s.beats ? s.beats.filter((b) => b.kind !== 'caption').length : s.kind !== 'caption' ? 1 : 0), 0);
  const status = proposed === 0 || beats === 0 ? 'warn' : 'ok';
  return {
    plan, status,
    note: `AI director ${status === 'ok' ? 'ok' : 'gave no usable visuals'}: ${proposed} visual beats proposed, ${beats} kept (model ${usedModel})`,
    details: [`AI planned ${(Array.isArray(raw.scenes) ? raw.scenes.filter((s) => s && Array.isArray(s.beats) && s.beats.length).length : 0)} of ${parsed.scenes.length} scenes; the rules filled in the rest`, `template ${plan.template}, palette ${plan.palette}, texture ${plan.texture}, transition ${plan.transition}`, ...diag.slice(0, 25).map((x) => `rejected in scene ${x.scene}: ${x.reason}`)],
  };
}

module.exports = { direct, buildPrompt, parseJson };
