// admirals.js - WW.admirals: a named admiral per side each round, with a personality that bends the side's doctrine
// (fleet_groups.js), a flagship, and a chain of command. Sim code: WW.rand only, hooked from fleet_cmd.js
// (before / after each commander tick) and fleet_groups.js (escort ring), nothing visual (admirals_flags.js).
//  - The roll: at roundStart, after fleetCmd.reset() rolled the doctrine (this file loads right after fleet_cmd.js),
//    one admiral per side from ROSTER (carrier admirals need a carrier to fly the flag; else any). In setup mode the
//    panel shows a preview pair (Math.random: setup rounds are not replayable anyway) and the Start button uses it.
//  - Personality: multipliers on the already-jittered doctrine (only on keys the doctrine has, so the params other
//    modules add are covered once they exist), then the rollDoctrine clamps again. Moderate: 0.85-1.2.
//  - Flagship: carrier admirals fly their flag in the first carrier, Kondo in a battleship, Tanaka in a cruiser
//    (fallbacks: BB > CA > CV > DD). Sunk, sinking or crippled (hp < CRIP; if it was fit when the flag went up):
//    'flagLost', CONFUSION 30-60 s in which the side's commander does not tick (no new posture, stations or strike
//    orders: B.strikes is cleared, so air_ops launches nothing new), then the flag goes to the best fit BB / CA /
//    CV / DD, nearest first ('transfer'). The flagship is worth x FLAG_K as a focus / strike target (fleet_cmd.js),
//    and when it is the ringed carrier its escorts close in (fleet_groups.js RING x ringK()).
//  - Events: 'admiralOrder' { nation, admiral, title, order, text, t, roundTime, ship, x, z, posture?, from?, to? },
//    order: command | strike | reserve | posture | press | retire | pursue | flagLost | transfer | leaderless.
window.WW = window.WW || {};
(function () {
  'use strict';
  var FLAG_K = 1.15, RING_K = 0.9, CONF_MIN = 30, CONF_MAX = 60;
  var POSTURE_GAP = 20, BIG_GAP = 60, STRIKE_GAP = 90; // sim s between orders of a kind per side (event throttle)
  // flag: where the admiral flies his flag. mul: doctrine multipliers (risk: all types but the carrier; riskT: per type).
  var ROSTER = {
    USN: [
      { key: 'spruance', name: 'Spruance', full: 'Rear Adm. Raymond A. Spruance', style: 'calculating', flag: 'carrier',
        blurb: 'calculating: strikes at extreme range, keeps a reserve',
        mul: { strikeRange: 1.15, reserveFrac: 1.5, aggression: 0.95, rangeFrac: 1.03, escortCharge: 1.1, followUp: 0.9 },
        say: { strike: 'launch the strike now, at extreme range', press: 'close and finish them', retire: 'retire west; we have done what we came for' } },
      { key: 'halsey', name: 'Halsey', full: 'Vice Adm. William F. Halsey', style: 'aggressive', flag: 'carrier',
        blurb: 'aggressive: all-out strikes, presses hard',
        mul: { aggression: 1.2, pressRatio: 0.93, withdrawRatio: 0.9, carrier: 1.12, rangeFrac: 0.97, reserveFrac: 0.5, followUp: 1.2, cvStandoff: 0.95 }, risk: 1.1,
        say: { strike: 'strike! everything that flies', press: 'attack — repeat — attack!', retire: 'break off — for now', pursue: 'chase them down' } },
      { key: 'fletcher', name: 'Fletcher', full: 'Rear Adm. Frank J. Fletcher', style: 'cautious', flag: 'carrier',
        blurb: 'cautious: guards his carriers, retires early',
        mul: { aggression: 0.88, pressRatio: 1.06, withdrawRatio: 1.12, cvStandoff: 1.12, carrier: 0.95, escortCharge: 1.15, reserveFrac: 1.3 }, risk: 0.88,
        say: { strike: 'launch the strike; keep the fighters home', press: 'press on, carefully', retire: 'retire west and save the carriers' } }
    ],
    IJN: [
      { key: 'nagumo', name: 'Nagumo', full: 'Vice Adm. Chūichi Nagumo', style: 'cautious', flag: 'carrier',
        blurb: 'cautious, by the book: big reserve, slow to commit',
        mul: { aggression: 0.9, carrier: 0.9, reserveFrac: 1.6, jointStrike: 1.2, cvStandoff: 1.08, withdrawRatio: 1.08, pressRatio: 1.05 },
        say: { strike: 'the attack unit will launch', press: 'all forces, attack', retire: 'the fleet will withdraw to the northwest' } },
      { key: 'yamaguchi', name: 'Yamaguchi', full: 'Rear Adm. Tamon Yamaguchi', style: 'aggressive', flag: 'carrier',
        blurb: 'aggressive: launch everything, now',
        mul: { carrier: 1.15, aggression: 1.12, strikeRange: 1.08, reserveFrac: 0.4, followUp: 1.2, pressRatio: 0.95 }, risk: 1.08,
        say: { strike: 'launch everything', press: 'attack, attack!', retire: 'withdraw — we will strike again', pursue: 'after them' } },
      { key: 'kondo', name: 'Kondo', full: 'Vice Adm. Nobutake Kondō', style: 'gunnery', flag: 'battleship',
        blurb: 'gunnery: pushes the vanguard and the battle line',
        mul: { aggression: 1.15, rangeFrac: 0.96, pressRatio: 0.93, screenAhead: 1.2, carrier: 0.92, escortCharge: 0.9 }, riskT: { battleship: 1.15, cruiser: 1.15 },
        say: { strike: 'carriers, attack', press: 'battle line, close the range', retire: 'the battle line will retire' } },
      { key: 'tanaka', name: 'Tanaka', full: 'Rear Adm. Raizō Tanaka', style: 'torpedo', flag: 'cruiser',
        blurb: 'destroyers and night torpedoes',
        mul: { torpedo: 1.15, night: 1.1, aggression: 1.05, carrier: 0.92 }, add: { flotilla: 1 }, riskT: { destroyer: 1.2 },
        say: { strike: 'aircraft, attack', press: 'all destroyers, charge!', retire: 'make smoke and retire' } }
    ]
  };
  var NATIONS = ['USN', 'IJN'];
  var cur = {}, preview = null, usePreview = false;
  var stats = { flagLost: 0, transfers: 0, leaderless: 0, confusionSec: 0, orders: {} };
  var NAMES = { // flagship / successor names for ships that have none (carriers take their squadron group's name)
    USN: { battleship: ['Washington', 'South Dakota', 'North Carolina'], cruiser: ['Portland', 'Astoria', 'San Francisco', 'Minneapolis'], destroyer: ['Hammann', 'Laffey', "O'Bannon", 'Fletcher', 'Benham'] },
    IJN: { battleship: ['Kirishima', 'Hiei', 'Haruna'], cruiser: ['Nagara', 'Chikuma', 'Tone', 'Jintsu'], destroyer: ['Nowaki', 'Arashi', 'Kagero', 'Yukikaze', 'Amatsukaze'] }
  };

  function byKey(n, k) { var L = ROSTER[n] || []; for (var i = 0; i < L.length; i++) if (L[i].key === k) return L[i]; return null; }
  function hasType(n, t) { return WW.world.ships.some(function (s) { return s.alive && s.nation === n && s.type === t; }); }
  function pickKey(n, r) {
    var L = ROSTER[n], ok = L.filter(function (p) { return p.flag !== 'carrier' || hasType(n, 'carrier'); });
    if (!ok.length) ok = L;
    return ok[Math.min(ok.length - 1, Math.floor(r * ok.length))].key;
  }
  function name(s) {
    if (!s) return '';
    if (s.type === 'carrier' && WW.squadrons && WW.squadrons.group) { try { WW.squadrons.group(s); } catch (e) { /* named later */ } }
    return s.name || WW.SHIP_TYPES[s.type].name;
  }
  function nameShips() {
    var used = { USN: {}, IJN: {} };
    WW.world.ships.forEach(function (s) {
      var L = NAMES[s.nation] && NAMES[s.nation][s.type]; if (!L || s.name) return;
      var u = used[s.nation][s.type] = (used[s.nation][s.type] || 0) + 1;
      s.name = L[(u - 1) % L.length] + (u > L.length ? ' II' : '');
    });
  }
  var FLAG_PREF = { carrier: ['carrier', 'battleship', 'cruiser'], battleship: ['battleship', 'cruiser', 'carrier'], cruiser: ['cruiser', 'battleship', 'destroyer', 'carrier'] };
  function firstOf(n, types) {
    for (var k = 0; k < types.length; k++) for (var i = 0; i < WW.world.ships.length; i++) { var s = WW.world.ships[i]; if (s.alive && s.nation === n && s.type === types[k]) return s; }
    return null;
  }
  function fit(s) { return s.alive && !s.sinking && !s.escaped && s.hp >= WW.fleetGroups.CRIP * s.maxHp; }

  // personality -> the side's doctrine (then the rollDoctrine clamps)
  function apply(d, P) {
    var k, m = P.mul || {};
    if (d.strikeRange === undefined) d.strikeRange = 1;
    for (k in m) if (typeof d[k] === 'number') d[k] *= m[k];
    for (k in P.add || {}) if (typeof d[k] === 'number') d[k] += P.add[k];
    for (k in d.risk) if (k !== 'carrier') d.risk[k] = WW.clamp(d.risk[k] * (P.risk || 1) * ((P.riskT || {})[k] || 1), 0, 1);
    d.rangeFrac = WW.clamp(d.rangeFrac, 0.7, 0.92); d.pressRatio = Math.max(1.02, d.pressRatio); d.risk.carrier = 0;
    ['aggression', 'torpedo', 'carrier', 'night', 'reserveFrac'].forEach(function (q) { if (typeof d[q] === 'number') d[q] = WW.clamp(d[q], 0, 1); });
    d.admiral = P.key;
  }

  function roll(fromPreview) {
    cur = {};
    stats.flagLost = stats.transfers = stats.leaderless = stats.confusionSec = 0; stats.orders = {};
    if (!WW.fleetCmd || !WW.fleetGroups) return;
    nameShips();
    NATIONS.forEach(function (n) {
      var key = fromPreview && preview && byKey(n, preview[n]) ? preview[n] : pickKey(n, WW.rand());
      var P = byKey(n, key), B = WW.fleetCmd.side(n);
      if (B) apply(B.doctrine, P);
      var A = cur[n] = { nation: n, key: P.key, name: P.name, title: 'Adm. ' + P.name, full: P.full, style: P.style, blurb: P.blurb, P: P,
        flagship: null, flagName: '', fitAtHoist: false, confusedAt: 0, confusedUntil: 0, transfers: 0, last: {}, posture: 'search', strikes: 0 };
      hoist(A, firstOf(n, FLAG_PREF[P.flag] || FLAG_PREF.cruiser) || firstOf(n, ['destroyer']));
      order(A, 'command', A.title + ' commands', { sub: A.flagship ? 'flag in ' + A.flagName + ' · ' + A.blurb : A.blurb });
    });
  }
  function hoist(A, s) {
    A.flagship = s || null; A.flagName = s ? name(s) : ''; A.fitAtHoist = !!(s && fit(s));
    WW.emit('flagship', { nation: A.nation, ship: A.flagship, admiral: A.name });
  }

  // an order: the event (sim, deterministic: no WW.rand) with a per-kind throttle in sim time
  function order(A, kind, text, extra) {
    var now = WW.time.now, gap = kind === 'posture' ? POSTURE_GAP : kind === 'strike' ? STRIKE_GAP : kind === 'press' || kind === 'retire' || kind === 'pursue' || kind === 'reserve' ? BIG_GAP : 0;
    if (gap && A.last[kind] !== undefined && now - A.last[kind] < gap) return false;
    A.last[kind] = now; stats.orders[kind] = (stats.orders[kind] || 0) + 1;
    var s = A.flagship, e = { nation: A.nation, admiral: A.name, title: A.title, order: kind, text: text, t: now,
      roundTime: WW.game ? WW.game.roundTime : 0, ship: s, x: s ? s.x : 0, z: s ? s.z : 0 };
    for (var k in extra || {}) e[k] = extra[k];
    WW.emit('admiralOrder', e);
    return true;
  }
  function says(A, k, dflt) { return A.title + ': ' + ((A.P.say || {})[k] || dflt); }

  // fleet_cmd.js hook, before each commander tick: true = the side is in confusion, skip the tick
  function before(B) {
    var A = cur[B.nation]; if (!A || WW.game.state !== 'battle') return false;
    var now = WW.time.now, s = A.flagship;
    if (!A.confusedUntil && s && !s.escaped && (!s.alive || s.sinking || (A.fitAtHoist && s.hp < WW.fleetGroups.CRIP * s.maxHp))) {
      A.confusedAt = now; A.confusedUntil = now + WW.randRange(CONF_MIN, CONF_MAX); stats.flagLost++;
      order(A, 'flagLost', 'Flagship ' + A.flagName + ' ' + (!s.alive || s.sinking ? 'sinking' : 'out of action'), { sub: A.title + "'s staff in confusion", from: A.flagName });
    }
    if (!A.confusedUntil) return false;
    if (now < A.confusedUntil) { if (WW.threat) WW.threat.build(B.nation); B.strikes.clear(); return true; }
    // confusion over: the flag goes to the best ship left
    stats.confusionSec += now - A.confusedAt; A.confusedUntil = 0;
    var from = A.flagName, best = null, bs = -1e9, R = { battleship: 4, cruiser: 3.6, carrier: 3, destroyer: 1.5 };
    for (var i = 0; i < WW.world.ships.length; i++) {
      var q = WW.world.ships[i];
      if (q === s || !q.alive || q.sinking || q.escaped || q.nation !== B.nation || !R[q.type]) continue;
      var sc = R[q.type] + (fit(q) ? 5 : 0) - (s ? WW.dist(q.x, q.z, s.x, s.z) / 400 : 0);
      if (sc > bs) { bs = sc; best = q; }
    }
    if (!best) { hoist(A, null); stats.leaderless++; order(A, 'leaderless', A.title + ' has no ship left to command', { from: from }); return false; }
    hoist(A, best); A.transfers++; stats.transfers++;
    order(A, 'transfer', 'Flagship lost — ' + A.title + ' transfers his flag to ' + A.flagName, { from: from, to: A.flagName });
    return false;
  }
  // after each commander tick: posture orders
  var POST = { press: 'press', withdraw: 'retire', pursue: 'pursue' };
  function after(B) {
    var A = cur[B.nation]; if (!A || B.posture === A.posture) return;
    var p = B.posture, k = POST[p] || 'posture'; A.posture = p;
    var txt = k === 'press' ? says(A, 'press', 'general attack') : k === 'retire' ? says(A, 'retire', 'withdraw') : k === 'pursue' ? says(A, 'pursue', 'pursue the enemy')
      : A.title + ({ search: ': search for the enemy', approach: ': make for the enemy', engage: ': engage' })[p];
    order(A, k, txt, { posture: p });
  }
  // strikes: the first wave away of the round, then at most every STRIKE_GAP (air_cag.js strikeAway)
  WW.on('airOrder', function (e) {
    if (!e || e.order !== 'strikeAway' || !e.carrier) return;
    var A = cur[e.carrier.nation]; if (!A) return;
    var first = !A.strikes++;
    if (order(A, 'strike', first ? says(A, 'strike', 'launch the strike') : A.title + ': another strike away', { carrier: e.carrier, target: e.target || null, first: first })
      && first && WW.fleetCmd.doctrine(A.nation) && WW.fleetCmd.doctrine(A.nation).reserveFrac >= 0.25)
      order(A, 'reserve', A.title + ' holds his reserve', {});
  });
  WW.on('victory', function () {
    NATIONS.forEach(function (n) { var A = cur[n]; if (A && A.confusedUntil) { stats.confusionSec += WW.time.now - A.confusedAt; A.confusedUntil = 0; } });
  });
  WW.on('roundStart', function () { roll(usePreview); usePreview = false; });
  WW.on('setupStart', function () { cur = {}; reroll(); });
  function reroll() { // setup panel preview (Math.random: setup is not replayable; Start uses it)
    preview = {}; NATIONS.forEach(function (n) { preview[n] = pickKey(n, Math.random()); });
    WW.emit('admiralsPreview', preview);
  }

  WW.admirals = {
    ROSTER: ROSTER, FLAG_K: FLAG_K, stats: stats, before: before, after: after, reroll: reroll,
    startFromPreview: function () { usePreview = true; },  // ui.js Start: the next round keeps the admirals the panel shows
    of: function (n) { return cur[n] || null; },
    list: function () { return NATIONS.map(function (n) { return cur[n]; }).filter(Boolean); },
    preview: function (n) { return preview && byKey(n, preview[n]); },
    isFlag: function (s) { var A = s && cur[s.nation]; return !!(A && A.flagship === s); },
    targetK: function (s) { var A = s && cur[s.nation]; return A && A.flagship === s && !A.confusedUntil ? FLAG_K : 1; },
    ringK: function (cv) { var A = cv && cur[cv.nation]; return A && A.flagship === cv ? RING_K : 1; },
    confused: function (n) { var A = cur[n]; return !!(A && A.confusedUntil); },
    // test hook: the flagship of `nation` is lost now (the next commander tick starts the confusion)
    force: function (n) { var A = cur[n]; if (A && A.flagship) { A.fitAtHoist = true; A.flagship.hp = Math.min(A.flagship.hp, WW.fleetGroups.CRIP * A.flagship.maxHp * 0.9); } }
  };
})();
