// Close-ups of plane gunfire (render mode, software GL): a fighter firing at a plane right ahead, the tracers leaving
// the wing guns and converging on it. Same seeded carrier battle and fake frame clock as tests/flight_shots.js.
// Finds a fighter that has just opened fire (df.burst > 0) at a plane (df.gunAt) within 10 deg of its nose, then
// films a short frame sequence from behind the shooter (over its shoulder, down the gun line) and one from the side.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/gun_shots.js [seed=3] [count=3] [target kinds: fighter,dive,torpedo,...]
// Output: tests/shots/planes/gun_<n>_<view>_<frame>.png
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'planes');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3), COUNT = +(process.argv[3] || 3), KINDS = process.argv[4] ? process.argv[4].split(',') : null;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8795/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate(([seed, kinds]) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      if (!window.__lookFn) return camUpd(rdt);
      const L = __lookFn(); if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x, Math.max(L.y, 1.5), L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 - 60 }, { type: 'carrier', nation: n, x, z: H / 2 + 60 }, { type: 'battleship', nation: n, x: x + s * 50, z: H / 2 },
      { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 90 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 90 }];
    G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    __sim.setScale(1);
    window.__kinds = kinds;
    // a fighter that has just opened fire at a plane within 10 deg of its nose, 10-26 away
    window.__findShot = () => {
      for (const q of WW.world.planes) {
        const s = q.df, f = s && s.gunAt;
        if (!q.alive || q.kind !== 'fighter' || !f || !f.alive || !(s.burst > 0.25) || (window.__kinds && window.__kinds.indexOf(f.kind) < 0)) continue;
        const d = Math.hypot(f.x - q.x, f.y - q.y, f.z - q.z); if (d < 10 || d > 26) continue;
        if (WW.dogfight.noseOff(q, f.x, f.y, f.z) > 0.17) continue;
        return { q, f, d, desc: q.nation + ' ' + (q.target ? 'escort' : 'CAP') + ' fighter on a ' + f.nation + ' ' + f.kind + ' ' + d.toFixed(0) + ' ahead, ' + (WW.dogfight.noseOff(q, f.x, f.y, f.z) * 57.3).toFixed(1) + ' deg off the nose' + (q.foe === f ? '' : ' (snapshot)') };
      }
      return null;
    };
  }, [SEED, KINDS]);
  let shotN = 0;
  const snap = async (tag) => {
    await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none'; const cp = document.querySelector('.caption'); if (cp) cp.style.visibility = 'hidden'; });
    const file = `gun${KINDS ? '_' + KINDS.join('') : ''}_${tag}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  shot tests/shots/planes/' + file);
  };
  for (let k = 0; k < COUNT; k++) {
    // look for the next burst: step the sim in small slices (no render) until one is found, then hold the scene
    const desc = await p.evaluate((k) => {
      __render = false;
      for (let i = 0; i < 4000; i++) { const r = __findShot(); if (r && (!window.__last || r.q !== window.__last)) { window.__s = r; window.__last = r.q; return r.desc + ' t ' + WW.game.roundTime.toFixed(1); } __sim.fastForward(0.05); if (k === 0 && WW.game.roundTime < 60) __sim.fastForward(0.5); }
      return null;
    }, k);
    console.log(`[gun ${k}] ${desc}`);
    if (!desc) break;
    for (const view of ['behind', 'side']) {
      await p.evaluate((view) => {
        const s = window.__s;
        window.__lookFn = () => {
          const q = s.q, f = s.f.alive ? s.f : q, h = q.heading;
          if (view === 'behind') return { x: q.x - Math.cos(h) * 12 + Math.cos(h + 1.57) * 3, y: q.y + 3.5, z: q.z - Math.sin(h) * 12 + Math.sin(h + 1.57) * 3, tx: f.x, ty: f.y, tz: f.z };
          const m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }, a = Math.atan2(f.z - q.z, f.x - q.x) + 1.57;
          return { x: m.x + Math.cos(a) * 30, y: m.y + 5, z: m.z + Math.sin(a) * 30, tx: m.x, ty: m.y, tz: m.z };
        };
      }, view);
      for (let i = 0; i < 2; i++) { await snap(`${shotN}_${view}_${i}`); await p.evaluate(() => { __render = false; __step(2); }); }
    }
    shotN++;
    await p.evaluate(() => { window.__lookFn = null; });
  }
  if (errs.length) console.log('errors: ' + errs.slice(0, 5).join(' | '));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
