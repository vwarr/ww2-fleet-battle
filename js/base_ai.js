// base_ai.js - WW.baseAI: the fight for the island in the AI (sim code, no randomness). Loads after the AI files.
//  - Objective (fleet_cmd.js tick hook, B.objective): { kind: 'neutralize' | 'defend', base, x, z, state, at } for a
//    side facing / owning an island base, else null. state: 'intact' | 'runway closed' | 'neutralized'.
//  - Bombardment: the base is an enemy contact with guns (island_base.js), so the ships' own target score picks it
//    when nothing better is in reach: battleships (ROLE_W 1) and cruisers (0.8) close to their preferred range
//    (ai_surface.js engage) and shell it; the coastal batteries are in the danger field, so the exposure term and
//    bestHeading keep a battleship outside their reach (its guns outrange them) while a cruiser accepts the risk.
//    Destroyers take it at a low weight (their guns and the big ships' secondaries go for the AA pits and batteries in
//    reach); PT boats and submarines never, and nobody fires torpedoes at it. A neutralized base is still shelled
//    while planes on the ground, the fuel farm or a hangar are left (targetsLeft).
//  - Carrier strikes (fleet_cmd.js strikes): strikeValue() is the base's worth as a strike target, against the
//    ships' STRIKE_V (carrier 12, battleship 9): an enemy carrier in reach is the better target (the Midway dilemma:
//    a strike on the island is a strike not kept for the carriers).
//  - The alarm (island_base.js update, alarm()): the first time the base's side has a fresh sighting (WW.intel, any
//    observer: the base's radar and lookouts, ships, scouts) of an enemy warship within ALARM_SHIP of the island, or of
//    enemy planes within ALARM_PLANE closing on it (a lone plane within ALARM_NEAR). Deterministic (no dice, intel only).
//  - Defence (fleet_cmd.js assignment): an enemy ship within DEF_R of the own base is worth x2 to own ships within
//    DEF_HELP of the base (the fleet covers the island).
window.WW = window.WW || {};
(function () {
  'use strict';
  var W_BASE = { battleship: 1, cruiser: 0.8, destroyer: 0.2, carrier: 0, submarine: 0, pt: 0 }; // ROLE_W[shooter].base (destroyers: the pits and batteries in reach, a low weight)
  var VALUE = 7;              // WW.shipAI.VALUE.base (a battleship is 9)
  var DEF_R = 230, DEF_HELP = 420;
  var STRIKE_OPEN = 6, STRIKE_SHUT = 3.5; // strike value with a runway open / all closed (guns still up)
  var SEARCH_T = 150, NEAR_CV = 350;      // no strike on the island before SEARCH_T s (find the enemy fleet first) unless it is this close to the carrier
  var FLEET_AGE = 60, FLEET_K = 0.3;      // the enemy fleet known (a carrier / gun ship seen in the last FLEET_AGE s): the
                                          // island waits (bombardment weight and strike value x FLEET_K): the fleet first

  function weights(on, k0) {
    var RW = WW.shipAI && WW.shipAI.ROLE_W; if (!RW) return;
    for (var k in RW) RW[k].base = on ? (W_BASE[k] || 0) * WW.islandBase.TUNE.target * (k0 === undefined ? 1 : k0) : 0;
    WW.shipAI.VALUE.base = VALUE;
  }
  function base() { return WW.islandBase && WW.islandBase.base; }

  function objective(B) {
    var b = base(); if (!b) return null;
    var o = B.objective && B.objective.base === b ? B.objective : { base: b, at: WW.time.now };
    o.kind = b.nation === B.nation ? 'defend' : 'neutralize'; o.x = b.x; o.z = b.z;
    o.state = b.neutralized ? 'neutralized' : WW.islandBase.runwayOpen() ? 'intact' : 'runway closed';
    if (o.kind === 'neutralize') { // the enemy fleet in sight comes first; the island when the sea is clear
      o.fleetFirst = false;
      var cs = WW.intel ? WW.intel.enemyShips(B.nation) : [], now = WW.time.now;
      for (var i = 0; i < cs.length; i++) {
        var u = cs[i].unit;
        if (u && !u.isBase && u.alive && (u.type === 'carrier' || u.type === 'battleship' || u.type === 'cruiser') && now - cs[i].seenAt < FLEET_AGE) { o.fleetFirst = true; break; }
      }
      weights(!b.neutralized || targetsLeft(b), o.fleetFirst ? FLEET_K : 1);   // neutralized: the shelling goes on while planes and fuel remain
    }
    return o;
  }
  function strikeValue(B, cv) {
    var b = base(); if (!b || b.neutralized || b.nation === B.nation) return 0;
    var k = B.objective && B.objective.base === b && B.objective.fleetFirst ? FLEET_K : 1;
    if ((WW.game ? WW.game.roundTime : 0) < SEARCH_T && (!cv || WW.dist2(cv.x, cv.z, b.x, b.z) > NEAR_CV * NEAR_CV)) return 0;
    if (WW.staff) k *= WW.staff.baseK(B.nation, cv);   // a neutralization raid needs the escort for the airfield's fighters (air_staff.js)
    return (WW.islandBase.runwayOpen() ? STRIKE_OPEN : b.stats.guns.length ? STRIKE_SHUT : 2) * WW.islandBase.TUNE.target * k;
  }
  function assign(ship, target) {
    var b = base(); if (!b || b.nation !== ship.nation || !target || target.isBase) return 0;
    if (WW.dist2(target.x, target.z, b.x, b.z) > DEF_R * DEF_R || WW.dist2(ship.x, ship.z, b.x, b.z) > DEF_HELP * DEF_HELP) return 0;
    return WW.islandBase.TUNE.defend;
  }
  function neutralized(b) { if (!b || !targetsLeft(b)) weights(false); }

  var ALARM_SHIP = 320, ALARM_PLANE = 260, ALARM_NEAR = 110, CLOSING = 0.7;
  // -> { kind: 'ship' | 'raid' | 'planes', x, z, unit, n } or null (n: enemy planes closing)
  function alarm(b) {
    var I = WW.intel; if (!I || !b) return null;
    var best = null, bd = 1e18, i, c, u, d;
    var cs = I.enemyShips(b.nation, { fresh: true });
    for (i = 0; i < cs.length; i++) {
      c = cs[i]; u = c.unit;
      if (!u || u.isBase || !u.alive || u.submerged) continue;
      d = WW.dist2(c.x, c.z, b.x, b.z);
      if (d < ALARM_SHIP * ALARM_SHIP && d < bd) { bd = d; best = { kind: 'ship', x: c.x, z: c.z, unit: u, what: I.typeOf(c), n: 0 }; }
    }
    var ps = I.enemyPlanes(b.nation), n = 0, near = null, nd = 1e18;
    for (i = 0; i < ps.length; i++) {
      c = ps[i]; u = c.unit; if (!u || !u.alive) continue;
      d = WW.dist(c.x, c.z, b.x, b.z); if (d > ALARM_PLANE) continue;
      var closing = d < ALARM_NEAR || ((b.x - c.x) * Math.cos(c.heading) + (b.z - c.z) * Math.sin(c.heading)) / Math.max(1, d) > CLOSING;
      if (!closing) continue;
      n++; if (d < nd) { nd = d; near = c; }
    }
    if (near && (n >= 2 || nd < ALARM_NEAR)) return { kind: n >= 3 ? 'raid' : 'planes', x: near.x, z: near.z, unit: near.unit, n: n };
    return best;
  }

  // no torpedoes at an island (ai_surface.js torpedoes / PT and sub launches go through fireSpread)
  if (WW.shipAI && WW.shipAI.h) {
    var fs = WW.shipAI.h.fireSpread;
    WW.shipAI.h.fireSpread = function (ship, t) { if (t && t.isBase) return false; return fs.apply(this, arguments); };
  }
  // Bombardment fire control (Kongo and Haruna on Henderson Field, 13-14 Oct 1942): each ship works one line of fall at
  // a time and WALKS its shells along it (WALK u per round fired, out and back) - a live coastal battery in its range
  // first (counter-battery: a point), then the planes parked in their dispersal rows, the fuel farm and the hangars,
  // an open runway end to end, the AA pits and the rest. Two ships do not work the same line if they can help it.
  // fireShell aims at target.x / z, so the wrapper below moves the base's x / z to the walking aim point for the call.
  var WALK = 3.2, LINE_T = 30, BOMB_K = 0.7;   // BOMB_K: a bombardment run closes to this x the main battery's range
  function bombardRange(ship, pref) { var g = ship.stats.guns[0]; return g ? Math.min(pref, g.range * BOMB_K) : pref; }
  // light guns (a destroyer's main battery, a big ship's secondaries: 'small', no crater): only what they can hurt -
  // the AA pits, the batteries, the planes in the open - within their own reach
  function aimLines(ship, b, small) {
    var g = small ? ship.stats.guns.find(function (q) { return q.cal === 'small'; }) : ship.stats.guns[0];
    var R = g ? g.range : 100, L = [], i, f, d;
    var add = function (key, x0, z0, x1, z1, pr) {
      d = WW.dist(ship.x, ship.z, (x0 + x1) / 2, (z0 + z1) / 2);
      L.push({ key: key, x0: x0, z0: z0, x1: x1, z1: z1, sc: pr - d * 0.5 - (d > R ? 400 : 0) });
    };
    for (i = 0; i < b.facilities.length; i++) {
      f = b.facilities[i]; if (f.out) continue;
      if (small && f.kind !== 'aa' && f.kind !== 'battery') continue;
      // a battery that can reach us (or has fired on us) first: counter-battery; one out of its reach can wait
      var duel = f.kind === 'battery' && (WW.dist(ship.x, ship.z, f.x, f.z) < WW.islandBase.BATTERY.range + 15 || WW.time.now - (f.firedAt || -1e9) < 40);
      var pr = f.kind === 'battery' ? (duel ? 300 : 60) : f.kind === 'fuel' ? 200 : f.kind === 'hangar' ? 170 : f.kind === 'aa' ? (small ? 200 : 100) : 30;
      if (f.kind === 'battery') add(f, f.x, f.z, f.x, f.z, pr);
      else { var cx = Math.cos(f.a || 0) * (f.r + 3), cz = Math.sin(f.a || 0) * (f.r + 3); add(f, f.x - cx, f.z - cz, f.x + cx, f.z + cz, pr); }
    }
    // the plane parks: from a parked plane to the farthest parked plane within 26 u of it (a row of revetments), worth
    // more the more planes it holds - what the bombardment is for (Henderson Field: some 48 aircraft wrecked)
    var P = parked(b);
    for (i = 0; i < P.length; i += 3) {
      var s0 = P[i], far = s0, fd = 0, n = 0;
      for (var j = 0; j < P.length; j++) { var dd = Math.hypot(P[j].x - s0.x, P[j].z - s0.z); if (dd < 26) { n++; if (dd > fd) { fd = dd; far = P[j]; } } }
      add('row' + s0.i, s0.x, s0.z, far.x, far.z, 140 + 16 * Math.min(n, 6));
    }
    if (!small) for (i = 0; i < b.runways.length; i++) { var r = b.runways[i]; if (r.closed) continue; var h = r.len * 0.42; add(r, r.x - r.c * h, r.z - r.s * h, r.x + r.c * h, r.z + r.s * h, i ? 110 : 140); }
    return L;
  }
  function parked(b) { return (b.slots || []).filter(function (s) { return s.spot && (s.state === 'parked' || s.state === 'rearm'); }); }
  // what is still worth shelling after the base is neutralized: planes on the ground, the fuel farm, the hangars
  function targetsLeft(b) { return parked(b).length > 0 || b.facilities.some(function (f) { return !f.out && (f.kind === 'fuel' || f.kind === 'hangar'); }); }
  function shipAim(ship, b, small) {
    var K = small ? '_baseAimS' : '_baseAim', a = ship[K], now = WW.time.now;
    if (!a || now - a.t > LINE_T || a.done || (a.key && a.key.out) || (a.key && a.key.closed)) {
      var L = aimLines(ship, b, small), best = null, bs = -1e9;
      for (var i = 0; i < L.length; i++) {
        var c = L[i], sc = c.sc;
        for (var k = 0; k < WW.world.ships.length; k++) { var o = WW.world.ships[k]; if (o !== ship && o[K] && o[K].key === c.key && now - o[K].t < LINE_T) sc -= 90; }
        if (a && a.key === c.key) sc -= 40;                   // a fresh line after a full pass
        if (sc > bs) { bs = sc; best = c; }
      }
      a = ship[K] = best ? { key: best.key, x0: best.x0, z0: best.z0, x1: best.x1, z1: best.z1, u: 0, dir: 1, t: now, done: false }
        : { key: null, x0: b.x, z0: b.z, x1: b.x, z1: b.z, u: 0, dir: 1, t: now, done: false };
      a.len = Math.hypot(a.x1 - a.x0, a.z1 - a.z0);
    }
    var u = a.len > 0.5 ? a.u / a.len : 0.5;
    a.x = a.x0 + (a.x1 - a.x0) * u; a.z = a.z0 + (a.z1 - a.z0) * u;
    a.u += WALK * a.dir;                                        // the next round falls a little further along
    if (a.u > a.len) { a.u = a.len; a.dir = -1; } else if (a.u < 0) { a.u = 0; a.done = true; }
    return a;
  }
  if (WW.combat && WW.combat.fireShell) {
    var fire0 = WW.combat.fireShell;
    WW.combat.fireShell = function (ship, turret, target, cal) {
      if (!target || !target.isBase || !ship || ship.isBattery) return fire0.apply(this, arguments);
      var a = shipAim(ship, target, cal === 'small'), ox = target.x, oz = target.z;
      target.x = a.x; target.z = a.z;
      try { return fire0.apply(this, arguments); } finally { target.x = ox; target.z = oz; }
    };
  }
  if (WW.combatAA && WW.combatAA.cfg) WW.combatAA.cfg.HEAVY_SHARE.base = 0.45;   // AA pits: 3-inch guns + .50s
  if (WW.strike && WW.strike.TOP) WW.strike.TOP.base = 3;                         // pull-out clearance over the field
  WW.on('baseBuilt', function (e) { if (e && e.base) weights(true); });

  WW.baseAI = { objective: objective, strikeValue: strikeValue, assign: assign, neutralized: neutralized, alarm: alarm, W_BASE: W_BASE, bombardRange: bombardRange, BOMB_K: BOMB_K,
    ALARM: { SHIP: ALARM_SHIP, PLANE: ALARM_PLANE, NEAR: ALARM_NEAR } };
})();
