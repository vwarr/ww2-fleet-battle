// models_base.js - WW.baseModels: the island airfield in the toy style (visual only; never built in sim-only mode).
// Runways (coral concrete with a dashed centreline, threshold bars), the taxi network of airfield_layout.js (parallel
// taxiways, end connectors with painted hold-short bars, columns, row lanes, a hardstand per spot), arched hangars, the
// control tower with the owner's flag, fuel tanks in earth berms, an ammunition dump, barracks, U-shaped revetments
// round every spot (sized to its plane class, one InstancedMesh), sandbagged AA pits (a twin gun on a turning mount)
// and coastal batteries (a long gun in a concrete ring, turning to its target). Each facility type is baked once into
// one geometry (vertex colours x the shared toon material, as models_planes.js) and shared by every map; only the
// field surface is per map. build(base) -> { group, parts: [{ f, mesh, gun }], strips, revets }.
// vehicle(kind) -> a geometry for the ground vehicles of base_ground_fx.js: fuel truck, bomb cart, crash truck, roller
// (nose +x, wheels on y = 0).
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, M = null, TPL = null;
  var C = { strip: 0xc6c0b2, strip2: 0xbab4a5, paint: 0xf6f2e8, apron: 0xd2c9b0, hangar: 0xb8bec4, hangarDk: 0x8a9298, door: 0x7c8590,
    tower: 0xece6d8, cab: 0x86aac4, roof: 0xd0705a, tank: 0xe8e4da, band: 0xc85a48, berm: 0xb9b083, sand: 0xc9b688, gun: 0x5a5f62,
    conc: 0xbdb7a8, barr: 0xeadfc6, pole: 0xd8d8d0, usn: 0x3d5a8a, ijn: 0xf4efe4, red: 0xd2564c,
    taxi: 0xaaa595, stand: 0xb6b09f, revet: 0x8f9a5e, revetTop: 0x9fac6a, hold: 0xe8c55a, crate: 0x7c7a4e, bomb: 0x4a4e48, olive: 0x6b7350, ijnV: 0x7c7f60, tyre: 0x2e2e2c,
    fire: 0xc8402f, steel: 0x8a9096 };

  var SIZE = { hangar: [0.52, 0.33, 0.52], tower: [0.22, 0.22, 0.22], fuel: [0.45, 0.42, 0.45], barracks: [0.55, 0.3, 0.3],
    pit: [0.2, 0.2, 0.2], aagun: [0.2, 0.2, 0.2], emp: [0.25, 0.25, 0.25], cgun: [0.25, 0.25, 0.25], ammo: [0.3, 0.3, 0.3], ramp: [0.5, 0.5, 0.5] };
  var _inv = new THREE.Matrix4(), _mw = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _v = new THREE.Vector3();
  function bake(root) { // a temp group -> one geometry, vertex colour = material colour x the geometry's own colours
    root.updateMatrixWorld(true); _inv.copy(root.matrixWorld).invert();
    var p = [], n = [], c = [];
    root.traverse(function (o) {
      if (!o.isMesh) return;
      var g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, mc = o.material.color;
      _mw.multiplyMatrices(_inv, o.matrixWorld); _nm.getNormalMatrix(_mw);
      var flip = _mw.determinant() < 0;
      for (var k = 0; k < pa.count; k++) {
        var vi = flip ? (k % 3 === 1 ? k + 1 : k % 3 === 2 ? k - 1 : k) : k;
        _v.fromBufferAttribute(pa, vi).applyMatrix4(_mw); p.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(na, vi).applyMatrix3(_nm).normalize(); n.push(_v.x, _v.y, _v.z);
        c.push(mc.r * (ca ? ca.getX(vi) : 1), mc.g * (ca ? ca.getY(vi) : 1), mc.b * (ca ? ca.getZ(vi) : 1));
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  var arch = null, archEnd = null;
  function archGeo() { // half cylinder along x, flat side down (a Quonset / arched hangar roof)
    if (!arch) {
      arch = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, 0, PI); arch.rotateZ(PI / 2); M._whiten(arch);
      archEnd = new THREE.CircleGeometry(0.5, 16, 0, PI); archEnd.rotateY(PI / 2); M._whiten(archEnd);
    }
    return arch;
  }
  function ring(p, col, r, w, h, x, z) { // a low berm / sandbag ring of small boxes
    var n = Math.max(8, Math.round(r * 5));
    for (var i = 0; i < n; i++) { var a = i / n * PI * 2, b = M._box(p, col, w, h, r * 2 * PI / n + 0.1, x + Math.cos(a) * r, 0, z + Math.sin(a) * r); b.rotation.y = -a; }
  }
  function templates() {
    if (TPL) return TPL;
    M = WW.models; TPL = {};
    var g;
    // arched hangar: a barrel roof 12 long (x), 9 wide, 4.6 high; the doors in the +x end (toward the runway)
    g = new THREE.Group();
    var a = new THREE.Mesh(archGeo(), M._mat(C.hangar)); a.scale.set(12, 9.2, 9); g.add(a);
    for (var i = -2; i <= 2; i++) { var rb = new THREE.Mesh(archGeo(), M._mat(C.hangarDk)); rb.scale.set(0.3, 9.4, 9.15); rb.position.x = i * 2.7; g.add(rb); } // ribs
    var e0 = new THREE.Mesh(archEnd, M._mat(C.hangar)); e0.scale.set(1, 9.2, 9); e0.position.x = -6; e0.rotation.y = PI; g.add(e0);
    var e1 = new THREE.Mesh(archEnd, M._mat(C.hangarDk)); e1.scale.set(1, 9.2, 9); e1.position.x = 6; g.add(e1);
    M._bar(g, C.door, 0.2, 3.3, 6.4, 6.05, 0, 0);
    M._bar(g, C.hangarDk, 0.25, 0.25, 6.8, 6.1, 3.3, 0);
    M._bar(g, C.door, 0.22, 3.2, 0.12, 6.1, 0, 0);
    TPL.hangar = bake(g);
    // control tower: a white block, a glazed cab, a red roof, a flagpole
    g = new THREE.Group();
    M._box(g, C.tower, 3, 4.2, 3, 0, 0, 0); M._box(g, C.tower, 4.4, 0.4, 4.4, 0, 4.1, 0);
    M._box(g, C.cab, 3.4, 1.5, 3.4, 0, 4.4, 0); M._box(g, C.roof, 4, 0.45, 4, 0, 5.9, 0);
    M._bar(g, C.pole, 0.12, 3.2, 0.12, 0, 6.3, 0); M._bar(g, C.pole, 0.4, 0.4, 0.4, 0, 9.4, 0);
    M._box(g, C.barr, 4.5, 1.6, 2.6, 3.4, 0, 0.6); M._box(g, C.roof, 4.7, 0.3, 2.8, 3.4, 1.6, 0.6);
    TPL.tower = bake(g);
    // fuel tank in an earth berm
    g = new THREE.Group();
    ring(g, C.berm, 3.2, 0.9, 0.9, 0, 0);
    M._cyl(g, C.tank, 2.1, 2.4, 0, 0, 0); M._cyl(g, C.band, 2.12, 0.35, 0, 1.4, 0); M._disc(g, C.strip, 2.15, 0.15, 0, 2.4, 0);
    TPL.fuel = bake(g);
    // barracks: a long cream hut with a red pitched roof
    g = new THREE.Group();
    M._box(g, C.barr, 7, 2.1, 3.4, 0, 0, 0);
    var rf = M._bar(g, C.roof, 7.4, 0.25, 2.2, 0, 2.25, -0.75); rf.rotation.x = 0.5;
    rf = M._bar(g, C.roof, 7.4, 0.25, 2.2, 0, 2.25, 0.75); rf.rotation.x = -0.5;
    for (var w = -2; w <= 2; w++) { M._bar(g, C.cab, 0.8, 0.6, 3.5, w * 1.4, 0.9, 0); }
    TPL.barracks = bake(g);
    // revetment: a U of earth berms, open on +z
    g = new THREE.Group();
    M._box(g, C.berm, 7, 1.1, 1.2, 0, 0, -3.2); M._box(g, C.berm, 1.2, 1.1, 5.6, -3.5, 0, -0.6); M._box(g, C.berm, 1.2, 1.1, 5.6, 3.5, 0, -0.6);
    TPL.revet = bake(g);
    // AA pit: sandbag ring; the gun (twin barrels on a mount) is separate so it can train
    g = new THREE.Group(); ring(g, C.sand, 2, 0.7, 0.8, 0, 0); M._disc(g, C.sand, 1.6, 0.1, 0, 0, 0); TPL.pit = bake(g);
    g = new THREE.Group(); M._cyl(g, C.gun, 0.55, 0.8, 0, 0, 0); M._box(g, C.gun, 1.2, 0.7, 1.1, 0, 0.6, 0);
    var b1 = M._xc(g, C.gun, 0.09, 2.2, 1.1, 1.15, -0.22), b2 = M._xc(g, C.gun, 0.09, 2.2, 1.1, 1.15, 0.22); b1.rotation.z = b2.rotation.z = 0.6;
    TPL.aagun = bake(g);
    // coastal battery: a concrete ring and a long gun behind a shield (separate, trains)
    g = new THREE.Group(); M._cyl(g, C.conc, 3, 0.9, 0, 0, 0); ring(g, C.sand, 3.3, 0.8, 0.7, 0, 0); TPL.emp = bake(g);
    g = new THREE.Group(); M._cyl(g, C.gun, 1, 0.5, 0, 0.9, 0); M._box(g, C.gun, 1.8, 1.3, 2, 0.1, 1.2, 0); M._xc(g, C.gun, 0.16, 4.2, 2.6, 1.85, 0);
    TPL.cgun = bake(g);
    // flags
    TPL.flag = {};
    g = new THREE.Group(); M._bar(g, 0xb8473f, 2.2, 1.3, 0.06, 1.1, 0, 0); for (var s = 0; s < 3; s++) M._bar(g, 0xf4efe4, 2.21, 0.18, 0.07, 1.1, 0.2 + s * 0.38, 0); M._bar(g, C.usn, 0.95, 0.7, 0.08, 0.48, 0.6, 0); TPL.flag.USN = bake(g);
    g = new THREE.Group(); M._bar(g, C.ijn, 2.2, 1.4, 0.06, 1.1, 0, 0); var d = M._cyl(g, C.red, 0.42, 0.08, 1.1, 0.7, 0); d.rotation.x = PI / 2; d.position.z = -0.04; TPL.flag.IJN = bake(g);
    // ammunition dump: an earth berm round stacked crates and a row of bombs
    g = new THREE.Group(); ring(g, C.berm, 3.4, 1, 1, 0, 0);
    for (var cx = -1; cx <= 1; cx++) for (var cz = -1; cz <= 0; cz++) M._box(g, C.crate, 1.1, 0.8 + (cx + cz + 2) % 2 * 0.5, 0.9, cx * 1.3, 0, cz * 1.1 - 0.2);
    for (var bi = -2; bi <= 2; bi++) M._xc(g, C.bomb, 0.28, 1.4, bi * 0.7, 0.3, 1.4);
    TPL.ammo = bake(g);
    // seaplane apron (seaplane_base.js): a concrete hardstand with bollards and a beaching-gear dolly (+x: toward the water)
    g = new THREE.Group(); M._box(g, C.apron, 10, 0.12, 9, 0, 0, 0);
    for (var bz = -1; bz <= 1; bz += 2) M._box(g, C.tyre, 0.3, 0.6, 0.3, 4.4, 0.1, bz * 3.8);
    M._box(g, C.olive, 1.6, 0.4, 2.4, -3.2, 0.1, 2.6); M._box(g, C.tyre, 0.5, 0.5, 0.25, -3.2, 0, 3.8); M._box(g, C.tyre, 0.5, 0.5, 0.25, -3.2, 0, 1.4);
    TPL.ramp = bake(g);
    TPL.scorch = M._mat(0x5d5249);
    // True size (2026-10-18): the templates above were drawn 2-5x (a hangar 115 m long and 44 m high, the tower 90 m,
    // an AA pit 38 m across); each is scaled to its real size here: a steel arch hangar 60 x 45 x 14 m, the control
    // tower ~20 m to the flagpole top, fuel tanks 19 m across and 10 m high, barracks 37 x 10 m, a 3-inch AA pit 8 m
    // across, a 7-inch coastal gun's emplacement 15 m across (its barrel 10 m), the ammunition dump 20 m, the seaplane
    // apron 48 x 43 m (a PBY spans 32 m). The hit radii and hp (island_base.js R / HP) are sim values and unchanged.
    for (var tk in SIZE) { var z = SIZE[tk]; TPL[tk].scale(z[0], z[1], z[2]); TPL[tk].computeBoundingSphere(); }
    TPL.flag.USN.scale(SIZE.tower[0], SIZE.tower[0], SIZE.tower[0]); TPL.flag.IJN.scale(SIZE.tower[0], SIZE.tower[0], SIZE.tower[0]);
    return TPL;
  }
  // the ground pieces (strips, revetment berms, gun pits, the slipway): one white toon material of their own, made
  // once, toned down under a high sun (sky_time.js addLand); the shared M._mat(0xffffff) paints the buildings and ships
  var GROUND = null;
  function groundMat() {
    if (!GROUND) { GROUND = M._mat(0xffffff).clone(); if (WW.skyTime) WW.skyTime.addLand(GROUND); }
    return GROUND;
  }
  // per map: the runways and the taxi network (site-local u / v -> a group rotated by the main runway heading), one
  // baked mesh. Layers (no coplanar overlap): main runway 0.08 thick > hold bars 0.075 > cross runway 0.06 > taxiways
  // 0.06 (0.04 lower) > driveways 0.055 > hardstands 0.05. The crossing is the main runway's: its slab and its paint
  // (the centreline) run through, the cross runway passes under it and its paint stops short of the main's edges; a
  // threshold inside the crossing (the main's west end lies in it) is left off, as is a hold bar under the cross runway.
  var CLEAR = 1.5;
  function clear(r, o, t0, t1, w0, w1, m) { // a mark (runway r's frame: t0..t1 along, w0..w1 across) clear of runway o's paving + m
    if (!o) return true;
    var c = Math.cos(r.h), s = Math.sin(r.h), oc = Math.cos(o.h), os = Math.sin(o.h);
    for (var a = 0; a <= 4; a++) for (var b = 0; b <= 2; b++) {
      var t = t0 + (t1 - t0) * a / 4, w = w0 + (w1 - w0) * b / 2, x = r.x + c * t - s * w - o.x, z = r.z + s * t + c * w - o.z;
      if (Math.abs(x * oc + z * os) < o.len / 2 + m && Math.abs(-x * os + z * oc) < o.w / 2 + m) return false;
    }
    return true;
  }
  function strips(S, L) {
    var g = new THREE.Group(), y = S.padH, R0 = S.runways[0], R1 = S.runways[1];
    S.runways.forEach(function (r, i) {
      var q = new THREE.Group(), o = i ? R0 : R1, th = i ? 0.06 : 0.08; q.position.set(r.x, y, r.z); q.rotation.y = -r.h; g.add(q);
      M._bar(q, i ? C.strip2 : C.strip, r.len, th, r.w, 0, 0, 0);
      var paint = function (lt, lw, t, w, all) { // a white mark (all: the main's centreline, through the crossing)
        if (all || clear(r, o, t - lt / 2, t + lt / 2, w - lw / 2, w + lw / 2, CLEAR)) M._bar(q, C.paint, lt, th + 0.02, lw, t, 0, w);
      };
      var sa = o ? Math.sin(r.h - o.h) : 0, dx = o ? r.x - o.x : 0, dz = o ? r.z - o.z : 0;
      if (!i || Math.abs(sa) < 0.2) for (var u = -r.len / 2 + 9; u < r.len / 2 - 8; u += 6) paint(3.0, 0.12, u, 0, !i); // centreline dashes (30 x 1 m)
      else { // the cross runway's: laid out both ways from where it meets the main's centreline, from just off its edges
        var tx = (dx * Math.sin(o.h) - dz * Math.cos(o.h)) / sa, d0 = (o.w / 2 + CLEAR + 0.2) / Math.abs(sa) + 1.3;
        [-1, 1].forEach(function (e) { for (var t = tx + e * d0; Math.abs(t) <= r.len / 2 - 7.5; t += e * 6) paint(3.0, 0.12, t, 0); });
      }
      [-1, 1].forEach(function (e) {
        for (var k = -6; k <= 6; k++) if (k) paint(3, 0.18, e * (r.len / 2 - 2.5), k * 0.42);     // threshold bars (30 x 1.8 m)
        paint(0.4, r.w, e * (r.len / 2 - 5), 0);
      });
    });
    if (!L) return new THREE.Mesh(bake(g), groundMat());
    var o = L.toW(0, 0), F = new THREE.Group(); F.position.set(o.x, 0, o.z); F.rotation.y = -S.h; g.add(F);
    var gy = function (u, v) { var w = L.toW(u, v); return Math.max(S.padH, -WW.terrain.depthAt(w.x, w.z)) - 0.04; };
    var seg = function (u0, v0, u1, v1, w, col, th) { // a straight strip from (u0, v0) to (u1, v1)
      var du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv) + w, m = M._bar(F, col, len, th, w, (u0 + u1) / 2, gy((u0 + u1) / 2, (v0 + v1) / 2), (v0 + v1) / 2);
      m.rotation.y = -Math.atan2(dv, du); return m;
    };
    var TU = L.TAXI_U, TV = L.TAXI_V, HV = L.HOLD_V, TW = 2.4;
    [1, -1].forEach(function (sd) {
      seg(-TU, sd * TV, TU, sd * TV, TW, C.taxi, 0.06);                                 // the parallel taxiway (23 m wide)
      [-1, 1].forEach(function (e) {
        seg(e * TU, 0, e * TU, sd * TV, TW, C.taxi, 0.06);                              // the end connector
        for (var k = 0; k < 2; k++) { var hv = sd * (HV + 0.5 + k * 0.7);                   // hold-short bars (not under the cross runway)
          if (clear(R0, R1, e * TU - TW / 2 - 0.1, e * TU + TW / 2 + 0.1, hv - 0.2, hv + 0.2, 0.3)) seg(e * TU - TW / 2, hv, e * TU + TW / 2, hv, 0.12, C.hold, 0.075); }
      });
    });
    L.segs.forEach(function (q) { seg(q.u0, q.v0, q.u1, q.v1, TW, C.taxi, 0.06); });   // columns and row lanes
    L.spots.forEach(function (sp) {                                                       // hardstands and their driveways
      var M2 = M._bar(F, C.stand, sp.span + 0.5, 0.05, sp.len + 0.5, sp.u, gy(sp.u, sp.v), sp.v); M2.rotation.y = 0;
      var dv = Math.sign(sp.laneV - sp.v) * ((sp.len + 0.5) / 2 + 0.8);                      // (seg runs 0.8 past each end):
      seg(sp.u, sp.v + dv, sp.u, sp.laneV, 1.6, C.taxi, 0.055);                             // from the hardstand's edge, not over it
    });
    return new THREE.Mesh(bake(g), groundMat());
  }
  var KIND = { hangar: 'hangar', tower: 'tower', fuel: 'fuel', ammo: 'ammo', barracks: 'barracks', aa: 'pit', battery: 'emp', ramp: 'ramp' };
  function build(base) {
    var T = templates(), mat = M._mat(0xffffff), S = base.site, root = new THREE.Group(), parts = [];
    root.name = 'airfield';
    var st = strips(S, base.layout); st.receiveShadow = true; root.add(st);
    var gy = function (x, z) { return Math.max(S.padH, -WW.terrain.depthAt(x, z)) - 0.05; };
    base.facilities.forEach(function (f) {
      var m = new THREE.Mesh(T[KIND[f.kind]], f.kind === 'aa' || f.kind === 'battery' ? groundMat() : mat), y = gy(f.x, f.z);   // gun pits: sandbag berms
      m.position.set(f.x, y, f.z);
      // buildings face the field (f.a: toward the site centre; a hangar's doors are its +x end), batteries and pits stand alone
      m.rotation.y = f.a !== undefined ? -f.a + (f.kind === 'hangar' ? 0 : f.kind === 'ramp' ? PI : PI / 2) : -S.h;   // the ramp's apron: +x to the water
      m.castShadow = true; m.receiveShadow = true; root.add(m);
      var part = { f: f, mesh: m, gun: null, y: y };
      if (f.kind === 'aa' || f.kind === 'battery') {
        var gun = new THREE.Mesh(f.kind === 'aa' ? T.aagun : T.cgun, mat); gun.position.set(f.x, y + 0.05, f.z); gun.rotation.y = -(f.a || S.h);
        gun.castShadow = true; root.add(gun); part.gun = gun;
      }
      if (f.kind === 'tower') {
        var fl = new THREE.Mesh(T.flag[base.nation], mat), c = Math.cos(S.h), s = Math.sin(S.h);
        fl.position.set(f.x, y + 8.2 * SIZE.tower[1], f.z); fl.rotation.y = -(WW.wind ? WW.wind.a : 0); part.flag = fl; root.add(fl);
      }
      parts.push(part);
    });
    // the slipway: a concrete strip from the apron's edge down into the lagoon to the ramp foot
    var SP = base.seaplane;
    if (SP) {
      var ex = SP.ax - Math.cos(SP.h) * 2.4, ez = SP.az - Math.sin(SP.h) * 2.4, y0 = gy(ex, ez) + 0.05, y1 = -0.5, len = Math.hypot(SP.wx - ex, SP.wz - ez);
      var sg = new THREE.BoxGeometry(len + 1, 0.12, 1.7);   // the slipway, 16 m wide
      var ac = M._mat(C.apron).color, ca = new Float32Array(sg.attributes.position.count * 3);
      for (var i = 0; i < ca.length; i += 3) { ca[i] = ac.r; ca[i + 1] = ac.g; ca[i + 2] = ac.b; }
      sg.setAttribute('color', new THREE.Float32BufferAttribute(ca, 3));   // the apron colour as vertex colours (the ground material is white)
      var sl = new THREE.Mesh(sg, groundMat());
      sl.position.set((ex + SP.wx) / 2, (y0 + y1) / 2, (ez + SP.wz) / 2); sl.rotation.order = 'YZX';
      sl.rotation.set(0, -Math.atan2(SP.wz - ez, SP.wx - ex), Math.atan2(y1 - y0, len)); sl.receiveShadow = true; root.add(sl);
    }
    // a revetment round every spot, open toward the lane (the plane's nose): one InstancedMesh per plane class
    var spots = base.layout ? base.layout.spots : [], rv = [];
    ['S', 'M', 'L'].forEach(function (k) {
      var list = spots.filter(function (sp) { return sp.cls === k; }); if (!list.length) return;
      var im = new THREE.InstancedMesh(revetGeo(k, list[0]), groundMat(), list.length); im.castShadow = true; im.receiveShadow = true;
      var m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1);
      list.forEach(function (sp, i) {
        p4.set(sp.x, gy(sp.x, sp.z), sp.z); q4.setFromEuler(e4.set(0, -sp.h, 0));      // local +x = the nose
        im.setMatrixAt(i, m4.compose(p4, q4, s4));
      });
      im.instanceMatrix.needsUpdate = true; root.add(im); rv.push(im);
    });
    // the airfield stands still: the root and the ground, the slipway, the revetments and the buildings get their
    // matrices once (power2); the guns and the flag keep posing per frame, and a wrecked building is posed again (wreck)
    root.matrixAutoUpdate = false;
    root.children.forEach(function (o) { if (o !== null && !parts.some(function (q) { return q.gun === o || q.flag === o; })) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    return { group: root, parts: parts, strips: st, revets: rv, mat: mat };   // mat: the buildings' (the camp shares it)
  }
  // a revetment for a plane class: low grassed earth walls behind the tail and beside the wingtips (clear of them by
  // 0.9), open at the nose; local +x = the nose, centred on the spot
  var REV = {}, BK = Math.sqrt(WW.cfg.PLANE_K || 1), BH = BK * 0.72;   // berm size: x PLANE_K^0.5 (1 at the 1.7 scale; at true size ~3 m high)
  // the berms of a spot's revetment, spot-local (+x = the nose): [centre x, centre z, length, base width, yaw]
  function revetWalls(sp) {
    var AL = WW.airfieldLayout, hl = sp.len / 2, hs = sp.span / 2, back = -hl - AL.BERM_B, side = hs + AL.BERM_S, front = hl - 0.6 * BK;
    return [[back, -side, back, side], [back, -side, front, -side], [back, side, front, side]].map(function (w) {
      return [(w[0] + w[2]) / 2, (w[1] + w[3]) / 2, Math.hypot(w[2] - w[0], w[3] - w[1]) + 0.9 * BK, 1.15 * BK, -Math.atan2(w[3] - w[1], w[2] - w[0])];
    });
  }
  function revetGeo(k, sp) {
    if (REV[k]) return REV[k];
    var g = new THREE.Group();
    revetWalls(sp).forEach(function (w) { // a berm: a wide base and a narrower grassed top
      var b = M._bar(g, C.revet, w[2], 0.55 * BH, w[3], w[0], 0, w[1]); b.rotation.y = w[4];   // ~3 m high, 5 m thick at the base
      var t = M._bar(g, C.revetTop, w[2] - 0.3 * BK, 0.4 * BH, 0.7 * BK, w[0], 0.5 * BH, w[1]); t.rotation.y = w[4];
    });
    REV[k] = bake(g); return REV[k];
  }
  // a knocked-out facility: scorched and slumped (hangars cave in, tanks burst, guns tip)
  function wreck(part) {
    if (part.wrecked) return;
    part.wrecked = true;
    var k = part.f.kind, m = part.mesh;
    m.material = TPL.scorch; m.matrixAutoUpdate = true;   // (posed once at build: build)
    if (k === 'hangar') { m.scale.set(1, 0.42, 0.9); m.rotation.z = 0.06; }
    else if (k === 'fuel') m.scale.set(1.05, 0.35, 1.05);
    else if (k === 'tower' || k === 'barracks') m.scale.set(0.9, 0.5, 0.9);
    if (part.gun) { part.gun.material = TPL.scorch; part.gun.rotation.z = -0.35; part.gun.rotation.x = 0.25; }
    if (part.flag) part.flag.visible = false;
  }
  // ---- ground vehicles (base_ground_fx.js): nose +x, wheels on y = 0, about 2.4 long, drawn x VEH_K (they follow the
  // planes' size: 1 at the 1.7 plane scale, ~0.56 at 0.82, a fuel truck ~1.35 u = 6.5 m at 2x) ----
  var VEH = {}, VEH_K = Math.pow(WW.cfg.PLANE_K || 1, 0.8);
  function wheels(g, xs, w) { xs.forEach(function (x) { [-1, 1].forEach(function (s) { var t = M._cyl(g, C.tyre, 0.26, 0.2, x, 0.26, s * w); t.rotation.x = PI / 2; t.position.y = 0.26; t.position.z = s * w + s * 0.1; }); }); }
  function vehicle(kind, nation) {
    var k = kind + (nation || 'USN'); if (VEH[k]) return VEH[k];
    templates();
    if (kind !== 'fuel' && kind !== 'bombs' && kind !== 'crash' && kind !== 'roller' && WW.baseLifeModels) return (VEH[k] = WW.baseLifeModels.vehicle(kind, nation));
    var g = new THREE.Group(), body = nation === 'IJN' ? C.ijnV : C.olive;
    if (kind === 'fuel') {        // tanker: cab + an elliptic tank with a red band
      M._box(g, body, 0.8, 0.95, 1.05, 0.95, 0.3, 0); M._bar(g, C.cab, 0.08, 0.35, 0.8, 1.36, 0.75, 0);
      M._bar(g, body, 2.4, 0.18, 1.0, -0.1, 0.28, 0);
      var tk = M._xc(g, C.tank, 0.48, 1.6, -0.45, 0.95, 0); tk.scale.z = 1.05; M._xc(g, C.band, 0.49, 0.18, -0.45, 0.95, 0);
      wheels(g, [0.9, -0.3, -0.9], 0.45);
    } else if (kind === 'bombs') { // tractor + a low trailer with three bombs
      M._box(g, body, 0.7, 0.55, 0.8, 0.9, 0.25, 0); M._bar(g, C.steel, 0.1, 0.5, 0.5, 0.6, 0.6, 0);
      M._bar(g, C.steel, 1.5, 0.1, 0.9, -0.45, 0.3, 0); M._bar(g, C.steel, 0.5, 0.06, 0.08, 0.35, 0.35, 0);
      for (var b = -1; b <= 1; b++) M._xc(g, C.bomb, 0.17, 1.1, -0.45, 0.58, b * 0.3);
      wheels(g, [0.95, -0.2, -0.75], 0.38);
    } else if (kind === 'crash') { // red crash / fire truck with a white stripe and the roof monitor's turntable (the
      // monitor itself is a separate part, monitor(): it turns to the wreck)
      M._box(g, C.fire, 2.3, 1.0, 1.05, 0, 0.28, 0); M._bar(g, C.paint, 2.32, 0.12, 1.07, 0, 0.75, 0);
      M._bar(g, C.cab, 0.08, 0.35, 0.8, 1.16, 0.8, 0); M._cyl(g, C.steel, 0.15, 0.1, MON[0], 1.28, 0);
      wheels(g, [0.75, -0.75], 0.47);
    } else {                       // roller (crater repair): a drum in front, an engine box
      M._xc(g, C.steel, 0.45, 1.1, 0.65, 0.45, 0); M._box(g, body, 1.0, 0.75, 0.9, -0.35, 0.2, 0); M._bar(g, C.pole, 0.06, 0.6, 0.06, -0.5, 0.95, 0);
      wheels(g, [-0.55], 0.45);
    }
    VEH[k] = bake(g); return VEH[k];
  }
  // the crash truck's roof monitor (foam cannon): a barrel along +x from its pivot on the turntable (truck-local
  // MON = [x, y]), drawn as its own instances so it lies stowed along the truck on the road and turns and dips to the
  // wreck when the truck stands by (base_ground_fx.js)
  var MON = [-0.3, 1.38], MONG = null;
  function monitor() {
    if (MONG) return MONG;
    templates();
    var g = new THREE.Group();
    M._sph(g, C.steel, 0.2, 0.18, 0.2, 0, 0.02, 0);                     // the swivel
    M._xc(g, C.steel, 0.065, 0.62, 0.3, 0.04, 0); M._xc(g, C.gun, 0.085, 0.12, 0.62, 0.04, 0);   // the barrel, the nozzle
    MONG = bake(g); return MONG;
  }
  WW.baseModels = { build: build, wreck: wreck, vehicle: vehicle, monitor: monitor, MON: MON, revetWalls: revetWalls, VEH_K: VEH_K, C: C,
    _bake: bake, _ring: ring, _arch: function () { archGeo(); return { arch: arch, end: archEnd }; }, _tpl: function () { return templates(); } };
})();
