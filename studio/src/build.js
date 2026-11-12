'use strict';
// Usage:
//   node src/build.js                      -> every script in scripts/
//   node src/build.js scripts/a.md         -> one script
//   node src/build.js --only carousel      -> carousel,reel,long (comma separated)
//
// Stages (each one is written to <name>-report.md so you can see which one failed):
//   1 clean script  2 read script  3 AI director  4 plan  5 voice  6 render

const fs = require('fs');
const path = require('path');
const { parseText } = require('./parse');
const { prepareScript } = require('./ai_clean');
const { makeCarousel } = require('./carousel');
const { rulePlan, describePlan } = require('./plan');
const { direct } = require('./director');
const { Report } = require('./report');

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
    } else files.push(argv[i]);
  }
  return { files, only };
}

const slugOf = (file) =>
  path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'script';

function kindCounts(plan) {
  const c = {};
  for (const s of plan.scenes) {
    const list = s.beats && s.beats.length ? s.beats.map((b) => b.kind) : [s.kind];
    for (const k of list) c[k] = (c[k] || 0) + 1;
  }
  return Object.entries(c).map(([k, n]) => `${k} x${n}`).join(', ');
}

async function build(file, only) {
  const slug = slugOf(file);
  const outDir = path.join(root, 'out', slug);
  fs.mkdirSync(outDir, { recursive: true });
  const report = new Report(slug);
  console.log(`\n== ${slug} ==`);
  try {
    // 1 ------------------------------------------------------------ clean
    const cleaned = await report.run('1 Clean script', async () => {
      const raw = fs.readFileSync(file, 'utf8');
      const c = await prepareScript(raw);
      fs.writeFileSync(path.join(outDir, `${slug}-cleaned.md`), c.text);
      return { status: c.status, summary: c.summary, details: c.details, value: c.text };
    });

    // 2 ------------------------------------------------------------ read
    const parsed = await report.run('2 Read script', async () => {
      const p = parseText(cleaned, slug);
      if (!p.scenes.length) throw new Error('no scenes found');
      const wc = p.scenes.map((s) => s.narration.split(/\s+/).filter(Boolean).length);
      const total = wc.reduce((a, b) => a + b, 0);
      const d = [`title: ${p.title}`, `brand: ${p.meta.brand || '(none)'}, handle: ${p.meta.handle || '(none)'}`, `engine: ${p.meta.engine}, voice: ${p.meta.voice || 'auto'}, planner: ${p.meta.director || 'ai'}`];
      d.push('scene sizes (words): ' + wc.join(', '));
      const st = total > 1400 ? 'warn' : 'ok';
      if (st === 'warn') d.push('very long script: the video will run over ~9 minutes');
      return { status: st, summary: `${p.scenes.length} scenes, ${total} words (~${(total / 2.6 / 60).toFixed(1)} min spoken)`, details: d, value: p };
    });
    if (parsed.meta.caption) fs.writeFileSync(path.join(outDir, `${slug}-caption.txt`), parsed.meta.caption + '\n');

    // 3 + 4 --------------------------------------------------------- director and plan
    let plan = rulePlan(parsed);
    if (parsed.meta.director === 'rules') {
      report.add('3 AI director', 'skip', 'rules only was chosen');
    } else {
      const t = Date.now();
      const r = await direct(parsed, plan);
      plan = r.plan;
      const st = report.add('3 AI director', r.status, r.note, r.details);
      st.ms = Date.now() - t;
    }
    fs.writeFileSync(path.join(outDir, `${slug}-plan.json`), JSON.stringify(plan, null, 2));
    report.add('4 Plan', 'ok', `${plan.source === 'ai' ? 'AI' : 'rules'} plan: ${kindCounts(plan)}`, [describePlan(plan)]);

    // 5 + 6 --------------------------------------------------------- outputs
    if (only.includes('carousel')) {
      await report.run('6a Render carousel', async () => {
        const files = await makeCarousel(parsed, theme, outDir, plan);
        return { summary: `${files.length} slides`, value: files };
      });
    }
    const wantVideo = only.filter((x) => x === 'reel' || x === 'long');
    if (wantVideo.length) {
      const { makeVideos } = require('./video');
      const job = await report.run('5 Voice', async () => {
        const j = await makeVideos(parsed, theme, plan, outDir, root, wantVideo);
        const infos = j.scenes.map((s) => s.voiceInfo);
        const fell = infos.filter((x) => x.note);
        const est = infos.filter((x) => x.timing === 'estimated');
        const d = j.scenes.map((s) => `scene ${s.index}: ${s.voiceInfo.engine}/${s.voiceInfo.voice} ${s.voiceInfo.rate}, ${s.seconds.toFixed(1)}s, captions ${s.voiceInfo.timing}${s.voiceInfo.note ? ' - ' + s.voiceInfo.note : ''}`);
        const st = fell.length || est.length ? 'warn' : 'ok';
        return { status: st, summary: `${j.scenes.length} voice clips, ${j.total.toFixed(0)}s total${fell.length ? `, ${fell.length} fell back to Edge` : ''}${est.length ? `, ${est.length} with estimated caption timing` : ''}`, details: d, value: j };
      });
      await report.run('6b Render video', async () => {
        const files = await job.run();
        return { summary: files.map((f) => `${f.id} ${f.seconds.toFixed(0)}s, ${f.mb.toFixed(1)} MB`).join('; ') };
      });
    }
    report.save(outDir);
    return true;
  } catch (e) {
    if (!e.reported) report.add('Unexpected error', 'fail', e.message);
    console.error(`FAILED ${file}: ${e.message}`);
    report.save(outDir);
    return false;
  }
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
  for (const file of scripts) if (!(await build(file, only))) failed++;
  if (failed) process.exit(1);
}

main();
