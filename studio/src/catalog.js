'use strict';
// One shared list of everything you can choose from: palettes, textures,
// templates and voices. The box page, the planner and the renderer all read it,
// so adding an entry here makes it available everywhere.

const PALETTES = {
  navy: { label: 'Midnight navy', bg: '#0b1020', bg2: '#1a2350', accent: '#ffb020', text: '#ffffff', muted: '#9aa4bf', card: 'rgba(255,255,255,0.07)', onAccent: '#1a1300', dark: true },
  paper: { label: 'Paper', bg: '#f7f3ea', bg2: '#ece3cf', accent: '#d9480f', text: '#1c1b18', muted: '#6b665c', card: 'rgba(0,0,0,0.05)', onAccent: '#ffffff', dark: false },
  saffron: { label: 'Saffron', bg: '#fff3e0', bg2: '#ffd9a3', accent: '#c2410c', text: '#2b1700', muted: '#7a5a33', card: 'rgba(0,0,0,0.05)', onAccent: '#ffffff', dark: false },
  forest: { label: 'Forest', bg: '#0d1f17', bg2: '#14352a', accent: '#7bd88f', text: '#f1fff6', muted: '#8fb3a0', card: 'rgba(255,255,255,0.07)', onAccent: '#06210f', dark: true },
  bold: { label: 'Black and yellow', bg: '#0a0a0a', bg2: '#1c1c1c', accent: '#ffd60a', text: '#ffffff', muted: '#a3a3a3', card: 'rgba(255,255,255,0.08)', onAccent: '#111111', dark: true },
  ocean: { label: 'Ocean', bg: '#06202b', bg2: '#0b3c4f', accent: '#4cc9f0', text: '#f0fbff', muted: '#8bb7c7', card: 'rgba(255,255,255,0.07)', onAccent: '#03212b', dark: true },
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
};

// Each template = a look for one kind of content.
// textures: the fallback picks one of these (steady per post name, so posts vary but a post never changes).
const TEMPLATES = {
  tips: { label: 'Tips / How-to', palette: 'navy', textures: ['dots', 'mesh', 'grain'], transition: 'slide' },
  budget: { label: 'Budget / Costs', palette: 'paper', textures: ['grid', 'grain', 'dots'], transition: 'wipe' },
  jobs: { label: 'Recruitment notice', palette: 'saffron', textures: ['geo', 'stripes', 'grain'], transition: 'wipe' },
  steps: { label: 'Step-by-step', palette: 'forest', textures: ['topo', 'grid', 'dots'], transition: 'slide' },
  myth: { label: 'Myth vs Fact', palette: 'ocean', textures: ['mesh', 'rings', 'dots'], transition: 'flip' },
  quote: { label: 'Quote / Motivation', palette: 'paper', textures: ['grain', 'rings', 'mesh'], transition: 'fade' },
  news: { label: 'Announcement', palette: 'bold', textures: ['stripes', 'grid', 'geo'], transition: 'zoom' },
  event: { label: 'Event / Date', palette: 'ocean', textures: ['rings', 'topo', 'mesh'], transition: 'zoom' },
};

const TRANSITIONS = ['fade', 'slide', 'wipe', 'zoom', 'flip', 'bounce', 'rise', 'drop', 'circle', 'spin', 'split'];
const SCHEMES = ['base', 'pop', 'flip']; // colour change per beat: normal, accent background, light/dark flip
const DECORS = ['none', 'orbs', 'sweep', 'rings', 'bars', 'sparks']; // animated background shapes (video)
const HEADERS = ['top', 'pill', 'bottom', 'side']; // where brand and handle sit
const CSTYLES = ['chunk', 'pill', 'stack']; // caption look
const ALIGNS = ['center', 'top', 'bottom'];

// Every scene type the renderer can draw. The planner (rules now, AI later) may only use these.
const KINDS = [
  'caption', 'kinetic', 'counter', 'checklist', 'steps', 'quote',
  'qa', 'mythfact', 'compare', 'progress', 'alert', 'cta', 'keyword',
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

module.exports = { PALETTES, TEXTURES, TEMPLATES, TRANSITIONS, SCHEMES, DECORS, HEADERS, CSTYLES, ALIGNS, KINDS, EMOTIONS, VOICES, DEFAULT_VOICE };
