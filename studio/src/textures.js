'use strict';
// Background textures drawn with CSS and tiny inline SVG, so nothing is downloaded.
// textureStyle() returns CSS text for a full-size overlay layer.

function rgb(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function svgUrl(svg) {
  // no quote characters survive encodeURIComponent except ', which we never use
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

// t = seconds into the scene (video drifts the pattern slowly), px = scale unit
function textureStyle(id, pal, t, px) {
  const ink = pal.dark ? '255,255,255' : '0,0,0';
  const drift = Math.round((t || 0) * 5 * px);
  const u = px || 1;
  switch (id) {
    case 'grain': {
      const c = pal.dark ? 1 : 0;
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>' +
        `<feColorMatrix values="0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 0.6 0"/></filter>` +
        '<rect width="100%" height="100%" filter="url(#n)"/></svg>';
      return `background-image:${svgUrl(svg)};background-size:${220 * u}px ${220 * u}px;opacity:${pal.dark ? 0.12 : 0.2}`;
    }
    case 'dots':
      return `background-image:radial-gradient(circle, rgba(${ink},0.2) ${2.2 * u}px, transparent ${2.8 * u}px);background-size:${30 * u}px ${30 * u}px;background-position:${drift}px ${drift}px`;
    case 'grid':
      return `background-image:linear-gradient(rgba(${ink},0.09) ${1.5 * u}px, transparent ${1.5 * u}px),linear-gradient(90deg, rgba(${ink},0.09) ${1.5 * u}px, transparent ${1.5 * u}px);background-size:${54 * u}px ${54 * u}px;background-position:${drift}px ${drift}px`;
    case 'stripes':
      return `background-image:repeating-linear-gradient(135deg, rgba(${ink},0.07) 0, rgba(${ink},0.07) ${2 * u}px, transparent ${2 * u}px, transparent ${26 * u}px);background-position:${drift}px 0`;
    case 'topo':
      return `background-image:repeating-radial-gradient(circle at 18% 22%, rgba(${ink},0.12) 0, rgba(${ink},0.12) ${1.5 * u}px, transparent ${1.5 * u}px, transparent ${34 * u}px),repeating-radial-gradient(circle at 85% 78%, rgba(${ink},0.1) 0, rgba(${ink},0.1) ${1.5 * u}px, transparent ${1.5 * u}px, transparent ${28 * u}px)`;
    case 'mesh': {
      const sh = Math.sin((t || 0) * 0.6) * 4;
      const k = pal.dark ? 0.6 : 1;
      return `background-image:radial-gradient(circle at ${12 + sh}% 8%, ${rgba(pal.accent, 0.3 * k)}, transparent 45%),radial-gradient(circle at 92% ${30 - sh}%, ${rgba(pal.accent, 0.16 * k)}, transparent 40%),radial-gradient(circle at 30% 100%, ${rgba(pal.accent, 0.2 * k)}, transparent 50%)`;
    }
    case 'geo': {
      const s = `rgba(${ink},0.15)`;
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
        `<path d="M48 4 L92 48 L48 92 L4 48 Z" fill="none" stroke="${s}" stroke-width="1.5"/>` +
        `<path d="M48 24 L72 48 L48 72 L24 48 Z" fill="none" stroke="${s}" stroke-width="1.5"/>` +
        `<circle cx="48" cy="48" r="3" fill="${s}"/></svg>`;
      return `background-image:${svgUrl(svg)};background-size:${96 * u}px ${96 * u}px;background-position:${drift}px ${drift}px`;
    }
    case 'waves': {
      const s = `rgba(${ink},0.13)`;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60">' +
        `<path d="M0 30 Q 40 0 80 30 T 160 30" fill="none" stroke="${s}" stroke-width="2"/></svg>`;
      return `background-image:${svgUrl(svg)};background-size:${160 * u}px ${60 * u}px;background-position:${drift}px 0`;
    }
    case 'checks':
      return `background-image:conic-gradient(rgba(${ink},0.06) 25%, transparent 0 50%, rgba(${ink},0.06) 0 75%, transparent 0);background-size:${90 * u}px ${90 * u}px;background-position:${drift}px ${drift}px`;
    case 'hex': {
      const s = `rgba(${ink},0.14)`;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="84" height="146">' +
        `<path d="M42 0 L84 24 L84 72 L42 96 L0 72 L0 24 Z M42 96 L42 146 M0 72 L-0 122 M84 72 L84 122" fill="none" stroke="${s}" stroke-width="1.6"/></svg>`;
      return `background-image:${svgUrl(svg)};background-size:${84 * u}px ${146 * u}px;background-position:0 ${drift}px`;
    }
    case 'scan':
      return `background-image:repeating-linear-gradient(0deg, rgba(${ink},0.09) 0, rgba(${ink},0.09) ${2 * u}px, transparent ${2 * u}px, transparent ${9 * u}px);background-position:0 ${drift}px`;
    case 'confetti': {
      const cs = [pal.accent, pal.muted, pal.text];
      const bit = (x, y, k, r) => `<rect x="${x}" y="${y}" width="${k}" height="${k * 0.45}" rx="1.5" transform="rotate(${r} ${x} ${y})" fill="${cs[(x + y) % 3]}" fill-opacity="0.35"/>`;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">' +
        [bit(30, 40, 16, 20), bit(120, 20, 12, 70), bit(210, 70, 14, 130), bit(70, 130, 12, 40), bit(170, 150, 16, 100), bit(40, 220, 14, 160), bit(230, 220, 12, 10)].join('') + '</svg>';
      return `background-image:${svgUrl(svg)};background-size:${260 * u}px ${260 * u}px;background-position:${drift}px ${drift * 1.4}px`;
    }
    case 'blueprint':
      return `background-image:linear-gradient(rgba(${ink},0.12) ${2 * u}px, transparent ${2 * u}px),linear-gradient(90deg, rgba(${ink},0.12) ${2 * u}px, transparent ${2 * u}px),linear-gradient(rgba(${ink},0.05) ${1 * u}px, transparent ${1 * u}px),linear-gradient(90deg, rgba(${ink},0.05) ${1 * u}px, transparent ${1 * u}px);background-size:${180 * u}px ${180 * u}px,${180 * u}px ${180 * u}px,${36 * u}px ${36 * u}px,${36 * u}px ${36 * u}px`;
    case 'stars': {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
        [[20, 30, 2], [90, 80, 1.2], [160, 20, 1.6], [250, 60, 2.2], [60, 150, 1.4], [200, 140, 1.1], [270, 210, 1.8], [120, 240, 2], [30, 270, 1.2]]
          .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${pal.dark ? '#ffffff' : pal.accent}" fill-opacity="0.55"/>`).join('') + '</svg>';
      return `background-image:${svgUrl(svg)};background-size:${300 * u}px ${300 * u}px;background-position:${drift * 0.4}px ${drift * 0.2}px`;
    }
    case 'bokeh': {
      const sh = Math.sin((t || 0) * 0.5) * 3;
      return `background-image:radial-gradient(circle at ${18 + sh}% 22%, ${rgba(pal.accent, 0.16)} 0, ${rgba(pal.accent, 0.16)} 7%, transparent 7.5%),radial-gradient(circle at 78% ${30 - sh}%, ${rgba(pal.accent, 0.12)} 0, ${rgba(pal.accent, 0.12)} 11%, transparent 11.5%),radial-gradient(circle at 60% 78%, ${rgba(pal.accent, 0.14)} 0, ${rgba(pal.accent, 0.14)} 9%, transparent 9.5%),radial-gradient(circle at 12% 84%, ${rgba(pal.accent, 0.1)} 0, ${rgba(pal.accent, 0.1)} 5%, transparent 5.5%)`;
    }
    case 'cross':
      return `background-image:repeating-linear-gradient(45deg, rgba(${ink},0.06) 0, rgba(${ink},0.06) ${1.5 * u}px, transparent ${1.5 * u}px, transparent ${18 * u}px),repeating-linear-gradient(-45deg, rgba(${ink},0.06) 0, rgba(${ink},0.06) ${1.5 * u}px, transparent ${1.5 * u}px, transparent ${18 * u}px);background-position:${drift}px 0`;
    case 'rings':
      return `background-image:repeating-radial-gradient(circle at 100% 100%, ${rgba(pal.accent, 0.2)} 0, ${rgba(pal.accent, 0.2)} ${2 * u}px, transparent ${2 * u}px, transparent ${44 * u}px),repeating-radial-gradient(circle at 0% 0%, ${rgba(pal.accent, 0.1)} 0, ${rgba(pal.accent, 0.1)} ${2 * u}px, transparent ${2 * u}px, transparent ${52 * u}px)`;
    case 'circuit': {
      const { traces } = require('./circuit');
      const S = 520;
      const list = traces(11, S, S, 9, 40);
      const a = pal.dark ? 0.2 : 0.16;
      const col = pal.accent;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><g fill="none" stroke="${col}" stroke-opacity="${a}" stroke-width="2" stroke-linejoin="round">` +
        list.map((l) => `<path d="${l.d}"/>`).join('') +
        `</g><g fill="${pal.bg}" stroke="${col}" stroke-opacity="${a + 0.1}" stroke-width="2">` +
        list.map((l) => `<circle cx="${l.end[0]}" cy="${l.end[1]}" r="6"/><circle cx="${l.start[0]}" cy="${l.start[1]}" r="4"/>`).join('') +
        '</g></svg>';
      return `background-image:${svgUrl(svg)};background-size:${S * u}px ${S * u}px;background-position:${-drift}px ${Math.round(drift / 2)}px`;
    }
    default:
      return '';
  }
}

module.exports = { textureStyle, rgba, rgb };
