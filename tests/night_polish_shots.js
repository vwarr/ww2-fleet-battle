// Night polish contact sheets (render mode, software GL, a fake frame clock so every frame is the same 1/30 s):
//   sink:  a cruiser blown up (a magazine: broken in two) and a cruiser torpedoed (broken in two) at night, frames from
//          0.07 s to 4 s after the blow, medium range
//   fire:  a burning carrier and a cruiser at night, close
//   flak:  a raid over a USN carrier group by day, then the same sky at dusk and at night (the clock pinned: test only)
//   rough: a burning carrier in ?sea=rough, close, deck level; prints how far the fire / smoke spawns sit off the posed deck
// Usage: BASE_URL=http://localhost:PORT/ node tests/night_polish_shots.js sink|fire|flak|rough|all [out] [seed=4]
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const WHAT = process.argv[2] || 'all', OUT = process.argv[3] || path.join(__dirname, 'shots', 'night_polish'), SEED = +(process.argv[4] || 4);
const BASE = process.env.BASE_URL || 'http://localhost:8000/';
fs.mkdirSync(OUT, { recursive: true });

async function page(b, query) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.setDefaultTimeout(600000);
  p.errs = []; p.on('pageerror', e => p.errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto(BASE + 'index.html?auto' + (query ? '&' + query : '') + '&v=' + Date.now(), { timeout: 600000 });
  await p.waitForFunction(() => window.WW && WW.game && window.__sim, null, { timeout: 600000 });
  await p.evaluate(() => {
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      const o = L.s;
      WW.camera.position.set(o.x + L.d * Math.cos(L.brg), L.y + L.h, o.z + L.d * Math.sin(L.brg)); WW.camera.lookAt(o.x, L.y, o.z); WW.camera.updateMatrixWorld();
    };
    window.look = (s, d, h, brg, y) => { window.__look = { s: { x: s.x, z: s.z, ref: s }, d, h, brg, y: y === undefined ? 2 : y, live: true }; };
    window.track = () => { const L = window.__look; if (L && L.live && L.s.ref && !L.s.ref.removed) { L.s.x = L.s.ref.x; L.s.z = L.s.ref.z; } };
    window.clean = () => { const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      for (const q of ['.panel.setup', '.caption']) { const e = document.querySelector(q); if (e) e.style.visibility = 'hidden'; } };
    window.round = (seed, tod, comp) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.dayNight.force = tod; WW.dayNight.pin = null; WW.dayNight.pinHour = null; WW.weather.force = 'clear';
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = comp || null; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    };
  });
  return p;
}
async function snap(p, name, info) {
  const s = await p.evaluate(() => { track(); __step(1); clean(); return 't=' + WW.game.roundTime.toFixed(2) + ' dl=' + WW.daylight.toFixed(2); });
  await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 300000 });
  console.log('shot', name, s, info || '');
}
const frames = (p, n) => p.evaluate(n => { for (let i = 0; i < n; i++) { track(); __step(1); } }, n);

async function sink(b) {
  const p = await page(b);
  for (const how of ['magazine', 'torpedo']) {
    const r = await p.evaluate(([seed, how]) => {
      round(seed, 'night'); __sim.fastForward(4);
      const s = WW.world.ships.find(s => s.alive && s.type === 'cruiser');
      WW.shipBreakup.P_BREAK[how].cruiser = 1; WW.shipBreakup.P_BREAK[how].lc = 1;   // test only: she breaks
      look(s, s.stats.length * 2.4 + 26, 9, s.heading + 2.0, 2); __step(3);
      window.__cnt = { boom: 0, expl: 0 };
      if (!window.__wrapped) { window.__wrapped = 1; WW.on('shipBoom', () => __cnt.boom++); const e = WW.fx.explosion; WW.fx.explosion = function () { __cnt.expl++; return e.apply(this, arguments); }; }
      if (how === 'magazine') { WW.emit('magazine', { ship: s, hx: s.x, hz: s.z }); s.takeDamage(s.maxHp * 2, s.x, s.z, 'shell', 'big'); }
      else s.takeDamage(s.maxHp * 2, s.x, s.z, 'torpedo');
      window.__sk = s;
      return s.cls ? s.cls.key : s.type;
    }, [SEED, how]);
    console.log(how, r);
    let t = 0;
    for (const [n, tag] of [[2, '0.07s'], [6, '0.2s'], [12, '0.4s'], [21, '0.7s'], [36, '1.2s'], [66, '2.2s'], [120, '4s']]) {   // frames of 1/30 s (real time)
      await frames(p, n - t - 1); t = n;
      await snap(p, `sink_${how}_${tag}`, JSON.stringify(await p.evaluate(() => ({ ...__cnt, broken: !!__sk.broken, fx: WW.fx._stats() }))));
    }
  }
  console.log('errors:', p.errs.length, p.errs.slice(0, 5)); await p.close();
}

