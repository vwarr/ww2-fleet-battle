// Weather screenshots (render mode, headless, software GL): the setup screen's preview for each weather kind, and
// in-round views (a glassy calm, a fresh trade wind, a thunderstorm, a typhoon) from mid height and low over a
// destroyer. Optional: --strip writes a frame strip (low side-on and 3/4 bow) of a destroyer and a carrier in a gale
// and a typhoon over ~2 swell periods.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/weather_shots.js OUTDIR [setup,round,strip] [seed=5]
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(__dirname, 'shots', 'weather'); fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[3] ? process.argv[3].split(',') : null, SEED = +(process.argv[4] || 5);
const want = n => !ONLY || ONLY.includes(n);
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || /ERROR:/.test(m.text())) errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now(), { timeout: 240000 });
  p.setDefaultTimeout(240000);
  await p.waitForFunction(() => window.WW && WW.game && WW.game.state === 'setup' && WW.weather && WW.weather.preview, null, { timeout: 120000 });
  await p.waitForTimeout(2000);
  const shot = async (name, wait) => { await p.waitForTimeout(wait || 900); await p.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  if (want('setup')) {
    await p.evaluate(() => WW.dayNight.setUserHour(10));
    for (const k of ['clear', 'cumulus', 'overcast', 'scatter', 'line', 'thunder', 'typhoon']) {
      await p.evaluate(k => { const s = document.querySelector('#hud select.wxsel'); s.value = k; s.dispatchEvent(new Event('change')); }, k);
      await shot('setup_' + k, 1500);
    }
    await p.evaluate(() => { const s = document.querySelector('#hud select.wxsel'); s.value = ''; s.dispatchEvent(new Event('change')); });
  }
  await p.evaluate(() => {
    __sim.setScale(0.1);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      const s = L.ship; let x = L.x, z = L.z;
      if (s) { x = s.x; z = s.z; }
      const a = (s ? s.heading : 0) + L.brg;
      WW.camera.position.set(x + Math.cos(a) * L.d, L.h, z + Math.sin(a) * L.d); WW.camera.lookAt(x, L.y, z); WW.camera.updateMatrixWorld();
    };
    window.round = (seed, kind, bf) => {
      const G = WW.game; window.__look = null;
      WW.dayNight.force = 'day'; WW.weather.force = null; WW.weather.userKind = kind; WW.weather.userBf = bf;
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = null; G.mode = 'auto'; G.noRetire = true; G.startRound({ keepMap: true });
      __sim.fastForward(30);
      return { kind: WW.weather.kind, sea: WW.seaState };
    };
    window.ship = t => WW.world.ships.find(s => s.alive && s.type === t && !s.submerged);
    window.look = (t, d, h, brg, y) => { const s = ship(t); window.__look = { ship: s, d, h, brg, y: y || 2 }; return !!s; };
  });
  if (want('round')) {
    for (const [nm, k, bf] of [['calm', 'clear', 0], ['trade', 'clear', 5], ['thunder', 'thunder', 7], ['typhoon', 'typhoon', 11]]) {
      const r = await p.evaluate(a => round(a[0], a[1], a[2]), [SEED, k, bf]);
      console.log(nm, r.kind, JSON.stringify(r.sea));
      await p.evaluate(() => look('destroyer', 260, 120, 2.2, 0)); await shot('round_' + nm + '_mid', 1500);
      await p.evaluate(() => look('destroyer', 40, 6, 2.4, 2)); await shot('round_' + nm + '_low', 1500);
    }
  }
  if (want('horizon')) {   // the sea's far edge against the sky: low, mid and high views, by day and at dusk
    for (const [nm, hour] of [['day', 10], ['dusk', 17.9]]) {
      await p.evaluate(a => { round(a[0], 'clear', 4); WW.dayNight.pinHour = a[1]; __sim.fastForward(0.1); }, [SEED, hour]);
      for (const [v, h, y] of [['low', 5, -6], ['mid', 40, 19], ['high', 160, 110]]) {
        await p.evaluate(a => { const c = { x: 1200, z: 675 }; window.__look = { x: c.x, z: c.z, d: 300, h: a[0], brg: 0.3, y: a[1] }; }, [h, y]);
        await shot(`horizon_${nm}_${v}`, 1200);
      }
    }
    await p.evaluate(() => { WW.dayNight.pinHour = null; });
  }
  if (want('motion')) {   // heave / pitch / roll ranges (5-95 %) of a destroyer and a carrier over ~40 s of sea time
    for (const [nm, k, bf] of [['trade', 'clear', 5], ['gale', 'line', 8], ['typhoon', 'typhoon', 11]]) {
      await p.evaluate(a => round(a[0], a[1], a[2]), [SEED, k, bf]);
      // the sea and the pose stepped directly (0.05 s of sea time a step, 50 s): what a real-time frame loop does
      await p.evaluate(() => { window.__mo = {}; for (const t of ['destroyer', 'carrier']) { const s0 = ship(t); if (!s0) continue; WW.camera.position.set(s0.x + 60, 12, s0.z + 30); WW.camera.lookAt(s0.x, 0, s0.z); WW.camera.updateMatrixWorld();
        for (let i = 0; i < 1000; i++) { WW.shipSwell.unpose(); WW.sea.update(0.05); WW.shipSwell.pose(0.05);
        { const s = s0, m = s && WW.shipSwell.motion(s); if (!m) continue; const L = window.__mo[t] || (window.__mo[t] = { r: [], p: [], h: [], T: [] }); L.r.push(m.roll * 57.3); L.p.push(m.pitch * 57.3); L.h.push((m.heave || 0) * 9.6); L.T.push(WW.sea.time); } } } });
      const r = await p.evaluate(() => { const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(f * (b.length - 1))]; }, o = {};
        for (const t in window.__mo) { const L = window.__mo[t]; o[t] = { n: L.r.length, seaT: +(L.T[L.T.length - 1] - L.T[0]).toFixed(1), roll: +(q(L.r, 0.95) - q(L.r, 0.05)).toFixed(1), pitch: +(q(L.p, 0.95) - q(L.p, 0.05)).toFixed(1), heave_m: +(q(L.h, 0.95) - q(L.h, 0.05)).toFixed(1) }; }
        return { o, info: WW.sea.info }; });
      console.log('motion', nm, JSON.stringify(r.o), 'sea Hs', r.info.Hs.toFixed(1), 'Hw', r.info.Hw.toFixed(1), 'Tw', r.info.Tw.toFixed(1), 'storm', (r.info.storm || 0).toFixed(2));
      await p.evaluate(() => __sim.setScale(0.1));
    }
  }
  if (want('count')) {   // what is drawn: visible meshes by top-level object (clear vs typhoon)
    for (const [k, bf] of [['clear', 4], ['typhoon', 11]]) {
      await p.evaluate(a => { round(a[0], a[1], a[2]); __sim.fastForward(60); }, [SEED, k, bf]);
      await p.waitForTimeout(1500);
      console.log('count', k, JSON.stringify(await p.evaluate(() => { const c = {}; for (const top of WW.scene.children) { let n = 0; top.traverseVisible(o => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) n++; }); if (n) { const key = top.name || top.type; c[key] = (c[key] || 0) + n; } } return c; })));
    }
  }
  if (want('strip')) {
    for (const [nm, k, bf] of [['gale', 'line', 8], ['typhoon', 'typhoon', 11]].filter(c => !process.env.STRIP || process.env.STRIP === c[0])) {   // STRIP=typhoon: that sea only
      await p.evaluate(a => round(a[0], a[1], a[2]), [SEED, k, bf]);
      for (const [t, view, d, h, brg] of [['destroyer', 'side', 45, 3, Math.PI / 2], ['destroyer', 'bow', 45, 5, 0.6], ['carrier', 'side', 110, 6, Math.PI / 2], ['carrier', 'bow', 110, 10, 0.6]]) {
        if (!await p.evaluate(a => look(a[0], a[1], a[2], a[3], 2), [t, d, h, brg])) continue;
        for (let i = 0; i < 6; i++) { await p.evaluate(() => __sim.fastForward(2.5)); await shot(`strip_${nm}_${t}_${view}_${i}`, 300); }
      }
    }
  }
  console.log(errs.length ? 'errors: ' + errs.slice(0, 5).map(e => e.slice(0, process.env.ERRLEN ? +process.env.ERRLEN : 200)).join(' | ') : 'no page errors');
  await b.close();
})();
