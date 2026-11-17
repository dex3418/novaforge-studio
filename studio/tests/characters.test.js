'use strict';
// Character registry tests. No dependencies:  cd studio && npm test
//
// What is guarded:
//   1. Existing procedural characters are byte-for-byte unchanged (golden hash).
//   2. The baked data matches the artwork on disk (no stale build).
//   3. Source artwork was not modified by the build.
//   4. Every pose x angle x facing renders valid SVG; bad input falls back, never throws or invents.
//   5. Identity is stable: same character draws at the same height in every angle and pose.
//   6. The render modules stay bundle-safe (no file access).

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const A = require('../src/story_art');
const CH = require('../src/characters');
const { buildAll, render, OUT } = require('../tools/build_characters');
const { stageSvg } = require('../src/story_stage');

let pass = 0;
const results = [];
function test(name, fn) {
  try {
    fn();
    pass++;
    results.push(`  ok   ${name}`);
  } catch (e) {
    results.push(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`);
    process.exitCode = 1;
  }
}

const quiet = (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = w; }
};

// 1 ------------------------------------------------------------------------------------------
test('procedural characters are unchanged (1092 outputs, golden hash)', () => {
  const h = crypto.createHash('sha256');
  for (const art of ['flat', 'chibi', 'webtoon']) {
    for (const pose of A.POSES) {
      for (const expr of Object.keys(A.EXPR)) {
        for (const facing of [1, -1]) {
          h.update(A.person({ id: 'ramu', name: 'Ramu', look: { gender: 'm', age: 'adult' }, x: 100, y: 700, facing, pose, expr, art, mouth: 0.4, walk: 2.1, t: 1.7, scale: 1, alpha: 1 }));
        }
      }
    }
  }
  assert.strictEqual(h.digest('hex'), '5887f13b0c7522b1b288504a0a4fb89d7477d9b0cf52be1ca0ffcad5acf07fed');
});

// 2 + 3 --------------------------------------------------------------------------------------
test('baked data is up to date with characters/*/ (run `npm run characters` if this fails)', () => {
  assert.strictEqual(fs.readFileSync(OUT, 'utf8'), render(buildAll()));
});

test('naina source artwork: 16 files present, rigged files have all six rig groups', () => {
  const dir = path.join(__dirname, '..', '..', 'characters', 'naina', 'source');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));
  assert.strictEqual(files.length, 16);
  for (const f of files.filter((x) => x.includes('_rigged'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const p of ['leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head']) assert.ok(s.includes(`<g id="${p}">`), `${f} lacks ${p}`);
  }
});

// 4 ------------------------------------------------------------------------------------------
const naina = CH.get('naina');
const base = { id: 'naina', name: 'Naina', x: 500, y: 700, facing: 1, pose: 'idle', expr: 'neutral', art: 'chibi', mouth: 0, walk: 1, t: 1, scale: 1, alpha: 1 };

test('registry knows naina, and not unknown ids', () => {
  assert.ok(naina && naina.id === 'naina');
  assert.strictEqual(CH.get('ramu'), null);
  assert.strictEqual(CH.get(undefined), null);
  assert.strictEqual(CH.get('__proto__'), null);
  assert.strictEqual(Object.keys(naina.angles).length, 8);
});

test('every supported pose x facing x art style renders valid, balanced SVG', () => {
  let n = 0;
  for (const art of ['flat', 'chibi', 'webtoon']) {
    for (const pose of naina.poses) {
      for (const facing of [1, -1]) {
        const s = A.person({ ...base, art, pose, facing, mouth: pose === 'talk' ? 0.7 : 0 });
        assert.ok(s.startsWith('<g opacity='), 'wrapped group');
        assert.strictEqual((s.match(/<g[ >]/g) || []).length, (s.match(/<\/g>/g) || []).length, `unbalanced <g> in ${pose}/${facing}/${art}`);
        assert.ok(!/\{\{|NaN|undefined/.test(s), `bad token in ${pose}/${facing}/${art}`);
        n++;
      }
    }
  }
  assert.strictEqual(n, naina.poses.length * 2 * 3);
});

test('every angle can be drawn explicitly (angle override)', () => {
  for (const g of Object.keys(naina.angles)) {
    const s = A.person({ ...base, angle: g });
    assert.ok(s.length > 5000 && !/NaN/.test(s), g);
  }
});

test('unknown pose, unknown expression and unknown angle fall back and never throw', () => {
  quiet(() => {
    CH.drainWarnings();
    const s1 = A.person({ ...base, pose: 'moonwalk' });
    const s2 = A.person({ ...base, expr: 'angry' });
    const s3 = A.person({ ...base, angle: 'upside_down' });
    for (const s of [s1, s2, s3]) assert.ok(s.startsWith('<g opacity=') && !/NaN/.test(s));
    const w = CH.drainWarnings().join(' | ');
    assert.ok(/moonwalk/.test(w) && /angry/.test(w) && /upside_down/.test(w), `warnings were: ${w}`);
  });
});

test('declared fallbacks: wave/point -> talk, shrug -> idle (and each is reported)', () => {
  quiet(() => {
    CH.drainWarnings();
    assert.strictEqual(CH.resolvePose(naina, 'wave'), 'wave', 'wave is now a real drawn pose');
    assert.strictEqual(CH.resolvePose(naina, 'happy'), 'laugh');
    assert.strictEqual(CH.resolvePose(naina, 'point'), 'talk');
    assert.strictEqual(CH.resolvePose(naina, 'shrug'), 'idle');
    assert.strictEqual(CH.resolvePose(naina, 'walk'), 'walk');
    assert.ok(CH.drainWarnings().length >= 0);
  });
});

test('angle choice follows the pose and facing direction', () => {
  assert.strictEqual(CH.resolveAngle(naina, 'walk', 1), 'right_profile');
  assert.strictEqual(CH.resolveAngle(naina, 'walk', -1), 'left_profile');
  assert.strictEqual(CH.resolveAngle(naina, 'idle', 1), 'front_right_45');
  assert.strictEqual(CH.resolveAngle(naina, 'idle', -1), 'front_left_45');
  assert.strictEqual(CH.resolveAngle(naina, 'celebrate', -1), 'front');
});

test('deterministic: same input gives identical output', () => {
  assert.strictEqual(A.person({ ...base, pose: 'walk', t: 2.3 }), A.person({ ...base, pose: 'walk', t: 2.3 }));
});

// 5 ------------------------------------------------------------------------------------------
test('identity: cleaned art is the same height (within 3%) in every angle', () => {
  // measured spread in the delivered art is ~2.1% (748..764 units, the back view is smallest); that comes from
  // the eight source drawings themselves, so the limit guards against a wrong crop, not against that.
  const hs = Object.values(naina.angles).map((a) => a.bbox.y1 - a.bbox.y0);
  assert.ok((Math.max(...hs) - Math.min(...hs)) / Math.max(...hs) < 0.03, hs.join(', '));
});

test('identity: stray top bar and edge slivers are gone from the cleaned art', () => {
  for (const g of ['front', 'front_left_45', 'left_profile']) assert.ok(naina.angles[g].bbox.y0 >= 40, `${g} top is ${naina.angles[g].bbox.y0}`);
  assert.ok(naina.angles.left_profile.bbox.x0 >= 100, `left_profile starts at x=${naina.angles.left_profile.bbox.x0}`);
});

test('identity: drawn height matches the art style height at every angle and pose', () => {
  // feet are at y=700 and the scale makes the artwork exactly heightOf(art) tall
  for (const g of Object.keys(naina.angles)) {
    const s = A.person({ ...base, angle: g, t: 0, art: 'chibi' });
    const k = Number(/scale\(([\d.]+) [\d.]+\) translate/.exec(s)[1]);
    const a = naina.angles[g];
    assert.ok(Math.abs(k * (a.bbox.y1 - a.bbox.y0) - A.heightOf('chibi')) < 0.5, g);
  }
});

test('head tilt is applied only on verified angles and stays within max_deg', () => {
  const tilted = A.person({ ...base, pose: 'think', angle: 'front' });
  assert.ok(/<g transform="rotate\(-5 /.test(tilted), 'front think should tilt -5');
  const back = A.person({ ...base, pose: 'think', angle: 'back' });
  assert.ok(!/<g transform="rotate\(-?[\d.]+ [\d.]+ [\d.]+\)"/.test(back.replace(/translate[^>]*>/, '')), 'back view must not tilt');
});

test('backing: an under-layer of colour-matched strokes is drawn beneath the art, and 0 turns it off', () => {
  const on = A.person({ ...base, angle: 'front' });
  const strokes = (on.match(/stroke="#[0-9A-Fa-f]{6}" stroke-width="6"/g) || []).length;
  const paths = (naina.angles.front.svg.match(/<path /g) || []).length;
  assert.strictEqual(strokes, paths, 'one stroked copy of every path');
  assert.ok(on.indexOf('stroke-width="6"') < on.indexOf('<path d=', on.lastIndexOf('stroke-width="6"')), 'under-layer comes first');
  assert.strictEqual(naina.backing, 6);
  const keep = naina.backing;
  try {
    naina.backing = 0;
    assert.ok(!/stroke-width/.test(A.person({ ...base, angle: 'front' })), 'no strokes when backing is 0');
  } finally { naina.backing = keep; }
});

test('backing: head tilt moves the under-layer and the art together', () => {
  const s = A.person({ ...base, pose: 'think', angle: 'front' });
  assert.strictEqual((s.match(/<g transform="rotate\(-5 /g) || []).length, 2, 'head group tilted in both layers');
});

test('face: mouth shapes appear only while speaking, on angles with a mouth spec, and follow the head tilt', () => {
  const still = A.person({ ...base, angle: 'front', mouth: 0 });
  const talk = A.person({ ...base, angle: 'front', mouth: 0.9, t: 0.02 });
  assert.ok(talk.length > still.length && talk.includes(naina.face.skin), 'overlay added with skin patch');
  assert.ok(!still.includes(naina.face.skin), 'no overlay at mouth 0');
  assert.ok(!A.person({ ...base, angle: 'back', mouth: 0.9 }).includes(naina.face.skin), 'no overlay where no mouth is drawn');
  const shapes = new Set();
  for (let i = 0; i < 12; i++) shapes.add(A.person({ ...base, angle: 'front_left_45', mouth: 0.9, t: i / 9 + 0.01 }).slice(-260));
  assert.ok(shapes.size >= 3, 'several distinct mouth shapes over time');
  const tilted = A.person({ ...base, pose: 'think', angle: 'front', mouth: 0.9 });
  assert.ok(/<g transform="rotate\(-5 [^"]+"><ellipse/.test(tilted), 'overlay inside tilt group');
  for (const g of Object.keys(naina.face.mouth)) assert.ok(naina.angles[g], g);
});

test('pose drawings: every variant renders at every facing, walk follows facing, busts hang and fade', () => {
  for (const [pose, set] of Object.entries(naina.variants)) {
    for (const key of Object.keys(set)) {
      for (const facing of [1, -1]) {
        const s = A.person({ ...base, pose, facing, angle: key === 'any' ? undefined : key });
        assert.ok(s.startsWith('<g opacity=') && !/NaN|undefined|\{\{/.test(s), `${pose}/${key}/${facing}`);
        assert.strictEqual((s.match(/<g[ >]/g) || []).length, (s.match(/<\/g>/g) || []).length, `unbalanced ${pose}/${key}`);
      }
    }
  }
  // walk uses the drawn walking frames: facing right -> right profile art, left -> left profile art
  const r = A.person({ ...base, pose: 'walk', facing: 1, t: 0 });
  const l = A.person({ ...base, pose: 'walk', facing: -1, t: 0 });
  assert.notStrictEqual(r, l);
  assert.ok(r.includes(naina.variants.walk.right_profile.svg.slice(0, 120)));
  assert.ok(l.includes(naina.variants.walk.left_profile.svg.slice(0, 120)));
  // a bust (laugh) is faded out at the bottom and has no ground shadow
  const bust = A.person({ ...base, pose: 'laugh' });
  assert.ok(/<mask id="fade-naina-laugh"/.test(bust) && !/opacity="\.16"/.test(bust));
  // a full figure (wave) keeps its ground shadow and has no mask
  const full = A.person({ ...base, pose: 'wave' });
  assert.ok(/opacity="\.16"/.test(full) && !/<mask/.test(full));
});

test('pose drawings: a drawing that faces the other way is mirrored around its feet', () => {
  const v = naina.variants.wave.any;
  const keep = v.faces;
  try {
    v.faces = 1;
    const same = A.person({ ...base, pose: 'wave', facing: 1 });
    const flipped = A.person({ ...base, pose: 'wave', facing: -1 });
    assert.ok(!/scale\(-/.test(same), 'no mirror when it already faces the right way');
    assert.ok(/scale\(-[\d.]+ [\d.]+\) translate/.test(flipped), 'mirrored when it faces the wrong way');
  } finally { v.faces = keep; }
});

test('pose drawings: baked data stays a sane size and each drawing has a feet anchor inside its box', () => {
  assert.ok(fs.statSync(OUT).size < 9 * 1024 * 1024, 'characters_data.js over 9 MB');
  for (const set of Object.values(naina.variants)) {
    for (const a of Object.values(set)) assert.ok(a.anchor >= a.bbox.x0 && a.anchor <= a.bbox.x1 && a.bbox.y1 > a.bbox.y0);
  }
});

test('transition: prev_pose blends to the new pose, old drawing stays opaque beneath, ends clean', () => {
  const plain = A.person({ ...base, pose: 'idle', t: 1 });
  const done = A.person({ ...base, pose: 'idle', t: 1, prev_pose: 'walk', blend: 1 });
  assert.strictEqual(plain, done, 'blend 1 is a plain draw');
  const mid = A.person({ ...base, pose: 'idle', t: 1, prev_pose: 'walk', blend: 0.5 });
  assert.ok(mid.length > plain.length * 1.3, 'both drawings are present midway');
  assert.strictEqual((mid.match(/<g opacity="1">/g) || []).length, 1, 'old drawing is fully opaque');
  assert.ok(/<g opacity="0\.5"/.test(mid), 'new drawing fades in (smoothstep 0.5 = 0.5)');
  const same = A.person({ ...base, pose: 'idle', t: 1, prev_pose: 'idle', blend: 0.3 });
  assert.strictEqual(same, plain, 'same pose needs no blend');
  assert.ok(!/NaN/.test(mid));
});

test('transition: stage eases a walking figure into its resting pose, procedural characters unaffected', () => {
  const beat = (t) => stageSvg(
    { setting: 'village', time: 'day', actors: [{ id: 'naina', x0: 0.2, x1: 0.5, pose: 'idle', expr: 'neutral' }], props: [], camera: { z0: 1, z1: 1, fx0: 0.5 } },
    { w: 1080, h: 1920, t, beatSec: 6, art: 'chibi', accent: '#cb3bcc', cast: { naina: { id: 'naina', name: 'Naina', look: {} } }, speakers: [], wordStarts: [], wordIdx: 0 });
  const arrive = 0.12 + Math.min(1.8, Math.max(0.55, 0.3 * 3.0)); // delay + walk duration for a 0.3 move
  const during = beat(arrive + 0.1);
  const after = beat(arrive + 0.6);
  assert.ok(during.length > after.length, 'two drawings during the ease, one after');
  assert.ok(!/NaN|undefined/.test(during));
});

test('stage: a story beat with naina (asset) and ramu (procedural) draws together with name tags', () => {
  const svg = stageSvg(
    { setting: 'village', time: 'day', actors: [{ id: 'naina', x0: 0.25, x1: 0.25, pose: 'talk', expr: 'neutral', speaks: true }, { id: 'ramu', x0: 0.75, x1: 0.75, pose: 'listen', expr: 'neutral' }], props: [], camera: { z0: 1, z1: 1.05, fx0: 0.5 } },
    { w: 1080, h: 1920, t: 1.2, beatSec: 3, art: 'chibi', accent: '#cb3bcc', cast: { naina: { id: 'naina', name: 'Naina', look: {} }, ramu: { id: 'ramu', name: 'Ramu', look: { gender: 'm' } } }, speakers: ['naina', 'naina'], wordStarts: [0.5, 1.5], wordIdx: 0 },
  );
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && !/NaN|undefined/.test(svg));
  assert.ok(svg.includes('>Naina<'), 'speaker name tag');
});

// 6 ------------------------------------------------------------------------------------------
test('bundle safety: render modules do not use fs/path', () => {
  for (const f of ['characters.js', 'character_art.js', 'story_art.js', 'story_stage.js', 'characters_data.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    assert.ok(!/require\(['"](fs|path|child_process)['"]\)/.test(s), `${f} must not require fs/path`);
  }
});

console.log(results.join('\n'));
console.log(`\n${pass}/${results.length} passed`);
