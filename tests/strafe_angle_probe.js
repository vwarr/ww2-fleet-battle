// Measures, at each strafe tracer burst (air_strafe.js volley -> planeTracers.burst), the angle between the visual
// fuselage axis (heading, pl.pitch), the velocity (heading, atan2(vy, speed)) and the tracer direction, and the time a
// strafing plane spends pinned on the wave-top floor. The strafe scenario of tests/plane_guns_shots.js, render page.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/strafe_angle_probe.js [seed=3] [secs=200]
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3), SECS = +(process.argv[3] || 200);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await p.goto((process.env.BASE_URL || 'http://localhost:8783/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  const r = await p.evaluate(([seed, secs]) => {
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const x = W / 2 + 120;
    G.composition = [{ type: 'carrier', nation: 'IJN', x, z: H / 2 }, { type: 'cruiser', nation: 'IJN', x: x + 40, z: H / 2 + 40 },
      { type: 'pt', nation: 'USN', x: x - 150, z: H / 2 - 20 }, { type: 'pt', nation: 'USN', x: x - 160, z: H / 2 + 20 }, { type: 'pt', nation: 'USN', x: x - 140, z: H / 2 + 50 },
      { type: 'battleship', nation: 'USN', x: 60, z: H / 2 }];
    G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    const TR = WW.planeTracers, ob = TR.burst, rec = [];
    const deg = a => a * 180 / Math.PI;
    const ang = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))));
    TR.burst = function (x, y, z, ax, ay, az) {
      let best = null, bd = 1e9;
      for (const q of WW.world.planes) { if (!q.alive) continue; const d = Math.hypot(q.x - x, q.y - y, q.z - z); if (d < bd) { bd = d; best = q; } }
      if (best && best.kind === 'fighter' && best.strafe && bd < 4) {
        const q = best, h = q.heading, ph = q.pitch || 0, pv = Math.atan2(q.vy, Math.max(1, q.speed));
        const nose = [Math.cos(h) * Math.cos(ph), Math.sin(ph), Math.sin(h) * Math.cos(ph)], vel = [Math.cos(h) * q.speed, q.vy, Math.sin(h) * q.speed], tr = [ax - x, ay - y, az - z];
        const u = q.strafe;
        rec.push({ noseTr: ang(nose, tr), velTr: ang(vel, tr), noseVel: ang(nose, vel), pitch: deg(ph), path: deg(pv), trDown: deg(Math.atan2(-(ay - y), Math.hypot(ax - x, az - z))), y: q.y, d: Math.hypot(u.x - q.x, u.z - q.z), speed: q.speed, noseBoat: ang(nose, [u.x - q.x, 0.8 - q.y, u.z - q.z]), visLag: deg(Math.abs(ph - pv)) });
      }
      return ob.apply(this, arguments);
    };
    const T = WW.time.now;
    let floorT = 0, runT = 0;   // time a strafing plane (run / pull-out) spends pinned on the floor (skimming the waves)
    while (WW.time.now - T < secs) {
      __sim.fastForward(0.05);
      for (const q of WW.world.planes) if (q.alive && q.strafe && q.sf && q.sf.ph !== 'setup') { runT += 0.05; if (q.y <= q.floorAt(q.x, q.z) + 0.01) floorT += 0.05; }
    }
    TR.burst = ob;
    return { n: rec.length, rec, st: WW.strafe.stats, floorT, runT };
  }, [SEED, SECS]);
  const s = k => { const v = r.rec.map(o => o[k]).sort((a, b) => a - b); return v.length ? `${k}: med ${v[v.length >> 1].toFixed(1)} p90 ${v[Math.floor(v.length * 0.9)].toFixed(1)} max ${v[v.length - 1].toFixed(1)}` : k + ': -'; };
  console.log('seed', SEED, 'volleys', r.n, JSON.stringify(r.st), 'run/out s', r.runT.toFixed(1), 'on the floor s', r.floorT.toFixed(1));
  for (const k of ['noseTr', 'velTr', 'noseVel', 'pitch', 'path', 'trDown', 'y', 'd', 'speed', 'noseBoat', 'visLag']) console.log('  ' + s(k));
  if (errs.length) console.log('errors', errs.slice(0, 3));
  await b.close();
})();
