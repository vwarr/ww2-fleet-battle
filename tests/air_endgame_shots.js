// Render-mode shots of the air endgame's marshal stacks (diagnosis): a seeded standard round set up exactly as
// sim_behaviour.js runs it (so the same round as tests/air_endgame.js), fast-forwarded to time T, then the carrier
// with the deepest landing queue from the side (abeam, low) and from above. Writes tests/shots/airdiag/render_*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/air_endgame_shots.js [seed=9] [T=376] [scen=standard]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'airdiag');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 9), T = +(process.argv[3] || 376), SCEN = process.argv[4] || 'standard';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8787/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  const info = await p.evaluate(([seed, T, scen]) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      if (!window.__look) return camUpd(rdt);
      const L = window.__look(); WW.camera.position.set(L.x, L.y, L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    const G = WW.game;
    // as tests/sim_behaviour.js B.run (random composition, no swap)
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.dayNight) WW.dayNight.force = null; if (WW.weather) WW.weather.force = null;
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.noRetire = false; G.baseChoice = null; G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    __render = false;
    while (G.state === 'battle' && G.roundTime < T) __sim.fastForward(1);
    let c = null; for (const s of WW.world.ships) if (s.alive && s._deck && !s.isBase && (!c || s._deck.lq.length > c._deck.lq.length)) c = s;
    window.__c = c;
    const n = {}; for (const q of WW.world.planes) if (q.alive) n[q.nation] = (n[q.nation] || 0) + 1;
    return 't=' + G.roundTime.toFixed(0) + ' carrier ' + c.nation + ' ' + c.id + ' landing queue ' + c._deck.lq.length + ' mode ' + c._deck.mode + ' planes ' + JSON.stringify(n) + ' daylight ' + WW.daylight.toFixed(2);
  }, [SEED, T, SCEN]);
  console.log(info);
  const shot = async (tag, lookSrc) => {
    await p.evaluate((src) => { const f = new Function('return (' + src + ')')(); window.__look = () => f(window.__c); __render = false; __step(2); __render = true; __step(1);
      const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none'; }, lookSrc.toString());
    const f = path.join(OUT, `render_${SCEN}_${SEED}_${T}_${tag}.png`); await p.screenshot({ path: f, timeout: 180000 }); console.log('  ' + f);
  };
  // abeam of the stack (4-9.5 hull lengths astern), low, looking across it
  await shot('side', c => { const L = 26, ax = c.x - Math.cos(c.heading) * 6 * L, az = c.z - Math.sin(c.heading) * 6 * L, n = c.heading + Math.PI / 2;
    return { x: ax + Math.cos(n) * 170, y: 22, z: az + Math.sin(n) * 170, tx: ax, ty: 38, tz: az }; });
  // from above and astern quarter
  await shot('above', c => { const L = 26, ax = c.x - Math.cos(c.heading) * 5 * L, az = c.z - Math.sin(c.heading) * 5 * L, n = c.heading + 2.4;
    return { x: ax + Math.cos(n) * 260, y: 200, z: az + Math.sin(n) * 260, tx: ax, ty: 20, tz: az }; });
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
