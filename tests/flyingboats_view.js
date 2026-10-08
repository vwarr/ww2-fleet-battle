// Flying-boat look viewer: the PBY Catalina and H6K Mavis models in 4 views each (3/4 front, side, top, 3/4 rear),
// then (with --live) a seeded battle: a Catalina landed among rafts / boats, a Mavis shadowing a fleet, CAP on a Mavis.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/flyingboats_view.js [--live] [--only models|live]
// Shots in tests/shots/fb_*.png. Render mode (WebGL on swiftshader).
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SH = n => 'shots/fb_' + n + '.png';
const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only'), SEED = +(arg('--seed') || 7);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&seed=' + SEED + '&v=' + Date.now());
  await p.waitForTimeout(3000);
  await p.evaluate(() => {
    const cam = WW.cam, upd = cam.update, ar = cam.afterRender;
    window.__view = null;
    cam.update = function (dt) { if (!window.__view) return upd.call(cam, dt); window.__view(WW.camera, dt); };
    cam.afterRender = function () { if (!window.__view && ar) return ar.call(cam); };
    if (WW.ui && WW.ui.caption) WW.ui.caption('', '', 0.01);
  });
  const shot = async (name, cx, cy, cz, tx, ty, tz) => {
    await p.evaluate(([cx, cy, cz, tx, ty, tz]) => { window.__view = c => { c.position.set(cx, cy, cz); c.lookAt(tx, ty, tz); }; }, [cx, cy, cz, tx, ty, tz]);
    await p.waitForTimeout(700); await p.screenshot({ path: SH(name) });
  };
  if (ONLY !== 'live') {
    // 1. models, sim frozen, over open water at the flight scale
    await p.evaluate(() => {
      __sim.setScale(0.0001);
      window.__fb = ['USN', 'IJN'].map((n, i) => {
        const m = WW.models.buildFlyingBoat(n); m.group.rotation.order = 'YZX'; m.group.scale.setScalar(WW.flyingBoats ? WW.flyingBoats.SCALE : 1.7);
        m.group.position.set(300, 40, 150 + i * 60); m.floats.set(n === 'USN' ? 0 : 1); WW.scene.add(m.group); return m;
      });
    });
    for (let i = 0; i < 2; i++) {
      const n = i ? 'mavis' : 'pby', z = 150 + i * 60;
      await shot(n + '_1_front34', 314, 46, z + 12, 300, 40, z);
      await shot(n + '_2_side', 300.5, 41, z + 22, 300, 40, z);
      await shot(n + '_3_top', 300.2, 66, z + 0.2, 300, 40, z);
      await shot(n + '_4_rear34', 285, 47, z - 13, 300, 40, z);
    }
    await p.evaluate(() => { __fb[0].floats.set(1); });
    await shot('pby_5_floats_down', 312, 44, 162, 300, 40, 150);
    await p.evaluate(() => { __fb.forEach(m => WW.scene.remove(m.group)); window.__view = null; __sim.setScale(1); });
  }
  if (ONLY !== 'models' && process.argv.includes('--live')) {
    // 2. live: wait for flying-boat moments in the seeded battle
    const until = async (cond, max) => p.evaluate(([c, max]) => {
      const f = new Function('q', 'return ' + c);
      for (let i = 0; i < max * 20; i++) { const q = WW.world.planes.find(q => q.alive && q.kind === 'flyingboat' && f(q)); if (q) { window.__q = q; return q.boatType + ' ' + q.state + ' t ' + WW.game.roundTime.toFixed(0); } __sim.fastForward(0.05); }
      return null;
    }, [cond, max]);
    const follow = async (name, ox, oy, oz) => {
      await p.evaluate(([ox, oy, oz]) => { window.__view = c => { const q = window.__q, h = q.heading, ch = Math.cos(h), sh = Math.sin(h); c.position.set(q.x + ch * ox - sh * oz, Math.max(2, q.y + oy), q.z + sh * ox + ch * oz); c.lookAt(q.x, q.y, q.z); }; }, [ox, oy, oz]);
      await p.waitForTimeout(900); await p.screenshot({ path: SH(name) });
    };
    let r = await until("q.mission === 'patrol' && q.state === 'shadow'", 400);
    console.log('shadow:', r);
    if (r) {
      await follow('live_mavis_shadow', -30, 14, 22);
      await p.evaluate(() => { const q = window.__q, s = q.shadowOf; window.__view = c => { c.position.set(q.x + (q.x - s.x) * 0.35, q.y + 22, q.z + (q.z - s.z) * 0.35 + 10); c.lookAt((q.x + s.x) / 2, 0, (q.z + s.z) / 2); }; });
      await p.waitForTimeout(900); await p.screenshot({ path: SH('live_shadow_standoff') });
    }
    r = await until("q.mission === 'patrol' && WW.world.planes.some(f => f.alive && f.foe === q)", 300);
    console.log('cap on patrol:', r);
    if (r) { await p.evaluate(() => { window.__q = WW.world.planes.find(f => f.alive && f.foe === __q) || __q; }); await follow('live_cap_attack', -14, 5, 6); }
    r = await until("q.mission === 'rescue' && q.state === 'afloat' && q.waterT > 4", 500);
    console.log('rescue landed:', r);
    if (r) { await follow('live_dumbo_afloat', 10, 6, 16); await follow('live_dumbo_afloat2', -16, 9, -12); }
    console.log('stats', JSON.stringify(await p.evaluate(() => WW.flyingBoats && WW.flyingBoats.stats)));
  }
  console.log(errs.length ? 'ERRORS\n' + errs.slice(0, 10).join('\n') : 'no page errors');
  await b.close();
})();
