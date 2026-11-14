'use strict';
// Builds 1080x1350 Instagram carousel PNGs with Puppeteer, then zips them.
// Slides come from the same scene library as the videos (finished state).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { renderScene, pageHtml } = require('./scenes');
const { dataUri } = require('./pictures');

const W = 1080;
const H = 1350;

function buildSlides(parsed, theme, plan) {
  const brand = parsed.meta.brand || theme.brand || '';
  const handle = parsed.meta.handle || '';
  const byIndex = new Map(plan.scenes.map((s) => [s.index, s]));

  // When the title was taken from the first scene, the cover absorbs that scene.
  const intro = parsed.scenes[0] && parsed.scenes[0].isTitle ? parsed.scenes[0] : null;
  const scenes = intro ? parsed.scenes.slice(1) : parsed.scenes;
  const lastIsCta = scenes.length && byIndex.get(scenes[scenes.length - 1].index).kind === 'cta';
  const total = scenes.length + 1 + (lastIsCta ? 0 : 1); // cover + scenes (+ closing)

  const base = { mode: 'slide', w: W, h: H, plan, font: theme.font, brand, handle, total, pics: (parsed.pictures || []).map((p) => dataUri(p.path)) };
  const slides = [];

  slides.push(
    renderScene({
      ...base,
      scene: {
        index: 0, kind: 'cover', emotion: 'neutral',
        data: { title: parsed.title, sub: intro && intro.body ? intro.body.replace(/\n\n/g, ' ') : '' },
      },
      footLeft: 'Swipe →',
      pageLabel: `1/${total}`,
    })
  );

  scenes.forEach((s, i) => {
    const p = byIndex.get(s.index);
    slides.push(
      renderScene({
        ...base,
        scene: { ...s, ...p },
        num: i + 1,
        pageLabel: `${i + 2}/${total}`,
      })
    );
  });

  if (!lastIsCta) {
    slides.push(
      renderScene({
        ...base,
        scene: { index: 99, kind: 'cta', emotion: 'neutral', data: { text: parsed.meta.cta || 'Thanks for reading', button: handle || 'Link in bio' } },
        pageLabel: `${total}/${total}`,
      })
    );
  }
  return slides.map((html) => pageHtml(html, W, H));
}

async function makeCarousel(parsed, theme, outDir, plan) {
  const puppeteer = require('puppeteer');
  const dir = path.join(outDir, 'carousel');
  fs.mkdirSync(dir, { recursive: true });
  const slides = buildSlides(parsed, theme, plan);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const files = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (let i = 0; i < slides.length; i++) {
      await page.setContent(slides[i], { waitUntil: 'load' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      // text too long for the slide: shrink the content to fit instead of running over
      await page.evaluate(() => {
        const s = document.querySelector('.nf-stage');
        const i = s && s.firstElementChild;
        if (!s || !i) return;
        const need = i.getBoundingClientRect().height;
        const have = s.clientHeight;
        if (need > have) i.style.zoom = String(Math.max(0.55, (have / need) * 0.97));
      });
      const f = path.join(dir, `slide-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
  } finally {
    await browser.close();
  }

  const zipPath = path.join(outDir, `${parsed.slug}-carousel.zip`);
  try {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    execFileSync('zip', ['-j', '-q', zipPath, ...files]);
  } catch (e) {
    console.warn('  zip not available, PNGs are in', dir);
  }
  console.log(`  carousel: ${files.length} slides -> ${zipPath}`);
  return files;
}

module.exports = { makeCarousel, buildSlides };
