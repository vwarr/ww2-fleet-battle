// models_base.js - WW.baseModels: the island airfield in the toy style (visual only; never built in sim-only mode).
// Runways (coral concrete with a dashed centreline, threshold bars and a painted end number), the apron, arched
// hangars, the control tower with the owner's flag, fuel tanks in earth berms, barracks, U-shaped revetments, sandbagged
// AA pits (a twin gun on a turning mount) and coastal batteries (a long gun in a concrete ring, turning to its target).
// Each facility type is baked once into one geometry (vertex colours x the shared toon material, as models_planes.js)
// and shared by every map; only the runway strips are per map. build(base) -> { group, parts: [{ f, mesh, gun }] }.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, M = null, TPL = null;
  var C = { strip: 0xdcd5c4, strip2: 0xcfc7b3, paint: 0xf6f2e8, apron: 0xd2c9b0, hangar: 0xb8bec4, hangarDk: 0x8a9298, door: 0x7c8590,
    tower: 0xece6d8, cab: 0x86aac4, roof: 0xd0705a, tank: 0xe8e4da, band: 0xc85a48, berm: 0xb9b083, sand: 0xc9b688, gun: 0x5a5f62,
    conc: 0xbdb7a8, barr: 0xeadfc6, pole: 0xd8d8d0, usn: 0x3d5a8a, ijn: 0xf4efe4, red: 0xd2564c };

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
    TPL.scorch = M._mat(0x5d5249);
    return TPL;
  }
  // per map: the runway strips and the apron, one baked mesh
  function strips(S) {
    var g = new THREE.Group(), y = S.padH;
    S.runways.forEach(function (r, i) {
      var q = new THREE.Group(); q.position.set(r.x, y, r.z); q.rotation.y = -r.h; g.add(q);
      M._bar(q, i ? C.strip2 : C.strip, r.len, 0.08, r.w, 0, 0, 0);
      for (var u = -r.len / 2 + 9; u < r.len / 2 - 8; u += 6) M._bar(q, C.paint, 2.6, 0.1, 0.3, u, 0, 0);       // centreline dashes
      [-1, 1].forEach(function (e) {
        for (var k = -3; k <= 3; k++) if (k) M._bar(q, C.paint, 3, 0.1, 0.38, e * (r.len / 2 - 2.5), 0, k * 0.55); // threshold bars
        M._bar(q, C.paint, 0.4, 0.1, r.w, e * (r.len / 2 - 5), 0, 0);
      });
    });
    var A = S.apron, q = new THREE.Group(); q.position.set(A.x, y - 0.02, A.z); q.rotation.y = -A.h; g.add(q);
    M._bar(q, C.apron, 58, 0.08, 18, 0, 0, 0);
    return new THREE.Mesh(bake(g), M._mat(0xffffff));
  }
  var KIND = { hangar: 'hangar', tower: 'tower', fuel: 'fuel', barracks: 'barracks', aa: 'pit', battery: 'emp' };
  function build(base) {
    var T = templates(), mat = M._mat(0xffffff), S = base.site, root = new THREE.Group(), parts = [];
    root.name = 'airfield';
    var st = strips(S); st.receiveShadow = true; root.add(st);
    var gy = function (x, z) { return Math.max(S.padH, -WW.terrain.depthAt(x, z)) - 0.05; };
    base.facilities.forEach(function (f) {
      var m = new THREE.Mesh(T[KIND[f.kind]], mat), y = gy(f.x, f.z);
      m.position.set(f.x, y, f.z);
      // buildings face the runway (rotation by the main runway heading), batteries and pits stand alone
      m.rotation.y = -S.h + (f.kind === 'hangar' ? PI / 2 : 0); // a hangar's doors face the runway
      m.castShadow = true; m.receiveShadow = true; root.add(m);
      var part = { f: f, mesh: m, gun: null, y: y };
      if (f.kind === 'aa' || f.kind === 'battery') {
        var gun = new THREE.Mesh(f.kind === 'aa' ? T.aagun : T.cgun, mat); gun.position.set(f.x, y + 0.05, f.z); gun.rotation.y = -(f.a || S.h);
        gun.castShadow = true; root.add(gun); part.gun = gun;
      }
      if (f.kind === 'tower') {
        var fl = new THREE.Mesh(T.flag[base.nation], mat), c = Math.cos(S.h), s = Math.sin(S.h);
        fl.position.set(f.x, y + 8.2, f.z); fl.rotation.y = -(WW.wind ? WW.wind.a : 0); part.flag = fl; root.add(fl);
      }
      parts.push(part);
    });
    (base.spots || []).forEach(function (sp, i) { // revetments round every other parking spot, open toward the runway
      if (i % 2) return;
      var m = new THREE.Mesh(T.revet, mat); m.position.set(sp.x, gy(sp.x, sp.z), sp.z); m.rotation.y = -(sp.h + PI / 2);
      m.position.x -= Math.cos(sp.h) * 0.5; m.position.z -= Math.sin(sp.h) * 0.5;
      m.castShadow = true; root.add(m);
    });
    return { group: root, parts: parts, strips: st };
  }
  // a knocked-out facility: scorched and slumped (hangars cave in, tanks burst, guns tip)
  function wreck(part) {
    if (part.wrecked) return;
    part.wrecked = true;
    var k = part.f.kind, m = part.mesh;
    m.material = TPL.scorch;
    if (k === 'hangar') { m.scale.set(1, 0.42, 0.9); m.rotation.z = 0.06; }
    else if (k === 'fuel') m.scale.set(1.05, 0.35, 1.05);
    else if (k === 'tower' || k === 'barracks') m.scale.set(0.9, 0.5, 0.9);
    if (part.gun) { part.gun.material = TPL.scorch; part.gun.rotation.z = -0.35; part.gun.rotation.x = 0.25; }
    if (part.flag) part.flag.visible = false;
  }
  WW.baseModels = { build: build, wreck: wreck, C: C };
})();
