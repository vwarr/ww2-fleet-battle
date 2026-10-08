// Composition fuzz for tests/sim_behaviour.js (--only fuzz --seeds N): lopsided and odd fleets.
// Each seed runs one named composition (cycling through NAMED) and one random composition drawn from the seed
// (any subset of ship types, random counts, >= 1 ship per side; the picker is seeded in node, not WW.rand).
// Per-round checks (hard FAIL unless noted), reported per composition:
//   sight    first sighting by either side within SIGHT_T s
//   dmg      first damage within DMG_T s of the first sighting
//   stale    time-limit ends with 0 sunk and < STALE_DMG damage dealt (WARN: should be ~0)
//   pt_nn    10th-percentile nearest same-side PT distance, pair-mates excluded, >= PT_NN (over all rounds)
//   stuck / nan / errors 0 (the suite's own checks)
const SIGHT_T = 120, DMG_T = 120, STALE_DMG = 200, PT_NN = 25;
const rep = (t, n) => Array(n).fill(t);
const NAMED = [
  ['cv_vs_pt', rep('carrier', 3), rep('pt', 10)],
  ['pt_vs_pt', rep('pt', 8), rep('pt', 8)],
  ['sub_vs_cv', rep('submarine', 4), rep('carrier', 2)],
  ['dd_swarm_vs_bb', rep('destroyer', 8), ['battleship']],
  ['ss_vs_ss', rep('submarine', 3), rep('submarine', 3)],
  ['bb4_vs_bb4', rep('battleship', 4), rep('battleship', 4)],
  ['cv_vs_bb', ['carrier'], ['battleship']],
  ['cv2_vs_cv2', rep('carrier', 2), rep('carrier', 2)],
  ['dd6_vs_ss6', rep('destroyer', 6), rep('submarine', 6)],
  ['ca_vs_pt6', ['cruiser'], rep('pt', 6)],
  ['dd_vs_dd', ['destroyer'], ['destroyer']],
  ['cv3_vs_bb2ca2', rep('carrier', 3), ['battleship', 'battleship', 'cruiser', 'cruiser']],
  ['full_vs_pt2', ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer'], ['pt', 'pt']],
  ['ss_vs_pt', ['submarine'], ['pt']]
];
const TYPES = ['carrier', 'battleship', 'cruiser', 'destroyer', 'submarine', 'pt'];
const MAXN = { carrier: 3, battleship: 4, cruiser: 4, destroyer: 8, submarine: 6, pt: 10 };
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randomFleet(r) {
  const f = [], k = 1 + Math.floor(r() * 3);           // 1-3 types: lopsided on purpose
  const pool = TYPES.slice();
  for (let i = 0; i < k; i++) { const t = pool.splice(Math.floor(r() * pool.length), 1)[0]; const n = 1 + Math.floor(r() * MAXN[t]); for (let j = 0; j < n; j++) f.push(t); }
  return f;
}
function specs(seed) {
  const nm = NAMED[(seed - 1) % NAMED.length], r = rng(seed), A = randomFleet(r), B = randomFleet(r);
  const tag = f => { const c = {}; f.forEach(t => (c[t] = (c[t] || 0) + 1)); return Object.entries(c).map(([t, n]) => t.slice(0, 2) + n).join('+'); };
  return [
    { seed, A: nm[1], B: nm[2], aNation: seed % 2 ? 'USN' : 'IJN', cripple: -1, noStall: false, label: nm[0], fuzz: true },
    { seed: seed + 5000, A, B, aNation: seed % 2 ? 'IJN' : 'USN', cripple: -1, noStall: false, label: 'rand:' + tag(A) + '_vs_' + tag(B), fuzz: true }
  ];
}
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };
// per-composition report; returns { fails, warns }
function report(rounds, log) {
  const by = new Map();
  for (const r of rounds) { const k = r.label.startsWith('rand:') ? 'random' : r.label; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  let fails = 0, warns = 0;
  const bad = [];
  log('  composition         n  sight(med/max)  dmg-after-sight  stale  sunk/rnd  ends(k/r/t/s)  pt_nn_p10  stuck nan   result');
  for (const [k, rs] of by) {
    const f = [], sights = rs.map(r => r.firstSight), dmgs = rs.map(r => (r.firstSight === null || r.firstDmg === null ? null : r.firstDmg - r.firstSight));
    for (const r of rs) {
      const why = [];
      if (r.firstSight === null || r.firstSight > SIGHT_T) why.push('sight ' + (r.firstSight === null ? 'never' : r.firstSight.toFixed(0)));
      if (r.firstSight !== null && (r.firstDmg === null || r.firstDmg - r.firstSight > DMG_T)) why.push('dmg ' + (r.firstDmg === null ? 'never' : (r.firstDmg - r.firstSight).toFixed(0)));
      if (why.length) { f.push(why.join(',')); bad.push(`s${r.seed} ${r.label}: ${why.join(', ')}`); }
    }
    const stale = rs.filter(r => r.end === 'time' && !r.sunk.length && r.dmgSum < STALE_DMG).length;
    const nn = pct(rs.flatMap(r => r.ptNN || []), 0.1), stuck = rs.reduce((s, r) => s + r.stuck, 0), nan = rs.reduce((s, r) => s + r.nan, 0);
    const ends = ['kill', 'retire', 'time', 'stall'].map(e => rs.filter(r => r.end === e || (e === 'stall' && r.endReason === 'stall')).length).join('/');
    let res = 'PASS';
    if (f.length || stuck || nan || (nn !== null && nn < PT_NN)) { res = 'FAIL'; fails++; }
    else if (stale) { res = 'WARN'; warns++; }
    const sv = sights.filter(v => v !== null);
    log(`  ${k.padEnd(18)} ${String(rs.length).padStart(2)}  ${String(pct(sv, 0.5) ?? '-').padStart(5)}/${String(sv.length ? Math.round(Math.max(...sv)) : '-').padEnd(6)}  ${String(pct(dmgs.filter(v => v !== null), 0.5) ?? '-').padStart(8)}         ${String(stale).padStart(3)}  ${(rs.reduce((s, r) => s + r.sunk.length, 0) / rs.length).toFixed(1).padStart(6)}    ${ends.padEnd(12)}  ${String(nn ?? '-').padStart(6)}     ${stuck}  ${nan}    ${res}`);
  }
  if (bad.length) { log('  misses:'); bad.slice(0, 40).forEach(b => log('    ' + b)); }
  const stuckWho = rounds.filter(r => r.stuck).map(r => `s${r.seed} ${r.label}: ${r.stuckWho.join(' ')}`);
  if (stuckWho.length) { log('  stuck:'); stuckWho.forEach(b => log('    ' + b)); }
  return { fails, warns };
}
const CHECKS = ['pt_nn_p10', 'stuck', 'nan', 'errors']; // suite checks that stay hard in fuzz rounds (the rest: WARN)
module.exports = { CHECKS, NAMED, specs, report, SIGHT_T, DMG_T, STALE_DMG, PT_NN };
