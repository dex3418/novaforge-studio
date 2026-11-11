'use strict';
// Voiceover per scene (Edge TTS) -> Remotion render for Reel (9:16) and Long (16:9).

const fs = require('fs');
const path = require('path');
const { synth, durationSeconds } = require('./tts');

const FPS = 30;
const PAD_SECONDS = 0.35; // breathing room after each scene

let bundled = null;

async function getBundle(root) {
  if (bundled) return bundled;
  const { bundle } = require('@remotion/bundler');
  bundled = await bundle({
    entryPoint: path.join(root, 'remotion', 'index.jsx'),
    publicDir: path.join(root, 'public'),
  });
  return bundled;
}

function makeAudio(parsed, root) {
  const dir = path.join(root, 'public', parsed.slug);
  fs.mkdirSync(dir, { recursive: true });
  return parsed.scenes.map((s) => {
    const file = path.join(dir, `scene-${s.index}.mp3`);
    console.log(`  voice scene ${s.index}/${parsed.scenes.length}`);
    synth(s.narration, file, parsed.meta.voice, parsed.meta.rate);
    const dur = durationSeconds(file);
    return {
      index: s.index,
      heading: s.heading,
      narration: s.narration,
      audio: `${parsed.slug}/scene-${s.index}.mp3`,
      audioFrames: Math.ceil(dur * FPS),
      frames: Math.ceil((dur + PAD_SECONDS) * FPS),
      seconds: dur,
    };
  });
}

async function renderOne(compId, parsed, theme, scenes, root, outFile, musicFile) {
  const { renderMedia, selectComposition } = require('@remotion/renderer');
  const serveUrl = await getBundle(root);
  const inputProps = {
    title: parsed.title,
    brand: parsed.meta.brand || theme.brand || '',
    theme,
    scenes,
    totalFrames: scenes.reduce((a, s) => a + s.frames, 0),
    musicFile: musicFile || null,
  };
  const composition = await selectComposition({ serveUrl, id: compId, inputProps });
  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outFile,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`  ${compId} ${pct}%\n`);
      }
    },
  });
  console.log(`  ${compId} -> ${outFile}`);
}

async function makeVideos(parsed, theme, outDir, root, which) {
  fs.mkdirSync(outDir, { recursive: true });
  const scenes = makeAudio(parsed, root);
  const total = scenes.reduce((a, s) => a + s.seconds + PAD_SECONDS, 0);
  console.log(`  total narration ~${total.toFixed(1)}s`);
  if (which.includes('reel') && total > 90) {
    console.warn('  WARNING: Reel is longer than 90s, Instagram may trim or reject it.');
  }

  let musicFile = null;
  const music = path.join(root, 'assets', 'music.mp3');
  if (fs.existsSync(music)) {
    fs.copyFileSync(music, path.join(root, 'public', 'music.mp3'));
    musicFile = 'music.mp3';
  }

  if (which.includes('reel'))
    await renderOne('Reel', parsed, theme, scenes, root, path.join(outDir, `${parsed.slug}-reel.mp4`), musicFile);
  if (which.includes('long'))
    await renderOne('Long', parsed, theme, scenes, root, path.join(outDir, `${parsed.slug}-youtube.mp4`), musicFile);
}

module.exports = { makeVideos };
