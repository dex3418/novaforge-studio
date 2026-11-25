'use strict';
// Packs the stage code for the browser so the Live Lab draws with exactly the code Remotion uses.
// Reads the source files on every request and takes the character / library data from the server's fresh in-memory bake,
// so a newly approved drawing shows up in the lab immediately, with no build step and nothing written to the baked files.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const FILES = ['story_stage', 'story_art', 'story', 'characters', 'character_art', 'library_art', 'icons', 'shots', 'blocking', 'catalog', 'assets', 'casting', 'casting_data'];

// bundle({ chars, lib }) -> javascript text defining window.NFLab = { stageSvg, normalizeStory, analyse, CHARS, A, catalog }
function bundle(baked) {
  const mods = {};
  for (const n of FILES) mods[n] = fs.readFileSync(path.join(SRC, n + '.js'), 'utf8');
  const data = { characters_data: JSON.stringify((baked && baked.chars) || {}), library_data: JSON.stringify((baked && baked.lib) || { props: {}, landscapes: {} }) };
  let out = '(function(){\nvar defs={},cache={};\n';
  for (const n of FILES) out += `defs[${JSON.stringify(n)}]=function(module,exports,require){\n${mods[n]}\n};\n`;
  for (const n of Object.keys(data)) out += `defs[${JSON.stringify(n)}]=function(module){module.exports=${data[n]};};\n`;
  out += `function req(name){var k=name.replace(/^\\.\\//,'').replace(/\\.js$/,'');if(cache[k])return cache[k].exports;if(!defs[k])throw new Error('lab bundle: missing module '+name);var m={exports:{}};cache[k]=m;defs[k](m,m.exports,req);return m.exports;}
var A=req('story_art'),S=req('story_stage'),ST=req('story'),B=req('blocking'),C=req('characters'),AS=req('assets');
window.NFLab={stageSvg:S.stageSvg,normalizeStory:ST.normalizeStory,analyse:B.analyse,CHARS:C,A:A,assets:AS};
})();\n`;
  return out;
}

module.exports = { bundle, FILES };
