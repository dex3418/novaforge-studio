'use strict';
// Local save server for the Learning Studio page (no dependencies).
//   cd studio && npm run learn        then open http://localhost:8787 in the phone browser
// It serves studio/learn/index.html and writes approved ("Accurate") vectors straight into the repo folder, so
// learning never needs a git push. Only 127.0.0.1 can reach it.
//   character  -> characters/<id>/learned/<style>/<name>.svg (+ .json, .original.png, learned.json index)
//   everything else -> library/<category>/<style>/<group>/<name>.svg (+ .json, .original.png)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.NF_ROOT || path.join(__dirname, '..', '..');
const PAGE = path.join(__dirname, '..', 'learn', 'index.html');
const READER = path.join(__dirname, '..', 'learn', 'sheet_reader.js');
// The page carries its own copy of sheet_reader.js (so it also works opened from a file). Every time the server hands the
// page out it swaps in the current sheet_reader.js, so the copy can never be stale: nobody has to run a sync step.
const THEME = path.join(__dirname, '..', 'learn', 'theme.css');
// the shared look (theme.css) is pasted into every page as it is served, so both pages always match and nothing needs syncing
function withTheme(html) {
  let css = '';
  try { css = fs.readFileSync(THEME, 'utf8'); } catch (e) { return html; }
  return html.replace(/\/\*THEME_BEGIN\*\/[\s\S]*?\/\*THEME_END\*\//, () => '/*THEME_BEGIN*/\n' + css + '\n/*THEME_END*/');
}
const CROP = path.join(__dirname, '..', 'learn', 'crop_editor.js');
function swapIn(html, file, tag) {
  let src;
  try { src = fs.readFileSync(file, 'utf8').replace(/\n$/, ''); } catch (e) { return html; }
  return html.replace(new RegExp('\\/\\*' + tag + '_BEGIN\\*\\/\\n[\\s\\S]*?\\n\\/\\*' + tag + '_END\\*\\/'), () => '/*' + tag + '_BEGIN*/\n' + src + '\n/*' + tag + '_END*/');
}
function pageHtml() {
  const html = withTheme(fs.readFileSync(PAGE, 'utf8'));
  return swapIn(swapIn(html, READER, 'SHEET_READER'), CROP, 'CROP_EDITOR');
}
const PORT = Number(process.env.PORT) || 8787;
const AUTO_PUBLISH = process.env.NF_AUTOPUBLISH === '1';
const PUB = require('./publisher');
const ASSETS = require('../src/assets');

// The server keeps the baked state fresh in memory (nothing is written to characters_data.js / library_data.js),
// so the catalog is right the moment an item is approved. The real bake still happens in CI / npm run characters.
let baked = null;
function refresh() {
  const B = require('./build_characters');
  const chars = B.buildAll();
  const lib = B.buildLibrary();
  baked = { chars, lib };
  return baked;
}
function catalog() {
  const b = baked || refresh();
  return ASSETS.catalogFrom({ chars: b.chars, lib: b.lib });
}
const LAB_PAGE = path.join(__dirname, '..', 'learn', 'lab.html');
let labJs = null, labFor = null;
function labBundle() {
  const b = baked || refresh();
  if (labFor !== b) { labJs = require('./lab_bundle').bundle(b); labFor = b; }
  return labJs;
}
// corrections kept from the Live Lab: director/examples/<id>.json, read by src/director.js
const EX_DIR = () => path.join(ROOT, 'director', 'examples');
function saveExample(rec) {
  if (!rec || typeof rec.line !== 'string' || !rec.line.trim() || !rec.after || typeof rec.after !== 'object') throw new Error('an example needs the script line and the corrected beat');
  fs.mkdirSync(EX_DIR(), { recursive: true });
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
  const out = { line: rec.line.trim().slice(0, 400), after: rec.after, ...(rec.before ? { before: rec.before } : {}), ...(rec.note ? { note: String(rec.note).slice(0, 300) } : {}), savedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(EX_DIR(), id + '.json'), JSON.stringify(out, null, 1));
  return id;
}
function listExamples() {
  try { return fs.readdirSync(EX_DIR()).filter((f) => f.endsWith('.json')).sort().map((f) => Object.assign({ id: f.slice(0, -5) }, JSON.parse(fs.readFileSync(path.join(EX_DIR(), f), 'utf8')))); } catch (e) { return []; }
}
let pending = Promise.resolve();
function afterChange(what, opt) {
  try { if (!opt || opt.refresh !== false) refresh(); } catch (e) { return Promise.resolve({ ok: false, error: 'refresh failed: ' + e.message }); }
  if (!AUTO_PUBLISH) return Promise.resolve({ ok: true, published: false });
  pending = pending.then(() => PUB.publish(ROOT, `Learning Studio: ${what}`)).catch((e) => ({ ok: false, error: e.message }));
  return pending.then((r) => Object.assign({ published: !!r.pushed }, r));
}
const CATS = ['character', 'emotion', 'pose', 'prop', 'landscape'];
const STYLES = ['ghibli', 'webtoon'];
const safe = (s) => /^[a-z0-9_-]{1,40}$/.test(String(s || ''));

function targetDir(rec) {
  if (!CATS.includes(rec.category)) throw new Error('unknown category');
  if (!STYLES.includes(rec.style)) throw new Error('unknown style');
  if (!safe(rec.group)) throw new Error('bad group name');
  if (!safe(rec.name)) throw new Error('bad item name');
  if (typeof rec.svg !== 'string' || !/^<svg[\s>]/.test(rec.svg)) throw new Error('not an svg');
  return rec.category === 'character'
    ? path.join(ROOT, 'characters', rec.group, 'learned', rec.style)
    : path.join(ROOT, 'library', rec.category, rec.style, rec.group);
}

function save(rec) {
  const dir = targetDir(rec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, rec.name + '.svg'), rec.svg);
  const meta = Object.assign({}, rec);
  delete meta.svg; delete meta.original;
  fs.writeFileSync(path.join(dir, rec.name + '.json'), JSON.stringify(meta, null, 1));
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(rec.original || '');
  if (m) fs.writeFileSync(path.join(dir, rec.name + '.original.png'), Buffer.from(m[1], 'base64'));
  // one index per folder so later code can see what was learned without scanning
  const idxFile = path.join(dir, 'learned.json');
  let idx = {};
  try { idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (e) { idx = {}; }
  idx[rec.name] = { score: meta.score, paths: meta.paths, w: meta.w, h: meta.h, palette: meta.palette, params: meta.params, savedAt: meta.savedAt };
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
  return path.relative(ROOT, path.join(dir, rec.name + '.svg'));
}

// every approved item on disk, with its vector, settings and the picture it was learned from
function listLibrary() {
  const out = [];
  const add = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.json') || f === 'learned.json' || f === 'config.json') continue;
      const base = path.join(dir, f.slice(0, -5));
      if (!fs.existsSync(base + '.svg')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (!CATS.includes(meta.category) || !STYLES.includes(meta.style) || !safe(meta.group) || !safe(meta.name)) continue;
        meta.svg = fs.readFileSync(base + '.svg', 'utf8');
        if (fs.existsSync(base + '.original.png')) meta.original = 'data:image/png;base64,' + fs.readFileSync(base + '.original.png').toString('base64');
        out.push(meta);
      } catch (e) { /* skip unreadable item */ }
    }
  };
  const cd = path.join(ROOT, 'characters');
  if (fs.existsSync(cd)) for (const id of fs.readdirSync(cd)) for (const st of STYLES) add(path.join(cd, id, 'learned', st));
  for (const c of CATS.filter((x) => x !== 'character')) for (const st of STYLES) {
    const d = path.join(ROOT, 'library', c, st);
    if (fs.existsSync(d)) for (const g of fs.readdirSync(d)) add(path.join(d, g));
  }
  return out;
}
function remove(rec) {
  const dir = targetDir(Object.assign({}, rec, { svg: '<svg>' }));
  for (const ext of ['.svg', '.json', '.original.png']) { try { fs.unlinkSync(path.join(dir, rec.name + ext)); } catch (e) { /* already gone */ } }
  const idxFile = path.join(dir, 'learned.json');
  try { const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); delete idx[rec.name]; fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1)); } catch (e) { /* no index */ }
  return true;
}

