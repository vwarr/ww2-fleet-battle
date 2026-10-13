// The German side on screen (Normandy, render mode, software GL) -> tests/shots/normandy/defence_*.png
// (models_bunker.js, models_german.js, defence_fx.js). In sim-time order, so each shot's fast-forward still has work
// to do (normandy_shots.js runs bluff_close at 08:45 before its defence shots):
//   d_wn72      WN 72's 88 casemate up close from the land side (sim 30 s): the weathered concrete, the olive turf
//   d_wn62      WN 62 on the slope from the beach (sim 30 s): two 75 casemates, MG nests, mortar pits, trenches
//   d_beach     from a man's eye on the sand (~120 s): looking up at an MG nest firing on his squad, tracers coming in
//   d_sea       from a craft's bow ~70 u out (~150 s): the bluffs with tracer streams, embrasure flashes, strikes
//   d_crew      an MG nest close (~170 s): the crew in Feldgrau beside a GI for scale (a squad near it, or none)
//   d_out       a knocked-out casemate (~260 s): burnt, cracked, the slab broken, smoke
//   d_turf      the bluff_close view at 08:45: the casemate's turf against the bluff
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/defence_shots.js [seed=1] [shot,...]
const { chromium } = require('playwright');
const path = require('path'), OUT = path.join(__dirname, 'shots', 'normandy');
require('fs').mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 1), ONLY = process.argv[3] || null;
const SHOTS = [
  ['d_wn72', () => { const e = WW.coastDefence.wnOf('WN72').elements[0]; warm(); return [e.x - 6, e.y + 3.2, e.z + 9, e.x + 1, e.y + 0.5, e.z]; }],
  ['d_wn62', () => { const e = WW.coastDefence.wnOf('WN62').elements[0]; warm(); return [e.x - 18, e.y + 4, e.z - 24, e.x + 4, e.y + 1, e.z + 2]; }],
  ['d_beach', () => { __sim.fastForward(Math.max(0, 120 - WW.game.roundTime)); let e = null, t = null; for (let i = 0; i < 60 && !t; i++) { const now = WW.time.now; for (const q of WW.coastDefence.elements) { const st = WW.defenceFx._state(q); if (q.alive && q.kind === 'mg' && st && st.tgt && st.tgt.isSquad && st.tgt.alive && now - st.actT < 1) { e = q; t = st.tgt; break; } } if (!t) __sim.fastForward(1); } if (!t) { e = WW.coastDefence.elements.find(q => q.alive && q.kind === 'mg'); t = { x: e.x, z: e.z - 30 }; } warm(); const dx = e.x - t.x, dz = e.z - t.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, px = t.x - ux * 3 + uz * 2, pz = t.z - uz * 3 - ux * 2; return [px, Math.max(WW.tide.level(), WW.terrain.heightRaw(px, pz)) + 0.6, pz, e.x, e.y + 0.3, e.z]; }],
  ['d_sea', () => { __sim.fastForward(Math.max(0, 150 - WW.game.roundTime)); warm(); const x = 1700, z = T.shoreZ(x); return [x - 20, 3, z - 70, x + 10, 2.5, z + 25]; }],
  ['d_crew', () => { __sim.fastForward(Math.max(0, 170 - WW.game.roundTime)); const els = WW.coastDefence.elements.filter(q => q.alive && q.kind === 'mg'); let e = null, best = 1e9; for (const q of els) for (const s of WW.infantry.squads) { if (!s.alive || s.kind === 'tank') continue; const d = Math.hypot(s.x - q.x, s.z - q.z); if (d < best) { best = d; e = q; } } e = e || els[0]; warm(); const c = Math.cos(e.heading), s = Math.sin(e.heading); return [e.x - c * 2.6 - s * 2.2, e.y + 1.4, e.z - s * 2.6 + c * 2.2, e.x + c * 0.5, e.y + 0.1, e.z + s * 0.5]; }],
  ['d_out', () => { __sim.fastForward(Math.max(0, 260 - WW.game.roundTime)); let e; for (let i = 0; i < 120 && !(e = WW.coastDefence.elements.find(q => !q.alive && !q.dormant && q.type === 'casemate')); i++) __sim.fastForward(2); e = e || WW.coastDefence.elements.filter(q => !q.alive && !q.dormant && q.type !== 'wall')[0] || WW.coastDefence.elements[0]; warm(); const c = Math.cos(e.heading), s = Math.sin(e.heading); return [e.x + c * 7 - s * 4, e.y + 3.5, e.z + s * 7 + c * 4, e.x, e.y + 0.6, e.z]; }],
  ['d_turf', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(8 * 60 + 45)) __sim.fastForward(1); warm(); const x = 1690, z = T.shingleZ(x); return [x - 14, 5, z - 6, x + 2, 1.5, z + 14]; }]
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?scn=normandy&v=' + Date.now(), { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .msg { display: none !important; }' });
  await p.evaluate(seed => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    WW.game.composition = null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    __sim.fastForward(30); WW.time.scale = 0.0001;
    window.T = WW.normandyTerrain;
    // step the sim and the defence visuals together for a second, then freeze: bursts, tracers, strikes in flight
    window.warm = () => { for (let i = 0; i < 36; i++) { __sim.fastForward(1 / 30); WW.defenceFx.update(); } };
  }, SEED);
  const done = [];
  for (const [name, fn] of SHOTS) {
    if (ONLY && !ONLY.split(',').includes(name)) continue;
    await p.evaluate(src => {
      WW.time.scale = 0.0001;
      const v = eval('(' + src + ')')();
      WW.cam.update = function () { WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); };
    }, fn.toString());
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    done.push(name);
  }
  console.log('shots in', OUT, done.join(' '), ' errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
