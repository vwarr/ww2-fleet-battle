// Flying boats at the waterline (render, swiftshader): the boat on the water at the island's ramp, taxiing out, afloat
// on the open sea (a rescue landing), hauled up the ramp, on the apron. Low side-on shots near the water, and the
// measured heights of the keel, the chine and the wingtip floats' bottoms above the water (y = 0).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/flyingboats_waterline_shots.js [--seed N=2] [--base USN|IJN] [--out dir]
// Shots in tests/shots/flying_boats_waterline/<out>/*.png.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEED = +arg('--seed', 2), BASE = arg('--base', 'USN');
const DIR = path.join(__dirname, 'shots', 'flying_boats_waterline', arg('--out', 'run') + '_' + BASE + '_s' + SEED); fs.mkdirSync(DIR, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.setDefaultTimeout(300000);
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8131/') + 'index.html?auto&v=' + Date.now(), { timeout: 120000 });
  await p.waitForTimeout(4000);
  await p.evaluate(([seed, base]) => {
    const cam = WW.cam, upd = cam.update, ar = cam.afterRender;
    window.__view = null;
    cam.update = function (dt) { if (!window.__view) return upd.call(cam, dt); window.__view(WW.camera, dt); };
    cam.afterRender = function () { if (!window.__view && ar) return ar.call(cam); };
    const G = WW.game; if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    if (WW.dayNight) WW.dayNight.force = 'day';
    G.composition = null; G.mode = 'auto'; G.baseChoice = base; G.startRound({ keepMap: true }); G.baseChoice = null;
    if (WW.ui && WW.ui.caption) WW.ui.caption = () => {};
    // world heights of the boat's parts: the keel (lowest hull point), the wingtip floats' bottoms
    const v = new THREE.Vector3();
    window.__measure = q => {
      const g = q.model.group; g.updateMatrixWorld(true);
      const low = o => { let m = 1e9; o.traverse(c => { if (!c.isMesh || !c.visible) return; const a = c.geometry.attributes.position; for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(c.matrixWorld); if (v.y < m) m = v.y; } }); return m; };
      const fl = q.model.floats.parts.map(low);
      return 'keel ' + low(g.children[0]).toFixed(3) + ' floats ' + fl.map(f => f.toFixed(3)).join(' / ') + ' (p.y ' + q.y.toFixed(3) + ', ground ' + WW.terrain.depthAt(q.x, q.z).toFixed(2) + ' deep)';
    };
  }, [SEED, BASE]);
  const shot = async name => {
    await p.waitForTimeout(1200); await p.screenshot({ path: path.join(DIR, name + '.png'), timeout: 300000 });
    console.log('shot', path.join(DIR, name + '.png'), '|', await p.evaluate(() => __measure(window.__q)));
  };
  // the boat (window.__q) from an offset in its own frame (ox ahead, oz to the side), looking at it
  const follow = ([ox, oy, oz, look]) => { window.__view = c => { const q = window.__q, h = q.heading, ch = Math.cos(h), sh = Math.sin(h); c.position.set(q.x + ch * ox - sh * oz, Math.max(0.35, q.y + oy), q.z + sh * ox + ch * oz); c.lookAt(q.x + ch * (look || 0), q.y, q.z + sh * (look || 0)); }; };
  const until = (cond, max) => p.evaluate(([c, max]) => {
    const f = new Function('q', 'return ' + c);
    for (let i = 0; i < max * 20; i++) { const q = WW.world.planes.find(q => q.alive && q.kind === 'flyingboat' && q.ramp && f(q)); if (q) { window.__q = q; return q.boatType + ' ' + q.state + ' spd ' + q.speed.toFixed(1) + ' t ' + WW.game.roundTime.toFixed(1); } __sim.fastForward(0.05); }
    return null;
  }, [cond, max]);
  await p.evaluate(() => __sim.setScale(0.02));   // nearly frozen between shots
  let r = await until("q.state === 'depart' && q.stT > 0.5", 5); console.log('ramp:', r);
  if (!r) { console.log('no boat at the ramp'); await b.close(); return; }
  await p.evaluate(follow, [-1, 0.3, 9, 0]); await shot('1_ramp_side_low');
  await p.evaluate(follow, [-10, 2.5, 7, 0]); await shot('2_ramp_quarter');
  await p.evaluate(follow, [0, 0.25, -8, 0]); await shot('3_ramp_other_side_low');
  r = await until("q.state === 'depart' && q.speed > 2.5 && q.speed < 8", 30); console.log('taxi:', r);
  if (r) { await p.evaluate(follow, [-1, 0.35, 9, 0]); await shot('4_taxiing_side_low'); await p.evaluate(follow, [-12, 3.5, -9, 4]); await shot('5_taxiing_quarter'); }
  r = await until("q.state === 'depart' && q.speed > 13", 40); console.log('run:', r);
  if (r) { await p.evaluate(follow, [-1, 0.5, 10, 0]); await shot('5b_take_off_run_on_the_step'); }
  r = await until("q.y > 6", 40); console.log('climb:', r);
  if (r) { await p.evaluate(follow, [-6, 1.5, 10, 0]); await shot('5c_climbing_out_floats_coming_up'); }
  r = await until("q.y > 12 && q.floatA < 0.05", 60); console.log('flight:', r);
  if (r) { await p.evaluate(follow, [-6, 1.5, 10, 0]); await shot('5d_in_flight'); }
  // the open-sea rescue landing: the boat put down afloat on open water (state 'afloat': it lifts off at once with no
  // task, 'liftoff' is on the water too for its first seconds)
  r = await p.evaluate(() => {
    const q = window.__q, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H; let x = q.x, z = q.z;
    search: for (let r = 60; r < 2000; r += 30) for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, cx = q.x + Math.cos(a) * r, cz = q.z + Math.sin(a) * r;
      if (cx > 40 && cx < W - 40 && cz > 40 && cz < H - 40 && WW.terrain.depthAt(cx, cz) > 15) { x = cx; z = cz; break search; }
    }
    q.x = x; q.z = z; q.y = WW.flyingBoats.WATER_Y; q.vy = 0; q.speed = 0; q.setState('afloat'); q.t = 0; q.floatA = 1; q.model.floats.set(1); q.sync(0.02);
    return 'afloat at ' + x.toFixed(0) + ',' + z.toFixed(0) + ' depth ' + WW.terrain.depthAt(x, z).toFixed(1);
  });
  console.log(r);
  await p.evaluate(follow, [-1, 0.3, 9, 0]); await shot('6_open_sea_side_low');
  await p.evaluate(follow, [-1, 0.3, -9, 0]); await shot('7_open_sea_other_side_low');
  await p.evaluate(follow, [9, 0.4, 1, 0]); await shot('8_open_sea_head_on');
  await p.evaluate(follow, [0, 0.08, 4.5, 0]); await shot('8b_open_sea_close_at_the_waterline');
  // hauled up the ramp: at the foot (k 0), the waterline (k 0.5), on the apron (k ~1)
  const haul = k => p.evaluate(k => { const q = window.__q, R = q.ramp; q.x = R.wx; q.z = R.wz; q.heading = R.h + Math.PI; q.lh = null; q.speed = 0; q.vy = 0; q.setState('taxiIn'); q.upT = WW.time.now - k * 9; q.update(0.001); q.sync(0.001); return q.state + ' k ' + k; }, k);
  for (const [k, n] of [[0.02, '9_haul_at_foot'], [0.5, '10_haul_waterline'], [0.62, '11a_haul_up_the_slipway'], [0.75, '11_haul_on_slipway'], [0.97, '12_on_the_apron']]) {
    console.log(await haul(k)); await p.evaluate(() => __sim.setScale(0.0001));
    await p.evaluate(follow, [-1, 0.9, 8, 0]); await shot(n);
  }
  console.log(errs.length ? 'ERRORS ' + errs.length + '\n' + errs.slice(0, 6).join('\n') : 'errors 0');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
