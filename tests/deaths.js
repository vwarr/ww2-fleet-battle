// Plane deaths: force each death type (WW.airDeaths.force), screenshot it, then check that pooled plane
// models come back whole and that object counts stay bounded over a long run with many forced deaths.
// Usage: bash tests/run.sh deaths.js   (or BASE_URL=http://localhost:PORT/ node tests/deaths.js)
require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SH = n => 'shots/deaths_' + n + '.png';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2000);
  let fails = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
  await p.evaluate(() => {
    __sim.setScale(0.1);
    // test camera: look at window.__look = { x, y, z, d, h } (distance d, elevation h) instead of the director
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * (L.ax || 0.8), L.y + L.h, L.z + L.d * (L.az || 0.6)); WW.camera.lookAt(L.x, L.y, L.z); WW.camera.updateMatrixWorld();
    };
    window.airborne = () => WW.world.planes.filter(q => q.alive && q.y > 15 && q.state !== 'takeoff').length;
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { if (cond()) return true; __sim.fastForward(0.25); } return cond(); };
    // camera on the side away from the nearest ship (or toward `away` = false), so hulls do not block the view
    window.look = (o, d, h, dy, toward) => {
      let best = null, bd = 1e9;
      for (const s of WW.world.ships) { if (s.removed) continue; const k = WW.dist(o.x, o.z, s.x, s.z); if (k < bd) { bd = k; best = s; } }
      let ax = 0.8, az = 0.6;
      if (best && bd < 40) { const l = bd || 1; ax = (o.x - best.x) / l; az = (o.z - best.z) / l; if (toward) { ax = -ax; az = -az; } }
      window.__look = { x: o.x, y: Math.max(0, (o.y || 0) + (dy || 0)), z: o.z, d: d || 22, h: h || 6, ax, az };
    };
  });
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: SH(name) }); };
  const getAir = async () => check(await p.evaluate(() => until(() => airborne() >= 2, 150)), 'planes airborne');

  // run one forced death: steps = [[simSeconds, shotName, cameraDist, camHeight, target]]
  async function death(mode, steps) {
    await getAir();
    const ok = await p.evaluate(m => { window.__dp = WW.airDeaths.force(m); return !!window.__dp; }, mode);
    check(ok, 'forced ' + mode);
    if (!ok) return;
    for (const [t, name, d, h, tgt] of steps) {
      await p.evaluate(([t, d, h, tgt]) => {
        __sim.fastForward(t);
        const q = window.__dp, P = WW.airProps;
        let o = q;
        if (tgt === 'chute') { const c = P._chutes.filter(c => c.alive).sort((a, b) => a.t - b.t)[0]; if (c) o = { x: c.x, y: c.y - 1, z: c.z }; }
        if (tgt === 'raft') { const r = P._rafts.filter(r => r.alive).sort((a, b) => a.t - b.t)[0]; if (r) o = { x: r.x, y: 0, z: r.z }; }
        if (tgt === 'ship' && q.crashTgt) o = { x: q.crashTgt.x, y: 2, z: q.crashTgt.z };
        look(o, d, h);
      }, [t, d, h, tgt]);
      await shot(mode + '_' + name);
    }
    console.log('  ' + mode + ': state', await p.evaluate(() => { const q = window.__dp; return q.deathMode + '/' + q.state + ' removed=' + q.removed + ' y=' + q.y.toFixed(1); }));
  }

  await death('wing', [[0.35, 'a', 18, 5], [1.2, 'b', 26, 6]]);
  await death('comet', [[0.3, 'a', 22, 5], [1.6, 'b', 34, 8]]);
  await death('bail', [[1.6, 'a', 20, 4], [5, 'chute', 12, 3, 'chute']]);
  await p.evaluate(() => until(() => WW.airProps._rafts.some(r => r.alive), 30));
  await p.evaluate(() => { const r = WW.airProps._rafts.find(r => r.alive); if (r) look({ x: r.x, y: 0, z: r.z }, 12, 5); });
  await shot('bail_raft');
  await death('ditch', [[0.5, 'a', 20, 4], [3.5, 'b', 14, 3]]);
  await p.evaluate(() => until(() => window.__dp.state === 'ditched', 20));
  await p.evaluate(() => { __sim.fastForward(4); look(window.__dp, 11, 3); });
  await shot('ditch_float');
  await p.evaluate(() => { __sim.fastForward(window.__dp.floatLife - window.__dp.fT - 2.5); look(window.__dp, 11, 3); });
  await shot('ditch_sinking');
  await death('abandon', [[1.5, 'a', 22, 5]]);
  const hp0 = await p.evaluate(() => { const s = WW.world.ships.filter(s => s.alive && !s.submerged); return s.map(s => s.hp).reduce((a, b) => a + b, 0); });
  await death('crash', [[1.0, 'a', 30, 8], [0.8, 'b', 30, 8]]);
  const crashed = await p.evaluate(() => until(() => window.__dp.removed, 15) && window.__dp.crashedInto ? window.__dp.crashedInto.type : null);
  await p.evaluate(() => { const t = window.__dp.crashTgt; look({ x: t.x, y: 2, z: t.z }, 34, 10); });
  await shot('crash_hit');
  check(!!crashed, 'crash hit a ship: ' + crashed + ' hits=' + (await p.evaluate(() => WW.airDeaths._debug().counts.shipHits)));
  void hp0;
  // slide-off from a carrier deck
  const sl = await p.evaluate(() => { window.__dp = WW.airDeaths.force('slide'); return !!window.__dp; });
  check(sl, 'forced slide');
  if (sl) {
    for (const [t, n] of [[0.9, 'a'], [0.6, 'b'], [1.2, 'c']]) {
      await p.evaluate(t => { __sim.fastForward(t); const q = window.__dp, h = q.carrier.heading, sd = q.slSide; window.__look = { x: q.x, y: Math.max(0, q.y), z: q.z, d: 16, h: 4, ax: -Math.sin(h) * sd * 0.9 + Math.cos(h) * 0.4, az: Math.cos(h) * sd * 0.9 + Math.sin(h) * 0.4 }; }, t);
      await shot('slide_' + n);
    }
  }
  await p.evaluate(() => { window.__look = null; });

  // ---- pooled models come back whole; counts stay bounded over a long run with many forced deaths ----
  const before = await p.evaluate(() => ({ scene: WW.scene.children.length, fx: WW.fx._stats() }));
  const res = await p.evaluate(() => {
    const modes = ['wing', 'wing', 'comet', 'bail', 'ditch', 'spin', 'abandon', 'crash', 'slide'];
    let maxPlanes = 0, bad = [], forced = 0, maxScene = 0;
    for (let i = 0; i < 1200; i++) {   // 600 sim s
      __sim.fastForward(0.5);
      if (i % 6 === 0) { if (WW.airDeaths.force(modes[(i / 6) % modes.length])) forced++; }
      maxPlanes = Math.max(maxPlanes, WW.world.planes.length); maxScene = Math.max(maxScene, WW.scene.children.length);
      for (const q of WW.world.planes) {
        if (!q.alive || q.removed) continue;
        const m = q.model;
        if (m.wingL && (!m.wingL.visible || !m.wingR.visible)) bad.push('wing hidden on live ' + q.kind);
        if (m.payload && m.payload.visible !== q.ordnance) bad.push('payload mismatch ' + q.kind);
        if (!m.group.visible || m.group.parent !== WW.scene) bad.push('group hidden/detached');
      }
    }
    return { forced, maxPlanes, maxScene, bad: bad.slice(0, 5), nbad: bad.length, dbg: WW.airDeaths._debug(), stats: WW.stats, round: WW.stats.round };
  });
  const after = await p.evaluate(() => ({ scene: WW.scene.children.length, fx: WW.fx._stats() }));
  console.log('long run:', JSON.stringify(res));
  console.log('scene children before/after', before.scene, after.scene, 'max', res.maxScene);
  check(res.nbad === 0, 'pooled models intact on reuse (' + res.nbad + ' problems) ' + res.bad.join('; '));
  check(res.forced > 50, 'forced deaths ' + res.forced);
  check(res.maxPlanes < 60, 'world.planes bounded (max ' + res.maxPlanes + ')');
  check(after.scene <= before.scene + 60, 'scene children bounded');
  console.log('errors:', errs.length, errs.slice(0, 5));
  check(errs.length === 0, 'no page errors');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
