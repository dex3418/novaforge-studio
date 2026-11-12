'use strict';
// Animated background shapes for videos. Everything is computed from the time t
// (seconds into the beat), so it renders the same in every frame.

const { rgba } = require('./textures');

function decorHtml(kind, pal, t, w, h, u, seed) {
  const sd = seed || 0;
  const A = (a) => rgba(pal.accent, a);
  const S = Math.min(w, h);
  switch (kind) {
    case 'orbs': {
      const defs = [[0.2, 0.28, 560, 0.9, 0.7], [0.88, 0.62, 700, 0.6, 1.3], [0.4, 0.96, 500, 1.1, 2.1]];
      return defs
        .map(([x, y, s, sp, ph]) => {
          const r = s * u;
          const cx = (x + Math.sin(t * 0.55 * sp + ph + sd) * 0.09) * w;
          const cy = (y + Math.cos(t * 0.42 * sp + ph) * 0.07) * h;
          return `<div style="position:absolute;left:${cx - r / 2}px;top:${cy - r / 2}px;width:${r}px;height:${r}px;border-radius:50%;background:radial-gradient(circle,${A(0.3)} 0%,transparent 68%)"></div>`;
        })
        .join('');
    }
    case 'sweep': {
      const pos = ((t * 0.4 + sd * 0.19) % 1.7) - 0.35;
      return `<div style="position:absolute;top:-20%;bottom:-20%;left:${pos * w - w * 0.2}px;width:${w * 0.42}px;transform:skewX(-18deg);background:linear-gradient(90deg,transparent,${A(0.16)},transparent)"></div>`;
    }
    case 'rings': {
      let out = '';
      for (let i = 0; i < 3; i++) {
        const ph = (t / 2.6 + i / 3 + sd * 0.1) % 1;
        const r = (0.08 + 1.1 * ph) * S;
        out += `<div style="position:absolute;left:${w * 0.82 - r}px;top:${h * 0.2 - r}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;border:${3 * u}px solid ${A((1 - ph) * 0.4)}"></div>`;
      }
      return out;
    }
    case 'bars': {
      const n = 20;
      const bw = (w / n) * 0.56;
      let out = '';
      for (let i = 0; i < n; i++) {
        const hh = (0.05 + 0.08 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 0.75 + sd))) * h;
        out += `<div style="position:absolute;left:${(i + 0.22) * (w / n)}px;bottom:0;width:${bw}px;height:${hh}px;border-radius:${bw / 2}px ${bw / 2}px 0 0;background:${A(0.17)}"></div>`;
      }
      return out;
    }
    case 'sparks': {
      let out = '';
      for (let i = 0; i < 18; i++) {
        const ph = (t * 0.1 * (0.6 + (i % 5) * 0.16) + i * 0.37 + sd * 0.07) % 1;
        const x = ((i * 0.173 + 0.07) % 1) * w + Math.sin(t + i) * 18 * u;
        const y = h * (1.05 - ph * 1.1);
        const s = (7 + (i % 4) * 5) * u;
        out += `<div style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:50%;background:${A(0.4 * Math.sin(Math.PI * ph))}"></div>`;
      }
      return out;
    }
    default:
      return '';
  }
}

module.exports = { decorHtml };
