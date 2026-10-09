// Plane rendering stress test (air_render.js): force-spawns N airborne planes in formations (both nations, all
// three carrier types) plus P extra parked on the carrier decks (default 0: air_deck.js already spots one deck load), then measures fps, draw calls (main + shadow pass) and
// triangles per frame, and takes screenshots.
// Usage: node tests/air_stress.js [--n 200] [--parked 0] [--secs 8] [--view far|mid|close|game] [--headless] [--off]
//   real GPU by default (system Chrome, a visible window, like fps.js); --headless: CHROMIUM + SwiftShader (shots only).
//   --off: WW.planeRender disabled (every plane drawn as its own meshes, the pre-instancing path) for A/B runs.
//   BASE_URL (default http://localhost:8000/). Shots in tests/shots/stress_<view>[_off].png.
const { chromium } = require('playwright');
const path = require('path');
require('fs').mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const flag = k => process.argv.includes('--' + k);
const N = +arg('n', 200), PARKED = +arg('parked', 0), SECS = +arg('secs', 8), VIEW = arg('view', 'mid'), OFF = flag('off');
(async () => {
  const headless = flag('headless');
  const b = await chromium.launch(headless
    ? { executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { channel: 'chrome', headless: false });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(3000);
  const info = await p.evaluate(([N, PARKED, OFF]) => {
    if (OFF && WW.planeRender) WW.planeRender.enabled = false;
    // a round with a carrier on each side
    const hasCv = () => ['USN', 'IJN'].every(n => WW.world.ships.some(s => s.alive && s.nation === n && s.type === 'carrier' && !s.isBase));
    for (let k = 0; k < 30 && !hasCv(); k++) WW.game.startRound();
    __sim.fastForward(2);
    const cv = { USN: WW.world.ships.find(s => s.alive && s.nation === 'USN' && s.type === 'carrier' && !s.isBase),
      IJN: WW.world.ships.find(s => s.alive && s.nation === 'IJN' && s.type === 'carrier' && !s.isBase) };
    // the stress formations orbit a point between the fleets, the camera looks at it
    const cx = (cv.USN.x + cv.IJN.x) / 2, cz = (cv.USN.z + cv.IJN.z) / 2;
    window.__stress = { cx, cz, planes: [] };
    const kinds = ['fighter', 'dive', 'torpedo'];
    for (let i = 0; i < N; i++) {
      const nation = i % 2 ? 'IJN' : 'USN', kind = kinds[(i >> 1) % 3], c = cv[nation];
      const pl = new WW.Plane(kind, nation, c, null, WW.air._pool.get(kind, nation));
      if (WW.dogfight) WW.dogfight.equip(pl);
      // groups of 12 in vics, on rings of radius 60..260 around the centre, altitude by kind
      const g = Math.floor(i / 12), j = i % 12, R0 = 60 + (g % 6) * 40, a0 = g * 1.7 + (j % 3) * 0.02;
      const o = { R: R0 + (j >> 2) * 6 + (j % 3) * 3, a: a0 - (j >> 2) * 0.03, w: (g % 2 ? 1 : -1) * 28 / R0, y: 22 + (kind === 'fighter' ? 18 : kind === 'dive' ? 10 : 0) + (j % 3) * 2 };
      pl.state = 'stress'; pl.hp = pl.maxHp = 1e9; pl.ordnance = kind !== 'fighter'; if (pl.payload) pl.payload.visible = pl.ordnance;
      pl.update = function (dt) {   // a steady banked orbit: prop discs, banking, vapour in the tight rings
        this.t += dt; o.a += o.w * dt;
        const x = cx + Math.cos(o.a) * o.R, z = cz + Math.sin(o.a) * o.R;
        this.heading = o.a + (o.w > 0 ? Math.PI / 2 : -Math.PI / 2); this.speed = Math.abs(o.w) * o.R; this.turn = o.w;
        this.vy = 0; this.x = x; this.y = o.y; this.z = z; this.sync(dt);
      };
      pl.x = cx + Math.cos(o.a) * o.R; pl.z = cz + Math.sin(o.a) * o.R; pl.y = o.y;
      WW.world.planes.push(pl); __stress.planes.push(pl);
    }
    // parked: rows on each carrier deck, wings folded (on top of what air_deck.js spotted)
    let parked = 0;
    for (const n of ['USN', 'IJN']) {
      const c = cv[n], top = c.model.deck ? c.model.deck.position.y : 2;
      for (let i = 0; i < PARKED / 2; i++) {
        const kind = kinds[i % 3], m = WW.air._pool.get(kind, n);
        c.group.add(m.group); m.group.rotation.set(0, 0, 0);
        m.group.position.set(-12 + (i % 10) * 2.6, top + WW.air._pool.deckY + 0.02, (Math.floor(i / 10) - 1) * 2.4);
        if (m.wingL && m.wingR) { m.wingL.rotation.x = Math.sign(m.wingL.position.z || -1) * -1.75; m.wingR.rotation.x = -Math.sign(m.wingR.position.z || 1) * 1.75; }
        parked++;
      }
    }
    // the debug camera: WW.cam paused, the camera follows __view each frame
    const cam = WW.cam, upd = cam.update, ar = cam.afterRender;
    window.__view = null;
    cam.update = function (dt) { if (!window.__view) return upd.call(cam, dt); window.__view(WW.camera, dt); };
    cam.afterRender = function () { if (!window.__view && ar) return ar.call(cam); };
    // per-frame counters: draw calls and triangles over all passes (shadow maps, post)
    const r = WW.renderer; r.info.autoReset = false;
    const P = WW.post, rend = P ? P.render : null;
    window.__ri = { n: 0, calls: 0, tris: 0, cpu: 0 };
    const wrap = function (orig, self) { return function () { r.info.reset(); const t0 = performance.now(); orig.apply(self, arguments);
      __ri.cpu += performance.now() - t0; __ri.n++; __ri.calls += r.info.render.calls; __ri.tris += r.info.render.triangles; }; };
    if (P) P.render = wrap(rend, P); else r.render = wrap(r.render, r);
    return { carriers: [cv.USN.x | 0, cv.USN.z | 0, cv.IJN.x | 0, cv.IJN.z | 0], centre: [cx | 0, cz | 0], planes: WW.world.planes.length, parked };
  }, [N, PARKED, OFF]);
  console.log('setup', JSON.stringify(info));
  const views = VIEW === 'all' ? ['far', 'mid', 'close', 'deck'] : [VIEW];
  for (const v of views) {
    await p.evaluate(v => {
      const S = __stress;
      if (v === 'game') { window.__view = null; return; }
      if (v === 'deck') { const c = WW.world.ships.find(s => s.alive && s.type === 'carrier' && s.nation === 'USN');
        window.__view = cam => { cam.position.set(c.x - Math.cos(c.heading) * 30, 18, c.z - Math.sin(c.heading) * 30 + 14); cam.lookAt(c.x, 2, c.z); }; return; }
      if (v === 'close') { const q = S.planes[24];
        window.__view = cam => { const h = q.heading; cam.position.set(q.x - Math.cos(h) * 9 + Math.sin(h) * 5, q.y + 3, q.z - Math.sin(h) * 9 - Math.cos(h) * 5); cam.lookAt(q.x, q.y, q.z); }; return; }
      const d = v === 'far' ? 520 : 300, hgt = v === 'far' ? 260 : 120;
      window.__view = cam => { cam.position.set(S.cx - d, hgt, S.cz - d * 0.4); cam.lookAt(S.cx, 30, S.cz); };
    }, v);
    await p.waitForTimeout(1500);
    const r = await p.evaluate(secs => new Promise(res => { __ri.n = __ri.calls = __ri.tris = __ri.cpu = 0; let n = 0, worst = 0, lt = performance.now(); const t0 = lt;
      (function f() { const t = performance.now(); worst = Math.max(worst, t - lt); lt = t; n++;
        if (t - t0 < secs * 1000) requestAnimationFrame(f);
        else res({ fps: n / ((t - t0) / 1000), worst, calls: __ri.calls / Math.max(1, __ri.n), tris: __ri.tris / Math.max(1, __ri.n), cpuRender: __ri.cpu / Math.max(1, __ri.n),
          planes: WW.world.planes.filter(q => !q.removed).length, inst: WW.planeRender && WW.planeRender.stats ? WW.planeRender.stats() : null }); })(); }), SECS);
    await p.screenshot({ path: 'shots/stress_' + v + (OFF ? '_off' : '') + '.png' });
    console.log(v + (OFF ? ' (off)' : ''), 'fps', r.fps.toFixed(1), 'worst ms', r.worst.toFixed(1), 'draw calls', r.calls.toFixed(0), 'tris', (r.tris / 1e6).toFixed(2) + 'M',
      'render() cpu ms', r.cpuRender.toFixed(2), 'planes', r.planes, r.inst ? 'inst ' + JSON.stringify(r.inst) : '');
  }
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