async function fire(b) {
  const p = await page(b);
  await p.evaluate(seed => {
    round(seed, 'night'); __sim.fastForward(4);
    const ok = s => s.alive && !s.submerged;
    const cv = WW.world.ships.find(s => ok(s) && s.type === 'carrier'), ca = WW.world.ships.find(s => ok(s) && s.type === 'cruiser');
    const hitAt = (s, amt, a, kind, cal) => { const c = Math.cos(s.heading), sn = Math.sin(s.heading); s.takeDamage(amt, s.x + c * a * s.stats.length, s.z + sn * a * s.stats.length, kind, cal); };
    cv.hp = cv.maxHp * 0.35; for (const a of [-0.3, -0.1, 0.12, 0.3]) hitAt(cv, cv.maxHp * 0.03, a, 'bomb');
    ca.hp = ca.maxHp * 0.45; hitAt(ca, 1, 0.05, 'shell', 'med'); hitAt(ca, 1, -0.2, 'bomb');
    window.__f = { cv, ca };
    __sim.fastForward(1.5);
  }, SEED);
  await p.evaluate(() => { const s = __f.cv; look(s, s.stats.length * 0.8 + 6, 4, s.heading + 1.9, 2); }); await frames(p, 20); await snap(p, 'fire_carrier_close');
  await p.evaluate(() => { const s = __f.cv; look(s, s.stats.length * 2.2 + 20, 10, s.heading + 2.3, 2); }); await frames(p, 10); await snap(p, 'fire_carrier_medium');
  await p.evaluate(() => { const s = __f.ca; look(s, s.stats.length * 0.9 + 6, 3.5, s.heading + 1.7, 2); }); await frames(p, 20); await snap(p, 'fire_cruiser_close');
  await p.evaluate(() => { WW.dayNight.force = 'day'; }); // (no effect mid-round; day look of the same fires below)
  await p.evaluate(() => { WW.dayNight.pinHour = 15; }); await frames(p, 30);
  await p.evaluate(() => { const s = __f.cv; look(s, s.stats.length * 0.8 + 6, 4, s.heading + 1.9, 2); }); await frames(p, 10); await snap(p, 'fire_carrier_close_DAY');
  console.log('errors:', p.errs.length, p.errs.slice(0, 5)); await p.close();
}

async function flak(b) {
  const p = await page(b);
  const info = await p.evaluate(seed => {
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 - 75 }, { type: 'carrier', nation: n, x, z: H / 2 + 75 }, { type: 'battleship', nation: n, x: x + s * 50, z: H / 2 },
      { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 90 }, { type: 'cruiser', nation: n, x: x + s * 40, z: H / 2 + 120 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 90 },
      { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 - 150 }, { type: 'destroyer', nation: n, x: x - s * 30, z: H / 2 }];
    round(seed, 'day', [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]);
    const under = r => WW.world.ships.find(s => s.alive && s.type === 'carrier' && s.nation === 'USN' &&
      WW.world.planes.filter(q => q.alive && q.nation !== s.nation && q.ordnance && Math.hypot(q.x - s.x, q.z - s.z) < r).length >= 3);
    let c = null; for (let i = 0; i < 2400 && !(c = under(90)); i++) __sim.fastForward(0.25);
    __sim.fastForward(12);
    window.__cv = c || WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN');
    return 't ' + WW.game.roundTime.toFixed(0) + ' found ' + !!c;
  }, 3);
  console.log('flak', info);
  const view = () => p.evaluate(() => { const c = __cv; window.__look = { s: { x: c.x, z: c.z }, d: 150, h: 22, brg: c.heading + 1.2, y: 40 }; });
  for (const [tag, hour] of [['day', null], ['dusk', 18.2], ['night', 19.5]]) {
    await p.evaluate(h => { WW.dayNight.pinHour = h; }, hour);
    await view(); await frames(p, 25);
    await snap(p, 'flak_' + tag, JSON.stringify(await p.evaluate(() => WW.combatAA._debug())));
    await p.evaluate(() => { const c = __cv; window.__look = { s: { x: c.x, z: c.z }, d: 260, h: 60, brg: c.heading + 2.4, y: 30 }; });
    await frames(p, 4); await snap(p, 'flak_' + tag + '_wide');
    // close to the bursts: the flash cores (combat_aa.js core + flash) in view
    await p.evaluate(() => { const c = __cv; window.__look = { s: { x: c.x, z: c.z }, d: 45, h: 6, brg: c.heading + 1.2, y: 26 }; });
    for (let k = 0; k < 40; k++) { await frames(p, 1); if (await p.evaluate(() => WW.combatAA._debug().cores > 1)) break; }
    await snap(p, 'flak_' + tag + '_close', JSON.stringify(await p.evaluate(() => WW.combatAA._debug())));
  }
  console.log('errors:', p.errs.length, p.errs.slice(0, 5)); await p.close();
}

