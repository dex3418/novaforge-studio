'use strict';
// Sheet Reader: finds figures on a character sheet from their own pixels, never slices through a drawing,
// and crops by outline (light parts inside the outline stay, the gap between legs and neighbours go).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const SR = require('../learn/sheet_reader.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

const W = 1200, H = 900, BG = { r: 250, g: 250, b: 250 };
function blank() { const a = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { a[i * 4] = 250; a[i * 4 + 1] = 250; a[i * 4 + 2] = 250; a[i * 4 + 3] = 255; } return a; }
function rect(a, x0, y0, x1, y1, c) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * 4; a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; } }
function disc(a, cx, cy, r, c) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { const o = (y * W + x) * 4; a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; } }
const DARK = [40, 30, 25], PALE = [248, 244, 238], NAVY = [42, 45, 52];
// a figure: dark outline ring (head) + dark body, with a light face inside and a pale gap between two legs
function figure(a, cx, top) {
  disc(a, cx, top + 40, 40, DARK); disc(a, cx, top + 40, 30, PALE);               // head: dark ring, pale face inside
  rect(a, cx - 36, top + 80, cx + 36, top + 200, DARK);                              // body
  rect(a, cx - 5, top + 150, cx + 5, top + 200, [250, 250, 250]);                   // gap between the legs (open at the bottom)
}

ok('12 unlabelled figures in 3 rows x 4 columns are found one by one (no tall stripes)', () => {
  const a = blank();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) figure(a, 150 + c * 300, 40 + r * 280);
  const res = SR.read({ rgba: a, w: W, h: H, bg: BG });
  const figs = res.items.filter((i) => i.kind === 'angle' || i.kind === 'expression');
  assert.strictEqual(figs.length, 12);
  for (const f of figs) assert.ok(f.box.h < 300, 'a box must hold one figure, not a stripe: ' + f.box.h);
});

ok('a label pill under each figure is furniture, names the row as angles, and is not part of the figure', () => {
  const a = blank();
  for (let c = 0; c < 4; c++) { figure(a, 150 + c * 300, 40); rect(a, 150 + c * 300 - 50, 270, 150 + c * 300 + 50, 300, NAVY); }
  const res = SR.read({ rgba: a, w: W, h: H, bg: BG });
  assert.strictEqual(res.counts.angle, 4);
  assert.strictEqual(res.items.filter((i) => i.label).length, 4);
  for (const f of res.items) assert.ok(f.box.y + f.box.h <= 272, 'box must stop above the label: ' + (f.box.y + f.box.h));
});

ok('a banner touching a figure\'s hair is separated by colour once real labels are known', () => {
  const a = blank();
  for (let c = 0; c < 4; c++) { figure(a, 150 + c * 300, 130); rect(a, 150 + c * 300 - 50, 340, 150 + c * 300 + 50, 370, NAVY); }
  rect(a, 20, 20, 260, 70, NAVY);                                                    // banner...
  rect(a, 140, 68, 160, 140, DARK);                                                  // ...joined to the first figure's hair
  const res = SR.read({ rgba: a, w: W, h: H, bg: BG });
  assert.strictEqual(res.counts.angle, 4);
  const first = res.items.slice().sort((p, q) => p.box.x - q.box.x)[0];
  assert.ok(first.box.y >= 60, 'banner (y 20-70) must no longer stretch the figure box to the top (y=' + first.box.y + ')');
  assert.ok(res.notes.some((t) => /separated/.test(t)), 'the separation is reported');
  assert.ok(res.furniture.some((f) => f.kind === 'heading'), 'banner is listed as furniture');
});

ok('two drawings joined by touching hair are cut once, not left as one box', () => {
  const a = blank();
  [150, 250, 600, 900].forEach((cx) => figure(a, cx, 40));
  rect(a, 175, 100, 225, 120, DARK);                                                 // hair of figure 1 touches figure 2
  const res = SR.read({ rgba: a, w: W, h: H, bg: BG });
  assert.strictEqual(res.items.length, 4);
  assert.ok(res.notes.some((t) => /joined/.test(t)), 'the cut is reported');
});

ok('crop by outline: pale face stays, gap between legs and a neighbour\'s pixels are transparent', () => {
  const a = blank();
  figure(a, 300, 40); figure(a, 380, 40); figure(a, 700, 40); figure(a, 1000, 40);                                            // second figure overlaps the first one\'s box
  const res = SR.read({ rgba: a, w: W, h: H, bg: BG, join: false });
  const mine = res.items.slice().sort((p, q) => p.box.x - q.box.x)[0];
  const cr = SR.cropRgba(res, mine, a, W, H);
  const at = (x, y) => cr.rgba[((y - mine.box.y) * cr.w + (x - mine.box.x)) * 4 + 3];
  assert.strictEqual(at(300, 80), 255, 'pale face inside the outline is kept');
  assert.strictEqual(at(300, 220), 0, 'pale gap between the legs, open to the outside, is removed');
  assert.ok(343 >= mine.box.x && 343 < mine.box.x + mine.box.w, 'test pixel is inside the first box');
  assert.strictEqual(at(343, 80), 0, 'the neighbour\'s head edge inside this box is removed');
});

ok('a figure whose pixels touch its box edge is reported as possibly cut', () => {
  const a = blank(); figure(a, 600, 40);
  const res = SR.read({ rgba: a, w: W, h: H, bg: BG });
  assert.strictEqual(SR.touchesEdge(res, res.items[0]), false);
  const bad = Object.assign({}, res.items[0], { box: { x: res.items[0].box.x + 20, y: res.items[0].box.y, w: res.items[0].box.w - 40, h: res.items[0].box.h } });
  assert.strictEqual(SR.touchesEdge(res, bad), true);
});

ok('page carries an identical copy of the reader (the server only serves index.html)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'learn', 'index.html'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'learn', 'sheet_reader.js'), 'utf8');
  const m = html.match(/\/\*SHEET_READER_BEGIN\*\/\n([\s\S]*?)\n\/\*SHEET_READER_END\*\//);
  assert.ok(m, 'markers present');
  assert.strictEqual(m[1], src.replace(/\n$/, ''), 'run: node tools/sync_reader.js');
});

ok('the server always hands out the current reader, even if the copy inside index.html is stale', () => {
  const os = require('os');
  const { pageHtml } = require('../tools/learn_server.js');
  const real = path.join(__dirname, '..', 'learn', 'index.html');
  const keep = fs.readFileSync(real, 'utf8');
  try {
    fs.writeFileSync(real, keep.replace(/\/\*SHEET_READER_BEGIN\*\/\n[\s\S]*?\n\/\*SHEET_READER_END\*\//, () => '/*SHEET_READER_BEGIN*/\n// STALE COPY\n/*SHEET_READER_END*/'));
    const served = pageHtml();
    assert.ok(!served.includes('STALE COPY'), 'stale copy must be replaced');
    assert.ok(served.includes('function read(o)'), 'current reader is present');
  } finally { fs.writeFileSync(real, keep); }
});

console.log(`sheet_reader: ${n} checks passed`);
