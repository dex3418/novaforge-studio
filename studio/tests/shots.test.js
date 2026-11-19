'use strict';
// Shot library: names, validation, framing maths, grammar, and a real render.
const assert = require('assert');
const S = require('../src/shots');
const { parseText } = require('../src/parse');
const { validatePlan, rulePlan } = require('../src/plan');
const { stageSvg } = require('../src/story_stage');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

ok('every shot in the brief exists', () => {
  for (const k of ['establishing', 'full', 'medium', 'two_shot', 'close_up', 'extreme_close_up', 'reaction', 'over_shoulder', 'low_angle', 'high_angle', 'push_in', 'pull_out', 'pan_left', 'pan_right']) assert.ok(S.SHOTS[k], k);
});
ok('an invented shot name falls back to the nearest real one, junk gives none', () => {
  const m = { 'Close-Up': 'close_up', 'over the shoulder': 'over_shoulder', 'closeup_shot': 'close_up', 'wide shot': 'establishing', 'slow push in on her face': 'push_in', 'mediun': 'medium', 'dutch angle': null, 'xyzzy': null };
  for (const [a, b] of Object.entries(m)) assert.strictEqual(S.nearestShot(a).name, b, a);
  assert.strictEqual(S.nearestShot('medium').exact, true);
});
ok('a bad camera cannot survive validation: unknown shot, unknown actor, one-person beat asked for a two-shot', () => {
  assert.deepStrictEqual(S.cleanCamera({ shot: 'two_shot', on: 'ghost' }, ['raju'], null), { shot: 'medium' });
  assert.strictEqual(S.cleanCamera({ shot: 'reaction' }, ['raju'], null).shot, 'close_up');
  assert.strictEqual(S.cleanCamera({ shot: 'close_up' }, [], null).shot, 'establishing');
  assert.strictEqual(S.cleanCamera({ shot: 'dutch angle' }, ['a'], null), null);
  assert.strictEqual(S.cleanCamera({ shot: 'closeup', on: 'a', shake: true }, ['a'], null).shake, true);
});

// framing: a figure 398 high standing on y 735, in a portrait stage (562 wide) and a landscape one (1778 wide)
const person = (x, speaks, id) => ({ id: id || 'a', x, y: 735, h: 398, speaks });
ok('close-up centres on the face in portrait and landscape; the head is inside the frame', () => {
  for (const W of [562, 1778]) {
    const f = S.frame({ shot: 'close_up', on: 'a' }, { W, H: 1000, actors: [person(0.3, true), person(0.7, false, 'b')] });
    const faceY = 735 - 0.72 * 398;
    const top = f.fy0 - 500 / f.z0; const bot = f.fy0 + 500 / f.z0;
    assert.ok(faceY > top && faceY < bot, `face ${faceY} in ${top}..${bot} at W=${W}`);
    assert.ok(f.z0 > 3.5, 'close-up is a real close-up, z=' + f.z0);
    assert.ok(Math.abs(f.fx0 - 0.3) < 0.2 && f.fx0 > W / (2 * f.z0) / W - 1e-9, 'looks at the speaker');
    const half = W / (2 * f.z0); assert.ok(f.fx0 * W - half >= -0.01 && f.fx0 * W + half <= W + 0.01, 'window stays inside the stage');
  }
});
ok('shot sizes get tighter: wide < full < medium < close-up < extreme close-up', () => {
  const ctx = { W: 562, H: 1000, actors: [person(0.5, true)] };
  const z = ['establishing', 'full', 'medium', 'close_up', 'extreme_close_up'].map((s) => S.frame({ shot: s }, ctx).z0);
  for (let i = 1; i < z.length; i++) assert.ok(z[i] > z[i - 1], z.join());
});
ok('two-shot holds both people; reaction looks at the listener; over-the-shoulder is off-centre', () => {
  const ctx = { W: 1778, H: 1000, actors: [person(0.27, true, 'a'), person(0.73, false, 'b')] };
  const two = S.frame({ shot: 'two_shot', on: 'a' }, ctx);
  const half = 1778 / (2 * two.z0);
  assert.ok(two.fx0 * 1778 - half <= 0.27 * 1778 - 40 && two.fx0 * 1778 + half >= 0.73 * 1778 + 40, 'both inside the window');
  assert.ok(S.frame({ shot: 'reaction', on: 'a' }, ctx).fx0 > 0.6, 'reaction is on the listener (right)');
  const ots = S.frame({ shot: 'over_shoulder', on: 'a' }, ctx);
  assert.ok(ots.fx0 < 0.73 && ots.fx0 > 0.5, 'nudged from the listener towards the speaker: ' + ots.fx0);
});
ok('low and high angle tilt in opposite directions; moves change the frame over time', () => {
  const ctx = { W: 562, H: 1000, actors: [person(0.5, true)] };
  assert.ok(S.frame({ shot: 'low_angle' }, ctx).rot0 < 0 && S.frame({ shot: 'high_angle' }, ctx).rot0 > 0);
  const pi = S.frame({ shot: 'push_in' }, ctx); assert.ok(pi.z1 > pi.z0 * 1.3);
  const po = S.frame({ shot: 'pull_out' }, ctx); assert.ok(po.z1 < po.z0 / 1.3);
  const pl = S.frame({ shot: 'pan_left' }, ctx); assert.ok(pl.fx1 < pl.fx0);
});

