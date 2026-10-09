// Render-mode screenshots of the doctrine work (BASE_URL, CHROMIUM as for the other tests):
//   node tests/doctrine_shots.js <scene> <seed> [outdir]
// scenes: ring (a USN carrier inside its AA ring), vanguard (map view: the IJN surface force well ahead of its
// carriers), wake_usn / wake_ijn (a running torpedo: steam streak / faint oxygen trace), dud (a USN dud on a hull),
// lifeguard (a surfaced USN sub at a survivor pickup). The seed is a sim_behaviour.js random round (same setup).
// STEP=s: sim seconds between the shots (default 1.5); SHOTS=n (default 3); SETUP=auto: the round tests/doctrine.js
// runs for that seed (its JSON shows which seeds had a lifeguard claim), else sim_behaviour.js's.
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
  const found = await p.evaluate(({ seed, scene, auto }) => {
    const G = WW.game;
    __sim.setScale(0.1);
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    if (WW.aces) WW.aces.reset();
    if (auto) { WW.time.now = 0; WW.time.warp = 1; G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true }); } // tests/doctrine.js's seeds
    else {
      const comp = G.randomComposition();
      WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
      G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    }
    const torps = () => (WW.combat._i.active || []).filter(q => q.kind === 'torp' && !q.dead);
    const ok = () => {
      const L = WW.world.ships.filter(s => s.alive && !s.sinking);
      if (scene === 'ring') {
        for (const cv of L) {
          if (cv.nation !== 'USN' || cv.type !== 'carrier' || G.roundTime < 40) continue;
          const esc = L.filter(s => s.ringCv === cv && WW.dist(s.x, s.z, cv.x, cv.z) < 48);
          if (esc.length >= 2) return { x: cv.x, z: cv.z, w: 120, who: 'USN carrier ring: ' + esc.map(s => s.type + ' ' + WW.dist(s.x, s.z, cv.x, cv.z).toFixed(0)).join(', '), subj: cv };
        }
      } else if (scene === 'vanguard') {
        const cv = L.find(s => s.nation === 'IJN' && s.type === 'carrier'), main = L.filter(s => s.nation === 'IJN' && (WW.fleetCmd.order(s) || {}).group === 'main');
        if (cv && main.length) {
          const mx = main.reduce((a, s) => a + s.x, 0) / main.length;
          if (cv.x - mx > 230) { WW.cam.toggle(); return { map: true, who: 'IJN vanguard ' + (cv.x - mx).toFixed(0) + ' ahead of its carrier, ' + WW.fleetCmd.side('IJN').posture }; }
        }
      } else if (scene === 'wake_usn' || scene === 'wake_ijn') {
        const n = scene === 'wake_usn' ? 'USN' : 'IJN';
        // a ship-launched torpedo well into its run with open water ahead (no hull within 45 of its next 3 s)
        const q = torps().find(q => q.nation === n && q.run > 8 && q.range - q.run > 40 &&
          !L.some(s => WW.dist(s.x, s.z, q.x + Math.cos(q.h) * q.sp * 1.5, q.z + Math.sin(q.h) * q.sp * 1.5) < 25));
        // the camera follows the torpedo itself (a moving orbit subject)
        if (q) return { x: q.x, z: q.z, w: 30, who: n + ' torpedo (' + (q.owner && q.owner.type || 'plane') + ') run ' + q.run.toFixed(0) + ' sight ' + q.sight, subj: { get x() { return q.x; }, get z() { return q.z; }, y: 0, alive: true } };
      } else if (scene === 'dud') {
        for (const q of torps()) {
          if (!q.dud) continue;
          const h = L.find(s => s.nation !== q.nation && WW.dist(s.x, s.z, q.x, q.z) < 22 && Math.abs(WW.angleDiff(q.h, Math.atan2(s.z - q.z, s.x - q.x))) < 0.25);
          if (h) return { x: (q.x + h.x) / 2, z: (q.z + h.z) / 2, w: 35, who: 'USN dud closing on ' + h.nation + ' ' + h.type, subj: h };
        }
      } else if (scene === 'lifeguard') {
        const s = L.find(s => s.type === 'submarine' && s.rescue && WW.dist(s.x, s.z, s.rescue.x, s.rescue.z) < s.rescue.r + 70);
        if (s) return { x: s.x, z: s.z, w: 45, who: 'USN sub lifeguard, ' + s.rescue.kind + ' x' + s.rescue.n + ' submerged ' + s.submerged, subj: s };
      }
      return null;
    };
    const step = scene === 'dud' ? 0.1 : auto ? 2 : 0.5; // auto: the same fastForward chunks as tests/doctrine.js (the same round)
    while (G.state === 'battle' && G.roundTime < 600) {
      __sim.fastForward(step);
      const f = ok();
      if (!f) continue;
      const subj = f.subj; delete f.subj; delete f.proj;
      if (!f.map) { if (subj && WW.cam.film) WW.cam.film({ kind: 'orbit', subj, r: f.w * 0.55, dur: 20, w: 0.05 }); else __sim.focus(f.x, f.z, f.w, 20); }
      f.t = G.roundTime; return f;
    }
    return null;
  }, { seed, scene, auto: process.env.SETUP === 'auto' });
  console.log(scene, seed, JSON.stringify(found));
  if (found) {
    const n = +(process.env.SHOTS || 3);
    for (let i = 0; i < n; i++) {
      await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${scene}_${seed}_${i}.png` });
      await p.evaluate(s => __sim.fastForward(s), +(process.env.STEP || (scene === 'dud' ? 0.6 : scene.startsWith('wake') ? 0.4 : 1.5)));
    }
  }
  await b.close();
})();
