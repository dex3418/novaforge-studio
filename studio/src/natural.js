'use strict';
// Makes the Edge voice sound less like a machine reading a list.
// A flat voice is one rate, one pitch and no pauses. A person changes all three:
//   - a question lifts at the end, a statement settles
//   - short punchy sentences are said with weight, numbers are said slowly
//   - long sentences are broken into breaths at commas
//   - there is a small pause between sentences
// This file only decides those numbers (pure, no network) so it can be tested.

// Split at whitespace after . ! ? or the Hindi danda; never inside 3.5 or after Dr. / Rs. / No.
function sentences(text) {
  const parts = String(text).trim().split(/(?<=[.!?\u0964])\s+/);
  const out = [];
  for (const s of parts) {
    if (out.length && /(?:^|\s)(?:Dr|Mr|Mrs|Ms|St|No|Rs|vs|Sr|Jr|Prof)\.$/i.test(out[out.length - 1])) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

const EMO = {
  excited: { pitch: 2, rate: 3, vol: 4, pause: -30 },
  serious: { pitch: -3, rate: -3, vol: 0, pause: 60 },
  curious: { pitch: 2, rate: 0, vol: 0, pause: 0 },
  calm: { pitch: -1, rate: -4, vol: -2, pause: 40 },
  neutral: { pitch: 0, rate: 0, vol: 0, pause: 0 },
};

const words = (t) => String(t).split(/\s+/).filter(Boolean).length;
const hasNumber = (t) => /\d/.test(t);

// split one long sentence at a comma near the middle so it can breathe
function clauses(sentence) {
  if (words(sentence) <= 18) return [sentence];
  const parts = sentence.split(/(?<=[,;:—])\s+/);
  if (parts.length < 2) return [sentence];
  let best = 1;
  let diff = 1e9;
  for (let i = 1; i < parts.length; i++) {
    const a = words(parts.slice(0, i).join(' '));
    const b = words(parts.slice(i).join(' '));
    if (a >= 4 && b >= 4 && Math.abs(a - b) < diff) {
      diff = Math.abs(a - b);
      best = i;
    }
  }
  if (diff === 1e9) return [sentence];
  return [parts.slice(0, best).join(' '), parts.slice(best).join(' ')];
}

const sign = (n, unit) => `${n >= 0 ? '+' : '-'}${Math.abs(Math.round(n))}${unit}`;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// text: the scene's narration. baseRate: number (percent). emotion: one of EMO keys.
// Returns [{ text, rate, pitch, volume, pause }] (pause = milliseconds of silence after).
function plan(text, baseRate = 0, emotion = 'neutral') {
  const e = EMO[emotion] || EMO.neutral;
  const sents = sentences(text);
  const out = [];
  sents.forEach((s, si) => {
    const first = si === 0;
    const last = si === sents.length - 1;
    const cl = clauses(s);
    cl.forEach((c, ci) => {
      const endOfSentence = ci === cl.length - 1;
      const w = words(c);
      let rate = baseRate + e.rate;
      let pitch = e.pitch;
      let vol = e.vol;
      // tiny deterministic wobble so no two sentences are said identically
      pitch += ((si * 7 + ci * 3) % 5) - 2;
      rate += ((si * 5 + ci) % 3) - 1;
      if (/\?\s*$/.test(c)) {
        pitch += 7;
        rate -= 3;
      } else if (/!\s*$/.test(c)) {
        pitch += 4;
        rate += 3;
        vol += 5;
      }
      if (hasNumber(c)) rate -= 5; // numbers slowly, so they are heard
      if (w <= 4) {
        pitch += 3;
        rate -= 4; // short punchy line: said with weight
      }
      if (first && ci === 0) {
        rate -= 2;
        pitch += 2;
      }
      if (last && endOfSentence) {
        rate -= 6;
        pitch -= 4; // land the scene
      } else if (!endOfSentence) {
        pitch += 2; // mid-sentence breath keeps the line open
      }
      let pause = 0;
      if (!last || !endOfSentence) {
        if (!endOfSentence) pause = 150;
        else if (/\?\s*$/.test(c)) pause = 320;
        else if (/!\s*$/.test(c)) pause = 260;
        else pause = 280;
        pause = Math.max(80, pause + e.pause);
      }
      out.push({
        text: c,
        rate: sign(clamp(rate, -40, 40), '%'),
        pitch: sign(clamp(pitch, -20, 20), 'Hz'),
        volume: sign(clamp(vol, -20, 20), '%'),
        pause,
      });
    });
  });
  return out;
}

const { POLISH } = require('./natural_polish');

module.exports = { sentences, plan, clauses, POLISH, EMO };
