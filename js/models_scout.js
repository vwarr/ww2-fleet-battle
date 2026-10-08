// models_scout.js - toon scout floatplanes for cruisers and battleships. Load after models_detail.js.
// USN: Kingfisher-style monoplane. IJN: Pete-style biplane. Both have one big centre float and two wing floats.
// Built from the shared models.js helpers (shared geometry + materials), static parts merged once per nation.
window.WW = window.WW || {};
(function () {
  'use strict';
  var starGeo = null;
  function star() {
    if (starGeo) return starGeo;
    var s = new THREE.Shape(), r1 = 0.5, r2 = 0.2;
    for (var i = 0; i < 10; i++) {
      var a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? r2 : r1;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    starGeo = new THREE.ShapeGeometry(s);
    starGeo.rotateX(-Math.PI / 2);
    WW.models._whiten(starGeo);
    return starGeo;
  }
  var COL = { USN: { body: 0x6f8cab, belly: 0xd9dde0 }, IJN: { body: 0x8c9670, belly: 0xc9c6ae } };
  // FLOAT_Y: bottom of the centre float in model units (y = 0 is the fuselage centre line).
  var FLOAT_Y = -0.86;

  function buildScout(nationId) {
    var m = WW.models, box = m._box, bar = m._bar, disc = m._disc, xc = m._xc, sph = m._sph, mat = m._mat, C = m._C;
    var nat = m._nation(nationId), isJ = nat.id === 'IJN', cs = COL[nat.id] || COL.USN, col = cs.body;
    var g = new THREE.Group(), L = 2.2, fw = 0.36, half = L / 2;
    // fuselage + tail boom
    sph(g, col, L * 0.8, fw * 1.1, fw, L * 0.06, 0, 0);
    sph(g, col, L * 0.6, fw * 0.55, fw * 0.5, -L * 0.26, 0.05, 0);
    xc(g, C.dark, fw * 0.55, 0.24, half - 0.1, 0, 0);                    // cowling
    sph(g, C.gun, 0.14, 0.14, 0.14, half + 0.05, 0, 0);                  // spinner
    // canopy: long two-seat greenhouse (USN), short open-cockpit fairing (IJN)
    if (isJ) { sph(g, C.glass, 0.34, fw * 0.6, fw * 0.5, 0.2, fw * 0.42, 0); sph(g, C.glass, 0.3, fw * 0.55, fw * 0.45, -0.3, fw * 0.4, 0); }
    else sph(g, C.glass, 1.05, fw * 0.75, fw * 0.55, -0.05, fw * 0.38, 0);
    // wings: low monoplane (USN) or biplane with struts (IJN)
    var span = isJ ? 2.5 : 2.7, wy = isJ ? -0.22 : -0.1;
    box(g, col, 0.58, 0.07, span, 0.12, wy, 0);
    box(g, cs.belly, 0.56, 0.03, span * 0.97, 0.12, wy - 0.015, 0);
    var topY = wy + 0.07, marksY = topY + 0.005;
    if (isJ) {
      box(g, col, 0.6, 0.07, span * 1.04, 0.2, 0.42, 0);                   // upper wing
      topY = 0.49; marksY = topY + 0.005;
      [-1, 1].forEach(function (k) {
        bar(g, C.dark, 0.04, 0.6, 0.04, 0.18, wy + 0.04, k * 0.85);        // interplane struts
        bar(g, C.dark, 0.04, 0.4, 0.04, 0.22, 0.05, k * 0.2);              // cabane struts
      });
    }
    box(g, col, 0.38, 0.05, 0.95, -half + 0.2, 0.0, 0);                  // tailplane
    box(g, col, 0.42, 0.46, 0.07, -half + 0.18, 0.02, 0);                // fin
    // floats: one big centre float on two struts, small floats under the outer wings
    sph(g, cs.belly, 1.75, 0.26, 0.3, 0.18, FLOAT_Y + 0.13, 0);
    bar(g, C.dark, 0.06, 0.6, 0.06, 0.42, FLOAT_Y + 0.18, 0);
    bar(g, C.dark, 0.06, 0.6, 0.06, -0.1, FLOAT_Y + 0.18, 0);
    [-1, 1].forEach(function (k) {
      sph(g, cs.belly, 0.5, 0.12, 0.13, 0.12, wy - 0.33, k * span * 0.41);
      bar(g, C.dark, 0.04, 0.3, 0.04, 0.12, wy - 0.3, k * span * 0.41);
      // wing marks (top of the wing that is visible from above) + fuselage roundel
      if (isJ) { disc(g, C.white, 0.22, 0.01, 0.2, marksY, k * span * 0.32); disc(g, C.red, 0.18, 0.015, 0.2, marksY, k * span * 0.32); }
      else {
        disc(g, nat.accent, 0.22, 0.01, 0.12, marksY, k * span * 0.32);
        var st = new THREE.Mesh(star(), mat(C.white)); st.scale.set(0.38, 1, 0.38); st.position.set(0.12, marksY + 0.016, k * span * 0.32); g.add(st);
      }
      var r0 = disc(g, isJ ? C.red : nat.accent, 0.13, 0.02, -L * 0.24, 0.04, k * fw * 0.3); r0.rotation.x = Math.PI / 2;
    });
    // propeller: spins around local x
    var prop = new THREE.Group(); prop.position.set(half + 0.1, 0, 0); g.add(prop);
    box(prop, C.dark, 0.05, 0.9, 0.12, 0, -0.45, 0);
    var b2 = box(prop, C.dark, 0.05, 0.9, 0.12, 0, 0, 0); b2.rotation.x = Math.PI / 2; b2.position.set(0, 0, -0.45);
    if (m._merge) m._merge(g, 'scout|' + nat.id, [prop], []);
    if (m._shadows) m._shadows(g, false);
    return { group: g, prop: prop, payload: null };
  }
  if (WW.models) { WW.models.buildScout = buildScout; WW.models.SCOUT_FLOAT_Y = FLOAT_Y; }
  else console.error('models_scout.js must load after models.js');
})();
