// Speed calibration probe (read-only recorder: no WW.rand, no writes to sim objects). Samples every plane, ship and
// torpedo every DT sim s and reports, per kind / nation / variant and flight state, the measured speed in sim u/s,
// the knots it stands for on the ship clock (1 u/s = 5.71 kn: a carrier's 32 kn = 5.6 u/s, core.js TORPEDO_NATION),
// and the speed it showed ON SCREEN at 1x under the old BASE_SPEED 0.5 (u/s x 9.6 m/u x 0.5; since speedcal the screen
// shows the ship-clock knots at 1x). Also: bomb fall times (release height, plane speed, time to impact), aerial torpedo fall times, take-off
// rolls (deck run time) and catapult shots. docs/speed_calibration.md is built from this.
// Usage: node tests/speed_probe.js [--seeds N=3] [--seed0 S=1] [--only standard,carrier_duel,midway,cvpt] [--workers K] [--json out.json]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const P2 = require('./planes2_review');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 3), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,midway,cvpt').split(',');
const JSON_OUT = arg('--json', null);

function install() {
  const R = window.__sp = {};
  const DT = 0.25;
  let S, last, next = 0;
  const fresh = () => { S = { b: {}, bomb: [], tfall: [], torp: {}, ship: {}, roll: [] }; last = new WeakMap(); };
  fresh(); WW.on('roundStart', () => { fresh(); next = 0; });
  const add = (key, v) => { (S.b[key] = S.b[key] || []).push(v); };
  const drops = new Map();
  WW.on('weaponDropped', e => {
    const p = e && e.plane, b = e && e.proj; if (!p || !b) return;
    drops.set(b, { t0: WW.game.roundTime, y: b.y, k: e.kind, ps: p.speed, dive: !!p.dropV, lvl: !!p.level, n: p.nation, v: p.variant || '' });
  });
  WW.on('weaponImpact', e => {
    const D = e && drops.get(e.proj); if (!D) return; drops.delete(e.proj);
    if (D.k === 'bomb') S.bomb.push(Object.assign(D, { T: WW.game.roundTime - D.t0 }));
  });
  const keyOf = p => {
    const v = p.variant && p.variant !== 'f4f' && p.variant !== 'sbd' && p.variant !== 'a6m' ? p.variant : '';
    return p.kind + '|' + p.nation + (v ? '|' + v : '') + (p.carrier && p.carrier.isBase ? '|base' : '');
  };
  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += DT; R.sample(); }
    return r0;
  };
  R.sample = () => {
    const t = WW.game.roundTime;
    for (const p of WW.world.planes) {
      const L = last.get(p);
      last.set(p, { x: p.x, y: p.y, z: p.z, t, st: p.state, ph: p.phase, sk: p.sk });
      if (!L || t - L.t < DT * 0.5 || t - L.t > DT * 1.5) continue;
      if (!p.alive || p.removed) continue;
      const dt = t - L.t, hs = Math.hypot(p.x - L.x, p.z - L.z) / dt, vs = (p.y - L.y) / dt;
      if (hs > 200) continue;   // a jump (respawn, recycled object)
      const st = p.state === L.st ? p.state : null; if (!st) continue;
      const ph = (p.phase || '-') + (p.sk ? ':' + p.sk : '') + (p.deckPh ? ':deck-' + p.deckPh : '');
      add(keyOf(p) + '\t' + st + '\t' + ph, [hs, vs, p.y, p.speed || 0]);
    }
    for (const s of WW.world.ships) {
      if (!s.alive || s.sinking || s.isBase || s.isLand || !s.stats) continue;
      const L = last.get(s); last.set(s, { x: s.x, z: s.z, t });
      if (!L) continue;
      const hs = Math.hypot(s.x - L.x, s.z - L.z) / (t - L.t || DT);
      (S.ship[s.type + '|' + s.nation] = S.ship[s.type + '|' + s.nation] || []).push([hs, s.stats.speed]);
    }
    const A = WW.combat && WW.combat._i && WW.combat._i.active || [];
    for (const q of A) {
      if (q.kind !== 'torp' || q.dead) continue;
      const L = last.get(q); last.set(q, { x: q.x, z: q.z, t, fall: q.fall });
      if (!L || L.fall || q.fall) continue;
      const hs = Math.hypot(q.x - L.x, q.z - L.z) / (t - L.t || DT);
      (S.torp[q.src + '|' + q.nation] = S.torp[q.src + '|' + q.nation] || []).push(hs);
    }
  };
  R.flush = () => { const o = S; fresh(); return o; };
}

