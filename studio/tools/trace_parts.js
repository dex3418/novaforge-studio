// Step 1 of cutting the traced reference into parts: for each of the 8 views, paint the code-drawn body's parts
// (standing pose, drawn in the same order as on screen) as flat ids on a pixel grid the size of the reference figure.
// Output: <out>/label_<i>.png (grey value = part id) and <out>/parts.json (part names, standing axes, draw order).
// usage: node tools/trace_parts.js <calib dir with fig_boxes.json> <out dir>
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const B = require('../src/body_draw.js');
const V = ['front', 'front_left_45', 'left_profile', 'back_left_45', 'back', 'back_right_45', 'right_profile', 'front_right_45'];
const [calib, out] = [process.argv[2], process.argv[3]];
const fb = JSON.parse(fs.readFileSync(path.join(calib, 'fig_boxes.json')));
fs.mkdirSync(out, { recursive: true });
const names = [...new Set(B.shapes({ view: 'front' }).map((s) => (s.name === 'jaw' ? 'head' : s.name)))];
const id = (n) => names.indexOf(n === 'jaw' ? 'head' : n) + 1;
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), meta = { names, views: {} };
  for (let i = 0; i < 8; i++) {
    const w = fb[i][2] - fb[i][0], h = fb[i][3] - fb[i][1];
    const list = B.shapes({ view: V[i] });
    const order = B.groupsOf(list).flatMap((g) => g.items);
    const el = order.map((s) => {
      const c = `rgb(${id(s.name)},${id(s.name)},${id(s.name)})`;
      if (s.kind === 'ellipse') return `<ellipse transform="translate(${s.cx} ${s.cy}) rotate(${s.rot})" rx="${s.rx}" ry="${s.ry}" fill="${c}" stroke="${c}" stroke-width="5"/>`;
      return `<path d="${B.capsulePath(s)}" fill="${c}" stroke="${c}" stroke-width="5"/>`;
    }).join('');
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<body style="margin:0;background:#000"><svg shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" viewBox="${-w / 2} ${-h} ${w} ${h}" width="${w}" height="${h}">${el}</svg></body>`);
    await p.screenshot({ path: path.join(out, `label_${i}.png`) });
    // each part's own shape area, one bit per part (R,G,B hold 24 bits): used to fill what another part hides in the reference
    const shapes = order.map((s) => ({ id: id(s.name), kind: s.kind, d: s.kind === 'ellipse' ? null : B.capsulePath(s), e: s.kind === 'ellipse' ? [s.cx, s.cy, s.rx, s.ry, s.rot] : null }));
    const png = await p.evaluate(({ shapes, w, h }) => {
      const out = new Uint8ClampedArray(w * h * 4), mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, w / 2, h); return [c, x]; };
      const bits = new Map();
      for (const sh of shapes) { if (!bits.has(sh.id)) bits.set(sh.id, mk()); const [, x] = bits.get(sh.id); x.fillStyle = x.strokeStyle = '#000'; x.lineWidth = 3;
        if (sh.d) { const pth = new Path2D(sh.d); x.fill(pth); x.stroke(pth); } else { x.save(); x.translate(sh.e[0], sh.e[1]); x.rotate(sh.e[4] * Math.PI / 180); x.beginPath(); x.ellipse(0, 0, sh.e[2], sh.e[3], 0, 0, 7); x.fill(); x.stroke(); x.restore(); } }
      for (const [k, [c, x]] of bits) { const d = x.getImageData(0, 0, w, h).data, ch = Math.floor((k - 1) / 8), bit = 1 << ((k - 1) % 8); for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 127) out[i * 4 + ch] |= bit; }
      for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255;
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0); return c.toDataURL('image/png');
    }, { shapes, w, h });
    fs.writeFileSync(path.join(out, `shape_${i}.png`), Buffer.from(png.split(',')[1], 'base64'));
    meta.views[V[i]] = { w, h, parts: Object.fromEntries(order.filter((s) => s.name !== 'jaw').map((s) => [s.name, { cand: s.cand, group: s.group, depth: s.depth, layer: s.layer }])) };
  }
  await b.close();
  fs.writeFileSync(path.join(out, 'parts.json'), JSON.stringify(meta));
  console.log('parts:', names.join(' '));
})();
