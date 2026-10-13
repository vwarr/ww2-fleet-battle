// cut_freeze.js: frame-stall probe on a REAL GPU (headless, no visible window).
// Runs the director camera (?infinite) for MINUTES of real time at SCALE x and logs per frame: the gap between
// frames, the time inside WW.post.render / WW.cam.update / the sim modules, the GL time spent compiling / linking
// shaders and uploading textures / buffers, new shader programs (which material) and director cuts.
// Reports stalls (> 100 ms frame gaps) per minute, how many came at a cut, and what they were spent on.
//   BASE_URL=http://localhost:8139/ MINUTES=3 SCALE=2 SEED=1 OUT=/tmp/x.json node tests/cut_freeze.js
// Uses chrome-headless-shell with ANGLE Metal (env CHROMIUM = its path); prints the GL renderer string (it must
// not be SwiftShader).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:8139/';
const MINUTES = +(process.env.MINUTES || 3), SCALE = +(process.env.SCALE || 2), SEED = +(process.env.SEED || 1);
const STALL = +(process.env.STALL || 100);
(async () => {
  const opt = { headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-shader-disk-cache'] };
  if (process.env.CHANNEL) { opt.channel = process.env.CHANNEL; opt.args.push('--headless=new'); }   // e.g. CHANNEL=chrome: the user's browser, still no window
  else if (process.env.CHROMIUM) opt.executablePath = process.env.CHROMIUM;
  const b = await chromium.launch(opt);
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: +(process.env.DPR || 1) });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // a seeded Math.random, so a run replays the same rounds as near as real-time frames allow
  await p.addInitScript(seed => { let s = seed >>> 0 || 1; Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }, SEED);
  // COLD (default on): a per-run nonce in two shader chunks makes every built-in program's source unique, so the
  // system's Metal shader cache (shared by all runs on this Mac) can't hide compile costs: like a first sighting
  if (process.env.COLD !== '0') await p.route('**/vendor/three.min.js', async route => {
    const r = await route.fetch(); const n = Date.now() % 1e7;
    await route.fulfill({ response: r, body: (await r.text()) + `\n;(function(){var C=THREE.ShaderChunk;C.begin_vertex+='\\nif (position.x < -${n}.5e20) transformed.x += 1.0;';C.clipping_planes_fragment+='\\nif (gl_FragCoord.x < -${n}.5) discard;';})();` });
  });
  await p.goto(BASE + 'index.html?infinite&v=' + Date.now());
  await p.waitForFunction(() => window.WW && WW.renderer && WW.cam && WW.post && WW.game && WW.game.state === 'battle', null, { timeout: 60000 });
  const gpu = await p.evaluate(() => { const gl = WW.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
  console.log('GPU:', gpu);
  await p.evaluate(([scale, stall, selftest]) => {
    const R = WW.renderer, gl = R.getContext(), now = () => performance.now();
    const acc = {}; const add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
    // GL calls that can block: shader compile / link status reads, texture and buffer uploads
    const glWrap = { compileShader: 'glCompile', linkProgram: 'glLink', getProgramParameter: 'glProgParam', getShaderParameter: 'glShaderParam',
      getProgramInfoLog: 'glProgParam', getShaderInfoLog: 'glShaderParam', texImage2D: 'glTex', texSubImage2D: 'glTex', texImage3D: 'glTex', texStorage2D: 'glTex',
      bufferData: 'glBuf', bufferSubData: 'glBuf', readPixels: 'glRead' };
    for (const f in glWrap) { const o = gl[f]; if (!o) continue; const k = glWrap[f]; gl[f] = function () { const t = now(); try { return o.apply(gl, arguments); } finally { add(k, now() - t); } }; }
    const wrap = (obj, fn, k) => { const o = obj && obj[fn]; if (typeof o !== 'function') return; obj[fn] = function () { const t = now(); try { return o.apply(this, arguments); } finally { add(k, now() - t); } }; };
    wrap(WW.post, 'render', 'render'); wrap(WW.cam, 'update', 'cam'); wrap(WW.cam, 'afterRender', 'afterRender');
    ['ships', 'air', 'combat', 'islandBase', 'fleetCmd', 'intel', 'endgame', 'shipFires', 'charge', 'terrain', 'dayNight', 'weather', 'nightOps'].forEach(m => wrap(WW[m], 'update', 'sim'));
    ['fx', 'lifeboats'].forEach(m => wrap(WW[m], 'update', 'fxUpd'));
    ['water', 'crew', 'baseFx', 'audio', 'sky', 'ui'].forEach(m => wrap(WW[m], 'update', 'vis'));
    ['pose', 'draw', 'unpose'].forEach(f => wrap(WW.dmgVis, f, 'vis'));
    // which material each new program was built for (looked up after the frame, from the renderer's properties)
    const seen = new Set(R.info.programs.map(pr => pr.id));
    const progMat = pr => { let hit = null; WW.scene.traverse(o => { if (hit || !o.material) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { const pp = R.properties.get(m); if (pp && pp.currentProgram === pr) { const anc = []; for (let a = o.parent; a && a !== WW.scene && anc.length < 3; a = a.parent) anc.push(a.name || a.type); hit = (m.name || m.type) + (m.vertexColors ? '+vc' : '') + (m.map ? '+map' : '') + (m.transparent ? '+tr' : '') + '@' + (o.isInstancedMesh ? 'IM:' : '') + (o.name || o.type) + '<' + anc.join('<') + ' #' + (m.color ? m.color.getHexString() : '') + (m.clippingPlanes && m.clippingPlanes.length ? ' clip' + m.clippingPlanes.length : '') + (m.onBeforeCompile && m.onBeforeCompile.toString().length > 20 ? ' obc' : ''); return; } } }); return hit || pr.name; };
    const L = window.__cf = { frames: [], progs: [], cuts: 0, stalls: [], cutAt: [], t0: now(), compileMs: 0, ev: [], evN: {} };
    // big visual events: a stall soon after one is tagged with it
    ['shipBreak', 'magazine', 'deckHit', 'shipSunk', 'capsize', 'shipBoom', 'baseEvent', 'flyingBoat', 'roundStart'].forEach(k => WW.on(k, () => { L.ev.push([k, now()]); L.evN[k] = (L.evN[k] || 0) + 1; }));
    let lastT = 0, lastShot = WW.cam._shot(), lastFrameCut = -1;
    (function tick() {
      requestAnimationFrame(tick); const t = now();
      const gap = lastT ? t - lastT : 0; lastT = t;
      const shot = WW.cam._shot();
      const cut = shot !== lastShot; lastShot = shot;
      if (cut) { L.cuts++; lastFrameCut = L.frames.length; }
      const newP = [];
      for (const pr of R.info.programs) if (!seen.has(pr.id)) { seen.add(pr.id); newP.push(pr); }
      const fr = { gap: +gap.toFixed(1), cut: cut ? (shot ? shot.kind : 'none') : 0, np: newP.length };
      if (cut) L.cutAt.push(L.frames.length);
      L.compileMs += (acc.glCompile || 0) + (acc.glLink || 0) + (acc.glProgParam || 0) + (acc.glShaderParam || 0);
      for (const k in acc) { fr[k] = +acc[k].toFixed(1); acc[k] = 0; }
      L.frames.push(gap); // compact: all gaps; details for stalls only
      if (newP.length) { const names = newP.map(progMat); names.forEach(n => L.progs.push({ f: L.frames.length - 1, n, t: +((now() - L.t0) / 1000).toFixed(1) })); fr.progs = names; }
      if (gap > stall) { fr.i = L.frames.length - 1; fr.sinceCut = L.frames.length - 1 - lastFrameCut; fr.shot = shot ? shot.kind : null; fr.ts = +((now() - L.t0) / 1000).toFixed(1); const e = L.ev.filter(e => t - e[1] < 1500).map(e => e[0]); if (e.length) fr.ev = e; L.stalls.push(fr); }
      else if (newP.length && gap > 40) { fr.i = L.frames.length - 1; fr.minor = 1; L.stalls.push(fr); }
    })();
    if (selftest) setTimeout(() => { const t = now(); while (now() - t < 200); }, 3000); // self-check: one 200 ms stall
    __sim.setScale(scale);
  }, [SCALE, STALL, !!process.env.SELFTEST]);
  if (+process.env.FF) await p.evaluate(ff => __sim.fastForward(ff), +process.env.FF); // skip the approach (sim seconds)
  // CRIT=n: every n s of real time a ship (a different type each time) blows up from her magazine and breaks in two,
  // so every run sees the rare big events (fx_critical.js, ship_breakup.js) and the director's cut to them
  if (+process.env.CRIT) await p.evaluate(n => {
    const types = ['destroyer', 'cruiser', 'battleship', 'carrier', 'pt'];
    let k = 0;
    setInterval(() => {
      const B = WW.shipBreakup && WW.shipBreakup.P_BREAK; if (B) for (const c in B) for (const t in B[c]) B[c][t] = 1;
      if (B) Object.assign(B.magazine, { battleship: 1, carrier: 1, cruiser: 1, lc: 1, destroyer: 1, pt: 1 });
      for (let j = 0; j < types.length; j++) {
        const ty = types[(k + j) % types.length], s = WW.world.ships.find(s => s.alive && !s.removed && s.type === ty);
        if (!s) continue;
        k = (k + j + 1) % types.length;
        const w = s.toWorld(-s.stats.length * 0.15, 0);
        WW.emit('magazine', { ship: s, x: w[0], z: w[1], hx: w[0], hz: w[1], kind: 'shell' }); s.takeDamage(s.hp + 1, w[0], w[1], 'magazine');
        return;
      }
    }, n * 1000);
  }, +process.env.CRIT);
  const end = Date.now() + MINUTES * 60000;
  while (Date.now() < end) { await p.waitForTimeout(5000); }
  const r = await p.evaluate(() => { const L = __cf; return { frames: L.frames, stalls: L.stalls, progs: L.progs, cuts: L.cuts, cutAt: L.cutAt, compileMs: L.compileMs, evN: L.evN, secs: (performance.now() - L.t0) / 1000, programs: WW.renderer.info.programs.length, warm: WW.shaderWarm && WW.shaderWarm.stats, mem: WW.renderer.info.memory }; });
  const gaps = r.frames.slice(30); // skip the probe's first frames
  const big = gaps.filter(g => g > STALL).length, huge = gaps.filter(g => g > 250).length;
  const stallsAtCut = r.stalls.filter(s => !s.minor && s.sinceCut >= 0 && s.sinceCut <= 3).length;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sorted = gaps.slice().sort((a, b) => a - b), pct = q => sorted[Math.floor(q * (sorted.length - 1))];
  // stalls split by where the time went: shader compiles, the render otherwise (fill / GPU back-pressure), the sim, else
  // unattributed (another process, GC: on a busy machine)
  const real = r.stalls.filter(s => !s.minor && s.i >= 30), split = { compile: 0, render: 0, sim: 0, other: 0 };
  for (const s of real) { const c = (s.glProgParam || 0) + (s.glShaderParam || 0) + (s.glLink || 0) + (s.glCompile || 0); split[c > s.gap * 0.4 ? 'compile' : (s.render || 0) > s.gap * 0.4 ? 'render' : (s.sim || 0) + (s.fxUpd || 0) > s.gap * 0.4 ? 'sim' : 'other']++; }
  for (const k in split) split[k] = +(split[k] / (r.secs / 60)).toFixed(2);
  const near = new Set(); for (const c of r.cutAt) for (let k = c; k < c + 60; k++) near.add(k);
  let h = 0, hc = 0; r.frames.forEach((g, i) => { if (i >= 30 && g > 34) { h++; if (near.has(i)) hc++; } });
  const sum = { hitchPerMin: +(h / (r.secs / 60)).toFixed(1), hitchNearCutPerMin: +(hc / (r.secs / 60)).toFixed(1), split, gpu, secs: +r.secs.toFixed(0), frames: gaps.length, fps: +(1000 / mean).toFixed(1), p99: pct(0.99), max: sorted[sorted.length - 1],
    stallsPerMin: +(big / (r.secs / 60)).toFixed(2), over250PerMin: +(huge / (r.secs / 60)).toFixed(2), cuts: r.cuts, stallsAtCut, newPrograms: r.progs.length, compileMs: Math.round(r.compileMs), events: r.evN, programs: r.programs, warm: r.warm, mem: r.mem, errors: errs.slice(0, 5) };
  console.log(JSON.stringify(sum));
  for (const s of r.stalls.filter(s => !s.minor).slice(0, 60)) console.log('  stall', JSON.stringify(s));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ sum, stalls: r.stalls, progs: r.progs }, null, 1));
  await b.close();
})();
