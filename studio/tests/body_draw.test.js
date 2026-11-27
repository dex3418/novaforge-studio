'use strict';
// The code-drawn body: no assets, every view from the same 3D shapes.
const assert = require('assert');
const B = require('../src/body_draw');
const VIEWS = Object.keys(B.VIEW_YAW);
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('all 8 views draw the same set of body parts, with finite numbers', () => {
  const names = (v) => B.shapes({ view: v }).map((s) => s.name).sort().join(',');
  const first = names('front');
  for (const v of VIEWS) {
    assert.strictEqual(names(v), first, v);
    for (const s of B.shapes({ view: v })) for (const k of Object.keys(s)) if (typeof s[k] === 'number') assert.ok(Number.isFinite(s[k]), `${v} ${s.name} ${k}`);
  }
});

t('front and back are mirror images, left and right profiles too', () => {
  const box = (v) => { const s = B.shapes({ view: v }); return { minX: Math.min(...s.map((x) => (x.cx != null ? x.cx - x.rx : Math.min(x.ax, x.bx) - 30))), maxX: Math.max(...s.map((x) => (x.cx != null ? x.cx + x.rx : Math.max(x.ax, x.bx) + 30))) }; };
  const a = box('left_profile'), b = box('right_profile');
  assert.ok(Math.abs(a.minX + b.maxX) < 40 && Math.abs(a.maxX + b.minX) < 40, 'profiles mirror about the centre line');
});

t('a bent knee lifts the foot, a swung arm moves the hand, in the side view', () => {
  const hand = (a) => B.shapes({ view: 'left_profile', angles: a }).find((s) => s.name === 'hand_l');
  const foot = (a) => B.shapes({ view: 'left_profile', angles: a }).find((s) => s.name === 'foot_l');
  assert.ok(foot({ knee_l: { fb: 80 } }).cy < foot({}).cy - 20, 'foot is higher (screen y is smaller)');
  assert.ok(hand({ shoulder_l: { fb: 60 } }).bx < hand({}).bx - 30, 'the left profile faces screen-left, so forward is -x');
});

t('several bodies on one page never share a clip id', () => {
  const ids = (svg) => [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
  const a = ids(B.draw({ view: 'front' })), b = ids(B.draw({ view: 'back' }));
  assert.ok(a.length > 10 && !a.some((x) => b.includes(x)));
});

t('uses no pictures at all', () => {
  const svg = B.draw({ view: 'front_left_45' });
  assert.ok(!/<image|href=|data:/.test(svg));
});

console.log(`body_draw.test.js: ${n} tests passed`);
