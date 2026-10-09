// White-column hunt (render mode, software GL): plays real rounds with the director camera and, every few rendered
// frames, (a) reads the frame back and looks for tall thin bright vertical structures, (b) walks the visible scene for
// non-finite or degenerate transforms (object matrices, instance matrices, dynamic vertex buffers) and very long
// line / trail segments. Suspicious frames are saved as PNG (tests/shots/white/). Diagnostic tool, not a gate.
// Usage: BASE_URL=http://localhost:PORT/ node tests/white_scan.js [seeds=1,2,3] [secondsPerRound=60] [tods=day,dawn,dusk]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'white'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const SEEDS = (process.argv[2] || '1,2,3').split(',').map(Number), SECS = +(process.argv[3] || 60);
const TODS = (process.argv[4] || 'day').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: process.env.SW ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }); // the Mac's GPU (60 fps); SW=1: software GL
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.evaluate(k => { window.__sheetK = k; }, +(process.env.SHEET || 0));
  await p.evaluate(() => {
    const S = window.__scan = { frames: 0, cols: [], bad: [], shots: [], tag: '' };
    const gl = WW.renderer.getContext(), M = new THREE.Matrix4(), V = new THREE.Vector3();
    let buf = null;
    const fin = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
    const name = o => { const n = []; for (let q = o; q && n.length < 4; q = q.parent) n.push(q.name || q.type); const g = o.geometry, pa = g && g.attributes.position;
      return n.join('<') + ' [' + (o.material && o.material.type) + ' v' + (pa ? pa.count : 0) + ' ro' + o.renderOrder + ']'; };
    const sc = e => [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
    const seen = new WeakMap(); // attribute -> version checked
    S.badN = {};
    function bad(kind, o, extra) { const k = S.tag + ' ' + kind + ' ' + name(o); S.badN[k] = (S.badN[k] || 0) + 1; if (S.badN[k] <= 3) S.bad.push({ t: S.tag, f: S.frames, rt: +WW.game.roundTime.toFixed(1), kind, obj: name(o), extra }); }
    function walk() {
      WW.scene.traverseVisible(o => {
        if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
        const e = o.matrixWorld.elements;
        if (!fin(e)) return bad('matrixNaN', o);
        const s = sc(e);
        if (Math.max(...s) > 3000) bad('hugeScale', o, s.map(v => +v.toFixed(1)));
        if (o.isInstancedMesh) {
          const a = o.instanceMatrix.array;
          for (let i = 0; i < o.count; i++) {
            const k = i * 16, m = a.subarray(k, k + 16);
            if (!fin(m)) { bad('instNaN', o, i); break; }
            const q = sc(m), mx = Math.max(...q), mn = Math.min(...q), y = m[13];
            if (mx > 400 || (mx > 25 && mx > 12 * mn) || Math.abs(y) > 2000) { bad('instOdd', o, { i, s: q.map(v => +v.toFixed(2)), p: [m[12], m[13], m[14]].map(v => +v.toFixed(1)) }); break; }
          }
        }
        const g = o.geometry, pa = g && g.attributes && g.attributes.position;
        if (pa && seen.get(pa) !== pa.version) {
          seen.set(pa, pa.version);
          const arr = pa.array, n = g.drawRange && Number.isFinite(g.drawRange.count) ? Math.min(pa.count, g.drawRange.start + g.drawRange.count) : pa.count;
          for (let i = 0; i < n * pa.itemSize && i < arr.length; i++) if (!Number.isFinite(arr[i])) { bad('vertNaN', o, i); break; }
          if (o.isLine || o.isMesh && pa.usage === THREE.DynamicDrawUsage) { // long segments in dynamic geometry (trails, ribbons)
            let worst = 0;
            const D = (i, j) => Math.hypot(arr[i * 3] - arr[j * 3], arr[i * 3 + 1] - arr[j * 3 + 1], arr[i * 3 + 2] - arr[j * 3 + 2]);
            if (g.index) { const ix = g.index.array; for (let t = 0; t + 2 < ix.length; t += 3) worst = Math.max(worst, D(ix[t], ix[t + 1]), D(ix[t + 1], ix[t + 2]), D(ix[t], ix[t + 2])); }
            else if (o.isLine) for (let i = 1; i < n; i += o.isLineSegments ? 2 : 1) worst = Math.max(worst, D(i, i - 1));
            if (worst > 150) bad('longSeg', o, +worst.toFixed(0));
          }
        }
      });
    }
    // tall thin flat pale runs in the frame (grey >= 150, unsaturated, flat: each pixel within 3 of the one below it)
    function pixels() {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      if (!buf || buf.length !== w * h * 4) buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const run = new Int32Array(w), end = new Int32Array(w);
      for (let x = 0; x < w; x++) {
        let r = 0, best = 0;
        for (let y = 0; y < h; y++) {
          const k = (y * w + x) * 4, a = buf[k], g2 = buf[k + 1], c = buf[k + 2], mn = Math.min(a, g2, c);
          const u = k - w * 4, flat = y > 0 && Math.abs(a - buf[u]) <= 3 && Math.abs(g2 - buf[u + 1]) <= 3 && Math.abs(c - buf[u + 2]) <= 3;
          if (mn >= 150 && Math.max(a, g2, c) - mn < 24 && (flat || r === 0)) { if (++r > best) { best = r; end[x] = y; } } else r = 0;
        }
        run[x] = best;
      }
      // groups of adjacent columns whose run is >= 15% of the height, narrower than 20% of the width, with hard
      // vertical edges: along most of the run the pixels 3 px outside the group differ from the inside (not haze or sky)
      const px = (x, y) => (y * w + x) * 4, diff = (i, j) => Math.abs(buf[i] - buf[j]) + Math.abs(buf[i + 1] - buf[j + 1]) + Math.abs(buf[i + 2] - buf[j + 2]);
      let hits = [];
      for (let x = 0; x < w;) {
        if (run[x] < h * 0.15) { x++; continue; }
        let x1 = x, mx = 0, bx = x; while (x1 < w && run[x1] >= h * 0.15) { if (run[x1] > mx) { mx = run[x1]; bx = x1; } x1++; }
        if (x1 - x < w * 0.2) {
          let edge = 0, n = 0;
          for (let y = end[bx] - mx + 1; y <= end[bx]; y += 2) {
            n++;
            const L = x - 3 >= 0 ? diff(px(x - 3, y), px(x, y)) > 40 : true, Rr = x1 + 2 < w ? diff(px(x1 + 2, y), px(x1 - 1, y)) > 40 : true;
            if (L && Rr) edge++;
          }
          if (edge > n * 0.7) hits.push({ x, wpx: x1 - x, run: mx, y0: h - 1 - end[bx] });
        }
        x = x1;
      }
      return hits;
    }
    // contact sheets: a 240 x 135 thumbnail every SHEET_K-th frame, 6 x 6 per sheet (env SHEET=K, 0 = off)
    const SK = window.__sheetK || 0, sheet = document.createElement('canvas'); sheet.width = 1440; sheet.height = 810;
    const sx = sheet.getContext('2d'); let slot = 0; S.sheets = [];
    function thumb() {
      const i = slot++ % 36; sx.drawImage(WW.renderer.domElement, (i % 6) * 240, (i / 6 | 0) * 135, 240, 135);
      sx.fillStyle = '#000'; sx.font = '10px monospace'; sx.fillText(S.tag + ' ' + WW.game.roundTime.toFixed(0) + ' f' + S.frames, (i % 6) * 240 + 2, (i / 6 | 0) * 135 + 10);
      if (i === 35) S.sheets.push({ name: S.tag + '_sheet' + (slot / 36 | 0), url: sheet.toDataURL('image/jpeg', 0.85) });
    }
    // which object draws a column: re-render (with post), bisecting the visible objects by hiding halves
    S.ids = 0; S.who = [];
    function score(hs) { // pale pixels inside the hit boxes (x range, whole height)
      if (orig) orig(WW.scene, WW.camera); else { WW.renderer.setRenderTarget(null); WW.renderer.render(WW.scene, WW.camera); }
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let n = 0;
      for (const q of hs) for (let x = q.x; x < q.x + q.wpx; x++) for (let y = 0; y < h; y++) {
        const k = (y * w + x) * 4, mn = Math.min(buf[k], buf[k + 1], buf[k + 2]);
        if (mn >= 140 && Math.max(buf[k], buf[k + 1], buf[k + 2]) - mn < 30) n++;
      }
      return n;
    }
    // NaN pixels in the HDR scene render (the post chain's input): the scene into a float target, read back
    let rtF = null, fbuf = null;
    function nanCount() {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      if (!rtF || rtF.width !== w) { rtF = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true }); fbuf = new Float32Array(w * h * 4); }
      WW.renderer.setRenderTarget(rtF); WW.renderer.render(WW.scene, WW.camera);
      WW.renderer.readRenderTargetPixels(rtF, 0, 0, w, h, fbuf); WW.renderer.setRenderTarget(null);
      let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let i = 0; i < w * h; i++) { const a = fbuf[i * 4], b = fbuf[i * 4 + 1], c = fbuf[i * 4 + 2];
        if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c))) { n++; const x = i % w, y = h - 1 - (i / w | 0); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
      return { n, box: n ? [x0, y0, x1, y1] : null };
    }
    function nanFind() {
      const all = nanCount(); if (!all.n) return { n: 0 };
      const objs = []; WW.scene.traverseVisible(o => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) objs.push(o); });
      const only = set => { objs.forEach(o => { o.visible = false; }); set.forEach(o => { o.visible = true; }); const r = nanCount(); objs.forEach(o => { o.visible = true; }); return r.n; };
      let cand = objs;
      while (cand.length > 1) { const a = cand.slice(0, cand.length >> 1), b = cand.slice(cand.length >> 1); cand = only(a) ? a : only(b) ? b : null; if (!cand) break; }
      if (!cand) return { n: all.n, box: all.box, note: 'needs several objects together' };
      const o = cand[0], e = o.matrixWorld.elements, m = o.material;
      return { n: all.n, box: all.box, obj: name(o), mat: m && (m.name || m.type), color: m && m.color && m.color.getHexString(), map: !!(m && m.map),
        pos: [e[12], e[13], e[14]].map(v => +v.toFixed(1)), scale: sc(e).map(v => +v.toFixed(2)), cnt: o.count, par: o.parent && (o.parent.name || o.parent.type),
        geo: o.geometry && o.geometry.type, cam: WW.camera.position.toArray().map(v => +v.toFixed(1)), dist: +WW.camera.position.distanceTo(new THREE.Vector3(e[12], e[13], e[14])).toFixed(1) };
    }
    function identify(hs) {
      S.nan = S.nan || []; S.nan.push(Object.assign({ t: S.tag, f: S.frames, rt: +WW.game.roundTime.toFixed(1) }, nanFind()));
      const objs = []; WW.scene.traverseVisible(o => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) objs.push(o); });
      const base = score(hs); if (base < 20) { S.who.push({ t: S.tag, f: S.frames, note: 'not in a re-render', base }); return; }
      // where does it come from: everything hidden / no post / no shadows
      objs.forEach(o => { o.visible = false; }); const none = score(hs); objs.forEach(o => { o.visible = true; });
      WW.renderer.setRenderTarget(null); WW.renderer.render(WW.scene, WW.camera); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let noPost = 0; for (const q of hs) for (let x = q.x; x < q.x + q.wpx; x++) for (let y = 0; y < h; y++) { const k = (y * w + x) * 4, mn = Math.min(buf[k], buf[k + 1], buf[k + 2]); if (mn >= 140 && Math.max(buf[k], buf[k + 1], buf[k + 2]) - mn < 30) noPost++; }
      const sm = WW.renderer.shadowMap.enabled; WW.renderer.shadowMap.enabled = false; const noShadow = score(hs); WW.renderer.shadowMap.enabled = sm;
      S.who.push({ t: S.tag, f: S.frames, base, none, noPost, noShadow, objs: objs.length });
      let cand = objs;
      while (cand.length > 1) {
        const half = cand.slice(0, cand.length >> 1);
        half.forEach(o => { o.visible = false; });
        const sc2 = score(hs);
        half.forEach(o => { o.visible = true; });
        cand = sc2 < base * 0.5 ? half : cand.slice(cand.length >> 1);
      }
      const o = cand[0]; o.visible = false; const after = score(hs); o.visible = true;
      const e = o.matrixWorld.elements;
      S.who.push({ t: S.tag, f: S.frames, rt: +WW.game.roundTime.toFixed(1), base, after, obj: name(o), mat: o.material && (o.material.name || o.material.type),
        color: o.material && o.material.color && o.material.color.getHexString(), pos: [e[12], e[13], e[14]].map(v => +v.toFixed(1)),
        scale: sc(e).map(v => +v.toFixed(2)), ud: Object.keys(o.userData || {}).slice(0, 6), cam: WW.camera.position.toArray().map(v => +v.toFixed(1)) });
    }
    const post = WW.post, orig = post ? post.render.bind(post) : null;
    const hook = () => {
      S.frames++;
      if (SK && S.frames % SK === 0) thumb();
      if (S.frames % 2) return;
      try { walk(); } catch (e) { bad('walkErr', WW.scene, String(e)); }
      const hits = pixels();
      if (hits.length) {
        S.cols.push({ t: S.tag, f: S.frames, rt: +WW.game.roundTime.toFixed(1), hits, cam: WW.camera.position.toArray().map(v => +v.toFixed(0)) });
        if (S.shots.length < 40) S.shots.push({ name: `${S.tag}_f${S.frames}`, url: WW.renderer.domElement.toDataURL('image/png') });
        if (S.ids < 12) { S.ids++; try { identify(hits); } catch (e) { S.idErr = String(e); } }
      }
    };
    if (post) post.render = (s, c) => { orig(s, c); hook(); };
    window.round = (seed, tod) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.dayNight.force = tod; WW.dayNight.pin = null; WW.dayNight.pinHour = null;
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    };
  });
  for (const tod of TODS) for (const seed of SEEDS) {
    await p.evaluate(([s, tod]) => { window.__scan.tag = tod + s; round(s, tod === 'dusk' ? 160 : tod); __sim.setScale(1); }, [seed, tod]);
    // early (fleets closing), then skip ahead into the air war and fleet action, watching a stretch at each point
    for (const ff of [0, 60, 90, 120, 150]) {
      await p.evaluate(ff => { if (ff) __sim.fastForward(ff); __sim.setScale(8); }, ff);
      await p.waitForTimeout(SECS * 1000 / 5);
    }
    const r = await p.evaluate(() => { const S = __scan, o = { frames: S.frames, cols: S.cols.length, bad: S.bad.length, shots: S.shots.concat(S.sheets) }; S.shots = []; S.sheets = []; return o; });
    for (const s of r.shots) fs.writeFileSync(path.join(OUT, s.name + (s.url.startsWith('data:image/jpeg') ? '.jpg' : '.png')), Buffer.from(s.url.split(',')[1], 'base64'));
    console.log(tod, seed, 'frames', r.frames, 'columnFrames', r.cols, 'badObjects', r.bad, 'saved', r.shots.length);
  }
  const S = await p.evaluate(() => ({ cols: __scan.cols, bad: __scan.bad, badN: __scan.badN, who: __scan.who, nan: __scan.nan, idErr: __scan.idErr }));
  fs.writeFileSync(path.join(OUT, 'scan.json'), JSON.stringify(S, null, 1));
  console.log('bad (frames) by round + kind:', S.badN);
  console.log('column frames:', S.cols.length, S.cols.slice(0, 10).map(c => c.t + '@' + c.rt + ' ' + JSON.stringify(c.hits)).join('\n'));
  console.log('NaN sources:\n' + (S.nan || []).map(x => JSON.stringify(x)).join('\n'), S.idErr || '');
  console.log('errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
