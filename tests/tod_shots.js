// Time-of-day screenshot sequences over whole rounds (render mode, software GL): a sunset round (golden afternoon ->
// the sun on the horizon -> afterglow -> blue hour -> night), a dawn round (twilight -> sunrise -> morning) and a day
// round (the sun moving). The camera looks toward the sun from behind the USN fleet (the day round: a fixed oblique
// view, so the shadows show the sun moving), plus one director frame at sunset. Writes tests/shots/tod/*.png.
// Usage: BASE_URL=http://localhost:PORT/ node tests/tod_shots.js [seed=4] [sunset,dawn,day]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'tod'); fs.mkdirSync(OUT, { recursive: true });
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
    window.round = (seed, tod) => {
      const G = WW.game; window.__look = null;
      if (WW.aces) WW.aces.reset();
      WW.dayNight.force = tod; WW.dayNight.pin = null; WW.dayNight.pinHour = null; WW.weather.force = 'clear';
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = null; G.mode = 'auto'; G.noRetire = true; G.startRound({ keepMap: true });
    };
    window.centre = n => { const L = WW.world.ships.filter(s => s.alive && s.nation === n && s.type !== 'submarine'); if (!L.length) return { x: 480, z: 300 }; return { x: L.reduce((a, s) => a + s.x, 0) / L.length, z: L.reduce((a, s) => a + s.z, 0) / L.length }; };
    // look toward the sun past the USN fleet (camera on the far side), low over the water
    window.sunward = (d, h, y) => { const c = centre('USN'), a = WW.dayNight.sunAz + Math.PI; window.__look = { x: c.x, y: y || 6, z: c.z, d, h, ax: Math.cos(a), az: Math.sin(a) }; };
    window.fixed = (x, z, d, h, brg) => { window.__look = { x, y: 2, z, d, h, ax: Math.cos(brg), az: Math.sin(brg) }; };
    window.to = t => { const g = WW.game; if (t > g.roundTime) __sim.fastForward(t - g.roundTime); if (g.state !== 'battle') { g.state = 'battle'; } };
  });
  const want = n => !ONLY || ONLY.includes(n);
  const info = () => p.evaluate(() => { const D = WW.dayNight, h = D.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `t=${WW.game.roundTime | 0} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} sun ${D.sunElev.toFixed(1)} deg daylight ${WW.daylight.toFixed(2)} ${WW.game.state}`; });
  const shot = async (name, wait) => { await p.waitForTimeout(wait || 900); await p.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name, await info()); };

  if (want('sunset')) {
    await p.evaluate(s => round(s, 220), SEED);   // the sun sets 220 s in
    for (const [t, nm] of [[20, 'a_golden'], [110, 'b_late'], [170, 'c_low'], [200, 'd_sunset'], [214, 'e_horizon'], [228, 'f_afterglow'], [245, 'g_bluehour'], [275, 'h_night']]) {
      await p.evaluate(t => { to(t); sunward(150, 16, 8); }, t);
      await shot('sunset_' + nm);
    }
    await p.evaluate(() => { WW.dayNight.pinHour = 17.9; __sim.fastForward(0.05); window.__look = null; WW.cam.cut(); });
    await p.evaluate(() => __sim.fastForward(3)); await shot('sunset_director', 3500);
    await p.evaluate(() => { WW.dayNight.pinHour = null; });
  }
  if (want('dawn')) {
    await p.evaluate(s => round(s, 'dawn'), SEED + 1);
    for (const [t, nm] of [[5, 'a_twilight'], [45, 'b_first_light'], [75, 'c_sunrise'], [110, 'd_morning'], [200, 'e_morning'], [320, 'f_day']]) {
      await p.evaluate(t => { to(t); sunward(150, 16, 8); }, t);
      await shot('dawn_' + nm);
    }
  }
  if (want('day')) {
    await p.evaluate(s => round(s, 'day'), SEED + 2);
    const c = await p.evaluate(() => centre('USN'));
    for (const [t, nm] of [[5, 'a'], [120, 'b'], [240, 'c'], [360, 'd']]) {
      await p.evaluate(([t, c]) => { to(t); const k = centre('USN'); fixed(k.x, k.z, 110, 70, -Math.PI / 2 + 0.4); }, [t, c]);
      await shot('day_' + nm);
    }
  }
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
