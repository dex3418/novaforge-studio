'use strict';
// Blocking: lanes, facing, speakers and spacing. Each case is a bug seen in a real render.
const assert = require('assert');
const B = require('../src/blocking');
const { stageSvg } = require('../src/story_stage');
const { normalizeStory } = require('../src/story');
let n = 0;
const ok = (name, fn) => { fn(); n++; };
const get = (r, id) => r.actors.find((a) => a.id === id);

ok('a walker who crosses a standing person takes the front lane; people nobody crosses stay on the base lane', () => {
  const r = B.analyse([{ id: 'naina', x0: 0.1, x1: 0.9 }, { id: 'raju', x0: 0.6, x1: 0.6 }, { id: 'amit', x0: 0.2, x1: 0.2 }]);
  assert.strictEqual(r.lanes.naina, 1);
  assert.strictEqual(r.lanes.raju, 0);
  assert.ok(r.warnings.some((w) => w.code === 'passes_in_front' && w.id === 'naina'));
  const free = B.analyse([{ id: 'naina', x0: 0.1, x1: 0.4 }, { id: 'raju', x0: 0.8, x1: 0.8 }]);
  assert.strictEqual(free.lanes.naina, 0, 'no one in the way, no lane change');
});
ok('two walkers who cross: the later one takes the front lane', () => {
  const r = B.analyse([{ id: 'a', x0: 0.1, x1: 0.9 }, { id: 'b', x0: 0.9, x1: 0.1 }]);
  assert.strictEqual(r.lanes.a, 0); assert.strictEqual(r.lanes.b, 1);
});
ok('a standing person with no direction faces the nearest other person', () => {
  const r = B.analyse([{ id: 'a', x0: 0.3, x1: 0.3, facing: -1, speaks: true }, { id: 'b', x0: 0.7, x1: 0.7, facing: 1 }]);
  assert.strictEqual(get(r, 'a').faceTo, 0.7);
  assert.strictEqual(get(r, 'b').faceTo, 0.3);
  assert.ok(r.warnings.some((w) => w.code === 'faced_away' && w.id === 'a'), 'the speaker who faced away is reported');
  const kept = B.analyse([{ id: 'a', x0: 0.3, x1: 0.3, faceTo: 0.1 }, { id: 'b', x0: 0.7, x1: 0.7 }]);
  assert.strictEqual(get(kept, 'a').faceTo, 0.1, 'a direction the plan gave is kept');
});
ok('a lone person is left alone', () => {
  const r = B.analyse([{ id: 'a', x0: 0.3, x1: 0.3, facing: -1 }]);
  assert.strictEqual(get(r, 'a').faceTo, undefined);
  assert.deepStrictEqual(r.warnings, []);
});
ok('a speaker does not walk away from everybody, but may walk toward someone or toward the group', () => {
  const away = B.analyse([{ id: 'a', x0: 0.5, x1: 0.95, speaks: true }, { id: 'b', x0: 0.2, x1: 0.2 }]);
  assert.strictEqual(get(away, 'a').x1, 0.5);
  assert.ok(away.warnings.some((w) => w.code === 'speaker_walks_away'));
  const toward = B.analyse([{ id: 'a', x0: 0.9, x1: 0.5, speaks: true }, { id: 'b', x0: 0.2, x1: 0.2 }]);
  assert.strictEqual(get(toward, 'a').x1, 0.5);
  assert.ok(!toward.warnings.some((w) => w.code === 'speaker_walks_away'));
  const silentLeaves = B.analyse([{ id: 'a', x0: 0.5, x1: 0.95 }, { id: 'b', x0: 0.2, x1: 0.2, speaks: true }]);
  assert.strictEqual(get(silentLeaves, 'a').x1, 0.95, 'someone who is not speaking may leave');
});
ok('a walk never ends inside another person', () => {
  const r = B.analyse([{ id: 'a', x0: 0.1, x1: 0.62 }, { id: 'b', x0: 0.6, x1: 0.6 }]);
  assert.ok(Math.abs(get(r, 'a').x1 - 0.6) >= B.SPACE - 1e-9, 'a.x1=' + get(r, 'a').x1);
  assert.ok(get(r, 'a').x1 < 0.6, 'stops on the side they came from');
  assert.ok(r.warnings.some((w) => w.code === 'ends_inside'));
});
ok('people who leave the frame are not blocked, spaced or faced', () => {
  const r = B.analyse([{ id: 'a', x0: 0.3, x1: 1.3 }, { id: 'b', x0: 0.7, x1: 0.7 }]);
  assert.strictEqual(get(r, 'a').x1, 1.3);
});
ok('the input is never changed, and a second pass changes nothing', () => {
  const input = [{ id: 'a', x0: 0.5, x1: 0.95, speaks: true }, { id: 'b', x0: 0.2, x1: 0.2 }];
  const copy = JSON.stringify(input);
  const r1 = B.analyse(input);
  assert.strictEqual(JSON.stringify(input), copy);
  const r2 = B.analyse(r1.actors);
  assert.deepStrictEqual(r2.actors, r1.actors);
});
ok('normalizeStory applies it and carries the reasons as notes', () => {
  const d = normalizeStory({ setting: 'village', time: 'day', actors: [{ id: 'a', x0: 0.5, x1: 0.95, speaks: true }, { id: 'b', x0: 0.2, x1: 0.2 }] }, ['a', 'b'], null);
  assert.strictEqual(d.actors.find((x) => x.id === 'a').x1, 0.5);
  assert.ok(Array.isArray(d.notes) && d.notes.length >= 1);
});
ok('the stage draws the walker nearer the camera when it crosses someone, and the render has no NaN', () => {
  const beat = (x1) => ({ setting: 'village', time: 'day', props: [], camera: { z0: 1, z1: 1, fx0: 0.5 }, actors: [{ id: 'n', x0: 0.1, x1 }, { id: 'r', x0: 0.6, x1: 0.6, pose: 'idle' }] });
  const o = { w: 1920, h: 1080, t: 1.2, beatSec: 4, art: 'flat', cast: { n: { id: 'n', name: 'N', look: {} }, r: { id: 'r', name: 'R', look: {} } }, seed: 1 };
  const cross = stageSvg(beat(0.9), o), apart = stageSvg(beat(0.3), o);
  assert.ok(!/NaN|undefined/.test(cross));
  const feet = (svg) => (svg.match(/translate\([\d.]+ (7\d\d|8\d\d)\)/g) || []).map((s) => Number(s.match(/ (\d+)\)/)[1]));
  assert.ok(feet(cross).includes(735 + 46), 'the crossing walker stands one lane nearer (y 781): ' + feet(cross));
  assert.ok(!feet(apart).some((y) => y > 760), 'with nobody in the way the walker stays on the base lane: ' + feet(apart));
});
console.log(`blocking: ${n} checks passed`);
