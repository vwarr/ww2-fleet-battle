// effects.js (owner B) - pooled retro particle effects. Chunky cubes in InstancedMeshes (one draw call per pool).
// Uses Math.random (not WW.rand) so visual effects never change the sim's random sequence.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  var _m, _q, _e, _p, _s, _c;
  var PAL = {};
  function col(hex) { return PAL[hex] || (PAL[hex] = new THREE.Color(hex)); }

  var FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'g', 'drag', 'ex', 'ey', 'spin',
    'r0', 'g0', 'b0', 'r1', 'g1', 'b1'];

  function Pool(n, geo, mtl) {
    this.n = n;
    var m = this.mesh = new THREE.InstancedMesh(geo, mtl, n);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (var k = 0; k < FIELDS.length; k++) this[FIELDS[k]] = new Float32Array(n);
    this.floor = new Uint8Array(n); this.alive = new Uint8Array(n);
    this.act = new Int32Array(n); this.slot = new Int32Array(n);
    this.count = 0; this.head = 0;
    _m.makeScale(0, 0, 0); _c.setRGB(1, 1, 1);
    for (var i = 0; i < n; i++) { m.setMatrixAt(i, _m); m.setColorAt(i, _c); }
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  Pool.prototype.spawn = function (x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav, drag, spin, floor) {
    var i = this.head; this.head = (i + 1) % this.n;          // ring: the slot at head is the oldest
    if (!this.alive[i]) { this.alive[i] = 1; this.slot[i] = this.count; this.act[this.count++] = i; }
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.r0[i] = c0.r; this.g0[i] = c0.g; this.b0[i] = c0.b;
    this.r1[i] = c1.r; this.g1[i] = c1.g; this.b1[i] = c1.b;
    this.g[i] = grav || 0; this.drag[i] = drag || 0; this.spin[i] = spin || 0;
    this.ex[i] = this.flat ? 0 : R() * 6.28; this.ey[i] = R() * 6.28;
    this.floor[i] = floor ? 1 : 0;
    return i;
  };
  Pool.prototype.kill = function (i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    var k = this.slot[i], last = this.act[--this.count];
    this.act[k] = last; this.slot[last] = k;
    _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m);
    this.dirty = true;
  };
  Pool.prototype.update = function (dt) {
    var m = this.mesh;
    for (var k = this.count - 1; k >= 0; k--) {
      var i = this.act[k];
      var a = (this.age[i] += dt), L = this.life[i];
      if (a >= L) { this.kill(i); continue; }
      var d = 1 - Math.min(1, this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d; this.vy[i] = this.vy[i] * d - this.g[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.floor[i] && this.py[i] < -0.1) { this.kill(i); continue; }
      var t = a / L, s = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      if (t > 0.75) s *= (1 - t) * 4;
      var sp = this.spin[i] * a;
      _q.setFromEuler(_e.set(this.ex[i] + sp, this.ey[i] + sp * 0.7, 0));
      _m.compose(_p.set(this.px[i], this.py[i], this.pz[i]), _q, _s.set(s, this.flat ? 1 : s, s));
      m.setMatrixAt(i, _m);
      _c.setRGB(this.r0[i] + (this.r1[i] - this.r0[i]) * t, this.g0[i] + (this.g1[i] - this.g0[i]) * t,
        this.b0[i] + (this.b1[i] - this.b0[i]) * t);
      m.setColorAt(i, _c);
      this.dirty = true;
    }
    if (this.dirty) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; this.dirty = false; }
  };
  Pool.prototype.clear = function () { while (this.count > 0) this.kill(this.act[0]); this.head = 0; this.update(0); };

  var P = null, oil = [], oilHead = 0, OIL_N = 14, OIL_LIFE = 45;
  // pools: glow (unlit fire/flash/sparks), solid (lit splash/debris), smoke (lit puffs), flat (wake foam on water)

  function init() {
    if (!WW.scene) return;
    if (P) { addAll(); return; }
    _m = new THREE.Matrix4(); _q = new THREE.Quaternion(); _e = new THREE.Euler(); _p = new THREE.Vector3();
    _s = new THREE.Vector3(); _c = new THREE.Color();
    var cube = new THREE.BoxGeometry(1, 1, 1);
    var flatGeo = new THREE.BoxGeometry(1, 0.02, 1);
    P = {
      glow: new Pool(700, cube, new THREE.MeshBasicMaterial({ color: 0xffffff })),
      solid: new Pool(500, cube, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })),
      smoke: new Pool(700, cube, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })),
      flat: new Pool(900, flatGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }))
    };
    P.flat.flat = true;
    P.flat.mesh.renderOrder = 3; // draw after the water (renderOrder 1) so foam is not hidden by waves
    var og = new THREE.CircleGeometry(1, 8); og.rotateX(-Math.PI / 2);
    for (var i = 0; i < OIL_N; i++) {
      var mm = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: 0x15140f, transparent: true, opacity: 0.7, depthWrite: false }));
      mm.visible = false; mm.renderOrder = 2;
      oil.push({ mesh: mm, age: 0, size: 1, alive: false });
    }
    addAll();
  }
  function addAll() {
    for (var k in P) if (P[k].mesh.parent !== WW.scene) WW.scene.add(P[k].mesh);
    oil.forEach(function (o) { if (o.mesh.parent !== WW.scene) WW.scene.add(o.mesh); });
  }

  // ---- effect recipes ----
  var W = 0xffffff;
  function splash(x, z, size) {
    if (!P) return; size = Math.max(0.3, size || 1);
    var n = Math.min(22, 4 + Math.round(size * 4)), up = 3.5 * Math.sqrt(size) + 2;
    for (var i = 0; i < n; i++) {
      var a = R() * 6.28, r = R() * 0.25 * size, out = rr(0.2, 1.2) * Math.sqrt(size);
      P.solid.spawn(x + Math.cos(a) * r, 0.1, z + Math.sin(a) * r, Math.cos(a) * out, up * rr(0.6, 1.25), Math.sin(a) * out,
        rr(0.9, 1.5) * Math.sqrt(size * 0.6 + 0.4), 0.22 * size + 0.2, 0.32 * size + 0.15, col(W), col(0xbcd8e0), 9, 0.5, rr(-2, 2), true);
    }
    for (var j = 0; j < 4; j++) {
      var b = R() * 6.28;
      P.flat.spawn(x + Math.cos(b) * 0.4 * size, 0.07, z + Math.sin(b) * 0.4 * size, Math.cos(b) * size, 0, Math.sin(b) * size,
        1.4, 0.6 * size, 1.6 * size, col(W), col(0x9fc4d0), 0, 1.5, 0);
    }
  }
  function explosion(x, y, z, size) {
    if (!P) return; size = Math.max(0.3, size || 1);
    var n = Math.min(26, 6 + Math.round(size * 5)), f = 0.5 + 0.45 * size;
    for (var i = 0; i < n; i++) {
      var hot = i < n / 3;
      P.glow.spawn(x + rr(-0.5, 0.5) * f, y + rr(0, 0.5) * f, z + rr(-0.5, 0.5) * f,
        rr(-2.5, 2.5) * f, rr(0.5, 3) * f, rr(-2.5, 2.5) * f, rr(0.35, 0.8),
        (hot ? 0.9 : 0.6) * f, (hot ? 1.6 : 1.2) * f, col(hot ? 0xfffbd0 : 0xffd040), col(hot ? 0xff8020 : 0x901808), 0, 3, rr(-3, 3));
    }
    var nd = Math.min(14, 3 + Math.round(size * 2));
    for (var d = 0; d < nd; d++) {
      P.solid.spawn(x, y + 0.3, z, rr(-5, 5) * Math.sqrt(size), rr(4, 10) * Math.sqrt(size), rr(-5, 5) * Math.sqrt(size),
        rr(1, 2), rr(0.18, 0.4) * Math.sqrt(size), 0.15, col(0x2a2622), col(0x111111), 16, 0.2, rr(-8, 8), true);
    }
    for (var s = 0; s < 2 + Math.round(size); s++) smoke(x + rr(-0.5, 0.5) * f, y + 0.5 * f, z + rr(-0.5, 0.5) * f, true, Math.min(size, 2.5) * 0.6);
    sparks(x, y + 0.3, z);
  }
  function muzzleFlash(x, y, z) {
    if (!P) return;
    for (var i = 0; i < 3; i++)
      P.glow.spawn(x + rr(-0.2, 0.2), y + rr(-0.1, 0.2), z + rr(-0.2, 0.2), rr(-1, 1), rr(0, 1), rr(-1, 1),
        rr(0.08, 0.16), rr(0.5, 0.8), 1.0, col(0xfffff0), col(0xffa030), 0, 0, 0);
    P.smoke.spawn(x, y, z, rr(-0.3, 0.3), 0.8, rr(-0.3, 0.3), 1.0, 0.4, 1.0, col(0xb0b0a8), col(0xdcdcd8), 0, 0.5, 0.5);
  }
  function flak(x, y, z) {
    if (!P) return;
    P.glow.spawn(x, y, z, 0, 0, 0, 0.12, 0.5, 0.9, col(0xffe080), col(0xff5010), 0, 0, 0);
    for (var i = 0; i < 4; i++)
      P.smoke.spawn(x + rr(-0.35, 0.35), y + rr(-0.35, 0.35), z + rr(-0.35, 0.35), rr(-0.8, 0.8), rr(-0.3, 0.6), rr(-0.8, 0.8),
        rr(1.0, 1.6), rr(0.35, 0.5), rr(0.9, 1.3), col(0x1c1c1c), col(0x3c3c3c), 0, 2, rr(-1, 1));
  }
  function smoke(x, y, z, dark, size) {
    if (!P) return; size = size || 1;
    P.smoke.spawn(x + rr(-0.15, 0.15), y, z + rr(-0.15, 0.15), rr(-0.3, 0.3) + 0.25, rr(1.0, 1.8), rr(-0.3, 0.3),
      rr(2.4, 3.6), 0.6 * size, rr(1.8, 2.4) * size,
      col(dark ? 0x262626 : 0xbdbdb8), col(dark ? 0x4a4a48 : 0xe6e6e2), -0.15, 0.3, rr(-0.6, 0.6));
  }
  function fire(x, y, z) {
    if (!P || R() > 0.55) return;             // throttle: ships call this every frame
    P.glow.spawn(x + rr(-0.35, 0.35), y + rr(0, 0.2), z + rr(-0.35, 0.35), rr(-0.3, 0.3), rr(1.5, 2.8), rr(-0.3, 0.3),
      rr(0.25, 0.45), rr(0.45, 0.7), 0.15, col(R() < 0.5 ? 0xffe060 : 0xffa030), col(0xc01800), 0, 0.5, rr(-4, 4));
  }
  function wake(x, z, heading, size) {
    if (!P) return; size = size || 1;
    var i = P.flat.spawn(x + rr(-0.15, 0.15) * size, 0.3, z + rr(-0.15, 0.15) * size, 0, 0, 0,
      rr(1.2, 1.8), 0.5 * size, 1.5 * size, col(W), col(0x9fc4d0), 0, 0, 0);
    P.flat.ey[i] = -(heading || 0);
  }
  function oilSlick(x, z, size) {
    if (!P) return;
    var o = oil[oilHead]; oilHead = (oilHead + 1) % OIL_N;
    o.alive = true; o.age = 0; o.size = Math.max(1, size || 4);
    o.mesh.position.set(x, 0.3, z); o.mesh.rotation.y = R() * 6.28;
    o.mesh.scale.set(o.size * 0.3, 1, o.size * 0.25); o.mesh.material.opacity = 0.5; o.mesh.visible = true;
  }
  function sparks(x, y, z) {
    if (!P) return;
    var n = 6 + (R() * 5 | 0);
    for (var i = 0; i < n; i++)
      P.glow.spawn(x, y, z, rr(-6, 6), rr(2, 8), rr(-6, 6), rr(0.25, 0.6), 0.16, 0.1, col(0xffffa0), col(0xff6000), 14, 0.5, rr(-10, 10), true);
  }

  function update(dt) {
    if (!P || !(dt > 0)) return;
    for (var k in P) P[k].update(dt);
    for (var i = 0; i < OIL_N; i++) {
      var o = oil[i]; if (!o.alive) continue;
      o.age += dt;
      if (o.age >= OIL_LIFE) { o.alive = false; o.mesh.visible = false; continue; }
      var t = o.age / OIL_LIFE, g = Math.min(1, o.age / 6);
      o.mesh.scale.set(o.size * (0.3 + 0.5 * g + 0.2 * t), 1, o.size * (0.25 + 0.4 * g + 0.2 * t));
      o.mesh.material.opacity = t < 0.4 ? 0.5 : 0.5 * (1 - t) / 0.6; // see-through, so wrecks still show
    }
  }
  function clearAll() {
    if (!P) return;
    for (var k in P) P[k].clear();
    oil.forEach(function (o) { o.alive = false; o.mesh.visible = false; });
  }

  WW.fx = {
    init: init, update: update, clearAll: clearAll,
    splash: splash, explosion: explosion, muzzleFlash: muzzleFlash, flak: flak, smoke: smoke,
    fire: fire, wake: wake, oilSlick: oilSlick, sparks: sparks,
    _stats: function () { var o = {}; for (var k in P) o[k] = P[k].count; return o; }
  };
})();
