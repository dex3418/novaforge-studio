'use strict';
// Your ratings (like / neutral / dislike) arrive with every run as a compact JSON
// string in the CALIBRATION environment variable. It biases the choices the planner
// makes (template, colours, textures, transitions, background effects) and is shown to
// the AI director as guidance. It never changes the spoken text. No calibration = no change.
//
// shape: { v:1, n:<ratings>, scores:{ template:{id:score}, palette:{...}, texture, transition, decor, kind },
//          caption:{liked:<share>, disliked:<share>}, notes:"your standing notes" }
// score > 0.75 = liked, < -0.75 = avoid (the box computes these from your ratings)

const LIKE = 0.75;
let cached;

function load() {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const j = JSON.parse(process.env.CALIBRATION || '');
    if (j && j.v === 1 && j.scores && typeof j.scores === 'object') cached = j;
  } catch (e) {
    /* none */
  }
  return cached;
}

const score = (axis, id) => {
  const c = load();
  const v = c && c.scores[axis] ? Number(c.scores[axis][id]) : 0;
  return Number.isFinite(v) ? v : 0;
};
const liked = (axis, id) => score(axis, id) >= LIKE;
const avoided = (axis, id) => score(axis, id) <= -LIKE;

// liked first, avoided last, the rest keep their order
function order(axis, ids) {
  return ids.map((id, i) => ({ id, i, s: score(axis, id) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.id);
}
// drops avoided choices as long as at least `min` remain
function pool(axis, ids, min = 3) {
  const ok = ids.filter((id) => !avoided(axis, id));
  return ok.length >= min ? ok : ids;
}

function names(axis, test) {
  const c = load();
  return c ? Object.keys(c.scores[axis] || {}).filter((id) => test(axis, id)).sort((a, b) => score(axis, b) - score(axis, a)) : [];
}

// text for the AI director prompt ('' when there is nothing to say)
function promptText() {
  const c = load();
  if (!c || !c.n) return '';
  const lines = [];
  for (const axis of ['template', 'palette', 'texture', 'transition', 'decor', 'kind']) {
    const up = names(axis, liked);
    const down = names(axis, avoided);
    if (up.length) lines.push(`- ${axis}: the user liked ${up.slice(0, 6).join(', ')}`);
    if (down.length) lines.push(`- ${axis}: the user disliked ${down.slice(0, 6).join(', ')} (use rarely or not at all)`);
  }
  if (c.caption && Number.isFinite(c.caption.disliked) && Number.isFinite(c.caption.liked) && c.caption.disliked - c.caption.liked > 0.1) {
    lines.push(`- plain captions: liked videos had ${Math.round(c.caption.liked * 100)}% caption beats, disliked ones ${Math.round(c.caption.disliked * 100)}%: use fewer plain captions`);
  }
  if (c.notes) lines.push(`- standing notes from the user: ${String(c.notes).slice(0, 1200)}`);
  return lines.length ? `CALIBRATION (from the user's ${c.n} past ratings; follow it where it fits the script):\n${lines.join('\n')}\n` : '';
}

function summary() {
  const c = load();
  if (!c || !c.n) return 'no calibration sent (no ratings yet)';
  const bits = ['template', 'palette', 'texture', 'transition', 'decor'].map((a) => [a, names(a, avoided)]).filter(([, v]) => v.length).map(([a, v]) => `avoiding ${a} ${v.slice(0, 4).join('/')}`);
  const up = ['template', 'palette', 'texture'].map((a) => [a, names(a, liked)]).filter(([, v]) => v.length).map(([a, v]) => `favouring ${a} ${v.slice(0, 3).join('/')}`);
  return `calibration from ${c.n} ratings applied${[...up, ...bits].length ? ': ' + [...up, ...bits].join('; ') : ' (no strong likes or dislikes yet)'}`;
}

module.exports = { load, score, liked, avoided, order, pool, promptText, summary, LIKE };
