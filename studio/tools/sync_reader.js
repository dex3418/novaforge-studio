'use strict';
// Copies learn/sheet_reader.js, learn/crop_editor.js, src/rig_skeleton.js and learn/parts_editor.js into learn/index.html between their markers.
// The Learning Studio server serves only index.html, so the page carries its own copies.
const fs = require('fs');
const path = require('path');
const studio = path.join(__dirname, '..');
const f = path.join(studio, 'learn', 'index.html');
const EMBEDS = [['learn/sheet_reader.js', 'SHEET_READER'], ['learn/crop_editor.js', 'CROP_EDITOR'], ['src/rig_skeleton.js', 'RIG_SKELETON'], ['learn/parts_editor.js', 'PARTS_EDITOR']];
let html = fs.readFileSync(f, 'utf8');
for (const [file, tag] of EMBEDS) {
  const src = fs.readFileSync(path.join(studio, file), 'utf8').replace(/\n$/, '');
  const re = new RegExp('\\/\\*' + tag + '_BEGIN\\*\\/\\n[\\s\\S]*?\\n?\\/\\*' + tag + '_END\\*\\/');
  if (!re.test(html)) throw new Error(tag + ' markers not found in index.html');
  html = html.replace(re, () => '/*' + tag + '_BEGIN*/\n' + src + '\n/*' + tag + '_END*/');
}
fs.writeFileSync(f, html);
console.log('index.html now carries the current ' + EMBEDS.map((e) => path.basename(e[0])).join(', '));
