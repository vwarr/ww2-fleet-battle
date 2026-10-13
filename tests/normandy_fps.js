// Normandy frame-cost probe (render mode, software GL): at the busiest time (H+40 to H+90: the beach crowded with men,
// craft and wrecks) it holds the camera on a few views and measures, per frame:
//   draw calls and triangles (renderer.info over the whole frame: the shadow map, the scene, the post passes),
//   the JS ms of each visual module's update (WW[mod].update wrapped: what main.js frame() calls by name),
//   the sim step ms (__sim / step: advance() is inside frame(), timed as the rest), the render ms (post.render with a
//   gl.finish(): on swiftshader this is the CPU's vertex and pixel work, so read the ratios, not the ms).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/normandy_fps.js [seed=1] [simT=200] [frames=12] [view,...]
// Views: wide (the director's wide shot of the bay, ~250 u off), beach (Easy Red's shingle from the surf), sea (the
// craft running in, from the line of departure), high (the whole beach from 400 u up)
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 1), SIMT = +(process.argv[3] || 200), FR = +(process.argv[4] || 12), ONLY = process.argv[5] || null;
const VIEWS = {
  wide: 'z => [1640, 45, z - 260, 1720, 2, z + 20]',
  beach: 'z => [1700, 3, z - 18, 1735, 1.5, z + 30]',
  sea: 'z => [1760, 8, z - 140, 1740, 0, z + 10]',
  high: 'z => [1700, 400, z - 300, 1700, 0, z + 20]'
};
const MODS = ['shipSwell', 'dmgVis', 'water', 'cam', 'crew', 'baseFx', 'normandyProps', 'waves', 'normandySky', 'normandyFleet', 'landingFx', 'infantryFx', 'beachheadFx', 'rocketBarrage', 'defenceFx', 'offmapAirFx', 'audio', 'sky', 'ui', 'fx'];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?scn=normandy&v=' + Date.now(), { timeout: 240000 });
  await p.waitForTimeout(3000);
  await p.evaluate(([seed, simT, MODS]) => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    WW.game.composition = null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    __sim.fastForward(simT); WW.time.scale = 0.0001;
    // the probe's instruments: per-module update ms, the render with a sync, renderer.info per frame
    const P = window.__fps = { mods: {}, frames: [] };
    for (const m of MODS) {
      const o = WW[m]; if (!o || typeof o.update !== 'function') continue;
      const f = o.update, k = m; P.mods[k] = 0;
      o.update = function () { const t = performance.now(); const r = f.apply(this, arguments); P.mods[k] += performance.now() - t; return r; };
    }
    const R = WW.renderer, gl = R.getContext(); R.info.autoReset = false;
    const pr = WW.post.render;
    WW.post.render = function () { const t = performance.now(); pr.apply(this, arguments); gl.finish(); P.render = (P.render || 0) + performance.now() - t; };
  }, [SEED, SIMT, MODS]);
  const out = {};
  for (const v in VIEWS) {
    if (ONLY && !ONLY.split(',').includes(v)) continue;
    const r = await p.evaluate(async ([src, FR]) => {
      const T = WW.normandyTerrain, z = T.shoreZ(1720), c = eval(src)(z);
      WW.cam.update = function () { WW.camera.position.set(c[0], c[1], c[2]); WW.camera.lookAt(c[3], c[4], c[5]); WW.camera.updateMatrixWorld(); };
      const P = window.__fps, R = WW.renderer;
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));   // settle: the LOD and the shadow box follow the view
      for (const k in P.mods) P.mods[k] = 0; P.render = 0;
      let calls = 0, tris = 0, n = 0, t0 = performance.now();
      await new Promise(res => { (function f() { R.info.reset(); requestAnimationFrame(() => { calls += R.info.render.calls; tris += R.info.render.triangles; if (++n < FR) f(); else res(); }); })(); });
      const ms = performance.now() - t0, mods = {}; let js = 0;
      for (const k in P.mods) { mods[k] = +(P.mods[k] / n).toFixed(2); js += P.mods[k] / n; }
      // what is on screen: instanced meshes by instances and triangles (the men, the craft)
      let inst = 0, itris = 0; const top = [];
      const path = o => { const n = []; for (let q = o; q && q !== WW.scene; q = q.parent) n.push(q.name || q.type); return n.reverse().join('/'); };
      WW.scene.traverse(o => { if (o.isMesh && o.visible) { const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3, c = o.isInstancedMesh ? o.count : 1; if (o.isInstancedMesh && o.count > 0) { inst += o.count; itris += o.count * t; } if (c * t > 50000) top.push([path(o) + (o.material && o.material.color ? '#' + o.material.color.getHexString() : ''), c, Math.round(t), Math.round(c * t), o.castShadow ? 'S' : '']); } });
      top.sort((a, b) => b[3] - a[3]);
      return { frameMs: +(ms / n).toFixed(1), renderMs: +(P.render / n).toFixed(1), visJsMs: +js.toFixed(2), calls: Math.round(calls / n), tris: Math.round(tris / n), instances: inst, instTris: Math.round(itris), mods, top: top.slice(0, 14) };
    }, [VIEWS[v], FR]);
    out[v] = r;
    console.log(v, JSON.stringify(r));
  }
  const live = await p.evaluate(() => ({ rt: +WW.game.roundTime.toFixed(0), squads: WW.infantry.squads.filter(q => q.alive).length, men: WW.infantry.squads.reduce((s, q) => s + (q.alive && q.kind !== 'tank' ? q.men : 0), 0), craft: WW.landingCraft.craft.filter(u => u.alive && !u.removed).length, wrecks: WW.landingFx.wrecks.length, wounded: WW.infantryFx.wounded.length }));
  console.log('state', JSON.stringify(live), 'errors', errs.length, errs.slice(0, 3));
  if (process.env.JSON) require('fs').writeFileSync(process.env.JSON, JSON.stringify({ out, live }, null, 1));
  await b.close();
})();
