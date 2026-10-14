// The follow keys at dusk and night (render mode, software GL): forced dusk / night rounds (and a night bombardment
// of the island base), stepped to moments with planes still up at dusk, a night gunfight and the base being shelled;
// at each, F (and Tab / 8 / 9) through Playwright's keyboard. Logs the message, camFollow.stats, the finder's
// candidates, the camera shot before / after and how far the camera moved. Fails (exit 1) when a key does nothing.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/follow_night.js [seed=4] [cases=day,dusk,night,base]
'use strict';
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 4), ONLY = process.argv[3] ? process.argv[3].split(',') : null;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8148/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    window.round = (seed, tod, base, comp) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.dayNight.force = tod; WW.dayNight.pin = null; WW.dayNight.pinHour = null; WW.weather.force = 'clear';
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = comp || null; G.mode = 'auto'; G.noRetire = true; G.baseChoice = base || null; G.startRound({ keepMap: true });
      __sim.setScale(1);
    };
    window.until = (cond, max) => { for (let i = 0; i < max * 4 && WW.game.state === 'battle'; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    window.desc = o => !o ? null : o.pt && o.kind ? 'plane ' + o.nation + ' ' + o.kind + ' ' + (o.state || '') : o.isBase ? 'base ' + o.nation : o.diorama ? 'point' : o.type ? o.nation + ' ' + o.type + ' ' + (o.name || '') : 'pt';
    window.camInfo = () => { const s = WW.cam._shot(); const st = WW.camStory.story(); return { mode: WW.cam.mode, shot: s ? s.kind + ' ' + desc(s.subj) + (s.user ? ' user' : '') + (s.story ? ' story' : '') : null, story: st ? (st.user ? 'user ' : '') + desc(st.lead) + ' begun=' + st.begun : null, pos: WW.camera.position.toArray().map(v => +v.toFixed(1)) }; };
    window.scene = () => {
      const pl = WW.world.planes.filter(q => q.alive && !q.removed);
      const sh = WW.world.ships.filter(s => s.alive);
      const B = WW.islandBase && WW.islandBase.base;
      return { t: WW.game.roundTime | 0, state: WW.game.state, tod: WW.dayNight.kind, dl: +WW.daylight.toFixed(2), canFly: WW.dayNight.canFly(),
        planes: pl.length, airborne: pl.filter(q => q.pt && !q.onDeck && !(WW.landGround && WW.landGround.onGround(q))).length,
        firing: sh.filter(s => s.target).map(s => s.nation[0] + ':' + s.type[0] + '>' + (s.target.isBase ? 'BASE' : s.target.type || '?')).join(' '),
        base: B ? { nation: B.nation, alive: B.alive } : null,
        finder: WW.camFinder.list().slice(0, 6).map(i => i.kind + ' ' + i.label + ' eta ' + i.etaReal.toFixed(0)) };
    };
  });
  let fails = 0;
  const msg = () => p.evaluate(() => { const m = document.querySelector('.msg'); return m && m.style.display !== 'none' ? m.textContent : ''; });
  const press = async (key, name) => {
    const before = await p.evaluate(() => ({ cam: camInfo(), st: Object.assign({}, WW.camFollow.stats) }));
    await p.keyboard.press(key);
    await p.waitForTimeout(1600);
    const after = await p.evaluate(() => ({ cam: camInfo(), st: Object.assign({}, WW.camFollow.stats) }));
    const m = await msg();
    const moved = Math.hypot(...after.cam.pos.map((v, i) => v - before.cam.pos[i]));
    const did = after.st.jumps > before.st.jumps || after.st.handbacks > before.st.handbacks || after.cam.shot !== before.cam.shot;
    console.log(`  [${name}] ${key}: "${m}"  jumps ${before.st.jumps}->${after.st.jumps} handbacks ${before.st.handbacks}->${after.st.handbacks}  moved ${moved.toFixed(0)}`);
    console.log(`     before ${JSON.stringify(before.cam)}\n     after  ${JSON.stringify(after.cam)}`);
    if (!did && key === 'f') { fails++; console.log('     ** F DID NOTHING'); }
  };
  const probe = async (name) => {
    const s = await p.evaluate(() => scene());
    console.log(`${name}: ${JSON.stringify(s)}`);
    if (s.state !== 'battle') { console.log('  (round over)'); return; }
    await press('f', name);                 // jump
    await press('f', name);                 // hand back
    await press('f', name);                 // jump again
    await press('Tab', name); await press('8', name); await press('9', name);
    await press('f', name);
  };
  const want = n => !ONLY || ONLY.includes(n);
  const run = async (name, seed, tod, base, steps) => {
    if (!want(name)) return;
    await p.evaluate(([s, t, bb]) => round(s, t, bb), [seed, tod, base]);
    for (const [label, src] of steps) { await p.evaluate(src => eval(src), src); await probe(name + ' ' + label); }
  };
  await run('day', SEED, 'day', null, [['t=150', '__sim.fastForward(150)']]);
  // dusk: the sun sets 120 s in; planes still up late, then the night action
  await run('dusk', SEED + 1, 120, null, [['planes up', 'until(() => WW.world.planes.some(q => q.alive && q.state === "attack"), 400)'], ['t=+60', '__sim.fastForward(60)'], ['dark', 'until(() => WW.daylight < 0.2, 400)'], ['gunfight', 'until(() => WW.world.ships.some(s => s.alive && s.target && !s.target.isBase), 500)']]);
  await run('night', SEED + 2, 'night', null, [['t=30', '__sim.fastForward(30)'], ['gunfight', 'until(() => WW.world.ships.some(s => s.alive && s.target && !s.target.isBase), 600)'], ['+40', '__sim.fastForward(40)']]);
  await run('base', SEED + 3, 'night', 'USN', [['t=30', '__sim.fastForward(30)'], ['shelling', 'until(() => WW.world.ships.some(s => s.alive && s.target && s.target.isBase), 700)'], ['+30', '__sim.fastForward(30)']]);
  console.log('F did nothing:', fails, ' errors:', errs.length, errs.slice(0, 5));
  await b.close();
  process.exit(fails ? 1 : 0);
})();
