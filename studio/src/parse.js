'use strict';
// Parses a markdown script into { slug, title, meta, scenes[] }.
//
// Format:
//   ---
//   title: ...            (optional, else first "# " line)
//   voice: en-IN-NeerjaNeural
//   rate: +0%
//   brand: Novaforge Labs
//   handle: @yourhandle
//   cta: Follow for more
//   ---
//   # Title (optional)
//   ## Scene heading      <- each "## " starts a scene / carousel slide
//   Body text that is spoken in the video and shown on the slide.
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
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim();
}

function parseScript(file) {
  const src = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(src);
  let title = meta.title || '';
  const scenes = [];
  let cur = null;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = line.match(/^#\s+(.+)/);
    if (h2) {
      cur = { heading: clean(h2[1]), paras: [] };
      scenes.push(cur);
    } else if (h1) {
      if (!title) title = clean(h1[1]);
    } else if (cur && line.trim()) {
      cur.paras.push(clean(line));
    }
  }

  if (!scenes.length) throw new Error(`${file}: no "## " scenes found`);

  const out = scenes.map((s, i) => {
    const bodyText = s.paras.join('\n\n');
    return {
      index: i + 1,
      heading: s.heading,
      body: bodyText,
      narration: bodyText ? s.paras.join(' ') : s.heading,
    };
  });

  const slug = path
    .basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'script';

  return {
    slug,
    title: title || out[0].heading,
    meta: {
      voice: meta.voice || 'en-IN-NeerjaNeural',
      rate: meta.rate || '+0%',
      brand: meta.brand || '',
      handle: meta.handle || '',
      cta: meta.cta || '',
    },
    scenes: out,
  };
}

module.exports = { parseScript };
