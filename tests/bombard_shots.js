// Island bombardment screenshots (render mode, software GL) -> tests/shots/basebattle/*.png
//   field        heavy shells walking across the airfield (bursts, earth thrown up, craters)
//   ships        from behind the bombarding battleships: the island under their guns
//   duel         a coastal battery's splashes round a bombarding ship
//   wrecks       parked planes wrecked and burning in their revetments
//   fuel         the fuel farm going up
//   trenches     the camp under the shells: everyone in the slit trenches
//   night        a night bombardment: star shells over the field
// The fleets: the round's USN carrier group, and an IJN bombardment group (2 battleships, a cruiser, 2 destroyers)
// placed BOMB_D off the island's seaward side, so the shelling starts within a minute.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/bombard_shots.js [seed=4] [owner=USN] [shot]
const { chromium } = require('playwright');
const path = require('path'), OUT = path.join(__dirname, 'shots', 'basebattle');
require('fs').mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 4), OWNER = process.argv[3] || 'USN', ONLY = process.argv[4] || null;

const SHOTS = [
  ['field', () => { if (!__until(() => __ev.impacts > 12, 200)) return null; const c = __ev.last;
    const sh = __ship(), a = Math.atan2(sh.z - c.z, sh.x - c.x); return [c.x - Math.cos(a) * 45 + 20, 30, c.z - Math.sin(a) * 45, c.x, 0, c.z]; }],
  ['ships', () => { if (!__until(() => __ev.impacts > 4, 200)) return null; const s = __ship(), a = Math.atan2(B.z - s.z, B.x - s.x);
    return [s.x - Math.cos(a) * 40 - Math.sin(a) * 12, 14, s.z - Math.sin(a) * 40 + Math.cos(a) * 12, (s.x + B.x) / 2, 0, (s.z + B.z) / 2]; }],
  ['duel', () => { if (!__until(() => __ev.batShot, 300)) return null; __ff(1.2); const s = __ev.batShot;
    return [s.x + 30, 12, s.z + 22, s.x, 1, s.z]; }],
  ['wrecks', () => { if (!__until(() => B.slots.filter(s => s.state === 'wreck').length >= 3, 300)) return null; __ff(2);
    const w = B.slots.filter(s => s.state === 'wreck'), x = w.reduce((a, s) => a + s.x, 0) / w.length, z = w.reduce((a, s) => a + s.z, 0) / w.length;
    const c = w.sort((p, q) => WW.dist(p.x, p.z, x, z) - WW.dist(q.x, q.z, x, z))[0]; return [c.x + 18, 11, c.z + 14, c.x, 0.5, c.z]; }],
  ['fuel', () => { const en = WW.enemyOf(B.nation), f = B.facilities.find(f => f.kind === 'fuel'); if (!f) return null;
    if (!__until(() => __ev.impacts > 3, 200)) return null; WW.islandBase.impact(en, f.x, f.z, 400, 'shell', 'big'); __ff(0.3);
    return [f.x + 34, 20, f.z + 26, f.x, 3, f.z]; }],
  ['trenches', () => { if (!__until(() => __ev.impacts > 8, 200)) return null; __ff(6); return __camp('huts', 26, 11, 8); }],
  ['night', () => { if (!__until(() => __ev.impacts > 6, 300)) return null; const c = __ev.last; return [c.x + 60, 40, c.z + 50, c.x, 0, c.z]; }]
];
const CAMP = `(g, back, up, side) => { const L = B.layout, its = B.decor.filter(d => d.group === g); if (!its.length) return null;
  const u = its.reduce((a, d) => a + d.u, 0) / its.length, v = its.reduce((a, d) => a + d.v, 0) / its.length, sv = v >= 0 ? -1 : 1;
  const q = L.toW(u + (side || 0), v + sv * back), t = L.toW(u, v); const y0 = B.site.padH; return [q.x, y0 + up, q.z, t.x, y0 + 0.4, t.z]; }`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8786/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption { display: none !important; }' });
  await p.evaluate(([seed, owner, camp]) => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    const S = WW.terrain.site, en = owner === 'USN' ? 'IJN' : 'USN';
    // the bombardment group off the island: open water BOMB_D from the field, on the side away from the atoll / volcano
    const ox = S.atoll ? S.atoll.x : S.island ? S.island.x : S.x - 1, oz = S.atoll ? S.atoll.z : S.island ? S.island.z : S.z, out = Math.atan2(S.z - oz, S.x - ox);
    const water = (x, z) => WW.terrain.isNavigable(x, z, 6);
    const spot = (r, da) => { for (let k = 0; k < 40; k++) for (const s of [1, -1]) { const a = out + s * (da + k * 0.05), x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r; if (water(x, z)) return { x, z }; } return { x: S.x + Math.cos(out) * r, z: S.z + Math.sin(out) * r }; };
    WW.seedRandom(seed); const comp = WW.game.randomComposition().filter(c => c.nation === owner && (c.type === 'carrier' || c.type === 'destroyer')).slice(0, 3);
    [['battleship', 190, 0], ['battleship', 205, 0.15], ['cruiser', 215, -0.18], ['destroyer', 225, 0.3], ['destroyer', 225, -0.3]].forEach(([type, r, da]) => { const q = spot(r, da); comp.push({ type, nation: en, x: q.x, z: q.z }); });
    window.__comp = comp;
    window.__fresh = () => {
      WW.seedRandom(seed * 7919 + 1); WW.time.scale = 1;
      if (WW.dayNight) WW.dayNight.force = window.__night ? 'night' : 'day';
      WW.game.baseChoice = owner; WW.game.composition = window.__comp; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
      window.B = WW.islandBase.base; window.__ev = { impacts: 0 };
      __sim.fastForward(3); WW.time.scale = 0.0001;
    };
    WW.on('baseEvent', e => { if (window.B && e.base === B && !__ev[e.kind]) __ev[e.kind] = e; });
    WW.on('baseImpact', e => { if (window.B && e.base === B) { __ev.impacts++; __ev.last = e; } });
    WW.on('shellFired', e => { if (window.__ev && e.ship && e.ship.isBattery && !__ev.batShot) __ev.batShot = e.proj.target; });
    window.__ship = () => WW.world.ships.filter(s => s.alive && s.nation !== B.nation && s.type === 'battleship').sort((p, q) => WW.dist(p.x, p.z, B.x, B.z) - WW.dist(q.x, q.z, B.x, B.z))[0];
    window.__camp = eval(camp);
    window.__ff = secs => { for (let t = 0; t < secs - 1e-6; t += 0.1) { __sim.fastForward(0.1); if (window.B) { WW.camera.position.set(B.x, 40, B.z); WW.baseFx.update(0.1); } } };
    window.__until = (f, secs) => { for (let i = 0; i < secs * 10 && WW.game.state === 'battle'; i++) { if (f()) return true; __ff(0.1); } return !!f(); };
  }, [SEED, OWNER, CAMP]);
  const done = [];
  for (const [name, fn] of SHOTS) {
    if (ONLY && !ONLY.split(',').includes(name)) continue;
    const cam = await p.evaluate(([src, night]) => {
      window.__night = night; __fresh();
      const v = eval('(' + src + ')')();
      if (!v) return null;
      WW.cam.update = function () { WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); };
      return v;
    }, [fn.toString(), name === 'night']);
    if (!cam) { console.log('skip', name); continue; }
    // let the battle run live for a moment: the next shells land and their bursts and smoke animate
    await p.evaluate(() => { WW.time.scale = 1; });
    await p.waitForTimeout(name === 'fuel' ? 600 : 2200);
    await p.evaluate(() => { WW.time.scale = 0.0001; });
    await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    done.push(name);
  }
  console.log('shots in', OUT, done.join(' '), ' errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
