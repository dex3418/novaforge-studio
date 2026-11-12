'use strict';
// Gemini voice (optional, needs the GEMINI_API_KEY secret).
// One call per sentence. Gemini gives no word timings, but because we know how
// long each sentence's audio is, the captions still follow sentence by sentence.
// Output: mp3 file + { kind: 'sentence', marks } timing.

const fs = require('fs');
const { execFileSync } = require('child_process');

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

const TONE = {
  excited: 'in an excited, upbeat way',
  serious: 'in a serious, clear way',
  curious: 'in a curious, friendly way',
  calm: 'in a calm, gentle way',
};

function sentences(text) {
  const parts = String(text).match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

async function callOnce(model, key, text, voice, style) {
  const tone = TONE[style] || (style && style !== 'neutral' ? `in a ${String(style).slice(0, 60)} way` : '');
  const legacy = isLegacy(model);
  const reqPart = legacy
    ? { text: tone ? `Say ${tone}: ${text}` : text }
    : tone ? { text, speech_metadata: { style: `Speak ${tone}.` } } : { text };
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

async function oneSentence(key, text, voice, style, state) {
  let lastErr;
  for (const model of state.models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await callOnce(model, key, text, voice, style);
        state.models = [model, ...state.models.filter((m) => m !== model)]; // keep the one that works
        return out;
      } catch (e) {
        lastErr = e;
        if (e.status === 404 || e.status === 400) break; // wrong model name: try next
        if (e.status === 429 || e.status >= 500) await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  }
  throw lastErr || new Error('Gemini failed');
}

// tempo: 1 = normal. Returns { timing }.
async function geminiSynth(text, outFile, { voice, style, tempo }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const state = { models: MODELS.slice() };
  const chunks = [];
  const marks = [];
  let t = 0;
  let rate = RATE;
  for (const s of sentences(text)) {
    const out = await oneSentence(key, s, voice, style, state);
    const pcm = out.pcm;
    rate = out.rate;
    const dur = pcm.length / 2 / rate;
    marks.push({ text: s, start: t, end: t + dur });
    chunks.push(pcm);
    t += dur;
  }
  const raw = outFile.replace(/\.mp3$/i, '') + '.pcm';
  fs.writeFileSync(raw, Buffer.concat(chunks));
  const args = ['-y', '-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw];
  const k = tempo && Math.abs(tempo - 1) > 0.005 ? tempo : 1;
  if (k !== 1) args.push('-filter:a', `atempo=${k.toFixed(3)}`);
  args.push('-b:a', '128k', outFile);
  execFileSync('ffmpeg', args);
  fs.unlinkSync(raw);
  const scaled = marks.map((m) => ({ text: m.text, start: m.start / k, end: m.end / k }));
  return { timing: { kind: 'sentence', marks: scaled } };
}

module.exports = { geminiSynth, sentences };
