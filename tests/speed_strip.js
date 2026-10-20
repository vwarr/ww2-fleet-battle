// Speed VQA strips (speedcal): headless render mode on a fake 60 fps frame clock at REAL 1x timing (no slow motion),
// each shot in a fresh seeded round. The camera stands still beside the subject's path and turns to follow it, so the
// motion reads against the sea and the ships: a torpedo plane's run, drop and then its torpedo running, a dive, a
// fighter pass, a deck take-off, a destroyer at speed. A frame is saved every EVERY real seconds: OUT/<shot>_<i>.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/speed_strip.js OUT [shots=torp,dive,ots,takeoff,ship] [n=8] [every=0.5] [seed=2]
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2], WHICH = (process.argv[3] || 'torp,dive,ots,takeoff,ship').split(','), N = +(process.argv[4] || 8), EVERY = +(process.argv[5] || 0.5), SEED = +(process.argv[6] || 2);
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 60; WW.time.warp = 1; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto', { timeout: 180000 });
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .caption, #aar, .aar { visibility: hidden !important; }' });
  await p.evaluate(() => {
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    window.__render = false; const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };   // draw only the frames we keep (software GL)
    __step(5);
    if (WW.camAction) WW.camAction.slowmo = () => 0;   // real 1x timing
    // the fixed camera: __fix = { x, y, z } stands still and looks at __subj (a plane, ship or projectile)
    const upd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const F = window.__fix, q = window.__subj; if (!F || !q) return upd(rdt);
      const y = q.y !== undefined ? q.y : 0;
      WW.camera.position.set(F.x, F.y, F.z); WW.camera.lookAt(q.x, Math.max(0, y), q.z); WW.camera.updateMatrixWorld();
    };
    WW.on('weaponDropped', e => { if (e && e.plane && e.plane === window.__subj && e.kind === 'torpedo' && e.proj) window.__subj = e.proj; });
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    // stand off the subject's path: `side` u to its right, `ahead` u along its heading, at height h
    window.beside = (q, side, ahead, h) => { const c = Math.cos(q.heading || 0), s = Math.sin(q.heading || 0); return { x: q.x + c * ahead - s * side, y: h, z: q.z + s * ahead + c * side }; };
  });
  const fresh = seed => p.evaluate(seed => { window.__fix = null; window.__subj = null; WW.seedRandom(seed); WW.time.now = 0; WW.game.mode = 'auto'; WW.game.composition = null; WW.game.startRound(); __sim.setScale(1); }, seed);
  const scen = {
    torp: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'torpedo' && q.ordnance && q.state === 'attack' && q.phase === 'run' && q.y < 5 && q.target && q.hd(q.target) > 50), 900);
      if (!q) return null; window.__subj = q; window.__fix = beside(q, 14, 30, 3); return 'torpedo plane on the run ' + q.nation + ' (' + q.hd(q.target).toFixed(0) + ' u out)';
    },
    dive: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'dive' && !q.level && q.state === 'attack' && q.ordnance && q.phase === 'roll'), 900);
      if (!q) return null; window.__subj = q; const t = q.diveTgt || q.target; window.__fix = t ? { x: t.x + 40, y: 6, z: t.z + 40 } : beside(q, 40, 20, q.y); return 'dive bomber ' + q.nation + ' from ' + q.y.toFixed(0);
    },
    ots: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.state === 'attack' && q.foe && q.foe.alive && q.hd(q.foe) < 30), 500);
      if (!q) return null; window.__subj = q; window.__fix = beside(q, 18, 45, q.y + 2); return 'fighter ' + q.nation + ' on a ' + q.foe.kind;
    },
    takeoff: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.state === 'takeoff' && q.carrier && !q.carrier.isBase && q.deckPh === 'run' && q.lx < 4), 400);
      if (!q) return null; window.__subj = q; window.__fix = beside(q.carrier, 30, 22, 6); return 'deck take-off ' + q.kind + ' ' + q.nation;
    },
    ship: () => {
      const q = until(() => WW.world.ships.find(s => s.alive && s.type === 'destroyer' && s.speed > 0.9 * s.stats.speed), 300);
      if (!q) return null; window.__subj = q; window.__fix = beside(q, 35, 40, 5); return 'destroyer at ' + q.speed.toFixed(1) + ' u/s';
    }
  };
  for (const name of WHICH) {
    await fresh(SEED);
    const r = await p.evaluate(`(${scen[name].toString()})()`);
    console.log(`[${name}] ${r || 'none found'}`);
    if (!r) continue;
    const k = Math.round(EVERY * 60);
    for (let i = 0; i < N; i++) {
      await p.evaluate(k => { __step(k - 1); __render = true; __step(1); __render = false; }, i ? k : 2);
      await p.screenshot({ path: `${OUT}/${name}_${i}.png`, timeout: 180000 });
    }
  }
  console.log('errors', errs.length, errs.slice(0, 3).join(' / '));
  await b.close();
})();
