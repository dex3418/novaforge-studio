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
      audio: `${parsed.slug}/scene-${s.index}.mp3`,
      audioFrames: Math.ceil(dur * FPS),
      frames: Math.ceil((dur + PAD_SECONDS) * FPS),
      seconds: dur,
      wordFrames,
    });
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

async function makeVideos(parsed, theme, plan, outDir, root, which) {
  fs.mkdirSync(outDir, { recursive: true });
  const scenes = await makeAudio(parsed, plan, root);
  const total = scenes.reduce((a, s) => a + s.seconds + PAD_SECONDS, 0);
  console.log(`  total narration ~${total.toFixed(1)}s`);
  if (which.includes('reel') && total > 90) console.warn('  WARNING: Reel is longer than 90s, Instagram may trim or reject it.');

  let musicFile = null;
  const music = path.join(root, 'assets', 'music.mp3');
  if (fs.existsSync(music)) {
    fs.copyFileSync(music, path.join(root, 'public', 'music.mp3'));
    musicFile = 'music.mp3';
  }
  if (which.includes('reel')) await renderOne('Reel', parsed, theme, plan, scenes, root, path.join(outDir, `${parsed.slug}-reel.mp4`), musicFile);
  if (which.includes('long')) await renderOne('Long', parsed, theme, plan, scenes, root, path.join(outDir, `${parsed.slug}-youtube.mp4`), musicFile);
}

module.exports = { makeVideos, makeAudio };
