// Scout floatplane size checks (render mode, software GL): the cruiser / battleship floatplanes (models_scout.js,
// air_scouts.js) beside an F4U and an A6M at the same plane scale, on the catapult, in flight and on the water.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/scout_size_shots.js OUTDIR [shot,shot]
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'shots', 'scout_size'), ONLY = process.argv[3] || null;
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8828/') + 'index.html?v=' + Date.now(), { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .caption, #fade { display: none !important; }' });
  const info = await p.evaluate(() => {
    window.__cam = null;
    const upd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (dt) { const v = window.__cam && window.__cam(); if (!v) return upd(dt); WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); };
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    WW.terrain.generate(3); WW.seedRandom(3); WW.time.now = 0;
    if (WW.dayNight) { WW.dayNight.force = 'day'; WW.dayNight.pinHour = 10; } if (WW.weather) WW.weather.force = 'clear';
    WW.game.composition = [{ type: 'cruiser', nation: 'USN', x: 120, z: H / 2 }, { type: 'carrier', nation: 'USN', x: 60, z: H / 2 + 90 },
      { type: 'cruiser', nation: 'IJN', x: W - 120, z: H / 2 }, { type: 'carrier', nation: 'IJN', x: W - 60, z: H / 2 + 90 }];
    WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true }); WW.game.composition = null;
    WW.time.scale = 0.0001;
    window.__ff = (cond, secs, step) => { for (let i = 0; i < secs / (step || 0.05); i++) { const r = cond(); if (r) return r; __sim.fastForward(step || 0.05); } return cond(); };
    const U = WW.cfg.U_PER_M, dims = g => { g.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(g), s = bb.getSize(new THREE.Vector3()); return (s.x / U).toFixed(1) + ' m long x ' + (s.z / U).toFixed(1) + ' m span'; };
    // the studio: in the sky at 25 u, a scout and a carrier fighter of each nation side by side, as drawn in flight
    const out = {}, cx = W / 2, cz = H / 2 - 120;
    window.__st = [];
    ['USN', 'IJN'].forEach((n, i) => {
      const sc = WW.models.buildScout(n); sc.group.rotation.order = 'YZX';
      sc.group.scale.setScalar(1.5 * WW.cfg.PLANE_K * (WW.models.SCOUT_VIS ? WW.models.SCOUT_VIS[n] : 1));
      sc.group.position.set(cx, 25, cz + i * 12); WW.scene.add(sc.group);
      const f = WW.air._pool.get('fighter', n); f.group.position.set(cx, 25, cz + i * 12 + 2.2); f.group.rotation.set(0, 0, 0);
      if (WW.planeGear) WW.planeGear.stow(f);
      if (f.disc) { f.disc.visible = false; f.blades.visible = true; }
      out[n] = { scout: dims(sc.group), fighter: dims(f.group) };
      __st.push([sc, f]);
    });
    window.__cx = cx; window.__cz = cz;
    return out;
  });
  console.log('sizes', JSON.stringify(info));
  const shot = async (name, setup) => {
    if (ONLY && !ONLY.split(',').includes(name)) return;
    const ok = await p.evaluate((src) => eval('(' + src + ')')() !== false, setup.toString());
    if (!ok) { console.log('skip', name); return; }
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    console.log('  ' + name);
  };
  await shot('pair_USN', () => { window.__cam = () => [__cx + 0.6, 25.6, __cz + 1.1 - 4.2, __cx, 25, __cz + 1.1]; });
  await shot('pair_IJN', () => { window.__cam = () => [__cx + 0.6, 25.6, __cz + 13.1 - 4.2, __cx, 25, __cz + 13.1]; });
  await shot('pair_top', () => { window.__cam = () => [__cx - 0.01, 29, __cz + 1.1, __cx, 25, __cz + 1.1]; });
  // the scout on the catapult (the dawn launch: the catapult trains out, then fires)
  const sc = (n) => `WW.world.planes.find(q => q.kind === 'scout' && q.nation === '${n}')`;
  for (const n of ['USN', 'IJN']) {
    await shot('catapult_' + n, `() => { const P = () => { const q = ${sc(n)}; return q && q.state === 'catapult' && q.t > 1.2 ? q : null; }; const q = __ff(P, 30, 0.05); if (!q) return false; window.__q = q;
      const s = q.carrier, c = Math.cos(s.heading), sn = Math.sin(s.heading); window.__cam = () => [q.x - sn * 4 - c * 2, q.y + 1.6, q.z + c * 4 - sn * 2, q.x, q.y, q.z]; }`);
  }
  for (const n of ['USN', 'IJN']) {
    await shot('flight_' + n, `() => { const P = () => { const q = ${sc(n)}; return q && q.state === 'transit' && q.y > 8 ? q : null; }; const q = __ff(P, 120, 0.1); if (!q) return false;
      window.__cam = () => { const c = Math.cos(q.heading), s = Math.sin(q.heading), g = q.group.position; return [g.x - c * 2.5 - s * 2.2, g.y + 0.8, g.z - s * 2.5 + c * 2.2, g.x, g.y, g.z]; }; }`);
  }
  for (const n of ['USN', 'IJN']) {
    await shot('water_' + n, `() => { const P = () => { const q = ${sc(n)}; return q && (q.state === 'afloat' || (q.state === 'alight' && q.y < 1)) ? q : null; }; const q = __ff(P, 900, 0.25); if (!q) return false;
      window.__cam = () => { const c = Math.cos(q.heading), s = Math.sin(q.heading), g = q.group.position; return [g.x - c * 1 - s * 2.6, 0.7, g.z - s * 1 + c * 2.6, g.x, g.y - 0.2, g.z]; }; }`);
  }
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
