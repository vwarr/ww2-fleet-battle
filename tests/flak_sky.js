// Flak sky (combat_aa.js visuals): fps in the busiest raid, and the contact-sheet shots. Two carrier task groups
// facing each other (as tests/air_defense_shots.js); the round is fast-forwarded until a strike is over a carrier.
//   fps:   the real GPU (ANGLE Metal, headless shell, 60 Hz cap): the round plays live for SECS with the director's
//          camera, then SECS with a camera parked over the target group looking up into the flak (the worst case).
//          Prints fps, ms per rAF callback, render+finish ms, draw calls and the AA visual counts.
//   shots: software GL, fake frame clock: a strike arriving over a USN group, the middle of the raid, after the
//          raid, an IJN group under a USN strike, a close dive through the flak, a dusk raid. Writes
//          tests/shots/flak/*.png and a contact sheet tests/shots/flak/sheet.png (ImageMagick montage).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/flak_sky.js fps|shots [seed=3] [secs=6]
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const MODE = process.argv[2] || 'shots', SEED = +(process.argv[3] || 3), SECS = +(process.argv[4] || 6);
const OUT = path.join(__dirname, 'shots', 'flak');
const BASE = process.env.BASE_URL || 'http://localhost:8000/';

// page helpers (run in the page): the two-group round, the search for a strike over a carrier
function setup(seed, kind) {
  window.cvUnder = (nat, r) => WW.world.ships.find(s => s.alive && s.type === 'carrier' && !s.isBase && (!nat || s.nation === nat) &&
    WW.world.planes.filter(q => q.alive && q.nation !== s.nation && q.ordnance && Math.hypot(q.x - s.x, q.z - s.z) < r).length >= 3);
  const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  if (WW.aces) WW.aces.reset();
  WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
  const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 - 75 }, { type: 'carrier', nation: n, x, z: H / 2 + 75 }, { type: 'battleship', nation: n, x: x + s * 50, z: H / 2 },
    { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 90 }, { type: 'cruiser', nation: n, x: x + s * 40, z: H / 2 + 120 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 90 },
    { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 - 150 }, { type: 'destroyer', nation: n, x: x - s * 30, z: H / 2 }];
  WW.dayNight.force = kind || "day";
  G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)]; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
  WW.dayNight.force = null;
}

