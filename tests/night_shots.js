// Dusk, night and weather screenshots (render mode, software GL): the same scene at golden hour -> sunset -> blue
// hour -> night, the moon's glitter path, a night gun duel lit by star shells, a searchlight, a burning ship at night,
// a squall line over the fleet and a rainy dusk. Writes tests/shots/night/*.png.
// Usage: BASE_URL=http://localhost:PORT/ node tests/night_shots.js [seed=4] [only=a,b]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'night'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 4), ONLY = process.argv[3] ? process.argv[3].split(',') : null;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    __sim.setScale(0.1);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * L.ax, L.y + L.h, L.z + L.d * L.az); WW.camera.lookAt(L.x, L.y, L.z); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    // camera d away from o along bearing `brg` (radians, from o toward the camera), h up, looking at o
    window.look = (o, d, h, brg, y) => { window.__look = { x: o.x, y: y || 2, z: o.z, d, h, ax: Math.cos(brg), az: Math.sin(brg) }; };
    window.round = (seed, tod, wx) => {
      const G = WW.game; window.__look = null;
      if (WW.aces) WW.aces.reset();
      WW.dayNight.force = tod; WW.dayNight.pin = null; WW.weather.force = wx;
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    };
    window.centre = n => { const L = WW.world.ships.filter(s => s.alive && s.nation === n && s.type !== 'submarine'); return { x: L.reduce((a, s) => a + s.x, 0) / L.length, z: L.reduce((a, s) => a + s.z, 0) / L.length }; };
    window.burning = s => s.alive && (s.dmgCrit || (s.hp < 0.5 * s.maxHp));
  });
  const want = n => !ONLY || ONLY.includes(n);
  const shot = async (name, wait) => { await p.waitForTimeout(wait || 700); await p.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name, JSON.stringify(await p.evaluate(() => ({ dl: +WW.daylight.toFixed(2), fx: WW.nightFx && WW.nightFx.stats() })))); };

  if (want('seq')) {
    // 1. the same scene from golden hour to night: the USN battle line from the east, the sunset behind it
    await p.evaluate(s => { round(s, 'day', 'clear'); __sim.fastForward(70); const c = centre('USN'); look(c, 120, 26, 0.35); }, SEED);
    for (const [k, nm] of [[1, 'seq_1_golden'], [0.7, 'seq_2_late'], [0.45, 'seq_3_sunset'], [0.25, 'seq_4_bluehour'], [0, 'seq_5_night']]) {
      await p.evaluate(k => { WW.dayNight.pin = k; __sim.fastForward(0.05); }, k);
      await shot(nm, 900);
    }
    // the moon's glitter path: low over open water, looking toward the moon past the fleet
    await p.evaluate(() => { const c = centre('USN'), m = WW.skyTime.MOON, a = Math.atan2(m.z, m.x) + Math.PI; look(c, 110, 2, a, 9); });
    await shot('moon_glitter', 900);
  }
  if (want('duel')) {
    // 2. a night battle: star shells over a gun duel
    await p.evaluate(s => round(s, 'night', 'clear'), SEED);
    const r = await p.evaluate(() => until(() => {
      for (const sh of WW.nightOps.shells) if (sh.lit && WW.time.now - sh.lightAt > 1.5) {
        const t = WW.world.ships.find(s => s.alive && s.nation !== sh.nation && WW.dist(s.x, s.z, sh.x, sh.z) < sh.r);
        if (t) { const by = sh.by; look(t, 140, 22, Math.atan2(t.z - by.z, t.x - by.x) + 0.9, 14); return `${sh.nation} star shell over ${t.nation} ${t.type} t=${WW.game.roundTime | 0}`; }
      }
      return null;
    }, 300));
    console.log('duel:', r); await shot('night_starshell', 1200);
    const r2 = await p.evaluate(() => until(() => {
      const L = WW.nightOps.lights[0]; if (!L) return null;
      const s = L.ship, t = L.target, mx = (s.x + t.x) / 2, mz = (s.z + t.z) / 2, h = Math.atan2(t.z - s.z, t.x - s.x);
      look({ x: mx, z: mz }, WW.dist(s.x, s.z, t.x, t.z) * 0.8 + 50, 32, h + Math.PI / 2); return `${s.nation} ${s.type} searchlight on ${t.nation} ${t.type} t=${WW.game.roundTime | 0}`;
    }, 240));
    console.log('searchlight:', r2); await shot('night_searchlight', 1200);
    const r3 = await p.evaluate(() => until(() => {
      const s = WW.world.ships.find(q => burning(q) && q.type !== 'pt' && q.type !== 'submarine'); if (!s) return null;
      look(s, s.stats.length * 2.6 + 22, 14, s.heading + 2.2); return `${s.nation} ${s.type} burning t=${WW.game.roundTime | 0}`;
    }, 300));
    console.log('burning:', r3); await shot('night_burning', 1200);
    await p.evaluate(() => { window.__look = null; WW.cam.cut(); });
    await p.evaluate(() => __sim.fastForward(4)); await shot('night_director', 2500);
  }
  if (want('squall')) {
    // 3. a squall line crossing the fleets (day), then a rainy dusk
    await p.evaluate(s => round(s, 'day', 'line'), SEED + 1);
    const q = await p.evaluate(() => until(() => {
      const c = centre('USN'), cs = WW.weather.cells; let best = null, bd = 1e9;
      for (const k of cs) { const d = WW.dist(k.x, k.z, c.x, c.z); if (d < bd) { bd = d; best = k; } }
      if (!best || bd > 170) return null;
      look({ x: (best.x + c.x) / 2, z: (best.z + c.z) / 2 }, 260, 105, Math.atan2(c.z - best.z, c.x - best.x) + 0.6); return `cell ${bd | 0} from the USN fleet, t=${WW.game.roundTime | 0}`;
    }, 300));
    console.log('squall:', q); await shot('squall_line', 1200);
    await p.evaluate(() => { WW.dayNight.pin = 0.3; __sim.fastForward(0.05); }); await shot('squall_dusk', 1000);
    await p.evaluate(() => { const k = WW.weather.cells[0]; look(k, k.r * 0.5, 6, 0.3); }); await shot('squall_inside', 1000);
  }
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
