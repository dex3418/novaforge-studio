'use strict';
// Text-to-speech through the free Edge voices (pip package "edge-tts").
// Called as `python3 -m edge_tts`, so no PATH issues.
// Hindi voices: hi-IN-SwaraNeural, hi-IN-MadhurNeural
// Indian English: en-IN-NeerjaNeural, en-IN-PrabhatNeural

const { execFileSync } = require('child_process');

function synth(text, outFile, voice, rate) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync(
        'python3',
        ['-m', 'edge_tts', '--voice', voice, `--rate=${rate}`, `--text=${text}`, '--write-media', outFile],
        { stdio: ['ignore', 'ignore', 'inherit'] }
      );
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`  TTS attempt ${attempt} failed, retrying...`);
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
