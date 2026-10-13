// models_tank.js - WW.tankModel: the M4 Sherman for the Normandy landings (visual only), hand-merged with vertex colours
// like the GI figure (models_soldier.js part / merge): the lower hull and the sloped glacis, sponsons, the tracks on
// their three VVSS bogies, the cast turret with its mantlet and 75 mm gun, the commander's hatch, the engine deck, the
// white Allied star. Two geometries:
//   sherman  the tank as it came off an LCT (models_landing.js tank deck; models_infantry.js ashore)
//   dd       the Duplex Drive tank swimming: the canvas flotation screen raised on its struts and air pillars round the
//            hull, the twin propellers behind (the 741st's tanks launched 5,000 yd out; 27 of 32 foundered in the chop)
// Local frame: on the ground at y = 0, facing +x; ~0.8 u long, 0.36 u wide (the ships' scale, x1.3 like the craft).
// DD: SCREEN_TOP is the screen's top edge above the tank's ground plane (it swam with ~1 m of canvas above the sea).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const C = { od: 0x5e6847, odD: 0x4c553a, track: 0x3a3a34, wheel: 0x2f302b, metal: 0x3a3c3e, star: 0xe8e4d8, canvas: 0xb2a684, canvasD: 0x8f8466, strut: 0x55524a, prop: 0x6a5a3a };
  const SCREEN_TOP = 0.62;
  let geos = null;
  function hull(P, K) {
    const { box, sph, cyl } = K.prims(), p = K.part, Z = Math.PI / 2;
    P.push(p(box, C.odD, [0.74, 0.1, 0.24], [0, 0.11, 0]));                         // lower hull between the tracks
    P.push(p(box, C.od, [0.58, 0.13, 0.36], [-0.05, 0.225, 0]));                     // upper hull and sponsons
    P.push(p(box, C.od, [0.24, 0.028, 0.35], [0.29, 0.215, 0], [0, 0, -0.85]));      // the sloped glacis
    P.push(p(box, C.odD, [0.06, 0.12, 0.3], [0.37, 0.13, 0], [0, 0, 0.5]));          // the transmission nose
    P.push(p(box, C.metal, [0.22, 0.012, 0.26], [-0.22, 0.293, 0]));               // engine deck grilles
    P.push(p(cyl, C.star, [0.11, 0.004, 0.11], [-0.04, 0.292, 0]));                 // the white star (in its circle) on the deck
    for (const z of [0.15, -0.15]) {
      P.push(p(box, C.track, [0.8, 0.045, 0.09], [0, 0.125, z]));                     // track top run
      P.push(p(box, C.track, [0.7, 0.04, 0.09], [0, 0.02, z]));                       // ground run
      P.push(p(cyl, C.track, [0.1, 0.09, 0.1], [0.36, 0.07, z], [Z, 0, 0]));          // idler / sprocket
      P.push(p(cyl, C.track, [0.1, 0.09, 0.1], [-0.36, 0.07, z], [Z, 0, 0]));
      for (const bx of [-0.22, 0, 0.22]) {                                             // VVSS bogies: two wheels and a bracket
        P.push(p(box, C.odD, [0.09, 0.06, 0.02], [bx, 0.07, z + Math.sign(z) * 0.05]));
        for (const d of [-0.035, 0.035]) P.push(p(cyl, C.wheel, [0.06, 0.03, 0.06], [bx + d, 0.045, z + Math.sign(z) * 0.035], [Z, 0, 0]));
      }
    }
    for (const z of [0.12, -0.12]) P.push(p(cyl, C.metal, [0.035, 0.03, 0.035], [-0.3, 0.27, z], [0, 0, Z]));   // exhaust deflector bits
  }
  function turret(P, K) {
    const { box, sph, cyl, dome } = K.prims(), p = K.part, Z = Math.PI / 2;
    P.push(p(cyl, C.od, [0.28, 0.05, 0.26], [0.0, 0.315, 0]));                       // turret ring and lower casting
    P.push(p(sph, C.od, [0.3, 0.17, 0.27], [0.0, 0.35, 0]));                         // the cast turret
    P.push(p(box, C.od, [0.06, 0.08, 0.13], [0.14, 0.355, 0]));                      // mantlet
    P.push(p(cyl, C.metal, [0.034, 0.3, 0.034], [0.3, 0.36, 0], [0, 0, -Z]));        // 75 mm gun
    P.push(p(cyl, C.odD, [0.08, 0.04, 0.08], [-0.05, 0.43, 0.06]));                   // commander's hatch
    P.push(p(cyl, C.odD, [0.06, 0.025, 0.06], [-0.04, 0.425, -0.07]));                // loader's hatch
    P.push(p(box, C.metal, [0.006, 0.12, 0.006], [-0.1, 0.48, -0.08]));               // radio antenna
    for (const z of [0.135, -0.135]) P.push(p(cyl, C.star, [0.06, 0.004, 0.06], [0.0, 0.35, z], [Z, 0, 0]));   // stars on the turret sides
  }
  // the DD flotation screen: a canvas wall on a boat-shaped outline round the hull, struts, a top rail, and the
  // propellers behind
  function screen(P, K) {
    const { box, cyl } = K.prims(), p = K.part, N = 18, y0 = 0.22, y1 = SCREEN_TOP, h = y1 - y0;
    const pt = a => { const c = Math.cos(a), s = Math.sin(a); return [c * (c > 0 ? 0.56 : 0.47) * (c > 0 ? 1 - 0.18 * s * s : 1), s * 0.26]; };
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, A = pt(a0), B = pt(a1);
      const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, L = Math.hypot(B[0] - A[0], B[1] - A[1]) + 0.01, r = -Math.atan2(B[1] - A[1], B[0] - A[0]);
      P.push(p(box, i & 1 ? C.canvas : C.canvasD, [L, h, 0.014], [mx, y0 + h / 2, mz], [0, r, 0]));       // canvas panel
      P.push(p(box, C.strut, [L, 0.02, 0.026], [mx, y1, mz], [0, r, 0]));                                // top rail
      if (!(i % 3)) P.push(p(box, C.strut, [0.014, h, 0.014], [A[0] * 0.97, y0 + h / 2, A[1] * 0.97], [0, 0, Math.sign(A[0]) * -0.12]));   // strut
    }
    for (const z of [0.09, -0.09]) {                                                   // the twin propellers, lowered
      P.push(p(box, C.metal, [0.02, 0.18, 0.02], [-0.47, 0.16, z]));
      P.push(p(cyl, C.prop, [0.08, 0.015, 0.08], [-0.49, 0.08, z], [0, 0, Math.PI / 2]));
    }
  }
  function build() {
    if (geos) return geos;
    const K = WW.soldierModel, S = [], D = [];
    hull(S, K); turret(S, K);
    hull(D, K); turret(D, K); screen(D, K);
    geos = { sherman: K.merge(S), dd: K.merge(D) };
    return geos;
  }
  WW.tankModel = { build, COLORS: C, SCREEN_TOP };
})(window.WW);
