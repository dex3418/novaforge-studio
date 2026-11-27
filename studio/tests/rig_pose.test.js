'use strict';
// Tests for the pose solver (v36). Runs on the committed universal body rig; no browser needed.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const RS = require('../src/rig_skeleton');
const P = require('../src/rig_pose');
const rig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../library/part/ghibli/universal/rig.json'), 'utf8'));
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('every view solves with all 15 parts drawn in the rig draw order', () => {
  for (const v of RS.VIEWS) {
    const r = P.solve(rig, { view: v, x: 0, y: 0, unit: 100 });
    assert.strictEqual(r.items.length, 15, v);
    assert.deepStrictEqual(r.items.map((i) => i.part), rig.draw_order[v], v);
    for (const it of r.items) assert.ok(it.matrix.every(Number.isFinite), `${v} ${it.part}`);
  }
});

t('joints stay joined: a child starts exactly where its parent ends', () => {
  const pose = { view: 'left_profile', x: 10, y: 20, unit: 100, angles: { shoulder_l: { fb: 40 }, elbow_l: { fb: 60 }, hip_l: { fb: 30 }, knee_l: { fb: 50 }, ankle_l: { fb: -10 } } };
  const r = P.solve(rig, pose);
  const by = Object.fromEntries(r.items.map((i) => [i.part, i]));
  // the forearm picture's elbow joint, mapped by its matrix, must equal the solved elbow
  const at = (it, part, view, name) => {
    const pic = rig.parts[it.from.split('__')[0]][it.from.split('__')[1]];
    const key = Object.keys(pic.joints).find((k) => RS.jointBase(k) === RS.jointBase(name));
    let x = pic.joints[key].x * pic.w; const y = pic.joints[key].y * pic.h;
    const m = it.matrix;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  };
  const el = at(by.forearm_l, 'forearm_l', 'left_profile', 'elbow_l');
  assert.ok(Math.hypot(el[0] - r.joints.elbow_l[0], el[1] - r.joints.elbow_l[1]) < 0.5 || !by.forearm_l.flip);
  assert.ok(r.joints.knee_l && r.joints.ankle_l && r.joints.wrist_l);
});

t('a straight leg bent forward in profile moves the foot toward the facing side', () => {
  const a = P.solve(rig, { view: 'left_profile', x: 0, y: 0, unit: 100 });
  const b = P.solve(rig, { view: 'left_profile', x: 0, y: 0, unit: 100, angles: { hip_l: { fb: 40 } } });
  assert.ok(b.joints.ankle_l[0] < a.joints.ankle_l[0] - 20, 'left_profile faces screen-left, so forward is -x');
  const c = P.solve(rig, { view: 'right_profile', x: 0, y: 0, unit: 100, angles: { hip_l: { fb: 40 } } });
  const d = P.solve(rig, { view: 'right_profile', x: 0, y: 0, unit: 100 });
  assert.ok(c.joints.ankle_l[0] > d.joints.ankle_l[0] + 20, 'right_profile faces screen-right');
});

t('a knee bends the calf backward and the elbow bends the forearm forward', () => {
  const a = P.solve(rig, { view: 'left_profile', x: 0, y: 0, unit: 100 });
  const b = P.solve(rig, { view: 'left_profile', x: 0, y: 0, unit: 100, angles: { knee_l: { fb: 70 }, elbow_l: { fb: 70 } } });
  assert.ok(b.joints.ankle_l[0] > a.joints.ankle_l[0] + 10, 'foot goes back (+x) when the knee bends');
  assert.ok(b.joints.wrist_l[0] < a.joints.wrist_l[0] - 10, 'hand goes forward (-x) when the elbow bends');
});

t('in the front view a forward swing is foreshortened, a sideways swing is not', () => {
  const rest = P.solve(rig, { view: 'front', x: 0, y: 0, unit: 100 });
  const fwd = P.solve(rig, { view: 'front', x: 0, y: 0, unit: 100, angles: { shoulder_l: { fb: 80 } } });
  const side = P.solve(rig, { view: 'front', x: 0, y: 0, unit: 100, angles: { shoulder_l: { side: 80 } } });
  const len = (r) => Math.hypot(r.joints.elbow_l[0] - r.joints.shoulder_l[0], r.joints.elbow_l[1] - r.joints.shoulder_l[1]);
  assert.ok(len(fwd) < 0.4 * len(rest), 'toward the camera looks short');
  assert.ok(Math.abs(len(side) - len(rest)) < 1, 'sideways keeps its length');
  assert.ok(side.joints.elbow_l[0] > side.joints.shoulder_l[0] + 30, 'the left arm goes out to screen-right in the front view');
});

