'use strict';
// Learned art goes to production: what the Learning Studio saves (via its server) is baked by the build tool and drawn
// by the real renderer. Uses a throw-away folder, never touches the repo's own characters/ or library/.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfl-learned-'));
process.env.NF_ROOT = tmp;
const { save } = require('../tools/learn_server');

const svgOf = (vbw, vbh, ow, oh, fill, x0 = 10, y0 = 10, x1 = vbw - 10, y1 = vbh - 10) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbw} ${vbh}" width="${ow}" height="${oh}"><path fill="${fill}" fill-rule="evenodd" d="M${x0},${y0} L${x1},${y0} L${x1},${y1} L${x0},${y1} Z"/></svg>`;
const put = (category, group, name, svg, style = 'ghibli') => save({ category, style, group, name, svg, score: 96, paths: 1, w: 1, h: 1, palette: [], params: {} });

// a character: five views of a 100x200 drawing (3 px per unit), a sitting pose at the same pixel scale, a happy face
const ANG = { front: '#ff0001', front_left_45: '#ff0002', left_profile: '#ff0003', right_profile: '#ff0004', front_right_45: '#ff0005' };
for (const [a, c] of Object.entries(ANG)) put('character', 'tess', a, svgOf(100, 200, 300, 600, c));
put('pose', 'tess', 'sitting', svgOf(100, 120, 300, 360, '#00ff06'));
put('pose', 'tess', 'waving', svgOf(100, 200, 300, 600, '#00ff07'));
put('emotion', 'tess', 'happy', svgOf(100, 200, 300, 600, '#0000ff'));
put('prop', 'office_props', 'chair', svgOf(100, 100, 100, 100, '#c0ffee'));
put('landscape', 'town', 'market', svgOf(200, 100, 800, 400, '#5ec0de'));
put('character', 'naina', 'front', svgOf(100, 200, 300, 600, '#ff0010')); // learned art next to a real rigged character is ignored for angles

const outChars = path.join(tmp, 'chars_data.js'), outLib = path.join(tmp, 'lib_data.js');
const log = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build_characters.js')], { env: Object.assign({}, process.env, { NF_ROOT: tmp, NF_OUT: outChars, NF_LIB_OUT: outLib }) }).toString();
const data = require(outChars);
const lib = require(outLib);

let n = 0;
const ok = (name, fn) => { try { fn(); n++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); process.exitCode = 1; } };

ok('the build finds the learned character, props and landscapes', () => {
  assert.ok(data.tess && data.tess.learned_style === 'ghibli');
  assert.ok(lib.props.chair && lib.landscapes.market);
  assert.ok(/characters \[[^\]]*tess/.test(log) && /props \[chair\]/.test(log) && /landscapes \[market\]/.test(log), log);
});
ok('360 views become the idle drawings, poses and emotions are added', () => {
  const t = data.tess;
  assert.deepStrictEqual(Object.keys(t.variants.idle).sort(), Object.keys(ANG).sort());
  assert.ok(t.poses.includes('sit') && t.poses.includes('wave') && t.poses.includes('idle'), t.poses.join());
  assert.strictEqual(t.expression_art.happy, 'emo_happy');
  assert.ok(t.expressions.includes('happy'));
  assert.strictEqual(t.variants.idle.right_profile.faces, 1);
  assert.strictEqual(t.variants.idle.left_profile.faces, -1);
  assert.strictEqual(t.variants.idle.front.faces, 0);
});
ok('walking reuses the side views (alias), so a figure walks in profile', () => {
  assert.ok(data.tess.poses.includes('walk') && data.tess.pose_alias.walk === 'idle');
});
ok('relative scale is kept: a sitting drawing is drawn smaller than standing, not stretched to full height', () => {
  const sit = data.tess.variants.sit.any, front = data.tess.variants.idle.front;
  assert.ok(sit.stand_h > sit.bbox.y1 - sit.bbox.y0, `${sit.stand_h}`);
  assert.strictEqual(sit.shot, 'full'); // never mistaken for a head-and-shoulders close-up
  const drawn = (v) => (v.bbox.y1 - v.bbox.y0) / (v.stand_h || v.bbox.y1 - v.bbox.y0);
  assert.ok(Math.abs(drawn(sit) / drawn(front) - (300 / 540) / 1) < 0.02, `${drawn(sit)} ${drawn(front)}`);
});
ok('the repo\'s real rigged Naina is untouched (no learned art in the repo yet, so nothing changes for videos)', () => {
  const real = require('../src/characters_data');
  assert.ok(real.naina && real.naina.angles.front.svg.includes('{{head}}'), 'rigged angles present');
  assert.ok(!real.naina.learned_style && !real.naina.expression_art);
  assert.deepStrictEqual(Object.keys(require('../src/library_data')), ['props', 'landscapes']);
});

