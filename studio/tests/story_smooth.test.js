'use strict';
// Drawn story scenes must play as one continuous film, and Gemini calls must be throttled.   npm test
const assert = require('assert');
const { parseText } = require('../src/parse');
const { rulePlan } = require('../src/plan');
const gate = require('../src/gemini_gate');
const { renderScene } = require('../src/scenes');

let pass = 0;
const out = [];
const test = (name, fn) => { try { fn(); pass++; out.push(`  ok   ${name}`); } catch (e) { out.push(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); process.exitCode = 1; } };

const SCRIPT = `---
mode: story
cast: Naina (woman, kurta); Ramu (man, turban, moustache)
---
## A
Naina walks into the village.
Naina: Hello uncle, how are you today?
Ramu: Very well, beta. The mango tree is full again.
## B
Naina: Then let us sell the mangoes for the library!
Ramu: A fine dream. Let us ask the others tonight.
`;

test('story plan: no texture, decor, icon or colour flip; only the first beat of a scene fades in', () => {
  const plan = rulePlan(parseText(SCRIPT, 's'));
  const pals = new Set(plan.scenes.map((s) => s.palette));
  assert.strictEqual(pals.size, 1, 'one palette for the whole film');
  for (const s of plan.scenes) {
    assert.strictEqual(s.texture, 'none');
    (s.beats || [s]).forEach((b, i) => {
      assert.strictEqual(b.kind, 'story');
      assert.strictEqual(b.scheme, 'base');
      assert.strictEqual(b.decor, 'none');
      assert.ok(!b.icon);
      assert.strictEqual(b.transition, i === 0 ? 'fadein' : 'cut');
    });
  }
});

test('story frames: a "cut" beat has no fade (fully visible from its first frame), "fadein" starts transparent', () => {
  const plan = rulePlan(parseText(SCRIPT, 's'));
  const sc = plan.scenes[0];
  const b = (sc.beats || [sc])[1] || sc;
  const mk = (transition, frame) => renderScene({ mode: 'video', w: 1080, h: 1920, plan, scene: { ...sc, kind: 'story', data: b.data, transition, narration: 'Hello there', index: 1 }, frame, fps: 30, sceneFrames: 90, audioFrames: 80, wordIdx: 0, font: 'sans-serif', total: 2, num: 1, pics: [] });
  const cut = mk('cut', 0);
  const fade = mk('fadein', 0);
  assert.ok(!/class="nf-stage"[^>]*opacity:0/.test(cut), 'cut is visible at frame 0');
  assert.ok(/class="nf-stage"[^>]*opacity:0[;"]/.test(fade), 'fadein starts at opacity 0');
});

test('gemini gate: requests are spaced, failed models are skipped, the budget stops runaway retries', async () => {
  gate.reset();
  gate.failed('a', 429); gate.failed('b', 503);
  assert.ok(gate.skip('a') && gate.skip('b') && !gate.skip('c'));
});

(async () => {
  gate.reset();
  const t0 = Date.now();
  await gate.wait('text'); await gate.wait('text');
  const spaced = Date.now() - t0 >= 2000;
  let stopped = 0;
  try { for (let i = 0; i < 20; i++) { await gate.wait('tts'); } } catch (e) { stopped = 1; }
  gate.reset();
  let n = 0, budget = false;
  process.env.GEMINI_MAX_CALLS = '10';
  try { for (let i = 0; i < 12; i++) { await gate.wait('text'); n++; } } catch (e) { budget = !!e.budget; }
  test('gemini gate: spacing is enforced and voice calls are not counted against the text budget', () => { assert.ok(spaced); assert.strictEqual(stopped, 0); });
  test('gemini gate: text budget stops after the limit', () => { assert.strictEqual(n, 10); assert.ok(budget); });
  console.log(out.join('\n'));
  console.log(`\n${pass}/${out.length} passed`);
})();
