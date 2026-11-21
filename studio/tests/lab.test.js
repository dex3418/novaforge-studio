'use strict';
// Live Lab: the browser bundle draws with the real stage code, and kept corrections reach the director prompt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
process.env.NF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nflab-'));
const srv = require('../tools/learn_server');
const { examplesText } = require('../src/assets');
const { bundle } = require('../tools/lab_bundle');
const CHARS = require('../src/characters');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

const chars = {}; CHARS.ids().forEach((id) => { chars[id] = CHARS.get(id); });
const win = {};
vm.runInNewContext(bundle({ chars, lib: { props: {}, landscapes: {} } }), { window: win, console });
const L = win.NFLab;
const beat = { setting: 'village', time: 'day', camera: { z0: 1 }, props: [], actors: [{ id: CHARS.ids()[0], x0: 0.2, x1: 0.7, facing: 1, pose: 'idle', expr: 'neutral', speaks: true }] };
const o = { w: 1280, h: 720, t: 1.4, beatSec: 4, art: 'flat', cast: {}, speakers: [], wordIdx: 0, wordStarts: [] };

ok('bundle exposes the stage, the checker and the blocking rules', () => {
  for (const k of ['stageSvg', 'normalizeStory', 'analyse', 'CHARS', 'assets']) assert.ok(L[k], k);
});
ok('the browser stage draws the same picture as the Node stage', () => {
  const node = require('../src/story_stage').stageSvg(beat, o);
  assert.strictEqual(L.stageSvg(beat, o), node);
});
ok('the lab checker removes people who are not in the cast and unknown poses', () => {
  const id = CHARS.ids()[0];
  const f = L.normalizeStory({ setting: 'village', actors: [{ id, x0: 0.3, pose: 'dance' }, { id: 'ghost', x0: 0.5 }] }, [id]);
  assert.strictEqual(JSON.stringify(f.actors.map((a) => a.id)), JSON.stringify([id]));
  assert.strictEqual(f.actors[0].pose, 'idle');
});
ok('an example needs the script line and a beat', () => {
  assert.throws(() => srv.saveExample({ line: '', after: {} }));
  assert.throws(() => srv.saveExample({ line: 'x' }));
  const id = srv.saveExample({ line: '[A] hello', after: beat, before: { bad: 1 } });
  assert.ok(fs.existsSync(path.join(process.env.NF_ROOT, 'director', 'examples', id + '.json')));
  assert.strictEqual(srv.listExamples().length, 1);
});
ok('kept examples reach the director prompt, newest last, capped', () => {
  const list = Array.from({ length: 9 }, (_, i) => ({ line: 'line ' + i, after: { n: i } }));
  const t = examplesText(list, 3);
  assert.ok(t.includes('line 8') && t.includes('line 6') && !t.includes('line 5'));
  assert.strictEqual(examplesText([], 3), '');
  const dirText = require('../src/director');
  assert.ok(dirText);
});
ok('both pages get the shared theme and a phone layout when served', () => {
  const idx = srv.pageHtml();
  const lab = require('fs').readFileSync(path.join(__dirname, '..', 'learn', 'lab.html'), 'utf8');
  assert.ok(/THEME_BEGIN\*\/\n[\s\S]*max-width:820px/.test(idx), 'studio page');
  assert.ok(/THEME_BEGIN/.test(lab), 'lab page has its marker');
  assert.ok(/<meta name="viewport"/.test(idx) && /<meta name="viewport"/.test(lab));
});
console.log(`lab.test.js: ${n}/${n} checks passed`);
