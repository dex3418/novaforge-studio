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
ok('the limbs (arm, forearm, hand, thigh, calf, foot) are drawn in the 5 views of one side, with their picture files', () => {
  // the arm in the front picture is the character's RIGHT arm (its body side is on the picture's right); every other arm and every leg is the left, near limb
  const drawn = { upper_arm: ['_r:front', '_l:front_left_45', '_l:left_profile', '_l:back_left_45', '_l:back'], forearm: null, hand: null, thigh: null, calf: null, foot: null };
  const arm = drawn.upper_arm, leg = ['_l:front', '_l:front_left_45', '_l:left_profile', '_l:back_left_45', '_l:back'];
  for (const [p, cells] of Object.entries({ upper_arm: arm, forearm: arm, hand: arm, thigh: leg, calf: leg, foot: leg })) for (const c of cells) {
    const [side, v] = c.split(':'); const name = R.partName(p + side, v);
    assert.ok(rig.parts[p + side] && rig.parts[p + side][v], name + ' is in the rig');
    for (const ext of ['.svg', '.json', '.original.png']) assert.ok(fs.existsSync(path.join(DIR, name + ext)), name + ext);
  }
});
ok('every cell of the 15 parts x 8 views has a picture: drawn, flipped, or the far limb borrowed from the near one', () => {
  const strict = R.coverage(rig); assert.strictEqual(strict.missing.length, 36);   // without borrowing, only the 36 far-side limb cells are open
  const c = R.coverage(rig, { far: true });
  assert.strictEqual(c.drawn, 54); assert.strictEqual(c.mirrored, 30); assert.strictEqual(c.far, 36);
  assert.strictEqual(c.missing.length, 0); assert.ok(c.complete);
  // the right arm seen from the left is the far arm: it uses the near (left) arm picture, not flipped, and says so
  const r = R.resolve(rig, 'upper_arm_r', 'left_profile', { far: true });
  assert.deepStrictEqual([r.part, r.view, r.flip, r.far], ['upper_arm_l', 'left_profile', false, true]);
  // the left arm seen from the right is the far arm too: the near (right) arm there is the flipped left-profile picture
  const l = R.resolve(rig, 'upper_arm_l', 'right_profile', { far: true });
  assert.deepStrictEqual([l.part, l.view, l.flip, l.far], ['upper_arm_l', 'left_profile', true, true]);
  // flat-on views never borrow: the other limb is a plain flip
  const f = R.resolve(rig, 'thigh_r', 'front'); assert.ok(f.flip && !f.far);
});
ok('a drawn picture always wins over a borrowed one', () => {
  const rg = R.emptyRig('t', 's'); R.setPart(rg, { part: 'upper_arm_l', view: 'left_profile', w: 10, h: 10 }); R.setPart(rg, { part: 'upper_arm_r', view: 'left_profile', w: 10, h: 10 });
  const r = R.resolve(rg, 'upper_arm_r', 'left_profile', { far: true }); assert.ok(!r.far && !r.flip && r.part === 'upper_arm_r');
});
console.log(`universal_body.test.js: ${n} tests passed`);
