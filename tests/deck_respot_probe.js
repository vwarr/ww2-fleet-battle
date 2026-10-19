// Deck respot probe (sim only, read-only): how the parked planes on a carrier deck move (air_deck.js). Per seeded
// round: deck mode switches, the most parked planes being pushed at once on one deck (not a plane taxiing in from a
// trap or riding an elevator), launches (off the bow) and traps, the mean wait from a launch order to the bow and the
// mean time a returning plane spends in the landing queue.
// Usage: node tests/deck_respot_probe.js [scens=carrier_duel,midway] [seeds=1-4] [sim=600] [--workers N]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const [scArg = 'carrier_duel,midway', seedArg = '1-4', simArg = '600'] = HL.argv;
const SC = {
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' }
};
const seeds = seedArg.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(seedArg.split('-').map(Number)) : seedArg.split(',').map(Number);
const jobs = []; for (const s of scArg.split(',')) for (const sd of seeds) jobs.push([s, sd]);
async function one(b, [scen, sd]) {
  const p = await b.newPage();
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sc = SC[scen];
  const spec = { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true, until: +simArg };
  const r = await p.evaluate((spec) => {
    const M = { sw: 0, maxMov: 0, movT: 0, launches: 0, lw: 0, lqW: 0, lqN: 0, byNat: {} };
    const last = new Map(), seenClimb = new Set(), seenLq = new Map();
    const u0 = WW.airDeck.update.bind(WW.airDeck);
    WW.airDeck.update = function (dt) {
      const before = new Map();
      for (const D of WW.airDeck._k.decks) for (const col of D.cols) for (const e of col.e) before.set(e, e.lx);
      u0(dt);
      if (!WW.game || WW.game.state === 'setup') return;
      for (const D of WW.airDeck._k.decks) {
        if (!D.c.alive) continue;
        const n = D.c.nation, B = M.byNat[n] = M.byNat[n] || { sw: 0, maxMov: 0, L: 0, lw: 0, lqW: 0, lqN: 0, rs: 0, rsT: 0, modeT: {}, qs: [], ls: [], tr: 0 };
        B.modeT[D.mode] = (B.modeT[D.mode] || 0) + dt;
        if (D.spot !== undefined) { if (D.spot !== D.__sp) { D.__sp = D.spot; D.__rs = true; B.rs++; } if (D.__rs) { let still = false; for (const col of D.cols) for (const e of col.e) if (e.ph !== 'in' && Math.abs(e.tx - e.lx) > 0.05) still = true; if (still) B.rsT += dt; else D.__rs = false; } }
        if (last.has(D) && last.get(D) !== D.mode) { M.sw++; B.sw++; }
        last.set(D, D.mode);
        let mov = 0;
        for (const col of D.cols) for (const e of col.e) if (e.ph === 'park' && before.has(e) && Math.abs(e.lx - before.get(e)) > 1e-4) mov++;
        M.maxMov = Math.max(M.maxMov, mov); B.maxMov = Math.max(B.maxMov, mov); if (mov) M.movT += dt;
        for (const q of D.lq) if (!seenLq.has(q)) seenLq.set(q, WW.time.now);
      }
      for (const q of WW.world.planes) if (q.deckPh === 'climb' && !seenClimb.has(q)) { seenClimb.add(q); M.launches++; const B = M.byNat[q.nation]; if (B) B.L++; if (q._qT !== undefined) { M.lw += WW.time.now - q._qT; if (B) { B.lw += WW.time.now - q._qT; B.ls.push(WW.time.now - q._qT); } } }
      for (const [q, t] of seenLq) if (!(q.state === 'landing' && q.alive && !q.removed)) { M.lqW += WW.time.now - t; M.lqN++; const B = M.byNat[q.nation]; if (B) { B.lqW += WW.time.now - t; B.lqN++; if (q.state === 'rollout') { B.qs.push(WW.time.now - t); B.tr++; } } seenLq.delete(q); }
    };
    const l0 = WW.airDeck.launched.bind(WW.airDeck);
    WW.airDeck.launched = function (q) { q._qT = WW.time.now; return l0(q); };
    const o = window.__beh.run(spec);
    return { M, why: WW.airDeck.recovery.why, traps: WW.stats.planesLanded, len: o.len, w: o.winner, aN: spec.aNation };
  }, spec);
  await p.close();
  return { scen, sd, ...r };
}
(async () => {
  const b = await HL.launch(); const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, jobs.length) }, async () => { while (i < jobs.length) { const j = jobs[i++]; out.push(await one(b, j)); } }));
  out.sort((a, b) => a.scen.localeCompare(b.scen) || a.sd - b.sd);
  const N = {}, why = {};
  for (const r of out) for (const k in r.why) why[k] = (why[k] || 0) + r.why[k];
  console.log('wave-offs ' + JSON.stringify(why));
  for (const r of out) for (const n in r.M.byNat) { const a = N[n] = N[n] || { sw: 0, L: 0, lw: 0, lqW: 0, lqN: 0, rs: 0, rsT: 0, modeT: {}, qs: [], ls: [], tr: 0 }, b = r.M.byNat[n]; for (const k in a) if (k === 'qs' || k === 'ls') a[k].push(...b[k]); else if (k !== 'modeT') a[k] += b[k] || 0; for (const k in b.modeT) a.modeT[k] = (a.modeT[k] || 0) + b.modeT[k]; }
  const med = v => { const s = v.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  for (const n in N) { const a = N[n], mt = a.modeT; console.log(`${n} per-plane: landed ${a.tr} queue-to-trap median ${med(a.qs).toFixed(1)}s mean ${(a.qs.reduce((x, y) => x + y, 0) / Math.max(1, a.qs.length)).toFixed(1)}s | launch order-to-bow median ${med(a.ls).toFixed(1)}s | traps per recovery-min ${(a.tr / Math.max(1, mt.recover || 0) * 60).toFixed(2)} launches per launch-min ${(a.L / Math.max(1, mt.launch || 0) * 60).toFixed(2)}`); }
  for (const n in N) { const a = N[n]; console.log(`${n}: switches ${a.sw} launches ${a.L} meanLaunchWait ${(a.lw / Math.max(1, a.L)).toFixed(1)}s queued ${a.lqN} meanQueue ${(a.lqW / Math.max(1, a.lqN)).toFixed(1)}s respots ${a.rs} meanRespot ${(a.rsT / Math.max(1, a.rs)).toFixed(1)}s modeT ${Object.entries(a.modeT).map(([k, v]) => k + ' ' + v.toFixed(0)).join(' ')}`); }
  const T = { sw: 0, launches: 0, traps: 0, lw: 0, lqW: 0, lqN: 0, maxMov: 0, movT: 0 };
  for (const r of out) {
    const M = r.M;
    console.log(`${r.scen} s${r.sd} (A ${r.aN}): len ${(+r.len).toFixed(0)} win ${r.w} | switches ${M.sw} maxMoving ${M.maxMov} movingT ${M.movT.toFixed(0)}s | launches ${M.launches} meanLaunchWait ${(M.lw / Math.max(1, M.launches)).toFixed(1)}s | traps ${r.traps} meanQueue ${(M.lqW / Math.max(1, M.lqN)).toFixed(1)}s | ${Object.entries(M.byNat).map(([n, b]) => n + ' sw ' + b.sw + ' maxMov ' + b.maxMov).join(', ')}`);
    T.sw += M.sw; T.launches += M.launches; T.traps += r.traps; T.lw += M.lw; T.lqW += M.lqW; T.lqN += M.lqN; T.maxMov = Math.max(T.maxMov, M.maxMov); T.movT += M.movT;
  }
  console.log(`TOTAL switches ${T.sw} maxMoving ${T.maxMov} movingT ${T.movT.toFixed(0)}s launches ${T.launches} meanLaunchWait ${(T.lw / Math.max(1, T.launches)).toFixed(1)}s traps ${T.traps} meanQueue ${(T.lqW / Math.max(1, T.lqN)).toFixed(1)}s`);
  await b.close();
})();
