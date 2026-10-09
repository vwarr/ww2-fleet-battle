// effects.js (owner B) - pooled soft cartoon effects.
// Lit puffs: round toon-shaded icosahedra in InstancedMeshes that grow, billow and shrink away.
// Glows / foam: additive soft round sprites (one shared radial-gradient CanvasTexture) that fade via colour.
// One draw call per pool; live instances are packed densely and mesh.count = live count.
// Uses Math.random (not WW.rand) so visual effects never change the sim's random sequence.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  var _m, _q, _q2, _e, _p, _s, _c, _z;
  var PAL = {};
  // golden-hour palette: every effect colour is desaturated ~20% (cached, so no per-spawn allocation)
  function col(hex) {
    var c = PAL[hex];
    if (!c) { c = PAL[hex] = new THREE.Color(hex); var l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114; c.r += (l - c.r) * 0.2; c.g += (l - c.g) * 0.2; c.b += (l - c.b) * 0.2; }
    return c;
  }

  var FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'g', 'drag', 'ex', 'ey', 'spin',
    'r0', 'g0', 'b0', 'r1', 'g1', 'b1'];
  // mode: 'puff' (lit/opaque: ease-out growth, smooth shrink at end), 'glow' (additive billboard, colour fades to black),
  //       'flat' (normal-blended white foam lying on the water; instance colour R = alpha, see alphaMat)
  function Pool(n, geo, mtl, mode) {
    this.n = n; this.mode = mode;
    var m = this.mesh = new THREE.InstancedMesh(geo, mtl, n);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (var k = 0; k < FIELDS.length; k++) this[FIELDS[k]] = new Float32Array(n);
    this.floor = new Uint8Array(n); this.alive = new Uint8Array(n);
    this.act = new Int32Array(n); this.slot = new Int32Array(n);
    this.count = 0; this.head = 0;
    _c.setRGB(1, 1, 1);
    for (var i = 0; i < n; i++) m.setColorAt(i, _c);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
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
    this.ex[i] = R() * 6.28; this.ey[i] = R() * 6.28;
    this.floor[i] = floor ? 1 : 0;
    return i;
  };
  Pool.prototype.kill = function (i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    var k = this.slot[i], last = this.act[--this.count];
    this.act[k] = last; this.slot[last] = k;
  };
  Pool.prototype.update = function (dt) {
    var k, i;
    for (k = this.count - 1; k >= 0; k--) {           // simulate
      i = this.act[k];
      var a = (this.age[i] += dt);
      if (a >= this.life[i]) { this.kill(i); continue; }
      var d = 1 - Math.min(1, this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d; this.vy[i] = this.vy[i] * d - this.g[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.floor[i] && this.py[i] < -0.3) this.kill(i);
    }
    var m = this.mesh, mode = this.mode, cam = WW.camera;
    if (mode === 'glow') { if (cam) cam.getWorldQuaternion(_q2); else _q2.identity(); }
    for (k = 0; k < this.count; k++) {               // write live instances densely
      i = this.act[k];
      var t = this.age[i] / this.life[i], e = 1 - (1 - t) * (1 - t) * (1 - t), s = this.s0[i] + (this.s1[i] - this.s0[i]) * e, b = 1;
      var sp = this.spin[i] * this.age[i];
      if (mode === 'puff') {
        if (t > 0.55) { var x = (t - 0.55) / 0.45; s *= 1 - x * x * (3 - 2 * x); }
        _q.setFromEuler(_e.set(this.ex[i] + sp, this.ey[i] + sp * 0.7, 0));
        _s.set(s, s, s);
      } else if (mode === 'glow') {
        b = Math.min(1, t * 6) * (1 - t) * (1 - t);
        _q.setFromAxisAngle(_z, this.ey[i] + sp).premultiply(_q2);
        _s.set(s, s, s);
      } else {                                        // flat
        b = Math.min(1, t * 6) * (1 - t) * this.r0[i];
        _q.setFromAxisAngle(_z.set(0, 1, 0), this.ey[i]); _z.set(0, 0, 1);
        _s.set(s * (this.ex[i] > 3.14 ? 1.25 : 1), 1, s);
      }
      _m.compose(_p.set(this.px[i], this.py[i], this.pz[i]), _q, _s);
      m.setMatrixAt(k, _m);
      if (mode === 'flat') _c.setRGB(b, b, b); else _c.setRGB((this.r0[i] + (this.r1[i] - this.r0[i]) * t) * b, (this.g0[i] + (this.g1[i] - this.g0[i]) * t) * b,
        (this.b0[i] + (this.b1[i] - this.b0[i]) * t) * b);
      m.setColorAt(k, _c);
    }
    m.count = this.count;
    if (this.count) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  };
  Pool.prototype.clear = function () { while (this.count > 0) this.kill(this.act[0]); this.head = 0; this.mesh.count = 0; };

  var P = null, oil = [], oilHead = 0, OIL_N = 14, OIL_LIFE = 45, TEX = null;

  // soft round sprite: white, alpha falls off radially
  function softTex() {
    if (TEX) return TEX;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    TEX = new THREE.CanvasTexture(c);
    return TEX;
  }
  // puffs get their own slightly rounder 4-step ramp so they read as 3D cotton balls under the strong sky fill
  function toonGrad() {
    var t = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255, 172, 172, 172, 255, 204, 204, 204, 255, 234, 234, 234, 255]), 4, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
  }
  // toon-lit puff whose emissive glow scales with the instance colour (fire/explosion cores: shaded yet glowing)
  function glowPuffMat(tg) {
    var m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: tg, emissive: 0x2c2c2c });
    m.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive;\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor;\n#endif');
    };
    return m;
  }

  function init() {
    if (!WW.scene) return;
    if (P) { addAll(); return; }
    _m = new THREE.Matrix4(); _q = new THREE.Quaternion(); _q2 = new THREE.Quaternion(); _e = new THREE.Euler();
    _p = new THREE.Vector3(); _s = new THREE.Vector3(); _c = new THREE.Color(); _z = new THREE.Vector3(0, 0, 1);
    var ball = new THREE.IcosahedronGeometry(0.5, 2), pa = ball.attributes.position, na = ball.attributes.normal, v = new THREE.Vector3();
    for (var j = 0; j < pa.count; j++) { v.fromBufferAttribute(pa, j).normalize(); na.setXYZ(j, v.x, v.y, v.z); } // smooth normals
    var quad = new THREE.PlaneGeometry(1, 1), flatQ = new THREE.PlaneGeometry(1, 1); flatQ.rotateX(-Math.PI / 2);
    var tg = toonGrad(), tex = softTex();
    function addMat() {
      return new THREE.MeshBasicMaterial({ color: 0xffffff, map: tex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false });
    }
    // white foam whose per-instance alpha comes from the instance colour's red channel
    var foamMat = new THREE.MeshBasicMaterial({ color: 0xece6dc, map: tex, transparent: true, depthWrite: false });
    foamMat.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#ifdef USE_COLOR\n diffuseColor.a *= vColor.r;\n#endif');
    };
    P = {
      glow: new Pool(600, ball, glowPuffMat(tg), 'puff'),                                        // fire/flash cores (lit + glow)
      solid: new Pool(500, ball, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: tg }), 'puff'),   // splash/debris
      smoke: new Pool(900, ball, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: tg }), 'puff'),
      halo: new Pool(400, quad, addMat(), 'glow'),                                                 // soft light glows, sparks
      flat: new Pool(900, flatQ, foamMat, 'flat')                                                  // foam on the water
    };
    P.halo.mesh.renderOrder = 4;
    P.flat.mesh.renderOrder = 3; // draw after the water (renderOrder 1) so foam is not hidden by waves
    var og = new THREE.PlaneGeometry(2, 2); og.rotateX(-Math.PI / 2);
    for (var i = 0; i < OIL_N; i++) {
      var mm = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: 0x3a4a48, map: tex, transparent: true, opacity: 0.28, depthWrite: false }));
      mm.visible = false; mm.renderOrder = 2;
      oil.push({ mesh: mm, age: 0, size: 1, alive: false });
    }
    addAll();
  }
  function addAll() {
    for (var k in P) if (P[k].mesh.parent !== WW.scene) WW.scene.add(P[k].mesh);
    oil.forEach(function (o) { if (o.mesh.parent !== WW.scene) WW.scene.add(o.mesh); });
  }

  // drift: WW.wind ({x, z}, set per round by WW.damage) when defined
  function windX() { return WW.wind ? WW.wind.x : 0.3; }
  function windZ() { return WW.wind ? WW.wind.z : 0; }

  // ---- effect recipes ----
  var W = 0xf2ece2, FOAM_A = 0xd0d0d0, WAKE_A = 0xc4c4c4, WAKE_F = 0x707070; // foam colours are peak alpha (grey level)
  function splash(x, z, size) {
    if (!P) return; size = Math.max(0.3, size || 1);
    var sq = Math.sqrt(size), n = Math.min(14, 4 + Math.round(size * 2.5)), up = 2.6 * sq + 1.6;
    for (var i = 0; i < n; i++) {                       // puffy white column
      var a = R() * 6.28, r = R() * 0.22 * size, out = rr(0.1, 0.7) * sq, f = i / n;
      P.solid.spawn(x + Math.cos(a) * r, 0.1 + f * 0.4 * size, z + Math.sin(a) * r, Math.cos(a) * out, up * (0.45 + 0.75 * f) * rr(0.85, 1.1), Math.sin(a) * out,
        rr(1.4, 2.0) * Math.sqrt(size * 0.6 + 0.4), (0.3 + 0.25 * (1 - f)) * size + 0.2, (0.55 + 0.35 * (1 - f)) * size + 0.3,
        col(W), col(0xdfe6e4), 4.5, 0.9, rr(-0.6, 0.6), true);
    }
    for (var d = 0; d < 2 + (size * 0.5 | 0); d++) {          // little droplet puffs
      var b = R() * 6.28, o = rr(1.5, 3) * sq;
      P.solid.spawn(x, 0.3, z, Math.cos(b) * o, up * rr(0.5, 0.9), Math.sin(b) * o, rr(0.7, 1.1), 0.25 * sq, 0.18 * sq,
        col(W), col(0xdfe6e4), 12, 0.2, 0, true);
    }
    for (var j = 0; j < 5; j++) {                        // foam ring
      var c = R() * 6.28;
      P.flat.spawn(x + Math.cos(c) * 0.3 * size, 0.08, z + Math.sin(c) * 0.3 * size, Math.cos(c) * size * 0.9, 0, Math.sin(c) * size * 0.9,
        rr(1.4, 2.0), 0.8 * size, 2.4 * size, col(FOAM_A), col(FOAM_A), 0, 1.4, 0);
    }
  }
  function explosion(x, y, z, size) {
    if (!P) return; size = Math.max(0.3, size || 1);
    var n = Math.min(14, 4 + Math.round(size * 2.5)), f = 0.5 + 0.45 * size;
    P.halo.spawn(x, y + 0.5 * f, z, 0, 0.4, 0, 0.6, 1.1 * f, 2.2 * f, col(0x7a5434), col(0x5a2c14), 0, 0, 0);
    for (var i = 0; i < n; i++) {                       // warm fireball puffs
      var hot = i < n / 2;
      P.glow.spawn(x + rr(-0.5, 0.5) * f, y + rr(0, 0.6) * f, z + rr(-0.5, 0.5) * f,
        rr(-1.2, 1.2) * f, rr(0.6, 1.8) * f, rr(-1.2, 1.2) * f, rr(0.6, 1.1),
        (hot ? 0.6 : 0.45) * f, (hot ? 1.3 : 1.05) * f, col(hot ? 0xe8b070 : 0xe09058), col(hot ? 0xd07040 : 0xb85838), -0.4, 2.2, rr(-1, 1));
    }
    var nd = Math.min(6, 1 + Math.round(size));
    for (var d = 0; d < nd; d++) {                      // chunky debris bits
      P.solid.spawn(x, y + 0.3, z, rr(-4, 4) * Math.sqrt(size), rr(4, 9) * Math.sqrt(size), rr(-4, 4) * Math.sqrt(size),
        rr(1, 1.8), rr(0.12, 0.22) * Math.sqrt(size), 0.12, col(0x6a5a50), col(0x7a6a60), 16, 0.2, rr(-6, 6), true);
    }
    for (var s = 0; s < 2 + Math.round(size); s++)
      P.smoke.spawn(x + rr(-0.6, 0.6) * f, y + rr(0.3, 1) * f, z + rr(-0.6, 0.6) * f, rr(-0.5, 0.5) + windX(), rr(1.2, 2.2), rr(-0.5, 0.5) + windZ(),
        rr(3.0, 4.2), 0.6 * f, rr(1.3, 1.8) * f, col(0x6a6560), col(0xd6d2cc), -0.1, 0.6, rr(-0.4, 0.4));
    sparks(x, y + 0.3, z);
  }
  // A torpedo hit against a hull (damage.js): a pale flash and a bubble bloom under the water, then a tall white column
  // bursting up the ship's side (thrown out along nx, nz, the hull's outward normal), spray falling back, and a foam
  // slick that lingers on the water. No fireball: the warhead goes off below the waterline. size ~1 (a destroyer's
  // side) .. 1.6 (a battleship's); big: x1.25 for a Long Lance.
  function torpedoHit(x, z, nx, nz, size) {
    if (!P) return; size = Math.max(0.6, size || 1);
    var sq = Math.sqrt(size), cx = x + nx * 0.8 * size, cz = z + nz * 0.8 * size;
    P.halo.spawn(cx, -0.25, cz, 0, 0.2, 0, 0.35, 2.4 * size, 5.5 * size, col(0x8aa69a), col(0x2a3a34), 0, 0, 0);   // flash under the water
    P.halo.spawn(cx, 0.4, cz, 0, 0.5, 0, 0.25, 1.4 * size, 3.2 * size, col(0x9a8a70), col(0x3a2a1a), 0, 0, 0);
    for (var b = 0; b < 10; b++) {                       // the bubble bloom: a ring of foam boiling outward from the hull
      var a = R() * 6.28, o = rr(1.5, 3.5) * size;
      P.flat.spawn(cx, 0.1, cz, Math.cos(a) * o + nx * 1.5 * size, 0, Math.sin(a) * o + nz * 1.5 * size, rr(2.5, 3.5), 1.2 * size, 4.5 * size, col(0xe0e0e0), col(0xe0e0e0), 0, 0.9, 0);
    }
    var n = 20, up = 6.5 * sq + 3;                       // the column: tall and narrow, thrown up and out along the side
    for (var i = 0; i < n; i++) {
      var f = i / n, r = R() * 0.4 * size, aa = R() * 6.28, out = rr(0.3, 1.1) * sq;
      P.solid.spawn(cx + Math.cos(aa) * r, 0.2 + f * 0.8 * size, cz + Math.sin(aa) * r, nx * out + Math.cos(aa) * 0.3, up * (0.45 + 0.65 * f) * rr(0.9, 1.1), nz * out + Math.sin(aa) * 0.3,
        rr(2.6, 3.4) * sq, (0.3 + 0.25 * (1 - f)) * size + 0.25, (0.75 + 0.5 * (1 - f)) * size + 0.3, col(W), col(0xdfe6e4), 3.6, 0.35, rr(-0.6, 0.6), true);
    }
    for (var d = 0; d < 8; d++) {                        // spray falling back
      var e = R() * 6.28, v = rr(2, 4.5) * sq;
      P.solid.spawn(cx, 1 + R() * 2 * size, cz, Math.cos(e) * v + nx * 2, up * rr(0.6, 1.0), Math.sin(e) * v + nz * 2, rr(1.2, 1.8), 0.35 * sq, 0.22 * sq,
        col(W), col(0xdfe6e4), 9, 0.15, 0, true);
    }
    for (var k = 0; k < 6; k++) {                        // the slick: foam lying on the water for a while
      var c = R() * 6.28, q = rr(0, 2.5) * size;
      P.flat.spawn(cx + Math.cos(c) * q, 0.09, cz + Math.sin(c) * q, Math.cos(c) * 0.3, 0, Math.sin(c) * 0.3, rr(9, 13), 2.2 * size, 5 * size, col(0xb8b8b8), col(0xb8b8b8), 0, 0.5, 0);
    }
    P.smoke.spawn(cx, 1.5 * size, cz, windX() * 0.5, 1.2, windZ() * 0.5, 4, 0.8 * size, 2.2 * size, col(0x7a7570), col(0xd6d2cc), -0.1, 0.5, 0.2);   // a little dirty smoke from the hole
  }
  function muzzleFlash(x, y, z) {
    if (!P) return;
    P.halo.spawn(x, y, z, 0, 0, 0, 0.14, 0.8, 1.4, col(0x9a6e48), col(0x6a3a20), 0, 0, 0);
    P.glow.spawn(x, y, z, rr(-0.3, 0.3), 0.3, rr(-0.3, 0.3), 0.14, 0.3, 0.5, col(0xe8c090), col(0xd08048), 0, 0, 0);
    P.smoke.spawn(x, y, z, rr(-0.3, 0.3), 0.8, rr(-0.3, 0.3), 1.1, 0.35, 1.0, col(0xc8c6c0), col(0xe6e4e0), 0, 0.5, 0.5);
  }
  function flak(x, y, z) {
    if (!P) return;
    P.halo.spawn(x, y, z, 0, 0, 0, 0.16, 0.4, 0.8, col(0x6a4a30), col(0x402010), 0, 0, 0);
    for (var i = 0; i < 3; i++)
      P.smoke.spawn(x + rr(-0.3, 0.3), y + rr(-0.3, 0.3), z + rr(-0.3, 0.3), rr(-0.6, 0.6), rr(-0.2, 0.5), rr(-0.6, 0.6),
        rr(1.2, 1.8), rr(0.3, 0.45), rr(0.9, 1.3), col(0x5c5c62), col(0x9a9aa0), 0, 2, rr(-1, 1));
  }
  function smoke(x, y, z, dark, size) {
    if (!P) return; size = size || 1;
    var k = rr(0.7, 1.25) * size;                       // varied puff sizes: reads as separate cotton balls
    P.smoke.spawn(x + rr(-0.3, 0.3), y, z + rr(-0.3, 0.3), rr(-0.5, 0.5) + windX(), rr(1.1, 2.0), rr(-0.5, 0.5) + windZ(),
      rr(2.6, 3.8), 0.5 * k, rr(1.2, 1.6) * k,
      col(dark ? (R() < 0.45 ? 0x55514e : 0x6e6964) : 0xd4d0c8), col(dark ? 0xc4bfb8 : 0xe8e2d8), -0.25, 0.25, rr(-0.5, 0.5));
  }
  // plane smoke trail: one puff that starts near full size so neighbours overlap into a continuous trail
  function trail(x, y, z, dark, size, life) {
    if (!P) return; size = size || 0.5;
    P.smoke.spawn(x, y, z, rr(-0.1, 0.1) + windX() * 0.5, 0.3, rr(-0.1, 0.1) + windZ() * 0.5,
      life || 1.3, 0.85 * size, size, col(dark ? 0x4a4744 : 0x8a8680), col(dark ? 0x9a958e : 0xb8b3ab), 0, 0.3, rr(-0.4, 0.4));
  }
  function fire(x, y, z) {
    if (!P || R() > 0.55) return;             // throttle: ships call this every frame
    P.glow.spawn(x + rr(-0.35, 0.35), y + rr(0, 0.2), z + rr(-0.35, 0.35), rr(-0.3, 0.3) + windX() * 0.5, rr(1.4, 2.6), rr(-0.3, 0.3) + windZ() * 0.5,
      rr(0.5, 0.85), rr(0.55, 0.8), rr(1.0, 1.4), col(R() < 0.5 ? 0xe8b458 : 0xe09040), col(0xc04428), -0.6, 0.8, rr(-3, 3));
    if (R() < 0.3) P.halo.spawn(x, y + 0.5, z, 0, 1, 0, 0.45, 1.4, 2.0, col(0x7a4a28), col(0x502810), 0, 0, 0);
  }
  function wake(x, z, heading, size, faint) { // faint: a barely-there trace (an oxygen torpedo's track)
    if (!P) return; size = size || 1;
    var wc = col(faint ? WAKE_F : WAKE_A);
    var i = P.flat.spawn(x + rr(-0.15, 0.15) * size, 0.3, z + rr(-0.15, 0.15) * size, 0, 0, 0,
      rr(1.4, 2.0), 0.7 * size, 2.0 * size, wc, wc, 0, 0, 0);
    P.flat.ey[i] = -(heading || 0); P.flat.ex[i] = 6; // ex > PI: stretch along heading
  }
  // A steam torpedo's track: exhaust bubbles boiling up in a white streak behind it (combat_weapons.js updateTorp)
  function torpBubbles(x, z, heading) {
    if (!P) return;
    var c = Math.cos(heading || 0), s = Math.sin(heading || 0);
    for (var k = 0; k < 2; k++) {
      var b = -rr(0.5, 3), l = rr(-0.5, 0.5);
      P.flat.spawn(x + c * b - s * l, 0.31, z + s * b + c * l, 0, 0, 0, rr(2.2, 3.4), rr(0.25, 0.4), rr(0.9, 1.4), col(FOAM_A), col(WAKE_A), 0, 0, 0);
    }
  }
  function oilSlick(x, z, size) {
    if (!P) return;
    var o = oil[oilHead]; oilHead = (oilHead + 1) % OIL_N;
    o.alive = true; o.age = 0; o.size = Math.max(1, size || 4);
    o.mesh.position.set(x, 0.3, z); o.mesh.rotation.y = R() * 6.28;
    o.mesh.scale.set(o.size * 0.12, 1, o.size * 0.1); o.mesh.material.opacity = 0.28; o.mesh.visible = true;
  }
  function sparks(x, y, z) {
    if (!P) return;
    if (R() < 0.5) return;                    // planes call this repeatedly while being hit
    var n = 1 + (R() * 2 | 0);
    for (var i = 0; i < n; i++)
      P.halo.spawn(x, y, z, rr(-3, 3), rr(1.5, 4), rr(-3, 3), rr(0.25, 0.4), 0.3, 0.15, col(0x6a5034), col(0x3a2414), 9, 0.8, 0, true);
  }

  function update(dt) {
    if (!P || !(dt > 0)) return;
    for (var k in P) P[k].update(dt);
    for (var i = 0; i < OIL_N; i++) {
      var o = oil[i]; if (!o.alive) continue;
      o.age += dt;
      if (o.age >= OIL_LIFE) { o.alive = false; o.mesh.visible = false; continue; }
      var t = o.age / OIL_LIFE, g = Math.min(1, o.age / 6);
      o.mesh.scale.set(o.size * (0.12 + 0.22 * g + 0.1 * t), 1, o.size * (0.1 + 0.18 * g + 0.08 * t));
      o.mesh.material.opacity = t < 0.4 ? 0.28 : 0.28 * (1 - t) / 0.6; // see-through, so wrecks still show
    }
  }
  function clearAll() {
    if (!P) return;
    for (var k in P) P[k].clear();
    oil.forEach(function (o) { o.alive = false; o.mesh.visible = false; });
  }

  WW.fx = {
    init: init, update: update, clearAll: clearAll,
    splash: splash, explosion: explosion, torpedoHit: torpedoHit, muzzleFlash: muzzleFlash, flak: flak, smoke: smoke,
    fire: fire, wake: wake, torpBubbles: torpBubbles, oilSlick: oilSlick, sparks: sparks, trail: trail,
    _stats: function () { var o = {}; for (var k in P) o[k] = P[k].count; return o; }
  };
})();
