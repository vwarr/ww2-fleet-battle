// Airborne strength per side over time (balance diagnosis, read-only): random-mix rounds as the balance gate plays
// them (G.randomComposition, the round's own weather / time of day), sampled every 5 sim s. Per side: planes in the
// air by source (carrier air groups / the island base / catapult scouts / flying boats) and by kind, and the planes
// in the landing pattern (state 'landing' or homing within 120 of the deck). Reports peak and mean airborne, the
// share of samples with one side aloft >= 3x the other (with >= 20 aloft), and the starting air groups.
// Usage: node tests/air_strength.js [--seeds 40] [--seed0 1] [--base USN|IJN|none] [--workers K] [--curve]
const HL = require('./headless');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 40), SEED0 = +arg('--seed0', 1), BASE = arg('--base', null), CURVE = argv.includes('--curve');
const JSON_OUT = arg('--json', null);

function round(p, spec) {
  return p.evaluate(spec => {
    const G = WW.game, W = WW.cfg.WORLD_W || 2400;
    WW.terrain.generate(spec.seed); WW.seedRandom(spec.seed); G.seed = spec.seed;
    const comp = G.randomComposition();
    if (WW.dayNight) WW.dayNight.force = null; if (WW.weather) WW.weather.force = null;
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(spec.seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.baseChoice = spec.base === 'none' ? 'none' : spec.base || null;
    G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    const GROUND = { takeoff: 1, rollout: 1, falling: 1, ditch: 1, afloat: 1, alight: 1, ditched: 1, wrecked: 1, slide: 1, catapult: 1 };
    const src = p => (p.kind === 'flyingboat' ? 'boat' : p.kind === 'scout' ? 'scout' : p.carrier && p.carrier.isBase ? 'base' : 'cv');
    const cvs = {}; for (const s of WW.world.ships) if (s.type === 'carrier') cvs[s.nation] = (cvs[s.nation] || 0) + 1;
    const groups = { USN: 0, IJN: 0 }; // planes on the carriers at the start
    for (const s of WW.world.ships) if (s.type === 'carrier' && s.hangar) { const a = s.hangar; groups[s.nation] += (a.fighter || 0) + (a.dive || 0) + (a.torpedo || 0); }
    const T = [], seen = new Set(), lost = { USN: 0, IJN: 0 }, flown = { USN: { cv: 0, base: 0, scout: 0, boat: 0 }, IJN: { cv: 0, base: 0, scout: 0, boat: 0 } };
    const cap = WW.cfg.ROUND_TIMEOUT + 200;
    while (G.state === 'battle' && G.roundTime < cap) {
      __sim.fastForward(5);
      const row = { t: Math.round(G.roundTime), USN: { cv: 0, base: 0, scout: 0, boat: 0, fighter: 0, dive: 0, torpedo: 0, other: 0, pattern: 0, ret: 0 }, IJN: { cv: 0, base: 0, scout: 0, boat: 0, fighter: 0, dive: 0, torpedo: 0, other: 0, pattern: 0, ret: 0 } };
      for (const pl of WW.world.planes) {
        if (!seen.has(pl)) { seen.add(pl); if (flown[pl.nation]) flown[pl.nation][src(pl)]++; }
        if (!pl.alive || GROUND[pl.state] || !row[pl.nation]) continue;
        const r = row[pl.nation]; r[src(pl)]++;
        r[pl.kind === 'fighter' || pl.kind === 'dive' || pl.kind === 'torpedo' ? pl.kind : 'other']++;
        const inPat = pl.state === 'landing' || (pl.state === 'return' && pl.carrier && Math.hypot(pl.x - pl.carrier.x, pl.z - pl.carrier.z) < 120);
        if (inPat) { r.pattern++; if (pl.carrier && pl.carrier.isBase) r.patBase = (r.patBase || 0) + 1; else if (src(pl) === 'cv' && pl.carrier && pl.carrier.isBase === undefined && pl.homeBase) r.patDiv = (r.patDiv || 0) + 1; }
        if (src(pl) === 'cv' && pl.state === 'transit' && pl.kind === 'fighter' && !pl.target && pl.carrier && Math.hypot(pl.x - pl.carrier.x, pl.z - pl.carrier.z) < 250) r.cap = (r.cap || 0) + 1;
        else if (pl.state === 'return') r.ret++;
      }
      for (const sh of WW.world.ships) if (sh.type === 'carrier' && sh.alive && !sh.sinking && row[sh.nation]) row[sh.nation].cvUp = (row[sh.nation].cvUp || 0) + 1;
      T.push(row);
    }
    for (const pl of seen) if (!pl.alive && (pl.deathMode || pl.state === 'falling' || pl.state === 'ditch') && lost[pl.nation] !== undefined) lost[pl.nation]++;
    const ib = WW.islandBase && WW.islandBase.base;
    return { seed: spec.seed, winner: G.winner, len: Math.round(G.roundTime), end: G.endReason, base: ib ? ib.nation : null, cvs, groups, lost, flown,
      wx: WW.weather ? WW.weather.kind : null, tod: WW.dayNight ? WW.dayNight.kind : null, T };
  }, spec);
}

(async () => {
  const b = await HL.launch(), k = Math.min(HL.WORKERS, SEEDS);
  const pages = await Promise.all([...Array(k)].map(async () => { const p = await b.newPage(); await p.goto(HL.url()); await p.waitForTimeout(HL.settle()); await p.evaluate(() => { window.requestAnimationFrame = () => 0; }); return p; }));
  const seeds = [...Array(SEEDS)].map((_, i) => SEED0 + i), out = [];
  await Promise.all(pages.map(async p => { while (seeds.length) { const s = seeds.shift(); out.push(await round(p, { seed: s, base: BASE })); } }));
  await b.close();
  out.sort((a, b) => a.seed - b.seed);
  if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(out));
  const air = r => r.cv + r.base + r.scout + r.boat;
  if (argv.includes('--rounds')) for (const r of out) {
    const pk = s => Math.max(...r.T.map(x => air(x[s]))), cvLoss = s => { const n0 = r.cvs[s] || 0; const x = r.T.find(x => (x[s].cvUp || 0) < n0); return n0 ? (x ? x.t : '-') : 'none'; };
    console.log(`seed ${r.seed} ${r.winner || 'draw'} ${r.end} @${r.len} base ${r.base || '-'} ${r.wx}/${r.tod} CV U${r.cvs.USN || 0}/J${r.cvs.IJN || 0} grp U${r.groups.USN}/J${r.groups.IJN} first CV lost U@${cvLoss('USN')} J@${cvLoss('IJN')}  peak U${pk('USN')}/J${pk('IJN')}  flown U${JSON.stringify(r.flown.USN)} J${JSON.stringify(r.flown.IJN)} lost U${r.lost.USN}/J${r.lost.IJN}`);
  }
  const groupsBy = { all: out, 'USN base': out.filter(r => r.base === 'USN'), 'IJN base': out.filter(r => r.base === 'IJN'), 'no base': out.filter(r => !r.base),
    'both CV': out.filter(r => r.cvs.USN && r.cvs.IJN) };
  const f1 = x => x.toFixed(1);
  for (const [name, rs] of Object.entries(groupsBy)) {
    if (!rs.length) continue;
    const S = { USN: { peak: 0, mean: 0, cv: 0, base: 0, scout: 0, boat: 0, fighter: 0, dive: 0, torpedo: 0, pattern: 0, ret: 0, flown: 0, lost: 0, grp: 0 }, IJN: null };
    S.IJN = JSON.parse(JSON.stringify(S.USN));
    let n = 0, lop = 0, lopN = 0, peakRatio = [];
    for (const r of rs) {
      let pk = { USN: 0, IJN: 0 };
      for (const row of r.T) {
        n++;
        for (const s of ['USN', 'IJN']) { const a = air(row[s]); pk[s] = Math.max(pk[s], a); S[s].mean += a; for (const k of ['cv', 'base', 'scout', 'boat', 'fighter', 'dive', 'torpedo', 'pattern', 'ret', 'patBase', 'cap']) S[s][k] = (S[s][k] || 0) + (row[s][k] || 0); }
        const u = air(row.USN), j = air(row.IJN);
        if (u + j >= 20) { lopN++; if (u >= 3 * Math.max(1, j) || j >= 3 * Math.max(1, u)) lop++; }
      }
      for (const s of ['USN', 'IJN']) { S[s].peak += pk[s]; S[s].flown += Object.values(r.flown[s]).reduce((a, b) => a + b, 0); S[s].lost += r.lost[s]; S[s].grp += r.groups[s]; }
      peakRatio.push((pk.USN + 1) / (pk.IJN + 1));
    }
    peakRatio.sort((a, b) => a - b);
    console.log(`\n== ${name}: ${rs.length} rounds (USN wins ${rs.filter(r => r.winner === 'USN').length}, IJN ${rs.filter(r => r.winner === 'IJN').length}) ==`);
    for (const s of ['USN', 'IJN']) {
      const m = S[s], R = rs.length;
      console.log(`  ${s}: peak aloft ${f1(m.peak / R)}  mean ${f1(m.mean / n)}  [cv ${f1(m.cv / n)} base ${f1(m.base / n)} scout ${f1(m.scout / n)} boat ${f1(m.boat / n)}]  [F ${f1(m.fighter / n)} D ${f1(m.dive / n)} T ${f1(m.torpedo / n)}]  pattern ${f1(m.pattern / n)} (base ${f1((m.patBase || 0) / n)}) cap ${f1((m.cap || 0) / n)} homing ${f1(m.ret / n)}  carrier planes at start ${f1(m.grp / R)}  planes flown ${f1(m.flown / R)} lost ${f1(m.lost / R)}`);
    }
    console.log(`  samples with one side >= 3x the other (>= 20 aloft): ${(100 * lop / Math.max(1, lopN)).toFixed(0)}%   peak ratio USN/IJN p10/p50/p90 ${[0.1, 0.5, 0.9].map(q => peakRatio[Math.floor(q * (peakRatio.length - 1))].toFixed(2)).join(' / ')}`);
  }
  if (CURVE) {
    console.log('\nmean aloft by minute of round time (USN / IJN), all rounds:');
    const by = {};
    for (const r of out) for (const row of r.T) { const m = Math.floor(row.t / 60); (by[m] = by[m] || { u: 0, j: 0, n: 0 }); by[m].u += air(row.USN); by[m].j += air(row.IJN); by[m].n++; }
    console.log('  ' + Object.keys(by).map(m => `${m}:${f1(by[m].u / by[m].n)}/${f1(by[m].j / by[m].n)}`).join('  '));
  }
})();
