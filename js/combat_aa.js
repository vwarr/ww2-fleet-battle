// combat_aa.js — anti-aircraft fire (WW.combatAA). Loads after combat.js; combat.js's updateAA delegates here.
// Heavy AA (battleships, cruisers, carriers): time-fused bursts at a predicted lead point, a short wall across
// the bombers' path; each burst damages planes by proximity. Visual: each burst spawns a cluster of black puffs (the
// rounds a real screen fired) that spread into ragged smudges over a minute and drift on the wind aloft (the flak sky).
// Light AA (every armed ship): tracer streams at low / close planes with a hit chance per stream.
// Planes caught near bursts jink (plane.jink 0..1, applied by applyJink from Plane.update); jinking lowers
// the chance to be hit, a steady torpedo run or dive raises it.
// Simulation randomness: WW.rand (via combat's rnd). Visual scatter: Math.random.
window.WW = window.WW || {};
(function () {
  'use strict';
  var WW = window.WW;

  // ---------- tunables ----------
  // Share of ship.stats.aa.dps that goes to the heavy (fused-burst) battery; the rest is light (tracers).
  var HEAVY_SHARE = { battleship: 0.6, cruiser: 0.55, carrier: 0.55, destroyer: 0, submarine: 0, pt: 0 };
  var HEAVY = {
    interval: 1.1,     // s between salvos per ship
    rangeK: 2.2,       // heavy reach = aa.range * rangeK (3D), so it reaches dive bombers at the push-over (balance pass: 1.55)
    minAlt: 10,        // fuses are not set for wave-top targets: low planes are light AA's job
    minRange: 9,       // horizontal: too close to train the heavy mounts
    shellSpeed: 70,    // units/s, for time of flight / lead
    perSalvo: 3,       // bursts per salvo, spread across the target's path
    radius: 6.5,       // damage radius of one burst
    dmgK: 2,           // burst damage at the centre = heavy dps * interval * dmgK (falls off with distance^2) (balance pass: 0.8)
    aimBase: 1.6,      // aim error (units) = aimBase + aimPerUnit * range
    aimPerUnit: 0.05,
    jinkRadius: 18,    // a bomber this close to a burst starts to jink
    maxPending: 72
  };
  // light AA reach = aa.range * rangeK (3D): 20 / 25 mm, 1.1 in and 40 mm reach ~0.6-1 km, over the torpedo bombers' drop
  // point (80-100 u out) (balance pass: 1, the run was out of reach until the drop)
  var LIGHT = { interval: 0.25, maxAlt: 24, hitK: 0.38, dmgK: 1.25, rangeK: 2 };
  // Blown apart in the air (air_deaths.js 'burst'): a burst this close (f = 1 - d / radius above f0) either kills
  // outright (lethal damage from a burst closer than f1: no draw) or, with chance k x closeness x shell x frailty (one WW.rand
  // draw, only for close bursts), sets off the tanks or the bomb load. A minority of 1942 flak kills: most planes
  // went down burning or crippled. shell: 5-inch-class rounds (the USN 5"/38 and 5"/25, 25 kg; the IJN 12.7 cm Type
  // 89, 23 kg). frail: the target's nation: IJN planes had no self-sealing tanks or armour (a Betty was the
  // "one-shot lighter"), USN planes had both.
  var BLOW = { f0: 0.55, f1: 0.8, k: 0.06, shell: { USN: 1, IJN: 0.95 }, frail: { IJN: 1.3, USN: 0.75 } };
  var JINK = { decay: 0.3, hitMul: 0.45, steadyMul: 1.35, turn: 0.4, climb: 3 };
  var TR_SPEED = 85, TR_LEN = 2.4, TR_W = 0.22;   // light-AA rounds: thin hot lines (widened with distance so they read at battle range)

  // ---------- helpers ----------
  function I() { return WW.combat && WW.combat._i; }
  function rnd() { return WW.rand ? WW.rand() : Math.random(); }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function usable(s) { return s && s.alive && !s.sinking && !s.submerged && s.stats && s.stats.aa; }
  function steady(pl) { return pl.phase === 'run' || pl.phase === 'dive'; }
  // multiplier on the chance to hit / tightness of aim: jinking spoils it, a steady run makes it easy
  // (a plane on a run/dive is not weaving even if its jink value has not decayed yet)
  function exposure(pl) { return steady(pl) ? JINK.steadyMul : 1 - JINK.hitMul * Math.min(1, pl.jink || 0); }
  // Fire-control priority (light and heavy): the gunners' weight on a plane's distance (lower = first). An armed
  // bomber closing on this ship or a ship nearby (its target within PRI.NEAR) comes first; a spent or departing
  // plane (no ordnance, going home or flying away) only when nothing else is in reach (point blank: anything);
  // fighters after the bombers (a strafing pass is less of a threat than a bomb or torpedo).
  var PRI = { armed: 0.45, fighter: 1.3, away: 3, near: 150, point: 15 };
  function priority(s, pl, d) {
    var bx = s.x - pl.x, bz = s.z - pl.z, bl = Math.sqrt(bx * bx + bz * bz) || 1, c = (Math.cos(pl.heading) * bx + Math.sin(pl.heading) * bz) / bl;
    if (pl.ordnance && !pl.crippled && (pl.kind === 'dive' || pl.kind === 'torpedo')) {
      var t = pl.target;
      if (t === s || c > 0.5 || (t && t.x !== undefined && WW.dist2(t.x, t.z, s.x, s.z) < PRI.near * PRI.near)) return PRI.armed;
      return 1;
    }
    if (d > PRI.point && (pl.state === 'return' || c < -0.3)) return PRI.away;
    return pl.kind === 'fighter' ? PRI.fighter : 1;
  }
  function hitPlane(pl, amt, ship, src) {
    if (!pl || !pl.alive || !(amt > 0) || !pl.damage) return;
    var prev = pl.killedBy;
    pl.killedBy = ship;                 // shotDown() runs inside damage(): set it first
    try { pl.damage(amt); } catch (e) { /* never throw */ }
    if (pl.alive) pl.killedBy = prev;   // survived: do not leave a stale killer
    else dbg[src]++;
  }

  // ---------- visual pools (bounded rings, one draw call each) ----------
  var V = null, dbg = { bursts: 0, heavyKills: 0, lightKills: 0, peakPending: 0, blownUp: 0 };
  function Ring(n, geo, mat) {
    this.n = n; this.head = 0;
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    var f = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'r0', 'g0', 'b0', 'r1', 'g1', 'b1', 'rot'];
    for (var k = 0; k < f.length; k++) this[f[k]] = new Float32Array(n);
    this.on = new Uint8Array(n);
    var c = new THREE.Color(1, 1, 1);
    for (var i = 0; i < n; i++) this.mesh.setColorAt(i, c);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  Ring.prototype.spawn = function (x, y, z, vx, vy, vz, life, s0, s1, c0, c1) {
    var i = this.head; this.head = (i + 1) % this.n;   // full ring: reuse the oldest slot
    this.on[i] = 1; this.age[i] = 0; this.life[i] = life;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.s0[i] = s0; this.s1[i] = s1; this.rot[i] = Math.random() * 6.28;
    this.r0[i] = c0.r; this.g0[i] = c0.g; this.b0[i] = c0.b; this.r1[i] = c1.r; this.g1[i] = c1.g; this.b1[i] = c1.b;
  };
  // glow: colour fades to black (additive); otherwise a puff that pops, lingers and shrinks away
  Ring.prototype.update = function (dt, glow) {
    var m = this.mesh, n = 0, T = V.tmp;
    for (var i = 0; i < this.n; i++) {
      if (!this.on[i]) continue;
      var a = (this.age[i] += dt);
      if (a >= this.life[i]) { this.on[i] = 0; continue; }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      var t = a / this.life[i], s, b = 1;
      if (glow) { s = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.min(1, t * 3); b = (1 - t) * (1 - t); }
      else {
        var e = 1 - Math.pow(1 - Math.min(1, t * 6), 3);          // fast pop to full size...
        s = this.s0[i] + (this.s1[i] - this.s0[i]) * (e * 0.8 + 0.2 * t); // ...then a slow swell while it lingers
        if (t > 0.7) { var x = (t - 0.7) / 0.3; s *= 1 - x * x * (3 - 2 * x); }
      }
      T.q.setFromAxisAngle(T.ax, this.rot[i] + a * 0.3);
      T.m.compose(T.p.set(this.px[i], this.py[i], this.pz[i]), T.q, T.s.set(s, s * 0.85, s));
      m.setMatrixAt(n, T.m);
      T.c.setRGB((this.r0[i] + (this.r1[i] - this.r0[i]) * t) * b, (this.g0[i] + (this.g1[i] - this.g0[i]) * t) * b,
        (this.b0[i] + (this.b1[i] - this.b0[i]) * t) * b);
      m.setColorAt(n, T.c);
      n++;
    }
    m.count = n;
    WW.instUsed(m, true);
    return n;
  };
  Ring.prototype.clear = function () { this.on.fill(0); this.head = 0; this.mesh.count = 0; };

  // ---------- the flak sky: soft instanced impostors, animated on the GPU ----------
  // Every heavy burst, light-AA burst and gun-smoke puff is one camera-facing quad in a single draw call. A puff is
  // written once when it is spawned (birth, life, sizes, drift, colours) and the vertex shader derives the rest from
  // the visual clock uTime (sim seconds): the pop to a black ball, the slow spread into a ragged smudge, the greying
  // and thinning, the drift on the wind, the fade near the camera and below a pixel far off. Dead or invisible puffs
  // collapse to a point (no fragments). The ring reuses the oldest slot when full (the oldest are the faintest).
  var SKY_N = 12288;
  var SKY_VS = [
    'uniform float uTime, uClear, uDay, uPx;',
    'attribute vec3 aP, aV, aC0, aC1; attribute vec4 aT, aG;',
    'varying vec2 vUv; varying vec3 vCol; varying float vA, vFlash, vSeed, vSoft;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  float age = uTime - aT.x;',
    '  if (age < 0.0 || age > aT.y || aT.x < uClear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }',
    '  float t = age / aT.y, g = 1.0 - exp(-age / aG.x);',
    // pop: s0 to 2.6 s0 in a fraction of a second; then the slow spread to s1
    '  float s = aT.z + 1.6 * aT.z * (1.0 - exp(-age * 7.0)) + (aT.w - 2.6 * aT.z) * g;',
    '  vec4 mvPosition = viewMatrix * vec4(aP + aV * age, 1.0);',
    '  float d = -mvPosition.z;',
    '  float a = aG.z * smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.5, 1.0, t)) * (1.0 - 0.5 * g);',   // thins as it spreads
    '  a *= smoothstep(3.0 + 0.4 * s, 10.0 + 1.6 * s, d);',                       // soft near fade: never a wall over the lens
    '  a *= smoothstep(0.4, 1.4, s * uPx / max(d, 1.0));',                         // distance LOD: under a pixel or so, gone
    '  a *= mix(0.4, 1.0, uDay);',
    '  float fl = aG.y > 0.0 ? 1.0 - smoothstep(0.0, aG.y, age) : 0.0;',
    '  if (a < 0.004 && fl < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }',
    '  float r = aG.w * 6.2832 + age * 0.015, cr = cos(r), sr = sin(r);',
    '  vUv = position.xy;',
    '  mvPosition.xy += vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y) * s * 0.78;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  vCol = mix(aC0, aC1, clamp(0.65 * g + 0.45 * t, 0.0, 1.0)); vA = a; vFlash = fl; vSeed = aG.w; vSoft = g;',
    '  #include <fog_vertex>',
    '}'].join('\n');
  var SKY_FS = [
    'uniform vec3 uSunV, uLit, uAmb;',
    'varying vec2 vUv; varying vec3 vCol; varying float vA, vFlash, vSeed, vSoft;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  float r = length(vUv), an = atan(vUv.y, vUv.x), k = vSeed * 60.0;',
    // a ragged edge (lobes that grow as it spreads) and a few holes in the thinning smudge
    '  float n = 0.5 * sin(3.0 * an + k) + 0.3 * sin(5.0 * an + k * 1.7 + vSoft * 2.0) + 0.2 * sin(9.0 * an + k * 2.3);',
    '  float e = 0.6 + n * (0.07 + 0.13 * vSoft), sf = 0.1 + 0.3 * vSoft;',
    '  float m = 1.0 - smoothstep(e - sf, e + sf, r);',
    // two side lobes that drift apart as it spreads: a smudge, not a ball
    '  float sp = 0.12 + 0.2 * vSoft;',
    '  vec2 o1 = vec2(cos(k), sin(k)) * sp, o2 = vec2(cos(k * 1.7 + 2.0), sin(k * 1.7 + 2.0)) * sp * 1.1;',
    '  m = max(m, 0.8 * (1.0 - smoothstep(0.32 - sf * 0.5, 0.36 + sf, length(vUv - o1) + n * 0.04)));',
    '  m = max(m, 0.7 * (1.0 - smoothstep(0.28 - sf * 0.5, 0.32 + sf, length(vUv - o2) - n * 0.04)));',
    '  r = min(r, min(length(vUv - o1), length(vUv - o2)) * 1.4);',
    '  m *= 1.0 - vSoft * 0.35 * (0.5 + 0.5 * sin(vUv.x * 7.0 + k) * sin(vUv.y * 6.0 - k * 0.7));',
    '  if (m * vA < 0.003 && vFlash < 0.01) discard;',
    // toon shading of a ball (the MeshToonMaterial gradient: 0.47 / 0.65 / 0.80), the light of the sky_time palette
    '  vec3 nr = normalize(vec3(vUv * 1.3, sqrt(max(0.05, 1.0 - r * r))));',
    '  float l = dot(nr, uSunV) * 0.5 + 0.5, gr = l < 0.333 ? 0.47 : l < 0.667 ? 0.65 : 0.80;',
    '  vec3 c = vCol * (uAmb + uLit * mix(gr, 0.62, vSoft * 0.6));',
    '  float fc = vFlash * (1.0 - smoothstep(0.0, 0.55, r));',
    '  c = mix(c, vec3(3.2, 1.7, 0.55), fc);',
    '  gl_FragColor = vec4(c, max(vA * m, fc));',
    '  #include <fog_fragment>',
    '}'].join('\n');
  function Sky(n) {
    this.n = n; this.head = 0; this.used = 0; this.time = 0; this.lo = n; this.hi = -1; this.all = false;
    var g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    var sz = { aP: 3, aV: 3, aC0: 3, aC1: 3, aT: 4, aG: 4 };
    this.at = {};
    for (var k in sz) {
      var a = new THREE.InstancedBufferAttribute(new Float32Array(n * sz[k]), sz[k]);
      a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); this.at[k] = a;
    }
    this.at.aT.array.fill(-1e9);
    g.instanceCount = 0;
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uClear: { value: -1e8 }, uDay: { value: 1 }, uPx: { value: 500 },
      uSunV: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) }
    }]);
    var mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: SKY_VS, fragmentShader: SKY_FS,
      transparent: true, depthWrite: false, fog: true });
    var m = this.mesh = new THREE.Mesh(g, mat);
    m.frustumCulled = false; m.renderOrder = 3; m.castShadow = m.receiveShadow = false;
    var self = this;
    m.onBeforeRender = function (rd, sc, cam) { self.prepare(rd, cam); };
  }
  // c0 / c1: THREE.Color young / aged. tau: s for the spread. flash: s of the orange flash (0: none)
  Sky.prototype.spawn = function (x, y, z, vx, vy, vz, delay, life, s0, s1, tau, flash, alpha, c0, c1) {
    var i = this.head, A = this.at;
    this.head = (i + 1) % this.n;
    if (this.used < this.n) this.used++;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    if (this.head === 0) this.all = true;   // wrapped: the next upload covers the whole ring
    var p = A.aP.array, v = A.aV.array, c = A.aC0.array, d = A.aC1.array, T = A.aT.array, G = A.aG.array, j3 = i * 3, j4 = i * 4;
    p[j3] = x; p[j3 + 1] = y; p[j3 + 2] = z; v[j3] = vx; v[j3 + 1] = vy; v[j3 + 2] = vz;
    c[j3] = c0.r; c[j3 + 1] = c0.g; c[j3 + 2] = c0.b; d[j3] = c1.r; d[j3 + 1] = c1.g; d[j3 + 2] = c1.b;
    T[j4] = this.time + delay; T[j4 + 1] = life; T[j4 + 2] = s0; T[j4 + 3] = s1;
    G[j4] = tau; G[j4 + 1] = flash; G[j4 + 2] = alpha; G[j4 + 3] = Math.random();
  };
  Sky.prototype.advance = function (dt) { this.time += dt; this.u.uTime.value = this.time; };
  // after each sim step: the new puffs queued for upload (three uploads before the render; a range still waiting
  // from an earlier step is widened, not replaced: three resets updateRange.count to -1 once it has uploaded)
  Sky.prototype.flush = function () {
    this.mesh.geometry.instanceCount = this.used;
    if (this.hi < this.lo && !this.all) return;
    var lo = this.all ? 0 : this.lo, hi = this.all ? this.n : this.hi + 1, A = this.at;
    for (var k in A) {
      var a = A[k], r = a.updateRange, o = lo * a.itemSize, e = hi * a.itemSize;
      if (r.count > 0) { o = Math.min(o, r.offset); e = Math.max(e, r.offset + r.count); }
      r.offset = o; r.count = e - o; a.needsUpdate = true;
    }
    this.lo = this.n; this.hi = -1; this.all = false;
  };
  // once per render: the light of the moment (sky_time.js) and the sun in view space
  Sky.prototype.prepare = function (rd, cam) {
    var u = this.u, P = WW.sky && WW.sky.parts && WW.sky.parts();
    if (P && P.sun && P.hemi) {
      u.uLit.value.copy(P.sun.color).multiplyScalar(P.sun.intensity * 0.85);
      u.uAmb.value.copy(P.hemi.groundColor).lerp(P.hemi.color, 0.65).multiplyScalar(P.hemi.intensity);
    }
    if (WW.sky && WW.sky.SUN_DIR) u.uSunV.value.copy(WW.sky.SUN_DIR).transformDirection(cam.matrixWorldInverse);
    u.uDay.value = WW.daylight === undefined ? 1 : WW.daylight;
    u.uPx.value = cam.projectionMatrix.elements[5] * 0.5 * rd.domElement.height;   // pixels per unit at distance 1
  };
  Sky.prototype.live = function () {   // puffs alive now (tests)
    var T = this.at.aT.array, n = 0, t = this.time, c = this.u.uClear.value;
    for (var i = 0; i < this.used; i++) { var b = T[i * 4]; if (b >= c && b <= t && t - b < T[i * 4 + 1]) n++; }
    return n;
  };
  Sky.prototype.clear = function () { this.u.uClear.value = this.time + 1e-3; };

  function initVisuals() {
    if (V || typeof THREE === 'undefined' || !WW.scene || WW.simOnly) return;
    var ball = new THREE.IcosahedronGeometry(0.5, 2), pa = ball.attributes.position, na = ball.attributes.normal, v = new THREE.Vector3();
    for (var j = 0; j < pa.count; j++) { v.fromBufferAttribute(pa, j).normalize(); na.setXYZ(j, v.x, v.y, v.z); } // smooth normals
    V = {
      puff: new Sky(SKY_N),
      core: new Ring(64, ball, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false })),
      tmp: { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(),
             c: new THREE.Color(), ax: new THREE.Vector3(0.3, 1, 0.2).normalize() },
      col: { hot: new THREE.Color(0xffb060), hot2: new THREE.Color(0xc04010) },
      // the flak palette (young -> aged): USN 5"/38 near-black brown, IJN 12.7 cm grey-black, light AA a dusty
      // brown-black, gun smoke a pale brown-grey cordite haze. Pastel, never #000.
      flak: { USN: [new THREE.Color(0x2e2622), new THREE.Color(0x6e6660)], IJN: [new THREE.Color(0x2a2c31), new THREE.Color(0x6c6f75)],
              light: [new THREE.Color(0x3c3530), new THREE.Color(0x7a746e)], haze: [new THREE.Color(0xa49a90), new THREE.Color(0xbdb7b0)] }
    };
    V.core.mesh.renderOrder = 4;
    // tracer rounds: a hot saturated core (HDR red channel > 1 so the bloom pass makes it glow, green/blue kept
    // low so it stays yellow-orange instead of clipping to white) inside a soft additive orange sheath.
    // Warm for both nations, IJN a touch redder. Shared by every light-AA tracer.
    V.trUSN = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.95, 0.22), fog: false });
    V.trIJN = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.7, 0.16), fog: false });
    V.trGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.22, 0.04), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  function addVisuals() {
    initVisuals();
    if (!V) return;
    if (V.puff.mesh.parent !== WW.scene) WW.scene.add(V.puff.mesh);
    if (V.core.mesh.parent !== WW.scene) WW.scene.add(V.core.mesh);
  }

  // Burst look (visual only, Math.random): the orange flash core, then the puffs. One sim burst stands for the many
  // rounds a real screen fired (a 1942 carrier group's 5-inch guns: 100+ barrels at ~15 rounds a minute each), so it
  // spawns a cluster: its own burst and FLAK.cluster more, scattered around it across the wall and along the lead,
  // popping over the salvo interval. Each one is a black ball that spreads into a ragged smudge over a minute and
  // drifts on the wind aloft (stronger with height), greying and thinning until it is gone.
  var FLAK = { cluster: 4, spread: 15, life: [45, 90], s0: 0.85, s1: [4.5, 9], tau: [14, 26], alpha: 0.78,
               lightLife: [14, 32], hazeLife: [30, 50] };
  function windAt(y, k) { var w = WW.wind || { x: 0.3, z: 0 }, f = (0.7 + y / 30) * (k || 1); return [w.x * f, w.z * f]; }
  function flakPuff(x, y, z, delay, col, R) {
    var w = windAt(y), L = FLAK.life;
    V.puff.spawn(x, y, z, w[0] + (R() - 0.5) * 0.3, 0.05 + R() * 0.08, w[1] + (R() - 0.5) * 0.3, delay,
      L[0] + R() * (L[1] - L[0]), FLAK.s0 * (0.8 + R() * 0.45), FLAK.s1[0] + R() * (FLAK.s1[1] - FLAK.s1[0]),
      FLAK.tau[0] + R() * (FLAK.tau[1] - FLAK.tau[0]), 0.14 + R() * 0.06, FLAK.alpha * (0.8 + R() * 0.2), col[0], col[1]);
  }
  function burstFx(x, y, z, nation) {
    if (!V) return;
    var R = Math.random, col = V.flak[nation] || V.flak.USN, S = FLAK.spread;
    V.core.spawn(x, y, z, 0, 0, 0, 0.2 + R() * 0.08, 0.6, 1.6, V.col.hot, V.col.hot2);
    flakPuff(x, y, z, 0, col, R);
    for (var i = 0; i < FLAK.cluster; i++) {
      flakPuff(x + (R() - 0.5) * 2 * S, Math.max(HEAVY.minAlt * 0.7, y + (R() - 0.5) * S * 0.6), z + (R() - 0.5) * 2 * S,
        R() * HEAVY.interval, col, R);
    }
  }
  // a light-AA burst (40 mm self-destruct / 25 mm): small, lower down, shorter lived
  function lightPuff(x, y, z, delay, R) {
    var w = windAt(y), L = FLAK.lightLife, c = V.flak.light;
    V.puff.spawn(x, y, z, w[0] + (R() - 0.5) * 0.3, 0.06 + R() * 0.06, w[1] + (R() - 0.5) * 0.3, delay,
      L[0] + R() * (L[1] - L[0]), 0.32 + R() * 0.12, 1.9 + R() * 1.1, 8 + R() * 8, 0.08, 0.6, c[0], c[1]);
  }
  // gun smoke drifting off a firing battery: pale, big, low, slow to clear
  function hazePuff(x, y, z, big, R) {
    var w = windAt(y, 0.9), L = FLAK.hazeLife, c = V.flak.haze, k = big ? 1 : 0.55;
    V.puff.spawn(x + (R() - 0.5) * 2, y + R(), z + (R() - 0.5) * 2, w[0] + (R() - 0.5) * 0.2, 0.18 + R() * 0.12, w[1] + (R() - 0.5) * 0.2, 0.05,
      (L[0] + R() * (L[1] - L[0])) * k, 1.2 * k, (8 + R() * 4) * k, 12 + R() * 8, 0, (big ? 0.24 : 0.16) + R() * 0.06, c[0], c[1]);
  }

  // ---------- light AA tracers (combat.js projectile pool, own kind) ----------
  function updateTracerAA(p, dt) {
    p.t += dt;
    var tt = p.t - p.delay;
    if (tt < 0) { if (p.mesh) p.mesh.visible = false; return; }
    if (tt >= p.life) { p.dead = true; return; }
    if (p.mesh) p.mesh.visible = true;
    I().place(p, p.x0 + p.vx * tt, p.y0 + p.vy0 * tt, p.z0 + p.vz * tt);
    var f = Math.min(1, (p.life - tt) / (p.life * 0.35));
    // fade out rounds that pass right by the camera (close chase / over-the-shoulder shots), else they fill the frame
    var cp = WW.camera && WW.camera.position, mp = p.mesh && p.mesh.position, dc = cp && mp ? mp.distanceTo(cp) : 40, k = Math.min(1, Math.max(0, (dc - 6) / 14));
    var wk = k * Math.min(2, Math.max(1, dc / 45));   // thin up close, a little wider far off so the stream still reads at battle range
    if (p.mesh) { p.mesh.visible = k > 0.03; p.mesh.scale.set(p.len * f * k, p.w * (0.5 + 0.5 * f) * wk, p.w * (0.5 + 0.5 * f) * wk); }
  }
  // one round = a solid hot core + a wider additive glow sheath on the same path (two pooled projectiles)
  function tracerRound(ci, mat, sx, sy, sz, vx, vy, vz, delay, life) {
    for (var g = 0; g < 2; g++) {
      var p = ci.acquire('aatracer', ci.G.shell, g ? V.trGlow : mat);
      p.x0 = sx; p.y0 = sy; p.z0 = sz; p.vx = vx; p.vy0 = vy; p.vz = vz;
      p.delay = delay; p.life = life; p.len = g ? TR_LEN * 1.25 : TR_LEN; p.w = g ? TR_W * 2.2 : TR_W;
      if (p.mesh) { p.mesh.scale.set(p.len, p.w, p.w); p.mesh.visible = false; }   // shown (and faded near the camera) by updateTracerAA
      ci.place(p, sx, sy, sz); ci.orient(p, vx, vy, vz);
    }
  }
  // A short stream of 2-3 tracers from guns along the hull toward the lead point (visual: Math.random).
  function tracerStream(s, pl, hit) {
    var ci = I(); if (!ci || !V) return;
    ci.buildShared();
    var R = Math.random, h = s.heading || 0, c = Math.cos(h), sn = Math.sin(h), L = (s.stats && s.stats.length) || 12;
    var pvx = Math.cos(pl.heading || 0) * (pl.speed || 0), pvz = Math.sin(pl.heading || 0) * (pl.speed || 0), pvy = pl.vy || 0;
    var miss = hit ? 0.6 : 2.5 + R() * 3, n = 3 + (R() < 0.5 ? 1 : 0);
    var along = (R() - 0.5) * L * 0.6, across = (R() < 0.5 ? -1 : 1) * L * 0.08;   // one gun mount per stream
    var sx = s.x + c * along - sn * across, sz = s.z + sn * along + c * across, sy = 2.2 + R() * 0.6;
    for (var k = 0; k < n; k++) {
      var dx = pl.x - sx, dy = (pl.y || 5) - sy, dz = pl.z - sz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, T = d / TR_SPEED;
      var ax = pl.x + pvx * T + (R() - 0.5) * miss * 2, ay = (pl.y || 5) + pvy * T + (R() - 0.5) * miss, az = pl.z + pvz * T + (R() - 0.5) * miss * 2;
      dx = ax - sx; dy = ay - sy; dz = az - sz; d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var dl = k * (0.055 + R() * 0.03), lf = Math.min(0.8, (d / TR_SPEED) * 1.3), ey = sy + dy / d * TR_SPEED * lf;
      tracerRound(ci, s.nation === 'IJN' ? V.trIJN : V.trUSN, sx, sy, sz, dx / d * TR_SPEED, dy / d * TR_SPEED, dz / d * TR_SPEED, dl, lf);
      // the round bursts where its tracer burns out (40 mm self-destruct, 25 mm): a small dark puff, low down
      if (ey > 5 && R() < 0.4) lightPuff(sx + dx / d * TR_SPEED * lf, ey, sz + dz / d * TR_SPEED * lf, dl + lf, R);
    }
    if (R() < 0.12) hazePuff(sx, sy + 0.5, sz, false, R);   // the mount's gun smoke
  }

  // ---------- heavy AA: fused bursts ----------
  var pending = [];   // { x, y, z, T, ship, dmg }
  var timers = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  function heavySalvo(s, pl, heavyDps) {
    var mx = s.x, my = 3, mz = s.z;
    var ph = pl.heading || 0, pvx = Math.cos(ph) * (pl.speed || 0), pvz = Math.sin(ph) * (pl.speed || 0), pvy = WW.clamp(pl.vy || 0, -8, 8);
    // lead: two passes of the time-of-flight estimate (as fireShell)
    var T = Math.hypot(pl.x - mx, (pl.y || 5) - my, pl.z - mz) / HEAVY.shellSpeed;
    var ax = pl.x + pvx * T, ay = (pl.y || 5) + pvy * T, az = pl.z + pvz * T;
    T = Math.hypot(ax - mx, ay - my, az - mz) / HEAVY.shellSpeed;
    ax = pl.x + pvx * T; ay = Math.max(HEAVY.minAlt * 0.8, (pl.y || 5) + pvy * T); az = pl.z + pvz * T;
    // aim error grows with range; jinking spoils the prediction, a steady run makes it easy
    var range = Math.hypot(ax - mx, az - mz), ex = exposure(pl);
    var sig = (HEAVY.aimBase + HEAVY.aimPerUnit * range) / ex;
    var ux = -Math.sin(ph), uz = Math.cos(ph);       // across the target's path
    var fx = Math.cos(ph), fz = Math.sin(ph);         // along it
    var eAcross = (rnd() + rnd() - 1) * sig * 1.6, eAlong = (rnd() + rnd() - 1) * sig * 1.4, eUp = (rnd() + rnd() - 1) * sig * 0.6;
    var gap = rr(4.5, 6.5), dmg = heavyDps * HEAVY.interval * HEAVY.dmgK;
    for (var k = 0; k < HEAVY.perSalvo && pending.length < HEAVY.maxPending; k++) {
      var off = (k - (HEAVY.perSalvo - 1) / 2) * gap + rr(-1, 1);   // a short wall across the path
      var fwd = eAlong + rr(-1.5, 2.5);
      pending.push({ x: ax + ux * (eAcross + off) + fx * fwd, y: Math.max(HEAVY.minAlt * 0.8, ay + eUp + rr(-1.2, 1.2)), z: az + uz * (eAcross + off) + fz * fwd,
                     T: T + rr(0, 0.18), ship: s, nation: s.nation, dmg: dmg });
    }
    if (pending.length > dbg.peakPending) dbg.peakPending = pending.length;
    // visible muzzle flash at a heavy mount on the side facing the target (visual only)
    var h = s.heading || 0, L = (s.stats && s.stats.length) || 12, a = (Math.random() - 0.5) * L * 0.4;
    var sd = (-(pl.x - s.x) * Math.sin(h) + (pl.z - s.z) * Math.cos(h)) < 0 ? -1 : 1;
    var gx = s.x + Math.cos(h) * a - Math.sin(h) * sd * L * 0.09, gz = s.z + Math.sin(h) * a + Math.cos(h) * sd * L * 0.09;
    if (V) { V.core.spawn(gx, 3, gz, 0, 0.5, 0, 0.16, 0.9, 1.8, V.col.hot, V.col.hot2); hazePuff(gx, 3.5, gz, true, Math.random); }
    if (WW.fx && WW.fx.muzzleFlash) try { WW.fx.muzzleFlash(gx, 3, gz); } catch (e) { /* ignore */ }
    WW.emit('aaHeavyFired', { ship: s, x: gx, y: 3, z: gz, target: pl });   // sound (audio_aa.js)
  }

  function detonate(b, planes) {
    dbg.bursts++;
    burstFx(b.x, b.y, b.z, b.nation);
    WW.emit('flakBurst', { x: b.x, y: b.y, z: b.z, ship: b.ship, nation: b.nation });   // sound (audio_aa.js)
    var R = HEAVY.radius, J = HEAVY.jinkRadius;
    for (var j = 0; j < planes.length; j++) {
      var pl = planes[j];
      if (!pl || !pl.alive || pl.nation === b.nation) continue;
      var dx = pl.x - b.x, dy = (pl.y || 0) - b.y, dz = pl.z - b.z;
      if (dx > J || dx < -J || dz > J || dz < -J) continue;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < R) {
        var f = 1 - d / R, amt = b.dmg * f * f;
        if (f > BLOW.f0 && ((amt >= pl.hp && f > BLOW.f1) || rnd() < BLOW.k * (f - BLOW.f0) / (1 - BLOW.f0) * (BLOW.shell[b.nation] || 1) * (BLOW.frail[pl.nation] || 1))) {
          pl._force = 'burst'; amt = Math.max(amt, pl.hp + 1); dbg.blownUp++;
        }
        hitPlane(pl, amt, b.ship, 'heavyKills');
        if (pl._force === 'burst') pl._force = null;   // (consumed by air_deaths.js pick on a kill)
      }
      if (pl.alive && d < J && pl.kind !== 'fighter') pl.jink = Math.min(1, (pl.jink || 0) + 0.5 * (1 - d / J) + 0.2);
    }
  }

  // ---------- per-ship fire control ----------
  // the ship's side has the plane on its plots (intel.js: AA directors and lookouts)
  function detected(s, pl) { return !WW.intel || WW.intel.visible(s.nation, pl, 1.5); }
  function update(dt) {
    var ships = (WW.world && WW.world.ships) || [], planes = (WW.world && WW.world.planes) || [];
    if (WW.landSites) ships = WW.landSites.shooters(ships);   // + the land sites' AA (the island base's pits; land_sites.js)
    if (V) { V.puff.advance(dt); V.core.update(dt, true); }
    else addVisuals();
    // fused bursts in flight
    var w = 0;
    for (var b = 0; b < pending.length; b++) {
      var q = pending[b];
      q.T -= dt;
      if (q.T > 0) { pending[w++] = q; continue; }
      try { detonate(q, planes); } catch (e) { /* never throw */ }
    }
    pending.length = w;
    // live planes only: dead ones linger for a Math.random time (ditched wrecks), which must not change AA timing
    if (!timers || !planes.some(function (p) { return p && p.alive; })) return;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!usable(s)) continue;
      var tm = timers.get(s);
      if (!tm) { tm = { h: rnd() * HEAVY.interval, l: rnd() * LIGHT.interval }; timers.set(s, tm); }
      var aa = s.stats.aa, hs = HEAVY_SHARE[s.type] || 0;
      tm.h -= dt; tm.l -= dt;
      if (hs > 0 && tm.h <= 0) {
        tm.h += HEAVY.interval; if (tm.h <= 0) tm.h = HEAVY.interval * rnd();
        var hr = aa.range * HEAVY.rangeK, best = null, bs = 1e9;
        for (var j = 0; j < planes.length; j++) {
          var pl = planes[j];
          if (!pl || !pl.alive || pl.nation === s.nation || (pl.y || 0) < HEAVY.minAlt) continue;
          var dx = pl.x - s.x, dz = pl.z - s.z, h2 = dx * dx + dz * dz, d3 = Math.sqrt(h2 + pl.y * pl.y);
          if (d3 > hr || h2 < HEAVY.minRange * HEAVY.minRange || !detected(s, pl)) continue;
          var sc = d3 * (pl.kind === 'fighter' ? 1.3 : 1) * priority(s, pl, d3);   // armed bombers closing first, departing planes last
          if (sc < bs) { bs = sc; best = pl; }
        }
        var ak = best && WW.supply ? WW.supply.aa(s, true) : 1;   // AA ammunition (ship_supply.js): weaker when low
        if (best && ak > 0) { heavySalvo(s, best, aa.dps * hs * ak); s.aaAt = WW.time.now; }   // aaAt: the guns are firing (intel.js: the lookouts' load)
      }
      if (tm.l <= 0) {
        tm.l += LIGHT.interval; if (tm.l <= 0) tm.l = LIGHT.interval * rnd();
        var lr = aa.range * LIGHT.rangeK, lt = null, bd = lr * lr, bsc = 1e18;
        for (var k = 0; k < planes.length; k++) {
          var p2 = planes[k];
          if (!p2 || !p2.alive || p2.nation === s.nation || (p2.y || 0) > LIGHT.maxAlt) continue;
          if (p2.carrier && p2.carrier.isBase && WW.landGround.onGround(p2)) continue;   // taxiing / rolling on the island: the main battery's business (island_base.js impact)
          var ex = p2.x - s.x, ez = p2.z - s.z, ey = (p2.y || 0), dd = ex * ex + ez * ez + ey * ey;
          if (dd >= lr * lr) continue;
          var ds = Math.sqrt(dd), sl = ds * priority(s, p2, ds);   // the threat comes first, not the nearest plane
          if (sl < bsc && detected(s, p2)) { bsc = sl; bd = dd; lt = p2; }
        }
        if (!lt) continue;
        var lk = WW.supply ? WW.supply.aa(s, false) : 1;
        if (lk <= 0) continue;
        var frac = Math.sqrt(bd) / lr;
        var hc = LIGHT.hitK * (1.4 - 0.8 * frac) * (lt.kind === 'fighter' ? 0.6 : 1) * exposure(lt);
        if (s.aaSup && s.aaSup.until > WW.time.now) hc *= s.aaSup.k;   // strafed: the gun crews' heads down (air_gunners.js)
        var hit = rnd() < hc * lk;
        s.aaAt = WW.time.now;
        if (hit) hitPlane(lt, aa.dps * (1 - hs) * LIGHT.interval * LIGHT.dmgK, s, 'lightKills');
        if (lk >= 1 || hit || Math.random() < lk * 0.6) tracerStream(s, lt, hit);   // visual only: every light-AA tick shows a stream (fewer when its ammunition runs low)
        WW.emit('aaLightFired', { ship: s, target: lt, hit: hit });   // sound (audio_aa.js)
      }
    }
  }

  // Called from Plane.update (aircraft.js) before integrate: a small weave in heading and height while
  // plane.jink > 0. Never during a run/dive/pull-out (those phases fly exact profiles), never for fighters.
  function applyJink(pl, dt) {
    var j = pl.jink || 0;
    if (j <= 0) return;
    pl.jink = Math.max(0, j - JINK.decay * dt);
    if (pl.phase || pl.kind === 'fighter' || (pl.state !== 'transit' && pl.state !== 'attack')) return;
    if (pl.jinkPh === undefined) pl.jinkPh = rnd() * 6.28;
    var a = pl.t * 1.9 + pl.jinkPh, wob = Math.sin(a) + 0.5 * Math.sin(a * 2.3 + 1);
    pl.heading += wob * JINK.turn * j * dt;
    pl.turn = (pl.turn || 0) + wob * JINK.turn * j;          // roll into the weave
    pl.vy += Math.sin(a * 1.4 + 2) * JINK.climb * j * dt;
  }

  WW.combatAA = {
    update: update, applyJink: applyJink,
    clearAll: function () {
      pending.length = 0;
      if (typeof WeakMap !== 'undefined') timers = new WeakMap();
      if (V) { V.puff.clear(); V.core.clear(); }
    },
    cfg: { BLOW: BLOW, HEAVY: HEAVY, LIGHT: LIGHT, JINK: JINK, HEAVY_SHARE: HEAVY_SHARE },
    _vis: function () { initVisuals(); return V; },   // the shared materials (shader_warm.js warms them)
    _debug: function () {
      return { pending: pending.length, peakPending: dbg.peakPending, bursts: dbg.bursts, heavyKills: dbg.heavyKills, blownUp: dbg.blownUp, lightKills: dbg.lightKills,
               puffs: V ? V.puff.live() : 0, cores: V ? V.core.mesh.count : 0 };
    }
  };
  if (WW.combat && WW.combat._i) WW.combat._i.updaters.aatracer = updateTracerAA;
  // after the camera moves (main.js frame): the live light-AA rounds' near-camera fade re-sized for this frame's camera
  // (dt 0: nothing advances), so a hard cut has no frame of rounds sized for the old view
  (WW.afterCamera = WW.afterCamera || []).push(function () {
    if (V) V.puff.flush();   // the puffs spawned since the last frame go up to the GPU
    var ci = I(); if (!ci || !V || WW.simOnly) return;
    for (var i = 0, a = ci.active; i < a.length; i++) if (a[i].kind === 'aatracer' && !a[i].dead) updateTracerAA(a[i], 0);
  });
})();
