// Render-mode shots for the airend fixes: a seeded round set up as tests/air_endgame_shots.js (the sim_behaviour
// standard round), fast-forwarded until the moment the shot wants, then framed:
//   packet  an endgame strike packet on its way out (the side believes the enemy air spent: air_staff.js airSpent),
//           from behind and above the packet
//   marshal the carrier with the deepest landing queue, abeam of the stack (low) and from above
//   dusk    after the dusk recall (daylight below 0.5), the carrier still landing, from astern
// Writes tests/shots/airend/<kind>_<seed>_<t>_<view>.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/airend_shots.js KIND SEED [T0=0] [TMAX=900]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'airend');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const KIND = process.argv[2] || 'marshal', SEED = +(process.argv[3] || 9), T0 = +(process.argv[4] || 0), TMAX = +(process.argv[5] || 900);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8781/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  const info = await p.evaluate(([kind, seed, T0, TMAX]) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      if (!window.__look) return camUpd(rdt);
      const L = window.__look(); WW.camera.position.set(L.x, L.y, L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    const G = WW.game;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.dayNight) WW.dayNight.force = null; if (WW.weather) WW.weather.force = null;
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.noRetire = false; G.baseChoice = null; G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    __render = false;
    const deepest = () => { let c = null; for (const s of WW.world.ships) if (s.alive && s._deck && !s.isBase && (!c || s._deck.lq.length > c._deck.lq.length)) c = s; return c; };
    const packet = () => {   // an outbound strike of <= 12 bombers from a side that believes the enemy air spent
      for (const w of (WW.strike._waves ? WW.strike._waves() : [])) {
        if (!w.go || w.done || !w.carrier || !WW.staff.airSpent(w.carrier.nation)) continue;
        const B = w.members.filter(q => q.alive && q.ordnance && q.kind !== 'fighter' && q.state === 'transit');
        if (B.length >= 4 && B.length <= 12 && w.dT > 120) return { w, B };
      }
      return null;
    };
    let found = null;
    while (G.state === 'battle' && G.roundTime < TMAX) {
      __sim.fastForward(1);
      if (G.roundTime < T0) continue;
      if (kind === 'packet') { const k = packet(); if (k) { found = k; break; } }
      else if (kind === 'dusk') { const c = deepest(); if (WW.daylight < 0.5 && c && c._deck.lq.length >= 4 && c._deck.mode === 'recover') { found = c; break; } }
      else { const c = deepest(); if (c && c._deck.lq.length >= 10) { found = c; break; } }
    }
    if (!found) return 'nothing found by t=' + G.roundTime.toFixed(0);
    if (kind === 'packet') {
      const k = found; window.__w = k.w;
      window.__c = { get x() { let x = 0; for (const q of k.B) x += q.x; return x / k.B.length; }, get z() { let z = 0; for (const q of k.B) z += q.z; return z / k.B.length; }, get y() { let y = 0; for (const q of k.B) y += q.y; return y / k.B.length; }, get heading() { return k.w.h; } };
      return 't=' + G.roundTime.toFixed(0) + ' packet ' + k.w.carrier.nation + ' bombers ' + k.B.length + ' members ' + k.w.members.filter(q => q.alive).length + ' target ' + (k.w.target ? k.w.target.type : '-');
    }
    window.__c = found;
    const n = {}; for (const q of WW.world.planes) if (q.alive) n[q.nation] = (n[q.nation] || 0) + 1;
    return 't=' + G.roundTime.toFixed(0) + ' carrier ' + found.nation + ' ' + found.id + ' landing queue ' + found._deck.lq.length + ' mode ' + found._deck.mode + ' planes ' + JSON.stringify(n) + ' daylight ' + WW.daylight.toFixed(2);
  }, [KIND, SEED, T0, TMAX]);
  console.log(info);
  if (info.startsWith('nothing')) { await b.close(); return; }
  const t = (info.match(/t=(\d+)/) || [])[1];
  const shot = async (tag, lookSrc) => {
    await p.evaluate((src) => { const f = new Function('return (' + src + ')')(); window.__look = () => f(window.__c); __render = false; __step(2); __render = true; __step(1);
      const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none'; }, lookSrc.toString());
    const f = path.join(OUT, `${KIND}_${SEED}_${t}_${tag}.png`); await p.screenshot({ path: f, timeout: 180000 }); console.log('  ' + f);
  };
  if (KIND === 'packet') {
    await shot('behind', c => { const h = c.heading; return { x: c.x - Math.cos(h) * 70, y: c.y + 22, z: c.z - Math.sin(h) * 70, tx: c.x + Math.cos(h) * 20, ty: c.y, tz: c.z + Math.sin(h) * 20 }; });
    await shot('abeam', c => { const n = c.heading + Math.PI / 2; return { x: c.x + Math.cos(n) * 90, y: c.y + 10, z: c.z + Math.sin(n) * 90, tx: c.x, ty: c.y, tz: c.z }; });
  } else if (KIND === 'dusk') {
    await shot('astern', c => { const L = 26, h = c.heading; return { x: c.x - Math.cos(h) * 7 * L, y: 30, z: c.z - Math.sin(h) * 7 * L, tx: c.x, ty: 5, tz: c.z }; });
    await shot('above', c => { const L = 26, ax = c.x - Math.cos(c.heading) * 4 * L, az = c.z - Math.sin(c.heading) * 4 * L, n = c.heading + 2.4;
      return { x: ax + Math.cos(n) * 240, y: 180, z: az + Math.sin(n) * 240, tx: ax, ty: 15, tz: az }; });
  } else {
    await shot('side', c => { const L = 26, ax = c.x - Math.cos(c.heading) * 6 * L, az = c.z - Math.sin(c.heading) * 6 * L, n = c.heading + Math.PI / 2;
      return { x: ax + Math.cos(n) * 170, y: 22, z: az + Math.sin(n) * 170, tx: ax, ty: 30, tz: az }; });
    await shot('above', c => { const L = 26, ax = c.x - Math.cos(c.heading) * 5 * L, az = c.z - Math.sin(c.heading) * 5 * L, n = c.heading + 2.4;
      return { x: ax + Math.cos(n) * 260, y: 200, z: az + Math.sin(n) * 260, tx: ax, ty: 20, tz: az }; });
  }
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
