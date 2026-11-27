const assert = require('assert'), fs = require('fs'), path = require('path');
const T = require('../src/body_traced.js'), { POSES } = require('../src/body_poses.js'), B = require('../src/body_draw.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../library/body_traced/ghibli/parts.json')));
let n = 0; const t = (name, fn) => { fn(); n++; };
t('every pose draws in all 8 views from the traced parts, with finite numbers', () => {
  for (const [name, a] of Object.entries(POSES)) for (const v of Object.keys(B.VIEW_YAW)) {
    const svg = T.draw({ data, view: v, angles: a });
    assert.ok(!/NaN|Infinity/.test(svg), name + ' ' + v);
    assert.ok((svg.match(/<g transform/g) || []).length >= 14, name + ' ' + v + ' draws its parts');
  }
});
t('a limb hidden in the reference view (far arm in a profile) still appears', () => {
  const svg = T.draw({ data, view: 'left_profile', angles: { shoulder_r: { side: 90 } } });
  assert.ok((svg.match(/<g transform/g) || []).length >= 15);
});
t('no pictures, only vector paths', () => assert.ok(!/<image|href=|data:/.test(T.draw({ data, view: 'front' }))));
console.log('body_traced.test.js: ' + n + ' tests passed');
