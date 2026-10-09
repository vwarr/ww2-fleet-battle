// models_usn.js (owner B) - USN 1942 surface classes, true size (ship_classes.js), in the toy style. Load after models_detail.js.
// North Carolina / South Dakota BB, Northampton / New Orleans / Atlanta CA, Fletcher / Benson DD, Gato SS, Elco PT.
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
  function side(D, fn) { D.both(fn); }

  // ---------------- battleships ----------------
  // shared fast-battleship hull: 3 triple 16-inch (2 fore, 1 aft), twin 5-inch mounts on the beam
  function fastBB(P, c, K, sd) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var cit0 = sd ? X(-0.17) : X(-0.2), cit1 = sd ? X(0.12) : X(0.13), H = 0.8;
    K.box(g, P.super, cit1 - cit0, H, B * 0.66, (cit0 + cit1) / 2, Dk, 0);                    // citadel deckhouse
    K.box(g, P.super, 1.7, 0.6, 1.7, X(0.215), o.dk(X(0.215)), 0);                            // barbette B
    K.turret(s, P, 'big', X(0.31), o.dk(X(0.31)), 0, 0);
    K.turret(s, P, 'big', X(0.215), o.dk(X(0.215)) + 0.6, 0, 0);
    K.turret(s, P, 'big', X(-0.3), o.dk(X(-0.3)), 0, PI);
    K.turret(s, P, 'small', X(-0.06), Dk + H, B * 0.31, -PI / 2, 2, 0.9);
    K.turret(s, P, 'small', X(-0.06), Dk + H, -B * 0.31, PI / 2, 2, 0.9);
    var tx = sd ? X(0.075) : X(0.09), y = Dk + H;
    K.bridge(g, P, sd ? 2.0 : 2.2, sd ? 1.25 : 1.1, sd ? 1.9 : 1.8, tx, y);                 // conning tower / bridge
    K.bridge(g, P, 1.45, 0.85, 1.35, tx + 0.05, y + (sd ? 1.25 : 1.1));
    var ty = y + (sd ? 2.1 : 1.95);
    K.box(g, P.super, 0.85, 0.65, 0.85, tx, ty, 0);
    D.rangefinder(g, P, tx, ty + 0.65, 0, 1.3);
    K.pole(g, tx - 0.25, ty + 0.65, 1.3, 1.4);
    D.radar(g, tx - 0.25, ty + 0.65 + 1.3 + 0.05, 0, 0.9);
    if (sd) {                                                                                   // one funnel faired into the block
      K.box(g, P.super, 1.7, 0.95, 1.35, X(-0.04), y, 0);
      K.funnel(s, P, X(-0.04), y + 0.6, 0.78, 1.25, 0.05, 0.6);
    } else {                                                                                    // two funnels
      K.funnel(s, P, X(0.0), y, 0.62, 1.75, 0.04, 0.5);
      K.funnel(s, P, X(-0.095), y, 0.62, 1.75, 0.04, 0.5);
    }
    K.box(g, P.super, 1.3, 0.75, 1.3, X(-0.17), sd ? Dk : y, 0);                              // after control
    K.pole(g, X(-0.17), (sd ? Dk : y) + 0.75, 1.6, 1.2);
    side(D, function (k) {
      [X(-0.15), X(-0.11), X(0.04), X(0.1)].forEach(function (x, i) { D.aaTub(g, P, x, Dk, k * B * 0.42, i % 2 === 0, k > 0 ? -PI / 2 : PI / 2); });
      D.lifeboat(g, X(-0.13), y, k * B * 0.24);
      D.searchlight(g, X(-0.02), y + 0.95, k * 0.7);
    });
    D.catapult(g, X(-0.43), o.dk(X(-0.43)), B * 0.2, 1.6, 0.3);
    D.catapult(g, X(-0.43), o.dk(X(-0.43)), -B * 0.2, 1.6, -0.3);
    s.floatplane = D.floatplane(g, P, X(-0.43), o.dk(X(-0.43)) + 0.08, -B * 0.2, -0.3);   // air_scouts.js hides it while the scout flies
    D.crane(g, P, X(-0.47), o.dk(X(-0.47)), 0, PI);
    D.planks(g, P, s.hull, [-B * 0.42, -B * 0.36, B * 0.36, B * 0.42], 0.12, 0.66);
    D.common(g, P, s.hull, 1.0);
    return s;
  }
  CL.northcarolina = function (P, c, isJ, K) { return fastBB(P, c, K, false); };
  CL.southdakota = function (P, c, isJ, K) { return fastBB(P, c, K, true); };

  // ---------------- cruisers ----------------
  // heavy cruiser: 3 triple 8-inch. nc: the Northampton's tripod and widely spaced funnels; else the New Orleans tower
  function heavyCA(P, c, K, nh) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var h0 = X(-0.13), h1 = X(0.17), H = 0.55;
    K.box(g, P.super, h1 - h0, H, B * 0.72, (h0 + h1) / 2, Dk, 0);
    K.box(g, P.super, 1.25, 0.45, 1.25, X(0.22), o.dk(X(0.22)), 0);
    K.turret(s, P, 'med', X(0.31), o.dk(X(0.31)), 0, 0);
    K.turret(s, P, 'med', X(0.22), o.dk(X(0.22)) + 0.45, 0, 0);
    K.turret(s, P, 'med', X(-0.31), o.dk(X(-0.31)), 0, PI);
    var y = Dk + H, bx = X(0.14);
    K.bridge(g, P, 1.5, 0.85, 1.3, bx, y);
    if (nh) {
      K.tripod(g, P, bx - 0.3, y + 0.85, 2.3);
      K.funnel(s, P, X(0.035), y, 0.44, 1.5, 0.04, 0.38);
      K.funnel(s, P, X(-0.085), y, 0.44, 1.5, 0.04, 0.38);
      K.tripod(g, P, X(-0.16), y, 1.8, 0.85);
      D.catapult(g, X(-0.025), y, B * 0.22, 1.4, 0.4); D.catapult(g, X(-0.025), y, -B * 0.22, 1.4, -0.4);
      s.floatplane = D.floatplane(g, P, X(-0.025), y + 0.08, B * 0.22, 0.4);
      D.crane(g, P, X(-0.12), y, -B * 0.25, -0.6);
    } else {
      K.bridge(g, P, 1.05, 0.65, 1.0, bx, y + 0.85);
      K.box(g, P.super, 0.7, 0.45, 0.7, bx - 0.05, y + 1.5, 0);
      D.rangefinder(g, P, bx - 0.05, y + 1.95, 0, 1.1);
      K.pole(g, bx - 0.45, y + 1.5, 1.6, 1.2);
      K.funnel(s, P, X(0.035), y, 0.42, 1.4, 0.04, 0.36);
      K.funnel(s, P, X(-0.035), y, 0.42, 1.4, 0.04, 0.36);
      K.pole(g, X(-0.11), y, 1.7, 1.0);
      D.catapult(g, X(-0.17), o.dk(X(-0.17)), B * 0.25, 1.4, 0.45); D.catapult(g, X(-0.17), o.dk(X(-0.17)), -B * 0.25, 1.4, -0.45);
      s.floatplane = D.floatplane(g, P, X(-0.17), o.dk(X(-0.17)) + 0.08, B * 0.25, 0.45);
      D.crane(g, P, X(-0.21), o.dk(X(-0.21)), 0, PI);
    }
    D.radar(g, bx - 0.3, y + (nh ? 0.85 + 2.3 : 1.5 + 1.6) + 0.05, 0, 0.8);
    side(D, function (k) {
      D.aaTub(g, P, X(-0.06), y, k * B * 0.3, true, k > 0 ? -PI / 2 : PI / 2);
      D.aaTub(g, P, X(0.09), y, k * B * 0.32, false, k > 0 ? -PI / 2 : PI / 2);
      D.lifeboat(g, X(0.0), Dk, k * B * 0.44);
      D.searchlight(g, X(-0.0), y + 1.0, k * 0.5);
    });
    D.planks(g, P, s.hull, [-B * 0.4, B * 0.4], 0.12, 0.66);
    D.common(g, P, s.hull, 1.0);
    return s;
  }
  CL.northampton = function (P, c, isJ, K) { return heavyCA(P, c, K, true); };
  CL.neworleans = function (P, c, isJ, K) { return heavyCA(P, c, K, false); };
  CL.atlanta = function (P, c, isJ, K) {     // AA cruiser: a pyramid of twin 5-inch mounts fore and aft
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    K.box(g, P.super, X(0.3), 0.5, B * 0.72, X(-0.02), Dk, 0);
    K.box(g, P.super, 0.85, 0.38, 0.85, X(0.255), o.dk(X(0.255)), 0);
    K.box(g, P.super, 0.95, 0.76, 0.95, X(0.185), o.dk(X(0.185)), 0);
    K.box(g, P.super, 0.85, 0.38, 0.85, X(-0.255), o.dk(X(-0.255)), 0);
    K.box(g, P.super, 0.95, 0.76, 0.95, X(-0.185), o.dk(X(-0.185)), 0);
    [[0.33, 0], [0.255, 0.38], [0.185, 0.76]].forEach(function (q) { K.turret(s, P, 'med', X(q[0]), o.dk(X(q[0])) + q[1], 0, 0, 2, 0.95, 'small'); });
    [[-0.33, 0], [-0.255, 0.38], [-0.185, 0.76]].forEach(function (q) { K.turret(s, P, 'med', X(q[0]), o.dk(X(q[0])) + q[1], 0, PI, 2, 0.95, 'small'); });
    var y = Dk + 0.5, bx = X(0.1);
    K.bridge(g, P, 1.2, 0.85, 1.0, bx, y);
    K.bridge(g, P, 0.85, 0.6, 0.85, bx - 0.05, y + 0.85);
    D.rangefinder(g, P, bx - 0.05, y + 1.45, 0, 0.9);
    K.pole(g, bx - 0.4, y + 1.45, 1.5, 1.0);
    D.radar(g, bx - 0.4, y + 1.45 + 1.5 + 0.05, 0, 0.7);
    K.funnel(s, P, X(0.005), y, 0.36, 1.3, 0.04, 0.3);
    K.funnel(s, P, X(-0.065), y, 0.36, 1.3, 0.04, 0.3);
    K.pole(g, X(-0.12), y, 1.4, 0.9);
    side(D, function (k) {
      K.box(g, P.super, 0.5, 0.3, 0.45, X(-0.13), Dk, k * B * 0.36);                                 // waist 5-inch (decor)
      K.xc(g, P.gun, 0.06, 0.8, X(-0.13) + 0.45, Dk + 0.18, k * B * 0.36 + k * 0.06).rotation.y = -k * 0.4;
      K.xc(g, P.gun, 0.12, 1.0, X(0.04), Dk + 0.12, k * B * 0.38);                                   // torpedo tubes
      D.aaTub(g, P, X(-0.08), y, k * B * 0.3, true, k > 0 ? -PI / 2 : PI / 2);
      D.lifeboat(g, X(-0.03), Dk, k * B * 0.45);
    });
    D.common(g, P, s.hull, 0.9);
    return s;
  };

  // ---------------- destroyers ----------------
  // f: Fletcher (5 single 5-inch, round funnels) or Benson (4 mounts, flat-sided funnels)
  function usnDD(P, c, K, fl) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B, q = 0.82;
    K.box(g, P.super, X(0.17), 0.3, B * 0.6, X(0.155), Dk, 0);                                        // forward deckhouse
    K.box(g, P.super, 0.6, 0.32, 0.6, X(0.27), o.dk(X(0.27)), 0);
    K.turret(s, P, 'small', X(0.355), o.dk(X(0.355)), 0, 0, 1, q);
    K.turret(s, P, 'small', X(0.27), o.dk(X(0.27)) + 0.32, 0, 0, 1, q);
    var bx = X(0.175), y = Dk + 0.3;
    K.bridge(g, P, 0.95, 0.5, B * 0.62, bx, y);
    K.box(g, P.super, 0.5, 0.25, 0.5, bx - 0.05, y + 0.5, 0);
    K.pole(g, X(0.12), y, 1.4, 1.0);
    D.radar(g, X(0.12), y + 1.45, 0, 0.5);
    K.box(g, P.super, X(0.22), 0.28, B * 0.5, X(-0.03), Dk, 0);                                        // midships deckhouse
    if (fl) { K.funnel(s, P, X(0.045), Dk + 0.28, 0.27, 0.95, 0.05, 0.24); K.funnel(s, P, X(-0.055), Dk + 0.28, 0.27, 0.95, 0.05, 0.24); }
    else { K.funnel(s, P, X(0.04), Dk + 0.28, 0.32, 0.85, 0, 0.15); K.funnel(s, P, X(-0.045), Dk + 0.28, 0.32, 0.85, 0, 0.15); }
    K.xc(g, P.gun, 0.11, 0.95, X(0.0), Dk + 0.38, 0); D.c6(g, P.super, 0.2, 0.1, X(0.0), Dk + 0.28, 0); // torpedo mounts
    K.xc(g, P.gun, 0.11, 0.95, X(-0.13), Dk + 0.12, 0); D.c6(g, P.super, 0.2, 0.1, X(-0.13), Dk, 0);
    K.box(g, P.super, X(0.12), 0.32, B * 0.55, X(-0.25), Dk, 0);                                       // after deckhouse
    if (fl) {
      K.turret(s, P, 'small', X(-0.2), Dk + 0.32 + 0.25, 0, PI, 1, q);
      K.box(g, P.super, 0.55, 0.25, 0.55, X(-0.2), Dk + 0.32, 0);
      K.turret(s, P, 'small', X(-0.29), Dk + 0.32, 0, PI, 1, q);
      K.turret(s, P, 'small', X(-0.38), o.dk(X(-0.38)), 0, PI, 1, q);
    } else {
      K.turret(s, P, 'small', X(-0.28), Dk + 0.32, 0, PI, 1, q);
      K.turret(s, P, 'small', X(-0.37), o.dk(X(-0.37)), 0, PI, 1, q);
    }
    side(D, function (k) {
      D.aaTub(g, P, X(0.09), Dk, k * B * 0.36, false, k > 0 ? -PI / 2 : PI / 2);
      for (var i = 0; i < 3; i++) D.x6(g, K.C.dark, 0.08, 0.15, X(-0.45) + i * 0.18, Dk + 0.08, k * 0.32);  // depth-charge rack
      D.s8(g, K.C.dark, 0.13, 0.13, 0.13, X(-0.35), Dk + 0.22, k * B * 0.4);                         // K-gun
    });
    D.searchlight(g, X(-0.1), Dk + 0.28, 0);
    D.common(g, P, s.hull, 0.7);
    return s;
  }
  CL.fletcher = function (P, c, isJ, K) { return usnDD(P, c, K, true); };
  CL.benson = function (P, c, isJ, K) { return usnDD(P, c, K, false); };

  // ---------------- submarine ----------------
  CL.gato = function (P, c, isJ, K) {
    var hc = new THREE.Color(P.hull).multiplyScalar(0.72).getHex(), D = WW.models.D;
    var o = setup(P, c, K, hc), s = o.s, g = o.g, X = o.X, Dk = o.D;
    s.hullMats[1].color.copy(K.soft(new THREE.Color(P.hull).multiplyScalar(0.6).getHex()));
    var tm = s.hullMats[0];                                             // all fade with the hull when submerged
    K.box(g, tm, X(0.74), 0.12, 0.5, X(-0.02), Dk, 0);                  // casing
    K.box(g, tm, 1.5, 0.75, 0.48, X(0.05), Dk, 0);                      // fairwater
    K.box(g, s.hullMats[2], 0.75, 0.08, 0.5, X(0.07), Dk + 0.7, 0);
    K.cyl(g, tm, 0.045, 0.85, X(0.08), Dk + 0.75, 0); K.cyl(g, tm, 0.045, 0.7, X(0.03), Dk + 0.75, 0);   // periscope shears
    K.xc(g, tm, 0.055, 0.75, X(-0.12) + 0.3, Dk + 0.3, 0); K.box(g, tm, 0.28, 0.26, 0.28, X(-0.12), Dk + 0.08, 0); // 3-inch deck gun aft
    D.bind(); WW.models._mesh(g, WW.models._geo().sph, tm, 0.12, 0.12, 0.12, X(0.08), Dk + 1.62, 0);
    return s;
  };

  // ---------------- PT boat ----------------
  CL.elco = function (P, c, isJ, K) {        // 80 ft Elco: cockpit amidships, four 21-inch tubes, twin .50 turrets
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    K.bridge(g, P, 0.55, 0.16, B * 0.5, X(0.1), Dk);
    K.bar(g, K.C.glass, 0.03, 0.08, B * 0.42, X(0.1) + 0.3, Dk + 0.12, 0);
    K.box(g, P.accent, 0.25, 0.03, B * 0.3, X(0.06), Dk + 0.15, 0);
    K.turret(s, P, 'mg', X(-0.04), Dk, B * 0.24, PI, 2, 0.45);
    K.box(g, P.super, 0.18, 0.12, 0.18, X(-0.04), Dk, -B * 0.24);                                    // port twin .50 (decor)
    K.xc(g, P.gun, 0.015, 0.3, X(-0.04) - 0.15, Dk + 0.08, -B * 0.24);
    side(D, function (k) {
      K.xc(g, P.gun, 0.05, 0.6, X(0.2), Dk + 0.05, k * B * 0.36);
      K.xc(g, P.gun, 0.05, 0.6, X(-0.2), Dk + 0.05, k * B * 0.36);
    });
    D.c6(g, K.C.dark, 0.015, 0.4, X(0.06), Dk + 0.16, 0);
    D.radar(g, X(0.06), Dk + 0.5, 0, 0.12);
    D.c6(g, P.gun, 0.05, 0.08, X(-0.38), Dk, 0); K.xc(g, P.gun, 0.015, 0.25, X(-0.38) + 0.12, Dk + 0.08, 0);   // 20 mm aft
    D.rail(g, s.hull, 0.4, 0.97, 6);
    D.flagstaff(g, P, X(-0.48), Dk, 0.35);
    return s;
  };
})();
