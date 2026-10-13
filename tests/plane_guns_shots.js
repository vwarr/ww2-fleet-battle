// Close-ups of the planes' guns on ships and on fighters (render mode, software GL), same fake frame clock as
// tests/gun_shots.js. Modes:
//   strafe: a fighter on a strafing run (air_strafe.js) at a PT boat, inside its firing range (tracers, the walking
//           splashes, the hits on the deck); an IJN carrier group with USN PT boats inside its CAP's strafing reach.
//   gunner: a bomber's rear gunner firing at a fighter on its tail (air_gunners.js), carrier-vs-carrier battle.
//   fwd:    a bomber's forward guns: a TBD on its run-in, or an SBD's strafe after its pull-out (air_gunners.js).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/plane_guns_shots.js [mode=strafe] [seed=3] [count=3]
// Output: tests/shots/plane_guns/<mode>_<n>_<view>_<frame>.png
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'plane_guns');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const MODE = process.argv[2] || 'strafe', SEED = +(process.argv[3] || 3), COUNT = +(process.argv[4] || 3);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8122/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate(([seed, mode]) => {
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
    if (mode === 'strafe') {   // USN PT boats ~150 off an IJN carrier group: its CAP goes down on them
      const x = W / 2 + 120;
      G.composition = [{ type: 'carrier', nation: 'IJN', x, z: H / 2 }, { type: 'cruiser', nation: 'IJN', x: x + 40, z: H / 2 + 40 },
        { type: 'pt', nation: 'USN', x: x - 150, z: H / 2 - 20 }, { type: 'pt', nation: 'USN', x: x - 160, z: H / 2 + 20 }, { type: 'pt', nation: 'USN', x: x - 140, z: H / 2 + 50 },
        { type: 'battleship', nation: 'USN', x: 60, z: H / 2 }];
    } else G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)];
    G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    __sim.setScale(1);
    const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    window.__find = () => {
      for (const q of WW.world.planes) {
        if (!q.alive) continue;
        if (mode === 'strafe') {
          const u = q.strafe, S = q.sf;
          if (!u || !S || S.ph !== 'run' || !u.alive || !(S.fT > 0.25)) continue;   // a burst just fired
          const d = Math.hypot(u.x - q.x, u.z - q.z); if (d > 36 || d < 14 || q.y > 22) continue;   // low, on the run proper
          return { q, f: u, desc: q.nation + ' ' + q.kind + ' strafing a ' + u.nation + ' ' + u.type + ' ' + d.toFixed(0) + ' ahead' };
        }
        const gs = q.gnr;
        if (mode === 'gunner' && gs && gs.at && gs.at.alive && gs.fireT > 0.15 && d3(q, gs.at) > 8) return { q, f: gs.at, rear: true, desc: q.nation + ' ' + q.kind + ' rear gunner on a ' + gs.at.nation + ' fighter ' + d3(q, gs.at).toFixed(0) + ' behind' };
        if (mode === 'fwd' && gs && gs.fwdAt && gs.fwdT > 0.15) return { q, f: gs.fwdAt, desc: q.nation + ' ' + q.kind + ' forward guns on a ' + gs.fwdAt.type + ' ' + Math.hypot(gs.fwdAt.x - q.x, gs.fwdAt.z - q.z).toFixed(0) + ' ahead' };
      }
      return null;
    };
  }, [SEED, MODE]);
  let shotN = 0;
  const snap = async (tag) => {
    await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none'; const cp = document.querySelector('.caption'); if (cp) cp.style.visibility = 'hidden'; });
    const file = `${MODE}_${SEED}_${tag}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    const live = await p.evaluate(() => { const q = window.__s.q, c = WW.camera.position; return WW.planeTracers.T.seg.filter(s => s.life > 0).length + ' scale ' + WW.time.scale + ' plane ' + [q.x, q.y, q.z].map(v => v.toFixed(0)) + ' alive ' + q.alive + ' cam ' + [c.x, c.y, c.z].map(v => v.toFixed(0)); });
    console.log('  shot ' + path.join(OUT, file) + '  (tracer rounds in the air: ' + live + ')');
  };
  for (let k = 0; k < COUNT; k++) {
    const desc = await p.evaluate(() => {
      __render = false;
      for (let i = 0; i < 12000; i++) { const r = __find(); if (r && (!window.__last || r.q !== window.__last)) { window.__s = r; window.__last = r.q; return r.desc + ' t ' + WW.game.roundTime.toFixed(1); } __sim.fastForward(0.05); }
      return null;
    });
    console.log(`[${MODE} ${k}] ${desc}`);
    if (!desc) break;
    for (const view of ['behind', 'side']) {
      await p.evaluate((view) => {
        const s = window.__s;
        window.__lookFn = () => {
          const q = s.q, f = s.f.alive ? s.f : q, h = q.heading, f0 = { x: f.x, y: f.y || 0.5, z: f.z };
          if (view === 'behind' && s.rear) return { x: q.x + Math.cos(h) * 5 + Math.cos(h + 1.57) * 8, y: q.y + 4, z: q.z + Math.sin(h) * 5 + Math.sin(h + 1.57) * 8, tx: f0.x, ty: f0.y, tz: f0.z }; // over the bomber's nose, back at the fighter
          if (view === 'behind') return { x: q.x - Math.cos(h) * 24 + Math.cos(h + 1.57) * 5, y: q.y + 7, z: q.z - Math.sin(h) * 24 + Math.sin(h + 1.57) * 5, tx: f0.x, ty: f0.y, tz: f0.z };
          const m = { x: (q.x + f0.x) / 2, y: (q.y + f0.y) / 2, z: (q.z + f0.z) / 2 }, a = Math.atan2(f0.z - q.z, f0.x - q.x) + 1.57;
          return { x: m.x + Math.cos(a) * 34, y: m.y + 6, z: m.z + Math.sin(a) * 34, tx: m.x, ty: m.y, tz: m.z };
        };
      }, view);
      for (let i = 0; i < 2; i++) { await snap(`${shotN}_${view}_${i}`); await p.evaluate(() => { __render = false; __step(3); }); }
    }
    shotN++;
    await p.evaluate(() => { window.__lookFn = null; });
  }
  if (errs.length) console.log('errors: ' + errs.slice(0, 5).join(' | '));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
