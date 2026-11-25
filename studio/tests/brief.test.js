'use strict';
// Plain text in the box: no "## " scenes needed. Requests, dialogue, notes to the director, and a story always has people on screen.
const assert = require('assert');
const { interpret } = require('../src/brief');
const { prepareScript } = require('../src/ai_clean');
const { parseText } = require('../src/parse');
const { rulePlan, validatePlan } = require('../src/plan');
const { buildPrompt } = require('../src/director');
let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ok   ' + name); });
const noAI = { call: () => { throw new Error('no AI'); } };
const beats = (plan) => plan.scenes.flatMap((s) => (s.beats && s.beats.length > 1 ? s.beats : [s]));

(async () => {
  await ok('plain paragraphs become scenes and nothing is lost or invented', async () => {
    const raw = 'Saving money is simple.\n\nPay yourself first. Then spend what is left.\n\nStart with 500 rupees a month.';
    const r = await prepareScript(raw, noAI);
    const p = parseText(r.text, 'p');
    assert.strictEqual(p.scenes.length, 3);
    assert.strictEqual(p.scenes.map((s) => s.narration).join(' ').replace(/\s+/g, ' '), raw.replace(/\s+/g, ' '));
    assert.ok(!p.cast.length && p.meta.mode === '');
  });
  await ok('one long paragraph is cut at sentence ends into several scenes', () => {
    const para = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} has a few words in it.`).join(' ');
    const r = interpret(para);
    assert.ok(r.scenes >= 2 && r.scenes <= 5, String(r.scenes));
  });
  await ok('"Name: line" dialogue switches story mode on and builds the cast, no header needed', async () => {
    const raw = 'Ramu: How do I apply?\nSita: Go to the office.\nRamu: Is it free?\nSita: Yes, completely.';
    const r = await prepareScript(raw, noAI);
    const p = parseText(r.text, 'd');
    assert.strictEqual(p.meta.mode, 'story');
    assert.deepStrictEqual(p.cast.map((c) => c.id), ['ramu', 'sita']);
    assert.ok(p.scenes.every((s) => s.lines && s.lines.length));
  });
  await ok('a request on top is kept for the director and sets mode, setting and art; it is not spoken', async () => {
    const raw = 'Please make this a chibi story in a village.\n\nRamu: Namaste.\nSita: Namaste, how are you?\nRamu: Fine, thank you.';
    const r = await prepareScript(raw, noAI);
    const p = parseText(r.text, 'q');
    assert.strictEqual(p.meta.mode, 'story'); assert.strictEqual(p.meta.setting, 'village'); assert.strictEqual(p.meta.art, 'chibi');
    assert.ok(/chibi story in a village/.test(p.meta.note));
    assert.ok(!p.scenes.some((s) => /chibi/.test(s.narration)));
    assert.ok(/REQUEST FOR THIS VIDEO[^\n]*chibi story/.test(buildPrompt(p)));
  });
  await ok('an ordinary first line that merely starts with "Make" is NOT taken for a request', () => {
    const r = interpret('Make sure you keep your receipts.\n\nThey protect you later.');
    assert.ok(!r.request);
  });
  await ok('Director: lines and (stage directions) are notes for their scene, never spoken', async () => {
    const raw = 'Ramu: Hello.\nSita: Hi.\n(Sita smiles and waves)\nRamu: Nice day.\n\nDirector: slow push-in, golden light\nSita: Yes it is.';
    const r = await prepareScript(raw, noAI);
    const p = parseText(r.text, 'n');
    const all = p.scenes.flatMap((s) => s.direction).join(' | ');
    assert.ok(/smiles and waves/.test(all) && /golden light/.test(all), all);
    assert.ok(!p.scenes.some((s) => /smiles and waves|golden light/.test(s.narration)));
  });
  await ok('"make a story about X" with no dialogue: names found in the text become the cast', async () => {
    const raw = 'Make a short animated story about Meera and her goat.\n\nMeera woke up early. Meera loved her goat Gudiya.\n\nOne day Gudiya was missing. Meera searched the whole field.';
    const r = await prepareScript(raw, noAI);
    const p = parseText(r.text, 'm');
    assert.strictEqual(p.meta.mode, 'story'); assert.ok(p.cast.map((c) => c.id).includes('meera'));
  });
  await ok('story mode with nobody named still gets one default presenter on screen', () => {
    const p = parseText('---\nmode: story\n---\n\n## One\nThe market opens at dawn.\n\n## Two\nPrices rise by noon.\n', 's');
    assert.deepStrictEqual(p.cast.map((c) => c.id), ['guide']);
  });
  await ok('story mode: EVERY beat shows characters, even lines about numbers (only the author own pictures stay)', () => {
    const p = parseText('---\nmode: story\ncast: Ravi (man); Asha (woman)\n---\n\n## One\nRavi: I saved 5000 rupees this month, up from 2000 last month, which is 150 percent more.\nAsha: Great, now put 30 percent into a fixed deposit and 20 percent into an emergency fund.\n\n## Two\nAsha: Follow for more tips.\n', 'k');
    const plan = rulePlan(p, { seed: 3 });
    const bs = beats(plan);
    assert.ok(bs.length >= 2);
    bs.forEach((b) => { assert.strictEqual(b.kind, 'story'); assert.ok(b.data.actors.length >= 1, JSON.stringify(b.data)); });
    // an AI plan that asks for charts is turned back into people
    const ai = { source: 'ai', template: 'tips', scenes: [{ index: 1, kind: 'counter', data: { values: [5000] } }, { index: 2, kind: 'kinetic', data: { text: 'Follow' } }] };
    const v = validatePlan(ai, p, rulePlan(p, { seed: 3 }));
    beats(v).forEach((b) => { assert.strictEqual(b.kind, 'story'); assert.ok(b.data.actors.length >= 1); });
  });
  await ok('a narrated beat that names a cast member puts that person on stage', () => {
    const p = parseText('---\nmode: story\ncast: Ravi (man); Asha (woman)\n---\n\n## One\nAsha: Hello.\nRavi: Hi.\n\n## Two\nLater that day Ravi walked home alone.\n', 'x');
    const two = beats(rulePlan(p, { seed: 1 })).filter((b) => b.kind === 'story').pop();
    assert.ok(two.data.actors.some((a) => a.id === 'ravi'));
  });
  await ok('studio scripts and pasted documents are left alone', async () => {
    const studio = '---\ntitle: T\n---\n\n## One\nHello there friend.\n';
    assert.strictEqual(interpret(studio).changed, false);
    assert.strictEqual(interpret('# Doc\n\n## Hook\n**Spoken:** Hello there everyone.\n').changed, false);
  });
  await ok('only an instruction and no script: builds anyway and says so', () => {
    const r = interpret('Make a story about a farmer who learns to save money.');
    assert.ok(r.changed && /no script text found/.test(r.notes.join(' ')));
  });
  console.log(`brief.test.js: ${n}/${n} checks passed`);
})().catch((e) => { console.log('  FAIL ' + (e.stack || e.message)); process.exit(1); });
