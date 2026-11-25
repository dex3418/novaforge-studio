'use strict';
// Reads whatever a person types into the text box, not only a formatted script.
//
//   - plain paragraphs with no "## " headings           -> cut into scenes
//   - "Name: line" dialogue                               -> story mode, cast taken from the speakers
//   - a request on top ("Make this a story in a village") -> the director's request (meta.note), plus the mode,
//                                                            setting and art it names
//   - "Director: ..." lines and (stage directions) / [notes] -> notes for the scene they sit in (never spoken)
//
// It only SORTS the text: spoken words are copied exactly, nothing is invented. It is rules only and deterministic,
// so the same text always gives the same script. The AI director then reads the notes and the request.
// A script that already has "## " scenes is returned untouched.

const { splitHeader, mergeHeader } = require('./header');
const { speakerLine, NOT_NAMES } = require('./story');
const A = require('./story_art');

const DIR_LABEL = /^\s*(?:\*\*)?(?:director|direction|directions|visual|visuals|note|notes|stage|mood|camera|b-?roll)(?:\*\*)?\s*[:\-–]\s*(.+)$/i;
const WRAPPED = /^\s*[(\[]\s*(.{3,200}?)\s*[)\]]\s*$/;
const REQUEST_WORDS = /\b(story|stories|video|reel|carousel|slides?|scene|scenes|character|characters|animation|animated|animate|explainer|chart|diagram|cartoon|clip|short|mode|style|voice|narrat\w*|dialogue|conversation)\b|कहानी/i;
const REQUEST_START = /^\s*(?:please\s+)?(?:(?:can|could|would) you\s+|i\s+(?:want|need|would like)\s+(?:you\s+to\s+)?|let'?s\s+)?(?:make|create|turn|write|build|generate|produce|convert|animate|show|use|add|keep|set|give|draw)\b/i;

const words = (s) => String(s).split(/\s+/).filter(Boolean);
const sentences = (s) => String(s).match(/[^.!?।]+(?:[.!?।]+|$)/g) || [String(s)];
const hasHeadings = (s) => /^#{2,3}\s+\S/m.test(s);

// the kinds of text this module must leave to the other cleaners: pasted documents with labels, tables, section names
const isDocument = (s) => /\*{0,2}Spoken:?\*{0,2}/i.test(s) || /\|\s*-{3,}/.test(s) || /^#{1,3}\s*(?:title options?|outline|full script|narration|voice ?over)\b/im.test(s);

function readRequest(text) {
  const t = String(text);
  const out = {};
  if (/\b(story|stories|dialogue|conversation|characters?|cartoon|animated)\b|कहानी/i.test(t)) out.mode = 'story';
  if (/\b(carousel|slides?|infographic post)\b/i.test(t) && !out.mode) out.mode = 'carousel';
  if (/\bchibi\b/i.test(t)) out.art = 'chibi';
  else if (/\bwebtoon\b/i.test(t)) out.art = 'webtoon';
  for (const s of A.SETTINGS) {
    if (new RegExp(`\\b(?:in|at|inside|on)\\s+(?:a|an|the)?\\s*${s.split(/[_-]+/).join('[ _-]?')}\\b`, 'i').test(t)) { out.setting = s; break; }
  }
  if (/\beleven ?labs\b/i.test(t)) out.engine = 'elevenlabs';
  return out;
}

// capitalised names that appear at least twice and are not at the start of a sentence only: a story told in the third person
const STOP = new Set(['the', 'a', 'an', 'it', 'he', 'she', 'they', 'we', 'i', 'you', 'this', 'that', 'there', 'then', 'when', 'one', 'but', 'and', 'so', 'if', 'in', 'on', 'at', 'as', 'after', 'before', 'now', 'today', 'once', 'every', 'what', 'why', 'how', 'who', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
function namesIn(text) {
  const count = new Map();
  const disp = new Map();
  for (const m of String(text).matchAll(/(?<![\p{L}])([A-Zऀ-ॿ][\p{L}\p{M}]{2,14})(?![\p{L}])/gu)) {
    const low = m[1].toLowerCase();
    if (STOP.has(low) || NOT_NAMES.has(low)) continue;
    count.set(low, (count.get(low) || 0) + 1);
    disp.set(low, m[1]);
  }
  return [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => disp.get(k));
}

// blocks of text -> scenes. A long block is cut at sentence ends into pieces of about 45 words.
function toScenes(blocks) {
  const out = [];
  for (const b of blocks) {
    const lines = b.lines;
    const wc = words(lines.join(' ')).length;
    if (lines.length > 1) { // dialogue or a list: scenes of about 3 lines
      const per = lines.length > 4 ? 3 : lines.length;
      for (let i = 0; i < lines.length; i += per) out.push({ lines: lines.slice(i, i + per), dir: i === 0 ? b.dir : [] });
      continue;
    }
    if (wc <= 60) { out.push({ lines, dir: b.dir }); continue; }
    let cur = [];
    let n = 0;
    let first = true;
    for (const s of sentences(lines[0]).map((x) => x.trim()).filter(Boolean)) {
      cur.push(s);
      n += words(s).length;
      if (n >= 40) { out.push({ lines: [cur.join(' ')], dir: first ? b.dir : [] }); first = false; cur = []; n = 0; }
    }
    if (cur.length) out.push({ lines: [cur.join(' ')], dir: first ? b.dir : [] });
  }
  return out;
}

function interpret(raw) {
  const src = String(raw == null ? '' : raw);
  const head = splitHeader(src);
  const body = head.body;
  const unchanged = { text: src, changed: false, mode: String(head.meta.mode || '').toLowerCase(), notes: [] };
  if (!body.trim() || hasHeadings(body) || isDocument(body)) return unchanged;
  // scripts that already say where scenes start ("Scene 1 - The field") and stories with a story header are handled by the
  // story path in ai_clean.js, which keeps the header and the dialogue word for word
  const { SCENE_MARK } = require('./ai_clean');
  if (body.split(/\r?\n/).some((l) => SCENE_MARK.test(l))) return unchanged;
  if (head.matched && String(head.meta.mode || '').toLowerCase() === 'story') return unchanged;

  const notes = [];
  const rawBlocks = body.split(/\n[ \t]*\n+/).map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);

  // 1. a request on top: the first block, when more text follows and it reads like an instruction
  let request = '';
  const first = rawBlocks[0] ? rawBlocks[0].join(' ') : '';
  if ((rawBlocks.length > 1 || (rawBlocks[0] && rawBlocks[0].length === 1)) && REQUEST_START.test(first) && REQUEST_WORDS.test(first) && !speakerLine(rawBlocks[0][0], [], true)) {
    request = first.replace(/\s+/g, ' ').trim();
    rawBlocks.shift();
    notes.push('the first paragraph was read as your request to the director, not as spoken text');
  }

  // 2. notes to the director inside the text
  const blocks = [];
  let pending = [];
  for (const lines of rawBlocks) {
    const dir = pending.splice(0);
    const speak = [];
    for (const l of lines) {
      const d = l.match(DIR_LABEL);
      const w = l.match(WRAPPED);
      if (d) dir.push(d[1].trim());
      else if (w && words(w[1]).length >= 2) dir.push(w[1].trim());
      else speak.push(l);
    }
    if (!speak.length) { pending = dir; continue; } // a block of notes only: they belong to the next scene
    blocks.push({ lines: speak, dir });
  }
  if (pending.length && blocks.length) blocks[blocks.length - 1].dir.push(...pending);
  if (!blocks.length) {
    // only an idea or an instruction: it becomes the one spoken line so the video still builds
    const idea = (request || first).replace(/\s+/g, ' ').trim();
    if (!idea) return unchanged;
    notes.push('no script text found, only an instruction: it is used as the narration (write the lines you want spoken for a real video)');
    blocks.push({ lines: [idea], dir: [] });
    request = '';
  }
  const dirCount = blocks.reduce((n, b) => n + b.dir.length, 0);
  if (dirCount) notes.push(`${dirCount} note${dirCount === 1 ? '' : 's'} to the director kept out of the narration`);

  // 3. what is this? the header and the request win; then dialogue decides
  const asked = readRequest(request + ' ' + blocks.flatMap((b) => b.dir).join(' '));
  const spoken = blocks.flatMap((b) => b.lines);
  const speakers = new Map();
  let nSpeak = 0;
  for (const l of spoken) {
    const s = speakerLine(l, [], true);
    if (s) { nSpeak++; speakers.set(s.id, s.name); }
  }
  const headMode = String(head.meta.mode || '').toLowerCase();
  let mode = headMode || asked.mode || '';
  const dialogue = nSpeak >= 3 && speakers.size >= 2;
  if (!mode && dialogue) { mode = 'story'; notes.push(`dialogue found (${nSpeak} lines from ${[...speakers.values()].slice(0, 4).join(', ')}): story mode switched on`); }

  const add = [];
  const have = new Set(head.lines.map((l) => l.split(':')[0].trim().toLowerCase()));
  const put = (k, v) => { if (v && !have.has(k)) { add.push(`${k}: ${String(v).replace(/\s+/g, ' ').trim()}`); have.add(k); } };
  if (mode === 'story' || (asked.mode === 'story' && !headMode)) {
    put('mode', 'story');
    if (!String(head.meta.cast || '').trim()) {
      const names = dialogue ? [...speakers.values()] : namesIn(spoken.join(' '));
      if (names.length) { put('cast', names.slice(0, 6).join('; ')); notes.push(`cast taken from the text: ${names.slice(0, 6).join(', ')}`); }
    }
  } else if (mode === 'carousel') put('mode', 'carousel');
  if (asked.setting) put('setting', asked.setting);
  if (asked.art) put('art', asked.art);
  if (asked.engine) put('engine', asked.engine);
  if (request) put('note', request.slice(0, 400));
  // the post title comes from the text; without one the parser would speak the first heading twice
  const firstText = (blocks[0].lines[0] || '').replace(/^[>\-*\u2022]\s+/, '').replace(/^[^:\n]{1,24}:\s+/, '').replace(/[*_`#]/g, '');
  put('title', ((sentences(firstText)[0] || firstText).trim().replace(/[.!?\u0964]+$/, '').slice(0, 80)) || 'Untitled');

  // 4. scenes
  const scenes = toScenes(blocks);
  // a short label from the scene's own words (the full text stays in the body, so every word is still spoken)
  const label = (s, i) => {
    const t = (s.lines[0] || '').replace(/^[>\-*\u2022]\s+/, '').replace(/^[^:\n]{1,24}:\s+/, '').replace(/[*_`#]/g, '');
    const w = words((sentences(t)[0] || '').replace(/[.!?\u0964,;:]+$/g, '')).slice(0, 5).join(' ');
    return /^(?:slide|scene|part)\s*\d+/i.test(w) || !w ? `Beat ${i + 1}` : w.charAt(0).toUpperCase() + w.slice(1);
  };
  const lines = [];
  scenes.forEach((s, i) => {
    lines.push(`## ${label(s, i)}`);
    s.dir.forEach((d) => lines.push(`<!--dir: ${d.replace(/-->/g, '')}-->`));
    s.lines.forEach((l) => lines.push(l.replace(/^[>\-*•]\s+/, ''), ''));
  });
  notes.push(`${scenes.length} scene${scenes.length === 1 ? '' : 's'} made from your text`);
  const text = mergeHeader(lines.join('\n').trim() + '\n', head.matched ? head.lines.concat(add) : add);
  return { text, changed: true, mode: mode || 'normal', notes, request, scenes: scenes.length };
}

module.exports = { interpret, readRequest, namesIn, toScenes };
