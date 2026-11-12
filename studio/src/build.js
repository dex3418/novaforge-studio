'use strict';
// Usage:
//   node src/build.js                      -> every script in scripts/
//   node src/build.js scripts/a.md         -> one script
//   node src/build.js --only carousel      -> carousel,reel,long (comma separated)

const fs = require('fs');
const path = require('path');
const { parseScript } = require('./parse');
const { makeCarousel } = require('./carousel');
const { rulePlan, describePlan } = require('./plan');

const root = path.resolve(__dirname, '..');
const theme = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'));

function parseArgs(argv) {
  const files = [];
  let only = ['carousel', 'reel', 'long'];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') {
      const v = (argv[++i] || '').trim();
      if (v) only = v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    } else if (argv[i].startsWith('--')) {
      throw new Error('Unknown option ' + argv[i]);
    } else {
      files.push(argv[i]);
    }
  }
  return { files, only };
}

async function main() {
  const { files, only } = parseArgs(process.argv.slice(2));
  let scripts = files.map((f) => path.resolve(root, f));
  if (!scripts.length) {
    const dir = path.join(root, 'scripts');
    scripts = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
  }
  if (!scripts.length) throw new Error('No scripts found');

  let failed = 0;
  for (const file of scripts) {
    try {
      const parsed = parseScript(file);
      const outDir = path.join(root, 'out', parsed.slug);
      fs.mkdirSync(outDir, { recursive: true });
      console.log(`\n== ${parsed.slug} (${parsed.scenes.length} scenes) ==`);
      if (parsed.meta.caption) {
        fs.writeFileSync(path.join(outDir, `${parsed.slug}-caption.txt`), parsed.meta.caption + '\n');
      }
      const plan = rulePlan(parsed);
      fs.writeFileSync(path.join(outDir, `${parsed.slug}-plan.json`), JSON.stringify(plan, null, 2));
      console.log('  plan: ' + describePlan(plan));
      if (only.includes('carousel')) await makeCarousel(parsed, theme, outDir, plan);
      const wantVideo = only.filter((x) => x === 'reel' || x === 'long');
      if (wantVideo.length) {
        const { makeVideos } = require('./video');
        await makeVideos(parsed, theme, plan, outDir, root, wantVideo);
      }
    } catch (e) {
      failed++;
      console.error(`FAILED ${file}: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

main();
