// Island base launch probe (read-only recorder): for every base plane that starts out (state takeoff on the field),
// the time to get airborne (rwPh climb) and the time spent in each ground phase (warm / taxi / hold / lineup / roll),
// the field's mode while it waits (launch / recover / idle), planes that never got off, and the launch rate while
// planes were queued. Usage: node tests/base_launch_probe.js [--only carrier_duel,midway,ijnbase,standard] [--seeds N=10]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 10), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'carrier_duel,midway,ijnbase,standard').split(',');
const SC = {
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};
const spec = (sc, seed) => sc === 'standard' ? { seed, random: true, light: true, scen: sc } : { seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN || (seed % 2 ? 'USN' : 'IJN'), base: SC[sc].base || null, cripple: -1, noStall: false, light: true, scen: sc };

function install() {
  const R = window.__bl = {};
  let S = null, next = 0;
  const fresh = () => { S = { m: new Map(), done: [], queuedS: 0, launches: 0, mode: {}, why: {} }; next = 0; };
  fresh(); WW.on('roundStart', fresh);
  const U0 = WW.air.update;
  WW.air.update = function () { const r0 = U0.apply(this, arguments); if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += 0.5; sample(); } return r0; };
  function sample() {
    const t = WW.game.roundTime, B = WW.islandBase && WW.islandBase.base; if (!B) return;
    let queued = 0;
    for (const p of WW.world.planes) {
      if (p.carrier !== B || p.removed) continue;
      let E = S.m.get(p);
      if (!E && p.alive && p.state === 'takeoff') { E = { t0: t, kind: p.kind, ph: {}, tAir: null, bomb: p.kind !== 'fighter', fast: !!p.fast }; S.m.set(p, E); }
      if (!E || E.tAir !== null || E.end) continue;
      if (!p.alive) { E.end = 'lost'; continue; }
      if (p.state === 'takeoff' && p.rwPh === 'climb' || p.state !== 'takeoff') { E.tAir = t; S.launches++; continue; }
      queued++;
      const k = p.rwPh || '-'; E.ph[k] = (E.ph[k] || 0) + 0.5;
      const md = B.ops ? B.ops.mode : '?'; E.ph['mode:' + md] = (E.ph['mode:' + md] || 0) + 0.5;
      if (p.rwPh === 'warm') {
        const why = p.rwT < p.warm ? 'warming' : !WW.landGround.opsOpen(B) ? 'closed' : md !== 'launch' ? 'mode ' + md : B.ops.yield ? 'yield' : WW.world.planes.some(q => q !== p && q.carrier === B && q.alive && q.state === 'takeoff' && q.path && p.path && q.path.lanes[1] === p.path.lanes[1] && q.rwPh === 'taxi' && q.pi <= 3) ? 'column busy' : 'fast first / other';
        S.why[why] = (S.why[why] || 0) + 0.5;
      }
    }
    if (queued) { S.queuedS += 0.5; S.mode[B.ops ? B.ops.mode : '?'] = (S.mode[B.ops ? B.ops.mode : '?'] || 0) + 0.5; }
  }
  R.flush = () => { const o = { why: S.why, E: [...S.m.values()], queuedS: S.queuedS, launches: S.launches, mode: S.mode, hasBase: !!(WW.islandBase && WW.islandBase.base), closed: WW.landGround && WW.landGround.stats ? WW.landGround.stats.launchClosed : 0 }; fresh(); return o; };
}

(async () => {
  const list = []; for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(spec(sc, s));
  const b = await HL.launch(), res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(install);
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { window.__beh.run(sp); return window.__bl.flush(); }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  const qs = (a, q) => { if (!a.length) return '-'; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
  const R = res.filter(r => r.hasBase);
  for (const grp of ['bomb', 'fighter']) {
    const E = [].concat(...R.map(r => r.E)).filter(e => (grp === 'bomb') === e.bomb);
    const up = E.filter(e => e.tAir !== null), wait = up.map(e => e.tAir - e.t0), never = E.filter(e => e.tAir === null);
    const ph = {}; for (const e of E) for (const k in e.ph) ph[k] = (ph[k] || 0) + e.ph[k];
    const tot = Object.entries(ph).filter(([k]) => !k.startsWith('mode:')).reduce((s, [, v]) => s + v, 0);
    console.log(`${grp === 'bomb' ? 'bombers' : 'fighters'}: ${E.length} started out in ${R.length} rounds with a base; airborne ${up.length}, never got off ${never.length} (lost ${never.filter(e => e.end === 'lost').length})`);
    console.log(`   field to airborne p50 ${qs(wait, 0.5)} p90 ${qs(wait, 0.9)} max ${qs(wait, 1)} s; ground time by phase: ${Object.entries(ph).filter(([k]) => !k.startsWith('mode:')).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + (100 * v / Math.max(1, tot)).toFixed(0) + '%').join(', ')}; by field mode: ${Object.entries(ph).filter(([k]) => k.startsWith('mode:')).map(([k, v]) => k.slice(5) + ' ' + (100 * v / Math.max(1, tot)).toFixed(0) + '%').join(', ')}`);
  }
  const qS = R.reduce((s, r) => s + r.queuedS, 0), L = R.reduce((s, r) => s + r.launches, 0);
  console.log(`launch rate while planes queued: ${(60 * L / Math.max(1, qS)).toFixed(1)} per minute (${L} launches in ${qS.toFixed(0)} queued s); field mode while queued: ${JSON.stringify(R.reduce((m, r) => { for (const k in r.mode) m[k] = (m[k] || 0) + r.mode[k]; return m; }, {}))}`);
  console.log('warm planes held, by reason (plane-s): ' + JSON.stringify(R.reduce((m, r) => { for (const k in r.why) m[k] = (m[k] || 0) + r.why[k]; return m; }, {})));
  const worst = R.map(r => ({ r, n: r.E.filter(e => e.tAir === null && e.bomb).length })).sort((a, b) => b.n - a.n).slice(0, 5);
  console.log('most bombers never off: ' + worst.map(w => `${w.r.scen}:${w.r.seed} ${w.n}`).join(', '));
})().catch(e => { console.error(e); process.exit(1); });
