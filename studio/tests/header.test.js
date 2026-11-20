'use strict';
// Story mode must not switch off silently: a phone-typed header still counts, the cleaner never throws the header away,
// and a dialogue script with story mode off is called out in plain words.
const assert = require('assert');
const { parseText } = require('../src/parse');
const { splitHeader, mergeHeader } = require('../src/header');
const { prepareScript } = require('../src/ai_clean');
const { isStoryMeta, storyHint } = require('../src/story');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const okAsync = async (name, fn) => { await fn(); n++; console.log('  ok   ' + name); };

const cast = 'Pallavi (woman, saree, red); Naina (woman, kurta); Nikita (girl, magenta)';
const body = '# The Sensor\n\n## Morning\nNikita (happy): Maa, I am home!\nPallavi (sad): Come and see, beta.\n\n## Dry\nNikita (worried): Why is the ground dry?\nNaina: We must measure the soil.\n';
const isStory = (t) => { const p = parseText(t, 't'); return isStoryMeta(p.meta) || !!(p.cast && p.cast.length); };

(async () => {
  ok('the plain lowercase header switches story mode on', () => assert.ok(isStory(`---\nmode: story\ncast: ${cast}\n---\n${body}`)));
  ok('capitalised keys from a phone keyboard (Mode:, Cast:) still count', () => assert.ok(isStory(`---\nMode: Story\nCast: ${cast}\n---\n${body}`)));
  ok('a blank line above the header, a space after the fence and CRLF line endings are fine', () => {
    assert.ok(isStory(`\n\n---\nmode: story\ncast: ${cast}\n---\n${body}`));
    assert.ok(isStory(`--- \nmode: story\ncast: ${cast}\n--- \n${body}`));
    assert.ok(isStory(`---\r\nmode: story\r\ncast: ${cast}\r\n---\r\n${body.replace(/\n/g, '\r\n')}`));
  });
  ok('a header wrapped in a code fence, or fenced with phone dashes, is read', () => {
    assert.ok(isStory('```\n---\nmode: story\ncast: ' + cast + '\n---\n```\n' + body));
    assert.ok(isStory(`\u2014\nmode: story\n\u2014\n${body}`));
    assert.ok(isStory(`\u2014\u2014\u2014\nmode: story\n\u2014\u2014\u2014\n${body}`));
  });
  ok('a document that only starts with a horizontal rule is not mistaken for a header', () => {
    const h = splitHeader('---\nJust a line of text\n---\nBody');
    assert.strictEqual(h.matched, false);
  });
  ok('"mode: carousel" is still an explicit no', () => assert.ok(!isStory(`---\nmode: carousel\ncast: ${cast}\n---\n${body}`)));

  await okAsync('a story script with "Scene 1" labels instead of "##" keeps its header and never goes to the AI cleaner', async () => {
    const raw = `---\nmode: story\ncast: ${cast}\nvoice: en-IN-NeerjaNeural\nbrand: Novaforge Labs\n---\nScene 1 - The field\nNikita (happy): Maa, I am home!\nPallavi (sad): Come and see.\n\n**Scene 2**\nNaina: We must measure the soil.\n`;
    let called = false;
    const r = await prepareScript(raw, { call: () => { called = true; throw new Error('the AI must not be called for a story'); } });
    assert.strictEqual(called, false);
    assert.ok(/story script, 2 scenes/.test(r.summary), r.summary);
    const p = parseText(r.text, 't');
    assert.ok(isStoryMeta(p.meta) && p.cast.length === 3);
    assert.strictEqual(p.scenes.length, 2);
    assert.strictEqual(p.meta.voice, 'en-IN-NeerjaNeural');
    assert.strictEqual(p.meta.brand, 'Novaforge Labs');
    assert.ok(/Maa, I am home!/.test(r.text) && /measure the soil/.test(r.text), 'every spoken line is kept');
  });

  await okAsync('a story script with no scene labels at all becomes one scene per blank-line block', async () => {
    const raw = `Mode: Story\n\nNikita (happy): Maa, I am home!\nPallavi (sad): Come and see.\n\nNaina: We must measure the soil.\nNikita (worried): With what?\n`;
    const r = await prepareScript(`---\nMode: Story\n---\n${raw.split('\n\n').slice(1).join('\n\n')}`, { call: () => { throw new Error('no AI'); } });
    const p = parseText(r.text, 't');
    assert.strictEqual(p.scenes.length, 2);
    assert.ok(isStoryMeta(p.meta) && p.cast.length >= 3);
  });

  await okAsync('a story already in studio format is untouched', async () => {
    const raw = `---\nMode: story\nCast: ${cast}\n---\n${body}`;
    const r = await prepareScript(raw, { call: () => { throw new Error('no AI'); } });
    assert.strictEqual(r.summary, 'already in studio format');
    assert.ok(isStory(r.text));
  });

  ok('mergeHeader: the original keys win and a title the cleaner made is kept only when there was none', () => {
    const rebuilt = '---\ntitle: Cleaner title\nvoice: other\n---\n\n## One\nHello there.\n';
    const a = splitHeader(mergeHeader(rebuilt, ['mode: story', 'voice: mine'])).meta;
    assert.strictEqual(a.mode, 'story');
    assert.strictEqual(a.voice, 'mine');
    assert.strictEqual(a.title, 'Cleaner title');
    assert.strictEqual(splitHeader(mergeHeader(rebuilt, ['title: Mine'])).meta.title, 'Mine');
    assert.strictEqual(mergeHeader('plain text', []), 'plain text');
  });

  ok('dialogue with story mode off gets a plain-words warning; a normal script does not', () => {
    const hint = storyHint(body);
    assert.ok(/looks like a story/.test(hint) && /mode: story/.test(hint), hint);
    assert.strictEqual(storyHint('# Money tips\n\n## One\nSave first, spend later.\n\n## Two\nPay yourself before anyone else.\n'), '');
    assert.strictEqual(storyHint('## One\nNote: this is a tip.\nTip: save early.\nStep: begin.\nHint: start small.\n'), '');
  });

  console.log(`header.test.js: ${n}/${n} checks passed`);
})().catch((e) => { console.log('  FAIL ' + (e.stack || e.message)); process.exit(1); });
