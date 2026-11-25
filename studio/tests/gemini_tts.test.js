'use strict';
// Gemini voice engine against a fake local server (not the real service): one request per piece of text, one model for the
// whole run, cache, the retry on 429, the request budget and the "whole video or nothing" plan.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert');
process.env.NF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nfgem-'));
process.env.GEMINI_TTS_RETRY_MS = '1';
process.env.GEMINI_TTS_MAX_REQUESTS = '4';
process.env.GEMINI_API_KEY = 'AIza-SECRET';
const G = require('../src/gemini_tts');
const catalog = require('../src/catalog');

function wav(sec) { // 24 kHz mono 16-bit sine
  const n = Math.round(24000 * sec), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(3000 * Math.sin(i / 20)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
let calls = [], mode = 'ok';
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    calls.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(b || '{}') });
    if (mode === '429once' && calls.length === 1) { res.statusCode = 429; return res.end('quota'); }
    if (mode === '429') { res.statusCode = 429; return res.end('You exceeded your current quota AIza-SECRET'); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav(0.6).toString('base64') } }] } }] }));
  });
});
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.GEMINI_TTS_BASE = `http://127.0.0.1:${srv.address().port}`;
  const out = path.join(process.env.NF_ROOT, 'a.mp3');
  // catalog: the voices exist, the default is one of them
  assert.ok(catalog.VOICES.gemini.length >= 8 && catalog.VOICES.gemini.some((v) => v.id === catalog.DEFAULT_VOICE.gemini));
  // one request, right model and voice, key in the header only, a real mp3 comes out
  let r = await G.geminiSynth('Hello there, friend.', out, { voice: 'Kore', style: 'calm', rate: '+0%' });
  assert.strictEqual(calls.length, 1); assert.ok(/\/v1beta\/models\/gemini-3\.8-flash-tts:generateContent/.test(calls[0].url));
  assert.strictEqual(calls[0].key, 'AIza-SECRET');
  assert.strictEqual(calls[0].body.contents[0].parts[0].text, 'Hello there, friend.');   // transcript is verbatim, style travels separately
  assert.ok(/calm|gentle/.test(calls[0].body.contents[0].parts[0].speech_metadata.style));
  assert.strictEqual(calls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  assert.strictEqual(r.timing, null); assert.ok(fs.statSync(out).size > 500);
  const { durationSeconds } = require('../src/tts'); assert.ok(Math.abs(durationSeconds(out) - 0.65) < 0.15, String(durationSeconds(out)));
  // same text, voice and speed again: from the cache, no request, no budget spent
  fs.unlinkSync(out); const used = G.state.used;
  r = await G.geminiSynth('Hello there, friend.', out, { voice: 'Kore', style: 'calm', rate: '+0%' });
  assert.ok(r.cached && fs.existsSync(out) && calls.length === 1 && G.state.used === used);
  // a faster speed is a different (shorter) recording
  await G.geminiSynth('Hello there, friend.', out, { voice: 'Kore', style: 'calm', rate: '+30%' });
  assert.strictEqual(calls.length, 2); assert.ok(durationSeconds(out) < 0.55, String(durationSeconds(out)));
  // a 429 is retried ONCE on the SAME model (never an older one)
  G.reset(); calls = []; mode = '429once';
  await G.geminiSynth('Second line.', out, { voice: 'Puck', style: 'neutral', rate: '+0%' });
  assert.strictEqual(calls.length, 2); assert.ok(calls.every((c) => /gemini-3\.8-flash-tts/.test(c.url)));
  // a second 429 ends Gemini for the run, the key is not in the message, and nothing else is asked afterwards
  G.reset(); calls = []; mode = '429';
  await assert.rejects(G.geminiSynth('Third line.', out, { voice: 'Puck', style: 'neutral', rate: '+0%' }), (e) => /429/.test(e.message) && !/AIza-SECRET/.test(e.message));
  const n = calls.length; mode = 'ok';
  await assert.rejects(G.geminiSynth('Fourth line.', out, { voice: 'Puck', style: 'neutral', rate: '+0%' }), /429/);
  assert.strictEqual(calls.length, n);
  // the budget is checked before the run: 4 allowed, 5 scenes means Edge for the whole video
  G.reset();
  const scenes = (k) => Array.from({ length: k }, (_, i) => ({ index: i + 1, narration: 'x' }));
  assert.ok(G.plan(scenes(4), false).ok); assert.ok(!G.plan(scenes(5), false).ok);
  const talky = [{ index: 1, narration: 'a b', lines: [{ who: 'ravi' }, { who: 'asha' }, { who: 'ravi' }] }, { index: 2, narration: 'c', lines: [{ who: 'narrator' }] }];
  assert.strictEqual(G.plan(talky, true).need, 4);                         // 3 spoken lines + 1 narrated scene
  assert.strictEqual(G.plan(talky, false).need, 2);                        // no cast: one request per scene
  // no key
  delete process.env.GEMINI_API_KEY; G.reset();
  await assert.rejects(G.geminiSynth('Fifth line.', out, { voice: 'Kore', style: '', rate: '+0%' }), /GEMINI_API_KEY is not set/);
  srv.close();
  console.log('gemini_tts.test.js: all checks passed');
})().catch((e) => { console.log('  FAIL ' + (e.stack || e.message)); process.exit(1); });
