import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { renderScene, currentWordIndex } from '../src/scenes';

// Cuts a scene into its beats (each with its own visual) using the real speech timing.
function beatFrames(scene) {
  const words = scene.narration.split(/\s+/).filter(Boolean);
  const n = words.length;
  const wf = scene.wordFrames && scene.wordFrames.length === n ? scene.wordFrames : null;
  const total = words.join(' ').length || 1;
  const startOf = (w) => {
    if (wf) return wf[Math.min(w, n - 1)];
    return Math.floor((words.slice(0, w).join(' ').length / total) * scene.audioFrames);
  };
  const bs = scene.beats;
  return bs.map((b, i) => {
    const start = i === 0 ? 0 : startOf(b.from);
    const next = i + 1 < bs.length ? startOf(bs[i + 1].from) : scene.frames;
    const speechEnd = i + 1 < bs.length ? next : scene.audioFrames;
    return {
      beat: b, start, end: Math.max(start + 1, next),
      words: words.slice(b.from, b.to),
      wf: wf ? wf.slice(b.from, b.to).map((x) => Math.max(0, x - start)) : null,
      audio: Math.max(1, speechEnd - start),
    };
  });
}

// One scene. All drawing is done by the shared scene library (same code as the carousel).
const Scene = ({ scene, plan, theme, brand, handle, total, w, h }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let sc = scene;
  let local = frame;
  let sceneFrames = scene.frames;
  let audioFrames = scene.audioFrames;
  let wordFrames = scene.wordFrames;
  let words = scene.narration.split(/\s+/).filter(Boolean);

  if (scene.beats && scene.beats.length > 1) {
    const parts = beatFrames(scene);
    let k = 0;
    parts.forEach((p, i) => { if (p.start <= frame) k = i; });
    const p = parts[k];
    sc = {
      ...scene,
      kind: p.beat.kind,
      data: p.beat.data,
      emotion: p.beat.emotion || scene.emotion,
      emphasis: p.beat.emphasis && p.beat.emphasis.length ? p.beat.emphasis : scene.emphasis,
      narration: p.words.join(' '),
      heading: k === 0 ? scene.heading : '',
      transition: p.beat.transition || scene.transition,
      scheme: p.beat.scheme || scene.scheme,
      decor: p.beat.decor || scene.decor,
      cstyle: p.beat.cstyle || scene.cstyle,
      align: p.beat.align || scene.align,
      icon: p.beat.icon || (k === 0 ? scene.icon : undefined),
    };
    local = frame - p.start;
    sceneFrames = p.end - p.start;
    audioFrames = p.audio;
    wordFrames = p.wf;
    words = p.words;
  }
  const wordIdx = currentWordIndex(words, local, audioFrames, wordFrames);
  const html = renderScene({
    mode: 'video', w, h, plan, scene: sc, frame: local, fps,
    sceneFrames, audioFrames, wordIdx, wordFrames,
    font: theme.font, brand, handle, total, num: scene.index,
  });
  const fadeOut = scene.end ? 1 : interpolate(frame, [scene.frames - 5, scene.frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: fadeOut }} dangerouslySetInnerHTML={{ __html: html }} />;
};

export const Video = ({ scenes, plan, theme, brand, handle, musicFile }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  let from = 0;
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font }}>
      {musicFile ? <Audio src={staticFile(musicFile)} volume={0.08} loop /> : null}
      {scenes.map((s) => {
        const seq = (
          <Sequence key={s.index} from={from} durationInFrames={s.frames}>
            {s.audio ? <Audio src={staticFile(s.audio)} /> : null}
            <Scene scene={s} plan={plan} theme={theme} brand={brand} handle={handle} total={scenes.length} w={width} h={height} />
          </Sequence>
        );
        from += s.frames;
        return seq;
      })}
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 10, width: `${(frame / Math.max(1, durationInFrames)) * 100}%`, background: (plan && plan.accent) || theme.accent }} />
    </AbsoluteFill>
  );
};