(async () => {
  const list = [];
  for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(P2.specFor(sc, s));
  const b = await HL.launch(); const res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install);
    while (next < list.length) {
      const spec = list[next++];
      res.push(await p.evaluate(spec => { window.__beh.run(spec); return __sp.flush(); }, spec));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close();
  console.log('');
  // merge
  const B = {}, SH = {}, TO = {}, BO = [];
  for (const r of res) {
    for (const k in r.b) (B[k] = B[k] || []).push(...r.b[k]);
    for (const k in r.ship) (SH[k] = SH[k] || []).push(...r.ship[k]);
    for (const k in r.torp) (TO[k] = TO[k] || []).push(...r.torp[k]);
    BO.push(...r.bomb);
  }
  const KN = 5.714, SCR = 9.6 * 0.5 / 0.5144;   // ship-clock knots per u/s (= on screen at 1x now); on-screen knots per u/s at the old 0.5 clock
  const q = (a, f) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '-');
  const out = { planes: [], ships: [], torps: [], bombs: [] };
  console.log('PLANES (horizontal speed u/s p10 / p50 / p90; vertical p50; ship-clock kn and on-screen kn at 1x from p50; n samples)');
  for (const k of Object.keys(B).sort()) {
    const a = B[k]; if (a.length < 8) continue;
    const hs = a.map(v => v[0]), vs = a.map(v => v[1]), y = a.map(v => v[2]);
    const p50 = q(hs, 0.5);
    const row = { key: k, n: a.length, p10: q(hs, 0.1), p50, p90: q(hs, 0.9), vy50: q(vs, 0.5), vyMin: q(vs, 0.05), y50: q(y, 0.5), kn: p50 * KN, scr: p50 * SCR };
    out.planes.push(row);
    console.log(`${k.padEnd(48)} ${f1(row.p10)} / ${f1(p50)} / ${f1(row.p90)}  vy ${f1(row.vy50)} (p5 ${f1(row.vyMin)})  y ${f1(row.y50)}  = ${row.kn.toFixed(0)} kn clock, ${row.scr.toFixed(0)} kn old screen  n ${a.length}`);
  }
  console.log('\nSHIPS (measured u/s p50 / p95 / max; stats.speed)');
  for (const k of Object.keys(SH).sort()) {
    const a = SH[k].map(v => v[0]), st = SH[k][0][1];
    const row = { key: k, p50: q(a, 0.5), p95: q(a, 0.95), max: q(a, 0.999), stat: st };
    out.ships.push(row);
    console.log(`${k.padEnd(22)} ${f1(row.p50)} / ${f1(row.p95)} / ${f1(row.max)}  stat ${st}  = ${(st * KN).toFixed(0)} kn clock, ${(st * SCR).toFixed(0)} kn old screen`);
  }
  console.log('\nTORPEDOES in the water (u/s p50)');
  for (const k of Object.keys(TO).sort()) { const v = q(TO[k], 0.5); out.torps.push({ key: k, p50: v }); console.log(`${k.padEnd(14)} ${f1(v)} = ${(v * KN).toFixed(0)} kn clock, ${(v * SCR).toFixed(0)}  kn old screen  n ${TO[k].length}`); }
  console.log('\nBOMBS (release y, plane speed, fall time sim s: p50 by type)');
  const grp = {}; for (const d of BO) { const k = (d.dive ? 'dive' : d.lvl ? 'level' : 'glide/other') + '|' + d.n + (d.v ? '|' + d.v : ''); (grp[k] = grp[k] || []).push(d); }
  for (const k of Object.keys(grp).sort()) {
    const a = grp[k], row = { key: k, n: a.length, y: q(a.map(d => d.y), 0.5), ps: q(a.map(d => d.ps), 0.5), T: q(a.map(d => d.T), 0.5) };
    out.bombs.push(row);
    console.log(`${k.padEnd(24)} y ${f1(row.y)}  plane ${f1(row.ps)} u/s  fall ${row.T.toFixed(2)} s sim = ${(row.T * 2).toFixed(1)} s real  n ${a.length}`);
  }
  if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
})();
