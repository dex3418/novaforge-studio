'use strict';
// Voice engines: Edge (default), ElevenLabs and Gemini (optional, one model per run). Cast voices always fit the engine in use.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { VOICES, DEFAULT_VOICE } = require('../src/catalog');
assert.deepStrictEqual(Object.keys(VOICES), ['gemini', 'edge', 'elevenlabs'].sort((a, b) => Object.keys(VOICES).indexOf(a) - Object.keys(VOICES).indexOf(b)));
assert.deepStrictEqual(Object.keys(DEFAULT_VOICE).sort(), ['edge', 'elevenlabs', 'gemini']);
const story = require('../src/story');
const cast = [{ id: 'a', name: 'Asha', look: { gender: 'f' } }, { id: 'b', name: 'Ravi', look: { gender: 'm' } }];
for (const eng of ['edge', 'elevenlabs', 'gemini']) {
  const c2 = cast.map((c) => ({ ...c, voice: '' }));
  story.assignVoices(c2, eng, '', []);
  c2.forEach((c) => assert.ok(VOICES[eng].some((v) => v.id === c.voice), eng + ' ' + c.voice));
  assert.notStrictEqual(c2[0].voice, c2[1].voice);
}
const { sentences } = require('../src/natural');
assert.deepStrictEqual(sentences('Dr. Rao paid Rs. 3.5 lakh. Done?'), ['Dr. Rao paid Rs. 3.5 lakh.', 'Done?']);
console.log('voices_edge_only.test.js: all checks passed');
