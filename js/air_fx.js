// air_fx.js (planes look) - small per-plane visual effects, all pooled, 3 draw calls in total:
//   wing-tip vapour streaks in hard turns / pull-outs (camera-facing ribbons, one shared mesh),
//   flickering exhaust glow at the cowling, and a brief canopy glint when a banked canopy mirrors the sun.
// Also drives the prop disc/blades and the dive brakes from Plane.sync (WW.airFx.sync).
// Visual only: Math.random, never WW.rand. Hooks: WW.air.init / update / clearAll and Plane.sync.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  var RIB = 28, K = 18, KV = K + 1;        // ribbons, committed points per ribbon (+1 live head at the tip)
  var PK = WW.cfg.PLANE_K || 1;            // plane size vs the 1.7 tuning scale: streak width, exhaust and glint sizes follow it
  var LIFE = 0.55, SEG = 0.7;              // vapour life (sim s), spacing between committed points (units)
  var MAXP = 192;                          // exhaust points (2 per plane, planes within EXH_D of the camera)
  var EXH_D = 160, VAP_D = 220;            // beyond these camera distances a plane gets no exhaust glow / no vapour (sub-pixel)
  var MAXG = 48;                           // glints
  var ribbons = [], rMesh = null, rPos, rAlpha, ex = null, gl = null, inited = false, stepN = 0;
  var _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _cam = new THREE.Vector3();
  var _n = new THREE.Vector3(), _h = new THREE.Vector3();

  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function tex(star) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, star ? 14 : 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    if (star) { // thin 4-point sparkle
      x.globalCompositeOperation = 'lighter';
      [[64, 3], [3, 64]].forEach(function (s) {
        var lg = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        lg.addColorStop(0, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = lg; x.fillRect(32 - s[0] / 2, 32 - s[1] / 2, s[0], s[1]);
      });
    }
    return new THREE.CanvasTexture(c);
  }
  // additive points with per-point world size and colour
  function points(n, map) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    var m = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 500 } },
      vertexShader: 'attribute float size; attribute vec3 tint; varying vec3 vT; uniform float scale;' +
        'void main(){ vT = tint; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vT; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vT * a, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 6; p.n = 0;
    return p;
  }
  function init() {
    if (!WW.scene) return;
    if (!inited) {
      inited = true;
      var nv = RIB * KV * 2, g = new THREE.BufferGeometry(), idx = [], side = new Float32Array(nv);
      rPos = new Float32Array(nv * 3); rAlpha = new Float32Array(nv);
      for (var r = 0; r < RIB; r++) {
        for (var k = 0; k < KV; k++) { var v = (r * KV + k) * 2; side[v] = -1; side[v + 1] = 1; }
        for (k = 0; k < KV - 1; k++) { var a = (r * KV + k) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        ribbons.push({ pts: new Float32Array(K * 5), n: 0, owner: null, seen: 0, head: false, hx: 0, hy: 0, hz: 0, hi: 0 });
      }
      g.setAttribute('position', new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('alpha', new THREE.BufferAttribute(rAlpha, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('side', new THREE.BufferAttribute(side, 1));
      g.setIndex(idx);
      rMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
        vertexShader: 'attribute float alpha; attribute float side; varying float vA; varying float vS;' +
          'void main(){ vA = alpha; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying float vA; varying float vS; void main(){ float e = 1.0 - vS * vS; gl_FragColor = vec4(0.96, 0.97, 1.0, vA * e); }',
        transparent: true, depthWrite: false, side: THREE.DoubleSide
      }));
      rMesh.frustumCulled = false; rMesh.renderOrder = 5;
      ex = points(MAXP, tex(false)); gl = points(MAXG, tex(true));
    }
    [rMesh, ex, gl].forEach(function (o) { if (o.parent !== WW.scene) WW.scene.add(o); });
  }

  // ---- vapour ribbons ----
  function grab(owner) {
    var best = -1, bt = 1e9;
    for (var i = 0; i < RIB; i++) {
      var r = ribbons[i];
      if (r.owner) continue;
      var t = r.n ? r.pts[3] : -1e9;                // oldest tail first (empty ribbons win)
      if (t < bt) { bt = t; best = i; }
    }
    if (best < 0) return null;
    var rb = ribbons[best]; rb.owner = owner; rb.n = 0; rb.head = false;
    return rb;
  }
  function push(rb, x, y, z, now, inten) {
    var p = rb.pts, n = rb.n;
    if (n) { var o = (n - 1) * 5, dx = x - p[o], dy = y - p[o + 1], dz = z - p[o + 2], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 900) { rb.n = n = 0; }                          // jumped (new sortie / fast-forward): restart
      else if (d2 < SEG * SEG) { rb.head = true; rb.hx = x; rb.hy = y; rb.hz = z; rb.hi = inten; return; } }
    if (n === K) { p.copyWithin(0, 5); n = K - 1; }
    var q = n * 5; p[q] = x; p[q + 1] = y; p[q + 2] = z; p[q + 3] = now; p[q + 4] = inten;
    rb.n = n + 1; rb.head = false;
  }
  function tipWorld(m, wing, local, out) {
    if (!wing || wing.parent !== m.group || !local) return null;
    return out.copy(local).applyMatrix4(wing.matrixWorld);
  }
  function drawRibbons(now) {
    _cam.copy(WW.camera ? WW.camera.position : _cam);
    for (var r = 0; r < RIB; r++) {
      var rb = ribbons[r], p = rb.pts, base = r * KV * 2;
      while (rb.n && now - p[3] > LIFE) { p.copyWithin(0, 5); rb.n--; }   // expire from the tail
      var cnt = rb.n + (rb.head && rb.n ? 1 : 0);
      for (var k = 0; k < KV; k++) {
        var v = base + k * 2, i3 = v * 3, kk = Math.min(k, cnt - 1);
        if (cnt < 2) { rAlpha[v] = rAlpha[v + 1] = 0; rPos[i3] = rPos[i3 + 3] = 0; rPos[i3 + 1] = rPos[i3 + 4] = -50; rPos[i3 + 2] = rPos[i3 + 5] = 0; continue; }
        var isHead = rb.head && kk === rb.n;
        if (isHead) _a.set(rb.hx, rb.hy, rb.hz); else _a.set(p[kk * 5], p[kk * 5 + 1], p[kk * 5 + 2]);
        // tangent from neighbours
        var k0 = Math.max(0, kk - 1), k1 = Math.min(cnt - 1, kk + 1);
        if (k1 === rb.n && rb.head) _t.set(rb.hx, rb.hy, rb.hz); else _t.set(p[k1 * 5], p[k1 * 5 + 1], p[k1 * 5 + 2]);
        _t.sub(_b.set(p[k0 * 5], p[k0 * 5 + 1], p[k0 * 5 + 2]));
        var age = isHead ? 0 : (now - p[kk * 5 + 3]) / LIFE, inten = isHead ? rb.hi : p[kk * 5 + 4];
        var w = (0.05 + 0.2 * age) * PK;
        _v.subVectors(_cam, _a).cross(_t); var l = _v.length() || 1; _v.multiplyScalar(w / l);
        var al = k >= cnt ? 0 : inten * Math.pow(1 - Math.min(1, age), 1.6) * Math.min(1, (cnt - 1 - kk) * 0.5 + 0.0) * 0.6;
        if (kk === cnt - 1) al = 0;                                   // fade in from the tip
        rPos[i3] = _a.x - _v.x; rPos[i3 + 1] = _a.y - _v.y; rPos[i3 + 2] = _a.z - _v.z;
        rPos[i3 + 3] = _a.x + _v.x; rPos[i3 + 4] = _a.y + _v.y; rPos[i3 + 5] = _a.z + _v.z;
        rAlpha[v] = rAlpha[v + 1] = al;
      }
    }
    var g = rMesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
  }

  function addPt(P, x, y, z, s, r, g, b) {
    if (P.n >= P.geometry.attributes.size.count) return;
    var i = P.n++, a = P.geometry.attributes;
    a.position.array[i * 3] = x; a.position.array[i * 3 + 1] = y; a.position.array[i * 3 + 2] = z;
    a.size.array[i] = s; a.tint.array[i * 3] = r; a.tint.array[i * 3 + 1] = g; a.tint.array[i * 3 + 2] = b;
  }
  function flush(P) {
    var a = P.geometry.attributes; a.position.needsUpdate = a.size.needsUpdate = a.tint.needsUpdate = true;
    P.geometry.setDrawRange(0, P.n);
  }

  function update(dt) {
    if (!inited) init();
    if (!inited || !WW.world) return;
    stepN++;
    var now = WW.time.now, cam = WW.camera, sun = WW.sky && WW.sky.SUN_DIR;
    if (cam) {
      var h = WW.renderer ? WW.renderer.getContext().drawingBufferHeight : 900;
      ex.material.uniforms.scale.value = gl.material.uniforms.scale.value = h * 0.5 / Math.tan(cam.fov * Math.PI / 360);
    }
    ex.n = 0; gl.n = 0;
    var planes = WW.world.planes;
    for (var i = 0; i < planes.length; i++) {
      var p = planes[i], m = p.model;
      if (p.removed || !m || !m.fx) continue;
      var grp = p.group, f = m.fx, live = p.state !== 'ditch';
      // distance culling: far planes skip the exhaust and vapour, and the matrix update when nothing needs it
      var cx = cam ? cam.position.x - p.x : 0, cy = cam ? cam.position.y - p.y : 0, cz = cam ? cam.position.z - p.z : 0, d2 = cx * cx + cy * cy + cz * cz;
      var nearE = d2 < EXH_D * EXH_D, nearV = d2 < VAP_D * VAP_D;
      var vap = nearV && p.alive && p.speed > 18 ? sstep(34, 62, p.gload || 0) : 0;
      var wantG = cam && sun && p.alive && (Math.abs(p.roll || 0) > 0.3 || (p._glint || 0) > 0);
      if ((live && nearE) || wantG || vap > 0.05) grp.updateMatrixWorld(true);
      // exhaust flicker: tiny warm glow, a little brighter at full power / in a dive
      if (live && nearE) {
        var pw = p.phase === 'dive' || p.speed > p.pt.speed * 1.02 ? 1.3 : 1;
        for (var e = 0; e < 2; e++) {
          _v.copy(f.exh[e]).applyMatrix4(grp.matrixWorld);
          var fl = (0.55 + R() * 0.45) * pw;
          addPt(ex, _v.x, _v.y, _v.z, 0.34 * PK * fl, 0.55 * fl, 0.3 * fl, 0.12 * fl);
        }
      }
      // canopy glint: canopy normal (plane up) along the sun/camera half vector, only while banked
      if (wantG) {
        _a.copy(f.canopy).applyMatrix4(grp.matrixWorld);
        _n.setFromMatrixColumn(grp.matrixWorld, 1).normalize();
        _h.subVectors(cam.position, _a).normalize().add(sun).normalize();
        var want = Math.abs(p.roll || 0) > 0.3 ? sstep(0.965, 0.995, _n.dot(_h)) : 0;
        p._glint = Math.max(want, (p._glint || 0) - dt * 4);
        if (p._glint > 0.02) {
          _b.subVectors(cam.position, _a).normalize().multiplyScalar(0.5).add(_a);
          var gi = p._glint;
          addPt(gl, _b.x, _b.y, _b.z, 2.6 * Math.sqrt(PK) * gi, 1.5 * gi, 1.4 * gi, 1.2 * gi);
        }
      } else p._glint = 0;
      // vapour: lateral + pull-up acceleration (from sync: p.gload, units/s^2), computed above
      if (!p._vap) p._vap = [null, null];
      for (var s = 0; s < 2; s++) {
        var rb = p._vap[s];
        if (rb && rb.owner !== p) rb = p._vap[s] = null;
        var tip = vap > 0.05 ? tipWorld(m, s ? m.wingR : m.wingL, s ? f.tipR : f.tipL, _a) : null;
        if (!tip) { if (rb) { rb.owner = null; p._vap[s] = null; } continue; }
        if (!rb) rb = p._vap[s] = grab(p);
        if (!rb) continue;
        rb.seen = stepN;
        push(rb, tip.x, tip.y, tip.z, now, vap);
      }
    }
    for (var r = 0; r < RIB; r++) if (ribbons[r].owner && ribbons[r].seen !== stepN) ribbons[r].owner = null; // plane gone
    drawRibbons(now);
    flush(ex); flush(gl);
  }

  // per-plane visual state, called from Plane.sync: prop disc vs blades, dive brakes
  function sync(p, dt) {
    var m = p.model;
    if (!m) return;
    var fast = false;
    if (m.disc) {
      fast = p.speed > (m.disc.visible ? 9 : 13) && p.state !== 'rollout';
      if (m.disc.visible !== fast) { m.disc.visible = fast; m.blades.visible = !fast; }
    }
    if (p.prop) p.prop.rotation.x += dt * (fast ? 37 : 5 + p.speed * 1.2);
    var b = m.brakes;
    if (b) {
      var want = p.alive && p.phase === 'dive' ? 1 : 0;
      if (b.open !== want) b.set(dt > 0 ? b.open + Math.max(-dt * 2.2, Math.min(dt * 2.2, want - b.open)) : want);
    }
  }
  function clearAll() {
    for (var r = 0; r < RIB; r++) { ribbons[r].owner = null; ribbons[r].n = 0; ribbons[r].head = false; }
    if (ex) { ex.n = 0; flush(ex); gl.n = 0; flush(gl); drawRibbons(WW.time ? WW.time.now : 0); }
  }

  WW.airFx = { init: init, update: update, sync: sync, clearAll: clearAll, _ribbons: ribbons };
})();
