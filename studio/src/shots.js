'use strict';
// Shot library: named camera shots for story beats.
//
//   * the AI director (or the backup planner) only names a shot ("close_up") and who it is about ("on")
//   * frame() turns that into camera numbers at render time, from where the people really stand and how tall they are,
//     so a close-up lands on the face in a portrait Reel and in a landscape video alike
//   * nearestShot() maps an invented name to a real one, so a bad plan can never break a render
//   * planShot() is the shot grammar of the backup planner (also used to fix repeats in an AI plan)
//
// Frame sizes are written as "how much of the figure's height is visible", not as zoom numbers.
// vis 1.3 = the whole body with some air, 0.8 = waist up, 0.62 = head and shoulders, 0.28 = the eyes. The art has big heads (the face sits at about 0.72 of the figure height), so the framing numbers are tuned on the real characters.

// at: where the camera looks horizontally. subject = the person the shot is about, pair = between two people,
// listener = the person who is not speaking, ots = over the shoulder (the listener, nudged towards the speaker),
// wide = the middle of the scene, pan = a slow sideways move across the scene.
// fh: the height on the figure the camera centres on (0 = feet, 1 = top of the head). rot: tilt in degrees.
const SHOTS = {
  establishing: { vis: [null, null], zoom: [1, 1.06], at: 'wide', needs: 0, min: 0, about: 'the whole place, opens a scene' },
  full: { vis: [1.3, 1.22], at: 'subject', fh: [0.5, 0.5], needs: 1, min: 0, about: 'the whole body, for walking and entrances' },
  medium: { vis: [0.86, 0.8], at: 'subject', fh: [0.62, 0.62], needs: 1, min: 0, about: 'waist up, normal dialogue' },
  two_shot: { vis: [null, null], at: 'pair', fh: [0.56, 0.56], needs: 2, min: 0, about: 'two people framed together' },
  close_up: { vis: [0.66, 0.62], at: 'subject', fh: [0.72, 0.72], needs: 1, min: 1.5, about: 'the face of the speaker, for the emotional line' },
  extreme_close_up: { vis: [0.32, 0.28], at: 'subject', fh: [0.74, 0.74], needs: 1, min: 1.8, about: 'the eyes, for a shock' },
  reaction: { vis: [0.68, 0.64], at: 'listener', fh: [0.72, 0.72], needs: 2, min: 1.5, about: 'the listener while someone else speaks' },
  over_shoulder: { vis: [0.86, 0.82], at: 'ots', fh: [0.68, 0.68], needs: 2, min: 1.2, about: 'off-centre, listener in front, speaker at the edge' },
  low_angle: { vis: [0.95, 0.9], at: 'subject', fh: [0.48, 0.52], rot: [-2.5, -2.5], needs: 1, min: 1.2, about: 'looks up at someone strong or proud' },
  high_angle: { vis: [0.95, 0.9], at: 'subject', fh: [0.7, 0.66], rot: [2.5, 2.5], needs: 1, min: 1.2, about: 'looks down at someone small, worried or sad' },
  push_in: { vis: [0.9, 0.62], at: 'subject', fh: [0.62, 0.72], move: true, needs: 1, min: 2.0, about: 'slow move from medium to close-up' },
  pull_out: { vis: [0.62, 1.1], at: 'subject', fh: [0.72, 0.56], move: true, needs: 1, min: 2.0, about: 'slow move from close-up out to the scene' },
  pan_left: { vis: [0.95, 0.95], at: 'pan', fx: [0.62, 0.38], fh: [0.55, 0.55], move: true, needs: 0, min: 2.0, about: 'slow sideways move to the left' },
  pan_right: { vis: [0.95, 0.95], at: 'pan', fx: [0.38, 0.62], fh: [0.55, 0.55], move: true, needs: 0, min: 2.0, about: 'slow sideways move to the right' },
};
const NAMES = Object.keys(SHOTS);

