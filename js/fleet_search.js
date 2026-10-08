// fleet_search.js - WW.fleetSearch: the commander's search and PT-boat plan, ticked from fleet_cmd.js right after
// the stations. A side that cannot find the enemy goes and looks:
//   - searchFor: s since the side last had a contact up to SEEN_AGE old; sweep: searchFor > SWEEP_T (long search);
//   - heavySeen: an enemy battleship, cruiser or destroyer was seen this round (gun ships that eat PT boats);
//   - ptDeep: no heavy seen, and either an enemy carrier is known or the search has gone on DEEP_T s: PT boats may
//     run deep (past the midline limits of ai_pt.js), still steering by the danger field;
//   - PT spots: each PT pair gets its own ambush spot (island cover near its lane), at least PAIR_SEP from every
//     other pair's spot; the wing lurks WING beside its leader. Lanes spread the pairs across the map; during a
//     sweep the lanes advance toward the enemy (the PT line moves SWEEP_V u/s, up to the midline limit or deep).
//   - light-ship sweep: with no battle line, screen or flotilla, a carrier's extra escorts (all but the first)
//     sweep forward to the commander's search sectors during a long search.
// Writes o.spot = { x, z } on PT orders (ai_pt.js lurkSpot reads it) and o.sx / o.sz on sweeping escorts.
// Reads only the side's own intel. No randomness.
window.WW = window.WW || {};
(function () {
  'use strict';
  var SEEN_AGE = 30, SWEEP_T = 75, DEEP_T = 120, SWEEP_V = 4;
  var PAIR_SEP = 75, WING = 15, LANE = 150, COVER_R = 150;
  var PEN_LURK = -0.06, PEN_SWEEP = 0.1, PEN_DEEP = 0.8; // how far past the midline a PT spot may be (x half-map)
  var HEAVY = { battleship: 1, cruiser: 1, destroyer: 1 };
  var stats = { sweeps: 0, deep: 0, spots: 0 };

  function pen(nation, x) { var W = WW.cfg.MAP_W; return (nation === 'USN' ? x - W / 2 : W / 2 - x) / (W / 2); }
  function xAt(nation, p) { var W = WW.cfg.MAP_W; return nation === 'USN' ? W / 2 + p * W / 2 : W / 2 - p * W / 2; }
  function danger(n, x, z) { return WW.threat ? WW.threat.danger(n, x, z) : 0; }

  function tick(B, cs, now) {
    var rt = WW.game ? WW.game.roundTime : now, i, c, u;
    if (B.contactT === undefined) { B.contactT = 0; B.heavySeen = false; B.sweepT = 0; }
    var cvKnown = false;
    for (i = 0; i < cs.length; i++) {
      c = cs[i]; u = c.unit; if (!u || !u.alive) continue;
      if (now - c.seenAt <= SEEN_AGE) B.contactT = rt;
      if (HEAVY[u.type]) B.heavySeen = true;
      if (u.type === 'carrier') cvKnown = true;
    }
    B.searchFor = rt - B.contactT;
    var sweep = B.searchFor > SWEEP_T;
    if (sweep && !B.sweep) stats.sweeps++;
    B.sweep = sweep;
    B.sweepT = sweep ? B.sweepT + WW.fleetCmd.TICK : Math.max(0, B.sweepT - 2 * WW.fleetCmd.TICK); // the line steps back slowly
    var deep = !B.heavySeen && rt > 60 && (cvKnown || B.searchFor > DEEP_T || B.ptDeep);
    if (deep && !B.ptDeep) stats.deep++;
    B.ptDeep = deep;
    ptSpots(B);
    escortSweep(B);
  }

  // The base point of pair k's lane: the PT line (ahead of the main guide, or a fixed line for a PT-only side),
  // advanced during a sweep, never past the midline limit; lanes spread across the map.
  function lane(B, k, P) {
    var n = B.nation, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, home = n === 'USN' ? 1 : -1, G = B.groups;
    var others = G.main.members.length + G.screen.members.length + G.flotilla.members.length + G.carrier.members.length;
    var gx = B.axis.x, gz = B.axis.z;
    var bx = others ? gx + home * 60 : xAt(n, -0.5);
    if (!B.heavySeen) bx += home * B.sweepT * SWEEP_V;   // a gun ship seen this round: wait for it at the line (its reach outranges a PT's eye)
    var lim = B.ptDeep ? PEN_DEEP : B.sweep && !B.heavySeen ? PEN_SWEEP : PEN_LURK;
    if (pen(n, bx) > lim) bx = xAt(n, lim);
    var sp = P > 1 ? Math.min(LANE, (H - 120) / (P - 1)) : 0;
    var bz = P > 1 ? (others ? gz : H / 2) + (k - (P - 1) / 2) * sp : gz + (B.nation === 'USN' ? 1 : -1) * LANE * 0.6;
    return { x: WW.clamp(bx, 40, W - 40), z: WW.clamp(bz, 50, H - 50), lim: lim };
  }
  function ptSpots(B) {
    var M = B.groups.pt.members, P = (M.length + 1) >> 1, n = B.nation, home = n === 'USN' ? -1 : 1;
    if (!M.length) return;
    var cover = WW.lightAI && WW.lightAI.h ? WW.lightAI.h.coverPts() : [], taken = [];
    for (var k = 0; k < P; k++) {
      var L = M[2 * k], Wg = M[2 * k + 1], oL = B.orders.get(L.id), b = lane(B, k, P);
      if (!oL) continue;
      // out of known reach: step the base home
      for (var q = 0; q < 4 && danger(n, b.x, b.z) > 0.3; q++) b.x = WW.clamp(b.x + home * 60, 40, WW.cfg.MAP_W - 40);
      var prev = oL.spot, best = null, bs = -1e9;
      var score = function (x, z) {
        var dg = danger(n, x, z), s = 25 - WW.dist(x, z, b.x, b.z) * 0.35 - dg * 30 - (dg > 0.3 ? 200 : 0);
        for (var j = 0; j < taken.length; j++) { var d = WW.dist(x, z, taken[j].x, taken[j].z); if (d < PAIR_SEP) s -= 300 * (1 - d / PAIR_SEP) + 100; }
        if (prev && WW.dist(x, z, prev.x, prev.z) < 5) s += 15; // keep the spot unless a better one is clearly better
        return s;
      };
      for (var i = 0; i < cover.length; i++) {
        var cp = cover[i];
        if (WW.dist(cp.x, cp.z, b.x, b.z) > COVER_R || pen(n, cp.x) > b.lim) continue;
        var s = score(cp.x, cp.z);
        if (s > bs) { bs = s; best = cp; }
      }
      var open = score(b.x, b.z) - 10; // open water at the lane point (no cover) if nothing better
      if (!best || open > bs) best = { x: b.x, z: b.z };
      oL.spot = { x: best.x, z: best.z }; oL.sx = best.x; oL.sz = best.z;
      taken.push(oL.spot); stats.spots++;
      if (!Wg) continue;
      var oW = B.orders.get(Wg.id); if (!oW) continue;
      oW.spot = wingSpot(B, best);
      oW.sx = oW.spot.x; oW.sz = oW.spot.z;
    }
  }
  // The wing's spot: WING beside the leader's, across the line of advance, on navigable water (either side).
  function wingSpot(B, p) {
    var h = B.axis.h + Math.PI / 2;
    for (var k = 0; k < 6; k++) {
      var r = WING * (k < 4 ? 1 : 0.6), sgn = k & 1 ? -1 : 1, a = h + (k >> 1) * 0.5;
      var x = p.x + Math.cos(a) * r * sgn, z = p.z + Math.sin(a) * r * sgn;
      if (WW.terrain.isNavigable(x, z, 2.5)) return { x: x, z: z };
    }
    return { x: p.x + Math.cos(h) * WING, z: p.z + Math.sin(h) * WING };
  }
  // Long search with no battle line, screen or flotilla: the carrier's extra escorts sweep to search sectors.
  function escortSweep(B) {
    var G = B.groups;
    if (!B.sweep || G.main.members.length || G.screen.members.length || G.flotilla.members.length) return;
    var esc = G.carrier.members.filter(function (q) { return q.type !== 'carrier'; });
    for (var i = 1; i < esc.length; i++) {
      var o = B.orders.get(esc[i].id); if (!o || o.role === 'withdraw') continue;
      var sp = WW.search ? WW.search.claim(B.nation, esc[i], esc[i].x, esc[i].z) : WW.fleetCmd.scoutPoint(B.nation, esc[i].x, esc[i].z);
      if (!sp) continue;
      o.sx = sp.x; o.sz = sp.z; o.role = 'sweep';
    }
  }

  WW.fleetSearch = { tick: tick, stats: stats, SWEEP_T: SWEEP_T, DEEP_T: DEEP_T };
  WW.on('roundStart', function () { for (var k in stats) stats[k] = 0; });
})();
