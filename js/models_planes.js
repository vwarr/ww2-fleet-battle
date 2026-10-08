// models_planes.js (owner B) - chubby toon plane models. Load after models.js.
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
    starGeo.rotateX(-Math.PI / 2); // lie flat, facing up
    if (WW.models._whiten) WW.models._whiten(starGeo);
    return starGeo;
  }
  var COL = {
    USN: { fighter: 0x6f8cab, dive: 0x6a87a5, torpedo: 0x62809e, belly: 0xd9dde0 },
    IJN: { fighter: 0xc9c4a4, dive: 0x7a865c, torpedo: 0x6e7a52, belly: 0xd0ccb2 }
  };
  var SPEC = {
    fighter: { len: 2.3, span: 2.6, fw: 0.42, canopy: 0.55, chord: 0.66 },
    dive:    { len: 2.5, span: 2.8, fw: 0.46, canopy: 0.95, chord: 0.72 },
    torpedo: { len: 2.6, span: 3.0, fw: 0.48, canopy: 1.15, chord: 0.74 }
  };

  function buildPlane(kind, nationId) {
    var m = WW.models, box = m._box, bar = m._bar, cyl = m._cyl, disc = m._disc, xc = m._xc, sph = m._sph, mat = m._mat, C = m._C;
    var nat = m._nation(nationId), isJ = nat.id === 'IJN', cs = COL[nat.id] || COL.USN;
    var sp = SPEC[kind] || SPEC.fighter, col = cs[kind] || 0x7a8a9a;
    var g = new THREE.Group(), L = sp.len, fw = sp.fw, half = L / 2;
    // fuselage: chubby ellipsoid + tapering tail boom (y = 0 is the centre line)
    sph(g, col, L * 0.78, fw * 1.15, fw * 1.05, L * 0.08, 0, 0);
    sph(g, col, L * 0.62, fw * 0.62, fw * 0.55, -L * 0.24, 0.04, 0);
    xc(g, C.dark, fw * 0.56, 0.26, half - 0.12, 0, 0);                  // cowling
    sph(g, C.gun, 0.16, 0.16, 0.16, half + 0.05, 0, 0);                 // spinner
    sph(g, C.glass, sp.canopy, fw * 0.75, fw * 0.62, L * 0.06, fw * 0.4, 0);
    // wings (low wing, rounded tips), belly, tailplane, fin
    // (minimal test split, air_deaths agent: each wing half in its own pivot group at the wing root)
    var wingL = new THREE.Group(), wingR = new THREE.Group();
    wingL.position.set(L * 0.1, -fw * 0.42, 0); wingR.position.set(L * 0.1, -fw * 0.42, 0); g.add(wingL); g.add(wingR);
    [-1, 1].forEach(function (sgn) {
      var wg = sgn < 0 ? wingL : wingR;
      box(wg, col, sp.chord, 0.09, sp.span / 2, 0, 0, sgn * sp.span / 4);
      box(wg, cs.belly, sp.chord * 0.96, 0.03, sp.span * 0.97 / 2, 0, -0.015, sgn * sp.span * 0.97 / 4);
    });
    box(g, col, 0.42, 0.06, 1.05, -half + 0.22, -0.02, 0);
    box(g, col, 0.46, 0.5, 0.08, -half + 0.2, 0.0, 0);
    // wing marks (top of both wings)
    var wy = 0.088, wz = sp.span * 0.3, wx = 0;
    [-1, 1].forEach(function (sgn) {
      var wg = sgn < 0 ? wingL : wingR;
      if (isJ) {
        disc(wg, C.white, 0.27, 0.01, wx, wy, sgn * wz);
        disc(wg, C.red, 0.22, 0.015, wx, wy, sgn * wz);
      } else {
        disc(wg, nat.accent, 0.27, 0.01, wx, wy, sgn * wz);
        var st = new THREE.Mesh(star(), mat(C.white));
        st.scale.set(0.46, 1, 0.46); st.position.set(wx, wy + 0.016, sgn * wz); wg.add(st);
      }
      // fuselage side roundel (reads well from the low camera)
      var r0 = disc(g, isJ ? C.white : nat.accent, 0.17, 0.02, -L * 0.22, 0.03, sgn * fw * 0.33);
      r0.rotation.x = Math.PI / 2;
      var r1 = isJ ? disc(g, C.red, 0.13, 0.03, -L * 0.22, 0.03, sgn * fw * 0.33) : bar(g, C.white, 0.34, 0.06, 0.02, -L * 0.22, 0.0, sgn * fw * 0.34);
      if (isJ) r1.rotation.x = Math.PI / 2;
    });
    if (isJ) bar(g, C.red, 0.06, 0.12, fw * 0.62, -L * 0.36, -0.02, 0); // tail band
    // payload
    var payload = null;
    if (kind === 'torpedo') {
      payload = xc(g, C.gun, 0.09, 1.2, -0.1, -fw * 0.62, 0);
    } else if (kind === 'dive') {
      payload = sph(g, C.gun, 0.62, 0.2, 0.2, 0.1, -fw * 0.66, 0);
      if (isJ) { // Val fixed spatted gear
        sph(g, col, 0.32, 0.3, 0.12, L * 0.14, -fw * 0.42 - 0.18, 0.55);
        sph(g, col, 0.32, 0.3, 0.12, L * 0.14, -fw * 0.42 - 0.18, -0.55);
      }
    }
    // propeller: spins around local x
    var prop = new THREE.Group(); prop.position.set(half + 0.12, 0, 0); g.add(prop);
    var b1 = box(prop, C.dark, 0.05, 1.0, 0.13, 0, -0.5, 0);
    var b2 = box(prop, C.dark, 0.05, 1.0, 0.13, 0, 0, 0); b2.rotation.x = Math.PI / 2; b2.position.set(0, 0, -0.5);
    void b1;
    // merge static parts (prop and payload stay separate: they spin / hide)
    if (m._merge) {
      m._merge(g, 'plane|' + kind + '|' + nat.id, payload ? [prop, payload, wingL, wingR] : [prop, wingL, wingR], []);
      m._merge(wingL, 'plane|' + kind + '|' + nat.id + '|wL', [], []); m._merge(wingR, 'plane|' + kind + '|' + nat.id + '|wR', [], []);
    }
    if (m._shadows) m._shadows(g, false);
    return { group: g, prop: prop, payload: payload, wingL: wingL, wingR: wingR };
  }
  if (WW.models) WW.models.buildPlane = buildPlane;
  else console.error('models_planes.js must load after models.js');
})();