// words an AI is likely to use for a shot, mapped to the real names
const ALIAS = {
  wide: 'establishing', wide_shot: 'establishing', establishing_shot: 'establishing', long: 'establishing', long_shot: 'establishing', master: 'establishing', scene: 'establishing',
  full_shot: 'full', body: 'full', walk: 'full', walking: 'full', entrance: 'full', follow: 'full',
  medium_shot: 'medium', mid: 'medium', mid_shot: 'medium', waist: 'medium', normal: 'medium', dialogue: 'medium', talk: 'medium', default: 'medium',
  two: 'two_shot', twoshot: 'two_shot', pair: 'two_shot', both: 'two_shot', group: 'two_shot', '2_shot': 'two_shot',
  closeup: 'close_up', close: 'close_up', close_shot: 'close_up', face: 'close_up', tight: 'close_up', emotional: 'close_up',
  extreme: 'extreme_close_up', ecu: 'extreme_close_up', extreme_closeup: 'extreme_close_up', eyes: 'extreme_close_up', eye: 'extreme_close_up', detail: 'extreme_close_up', hand: 'extreme_close_up', shock: 'extreme_close_up',
  react: 'reaction', reaction_shot: 'reaction', listener: 'reaction', listening: 'reaction', cutaway: 'reaction',
  ots: 'over_shoulder', over_the_shoulder: 'over_shoulder', over_shoulder_shot: 'over_shoulder', shoulder: 'over_shoulder',
  low: 'low_angle', low_angle_shot: 'low_angle', hero: 'low_angle', up: 'low_angle',
  high: 'high_angle', high_angle_shot: 'high_angle', down: 'high_angle', birds_eye: 'high_angle', overhead: 'high_angle',
  push: 'push_in', pushin: 'push_in', zoom_in: 'push_in', dolly_in: 'push_in', move_in: 'push_in', zoom: 'push_in',
  pull: 'pull_out', pullout: 'pull_out', zoom_out: 'pull_out', dolly_out: 'pull_out', pull_back: 'pull_out', reveal: 'pull_out',
  pan: 'pan_right', pan_l: 'pan_left', pan_r: 'pan_right', left: 'pan_left', right: 'pan_right', tilt: 'pan_right',
};

const key = (s) => String(s == null ? '' : s).toLowerCase().trim().replace(/[\s\-/]+/g, '_').replace(/[^a-z0-9_]/g, '');

