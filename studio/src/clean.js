'use strict';
// Turns a pasted DOCUMENT (title options, outline table, timestamps, editor review,
// bracketed notes...) into a clean studio script that contains only what is spoken.
// Scripts that are already in studio format pass through, only lightly tidied.
// Returns { text, report } - report says exactly what was removed, for the pipeline report.

const DROP_H = /title options?|outline|description|thumbnail|editor review|summary|improve|stronger hook|facts? to verify|brand risks?|next step|resources|timestamps|hashtags?|keywords?|sources|checklist for editors|b-?roll|shot list/i;
const FULL_H = /^(full script|script|narration|voice ?over|spoken script|final script)\b/i;
const HOOK_H = /^hook\b/i;
// labels that mark production notes, never narration (Focus:, On-screen:, Visual:, ...)
const DROP_START = /^(focus|on[\u2010-\u2015\-\s]*screen(?:\s+text)?|visuals?|text overlay|overlay)\b/i;
const SPOKEN_LABEL = /\*{0,2}Spoken:?\*{0,2}/i;
const TS = /\(?\s*\d{1,2}:\d{2}(?:\s*[‐-―−\-]\s*\d{1,2}:\d{2})?\s*\)?/g;

const stripBold = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:!?])/g, '$1$2');

function tidy(s, stats) {
  let t = String(s);
  const before = t;
  t = t.replace(/\*?\[\s*(?:UNVERIFIED|VERIFY|CITATION NEEDED|SOURCE|TODO|NOTE)[^\]]*\]\*?/gi, () => {
    stats.notes++;
    return '';
  });
  t = t.replace(/\[link\]/gi, '');
  t = t.replace(/\u2011|\u2010/g, '-').replace(/~\s?/g, 'about ').replace(/\s*\u2192\s*/g, ', then ').replace(/\s&\s/g, ' and ').replace(/\s\+\s/g, ' plus ');
  t = t.replace(/\u20B9\s?(\d[\d,]*)\s?k\b/gi, (m, n) => '\u20B9' + (parseFloat(n.replace(/,/g, '')) * 1000).toLocaleString('en-IN')).replace(/\blac\b/gi, 'lakh');
  t = t.replace(/\*\s*$/g, '');
  t = t.replace(/\s+>\s+/g, ' above ').replace(/\s+<\s+/g, ' under ').replace(/\s*≤\s*/g, ' at most ').replace(/\s*≥\s*/g, ' at least ');
  t = stripBold(t).replace(/\*+/g, '');
  t = t.replace(/^[\u201C"\s]*\d+[.)]\s+/, "").replace(/^[-*\u2022]\s+/, "");
  t = t.replace(/^[“"‘'\s]+|[”"’'\s]+$/g, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t === before.trim() ? t : t;
}

function headingText(h, stats) {
  let t = String(h).replace(/^\[|\]$/g, '').replace(/\*\*/g, '').trim();
  const n = (t.match(TS) || []).length;
  if (n) stats.timestamps += n;
  t = t.replace(TS, '').replace(/[–—\-,:\s]+$/g, '').replace(/^[–—\-,:\s]+/g, '').replace(/\s{2,}/g, ' ');
  return t;
}

function splitSections(raw) {
  const secs = [];
  let cur = { h: '', lines: [] };
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^#{1,3}\s+(.*)$/);
    if (m && !/^#{3,}\s*caption/i.test(line)) {
      secs.push(cur);
      cur = { h: m[1].replace(/\*\*/g, '').trim(), lines: [] };
    } else cur.lines.push(line);
  }
  secs.push(cur);
  return secs;
}

function paragraphs(lines) {
  const out = [];
  let buf = [];
  for (const l of lines) {
    if (/^\s*\|/.test(l)) continue; // table rows
    if (/^\s*[-*_]{3,}\s*$/.test(l)) continue;
    if (!l.trim()) {
      if (buf.length) out.push(buf.join(' '));
      buf = [];
    } else {
      // every list item starts its own paragraph
      if (/^\s*[\u201C"]?\s*(?:\d+[.)]|[-*\u2022])\s+\S/.test(l) && buf.length) {
        out.push(buf.join(' '));
        buf = [];
      }
      buf.push(l.trim());
    }
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}

// Pulls only the "Spoken:" lines out of a section; "On-screen:" lines are dropped.
function spokenBits(lines, stats) {
  const body = lines.join('\n');
  const re = /(?:^|\n)[ \t]*(?:\d+[.)][ \t]*)?\*{0,2}Spoken:?\*{0,2}[ \t]*([\s\S]*?)(?=\n[ \t]*\n|\n[ \t]*(?:\d+[.)][ \t]*)?\*{0,2}(?:Spoken|On[\u2010-\u2015\-\s]*screen)|$)/gi;
  const out = [];
  let m;
  while ((m = re.exec(body))) {
    const t = tidy(m[1].replace(/\s*\n\s*/g, ' '), stats);
    if (t) out.push(t);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function cleanScript(raw) {
  const stats = { notes: 0, timestamps: 0, tables: 0, dropped: [] };
  const text = String(raw);
  const secs = splitSections(text);
  const heads = secs.map((s) => s.h);
  const hasSpoken = SPOKEN_LABEL.test(text);
  const hasScenes = /^##\s/m.test(text);
  const isDoc = hasSpoken || !hasScenes || heads.some((h) => DROP_H.test(h) || FULL_H.test(h) || DROP_START.test(h)) || /\|\s*-{3,}/.test(text);
  stats.tables = (text.match(/^\s*\|.*\|\s*$/gm) || []).length;

  if (!isDoc) {
    // already a studio script: only strip bracket notes and timestamps in headings
    const out = text
      .split(/\r?\n/)
      .map((l) => (/^#{2,3}\s/.test(l) ? l.replace(TS, () => { stats.timestamps++; return ''; }) : l))
      .map((l) => tidyLine(l, stats))
      .join('\n');
    return { text: out, report: { kind: 'studio-format', ...stats } };
  }

  let title = '';
  const scenes = [];
  const caption = [];
  for (const sec of secs) {
    const ci = sec.lines.findIndex((l) => /^#{3,}\s*caption/i.test(l));
    if (ci >= 0) {
      for (const l of sec.lines.slice(ci + 1)) if (l.trim() && !/^\s*\.\s*$/.test(l)) caption.push(l.trim());
      sec.lines = sec.lines.slice(0, ci);
    }
  }
  for (const sec of secs) {
    const h = sec.h;
    if (!h) {
      const m = sec.lines.join('\n').match(/^\s*#\s+(.+)$/m);
      continue;
    }
    if (/title options?/i.test(h)) {
      const m = sec.lines.join('\n').match(/^\s*1[.)]\s*(.+)$/m);
      if (m) title = tidy(m[1], stats);
      stats.dropped.push(h);
      continue;
    }
    if (HOOK_H.test(h)) {
      const body = sec.lines.join('\n');
      const sp = body.match(/\*{0,2}Spoken:?\*{0,2}\s*([\s\S]*?)(?=\n\s*\n|\*{0,2}On[‐-―\-\s]*screen|$)/i);
      const spoken = sp ? tidy(sp[1].replace(/\n/g, ' '), stats) : paragraphs(sec.lines).map((p) => tidy(p, stats)).filter(Boolean)[0];
      if (spoken) scenes.push({ h: 'Hook', paras: [spoken] });
      continue;
    }
    if (FULL_H.test(h)) {
      let cur = null;
      for (const p of paragraphs(sec.lines)) {
        const hm = p.match(/^\*{0,2}\[(.+?)\]\*{0,2}\s*(.*)$/);
        if (hm) {
          cur = { h: headingText(hm[1], stats), paras: [] };
          scenes.push(cur);
          const rest = tidy(hm[2], stats);
          if (rest) cur.paras.push(rest);
          continue;
        }
        const t = tidy(p, stats);
        if (!t) continue;
        if (!cur) {
          cur = { h: 'Intro', paras: [] };
          scenes.push(cur);
        }
        cur.paras.push(t);
      }
      continue;
    }
    if (DROP_H.test(h) || DROP_START.test(h)) {
      stats.dropped.push(h);
      continue;
    }
    const bits = spokenBits(sec.lines, stats);
    if (bits.length) {
      const base = headingText(h, stats).replace(/\s*\([^)]*\)\s*$/, '');
      if (bits.length === 1) scenes.push({ h: base, paras: bits });
      else bits.forEach((b, i) => scenes.push({ h: `${base.replace(/s$/i, '')} ${i + 1}`, paras: [b] }));
      continue;
    }
    // unknown section inside a document: keep as a scene
    const ps = paragraphs(sec.lines).map((p) => tidy(p, stats)).filter(Boolean);
    if (ps.length) scenes.push({ h: headingText(h, stats), paras: ps });
  }

  const outScenes = scenes.filter((s) => s.paras.length);
  if (!title && outScenes.length) {
    const first = outScenes[0].paras[0] || '';
    title = (first.match(/^.*?[.!?](?=\s|$)/) || [first])[0].replace(/[.!?]+$/, '').slice(0, 80);
  }
  const lines = [];
  if (title) lines.push('---', `title: ${title}`, '---', '');
  for (const s of outScenes) {
    lines.push(`## ${s.h || 'Scene'}`, ...s.paras.flatMap((p) => [p, '']));
  }
  if (caption.length) lines.push('### Caption', caption.join(' '), '');
  return { text: lines.join('\n').trim() + '\n', report: { kind: 'document', scenes: outScenes.length, ...stats } };
}

function tidyLine(l, stats) {
  return l.replace(/\*?\[\s*(?:UNVERIFIED|VERIFY|CITATION NEEDED|TODO)[^\]]*\]\*?/gi, () => {
    stats.notes++;
    return '';
  });
}

module.exports = { cleanScript };
