// Camera jitter probe (render mode, nothing drawn, a fake frame clock): films a fighter chase, a dive, a dogfight
// (over the shoulder) and a deck take-off and measures, frame by frame,
//   cam   the camera position's second difference (u per frame^2): RMS and 95th percentile
//   look  the view direction's second difference (mrad per frame^2)
//   scr   the subject's on-screen position second difference (px per frame^2 at 960 x 540): the visible judder
//   size  the subject's on-screen span (px, median): how much of the frame the plane fills
// Frames of a cut (the first 4 of a shot) are left out. Frame times: FRAME ms (default 16.67, 60 fps); UNEVEN=1
// alternates 13 / 20.3 ms (a browser's uneven frames: the sim's fixed 1/120 s steps then fall 1 or 2 to a frame).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/scale_jitter.js [shots=chase,dive,ots,takeoff] [secs=8] [seed=2] [query]
const { chromium } = require('playwright');
const WHICH = (process.argv[2] || 'chase,dive,ots,takeoff').split(','), SECS = +(process.argv[3] || 8), SEED = +(process.argv[4] || 2), Q = process.argv[5] || '';
const FRAME = +(process.env.FRAME || 1000 / 60), UNEVEN = !!+process.env.UNEVEN;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(([FRAME, UNEVEN]) => {
    window.__raf = []; window.__fakeT = 0; window.__fi = 0;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += UNEVEN ? (__fi++ % 2 ? 20.33 : 13) : FRAME; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  }, [FRAME, UNEVEN]);
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto' + (Q ? '&' + Q : ''), { timeout: 180000 });
  await p.waitForTimeout(1500);
  await p.evaluate((seed) => {
    WW.post.render = () => {};
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    WW.seedRandom(seed); WW.time.now = 0; WW.game.mode = 'auto'; WW.game.composition = null; WW.game.startRound();
    __sim.setScale(1);
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    window.__rec = [];
    const orig = WW.cam.afterRender, _v = new THREE.Vector3(), _w = new THREE.Vector3();
    WW.cam.afterRender = function () {
      orig.call(this);
      const c = WW.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion), s = WW.cam._shot(), q = window.__subj;
      let sx = null, sy = null, span = null;
      if (q && q.alive && !q.removed) {
        if (q.group) { q.group.updateMatrixWorld(true); q.group.getWorldPosition(_v); } else _v.set(q.x, q.y, q.z);   // the drawn position (what the eye sees)
        const d = _v.distanceTo(c.position); _v.project(c); sx = _v.x * 480; sy = -_v.y * 270;
        const k = WW.cfg.PLANE_SCALE * 2.94;   // the fighter model's span at this scale
        span = k / Math.max(1e-3, d) / Math.tan(c.fov * Math.PI / 360) * 270;
      }
      __rec.push({ id: s ? (s.__id || (s.__id = Math.random())) : 0, kind: s ? s.kind : '-', x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z, sx, sy, span, vis: sx !== null && Math.abs(sx) < 480 && Math.abs(sy) < 270 });
    };
  }, SEED);
  const scen = {
    chase: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.state === 'transit' && q.y > 10), 300);
      if (!q) return null; window.__subj = q; WW.cam.film({ kind: 'chase', subj: q, dur: 60 }); return 'fighter ' + q.nation + ' transit';
    },
    dive: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'dive' && !q.level && q.state === 'attack' && q.ordnance && q.target && q.hd(q.target) < 90), 900);
      if (!q) return null; window.__subj = q; WW.cam.film({ kind: 'chase', subj: q, dur: 60 }); return 'dive bomber ' + (q.phase || 'approach');
    },
    ots: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.state === 'attack' && q.foe && q.foe.alive && q.hd(q.foe) < 30), 500);
      if (!q) return null; window.__subj = q; WW.cam.film({ kind: 'ots', subj: q, dur: 60 }); return 'fighter vs ' + q.foe.kind;
    },
    takeoff: () => {
      const q = until(() => WW.world.planes.find(q => q.alive && q.state === 'takeoff' && q.carrier && !q.carrier.isBase && q.deckPh !== 'queued' && q.speed > 0.5), 400);
      if (!q) return null; window.__subj = q; WW.cam.film({ kind: 'chase', subj: q, dur: 60 }); return 'deck take-off ' + q.kind;
    }
  };
  const pct = (a, k) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * k))]; };
  const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
  const out = {};
  for (const name of WHICH) {
    const r = await p.evaluate(`(${scen[name].toString()})()`);
    if (!r) { console.log(`[${name}] none found`); continue; }
    await p.evaluate(() => { __rec.length = 0; });
    const n = Math.round(SECS * 1000 / FRAME);
    for (let i = 0; i < n; i += 30) await p.evaluate(k => __step(k), Math.min(30, n - i));
    const rec = await p.evaluate(() => __rec.slice());
    const cam = [], look = [], scr = [], span = [], first = {};
    let vis = 0;
    rec.forEach((f, i) => {
      if (first[f.id] === undefined) first[f.id] = i;
      if (f.vis) vis++;
      if (f.span) span.push(f.span);
      if (i - first[f.id] < 4) return;
      const a = rec[i - 2], c = rec[i - 1];
      cam.push(Math.hypot(f.x - 2 * c.x + a.x, f.y - 2 * c.y + a.y, f.z - 2 * c.z + a.z));
      look.push(1000 * Math.hypot(f.fx - 2 * c.fx + a.fx, f.fy - 2 * c.fy + a.fy, f.fz - 2 * c.fz + a.fz));
      if (f.sx !== null && a.sx !== null && c.sx !== null && f.vis) scr.push(Math.hypot(f.sx - 2 * c.sx + a.sx, f.sy - 2 * c.sy + a.sy));
    });
    const o = { what: r, frames: rec.length, onScreen: +(vis / Math.max(1, rec.length)).toFixed(2), spanPx: +pct(span, 0.5).toFixed(1),
      camRms: +rms(cam).toFixed(4), camP95: +pct(cam, 0.95).toFixed(4), lookRms: +rms(look).toFixed(3), lookP95: +pct(look, 0.95).toFixed(3),
      scrRms: +rms(scr).toFixed(2), scrP95: +pct(scr, 0.95).toFixed(2), scrMax: +pct(scr, 1).toFixed(2) };
    out[name] = o;
    console.log(`[${name}] ${r}: frames ${o.frames}, on screen ${o.onScreen}, span ${o.spanPx} px | cam d2 rms ${o.camRms} p95 ${o.camP95} u | look d2 rms ${o.lookRms} p95 ${o.lookP95} mrad | screen d2 rms ${o.scrRms} p95 ${o.scrP95} max ${o.scrMax} px`);
  }
  if (process.env.JSON) require('fs').writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));
  console.log('errors', errs.length, errs.slice(0, 3).join(' / '));
  await b.close();
})();
