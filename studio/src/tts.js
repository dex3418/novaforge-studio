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

function edgeSynth(text, outFile, voice, rate) {
  const pick = voice && (edgeIds.has(voice) || /Neural$/.test(voice)) ? voice : '';
  const def = hasDevanagari(text) ? 'hi-IN-SwaraNeural' : DEFAULT_VOICE.edge;
  const first = pick || def;
  try {
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
      const r = await geminiSynth(text, outFile, { voice, style: o.style, tempo });
      return { ...r, engine: 'gemini', voice };
    } catch (e) {
      console.warn(`  Gemini voice failed (${e.message}). Using the Edge voice instead.`);
      const r = edgeSynth(text, outFile, '', rate);
      return { ...r, engine: 'edge', note: `Gemini voice failed (${e.message.slice(0, 140)}), used Edge` };
    }
  }
  const r = edgeSynth(text, outFile, o.voice, rate);
  return { ...r, engine: 'edge' };
}

function durationSeconds(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = parseFloat(out.trim());
  if (!isFinite(d)) throw new Error('Could not read duration of ' + file);
  return d;
}

module.exports = { synth, durationSeconds };
