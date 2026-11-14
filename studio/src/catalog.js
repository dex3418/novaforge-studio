'use strict';
// One shared list of everything you can choose from: palettes, textures,
// templates and voices. The box page, the planner and the renderer all read it,
// so adding an entry here makes it available everywhere.

const L = (o) => ({ dark: false, card: 'rgba(0,0,0,0.05)', ...o });
const D = (o) => ({ dark: true, card: 'rgba(255,255,255,0.07)', ...o });

const PALETTES = {
  navy: D({ label: 'Midnight navy', bg: '#0b1020', bg2: '#1a2350', accent: '#ffb020', text: '#ffffff', muted: '#9aa4bf', onAccent: '#1a1300' }),
  paper: L({ label: 'Paper', bg: '#f7f3ea', bg2: '#ece3cf', accent: '#d9480f', text: '#1c1b18', muted: '#6b665c', onAccent: '#ffffff' }),
  saffron: L({ label: 'Saffron', bg: '#fff3e0', bg2: '#ffd9a3', accent: '#c2410c', text: '#2b1700', muted: '#7a5a33', onAccent: '#ffffff' }),
  forest: D({ label: 'Forest', bg: '#0d1f17', bg2: '#14352a', accent: '#7bd88f', text: '#f1fff6', muted: '#8fb3a0', onAccent: '#06210f' }),
  bold: D({ label: 'Black and yellow', bg: '#0a0a0a', bg2: '#1c1c1c', accent: '#ffd60a', text: '#ffffff', muted: '#a3a3a3', card: 'rgba(255,255,255,0.08)', onAccent: '#111111' }),
  ocean: D({ label: 'Ocean', bg: '#06202b', bg2: '#0b3c4f', accent: '#4cc9f0', text: '#f0fbff', muted: '#8bb7c7', onAccent: '#03212b' }),
  sunset: D({ label: 'Sunset', bg: '#1f0a1f', bg2: '#4a1942', accent: '#ff6b6b', text: '#fff5f0', muted: '#c9a0b4', onAccent: '#2a0010' }),
  mint: L({ label: 'Mint', bg: '#effaf4', bg2: '#cdeede', accent: '#0f9d74', text: '#0d2b22', muted: '#52786a', onAccent: '#ffffff' }),
  royal: D({ label: 'Royal violet', bg: '#0e0a2b', bg2: '#2a1b6b', accent: '#a78bfa', text: '#f5f3ff', muted: '#a9a2d6', onAccent: '#1a0f4a' }),
  rose: L({ label: 'Rose', bg: '#fff0f3', bg2: '#ffd6df', accent: '#e11d48', text: '#3a0a16', muted: '#8a4a5a', onAccent: '#ffffff' }),
  mono: D({ label: 'Mono', bg: '#111111', bg2: '#2a2a2a', accent: '#ffffff', text: '#f5f5f5', muted: '#9a9a9a', onAccent: '#111111' }),
  sand: L({ label: 'Sand and teal', bg: '#fbf6ea', bg2: '#efe2c0', accent: '#0b6e6e', text: '#2a2418', muted: '#7a6f55', onAccent: '#ffffff' }),
  sky: L({ label: 'Sky', bg: '#eaf6ff', bg2: '#c6e4ff', accent: '#1565d8', text: '#0a1f3d', muted: '#56708f', onAccent: '#ffffff' }),
  neon: D({ label: 'Neon green', bg: '#05060f', bg2: '#0d1b3a', accent: '#00f5a0', text: '#eafff7', muted: '#7fb8a4', onAccent: '#001a10' }),
  ember: D({ label: 'Ember', bg: '#1a0d06', bg2: '#3b1a0a', accent: '#ff9f1c', text: '#fff7ec', muted: '#c9a27a', onAccent: '#2b1400' }),
  vouchr: L({ label: 'Vouchr light', bg: '#ffffff', bg2: '#f7f5fc', accent: '#a428a5', text: '#17132b', muted: '#6e6890', onAccent: '#ffffff' }),
  vouchrnight: D({ label: 'Vouchr night', bg: '#17132b', bg2: '#2a2250', accent: '#cb3bcc', text: '#ffffff', muted: '#b4aed6', onAccent: '#ffffff' }),
  lilac: L({ label: 'Lilac', bg: '#f6f0ff', bg2: '#e2d4ff', accent: '#7c3aed', text: '#1f0f3d', muted: '#6f5a96', onAccent: '#ffffff' }),
};

// colours that look good together; a video walks through one family scene by scene
const FAMILIES = {
  night: ['navy', 'royal', 'neon', 'vouchrnight'],
  warm: ['saffron', 'ember', 'sand', 'sunset'],
  fresh: ['mint', 'ocean', 'forest', 'sky'],
  soft: ['paper', 'vouchr', 'lilac', 'rose'],
  bold: ['bold', 'sunset', 'mono', 'neon'],
  india: ['saffron', 'navy', 'forest', 'paper'],
};

const TEXTURES = {
  none: 'None',
  grain: 'Paper grain',
  dots: 'Halftone dots',
  grid: 'Graph grid',
  stripes: 'Diagonal stripes',
  topo: 'Contour lines',
  mesh: 'Mesh glow',
  geo: 'Geometric pattern',
  rings: 'Rings',
  waves: 'Waves',
  checks: 'Checkerboard',
  hex: 'Hexagons',
  scan: 'Scan lines',
  confetti: 'Confetti',
  blueprint: 'Blueprint',
  stars: 'Starfield',
  bokeh: 'Soft bokeh',
  cross: 'Crosshatch',
};

