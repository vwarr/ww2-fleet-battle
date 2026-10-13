// Render-mode shots of the critical hits (fx_critical.js): a destroyer's and a cruiser's magazine going up, and a
// carrier's hangar / deck load exploding. The events are emitted as the sim emits them (ship_fires.js) on fresh ships
// sailing alone; a fixed ship-relative camera (the director off); frames at several moments after the blast.
// BASE_URL, CHROMIUM as for the other render tests: node tests/critical_shots.js [outdir] [only=dd,ca,cv,night]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'shots', 'critical');
const only = process.argv[3] ? process.argv[3].split(',') : null;
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(process.env.BASE_URL + 'index.html?auto&v=' + Date.now(), { timeout: 240000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.game.state === 'battle', null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    __sim.setScale(1);
    Object.defineProperty(WW.time, 'warp', { get: () => 1, set: () => {} });
    WW.audio && WW.audio.setVolume && WW.audio.setVolume(0);
    window.__shot = null;
    WW.cam.update = function () {        // ship-relative fixed camera: [ship, ox, oy, oz, lx, ly, lz] (ship-local), held where she was once she is gone
      const s = window.__shot; if (!s) return;
      const sh = s[0]; if (!s.h) s.h = [sh.x, sh.z, sh.heading];
      if (!sh.removed && !sh.sinking) s.h = [sh.x, sh.z, sh.heading];
      const c = Math.cos(s.h[2]), sn = Math.sin(s.h[2]);
      const w = (x, z) => [s.h[0] + c * x - sn * z, s.h[1] + sn * x + c * z];
      const a = w(s[1], s[3]), t = w(s[4], s[6]);
      WW.camera.position.set(a[0], s[2], a[1]); WW.camera.lookAt(t[0], s[5], t[1]);
    };
    for (const s of WW.world.ships) if (s.alive) s.x += 3000;
    WW.world.planes.forEach(pl => { pl.alive = false; if (pl.remove) pl.remove(); });
    WW.game.state = 'victory'; WW.game.victoryTime = -1e4;   // no AI: the subjects sail on
    window.__mk = (type, nation, x, z) => { const s = WW.ships.spawn(type, nation, x, z, 0); s.hp = s.maxHp; s.throttle = 0.4; return s; };
    // as ship_fires.js magazine(): the event, then the ship goes
    window.__mag = (s, lx) => { const w = s.toWorld(lx, 0); WW.emit('magazine', { ship: s, x: s.x, z: s.z, hx: w[0], hz: w[1], kind: 'torpedo' }); s.takeDamage(s.hp + 1, w[0], w[1], 'magazine'); };
    window.__deck = (s, lx, load, hangar) => { const w = s.toWorld(lx, 0); WW.emit('deckHit', { ship: s, load, planes: load, x: w[0], z: w[1], hangar, armed: load }); WW.emit('deckOut', { ship: s, until: 1e9, perm: true, hits: 1, x: w[0], z: w[1], boom: true }); };
  });
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return true; await p.waitForTimeout(100); } return false; };
  const tw = await p.evaluate(() => WW.time.now);
  await until(new Function('return WW.time.now > ' + (tw + 0.5)), 240000);   // the shaders compiled
  // frames at sim seconds after the blast (the render is slow in software GL: wait on the sim clock)
  const film = async (name, secs) => {
    const t0 = await p.evaluate(() => WW.time.now);
    for (const t of secs) {
      await until(new Function('return WW.time.now >= ' + (t0 + t)), 300000);
      await p.screenshot({ path: `${out}/${name}_${String(t).replace('.', 'p')}s.png`, timeout: 180000 });
    }
    console.log(name, 'ok', JSON.stringify(await p.evaluate(() => WW.fx._stats())));
  };
  const scenes = {
    dd: async () => {
      await p.evaluate(() => { WW.fx.clearAll(); const s = __mk('destroyer', 'IJN', 300, 300); window.__shot = [s, -50, 12, 80, 0, 12, 0]; window.__s = s; });
      await p.waitForTimeout(3000);
      await p.screenshot({ path: `${out}/dd_before.png`, timeout: 180000 });
      await p.evaluate(() => __mag(__s, 3));
      await film('dd', [0.15, 0.5, 1.2, 3, 6, 12, 20]);
    },
    ca: async () => {
      await p.evaluate(() => { WW.fx.clearAll(); const s = __mk('cruiser', 'USN', 600, 300); window.__shot = [s, -70, 16, 110, 0, 18, 0]; window.__s = s; });
      await p.waitForTimeout(3000);
      await p.evaluate(() => __mag(__s, -5));
      await film('ca', [0.15, 0.6, 1.5, 4, 10, 20]);
    },
    cv: async () => {
      await p.evaluate(() => { WW.fx.clearAll(); const s = __mk('carrier', 'IJN', 900, 300); window.__shot = [s, -38, 22, 60, 0, 4, 0]; window.__s = s; });
      await p.waitForTimeout(4000);
      await p.screenshot({ path: `${out}/cv_before.png`, timeout: 180000 });
      await p.evaluate(() => __deck(__s, -4, 9, true));
      await film('cv', [0.2, 1, 2.5, 5, 10, 20, 35]);
    }
  };
  for (const k of Object.keys(scenes)) if (!only || only.includes(k)) { try { await scenes[k](); } catch (e) { console.log(k, 'FAILED', e.message); } }
  console.log('errors:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  await b.close();
})();
