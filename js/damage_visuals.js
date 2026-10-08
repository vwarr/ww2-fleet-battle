// damage_visuals.js - WW.dmgVis: a battered ship tells its story at a glance (visual only, Math.random, real time).
//  - Scorch and char decals on decks / roofs / hull sides at hit sites, shell holes along the hull near the
//    waterline, torpedo holes at it, bomb craters on a carrier's flight deck (2 pooled InstancedMeshes, capped
//    per ship: further hits grow and darken the nearest mark). Hit sites come from damage.js ('dmgSite').
//  - Knocked-out turrets (damage.js disableTurret): the gun mesh droops, the house turns askew, scorch on the roof.
//  - Heavy damage near the superstructure topples a mast or bends a funnel: the vertices of that part of the
//    ship's merged static mesh (a per-ship clone) rotate about its foot, with a fall and a small bounce.
//  - Settling: a badly hurt or flooding ship sits lower and trims down by the damaged end, on top of its list.
//    Applied just before the render and removed before the next sim step (pose / unpose), so the sim never sees
//    it: muzzles, the carrier deck and turret positions are read from the group by sim code.
//  - A carrier's deck fire ('deckHit', ship_fires.js): burning wrecks of the parked planes, then charred remains.
// No lights here: fire glow belongs to the lighting code.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random, PI = Math.PI;
  var NSC = 360, NHO = 220, NWR = 18, FAR = 260, CAP = { up: 12, side: 10 };
  // masts / funnels: [kind, x0, x1, yb (foot), z centre, z half range, height, pivot x] in ship-local units (models.js)
  var PARTS = {
    'battleship|USN': [['m', 1.0, 3.0, 3.85, 0, 0.9, 2.6, 2.0], ['m', -5.5, -3.7, 1.95, 0, 0.9, 1.8, -4.6], ['f', -1.85, 0.05, 1.85, 0, 0.75, 2.0, -0.9]],
    'battleship|IJN': [['f', -2.0, 0.3, 1.85, 0, 0.75, 2.3, -0.6], ['m', -6.25, -4.75, 1.15, 0, 0.9, 2.4, -5.5]],
    'cruiser|USN': [['m', 0.75, 2.3, 2.55, 0, 0.9, 2.0, 1.5], ['f', -0.6, 0.6, 1.55, 0, 0.5, 1.6, 0], ['f', -2.4, -1.2, 1.55, 0, 0.5, 1.6, -1.8], ['m', -4.15, -2.65, 1.55, 0, 0.9, 1.5, -3.4]],
    'cruiser|IJN': [['f', -2.2, 0.3, 1.55, 0, 0.6, 1.7, -0.9], ['m', -4.3, -2.9, 1.55, 0, 0.9, 1.8, -3.6]],
    'destroyer|USN': [['m', 1.3, 1.9, 1.55, 0, 0.35, 1.7, 1.6], ['f', 0.05, 0.95, 1.1, 0, 0.45, 1.2, 0.5], ['f', -1.35, -0.45, 1.1, 0, 0.45, 1.2, -0.9]],
    'destroyer|IJN': [['m', 1.3, 1.9, 1.55, 0, 0.35, 1.7, 1.6], ['f', -0.15, 1.05, 1.1, 0, 0.5, 1.3, 0.6], ['f', -1.75, -0.6, 1.1, 0, 0.45, 1.1, -1.1]],
    'carrier|USN': [['m', 1.2, 2.8, 4.1, 2.1, 0.8, 1.7, 2.0], ['f', -0.5, 0.75, 3.35, 2.1, 0.7, 1.0, 0.2]],
    'carrier|IJN': [['m', 3.5, 4.1, 3.05, -2.0, 0.4, 1.5, 3.8]]
  };
  var sc = null, ho = null, wr = null, ready = false, list = [], wrecks = [], _m, _l, _t, _v, _q, _s, _e, _a, _n;

  // ---- textures (canvas, made once) ----
  function canvas(fn) { var c = document.createElement('canvas'); c.width = c.height = 128; fn(c.getContext('2d')); var t = new THREE.CanvasTexture(c); t.anisotropy = 2; return t; }
  function blot(x, cx, cy, r, col, a) { var g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(' + col + ',' + a + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
  function scorchTex() {
    return canvas(function (x) {
      blot(x, 64, 64, 60, '30,24,20', 0.75);
      for (var i = 0; i < 9; i++) { var a = R() * 7, d = 10 + R() * 26; blot(x, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 14 + R() * 18, '22,18,16', 0.55); }
      x.strokeStyle = 'rgba(20,16,14,0.45)'; x.lineCap = 'round';
      for (var k = 0; k < 14; k++) { var b = R() * 7, l = 34 + R() * 26; x.lineWidth = 2 + R() * 4; x.beginPath(); x.moveTo(64 + Math.cos(b) * 14, 64 + Math.sin(b) * 14); x.lineTo(64 + Math.cos(b) * l, 64 + Math.sin(b) * l); x.stroke(); }
    });
  }
  function holeTex() {
    return canvas(function (x) {
      blot(x, 64, 64, 62, '34,26,22', 0.7);
      blot(x, 64, 64, 40, '110,62,40', 0.6);                      // rust / heat ring
      x.fillStyle = 'rgba(150,150,150,0.95)'; x.beginPath();    // torn plating petals
      for (var i = 0; i <= 14; i++) { var a = i / 14 * PI * 2, r = i % 2 ? 22 + R() * 4 : 32 + R() * 9; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
      x.fill();
      x.fillStyle = 'rgb(12,10,10)'; x.beginPath();              // the hole
      for (var j = 0; j <= 16; j++) { var b = j / 16 * PI * 2, q = 17 + R() * 9; x.lineTo(64 + Math.cos(b) * q, 64 + Math.sin(b) * q); }
      x.fill();
    });
  }
  function decalMesh(tex, n) {
    var m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, color: 0xffffff }), n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    m.frustumCulled = false; m.count = 0; m.renderOrder = 1; WW.scene.add(m);
    return m;
  }
  // a burnt-out parked plane: fuselage, a wing broken at the root, the stub, the fin (merged by hand)
  function wreckGeo() {
    var parts = [[1.5, 0.24, 0.26, 0, 0.12, 0, 0, 0, 0.06], [0.42, 0.05, 0.95, 0.15, 0.04, 0.55, 0.25, 0.3, 0], [0.42, 0.05, 0.5, 0.2, 0.2, -0.32, -0.2, -0.1, 0],
      [0.25, 0.3, 0.04, -0.68, 0.3, 0, 0, 0, 0.5], [0.3, 0.04, 0.6, -0.66, 0.2, 0, 0, 0.2, 0]];
    var pos = [], nor = [], b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
    parts.forEach(function (p) {
      M.compose(new THREE.Vector3(p[3], p[4], p[5]), new THREE.Quaternion().setFromEuler(new THREE.Euler(p[6], p[7], p[8])), new THREE.Vector3(p[0], p[1], p[2])); N.getNormalMatrix(M);
      for (var i = 0; i < b.attributes.position.count; i++) {
        v.fromBufferAttribute(b.attributes.position, i).applyMatrix4(M); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(b.attributes.normal, i).applyMatrix3(N).normalize(); nor.push(v.x, v.y, v.z);
      }
    });
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    return g;
  }
  function init() {
    if (ready || !WW.scene || !WW.models || WW.simOnly) return;
    _m = new THREE.Matrix4(); _l = new THREE.Matrix4(); _t = new THREE.Matrix4(); _v = new THREE.Vector3(); _q = new THREE.Quaternion();
    _s = new THREE.Vector3(); _e = new THREE.Euler(); _a = new THREE.Vector3(); _n = new THREE.Vector3();
    sc = decalMesh(scorchTex(), NSC); ho = decalMesh(holeTex(), NHO);
    wr = new THREE.InstancedMesh(wreckGeo(), new THREE.MeshToonMaterial({ color: 0x3a3532, gradientMap: WW.models._grad(), vertexColors: true }), NWR);
    wr.instanceMatrix.setUsage(THREE.DynamicDrawUsage); wr.frustumCulled = false; wr.count = 0; wr.castShadow = true; WW.scene.add(wr);
    WW.on('roundStart', clear); WW.on('setupStart', clear);
    ready = true;
  }
  function clear() { list.forEach(drop); list.length = 0; wrecks.length = 0; }
  function drop(sh) { var d = sh._dv; if (d) d.clones.forEach(function (g) { g.dispose(); }); sh._dv = undefined; }

  // ---- per-ship record ----
  function dv(sh) {
    if (sh._dv) return sh._dv;
    var L = sh.stats.length;
    sh._dv = { L: L, up: [], side: [], trimW: 0, set: 0, trim: 0, parts: (PARTS[sh.type + '|' + sh.nation] || []).map(function (p) { return { p: p, done: false }; }),
      anim: [], clones: [], meshes: null, tur: {}, pose: null };
    list.push(sh);
    return sh._dv;
  }
  function topY(sh, lx, lz) {
    var y = WW.crew && WW.crew.top ? WW.crew.top(sh.type, sh.nation, lx, lz) : null;
    if (y == null || y < 0.2) y = sh.model.deck ? sh.model.deck.position.y : WW.crew ? WW.crew.deckY(sh.type, lx) : 1;
    return y + 0.015;
  }
  function decal(sh, kind, face, lx, ly, lz, size, tur) {
    var d = dv(sh), arr = d[face], cap = CAP[face] + (sh.type === 'carrier' ? 4 : 0);
    if (arr.length >= cap) {                                 // full: the nearest mark of this kind grows darker and wider
      var best = null, bd = 1e9;
      arr.forEach(function (q) { var e = (q.lx - lx) * (q.lx - lx) + (q.lz - lz) * (q.lz - lz) + (q.k === kind ? 0 : 4) + (q.tur ? 1e6 : 0); if (e < bd) { bd = e; best = q; } });
      best.s = Math.min(best.s * 1.12 + 0.05, 2.6); best.c = Math.max(0.55, best.c * 0.92); return;
    }
    arr.push({ k: kind, lx: lx, ly: ly, lz: lz, s: size, r: R() * PI * 2, c: 0.8 + R() * 0.2, tur: tur || null, sd: lz >= 0 ? 1 : -1 });
  }
  function hullHole(sh, lx, y, side, size) {
    var z = WW.crewOps ? WW.crewOps.hullZ(sh.type, lx, y) : sh.model.group ? 1 : 1;
    decal(sh, 1, 'side', lx, y, side * (z + 0.012), size);
  }
  function onSite(d) {
    var sh = d && d.ship; if (!ready || !sh || !sh.model || sh.type === 'submarine') return;
    var D = dv(sh), lx = d.lx, lz = d.lz, side = lz >= 0 ? 1 : -1, cal = d.cal, kind = d.kind, L = D.L;
    var dk = sh.model.deck ? sh.model.deck.position.y : WW.crew.deckY(sh.type, lx);
    D.trimW += (d.amount || 0) * (lx / (L * 0.5)) * (kind === 'torpedo' ? 1.6 : 1);
    if (kind === 'torpedo') {
      hullHole(sh, lx, 0.14, side, 1.5 + R() * 0.4);
      decal(sh, 0, 'side', lx + (R() - 0.5) * 0.4, Math.min(dk - 0.2, 0.55), side * (WW.crewOps.hullZ(sh.type, lx, 0.55) + 0.015), 1.7);
    } else if (kind === 'bomb' || kind === 'deck') {
      var jx = lx + (R() - 0.5) * 0.6, jz = lz * 0.6 + (R() - 0.5) * 0.6;
      if (kind === 'bomb') decal(sh, 1, 'up', jx, topY(sh, jx, jz) + 0.005, jz, sh.type === 'carrier' ? 1.05 : 0.8);
      decal(sh, 0, 'up', jx + (R() - 0.5) * 0.3, topY(sh, jx, jz), jz, 1.7 + R() * 0.5);
    } else {
      var s = cal === 'big' ? 1.25 : cal === 'med' ? 0.85 : 0.55, x = lx + (R() - 0.5) * 0.5, z = lz * (0.3 + R() * 0.6);
      decal(sh, 0, 'up', x, topY(sh, x, z), z, s * (0.85 + R() * 0.3));
      if (R() < (cal === 'big' ? 0.6 : cal === 'med' ? 0.45 : 0.2)) hullHole(sh, lx + (R() - 0.5), 0.22 + R() * Math.max(0.05, dk - 0.5), side, s * 0.8);
    }
    var f = sh.hp / sh.maxHp, heavy = kind === 'bomb' || kind === 'deck' || kind === 'torpedo' || cal === 'big' || cal === 'med';
    if (heavy && f < 0.6) D.parts.forEach(function (pt) {
      if (pt.done) return;
      var near = Math.abs(lx - pt.p[7]) < 3.2 || f < 0.3;
      if (near && R() < (f < 0.3 ? 0.35 : 0.5)) topple(sh, D, pt);
    });
  }

  // ---- toppling: rotate the part's vertices in the ship's (cloned) merged static meshes ----
  function staticMeshes(sh, D) {
    if (D.meshes) return D.meshes;
    var hm = sh.model.hullMats;
    D.meshes = sh.group.children.filter(function (c) { return c.isMesh && !Array.isArray(c.material) && hm.indexOf(c.material) < 0 && !c.geometry.index; });
    return D.meshes;
  }
  function topple(sh, D, pt) {
    pt.done = true;
    var p = pt.p, mast = p[0] === 'm', sel = [];
    staticMeshes(sh, D).forEach(function (mesh) {
      var pa = mesh.geometry.attributes.position, idx = [];
      for (var i = 0; i < pa.count; i++) {
        var x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        if (x >= p[1] && x <= p[2] && y > p[3] && Math.abs(z - p[4]) <= p[5]) idx.push(i);
      }
      if (!idx.length) return;
      if (!mesh.userData.dvClone) { mesh.geometry = mesh.geometry.clone(); mesh.userData.dvClone = true; D.clones.push(mesh.geometry); }
      var g = mesh.geometry, P = g.attributes.position, Nn = g.attributes.normal, o = new Float32Array(idx.length * 6), w = new Float32Array(idx.length);
      idx.forEach(function (vi, k) {
        o[k * 6] = P.getX(vi); o[k * 6 + 1] = P.getY(vi); o[k * 6 + 2] = P.getZ(vi); o[k * 6 + 3] = Nn.getX(vi); o[k * 6 + 4] = Nn.getY(vi); o[k * 6 + 5] = Nn.getZ(vi);
        var u = WW.clamp((o[k * 6 + 1] - p[3]) / (p[6] * 0.7), 0, 1); w[k] = mast ? 1 : u * u * (3 - 2 * u);
      });
      sel.push({ g: g, idx: idx, o: o, w: w });
    });
    if (!sel.length) return;
    // about z: falls fore / aft (reads from the side, where the director mostly films); about x: over a side.
    // Forward masts fall aft across the funnels, aft ones forward; a few go over the side, tilted a little fore / aft.
    var side = R() < 0.5 ? -1 : 1, sideways = R() < 0.3, aft = p[7] > -1 ? 1 : -1;
    var axis = sideways ? new THREE.Vector3(side, 0, (R() - 0.5) * 0.6).normalize() : new THREE.Vector3((R() - 0.5) * 0.5, 0, mast ? aft : side).normalize();
    var A = mast ? 1.0 + R() * 0.35 : 0.35 + R() * 0.2;
    D.anim.push({ sel: sel, axis: axis, A: A, piv: new THREE.Vector3(p[7], p[3], p[4]), t: 0, mast: mast });
    if (!mast) (sh.model.stacks || []).forEach(function (st) {     // the smoke leaves the bent funnel's mouth
      var f = st.parent; if (!f || Math.abs(f.position.x - p[7]) > 0.6 || Math.abs(f.position.z - p[4]) > 0.6) return;
      f.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, A)); sh._stackL = null;
    });
    sh.group.updateMatrix();
    var top = new THREE.Vector3(p[7], p[3] + p[6] * 0.6, p[4]).applyMatrix4(sh.group.matrix);
    if (WW.fx) { WW.fx.sparks(top.x, top.y, top.z); WW.fx.smoke(top.x, top.y, top.z, true, 0.6); }
  }
  function animate(sh, D, dt) {
    for (var a = D.anim.length - 1; a >= 0; a--) {
      var an = D.anim[a]; an.t += dt;
      var T = an.mast ? 0.9 : 0.35, th;
      if (an.t < T) { var u = an.t / T; th = an.A * u * u; }
      else { var e = an.t - T; th = an.A * (1 - 0.07 * Math.sin(e * 13) * Math.exp(-e * 5)); }
      an.sel.forEach(function (s) {
        var P = s.g.attributes.position, N = s.g.attributes.normal;
        for (var k = 0; k < s.idx.length; k++) {
          _q.setFromAxisAngle(an.axis, th * s.w[k]);
          _v.set(s.o[k * 6], s.o[k * 6 + 1], s.o[k * 6 + 2]).sub(an.piv).applyQuaternion(_q).add(an.piv);
          _n.set(s.o[k * 6 + 3], s.o[k * 6 + 4], s.o[k * 6 + 5]).applyQuaternion(_q);
          P.setXYZ(s.idx[k], _v.x, _v.y, _v.z); N.setXYZ(s.idx[k], _n.x, _n.y, _n.z);
        }
        P.needsUpdate = true; N.needsUpdate = true;
      });
      if (an.t > T + 1.2) D.anim.splice(a, 1);
    }
  }

  // ---- knocked-out turrets ----
  function turrets(sh, D) {
    var ts = sh.ai && sh.ai.turrets; if (!ts) return;
    for (var i = 0; i < ts.length; i++) {
      if (!ts[i].disabled || D.tur[i] || !ts[i].t) continue;
      D.tur[i] = true;
      var obj = ts[i].t.obj, gun = null, house = null, gx = -1e9, hv = 0;
      obj.children.forEach(function (c) {
        if (!c.isMesh) return;
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        var b = c.geometry.boundingBox, vol = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
        if (b.max.x > gx) { gx = b.max.x; gun = c; }
        if (vol > hv) { hv = vol; house = c; }
      });
      obj.rotation.y += (R() < 0.5 ? -1 : 1) * (0.3 + R() * 0.35);  // never written again: ships_ai skips a disabled turret
      if (gun && gun !== house) {                                    // barrels droop about their trunnions
        var bb = gun.geometry.boundingBox, px = bb.min.x, py = (bb.min.y + bb.max.y) / 2, a = -(0.22 + R() * 0.12);
        gun.rotation.z = a; gun.position.set(px - (px * Math.cos(a) - py * Math.sin(a)), py - (px * Math.sin(a) + py * Math.cos(a)), 0);
      }
      if (house) {
        var hb = house.geometry.boundingBox, w = hb.max.x - hb.min.x;
        decal(sh, 0, 'up', (hb.min.x + hb.max.x) / 2 + (R() - 0.5) * w * 0.3, hb.max.y + 0.012, (R() - 0.5) * 0.2, w * 0.95, obj);
        decal(sh, 1, 'up', (hb.min.x + hb.max.x) / 2 + w * 0.15, hb.max.y + 0.016, (R() - 0.5) * 0.3, w * 0.35, obj);
      }
      sh.group.updateMatrix(); obj.updateMatrix();
      var p = _v.set(0, 0.6, 0).applyMatrix4(obj.matrix).applyMatrix4(sh.group.matrix);
      if (WW.fx) { WW.fx.explosion(p.x, p.y, p.z, 0.5); WW.fx.smoke(p.x, p.y + 0.3, p.z, true, 0.8); }
    }
  }

  // ---- burning wrecks of parked planes on a carrier deck ('deckHit', ship_fires.js) ----
  function onDeckHit(d) {
    var sh = d && d.ship; if (!ready || !sh || !sh.model || !sh.model.deck) return;
    var c = Math.cos(sh.heading), sn = Math.sin(sh.heading), ex = (d.x || sh.x) - sh.x, ez = (d.z || sh.z) - sh.z;
    var lx = WW.clamp(ex * c + ez * sn, -11, 10), n = Math.min(4, 1 + Math.ceil((d.planes || 1) / 2)), y = sh.model.deck.position.y;
    for (var i = 0; i < n; i++) {
      if (wrecks.length >= NWR) wrecks.shift();
      var x = WW.clamp(lx + (R() - 0.5) * 6, -12, 11), z = (R() - 0.5) * 3;
      wrecks.push({ sh: sh, lx: x, lz: z, ly: y + 0.02, yaw: R() * PI * 2, tilt: (R() - 0.5) * 0.3, burn: 25 + R() * 20, fT: R() * 0.2, sT: R() * 0.4 });
      decal(sh, 0, 'up', x, y + 0.012, z, 2.0 + R() * 0.6);
    }
    decal(sh, 1, 'up', lx, y + 0.016, (R() - 0.5) * 1.2, 1.2);
  }
  function drawWrecks(dt, cam) {
    var n = 0;
    for (var i = wrecks.length - 1; i >= 0; i--) {
      var w = wrecks[i], sh = w.sh;
      if (sh.removed || (sh.wreck && (sh.wreckT || 0) > 30)) { wrecks.splice(i, 1); continue; }
      _l.compose(_v.set(w.lx, w.ly, w.lz), _q.setFromEuler(_e.set(w.tilt, w.yaw, w.tilt * 0.5)), _s.set(1.9, 1.9, 1.9));
      _m.multiplyMatrices(sh.group.matrix, _l);
      _v.setFromMatrixPosition(_m);
      if (_v.y < -0.1) continue;
      _m.toArray(wr.instanceMatrix.array, n * 16); n++;
      w.burn -= dt;
      if (w.burn > 0 && WW.fx && cam.distanceToSquared(_v) < FAR * FAR) {
        w.fT -= dt; w.sT -= dt;
        if (w.fT <= 0) { w.fT = 0.12 + R() * 0.1; WW.fx.fire(_v.x + (R() - 0.5) * 0.6, _v.y + 0.15, _v.z + (R() - 0.5) * 0.6); }
        if (w.sT <= 0 && WW.fx.trail) { w.sT = 0.35 + R() * 0.2; WW.fx.trail(_v.x, _v.y + 0.8 + R(), _v.z, true, 0.7, 1.4); }
      }
    }
    wr.count = n; wr.visible = n > 0; wr.instanceMatrix.needsUpdate = true;
  }

  // ---- settling: target draught and trim from damage, eased on real time ----
  function settle(sh, D, dt) {
    var f = WW.clamp(sh.hp / sh.maxHp, 0, 1), sev = WW.clamp((0.75 - f) / 0.65, 0, 1);
    if (sh.flood) sev = Math.max(sev, Math.min(1, sh.flood * 2.2));
    if (sh.type === 'submarine' || sh.type === 'pt') sev = 0;
    var L = D.L, want = sev * (0.1 + L * 0.012), trim = sev * Math.min(0.05, 0.6 / L) * WW.clamp(-D.trimW / 400, -1, 1);
    if (!sh.alive && !sh.sinking) { want = 0; trim = 0; }
    var k = Math.min(1, dt * 0.35);
    D.set += (want - D.set) * k; D.trim += (trim - D.trim) * k;
  }
  function pose(rdt) {
    if (!ready) return;
    var dt = Math.min(0.1, rdt || 0), cam = WW.camera.position;
    for (var i = list.length - 1; i >= 0; i--) {
      var sh = list[i], D = sh._dv;
      if (!D || sh.removed) { drop(sh); list.splice(i, 1); continue; }
      var g = sh.group;
      if (!sh.wreck) {
        settle(sh, D, dt);
        var fade = sh.sinking ? Math.max(0, 1 - (sh.sinkT || 0) / 3) : 1, dy = -D.set * fade, dz = D.trim * fade;
        if (Math.abs(dy) > 1e-4 || Math.abs(dz) > 1e-5) {
          D.pose = { y0: g.position.y, z0: g.rotation.z };
          g.position.y += dy; g.rotation.z += dz;
          D.pose.y1 = g.position.y; D.pose.z1 = g.rotation.z;
        }
      }
      if (cam.distanceToSquared(g.position) > FAR * FAR) continue;
      turrets(sh, D);
      if (D.anim.length) animate(sh, D, dt);
    }
  }
  function unpose() {
    for (var i = 0; i < list.length; i++) {
      var D = list[i]._dv, P = D && D.pose; if (!P) continue;
      var g = list[i].group;
      if (g.position.y === P.y1 && g.rotation.z === P.z1) { g.position.y = P.y0; g.rotation.z = P.z0; } // untouched by the sim since
      D.pose = null;
    }
  }
  // decal matrices after the pose (and after the crew, so both follow the same posed hull)
  function draw(rdt) {
    if (!ready) return;
    var cam = WW.camera.position, ns = 0, nh = 0, dt = Math.min(0.1, rdt || 0);
    for (var i = 0; i < list.length; i++) {
      var sh = list[i], D = sh._dv; if (!D || sh.removed) continue;
      var g = sh.group; if (cam.distanceToSquared(g.position) > FAR * FAR) continue;
      g.updateMatrix();
      for (var f = 0; f < 2; f++) {
        var arr = f ? D.side : D.up;
        for (var j = 0; j < arr.length; j++) {
          var q = arr[j], mesh = q.k ? ho : sc, n = q.k ? nh : ns;
          if (n >= (q.k ? NHO : NSC)) continue;
          if (f) _q.setFromEuler(_e.set(0, q.sd > 0 ? 0 : PI, q.r, 'YXZ'));
          else _q.setFromEuler(_e.set(-PI / 2, 0, q.r, 'XYZ'));
          _l.compose(_v.set(q.lx, q.ly, q.lz), _q, _s.set(q.s, q.s * (f ? 0.8 : 1), 1));
          if (q.tur) { q.tur.updateMatrix(); _t.multiplyMatrices(q.tur.matrix, _l); _m.multiplyMatrices(g.matrix, _t); }
          else _m.multiplyMatrices(g.matrix, _l);
          _m.toArray(mesh.instanceMatrix.array, n * 16);
          mesh.instanceColor.array[n * 3] = mesh.instanceColor.array[n * 3 + 1] = mesh.instanceColor.array[n * 3 + 2] = q.c;
          if (q.k) nh++; else ns++;
        }
      }
    }
    sc.count = ns; ho.count = nh; sc.visible = ns > 0; ho.visible = nh > 0;
    sc.instanceMatrix.needsUpdate = ho.instanceMatrix.needsUpdate = true; sc.instanceColor.needsUpdate = ho.instanceColor.needsUpdate = true;
    drawWrecks(dt, cam);
  }

  if (WW.on) {
    WW.on('dmgSite', function (d) { try { onSite(d); } catch (e) { if (!WW.dmgVis._err) { WW.dmgVis._err = e; console.error('dmgVis', e); } } });
    WW.on('deckHit', function (d) { try { onDeckHit(d); } catch (e) { console.error('dmgVis deck', e); } });
  }
  function safe(fn) { return function (a) { try { fn(a); } catch (e) { if (!WW.dmgVis._err) { WW.dmgVis._err = e; console.error('dmgVis', e); } } }; }
  WW.dmgVis = {
    init: init, pose: safe(pose), unpose: safe(unpose), draw: safe(draw), clearAll: clear,
    topple: function (sh, i) { var D = dv(sh), pt = D.parts[i || 0]; if (pt && !pt.done) topple(sh, D, pt); },  // tests
    stats: function () { var o = { ships: list.length, up: 0, side: 0, wrecks: wrecks.length, toppled: 0 }; list.forEach(function (s) { var D = s._dv; if (!D) return; o.up += D.up.length; o.side += D.side.length; D.parts.forEach(function (p) { if (p.done) o.toppled++; }); }); return o; }
  };
})();
