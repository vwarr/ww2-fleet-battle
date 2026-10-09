// Torpedo review: how deadly torpedoes are, per launcher (aircraft, destroyer / cruiser tubes, submarine, PT boat)
// and nation, over seeded rounds (sim-only, node runner by default). Read-only recorder (bus events only, no WW.rand).
//   hit rate        hits / fired (duds counted apart: a dud reaches a hull and does nothing)
//   dmg / hit       direct hp per torpedo hit, as a share of the target's max hp, by target type
//   anvil           aerial attacks (torpedoes of one nation dropped at one ship within 25 s): share with >= 1 hit,
//                   hits per attack; combed: the target was combing a track when the torpedo ran out / hit
//   follow-on       per torpedoed ship: speed factor after the hit, list, hp lost to fire / flooding after it
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
  surface: { A: ['battleship', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'submarine'], B: ['battleship', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'submarine'] }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  if (!sc) throw new Error('torpedo_review: unknown scenario ' + name);
  const s = sc.random ? { seed, random: true, light: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  s.scen = name;
  return s;
}

// ---- the in-page recorder ----
function install() {
  const R = window.__trec = { cur: null };
  const now = () => WW.time.now;
  const src = p => (p.src === 'Air' ? 'air' : p.owner && p.owner.type === 'submarine' ? 'sub' : p.owner && p.owner.type === 'pt' ? 'pt' : 'ship');
  function fresh() { return { shots: [], hits: [], ships: {}, attacks: [], err: 0 }; }
  function ship(s) {
    const C = R.cur, k = s.id;
    return C.ships[k] || (C.ships[k] = { id: k, type: s.type, nation: s.nation, maxHp: s.maxHp, torp: 0, torpDmg: 0, other: 0, firstT: null, sunkT: null, killer: null, lastT: -1, lastKind: null, hp0: null, spd: [], burnAfter: 0 });
  }
  WW.on('roundStart', () => { R.cur = fresh(); });
  WW.on('weaponDropped', e => {
    try {
      const C = R.cur; if (!C || !e || e.kind !== 'torpedo' || !e.proj) return;
      const p = e.proj, t = p.src === 'Air' && e.plane && e.plane.target && e.plane.target.stats ? e.plane.target : null;
      const sh = { i: C.shots.length, t: now(), n: p.nation, src: src(p), dud: !!p.dud, tgt: t ? t.id : null, tgtType: t ? t.type : null, res: null, onType: null, combed: null };
      p.__trI = sh.i; p.__trRound = C; C.shots.push(sh);
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
      const tg = sh.tgt !== null ? WW.world.ships.find(s => s.id === sh.tgt) : null;
      sh.combed = tg && tg.ai ? (tg.ai.combUntil || 0) > sh.t : null;
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
      const S = ship(s); S.sunkT = now(); S.killer = S.lastT === now() ? S.lastKind : 'fire/flood';
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
  let o;
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
  say('\nsinkings');
  out.sink = {};
  const tk = s => s.sunkT !== null && (s.killer === 'torpedo' || s.torpDmg >= 0.5 * (s.torpDmg + s.other));
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
  for (const sc of ONLY) { const rr = res.filter(r => r.scen === sc); console.log(`\n--- ${sc}`); console.log(report(rr).text.split('\n').filter(l => /hit rate|air |ship |sub |pt |carrier|battleship|cruiser|scored/.test(l)).join('\n')); }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), args: argv, summary: R.out, rounds: res }, null, 0));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
})().catch(e => { console.error(e); process.exit(1); });
