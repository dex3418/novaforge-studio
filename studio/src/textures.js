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
    case 'rings':
      return `background-image:repeating-radial-gradient(circle at 100% 100%, ${rgba(pal.accent, 0.2)} 0, ${rgba(pal.accent, 0.2)} ${2 * u}px, transparent ${2 * u}px, transparent ${44 * u}px),repeating-radial-gradient(circle at 0% 0%, ${rgba(pal.accent, 0.1)} 0, ${rgba(pal.accent, 0.1)} ${2 * u}px, transparent ${2 * u}px, transparent ${52 * u}px)`;
    default:
      return '';
  }
}

module.exports = { textureStyle, rgba, rgb };
