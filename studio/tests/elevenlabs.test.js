'use strict';
// ElevenLabs engine against a fake local server: request shape, word timing, cache, budget, error handling. (Not the real service.)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert');
process.env.NF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nfeleven-'));
process.env.ELEVENLABS_RETRY_MS = '1';
const E = require('../src/elevenlabs_tts');
const catalog = require('../src/catalog');
const text = 'Hello big world';
const chars = [...text];
const al = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.09) };
let calls = 0, last = null, mode = 'ok';
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    calls++; last = { url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(b || '{}') };
    if (mode === '401') { res.statusCode = 401; return res.end('invalid key sk-SECRET'); }
    if (mode === '500once' && calls === 1) { res.statusCode = 500; return res.end('boom'); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ audio_base64: Buffer.alloc(400, 7).toString('base64'), alignment: al }));
  });
});
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.ELEVENLABS_BASE = `http://127.0.0.1:${srv.address().port}`;
  const out = path.join(process.env.NF_ROOT, 'a.mp3');
  // word marks from character times
  const m = E.wordMarks(al);
  assert.deepStrictEqual(m.map((x) => x.text), ['Hello', 'big', 'world']);
  assert.ok(Math.abs(m[1].start - 0.6) < 1e-9 && m[2].end > m[2].start);
  assert.strictEqual(E.wordMarks({ characters: ['a'], character_start_times_seconds: [] }), null);
  // no key
  delete process.env.ELEVENLABS_API_KEY;
  await assert.rejects(E.elevenSynth(text, out, { voice: '21m00Tcm4TlvDq8ikWAM', rate: '+0%' }), /ELEVENLABS_API_KEY is not set/);
  process.env.ELEVENLABS_API_KEY = 'sk-SECRET';
  await assert.rejects(E.elevenSynth(text, out, { voice: 'bad id!', rate: '+0%' }), /voice id/);
  // success, request shape, timing
  let r = await E.elevenSynth(text, out, { voice: '21m00Tcm4TlvDq8ikWAM', rate: '+10%' });
  assert.strictEqual(calls, 1); assert.ok(fs.statSync(out).size === 400);
  assert.ok(/\/v1\/text-to-speech\/21m00Tcm4TlvDq8ikWAM\/with-timestamps/.test(last.url));
  assert.strictEqual(last.key, 'sk-SECRET'); assert.strictEqual(last.body.text, text); assert.ok(Math.abs(last.body.voice_settings.speed - 1.1) < 1e-9);
  assert.strictEqual(r.timing.kind, 'word'); assert.strictEqual(r.timing.marks.length, 3);
  // same text again: from the cache, no new request
  fs.unlinkSync(out);
  r = await E.elevenSynth(text, out, { voice: '21m00Tcm4TlvDq8ikWAM', rate: '+10%' });
  assert.strictEqual(calls, 1); assert.ok(r.cached && fs.existsSync(out));
  // a different speed is a different recording
  await E.elevenSynth(text, out, { voice: '21m00Tcm4TlvDq8ikWAM', rate: '+0%' }); assert.strictEqual(calls, 2);
  // a server error is retried once; a wrong key is not retried and the key never appears in the message
  mode = '500once'; calls = 0;
  await E.elevenSynth('Another line', out, { voice: 'pNInz6obpgDQGcFmaJgB', rate: '+0%' }); assert.strictEqual(calls, 2);
  mode = '401'; calls = 0;
  await assert.rejects(E.elevenSynth('Third line', out, { voice: 'pNInz6obpgDQGcFmaJgB', rate: '+0%' }), (e) => /401/.test(e.message) && !/sk-SECRET/.test(e.message));
  assert.strictEqual(calls, 1);
  // budget
  mode = 'ok'; process.env.ELEVENLABS_MAX_CHARS = '10';
  await assert.rejects(E.elevenSynth('This one is far too long for ten characters', out, { voice: 'pNInz6obpgDQGcFmaJgB', rate: '+0%' }), /budget/);
  // the catalog offers the voices and the default
  assert.ok(catalog.VOICES.elevenlabs.length >= 3 && catalog.VOICES.elevenlabs.some((v) => v.id === catalog.DEFAULT_VOICE.elevenlabs));
  srv.close();
  console.log('elevenlabs.test.js: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
