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
const PORT = Number(process.env.PORT) || 8787;
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
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) return send(200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url === '/api/ping') return send(200, { ok: true, root: path.basename(ROOT) });
  if (req.method === 'GET' && url === '/api/library') return send(200, { ok: true, items: listLibrary() });
  if (req.method === 'POST' && url === '/api/delete') {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { send(200, { ok: remove(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); } catch (e) { send(400, { ok: false, error: e.message }); } });
    return undefined;
  }
  if (req.method === 'POST' && url === '/api/save') {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 8e6) { send(413, { ok: false, error: 'too large' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { send(200, { ok: true, path: save(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); }
      catch (e) { send(400, { ok: false, error: e.message }); }
    });
    return undefined;
  }
  return send(404, { ok: false, error: 'not found' });
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, '127.0.0.1', () => {
    console.log(`Learning Studio: http://localhost:${PORT}`);
    console.log('Approved vectors are written into this repo (characters/ and library/). Stop with Ctrl+C.');
  });
}
module.exports = { save, targetDir, handler, listLibrary, remove };
