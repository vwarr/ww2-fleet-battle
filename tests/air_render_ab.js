// Instanced plane rendering A/B (air_render.js): the same frozen frame drawn with WW.planeRender on (instances) and
// off (every plane as its own meshes), screenshot both and count the pixels that differ. Scenes: a strike close up,
// a dogfight, a parked deck with folded wings, a plane death (sheared wing), a dive bomber with its brakes open,
// a B-17 (land plane), and the director camera. Shots: tests/shots/ab_<scene>_on.png / _off.png.
// Usage: CHROMIUM=... BASE_URL=http://localhost:PORT/ node tests/air_render_ab.js
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2500);
  let fails = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
  await p.evaluate(() => {
    const hasCv = () => ['USN', 'IJN'].every(n => WW.world.ships.some(s => s.alive && s.nation === n && s.type === 'carrier' && !s.isBase));
    for (let k = 0; k < 30 && !hasCv(); k++) WW.game.startRound();
    const camUpd = WW.cam.update.bind(WW.cam), ar = WW.cam.afterRender;
    window.__view = null;
    WW.cam.update = function (rdt) { if (!window.__view) return camUpd(rdt); window.__view(WW.camera); };
    WW.cam.afterRender = function () { if (!window.__view && ar) return ar.call(WW.cam); };
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { if (cond()) return true; __sim.fastForward(0.25); } return cond(); };
    window.follow = (q, ox, oy, oz) => { window.__view = c => { const h = q.heading, ch = Math.cos(h), sh = Math.sin(h);
      c.position.set(q.x + ch * ox - sh * oz, q.y + oy, q.z + sh * ox + ch * oz); c.lookAt(q.x, q.y, q.z); }; };
    // freeze: no sim time, and air_fx's random exhaust flicker held still, so the two frames match
    window.freeze = on => { __sim.setScale(on ? 0.1 : 1); WW.time.scale = on ? 1e-9 : 1; };
  });
  // diff of two PNG screenshots, decoded in the page
  const diff = async (a, c) => p.evaluate(async ([a, c]) => {
    const load = async s => { const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
      const cv = new OffscreenCanvas(im.width, im.height), x = cv.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
    const A = await load(a), C = await load(c);
    let n = 0, big = 0;
    for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - C[i]), Math.abs(A[i + 1] - C[i + 1]), Math.abs(A[i + 2] - C[i + 2])); if (d > 8) n++; if (d > 48) big++; }
    return { pct: 100 * n / (A.length / 4), bigPct: 100 * big / (A.length / 4) };
  }, [a.toString('base64'), c.toString('base64')]);
  // on, off, on again: the second "on" frame gives the noise floor (water, weather and clouds animate on real
  // time); the plane rendering passes when on vs off differs no more than on vs on.
  const canvas = p.locator('#game');
  async function ab(name) {
    await p.evaluate(() => freeze(true)); await p.waitForTimeout(400);
    const on = await canvas.screenshot({ path: 'shots/ab_' + name + '_on.png' });
    await p.evaluate(() => { WW.planeRender.enabled = false; }); await p.waitForTimeout(300);
    const off = await canvas.screenshot({ path: 'shots/ab_' + name + '_off.png' });
    await p.evaluate(() => { WW.planeRender.enabled = true; }); await p.waitForTimeout(300);
    const on2 = await canvas.screenshot();
    await p.evaluate(() => freeze(false));
    const d = await diff(on, off), n = await diff(on, on2), st = await p.evaluate(() => WW.planeRender.stats());
    check(d.bigPct <= n.bigPct + 0.02 && d.pct <= n.pct * 1.5 + 0.2, name + ': on/off ' + d.pct.toFixed(3) + '% px differ (> 8/255), ' + d.bigPct.toFixed(3) + '% strongly (> 48/255); noise floor on/on ' +
      n.pct.toFixed(3) + '% / ' + n.bigPct.toFixed(3) + '%; instances ' + st.instances);
  }
  // 1. strike close up: the nearest armed bomber in transit
  const sk = await p.evaluate(() => until(() => WW.world.planes.some(q => q.alive && q.ordnance && q.state === 'transit' && q.y > 15), 900));
  check(sk, 'strike airborne');
  if (sk) { await p.evaluate(() => { const q = WW.world.planes.find(q => q.alive && q.ordnance && q.state === 'transit' && q.y > 15); follow(q, -9, 3, 5); }); await ab('strike'); }
  // 2. a dogfight: a fighter with a foe
  const df = await p.evaluate(() => until(() => WW.world.planes.some(q => q.alive && q.kind === 'fighter' && q.foe && q.foe.alive && q.state === 'attack'), 600));
  if (df) { await p.evaluate(() => { const q = WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.foe && q.foe.alive && q.state === 'attack'); follow(q, -12, 4, 6); }); await ab('dogfight'); }
  else console.log('skip dogfight (none found)');
  // 3. a parked deck, wings folded
  await p.evaluate(() => { const c = WW.world.ships.find(s => s.alive && s.type === 'carrier' && !s.isBase);
    window.__view = cam => { cam.position.set(c.x - Math.cos(c.heading) * 22 + 10, 12, c.z - Math.sin(c.heading) * 22 + 8); cam.lookAt(c.x, 2, c.z); }; });
  await ab('deck');
  // 4. a plane death: sheared wing
  const dp = await p.evaluate(() => { until(() => WW.world.planes.some(q => q.alive && q.y > 15 && q.state !== 'takeoff'), 100);
    const q = WW.airDeaths.force('wing'); if (!q) return false; __sim.fastForward(0.4); follow(q, -10, 4, 7); window.__dp = q; return true; });
  check(dp, 'forced wing death');
  if (dp) await ab('death');
  // 5. dive brakes open (posed on a live dive bomber)
  const db = await p.evaluate(() => { const q = WW.world.planes.find(q => q.alive && q.kind === 'dive' && q.model.brakes && q.y > 10); if (!q) return false;
    q.model.brakes.set(1); follow(q, -4, 2.5, 6); return true; });
  if (db) await ab('brakes');
  // 6. a land-based bomber (models_landplanes.js: extra propellers through the body's onBeforeRender), posed airborne
  const lp = await p.evaluate(() => { const c = WW.world.ships.find(s => s.alive && s.type === 'carrier' && !s.isBase); if (!c) return false;
    const q = new WW.Plane('b17', 'USN', c, null, WW.air._pool.get('b17', 'USN')); q.state = 'stress'; q.hp = q.maxHp = 1e9;
    q.x = c.x + 30; q.z = c.z + 20; q.y = 25; q.heading = 0.6; q.speed = 20; q.update = function (dt) { this.sync(dt); };
    WW.world.planes.push(q); __sim.fastForward(0.1); follow(q, -10, 3, 8); return true; });
  check(lp, 'land bomber spawned');
  if (lp) await ab('landplane');
  // 7. the director camera, whatever it shows
  await p.evaluate(() => { window.__view = null; }); await p.waitForTimeout(1500);
  await ab('director');
  console.log('errors', errs.slice(0, 5));
  if (errs.length) fails++;
  await b.close();
  process.exit(fails ? 1 : 0);
})();
