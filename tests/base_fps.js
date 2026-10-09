// Frame rate at the island base during a raid (real Chrome with the GPU: opens a window; run it once at the end).
// A USN base, the round fast-forwarded to its alarm, bombs on the camp, the camera parked low over the camp:
// fps with the base life on, then with it off (WW.baseLife / baseLifeFx / baseLifeCars updates skipped), and the
// base life's own cost per frame. Usage: BASE_URL=http://localhost:PORT/ node tests/base_fps.js [seed=3]
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3);
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(6000);
  const info = await p.evaluate(seed => {
    WW.terrain.generate(seed); WW.seedRandom(seed); WW.game.baseChoice = 'USN'; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true }); WW.game.baseChoice = null;
    const B = WW.islandBase.base; let alarm = null; WW.on('baseAlarm', e => { alarm = e; });
    for (let i = 0; i < 4000 && !alarm; i++) __sim.fastForward(0.1);
    const en = WW.enemyOf(B.nation); for (const d of B.decor.filter(d => d.kind === 'hut').slice(0, 2)) WW.islandBase.impact(en, d.x, d.z, 200, 'bomb');
    const hs = B.decor.filter(d => d.kind === 'hut' || d.kind === 'tent'), cx = hs.reduce((s, d) => s + d.x, 0) / hs.length, cz = hs.reduce((s, d) => s + d.z, 0) / hs.length;
    WW.cam.update = function () { WW.camera.position.set(cx + 22, B.site.padH + 12, cz + 18); WW.camera.lookAt(cx, B.site.padH, cz); WW.camera.updateMatrixWorld(); };
    window.__off = false;
    for (const k of ['baseLife', 'baseLifeFx', 'baseLifeCars']) { const o = WW[k], u = o.update.bind(o), t = o.tick && o.tick.bind(o); o.update = function () { if (!window.__off) return u.apply(null, arguments); }; if (t) o.tick = function () { if (!window.__off) return t(); }; }
    return { alarm: alarm && alarm.kind, t: WW.game.roundTime.toFixed(0) };
  }, SEED);
  await p.waitForTimeout(3000);
  const meas = () => p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 8000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); })(); }));
  const on = await meas();
  const life = await p.evaluate(() => ({ phase: WW.baseLife.phase, people: WW.baseLife.people.length, ms: WW.baseLife.perf.ms, max: WW.baseLife.perf.max, crew: WW.crew.stats().visible }));
  await p.screenshot({ path: __dirname + '/shots/baselife/fps_raid.png' });
  await p.evaluate(() => { window.__off = true; WW.baseLife.clear(); WW.baseLifeFx.clear(); });
  await p.waitForTimeout(1500);
  const off = await meas();
  console.log('alarm', JSON.stringify(info), 'fps with base life', on.toFixed(1), 'without', off.toFixed(1), 'life', JSON.stringify(life), 'errors', errs.slice(0, 5));
  await b.close();
})();
