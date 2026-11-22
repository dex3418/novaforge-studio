'use strict';
// Manual crop editor for the Learning Studio: draw, move, resize and delete boxes on a sheet, by mouse or finger.
// Pure geometry (testable in node) plus one DOM function, mount(). The page carries its own copy of this file
// between the CROP_EDITOR markers; the server swaps in the current file whenever it serves the page.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CropEditor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 12;                       // smallest box side, in sheet pixels
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // a box from two corner points, kept inside the sheet
  function norm(x0, y0, x1, y1, W, H) {
    const a = clamp(Math.min(x0, x1), 0, W), b = clamp(Math.min(y0, y1), 0, H);
    const c = clamp(Math.max(x0, x1), 0, W), d = clamp(Math.max(y0, y1), 0, H);
    return { x: Math.round(a), y: Math.round(b), w: Math.round(c - a), h: Math.round(d - b) };
  }

  function handlePoints(b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.x + b.w, d = b.y + b.h;
    return { nw: [b.x, b.y], n: [cx, b.y], ne: [r, b.y], e: [r, cy], se: [r, d], s: [cx, d], sw: [b.x, d], w: [b.x, cy] };
  }

  // what is under the point (x, y)? tol = how far from a handle still counts, in sheet pixels.
  // The selected box's handles win, then the smallest box containing the point (so a box inside a box can be picked).
  function hit(boxes, x, y, tol, selected) {
    if (selected != null && boxes[selected]) {
      const hp = handlePoints(boxes[selected]);
      let best = null, bd = tol;
      for (const k of Object.keys(hp)) { const d = Math.hypot(hp[k][0] - x, hp[k][1] - y); if (d <= bd) { bd = d; best = k; } }
      if (best) return { i: selected, handle: best };
    }
    let pick = -1, area = Infinity;
    boxes.forEach((b, i) => { if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h && b.w * b.h < area) { area = b.w * b.h; pick = i; } });
    return pick >= 0 ? { i: pick, handle: 'move' } : null;
  }

  // the box after dragging a handle by (dx, dy)
  function apply(box, handle, dx, dy, W, H, min) {
    const m = min || MIN;
    let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
    if (handle === 'move') {
      const nx = clamp(x0 + dx, 0, W - box.w), ny = clamp(y0 + dy, 0, H - box.h);
      return { x: Math.round(nx), y: Math.round(ny), w: box.w, h: box.h };
    }
    if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - m);
    if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + m, W);
    if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - m);
    if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + m, H);
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  }

  // shrink a box to the drawing inside it: the bounding box of everything that is not the background, plus a margin
  function tighten(rgba, w, h, box, bg, tol, pad) {
    const t = tol == null ? 60 : tol, p = pad == null ? 4 : pad;
    const x0 = clamp(Math.floor(box.x), 0, w), y0 = clamp(Math.floor(box.y), 0, h);
    const x1 = clamp(Math.ceil(box.x + box.w), 0, w), y1 = clamp(Math.ceil(box.y + box.h), 0, h);
    let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        if (rgba[i + 3] < 16) continue;
        const d = Math.abs(rgba[i] - bg.r) + Math.abs(rgba[i + 1] - bg.g) + Math.abs(rgba[i + 2] - bg.b);
        if (d > t) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      }
    }
    if (maxx < 0) return { x: box.x, y: box.y, w: box.w, h: box.h };
    return norm(minx - p, miny - p, maxx + 1 + p, maxy + 1 + p, w, h);
  }

  // reading order: rows from the top, left to right inside a row
  function sortReading(boxes) {
    const list = boxes.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const rows = [];
    for (const b of list) {
      const cy = b.y + b.h / 2;
      const row = rows.find((r) => Math.abs(r.cy - cy) < Math.max(r.h, b.h) * 0.5);
      if (row) { row.items.push(b); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; row.h = Math.max(row.h, b.h); }
      else rows.push({ cy, h: b.h, items: [b] });
    }
    rows.sort((a, b) => a.cy - b.cy);
    return rows.reduce((acc, r) => acc.concat(r.items.sort((a, b) => a.x - b.x)), []);
  }

  const CUR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

  // mount(host, { sheet:{canvas,w,h,bg}, boxes:[{x,y,w,h,name?,...}], onChange(boxes, why), nextName?() })
  // The boxes array is edited in place. A box the person moved or resized gets edited = true.
  function mount(host, o) {
    const doc = host.ownerDocument;
    const sh = o.sheet, boxes = o.boxes;
    let sel = null, drag = null, locked = false, undo = [];
    const wrap = doc.createElement('div'); wrap.className = 'cropwrap';
    const bar = doc.createElement('div'); bar.className = 'cropbar';
    const mk = (t, title) => { const b = doc.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = t; b.title = title || ''; bar.appendChild(b); return b; };
    const bDel = mk('Delete box', 'Delete the selected box');
    const bTight = mk('Fit to drawing', 'Shrink the selected box to the drawing inside it');
    const bUndo = mk('Undo', 'Undo the last change');
    const bLock = mk('Scroll mode', 'Switch between drawing boxes and scrolling the page with your finger');
    const hint = doc.createElement('div'); hint.className = 'hint';
    hint.textContent = 'Drag on the picture to draw a box. Tap a box to select it, then drag it or its square handles. Pinch or scroll with Scroll mode.';
    const cv = doc.createElement('canvas'); cv.className = 'prev crop';
    wrap.appendChild(bar); wrap.appendChild(hint); wrap.appendChild(cv); host.appendChild(wrap);
    const W = Math.min(1000, sh.w); cv.width = W; cv.height = Math.max(1, Math.round(sh.h * W / sh.w));
    cv.style.touchAction = 'none';
    const k = cv.width / sh.w;
    const ctx = cv.getContext('2d');

    const snap = () => undo.push(JSON.stringify(boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, name: b.name, edited: b.edited }))));
    const changed = (why) => { redraw(); if (o.onChange) o.onChange(boxes, why); };
    function redraw() {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(sh.canvas, 0, 0, cv.width, cv.height);
      boxes.forEach((b, i) => {
        const on = i === sel;
        ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = on ? '#2f5fd0' : '#e03131';
        ctx.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
        const label = String(i + 1);
        ctx.font = 'bold 14px sans-serif'; const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = on ? '#2f5fd0' : '#e03131'; ctx.fillRect(b.x * k, Math.max(0, b.y * k - 18), tw, 18);
        ctx.fillStyle = '#fff'; ctx.fillText(label, b.x * k + 4, Math.max(0, b.y * k - 18) + 14);
        if (on) { const hp = handlePoints(b); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2f5fd0'; ctx.lineWidth = 2; for (const p of Object.values(hp)) { ctx.fillRect(p[0] * k - 6, p[1] * k - 6, 12, 12); ctx.strokeRect(p[0] * k - 6, p[1] * k - 6, 12, 12); } }
      });
      if (drag && drag.kind === 'new') { ctx.setLineDash([6, 4]); ctx.strokeStyle = '#2f5fd0'; ctx.lineWidth = 2; ctx.strokeRect(drag.box.x * k, drag.box.y * k, drag.box.w * k, drag.box.h * k); ctx.setLineDash([]); }
      bDel.disabled = sel == null; bTight.disabled = sel == null; bUndo.disabled = !undo.length;
      bLock.textContent = locked ? 'Draw mode' : 'Scroll mode';
      cv.style.touchAction = locked ? 'pan-y pinch-zoom' : 'none';
    }
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width / k, (e.clientY - r.top) * cv.height / r.height / k]; };

    cv.addEventListener('pointerdown', (e) => {
      if (locked) return;
      const [x, y] = pt(e);
      const tol = 16 / k * (cv.width / cv.getBoundingClientRect().width);
      const h = hit(boxes, x, y, tol, sel);
      cv.setPointerCapture(e.pointerId);
      if (h) { sel = h.i; drag = { kind: 'edit', handle: h.handle, sx: x, sy: y, orig: { x: boxes[h.i].x, y: boxes[h.i].y, w: boxes[h.i].w, h: boxes[h.i].h }, moved: false }; }
      else { sel = null; drag = { kind: 'new', sx: x, sy: y, box: { x: Math.round(x), y: Math.round(y), w: 0, h: 0 } }; }
      redraw();
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pt(e);
      if (!drag) { const h = hit(boxes, x, y, 16 / k, sel); cv.style.cursor = h ? CUR[h.handle] : 'crosshair'; return; }
      if (drag.kind === 'new') drag.box = norm(drag.sx, drag.sy, x, y, sh.w, sh.h);
      else {
        if (!drag.moved) { snap(); drag.moved = true; }
        const b = boxes[sel], nb = apply(drag.orig, drag.handle, x - drag.sx, y - drag.sy, sh.w, sh.h);
        b.x = nb.x; b.y = nb.y; b.w = nb.w; b.h = nb.h; b.edited = true;
      }
      redraw();
    });
    const up = () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.kind === 'new') {
        if (d.box.w >= MIN && d.box.h >= MIN) {
          snap();
          const b = { x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h, edited: true };
          if (o.nextName) b.name = o.nextName(boxes);
          boxes.push(b); sel = boxes.length - 1; changed('add');
        } else redraw();
      } else if (d.moved) changed('edit'); else redraw();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

    bDel.onclick = () => { if (sel == null) return; snap(); boxes.splice(sel, 1); sel = null; changed('delete'); };
    bTight.onclick = () => {
      if (sel == null) return;
      const full = sh.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sh.w, sh.h).data;
      snap(); const nb = tighten(full, sh.w, sh.h, boxes[sel], sh.bg || { r: 255, g: 255, b: 255 }, 60, 4);
      Object.assign(boxes[sel], nb, { edited: true }); changed('fit');
    };
    bUndo.onclick = () => {
      const s = undo.pop(); if (!s) return;
      const list = JSON.parse(s); boxes.length = 0; list.forEach((b) => boxes.push(b)); sel = null; changed('undo');
    };
    bLock.onclick = () => { locked = !locked; redraw(); };
    redraw();
    return { select: (i) => { sel = i; redraw(); }, redraw, destroy: () => wrap.remove() };
  }

  return { MIN, norm, handlePoints, hit, apply, tighten, sortReading, mount };
}));