// ---- render with the real renderer using this build
const CH = require('../src/characters');
CH.setData(data);
const A = require('../src/story_art');
const draw = (o) => A.person(Object.assign({ id: 'tess', name: 'Tess', x: 100, y: 700, facing: 1, pose: 'idle', expr: 'neutral', art: 'flat', mouth: 0, walk: 0, t: 0, scale: 1 }, o));
ok('the right drawing is picked by facing, pose and expression', () => {
  assert.ok(draw({ facing: 1 }).includes('#ff0005'), 'idle facing right = front_right_45');
  assert.ok(draw({ facing: -1 }).includes('#ff0002'), 'idle facing left = front_left_45');
  assert.ok(draw({ pose: 'walk', facing: 1 }).includes('#ff0004'), 'walk facing right = right_profile');
  assert.ok(draw({ pose: 'walk', facing: -1 }).includes('#ff0003'), 'walk facing left = left_profile');
  assert.ok(draw({ pose: 'wave' }).includes('#00ff07'));
  assert.ok(draw({ pose: 'sit' }).includes('#00ff06'));
  assert.ok(draw({ expr: 'happy' }).includes('#0000ff'), 'happy expression uses the learned emotion');
  assert.ok(!draw({ expr: 'happy', pose: 'walk' }).includes('#0000ff'), 'a walking figure keeps walking');
});
ok('a pose the character does not have falls back to idle and is reported, never invented', () => {
  CH.drainWarnings();
  const s = draw({ pose: 'fist' });
  assert.ok(s.includes('#ff0005'));
  assert.ok(CH.drainWarnings().some((w) => /fist/.test(w)));
});
ok('learned characters can be recoloured into new ones (same drawings, other colours)', () => {
  const d2 = JSON.parse(JSON.stringify(data));
  d2.tess2 = { id: 'tess2', name: 'Tess 2', version: 1, extends: 'tess', recolor: [{ from_hue: [350, 360], min_sat: 0.2, to_hue: 200 }] };
  CH.setData(d2);
  const s = draw({ id: 'tess2', facing: 1 });
  assert.ok(!s.includes('#FF0005') && !s.includes('#ff0005') && /fill="#[0-9A-F]{6}"/.test(s), s.slice(0, 200));
  CH.setData(data);
});

// ---- props and landscapes through the real story stage
const LIBART = require('../src/library_art');
LIBART.register({ PROPS: A.PROPS, SETTINGS: A.SETTINGS, LEARNED_SCENES: A.LEARNED_SCENES, LEARNED_PROPS: A.LEARNED_PROPS }, lib);
const { stageSvg } = require('../src/story_stage');
const story = require('../src/story');
ok('a learned landscape and prop are accepted by the story and drawn by the stage', () => {
  assert.ok(A.SETTINGS.includes('market') && A.PROPS.chair);
  const beat = { setting: 'market', time: 'day', actors: [], props: [{ type: 'chair', x: 0.5, scale: 1 }], camera: { z0: 1, z1: 1 } };
  const svg = stageSvg(beat, { w: 1080, h: 1920, t: 1, beatSec: 3, art: 'webtoon', seed: 1, cast: {} });
  assert.ok(svg.includes('#5ec0de'), 'landscape drawn');
  assert.ok(svg.includes('#c0ffee'), 'prop drawn');
  assert.ok(!svg.includes('stroke="#33252c"') || svg.includes('stroke="none"'), 'learned prop is not outlined by the story');
  assert.ok(!/filter="url\(#bl1\)"/.test(svg), 'learned landscape is not blurred');
  const norm = story.normalizeStory({ setting: 'market', props: [{ type: 'chair', x: 0.4 }, { type: 'nonexistent', x: 0.2 }], actors: [] }, [], null);
  assert.strictEqual(norm.setting, 'market');
  assert.deepStrictEqual(norm.props.map((p) => p.type), ['chair']);
});
ok('the director is told about learned names', () => {
  const prompt = require('../src/director').buildPrompt({ scenes: [{ index: 1, heading: 'x', narration: 'Hello there.', lines: null }] });
  assert.ok(prompt.includes('market') && prompt.includes('chair'), 'setting and prop lists include learned names');
  assert.ok(prompt.includes('wave') && prompt.includes('sit') && /happy/.test(prompt), 'pose list includes learned poses');
});
console.log(`learned.test.js: ${n}/${n + (process.exitCode ? 1 : 0)} checks passed`);
