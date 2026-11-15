'use strict';
// ffmpeg filter that gives a voice a little warmth and an even level (shared by Edge and Gemini voices)
module.exports = { POLISH: 'highpass=f=70,acompressor=threshold=0.125:ratio=2.5:attack=8:release=120:makeup=1.5,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=3200:t=q:w=1.2:g=1.5,loudnorm=I=-16:TP=-1.5:LRA=9' };
