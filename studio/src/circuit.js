'use strict';
// Circuit-board traces: right-angle runs with 45 degree corners and a round pad at the
// end, like the background of the portfolio site. Used as a texture (static tile) and as
// the "pulse" background effect (green current running along the traces).

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// count traces inside a w x h box; every trace starts on a grid point and ends in a pad
function traces(seed, w, h, count, grid) {
  const r = rng(seed);
  const g = grid || Math.round(Math.min(w, h) / 9);
  const cols = Math.floor(w / g);
  const rows = Math.floor(h / g);
  const out = [];
  for (let i = 0; i < count; i++) {
    let x = Math.floor(r() * cols);
    let y = Math.floor(r() * rows);
    const pts = [[x, y]];
    let dir = Math.floor(r() * 4); // 0 right, 1 down, 2 left, 3 up
    const steps = 3 + Math.floor(r() * 4);
    for (let s = 0; s < steps; s++) {
      const len = 2 + Math.floor(r() * 5);
      const dx = [1, 0, -1, 0][dir];
      const dy = [0, 1, 0, -1][dir];
      x = Math.max(0, Math.min(cols, x + dx * len));
      y = Math.max(0, Math.min(rows, y + dy * len));
      pts.push([x, y]);
      // corner: turn 90 degrees, with a short 45 degree cut between the runs
      const turn = r() < 0.5 ? 1 : 3;
      const nd = (dir + turn) % 4;
      if (r() < 0.6) {
        x = Math.max(0, Math.min(cols, x + dx + [1, 0, -1, 0][nd]));
        y = Math.max(0, Math.min(rows, y + dy + [0, 1, 0, -1][nd]));
        pts.push([x, y]);
      }
      dir = nd;
    }
    const abs = pts.map(([px, py]) => [px * g, py * g]);
    out.push({ d: 'M' + abs.map((p) => p.join(' ')).join(' L'), end: abs[abs.length - 1], start: abs[0] });
  }
  return out;
}

module.exports = { traces, rng };
