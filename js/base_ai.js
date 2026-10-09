// base_ai.js - WW.baseAI: the fight for the island in the AI (sim code, no randomness). Loads after the AI files.
//  - Objective (fleet_cmd.js tick hook, B.objective): { kind: 'neutralize' | 'defend', base, x, z, state, at } for a
//    side facing / owning an island base, else null. state: 'intact' | 'runway closed' | 'neutralized'.
//  - Bombardment: the base is an enemy contact with guns (island_base.js), so the ships' own target score picks it
//    when nothing better is in reach: battleships (ROLE_W 1) and cruisers (0.8) close to their preferred range
//    (ai_surface.js engage) and shell it; the coastal batteries are in the danger field, so the exposure term and
//    bestHeading keep a battleship outside their reach (its guns outrange them) while a cruiser accepts the risk.
//    Destroyers, PT boats and submarines never take the base as a target, and nobody fires torpedoes at it.
//  - Carrier strikes (fleet_cmd.js strikes): strikeValue() is the base's worth as a strike target, against the
//    ships' STRIKE_V (carrier 12, battleship 9): an enemy carrier in reach is the better target (the Midway dilemma:
//    a strike on the island is a strike not kept for the carriers).
//  - Defence (fleet_cmd.js assignment): an enemy ship within DEF_R of the own base is worth x2 to own ships within
//    DEF_HELP of the base (the fleet covers the island).
window.WW = window.WW || {};
(function () {
  'use strict';
  var W_BASE = { battleship: 1, cruiser: 0.8, destroyer: 0, carrier: 0, submarine: 0, pt: 0 }; // ROLE_W[shooter].base
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
      weights(!b.neutralized, o.fleetFirst ? FLEET_K : 1);
    }
    return o;
  }
  function strikeValue(B, cv) {
    var b = base(); if (!b || b.neutralized || b.nation === B.nation) return 0;
    var k = B.objective && B.objective.base === b && B.objective.fleetFirst ? FLEET_K : 1;
    if ((WW.game ? WW.game.roundTime : 0) < SEARCH_T && (!cv || WW.dist2(cv.x, cv.z, b.x, b.z) > NEAR_CV * NEAR_CV)) return 0;
    return (WW.islandBase.runwayOpen() ? STRIKE_OPEN : b.stats.guns.length ? STRIKE_SHUT : 2) * WW.islandBase.TUNE.target * k;
  }
  function assign(ship, target) {
    var b = base(); if (!b || b.nation !== ship.nation || !target || target.isBase) return 0;
    if (WW.dist2(target.x, target.z, b.x, b.z) > DEF_R * DEF_R || WW.dist2(ship.x, ship.z, b.x, b.z) > DEF_HELP * DEF_HELP) return 0;
    return WW.islandBase.TUNE.defend;
  }
  function neutralized() { weights(false); }

  // no torpedoes at an island (ai_surface.js torpedoes / PT and sub launches go through fireSpread)
  if (WW.shipAI && WW.shipAI.h) {
    var fs = WW.shipAI.h.fireSpread;
    WW.shipAI.h.fireSpread = function (ship, t) { if (t && t.isBase) return false; return fs.apply(this, arguments); };
  }
  // Bombardment fire control: each ship spots for one aim point at a time - the nearest live coastal battery in its
  // range first (counter-battery), then the runways, then the AA pits and the rest (fireShell aims at target.x / z).
  function shipAim(ship, b) {
    var a = ship._baseAim, now = WW.time.now;
    if (a && now - a.t < 25 && !(a.f && a.f.out)) return a;
    var R = ship.stats.guns[0] ? ship.stats.guns[0].range : 100, best = null, bs = -1e9;
    for (var i = 0; i < b.facilities.length; i++) {
      var f = b.facilities[i]; if (f.out) continue;
      var d = WW.dist(ship.x, ship.z, f.x, f.z), pr = f.kind === 'battery' ? 300 : f.kind === 'aa' ? 120 : f.kind === 'hangar' || f.kind === 'fuel' ? 90 : 20;
      var sc = pr - d * 0.5 - (d > R ? 400 : 0); if (sc > bs) { bs = sc; best = f; }
    }
    var rw = null; for (var j = 0; j < b.runways.length; j++) if (!b.runways[j].closed) { rw = b.runways[j]; break; }
    if (rw && (!best || best.kind !== 'battery') && ((ship.id + Math.floor(now / 25)) & 1)) best = { x: rw.x + rw.c * rw.len * 0.25 * ((ship.id & 1) ? 1 : -1), z: rw.z + rw.s * rw.len * 0.25 * ((ship.id & 1) ? 1 : -1), f: null };
    return (ship._baseAim = best ? { x: best.x, z: best.z, f: best.f === undefined ? best : best.f, t: now } : { x: b.x, z: b.z, f: null, t: now });
  }
  if (WW.combat && WW.combat.fireShell) {
    var fire0 = WW.combat.fireShell;
    WW.combat.fireShell = function (ship, turret, target, cal) {
      if (!target || !target.isBase || !ship || ship.isBattery) return fire0.apply(this, arguments);
      var a = shipAim(ship, target), ox = target.x, oz = target.z;
      target.x = a.x; target.z = a.z;
      try { return fire0.apply(this, arguments); } finally { target.x = ox; target.z = oz; }
    };
  }
  if (WW.combatAA && WW.combatAA.cfg) WW.combatAA.cfg.HEAVY_SHARE.base = 0.45;   // AA pits: 3-inch guns + .50s
  if (WW.strike && WW.strike.TOP) WW.strike.TOP.base = 3;                         // pull-out clearance over the field
  WW.on('baseBuilt', function () { weights(true); });

  WW.baseAI = { objective: objective, strikeValue: strikeValue, assign: assign, neutralized: neutralized, W_BASE: W_BASE };
})();
