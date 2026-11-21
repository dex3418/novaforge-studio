'use strict';
// Catalog: what each character can really draw, how complete they are, and what the director is told.
const assert = require('assert');
const AS = require('../src/assets');
const CHARS = require('../src/characters');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

const full = { name: 'Full', angles: Object.fromEntries(AS.ANGLES.map((a) => [a, {}])), poses: ['idle', 'walk', 'talk', 'listen', 'wave'], expressions: ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried'] };
const half = { name: 'Half', learned_style: 'ghibli', variants: { idle: { front: {}, left_profile: {} } }, poses: ['idle', 'sit'], expressions: ['happy'], expression_art: { happy: 'emo_happy', shy: 'emo_shy' } };
const empty = { name: 'Empty', poses: [] };

ok('a character with all 8 angles, the core poses and enough expressions is full', () => {
  const c = AS.describe('full', full);
  assert.strictEqual(c.ready, 'full'); assert.deepStrictEqual(c.missing, []);
  assert.ok(/8\/8 angles/.test(c.status) && /complete/.test(c.status));
});
ok('a learned character is partial and the status names exactly what is missing', () => {
  const c = AS.describe('half', half);
  assert.strictEqual(c.ready, 'partial');
  assert.deepStrictEqual(c.angles.sort(), ['front', 'left_profile']);
  assert.deepStrictEqual(c.expressions.sort(), ['happy', 'shy']);
  assert.ok(c.missing.some((m) => /angles: .*back/.test(m)) && c.missing.some((m) => /poses: walk, talk, listen/.test(m)) && c.missing.some((m) => /expressions: 2 of 6/.test(m)), c.missing.join(' | '));
});
ok('a character with nothing usable is basic', () => { assert.strictEqual(AS.describe('e', empty).ready, 'basic'); });
ok('landscapes and props: learned names are listed apart from built-in ones', () => {
  const c = AS.catalogFrom({ chars: { full }, lib: { landscapes: { street: { w: 688, h: 384, style: 'ghibli' } }, props: { chair: {} } }, settings: ['village', 'street'], props: ['lamp', 'chair'] });
  assert.deepStrictEqual(c.settings.builtin, ['village']);
  assert.deepStrictEqual(c.settings.learned.map((s) => s.name), ['street']);
  assert.deepStrictEqual(c.props.builtin, ['lamp']); assert.deepStrictEqual(c.props.learned, ['chair']);
});
ok('the director is told only what each cast member can draw, and unknown ids are skipped', () => {
  const cat = AS.catalogFrom({ chars: { full, half } });
  const t = AS.directorText(cat, ['half', 'ghost']);
  assert.ok(/half: poses idle, sit/.test(t) && /limited \(partial\)/.test(t) && !/ghost/.test(t), t);
  assert.strictEqual(AS.directorText(cat, []), '');
});
ok('the real registry: naina is complete and the story prompt carries her poses', () => {
  const chars = {}; CHARS.ids().forEach((id) => { chars[id] = CHARS.get(id); });
  const naina = AS.catalogFrom({ chars }).characters.find((c) => c.id === 'naina');
  assert.ok(naina && naina.angles.length === 8 && naina.poses.includes('walk'), JSON.stringify(naina && naina.missing));
  const D = require('../src/director');
  const prompt = D.buildPrompt ? D.buildPrompt({ title: 't', meta: { mode: 'story' }, cast: [{ id: 'naina', name: 'Naina', look: {} }], pictures: [], scenes: [] }) : null;
  assert.ok(prompt && /WHAT EACH CAST MEMBER CAN DRAW/.test(prompt) && /naina: poses idle/.test(prompt));
});
console.log(`assets: ${n} checks passed`);
