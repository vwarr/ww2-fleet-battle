// Why a side withdraws / breaks off (diagnosis, read-only): every turn to posture 'withdraw' and every break (brokenAt)
// with the picture at that moment: own vs known (and true) enemy strength, carriers fit / holed / wrecked and their
// strike planes, all planes left vs at the start, gun tonnage, the rule that fired, the admiral, the time. Then per
// round how it ended, and a summary: first withdraw per side and its rule, the share taken with a fit carrier and
// more than half the planes, round length, ends, wins.
// Usage: node tests/retreat_probe.js [--only standard,carrier_duel,midway] [--seeds 10] [--seed0 1] [--workers 2] [-v]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const A = HL.argv, arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const ONLY = arg('--only', 'standard,carrier_duel,midway').split(','), SEEDS = +arg('--seeds', 10), SEED0 = +arg('--seed0', 1), VERB = A.includes('-v');
const SCEN = SB.SCEN.filter(s => ONLY.includes(s.name));

function probe(spec) {
  const L = [], WWc = WW, P0 = {}, last = {};
  const GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, POWER = { carrier: 4, battleship: 5, cruiser: 2.5, destroyer: 1.2, submarine: 0.8, pt: 0.4 };
  const strikeN = q => { const h = q.hangar; if (!h) return 0; let k = (h.dive || 0) + (h.torpedo || 0); if (q.rearm) k += q.rearm.filter(r => r.kind !== 'fighter').length; for (const p of WW.world.planes) if (p.alive && p.carrier === q && (p.kind === 'dive' || p.kind === 'torpedo')) k++; return k; };
  const planesOf = n => { let k = 0; for (const s of WW.world.ships) if (s.alive && !s.sinking && s.nation === n && s.type === 'carrier' && s.hangar) { const h = s.hangar; k += (h.fighter || 0) + (h.dive || 0) + (h.torpedo || 0) + (s.rearm ? s.rearm.length : 0); }
    for (const p of WW.world.planes) if (p.alive && p.nation === n && p.carrier && !p.carrier.isBase && p.kind !== 'scout' && p.kind !== 'flyingboat') k++; return k; };
  const crip = () => WW.fleetGroups.CRIP;
  const cvState = n => WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === n && s.type === 'carrier').map(s => {
    const w = WW.shipDeck && WW.shipDeck.wrecked(s), o = s.deckOut && !w, c = s.hp < crip() * s.maxHp;
    return (w ? 'W' : o ? 'O' : c ? 'C' : 'F') + (s.hp / s.maxHp).toFixed(2) + '/' + strikeN(s);
  }).join(',');
  const fitCV = n => WW.world.ships.some(s => s.alive && !s.sinking && s.nation === n && s.type === 'carrier' && s.hp >= crip() * s.maxHp && !(WW.shipDeck && WW.shipDeck.wrecked(s)) && strikeN(s) >= 6);
  const trueStr = n => WW.world.ships.reduce((k, s) => k + (s.alive && s.nation === n ? POWER[s.type] * (WW.shipDeck && WW.shipDeck.wrecked(s) ? 0.4 : 1) * (0.3 + 0.7 * s.hp / s.maxHp) : 0), 0);
  function snap(n, B, why) {
    const e = WW.enemyOf(n), A = WW.admirals && WW.admirals.of(n), pl = planesOf(n), D = WW.dayNight;
    const r = { t: +WW.game.roundTime.toFixed(0), n, why, adm: A ? A.key : '', wr: +B.doctrine.withdrawRatio.toFixed(2), own: +B.strength.own.toFixed(1), known: +B.strength.known.toFixed(1),
      trueFoe: +trueStr(e).toFixed(1), ratio: +B.strength.ratio.toFixed(2), cv: cvState(n), foeCv: cvState(e), planes: pl, planes0: P0[n] || 0,
      fitCV: fitCV(n), gun: +(B.fitTons / Math.max(1, B.startTons)).toFixed(2), foeGun: +(B.foeFit / Math.max(1, B.foeTons)).toFixed(2), met: WW.game.metT, fly: D ? D.canFly() : true };
    r.strong = r.fitCV && r.planes0 > 0 && r.planes > 0.5 * r.planes0;
    return r;
  }
  const u0 = WW.fleetCmd.update;
  WW.fleetCmd.update = function (dt) {
    const pre = {}; for (const n of WW.sides()) { const B = WW.fleetCmd.side(n); if (B) pre[n] = { p: B.posture, b: B.brokenAt }; }
    const r = u0.apply(this, arguments);
    if (WW.game.state !== 'battle') return r;
    for (const n of WW.sides()) {
      const B = WW.fleetCmd.side(n); if (!B || !pre[n]) continue;
      if (P0[n] === undefined) P0[n] = planesOf(n);
      if (B.brokenAt && !pre[n].b) {
        let why = B.fitTons < 0.15 * B.startTons ? 'break_gun' : pre[n].p === 'withdraw' ? 'wd_held45' : 'beaten';
        if (why === 'beaten') { const bare = B.hadCV && !fitCV(n) && fitCV(WW.enemyOf(n)); why = bare ? (WW.game.metT === null ? 'bare_premet' : 'bare') : 'outfought'; }
        L.push(snap(n, B, 'BREAK ' + why));
      } else if (B.posture === 'withdraw' && pre[n].p !== 'withdraw') L.push(snap(n, B, B.brokenAt ? 'withdraw(broken)' : 'withdraw ratio'));
      else if (pre[n].p === 'withdraw' && B.posture !== 'withdraw') L.push(snap(n, B, 'resume ' + B.posture));
    }
    return r;
  };
  const o = window.__beh.run(spec);
  WW.fleetCmd.update = u0;
  return { seed: spec.seed, a: spec.aNation, end: o.end, len: o.len, winner: o.winner, L };
}

