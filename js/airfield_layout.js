// airfield_layout.js - WW.airfieldLayout: the island airfield's ground plan (sim: pure geometry, no randomness).
// Built from the terrain's airfield site (terrain_islands.js) when the base is built (island_base.js). Site-local
// coordinates: u along the main runway, v across it. The plan, mirrored on both sides (s = +1 / -1):
//   main runway (v 0, u -43..43) | hold-short / exit points v = s * HOLD_V | parallel taxiway v = s * TAXI_V, u -44..44
//   | dispersal rows further out: a row lane (v = laneV) with parking spots (revetments) beside it, nose to the lane.
// Cross lanes (columns) at the two ends of every row join its lane to the taxiway and, across it, to the runway (the
// exits); a plane uses the column at the nearer end of its row, so the rows are unbroken lines of revetments.
// Rows are sized for their plane class: S (fighters, dive bombers: ~4.6 long, 5.3 span), M (B-26), L (B-17, Betty);
// the lane is far enough from the noses that a plane taxiing on it clears the parked ones' wings and noses.
// Paths (polylines in world x / z) for the ground ops (land_ground.js):
//   outPath(spot, dir): spot -> row lane -> column -> taxiway -> hold short -> line-up point on the runway
//   inPath(spot, u0): the runway from u0 -> its column's exit -> across the taxiway -> column -> row lane -> spot
// Facilities (island_base.js) are placed on free ground first (free()); the spots then keep clear of them.
window.WW = window.WW || {};
(function () {
  'use strict';
  var TAXI_V = 16, HOLD_V = 11, TAXI_U = 44, LINEUP_U = 39, RUN_HALF_W = 4.5;
  var CLS = { S: { len: 4.6, span: 5.3 }, M: { len: 6.4, span: 8.0 }, L: { len: 8.3, span: 11.8 } };
  var COL_U = 38, ROW_U = 64, MAX_V = 66; // columns within |u| <= COL_U (their exits are on the runway); rows within |u| <= ROW_U and |v| <= MAX_V

  function make(S) {
    var c = Math.cos(S.h), s = Math.sin(S.h), x0 = S.x, z0 = S.z;
    var L = { S: S, TAXI_V: TAXI_V, HOLD_V: HOLD_V, TAXI_U: TAXI_U, LINEUP_U: LINEUP_U, CLS: CLS, spots: [], rows: [], cols: { 1: [], '-1': [] },
      segs: [], facs: [] };
    L.toW = function (u, v) { return { x: x0 + c * u - s * v, z: z0 + s * u + c * v }; };
    L.toL = function (x, z) { var dx = x - x0, dz = z - z0; return { u: dx * c + dz * s, v: -dx * s + dz * c }; };
    var R2 = S.runways[1], r2 = R2 ? L.toL(R2.x, R2.z) : null, a2 = R2 ? R2.h - S.h : 0, c2 = Math.cos(a2), s2 = Math.sin(a2);
    // distance in site-local units from (u, v) to the cross runway's centreline segment
    L.crossD = function (u, v) {
      if (!r2) return 1e9;
      var du = u - r2.u, dv = v - r2.v, t = WW.clamp(du * c2 + dv * s2, -R2.len / 2, R2.len / 2);
      return Math.hypot(du - c2 * t, dv - s2 * t);
    };
    L.land = function (u, v) { var p = L.toW(u, v); return WW.terrain.depthAt(p.x, p.z) < -0.6 && WW.terrain.depthAt(p.x, p.z) > -2.6; };
    L.landBox = function (u, v, hu, hv) { return L.land(u, v) && L.land(u - hu, v - hv) && L.land(u + hu, v - hv) && L.land(u - hu, v + hv) && L.land(u + hu, v + hv); };
    return L;
  }
  // Ground kept for the taxi network (no facility on it): runways, taxiways, hold-short connectors, columns, lanes.
  function onNetwork(L, u, v, r) {
    var av = Math.abs(v);
    if (Math.abs(u) < 47 + r && av < RUN_HALF_W + 2 + r) return true;                 // main runway
    if (L.crossD(u, v) < RUN_HALF_W + 2 + r) return true;                             // cross runway
    if (Math.abs(u) < TAXI_U + 4 + r && Math.abs(av - TAXI_V) < 3 + r) return true; // taxiways
    if (Math.abs(Math.abs(u) - TAXI_U) < 4 + r && av < TAXI_V + 3) return true;      // hold-short connectors
    for (var i = 0; i < L.segs.length; i++) { var g = L.segs[i]; if (segD(u, v, g) < g.w / 2 + 1.5 + r) return true; }
    return false;
  }
  function segD(u, v, g) {
    var du = g.u1 - g.u0, dv = g.v1 - g.v0, l2 = du * du + dv * dv || 1, t = WW.clamp(((u - g.u0) * du + (v - g.v0) * dv) / l2, 0, 1);
    return Math.hypot(u - g.u0 - du * t, v - g.v0 - dv * t);
  }
  // A free place for a facility of radius r near (u, v): on land, off the network, clear of the other facilities and
  // of the dispersal rows; searched outward on a ring. Returns site-local { u, v } or null.
  function free(L, u, v, r, rowsToo) {
    for (var k = 0; k < 40; k++) {
      var a = k * 2.4, d = k * 1.6, uu = u + Math.cos(a) * d, vv = v + Math.sin(a) * d;
      if (!L.landBox(uu, vv, r, r) || onNetwork(L, uu, vv, r)) continue;
      if (L.facs.some(function (f) { return Math.hypot(f.u - uu, f.v - vv) < f.r + r + 3; })) continue;
      if (rowsToo !== false && L.spots.some(function (p) { return Math.hypot(p.u - uu, p.v - vv) < p.r + r + 2; })) continue;
      return { u: uu, v: vv };
    }
    return null;
  }
  function addFac(L, u, v, r) { L.facs.push({ u: u, v: v, r: r }); }

  // Column candidates (every 2 u on each side): on land from the taxiway outward (reach) and clear of the cross runway.
  function columns(L) {
    [1, -1].forEach(function (sd) {
      for (var u = -COL_U; u <= COL_U; u += 2) {
        var reach = 0;
        for (var v = TAXI_V; v <= MAX_V; v += 2) { if (!L.landBox(u, sd * v, 2, 0.5) || L.crossD(u, sd * v) < RUN_HALF_W + 4) break; reach = v; }
        if (reach >= TAXI_V + 10) L.cols[sd].push({ u: u, reach: reach });
      }
    });
  }
  function colClear(L, u, v0, v1) { // a column segment free of facilities
    for (var t = 0; t <= 1.001; t += 0.1) { var v = v0 + (v1 - v0) * t; if (L.facs.some(function (f) { return Math.hypot(f.u - u, f.v - v) < f.r + 4; })) return false; }
    return true;
  }
  // Rows of spots for the demand { S: n, M: n, L: n }, inner rows first, the sides alternating, S then M then L. A row
  // runs between its two end columns (the outermost candidates that reach its lane), one class per row.
  function rows(L, demand) {
    var order = ['L', 'M', 'S'], need = { S: demand.S || 0, M: demand.M || 0, L: demand.L || 0 };
    var edge = { 1: TAXI_V, '-1': TAXI_V }, prevHalf = { 1: CLS.L.span / 2, '-1': CLS.L.span / 2 }, sideTurn = [1, -1], guard = 0, full = {};
    while ((need.S || need.M || need.L) && guard++ < 24) {
      var cls = order.find(function (k) { return need[k] > 0; }), C = CLS[cls], placed = 0;
      for (var si = 0; si < 2 && need[cls] > 0; si++) {
        var sd = sideTurn[si], fk = sd + cls; if (full[fk]) continue;
        var half = C.span / 2 + 0.8, laneV = edge[sd] + prevHalf[sd] + half, spotV = laneV + half + C.len / 2;
        if (spotV + C.len / 2 > MAX_V) { full[fk] = true; continue; }
        var cand = L.cols[sd].filter(function (cl) { return cl.reach >= laneV && colClear(L, cl.u, sd * TAXI_V, sd * laneV) && laneOK(L, cl.u, cl.u * 0.4, sd * laneV); });
        if (!cand.length) { full[fk] = true; continue; }
        var cL = cand.reduce(function (a, c) { return Math.abs(c.u) < Math.abs(a.u) ? c : a; }), cR = cL; // one column, mid-row
        var row = { side: sd, laneV: sd * laneV, spotV: sd * spotV, cls: cls, spots: [], cols: [cL.u] }, n = 0, gap = C.span / 2 + 6.5;
        (L.dbgRows = L.dbgRows || []).push(cls + sd + ':' + cL.u + '..' + cR.u);
        for (var u = -ROW_U + C.span / 2; u <= ROW_U - C.span / 2 && need[cls] > 0; u += 0.5) {
          if (Math.abs(u - cL.u) < gap) continue;                              // the column's own width + a taxiing wing
          if (!spotOK(L, u, sd * spotV, C)) continue;
          var col = Math.abs(u - cL.u) <= Math.abs(cR.u - u) ? cL : cR;
          if (!laneOK(L, u, col.u, sd * laneV)) { col = col === cL ? cR : cL; if (!laneOK(L, u, col.u, sd * laneV)) { L.dbg.lane++; continue; } }
          var sp = { i: L.spots.length, u: u, v: sd * spotV, side: sd, cls: cls, len: C.len, span: C.span, r: C.len * 0.42,
            laneV: sd * laneV, col: col.u, row: L.rows.length };
          var w = L.toW(u, sp.v); sp.x = w.x; sp.z = w.z;
          sp.h = Math.atan2(-sd * Math.cos(L.S.h), sd * Math.sin(L.S.h)); // nose to the lane (toward the runway)
          L.spots.push(sp); row.spots.push(sp); need[cls]--; n++;
          u += C.span + 1.6 - 0.5;                                          // the next revetment along the row
        }
        if (n) { L.rows.push(row); placed += n; edge[sd] = spotV + C.len / 2 + 1; prevHalf[sd] = 0; }
        else full[fk] = true;
      }
      if (!placed && full['1' + cls] && full['-1' + cls]) need[cls] = 0; // no room for that class any more: those planes stay off the field (land_ground caps the group)
    }
    L.segs = L.segs.filter(function (g) { return !g.lane && !g.col; });
    var far = {};
    L.rows.forEach(function (row) {
      var us = row.spots.map(function (p) { return p.u; }).concat(row.cols);
      L.segs.push({ u0: Math.min.apply(null, us), v0: row.laneV, u1: Math.max.apply(null, us), v1: row.laneV, w: 3, lane: true });
      row.cols.forEach(function (cu) { var k = row.side + ':' + cu; far[k] = Math.max(far[k] || 0, Math.abs(row.laneV)); });
    });
    for (var k in far) { var sd2 = +k.split(':')[0], cu2 = +k.split(':')[1]; L.segs.push({ u0: cu2, v0: sd2 * HOLD_V, u1: cu2, v1: sd2 * far[k], w: 3, col: true }); }
    L.usedCols = far;
  }
  function spotOK(L, u, v, C) {
    var r = Math.max(C.len, C.span) / 2, D = L.dbg || (L.dbg = { land: 0, cross: 0, fac: 0, lane: 0 });
    if (!L.landBox(u, v, C.span / 2, C.len / 2)) { D.land++; return false; }
    if (L.crossD(u, v) < RUN_HALF_W + r + 1.5) { D.cross++; return false; }
    if (L.facs.some(function (f) { return Math.hypot(f.u - u, f.v - v) < f.r + r + 1.5; })) { D.fac++; return false; }
    return true;
  }
  function laneOK(L, u, cu, v) {
    for (var t = 0; t <= 1.001; t += 0.1) {
      var uu = u + (cu - u) * t;
      if (!L.land(uu, v) || L.facs.some(function (f) { return Math.hypot(f.u - uu, f.v - v) < f.r + 4; })) return false;
    }
    return true;
  }

  // ---- paths (world points) ----
  function P(L, u, v) { return L.toW(u, v); }
  function outPath(L, sp, dir) {
    var sd = sp.side, e = -dir * TAXI_U, pts = [P(L, sp.u, sp.v), P(L, sp.u, sp.laneV), P(L, sp.col, sp.laneV), P(L, sp.col, sd * TAXI_V)];
    pts.push(P(L, e, sd * TAXI_V), P(L, e, sd * HOLD_V));
    var hs = pts.length - 1;
    pts.push(P(L, -dir * LINEUP_U, 0));
    pts.holdShort = hs;               // index of the hold-short point
    pts.lanes = [laneKey(sp), colKey(sd, sp.col)];
    return pts;
  }
  function inPath(L, sp, u0) {
    var sd = sp.side, pts = [P(L, u0, 0), P(L, sp.col, 0), P(L, sp.col, sd * HOLD_V), P(L, sp.col, sd * TAXI_V), P(L, sp.col, sp.laneV), P(L, sp.u, sp.laneV), P(L, sp.u, sp.v)];
    pts.offRunway = 2;                // past this point the plane is off the runway
    pts.lanes = [laneKey(sp), colKey(sd, sp.col)];
    return pts;
  }
  function laneKey(sp) { return 'r' + sp.row; }
  function colKey(sd, u) { return 'c' + sd + ':' + u; }
  // distance (site units) from a world point to the taxi network (runways count): the ground-ops test
  function netDist(L, x, z) {
    var q = L.toL(x, z), u = q.u, v = q.v, av = Math.abs(v), best = 1e9;
    if (Math.abs(u) <= 47) best = Math.min(best, Math.max(0, av - RUN_HALF_W));
    best = Math.min(best, Math.max(0, L.crossD(u, v) - RUN_HALF_W));
    if (Math.abs(u) <= TAXI_U) best = Math.min(best, Math.abs(av - TAXI_V));
    if (av <= TAXI_V + 0.1) best = Math.min(best, Math.abs(Math.abs(u) - TAXI_U));
    for (var i = 0; i < L.segs.length; i++) best = Math.min(best, segD(u, v, L.segs[i]));
    for (var k = 0; k < L.spots.length; k++) { // the spot and its driveway to the lane
      var p = L.spots[k]; best = Math.min(best, Math.max(0, Math.hypot(p.u - u, p.v - v) - p.len / 2), segD(u, v, { u0: p.u, v0: p.v, u1: p.u, v1: p.laneV }));
    }
    return best;
  }

  WW.airfieldLayout = { make: make, columns: columns, rows: rows, free: free, addFac: addFac, outPath: outPath, inPath: inPath,
    netDist: netDist, onNetwork: onNetwork, CLS: CLS, TAXI_V: TAXI_V, HOLD_V: HOLD_V, TAXI_U: TAXI_U, LINEUP_U: LINEUP_U };
})();
