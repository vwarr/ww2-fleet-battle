// models_landplanes.js - the island bases' multi-engine planes in the chubby toon style of models_planes.js (its
// lofting kit, WW.models._planeKit): B-17 Flying Fortress (four engines, level bomber), B-26 Marauder (two engines,
// torpedo) and G4M "Betty" (two engines; 'g4m' carries a torpedo, 'g4mL' bombs). Load after models_planes.js.
// WW.models.buildPlane(kind) builds them for these keys and the carrier types otherwise; the result has the same
// shape ({ group, prop, payload, wingL, wingR, brakes, blades, disc, fx, name }). The engines are baked into the wing
// halves (a shot-off wing takes its engines); the extra propellers copy the first one's spin and blur state each
// frame (onBeforeRender on the body: visual only). Geometry is built once per type and shared by every pooled plane.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI;
  var OD = { top: 0x737656, belly: 0xb4b6ae, nac: 0x6a6c4e, cowl: 0x5c5e45, glass: 0x7fa8c4, frame: 0x55583f, blade: 0x3a3d42, tip: 0xe8c450 };
  var IJ = { top: 0x5f6c49, belly: 0xc9c6b2, nac: 0x56623f, cowl: 0x2f343b, glass: 0x7fa8c4, frame: 0x424a38, blade: 0x6e6252, tip: 0xc85448 };
  // body: [x, half width, half height, centre y] tail -> nose; wing / tail / fin as models_planes.js; eng: span
  // positions of the engines (from the wing pivot), engR: nacelle radius, prop: blade radius
  var TYPES = {
    b17: { name: 'B-17 Flying Fortress', P: OD, nat: 'USN',
      body: [[-2.45, 0.04, 0.06, 0.16], [-2.05, 0.15, 0.2, 0.11], [-1.2, 0.27, 0.33, 0.05], [-0.2, 0.33, 0.39, 0.02], [0.8, 0.34, 0.39, 0], [1.6, 0.31, 0.34, -0.02], [2.15, 0.24, 0.26, -0.04], [2.35, 0.14, 0.16, -0.04]],
      nose: 0.17, cockpit: [1.55, 0.36, 0.5, 0.2], turret: [0.6, 0.38],
      wing: { qc: 0.55, y: -0.06, root: 1.25, tip: 0.46, semi: 3.15, z0: 0.3, dih: 0.07, sweep: 0.12, tip_: 'round', t: 0.16 },
      tail: { qc: -2.05, y: 0.1, root: 0.66, tip: 0.3, semi: 1.05, tip_: 'round', t: 0.12 },
      fin: { qc: -2.0, y: 0.25, root: 1.3, tip: 0.42, semi: 1.05, sweep: 0.55, tip_: 'round', t: 0.12 },
      eng: [0.95, 1.9], engR: 0.16, prop: 0.42, markX: -1.35 },
    b26: { name: 'B-26 Marauder', P: OD, nat: 'USN',
      body: [[-1.95, 0.04, 0.05, 0.14], [-1.55, 0.14, 0.17, 0.1], [-0.8, 0.26, 0.3, 0.04], [0.2, 0.31, 0.34, 0], [1.0, 0.3, 0.32, 0], [1.5, 0.23, 0.25, -0.02], [1.78, 0.12, 0.13, -0.03]],
      nose: 0.11, cockpit: [1.05, 0.3, 0.42, 0.18], turret: [-0.4, 0.33],
      wing: { qc: 0.35, y: 0.08, root: 1.0, tip: 0.5, semi: 2.05, z0: 0.28, dih: 0.04, sweep: 0.06, tip_: 'round', t: 0.15 },
      tail: { qc: -1.62, y: 0.12, root: 0.52, tip: 0.26, semi: 0.85, dih: 0.12, tip_: 'round', t: 0.12 },
      fin: { qc: -1.6, y: 0.22, root: 0.75, tip: 0.36, semi: 0.95, sweep: 0.3, tip_: 'round', t: 0.12 },
      eng: [0.75], engR: 0.19, prop: 0.5, torpedo: true, markX: -1.0 },
    g4m: { name: 'G4M Betty', P: IJ, nat: 'IJN',
      body: [[-2.05, 0.05, 0.06, 0.1], [-1.75, 0.15, 0.17, 0.07], [-1.0, 0.31, 0.33, 0.03], [0, 0.37, 0.39, 0], [0.9, 0.36, 0.37, 0], [1.5, 0.29, 0.3, -0.02], [1.85, 0.17, 0.18, -0.03], [1.97, 0.07, 0.08, -0.03]],
      nose: 0.1, tailGlass: 0.08, cockpit: [1.1, 0.34, 0.55, 0.2], turret: [-0.3, 0.38],
      wing: { qc: 0.45, y: -0.06, root: 1.1, tip: 0.44, semi: 2.45, z0: 0.3, dih: 0.07, sweep: 0.08, tip_: 'round', t: 0.16 },
      tail: { qc: -1.7, y: 0.1, root: 0.55, tip: 0.26, semi: 0.95, tip_: 'round', t: 0.12 },
      fin: { qc: -1.72, y: 0.18, root: 0.7, tip: 0.3, semi: 0.8, sweep: 0.25, tip_: 'round', t: 0.12 },
      eng: [0.78], engR: 0.21, prop: 0.5, torpedo: true, markX: -1.15 }
  };
  TYPES.g4mL = Object.assign({}, TYPES.g4m, { torpedo: false, bombs: true });

  var K, M, TPL = {}, propGeo = {};
  function blades(R, P) { // 3 blades with painted tips, baked (shared per radius / paint)
    var key = R + '|' + P.tip;
    if (propGeo[key]) return propGeo[key];
    var pr = new THREE.Group();
    for (var bl = 0; bl < 3; bl++) {
      var arm = new THREE.Group(); arm.rotation.x = bl * 2 * PI / 3; pr.add(arm);
      M._bar(arm, P.blade, 0.04, R - 0.12, 0.12, 0, 0.05, 0).rotation.x = 0.25;
      M._bar(arm, P.tip, 0.042, 0.09, 0.11, 0, R - 0.1, 0).rotation.x = 0.25;
    }
    var dg = new THREE.CircleGeometry(R, 24); dg.rotateY(PI / 2);
    return (propGeo[key] = { blades: K.bake(pr), disc: dg });
  }
  function template(key) {
    if (TPL[key]) return TPL[key];
    K.use();
    var T = TYPES[key], P = T.P, nat = T.nat, st = K.smooth(T.body, 3), nose = T.body[T.body.length - 1], b = new THREE.Group();
    var paint = { top: P.top, belly: P.belly, bars: false };
    K.meshOf(b, K.tube(K.bodyRings(st, 16, 2.2, K.twoTone(P.top, P.belly)), true, P.belly));
    M._sph(b, P.glass, T.nose * 2.4, T.nose * 2.2, T.nose * 2.2, nose[0] - 0.02, nose[3], 0);                   // glazed nose
    if (T.tailGlass) M._sph(b, P.glass, 0.2, 0.16, 0.16, T.body[0][0] + 0.05, T.body[0][3], 0);
    var cp = T.cockpit; M._sph(b, P.glass, cp[2], cp[3], cp[1] * 1.2, cp[0], cp[1] - 0.02, 0);                // cockpit glazing
    M._sph(b, P.frame, 0.03, cp[3] * 0.9, cp[1] * 1.22, cp[0] + 0.02, cp[1] - 0.02, 0);
    if (T.turret) M._sph(b, P.glass, 0.26, 0.2, 0.26, T.turret[0], T.turret[1], 0);                            // dorsal turret
    K.meshOf(b, K.surface(T.tail, 1, paint, 0.05, true)); K.meshOf(b, K.surface(T.tail, -1, paint, 0.05, true));
    var fin = K.surface(Object.assign({}, T.fin, { y: 0, dih: 0 }), 1, { top: P.top, belly: P.top }, 0.05, true);
    fin.rotateX(-PI / 2); fin.translate(0, T.fin.y, 0); K.meshOf(b, fin);
    [-1, 1].forEach(function (k) { // fuselage markings
      var mx = T.markX, ms = T.body.reduce(function (a, s) { return Math.abs(s[0] - mx) < Math.abs(a[0] - mx) ? s : a; });
      K.mark(b, paint, nat, 0.17, mx, ms[3] + 0.02, k * (ms[1] + 0.014), false, k * PI / 2, 0);
    });
    var tpl = { name: T.name, body: K.bake(b), wings: [], props: [], fx: {} };
    var wo = T.wing, wp = Object.assign({}, wo, { y: 0 });
    var at = function (z) { var s = z / wo.semi, ca = K.chordAt(wp, s); return { le: wo.qc - (wo.sweep || 0) * z + 0.25 * ca.c, y: z * (wo.dih || 0), c: ca.c }; };
    [-1, 1].forEach(function (k) {
      var w = new THREE.Group();
      K.meshOf(w, K.surface(wp, k, paint, wo.z0 * 0.9));
      T.eng.forEach(function (z) { // nacelle: a short lofted pod, dark cowl ring at the front
        var a = at(z), R = T.engR, x0 = a.le - a.c * 0.9, x1 = a.le + 0.28;
        var ns = [[x0, 0.02, 0.02, 0], [x0 + 0.25, R * 0.75, R * 0.8, -0.01], [a.le - 0.1, R, R, 0], [x1 - 0.08, R * 1.02, R * 1.02, 0], [x1, R * 0.9, R * 0.9, 0]];
        K.meshOf(w, K.tube(K.bodyRings(K.smooth(ns, 2), 12, 2.1, function (s) { return s[0] > x1 - 0.12 ? P.cowl : P.nac; }), true, P.cowl), 0, a.y - 0.03, k * z);
        tpl.props.push({ k: k, pos: [x1 + 0.06, a.y - 0.03, k * z] });
      });
      var mz = wo.semi * 0.72, ma = at(mz);
      K.mark(w, paint, nat, Math.min(0.26, ma.c * 0.32), ma.le - ma.c * 0.45, ma.y + 0.04, k * mz, false, -k * Math.atan(wo.dih || 0));
      K.mark(w, paint, nat, Math.min(0.26, ma.c * 0.32), ma.le - ma.c * 0.45, ma.y - 0.03, k * mz, true, -k * Math.atan(wo.dih || 0));
      tpl.wings.push({ geo: K.bake(w), pos: [0, wo.y, k * wo.z0] });
      var tz = wo.semi * 0.97, ta = at(tz);
      tpl.fx[k < 0 ? 'tipL' : 'tipR'] = new THREE.Vector3(ta.le - ta.c * 0.5, ta.y + wo.y, k * (tz + wo.z0));
    });
    var pl = new THREE.Group(), by = Math.min(wo.y, 0) - 0.3;
    if (T.torpedo) {
      K.meshOf(pl, K.tube(K.bodyRings(K.smooth([[-0.75, 0.02, 0.02, 0], [-0.6, 0.09, 0.09, 0], [0.5, 0.1, 0.1, 0], [0.7, 0.07, 0.07, 0], [0.77, 0.01, 0.01, 0]], 3), 10, 2, function () { return nat === 'IJN' ? 0x7a7e80 : 0x8a9098; }), true, true));
      M._bar(pl, 0x4a4e54, 0.13, 0.012, 0.24, -0.68, -0.006, 0); M._bar(pl, 0x4a4e54, 0.13, 0.24, 0.012, -0.68, -0.12, 0);
      tpl.payload = { geo: K.bake(pl), pos: [0.1, by, 0] };
    } else if (T.bombs) {
      [-0.12, 0.12].forEach(function (z) { K.meshOf(pl, K.tube(K.bodyRings(K.smooth([[-0.3, 0.03, 0.03, 0], [-0.15, 0.08, 0.08, 0], [0.12, 0.09, 0.09, 0], [0.26, 0.05, 0.05, 0], [0.3, 0.01, 0.01, 0]], 3), 10, 2, function () { return 0x585e66; }), true, true), 0, 0, z); });
      tpl.payload = { geo: K.bake(pl), pos: [0.2, by + 0.05, 0] };
    }
    tpl.pg = blades(T.prop, P); tpl.discMat = K.discMat(nat, P.tip);
    var ex = T.wing.qc + 0.2;
    tpl.fx.exh = [new THREE.Vector3(ex, wo.y, -(wo.z0 + T.eng[0]) - 0.15), new THREE.Vector3(ex, wo.y, wo.z0 + T.eng[0] + 0.15)];
    tpl.fx.canopy = new THREE.Vector3(cp[0], cp[1] + cp[3] * 0.4, 0);
    return (TPL[key] = tpl);
  }

  function sync() { // body.onBeforeRender: the extra propellers follow the first one
    var u = this.userData, p0 = u.props[0];
    for (var i = 1; i < u.props.length; i++) {
      var q = u.props[i]; q.g.rotation.x = p0.g.rotation.x + i * 0.9;
      q.blades.visible = p0.blades.visible; q.disc.visible = p0.disc.visible;
    }
  }
  function build(key, nationId) {
    M = WW.models; K = M._planeKit;
    var t = template(key), mat = M._mat(0xffffff), g = new THREE.Group(), body = new THREE.Mesh(t.body, mat); g.add(body);
    var wings = t.wings.map(function (w) {
      var wg = new THREE.Group(); wg.position.fromArray(w.pos); wg.add(new THREE.Mesh(w.geo, mat)); g.add(wg);
      wg.userData.home = w.pos.slice(); return wg;
    });
    var props = t.props.map(function (pp) {
      var pg = new THREE.Group(), w = wings[pp.k < 0 ? 0 : 1];
      pg.position.fromArray(pp.pos); w.add(pg);
      var bl = new THREE.Mesh(t.pg.blades, mat), dc = new THREE.Mesh(t.pg.disc, t.discMat);
      dc.visible = false; dc.renderOrder = 5; pg.add(bl); pg.add(dc);
      return { g: pg, blades: bl, disc: dc };
    });
    body.userData.props = props; body.onBeforeRender = sync;
    var payload = null;
    if (t.payload) { payload = new THREE.Mesh(t.payload.geo, mat); payload.position.fromArray(t.payload.pos); g.add(payload); }
    if (M._shadows) M._shadows(g, false);
    props.forEach(function (q) { q.disc.castShadow = false; });
    var p0 = props[0];
    return { group: g, prop: p0.g, payload: payload, wingL: wings[0], wingR: wings[1], brakes: null,
      blades: p0.blades, disc: p0.disc, fx: t.fx, name: t.name, land: true };
  }

  if (WW.models && WW.models.buildPlane) {
    var b0 = WW.models.buildPlane;
    WW.models.buildPlane = function (kind, nationId) { return TYPES[kind] ? build(kind, nationId) : b0.apply(this, arguments); };
    WW.models.LAND_PLANES = TYPES;
  } else console.error('models_landplanes.js must load after models_planes.js');
})();
