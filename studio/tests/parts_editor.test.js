'use strict';
// Joint editor geometry: normalising, picking by distance on screen, placing, accepting, and the page copy.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const P = require('../learn/parts_editor.js');
const R = require('../src/rig_skeleton.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

ok('a tap becomes 0..1 numbers and is kept inside the picture', () => {
  assert.deepStrictEqual(P.toNorm(150, 100, 300, 200), { x: 0.5, y: 0.5 });
  assert.deepStrictEqual(P.toNorm(-20, 999, 300, 200), { x: 0, y: 1 });
  assert.deepStrictEqual(P.toPx({ x: 0.25, y: 0.5 }, 400, 200), { x: 100, y: 100 });
});
ok('picking uses screen distance, takes the closest joint, and misses when far away', () => {
  const j = R.defaultJoints('upper_arm_l', 'front');           // shoulder at the top, elbow at the bottom
  assert.strictEqual(P.nearest(j, 150, 20, 300, 250, 30), 'shoulder_l');
  assert.strictEqual(P.nearest(j, 150, 230, 300, 250, 30), 'elbow_l');
  assert.strictEqual(P.nearest(j, 20, 120, 300, 250, 30), null);
  const close = { a: { x: 0.5, y: 0.5, confirmed: false }, b: { x: 0.52, y: 0.5, confirmed: false } };
  assert.strictEqual(P.nearest(close, 160, 100, 300, 200, 40), 'b');
  assert.strictEqual(P.nearest(close, 150, 100, 300, 200, 40), 'a');
});
ok('placing a joint confirms it, leaves the others alone and never changes the input', () => {
  const j = R.defaultJoints('forearm_r', 'back');
  const out = P.place(j, 'wrist_r', 0.4, 1.7);
  assert.deepStrictEqual(out.wrist_r, { x: 0.4, y: 1, confirmed: true });
  assert.strictEqual(out.elbow_r.confirmed, false);
  assert.strictEqual(j.wrist_r.confirmed, false);
  assert.throws(() => P.place(j, 'knee_l', 0.5, 0.5));
});
ok('accepting the guesses confirms every joint; waiting joints are found in order', () => {
  const j = R.defaultJoints('torso', 'front');
  assert.deepStrictEqual(P.unconfirmed(j), ['neck', 'waist', 'shoulder_l', 'shoulder_r']);
  assert.strictEqual(P.nextWaiting(j, 'neck'), 'waist');
  const half = P.place(P.place(j, 'neck', 0.5, 0.05), 'waist', 0.5, 0.95);
  assert.strictEqual(P.nextWaiting(half, 'waist'), 'shoulder_l');
  assert.strictEqual(P.nextWaiting(P.acceptAll(j), 'neck'), null);
  assert.deepStrictEqual(P.unconfirmed(P.acceptAll(j)), []);
});
ok('every joint has its own colour, shared by the left and right side', () => {
  for (const id of Object.keys(R.JOINTS)) assert.ok(/^#[0-9a-f]{6}$/i.test(P.colorOf(id)), id);
  assert.strictEqual(P.colorOf('elbow_l'), P.colorOf('elbow_r'));
  assert.notStrictEqual(P.colorOf('elbow_l'), P.colorOf('knee_l'));
});
ok('the page carries the current copy of this file and of the skeleton', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'learn', 'index.html'), 'utf8');
  for (const [file, tag] of [['learn/parts_editor.js', 'PARTS_EDITOR'], ['src/rig_skeleton.js', 'RIG_SKELETON']]) {
    const m = new RegExp('\\/\\*' + tag + '_BEGIN\\*\\/\\n([\\s\\S]*?)\\n\\/\\*' + tag + '_END\\*\\/').exec(html);
    assert.ok(m, tag + ' markers are in index.html');
    assert.strictEqual(m[1], fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\n$/, ''), tag + ' copy is current (run: node tools/sync_reader.js)');
  }
});
console.log(`parts_editor.test.js: ${n} tests passed`);
