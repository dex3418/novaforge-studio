'use strict';
// Builds the character data the renderer uses, from characters/<id>/character.json + source/*.svg.
//
//   cd studio && npm run characters
//
// Why a build step: the render code (scenes.js, story_stage.js, story_art.js) is bundled by Remotion for
// the browser, so it cannot read files. This script reads the artwork once, cleans it, and writes
// src/characters_data.js. The files in characters/<id>/source/ are NEVER modified.
//
// Cleaning is declared per angle in character.json and only removes whole <path> elements:
//   remove_above_y: drop paths whose lowest point is at or above this y (stray tracing bar at the top)
//   remove_left_x:  drop paths whose rightmost point is at or left of this x (slivers cut off the sheet edge)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHAR_DIR = path.join(ROOT, 'characters');
const OUT = path.join(__dirname, '..', 'src', 'characters_data.js');
const PARTS = ['leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head'];
const r1 = (n) => Math.round(n * 10) / 10;

function pathBox(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const re = /(-?\d+\.?\d*),(-?\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(d))) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

function buildAngle(id, angle, spec) {
  const file = path.join(CHAR_DIR, id, 'source', spec.file);
  if (!fs.existsSync(file)) throw new Error(`${id}/${angle}: missing source file ${spec.file}`);
  const src = fs.readFileSync(file, 'utf8');
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(src);
  if (!vb) throw new Error(`${id}/${angle}: no viewBox`);
  const w = Number(vb[1]);
  const h = Number(vb[2]);
  const pivots = {};
  const pr = /#([\w-]+)\s*\{\s*transform-origin:\s*([\d.]+)px\s+([\d.]+)px/g;
  let m;
  while ((m = pr.exec(src))) pivots[m[1]] = [Number(m[2]), Number(m[3])];
  const rootKey = `${id}-root`;
  for (const p of PARTS) if (!pivots[p]) throw new Error(`${id}/${angle}: no pivot for ${p}`);
  if (!pivots[rootKey]) throw new Error(`${id}/${angle}: no pivot for ${rootKey}`);

  const body = src.slice(src.indexOf('</style>') + 8, src.lastIndexOf('</svg>'));
  const clean = spec.clean || {};
  let removed = 0;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const lines = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const pm = /^<path d="([^"]+)"/.exec(line);
    if (pm) {
      const b = pathBox(pm[1]);
      if (b && ((clean.remove_above_y != null && b.y1 <= clean.remove_above_y) || (clean.remove_left_x != null && b.x1 <= clean.remove_left_x))) {
        removed++;
        continue;
      }
      if (b) {
        box.x0 = Math.min(box.x0, b.x0);
        box.y0 = Math.min(box.y0, b.y0);
        box.x1 = Math.max(box.x1, b.x1);
        box.y1 = Math.max(box.y1, b.y1);
      }
    }
    lines.push(line);
  }
  let svg = lines.join('');
  // rig groups become transform slots the renderer fills in ({{head}} -> transform="rotate(...)")
  for (const p of PARTS) {
    if (!svg.includes(`<g id="${p}">`)) throw new Error(`${id}/${angle}: rig group ${p} not found`);
    svg = svg.replace(`<g id="${p}">`, `<g {{${p}}}>`);
  }
  svg = svg.replace(`<g id="${rootKey}">`, '<g>');
  if (/id="/.test(svg)) throw new Error(`${id}/${angle}: unexpected ids left in markup`);
  return {
    faces: spec.faces || 0,
    w, h,
    bbox: { x0: r1(box.x0), y0: r1(box.y0), x1: r1(box.x1), y1: r1(box.y1) },
    anchor: pivots[rootKey][0],
    pivots: Object.fromEntries(PARTS.map((p) => [p, pivots[p]])),
    removed,
    svg,
  };
}

function buildOne(id) {
  const spec = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, id, 'character.json'), 'utf8'));
  if (spec.character_id !== id) throw new Error(`${id}: character_id is "${spec.character_id}"`);
  const angles = {};
  for (const [name, a] of Object.entries(spec.angles || {})) angles[name] = buildAngle(id, name, a);
  if (!angles.front) throw new Error(`${id}: a "front" angle is required (it is the fallback)`);
  const poses = spec.poses || ['idle'];
  if (!poses.includes('idle')) throw new Error(`${id}: pose "idle" is required (it is the fallback)`);
  for (const [from, to] of Object.entries(spec.pose_fallback || {})) {
    if (!poses.includes(to)) throw new Error(`${id}: pose_fallback ${from} -> ${to}, but ${to} is not a supported pose`);
  }
  const head = (spec.rig && spec.rig.head_tilt) || { max_deg: 0, angles: [] };
  for (const a of head.angles || []) if (!angles[a]) throw new Error(`${id}: rig.head_tilt lists unknown angle ${a}`);
  return {
    id, name: spec.name || id, version: spec.version || 1,
    poses, pose_fallback: spec.pose_fallback || {}, pose_angle: spec.pose_angle || {},
    expressions: spec.expressions && spec.expressions.length ? spec.expressions : ['neutral'],
    locked_features: spec.locked_features || [],
    rig: { head_tilt: { max_deg: head.max_deg || 0, angles: head.angles || [] } },
    angles,
  };
}

function buildAll() {
  const data = {};
  if (!fs.existsSync(CHAR_DIR)) return data;
  for (const id of fs.readdirSync(CHAR_DIR).sort()) {
    if (fs.existsSync(path.join(CHAR_DIR, id, 'character.json'))) data[id] = buildOne(id);
  }
  return data;
}

const HEADER = '\'use strict\';\n// GENERATED by tools/build_characters.js from characters/*/character.json. Do not edit by hand.\n// Rebuild with:  cd studio && npm run characters\nmodule.exports = ';

function render(data) {
  return `${HEADER}${JSON.stringify(data)};\n`;
}

if (require.main === module) {
  const data = buildAll();
  fs.writeFileSync(OUT, render(data));
  for (const [id, c] of Object.entries(data)) {
    const rm = Object.entries(c.angles).map(([a, v]) => `${a}:${v.removed}`).join(' ');
    console.log(`${id}: ${Object.keys(c.angles).length} angles, poses [${c.poses.join(', ')}], removed stray paths ${rm}`);
  }
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

module.exports = { buildAll, render, OUT };
