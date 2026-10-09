// models_cv.js (owner B) - the 1942 carrier classes: Yorktown, Lexington (USN); Akagi, Kaga, Soryu / Hiryu, Shokaku (IJN).
// Load after models_detail.js. True hull length (ship_classes.js); the flight deck has its real length and its real
// width x WW.cfg.DECK_K (the plane-scale allowance). Each model publishes the DECK API for air_deck.js:
//   model.deck      Object3D at the flight-deck surface (y = deck top), at the ship's centre in x / z
//   model.deckDims  { len, w, halfW, x0 (deck centre x), top, islandSide (+1 starboard, -1 port), island: [x0, x1],
//                     stern, bow, aftFront, barrier, launchX, tdX, elevX (aft elevator), elevators: [x...], lane }
//                   deck-local x along the deck (bow +x), from the reference deck the air ops were tuned on
//                   (26.5 long, centre -0.4): every station keeps its share of the deck length. lane = halfW / 2.5:
//                   multiply the reference lane offsets (parking columns, launch run) by it.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI;
  // reference deck stations (share of the half-length from the deck centre), from air_deck.js's tuned constants
  var REF = { stern: -0.9925, bow: 0.9698, aftFront: 0.0755, barrier: -0.083, launchX: 0.2717, tdX: -0.6868, elevX: -0.3849 };

  // o: { side, fd (flight deck height), hangarK, elev: [shares], island(fn), galleries: [shares], hinomaru }
  function carrier(P, c, isJ, K, o) {
    var D = WW.models.D, s = K.classHull(P, c), g = s.group, L = c.len, top0 = c.hull.top, FD = o.fd || 1.75;
    var dl = c.deckLen, dw = c.deckW, x0 = o.x0 || 0, hw = dw / 2, side = c.island, B = c.beam;
    var hk = s.hullMats[0], deckMat = s.hullMats[1];
    K.box(g, hk, dl * (o.hangarK || 0.8), FD - top0 + 0.05, Math.min(dw * 0.74, B * 0.96), x0 - dl * 0.05, top0 - 0.05, 0);   // hangar
    for (var hb = 0; hb < 2; hb++) K.bar(g, K.C.dark, dl * (o.hangarK || 0.8) * 0.9, 0.05, Math.min(dw * 0.74, B * 0.96) + 0.02, x0 - dl * 0.05, top0 + 0.18 + hb * 0.24, 0);
    var fd = new THREE.Mesh(K.geo().box, deckMat); fd.scale.set(dl, 0.24, dw); fd.position.set(x0, FD, 0); g.add(fd);
    var top = FD + 0.24, mk = K.mat(K.C.white);
    for (var i = -4; i <= 4; i++) K.bar(g, mk, dl * 0.045, 0.02, 0.16, x0 + i * dl * 0.098, top, 0);    // centreline dashes
    K.bar(g, mk, 0.35, 0.02, dw * 0.92, x0 + dl * 0.47, top, 0);
    K.bar(g, mk, 0.35, 0.02, dw * 0.92, x0 - dl * 0.49, top, 0);
    var el = new THREE.Color(P.deck).multiplyScalar(0.8).getHex(), elev = o.elev || [0.45, 0.05, -0.385];
    elev.forEach(function (f) { K.bar(g, el, dl * 0.083, 0.025, Math.min(2.2, dw * 0.45), x0 + f * dl / 2, top, 0); });
    K.bar(g, P.accent, dl + 0.1, 0.08, dw + 0.04, x0, FD + 0.08, 0);                                      // deck-edge trim
    var pc = D.shade(P.deck, 0.88);
    [-0.84, -0.56, -0.28, 0.28, 0.56, 0.84].forEach(function (z) { D.bx(g, pc, dl * 0.97, 0.008, 0.035, x0, top, z * hw); }); // planking
    for (i = 0; i < 6; i++) D.bx(g, D.RAIL, 0.04, 0.012, dw * 0.88, x0 + REF.tdX * dl / 2 - 1.6 + i * 0.55, top, 0);   // arresting wires
    if (o.hinomaru) { K.disc(g, K.C.white, Math.min(1.25, hw * 0.48), 0.03, x0 + dl * 0.37, top, 0); K.disc(g, K.C.red, Math.min(1.0, hw * 0.38), 0.04, x0 + dl * 0.37, top, 0); }
    else K.bar(g, P.accent, 1.0, 0.03, dw * 0.6, x0 - dl * 0.4, top, 0);                                  // stern recognition band
    s.deck = new THREE.Object3D(); s.deck.position.set(0, top, 0); g.add(s.deck);
    // galleries and AA along both deck edges, under the overhang
    D.both(function (k) {
      (o.galleries || [-0.36, -0.17, 0.21]).forEach(function (f, j) {
        var x = x0 + f * dl;
        K.bar(g, P.super, 1.6, 0.1, 0.5, x, FD - 0.25, k * (hw + 0.2));
        D.aaTub(g, P, x - 0.3 + j * 0.1, FD - 0.15, k * (hw + 0.25), j !== 1, k > 0 ? -PI / 2 : PI / 2);
      });
      D.lifeboat(g, x0 - dl * 0.08, top0 + 0.2, k * (B / 2 + 0.05));
    });
    // the two 5-inch mounts (the class's 'small' guns) on forward sponsons, under the deck edge
    if (!o.gunHouses) {
      K.turret(s, P, 'small', x0 + dl * 0.36, FD - 0.42, hw - 0.15, -PI / 2);
      K.turret(s, P, 'small', x0 + dl * 0.36, FD - 0.42, -hw + 0.15, PI / 2);
      K.box(g, P.super, 1.2, 0.38, 0.8, x0 + dl * 0.35, FD - 0.82, hw - 0.2);
      K.box(g, P.super, 1.2, 0.38, 0.8, x0 + dl * 0.35, FD - 0.82, -hw + 0.2);
    }
    D.rail(g, s.hull, 0.015, 0.985, 18, s.hull[2]);
    D.anchors(g, s.hull);
    var isl = o.island(g, s, P, K, D, top, side, hw, x0, dl, FD) || [0, 0];
    var at = function (f) { return x0 + f * dl / 2; };
    s.deckDims = { len: dl, w: dw, halfW: hw, x0: x0, top: top, islandSide: side, island: isl, lane: hw / 2.5,
      stern: at(REF.stern), bow: at(REF.bow), aftFront: at(REF.aftFront), barrier: at(REF.barrier), launchX: at(REF.launchX),
      tdX: at(REF.tdX), elevX: at(REF.elevX), elevators: elev.map(at) };
    return s;
  }
  // a USN island: deckhouse, bridge, funnel (aft) and tripod; z offset at the deck edge
  function usnIsland(len, fx, funnelR) {
    return function (g, s, P, K, D, top, side, hw, x0, dl) {
      var z = side * (hw - 0.45), x = x0 + fx * dl, n0 = g.children.length;
      K.box(g, P.super, len, 1.3, 0.95, x, top, 0);
      K.box(g, P.super, len * 0.55, 0.75, 1.0, x + len * 0.2, top + 1.3, 0);
      K.bar(g, K.C.glass, 0.1, 0.22, 0.85, x + len * 0.47, top + 1.6, 0);
      K.tripod(g, P, x + len * 0.15, top + 2.05, 1.7);
      g.children.slice(n0).forEach(function (o) { o.position.z += z; });
      s.parts[s.parts.length - 1][4] = z;
      K.funnel(s, P, x - len * 0.28, top + 1.3, funnelR || 0.6, 1.0, 0.15, 0.42, z);
      D.radar(g, x + len * 0.15, top + 2.05 + 1.7 + 0.08, z, 0.9);
      D.rangefinder(g, P, x + len * 0.38, top + 2.05, z, 0.9);
      return [x - len / 2 - 0.4, x + len / 2];
    };
  }
  // a small IJN island: block, bridge glass, pole mast
  function ijnIsland(len, h, fx) {
    return function (g, s, P, K, D, top, side, hw, x0, dl) {
      var z = side * (hw - 0.45), x = x0 + fx * dl;
      len *= 1.25; h *= 1.35;                         // a touch oversized: the island is the class's signature at range
      K.bridge(g, P, len, h, 0.85, x, top, z);
      K.box(g, P.super, len * 0.6, 0.45, 0.7, x - len * 0.1, top + h, z);
      K.pole(g, x - len * 0.35, top + h, 1.8, 0.9, z);
      D.radar(g, x, top + h + 0.45, z, 0.55);
      D.searchlight(g, x + len * 0.3, top + h + 0.45, z);
      return [x - len / 2, x + len / 2];
    };
  }
  // the 20 cm casemate guns along the after hull (Akagi, Kaga)
  function casemates(g, K, P, c, x0, dl, top0) {
    for (var k = -1; k <= 1; k += 2) for (var i = 0; i < 3; i++) {
      var x = x0 - dl * (0.24 + i * 0.07), z = k * (c.beam / 2 + 0.02);
      K.box(g, P.super, 0.55, 0.32, 0.22, x, top0 + 0.12, z);
      K.xc(g, P.gun, 0.06, 0.7, x + 0.3, top0 + 0.28, z + k * 0.05);
    }
  }

  var CL = WW.models.CLASS;
  CL.yorktown = function (P, c, isJ, K) {
    return carrier(P, c, isJ, K, { island: usnIsland(4.2, 0.055, 0.6) });
  };
  CL.lexington = function (P, c, isJ, K) {   // the huge flat funnel, island forward of it; 8-inch mount houses fore and aft
    return carrier(P, c, isJ, K, { fd: 1.85, gunHouses: true, elev: [0.47, -0.385], island: function (g, s, P, K, D, top, side, hw, x0, dl) {
      var z = side * (hw - 0.5), xi = x0 + dl * 0.12, xf = x0 - dl * 0.03, n0 = g.children.length;
      K.box(g, P.super, 2.2, 1.2, 0.85, xi, top, 0);
      K.bar(g, K.C.glass, 0.1, 0.2, 0.75, xi + 1.08, top + 0.85, 0);
      K.tripod(g, P, xi - 0.2, top + 1.2, 2.0);
      g.children.slice(n0).forEach(function (o) { o.position.z += z; });
      s.parts[s.parts.length - 1][4] = z;
      var f = K.funnel(s, P, xf, top, 1.4, 2.3, 0, 0.42, z, true);   // a long flat slab: r 1.4 fore-aft, 0.42 across
      K.bar(g, P.accent, 2.6, 0.18, 0.86, xf, top + 1.7, z);
      D.radar(g, xi - 0.2, top + 1.2 + 2.0 + 0.08, z, 1.0);
      K.turret(s, P, 'small', xi + 2.0, top, z, 0, 2, 0.95, 'med');
      K.turret(s, P, 'small', xf - 2.3, top, z, PI, 2, 0.95, 'med');
      return [xf - 2.9, xi + 2.6];
    } });
  };
  CL.akagi = function (P, c, isJ, K) {        // port island amidships; a big down-curved funnel and a small upright one to starboard
    var s = carrier(P, c, isJ, K, { hinomaru: true, x0: -0.3, elev: [0.45, 0.02, -0.385], island: function (g, s, P, K, D, top, side, hw, x0, dl, FD) {
      var r = ijnIsland(1.7, 0.9, 0.03)(g, s, P, K, D, top, side, hw, x0, dl);
      K.downFunnel(s, P, x0 + dl * 0.02, FD - 0.35, 0.55, 1.5, 1, 2.35, c.beam / 2);
      var f = K.funnel(s, P, x0 - dl * 0.05, FD - 0.6, 0.24, 1.25, 0, 0.2, hw + 0.25, true);
      return r;
    } });
    casemates(s.group, K, P, c, -0.3, c.deckLen, c.hull.top);
    return s;
  };
  CL.kaga = function (P, c, isJ, K) {         // low, long: a small starboard island forward; funnel trunks run aft along the side
    var s = carrier(P, c, isJ, K, { hinomaru: true, fd: 1.6, elev: [0.45, 0.02, -0.385], island: function (g, s, P, K, D, top, side, hw, x0, dl, FD) {
      var r = ijnIsland(1.5, 0.7, 0.17)(g, s, P, K, D, top, side, hw, x0, dl);
      var zt = c.beam / 2 + 0.15, x1 = x0 + dl * 0.06, x2 = x0 - dl * 0.3;
      K.box(g, P.super, x1 - x2, 0.36, 0.34, (x1 + x2) / 2, FD - 0.62, zt);
      K.downFunnel(s, P, x2 + 0.2, FD - 0.45, 0.32, 1.0, 1, 2.3, c.beam / 2);
      return r;
    } });
    casemates(s.group, K, P, c, 0, c.deckLen, c.hull.top);
    return s;
  };
  function soryu(P, c, isJ, K) {               // light and slim: two down-curved funnels to starboard; Hiryu's island to port
    var fwd = c.island > 0;
    return carrier(P, c, isJ, K, { hinomaru: true, elev: [0.45, 0.04, -0.385], galleries: [-0.34, -0.15, 0.22], island: function (g, s, P, K, D, top, side, hw, x0, dl, FD) {
      var r = ijnIsland(1.4, 0.85, fwd ? 0.2 : 0.02)(g, s, P, K, D, top, side, hw, x0, dl);
      K.downFunnel(s, P, x0 + dl * 0.035, FD - 0.35, 0.3, 1.15, 1, 2.35, c.beam / 2);
      K.downFunnel(s, P, x0 - dl * 0.005, FD - 0.35, 0.3, 1.15, 1, 2.35, c.beam / 2);
      return r;
    } });
  }
  CL.soryu = soryu;
  CL.shokaku = function (P, c, isJ, K) {      // big fleet carrier: starboard island forward, two down-curved funnels, tall hull
    return carrier(P, c, isJ, K, { hinomaru: true, fd: 1.85, elev: [0.45, 0.04, -0.385], island: function (g, s, P, K, D, top, side, hw, x0, dl, FD) {
      var r = ijnIsland(1.8, 1.0, 0.17)(g, s, P, K, D, top, side, hw, x0, dl);
      K.downFunnel(s, P, x0 + dl * 0.03, FD - 0.38, 0.38, 1.3, 1, 2.35, c.beam / 2);
      K.downFunnel(s, P, x0 - dl * 0.015, FD - 0.38, 0.38, 1.3, 1, 2.35, c.beam / 2);
      return r;
    } });
  };
})();
