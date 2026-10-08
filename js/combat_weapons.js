// combat_weapons.js — owner D. Torpedoes, bombs, depth charges. Loads after combat.js.
window.WW = window.WW || {};
(function () {
  'use strict';
  var WW = window.WW;
  if (!WW.combat || !WW.combat._i) return;
  var I = WW.combat._i;
  var GRAV = 9.8;

  // ---------- torpedoes ----------
  function fireTorpedo(owner, x, z, heading, nation, range) {
    try {
      if (!isFinite(x) || !isFinite(z)) return null;
      nation = nation || (owner && owner.nation);
      I.buildShared();
      var p = I.acquire('torp', I.G.torp, I.M.torp);
      p.x = x; p.z = z; p.h = heading || 0; p.nation = nation; p.owner = owner || null;
      p.sp = (WW.TORPEDO && WW.TORPEDO.speed) || 14;
      p.range = range || 100; p.run = 0; p.wakeT = 0;
      p.dmg = ((WW.TORPEDO && WW.TORPEDO.dmg) || 220) * I.rr(0.9, 1.1);
      I.place(p, x, -0.2, z); I.orient(p, Math.cos(p.h), 0, Math.sin(p.h));
      I.fx('splash', x, z, 0.8);
      I.stat('torpedoesFired');
      if (WW.emit) WW.emit('weaponDropped', { kind: 'torpedo', proj: p, plane: owner || null }); // camera hand-off hook
      return p;
    } catch (e) { return null; }
  }

  function updateTorp(p, dt) {
    var c = Math.cos(p.h), s = Math.sin(p.h);
    // sub-step so a fast step never skips over a narrow hull
    var total = p.sp * dt, steps = Math.max(1, Math.ceil(total / 0.5)), d = total / steps;
    for (var i = 0; i < steps; i++) {
      p.x += c * d; p.z += s * d; p.run += d;
      if (I.depthAt(p.x, p.z) < 1) {
        I.fx('splash', p.x, p.z, 1.2);
        if (I.depthAt(p.x, p.z) <= 0) I.fx('explosion', p.x, 0.5, p.z, 0.8);
        if (WW.emit) WW.emit('weaponImpact', { kind: 'torpedo', proj: p, x: p.x, z: p.z, ship: null });
        p.dead = true; return;
      }
      var hit = I.findHit(p.nation, p.x, p.z, 0.4, true, null);
      if (hit) {
        I.damage(hit, p.dmg, p.x, p.z, 'torpedo');
        if (!WW.damage) { I.fx('splash', p.x, p.z, 4); I.fx('explosion', p.x, 0.8, p.z, 2.5); }
        if (WW.emit) WW.emit('weaponImpact', { kind: 'torpedo', proj: p, x: p.x, z: p.z, ship: hit });
        p.dead = true; return;
      }
      if (p.run >= p.range) { if (WW.emit) WW.emit('weaponImpact', { kind: 'torpedo', proj: p, x: p.x, z: p.z, ship: null }); p.dead = true; return; }
    }
    I.place(p, p.x, -0.2, p.z);
    p.wakeT -= dt;
    if (p.wakeT <= 0) { p.wakeT = 0.1; I.fx('wake', p.x, p.z, p.h, 0.5); }
  }

  // ---------- bombs ----------
  function dropBomb(plane, target) {
    try {
      if (!plane) return null;
      I.buildShared();
      var y = Math.max(0.5, plane.y || 10);
      var T = Math.sqrt(2 * y / GRAV);
      var h = plane.heading || 0;
      var psp = plane.speed || (WW.PLANE_TYPES && WW.PLANE_TYPES[plane.kind] && WW.PLANE_TYPES[plane.kind].speed) || 30;
      var vx = Math.cos(h) * psp * 0.6, vz = Math.sin(h) * psp * 0.6;
      if (target && target.alive) {
        // steer the throw toward the target's predicted position, limited to plane speed
        var tsp = target.speed || 0, th = target.heading || 0;
        var ax = target.x + Math.cos(th) * tsp * T, az = target.z + Math.sin(th) * tsp * T;
        var wx = (ax - plane.x) / T, wz = (az - plane.z) / T, wm = Math.hypot(wx, wz), cap = psp * 1.2;
        if (wm > cap) { wx *= cap / wm; wz *= cap / wm; }
        vx = wx; vz = wz;
      }
      var sc = 4 + y * 0.25, vy0 = 0, dv = plane.dropV;   // scatter grows with drop height
      if (dv) { // dive release (air_strikes.js): keep the plane's dive velocity, small bomb-sight trim, ~1 unit scatter
        vy0 = Math.min(0, dv.y); T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAV * y)) / GRAV; vx = dv.x; vz = dv.z; sc = 0.6 + y * 0.03;
        if (target && target.alive) {
          var ex = target.x + Math.cos(target.heading || 0) * (target.speed || 0) * T - (plane.x + vx * T);
          var ez = target.z + Math.sin(target.heading || 0) * (target.speed || 0) * T - (plane.z + vz * T), em = Math.hypot(ex, ez) / T, ec = 5;
          if (em > ec) { ex *= ec / em; ez *= ec / em; }
          vx += ex / T; vz += ez / T;
        }
      }
      vx += I.rr(-sc, sc) / T; vz += I.rr(-sc, sc) / T;
      var p = I.acquire('bomb', I.G.bomb, I.M.bomb);
      p.x = plane.x; p.y = y; p.z = plane.z; p.vx = vx; p.vy = vy0; p.vz = vz;
      p.nation = plane.nation; p.target = target || null;
      p.dmg = ((WW.BOMB && WW.BOMB.dmg) || 180) * I.rr(0.85, 1.15);
      I.place(p, p.x, p.y, p.z); I.orient(p, vx, vy0, vz);
      I.stat('bombsDropped');
      if (WW.emit) WW.emit('weaponDropped', { kind: 'bomb', proj: p, plane: plane, target: target || null }); // camera hand-off hook
      return p;
    } catch (e) { return null; }
  }

  function updateBomb(p, dt) {
    p.vy -= GRAV * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    I.place(p, p.x, Math.max(0, p.y), p.z); I.orient(p, p.vx, p.vy, p.vz);
    if (p.y > 0.3) return;
    var tgt = (p.target && p.target.alive) ? p.target : null;
    var hit = I.findHit(p.nation, p.x, p.z, 0.6, false, tgt);
    if (hit) {
      I.damage(hit, p.dmg, p.x, p.z, 'bomb');
      if (!WW.damage) { I.fx('explosion', p.x, 1.5, p.z, 2.2); I.fx('sparks', p.x, 1.5, p.z); }
    } else if (I.depthAt(p.x, p.z) <= 0) {
      I.fx('explosion', p.x, 0.6, p.z, 1.2); I.fx('smoke', p.x, 1, p.z, true, 1.5);
    } else {
      I.fx('splash', p.x, p.z, 3);
    }
    if (WW.emit) WW.emit('weaponImpact', { kind: 'bomb', proj: p, x: p.x, z: p.z, ship: hit || null });
    p.dead = true;
  }

  // ---------- depth charges ----------
  function dropDepthCharge(ship, x, z) {
    try {
      I.buildShared();
      if (!isFinite(x) || !isFinite(z)) { if (!ship) return null; x = ship.x; z = ship.z; }
      var p = I.acquire('dc', I.G.dc, I.M.dc);
      p.x = x; p.z = z; p.y = 0.4; p.fuse = I.rr(1.8, 2.3);
      p.nation = ship ? ship.nation : null; p.owner = ship || null;
      I.place(p, x, p.y, z);
      I.fx('splash', x, z, 0.6);
      I.stat('depthCharges');
      return p;
    } catch (e) { return null; }
  }

  function updateDC(p, dt) {
    p.t += dt;
    p.y = Math.max(-6, p.y - 2.2 * dt);
    I.place(p, p.x, p.y, p.z);
    if (p.mesh) p.mesh.visible = p.y > -1.5;   // fades from view as it sinks
    if (p.t < p.fuse) return;
    p.dead = true;
    if (I.depthAt(p.x, p.z) <= 0) return;      // rolled onto land: dud
    I.fx('splash', p.x, p.z, 4);
    I.fx('splash', p.x + I.rr(-1, 1), p.z + I.rr(-1, 1), 2.5);
    var R = (WW.DEPTH_CHARGE && WW.DEPTH_CHARGE.radius) || 6;
    var D = (WW.DEPTH_CHARGE && WW.DEPTH_CHARGE.dmg) || 120;
    var list = (WW.world && WW.world.ships) || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!I.shipUsable(s) || s.nation === p.nation || (s.type !== 'submarine' && !s.submerged)) continue;
      var d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > R) continue;
      var amt = D * (1 - 0.6 * d / R) * (s.submerged ? 1 : 0.5);
      I.damage(s, amt, p.x, p.z, 'dc');
    }
  }

  I.updaters.torp = updateTorp;
  I.updaters.bomb = updateBomb;
  I.updaters.dc = updateDC;
  WW.combat.fireTorpedo = fireTorpedo;
  WW.combat.dropBomb = dropBomb;
  WW.combat.dropDepthCharge = dropDepthCharge;
})();
