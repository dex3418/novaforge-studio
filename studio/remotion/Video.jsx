import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const CHUNK = 4; // words shown at once

// Which word is being spoken right now.
// Uses the real timing from the voice (wordFrames). Only if that is missing
// does it fall back to a guess based on word length.
function currentWordIndex(words, frame, audioFrames, wordFrames) {
  if (!words.length) return 0;
  if (wordFrames && wordFrames.length === words.length) {
    let idx = 0;
    for (let i = 0; i < wordFrames.length; i++) {
      if (wordFrames[i] <= frame) idx = i;
      else break;
    }
    return idx;
  }
  const weights = words.map((w) => w.length + 1 + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const p = Math.min(1, Math.max(0, frame / Math.max(1, audioFrames)));
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += weights[i] / sum;
    if (p <= acc) return i;
  }
  return words.length - 1;
}

const Scene = ({ scene, theme, vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = scene.narration.split(/\s+/).filter(Boolean);
  const idx = currentWordIndex(words, frame, scene.audioFrames, scene.wordFrames);
  const start = Math.floor(idx / CHUNK) * CHUNK;
  const chunk = words.slice(start, start + CHUNK);

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [scene.frames - 6, scene.frames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = interpolate(frame, [0, scene.frames], [1, 1.08]);

  const pad = vertical ? 80 : 120;
  const headSize = vertical ? 76 : 70;
  const capSize = vertical ? 92 : 84;
  const showHeading = scene.heading && scene.heading !== scene.narration;

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AbsoluteFill
        style={{
          transform: `scale(${zoom})`,
          background: `radial-gradient(circle at 80% 10%, ${theme.accent}33 0%, transparent 55%)`,
        }}
      />
      <AbsoluteFill
        style={{
          padding: pad,
          justifyContent: 'space-between',
          color: theme.text,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.muted, fontSize: 32 }}>
          <span style={{ color: theme.accent, fontWeight: 700 }}>{scene.brand}</span>
          <span>{scene.handle}</span>
        </div>

        <div
          style={{
            transform: `translateY(${(1 - enter) * 40}px)`,
            opacity: enter,
          }}
        >
          {showHeading ? (
            <div
              style={{
                fontSize: headSize,
                fontWeight: 800,
                lineHeight: 1.15,
                marginBottom: 56,
              }}
            >
              {scene.heading}
            </div>
          ) : null}
          <div
            style={{
              fontSize: capSize,
              fontWeight: 800,
              lineHeight: 1.2,
              minHeight: capSize * 1.2 * 2,
            }}
          >
            {chunk.map((w, i) => (
              <span
                key={start + i}
                style={{
                  color: start + i === idx ? theme.accent : theme.text,
                  marginRight: 22,
                  display: 'inline-block',
                }}
              >
                {w}
              </span>
            ))}
          </div>
        </div>

        <div style={{ height: 8 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Video = ({ scenes, theme, brand, handle, vertical, musicFile }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  let from = 0;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${theme.bg} 0%, ${theme.bg2} 100%)`,
        fontFamily: theme.font,
      }}
    >
      {musicFile ? <Audio src={staticFile(musicFile)} volume={0.08} loop /> : null}

      {scenes.map((s) => {
        const seq = (
          <Sequence key={s.index} from={from} durationInFrames={s.frames}>
            <Audio src={staticFile(s.audio)} />
            <Scene scene={{ ...s, brand, handle }} theme={theme} vertical={vertical} />
          </Sequence>
        );
        from += s.frames;
        return seq;
      })}

      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 10,
          width: `${(frame / Math.max(1, durationInFrames)) * 100}%`,
          background: theme.accent,
        }}
      />
    </AbsoluteFill>
  );
};
