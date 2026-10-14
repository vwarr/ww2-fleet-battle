// Frame-cost probe (render mode, the real GPU through ANGLE Metal in the headless shell; 60 Hz cap there): plays a
// round live for a few seconds and measures, per module, the JS ms that main.js step() / frame() spend in it
// (WW[mod].update / pose / unpose / draw wrapped in place: call() looks them up by name each time), the sim vs
// visual split (ms per DRAWN frame: main.js frame pacing skips some rAFs), the render (post.render + gl.finish), the whole rAF callback, and a V8 CPU profile over the same
// window (self time by function and by file). Usage:
//   BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/perf_probe.js [std|busy|normandy|setup] [seed=1] [ff=150] [secs=6] [--top N] [--dpr 2] [--json out.json]
//   std: a seeded auto round fast-forwarded ff sim s; busy: the first carrier-vs-carrier seed from `seed`, fast-
//   forwarded in 30 s steps until 30+ planes are airborne (or ff+300 s); normandy: ?scn=normandy at ff; setup: the
//   ready screen (fleets placed, waiting for Start). The camera is the game's own (director).
const { chromium } = require('playwright');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const MODE = pos[0] || 'std', SEED = +(pos[1] || 1), FF = +(pos[2] || 150), SECS = +(pos[3] || 6), TOP = +opt('top', 25);
const STEP_MODS = ['terrain', 'dayNight', 'weather', 'nightOps', 'intel', 'fleetCmd', 'ships', 'islandBase', 'coastDefence', 'landingCraft', 'infantry', 'offmapAir', 'endgame', 'shipFires', 'charge', 'air', 'combat', 'fx', 'lifeboats'];
const FRAME_MODS = ['shipSwell', 'dmgVis', 'water', 'cam', 'crew', 'baseFx', 'normandyProps', 'waves', 'normandySky', 'normandyFleet', 'landingFx', 'infantryFx', 'beachheadFx', 'vehicleFx', 'hocFx', 'rocketBarrage', 'defenceFx', 'offmapAirFx', 'audio', 'sky', 'ui'];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: +opt('dpr', 1) });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  // the whole rAF callback (the game's frame()) timed: wrapped before the page's scripts run
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__rafT = { ms: 0, n: 0, on: false };
    window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); cb(t); if (window.__rafT.on) { window.__rafT.ms += performance.now() - s; window.__rafT.n++; } });
  });
  // --cam lookahead: the look-ahead worker runs (js/lookahead.js); the fast-forward then uses the live fixed step
  // (__sim.stepFixed), so the worker's copy stays the same round, and the worker's own cost is reported at the end
  const CAM = opt('cam', '');
  const q = (MODE === 'normandy' ? 'scn=normandy' : MODE === 'setup' ? '' : 'auto') + (CAM ? '&cam=' + CAM : '');
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?' + q + '&v=' + Date.now(), { timeout: 240000 });
  await p.waitForTimeout(4000);
  const info = await p.evaluate(([MODE, SEED, FF]) => {
    const G = WW.game;
    const ffw = x => (WW.lookahead && WW.lookahead.on ? __sim.stepFixed(Math.round(x / __sim.LIVE_STEP)) : __sim.fastForward(x));
    const seeded = sd => { if (WW.aces) WW.aces.reset(); WW.terrain.generate(sd); WW.seedRandom(sd); G.seed = sd; WW.time.now = 0; G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true }); };
    const airborne = () => WW.world.planes.filter(q => q.alive && !q.removed && q.y > 3).length;
    let seed = SEED;
    if (MODE === 'setup') return { state: G.state, ships: WW.world.ships.length };
    if (MODE === 'busy') {
      const hasCv = () => ['USN', 'IJN'].every(n => WW.world.ships.some(s => s.alive && s.nation === n && s.type === 'carrier' && !s.isBase));
      for (let k = 0; k < 40; k++) { seeded(SEED + k); if (hasCv()) { seed = SEED + k; break; } }
      ffw(FF);
      for (let t = FF; t < FF + 300 && airborne() < 30 && G.state === 'battle'; t += 30) ffw(30);
    } else { seeded(SEED); ffw(FF); }
    return { seed, t: G.roundTime, state: G.state, ships: WW.world.ships.filter(s => s.alive).length, planes: WW.world.planes.filter(q => !q.removed).length, airborne: airborne() };
  }, [MODE, SEED, FF]);
  if (args.includes('--stopworker')) await p.evaluate(() => WW.lookahead && WW.lookahead.stop());   // the same scene without the worker (its main-thread cost)
  await p.waitForTimeout(1500); // the JIT and the GPU settle on the new scene
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await p.evaluate(([STEP_MODS, FRAME_MODS]) => {
    const P = window.__perf = { sim: {}, vis: {}, calls: {}, render: 0, after: 0, t0: performance.now(), steps: 0 };
    const wrap = (tab, m, fn) => {
      const o = WW[m]; if (!o || typeof o[fn] !== 'function' || o[fn].__probe) return;
      const f = o[fn], k = fn === 'update' ? m : m + '.' + fn; tab[k] = 0; P.calls[k] = 0;
      const w = function () { const t = performance.now(); const r = f.apply(this, arguments); tab[k] += performance.now() - t; P.calls[k]++; return r; };
      w.__probe = true; o[fn] = w;
    };
    for (const m of STEP_MODS) wrap(P.sim, m, 'update');
    for (const m of FRAME_MODS) for (const fn of ['update', 'pose', 'unpose', 'draw']) wrap(P.vis, m, fn);
    const ts = WW.terrain && WW.terrain.update; // count the sim steps (terrain.update is the first call of step())
    if (ts) { const w = WW.terrain.update; WW.terrain.update = function () { P.steps++; return w.apply(this, arguments); }; }
    if (WW.afterCamera) WW.afterCamera = WW.afterCamera.map(f => function (dt) { const t = performance.now(); f(dt); P.after += performance.now() - t; });
    const gl = WW.renderer.getContext(), pr = WW.post.render;
    const RI = WW.renderer.info; RI.autoReset = false; P.calls_gl = 0; P.tris = 0;
    WW.post.render = function () { RI.reset(); const t = performance.now(); pr.apply(this, arguments); gl.finish(); P.render += performance.now() - t; P.calls_gl += RI.render.calls; P.tris += RI.render.triangles; };
    window.__rafT.on = true; window.__rafT.ms = 0; window.__rafT.n = 0;
    P.d0 = WW.frames ? WW.frames.drawn : -1;
  }, [STEP_MODS, FRAME_MODS]);
  await cdp.send('Profiler.start');
  await p.waitForTimeout(SECS * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const r = await p.evaluate(() => { window.__rafT.on = false; const P = window.__perf; P.secs = (performance.now() - P.t0) / 1000; P.raf = window.__rafT.n; P.frames = P.d0 >= 0 ? WW.frames.drawn - P.d0 : P.raf; P.frameMs = window.__rafT.ms;
    P.info = WW.renderer.info.render; return P; });
  const F = r.frames || 1, fmt = v => (v / F).toFixed(3).padStart(8);
  console.log(`${MODE} ${JSON.stringify(info)}  frames drawn ${r.frames} (rAF ${r.raf}) in ${r.secs.toFixed(1)} s = ${(r.frames / r.secs).toFixed(1)} fps, steps/frame ${(r.steps / F).toFixed(2)}`);
  const simT = Object.values(r.sim).reduce((a, b) => a + b, 0), visT = Object.values(r.vis).reduce((a, b) => a + b, 0);
  console.log(`ms/frame: rAF callback ${fmt(r.frameMs)}  sim ${fmt(simT)}  visual modules ${fmt(visT)}  afterCamera ${fmt(r.after)}  render+finish ${fmt(r.render)}  (draw calls ${(r.calls_gl / F).toFixed(0)}, tris ${(r.tris / F / 1000).toFixed(0)}k per frame)`);
  const rows = [...Object.entries(r.sim).map(([k, v]) => ['sim', k, v]), ...Object.entries(r.vis).map(([k, v]) => ['vis', k, v])].filter(x => x[2] > 0).sort((a, b) => b[2] - a[2]);
  for (const [s, k, v] of rows) console.log(`${fmt(v)} ms/frame  ${s}  ${k}`);
  // CPU profile: self time
  const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map(), files = new Map(); let tot = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]), dt = profile.timeDeltas[i] || 0, cf = n.callFrame;
    const file = cf.url.split('/').pop().split('?')[0] || '(' + cf.functionName + ')';
    const k = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + dt); files.set(file, (files.get(file) || 0) + dt); tot += dt;
  }
  console.log('\nCPU self time by function (ms per frame)');
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${(v / 1000 / F).toFixed(3).padStart(8)} ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`);
  console.log('\nCPU self time by file (ms per frame)');
  for (const [k, v] of [...files].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${(v / 1000 / F).toFixed(3).padStart(8)} ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`);
  if (args.includes('--inst')) { // GPU uploads over 1 s: gl.bufferSubData bytes, grouped by the source array's length
    const rows = await p.evaluate(() => new Promise(res => {
      const gl = WW.renderer.getContext(), f = gl.bufferSubData, by = new Map(); let calls = 0;
      gl.bufferSubData = function (t, off, src, so, len) { const n = (len !== undefined ? len : src.length) * (src.BYTES_PER_ELEMENT || 1); const k = src.length; const e = by.get(k) || { n: 0, c: 0 }; e.n += n; e.c++; by.set(k, e); calls++; return f.apply(this, arguments); };
      const ims = []; WW.scene.traverse(o => { if (o.isInstancedMesh) ims.push(o); });
      setTimeout(() => { gl.bufferSubData = f; const out = [...by].map(([len, e]) => ({ len, kb: e.n / 1024, c: e.c, who: ims.filter(o => o.instanceMatrix.array.length === len || (o.instanceColor && o.instanceColor.array.length === len)).map(o => (o.name || (o.parent && o.parent.name) || '?') + ':' + o.count).slice(0, 4).join(' ') })).sort((a, b) => b.kb - a.kb); res({ out, calls }); }, 1000);
    }));
    console.log('\nbufferSubData over 1 s (array length, KB sent, calls, instanced meshes of that size: used count)');
    for (const r of rows.out.slice(0, 25)) console.log(`  len ${String(r.len).padStart(7)} ${r.kb.toFixed(0).padStart(7)} KB ${String(r.c).padStart(5)}x  ${r.who}`);
    console.log('  total', rows.out.reduce((a, r) => a + r.kb, 0).toFixed(0), 'KB/s in', rows.calls, 'calls');
  }
  if (opt('json')) require('fs').writeFileSync(opt('json'), JSON.stringify({ info, r, self: [...self], files: [...files] }));
  if (CAM) console.log('look-ahead worker:', JSON.stringify(await p.evaluate(() => { const L = WW.lookahead; return L ? { on: L.on, ready: L.ready, diverged: L.diverged, checks: L.checks, ahead: +((L.wn - WW.game.stepN) * __sim.LIVE_STEP).toFixed(1), busyMs: L.busyMs, simS: L.busySimS, msPerSimS: L.busySimS ? +(L.busyMs / L.busySimS).toFixed(2) : null, steady: L.steady } : null; })));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
