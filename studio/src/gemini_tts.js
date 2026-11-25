'use strict';
// Gemini voice (optional, needs GEMINI_API_KEY). Differences from the first version, which felt wrong:
//   - ONE request per scene (or per speaker line in a story), not one per sentence, so a script costs a few requests
//   - ONE model for the whole run (GEMINI_TTS_MODEL, default gemini-3.8-flash-tts): it never drops to an older model
//     half way, so the voice cannot change in the middle of a video
//   - a request budget (GEMINI_TTS_MAX_REQUESTS, default 20) checked BEFORE the run: a script that needs more is voiced
//     entirely by Edge instead of half and half (see plan())
//   - answers are cached on disk by (model, voice, direction, text): rendering the same script again costs nothing
//   GEMINI_TTS_BASE  for tests       GEMINI_TTS_CACHE  cache folder       GEMINI_TTS_RETRY_MS  wait before the one retry on 429
// Gemini gives no word timing, so captions and mouth movement use the estimated timing (the report says so).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RATE = 24000;
const MODEL = () => process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const BASE = () => (process.env.GEMINI_TTS_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const MAX = () => Math.max(1, Number(process.env.GEMINI_TTS_MAX_REQUESTS || 20));
const cacheDir = () => process.env.GEMINI_TTS_CACHE || path.join(process.env.NF_ROOT || os.tmpdir(), '.cache', 'gemini-tts');
const state = { used: 0, dead: '' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s, key) => (key ? String(s).split(key).join('***') : String(s));

// Gemini 3.x TTS reads the text as a verbatim transcript and takes the style separately; older models want the style in the text.
const isLegacy = (model) => /gemini-2\.|gemini-3\.[01]-/.test(model);

// raw PCM or WAV (RIFF) -> { pcm, rate }
function toPcm(buf, mime) {
  if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let rate = RATE;
    let pos = 12;
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12);
      if (id === 'data') return { pcm: buf.subarray(pos + 8, size ? Math.min(buf.length, pos + 8 + size) : buf.length), rate };
      pos += 8 + size + (size % 2);
    }
    return { pcm: buf.subarray(44), rate };
  }
  const m = /rate=(\d+)/i.exec(mime || '');
  return { pcm: buf, rate: m ? Number(m[1]) : RATE };
}

const BASE_STYLE = 'Speak like a real person explaining something useful to a friend: natural rhythm, small pauses, light emphasis on the key words and numbers, never an announcer or a robot.';
const TONE = { excited: 'in an excited, upbeat way', serious: 'in a serious, clear way', curious: 'in a curious, friendly way', calm: 'in a calm, gentle way' };
function direction(style, delivery) {
  const bits = [BASE_STYLE];
  if (delivery) bits.push(String(delivery).replace(/^say\s+/i, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 160).replace(/[.\s]*$/, '.'));
  else if (TONE[style]) bits.push(`Speak ${TONE[style]}.`);
  else if (style && style !== 'neutral') bits.push(`Speak in a ${String(style).slice(0, 60)} way.`);
  return bits.join(' ');
}

async function request(text, voice, dir, key) {
  const model = MODEL();
  const legacy = isLegacy(model);
  const part = legacy ? { text: `Say in this style (${dir}): ${text}` } : { text, speech_metadata: { style: dir } };
  const res = await fetch(`${BASE()}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ contents: [{ parts: [part] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
  });
  if (!res.ok) {
    const e = new Error(`Gemini ${model} HTTP ${res.status}: ${scrub((await res.text().catch(() => '')).slice(0, 200), key)}`);
    e.status = res.status;
    throw e;
  }
  const j = await res.json();
  const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  const data = parts && parts.find((p) => p.inlineData && p.inlineData.data);
  if (!data) throw new Error('Gemini returned no audio');
  return toPcm(Buffer.from(data.inlineData.data, 'base64'), data.inlineData.mimeType);
}

// how many requests a script needs, and whether the budget covers it. scenes: [{ lines? , narration }]
function plan(scenes, hasCast) {
  const need = scenes.reduce((n, s) => n + (hasCast && s.lines && s.lines.some((l) => l.who !== 'narrator') ? s.lines.length : 1), 0);
  const left = MAX() - state.used;
  return { need, left, ok: need <= left };
}

// text -> mp3 at outFile. Returns { timing: null, cached }
async function geminiSynth(text, outFile, { voice, style, delivery, rate }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  if (state.dead) throw new Error(state.dead);
  const speed = Math.min(1.35, Math.max(0.7, 1 + (parseInt(rate, 10) || 0) / 100));
  const dir = direction(style, delivery);
  const hash = crypto.createHash('sha1').update([MODEL(), voice, dir, speed.toFixed(2), text].join('\u0001')).digest('hex').slice(0, 24);
  const cached = path.join(cacheDir(), hash + '.mp3');
  if (fs.existsSync(cached)) { fs.copyFileSync(cached, outFile); return { timing: null, cached: true }; }
  if (state.used >= MAX()) { state.dead = `Gemini voice request budget used up (${MAX()} per run, set GEMINI_TTS_MAX_REQUESTS to change)`; throw new Error(state.dead); }
  let out;
  for (let attempt = 1; ; attempt++) {
    state.used++;
    try { out = await request(text, voice, dir, key); break; } catch (e) {
      // 429 is usually the per-minute limit: wait once and ask the SAME model again; a second 429 means the quota is gone for the run
      if (e.status === 429 && attempt === 1) { await sleep(Number(process.env.GEMINI_TTS_RETRY_MS || 15000)); continue; }
      if (e.status === 429 || e.status === 403 || e.status === 400 || e.status === 404) state.dead = e.message;
      throw e;
    }
  }
  const raw = outFile.replace(/\.mp3$/i, '') + '.pcm';
  fs.writeFileSync(raw, out.pcm);
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', String(out.rate), '-ac', '1', '-i', raw, '-af', `atempo=${speed.toFixed(3)},apad=pad_dur=0.05`, '-ar', '44100', '-b:a', '128k', outFile]);
  } finally { try { fs.unlinkSync(raw); } catch (e) { /* ignore */ } }
  try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.copyFileSync(outFile, cached); } catch (e) { /* cache is optional */ }
  return { timing: null, cached: false };
}

const reset = () => { state.used = 0; state.dead = ''; };
module.exports = { geminiSynth, plan, reset, direction, toPcm, state };
