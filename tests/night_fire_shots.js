// Burning ships at night (render mode, software GL): a small fire, a heavily burning ship and a sinking ship burning,
// each close, medium and wide, early in a night round (before the fleets meet, so only the forced fires burn).
// Writes <out>/*.png (default tests/shots/night_fire).
// Usage: BASE_URL=http://localhost:PORT/ node tests/night_fire_shots.js [out] [seed=4]
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'shots', 'night_fire'); fs.mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[3] || 4);
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.setDefaultTimeout(600000);
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now(), { timeout: 600000, waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.WW && WW.game && window.__sim, null, { timeout: 600000 });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(seed => {
    __sim.setScale(0.05);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      const o = L.s ? L.s : L;
      WW.camera.position.set(o.x + L.d * L.ax, L.y + L.h, o.z + L.d * L.az); WW.camera.lookAt(o.x, L.y, o.z); WW.camera.updateMatrixWorld();
    };
    window.look = (s, d, h, brg, y) => { window.__look = { s, d, h, ax: Math.cos(brg), az: Math.sin(brg), y: y || 2 }; };
    const G = WW.game; window.__look = null;
    if (WW.aces) WW.aces.reset();
    WW.dayNight.force = 'night'; WW.dayNight.pin = null; WW.weather.force = 'clear';
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    __sim.fastForward(4);
    const ok = s => s.alive && !s.submerged && s.type !== 'pt' && s.type !== 'submarine';
    const ships = WW.world.ships.filter(ok);
    const pick = (types, not) => ships.find(s => types.includes(s.type) && !not.includes(s));
    const small = pick(['cruiser', 'destroyer'], []);
    const heavy = pick(['battleship', 'cruiser', 'carrier'], [small]);
    const sink = pick(['destroyer', 'cruiser'], [small, heavy]);
    const hitAt = (s, amt, a, kind, cal) => { const c = Math.cos(s.heading), sn = Math.sin(s.heading), x = s.x + c * a * s.stats.length, z = s.z + sn * a * s.stats.length; s.takeDamage(amt, x, z, kind, cal); };
    // a small fire: just under half hp, one medium shell hit amidships
    small.hp = small.maxHp * 0.48; hitAt(small, 1, 0.05, 'shell', 'med');
    // heavily burning: bombs fore and aft and amidships, under 30% (the permanent critical fire)
    heavy.hp = heavy.maxHp * 0.35; for (const a of [-0.3, -0.1, 0.12, 0.3]) hitAt(heavy, heavy.maxHp * 0.03, a, 'bomb');
    // sinking: torpedoed after a bomb fire
    hitAt(sink, sink.maxHp * 0.3, 0.1, 'bomb');
    window.__fs = { small, heavy, sink };
    return { small: small.type + ' ' + small.nation, heavy: heavy.type + ' ' + heavy.nation + ' crit=' + heavy.dmgCrit, sink: sink.type + ' ' + sink.nation };
  }, SEED);
  console.log('ships', JSON.stringify(r));
  await p.evaluate(() => __sim.fastForward(0.5));
  const shot = async (name, wait) => { await p.waitForTimeout(wait || 900); await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 300000 }); console.log('shot', name, JSON.stringify(await p.evaluate(() => ({ dl: +WW.daylight.toFixed(2), fx: WW.nightFx && WW.nightFx.stats() })))); };
  for (const k of ['small', 'heavy']) {
    await p.evaluate(k => { const s = __fs[k], L = s.stats.length; look(s, L * 0.9 + 6, 4, s.heading + 1.9, 2); }, k); await shot(k + '_1_close');
    await p.evaluate(k => { const s = __fs[k], L = s.stats.length; look(s, L * 2.6 + 22, 12, s.heading + 2.2, 2); }, k); await shot(k + '_2_medium');
    await p.evaluate(k => { const s = __fs[k]; look(s, 260, 55, s.heading + 2.4, 2); }, k); await shot(k + '_3_wide');
  }
  // the sinking ship: torpedo her now, then film her going down while she burns
  await p.evaluate(() => { const s = __fs.sink; s.takeDamage(s.maxHp, s.x, s.z, 'torpedo'); __sim.fastForward(1.5); const L = s.stats.length; look(s, L * 2.2 + 18, 9, s.heading + 2.0, 1); });
  await shot('sink_1_medium', 1200);
  await p.evaluate(() => { const s = __fs.sink; look(s, 200, 40, s.heading + 2.4, 1); }); await shot('sink_2_wide');
  // a few seconds on: the breakup flash gone, she settles, still burning (night_fx burns sinking ships to sinkT 8)
  await p.evaluate(() => { __sim.fastForward(3.5); const s = __fs.sink, L = s.stats.length; look(s, L * 1.8 + 14, 6, s.heading + 2.0, 1); });
  await shot('sink_3_settling', 1000);
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
