'use strict';
// Casting: every person in a story gets a trained library character that fits them; nobody gets the old flat figure.
const assert = require('assert');
const C = require('../src/casting');
const S = require('../src/story');

const TRAINED = ['aarohi', 'laraphi', 'madhura', 'mahesh', 'mangal', 'manjeet_kaka', 'narayanan', 'zoya_toddler', 'naina', 'nikita'];
const have = (id) => TRAINED.includes(id);
const gof = (c) => c.look.gender || 'm';
const pick = (str) => C.assign(S.parseCast(str), have, gof);
let n = 0; const ok = (name, fn) => { fn(); n++; };

ok('a person named like a library character gets that character, including aliases and the old Naina', () => {
  const a = pick('Mangal; Zoya; Iaraphi; Naina; Narayanan');
  assert.deepStrictEqual(a, { mangal: 'mangal', zoya: 'zoya_toddler', iaraphi: 'laraphi', naina: 'naina', narayanan: 'narayanan' });
});
ok('gender and age group decide: a woman in a saree, a boy, an old man', () => {
  const a = pick('Sita (woman, saree); Chhotu (boy); Dadaji (man, old)');
  assert.strictEqual(a.sita, 'madhura'); assert.strictEqual(a.chhotu, 'mangal'); assert.strictEqual(a.dadaji, 'narayanan');
});
ok('looks decide between two grown-up men: a turban is Manjeet Kaka, a moustache and glasses is Mahesh', () => {
  assert.strictEqual(pick('Ramu (man, turban)').ramu, 'manjeet_kaka');
  assert.strictEqual(pick('Seth (man, moustache, glasses)').seth, 'mahesh');
});
ok('nobody shares a character while a free one fits', () => {
  const a = pick('Sonu (man); Ravi (man); Aman (man, beard)');
  assert.strictEqual(new Set(Object.values(a)).size, 3);
});
ok('a person with no profiled characters trained gets nothing (the story then falls back), and Naina and Nikita are never auto-cast', () => {
  assert.deepStrictEqual(C.assign(S.parseCast('Sonu (man)'), (id) => id === 'naina', gof), {});
  const many = pick('A (woman); B (woman); C (woman); D (woman); E (woman)');
  assert.ok(Object.values(many).every((id) => id !== 'naina' && id !== 'nikita'));
});
ok('heights: baby and toddler are small, a grown-up is 1, an elder a little less, unprofiled characters keep the old rule', () => {
  assert.ok(C.sizeOf('aarohi') < C.sizeOf('zoya_toddler') && C.sizeOf('zoya_toddler') < C.sizeOf('mangal') && C.sizeOf('mangal') < C.sizeOf('laraphi'));
  assert.strictEqual(C.sizeOf('mahesh'), 1); assert.ok(C.sizeOf('narayanan') < 1); assert.strictEqual(C.sizeOf('naina'), 0);
});
ok('every library profile is complete', () => {
  for (const [id, p] of Object.entries(C.DATA)) { assert.ok(/^[a-z0-9_]+$/.test(id), id); assert.ok(p.name && (p.gender === 'm' || p.gender === 'f') && p.age >= 0 && Array.isArray(p.tags), id); }
});
console.log(`casting.test.js: ${n} tests passed`);
