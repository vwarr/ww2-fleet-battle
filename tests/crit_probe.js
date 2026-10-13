// Critical-hit probe (ship_fires.js magazines, ship_deck.js flight-deck mission kills): per round and per ship type,
// the heavy hits (torpedo, bomb, big shell), the magazine explosions and their expected number (WW.shipFires.magP
// summed over every heavy hit: a low-noise rate), the deck-load explosions, the decks put out of action, how long
// they stayed out, and the planes diverted or ditched because of it; how a holed carrier's round ended (patched,
// sunk, withdrew off the map, still out), the search planes (and scouts) caught by a holed deck, and the planes still
// waiting below / stuck in the stack of a carrier whose deck is out for good at the round's end.
// Usage: node tests/crit_probe.js [--scen standard,battle_line] [--seeds 12] [--seed0 1] [--workers N]
'use strict';
const HL = require('./headless'), SB = require('./sim_behaviour');
const A = HL.argv, arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const SCENS = arg('--scen', 'standard,battle_line').split(','), SEEDS = +arg('--seeds', 12), SEED0 = +arg('--seed0', 1);

function hook() {
  const P = window.__crit = { outs: new Map(), fate: { back: 0, sunk: 0, withdrew: 0, end: 0 }, srch: { div: 0, ditch: 0 }, scoutHoled: 0, fuelHoled: 0, hits: {}, mag: {}, exp: {}, deckHit: 0, hangar: 0, deckOut: 0, perm: 0, outT: [], div: 0, ditch: 0, cvLost: 0 };
  const inc = (o, k, v) => { o[k] = (o[k] || 0) + (v === undefined ? 1 : v); };
  WW.on('shipHit', e => {
    const s = e.ship; if (!s || !s.alive || s.hp <= 0 || s.type === 'submarine' || WW.game.state !== 'battle') return;
    if (!(e.kind === 'torpedo' || e.kind === 'bomb' || e.cal === 'big')) return;
    inc(P.hits, s.type);
    const F = WW.shipFires; if (F && F.magP) inc(P.exp, s.type, F.magP(s, e.kind, e.cal, e.x, e.z));
  });
  WW.on('magazine', e => inc(P.mag, e.ship.type));
  WW.on('shipSunk', s => { if (s && s.type === 'carrier' && !s.isBase) P.cvLost++; });
  WW.on('deckHit', e => { P.deckHit++; if (e.hangar) P.hangar++; });
  WW.on('deckOut', e => { P.deckOut++; if (e.perm) P.perm++; if (e.hits === 1 || !P.outs.has(e.ship)) P.outs.set(e.ship, WW.time.now); });
  WW.on('shipSunk', s => { if (P.outs.has(s)) { P.fate.sunk++; P.outs.delete(s); } });
  WW.on('deckBack', e => { if (P.outs.has(e.ship)) { P.fate.back++; P.outs.delete(e.ship); } });
  WW.on('deckBack', e => { if (e && e.out > 0) P.outT.push(e.out); });
  WW.on('airOrder', e => { if (e && e.order === 'ditchBy' && e.why === 'fuelDitch' && e.plane && e.plane.carrier && e.plane.carrier.deckOut) P.fuelHoled++; });   // held over a shut deck until the fuel ran out
  WW.on('shipEscaped', s => { if (P.outs.has(s)) { P.fate.withdrew++; P.outs.delete(s); } });
  WW.on('airOrder', e => { if (!e || !e.plane || !e.plane._deckOutDiv) return; if (e.order === 'divert') { P.div++; if (e.plane.search) P.srch.div++; } else if (e.order === 'ditchBy') { P.ditch++; if (e.plane.search) P.srch.ditch++; } });
}

