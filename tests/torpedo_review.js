// Torpedo review: how deadly torpedoes are, per launcher (aircraft, destroyer / cruiser tubes, submarine, PT boat)
// and nation, over seeded rounds (sim-only, node runner by default). Read-only recorder (bus events only, no WW.rand).
//   hit rate        hits / fired (duds counted apart: a dud reaches a hull and does nothing)
//   dmg / hit       direct hp per torpedo hit, as a share of the target's max hp, by target type
//   anvil           aerial attacks (torpedoes of one nation dropped at one ship within 25 s): share with >= 1 hit,
//                   hits per attack; combed: the target was combing a track when the torpedo ran out / hit
//   follow-on       per torpedoed ship: speed factor after the hit, list, hp lost to fire / flooding after it
//   spotting        per torpedo: seen by a ship of the side it ran at (event 'torpedoSeen' { proj, ship, d }: intel.js), the
//                   distance of the first sighting; hits seen beforehand by the ship they hit
//   combing         comb attempts (event 'torpedoComb' { proj, ship }: ships_ai.js comb / ai_surface.js earlyComb, one per
//                   ship and torpedo) and successes (the combing ship was not hit by that torpedo); |sin| of the angle
//                   between the hull and the track at a hit (0 = combed, 1 = beam on)
//   PT launches     per PT spread (torpedoes from one boat within 1 s): the range to the boat's target at the launch,
//                   the target angle (the bearing of the boat off the target's bow: 0 dead ahead, 90 the beam, 180
//                   astern), the target's speed, the spread's hits; PT boats lost per round
//   sinkings        ships sunk with >= 1 torpedo hit; "by torpedo" = the fatal blow was a torpedo or torpedoes did
//                   >= 50% of the direct damage; time from the first torpedo hit to sinking; hits to sink a CV / BB
// Usage: node tests/torpedo_review.js [--seeds N=12] [--seed0 S=1] [--only standard,carrier_duel,midway,surface]
//          [--workers K] [--json FILE] [--browser | --render]
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');

