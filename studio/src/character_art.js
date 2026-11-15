'use strict';
// Draws a registry character (real artwork) in the same contract as story_art.person():
// feet at (0,0) of the placement, drawn at the art style's standard height.
//
// The artwork is never recoloured or redrawn. Life comes only from whole-body motion
// (bob, lean, sway, hop) and, where the rig allows it, a small head tilt around the neck pivot.

const CH = require('./characters');

const r1 = (n) => Math.round(n * 10) / 10;
const sin = Math.sin;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// motion for one pose at time t (seconds). walk is the walk-cycle phase, mouth is 0..1 while speaking.
function motion(pose, t, walk, mouth, facing) {
  const m = { bob: sin(t * 1.9) * 2, lean: 0, sway: sin(t * 0.9) * 0.5, jump: 0, sy: 1, tilt: 0 };
  switch (pose) {
    case 'walk': {
      const s = sin(walk);
      m.bob = -Math.abs(s) * 9;
      m.lean = 3 * facing;
      m.sway = s * 1.2;
      break;
    }
    case 'talk':
      m.sy = 1 + 0.012 * mouth;
      m.tilt = sin(t * 2.2) * 3;
      m.bob -= mouth * 1.5;
      break;
    case 'listen':
      m.tilt = -3 + sin(t * 1.3);
      break;
    case 'think':
      m.tilt = -5;
      m.sway = sin(t * 0.7) * 0.8;
      break;
    case 'celebrate': {
      m.jump = Math.abs(sin(t * 5)) * 22;
      m.bob = 0;
      m.sway = sin(t * 8) * 1.5;
      break;
    }
    case 'worried':
      m.sway = sin(t * 7) * 0.9;
      m.lean = -2 * facing;
      m.bob = sin(t * 7) * 1.2;
      break;
    default:
  }
  return m;
}

// a = { id, x, y, facing 1|-1, pose, expr, mouth 0..1, walk (phase), scale, t, alpha, look, angle? }
// baseH = standing height for the current art style (story_art.heightOf)
function assetPerson(a, ch, baseH) {
  const facing = a.facing < 0 ? -1 : 1;
  const pose = CH.resolvePose(ch, a.pose);
  CH.resolveExpression(ch, a.expr);
  const angle = CH.resolveAngle(ch, pose, facing, a.angle);
  const art = ch.angles[angle];
  const t = a.t || 0;
  const m = motion(pose, t, a.walk || 0, a.mouth || 0, facing);

  const age = a.look && a.look.age;
  const sc = (a.scale || 1) * (age === 'child' ? 0.68 : age === 'elder' ? 0.95 : 1);
  const k = (baseH * sc) / (art.bbox.y1 - art.bbox.y0);

  // head tilt only where the rig was verified for this angle
  const ht = ch.rig.head_tilt;
  const slots = {};
  if (m.tilt && ht.max_deg && ht.angles.includes(angle)) {
    const deg = clamp(m.tilt, -ht.max_deg, ht.max_deg);
    const [px, py] = art.pivots.head;
    slots.head = `transform="rotate(${r1(deg)} ${px} ${py})"`;
  }
  const markup = art.svg.replace(/\{\{([\w-]+)\}\}/g, (_, key) => slots[key] || '');

  const shadow = `<ellipse cx="0" cy="6" rx="${r1(70 * sc)}" ry="${r1(13 * sc)}" fill="#000" opacity=".16"/>`;
  const body =
    `translate(0 ${r1(m.bob - m.jump)}) rotate(${r1(m.lean + m.sway)}) scale(1 ${Math.round(m.sy * 1000) / 1000}) ` +
    `scale(${Math.round(k * 10000) / 10000}) translate(${-art.anchor} ${-art.bbox.y1})`;
  return (
    `<g opacity="${a.alpha == null ? 1 : a.alpha}">` +
    `<g transform="translate(${r1(a.x)} ${r1(a.y)})">${shadow}<g transform="${body}">${markup}</g></g></g>`
  );
}

module.exports = { assetPerson, motion };
