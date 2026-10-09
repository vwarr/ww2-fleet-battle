// Battle-shape screenshots (render mode, software GL, fake frame clock): a seeded random round on the big map.
// Scenes: the map view at the start, the dawn search plane finding the enemy, a PT picket in sight of an enemy
// ship, the air war while the fleets are still apart (a strike in transit + the map view), the fleets finally
// closing (the first ship-to-ship gunfire + the map view). Writes tests/shots/shape/*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/shape_shots.js [seed=6] [scenes]
//   scenes: comma list of mapstart,search,airwar,picket,closing (default all; each waits for its moment from where the
//   last left off, so run picket on its own when it comes before the air war)
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'shape');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 6), WHICH = (process.argv[3] || 'mapstart,search,picket,airwar,closing').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  const comp = await p.evaluate((seed) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) { // a scripted camera while __lookFn is set
      if (!window.__lookFn || WW.cam.mode === 'map') return camUpd(rdt);
      const L = __lookFn(); if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x, Math.max(L.y, 1.5), L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    // eye at distance d behind-ish o on bearing a, height h, looking at target t (default o)
    window.eye = (o, d, a, h, t) => ({ x: o.x + Math.cos(a) * d, y: (o.y || 0) + h, z: o.z + Math.sin(a) * d, tx: (t || o).x, ty: (t || o).y || 0, tz: (t || o).z });
    WW.seedRandom(seed); WW.time.now = 0; WW.game.mode = 'auto'; WW.game.composition = null; WW.dayNight.force = 'day'; WW.game.startRound();
    __sim.setScale(1);
    const c = {}; for (const s of WW.world.ships) c[s.nation + ' ' + s.type] = (c[s.nation + ' ' + s.type] || 0) + 1; return JSON.stringify(c);
  }, SEED);
  console.log('seed', SEED, comp);
  let n = 0;
  const snap = async (tag) => {
    const info = await p.evaluate(() => { __render = true; __step(1); __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none'; return 't=' + WW.game.roundTime.toFixed(1); });
    const file = `${String(n++).padStart(2, '0')}_${tag}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  shot tests/shots/shape/' + file + '  ' + info);
  };
  // the map view (plot_table.js) fades in and out over frames and a CSS transition: hold the sim (scale 0.01) meanwhile
  const map = async (tag) => {
    await p.evaluate(() => { window.__lookSaved = window.__lookFn; window.__lookFn = null; __sim.setScale(0.01); if (WW.cam.mode !== 'map') WW.cam.toggle(); __render = true; __step(75); }); // the scripted camera skips camera.js update (and the plot's)
    await p.waitForTimeout(2500);
    await snap(tag);
    await p.evaluate(() => { if (WW.cam.mode === 'map') WW.cam.toggle(); __render = true; __step(75); __sim.setScale(1); window.__lookFn = window.__lookSaved; });
    await p.waitForTimeout(2500); // the plot canvas fades out by a CSS transition: wall-clock time
  };
  const say = s => console.log(s);
  if (WHICH.includes('mapstart')) { await p.evaluate(() => until(() => WW.game.roundTime > 3, 10)); await map('map_start'); }
  if (WHICH.includes('search')) {
    say('[search] ' + await p.evaluate(() => {
      const fb = until(() => WW.world.planes.find(q => q.alive && q.kind === 'flyingboat' && q.shadowOf && q.shadowOf.alive), 120);
      if (!fb) return 'none';
      const t = fb.shadowOf; window.__lookFn = () => { const a = Math.atan2(fb.z - t.z, fb.x - t.x); return { x: fb.x + Math.cos(a) * 26 + Math.cos(a + 1.57) * 10, y: fb.y + 9, z: fb.z + Math.sin(a) * 26 + Math.sin(a + 1.57) * 10, tx: t.x, ty: 0, tz: t.z }; };
      return fb.nation + ' flying boat shadowing ' + t.nation + ' ' + t.type + ' at ' + WW.dist(fb.x, fb.z, t.x, t.z).toFixed(0) + ', t ' + WW.game.roundTime.toFixed(0);
    }));
    await snap('search_plane_finds_enemy');
  }
  if (WHICH.includes('airwar')) {
    say('[airwar] ' + await p.evaluate(() => {
      const big = () => WW.strike._waves().filter(w => !w.done && w.go && w.members.filter(m => m.alive && m.state === 'transit').length >= 6).sort((a, b) => b.members.length - a.members.length)[0];
      until(() => WW.game.roundTime > 45 && big(), 200);
      const w = big() || WW.strike._waves().filter(w => !w.done && w.go).sort((a, b) => b.members.length - a.members.length)[0];
      const L = w && (w.cag && w.cag.alive ? w.cag : w.members.find(m => m.alive));
      if (!L) { window.__lookFn = null; return 'no wave'; }
      window.__lookFn = () => { const h = L.heading; return { x: L.x - Math.cos(h) * 70 + Math.cos(h + 1.57) * 45, y: L.y + 22, z: L.z - Math.sin(h) * 70 + Math.sin(h + 1.57) * 45, tx: L.x + Math.cos(h) * 30, ty: L.y - 6, tz: L.z + Math.sin(h) * 30 }; };
      const F = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 }; let gd = 1e9; for (const a of WW.world.ships) for (const c of WW.world.ships) if (a.alive && c.alive && a.nation === 'USN' && c.nation === 'IJN' && F[a.type] && F[c.type]) gd = Math.min(gd, WW.dist(a.x, a.z, c.x, c.z));
      return w.nation + ' strike of ' + w.members.filter(m => m.alive).length + ' in transit, t ' + WW.game.roundTime.toFixed(0) + ', closest enemy ships ' + gd.toFixed(0) + ' apart';
    }));
    await snap('air_war_strike_in_transit');
    await map('air_war_map');
  }
  if (WHICH.includes('picket')) {
    say('[picket] ' + await p.evaluate(() => {
      let pair = null;
      until(() => { for (const s of WW.world.ships) if (s.alive && s.type === 'pt') for (const e of WW.world.ships) if (e.alive && e.nation !== s.nation && e.stats && !e.isBase && e.type !== 'pt' && e.type !== 'submarine' && WW.dist(s.x, s.z, e.x, e.z) < 135) { pair = [s, e]; return true; } return false; }, 300);
      if (!pair) return 'none';
      const [s, e] = pair; window.__lookFn = () => { const a = Math.atan2(s.z - e.z, s.x - e.x); return { x: s.x + Math.cos(a) * 22 + Math.cos(a - 1.2) * 8, y: 6, z: s.z + Math.sin(a) * 22 + Math.sin(a - 1.2) * 8, tx: e.x, ty: 2, tz: e.z }; };
      return s.nation + ' PT at ' + WW.dist(s.x, s.z, e.x, e.z).toFixed(0) + ' from ' + e.nation + ' ' + e.type + ', t ' + WW.game.roundTime.toFixed(0) + ', posture ' + WW.fleetCmd.side(s.nation).posture;
    }));
    await snap('pt_picket_spotting');
  }
  if (WHICH.includes('closing')) {
    say('[closing] ' + await p.evaluate(() => {
      window.__lookFn = null;
      until(() => WW.game.metT !== null && WW.game.metT !== undefined, 500);
      const F = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 }; let best = null, bd = 1e9; for (const a of WW.world.ships) for (const c of WW.world.ships) if (a.alive && c.alive && a.nation === 'USN' && c.nation === 'IJN' && F[a.type] && F[c.type]) { const d = WW.dist(a.x, a.z, c.x, c.z); if (d < bd) { bd = d; best = [a, c]; } }
      if (!best) return 'none';
      const [a, c] = best, m = { x: (a.x + c.x) / 2, y: 0, z: (a.z + c.z) / 2 }, h = Math.atan2(c.z - a.z, c.x - a.x);
      window.__lookFn = () => ({ x: m.x + Math.cos(h + 1.57) * (bd * 0.9 + 60), y: 45 + bd * 0.25, z: m.z + Math.sin(h + 1.57) * (bd * 0.9 + 60), tx: m.x, ty: 0, tz: m.z });
      return 'fleets met at ' + (WW.game.metT || 0).toFixed(0) + ' s: ' + a.type + ' / ' + c.type + ' ' + bd.toFixed(0) + ' apart';
    }));
    await p.evaluate(() => { __render = false; __step(90); });
    await snap('fleets_closing');
    await map('fleets_closing_map');
  }
  if (errs.length) console.log('ERRORS', errs.slice(0, 5));
  await b.close();
})();
