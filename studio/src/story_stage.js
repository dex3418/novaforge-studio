'use strict';
// Draws one story beat as a full-frame SVG: place + props + cast + camera.
// d = beat data from the storyboard (see story.js), o = how to draw it right now.

const A = require('./story_art');
const { ICONS } = require('./icons');
const SH = require('./shots');

const { clamp, ease, esc } = A;
const r1 = (n) => Math.round(n * 10) / 10;
const lerp = (a, b, p) => a + (b - a) * p;
const FEET = 735;

function stageSvg(d, o) {
  const W = r1((1000 * o.w) / o.h);
  const still = !!o.still;
  const t = still ? 2.2 : o.t || 0;
  const dur = Math.max(0.8, o.beatSec || 3);
  const night = d.time === 'night';
  const seed = o.seed || 0;
  const pl = A.place(d.setting, d.time, W, t, seed);
  const accent = o.accent || '#cb3bcc';
  const art = o.art === 'chibi' || o.art === 'webtoon' ? o.art : 'flat';
  const propLine = art === 'chibi' ? ' stroke="#4a2f3a" stroke-width="3" stroke-linejoin="round"' : art === 'webtoon' ? ' stroke="#33252c" stroke-width="1.8" stroke-linejoin="round"' : '';
  const cast = o.cast || {};

  // who is speaking right now (narrator = nobody on screen speaks)
  let speaker = '';
  let mouth = 0;
  if (!still && o.speakers && o.speakers.length) {
    const i = Math.min(o.wordIdx || 0, o.speakers.length - 1);
    speaker = o.speakers[i] || '';
    const ws = o.wordStarts && o.wordStarts[i];
    const we = o.wordStarts && o.wordStarts[i + 1] != null ? o.wordStarts[i + 1] : ws + 0.4;
    if (ws != null && t >= ws && t < Math.min(we, ws + 0.55)) mouth = 0.3 + 0.7 * Math.abs(Math.sin((t - ws) * 17));
  }

  // camera
  const cam = d.camera || {};
  const q = ease(t / dur);
  const land = 1;
  let z = lerp(cam.z0 || 1, cam.z1 || cam.z0 || 1, q) * land;
  let rot = 0;
  let tagsOff = false;
  let fx = lerp(cam.fx0 == null ? 0.5 : cam.fx0, cam.fx1 == null ? (cam.fx0 == null ? 0.5 : cam.fx0) : cam.fx1, q) * W;
  let fy = still ? 600 : 520; // slides: lift the scene so the text box does not cover the legs
  const shake = cam.shake && !still ? Math.max(0, 1 - t / 0.6) * 9 : 0;
  const sx = shake ? Math.sin(t * 52) * shake : 0;
  const sy = shake ? Math.cos(t * 44) * shake * 0.6 : 0;
  const layer = (k, inner) => {
    const zk = 1 + (z - 1) * k;
    const fxk = W / 2 + (fx - W / 2) * k;
    return `<g transform="translate(${r1(W / 2 + sx * k)} ${r1(500 + sy * k)})${rot ? ` rotate(${r1(rot * k * 100) / 100})` : ''} scale(${r1(zk * 1000) / 1000}) translate(${r1(-fxk)} ${-fy})">${inner}</g>`;
  };

  // props
  const back = [];
  const front = [];
  (d.props || []).forEach((p, i) => {
    const fn = A.PROPS[p.type];
    if (!fn) return;
    const mover = A.MOVERS.has(p.type);
    const x0 = (p.x == null ? 0.5 : p.x) * W;
    const x1 = (p.x1 == null ? p.x == null ? 0.5 : p.x : p.x1) * W;
    const pp = still ? 0.65 : mover ? clamp((t - 0.05) / (dur * 0.95)) : 1;
    const x = lerp(x0, x1, mover ? pp : 1);
    const spin = mover ? (x - x0) / 34 : 0;
    const road = d.setting === 'street' ? pl.groundTop + 215 : pl.groundTop + 190;
    const y = mover ? road : p.layer === 'front' ? FEET + 20 : pl.groundTop + 36 + (i % 2) * 8;
    const face = x1 < x0 ? -1 : 1;
    const s = p.scale || 1;
    const body = fn({ t, scale: s, night, spin: face < 0 ? -spin : spin, color: p.color, seed: i * 1.7 });
    const g = `<g transform="translate(${r1(x)} ${y}) scale(${face} 1)"><g${propLine}>${body}</g></g>`;
    (mover || p.layer === 'front' ? front : back).push(g);
  });

  // actors
  const acts = (d.actors || []).map((a, i) => {
    const ch = cast[a.id] || { id: a.id, name: a.id };
    const x0 = a.x0 == null ? 0.5 : a.x0;
    const x1 = a.x1 == null ? x0 : a.x1;
    const dist = Math.abs(x1 - x0);
    const wd = clamp(dist * 3.0, 0.55, 1.8);
    const p = still ? 1 : ease((t - (a.delay || 0.12)) / wd);
    const moving = dist > 0.02 && (still ? true : p < 1);
    const x = lerp(x0, x1, p) * W;
    let facing = a.facing || (x1 >= x0 ? 1 : -1);
    if (dist > 0.02) facing = x1 >= x0 ? 1 : -1;
    if (!moving && a.faceTo != null) facing = a.faceTo >= lerp(x0, x1, 1) ? 1 : -1;
    let pose = moving ? 'walk' : a.pose === 'walk' ? 'idle' : a.pose || 'idle';
    const isSp = !!speaker && speaker === a.id;
    if (!moving && !still && speaker && speaker !== 'narrator') {
      if (isSp && (pose === 'idle' || pose === 'listen')) pose = 'talk';
      else if (!isSp && pose === 'idle' && (d.actors || []).length > 1) pose = 'listen';
    }
    if (still && pose === 'idle' && a.speaks) pose = 'talk';
    // right after a walk ends the figure eases into its next pose instead of snapping (registry characters use it)
    const settle = (a.delay || 0.12) + wd;
    const eased = !still && dist > 0.02 && !moving && t - settle < 0.3;
    return {
      prev_pose: eased ? 'walk' : null, blend: eased ? clamp((t - settle) / 0.3) : 1,
      id: a.id, name: ch.name, look: ch.look, x, y: FEET + ((i * 17) % 34), facing,
      pose, art, expr: a.expr || 'neutral', mouth: isSp ? mouth : 0, walk: t * 9.5 + i, scale: (a.scale || 1) * 1.0, t: t + i * 0.7,
      alpha: still ? 1 : clamp((t + 0.02) / 0.18), isSp,
    };
  });
  acts.sort((a, b) => a.y - b.y || a.x - b.x);

  // a named shot (close_up, two_shot, ...) is turned into camera numbers here, from where the people really stand
  if (cam.shot) {
    const info = acts.map((a) => {
      const da = (d.actors || []).find((x) => x.id === a.id) || {};
      const x1 = da.x1 == null ? (da.x0 == null ? 0.5 : da.x0) : da.x1;
      return { id: a.id, x: x1, y: a.y, h: A.heightOf(art) * (a.look && a.look.age === 'child' ? 0.68 : 1) * (a.scale || 1), speaks: !!da.speaks };
    });
    const f = SH.frame(cam, { W, H: 1000, actors: info });
    if (f) {
      z = lerp(f.z0, f.z1, q);
      fx = lerp(f.fx0, f.fx1, q) * W;
      if (f.fy0 != null) fy = lerp(f.fy0, f.fy1 == null ? f.fy0 : f.fy1, q);
      rot = lerp(f.rot0, f.rot1, q);
      if (z > 2.2) tagsOff = true; // a name tag floating over a close-up covers the face
    }
  }

  const actorSvg = acts.map((a) => A.person(a)).join('');
  // name tags over the speaker (only when more than one character is on screen)
  let tags = '';
  const many = acts.length > 1 || (d.actors || []).length > 1;
  acts.forEach((a) => {
    if (!many || !(a.isSp || (still && (d.actors || []).find((x) => x.id === a.id && x.speaks)))) return;
    const s = (a.look && a.look.age === 'child' ? 0.68 : 1) * (a.scale || 1) * (A.heightOf(art) / 398);
    const label = String(a.name || '').slice(0, 14);
    const wd = 34 + label.length * 17;
    tags += `<g transform="translate(${r1(a.x)} ${r1(a.y - 398 * s - 34)})"><rect x="${-wd / 2}" y="-26" width="${wd}" height="46" rx="23" fill="${accent}"/><text x="0" y="7" text-anchor="middle" font-size="28" font-weight="800" fill="#fff" font-family="${esc(o.font || 'sans-serif')}">${esc(label)}</text></g>`;
  });
  let bub = '';
  if (d.icon && ICONS[d.icon] && acts.length) {
    const who = acts.find((a) => a.id === d.iconOf) || acts[0];
    const s = (who.look && who.look.age === 'child' ? 0.68 : 1) * (A.heightOf(art) / 398);
    bub = A.bubble(who.x + 90, who.y - 500 * s, ICONS[d.icon], t, accent);
  }
  const learnedScene = !!A.LEARNED_SCENES[d.setting];
  const birdsSvg = !night && !learnedScene && d.setting !== 'office' && d.setting !== 'home' && d.setting !== 'street' ? A.birds(W, t) : '';

  const scene =
    (art === 'webtoon' && !learnedScene ? `<g filter="url(#bl${seed})">${layer(0.25, pl.far + birdsSvg)}</g>` : layer(0.25, pl.far + birdsSvg)) +
    layer(0.55, pl.mid + back.join('')) +
    layer(1, pl.ground + front.join('') + actorSvg + (tagsOff ? '' : bub + tags));
  const tint = night ? `<rect x="0" y="0" width="${W}" height="1000" fill="#0a1030" opacity=".22"/>` : d.time === 'dusk' ? `<rect x="0" y="0" width="${W}" height="1000" fill="#ff7a3c" opacity=".08"/>` : '';
  let extra = '';
  let css = '';
  if (art === 'webtoon') {
    css = 'filter:saturate(.94) contrast(1.05);';
    extra += `<defs><radialGradient id="vg${seed}" cx="50%" cy="48%" r="75%"><stop offset="60%" stop-color="#1a0f2e" stop-opacity="0"/><stop offset="100%" stop-color="#1a0f2e" stop-opacity=".34"/></radialGradient></defs><rect x="0" y="0" width="${W}" height="1000" fill="url(#vg${seed})"/>`;
    for (let i = 0; i < 9; i++) extra += `<circle cx="${r1(((i * 211) % 1000) / 1000 * W)}" cy="${r1(120 + ((i * 137) % 520))}" r="${6 + (i % 4) * 5}" fill="#fff" opacity="${r1((0.1 + 0.08 * Math.sin(t * 1.4 + i)) * 100) / 100}"/>`;
  } else if (art === 'chibi') {
    css = 'filter:saturate(1.22) brightness(1.04);';
    const star = (x, y, s, ph) => `<path transform="translate(${r1(x)} ${r1(y)}) scale(${r1(s * (0.8 + 0.2 * Math.sin(t * 3 + ph)) * 100) / 100}) rotate(${r1(Math.sin(t + ph) * 15)})" d="M0 -14 L4 -4 L14 0 L4 4 L0 14 L-4 4 L-14 0 L-4 -4Z" fill="#fff" opacity=".9"/>`;
    for (let i = 0; i < 7; i++) extra += star(((i * 173 + 90) % 1000) / 1000 * W, 90 + ((i * 97) % 420), 0.8 + (i % 3) * 0.35, i * 1.7);
  }
  const stkDefs = art === 'chibi' ? '<filter id="nfStk" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="7" result="d"/><feFlood flood-color="#ffffff"/><feComposite in2="d" operator="in" result="w"/><feMerge><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' : '';
  const blurDefs = (art === 'webtoon' ? `<filter id="bl${seed}"><feGaussianBlur stdDeviation="3.2"/></filter>` : '') + stkDefs;
  const fade = still ? 1 : clamp(t / 0.3);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 1000" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0;width:100%;height:100%;opacity:${r1(fade * 100) / 100};${css}">` +
    `<defs>${pl.defs}${blurDefs}</defs>${scene}${tint}${extra}</svg>`
  );
}

module.exports = { stageSvg };
