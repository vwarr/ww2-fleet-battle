// Plane look viewer: close-ups of the six carrier types, then banking / vapour / dive brakes in a live battle.
// Usage: bash tests/run.sh planes_view.js        (shots in tests/shots/planes_*.png)
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SH = n => 'shots/planes_' + n + '.png';
(async () => {
  const b = await chromium.launch({ channel: process.env.CHANNEL || undefined, executablePath: process.env.CHROMIUM || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  // debug camera: WW.cam is paused and the camera follows __view() each frame
  await p.evaluate(() => {
    const cam = WW.cam, upd = cam.update, ar = cam.afterRender;
    window.__view = null;
    cam.update = function (dt) { if (!window.__view) return upd.call(cam, dt); window.__view(WW.camera, dt); };
    cam.afterRender = function () { if (!window.__view && ar) return ar.call(cam); };
    window.lookFrom = (plane, ox, oy, oz, local) => { // camera offset in the plane's heading frame (x fwd, z right)
      window.__view = (c) => {
        const h = plane.heading, ch = Math.cos(h), sh = Math.sin(h);
        c.position.set(plane.x + ch * ox - sh * oz, plane.y + oy, plane.z + sh * ox + ch * oz);
        c.lookAt(plane.x, plane.y, plane.z);
      };
    };
  });
  // 1. lineup of the six types over open water, sim frozen
  await p.evaluate(() => {
    __sim.setScale(0.0001);
    const kinds = ['fighter', 'dive', 'torpedo'], out = [];
    let i = 0;
    for (const n of ['USN', 'IJN']) for (const k of kinds) {
      const m = WW.models.buildPlane(k, n); m.group.rotation.order = 'YZX'; m.group.scale.setScalar(1.7);
      m.group.position.set(200 + (i % 3) * 12, 40, 120 + (n === 'IJN' ? 12 : 0)); m.group.rotation.y = 0;
      if (m.disc) { m.disc.visible = true; m.blades.visible = false; }
      WW.scene.add(m.group); out.push(m); i++;
    }
    window.__lineup = out;
  });
  const shotLine = async (name, cx, cy, cz, tx, ty, tz) => {
    await p.evaluate(([cx, cy, cz, tx, ty, tz]) => { window.__view = c => { c.position.set(cx, cy, cz); c.lookAt(tx, ty, tz); }; }, [cx, cy, cz, tx, ty, tz]);
    await p.waitForTimeout(700); await p.screenshot({ path: SH(name) });
  };
  await shotLine('01_lineup34', 230, 58, 152, 212, 40, 126);
  await shotLine('02_lineup_top', 212, 85, 127, 212, 40, 126);
  await shotLine('03_lineup_side', 212, 41, 175, 212, 40, 126);
  // each type alone, 3/4 front, blades + brakes open on the dive types
  for (let i = 0; i < 6; i++) {
    await p.evaluate(i => { const m = __lineup[i]; if (m.brakes) m.brakes.set(1); if (i % 2) { m.disc.visible = false; m.blades.visible = true; } }, i);
    const x = 200 + (i % 3) * 12, z = 120 + (i >= 3 ? 12 : 0);
    await shotLine('04_type' + i, x + 5.5, 43.2, z + 4.5, x, 40, z);
  }
  // a folded / banked pose check on the lineup (contract: wingL.rotation.x = +a, wingR = -a folds up)
  await p.evaluate(() => { const m = __lineup[0]; m.wingL.rotation.x = 1.6; m.wingR.rotation.x = -1.6; const k = __lineup[3]; k.group.rotation.x = 0.9; });
  await shotLine('05_fold_bank', 214, 46, 136, 206, 40, 126);
  await p.evaluate(() => { __lineup.forEach(m => WW.scene.remove(m.group)); window.__view = null; __sim.setScale(1); });

  // 2. live battle: banking, vapour and dive brakes
  const find = async (cond, max) => p.evaluate(([c, max]) => { const f = new Function('q', 'return ' + c);
    for (let i = 0; i < max * 20; i++) { const q = WW.world.planes.find(q => q.alive && f(q)); if (q) { window.__q = q; return q.kind + ' ' + q.nation + ' ' + q.state + ' roll ' + q.roll.toFixed(2) + ' g ' + (q.gload || 0).toFixed(1); } __sim.fastForward(0.05); }
    return null; }, [cond, max]);
  const follow = async (name, ox, oy, oz, scale) => {
    await p.evaluate(([ox, oy, oz, s]) => { lookFrom(__q, ox, oy, oz); __sim.setScale(s); }, [ox, oy, oz, scale || 0.15]);
    await p.waitForTimeout(900); await p.screenshot({ path: SH(name) });
    await p.evaluate(() => { __sim.setScale(1); });
  };
  console.log('bank', await find('Math.abs(q.roll) > 0.8 && q.y > 8', 200));
  await follow('10_bank_behind', -14, 3, 0);
  console.log('vapour', await find('(q.gload || 0) > 50 && q.y > 6', 200), await p.evaluate(() => WW.airFx._ribbons.filter(r => r.n > 1).length));
  await follow('11_vapour', -10, 5, 7, 0.1);
  console.log('dive', await find("q.phase === 'dive' && q.y > 20 && q.y < 32", 300));
  await follow('12_dive', -6, 5, 6, 0.1);
  await p.evaluate(() => __sim.fastForward(0.3));
  console.log('dive brakes open', await p.evaluate(() => __q.model.brakes ? __q.model.brakes.open.toFixed(2) : 'none'));
  await follow('13_dive_brakes', 2, 3, 6, 0.08);
  console.log('glint', await find('(q._glint || 0) > 0.3', 300));
  await follow('14_glint', -16, 4, 6, 0.05);
  // battle-distance shot of a strike
  await p.evaluate(() => { window.__view = null; const a = WW.world.planes.filter(q => q.alive); if (a.length) __sim.focus(a[0].x, a[0].z, 80, 6); });
  await p.waitForTimeout(1500); await p.screenshot({ path: SH('20_battle') });
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