(async () => {
  const b = await HL.launch();
  const pages = [];
  for (let k = 0; k < HL.WORKERS; k++) {
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game);
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(hook);
    pages.push(p);
  }
  for (const name of SCENS) {
    const sc = SB.SCEN.find(s => s.name === name), specs = [];
    for (let i = 0; i < SEEDS; i++) {
      const seed = SEED0 + i;
      specs.push(sc.random ? { seed, random: true, light: true } : { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, light: true, base: sc.base || null });
    }
    const rows = new Array(specs.length); let next = 0;
    await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; rows[i] = await pg.evaluate(s => {
      const P = window.__crit; for (const k of ['hits', 'mag', 'exp']) P[k] = {}; P.deckHit = P.hangar = P.deckOut = P.perm = P.div = P.ditch = P.cvLost = 0; P.outT = []; P.outs.clear(); P.fate = { back: 0, sunk: 0, withdrew: 0, end: 0 }; P.srch = { div: 0, ditch: 0 }; P.scoutHoled = 0; P.fuelHoled = 0;
      const r = window.__beh.run(s); P.fate.end = P.outs.size; P.outs.clear();
      // at the round's end: planes still waiting below (queued launchers, launch-queue entries) or in the air bound
      // for a carrier whose deck is out for good
      let qd = 0, qq = 0, stuck = 0;
      for (const sh of WW.world.ships) if (sh.alive && sh.deckOut && sh.deckOut.perm) {
        if (sh._deck) qd += sh._deck.launchers.filter(p => p.alive && !p.removed && p.deckPh === 'queued').length;
        if (sh.ai && sh.ai.queue) qq += sh.ai.queue.length;
      }
      for (const p of WW.world.planes) if (p.alive && !p.removed && p.carrier && p.carrier.deckOut && p.carrier.deckOut.perm && !p.ditchTo && (p.state === 'return' || p.state === 'landing')) stuck++;
      for (const p of WW.world.planes) if (p.alive && p.kind === 'scout' && p.carrier && p.carrier.deckOut) P.scoutHoled++;
      const open = []; for (const sh of WW.world.ships) if (sh.deckOut) open.push(+(WW.time.now - sh.deckOut.t0).toFixed(0));
      const cv = Object.keys(r.comp || {}).filter(k => k.endsWith(':carrier')).reduce((a, k) => a + r.comp[k], 0), cvLost = P.cvLost;
      return { seed: s.seed, winner: r.winner, len: r.len, cv, cvLost, open, qd, qq, stuck, P: JSON.parse(JSON.stringify(P)) };
    }, specs[i]); } }));
    const T = { hits: {}, mag: {}, exp: {} }, F = { back: 0, sunk: 0, withdrew: 0, end: 0 }, S = { deckHit: 0, hangar: 0, deckOut: 0, perm: 0, div: 0, ditch: 0, cv: 0, cvLost: 0, outT: [], open: [], qd: 0, qq: 0, stuck: 0, sDiv: 0, sDitch: 0, scout: 0, fuel: 0 }, W = {};
    for (const r of rows) {
      for (const k of ['hits', 'mag', 'exp']) for (const t in r.P[k]) T[k][t] = (T[k][t] || 0) + r.P[k][t];
      for (const k of ['deckHit', 'hangar', 'deckOut', 'perm', 'div', 'ditch']) S[k] += r.P[k];
      for (const k in F) F[k] += r.P.fate[k];
      S.qd += r.qd; S.qq += r.qq; S.stuck += r.stuck; S.sDiv += r.P.srch.div; S.sDitch += r.P.srch.ditch; S.scout += r.P.scoutHoled; S.fuel += r.P.fuelHoled;
      S.cv += r.cv; S.cvLost += r.cvLost; S.outT.push(...r.P.outT); S.open.push(...r.open); W[r.winner || 'draw'] = (W[r.winner || 'draw'] || 0) + 1;
      console.log(`  ${name} seed ${r.seed}: ${r.winner || 'draw'} ${r.len}s  hits ${JSON.stringify(r.P.hits)} mag ${JSON.stringify(r.P.mag)} deckHit ${r.P.deckHit} deckOut ${r.P.deckOut}`);
    }
    const n = rows.length, magN = Object.values(T.mag).reduce((a, b) => a + b, 0), expN = Object.values(T.exp).reduce((a, b) => a + b, 0);
    console.log(`== ${name} (${n} rounds) wins ${JSON.stringify(W)}  carriers lost ${S.cvLost}/${S.cv}`);
    console.log(`   heavy hits by type ${JSON.stringify(T.hits)}`);
    console.log(`   magazines ${magN} (${(magN / n).toFixed(2)}/round) by type ${JSON.stringify(T.mag)};  expected ${expN.toFixed(2)} (${(expN / n).toFixed(2)}/round) ` +
      JSON.stringify(Object.fromEntries(Object.entries(T.exp).map(([k, v]) => [k, +v.toFixed(2)]))));
    const out = S.outT.slice().sort((a, b) => a - b).map(v => Math.round(v));
    console.log(`   decks out, how it ended: patched ${F.back}, sunk ${F.sunk}, withdrew ${F.withdrew}, still out at the round's end ${F.end}`);
    console.log(`   holed-deck searchers diverted ${S.sDiv}, ditched ${S.sDitch}; scouts on a holed ship ${S.scout}; out of fuel over a shut deck ${S.fuel};  at the end on decks out for good: queued below ${S.qd}, launch-queue entries ${S.qq}, planes still bound for them ${S.stuck}`);
    console.log(`   deck-load explosions ${S.deckHit} (hangar ${S.hangar}); decks out ${S.deckOut} (${(S.deckOut / n).toFixed(2)}/round, perm ${S.perm}); ` +
      `back after ${out.length ? out[0] + '/' + out[out.length >> 1] + '/' + out[out.length - 1] + ' s' : '-'}; still out at the end ${S.open.length}; planes diverted ${S.div}, ditched ${S.ditch}`);
  }
  await b.close();
})();
