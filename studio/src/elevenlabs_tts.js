'use strict';
// ElevenLabs voice (optional, needs the ELEVENLABS_API_KEY secret). Any failure makes the caller use the free Edge voice instead.
//   - one request per scene text, asking for the audio WITH character timing, turned into word marks like Edge gives
//   - answers are cached on disk by (voice, model, speed, text): rendering the same script again costs nothing
//   - a character budget per run (ELEVENLABS_MAX_CHARS, default 12000) stops a runaway script from spending your credits
//   ELEVENLABS_API_KEY  the key (never printed)      ELEVENLABS_MODEL  default eleven_multilingual_v2 (Hindi and English)
//   ELEVENLABS_VOICE_ID default voice id             ELEVENLABS_BASE   for tests      ELEVENLABS_CACHE  cache folder

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BASE = () => (process.env.ELEVENLABS_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
const MODEL = () => process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const cacheDir = () => process.env.ELEVENLABS_CACHE || path.join(process.env.NF_ROOT || os.tmpdir(), '.cache', 'elevenlabs');
const budget = { used: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s, key) => (key ? String(s).split(key).join('***') : String(s));

// ElevenLabs gives one time per character; words are the runs between spaces
function wordMarks(al) {
  const ch = al && al.characters, s = al && al.character_start_times_seconds, e = al && al.character_end_times_seconds;
  if (!Array.isArray(ch) || !Array.isArray(s) || !Array.isArray(e) || ch.length !== s.length || ch.length !== e.length) return null;
  const marks = [];
  let cur = null;
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) { if (cur) { marks.push(cur); cur = null; } continue; }
    if (!cur) cur = { text: '', start: s[i], end: e[i] };
    cur.text += ch[i]; cur.end = e[i];
  }
  if (cur) marks.push(cur);
  return marks.length ? marks : null;
}

async function post(url, body, key, tries) {
  let last;
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { last = new Error('network: ' + scrub(e.message, key)); await sleep(Number(process.env.ELEVENLABS_RETRY_MS || 1500)); continue; }
    if (res.ok) return res.json();
    const txt = scrub((await res.text().catch(() => '')).slice(0, 200), key);
    last = new Error(`ElevenLabs ${res.status}: ${txt}`);
    if (res.status !== 429 && res.status < 500) break;                       // a wrong key or voice will not get better by asking again
    await sleep(Number(process.env.ELEVENLABS_RETRY_MS || 1500));
  }
  throw last;
}

// text -> mp3 file at outFile. Returns { timing: { kind: 'word', marks } | null, cached }
async function elevenSynth(text, outFile, { voice, rate }) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  const id = String(voice || process.env.ELEVENLABS_VOICE_ID || '').trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new Error('no valid ElevenLabs voice id');
  const speed = Math.min(1.2, Math.max(0.7, 1 + (parseInt(rate, 10) || 0) / 100));
  const hash = crypto.createHash('sha1').update([id, MODEL(), speed.toFixed(2), text].join('\u0001')).digest('hex').slice(0, 24);
  const cdir = cacheDir();
  const cmp3 = path.join(cdir, hash + '.mp3'), cjson = path.join(cdir, hash + '.json');
  if (fs.existsSync(cmp3) && fs.existsSync(cjson)) {
    fs.copyFileSync(cmp3, outFile);
    return { timing: JSON.parse(fs.readFileSync(cjson, 'utf8')), cached: true };
  }
  const max = Number(process.env.ELEVENLABS_MAX_CHARS || 12000);
  if (budget.used + text.length > max) throw new Error(`ElevenLabs budget reached (${budget.used}/${max} characters this run)`);
  const url = `${BASE()}/v1/text-to-speech/${id}/with-timestamps?output_format=mp3_44100_128`;
  const j = await post(url, { text, model_id: MODEL(), voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed } }, key, 2);
  if (!j || !j.audio_base64) throw new Error('ElevenLabs sent no audio');
  budget.used += text.length;
  const buf = Buffer.from(j.audio_base64, 'base64');
  if (buf.length < 200) throw new Error('ElevenLabs audio is empty');
  const marks = wordMarks(j.alignment || j.normalized_alignment);
  const timing = marks ? { kind: 'word', marks } : null;
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(cmp3, buf); fs.writeFileSync(cjson, JSON.stringify(timing));
  fs.writeFileSync(outFile, buf);
  return { timing, cached: false };
}

module.exports = { elevenSynth, wordMarks, budget };
