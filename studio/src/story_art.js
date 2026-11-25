'use strict';
// Flat-vector story art: people, props and places drawn as SVG strings.
// Everything is a pure function of (state, time), so the same code draws a still
// carousel slide and every frame of the video. No image files are needed.
//
// World: 1000 units tall, W units wide (W follows the frame shape). Ground is around y=760.
// People are drawn facing right in local units (feet at 0,0, ~370 tall) and flipped to face left.

const CHARS = require('./characters');
const { assetPerson } = require('./character_art');
const LIBART = require('./library_art');

const r1 = (n) => Math.round(n * 10) / 10;
const sin = Math.sin;
const PI = Math.PI;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const shade = (hex, amt) => { // amt -1..1 darker/lighter
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
};

const SKIN = ['#f3cfae', '#e6b48a', '#cf9462', '#b27545', '#8f5a34', '#6e4327'];
const HAIR = ['#1d1b1f', '#35241a', '#5a3b24', '#7d7d83', '#cfc7b8'];
const TOPS = ['#cb3bcc', '#018bba', '#29b937', '#f08a24', '#e5484d', '#5b5bd6', '#2e9d8f', '#f2b705'];
const BOTTOMS = ['#2b2d42', '#3d405b', '#264653', '#1f2a44', '#4a3b2a'];
const COLORS = { red: '#e5484d', blue: '#2f6fd6', green: '#29b937', yellow: '#f2b705', orange: '#f08a24', pink: '#e86aa6', purple: '#7b4bd6', white: '#f2f2f2', black: '#25252b', brown: '#8a5a3c', grey: '#8a8d96', gray: '#8a8d96', magenta: '#cb3bcc', teal: '#2e9d8f', saffron: '#f08a24', khaki: '#c2b280' };

// ------------------------------------------------------------------ expressions and poses
const EXPR = {
  neutral: { brow: [0, 0, 0], mouth: 'flat' },
  happy: { brow: [-6, 6, -2], mouth: 'smile' },
  sad: { brow: [10, -10, 2], mouth: 'frown' },
  worried: { brow: [12, -12, -2], mouth: 'wobble', fx: 'sweat' },
  surprised: { brow: [-4, 4, -8], mouth: 'o', fx: 'shock' },
  angry: { brow: [-14, 14, 2], mouth: 'grim', fx: 'anger' },
  thinking: { brow: [-8, 4, -2], mouth: 'side', fx: 'dots' },
  laugh: { brow: [-8, 8, -4], mouth: 'laugh', eyes: 'happyArc' },
  cry: { brow: [14, -14, 0], mouth: 'wail', fx: 'tears' },
  sleep: { brow: [2, -2, 2], mouth: 'zz', eyes: 'sleepArc', fx: 'zzz' },
  wink: { brow: [-4, 4, -2], mouth: 'smile', eyes: 'wink', fx: 'heart' },
  tired: { brow: [10, -10, 3], mouth: 'flat', eyes: 'half', fx: 'sweat' },
  love: { brow: [-4, 4, -4], mouth: 'smile', eyes: 'happyArc', fx: 'heart' },
};
const POSES = ['idle', 'walk', 'talk', 'point', 'wave', 'think', 'worried', 'celebrate', 'listen', 'shrug', 'peace', 'thumbsup', 'crossed', 'fist'];

// forward-positive angles in degrees: arms [upper, fore], legs
function poseAngles(pose, t, walkPhase) {
  const idle = { aL: [4, 6], aR: [4, 6], lL: 0, lR: 0, bob: sin(t * 1.9) * 2, lean: 0, tilt: 0, jump: 0 };
  switch (pose) {
    case 'walk': {
      const s = sin(walkPhase);
      return { aL: [-30 * s, 14], aR: [30 * s, 14], lL: 28 * s, lR: -28 * s, bob: -Math.abs(sin(walkPhase)) * 9, lean: 3, tilt: 0, jump: 0 };
    }
    case 'talk': {
      const g = sin(t * 5.2);
      return { ...idle, aR: [34 + 22 * g, 55 + 26 * sin(t * 7.1)], aL: [10 + 8 * sin(t * 3.3), 20], tilt: sin(t * 2.2) * 2 };
    }
    case 'point':
      return { ...idle, aR: [88, -4 + sin(t * 4) * 2], aL: [6, 8], lean: 4 };
    case 'wave':
      return { ...idle, aR: [150, 25 * sin(t * 9)], aL: [4, 6] };
    case 'think':
      return { ...idle, aR: [-6, -148], aL: [12, 60], tilt: -4, handR: 'chin' };
    case 'worried':
      return { ...idle, aR: [42, 120], aL: [42, 120], lean: -2, bob: sin(t * 7) * 1.2 };
    case 'celebrate': {
      const j = Math.abs(sin(t * 5));
      return { ...idle, aR: [165 + 8 * sin(t * 8), 6], aL: [165 - 8 * sin(t * 8), 6], bob: -j * 22, jump: j * 22 };
    }
    case 'listen':
      return { ...idle, aR: [8, 10], aL: [8, 10], tilt: -3 };
    case 'shrug': {
      const k = 0.5 + 0.5 * sin(t * 2.6);
      return { ...idle, aR: [30, 70 + 20 * k], aL: [30, 70 + 20 * k], bob: -k * 4 };
    }
    case 'peace':
      return { ...idle, aR: [62, 118], aL: [6, 8], handR: 'peace', tilt: 3 };
    case 'thumbsup':
      return { ...idle, aR: [58, 98], aL: [6, 8], handR: 'thumb' };
    case 'fist':
      return { ...idle, aR: [150, 20], aL: [10, 40], handR: 'fist', bob: -Math.abs(sin(t * 6)) * 6 };
    case 'crossed':
      return { ...idle, aL: [16, 98], aR: [16, -98], tilt: -2 };
    default:
      return idle;
  }
}

// ------------------------------------------------------------------ one person
// look: { gender:'m'|'f', age:'child'|'adult'|'elder', skin, hair, hairColor, top, bottom, outfit, glasses, beard, moustache, hat }
function lookFor(c) {
  const h = hashStr(c.name || c.id || 'x');
  const l = { ...(c.look || {}) };
  l.gender = l.gender || (h % 2 ? 'm' : 'f');
  l.age = l.age || 'adult';
  l.skin = l.skin || SKIN[(h >>> 3) % 4];
  l.hairColor = l.hairColor || (l.age === 'elder' ? HAIR[3] : HAIR[(h >>> 5) % 3]);
  l.hair = l.hair || (l.gender === 'f' ? ['long', 'bun', 'long'][(h >>> 7) % 3] : ['short', 'short', 'curly'][(h >>> 7) % 3]);
  l.top = l.top || TOPS[(h >>> 9) % TOPS.length];
  l.bottom = l.bottom || BOTTOMS[(h >>> 11) % BOTTOMS.length];
  l.outfit = l.outfit || (l.gender === 'f' ? ['dress', 'kurta'][(h >>> 13) % 2] : ['shirt', 'kurta', 'shirt'][(h >>> 13) % 3]);
  return l;
}

