// Air command screenshots: CAP over a carrier, a fighter division / shotai in formation, an escorted strike,
// a coordinated VT + VB attack, and an air caption on a director shot. Writes tests/shots/air_*.png.
// Usage: BASE_URL=http://localhost:PORT/ node tests/air_shots.js [seed=3]
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2000);
  await p.evaluate((seed) => {
    __sim.setScale(0.1);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * L.ax, L.y + L.h, L.z + L.d * L.az); WW.camera.lookAt(L.x, L.y, L.z); WW.camera.updateMatrixWorld();
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    // camera behind and above o's heading (h set), else from the south-east
    window.look = (o, d, h, back) => {
      const hd = o.heading === undefined ? 0.6 : o.heading + Math.PI + (back || 0.5);
      window.__look = { x: o.x, y: o.y || 0, z: o.z, d, h, ax: Math.cos(hd), az: Math.sin(hd) };
    };
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const f = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 }, { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 50 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 50 }];
    G.composition = [...f('USN', 70, 1), ...f('IJN', W - 70, -1)];
    G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
  }, SEED);
  const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: 'shots/air_' + name + '.png' }); console.log('shot shots/air_' + name + '.png'); };

  // 1. CAP over its carrier
  const cap = await p.evaluate(() => until(() => { const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN'); const n = WW.world.planes.filter(q => q.alive && q.carrier === cv && q.kind === 'fighter' && !q.target && q.state === 'transit' && !q.deckPh && Math.hypot(q.x - cv.x, q.z - cv.z) < 45 && q.y > 20).length; if (n >= 2) { look(cv, 45, 85, 0.9); return n; } return 0; }, 60));
  console.log('CAP fighters up:', cap); await shot('cap');
  // 2. a division / shotai in formation (element leader + wingmen in transit)
  const el = await p.evaluate(() => until(() => {
    for (const q of WW.world.planes) if (q.alive && q.wing === 0 && q.kind === 'fighter' && q.element && q.element.members.length >= (q.nation === 'IJN' ? 3 : 2) && (q.nation === 'IJN' || (q.element.pair && q.element.pair.members.length >= 2)) && q.state === 'transit' && q.element.members.every(m => m.state === 'transit' && Math.hypot(m.x - q.x, m.z - q.z) < 14)) { window.__el = q; const M = q.element.members.concat(q.element.pair ? q.element.pair.members : []); const c = { x: M.reduce((a, m) => a + m.x, 0) / M.length, y: M.reduce((a, m) => a + m.y, 0) / M.length, z: M.reduce((a, m) => a + m.z, 0) / M.length, heading: q.heading }; look(c, 30, 12, 0.8); return q.nation + ' ' + q.squadron.name + ' x' + q.element.members.length + (q.element.pair ? ' +section' : ''); }
    return null;
  }, 120));
  console.log('element:', el); await shot('element');
  // 3. an escorted strike on the way (the CAG)
  const st = await p.evaluate(() => until(() => {
    for (const q of WW.world.planes) if (q.alive && q.wave && q.wave.cag === q && q.wave.go && q.sk === 'form' && q.wave.members.some(m => m.alive && m.kind === 'fighter')) { look(q, 55, 22, 0.5); return q.squadron && q.squadron.name; }
    return null;
  }, 200));
  console.log('strike lead:', st); await shot('strike');
  // 4. coordinated VT + VB attack on one target
  const co = await p.evaluate(() => until(() => {
    for (const t of WW.world.planes) if (t.alive && t.kind === 'torpedo' && t.phase === 'run' && t.target) {
      const vb = WW.world.planes.find(d => d.alive && d.kind === 'dive' && d.target === t.target && (d.phase === 'roll' || d.phase === 'dive'));
      if (vb) { const g = t.target; const mx = (t.x + vb.x + g.x) / 3, mz = (t.z + vb.z + g.z) / 3; window.__look = { x: mx, y: 10, z: mz, d: 80, h: 40, ax: Math.cos(t.heading + 1.9), az: Math.sin(t.heading + 1.9) }; return g.nation + ' ' + g.type + ' vb ' + vb.phase; }
    }
    return null;
  }, 260));
  console.log('coordinated attack:', co); await shot('vt_vb');
  // 5. a caption on a director shot: film a torpedo bomber's run (or the CAG) with the real camera
  const cap5 = await p.evaluate(() => {
    const pick = () => WW.world.planes.find(q => q.alive && q.kind === 'torpedo' && q.phase === 'run' && q.squadron) || WW.world.planes.find(q => q.alive && q.wave && q.wave.cag === q && q.sk === 'form');
    const q = until(pick, 200);
    if (!q) return null;
    window.__look = null; WW.cam.film({ kind: 'chase', subj: q, dur: 14 });
    return q.squadron.short + ' ' + q.kind;
  });
  console.log('filming:', cap5);
  for (let i = 0; i < 60 && !(await p.evaluate(() => WW.airCaptions.stats.shown)); i++) await p.waitForTimeout(500); // slow headless frames
  await p.waitForTimeout(1500); // caption fade-in
  console.log('caption:', await p.evaluate(() => JSON.stringify(WW.airCaptions.stats)));
  console.log('shot:', await p.evaluate(() => { const s = WW.cam._shot(); const q = s && (s.plane || s.subj); return JSON.stringify({ kind: s && s.kind, t: s && s.t, state: WW.game.state, mode: WW.cam.mode, capOn: WW.ui.captionOn && WW.ui.captionOn(), subj: q && (q.kind || q.type), phase: q && q.phase, sq: q && q.squadron && q.squadron.short }); }));
  await shot('caption');
  console.log('airOps', await p.evaluate(() => JSON.stringify(WW.airOps.stats)), 'cag', await p.evaluate(() => JSON.stringify(WW.cag.stats)), 'sq', await p.evaluate(() => JSON.stringify(WW.squadrons.stats)));
  if (errs.length) console.log('errors:\n' + errs.slice(0, 8).join('\n'));
  await b.close();
})();
