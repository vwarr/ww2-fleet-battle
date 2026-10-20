// Landing gear close-ups (render mode, software GL): every carrier type parked on a flight deck (side, 3/4 and low
// front views), the land bombers on their hardstands, a deck launch with the gear coming up, a recovery with the gear
// and hook down in the groove and at the trap. Studio planes are pool models placed on the deck at the sim's ride
// height (aircraft.js DECK_Y; land: land_air.js gear) as air_deck.js / base_ground_fx.js place them.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/plane_gear_shots.js OUTDIR [shot,shot]
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'shots', 'plane_gear'), ONLY = process.argv[3] || null;
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const TYPES = [['fighter', 'USN'], ['dive', 'USN'], ['torpedo', 'USN'], ['fighter', 'IJN'], ['dive', 'IJN'], ['torpedo', 'IJN']];
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8828/') + 'index.html?v=' + Date.now(), { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .caption, #fade { display: none !important; }' });
  await p.evaluate(() => {
    window.__cam = null;
    const upd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (dt) { const v = window.__cam && window.__cam(); if (!v) return upd(dt); WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); };
    window.__round = (base) => {
      const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
      WW.terrain.generate(3); WW.seedRandom(3); WW.time.now = 0; WW.time.scale = 1;
      if (WW.dayNight) { WW.dayNight.force = 'day'; WW.dayNight.pinHour = 10; } if (WW.weather) WW.weather.force = 'clear';
      const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 }, { type: 'destroyer', nation: n, x: x + s * 50, z: H / 2 - 50 }];
      WW.game.baseChoice = base || null;
      WW.game.composition = base ? null : [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true }); WW.game.composition = null;
      window.B = WW.islandBase && WW.islandBase.base;
    };
    // a carrier-local camera: eye at (a, h, s), looking at (ta, th, ts) (deck local, y above the deck top)
    window.__rel = (c, a, h, s, ta, th, ts) => {
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading), w = (u, v) => [c.x + ch * u - sh * v, c.z + sh * u + ch * v];
      const D = c._deck, y0 = (c.model.deck ? (c.group.updateMatrixWorld(true), c.model.deck.getWorldPosition(new THREE.Vector3()).y) : 3);
      const e = w(a, s), t = w(ta, ts); return [e[0], y0 + h, e[1], t[0], y0 + th, t[1]];
    };
  });
  const shot = async (name, setup) => {
    if (ONLY && !ONLY.split(',').includes(name)) return;
    const ok = await p.evaluate((src) => { const r = eval('(' + src + ')')(); return r !== false; }, setup.toString());
    if (!ok) { console.log('skip', name); return; }
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    console.log('  ' + name);
  };
  // ---- the studio deck: the six carrier types in a row down the centre line, the deck park cleared ----
  await p.evaluate(() => {
    __round(null); __sim.fastForward(2); WW.time.scale = 0.0001;
    const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN'); window.__cv = cv;
    const D = cv._deck; for (const col of D.cols) for (const e of col.e) e.m.group.visible = false;
    for (const pl of WW.world.planes) if (pl.group) pl.group.visible = false;
    window.__studio = [];
    const P = WW.air._pool, list = [['fighter', 'USN'], ['dive', 'USN'], ['torpedo', 'USN'], ['fighter', 'IJN'], ['dive', 'IJN'], ['torpedo', 'IJN']];
    list.forEach(([k, n], i) => {
      const m = P.get(k, n); cv.group.add(m.group); m.group.rotation.set(0, 0, 0);
      m.group.position.set(9 - i * 4.2, D.top + P.deckY, 0);
      if (m.payload) m.payload.visible = true;
      if (WW.planeGear) WW.planeGear.parked(m, 0);   // as air_deck.js syncEntry poses a parked plane
      __studio.push(m);
    });
  });
  for (let i = 0; i < 6; i++) {
    const [k, n] = TYPES[i];
    await shot(`deck_${k}_${n}_side`, `() => { const x = 9 - ${i} * 4.2; window.__cam = () => __rel(__cv, x, 0.3, 2.0, x, 0.2, 0); }`);
    await shot(`deck_${k}_${n}_34`, `() => { const x = 9 - ${i} * 4.2; window.__cam = () => __rel(__cv, x + 1.3, 0.55, 1.3, x, 0.15, 0); }`);
    await shot(`deck_${k}_${n}_low`, `() => { const x = 9 - ${i} * 4.2; window.__cam = () => __rel(__cv, x + 1.5, 0.14, 1.3, x - 0.1, 0.16, 0); }`);
  }
  await shot('deck_lineup', () => { window.__cam = () => __rel(__cv, -1.5, 2.5, 9, -1.5, 0.2, 0); });
  // ---- a real round: a deck launch (the tail coming up on the run, the gear coming up after the bow) and a recovery ----
  const live = ONLY ? ONLY.split(',').some(n => /^(launch|groove|trap|park|base|runway)/.test(n)) : true;
  if (live) await p.evaluate(() => {
    for (const m of __studio) WW.air._pool.release(m);
    __round(null); __sim.fastForward(1); WW.time.scale = 0.0001;
    window.__ff = (cond, secs, step) => { for (let i = 0; i < secs / (step || 0.05); i++) { const r = cond(); if (r) return r; __sim.fastForward(step || 0.05); } return cond(); };
    // camera on a plane: from its side (sd: +1 starboard), back along its heading, up
    window.__on = (pl, side, back, up, look) => () => { if (!pl || pl.removed) return null; const h = pl.heading, c = Math.cos(h), s = Math.sin(h), g = pl.group.position;
      return [g.x - c * back - s * side, g.y + up, g.z - s * back + c * side, g.x + c * (look || 0), g.y, g.z + s * (look || 0)]; };
    window.__gear = pl => pl && pl.model && pl.model.gear ? 'ext ' + pl.model.gear.ext.toFixed(2) + ' hook ' + pl.model.gear.hook.toFixed(2) + ' state ' + pl.state + '/' + (pl.deckPh || pl.rwPh) : '?';
  });
  const live1 = async (name, src) => { if (!live) return; await shot(name, src); if (!ONLY || ONLY.includes(name)) console.log('     ' + await p.evaluate(() => __gear(window.__pl))); };
  await live1('launch_run', `() => { const P = () => WW.world.planes.find(q => q.deckPh === 'run' && q.rel > 9); window.__pl = __ff(P, 300); if (!__pl) return false; window.__cam = __on(__pl, 2.2, -0.6, 0.35); }`);
  await live1('launch_retract', `() => { const P = () => WW.world.planes.find(q => q.state === 'takeoff' && q.deckPh === 'climb' && q.model.gear && q.model.gear.ext < 0.6 && q.model.gear.ext > 0.25); window.__pl = __ff(P, 300, 0.02); if (!__pl) return false; window.__cam = __on(__pl, 1.6, 1.2, 0.3); }`);
  await live1('launch_up', `() => { const pl = window.__pl; if (!pl) return false; __ff(() => pl.model.gear.ext === 0, 10); window.__cam = __on(pl, 1.4, 1.6, -0.2); }`);
  await live1('groove', `() => { const P = () => WW.world.planes.find(q => q.state === 'landing' && q.deckPh === 'final' && q.model.gear && q.model.gear.hook > 0.99 && q.y - q.carrier._deck.dy < 3); window.__pl = __ff(P, 600, 0.05); if (!__pl) return false; window.__cam = __on(__pl, 1.8, 1.4, 0.2); }`);
  await live1('trap', `() => { const P = () => WW.world.planes.find(q => q.state === 'rollout' && q.deckPh === 'trap'); window.__pl = __ff(P, 300, 0.02); if (!__pl) return false; window.__cam = __on(__pl, 1.9, 0.6, 0.35); }`);
  await live1('park', `() => { const cv = window.__pl && window.__pl.carrier; if (!cv) return false; __ff(() => false, 6, 0.1); window.__cam = () => __rel(cv, -3, 1.2, 4, 3, 0.2, 0); }`);
  // ---- an island base: the land bombers on their hardstands and on the runway ----
  const base = ONLY ? ONLY.split(',').some(n => /^(base|runway)/.test(n)) : true;
  if (base) await p.evaluate(() => { __round('USN'); __sim.fastForward(2); WW.time.scale = 0.0001; window.__pl = null; });
  const stand = v => `() => { const s = B.slots.find(s => s.v === '${v}' && s.state === 'parked' && s.spot); if (!s) return false; const c = Math.cos(s.h), sn = Math.sin(s.h), y = B.site.padH;
    window.__cam = () => [s.x - sn * 9 + c * 2, y + 1.4, s.z + c * 9 + sn * 2, s.x, y + 0.6, s.z]; }`;
  if (base) for (const v of ['b17', 'b26', 'g4m']) await shot('base_' + v, stand(v));
  if (base) await live1('runway_roll', `() => { const H = ['b26', 'b17', 'g4m', 'g4mL']; const P = () => WW.world.planes.find(q => q.carrier === B && H.includes(q.variant) && q.rwPh === 'roll' && q.speed > q.pt.speed * 0.3); window.__pl = __ff(P, 400, 0.05); if (!__pl) return false; window.__cam = __on(__pl, 9, 1, 0.8); }`);
  if (base) await live1('runway_climb', `() => { const pl = window.__pl; if (!pl) return false; __ff(() => pl.model.gear && pl.model.gear.ext < 0.6, 20, 0.02); window.__cam = __on(pl, 8, 3, 0.6); }`);
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
