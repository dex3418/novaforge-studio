'use strict';
// Gemini voices are gone (Edge and ElevenLabs remain); a script that still asks for Gemini voices is voiced by Edge.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { VOICES, DEFAULT_VOICE } = require('../src/catalog');
assert.deepStrictEqual(Object.keys(VOICES), ['edge', 'elevenlabs']);   // no Gemini voices
assert.deepStrictEqual(Object.keys(DEFAULT_VOICE), ['edge', 'elevenlabs']);
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'gemini_tts.js')));
const story = require('../src/story');
const cast = [{ id: 'a', name: 'Asha', look: { gender: 'f' } }, { id: 'b', name: 'Ravi', look: { gender: 'm' } }];
story.assignVoices && story.assignVoices(cast, 'gemini', '', []);
if (story.assignVoices) cast.forEach((c) => assert.ok(VOICES.edge.some((v) => v.id === c.voice), c.voice));
const { sentences } = require('../src/natural');
assert.deepStrictEqual(sentences('Dr. Rao paid Rs. 3.5 lakh. Done?'), ['Dr. Rao paid Rs. 3.5 lakh.', 'Done?']);
console.log('voices_edge_only.test.js: all checks passed');
