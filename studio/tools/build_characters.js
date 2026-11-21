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

const ROOT = process.env.NF_ROOT || path.join(__dirname, '..', '..');
const CHAR_DIR = path.join(ROOT, 'characters');
const LIB_DIR = path.join(ROOT, 'library');
const OUT = process.env.NF_OUT || path.join(__dirname, '..', 'src', 'characters_data.js');
const LIB_OUT = process.env.NF_LIB_OUT || path.join(__dirname, '..', 'src', 'library_data.js');
const PARTS = ['leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head'];
const r1 = (n) => Math.round(n * 10) / 10;
const SCENE_EPS = 0.7;

function pathBox(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  // "x,y" pairs; paths written "x y" (older Learning Studio output) are read as absolute M/L/Q pairs
  const re = /(-?\d+\.?\d*),(-?\d+\.?\d*)/g;
  let m;
  const pairs = [];
  while ((m = re.exec(d))) pairs.push([m[1], m[2]]);
  if (!pairs.length) {
    const nums = d.match(/-?\d+\.?\d*/g) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) pairs.push([nums[i], nums[i + 1]]);
  }
  for (const pr of pairs) {
    const x = Number(pr[0]);
    const y = Number(pr[1]);
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
  return buildVariantSrc(`${id}/${pose}/${key}`, fs.readFileSync(file, 'utf8'), spec);
}
function buildVariantSrc(id_pose_key, src, spec) {
  const [id, pose, key] = id_pose_key.split('/');
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
    if (spec.raw) { kept.push(p); continue; } // learned vectors come from the Learning Studio: nothing to clean
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


// ---------------------------------------------------------------------------------------------------------------
// Learned artwork: vectors approved in the Learning Studio page (studio/learn). Same registry, same renderer.
//   characters/<id>/learned/<style>/<angle>.svg        360 views  -> variants.idle (picked by angle and facing)
//   library/pose/<style>/<id>/<pose>.svg                poses      -> extra poses
//   library/emotion/<style>/<id>/<emotion>.svg          emotions   -> drawn when an actor's expression asks for it
//   library/prop/<style>/<set>/<name>.svg               props      -> story props (a learned name replaces a built-in one)
//   library/landscape/<style>/<set>/<name>.svg          landscapes -> story settings (a learned name replaces a built-in one)
// A character with no character.json is built from these alone. A rigged character keeps its rig and only gains
// the learned poses and emotions. Optional hints sit next to the drawings in <group>.json (see characters/README.md).
// ---------------------------------------------------------------------------------------------------------------
const STYLES = ['ghibli', 'webtoon'];
const POSE_ALIAS = { standing: 'idle', walking: 'walk', sitting: 'sit', pointing: 'point', waving: 'wave', talking: 'talk', thinking: 'think', listening: 'listen', celebrating: 'celebrate', worried: 'worried' };
const KB_WARN = 500;
const okName = (n) => /^[a-z0-9_-]{1,40}$/.test(n);
const poseName = (n) => POSE_ALIAS[n] || n;

function svgFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.svg$/.test(f)).sort().map((f) => ({ name: f.slice(0, -4), file: path.join(dir, f) })).filter((x) => okName(x.name));
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; } }
const hints = (dir, group) => readJson(path.join(dir, `${group}.json`));

// all style folders that hold something for this character; the wanted style wins, then ghibli, then webtoon
function learnedStyle(id, want) {
  const has = (st) => svgFiles(path.join(CHAR_DIR, id, 'learned', st)).length || ['pose', 'emotion'].some((c) => svgFiles(path.join(LIB_DIR, c, st, id)).length);
  if (want && !STYLES.includes(want)) throw new Error(`${id}: learned_style must be one of ${STYLES.join(', ')}`);
  return [want, ...STYLES].filter(Boolean).find(has) || null;
}
function faceOf(name) { return /^(front|back)$/.test(name) ? 0 : /left/.test(name) ? -1 : /right/.test(name) ? 1 : 0; }

