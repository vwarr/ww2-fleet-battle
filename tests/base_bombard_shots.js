// Render-mode shots of a battleship bombardment of the island base (diagnosis; tests/base_bombard_probe.js bbbase):
// the same seeded round as the probe (sim_behaviour's spec, stopped at its first fastForward), stepped to the first
// shell at the base + DT s, then the field seen from behind it toward the bombarding ships; and the field after it
// was neutralized. -> tests/shots/airdiag/bombard/*.png
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/base_bombard_shots.js [seed=6] [dt=25]
'use strict';
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), OUT = path.join(__dirname, 'shots', 'airdiag', 'bombard');
fs.mkdirSync(OUT, { recursive: true });
const SB = require('./sim_behaviour');
const SEED = +(process.argv[2] || 6), DT = +(process.argv[3] || 25);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8787/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel { display: none !important; }' });
  await p.evaluate(SB.install, SB.P);
  const info = await p.evaluate(([seed]) => {
    const spec = { seed, A: ['battleship', 'battleship', 'cruiser', 'destroyer'], B: ['destroyer', 'destroyer'], aNation: 'IJN', cripple: -1, base: 'USN', light: true };
    const ff0 = __sim.fastForward; __sim.fastForward = () => { throw new Error('STOP'); };
    try { __beh.run(spec); } catch (e) { if (e.message !== 'STOP') throw e; }
    __sim.fastForward = ff0;
    WW.time.scale = 0.0001;
    window.B = WW.islandBase.base; window.__first = null; window.__aaG = 0;
    WW.on('shellFired', e => { if (!__first && e.proj && e.proj.target === B && !e.ship.isBattery) __first = WW.game.roundTime; });
    WW.on('aaLightFired', e => { if (e.target && e.target.carrier === B && WW.landGround.onGround(e.target)) __aaG++; });
    window.__ff = secs => { for (let t = 0; t < secs - 1e-6; t += 0.1) { __sim.fastForward(0.1); if (window.B) { WW.camera.position.set(B.x, 40, B.z); WW.baseFx.update(0.1); } } };
    window.__until = (f, secs) => { for (let i = 0; i < secs * 10 && WW.game.state === 'battle'; i++) { if (f()) return true; __ff(0.1); } return !!f(); };
    return { owner: B && B.nation };
  }, [SEED]);
  console.log('round set up', JSON.stringify(info));
  const shot = async (name, setup) => {
    const cam = await p.evaluate(src => { const v = eval('(' + src + ')')(); if (!v) return null;
      WW.cam.update = function () { WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); }; return v; }, setup.toString());
    if (!cam) { console.log('skip', name); return; }
    await p.evaluate(() => { for (let i = 0; i < 3; i++) { WW.cam.update(0.016); if (WW.crew) WW.crew.update(0.016); WW.baseFx.update(0.016); } });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    console.log(name, JSON.stringify(await p.evaluate(() => {
      const sl = B.slots.reduce((o, s) => (o[s.state] = (o[s.state] || 0) + 1, o), {});
      const sh = WW.world.ships.filter(s => s.alive && s.nation !== B.nation).map(s => s.type + '@' + Math.round(WW.dist(s.x, s.z, B.x, B.z)));
      return { t: +WW.game.roundTime.toFixed(0), first: __first, craters: B.craters.length, closed: B.runways.map(r => r.closed), out: B.facilities.filter(f => f.out).map(f => f.kind), slots: sl, neutralized: B.neutralized, aaAtGround: __aaG, ships: sh,
        ground: WW.world.planes.filter(q => q.carrier === B && q.alive && WW.landGround.onGround(q)).map(q => q.rwPh) };
    })));
  };
  // during the shelling: from the far side of the field, high, toward the bombarding battleships
  await shot('bombard_mid', `() => { if (!__until(() => __first !== null, 700)) return null; __ff(${DT});
    const bb = WW.world.ships.filter(s => s.alive && s.nation !== B.nation && s.type === 'battleship')[0] || WW.world.ships.find(s => s.alive && s.nation !== B.nation); if (!bb) return null;
    const a = Math.atan2(bb.z - B.z, bb.x - B.x); return [B.x - Math.cos(a) * 75, 45, B.z - Math.sin(a) * 75, B.x + Math.cos(a) * 20, 0, B.z + Math.sin(a) * 20]; }`);
  // a closer, lower look at the dispersal rows (parked planes) during the shelling
  await shot('bombard_rows', `() => { __ff(10); const r = B.layout.rows.find(r => r.spots.length >= 3) || B.layout.rows[0], sp = r.spots[Math.floor(r.spots.length / 2)];
    const L = B.layout, q = L.toW(sp.u - 30, sp.laneV - r.side * 22), t = L.toW(sp.u, sp.v); return [q.x, 20, q.z, t.x, 0.5, t.z]; }`);
  // after neutralization (or 120 s later): the field and its parked planes
  await shot('bombard_after', `() => { __until(() => B.neutralized, 150); __ff(15); const L = B.layout, c = L.toW(0, 0), e = L.toW(-30, 95); return [e.x, 85, e.z, c.x, 0, c.z]; }`);
  console.log('errors', errs.length, errs.slice(0, 3));
  await b.close();
})();