// Each template = a style pack. It suggests a colour family, some textures and which
// animations suit it, but the planner still mixes them per scene so posts never look alike.
const TEMPLATES = {
  tips: { label: 'Tips / How-to', family: 'night', textures: ['dots', 'mesh', 'grain', 'bokeh'], energy: 'mid' },
  budget: { label: 'Budget / Costs', family: 'soft', textures: ['grid', 'grain', 'dots', 'blueprint'], energy: 'mid' },
  jobs: { label: 'Recruitment notice', family: 'india', textures: ['geo', 'stripes', 'grain', 'checks'], energy: 'mid' },
  steps: { label: 'Step-by-step', family: 'fresh', textures: ['topo', 'grid', 'dots', 'hex'], energy: 'mid' },
  myth: { label: 'Myth vs Fact', family: 'night', textures: ['mesh', 'rings', 'dots', 'stars'], energy: 'high' },
  quote: { label: 'Quote / Motivation', family: 'soft', textures: ['grain', 'rings', 'mesh', 'bokeh'], energy: 'low' },
  news: { label: 'Announcement', family: 'bold', textures: ['stripes', 'grid', 'geo', 'scan'], energy: 'high' },
  event: { label: 'Event / Date', family: 'fresh', textures: ['rings', 'topo', 'mesh', 'waves'], energy: 'high' },
  explainer: { label: 'Explainer', family: 'fresh', textures: ['blueprint', 'dots', 'waves', 'grain'], energy: 'mid' },
  story: { label: 'Story', family: 'warm', textures: ['grain', 'bokeh', 'waves', 'mesh'], energy: 'low' },
  finance: { label: 'Money / Finance', family: 'night', textures: ['grid', 'blueprint', 'scan', 'dots'], energy: 'mid' },
  tech: { label: 'Tech / Startup', family: 'bold', textures: ['scan', 'hex', 'stars', 'blueprint'], energy: 'high' },
  education: { label: 'Learning / Exam', family: 'soft', textures: ['grid', 'cross', 'dots', 'grain'], energy: 'mid' },
  launch: { label: 'Launch / Product', family: 'bold', textures: ['stars', 'mesh', 'confetti', 'rings'], energy: 'high' },
  motivation: { label: 'Motivation', family: 'warm', textures: ['mesh', 'confetti', 'rings', 'bokeh'], energy: 'high' },
  lifestyle: { label: 'Lifestyle', family: 'soft', textures: ['waves', 'bokeh', 'grain', 'confetti'], energy: 'low' },
  review: { label: 'Review / Compare', family: 'india', textures: ['checks', 'cross', 'geo', 'dots'], energy: 'mid' },
  daily: { label: 'Daily update', family: 'fresh', textures: ['scan', 'stripes', 'grid', 'waves'], energy: 'mid' },
};

const TRANSITIONS = ['fade', 'slide', 'wipe', 'zoom', 'flip', 'bounce', 'rise', 'drop', 'circle', 'spin', 'split', 'blinds', 'elastic', 'shake', 'swipeup'];
const SCHEMES = ['base', 'pop', 'flip']; // colour change per beat: normal, accent background, light/dark flip
const DECORS = ['none', 'orbs', 'sweep', 'rings', 'bars', 'sparks', 'waves', 'shapes', 'orbit', 'comets', 'confetti']; // animated background shapes (video)
const HEADERS = ['top', 'pill', 'bottom', 'side']; // where brand and handle sit
const CSTYLES = ['chunk', 'pill', 'stack']; // caption look
const ALIGNS = ['center', 'top', 'bottom'];

// Every scene type the renderer can draw. The planner (rules now, AI later) may only use these.
const KINDS = [
  'caption', 'kinetic', 'counter', 'checklist', 'steps', 'quote',
  'qa', 'mythfact', 'compare', 'progress', 'alert', 'cta', 'keyword', 'stats', 'bars', 'spot',
];

const EMOTIONS = ['neutral', 'excited', 'serious', 'curious', 'calm'];

const VOICES = {
  edge: [
    { id: 'hi-IN-SwaraNeural', label: 'Swara - Hindi, female' },
    { id: 'hi-IN-MadhurNeural', label: 'Madhur - Hindi, male' },
    { id: 'en-IN-NeerjaNeural', label: 'Neerja - Indian English, female' },
    { id: 'en-IN-PrabhatNeural', label: 'Prabhat - Indian English, male' },
    { id: 'en-IN-NeerjaExpressiveNeural', label: 'Neerja Expressive - Indian English' },
    { id: 'en-US-AvaMultilingualNeural', label: 'Ava - multilingual (test first)' },
    { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew - multilingual (test first)' },
  ],
  gemini: ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Aoede', 'Sulafat'].map((n) => ({
    id: n,
    label: n + ' (Gemini)',
  })),
};
const DEFAULT_VOICE = { edge: 'en-IN-NeerjaNeural', gemini: 'Kore' };

module.exports = { FAMILIES, PALETTES, TEXTURES, TEMPLATES, TRANSITIONS, SCHEMES, DECORS, HEADERS, CSTYLES, ALIGNS, KINDS, EMOTIONS, VOICES, DEFAULT_VOICE };
