'use strict';
// Learning Studio save server: only safe names, only svgs, files land in the right folders.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.env.NF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-'));
const { save, targetDir } = require('../tools/learn_server');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L5 5Z"/></svg>';
const png = 'data:image/png;base64,iVBORw0KGgo=';
let n = 0;
const ok = (name, fn) => { fn(); n++; };

ok('character goes to characters/<id>/learned/<style>', () => {
  const p = save({ category: 'character', style: 'ghibli', group: 'naina', name: 'front', svg, score: 97.1, paths: 3, w: 10, h: 10, palette: ['#000000'], params: { colors: 8 }, original: png });
  assert.strictEqual(p, path.join('characters', 'naina', 'learned', 'ghibli', 'front.svg'));
  const dir = path.join(process.env.NF_ROOT, 'characters', 'naina', 'learned', 'ghibli');
  for (const f of ['front.svg', 'front.json', 'front.original.png', 'learned.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'learned.json'), 'utf8')).front.score, 97.1);
});
ok('second angle is added to the same index', () => {
  save({ category: 'character', style: 'ghibli', group: 'naina', name: 'back', svg, score: 95, paths: 1, w: 1, h: 1, palette: [], params: {} });
  const idx = JSON.parse(fs.readFileSync(path.join(process.env.NF_ROOT, 'characters', 'naina', 'learned', 'ghibli', 'learned.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(idx).sort(), ['back', 'front']);
});
ok('props go to library/<category>/<style>/<group>', () => {
  const p = save({ category: 'prop', style: 'webtoon', group: 'office', name: 'chair', svg, score: 90, paths: 1, w: 1, h: 1, palette: [], params: {} });
  assert.strictEqual(p, path.join('library', 'prop', 'webtoon', 'office', 'chair.svg'));
});
ok('path tricks and non-svg content are refused', () => {
  for (const bad of [{ group: '../x' }, { name: '../../etc' }, { name: 'a b' }, { category: 'nope' }, { style: 'anime' }, { svg: '<html></html>' }, { group: '' }]) {
    assert.throws(() => targetDir(Object.assign({ category: 'pose', style: 'ghibli', group: 'g', name: 'n', svg }, bad)), bad.toString());
  }
});
ok('library listing returns saved items with svg and original, so the page can reopen them', () => {
  const { listLibrary } = require('../tools/learn_server');
  const all = listLibrary();
  const front = all.find((r) => r.group === 'naina' && r.name === 'front');
  assert.ok(front && /^<svg/.test(front.svg) && /^data:image\/png/.test(front.original), 'character front');
  assert.ok(all.some((r) => r.category === 'prop' && r.name === 'chair'), 'prop listed');
  assert.ok(!all.some((r) => r.name === 'learned'), 'index file is not an item');
});
ok('remove deletes files and the index entry', () => {
  const { remove, listLibrary } = require('../tools/learn_server');
  remove({ category: 'prop', style: 'webtoon', group: 'office', name: 'chair' });
  assert.ok(!listLibrary().some((r) => r.name === 'chair'));
  remove({ category: 'character', style: 'ghibli', group: 'naina', name: 'back' });
  const idx = JSON.parse(fs.readFileSync(path.join(process.env.NF_ROOT, 'characters', 'naina', 'learned', 'ghibli', 'learned.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(idx), ['front']);
});
console.log(`learn_server.test.js: ${n}/${n} checks passed`);
