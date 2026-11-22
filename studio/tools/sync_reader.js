'use strict';
// Copies learn/sheet_reader.js and learn/crop_editor.js into learn/index.html between their markers.
// The Learning Studio server serves only index.html, so the page carries its own copies.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'learn');
const f = path.join(dir, 'index.html');
let html = fs.readFileSync(f, 'utf8');
for (const [file, tag] of [['sheet_reader.js', 'SHEET_READER'], ['crop_editor.js', 'CROP_EDITOR']]) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\n$/, '');
  const re = new RegExp('\\/\\*' + tag + '_BEGIN\\*\\/\\n[\\s\\S]*?\\n\\/\\*' + tag + '_END\\*\\/');
  if (!re.test(html)) throw new Error(tag + ' markers not found in index.html');
  html = html.replace(re, () => '/*' + tag + '_BEGIN*/\n' + src + '\n/*' + tag + '_END*/');
}
fs.writeFileSync(f, html);
console.log('index.html now carries the current sheet_reader.js and crop_editor.js');
