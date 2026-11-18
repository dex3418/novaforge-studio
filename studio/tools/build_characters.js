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

// A "variant" is a complete, flat drawing of one pose (no rig groups). Its paths already carry their own
// outline stroke, so no backing layer is needed. Feet anchor = middle of the lowest part of the drawing.
function buildVariant(id, pose, key, spec) {
  const file = path.join(CHAR_DIR, id, spec.file);
  if (!fs.existsSync(file)) throw new Error(`${id}/${pose}/${key}: missing file ${spec.file}`);
  const src = fs.readFileSync(file, 'utf8');
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(src);
  if (!vb) throw new Error(`${id}/${pose}/${key}: no viewBox`);
  const paths = [];
  const re = /<path\b[^>]*>/g;
  let m;
  while ((m = re.exec(src))) {
    const d = /\sd="([^"]+)"/.exec(m[0]);
    const b = d && pathBox(d[1]);
    if (b) paths.push({ tag: m[0], b });
  }
  if (!paths.length) throw new Error(`${id}/${pose}/${key}: no paths`);
  // tracing leftovers: a flat "label bar" along the top of the sheet, and thin slivers cut off at a side edge.
  // Only whole paths are dropped; the source file is untouched.
  const VW = Number(vb[1]);
  const VH = Number(vb[2]);
  const junk = (p) => {
    const w = p.b.x1 - p.b.x0;
    const h = p.b.y1 - p.b.y0;
    const banner = (h < 40 && w > 50 && p.b.y1 < VH * 0.1) || p.b.y1 < 6;
    const sliver = w < 16 && h > 20 && (p.b.x0 <= 3 || p.b.x1 >= VW - 3);
    return banner || sliver;
  };
  // junk can also hide inside a big outline path as one of its sub-shapes, so each M...Z piece is tested too
  // anything that lies completely outside the figure is a tracing leftover (specks above the head, slivers beside the
  // body). The figure = the union of the biggest few shapes; a shape counts as outside when its box does not touch that.
  const pieceBox = (piece) => pathBox(piece);
  const allPieces = [];
  for (const p of paths) for (const piece of /\sd="([^"]+)"/.exec(p.tag)[1].split(/(?=M)/)) { const b = pieceBox(piece); if (b) allPieces.push(b); }
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const bigPieces = allPieces.slice().sort((x, y) => area(y) - area(x)).slice(0, 3);
  const fig = { x0: Math.min(...bigPieces.map((b) => b.x0)), y0: Math.min(...bigPieces.map((b) => b.y0)), x1: Math.max(...bigPieces.map((b) => b.x1)), y1: Math.max(...bigPieces.map((b) => b.y1)) };
  const M = 6;
  const outside = (b) => b.x1 < fig.x0 - M || b.x0 > fig.x1 + M || b.y1 < fig.y0 - M || b.y0 > fig.y1 + M;
  let removed = 0;
  const kept = [];
  for (const p of paths) {
    if (junk(p)) { removed++; continue; }
    const dm = /\sd="([^"]+)"/.exec(p.tag);
    const pieces = dm[1].split(/(?=M)/).filter((x) => x.trim());
    const good = pieces.filter((piece) => { const b = pathBox(piece); return !b || (!junk({ b }) && !outside(b)); });
    if (!good.length) { removed++; continue; }
    if (good.length !== pieces.length) {
      removed += pieces.length - good.length;
      const nd = good.join('');
      p.tag = p.tag.replace(dm[1], nd);
      p.b = pathBox(nd) || p.b;
    }
    kept.push(p);
  }
  paths.length = 0;
  paths.push(...kept);
  const box = { x0: Math.min(...paths.map((p) => p.b.x0)), y0: Math.min(...paths.map((p) => p.b.y0)), x1: Math.max(...paths.map((p) => p.b.x1)), y1: Math.max(...paths.map((p) => p.b.y1)) };
  const low = paths.filter((p) => p.b.y1 >= box.y1 - (box.y1 - box.y0) * 0.06);
  const fx0 = Math.min(...low.map((p) => p.b.x0));
  const fx1 = Math.max(...low.map((p) => p.b.x1));
  // shorter numbers: 12.0 -> 12 (keeps the baked file small)
  const svg = paths.map((p) => p.tag.replace(/(\d)\.0(?!\d)/g, '$1')).join('');
  if (/\bid="/.test(svg)) throw new Error(`${id}/${pose}/${key}: unexpected ids in markup`);
  return {
    faces: spec.faces || 0,
    w: Number(vb[1]), h: Number(vb[2]),
    bbox: { x0: r1(box.x0), y0: r1(box.y0), x1: r1(box.x1), y1: r1(box.y1) },
    anchor: r1((fx0 + fx1) / 2),
    stand_h: spec.stand_h || null,
    shot: spec.shot || null,
    removed,
    svg,
  };
}