const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 12), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', 'standard,carrier_duel,midway,surface').split(',');
const JSON_OUT = arg('--json', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  surface: { A: ['battleship', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'submarine'], B: ['battleship', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'submarine'] },
  // PT boats against a surface force (the Solomons): four boats a side with a cruiser force, by day and by night
  pt: { A: ['cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'pt', 'pt'], B: ['cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'pt', 'pt'] },
  pt_night: { A: ['cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'pt', 'pt'], B: ['cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'pt', 'pt'], tod: 'night' }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  if (!sc) throw new Error('torpedo_review: unknown scenario ' + name);
  const s = sc.random ? { seed, random: true, light: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  s.scen = name; if (sc.tod) s.tod = sc.tod;
  return s;
}

// ---- the in-page recorder ----
function install() {
  const R = window.__trec = { cur: null };
  const now = () => WW.time.now;
  const src = p => (p.src === 'Air' ? 'air' : p.owner && p.owner.type === 'submarine' ? 'sub' : p.owner && p.owner.type === 'pt' ? 'pt' : 'ship');
  function fresh() { return { shots: [], hits: [], ships: {}, attacks: [], pt: [], ptN: { USN: 0, IJN: 0 }, ptLost: { USN: 0, IJN: 0 }, err: 0 }; }
  function ship(s) {
    const C = R.cur, k = s.id;
    return C.ships[k] || (C.ships[k] = { id: k, type: s.type, nation: s.nation, maxHp: s.maxHp, torp: 0, torpDmg: 0, other: 0, firstT: null, sunkT: null, killer: null, lastT: -1, lastKind: null, hp0: null, spd: [], burnAfter: 0 });
  }
  WW.on('roundStart', () => { R.cur = fresh(); });
  R.countPt = function () { const C = R.cur; if (!C) return; for (const s of WW.world.ships) if (s.type === 'pt' && C.ptN[s.nation] !== undefined) C.ptN[s.nation]++; };
  WW.on('weaponDropped', e => {
    try {
      const C = R.cur; if (!C || !e || e.kind !== 'torpedo' || !e.proj) return;
      const p = e.proj, t = p.src === 'Air' && e.plane && e.plane.target && e.plane.target.stats ? e.plane.target : null;
      const sh = { i: C.shots.length, t: now(), n: p.nation, src: src(p), dud: !!p.dud, tgt: t ? t.id : null, tgtType: t ? t.type : null, res: null, onType: null, combed: null,
        seen: 0, seenD: null, seenBy: [], combs: [], hitSeen: null, hitPar: null };
      p.__trI = sh.i; p.__trRound = C; C.shots.push(sh);
      if (sh.src === 'pt') { // a PT spread: one entry per boat and launch
        const o = p.owner, u = o.ai && o.ai.lt && o.ai.lt.tgt && o.ai.lt.tgt.stats ? o.ai.lt.tgt : o.target && o.target.stats ? o.target : null;
        let L = C.pt.find(q => q.id === o.id && sh.t - q.t < 1);
        if (!L) {
          L = { id: o.id, n: p.nation, t: sh.t, shots: [], tgtType: u ? u.type : null, r: null, ang: null, spd: null, night: (WW.daylight === undefined ? 1 : WW.daylight) < 0.3, state: o.ai && o.ai.lt ? o.ai.lt.state : null };
          if (u) { L.r = +WW.dist(o.x, o.z, u.x, u.z).toFixed(1); L.ang = +(Math.abs(WW.angleDiff(u.heading, Math.atan2(o.z - u.z, o.x - u.x))) * 180 / Math.PI).toFixed(0); L.spd = +(u.speed || 0).toFixed(2); }
          C.pt.push(L);
        }
        L.shots.push(sh.i);
      }
      if (t) { // group aerial torpedoes into attacks on one ship
        let a = C.attacks.find(a => a.tgt === t.id && a.n === p.nation && sh.t - a.t1 < 25);
        if (!a) { a = { tgt: t.id, type: t.type, n: p.nation, t0: sh.t, t1: sh.t, shots: [] }; C.attacks.push(a); }
        a.t1 = sh.t; a.shots.push(sh.i);
      }
    } catch (x) { if (R.cur) R.cur.err++; }
  });
  WW.on('weaponImpact', e => {
    try {
      const C = R.cur; if (!C || !e || e.kind !== 'torpedo' || !e.proj || e.proj.__trRound !== C) return;
      const sh = C.shots[e.proj.__trI]; if (!sh || sh.res) return;
      sh.res = e.ship ? (e.dud ? 'dud' : 'hit') : 'miss'; sh.onType = e.ship ? e.ship.type : null;
      if (e.ship) { sh.hitSeen = sh.seen > 0 && sh.seenBy.indexOf(e.ship.id) >= 0; sh.hitSeenSide = sh.seen > 0; sh.hitPar = +Math.abs(Math.sin(e.ship.heading - e.proj.h)).toFixed(2); sh.hitId = e.ship.id; }
      for (const c of sh.combs) c.ok = !e.ship || e.ship.id !== c.id;
      const tg = sh.tgt !== null ? WW.world.ships.find(s => s.id === sh.tgt) : null, p = e.proj;
      sh.combed = tg && tg.ai ? (tg.ai.combUntil || 0) > sh.t : null;
      if (sh.res === 'miss' && tg) { // why: ran out short of the target (outrun / dropped too far), passed it (wide / combed), or land
        const c = Math.cos(p.h), sn = Math.sin(p.h), rx = tg.x - p.x, rz = tg.z - p.z, along = rx * c + rz * sn, perp = Math.abs(-rx * sn + rz * c);
        const par = Math.abs(Math.sin(tg.heading - p.h));   // 0 parallel to the track (combed), 1 broadside on
        sh.why = !tg.alive || tg.sinking ? 'gone' : p.run < p.range - 0.5 ? 'land' : along > 0 ? 'short' : 'passed';
        sh.along = +along.toFixed(1); sh.perp = +perp.toFixed(1); sh.par = +par.toFixed(2); sh.run = +p.run.toFixed(0);
      }
    } catch (x) { if (R.cur) R.cur.err++; }
  });
  // spotting and combing (intel.js 'torpedoSeen', ships_ai.js / ai_surface.js 'torpedoComb')
  WW.on('torpedoSeen', e => {
    try {
      const C = R.cur; if (!C || !e || !e.proj || e.proj.__trRound !== C) return;
      const sh = C.shots[e.proj.__trI]; if (!sh || sh.res) return;
      const id = e.ship ? e.ship.id : -1; if (sh.seenBy.indexOf(id) >= 0) return;
      sh.seenBy.push(id); if (!sh.seen) sh.seenD = +(+e.d || 0).toFixed(1); sh.seen++;
    } catch (x) { if (R.cur) R.cur.err++; }
  });
  WW.on('torpedoComb', e => {
    try {
      const C = R.cur; if (!C || !e || !e.proj || !e.ship || e.proj.__trRound !== C) return;
      const sh = C.shots[e.proj.__trI]; if (!sh || sh.res || sh.combs.some(c => c.id === e.ship.id)) return;
      sh.combs.push({ id: e.ship.id, type: e.ship.type, ok: null });
    } catch (x) { if (R.cur) R.cur.err++; }
  });
  WW.on('shipHit', e => {
    try {
      const C = R.cur; if (!C || !e || !e.ship || !(e.amount > 0)) return;
      const S = ship(e.ship);
      if (e.kind === 'torpedo') {
        S.torp++; S.torpDmg += e.amount; if (S.firstT === null) { S.firstT = now(); S.hp0 = e.ship.hp + e.amount; }
        C.hits.push({ type: e.ship.type, n: e.ship.nation, frac: e.amount / e.ship.maxHp, t: now(), id: e.ship.id });
      } else S.other += e.amount;
      S.lastT = now(); S.lastKind = e.kind;
    } catch (x) { if (R.cur) R.cur.err++; }
  });
  WW.on('shipSunk', s => {
    try {
      const C = R.cur; if (!C || !s) return;
      if (s.type === 'pt' && C.ptLost[s.nation] !== undefined) C.ptLost[s.nation]++;
      const S = ship(s); S.sunkT = now(); S.killer = s.capsized ? 'capsize' : S.lastT === now() ? S.lastKind : (s.floodHp || 0) > 0 && s.breach > 0 ? 'flooding' : 'fire/flood';
      S.torpDmg += s.floodHp || 0;   // hp lost to torpedo breaches (ship_fires.js) counts as torpedo damage
    } catch (x) { if (R.cur) R.cur.err++; }
  });
  // sample torpedoed ships once a sim second: speed factor and list, 5 / 20 s after the first hit
  R.tick = function () {
    const C = R.cur; if (!C) return;
    for (const k in C.ships) {
      const S = C.ships[k]; if (S.firstT === null) continue;
      const s = WW.world.ships.find(x => x.id === S.id); if (!s) continue;
      const dt = now() - S.firstT;
      if (s.alive && S.spd.length < 2 && dt >= (S.spd.length ? 20 : 5)) S.spd.push({ k: +(s.speedK || 1).toFixed(3), list: +Math.abs((s.listRoll || 0) + (s.cripList ? s.cripList() : 0)).toFixed(3), hp: +(s.hp / s.maxHp).toFixed(3) });
    }
  };
  R.flush = function () {
    const C = R.cur; R.cur = null; if (!C) return null;
    return C;
  };
}
function runPage(spec) {
  const B = window.__beh, R = window.__trec;
  // drive the round in 1 s chunks so the recorder can sample (the harness's own loop is __beh.run)
  const orig = __sim.fastForward;
  __sim.fastForward = function (s) { let left = s; while (left > 0) { const d = Math.min(1, left); orig.call(__sim, d); left -= d; R.tick(); } };
  let o, first = true;
  const f0 = __sim.fastForward;
  __sim.fastForward = function (s) { if (first) { first = false; R.countPt(); } return f0.call(this, s); };
  try { o = B.run(spec); } finally { __sim.fastForward = orig; }
  return { winner: o.winner, len: o.len, comp: o.comp, rec: R.flush() };
}

// ---- report ----
const qs = (arr, q) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const med = a => qs(a, 0.5), mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f2 = v => (v === null || v === undefined || Number.isNaN(v) ? '-' : (+v).toFixed(2)), f0 = v => (v === null || v === undefined ? '-' : (+v).toFixed(0));
const pc = v => (v === null || v === undefined || Number.isNaN(v) ? '-' : (100 * v).toFixed(0) + '%');
function report(rounds) {
  const L = [], say = s => L.push(s), out = {};
  const shots = rounds.flatMap(r => r.rec.shots), hits = rounds.flatMap(r => r.rec.hits);
  const ships = rounds.flatMap(r => Object.values(r.rec.ships)), attacks = rounds.flatMap(r => r.rec.attacks.map(a => ({ a, shots: r.rec.shots })));
  say(`TORPEDO REVIEW: ${rounds.length} rounds (${[...new Set(rounds.map(r => r.scen))].map(s => s + ' ' + rounds.filter(r => r.scen === s).length).join(', ')}); recorder errors ${rounds.reduce((s, r) => s + r.rec.err, 0)}`);
  say('\nhit rate by launcher (fired / hits / duds / misses; hit rate = hits / fired)');
  out.rate = {};
  for (const sc of ['air', 'ship', 'sub', 'pt']) for (const n of ['USN', 'IJN']) {
    const S = shots.filter(s => s.src === sc && s.n === n); if (!S.length) continue;
    const h = S.filter(s => s.res === 'hit').length, d = S.filter(s => s.res === 'dud').length;
    out.rate[sc + ':' + n] = { fired: S.length, hits: h, duds: d, rate: h / S.length };
    say(`  ${(sc + ' ' + n).padEnd(9)} fired ${String(S.length).padStart(5)}  hits ${String(h).padStart(4)}  duds ${String(d).padStart(3)}  hit rate ${pc(h / S.length)}`);
  }
  for (const n of ['USN', 'IJN']) {
    const M = shots.filter(s => s.src === 'air' && s.n === n && s.res === 'miss' && s.why); if (!M.length) continue;
    const k = w => M.filter(s => s.why === w);
    say(`  air ${n} misses: short (ran out before reaching the target) ${pc(k('short').length / M.length)} (target still ${f0(med(k('short').map(s => s.along)))} u ahead p50), ` +
      `passed ${pc(k('passed').length / M.length)} (wide by ${f2(med(k('passed').map(s => s.perp)))} u p50; target parallel-ish |sin| < 0.4: ${pc(k('passed').filter(s => s.par < 0.4).length / (k('passed').length || 1))}), land ${pc(k('land').length / M.length)}, target gone ${pc(k('gone').length / M.length)}`);
  }
  say('\nspotting and combing by launcher (seen: share of torpedoes seen by a ship of the side they ran at; dist p50 / p90 of the first sighting;\n  hits seen: share of hits the ship hit had seen first; combs: attempts per 100 torpedoes, success = that ship not hit by it; |sin| at a hit p50)');
  out.spot = {};
  for (const sc of ['air', 'ship', 'sub', 'pt']) for (const n of ['USN', 'IJN']) {
    const S = shots.filter(s => s.src === sc && s.n === n && s.seen !== undefined); if (!S.length) continue;
    const seen = S.filter(s => s.seen > 0), H = S.filter(s => s.res === 'hit' || s.res === 'dud'), C = S.flatMap(s => s.combs || []);
    const Cok = C.filter(c => c.ok), hs = H.filter(s => s.hitSeen).length;
    out.spot[sc + ':' + n] = { seen: seen.length / S.length, d50: med(seen.map(s => s.seenD)), d90: qs(seen.map(s => s.seenD), 0.9), hitSeen: H.length ? hs / H.length : null, combs: C.length, combPer: C.length / S.length, combOk: C.length ? Cok.length / C.length : null, hitPar: med(H.map(s => s.hitPar).filter(v => v !== null)) };
    const o = out.spot[sc + ':' + n];
    say(`  ${(sc + ' ' + n).padEnd(9)} seen ${pc(o.seen).padStart(4)}  dist ${f0(o.d50)} / ${f0(o.d90)} u  hits seen ${pc(o.hitSeen).padStart(4)}  combs ${f0(100 * o.combPer)} / 100, success ${pc(o.combOk)}  |sin| at hit ${f2(o.hitPar)}`);
  }
  const air = shots.filter(s => s.src === 'air'), airC = air.filter(s => s.combed !== null);
  say(`  aerial torpedoes whose target was combing at the drop or later: ${pc(airC.filter(s => s.combed).length / (airC.length || 1))}; hit rate when combed ${pc(airC.filter(s => s.combed && s.res === 'hit').length / (airC.filter(s => s.combed).length || 1))}, not combed ${pc(airC.filter(s => !s.combed && s.res === 'hit').length / (airC.filter(s => !s.combed).length || 1))}`);
  say('\ndirect damage per torpedo hit (share of the target\'s max hp: p50 / mean; n)');
  out.dmg = {};
  for (const t of ['carrier', 'battleship', 'cruiser', 'destroyer', 'submarine', 'pt']) {
    const H = hits.filter(h => h.type === t).map(h => h.frac); if (!H.length) continue;
    out.dmg[t] = { p50: med(H), mean: mean(H), n: H.length };
    say(`  ${t.padEnd(11)} ${f2(med(H))} / ${f2(mean(H))}  (n ${H.length})`);
  }
  say('\naerial anvil attacks (torpedoes of one side at one ship within 25 s)');
  out.anvil = {};
  for (const n of ['USN', 'IJN']) {
    const A = attacks.filter(x => x.a.n === n); if (!A.length) continue;
    const hitsOf = x => x.a.shots.filter(i => x.shots[i].res === 'hit').length;
    const multi = A.filter(x => x.a.shots.length >= 3);
    out.anvil[n] = { attacks: A.length, scored: A.filter(x => hitsOf(x) > 0).length / A.length, hitsPer: mean(A.map(hitsOf)), multi: multi.length, multiScored: multi.length ? multi.filter(x => hitsOf(x) > 0).length / multi.length : null };
    say(`  ${n}: attacks ${A.length}, torpedoes per attack ${f2(mean(A.map(x => x.a.shots.length)))}, scored ${pc(out.anvil[n].scored)}, hits per attack ${f2(out.anvil[n].hitsPer)};  with >= 3 torpedoes: ${multi.length}, scored ${pc(out.anvil[n].multiScored)}`);
  }
  say('\nafter the first torpedo hit (speed factor / list rad / hp share at +5 s and +20 s, p50)');
  for (const t of ['carrier', 'battleship', 'cruiser', 'destroyer']) {
    const S = ships.filter(s => s.type === t && s.torp > 0 && s.spd.length); if (!S.length) continue;
    const at = i => S.filter(s => s.spd[i]).map(s => s.spd[i]);
    say(`  ${t.padEnd(11)} +5 s: speed ${f2(med(at(0).map(x => x.k)))} list ${f2(med(at(0).map(x => x.list)))} hp ${f2(med(at(0).map(x => x.hp)))}   +20 s: speed ${f2(med(at(1).map(x => x.k)))} list ${f2(med(at(1).map(x => x.list)))} hp ${f2(med(at(1).map(x => x.hp)))}  (n ${S.length})`);
  }
  say('\nPT launches (one per boat and spread; range to its target u, target angle deg off the bow: 0 ahead, 90 beam, 180 astern; p50 [p10-p90])');
  out.pt = {};
  for (const n of ['USN', 'IJN']) {
    const P = rounds.flatMap(r => r.rec.pt.map(q => ({ q, shots: r.rec.shots }))).filter(x => x.q.n === n);
    const boats = rounds.reduce((a, r) => a + (r.rec.ptN ? r.rec.ptN[n] : 0), 0), lost = rounds.reduce((a, r) => a + (r.rec.ptLost ? r.rec.ptLost[n] : 0), 0);
    const ptR = rounds.filter(r => r.rec.ptN && r.rec.ptN[n] > 0).length;
    if (!boats && !P.length) continue;
    const hitsOf = x => x.q.shots.filter(i => x.shots[i].res === 'hit').length, R_ = P.filter(x => x.q.r !== null).map(x => x.q.r), A_ = P.filter(x => x.q.ang !== null).map(x => x.q.ang);
    const hits = P.reduce((a, x) => a + hitsOf(x), 0), fired = P.reduce((a, x) => a + x.q.shots.length, 0), scored = P.filter(x => hitsOf(x) > 0).length;
    const fwd = A_.filter(a => a < 90).length, night = P.filter(x => x.q.night);
    out.pt[n] = { launches: P.length, perRound: ptR ? P.length / ptR : 0, boats, lost, lostPerRound: ptR ? lost / ptR : 0, r50: med(R_), ang50: med(A_), fwd: A_.length ? fwd / A_.length : null, fired, hits, rate: fired ? hits / fired : null, scored: P.length ? scored / P.length : null, night: night.length };
    const o = out.pt[n];
    say(`  ${n}: rounds with PTs ${ptR}, boats ${boats}; launches ${P.length} (${f2(o.perRound)} / round, ${night.length} at night); range ${f0(o.r50)} [${f0(qs(R_, 0.1))}-${f0(qs(R_, 0.9))}] u; target angle ${f0(o.ang50)} [${f0(qs(A_, 0.1))}-${f0(qs(A_, 0.9))}] deg, ahead of the beam ${pc(o.fwd)}; torpedoes ${fired}, hits ${hits} (${pc(o.rate)}), spreads that scored ${pc(o.scored)}; targets ${Object.entries(P.reduce((m, x) => (m[x.q.tgtType] = (m[x.q.tgtType] || 0) + 1, m), {})).map(([k, v]) => k + ' ' + v).join(', ')}; PT lost ${lost} (${f2(o.lostPerRound)} / round, ${pc(boats ? lost / boats : null)} of boats)`);
  }
  say('\nsinkings');
  out.sink = {};
  const tk = s => s.sunkT !== null && (s.killer === 'torpedo' || s.killer === 'flooding' || s.killer === 'capsize' || s.torpDmg >= 0.5 * (s.torpDmg + s.other));
  for (const t of ['carrier', 'battleship', 'cruiser', 'destroyer', 'submarine']) {
    const all = ships.filter(s => s.type === t), torped = all.filter(s => s.torp > 0), sunk = all.filter(s => s.sunkT !== null);
    if (!torped.length && !sunk.length) continue;
    const ts = torped.filter(s => s.sunkT !== null), byT = sunk.filter(tk);
    const tts = ts.map(s => s.sunkT - s.firstT);
    out.sink[t] = { torpedoed: torped.length, sunkAfter: ts.length, sunk: sunk.length, byTorp: byT.length, ttsP50: med(tts), hitsToSink: med(ts.map(s => s.torp)) };
    say(`  ${t.padEnd(11)} torpedoed ${String(torped.length).padStart(4)}, of them sunk ${pc(ts.length / (torped.length || 1))}; all sunk ${sunk.length}, by torpedo ${byT.length} (${pc(byT.length / (sunk.length || 1))}); first torp hit -> sunk p50 ${f0(med(tts))} s (p90 ${f0(qs(tts, 0.9))}); torp hits on the sunk p50 ${f0(med(ts.map(s => s.torp)))}`);
  }
  out.byKiller = {}; for (const s of ships) if (s.sunkT !== null) out.byKiller[s.killer] = (out.byKiller[s.killer] || 0) + 1;
  say('  fatal blow: ' + Object.entries(out.byKiller).map(([k, v]) => k + ' ' + v).join(', '));
  say(`\nrounds: USN ${rounds.filter(r => r.winner === 'USN').length}  IJN ${rounds.filter(r => r.winner === 'IJN').length}  other ${rounds.filter(r => r.winner !== 'USN' && r.winner !== 'IJN').length}; length p50 ${med(rounds.map(r => r.len))} s`);
  return { text: L.join('\n'), out };
}

(async () => {
  const t0 = Date.now(), list = [];
  for (const sc of ONLY) for (let i = 0; i < SEEDS; i++) list.push(specFor(sc, SEED0 + i));
  console.log(`torpedo_review: ${list.length} rounds (${HL.label()})`);
  const b = await HL.launch(), errs = [], res = new Array(list.length);
  let next = 0;
  async function worker() {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install);
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed }, await p.evaluate(runPage, spec));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close();
  process.stdout.write('\n');
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  const R = report(res);
  console.log(R.text);
  for (const sc of ONLY) { const rr = res.filter(r => r.scen === sc); console.log(`\n--- ${sc}`); console.log(report(rr).text.split('\n').filter(l => /hit rate|air |ship |sub |pt |seen|carrier|battleship|cruiser|scored|launches/.test(l)).join('\n')); }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), args: argv, summary: R.out, rounds: res }, null, 0));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
})().catch(e => { console.error(e); process.exit(1); });