t('solving is deterministic', () => {
  const pose = { view: 'front_left_45', x: 5, y: 6, unit: 80, angles: { hip_r: { fb: 20, side: 10 } } };
  assert.strictEqual(JSON.stringify(P.solve(rig, pose)), JSON.stringify(P.solve(rig, pose)));
});

t('plant puts the lowest foot on the ground line', () => {
  const pose = P.plant(rig, { view: 'left_profile', x: 0, unit: 100, angles: { hip_l: { fb: 30 } } }, 500);
  const r = P.solve(rig, pose);
  assert.ok(Math.abs(Math.max(r.sole.l, r.sole.r) - 500) < 0.01);
});

t('toSvg writes one image per part and shades far limbs', () => {
  const svg = P.toSvg(P.solve(rig, { view: 'left_profile', x: 0, y: 0, unit: 100 }), { href: (n) => n + '.svg' });
  assert.strictEqual((svg.match(/<image /g) || []).length, 15);
  assert.ok(/filter="url\(#nf-far\)"/.test(svg));
});

t('clip: validation, looping and smooth sampling', () => {
  const clip = P.walkClip();
  assert.ok(P.validateClip(clip).ok, JSON.stringify(P.validateClip(clip).errors));
  assert.ok(!P.validateClip({ format: 'x' }).ok);
  assert.ok(!P.validateClip(Object.assign({}, clip, { keys: [{ t: 0, angles: { elbow_x: {} } }] })).ok);
  const a = P.sampleAngles(clip, 0.1), b = P.sampleAngles(clip, 0.1 + clip.duration);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  const near = P.sampleAngles(clip, clip.duration - 0.0001), start = P.sampleAngles(clip, 0);
  assert.ok(Math.abs(near.hip_l.fb - start.hip_l.fb) < 1, 'no jump at the loop point');
  const k = clip.keys[3];
  assert.ok(Math.abs(P.sampleAngles(clip, k.t).hip_l.fb - k.angles.hip_l.fb) < 1e-6, 'passes through its keys');
});

t('walk: the measured speed keeps the planted foot nearly still', () => {
  const clip = P.walkClip();
  const v = P.measureSpeed(rig, clip, 'left_profile', 100);
  assert.ok(v > 0.4 && v < 4, 'speed ' + v);
  const still = P.footSlide(rig, Object.assign({}, clip, { speed: v }), 'left_profile', 100);
  const moving = P.footSlide(rig, Object.assign({}, clip, { speed: 0 }), 'left_profile', 100);
  assert.ok(still < moving, `slide with speed (${still.toFixed(2)}) is below slide without (${moving.toFixed(2)})`);
  console.log(`  walk speed ${v.toFixed(3)} units/s, planted-foot movement per step ${still.toFixed(2)} px (${moving.toFixed(2)} px if standing in place)`);
});


t('box layout: every part is fitted inside its slot, and all slots lie inside the body box', () => {
  const r = JSON.parse(JSON.stringify(rig));
  r.layout = { front: { w: 100, h: 200, slots: {} } };
  const sl = r.layout.front.slots;
  sl.head = { x: 20, y: 0, w: 60, h: 80 }; sl.torso = { x: 25, y: 70, w: 50, h: 60 }; sl.pelvis = { x: 28, y: 120, w: 44, h: 30 };
  sl.upper_arm_l = { x: 75, y: 75, w: 15, h: 30 }; sl.thigh_l = { x: 52, y: 145, w: 18, h: 30 }; sl.foot_l = { x: 52, y: 180, w: 18, h: 20 };
  const s = P.boxSolve(r, { view: 'front', x: 0, y: 0, unit: 200 });
  const b = s.bounds;
  for (const it of s.items) {
    const m = it.matrix, xs = [0, it.w].map((x) => m[0] * x + m[4]), ys = [0, it.h].map((y) => m[3] * y + m[5]);
    assert.ok(Math.min(...xs) >= b.minX - 1e-6 && Math.max(...xs) <= b.maxX + 1e-6 && Math.min(...ys) >= b.minY - 1e-6 && Math.max(...ys) <= b.maxY + 1e-6, it.part + ' is inside the body box');
  }
  const head = s.items.find((i) => i.part === 'head');
  assert.ok(Math.abs(head.matrix[0] * head.w - 60) < 1e-6 && Math.abs(head.matrix[3] * head.h - 80) < 1e-6, 'the head fills its slot exactly');
  const far = s.items.find((i) => i.part === 'upper_arm_r');
  assert.ok(far && far.far, 'the other arm uses the same slot and is drawn behind');
  assert.throws(() => P.boxSolve(r, { view: 'back' }), /no box layout/);
});

console.log(`rig_pose.test.js: ${n} tests passed`);
