'use strict';
// Learned props and landscapes (approved in the Learning Studio, baked into library_data.js) turned into the same
// shapes the story art already uses. Pure and bundle-safe. A learned name replaces a built-in one of the same name.
//
// Props: origin = ground centre, drawn upward, about 240 units tall (a person is ~400) unless library/prop/<style>/<set>.json
// says {"name": {"height": 320}}. Landscapes: one picture covering the whole stage, behind everything.

const r4 = (n) => Math.round(n * 10000) / 10000;
const r1 = (n) => Math.round(n * 10) / 10;

function propFn(e) {
  const bw = e.bbox.x1 - e.bbox.x0, bh = e.bbox.y1 - e.bbox.y0;
  const k = Math.min((e.height || 240) / bh, 420 / bw);
  const cx = (e.bbox.x0 + e.bbox.x1) / 2;
  // stroke="none" so the outline the story adds to built-in props does not get drawn on top of the learned art
  return (p) => `<g stroke="none" transform="scale(${r4(k * (p.scale || 1))}) translate(${r1(-cx)} ${r1(-e.bbox.y1)})">${e.svg}</g>`;
}

function sceneLayers(e, W) {
  const span = W + 600, x0 = -300, y0 = -100, H = 1300;
  const k = Math.max(span / e.w, H / e.h);
  const tx = x0 + (span - e.w * k) / 2, ty = y0 + (H - e.h * k) / 2;
  return {
    far: `<g stroke="none" transform="translate(${r1(tx)} ${r1(ty)}) scale(${r4(k)})">${e.svg}</g>`,
    mid: '', ground: '', defs: '', ink: '#9ad1a0', groundTop: 600,
  };
}

// target = { PROPS, SETTINGS, LEARNED_SCENES, LEARNED_PROPS }
function register(target, lib) {
  for (const [name, e] of Object.entries((lib && lib.props) || {})) { target.PROPS[name] = propFn(e); target.LEARNED_PROPS.push(name); }
  for (const [name, e] of Object.entries((lib && lib.landscapes) || {})) {
    target.LEARNED_SCENES[name] = e;
    if (!target.SETTINGS.includes(name)) target.SETTINGS.push(name);
  }
}

module.exports = { propFn, sceneLayers, register };
