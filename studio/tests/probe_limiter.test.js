'use strict';
// The Gemini probe spaces every request, stops testing a kind once three models show quota 0, and writes its report.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const hits = [];
const models = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ name: `models/img-${x}`, supportedGenerationMethods: ['generateContent'] }))
  .concat([{ name: 'models/text-1', supportedGenerationMethods: ['generateContent'] }]);
const srv = http.createServer((req, res) => {
  hits.push({ t: Date.now(), url: req.url });
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/models?')) return res.end(JSON.stringify({ models }));
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (/gemini-image-/.test(req.url)) { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: 'Quota exceeded, limit: 0' } })); }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
  });
});
srv.listen(0, '127.0.0.1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const names = models.map((m) => m.name);
  const kindsOf = () => names;
  // make the fake models look like image models for the probe: "image" in the id and an image output method
  models.slice(0, 5).forEach((m) => { m.name = m.name.replace('img-', 'gemini-image-'); });
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'gemini_probe.js'), '--rpm', '120', '--max', '40'], { cwd: dir, env: Object.assign({}, process.env, { GEMINI_KEY: 'k', GEMINI_BASE: `http://127.0.0.1:${srv.address().port}`, ONLY: 'image,text' }) });
  let out = ''; p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (out += c));
  p.on('close', () => {
    srv.close();
    if (process.env.DBG) console.log(out);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'gemini_probe.json'), 'utf8')).rows;
    const gaps = hits.slice(1).map((h, i) => h.t - hits[i].t);
    assert.ok(Math.min(...gaps) >= 440, `requests are at least 0.5 s apart at 120/min, closest gap ${Math.min(...gaps)} ms`);
    const img = rows.filter((r) => /image/.test(r.id));
    assert.strictEqual(img.filter((r) => r.http === 429).length, 3, 'only three image models were really tested');
    assert.strictEqual(img.filter((r) => /skipped \(3 models/.test(r.result)).length, img.length - 3);
    assert.ok(img.every((r) => !r.ok));
    console.log('probe_limiter.test.js: 3/3 checks passed');
  });
});
