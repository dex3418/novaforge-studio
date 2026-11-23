'use strict';
// The shared skeleton for the universal body (NovaForge Studio, v32).
// One definition used by the Learning Studio's Parts tab (browser) and, from v33, by the rig renderer and the clip player (node/Remotion).
// Everything here is plain data and small pure functions: no DOM, no files.
//
// Conventions (written down once so nothing downstream has to guess):
//   - "left" and "right" are the CHARACTER's own left and right, never the screen's.
//   - A view is named for the side of the character the camera sees. left_profile: the camera is on the character's left, so the
//     character faces screen-left and its left limbs are the near ones. right_profile is the exact mirror image of left_profile.
//   - Joint positions are stored normalised (0..1) inside the part's own picture, so they survive any trace size.
//   - Angles are degrees, forward positive, 0 = hanging straight down (the same convention as the extracted walk clip).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RigSkeleton = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const SKELETON_VERSION = 'nf-skeleton@1';
  const RIG_FORMAT = 'nf-rig@1';

  // the 8 views, named like the Character 360 angles so heads, bodies and outfits all agree
  const VIEWS = ['front', 'front_left_45', 'left_profile', 'back_left_45', 'back', 'back_right_45', 'right_profile', 'front_right_45'];
  const VIEW_LABEL = { front: 'Front', front_left_45: 'Front-left', left_profile: 'Left', back_left_45: 'Back-left', back: 'Back', back_right_45: 'Back-right', right_profile: 'Right', front_right_45: 'Front-right' };
  const VIEW_SHORT = { front: 'F', front_left_45: 'FL', left_profile: 'L', back_left_45: 'BL', back: 'B', back_right_45: 'BR', right_profile: 'R', front_right_45: 'FR' };
  const MIRROR_VIEW = { front: 'front', back: 'back', front_left_45: 'front_right_45', front_right_45: 'front_left_45', left_profile: 'right_profile', right_profile: 'left_profile', back_left_45: 'back_right_45', back_right_45: 'back_left_45' };
  // which side of the character faces the camera (null = both equally)
  const NEAR_SIDE = { front: null, back: null, front_left_45: 'l', left_profile: 'l', back_left_45: 'l', front_right_45: 'r', right_profile: 'r', back_right_45: 'r' };
  // how much the body is turned away from the camera: 0 flat on, 1 full profile
  const TURN = { front: 0, back: 0, front_left_45: 0.5, front_right_45: 0.5, back_left_45: 0.5, back_right_45: 0.5, left_profile: 1, right_profile: 1 };
  const IS_BACK = (v) => v === 'back' || v === 'back_left_45' || v === 'back_right_45';

  // parts. "centre" parts have no side; the others come as _l and _r.
  const CENTRE = ['head', 'torso', 'pelvis'];
  const LIMBS = ['upper_arm', 'forearm', 'hand', 'thigh', 'calf', 'foot'];
  const PARTS = CENTRE.concat(...LIMBS.map((p) => [p + '_l', p + '_r']));
  const PART_LABEL = { head: 'Head', torso: 'Torso', pelvis: 'Pelvis', upper_arm: 'Upper arm', forearm: 'Forearm', hand: 'Hand', thigh: 'Thigh', calf: 'Calf', foot: 'Foot' };
  const sideOf = (part) => (/_l$/.test(part) ? 'l' : /_r$/.test(part) ? 'r' : null);
  const baseOf = (part) => part.replace(/_[lr]$/, '');
  const otherSide = (part) => (sideOf(part) === 'l' ? part.slice(0, -2) + '_r' : sideOf(part) === 'r' ? part.slice(0, -2) + '_l' : part);
  const partLabel = (part) => PART_LABEL[baseOf(part)] + (sideOf(part) ? (sideOf(part) === 'l' ? ' (left)' : ' (right)') : '');

  // joints carried by each part, in that part's own picture. The same joint name in parent and child is the point where they meet.
  const PART_JOINTS = {
    head: ['neck'],
    torso: ['neck', 'waist', 'shoulder_l', 'shoulder_r'],
    pelvis: ['waist', 'hip_l', 'hip_r'],
    upper_arm: ['shoulder', 'elbow'],
    forearm: ['elbow', 'wrist'],
    hand: ['wrist'],
    thigh: ['hip', 'knee'],
    calf: ['knee', 'ankle'],
    foot: ['ankle'],
  };
  const JOINT_LABEL = { neck: 'Neck', waist: 'Waist', shoulder: 'Shoulder', elbow: 'Elbow', wrist: 'Wrist', hip: 'Hip', knee: 'Knee', ankle: 'Ankle' };
  const jointBase = (j) => j.replace(/_[lr]$/, '');
  const jointLabel = (j) => JOINT_LABEL[jointBase(j)] + (/_l$/.test(j) ? ' (left)' : /_r$/.test(j) ? ' (right)' : '');
  // the joint ids a part needs (sides resolved): upper_arm_l carries shoulder_l and elbow_l
  function partJoints(part) {
    const s = sideOf(part);
    return PART_JOINTS[baseOf(part)].map((j) => (s && !/_[lr]$/.test(j) ? j + '_' + s : j));
  }

  // the skeleton: which part each joint moves, and its parent joint. pelvis is the root.
  const JOINTS = {
    waist: { parent: null, moves: 'torso' },
    neck: { parent: 'waist', moves: 'head' },
    shoulder_l: { parent: 'waist', moves: 'upper_arm_l' }, shoulder_r: { parent: 'waist', moves: 'upper_arm_r' },
    elbow_l: { parent: 'shoulder_l', moves: 'forearm_l' }, elbow_r: { parent: 'shoulder_r', moves: 'forearm_r' },
    wrist_l: { parent: 'elbow_l', moves: 'hand_l' }, wrist_r: { parent: 'elbow_r', moves: 'hand_r' },
    hip_l: { parent: null, moves: 'thigh_l' }, hip_r: { parent: null, moves: 'thigh_r' },
    knee_l: { parent: 'hip_l', moves: 'calf_l' }, knee_r: { parent: 'hip_r', moves: 'calf_r' },
    ankle_l: { parent: 'knee_l', moves: 'foot_l' }, ankle_r: { parent: 'knee_r', moves: 'foot_r' },
  };
  // starting guesses for how far each joint may turn, degrees. fb = forward(+)/back(-), side = away from the body(+). Adjustable later.
  const LIMITS = {
    waist: { fb: [-30, 40], side: [-25, 25] }, neck: { fb: [-45, 45], side: [-40, 40] },
    shoulder: { fb: [-60, 180], side: [-20, 170] }, elbow: { fb: [0, 150], side: [0, 0] }, wrist: { fb: [-60, 60], side: [-30, 30] },
    hip: { fb: [-45, 120], side: [-30, 50] }, knee: { fb: [0, 140], side: [0, 0] }, ankle: { fb: [-30, 50], side: [-15, 15] },
  };
  function limitOf(joint, axis) { return LIMITS[jointBase(joint)][axis]; }
  function clampAngle(joint, axis, deg) { const [a, b] = limitOf(joint, axis); return Math.max(a, Math.min(b, deg)); }

  // ---------- names ----------
  const partName = (part, view) => part + '__' + view;
  function parsePartName(name) {
    const m = /^([a-z_]+?)__([a-z0-9_]+)$/.exec(String(name || ''));
    if (!m || !PARTS.includes(m[1]) || !VIEWS.includes(m[2])) return null;
    return { part: m[1], view: m[2] };
  }

  // ---------- drawing order, back to front ----------
  function drawOrder(view) {
    if (!VIEWS.includes(view)) throw new Error('unknown view ' + view);
    const near = NEAR_SIDE[view];
    const limb = (side) => ['upper_arm', 'forearm', 'hand', 'thigh', 'calf', 'foot'].map((p) => p + '_' + side);
    if (!near) return ['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'pelvis', 'torso', 'upper_arm_l', 'upper_arm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'head'];
    const far = near === 'l' ? 'r' : 'l';
    const legs = (s) => ['thigh', 'calf', 'foot'].map((p) => p + '_' + s);
    const arms = (s) => ['upper_arm', 'forearm', 'hand'].map((p) => p + '_' + s);
    return [].concat(arms(far), legs(far), ['pelvis', 'torso'], legs(near), arms(near), ['head']);
  }

  // ---------- starting guesses for joint positions ----------
  // Parts are drawn upright, so a joint sits near the top or bottom end of its part. Where it sits sideways depends on the view.
  // These are only a starting point: the Parts tab marks a joint "confirmed" only after you accept or move it.
  const ENDS = {
    head: { neck: [0.5, 0.93] },
    torso: { neck: [0.5, 0.05], waist: [0.5, 0.95], shoulder: [null, 0.45] },   // the chibi mannequin's shoulder stubs sit about half way down
    pelvis: { waist: [0.5, 0.06], hip: [null, 0.58] },
    upper_arm: { shoulder: [0.5, 0.08], elbow: [0.5, 0.92] },
    forearm: { elbow: [0.5, 0.08], wrist: [0.5, 0.92] },
    hand: { wrist: [0.5, 0.1] },
    thigh: { hip: [0.5, 0.08], knee: [0.5, 0.92] },
    calf: { knee: [0.5, 0.08], ankle: [0.5, 0.92] },
    foot: { ankle: [0.5, 0.22] },
  };
  function defaultJoints(part, view) {
    if (!PARTS.includes(part)) throw new Error('unknown part ' + part);
    if (!VIEWS.includes(view)) throw new Error('unknown view ' + view);
    const out = {}, turn = TURN[view], flip = IS_BACK(view) ? -1 : 1;
    for (const j of partJoints(part)) {
      const base = jointBase(j), side = /_([lr])$/.exec(j);
      const e = ENDS[baseOf(part)][base];
      let x = e[0];
      if (x === null) {
        // a paired joint on a centre part (shoulders on the torso, hips on the pelvis): the character's left is on screen-right when seen from the front
        const dir = (side[1] === 'l' ? 1 : -1) * flip;
        x = 0.5 + dir * (base === 'shoulder' ? 0.36 : 0.2) * (1 - 0.8 * turn);
      } else if (baseOf(part) === 'foot') {
        // the ankle sits over the heel, so it moves toward the back of the foot as the body turns to profile
        const faces = view === 'left_profile' || view === 'front_left_45' || view === 'back_left_45' ? 1 : view === 'right_profile' || view === 'front_right_45' || view === 'back_right_45' ? -1 : 0;
        x = 0.5 + faces * 0.15 * turn;
      }
      out[j] = { x: +x.toFixed(3), y: e[1], confirmed: false };
    }
    return out;
  }

  // ---------- mirroring: which drawn picture can stand in for a part in a view ----------
  // A part in a view can be mirrored from (a) the opposite-side part in the same view when the view looks at the body flat on
  // (front, back), or (b) the same part, or the opposite-side part, in the mirror view.
  function resolve(rig, part, view) {
    const has = (p, v) => !!(rig && rig.parts && rig.parts[p] && rig.parts[p][v]);
    if (has(part, view)) return { part, view, flip: false };
    const mv = MIRROR_VIEW[view];
    const op = otherSide(part);
    if (mv !== view && has(op, mv)) return { part: op, view: mv, flip: true };            // opposite side in the mirror view, flipped
    if (mv === view && op !== part && has(op, view)) return { part: op, view, flip: true }; // flat-on view: the other limb, flipped
    if (sideOf(part) === null && mv !== view && has(part, mv)) return { part, view: mv, flip: true }; // centre part in the mirror view
    return null;
  }

  // ---------- the rig object (what is saved as rig.json) ----------
  function emptyRig(body, style) {
    return { format: RIG_FORMAT, skeleton: SKELETON_VERSION, body, style, parts: {}, draw_order: Object.fromEntries(VIEWS.map((v) => [v, drawOrder(v)])) };
  }
  // add or replace one drawn part picture. joints may be partial: any joint not given starts from the guess.
  function setPart(rig, { part, view, asset, w, h, joints }) {
    if (!PARTS.includes(part)) throw new Error('unknown part ' + part);
    if (!VIEWS.includes(view)) throw new Error('unknown view ' + view);
    const guess = defaultJoints(part, view), j = {};
    for (const id of Object.keys(guess)) {
      const g = joints && joints[id];
      j[id] = g ? { x: +g.x, y: +g.y, confirmed: !!g.confirmed } : guess[id];
    }
    (rig.parts[part] = rig.parts[part] || {})[view] = { asset: asset || partName(part, view), w: +w, h: +h, joints: j };
    return rig;
  }
  function coverage(rig) {
    const cells = [];
    let drawn = 0, mirrored = 0;
    const missing = [];
    for (const part of PARTS) for (const view of VIEWS) {
      const r = resolve(rig, part, view);
      const state = !r ? 'missing' : r.flip ? 'mirrored' : 'drawn';
      cells.push({ part, view, state });
      if (state === 'drawn') drawn++; else if (state === 'mirrored') mirrored++; else missing.push({ part, view });
    }
    return { total: PARTS.length * VIEWS.length, drawn, mirrored, missing, cells, complete: !missing.length };
  }
  function validateRig(rig) {
    const errors = [], warnings = [];
    if (!rig || typeof rig !== 'object') return { ok: false, errors: ['rig is not an object'], warnings };
    if (rig.format !== RIG_FORMAT) errors.push(`format must be ${RIG_FORMAT}`);
    if (rig.skeleton !== SKELETON_VERSION) errors.push(`skeleton must be ${SKELETON_VERSION}`);
    if (!/^[a-z0-9_-]{1,40}$/.test(String(rig.body || ''))) errors.push('body id is missing or has odd characters');
    if (!rig.parts || typeof rig.parts !== 'object') errors.push('parts is missing');
    let unconfirmed = 0;
    for (const [part, views] of Object.entries(rig.parts || {})) {
      if (!PARTS.includes(part)) { errors.push(`unknown part "${part}"`); continue; }
      for (const [view, e] of Object.entries(views || {})) {
        const at = `${part}/${view}`;
        if (!VIEWS.includes(view)) { errors.push(`${at}: unknown view`); continue; }
        if (!(e.w > 0 && e.h > 0)) errors.push(`${at}: picture size is missing`);
        if (!e.asset || e.asset !== partName(part, view)) errors.push(`${at}: asset must be ${partName(part, view)}`);
        for (const need of partJoints(part)) {
          const jt = e.joints && e.joints[need];
          if (!jt) { errors.push(`${at}: joint ${need} is missing`); continue; }
          if (!(jt.x >= 0 && jt.x <= 1 && jt.y >= 0 && jt.y <= 1)) errors.push(`${at}: joint ${need} is outside the picture`);
          if (!jt.confirmed) unconfirmed++;
        }
      }
    }
    if (unconfirmed) warnings.push(`${unconfirmed} joint position${unconfirmed === 1 ? ' is' : 's are'} still a starting guess`);
    const order = rig.draw_order || {};
    for (const v of VIEWS) {
      const o = order[v];
      if (!Array.isArray(o) || o.length !== PARTS.length || new Set(o).size !== PARTS.length || o.some((p) => !PARTS.includes(p))) errors.push(`draw order for ${v} must list every part once`);
    }
    return { ok: !errors.length, errors, warnings };
  }

  return {
    SKELETON_VERSION, RIG_FORMAT, VIEWS, VIEW_LABEL, VIEW_SHORT, MIRROR_VIEW, NEAR_SIDE, TURN, PARTS, PART_LABEL, CENTRE, LIMBS, JOINTS, LIMITS,
    sideOf, baseOf, otherSide, partLabel, jointLabel, jointBase, partJoints, limitOf, clampAngle,
    partName, parsePartName, drawOrder, defaultJoints, resolve, emptyRig, setPart, coverage, validateRig,
  };
}));
