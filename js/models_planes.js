// models_planes.js (owner B) - plane models. Load after models.js.
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
    return starGeo;
  }
  var COL = {
    USN: { fighter: 0x5a7896, dive: 0x56728e, torpedo: 0x4f6b88, belly: 0xc8ccd0 },
    IJN: { fighter: 0xc9c6a6, dive: 0x56623f, torpedo: 0x4e5a3a, belly: 0xb8b6a0 }
  };
  var SPEC = {
    fighter: { len: 2.3, span: 2.6, fw: 0.36, canopy: 0.5, chord: 0.62 },
    dive:    { len: 2.5, span: 2.8, fw: 0.4, canopy: 0.95, chord: 0.7 },
    torpedo: { len: 2.6, span: 3.0, fw: 0.42, canopy: 1.15, chord: 0.72 }
  };

  function buildPlane(kind, nationId) {
    var m = WW.models, box = m._box, cyl = m._cyl, disc = m._disc, mat = m._mat, C = m._C;
    var nat = m._nation(nationId), isJ = nat.id === 'IJN';
    var sp = SPEC[kind] || SPEC.fighter, col = (COL[nat.id] || COL.USN)[kind] || 0x777777;
    var g = new THREE.Group(), L = sp.len, fw = sp.fw, half = L / 2;
    // fuselage (y=0 is the centre line)
    box(g, col, L * 0.9, fw, fw, -L * 0.03, -fw / 2, 0);
    box(g, col, L * 0.3, fw * 0.6, fw * 0.6, -half + L * 0.1, -fw * 0.3, 0); // tail taper
    var cowl = cyl(g, C.dark, fw * 0.62, 0.3, half - 0.05, 0, 0); cowl.rotation.z = -Math.PI / 2;
    box(g, C.glass, sp.canopy, fw * 0.45, fw * 0.6, L * 0.08, fw / 2 - 0.02, 0);
    // wings (low wing), tailplane, fin
    box(g, col, sp.chord, 0.07, sp.span, L * 0.12, -fw * 0.4, 0);
    box(g, (COL[nat.id] || COL.USN).belly, sp.chord * 0.98, 0.02, sp.span * 0.98, L * 0.12, -fw * 0.4 - 0.02, 0);
    box(g, col, 0.38, 0.05, 1.0, -half + 0.2, -0.02, 0);
    box(g, col, 0.4, 0.42, 0.06, -half + 0.2, 0.0, 0);
    // wing marks (top of both wings)
    var wy = -fw * 0.4 + 0.075, wz = sp.span * 0.33, wx = L * 0.12;
    [-1, 1].forEach(function (sgn) {
      if (isJ) {
        disc(g, C.white, 0.27, 0.01, wx, wy, sgn * wz);
        disc(g, C.red, 0.22, 0.015, wx, wy, sgn * wz);
      } else {
        disc(g, nat.accent, 0.27, 0.01, wx, wy, sgn * wz);
        var st = new THREE.Mesh(star(), mat(C.white));
        st.scale.set(0.46, 1, 0.46); st.position.set(wx, wy + 0.016, sgn * wz); g.add(st);
      }
    });
    if (isJ) { // fuselage hinomaru (side)
      box(g, C.red, 0.2, 0.2, fw + 0.02, -half + 0.6, -0.1, 0);
    } else {
      box(g, C.white, 0.2, 0.08, fw + 0.02, -half + 0.6, -0.04, 0);
    }
    // payload
    var payload = null;
    if (kind === 'torpedo') {
      payload = cyl(g, C.gun, 0.08, 1.2, 0.5, -fw / 2 - 0.12, 0); payload.rotation.z = -Math.PI / 2; payload.position.x = -0.6;
    } else if (kind === 'dive') {
      payload = box(g, C.gun, 0.6, 0.16, 0.16, 0.1, -fw / 2 - 0.18, 0);
      if (isJ) { // Val fixed spatted gear
        box(g, col, 0.3, 0.3, 0.1, L * 0.15, -fw * 0.4 - 0.3, 0.55);
        box(g, col, 0.3, 0.3, 0.1, L * 0.15, -fw * 0.4 - 0.3, -0.55);
      }
    }
    // propeller: spins around local x
    var prop = new THREE.Group(); prop.position.set(half + 0.27, 0, 0); g.add(prop);
    box(prop, C.dark, 0.04, 0.95, 0.1, 0, -0.475, 0);
    var b2 = box(prop, C.dark, 0.04, 0.95, 0.1, 0, 0, -0.475); b2.rotation.x = Math.PI / 2; b2.position.set(0, 0, -0.475);
    box(prop, C.gun, 0.1, 0.12, 0.12, 0.02, -0.06, 0);
    return { group: g, prop: prop, payload: payload };
  }
  if (WW.models) WW.models.buildPlane = buildPlane;
  else console.error('models_planes.js must load after models.js');
})();
