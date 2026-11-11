'use strict';
// Builds 1080x1350 Instagram carousel PNGs with Puppeteer, then zips them.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function bodySize(len) {
  if (len < 120) return 56;
  if (len < 220) return 48;
  if (len < 330) return 42;
  return 36;
}

function baseCss(t) {
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px}
  body{font-family:${t.font};color:${t.text};
    background:linear-gradient(160deg,${t.bg} 0%,${t.bg2} 100%);
    position:relative;overflow:hidden}
  .glow{position:absolute;width:760px;height:760px;border-radius:50%;
    background:radial-gradient(circle,${t.accent}33 0%,transparent 70%);top:-260px;right:-260px}
  .wrap{position:absolute;inset:0;padding:96px 88px;display:flex;flex-direction:column}
  .top{display:flex;justify-content:space-between;align-items:center;font-size:28px;color:${t.muted};letter-spacing:.04em}
  .brand{font-weight:700;color:${t.accent}}
  .main{flex:1;display:flex;flex-direction:column;justify-content:center}
  .chip{display:inline-flex;align-items:center;justify-content:center;width:84px;height:84px;border-radius:22px;
    background:${t.accent};color:${t.bg};font-weight:800;font-size:40px;margin-bottom:44px}
  h1{font-size:92px;line-height:1.12;font-weight:800}
  h2{font-size:68px;line-height:1.15;font-weight:800;margin-bottom:40px}
  p{line-height:1.45;color:#e6e9f5;margin-bottom:26px}
  .bar{height:8px;border-radius:4px;background:${t.accent};width:140px;margin-top:44px}
  .foot{display:flex;justify-content:space-between;font-size:28px;color:${t.muted}}
  `;
}

function shell(t, brand, inner, footLeft, footRight) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t)}</style></head><body>
  <div class="glow"></div>
  <div class="wrap">
    <div class="top"><span class="brand">${esc(brand)}</span><span></span></div>
    <div class="main">${inner}</div>
    <div class="foot"><span>${esc(footLeft)}</span><span>${esc(footRight)}</span></div>
  </div></body></html>`;
}

function buildSlides(parsed, theme) {
  const brand = parsed.meta.brand || theme.brand || '';
  const handle = parsed.meta.handle || '';
  const total = parsed.scenes.length + 2; // cover + scenes + closing
  const slides = [];

  slides.push(
    shell(
      theme,
      brand,
      `<h1>${esc(parsed.title)}</h1><div class="bar"></div>`,
      'Swipe →',
      `1/${total}`
    )
  );

  parsed.scenes.forEach((s, i) => {
    const paras = (s.body || '').split(/\n\n/).filter(Boolean);
    const size = bodySize((s.body || '').length);
    const inner =
      `<div class="chip">${i + 1}</div><h2>${esc(s.heading)}</h2>` +
      paras.map((p) => `<p style="font-size:${size}px">${esc(p)}</p>`).join('');
    slides.push(shell(theme, brand, inner, handle, `${i + 2}/${total}`));
  });

  const closing =
    `<h1>${esc(parsed.meta.cta || 'Thanks for reading')}</h1>` +
    (handle ? `<p style="font-size:48px;margin-top:36px;color:${theme.accent}">${esc(handle)}</p>` : '') +
    '<div class="bar"></div>';
  slides.push(shell(theme, brand, closing, '', `${total}/${total}`));
  return slides;
}

async function makeCarousel(parsed, theme, outDir) {
  const puppeteer = require('puppeteer');
  const dir = path.join(outDir, 'carousel');
  fs.mkdirSync(dir, { recursive: true });
  const slides = buildSlides(parsed, theme);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const files = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    for (let i = 0; i < slides.length; i++) {
      await page.setContent(slides[i], { waitUntil: 'load' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
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
