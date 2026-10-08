// Final verification for Fleet Battle 1942.
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'rt'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SH = n => 'shots/final_' + n + '.png';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto');
  await p.waitForTimeout(2000);
  await p.screenshot({ path: SH('01_load') });
  // install the nav probe: run sim in chunks, checking every step
  await p.evaluate(() => {
    window.__nav = { bad: 0, steps: 0, ex: [] };
    window.ff = (sec) => __sim.fastForward(sec, () => {
      __nav.steps++;
      for (const s of WW.world.ships) {
        if (!s.alive || s.sinking) continue;
        if (!WW.terrain.isNavigable(s.x, s.z, s.stats.minDepth)) { __nav.bad++; if (__nav.ex.length < 5) __nav.ex.push(s.type + '@' + s.x.toFixed(1) + ',' + s.z.toFixed(1) + ' d=' + WW.terrain.depthAt(s.x, s.z).toFixed(2)); }
      }
    });
    // run until cond() or max seconds
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { if (cond()) return true; ff(0.25); } return cond(); };
  });
  const freezeShot = async (name, settle) => {
    await p.evaluate(() => __sim.setScale(0.1));
    await p.waitForTimeout(settle || 300);
    await p.screenshot({ path: SH(name) });
    await p.evaluate(() => __sim.setScale(1));
  };
  // a cinematic shot chosen by the director
  await p.evaluate(() => ff(45)); await p.evaluate(() => __sim.snapCamera());
  await freezeShot('01b_cinematic', 1200);
  // air strike
  let ok = await p.evaluate(() => until(() => WW.world.planes.filter(q => q.alive && q.state === 'attack').length >= 3, 120));
  await p.evaluate(() => { const a = WW.world.planes.filter(q => q.alive && q.state === 'attack'); let x = 0, z = 0; a.forEach(q => { x += q.x; z += q.z; }); __sim.focus(x / a.length, z / a.length, 120, 6); });
  await freezeShot('02_airstrike');
  console.log('airstrike found', ok);
  // ship sinking
  ok = await p.evaluate(() => until(() => WW.world.ships.some(s => s.sinking && s.sinkT > 1.5 && s.sinkT < 4 && s.type !== 'pt'), 200));
  await p.evaluate(() => { const s = WW.world.ships.find(s => s.sinking && s.sinkT > 1.5); if (s) __sim.focus(s.x, s.z, 90, 6); });
  await freezeShot('03_sinking');
  console.log('sinking found', ok);
  // visible wreck in shallow water (the tallest one)
  ok = await p.evaluate(() => until(() => (WW.world.wrecks || []).some(w => w.top > 3 && w.type !== 'pt' && WW.time.now - w.born > 15), 500));
  await p.evaluate(() => { const w = WW.world.wrecks.filter(w => w.type !== 'pt' && WW.time.now - w.born > 15).sort((a, b) => b.top - a.top)[0]; if (w) __sim.focus(w.x, w.z, 70, 6); });
  await freezeShot('04_wreck');
  console.log('wreck found', ok, await p.evaluate(() => WW.world.wrecks.map(w => w.type + ':' + w.top.toFixed(1)).join(',')));
  // victory
  const round0 = await p.evaluate(() => WW.stats.round);
  ok = await p.evaluate(() => until(() => WW.game.state === 'victory', 400));
  await p.evaluate(() => __sim.snapCamera());
  await freezeShot('05_victory', 2200); // let the caption fade in
  const rlen = await p.evaluate(() => WW.game.roundTime);
  console.log('victory', ok, 'winner', await p.evaluate(() => WW.game.winner), 'round sim time', rlen.toFixed(1));
  ok = await p.evaluate(() => until(() => WW.game.state === 'battle', 30));
  await p.evaluate(() => ff(3)); await p.evaluate(() => __sim.snapCamera());
  await freezeShot('06_next_round');
  const round1 = await p.evaluate(() => WW.stats.round);
  console.log('next round', round0, '->', round1);
  // leak check: 10 more rounds
  const mem = [];
  const lengths = [];
  for (let r = 0; r < 10; r++) {
    const L = await p.evaluate(() => { until(() => WW.game.state === 'victory', 400); const t = WW.game.roundTime; until(() => WW.game.state === 'battle', 30); return t; });
    lengths.push(Math.round(L) + (L >= 329.9 ? 'T' : ''));
    await p.waitForTimeout(150); // let a real frame render
    mem.push(await p.evaluate(() => ({ g: WW.renderer.info.memory.geometries, t: WW.renderer.info.memory.textures, c: WW.scene.children.length - WW.world.ships.length - 2 * WW.world.planes.length, ships: WW.world.ships.length, round: WW.stats.round })));
  }
  console.log('round lengths', lengths.join(' '), 'avg', (lengths.reduce((a, c) => a + parseInt(c), 0) / lengths.length).toFixed(0), 'timeouts', lengths.filter(x => /T/.test(x)).length);
  console.log('memory', mem.map(m => `r${m.round}:g${m.g}/t${m.t}/c${m.c}`).join(' '));
  // setup mode with clicks
  await p.evaluate(() => { WW.game.enterSetup(true); WW.game.composition = []; WW.game.enterSetup(false); });
  await p.waitForTimeout(1000); // camera cuts to the map view
  const clicks = await p.evaluate(() => {
    const v = new THREE.Vector3(), out = [];
    const want = [['carrier', 'USN', 20, 70], ['battleship', 'USN', 60, 110], ['destroyer', 'USN', 90, 130], ['destroyer', 'USN', 90, 130],
                  ['carrier', 'IJN', 400, 460], ['cruiser', 'IJN', 360, 420], ['destroyer', 'IJN', 340, 390], ['pt', 'IJN', 330, 380]];
    for (const [type, nation, a, b] of want) {
      const q = WW.terrain.randomSeaPoint(WW.SHIP_TYPES[type].minDepth + 1, a, b);
      v.set(q.x, 0, q.z).project(WW.camera);
      out.push({ type, nation, sx: (v.x * 0.5 + 0.5) * innerWidth, sy: (-v.y * 0.5 + 0.5) * innerHeight });
    }
    return out;
  });
  const NAME = { carrier: 'Carrier', battleship: 'Battleship', cruiser: 'Cruiser', destroyer: 'Destroyer', pt: 'PT Boat' };
  for (const c of clicks) {
    await p.click(`#hud .panel.setup button:text-is("${NAME[c.type]}")`);
    const side = await p.evaluate(() => [...document.querySelectorAll('#hud .panel.setup button')].find(b => b.textContent.startsWith('Side')).textContent);
    if (!side.includes(c.nation)) { await p.click('#hud .panel.setup button:has-text("Side")'); await p.waitForTimeout(400); }
    await p.mouse.click(c.sx, c.sy);
  }
  await p.waitForTimeout(400);
  await p.screenshot({ path: SH('07_setup') });
  const comp = await p.evaluate(() => WW.game.composition.map(c => c.nation[0] + c.type).join(' '));
  console.log('setup composition', comp);
  await p.click('#hud .panel.setup button:has-text("Start")');
  await p.evaluate(() => ff(20)); await p.evaluate(() => __sim.snapCamera());
  await freezeShot('08_setup_battle');
  const fin = await p.evaluate(() => ({ stats: Object.assign({}, WW.stats), state: WW.game.state, nav: __nav }));
  // assertions
  const s = fin.stats, A = [];
  const chk = (name, v) => { A.push((v ? 'PASS ' : 'FAIL ') + name); };
  chk('no console/page errors (' + errs.length + ')', errs.length === 0);
  chk('planesLaunched>0 (' + s.planesLaunched + ')', s.planesLaunched > 0);
  chk('planesLanded>0 (' + s.planesLanded + ')', s.planesLanded > 0);
  chk('shellsFired>0 (' + s.shellsFired + ')', s.shellsFired > 0);
  chk('torpedoesFired>0 (' + s.torpedoesFired + ')', s.torpedoesFired > 0);
  chk('depthCharges>0 (' + s.depthCharges + ')', s.depthCharges > 0);
  chk('shipsSunk>0 (' + s.shipsSunk + ')', s.shipsSunk > 0);
  chk('round advanced (' + s.round + ')', round1 > round0 && s.round >= 12);
  chk('no live ship on non-navigable water (' + fin.nav.bad + ' bad in ' + fin.nav.steps + ' steps ' + fin.nav.ex.join('; ') + ')', fin.nav.bad === 0);
  const m2 = mem.slice(1);
  const flat = k => Math.max(...m2.map(m => m[k])) - Math.min(...m2.map(m => m[k]));
  chk('memory flat: geometries spread ' + flat('g') + ', textures ' + flat('t') + ', scene children ' + flat('c'), flat('g') <= 2 && flat('t') === 0 && flat('c') <= 2);
  chk('setup placed ships of both nations', /U/.test(comp) && /I/.test(comp) && fin.state !== 'setup');
  A.forEach(a => console.log(a));
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));
  await b.close();
})();
