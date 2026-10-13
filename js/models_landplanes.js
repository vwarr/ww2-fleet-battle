// models_landplanes.js - the island bases' multi-engine planes in the chubby toon style of models_planes.js (its
// lofting kit, WW.models._planeKit): B-17E Flying Fortress (four engines, level bomber), B-26 Marauder (two engines,
// torpedo) and G4M "Betty" (two engines; 'g4m' carries a torpedo, 'g4mL' bombs). Load after models_planes.js.
// WW.models.buildPlane(kind) builds them for these keys and the carrier types otherwise; the result has the same
// shape ({ group, prop, payload, wingL, wingR, brakes, blades, disc, fx, name }). The engines are baked into the wing
// halves (a shot-off wing takes its engines); the extra propellers copy the first one's spin and blur state each
// frame (onBeforeRender on the body: visual only). Geometry is built once per type and shared by every pooled plane.
// Each type keeps its 1942 silhouette: the B-17E's long dorsal fillet, big tailplane, stinger, Plexiglas nose, top and
// ball turrets and low-slung cowlings; the Marauder's round tube body, short wing and long nacelles; the Betty's fat
// cigar body, glazed nose and tail cone (the 20 mm), blisters, big Kasei radials and rounded fin. Spans keep the real
// ratios (31.6 : 19.8 : 25 m), the B-17 half span ~3.45 (air_render.js culls on it).
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI;
  var OD = { top: 0x737656, belly: 0xb4b6ae, nac: 0x6a6c4e, cowl: 0x5c5e45, glass: 0x7fa8c4, sky: 0x9cc0d8, frame: 0x55583f, blade: 0x3a3d42, tip: 0xe8c450, gun: 0x2a2c30, hole: 0x23261f };
  var IJ = { top: 0x5f6c49, belly: 0xc9c6b2, nac: 0x56623f, cowl: 0x2f343b, glass: 0x7fa8c4, sky: 0x9cc0d8, frame: 0x424a38, blade: 0x6e6252, tip: 0xc85448, gun: 0x2a2c30, hole: 0x23261f };
  // body: [x, half width, half height, centre y] tail -> nose; wing / tail / fin as models_planes.js.
  // glassN / glassT: the body is glazed forward of / aft of these x; frames: frame bands on the glazing (x);
  // cab: stepped cockpit { x0, x1, w, h, frames }; turret: dorsal [x, radius] (blister: [x, rx, ry, rz]);
  // ball: ventral ball turret [x, radius]; sides: side blisters [x, rx, ry, rz]; waist: waist windows [x, length];
  // fillet: the dorsal fin fillet, [x, rise above the spine] fwd -> aft; tailGuns: [barrel length, twin];
  // eng: span positions of the engines (from the wing pivot), engR: nacelle radius, nac: [reach ahead of the leading
  // edge, aft end as a fraction of the chord behind the LE, drop below the wing], prop: blade radius
  var TYPES = {
    b17: { name: 'B-17 Flying Fortress', P: OD, nat: 'USN',
      body: [[-2.58, 0.1, 0.12, 0.17], [-2.45, 0.13, 0.15, 0.16], [-2.1, 0.18, 0.22, 0.13], [-1.3, 0.27, 0.33, 0.06], [-0.3, 0.33, 0.39, 0.02], [0.8, 0.34, 0.39, 0], [1.55, 0.31, 0.34, -0.02], [2.05, 0.24, 0.25, -0.06], [2.32, 0.16, 0.16, -0.07], [2.43, 0.05, 0.05, -0.07]],
      glassN: 2.1, frames: [2.2], glassT: -2.42, cab: { x0: 1.22, x1: 1.82, w: 0.21, h: 0.17, frames: 2 },
      turret: [1.0, 0.16], ball: [-0.6, 0.15], waist: [-1.0, 0.26], tailGuns: [0.22, true],
      fillet: [[-0.75, 0], [-1.2, 0.04], [-1.55, 0.12], [-1.8, 0.24], [-1.98, 0.4], [-2.1, 0.5]],
      wing: { qc: 0.5, y: -0.06, root: 1.3, tip: 0.45, semi: 3.15, z0: 0.3, dih: 0.07, sweep: 0.12, tip_: 'round', t: 0.16 },
      tail: { qc: -2.05, y: 0.12, root: 0.85, tip: 0.36, semi: 1.35, sweep: 0.2, tip_: 'round', t: 0.12 },
      fin: { qc: -1.8, y: 0.2, root: 1.2, tip: 0.45, semi: 1.15, sweep: 0.38, tip_: 'round', t: 0.12 },
      eng: [0.68, 1.58], engR: 0.16, nac: [0.36, 0.8, -0.07], prop: 0.42, markX: -1.62 },
    b26: { name: 'B-26 Marauder', P: OD, nat: 'USN',
      body: [[-1.98, 0.07, 0.08, 0.1], [-1.8, 0.13, 0.14, 0.09], [-1.3, 0.24, 0.26, 0.05], [-0.6, 0.3, 0.31, 0.01], [0.4, 0.31, 0.32, 0], [1.2, 0.3, 0.31, 0], [1.6, 0.25, 0.26, -0.01], [1.85, 0.15, 0.16, -0.02], [1.97, 0.04, 0.04, -0.02]],
      glassN: 1.62, frames: [1.75], glassT: -1.84, cab: { x0: 0.86, x1: 1.34, w: 0.17, h: 0.14, frames: 2 },
      turret: [-0.62, 0.16], tailGuns: [0.18, false],
      wing: { qc: 0.3, y: 0.04, root: 0.95, tip: 0.45, semi: 1.88, z0: 0.28, dih: 0.05, sweep: 0.06, tip_: 'round', t: 0.17 },
      tail: { qc: -1.6, y: 0.12, root: 0.55, tip: 0.28, semi: 0.9, dih: 0.12, tip_: 'round', t: 0.12 },
      fin: { qc: -1.48, y: 0.2, root: 0.78, tip: 0.4, semi: 1.12, sweep: 0.25, tip_: 'round', t: 0.12 },
      eng: [0.67], engR: 0.22, nac: [0.32, 1.35, -0.05], prop: 0.46, torpedo: true, markX: -1.05 },
    g4m: { name: 'G4M Betty', P: IJ, nat: 'IJN',
      body: [[-2.3, 0.05, 0.05, 0.12], [-2.15, 0.11, 0.12, 0.11], [-1.9, 0.18, 0.2, 0.1], [-1.4, 0.28, 0.31, 0.07], [-0.7, 0.36, 0.4, 0.04], [0.2, 0.41, 0.44, 0.02], [0.8, 0.41, 0.44, 0.01], [1.35, 0.35, 0.37, -0.02], [1.75, 0.26, 0.27, -0.04], [2.02, 0.15, 0.16, -0.05], [2.12, 0.04, 0.04, -0.05]],
      glassN: 1.62, frames: [1.8, 1.97], glassT: -1.92, cab: { x0: 0.98, x1: 1.56, w: 0.23, h: 0.15, frames: 3 },
      blister: [-0.42, 0.3, 0.13, 0.19], sides: [-1.12, 0.2, 0.13, 0.08], tailGuns: [0.24, false],
      wing: { qc: 0.3, y: 0.0, root: 1.1, tip: 0.42, semi: 2.43, z0: 0.3, dih: 0.07, sweep: 0.06, tip_: 'round', t: 0.16 },
      tail: { qc: -1.58, y: 0.13, root: 0.6, tip: 0.3, semi: 0.95, tip_: 'round', t: 0.12 },
      fin: { qc: -1.45, y: 0.16, root: 0.82, tip: 0.56, semi: 0.86, sweep: 0.2, tip_: 'round', t: 0.12 },
      eng: [0.72], engR: 0.24, nac: [0.3, 0.95, -0.02], prop: 0.5, torpedo: true, markX: -0.7 }
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
  // the smoothed body station at x (linear between samples)
  function stAt(st, x) {
    if (x <= st[0][0]) return st[0];
    for (var i = 1; i < st.length; i++) if (st[i][0] >= x) {
      var a = st[i - 1], b = st[i], t = (x - a[0]) / (b[0] - a[0] || 1);
      return [x, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
    return st[st.length - 1];
  }
  // a hard paint line at x: two stations 2e-4 apart, so the vertex colours don't smear over a whole segment
  function cut(st, x) {
    if (x == null) return st;
    for (var i = 1; i < st.length; i++) if (st[i][0] > x) { st.splice(i, 0, stAt(st, x - 1e-4), stAt(st, x + 1e-4)); break; }
    return st;
  }
  // a low-poly ellipsoid pod (turrets, blisters): N-sided rings, cheaper than the kit's sphere
  function pod(b, x, y, z, rx, ry, rz, colf) {
    var st = [-1, -0.8, -0.45, 0, 0.45, 0.8, 1].map(function (u) { var r = Math.sqrt(1 - u * u) + 0.02; return [x + u * rx, rz * r, ry * r, y]; });
    K.meshOf(b, K.tube(K.bodyRings(st, 10, 2, colf), true, true), 0, 0, z);
  }
  function glassOf(P) { return function (s, sn) { return sn > 0.75 ? P.sky : P.glass; }; }

  function template(key) {
    if (TPL[key]) return TPL[key];
    K.use();
    var T = TYPES[key], P = T.P, nat = T.nat, b = new THREE.Group(), gun = P.gun;
    var st0 = K.smooth(T.body, 3), st = cut(cut(st0.map(function (s) { return s.slice(); }), T.glassT), T.glassN);
    var topY = function (x) { var s = stAt(st0, x); return s[3] + s[2]; };
    var paint = { top: P.top, belly: P.belly, bars: false }, tone = K.twoTone(P.top, P.belly);
    // body: two-tone, glazed nose (and tail), sky stripe on the glass
    K.meshOf(b, K.tube(K.bodyRings(st, 16, 2.2, function (s, sn, c) {
      if (s[0] > T.glassN || (T.glassT != null && s[0] < T.glassT)) return sn > 0.8 ? P.sky : P.glass;
      return tone(s, sn, c);
    }), true, true));
    (T.frames || []).forEach(function (x) { // frame bands on the nose glazing
      var s = stAt(st0, x);
      K.meshOf(b, K.tube(K.bodyRings([[x - 0.012, s[1] * 1.03 + 0.004, s[2] * 1.03 + 0.004, s[3]], [x + 0.012, s[1] * 1.03 + 0.004, s[2] * 1.03 + 0.004, s[3]]], 12, 2.2, function () { return P.frame; }), false, false));
    });
    // stepped cockpit: a lofted greenhouse on the spine, body-coloured frames (the carrier canopy's recipe)
    var cp = T.cab, cy = topY((cp.x0 + cp.x1) / 2) - cp.h * 0.45, cst = [];
    for (var i = 0; i <= 16; i++) {
      var u = i / 16, f = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), 3.2)), 0.35), fx = cp.x0 + (cp.x1 - cp.x0) * u;
      cst.push([fx, cp.w * f + 0.004, cp.h * f + 0.004, Math.max(cy, topY(fx) - cp.h * 0.55)]);
    }
    K.meshOf(b, K.tube(K.bodyRings(cst, 10, 2.2, function (s, sn, c, i) {
      var fu = i / 16 * (cp.frames + 1);
      if (Math.abs(fu - Math.round(fu)) * 16 / (cp.frames + 1) < 0.5) return P.top;
      return sn > 0.9 ? P.sky : sn < 0.15 ? P.top : P.glass;
    }), false, false));
    var gl = glassOf(P);
    if (T.turret) { // dorsal power turret: glass dome, twin .50s
      var tx = T.turret[0], tr = T.turret[1], ty = topY(tx);
      pod(b, tx, ty - tr * 0.25, 0, tr, tr * 0.85, tr, gl);
      [-1, 1].forEach(function (k) { M._bar(b, gun, 0.42, 0.024, 0.024, tx + 0.2, ty + tr * 0.25, k * 0.05); });
    }
    if (T.blister) { var bx = T.blister, bt = topY(bx[0]); pod(b, bx[0], bt - bx[2] * 0.3, 0, bx[1], bx[2], bx[3], gl); M._bar(b, gun, 0.3, 0.022, 0.022, bx[0] - 0.3, bt + 0.04, 0); }
    if (T.ball) { // ventral ball turret under the waist
      var bs = stAt(st0, T.ball[0]), br = T.ball[1], by0 = bs[3] - bs[2] + br * 0.15;
      pod(b, T.ball[0], by0, 0, br, br, br, function (s, sn) { return sn < -0.3 ? P.glass : P.frame; });
      [-1, 1].forEach(function (k) { M._bar(b, gun, 0.36, 0.024, 0.024, T.ball[0] + 0.16, by0 - br * 0.4, k * 0.045); });
    }
    if (T.sides) [-1, 1].forEach(function (k) { // Betty's side blisters
      var sd = T.sides, ss = stAt(st0, sd[0]);
      pod(b, sd[0], ss[3] + ss[2] * 0.15, k * (ss[1] - sd[3] * 0.25), sd[1], sd[2], sd[3], gl);
    });
    if (T.waist) [-1, 1].forEach(function (k) { // B-17 waist windows (open hatches) and their guns
      var wx = T.waist[0], ws = stAt(st0, wx);
      M._bar(b, P.hole, T.waist[1], 0.13, 0.04, wx, ws[3] + ws[2] * 0.05, k * (ws[1] - 0.012));
      M._bar(b, gun, 0.026, 0.026, 0.14, wx, ws[3] + ws[2] * 0.2, k * (ws[1] + 0.05));
    });
    if (T.tailGuns) { // tail gun position: the glazed end and its guns poking aft
      var te = T.body[0], tl = T.tailGuns[0];
      (T.tailGuns[1] ? [-0.04, 0.04] : [0]).forEach(function (z) { M._bar(b, gun, tl, 0.026, 0.026, te[0] - tl / 2 + 0.03, te[3] - 0.013, z); });
    }
    if (T.fillet) { // B-17E: the dorsal fin's long curved fillet running forward along the spine
      var fs = T.fillet.map(function (f, i) {
        var t0 = topY(f[0]), lo = t0 - 0.05, hi = t0 + f[1], hw = 0.012 + 0.045 * i / (T.fillet.length - 1);
        return [f[0], hw, Math.max(0.01, (hi - lo) / 2), (hi + lo) / 2];
      }).reverse();
      K.meshOf(b, K.tube(K.bodyRings(K.smooth(fs, 3), 8, 2.2, function () { return P.top; }), true, true));
    }
    K.meshOf(b, K.surface(T.tail, 1, paint, 0.05, true)); K.meshOf(b, K.surface(T.tail, -1, paint, 0.05, true));
    var fin = K.surface(Object.assign({}, T.fin, { y: 0, dih: 0 }), 1, { top: P.top, belly: P.top }, 0.05, true);
    fin.rotateX(-PI / 2); fin.translate(0, T.fin.y, 0); K.meshOf(b, fin);
    [-1, 1].forEach(function (k) { // fuselage markings
      var ms = stAt(st0, T.markX);
      K.mark(b, paint, nat, 0.17, T.markX, ms[3] + 0.02, k * (ms[1] + 0.014), false, k * PI / 2, 0);
    });
    var tpl = { name: T.name, body: K.bake(b), wings: [], props: [], fx: {} };
    var wo = T.wing, wp = Object.assign({}, wo, { y: 0 });
    var at = function (z) { var s = z / wo.semi, ca = K.chordAt(wp, s); return { le: wo.qc - (wo.sweep || 0) * z + 0.25 * ca.c, y: z * (wo.dih || 0), c: ca.c }; };
    [-1, 1].forEach(function (k) {
      var w = new THREE.Group();
      K.meshOf(w, K.surface(wp, k, paint, wo.z0 * 0.9));
      T.eng.forEach(function (z) { // nacelle: a lofted pod under the wing, dark cowl ring at the front
        var a = at(z), R = T.engR, N = T.nac, x0 = a.le - a.c * N[1], x1 = a.le + N[0], dy = a.y + N[2];
        var ns = [[x0, 0.02, 0.02, R * 0.3], [x0 + (x1 - x0) * 0.3, R * 0.78, R * 0.82, R * 0.08], [a.le - 0.1, R, R, 0], [x1 - 0.09, R * 1.02, R * 1.02, 0], [x1, R * 0.88, R * 0.88, 0]];
        K.meshOf(w, K.tube(K.bodyRings(K.smooth(ns, 2), 12, 2.1, function (s) { return s[0] > x1 - 0.13 ? P.cowl : P.nac; }), true, P.cowl), 0, dy, k * z);
        tpl.props.push({ k: k, pos: [x1 + 0.06, dy, k * z] });
      });
      var mz = wo.semi * 0.72, ma = at(mz);
      K.mark(w, paint, nat, Math.min(0.26, ma.c * 0.32), ma.le - ma.c * 0.45, ma.y + 0.04, k * mz, false, -k * Math.atan(wo.dih || 0));
      K.mark(w, paint, nat, Math.min(0.26, ma.c * 0.32), ma.le - ma.c * 0.45, ma.y - 0.03, k * mz, true, -k * Math.atan(wo.dih || 0));
      tpl.wings.push({ geo: K.bake(w), pos: [0, wo.y, k * wo.z0] });
      var tz = wo.semi * 0.97, ta = at(tz);
      tpl.fx[k < 0 ? 'tipL' : 'tipR'] = new THREE.Vector3(ta.le - ta.c * 0.5, ta.y + wo.y, k * (tz + wo.z0));
    });
    // payload hangs at the keel (the Betty's half-recessed bay)
    var pl = new THREE.Group(), ks = stAt(st0, 0.1), by = ks[3] - ks[2] - 0.02;
    if (T.torpedo) {
      K.meshOf(pl, K.tube(K.bodyRings(K.smooth([[-0.75, 0.02, 0.02, 0], [-0.6, 0.09, 0.09, 0], [0.5, 0.1, 0.1, 0], [0.7, 0.07, 0.07, 0], [0.77, 0.01, 0.01, 0]], 3), 10, 2, function () { return nat === 'IJN' ? 0x7a7e80 : 0x8a9098; }), true, true));
      M._bar(pl, 0x4a4e54, 0.13, 0.012, 0.24, -0.68, -0.006, 0); M._bar(pl, 0x4a4e54, 0.13, 0.24, 0.012, -0.68, -0.12, 0);
      tpl.payload = { geo: K.bake(pl), pos: [0.1, by, 0] };
    } else if (T.bombs) {
      [-0.12, 0.12].forEach(function (z) { K.meshOf(pl, K.tube(K.bodyRings(K.smooth([[-0.3, 0.03, 0.03, 0], [-0.15, 0.08, 0.08, 0], [0.12, 0.09, 0.09, 0], [0.26, 0.05, 0.05, 0], [0.3, 0.01, 0.01, 0]], 3), 10, 2, function () { return 0x585e66; }), true, true), 0, 0, z); });
      tpl.payload = { geo: K.bake(pl), pos: [0.2, by + 0.02, 0] };
    }
    tpl.pg = blades(T.prop, P); tpl.discMat = K.discMat(nat, P.tip);
    var ex = T.wing.qc + 0.2;
    tpl.fx.exh = [new THREE.Vector3(ex, wo.y, -(wo.z0 + T.eng[0]) - 0.15), new THREE.Vector3(ex, wo.y, wo.z0 + T.eng[0] + 0.15)];
    tpl.fx.canopy = new THREE.Vector3((cp.x0 + cp.x1) / 2, cy + cp.h * 0.9, 0);
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
