// The traced reference body, cut into the code body's parts (see tools/trace_parts.js / .py), moved by pose angles.
// The code-drawn body (body_draw.js) works out where every part goes; each part's traced art follows its axis.
// A far limb that is hidden in the reference view borrows the art of the other limb.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./body_draw.js'));
  else root.NfBodyTraced = factory(root.NfBodyDraw);
}(typeof self !== 'undefined' ? self : this, function (B) {
  const COL = { base: '#4C281A', skin: '#FEBC8F', shade: '#C37D60' };
  const partner = (n) => (/_l$/.test(n) ? n.replace(/_l$/, '_r') : /_r$/.test(n) ? n.replace(/_r$/, '_l') : null);
  const f = (n) => Math.round(n * 1000) / 1000;
  const len = (a) => Math.hypot(a[2] - a[0], a[3] - a[1]);
  // which of a part's axes carries its art: the first (its own long axis) unless that one is foreshortened away
  function pick(cands) {
    const L = cands.map(len), top = Math.max(...L);
    return L[0] >= 0.45 * top ? 0 : L.indexOf(top);
  }
  function draw(o) {
    const data = o.data, view = o.view || 'front', V = data.views[view];
    const stand = {}; for (const s of B.shapes({ view })) if (s.name !== 'jaw') stand[s.name] = s;
    const posed = B.groupsOf(B.shapes({ view, angles: o.angles })).flatMap((g) => g.items).filter((s) => s.name !== 'jaw');
    const tx = -V.w / 2 - V.dx, ty = -V.h;
    let out = '';
    for (const s of posed) {
      // a part keeps its own art while it stays near its standing position; once it moves away (or when it is hidden in
      // this view) it borrows the art of the other limb, which shows the whole limb
      let art = V.parts[s.name], from = s.name;
      const pn = partner(s.name), pa = pn && V.parts[pn];
      if (pa && pa.base) {
        const own = art && art.base ? stand[s.name] : null;
        let moved = !own;
        if (own) {
          const j0 = pick(own.cand), q0 = own.cand[j0], q1 = s.cand[j0];
          const d = Math.atan2(q1[3] - q1[1], q1[2] - q1[0]) - Math.atan2(q0[3] - q0[1], q0[2] - q0[0]);
          moved = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > 0.25 || Math.abs(len(q1) / Math.max(1, len(q0)) - 1) > 0.3 || art.area < 0.35 * pa.area;
        }
        if (moved) { art = pa; from = pn; }
      }
      if (!art || !art.base) continue;
      const st0 = stand[from], j = pick(st0.cand), a0 = st0.cand[j], a1 = s.cand[j];
      const L0 = len(a0), L1 = len(a1);
      if (L0 < 1) continue;
      const e0 = [(a0[2] - a0[0]) / L0, (a0[3] - a0[1]) / L0], n0 = [-e0[1], e0[0]];
      const e1 = L1 > 1e-6 ? [(a1[2] - a1[0]) / L1, (a1[3] - a1[1]) / L1] : e0, n1 = [-e1[1], e1[0]];
      const sc = Math.max(0.15, Math.min(1.6, L1 / L0));
      // G = sc * e1 e0^T + n1 n0^T ; p' = a1 + G (P + t - a0)
      const G = [[sc * e1[0] * e0[0] + n1[0] * n0[0], sc * e1[0] * e0[1] + n1[0] * n0[1]], [sc * e1[1] * e0[0] + n1[1] * n0[0], sc * e1[1] * e0[1] + n1[1] * n0[1]]];
      const qx = tx - a0[0], qy = ty - a0[1];
      const m = [G[0][0], G[1][0], G[0][1], G[1][1], a1[0] + G[0][0] * qx + G[0][1] * qy, a1[1] + G[1][0] * qx + G[1][1] * qy].map(f);
      out += `<g transform="matrix(${m.join(' ')})"><path fill="${COL.skin}" d="${art.base}"/><path fill="${COL.skin}" d="${art.skin}"/><path fill="${COL.shade}" d="${art.shade}"/><path fill="${COL.base}" fill-rule="evenodd" d="${art.outline}"/></g>`;
    }
    const k = (o.unit || B.BOX.h) / B.BOX.h, pad = 20;
    const vb = o.viewBox || [-B.BOX.w / 2 - pad, -B.BOX.h - pad, B.BOX.w + 2 * pad, B.BOX.h + 2 * pad];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${f(vb[2] * k)}" height="${f(vb[3] * k)}">${o.background ? `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${o.background}"/>` : ''}${out}</svg>`;
  }
  return { draw };
}));
