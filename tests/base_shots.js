// Island base screenshots (render mode, software GL) -> tests/shots/base/*.png
//   field          the airfield: runways, taxiways, dispersal rows of revetments, parked planes
//   revetments     a row close up: planes in their revetments with their ground crews
//   taxi_queue     a launch: planes on the taxiway in line, one holding short, one on the runway
//   scramble       a raid detected: fighters warming up and rolling out, the crews backing off
//   rearm_trucks   planes back from a sortie: fuel trucks and bomb carts at their revetments
//   closed         the main runway cratered and closed, a repair gang and a roller at a crater
//   reopened       the craters filled: the runway open again and the launches resumed
//   crash_truck    a damaged plane's landing, the crash truck racing out
//   burning        hangars and fuel tanks burning after a raid
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/base_shots.js [seed=3] [owner=USN] [shot]
const { chromium } = require('playwright');
const path = require('path'), OUT = path.join(__dirname, 'shots', 'base');
require('fs').mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 3), OWNER = process.argv[3] || 'USN', ONLY = process.argv[4] || null; // ONLY: one shot by name

// each shot: [name, page-side setup returning the camera [x, y, z, tx, ty, tz] (or null: skip)]
const SHOTS = [
  ['field', () => { const L = B.layout, c = L.toW(0, 0), e = L.toW(-30, 95); return [e.x, 85, e.z, c.x, 0, c.z]; }],
  ['revetments', () => {
    const r = B.layout.rows.find(r => r.spots.length >= 3) || B.layout.rows[0], sp = r.spots[Math.floor(r.spots.length / 2)];
    const L = B.layout, q = L.toW(sp.u - 14, sp.laneV - r.side * 9), t = L.toW(sp.u, sp.v);
    return [q.x, 9, q.z, t.x, 0.5, t.z];
  }],
  ['taxi_queue', () => {
    const Q = () => WW.world.planes.filter(p => p.carrier === B && p.alive && (p.rwPh === 'taxi' || p.rwPh === 'hold' || p.rwPh === 'lineup' || p.rwPh === 'roll'));
    if (!__until(() => Q().filter(p => p.rwPh === 'hold' || p.rwPh === 'lineup').length >= 1 && Q().length >= 4, 300)) return null;
    const L = B.layout, ps = Q(), u = ps.reduce((a, p) => a + L.toL(p.x, p.z).u, 0) / ps.length, v = ps.reduce((a, p) => a + L.toL(p.x, p.z).v, 0) / ps.length;
    const sd = Math.sign(v) || 1, t = L.toW(u, v * 0.6), q = L.toW(u - B.ops.dir * 10, v + sd * 55);
    return [q.x, 34, q.z, t.x, 0, t.z];
  }],
  ['scramble', () => {
    if (!__until(() => __ev.scramble, 400)) return null;
    __sim.fastForward(1.2);
    const p = WW.world.planes.find(p => p.carrier === B && p.alive && p.fast && p.rwPh === 'warm') || WW.world.planes.find(p => p.carrier === B && p.alive && p.fast && WW.landGround.onGround(p));
    if (!p) return null;
    const h = p.heading; return [p.x + Math.cos(h) * 16 - Math.sin(h) * 8, 8, p.z + Math.sin(h) * 16 + Math.cos(h) * 8, p.x, 0.5, p.z];
  }],
  ['rearm_trucks', () => {
    const S = () => B.slots.find(s => s.state === 'rearm' && s.spot && s.rearmT !== undefined && WW.time.now - s.rearmT > 15.5 && s.readyAt - WW.time.now > 1.5);
    if (!__until(() => S(), 500)) return null;
    const sp = S().spot, L = B.layout, q = L.toW(sp.u + 10, sp.laneV + sp.side * -9), t = L.toW(sp.u, (sp.v + sp.laneV) / 2);
    return [q.x, 8, q.z, t.x, 0.5, t.z];
  }],
  ['closed', () => {
    const rw = B.runways[0], en = WW.enemyOf(B.nation);
    const t0 = WW.time.now;
    for (const k of [-14, -2, 9]) WW.islandBase.impact(en, rw.x + rw.c * k, rw.z + rw.s * k, 180, 'bomb');
    __until(() => B.repairing && B.repairing.at > t0, 60); __sim.fastForward(1);
    const c = (B.repairing && B.repairing.crater) || B.craters[0]; if (!c) return null;
    return [c.x - rw.s * 16 + rw.c * 12, 9, c.z + rw.c * 16 + rw.s * 12, c.x - rw.c * 3, 0, c.z - rw.s * 3];
  }],
  ['reopened', () => {
    const rw = B.runways[0], en = WW.enemyOf(B.nation);
    for (const k of [-14, -2, 9]) WW.islandBase.impact(en, rw.x + rw.c * k, rw.z + rw.s * k, 180, 'bomb');
    if (!__until(() => __ev.runwayOpen, 300)) return null;
    __until(() => WW.world.planes.some(p => p.carrier === B && (p.rwPh === 'lineup' || p.rwPh === 'roll')), 120);
    const L = B.layout, q = L.toW(B.ops.dir * 30, 24), t = L.toW(-B.ops.dir * 25, 0);
    return [q.x, 16, q.z, t.x, 0, t.z];
  }],
  ['crash_truck', () => {
    const ok = __until(() => { const p = WW.world.planes.find(p => p.carrier === B && p.alive && p.state === 'landing' && p.rwPh === 'circuit'); if (p && p.hp > p.maxHp * 0.4) p.hp = p.maxHp * 0.35; return __ev.crashLanding; }, 400);
    if (!ok) return null;
    __sim.fastForward(9);
    const p = __ev.crashLanding.plane, x = p && p.alive ? p.x : __ev.crashLanding.x, z = p && p.alive ? p.z : __ev.crashLanding.z;
    return [x + 26, 16, z + 26, x, 0.5, z];
  }],
  ['burning', () => {
    const en = WW.enemyOf(B.nation);
    for (const f of B.facilities) if (f.kind === 'hangar' || f.kind === 'fuel') WW.islandBase.impact(en, f.x, f.z, 900, 'bomb');
    __sim.fastForward(8);
    const L = B.layout, c = L.toW(30, 0), e = L.toW(110, 70); return [e.x, 50, e.z, c.x, 0, c.z];
  }]
];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8776/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption { display: none !important; }' });
  await p.evaluate(([seed, owner]) => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    window.__fresh = () => { // every shot from a fresh round on the same map (the same fleets, the same base)
      WW.seedRandom(seed * 7919 + 1); WW.time.scale = 1;
      WW.game.baseChoice = owner; WW.game.composition = window.__comp || null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
      window.B = WW.islandBase.base; window.__ev = {};
      __sim.fastForward(3); WW.time.scale = 0.0001; // the render loop barely moves the sim: each shot is a still
    };
    WW.seedRandom(seed); window.__comp = WW.game.randomComposition();
    WW.on('baseEvent', e => { if (window.B && e.base === B && !__ev[e.kind]) __ev[e.kind] = e; });
    window.__until = (f, secs) => { for (let i = 0; i < secs * 10 && WW.game.state === 'battle'; i++) { if (f()) return true; __sim.fastForward(0.1); } return !!f(); };
  }, [SEED, OWNER]);
  const done = [];
  for (const [name, fn] of SHOTS) {
    if (ONLY && name !== ONLY) continue;
    const cam = await p.evaluate(src => {
      __fresh();
      const v = eval('(' + src + ')')();
      if (!v) return null;
      WW.cam.update = function () { WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); };
      return v;
    }, fn.toString());
    if (!cam) { console.log('skip', name); continue; }
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    if (ONLY) console.log(name, JSON.stringify(await p.evaluate(() => ({ g: WW.baseGroundFx._stats(), crew: WW.crew.stats(), rp: B.repairing && { at: B.repairing.at, now: WW.time.now, inc: B.craters.includes(B.repairing.crater) } }))));
    done.push(name);
  }
  const st = await p.evaluate(() => WW.baseGroundFx._stats());
  console.log('shots in', OUT, done.join(' '), ' fx', JSON.stringify(st), ' errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
