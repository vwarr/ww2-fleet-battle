// combat_aa.js — anti-aircraft fire (WW.combatAA). Loads after combat.js; combat.js's updateAA delegates here.
// Heavy AA (battleships, cruisers, carriers): time-fused bursts at a predicted lead point, a short wall across
// the bombers' path; each burst damages planes by proximity and leaves a black puff that drifts with the wind.
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
    rangeK: 1.55,      // heavy reach = aa.range * rangeK (3D), so it reaches dive bombers at altitude
    minAlt: 10,        // fuses are not set for wave-top targets: low planes are light AA's job
    minRange: 9,       // horizontal: too close to train the heavy mounts
    shellSpeed: 70,    // units/s, for time of flight / lead
    perSalvo: 3,       // bursts per salvo, spread across the target's path
    radius: 6.5,       // damage radius of one burst
    dmgK: 0.8,         // burst damage at the centre = heavy dps * interval * dmgK (falls off with distance^2)
    aimBase: 1.6,      // aim error (units) = aimBase + aimPerUnit * range
    aimPerUnit: 0.05,
    jinkRadius: 18,    // a bomber this close to a burst starts to jink
    maxPending: 72
  };
  var LIGHT = { interval: 0.25, maxAlt: 24, hitK: 0.38, dmgK: 1.25 };
  var JINK = { decay: 0.3, hitMul: 0.45, steadyMul: 1.35, turn: 0.4, climb: 3 };
  var TR_SPEED = 85, TR_LEN = 3.0, TR_W = 0.42;   // light-AA rounds: long, fat, additive so they read at battle distance

  // ---------- helpers ----------
  function I() { return WW.combat && WW.combat._i; }
  function rnd() { return WW.rand ? WW.rand() : Math.random(); }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function usable(s) { return s && s.alive && !s.sinking && !s.submerged && s.stats && s.stats.aa; }
  function steady(pl) { return pl.phase === 'run' || pl.phase === 'dive'; }
  // multiplier on the chance to hit / tightness of aim: jinking spoils it, a steady run makes it easy
  // (a plane on a run/dive is not weaving even if its jink value has not decayed yet)
  function exposure(pl) { return steady(pl) ? JINK.steadyMul : 1 - JINK.hitMul * Math.min(1, pl.jink || 0); }
  function hitPlane(pl, amt, ship, src) {
    if (!pl || !pl.alive || !(amt > 0) || !pl.damage) return;
    var prev = pl.killedBy;
    pl.killedBy = ship;                 // shotDown() runs inside damage(): set it first
    try { pl.damage(amt); } catch (e) { /* never throw */ }
    if (pl.alive) pl.killedBy = prev;   // survived: do not leave a stale killer
    else dbg[src]++;
  }

  // ---------- visual pools (bounded rings, one draw call each) ----------
  var V = null, dbg = { bursts: 0, heavyKills: 0, lightKills: 0, peakPending: 0 };
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
    if (n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    return n;
  };
  Ring.prototype.clear = function () { this.on.fill(0); this.head = 0; this.mesh.count = 0; };

  function initVisuals() {
    if (V || typeof THREE === 'undefined' || !WW.scene) return;
    var ball = new THREE.IcosahedronGeometry(0.5, 2), pa = ball.attributes.position, na = ball.attributes.normal, v = new THREE.Vector3();
    for (var j = 0; j < pa.count; j++) { v.fromBufferAttribute(pa, j).normalize(); na.setXYZ(j, v.x, v.y, v.z); } // smooth normals
    var gt = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 165, 165, 165, 255, 205, 205, 205, 255]), 3, 1, THREE.RGBAFormat);
    gt.minFilter = gt.magFilter = THREE.NearestFilter; gt.generateMipmaps = false; gt.needsUpdate = true;
    V = {
      puff: new Ring(400, ball, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gt })),
      core: new Ring(64, ball, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false })),
      tmp: { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(),
             c: new THREE.Color(), ax: new THREE.Vector3(0.3, 1, 0.2).normalize() },
      col: { ink: new THREE.Color(0x1a1a1d), ink2: new THREE.Color(0x26262a), grey: new THREE.Color(0x5a5a5e),
             grey2: new THREE.Color(0x707074), hot: new THREE.Color(0xffb060), hot2: new THREE.Color(0xc04010) }
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

  // Burst look: orange flash core + a few black puffs that linger ~5 s and drift downwind (stronger aloft).
  function burstFx(x, y, z) {
    if (!V) return;
    var R = Math.random, C = V.col, w = WW.wind || { x: 0.3, z: 0 }, wk = 1.8;
    V.core.spawn(x, y, z, 0, 0, 0, 0.2 + R() * 0.08, 0.6, 1.6, C.hot, C.hot2);
    var n = 2 + (R() < 0.5 ? 1 : 0);
    for (var i = 0; i < n; i++) {
      var big = i === 0, sz = big ? 2.1 + R() * 0.5 : 1.1 + R() * 0.6;
      V.puff.spawn(x + (R() - 0.5) * 1.2, y + (R() - 0.5) * 0.8, z + (R() - 0.5) * 1.2,
        w.x * wk + (R() - 0.5) * 0.5, 0.12 + R() * 0.15, w.z * wk + (R() - 0.5) * 0.5,
        3.6 + R() * 2.0, sz * 0.3, sz, big ? C.ink : C.ink2, big ? C.grey : C.grey2);
    }
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
    var cp = WW.camera && WW.camera.position, mp = p.mesh && p.mesh.position, k = cp && mp ? Math.min(1, Math.max(0, (mp.distanceTo(cp) - 6) / 14)) : 1;
    if (p.mesh) { p.mesh.visible = k > 0.03; p.mesh.scale.set(p.len * f * k, p.w * (0.5 + 0.5 * f) * k, p.w * (0.5 + 0.5 * f) * k); }
  }
  // one round = a solid hot core + a wider additive glow sheath on the same path (two pooled projectiles)
  function tracerRound(ci, mat, sx, sy, sz, vx, vy, vz, delay, life) {
    for (var g = 0; g < 2; g++) {
      var p = ci.acquire('aatracer', ci.G.shell, g ? V.trGlow : mat);
      p.x0 = sx; p.y0 = sy; p.z0 = sz; p.vx = vx; p.vy0 = vy; p.vz = vz;
      p.delay = delay; p.life = life; p.len = g ? TR_LEN * 1.25 : TR_LEN; p.w = g ? TR_W * 2.8 : TR_W;
      if (p.mesh) { p.mesh.scale.set(p.len, p.w, p.w); p.mesh.visible = delay <= 0; }
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
      tracerRound(ci, s.nation === 'IJN' ? V.trIJN : V.trUSN, sx, sy, sz, dx / d * TR_SPEED, dy / d * TR_SPEED, dz / d * TR_SPEED,
        k * (0.055 + R() * 0.03), Math.min(0.8, (d / TR_SPEED) * 1.3));
    }
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
    if (V) V.core.spawn(gx, 3, gz, 0, 0.5, 0, 0.16, 0.9, 1.8, V.col.hot, V.col.hot2);
    if (WW.fx && WW.fx.muzzleFlash) try { WW.fx.muzzleFlash(gx, 3, gz); } catch (e) { /* ignore */ }
    WW.emit('aaHeavyFired', { ship: s, x: gx, y: 3, z: gz, target: pl });   // sound (audio_aa.js)
  }

  function detonate(b, planes) {
    dbg.bursts++;
    burstFx(b.x, b.y, b.z);
    WW.emit('flakBurst', { x: b.x, y: b.y, z: b.z, ship: b.ship, nation: b.nation });   // sound (audio_aa.js)
    var R = HEAVY.radius, J = HEAVY.jinkRadius;
    for (var j = 0; j < planes.length; j++) {
      var pl = planes[j];
      if (!pl || !pl.alive || pl.nation === b.nation) continue;
      var dx = pl.x - b.x, dy = (pl.y || 0) - b.y, dz = pl.z - b.z;
      if (dx > J || dx < -J || dz > J || dz < -J) continue;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < R) { var f = 1 - d / R; hitPlane(pl, b.dmg * f * f, b.ship, 'heavyKills'); }
      if (pl.alive && d < J && pl.kind !== 'fighter') pl.jink = Math.min(1, (pl.jink || 0) + 0.5 * (1 - d / J) + 0.2);
    }
  }

  // ---------- per-ship fire control ----------
  // the ship's side has the plane on its plots (intel.js: AA directors and lookouts)
  function detected(s, pl) { return !WW.intel || WW.intel.visible(s.nation, pl, 1.5); }
  function update(dt) {
    var ships = (WW.world && WW.world.ships) || [], planes = (WW.world && WW.world.planes) || [];
    if (V) { V.puff.update(dt, false); V.core.update(dt, true); }
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
          var sc = d3 * (pl.kind === 'fighter' ? 1.7 : 1) * (pl.ordnance ? 0.8 : 1);   // bombers with ordnance first
          if (sc < bs) { bs = sc; best = pl; }
        }
        if (best) heavySalvo(s, best, aa.dps * hs);
      }
      if (tm.l <= 0) {
        tm.l += LIGHT.interval; if (tm.l <= 0) tm.l = LIGHT.interval * rnd();
        var lt = null, bd = aa.range * aa.range;
        for (var k = 0; k < planes.length; k++) {
          var p2 = planes[k];
          if (!p2 || !p2.alive || p2.nation === s.nation || (p2.y || 0) > LIGHT.maxAlt) continue;
          var ex = p2.x - s.x, ez = p2.z - s.z, ey = (p2.y || 0), dd = ex * ex + ez * ez + ey * ey;
          if (dd < bd && detected(s, p2)) { bd = dd; lt = p2; }
        }
        if (!lt) continue;
        var frac = Math.sqrt(bd) / aa.range;
        var hc = LIGHT.hitK * (1.4 - 0.8 * frac) * (lt.kind === 'fighter' ? 0.6 : 1) * exposure(lt);
        var hit = rnd() < hc;
        if (hit) hitPlane(lt, aa.dps * (1 - hs) * LIGHT.interval * LIGHT.dmgK, s, 'lightKills');
        tracerStream(s, lt, hit);   // visual only: every light-AA tick shows a stream
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
    cfg: { HEAVY: HEAVY, LIGHT: LIGHT, JINK: JINK, HEAVY_SHARE: HEAVY_SHARE },
    _debug: function () {
      return { pending: pending.length, peakPending: dbg.peakPending, bursts: dbg.bursts, heavyKills: dbg.heavyKills, lightKills: dbg.lightKills,
               puffs: V ? V.puff.mesh.count : 0, cores: V ? V.core.mesh.count : 0 };
    }
  };
  if (WW.combat && WW.combat._i) WW.combat._i.updaters.aatracer = updateTracerAA;
})();
