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
  if (/ 402|quota|credit|payment/i.test(m)) return 'Out of credits or the plan does not allow this.';
  if (/ 429/.test(m)) return 'Rate limited or out of quota for now.';
  if (/ 404/.test(m)) return 'Not found: a wrong voice id or model name.';
  if (/ 400/.test(m)) return 'The request was refused as invalid.';
  return '';
}

async function checkEleven() {
  say('== 1. ElevenLabs voice ==');
  say(`key: ${process.env.ELEVENLABS_API_KEY ? 'set' : 'NOT SET'}`);
  const { elevenSynth } = require('../src/elevenlabs_tts');
  const { DEFAULT_VOICE } = require('../src/catalog');
  const file = path.join(os.tmpdir(), 'nf-el-test.mp3');
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE.elevenlabs;
  try {
    const r = await elevenSynth('Namaste, yeh ek chhota test hai.', file, { voice, rate: '+0%' });
    const bytes = fs.statSync(file).size;
    say(`WORKS: ${bytes} bytes of audio, voice ${voice}, word timing ${r.timing ? r.timing.marks.length + ' words' : 'missing (captions would be approximate)'}`);
    return true;
  } catch (e) {
    say(`FAILED: ${e.message}`);
    const h = hint(e.message);
    if (h) say(`meaning: ${h}`);
    return false;
  }
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
  const a = await checkEleven();
  const b = await checkDirector();
  say('');
  say(`SUMMARY  ElevenLabs: ${a ? 'OK' : 'NOT working'}   Gemini director: ${b ? 'OK' : 'NOT working'}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + out.join('\n') + '\n```\n'); } catch (e) { /* summary is optional */ }
  }
  process.exit(a && b ? 0 : 1);
})();
