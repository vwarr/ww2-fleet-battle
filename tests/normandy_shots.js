// Normandy screenshots (render mode, software GL) -> tests/shots/normandy/*.png (docs/NORMANDY_PLAN.md: the look)
//   overview   the whole coast from high over the Channel: Pointe du Hoc, the cliffs, Omaha's bay
//   fleet      the coast seen from the bombardment line, ~450 u out
//   beach      Dog Green at low water: the obstacle belts, the shingle, the sea wall, the bluffs behind
//   draw       the E-1 draw (St-Laurent) from just off the beach: the notch in the bluffs
//   hoc        Pointe du Hoc from the north-east: the sheer headland, the cratered top
//   plateau    the bluff top and the bocage behind Vierville: fields, hedgerows, the church
//   wn72       WN 72 at Vierville: the 88 casemate in the sea wall, enfilading Dog Green, the 50 mm beside it
//   wn62       WN 62 above Easy Red / Fox Green: the two 75 mm casemates on the slope, MG nests, mortar pits
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
    __sim.fastForward(2); WW.time.scale = 0.0001;
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