ok('grammar: open wide, medium for dialogue, close-up on emotion, reaction after big news, never twice in a row', () => {
  assert.strictEqual(S.planShot({ first: true, n: 1 }, ''), 'establishing');
  assert.strictEqual(S.planShot({ n: 2, expr: 'neutral' }, 'establishing'), 'two_shot');
  assert.strictEqual(S.planShot({ n: 1, expr: 'laugh' }, 'medium'), 'close_up');
  assert.strictEqual(S.planShot({ n: 1, big: true }, 'medium'), 'extreme_close_up');
  assert.strictEqual(S.planShot({ n: 2, after: true }, 'extreme_close_up'), 'reaction');
  assert.strictEqual(S.planShot({ n: 1, expr: 'sad' }, 'medium'), 'high_angle');
  assert.strictEqual(S.planShot({ n: 1, moving: true }, 'medium'), 'full');
  let prev = ''; const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const s = S.planShot({ first: i === 0, n: 1 + (i % 3 ? 1 : 0), expr: ['neutral', 'happy', 'sad', 'neutral'][i % 4], big: i % 9 === 8, after: i % 9 === 0 && i > 0, sec: 3 }, prev);
    assert.notStrictEqual(s, prev, 'repeat at ' + i); assert.ok(S.SHOTS[s]); seen.add(s); prev = s;
  }
  assert.ok(seen.size >= 6, 'variety: ' + [...seen].join());
});
ok('hold time: a very short beat gets no slow move and no extreme close-up', () => {
  for (let i = 0; i < 30; i++) {
    const s = S.planShot({ n: 1, expr: ['neutral', 'happy'][i % 2], big: i % 2 === 0, sec: 0.9 }, ['medium', 'close_up', ''][i % 3]);
    assert.ok(!SHOTS_MOVE(s) && s !== 'extreme_close_up', s);
  }
  function SHOTS_MOVE(s) { return !!S.SHOTS[s].move; }
});

const story = '---\ntitle: Raju\nmode: story\ncast: Raju (boy, blue shirt); Meena (woman, red saree)\n---\n\n## One\n[Raju] I want to open a shop.\n[Meena] Then start small and save every day.\n\n## Two\n[Raju] I won the lottery! Wow, I cannot believe it!\n[Meena] That is wonderful news for us.\n\n## Three\n[Meena] Let us walk to the market together.\n[Raju] Yes, I am so happy today.\n';
const shotsOf = (plan) => plan.scenes.flatMap((s) => (s.beats && s.beats.length > 1 ? s.beats : [s]).filter((b) => b.kind === 'story').map((b) => b.data.camera));
ok('backup planner on a real story: valid shots, first is wide, no repeats, camera points at a cast member', () => {
  const parsed = parseText(story, 's');
  const plan = validatePlan({ source: 'rules', scenes: [] }, parsed, rulePlan(parsed));
  const cams = shotsOf(plan);
  assert.ok(cams.length >= 3, 'story beats: ' + cams.length);
  assert.strictEqual(cams[0].shot, 'establishing');
  cams.forEach((c, i) => { assert.ok(S.SHOTS[c.shot], c.shot); if (i) assert.notStrictEqual(c.shot, cams[i - 1].shot, 'repeat at ' + i); if (c.on) assert.ok(['raju', 'meena'].includes(c.on)); });
  console.log('       shots: ' + cams.map((c) => c.shot).join(' > '));
});
ok('an AI plan with invented and repeated shots is repaired, never rejected', () => {
  const parsed = parseText(story, 's2');
  const mk = (shot) => ({ setting: 'village', time: 'day', actors: [{ id: 'raju', x0: .3, x1: .3, facing: 1, pose: 'idle', expr: 'happy', speaks: true }], props: [], shot, on: 'raju' });
  const ai = { source: 'ai', template: 'tips', scenes: parsed.scenes.map((s, i) => ({ index: s.index, kind: 'story', data: mk(['dutch tilt', 'Close-Up', 'closeup'][i % 3]), beats: [] })) };
  const plan = validatePlan(ai, parsed, rulePlan(parsed));
  const cams = shotsOf(plan);
  cams.forEach((c, i) => { assert.ok(S.SHOTS[c.shot], c.shot); if (i) assert.notStrictEqual(c.shot, cams[i - 1].shot); });
});

ok('the stage renders every shot (portrait and landscape) and the camera really changes the picture', () => {
  const d = (shot) => ({ setting: 'village', time: 'day', actors: [{ id: 'a', x0: .3, x1: .3, facing: 1, pose: 'idle', expr: 'happy', speaks: true }, { id: 'b', x0: .7, x1: .7, facing: -1, pose: 'idle', expr: 'neutral' }], props: [], camera: { shot, on: 'a' } });
  const o = (w, h) => ({ w, h, t: 1, beatSec: 3, cast: { a: { id: 'a', name: 'Raju' }, b: { id: 'b', name: 'Meena' } }, speakers: ['a'], wordIdx: 0 });
  const seen = new Set();
  for (const [w, h] of [[1080, 1920], [1920, 1080]]) for (const k of S.NAMES) {
    const svg = stageSvg(d(k), o(w, h)); assert.ok(/<svg/.test(svg) && !/NaN|undefined/.test(svg), k + ' ' + w); seen.add(svg.match(/<g transform="translate\([^)]*\)[^"]*"/g)[0]);
  }
  assert.ok(seen.size >= 10, 'shots give different cameras: ' + seen.size);
  assert.ok(/rotate\(-?\d/.test(stageSvg(d('low_angle'), o(1080, 1920))), 'low angle tilts');
});
console.log(`shots.test.js: ${n}/${n} checks passed`);
