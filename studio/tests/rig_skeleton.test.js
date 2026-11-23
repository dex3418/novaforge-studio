'use strict';
// The shared skeleton: names, joints, draw order, mirroring, coverage and rig validation.
const assert = require('assert');
const R = require('../src/rig_skeleton.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

ok('8 views and 15 parts (3 centre parts, 6 limb parts on each side)', () => {
  assert.strictEqual(R.VIEWS.length, 8);
  assert.strictEqual(R.PARTS.length, 15);
  assert.deepStrictEqual(R.CENTRE, ['head', 'torso', 'pelvis']);
});
ok('the views carry the same names as the Character 360 angles', () => {
  assert.deepStrictEqual(R.VIEWS, ['front', 'front_left_45', 'left_profile', 'back_left_45', 'back', 'back_right_45', 'right_profile', 'front_right_45']);
});
ok('every part+view name round-trips and fits the library name limit (40 characters)', () => {
  for (const p of R.PARTS) for (const v of R.VIEWS) {
    const name = R.partName(p, v);
    assert.ok(name.length <= 40 && /^[a-z0-9_-]+$/.test(name), name);
    assert.deepStrictEqual(R.parsePartName(name), { part: p, view: v });
  }
  assert.strictEqual(R.parsePartName('head__sideways'), null);
  assert.strictEqual(R.parsePartName('tail__front'), null);
  assert.strictEqual(R.parsePartName('head'), null);
});
ok('every joint a part carries exists in the skeleton, and every skeleton joint sits on the part it moves', () => {
  for (const p of R.PARTS) for (const j of R.partJoints(p)) assert.ok(R.JOINTS[j], `${p} -> ${j}`);
  for (const [j, d] of Object.entries(R.JOINTS)) {
    assert.ok(R.partJoints(d.moves).includes(j), `${j} should be carried by ${d.moves}`);
    if (d.parent) assert.ok(R.JOINTS[d.parent], `${j} parent ${d.parent}`);
  }
  assert.deepStrictEqual(R.partJoints('upper_arm_l'), ['shoulder_l', 'elbow_l']);
  assert.deepStrictEqual(R.partJoints('calf_r'), ['knee_r', 'ankle_r']);
  assert.deepStrictEqual(R.partJoints('torso'), ['neck', 'waist', 'shoulder_l', 'shoulder_r']);
});
ok('draw order lists every part once, head last, and puts the far limbs behind the body in side views', () => {
  for (const v of R.VIEWS) {
    const o = R.drawOrder(v);
    assert.strictEqual(o.length, 15); assert.strictEqual(new Set(o).size, 15); assert.strictEqual(o[o.length - 1], 'head');
  }
  const L = R.drawOrder('left_profile'), Rr = R.drawOrder('right_profile');
  assert.ok(L.indexOf('upper_arm_r') < L.indexOf('torso') && L.indexOf('torso') < L.indexOf('upper_arm_l'), 'left profile: right arm behind, left arm in front');
  assert.ok(Rr.indexOf('upper_arm_l') < Rr.indexOf('torso') && Rr.indexOf('torso') < Rr.indexOf('upper_arm_r'), 'right profile is the mirror');
  assert.ok(L.indexOf('thigh_r') < L.indexOf('pelvis') && L.indexOf('pelvis') < L.indexOf('thigh_l'));
  assert.throws(() => R.drawOrder('sideways'));
});
ok('starting joint guesses stay inside the picture and follow the view', () => {
  for (const p of R.PARTS) for (const v of R.VIEWS) for (const [j, g] of Object.entries(R.defaultJoints(p, v))) {
    assert.ok(g.x >= 0 && g.x <= 1 && g.y >= 0 && g.y <= 1, `${p}/${v}/${j}`);
    assert.strictEqual(g.confirmed, false);
  }
  const f = R.defaultJoints('torso', 'front'), b = R.defaultJoints('torso', 'back'), s = R.defaultJoints('torso', 'left_profile');
  assert.ok(f.shoulder_l.x > 0.5 && f.shoulder_r.x < 0.5, 'front: the left shoulder is on the screen right');
  assert.ok(b.shoulder_l.x < 0.5 && b.shoulder_r.x > 0.5, 'back: reversed');
  assert.ok(Math.abs(s.shoulder_l.x - 0.5) < 0.12, 'profile: both shoulders nearly on top of each other');
  assert.ok(R.defaultJoints('foot_l', 'left_profile').ankle_l.x > 0.5 && R.defaultJoints('foot_r', 'right_profile').ankle_r.x < 0.5, 'ankle moves toward the heel');
});
ok('an empty rig has nothing drawn and 120 missing cells', () => {
  const c = R.coverage(R.emptyRig('mannequin', 'ghibli'));
  assert.strictEqual(c.total, 120); assert.strictEqual(c.missing.length, 120); assert.strictEqual(c.complete, false);
});
ok('a drawn part stands in for its mirror: other side of a flat-on view, and the mirror view', () => {
  const rig = R.emptyRig('mannequin', 'ghibli');
  R.setPart(rig, { part: 'thigh_l', view: 'front', w: 100, h: 300 });
  R.setPart(rig, { part: 'upper_arm_l', view: 'left_profile', w: 80, h: 250 });
  R.setPart(rig, { part: 'head', view: 'front_left_45', w: 300, h: 330 });
  assert.deepStrictEqual(R.resolve(rig, 'thigh_r', 'front'), { part: 'thigh_l', view: 'front', flip: true });
  assert.deepStrictEqual(R.resolve(rig, 'upper_arm_r', 'right_profile'), { part: 'upper_arm_l', view: 'left_profile', flip: true });
  assert.deepStrictEqual(R.resolve(rig, 'head', 'front_right_45'), { part: 'head', view: 'front_left_45', flip: true });
  assert.deepStrictEqual(R.resolve(rig, 'thigh_l', 'front'), { part: 'thigh_l', view: 'front', flip: false });
  assert.strictEqual(R.resolve(rig, 'upper_arm_l', 'right_profile'), null, 'the far arm is not the near arm flipped');
  assert.strictEqual(R.resolve(rig, 'head', 'front'), null);
  const c = R.coverage(rig);
  assert.strictEqual(c.drawn, 3); assert.strictEqual(c.mirrored, 3); assert.strictEqual(c.missing.length, 114);
});
ok('setPart fills missing joints with guesses and keeps the ones you placed', () => {
  const rig = R.emptyRig('m', 'ghibli');
  R.setPart(rig, { part: 'forearm_r', view: 'back', w: 90, h: 260, joints: { elbow_r: { x: 0.4, y: 0.1, confirmed: true } } });
  const j = rig.parts.forearm_r.back.joints;
  assert.deepStrictEqual(j.elbow_r, { x: 0.4, y: 0.1, confirmed: true });
  assert.strictEqual(j.wrist_r.confirmed, false);
  assert.strictEqual(rig.parts.forearm_r.back.asset, 'forearm_r__back');
  assert.throws(() => R.setPart(rig, { part: 'tail', view: 'back', w: 1, h: 1 }));
  assert.throws(() => R.setPart(rig, { part: 'head', view: 'upside', w: 1, h: 1 }));
});
ok('validateRig accepts a good rig, warns about guesses, and rejects broken ones', () => {
  const rig = R.emptyRig('mannequin', 'ghibli');
  R.setPart(rig, { part: 'head', view: 'front', w: 300, h: 330 });
  let v = R.validateRig(rig);
  assert.strictEqual(v.ok, true); assert.ok(v.warnings.some((w) => /starting guess/.test(w)));
  rig.parts.head.front.joints.neck.confirmed = true;
  assert.deepStrictEqual(R.validateRig(rig).warnings, []);
  const bad = JSON.parse(JSON.stringify(rig));
  bad.parts.head.front.joints.neck.x = 1.4; v = R.validateRig(bad); assert.ok(!v.ok && v.errors.some((e) => /outside the picture/.test(e)));
  const bad2 = JSON.parse(JSON.stringify(rig)); delete bad2.parts.head.front.joints.neck; assert.ok(R.validateRig(bad2).errors.some((e) => /neck is missing/.test(e)));
  const bad3 = JSON.parse(JSON.stringify(rig)); bad3.parts.head.front.asset = 'something_else'; assert.ok(R.validateRig(bad3).errors.some((e) => /asset must be/.test(e)));
  const bad4 = JSON.parse(JSON.stringify(rig)); bad4.draw_order.front = ['head']; assert.ok(R.validateRig(bad4).errors.some((e) => /draw order/.test(e)));
  const bad5 = JSON.parse(JSON.stringify(rig)); bad5.parts.wing = { front: {} }; assert.ok(R.validateRig(bad5).errors.some((e) => /unknown part/.test(e)));
  assert.strictEqual(R.validateRig(null).ok, false);
  assert.strictEqual(R.validateRig(Object.assign({}, rig, { body: 'Bad Name!' })).ok, false);
});
ok('joint limits clamp angles to what the joint can do', () => {
  assert.strictEqual(R.clampAngle('elbow_l', 'fb', -20), 0);
  assert.strictEqual(R.clampAngle('elbow_r', 'fb', 200), 150);
  assert.strictEqual(R.clampAngle('knee_l', 'side', 30), 0);
  assert.strictEqual(R.clampAngle('shoulder_l', 'fb', 90), 90);
});
console.log(`rig_skeleton.test.js: ${n} tests passed`);
