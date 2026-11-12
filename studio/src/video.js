'use strict';
// Voiceover per scene -> Remotion render for Reel (9:16) and Long (16:9).
// Scene length = real length of the voice clip; every caption word gets the
// moment it is actually spoken, so voice and picture stay in step.

const fs = require('fs');
const path = require('path');
const { synth, durationSeconds } = require('./tts');
const { wordStartTimes } = require('./align');

const FPS = 30;
const PAD_SECONDS = 0.35;

let bundled = null;
async function getBundle(root) {
  if (bundled) return bundled;
  const { bundle } = require('@remotion/bundler');
  bundled = await bundle({ entryPoint: path.join(root, 'remotion', 'index.jsx'), publicDir: path.join(root, 'public') });
  return bundled;
}

const pct = (r) => (/^[+-]?\d+%$/.test(String(r || '')) ? parseInt(r, 10) : 0);
const fmtRate = (n) => `${n >= 0 ? '+' : ''}${Math.max(-35, Math.min(35, Math.round(n)))}%`;

async function makeAudio(parsed, plan, root) {
  const dir = path.join(root, 'public', parsed.slug);
  fs.mkdirSync(dir, { recursive: true });
  const byIndex = new Map(plan.scenes.map((s) => [s.index, s]));
  const engine = parsed.meta.engine === 'gemini' ? 'gemini' : 'edge';
  const out = [];
  for (const s of parsed.scenes) {
    const p = byIndex.get(s.index) || { kind: 'caption', data: {}, emotion: 'neutral', emphasis: [], voice: { rateDelta: 0, style: '' } };
    const file = path.join(dir, `scene-${s.index}.mp3`);
    console.log(`  voice scene ${s.index}/${parsed.scenes.length} (${p.kind}, ${p.emotion})`);
    const rate = fmtRate(pct(parsed.meta.rate) + ((p.voice && p.voice.rateDelta) || 0));
    const r = await synth(s.narration, file, {
      engine,
      voice: parsed.meta.voice,
      rate,
      style: parsed.meta.style || p.emotion || '',
    });
    const dur = durationSeconds(file);
    const words = s.narration.split(/\s+/).filter(Boolean);
    const starts = wordStartTimes(words, r.timing);
    const wordFrames = starts ? starts.map((t) => Math.floor(Math.min(t, dur) * FPS)) : null;
    console.log(`    ${r.engine}/${r.voice} ${rate} ${dur.toFixed(1)}s, caption timing: ${r.timing ? r.timing.kind : 'estimated'}`);
    out.push({
      index: s.index,
      heading: s.heading,
      body: s.body,
      narration: s.narration,
      kind: p.kind,
      data: p.data,
      emotion: p.emotion,
      emphasis: p.emphasis,
      beats: p.beats || null,
      transition: p.transition, scheme: p.scheme, decor: p.decor, cstyle: p.cstyle, align: p.align, icon: p.icon, palette: p.palette, texture: p.texture,
      voiceInfo: { engine: r.engine, voice: r.voice, rate, timing: r.timing ? r.timing.kind : 'estimated', note: r.note || '' },
      audio: `${parsed.slug}/scene-${s.index}.mp3`,
      audioFrames: Math.ceil(dur * FPS),
      frames: Math.ceil((dur + PAD_SECONDS) * FPS),
      seconds: dur,
      wordFrames,
    });
  }
  // silent closing card with brand, call to action and handle
  const brand = parsed.meta.brand || '';
  if (brand || parsed.meta.handle) {
    const lastKind = out[out.length - 1] && out[out.length - 1].kind;
    out.push({
      index: 99, heading: '', body: '', narration: '', kind: 'endcard',
      data: { brand: brand || parsed.meta.handle, handle: brand ? parsed.meta.handle || '' : '', cta: lastKind === 'cta' ? '' : parsed.meta.cta || '' },
      emotion: 'excited', emphasis: [], beats: null, audio: null, audioFrames: 0, frames: 75, seconds: 2.5, wordFrames: null,
      transition: 'bounce', scheme: 'pop', decor: 'sparks', cstyle: 'chunk', align: 'center',
      palette: plan.scenes[plan.scenes.length - 1].palette, texture: plan.scenes[plan.scenes.length - 1].texture, end: true,
    });
  }
  return out;
}

// how long each beat is on screen (seconds), for the pacing report
function beatSeconds(scenes) {
  const out = [];
  for (const s of scenes) {
    if (s.end) continue;
    const ws = s.narration.split(/\s+/).filter(Boolean);
    if (!s.beats || s.beats.length < 2) { out.push(s.seconds); continue; }
    const startOf = (w) => (s.wordFrames && s.wordFrames.length === ws.length ? s.wordFrames[Math.min(w, ws.length - 1)] / FPS : (w / Math.max(1, ws.length)) * s.seconds);
    s.beats.forEach((b, i) => out.push((i + 1 < s.beats.length ? startOf(s.beats[i + 1].from) : s.seconds) - (i === 0 ? 0 : startOf(b.from))));
  }
  return out;
}

async function renderOne(compId, parsed, theme, plan, scenes, root, outFile, musicFile) {
  const { renderMedia, selectComposition } = require('@remotion/renderer');
  const serveUrl = await getBundle(root);
  const inputProps = {
    title: parsed.title,
    brand: parsed.meta.brand || theme.brand || '',
    handle: parsed.meta.handle || '',
    theme,
    plan,
    scenes,
    totalFrames: scenes.reduce((a, s) => a + s.frames, 0),
    musicFile: musicFile || null,
  };
  const composition = await selectComposition({ serveUrl, id: compId, inputProps });
  let last = -1;
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: outFile, inputProps,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10) * 10;
      if (p !== last) { last = p; process.stdout.write(`  ${compId} ${p}%\n`); }
    },
  });
  console.log(`  ${compId} -> ${outFile}`);
}

// step 1: makeVideos() makes the voices and returns { scenes, total, run }; step 2: run() renders
async function makeVideos(parsed, theme, plan, outDir, root, which) {
  fs.mkdirSync(outDir, { recursive: true });
  const scenes = await makeAudio(parsed, plan, root);
  const total = scenes.reduce((a, s) => a + (s.end ? 0 : s.seconds + PAD_SECONDS), 0);
  console.log(`  total narration ~${total.toFixed(1)}s`);
  if (which.includes('reel') && total > 90) console.warn('  WARNING: Reel is longer than 90s, Instagram may trim or reject it.');

  let musicFile = null;
  const music = path.join(root, 'assets', 'music.mp3');
  if (fs.existsSync(music)) {
    fs.copyFileSync(music, path.join(root, 'public', 'music.mp3'));
    musicFile = 'music.mp3';
  }
  const files = [];
  const timeIt = async (id, file) => {
    const t = Date.now();
    await renderOne(id, parsed, theme, plan, scenes, root, file, musicFile);
    files.push({ id, file, seconds: (Date.now() - t) / 1000, mb: fs.statSync(file).size / 1048576 });
  };
  return { scenes, total, run: async () => {
    if (which.includes('reel')) await timeIt('Reel', path.join(outDir, `${parsed.slug}-reel.mp4`));
    if (which.includes('long')) await timeIt('Long', path.join(outDir, `${parsed.slug}-youtube.mp4`));
    return files;
  } };
}

module.exports = { makeVideos, makeAudio, beatSeconds };
