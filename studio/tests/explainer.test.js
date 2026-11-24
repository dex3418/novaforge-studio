'use strict';
// The explainer scene: cleaning, timing from the spoken words, both charts, both shapes, bad data never breaks a frame.
const assert = require('assert');
const X = require('../src/explainer');
const S = require('../src/scenes');
const { KINDS } = require('../src/catalog');
let n = 0; const ok = (name, fn) => { fn(); n++; };
const nar = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
const bars = () => ({ chart: 'bars', values: [3, 8, 2, 6, 1, 4], labels: ['a', 'b'], cues: [
  { frac: 0.1, op: 'tag', target: 4, text: 'buy', tone: 'buy' }, { frac: 0.3, op: 'hi', target: 1 }, { frac: 0.5, op: 'arc', target: 4, to: 1, text: '+7' },
  { frac: 0.7, op: 'note', text: '8 - 1 = 7 ?' }, { frac: 0.85, op: 'strike' }] });
const flow = () => ({ chart: 'flow', look: 'neon', nodes: [{ id: 'a', label: 'Prompt' }, { id: 'b', label: 'Opus' }, { id: 'c', label: 'Tool' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'calls' }], cues: [{ frac: 0, op: 'show', target: 'a' }, { frac: 0.4, op: 'show', target: 'b' }, { frac: 0.7, op: 'show', target: 'c' }, { frac: 0.8, op: 'hi', target: 'c', tone: 'buy' }] });
const frame = (d, f, w = 1080, h = 1920, mode = 'video') => S.renderScene({ mode, w, h, fps: 30, frame: f, sceneFrames: 200, audioFrames: 180, scene: { kind: 'explainer', data: d, narration: nar, emotion: 'neutral', index: 1 }, wordIdx: 0, brand: 'B', handle: '@h' });

ok('explainer is a known kind with a stage', () => { assert.ok(KINDS.includes('explainer')); assert.strictEqual(typeof S.STAGES.explainer, 'function'); });
ok('good data is kept, in time order', () => {
  const d = X.normalize(bars()); assert.strictEqual(d.cues.length, 5);
  assert.ok(d.cues.every((c, i) => i === 0 || c.frac >= d.cues[i - 1].frac));
});
ok('bad data is refused or trimmed, never trusted', () => {
  assert.strictEqual(X.normalize(null), null); assert.strictEqual(X.normalize({ chart: 'pie' }), null);
  assert.strictEqual(X.normalize({ chart: 'bars', values: [1] }), null); assert.strictEqual(X.normalize({ chart: 'bars', values: [1, 'x'] }), null);
  assert.strictEqual(X.normalize({ chart: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }), null, 'duplicate ids');
  const b = bars(); b.cues.push({ op: 'hi', target: 99 }, { op: 'explode', target: 1 }, { op: 'arc', target: 1, to: 1 }, { op: 'tag', target: 1 }, { op: 'tag', target: '', text: 'x' });
  assert.strictEqual(X.normalize(b).cues.length, 5, 'unknown targets, ops and empty text are dropped');
  const f = flow(); f.links.push({ from: 'a', to: 'zzz' }, { from: 'a', to: 'a' }); assert.strictEqual(X.normalize(f).links.length, 2);
  const many = bars(); many.cues = Array.from({ length: 30 }, () => ({ op: 'hi', target: 0 })); assert.strictEqual(X.normalize(many).cues.length, 12);
});
ok('no cues still gives something to show', () => {
  assert.strictEqual(X.normalize({ chart: 'bars', values: [1, 5, 2] }).cues[0].target, 1);
  assert.strictEqual(X.normalize({ chart: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }).cues.length, 2);
});
ok('the picture changes with the spoken time: arc and strike appear later, never before', () => {
  const early = frame(bars(), 5), mid = frame(bars(), 95), late = frame(bars(), 175);
  assert.ok(!/stroke-dasharray/.test(early) && !/8 - 1/.test(early));
  assert.ok(/stroke-dasharray/.test(mid)); assert.ok(/8 - 1 = 7/.test(late));
  assert.ok((late.match(/<line /g) || []).length > (mid.match(/<line /g) || []).length, 'the strike line is drawn');
});
ok('flow shows boxes one by one, and links only between boxes already shown', () => {
  const a = frame(flow(), 10), b = frame(flow(), 90), c = frame(flow(), 190);
  const boxes = (h) => (h.match(/<rect /g) || []).length;
  assert.ok(boxes(a) < boxes(b) && boxes(b) < boxes(c) || boxes(a) === 1);
  assert.ok(!/calls/.test(a) && /calls/.test(c));
});
ok('works in tall and wide pictures, and as a still slide', () => {
  for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]]) for (const d of [bars(), flow()]) assert.ok(/<svg/.test(frame(d, 120, w, h)));
  const slide = frame(bars(), 0, 1080, 1080, 'slide'); assert.ok(/8 - 1 = 7/.test(slide) && /stroke-dasharray/.test(slide), 'a slide shows the finished picture');
});
ok('bad data inside a scene falls back to the caption card instead of failing', () => {
  const html = frame({ chart: 'bars', values: [1] }, 50); assert.ok(typeof html === 'string' && html.length > 200 && !/<svg viewBox="0 0 800/.test(html));
});
ok('text is escaped', () => {
  const b = bars(); b.cues[3].text = '<img src=x onerror=alert(1)>'; const html = frame(b, 190);
  assert.ok(!/<img src=x/.test(html));
});
ok('an AI plan with an explainer beat keeps it (cleaned); a broken one is replaced', () => {
  const { parseText } = require('../src/parse'); const { validatePlan, rulePlan } = require('../src/plan'); const { buildPrompt } = require('../src/director');
  const parsed = parseText('---\ntitle: Stocks\n---\n\n## One\nBuy at one. Sell at eight. That is a profit of seven. Right? Wrong.\n', 'ex');
  const mk = (data) => ({ source: 'ai', template: 'tips', scenes: parsed.scenes.map((sc) => ({ index: sc.index, kind: 'explainer', data, beats: [{ fromSentence: 0, toSentence: 4, kind: 'explainer', data }] })) });
  const kinds = (pl) => pl.scenes.flatMap((x) => [x.kind, ...(x.beats || []).map((b) => b.kind)]);
  const good = validatePlan(mk(bars()), parsed, rulePlan(parsed));
  assert.ok(kinds(good).includes('explainer'), kinds(good).join());
  const bad = validatePlan(mk({ chart: 'bars', values: [1] }), parsed, rulePlan(parsed));
  assert.ok(!kinds(bad).includes('explainer'), kinds(bad).join());
  assert.ok(/explainer/.test(buildPrompt(parsed, {}) || ''), 'the director is told about it');
});
console.log(`explainer.test.js: ${n} tests passed`);
