'use strict';
// Publisher: stages only characters/ and library/, pushes to the remote, and the server's catalog follows a save.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-'));
const remote = path.join(tmp, 'remote.git');
const work = path.join(tmp, 'work');
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
g(tmp, 'init', '--bare', '-b', 'main', remote);
fs.mkdirSync(work);
g(work, 'init', '-b', 'main');
g(work, 'config', 'user.email', 't@t'); g(work, 'config', 'user.name', 't');
fs.writeFileSync(path.join(work, 'README'), 'x');
fs.mkdirSync(path.join(work, 'src')); fs.writeFileSync(path.join(work, 'src', 'baked.js'), 'a');
g(work, 'add', '.'); g(work, 'commit', '-m', 'init');
g(work, 'remote', 'add', 'origin', remote); g(work, 'push', '-u', 'origin', 'main');
process.env.NF_ROOT = work;
const { publish } = require('../tools/publisher');
const { save, catalog, afterChange } = require('../tools/learn_server');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#336699" d="M0 0 L10 0 L10 10 L0 10 Z"/></svg>';
let n = 0;
const ok = async (name, fn) => { await fn(); n++; };

(async () => {
  await ok('nothing to publish is not an error and makes no commit', async () => {
    const r = await publish(work, 'm');
    assert.deepStrictEqual(r, { ok: true, committed: false, pushed: false });
  });
  await ok('only characters/ and library/ are committed; other edits stay out', async () => {
    save({ category: 'prop', style: 'ghibli', group: 'office', name: 'chair', svg, score: 90, paths: 1, w: 10, h: 10, palette: [], params: {} });
    fs.writeFileSync(path.join(work, 'src', 'baked.js'), 'half-finished edit');
    const r = await publish(work, 'Learning Studio: add office/chair');
    assert.strictEqual(r.ok, true, r.error); assert.strictEqual(r.pushed, true);
    const files = g(work, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n');
    assert.ok(files.length && files.every((f) => /^(characters|library)\//.test(f)), files.join());
    assert.ok(g(work, 'status', '--porcelain').includes('src/baked.js'), 'unrelated edit still uncommitted');
    assert.strictEqual(g(remote, 'log', '--format=%s', '-1').trim(), 'Learning Studio: add office/chair');
  });
  await ok('a failing push reports the error and keeps the commit', async () => {
    save({ category: 'prop', style: 'ghibli', group: 'office', name: 'desk', svg, score: 90, paths: 1, w: 10, h: 10, palette: [], params: {} });
    g(work, 'remote', 'set-url', 'origin', path.join(tmp, 'missing.git'));
    const r = await publish(work, 'm2');
    assert.strictEqual(r.ok, false); assert.strictEqual(r.committed, true); assert.strictEqual(r.pushed, false); assert.ok(r.error);
    g(work, 'remote', 'set-url', 'origin', remote);
  });
  await ok('not a git repo is reported', async () => {
    const r = await publish(tmp, 'm');
    assert.strictEqual(r.ok, false);
  });
  await ok('auto-publish is off by default: afterChange refreshes only', async () => {
    const r = await afterChange('x');
    assert.strictEqual(r.ok, true); assert.strictEqual(r.published, false);
  });
  await ok('catalog reflects a newly saved landscape without any bake step', async () => {
    save({ category: 'landscape', style: 'ghibli', group: 'park', name: 'scene_1', svg, score: 90, paths: 1, w: 10, h: 10, palette: [], params: {} });
    await afterChange('park');
    const c = catalog();
    assert.ok(c.settings.learned.some((s) => s.name === 'park'), JSON.stringify(c.settings.learned));
  });
  console.log(`publisher.test.js: ${n}/${n} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