function arm(x, a, col, skin, sleeve, hand, chibi) {
  // upper arm 70, forearm 66; angles are forward-positive (we rotate negatively because +y is down)
  let extra = '';
  if (hand === 'peace') extra = `<rect x="-11" y="2" width="9" height="30" rx="4.5" transform="rotate(14)" fill="${skin}"/><rect x="2" y="2" width="9" height="30" rx="4.5" transform="rotate(-14)" fill="${skin}"/>`;
  if (hand === 'thumb') extra = `<rect x="-5" y="-2" width="10" height="26" rx="5" transform="rotate(-100)" fill="${skin}"/>`;
  return (
    `<g transform="translate(${x} -284) rotate(${r1(-a[0])})">` +
    `<rect x="${chibi ? -15 : -11}" y="-6" width="${chibi ? 30 : 22}" height="82" rx="${chibi ? 15 : 11}" fill="${col}"/>` +
    `<g transform="translate(0 70) rotate(${r1(-a[1])})">` +
    `<rect x="${chibi ? -14 : -10}" y="-6" width="${chibi ? 28 : 20}" height="72" rx="${chibi ? 14 : 10}" fill="${sleeve ? col : skin}"/>` +
    `<g transform="translate(0 68)">${extra}</g>` +
    `<circle cx="0" cy="68" r="${chibi ? (hand === 'fist' ? 21 : 18) : hand === 'fist' ? 16 : 13}" fill="${skin}"/></g></g>`
  );
}

function leg(x, ang, col, shoe) {
  return (
    `<g transform="translate(${x} -152) rotate(${r1(-ang)})">` +
    `<rect x="-14" y="-4" width="28" height="150" rx="12" fill="${col}"/>` +
    `<ellipse cx="9" cy="148" rx="26" ry="11" fill="${shoe}"/></g>`
  );
}

function chibiHairBack(l) {
  const c = l.hairColor;
  if (l.hair === 'long' || l.hair === 'bun') {
    return `<path d="M-52 -352 C-70 -330 -64 -300 -66 -276 Q-56 -284 -44 -292 Q-34 -276 -22 -290 Q-8 -274 6 -288 Q20 -274 32 -290 Q46 -276 58 -292 Q70 -282 66 -276 C64 -300 70 -330 52 -352 Z" fill="${c}"/>` + (l.hair === 'bun' ? `<circle cx="0" cy="-408" r="24" fill="${c}"/>` : '');
  }
  return '';
}
function chibiHairFront(l) {
  const c = l.hairColor;
  const gloss = '<ellipse cx="-18" cy="-398" rx="14" ry="5" transform="rotate(-14 -18 -398)" fill="#fff" stroke="none" opacity=".3"/><ellipse cx="22" cy="-394" rx="9" ry="4" transform="rotate(12 22 -394)" fill="#fff" stroke="none" opacity=".22"/>';
  if (l.hair === 'long' || l.hair === 'bun') {
    return `<path d="M-52 -350 C-58 -420 58 -424 52 -350 C46 -376 34 -384 22 -378 C14 -366 4 -362 -2 -378 C-10 -366 -26 -364 -34 -376 C-44 -372 -48 -362 -52 -350Z" fill="${c}"/>` + gloss;
  }
  // spiky fringe: uneven points, two side locks and three tufts on top
  const f = [[47, -338], [40, -360], [30, -352], [22, -374], [10, -356], [0, -372], [-12, -354], [-22, -376], [-34, -352], [-44, -366], [-50, -336]];
  const fr = f.map(([x, y]) => `L${x} ${y}`).join(' ');
  return `<path d="M-54 -346 C-62 -432 62 -432 54 -346 ${fr} Z" fill="${c}"/><path d="M-4 -424 Q8 -444 22 -426 Q10 -430 -4 -424Z" fill="${c}"/>` + gloss;
}
function hairBack(l, art) {
  if (art === 'chibi') return chibiHairBack(l);
  const c = l.hairColor;
  if (l.hair === 'long') return `<path d="M-48 -352 C-60 -300 -58 -262 -40 -246 L40 -246 C58 -262 60 -300 48 -352 Z" fill="${c}"/>`;
  if (l.hair === 'bun') return `<circle cx="-8" cy="-398" r="20" fill="${c}"/>`;
  return '';
}
function hairFront(l, art) {
  const c = l.hairColor;
  if (art === 'chibi' && ['short', 'curly', 'long', 'bun'].includes(l.hair)) return chibiHairFront(l);
  switch (l.hair) {
    case 'bald': return '';
    case 'curly': return [-36, -18, 0, 18, 36].map((x, i) => `<circle cx="${x}" cy="${-382 + Math.abs(x) * 0.25 + (i % 2) * 3}" r="17" fill="${c}"/>`).join('');
    case 'turban': return `<path d="M-46 -356 C-50 -410 50 -420 48 -354 C20 -372 -18 -372 -46 -356Z" fill="${l.hat || '#e5484d'}"/><path d="M-44 -366 C-10 -392 30 -392 46 -368" stroke="${shade(l.hat || '#e5484d', -0.3)}" stroke-width="5" fill="none"/>`;
    case 'cap': return `<path d="M-45 -362 C-44 -408 44 -408 45 -362 Z" fill="${l.hat || '#2f6fd6'}"/><path d="M10 -366 L62 -362 C60 -352 24 -352 10 -356Z" fill="${shade(l.hat || '#2f6fd6', -0.25)}"/>`;
    case 'long': case 'bun': return `<path d="M-45 -355 C-48 -398 46 -402 45 -352 C34 -372 6 -376 -16 -368 C-30 -364 -40 -360 -45 -355Z" fill="${c}"/>`;
    default: return `<path d="M-45 -354 C-50 -402 48 -406 45 -354 C36 -372 10 -378 -10 -372 C-26 -368 -40 -362 -45 -354Z" fill="${c}"/>`;
  }
}