function buildOne(id) {
  const spec = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, id, 'character.json'), 'utf8'));
  if (spec.character_id !== id) throw new Error(`${id}: character_id is "${spec.character_id}"`);
  if (spec.extends) {
    // same body and drawings as another character, different colours (applied by the renderer, nothing is copied)
    if (spec.extends === id) throw new Error(`${id}: cannot extend itself`);
    for (const r of spec.recolor || []) {
      if (!Array.isArray(r.from_hue) || r.from_hue.length !== 2 || typeof r.to_hue !== 'number') throw new Error(`${id}: each recolor rule needs from_hue [a,b] and to_hue`);
    }
    return { id, name: spec.name || id, version: spec.version || 1, extends: spec.extends, recolor: spec.recolor || [] };
  }
  const angles = {};
  for (const [name, a] of Object.entries(spec.angles || {})) angles[name] = buildAngle(id, name, a);
  if (!angles.front) throw new Error(`${id}: a "front" angle is required (it is the fallback)`);
  const poses = spec.poses || ['idle'];
  if (!poses.includes('idle')) throw new Error(`${id}: pose "idle" is required (it is the fallback)`);
  for (const [from, to] of Object.entries(spec.pose_fallback || {})) {
    if (!poses.includes(to) && !(spec.variants || {})[to]) throw new Error(`${id}: pose_fallback ${from} -> ${to}, but ${to} is not a supported pose`);
  }
  const variants = {};
  for (const [pose, keys] of Object.entries(spec.variants || {})) {
    variants[pose] = {};
    for (const [key, v] of Object.entries(keys)) {
      if (key !== 'any' && !angles[key]) throw new Error(`${id}: variant ${pose} uses unknown angle ${key}`);
      variants[pose][key] = buildVariant(id, pose, key, v);
    }
  }
  const allPoses = [...poses];
  for (const p of Object.keys(variants)) if (!allPoses.includes(p)) allPoses.push(p);
  const backing = spec.backing == null ? 6 : spec.backing;
  if (typeof backing !== 'number' || backing < 0 || backing > 12) throw new Error(`${id}: backing must be a number from 0 to 12`);
  const head = (spec.rig && spec.rig.head_tilt) || { max_deg: 0, angles: [] };
  for (const a of head.angles || []) if (!angles[a]) throw new Error(`${id}: rig.head_tilt lists unknown angle ${a}`);
  const face = spec.face || null;
  if (face) for (const a of Object.keys(face.mouth || {})) if (!angles[a]) throw new Error(`${id}: face.mouth lists unknown angle ${a}`);
  return {
    face,
    id, name: spec.name || id, version: spec.version || 1, backing,
    poses: allPoses, variants, pose_fallback: spec.pose_fallback || {}, pose_angle: spec.pose_angle || {},
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
  for (const [id, d] of Object.entries(data)) {
    if (d.extends && (!data[d.extends] || data[d.extends].extends)) throw new Error(`${id}: extends "${d.extends}", which is missing or itself derived`);
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
    if (c.extends) { console.log(`${id}: same drawings as ${c.extends}, ${c.recolor.length} recolor rule(s)`); continue; }
    const rm = Object.entries(c.angles).map(([a, v]) => `${a}:${v.removed}`).join(' ');
    console.log(`${id}: ${Object.keys(c.angles).length} angles, poses [${c.poses.join(', ')}], removed stray paths ${rm}`);
  }
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

module.exports = { buildAll, render, OUT };
