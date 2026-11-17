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

// Traced artwork has hairline gaps between its shapes, so the scene shows through the character.
// The backing is a copy of the artwork drawn UNDER it, with every shape stroked in its own colour, which
// closes those gaps with the neighbouring colours. The art on top is unchanged. width 0 turns it off.
const underCache = new Map();
function under(ch, angle, art) {
  const w = ch.backing;
  if (!w) return '';
  const key = `${ch.id}|${angle}|${w}`;
  let u = underCache.get(key);
  if (u === undefined) {
    u = art.svg.replace(/fill="(#[0-9A-Fa-f]{6})"/g, (_, c) => `fill="${c}" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"`);
    underCache.set(key, u);
  }
  return u;
}

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

// Mouth shapes drawn over the art's fixed smile while the character speaks (mouth 0 = the art as drawn).
// A skin patch hides the drawn smile, then one of four shapes is chosen deterministically from time.
const VISEMES = ['A', 'E', 'O', 'M', 'A', 'E'];
function mouthOverlay(face, angle, mouth, t) {
  const spec = face && face.mouth && face.mouth[angle];
  if (!spec || !(mouth > 0.05)) return '';
  const { cx, cy, w } = spec;
  const v = VISEMES[Math.floor(t * 9) % VISEMES.length];
  const o = clamp(mouth, 0, 1);
  const ink = '#3A1E1B', lip = '#8C4A3C';
  const patch = `<ellipse cx="${cx}" cy="${cy}" rx="${r1(w * 0.72)}" ry="${r1(w * 0.34)}" fill="${face.skin}"/>`;
  let shape;
  if (v === 'M') shape = `<path d="M${r1(cx - w * 0.28)} ${cy} Q${cx} ${r1(cy + 3)} ${r1(cx + w * 0.28)} ${cy}" fill="none" stroke="${lip}" stroke-width="3.2" stroke-linecap="round"/>`;
  else if (v === 'E') shape = `<ellipse cx="${cx}" cy="${cy}" rx="${r1(w * 0.3)}" ry="${r1(2 + 4 * o)}" fill="${ink}" stroke="${lip}" stroke-width="2.4"/>`;
  else if (v === 'O') shape = `<ellipse cx="${cx}" cy="${r1(cy + 1)}" rx="${r1(w * 0.13 + 2 * o)}" ry="${r1(4 + 7 * o)}" fill="${ink}" stroke="${lip}" stroke-width="2.4"/>`;
  else shape = `<path d="M${r1(cx - w * 0.24)} ${cy - 2} Q${cx} ${r1(cy - 3)} ${r1(cx + w * 0.24)} ${cy - 2} Q${cx} ${r1(cy + 5 + 12 * o)} ${r1(cx - w * 0.24)} ${cy - 2}Z" fill="${ink}" stroke="${lip}" stroke-width="2.4" stroke-linejoin="round"/>`;
  return patch + shape;
}

// Whole-pose drawings (ch.variants[pose]) are picked by angle like the rigged art, or 'any' when a pose has one drawing.
function pickVariant(ch, pose, facing, override) {
  const set = ch.variants && ch.variants[pose];
  if (!set) return null;
  if (override && set[override]) return { key: override, art: set[override] };
  if (set.any) return { key: 'any', art: set.any };
  const key = CH.resolveAngle(ch, pose, facing);
  const use = set[key] ? key : set.front ? 'front' : Object.keys(set)[0];
  return { key: use, art: set[use] };
}

// a = { id, x, y, facing 1|-1, pose, expr, mouth 0..1, walk (phase), scale, t, alpha, look, angle? }
// baseH = standing height for the current art style (story_art.heightOf)
// Pose-to-pose change: a.prev_pose + a.blend (0..1). The old drawing stays fully opaque underneath and the new one
// fades in over it with a small hop, so the figure never goes see-through in between. blend >= 1 or no prev_pose = plain draw.
function assetPerson(a, ch, baseH) {
  const b = a.blend == null ? 1 : clamp(a.blend, 0, 1);
  if (a.prev_pose && b < 1) {
    const prev = CH.resolvePose(ch, a.prev_pose);
    const now = CH.resolvePose(ch, a.pose);
    if (prev !== now) {
      const e = b * b * (3 - 2 * b); // smoothstep
      const hop = Math.sin(Math.PI * b) * 10;
      const base = { ...a, prev_pose: null, blend: 1, y: a.y - hop };
      const alpha = a.alpha == null ? 1 : a.alpha;
      return drawOne({ ...base, pose: prev, mouth: 0 }, ch, baseH) + drawOne({ ...base, alpha: alpha * e }, ch, baseH);
    }
  }
  return drawOne(a, ch, baseH);
}

