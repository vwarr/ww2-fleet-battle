// Render-mode screenshots of the endgame (BASE_URL, CHROMIUM as for the other tests): node tests/endgame_shots.js <scene> <seed> [outdir]
// scenes: cripple (a slowed, listing cripple run down), rescue (a USN DD picking up lifeboats), retreat (IJN fleet running east)
// The seed is a sim_behaviour.js random round (same setup); good ones: cripple 9, rescue 19, retreat 8. STEP=s: sim
// seconds between the 4 shots (default 3).
const { chromium } = require('playwright');
const scene = process.argv[2], seed = +process.argv[3], out = process.argv[4] || require('path').join(__dirname, 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(2000);
  const found = await p.evaluate(({ seed, scene }) => {
    const G = WW.game;
    __sim.setScale(0.1);
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    const ok = () => {
      const L = WW.world.ships.filter(s => s.alive && !s.sinking);
      if (scene === 'cripple') {
        for (const s of L) {
          if (s.type === 'pt' || s.type === 'submarine' || s.speedK > 0.55 || s.hp > 0.3 * s.maxHp) continue;
          const foe = WW.fleetCmd.side(WW.enemyOf(s.nation));
          if (foe.posture !== 'pursue') continue;
          const h = L.find(o => o.nation !== s.nation && o.target === s && { battleship: 1, cruiser: 1, destroyer: 1 }[o.type] && WW.dist(o.x, o.z, s.x, s.z) < 130);
          if (h) return { x: (s.x * 2 + h.x) / 3, z: (s.z * 2 + h.z) / 3, w: 70, who: s.nation + ' ' + s.type + ' hp ' + (s.hp / s.maxHp).toFixed(2) + ' speedK ' + s.speedK.toFixed(2) + ' list ' + (s.listRoll + s.cripList()).toFixed(3) + ' hunted by ' + h.type, subj: s };
        }
      } else if (scene === 'rescue') {
        for (const t of WW.endgame.tasks()) {
          if (t.done || !t.by || t.kind !== 'ship') continue;
          const d = WW.dist(t.by.x, t.by.z, t.x, t.z);
          if (d < t.r + 35 && WW.lifeboats.stats().row > 0) return { x: t.by.x, z: t.by.z, w: 45, who: 'rescuer ' + t.by.type + ' d ' + d.toFixed(0) + ' pick ' + t.pick.toFixed(1) + ' boats ' + JSON.stringify(WW.lifeboats.stats()), subj: t.by };
        }
      } else if (scene === 'retreat') {
        const B = WW.fleetCmd.side('IJN');
        if (B.brokenAt && WW.time.now - B.brokenAt > 20) {
          const I = L.filter(s => s.nation === 'IJN' && s.type !== 'submarine');
          if (I.length >= 2) {
            let x = 0, z = 0; I.forEach(s => { x += s.x; z += s.z; });
            return { x: x / I.length, z: z / I.length, w: 220, who: I.map(s => s.type + '@' + (s.x | 0) + ' h' + (s.heading).toFixed(2) + ' esc' + s.escapeEdge).join(' '), subj: null };
          }
        }
      }
      return null;
    };
    while (G.state === 'battle' && G.roundTime < 600) {
      __sim.fastForward(0.5);
      const f = ok();
      if (f) { const subj = f.subj; delete f.subj; if (subj && WW.cam.film) WW.cam.film({ kind: 'orbit', subj, r: f.w * 0.55, dur: 20, w: 0.05 }); else __sim.focus(f.x, f.z, f.w, 20); f.t = G.roundTime; return f; }
    }
    return null;
  }, { seed, scene });
  console.log(scene, seed, JSON.stringify(found));
  if (found) {
    for (let i = 0; i < 4; i++) { await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${scene}_${seed}_${i}.png` }); await p.evaluate(s => __sim.fastForward(s), +(process.env.STEP || 3)); }
  }
  await b.close();
})();
