// Render-mode screenshots of the admirals (admirals.js, admirals_flags.js): node tests/admirals_shots.js [seed] [outdir]
// adm_ready (the setup panel with the two admirals), adm_flag_USN / adm_flag_IJN (pennant and signal hoist on each
// flagship), adm_transfer (a forced flagship loss: the flag-transfer caption, then the new flagship), adm_lamps
// (blinker lamps with WW.daylight faked to night: the sky stays day, the lamps are the point).
const { chromium } = require('playwright');
const seed = +(process.argv[2] || 3), out = process.argv[3] || require('path').join(__dirname, 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(2500);
  console.log('ready:', await p.evaluate(() => document.querySelector('.adm') && document.querySelector('.adm').textContent));
  await p.screenshot({ path: `${out}/adm_ready.png` });
  const info = await p.evaluate(seed => {
    const G = WW.game;
    __sim.setScale(0.1);
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    __sim.fastForward(40);
    return ['USN', 'IJN'].map(n => { const A = WW.admirals.of(n); return n + ' ' + A.title + ' (' + A.style + ') flag ' + A.flagName + ' ' + A.flagship.type + ' posture ' + A.posture; }).join(' | ');
  }, seed);
  console.log(info);
  const film = n => p.evaluate(n => { const s = WW.admirals.of(n).flagship; WW.cam.film({ kind: 'orbit', subj: s, r: s.type === 'carrier' ? 24 : 20, dur: 30, w: 0.04 }); }, n);
  for (const n of ['USN', 'IJN']) { await film(n); await p.waitForTimeout(3500); await p.screenshot({ path: `${out}/adm_flag_${n}.png` }); }
  // a forced flagship loss: confusion, then the transfer caption
  const tr = await p.evaluate(() => {
    let ev = null; WW.on('admiralOrder', e => { if (e.order === 'transfer' && !ev) ev = e; });
    WW.admirals.force('IJN');
    for (let i = 0; i < 160 && !ev; i++) __sim.fastForward(0.5);
    return ev ? ev.text + ' (' + ev.from + ' -> ' + ev.to + ')' : null;
  });
  console.log('transfer:', tr);
  for (let i = 0; i < 1; i++) { console.log(await p.evaluate(() => JSON.stringify({ q: WW.admiralFlags.queue().map(q => [q.main, q.must, +(q.at - performance.now() / 1000).toFixed(1), +(q.until - performance.now() / 1000).toFixed(1)]), on: WW.ui.captionOn(), cap: document.querySelector('#film .caption .main').textContent }))); await p.waitForTimeout(400); }
  await film('IJN');
  await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/adm_transfer.png` });
  await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/adm_transfer_2.png` });
  await p.evaluate(() => { WW.daylight = 0.2; }); await film('USN');
  await p.waitForTimeout(3000); await p.screenshot({ path: `${out}/adm_lamps.png` });
  console.log('stats', await p.evaluate(() => JSON.stringify(WW.admirals.stats)));
  await b.close();
})();
