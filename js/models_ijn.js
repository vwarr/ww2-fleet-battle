// models_ijn.js (owner B) - IJN 1942 surface classes, true size (ship_classes.js), in the toy style. Load after models_detail.js.
// Kongo / Nagato BB (pagoda masts), Takao (the huge bridge) / Mogami CA, Kagero / Fubuki DD, Type B1 I-boat, Gyoraitei.
// Positions are shares of the hull length (X(f), f from -0.5 stern to +0.5 bow), heights from the hull's own deck line.
// Turrets are made main battery first, then secondaries, in the order of the class's guns (one per mount).
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, CL = WW.models.CLASS;
  function setup(P, c, K, color) {
    var s = K.classHull(P, c, color), L = c.len;
    return { s: s, g: s.group, L: L, B: c.beam, D: c.hull.top, X: function (f) { return f * L; }, dk: function (x) { return K.deckAt(s, x); } };
  }

  // ---------------- battleships: 4 twin turrets, a pagoda ----------------
  function ijnBB(P, c, K, ng) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var h0 = ng ? X(-0.16) : X(-0.14), h1 = X(0.17), H = 0.75;
    K.box(g, P.super, h1 - h0, H, B * 0.64, (h0 + h1) / 2, Dk, 0);
    K.box(g, P.super, 1.6, 0.55, 1.6, X(0.235), o.dk(X(0.235)), 0);
    K.turret(s, P, 'big', X(0.33), o.dk(X(0.33)), 0, 0, 2, 0.95);
    K.turret(s, P, 'big', X(0.235), o.dk(X(0.235)) + 0.55, 0, 0, 2, 0.95);
    if (ng) {                                                                   // Nagato: C superfiring over D, both aft
      K.box(g, P.super, 1.6, 0.55, 1.6, X(-0.235), o.dk(X(-0.235)), 0);
      K.turret(s, P, 'big', X(-0.235), o.dk(X(-0.235)) + 0.55, 0, PI, 2, 0.95);
      K.turret(s, P, 'big', X(-0.33), o.dk(X(-0.33)), 0, PI, 2, 0.95);
    } else {                                                                    // Kongo: C amidships between the funnels and the mainmast, D aft
      K.turret(s, P, 'big', X(-0.2), Dk + H, 0, PI, 2, 0.92);
      K.turret(s, P, 'big', X(-0.34), o.dk(X(-0.34)), 0, PI, 2, 0.95);
    }
    K.turret(s, P, 'small', X(0.05), Dk + 0.1, B * 0.38, -PI / 2, 1, 0.85);   // casemate secondaries
    K.turret(s, P, 'small', X(0.05), Dk + 0.1, -B * 0.38, PI / 2, 1, 0.85);
    var y = Dk + H, px = X(0.13);
    var lv = ng ? [[2.4, 1.9, 0.55], [2.1, 1.7, 0.4], [1.9, 1.5, 0.45], [2.2, 1.6, 0.35], [1.6, 1.3, 0.45], [1.9, 1.5, 0.35], [1.3, 1.1, 0.4], [1.5, 1.2, 0.3], [0.9, 0.8, 0.35]]
      : [[2.0, 1.6, 0.5], [1.7, 1.4, 0.4], [1.5, 1.2, 0.42], [1.75, 1.35, 0.32], [1.2, 1.0, 0.4], [1.45, 1.15, 0.3], [0.85, 0.8, 0.35]];
    var top = K.pagoda(g, P, px, y, lv, 0.06, ng ? [3, 5, 7] : [3, 5]);
    D.rangefinder(g, P, px - lv.length * 0.06, top, 0, ng ? 1.8 : 1.5);
    K.cyl(g, K.C.dark, 0.06, 1.0, px - 0.5, top - 0.2, 0);
    if (ng) {                                                                   // one big funnel, its cap swept back
      K.funnel(s, P, X(0.03), y, 0.82, 2.0, 0.22, 0.6);
      K.box(g, P.super, 1.3, 0.25, 1.1, X(0.03) - 0.75, y + 1.85, 0).rotation.z = 0.25;
      K.tripod(g, P, X(-0.1), y, 2.1);
    } else {                                                                    // two funnels, the fore one bigger
      K.funnel(s, P, X(0.025), y, 0.72, 1.9, 0.08, 0.55);
      K.funnel(s, P, X(-0.065), y, 0.6, 1.6, 0.08, 0.48);
      K.tripod(g, P, X(-0.13), y, 2.0);
    }
    D.both(function (k) {
      [X(-0.04), X(0.08)].forEach(function (x, i) { D.aaTub(g, P, x, y, k * B * 0.27, i === 0, k > 0 ? -PI / 2 : PI / 2); });
      D.lifeboat(g, X(-0.1), y, k * B * 0.24);
      D.searchlight(g, X(-0.0), y + 1.0, k * 0.55);
    });
    D.catapult(g, X(-0.43), o.dk(X(-0.43)), 0.6, 1.5, 0.3);
    s.floatplane = D.floatplane(g, P, X(-0.43), o.dk(X(-0.43)) + 0.08, 0.6, 0.3);
    D.crane(g, P, X(-0.47), o.dk(X(-0.47)), -0.9, 0.8);
    D.planks(g, P, s.hull, [-B * 0.42, -B * 0.36, B * 0.36, B * 0.42], 0.12, 0.66);
    D.common(g, P, s.hull, 1.0);
    return s;
  }
  CL.kongo = function (P, c, isJ, K) { return ijnBB(P, c, K, false); };
  CL.nagato = function (P, c, isJ, K) { return ijnBB(P, c, K, true); };

  // ---------------- heavy cruisers: 5 twin 8-inch (3 fore, 2 aft) ----------------
  function ijnCA(P, c, K, tk) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var h0 = X(-0.15), h1 = X(0.17), H = 0.5;
    K.box(g, P.super, h1 - h0, H, B * 0.7, (h0 + h1) / 2, Dk, 0);
    K.box(g, P.super, 1.1, 0.45, 1.1, X(0.29), o.dk(X(0.29)), 0);
    K.box(g, P.super, 1.1, tk ? 0.45 : 0.85, 1.1, X(0.22), o.dk(X(0.22)), 0);
    K.turret(s, P, 'med', X(0.36), o.dk(X(0.36)), 0, 0, 2, 0.9);
    K.turret(s, P, 'med', X(0.29), o.dk(X(0.29)) + 0.45, 0, 0, 2, 0.9);
    K.turret(s, P, 'med', X(0.22), o.dk(X(0.22)) + (tk ? 0.45 : 0.85), 0, 0, 2, 0.9);
    K.box(g, P.super, 1.1, 0.45, 1.1, X(-0.23), o.dk(X(-0.23)), 0);
    K.turret(s, P, 'med', X(-0.23), o.dk(X(-0.23)) + 0.45, 0, PI, 2, 0.9);
    K.turret(s, P, 'med', X(-0.3), o.dk(X(-0.3)), 0, PI, 2, 0.9);
    var y = Dk + H, bx = X(0.135), top;
    if (tk) {   // Takao: the massive bridge block, as wide as the deckhouse and nearly as tall as a battleship's tower
      top = K.pagoda(g, P, bx, y, [[2.3, B * 0.7, 0.55], [2.1, B * 0.66, 0.45], [1.9, B * 0.6, 0.45], [1.6, B * 0.52, 0.4], [1.1, 0.9, 0.35]], 0.06, [1, 2, 3]);
      D.rangefinder(g, P, bx - 0.3, top, 0, 1.3);
      K.tripod(g, P, bx - 1.3, y + 0.9, 1.9, 0.8);
      K.funnel(s, P, X(0.02), y, 0.62, 1.55, 0.42, 0.5);                       // the big trunked funnel, raked hard
      K.funnel(s, P, X(-0.05), y, 0.38, 1.25, 0.2, 0.32);
    } else {    // Mogami: a compact bridge, one trunked funnel
      top = K.pagoda(g, P, bx, y, [[1.6, B * 0.56, 0.5], [1.4, B * 0.5, 0.42], [1.1, 0.95, 0.38], [0.8, 0.7, 0.3]], 0.05, [1, 2]);
      D.rangefinder(g, P, bx - 0.2, top, 0, 1.2);
      K.tripod(g, P, bx - 1.0, y + 0.5, 1.8, 0.75);
      K.funnel(s, P, X(-0.005), y, 0.68, 1.45, 0.38, 0.52);
    }
    K.tripod(g, P, X(-0.12), y, 1.7, 0.75);
    D.radar(g, X(-0.12), y + 1.75, 0, 0.5);
    D.both(function (k) {
      D.catapult(g, X(-0.15), y, k * B * 0.22, 1.3, k * 0.4);
      D.aaTub(g, P, X(-0.06), y, k * B * 0.3, true, k > 0 ? -PI / 2 : PI / 2);
      D.lifeboat(g, X(0.0), Dk, k * B * 0.44);
      K.xc(g, P.gun, 0.11, 0.95, X(-0.07), Dk + 0.12, k * B * 0.42);                             // Long Lance tubes
    });
    s.floatplane = D.floatplane(g, P, X(-0.15), y + 0.08, B * 0.22, 0.4);
    D.crane(g, P, X(-0.19), y, -B * 0.25, -0.6);
    D.planks(g, P, s.hull, [-B * 0.4, B * 0.4], 0.12, 0.66);
    D.common(g, P, s.hull, 1.0);
    return s;
  }
  CL.takao = function (P, c, isJ, K) { return ijnCA(P, c, K, true); };
  CL.mogami = function (P, c, isJ, K) { return ijnCA(P, c, K, false); };

  // ---------------- destroyers: raised forecastle, 3 twin 5-inch (1 fore, 2 aft), raked funnels ----------------
  function ijnDD(P, c, K, fb) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var fc0 = X(0.13), fc1 = X(0.43);                                                               // forecastle
    K.box(g, s.hullMats[1], fc1 - fc0, 0.18, B * 0.86, (fc0 + fc1) / 2, Dk - 0.02, 0);
    var fy = Dk + 0.16;
    K.turret(s, P, 'small', X(0.35), o.dk(X(0.35)) + 0.16, 0, 0, 2, 0.85);
    var bx = X(0.2);
    if (fb) { K.bridge(g, P, 0.95, 0.5, B * 0.66, bx, fy); K.bridge(g, P, 0.7, 0.42, B * 0.5, bx - 0.05, fy + 0.5); K.box(g, P.super, 0.45, 0.22, 0.4, bx - 0.05, fy + 0.92, 0); }
    else { K.bridge(g, P, 0.85, 0.45, B * 0.6, bx, fy); K.bridge(g, P, 0.6, 0.32, B * 0.45, bx - 0.05, fy + 0.45); }
    K.tripod(g, P, X(0.14), fy, 1.3, 0.55);
    K.box(g, P.super, X(0.24), 0.25, B * 0.5, X(-0.02), Dk, 0);
    if (fb) { K.funnel(s, P, X(0.06), Dk + 0.25, 0.36, 1.0, 0.2, 0.3); K.funnel(s, P, X(-0.04), Dk + 0.25, 0.26, 0.85, 0.2, 0.22); }
    else { K.funnel(s, P, X(0.055), Dk + 0.25, 0.3, 0.95, 0.22, 0.26); K.funnel(s, P, X(-0.045), Dk + 0.25, 0.27, 0.9, 0.22, 0.23); }
    [X(0.0), X(-0.12)].concat(fb ? [X(-0.18)] : []).forEach(function (x) {                       // torpedo mounts
      K.xc(g, P.gun, 0.11, 1.0, x, Dk + 0.14, 0); D.c6(g, P.super, 0.2, 0.08, x, Dk, 0);
    });
    K.box(g, P.super, X(0.1), 0.3, B * 0.55, X(-0.27), Dk, 0);
    K.turret(s, P, 'small', X(-0.26), Dk + 0.3, 0, PI, 2, 0.85);
    K.turret(s, P, 'small', X(-0.36), o.dk(X(-0.36)), 0, PI, 2, 0.85);
    K.pole(g, X(-0.2), Dk + 0.3, 0.9, 0.6);
    D.both(function (k) {
      D.aaTub(g, P, X(0.03), Dk + 0.25, k * B * 0.25, false, k > 0 ? -PI / 2 : PI / 2);
      for (var i = 0; i < 3; i++) D.x6(g, K.C.dark, 0.08, 0.15, X(-0.46) + i * 0.18, Dk + 0.08, k * 0.3);
    });
    D.searchlight(g, X(-0.08), Dk + 0.25, 0);
    D.common(g, P, s.hull, 0.7);
    return s;
  }
  CL.kagero = function (P, c, isJ, K) { return ijnDD(P, c, K, false); };
  CL.fubuki = function (P, c, isJ, K) { return ijnDD(P, c, K, true); };

  // ---------------- submarine: Type B1, the floatplane hangar forward of the tower ----------------
  CL.iboat = function (P, c, isJ, K) {
    var hc = new THREE.Color(P.hull).multiplyScalar(0.72).getHex(), D = WW.models.D;
    var o = setup(P, c, K, hc), s = o.s, g = o.g, X = o.X, Dk = o.D;
    s.hullMats[1].color.copy(K.soft(new THREE.Color(P.hull).multiplyScalar(0.6).getHex()));
    var tm = s.hullMats[0];
    K.box(g, tm, X(0.76), 0.12, 0.55, X(0.0), Dk, 0);
    K.box(g, tm, 1.7, 0.8, 0.52, X(-0.02), Dk, 0);                                                 // conning tower
    K.box(g, s.hullMats[2], 0.9, 0.08, 0.54, X(-0.0), Dk + 0.76, 0);
    K.xc(g, tm, 0.3, 1.7, X(0.13), Dk + 0.32, 0);                                                    // hangar
    D.s8(g, tm, 0.5, 0.6, 0.6, X(0.13) + 0.85, Dk + 0.32, 0);
    K.box(g, tm, 2.2, 0.06, 0.16, X(0.33), Dk + 0.1, 0);                                             // catapult
    K.cyl(g, tm, 0.045, 0.9, X(0.0), Dk + 0.8, 0); K.cyl(g, tm, 0.045, 0.75, X(-0.04), Dk + 0.8, 0);
    K.xc(g, tm, 0.06, 0.85, X(-0.15) + 0.35, Dk + 0.32, 0); K.box(g, tm, 0.3, 0.28, 0.3, X(-0.15), Dk + 0.08, 0);
    return s;
  };

  // ---------------- motor torpedo boat ----------------
  CL.gyoraitei = function (P, c, isJ, K) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    K.bridge(g, P, 0.5, 0.17, B * 0.55, X(0.08), Dk);
    K.turret(s, P, 'mg', X(-0.08), Dk, 0, PI, 1, 0.45);
    D.both(function (k) { K.xc(g, P.gun, 0.045, 0.55, X(-0.24), Dk + 0.04, k * B * 0.3); });          // stern torpedo troughs
    D.c6(g, K.C.dark, 0.015, 0.35, X(0.04), Dk + 0.17, 0);
    D.rail(g, s.hull, 0.4, 0.97, 6);
    D.flagstaff(g, P, X(-0.48), Dk, 0.3);
    return s;
  };
})();
