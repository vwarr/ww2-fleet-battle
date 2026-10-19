// base_life_layout.js - WW.baseLifeLayout: the island base's camp and the flight line's clutter (sim: pure geometry from
// the terrain and the field's plan, no randomness). island_base.js build() calls place() after every facility and the
// coastal batteries are down, so nothing the sim already had moves. The camp is base.decor: Quonset huts and tents in
// rows, a mess hall with its sick bay, a command post with the flagpole, a radio shack with two masts, a water tower,
// machine-gun pits, slit trenches, fuel-drum stacks, searchlights, a motor pool (trucks and jeeps), a laundry line, a
// card table and a drill ground. Each item: { kind, u, v, x, z, a (world yaw of its +x), hx, hz (half extents along
// its +x / +z), r (bounding radius), hp, maxHp, out, outAt, solid (people walk round it), roof, decor: true }.
//  - Where: a 1 u grid of the free ground (on low land of the field's own island (airfield_layout home()), off the taxi
//    network and the climb-out lanes, clear of the revetments and the facilities and of the trucks' ways out of the
//    fuel farm, the ammunition dump and the hangars, flat). Each group (a row of huts, the mess with its sick bay, ...)
//    goes to the free place nearest its preferred spots, along the runway or turned across it, whichever fits first.
//  - Busy like a 1942-43 Pacific field (Henderson, Espiritu Santo, Rabaul, Munda; 2026-10-19): the camp's tent lines
//    and huts stand just off the parallel taxiway, mid-field on the side with room (true-size site-local spots; they
//    were past the runway ends, 1 km from the flight line), and the dispersal area is cluttered: behind and at the ends
//    of every row of revetments a service point (bomb dump, fuel-drum rows, crates, Marston-mat stacks (IJN: lumber),
//    an open-sided maintenance tent), a line shack (the operations hut, its windsock and sortie board) by the taxiway.
//    The clutter has no roof (roofAt: a plane's floor is unchanged by it) and no AI, strike or score code reads it.
//  - Not facilities: no AI, strike or bombardment code reads base.decor, and base.hp ignores it. Bombs and shells
//    damage it (island_base impact(): hp, out = burnt / flattened) and the low-plane floor (roofAt) includes it.
//  - Visuals: models_base_life.js (models, instanced per kind), base_life*.js (people, birds, night).
window.WW = window.WW || {};
(function () {
  'use strict';
  // hx, hz: half extents (item frame, +x along its yaw); hp; roof: top above the pad (island_base roofAt); solid:
  // people walk round it (pits, trenches, the laundry line and the drill ground are walked into)
  var K = {
    hut: [2.1, 1.0, 120, 1.4, 1], sick: [2.1, 1.0, 120, 1.4, 1], tent: [1.15, 1.15, 50, 1.2, 1], mess: [3.0, 1.4, 160, 2.4, 1],
    radio: [3.7, 0.95, 50, 8.6, 1], water: [1.2, 1.2, 60, 6.4, 1], cp: [1.75, 1.45, 120, 1.6, 1], flag: [0.35, 0.35, 400, 7, 1],
    mg: [1.3, 1.3, 50, 0.9, 0], trench: [3.1, 1.15, 400, 0.3, 0], drums: [1.0, 0.8, 25, 1, 1], light: [0.8, 0.8, 40, 1.6, 1],
    truck: [0.75, 0.36, 30, 1.0, 1], fire: [0.75, 0.36, 30, 1.0, 1], jeep: [0.55, 0.33, 20, 0.7, 1], laundry: [2.0, 0.3, 10, 1.5, 0], table: [0.35, 0.35, 10, 0.6, 1],
    drill: [3.6, 2.6, 1e9, 0, 0], yard: [3.8, 1.1, 1e9, 0, 0],   // yard: the motor pool's forecourt (kept clear)
    // the flight line's clutter (roof 0: no low-plane floor; models_base_life.js): a bomb dump in its sandbag U, fuel
    // drums on their sides on log rails, a crate stack, Marston-mat stacks (IJN: a lumber pile), an open-sided
    // maintenance tent over an engine stand, the line shack (operations hut, windsock, sortie board)
    bombs: [2.2, 1.3, 40, 0, 1], drumrow: [2.1, 0.9, 25, 0, 1], crates: [1.2, 0.9, 20, 0, 1], mat: [1.3, 1.1, 30, 0, 1],
    shop: [2.6, 1.7, 60, 0, 1], ops: [2.0, 1.3, 100, 0, 1], tentL: [1.15, 1.15, 50, 0, 1]
  };
  // True size (2026-10-18): the camp was drawn ~2.5x (a Quonset hut 40 m long, the radio masts 80 m); CAMP_K brings
  // every item, its offsets in the groups below and its model (models_base_life.js) to real size: a hut 16 x 8 m,
  // the mess hall 23 x 11 m, the masts 33 m, the water tower 25 m. The parked vehicles follow the base vehicles'
  // VEH_K instead (models_base.js; the extents above were written at the 0.82 plane scale's 0.56).
  var CAMP_K = 0.4, VEH_R = Math.pow(WW.cfg.PLANE_K || 1, 0.8) / 0.558, CAR = { truck: 1, fire: 1, jeep: 1, yard: 1 };
  for (var kk in K) { var kr = CAR[kk] ? VEH_R : CAMP_K; K[kk][0] *= kr; K[kk][1] *= kr; K[kk][3] *= kr; }
  var H = Math.PI / 2;
  // groups: [name, preferred spots (site-local u, v at true size), members [kind, du, dv, yaw]] (du along the group's
  // axis, dv across it, away from the runway on the side it stands; yaw 0: the item's +x along that axis). A preferred
  // spot can name a facility kind or an earlier group: anywhere beside it. The camp's first hut row goes beside the
  // parallel taxiway mid-field (TAXI_V 16; the camp's ground starts at |v| ~23), on whichever side has room (the
  // dispersal rows fill the other); everything after it keys on it, so the camp stays one cluster (the alarm's camera
  // focus, island_base raiseAlarm, is its centre).
  var GROUPS = [
    ['huts', 'side', [['hut', -3.4, 0, H], ['hut', 0, 0, H], ['hut', 3.4, 0, H]]],   // side: the camp's side (place())
    ['huts', ['huts'], [['hut', -3.4, 0, H], ['hut', 0, 0, H], ['hut', 3.4, 0, H]]],
    ['mess', ['huts'], [['mess', 0, 0, 0], ['sick', 7.8, 0.4, 0]]],
    ['huts', ['huts', 'mess'], [['hut', -3.4, 0, H], ['hut', 0, 0, H], ['hut', 3.4, 0, H], ['hut', 6.8, 0, H]]],
    ['tents', ['huts'], [['tent', -5.2, 0, H], ['tent', -2.6, 0, H], ['tent', 0, 0, H], ['tent', 2.6, 0, H], ['tent', 5.2, 0, H]]],
    ['tents', ['tents', 'huts'], [['tent', -3.9, 0, H], ['tent', -1.3, 0, H], ['tent', 1.3, 0, H], ['tent', 3.9, 0, H], ['laundry', 0, -2.8, 0], ['table', 4.8, -2.8, 0]]],
    ['tents', ['tents'], [['tent', -5.2, 0, H], ['tent', -2.6, 0, H], ['tent', 0, 0, H], ['tent', 2.6, 0, H], ['tent', 5.2, 0, H], ['tent', 7.8, 0, H]]],
    ['tents', ['tents'], [['tent', -3.9, 0, H], ['tent', -1.3, 0, H], ['tent', 1.3, 0, H], ['tent', 3.9, 0, H], ['tent', 6.5, 0, H]]],
    ['tents', ['tents'], [['tent', -5.2, 0, H], ['tent', -2.6, 0, H], ['tent', 0, 0, H], ['tent', 2.6, 0, H], ['tent', 5.2, 0, H], ['tent', 7.8, 0, H]]],
    ['tents', ['tents'], [['tent', -3.9, 0, H], ['tent', -1.3, 0, H], ['tent', 1.3, 0, H], ['tent', 3.9, 0, H], ['tent', 6.5, 0, H], ['tent', 9.1, 0, H]]],
    ['huts', ['tents', 'huts'], [['hut', -3.4, 0, H], ['hut', 0, 0, H], ['hut', 3.4, 0, H]]],
    ['cp', ['huts', 'mess'], [['cp', 0, 0, 0], ['flag', 0, 2.8, 0]]],
    ['motor', ['huts', 'mess'], [['yard', 0.5, 2.6, 0], ['yard', 0.5, -2.6, 0], ['fire', -2.6, 0, H], ['truck', -1.3, 0, H], ['truck', 0, 0, H], ['truck', 1.3, 0, H], ['jeep', 2.5, 0, H], ['jeep', 3.6, 0, H]]],
    ['radio', ['tents', 'huts'], [['radio', 0, 0, 0]]],
    ['water', ['huts', 'mess'], [['water', 0, 0, 0]]],
    ['drill', ['huts', 'tents'], [['drill', 0, 0, 0]]],
    ['trench', ['huts'], [['trench', 0, 0, 0]]], ['trench', ['mess'], [['trench', 0, 0, 0]]], ['trench', ['tents'], [['trench', 0, 0, 0]]],
    ['trench', ['tents', 'aa'], [['trench', 0, 0, 0]]], ['trench', ['cp'], [['trench', 0, 0, 0]]],
    ['mg', [[-60, 27], [60, -27]], [['mg', 0, 0, 0]]], ['mg', [[60, 27], [-60, -27]], [['mg', 0, 0, 0]]],
    ['mg', [[-20, 66], [20, -66]], [['mg', 0, 0, 0]]], ['mg', [[20, 66], [-20, -66]], [['mg', 0, 0, 0]]],
    ['mg', [[-82, 26], [82, -26]], [['mg', 0, 0, 0]]], ['mg', [[82, 26], [-82, -26]], [['mg', 0, 0, 0]]],
    ['light', [[50, 50], [-50, -50]], [['light', 0, 0, 0]]], ['light', [[-50, 50], [50, -50]], [['light', 0, 0, 0]]],
    ['light', [[0, 60], [0, -60]], [['light', 0, 0, 0]]],
    ['drums', ['motor'], [['drums', 0, 0, 0]]]
  ];
  GROUPS.forEach(function (g) {   // the members' offsets at true size
    g[2].forEach(function (m) { var k = CAR[m[0]] || g[0] === 'motor' ? VEH_R : CAMP_K; m[1] *= k; m[2] *= k; });
  });
  // the flight line's service points (per base: they follow its dispersal rows): kits of clutter (offsets x CAMP_K)
  var KITS = [
    [['bombs', 0, 0, 0], ['crates', 4.0, 0.2, 0]],
    [['drumrow', 0, 0, 0], ['drumrow', 0, 2.2, 0]],
    [['shop', 0, 0, 0], ['crates', 4.0, -0.4, H]],
    [['mat', 0, 0, 0], ['mat', 3.0, 0.1, 0], ['drumrow', -4.6, 0, 0]],
    [['bombs', 0, 0, 0], ['bombs', 0, 3.0, 0]],
    [['crates', 0, 0, 0], ['drumrow', 3.6, 0, 0], ['mat', -3.2, 0, 0]]
  ];
  var TENTS = [[-5.2, -2.6, 0, 2.6, 5.2], [-3.9, -1.3, 1.3, 3.9]].map(function (r) { return r.map(function (du) { return ['tentL', du, 0, H]; }); });
  KITS.concat(TENTS).forEach(function (kit) { kit.forEach(function (m) { m[1] *= CAMP_K; m[2] *= CAMP_K; }); });
  // the service groups of a base [name, prefs, members, max distance]: behind every third revetment of each row and
  // past both ends of it, a line shack by the taxiway in front of the camp, service points along the taxiway on the
  // camp's side; each within SVC_D of its spot or left out (no wandering across the field)
  var SVC_D = 9;
  function service(base, placed) {
    var L = base.layout, out = [], n = 0, kit = function () { return KITS[n++ % KITS.length]; };
    L.rows.forEach(function (row) {
      var sp = row.spots.slice().sort(function (a, b) { return a.u - b.u; }), sd = row.side;
      if (!sp.length) return;
      var C = L.CLS[row.cls], back = row.spotV + sd * (C.len / 2 + 3.2), endU = C.span / 2 + 3.4;
      for (var i = 1; i < sp.length; i += 3) out.push(['svc', [[sp[i].u, back]], kit(), SVC_D]);
      out.push(['svc', [[sp[0].u - endU, row.spotV], [sp[0].u - endU, back]], kit(), SVC_D]);
      out.push(['svc', [[sp[sp.length - 1].u + endU, row.spotV], [sp[sp.length - 1].u + endU, back]], kit(), SVC_D]);
    });
    var hs = placed.huts || [];
    if (hs.length) {
      var cu = hs.reduce(function (s, g) { return s + g.u; }, 0) / hs.length, sv = hs[0].v >= 0 ? 1 : -1, TV = L.TAXI_V + 8;
      out.push(['ops', [[cu + 6, sv * TV], [cu - 6, sv * TV]], [['ops', 0, 0, 0], ['crates', 3.4 * CAMP_K, 0.3 * CAMP_K, 0]], 14]);
      for (var du = -72; du <= 72; du += 12) if (Math.abs(du) > 8) out.push(['svc', [[cu + du, sv * TV]], kit(), SVC_D]);
      for (du = -66; du <= 66; du += 22) out.push(['svc', [[cu + du, sv * (TV + 14)]], kit(), SVC_D]);
      // the squadrons' tent lines further along the field (tentL: the camp's tent, no doors for base_life.js and not
      // in the alarm camera's camp focus)
      for (du = -64; du <= 64; du += 16) if (Math.abs(du) > 12) {
        out.push(['tentL', [[cu + du, sv * (TV + 20)]], TENTS[(du / 16 + 4) % 2], 12]);
        out.push(['tentL', [[cu + du + 8, sv * (TV + 30)]], TENTS[(du / 16 + 5) % 2], 12]);
      }
    }
    return out;
  }
  var FLAT = 0.35, GAP = 0.7 * CAMP_K + 0.2, NET = 2, MAXD = 70, TRIES = 500;
  var U0 = -150, V0 = -115, NU = 301, NV = 231;

  // the free-ground grid (1 u cells): free (0/1) and the ground height
  function grid(base) {
    var L = base.layout, S = base.site, AL = WW.airfieldLayout, n = NU * NV, ok = new Uint8Array(n), hy = new Float32Array(n);
    var fac = base.facilities.map(function (f) { var q = L.toL(f.x, f.z); return [q.u, q.v, f.r + 1.2]; });
    // the fuel trucks', bomb carts' and crash trucks' ways out (base_ground_fx.js exitTo: from the building to the
    // taxiway corner at its end of the field, straight or L-shaped): the box between the two, kept clear
    var k0 = AL.CLS.L.span / 2 + 1, ways = base.facilities.filter(function (f) { return f.kind === 'fuel' || f.kind === 'ammo' || f.kind === 'hangar'; }).map(function (f) {
      var q = L.toL(f.x, f.z), cu = (q.u >= 0 ? 1 : -1) * (L.TAXI_U + k0), cv = (q.v >= 0 ? 1 : -1) * (L.TAXI_V + k0), p = f.r + 2.5;
      return [Math.min(q.u, cu) - p, Math.max(q.u, cu) + p, Math.min(q.v, cv) - p, Math.max(q.v, cv) + p];
    });
    for (var j = 0; j < NV; j++) for (var i = 0; i < NU; i++) {
      var u = U0 + i, v = V0 + j, w = L.toW(u, v), d = WW.terrain.depthAt(w.x, w.z), c = j * NU + i;
      hy[c] = Math.max(S.padH, -d);
      if (!(d < -0.6 && d > -2.6) || !AL.home(L, u, v) || (Math.abs(u) < AL.HALF + 7 && Math.abs(v) < L.TAXI_V + 6) || AL.onNetwork(L, u, v, NET) || AL.climbOut(L, u, v, NET)) continue;
      var bad = false;
      for (var k = 0; k < L.spots.length && !bad; k++) { var p = L.spots[k]; bad = Math.abs(p.u - u) < p.span / 2 + 2.2 && Math.abs(p.v - v) < p.len / 2 + 2.2; }
      for (k = 0; k < fac.length && !bad; k++) bad = Math.hypot(fac[k][0] - u, fac[k][1] - v) < fac[k][2];
      for (k = 0; k < ways.length && !bad; k++) bad = u > ways[k][0] && u < ways[k][1] && v > ways[k][2] && v < ways[k][3];
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
    var put = function (gp) {
      var name = gp[0], P = prefs(base, gp[1], placed), mem = gp[2], maxD = gp[3] || MAXD;
      if (!P.length) return;
      var sc = cand.map(function (c) { var d = 1e9; for (var k = 0; k < P.length; k++) d = Math.min(d, Math.hypot(c[0] - P[k][0], c[1] - P[k][1])); return [d, c[0], c[1]]; })
        .filter(function (q) { return q[0] < maxD; }).sort(function (a, b) { return a[0] - b[0]; });
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
        return true;
      }
      return false;
    };
    // the camp's side: the one with fewer revetments (the dispersal rows fill the other), its first hut row beside the
    // taxiway mid-field; else the other side
    var n1 = 0; L.spots.forEach(function (p) { n1 += p.side > 0 ? 1 : -1; });
    var sv = n1 > 0 ? -1 : 1, CAMP = [[-24, 27], [24, 27], [0, 30], [-50, 30], [50, 30]];
    GROUPS.forEach(function (gp) {
      if (gp[1] !== 'side') return put(gp);
      if (!put([gp[0], CAMP.map(function (p) { return [p[0], sv * p[1]]; }), gp[2]])) put([gp[0], CAMP.map(function (p) { return [p[0], -sv * p[1]]; }), gp[2]]);
    });
    service(base, placed).forEach(put);   // the flight line's clutter last: the camp keeps its places
    return list;
  }
  // blast damage to the camp (island_base impact): hp down, out at 0 (no events: nothing in the sim reads it)
  function hit(base, x, z, dmg, blast) {
    var D = base.decor; if (!D) return;
    for (var i = 0; i < D.length; i++) {
      var d = D[i]; if (d.out || d.kind === 'drill' || d.kind === 'yard') continue;
      var dist = Math.hypot(x - d.x, z - d.z), reach = d.r + blast;
      if (dist >= reach) continue;
      d.hp -= dmg * (dist < d.r ? 1 : 0.5 * (1 - (dist - d.r) / blast));   // a near miss scorches, a direct hit flattens
      if (d.hp <= 0) { d.hp = 0; d.out = true; d.outAt = WW.time.now; }
    }
  }
  WW.baseLifeLayout = { place: place, hit: hit, K: K, GROUPS: GROUPS, CAMP_K: CAMP_K };
})();
