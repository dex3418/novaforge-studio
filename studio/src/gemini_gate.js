'use strict';
// One shared throttle for every Gemini request in a run (director, script cleaner, voices).
// Free keys have a small per-minute limit, so requests are spaced out, and a model that has already
// said "no quota" (429) or "busy" (503) is left alone for the rest of the run instead of being hammered.
//
//   GEMINI_MIN_GAP_MS   gap between requests, default 2500
//   GEMINI_MAX_CALLS    cap on text (director/cleaner) requests per run, default 10

const GAP = Number(process.env.GEMINI_MIN_GAP_MS || 2500);
const MAX_CALLS = Number(process.env.GEMINI_MAX_CALLS || 10);
let last = 0;
let calls = 0;
const dead = new Map(); // model -> time (ms) until which it is skipped

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wait(kind = 'text') {
  if (kind === 'text') {
    calls++;
    if (calls > MAX_CALLS) { const e = new Error(`request budget used up (${MAX_CALLS} per run, set GEMINI_MAX_CALLS to change)`); e.status = 0; e.budget = true; throw e; }
  }
  const now = Date.now();
  const due = last + GAP;
  last = Math.max(now, due);
  if (due > now) await sleep(due - now);
}

// 429 = out of quota for now: skip this model for the rest of the run. 503 = busy: skip for 45 s.
function failed(model, status) {
  if (status === 429) dead.set(model, Infinity);
  else if (status === 503) dead.set(model, Date.now() + 45000);
}
const skip = (model) => { const t = dead.get(model); return t !== undefined && Date.now() < t; };
const reset = () => { dead.clear(); calls = 0; last = 0; };

module.exports = { wait, failed, skip, reset, MAX_CALLS };
