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

const get = (id) => (id && Object.prototype.hasOwnProperty.call(DATA, id) ? DATA[id] : null);
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

module.exports = { get, ids, resolvePose, resolveExpression, resolveAngle, warnings, drainWarnings: () => warnings.splice(0) };
