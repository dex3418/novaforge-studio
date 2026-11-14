'use strict';
// Local "box" for Novaforge Studio. Run it in Termux, open http://localhost:8787
//   - paste a script, pick carousel / reel / youtube, press Start
//   - it triggers the GitHub Actions workflow (no git push needed)
//   - shows recent runs and a Download button when a run is finished
//
// Needs Node 18+ and a GitHub token in ~/.novaforge-studio.env:
//   GITHUB_TOKEN=github_pat_...
// Optional: GITHUB_REPO=dex3418/novaforge-studio  PORT=8787
// The token never leaves this server and is never sent to the page.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadEnv() {
  const f = process.env.NF_ENV || path.join(os.homedir(), '.novaforge-studio.env');
  try {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (e) {
    /* no env file yet */
  }
}
loadEnv();

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || 'dex3418/novaforge-studio';
const REF = process.env.GITHUB_REF_NAME || 'main';
const API = process.env.GITHUB_API || 'https://api.github.com';
const PORT = Number(process.env.PORT || 8787);
const WORKFLOW = 'studio.yml';
const FORMATS = ['carousel', 'reel', 'long'];
const CAT = require(path.join(__dirname, '..', 'studio', 'src', 'catalog.js'));
const ENGINES = ['edge', 'gemini'];
const FB = require('./feedback');
const ALL_VOICES = [...CAT.VOICES.edge, ...CAT.VOICES.gemini].map((v) => v.id);
const choice = (v, list) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : '');

function gh(p, opts = {}) {
  return fetch(API + p, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nf-studio-box',
      ...(opts.headers || {}),
    },
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 200000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error('Script is too long'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Puts the box fields into the script's header. Anything filled in on the page
// wins over the same line in the pasted script; empty fields leave the script alone.
function withMeta(text, meta) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  let head = m ? m[1].split(/\r?\n/) : [];
  const rest = m ? text.slice(m[0].length) : text;
  for (const k of ['voice', 'brand', 'handle', 'cta', 'engine', 'template', 'palette', 'texture', 'director', 'captions', 'note', 'picture', 'person', 'role']) {
    const v = String(meta[k] || '').replace(/[\r\n]+/g, ' ').trim().slice(0, k === 'note' || k === 'picture' ? 400 : 120);
    if (!v) continue;
    head = head.filter((l) => !new RegExp('^\\s*' + k + '\\s*:', 'i').test(l));
    head.push(`${k}: ${v}`);
  }
  return `---\n${head.join('\n')}\n---\n${rest}`;
}

function safeName(s) {
  const n = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return n || 'post-' + Math.floor(Date.now() / 1000);
}

// Sends one script to GitHub. `b` is what the page sends; `extra.note` is a "redo" request.
async function dispatch(b, extra = {}) {
  const text = String(b.text || '').trim();
  if (!text) return { code: 400, error: 'Paste a script first.' };
  if (text.length > 56000) return { code: 400, error: 'Script is too long (limit about 56,000 characters).' };
  const only = (Array.isArray(b.only) ? b.only : []).filter((x) => FORMATS.includes(x));
  if (!only.length) return { code: 400, error: 'Pick at least one output.' };
  const engine = choice(b.engine, ENGINES) || 'edge';
  const voice = ALL_VOICES.includes(b.voice) ? b.voice : '';
  const template = choice(b.template, Object.keys(CAT.TEMPLATES));
  const palette = choice(b.palette, Object.keys(CAT.PALETTES));
  const texture = choice(b.texture, Object.keys(CAT.TEXTURES));
  const director = choice(b.director, ['ai', 'rules']) || 'ai';
  const captions = choice(b.captions, ['smart', 'always']) || 'smart';
  const name = safeName(extra.name || b.name);

  const r = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: REF,
      inputs: {
        script_text: withMeta(text, { voice, engine, template, palette, texture, director, captions, brand: b.brand, handle: b.handle, cta: b.cta, note: extra.note, picture: b.picture, person: b.person, role: b.role }),
        script_name: name,
        only: only.join(','),
        calibration: FB.compact(),
      },
    }),
  });
  if (r.status === 204) {
    FB.recordDispatch({ name, body: { text, only, engine, voice, template, palette, texture, director, captions, brand: b.brand || '', handle: b.handle || '', cta: b.cta || '', picture: b.picture || '', person: b.person || '', role: b.role || '' } });
    return { code: 200, ok: true, name };
  }
  let msg = '';
  try {
    msg = (await r.json()).message || '';
  } catch (e) {
    /* ignore */
  }
  const hint =
    r.status === 401 || r.status === 403
      ? ' (check the token: it needs Actions read & write on the repo)'
      : r.status === 404
      ? ' (repo or workflow not found: check the repo name and that studio.yml is pushed)'
      : r.status === 422
      ? ' (the workflow on GitHub may be out of date: push update v8 first)'
      : '';
  return { code: 502, error: `GitHub said ${r.status}: ${msg}${hint}` };
}

