// Island base screenshots (render mode, software GL): the new terrain, the airfield close up, a B-17 taking off,
// battleships closing on the island, a cratered and burning base, the land-plane models. -> tests/shots/base/*.png
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/base_shots.js [seed=2]
const { chromium } = require('playwright');
const path = require('path'), OUT = path.join(__dirname, 'shots', 'base');
require('fs').mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 2);
// a shot: [name, camera (array expression; S = the airfield site, B = the base, Q = the shot's subject), sim s to run first, subject]
const CHASE = 'Q?Q.x-Math.cos(Q.heading)*22+Math.sin(Q.heading)*12:480,Q?Q.y+5:100,Q?Q.z-Math.sin(Q.heading)*22-Math.cos(Q.heading)*12:300,Q?Q.x+Math.cos(Q.heading)*8:480,Q?Q.y+1:0,Q?Q.z+Math.sin(Q.heading)*8:300';
const SIDE = 'Q?Q.x-Math.sin(Q.heading)*45-Math.cos(Q.heading)*20:480,16,Q?Q.z+Math.cos(Q.heading)*45-Math.sin(Q.heading)*20:300,Q?(Q.x+B.x)/2:480,0,Q?(Q.z+B.z)/2:300';
const SHOTS = [
  ['map', '480,900,900,480,0,300', 0],
  ['wide', 'S.x-260,140,S.z+220,S.x,0,S.z', 0],
  ['airfield', 'S.x+70,45,S.z+80,S.x,0,S.z', 0],
  ['apron', 'S.x-30,14,S.z+60,S.x-10,2,S.z+15', 0],
  ['b17_roll', CHASE, 0, "__until(() => __p.rwPh === 'roll', __p)"],
  ['b17_climb', CHASE, 0, "__until(() => __p.rwPh === 'climb', __p)"],
  ['bombard', SIDE, 50, "WW.world.ships.find(s => s.alive && s.target && s.target.isBase) || WW.world.ships.find(s => s.alive && s.type === 'battleship' && s.nation !== B.nation)"],
  ['burning', 'S.x+60,40,S.z+70,S.x,0,S.z', 60]
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel { display: none !important; }' });
  await p.evaluate(seed => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    WW.game.baseChoice = 'USN'; WW.game.composition = null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    __sim.fastForward(3);
    const B = WW.islandBase.base; B.stock.b17 = (B.stock.b17 || 0) + 1; B.hangar.dive++; B.nextVariant = 'b17'; // one B-17 on its way
    window.__p = WW.air.launch(B, 'dive', WW.world.ships.find(s => s.nation === 'IJN'));
    window.__until = (f, v) => { for (let i = 0; i < 900 && !f(); i++) __sim.fastForward(0.05); return v; };
    WW.time.scale = 0.0001; // the render loop barely moves the sim: each shot is a still
  }, SEED);
  for (const [name, cam, ff, subj] of SHOTS) {
    await p.evaluate(([cam, ff, subj]) => {
      if (ff) __sim.fastForward(ff);
      const B = WW.islandBase.base;
      window.__q = subj ? eval(subj) : null;
      WW.cam.update = function () {
        const S = WW.terrain.site, B = WW.islandBase.base, Q = window.__q, v = eval('[' + cam + ']');
        WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld();
      };
    }, [cam, ff, subj || null]);
    await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(OUT, name + '.png') });
  }
  console.log('shots in', OUT, ' errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
