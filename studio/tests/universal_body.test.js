'use strict';
// The shared Ghibli body that is committed in library/part/ghibli/universal: what is there, that it is valid, and what is still missing.
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = require('../src/rig_skeleton');
const DIR = path.join(__dirname, '..', '..', 'library', 'part', 'ghibli', 'universal');
const rig = JSON.parse(fs.readFileSync(path.join(DIR, 'rig.json'), 'utf8'));
let n = 0; const ok = (name, fn) => { fn(); n++; };
ok('the rig file is valid and belongs to the universal body in the ghibli style', () => {
  const v = R.validateRig(rig); assert.ok(v.ok, v.errors.join('; '));
  assert.strictEqual(rig.body, 'universal'); assert.strictEqual(rig.style, 'ghibli');
});
ok('head, torso and pelvis are drawn in all 8 views, each with its picture file and records', () => {
  for (const p of ['head', 'torso', 'pelvis']) for (const v of R.VIEWS) {
    const name = R.partName(p, v);
    assert.ok(rig.parts[p] && rig.parts[p][v], name + ' is in the rig');
    for (const ext of ['.svg', '.json', '.original.png']) assert.ok(fs.existsSync(path.join(DIR, name + ext)), name + ext);
  }
});
ok('every picture is a clean trace: no green background colour left, a sane size, drawn paths', () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.svg'))) {
    const s = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.ok(s.length < 150 * 1024, f + ' is ' + Math.round(s.length / 1024) + ' KB');
    assert.ok((s.match(/<path/g) || []).length >= 5, f + ' has paths');
    for (const h of new Set(s.match(/#[0-9a-fA-F]{6}/g) || [])) {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      assert.ok(!(g > r + 25 && g > b + 25), f + ' still has the green ' + h);
    }
  }
});
ok('the limbs are what is still missing (12 parts x 8 views), so the body cannot be animated yet', () => {
  const c = R.coverage(rig);
  assert.strictEqual(c.drawn, 24); assert.strictEqual(c.missing.length, 96);
  assert.ok(R.PARTS.filter((p) => !['head', 'torso', 'pelvis'].includes(p)).every((p) => !rig.parts[p] || !Object.keys(rig.parts[p]).length));
});
console.log(`universal_body.test.js: ${n} tests passed`);
