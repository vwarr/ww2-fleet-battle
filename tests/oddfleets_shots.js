// Render-mode screenshots of odd fleets (BASE_URL, CHROMIUM as for the other tests):
//   node tests/oddfleets_shots.js <scene> <seed> [outdir]
// The fleet is 3 USN carriers vs 10 IJN PT boats (the cv_vs_pt fuzz composition). Scenes:
//   search  - carrier search flights fanning out over the sea (wide view over the carriers)
//   spots   - the PT pairs spread over their island spots (wide view over the PT boats)
//   attack  - a PT run on a carrier, else a fighter strafing a PT boat, else bombers on a PT boat (close view)
// 4 shots, STEP sim s apart (default 3). Shots go to tests/shots/odd_<scene>_<seed>_<i>.png.
const { chromium } = require('playwright');
const scene = process.argv[2], seed = +process.argv[3] || 1, out = process.argv[4] || require('path').join(__dirname, 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(2000);
  const found = await p.evaluate(({ seed, scene }) => {
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    __sim.setScale(0.1);
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0; WW.time.warp = 1;
    if (WW.aces) WW.aces.reset();
    const comp = [];
    const ok = (t, x, z) => { for (let r = 0; r < 200; r += 4) for (let a = 0; a < 6.28; a += 0.5) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (WW.terrain.isNavigable(px, pz, WW.SHIP_TYPES[t].minDepth + 1) && comp.every(c => WW.dist(c.x, c.z, px, pz) > (t === 'carrier' || c.type === 'carrier' ? 70 : 20))) return [px, pz]; } return [x, z]; };
    for (let i = 0; i < 3; i++) { const [x, z] = ok('carrier', 80, H / 2 + (i - 1) * 90); comp.push({ type: 'carrier', nation: 'USN', x, z }); }
    for (let i = 0; i < 10; i++) { const [x, z] = ok('pt', W - 90, H / 2 + (i - 4.5) * 25); comp.push({ type: 'pt', nation: 'IJN', x, z }); }
    G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    const cen = L => { let x = 0, z = 0; L.forEach(s => { x += s.x; z += s.z; }); return { x: x / L.length, z: z / L.length }; };
    const look = () => {
      const S = WW.world.ships.filter(s => s.alive && !s.sinking);
      if (scene === 'search') {
        const sp = WW.world.planes.filter(q => q.alive && q.search && q.state === 'transit');
        if (sp.length >= 2 && sp.every(q => q.t > 12)) { const c = cen(sp.concat(S.filter(s => s.type === 'carrier'))); return { x: c.x, z: c.z, w: 420, who: sp.length + ' searchers' }; }
      } else if (scene === 'spots') {
        const pts = S.filter(s => s.type === 'pt');
        if (G.roundTime > 45 && pts.length >= 8) { const c = cen(pts); return { x: c.x, z: c.z, w: 300, who: pts.map(s => (s.x | 0) + ',' + (s.z | 0)).join(' ') }; }
      } else {
        const run = S.find(s => s.type === 'pt' && s.ai.lt && s.ai.lt.state === 'run' && s.ai.lt.tgt && s.ai.lt.tgt.type === 'carrier' && WW.dist(s.x, s.z, s.ai.lt.tgt.x, s.ai.lt.tgt.z) < 90);
        if (run) return { x: run.x, z: run.z, w: 70, who: 'PT run on carrier', subj: run };
        const sf = WW.world.planes.find(q => q.alive && q.strafe && q.sf && q.sf.ph === 'run' && WW.dist(q.x, q.z, q.strafe.x, q.strafe.z) < 70);
        if (sf) return { x: sf.strafe.x, z: sf.strafe.z, w: 60, who: 'strafe pass', subj: sf.strafe };
      }
      return null;
    };
    while (G.state === 'battle' && G.roundTime < 420) {
      __sim.fastForward(0.5);
      const f = look();
      if (f) { const subj = f.subj; delete f.subj; if (subj && WW.cam.film) WW.cam.film({ kind: 'orbit', subj, r: f.w * 0.6, dur: 20, w: 0.05 }); else __sim.focus(f.x, f.z, f.w, 20); f.t = G.roundTime; return f; }
    }
    return null;
  }, { seed, scene });
  console.log(scene, seed, JSON.stringify(found));
  if (found) {
    for (let i = 0; i < 4; i++) { await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/odd_${scene}_${seed}_${i}.png` }); await p.evaluate(s => __sim.fastForward(s), +(process.env.STEP || 3)); }
  }
  await b.close();
})();
