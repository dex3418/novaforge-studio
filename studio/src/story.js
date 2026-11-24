'use strict';
// Story mode: a cast of characters (each with a look and their own voice), a script where lines
// are spoken by named people, and a storyboard that turns every beat into a drawn scene.
//
//   header:  cast: Ramu (man, turban, moustache, madhur); Sita (woman, saree); Chhotu (boy)
//            setting: village        (optional default place)
//   script:  Ramu: How do I apply for the scheme?
//            Sita: Bring your Aadhaar and go to the office.
//            plain lines (no name) are the narrator and are not drawn as a person.
//
// The storyboard is made of library items only (places, props, poses, expressions), so a bad
// plan can never break a render: anything unknown is replaced.

const A = require('./story_art');
const CHARS = require('./characters');
const SHOTS = require('./shots');
const BLK = require('./blocking');
const { ICONS } = require('./icons');
const { VOICES, DEFAULT_VOICE } = require('./catalog');

const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'x';
const NARRATOR = 'narrator';
const NOT_NAMES = new Set(['note', 'tip', 'tips', 'step', 'caption', 'fact', 'myth', 'q', 'a', 'question', 'answer', 'warning', 'important', 'source', 'sources', 'cta', 'hook', 'title', 'scene', 'slide', 'part', 'time', 'visual', 'on screen', 'text', 'voiceover', 'vo']);

// ------------------------------------------------------------------ cast
const WORD = {
  gender: { man: 'm', male: 'm', boy: 'm', he: 'm', father: 'm', farmer: 'm', woman: 'f', female: 'f', girl: 'f', she: 'f', mother: 'f', lady: 'f' },
  age: { child: 'child', kid: 'child', boy: 'child', girl: 'child', baby: 'child', old: 'elder', elder: 'elder', elderly: 'elder', grandfather: 'elder', grandmother: 'elder', grandpa: 'elder', grandma: 'elder', dada: 'elder', dadi: 'elder', nana: 'elder', nani: 'elder' },
  hair: { turban: 'turban', pagdi: 'turban', cap: 'cap', bun: 'bun', long: 'long', short: 'short', bald: 'bald', curly: 'curly' },
  outfit: { saree: 'saree', sari: 'saree', kurta: 'kurta', suit: 'suit', uniform: 'uniform', police: 'uniform', dress: 'dress', shirt: 'shirt' },
};

function allVoices() {
  return [...VOICES.edge.map((v) => ({ id: v.id, engine: 'edge' })), ...VOICES.elevenlabs.map((v) => ({ id: v.id, engine: 'elevenlabs' }))];
}
function matchVoice(tok) {
  const t = tok.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  return allVoices().find((v) => v.id.toLowerCase().replace(/[^a-z]/g, '') === t) || allVoices().find((v) => v.id.toLowerCase().startsWith(t) && t.length >= 4) || allVoices().find((v) => new RegExp(`-${t}(?:multilingual|expressive)?neural$`, 'i').test(v.id)) || null;
}

