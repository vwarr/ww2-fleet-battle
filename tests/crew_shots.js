// Render-mode close shots of the crews at work and the battle damage (crew_ops.js, crew_props.js, damage_visuals.js).
// BASE_URL, CHROMIUM as for the other tests: node tests/crew_shots.js [outdir] [only=scene,scene]
// Each scene forces its situation through test hooks (damage.hit, emitted AA events, disabled turrets, dmgVis.topple,
// takeDamage), then films the ship with a fixed ship-relative camera (the director is switched off).
// Scenes: aa, hose, nets, turret, mast, battered, carrier, cheer, salute
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'shots', 'crew');
const only = process.argv[3] ? process.argv[3].split(',') : null;
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(process.env.BASE_URL + 'index.html?auto&v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.game.state === 'battle');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    __sim.setScale(0.15);
    WW.audio && WW.audio.setVolume && WW.audio.setVolume(0);
    window.__shot = null;
    const cu = WW.crew.update;   // software GL renders a few frames a second: run the crews' real-time clock ~4x
    WW.crew.update = r => { for (let k = 0; k < 4; k++) cu(r); };
    WW.cam.update = function () {        // ship-relative fixed camera: [ship, ox, oy, oz, lx, ly, lz] (ship-local)
      const s = window.__shot; if (!s) return;
      const sh = s[0], c = Math.cos(sh.heading), sn = Math.sin(sh.heading);
      const w = (x, z) => [sh.x + c * x - sn * z, sh.z + sn * x + c * z];
      const a = w(s[1], s[3]), t = w(s[4], s[6]);
      WW.camera.position.set(a[0], s[2], a[1]); WW.camera.lookAt(t[0], s[5], t[1]);
    };
    // a fresh ship of each kind, side by side in open water near the USN start, no hits on them by the battle
    const mk = (type, nation, z) => { const s = WW.ships.spawn(type, nation, 70, z, 0); s.hp = s.maxHp; return s; };
    window.__S = { cv: mk('carrier', 'USN', 120), ca: mk('cruiser', 'USN', 200), bb: mk('battleship', 'USN', 280), dd: mk('destroyer', 'USN', 360),
      jca: mk('cruiser', 'IJN', 440), jcv: mk('carrier', 'IJN', 520) };
    WW.game.state = 'victory'; WW.game.victoryTime = -1e4;   // no AI, no gunfire at the subjects: they sail on
  });
  const scenes = {
    aa: { setup: () => { const s = __S.bb; window.__aaI = setInterval(() => { const pl = { x: s.x + 30, y: 14, z: s.z + 25, alive: true, nation: 'IJN' }; WW.emit('aaLightFired', { ship: s, target: pl, hit: false }); if (Math.random() < 0.3) WW.emit('aaHeavyFired', { ship: s, target: pl, x: s.x, y: 3, z: s.z }); }, 200);
      window.__shot = [s, -1, 4.5, 7.5, -2, 1.4, 0]; }, wait: 2500 },
    hose: { setup: () => { clearInterval(window.__aaI); const s = __S.ca; const w = s.toWorld(-3.5, 0.6); WW.damage.hit(s, 60, w[0], w[1], 'shell', 'med'); s.dmgSites.forEach(q => { q.fire = 300; q.sev = 1.2; });
      window.__shot = [s, -3.0, 3.0, 6.5, -3.0, 1.0, 0]; }, wait: 7000 },
    turret: { setup: () => { const s = __S.bb; s.ai.turrets[0].disabled = true; const w = s.toWorld(7.6, 0); WW.damage.hit(s, 130, w[0], w[1], 'shell', 'big');
      window.__shot = [s, 8, 3.6, 7.5, 7.0, 1.4, 0]; }, wait: 4000 },
    mast: { setup: () => { const s = __S.ca; WW.dmgVis.topple(s, 0); WW.dmgVis.topple(s, 2);
      window.__shot = [s, 0, 4.5, 11, 0, 2, 0]; }, wait: 6000 },
    battered: { setup: () => { const s = __S.jca; s.hp = s.maxHp * 0.22; s.applyLook();
      const hit = (x, z, k, c, a) => { const w = s.toWorld(x, z); WW.damage.hit(s, a, w[0], w[1], k, c); };
      hit(5, 0.5, 'shell', 'big', 110); hit(3, -0.4, 'shell', 'med', 35); hit(-2, 1, 'shell', 'big', 110); hit(1, 1.4, 'torpedo', null, 220);
      hit(6.5, 1.4, 'shell', 'med', 35); hit(-5, -0.8, 'shell', 'big', 110); hit(4, 1.4, 'shell', 'big', 110); hit(-1, 1.4, 'shell', 'med', 35);
      window.__shot = [s, 2, 3.5, 17, 0, 0.7, 0]; }, wait: 9000 },
    carrier: { setup: () => { const s = __S.jcv; const hit = (x, z) => { const w = s.toWorld(x, z); WW.damage.hit(s, 180, w[0], w[1], 'bomb'); };
      hit(-4, 0.5); hit(3, -0.8); const w = s.toWorld(-6, 0); WW.emit('deckHit', { ship: s, load: 5, planes: 5, x: w[0], z: w[1] });
      window.__shot = [s, -6, 14, 18, -4, 1.5, 0]; }, wait: 6000 },
    nets: { setup: () => { const s = __S.ca; s.takeDamage(s.hp + 1, s.x, s.z, 'shell', 'big');
      window.__shot = [s, 2, 2.6, 8.5, 0, 0.5, 0]; }, wait: 9000 },
    salute: { setup: () => { window.__shot = [__S.bb, 2, 3.2, -8, 0, 1.6, 0]; }, wait: 1500 },
    cheer: { setup: () => { const j = __S.jca; j.takeDamage(j.hp + 1, j.x, j.z, 'shell', 'big');
      window.__shot = [__S.dd, 1, 2.4, 5.5, 0, 1.0, 0]; }, wait: 1300 },
  };
  for (const name of Object.keys(scenes)) {
    if (only && !only.includes(name)) continue;
    const sc = scenes[name];
    await p.evaluate(sc.setup);
    await p.waitForTimeout(sc.wait);
    await p.screenshot({ path: `${out}/${name}.png` });
    console.log(name, JSON.stringify(await p.evaluate(() => ({ crew: WW.crew.stats(), props: WW.crewProps.stats(), dv: WW.dmgVis.stats() }))));
  }
  if (errs.length) console.log('ERRORS', errs.slice(0, 5).join('\n'));
  await b.close();
})();