function drawOne(a, ch, baseH) {
  const facing = a.facing < 0 ? -1 : 1;
  const pose = CH.resolvePose(ch, a.pose);
  CH.resolveExpression(ch, a.expr);
  const variant = pickVariant(ch, pose, facing, a.angle);
  const angle = variant ? variant.key : CH.resolveAngle(ch, pose, facing, a.angle);
  const art = variant ? variant.art : ch.angles[angle];
  const t = a.t || 0;
  const m = motion(pose, t, a.walk || 0, a.mouth || 0, facing);

  const age = a.look && a.look.age;
  const sc = (a.scale || 1) * (age === 'child' ? 0.68 : age === 'elder' ? 0.95 : 1);
  const k = (baseH * sc) / (art.stand_h || art.bbox.y1 - art.bbox.y0);
  // a drawing that faces the wrong way is mirrored around its feet anchor
  const flip = art.faces !== 0 && art.faces !== facing && variant ? -1 : 1;

  // head tilt only where the rig was verified for this angle
  const ht = ch.rig.head_tilt;
  const slots = {};
  if (!variant && m.tilt && ht.max_deg && ht.angles.includes(angle)) {
    const deg = clamp(m.tilt, -ht.max_deg, ht.max_deg);
    const [px, py] = art.pivots.head;
    slots.head = `transform="rotate(${r1(deg)} ${px} ${py})"`;
  }
  // overlay follows the head tilt so it stays on the face
  const face = variant ? '' : mouthOverlay(ch.face, angle, a.mouth || 0, t);
  const faceG = face ? (slots.head ? `<g ${slots.head}>${face}</g>` : `<g>${face}</g>`) : '';
  // head-and-shoulders drawings (stand_h well above their own height) hang from the head-top line of a standing figure
  // and fade out at the bottom, so they read as a close-up instead of a torso cut off at the ground
  const hArt = art.bbox.y1 - art.bbox.y0;
  const bust = !!(variant && art.stand_h && art.stand_h > hArt * 1.05);
  const lift = bust ? (art.stand_h - hArt) * k : 0;
  const fadeId = `fade-${ch.id}-${pose}`;
  const fill = (src) => src.replace(/\{\{([\w-]+)\}\}/g, (_, key) => slots[key] || '');
  const fadeDef = bust ? `<defs><linearGradient id="${fadeId}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.72" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="${fadeId}" maskUnits="userSpaceOnUse" x="${art.bbox.x0 - 20}" y="${art.bbox.y0 - 20}" width="${art.bbox.x1 - art.bbox.x0 + 40}" height="${hArt + 40}"><rect x="${art.bbox.x0 - 20}" y="${art.bbox.y0 - 20}" width="${art.bbox.x1 - art.bbox.x0 + 40}" height="${hArt + 20}" fill="url(#${fadeId}-g)"/></mask></defs>` : '';
  const markup = variant ? (bust ? `${fadeDef}<g mask="url(#${fadeId})">${art.svg}</g>` : art.svg) : fill(under(ch, angle, art)) + fill(art.svg) + faceG;

  const shadow = `<ellipse cx="0" cy="6" rx="${r1(70 * sc)}" ry="${r1(13 * sc)}" fill="#000" opacity=".16"/>`;
  const body =
    `translate(0 ${r1(m.bob - m.jump - lift)}) rotate(${r1(m.lean + m.sway)}) scale(1 ${Math.round(m.sy * 1000) / 1000}) ` +
    `scale(${flip * Math.round(k * 10000) / 10000} ${Math.round(k * 10000) / 10000}) translate(${-art.anchor} ${-art.bbox.y1})`;
  return (
    `<g opacity="${a.alpha == null ? 1 : a.alpha}">` +
    `<g transform="translate(${r1(a.x)} ${r1(a.y)})">${bust ? '' : shadow}<g transform="${body}">${markup}</g></g></g>`
  );
}

module.exports = { assetPerson, motion };
