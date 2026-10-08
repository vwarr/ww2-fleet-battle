const { chromium } = require('playwright');
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'rt'), { recursive: true }); process.chdir(__dirname);
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('response', r => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); }); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(8000);
  const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f(){ n++; if (performance.now()-t0 < 10000) requestAnimationFrame(f); else res(n/((performance.now()-t0)/1000)); })(); }));
  const font = await p.evaluate(async () => { await document.fonts.load('16px "Cormorant Garamond"'); await document.fonts.load('16px Nunito'); return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(','); });
  await p.screenshot({ path: 'shots/realgpu.png' });
  console.log('fps', fps.toFixed(1), 'font', font, 'errors', errs);
  await b.close();
})();
