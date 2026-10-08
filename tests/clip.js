// Clipping probe: node clip.js [port=8793] [rounds=10] [tag=after] [shots=1]
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'rt'), { recursive: true }); process.chdir(__dirname);
// Counts per sim step: (a) overlapping live-ship capsule pairs, (b) live ships with a hull sample at depth <= 0.3,
// (c) live ships overlapping above-water wrecks, (d) wrecks with a hull sample on land (depth <= 0).
const { chromium } = require('playwright');
const PORT = process.argv[2] || 8000, ROUNDS = +(process.argv[3] || 10), TAG = process.argv[4] || 'after', SHOTS = process.argv[5] !== '0';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  // deterministic maps / RNG (frames between evaluate calls still add some jitter)
  await p.addInitScript(() => { let s = 12345; Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  await p.goto((process.env.BASE_URL || `http://localhost:${PORT}/`) + 'index.html');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    // measured beam per type (bow on +x, so beam = z extent)
    const BEAM = {};
    for (const t in WW.SHIP_TYPES) { const m = WW.models.buildShip(t, 'USN'); const bx = new THREE.Box3().setFromObject(m.group); BEAM[t] = bx.max.z - bx.min.z; }
    const wrecks = [];
    const orig = WW.Ship.prototype.becomeWreck;
    WW.Ship.prototype.becomeWreck = function () { orig.call(this); wrecks.push(this); };
    const D = (x, z) => WW.terrain.depthAt(x, z);
    function samples(x, z, h, L, B) {
      const c = Math.cos(h), s = Math.sin(h), out = [], n = Math.max(2, Math.ceil(L / 3));
      for (let i = 0; i <= n; i++) { const a = -L / 2 + L * i / n; out.push([x + c * a, z + s * a]); }
      for (const a of [-L / 4, 0, L / 4]) for (const sd of [-B / 2, B / 2]) out.push([x + c * a - s * sd, z + s * a + c * sd]);
      return out;
    }
    const minD = (x, z, h, L, B) => Math.min(...samples(x, z, h, L, B).map(q => D(q[0], q[1])));
    function seg(o) { const r = BEAM[o.type] / 2, a = Math.max(0, o.stats.length / 2 - r), c = Math.cos(o.heading), s = Math.sin(o.heading); return [o.x - c * a, o.z - s * a, o.x + c * a, o.z + s * a, r]; }
    function segDist(p, q) { // segment-segment distance (2D)
      const [ax, az, bx, bz] = p, [cx, cz, dx, dz] = q;
      const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz;
      const A = ux * ux + uz * uz, B = ux * vx + uz * vz, C = vx * vx + vz * vz, Dd = ux * wx + uz * wz, E = vx * wx + vz * wz;
      const den = A * C - B * B; let sN, sD = den, tN, tD = den;
      if (den < 1e-9) { sN = 0; sD = 1; tN = E; tD = C; } else { sN = B * E - C * Dd; tN = A * E - B * Dd; if (sN < 0) { sN = 0; tN = E; tD = C; } else if (sN > sD) { sN = sD; tN = E + B; tD = C; } }
      if (tN < 0) { tN = 0; if (-Dd < 0) sN = 0; else if (-Dd > A) sN = sD; else { sN = -Dd; sD = A; } } else if (tN > tD) { tN = tD; if (-Dd + B < 0) sN = 0; else if (-Dd + B > A) sN = sD; else { sN = -Dd + B; sD = A; } }
      const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
      const px = wx + sc * ux - tc * vx, pz = wz + sc * uz - tc * vz; return Math.sqrt(px * px + pz * pz);
    }
    const C = window.__clip = { steps: 0, a: 0, b: 0, c: 0, d: 0, aSink: 0, aX: [], bX: [], cX: [], dX: [], worstA: 0, worstB: 9, BEAM, wrecks };
    const ex = (arr, s) => { if (arr.length < 6 && !arr.includes(s)) arr.push(s); };
    window.clipStep = () => {
      C.steps++;
      const S = WW.world.ships.filter(s => !s.removed && !s.wreck), L = S.filter(s => s.alive && !s.sinking);
      for (let i = 0; i < L.length; i++) {
        const o = L[i], sg = seg(o);
        const md = minD(o.x, o.z, o.heading, o.stats.length, BEAM[o.type]);
        if (md <= 0.3) { C.b++; C.worstB = Math.min(C.worstB, md); ex(C.bX, `${o.type}@${o.x.toFixed(0)},${o.z.toFixed(0)} d=${md.toFixed(2)} t=${WW.game.roundTime.toFixed(0)}`); }
        for (let j = i + 1; j < L.length; j++) {
          const q = L[j]; if (o.submerged !== q.submerged) continue;
          const R = (o.stats.length + q.stats.length) / 2; if (WW.dist2(o.x, o.z, q.x, q.z) > R * R) continue;
          const sq = seg(q), ov = sg[4] + sq[4] - segDist(sg, sq);
          if (ov > 0) { C.a++; C.worstA = Math.max(C.worstA, ov); ex(C.aX, `${o.type}/${q.type} ov=${ov.toFixed(2)}`); }
        }
        for (const q of S) if (q.sinking && q.sinkT < 4) { const sq = seg(q); if (sg[4] + sq[4] - segDist(sg, sq) > 0) C.aSink++; }
        for (const w of wrecks) {
          if (w.removed || !(w.wreckInfo && w.wreckInfo.top > 0.2) || o.submerged) continue;
          const sw = seg(w), ov = sg[4] + sw[4] - segDist(sg, sw);
          if (ov > 0) { C.c++; ex(C.cX, `${o.type}@${o.x.toFixed(0)},${o.z.toFixed(0)} hm=${WW.shipNav ? WW.shipNav.hullMin(o,o.x,o.z,o.heading).toFixed(2) : "-"} vs wreck ${w.type} top=${w.wreckInfo.top.toFixed(1)} ov=${ov.toFixed(2)} t=${WW.game.roundTime.toFixed(0)}`); }
        }
      }
      for (const w of wrecks) {
        if (w.removed) continue;
        const md = minD(w.x, w.z, w.heading, w.stats.length, BEAM[w.type]);
        if (md <= 0) { C.d++; ex(C.dX, `${w.type}@${w.x.toFixed(0)},${w.z.toFixed(0)} d=${md.toFixed(2)}`); }
      }
      for (let i = wrecks.length - 1; i >= 0; i--) if (wrecks[i].removed) wrecks.splice(i, 1);
      if (C.steps % 200 === 0 && WW.game.state === 'battle') { // stuck = live ship moved < 1.5 units in 10 s
        C.pos = C.pos || new Map();
        for (const o of L) { const q = C.pos.get(o); if (q && WW.dist(q[0], q[1], o.x, o.z) < 1.5) { C.stuck = (C.stuck || 0) + 1; if ((C.sX = C.sX || []).length < 8) C.sX.push(`${o.type}@${o.x.toFixed(0)},${o.z.toFixed(0)} hm=${WW.shipNav ? WW.shipNav.hullMin(o, o.x, o.z, o.heading).toFixed(1) : '-'} t=${WW.game.roundTime.toFixed(0)}`); } C.pos.set(o, [o.x, o.z]); }
      }
    };
    window.ff = sec => __sim.fastForward(sec, clipStep);
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { if (cond()) return true; ff(0.25); } return cond(); };
  });
  console.log('beam', JSON.stringify(await p.evaluate(() => Object.fromEntries(Object.entries(__clip.BEAM).map(([k, v]) => [k, +v.toFixed(2)])))));
  const lengths = [];
  for (let r = 0; r < ROUNDS; r++) {
    const L = await p.evaluate(() => { until(() => WW.game.state === 'victory' || WW.game.roundTime > 325, 400); if (WW.game.state === 'battle') window.__toAlive = WW.world.ships.filter(s => s.alive).map(s => s.nation + ':' + s.type + '@' + s.x.toFixed(0) + ',' + s.z.toFixed(0) + ' sp' + s.speed.toFixed(1) + ' hp' + s.hp.toFixed(0)).join(' '); until(() => WW.game.state === 'victory', 400); const t = WW.game.roundTime; until(() => WW.game.state === 'battle', 30); return t; });
    if (L >= 329.9) console.log('TIMEOUT alive:', await p.evaluate(() => window.__toAlive));
    lengths.push(Math.round(L) + (L >= 329.9 ? 'T' : ''));
    if (SHOTS && r === 2) await shots();
  }
  const C = await p.evaluate(() => { const c = Object.assign({}, __clip); delete c.wrecks; delete c.BEAM; delete c.pos; return c; });
  console.log(`[${TAG}] steps ${C.steps}  (a) ship-ship ${C.a} (worst ov ${C.worstA.toFixed(2)})  (b) hull-on-shoal ${C.b} (min d ${C.worstB.toFixed(2)})  (c) ship-wreck ${C.c}  (d) wreck-on-land ${C.d}   [info: live vs fresh-sinking ${C.aSink}]`);
  console.log('stuck 10s-windows', C.stuck || 0, (C.sX || []).join(' | ')); console.log('ex a', C.aX.join(' | ')); console.log('ex b', C.bX.join(' | ')); console.log('ex c', C.cX.join(' | ')); console.log('ex d', C.dX.join(' | '));
  console.log('round lengths', lengths.join(' '), 'avg', (lengths.reduce((a, c) => a + parseInt(c), 0) / lengths.length).toFixed(0), 'timeouts', lengths.filter(x => /T/.test(x)).length);
  console.log('errors', errs.length, errs.slice(0, 5).join(' / '));
  await b.close();

  async function shots() {
    await p.evaluate(() => ff(100));
    // 1) live ship closest to land  2) most crowded spot
    const spots = await p.evaluate(() => {
      const L = WW.world.ships.filter(s => s.alive);
      let best = null, bd = 1e9; for (const s of L) { if (s.type === 'pt') continue; let m = 99; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; m = Math.min(m, WW.terrain.depthAt(s.x + Math.cos(a) * s.stats.length * 0.6, s.z + Math.sin(a) * s.stats.length * 0.6)); } if (m < bd) { bd = m; best = s; } }
      let crowd = null, cn = -1; for (const s of L) { const n = L.filter(o => WW.dist(o.x, o.z, s.x, s.z) < 40).length; if (n > cn) { cn = n; crowd = s; } }
      return [best && [best.x, best.z], crowd && [crowd.x, crowd.z]];
    });
    const names = ['island', 'crowd'];
    for (let i = 0; i < 2; i++) {
      if (!spots[i]) continue;
      await p.evaluate(([x, z]) => { __sim.focus(x, z, 45, 8); __sim.snapCamera(); __sim.setScale(0.05); }, spots[i]);
      await p.waitForTimeout(900);
      await p.screenshot({ path: `shots/clip_${TAG}_${names[i]}.png` });
      await p.evaluate(() => __sim.setScale(1));
    }
  }
})();
