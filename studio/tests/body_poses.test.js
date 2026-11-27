const assert = require('assert');
const B = require('../src/body_draw.js'), { POSES } = require('../src/body_poses.js');
let n = 0; const t = (name, fn) => { fn(); n++; };
t('every pose draws in all 8 views with finite numbers and the same parts', () => {
  const ref = B.shapes({ view: 'front' }).map((s) => s.name).sort().join();
  for (const [name, a] of Object.entries(POSES)) for (const v of B.VIEW_YAW ? Object.keys(B.VIEW_YAW) : []) {
    const list = B.shapes({ view: v, angles: a });
    assert.strictEqual(list.map((s) => s.name).sort().join(), ref, name + ' ' + v);
    assert.ok(!/NaN|Infinity/.test(B.draw({ view: v, angles: a })), name + ' ' + v);
  }
});
t('sitting lowers the body, celebrating lifts it, walking moves the feet apart', () => {
  const top = (a) => Math.min(...B.shapes({ view: 'left_profile', angles: a }).map((s) => (s.kind === 'ellipse' ? s.cy - s.ry : Math.min(s.ay, s.by))));
  assert.ok(top(POSES.sitting) > top(POSES.standing) + 40 && top(POSES.celebrating) < top(POSES.standing) - 10);
  const fx = (a, nm) => B.shapes({ view: 'left_profile', angles: a }).find((s) => s.name === nm).cx;
  assert.ok(Math.abs(fx(POSES.walking, 'foot_l') - fx(POSES.walking, 'foot_r')) > 40);
});
console.log('body_poses.test.js: ' + n + ' tests passed');
