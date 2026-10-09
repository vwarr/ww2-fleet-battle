// Plane rendering stress test (air_render.js): force-spawns N airborne planes in formations (both nations, all
// three carrier types) plus P extra parked on the carrier decks (default 0: air_deck.js already spots one deck load), then measures fps, draw calls (main + shadow pass) and
// triangles per frame, and takes screenshots.
// Usage: node tests/air_stress.js [--n 200] [--parked 0] [--secs 8] [--view far,mid,close,deck|all] [--headless] [--off] [--vsync]
//   --game [--wing 1] [--step 45] [--until 900] [--seed S]: no stress planes; a real carrier round with full air wings (?wing=), fps vs airborne count.
//   real GPU by default (system Chrome, a visible window, like fps.js); --headless: CHROMIUM + SwiftShader (shots only).
//   --off: WW.planeRender disabled (every plane drawn as its own meshes, the pre-instancing path) for A/B runs.
//   BASE_URL (default http://localhost:8000/). Shots in tests/shots/stress_<view>[_off].png.
const { chromium } = require('playwright');
const path = require('path');
require('fs').mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); process.chdir(__dirname);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const flag = k => process.argv.includes('--' + k);
const N = +arg('n', 200), PARKED = +arg('parked', 0), SECS = +arg('secs', 8), VIEW = arg('view', 'mid'), OFF = flag('off'), GAME = flag('game'), STEP = +arg('step', 45), SEED = arg('seed', null) == null ? null : +arg('seed');
(async () => {
  const headless = flag('headless');
  const b = await chromium.launch(headless
    ? { executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { channel: 'chrome', headless: false, args: flag('vsync') ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); else if (/^(tris per|seed )/.test(m.text())) console.log(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto' + (GAME ? '&wing=' + arg('wing', 1) : '') + '&v=' + Date.now());
  await p.waitForTimeout(3000);
  if (GAME) {   // the real game: a carrier round, director camera; every STEP sim s, fps over SECS with the airborne count
    await p.evaluate(([OFF, SEED]) => { if (OFF && WW.planeRender) WW.planeRender.enabled = false; const hasCv = () => ['USN', 'IJN'].every(n => WW.world.ships.some(s => s.alive && s.nation === n && s.type === 'carrier' && !s.isBase));
      // --seed S: a seeded round (as determinism.js), the first of S, S+1, ... with a carrier on each side: on/off runs see the same battle
      const seeded = sd => { const G = WW.game; if (WW.aces) WW.aces.reset(); WW.terrain.generate(sd); WW.seedRandom(sd); G.seed = sd; WW.time.now = 0;
        G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true }); };
      for (let k = 0; k < 30 && (SEED != null || !hasCv()); k++) { if (SEED == null) WW.game.startRound(); else { seeded(SEED + k); if (hasCv()) { console.log('seed ' + (SEED + k)); break; } } } }, [OFF, SEED]);
    let worst = 1e9, peak = { air: 0 };
    for (let t = 0; t < +arg('until', 900); t += STEP) {
      // seeded: the sim is frozen while fps is measured (the frames still render), so on/off runs stay the same battle
      const r = await p.evaluate(([step, secs, frz]) => { __sim.fastForward(step); if (frz) { __sim.setScale(0.1); WW.time.scale = 1e-9; } return new Promise(res => { let n = 0; const t0 = performance.now();
        (function f() { n++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f);
          else { if (frz) { __sim.setScale(1); WW.time.scale = 1; } res({ fps: n / ((performance.now() - t0) / 1000), air: WW.world.planes.filter(q => q.alive && !q.removed && q.y > 3).length,
            all: WW.world.planes.filter(q => !q.removed).length, over: WW.game.state !== 'battle' }); } })(); }); }, [STEP, SECS, SEED != null]);
      console.log('t', t + STEP, 'fps', r.fps.toFixed(1), 'airborne', r.air, 'planes', r.all, r.over ? '(round over: not counted)' : '');
      if (r.over) break;
      if (r.air >= 20) worst = Math.min(worst, r.fps);
      if (r.air > peak.air) peak = { air: r.air, fps: r.fps, t: t + STEP };
      if (r.air === peak.air && r.air > 0) await p.screenshot({ path: 'shots/stress_game.png' });
    }
    console.log('game: peak airborne', peak.air, 'at t', peak.t, 'fps', (peak.fps || 0).toFixed(1), '; worst fps with >= 20 airborne', worst.toFixed(1));
    console.log('errors', errs.slice(0, 5)); await b.close(); return;
  }
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
    window.__ri = { n: 0, calls: 0, tris: 0, cpu: 0, prof: {} };
    // CPU per module per frame (ms): wrap the update functions main.js calls
    const prof = (obj, name, fn) => { if (!obj || typeof obj[fn] !== 'function') return; const f = obj[fn];
      obj[fn] = function () { const t0 = performance.now(); const r = f.apply(this, arguments); __ri.prof[name] = (__ri.prof[name] || 0) + performance.now() - t0; return r; }; };
    prof(WW.air, 'air', 'update'); prof(WW.airFx, 'airFx', 'update'); prof(WW.combat, 'combat', 'update'); prof(WW.fx, 'fx', 'update');
    prof(WW.ships, 'ships', 'update'); prof(WW.intel, 'intel', 'update'); prof(WW.water, 'water', 'update'); prof(WW.crew, 'crew', 'update');
    prof(WW.dogfight, 'dogfight', 'update'); prof(WW.airDeck, 'airDeck', 'update'); prof(WW.lifeboats, 'lifeboats', 'update'); prof(WW.dmgVis, 'dmgVis', 'draw');
    const tpl = {}; for (const q of WW.world.planes) { const k = q.kind + q.nation; if (tpl[k]) continue; let t = 0;
      q.group.traverse(o => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); tpl[k] = Math.round(t); }
    console.log('tris per plane model', JSON.stringify(tpl));
    const wrap = function (orig, self) { return function () { r.info.reset(); const t0 = performance.now(); orig.apply(self, arguments);
      __ri.cpu += performance.now() - t0; __ri.n++; __ri.calls += r.info.render.calls; __ri.tris += r.info.render.triangles; }; };
    if (P) P.render = wrap(rend, P); else r.render = wrap(r.render, r);
    return { carriers: [cv.USN.x | 0, cv.USN.z | 0, cv.IJN.x | 0, cv.IJN.z | 0], centre: [cx | 0, cz | 0], planes: WW.world.planes.length, parked };
  }, [N, PARKED, OFF]);
  console.log('setup', JSON.stringify(info));
  const views = VIEW === 'all' ? ['far', 'mid', 'close', 'deck'] : VIEW.split(',');
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
    // --hide: plane instances not drawn (the cost of everything else); --noshadow: plane instances cast no shadow
    if (flag('hide') || flag('noshadow')) await p.evaluate(([h, ns]) => WW.scene.children.forEach(o => { if (o.name === 'planeRender') { if (h) o.visible = false; if (ns) o.castShadow = false; } }), [flag('hide'), flag('noshadow')]);
    const r = await p.evaluate(secs => new Promise(res => { __ri.n = __ri.calls = __ri.tris = __ri.cpu = 0; __ri.prof = {}; let n = 0, worst = 0, lt = performance.now(); const t0 = lt;
      (function f() { const t = performance.now(); worst = Math.max(worst, t - lt); lt = t; n++;
        if (t - t0 < secs * 1000) requestAnimationFrame(f);
        else res({ fps: n / ((t - t0) / 1000), worst, calls: __ri.calls / Math.max(1, __ri.n), tris: __ri.tris / Math.max(1, __ri.n), cpuRender: __ri.cpu / Math.max(1, __ri.n),
          planes: WW.world.planes.filter(q => !q.removed).length, prof: Object.entries(__ri.prof).map(([k, v]) => k + ' ' + (v / Math.max(1, __ri.n)).toFixed(2)).join(', '), inst: WW.planeRender && WW.planeRender.stats ? WW.planeRender.stats() : null }); })(); }), SECS);
    await p.screenshot({ path: 'shots/stress_' + v + (OFF ? '_off' : '') + '.png' });
    console.log(v + (OFF ? ' (off)' : ''), 'fps', r.fps.toFixed(1), 'worst ms', r.worst.toFixed(1), 'draw calls', r.calls.toFixed(0), 'tris', (r.tris / 1e6).toFixed(2) + 'M',
      'render() cpu ms', r.cpuRender.toFixed(2), 'planes', r.planes, '\n   cpu ms/frame:', r.prof, r.inst ? 'inst ' + JSON.stringify(r.inst) : '');
  }
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
