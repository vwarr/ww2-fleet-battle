// models_vehicles.js - WW.vehicleModel: the vehicles and the beach engineers' gear at Omaha and Pointe du Hoc (visual
// only), hand-merged with vertex colours like the Sherman (models_tank.js) and the GI (models_soldier.js part / merge /
// prims), drawn by vehicles_fx.js and hoc_fx.js. Local frame: on the ground at y = 0, facing +x; the ships' scale x1.3
// like the craft (1 m ~ 0.135 u). Geometries:
//   jeep       the Willys MB: the body tub, the flat bonnet with its white star, the windscreen folded down on the
//              bonnet, four wheels, the spare on the back, the radio whip
//   truck      the GMC CCKW 2½-ton 6x6: the bonnet and the open cab, the cargo bed under its canvas tilt, six wheels
//   halftrack  the M16 multiple gun motor carriage (the AAA battalions' half-tracks): the armoured body, the front wheels and
//              the rear track run, the quad .50 Maxson turret in the back
//   blade      the tank dozer's M1 blade on its push arms (drawn on the Sherman at its bow: tank + blade)
//   d7         the armoured Caterpillar D-7: low tracks, the engine with the improvised armour box over the driver, the
//              blade on its push arms
//   dukw       the DUKW: the boat hull on six wheels, the windscreen and the cab, the cargo well; howitzer: the 105 mm
//              M2A1 in the well (the 111th FA's); ladderBase: the turntable of the London Fire Brigade's extension
//              ladder in the well; ladder: one 1 u section of the ladder along +x (scaled to its length)
//   buoy       a gap lane's marker buoy: the float and its staff with a little flag; flagG / flagR: a lane marker pole
//              with its pennant (green / red: the two sides of the lane, as the beach markers' colours went)
//   ditch      an anti-tank ditch across a draw's mouth (a dark trench and its spoil bank: 1 u along x, 1 u across);
//              fill: the same filled by the dozers (a pale scraped road over it); roadblock: steel gates and rails
//   rope       a 1 u rope along +y (the grapnels' lines down the cliff, scaled to the cliff); ropeLadder: the rope
//              ladder; steelLadder: the Rangers' tubular steel sections; grapnel: the hook at the top
// The prisoners: the German figure (models_german.js figure) with the hands up (walking: two frames) or on the head
// (sitting in a huddle), built in vehicles_fx.js.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const C = { od: 0x5e6847, odD: 0x4c553a, odL: 0x6c7553, tyre: 0x262624, rim: 0x4a4c40, metal: 0x3a3c3e, star: 0xe8e4d8, canvas: 0x6f7152, canvasD: 0x5d5f45,
    glass: 0x5b6670, cat: 0x5a5e4a, catD: 0x464a3a, plate: 0x585f4d, navy: 0x5f6b74, navyD: 0x4b555d, red: 0xb84a3e, green: 0x4f9a55, white: 0xe6e2d6,
    float: 0xd2564c, earth: 0x5d4f3c, earthD: 0x3f352a, spoil: 0x8a7b5f, fill: 0xa49576, steel: 0x4c4f52, rope: 0xb8a77e, ropeD: 0x8a7a58, ladder: 0x8c8f88 };
  let geos = null;
  const Z = Math.PI / 2;
  function wheel(P, K, x, z, r, w) { const { cyl } = K.prims(); P.push(K.part(cyl, C.tyre, [r * 2, w, r * 2], [x, r, z], [Z, 0, 0])); P.push(K.part(cyl, C.rim, [r * 1.1, w + 0.004, r * 1.1], [x, r, z], [Z, 0, 0])); }
  function jeep(K) {
    const { box, cyl } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.od, [0.3, 0.075, 0.2], [-0.04, 0.1, 0]));                 // the tub
    P.push(p(box, C.od, [0.14, 0.06, 0.17], [0.15, 0.115, 0]));              // the bonnet
    P.push(p(box, C.odD, [0.03, 0.06, 0.18], [0.225, 0.09, 0]));              // the grille
    P.push(p(cyl, C.star, [0.06, 0.003, 0.06], [0.15, 0.147, 0]));
    P.push(p(box, C.glass, [0.012, 0.01, 0.17], [0.09, 0.15, 0]));           // the windscreen, folded down on the bonnet
    P.push(p(box, C.odD, [0.06, 0.045, 0.16], [-0.03, 0.155, 0]));           // the seats
    P.push(p(box, C.odD, [0.05, 0.05, 0.16], [-0.14, 0.15, 0]));
    for (const z of [0.1, -0.1]) P.push(p(box, C.odL, [0.1, 0.012, 0.03], [0.15, 0.085, z * 1.1]));   // the wings
    for (const [x, z] of [[0.14, 0.095], [0.14, -0.095], [-0.12, 0.095], [-0.12, -0.095]]) wheel(P, K, x, z, 0.04, 0.03);
    wheel(P, K, -0.205, 0, 0.038, 0.025);                                     // the spare
    P.push(p(box, C.metal, [0.004, 0.22, 0.004], [-0.17, 0.25, 0.08]));       // the radio whip
    return K.merge(P);
  }
  function truck(K) {
    const { box } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.odD, [0.84, 0.04, 0.14], [0, 0.085, 0]));                 // the chassis
    P.push(p(box, C.od, [0.17, 0.09, 0.2], [0.34, 0.15, 0]));                 // the bonnet
    P.push(p(box, C.odD, [0.02, 0.08, 0.18], [0.43, 0.14, 0]));               // the grille
    P.push(p(box, C.od, [0.1, 0.12, 0.27], [0.21, 0.17, 0]));                 // the cab
    P.push(p(box, C.glass, [0.01, 0.05, 0.22], [0.262, 0.255, 0]));
    P.push(p(box, C.od, [0.5, 0.08, 0.3], [-0.12, 0.17, 0]));                 // the bed
    P.push(p(box, C.canvas, [0.48, 0.13, 0.29], [-0.12, 0.275, 0]));          // the canvas tilt
    P.push(p(box, C.canvasD, [0.48, 0.02, 0.27], [-0.12, 0.345, 0]));
    for (const z of [0.13, -0.13]) P.push(p(box, C.odL, [0.14, 0.012, 0.05], [0.33, 0.12, z]));
    for (const [x, z] of [[0.33, 0.12], [0.33, -0.12], [-0.08, 0.12], [-0.08, -0.12], [-0.25, 0.12], [-0.25, -0.12]]) wheel(P, K, x, z, 0.055, 0.045);
    return K.merge(P);
  }
  function halftrack(K) {
    const { box, cyl } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.odD, [0.72, 0.05, 0.22], [0, 0.07, 0]));
    P.push(p(box, C.od, [0.18, 0.1, 0.22], [0.27, 0.15, 0]));                 // the armoured bonnet
    P.push(p(box, C.od, [0.48, 0.13, 0.3], [-0.08, 0.17, 0]));                // the armoured body
    P.push(p(box, C.odL, [0.02, 0.06, 0.28], [0.17, 0.26, 0], [0, 0, -0.3])); // the windscreen armour, up
    P.push(p(cyl, C.star, [0.08, 0.003, 0.08], [0.27, 0.202, 0]));
    P.push(p(box, C.metal, [0.04, 0.08, 0.24], [0.38, 0.11, 0]));             // the roller in front
    for (const z of [0.12, -0.12]) {
      wheel(P, K, 0.27, z, 0.06, 0.04);
      P.push(p(box, C.tyre, [0.34, 0.05, 0.07], [-0.15, 0.09, z * 1.05]));    // the track run
      P.push(p(box, C.tyre, [0.3, 0.03, 0.07], [-0.15, 0.015, z * 1.05]));
      P.push(p(cyl, C.tyre, [0.1, 0.07, 0.1], [0.01, 0.05, z * 1.05], [Z, 0, 0]));
      P.push(p(cyl, C.tyre, [0.1, 0.07, 0.1], [-0.31, 0.05, z * 1.05], [Z, 0, 0]));
    }
    P.push(p(cyl, C.odD, [0.18, 0.06, 0.18], [-0.14, 0.26, 0]));              // the Maxson mount
    P.push(p(box, C.plate, [0.04, 0.08, 0.16], [-0.06, 0.31, 0]));
    for (const [dy, dz] of [[0.02, 0.05], [0.02, -0.05], [0.06, 0.05], [0.06, -0.05]]) P.push(p(cyl, C.metal, [0.014, 0.2, 0.014], [0.03, 0.28 + dy, dz], [0, 0, -Z + 0.35]));
    return K.merge(P);
  }
  function blade(K, w, h) {   // a dozer blade on its push arms: the blade's face at x = 0, the arms back toward -x
    const { box } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.steel, [0.035, h, w], [0, h / 2, 0], [0, 0, 0.12]));
    P.push(p(box, C.metal, [0.03, 0.02, w + 0.01], [-0.005, 0.02, 0]));         // the cutting edge
    for (const z of [w * 0.42, -w * 0.42]) P.push(p(box, C.odD, [0.24, 0.03, 0.03], [-0.13, 0.07, z], [0, 0, -0.15]));
    return P;
  }
  function d7(K) {
    const { box, cyl } = K.prims(), p = K.part, P = [];
    for (const z of [0.13, -0.13]) {
      P.push(p(box, C.tyre, [0.52, 0.09, 0.08], [-0.04, 0.05, z]));
      for (const x of [0.2, -0.28]) P.push(p(cyl, C.metal, [0.09, 0.085, 0.09], [x, 0.05, z], [Z, 0, 0]));
    }
    P.push(p(box, C.cat, [0.22, 0.12, 0.17], [0.07, 0.16, 0]));              // the engine
    P.push(p(box, C.catD, [0.02, 0.1, 0.15], [0.185, 0.155, 0]));             // the radiator
    P.push(p(box, C.plate, [0.22, 0.19, 0.27], [-0.17, 0.2, 0]));            // the armour box over the driver
    P.push(p(box, C.metal, [0.01, 0.025, 0.12], [-0.055, 0.26, 0]));          // its vision slit
    P.push(p(cyl, C.metal, [0.025, 0.1, 0.025], [0.1, 0.27, 0.04]));          // the exhaust
    for (const q of blade(K, 0.36, 0.14)) { q.m = new THREE.Matrix4().makeTranslation(0.36, 0.0, 0).multiply(q.m); P.push(q); }
    return K.merge(P);
  }
  function dozerBlade(K) {   // on a Sherman (the tank dozer): at its bow
    const P = blade(K, 0.42, 0.17);
    for (const q of P) q.m = new THREE.Matrix4().makeTranslation(0.49, 0.0, 0).multiply(q.m);
    return K.merge(P);
  }
  function dukw(K) {
    const { box, cyl } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.od, [0.9, 0.13, 0.33], [-0.08, 0.2, 0]));                 // the hull
    P.push(p(box, C.od, [0.22, 0.1, 0.26], [0.45, 0.19, 0], [0, 0, 0.35]));   // the bow, raked
    P.push(p(box, C.odD, [0.3, 0.06, 0.3], [-0.42, 0.18, 0], [0, 0, -0.2]));  // the stern
    P.push(p(box, C.odL, [0.92, 0.015, 0.34], [-0.08, 0.27, 0]));             // the gunwale
    P.push(p(box, C.odD, [0.5, 0.02, 0.28], [-0.12, 0.2, 0]));               // the well's floor
    P.push(p(box, C.glass, [0.012, 0.07, 0.28], [0.22, 0.31, 0], [0, 0, -0.25]));   // the windscreen
    P.push(p(box, C.odD, [0.08, 0.05, 0.28], [0.15, 0.29, 0]));              // the cab's seat back
    P.push(p(cyl, C.star, [0.08, 0.003, 0.08], [0.38, 0.262, 0]));
    for (const [x, z] of [[0.3, 0.15], [0.3, -0.15], [-0.15, 0.15], [-0.15, -0.15], [-0.32, 0.15], [-0.32, -0.15]]) wheel(P, K, x, z, 0.06, 0.04);
    return K.merge(P);
  }
  function howitzer(K) {   // the 105 mm M2A1 in the DUKW's well, its trails folded, the barrel over the bow
    const { box, cyl } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.od, [0.04, 0.09, 0.14], [0, 0.29, 0]));                  // the shield
    P.push(p(box, C.odD, [0.12, 0.05, 0.08], [-0.05, 0.27, 0]));             // the cradle
    P.push(p(cyl, C.metal, [0.03, 0.3, 0.03], [0.14, 0.3, 0], [0, 0, -Z]));  // the barrel
    P.push(p(box, C.odD, [0.28, 0.025, 0.04], [-0.2, 0.24, 0.04]));          // the trails
    P.push(p(box, C.odD, [0.28, 0.025, 0.04], [-0.2, 0.24, -0.04]));
    for (let i = 0; i < 4; i++) P.push(p(box, C.canvasD, [0.06, 0.035, 0.06], [-0.3 + (i % 2) * 0.07, 0.22 + (i > 1 ? 0.035 : 0), 0.1]));   // sandbags
    return K.merge(P);
  }
  function ladderBase(K) {
    const { box, cyl } = K.prims(), p = K.part, P = [];
    P.push(p(cyl, C.red, [0.18, 0.05, 0.18], [-0.15, 0.25, 0]));              // the turntable (the fire brigade's red)
    P.push(p(box, C.red, [0.1, 0.08, 0.12], [-0.15, 0.3, 0]));
    return K.merge(P);
  }
  function ladderSection(K) {  // 1 u along +x: the two strings and the rounds
    const { box } = K.prims(), p = K.part, P = [];
    for (const z of [0.04, -0.04]) P.push(p(box, C.ladder, [1, 0.015, 0.012], [0.5, 0, z]));
    for (let i = 0; i < 8; i++) P.push(p(box, C.ladder, [0.01, 0.01, 0.08], [0.06 + i * 0.125, 0, 0]));
    return K.merge(P);
  }
  function buoy(K) {
    const { box, cyl, sph } = K.prims(), p = K.part, P = [];
    P.push(p(sph, C.float, [0.16, 0.12, 0.16], [0, 0.02, 0]));
    P.push(p(box, C.metal, [0.012, 0.3, 0.012], [0, 0.2, 0]));
    P.push(p(box, C.white, [0.09, 0.05, 0.004], [0.045, 0.32, 0]));
    return K.merge(P);
  }
  function flag(K, col) {
    const { box } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.ropeD, [0.012, 0.42, 0.012], [0, 0.21, 0]));
    P.push(p(box, col, [0.12, 0.07, 0.004], [0.06, 0.38, 0]));
    return K.merge(P);
  }
  function ditch(K, filled) {   // 1 u along x (the draw's width, scaled), 1 u across z; the trench and its spoil seaward
    const { box } = K.prims(), p = K.part, P = [];
    if (!filled) {
      P.push(p(box, C.earthD, [1, 0.03, 0.42], [0, 0.012, 0]));
      P.push(p(box, C.earth, [1, 0.06, 0.08], [0, 0.0, 0.22]));
      P.push(p(box, C.spoil, [1, 0.12, 0.3], [0, 0.04, -0.4]));
    } else {
      P.push(p(box, C.fill, [1, 0.03, 0.6], [0, 0.015, 0]));
      P.push(p(box, C.spoil, [0.25, 0.07, 0.28], [0.62, 0.03, -0.35]));
    }
    return K.merge(P);
  }
  function roadblock(K) {   // steel gates and rails across the road: 1 u along x
    const { box } = K.prims(), p = K.part, P = [];
    for (let i = 0; i < 4; i++) {
      const x = -0.4 + i * 0.27;
      P.push(p(box, C.steel, [0.02, 0.2, 0.02], [x, 0.1, 0], [0.6, 0, 0.6]));
      P.push(p(box, C.steel, [0.02, 0.2, 0.02], [x, 0.1, 0], [-0.6, 0, -0.6]));
    }
    P.push(p(box, C.wood, [1, 0.04, 0.04], [0, 0.17, 0.02]));
    return K.merge(P);
  }
  function rope(K, col, w) { const { box } = K.prims(); return K.merge([K.part(box, col, [w, 1, w], [0, 0.5, 0])]); }
  function ropeLadder(K) {
    const { box } = K.prims(), p = K.part, P = [];
    for (const x of [0.035, -0.035]) P.push(p(box, C.rope, [0.008, 1, 0.008], [x, 0.5, 0]));
    for (let i = 0; i < 10; i++) P.push(p(box, C.ropeD, [0.07, 0.008, 0.012], [0, 0.05 + i * 0.1, 0]));
    return K.merge(P);
  }
  function steelLadder(K) {
    const { box } = K.prims(), p = K.part, P = [];
    for (const x of [0.045, -0.045]) P.push(p(box, C.ladder, [0.012, 1, 0.012], [x, 0.5, 0]));
    for (let i = 0; i < 9; i++) P.push(p(box, C.ladder, [0.09, 0.01, 0.01], [0, 0.06 + i * 0.11, 0]));
    return K.merge(P);
  }
  function grapnel(K) {
    const { box } = K.prims(), p = K.part, P = [];
    P.push(p(box, C.metal, [0.012, 0.08, 0.012], [0, 0.04, 0]));
    for (let i = 0; i < 4; i++) { const a = i * Z; P.push(p(box, C.metal, [0.05, 0.01, 0.01], [Math.cos(a) * 0.02, 0.01, Math.sin(a) * 0.02], [0, -a, 0.6])); }
    return K.merge(P);
  }
  C.wood = 0x7a6448;
  function build() {
    if (geos) return geos;
    const K = WW.soldierModel; K.prims();
    geos = { jeep: jeep(K), truck: truck(K), halftrack: halftrack(K), blade: dozerBlade(K), d7: d7(K), dukw: dukw(K), howitzer: howitzer(K),
      ladderBase: ladderBase(K), ladder: ladderSection(K), buoy: buoy(K), flagG: flag(K, C.green), flagR: flag(K, C.red),
      ditch: ditch(K, false), fill: ditch(K, true), roadblock: roadblock(K), rope: rope(K, C.rope, 0.01), ropeLadder: ropeLadder(K), steelLadder: steelLadder(K), grapnel: grapnel(K) };
    return geos;
  }
  WW.vehicleModel = { build, COLORS: C };
})(window.WW);
