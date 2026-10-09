// Render-mode torpedo shots: a torpedo run, the hit (underwater flash, water column, spray, foam), and a ship listing
// after hits. Forced through test hooks (WW.combat.fireTorpedo at a fresh ship), filmed with a fixed ship-relative
// camera (the director is switched off), several frames after the impact.
// BASE_URL, CHROMIUM as for the other render tests: node tests/torpedo_shots.js [outdir] [only=scene,scene]
// Scenes: hit (a Type 93 into a carrier's side, frames from the impact), low (the same at wave height),
//         track (a steam and an oxygen torpedo running), list (a battleship after three hits, bow view)
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'shots', 'torpedo');
const only = process.argv[3] ? process.argv[3].split(',') : null;
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(process.env.BASE_URL + 'index.html?auto&v=' + Date.now(), { timeout: 180000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.game.state === 'battle', null, { timeout: 180000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    __sim.setScale(0.12);
    Object.defineProperty(WW.time, 'warp', { get: () => 1, set: () => {} });   // no director slow motion on the hand-off
    WW.audio && WW.audio.setVolume && WW.audio.setVolume(0);
    window.__shot = null;
    WW.cam.update = function () {        // ship-relative fixed camera: [ship, ox, oy, oz, lx, ly, lz] (ship-local)
      const s = window.__shot; if (!s) return;
      const sh = s[0], c = Math.cos(sh.heading), sn = Math.sin(sh.heading);
      const w = (x, z) => [sh.x + c * x - sn * z, sh.z + sn * x + c * z];
      const a = w(s[1], s[3]), t = w(s[4], s[6]);
      WW.camera.position.set(a[0], s[2], a[1]); WW.camera.lookAt(t[0], s[5], t[1]);
    };
    // clear the battle away from the filming spot: the subjects sail alone in open water near the USN start
    for (const s of WW.world.ships) if (s.alive) { s.x += 3000; }
    WW.world.planes.forEach(pl => { pl.alive = false; if (pl.remove) pl.remove(); });
    const mk = (type, nation, x, z) => { const s = WW.ships.spawn(type, nation, x, z, 0); s.hp = s.maxHp; s.throttle = 0.4; return s; };
    window.__S = { cv: mk('carrier', 'USN', 120, 220), bb: mk('battleship', 'USN', 140, 420) };
    window.__imp = [];
    WW.on('weaponImpact', e => { if (e && e.kind === 'torpedo') window.__ends = (window.__ends || []).concat([[+e.x.toFixed(1), +e.z.toFixed(1), e.ship ? e.ship.type : null, +(e.proj.run || 0).toFixed(1)]]); if (e && e.kind === 'torpedo' && e.ship) { window.__imp.push(WW.time.now); __sim.setScale(0.12); } });   // slow motion from the impact
    WW.game.state = 'victory'; WW.game.victoryTime = -1e4;   // no AI: the subjects sail on
    // fire a torpedo at ship s from distance d on its beam (side +1 starboard), aimed at local x = ax
    window.__fire = (s, side, d, ax, nation, launcher) => {
      const c = Math.cos(s.heading), sn = Math.sin(s.heading), tt = d / 16, lead = s.speed * tt;
      const bx = s.x + c * (ax + lead), bz = s.z + sn * (ax + lead), ox = bx - sn * side * d, oz = bz + c * side * d;
      const owner = launcher ? { stats: { torpedoes: WW.shipType(launcher, nation).torpedoes }, nation, type: launcher, x: ox, z: oz } : null;
      __sim.setScale(1);   // full speed until the impact
      return WW.combat.fireTorpedo(owner, ox, oz, Math.atan2(bz - oz, bx - ox), nation, d + 30);
    };
  });
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return true; await p.waitForTimeout(100); } return false; };
  const shotsAfterImpact = async (name, times) => {
    const n0 = await p.evaluate(() => window.__imp.length);
    if (!await until(new Function('return window.__imp.length > ' + n0), 180000)) { console.log(name, 'no impact', JSON.stringify(await p.evaluate(() => [window.__ends, __S.cv.x, __S.cv.z, __S.cv.heading, __S.cv.alive]))); return; }
    const t0 = Date.now();
    for (const t of times) { const w = t - (Date.now() - t0); if (w > 0) await p.waitForTimeout(w); await p.screenshot({ path: `${out}/${name}_${t}.png` }); }
    console.log(name, 'ok', JSON.stringify(await p.evaluate(() => WW.fx._stats())));
  };
  // warm-up: the first frames compile the shaders (seconds each in software GL): wait until the sim runs
  const tw = await p.evaluate(() => WW.time.now);
  await until(new Function('return WW.time.now > ' + (tw + 0.5)), 240000);
  const scenes = {
    hit: async () => {
      console.log('fired', JSON.stringify(await p.evaluate(() => { const s = __S.cv; window.__shot = [s, -6, 7, 34, 0, 1.0, 0]; const q = __fire(s, 1, 60, 2, 'IJN', 'destroyer'); return q ? [q.x, q.z, q.h, q.sp, q.range, q.dead] : null; })));
      await shotsAfterImpact('hit', [0, 4000, 9000, 16000, 30000, 60000]);   // x0.06 sim time: up to ~3.6 sim s
    },
    low: async () => {
      await p.evaluate(() => { const s = __S.cv; window.__shot = [s, 14, 1.6, 22, -2, 1.5, 0]; __fire(s, 1, 60, -4, 'USN', null); });
      await shotsAfterImpact('low', [0, 6000, 14000, 30000]);
    },
    track: async () => {
      await p.evaluate(() => { const s = __S.bb; window.__shot = [s, 0, 14, 60, 0, 0, 30]; __fire(s, 1, 110, 4, 'USN', 'destroyer'); __fire(s, 1, 110, -6, 'IJN', 'destroyer'); });
      await p.waitForTimeout(6000); await p.screenshot({ path: `${out}/track.png` });
    },
    holes: async () => {   // persistent torpedo holes on a carrier's near side: at the waterline, from above, and as it lists
      await p.evaluate(() => { const s = __S.cv; s.throttle = 0; for (const ax of [5, -3]) { const w = s.toWorld(ax, 3); s.takeDamage(150, w[0], w[1], 'torpedo'); } window.__shot = [s, 1, 0.9, 13, 1, 0.2, 0]; });
      await p.waitForTimeout(2500);
      await p.evaluate(() => { (__S.cv.dmgSites || []).forEach(q => { q.smoke = 0; q.fire = 0; }); WW.fx.clearAll(); });   // the holes, not the smoke
      await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/holes_water.png` });
      await p.evaluate(() => { window.__shot = [__S.cv, 1, 7, 11, 1, 0, 1]; });
      await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/holes_above.png` });
      await p.evaluate(() => { window.__shot = [__S.cv, 1, 2.2, 16, 1, 0.3, 0]; });
      await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/holes_side.png` });
      console.log('holes', JSON.stringify(await p.evaluate(() => (__S.cv._dv ? __S.cv._dv.side : []).map(q => [q.k, +q.lx.toFixed(2), +q.ly.toFixed(2), +q.lz.toFixed(2), +q.s.toFixed(2), +(q.tilt || 0).toFixed(3)]))));
      await p.evaluate(() => { const D = __S.cv._dv; if (D) D.side = D.side.filter(q => q.k !== 0); window.__shot = [__S.cv, 1, 0.9, 13, 1, 0.2, 0]; });   // the ruptures alone
      await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/holes_only.png` });
      if (process.env.DBG) { console.log(JSON.stringify(await p.evaluate(() => ({ y: __S.cv.group.position.y, rz: __S.cv.group.rotation.x, set: __S.cv._dv.set, st: WW.dmgVis.stats() })))); await p.evaluate(() => { __S.cv._dv.side.forEach(q => { q.ly += 0.6; }); }); await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/holes_dbg.png` }); }
    },
    list: async () => {
      await p.evaluate(() => { const s = __S.bb; for (const ax of [3, -2, 6]) { const w = s.toWorld(ax, 2); s.takeDamage(240, w[0], w[1], 'torpedo'); } window.__shot = [s, 26, 3.5, 0, 0, 1.5, 0]; });
      await p.waitForTimeout(5000); await p.screenshot({ path: `${out}/list.png` });
    }
  };
  for (const name of Object.keys(scenes)) { if (only && !only.includes(name)) continue; await scenes[name](); }
  if (errs.length) console.log('ERRORS', errs.slice(0, 5).join('\n'));
  await b.close();
})();