// a real shot name for whatever the AI wrote; exact:false when it had to be guessed; null name when nothing fits
function nearestShot(name) {
  const k = key(name);
  if (!k) return { name: null, exact: false };
  if (SHOTS[k]) return { name: k, exact: true };
  if (ALIAS[k]) return { name: ALIAS[k], exact: false };
  // contains a known word ("slow push in on her face")
  for (const n of NAMES) if (k.includes(n)) return { name: n, exact: false };
  const hit = Object.keys(ALIAS).filter((a) => a.length > 3 && k.includes(a)).sort((a, b) => b.length - a.length)[0];
  if (hit) return { name: ALIAS[hit], exact: false };
  // closest by edit distance (typos like "closeup_shot", "mediun")
  let best = null; let bd = 99;
  for (const n of NAMES.concat(Object.keys(ALIAS))) {
    const d = lev(k, n);
    if (d < bd) { bd = d; best = n; }
  }
  if (best && bd <= Math.max(2, Math.floor(best.length / 3))) return { name: SHOTS[best] ? best : ALIAS[best], exact: false };
  return { name: null, exact: false };
}
function lev(a, b) {
  const m = a.length; const n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// A shot that needs more people than the beat has becomes its closest one-person shot.
const SOLO = { two_shot: 'medium', reaction: 'close_up', over_shoulder: 'medium' };
function fit(name, nActors) {
  const s = SHOTS[name];
  if (!s) return 'medium';
  if (nActors >= s.needs) return name;
  return nActors === 0 && s.needs ? 'establishing' : SOLO[name] || 'medium';
}

// validate the camera of one beat (from the AI or the planner): a real shot, a cast member to look at, optional shake.
// Old numeric cameras (z0, z1, fx0, fx1) are kept as they are when no shot is given.
function cleanCamera(c, actorIds, fallbackShot) {
  const o = c && typeof c === 'object' ? c : {};
  const named = nearestShot(o.shot);
  if (!named.name && o.shot != null && o.shot !== '') { /* invented: fall through to the fallback below */ }
  if (named.name || fallbackShot) {
    let shot = fit(named.name || fallbackShot, actorIds.length);
    const on = actorIds.includes(o.on) ? o.on : null;
    const out = { shot };
    if (on) out.on = on;
    if (o.shake) out.shake = true;
    if (!named.exact && o.shot) out.fixedFrom = String(o.shot).slice(0, 40);
    return out;
  }
  return null;
}

// ------------------------------------------------------------------ render time: shot -> camera numbers
const clampv = (v, a, b) => Math.max(a, Math.min(b, v));
// cam: {shot, on}; ctx: {W (stage width), H (stage height, 1000), art height per actor, actors:[{id, x (0..1 end position), h, y, speaks}]}
function frame(cam, ctx) {
  const s = SHOTS[cam.shot];
  if (!s) return null;
  const W = ctx.W; const SH = ctx.H || 1000;
  const acts = ctx.actors || [];
  const byId = (id) => acts.find((a) => a.id === id);
  const speaker = byId(cam.on) || acts.find((a) => a.speaks) || acts[0] || null;
  const others = acts.filter((a) => a !== speaker);
  const listener = others.sort((a, b) => Math.abs(a.x - (speaker ? speaker.x : 0.5)) - Math.abs(b.x - (speaker ? speaker.x : 0.5)))[0] || null;
  let subj = speaker;
  if (s.at === 'listener') subj = listener || speaker;
  if (s.at === 'ots') subj = listener || speaker;
  const hRef = subj ? subj.h : 398;
  const heightOf = (a) => (a ? a.h : hRef);
  const zoomFor = (vis) => clampv(SH / (vis * hRef), 1, 9);

  let z0; let z1;
  if (s.at === 'wide') { z0 = s.zoom[0]; z1 = s.zoom[1]; } else if (s.at === 'pair' && speaker && listener) {
    // both people in frame: as close as the width allows
    const sep = Math.abs(speaker.x - listener.x) * W;
    const need = sep + 0.95 * Math.max(heightOf(speaker), heightOf(listener)) * 0.62;
    const z = clampv(Math.min(W / need, SH / (1.05 * hRef)), 1, 4);
    z0 = z; z1 = z * 1.05;
  } else { z0 = zoomFor(s.vis[0] || 1); z1 = zoomFor(s.vis[1] || 1); }
  // a figure is never cropped sideways more than a head-and-shoulders needs: z is limited by the stage width only for wide shots

  // horizontal focus (fractions of the stage width)
  let fx0; let fx1;
  if (s.at === 'pan') { [fx0, fx1] = s.fx; } else if (s.at === 'wide') { const xs = acts.map((a) => a.x); const m = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0.5; fx0 = 0.5; fx1 = 0.5 + (m - 0.5) * 0.35; } else if (s.at === 'pair' && speaker && listener) { fx0 = fx1 = (speaker.x + listener.x) / 2; } else if (s.at === 'ots' && subj) {
    const toward = speaker && listener ? Math.sign(speaker.x - listener.x) || 1 : 1;
    fx0 = fx1 = subj.x + toward * 0.07;
  } else if (subj) { fx0 = fx1 = subj.x; } else { fx0 = fx1 = 0.5; }

  // vertical focus: a height on the figure, turned into a stage y (feet are at subj.y)
  let fy0 = null; let fy1 = null;
  if (s.fh && (subj || s.at === 'pan')) {
    const ref = subj || speaker || acts[0];
    const feet = ref ? ref.y : 735; const hh = ref ? ref.h : 398;
    fy0 = feet - s.fh[0] * hh; fy1 = feet - s.fh[1] * hh;
  }
  const out = { z0, z1, fx0, fx1, fy0, fy1, rot0: s.rot ? s.rot[0] : 0, rot1: s.rot ? s.rot[1] : 0, shot: cam.shot };
  // keep the view inside the stage: the visible window never leaves the picture
  const keepX = (fx, z) => { const half = W / (2 * z); return half >= W / 2 ? 0.5 : clampv(fx, half / W, 1 - half / W); };
  out.fx0 = keepX(out.fx0, z0); out.fx1 = keepX(out.fx1, z1);
  const keepY = (fy, z) => (fy == null ? null : clampv(fy, SH / (2 * z), SH - SH / (2 * z)));
  out.fy0 = keepY(out.fy0, z0); out.fy1 = keepY(out.fy1, z1);
  return out;
}

// ------------------------------------------------------------------ shot grammar (backup planner)
// info: {first, moving, n (people in the beat), expr (speaker's feeling), big (shocking news), after (previous beat was big news), sec (estimated length)}
// prev: the previous shot name or ''. Returns a real shot name, never the same as prev.
const STRONG = new Set(['laugh', 'cry', 'angry', 'love', 'happy']);
const LOW = new Set(['angry', 'proud', 'happy', 'celebrate']);
const HIGH = new Set(['sad', 'worried', 'tired', 'cry', 'scared']);
const SAME = {
  establishing: ['full', 'pan_right', 'medium'], full: ['medium', 'two_shot', 'establishing'], medium: ['two_shot', 'over_shoulder', 'push_in', 'low_angle', 'full'],
  two_shot: ['over_shoulder', 'medium', 'full'], close_up: ['reaction', 'medium', 'push_in', 'low_angle'], extreme_close_up: ['close_up', 'reaction', 'medium'],
  reaction: ['close_up', 'over_shoulder', 'medium'], over_shoulder: ['two_shot', 'medium', 'reaction'], low_angle: ['medium', 'close_up', 'push_in'],
  high_angle: ['medium', 'close_up', 'pull_out'], push_in: ['medium', 'close_up', 'two_shot'], pull_out: ['medium', 'full', 'two_shot'],
  pan_left: ['pan_right', 'full', 'medium'], pan_right: ['pan_left', 'full', 'medium'],
};
function planShot(i, prev) {
  const n = i.n || 0;
  const solo = n <= 1;
  let want;
  if (i.first) want = n ? ['establishing', 'full'] : ['establishing'];
  else if (i.moving) want = ['full', 'two_shot'];
  else if (i.after && !solo) want = ['reaction', 'close_up'];
  else if (i.big) want = solo ? ['extreme_close_up', 'close_up'] : ['close_up', 'extreme_close_up'];
  else if (HIGH.has(i.expr)) want = ['high_angle', 'close_up', 'medium'];
  else if (STRONG.has(i.expr)) want = ['close_up', 'low_angle', 'medium'];
  else if (LOW.has(i.expr)) want = ['low_angle', 'medium'];
  else want = solo ? ['medium', 'push_in', 'full'] : ['two_shot', 'medium', 'over_shoulder'];
  // a shot has to be held long enough to read: short beats get no moves and no extreme framing
  const sec = i.sec == null ? 3 : i.sec;
  const ok = (name) => fit(name, n) === name && sec >= SHOTS[name].min;
  const pool = want.concat(SAME[want[0]] || [], ['medium', 'full', 'establishing']);
  for (const name of pool) if (name !== prev && ok(name)) return name;
  // nothing is long enough: a plain static shot, never a move or an extreme close-up
  for (const name of ['medium', 'full', 'establishing', 'two_shot']) if (name !== prev && fit(name, n) === name) return name;
  return fit('medium', n);
}
// the same shot twice in a row: swap the second for a close relative
function breakRepeat(name, prev, n, sec) {
  if (name !== prev) return name;
  for (const alt of SAME[name] || []) if (alt !== prev && fit(alt, n) === alt && (sec == null || sec >= SHOTS[alt].min)) return alt;
  return name;
}

// the lines the director is told
function promptText() {
  return NAMES.map((n) => `${n} (${SHOTS[n].about})`).join('; ');
}

module.exports = { SHOTS, NAMES, ALIAS, nearestShot, fit, cleanCamera, frame, planShot, breakRepeat, promptText };