function parseCast(str) {
  const out = [];
  for (const part of String(str || '').split(/;|\n/)) {
    const m = part.trim().match(/^([^(:=]{1,24}?)\s*(?:[(:=]\s*([^)]*)\)?)?$/u);
    if (!m || !m[1].trim()) continue;
    const name = m[1].trim().replace(/^["']|["']$/g, '');
    if (!name || NOT_NAMES.has(name.toLowerCase())) continue;
    const c = { id: slug(name), name, look: {}, voice: '', explicit: {} };
    for (const raw of String(m[2] || '').split(/[,/]/)) {
      const tok = raw.trim();
      if (!tok) continue;
      const low = tok.toLowerCase();
      if (WORD.gender[low]) c.look.gender = c.look.gender || WORD.gender[low];
      if (WORD.age[low]) c.look.age = WORD.age[low];
      if (WORD.hair[low]) c.look.hair = WORD.hair[low];
      if (WORD.outfit[low]) c.look.outfit = WORD.outfit[low];
      if (low === 'glasses' || low === 'specs') c.look.glasses = true;
      if (low === 'beard') c.look.beard = true;
      if (low === 'moustache' || low === 'mustache') c.look.moustache = true;
      const colour = low.match(/^(?:shirt|top|dress|color|colour)?[ =:]*([a-z]+)$/);
      if (colour && A.COLORS[colour[1]] && !WORD.gender[low]) c.look.top = A.COLORS[colour[1]];
      const hex = tok.match(/#[0-9a-f]{6}/i);
      if (hex) c.look.top = hex[0];
      const sk = low.match(/^skin\s*[=:]?\s*([1-6])$/);
      if (sk) c.look.skin = A.SKIN[Number(sk[1]) - 1];
      const v = matchVoice(tok);
      if (v && !WORD.gender[low] && !WORD.age[low] && !WORD.hair[low] && !WORD.outfit[low]) c.voice = v.id;
    }
    if (c.look.hair === 'turban' || c.look.hair === 'cap') c.look.hat = c.look.top ? A.shade(c.look.top, 0) : undefined;
    if (!out.find((x) => x.id === c.id)) out.push(c);
  }
  return out.slice(0, 8);
}

// "mode: carousel" is an explicit no, even when a cast line is left in the header
const isStoryMeta = (meta) => !!meta && String(meta.mode || '').toLowerCase() !== 'carousel' && (String(meta.mode || '').toLowerCase() === 'story' || !!String(meta.cast || '').trim());

// a line that starts with "Name:" or "Name (tone):"  -> { name, tone, text }
function speakerLine(line, known, loose) {
  const m = String(line).match(/^\s*(?:\*\*)?([\p{L}][\p{L}\p{M}0-9 .'\-]{0,22}?)(?:\*\*)?\s*(?:\(([^)]{1,30})\))?\s*(?:\*\*)?:(?:\*\*)?\s+(\S[\s\S]*)$/u);
  if (!m) return null;
  const name = m[1].trim();
  const low = name.toLowerCase();
  if (NOT_NAMES.has(low)) return null;
  const hit = known.find((c) => c.name.toLowerCase() === low || c.id === slug(name));
  if (!hit && !loose) return null;
  if (!hit && (name.split(/\s+/).length > 3 || /^\d/.test(name))) return null;
  return { name: hit ? hit.name : name, id: hit ? hit.id : slug(name), tone: (m[2] || '').trim().toLowerCase(), text: m[3].trim(), isNew: !hit };
}

// give everyone a distinct voice that fits the engine (explicit ones win)
function assignVoices(cast, engine, narratorVoice, lines) {
  const eleven = engine === 'elevenlabs';
  const pools = eleven ? { m: ['CwhRBWXzGAHq8TQ4Fs17', 'JBFqnCBsd6RMkjVDRZzb', 'IKne3meq5aSn9XLyUdCD', 'bIHbv24MWmeRgasZH58o', 'N2lVS1w4EtoT3dr4eOWO'], f: ['EXAVITQu4vr4xnSDxMaL', 'Xb7hH8MSUJpSbSDYk0k2', 'XrExE9yKIg1WjnnlVkGX', 'FGY2WhTYpPnrIDTdsKH5'], c: ['TX3LPaxmHKxFdv7VOQHJ', 'FGY2WhTYpPnrIDTdsKH5'] } : { m: ['en-IN-PrabhatNeural', 'hi-IN-MadhurNeural', 'en-US-AndrewMultilingualNeural', 'en-US-BrianMultilingualNeural'], f: ['en-IN-NeerjaExpressiveNeural', 'hi-IN-SwaraNeural', 'en-US-AvaMultilingualNeural', 'en-US-EmmaMultilingualNeural'], c: ['hi-IN-SwaraNeural', 'en-US-AvaMultilingualNeural', 'en-IN-NeerjaExpressiveNeural'] };
  const ok = (id) => VOICES[eleven ? 'elevenlabs' : 'edge'].some((v) => v.id === id);
  const used = new Set([narratorVoice || DEFAULT_VOICE[eleven ? 'elevenlabs' : 'edge']]);
  cast.forEach((c) => { if (c.voice && ok(c.voice)) used.add(c.voice); });
  cast.forEach((c, i) => {
    if (c.voice && ok(c.voice)) return;
    const g = c.look.age === 'child' ? 'c' : c.look.gender || (A.hashStr(c.name) % 2 ? 'm' : 'f');
    const hindi = !eleven && (lines || []).some((l) => l.who === c.id && /[ऀ-ॿ]/.test(l.text));
    let pool = pools[g] || pools.m;
    if (hindi) pool = [...pool.filter((v) => /^hi-IN/.test(v)), ...pool.filter((v) => !/^hi-IN/.test(v))];
    c.voice = pool.find((v) => !used.has(v)) || pool[i % pool.length];
    used.add(c.voice);
  });
  return cast;
}

// ------------------------------------------------------------------ reading a scene
// lines -> speaker for every narration word
function wordSpeakers(sc) {
  const out = [];
  for (const l of sc.lines || []) {
    const n = String(l.narration || '').split(/\s+/).filter(Boolean).length;
    for (let i = 0; i < n; i++) out.push(l.who || NARRATOR);
  }
  return out;
}

const RX = {
  night: /\bnight\b|midnight|\braat\b|रात|अंधेर|\bdark\b/i,
  dusk: /evening|sunset|dusk|शाम|\bsandhya\b/i,
  office: /office|govt|government|department|counter|\bform\b|application|\bbank\b|clerk|दफ्तर|कार्यालय|ऑफिस|आवेदन|फॉर्म|\bdesk\b|computer|portal/i,
  home: /\bhome\b|\bghar\b|घर|kitchen|\broom\b|family|परिवार|bedroom|\bhouse\b/i,
  street: /market|\broad\b|street|\bcity\b|\bshop\b|bazaar|बाज़ार|बाजार|सड़क|शहर|station|traffic|\bbus\b|\bcar\b|\bmall\b/i,
  field: /\bfarm|khet|खेत|\bfield|\bcrop|फसल|kisan|किसान|tractor|ट्रैक्टर|harvest/i,
  village: /village|\bgaon\b|गाँव|गांव|\bhut\b|bastar|बस्तर|jungle|forest|tribal|जंगल/i,
};
const PROPKEYS = [
  ['car', /\bcar\b|\bgaadi\b|गाड़ी|\bjeep\b|vehicle/i], ['bus', /\bbus\b|बस\b/i], ['tractor', /tractor|ट्रैक्टर/i],
  ['school', /school|स्कूल|college|class|कॉलेज/i], ['hospital', /hospital|clinic|doctor|अस्पताल|health/i], ['shop', /\bshop\b|market|दुकान|बाज़ार|store/i],
  ['bank', /\bbank\b|बैंक|\batm\b/i], ['office', /office|कार्यालय|दफ्तर|department/i], ['house', /\bhouse\b|\bhome\b|\bghar\b|घर|मकान/i],
  ['hut', /\bhut\b|झोपड़ी|village|गाँव|गांव/i], ['tree', /\btree|पेड़|forest|जंगल|\bmango|\bneem/i], ['board', /\bboard\b|notice|poster|sign|नोटिस|सूचना/i],
  ['bench', /\bbench\b|\bsit\b|बैठ/i], ['desk', /\bdesk\b|counter|table|मेज|कंप्यूटर|computer/i], ['lamp', /\blamp\b|\blight\b|streetlight|बत्ती/i],
];
// learned props and landscapes (Learning Studio) are recognised by their own name in the script: "market_stall" matches "market stall(s)"
const nameRx = (n) => new RegExp(`\\b${n.split(/[_-]+/).join('[ _-]?')}s?\\b`, 'i');
for (const n of A.SETTINGS) if (!RX[n]) RX[n] = nameRx(n);
for (const n of A.LEARNED_PROPS) if (!PROPKEYS.some(([k]) => k === n)) PROPKEYS.push([n, nameRx(n)]);
const TONE = {
  laugh: /haha|lol|laugh|funny|joke|हँस|हंस|मज़ाक|मजाक/i,
  cry: /\bcry|crying|tears|रो\b|रोने|आँसू|आंसू/i,
  sleep: /sleep|नींद|सोया|सो गया|सो गई/i,
  tired: /tired|exhaust|थक/i,
  love: /\blove|प्यार|पसंद/i,
  thumbs: /\bok\b|okay|perfect|well done|सही|बढ़िया|शाबाश/i,
  peace: /\bpeace\b|victory|selfie|smile please/i,
  refuse: /refuse|\bnever\b|\bno way\b|नहीं चाहिए|कभी नहीं|मना/i,
  fist: /let's go|lets go|determined|we can|ready\b|चलो|हिम्मत|जीतेंगे|तैयार/i,
  celebrate: /congrat|success|won\b|selected|passed|yay|हुर्रे|बधाई|सफल|चयन|जीत|great news|hurray/i,
  worried: /worr|problem|lost|loan|debt|late\b|trouble|scam|fraud|चिंता|परेशान|दिक्कत|मुश्किल|डर/i,
  wave: /\bhello\b|\bhi\b|namaste|नमस्ते|bye\b|welcome|स्वागत/i,
  point: /\blook\b|\bsee\b|\bhere\b|\bthis\b|\bthat\b|देख|यहाँ|यहां|यह\b|वह\b|\bcheck\b/i,
  think: /\bthink|maybe|\bhow\b|\bwhy\b|क्या\b|कैसे|क्यों|सोच|\bwonder/i,
  shrug: /don't know|do not know|not sure|पता नहीं|शायद/i,
  walk: /\bgo\b|\bgoes\b|went|\bwalk|\bcome\b|came|reach|arrive|\bvisit|चल|जा\b|जाओ|पहुँच|पहुंच|आया|आई|जाना/i,
  happy: /happy|great|good|thank|free\b|easy|खुश|धन्यवाद|शुक्रिया|आसान|मुफ्त|अच्छ|मज़ा/i,
  sad: /\bsad\b|sorry|cry|दुख|रो\b|उदास|माफ़/i,
  angry: /angry|\bunfair|cheat|गुस्सा|धोखा|नाराज/i,
  surprised: /\bwow\b|really\?|\bwhat\b|सच\?|अरे|क्या बात|कमाल|unbelievable|amazing/i,
};

function pickSetting(text, fallback, opening) {
  const order = ['office', 'field', 'street', 'home', 'village', ...A.SETTINGS.filter((k) => !['office', 'field', 'street', 'home', 'village'].includes(k))];
  const count = (rx, t) => (String(t).match(new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g')) || []).length;
  let best = fallback;
  let top = 0;
  for (const k of order) {
    const sc = count(RX[k], text) + 2 * count(RX[k], opening || '');
    if (sc > top) { top = sc; best = k; }
  }
  return best;
}
const pickTime = (text, fallback) => (RX.night.test(text) ? 'night' : RX.dusk.test(text) ? 'dusk' : fallback);

// ------------------------------------------------------------------ normalise an AI / rule storyboard
const inRange = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.max(a, Math.min(b, Number(v))) : d);

function normalizeStory(d, castIds, fallback) {
  const f = fallback || { setting: 'village', time: 'day', actors: [], props: [], camera: { z0: 1, z1: 1.05, fx0: 0.5 } };
  const o = d && typeof d === 'object' ? d : {};
  const setting = A.SETTINGS.includes(o.setting) ? o.setting : f.setting;
  const time = A.TIMES.includes(o.time) ? o.time : f.time;
  const actors = [];
  for (const a of Array.isArray(o.actors) ? o.actors : []) {
    if (!a || !castIds.includes(a.id) || actors.find((x) => x.id === a.id)) continue;
    const x0 = inRange(a.x0 != null ? a.x0 : a.x, -0.3, 1.3, 0.5);
    actors.push({
      id: a.id, x0, x1: inRange(a.x1 != null ? a.x1 : x0, -0.3, 1.3, x0),
      facing: a.facing === -1 ? -1 : 1, ...(Number.isFinite(Number(a.faceTo)) ? { faceTo: inRange(a.faceTo, -0.3, 1.3, 0.5) } : {}),
      pose: A.POSES.includes(a.pose) || CHARS.extraPoses().includes(a.pose) ? a.pose : 'idle', expr: A.EXPR[a.expr] || CHARS.extraExpressions().includes(a.expr) ? a.expr : 'neutral',
      speaks: !!a.speaks, ...(Number.isFinite(Number(a.delay)) ? { delay: inRange(a.delay, 0, 1.5, 0.12) } : {}),
    });
    if (actors.length >= 4) break;
  }
  const props = [];
  for (const p of Array.isArray(o.props) ? o.props : []) {
    if (!p || !A.PROPS[p.type]) continue;
    const x = inRange(p.x, -0.2, 1.2, 0.5);
    props.push({ type: p.type, x, ...(A.MOVERS.has(p.type) ? { x1: inRange(p.x1, -0.4, 1.4, x > 0.5 ? -0.3 : 1.3) } : {}), scale: inRange(p.scale, 0.4, 1.6, 1), ...(p.layer === 'front' ? { layer: 'front' } : {}), ...(typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? { color: p.color } : {}) });
    if (props.length >= 5) break;
  }
  const c = o.camera && typeof o.camera === 'object' ? o.camera : {};
  const fc = f.camera || {};
  // a named shot (top level "shot"/"on" or inside "camera") is checked against the shot library: an invented name becomes the nearest real shot
  const shotIn = { shot: o.shot != null ? o.shot : c.shot, on: o.on != null ? o.on : c.on, shake: c.shake || o.shake };
  const shotCam = SHOTS.cleanCamera(shotIn, actors.map((a) => a.id), null);
  const camera = shotCam ? shotCam : fc.shot && !(c.z0 != null || c.z1 != null || c.fx0 != null) ? { ...fc } : {
    z0: inRange(c.z0, 0.9, 1.6, fc.z0 || 1), z1: inRange(c.z1, 0.9, 1.6, fc.z1 || fc.z0 || 1),
    fx0: inRange(c.fx0, 0, 1, fc.fx0 == null ? 0.5 : fc.fx0), fx1: inRange(c.fx1, 0, 1, c.fx0 != null ? inRange(c.fx0, 0, 1, 0.5) : fc.fx1 == null ? (fc.fx0 == null ? 0.5 : fc.fx0) : fc.fx1),
    ...(c.shake ? { shake: true } : {}),
  };
  const blocked = BLK.analyse(actors.length || !castIds.length ? actors : f.actors);
  const out = { setting, time, actors: blocked.actors, props: props.length ? props : f.props, camera };
  if (blocked.warnings.length) out.notes = blocked.warnings.map((w) => w.msg);
  if (typeof o.icon === 'string' && ICONS[o.icon]) { out.icon = o.icon; if (castIds.includes(o.iconOf)) out.iconOf = o.iconOf; }
  return out;
}

// ------------------------------------------------------------------ rule storyboard
function layoutX(n, k) { return [[0.5], [0.27, 0.73], [0.18, 0.5, 0.82], [0.14, 0.38, 0.62, 0.86]][Math.min(3, n - 1)][k]; }
const has = (rx, t) => rx.test(t);

function toneOf(text, tone) {
  const t = `${tone || ''} ${text}`;
  let pose = 'idle';
  let expr = 'neutral';
  if (has(TONE.laugh, t)) { expr = 'laugh'; pose = 'talk'; }
  else if (has(TONE.cry, t)) { expr = 'cry'; }
  else if (has(TONE.sleep, t)) { expr = 'sleep'; }
  else if (has(TONE.tired, t)) { expr = 'tired'; pose = 'shrug'; }
  else if (has(TONE.love, t)) { expr = 'love'; }
  else if (has(TONE.refuse, t)) { pose = 'crossed'; expr = 'angry'; }
  else if (has(TONE.fist, t)) { pose = 'fist'; expr = 'happy'; }
  else if (has(TONE.thumbs, t)) { pose = 'thumbsup'; expr = 'happy'; }
  else if (has(TONE.peace, t)) { pose = 'peace'; expr = 'wink'; }
  else if (has(TONE.celebrate, t)) { pose = 'celebrate'; expr = 'happy'; }
  else if (has(TONE.worried, t)) { pose = 'worried'; expr = 'worried'; }
  else if (has(TONE.wave, t)) { pose = 'wave'; expr = 'happy'; }
  else if (has(TONE.shrug, t)) { pose = 'shrug'; expr = 'thinking'; }
  else if (has(TONE.point, t) && !/\?/.test(text)) { pose = 'point'; }
  else if (has(TONE.think, t) || /\?\s*$/.test(text)) { pose = 'think'; expr = 'thinking'; }
  if (['laugh', 'cry', 'sleep', 'tired', 'love', 'wink'].includes(expr)) { /* keep the strong feeling */ }
  else if (has(TONE.angry, t)) expr = 'angry';
  else if (has(TONE.sad, t)) expr = 'sad';
  else if (has(TONE.surprised, t)) expr = 'surprised';
  else if (expr === 'neutral' && has(TONE.happy, t)) expr = 'happy';
  if (/\bangry\b/.test(tone || '')) expr = 'angry';
  if (/\bsad\b/.test(tone || '')) expr = 'sad';
  if (/\bhappy|excited\b/.test(tone || '')) expr = 'happy';
  if (/\bworried|scared\b/.test(tone || '')) expr = 'worried';
  return { pose, expr };
}

// Apply the storyboard to a validated plan (in place). pickIcon(text) comes from plan.js.
const KEEP = new Set(['counter', 'stats', 'bars', 'progress', 'compare', 'mythfact', 'qa', 'cta', 'alert', 'terminal', 'photo', 'profile']);

function applyStory(plan, parsed, helpers = {}) {
  const meta = parsed.meta || {};
  const cast = parsed.cast || [];
  if (!isStoryMeta(meta) && !cast.length) return;
  const ids = cast.map((c) => c.id);
  assignVoices(cast, meta.engine === 'elevenlabs' ? 'elevenlabs' : 'edge', meta.voice, parsed.scenes.flatMap((s) => s.lines || []));
  plan.art = ['chibi', 'webtoon'].includes(String(meta.art || '').toLowerCase()) ? String(meta.art).toLowerCase() : 'flat';
  plan.cast = cast.map((c) => ({ id: c.id, name: c.name, look: c.look, voice: c.voice }));
  const defaultSetting = A.SETTINGS.includes(meta.setting) ? meta.setting : 'village';
  const words = (t) => String(t).split(/\s+/).filter(Boolean);
  const pos = {}; // id -> x at the end of the previous beat
  let prevSetting = '';
  let beatNo = 0;
  let lastBubble = -9;
  let prevShot = '';
  let bigPrev = false;

  parsed.scenes.forEach((sc, si) => {
    const s = plan.scenes.find((x) => x.index === sc.index);
    if (!s) return;
    const text = `${sc.heading} ${sc.body}`;
    const opening = (sc.lines || []).filter((l) => l.who === NARRATOR).map((l) => l.text).join(' ').split(/(?<=[.!?])\s/)[0] || '';
    const setting = pickSetting(text, prevSetting || defaultSetting, opening);
    const time = pickTime(text, 'day');
    if (setting !== prevSetting) Object.keys(pos).forEach((k) => delete pos[k]);
    prevSetting = setting;
    const spk = wordSpeakers(sc);
    const nw = words(sc.narration).length;
    const inScene = [];
    spk.forEach((w) => { if (w !== NARRATOR && ids.includes(w) && !inScene.includes(w)) inScene.push(w); });
    const keys = PROPKEYS.filter(([, rx]) => rx.test(text)).map(([k]) => k);
    const units = s.beats && s.beats.length > 1 ? s.beats : [s];

    // scenery for this scene (stays the same through its beats)
    const still = [];
    const slots = [0.9, 0.1, 0.5];
    const wantBack = keys.filter((k) => !A.MOVERS.has(k)).slice(0, 3);
    if (!wantBack.length) wantBack.push(...({ village: ['hut', 'tree'], street: ['lamp', 'shop'], field: ['bush', 'tree'], office: ['desk'], home: [] }[setting] || []));
    wantBack.forEach((k, i) => still.push({ type: k, x: k === 'desk' ? 0.5 : slots[i % 3], scale: k === 'desk' ? 1 : i === 2 ? 0.6 : 0.85, layer: 'back' }));
    let movedOnce = false;

    units.forEach((u, k) => {
      beatNo++;
      const fromW = units === s.beats ? u.from : 0;
      const toW = units === s.beats ? u.to : nw;
      const btext = words(sc.narration).slice(fromW, toW).join(' ');
      const bsp = spk.slice(fromW, toW);
      const count = {};
      bsp.forEach((w) => { count[w] = (count[w] || 0) + 1; });
      const main = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || NARRATOR;
      const talker = main !== NARRATOR && ids.includes(main) ? main : '';
      if (KEEP.has(u.kind)) return; // data visuals (numbers, comparisons, pictures) stay as planned
      // who is on stage
      let onStage = [];
      if (talker) onStage.push(talker);
      inScene.forEach((id) => { if (!onStage.includes(id)) onStage.push(id); });
      if (!onStage.length && cast.length) onStage = [cast[0].id];
      onStage = onStage.slice(0, 3);
      const tn = toneOf(btext, (sc.lines || []).find((l) => l.who === talker && btext.includes(String(l.narration).split(/\s+/)[0]))?.tone);
      const moveText = has(TONE.walk, btext);
      const actors = onStage.map((id, i) => {
        const target = layoutX(onStage.length, i);
        const had = pos[id] != null;
        let x0 = had ? pos[id] : i % 2 ? 1.18 : -0.18;
        let x1 = target;
        if (had && !moveText && Math.abs(pos[id] - target) < 0.3) x1 = pos[id]; // stay put
        if (had && moveText && !talker && Math.abs(x1 - x0) < 0.25) x1 = x0 < 0.5 ? 0.78 : 0.22;
        pos[id] = x1;
        const isT = id === talker;
        const faceOther = onStage.length > 1 ? (layoutX(onStage.length, i) < 0.5 ? 1 : -1) : x1 >= x0 ? 1 : -1;
        return {
          id, x0, x1, facing: onStage.length > 1 ? faceOther : x1 >= x0 ? 1 : -1,
          pose: isT ? tn.pose : onStage.length === 1 && !talker ? (moveText ? 'walk' : tn.pose) : 'idle',
          expr: isT || onStage.length === 1 ? tn.expr : 'neutral', speaks: isT,
        };
      });
      // props: the scene's scenery plus a car or bus driving by when mentioned
      const props = still.map((p) => ({ ...p, scale: p.scale }));
      const mover = ['car', 'bus', 'tractor'].find((m) => keys.includes(m));
      if (mover && (!movedOnce || has(new RegExp(mover === 'bus' ? '\\bbus\\b' : mover === 'car' ? '\\bcar\\b|गाड़ी' : 'tractor|ट्रैक्टर', 'i'), btext))) {
        movedOnce = true;
        const dir = (beatNo + si) % 2 ? 1 : -1;
        props.push({ type: mover, x: dir > 0 ? -0.25 : 1.25, x1: dir > 0 ? 1.3 : -0.3, scale: mover === 'car' ? 0.95 : 0.8, color: ['#e5484d', '#2f6fd6', '#f2b705', '#29b937'][(beatNo + si) % 4] });
      }
      // camera: the shot grammar picks a named shot (wide to open, medium for dialogue, close-up on the emotional line,
      // a reaction shot after big news, never the same shot twice, short beats get no slow moves)
      const sx = actors.find((a) => a.speaks);
      const big = /!/.test(btext) && has(TONE.surprised, btext);
      const nm = words(btext).length;
      const shot = SHOTS.planShot({
        first: k === 0 && si === 0, moving: actors.some((a) => Math.abs(a.x1 - a.x0) > 0.25) || (actors.length === 1 && moveText),
        n: actors.length, expr: sx ? sx.expr : actors[0] ? actors[0].expr : 'neutral', big, after: bigPrev, sec: nm / 2.6,
      }, prevShot);
      const camera = { shot };
      const on = shot === 'reaction' ? (actors.find((a) => !a.speaks) || actors[0]) : sx || actors[0];
      if (on) camera.on = on.id;
      bigPrev = big;
      if (big) camera.shake = true;
      const d = { setting, time, actors, props, camera };
      if (helpers.pickIcon && beatNo - lastBubble >= 3 && actors.length) {
        const ic = helpers.pickIcon(btext);
        if (ic && ICONS[ic]) { d.icon = ic; d.iconOf = (actors.find((a) => a.speaks) || actors[0]).id; lastBubble = beatNo; }
      }
      const mine = normalizeStory(d, ids);
      const given = u.kind === 'story' && u.data && Array.isArray(u.data.actors) ? normalizeStory(u.data, ids, mine) : null;
      u.kind = 'story';
      u.data = given || mine; // the AI's own storyboard wins when it is valid
      {
        // the AI's shots are held to the same grammar: same shot twice in a row is swapped for a close relative
        const cm = u.data.camera || {};
        if (cm.shot) {
          const better = SHOTS.breakRepeat(cm.shot, prevShot, u.data.actors.length, nm / 2.6);
          if (better !== cm.shot) { cm.shot = better; cm.fixedFrom = 'repeat'; }
          if (!cm.on && u.data.actors.length) cm.on = (u.data.actors.find((a) => a.speaks) || u.data.actors[0]).id;
          prevShot = cm.shot;
        } else prevShot = '';
      }
      u.data.actors.forEach((a) => { if (talker) a.speaks = a.id === talker; pos[a.id] = a.x1; });
    });
    // the scene itself (carousel + fallback) shows its first story beat
    if (s.beats && s.beats.length > 1) {
      const first = s.beats.find((b) => b.kind === 'story');
      if (first) { s.kind = 'story'; s.data = JSON.parse(JSON.stringify(first.data)); }
    }
  });
}

module.exports = { parseCast, isStoryMeta, speakerLine, assignVoices, wordSpeakers, normalizeStory, applyStory, slug, NARRATOR, NOT_NAMES };
