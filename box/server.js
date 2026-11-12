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
const VOICES = ['en-IN-NeerjaNeural', 'en-IN-PrabhatNeural', 'hi-IN-SwaraNeural', 'hi-IN-MadhurNeural'];

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
  for (const k of ['voice', 'brand', 'handle', 'cta']) {
    const v = String(meta[k] || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
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

async function start(req, res) {
  if (!TOKEN) return send(res, 400, { error: 'No GitHub token set. See the setup note on the page.' });
  let b;
  try {
    b = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, { error: 'Bad request: ' + e.message });
  }
  const text = String(b.text || '').trim();
  if (!text) return send(res, 400, { error: 'Paste a script first.' });
  if (text.length > 60000) return send(res, 400, { error: 'Script is too long (limit about 60,000 characters).' });
  const only = (Array.isArray(b.only) ? b.only : []).filter((x) => FORMATS.includes(x));
  if (!only.length) return send(res, 400, { error: 'Pick at least one output.' });
  const voice = VOICES.includes(b.voice) ? b.voice : VOICES[0];
  const name = safeName(b.name);

  const r = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: REF,
      inputs: {
        script_text: withMeta(text, { voice, brand: b.brand, handle: b.handle, cta: b.cta }),
        script_name: name,
        only: only.join(','),
      },
    }),
  });
  if (r.status === 204) return send(res, 200, { ok: true, name });
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
      ? ' (the workflow on GitHub may be out of date: push update v29 first)'
      : '';
  send(res, 502, { error: `GitHub said ${r.status}: ${msg}${hint}` });
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

async function download(id, res) {
  if (!/^\d+$/.test(id)) return send(res, 400, { error: 'bad id' });
  const a = await gh(`/repos/${REPO}/actions/runs/${id}/artifacts`);
  if (!a.ok) return send(res, 502, { error: `GitHub said ${a.status}` });
  const art = ((await a.json()).artifacts || []).find((x) => !x.expired);
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
      return send(res, 200, { hasToken: !!TOKEN, repo: REPO, voices: VOICES });
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') return await runs(res);
    if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
      return await download(url.pathname.split('/').pop(), res);
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
