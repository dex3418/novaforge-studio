'use strict';
// AI director: asks a Gemini text model to plan the visuals, then checks everything it
// says. The AI only chooses visuals and copies/trims words from your script for the
// screen. The spoken text is never changed, and anything invented or invalid is
// replaced by the rule-based plan, so a bad AI answer can never break or alter a post.
//
// The AI is the main planner. It sees the script, the author's own production notes
// (on-screen text, visual ideas), the pictures themselves (it can look at them), your
// ratings, and it chooses EVERYTHING: visuals, template, colours and textures per scene,
// transitions, colour changes, effects, icons, voice delivery and a draft post caption.
// A checker then reviews its plan (too many captions, repeats, long beats, no variety);
// if it finds problems the AI gets one round to repair them. The rule-based planner is
// only the safety net for whatever the AI left out or got wrong.

const { PALETTES, TEXTURES, TEMPLATES, TRANSITIONS, EMOTIONS, SCHEMES, DECORS } = require('./catalog');
const { ICON_NAMES } = require('./icons');
const calibration = require('./calibration');
const { wordSpeakers } = require('./story');
const { validatePlan, segmentRanges } = require('./plan');

// order = the models that answered on a free key in the gemini-probe run first; the bigger ones after
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []).concat(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.7-flash', 'gemini-3.8-flash']);
const gate = require('./gemini_gate');
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
- terminal {"lines":[{"cmd":"cat name.txt"},{"out":"a line copied from the beat, max 14 words"}, ...up to 8]}  a terminal window that types the lines. "cmd" lines are only short file or shell commands (letters, digits, dot, dash, slash, space; e.g. "cat hook.txt", "ls"). Only "out" lines carry script text. Good for steps, tech and developer topics, 1 to 4 lines of output.
- photo    {"pic":0,"line":"max 14 words copied from the beat"}  a full-screen picture with the line over it. ONLY when PICTURES are available below. "pic" is the picture number.
- profile  {"pic":0,"line":"max 14 words copied from the beat"}  a framed picture card with the speaker's name and role (filled in by the system). ONLY when PICTURES are available below; use it at most once, early, when the speaker introduces themself.
- story    {"setting":"village|street|field|office|home","time":"day|dusk|night","actors":[{"id":"cast id","x0":0.3,"x1":0.3,"facing":1,"pose":"idle|walk|talk|point|wave|think|worried|celebrate|listen|shrug|peace|thumbsup|crossed|fist","expr":"neutral|happy|sad|worried|surprised|angry|thinking|laugh|cry|sleep|wink|tired|love","speaks":true}],"props":[{"type":"tree|bush|house|hut|car|bus|tractor|school|hospital|shop|office|bank|board|lamp|bench|desk","x":0.9,"x1":0.1,"scale":0.9,"layer":"back|front"}],"camera":{"z0":1,"z1":1.15,"fx0":0.5,"fx1":0.5,"shake":false},"icon":"optional icon name","iconOf":"cast id"}  ONLY in story mode (see STORY below). A drawn scene with people, places and objects. Positions x are 0 (left) to 1 (right) of the screen; an actor enters from off-screen with x0 below 0 or above 1. Cars, buses and tractors move from x to x1. Text is never written in "data": the spoken line is shown as subtitles by the system.
- cta      {"text":"...","sub":"","button":"short handle or phrase"}  final call to action, last beat of the last scene only.
`;

function pictureText(parsed) {
  const n = Array.isArray(parsed.pictures) ? parsed.pictures.length : 0;
  const m = parsed.meta || {};
  if (!n) return 'PICTURES: none available. Do not use photo or profile.\n\n';
  return `PICTURES: ${n} available (numbered 0 to ${n - 1}).${m.person || m.brand ? ` The speaker is ${m.person || m.brand}${m.role ? ', ' + m.role : ''}.` : ' The speaker has no name set, so do not use profile.'} Use photo about every 3rd or 4th beat (more often if the template is gallery), cycling through the pictures; a photo beat should carry a short, strong line.\n\n`;
}

function storyText(parsed) {
  const cast = parsed.cast || [];
  if (!cast.length && !(parsed.meta && parsed.meta.mode === 'story')) return '';
  const who = cast.map((c) => `  ${c.id} = ${c.name} (${[c.look.gender === 'f' ? 'woman' : c.look.gender === 'm' ? 'man' : '', c.look.age || '', c.look.outfit || '', c.look.hair || ''].filter(Boolean).join(', ') || 'person'})`).join('\n');
  return `STORY MODE. The video is a story told with drawn characters. CAST (use these ids only):
${who || '  (no cast: use no actors)'}
Lines tagged [name] are spoken by that character, untagged lines by the narrator (not drawn). Make about 4 of every 5 beats kind "story": show who is speaking (put them on screen with "speaks": true, others listen), where it happens (setting, time of day), and what is around (props from the library that the line mentions). Use a different pose or expression whenever the feeling changes, move people between beats (walk in, walk across, turn to each other), vary the camera (wide, close on the speaker with z1 up to 1.3 and fx at the speaker, pull back, small shake only for a shock), and keep the same setting through a scene unless the story moves. Use counter/stats/bars/spot/kinetic only when the line is really about a number or a key fact. Never invent a character who is not in the CAST. Keep actors within 2 or 3 per beat.\n\n`;
}

function buildPrompt(parsed) {
  const scenes = parsed.scenes.map((sc) => {
    const sp = sc.lines ? wordSpeakers(sc) : null;
    const ss = segmentRanges(sc.narration).map((r, i) => `    ${i}: ${sp && sp[r.from] && sp[r.from] !== 'narrator' ? `[${sp[r.from]}] ` : ''}${r.text}`);
    const notes = (sc.direction || []).map((x) => `    note: ${x}`);
    return `SCENE ${sc.index} (heading: ${sc.heading || '-'})\n${ss.join('\n')}${notes.length ? `\n  AUTHOR'S NOTES for this scene (not spoken; use them to choose visuals, and their on-screen text may appear on screen):\n${notes.join('\n')}` : ''}`;
  });
  return `You are the motion-graphics director for short social videos made from a spoken script.
Decide how each part of the script should look on screen. Output JSON only.

${LIBRARY}
RULES
1. The script is cut into numbered LINES inside each scene. Split every scene into "beats": consecutive groups of lines (usually 1 or 2 lines, at most 3). A beat should last about 4 seconds, so keep a beat under ~18 spoken words. Beats must cover every line of the scene, in order, with no gaps and no overlap. fromSentence is inclusive, toSentence is exclusive (they count lines).
2. Give each beat one visual kind. It must feel like motion graphics, not subtitles: at least 2 of every 3 beats must be a real visual (counter, stats, bars, spot, checklist, steps, qa, mythfact, compare, progress, alert, kinetic, keyword, quote). Use kinetic for punchy statements, keyword for a key term, spot when a concrete thing (money, time, place, document, phone, safety) is mentioned, stats when 2-4 numbers appear together. Caption only when nothing else fits, and never more than 2 captions in a row. Do not use the same kind twice in a row.
3. PACING: open strong (first 2 beats are bold visuals), keep the middle moving with a bold visual every 3rd or 4th beat, and build energy toward the end. Long scenes need MORE beats with different kinds, never one long caption.
4. NEVER invent anything. Every number, name and phrase you put in "data" must come from the spoken text of that scene or from the author's notes for it. You may trim and pick, not add. If nothing fits, use caption with data {}.
5. Use a counter only when the beat's key point is one number (or one range). Use checklist/steps only when the beat really lists items.
6. For each scene also give "emotion" (one of ${EMOTIONS.join(', ')}) and "rateDelta" (-10 to 10, speaking speed change in percent). Excited +5, serious -5. Also give "voice":{"style":"..."}: at most 14 words telling a human narrator HOW to say this scene (warm, conversational, slows down on the numbers, quicker on the list, lets the last line land). Never repeat the same style for every scene.
7. Pick one "template" (${Object.keys(TEMPLATES).join(', ')}) and "palette" (${Object.keys(PALETTES).join(', ')}) and "texture" (${Object.keys(TEXTURES).join(', ')}) for the post. Colours and textures are independent of the template: you may also set "palette" and "texture" per scene to change the look as the video goes on, and "icon" per beat.
8. YOU decide the motion for EVERY beat (do not leave it to the system): "transition" (one of ${TRANSITIONS.join(', ')}), "scheme" (${SCHEMES.join(', ')}: pop = accent-colour background for a punchy beat, flip = light/dark swap, base = normal), "decor" (${DECORS.join(', ')}), "cstyle" (chunk, pill, stack: caption look, only matters for captions), "icon" (one of the icon names, only when a concrete object is mentioned). Match the energy of the words: bold transitions (bounce, spin, drop, circle, shake, elastic) and pop colours for strong moments, soft ones (slide, wipe, zoom, fade, split) for calm explanation. Never repeat the same transition twice in a row, use at least 6 different transitions in a long video, and change the colour scheme at least every 4th beat.
9. Optional "emphasis": up to 6 words/numbers from the beat to highlight.
10. Give EVERY scene its own "palette" and "texture" (they may differ from scene to scene; keep one mood, not random chaos). Colours, textures, visuals and motion are separate choices, do not tie them together.
11. "caption": write a short post caption for the video (2-4 sentences in the language of the script, then 5-8 relevant hashtags). It is only used when the author wrote none, and only for the post text, never on screen.

OUTPUT SHAPE
{"template":"..","palette":"..","texture":"..","caption":"..",
 "scenes":[{"index":1,"palette":"..","texture":"..","emotion":"neutral","rateDelta":0,"voice":{"style":".."},
   "beats":[{"fromSentence":0,"toSentence":2,"kind":"counter","transition":"..","scheme":"..","decor":"..","icon":"..","emotion":"neutral","emphasis":["..."],"data":{...}}]}]}

${pictureText(parsed)}${storyText(parsed)}${calibration.promptText()}${parsed.meta && parsed.meta.note ? `REQUEST FOR THIS VIDEO (from the user, follow it as far as the rules allow): ${parsed.meta.note}\n\n` : ''}POST TITLE: ${parsed.title}

SCRIPT (sentences are numbered inside each scene):
${scenes.join('\n\n')}
`;
}

async function callModel(model, key, prompt, images = []) {
  await gate.wait('text');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...images.flatMap((im, i) => [{ text: `PICTURE ${i}:` }, { inlineData: { mimeType: 'image/jpeg', data: im } }])] }],
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

// ---------------------------------------------------------------- review (the checker)

const BOLD = new Set(['counter', 'stats', 'bars', 'spot', 'checklist', 'steps', 'qa', 'mythfact', 'compare', 'progress', 'alert', 'kinetic', 'keyword', 'quote', 'terminal', 'photo', 'profile', 'story', 'cta']);

// units of a plan: every beat of a multi-beat scene, or the scene itself
function planUnits(plan) {
  const out = [];
  plan.scenes.forEach((s) => (s.beats && s.beats.length > 1 ? s.beats : [s]).forEach((b) => out.push({ b, scene: s.index })));
  return out;
}
// the same for what the AI literally answered
function rawUnits(raw) {
  const out = [];
  (Array.isArray(raw && raw.scenes) ? raw.scenes : []).forEach((s) => {
    if (!s || typeof s !== 'object') return;
    const bs = Array.isArray(s.beats) && s.beats.length ? s.beats : [s];
    bs.forEach((b) => b && typeof b === 'object' && out.push({ b, scene: s.index }));
  });
  return out;
}

// problems worth sending back to the AI. Empty list = the plan is good.
function review(plan, raw, parsed, diag) {
  const issues = [];
  const U = planUnits(plan);
  const n = U.length;
  if (n >= 4) {
    const caps = U.filter((u) => u.b.kind === 'caption');
    if (caps.length / n > 0.25) issues.push(`${caps.length} of ${n} beats are plain captions (at most 25% allowed): use real visuals (kinetic, counter, spot, keyword, terminal...) for more beats`);
    let run = 0;
    let worst = 0;
    U.forEach((u) => {
      run = u.b.kind === 'caption' ? run + 1 : 0;
      worst = Math.max(worst, run);
    });
    if (worst >= 3) issues.push(`${worst} captions in a row somewhere (at most 2)`);
    let same = 0;
    for (let i = 1; i < n; i++) if (U[i].b.kind === U[i - 1].b.kind && U[i].b.kind !== 'caption' && U[i].b.kind !== 'story') same++;
    if (same / n > 0.3) issues.push(`the same visual kind repeats back to back ${same} times: alternate kinds`);
    if (U.slice(0, 2).some((u) => !BOLD.has(u.b.kind))) issues.push('the first two beats must be bold visuals, not captions');
  }
  const scenesById = new Map(parsed.scenes.map((s) => [s.index, s]));
  const long = [];
  plan.scenes.forEach((s) => {
    if (s.beats && s.beats.length > 1) s.beats.forEach((b) => b.text && b.text.split(/\s+/).length > 22 && long.push(`scene ${s.index}`));
    else {
      const sc = scenesById.get(s.index);
      if (sc && sc.narration.split(/\s+/).length > 30 && !['checklist', 'steps', 'compare', 'qa', 'mythfact'].includes(s.kind)) long.push(`scene ${s.index}`);
    }
  });
  if (long.length) issues.push(`beats that are too long (cut into shorter beats of 1-2 lines): ${[...new Set(long)].slice(0, 6).join(', ')}`);

  if (raw) {
    const R = rawUnits(raw);
    const rn = R.length;
    for (const f of ['transition', 'scheme', 'decor']) {
      const miss = R.filter((u) => !u.b[f]).length;
      if (rn >= 4 && miss / rn > 0.3) issues.push(`"${f}" is missing on ${miss} of ${rn} beats: set it on every beat`);
    }
    const tr = R.map((u) => u.b.transition).filter(Boolean);
    if (tr.length >= 6 && new Set(tr).size < Math.min(6, Math.floor(tr.length / 2))) issues.push(`only ${new Set(tr).size} different transitions used: use at least ${Math.min(6, Math.floor(tr.length / 2))}`);
    let rep = 0;
    for (let i = 1; i < tr.length; i++) if (tr[i] === tr[i - 1]) rep++;
    if (rep > 1) issues.push(`the same transition is used twice in a row ${rep} times`);
    const sch = R.map((u) => u.b.scheme).filter(Boolean);
    if (sch.length >= 6 && new Set(sch).size < 2 && !U.some((u) => u.b.kind === 'story')) issues.push('the colour scheme never changes: use pop and flip on some beats');
    const sc = (Array.isArray(raw.scenes) ? raw.scenes : []).filter((s) => s && typeof s === 'object');
    if (sc.length >= 4) {
      if (new Set(sc.map((s) => s.palette).filter(Boolean)).size < 2) issues.push('every scene has the same palette (or none): give scenes their own palette');
      if (new Set(sc.map((s) => s.texture).filter(Boolean)).size < 2) issues.push('every scene has the same texture (or none): give scenes their own texture');
    }
  }
  (diag || []).slice(0, 8).forEach((x) => issues.push(`rejected in scene ${x.scene}: ${x.reason} (fix it or use another kind)`));
  return issues;
}

// how much of the motion the AI chose itself (the rest is filled in by the rules)
function aiShare(raw) {
  const R = rawUnits(raw);
  if (!R.length) return '';
  const pc = (f) => Math.round((R.filter((u) => u.b[f]).length / R.length) * 100);
  return `chosen by the AI on ${R.length} beats: transition ${pc('transition')}%, colour scheme ${pc('scheme')}%, effect ${pc('decor')}%, icon ${pc('icon')}%`;
}

// ---------------------------------------------------------------- asking the model

function loadImages(parsed) {
  const out = [];
  for (const p of parsed.pictures || []) {
    try {
      out.push(require('fs').readFileSync(p.thumb || p.path).toString('base64'));
    } catch (e) {
      out.push(null);
    }
  }
  return out.every(Boolean) ? out : [];
}

// one question, with retries and model fallback. Returns { raw, model, tried } or { fail: [..] }
async function ask(prompt, images, opts, models, attempts = 2) {
  const key = process.env.GEMINI_API_KEY;
  const tried = [];
  for (const model of models) {
    if (!opts.call && gate.skip(model)) { tried.push(`${model}: skipped (already failed in this run)`); continue; }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const raw = parseJson(await (opts.call || callModel)(model, key, prompt, images));
        return { raw, model, tried };
      } catch (e) {
        tried.push(`${model}: ${e.message}`);
        if (e.budget) return { fail: tried };
        if (!opts.call) gate.failed(model, e.status);
        if (e.status === 429) break; // out of quota or rate limited: go to the next model, do not retry this one
        if (e.status === 404 || e.status === 400 || e.status === 403 || e.status === 401) break;
        if (e.status === 429 && /limit: 0/.test(e.message)) break; // no free quota on this model: retrying won't help
        if (attempt < attempts) await new Promise((r) => setTimeout(r, (opts.wait === undefined ? 4000 : opts.wait) * attempt)); // 503 = busy, usually clears in seconds
      }
    }
  }
  return { fail: tried };
}

// turns the AI's answer into a checked plan (your box / header choices win over the AI)
function build(raw, parsed, rules) {
  const meta = parsed.meta || {};
  const ai = { ...raw, source: 'ai', version: 3 };
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
  return { plan, diag, raw };
}

// returns { plan, status, note, details, caption }. Never throws: any problem returns the rules plan.
async function direct(parsed, rules, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { plan: rules, status: 'warn', note: 'AI director skipped: GEMINI_API_KEY is not set, using rules', details: ['Add the GEMINI_API_KEY secret in the repo (Settings > Secrets and variables > Actions).'] };
  const size = parsed.scenes.reduce((a, s) => a + s.narration.length, 0);
  if (size > MAX_CHARS) return { plan: rules, status: 'warn', note: 'AI director skipped: script too long, using rules', details: [`${size} characters of speech, limit ${MAX_CHARS}`] };

  const models = opts.models || MODELS;
  const prompt = buildPrompt(parsed);
  const images = loadImages(parsed);
  const first = await ask(prompt, images, opts, models);
  if (first.fail) {
    const t = first.fail;
    return { plan: rules, status: 'warn', note: `AI director failed (${t.length ? t.map((x) => x.slice(0, 110)).join(' | ') : 'no answer'}), using rules`, details: t.concat(['404 = model name not available: add a GEMINI_MODEL secret. 400/403 = key problem. 429 = rate limit.']) };
  }

  let cur = build(first.raw, parsed, rules);
  let issues = review(cur.plan, cur.raw, parsed, cur.diag);
  const details = [];
  const model = first.model;

  // one repair round: the checker's findings go back to the AI
  if (issues.length && !opts.noRepair) {
    const fix = `${prompt}\nYOUR PREVIOUS ANSWER (JSON):\n${JSON.stringify(first.raw)}\n\nA CHECKER REVIEWED YOUR ANSWER AND FOUND THESE PROBLEMS:\n${issues.map((x) => '- ' + x).join('\n')}\n\nFix every problem. Keep what was already good. Return the COMPLETE corrected JSON (all scenes, all beats) in the same shape.\n`;
    const again = await ask(fix, images, opts, [model], 2);
    if (again.fail) {
      details.push(`repair round failed (${again.fail[0] ? again.fail[0].slice(0, 100) : 'no answer'}), kept the first plan`);
    } else {
      const cand = build(again.raw, parsed, rules);
      const iss2 = review(cand.plan, cand.raw, parsed, cand.diag);
      if (iss2.length < issues.length) {
        details.push(`repair round: ${issues.length} problems found by the checker, ${iss2.length} left`);
        cur = cand;
        issues = iss2;
      } else details.push(`repair round did not help (${issues.length} problems before, ${iss2.length} after), kept the first plan`);
    }
  } else if (!issues.length) details.push('the checker found no problems with the plan');

  const { plan, diag, raw } = cur;
  const scenesRaw = Array.isArray(raw.scenes) ? raw.scenes : [];
  const proposed = scenesRaw.reduce((a, s) => a + (Array.isArray(s && s.beats) ? s.beats.filter((b) => b && b.kind && b.kind !== 'caption').length : 0), 0);
  const beats = plan.scenes.reduce((a, s) => a + (s.beats ? s.beats.filter((b) => b.kind !== 'caption').length : s.kind !== 'caption' ? 1 : 0), 0);
  const status = proposed === 0 || beats === 0 ? 'warn' : issues.length > 3 ? 'warn' : 'ok';
  const caption = typeof raw.caption === 'string' ? raw.caption.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, 2200) : '';
  return {
    plan, status, caption,
    note: `AI director ${status === 'ok' ? 'ok' : 'needs a look'}: ${proposed} visual beats proposed, ${beats} kept (model ${model})`,
    details: [
      `AI planned ${scenesRaw.filter((s) => s && Array.isArray(s.beats) && s.beats.length).length} of ${parsed.scenes.length} scenes; the rules only filled in what it left out`,
      aiShare(raw),
      `template ${plan.template}, palette ${plan.palette}, texture ${plan.texture}`,
      images.length ? `the AI looked at ${images.length} picture${images.length === 1 ? '' : 's'}` : '',
      parsed.scenes.some((s) => (s.direction || []).length) ? `used the author's production notes in ${parsed.scenes.filter((s) => (s.direction || []).length).length} scenes` : '',
      ...details,
      ...(issues.length ? [`still open after review: ${issues.slice(0, 6).join('; ')}`] : []),
      ...diag.slice(0, 25).map((x) => `rejected in scene ${x.scene}: ${x.reason}`),
    ].filter(Boolean),
  };
}

module.exports = { direct, buildPrompt, parseJson, review };
