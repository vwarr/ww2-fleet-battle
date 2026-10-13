// leaders.js - WW.leaders: the men who got the beach moving (Normandy realism pass). Sim code (WW.rand), Normandy only,
// stepped from infantry.js update before the squads; the roundStart listener draws nothing.
// By 07:30 the assault had stalled at the shingle: thousands of men lay against the stones and the sea wall, leaderless
// (the officers had been hit first), wet, many without weapons, and the beach behind them filling with the next waves.
// What broke it was men standing up: Brig. Gen. Norman Cota and Col. Charles Canham walking the shingle at Dog White from
// about 07:30, Col. George Taylor at Easy Red about 08:15, and all along the beach lieutenants, sergeants and privates
// who got a Bangalore under the wire and the men nearest them through it.
// Here a leader cuts the stall of the squads near him at the shingle (infantry.js 'shingle': the wait x q.leadK, and the
// pinned multiplier halved): the named ones (NAMED) come ashore at their time in their sector and walk the shingle
// toward the stalled squads (WALK u/s), getting each one within its r up (leadK k); everywhere else a squad stalled for
// JUNIOR_MIN s may find its own leader (JUNIOR_RATE a second: a junior officer or an NCO, leadK JUNIOR_K, and the squads
// beside him half that).
// Events: 'squadEvent' { kind: 'leader', name, text, key, sector, x, z, squad } when a leader gets a squad up (each named
// leader at most every EV_GAP s; the first one carries his line).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const WALK = 0.3, EV_GAP = 40, JUNIOR_MIN = 12, JUNIOR_RATE = 0.011, JUNIOR_K = 0.35, NEAR_R = 10;
  // the named leaders: [h, m] ashore, sector, x (null: the sector's middle), r (u), k (leadK), only (squad kinds), the line
  const NAMED = [
    { key: 'cota', name: 'Brig. Gen. Norman D. Cota', short: 'Cota', at: [7, 30], sector: 'dogWhite', x: 1488, r: 24, k: 0.12,
      line: 'Brig. Gen. Cota walks the shingle at Dog White under fire, cigar in his teeth, getting the 116th up and through the wire: "Gentlemen, we are being killed on the beaches. Let\'s go inland and be killed."',
      ranger: 'Cota to the 5th Rangers at the sea wall: "Rangers, lead the way!"' },
    { key: 'canham', name: 'Col. Charles D. W. Canham', short: 'Canham', at: [7, 30], sector: 'dogWhite', x: 1470, r: 20, k: 0.15,
      line: 'Col. Canham of the 116th, shot through the wrist, his arm in a sling, moves along Dog White: "They\'re murdering us here! Let\'s move inland and get murdered!"' },
    { key: 'dawson', name: 'Capt. Joseph T. Dawson', short: 'Dawson', at: [7, 15], sector: 'easyRed', x: 1840, r: 12, k: 0.25,
      line: 'Capt. Dawson takes G Company of the 16th through the wire and up the bluff west of the Colleville draw' },
    { key: 'spalding', name: '2nd Lt. John M. Spalding', short: 'Spalding', at: [7, 20], sector: 'easyRed', x: 1735, r: 12, k: 0.25,
      line: 'Lt. Spalding and T/Sgt. Philip Streczyk take their section of E Company through the minefield and up the bluff between E-1 and E-3' },
    { key: 'schneider', name: 'Lt. Col. Max F. Schneider', short: 'Schneider', at: [7, 50], sector: 'dogWhite', x: 1500, r: 18, k: 0.18, only: 'ranger',
      line: 'Lt. Col. Schneider brings the 5th Rangers in on Dog White, away from the slaughter at Dog Green, and through the wire' },
    { key: 'taylor', name: 'Col. George A. Taylor', short: 'Taylor', at: [8, 15], sector: 'easyRed', x: 1760, r: 26, k: 0.12,
      line: 'Col. Taylor of the 16th at Easy Red: "Two kinds of people are staying on this beach, the dead and those who are about to die. Now let\'s get the hell out of here!"' }
  ];
  const RANK = ['a lieutenant', 'a sergeant', 'a staff sergeant', 'a technical sergeant', 'a corporal', 'a captain', 'a private first class', 'a private'];
  const on = () => WW.isScn('normandy');
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let leaders = [], stats = null;
  function newStats() { return { named: 0, junior: 0, squads: 0, events: 0 }; }
  function build() {
    const C = WW.scenarios.normandy.clock, D = WW.normandyData;
    leaders = NAMED.map(n => {
      const s = D.SECTORS.find(q => q.id === n.sector);
      return Object.assign({}, n, { t: C.at(n.at[0] * 60 + n.at[1]), x0: s.x0, x1: s.x1, cx: n.x === null ? (s.x0 + s.x1) / 2 : n.x, z: 0, ashore: false, evT: -1e9, said: false, n: 0 });
    });
  }
  function emit(L, q, text) {
    stats.events++;
    WW.emit('squadEvent', { kind: 'leader', name: L.name, key: L.key || 'junior', text, sector: q.sector, x: q.x, z: q.z, squad: q });
  }
  function getUp(q, k) {
    if (q.leadK && q.leadK <= k) return false;
    q.leadK = k; q.sup = Math.min(q.sup, 0.9); stats.squads++;
    return true;
  }
  const stalled = [];   // the squads at the shingle this step (each leader looks only at these)
  function named(L, dt, squads, now) {
    if (now < L.t) return;
    const T = WW.normandyTerrain;
    if (!L.ashore) { L.ashore = true; L.z = T.shingleZ(L.cx) - 0.8; stats.named++; }
    // walk toward the nearest stalled squad in his stretch of beach
    let tgt = null, bd = 1e9;
    for (const q of stalled) {
      if ((q.leadK && q.leadK <= L.k) || (L.only && q.kind !== L.only)) continue;
      if (q.x < L.x0 - 40 || q.x > L.x1 + 40) continue;
      const d = Math.abs(q.x - L.cx); if (d < bd) { bd = d; tgt = q; }
    }
    if (tgt) L.cx += WW.clamp(tgt.x - L.cx, -WALK * dt, WALK * dt);
    L.z = T.shingleZ(L.cx) - 0.8;
    let first = null;
    for (const q of stalled) {
      if ((L.only && q.kind !== L.only) || Math.abs(q.x - L.cx) > L.r) continue;
      if (getUp(q, L.k)) { L.n++; if (!first) first = q; }
    }
    if (first && now - L.evT > EV_GAP) {
      L.evT = now;
      const text = !L.said ? L.line : (L.ranger && first.kind === 'ranger' ? L.ranger : L.name + ' gets another group of men up and through the wire (' + (first.unit || 'the beach') + ')');
      if (L.ranger && first.kind === 'ranger') L.ranger = null;
      L.said = true; emit(L, first, text);
    }
  }
  function juniors(dt, squads, now) {
    for (const q of stalled) {
      if (q.leadK || q.state !== 'shingle' || now - q.stateT < JUNIOR_MIN) continue;
      if (WW.rand() >= JUNIOR_RATE * dt * (q.men >= 5 ? 1 : 0.3)) continue;
      const rank = RANK[Math.floor(WW.rand() * RANK.length)], unit = (q.unit || 'the beach').replace(/ \(gap team\)/, '');
      getUp(q, JUNIOR_K); stats.junior++;
      let n = 0;
      for (const o of stalled) if (o !== q && Math.abs(o.x - q.x) < NEAR_R && getUp(o, JUNIOR_K * 2)) n++;
      const L = { name: rank.replace(/^a /, '').replace(/^./, c => c.toUpperCase()) + ' (' + unit + ')', key: 'junior' };
      emit(L, q, rank.replace(/^./, c => c.toUpperCase()) + ' of ' + unit + ' stands up at the shingle, gets a Bangalore under the wire and takes the men nearest him through' + (n ? ' (' + (n + 1) + ' sections)' : ''));
    }
  }
  function update(dt, squads) {
    if (!on()) return;
    if (!leaders.length) build();
    const now = rt();
    stalled.length = 0;
    for (const q of squads) if (q.alive && q.state === 'shingle' && q.kind !== 'tank') stalled.push(q);
    if (!stalled.length) return;
    for (const L of leaders) named(L, dt, squads, now);
    juniors(dt, squads, now);
  }
  function reset() { leaders = []; stats = newStats(); }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.leaders = { update, NAMED, get list() { return leaders; }, get stats() { return stats; } };
  stats = newStats();
})(window.WW);
