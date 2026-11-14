'use strict';
// Parses a markdown script into { slug, title, meta, scenes[] }.
//
// Native format:
//   ---
//   title: ...            (optional, else first "# " line)
//   voice: en-IN-NeerjaNeural
//   brand: Novaforge Labs
//   handle: @yourhandle
//   cta: Follow for more
//   caption: #tags and text for the post   (optional)
//   ---
//   ## Scene heading      <- each "## " starts a scene / carousel slide
//   Body text that is spoken in the video and shown on the slide.
//
// Also accepted (ChatGPT-style):
//   ## Slide 2
//   **Form & print** - Download the application...      -> heading "Form & print", body after the dash
//   ### Caption
//   #tag1 #tag2                                          -> saved as caption
//
// If a scene has no body text, its heading is spoken instead.

const fs = require('fs');
const path = require('path');

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function clean(s) {
  return String(s)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim();
}

// Text for the voice: make symbols, currency and links pronounceable.
// (Slides keep the original text; only the narration is changed.)
const UNIT_WORD = { lakh: 'lakh', lakhs: 'lakh', lac: 'lakh', lacs: 'lakh', crore: 'crore', crores: 'crore', cr: 'crore', thousand: 'thousand', million: 'million', billion: 'billion', k: 'thousand' };

function speakable(t) {
  const NUM = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const UNIT = '(?:\\s?(lakhs?|lacs?|crores?|cr|thousand|million|billion|k)\\b)?';
  const SYMB = '(?:\u20B9|\\bRs\\.?)\\s?';
  const unit = (u) => (u ? ' ' + UNIT_WORD[u.toLowerCase()] : '');
  return String(t)
    .replace(/https?:\/\/(?:www\.)?([^\s/)]+)[^\s)]*/gi, (_, host) => host.replace(/\./g, ' dot '))
    .replace(new RegExp(SYMB + NUM + UNIT + '\\s*[\u2011\u2010\u2013\u2014-]\\s*(?:\u20B9|Rs\\.?)?\\s?' + NUM + UNIT, 'gi'), (m, a, u1, b, u2) => `${a}${unit(u1 || u2) && !u1 ? '' : unit(u1)} to ${b}${unit(u2)} rupees`)
    .replace(new RegExp(SYMB + NUM + UNIT, 'gi'), (m, n, u) => `${n}${unit(u)} rupees`)
    .replace(/\u2248/g, ' about ')
    .replace(/\s?\u00D7\s?/g, ' by ')
    .replace(/\u2011|\u2010/g, '-')
    .replace(/\(\s+/g, '(')
    .replace(/\s+/g, ' ')
    .trim();
}

const SLIDE_RE = /^(?:slide|scene|part)\s*\d+\s*[:.\-\u2013\u2014]?\s*(.*)$/i;

function normalizeSlide(s) {
  const m = s.heading.match(SLIDE_RE);
  if (!m) return;
  const rest = clean(m[1] || '');
  if (rest) {
    s.heading = rest;
    return;
  }
  const first = s.paras[0] || '';
  const b = first.match(/^\*\*(.+?)\*\*\s*(?:[\u2013\u2014:\-]\s*)?(.*)$/);
  if (b) {
    s.heading = clean(b[1]).replace(/[:.\s]+$/, '');
    s.paras[0] = b[2];
    if (!b[2]) s.paras.shift();
  } else if (first) {
    const sm = first.match(/^(.{1,80}?[.!?])\s+(.*)$/);
    if (sm) {
      s.heading = clean(sm[1]);
      s.paras[0] = sm[2];
    } else {
      s.heading = clean(first);
      s.paras.shift();
    }
  }
}

function parseText(src, slug) {
  const { meta, body } = parseFrontmatter(src);
  let title = meta.title || '';
  const scenes = [];
  const caption = [];
  let cur = null;
  let capMode = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue; // horizontal rules
    const h3 = line.match(/^#{3,}\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = line.match(/^#\s+(.+)/);
    if (h3) {
      cur = null;
      capMode = /caption/i.test(h3[1]);
    } else if (h2) {
      capMode = false;
      cur = { heading: clean(h2[1]), paras: [] };
      scenes.push(cur);
    } else if (h1) {
      if (!title) title = clean(h1[1]);
    } else if (capMode && line.trim()) {
      caption.push(line.trim());
    } else if (cur && line.trim()) {
      cur.paras.push(line.trim().replace(/^[>\-*\u2022]\s+/, ''));
    }
  }

  if (!scenes.length) throw new Error('no "## " scenes found');

  scenes.forEach(normalizeSlide);
  scenes.forEach((s) => {
    s.paras = s.paras.map(clean).filter(Boolean);
  });

  let titleFromScene = false;
  if (!title) {
    title = scenes[0].heading;
    titleFromScene = true;
  }

  const out = scenes.map((s, i) => {
    const bodyText = s.paras.join('\n\n');
    const isTitle = titleFromScene && i === 0;
    let narration;
    if (isTitle && bodyText) {
      narration = (/[.!?]$/.test(s.heading) ? s.heading : s.heading + '.') + ' ' + s.paras.join(' ');
    } else {
      narration = bodyText ? s.paras.join(' ') : s.heading;
    }
    return {
      index: i + 1,
      heading: s.heading,
      body: bodyText,
      narration: speakable(narration),
      isTitle,
    };
  });

  return {
    slug,
    title,
    meta: {
      voice: meta.voice || '',
      rate: meta.rate || '+12%',
      brand: meta.brand || '',
      handle: meta.handle || '',
      cta: meta.cta || '',
      caption: meta.caption || caption.join(' '),
      engine: (meta.engine || 'edge').toLowerCase(),
      style: meta.style || '',
      template: (meta.template || '').toLowerCase(),
      palette: (meta.palette || '').toLowerCase(),
      texture: (meta.texture || '').toLowerCase(),
      director: (meta.director || '').toLowerCase(),
      captions: (meta.captions || '').toLowerCase(),
      seed: (meta.seed || '').toString().trim(),
    },
    scenes: out,
  };
}

function parseScript(file) {
  const slug =
    path
      .basename(file, path.extname(file))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'script';
  try {
    return parseText(fs.readFileSync(file, 'utf8'), slug);
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

module.exports = { parseScript, parseText, speakable };
