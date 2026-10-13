// models_normandy_transports.js - the Normandy transport area in the toy style (ship_classes.js 'apa' .. 'lcc'; placed
// by normandy_fleet.js, never sim ships). Load after models_normandy_ships.js. One parameterised merchant-style
// transport (midships house and bridge, funnels, kingposts and cargo booms over the hatches, a row of Welin davits
// down each side with the cargo nets draped below them, LCVPs nested on the hatch covers) makes the C3 attack
// transports (APA / AP: Samuel Chase, Henrico, Thomas Jefferson, Charles Carroll, Dorothea L. Dix, Anne Arundel), the
// British LSI(L)s (Empire Javelin, Empire Anvil: LCAs at the davits) and the Rangers' cross-channel ferries (Prince
// Charles, Prince Leopold, Ben Machree, Amsterdam: two funnels, LCAs); plus USS Ancon (AGC-4, Hall's headquarters
// ship: a liner bristling with aerials), and the control vessels at the line of departure (PC-552 type submarine
// chasers, LCC control craft). The boats in the davits are NOT part of the models (normandy_fleet.js boats(): they
// leave); the davit slots are published in WW.models.DAVITS[classKey] = [{ x, z, y, side, w, boom }] (ship-local,
// bow +x: x along the hull, z the hanging boat's centre outboard, y the deck, w the hull half-width there, boom: an
// LCM slung from a cargo boom at a hatch instead of a davit).
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, CL = WW.models.CLASS, ROPE = 0xc2aa7c, TARP = 0x7f8a78, NEST = 0x7b8794;
  var DAVITS = WW.models.DAVITS = WW.models.DAVITS || {};
  function setup(P, c, K) {
    var s = K.classHull(P, c), L = c.len;
    return { s: s, g: s.group, L: L, B: c.beam, D: c.hull.top, X: function (f) { return f * L; }, dk: function (x) { return K.deckAt(s, x); },
      w: function (x) { var h = s.hull; return K.hullAt(h[0], h[1], h[2], h[3], h[4], h[5], WW.clamp((x + h[0] / 2) / h[0], 0, 1)).w * 1.06; } };
  }
  // a bar from a to b (centre-based box along its length): ropes, booms, davit arms
  function strut(K, g, m, r, ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var o = K.cyl(g, m, r, l, ax, ay, az);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / l, dy / l, dz / l));
    return o;
  }
  // a cargo net draped down the hull side at x (side sd) from the deck edge to just above the waterline
  function net(K, g, x, yd, z, wd) {
    var D = WW.models.D, h = yd - 0.06, nv = 5, nh = Math.max(3, Math.round(h / 0.2));
    for (var i = 0; i < nv; i++) D.bx(g, ROPE, 0.018, h, 0.018, x - wd / 2 + wd * i / (nv - 1), 0.06, z);
    for (var j = 0; j <= nh; j++) D.bx(g, ROPE, wd, 0.018, 0.018, x, 0.06 + h * j / nh, z);
  }
  // a Welin davit pair at x (side sd) for a boat bl long: the posts at the deck edge, the arms swung out, the falls
  function davit(K, g, P, o, x, sd, bl, slots, boom) {
    var C = K.C, yd = o.dk(x), w = o.w(x), zc = sd * (w + 0.42);
    if (!boom) for (var e = -1; e <= 1; e += 2) {
      var ax = x + e * bl * 0.36;
      K.bar(g, C.dark, 0.16, 0.08, 0.12, ax, yd, sd * (w - 0.1));                                   // the quadrant foot
      K.bar(g, C.dark, 0.06, 0.62, 0.06, ax, yd, sd * (w - 0.08));
      strut(K, g, C.dark, 0.03, ax, yd + 0.6, sd * (w - 0.08), ax, yd + 0.86, zc);                  // the arm, swung out
      K.bar(g, C.dark, 0.012, 0.42, 0.012, ax, yd + 0.44, zc);                                      // the fall
    }
    net(K, g, x, yd, sd * (w + 0.02), Math.min(1.1, bl * 0.75));
    slots.push({ x: x, z: zc, y: yd, side: sd, w: w, boom: !!boom });
  }
  // a pair of kingposts at x with their cargo booms topped over the hatch at hx
  function kingposts(K, g, P, o, x, hx, h) {
    var C = K.C, yd = o.dk(x), B = o.B;
    for (var sd = -1; sd <= 1; sd += 2) {
      K.cyl(g, P.super, 0.07, h, x, yd, sd * B * 0.3);
      strut(K, g, C.dark, 0.035, x, yd + 0.3, sd * B * 0.26, hx, yd + 0.3 + Math.abs(hx - x) * 0.55, sd * B * 0.16);    // the boom
      strut(K, g, C.dark, 0.008, x, yd + h * 0.95, sd * B * 0.3, hx, yd + 0.3 + Math.abs(hx - x) * 0.55, sd * B * 0.16); // its topping lift
    }
    K.bar(g, P.super, 0.12, 0.1, B * 0.66, x, yd + h * 0.82, 0);                                    // the crosstree
    K.cyl(g, C.dark, 0.035, 0.7, x, yd + h * 0.82, 0);
  }
  function hatch(K, g, o, x, wd, nest) {
    var yd = o.dk(x);
    K.box(g, TARP, wd, 0.14, o.B * 0.42, x, yd, 0);
    if (nest) for (var i = 0; i < nest; i++) {                                                       // LCVPs nested on the hatch cover
      var y = yd + 0.14 + i * 0.26;
      K.box(g, NEST, 1.5, 0.26, 0.46, x, y, 0); K.bar(g, 0x5f6a74, 0.05, 0.27, 0.42, x + 0.76, y, 0);
    }
  }
  // the merchant-style transport. q: house [f0, f1, h, width share], tiers [[f0, f1, h, w]], bridge f, funnels [f], fun
  // [r, h], posts [[f, hatch f]], hatches [[f, nest]], davits [f] (both sides), booms [f] (LCM slings), masts [[f, h]],
  // craft len, liner (rows of windows)
  function transport(P, c, K, q) {
    var D = WW.models.D, C = K.C, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, B = o.B, slots = [];
    var h = q.house, x0 = X(h[0]), x1 = X(h[1]), yd = o.dk((x0 + x1) / 2), y = yd + h[2];
    K.box(g, P.super, x1 - x0, h[2], B * h[3], (x0 + x1) / 2, yd, 0);
    D.both(function (k) { K.bar(g, C.glass, (x1 - x0) * 0.86, 0.05, 0.01, (x0 + x1) / 2, yd + h[2] * 0.55, k * B * h[3] / 2); });   // the ports
    (q.tiers || []).forEach(function (t) {
      var a = X(t[0]), b = X(t[1]);
      K.box(g, P.super, b - a, t[2], B * t[3], (a + b) / 2, y, 0);
      if (q.liner) D.both(function (k) { K.bar(g, C.glass, (b - a) * 0.85, 0.05, 0.01, (a + b) / 2, y + t[2] * 0.5, k * B * t[3] / 2); });
      y += t[2];
    });
    var bx = X(q.bridge);
    K.bridge(g, P, 0.9, 0.42, B * 0.62, bx, y);
    K.bar(g, P.super, 0.3, 0.06, B * 1.02, bx + 0.25, y + 0.3, 0);                                    // the bridge wings
    K.bar(g, C.dark, 0.32, 0.12, B * 0.4, bx - 0.05, y + 0.42, 0);                                   // the flying bridge screen
    q.funnels.forEach(function (f) { K.funnel(s, P, X(f), y, q.fun[0], q.fun[1], 0.06, q.fun[0] * 0.8); });
    (q.posts || []).forEach(function (p) { kingposts(K, g, P, o, X(p[0]), X(p[1]), q.postH || 2.2); });
    (q.hatches || []).forEach(function (p) { hatch(K, g, o, X(p[0]), p[2] || 1.1, p[1]); });
    (q.masts || []).forEach(function (m) { K.pole(g, X(m[0]), o.dk(X(m[0])), m[1], 1.1); });
    D.radar(g, bx - 0.15, y + 0.42, 0, 0.6);
    D.both(function (k) {
      (q.davits || []).forEach(function (f) { davit(K, g, P, o, X(f), k, q.craft, slots); });
      (q.booms || []).forEach(function (f) { davit(K, g, P, o, X(f), k, 1.9, slots, true); });
      D.aaTub(g, P, bx + 0.1, y, k * B * 0.42, false, k > 0 ? -PI / 2 : PI / 2);                    // 20 mm in the bridge wings
      D.lifeboat(g, X(h[0]) + 0.6, yd + h[2], k * B * h[3] * 0.4);
    });
    D.aaTub(g, P, X(0.44), o.dk(X(0.44)), 0, true, 0);                                               // the 3-inch / 40 mm bow and stern tubs
    D.aaTub(g, P, X(-0.45), o.dk(X(-0.45)), 0, true, PI);
    D.common(g, P, s.hull, 0.9);
    streaks(K, o, [0.46, 0.4, 0.3, 0.18, 0.06, -0.12, -0.24, -0.37]);
    DAVITS[c.key] = slots;
    return s;
  }
  // C3 attack transport: house and bridge amidships, the funnel just aft, five hatches with kingposts, four LCVPs a
  // side in Welin davits, the LCMs slung from the booms at No. 2 and No. 4 hatch
  CL.apa = function (P, c, isJ, K) {
    return transport(P, c, K, { house: [-0.19, 0.12, 0.55, 0.84], tiers: [[-0.12, 0.1, 0.42, 0.66]], bridge: 0.08, funnels: [-0.06], fun: [0.42, 1.25],
      posts: [[0.29, 0.37], [0.18, 0.24], [-0.26, -0.33]], hatches: [[0.37, 0], [0.24, 2], [-0.33, 2], [-0.42, 0, 0.8]],
      davits: [0.13, 0.025, -0.08, -0.185], booms: [0.24, -0.33], masts: [[0.31, 3.0], [-0.29, 2.6]], craft: 1.5 });
  };
  // C1-S-AY1 LSI(L): LCAs in three davits a side, one funnel, a kingpost pair fore and aft
  CL.lsil = function (P, c, isJ, K) {
    return transport(P, c, K, { house: [-0.2, 0.12, 0.5, 0.82], tiers: [[-0.12, 0.08, 0.4, 0.64]], bridge: 0.06, funnels: [-0.06], fun: [0.38, 1.1],
      posts: [[0.26, 0.34], [-0.28, -0.36]], hatches: [[0.34, 0], [-0.36, 0]], davits: [0.13, -0.03, -0.19], masts: [[0.3, 2.6]], craft: 1.7, postH: 1.9 });
  };
  // the cross-channel ferry: a long passenger house, two funnels, LCAs in three davits a side, pole masts fore and aft
  CL.ferry = function (P, c, isJ, K) {
    return transport(P, c, K, { house: [-0.28, 0.2, 0.42, 0.86], tiers: [[-0.2, 0.16, 0.36, 0.7]], bridge: 0.12, funnels: [0.0, -0.14], fun: [0.34, 1.05],
      davits: [0.12, -0.04, -0.2], masts: [[0.3, 2.6], [-0.36, 2.2]], craft: 1.7, liner: true });
  };
  // USS Ancon (AGC-4): a Panama liner turned headquarters ship: three decks of house, one funnel, two tall masts
  // strung with aerials, a radar mattress and a cluster of radio whips
  CL.agc = function (P, c, isJ, K) {
    var s = transport(P, c, K, { house: [-0.26, 0.18, 0.5, 0.86], tiers: [[-0.2, 0.15, 0.42, 0.72], [-0.1, 0.11, 0.36, 0.6]], bridge: 0.09,
      funnels: [-0.04], fun: [0.48, 1.2], hatches: [[0.33, 0], [-0.36, 0]], masts: [], craft: 1.5, liner: true });
    var D = WW.models.D, C = K.C, g = s.group, L = c.len, y0 = K.deckAt(s, 0.28 * L), y1 = K.deckAt(s, -0.3 * L);
    K.pole(g, 0.28 * L, y0, 4.2, 1.6); K.pole(g, -0.3 * L, y1, 3.8, 1.4);
    for (var i = 0; i < 4; i++) strut(K, g, C.dark, 0.006, 0.28 * L, y0 + 4.0 - i * 0.12, (i - 1.5) * 0.25, -0.3 * L, y1 + 3.6 - i * 0.12, (i - 1.5) * 0.25);  // the aerials
    K.bar(g, C.dark, 0.05, 0.36, 0.6, 0.28 * L, y0 + 4.25, 0);                                          // the SK air-search mattress
    for (var j = 0; j < 5; j++) D.c6(g, C.dark, 0.012, 0.9, (0.02 - j * 0.04) * L, 2.4, (j % 2 ? 1 : -1) * 0.5);    // radio whips
    return s;
  };
  // the control vessel: a PC-461 class submarine chaser (a 3-inch forward, a 40 mm aft, depth-charge racks), or the
  // LCC (a deckhouse with its radar dome, a short mast); their pennants are per ship (normandy_fleet.js)
  CL.pc = function (P, c, isJ, K) {
    var D = WW.models.D, C = K.C, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    K.box(g, P.super, 1.5, 0.32, B * 0.7, X(0.04), Dk, 0);
    K.bridge(g, P, 0.6, 0.3, B * 0.6, X(0.1), Dk + 0.32);
    K.funnel(s, P, X(-0.04), Dk + 0.32, 0.17, 0.42, 0.08, 0.13);
    K.pole(g, X(0.06), Dk + 0.62, 1.7, 0.7);
    D.radar(g, X(0.06), Dk + 2.1, 0, 0.3);
    K.box(g, P.super, 0.3, 0.18, 0.3, X(0.33), o.dk(X(0.33)), 0); K.xc(g, P.gun, 0.03, 0.5, X(0.33) + 0.3, o.dk(X(0.33)) + 0.12, 0);   // the 3-inch
    D.aaTub(g, P, X(-0.22), Dk, 0, false, PI);
    s.pennant = { x: X(0.06), y: Dk + 0.62 + 1.7 * 0.82, yard: 0.7, k: 1 };                         // the sector pennants' yard (normandy_fleet.js)
    D.both(function (k) { K.xc(g, C.dark, 0.06, 0.6, X(-0.4), Dk + 0.06, k * B * 0.22); });           // depth-charge racks
    D.common(g, P, s.hull, 0.5);
    return s;
  };
  // the Channel's greys: WW.models.weather(group, flag), after buildShip (normandy_fleet.js; Augusta's Northampton too).
  // The class kit paints in the Pacific pastels (models.js PAL); a 1944 ship off Normandy wore Measure 22 (USN: navy
  // blue hull to the deck line, haze grey above, deck blue decks) or the Admiralty's greys (RN), salt-streaked after
  // a Channel crossing. The materials are cached and shared with the bombardment group, so each is cloned once per
  // flag and swapped in (the outline's MeshBasicMaterial is left alone): the palette's hull / super / deck / band
  // colours to the 1944 ones, anything pale (rails, boats, the ensign's white) dulled, the rest a little darkened and
  // greyed.
  var GREYS = { USN: { hull: 0x46515e, super: 0x7a8288, deck: 0x4c545d, band: 0x303336, accent: 0x3a3f45, gun: 0x4a4f55 },
    RN: { hull: 0x5b6267, super: 0x868d91, deck: 0x66645e, band: 0x303336, accent: 0x464c52, gun: 0x4a4f55 } }, wx = {};
  WW.models.weather = function (g, flag) {
    var M = WW.models, P = M._nation(flag), G = GREYS[flag] || GREYS.USN, cache = wx[flag] || (wx[flag] = new Map()), by = {};
    for (var k in G) if (P[k] !== undefined) by[M._soft(P[k]).getHex()] = G[k];
    var grey = new THREE.Color();
    function swap(m) {
      if (!m || !m.color || m.isMeshBasicMaterial) return m;
      var c = cache.get(m);
      if (c) return c;
      c = m.clone(); var h = m.color.getHex();
      if (by[h] !== undefined) c.color.copy(M._soft(by[h]));
      else {
        var l = c.color.r * 0.299 + c.color.g * 0.587 + c.color.b * 0.114;
        grey.setRGB(l, l, l);
        if (l > 0.55) c.color.lerp(grey, 0.55).multiplyScalar(0.55 / l + 0.1);   // the pale things dulled
        else c.color.lerp(grey, 0.3).multiplyScalar(0.9);
      }
      cache.set(m, c); cache.set(c, c);
      return c;
    }
    g.traverse(function (o) {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
  };
  // salt and rust streaks down the hull side below the deck edge at the hull shares fs (both sides)
  function streaks(K, o, fs) {
    fs.forEach(function (f, i) {
      var x = o.X(f), yd = o.dk(x), w = o.w(x), h = 0.25 + (i % 3) * 0.12;
      for (var sd = -1; sd <= 1; sd += 2) K.bar(o.g, i % 2 ? 0x5a4c40 : 0x6e6a62, 0.05, h, 0.012, x, yd - h - 0.02, sd * w);
    });
  }
  CL.lcc = function (P, c, isJ, K) {
    var D = WW.models.D, C = K.C, o = setup(P, c, K), s = o.s, g = o.g, X = o.X, Dk = o.D, B = o.B;
    K.box(g, P.super, 0.7, 0.26, B * 0.66, X(0.02), Dk, 0);
    K.bar(g, C.glass, 0.04, 0.07, B * 0.5, X(0.02) + 0.35, Dk + 0.16, 0);
    D.s8(g, P.super, 0.26, 0.2, 0.26, X(-0.1), Dk + 0.3, 0);                                           // the radar dome
    K.pole(g, X(0.1), Dk + 0.26, 0.9, 0.4);
    s.pennant = { x: X(0.1), y: Dk + 0.26 + 0.9 * 0.82, yard: 0.4, k: 0.6 };
    D.c6(g, P.gun, 0.03, 0.12, X(-0.32), Dk, 0); K.xc(g, P.gun, 0.01, 0.2, X(-0.32) + 0.1, Dk + 0.1, 0);
    D.rail(g, s.hull, 0.3, 0.97, 5);
    D.flagstaff(g, P, X(-0.48), Dk, 0.35);
    return s;
  };
})();