// size of a drawing in the units of its own viewBox, and how many source pixels one unit is (for relative scale)
function sizeInfo(src) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(src);
  const hh = /<svg[^>]*\sheight="([\d.]+)"/.exec(src);
  return { vbH: Number(vb[2]), oh: hh ? Number(hh[1]) : Number(vb[2]) };
}
function buildLearnedItems(label, items, defaultFaces) {
  const out = {};
  for (const it of items) {
    const src = fs.readFileSync(it.file, 'utf8');
    if (!/^<svg[\s>]/.test(src.trim())) throw new Error(`${label}/${it.name}: not an svg`);
    if (src.length > KB_WARN * 1024) console.warn(`  note: ${label}/${it.name} is ${(src.length / 1024).toFixed(0)} KB; Needs refinement adds detail, which also makes the video bundle heavier`);
    const art = buildVariantSrc(`${label}/learned/${it.name}`, src, { faces: defaultFaces(it.name), raw: true, shot: 'full' });
    art._info = sizeInfo(src);
    out[it.name] = art;
  }
  return out;
}
// every drawing of one character is scaled against ONE reference (the front view, else the first drawing) so
// poses and emotions keep the character's real proportions: sitting is smaller than standing, a bust is not blown up
function equalise(groups) {
  const all = groups.flatMap((g) => Object.values(g));
  if (!all.length) return;
  const ref = (groups[0] && (groups[0].front || groups[0].idle)) || all[0];
  const refH = (ref.bbox.y1 - ref.bbox.y0) * (ref._info.oh / ref._info.vbH);
  for (const a of all) {
    const own = a.bbox.y1 - a.bbox.y0;
    const sh = r1((refH * a._info.vbH) / a._info.oh);
    a.stand_h = sh >= own * 0.5 && sh <= own * 3 ? sh : null;
  }
  for (const a of all) delete a._info;
}

function assembleLearned(id, spec, rigged) {
  const style = learnedStyle(id, spec.learned_style);
  if (!style) return null;
  const angDir = path.join(CHAR_DIR, id, 'learned', style);
  const poseDir = path.join(LIB_DIR, 'pose', style), emoDir = path.join(LIB_DIR, 'emotion', style);
  const ph = hints(poseDir, id), eh = hints(emoDir, id);
  const angles = rigged ? {} : buildLearnedItems(`${id}/${style}`, svgFiles(angDir), faceOf);
  const poses = buildLearnedItems(`${id}/${style}/pose`, svgFiles(path.join(poseDir, id)), (n) => (ph[n] && ph[n].faces != null ? ph[n].faces : 1));
  const emos = buildLearnedItems(`${id}/${style}/emotion`, svgFiles(path.join(emoDir, id)), (n) => (eh[n] && eh[n].faces != null ? eh[n].faces : 0));
  const renamed = {};
  for (const [n, a] of Object.entries(poses)) renamed[poseName(n)] = a;
  equalise([angles, renamed, emos]);
  const variants = {};
  const expression_art = {};
  for (const [n, a] of Object.entries(renamed)) variants[n] = { any: a };
  for (const [n, a] of Object.entries(emos)) { variants[`emo_${n}`] = { any: a }; expression_art[n] = `emo_${n}`; }
  return { style, angles, variants, expression_art, hasAngles: !!Object.keys(angles).length };
}
function learnedOnlyCharacter(id, spec, L) {
  const variants = L.variants;
  if (L.hasAngles) variants.idle = L.angles;
  else if (variants.idle) { /* a learned "standing" pose is the idle drawing */ }
  else if (variants.emo_neutral) variants.idle = variants.emo_neutral;
  else {
    const first = Object.keys(variants)[0];
    if (!first) throw new Error(`${id}: learned artwork found but no drawings to use`);
    variants.idle = variants[first];
  }
  const poses = ['idle', ...Object.keys(variants).filter((k) => k !== 'idle' && !k.startsWith('emo_'))];
  const pose_alias = {};
  const profiles = Object.keys(variants.idle).filter((k) => /profile/.test(k)).length;
  if (!poses.includes('walk') && profiles) { poses.push('walk'); pose_alias.walk = 'idle'; }
  const expressions = ['neutral', ...Object.keys(L.expression_art).filter((e) => e !== 'neutral')];
  return {
    face: null, id, name: spec.name || id, version: spec.version || 1, backing: 0, learned_style: L.style,
    poses, variants, pose_alias, pose_fallback: spec.pose_fallback || {}, pose_angle: Object.assign({ walk: 'profile' }, spec.pose_angle || {}),
    expressions, expression_art: L.expression_art, locked_features: spec.locked_features || [],
    rig: { head_tilt: { max_deg: 0, angles: [] } }, angles: {},
  };
}

// A landscape is named by its file (library/landscape/<style>/<group>/market.svg is the setting "market"). The Learning Studio
// names a picture scene_1 when the person left the name blank, and every group then had a scene_1, so they all collapsed into
// one entry. Those automatic names now use the group name: street/scene_1.svg is "street", a second picture is "street_2".
// Like every learned name it replaces a built-in one of the same name.
function landscapeName(group, file) {
  const m = /^scene_(\d+)$/.exec(file);
  if (!m) return file;
  return Number(m[1]) === 1 ? group : `${group}_${m[1]}`;
}

