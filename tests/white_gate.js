// Render-mode gate against NaN pixels and broken transforms (the "white column" bug: sky.js / water.js raised a
// value a hair below 0 to a power dead away from the sun; the NaN line in the HDR scene target was smeared by the
// bloom into a 10%-wide flat grey-white bar). Fails (exit 1) when:
//   - the scene, rendered into a float target, has any NaN / Inf pixel: looking dead away from the sun (a small yaw
//     sweep across the anti-sun azimuth, the exact trigger), toward the sun, and over director frames mid-battle;
//   - any visible object's world matrix, or any live InstancedMesh instance matrix, is not finite.
// GPU: runs on the Mac's GPU (ANGLE Metal), where pow() of a negative is NaN like on players' machines; with the bug
// put back it fails (16 NaN frames, a 1 px line dead away from the sun). SW=1 (SwiftShader) is BLIND to it: its
// pow() returns a number there (0 NaN frames with the bug back), so do not run this gate in software GL.
// Usage: BASE_URL=http://localhost:PORT/ node tests/white_gate.js [seed=5] [directorSeconds=12]
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 5), SECS = +(process.argv[3] || 12);
(async () => {
  const args = process.env.SW ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.evaluate(seed => {
    const S = window.__gate = { checks: 0, nanFrames: 0, nanPx: 0, worst: null, mats: [], view: null };
    const gl = WW.renderer.getContext(), fin = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
    const label = o => { const n = []; for (let q = o; q && n.length < 3; q = q.parent) n.push(q.name || q.type); const g = o.geometry;
      return n.join('<') + ' [' + (o.material && o.material.type) + ' ' + (g && g.type) + ' v' + (g && g.attributes.position ? g.attributes.position.count : 0) + ']'; };
    let rt = null, buf = null;
    S.check = what => { // NaN / Inf pixels in a float render of the scene (the post chain's input), then the transforms
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      if (!rt || rt.width !== w) { rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true }); buf = new Float32Array(w * h * 4); }
      WW.renderer.setRenderTarget(rt); WW.renderer.render(WW.scene, WW.camera);
      WW.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); WW.renderer.setRenderTarget(null);
      let n = 0, x0 = 1e9, x1 = -1;
      for (let i = 0; i < w * h; i++) if (!(Number.isFinite(buf[i * 4]) && Number.isFinite(buf[i * 4 + 1]) && Number.isFinite(buf[i * 4 + 2]))) { n++; x0 = Math.min(x0, i % w); x1 = Math.max(x1, i % w); }
      S.checks++;
      if (n) { S.nanFrames++; S.nanPx += n; if (!S.worst || n > S.worst.n) S.worst = { what, n, x: [x0, x1], t: +WW.game.roundTime.toFixed(1) }; }
      WW.scene.traverseVisible(o => {
        if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || S.mats.length >= 10) return;
        if (!fin(o.matrixWorld.elements)) return S.mats.push({ what, obj: label(o), kind: 'matrixWorld' });
        if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) if (!fin(o.instanceMatrix.array.subarray(i * 16, i * 16 + 16))) return S.mats.push({ what, obj: label(o), kind: 'instance ' + i + ' of ' + o.count });
      });
    };
    // the camera: the director, or a fixed view from (x, y, z) along yaw / pitch (the test sets __gate.view)
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const v = S.view; if (!v) return camUpd(rdt);
      WW.camera.position.set(v.x, v.y, v.z);
      WW.camera.lookAt(v.x + Math.cos(v.yaw) * Math.cos(v.pitch) * 100, v.y + Math.sin(v.pitch) * 100, v.z + Math.sin(v.yaw) * Math.cos(v.pitch) * 100);
      WW.camera.updateMatrixWorld();
    };
    const post = WW.post, orig = post.render.bind(post);
    S.every = 0; S.what = '';
    post.render = (s, c) => { orig(s, c); if (S.every && ++S.k % S.every === 0) S.check(S.what); };
    const G = WW.game; if (WW.aces) WW.aces.reset();
    WW.dayNight.force = 'day'; WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    __sim.fastForward(40); __sim.setScale(1);
  }, SEED);
  const frames = n => p.evaluate(n => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  // 1. dead away from the sun (and toward it): the sky dome's own sun direction; a yaw sweep of +-0.01 rad
  for (const [what, flip] of [['away from the sun', 0], ['toward the sun', 1]]) {
    for (let k = -10; k <= 10; k++) {
      await p.evaluate(([k, flip, what]) => {
        const d = WW.sky.parts().dome.material.uniforms.sunDir.value, yaw = Math.atan2(d.z, d.x) + (flip ? 0 : Math.PI) + k * 0.001;
        const c = WW.world.ships.find(s => s.alive) || { x: WW.cfg.MAP_W / 2, z: WW.cfg.MAP_H / 2 };
        __gate.view = { x: c.x, y: 30, z: c.z, yaw, pitch: k % 2 ? 0.05 : 0.3 }; __gate.what = what;
      }, [k, flip, what]);
      await frames(2);
      await p.evaluate(() => __gate.check(__gate.what));
    }
  }
  // 2. the director over the battle, checked every 6th frame
  await p.evaluate(() => { __gate.view = null; __gate.what = 'director'; __gate.k = 0; __gate.every = 6; __sim.setScale(4); });
  await p.waitForTimeout(SECS * 1000);
  const S = await p.evaluate(() => { __gate.every = 0; const g = __gate; return { checks: g.checks, nanFrames: g.nanFrames, nanPx: g.nanPx, worst: g.worst, mats: g.mats, t: WW.game.roundTime }; });
  await b.close();
  console.log(`white_gate (${process.env.SW ? 'SwiftShader' : 'GPU'}, seed ${SEED}, round t=${S.t.toFixed(0)} s): ${S.checks} frames checked, NaN-pixel frames ${S.nanFrames} (${S.nanPx} px), bad transforms ${S.mats.length}`);
  if (S.worst) console.log('  worst NaN frame:', JSON.stringify(S.worst));
  S.mats.forEach(m => console.log('  bad transform:', JSON.stringify(m)));
  if (errs.length) console.log('  page errors:', errs.slice(0, 3));
  const ok = !S.nanFrames && !S.mats.length && !errs.length;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
