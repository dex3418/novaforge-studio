'use strict';
// Text-to-speech through the free Edge voices (pip package "edge-tts").
// Hindi voices: hi-IN-SwaraNeural, hi-IN-MadhurNeural
// Indian English: en-IN-NeerjaNeural, en-IN-PrabhatNeural
//
// synth() returns { timing } where timing holds when each word/sentence is spoken
// (used to keep the on-screen captions in step with the voice), or null if the
// timing could not be recorded. The audio file is always written.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readTiming(file) {
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    return t && t.marks && t.marks.length ? t : null;
  } catch (e) {
    return null;
  }
}

function synth(text, outFile, voice, rate) {
  const jsonFile = outFile.replace(/\.mp3$/i, '') + '.timing.json';
  const helper = path.join(__dirname, 'tts.py');
  let lastErr;

  // 1) helper that also records timings
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execFileSync('python3', [helper, voice, rate, outFile, jsonFile], {
        input: text,
        stdio: ['pipe', 'ignore', 'inherit'],
      });
      return { timing: readTiming(jsonFile) };
    } catch (e) {
      lastErr = e;
      console.warn(`  TTS (with timing) attempt ${attempt} failed, retrying...`);
    }
  }

  // 2) plain edge-tts command, no timings (captions fall back to an estimate)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execFileSync(
        'python3',
        ['-m', 'edge_tts', '--voice', voice, `--rate=${rate}`, `--text=${text}`, '--write-media', outFile],
        { stdio: ['ignore', 'ignore', 'inherit'] }
      );
      console.warn('  WARNING: voice made without timing, captions will be approximate.');
      return { timing: null };
    } catch (e) {
      lastErr = e;
      console.warn(`  TTS (plain) attempt ${attempt} failed, retrying...`);
    }
  }

  throw new Error(
    'edge-tts failed. Is it installed? Run: pip install edge-tts\n' + (lastErr && lastErr.message)
  );
}

function durationSeconds(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }
  );
  const d = parseFloat(out.trim());
  if (!isFinite(d)) throw new Error('Could not read duration of ' + file);
  return d;
}

module.exports = { synth, durationSeconds };
