import React from 'react';
import { Composition } from 'remotion';
import { Video } from './Video';

const defaults = {
  title: 'Preview',
  brand: 'Novaforge Labs',
  theme: {
    bg: '#0b1020',
    bg2: '#1a2350',
    accent: '#ffb020',
    text: '#ffffff',
    muted: '#9aa4bf',
    font: 'sans-serif',
  },
  scenes: [],
  totalFrames: 90,
  musicFile: null,
};

const meta = ({ props }) => ({ durationInFrames: Math.max(1, props.totalFrames) });

export const Root = () => (
  <>
    <Composition
      id="Reel"
      component={Video}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={90}
      defaultProps={{ ...defaults, vertical: true }}
      calculateMetadata={meta}
    />
    <Composition
      id="Long"
      component={Video}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={90}
      defaultProps={{ ...defaults, vertical: false }}
      calculateMetadata={meta}
    />
  </>
);