(async () => {
  const b = await HL.launch(), pages = [];
  for (let k = 0; k < HL.WORKERS; k++) {
    const p = await b.newPage(); p.on('pageerror', e => console.log('PAGE', e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); pages.push(p);
  }
  const all = [];
  for (const sc of SCEN) {
    const specs = [];
    for (let i = 0; i < SEEDS; i++) { const seed = SEED0 + i; specs.push(sc.random ? { seed, random: true, light: true, label: sc.name } : { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true, label: sc.name }); }
    const out = new Array(specs.length); let next = 0;
    await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; out[i] = await pg.evaluate(probe, specs[i]); } }));
    console.log(`\n== ${sc.name}`);
    for (const r of out) {
      r.scen = sc.name; all.push(r);
      console.log(`seed ${r.seed}: ${r.end}@${r.len} winner ${r.winner || 'draw'}`);
      for (const e of r.L) if (VERB || e.why !== 'resume engage') console.log(`   ${String(e.t).padStart(4)} ${e.n} ${e.why.padEnd(18)} adm ${e.adm} wr ${e.wr} str ${e.own}/${e.known} (true ${e.trueFoe}) r ${e.ratio} cv[${e.cv}] foeCv[${e.foeCv}] planes ${e.planes}/${e.planes0} gun ${e.gun} foeGun ${e.foeGun} met ${e.met} fly ${e.fly}${e.strong ? '  STRONG' : ''}`);
    }
  }
  // summary
  const firsts = [];
  for (const r of all) for (const n of ['USN', 'IJN']) { const e = r.L.find(x => x.n === n && (x.why.startsWith('withdraw') || x.why.startsWith('BREAK'))); if (e) firsts.push(Object.assign({ scen: r.scen }, e)); }
  const breaks = []; for (const r of all) for (const e of r.L) if (e.why.startsWith('BREAK')) breaks.push(e);
  const cnt = (L, f) => L.reduce((m, e) => { const k = f(e); m[k] = (m[k] || 0) + 1; return m; }, {});
  const med = v => { v = v.slice().sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
  console.log('\n== SUMMARY');
  console.log(`rounds ${all.length}; first withdraw/break: ${firsts.length} side-rounds, median t ${med(firsts.map(e => e.t))}; by rule ${JSON.stringify(cnt(firsts, e => e.why))}`);
  console.log(`first withdraws while STRONG (fit carrier, >50% planes): ${firsts.filter(e => e.strong).length}/${firsts.length}; breaks while STRONG: ${breaks.filter(e => e.strong).length}/${breaks.length} ${JSON.stringify(cnt(breaks.filter(e => e.strong), e => e.why))}`);
  for (const s of SCEN) { const R = all.filter(r => r.scen === s.name); console.log(`${s.name}: len med ${med(R.map(r => r.len))}  ends ${JSON.stringify(cnt(R, r => r.end))}  wins ${JSON.stringify(cnt(R, r => r.winner || 'draw'))}  breaks ${JSON.stringify(cnt(breaks.filter(e => R.some(r => r.L.includes(e))), e => e.why))}`); }
  await b.close();
})();
