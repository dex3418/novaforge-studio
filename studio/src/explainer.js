'use strict';
// "explainer": a small animated diagram that is drawn step by step while the narration is spoken.
// Two charts for now: "bars" (a row of values) and "flow" (boxes joined by arrows).
// The director only chooses WHAT happens WHEN (a list of cues); this file draws it the same way every time.
//
//   data = {
//     chart: 'bars' | 'flow',   look: 'clean' | 'neon',   title?: 'max 6 words',
//     bars: values: [2..8 numbers], labels?: [text per bar]
//     flow: nodes: [{id, label}] (2..6), links: [{from, to, label?}] (max 8)
//     cues: [{ frac: 0..1, op, target, to?, tone?, text? }]      (frac = how much of the narration has been said)
//   }
//   ops   : bars  hi(target) tag(target,text) arc(target,to,text?) dim(target = the bar that stays bright) note(text) strike
//           flow  show(target) hi(target) tag(target,text) note(text) strike
//   tones : good | bad | buy | neutral

const OPS_BARS = ['hi', 'tag', 'arc', 'dim', 'note', 'strike'];
const OPS_FLOW = ['show', 'hi', 'tag', 'note', 'strike'];
const TONE_NAMES = ['good', 'bad', 'buy', 'neutral'];
const TONES = {
  clean: { good: '#22d3ee', bad: '#f43f5e', buy: '#34d399', neutral: '#9ca3af' },
  neon: { good: '#a78bfa', bad: '#f472b6', buy: '#facc15', neutral: '#94a3b8' },
};
const DEFAULT_TONE = { hi: 'good', tag: 'neutral', arc: 'good', note: 'neutral', dim: 'neutral', show: 'neutral', strike: 'bad' };

const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const words = (s, n) => String(s).trim().split(/\s+/).slice(0, n).join(' ');
const rgb = (hex) => { const h = String(hex).replace('#', ''); const f = h.length === 3 ? h.replace(/./g, '$&$&') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0); };
const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

// Returns a safe copy of the data, or null when there is nothing drawable. Bad cues are dropped, never trusted.
function normalize(d) {
  if (!d || typeof d !== 'object') return null;
  const chart = d.chart === 'flow' ? 'flow' : d.chart === 'bars' ? 'bars' : null;
  if (!chart) return null;
  const o = { chart, look: d.look === 'neon' ? 'neon' : 'clean', title: isStr(d.title) ? words(d.title, 6) : '' };
  let ids = [];
  if (chart === 'bars') {
    const v = Array.isArray(d.values) ? d.values.map(Number) : [];
    if (v.length < 2 || v.length > 8 || !v.every((x) => Number.isFinite(x) && x >= 0 && x <= 1e9)) return null;
    o.values = v;
    o.labels = Array.isArray(d.labels) ? v.map((_, i) => (isStr(d.labels[i]) || typeof d.labels[i] === 'number' ? words(d.labels[i], 2) : '')) : [];
  } else {
    const nodes = Array.isArray(d.nodes) ? d.nodes : [];
    if (nodes.length < 2 || nodes.length > 6) return null;
    const seen = new Set();
    o.nodes = [];
    for (const n of nodes) {
      const id = n && String(n.id == null ? '' : n.id).trim().slice(0, 20);
      if (!id || seen.has(id) || !isStr(n.label)) return null;
      seen.add(id); o.nodes.push({ id, label: words(n.label, 3) });
    }
    ids = o.nodes.map((n) => n.id);
    o.links = (Array.isArray(d.links) ? d.links : []).filter((l) => l && ids.includes(String(l.from)) && ids.includes(String(l.to)) && String(l.from) !== String(l.to)).slice(0, 8)
      .map((l) => ({ from: String(l.from), to: String(l.to), label: isStr(l.label) ? words(l.label, 3) : '' }));
  }
  const ops = chart === 'bars' ? OPS_BARS : OPS_FLOW;
  const okTarget = (t) => (chart === 'bars' ? Number.isInteger(Number(t)) && t !== '' && t !== null && Number(t) >= 0 && Number(t) < o.values.length : ids.includes(String(t)));
  const cues = [];
  for (const c of Array.isArray(d.cues) ? d.cues : []) {
    if (!c || !ops.includes(c.op)) continue;
    const needsTarget = ['hi', 'tag', 'arc', 'dim', 'show'].includes(c.op);
    if (needsTarget && !okTarget(c.target)) continue;
    if (c.op === 'arc' && (!okTarget(c.to) || String(c.to) === String(c.target))) continue;
    if ((c.op === 'tag' || c.op === 'note') && !isStr(c.text)) continue;
    cues.push({
      frac: Number.isFinite(Number(c.frac)) ? clamp(Number(c.frac), 0, 0.97) : null,
      op: c.op,
      target: needsTarget ? (chart === 'bars' ? Number(c.target) : String(c.target)) : undefined,
      to: c.op === 'arc' ? (chart === 'bars' ? Number(c.to) : String(c.to)) : undefined,
      tone: TONE_NAMES.includes(c.tone) ? c.tone : DEFAULT_TONE[c.op],
      text: isStr(c.text) ? words(c.text, 5).slice(0, 34) : '',
    });
    if (cues.length >= 12) break;
  }
  // cues with no timing are spread evenly after the previous one; the list is kept in time order
  let prev = -0.04;
  cues.forEach((c, i) => { if (c.frac == null) c.frac = clamp(Math.max(prev + 0.08, (i + 1) / (cues.length + 1)), 0, 0.97); c.frac = Math.max(c.frac, prev); prev = c.frac; });
  if (!cues.length) {   // nothing asked for: bars light the tallest, flow reveals the boxes one by one
    if (chart === 'bars') cues.push({ frac: 0.3, op: 'hi', target: o.values.indexOf(Math.max(...o.values)), tone: 'good', text: '' });
    else o.nodes.forEach((n, i) => cues.push({ frac: clamp(i / o.nodes.length * 0.7, 0, 0.9), op: 'show', target: n.id, tone: 'neutral', text: '' }));
  }
  o.cues = cues;
  return o;
}

