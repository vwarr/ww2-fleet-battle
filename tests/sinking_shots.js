// Render-mode frame sequences of sinkings (ship_sinking.js, ship_breakup.js): a destroyer broken in two by a torpedo
// amidships, a cruiser broken by a magazine, a fast carrier carrying her way on as she sinks.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/sinking_shots.js [scene=all] [outdir=tests/shots/sinking]
// scenes: dd, mag, cv, all. The break-up chance is forced to 1 for the shot (WW.shipBreakup.P_BREAK).
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const which = process.argv[2] || 'all', out = process.argv[3] || path.join(__dirname, 'shots', 'sinking');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.setDefaultTimeout(240000);
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.game.state === 'battle', null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    __sim.setScale(0.1);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * L.ax, L.y + L.h, L.z + L.d * L.az); WW.camera.lookAt(L.x, L.y, L.z); WW.camera.updateMatrixWorld();
    };
    // a live ship of this type in open, deep water, away from the others
    window.pick = (type, pred) => {
      let best = null, bs = -1;
      for (const s of WW.world.ships) {
        if (!s.alive || s.sinking || s.type !== type || (pred && !pred(s))) continue;
        let near = 1e9; for (const o of WW.world.ships) if (o !== s && !o.removed) near = Math.min(near, WW.dist(s.x, s.z, o.x, o.z));
        const sc = Math.min(near, 80) + Math.min(WW.terrain.depthAt(s.x, s.z), 30);
        if (sc > bs) { bs = sc; best = s; }
      }
      return best;
    };
    // camera on the ship's beam, a little ahead
    window.frame = (s, d, h, side) => {
      const c = Math.cos(s.heading), n = Math.sin(s.heading), sd = side || 1;
      const ax = -n * sd + c * 0.35, az = c * sd + n * 0.35, l = Math.hypot(ax, az);
      window.__look = { x: s.x, y: 0.5, z: s.z, d, h, ax: ax / l, az: az / l };
    };
  });
  const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: path.join(out, name + '.png'), timeout: 240000 }); console.log('shot', path.join(out, name + '.png')); };

  async function run(tag, setup, times, d, h) {
    const info = await p.evaluate(([tag, setup]) => {
      const B = WW.shipBreakup.P_BREAK;
      const s = setup === 'dd' ? pick('destroyer') : setup === 'mag' ? pick('cruiser') : pick('carrier');
      if (!s) return null;
      window.__s = s; window.__x0 = s.x; window.__z0 = s.z;
      if (setup === 'dd') { B.torpedo.destroyer = 1; s.speed = s.stats.speed; frame(s, 22, 6); __sim.fastForward(0.05); const w = s.toWorld(0.5, s.beam * 0.5); s.takeDamage(s.hp + 1, w[0], w[1], 'torpedo'); WW.fx.torpedoHit && WW.fx.torpedoHit(w[0], w[1], -Math.sin(s.heading), Math.cos(s.heading), 2); }
      if (setup === 'mag') { B.magazine.cruiser = B.magazine.lc = 1; s.speed = s.stats.speed * 0.8; frame(s, 32, 9); __sim.fastForward(0.05); const w = s.toWorld(-s.stats.length * 0.2, 0); WW.emit('magazine', { ship: s, x: w[0], z: w[1] }); s.takeDamage(s.hp + 1, w[0], w[1], 'magazine'); }
      if (setup === 'cv') { B.bomb.carrier = 0; s.speed = s.stats.speed; s.flood = 0; frame(s, 60, 16); __sim.fastForward(0.05); s.speed = s.stats.speed; s.takeDamage(s.hp + 1, s.x, s.z, 'bomb'); }
      return { name: s.name, type: s.type, broken: !!s.broken, cause: s.breakCause, bx: s.breakX, v0: s.coastV0 };
    }, [tag, setup]);
    console.log(tag, JSON.stringify(info));
    if (!info) return;
    let t0 = 0;
    for (const t of times) {
      const r = await p.evaluate(([dt, d, h, cv]) => {
        __sim.fastForward(dt); const s = window.__s;
        frame(s, d, h);
        return { t: +s.sinkT.toFixed(1), run: +Math.hypot(s.x - __x0, s.z - __z0).toFixed(1), v: +s.speed.toFixed(2), wreck: s.wreck };
      }, [t - t0, d, h, setup === 'cv']);
      t0 = t;
      console.log('  t', t, JSON.stringify(r));
      await shot(tag + '_' + String(t).replace('.', 'p'));
    }
  }
  if (which === 'all' || which === 'dd') await run('dd_torpedo', 'dd', [0.3, 1.5, 3, 5, 8], 22, 6);
  if (which === 'all' || which === 'mag') await run('ca_magazine', 'mag', [0.3, 1.5, 3.5, 6, 9], 32, 9);
  if (which === 'all' || which === 'cv') await run('cv_coast', 'cv', [0.5, 2.5, 5, 8, 11.5], 60, 16);
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
