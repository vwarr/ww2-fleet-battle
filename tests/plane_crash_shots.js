// Plane crash shots (render mode): a mid-air flak blow-up, a wreck onto a ship, a wreck cratering the island runway, a
// wreck on an island hillside. Shots in tests/shots/plane_crash/ (not committed).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/plane_crash_shots.js
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'shots', 'plane_crash'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8154/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    WW.game.baseChoice = 'USN'; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    __sim.setScale(0.1);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * 0.8, L.y + L.h, L.z + L.d * 0.6); WW.camera.lookAt(L.x, L.y, L.z); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max, st) => { for (let i = 0; i < max / (st || 0.25); i++) { if (cond()) return true; __sim.fastForward(st || 0.25); } return cond(); };
    until(() => WW.world.planes.filter(q => q.alive && q.y > 15 && q.state !== 'takeoff').length >= 3, 200);
    // a falling plane dropped over (x, z) from height h; ends through air_impact.js
    window.dropAt = (x, z, h, mode, spd, hd) => {
      const q = WW.world.planes.find(q => q.alive && q.y > 15 && q.state !== 'takeoff');
      if (!q) return null;
      q.x = x; q.z = z; q.y = h; q.speed = spd === undefined ? 6 : spd; if (hd !== undefined) q.heading = hd; q.vy = -6; q.sync(0);
      WW.airDeaths.force(mode || 'spin', q); window.__dp = q;
      return q;
    };
  });
  const shot = async n => { await p.waitForTimeout(400); await p.screenshot({ path: path.join(OUT, n + '.png'), timeout: 180000 }); console.log(path.join(OUT, n + '.png')); };
  const run = (fn, a) => p.evaluate(fn, a);

  // 1. mid-air flak burst
  await run(() => { const q = WW.airDeaths.force('burst'); window.__dp = q; __sim.fastForward(0.12); window.__look = { x: q.x, y: q.y, z: q.z, d: 16, h: 3 }; });
  await shot('1_flak_burst');
  await run(() => { __sim.fastForward(0.6); const q = window.__dp; window.__look = { x: q.x, y: q.y, z: q.z, d: 20, h: 4 }; });
  await shot('1b_flak_burst_falling');
  // 2. a wreck onto a ship
  const r2 = await run(() => {
    const s = WW.world.ships.find(s => s.alive && (s.type === 'cruiser' || s.type === 'battleship' || s.type === 'carrier'));
    const hp0 = s.hp, q = dropAt(s.x + Math.cos(s.heading) * 3, s.z + Math.sin(s.heading) * 3, WW.airImpact.deckY(s) + 4, 'spin', 0, s.heading + Math.PI);
    until(() => q.removed, 6, 0.02); __sim.fastForward(0.1);
    window.__look = { x: s.x, y: 2, z: s.z, d: 22, h: 7 };
    return { type: s.type, on: q.impactOn, dmg: +(hp0 - s.hp).toFixed(1), fire: s.fireN || 0 };
  });
  console.log('ship:', JSON.stringify(r2)); await shot('2_wreck_on_ship');
  // 3. a wreck cratering the runway
  const r3 = await run(() => {
    const b = WW.islandBase.base; if (!b) return null;
    const r = b.runways[0], c0 = WW.islandBase.stats.craters;
    const q = dropAt(r.x + r.c * 8, r.z + r.s * 8, b.site.padH + 5, 'spin');
    until(() => q.state === 'wrecked' || q.removed, 8, 0.05); __sim.fastForward(0.4);
    window.__look = { x: q.x, y: b.site.padH, z: q.z, d: 18, h: 7 };
    return { on: q.impactOn, craters: WW.islandBase.stats.craters - c0, closed: r.closed };
  });
  console.log('runway:', JSON.stringify(r3)); await shot('3_wreck_on_runway');
  // 4. a wreck on an island hillside (the highest ground on the map, away from the base)
  const r4 = await run(() => {
    let best = null, bh = 2; const b = WW.islandBase.base;
    for (let x = 20; x < WW.cfg.MAP_W - 20; x += 4) for (let z = 20; z < WW.cfg.MAP_H - 20; z += 4) {
      const h = -WW.terrain.depthAt(x, z); if (h > bh && (!b || WW.dist(x, z, b.x, b.z) > 130)) { bh = h; best = { x, z }; }
    }
    if (!best) return null;
    const q = dropAt(best.x, best.z, bh + 14, 'wing');
    until(() => q.state === 'wrecked' || q.removed, 8, 0.05); __sim.fastForward(0.5);
    window.__look = { x: q.x, y: bh, z: q.z, d: 20, h: 6 };
    return { h: +bh.toFixed(1), on: q.impactOn, y: +q.y.toFixed(2), ground: +WW.airImpact.ground(q.x, q.z).toFixed(2) };
  });
  console.log('hillside:', JSON.stringify(r4)); await shot('4_wreck_on_hillside');
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