function mouth(kind, open) {
  const o = open;
  if (o > 0.15) {
    const hgt = 4 + 12 * o;
    return `<ellipse cx="0" cy="-318" rx="${9 + 4 * o}" ry="${r1(hgt / 2)}" fill="#7a2631"/><rect x="-7" y="${r1(-318 - hgt / 2 + 0.5)}" width="14" height="3" rx="1.5" fill="#fff" opacity=".9"/>`;
  }
  switch (kind) {
    case 'smile': return '<path d="M-14 -322 Q0 -306 14 -322" stroke="#7a2631" stroke-width="4" fill="#fff" stroke-linejoin="round"/>';
    case 'frown': return '<path d="M-12 -314 Q0 -326 12 -314" stroke="#7a2631" stroke-width="4" fill="none" stroke-linecap="round"/>';
    case 'wobble': return '<path d="M-12 -316 Q-6 -322 0 -316 Q6 -310 12 -316" stroke="#7a2631" stroke-width="4" fill="none" stroke-linecap="round"/>';
    case 'o': return '<ellipse cx="0" cy="-316" rx="7" ry="9" fill="#7a2631"/>';
    case 'laugh': return '<path d="M-19 -326 Q0 -322 19 -326 Q16 -296 0 -296 Q-16 -296 -19 -326Z" fill="#8a1f2d" stroke="#3a1a20" stroke-width="3"/><path d="M-12 -308 Q0 -318 12 -308 Q8 -298 0 -298 Q-8 -298 -12 -308Z" fill="#ff7a8a"/><rect x="-15" y="-326" width="30" height="6" rx="3" fill="#fff"/>';
    case 'wail': return '<path d="M-17 -312 Q-8 -330 0 -314 Q8 -330 17 -312 Q8 -300 0 -304 Q-8 -300 -17 -312Z" fill="#8a1f2d" stroke="#3a1a20" stroke-width="3"/>';
    case 'zz': return '<ellipse cx="0" cy="-316" rx="5" ry="6.5" fill="#7a2631"/>';
    case 'grim': return '<path d="M-12 -316 L12 -318" stroke="#7a2631" stroke-width="4" stroke-linecap="round"/>';
    case 'side': return '<path d="M-10 -317 Q4 -319 14 -325" stroke="#7a2631" stroke-width="4" fill="none" stroke-linecap="round"/>';
    default: return '<path d="M-11 -318 L11 -318" stroke="#7a2631" stroke-width="4" stroke-linecap="round"/>';
  }
}

