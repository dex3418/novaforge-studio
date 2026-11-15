'use strict';
// Voice for one scene.
//   engine 'edge'   : free Edge voices, exact word timing (default)
//   engine 'gemini' : Gemini voices (needs GEMINI_API_KEY), sentence timing
// Gemini failing for any reason falls back to Edge, so a post is never lost.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { VOICES, DEFAULT_VOICE } = require('./catalog');
const { geminiSynth } = require('./gemini_tts');
const natural = require('./natural');

const hasDevanagari = (t) => /[ऀ-ॿ]/.test(t);
const edgeIds = new Set(VOICES.edge.map((v) => v.id));
const geminiIds = new Set(VOICES.gemini.map((v) => v.id));

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
  if (o.engine === 'gemini') {
    const voice = geminiIds.has(o.voice) ? o.voice : DEFAULT_VOICE.gemini;
    try {
      const tempo = 1 + parseInt(rate, 10) / 100;
      const r = await geminiSynth(text, outFile, { voice, style: o.style, tempo, emotion: o.emotion, delivery: o.delivery });
      return { ...r, engine: 'gemini', voice };
    } catch (e) {
      console.warn(`  Gemini voice failed (${e.message}). Using the Edge voice instead.`);
      const r = edgeSynth(text, outFile, '', rate, o.emotion);
      return { ...r, engine: 'edge', note: `Gemini voice failed (${e.message.slice(0, 140)}), used Edge` };
    }
  }
  const r = edgeSynth(text, outFile, o.voice, rate, o.emotion);
  return { ...r, engine: 'edge' };
}

function durationSeconds(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = parseFloat(out.trim());
  if (!isFinite(d)) throw new Error('Could not read duration of ' + file);
  return d;
}

module.exports = { synth, durationSeconds };
