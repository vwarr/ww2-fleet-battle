// Deck respot frames (render mode, software GL, fake frame clock as tests/airwing_shots.js): one carrier's flight
// deck seen from abeam through a launch -> recovery -> launch cycle, a frame every STEP s of game time, the deck mode
// and the parked planes moving in each frame logged. A seeded carrier duel (one carrier and two destroyers a side).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/deck_respot_shots.js OUTDIR [seed=2] [nation=USN] [step=0.75] [n=14]
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'shots', 'deck_respot');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[3] || 2), NAT = process.argv[4] || 'USN', STEP = +(process.argv[5] || 0.75), N = +(process.argv[6] || 14);
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8825/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate(([seed, nat]) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      if (!window.__lookFn) return camUpd(rdt);
      const L = __lookFn(); if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x, Math.max(L.y, 1.5), L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    window.rel = (c, a, s, h, ta, ts, th) => {
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading), w = (u, v) => [c.x + ch * u - sh * v, c.z + sh * u + ch * v];
      const e = w(a, s), t = w(ta || 0, ts || 0);
      return { x: e[0], y: h, z: e[1], tx: t[0], ty: th || 2, tz: t[1] };
    };
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    if (WW.dayNight) WW.dayNight.force = 'day';
    const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 }, { type: 'destroyer', nation: n, x: x + s * 50, z: H / 2 - 50 }, { type: 'destroyer', nation: n, x: x + s * 50, z: H / 2 + 50 }];
    G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    __sim.setScale(1);
    const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === nat); window.__cv = cv;
    window.__lookFn = () => rel(cv, -1, -cv._deck.s * 19, 15, -1, 0, 1);
    window.__prev = new Map();
    window.__info = () => {
      const D = cv._deck; let mov = 0, n = 0;
      for (const col of D.cols) for (const e of col.e) { n++; const o = __prev.get(e); if (e.ph === 'park' && o !== undefined && Math.abs(o - e.lx) > 1e-3) mov++; }
      __prev = new Map(); for (const col of D.cols) for (const e of col.e) __prev.set(e, e.lx);
      return `t=${WW.game.roundTime.toFixed(1)} mode=${D.mode}${D.spot ? ' spot=' + D.spot : ''} parked=${n} pushedSinceLast=${mov} lq=${D.lq.length} launchers=${D.launchers.length}`;
    };
  }, [SEED, NAT]);
  let k = 0;
  const snap = async (tag) => {
    const info = await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none';
      const cp = document.querySelector('.caption'); if (cp) cp.style.visibility = 'hidden'; return __info(); });
    const file = `${String(k++).padStart(2, '0')}_${tag}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  ' + file + '  ' + info);
  };
  const adv = (s) => p.evaluate((s) => { __render = false; until(() => false, s); }, s);
  const phase = async (tag, cond, max) => { console.log('[' + tag + '] ' + await p.evaluate(([c, m]) => { const cv = __cv; const r = until(() => cv._deck && eval(c), m); return 'reached ' + !!r + ' at t=' + WW.game.roundTime.toFixed(1); }, [cond, max])); for (let i = 0; i < N; i++) { await snap(tag); await adv(STEP); } };
  // a launch with a full deck spotted, then the switch to a recovery, then back to a launch
  await phase('launch', "cv._deck.mode === 'launch' && WW.game.roundTime > 20", 400);
  await phase('recover', "cv._deck.mode === 'recover' && cv._deck.cols.some(c => c.e.length >= 2)", 600);
  await phase('relaunch', "cv._deck.mode !== 'recover'", 600);
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
