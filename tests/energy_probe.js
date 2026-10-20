// Energy probe (power): the work per REAL second of a scene at 1x, not per frame: main-thread busy ms/s (CDP
// Performance TaskDuration / ScriptDuration), the look-ahead worker's ms/s (lookahead.js busyMs), the GPU ms/s (an
// EXT_disjoint_timer_query_webgl2 query around every WW.post.render when the driver has it; else the render timed in a
// held loop with a readPixels sync, gpu_probe-style, x frames drawn), frames drawn/s, and the CPU % of each Chrome
// process (renderer, GPU process, browser, utility) from `ps` cumulative CPU time over the same window. The browser runs
// headless (installed Chrome with --chrome, else CHROMIUM / the headless shell) on the real GPU (ANGLE Metal).
//   BASE_URL=http://localhost:PORT/ node tests/energy_probe.js <scene> [--secs 10] [--chrome] [--dpr 2] [--w 1600 --h 900] [--seed 1] [--q extra&params] [--json out.json]
//   scenes: setup (the ready screen, idle) | quiet (an auto round early in the approach) | busy (a carrier battle, 30+
//   planes up) | night (a forced night round, fires) | victory (the end screen) | hidden (busy, then the tab hidden: rAF
//   held as a browser does, document.hidden true, visibilitychange fired)
// GPU: the held-loop render ms x frames drawn/s (see below); the timer-query numbers are kept as gpuTimer*.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const SCENE = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || 'busy';
const SECS = +opt('secs', 10), SEED = +opt('seed', 1);
function procTimes(dir) {   // cumulative CPU s of the Chrome tree whose browser process uses this profile dir
  const rows = execSync('ps -A -o pid=,ppid=,time=,command=', { maxBuffer: 64 << 20 }).toString().split('\n').filter(Boolean).map(l => {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(l); if (!m) return null;
    const t = m[3].split(':').map(Number); let s = 0; for (const x of t) s = s * 60 + x;
    return { pid: +m[1], ppid: +m[2], s, cmd: m[4] };
  }).filter(Boolean);
  const root = rows.find(r => r.cmd.includes('--user-data-dir=' + dir) && !/--type=/.test(r.cmd));
  if (!root) return null;
  const out = { renderer: 0, gpu: 0, browser: root.s, utility: 0, other: 0 }, kids = new Set([root.pid]);
  let grew = true; while (grew) { grew = false; for (const r of rows) if (!kids.has(r.pid) && kids.has(r.ppid)) { kids.add(r.pid); grew = true; } }
  for (const r of rows) if (r.pid !== root.pid && kids.has(r.pid)) {
    const k = /--type=renderer/.test(r.cmd) ? 'renderer' : /--type=gpu-process/.test(r.cmd) ? 'gpu' : /--type=utility/.test(r.cmd) ? 'utility' : 'other';
    out[k] += r.s;
  }
  return out;
}
(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.ENERGY_TMP || os.tmpdir(), 'energy-'));
  const ctx = await chromium.launchPersistentContext(dir, Object.assign(args.includes('--chrome') ? { channel: 'chrome' } : { executablePath: process.env.CHROMIUM || undefined },
    { headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], viewport: { width: +opt('w', 1600), height: +opt('h', 900) }, deviceScaleFactor: +opt('dpr', 2) }));
  const p = ctx.pages()[0] || await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let H = false, held = [];
    window.__rafT = { ms: 0, n: 0 };
    window.requestAnimationFrame = cb => { if (H) { held.push(cb); return 0; } return raf(t => { const s = performance.now(); cb(t); window.__rafT.ms += performance.now() - s; window.__rafT.n++; }); };
    const hid = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'), vs = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'hidden', { get() { return H || hid.get.call(this); }, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get() { return H ? 'hidden' : vs.get.call(this); }, configurable: true });
    window.__fakeHide = on => { H = !!on; document.dispatchEvent(new Event('visibilitychange')); if (!H) { const h = held; held = []; h.forEach(cb => window.requestAnimationFrame(cb)); } };
  });
  const q = (SCENE === 'setup' ? '' : 'auto') + (opt('q') ? '&' + opt('q') : '');
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?' + q + '&v=' + Date.now(), { timeout: 240000 });
  await p.waitForTimeout(5000);
  const info = await p.evaluate(async ([SCENE, SEED]) => {
    const G = WW.game; WW.time.scale = 1;
    const ffw = x => (WW.lookahead && WW.lookahead.on ? __sim.stepFixed(Math.round(x / __sim.LIVE_STEP)) : __sim.fastForward(x));
    const seeded = sd => { if (WW.aces) WW.aces.reset(); WW.terrain.generate(sd); WW.seedRandom(sd); G.seed = sd; WW.time.now = 0; G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true }); };
    const airborne = () => WW.world.planes.filter(q => q.alive && !q.removed && q.y > 3).length;
    let seed = SEED;
    if (SCENE === 'setup') return { state: G.state, ships: WW.world.ships.length };
    if (SCENE === 'busy' || SCENE === 'hidden') {
      const hasCv = () => ['USN', 'IJN'].every(n => WW.world.ships.some(s => s.alive && s.nation === n && s.type === 'carrier' && !s.isBase));
      for (let k = 0; k < 40; k++) { seeded(SEED + k); if (hasCv()) { seed = SEED + k; break; } }
      ffw(150);
      for (let t = 150; t < 450 && airborne() < 30 && G.state === 'battle'; t += 30) ffw(30);
    } else if (SCENE === 'night') { if (WW.dayNight) WW.dayNight.force = 'night'; seeded(SEED); ffw(220); }
    else if (SCENE === 'quiet') { seeded(SEED); ffw(8); }
    else if (SCENE === 'victory') { seeded(SEED); ffw(150); }
    if (WW.lookahead && WW.lookahead.on) await WW.lookahead.waitAhead(85, 90000);
    if (SCENE === 'victory') { if (WW.lookahead) WW.lookahead.desync('probe'); G.endRound('USN', 'kill'); }   // (the copy stops at its own end)
    return { seed, t: +G.roundTime.toFixed(1), state: G.state, ships: WW.world.ships.filter(s => s.alive).length, airborne: airborne(),  kind: WW.dayNight && WW.dayNight.kind };
  }, [SCENE, SEED]);
  await p.waitForTimeout(3000);   // the director settles; shaders warm
  // GPU timer queries around each render (the real per-frame GPU time, async results)
  const gpuMode = await p.evaluate(() => {
    const gl = WW.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const G = window.__gpuT = { ns: 0, n: 0, lost: 0, on: false };
    if (!ext) return 'none';
    const pend = [], pr = WW.post.render;
    WW.post.render = function () {
      for (let i = pend.length - 1; i >= 0; i--) {
        const qq = pend[i];
        if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && G.on) { G.ns += gl.getQueryParameter(qq, gl.QUERY_RESULT); G.n++; } gl.deleteQuery(qq); pend.splice(i, 1); }
      }
      const qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq);
      try { return pr.apply(this, arguments); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push(qq); }
    };
    return 'timer';
  });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const met = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of metrics) o[m.name] = m.value; return o; };
  const snap = () => p.evaluate(() => ({ t: performance.now(), drawn: WW.frames.drawn, raf: window.__rafT.n, rafMs: window.__rafT.ms, la: (WW.lookahead && WW.lookahead.busyMs) || 0, gns: window.__gpuT.ns, gn: window.__gpuT.n, steps: WW.game.stepN || 0, bg: WW.bgTick ? WW.bgTick.ms : 0 }));
  if (SCENE === 'hidden') { await p.evaluate(() => window.__fakeHide(true)); await p.waitForTimeout(2000); }
  await p.evaluate(() => { window.__gpuT.on = true; });
  const s0 = await snap(), m0 = await met(), c0 = procTimes(dir), w0 = Date.now();
  await p.waitForTimeout(SECS * 1000);
  const s1 = await snap(), m1 = await met(), c1 = procTimes(dir), wall = (Date.now() - w0) / 1000;
  const sec = (s1.t - s0.t) / 1000, fps = (s1.drawn - s0.drawn) / sec;
  let gpuMsS = null, gpuPerFrame = null;
  if (gpuMode === 'timer' && s1.gn > s0.gn) { gpuPerFrame = (s1.gns - s0.gns) / (s1.gn - s0.gn) / 1e6; gpuMsS = gpuPerFrame * fps; }
  const cpu = {}; if (c0 && c1) for (const k in c1) cpu[k] = +(100 * (c1[k] - c0[k]) / wall).toFixed(1);
  const out = {
    scene: SCENE, info, secs: +sec.toFixed(1), fps: +fps.toFixed(1), rafPerS: +((s1.raf - s0.raf) / sec).toFixed(1),
    mainTaskMsS: +((m1.TaskDuration - m0.TaskDuration) * 1000 / sec).toFixed(1), mainScriptMsS: +((m1.ScriptDuration - m0.ScriptDuration) * 1000 / sec).toFixed(1),
    rafCbMsS: +((s1.rafMs - s0.rafMs) / sec).toFixed(1), bgMsS: +((s1.bg - s0.bg) / sec).toFixed(1), workerMsS: +((s1.la - s0.la) / sec).toFixed(1),
    gpuMsS: gpuMsS === null ? null : +gpuMsS.toFixed(1), gpuMsFrame: gpuPerFrame === null ? null : +gpuPerFrame.toFixed(2), gpuMode,
    load: require('os').loadavg()[0].toFixed(1),
    stepsPerS: +((s1.steps - s0.steps) / sec).toFixed(1), cpuPct: cpu,
    buf: await p.evaluate(() => WW.renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()), dyn: await p.evaluate(() => WW.view && WW.view.dyn ? WW.view.dyn().scale : null)
  };
  // the render's own work: timed in a held loop (CPU + GPU, a readPixels sync; gpu_probe-style, the loop stopped, the
  // camera where the director left it), x frames drawn. The live timer queries (gpuTimer*) run at whatever clock the GPU
  // idles at between frames and share the GPU with every other process: they hardly move with the work done (a 0.75
  // render scale: 10.0 -> 9.9 ms); this does (5.0 -> 3.2 ms).
  out.gpuTimerMsS = out.gpuMsS; out.gpuTimerMsFrame = out.gpuMsFrame;
  if (SCENE !== 'hidden') {
    const ms = await p.evaluate(() => new Promise(res => { window.requestAnimationFrame = () => 0; setTimeout(() => {
      const R = WW.renderer, gl = R.getContext(), px = new Uint8Array(4), S = WW.scene, C = WW.camera; const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const run = () => { for (let i = 0; i < 3; i++) WW.post.render(S, C); sync(); const t = performance.now(); for (let i = 0; i < 20; i++) WW.post.render(S, C); sync(); return (performance.now() - t) / 20; };
      res(Math.min(run(), run())); }, 200); }));
    out.gpuMsFrame = +ms.toFixed(2); out.gpuMsS = +(ms * fps).toFixed(1); out.gpuMode = 'held-loop';
  } else { out.gpuMsFrame = 0; out.gpuMsS = 0; }
  console.log(JSON.stringify(out));
  if (opt('json')) fs.appendFileSync(opt('json'), JSON.stringify(Object.assign({ url: process.env.BASE_URL, label: opt('label', '') }, out)) + '\n');
  if (errs.length) console.log('errors', errs.slice(0, 5));
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
})();
