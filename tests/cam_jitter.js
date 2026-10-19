// Camera jitter probe (render mode, swiftshader): drives the page's frames on a fake rAF clock and measures, frame by
// frame, how smoothly the camera and the subject it films move on screen. One page per subject (--who); each frame
// condition (--conds) re-finds the subject, starts the follow, settles WARM frames and measures FRAMES frames:
//   scr   the subject's screen-space position (px at 960x540): the change of its per-frame velocity (px per 60 Hz frame)
//   camP  the camera position: the change of its velocity (u per 60 Hz frame); camL: the view direction (mrad)
//   steps the live sim steps each drawn frame took
// Each is reported two ways: jerk (the change of the per-frame velocity: high in a hard manoeuvre too) and jit, the
// shake: the distance from a quadratic fitted (in time) through the 5 frames around it (smooth motion, steady turns
// and accelerations score ~0; a sawtooth from uneven steps or an uneven ease scores its amplitude). The table is jit.
// The velocities are per real second (scaled to a 60 Hz frame), so an uneven frame clock is not itself counted as
// jitter: a perfectly smooth motion scores 0 at any frame rate. Frames within 4 of a shot change are left out (a cut is
// not a jitter); the director runs (--who director) also report the blends (frames 4..40 after a cut) per shot kind.
// Subjects: planes pby, dumbo, sbd, dive, torp, fighter, scout, land, deck, landing; ships dd, pt, turn, sinking;
// freeship (the free camera following a destroyer), pan (the free camera panning), ftoggle (F: the follow toggle),
// director (no follow: every shot the director takes, by kind).
// Conditions: name=hz/vsyncs-per-frame(cycled, '+')/time scale/slow motion, e.g. 120o=120/2+3/1/1 (a 120 Hz display
// whose frame overruns a vsync every other time). The 60 fps cap (main.js) applies, as on a real display.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/cam_jitter.js --who pby [--conds all|name,...]
//   [--frames 150] [--q cam=forecast|nointerp] [--tod day|dusk|night|n] [--at s|end] [--seed 1] [--sheet dir] [--json out.json]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const WHO = arg('--who', 'pby'), FRAMES = +arg('--frames', 150), WARM = 30, Q = arg('--q', ''), SEED = +arg('--seed', 1);
const TOD = arg('--tod', 'day'), AT = arg('--at', '0');   // the round's daylight (day | dusk | night | n: sunset n s in); the director from sim s AT on (end: the finale)
const SHEET = arg('--sheet', null), JSON_OUT = arg('--json', null), BASE = arg('--base', process.env.BASE_URL || 'http://localhost:8000/');
const CONDS = {
  '60': [60, [1], 1, 1], '120': [120, [1], 1, 1], '120o': [120, [2, 3], 1, 1], '144': [144, [1], 1, 1],
  'slow60': [60, [1], 1, 0.5], 'slow120o': [120, [2, 3], 1, 0.5], 'ramp60': [60, [1], 1, 0.75],
  '2x60': [60, [1], 2, 1], '2x120o': [120, [2, 3], 2, 1], '4x60': [60, [1], 4, 1], '4x120o': [120, [2, 3], 4, 1]
};
const DIRECTOR = WHO === 'director';
const condNames = (arg('--conds', 'all') === 'all' ? (DIRECTOR ? ['60', '120o', 'slow60', '2x60', '4x60'] : Object.keys(CONDS)) : arg('--conds').split(','));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } }); p.setDefaultTimeout(900000);
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true; window.__hz = 60; window.__iv = [1]; let k = 0;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__tick = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / __hz * __iv[(k++) % __iv.length]; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto(BASE + 'index.html?auto' + (Q ? '&' + Q : '') + '&v=' + Date.now(), { timeout: 120000 });
  await p.waitForTimeout(2500);
  await p.evaluate(([seed, who, tod]) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, c) => { if (__render) pr(a, c); };
    const G = WW.game; if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    if (WW.dayNight) WW.dayNight.force = isNaN(+tod) ? tod : +tod;
    G.composition = null; G.mode = 'auto'; G.baseChoice = 'USN'; G.startRound({ keepMap: true }); G.baseChoice = null; G.noRetire = who !== 'director';
    if (WW.ui && WW.ui.caption) WW.ui.caption = () => {};
    __render = false; __tick(30);
    const pl = q => q && q.alive && !q.removed && q.pt;
    const air = q => pl(q) && q.y > 8 && q.state !== 'takeoff' && q.state !== 'landing' && q.state !== 'rollout';
    const sh = s => s && s.alive && !s.removed && !s.sinking && s.stats;
    window.__want = {
      pby: q => air(q) && q.kind === 'flyingboat' && q.y > 15,
      dumbo: q => pl(q) && q.kind === 'flyingboat' && q.mission === 'rescue',
      sbd: q => air(q) && q.kind === 'dive' && !q.phase && q.state !== 'attack',
      dive: q => air(q) && q.kind === 'dive' && (q.state === 'attack' || q.phase === 'roll' || q.phase === 'dive'),
      torp: q => air(q) && q.kind === 'torpedo' && (q.phase === 'run' || q.state === 'attack'),
      fighter: q => air(q) && q.kind === 'fighter' && q.state === 'attack' && q.foe,
      scout: q => air(q) && q.kind === 'scout',
      land: q => pl(q) && q.carrier && q.carrier.isBase && (q.state === 'takeoff' || q.state === 'landing' || q.state === 'rollout'),
      deck: q => pl(q) && q.carrier && !q.carrier.isBase && q.state === 'takeoff' && q.kind !== 'scout',
      landing: q => pl(q) && q.carrier && !q.carrier.isBase && q.state === 'landing',
      dd: s => sh(s) && s.type === 'destroyer' && s.speed > 4,
      pt: s => sh(s) && s.type === 'pt' && s.speed > 3,
      turn: s => sh(s) && s.speed > 3 && Math.abs(s.trS || 0) > 0.03,
      sinking: s => s && s.sinking && !s.removed && (s.sinkT || 0) < 6,
      freeship: s => sh(s) && s.type === 'destroyer' && s.speed > 4,
      pan: s => sh(s),
      ftoggle: () => true,
      director: () => true
    }[who];
    window.__isShip = ['dd', 'pt', 'turn', 'sinking', 'freeship', 'pan'].includes(who);
    window.__rec = []; __rec.ids = 0; window.__recOn = false;
    let lastN = 0;
    const orig = WW.cam.afterRender, V = new THREE.Vector3(), F = new THREE.Vector3();
    WW.cam.afterRender = function () {
      if (orig) orig.call(this);
      const n = WW.game.stepN || 0, steps = n - lastN; lastN = n;
      if (!__recOn) return;
      const c = WW.camera, s = WW.cam._shot(); F.set(0, 0, -1).applyQuaternion(c.quaternion);
      if (s && !s.__id) s.__id = ++__rec.ids;
      const fc = WW.freecam && WW.freecam.active();
      const subj = who === 'director' || who === 'ftoggle' ? (fc ? WW.freecam.following() : s && (s.plane || s.subj)) : who === 'pan' ? null : window.__q;
      const g = subj && (subj.group || subj.mesh);
      if (g) g.getWorldPosition(V); else if (subj && subj.x !== undefined) V.set(subj.x, subj.y || 0, subj.z);
      const ok = !!(subj && (g || subj.x !== undefined));
      const nd = ok ? V.clone().project(c) : { x: 0, y: 0, z: 1 };
      __rec.push({ id: fc ? -1 : s ? s.__id : 0, t: __fakeT / 1000, x: c.position.x, y: c.position.y, z: c.position.z, fx: F.x, fy: F.y, fz: F.z,
        kind: fc ? 'freecam' : s ? s.kind + (s.sk ? ':' + s.sk : '') : '-', subj: ok ? (subj.kind || subj.type) + ':' + (subj.state || '') : '-',
        ok: ok && Math.abs(nd.z) < 1, sx: nd.x * 480, sy: -nd.y * 270, steps, warp: WW.time.warp || 1, dist: ok ? c.position.distanceTo(V) : 0 });
    };
  }, [SEED, WHO, TOD]);
  // a condition: the frame clock, the time scale, the slow motion (held: the director's own is turned off)
  const setCond = ([hz, iv, scale, warp]) => p.evaluate(([hz, iv, scale, warp]) => {
    __hz = hz; __iv = iv; __sim.setScale(scale);
    const ca = WW.camAction; if (ca && !ca.__tick0) ca.__tick0 = ca.tick;
    if (ca) ca.tick = warp !== 1 ? function () { WW.time.warp = warp; } : ca.__tick0;
    WW.time.warp = warp;
  }, [hz, iv, scale, warp]);
  // find the subject (live steps on, max s sim seconds), then start the follow
  const start = () => p.evaluate(who => {
    const list = () => (__isShip ? WW.world.ships : WW.world.planes);
    let q = null;
    for (let i = 0; i < 900 && !q; i++) { q = list().find(__want); if (!q) __sim.stepFixed(120); }
    if (!q) return null;
    window.__q = q;
    if (WW.freecam && WW.freecam.active()) WW.freecam.release();
    if (who === 'freeship' || who === 'pan') WW.freecam.follow(q);
    else if (who === 'ftoggle') WW.camFollow.f();
    else if (who !== 'director') WW.camFollow.jump({ subj: q, label: who });
    return (q.kind || q.type) + ' ' + (q.mission || '') + ' ' + (q.state || '') + ' t ' + WW.game.roundTime.toFixed(0);
  }, WHO);
  const run = async n => { for (let i = 0; i < n; i += 30) await p.evaluate(k => { __tick(k); }, Math.min(30, n - i)); };
  // --at: the round run on (live steps) to that sim time, or to its end (the finale and the coda)
  console.log('at', await p.evaluate(at => { const G = WW.game; let i = 0;
    if (at === 'end') { while (G.state === 'battle' && i++ < 2000) __sim.stepFixed(120); }
    else while (G.roundTime < +at && G.state === 'battle' && i++ < 2000) __sim.stepFixed(120);
    return G.state + ' t ' + G.roundTime.toFixed(0) + (WW.dayNight ? ' ' + WW.dayNight.kind : ''); }, AT));
  const out = [];
  if (SHEET) fs.mkdirSync(SHEET, { recursive: true });
  for (const name of condNames) {
    const C = CONDS[name]; if (!C) { console.log('no condition', name); continue; }
    await setCond(C);
    const info = await start();
    if (!info) { console.log(`[${WHO}] ${name}: no subject`); out.push({ who: WHO, cond: name, none: true }); continue; }
    if (WHO === 'pan') { await p.keyboard.down('ArrowRight'); }
    await run(WARM);
    await p.evaluate(() => { __rec.length = 0; __recOn = true; });
    const fr = DIRECTOR ? FRAMES * 4 : FRAMES;
    if (SHEET && name === condNames[0]) {
      for (let i = 0; i < fr; i += 15) { await p.evaluate(() => { __tick(14); __render = true; __tick(1); __render = false; }); await p.screenshot({ path: path.join(SHEET, WHO + '_' + String(i / 15).padStart(3, '0') + '.png') }); }
    } else await run(fr);
    if (WHO === 'pan') await p.keyboard.up('ArrowRight');
    const rec = await p.evaluate(() => { __recOn = false; return __rec.splice(0); });
    const r = analyse(rec);
    r.who = WHO; r.cond = name; r.info = info; out.push(r);
    console.log(`[${WHO}] ${name} (${info}) steps ${JSON.stringify(r.hist)} shots ${r.shots} d~${r.dist}` +
      `\n   jit: scr px ${fmt(r.jit.scr)} | camP u ${fmt(r.jit.camP)} | camL mrad ${fmt(r.jit.camL)}` +
      `\n   jerk: scr px ${fmt(r.scr)} | camP u ${fmt(r.camP)} | camL mrad ${fmt(r.camL)}` + (r.blend ? `\n   blends: camL ${fmt(r.blend.camL)} camP ${fmt(r.blend.camP)}` : '') +
      (DIRECTOR ? '\n   by shot (jit p95 scr px / camL mrad): ' + Object.entries(r.byKind).map(([k, v]) => `${k} n${v.n} ${v.jscr.p95.toFixed(2)}/${v.jcamL.p95.toFixed(2)}`).join('; ') : ''));
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out));
  console.log(errs.length ? 'ERRORS ' + errs.length + ' ' + errs.slice(0, 4).join(' / ') : 'errors 0');
  await b.close();
})();

