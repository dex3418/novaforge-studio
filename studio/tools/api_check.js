'use strict';
// Small live check of the two outside services the studio can use:
//   1) ElevenLabs voice  (one short sentence, about 30 characters of your quota)
//   2) Gemini AI director (the real director on a 2-scene script, 1 to 3 requests)
// Run it from GitHub: Actions > api-check > Run workflow. It uses the repo secrets and never prints a key.
// Exit code 0 = both work, 1 = at least one does not.

const fs = require('fs');
const os = require('os');
const path = require('path');

// an empty cache folder, so the voice test is a real request and not a cached answer
process.env.ELEVENLABS_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-el-'));

const secrets = [process.env.ELEVENLABS_API_KEY, process.env.GEMINI_API_KEY].filter((k) => k && k.length > 6);
const scrub = (s) => secrets.reduce((t, k) => String(t).split(k).join('***'), String(s));
const out = [];
const say = (s = '') => { const t = scrub(s); out.push(t); console.log(t); };

function hint(msg) {
  const m = String(msg);
  if (/network|fetch failed/i.test(m)) return 'No connection to the service.';
  if (/is not set/.test(m)) return 'The secret is missing. Add it in the repo: Settings > Secrets and variables > Actions.';
  if (/ 401/.test(m)) return 'The key was refused. It is wrong, expired or has no access.';
  if (/paid_plan_required|library voices/i.test(m)) return 'The free plan cannot use library voices through the API. Use a voice from your own account (see below) or upgrade.';
  if (/ 402|quota|credit|payment/i.test(m)) return 'Out of credits or the plan does not allow this.';
  if (/ 429/.test(m)) return 'Rate limited or out of quota for now.';
  if (/ 404/.test(m)) return 'Not found: a wrong voice id or model name.';
  if (/ 400/.test(m)) return 'The request was refused as invalid.';
  return '';
}

async function listVoices() {
  const base = (process.env.ELEVENLABS_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/voices`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, cat: v.category || 'unknown' }));
}

async function tryVoice(id, file) {
  const { elevenSynth } = require('../src/elevenlabs_tts');
  const r = await elevenSynth('Namaste, yeh ek chhota test hai.', file, { voice: id, rate: '+0%' });
  return { bytes: fs.statSync(file).size, words: r.timing ? r.timing.marks.length : 0 };
}

async function checkEleven() {
  say('== 1. ElevenLabs voice ==');
  say(`key: ${process.env.ELEVENLABS_API_KEY ? 'set' : 'NOT SET'}`);
  const { DEFAULT_VOICE } = require('../src/catalog');
  const file = path.join(os.tmpdir(), 'nf-el-test.mp3');
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE.elevenlabs;
  let firstErr = '';
  try {
    const r = await tryVoice(voice, file);
    say(`WORKS: ${r.bytes} bytes of audio, voice ${voice}, word timing ${r.words ? r.words + ' words' : 'missing (captions would be approximate)'}`);
    return { ok: true, label: 'OK' };
  } catch (e) {
    firstErr = e.message;
    say(`default voice ${voice} FAILED: ${e.message}`);
    const h = hint(e.message);
    if (h) say(`meaning: ${h}`);
  }
  if (/is not set| 401|network/i.test(firstErr)) return { ok: false, label: 'NOT working' };

  // the default voice is blocked: look for voices this account can really use
  say('');
  say('-- voices in your own account --');
  let voices = [];
  try { voices = await listVoices(); } catch (e) {
    say(`could not list voices: ${e.message}`);
    if (/ 401| 403/.test(e.message)) say('meaning: the key may lack the "voices read" permission. Allow it for this key, or give me a voice id from your ElevenLabs "My Voices" page.');
    return { ok: false, label: 'NOT working (default voice blocked)' };
  }
  for (const v of voices.slice(0, 12)) say(`  ${v.name} | ${v.id} | ${v.cat}`);
  if (!voices.length) say('  (none: add a voice in ElevenLabs > Voices > My Voices first)');
  const usable = voices.filter((v) => /^(premade|generated|cloned)$/i.test(v.cat));
  const found = [];
  for (const v of usable.slice(0, 2)) {
    try {
      const r = await tryVoice(v.id, file);
      say(`WORKS with "${v.name}" (${v.id}): ${r.bytes} bytes, word timing ${r.words ? r.words + ' words' : 'missing'}`);
      found.push(v);
    } catch (e) {
      say(`"${v.name}" FAILED: ${e.message.slice(0, 200)}`);
    }
  }
  if (found.length) return { ok: false, label: `default voice blocked, but "${found[0].name}" works: ${found[0].id}` };
  return { ok: false, label: 'NOT working (no usable voice found)' };
}

async function checkDirector() {
  say('');
  say('== 2. Gemini AI director ==');
  say(`key: ${process.env.GEMINI_API_KEY ? 'set' : 'NOT SET'}${process.env.GEMINI_MODEL ? `, model forced to ${process.env.GEMINI_MODEL}` : ''}`);
  const { parseText } = require('../src/parse');
  const { rulePlan } = require('../src/plan');
  const { direct } = require('../src/director');
  const text = [
    '---', 'title: API check', 'brand: Novaforge Labs', '---', '',
    '# API check', '',
    '## Why check', 'A small check keeps every video honest. It costs almost nothing and saves a wasted render.', '',
    '## The result', 'If this plan comes from the AI, the director works. Otherwise it fell back to the simple rules.', '',
  ].join('\n');
  try {
    const parsed = parseText(text, 'api-check');
    const rules = rulePlan(parsed);
    const r = await direct(parsed, rules);
    const ai = r.plan && r.plan.source === 'ai';
    say(`${ai ? 'WORKS' : 'FELL BACK TO RULES'}: ${r.note}`);
    for (const d of (r.details || []).slice(0, 6)) say(`  - ${String(d).slice(0, 240)}`);
    if (!ai) {
      const tried = (r.details || []).filter((d) => /^gemini-/.test(String(d))).join(' ');
      const h = hint(tried || r.note);
      if (h) say(`meaning: ${h}`);
    }
    return ai;
  } catch (e) {
    say(`FAILED: ${e.message}`);
    return false;
  }
}

(async () => {
  const el = await checkEleven();
  const a = el.ok;
  const b = await checkDirector();
  say('');
  say(`SUMMARY  ElevenLabs: ${el.label}   Gemini director: ${b ? 'OK' : 'NOT working'}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + out.join('\n') + '\n```\n'); } catch (e) { /* summary is optional */ }
  }
  process.exit(a && b ? 0 : 1);
})();
