// GPU cost probe (perf6): the render's real cost per frame, and what each part of the scene adds to it. Headless shell
// with the real GPU (ANGLE Metal). After the scenario is set up the page's own loop is held (no sim steps), and the frame
// is rendered K times in a row (WW.post.render, then a 1-pixel readPixels: the GPU must have finished): ms per render =
// CPU + GPU of the render alone, GPU-bound when the GPU is the bottleneck. Then the same with one part off at a time
// (hidden, or the pass skipped), so each line is what that part costs. Usage:
//   BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/gpu_probe.js [std|busy|night|lagoon] [seed=1] [ff=150] [--dpr 2] [--k 30] [--w 1600 --h 900]
//   lagoon: std, then the camera low (4 u) over the shallows beside an island looking along the shore.
//   night: TOD=night forced (daylight.js) at ff.
const { chromium } = require('playwright');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const MODE = pos[0] || 'std', SEED = +(pos[1] || 1), FF = +(pos[2] || 150), K = +opt('k', 30);
(async () => {
  // --chrome: the installed Google Chrome in its new headless mode (the user's own browser build), else the headless shell
  const b = await chromium.launch(Object.assign(args.includes('--chrome') ? { channel: 'chrome', headless: true } : { executablePath: process.env.CHROMIUM || undefined }, { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }));
  const p = await b.newPage({ viewport: { width: +opt('w', 1600), height: +opt('h', 900) }, deviceScaleFactor: +opt('dpr', 2) });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&cam=forecast&fullres&v=' + Date.now(), { timeout: 240000 });
  await p.waitForTimeout(4000);
  const info = await p.evaluate(([MODE, SEED, FF]) => {
    const G = WW.game;
    const seeded = sd => { if (WW.aces) WW.aces.reset(); WW.terrain.generate(sd); WW.seedRandom(sd); G.seed = sd; WW.time.now = 0; G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true }); };
    const airborne = () => WW.world.planes.filter(q => q.alive && !q.removed && q.y > 3).length;
    let seed = SEED;
    if (MODE === 'night' && WW.dayNight) WW.dayNight.force = 'night';
    if (MODE === 'busy') {
      const hasCv = () => ['USN', 'IJN'].every(n => WW.world.ships.some(s => s.alive && s.nation === n && s.type === 'carrier' && !s.isBase));
      for (let k = 0; k < 40; k++) { seeded(SEED + k); if (hasCv()) { seed = SEED + k; break; } }
      __sim.fastForward(FF);
      for (let t = FF; t < FF + 300 && airborne() < 30 && G.state === 'battle'; t += 30) __sim.fastForward(30);
    } else { seeded(SEED); __sim.fastForward(FF); }
    return { seed, t: G.roundTime, state: G.state, airborne: airborne(), daylight: WW.daylight };
  }, [MODE, SEED, FF]);
  await p.waitForTimeout(3000);   // the director settles on a shot; shaders warm
  if (MODE === 'lagoon') await p.evaluate(() => {   // a low shot over the shallows beside the island nearest the fleet
    const s = WW.world.ships.find(q => q.alive) || { x: WW.cfg.MAP_W / 2, z: WW.cfg.MAP_H / 2 };
    let best = null;
    for (let r = 20; r < 1500 && !best; r += 20) for (let a = 0; a < 6.283; a += 0.1) {
      const x = s.x + r * Math.cos(a), z = s.z + r * Math.sin(a), d = WW.terrain.depthAt(x, z);
      if (d > 0.3 && d < 2) { best = { x, z, a }; break; }
    }
    WW.__lag = best;
  });
  // hold the page's loop: frames do nothing while measuring (the camera stays where the director left it)
  const res = await p.evaluate(([MODE, K]) => {
    const R = WW.renderer, gl = R.getContext(), S = WW.scene, C = WW.camera, px = new Uint8Array(4);
    if (MODE === 'lagoon' && WW.__lag) { const L = WW.__lag; C.position.set(L.x, 4, L.z); C.lookAt(L.x + 60 * Math.cos(L.a + 1.2), 2, L.z + 60 * Math.sin(L.a + 1.2)); C.updateMatrixWorld(); }
    const camSave = C.matrixWorld.clone();
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (k = K) => {
      for (let i = 0; i < 3; i++) WW.post.render(S, C); sync();
      const t = performance.now();
      for (let i = 0; i < k; i++) { WW.post.render(S, C); R.shadowMap.needsUpdate = true; }
      sync(); return (performance.now() - t) / k;
    };
    const info = R.info; info.autoReset = false; info.reset(); WW.post.render(S, C); const calls = info.render.calls, tris = info.render.triangles; info.autoReset = true;
    const out = { size: R.getDrawingBufferSize(new THREE.Vector2()).toArray(), calls, tris, rows: [] };
    const base = []; for (let i = 0; i < 3; i++) base.push(time());
    out.base = Math.min(...base);
    const toggles = [];
    // categories of scene objects (hidden for one measurement)
    const all = []; S.traverse(o => { if (o.material) all.push(o); });
    const isSea = o => o.material.uniforms && o.material.uniforms.uSeaT && o.geometry.attributes.aSp;
    const cat = {
      sea: o => isSea(o),
      'shadow catcher': o => o.material.isShadowMaterial,
      'sea riders (ride() mats, not sea)': o => !isSea(o) && o.material.uniforms === undefined && o.material.userData && o.material.userData.seaRide,
      'transparent (fx, smoke, flak, foam)': o => !isSea(o) && !o.material.isShadowMaterial && o.material.transparent,
      'instanced opaque': o => o.isInstancedMesh && !o.material.transparent,
      'sprites/points': o => o.isSprite || o.isPoints,
    };
    for (const [k, f] of Object.entries(cat)) toggles.push([k, () => { const hid = all.filter(o => { try { return o.visible && f(o); } catch (e) { return false; } }); hid.forEach(o => o.visible = false); return () => hid.forEach(o => o.visible = true); }]);
    toggles.push(['shadow map pass', () => { const a = R.shadowMap.enabled; R.shadowMap.autoUpdate = false; const n = R.shadowMap.needsUpdate; const f = R.shadowMap.render; R.shadowMap.render = () => {}; return () => { R.shadowMap.render = f; R.shadowMap.autoUpdate = true; }; }]);
    toggles.push(['post (bloom + grade)', () => { WW.post.toggle(); return () => WW.post.toggle(); }]);
    // the scene's top-level children by name (the biggest groups)
    const groups = new Map(); for (const c of S.children) { const n = c.name || c.type; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(c); }
    for (const [n, list] of groups) toggles.push(['top: ' + n + ' x' + list.length, () => { const v = list.filter(o => o.visible); v.forEach(o => o.visible = false); return () => v.forEach(o => o.visible = true); }]);
    for (const [k, f] of toggles) {
      const undo = f(); const t = Math.min(time(), time()); undo();
      out.rows.push([k, t]);
    }
    // the sea's fragment shader by part (water.js / sea_state.js): a copy of its material with one part cut out
    const seaO = all.find(isSea);
    if (seaO) {
      const m0 = seaO.material, fs = m0.fragmentShader;
      const cut = (name, f) => { const m = m0.clone(); m.uniforms = m0.uniforms; m.fragmentShader = f(fs); if (m.fragmentShader === fs) return; m.needsUpdate = true; seaO.material = m; time(5); out.rows.push(['sea part: ' + name, Math.min(time(), time())]); seaO.material = m0; m.dispose(); };
      cut('seaDetail (short chop)', f => f.replace(/sg\.yz \+= seaDetail\([^;]*;/, ''));
      cut('seaGradW (wave set per pixel)', f => f.replace(/vec3 sg = seaGradW\([^;]*;/, 'vec3 sg = vec3(0.0);'));
      cut('both waves per pixel', f => f.replace(/sg\.yz \+= seaDetail\([^;]*;/, '').replace(/vec3 sg = seaGradW\([^;]*;/, 'vec3 sg = vec3(0.0);'));
      cut('whole fragment shader (flat colour)', () => 'void main() { gl_FragColor = vec4(0.2, 0.4, 0.6, 1.0); }');
    }
    if (WW.shaderWarm) { // the 2 s sweep for objects not warmed yet (shader_warm.js): its CPU cost when it finds nothing new
      const one = () => { sync(); const t = performance.now(); WW.post.render(S, C); sync(); return performance.now() - t; };
      const plain = [], swept = [];
      for (let i = 0; i < 5; i++) { plain.push(one()); WW.shaderWarm.warmNow(); swept.push(one()); }
      out.sweep = Math.min(...swept) - Math.min(...plain);
    }
    out.base2 = Math.min(time(), time());
    // the pixel count's share: dpr 1
    const dpr = R.getPixelRatio(); R.setPixelRatio(1); WW.post.resize(); out.dpr1 = Math.min(time(), time());
    // one switch of the render scale (main.js dynSet: the drawing buffer and post.js's targets reallocated): its frame
    sync(); let t = performance.now(); R.setPixelRatio(dpr * 0.85); WW.post.resize(); WW.post.render(S, C); sync(); out.switch1 = performance.now() - t;
    sync(); t = performance.now(); R.setPixelRatio(dpr); WW.post.resize(); WW.post.render(S, C); sync(); out.switch2 = performance.now() - t;
    return out;
  }, [MODE, K]);
  const base = Math.min(res.base, res.base2);
  console.log(`${MODE} ${JSON.stringify(info)} buffer ${res.size.join('x')} draw calls ${res.calls}, tris ${(res.tris / 1000).toFixed(0)}k`);
  console.log(`render (CPU+GPU, readPixels sync): ${res.base.toFixed(2)} / ${res.base2.toFixed(2)} ms   dpr 1: ${res.dpr1.toFixed(2)} ms`);
  console.log(`a render-scale switch: its frame ${res.switch1.toFixed(1)} / ${res.switch2.toFixed(1)} ms (down / up)`);
  if (res.sweep !== undefined) console.log(`shaderWarm sweep adds ${res.sweep.toFixed(2)} ms to the frame it runs in (every 2 s)`);
  for (const [k, t] of res.rows.filter(r => base - r[1] > 0.15 || !r[0].startsWith('top:')).sort((a, b2) => a[1] - b2[1])) console.log(`  without ${k.padEnd(44)} ${t.toFixed(2)} ms  (saves ${(base - t).toFixed(2)})`);
  if (opt('shot')) await p.screenshot({ path: opt('shot') });
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
