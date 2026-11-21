'use strict';
// Learned landscapes: every picture the Learning Studio saved as scene_1 must stay its own setting, and baking must stay small.
const assert = require('assert');
const { landscapeName, simplifyLinePaths } = require('../tools/build_characters.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

ok('automatic scene_1 names become the group name, so nine groups are nine settings', () => {
  const groups = ['bridges', 'street', 'warehouse', 'mountain', 'shops', 'patna_corner', 'office_interior', 'kashmiri_cottage', 'chhattisgarhi_village'];
  const names = groups.map((g) => landscapeName(g, 'scene_1'));
  assert.deepStrictEqual(names, groups);
  assert.strictEqual(new Set(names).size, 9);
});
ok('a second automatic picture in a group is group_2; a deliberate file name is kept', () => {
  assert.strictEqual(landscapeName('street', 'scene_2'), 'street_2');
  assert.strictEqual(landscapeName('town', 'market'), 'market');
});
ok('pixel staircases are simplified and the shape stays within the tolerance', () => {
  // a 40x40 square whose right edge wobbles by half a unit per step (under the 0.7 tolerance)
  let d = 'M0 0L40 0';
  for (let i = 0; i < 40; i++) d += `L${40 - 0.5 * (i % 2)} ${i}L${40 - 0.5 * ((i + 1) % 2)} ${i}`;
  d += 'L40 40L0 40Z';
  const out = simplifyLinePaths(`<path fill="#000" d="${d}"/>`, 0.7);
  const m = /d="([^"]*)"/.exec(out)[1];
  assert.ok(m.split('L').length < 12, 'few points left: ' + m.split('L').length);
  const xs = m.replace(/[MZ]/g, '').split('L').map((q) => q.split(' ').map(Number));
  for (const [x, y] of xs) { assert.ok(x >= -0.1 && x <= 40.1 && y >= -0.1 && y <= 40.1); }
});
ok('curved or relative paths are left alone', () => {
  const src = '<path d="M0 0C5 5 10 5 15 0L20 20Z"/><path d="m0 0l5 5z"/>';
  assert.strictEqual(simplifyLinePaths(src, 0.7), src);
});
console.log(`landscapes: ${n} checks passed`);
