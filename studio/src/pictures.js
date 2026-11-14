'use strict';
// Pictures for the picture templates (photo background, profile card).
// Sources, in this order:
//   1. the script header  picture: dex3418, https://example.com/me.jpg, assets/pictures/team.jpg
//        - a GitHub username becomes that account's profile picture
//        - a link is downloaded when the video is built
//        - a path is a file in the studio repo
//   2. every image in  studio/assets/pictures/  (commit your own photos there)
// Each picture is shrunk to at most 1600 px wide and saved as public/pics/<slug>-N.jpg.
// A source that cannot be loaded is skipped and reported; it never stops the build.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX = 8;
const EXT = /\.(jpe?g|png|webp)$/i;
const USER = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

async function download(url, to) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get('content-type') || '';
    if (!/^image\//i.test(type)) throw new Error(`not an image (${type || 'unknown type'})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error('over 15 MB');
    fs.writeFileSync(to, buf);
  } finally {
    clearTimeout(timer);
  }
}

function shrink(inp, out) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inp, '-vf', "scale='min(1600,iw)':-2", '-frames:v', '1', '-q:v', '3', out], { stdio: 'pipe' });
}

function sources(meta, root) {
  const list = [];
  const given = String(meta.picture || '').split(/[,\s]+/).filter(Boolean);
  for (const g of given) {
    if (/^https?:\/\//i.test(g)) list.push({ label: g.length > 50 ? g.slice(0, 47) + '...' : g, url: g });
    else if (USER.test(g) && !EXT.test(g) && !g.includes('/')) list.push({ label: `GitHub @${g}`, url: `https://github.com/${g}.png?size=800` });
    else {
      const p = path.resolve(root, g);
      const alt = path.resolve(root, 'assets', 'pictures', g);
      const hit = [p, alt].find((x) => x.startsWith(root + path.sep) && fs.existsSync(x) && fs.statSync(x).isFile());
      list.push(hit ? { label: g, file: hit } : { label: g, missing: true });
    }
  }
  const dir = path.join(root, 'assets', 'pictures');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (EXT.test(f) && !list.some((l) => l.file && path.basename(l.file) === f)) list.push({ label: `assets/pictures/${f}`, file: path.join(dir, f) });
    }
  }
  return list.slice(0, MAX);
}

// returns { pics: [{ file: 'pics/<slug>-0.jpg', path }], notes: [text] , warn: bool }
async function preparePictures(parsed, root) {
  const list = sources(parsed.meta || {}, root);
  const out = { pics: [], notes: [], warn: false, wanted: list.length };
  if (!list.length) return out;
  const dir = path.join(root, 'public', 'pics');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith(parsed.slug + '-')) fs.unlinkSync(path.join(dir, f));
  const tmp = path.join(dir, `.${parsed.slug}-tmp`);
  for (const s of list) {
    try {
      if (s.missing) throw new Error('file not found');
      let inp = s.file;
      if (s.url) {
        await download(s.url, tmp);
        inp = tmp;
      }
      const name = `${parsed.slug}-${out.pics.length}.jpg`;
      shrink(inp, path.join(dir, name));
      out.pics.push({ file: `pics/${name}`, path: path.join(dir, name), label: s.label });
      out.notes.push(`picture ${out.pics.length - 1}: ${s.label}`);
    } catch (e) {
      out.warn = true;
      out.notes.push(`skipped ${s.label}: ${String(e.message).split('\n')[0]}`);
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch (e) {
    /* none */
  }
  return out;
}

const dataUri = (p) => `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;

module.exports = { preparePictures, dataUri };
