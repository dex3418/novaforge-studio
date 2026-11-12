'use strict';
// The scene library. Every scene type is a plain function that returns HTML for
// ONE moment in time, so the same code draws:
//   - carousel slides  (mode "slide": finished state, 1080x1350)
//   - video frames     (mode "video": state at frame N, Remotion calls it every frame)
// No animation libraries and no downloads: styles are computed from the time.

const { PALETTES } = require('./catalog');
const { textureStyle, rgba, rgb } = require('./textures');
const { decorHtml } = require('./decor');

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
// springy ease: overshoots a little, then settles (the "bounce")
const back = (x) => {
  const t = clamp(x) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
};
const lum = (hex) => {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const mix = (a, b, t) => {
  const A = rgb(a);
  const B = rgb(b);
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
};

// colour change for one beat: "pop" = accent colour as the background, "flip" = light<->dark
function schemePalette(p, scheme) {
  if (scheme === 'pop') {
    const fg = p.onAccent;
    return { ...p, bg: p.accent, bg2: mix(p.accent, '#000000', 0.24), accent: fg, text: fg, muted: mix(fg, p.accent, 0.35), card: rgba(fg, 0.12), onAccent: p.accent, dark: lum(p.accent) < 0.55 };
  }
  if (scheme === 'flip') {
    if (p.dark) {
      const accent = mix(p.accent, '#000000', 0.3);
      return { ...p, bg: mix(p.text, p.accent, 0.06), bg2: mix(p.text, p.accent, 0.2), text: p.bg, muted: mix(p.bg, '#ffffff', 0.45), accent, card: 'rgba(0,0,0,0.06)', onAccent: lum(accent) < 0.5 ? '#ffffff' : '#111111', dark: false };
    }
    const accent = mix(p.accent, '#ffffff', 0.2);
    return { ...p, bg: mix(p.text, '#000000', 0.15), bg2: mix(p.text, p.accent, 0.28), text: p.bg, muted: mix(p.bg, p.text, 0.45), accent, card: 'rgba(255,255,255,0.08)', onAccent: lum(accent) < 0.5 ? '#ffffff' : '#111111', dark: true };
  }
  return p;
}
const fit = (n, steps) => {
  for (const [m, v] of steps) if (n < m) return v;
  return steps[steps.length - 1][1];
};
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// ---------------------------------------------------------------- timing

// Which word is being spoken now. Uses real timing (wordFrames) when present.
function currentWordIndex(words, frame, audioFrames, wordFrames) {
  if (!words.length) return 0;
  if (wordFrames && wordFrames.length === words.length) {
    let idx = 0;
    for (let i = 0; i < wordFrames.length; i++) {
      if (wordFrames[i] <= frame) idx = i;
      else break;
    }
    return idx;
  }
  const weights = words.map((w) => w.length + 1 + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const p = clamp(frame / Math.max(1, audioFrames));
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += weights[i] / sum;
    if (p <= acc) return i;
  }
  return words.length - 1;
}

function makeCtx(o) {
  const w = o.w;
  const h = o.h;
  const video = o.mode === 'video';
  const sc = o.scene;
  const plan = o.plan || {};
  const speed = { excited: 1.25, serious: 0.85, curious: 1.05, calm: 0.9, neutral: 1 }[sc.emotion] || 1;
  const words = String(sc.narration || '').split(/\s+/).filter(Boolean);
  const fps = o.fps || 30;
  const ctx = {
    w, h, u: (Math.min(w, h) / 1080) * (video ? (h > w ? 1.08 : 1.2) : 1), long: w > h, video,
    pal: schemePalette(PALETTES[plan.palette] || PALETTES.navy, video ? sc.scheme : 'base'),
    plan, sc, speed, fps,
    t: video ? (o.frame || 0) / fps : 99,
    frame: o.frame || 0,
    sceneFrames: o.sceneFrames || 90,
    audioFrames: o.audioFrames || 60,
    words,
    wordIdx: o.wordIdx || 0,
    wordFrames: o.wordFrames || null,
    font: o.font || "'Noto Sans Devanagari','Inter','Segoe UI',system-ui,sans-serif",
    brand: o.brand || '',
    handle: o.handle || '',
    total: o.total || 1,
    num: o.num || sc.index || 1,
    pageLabel: o.pageLabel || '',
    footLeft: o.footLeft || '',
  };
  // seconds at which `frac` (0..1) of the narration has been spoken
  ctx.at = (frac) => {
    if (!video) return 0;
    const n = words.length;
    if (ctx.wordFrames && ctx.wordFrames.length === n && n) {
      return ctx.wordFrames[Math.min(n - 1, Math.max(0, Math.floor(frac * n)))] / fps;
    }
    return (clamp(frac) * ctx.audioFrames) / fps;
  };
  // 0..1 animation progress that starts at t0 and lasts d seconds (always 1 on slides)
  ctx.a = (t0, d) => (video ? ease((ctx.t - t0) / (d / speed)) : 1);
  // same, with a springy overshoot
  ctx.b = (t0, d) => (video ? back((ctx.t - t0) / (d / speed)) : 1);
  return ctx;
}

// ---------------------------------------------------------------- shared pieces

function transitionStyle(ctx) {
  if (!ctx.video) return '';
  const f = ctx.frame;
  const n = ctx.sceneFrames;
  const e = ease(f / 11);
  const b = back(f / 18);
  const x = ease((n - f) / 8);
  const op = Math.min(e, x);
  const u = ctx.u;
  switch (ctx.sc.transition || ctx.plan.transition) {
    case 'slide':
      return `opacity:${op};transform:translateX(${(1 - b) * 110 * u - (1 - x) * 90 * u}px)`;
    case 'wipe':
      return `clip-path:inset(0 ${(1 - e) * 100}% 0 0);opacity:${x}`;
    case 'zoom':
      return `opacity:${op};transform:scale(${0.88 + 0.12 * e + (1 - x) * 0.08})`;
    case 'flip':
      return `opacity:${op};transform:perspective(1400px) rotateX(${(1 - e) * -55 + (1 - x) * 55}deg)`;
    case 'bounce':
      return `opacity:${op};transform:scale(${(0.5 + 0.5 * b) * (0.94 + 0.06 * x)})`;
    case 'rise':
      return `opacity:${op};transform:translateY(${(1 - b) * 190 * u + (1 - x) * -60 * u}px)`;
    case 'drop':
      return `opacity:${op};transform:translateY(${-(1 - b) * 190 * u + (1 - x) * 60 * u}px)`;
    case 'circle':
      return `clip-path:circle(${e * 150}% at 50% 55%);opacity:${x}`;
    case 'spin':
      return `opacity:${op};transform:rotate(${(1 - b) * -9}deg) scale(${0.75 + 0.25 * b})`;
    case 'split':
      return `clip-path:inset(${(1 - e) * 50}% 0 ${(1 - e) * 50}% 0);opacity:${x}`;
    default:
      return `opacity:${op}`;
  }
}

function captionLine(ctx, size, per, color, style) {
  const n = ctx.words.length;
  const idx = Math.min(ctx.wordIdx, Math.max(0, n - 1));
  const start = Math.floor(idx / per) * per;
  const slice = ctx.words.slice(start, start + per);
  const pulse = (i) => {
    const wf = ctx.wordFrames && ctx.wordFrames.length === n ? ctx.wordFrames[start + i] / ctx.fps : null;
    return wf == null ? 0 : 1 - ease((ctx.t - wf) / 0.22);
  };
  if (style === 'pill') {
    return `<div style="text-align:center">${slice
      .map((wd, i) => {
        const on = start + i === idx;
        return `<span style="display:inline-block;margin:${size * 0.08}px ${size * 0.12}px;padding:${size * 0.04}px ${size * 0.2}px;border-radius:${size * 0.3}px;background:${on ? ctx.pal.accent : 'transparent'};color:${on ? ctx.pal.onAccent : color};transform:scale(${on ? 1 + 0.14 * pulse(i) : 1})">${esc(wd)}</span>`;
      })
      .join('')}</div>`;
  }
  if (style === 'stack') {
    return slice
      .map((wd, i) => {
        const shown = start + i <= idx;
        const on = start + i === idx;
        const p = shown ? 1 - pulse(i) * 0.9 : 0;
        return `<div style="font-size:${size * 1.25}px;line-height:1.02;font-weight:800;color:${on ? ctx.pal.accent : color};opacity:${shown ? 1 : 0};transform:translateX(${(1 - p) * -70 * ctx.u}px)">${esc(wd)}</div>`;
      })
      .join('');
  }
  return slice
    .map(
      (wd, i) =>
        `<span style="display:inline-block;margin-right:${size * 0.25}px;color:${start + i === idx ? ctx.pal.accent : color};transform:scale(${start + i === idx ? 1 + 0.08 * pulse(i) : 1})">${esc(wd)}</span>`
    )
    .join('');
}

// subtitle strip shown under non-caption scenes in videos
function captionFoot(ctx) {
  const size = 50 * ctx.u;
  return `<div style="min-height:${size * 2.5}px;margin-top:${24 * ctx.u}px;font-size:${size}px;font-weight:700;line-height:1.25">${captionLine(ctx, size, ctx.long ? 7 : 5, ctx.pal.text)}</div>`;
}

function chip(ctx, text) {
  const u = ctx.u;
  const a = ctx.a(0, 0.4);
  return `<div style="align-self:flex-start;display:inline-flex;align-items:center;justify-content:center;min-width:${84 * u}px;height:${84 * u}px;padding:0 ${22 * u}px;border-radius:${22 * u}px;background:${ctx.pal.accent};color:${ctx.pal.onAccent};font-weight:800;font-size:${40 * u}px;margin-bottom:${40 * u}px;opacity:${a};transform:scale(${0.6 + 0.4 * a})">${esc(text)}</div>`;
}

function heading(ctx, text, size) {
  const u = ctx.u;
  const a = ctx.a(0, 0.5);
  return `<div style="font-size:${(size || 68) * u}px;line-height:1.15;font-weight:800;margin-bottom:${36 * u}px;opacity:${a};transform:translateY(${(1 - a) * 36 * u}px)">${esc(text)}</div>`;
}

function bar(ctx, delay) {
  const u = ctx.u;
  return `<div style="align-self:flex-start;height:${8 * u}px;border-radius:${4 * u}px;background:${ctx.pal.accent};width:${140 * ctx.a(delay || 0.3, 0.6) * u}px;margin-top:${40 * u}px"></div>`;
}

function checkIcon(size, color, p) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="24" stroke-dashoffset="${(1 - p) * 24}"/></svg>`;
}

function slideParas(ctx, size) {
  const paras = String(ctx.sc.body || '').split(/\n\n/).filter(Boolean);
  return paras
    .map((p) => `<p style="font-size:${size * ctx.u}px;line-height:1.45;margin-bottom:${24 * ctx.u}px;opacity:.92">${esc(p)}</p>`)
    .join('');
}

// ---------------------------------------------------------------- scene types

const STAGES = {
  // heading + caption (video) or heading + paragraph (slide)
  caption(ctx, sc) {
    const u = ctx.u;
    const showHead = sc.heading && sc.heading !== sc.narration;
    if (ctx.video) {
      const style = sc.cstyle || 'chunk';
      const size = (ctx.long ? 88 : 98) * u * (style === 'stack' ? 0.9 : 1);
      const per = style === 'stack' ? 3 : style === 'pill' ? 3 : 4;
      return (
        (showHead ? heading(ctx, sc.heading, ctx.long ? 70 : 76) : '') +
        `<div style="font-size:${size}px;font-weight:800;line-height:1.2;min-height:${size * 2.4}px">${captionLine(ctx, size, per, ctx.pal.text, style)}</div>`
      );
    }
    const size = fit(String(sc.body || '').length, [[120, 56], [220, 48], [330, 42], [1e9, 36]]);
    return chip(ctx, ctx.num) + heading(ctx, sc.heading, 68) + slideParas(ctx, size);
  },

  // words appear as they are spoken; numbers and key words highlighted.
  // look: pop | slam | rise (from data.style, or from the beat's caption style)
  kinetic(ctx, sc) {
    const u = ctx.u;
    const src = ctx.video ? ctx.words : String(sc.data.text || sc.body || sc.heading).split(/\s+/).filter(Boolean);
    const emph = new Set((sc.emphasis || []).map(norm));
    const n = src.length;
    const look = sc.data.style || { chunk: 'pop', pill: 'slam', stack: 'rise' }[sc.cstyle] || 'pop';
    const size = fit(n, [[9, 142], [15, 114], [1e9, 88]]) * u * (ctx.long ? 0.9 : 1);
    const html = src
      .map((wd, i) => {
        const strong = emph.has(norm(wd)) || /\d/.test(wd);
        const q = ctx.video ? (ctx.t - ctx.at(i / n)) / 0.3 : 1;
        const p = ease(q);
        const bp = back(q);
        let tf;
        if (look === 'slam') tf = `scale(${2.3 - 1.3 * bp})`;
        else if (look === 'rise') tf = `translateY(${(1 - bp) * 80 * u}px) rotate(${(1 - p) * -5}deg)`;
        else tf = `translateY(${(1 - bp) * 36 * u}px) scale(${0.8 + 0.2 * bp})`;
        return `<span style="display:inline-block;margin:0 ${size * 0.22}px ${size * 0.12}px 0;font-size:${size * (strong ? 1.15 : 1)}px;font-weight:800;line-height:1.12;color:${strong ? ctx.pal.accent : ctx.pal.text};opacity:${look === 'slam' ? Math.min(1, p * 3) : p};transform:${tf}">${esc(wd)}</span>`;
      })
      .join('');
    return `<div>${html}</div>` + bar(ctx, 0.2);
  },

  // one huge word with a line under it
  keyword(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    if (!d.word) throw new Error('no word');
    const p = ctx.b(0.05, 0.7);
    const size = fit(String(d.word).length, [[6, 310], [10, 230], [16, 160], [1e9, 118]]) * u * (ctx.long ? 0.85 : 1);
    return (
      `<div style="font-size:${size}px;font-weight:800;line-height:1;color:${ctx.pal.accent};letter-spacing:-0.02em;word-break:break-word;transform-origin:left center;opacity:${Math.min(1, p * 2)};transform:scale(${0.4 + 0.6 * p}) rotate(${(1 - p) * -6}deg)">${esc(d.word)}</div>` +
      bar(ctx, 0.3) +
      (d.line ? `<div style="margin-top:${36 * u}px;font-size:${64 * u}px;font-weight:800;line-height:1.2;opacity:${ctx.a(0.5, 0.5)}">${esc(d.line)}</div>` : '')
    );
  },

  // one big number (or range) that counts up
  counter(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    const vals = (d.values || []).map(Number).filter((v) => isFinite(v));
    if (!vals.length) throw new Error('no values');
    const p = ctx.video ? ease((ctx.t - 0.2) / (1.5 / ctx.speed)) : 1;
    const dec = vals.some((v) => !Number.isInteger(v));
    const fmt = (v) =>
      (dec ? Math.round(v * p * 100) / 100 : Math.round(v * p)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const text = vals.map((v) => `${d.prefix || ''}${fmt(v)}${d.suffix || ''}`).join(' – ');
    const size = fit(text.length, [[7, 240], [10, 190], [15, 150], [1e9, 110]]) * u * (ctx.long ? 0.9 : 1);
    const lab = ctx.a(0.1, 0.5);
    return (
      `<div style="font-size:${size}px;font-weight:800;line-height:1.05;color:${ctx.pal.accent};letter-spacing:-0.02em;transform-origin:left center;transform:scale(${0.82 + 0.18 * ctx.b(0.05, 0.7)})">${esc(text)}</div>` +
      bar(ctx, 0.2) +
      `<div style="margin-top:${36 * u}px;font-size:${64 * u}px;font-weight:800;line-height:1.15;opacity:${lab}">${esc(d.label || sc.heading)}</div>` +
      (!ctx.video && d.sub ? `<p style="margin-top:${24 * u}px;font-size:${40 * u}px;line-height:1.4;color:${ctx.pal.muted}">${esc(d.sub)}</p>` : '')
    );
  },

  // items with ticks that appear as they are spoken
  checklist(ctx, sc) {
    const u = ctx.u;
    const items = sc.data.items || [];
    if (!items.length) throw new Error('no items');
    const n = items.length;
    const size = (n <= 3 ? 56 : n <= 4 ? 50 : n <= 5 ? 46 : 42) * u;
    const rows = items
      .map((it, i) => {
        const t0 = ctx.at(it.frac || i / n);
        const a = ctx.video ? ease((ctx.t - t0) / 0.4) : 1;
        const bb = ctx.video ? back((ctx.t - t0) / 0.5) : 1;
        const ck = ctx.video ? ease((ctx.t - t0 - 0.25) / 0.3) : 1;
        const dia = 64 * u;
        return `<div style="display:flex;align-items:center;gap:${28 * u}px;margin-bottom:${30 * u}px;opacity:${a};transform:translateX(${(1 - bb) * -90 * u}px)"><div style="flex:none;width:${dia}px;height:${dia}px;border-radius:50%;border:${4 * u}px solid ${ctx.pal.accent};background:${rgba(ctx.pal.accent, 0.9 * ck)};display:flex;align-items:center;justify-content:center">${checkIcon(dia * 0.62, ctx.pal.onAccent, ck)}</div><div style="font-size:${size}px;font-weight:700;line-height:1.25">${esc(it.text)}</div></div>`;
      })
      .join('');
    return heading(ctx, sc.heading, 64) + rows;
  },

  // numbered steps joined by a line
  steps(ctx, sc) {
    const u = ctx.u;
    const items = sc.data.items || [];
    if (!items.length) throw new Error('no items');
    const n = items.length;
    const size = (n <= 3 ? 52 : n <= 4 ? 46 : 42) * u;
    const dia = 70 * u;
    const rows = items
      .map((it, i) => {
        const t0 = ctx.at(it.frac || i / n);
        const a = ctx.video ? ease((ctx.t - t0) / 0.4) : 1;
        const bb = ctx.video ? back((ctx.t - t0) / 0.5) : 1;
        const line =
          i < n - 1
            ? `<div style="width:${5 * u}px;height:${34 * u}px;margin:0 0 0 ${dia / 2 - 2.5 * u}px;background:${rgba(ctx.pal.accent, 0.5)}"></div>`
            : '';
        return `<div style="opacity:${a};transform:translateY(${(1 - bb) * 60 * u}px)"><div style="display:flex;align-items:center;gap:${28 * u}px"><div style="flex:none;width:${dia}px;height:${dia}px;border-radius:50%;background:${ctx.pal.accent};color:${ctx.pal.onAccent};font-weight:800;font-size:${36 * u}px;display:flex;align-items:center;justify-content:center">${i + 1}</div><div style="font-size:${size}px;font-weight:700;line-height:1.25">${esc(it.text)}</div></div>${line}</div>`;
      })
      .join('');
    return heading(ctx, sc.heading, 64) + rows;
  },

  quote(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    const a = ctx.a(0.1, 0.6);
    const size = fit(String(d.text).length, [[80, 70], [160, 58], [260, 48], [1e9, 40]]) * u;
    return (
      `<div style="font-size:${280 * u}px;line-height:0.75;color:${ctx.pal.accent};font-weight:800;opacity:${a}">“</div>` +
      `<div style="font-size:${size}px;font-weight:700;line-height:1.3;opacity:${ctx.a(0.3, 0.7)};transform:translateY(${(1 - ctx.a(0.3, 0.7)) * 30 * u}px)">${esc(d.text)}</div>` +
      (d.author ? `<div style="margin-top:${36 * u}px;font-size:${40 * u}px;color:${ctx.pal.muted};opacity:${ctx.a(0.9, 0.5)}">— ${esc(d.author)}</div>` : '')
    );
  },

  qa(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    if (!d.q || !d.a) throw new Error('no q/a');
    const qa = ctx.a(0.05, 0.5);
    const t1 = ctx.at(d.aFrac || 0.45);
    const aa = ctx.video ? ease((ctx.t - t1) / 0.5) : 1;
    const qs = fit(d.q.length, [[60, 64], [120, 54], [1e9, 46]]) * u;
    const as = fit(d.a.length, [[100, 54], [200, 46], [1e9, 40]]) * u;
    const label = (txt, bg, fg) =>
      `<span style="display:inline-block;padding:${6 * u}px ${20 * u}px;border-radius:${14 * u}px;background:${bg};color:${fg};font-weight:800;font-size:${30 * u}px;letter-spacing:.06em;margin-bottom:${18 * u}px">${txt}</span>`;
    return (
      `<div style="opacity:${qa};transform:translateY(${(1 - qa) * 30 * u}px);margin-bottom:${56 * u}px">${label('QUESTION', ctx.pal.accent, ctx.pal.onAccent)}<div style="font-size:${qs}px;font-weight:800;line-height:1.2">${esc(d.q)}</div></div>` +
      `<div style="opacity:${aa};transform:translateY(${(1 - aa) * 30 * u}px)">${label('ANSWER', ctx.pal.card, ctx.pal.text)}<div style="font-size:${as}px;font-weight:600;line-height:1.35;color:${ctx.pal.text}">${esc(d.a)}</div></div>`
    );
  },

  mythfact(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    if (!d.myth || !d.fact) throw new Error('no myth/fact');
    const a1 = ctx.a(0.05, 0.5);
    const t1 = ctx.at(d.factFrac || 0.5);
    const a2 = ctx.video ? ease((ctx.t - t1) / 0.5) : 1;
    const strike = ctx.video ? ease((ctx.t - t1 + 0.2) / 0.4) : 1;
    const s1 = fit(d.myth.length, [[80, 52], [160, 44], [1e9, 38]]) * u;
    const s2 = fit(d.fact.length, [[80, 56], [160, 48], [1e9, 40]]) * u;
    return (
      `<div style="padding:${34 * u}px ${38 * u}px;border-radius:${28 * u}px;background:${ctx.pal.card};margin-bottom:${34 * u}px;opacity:${a1};transform:translateY(${(1 - a1) * 30 * u}px)"><div style="font-weight:800;font-size:${30 * u}px;letter-spacing:.1em;color:#ff5a5f;margin-bottom:${14 * u}px">MYTH</div><div style="font-size:${s1}px;font-weight:700;line-height:1.3;color:${ctx.pal.muted};text-decoration:${strike > 0.5 ? 'line-through' : 'none'};text-decoration-color:#ff5a5f;text-decoration-thickness:${5 * u}px">${esc(d.myth)}</div></div>` +
      `<div style="padding:${34 * u}px ${38 * u}px;border-radius:${28 * u}px;background:${rgba(ctx.pal.accent, 0.16)};border:${4 * u}px solid ${ctx.pal.accent};opacity:${a2};transform:translateY(${(1 - a2) * 30 * u}px)"><div style="font-weight:800;font-size:${30 * u}px;letter-spacing:.1em;color:${ctx.pal.accent};margin-bottom:${14 * u}px">FACT</div><div style="font-size:${s2}px;font-weight:800;line-height:1.3">${esc(d.fact)}</div></div>`
    );
  },

  compare(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    if (!d.left || !d.right) throw new Error('no sides');
    const stacked = !ctx.long;
    const card = (side, accent, at) => {
      const a = ctx.video ? ease((ctx.t - at) / 0.5) : 1;
      const s = fit(String(side.text || '').length, [[60, 50], [130, 42], [1e9, 36]]) * u;
      return `<div style="flex:1;padding:${34 * u}px ${36 * u}px;border-radius:${28 * u}px;background:${accent ? rgba(ctx.pal.accent, 0.16) : ctx.pal.card};border:${4 * u}px solid ${accent ? ctx.pal.accent : 'transparent'};opacity:${a};transform:translateY(${(1 - a) * 30 * u}px)"><div style="font-weight:800;font-size:${44 * u}px;margin-bottom:${14 * u}px;color:${accent ? ctx.pal.accent : ctx.pal.text}">${esc(side.title)}</div><div style="font-size:${s}px;line-height:1.35;font-weight:600">${esc(side.text)}</div></div>`;
    };
    const vs = `<div style="flex:none;align-self:center;width:${88 * u}px;height:${88 * u}px;border-radius:50%;background:${ctx.pal.accent};color:${ctx.pal.onAccent};font-weight:800;font-size:${34 * u}px;display:flex;align-items:center;justify-content:center;margin:${stacked ? -22 : 0}px ${stacked ? 0 : 20}px;z-index:2">VS</div>`;
    return (
      (sc.heading ? heading(ctx, sc.heading, 60) : '') +
      `<div style="display:flex;flex-direction:${stacked ? 'column' : 'row'};gap:${stacked ? 0 : 0}px">${card(d.left, false, 0.1)}${vs}${card(d.right, true, ctx.at(0.5))}</div>`
    );
  },

  // ring that fills to a percentage
  progress(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    const v = clamp(Number(d.value) / 100);
    const p = ctx.video ? ease((ctx.t - 0.2) / (1.6 / ctx.speed)) : 1;
    const R = 190 * u;
    const C = 2 * Math.PI * R;
    const S = 44 * u;
    const box = (R + S) * 2;
    const shown = Math.round(Number(d.value) * p * 10) / 10;
    return (
      `<div style="position:relative;width:${box}px;height:${box}px;margin-bottom:${40 * u}px"><svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}"><circle cx="${box / 2}" cy="${box / 2}" r="${R}" fill="none" stroke="${ctx.pal.card}" stroke-width="${S}"/><circle cx="${box / 2}" cy="${box / 2}" r="${R}" fill="none" stroke="${ctx.pal.accent}" stroke-width="${S}" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - v * p)}" transform="rotate(-90 ${box / 2} ${box / 2})"/></svg><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${120 * u}px;font-weight:800">${shown}%</div></div>` +
      `<div style="font-size:${60 * u}px;font-weight:800;line-height:1.15">${esc(d.label || sc.heading)}</div>`
    );
  },

  alert(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    const warn = d.tone !== 'note';
    const col = warn ? '#ff5a5f' : ctx.pal.accent;
    const a = ctx.a(0.05, 0.5);
    const size = fit(String(d.text).length, [[60, 66], [130, 54], [220, 46], [1e9, 40]]) * u;
    const icon = warn
      ? `<svg viewBox="0 0 24 24" width="${86 * u}" height="${86 * u}"><path d="M12 3 L22 20 H2 Z" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v5M12 17.3v.2" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/></svg>`
      : `<svg viewBox="0 0 24 24" width="${86 * u}" height="${86 * u}"><circle cx="12" cy="12" r="9.5" fill="none" stroke="${col}" stroke-width="2"/><path d="M12 11v6M12 7.6v.2" stroke="${col}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
    return (
      `<div style="display:flex;gap:${34 * u}px;align-items:flex-start;padding:${44 * u}px;border-radius:${30 * u}px;background:${rgba(col, 0.14)};border-left:${14 * u}px solid ${col};opacity:${a};transform:translateX(${(1 - a) * -60 * u}px)"><div style="flex:none">${icon}</div><div><div style="font-weight:800;font-size:${32 * u}px;letter-spacing:.1em;color:${col};margin-bottom:${12 * u}px">${warn ? 'WATCH OUT' : 'GOOD TO KNOW'}</div><div style="font-size:${size}px;font-weight:800;line-height:1.25">${esc(d.text)}</div></div></div>`
    );
  },

  cta(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    const a = ctx.a(0.05, 0.5);
    const pulse = ctx.video ? 1 + 0.04 * Math.sin(ctx.t * 5) : 1;
    const size = fit(String(d.text).length, [[40, 92], [90, 72], [1e9, 56]]) * u;
    return (
      `<div style="font-size:${size}px;font-weight:800;line-height:1.15;opacity:${a};transform:translateY(${(1 - a) * 40 * u}px)">${esc(d.text)}</div>` +
      `<div style="align-self:flex-start;display:inline-block;margin-top:${56 * u}px;padding:${26 * u}px ${54 * u}px;border-radius:${999}px;background:${ctx.pal.accent};color:${ctx.pal.onAccent};font-weight:800;font-size:${50 * u}px;transform:scale(${pulse * (0.8 + 0.2 * ctx.a(0.4, 0.4))})">${esc(d.button || ctx.handle || 'Link in bio')}</div>` +
      (!ctx.video && d.sub ? `<p style="margin-top:${48 * u}px;font-size:${40 * u}px;line-height:1.4;color:${ctx.pal.muted}">${esc(d.sub)}</p>` : '')
    );
  },

  // ---- slide-only
  cover(ctx, sc) {
    const u = ctx.u;
    const d = sc.data;
    const size = fit(String(d.title).length, [[40, 118], [70, 96], [1e9, 78]]) * u;
    return (
      `<h1 style="font-size:${size}px;line-height:1.12;font-weight:800">${esc(d.title)}</h1>` +
      (d.sub ? `<p style="font-size:${44 * u}px;margin-top:${40 * u}px;color:${ctx.pal.muted};line-height:1.35">${esc(d.sub)}</p>` : '') +
      bar(ctx, 0)
    );
  },
};

function renderStage(ctx, sc) {
  const fn = STAGES[sc.kind] || STAGES.caption;
  try {
    return fn(ctx, sc);
  } catch (e) {
    return STAGES.caption(ctx, sc); // bad data never breaks a render
  }
}

// ---------------------------------------------------------------- full frame

function renderScene(o) {
  const ctx = makeCtx(o);
  const { u, pal, w, h } = ctx;
  const P = (ctx.long ? 120 : 88) * u;
  const sc = o.scene;
  const stage = renderStage(ctx, sc);
  const video = ctx.video;
  const header = video ? ctx.plan.header || 'top' : 'top';
  const showFoot = video && ctx.plan.captions === 'always' && sc.kind !== 'caption' && sc.kind !== 'kinetic';
  const tx = textureStyle(ctx.plan.texture, pal, ctx.t === 99 ? 0 : ctx.t, u);
  const brandSpan = `<span style="font-weight:800;color:${pal.accent}">${esc(ctx.brand)}</span>`;
  const row = (a, b) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:${30 * u}px;color:${pal.muted};letter-spacing:.04em;height:${44 * u}px">${a}<span>${b}</span></div>`;
  let top = row(brandSpan, esc(ctx.handle));
  let bottom = video ? '<div style="height:20px"></div>' : '';
  let side = '';
  if (header === 'pill') {
    top = `<div style="display:flex;justify-content:space-between;align-items:center;height:${52 * u}px;font-size:${28 * u}px;color:${pal.muted}"><span style="background:${pal.accent};color:${pal.onAccent};font-weight:800;padding:${8 * u}px ${24 * u}px;border-radius:999px">${esc(ctx.brand)}</span><span>${esc(ctx.handle)}</span></div>`;
  } else if (header === 'bottom') {
    top = `<div style="height:${44 * u}px"></div>`;
    bottom = `<div style="margin-top:${24 * u}px">${row(brandSpan, esc(ctx.handle))}<div style="height:18px"></div></div>`;
  } else if (header === 'side') {
    top = `<div style="height:${44 * u}px"></div>`;
    side = `<div style="position:absolute;left:${34 * u}px;top:50%;transform:translateY(-50%) rotate(180deg);writing-mode:vertical-rl;white-space:nowrap;font-size:${28 * u}px;letter-spacing:.22em;color:${pal.muted}">${esc(ctx.brand)}  ·  ${esc(ctx.handle)}</div>`;
  }
  const foot = video
    ? bottom
    : `<div style="display:flex;justify-content:space-between;font-size:${28 * u}px;color:${pal.muted};height:${40 * u}px"><span>${esc(ctx.footLeft)}</span><span>${esc(ctx.pageLabel)}</span></div>`;
  const justify = { top: 'flex-start', bottom: 'flex-end', center: 'center' }[video ? sc.align : 'center'] || 'center';
  const decor = video ? decorHtml(sc.decor || ctx.plan.decor || 'none', pal, ctx.t, w, h, u, sc.index || 0) : '';
  return (
    `<div class="nf" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:${ctx.font};color:${pal.text};background:linear-gradient(160deg,${pal.bg} 0%,${pal.bg2} 100%)">` +
    `<div style="position:absolute;inset:0;${tx}"></div>` +
    `<div style="position:absolute;width:${760 * u}px;height:${760 * u}px;border-radius:50%;top:${-260 * u}px;right:${-260 * u}px;background:radial-gradient(circle,${rgba(pal.accent, 0.2)} 0%,transparent 70%)"></div>` +
    decor +
    side +
    `<div style="position:absolute;inset:0;padding:${P}px;display:flex;flex-direction:column">` +
    top +
    `<div class="nf-stage" style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:${justify};${transitionStyle(ctx)}"><div class="nf-inner" style="display:flex;flex-direction:column">${stage}</div></div>` +
    (showFoot ? captionFoot(ctx) : '') +
    foot +
    '</div></div>'
  );
}

// complete HTML page (used for carousel screenshots and previews)
function pageHtml(inner, w, h) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}html,body{width:${w}px;height:${h}px}</style></head><body>${inner}</body></html>`;
}

module.exports = { renderScene, pageHtml, currentWordIndex, STAGES };