async function start(req, res) {
  if (!TOKEN) return send(res, 400, { error: 'No GitHub token set. See the setup note on the page.' });
  let b;
  try {
    b = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, { error: 'Bad request: ' + e.message });
  }
  const r = await dispatch(b);
  send(res, r.code, r.error ? { error: r.error } : { ok: true, name: r.name });
}

// the plan of a finished run (from its report bundle), turned into "what it looked like"
async function runFacts(runId) {
  const a = await gh(`/repos/${REPO}/actions/runs/${runId}/artifacts`);
  if (!a.ok) throw new Error(`GitHub said ${a.status}`);
  const art = ((await a.json()).artifacts || []).find((x) => !x.expired && x.name === 'studio-report');
  if (!art) throw new Error('report bundle not found (expired?)');
  const z = await gh(`/repos/${REPO}/actions/artifacts/${art.id}/zip`, { redirect: 'manual' });
  const loc = z.headers.get('location');
  if (!loc) throw new Error(`GitHub said ${z.status}`);
  const buf = Buffer.from(await (await fetch(loc)).arrayBuffer());
  const raw = FB.zipEntry(buf, (n) => /-plan\.json$/.test(n));
  if (!raw) throw new Error('no plan in the report bundle');
  return FB.factsFromPlan(JSON.parse(raw.toString('utf8')));
}

async function readJsonBody(req, res) {
  try {
    return JSON.parse(await readBody(req, 60000));
  } catch (e) {
    send(res, 400, { error: 'Bad request: ' + e.message });
    return null;
  }
}

async function rate(req, res) {
  const b = await readJsonBody(req, res);
  if (!b) return;
  const id = String(b.runId || '');
  if (!/^\d+$/.test(id)) return send(res, 400, { error: 'bad run id' });
  if (b.rating === 'none') {
    FB.removeRating(id);
    return send(res, 200, { ok: true });
  }
  if (!FB.RATINGS.includes(b.rating)) return send(res, 400, { error: 'bad rating' });
  let facts = null;
  let warn = '';
  const known = FB.loadRatings()[id];
  if (known && known.facts) facts = known.facts;
  else {
    try {
      facts = await runFacts(id);
    } catch (e) {
      warn = `Saved, but I could not read what the video looked like (${e.message}), so it teaches the calibration nothing yet. Rate it again once the report is available.`;
    }
  }
  FB.setRating(id, b.rating, { title: String(b.title || '').slice(0, 80), facts });
  send(res, 200, { ok: true, warn });
}

