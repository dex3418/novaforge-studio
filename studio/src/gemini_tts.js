'use strict';
// Gemini voice (optional, needs the GEMINI_API_KEY secret).
// One call per sentence. Gemini gives no word timings, but because we know how
// long each sentence's audio is, the captions still follow sentence by sentence.
// Output: mp3 file + { kind: 'sentence', marks } timing.

const fs = require('fs');
const { execFileSync } = require('child_process');

const { POLISH } = require('./natural_polish');
const RATE = 24000; // Gemini returns 16-bit mono PCM at 24 kHz
const MODELS = (process.env.GEMINI_TTS_MODEL ? [process.env.GEMINI_TTS_MODEL] : []).concat([
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
]);

// Gemini 3.8 TTS reads the text as a verbatim transcript (style goes in speech_metadata)
// and returns WAV. Older models want the style inside the text and return raw PCM.
const isLegacy = (model) => /gemini-2\.|gemini-3\.[01]-/.test(model);

// Accept raw PCM or WAV (RIFF). Returns { pcm, rate }.
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

const BASE = 'Speak like a real person explaining something useful to a friend: natural rhythm, small pauses, light emphasis on the key words and numbers, never an announcer or a robot.';
const TONE = {
  excited: 'in an excited, upbeat way',
  serious: 'in a serious, clear way',
  curious: 'in a curious, friendly way',
  calm: 'in a calm, gentle way',
};

// Split at whitespace after . ! ? or the Hindi danda; never inside 3.5 or after Dr. / Rs. / No.
function sentences(text) {
  const parts = String(text).trim().split(/(?<=[.!?\u0964])\s+/);
  const out = [];
  for (const s of parts) {
    if (out.length && /(?:^|\s)(?:Dr|Mr|Mrs|Ms|St|No|Rs|vs|Sr|Jr|Prof)\.$/i.test(out[out.length - 1])) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function directionFor(style, delivery, si, n, text) {
  const bits = [BASE];
  const tone = TONE[style] || (style && style !== 'neutral' ? `in a ${String(style).slice(0, 60)} way` : '');
  if (delivery) bits.push(String(delivery).replace(/^say\s+/i, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 160).replace(/[.\s]*$/, '.'));
  else if (tone) bits.push(`Speak ${tone}.`);
  if (/\?\s*$/.test(text)) bits.push('This is a question: let the end lift.');
  else if (si === n - 1) bits.push('This is the last line: slow slightly and land it with a settled ending.');
  else if (si === 0) bits.push('This opens the scene: start warm and with interest.');
  return bits.join(' ');
}

async function callOnce(model, key, text, voice, direction) {
  await require('./gemini_gate').wait('tts');
  const legacy = isLegacy(model);
  const reqPart = legacy ? { text: `Say in this style (${direction}): ${text}` } : { text, speech_metadata: { style: direction } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [reqPart] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    const err = new Error(`Gemini ${model} HTTP ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const part = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
  const data = part && part.find((p) => p.inlineData && p.inlineData.data);
  if (!data) throw new Error('Gemini returned no audio');
  return toPcm(Buffer.from(data.inlineData.data, 'base64'), data.inlineData.mimeType);
}

async function oneSentence(key, text, voice, direction, state) {
  let lastErr;
  const gate = require('./gemini_gate');
  for (const model of state.models) {
    if (gate.skip(model)) continue;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await callOnce(model, key, text, voice, direction);
        state.models = [model, ...state.models.filter((m) => m !== model)]; // keep the one that works
        return out;
      } catch (e) {
        lastErr = e;
        // 429 on a voice is usually the per-minute limit: wait it out once on the SAME model so the voices stay consistent;
        // only a second 429 sends us to the next model
        if (e.status === 429 && attempt === 1) { await new Promise((r) => setTimeout(r, 15000)); continue; }
        if (e.status === 429 || e.status === 503) { gate.failed(model, 503); break; }
        if (e.status === 404 || e.status === 400) break; // wrong model name: try next
        if (e.status === 429 || e.status >= 500) await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  }
  throw lastErr || new Error('Gemini failed');
}

// tempo: 1 = normal. Returns { timing }.
async function geminiSynth(text, outFile, { voice, style, tempo, delivery }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const state = { models: MODELS.slice() };
  const chunks = [];
  const marks = [];
  let t = 0;
  let rate = RATE;
  const list = sentences(text);
  for (let si = 0; si < list.length; si++) {
    const s = list[si];
    const out = await oneSentence(key, s, voice, directionFor(style, delivery, si, list.length, s), state);
    const pcm = out.pcm;
    rate = out.rate;
    const dur = pcm.length / 2 / rate;
    marks.push({ text: s, start: t, end: t + dur });
    chunks.push(pcm);
    t += dur;
    if (si < list.length - 1) {
      const gap = /\?\s*$/.test(s) ? 0.3 : 0.22; // a breath between sentences
      chunks.push(Buffer.alloc(Math.round(gap * rate) * 2));
      t += gap;
    }
  }
  const raw = outFile.replace(/\.mp3$/i, '') + '.pcm';
  fs.writeFileSync(raw, Buffer.concat(chunks));
  const args = ['-y', '-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw];
  const k = tempo && Math.abs(tempo - 1) > 0.005 ? tempo : 1;
  args.push('-filter:a', (k !== 1 ? `atempo=${k.toFixed(3)},` : '') + POLISH);
  args.push('-b:a', '128k', outFile);
  execFileSync('ffmpeg', args);
  fs.unlinkSync(raw);
  const scaled = marks.map((m) => ({ text: m.text, start: m.start / k, end: m.end / k }));
  return { timing: { kind: 'sentence', marks: scaled } };
}

module.exports = { geminiSynth, sentences };
