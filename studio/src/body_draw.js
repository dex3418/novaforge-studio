'use strict';
// The Ghibli chibi body drawn from code: no pictures, no traced assets.
// The body is a handful of simple 3D shapes (ellipsoids and tapered capsules) laid out inside one box. Each view is the same body seen
// from another side (orthographic camera), so the 8 views always agree with each other, and a pose is just joint angles.
//
//   draw({ view, angles, x, y, unit })  ->  SVG string
//   shapes({ view, angles })            ->  the projected shapes in drawing order (for tests and for other renderers)
//
// Units: the body box is 630 tall (the reference picture's figure height). Y is up from the ground, X is the character's left, Z is forward.
// Angles are the same as the pose solver: degrees, 0 = hanging straight down, fb forward positive, side away from the body positive,
// knee and elbow bend with positive fb.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BodyDraw = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const rad = (d) => (d * Math.PI) / 180;
  const VIEW_YAW = { front: 0, front_left_45: 45, left_profile: 90, back_left_45: 135, back: 180, back_right_45: 225, right_profile: 270, front_right_45: 315 };
  const COLORS = { skin: '#FEB98B', shade: '#D98E66', outline: '#5C3520' };
  const BOX = { w: 340, h: 630 };

  // ---- the body's measurements, taken from the reference picture (all in box units) ----
  const M = {
    head: { c: [0, 484, -16], r: [130, 147, 134] },
    jaw: { c: [0, 432, -10], r: [122, 92, 100] },
    ear: { c: [122, 418, -6], r: [12, 26, 18] },
    trunk: { zoff: -6, top: 256, bottom: 200, rTop: 70, rBottom: 82, depth: 0.85 },   // ONE body piece, neck base to crotch
    neck: { r: 34, depth: 1.1 },
    shoulder: [46, 304, 6], elbowLen: 82, wristLen: 80,
    arm: { r0: 33, r1: 24, r2: 15 },
    hand: { len: 34, r0: 15, r1: 9 },
    hip: [46, 118, 0], thighLen: 48, calfLen: 48,
    leg: { r0: 34, r1: 30, r2: 25 },
    foot: { r: [30, 11, 38], fwd: 9 },
  };

  // ---- small 3D helpers ----
  const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  const app = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const rotFb = (a) => { const c = Math.cos(rad(a)), s = Math.sin(rad(a)); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
  const rotSide = (a) => { const c = Math.cos(rad(a)), s = Math.sin(rad(a)); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const ang = (angles, j) => { const a = (angles && angles[j]) || {}; return { fb: +a.fb || 0, side: +a.side || 0 }; };
  // rotation of a hanging joint: side flips for the right limbs, knee bends backward
  const hang = (angles, j, knee) => { const a = ang(angles, j); const s = /_r$/.test(j) ? -1 : 1; return mul(rotSide(s * a.side), rotFb(knee ? -a.fb : a.fb)); };
  const upright = (angles, j) => { const a = ang(angles, j); return mul(rotSide(-a.side), rotFb(-a.fb)); };

  // rest pose: arms hang a little out, as in the reference
  const REST = { shoulder_l: { side: 37, fb: -9 }, shoulder_r: { side: 37, fb: -9 }, elbow_l: { fb: 6 }, elbow_r: { fb: 6 }, hip_l: { side: 4.5 }, hip_r: { side: 4.5 } };
  function withRest(angles) {
    const out = {};
    for (const j of new Set(Object.keys(REST).concat(Object.keys(angles || {})))) {
      const a = REST[j] || {}, b = (angles && angles[j]) || {};
      out[j] = { fb: (a.fb || 0) + (+b.fb || 0), side: (a.side || 0) + (+b.side || 0) };
    }
    return out;
  }

  // the body in 3D: a list of primitives { kind:'ellipsoid'|'capsule', ... } with a layer for tie-breaking
  const Rn0 = (R) => R;
  function body(angles0) {
    const A = withRest(angles0);
    const P = [];
    const Rw = upright(A, 'waist');                      // torso lean
    const Rn = mul(Rw, upright(A, 'neck'));
    const at = (R, o, v) => add(o, app(R, v));
    const waist = [0, M.trunk.bottom, M.trunk.zoff || 0];
    const T = M.trunk;
    // the whole trunk (chest, belly, pelvis) is one tapered piece
    P.push({ kind: 'capsule', name: 'trunk', group: 'core', a: add(waist, app(Rw, [0, T.top - T.bottom, 0])), b: waist, ra: T.rTop, rb: T.rBottom, zr: T.depth, layer: 4 });
    const neckTop = add(waist, app(Rw, [0, 132, 0]));
    P.push({ kind: 'capsule', name: 'neck', group: 'core', a: add(waist, app(Rw, [0, 118, 0])), b: add(neckTop, app(Rn, [0, 10, 0])), ra: M.neck.r, rb: M.neck.r, zr: M.neck.depth, layer: 3 });
    const headC = add(neckTop, app(Rn, [0, M.head.c[1] - neckTop[1], 0]));
    P.push({ kind: 'ellipsoid', name: 'head', group: 'head', c: headC, r: M.head.r, R: Rn, layer: 8 });
    // the cheeks and jaw: the head is egg-shaped, wider at the cheeks than a plain oval (same group, so no seam)
    P.push({ kind: 'ellipsoid', name: 'jaw', group: 'head', c: add(headC, app(Rn, [0, M.jaw.c[1] - M.head.c[1], M.jaw.c[2]])), r: M.jaw.r, R: Rn, layer: 8 });
    for (const sg of [1, -1]) P.push({ kind: 'ellipsoid', name: 'ear', group: 'ear' + sg, c: add(headC, app(Rn, [sg * M.ear.c[0], M.ear.c[1] - M.head.c[1], M.ear.c[2]])), r: M.ear.r, R: Rn, layer: 7 });
    for (const [side, sg] of [['l', 1], ['r', -1]]) {
      // arm
      const sh = add(waist, app(Rw, [sg * M.shoulder[0], M.shoulder[1] - waist[1], M.shoulder[2]]));
      const R1 = mul(Rw, hang(A, 'shoulder_' + side));
      const el = add(sh, app(R1, [0, -M.elbowLen, 0]));
      const R2 = mul(R1, hang(A, 'elbow_' + side));
      const wr = add(el, app(R2, [0, -M.wristLen, 0]));
      const R3 = mul(R2, hang(A, 'wrist_' + side));
      const tip = add(wr, app(R3, [0, -M.hand.len, 0]));
      P.push({ kind: 'capsule', name: 'upper_arm_' + side, group: 'arm' + side, a: sh, b: el, ra: M.arm.r0, rb: M.arm.r1, layer: 3 });
      P.push({ kind: 'capsule', name: 'forearm_' + side, group: 'arm' + side, a: el, b: wr, ra: M.arm.r1, rb: M.arm.r2, layer: 3 });
      P.push({ kind: 'capsule', name: 'hand_' + side, group: 'arm' + side, a: wr, b: tip, ra: M.hand.r0, rb: M.hand.r1, layer: 3 });
      // leg
      const hp = [sg * M.hip[0], M.hip[1], M.hip[2]];
      const L1 = hang(A, 'hip_' + side);
      const kn = add(hp, app(L1, [0, -M.thighLen, 0]));
      const L2 = mul(L1, hang(A, 'knee_' + side, true));
      const an = add(kn, app(L2, [0, -M.calfLen, 0]));
      const L3 = mul(L2, hang(A, 'ankle_' + side));
      const ft = add(an, app(L3, [0, -M.foot.r[1] * 0.4, M.foot.fwd]));
      P.push({ kind: 'capsule', name: 'thigh_' + side, group: 'leg' + side, a: hp, b: kn, ra: M.leg.r0, rb: M.leg.r1, layer: 1 });
      P.push({ kind: 'capsule', name: 'calf_' + side, group: 'leg' + side, a: kn, b: an, ra: M.leg.r1, rb: M.leg.r2, layer: 1 });
      P.push({ kind: 'ellipsoid', name: 'foot_' + side, group: 'leg' + side, c: ft, r: M.foot.r, R: L3, layer: 1 });
    }
    // whole-body lift: angles.root.y moves everything up (a jump) or down (sitting)
    const ry = (angles0 && angles0.root && +angles0.root.y) || 0;
    if (ry) for (const p of P) for (const k of ['a', 'b', 'c']) if (p[k]) p[k] = [p[k][0], p[k][1] + ry, p[k][2]];
    return P;
  }

  // ---- the camera ----
  function camera(view) {
    const p = rad(VIEW_YAW[view]);
    return { sx: [Math.cos(p), 0, -Math.sin(p)], sy: [0, -1, 0], dp: [Math.sin(p), 0, Math.cos(p)], yaw: p };
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // project one primitive to a screen shape
  function project(p, cam) {
    if (p.kind === 'ellipsoid') {
      // A = Rows(cam) * R * diag(r); the silhouette is the ellipse with covariance A A^T
      const cols = [0, 1, 2].map((j) => app(p.R, [j === 0 ? p.r[0] : 0, j === 1 ? p.r[1] : 0, j === 2 ? p.r[2] : 0]));
      const a = (row) => cols.map((c) => dot(row, c));
      const rx = a(cam.sx), ry = a(cam.sy);
      const sxx = dot(rx, rx), syy = dot(ry, ry), sxy = dot(rx, ry);
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(0.01, tr / 2 - disc);
      const th = Math.abs(sxy) < 1e-9 && sxx >= syy ? 0 : Math.atan2(l1 - sxx, sxy) ;
      const ang = Math.abs(sxy) < 1e-9 ? (sxx >= syy ? 0 : Math.PI / 2) : th;
      return { kind: 'ellipse', name: p.name, group: p.group, cx: dot(cam.sx, p.c), cy: dot(cam.sy, p.c), rx: Math.sqrt(l1), ry: Math.sqrt(l2), rot: (ang * 180) / Math.PI, depth: dot(cam.dp, p.c), layer: p.layer };
    }
    const ax = dot(cam.sx, p.a), ay = dot(cam.sy, p.a), bx = dot(cam.sx, p.b), by = dot(cam.sy, p.b);
    const kz = p.zr ? Math.hypot(Math.cos(cam.yaw), p.zr * Math.sin(cam.yaw)) : 1; // a body piece that is flatter front-to-back
    return { kind: 'capsule', name: p.name, group: p.group, ax, ay, bx, by, ra: p.ra * kz, rb: p.rb * kz, depth: (dot(cam.dp, p.a) + dot(cam.dp, p.b)) / 2, layer: p.layer };
  }

  // shapes in drawing order: far to near; a body part that belongs on top of its neighbour at equal depth uses its layer
  function shapes(o) {
    const view = (o && o.view) || 'front';
    const cam = camera(view);
    const list = body(o && o.angles).map((p) => project(p, cam));
    list.sort((a, b) => (Math.abs(a.depth - b.depth) < 30 ? a.layer - b.layer : a.depth - b.depth));
    return list;
  }

  const f = (n) => Math.round(n * 100) / 100;
  function capsulePath(s) {
    const dx = s.bx - s.ax, dy = s.by - s.ay, L = Math.hypot(dx, dy) || 1e-6;
    const nx = -dy / L, ny = dx / L;
    const k = (s.ra - s.rb) / L, cs = Math.sqrt(Math.max(0, 1 - k * k));
    // tangent points of the two circles
    const ta = (sg) => [s.ax + sg * s.ra * (nx * cs) - 0, s.ay + sg * s.ra * ny * cs];
    const tb = (sg) => [s.bx + sg * s.rb * nx * cs, s.by + sg * s.rb * ny * cs];
    return `M${f(ta(1)[0])} ${f(ta(1)[1])} L${f(tb(1)[0])} ${f(tb(1)[1])} A${s.rb} ${s.rb} 0 0 ${dy >= 0 || true ? 0 : 1} ${f(tb(-1)[0])} ${f(tb(-1)[1])} L${f(ta(-1)[0])} ${f(ta(-1)[1])} A${s.ra} ${s.ra} 0 0 0 ${f(ta(1)[0])} ${f(ta(1)[1])}Z`;
  }

  // A limb is drawn as ONE unit so it has no seams: first every outline, then every shade, then every lit skin.
  const outlineOf = (s) => {
    const C = COLORS;
    if (s.kind === 'ellipse') return `<ellipse transform="translate(${f(s.cx)} ${f(s.cy)}) rotate(${f(s.rot)})" rx="${f(s.rx)}" ry="${f(s.ry)}" fill="${C.outline}" stroke="${C.outline}" stroke-width="7.2"/>`;
    return `<path d="${capsulePath(s)}" fill="${C.outline}" stroke="${C.outline}" stroke-width="7.2" stroke-linejoin="round"/>`;
  };
  const shadeOf = (s) => {
    if (s.kind === 'ellipse') return `<ellipse transform="translate(${f(s.cx)} ${f(s.cy)}) rotate(${f(s.rot)})" rx="${f(s.rx)}" ry="${f(s.ry)}" fill="${COLORS.shade}"/>`;
    return `<path d="${capsulePath(s)}" fill="${COLORS.shade}"/>`;
  };
  const litOf = (s, id) => {
    const C = COLORS;
    if (s.kind === 'ellipse') {
      // the lit skin is the same ellipse, a little smaller and moved up and to the left ON THE SCREEN; inside the rotated group that move is turned back
      const m = 0.1 * Math.max(s.rx, s.ry), sx = -m, sy = -m * 0.75, r = (s.rot * Math.PI) / 180;
      const lx = Math.cos(r) * sx + Math.sin(r) * sy, ly = -Math.sin(r) * sx + Math.cos(r) * sy;
      return `<g transform="translate(${f(s.cx)} ${f(s.cy)}) rotate(${f(s.rot)})"><clipPath id="c${id}"><ellipse rx="${f(s.rx)}" ry="${f(s.ry)}"/></clipPath><ellipse rx="${f(s.rx * 0.97)}" ry="${f(s.ry * 0.97)}" cx="${f(lx)}" cy="${f(ly)}" fill="${C.skin}" clip-path="url(#c${id})"/></g>`;
    }
    const d = capsulePath(s);
    const dx = Math.min(s.ra, s.rb) * 0.35;
    return `<clipPath id="c${id}"><path d="${d}"/></clipPath><g clip-path="url(#c${id})"><path d="${d}" fill="${C.skin}" transform="translate(${f(-dx)} ${f(-dx * 0.5)})"/></g>`;
  };
  function groupsOf(list) {
    const map = new Map();
    list.forEach((s) => { const k = s.group || s.name; if (!map.has(k)) map.set(k, []); map.get(k).push(s); });
    const gs = [...map.entries()].map(([name, items]) => ({ name, items, depth: items.reduce((t, s) => t + s.depth, 0) / items.length, layer: Math.max(...items.map((s) => s.layer)) }));
    gs.sort((a, b) => (Math.abs(a.depth - b.depth) < 30 ? a.layer - b.layer : a.depth - b.depth));
    return gs;
  }

  // x, y: where the top-centre of the box goes on screen; unit: the box's drawn height in pixels (default 630)
  let drawCount = 0;
  function draw(o) {
    const opt = o || {};
    const k = (opt.unit || BOX.h) / BOX.h;
    const list = shapes(opt);
    const uid = (opt.idPrefix || 'bd') + (++drawCount); // clip ids must be unique when several bodies share one page
    let n = 0;
    const body = groupsOf(list).map((g) => g.items.map(outlineOf).join('') + g.items.map(shadeOf).join('') + g.items.map((s) => litOf(s, uid + '_' + (n++))).join('')).join('');
    const pad = 20;
    const vb = opt.viewBox || [-BOX.w / 2 - pad, -BOX.h - pad, BOX.w + 2 * pad, BOX.h + 2 * pad];
    // body y runs up from the ground; the shapes already use screen y (down = -Y), so ground is y = 0
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f).join(' ')}" width="${f(vb[2] * k)}" height="${f(vb[3] * k)}">${opt.background ? `<rect x="${f(vb[0])}" y="${f(vb[1])}" width="${f(vb[2])}" height="${f(vb[3])}" fill="${opt.background}"/>` : ''}${body}</svg>`;
  }

  return { COLORS, BOX, VIEW_YAW, M, REST, shapes, draw, body };
}));
