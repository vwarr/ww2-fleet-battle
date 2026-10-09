// base_life_layout.js - WW.baseLifeLayout: the island base's camp around the airfield (sim: pure geometry from the
// terrain and the field's plan, no randomness). island_base.js build() calls place() after every facility and the
// coastal batteries are down, so nothing the sim already had moves. The camp is base.decor: Quonset huts and tents in
// rows, a mess hall with its sick bay, a command post with the flagpole, a radio shack with two masts, a water tower,
// machine-gun pits, slit trenches, fuel-drum stacks, searchlights, a motor pool (trucks and jeeps), a laundry line, a
// card table and a drill ground. Each item: { kind, u, v, x, z, a (world yaw of its +x), hx, hz (half extents along
// its +x / +z), r (bounding radius), hp, maxHp, out, outAt, solid (people walk round it), roof, decor: true }.
//  - Where: a 1 u grid of the free ground (on low land, off the taxi network and the climb-out lanes, clear of the
//    revetments and the facilities, flat). Each group (a row of huts, the mess with its sick bay, ...) goes to the
//    free place nearest its preferred spots, along the runway or turned across it, whichever fits first.
//  - Not facilities: no AI, strike or bombardment code reads base.decor, and base.hp ignores it. Bombs and shells
//    damage it (island_base impact(): hp, out = burnt / flattened) and the low-plane floor (roofAt) includes it.
//  - Visuals: models_base_life.js (models), base_life*.js (people, birds, night).
window.WW = window.WW || {};
(function () {
  'use strict';
  // hx, hz: half extents (item frame, +x along its yaw); hp; roof: top above the pad (island_base roofAt); solid:
  // people walk round it (pits, trenches, the laundry line and the drill ground are walked into)
  var K = {
    hut: [2.1, 1.0, 60, 1.4, 1], sick: [2.1, 1.0, 60, 1.4, 1], tent: [0.8, 0.8, 20, 1.2, 1], mess: [3.0, 1.4, 90, 2.4, 1],
    radio: [3.6, 0.9, 50, 8.6, 1], water: [1.2, 1.2, 60, 6.4, 1], cp: [1.6, 1.3, 120, 1.6, 1], flag: [0.35, 0.35, 400, 7, 1],
    mg: [1.3, 1.3, 50, 0.9, 0], trench: [3.0, 0.8, 400, 0.3, 0], drums: [1.0, 0.8, 25, 1, 1], light: [0.6, 0.6, 40, 1.6, 1],
    truck: [0.75, 0.36, 30, 1.0, 1], jeep: [0.55, 0.33, 20, 0.7, 1], laundry: [2.0, 0.3, 10, 1.5, 0], table: [0.35, 0.35, 10, 0.6, 1],
    drill: [3.6, 2.6, 1e9, 0, 0]
  };
  var H = Math.PI / 2;
  // groups: [name, preferred spots (site-local u, v), members [kind, du, dv, yaw]] (du along the group's axis, dv
  // across it, away from the runway on the side it stands; yaw 0: the item's +x along that axis). A preferred spot
  // can name a facility kind or an earlier group: anywhere beside it.
  var GROUPS = [
    ['huts', [[-74, 34], [74, -34], [-74, -34], [74, 34], [0, 76], [0, -76]],
      [['hut', -5.0, 0, 0], ['hut', 0, 0, 0], ['hut', 5.0, 0, 0]]],
    ['huts', ['huts'], [['hut', -5.0, 0, 0], ['hut', 0, 0, 0], ['hut', 5.0, 0, 0]]],
    ['mess', ['huts', [-66, -50], [66, 50]], [['mess', 0, 0, 0], ['sick', 6.4, 0.4, 0]]],
    ['tents', ['huts', [74, 30], [-74, -30]], [['tent', -4.4, 0, 0], ['tent', -2.2, 0, 0], ['tent', 0, 0, 0], ['tent', 2.2, 0, 0], ['tent', 4.4, 0, 0]]],
    ['tents', ['tents', 'huts'], [['tent', -3.3, 0, 0], ['tent', -1.1, 0, 0], ['tent', 1.1, 0, 0], ['tent', 3.3, 0, 0], ['laundry', 0, 2.4, 0], ['table', 4.6, 2.4, 0]]],
    ['cp', ['tower', 'huts'], [['cp', 0, 0, 0], ['flag', 3.0, 0, 0]]],
    ['motor', ['hangar', 'huts'], [['truck', -2.0, 0, H], ['truck', -0.7, 0, H], ['truck', 0.6, 0, H], ['jeep', 1.9, 0, H], ['jeep', 3.1, 0, H]]],
    ['radio', [[-20, 74], [20, -74], [-40, -74], [40, 74], [-84, 20]], [['radio', 0, 0, 0]]],
    ['water', ['huts', 'mess'], [['water', 0, 0, 0]]],
    ['drill', ['huts', 'tents'], [['drill', 0, 0, 0]]],
    ['trench', ['huts'], [['trench', 0, 0, 0]]], ['trench', ['mess'], [['trench', 0, 0, 0]]], ['trench', ['hangar', 'tower'], [['trench', 0, 0, 0]]],
    ['trench', ['tents', 'aa'], [['trench', 0, 0, 0]]], ['trench', ['tower', 'cp'], [['trench', 0, 0, 0]]],
    ['mg', [[46, 70], [-46, -70]], [['mg', 0, 0, 0]]], ['mg', [[-46, 70], [46, -70]], [['mg', 0, 0, 0]]],
    ['mg', [[82, -24], [-82, 24]], [['mg', 0, 0, 0]]], ['mg', [[-82, -24], [82, 24]], [['mg', 0, 0, 0]]],
    ['light', [[60, 60], [-60, -60]], [['light', 0, 0, 0]]], ['light', [[-60, 60], [60, -60]], [['light', 0, 0, 0]]],
    ['light', [[0, 70], [0, -70]], [['light', 0, 0, 0]]],
    ['drums', ['fuel', 'motor'], [['drums', 0, 0, 0]]]
  ];
  var FLAT = 0.35, GAP = 0.7, NET = 2, MAXD = 70, TRIES = 500;
  var U0 = -130, V0 = -115, NU = 261, NV = 231;

  // the free-ground grid (1 u cells): free (0/1) and the ground height
  function grid(base) {
    var L = base.layout, S = base.site, AL = WW.airfieldLayout, n = NU * NV, ok = new Uint8Array(n), hy = new Float32Array(n);
    var fac = base.facilities.map(function (f) { var q = L.toL(f.x, f.z); return [q.u, q.v, f.r + 1.2]; });
    for (var j = 0; j < NV; j++) for (var i = 0; i < NU; i++) {
      var u = U0 + i, v = V0 + j, w = L.toW(u, v), d = WW.terrain.depthAt(w.x, w.z), c = j * NU + i;
      hy[c] = Math.max(S.padH, -d);
      if (!(d < -0.6 && d > -2.6) || (Math.abs(u) < 50 && Math.abs(v) < L.TAXI_V + 6) || AL.onNetwork(L, u, v, NET) || AL.climbOut(L, u, v, NET)) continue;
      var bad = false;
      for (var k = 0; k < L.spots.length && !bad; k++) { var p = L.spots[k]; bad = Math.abs(p.u - u) < p.span / 2 + 2.2 && Math.abs(p.v - v) < p.len / 2 + 2.2; }
      for (k = 0; k < fac.length && !bad; k++) bad = Math.hypot(fac[k][0] - u, fac[k][1] - v) < fac[k][2];
      if (!bad) ok[c] = 1;
    }
    return { ok: ok, hy: hy, used: new Uint8Array(n) };
  }
  // the cells under an item's footprint (+ pad), in site-local u / v; yaw relative to the site's u axis
  function cells(u, v, hx, hz, yaw, pad, fn) {
    var c = Math.cos(yaw), s = Math.sin(yaw), R = Math.hypot(hx, hz) + pad;
    for (var dj = Math.floor(-R); dj <= Math.ceil(R); dj++) for (var di = Math.floor(-R); di <= Math.ceil(R); di++) {
      var a = di * c + dj * s, b = -di * s + dj * c;
      if (Math.abs(a) > hx + pad || Math.abs(b) > hz + pad) continue;
      var i = Math.round(u - U0) + di, j = Math.round(v - V0) + dj;
      if (i < 0 || j < 0 || i >= NU || j >= NV) { if (fn(-1) === false) return false; continue; }
      if (fn(j * NU + i) === false) return false;
    }
    return true;
  }
  function fits(G, u, v, k, yaw) {
    var lo = 1e9, hi = -1e9, D = K[k];
    var ok = cells(u, v, D[0], D[1], yaw, GAP, function (c) {
      if (c < 0 || !G.ok[c] || G.used[c]) return false;
      lo = Math.min(lo, G.hy[c]); hi = Math.max(hi, G.hy[c]);
    });
    return ok && hi - lo < FLAT;
  }
  // preferred spots: points, or everything already placed of a facility kind / group name (spots round it)
  function prefs(base, list, placed) {
    var out = [], L = base.layout;
    list.forEach(function (p) {
      if (typeof p !== 'string') { out.push(p); return; }
      base.facilities.forEach(function (f) { if (f.kind === p) { var q = L.toL(f.x, f.z); out.push([q.u, q.v]); } });
      (placed[p] || []).forEach(function (g) { out.push([g.u, g.v]); });
    });
    return out;
  }
  function place(base) {
    var L = base.layout, S = base.site, list = base.decor = [], placed = {};
    if (!L) return list;
    var G = grid(base), cand = [];
    for (var j = 0; j < NV; j += 2) for (var i = 0; i < NU; i += 2) if (G.ok[j * NU + i]) cand.push([U0 + i, V0 + j]);
    GROUPS.forEach(function (gp) {
      var name = gp[0], P = prefs(base, gp[1], placed), mem = gp[2];
      if (!P.length) return;
      var sc = cand.map(function (c) { var d = 1e9; for (var k = 0; k < P.length; k++) d = Math.min(d, Math.hypot(c[0] - P[k][0], c[1] - P[k][1])); return [d, c[0], c[1]]; })
        .filter(function (q) { return q[0] < MAXD; }).sort(function (a, b) { return a[0] - b[0]; });
      for (var t = 0; t < Math.min(TRIES, sc.length); t++) {
        var cu = sc[t][1], cv = sc[t][2], sv = cv >= 0 ? 1 : -1, got = null;
        for (var o = 0; o < 2 && !got; o++) {      // along the runway, else turned across it
          var ax = o ? H : 0, ca = Math.cos(ax), sa = Math.sin(ax), all = [];
          for (var m = 0; m < mem.length; m++) {
            var du = mem[m][1], dv = sv * mem[m][2], u = cu + du * ca - dv * sa, v = cv + du * sa + dv * ca, yaw = ax + mem[m][3];
            if (!fits(G, u, v, mem[m][0], yaw)) { all = null; break; }
            all.push([mem[m][0], u, v, yaw]);
          }
          if (all) got = all;
        }
        if (!got) continue;
        got.forEach(function (q) {
          var D = K[q[0]], w = L.toW(q[1], q[2]);
          cells(q[1], q[2], D[0], D[1], q[3], 0.2, function (c) { if (c >= 0) G.used[c] = 1; });
          list.push({ kind: q[0], decor: true, group: name, u: q[1], v: q[2], x: w.x, z: w.z, a: S.h + q[3], hx: D[0], hz: D[1],
            r: Math.hypot(D[0], D[1]), hp: D[2], maxHp: D[2], out: false, outAt: 0, roof: D[3], solid: !!D[4] });
        });
        (placed[name] = placed[name] || []).push({ u: cu, v: cv });
        break;
      }
    });
    return list;
  }
  // blast damage to the camp (island_base impact): hp down, out at 0 (no events: nothing in the sim reads it)
  function hit(base, x, z, dmg, blast) {
    var D = base.decor; if (!D) return;
    for (var i = 0; i < D.length; i++) {
      var d = D[i]; if (d.out || d.kind === 'drill') continue;
      var dist = Math.hypot(x - d.x, z - d.z), reach = d.r + blast;
      if (dist >= reach) continue;
      d.hp -= dmg * (dist < d.r ? 1 : 1 - (dist - d.r) / blast * 0.8);
      if (d.hp <= 0) { d.hp = 0; d.out = true; d.outAt = WW.time.now; }
    }
  }
  WW.baseLifeLayout = { place: place, hit: hit, K: K, GROUPS: GROUPS };
})();
