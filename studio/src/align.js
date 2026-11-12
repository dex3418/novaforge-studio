'use strict';
// Turns the voice's timing marks (words or whole sentences) into a start time
// for every caption word, so the highlight follows the real speech.
//
// The marks and the caption words describe the same text, so we line them up
// on a "characters spoken so far" axis. That works even when the voice service
// splits or joins words differently (e.g. "1,000" or "step-by-step"), and for
// sentence-level marks it spreads the words across each sentence.

const len = (s) => String(s).replace(/\s+/g, '').length;

function wordStartTimes(words, timing) {
  if (!timing || !Array.isArray(timing.marks) || !timing.marks.length || !words.length) return null;
  const marks = timing.marks;

  if (timing.kind === 'word' && marks.length === words.length) {
    return marks.map((m) => m.start);
  }

  const mlen = marks.map((m) => Math.max(1, len(m.text)));
  const cum = [];
  let total = 0;
  for (const l of mlen) {
    cum.push(total);
    total += l;
  }
  const wlen = words.map((w) => Math.max(1, len(w)));
  const wtotal = wlen.reduce((a, b) => a + b, 0);

  const out = [];
  let pos = 0;
  for (let i = 0; i < words.length; i++) {
    const P = (pos / wtotal) * total + 1e-9;
    let k = marks.length - 1;
    for (let j = 0; j < marks.length; j++) {
      if (P < cum[j] + mlen[j]) {
        k = j;
        break;
      }
    }
    const frac = Math.min(1, Math.max(0, (P - cum[k]) / mlen[k]));
    out.push(marks[k].start + frac * (marks[k].end - marks[k].start));
    pos += wlen[i];
  }
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out;
}

module.exports = { wordStartTimes };
