// Screenshots of the island base's sky at T s into a midway round (render mode, software GL): a wide oblique view of
// the island from the sea, high enough to show any column of planes circling over the field.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> OUT=<dir> TAG=before node tests/island_columns_shots.js [seed=2] [60,200]
'use strict';
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const SB = require('./sim_behaviour');
const SEED = +(process.argv[2] || 2), TS = (process.argv[3] || '60,200').split(',').map(Number);
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'island_columns'), TAG = process.env.TAG || 'shot';
fs.mkdirSync(OUT, { recursive: true });
const MW = SB.SCEN.find(s => s.name === 'midway');
const spec = { seed: SEED, A: MW.A, B: MW.B, aNation: 'USN', base: 'USN', cripple: -1, noStall: false, light: true, dayClear: true };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', x => console.log('PAGE', x.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8155/') + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 90000 });
  await p.waitForTimeout(2000);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption { display: none !important; }' });
  await p.evaluate(SB.install, SB.P);
  for (const T of TS) {
    const info = await p.evaluate(([spec, T]) => {
      __sim.setScale(0.1);
      const dl = WW.game.deadline; WW.game.deadline = null;   // (B.run runs on to the deadline + 30 s otherwise)
      try { window.__beh.run(Object.assign({}, spec, { until: T })); } finally { WW.game.deadline = dl; }
      WW.time.scale = 0.0001;
      const B = WW.islandBase.base, a = Math.atan2(B.z - WW.cfg.MAP_H / 2, B.x - WW.cfg.MAP_W / 2);   // from the sea side, away from the map centre
      const cx = B.x + Math.cos(a) * 190, cz = B.z + Math.sin(a) * 190;
      WW.cam.update = function () { WW.camera.position.set(cx, 30, cz); WW.camera.lookAt(B.x, 34, B.z); WW.camera.updateMatrixWorld(); };
      let n = 0; for (const q of WW.world.planes) if (q.alive && q.y > 3 && Math.hypot(q.x - B.x, q.z - B.z) < 110) n++;
      return { t: +WW.game.roundTime.toFixed(1), near: n };
    }, [spec, T]);
    await p.waitForTimeout(2500);
    const f = path.join(OUT, `${TAG}_seed${SEED}_${T}s.png`);
    await p.screenshot({ path: f, timeout: 180000 });
    console.log(f, JSON.stringify(info));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
