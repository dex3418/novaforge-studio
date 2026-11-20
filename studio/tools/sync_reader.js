'use strict';
// Copies learn/sheet_reader.js into learn/index.html between the SHEET_READER markers.
// The Learning Studio server serves only index.html, so the page carries its own copy.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'learn');
const src = fs.readFileSync(path.join(dir, 'sheet_reader.js'), 'utf8').replace(/\n$/, '');
const f = path.join(dir, 'index.html');
const html = fs.readFileSync(f, 'utf8');
const re = /\/\*SHEET_READER_BEGIN\*\/\n[\s\S]*?\n\/\*SHEET_READER_END\*\//;
if (!re.test(html)) throw new Error('markers not found in index.html');
fs.writeFileSync(f, html.replace(re, () => '/*SHEET_READER_BEGIN*/\n' + src + '\n/*SHEET_READER_END*/'));
console.log('index.html now carries the current sheet_reader.js');
