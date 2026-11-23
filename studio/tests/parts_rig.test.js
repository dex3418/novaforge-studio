'use strict';
// Server side of the Parts tab: part pictures are saved like any approved item, the rig file sits beside them,
// bad rigs are refused, and the bake / catalog ignore parts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
process.env.NF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nfparts-'));
const srv = require('../tools/learn_server');
const R = require('../src/rig_skeleton');
const ROOT = process.env.NF_ROOT;
let n = 0;
const tests = [];
const ok = (name, fn) => tests.push([name, fn]);

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#c98f63" d="M0 0h10v10H0z"/></svg>';
const part = (name, extra) => Object.assign({ key: `part/ghibli/mannequin/${name}`, category: 'part', style: 'ghibli', group: 'mannequin', name, svg: SVG, score: 96, params: {}, palette: ['#c98f63'], w: 300, h: 330, paths: 1 }, extra);
const goodRig = () => {
  const rig = R.emptyRig('mannequin', 'ghibli');
  R.setPart(rig, { part: 'head', view: 'front', w: 300, h: 330 });
  R.setPart(rig, { part: 'torso', view: 'front', w: 360, h: 420 });
  return rig;
};

ok('a part picture is saved under library/part/<style>/<body>/ and listed in the library', () => {
  const rel = srv.save(part('head__front'));
  assert.strictEqual(rel, path.join('library', 'part', 'ghibli', 'mannequin', 'head__front.svg'));
  assert.ok(fs.existsSync(path.join(ROOT, rel)));
  const items = srv.listLibrary().filter((i) => i.category === 'part');
  assert.deepStrictEqual(items.map((i) => i.name), ['head__front']);
});
ok('the rig file is stored beside the part pictures and is not mistaken for a picture', () => {
  const out = srv.saveRig('ghibli', 'mannequin', goodRig());
  assert.strictEqual(out.path, path.join('library', 'part', 'ghibli', 'mannequin', 'rig.json'));
  assert.ok(out.warnings.length > 0, 'guessed joints are reported as warnings');
  assert.deepStrictEqual(srv.loadRig('ghibli', 'mannequin'), goodRig());
  assert.ok(!srv.listLibrary().some((i) => i.name === 'rig'));
  assert.strictEqual(srv.loadRig('ghibli', 'nobody'), null);
});
ok('a broken rig is refused and nothing is written', () => {
  const bad = goodRig(); bad.parts.head.front.joints.neck.x = 3;
  assert.throws(() => srv.saveRig('ghibli', 'other', bad), /rig rejected/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'library', 'part', 'ghibli', 'other')));
  const mismatch = goodRig();
  assert.throws(() => srv.saveRig('ghibli', 'other', mismatch), /do not match/);
  assert.throws(() => srv.saveRig('ghibli', '../escape', goodRig()), /bad body name/);
  assert.throws(() => srv.saveRig('cubist', 'mannequin', goodRig()), /unknown style/);
});
ok('the bake and the director catalog ignore parts', () => {
  const lib = require('../tools/build_characters').buildLibrary();
  assert.deepStrictEqual(Object.keys(lib.props), []); assert.deepStrictEqual(Object.keys(lib.landscapes), []);
});
ok('over HTTP: save a part, post a rig, read it back, and bad requests get a clear error', async () => {
  const s = http.createServer(srv.handler); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', body: JSON.stringify(body) }); return r.json(); };
  let j = await post('/api/save', part('torso__front'));
  assert.strictEqual(j.ok, true); assert.ok(/torso__front\.svg$/.test(j.path));
  j = await post('/api/rig', { style: 'ghibli', body: 'mannequin', rig: goodRig() });
  assert.strictEqual(j.ok, true); assert.ok(/rig\.json$/.test(j.path));
  j = await (await fetch(`${base}/api/rig?style=ghibli&body=mannequin`)).json();
  assert.strictEqual(j.ok, true); assert.deepStrictEqual(j.rig, goodRig());
  j = await (await fetch(`${base}/api/rig?style=ghibli&body=nobody`)).json();
  assert.strictEqual(j.ok, true); assert.strictEqual(j.rig, null);
  j = await post('/api/rig', { style: 'ghibli', body: 'mannequin', rig: { format: 'nope' } });
  assert.strictEqual(j.ok, false); assert.ok(/rig rejected/.test(j.error));
  j = await (await fetch(`${base}/api/rig?style=ghibli&body=../x`)).json();
  assert.strictEqual(j.ok, false);
  await new Promise((r) => s.close(r));
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; }
  console.log(`parts_rig.test.js: ${n} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
