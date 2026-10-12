// Render-mode shots for planes2: a seeded standard round (set up as tests/air_endgame_shots.js does), fast-forwarded a
// second at a time; the first moment of each kind is filmed from a camera near the subject plane:
//   cover   a CAP fighter with an armed bomber on its run at a destroyer / PT / cruiser of ours as its foe
//   alert   a ready deck alert plane (plane.alert) on its way out or in its attack
//   escort  a wingman (plane.escortHome) on the wing of a damaged plane going home
//   preempt a fighter that has just broken off a dogfight onto an armed bomber (air_dogfight.js pick, 'preempt' event)
//   baseclimb a fighter on a bomber climbing out of the island field
//   overfly  an enemy plane over the field under the base's AA, with a base fighter on it (from the field, looking up)
//   baselaunch four or more of the island's bombers on the runway / hold line / climb-out at once (a strike going)
//   cap     the CAP on station round a carrier, from the side (heights a few hundred feet apart, not a ladder)
// Writes tests/shots/planes2/render_<kind>_<seed>_<t>.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/planes2_shots.js [seed=4] [maxT=600] [kinds=cover,alert,escort,cap]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'planes2');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 4), MAXT = +(process.argv[3] || 600), KINDS = (process.argv[4] || 'cover,alert,escort,cap').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8785/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate((seed) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      if (!window.__look) return camUpd(rdt);
      const L = window.__look(); WW.camera.position.set(L.x, L.y, L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
    };
    const G = WW.game;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.dayNight) WW.dayNight.force = null; if (WW.weather) WW.weather.force = null;
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.noRetire = false; G.baseChoice = null; G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    __render = false;
    // the subject finders: return { a: subject plane, b: second plane / ship to frame } or null
    window.__aaB = new Map(); const aaB = e => { if (e && e.ship && (e.ship.isBase || e.ship.isBasePit) && e.target) window.__aaB.set(e.target, WW.game.roundTime); }; WW.on('aaHeavyFired', aaB); WW.on('aaLightFired', aaB);
    WW.on('airOrder', e => { if (e && e.order === 'preempt') window.__pre = { t: WW.game.roundTime, plane: e.plane, target: e.target }; });
    window.__find = {
      cover: () => { for (const f of WW.world.planes) { const u = f.foe; if (!f.alive || f.kind !== 'fighter' || !u || !u.alive || !u.ordnance || !u.target || u.target.type === 'carrier' || u.target.isBase || u.target.nation !== f.nation) continue;
        if (WW.dist(u.x, u.z, u.target.x, u.target.z) < 220 && WW.dist(f.x, f.z, u.x, u.z) < 45) return { a: f, b: u, c: u.target }; } return null; },
      alert: () => { for (const q of WW.world.planes) if (q.alive && q.alert && q.state !== 'takeoff' && q.target && q.target.alive && WW.dist(q.x, q.z, q.target.x, q.target.z) < 200) return { a: q, b: q.target }; return null; },
      escort: () => { for (const q of WW.world.planes) { const d = q.escortHome; if (q.alive && d && d.alive && WW.dist(q.x, q.z, d.x, d.z) < 30) return { a: q, b: d }; } return null; },
      preempt: () => { const e = window.__pre; if (!e || WW.game.roundTime - e.t > 1.2) return null; const f = e.plane, u = e.target;
        return f.alive && u.alive && f.foe === u && WW.dist(f.x, f.z, u.x, u.z) < 60 ? { a: f, b: u } : null; },
      baseclimb: () => { for (const f of WW.world.planes) { const u = f.foe; if (f.alive && f.kind === 'fighter' && u && u.alive && u.carrier && u.carrier.isBase && WW.airFlight.climbing(u) && WW.dist(f.x, f.z, u.x, u.z) < 50) return { a: f, b: u }; } return null; },
      overfly: () => { const B = WW.islandBase && WW.islandBase.base; if (!B) return null; const t = WW.game.roundTime;
        for (const [q, ta] of window.__aaB || []) if (q.alive && t - ta < 0.6 && WW.dist(q.x, q.z, B.x, B.z) < 90 && WW.world.planes.some(f => f.alive && f.nation === B.nation && f.kind === 'fighter' && f.foe === q)) return { a: q, b: B, base: B };
        return null; },
      baselaunch: () => { const B = WW.islandBase && WW.islandBase.base; if (!B) return null;
        const L = WW.world.planes.filter(q => q.alive && q.carrier === B && q.state === 'takeoff' && q.kind !== 'fighter' && (q.rwPh === 'roll' || q.rwPh === 'lineup' || q.rwPh === 'hold' || q.rwPh === 'climb'));
        return L.length >= 4 ? { a: L.find(q => q.rwPh === 'roll') || L[0], b: B, base: B, n: L.length } : null; },
      cap: () => WW.game.roundTime > 70 ? { cv: WW.world.ships.find(s => s.alive && s.type === 'carrier' && !s.isBase) } : null
    };
  }, SEED);
  const shot = async (kind) => {
    const r = await p.evaluate(([kind, maxT]) => {
      const G = WW.game, F = __find[kind];
      while (G.state === 'battle' && G.roundTime < maxT) {
        __sim.fastForward(1);
        const s = F(); if (!s) continue;
        window.__subj = s;
        if (kind === 'baselaunch') {
          window.__look = () => { const q = __subj.a, h = q.heading + Math.PI + 0.35; return { x: q.x + Math.cos(h) * 75, y: 32, z: q.z + Math.sin(h) * 75, tx: q.x + Math.cos(q.heading) * 25, ty: 6, tz: q.z + Math.sin(q.heading) * 30 }; };   // behind the roller, looking down the runway
        } else if (kind === 'overfly') {
          window.__look = () => { const q = __subj.a, B = __subj.base, h = Math.atan2(q.z - B.z, q.x - B.x); return { x: B.x - Math.cos(h) * 40, y: 8, z: B.z - Math.sin(h) * 40, tx: q.x, ty: q.y, tz: q.z }; };
        } else if (kind === 'cap') {
          window.__look = () => { const c = __subj.cv, n = c.heading + Math.PI / 2; return { x: c.x + Math.cos(n) * 210, y: 34, z: c.z + Math.sin(n) * 210, tx: c.x, ty: 42, tz: c.z }; };
        } else {
          // behind the subject's quarter, a little above, looking past it at the second plane / ship
          window.__look = () => { const a = __subj.a, o = __subj.b, h = Math.atan2(o.z - a.z, o.x - a.x), d = WW.dist(a.x, a.z, o.x, o.z), D = WW.clamp(d * 0.6, 14, 40);
            const b = h + Math.PI + 0.45;
            return { x: a.x + Math.cos(b) * D, y: (a.y || 0) + 5, z: a.z + Math.sin(b) * D, tx: (a.x + o.x) / 2, ty: ((a.y || 0) + (o.y || 0)) / 2, tz: (a.z + o.z) / 2 }; };
        }
        return 't=' + G.roundTime.toFixed(0) + (s.a ? ' ' + s.a.nation + ' ' + s.a.kind + ' / ' + (s.b.kind || s.b.type) + (s.c ? ' at a ' + s.c.type : '') : '');
      }
      return null;
    }, [kind, MAXT]);
    if (!r) { console.log('  ' + kind + ': none before t=' + MAXT); return; }
    await p.evaluate(() => { __render = false; __step(2); __render = true; __step(1);
      const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none'; });
    const t = r.split(' ')[0].slice(2), f = path.join(OUT, `render_${kind}_${SEED}_${t}.png`);
    await p.screenshot({ path: f, timeout: 180000 }); console.log('  ' + kind + ' ' + r + ' -> ' + f);
  };
  for (const k of KINDS) await shot(k);   // the round runs on: each kind is the first after the previous shot
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