// Learned landscapes are traced as pixel staircases (L688 93 L687 93 L687 94 ...), about 4 MB each. Straight-line paths
// (M, L, Z only) are simplified at bake time with Douglas-Peucker. eps is in the picture's own units (688 wide, shown ~2.5x
// larger), so 0.7 stays well under a screen pixel. Paths that use curves are left alone.
function dpLine(pts, eps, closed) {
  const n = pts.length;
  if (n < 4) return pts;
  const keep = new Uint8Array(n);
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(L);
  };
  // a closed ring starts at its two farthest-apart anchors so the cut point does not matter
  let i0 = 0, i1 = n - 1;
  if (closed) { let best = -1; for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; i1 = i; } } }
  const stack = [];
  keep[i0] = 1; keep[i1] = 1; stack.push([i0, i1]);
  if (closed) stack.push([i1, n]);                       // second half: i1 .. back to i0 (index n means pts[0])
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = b === n ? pts[0] : pts[b];
    let md = -1, mi = -1;
    for (let i = a + 1; i < (b === n ? n : b); i++) { const d = dist(pts[i], A, B); if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyLinePaths(svg, eps) {
  return svg.replace(/ d="([^"]*)"/g, (all, d) => {
    if (/[^MLZ0-9.,\s-]/.test(d)) return all;           // curves or relative commands: leave as is
    const out = [];
    for (const sub of d.split('M').slice(1)) {
      const closed = /Z\s*$/.test(sub);
      const nums = sub.replace(/Z\s*$/, '').split('L').map((q) => q.trim().split(/[\s,]+/).map(Number));
      if (nums.some((q) => q.length !== 2 || q.some((v) => !isFinite(v)))) return all;
      const pts = dpLine(nums, eps, closed);
      if (pts.length < 3) continue;
      out.push('M' + pts.map((q) => `${Math.round(q[0] * 10) / 10} ${Math.round(q[1] * 10) / 10}`).join('L') + (closed ? 'Z' : ''));
    }
    return ` d="${out.join('')}"`;
  });
}

function buildLibrary() {
  const want = readJson(path.join(LIB_DIR, 'config.json')).style;
  const out = { props: {}, landscapes: {} };
  const styleOrder = [want, ...STYLES].filter(Boolean);
  for (const [cat, key] of [['prop', 'props'], ['landscape', 'landscapes']]) {
    const found = {}; // name -> { style -> file }
    for (const st of STYLES) {
      const sdir = path.join(LIB_DIR, cat, st);
      if (!fs.existsSync(sdir)) continue;
      for (const g of fs.readdirSync(sdir).sort()) {
        for (const it of svgFiles(path.join(sdir, g))) {
          const name = cat === 'landscape' ? landscapeName(g, it.name) : it.name;
          (found[name] = found[name] || {})[st] = { file: it.file, group: g, dir: path.join(sdir), orig: it.name };
        }
      }
    }
    for (const name of Object.keys(found).sort()) {
      const st = styleOrder.find((x) => found[name][x]);
      const e = found[name][st];
      const src = fs.readFileSync(e.file, 'utf8');
      const label = `${cat}/${st}/${e.group}`;
      if (src.length > KB_WARN * 1024) console.warn(`  note: ${label}/${name} is ${(src.length / 1024).toFixed(0)} KB`);
      const art = buildVariantSrc(`${label}/learned/${name}`, cat === 'landscape' ? simplifyLinePaths(src, SCENE_EPS) : src, { raw: true, shot: 'full' });
      const hs = hints(e.dir, e.group);
      const h = hs[name] || hs[e.orig] || {};
      if (key === 'props') {
        out.props[name] = { w: art.w, h: art.h, bbox: art.bbox, svg: art.svg, ...(h.height ? { height: Number(h.height) } : {}), style: st };
      } else {
        out.landscapes[name] = { w: art.w, h: art.h, svg: art.svg, style: st };
      }
    }
  }
  return out;
}

