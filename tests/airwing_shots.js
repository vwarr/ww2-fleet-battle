// Air wing / flight ops screenshots (render mode, software GL, fake frame clock as tests/flight_shots.js): the deck
// spotted for launch, a deck-load strike forming up and rolling out, the marshal stack astern, the recovery park.
// A seeded carrier duel (one carrier and two destroyers a side) with the full air group (?wing=K, default 1).
// Writes tests/shots/airwing/*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/airwing_shots.js [seed=2] [scenes] [wing=1]
//   scenes: comma list of deck,forming,marshal,park (default all)
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'airwing');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 2), WHICH = (process.argv[3] || 'deck,forming,marshal,park').split(','), WING = process.argv[4] || '1';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8780/') + 'index.html?auto&wing=' + WING);
  await p.waitForTimeout(1500);
  await p.evaluate((seed) => {
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
    // eye in the carrier's frame: along (+ bow) / across (+ starboard) / up, looking at a carrier-local point
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
  }, SEED);
  let n = 0;
  const snap = async (tag) => {
    const info = await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none';
      const cp = document.querySelector('.caption'); if (cp) cp.style.visibility = 'hidden'; return 't=' + WW.game.roundTime.toFixed(1); });
    const file = `${String(n++).padStart(2, '0')}_${tag.replace(/[^a-z0-9]+/gi, '_')}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  shot tests/shots/airwing/' + file + '  ' + info);
  };
  const frames = (k) => p.evaluate((k) => { __render = false; __step(k); }, k);
  const say = (s) => console.log(s);

  if (WHICH.includes('deck')) { // the deck spotted for the first strike: one load aft of the spot line, wings folded
    say('[deck] ' + await p.evaluate(() => {
      const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN');
      until(() => cv._deck && cv._deck.mode === 'idle' && WW.game.roundTime > 15 && cv._deck.cols.reduce((s, c) => s + c.e.filter(e => e.ph === 'park').length, 0) >= WW.airDeck.spotCap(cv), 60);
      window.__cv = cv; window.__lookFn = () => rel(cv, 40, 30, 26, -4, 0, 2);
      const D = cv._deck; return 'spotted ' + D.cols.reduce((s, c) => s + c.e.length, 0) + ' of hangar ' + JSON.stringify(cv.hangar) + ' (spotCap ' + WW.airDeck.spotCap(cv) + ')';
    }));
    await frames(2); await snap('deck_spotted');
    await p.evaluate(() => { const cv = __cv; window.__lookFn = () => rel(cv, -30, 0, 34, 0, 0, 2); }); await frames(1); await snap('deck_spotted_astern');
  }
  if (WHICH.includes('forming')) { // the first deck-load strike: launch run, form-up overhead, rolling out together
    say('[forming] ' + await p.evaluate(() => {
      const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN'); window.__cv = cv;
      const w = until(() => (WW.strike._waves() || []).find(w => w.carrier === cv && w.members.length >= 6 && !w.go), 200);
      if (!w) return 'no wave';
      window.__w = w; window.__lookFn = () => rel(cv, -60, 120, 70, 20, 0, 25);
      return 'wave members ' + w.members.length + ' of ' + w.n0 + ', t ' + WW.game.roundTime.toFixed(0);
    }));
    await frames(2); await snap('strike_launch_formup');
    say('  ' + await p.evaluate(() => { const w = __w; until(() => w.pendN <= 0 || w.go, 90); window.__lookFn = () => ({ x: w.x - Math.cos(w.h) * 140 + Math.sin(w.h) * 90, y: 85, z: w.z - Math.sin(w.h) * 140 - Math.cos(w.h) * 90, tx: w.x, ty: 30, tz: w.z }); return 'all up: ' + (w.pendN <= 0) + ', t ' + WW.game.roundTime.toFixed(0); }));
    await frames(2); await snap('strike_formed_overhead');
    say('  ' + await p.evaluate(() => { const w = __w; until(() => w.go, 90); until(() => WW.time.now - w.goT > 6, 10); window.__lookFn = () => ({ x: w.x + Math.sin(w.h) * 110 - Math.cos(w.h) * 40, y: 50, z: w.z - Math.cos(w.h) * 110 - Math.sin(w.h) * 40, tx: w.x - Math.cos(w.h) * 20, ty: 32, tz: w.z - Math.sin(w.h) * 20 }); return 'departed (' + w.why + '), members ' + w.members.filter(q => q.alive).length + ', t ' + WW.game.roundTime.toFixed(0); }));
    await frames(2); await snap('strike_departing_stack');
  }
  if (WHICH.includes('marshal')) { // returning planes stacked in the marshal racetrack astern, one in the groove
    say('[marshal] ' + await p.evaluate(() => {
      const r = until(() => WW.world.ships.find(s => s.alive && s._deck && s._deck.lq.length >= 4 && s._deck.lq.some(q => q.deckPh === 'final' || q.deckPh === 'app')), 300);
      if (!r) return 'none';
      window.__cv = r; const m = -(r.stats.length || 26) * WW.airDeck.MARSHAL_L; window.__lookFn = () => rel(r, m + 60, -150 * r._deck.s, 110, m + 5, 0, 22);
      return r.nation + ' carrier: ' + r._deck.lq.length + ' in the pattern (' + r._deck.lq.map(q => q.deckPh).join(',') + '), t ' + WW.game.roundTime.toFixed(0);
    }));
    await frames(2); await snap('marshal_stack_astern');
  }
  if (WHICH.includes('park')) { // the recovery park: trapped planes taxied forward of the barrier, wings folded
    say('[park] ' + await p.evaluate(() => {
      const r = until(() => WW.world.ships.find(s => s.alive && s._deck && s._deck.mode === 'recover' && s._deck.cols.reduce((n, c) => n + c.e.filter(e => e.ph === 'park' || e.ph === 'in').length, 0) >= 5), 300);
      if (!r) return 'none';
      window.__cv = r; window.__lookFn = () => rel(r, 34, -28, 22, 4, 0, 2);
      return r.nation + ' carrier deck ' + r._deck.mode + ', parked ' + r._deck.cols.reduce((n, c) => n + c.e.length, 0) + ', t ' + WW.game.roundTime.toFixed(0);
    }));
    await frames(2); await snap('recovery_park');
  }
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
