// The dawn patrol off the lagoon and the island's alarm, in the full game (render, swiftshader): the boats on the
// water at the ramp, taxiing out, the take-off run, climbing out over the lagoon, then the camp at the alarm their
// sighting report raises (base_alert.js). Shots in tests/shots/flying_boats/*.png.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/flyingboats_dawn_shots.js [--seed N=1] [--base USN|IJN]
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'shots', 'flying_boats'); fs.mkdirSync(DIR, { recursive: true });
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEED = +arg('--seed', 1), BASE = arg('--base', 'USN');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.setDefaultTimeout(300000);
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8129/') + 'index.html?auto&v=' + Date.now(), { timeout: 120000 });
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
    window.__log = []; WW.on('flyingBoat', e => __log.push(WW.game.roundTime.toFixed(1) + ' ' + e.nation + ' ' + e.order));
  }, [SEED, BASE]);
  const shot = async name => { await p.waitForTimeout(1200); await p.screenshot({ path: path.join(DIR, name + '.png'), timeout: 300000 }); console.log('shot', path.join(DIR, name + '.png')); };
  // the boat (window.__q) from an offset in its own frame (ox ahead, oz to the side), looking at it
  const follow = ([ox, oy, oz, look]) => { window.__view = c => { const q = window.__q, h = q.heading, ch = Math.cos(h), sh = Math.sin(h); c.position.set(q.x + ch * ox - sh * oz, Math.max(1.2, q.y + oy), q.z + sh * ox + ch * oz); c.lookAt(q.x + ch * (look || 0), q.y, q.z + sh * (look || 0)); }; };
  const until = (cond, max) => p.evaluate(([c, max]) => {
    const f = new Function('q', 'return ' + c);
    for (let i = 0; i < max * 20; i++) { const q = WW.world.planes.find(q => q.alive && q.kind === 'flyingboat' && q.ramp && f(q)); if (q) { window.__q = q; return q.boatType + ' ' + q.state + ' spd ' + q.speed.toFixed(1) + ' t ' + WW.game.roundTime.toFixed(1); } __sim.fastForward(0.05); }
    return null;
  }, [cond, max]);
  await p.evaluate(() => __sim.setScale(0.05));   // nearly frozen between shots: the frames render the moment we stop at
  let r = await until("q.state === 'depart' && q.stT > 0.5", 5); console.log('ramp:', r);
  if (r) { await p.evaluate(follow, [-14, 4, 10, 0]); await shot('1_on_the_water_at_the_ramp'); }
  r = await until("q.state === 'depart' && q.speed > 2.5 && q.speed < 8", 30); console.log('taxi:', r);
  if (r) { await p.evaluate(follow, [-12, 3.5, -9, 4]); await shot('2_taxiing_out'); }
  r = await until("q.state === 'depart' && q.speed > 12", 30); console.log('run:', r);
  if (r) { await p.evaluate(follow, [6, 2.2, 14, 6]); await shot('3_take_off_run'); }
  r = await until("q.state === 'inbound' || (q.state === 'search' && q.y > 12 && q.stT < 4)", 30); console.log('climb:', r);
  if (r) { await p.evaluate(follow, [-30, 6, -14, 10]); await shot('4_climbing_out_over_the_lagoon'); }
  // the alarm: run the sim on to the sighting report, then real time at the camp (the men run to their posts)
  const al = await p.evaluate(() => { const b = WW.islandBase.base; for (let i = 0; i < 2400 && !b.alarm; i++) __sim.fastForward(0.05); return b.alarm ? { t: WW.game.roundTime.toFixed(1), kind: b.alarm.kind, by: b.alarm.by } : null; });
  console.log('alarm:', JSON.stringify(al));
  if (al) {
    await p.evaluate(() => {
      const b = WW.islandBase.base, C = (b.decor || []).filter(d => d.kind === 'hut' || d.kind === 'tent' || d.kind === 'mess');
      const fx = C.length ? C.reduce((s, d) => s + d.x, 0) / C.length : b.x, fz = C.length ? C.reduce((s, d) => s + d.z, 0) / C.length : b.z, y = Math.max(b.site.padH, 1);
      window.__view = c => { c.position.set(fx + 26, y + 13, fz + 22); c.lookAt(fx, y, fz); };
      __sim.setScale(1);
    });
    await p.waitForTimeout(2500); await shot('5_camp_alarm');
    await p.waitForTimeout(3500); await shot('6_camp_alarm_later');
    await p.evaluate(() => { window.__view = null; });   // the director's own shot (camera.js 'baseAlarm' cut, if it took it)
  }
  console.log((await p.evaluate(() => window.__log)).slice(0, 20).join(' | '));
  console.log(errs.length ? 'ERRORS ' + errs.length + '\n' + errs.slice(0, 6).join('\n') : 'errors 0');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
