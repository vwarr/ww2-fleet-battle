// Air torpedo runs, start of the anvil set-up to the drop or the end of the sortie (read-only recorder, no WW.rand,
// no writes to sim objects): set-up time (anvil start -> the run), run time, passes (came round still armed), and how
// each armed sortie ended: drop / shot down / jettisoned / target gone (sunk, lost) / turned home armed (bingo, other)
// / off the map break-off / round end. Usage: node tests/torp_runs.js [--seeds N=8] [--seed0 S=1] [--only a,b] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const P2 = require('./planes2_review');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,midway,cvpt,odd').split(',');

function install() {
  const R = window.__tr = {};
  let S = null;
  const fresh = () => { S = { m: new Map(), done: [], jet: new WeakSet() }; };
  fresh(); WW.on('roundStart', fresh);
  WW.on('airOrder', e => { if (e && e.order === 'jettison' && e.plane) S.jet.add(e.plane); });
  WW.on('weaponDropped', e => { const p = e && e.plane, E = p && S.m.get(p); if (E && p.kind === 'torpedo') { E.end = 'drop'; E.tEnd = WW.game.roundTime; } });
  const off = p => p.x < -30 || p.z < -30 || p.x > WW.cfg.MAP_W + 30 || p.z > WW.cfg.MAP_H + 30;
  let next = 0;
  WW.on('roundStart', () => { next = 0; });
  const U0 = WW.air.update;
  WW.air.update = function () { const r0 = U0.apply(this, arguments); if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += 0.25; R.sample(); } return r0; };
  R.sample = () => {
    const t = WW.game.roundTime;
    for (const p of WW.world.planes) {
      if (p.kind !== 'torpedo' || p.carrier && p.carrier.isBase) continue;
      let E = S.m.get(p);
      if (!E && p.alive && p.ordnance && p.sk === 'anvil') { E = { t0: t, run: null, passes: 0, wasRun: false, offMap: 0, tgt: p.target ? p.target.type : null, n: p.nation, x0: Math.round(p.x), z0: Math.round(p.z) }; S.m.set(p, E); }
      if (!E || E.end) continue;
      E.last = p.state + '/' + (p.phase || '-') + '/' + (p.sk || '-') + (p.target ? '/' + p.target.type + (p.target.alive ? '' : ' dead') + (p.target.submerged ? ' sub' : '') : '/no tgt') + ' ' + Math.round(p.x) + ',' + Math.round(p.z);
      if (p.phase === 'run') { if (E.run === null) E.run = t; E.wasRun = true; }
      if (E.wasRun && p.phase !== 'run' && p.ordnance) { E.wasRun = false; if (off(p)) E.offMap++; else if (p.phase === 'out') E.passes++; }
      if (!p.alive || p.removed || p.state === 'ditch' || p.deathMode) { E.end = p.ordnance ? 'shot down' : 'drop'; E.tEnd = t; continue; }
      if ((p.state === 'landing' || p.state === 'rollout' || p.deckPh) && p.ordnance) { E.end = p.nightRecall ? 'landed armed (night recall)' : 'landed armed'; E.tEnd = t; continue; }
      if (p.state === 'return' && p.ordnance) {
        const tg = p.target;
        E.end = S.jet.has(p) ? 'jettison' : p.nightRecall ? 'night recall' : !tg || !tg.alive || tg.sinking ? 'target gone' : p.fuel < 30 ? 'bingo / fuel' : 'home armed (other)'; E.tEnd = t;
      }
    }
  };
  R.flush = () => { for (const E of S.m.values()) { if (!E.end) { E.end = 'round end'; E.tEnd = WW.game.roundTime; } S.done.push(E); } const o = S.done; fresh(); return o; };
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
      res.push(...await p.evaluate(spec => { window.__beh.run(spec); return __tr.flush().map(e => Object.assign(e, { scen: spec.scen, seed: spec.seed })); }, spec));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close();
  console.log('');
  const N = res.length, by = {};
  for (const e of res) by[e.end] = (by[e.end] || 0) + 1;
  const qs = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
  console.log(`torpedo sorties that began an anvil set-up: ${N} in ${list.length} rounds`);
  console.log('ends: ' + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${(100 * v / N).toFixed(0)}%)`).join(', '));
  const S1 = res.filter(e => e.run !== null).map(e => e.run - e.t0), A = res.filter(e => e.end !== 'drop').map(e => e.tEnd - e.t0);
  console.log(`set-up (anvil start -> run) p50 ${qs(S1, 0.5)} p90 ${qs(S1, 0.9)} max ${qs(S1, 1)} s (n ${S1.length}); never reached the run: ${res.filter(e => e.run === null).length}`);
  console.log(`came round still armed (passes): ${res.reduce((s, e) => s + e.passes, 0)}; off-map break-offs: ${res.reduce((s, e) => s + e.offMap, 0)} in ${res.filter(e => e.offMap).length} sorties`);
  console.log(`not dropped: time from anvil start to the end p50 ${qs(A, 0.5)} p90 ${qs(A, 0.9)} s`);
  const nd = res.filter(e => e.run === null && e.end !== 'drop'); const why = {}; for (const e of nd) why[e.end] = (why[e.end] || 0) + 1;
  console.log('never reached the run, by end: ' + JSON.stringify(why));
  const RE = res.filter(e => e.end === 'round end');
  console.log('round-end sorties: ' + RE.length + ', time in the attack p50 ' + qs(RE.map(e => e.tEnd - e.t0), 0.5) + ' p90 ' + qs(RE.map(e => e.tEnd - e.t0), 0.9) + '; examples: ' + RE.sort((a, b) => (b.tEnd - b.t0) - (a.tEnd - a.t0)).slice(0, 8).map(e => `${e.scen}:${e.seed} t0=${e.t0.toFixed(0)} ${(e.tEnd - e.t0).toFixed(0)}s ${e.run === null ? 'no run' : 'run at +' + (e.run - e.t0).toFixed(0)} passes ${e.passes} tgt ${e.tgt} ${e.n} last ${e.last || ''}`).join(' | '));
  const long = res.filter(e => e.run !== null && e.run - e.t0 > 60).slice(0, 8);
  console.log('slow set-ups (> 60 s): ' + long.map(e => `${e.scen}:${e.seed} t0=${e.t0} ${(e.run - e.t0).toFixed(0)}s tgt ${e.tgt} at ${e.x0},${e.z0}`).join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
