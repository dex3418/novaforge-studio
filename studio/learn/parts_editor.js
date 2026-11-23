'use strict';
// Joint editor for the Parts tab (v32): shows one part picture and lets you tap or drag its joints into place, by mouse or finger.
// Pure geometry (testable in node) plus one DOM function, mount(). The page carries its own copy of this file between the
// PARTS_EDITOR markers; the server swaps in the current file whenever it serves the page.
// Joint positions are normalised (0..1) inside the picture, the same numbers the rig file stores.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartsEditor = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HIT = 26;                         // how close a finger or mouse must be to grab a joint, in screen pixels
  const COLORS = { neck: '#f59e0b', waist: '#a855f7', shoulder: '#22d3ee', elbow: '#34d399', wrist: '#fb7185', hip: '#60a5fa', knee: '#f472b6', ankle: '#facc15' };
  const base = (id) => id.replace(/_[lr]$/, '');
  const colorOf = (id) => COLORS[base(id)] || '#ffffff';

  // a point in the picture (pixels) as 0..1 numbers, kept inside the picture
  function toNorm(px, py, w, h) { return { x: +clamp(px / w, 0, 1).toFixed(4), y: +clamp(py / h, 0, 1).toFixed(4) }; }
  function toPx(j, w, h) { return { x: j.x * w, y: j.y * h }; }
  // the joint closest to a point, if it is within `radius` pixels. Distances are measured on the screen, not in 0..1 units.
  function nearest(joints, px, py, w, h, radius) {
    let best = null, bd = (radius === undefined ? HIT : radius);
    for (const id of Object.keys(joints)) {
      const p = toPx(joints[id], w, h), d = Math.hypot(p.x - px, p.y - py);
      if (d <= bd) { bd = d; best = id; }
    }
    return best;
  }
  // put one joint somewhere; placing a joint means you have looked at it, so it counts as confirmed
  function place(joints, id, nx, ny) {
    if (!joints[id]) throw new Error('no joint ' + id);
    const out = {}; for (const k of Object.keys(joints)) out[k] = Object.assign({}, joints[k]);
    out[id] = { x: +clamp(nx, 0, 1).toFixed(4), y: +clamp(ny, 0, 1).toFixed(4), confirmed: true };
    return out;
  }
  function acceptAll(joints) { const out = {}; for (const k of Object.keys(joints)) out[k] = Object.assign({}, joints[k], { confirmed: true }); return out; }
  const unconfirmed = (joints) => Object.keys(joints).filter((k) => !joints[k].confirmed);
  // which joint to select after one is placed: the next one still waiting, in the order the part lists them
  function nextWaiting(joints, after) {
    const ids = Object.keys(joints), start = Math.max(0, ids.indexOf(after));
    for (let i = 1; i <= ids.length; i++) { const id = ids[(start + i) % ids.length]; if (!joints[id].confirmed) return id; }
    return null;
  }

  // mount(host, { src, w, h, title?, joints:{id:{x,y,confirmed}}, labelOf?(id), onChange(joints, why) })
  // src is any image URL (the traced vector as a data URL). Returns { get, set, select, redraw, destroy }.
  function mount(host, o) {
    const doc = host.ownerDocument;
    const wrap = doc.createElement('div'); wrap.className = 'jointed';
    const chips = doc.createElement('div'); chips.className = 'chips';
    const cv = doc.createElement('canvas'); cv.className = 'joint-canvas'; cv.style.touchAction = 'none'; cv.style.width = '100%'; cv.style.display = 'block';
    const bar = doc.createElement('div'); bar.className = 'row';
    wrap.append(chips, cv, bar); host.appendChild(wrap);
    let joints = {}; for (const k of Object.keys(o.joints)) joints[k] = Object.assign({}, o.joints[k], { confirmed: !!o.joints[k].confirmed });
    let sel = nextWaiting(joints, null) || Object.keys(joints)[0], drag = null, moved = false, img = null;
    const label = (id) => (o.labelOf ? o.labelOf(id) : id);

    function fit() {
      const cssW = Math.max(160, Math.min(host.clientWidth || 360, 520));
      const cssH = Math.round(cssW * o.h / o.w);
      const maxH = 460; const k = cssH > maxH ? maxH / cssH : 1;
      cv.width = Math.round(cssW * k * 2); cv.height = Math.round(cssH * k * 2);      // drawn at 2x so it stays sharp on phones
      cv.style.width = Math.round(cssW * k) + 'px'; cv.style.height = Math.round(cssH * k) + 'px';
    }
    function point(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * o.w, y: (e.clientY - r.top) / r.height * o.h, k: o.w / r.width }; }
    function redraw() {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      const t = 16; for (let y = 0; y < cv.height; y += t) for (let x = 0; x < cv.width; x += t) { ctx.fillStyle = ((x / t + y / t) & 1) ? '#2a2549' : '#211d3d'; ctx.fillRect(x, y, t, t); }
      if (img) ctx.drawImage(img, 0, 0, cv.width, cv.height);
      for (const id of Object.keys(joints)) {
        const p = toPx(joints[id], cv.width, cv.height), on = id === sel, r = (on ? 15 : 11);
        ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2, 0, 7); ctx.stroke();
        ctx.lineWidth = 4; ctx.strokeStyle = colorOf(id); ctx.setLineDash(joints[id].confirmed ? [] : [7, 6]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        if (joints[id].confirmed) { ctx.fillStyle = colorOf(id); ctx.beginPath(); ctx.arc(p.x, p.y, r - 6, 0, 7); ctx.fill(); }
      }
    }
    function drawChips() {
      chips.innerHTML = '';
      for (const id of Object.keys(joints)) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'ghost chip' + (id === sel ? ' on' : '');
        b.style.borderColor = colorOf(id); b.dataset.joint = id;
        b.textContent = (joints[id].confirmed ? '✓ ' : '○ ') + label(id);
        b.onclick = () => select(id);
        chips.appendChild(b);
      }
    }
    function emit(why) { drawChips(); redraw(); if (o.onChange) o.onChange(get(), why); }
    function select(id) { if (joints[id]) { sel = id; drawChips(); redraw(); } }
    function get() { const out = {}; for (const k of Object.keys(joints)) out[k] = Object.assign({}, joints[k]); return out; }
    function set(j) { joints = {}; for (const k of Object.keys(j)) joints[k] = Object.assign({}, j[k]); if (!joints[sel]) sel = Object.keys(joints)[0]; drawChips(); redraw(); }

    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = point(e), hitId = nearest(joints, p.x, p.y, o.w, o.h, HIT * p.k);
      if (hitId) { sel = hitId; drag = hitId; moved = false; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* fine */ } drawChips(); redraw(); return; }
      if (sel) { const n = toNorm(p.x, p.y, o.w, o.h); joints = place(joints, sel, n.x, n.y); sel = nextWaiting(joints, sel) || sel; emit('placed'); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return; e.preventDefault();
      const p = point(e), n = toNorm(p.x, p.y, o.w, o.h);
      moved = true; joints = place(joints, drag, n.x, n.y); redraw();
    });
    // a tap on a dot says "yes, it is right here" and confirms it where it sits; a drag moves it and confirms it too
    const up = () => {
      if (!drag) return;
      const id = drag; drag = null;
      if (!moved) { const j = joints[id]; joints = place(joints, id, j.x, j.y); sel = nextWaiting(joints, id) || id; }
      emit(moved ? 'moved' : 'confirmed');
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

    const accept = doc.createElement('button'); accept.type = 'button'; accept.className = 'ghost'; accept.textContent = 'Accept the guesses';
    accept.onclick = () => { joints = acceptAll(joints); emit('accepted'); };
    const hint = doc.createElement('span'); hint.className = 'hint'; hint.textContent = 'Tap a dot to say it is right, drag it to move it, or pick a joint and tap where it bends. Dashed ring = still a guess.';
    bar.append(accept, hint);

    fit(); drawChips();
    const im = new Image(); im.onload = () => { img = im; redraw(); }; im.onerror = () => redraw(); im.src = o.src; redraw();
    return { get, set, select, redraw, destroy: () => wrap.remove() };
  }

  return { HIT, COLORS, colorOf, toNorm, toPx, nearest, place, acceptAll, unconfirmed, nextWaiting, mount };
}));
