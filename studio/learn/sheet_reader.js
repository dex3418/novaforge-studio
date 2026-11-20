'use strict';
// Sheet Reader (v29): finds the figures on a character sheet from their own pixels.
//
// Replaces "cut the sheet into N vertical stripes". It never slices through a drawing:
//   1. foreground mask -> connected pieces (a 1 px dilation joins hairline breaks in outlines)
//   2. furniture is recognised and kept out of the figures:
//        pill   = short, wide, dark solid block (a label under a figure, a banner, a panel title)
//        panel  = hollow frame that contains other pieces (a "Details" box with eyes, mouths, colours)
//   3. figures = the big pieces left; small pieces (sparkles, "z", sweat drops) attach to the nearest figure
//   4. figures are grouped into rows; a row whose figures each have a pill under them is guessed as angles,
//      other rows as expressions. The caller (and the user, in the overlay) can change every guess.
//   5. a piece that is clearly two figures joined by touching hair is cut once, at its thinnest point
//
// Pure functions on typed arrays. Works in the browser (window.SheetReader) and in node (require).

(function (root) {
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  function maskOf(rgba, w, h, bg, tol) {
    const m = new Uint8Array(w * h), t2 = tol * tol;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (rgba[o + 3] < 128) continue;
      if (bg.alpha) { m[i] = 1; continue; }
      const dr = rgba[o] - bg.r, dg = rgba[o + 1] - bg.g, db = rgba[o + 2] - bg.b;
      if (dr * dr + dg * dg + db * db > t2) m[i] = 1;
    }
    return m;
  }

  function dilate(m, w, h) {
    const o = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) o[yy * w + xx] = 1; }
      }
    }
    return o;
  }

  // connected pieces (8-neighbour) of the dilated mask; statistics come from the real mask
  function label(m, dm, rgba, w, h) {
    const n = w * h, lab = new Int32Array(n), st = new Int32Array(n), comps = [];
    for (let i = 0; i < n; i++) {
      if (!dm[i] || lab[i]) continue;
      const c = { id: comps.length + 1, area: 0, x0: w, y0: h, x1: 0, y1: 0, r: 0, g: 0, b: 0 };
      let sp = 0; st[sp++] = i; lab[i] = c.id;
      while (sp) {
        const j = st[--sp], x = j % w, y = (j / w) | 0;
        if (m[j]) {
          c.area++; const o = j * 4; c.r += rgba[o]; c.g += rgba[o + 1]; c.b += rgba[o + 2];
          if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        }
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            if (dm[k] && !lab[k]) { lab[k] = c.id; st[sp++] = k; }
          }
        }
      }
      if (c.area) comps.push(fin(c));
    }
    return { lab, comps };
  }
  function fin(c) {
    c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1;
    c.fill = c.area / (c.w * c.h);
    c.cx = (c.x0 + c.x1) / 2; c.cy = (c.y0 + c.y1) / 2;
    c.lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / Math.max(1, c.area);
    return c;
  }
  const inside = (a, b) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1 && a !== b;
  const gap = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), Math.max(a.y0 - b.y1, b.y0 - a.y1, 0));

  // two figures joined by touching hair: cut the piece into k parts at the thinnest columns near the expected places
  function splitWide(c, k, lab, w) {
    const proj = new Float64Array(c.w);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.id) proj[x - c.x0]++;
    const sm = proj.map((_, i) => { let s = 0, n = 0; for (let d = -2; d <= 2; d++) if (proj[i + d] !== undefined) { s += proj[i + d]; n++; } return s / n; });
    const mx = Math.max(...sm) || 1, cell = c.w / k, cuts = [0];
    for (let i = 1; i < k; i++) {
      const ex = i * cell; let best = Math.round(ex), bc = Infinity;
      for (let x = Math.max(cuts[cuts.length - 1] + 3, Math.round(ex - cell * 0.3)); x <= Math.min(c.w - 2, Math.round(ex + cell * 0.3)); x++) {
        const cost = sm[x] / mx + 0.3 * Math.abs(x - ex) / cell;
        if (cost < bc) { bc = cost; best = x; }
      }
      cuts.push(best);
    }
    cuts.push(c.w);
    const parts = [];
    for (let i = 0; i < k; i++) {
      const p = { id: c.id * 1000 + i, area: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1, r: 0, g: 0, b: 0, split: true, parent: c.id, from: c.x0 + cuts[i], to: c.x0 + cuts[i + 1] - 1 };
      for (let y = c.y0; y <= c.y1; y++) for (let x = p.from; x <= p.to; x++) {
        if (lab[y * w + x] !== c.id) continue;
        p.area++; if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x; if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y;
      }
      if (p.area) parts.push(fin(Object.assign(p, { r: c.r * p.area / c.area, g: c.g * p.area / c.area, b: c.b * p.area / c.area })));
    }
    return parts;
  }

  // o: { rgba, w, h, bg:{r,g,b,alpha}, tol? (default 90: strong pixels only, so a pale ground shadow cannot join a label to a figure), join? (dilate 1 px), scale? }  (scale = working pixels per sheet pixel; boxes come back in sheet pixels)
  function analyse(o, m, extra) {
    const { w, h } = o, sc = o.scale || 1;
    const { lab, comps: all } = label(m, o.join ? dilate(m, w, h) : m, o.rgba, w, h);
    const notes = [];
    const dust = Math.max(10, w * h * 0.000012);
    const live = all.filter((c) => c.area >= dust);

    // --- furniture
    const maxPillH = h * 0.075;
    const minPillH = Math.max(8, h * 0.012);
    const isPill = (c) => c.w / c.h >= 2 && c.h >= minPillH && c.h <= maxPillH && c.fill >= 0.4 && c.lum < 150;
    const pills = live.filter(isPill).concat(extra);
    const isHollowFrame = (c) => !isPill(c) && c.fill < 0.2 && live.filter((d) => inside(d, c)).length >= 2;
    const frames = live.filter(isHollowFrame);
    const frameKids = new Set();
    for (const f of frames) for (const d of live) if (inside(d, f)) frameKids.add(d);
    const pillSet = new Set(pills), frameSet = new Set(frames);
    const pillKids = new Set();
    for (const p of pills) { const pb = { x0: p.x0 - 4, y0: p.y0 - 4, x1: p.x1 + 4, y1: p.y1 + 4 }; for (const d of live) if (inside(d, pb)) pillKids.add(d); }

    // --- figures and loose bits
    const rest = live.filter((c) => !pillSet.has(c) && !frameSet.has(c) && !frameKids.has(c) && !pillKids.has(c));
    const big = Math.max(1, ...rest.map((c) => c.area));
    let figs = rest.filter((c) => c.area >= big * 0.12);
    const bits = rest.filter((c) => c.area < big * 0.12);

    const med = median(figs.map((c) => c.w));
    const cut = [];
    figs = figs.flatMap((c) => {
      const k = Math.round(c.w / (med || 1));
      if (med && c.w > 1.6 * med && k >= 2) { const parts = splitWide(c, k, lab, w); cut.push(`one piece was ${k} drawings joined (touching hair): cut at the thinnest point, check the hair there`); return parts; }
      return [c];
    });
    cut.forEach((t) => notes.push(t));

    // --- rows
    const sorted = figs.slice().sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const f of sorted) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(f.cy - r.cy) <= 0.45 * r.h) { r.items.push(f); r.cy = r.items.reduce((s, x) => s + x.cy, 0) / r.items.length; r.h = median(r.items.map((x) => x.h)); }
      else rows.push({ items: [f], cy: f.cy, h: f.h });
    }
    rows.forEach((r) => r.items.sort((a, b) => a.cx - b.cx));

    // --- labels under figures
    const used = new Set(), labelOf = new Map();
    for (const f of figs) {
      let best = null, bd = Infinity;
      for (const p of pills) {
        if (used.has(p) || frameKids.has(p)) continue;
        if (p.cx < f.x0 - 0.1 * f.w || p.cx > f.x1 + 0.1 * f.w) continue;
        const d = p.y0 - f.y1;
        if (d < -0.12 * f.h || d > 0.35 * f.h) continue;
        if (Math.abs(d) < bd) { bd = Math.abs(d); best = p; }
      }
      if (best) { used.add(best); labelOf.set(f, best); }
    }
    const headings = pills.filter((p) => !used.has(p) && !frameKids.has(p));

    // --- attach loose bits to the nearest figure
    const attached = new Map(figs.map((f) => [f, []]));
    const orphans = [];
    for (const b of bits) {
      let best = null, bd = Infinity;
      for (const f of figs) { const d = gap(b, f); if (d < bd) { bd = d; best = f; } }
      if (best && bd <= 0.15 * Math.max(best.w, best.h)) attached.get(best).push(b); else orphans.push(b);
    }
    if (orphans.length) notes.push(`${orphans.length} loose piece${orphans.length === 1 ? '' : 's'} not near any figure were left out`);

    const toSheet = (b) => ({ x: Math.max(0, Math.floor(b.x0 / sc)), y: Math.max(0, Math.floor(b.y0 / sc)), w: Math.ceil((b.x1 - b.x0 + 1) / sc), h: Math.ceil((b.y1 - b.y0 + 1) / sc) });
    const unionBox = (parts, pad) => {
      const u = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
      parts.forEach((p) => { u.x0 = Math.min(u.x0, p.x0); u.y0 = Math.min(u.y0, p.y0); u.x1 = Math.max(u.x1, p.x1); u.y1 = Math.max(u.y1, p.y1); });
      const p = Math.round(pad * Math.max(u.x1 - u.x0, u.y1 - u.y0)) + 2;
      return { x0: Math.max(0, u.x0 - p), y0: Math.max(0, u.y0 - p), x1: Math.min(w - 1, u.x1 + p), y1: Math.min(h - 1, u.y1 + p) };
    };

    const items = [];
    rows.forEach((r, ri) => {
      const paired = r.items.filter((f) => labelOf.has(f)).length;
      const labelled = paired >= Math.ceil(r.items.length * 0.6);
      r.items.forEach((f, ci) => {
        const members = [f].concat(attached.get(f));
        const warn = [];
        const box = unionBox(members, 0.02);
        for (const g of figs) if (g !== f && gap(g, box) === 0 && !(g.split && f.split && g.parent === f.parent && false)) warn.push('its box overlaps a neighbour: the neighbour\'s pixels must be masked out when cropping');
        items.push({
          kind: labelled ? 'angle' : 'expression', guess: true, row: ri, col: ci,
          box: toSheet(box), label: labelOf.has(f) ? toSheet(labelOf.get(f)) : null,
          members: members.map((x) => x.id), xr: f.split ? [f.from, f.to] : null, pieces: attached.get(f).length, notes: Array.from(new Set(warn)),
        });
      });
    });

    // --- panels: sections are started by the title pills inside them; children are grouped by closeness
    const panels = [];
    for (const f of frames) {
      const kids = live.filter((d) => inside(d, f));
      const titles = kids.filter((d) => isPill(d)).sort((a, b) => a.y0 - b.y0);
      const content = kids.filter((d) => !isPill(d) && !frames.includes(d));
      const sections = titles.length ? titles.map((t, i) => ({ title: t, y0: t.y1, y1: titles[i + 1] ? titles[i + 1].y0 : f.y1 })) : [{ title: null, y0: f.y0, y1: f.y1 }];
      sections.forEach((s, si) => {
        const mine = content.filter((d) => d.cy >= s.y0 && d.cy <= s.y1);
        if (!mine.length) return;
        // colour palette: three or more similar, solid, round blobs (tested before pieces are merged)
        const medA = median(mine.map((d) => d.area));
        const solid = mine.filter((d) => d.area >= 0.2 * medA && d.fill > 0.68 && d.w / d.h > 0.8 && d.w / d.h < 1.25);
        if (solid.length >= 3 && solid.length >= 0.7 * mine.length && Math.max(...solid.map((d) => d.area)) / Math.min(...solid.map((d) => d.area)) < 1.8) {
          const sw = solid.slice().sort((a, b) => a.cx - b.cx);
          const colours = sw.map((d) => '#' + [d.r / d.area, d.g / d.area, d.b / d.area].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
          items.push({ kind: 'palette', guess: true, row: -1, col: si, box: toSheet(unionBox(sw, 0.02)), colours, members: sw.map((d) => d.id), pieces: 0, notes: [] });
          return;
        }
        // union-find on closeness
        const par = mine.map((_, i) => i);
        const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
        const med1 = median(mine.map((d) => Math.max(d.w, d.h)));
        for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
          const lim = 0.4 * Math.max(mine[i].w, mine[i].h, mine[j].w, mine[j].h);
          if (gap(mine[i], mine[j]) <= Math.min(lim, 0.5 * med1 + 4)) par[find(i)] = find(j);
        }
        const groups = new Map();
        mine.forEach((d, i) => { const k = find(i); (groups.get(k) || groups.set(k, []).get(k)).push(d); });
        const rowH = Math.max(1, med1 * 1.2);
        Array.from(groups.values()).map((g) => ({ g, cx: g.reduce((a, d) => a + d.cx, 0) / g.length, cy: g.reduce((a, d) => a + d.cy, 0) / g.length }))
          .sort((a, b) => Math.round(a.cy / rowH) - Math.round(b.cy / rowH) || a.cx - b.cx)
          .forEach(({ g }, gi) => {
            items.push({ kind: 'detail', guess: true, row: -1, col: si * 100 + gi, section: si, box: toSheet(unionBox(g, 0.12)), members: g.map((x) => x.id), pieces: 0, notes: [] });
          });
      });
      panels.push({ box: toSheet(f), sections: sections.length });
    }

    const furniture = pills.map((p) => ({ kind: used.has(p) ? 'label' : frameKids.has(p) ? 'title' : 'heading', box: toSheet(p) })).concat(panels.map((p) => ({ kind: 'panel', box: p.box })));
    const counts = items.reduce((a, i) => (a[i.kind] = (a[i.kind] || 0) + 1, a), {});
    return { _pills: pills, items, furniture, notes, counts, orphans: orphans.map(toSheet), _lab: lab, _w: w, _h: h, _scale: sc };
  }

  // A label or banner that touches a figure's hair is one dark piece with it. Labels have a cool navy tint (blue above red)
  // and hair/outlines a warm one, so once real labels are known, pill-coloured solid blocks are found by colour and lifted out.
  function hiddenPills(o, m, res) {
    const { w, h, rgba } = o, P = res._pills;
    if (P.length < 2) return [];
    let c = 0, l = 0;
    for (const p of P) { c += (p.b - p.r) / p.area; l += p.lum; }
    const pc = c / P.length, pl = l / P.length;
    if (pc < 5) return [];
    const fm = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!m[i]) continue;
      const q = i * 4;
      if (rgba[q + 2] - rgba[q] >= pc * 0.5 && Math.abs(0.299 * rgba[q] + 0.587 * rgba[q + 1] + 0.114 * rgba[q + 2] - pl) <= 30) fm[i] = 1;
    }
    const { comps } = label(fm, fm, rgba, w, h);
    const minH = Math.max(8, h * 0.012), maxH = h * 0.075;
    return comps.filter((c2) => c2.area >= 30 && c2.w / c2.h >= 2 && c2.h >= minH && c2.h <= maxH && c2.fill >= 0.4
      && !P.some((p) => gap(p, c2) === 0));
  }

  function read(o) {
    const { w, h } = o;
    const m0 = maskOf(o.rgba, w, h, o.bg, o.tol || 90);
    let res = analyse(o, m0, []);
    const hid = hiddenPills(o, m0, res);
    if (hid.length) {
      const m1 = m0.slice();
      for (const p of hid) for (let y = Math.max(0, p.y0 - 2); y <= Math.min(h - 1, p.y1 + 2); y++) for (let x = Math.max(0, p.x0 - 2); x <= Math.min(w - 1, p.x1 + 2); x++) m1[y * w + x] = 0;
      res = analyse(o, m1, hid);
      res.notes.push(`${hid.length} label or banner touching a figure was separated from it by its colour`);
    }
    return res;
  }

  // The figure's silhouette, by its outline instead of by colour distance.
  // Light parts (skin, hairband, eye whites, sleeves, shoe soles) look like the paper, so a colour test punches holes in them.
  // Instead: take this figure's own dark pieces as the barrier, flood from the box edge through everything else, and keep
  // whatever the flood could not reach. Pale gaps between legs open to the outside and are removed; enclosed whites stay.
  // Neighbours' pixels sit in the "else" and are reached by the flood, so they are removed too.
  function memberMask(res, item) {
    const w = res._w, h = res._h, sc = res._scale;
    const set = new Set(item.members.map((id) => Math.floor(id >= 1000 ? id / 1000 : id)));
    const x0 = Math.max(0, Math.floor(item.box.x * sc)), y0 = Math.max(0, Math.floor(item.box.y * sc));
    const x1 = Math.min(w - 1, Math.ceil((item.box.x + item.box.w) * sc)), y1 = Math.min(h - 1, Math.ceil((item.box.y + item.box.h) * sc));
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, N = bw * bh;
    const mem = new Uint8Array(N);
    const xr = item.xr;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (xr && (x + x0 < xr[0] || x + x0 > xr[1])) continue;     // a half cut from two joined drawings keeps only its own side
      if (set.has(res._lab[(y + y0) * w + x + x0])) mem[y * bw + x] = 1;
    }
    const bar = dilate(dilate(mem, bw, bh), bw, bh);            // 2 px: closes hairline breaks in the outline
    const out = new Uint8Array(N), st = new Int32Array(N);
    let sp = 0;
    const push = (i) => { if (!bar[i] && !out[i]) { out[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < bw; x++) { push(x); push((bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { push(y * bw); push(y * bw + bw - 1); }
    while (sp) {
      const i = st[--sp], x = i % bw, y = (i / bw) | 0;
      if (x > 0) push(i - 1); if (x < bw - 1) push(i + 1); if (y > 0) push(i - bw); if (y < bh - 1) push(i + bw);
    }
    for (let r = 0; r < 2; r++) {                                 // take back the 2 px ring the barrier added on the outer side
      const add = [];
      for (let i = 0; i < N; i++) {
        if (out[i] || mem[i]) continue;
        const x = i % bw, y = (i / bw) | 0;
        if ((x > 0 && out[i - 1]) || (x < bw - 1 && out[i + 1]) || (y > 0 && out[i - bw]) || (y < bh - 1 && out[i + bw])) add.push(i);
      }
      add.forEach((i) => { out[i] = 1; });
    }
    const keep = new Uint8Array(w * h);
    let n = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (!out[y * bw + x]) { keep[(y + y0) * w + x + x0] = 1; n++; }
    return keep;
  }

  // RGBA crop of one item from the full-resolution sheet; everything outside the figure's silhouette is transparent.
  // src: sheet RGBA at sheet resolution (sw x sh). item.box is in sheet pixels; res._scale maps sheet -> analysis pixels.
  function cropRgba(res, item, src, sw, sh) {
    const sc = res._scale, keep = memberMask(res, item);
    const bx = item.box.x, by = item.box.y, bw = item.box.w, bh = item.box.h;
    const out = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const X = bx + x, Y = by + y;
      if (X >= sw || Y >= sh) continue;
      const ax = Math.min(res._w - 1, Math.floor(X * sc)), ay = Math.min(res._h - 1, Math.floor(Y * sc));
      if (!keep[ay * res._w + ax]) continue;
      const si = (Y * sw + X) * 4, di = (y * bw + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
    return { w: bw, h: bh, rgba: out };
  }

  // edge test: does any of the figure's own pixels touch the box edge? (a cut-off figure)
  function touchesEdge(res, item) {
    const keep = memberMask(res, item), w = res._w, sc = res._scale;
    const x0 = Math.floor(item.box.x * sc), y0 = Math.floor(item.box.y * sc), x1 = Math.min(w - 1, Math.ceil((item.box.x + item.box.w) * sc)), y1 = Math.min(res._h - 1, Math.ceil((item.box.y + item.box.h) * sc));
    const set = new Set(item.members.map((id) => Math.floor(id >= 1000 ? id / 1000 : id)));
    const xr = item.xr, inX = (x) => !xr || (x >= xr[0] && x <= xr[1]);
    for (let x = x0; x <= x1; x++) if (inX(x) && (set.has(res._lab[y0 * w + x]) || set.has(res._lab[y1 * w + x]))) return true;
    for (let y = y0; y <= y1; y++) if ((inX(x0) && set.has(res._lab[y * w + x0])) || (inX(x1) && set.has(res._lab[y * w + x1]))) return true;
    return false;
  }

  const api = { read, memberMask, cropRgba, touchesEdge, maskOf, label, dilate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SheetReader = api;
})(typeof window !== 'undefined' ? window : this);
