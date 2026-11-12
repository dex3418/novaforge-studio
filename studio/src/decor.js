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
    case 'waves': {
      let out = '';
      for (let i = 0; i < 3; i++) {
        const y0 = h * (0.62 + i * 0.1);
        const amp = (34 + i * 14) * u;
        let path = `M0 ${y0}`;
        for (let x = 0; x <= w; x += w / 24) path += ` L${x} ${y0 + Math.sin(x / (w / 4) * Math.PI + t * (1.2 + i * 0.4) + i) * amp}`;
        path += ` L${w} ${h} L0 ${h} Z`;
        out += `<svg style="position:absolute;inset:0" width="${w}" height="${h}"><path d="${path}" fill="${A(0.07 + i * 0.03)}"/></svg>`;
      }
      return out;
    }
    case 'shapes': {
      let out = '';
      for (let i = 0; i < 7; i++) {
        const x = (((i * 0.37 + 0.1) % 1) + Math.sin(t * 0.4 + i) * 0.04) * w;
        const y = (((i * 0.53 + 0.05) % 1) + Math.cos(t * 0.35 + i * 2) * 0.04) * h;
        const s = (60 + (i % 3) * 38) * u;
        const rot = t * (14 + i * 6) * (i % 2 ? 1 : -1) + i * 40;
        const kind = i % 3;
        const style = `position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;transform:rotate(${rot}deg);`;
        if (kind === 0) out += `<div style="${style}border:${3 * u}px solid ${A(0.28)};border-radius:${s * 0.18}px"></div>`;
        else if (kind === 1) out += `<div style="${style}border-radius:50%;background:${A(0.13)}"></div>`;
        else out += `<svg style="${style}" viewBox="0 0 10 10"><path d="M5 1 L9.2 9 L0.8 9 Z" fill="none" stroke="${A(0.3)}" stroke-width="0.35"/></svg>`;
      }
      return out;
    }
    case 'orbit': {
      const cx = w * 0.78;
      const cy = h * 0.3;
      let out = '';
      for (let i = 1; i <= 3; i++) {
        const r = S * 0.16 * i;
        out += `<div style="position:absolute;left:${cx - r}px;top:${cy - r}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;border:${2 * u}px dashed ${A(0.2)}"></div>`;
        const ang = t * (0.9 - i * 0.2) + i * 2 + sd;
        out += `<div style="position:absolute;left:${cx + Math.cos(ang) * r - 11 * u}px;top:${cy + Math.sin(ang) * r - 11 * u}px;width:${22 * u}px;height:${22 * u}px;border-radius:50%;background:${A(0.55)}"></div>`;
      }
      return out;
    }
    case 'comets': {
      let out = '';
      for (let i = 0; i < 5; i++) {
        const ph = (t * (0.28 + (i % 3) * 0.08) + i * 0.23 + sd * 0.11) % 1.4;
        const x = w * (ph - 0.2) + i * 40 * u;
        const y = h * (0.12 + i * 0.17) + ph * 120 * u;
        out += `<div style="position:absolute;left:${x}px;top:${y}px;width:${260 * u}px;height:${4 * u}px;border-radius:${4 * u}px;transform:rotate(18deg);transform-origin:right center;background:linear-gradient(90deg,transparent,${A(0.4)})"></div>`;
      }
      return out;
    }
    case 'confetti': {
      let out = '';
      const cols = [pal.accent, pal.muted, pal.text];
      for (let i = 0; i < 26; i++) {
        const ph = (t * (0.16 + (i % 5) * 0.03) + i * 0.173) % 1;
        const x = ((i * 0.211 + 0.05) % 1) * w + Math.sin(t * 2 + i) * 22 * u;
        const y = -0.05 * h + ph * 1.1 * h;
        const s = (12 + (i % 3) * 7) * u;
        out += `<div style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s * 0.45}px;background:${rgba(cols[i % 3], 0.5)};transform:rotate(${t * 140 + i * 50}deg)"></div>`;
      }
      return out;
    }
    default:
      return '';
  }
}

module.exports = { decorHtml };
