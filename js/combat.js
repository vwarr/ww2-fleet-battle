// combat.js — owner D. Projectile pool, shells, shared hit test, AA.
// Torpedoes, bombs and depth charges are in combat_weapons.js (loads next).
window.WW = window.WW || {};
(function () {
  'use strict';
  var WW = window.WW;

  // ---------- tunables ----------
  // hSpeed: horizontal speed factor of WW.SHELL[cal].speed. g: per-calibre gravity (arc look).
  var BALLISTIC = {
    mg:    { hSpeed: 1.0,  g: 6,  tracer: true,  len: 1.6, disp: 0.04, c: 0.4 },
    small: { hSpeed: 0.9,  g: 12, tracer: true,  len: 1.2, disp: 0.09, c: 1.0 },
    med:   { hSpeed: 0.7,  g: 22, tracer: false, len: 0.7, disp: 0.10, c: 1.0 },
    big:   { hSpeed: 0.5,  g: 26, tracer: false, len: 0.9, disp: 0.085, c: 1.2 }
  };
  var AA_INTERVAL = 0.25;
  var BEAM_FRAC = 0.12;      // half-beam = length * BEAM_FRAC
  var SPOT_DISP = 0.85, SPOT_MIN = 60;  // target spotted by a scout floatplane (air_scouts.js): dispersion x0.85 beyond 60 units

  // ---------- helpers ----------
  function rnd() { return WW.rand ? WW.rand() : Math.random(); }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function fx(name, a, b, c, d, e) {
    try { if (WW.fx && typeof WW.fx[name] === 'function') WW.fx[name](a, b, c, d, e); } catch (err) { /* never throw */ }
  }
  function stat(k, n) { if (WW.stats) WW.stats[k] = (WW.stats[k] || 0) + (n || 1); }
  function depthAt(x, z) {
    try { return (WW.terrain && WW.terrain.depthAt) ? WW.terrain.depthAt(x, z) : 10; } catch (e) { return 10; }
  }
  function shipLen(s) { return (s.stats && s.stats.length) || 12; }
  function shipUsable(s) { return s && s.alive && !s.sinking; }

  // Oriented hull test. pad widens the box (splash radius etc.).
  function onHull(s, x, z, pad) {
    var h = s.heading || 0, c = Math.cos(h), sn = Math.sin(h);
    var dx = x - s.x, dz = z - s.z;
    var L = shipLen(s);
    var along = dx * c + dz * sn, across = -dx * sn + dz * c;
    return Math.abs(along) < L / 2 + pad * 0.5 && Math.abs(across) < L * BEAM_FRAC + pad;
  }
  // First enemy ship (of shooterNation) whose hull covers (x,z). opts.subs: include submerged subs.
  function findHit(shooterNation, x, z, pad, includeSubmerged, prefer) {
    if (prefer && shipUsable(prefer) && prefer.nation !== shooterNation &&
        (includeSubmerged || !prefer.submerged) && onHull(prefer, x, z, pad)) return prefer;
    var list = (WW.world && WW.world.ships) || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!shipUsable(s) || s.nation === shooterNation) continue;
      if (s.submerged && !includeSubmerged) continue;
      if (onHull(s, x, z, pad)) return s;
    }
    return null;
  }
  // kind/cal (optional) let WW.damage place the right impact fx and fire site on the hull.
  function damage(s, amt, x, z, kind, cal) {
    try { if (s && s.alive && s.takeDamage) { s.takeDamage(amt, x, z, kind, cal); stat('hits'); return true; } } catch (e) { /* ignore */ }
    return false;
  }

  // ---------- shared geometry / materials / pool ----------
  var G = {}, M = {}, pool = [], active = [], updaters = {};
  var tmpV = null;

  function buildShared() {
    if (G.shell || typeof THREE === 'undefined') return;
    G.shell = new THREE.BoxGeometry(1, 0.35, 0.35);
    G.torp = new THREE.BoxGeometry(2.0, 0.3, 0.3);
    G.bomb = new THREE.BoxGeometry(0.9, 0.35, 0.35);
    G.dc = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    // shells in flight stay subtle: muzzle flash and splash should draw the eye, not the round
    M.shell = new THREE.MeshBasicMaterial({ color: 0x7a7266, transparent: true, opacity: 0.6, depthWrite: false });
    M.shellBig = new THREE.MeshBasicMaterial({ color: 0x4e4a45, transparent: true, opacity: 0.7, depthWrite: false });
    // soft warm tracers (golden-hour + bloom: moderate, never pure white), partly see-through
    M.tracer = new THREE.MeshBasicMaterial({ color: 0xe6c27a, transparent: true, opacity: 0.55, depthWrite: false });
    M.tracerRed = new THREE.MeshBasicMaterial({ color: 0xe8946a, transparent: true, opacity: 0.55, depthWrite: false });
    M.torp = new THREE.MeshBasicMaterial({ color: 0x2a2f33 });
    M.bomb = new THREE.MeshBasicMaterial({ color: 0x353b2e });
    M.dc = new THREE.MeshBasicMaterial({ color: 0x222222 });
    tmpV = new THREE.Vector3();
  }

  function acquire(kind, geo, mat) {
    buildShared();
    var p = pool.pop();
    if (!p) {
      p = { mesh: null };
      if (typeof THREE !== 'undefined') {
        p.mesh = new THREE.Mesh(geo, mat);
        p.mesh.rotation.order = 'YZX';
        p.mesh.matrixAutoUpdate = true;
      }
    } else if (p.mesh) { p.mesh.geometry = geo; p.mesh.material = mat; }
    p.kind = kind; p.dead = false; p.t = 0;
    if (p.mesh) {
      p.mesh.scale.set(1, 1, 1); p.mesh.rotation.set(0, 0, 0); p.mesh.visible = true;
      if (WW.scene) WW.scene.add(p.mesh);
    }
    active.push(p);
    return p;
  }
  function release(p) {
    if (p.mesh) { p.mesh.visible = false; if (p.mesh.parent) p.mesh.parent.remove(p.mesh); }
    p.target = null; p.owner = null; p.plane = null;
    pool.push(p);
  }
  // Point mesh +x along velocity.
  function orient(p, vx, vy, vz) {
    if (!p.mesh) return;
    p.mesh.rotation.y = -Math.atan2(vz, vx);
    p.mesh.rotation.z = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz));
  }
  function place(p, x, y, z) { if (p.mesh) p.mesh.position.set(x, y, z); }

  // ---------- shells ----------
  function muzzlePos(ship, turret) {
    try {
      if (turret && turret.barrel && turret.barrel.getWorldPosition && tmpV) {
        turret.barrel.getWorldPosition(tmpV);
        if (isFinite(tmpV.x) && (tmpV.x !== 0 || tmpV.z !== 0)) return { x: tmpV.x, y: Math.max(0.5, tmpV.y), z: tmpV.z };
      }
    } catch (e) { /* fall through */ }
    return { x: ship.x, y: 2, z: ship.z };
  }

  function fireShell(ship, turret, target, cal) {
    try {
      if (!ship || !target || !target.alive) return null;
      cal = (WW.SHELL && WW.SHELL[cal]) ? cal : 'small';
      buildShared();
      var S = WW.SHELL[cal], B = BALLISTIC[cal];
      var m = muzzlePos(ship, turret);
      var hs = S.speed * B.hSpeed;
      var tsp = target.speed || 0, th = target.heading || 0;
      var tvx = Math.cos(th) * tsp, tvz = Math.sin(th) * tsp;
      // lead: two passes of T estimate
      var T = Math.max(0.15, Math.hypot(target.x - m.x, target.z - m.z) / hs);
      var ax = target.x + tvx * T, az = target.z + tvz * T;
      T = Math.max(0.15, Math.hypot(ax - m.x, az - m.z) / hs);
      ax = target.x + tvx * T; az = target.z + tvz * T;
      // dispersion grows with range
      var dist = Math.hypot(ax - m.x, az - m.z);
      var r = (B.disp * dist + B.c) * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
      if (dist > SPOT_MIN && target.spottedUntil > (WW.time ? WW.time.now : 0)) r *= SPOT_DISP;
      ax += Math.cos(a) * r; az += Math.sin(a) * r;
      T = Math.max(0.15, Math.hypot(ax - m.x, az - m.z) / hs);

      var p = acquire('shell', G.shell, B.tracer ? (ship.nation === 'IJN' ? M.tracerRed : M.tracer) : cal === 'big' ? M.shellBig : M.shell);
      p.cal = cal; p.nation = ship.nation; p.target = target; p.owner = ship;
      p.x0 = m.x; p.y0 = m.y; p.z0 = m.z; p.T = T; p.g = B.g;
      p.vx = (ax - m.x) / T; p.vz = (az - m.z) / T;
      p.vy0 = (0.5 * B.g * T * T - m.y) / T;  // lands at y=0 exactly at T
      p.dmg = S.dmg * rr(0.8, 1.2);
      if (p.mesh) {
        var k = cal === 'big' ? 0.95 : cal === 'med' ? 0.7 : cal === 'small' ? 0.6 : 0.45;
        if (B.tracer) p.mesh.scale.set(B.len * k * 1.2, k * 0.6, k * 0.6); else p.mesh.scale.set(B.len * k, k, k);
      }
      place(p, m.x, m.y, m.z); orient(p, p.vx, p.vy0, p.vz);
      fx('muzzleFlash', m.x, m.y, m.z);
      if (WW.emit) WW.emit('shellFired', { ship: ship, cal: cal, x: m.x, y: m.y, z: m.z, proj: p }); // sound hook (audio_*.js)
      stat('shellsFired');
      return p;
    } catch (e) { return null; }
  }

  function updateShell(p, dt) {
    p.t += dt;
    var t = Math.min(p.t, p.T);
    var x = p.x0 + p.vx * t, z = p.z0 + p.vz * t;
    var y = p.y0 + p.vy0 * t - 0.5 * p.g * t * t;
    place(p, x, y, z); orient(p, p.vx, p.vy0 - p.g * t, p.vz);
    if (p.t < p.T) return;
    landShell(p, x, z);
    p.dead = true;
  }

  function landShell(p, x, z) {
    var S = WW.SHELL[p.cal];
    var tgt = (p.target && p.target.alive) ? p.target : null;
    var hit = findHit(p.nation, x, z, S.splash * 0.3, false, tgt);
    if (WW.emit) WW.emit('shellLanded', { cal: p.cal, x: x, z: z, ship: hit }); // sound hook (audio_naval_wire.js)
    if (hit) {
      damage(hit, p.dmg, x, z, 'shell', p.cal);
      if (WW.damage) return;   // impact fx at the hull hit point are placed by WW.damage
      var big = p.cal === 'big' || p.cal === 'med';
      if (p.cal === 'mg') fx('sparks', x, 1, z);
      else { fx('explosion', x, 1.2, z, S.splash * 0.6); if (big) fx('sparks', x, 1.5, z); else fx('sparks', x, 1, z); }
      return;
    }
    if (depthAt(x, z) <= 0) {
      fx('explosion', x, 0.6, z, Math.max(0.4, S.splash * 0.35));
      fx('smoke', x, 0.8, z, false, S.splash * 0.5);
    } else {
      fx('splash', x, z, S.splash);
    }
  }

  // ---------- AA ----------
  var aaTimer = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  function aaTracer(sx, sy, sz, px, py, pz, nation) {
    var dx = px - sx, dy = py - sy, dz = pz - sz;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var R = Math.random, sp = 90, life = Math.min(0.45, (d / sp) * (0.5 + 0.4 * R())); // visual only: Math.random
    var p = acquire('tracer', G.shell, nation === 'IJN' ? M.tracerRed : M.tracer);
    p.x0 = sx; p.y0 = sy; p.z0 = sz;
    p.vx = dx / d * sp + (R() - 0.5) * 12; p.vy0 = dy / d * sp + (R() - 0.5) * 12; p.vz = dz / d * sp + (R() - 0.5) * 12;
    p.life = life;
    p.len = 1.3;
    if (p.mesh) p.mesh.scale.set(p.len, 0.2, 0.2);
    place(p, sx, sy, sz); orient(p, p.vx, p.vy0, p.vz);
  }
  function updateTracer(p, dt) {
    p.t += dt;
    if (p.t >= p.life) { p.dead = true; return; }
    place(p, p.x0 + p.vx * p.t, p.y0 + p.vy0 * p.t, p.z0 + p.vz * p.t);
    var f = Math.min(1, (p.life - p.t) / (p.life * 0.4)); // short fade-out: shrink over the last 40% of its life
    if (p.mesh) p.mesh.scale.set(p.len * f, 0.2 * (0.4 + 0.6 * f), 0.2 * (0.4 + 0.6 * f));
  }

  function updateAA(dt) {
    if (WW.combatAA) { WW.combatAA.update(dt); return; } // heavy/light AA, flak bursts, jinking: combat_aa.js
    var ships = (WW.world && WW.world.ships) || [], planes = (WW.world && WW.world.planes) || [];
    if (!planes.length || !aaTimer) return;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!shipUsable(s) || s.submerged || !s.stats || !s.stats.aa) continue;
      var tm = (aaTimer.get(s) || 0) - dt;
      if (tm > 0) { aaTimer.set(s, tm); continue; }
      aaTimer.set(s, tm + AA_INTERVAL > 0 ? tm + AA_INTERVAL : AA_INTERVAL * rnd());
      var aa = s.stats.aa, best = null, bd = aa.range * aa.range;
      for (var j = 0; j < planes.length; j++) {
        var pl = planes[j];
        if (!pl || !pl.alive || pl.nation === s.nation) continue;
        var dx = pl.x - s.x, dz = pl.z - s.z, dy = (pl.y || 0);
        var d2 = dx * dx + dz * dz + dy * dy;
        if (d2 < bd) { bd = d2; best = pl; }
      }
      if (!best) continue;
      var d = Math.sqrt(bd), frac = d / aa.range;
      var hc = 0.35 * (1.4 - 0.8 * frac) * (best.kind === 'fighter' ? 0.6 : 1);
      try { if (best.damage) best.damage(aa.dps * AA_INTERVAL * hc); } catch (e) { /* ignore */ }
      if (rnd() < 0.7) fx('flak', best.x + rr(-3, 3), (best.y || 5) + rr(-2, 3), best.z + rr(-3, 3));
      if (Math.random() < 0.5) { // about half as many tracers as before (visual only)
        var R = Math.random;
        aaTracer(s.x + (R() - 0.5) * 4, 2.5, s.z + (R() - 0.5) * 4,
                 best.x + (R() - 0.5) * 4, (best.y || 5) + (R() - 0.5) * 2, best.z + (R() - 0.5) * 4, s.nation);
      }
    }
  }

  // ---------- module ----------
  WW.combat = {
    init: function () { buildShared(); },
    update: function (dt) {
      if (!(dt > 0)) return;
      try { updateAA(dt); } catch (e) { /* never throw */ }
      for (var i = 0; i < active.length; i++) {
        var p = active[i];
        try {
          if (p.kind === 'shell') updateShell(p, dt);
          else if (p.kind === 'tracer') updateTracer(p, dt);
          else if (updaters[p.kind]) updaters[p.kind](p, dt);
          else p.dead = true;
        } catch (e) { p.dead = true; }
      }
      // compact
      var w = 0;
      for (var r = 0; r < active.length; r++) {
        var q = active[r];
        if (q.dead) release(q); else active[w++] = q;
      }
      active.length = w;
    },
    clearAll: function () {
      for (var i = 0; i < active.length; i++) release(active[i]);
      active.length = 0;
      if (typeof WeakMap !== 'undefined') aaTimer = new WeakMap();
      if (WW.combatAA) WW.combatAA.clearAll();
    },
    fireShell: fireShell,
    // internals shared with combat_weapons.js
    _i: {
      acquire: acquire, place: place, orient: orient, findHit: findHit, onHull: onHull,
      damage: damage, fx: fx, stat: stat, depthAt: depthAt, rnd: rnd, rr: rr,
      G: G, M: M, buildShared: buildShared, updaters: updaters, shipUsable: shipUsable,
      active: active // live projectiles (read-only outside combat: intel.js torpedo sightings)
    },
    _debug: function () { return { active: active.length, free: pool.length, total: active.length + pool.length }; }
  };
})();
