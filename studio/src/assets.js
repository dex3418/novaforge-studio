'use strict';
// What the director may use, and how complete each character really is. Pure functions on the baked data.
//
//   catalogFrom({ chars, lib, settings, props }) -> { characters, settings, props }
//   directorText(catalog, castIds)               -> the lines the director prompt gets about its cast
//
// "chars" is the baked character data (characters_data.js), "lib" the baked library (library_data.js).
// Nothing here draws or reads files, so the lab, the save server and the tests all use the same answer.

const ANGLES = ['front', 'front_left_45', 'left_profile', 'back_left_45', 'back', 'back_right_45', 'right_profile', 'front_right_45'];
const CORE_POSES = ['idle', 'walk', 'talk', 'listen'];
const MIN_EXPRESSIONS = 6;

const uniq = (a) => Array.from(new Set(a));

function describe(id, ch) {
  const idle = (ch.variants && ch.variants.idle) || {};
  const angles = uniq(Object.keys(ch.angles || {}).concat(Object.keys(idle))).filter((a) => ANGLES.includes(a));
  const poses = uniq(ch.poses || []);
  const expressions = uniq((ch.expressions || []).concat(Object.keys(ch.expression_art || {})));
  const missing = [];
  const lostAngles = ANGLES.filter((a) => !angles.includes(a));
  if (lostAngles.length) missing.push(`angles: ${lostAngles.join(', ')}`);
  const lostPoses = CORE_POSES.filter((p) => !poses.includes(p));
  if (lostPoses.length) missing.push(`poses: ${lostPoses.join(', ')}`);
  if (expressions.length < MIN_EXPRESSIONS) missing.push(`expressions: ${expressions.length} of ${MIN_EXPRESSIONS}`);
  // full = turns all the way round, walks, talks, listens.  partial = has a front drawing and idle.  basic = anything else
  const ready = !lostAngles.length && !lostPoses.length ? 'full' : angles.length && poses.includes('idle') ? 'partial' : 'basic';
  const parts = [];
  parts.push(`${angles.length}/${ANGLES.length} angles`, `${poses.length} poses`, `${expressions.length} expressions`);
  return {
    id, name: ch.name || id, ready, angles, poses, expressions, missing,
    status: `${ch.name || id}: ${parts.join(', ')}${missing.length ? ' (missing ' + missing.join('; ') + ')' : ' (complete)'}`,
    learned: !!ch.learned_style, extends: ch.extends || null,
  };
}

function catalogFrom(o) {
  const chars = o.chars || {};
  const lib = o.lib || {};
  const characters = Object.keys(chars).sort().map((id) => describe(id, chars[id]));
  const learnedScenes = Object.keys(lib.landscapes || {}).sort();
  const learnedProps = Object.keys(lib.props || {}).sort();
  const builtinSettings = (o.settings || []).filter((s) => !learnedScenes.includes(s));
  const builtinProps = (o.props || []).filter((p) => !learnedProps.includes(p));
  return {
    characters,
    settings: { builtin: builtinSettings, learned: learnedScenes.map((n) => ({ name: n, w: lib.landscapes[n].w, h: lib.landscapes[n].h, style: lib.landscapes[n].style || null })) },
    props: { builtin: builtinProps, learned: learnedProps },
  };
}

// one short block for the prompt: what each cast member can really do (a made-up pose or angle would only fall back)
function directorText(catalog, castIds) {
  const lines = [];
  for (const id of castIds || []) {
    const c = (catalog.characters || []).find((x) => x.id === id);
    if (!c) continue;
    lines.push(`  ${id}: poses ${c.poses.join(', ') || 'idle'}${c.expressions.length ? `; expressions ${c.expressions.join(', ')}` : ''}${c.ready === 'full' ? '' : `; limited (${c.ready})`}`);
  }
  return lines.length ? `WHAT EACH CAST MEMBER CAN DRAW (use only these poses and expressions for them):\n${lines.join('\n')}\n` : '';
}

// corrections a person approved in the Live Lab: { line, after } -> a short block of worked examples for the prompt
function examplesText(list, max) {
  const items = (list || []).filter((e) => e && e.line && e.after).slice(-(max || 6));
  if (!items.length) return '';
  return `EXAMPLES OF DIRECTION A PERSON APPROVED (follow the same style of blocking, poses and framing):\n${items.map((e) => `  line: ${String(e.line).slice(0, 160)}\n  beat: ${JSON.stringify(e.after)}`).join('\n')}\n`;
}

module.exports = { catalogFrom, directorText, examplesText, describe, ANGLES, CORE_POSES, MIN_EXPRESSIONS };
