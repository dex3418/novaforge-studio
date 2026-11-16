'use strict';
// Finds out which Gemini models THIS key can actually use, for text, image, speech (TTS) and others.
// Runs in GitHub Actions (workflow "gemini-probe"), prints a table and writes gemini_probe.json.
// The key is read from the GEMINI_KEY env var, never printed, and scrubbed from every message.
//   GEMINI_KEY=... node tools/gemini_probe.js [--max 80]

const fs = require('fs');
const KEY = process.env.GEMINI_KEY || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
if (!KEY) { console.error('No key given.'); process.exit(2); }

const only = (process.env.ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const max = Number((process.argv[process.argv.indexOf('--max') + 1]) || 80);
const scrub = (s) => String(s).split(KEY).join('***');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function call(path, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) { /* not json */ }
    return { status: r.status, json: j, ms: Date.now() - t0, err: r.ok ? '' : scrub((j && j.error && j.error.message) || txt).replace(/\s+/g, ' ').slice(0, 140) };
  } catch (e) {
    return { status: 0, json: null, ms: Date.now() - t0, err: scrub(e.message) };
  }
}

function kinds(m) {
  const id = m.name.replace('models/', '');
  const meth = m.supportedGenerationMethods || [];
  const k = [];
  if (/imagen/i.test(id) || meth.includes('predict') && /image/i.test(id)) k.push('imagen');
  if (/image/i.test(id) && meth.includes('generateContent')) k.push('image');
  if (/tts/i.test(id)) k.push('tts');
  if (/embed/i.test(id) || meth.includes('embedContent')) k.push('embed');
  if (/veo/i.test(id) || meth.includes('predictLongRunning')) k.push('video');
  if (/live|native-audio/i.test(id) || meth.includes('bidiGenerateContent')) k.push('live');
  if (!k.length && meth.includes('generateContent')) k.push('text');
  return k;
}

// 429 can mean "too fast" (wait and retry) or "this model has no free quota" (limit 0). Wait for the retry
// time Google suggests, up to 3 tries, and only call it unavailable when the limit is 0 or it keeps failing.
async function withRetry(fn) {
  let r;
  for (let i = 0; i < 4; i++) {
    r = await fn();
    if (r.status !== 429) return r;
    const raw = JSON.stringify(r.json || {});
    if (/limit:\s*0\b/.test(raw) || /"quotaValue":\s*"0"/.test(raw)) { r.err = `NOT ON YOUR PLAN (quota 0): ${r.err}`.slice(0, 160); return r; }
    const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
    const wait = Math.min(65, m ? Math.ceil(Number(m[1])) + 1 : 20);
    if (i < 3) { console.log(`   rate limited, waiting ${wait}s then retrying`); await sleep(wait * 1000); }
  }
  r.err = `RATE LIMITED (still after retries): ${r.err}`.slice(0, 160);
  return r;
}

async function probe(id, kind) {
  const p = `models/${id}`;
  if (kind === 'text') return call(`${p}:generateContent`, { contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }], generationConfig: { maxOutputTokens: 16 } });
  if (kind === 'image') return call(`${p}:generateContent`, { contents: [{ parts: [{ text: 'A simple flat red circle on white background' }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
  if (kind === 'imagen') return call(`${p}:predict`, { instances: [{ prompt: 'A simple flat red circle on white background' }], parameters: { sampleCount: 1 } });
  if (kind === 'tts') return call(`${p}:generateContent`, { contents: [{ parts: [{ text: 'Say: hello' }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } });
  if (kind === 'embed') return call(`${p}:embedContent`, { content: { parts: [{ text: 'hello' }] } });
  return null;
}

function got(kind, r) {
  const parts = (((r.json || {}).candidates || [])[0] || {}).content;
  const ps = (parts && parts.parts) || [];
  if (kind === 'image') return ps.some((x) => x.inlineData && /image/.test(x.inlineData.mimeType || '')) ? 'IMAGE returned' : 'no image in reply';
  if (kind === 'tts') return ps.some((x) => x.inlineData && /audio/.test(x.inlineData.mimeType || '')) ? 'AUDIO returned' : 'no audio in reply';
  if (kind === 'imagen') return ((r.json || {}).predictions || []).length ? 'IMAGE returned' : 'no image in reply';
  if (kind === 'embed') return ((r.json || {}).embedding || {}).values ? 'vector returned' : 'no vector';
  return ps.length ? 'text returned' : 'empty reply';
}

(async () => {
  const all = [];
  let token = '';
  for (let i = 0; i < 10; i++) {
    const r = await call(`models?pageSize=200${token ? `&pageToken=${token}` : ''}`);
    if (r.status !== 200) {
      console.log(`LIST FAILED: HTTP ${r.status} ${r.err}`);
      console.log('The key is wrong, restricted, or the API is not enabled for it. Nothing else can be tested.');
      process.exit(1);
    }
    all.push(...(r.json.models || []));
    token = r.json.nextPageToken;
    if (!token) break;
  }
  console.log(`Key accepted. ${all.length} models are listed for it.\n`);

  const jobs = [];
  for (const m of all) {
    const id = m.name.replace('models/', '');
    for (const k of kinds(m)) jobs.push({ id, kind: k, methods: (m.supportedGenerationMethods || []).join(',') });
  }
  // test the kinds you care about first, so the cap never cuts them
  const order = { image: 0, imagen: 1, tts: 2, text: 3, embed: 4, live: 9, video: 9 };
  jobs.sort((a, b) => (order[a.kind] - order[b.kind]) || a.id.localeCompare(b.id));

  const rows = [];
  let tested = 0;
  for (const j of jobs) {
    if (['live', 'video'].includes(j.kind)) { rows.push({ ...j, result: 'listed (not tested here)' }); continue; }
    if (only.length && !only.includes(j.kind)) { rows.push({ ...j, result: 'skipped (not selected)' }); continue; }
    if (tested >= max) { rows.push({ ...j, result: 'skipped (limit)' }); continue; }
    tested++;
    const r = await withRetry(() => probe(j.id, j.kind));
    const ok = r.status === 200;
    rows.push({ ...j, http: r.status, ok, ms: r.ms, result: ok ? got(j.kind, r) : r.err });
    console.log(`${ok ? 'WORKS ' : 'fails '} ${j.kind.padEnd(6)} ${j.id.padEnd(46)} HTTP ${r.status}  ${rows[rows.length - 1].result}`);
    await sleep(4500); // free tiers allow only a few requests a minute
  }

  const works = (k) => rows.filter((x) => x.kind === k && x.ok && /returned/.test(x.result)).map((x) => x.id);
  const summary = { image: works('image').concat(works('imagen')), tts: works('tts'), text: works('text'), embed: works('embed') };
  console.log('\n===== SUMMARY: what this key can really use =====');
  for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(6)}: ${v.length ? v.join(', ') : '(none worked)'}`);
  if (!summary.image.length) console.log('\nNo image model worked. Look at the "fails" lines above for image models: a message about billing/quota/free tier means image generation needs a paid key.');
  fs.writeFileSync('gemini_probe.json', JSON.stringify({ summary, rows }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['## Gemini key probe', '', ...Object.entries(summary).map(([k, v]) => `- **${k}**: ${v.length ? v.map((x) => `\`${x}\``).join(', ') : '_none worked_'}`), '', '| works | kind | model | result |', '|---|---|---|---|', ...rows.filter((x) => x.http != null).map((x) => `| ${x.ok ? 'yes' : 'no'} | ${x.kind} | \`${x.id}\` | ${String(x.result).replace(/\|/g, '/')} |`)].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }
})();
