// Flight review screenshots (render mode, software GL): what the air war looks like. A seeded carrier battle (two
// carriers a side, a battleship, a cruiser and a destroyer each), run with a fake frame clock so frames are stepped
// deterministically. Scenes: opening wide, CAP orbit, landing circle, a strike followed by the story camera (one
// frame ~2 s into each story shot), CAP intercept, dogfight, dive-bombing run and torpedo run (short frame
// sequences from a fixed or tracking camera), escorted strike in transit. Writes tests/shots/flight/*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/flight_shots.js [seed=3] [scenes]
//   scenes: comma list of opening,cap,circle,story,intercept,dogfight,dive,torp,escort (default all), and on request
//   stack,picket,sweep,sbd,d3a,anvil (air tactics: stacked strike, picket CAP far out, sweep vs CAP, nation dives, anvil)
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'flight');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3), WHICH = (process.argv[3] || 'opening,cap,circle,story,intercept,dogfight,dive,torp,escort').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8775/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate((seed) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) { // a scripted camera while __lookFn is set: { x, y, z } eye and { tx, ty, tz } target
      if (!window.__lookFn) return camUpd(rdt);
      const L = __lookFn(); if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x, Math.max(L.y, 1.5), L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    // eye at distance d from target point o, on bearing a (rad, world), height h above o
    window.eye = (o, d, a, h) => ({ x: o.x + Math.cos(a) * d, y: (o.y || 0) + h, z: o.z + Math.sin(a) * d, tx: o.x, ty: o.y || 0, tz: o.z });
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 - 60 }, { type: 'carrier', nation: n, x, z: H / 2 + 60 }, { type: 'battleship', nation: n, x: x + s * 50, z: H / 2 },
      { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 90 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 90 }];
    G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    __sim.setScale(1);
  }, SEED);
  let n = 0;
  const snap = async (tag) => {
    const info = await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none';
      const cp = document.querySelector('.caption'); if (cp) cp.style.visibility = window.__lookFn ? 'hidden' : 'visible'; return 't=' + WW.game.roundTime.toFixed(1); });
    const file = `${String(n++).padStart(2, '0')}_${tag.replace(/[^a-z0-9]+/gi, '_')}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  shot tests/shots/flight/' + file + '  ' + info);
  };
  const frames = (k) => p.evaluate((k) => { __render = false; __step(k); }, k);   // k frames: 1/60 sim s each at scale 1
  const seq = async (tag, count, gap) => { for (let i = 0; i < count; i++) { if (i) await frames(gap); await snap(tag + '_' + i); } };
  const say = (s) => console.log(s);

  if (WHICH.includes('opening')) {
    say('[opening] ' + await p.evaluate(() => { until(() => WW.game.roundTime > 40, 60); const c = { x: WW.cfg.MAP_W / 2, y: 0, z: WW.cfg.MAP_H / 2 }; window.__lookFn = () => ({ x: c.x - 40, y: 520, z: c.z + 470, tx: c.x, ty: 0, tz: c.z }); return 'planes up ' + WW.world.planes.filter(q => q.alive && q.y > 4).length; }));
    await frames(2); await snap('opening_wide');
  }
  if (WHICH.includes('cap')) {
    say('[cap] ' + await p.evaluate(() => {
      const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN');
      until(() => WW.world.planes.filter(q => q.alive && q.carrier === cv && q.kind === 'fighter' && !q.target && q.state === 'transit').length >= 2, 60);
      window.__lookFn = () => eye(cv, 110, cv.heading + 2.2, 55);
      return 't ' + WW.game.roundTime.toFixed(0);
    }));
    await seq('cap_orbit', 3, 60);
  }
  if (WHICH.includes('circle')) {
    say('[circle] ' + await p.evaluate(() => {
      const r = until(() => WW.world.ships.find(s => s.alive && s._deck && s._deck.lq.length >= 4), 260);
      if (!r) return 'none';
      window.__lookFn = () => eye(r, 150, r.heading + 2.6, 85);
      return r.nation + ' carrier: ' + r._deck.lq.length + ' waiting to land, t ' + WW.game.roundTime.toFixed(0) + ', deck ' + r._deck.mode + ', queued to launch ' + r._deck.launchers.length;
    }));
    await seq('landing_circle', 3, 90);
    await p.evaluate(() => { window.__lookFn = null; });
  }
  if (WHICH.includes('story')) {
    // restart the round so the first strike is filmed from its launch
    const lead = await p.evaluate((seed) => {
      window.__lookFn = null; const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0; if (WW.aces) WW.aces.reset();
      const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 - 60 }, { type: 'carrier', nation: n, x, z: H / 2 + 60 }, { type: 'battleship', nation: n, x: x + s * 50, z: H / 2 },
        { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 90 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 90 }];
      G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]; G.startRound({ keepMap: true }); G.composition = null;
      const L = until(() => WW.world.planes.find(q => q.alive && q.nation === 'USN' && (q.kind === 'dive' || q.kind === 'torpedo') && q.target && q.state === 'takeoff' && q.wing === 0), 200);
      if (!L) return null;
      WW.camStory.start(L, 'strike'); __step(2); __sim.setScale(2);
      return L.kind + ' ' + (L.squadron && L.squadron.short) + ' t ' + WW.game.roundTime.toFixed(0);
    }, SEED);
    say('[story] protagonist ' + lead);
    if (lead) {
      let cur = null, since = 0, taken = false, shots = 0;
      for (let fr = 0; fr < 170 * 30 && shots < 14; fr += 6) {
        await p.evaluate(() => { __render = false; __step(6); });
        const tag = await p.evaluate(() => { const s = WW.cam._shot(); const d = WW.camStory._dbg && WW.camStory._dbg(); return (d && d.phase || 'dir') + '_' + (s ? (s.sk || s.kind) : '-'); });
        if (tag !== cur) { cur = tag; since = 0; taken = false; } else since += 0.2;
        if (!taken && since >= 2) { taken = true; shots++; await snap('story_' + tag); }
        if (!(await p.evaluate(() => WW.camStory.active()))) break;
      }
      say('  story log: ' + (await p.evaluate(() => WW.camStory.log.map(e => e.start ? 'START' : e.end ? 'END' : e.fall ? 'FALL' : e.handoff ? 'HANDOFF' : e.sk + '/' + e.phase + ' ' + e.dur + 's').join(' > '))));
      await p.evaluate(() => { WW.camStory.stop(); __sim.setScale(1); });
    }
  }
  const pairFind = async (name, findSrc, lookSrc, count, gap, maxSec) => {
    const r = await p.evaluate(([f, l, m]) => {
      const find = new Function('return (' + f + ')')(), mk = new Function('return (' + l + ')')();
      const q = until(find, m || 200);
      if (!q) return null;
      window.__subj = q; window.__lookFn = () => mk(window.__subj);
      return (q.desc || '') + ' t ' + WW.game.roundTime.toFixed(1);
    }, [findSrc.toString(), lookSrc.toString(), maxSec]);
    say(`[${name}] ` + r);
    if (r) await seq(name, count, gap);
    await p.evaluate(() => { window.__lookFn = null; });
  };
  if (WHICH.includes('intercept')) await pairFind('intercept',
    () => { const q = WW.world.planes.find(f => f.alive && f.kind === 'fighter' && !f.target && f.foe && f.foe.alive && f.foe.kind !== 'fighter' && f.foe.ordnance && Math.hypot(f.x - f.foe.x, f.z - f.foe.z) < 70); return q ? { q, desc: q.nation + ' CAP on ' + q.foe.kind + ' ' + q.foe.state + ' d ' + Math.hypot(q.x - q.foe.x, q.z - q.foe.z).toFixed(0) } : null; },
    (s) => { const q = s.q, f = q.foe && q.foe.alive ? q.foe : q, m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }; return eye(m, 75, Math.atan2(f.z - q.z, f.x - q.x) + 1.9, 18); }, 4, 30);
  if (WHICH.includes('dogfight')) await pairFind('dogfight',
    () => { const q = WW.world.planes.find(f => f.alive && f.kind === 'fighter' && f.foe && f.foe.alive && f.foe.kind === 'fighter' && Math.hypot(f.x - f.foe.x, f.z - f.foe.z) < 50); return q ? { q, desc: q.nation + ' ' + (q.target ? 'escort' : 'CAP') + ' vs fighter, mode ' + (q.df && q.df.mode) } : null; },
    (s) => { const q = s.q, f = q.foe && q.foe.alive ? q.foe : q, m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }; return eye(m, 60, Math.atan2(f.z - q.z, f.x - q.x) + 1.7, 12); }, 5, 20, 300);
  if (WHICH.includes('dive')) await pairFind('dive',
    () => { const q = WW.world.planes.find(d => d.alive && d.kind === 'dive' && d.phase === 'roll' && d.diveTgt); if (!q) return null; const t = q.diveTgt; return { q, t, a: Math.atan2(t.z - q.z, t.x - q.x) + Math.PI / 2, desc: q.nation + ' dive bomber pushes over at y ' + q.y.toFixed(0) + ' on a ' + t.type }; },
    (s) => { const t = s.t, q = s.q, m = { x: (q.x + t.x) / 2, y: 18, z: (q.z + t.z) / 2 }; return eye(m, 85, s.a, 4); }, 6, 12, 300);
  if (WHICH.includes('torp')) await pairFind('torp',
    () => { const q = WW.world.planes.find(d => d.alive && d.kind === 'torpedo' && d.phase === 'run' && d.target); if (!q) return null; const t = q.target; return { q, t, a: Math.atan2(t.z - q.z, t.x - q.x) + 1.35, desc: q.nation + ' torpedo run on a ' + t.type + ' d ' + Math.hypot(q.x - t.x, q.z - t.z).toFixed(0) }; },
    (s) => { const t = s.t, q = s.q, m = { x: (q.x + t.x) / 2, y: 2, z: (q.z + t.z) / 2 }; return eye(m, 70, s.a, 9); }, 5, 30, 300);
  if (WHICH.includes('escort')) await pairFind('escort',
    () => { const w = WW.strike._waves().find(w => w.go && !w.done && w.dT > 150 && w.members.filter(m => m.alive && m.sk === 'form').length >= 5 && w.members.some(m => m.alive && m.kind === 'fighter' && m.sk === 'form')); return w ? { w, desc: w.nation + ' strike in transit, ' + w.members.filter(m => m.alive && m.sk === 'form').length + ' in formation (' + w.members.filter(m => m.alive).length + ' alive), dT ' + w.dT.toFixed(0) } : null; },
    (s) => { const F = s.w.members.filter(m => m.alive && m.sk === 'form'); if (!F.length) return null; const c = { x: F.reduce((a, m) => a + m.x, 0) / F.length, y: F.reduce((a, m) => a + m.y, 0) / F.length, z: F.reduce((a, m) => a + m.z, 0) / F.length }; return eye(c, 95, s.w.h + 1.9, 14); }, 3, 60, 300);
  // air tactics scenes (docs/PLANE_REVIEW.md P3-P8): the stacked strike, a picket CAP meeting a raid far out, the
  // sweep against the CAP, nation dive styles, the torpedo anvil
  if (WHICH.includes('stack')) await pairFind('stack',
    () => { const w = WW.strike._waves().find(w => w.go && !w.done && w.dT > 150 && w.members.filter(m => m.alive && m.sk === 'form').length >= 6); return w ? { w, desc: w.nation + ' strike in transit, ' + w.members.filter(m => m.alive && m.sk === 'form').length + ' in formation, dT ' + w.dT.toFixed(0) } : null; },
    (s) => { const F = s.w.members.filter(m => m.alive && m.sk === 'form'); if (!F.length) return null; const c = { x: F.reduce((a, m) => a + m.x, 0) / F.length, y: 48, z: F.reduce((a, m) => a + m.z, 0) / F.length }; return eye(c, 95, s.w.h + 1.35, 3); }, 3, 60, 300);
  if (WHICH.includes('picket')) await pairFind('picket',
    () => { const q = WW.world.planes.find(f => f.alive && f.nation === 'USN' && f.kind === 'fighter' && !f.target && f.foe && f.foe.alive && f.foe.ordnance && Math.hypot(f.foe.x - f.carrier.x, f.foe.z - f.carrier.z) > 140 && Math.hypot(f.x - f.foe.x, f.z - f.foe.z) < 60); return q ? { q, desc: 'USN picket on a ' + q.foe.kind + ' ' + Math.hypot(q.foe.x - q.carrier.x, q.foe.z - q.carrier.z).toFixed(0) + ' u out' } : null; },
    (s) => { const q = s.q, f = q.foe && q.foe.alive ? q.foe : q, m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }; return eye(m, 70, Math.atan2(f.z - q.z, f.x - q.x) + 2.3, 10); }, 4, 30, 300);
  if (WHICH.includes('sweep')) await pairFind('sweep',
    () => { const q = WW.world.planes.find(f => f.alive && f.kind === 'fighter' && f.target && f.foe && f.foe.alive && f.foe.kind === 'fighter' && Math.hypot(f.x - f.foe.x, f.z - f.foe.z) < 70); return q ? { q, desc: q.nation + ' escort (' + q.cover + ') vs ' + q.foe.nation + ' fighter' } : null; },
    (s) => { const q = s.q, f = q.foe && q.foe.alive ? q.foe : q, m = { x: (q.x + f.x) / 2, y: (q.y + f.y) / 2, z: (q.z + f.z) / 2 }; return eye(m, 75, Math.atan2(f.z - q.z, f.x - q.x) + 1.6, 14); }, 5, 20, 300);
  for (const n of ['USN', 'IJN']) if (WHICH.includes(n === 'USN' ? 'sbd' : 'd3a')) await pairFind(n === 'USN' ? 'sbd_dive' : 'd3a_dive',
    new Function(`return () => { const q = WW.world.planes.find(d => d.alive && d.nation === '${n}' && d.kind === 'dive' && d.phase === 'roll' && d.push && d.diveTgt); if (!q) return null; const t = q.diveTgt; return { q, t, a: Math.atan2(t.z - q.z, t.x - q.x) + Math.PI / 2, desc: q.nation + ' push-over at y ' + q.y.toFixed(0) + ' on a ' + t.type }; }`)(),
    (s) => { const t = s.t, q = s.q, m = { x: q.x * 0.6 + t.x * 0.4, y: 32, z: q.z * 0.6 + t.z * 0.4 }; return eye(m, 75, s.a, 6); }, 6, 18, 300);
  if (WHICH.includes('anvil')) await pairFind('anvil',   // torpedo planes on both bows running in: across the ship's beam, the near side between camera and ship
    () => { const t = WW.world.ships.find(s => { if (!s.alive) return false; let a = 0, b = 0; for (const p of WW.world.planes) if (p.alive && p.kind === 'torpedo' && p.target === s && (p.phase === 'run' || (p.sk === 'anvil' && p.ready))) { if (p.side > 0) a++; else b++; } return a && b; }); return t ? { t, desc: 'anvil on a ' + t.type } : null; },
    (s) => { const t = s.t, a = t.heading + Math.PI / 2 * (WW.world.planes.some(p => p.alive && p.kind === 'torpedo' && p.target === t && p.side > 0) ? 1 : -1); return { x: t.x + Math.cos(a) * 115, y: 13, z: t.z + Math.sin(a) * 115, tx: t.x, ty: 2, tz: t.z }; }, 5, 30, 300);
  if (errs.length) console.log('errors:\n' + errs.slice(0, 8).join('\n'));
  await b.close();
})();
