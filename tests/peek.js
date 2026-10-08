const { chromium } = require('playwright');
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'rt'), { recursive: true }); process.chdir(__dirname);
const OUT = process.argv[2] || 'shots';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(3000);
  await p.screenshot({ path: OUT + '/peek_0.png' });
  const times = [20, 25, 25, 30, 30];
  for (let i = 0; i < times.length; i++) {
    await p.evaluate(s => __sim.fastForward(s), times[i]);
    await p.waitForTimeout(2500); // let camera/director settle in real time
    await p.screenshot({ path: OUT + '/peek_' + (i + 1) + '.png' });
  }
  console.log(JSON.stringify(await p.evaluate(() => __sim.stats)));
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