// state of every cue at this moment: p = 0 before it starts, 1 when its animation is over
function progress(ctx, cues) {
  return cues.map((c) => {
    if (!ctx.video) return 1;
    const t0 = ctx.at(c.frac);
    return ease((ctx.t - t0) / (0.5 / ctx.speed));
  });
}

function explainer(ctx, sc) {
  const d = normalize(sc.data);
  if (!d) throw new Error('explainer data is not drawable');
  const u = ctx.u;
  const tone = TONES[d.look];
  const col = (name) => tone[name] || tone.neutral;
  const neon = d.look === 'neon';
  const W = ctx.long ? 1000 : 800, H = ctx.long ? 480 : 900;      // the portrait canvas is narrower, so everything is drawn larger
  const text = ctx.pal.text, muted = ctx.pal.muted;
  const P = progress(ctx, d.cues);
  const glow = (c) => (neon ? `filter:drop-shadow(0 0 7px ${alpha(c, 0.9)});` : '');
  const grid = neon
    ? Array.from({ length: 20 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${H}" stroke="${alpha('#a78bfa', 0.07)}"/>`).join('') + Array.from({ length: Math.ceil(H / 50) }, (_, i) => `<line x1="0" y1="${i * 50}" x2="${W}" y2="${i * 50}" stroke="${alpha('#a78bfa', 0.07)}"/>`).join('')
    : '';
  let body = '';

  // headline: the latest note, struck through once a strike cue after it has run
  const notes = d.cues.map((c, i) => ({ c, i })).filter((x) => x.c.op === 'note' && P[x.i] > 0);
  const last = notes[notes.length - 1];
  let noteSvg = '';
  if (last) {
    const fs = 60, w = last.c.text.length * fs * 0.56, a = P[last.i];
    const st = d.cues.map((c, i) => ({ c, i })).filter((x) => x.c.op === 'strike' && x.c.frac >= last.c.frac && P[x.i] > 0).pop();
    const nc = col(last.c.tone);
    noteSvg = `<text x="${W - 30}" y="${H > 600 ? 84 : 70}" text-anchor="end" font-size="${fs}" font-weight="800" fill="${nc}" opacity="${a}" style="${glow(nc)}">${esc(last.c.text)}</text>` +
      (st ? `<line x1="${W - 30 - w}" y1="${(H > 600 ? 84 : 70) - fs * 0.3}" x2="${W - 30 - w + w * P[st.i]}" y2="${(H > 600 ? 84 : 70) - fs * 0.3}" stroke="${col('bad')}" stroke-width="7" stroke-linecap="round"/>` : '');
  }

  if (d.chart === 'bars') {
    const n = d.values.length, max = Math.max(...d.values, 1);
    const x0 = 40, x1 = W - 40, slot = (x1 - x0) / n, bw = Math.min(110, slot * 0.58);
    const base = H - (d.labels.some(Boolean) ? 130 : 80), top = 150, span = base - top - 30;
    const cx = (i) => x0 + slot * (i + 0.5);
    const barTop = (i) => base - (d.values[i] / max) * span * (ctx.video ? ease((ctx.t - i * 0.07 / ctx.speed) / 0.8) : 1);
    // which bars stay bright after the latest dim cue
    const dimC = d.cues.map((c, i) => ({ c, i })).filter((x) => x.c.op === 'dim' && P[x.i] > 0).pop();
    const dimA = (i) => (dimC && i !== dimC.c.target ? 1 - 0.65 * P[dimC.i] : 1);
    const hiOf = (i) => d.cues.map((c, k) => ({ c, k })).filter((x) => x.c.op === 'hi' && x.c.target === i && P[x.k] > 0).pop();
    const bars = d.values.map((v, i) => {
      const y = barTop(i), h = base - y, hi = hiOf(i), c = hi ? col(hi.c.tone) : muted, a = hi ? P[hi.k] : 0;
      const fill = hi ? alpha(c, 0.18 * a) : alpha(muted, 0.08);
      const stroke = hi ? c : alpha(muted, 0.75);
      const lab = d.labels[i] ? `<text x="${cx(i)}" y="${base + 90}" text-anchor="middle" font-size="30" fill="${muted}" opacity="${dimA(i)}">${esc(d.labels[i])}</text>` : '';
      return `<g opacity="${dimA(i)}" style="${hi ? glow(c) : ''}"><rect x="${cx(i) - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, h)}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${hi ? 5 : 3}"/>` +
        `<text x="${cx(i)}" y="${y - 14}" text-anchor="middle" font-size="46" font-weight="700" fill="${hi ? c : text}">${Number.isInteger(v) ? v : Math.round(v * 100) / 100}</text></g>${lab}`;
    }).join('');
    const tags = d.cues.map((c, i) => (c.op === 'tag' && P[i] > 0
      ? `<text x="${cx(c.target)}" y="${base + 40}" text-anchor="middle" font-size="32" font-weight="700" fill="${col(c.tone)}" opacity="${P[i]}">${esc(c.text)}</text>` : '')).join('');
    const arcs = d.cues.map((c, i) => {
      if (c.op !== 'arc' || P[i] <= 0) return '';
      const ax = cx(c.target), bx = cx(c.to), ay = barTop(c.target) - 64, by = barTop(c.to) - 64;
      const ctrl = Math.max(110, Math.min(ay, by) - 110 - Math.abs(bx - ax) * 0.06);
      const apex = 0.25 * ay + 0.5 * ctrl + 0.25 * by;
      const ac = col(c.tone);
      const path = `M ${ax} ${ay} Q ${(ax + bx) / 2} ${ctrl} ${bx} ${by}`;
      return `<g style="${glow(ac)}"><path d="${path}" pathLength="1" fill="none" stroke="${ac}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="${1 - P[i]}"/>` +
        `<circle cx="${ax}" cy="${ay}" r="11" fill="${ac}"/>` + (P[i] > 0.92 ? `<circle cx="${bx}" cy="${by}" r="9" fill="${ac}"/>` : '') + '</g>' +
        (c.text ? `<text x="${(ax + bx) / 2}" y="${Math.max(48, apex - 16)}" text-anchor="middle" font-size="40" font-weight="700" fill="${ac}" opacity="${P[i]}">${esc(c.text)}</text>` : '');
    }).join('');
    body = `<line x1="${x0 - 10}" y1="${base}" x2="${x1 + 10}" y2="${base}" stroke="${alpha(muted, 0.6)}" stroke-width="3"/>` + bars + tags + arcs;
  } else {
    const n = d.nodes.length, pos = {};
    let nw, nh = 96;
    if (ctx.long) {      // wide picture: boxes in a row (two rows from five boxes)
      const cols = n <= 4 ? n : Math.ceil(n / 2), rows = n <= 4 ? 1 : 2;
      nw = Math.min(200, (W - 80) / cols - 70);
      d.nodes.forEach((nd, i) => {
        const r = Math.floor(i / cols), c = i % cols, inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
        const gap = (W - 2 * 40) / inRow;
        pos[nd.id] = { x: 40 + gap * (c + 0.5), y: rows === 1 ? H / 2 + 20 : 190 + r * 170 };
      });
    } else {             // tall picture: boxes stacked top to bottom with the arrows pointing down
      nw = 460; nh = 100;
      const step = Math.min(210, (H - 280) / Math.max(1, n - 1));
      d.nodes.forEach((nd, i) => { pos[nd.id] = { x: W / 2, y: 190 + i * step }; });
    }
    // when a box appears: its own show cue, otherwise at the start (or staggered when there are no show cues)
    const shows = d.cues.map((c, i) => ({ c, i })).filter((x) => x.c.op === 'show');
    const shown = {};
    d.nodes.forEach((nd) => { const s = shows.find((x) => x.c.target === nd.id); shown[nd.id] = s ? { p: P[s.i], t: s.c.frac } : { p: 1, t: 0 }; });
    const hiOf = (id) => d.cues.map((c, k) => ({ c, k })).filter((x) => x.c.op === 'hi' && x.c.target === id && P[x.k] > 0).pop();
    const edge = (a, b) => { // point on box a's border toward b
      const dx = b.x - a.x, dy = b.y - a.y, k = Math.min(dx ? (nw / 2 + 6) / Math.abs(dx) : 1e9, dy ? (nh / 2 + 6) / Math.abs(dy) : 1e9);
      return { x: a.x + dx * k, y: a.y + dy * k };
    };
    const links = d.links.map((l) => {
      const pa = pos[l.from], pb = pos[l.to], p = Math.min(shown[l.from].p, shown[l.to].p);
      if (p <= 0) return '';
      const s = edge(pa, pb), e = edge(pb, pa), lc = alpha(muted, 0.9);
      const ex = s.x + (e.x - s.x) * p, ey = s.y + (e.y - s.y) * p;
      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      const head = p > 0.98 ? `<polygon points="${e.x},${e.y} ${e.x - 18 * Math.cos(ang - 0.45)},${e.y - 18 * Math.sin(ang - 0.45)} ${e.x - 18 * Math.cos(ang + 0.45)},${e.y - 18 * Math.sin(ang + 0.45)}" fill="${lc}"/>` : '';
      return `<line x1="${s.x}" y1="${s.y}" x2="${ex}" y2="${ey}" stroke="${lc}" stroke-width="4" stroke-linecap="round"/>${head}` +
        (l.label && p > 0.9 ? `<text x="${(s.x + e.x) / 2}" y="${(s.y + e.y) / 2 - 14}" text-anchor="middle" font-size="26" fill="${muted}">${esc(l.label)}</text>` : '');
    }).join('');
    const boxes = d.nodes.map((nd) => {
      const p = shown[nd.id].p; if (p <= 0) return '';
      const q = pos[nd.id], hi = hiOf(nd.id), c = hi ? col(hi.c.tone) : muted;
      const fs = nd.label.length > 12 ? 28 : 34;
      return `<g opacity="${p}" transform="translate(${q.x} ${q.y + (1 - p) * 24})" style="${hi ? glow(c) : ''}"><rect x="${-nw / 2}" y="${-nh / 2}" width="${nw}" height="${nh}" rx="14" fill="${hi ? alpha(c, 0.2) : alpha(muted, 0.08)}" stroke="${hi ? c : alpha(muted, 0.8)}" stroke-width="${hi ? 5 : 3}"/>` +
        `<text x="0" y="${fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${hi ? c : text}">${esc(nd.label)}</text></g>`;
    }).join('');
    const tags = d.cues.map((c, i) => (c.op === 'tag' && P[i] > 0 && pos[c.target]
      ? `<text x="${pos[c.target].x}" y="${pos[c.target].y + nh / 2 + 42}" text-anchor="middle" font-size="30" font-weight="700" fill="${col(c.tone)}" opacity="${P[i]}">${esc(c.text)}</text>` : '')).join('');
    body = links + boxes + tags;
  }
  const title = d.title ? `<text x="30" y="${H > 600 ? 84 : 70}" font-size="34" font-weight="600" fill="${muted}" opacity="${ctx.a(0, 0.5)}">${esc(d.title)}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-height:${H * u * 1.2}px;font-family:${ctx.font}" xmlns="http://www.w3.org/2000/svg">${grid}${title}${noteSvg}${body}</svg>`;
}

module.exports = { explainer, normalize, OPS_BARS, OPS_FLOW, TONE_NAMES };
