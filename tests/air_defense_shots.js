// Air defence screenshots (render mode, software GL, fake frame clock; set up as tests/flight_shots.js): a raid met
// far out by the CAP, the CAP on the torpedo planes, the marshal stack astern of a carrier, a task group under an
// air attack. Writes tests/shots/airdef/*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/air_defense_shots.js [seed=3] [far,vt,marshal,group]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'airdef');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3), WHICH = (process.argv[3] || 'far,vt,marshal,group').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8792/') + 'index.html?auto');
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
    window.eye = (o, d, a, h) => ({ x: o.x + Math.cos(a) * d, y: (o.y || 0) + h, z: o.z + Math.sin(a) * d, tx: o.x, ty: o.y || 0, tz: o.z });
    window.cvDist = q => { let d = 1e9; for (const s of WW.world.ships) if (s.alive && s.type === 'carrier' && !s.isBase && s.nation !== q.nation) d = Math.min(d, Math.hypot(q.x - s.x, q.z - s.z)); return d; };
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 - 75 }, { type: 'carrier', nation: n, x, z: H / 2 + 75 }, { type: 'battleship', nation: n, x: x + s * 50, z: H / 2 },
      { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 90 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 90 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 - 150 }];
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
    console.log('  shot tests/shots/airdef/' + file + '  ' + info);
  };
  const frames = (k) => p.evaluate((k) => { __render = false; __step(k); }, k);
  const seq = async (tag, count, gap) => { for (let i = 0; i < count; i++) { if (i) await frames(gap); await snap(tag + '_' + i); } };
  const find = async (name, findSrc, lookSrc, count, gap, maxSec) => {
    const r = await p.evaluate(([f, l, m]) => {
      const fd = new Function('return (' + f + ')')(), mk = new Function('return (' + l + ')')();
      const q = until(fd, m || 300);
      if (!q) return null;
      window.__subj = q; window.__lookFn = () => mk(window.__subj);
      return (q.desc || '') + ' t ' + WW.game.roundTime.toFixed(1);
    }, [findSrc.toString(), lookSrc.toString(), maxSec]);
    console.log(`[${name}] ` + r);
    if (r) await seq(name, count, gap);
    await p.evaluate(() => { window.__lookFn = null; });
  };
  // a CAP fighter on an armed raider still more than 200 from the carriers it is going for
  if (WHICH.includes('far')) await find('raid_met_far_out',
    () => { const q = WW.world.planes.find(f => f.alive && f.kind === 'fighter' && !f.target && f.foe && f.foe.alive && f.foe.ordnance && (f.foe.kind === 'dive' || f.foe.kind === 'torpedo') && cvDist(f.foe) > 200 && Math.hypot(f.x - f.foe.x, f.z - f.foe.z) < 60); return q ? { q, desc: q.nation + ' CAP on a ' + q.foe.kind + ' ' + cvDist(q.foe).toFixed(0) + ' from the carrier' } : null; },
    (s) => { const q = s.q, f = q.foe && q.foe.alive ? q.foe : q, m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }; return eye(m, 90, Math.atan2(f.z - q.z, f.x - q.x) + 1.9, 22); }, 3, 30);
  // a CAP fighter on a torpedo plane setting up or on its run
  if (WHICH.includes('vt')) await find('cap_on_torpedo_planes',
    () => { const q = WW.world.planes.find(f => f.alive && f.kind === 'fighter' && !f.target && f.foe && f.foe.alive && f.foe.kind === 'torpedo' && f.foe.ordnance && Math.hypot(f.x - f.foe.x, f.z - f.foe.z) < 45); return q ? { q, desc: q.nation + ' CAP on a torpedo plane (' + (q.foe.phase || q.foe.sk || q.foe.state) + ')' } : null; },
    (s) => { const q = s.q, f = q.foe && q.foe.alive ? q.foe : q, m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }; return eye(m, 55, Math.atan2(f.z - q.z, f.x - q.x) + 1.7, 10); }, 3, 20);
  // the marshal stack astern of a carrier
  if (WHICH.includes('marshal')) await find('marshal_stack',
    () => { const c = WW.world.ships.find(s => s.alive && s._deck && s._deck.lq.length >= 10); return c ? { c, desc: c.nation + ' carrier, ' + c._deck.lq.length + ' waiting, deck ' + c._deck.mode } : null; },
    (s) => { const c = s.c; return eye({ x: c.x - Math.cos(c.heading) * 90, y: 25, z: c.z - Math.sin(c.heading) * 90 }, 120, c.heading + 2.0, 55); }, 2, 90, 500);
  // a carrier task group under an air attack, from high up
  if (WHICH.includes('group')) await find('task_group_under_attack',
    () => { const c = WW.world.ships.find(s => s.alive && s.type === 'carrier' && WW.world.planes.some(q => q.alive && q.nation !== s.nation && q.ordnance && Math.hypot(q.x - s.x, q.z - s.z) < 110)); return c ? { c, desc: c.nation + ' carrier under attack' } : null; },
    (s) => { const c = s.c; return eye(c, 170, c.heading + 2.6, 230); }, 2, 60, 500);
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