(async () => {
  const gpu = MODE === 'fps';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
    args: gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: gpu ? { width: 1600, height: 900 } : { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  if (gpu) {
    await p.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__rafT = { ms: 0, n: 0, on: false };
      window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); cb(t); if (window.__rafT.on) { window.__rafT.ms += performance.now() - s; window.__rafT.n++; } });
    });
  } else {
    await p.addInitScript(() => {
      window.__raf = []; window.__fakeT = 0; window.__render = true;
      window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
      window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
    });
  }
  await p.goto(BASE + 'index.html?auto&v=' + Date.now(), { timeout: 240000 });
  await p.waitForTimeout(gpu ? 4000 : 1500);
  const aa = () => p.evaluate(() => JSON.stringify(WW.combatAA._debug()));

  if (gpu) {
    const info = await p.evaluate(([seed, src]) => {
      new Function('return (' + src + ')')()(seed);
      const ff = x => (WW.lookahead && WW.lookahead.on ? __sim.stepFixed(Math.round(x / __sim.LIVE_STEP)) : __sim.fastForward(x));
      // the busiest flak: 5 s steps until the last 10 s held 60+ heavy bursts (seed 4: t ~ 170)
      const hist = [];
      for (let t = 0; t < 600; t += 5) {
        ff(5); hist.push(WW.combatAA._debug().bursts);
        if (hist.length > 2 && hist[hist.length - 1] - hist[hist.length - 3] >= 60) break;
      }
      ff(20);   // on into the raid: the sky fills
      const c = cvUnder(null, 160) || WW.world.ships.find(s => s.alive && s.type === 'carrier');
      window.__cv = c;
      return { t: WW.game.roundTime.toFixed(0), cv: c && c.nation, bursts10s: hist[hist.length - 1] - hist[hist.length - 3] };
    }, [SEED, setup.toString()]);
    console.log('raid', JSON.stringify(info), 'aa', await aa());
    const measure = async (tag) => {
      await p.waitForTimeout(1000);
      await p.evaluate(() => {
        const RI = WW.renderer.info, gl = WW.renderer.getContext(), pr = WW.post.render; RI.autoReset = false;
        window.__P = { render: 0, calls: 0, tris: 0, t0: performance.now(), d0: WW.frames ? WW.frames.drawn : 0 };
        if (!pr.__probe) { WW.post.render = function () { RI.reset(); const t = performance.now(); pr.apply(this, arguments); gl.finish(); __P.render += performance.now() - t; __P.calls += RI.render.calls; __P.tris += RI.render.triangles; }; WW.post.render.__probe = true; }
        __rafT.on = true; __rafT.ms = 0; __rafT.n = 0;
      });
      await p.waitForTimeout(SECS * 1000);
      const r = await p.evaluate(() => { __rafT.on = false; const P = __P, s = (performance.now() - P.t0) / 1000, f = (WW.frames ? WW.frames.drawn - P.d0 : __rafT.n) || 1;
        return { fps: (f / s).toFixed(1), rafMs: (__rafT.ms / __rafT.n).toFixed(2), renderMs: (P.render / f).toFixed(2), calls: Math.round(P.calls / f), ktris: Math.round(P.tris / f / 1000) }; });
      console.log(tag.padEnd(10), JSON.stringify(r), 'aa', await aa());
    };
    await measure('director');
    await p.evaluate(() => {
      const c = __cv, cu = WW.cam.update.bind(WW.cam);
      WW.cam.update = function () { WW.camera.position.set(c.x + 120, 30, c.z + 90); WW.camera.lookAt(c.x, 40, c.z); WW.camera.updateMatrixWorld(); };
    });
    await measure('over-group');
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
    await p.evaluate(([seed, src]) => {
      const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
      const t0 = performance.now(); performance.now = () => t0 + __fakeT;
      __step(5);
      const camUpd = WW.cam.update.bind(WW.cam);
      WW.cam.update = function (rdt) {
        if (!window.__lookFn) return camUpd(rdt);
        const L = __lookFn(); if (!L) return camUpd(rdt);
        WW.camera.position.set(L.x, Math.max(L.y, 1.5), L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
      };
      window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
      window.eye = (o, d, a, h, ty) => ({ x: o.x + Math.cos(a) * d, y: (o.y || 0) + h, z: o.z + Math.sin(a) * d, tx: o.x, ty: ty !== undefined ? ty : (o.y || 0), tz: o.z });
      new Function('return (' + src + ')')()(seed);
      __sim.setScale(1);
    }, [SEED, setup.toString()]);
    let n = 0; const files = [];
    const snap = async (tag) => {
      const info = await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
        const sp = document.querySelector('.panel.setup'); if (sp) sp.style.display = 'none';
        const cp = document.querySelector('.caption'); if (cp) cp.style.visibility = 'hidden'; return 't=' + WW.game.roundTime.toFixed(1) + ' ' + JSON.stringify(WW.combatAA._debug()); });
      const file = `${String(n++).padStart(2, '0')}_${tag}.png`;
      await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
      files.push(file); console.log('  shot tests/shots/flak/' + file + '  ' + info);
    };
    // look: a function of the subject (window.__subj) giving the camera; find: a predicate that sets the subject
    const look = (src) => p.evaluate(s => { const mk = new Function('return (' + s + ')')(); window.__lookFn = () => mk(window.__subj); }, src.toString());
    const find = (src, max) => p.evaluate(([s, m]) => { const f = new Function('return (' + s + ')')(); const q = until(f, m); if (q) window.__subj = q; return q ? (q.desc || '') + ' t ' + WW.game.roundTime.toFixed(0) : null; }, [src.toString(), max || 400]);
    const ff = (sec) => p.evaluate(s => { __render = false; __sim.fastForward(s); __step(2); }, sec);
    const wide = (s) => { const c = s.c; return eye(c, 230, c.heading + 2.4, 70, 45); };
    // 1-3: the USN group: the strike arriving, the middle of the raid, after it
    console.log('[usn arrive]', await find(() => { const c = cvUnder('USN', 220); return c ? { c, desc: 'USN carrier, strike inbound' } : null; }));
    await look(wide); await snap('usn_strike_arriving');
    console.log('[usn mid]', await find(() => { const c = cvUnder('USN', 90); return c ? { c, desc: 'USN carrier under attack' } : null; }));
    await ff(15); await snap('usn_mid_raid');
    await look((s) => { const c = s.c; return eye(c, 140, c.heading + 1.2, 25, 40); }); await snap('usn_mid_raid_low');
    await p.evaluate(() => { window.__lookFn = null; __render = false; __step(45); }); await snap('usn_mid_raid_director');
    await ff(45); await look(wide); await snap('usn_after_raid_45s');
    await ff(60); await snap('usn_after_raid_105s');
    // 4: an IJN group under a USN strike
    console.log('[ijn mid]', await find(() => { const c = cvUnder('IJN', 90); return c ? { c, desc: 'IJN carrier under attack' } : null; }, 500));
    await ff(12); await look(wide); await snap('ijn_under_usn_strike');
    // 5: a close dive through the flak (chase from behind and above the bomber)
    console.log('[dive]', await find(() => { const q = WW.world.planes.find(q => q.alive && q.kind === 'dive' && q.phase === 'dive' && q.y > 25); return q ? { q, desc: q.nation + ' dive y ' + q.y.toFixed(0) } : null; }, 400));
    await look((s) => { const q = s.q, h = q.heading; return { x: q.x - Math.sin(h) * 24, y: q.y + 3, z: q.z + Math.cos(h) * 24, tx: q.x, ty: q.y, tz: q.z }; });
    await snap('close_dive_side');
    await look((s) => { const q = s.q, h = q.heading; return { x: q.x - Math.cos(h) * 16, y: q.y + 5, z: q.z - Math.sin(h) * 16, tx: q.x + Math.cos(h) * 10, ty: q.y - 6, tz: q.z + Math.sin(h) * 10 }; });
    await p.evaluate(() => { __render = false; __step(15); }); await snap('close_dive_chase');
    try {
      execFileSync('montage', ['-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-label', '%t', ...files.map(f => path.join(OUT, f)), '-tile', '3x', '-geometry', '480x270+4+4', path.join(OUT, 'sheet.png')]);
      console.log('sheet tests/shots/flak/sheet.png');
    } catch (e) { console.log('montage failed', e.message); }
  }
  if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
