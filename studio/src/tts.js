'use strict';
// Voice for one scene.
//   engine 'edge'   : free Edge voices, exact word timing (default)
// Only the free Edge voices are offered for now. A script that still says engine: gemini is voiced by Edge too.
// (Paid voices such as ElevenLabs can come back later as another engine.)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { VOICES, DEFAULT_VOICE } = require('./catalog');
const natural = require('./natural');

const hasDevanagari = (t) => /[ऀ-ॿ]/.test(t);
const edgeIds = new Set(VOICES.edge.map((v) => v.id));

function readTiming(file) {
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    return t && t.marks && t.marks.length ? t : null;
  } catch (e) {
    return null;
  }
}

function edgeOnce(text, outFile, voice, rate) {
  const jsonFile = outFile.replace(/\.mp3$/i, '') + '.timing.json';
  const helper = path.join(__dirname, 'tts.py');
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execFileSync('python3', [helper, voice, rate, outFile, jsonFile], { input: text, stdio: ['pipe', 'ignore', 'inherit'] });
      return { timing: readTiming(jsonFile) };
    } catch (e) {
      lastErr = e;
      console.warn(`  Edge voice ${voice}: attempt ${attempt} failed`);
    }
  }
  try {
    execFileSync('python3', ['-m', 'edge_tts', '--voice', voice, `--rate=${rate}`, `--text=${text}`, '--write-media', outFile], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.warn('  WARNING: voice made without timing, captions will be approximate.');
    return { timing: null };
  } catch (e) {
    lastErr = e;
  }
  throw lastErr;
}


// Sentence-by-sentence Edge voice with its own rate/pitch/volume per sentence, pauses between
// sentences and a light audio polish. Returns { timing } like edgeOnce, or throws (caller falls back).
function edgeHuman(text, outFile, voice, baseRate, emotion) {
  const chunks = natural.plan(text, parseInt(baseRate, 10) || 0, emotion);
  if (!chunks.length) throw new Error('nothing to say');
  const prefix = outFile.replace(/\.mp3$/i, '') + '.part';
  const helper = path.join(__dirname, 'tts.py');
  execFileSync('python3', [helper, '--batch', voice, prefix], { input: JSON.stringify(chunks), stdio: ['pipe', 'ignore', 'inherit'] });
  const files = chunks.map((_, i) => `${prefix}.${i}.mp3`);
  const durs = files.map((f) => durationSeconds(f));
  const n = chunks.length;
  const parts = [];
  const marks = [];
  let kind = 'word';
  let t = 0;
  chunks.forEach((c, i) => {
    const tj = readTiming(`${prefix}.${i}.json`);
    if (!tj) kind = 'none';
    else {
      if (tj.kind !== 'word' && kind === 'word') kind = tj.kind;
      for (const m of tj.marks) marks.push({ text: m.text, start: t + m.start, end: t + Math.min(m.end, durs[i]) });
    }
    parts.push(`[${i}:a]aresample=24000,apad=pad_dur=${(c.pause / 1000).toFixed(3)}[a${i}]`);
    t += durs[i] + c.pause / 1000;
  });
  const filter = parts.join(';') + ';' + chunks.map((_, i) => `[a${i}]`).join('') + `concat=n=${n}:v=0:a=1,${natural.POLISH}[out]`;
  const args = ['-y', '-v', 'error'];
  files.forEach((f) => args.push('-i', f));
  args.push('-filter_complex', filter, '-map', '[out]', '-ar', '44100', '-ac', '1', '-b:a', '128k', outFile);
  execFileSync('ffmpeg', args);
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(f.replace(/\.mp3$/, '.json')); } catch (e) { /* ignore */ }
  }
  return { timing: kind === 'none' || !marks.length ? null : { kind, marks }, natural: true };
}

function edgeSynth(text, outFile, voice, rate, emotion) {
  const pick = voice && (edgeIds.has(voice) || /Neural$/.test(voice)) ? voice : '';
  const def = hasDevanagari(text) ? 'hi-IN-SwaraNeural' : DEFAULT_VOICE.edge;
  const first = pick || def;
  try {
    if (process.env.NF_NATURAL !== '0' && emotion !== false) {
      try {
        return { ...edgeHuman(text, outFile, first, rate, emotion || 'neutral'), voice: first };
      } catch (e) {
        console.warn(`  Natural delivery failed (${String(e.message).slice(0, 120)}). Using the plain voice for this scene.`);
      }
    }
    return { ...edgeOnce(text, outFile, first, rate), voice: first };
  } catch (e) {
    if (first === def) throw new Error('edge-tts failed. Is it installed? pip install edge-tts\n' + e.message);
    console.warn(`  Voice ${first} did not work, using ${def}`);
    return { ...edgeOnce(text, outFile, def, rate), voice: def };
  }
}

// rate: "+6%" style string. Returns { timing, engine, voice }.
async function synth(text, outFile, o = {}) {
  const rate = /^[+-]\d+%$/.test(o.rate || '') ? o.rate : '+0%';
  const r = edgeSynth(text, outFile, o.voice, rate, o.emotion);
  return { ...r, engine: 'edge' };
}


// Several people in one scene: each line is spoken by that person's own voice, then joined.
// lines: [{ who, narration, tone }]; voiceOf(who) -> voice id ('' = the narrator voice).
// Returns { timing, engine, voice, natural } like synth, with marks for the whole scene.
async function synthLines(lines, outFile, o, voiceOf) {
  const parts = [];
  const marks = [];
  let kind = 'word';
  let t = 0;
  const list = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = outFile.replace(/\.mp3$/i, '') + `.line${i}.mp3`;
    const r = await synth(l.narration, f, { ...o, voice: voiceOf(l.who) || o.voice, emotion: /worr|sad/.test(l.tone || '') ? 'serious' : /happy|excit/.test(l.tone || '') ? 'excited' : /ask|curious/.test(l.tone || '') ? 'curious' : o.emotion });
    const dur = durationSeconds(f);
    const pause = i < lines.length - 1 ? (l.who === lines[i + 1].who ? 0.18 : 0.32) : 0;
    if (!r.timing) kind = 'none';
    else {
      if (r.timing.kind !== 'word' && kind === 'word') kind = r.timing.kind;
      for (const m of r.timing.marks) marks.push({ text: m.text, start: t + m.start, end: t + Math.min(m.end, dur) });
    }
    list.push({ f, pause, engine: r.engine, voice: r.voice });
    t += dur + pause;
  }
  const filter = list.map((x, i) => `[${i}:a]aresample=44100,apad=pad_dur=${x.pause.toFixed(3)}[a${i}]`).join(';') + ';' + list.map((_, i) => `[a${i}]`).join('') + `concat=n=${list.length}:v=0:a=1[out]`;
  const args = ['-y', '-v', 'error'];
  list.forEach((x) => args.push('-i', x.f));
  args.push('-filter_complex', filter, '-map', '[out]', '-ac', '1', '-b:a', '128k', outFile);
  execFileSync('ffmpeg', args);
  list.forEach((x) => { try { fs.unlinkSync(x.f); } catch (e) { /* ignore */ } });
  const eng = list.find((x) => x.engine === 'edge') ? 'edge' : list[0].engine;
  return { timing: kind === 'none' || !marks.length ? null : { kind, marks }, engine: eng, voice: list.map((x) => x.voice).join('+'), natural: true };
}

function durationSeconds(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = parseFloat(out.trim());
  if (!isFinite(d)) throw new Error('Could not read duration of ' + file);
  return d;
}

module.exports = { synth, synthLines, durationSeconds };
