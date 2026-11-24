'use strict';
// Memory: the library is listed light, one item is fetched at a time, and saving does not rebuild the bake.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert');
process.env.NF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nflazy-'));
const srv = require('../tools/learn_server');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#c98f63" d="M0 0h10v10H0z"/></svg>';
const PNG = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
const rec = (cat, group, name) => ({ key: `${cat}/ghibli/${group}/${name}`, category: cat, style: 'ghibli', group, name, svg: SVG, original: PNG, score: 95, params: {}, palette: [], w: 10, h: 10, paths: 1, savedAt: '2026-01-01' });
(async () => {
  srv.save(rec('part', 'mannequin', 'head__front')); srv.save(rec('part', 'other', 'head__back')); srv.save(rec('pose', 'g', 'wave'));
  assert.strictEqual(srv.listLibrary().length, 3);
  const light = srv.listLibrary({ meta: true });
  assert.ok(light.every((i) => !i.svg && !i.original), 'meta list carries no vector and no picture');
  assert.deepStrictEqual(srv.listLibrary({ category: 'part', style: 'ghibli', group: 'mannequin' }).map((i) => i.name), ['head__front']);
  assert.ok(!srv.listLibrary({ original: false })[0].original);
  assert.ok(srv.getItem('part/ghibli/mannequin/head__front').original);
  assert.strictEqual(srv.getItem('../etc/passwd'), null);
  const s = http.createServer(srv.handler); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  let j = await (await fetch(`${base}/api/library?meta=1&category=part&group=other`)).json();
  assert.deepStrictEqual(j.items.map((i) => i.name), ['head__back']); assert.ok(!j.items[0].svg);
  j = await (await fetch(`${base}/api/item?key=${encodeURIComponent('pose/ghibli/g/wave')}`)).json();
  assert.ok(j.ok && j.item.svg && j.item.original);
  assert.strictEqual((await fetch(`${base}/api/item?key=nope`)).status, 404);
  await new Promise((r) => s.close(r));
  // the page: no second in-memory copy, light syncing, freed buffers
  const html = fs.readFileSync(path.join(__dirname, '..', 'learn', 'index.html'), 'utf8');
  assert.ok(/syncFromServer\(scope\)/.test(html) && /meta: '1'/.test(html), 'sync asks for the light list');
  assert.ok(!/fetch\('\/api\/library'\)/.test(html), 'the page never pulls the whole library at once');
  assert.ok(/bmp\.close/.test(html) && /function trimPrep/.test(html) && /function loadSvgImg/.test(html));
  console.log('library_lazy.test.js: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
