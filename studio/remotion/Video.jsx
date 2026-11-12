import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { renderScene, currentWordIndex } from '../src/scenes';

// One scene. All drawing is done by the shared scene library (same code as the carousel).
const Scene = ({ scene, plan, theme, brand, handle, total, w, h }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = scene.narration.split(/\s+/).filter(Boolean);
  const wordIdx = currentWordIndex(words, frame, scene.audioFrames, scene.wordFrames);
  const html = renderScene({
    mode: 'video', w, h, plan, scene, frame, fps,
    sceneFrames: scene.frames, audioFrames: scene.audioFrames,
    wordIdx, wordFrames: scene.wordFrames,
    font: theme.font, brand, handle, total, num: scene.index,
  });
  const fadeOut = interpolate(frame, [scene.frames - 5, scene.frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
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
            <Audio src={staticFile(s.audio)} />
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