// a = { id, name, look, x (world), y, facing 1|-1, pose, expr, mouth 0..1, walk (phase), scale, t, alpha }
function person(a) {
  // a character with real artwork in the registry is drawn from that artwork, never redrawn
  const asset = CHARS.get(a.artId || a.id);
  if (asset) {
    const drawn = assetPerson(a, asset, heightOf(a.art === 'chibi' || a.art === 'webtoon' ? a.art : 'flat'));
    if (drawn != null) return drawn; // null = nothing drawable in the registry, use the procedural figure
  }
  const l = lookFor(a);
  const t = a.t || 0;
  const ang = poseAngles(a.pose, t + (hashStr(a.id || a.name || '') % 50) / 10, a.walk || 0);
  const ex = EXPR[a.expr] || EXPR.neutral;
  const sc = (a.scale || 1) * (l.age === 'child' ? 0.68 : l.age === 'elder' ? 0.95 : 1);
  const lean = ang.lean + (l.age === 'elder' ? 5 : 0);
  const dark = shade(l.bottom, 0);
  const shoe = a.art === 'chibi' ? '#f6f3ee' : '#2a2024';
  const top = l.top;
  const blink = (t % 3.4) < 0.12 ? 0.12 : 1;
  const eyeDx = 4;
  const art = a.art === 'chibi' || a.art === 'webtoon' ? a.art : 'flat';
  const browCol = l.hairColor === HAIR[4] ? '#8a8378' : '#2a2024';
  const iris = ['#6b4a2e', '#3f6f8f', '#5a7a4a', '#7a4a8a', '#8a5a3a'][hashStr(a.name || a.id || '') % 5];
  const eyeY = art === 'chibi' ? -334 : -350;
  const mouthSvg = art === 'chibi' ? `<g transform="translate(0 -312) scale(0.66) translate(0 318)">${mouth(ex.mouth, a.mouth || 0)}</g>` : mouth(ex.mouth, a.mouth || 0);
  const browsSvg = art === 'webtoon'
    ? `<path d="M-31 ${-372 + ex.brow[2]} Q-20 ${-379 - ex.brow[0] / 3 + ex.brow[2]} -8 ${-373 - ex.brow[0] / 3 + ex.brow[2]}" stroke="${browCol}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M8 ${-373 - ex.brow[1] / 3 + ex.brow[2]} Q20 ${-379 - ex.brow[1] / 3 + ex.brow[2]} 31 ${-372 + ex.brow[2]}" stroke="${browCol}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<path d="M-30 ${-370 + ex.brow[2]} L-10 ${-370 - ex.brow[0] / 3 + ex.brow[2]}" stroke="${browCol}" stroke-width="${art === 'chibi' ? 4 : 5}" stroke-linecap="round"/><path d="M10 ${-370 - ex.brow[1] / 3 + ex.brow[2]} L30 ${-370 + ex.brow[2]}" stroke="${browCol}" stroke-width="${art === 'chibi' ? 4 : 5}" stroke-linecap="round"/>`;
  const dk = '#2a1f24';
  const arcs = (kind) => [-22, 22].map((x) => (kind === 'sleepArc' ? `<path d="M${x - 11} ${eyeY - 2} Q${x} ${eyeY + 10} ${x + 11} ${eyeY - 2}" stroke="${dk}" stroke-width="4.5" fill="none" stroke-linecap="round"/>` : `<path d="M${x - 11} ${eyeY + 3} Q${x} ${eyeY - 12} ${x + 11} ${eyeY + 3}" stroke="${dk}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`)).join('');
  const fxT = a.t || 0;
  let fx = '';
  if (ex.fx === 'anger') fx = `<g transform="translate(36 -392) scale(${r1(1 + 0.12 * sin(fxT * 9) * 100) / 100})" stroke="#e5484d" stroke-width="5" fill="none" stroke-linecap="round"><path d="M-10 -4 Q-3 -3 -4 -10"/><path d="M10 -4 Q3 -3 4 -10"/><path d="M-10 4 Q-3 3 -4 10"/><path d="M10 4 Q3 3 4 10"/></g>` + [-1, 1].map((s) => `<g transform="translate(${s * 70} ${-380 - Math.abs(sin(fxT * 2)) * 8})" fill="#fff" stroke="#8a8aa0" stroke-width="2.5"><circle r="12"/><circle cx="${s * 8}" cy="-8" r="9"/><circle cx="${-s * 7}" cy="-9" r="8"/></g>`).join('');
  if (ex.fx === 'tears') fx = [-22, 22].map((x) => `<path d="M${x} -338 Q${x + (x < 0 ? -9 : 9)} -318 ${x + (x < 0 ? -4 : 4)} -300 Q${x + (x < 0 ? 4 : -4)} -312 ${x} -338Z" fill="#8fd3ff" stroke="#3b93c8" stroke-width="2.4" opacity=".92"/>`).join('');
  if (ex.fx === 'zzz') fx = [0, 1, 2].map((i) => `<text x="${52 + i * 12}" y="${-392 - i * 18 - ((fxT * 14 + i * 6) % 12)}" font-size="${20 + i * 8}" font-weight="900" fill="#2f86c0" opacity="${r1(0.7 + 0.3 * Math.abs(sin(fxT * 1.6 + i)) * 100) / 100}" font-family="sans-serif">Z</text>`).join('');
  if (ex.fx === 'heart') fx = `<path transform="translate(${58 + sin(fxT * 3) * 4} ${-376 - Math.abs(sin(fxT * 2)) * 8}) scale(1.1)" d="M0 8 C-14 -2 -12 -14 -4 -14 C0 -14 0 -10 0 -10 C0 -10 0 -14 4 -14 C12 -14 14 -2 0 8Z" fill="#e5484d" stroke="#8a1f2d" stroke-width="2.2"/>`;
  if (ex.fx === 'sweat') fx = `<path transform="translate(50 ${-392 + (fxT * 14) % 10})" d="M0 -2 Q9 12 0 20 Q-9 12 0 -2Z" fill="#8fd3ff" stroke="#3b93c8" stroke-width="2.4"/>`;
  if (ex.fx === 'shock') fx = [-30, 0, 30].map((d) => `<path transform="rotate(${d} 46 -392)" d="M46 -420 L46 -404" stroke="#f2b705" stroke-width="5" stroke-linecap="round"/>`).join('');
  if (ex.fx === 'dots') fx = [0, 1, 2].map((i) => `<circle cx="${-62 - i * 4}" cy="${-346 + i * 12}" r="${3 + (i % 2)}" fill="${dk}" opacity=".8"/>`).join('');
  let eyesSvg;
  if (ex.eyes === 'happyArc' || ex.eyes === 'sleepArc') {
    eyesSvg = arcs(ex.eyes);
  } else if (ex.eyes === 'wink') {
    eyesSvg = `<ellipse cx="-22" cy="${eyeY}" rx="8.6" ry="11.5" fill="${dk}"/><circle cx="-19" cy="${eyeY - 4.5}" r="3.6" fill="#fff" stroke="none"/>` + `<path d="M11 ${eyeY + 3} Q22 ${eyeY - 12} 33 ${eyeY + 3}" stroke="${dk}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
  } else if (ex.eyes === 'half') {
    eyesSvg = [-22, 22].map((x) => `<ellipse cx="${x}" cy="${eyeY + 4}" rx="8.6" ry="6" fill="${dk}"/><path d="M${x - 12} ${eyeY - 1} L${x + 12} ${eyeY - 1}" stroke="${dk}" stroke-width="4.5" stroke-linecap="round"/>`).join('');
  } else if (art === 'chibi') {
    const ry = r1(11.5 * blink + 1);
    eyesSvg = [-22, 22].map((x) => `<ellipse cx="${x}" cy="${eyeY}" rx="8.6" ry="${ry}" fill="${dk}"/>` + (blink > 0.5 ? `<circle cx="${x + 2.8}" cy="${eyeY - 4.5}" r="3.6" fill="#fff" stroke="none"/><circle cx="${x - 2.5}" cy="${eyeY + 4.5}" r="1.5" fill="#fff" stroke="none"/>` : '')).join('');
  } else if (art === 'webtoon') {
    const ry = r1(9 * blink + 0.8);
    eyesSvg = [-17, 17].map((x, i) => `<ellipse cx="${x}" cy="${eyeY}" rx="11" ry="${ry}" fill="#fff"/>` + (blink > 0.5 ? `<circle cx="${x + eyeDx}" cy="${eyeY}" r="7" fill="${iris}"/><circle cx="${x + eyeDx}" cy="${eyeY}" r="3.4" fill="#1c1418"/><circle cx="${x + eyeDx + 2.5}" cy="${eyeY - 3}" r="2" fill="#fff"/>` : '') + `<path d="M${x - 12} ${eyeY - 2} Q${x} ${eyeY - ry - 4} ${x + 12} ${eyeY - 2}" stroke="#1c1418" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M${x + (i ? 12 : -12)} ${eyeY - 2} l${i ? 5 : -5} -4" stroke="#1c1418" stroke-width="2.6" stroke-linecap="round"/>`).join('') +
      '<path d="M1 -338 Q4 -333 0 -331" stroke="#a8765a" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>';
  } else {
    eyesSvg = `<ellipse cx="-17" cy="-350" rx="9" ry="${r1(10 * blink)}" fill="#fff"/><ellipse cx="17" cy="-350" rx="9" ry="${r1(10 * blink)}" fill="#fff"/>` +
      `<circle cx="${-17 + eyeDx}" cy="-350" r="${r1(5 * blink + 0.5)}" fill="#2a2024"/><circle cx="${17 + eyeDx}" cy="-350" r="${r1(5 * blink + 0.5)}" fill="#2a2024"/>`;
  }
  const blush = (l.gender === 'f' || a.expr === 'happy' || art === 'chibi')
    ? `<circle cx="-33" cy="${art === 'chibi' ? -318 : -326}" r="${art === 'chibi' ? 8.5 : 7}" fill="#ff8a80" stroke="none" opacity="${art === 'chibi' ? 0.55 : 0.22}"/><circle cx="33" cy="${art === 'chibi' ? -318 : -326}" r="${art === 'chibi' ? 8.5 : 7}" fill="#ff8a80" stroke="none" opacity="${art === 'chibi' ? 0.55 : 0.22}"/>` : '';
  const face = browsSvg + eyesSvg +
    (l.glasses ? `<circle cx="-17" cy="${eyeY}" r="${art === 'chibi' ? 15.5 : 15}" fill="none" stroke="#2a2024" stroke-width="3.5"/><circle cx="17" cy="${eyeY}" r="${art === 'chibi' ? 15.5 : 15}" fill="none" stroke="#2a2024" stroke-width="3.5"/><path d="M-2 ${eyeY} L2 ${eyeY}" stroke="#2a2024" stroke-width="3.5"/>` : '') +
    blush + (l.moustache && art !== 'chibi' ? `<path d="M-16 -330 Q0 -340 16 -330 Q0 -326 -16 -330Z" fill="${l.hairColor}"/>` : '') + mouthSvg +
    fx +
    (art === 'webtoon' ? `<path d="M-30 -312 Q0 -296 30 -312 Q0 -304 -30 -312Z" fill="#000" opacity=".07"/><path d="M-22 -392 Q0 -402 24 -390" stroke="#fff" stroke-width="5" fill="none" opacity=".3" stroke-linecap="round"/>` : '');
  const neckY = art === 'chibi' ? -302 * 0.56 : art === 'webtoon' ? -302 * 1.1 : -302;
  const headScale = art === 'chibi' ? 1.8 : art === 'webtoon' ? 1.0 : 1;
  const headFit = art === 'flat' ? '' : `translate(0 ${r1(neckY)}) scale(${headScale}) translate(0 302)`;
  const head =
    `<g transform="${headFit} translate(0 ${r1(ang.bob * 0.3)}) rotate(${r1(ang.tilt)} 0 -300)${l.age === 'child' ? ' translate(0 -300) scale(1.18) translate(0 300)' : ''}">` +
    hairBack(l, art) +
    `<rect x="-12" y="-312" width="24" height="30" fill="${shade(l.skin, -0.08)}"/>` +
    `<circle cx="-43" cy="-342" r="9" fill="${l.skin}"/><circle cx="43" cy="-342" r="9" fill="${l.skin}"/>` +
    `<ellipse cx="0" cy="-343" rx="44" ry="48" fill="${l.skin}"/>` +
    (l.beard ? `<path d="M-42 -334 C-40 -290 40 -290 42 -334 C30 -312 -30 -312 -42 -334Z" fill="${l.hairColor}"/>` : '') +
    hairFront(l, art) +
    face +
    '</g>';

  let body;
  const hipY = -150;
  const torsoPath = `M-46 -290 Q-48 -300 -34 -302 L34 -302 Q48 -300 46 -290 L40 ${hipY + 4} L-40 ${hipY + 4} Z`;
  if (l.outfit === 'dress' || l.outfit === 'saree') {
    const col = top;
    const border = shade(col, -0.35);
    body =
      leg(-14, ang.lL, l.skin, shoe) + leg(14, ang.lR, l.skin, shoe) +
      `<path d="M-44 -296 L44 -296 L${l.outfit === 'saree' ? 62 : 78} -34 L${l.outfit === 'saree' ? -62 : -78} -34 Z" fill="${col}"/>` +
      `<path d="M${l.outfit === 'saree' ? -62 : -78} -34 L${l.outfit === 'saree' ? 62 : 78} -34" stroke="${border}" stroke-width="9"/>` +
      (l.outfit === 'saree' ? `<path d="M-44 -296 L44 -296 L20 -150 L-6 -296Z" fill="${shade(col, 0.18)}"/><path d="M-44 -296 Q-70 -230 -44 -150" stroke="${shade(col, 0.18)}" stroke-width="16" fill="none"/>` : '');
  } else {
    const pants = l.outfit === 'kurta' ? shade('#f2efe6', -0.05) : dark;
    body = leg(-14, ang.lL, pants, shoe) + leg(14, ang.lR, pants, shoe) +
      `<path d="${torsoPath}" fill="${top}"/>` +
      (l.outfit === 'kurta' ? `<path d="M-42 -160 L42 -160 L46 -96 L-46 -96 Z" fill="${top}"/><path d="M0 -302 L0 -120" stroke="${shade(top, -0.3)}" stroke-width="3"/>` : '') +
      (l.outfit === 'suit' || l.outfit === 'uniform' ? `<path d="M-14 -302 L0 -250 L14 -302Z" fill="#f2f2f2"/>${l.outfit === 'suit' ? `<path d="M-3 -296 L3 -296 L5 -240 L0 -230 L-5 -240Z" fill="#e5484d"/>` : ''}` : '') +
      `<rect x="-42" y="${hipY - 2}" width="84" height="12" fill="${shade(dark, -0.3)}"/>`;
  }
  const sleeveCol = l.outfit === 'dress' || l.outfit === 'saree' ? shade(top, 0.1) : top;
  const sleeve = l.outfit !== 'vest';
  const armX = art === 'chibi' ? 86 : 44;
  const backArm = arm(-armX, ang.aL, sleeveCol, l.skin, sleeve, ang.handL, art === 'chibi');
  const frontArm = arm(armX, ang.aR, sleeveCol, l.skin, sleeve, ang.handR, art === 'chibi');

  const flip = a.facing < 0 ? -1 : 1;
  const bodyT = art === 'chibi' ? 'scale(1.12 0.56)' : art === 'webtoon' ? 'scale(0.9 1.1)' : '';
  const armsT = art === 'chibi' ? 'translate(0 -159) scale(0.6) translate(0 284)' : bodyT;
  const outlineOpen = art === 'flat' ? '<g>' : `<g stroke="${art === 'chibi' ? '#2b1d22' : '#33252c'}" stroke-width="${art === 'chibi' ? 3.6 : 2.2}" stroke-linejoin="round" stroke-linecap="round">`;
  const sh = `<ellipse cx="0" cy="6" rx="${r1(70 * sc)}" ry="${r1(13 * sc)}" fill="#000" opacity=".16"/>`;
  return (
    `<g opacity="${a.alpha == null ? 1 : a.alpha}"${art === 'chibi' ? ' filter="url(#nfStk)"' : ''}>` +
    `<g transform="translate(${r1(a.x)} ${r1(a.y)})">${sh}` +
    `<g transform="translate(0 ${r1(-ang.jump)}) scale(${r1(flip * sc * 1000) / 1000} ${r1(sc * 1000) / 1000}) translate(0 ${r1(ang.bob)}) rotate(${r1(lean)} 0 0)">` +
    outlineOpen + `<g transform="${armsT}">${backArm}</g><g transform="${bodyT}">${body}</g><g transform="${armsT}">${frontArm}</g>` + head + '</g></g></g></g>'
  );
}

