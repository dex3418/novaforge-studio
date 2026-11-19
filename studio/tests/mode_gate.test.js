'use strict';
// A normal carousel never gets drawn story scenes, even if the AI director proposes them.
const assert = require('assert');
const { parseText } = require('../src/parse');
const { validatePlan, rulePlan } = require('../src/plan');
const { buildPrompt } = require('../src/director');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const carousel = '---\ntitle: Five money tips\n---\n\n## Hook\nSave first, spend later.\n\n## Tip one\nPay yourself before you pay anyone else.\n';
const story = '---\ntitle: Raju\nmode: story\ncast: Raju (boy, blue shirt); Meena (woman, red saree)\n---\n\n## One\n[Raju] I want to open a shop.\n\n## Two\n[Meena] Then start small.\n';
const aiPlan = (parsed) => ({ source: 'ai', template: 'tips', scenes: parsed.scenes.map((s) => ({ index: s.index, kind: 'story', data: { setting: 'village', time: 'day', actors: [{ id: 'raju', x0: .3, x1: .3, facing: 1, pose: 'idle', expr: 'happy', speaks: true }], props: [], camera: { z0: 1, z1: 1 } },
  beats: [{ fromSentence: 0, toSentence: 1, kind: 'story', data: { setting: 'village', time: 'day', actors: [], props: [] } }] })) });
const kinds = (plan) => plan.scenes.flatMap((s) => [s.kind, ...(s.beats || []).map((b) => b.kind)]);

ok('carousel: story kinds from the AI are replaced, none survive', () => {
  const parsed = parseText(carousel, 'c');
  const plan = validatePlan(aiPlan(parsed), parsed, rulePlan(parsed));
  assert.ok(!kinds(plan).includes('story'), kinds(plan).join());
});
ok('explicit "mode: carousel" wins even if a cast line is left in the header', () => {
  const parsed = parseText(story.replace('mode: story', 'mode: carousel'), 'c2');
  assert.ok(!kinds(validatePlan(aiPlan(parsed), parsed, rulePlan(parsed))).includes('story'));
});
ok('story mode still accepts drawn story beats', () => {
  const parsed = parseText(story, 's');
  const plan = validatePlan(aiPlan(parsed), parsed, rulePlan(parsed));
  assert.ok(kinds(plan).includes('story'), kinds(plan).join());
});
ok('the director prompt only offers the story visual in story mode', () => {
  assert.ok(!/^- story /m.test(buildPrompt(parseText(carousel, 'c'))));
  assert.ok(/^- story /m.test(buildPrompt(parseText(story, 's'))));
});
console.log(`mode_gate.test.js: ${n}/${n} checks passed`);
