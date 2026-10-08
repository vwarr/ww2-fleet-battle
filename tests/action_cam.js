// Action-shot probe: forces the bomb cam, the torpedo hand-off and the over-the-shoulder dogfight shot,
// records the camera every frame and saves a frame sequence of each.
// Usage: bash tests/run.sh action_cam.js [which=bomb,torp,ots] [seconds=16] [frameMs=250]
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'action'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const WHICH = (process.argv[2] || 'bomb,torp,ots').split(','), SECS = +(process.argv[3] || 16), EVERY = +(process.argv[4] || 250);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  // frames are driven by the test at a fixed 30 fps (deterministic timing, independent of the software GPU)
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    __step(30);
    window.until = (cond, max) => { for (let i = 0; i < max * 10; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.1); } return cond(); };
    window.__rec = []; __rec.ids = 0; window.__ev = [];
    WW.on('weaponDropped', e => { const s = WW.cam._shot(); __ev.push('drop ' + e.kind + (s && (e.plane === s.subj || e.plane === s.plane) ? ' FILMED' : '') + ' stage=' + (s && s.stage)); });
    WW.on('weaponImpact', e => { const s = WW.cam._shot(); if (s && s.stage) __ev.push('impact ' + e.kind + ' hit=' + !!e.ship + ' stage=' + s.stage + ' warp=' + WW.time.warp); });
    const orig = WW.cam.afterRender;
    WW.cam.afterRender = function () {
      orig.call(this);
      const fk = window.__forceKill;
      if (fk && fk.q.alive && fk.q.foe && fk.q.foe.alive && WW.time.now - fk.t0 > 1 && Math.hypot(fk.q.foe.x - fk.q.x, fk.q.foe.y - fk.q.y, fk.q.foe.z - fk.q.z) < 36) { fk.q.foe.damage(999); window.__forceKill = null; __ev.push('impact: forced kill FILMED'); }
      const ft = window.__forceTorp, q = ft && ft.q;
      if (q && q.alive && q.ordnance && q.target && (q.hd(q.target) < 46 || WW.time.now - ft.t0 > 2.5)) {
        const t = q.target, h = Math.atan2(t.z - q.z, t.x - q.x);
        WW.combat.fireTorpedo(q, q.x + Math.cos(h), q.z + Math.sin(h), h, q.nation, 90); q.dropped(); q.phase = 'out'; q.phaseT = 4; window.__forceTorp = null;
      }
      const c = WW.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion), s = WW.cam._shot();
      let hull = 99; for (const o of WW.world.ships) if (!o.removed) hull = Math.min(hull, Math.hypot(c.position.x - o.x, c.position.z - o.z) - o.stats.length / 2 + (c.position.y > 14 ? 99 : 0));
      if (s && !s.__id) s.__id = ++__rec.ids;
      const am = s && (s.aim || s.last), nd = am ? am.clone().project(c) : { x: 0, y: 0 };
      __rec.push({ id: s ? s.__id : 0, t: __fakeT / 1000, x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z,
        kind: s ? s.kind : '-', stage: s ? s.stage || '' : '', warp: WW.time.warp || 1, sim: WW.time.now, hull,
        nx: nd.x, ny: nd.y, ground: c.position.y + Math.min(0, WW.terrain.depthAt(c.position.x, c.position.z)) });
    };
  });
  const scen = {
    torp: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'torpedo' && q.phase === 'run' && q.ordnance && q.target && q.y < 12 && q.hd(q.target) > 50 && q.hd(q.target) < 75), 400);
      if (!q) return 'none';
      // the torpedo AI rarely releases (it mostly resets), so release like aircraft.js does once in range
      window.__forceTorp = { q, t0: WW.time.now };
      WW.cam.film({ kind: 'chase', subj: q, dur: 30 }); return 'torp plane d=' + q.hd(q.target).toFixed(0);
    },
    bomb: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'dive' && q.state === 'attack' && !q.phase && q.ordnance && q.target && q.target.alive && q.hd(q.target) > 40), 400);
      if (!q) return 'none';
      const t = q.target;
      WW.cam.film({ kind: 'orbit', subj: t, r: t.stats.length * 1.4 + 22, dur: 30, w: 0.05, hgt: 0.34, plane: q }); return 'dive on ' + t.type;
    },
    ots: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.state === 'attack' && q.foe && q.foe.alive && q.foe.hp < 12 && q.hd(q.foe) < 30), 400);
      if (!q) return 'none';
      window.__forceKill = { q, t0: WW.time.now }; // a kill on camera (they are rare in a short window): shoot the foe down
      WW.cam.film({ kind: 'ots', subj: q, dur: 30 }); return 'fighter vs ' + q.foe.kind;
    }
  };
  // gating checks (run each in its own process so the 20 s slow-motion cooldown is fresh):
  // a kill must not slow the game in map view (mapkill) or while the user drives the free camera (freekill)
  scen.mapkill = new Function(`const r = (${scen.ots.toString()})(); WW.cam.toggle(); return r + ' (map view)';`);
  scen.freekill = new Function(`return (${scen.ots.toString()})() + ' (free camera)';`);
  for (const name of WHICH) {
    await p.evaluate(() => { __sim.setScale(1); });
    const r = await p.evaluate(`(${scen[name].toString()})()`);
    console.log(`[${name}]`, r);
    if (r === 'none') continue;
    if (name === 'freekill') { await p.mouse.move(480, 270); await p.mouse.wheel(0, -200); }
    await p.evaluate(() => { __rec.length = 0; });
    const per = Math.max(1, Math.round(EVERY / (1000 / 30)));
    let i = 0, ended = false;
    for (let fr = 0; fr < SECS * 30; fr += per) {
      const st = await p.evaluate(n => { __render = false; __step(n - 1); __render = true; __step(1); const s = WW.cam._shot(); return s ? s.kind + ':' + (s.stage || '') : '-'; }, per);
      await p.screenshot({ path: `shots/action/${name}_${String(i++).padStart(3, '0')}.png` });
      if (/:hold/.test(st)) ended = true;
      else if (ended) break;
    }
    const rec = await p.evaluate(() => __rec.slice());
    console.log('  events', await p.evaluate(() => { const s = WW.cam._shot(), q = s && s.subj; return __ev.splice(0).filter(e => /FILMED|impact/.test(e)).join(' | ') + ' || subj ' + (q ? [q.kind, q.state, q.phase, q.alive, q.removed, q.y && q.y.toFixed(1)].join(',') : '-'); }));
    // jitter: per-frame change of the view direction and of the camera velocity, normalised by frame time
    let maxRot = 0, maxRotJerk = 0, maxAcc = 0, at = '', stages = [], minHull = 99, minGround = 99, warpMin = 1;
    const first = {}, ang = (a, b) => Math.acos(Math.min(1, a.fx * b.fx + a.fy * b.fy + a.fz * b.fz));
    rec.forEach((f, i) => {
      if (!stages.length || stages[stages.length - 1] !== f.kind + ':' + f.stage) stages.push(f.kind + ':' + f.stage);
      minHull = Math.min(minHull, f.hull); minGround = Math.min(minGround, f.ground); warpMin = Math.min(warpMin, f.warp);
      if (first[f.id] === undefined) first[f.id] = i;
      if (i - first[f.id] < 4) return; // a cut (cross-faded): not a jitter
      const a = rec[i - 2], b = rec[i - 1], dt = f.t - b.t;
      const w = ang(f, b) / dt, w0 = ang(b, a) / dt;
      const acc = Math.hypot(f.x - 2 * b.x + a.x, f.y - 2 * b.y + a.y, f.z - 2 * b.z + a.z) / dt / dt;
      if (w > maxRot) maxRot = w;
      if (Math.abs(w - w0) / dt > maxRotJerk) { maxRotJerk = Math.abs(w - w0) / dt; at = i + ' ' + f.kind + ':' + f.stage; }
      if (acc > maxAcc) maxAcc = acc;
    });
    console.log('  worst rotation change at frame ' + at);
    const sub = rec.filter(f => f.kind !== 'wide'), out = sub.filter(f => Math.abs(f.nx) > 0.34 || Math.abs(f.ny) > 0.34);
    console.log(`  subject outside the middle third in ${out.length}/${sub.length} frames` + (out.length ? ' e.g. ' + out.slice(0, 4).map(f => f.kind + ':' + f.stage + ' ' + f.nx.toFixed(2) + ',' + f.ny.toFixed(2)).join(' ') : ''));
    const fps = rec.length / Math.max(1e-3, rec[rec.length - 1].t - rec[0].t);
    console.log(`  frames ${rec.length} (${fps.toFixed(1)} fps), shots ${i}, stages ${stages.join(' > ')}`);
    console.log(`  max view rotation ${maxRot.toFixed(2)} rad/s, max rot change ${maxRotJerk.toFixed(1)} rad/s2, max cam accel ${maxAcc.toFixed(0)} u/s2`);
    console.log(`  min hull clearance (cam below 14) ${minHull.toFixed(1)}, min height over ground ${minGround.toFixed(1)}, min warp ${warpMin.toFixed(2)}`);
    require('fs').writeFileSync(`shots/action/${name}_rec.json`, JSON.stringify(rec));
  }
  console.log('errors', errs.length, errs.slice(0, 5).join(' / '));
  await b.close();
})();
