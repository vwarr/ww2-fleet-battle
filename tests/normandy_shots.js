// Normandy screenshots (render mode, software GL) -> tests/shots/normandy/*.png (docs/NORMANDY_PLAN.md: the look)
//   overview   the whole coast from high over the Channel: Pointe du Hoc, the cliffs, Omaha's bay
//   fleet      the coast seen from the bombardment line, ~450 u out
//   beach      Dog Green at low water: the obstacle belts, the shingle, the sea wall, the bluffs behind
//   draw       the E-1 draw (St-Laurent) from just off the beach: the notch in the bluffs
//   hoc        Pointe du Hoc from the north-east: the sheer headland, the cratered top
//   plateau    the bluff top and the bocage behind Vierville: fields, hedgerows, the church
//   wn72       WN 72 at Vierville: the 88 casemate in the sea wall, enfilading Dog Green, the 50 mm beside it
//   wn62       WN 62 above Easy Red / Fox Green: the two 75 mm casemates on the slope, MG nests, mortar pits
//   texas      USS Texas on her bombardment line, Pointe du Hoc beyond (sim 30 s: the pre-planned fire)
//   ddrun      a destroyer closed on the beach firing along it (sim 300 s, after the H+60 close)
//   run_in     the first wave running in to Dog Green (sim 50 s): LCVPs in line abreast, the DD tanks swimming
//   ramps      Easy Red at H+40 (sim 160 s): craft beached with their ramps down, a wreck burning
//   shingle    Easy Red at H+35 (sim 150 s): men at the shingle, the wounded and the dead on the sand, craft behind
//   bluff      the men climbing the bluff between the draws (sim 300 s)
//   soldiers   close up on a squad ashore (the figures: run / crouch / prone poses, the fallen)
//   pinned     close up on men pinned down (prone: the test forces their suppression for the still)
//   b24        a B-24 box crossing the coast at ~6,000 m (sim 40 s)
//   p47        a P-47 flight diving on a strongpoint (sim 240 s)
//   inland     the plateau running on past the map's south edge (the terrain skirts)
//   plot       the plot table (map view): the coastline chart from the depth grid
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/normandy_shots.js [seed=1] [shot,...]
const { chromium } = require('playwright');
const path = require('path'), OUT = path.join(__dirname, 'shots', 'normandy');
require('fs').mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 1), ONLY = process.argv[3] || null;
// [name, page-side function returning the camera [x, y, z, tx, ty, tz]]; T = WW.normandyTerrain
const SHOTS = [
  ['overview', () => [1350, 520, 300, 1350, 0, 1120]],
  ['fleet', () => { const z = T.shoreZ(1600); return [1450, 14, z - 430, 1640, 3, z - 20]; }],
  ['beach', () => { const z = T.shoreZ(1400); return [1385, 4, z - 45, 1410, 2, z + 30]; }],
  ['draw', () => { const z = T.shoreZ(1690); return [1690, 12, z - 70, 1690, 3, z + 50]; }],
  ['hoc', () => { const z = T.shoreZ(725); return [800, 20, z - 60, 725, 3, z + 15]; }],
  ['wn72', () => { const e = WW.coastDefence.wnOf('WN72').elements[0]; return [e.x + 22, e.y + 6, e.z - 16, e.x, e.y + 0.5, e.z]; }],
  ['wn62', () => { const e = WW.coastDefence.wnOf('WN62').elements[0]; return [e.x - 26, e.y + 9, e.z - 22, e.x + 4, e.y, e.z + 2]; }],
  ['texas', () => { const s = WW.world.ships.find(q => q.name === 'Texas'); return [s.x - 30, 9, s.z - 22, s.x + 10, 2, s.z + 40]; }],
  ['ddrun', () => { __sim.fastForward(300); const s = WW.world.ships.filter(q => q.type === 'destroyer' && q.alive).sort((a, b) => b.z - a.z)[0]; return [s.x - 25, 7, s.z - 25, s.x + 10, 2, s.z + 50]; }],
  ['run_in', () => { __sim.fastForward(20); const u = WW.landingCraft.live.find(q => q.sector === 'dogGreen' && q.state === 'run') || WW.landingCraft.live[0]; return [u.x - 18, 5, u.z - 16, u.x + 6, 0.5, u.z + 30]; }],
  ['ramps', () => { __sim.fastForward(110); const z = T.shoreZ(1760); return [1740, 6, z - 40, 1765, 0.5, z + 5]; }],
  ['shingle', () => { __sim.fastForward(120); const q = WW.infantry.squads.find(q => q.alive && q.sector === 'easyRed' && q.kind !== 'tank') || WW.infantry.squads.find(q => q.alive); return [q.x - 14, 5, q.z - 18, q.x + 2, 0.5, q.z + 4]; }],
  ['bluff', () => { __sim.fastForward(270); const q = WW.infantry.squads.find(q => q.alive && q.state === 'climb') || WW.infantry.squads.find(q => q.alive); return [q.x - 16, q.y + 6, q.z - 16, q.x, q.y, q.z + 3]; }],
  ['soldiers', () => { __sim.fastForward(140); const q = WW.infantry.squads.filter(q => q.alive && q.kind !== 'tank' && q.men > 6).sort((a, b) => b.speed - a.speed)[0]; return [q.x - 3.2, q.y + 1.3, q.z - 2.6, q.x, q.y + 0.2, q.z]; }],
  ['pinned', () => { __sim.fastForward(190); const q = WW.infantry.squads.filter(q => q.alive && q.kind !== 'tank' && (q.state === 'shingle' || q.state === 'cross')).sort((a, b) => b.men - a.men)[0] || WW.infantry.squads.find(q => q.alive); WW.infantry.squads.forEach(o => { if (o.alive && Math.hypot(o.x - q.x, o.z - q.z) < 12) o.sup = 3; }); return [q.x - 3.5, q.y + 1.6, q.z - 4, q.x, q.y, q.z - 0.5]; }],
  ['b24', () => { __sim.fastForward(25); const p = WW.offmapAir.planes.find(q => q.alive && q.kind === 'b24'); return [p.x - 40, p.y - 6, p.z - 30, p.x, p.y, p.z + 10]; }],
  ['p47', () => { __sim.fastForward(160); for (let i = 0; i < 200 && !WW.offmapAir.planes.some(q => q.alive && q.kind === 'p47' && q.state === 'dive'); i++) __sim.fastForward(0.5); const p = WW.offmapAir.planes.find(q => q.alive && q.kind === 'p47' && q.state === 'dive') || WW.offmapAir.planes.find(q => q.alive && q.kind === 'p47'); return [p.x - 20, p.y + 4, p.z - 18, p.x + 8, p.y - 4, p.z + 20]; }],
  ['inland', () => [1400, 40, 1420, 1400, 4, 1750]],
  ['plateau', () => { const z = T.bluffTopZ(1385); return [1330, 16, z - 15, 1395, 3, z + 60]; }]
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?scn=normandy&v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .msg { display: none !important; }' });
  await p.evaluate(seed => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    WW.game.composition = null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    __sim.fastForward(30); WW.time.scale = 0.0001;
    window.T = WW.normandyTerrain;
  }, SEED);
  const done = [];
  for (const [name, fn] of SHOTS.concat([['plot', null]])) {
    if (ONLY && !ONLY.split(',').includes(name)) continue;
    if (!fn) { await p.evaluate(() => { delete WW.cam.update; WW.cam.mode = 'map'; WW.plot.set(null); }); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 }); done.push(name); continue; }
    await p.evaluate(src => {
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
