// Deck ride probe (render mode, nothing drawn, a fake 60 fps clock): on a rough sea a carrier pitches and rolls
// (ship_swell.js); a plane on its take-off run, and one trapping and rolling out, must keep its height over the deck it
// is on. The sea is visual only, so the same seed on a glassy sea (?sea=glassy) runs the same round frame for frame:
// each frame, while a plane's drawn position is over the flight deck, its height in the deck's own frame
// (model.deck's world matrix) is sampled on both seas, and the difference is the sea's error. Reported per plane:
// the largest |rough - glassy| height difference, and the carrier's pitch / roll seen. PASS: every one <= TOL (0.02 u).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/deck_ride.js [seeds=1,2] [planes=3] [sea=rough]
const { chromium } = require('playwright');
const SEEDS = (process.argv[2] || '1,2').split(',').map(Number), N = +(process.argv[3] || 3), SEA = process.argv[4] || 'rough', TOL = 0.02;
async function run(b, seed, sea, keys) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 60; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&sea=' + sea, { timeout: 180000 });
  await p.waitForTimeout(1000);
  await p.evaluate((seed) => {
    WW.post.render = () => {};
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    WW.seedRandom(seed); WW.time.now = 0; WW.game.mode = 'auto'; WW.game.composition = null; WW.game.startRound();
    __sim.setScale(1);
    window.__trk = new Map(); window.__f = 0; window.__n = 0;
    const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
    window.__sample = () => {
      __f++;
      for (const q of WW.world.planes) {
        const c = q.carrier; if (!q.alive || q.removed || !c || c.isBase || !c.model || !c.model.deck || !q.group) continue;
        const ph = q.state === 'takeoff' && q.deckPh === 'run' ? 'run' : q.state === 'rollout' && q.deckPh === 'trap' ? 'trap' : null;
        if (!ph) continue;
        c.group.updateMatrixWorld(true); q.group.updateMatrixWorld(true);
        q.group.getWorldPosition(_v); _v.applyMatrix4(_m.copy(c.model.deck.matrixWorld).invert());
        const k = c.model.deckDims; if (k && (Math.abs(_v.z) > k.halfW || _v.x < k.stern || _v.x > k.bow)) continue;   // over the deck only
        if (!q.__k) q.__k = ++__n; const key = q.__k + ':' + ph; let r = __trk.get(key);   // (planes numbered in the order first seen: the same on both seas)
        if (!r) { r = { ph, kind: q.kind, y: {}, x: {}, par: {}, n: 0, pitch: 0, roll: 0 }; __trk.set(key, r); }
        r.y[__f] = _v.y; r.x[__f] = +_v.x.toFixed(2); (r.sx = r.sx || {})[__f] = q.x + q.z * 7 + q.y * 13; r.par[__f] = q.group.parent === WW.scene ? 's' : 'c'; r.n++;
        _e.setFromQuaternion(_q.setFromRotationMatrix(c.model.deck.matrixWorld), 'YZX'); r.pitch = Math.max(r.pitch, Math.abs(_e.z)); r.roll = Math.max(r.roll, Math.abs(_e.x));
      }
    };
  }, seed);
  let guard = 0;
  for (;;) {
    const st = await p.evaluate(() => { for (let i = 0; i < 150; i++) { __step(1); __sample(); } let r = 0, t = 0; for (const v of __trk.values()) if (v.n > 20) { if (v.ph === 'run') r++; else t++; } return [r, t]; });
    if (keys ? [...keys].every(k => k) && guard >= keys.guard : (st[0] >= N && st[1] >= N)) break;
    if (++guard > 240) break;
  }
  const res = await p.evaluate(() => Object.fromEntries([...__trk.entries()].filter(e => e[1].n > 20)));
  await p.close();
  return { res, guard, errs };
}
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let worst = 0, n = 0;
  for (const seed of SEEDS) {
    const R = await run(b, seed, SEA, null);
    const G = await run(b, seed, 'glassy', Object.assign([true], { guard: R.guard }));   // the same number of frames
    const out = { run: [], trap: [] }; let pmax = 0, rmax = 0;
    for (const k in R.res) {
      const r = R.res[k], g = G.res[k]; if (!g) continue;
      let d = 0, m = 0, at = ''; let div = 0; for (const f in r.y) if (g.y[f] !== undefined) { if (Math.abs(r.sx[f] - g.sx[f]) > 1e-6) { div++; continue; } const e = Math.abs(r.y[f] - g.y[f]); if (e > d) { d = e; at = ' at x ' + r.x[f] + ' ' + r.par[f] + (f - Object.keys(r.y)[0]); } m++; }
      if (div) console.log('  ' + k + ': the sim differs between the seas in ' + div + ' frames (left out)');
      if (m < 20) continue;
      worst = Math.max(worst, d); n++; pmax = Math.max(pmax, r.pitch * 57.3); rmax = Math.max(rmax, r.roll * 57.3);
      out[r.ph].push(d.toFixed(3) + (process.env.DBG ? at : '') + ' (' + r.kind[0] + ', pitch ' + (r.pitch * 57.3).toFixed(1) + ' roll ' + (r.roll * 57.3).toFixed(1) + ' deg)');
    }
    const sum = L => L.length + ', worst ' + (L.length ? Math.max(...L.map(x => parseFloat(x))).toFixed(3) : '-') + ' u' + (process.env.DBG ? ': ' + L.join('  ') : '');
    console.log(`seed ${seed} ${SEA} vs glassy: take-off runs ${sum(out.run)}; traps ${sum(out.trap)}; carrier pitch up to ${pmax.toFixed(1)} deg, roll ${rmax.toFixed(1)} deg${R.errs.length ? '\n  errors ' + R.errs.slice(0, 3).join(' / ') : ''}`);
  }
  console.log(`${worst <= TOL && n ? 'PASS' : 'FAIL'}: ${n} deck runs / traps, the sea's worst error in the height over the deck ${worst.toFixed(3)} u (tolerance ${TOL})`);
  await b.close();
  process.exit(worst <= TOL && n ? 0 : 1);
})();
