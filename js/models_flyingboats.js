// models_flyingboats.js - toon flying boats in the carrier planes' lofted style. Load after models_planes.js.
// USN: PBY Catalina (boat hull, parasol wing on a central pylon with struts, two engines on the wing leading edge,
//      wingtip floats that swing out to form the wing tips in flight, waist blisters, sea blue over white, the star).
// IJN: H6K "Mavis" (long slim hull, long parasol wing on struts, four engines, twin fins, fixed wing floats,
//      green over grey, the hinomaru).
// Built with the lofting kit of models_planes.js (WW.models._planeKit): every static part is baked once per nation
// into one vertex-coloured geometry that every pooled boat shares; props (spin about local x) and the PBY floats
// (fold about local x) are their own small shared meshes. Nose on +x, hull centre line y = 0.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI;
  var PAINT = {
    USN: { top: 0x58789a, belly: 0xdfe3e4, lip: 0x343c48, blade: 0x3a3d42, tip: 0xe8c450, glass: 0x4a7392, frame: 0x45607c, strut: 0x4d6a8a },
    IJN: { top: 0x5d6b48, belly: 0xb4b6aa, lip: 0x2c3036, blade: 0x6e6252, tip: 0xc85448, glass: 0x4a7392, frame: 0x47513c, strut: 0x4f5c3e }
  };
  // shapes (model units). hull: [x, half width, half height, centre y] tail -> nose; wing: as models_planes.js
  var TYPES = {
    USN: { name: 'PBY Catalina',
      hull: [[-2.06, 0.04, 0.07, 0.44], [-1.65, 0.11, 0.16, 0.35], [-1.0, 0.22, 0.29, 0.2], [-0.25, 0.3, 0.4, 0.06], [0.55, 0.32, 0.43, 0.03], [1.25, 0.3, 0.39, 0.05], [1.72, 0.22, 0.29, 0.09], [1.96, 0.07, 0.1, 0.14]],
      wing: { qc: 0.22, y: 1.08, root: 0.92, tip: 0.56, semi: 3.25, z0: 0.06, dih: 0.0, sweep: 0.0, tip_: 'round', t: 0.15 },
      tail: { qc: -1.84, y: 0.86, root: 0.46, tip: 0.26, semi: 0.82, tip_: 'round' },
      fin: { qc: -1.86, y: 0.44, root: 0.7, tip: 0.36, semi: 1.0, tip_: 'round' },
      engines: [0.96], nac: 0.17, prop: 0.5, pylon: [0.15, 0.95], blisters: -0.78, floatZ: 2.42, floatLen: 0.66,
      struts: [[0.42, 1.32], [0.0, 1.32]], cockpit: [1.08, 1.5], marks: 2.3 },
    IJN: { name: 'H6K Mavis',
      hull: [[-2.5, 0.04, 0.06, 0.46], [-2.05, 0.1, 0.14, 0.36], [-1.3, 0.2, 0.26, 0.2], [-0.4, 0.26, 0.36, 0.06], [0.6, 0.27, 0.38, 0.03], [1.5, 0.25, 0.34, 0.05], [2.05, 0.18, 0.25, 0.09], [2.3, 0.06, 0.09, 0.13]],
      wing: { qc: 0.3, y: 1.12, root: 0.86, tip: 0.44, semi: 3.75, z0: 0.06, dih: 0.0, sweep: 0.0, tip_: 'round', t: 0.14 },
      tail: { qc: -2.18, y: 0.6, root: 0.44, tip: 0.36, semi: 0.92, tip_: 'square' },
      fin: { qc: -2.2, y: 0.6, root: 0.5, tip: 0.3, semi: 0.62, tip_: 'round' },
      engines: [0.82, 1.72], nac: 0.14, prop: 0.42, pylon: [0.25, 0.7], twin: 0.9, floatZ: 2.55, floatLen: 0.62, fixedFloats: true,
      struts: [[0.5, 1.15], [0.1, 1.15], [0.5, 2.05], [0.1, 2.05]], cockpit: [1.3, 1.78], tailGlass: true, marks: 2.7 }
  };
  var TPL = {}, K, M, _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();

  // a thin bar from a to b ([x, y, z]); models.js bar() has its bottom at y = 0, so it grows from a along its y
  function strut(p, hex, w, a, b) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    var L = _d.length(), o = M._bar(p, hex, w, L, w, a[0], a[1], a[2]);
    o.quaternion.setFromUnitVectors(_y, _d.normalize());
    return o;
  }
  function blades(P, R) {
    var pr = new THREE.Group();
    for (var b = 0; b < 3; b++) {
      var arm = new THREE.Group(); arm.rotation.x = b * 2 * PI / 3; pr.add(arm);
      M._bar(arm, P.blade, 0.035, R - 0.1, 0.085, 0, 0.05, 0).rotation.x = 0.25;
      M._bar(arm, P.tip, 0.037, 0.07, 0.08, 0, R - 0.08, 0).rotation.x = 0.25;
    }
    return K.bake(pr);
  }
  function template(nat) {
    if (TPL[nat]) return TPL[nat];
    K = WW.models._planeKit; M = WW.models; K.init();
    var T = TYPES[nat], P = PAINT[nat], J = nat === 'IJN', st = K.smooth(T.hull, 3), b = new THREE.Group();
    var hwAt = function (x) { for (var i = 1; i < st.length; i++) if (st[i][0] >= x) return st[i]; return st[st.length - 1]; };
    // boat hull: boxy sections (p 2.7), painted two-tone, a darker chine stripe at the waterline, the planing step
    K.meshOf(b, K.tube(K.bodyRings(st, 18, 2.7, function (s, sn) { return sn < -0.42 ? P.belly : P.top; }), true, P.lip));
    var sx = J ? -0.4 : -0.25, ss = hwAt(sx);
    M._bar(b, P.lip, 0.05, 0.03, ss[1] * 1.6, sx, ss[3] - ss[2] * 0.96, 0);              // the step under the hull
    // glass: bow turret, cockpit, waist blisters (PBY) / tail turret (H6K)
    var nose = T.hull[T.hull.length - 1], n2 = T.hull[T.hull.length - 2];
    M._sph(b, P.glass, 0.34, 0.26, 0.26, nose[0] - 0.12, n2[3] + 0.08, 0);
    var c0 = T.cockpit[0], c1 = T.cockpit[1], cs = hwAt((c0 + c1) / 2);
    M._sph(b, P.glass, c1 - c0, 0.22, cs[1] * 1.45, (c0 + c1) / 2, cs[3] + cs[2] - 0.06, 0);
    M._bar(b, P.frame, 0.03, 0.03, cs[1] * 1.3, (c0 + c1) / 2, cs[3] + cs[2] + 0.04, 0);
    if (T.blisters) [-1, 1].forEach(function (k) { var bs = hwAt(T.blisters); M._sph(b, P.glass, 0.48, 0.34, 0.26, T.blisters, bs[3] + bs[2] * 0.35, k * bs[1] * 0.92); });
    if (T.tailGlass) M._sph(b, P.glass, 0.3, 0.14, 0.14, T.hull[0][0] + 0.06, T.hull[0][3] + 0.02, 0);
    // tail: PBY one tall fin, tailplane up on it; H6K tailplane on the hull with twin fins at its tips
    K.meshOf(b, K.surface(T.tail, 1, P, 0.02, true)); K.meshOf(b, K.surface(T.tail, -1, P, 0.02, true));
    var fins = T.twin ? [-T.twin, T.twin] : [0];
    fins.forEach(function (fz) {
      var fin = K.surface(Object.assign({}, T.fin, { y: 0, dih: 0 }), 1, { top: P.top, belly: P.top }, 0.02, true);
      fin.rotateX(-PI / 2); fin.translate(0, T.fin.y - (T.twin ? 0.1 : 0), fz); K.meshOf(b, fin);
    });
    // pylon (PBY: tall streamlined pylon with the flight engineer's windows; H6K: a lower cabane)
    var pw = T.pylon, wy = T.wing.y, hs = hwAt(pw[0]);
    M._box(b, P.top, pw[1], wy - hs[3] - hs[2] + 0.12, J ? 0.12 : 0.17, pw[0], hs[3] + hs[2] - 0.1, 0);
    if (!J) [-1, 1].forEach(function (k) { M._bar(b, P.glass, 0.12, 0.08, 0.01, pw[0] + 0.1, (wy + hs[3] + hs[2]) / 2, k * 0.088); });
    // wing (both halves), the struts from the hull sides, the marks
    [-1, 1].forEach(function (k) { K.meshOf(b, K.surface(Object.assign({}, T.wing, { y: 0 }), k, P, 0.02, false), 0, wy, k * T.wing.z0); });
    T.struts.forEach(function (s) {
      [-1, 1].forEach(function (k) {
        var hz = hwAt(s[0]);
        strut(b, P.strut, 0.045, [s[0], hz[3] - hz[2] * 0.1, k * hz[1] * 0.85], [s[0] - 0.05, wy - 0.05, k * s[1]]);
      });
    });
    var wc = K.chordAt(T.wing, T.marks / T.wing.semi), wt = wc.t;
    [-1, 1].forEach(function (k) {
      K.mark(b, { top: P.top }, nat, 0.3, T.wing.qc - 0.1, wy + wt * 0.4 + 0.01, k * T.marks, false, 0);
      K.mark(b, { top: P.top }, nat, 0.3, T.wing.qc - 0.1, wy - wt * 0.26 - 0.01, k * T.marks, true, 0);
      var mx = J ? -1.15 : -1.2, ms = hwAt(mx);
      K.mark(b, { top: P.top }, nat, 0.17, mx, ms[3] + 0.04, k * (ms[1] + 0.012), false, k * PI / 2, 0);
    });
    // engines: nacelles on the wing leading edge, cowl lip, exhaust stubs
    var le = T.wing.qc + 0.25 * T.wing.root, R = T.nac, fx = { exh: [], canopy: new THREE.Vector3((c0 + c1) / 2, cs[3] + cs[2] + 0.1, 0) }, props = [];
    T.engines.forEach(function (ez) {
      [-1, 1].forEach(function (k) {
        var ny = wy - 0.02, n = [[le - 0.95, 0.02, 0.03, ny + 0.02], [le - 0.6, R * 0.7, R * 0.75, ny + 0.02], [le - 0.1, R, R, ny], [le + 0.35, R * 1.02, R * 1.02, ny - 0.02], [le + 0.46, R * 0.88, R * 0.88, ny - 0.02]];
        K.meshOf(b, K.tube(K.bodyRings(K.smooth(n, 3), 14, 2.1, function (s) { return s[0] > le + 0.32 ? P.lip : P.top; }), true, P.lip), 0, 0, k * ez);
        M._sph(b, P.lip, 0.16, R * 0.9, R * 0.9, le + 0.48, ny - 0.02, k * ez);   // spinner hub
        props.push([le + 0.52, ny - 0.02, k * ez]);
        if (fx.exh.length < 2 && (ez === T.engines[0])) fx.exh.push(new THREE.Vector3(le + 0.1, ny - R * 0.8, k * ez));
      });
    });
    var tpl = { name: T.name, body: K.bake(b), props: props, R: T.prop, blades: blades(P, T.prop), fx: fx, floats: [] };
    var dg = new THREE.CircleGeometry(T.prop, 24); dg.rotateY(PI / 2); tpl.disc = dg; tpl.discMat = K.discMat(nat, P.tip);
    // wingtip floats: a strut down from the wing and the float. PBY: a pivot that swings it out to the tip (fold)
    var fl = new THREE.Group(), L = T.floatLen;
    M._bar(fl, P.strut, 0.05, 0.62, 0.05, 0.02, -0.66, 0);
    M._bar(fl, P.strut, 0.04, 0.6, 0.04, -0.14, -0.64, 0).rotation.z = -0.25;
    M._sph(fl, P.top, L, 0.16, 0.17, 0.0, -0.72, 0);
    M._sph(fl, P.belly, L * 0.96, 0.1, 0.15, 0.0, -0.77, 0);
    tpl.floatGeo = K.bake(fl);
    [-1, 1].forEach(function (k) { tpl.floats.push([T.wing.qc - 0.02, wy - 0.02, k * T.floatZ]); });
    tpl.fixedFloats = !!T.fixedFloats;
    var tc = K.chordAt(T.wing, 0.97);
    fx.tipL = new THREE.Vector3(T.wing.qc - 0.25 * tc.c, wy, -0.97 * T.wing.semi); fx.tipR = new THREE.Vector3(fx.tipL.x, wy, -fx.tipL.z);
    return (TPL[nat] = tpl);
  }

  // floats.set(a): 0 = up (PBY: swung out, the float is the wing tip), 1 = down (on the water). H6K: fixed down.
  function setFloats(a) {
    this.down = a;
    for (var i = 0; i < this.parts.length; i++) { var p = this.parts[i]; p.rotation.x = this.fixed ? 0 : -p.userData.k * (PI / 2) * (1 - a); }
  }
  // buildFlyingBoat(nation) -> { group, props: [Group], blades: [Mesh], discs: [Mesh], floats: { down, set(a) }, fx, name, payload: null }
  //   props spin about local x; the group is scaled by the caller (air_flyingboats.js SCALE).
  function buildFlyingBoat(nationId) {
    var nat = WW.models._nation(nationId).id, t = template(nat), mat = WW.models._mat(0xffffff);
    var g = new THREE.Group(); g.add(new THREE.Mesh(t.body, mat));
    var props = [], bl = [], ds = [];
    t.props.forEach(function (pp) {
      var pr = new THREE.Group(); pr.position.fromArray(pp); g.add(pr);
      var b = new THREE.Mesh(t.blades, mat); pr.add(b); pr.rotation.x = pp[2] * 1.7;   // props out of phase
      var d = new THREE.Mesh(t.disc, t.discMat); d.visible = false; d.renderOrder = 5; pr.add(d);
      props.push(pr); bl.push(b); ds.push(d);
    });
    var floats = { down: 1, parts: [], fixed: t.fixedFloats, set: setFloats };
    t.floats.forEach(function (fp) {
      var f = new THREE.Group(); f.position.fromArray(fp); f.userData.k = fp[2] < 0 ? -1 : 1; f.add(new THREE.Mesh(t.floatGeo, mat)); g.add(f);
      floats.parts.push(f);
    });
    floats.set(1);
    if (WW.models._shadows) WW.models._shadows(g, false);
    ds.forEach(function (d) { d.castShadow = false; });
    return { group: g, props: props, blades: bl, discs: ds, floats: floats, fx: t.fx, name: t.name, payload: null, prop: null };
  }
  if (WW.models && WW.models._planeKit) WW.models.buildFlyingBoat = buildFlyingBoat;
  else console.error('models_flyingboats.js must load after models_planes.js');
})();
