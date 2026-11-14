'use strict';
// Feedback for the box: like / neutral / dislike per run, one calibration.md that is
// rewritten after every rating, a comment log, and a short history of what you sent
// (so a run can be redone with a note).
//
// Everything lives on your phone in ~/.novaforge-studio/ (not in the git repo, so your
// scripts and notes are never pushed):
//   ratings.json      one rating per run (source of truth)
//   calibration.md    readable summary, rewritten after every rating
//   notes.txt         your standing notes (edited on the page, shown in calibration.md)
//   comments.md       every comment you wrote (a log; it never changes calibration.md)
//   dispatches.json   the last scripts you sent (for "redo with this note")

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const DIR = process.env.NF_DATA || path.join(os.homedir(), '.novaforge-studio');
const F = (n) => path.join(DIR, n);
const AXES = ['template', 'palette', 'texture', 'transition', 'decor', 'kind'];
const RATINGS = ['like', 'neutral', 'dislike'];
const VALUE = { like: 1, neutral: 0, dislike: -1 };
const STRONG = 0.75; // same threshold the studio uses

function ensure() {
  fs.mkdirSync(DIR, { recursive: true });
}
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(F(name), 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function writeJson(name, v) {
  ensure();
  fs.writeFileSync(F(name), JSON.stringify(v, null, 2));
}

// ---------------------------------------------------------------- zip (read one file)
// GitHub artifacts are plain zip files; this reads the first entry whose name matches.
function zipEntry(buf, test) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (test(name)) {
      const lnlen = buf.readUInt16LE(off + 26);
      const lxlen = buf.readUInt16LE(off + 28);
      const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

// ---------------------------------------------------------------- what a run looked like
function factsFromPlan(plan) {
  const units = [];
  for (const s of plan.scenes || []) {
    if (s.beats && s.beats.length > 1) s.beats.forEach((b) => units.push({ ...b, palette: s.palette, texture: s.texture }));
    else units.push(s);
  }
  const set = (f) => [...new Set(units.map(f).filter(Boolean))];
  const caps = units.filter((u) => u.kind === 'caption').length;
  return {
    template: plan.template || '',
    source: plan.source || '',
    palette: set((u) => u.palette),
    texture: set((u) => u.texture),
    transition: set((u) => u.transition),
    decor: set((u) => u.decor),
    kind: set((u) => u.kind),
    beats: units.length,
    caption: units.length ? caps / units.length : 0,
  };
}

// ---------------------------------------------------------------- ratings
const loadRatings = () => readJson('ratings.json', {});

function setRating(runId, rating, info = {}) {
  if (!RATINGS.includes(rating)) throw new Error('rating must be like, neutral or dislike');
  const all = loadRatings();
  const prev = all[runId] || {};
  all[runId] = {
    title: info.title || prev.title || '',
    at: new Date().toISOString(),
    rating,
    facts: info.facts || prev.facts || null,
  };
  writeJson('ratings.json', all);
  writeCalibration();
  return all[runId];
}

function removeRating(runId) {
  const all = loadRatings();
  delete all[runId];
  writeJson('ratings.json', all);
  writeCalibration();
}

// ---------------------------------------------------------------- scores
function scores(all) {
  const out = {};
  for (const a of AXES) out[a] = {};
  const tally = {};
  for (const a of AXES) tally[a] = {};
  let n = 0;
  let capL = [];
  let capD = [];
  for (const r of Object.values(all)) {
    n++;
    const v = VALUE[r.rating] || 0;
    const f = r.facts;
    if (!f) continue;
    if (r.rating === 'like') capL.push(f.caption);
    if (r.rating === 'dislike') capD.push(f.caption);
    for (const a of AXES) {
      const vals = a === 'template' ? [f.template].filter(Boolean) : f[a] || [];
      const w = vals.length ? 1 / Math.sqrt(vals.length) : 0; // many values in one run: each counts less
      for (const id of vals) {
        const t = (tally[a][id] = tally[a][id] || { up: 0, mid: 0, down: 0, score: 0 });
        if (r.rating === 'like') t.up++;
        else if (r.rating === 'dislike') t.down++;
        else t.mid++;
        t.score += v * w;
      }
    }
  }
  for (const a of AXES) for (const [id, t] of Object.entries(tally[a])) out[a][id] = Math.round(t.score * 100) / 100;
  const avg = (x) => (x.length ? x.reduce((s, y) => s + y, 0) / x.length : null);
  return { n, scores: out, tally, caption: { liked: avg(capL), disliked: avg(capD) } };
}

const loadNotes = () => {
  try {
    return fs.readFileSync(F('notes.txt'), 'utf8').trim();
  } catch (e) {
    return '';
  }
};
function saveNotes(text) {
  ensure();
  fs.writeFileSync(F('notes.txt'), String(text || '').slice(0, 3000).trim() + '\n');
  writeCalibration();
}

// compact text sent with every run (kept small: GitHub limits the whole request)
function compact() {
  const s = scores(loadRatings());
  const keep = {};
  for (const a of AXES) {
    keep[a] = {};
    for (const [id, v] of Object.entries(s.scores[a])) if (Math.abs(v) >= 0.2) keep[a][id] = v;
  }
  const c = { v: 1, n: s.n, scores: keep, caption: s.caption, notes: loadNotes().slice(0, 1200) };
  let j = JSON.stringify(c);
  if (j.length > 5500) j = JSON.stringify({ ...c, notes: c.notes.slice(0, 300) });
  return s.n || c.notes ? j : '';
}

// ---------------------------------------------------------------- calibration.md
function writeCalibration() {
  const all = loadRatings();
  const s = scores(all);
  const L = [];
  const counts = { like: 0, neutral: 0, dislike: 0 };
  for (const r of Object.values(all)) counts[r.rating]++;
  L.push('# Studio calibration', '');
  L.push(`Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Rewritten after every rating. Sent with every run, so the planner and the AI director learn from it.`, '');
  L.push(`Ratings: ${s.n} (liked ${counts.like}, neutral ${counts.neutral}, disliked ${counts.dislike})`, '');
  const rows = (test) => {
    const out = [];
    for (const a of AXES) {
      const ids = Object.entries(s.scores[a]).filter(([, v]) => test(v)).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      if (ids.length) out.push(`- ${a}: ${ids.map(([id, v]) => `${id} (${v > 0 ? '+' : ''}${v})`).join(', ')}`);
    }
    return out.length ? out : ['- nothing yet'];
  };
  L.push('## Prefer', ...rows((v) => v >= STRONG), '');
  L.push('## Avoid', ...rows((v) => v <= -STRONG), '');
  L.push('## Plain captions');
  const c = s.caption;
  L.push(c.liked == null && c.disliked == null ? '- not enough ratings yet' : `- liked videos: ${c.liked == null ? 'n/a' : Math.round(c.liked * 100) + '% caption beats'}; disliked videos: ${c.disliked == null ? 'n/a' : Math.round(c.disliked * 100) + '% caption beats'}`, '');
  L.push('## Everything seen', '', '| axis | value | liked | neutral | disliked | score |', '|---|---|---|---|---|---|');
  for (const a of AXES) {
    for (const [id, t] of Object.entries(s.tally[a]).sort((x, y) => y[1].score - x[1].score)) L.push(`| ${a} | ${id} | ${t.up} | ${t.mid} | ${t.down} | ${Math.round(t.score * 100) / 100} |`);
  }
  L.push('', '## Your standing notes', loadNotes() || '(none yet; write them on the page)', '');
  L.push('## Rated runs');
  const runs = Object.entries(all).sort((x, y) => String(y[1].at).localeCompare(String(x[1].at)));
  for (const [id, r] of runs.slice(0, 60)) {
    const f = r.facts;
    L.push(`- ${String(r.at).slice(0, 10)} ${r.title || id}: ${r.rating}${f ? ` (${f.template}, ${f.palette.join('/')}, ${Math.round(f.caption * 100)}% captions)` : ' (no plan details)'}`);
  }
  L.push('');
  ensure();
  fs.writeFileSync(F('calibration.md'), L.join('\n'));
}

function readCalibration() {
  if (!fs.existsSync(F('calibration.md'))) writeCalibration();
  return fs.readFileSync(F('calibration.md'), 'utf8');
}

function reset() {
  for (const n of ['ratings.json']) {
    try {
      fs.unlinkSync(F(n));
    } catch (e) {
      /* already gone */
    }
  }
  writeCalibration();
}

// ---------------------------------------------------------------- comments
function addComment(runId, title, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!t) throw new Error('write a comment first');
  ensure();
  fs.appendFileSync(F('comments.md'), `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC | run ${runId} | ${title || ''}: ${t}\n`);
  const all = readJson('comments.json', {});
  all[runId] = { title: title || '', text: t, at: new Date().toISOString() };
  writeJson('comments.json', all);
  return all[runId];
}
const loadComments = () => readJson('comments.json', {});

// ---------------------------------------------------------------- what was sent
function recordDispatch(rec) {
  const list = readJson('dispatches.json', []);
  list.unshift({ ...rec, at: Date.now() });
  writeJson('dispatches.json', list.slice(0, 15));
}
// the dispatch that made a run: same name, sent just before the run was created
function findDispatch(title, createdIso) {
  const name = String(title || '').replace(/^studio\s*-\s*/i, '').trim();
  const t = Date.parse(createdIso) || Date.now();
  return readJson('dispatches.json', []).filter((d) => d.name === name && d.at <= t + 120000).sort((a, b) => b.at - a.at)[0] || null;
}

module.exports = { DIR, zipEntry, factsFromPlan, setRating, removeRating, loadRatings, compact, saveNotes, loadNotes, readCalibration, writeCalibration, reset, addComment, loadComments, recordDispatch, findDispatch, scores, RATINGS };
