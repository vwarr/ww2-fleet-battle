// Strike-planning screenshots (air_staff.js): a strike flying round an enemy island base on its plotted dogleg (wide and
// close), and an escorted strike whose fighters peel off to take on the CAP. Writes tests/shots/strike_*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/strike_shots.js [seed0=1] [base=USN]
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SEED0 = +(process.argv[2] || 1), BASE = process.argv[3] || 'USN';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2000);
  await p.evaluate(() => {
    __sim.setScale(0.1);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * L.ax, L.y + L.h, L.z + L.d * L.az); WW.camera.lookAt(L.x, L.y, L.z); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    window.start = (seed, base) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = G.randomComposition(); G.baseChoice = base; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
      if (WW.dayNight) WW.dayNight.force = null;
    };
  });
  const shot = async (name) => { await p.waitForTimeout(500); await p.screenshot({ path: 'shots/strike_' + name + '.png' }); console.log('shot shots/strike_' + name + '.png'); };

  // 1. a strike on its dogleg round the enemy island base (closest approach well outside the field)
  let got = null;
  for (let s = SEED0; s < SEED0 + 12 && !got; s++) {
    got = await p.evaluate(([seed, base]) => {
      start(seed, base);
      return until(() => {
        const B = WW.islandBase.base; if (!B) return 'nobase';
        for (const w of WW.strike._waves()) {
          if (!w.go || w.done || w.nation === B.nation || w.target === B || !w.route || w.carrier.isBase) continue;
          const d = Math.hypot(w.x - B.x, w.z - B.z), t = w.target, dt = t ? Math.hypot(t.x - B.x, t.z - B.z) : 0;
          const segD = (a, c) => { const vx = c.x - a.x, vz = c.z - a.z, L2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((B.x - a.x) * vx + (B.z - a.z) * vz) / L2)); return Math.hypot(a.x + vx * u - B.x, a.z + vz * u - B.z); };
          const ipq = t && { x: t.x + Math.cos(w.route.b || 0) * 230, z: t.z + Math.sin(w.route.b || 0) * 230 };
          const clear = w.route.via && segD(w, w.route.via) > 140 && segD(w.route.via, ipq) > 140 && segD(ipq, t) > 140, straight = t && segD(w, t) < 100;
          if (clear && straight && d < 420 && dt > 300) {
            // the plotted route as an overlay (test only): wave -> via -> IP -> target in yellow, the base's avoid ring in red
            const k = t, ip = { x: k.x + Math.cos(w.route.b) * 230, z: k.z + Math.sin(w.route.b) * 230 }, Y = 30, T3 = THREE;
            const line = (P, col) => { const g = new T3.BufferGeometry().setFromPoints(P.map(q => new T3.Vector3(q.x, Y, q.z))); const m = new T3.Line(g, new T3.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.85 })); m.renderOrder = 999; WW.scene.add(m); };
            line([{ x: w.x, z: w.z }, w.route.via, ip, { x: k.x, z: k.z }], 0xffc830);
            const ring = []; for (let i = 0; i <= 48; i++) ring.push({ x: B.x + Math.cos(i / 48 * 6.283) * 140, z: B.z + Math.sin(i / 48 * 6.283) * 140 }); line(ring, 0xff5040);
            const xs = [w.x, w.route.via.x, ip.x, k.x, B.x], zs = [w.z, w.route.via.z, ip.z, k.z, B.z];
            const mx = (Math.min(...xs) + Math.max(...xs)) / 2, mz = (Math.min(...zs) + Math.max(...zs)) / 2, span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
            window.__look = { x: mx, y: 0, z: mz, d: span * 0.25, h: span * 0.95 + 150, ax: 0, az: 1 };
            window.__w = w;
            return `seed ${seed}: ${w.nation} strike on a ${t.type} ${d.toFixed(0)} from ${B.name}, ${w.members.filter(m => m.alive).length} planes, via (${w.route.via.x.toFixed(0)}, ${w.route.via.z.toFixed(0)})`;
          }
        }
        return WW.game.state !== 'battle' || WW.game.roundTime > 420 ? 'none' : null;
      }, 460);
    }, [s, BASE]);
    if (got === 'none' || got === 'nobase') { console.log('seed', s, got); got = null; }
  }
  console.log('around the base:', got);
  if (got) {
    await shot('around_base_wide');
    await p.evaluate(() => { const w = window.__w, q = w.members.find(m => m.alive && m.kind !== 'fighter') || w.members[0]; window.__look = { x: q.x, y: q.y, z: q.z, d: 60, h: 28, ax: Math.cos(q.heading + Math.PI + 0.5), az: Math.sin(q.heading + Math.PI + 0.5) }; });
    await shot('around_base_close');
  }
  // 2. escorts peeling off the strike to engage the CAP (an escort with an enemy fighter as its foe, bombers near)
  let esc = null;
  for (let s = SEED0 + 20; s < SEED0 + 28 && (!esc || esc === 'over'); s++) esc = await p.evaluate(([seed]) => { start(seed, null); return until(() => {
    for (const q of WW.world.planes) {
      if (!q.alive || q.kind !== 'fighter' || !q.target || !q.foe || q.foe.kind !== 'fighter' || !q.foe.alive) continue;
      const bs = WW.world.planes.filter(m => m.alive && m.ordnance && m.carrier === q.carrier && Math.hypot(m.x - q.x, m.z - q.z) < 70);
      if (bs.length < 2 || Math.hypot(q.foe.x - q.x, q.foe.z - q.z) > 45) continue;
      const mx = (q.x + q.foe.x + bs[0].x) / 3, mz = (q.z + q.foe.z + bs[0].z) / 3, my = (q.y + bs[0].y) / 2;
      window.__look = { x: mx, y: my, z: mz, d: 55, h: 18, ax: Math.cos(q.heading + 1.9), az: Math.sin(q.heading + 1.9) };
      return `${q.nation} ${q.squadron ? q.squadron.short : ''} escort (${q.cover}) on a ${q.foe.nation} fighter, ${bs.length} bombers within 70`;
    }
    return WW.game.state !== 'battle' || WW.game.roundTime > 500 ? 'over' : null;
  }, 520); }, [s]);
  console.log('escort engaging:', esc); if (esc && esc !== 'over') await shot('escort_peel');
  console.log('staff', await p.evaluate(() => JSON.stringify(WW.staff.stats)));
  if (errs.length) console.log('errors:\n' + errs.slice(0, 8).join('\n'));
  await b.close();
})();