async function rough(b) {
  const p = await page(b, 'sea=rough');
  const r = await p.evaluate(seed => {
    round(seed, 'day'); __sim.fastForward(4);
    const cv = WW.world.ships.find(s => s.alive && s.type === 'carrier');
    const hitAt = (s, amt, a, kind) => { const c = Math.cos(s.heading), sn = Math.sin(s.heading); s.takeDamage(amt, s.x + c * a * s.stats.length, s.z + sn * a * s.stats.length, kind); };
    cv.hp = cv.maxHp * 0.5; for (const a of [-0.25, 0.2]) hitAt(cv, cv.maxHp * 0.03, a, 'bomb');
    window.__cv = cv;
    // every fire / smoke spawn from the damage emitters on this ship: its y against the posed deck under it
    window.__off = []; window.__deck = null;
    const f0 = WW.fx.fire, t0 = WW.fx.trail;
    const rec = (x, y, z) => { const D = window.__deck; if (!D) return; let best = 1e9, by = 0; for (const q of D) { const d = Math.hypot(q.x - x, q.z - z); if (d < best) { best = d; by = q.y; } } if (best < 1.2) __off.push(y - by); };
    WW.fx.fire = function (x, y, z) { rec(x, y - 0.1, z); return f0.apply(this, arguments); };
    // the posed site positions of the last frame (after shipSwell.pose: the deck the camera sees)
    // and WW.damage.siteWorld at frame time (night_fx.js reads it for the fire lights): it must equal the posed deck
    window.__sw = 0;
    const ui = WW.ui.update; WW.ui.update = function () { const S = cv.dmgSites || []; cv.group.updateMatrix(); window.__deck = S.map(q => new THREE.Vector3(q.lx, q.ly, q.lz).applyMatrix4(cv.group.matrix));
      for (let i = 0; i < S.length; i++) { const w = WW.damage.siteWorld(cv, i); __sw = Math.max(__sw, Math.abs(w.y - __deck[i].y)); } return ui.apply(this, arguments); };
    return { sea: WW.sea && WW.sea.active, sites: (cv.dmgSites || []).length, key: cv.cls && cv.cls.key };
  }, SEED);
  console.log('rough', JSON.stringify(r));
  await p.evaluate(() => { const s = __cv; look(s, s.stats.length * 0.7 + 5, 2.5, s.heading + 1.75, 2); });
  await frames(p, 150);
  const st = await p.evaluate(() => { const a = __off.map(Math.abs); a.sort((x, y) => x - y); return { n: a.length, max: +(a[a.length - 1] || 0).toFixed(3), p90: +(a[Math.floor(a.length * 0.9)] || 0).toFixed(3), mean: +(a.reduce((s, x) => s + x, 0) / (a.length || 1)).toFixed(3) }; });
  console.log('fire spawn off the posed deck', JSON.stringify(st), ' frame-time siteWorld off the posed deck, max', await p.evaluate(() => __sw.toFixed(4)));
  await snap(p, 'rough_carrier_fire_close');
  await frames(p, 17); await snap(p, 'rough_carrier_fire_close_b');
  await p.evaluate(() => { const s = __cv; look(s, s.stats.length * 1.6 + 14, 6, s.heading + 2.2, 2); }); await frames(p, 4); await snap(p, 'rough_carrier_fire_medium');
  console.log('errors:', p.errs.length, p.errs.slice(0, 5)); await p.close();
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const all = { sink, fire, flak, rough };
  for (const k of Object.keys(all)) if (WHAT === 'all' || WHAT === k) await all[k](b);
  await b.close();
})();