async function comment(req, res) {
  const b = await readJsonBody(req, res);
  if (!b) return;
  try {
    FB.addComment(String(b.runId || ''), String(b.title || '').slice(0, 80), b.text);
    send(res, 200, { ok: true });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}

// run the same script again, with the comment as a request to the AI director
async function redo(req, res) {
  if (!TOKEN) return send(res, 400, { error: 'No GitHub token set.' });
  const b = await readJsonBody(req, res);
  if (!b) return;
  const note = String(b.note || '').replace(/\s+/g, ' ').trim();
  if (!note) return send(res, 400, { error: 'Write what to change first.' });
  const d = FB.findDispatch(b.title, b.created);
  if (!d) return send(res, 404, { error: 'I no longer have that script (the box keeps the last 15 you sent from this phone). Paste it again and add the note.' });
  FB.addComment(String(b.runId || ''), String(b.title || '').slice(0, 80), note);
  const base = d.name.replace(/-redo\d*$/, '');
  const r = await dispatch(d.body, { note, name: `${base}-redo` });
  send(res, r.code, r.error ? { error: r.error } : { ok: true, name: r.name });
}

async function runs(res) {
  if (!TOKEN) return send(res, 200, { runs: [] });
  const r = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=8`);
  if (!r.ok) return send(res, 502, { error: `GitHub said ${r.status}` });
  const j = await r.json();
  send(res, 200, {
    runs: (j.workflow_runs || []).map((x) => ({
      id: x.id,
      title: x.display_title || x.name,
      status: x.status,
      conclusion: x.conclusion,
      created: x.created_at,
      url: x.html_url,
    })),
  });
}

async function download(id, res, name = 'studio-output') {
  if (!/^\d+$/.test(id)) return send(res, 400, { error: 'bad id' });
  const a = await gh(`/repos/${REPO}/actions/runs/${id}/artifacts`);
  if (!a.ok) return send(res, 502, { error: `GitHub said ${a.status}` });
  const art = ((await a.json()).artifacts || []).find((x) => !x.expired && x.name === name);
  if (!art) return send(res, 404, { error: 'No files for this run (expired or the run failed).' });
  const z = await gh(`/repos/${REPO}/actions/artifacts/${art.id}/zip`, { redirect: 'manual' });
  const loc = z.headers.get('location');
  if (!loc) return send(res, 502, { error: `GitHub said ${z.status}` });
  res.writeHead(302, { Location: loc });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, {
        hasToken: !!TOKEN, repo: REPO,
        voices: CAT.VOICES,
        templates: Object.entries(CAT.TEMPLATES).map(([id, t]) => ({ id, label: t.label })),
        palettes: Object.entries(CAT.PALETTES).map(([id, p]) => ({ id, label: p.label })),
        textures: Object.entries(CAT.TEXTURES).map(([id, label]) => ({ id, label })),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') return await runs(res);
    if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
      return await download(url.pathname.split('/').pop(), res);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/report/')) {
      return await download(url.pathname.split('/').pop(), res, 'studio-report');
    }
    if (req.method === 'GET' && url.pathname === '/api/feedback') {
      const rt = FB.loadRatings();
      const sc = FB.scores(rt);
      return send(res, 200, {
        ratings: Object.fromEntries(Object.entries(rt).map(([k, v]) => [k, v.rating])),
        comments: Object.fromEntries(Object.entries(FB.loadComments()).map(([k, v]) => [k, v.text])),
        n: sc.n, notes: FB.loadNotes(), dir: FB.DIR,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/calibration') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', ...(url.searchParams.get('dl') ? { 'Content-Disposition': 'attachment; filename="calibration.md"' } : {}) });
      return res.end(FB.readCalibration());
    }
    if (req.method === 'POST' && ['/api/rate', '/api/comment', '/api/redo', '/api/notes', '/api/reset'].includes(url.pathname)) {
      if (req.headers['x-nf-box'] !== '1') return send(res, 403, { error: 'forbidden' });
      if (url.pathname === '/api/rate') return await rate(req, res);
      if (url.pathname === '/api/comment') return await comment(req, res);
      if (url.pathname === '/api/redo') return await redo(req, res);
      if (url.pathname === '/api/notes') {
        const b = await readJsonBody(req, res);
        if (!b) return;
        FB.saveNotes(b.text);
        return send(res, 200, { ok: true });
      }
      FB.reset();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      if (req.headers['x-nf-box'] !== '1') return send(res, 403, { error: 'forbidden' });
      return await start(req, res);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Novaforge Studio box: http://localhost:${PORT}`);
  console.log(TOKEN ? `Repo: ${REPO}` : 'No GITHUB_TOKEN found in ~/.novaforge-studio.env (see setup).');
});