function handler(req, res) {
  const send = (code, body, type) => { res.writeHead(code, { 'content-type': type || 'application/json', 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) return send(200, pageHtml(), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url === '/api/ping') return send(200, { ok: true, root: path.basename(ROOT) });
  if (req.method === 'GET' && url === '/lab') { try { return send(200, withTheme(fs.readFileSync(LAB_PAGE, 'utf8')), 'text/html; charset=utf-8'); } catch (e) { return send(404, { ok: false, error: 'lab page missing' }); } }
  if (req.method === 'GET' && url === '/lab/stage.js') { try { return send(200, labBundle(), 'application/javascript; charset=utf-8'); } catch (e) { return send(500, '/* ' + e.message + ' */', 'application/javascript'); } }
  if (req.method === 'GET' && url === '/api/lab/examples') return send(200, { ok: true, items: listExamples() });
  if (req.method === 'POST' && url === '/api/lab/example') {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { const id = saveExample(JSON.parse(Buffer.concat(chunks).toString('utf8'))); afterChange('director example', { refresh: false }).then((r) => send(200, { ok: true, id, published: !!r.published })); } catch (e) { send(400, { ok: false, error: e.message }); } });
    return undefined;
  }
  if (req.method === 'GET' && url === '/api/catalog') { try { return send(200, { ok: true, autoPublish: AUTO_PUBLISH, catalog: catalog() }); } catch (e) { return send(500, { ok: false, error: e.message }); } }
  if (req.method === 'POST' && url === '/api/publish') { PUB.publish(ROOT, 'Learning Studio: publish library').then((r) => send(200, r)); return undefined; }
  if (req.method === 'GET' && url === '/api/library') return send(200, { ok: true, items: listLibrary() });
  if (req.method === 'POST' && url === '/api/delete') {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { const rec = JSON.parse(Buffer.concat(chunks).toString('utf8')); remove(rec); afterChange(`remove ${rec.group}/${rec.name}`).then((r) => send(200, Object.assign({ ok: true }, r, { ok: r.ok !== false }))); } catch (e) { send(400, { ok: false, error: e.message }); } });
    return undefined;
  }
  if (req.method === 'POST' && url === '/api/save') {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 8e6) { send(413, { ok: false, error: 'too large' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { const rec = JSON.parse(Buffer.concat(chunks).toString('utf8')); const p = save(rec); afterChange(`add ${rec.group}/${rec.name}`).then((r) => send(200, Object.assign({}, r, { ok: true, path: p, publishError: r.ok === false ? r.error : undefined }))); }
      catch (e) { send(400, { ok: false, error: e.message }); }
    });
    return undefined;
  }
  return send(404, { ok: false, error: 'not found' });
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, '127.0.0.1', () => {
    console.log(`Learning Studio: http://localhost:${PORT}   Live Lab: http://localhost:${PORT}/lab`);
    console.log(AUTO_PUBLISH ? 'Auto-publish is ON: approved items are committed and pushed.' : 'Auto-publish is off (start with NF_AUTOPUBLISH=1 to commit and push after every approval).');
    console.log('Approved vectors are written into this repo (characters/ and library/). Stop with Ctrl+C.');
  });
}
module.exports = { saveExample, listExamples, labBundle, catalog, refresh, afterChange, save, targetDir, handler, listLibrary, remove, pageHtml };