function stat(a) {
  if (!a.length) return { n: 0, rms: 0, p95: 0, max: 0 };
  const s = a.slice().sort((x, y) => x - y);
  return { n: a.length, rms: Math.sqrt(a.reduce((k, v) => k + v * v, 0) / a.length), p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
}
function fmt(s) { return s.n ? `rms ${s.rms.toFixed(3)} p95 ${s.p95.toFixed(3)} max ${s.max.toFixed(3)}` : 'n/a'; }
// the change of the per-frame velocity, velocities per real second scaled to a 60 Hz frame
function jerk(a, b, c, key) {
  const d1 = (b.t - a.t) || 1e-3, d2 = (c.t - b.t) || 1e-3;
  let s = 0;
  for (const k of key) { const v1 = (b[k] - a[k]) / d1, v2 = (c[k] - b[k]) / d2; s += (v2 - v1) * (v2 - v1); }
  return Math.sqrt(s) / 60;
}
// the shake at frame i: the distance of its values from the least-squares quadratic (in time) through frames i-2..i+2
function resid(r5, keys) {
  const tc = r5[2].t; let s = 0;
  const T = r5.map(f => f.t - tc);
  // normal equations for v = a + b t + c t^2 (5 points)
  let S0 = 5, S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  for (const t of T) { S1 += t; S2 += t * t; S3 += t * t * t; S4 += t * t * t * t; }
  const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-30) return 0;
  for (const k of keys) {
    let Y0 = 0, Y1 = 0, Y2 = 0;
    r5.forEach((f, j) => { const t = T[j], v = f[k] - r5[2][k]; Y0 += v; Y1 += v * t; Y2 += v * t * t; });
    const Ma = [[Y0, S1, S2], [Y1, S2, S3], [Y2, S3, S4]];
    const a = det(Ma) / D;   // the fit at t = 0 (the centre frame), relative to its value
    s += a * a;
  }
  return Math.sqrt(s);
}
function analyse(rec) {
  const J = { scr: [], camP: [], camL: [] };
  const first = {}, scr = [], camP = [], camL = [], hist = {}, by = {}, bl = { camL: [], camP: [] };
  let shots = 0, prev = null;
  rec.forEach((f, i) => {
    hist[f.steps] = (hist[f.steps] || 0) + 1;
    if (f.id !== prev) { shots++; prev = f.id; }
    if (first[f.id] === undefined || (i > 0 && rec[i - 1].id !== f.id)) first[f.id] = i;
    if (i < 2) return;
    const a = rec[i - 2], c = rec[i - 1], since = i - first[f.id];
    if (a.id !== f.id || c.id !== f.id) return;
    const jl = 1000 * jerk(a, c, f, ['fx', 'fy', 'fz']), jp = jerk(a, c, f, ['x', 'y', 'z']);
    if (since < 4) return;
    const r5 = i >= 2 && i + 2 < rec.length ? rec.slice(i - 2, i + 3) : null;
    let js5 = null, jl5 = null;
    if (r5 && r5.every(g => g.id === f.id) && i - 2 - first[f.id] >= 2) {
      J.camP.push(resid(r5, ['x', 'y', 'z'])); jl5 = 1000 * resid(r5, ['fx', 'fy', 'fz']); J.camL.push(jl5);
      if (r5.every(g => g.ok && g.subj === f.subj)) { js5 = resid(r5, ['sx', 'sy']); J.scr.push(js5); }
    }
    if (since < 40 && first[f.id] > 0) { bl.camL.push(jl); bl.camP.push(jp); }
    const K = by[f.kind] || (by[f.kind] = { scr: [], camL: [], jscr: [], jcamL: [] });
    camP.push(jp); camL.push(jl); K.camL.push(jl);
    if (jl5 !== null) K.jcamL.push(jl5); if (js5 !== null) K.jscr.push(js5);
    if (f.ok && a.ok && c.ok && a.subj === f.subj) { const js = jerk(a, c, f, ['sx', 'sy']); scr.push(js); K.scr.push(js); }
  });
  const ds = rec.filter(f => f.ok).map(f => f.dist).sort((x, y) => x - y);
  const byKind = {}; for (const k in by) byKind[k] = { n: by[k].camL.length, scr: stat(by[k].scr), camL: stat(by[k].camL), jscr: stat(by[k].jscr), jcamL: stat(by[k].jcamL) };
  return { jit: { scr: stat(J.scr), camP: stat(J.camP), camL: stat(J.camL) }, hist, shots, dist: ds.length ? ds[ds.length >> 1].toFixed(0) : '-', scr: stat(scr), camP: stat(camP), camL: stat(camL),
    blend: bl.camL.length ? { camL: stat(bl.camL), camP: stat(bl.camP) } : null, byKind };
}
