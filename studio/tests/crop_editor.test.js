'use strict';
// Crop editor geometry: drawing, moving, resizing, picking, fitting to the drawing, reading order, and the page copy.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const C = require('../learn/crop_editor.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

ok('a box drawn backwards or past the edge is normalised and kept inside the sheet', () => {
  assert.deepStrictEqual(C.norm(120, 90, 20, 10, 100, 100), { x: 20, y: 10, w: 80, h: 80 });
  assert.deepStrictEqual(C.norm(-30, -30, 50, 50, 100, 100), { x: 0, y: 0, w: 50, h: 50 });
});
ok('moving stops at the sheet edge and keeps the size', () => {
  const b = C.apply({ x: 10, y: 10, w: 40, h: 30 }, 'move', 500, -500, 200, 100);
  assert.deepStrictEqual(b, { x: 160, y: 0, w: 40, h: 30 });
});
ok('resizing a corner changes two sides and never goes below the minimum', () => {
  assert.deepStrictEqual(C.apply({ x: 10, y: 10, w: 40, h: 30 }, 'se', 10, 5, 200, 100), { x: 10, y: 10, w: 50, h: 35 });
  const tiny = C.apply({ x: 10, y: 10, w: 40, h: 30 }, 'nw', 500, 500, 200, 100);
  assert.ok(tiny.w >= C.MIN && tiny.h >= C.MIN, JSON.stringify(tiny));
  assert.deepStrictEqual(C.apply({ x: 10, y: 10, w: 40, h: 30 }, 'e', 20, 99, 200, 100), { x: 10, y: 10, w: 60, h: 30 });
});
ok('picking: the selected box handles win, then the smallest box under the point', () => {
  const boxes = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 20, y: 20, w: 20, h: 20 }];
  assert.deepStrictEqual(C.hit(boxes, 30, 30, 6, null), { i: 1, handle: 'move' });
  assert.deepStrictEqual(C.hit(boxes, 80, 80, 6, null), { i: 0, handle: 'move' });
  assert.deepStrictEqual(C.hit(boxes, 40, 40, 6, 1), { i: 1, handle: 'se' });
  assert.strictEqual(C.hit(boxes, 150, 150, 6, null), null);
});
ok('fit to drawing shrinks a loose box around the figure and leaves an empty box alone', () => {
  const w = 60, h = 40, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 0; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 0; rgba[i * 4 + 3] = 255; }
  for (let y = 10; y < 20; y++) for (let x = 20; x < 35; x++) { const i = (y * w + x) * 4; rgba[i] = 240; rgba[i + 1] = 180; rgba[i + 2] = 140; }
  const bg = { r: 0, g: 255, b: 0 };
  const t = C.tighten(rgba, w, h, { x: 0, y: 0, w, h }, bg, 60, 2);
  assert.deepStrictEqual(t, { x: 18, y: 8, w: 19, h: 14 });
  const empty = C.tighten(rgba, w, h, { x: 0, y: 25, w: 10, h: 10 }, bg, 60, 2);
  assert.deepStrictEqual(empty, { x: 0, y: 25, w: 10, h: 10 });
});
ok('reading order is rows from the top, left to right inside a row', () => {
  const b = [{ x: 200, y: 5, w: 50, h: 60, id: 'b' }, { x: 10, y: 150, w: 50, h: 60, id: 'c' }, { x: 10, y: 0, w: 50, h: 60, id: 'a' }, { x: 120, y: 160, w: 50, h: 60, id: 'd' }];
  assert.strictEqual(C.sortReading(b).map((x) => x.id).join(''), 'abcd');
});
ok('index.html carries the current crop_editor.js, and the server swaps it in even if the copy is stale', () => {
  const real = path.join(__dirname, '..', 'learn', 'index.html');
  const html = fs.readFileSync(real, 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'learn', 'crop_editor.js'), 'utf8').replace(/\n$/, '');
  const m = html.match(/\/\*CROP_EDITOR_BEGIN\*\/\n([\s\S]*?)\n\/\*CROP_EDITOR_END\*\//);
  assert.ok(m && m[1] === src, 'run: node tools/sync_reader.js');
  const { pageHtml } = require('../tools/learn_server.js');
  try {
    fs.writeFileSync(real, html.replace(/\/\*CROP_EDITOR_BEGIN\*\/\n[\s\S]*?\n\/\*CROP_EDITOR_END\*\//, () => '/*CROP_EDITOR_BEGIN*/\n// STALE\n/*CROP_EDITOR_END*/'));
    const served = pageHtml();
    assert.ok(!served.includes('// STALE') && served.includes('function tighten'));
  } finally { fs.writeFileSync(real, html); }
});
console.log(`crop_editor: ${n} checks passed`);
