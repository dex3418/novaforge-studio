'use strict';
// Phone layout rules that must not regress (v32): the Learning Studio's settings panel once got pinned over the
// learning cards because a theme rule pinned "the first box" of every page.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dir = path.join(__dirname, '..', 'learn');
const theme = fs.readFileSync(path.join(dir, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const lab = fs.readFileSync(path.join(dir, 'lab.html'), 'utf8');
const index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; };

const stickyRules = [...theme.matchAll(/([^{}]+)\{[^}]*position:\s*sticky[^}]*\}/g)].map((m) => m[1].trim());

ok('the theme pins only boxes marked .pin, never a page-wide "first box"', () => {
  assert.ok(stickyRules.length > 0, 'the Lab still needs one pinned box');
  for (const sel of stickyRules) assert.strictEqual(sel, '.pin', `unexpected sticky selector: ${sel}`);
});
ok('only the Live Lab uses .pin', () => {
  assert.ok(/class="box pin"/.test(lab));
  assert.ok(!/class="[^"]*\bpin\b/.test(index), 'the Learning Studio must not pin anything');
});
ok('the header scrolls away on phones (it took a third of the screen)', () => {
  const phone = theme.split('@media (max-width:820px)')[1] || '';
  assert.ok(/header\{[^}]*position:static/.test(phone));
});
ok('the pinned Lab box is a direct child of the page grid on phones, so it stays while everything scrolls', () => {
  assert.ok(/body\.lab main>div:first-child\{display:contents\}/.test(theme));
  assert.ok(/<body class="lab">/.test(lab));
});
ok('learning cards stack their three verdict buttons and cannot be pushed wider than the screen', () => {
  assert.ok(/\.card \.btns\{grid-template-columns:1fr\}/.test(theme));
  assert.ok(/\.cards>\*,\.card,\.trio>\*\{min-width:0\}/.test(theme));
});
console.log(`mobile_layout.test.js: ${n} tests passed`);
