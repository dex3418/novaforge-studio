'use strict';
// Draws a contact sheet of one registry character: every pose facing right and left, plus every angle.
//   node tools/character_sheet.js naina /path/to/out        -> out/naina_sheet.svg (+ .png if rsvg-convert exists)
// Uses the real renderer (story_art.person), so what you see is what the video draws.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../src/story_art');
const CH = require('../src/characters');

const id = process.argv[2] || 'naina';
const outDir = process.argv[3] || path.join(__dirname, '..', 'out');
const ch = CH.get(id);
if (!ch) {
  console.error(`no such character: ${id} (have: ${CH.ids().join(', ')})`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const art = process.argv[4] || 'chibi';
const CELL = 300;
const poses = ch.poses;
const angles = Object.keys(ch.angles);
const rows = [];
poses.forEach((pose) => rows.push({ label: pose, items: [1, -1].map((f) => ({ pose, facing: f, label: f > 0 ? 'right' : 'left' })) }));
rows.push({ label: 'angles', items: angles.map((g) => ({ pose: 'idle', facing: 1, angle: g, label: g })) });
// whole-pose drawings: one cell per pose (walk shows all of its angles)
const vposes = Object.keys(ch.variants || {});
vposes.forEach((p) => {
  const keys = Object.keys(ch.variants[p]);
  rows.push({ label: `${p} (drawing)`, items: keys.flatMap((k) => (k === 'any' ? [1, -1] : [1]).map((f) => ({ pose: p, facing: f, angle: k === 'any' ? undefined : k, label: `${k === 'any' ? '' : k + ' '}${f > 0 ? 'right' : 'left'}` }))) });
});
const cols = Math.max(...rows.map((r) => r.items.length));
const W = cols * CELL;
const H = rows.length * 420 + 20;
let body = '';
rows.forEach((row, ri) => {
  const y0 = 20 + ri * 420;
  body += `<text x="8" y="${y0 + 14}" font-size="16" font-family="sans-serif" fill="#c0392b">${row.label}</text><line x1="0" x2="${W}" y1="${y0 + 400}" y2="${y0 + 400}" stroke="#ddd"/>`;
  row.items.forEach((it, ci) => {
    const x = ci * CELL + CELL / 2;
    body += `<text x="${x}" y="${y0 + 36}" font-size="13" text-anchor="middle" font-family="sans-serif" fill="#666">${it.label}</text>`;
    body += A.person({ id, name: ch.name, x, y: y0 + 392, facing: it.facing, pose: it.pose, expr: 'neutral', art, mouth: it.pose === 'talk' ? 0.8 : 0, walk: 1.2, t: 1.35, scale: 1, angle: it.angle });
  });
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
const file = path.join(outDir, `${id}_sheet.svg`);
fs.writeFileSync(file, svg);
console.log('wrote', file);
try {
  execFileSync('rsvg-convert', ['-w', String(Math.min(W, 1800)), '-b', 'white', file, '-o', file.replace(/\.svg$/, '.png')]);
  console.log('wrote', file.replace(/\.svg$/, '.png'));
} catch (e) {
  console.log('(no rsvg-convert here, open the .svg in a browser)');
}
