'use strict';
// Blocking: where people stand, who they face and who passes in front of whom. Pure, no drawing.
//
//   analyse(actors) -> { actors, lanes, warnings }
//     actors    a corrected copy (the input is never changed)
//     lanes     { id: 0 | 1 }  1 = walks on the front lane (drawn nearer the camera) because the path crosses someone
//     warnings  [{ code, id, other?, msg }]  everything that was fixed or looks wrong, in plain words
//
// actors use the storyboard fields: { id, x0, x1, facing, faceTo?, speaks?, pose? } with x as a fraction of the stage width.
// Rules (each one is a real bug seen in a render, see tests/blocking.test.js):
//   1. A walker who crosses another person gets the front lane, so the two never share a depth and draw through each other.
//   2. Someone who stands still faces the nearest other person unless the plan already says who to face.
//   3. A speaker does not walk away from everybody: they keep their place while they talk (a warning says so).
//   4. A walk does not end inside another person: the end is moved to a spaced stand beside them.

const MOVE = 0.02;      // smaller than this is standing still (same threshold as the stage)
const PASS = 0.07;      // how close a path may come to someone before it counts as crossing them
const SPACE = 0.1;      // minimum gap between two people who end up standing (about one body width)
const OFFSTAGE = 1.05;  // beyond this a person has left the frame: spacing and facing no longer apply

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function analyse(input) {
  const warnings = [];
  const list = (Array.isArray(input) ? input : []).map((a) => ({ ...a }));
  list.forEach((a) => { a.x0 = num(a.x0, 0.5); a.x1 = num(a.x1, a.x0); });
  const moving = (a) => Math.abs(a.x1 - a.x0) > MOVE;
  const name = (a) => a.id;

  // 3. a speaker does not walk away from everybody
  list.forEach((a) => {
    if (!a.speaks || !moving(a) || list.length < 2) return;
    const dir = Math.sign(a.x1 - a.x0);
    const others = list.filter((o) => o !== a);
    const away = others.every((o) => (num(o.x1, o.x0) - a.x0) * dir <= 0.02 || num(o.x1, o.x0) > OFFSTAGE || num(o.x1, o.x0) < -0.05);
    if (away) {
      warnings.push({ code: 'speaker_walks_away', id: name(a), msg: `${name(a)} was walking away from everyone while speaking, so ${name(a)} now speaks from where they stand` });
      a.x1 = a.x0;
    }
  });

  // 4. a walk does not end inside another person
  list.forEach((a) => {
    if (!moving(a) || a.x1 > OFFSTAGE || a.x1 < -0.05) return;
    for (const o of list) {
      if (o === a) continue;
      const ox = num(o.x1, o.x0);
      if (ox > OFFSTAGE || ox < -0.05) continue;
      if (Math.abs(a.x1 - ox) < SPACE) {
        const side = a.x0 === ox ? (a.x1 >= ox ? 1 : -1) : Math.sign(a.x0 - ox);   // stop on the side they came from
        const fixed = Math.max(-0.3, Math.min(1.3, ox + side * SPACE));
        warnings.push({ code: 'ends_inside', id: name(a), other: name(o), msg: `${name(a)} would have stopped inside ${name(o)}, so the walk now ends beside ${name(o)}` });
        a.x1 = fixed;
      }
    }
  });
  // two people who simply start too close are reported, not moved (the plan chose it)
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (!moving(a) && !moving(b) && Math.abs(a.x1 - b.x1) < SPACE * 0.6) warnings.push({ code: 'stand_close', id: name(a), other: name(b), msg: `${name(a)} and ${name(b)} stand almost on top of each other` });
  }

  // 1. lanes: a walker who crosses someone passes in front
  const lanes = {};
  list.forEach((a) => { lanes[a.id] = 0; });
  const span = (a) => [Math.min(a.x0, a.x1), Math.max(a.x0, a.x1)];
  list.forEach((a, i) => {
    if (!moving(a)) return;
    const [lo, hi] = span(a);
    list.forEach((o, j) => {
      if (o === a) return;
      const [olo, ohi] = span(o);
      const crosses = moving(o) ? !(ohi < lo - PASS || olo > hi + PASS) : (o.x0 >= lo - PASS && o.x0 <= hi + PASS);
      if (!crosses) return;
      if (!moving(o)) { lanes[a.id] = 1; }
      else if (j < i) { lanes[a.id] = 1; }                                  // two walkers: the later one takes the front lane
      if (lanes[a.id] === 1) warnings.push({ code: 'passes_in_front', id: name(a), other: name(o), msg: `${name(a)} crosses ${name(o)}, so ${name(a)} walks on the front lane` });
    });
  });

  // 2. a person who stands still faces the nearest other person
  list.forEach((a) => {
    if (moving(a) || a.faceTo != null || list.length < 2) return;
    let best = null, bd = Infinity;
    for (const o of list) {
      if (o === a) continue;
      const ox = num(o.x1, o.x0);
      if (ox > OFFSTAGE || ox < -0.05) continue;
      const d = Math.abs(ox - a.x1);
      if (d < bd) { bd = d; best = ox; }
    }
    if (best != null && bd > 0.001) {
      const want = best > a.x1 ? 1 : -1;
      if (a.facing !== want && (a.speaks || list.some((o) => o.speaks))) warnings.push({ code: 'faced_away', id: name(a), msg: `${name(a)} was facing away from the people in the scene, so ${name(a)} now faces ${want > 0 ? 'right' : 'left'} toward them` });
      a.faceTo = best;
    }
  });

  // report each pair once
  const seen = new Set();
  const uniq = warnings.filter((w) => { const k = `${w.code}|${w.id}|${w.other || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { actors: list, lanes, warnings: uniq };
}

module.exports = { analyse, MOVE, PASS, SPACE };
