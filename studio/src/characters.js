'use strict';
// Character registry: the authority on which characters have real artwork and what each can do.
// Pure and bundle-safe (no file access): the data is baked by tools/build_characters.js.
//
// Rule from the project brief: never silently invent an asset. Anything asked for that a character
// does not have is replaced by a declared fallback AND recorded in warnings (once per kind of miss).

const DATA = require('./characters_data');

const seen = new Set();
const warnings = [];
function warn(key, msg) {
  if (seen.has(key)) return;
  seen.add(key);
  warnings.push(msg);
  if (typeof console !== 'undefined' && console.warn) console.warn(`[characters] ${msg}`);
}

// Safety switch: the video renderer turns it off for the rest of a frame's life if drawing a registry character
// ever throws, so a bad asset can never blank the video (the procedural figure is drawn instead).
let enabled = true;
const setEnabled = (v) => { enabled = !!v; };
// ---- derived characters: same body, same face drawing, different colours --------------------------------------
// "extends": "naina" + "recolor" rules in character.json. A rule moves every colour of one family (by hue) to a new
// hue and can lighten/darken it; the artwork itself is the base character's, never redrawn. Built lazily and cached.
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, sat, l];
}
function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
function recolorHex(hex, rules) {
  const [h, s, l] = hexToHsl(hex);
  for (const r of rules) {
    const [a, b] = r.from_hue;
    if (s >= (r.min_sat == null ? 0.2 : r.min_sat) && h >= a && h <= b) {
      const mid = (a + b) / 2;
      const nh = (r.to_hue + (h - mid) * (r.keep_spread == null ? 0.5 : r.keep_spread) + 360) % 360;
      return hslToHex(nh, Math.max(0, Math.min(1, s * (r.sat_mult || 1))), Math.max(0, Math.min(1, l * (r.light_mult || 1))));
    }
  }
  return hex;
}
function recolorSvg(svg, rules) {
  return svg.replace(/(fill|stroke)="(#[0-9A-Fa-f]{6})"/g, (_, attr, c) => `${attr}="${recolorHex(c, rules)}"`);
}
const derived = new Map();
function derive(id, spec) {
  const base = DATA[spec.extends];
  if (!base) return null;
  const rules = spec.recolor || [];
  const mapArt = (a) => ({ ...a, svg: recolorSvg(a.svg, rules) });
  const out = {
    ...base,
    id, name: spec.name || id, version: spec.version || 1, extends: spec.extends, recolor: rules,
    angles: Object.fromEntries(Object.entries(base.angles).map(([k, a]) => [k, mapArt(a)])),
    variants: Object.fromEntries(Object.entries(base.variants || {}).map(([p, set]) => [p, Object.fromEntries(Object.entries(set).map(([k, a]) => [k, mapArt(a)]))])),
    face: base.face ? { ...base.face, skin: recolorHex(base.face.skin, rules) } : base.face,
  };
  return out;
}
function lookup(id) {
  if (!id || !Object.prototype.hasOwnProperty.call(DATA, id)) return null;
  const d = DATA[id];
  if (!d.extends) return d;
  if (!derived.has(id)) derived.set(id, derive(id, d));
  return derived.get(id);
}
const get = (id) => (enabled ? lookup(id) : null);
const ids = () => Object.keys(DATA);

// the pose the character will actually perform for a requested pose
function resolvePose(ch, pose) {
  const want = pose || 'idle';
  if (ch.poses.includes(want)) return want;
  const fb = ch.pose_fallback[want];
  if (fb && ch.poses.includes(fb)) {
    warn(`${ch.id}|pose|${want}`, `${ch.id}: pose "${want}" is not available, using "${fb}"`);
    return fb;
  }
  warn(`${ch.id}|pose|${want}`, `${ch.id}: pose "${want}" is unknown, using "idle"`);
  return 'idle';
}

// expressions are painted into the artwork; only the ones the character lists exist
function resolveExpression(ch, expr) {
  const want = expr || 'neutral';
  if (ch.expressions.includes(want)) return want;
  const use = ch.expressions[0] || 'neutral';
  warn(`${ch.id}|expr|${want}`, `${ch.id}: expression "${want}" is not available, using "${use}"`);
  return use;
}

// which camera angle to draw. facing is 1 (screen right) or -1 (screen left); override is an explicit angle id.
function resolveAngle(ch, pose, facing, override) {
  if (override) {
    if (ch.angles[override]) return override;
    warn(`${ch.id}|angle|${override}`, `${ch.id}: angle "${override}" does not exist, choosing one automatically`);
  }
  const policy = ch.pose_angle[pose] || 'three_quarter';
  const right = facing >= 0;
  const want = policy === 'front' ? 'front' : policy === 'profile' ? (right ? 'right_profile' : 'left_profile') : right ? 'front_right_45' : 'front_left_45';
  if (ch.angles[want]) return want;
  warn(`${ch.id}|angle|${want}`, `${ch.id}: angle "${want}" is missing, using "front"`);
  return 'front';
}

module.exports = {
  setEnabled, get, ids, resolvePose, resolveExpression, resolveAngle, warnings, drainWarnings: () => warnings.splice(0) };
