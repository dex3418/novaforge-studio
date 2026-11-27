'use strict';
// The pose solver and SVG drawer for the universal body (NovaForge Studio, v36).
// Plain data in, plain data out: no DOM, no files, so it runs in node, in Remotion and in the Learning Studio page.
//
//   solve(rig, pose)  ->  { items[], joints{}, bounds }   every part with its picture and a 2D matrix, in drawing order
//   toSvg(solved, { href })                                 the same thing as one SVG string
//
// A pose is   { view, x, y, unit, angles: { joint: { fb, side } } }
//   view   one of the 8 views. The camera is fixed by the view, the angles are the body's own (forward / away from the body).
//   x, y   where the waist is on screen, in pixels (y grows downward).
//   unit   how many pixels tall the torso is drawn (default 100). Every other part is sized from it (PROPORTIONS).
//   angles degrees, 0 = hanging straight down, "fb" forward positive, "side" away from the body positive. Missing = 0.
//          Knee and elbow bend with positive fb (the calf swings back, the forearm swings forward), like a real joint.
//
// How it moves: every limb is a chain of segments. Each segment has a direction in 3D (X = the character's left, Y up, Z forward),
// the camera of the view projects it to the screen, and the picture of that part is turned and shortened to match
// (a segment pointing at the camera is drawn short). Joints stay joined because each child starts at its parent's end point.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rig_skeleton'));
  else root.RigPose = factory(root.RigSkeleton);
}(typeof self !== 'undefined' ? self : this, function (RS) {
  const POSE_VERSION = 'nf-pose@1';
  const CLIP_FORMAT = 'nf-clip@1';
  const rad = (d) => (d * Math.PI) / 180;

  // camera yaw of each view in degrees: 0 looks at the front, 90 at the character's left side, 180 at the back
  const VIEW_YAW = { front: 0, front_left_45: 45, left_profile: 90, back_left_45: 135, back: 180, back_right_45: 225, right_profile: 270, front_right_45: 315 };
  // the side of the screen the character faces: -1 left, +1 right, 0 toward or away from the camera
  const FACING = { front: 0, back: 0, left_profile: -1, right_profile: 1, front_left_45: -1, front_right_45: 1, back_left_45: -1, back_right_45: 1 };

  // sizes of the parts as fractions of the torso's drawn height (the unit). "len" = joint to joint, "h" = the picture's own height.
  // Starting values, set by eye on the chibi body: they live in rig.proportions when a rig wants its own.
  const PROPORTIONS = {
    head: { h: 1.0 }, torso: { h: 1.0 }, pelvis: { h: 0.6 },
    upper_arm: { len: 0.5 }, forearm: { len: 0.45 }, hand: { h: 0.28 },
    thigh: { len: 0.58 }, calf: { len: 0.52 }, foot: { h: 0.24 },
  };

  // ---------- small 3D helpers (3x3 matrices as arrays of rows) ----------
  const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  const app = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
  // forward bend about the character's X axis: a hanging segment swings toward +Z (forward) for positive a
  const rotFb = (a) => { const c = Math.cos(rad(a)), s = Math.sin(rad(a)); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
  // sideways swing about Z: a hanging segment moves toward +X for positive a
  const rotSide = (a) => { const c = Math.cos(rad(a)), s = Math.sin(rad(a)); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const OVERLAP = 0.04; // how far a part is sunk into its parent, in units, so joints do not show a gap

  // the camera: 3D vector -> screen vector (x right, y down), and how long a unit vector looks
  function project(v, view) {
    const p = rad(VIEW_YAW[view]);
    return [v[0] * Math.cos(p) - v[2] * Math.sin(p), -v[1]];
  }

  // ---------- pictures and joints ----------
  function pictureFor(rig, part, view) {
    const src = RS.resolve(rig, part, view, { far: true });
    if (!src) return null;
    const entry = rig.parts[src.part][src.view];
    return { part, src, entry, flip: !!src.flip, far: !!src.far, w: entry.w, h: entry.h, asset: entry.asset };
  }
  // joint position in the picture as it will be drawn (after the flip), in pixels
  function jointPx(pic, name) {
    const j = pic.entry.joints;
    let key = name;
    if (pic.flip && RS.sideOf(pic.src.part) === null && /_[lr]$/.test(name)) key = name.endsWith('_l') ? name.slice(0, -2) + '_r' : name.slice(0, -2) + '_l';
    if (!j[key]) {
      const base = RS.jointBase(name);
      key = Object.keys(j).find((k) => RS.jointBase(k) === base);
      if (!key) throw new Error(`no joint ${name} in ${pic.src.part}__${pic.src.view}`);
    }
    const x = j[key].x * pic.w, y = j[key].y * pic.h;
    return [pic.flip ? pic.w - x : x, y];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function partWidth(rig, part) { const e = Object.assign({}, PROPORTIONS, rig.proportions || {})[RS.baseOf(part)]; return e && e.w != null ? +e.w : 1; }

  // pixels per picture pixel for a part, the same for all its views (measured in its front view when it has one)
  function partScale(rig, part, U, pic) {
    const base = RS.baseOf(part);
    const prop = Object.assign({}, PROPORTIONS, rig.proportions || {})[base];
    const ref = pictureFor(rig, part, 'front') || pic;
    if (prop.len) {
      const [ja, jb] = RS.partJoints(part);
      return (prop.len * U) / dist(jointPx(ref, ja), jointPx(ref, jb));
    }
    return (prop.h * U) / ref.h;
  }

  // a frame places one picture: picture point A lands on P, the picture's A->B direction follows the screen direction t, shortened by f
  function makeFrame(pic, A, B, P, t, f, s, w) {
    const wd = (w == null ? 1 : w); // width factor across the part, for pictures drawn chunkier than the body they belong to
    const lp = dist(A, B) || 1;
    const uv = [(B[0] - A[0]) / lp, (B[1] - A[1]) / lp];
    const nv = [-uv[1], uv[0]];
    const tn = [-t[1], t[0]];
    const map = (p) => {
      const q = [p[0] - A[0], p[1] - A[1]];
      const al = q[0] * uv[0] + q[1] * uv[1], ac = q[0] * nv[0] + q[1] * nv[1];
      return [P[0] + t[0] * al * s * f + tn[0] * ac * s * wd, P[1] + t[1] * al * s * f + tn[1] * ac * s * wd];
    };
    const o = map([0, 0]), ex = map([1, 0]), ey = map([0, 1]);
    const a = ex[0] - o[0], b = ex[1] - o[1], c = ey[0] - o[0], d = ey[1] - o[1];
    // the drawn file is not flipped: flipped pictures are mirrored here, x -> w - x
    const matrix = pic.flip ? [-a, -b, c, d, o[0] + a * pic.w, o[1] + b * pic.w] : [a, b, c, d, o[0], o[1]];
    return { map, matrix, length: lp * s * f };
  }

  // direction of a segment on screen from its 3D rotation. Returns { t, f }: unit direction and foreshortening (0.28..1)
  function seg(R, up, view, keep) {
    const v = project(app(R, up ? UP : DOWN), view);
    const len = Math.hypot(v[0], v[1]);
    const t = len > 0.02 ? [v[0] / len, v[1] / len] : (keep || (up ? [0, -1] : [0, 1]));
    return { t, f: Math.max(0.28, Math.min(1, len)) };
  }

  function ang(pose, joint) { const a = (pose.angles && pose.angles[joint]) || {}; return { fb: +a.fb || 0, side: +a.side || 0 }; }
  // local rotation of a hanging joint; sign: +1 for the left limbs, -1 for the right (away from the body flips)
  function localDown(pose, joint, kneeLike) {
    const a = ang(pose, joint);
    const s = /_r$/.test(joint) ? -1 : 1;
    return mul(rotSide(s * a.side), rotFb(kneeLike ? -a.fb : a.fb));
  }
  // local rotation of an upright joint (waist, neck): positive fb leans forward, positive side leans toward the character's left
  function localUp(pose, joint) {
    const a = ang(pose, joint);
    return mul(rotSide(-a.side), rotFb(-a.fb));
  }

  // ---------- the solver ----------
  // angles added on top of the rig's own rest pose (rig.rest.angles): 0 means "relaxed", which for the chibi body has the arms slightly out
  function withRest(rig, pose) {
    const rest = (rig.rest && rig.rest.angles) || {};
    const out = {};
    for (const j of new Set(Object.keys(rest).concat(Object.keys(pose.angles || {})))) {
      const a = rest[j] || {}, b = (pose.angles && pose.angles[j]) || {};
      out[j] = { fb: (+a.fb || 0) + (+b.fb || 0), side: (+a.side || 0) + (+b.side || 0) };
    }
    return Object.assign({}, pose, { angles: out });
  }

  function solve(rig, rawPose) {
    const pose = withRest(rig, rawPose);
    const view = pose.view || 'front';
    if (!RS.VIEWS.includes(view)) throw new Error('unknown view ' + view);
    const U = pose.unit || 100;
    const items = {};
    const joints = {};
    const root = [+pose.x || 0, +pose.y || 0];
    const need = (part) => { const p = pictureFor(rig, part, view); if (!p) throw new Error(`the rig has no picture for ${part} in ${view}`); return p; };
    const put = (part, pic, frame) => { items[part] = { part, asset: pic.asset, w: pic.w, h: pic.h, matrix: frame.matrix, far: pic.far, flip: pic.flip, from: pic.src.part + '__' + pic.src.view }; };

    // pelvis: the root. Not rotated; the waist joint sits on (x, y)
    const pel = need('pelvis');
    const sPel = partScale(rig, 'pelvis', U, pel);
    const waistP = jointPx(pel, 'waist');
    const fPel = makeFrame(pel, waistP, [waistP[0], waistP[1] + 1], root, [0, 1], 1, sPel, partWidth(rig, 'pelvis'));
    put('pelvis', pel, fPel);
    joints.waist = root.slice();
    const hipW = { l: fPel.map(jointPx(pel, 'hip_l')), r: fPel.map(jointPx(pel, 'hip_r')) };
    joints.hip_l = hipW.l; joints.hip_r = hipW.r;

    // torso: hangs UP from the waist, turned by the waist angles
    const tor = need('torso');
    const sTor = partScale(rig, 'torso', U, tor);
    const Rw = localUp(pose, 'waist');
    const sw = seg(Rw, true, view);
    const torWaist = jointPx(tor, 'waist'), torNeck = jointPx(tor, 'neck');
    const lap = (OVERLAP * U);
    const torRoot = [root[0] - sw.t[0] * lap, root[1] - sw.t[1] * lap]; // sunk into the pelvis so no gap shows at the waist
    const fTor = makeFrame(tor, torWaist, torNeck, torRoot, sw.t, sw.f, sTor, partWidth(rig, 'torso'));
    put('torso', tor, fTor);
    joints.neck = fTor.map(torNeck);
    const shoulderW = { l: fTor.map(jointPx(tor, 'shoulder_l')), r: fTor.map(jointPx(tor, 'shoulder_r')) };
    joints.shoulder_l = shoulderW.l; joints.shoulder_r = shoulderW.r;

    // head: up from the neck, turned by the waist and neck angles
    const hd = need('head');
    const sHd = partScale(rig, 'head', U, hd);
    const Rn = mul(Rw, localUp(pose, 'neck'));
    const sn = seg(Rn, true, view);
    const hdNeck = jointPx(hd, 'neck');
    put('head', hd, makeFrame(hd, hdNeck, [hdNeck[0], 0], [joints.neck[0] + sn.t[0] * 0, joints.neck[1] + 0], sn.t, sn.f, sHd, partWidth(rig, 'head')));

    // a hanging chain: parts[] = [{ part, local joint rotation, kneeLike }], first starts at P with rotation R0
    function chain(side, names, P, R0, defs) {
      let R = R0, at = P, rot = null;
      defs.forEach((d) => {
        const part = d.base + '_' + side;
        const pic = need(part);
        const s = partScale(rig, part, U, pic);
        R = mul(R, localDown(pose, d.joint + '_' + side, d.knee));
        const [ja, jb] = RS.partJoints(part);
        const A = jointPx(pic, ja);
        // segment end: the next joint when there is one, else straight down the picture
        const B = jb ? jointPx(pic, jb) : [A[0], pic.h];
        const sg = seg(R, false, view);
        const fr = makeFrame(pic, A, B, at, sg.t, sg.f, s, partWidth(rig, part));
        put(part, pic, fr);
        if (jb) joints[jb] = fr.map(B);
        rot = R;
        at = fr.map(B);
      });
      return rot;
    }
    for (const side of ['l', 'r']) {
      chain(side, null, shoulderW[side], Rw, [{ base: 'upper_arm', joint: 'shoulder' }, { base: 'forearm', joint: 'elbow' }, { base: 'hand', joint: 'wrist' }]);
      chain(side, null, hipW[side], I3(), [{ base: 'thigh', joint: 'hip' }, { base: 'calf', joint: 'knee', knee: true }, { base: 'foot', joint: 'ankle' }]);
    }

    const order = (rig.draw_order && rig.draw_order[view]) || RS.drawOrder(view);
    const list = order.map((p) => items[p]).filter(Boolean);
    // bounds of every drawn rectangle
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const corners = (it) => [[0, 0], [it.w, 0], [0, it.h], [it.w, it.h]].map(([x, y]) => [it.matrix[0] * x + it.matrix[2] * y + it.matrix[4], it.matrix[1] * x + it.matrix[3] * y + it.matrix[5]]);
    for (const it of list) for (const [x, y] of corners(it)) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    // the lowest point of each foot picture (for planting the feet on the ground)
    const sole = {};
    for (const side of ['l', 'r']) { const it = items['foot_' + side]; if (it) sole[side] = Math.max(...corners(it).map((c) => c[1])); }
    return { version: POSE_VERSION, view, items: list, joints, bounds: { minX, minY, maxX, maxY }, sole };
  }

  // how far the waist is above the ground when standing at rest, in pixels (so a character can be put on a ground line)
  function restHeight(rig, view, unit) {
    const r = solve(rig, { view, x: 0, y: 0, unit });
    return Math.max(r.sole.l || 0, r.sole.r || 0);
  }

  // put the lower foot on the ground line: returns the pose with y set
  function plant(rig, pose, groundY) {
    const r = solve(rig, Object.assign({}, pose, { y: 0 }));
    const low = Math.max(r.sole.l || -Infinity, r.sole.r || -Infinity);
    return Object.assign({}, pose, { y: groundY - low });
  }


  // ---------- box layout ----------
  // The body is one box. rig.layout[view] = { w, h, slots: { part: { x, y, w, h } } } in the box's own units (the reference picture's pixels).
  // Every part picture is fitted into its slot, so no part can sit outside the box and nothing is chained from the end of another picture.
  // Parts without a slot of their own (the far arm and leg in a side view) use the slot of the opposite side and are drawn behind.
  // pose: { view, x, y, unit }  unit = pixels tall the whole box is drawn; x, y = top-centre of the box on screen.
  function boxSolve(rig, pose) {
    const view = pose.view || 'front';
    const L = rig.layout && rig.layout[view];
    if (!L) throw new Error(`the rig has no box layout for ${view}`);
    const k = (pose.unit || 100) / L.h;
    const ox = (+pose.x || 0) - (L.w * k) / 2, oy = +pose.y || 0;
    const items = {};
    for (const part of RS.PARTS) {
      const pic = pictureFor(rig, part, view);
      if (!pic) continue;
      const o = RS.oppositeOf ? RS.oppositeOf(part) : part.replace(/_l$/, '_x').replace(/_r$/, '_l').replace(/_x$/, '_r');
      const slot = L.slots[part] || L.slots[o];
      if (!slot) continue;
      const sx = (slot.w * k) / pic.w, sy = (slot.h * k) / pic.h;
      const ex = ox + slot.x * k, ey = oy + slot.y * k;
      items[part] = { part, asset: pic.asset, w: pic.w, h: pic.h, far: pic.far || !L.slots[part], flip: pic.flip, from: pic.src.part + '__' + pic.src.view,
        matrix: pic.flip ? [-sx, 0, 0, sy, ex + slot.w * k, ey] : [sx, 0, 0, sy, ex, ey] };
    }
    const order = (rig.draw_order && rig.draw_order[view]) || RS.drawOrder(view);
    const list = order.map((q) => items[q]).filter(Boolean);
    return { version: POSE_VERSION, view, items: list, joints: {}, bounds: { minX: ox, minY: oy, maxX: ox + L.w * k, maxY: oy + L.h * k }, sole: {} };
  }

  // ---------- drawing ----------
  const r2 = (n) => Math.round(n * 100) / 100;
  // href(assetName) -> the URL or data: URI of that part's SVG. far parts are drawn a little darker.
  function toSvg(solved, opts) {
    const o = opts || {};
    const href = o.href || ((name) => name + '.svg');
    const pad = o.pad == null ? 20 : o.pad;
    const b = o.viewBox || [solved.bounds.minX - pad, solved.bounds.minY - pad, solved.bounds.maxX - solved.bounds.minX + 2 * pad, solved.bounds.maxY - solved.bounds.minY + 2 * pad];
    const parts = solved.items.map((it) => {
      const m = it.matrix.map(r2).join(' ');
      return `<g transform="matrix(${m})"${it.far ? ' filter="url(#nf-far)"' : ''}><image href="${href(it.asset)}" width="${it.w}" height="${it.h}" preserveAspectRatio="none"/></g>`;
    }).join('');
    const defs = '<defs><filter id="nf-far" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.8 0 0 0 0  0 0.8 0 0 0  0 0 0.8 0 0  0 0 0 1 0"/></filter></defs>';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.map(r2).join(' ')}" width="${o.width || r2(b[2])}" height="${o.height || r2(b[3])}">${defs}${o.background ? `<rect x="${r2(b[0])}" y="${r2(b[1])}" width="${r2(b[2])}" height="${r2(b[3])}" fill="${o.background}"/>` : ''}${parts}</svg>`;
  }

  // ---------- clips ----------
  // { format, name, fps, duration, loop, keys: [{ t, angles: { joint: { fb, side } } }] }, t in seconds, one cycle for a loop.
  function sampleAngles(clip, time) {
    const keys = clip.keys;
    if (!keys || !keys.length) return {};
    const d = clip.duration;
    let t = clip.loop ? ((time % d) + d) % d : Math.max(0, Math.min(d, time));
    const n = keys.length;
    let i = 0;
    while (i < n - 1 && keys[i + 1].t <= t) i++;
    let k0 = keys[i], k1 = keys[Math.min(n - 1, i + 1)];
    let span = k1.t - k0.t;
    if (clip.loop && i === n - 1) { k1 = keys[0]; span = d - k0.t + k1.t; }
    const u = span > 0 ? (t - k0.t) / span : 0;
    const at = (j) => (clip.loop ? keys[((j % n) + n) % n] : keys[Math.max(0, Math.min(n - 1, j))]);
    const km = at(i - 1), kp = at(i + 2);
    const names = new Set();
    [km, k0, k1, kp].forEach((k) => Object.keys(k.angles || {}).forEach((j) => names.add(j)));
    const cr = (p0, p1, p2, p3, x) => 0.5 * ((2 * p1) + (-p0 + p2) * x + (2 * p0 - 5 * p1 + 4 * p2 - p3) * x * x + (-p0 + 3 * p1 - 3 * p2 + p3) * x * x * x); // Catmull-Rom
    const g = (k, j, ax) => ((k.angles && k.angles[j] && k.angles[j][ax]) || 0);
    const out = {};
    for (const j of names) out[j] = { fb: cr(g(km, j, 'fb'), g(k0, j, 'fb'), g(k1, j, 'fb'), g(kp, j, 'fb'), u), side: cr(g(km, j, 'side'), g(k0, j, 'side'), g(k1, j, 'side'), g(kp, j, 'side'), u) };
    return out;
  }
  // a pose from a clip at a time, on the ground line, travelling at the clip's speed (in units per second, along the facing side)
  function poseAt(rig, clip, time, base) {
    const b = base || {};
    const U = b.unit || 100;
    const face = FACING[b.view || 'left_profile'] || 0;
    const pose = Object.assign({}, b, { angles: sampleAngles(clip, time) });
    pose.x = (b.x || 0) + face * (clip.speed || 0) * U * time;
    return b.ground == null ? pose : plant(rig, pose, b.ground);
  }

  // a walk cycle made from sine curves, for a side view. speed is measured from the rig so planted feet do not slide.
  function walkClip(opts) {
    const o = Object.assign({ name: 'walk', duration: 0.9, steps: 16, hip: 28, arm: 22 }, opts || {});
    const keys = [];
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < o.steps; i++) {
      const ph = (2 * Math.PI * i) / o.steps;
      const angles = {};
      for (const [side, p] of [['l', ph], ['r', ph + Math.PI]]) {
        const hip = o.hip * Math.sin(p);
        const knee = 6 + 58 * Math.pow(Math.max(0, Math.cos(p + 0.55)), 1.4); // flexes just after toe-off, so the swinging foot clears the ground
        const stance = sm(-0.35, 0.35, -Math.cos(p));
        const ankle = (knee - hip) * stance - 8 * (1 - stance);
        angles['hip_' + side] = { fb: hip, side: 0 };
        angles['knee_' + side] = { fb: knee, side: 0 };
        angles['ankle_' + side] = { fb: ankle, side: 0 };
        angles['shoulder_' + side] = { fb: -o.arm * Math.sin(p), side: 4 };
        angles['elbow_' + side] = { fb: 24 + 10 * -Math.sin(p), side: 0 };
      }
      angles.waist = { fb: 3, side: 0 };
      keys.push({ t: +((o.duration * i) / o.steps).toFixed(4), angles });
    }
    return { format: CLIP_FORMAT, name: o.name, fps: 30, duration: o.duration, loop: true, speed: o.speed || 0, keys };
  }

  // The stance foot of a walking clip is the one whose hip is swinging backward through the middle of its range: that is when it is flat
  // on the ground and the body passes over it. Returns the frames of one cycle as { side, t } for each foot in that window.
  function stanceFrames(clip, N) {
    const out = [];
    let amp = 0;
    for (const k of clip.keys) for (const sd of ['l', 'r']) amp = Math.max(amp, Math.abs(((k.angles['hip_' + sd] || {}).fb) || 0));
    for (let i = 0; i < N; i++) {
      const t = (clip.duration * i) / N;
      const a0 = sampleAngles(clip, t), a1 = sampleAngles(clip, t + clip.duration / N);
      for (const sd of ['l', 'r']) {
        const h0 = (a0['hip_' + sd] || {}).fb || 0, h1 = (a1['hip_' + sd] || {}).fb || 0;
        if (h1 < h0 && Math.abs(h0) <= 0.5 * amp) out.push({ side: sd, t });
      }
    }
    return out;
  }

  // How fast the body must travel (torso heights per second, along the facing side) for the stance foot to stand still on the ground.
  // Measured from the solved pose: the stance foot moves backward relative to the waist, and the body must move forward that fast.
  function measureSpeed(rig, clip, view, unit) {
    const U = unit || 100;
    const face = FACING[view] || -1;
    const N = Math.max(48, Math.round(clip.duration * 120));
    const dt = clip.duration / N;
    let sum = 0, cnt = 0;
    for (const f of stanceFrames(clip, N)) {
      const x0 = solve(rig, { view, x: 0, y: 0, unit: U, angles: sampleAngles(clip, f.t) }).joints['ankle_' + f.side][0];
      const x1 = solve(rig, { view, x: 0, y: 0, unit: U, angles: sampleAngles(clip, f.t + dt) }).joints['ankle_' + f.side][0];
      sum += (x1 - x0) / dt; cnt++;
    }
    // the foot moves by -face*v relative to the body, so v = face * mean(velocity) ... sign: facing left (-1) and foot moving +x gives v>0
    return cnt ? (-face * (sum / cnt)) / U : 0;
  }

  // How far the stance foot slides on the ground over its stance window, in pixels, when the body travels at the clip's speed.
  function footSlide(rig, clip, view, unit) {
    const U = unit || 100;
    const face = FACING[view] || -1;
    const v = (clip.speed || 0) * U * face;
    const N = Math.max(48, Math.round(clip.duration * 120));
    const frames = stanceFrames(clip, N);
    let worst = 0;
    for (const sd of ['l', 'r']) {
      const mine = frames.filter((f) => f.side === sd).map((f) => f.t);
      if (!mine.length) continue;
      const step = clip.duration / N;
      // the window can wrap past the loop point: measure time from where it starts
      const has = (t) => mine.some((m) => { const d = Math.abs(m - t) % clip.duration; return Math.min(d, clip.duration - d) < step / 2; });
      const start = mine.find((t) => !has(((t - step) % clip.duration + clip.duration) % clip.duration));
      const t0 = start == null ? mine[0] : start;
      const xs = mine.map((t) => { const tt = ((t - t0) % clip.duration + clip.duration) % clip.duration; return solve(rig, { view, x: v * tt, y: 0, unit: U, angles: sampleAngles(clip, t) }).joints['ankle_' + sd][0]; });
      if (xs.length) worst = Math.max(worst, Math.max(...xs) - Math.min(...xs));
    }
    return worst;
  }

  function validateClip(clip) {
    const errors = [];
    if (!clip || clip.format !== CLIP_FORMAT) errors.push(`format must be ${CLIP_FORMAT}`);
    else {
      if (!(clip.duration > 0)) errors.push('duration must be above 0');
      if (!Array.isArray(clip.keys) || !clip.keys.length) errors.push('keys is empty');
      else {
        let last = -1;
        clip.keys.forEach((k, i) => {
          if (!(k.t >= 0 && k.t <= clip.duration)) errors.push(`key ${i}: t is outside the clip`);
          if (k.t <= last) errors.push(`key ${i}: keys must be in time order`);
          last = k.t;
          for (const j of Object.keys(k.angles || {})) {
            if (!RS.JOINTS[j]) { errors.push(`key ${i}: unknown joint ${j}`); continue; }
            const a = k.angles[j];
            for (const ax of ['fb', 'side']) if (a[ax] != null && !Number.isFinite(+a[ax])) errors.push(`key ${i}: ${j}.${ax} is not a number`);
          }
        });
      }
    }
    return { ok: !errors.length, errors };
  }

  return { boxSolve, POSE_VERSION, CLIP_FORMAT, VIEW_YAW, FACING, PROPORTIONS, solve, restHeight, plant, toSvg, sampleAngles, poseAt, walkClip, measureSpeed, footSlide, validateClip };
}));