// ------------------------------------------------------------------ props (origin = ground centre)
function treeP(p) {
  const s = p.scale || 1;
  const sw = sin((p.t || 0) * 1.3 + (p.seed || 0)) * 2.6;
  return (
    `<g transform="scale(${s})">` +
    '<rect x="-14" y="-170" width="28" height="170" rx="8" fill="#7a4e2c"/>' +
    `<g transform="rotate(${r1(sw)} 0 -150)">` +
    '<circle cx="0" cy="-250" r="92" fill="#2f9e44"/><circle cx="-62" cy="-205" r="62" fill="#37b24d"/><circle cx="64" cy="-210" r="64" fill="#2b8a3e"/><circle cx="-8" cy="-300" r="58" fill="#51cf66"/>' +
    '<circle cx="-30" cy="-240" r="9" fill="#e5484d"/><circle cx="40" cy="-270" r="9" fill="#e5484d"/><circle cx="20" cy="-200" r="9" fill="#e5484d"/>' +
    '</g></g>'
  );
}
function bushP(p) { const s = p.scale || 1; return `<g transform="scale(${s})"><circle cx="-34" cy="-30" r="38" fill="#37b24d"/><circle cx="14" cy="-42" r="46" fill="#2f9e44"/><circle cx="56" cy="-26" r="34" fill="#51cf66"/></g>`; }
function houseP(p) {
  const s = p.scale || 1;
  const night = p.night;
  const win = night ? '#ffd966' : '#a5d8ff';
  return (
    `<g transform="scale(${s})">` +
    '<rect x="-170" y="-210" width="340" height="210" fill="#f4e3c3"/>' +
    '<rect x="-170" y="-40" width="340" height="40" fill="#e0c9a0"/>' +
    '<polygon points="-200,-205 0,-340 200,-205" fill="#c9533d"/><rect x="90" y="-330" width="34" height="80" fill="#a8412f"/>' +
    '<rect x="-30" y="-120" width="60" height="120" rx="6" fill="#7a4e2c"/><circle cx="16" cy="-60" r="5" fill="#ffd166"/>' +
    `<rect x="-140" y="-160" width="70" height="64" rx="6" fill="${win}" stroke="#fff" stroke-width="6"/><path d="M-105 -160 V-96 M-140 -128 H-70" stroke="#fff" stroke-width="4"/>` +
    `<rect x="70" y="-160" width="70" height="64" rx="6" fill="${win}" stroke="#fff" stroke-width="6"/><path d="M105 -160 V-96 M70 -128 H140" stroke="#fff" stroke-width="4"/>` +
    '</g>'
  );
}
function hutP(p) {
  const s = p.scale || 1;
  return (
    `<g transform="scale(${s})">` +
    '<rect x="-120" y="-150" width="240" height="150" rx="8" fill="#c68b59"/>' +
    '<path d="M-165 -140 Q0 -300 165 -140 Z" fill="#d9a441"/><path d="M-130 -150 Q0 -260 130 -150" stroke="#b9852f" stroke-width="6" fill="none"/>' +
    `<rect x="-26" y="-96" width="52" height="96" rx="26 26 4 4" fill="${p.night ? '#ffd966' : '#6b3f22'}"/>` +
    '<rect x="-92" y="-62" width="14" height="62" fill="#a8703f"/><rect x="78" y="-62" width="14" height="62" fill="#a8703f"/>' +
    '</g>'
  );
}
function carP(p) {
  const s = p.scale || 1;
  const col = p.color || '#e5484d';
  const spin = (p.spin || 0) * 57.3;
  const wheel = (x) => `<g transform="translate(${x} -34) rotate(${r1(spin)})"><circle r="34" fill="#25252b"/><circle r="17" fill="#c9ccd3"/><path d="M-17 0H17M0 -17V17" stroke="#7d818c" stroke-width="4"/></g>`;
  return (
    `<g transform="scale(${s})">` +
    `<path d="M-150 -40 L-150 -92 Q-140 -108 -112 -112 L-70 -150 Q-60 -166 -36 -166 L60 -166 Q84 -166 96 -148 L124 -112 Q150 -108 152 -84 L152 -40 Z" fill="${col}"/>` +
    '<path d="M-60 -148 L-76 -112 L-18 -112 L-18 -150Z" fill="#cfe8ff"/><path d="M-2 -150 L-2 -112 L56 -112 L82 -112 L62 -146Z" fill="#cfe8ff"/>' +
    '<rect x="132" y="-86" width="20" height="14" rx="5" fill="#ffe08a"/><rect x="-152" y="-84" width="12" height="12" rx="4" fill="#ff8a8a"/>' +
    wheel(-92) + wheel(92) + '</g>'
  );
}
function busP(p) {
  const s = p.scale || 1;
  const spin = (p.spin || 0) * 57.3;
  const wheel = (x) => `<g transform="translate(${x} -34) rotate(${r1(spin)})"><circle r="34" fill="#25252b"/><circle r="16" fill="#c9ccd3"/><path d="M-16 0H16M0 -16V16" stroke="#7d818c" stroke-width="4"/></g>`;
  let wins = '';
  for (let i = 0; i < 5; i++) wins += `<rect x="${-150 + i * 62}" y="-190" width="48" height="50" rx="6" fill="#cfe8ff"/>`;
  return `<g transform="scale(${s})"><rect x="-200" y="-216" width="400" height="176" rx="22" fill="${p.color || '#f2b705'}"/>${wins}<rect x="-200" y="-110" width="400" height="14" fill="${shade(p.color || '#f2b705', -0.25)}"/><rect x="158" y="-190" width="30" height="80" rx="6" fill="#cfe8ff"/>${wheel(-120)}${wheel(120)}</g>`;
}
function buildingP(p, kind) {
  const s = p.scale || 1;
  const night = p.night;
  const win = night ? '#ffd966' : '#bcdcff';
  const col = { school: '#f2b705', hospital: '#f4f6fa', shop: '#e8895a', office: '#8aa0c8', bank: '#c9b78a' }[kind] || '#cfd6e6';
  let wins = '';
  for (let i = 0; i < 4; i++) wins += `<rect x="${-130 + i * 70}" y="-250" width="44" height="50" rx="5" fill="${win}"/>`;
  let extra = '';
  if (kind === 'hospital') extra = '<rect x="-14" y="-330" width="28" height="80" fill="#e5484d"/><rect x="-40" y="-304" width="80" height="28" fill="#e5484d"/>';
  if (kind === 'school') extra = '<rect x="-3" y="-420" width="6" height="110" fill="#6b6f7a"/><path d="M3 -420 L60 -402 L3 -384Z" fill="#29b937"/><polygon points="-170,-290 0,-340 170,-290" fill="#c9533d"/>';
  if (kind === 'shop') extra = '<path d="M-170 -210 H170 V-170 H-170Z" fill="#e5484d"/>' + [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${-170 + i * 57}" y="-210" width="28.5" height="40" fill="#fff"/>`).join('');
  return (
    `<g transform="scale(${s})"><rect x="-170" y="-300" width="340" height="300" fill="${col}"/>` +
    (kind === 'shop' ? '' : wins) + extra +
    `<rect x="-34" y="-110" width="68" height="110" rx="6" fill="${shade(col, -0.35)}"/>` +
    (kind === 'shop' ? `<rect x="-130" y="-150" width="86" height="100" rx="6" fill="${win}"/><rect x="44" y="-150" width="86" height="100" rx="6" fill="${win}"/>` : `<rect x="-130" y="-150" width="50" height="50" rx="5" fill="${win}"/><rect x="80" y="-150" width="50" height="50" rx="5" fill="${win}"/>`) +
    '</g>'
  );
}
function boardP(p) {
  const s = p.scale || 1;
  return `<g transform="scale(${s})"><rect x="-8" y="-200" width="16" height="200" fill="#6b6f7a"/><rect x="-90" y="-290" width="180" height="100" rx="12" fill="#2f6fd6"/><path d="M-60 -250 H60 M-60 -226 H20" stroke="#fff" stroke-width="8" stroke-linecap="round"/></g>`;
}
function lampP(p) {
  const s = p.scale || 1;
  return `<g transform="scale(${s})"><rect x="-6" y="-300" width="12" height="300" fill="#4a4d57"/><path d="M0 -300 Q40 -310 50 -280" stroke="#4a4d57" stroke-width="10" fill="none"/><circle cx="50" cy="-276" r="16" fill="${p.night ? '#ffe9a0' : '#d8dbe3'}"/>${p.night ? '<circle cx="50" cy="-276" r="60" fill="#ffe9a0" opacity=".18"/>' : ''}</g>`;
}
function benchP(p) { const s = p.scale || 1; return `<g transform="scale(${s})"><rect x="-90" y="-70" width="180" height="14" rx="4" fill="#8a5a3c"/><rect x="-90" y="-110" width="180" height="12" rx="4" fill="#8a5a3c"/><rect x="-80" y="-56" width="12" height="56" fill="#5c3b25"/><rect x="68" y="-56" width="12" height="56" fill="#5c3b25"/></g>`; }
function deskP(p) { const s = p.scale || 1; return `<g transform="scale(${s})"><rect x="-150" y="-110" width="300" height="16" rx="5" fill="#8a5a3c"/><rect x="-140" y="-94" width="14" height="94" fill="#6b4529"/><rect x="126" y="-94" width="14" height="94" fill="#6b4529"/><rect x="-40" y="-176" width="90" height="62" rx="6" fill="#25252b"/><rect x="-34" y="-170" width="78" height="50" rx="3" fill="#7fc4ff"/><rect x="-6" y="-114" width="22" height="8" fill="#25252b"/></g>`; }
function tractorP(p) {
  const s = p.scale || 1; const spin = (p.spin || 0) * 57.3;
  return `<g transform="scale(${s})"><rect x="-60" y="-150" width="170" height="70" rx="10" fill="#29b937"/><rect x="-60" y="-210" width="80" height="62" rx="8" fill="#cfe8ff" stroke="#29b937" stroke-width="8"/><g transform="translate(-30 -60) rotate(${r1(spin)})"><circle r="60" fill="#25252b"/><circle r="26" fill="#f2b705"/><path d="M-26 0H26M0 -26V26" stroke="#25252b" stroke-width="4"/></g><g transform="translate(90 -34) rotate(${r1(spin * 1.6)})"><circle r="34" fill="#25252b"/><circle r="14" fill="#f2b705"/></g></g>`;
}

// thought bubble holding one of the line icons (24x24 strokes)
function bubble(x, y, iconPaths, t, accent) {
  const bob = sin(t * 2.2) * 6;
  const s = 5.2;
  return (
    `<g transform="translate(${r1(x)} ${r1(y + bob)})">` +
    `<circle cx="-34" cy="64" r="9" fill="#fff" opacity=".95"/><circle cx="-20" cy="40" r="14" fill="#fff" opacity=".95"/>` +
    `<ellipse cx="0" cy="-10" rx="82" ry="66" fill="#fff" stroke="${accent || '#cb3bcc'}" stroke-width="6"/>` +
    `<g transform="translate(${-12 * s} ${-12 * s - 10}) scale(${s})" fill="none" stroke="${accent || '#cb3bcc'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</g></g>`
  );
}

const PROPS = {
  tree: treeP, bush: bushP, house: houseP, hut: hutP, car: carP, bus: busP, tractor: tractorP,
  school: (p) => buildingP(p, 'school'), hospital: (p) => buildingP(p, 'hospital'), shop: (p) => buildingP(p, 'shop'),
  office: (p) => buildingP(p, 'office'), bank: (p) => buildingP(p, 'bank'),
  board: boardP, lamp: lampP, bench: benchP, desk: deskP,
};
const MOVERS = new Set(['car', 'bus', 'tractor']);

// ------------------------------------------------------------------ places and time of day
const SKY = {
  day: ['#8fd0ff', '#e6f6ff'],
  dusk: ['#5b5bd6', '#ffb08a'],
  night: ['#0d1b3d', '#2a3c70'],
};
const SETTINGS = ['village', 'street', 'field', 'office', 'home'];
const LEARNED_SCENES = {}; // landscapes approved in the Learning Studio (library_art.js)
const LEARNED_PROPS = [];
const TIMES = ['day', 'dusk', 'night'];

function cloud(x, y, s, col) { return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="${col}"><ellipse cx="0" cy="0" rx="70" ry="26"/><ellipse cx="-34" cy="-18" rx="38" ry="28"/><ellipse cx="22" cy="-26" rx="44" ry="32"/></g>`; }

// returns { far, mid, ground, groundTop } SVG strings for three parallax layers
function place(setting, time, W, t, seed) {
  if (LEARNED_SCENES[setting]) return LIBART.sceneLayers(LEARNED_SCENES[setting], W);
  const night = time === 'night';
  const sky = SKY[time] || SKY.day;
  const ink = night ? '#1b2850' : time === 'dusk' ? '#6a4c93' : '#9ad1a0';
  let far = '';
  let mid = '';
  let ground = '';
  const gTop = 600;
  const span = W + 600;
  const x0 = -300;
  const indoor = setting === 'office' || setting === 'home';
  if (indoor) {
    const wall = setting === 'office' ? (night ? '#3a4466' : '#e8edf7') : (night ? '#4a3a52' : '#f6e7d4');
    const floor = setting === 'office' ? (night ? '#2c3354' : '#c8d2e6') : (night ? '#3a2d40' : '#d9b48a');
    far = `<rect x="${x0}" y="-200" width="${span}" height="${gTop + 200}" fill="${wall}"/>` +
      `<rect x="${W * 0.5 - 150}" y="150" width="300" height="260" rx="10" fill="${night ? '#0d1b3d' : '#9fd8ff'}" stroke="#fff" stroke-width="14"/><path d="M${W * 0.5} 150V410M${W * 0.5 - 150} 280H${W * 0.5 + 150}" stroke="#fff" stroke-width="8"/>` +
      (night ? [0, 1, 2, 3, 4].map((i) => `<circle cx="${W * 0.5 - 110 + i * 54}" cy="${190 + (i * 37) % 90}" r="3" fill="#fff"/>`).join('') : '') +
      (setting === 'home'
        ? `<rect x="${W * 0.14}" y="170" width="120" height="150" rx="6" fill="#fff" stroke="#c9a37a" stroke-width="10"/><circle cx="${W * 0.14 + 60}" cy="245" r="36" fill="#ffd9a8"/>`
        : `<rect x="${W * 0.1}" y="160" width="190" height="130" rx="6" fill="#fff" stroke="#9aa7c4" stroke-width="8"/><path d="M${W * 0.1 + 30} 200 H${W * 0.1 + 160} M${W * 0.1 + 30} 232 H${W * 0.1 + 130}" stroke="#2f6fd6" stroke-width="10" stroke-linecap="round"/>`);
    ground = `<rect x="${x0}" y="${gTop}" width="${span}" height="500" fill="${floor}"/><rect x="${x0}" y="${gTop - 14}" width="${span}" height="14" fill="${shade(floor, -0.2)}"/>`;
    mid = '';
  } else {
    const hill1 = night ? '#16264f' : time === 'dusk' ? '#7a5aa6' : '#a8dba8';
    const hill2 = night ? '#1b2e5e' : time === 'dusk' ? '#6a4c93' : '#7fc88a';
    far =
      `<rect x="${x0}" y="-300" width="${span}" height="${gTop + 300}" fill="url(#sky${seed})"/>` +
      (night
        ? `<circle cx="${W * 0.78}" cy="170" r="54" fill="#f6f1d6"/><circle cx="${W * 0.78 + 20}" cy="158" r="48" fill="#0d1b3d"/>` + Array.from({ length: 26 }, (_, i) => `<circle cx="${(i * 197) % (W + 200) - 100}" cy="${(i * 83) % 420}" r="${1.5 + (i % 3)}" fill="#fff" opacity="${0.5 + 0.5 * sin(t * 2 + i)}"/>`).join('')
        : `<circle cx="${W * 0.78}" cy="${time === 'dusk' ? 330 : 190}" r="${time === 'dusk' ? 90 : 62}" fill="${time === 'dusk' ? '#ffd8a8' : '#fff3a8'}"/><circle cx="${W * 0.78}" cy="${time === 'dusk' ? 330 : 190}" r="${time === 'dusk' ? 140 : 100}" fill="${time === 'dusk' ? '#ffd8a8' : '#fff3a8'}" opacity=".25"/>`) +
      (night ? '' : [0, 1, 2, 3].map((i) => cloud(((i * 420 + t * 14 + 100) % (W + 500)) - 250, 120 + (i % 2) * 110 + i * 14, 1 + (i % 3) * 0.25, time === 'dusk' ? '#ffe0d0' : '#fff')).join('')) +
      `<path d="M${x0} 560 Q${W * 0.2} 470 ${W * 0.45} 540 T${W + 300} 520 L${W + 300} 700 L${x0} 700 Z" fill="${hill1}"/>`;
    mid =
      `<path d="M${x0} 610 Q${W * 0.3} 540 ${W * 0.6} 600 T${W + 300} 590 L${W + 300} 760 L${x0} 760 Z" fill="${hill2}"/>`;
    if (setting === 'street') {
      let b = '';
      for (let i = 0; i < 12; i++) {
        const bw = 120 + (i * 53) % 90;
        const bh = 220 + (i * 97) % 240;
        const bx = x0 + i * ((span) / 11) - bw / 2;
        const cc = night ? ['#243664', '#2d3f72', '#1d2c56'][i % 3] : ['#b7c4de', '#c9d3e8', '#a9b8d6'][i % 3];
        b += `<rect x="${r1(bx)}" y="${gTop - bh}" width="${bw}" height="${bh}" fill="${cc}"/>`;
        for (let wy = 0; wy < bh - 50; wy += 56) for (let wx = 14; wx < bw - 30; wx += 40) b += `<rect x="${r1(bx + wx)}" y="${gTop - bh + 20 + wy}" width="22" height="28" fill="${night && (i + wy + wx) % 3 ? '#ffd966' : night ? '#33457a' : '#e6f1ff'}" opacity=".9"/>`;
      }
      mid = b;
    }
    ground =
      `<rect x="${x0}" y="${gTop}" width="${span}" height="520" fill="${setting === 'street' ? (night ? '#2a2f45' : '#8f98ab') : setting === 'field' ? (night ? '#1f4a2a' : '#8bd36b') : (night ? '#24542f' : '#74c365')}"/>` +
      (setting === 'street'
        ? `<rect x="${x0}" y="${gTop}" width="${span}" height="40" fill="${night ? '#3a4060' : '#c4cad8'}"/><rect x="${x0}" y="${gTop + 120}" width="${span}" height="190" fill="${night ? '#1e2236' : '#5a6275'}"/>` + Array.from({ length: Math.ceil(span / 150) }, (_, i) => `<rect x="${x0 + i * 150 + 20}" y="${gTop + 206}" width="80" height="10" rx="4" fill="#f2f2f2" opacity=".8"/>`).join('')
        : setting === 'field'
          ? Array.from({ length: 10 }, (_, i) => `<path d="M${x0} ${gTop + 60 + i * 38} Q${W / 2} ${gTop + 30 + i * 38} ${W + 300} ${gTop + 60 + i * 38}" stroke="${night ? '#1a3d22' : '#6bbd52'}" stroke-width="8" fill="none"/>`).join('')
          : `<path d="M${x0} ${gTop + 150} Q${W * 0.4} ${gTop + 90} ${W + 300} ${gTop + 170} L${W + 300} ${gTop + 250} Q${W * 0.4} ${gTop + 190} ${x0} ${gTop + 240} Z" fill="${night ? '#6b5a44' : '#d8b98a'}"/>`);
  }
  const defs = indoor ? '' : `<linearGradient id="sky${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>`;
  return { far, mid, ground, defs, ink, groundTop: gTop };
}

// birds for daytime
function birds(W, t) {
  let o = '';
  for (let i = 0; i < 3; i++) {
    const x = ((t * 60 + i * 260) % (W + 300)) - 150;
    const y = 160 + i * 50 + sin(t * 2 + i) * 14;
    const f = sin(t * 9 + i) * 8;
    o += `<path d="M${r1(x - 16)} ${r1(y + f)} Q${r1(x - 6)} ${r1(y - 8)} ${r1(x)} ${r1(y)} Q${r1(x + 6)} ${r1(y - 8)} ${r1(x + 16)} ${r1(y + f)}" stroke="#4a4d57" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  return o;
}

require('./library_art').register({ PROPS, SETTINGS, LEARNED_SCENES, LEARNED_PROPS }, require('./library_data'));

function heightOf(art) { return art === 'chibi' ? 350 : art === 'webtoon' ? 440 : 398; }

module.exports = { LEARNED_SCENES, LEARNED_PROPS, heightOf, person, PROPS, MOVERS, place, birds, bubble, lookFor, EXPR, POSES, SETTINGS, TIMES, COLORS, SKIN, HAIR, TOPS, hashStr, ease, clamp, shade, esc, SKY };