function buildOne(id) {
  const specFile = path.join(CHAR_DIR, id, 'character.json');
  const spec = fs.existsSync(specFile) ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : { character_id: id, name: id };
  if (spec.character_id !== id) throw new Error(`${id}: character_id is "${spec.character_id}"`);
  if (spec.extends) {
    // same body and drawings as another character, different colours (applied by the renderer, nothing is copied)
    if (spec.extends === id) throw new Error(`${id}: cannot extend itself`);
    for (const r of spec.recolor || []) {
      if (!Array.isArray(r.from_hue) || r.from_hue.length !== 2 || typeof r.to_hue !== 'number') throw new Error(`${id}: each recolor rule needs from_hue [a,b] and to_hue`);
    }
    return { id, name: spec.name || id, version: spec.version || 1, extends: spec.extends, recolor: spec.recolor || [] };
  }
  const rigged = !!Object.keys(spec.angles || {}).length;
  const L = assembleLearned(id, spec, rigged);
  if (!rigged) {
    if (!L) throw new Error(`${id}: no character.json angles and nothing learned (characters/${id}/learned/<style>/*.svg)`);
    return learnedOnlyCharacter(id, spec, L);
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
  // a rigged character keeps its rig; learned poses and emotions are added next to it
  const expression_art = {};
  if (L) {
    for (const [k, set] of Object.entries(L.variants)) { if (variants[k]) throw new Error(`${id}: learned "${k}" collides with an existing pose`); variants[k] = set; }
    Object.assign(expression_art, L.expression_art);
  }
  const allPoses = [...poses];
  for (const p of Object.keys(variants)) if (!allPoses.includes(p) && !p.startsWith('emo_')) allPoses.push(p);
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
    expressions: [...new Set([...(spec.expressions && spec.expressions.length ? spec.expressions : ['neutral']), ...Object.keys(expression_art)])],
    ...(Object.keys(expression_art).length ? { expression_art } : {}),
    locked_features: spec.locked_features || [],
    rig: { head_tilt: { max_deg: head.max_deg || 0, angles: head.angles || [] } },
    angles,
  };
}

function buildAll() {
  const data = {};
  if (!fs.existsSync(CHAR_DIR)) return data;
  for (const id of fs.readdirSync(CHAR_DIR).sort()) {
    if (fs.existsSync(path.join(CHAR_DIR, id, 'character.json')) || fs.existsSync(path.join(CHAR_DIR, id, 'learned'))) data[id] = buildOne(id);
  }
  // characters that exist only as learned poses/emotions (library/pose|emotion/<style>/<id>/)
  for (const c of ['pose', 'emotion']) for (const st of STYLES) {
    const d = path.join(LIB_DIR, c, st);
    if (fs.existsSync(d)) for (const id of fs.readdirSync(d).sort()) if (okName(id) && fs.statSync(path.join(d, id)).isDirectory() && !data[id] && svgFiles(path.join(d, id)).length) data[id] = buildOne(id);
  }
  for (const [id, d] of Object.entries(data)) {
    if (d.extends && (!data[d.extends] || data[d.extends].extends)) throw new Error(`${id}: extends "${d.extends}", which is missing or itself derived`);
  }
  return data;
}

const HEADER = '\'use strict\';\n// GENERATED by tools/build_characters.js from characters/*/character.json. Do not edit by hand.\n// Rebuild with:  cd studio && npm run characters\nmodule.exports = ';

const LIB_HEADER = '\'use strict\';\n// GENERATED by tools/build_characters.js from library/ (props and landscapes approved in the Learning Studio). Do not edit by hand.\nmodule.exports = ';
const renderLib = (lib) => `${LIB_HEADER}${JSON.stringify(lib)};\n`;
function render(data) {
  return `${HEADER}${JSON.stringify(data)};\n`;
}

if (require.main === module) {
  const data = buildAll();
  fs.writeFileSync(OUT, render(data));
  const lib = buildLibrary();
  fs.writeFileSync(LIB_OUT, renderLib(lib));
  const learned = Object.values(data).filter((c) => c.learned_style).map((c) => c.id);
  console.log(`learned: characters [${learned.join(', ') || '-'}], props [${Object.keys(lib.props).join(', ') || '-'}], landscapes [${Object.keys(lib.landscapes).join(', ') || '-'}]`);
  for (const [id, c] of Object.entries(data)) {
    if (c.extends) { console.log(`${id}: same drawings as ${c.extends}, ${c.recolor.length} recolor rule(s)`); continue; }
    const rm = Object.entries(c.angles).map(([a, v]) => `${a}:${v.removed}`).join(' ');
    console.log(`${id}: ${Object.keys(c.angles).length} angles, poses [${c.poses.join(', ')}], removed stray paths ${rm}`);
  }
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

module.exports = { buildAll, render, OUT, buildLibrary, renderLib, LIB_OUT, landscapeName, simplifyLinePaths };
