'use strict';
// Casting: gives every person in a story a trained library character that fits them, so nobody is drawn as the
// old flat figure. Pure functions (no files), so it also works inside the render bundle.
//
//   assign(cast, have, genderOf)  ->  { castId: libraryCharacterId }   (only for people that get artwork)
//
// 1. A person named like a library character gets that character ("Mangal", "Zoya", "Naina").
// 2. Everyone else gets the best fit from the characters that have been trained and have a profile in
//    casting_data.js: gender first, then age group (child / adult / elder), then looks (turban, glasses, saree ...).
// 3. Nobody shares a character while there is an unused one left.

const DATA = require('./casting_data');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const aliasOf = {};
for (const [id, p] of Object.entries(DATA)) { aliasOf[norm(id)] = id; aliasOf[norm(p.name)] = id; (p.alias || []).forEach((a) => { aliasOf[norm(a)] = id; }); }

const group = (age) => (age < 13 ? 'child' : age < 60 ? 'adult' : 'elder');
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// what the cast line asked for, as a target the profiles are compared to
function wanted(c, genderOf) {
  const look = c.look || {};
  const want = look.age === 'child' ? 'child' : look.age === 'elder' ? 'elder' : 'adult';
  const tags = new Set();
  if (look.hair === 'turban') tags.add('turban');
  if (look.hair === 'cap') tags.add('cap');
  if (look.hair === 'bun') tags.add('bun');
  if (look.glasses) tags.add('glasses');
  if (look.beard) tags.add('beard');
  if (look.moustache) tags.add('moustache');
  if (look.outfit === 'saree') tags.add('saree');
  if (look.outfit === 'kurta') tags.add('kurta');
  if (look.outfit === 'uniform') { tags.add('uniform'); tags.add('school'); }
  if (look.outfit === 'dress') tags.add('dress');
  return { gender: genderOf(c), want, target: want === 'child' ? 8 : want === 'elder' ? 68 : 35, tags };
}

function score(w, p) {
  let s = 0;
  s += p.gender === w.gender ? 12 : -12;
  s += group(p.age) === w.want ? 10 : -10;
  s -= Math.min(6, Math.abs(p.age - w.target) / 8); // closer in age is better
  for (const t of w.tags) s += (p.tags || []).includes(t) ? 3 : 0;
  return s;
}

function assign(cast, have, genderOf) {
  const has = typeof have === 'function' ? have : (id) => Array.isArray(have) && have.includes(id);
  const out = {};
  const used = new Set();
  const gof = genderOf || ((c) => (c.look && c.look.gender) || (hash(c.name) % 2 ? 'm' : 'f'));
  // 1. named like a library character
  for (const c of cast) {
    const direct = has(c.id) ? c.id : aliasOf[norm(c.id)] || aliasOf[norm(c.name)];
    if (direct && has(direct)) { out[c.id] = direct; used.add(direct); }
  }
  // 2 and 3. everyone else, best fit that is still free (every character once the free ones are gone)
  const pool = Object.keys(DATA).filter(has);
  for (const c of cast) {
    if (out[c.id] || !pool.length) continue;
    const w = wanted(c, gof);
    const ranked = pool
      .map((id) => ({ id, s: score(w, DATA[id]) - (used.has(id) ? 40 : 0) + (hash(c.name + id) % 100) / 1000 }))
      .sort((a, b) => b.s - a.s);
    out[c.id] = ranked[0].id;
    used.add(ranked[0].id);
  }
  return out;
}

// how tall a character stands on screen, relative to a grown-up (all trained sheets are drawn at the same height)
function sizeOf(id) {
  const p = DATA[id];
  if (!p) return 0; // not a profiled character: the story keeps its old rule (child 0.68, elder 0.95)
  const a = p.age;
  if (a < 1.5) return 0.42;
  if (a < 5) return 0.42 + (a - 1.5) * 0.04;      // toddler 0.42 .. 0.56
  if (a < 13) return 0.56 + (a - 5) * 0.03;       // child 0.56 .. 0.80
  if (a < 16) return 0.80 + (a - 13) * 0.06;      // teen 0.80 .. 0.98
  if (a >= 60) return 0.95;                        // elder
  return 1;
}

module.exports = { assign, sizeOf, DATA, group };
