'use strict';
// One tolerant reader for the script header ("---" ... "---"), shared by the parser, the cleaner and the box page.
// Phone keyboards turn "---" into a dash, capitalise "Mode:", add a space after the fence, or wrap the file in a
// code fence; none of that may switch story mode off silently. Keys are read in lower case.

const FENCE = '[ \\t]*(?:[-\\u2013\\u2014\\u2015]{2,}|[\\u2013\\u2014\\u2015])[ \\t]*';
const RE = new RegExp('^\\uFEFF?\\s*(?:```[^\\n]*\\r?\\n)?' + FENCE + '\\r?\\n([\\s\\S]*?)\\r?\\n' + FENCE + '(?:\\r?\\n|$)(?:[ \\t]*```[ \\t]*(?:\\r?\\n|$))?');
const KEY = /^\s*([A-Za-z][A-Za-z0-9_ -]{0,30}?)\s*[:：]\s*(.*)$/;

const keyOf = (line) => { const m = String(line).match(KEY); return m ? m[1].trim().toLowerCase() : ''; };

// -> { matched, meta, lines, body }. "lines" are the header lines with the key in lower case, ready to write back.
function splitHeader(src) {
  const text = String(src == null ? '' : src);
  const m = text.match(RE);
  if (!m) return { matched: false, meta: {}, lines: [], body: text };
  const meta = {};
  const lines = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const k = raw.match(KEY);
    if (!k) continue;
    const key = k[1].trim().toLowerCase();
    meta[key] = k[2].trim();
    lines.push(`${key}: ${k[2].trim()}`);
  }
  // a document that merely starts with a horizontal rule is not a header: it needs at least one "key: value" line
  if (!lines.length) return { matched: false, meta: {}, lines: [], body: text };
  return { matched: true, meta, lines, body: text.slice(m[0].length) };
}

// Puts the original header back on text the cleaner rebuilt. The original keys win; a title the cleaner made is kept
// only when the original had none.
function mergeHeader(text, origLines) {
  if (!origLines || !origLines.length) return text;
  const own = splitHeader(text);
  const have = new Set(origLines.map(keyOf));
  const extra = own.matched ? own.lines.filter((l) => !have.has(keyOf(l))) : [];
  return `---\n${origLines.concat(extra).join('\n')}\n---\n${own.matched ? own.body : text}`;
}

module.exports = { splitHeader, mergeHeader, keyOf };
