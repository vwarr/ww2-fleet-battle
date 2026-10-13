// models_normandy_ships.js - the Normandy fire-support classes in the toy style (ship_classes.js normandy entries).
// Load after models_usn.js. Parameterised on the models_usn.js kit: the old battleships (Texas: five twin 14-inch,
// Arkansas: six twin 12-inch; a tripod foremast, one funnel), the 6-inch light cruisers (HMS Glasgow: four triple
// turrets and two funnels; Montcalm / Georges Leygues: three triple turrets, a tower bridge and one funnel). The
// Gleaves and Hunt destroyers reuse the Benson builder (ship_classes.js build). The palette comes from the hull's
// flag (models.js PAL: RN, FNFL), not the side.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, CL = WW.models.CLASS;
  function setup(P, c, K) {
    var s = K.classHull(P, c), L = c.len;
    return { s: s, g: s.group, L: L, B: c.beam, D: c.hull.top, X: function (f) { return f * L; }, dk: function (x) { return K.deckAt(s, x); } };
  }
  // the dreadnought: twin turrets at the given hull shares (+: forward facing, -: aft facing; up: superfiring)
  function oldBB(P, c, K, tur, mainTripod) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var h0 = X(-0.12), h1 = X(0.14), H = 0.7;
    K.box(g, P.super, h1 - h0, H, B * 0.62, (h0 + h1) / 2, Dk, 0);                           // casemate deck and superstructure
    tur.forEach(function (t) {
      var x = X(t.f), y = o.dk(x) + (t.up ? 0.55 : 0);
      if (t.up) K.box(g, P.super, 1.5, 0.55, 1.5, x, o.dk(x), 0);                             // barbette
      K.turret(s, P, 'big', x, y, 0, t.f >= 0 && !t.aft ? 0 : PI, 2);
    });
    K.turret(s, P, 'small', X(0.02), Dk + 0.2, B * 0.42, -PI / 2, 1, 0.8);                    // the 5-inch casemates (one mount a side)
    K.turret(s, P, 'small', X(0.02), Dk + 0.2, -B * 0.42, PI / 2, 1, 0.8);
    var bx = X(0.12), y = Dk + H;
    K.bridge(g, P, 1.6, 0.8, 1.4, bx, y);
    K.tripod(g, P, bx - 0.25, y + 0.8, 2.6);                                                 // the tripod foremast and its fire-control top
    K.box(g, P.super, 0.9, 0.5, 0.9, bx - 0.25, y + 3.4, 0);
    K.funnel(s, P, X(0.0), y, 0.72, 1.6, 0.04, 0.55);
    if (mainTripod) K.tripod(g, P, X(-0.12), y, 2.0, 0.85); else K.pole(g, X(-0.12), y, 2.2, 1.2);
    D.radar(g, bx - 0.25, y + 3.95, 0, 0.8);
    D.both(function (k) { D.lifeboat(g, X(-0.05), y, k * B * 0.26); D.aaTub(g, P, X(0.07), y, k * B * 0.34, true, k > 0 ? -PI / 2 : PI / 2); });
    D.planks(g, P, s.hull, [-B * 0.4, B * 0.4], 0.12, 0.66);
    D.common(g, P, s.hull, 1.0);
    return s;
  }
  CL.newyork = function (P, c, isJ, K) {   // Texas: A, B fore, Q amidships (aft of the funnel), X, Y aft
    return oldBB(P, c, K, [{ f: 0.33 }, { f: 0.24, up: 1 }, { f: -0.05, aft: 1 }, { f: -0.24, up: 1, aft: 1 }, { f: -0.33, aft: 1 }], true);
  };
  CL.wyoming = function (P, c, isJ, K) {   // Arkansas: six twin turrets, two fore, two amidships, two aft
    return oldBB(P, c, K, [{ f: 0.34 }, { f: 0.26, up: 1 }, { f: -0.04, aft: 1 }, { f: -0.13, aft: 1, up: 1 }, { f: -0.26, up: 1, aft: 1 }, { f: -0.35, aft: 1 }], false);
  };
  // the 6-inch light cruiser: n triple turrets (2 fore, the rest aft), funnels, a tower or block bridge
  function lightCA(P, c, K, n, funnels, tower) {
    var D = WW.models.D, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    var h0 = X(-0.15), h1 = X(0.16), H = 0.5;
    K.box(g, P.super, h1 - h0, H, B * 0.66, (h0 + h1) / 2, Dk, 0);
    K.box(g, P.super, 1.1, 0.4, 1.1, X(0.23), o.dk(X(0.23)), 0);
    K.turret(s, P, 'med', X(0.32), o.dk(X(0.32)), 0, 0);
    K.turret(s, P, 'med', X(0.23), o.dk(X(0.23)) + 0.4, 0, 0);
    if (n > 3) { K.box(g, P.super, 1.1, 0.4, 1.1, X(-0.25), o.dk(X(-0.25)), 0); K.turret(s, P, 'med', X(-0.25), o.dk(X(-0.25)) + 0.4, 0, PI); }
    K.turret(s, P, 'med', X(-0.33), o.dk(X(-0.33)), 0, PI);
    var bx = X(0.15), y = Dk + H;
    K.bridge(g, P, 1.3, 0.75, 1.2, bx, y);
    if (tower) { K.box(g, P.super, 0.8, 1.1, 0.8, bx - 0.1, y + 0.75, 0); D.rangefinder(g, P, bx - 0.1, y + 1.85, 0, 1.0); }
    else K.tripod(g, P, bx - 0.3, y + 0.75, 2.0);
    for (var i = 0; i < funnels; i++) K.funnel(s, P, X(0.03 - i * 0.11), y, 0.42, 1.3, 0.05, 0.36);
    K.pole(g, X(-0.13), y, 1.8, 1.0);
    D.radar(g, bx - 0.25, y + (tower ? 2.3 : 2.8), 0, 0.7);
    D.both(function (k) { D.aaTub(g, P, X(-0.05), y, k * B * 0.3, true, k > 0 ? -PI / 2 : PI / 2); D.lifeboat(g, X(0.02), Dk, k * B * 0.43); });
    D.planks(g, P, s.hull, [-B * 0.4, B * 0.4], 0.12, 0.66);
    D.common(g, P, s.hull, 0.9);
    return s;
  }
  CL.town = function (P, c, isJ, K) { return lightCA(P, c, K, 4, 2, false); };          // HMS Glasgow
  CL.galissoniere = function (P, c, isJ, K) { return lightCA(P, c, K, 3, 1, true); };   // Montcalm, Georges Leygues
})();
