// combat_weapons.js — owner D. Torpedoes, bombs, depth charges. Loads after combat.js.
window.WW = window.WW || {};
(function () {
  'use strict';
  var WW = window.WW;
  if (!WW.combat || !WW.combat._i) return;
  var I = WW.combat._i;
  var GRAV = 9.8;
  var EVADE = 0.7;   // u/s: a ship's drift off its predicted track while it turns under a high level-bombing attack

  // ---------- torpedoes ----------
  // drop (optional, an aerial release: air_attack.js run): { y, v, vy } the height it leaves the belly at and the
  // plane's speed and climb rate; it falls (TORP_G) carrying the plane's way, nose a touch down, and its run starts
  // where it enters the water. A ship's tube launch starts in the water.
  var TORP_G = 4;   // u/s^2: the fall from the game's compressed drop height takes ~1-1.5 s (a real 30-60 m drop: 2.5-3.5 s)
  function fireTorpedo(owner, x, z, heading, nation, range, drop) {
    try {
      if (!isFinite(x) || !isFinite(z)) return null;
      nation = nation || (owner && owner.nation);
      I.buildShared();
      var p = I.acquire('torp', I.G.torp, I.M.torp);
      p.x = x; p.z = z; p.h = heading || 0; p.nation = nation; p.owner = owner || null;
      // the launcher's nation torpedo (core.js WW.TORPEDO_NATION): a ship's own stats, a plane's 'air' entry
      var q = owner && owner.stats && owner.stats.torpedoes ? owner.stats.torpedoes : WW.torpSpec ? WW.torpSpec(nation, 'air') : {};
      p.sp = q.speed || (WW.TORPEDO && WW.TORPEDO.speed) || 14;
      p.sight = q.sight || 1;                      // the wake: x the range a ship's lookouts can see it at (intel.js TL.WAKE)
      p.dud = q.dud > 0 && WW.rand() < q.dud;      // rolled at launch (seeded): a dud hits with a clang and no damage
      p.src = owner && owner.stats ? 'Ship' : 'Air';
      if (WW.dstat) WW.dstat('torpFired' + p.src, nation);
      p.range = range || 100; p.run = 0; p.wakeT = 0; p.under = null;
      p.dmg = ((WW.TORPEDO && WW.TORPEDO.dmg) || 220) * (q.dmgK || 1) * I.rr(0.9, 1.1);   // the nation's warhead (core.js TORPEDO_NATION dmgK)
      p.fall = !!(drop && drop.y > 0);
      if (p.fall) {
        p.y = drop.y; p.vy = Math.min(0, drop.vy || 0); p.vh = drop.v || p.sp;
        airLook(p, owner);
        I.place(p, x, p.y, z); I.orient(p, Math.cos(p.h) * p.vh, p.vy - 1, Math.sin(p.h) * p.vh);   // nose a little down
      } else {
        I.place(p, x, -0.2, z); I.orient(p, Math.cos(p.h), 0, Math.sin(p.h));
        I.fx('splash', x, z, 0.8);
      }
      I.stat('torpedoesFired');
      if (WW.emit) WW.emit('weaponDropped', { kind: 'torpedo', proj: p, plane: owner || null }); // camera hand-off hook
      return p;
    } catch (e) { return null; }
  }

  // In the air the torpedo is drawn as the plane's own payload (models_planes.js ordnance: the Mk 13 / Type 91 body,
  // nose and fins, its material, at the airframe's scale); at water entry it goes back to the underwater run mesh.
  // Visual only: the projectile keeps one mesh slot, its geometry and material swapped (combat.js acquire restores them).
  function airLook(p, owner) {
    var pm = owner && owner.payload;
    if (!p.mesh || !pm || !pm.geometry || typeof THREE === 'undefined') { if (p.mesh) p.mesh.scale.set(0.65, 0.45, 0.45); return; }
    var k = owner.group && owner.group.scale ? owner.group.scale.x : 1;
    p.mesh.geometry = pm.geometry; p.mesh.material = I.M.ord || pm.material; p.mesh.scale.set(k, k, k);
  }
  // A falling bomb's shape (visual): models_planes.js ordnance() lofted and baked once per size, ogive nose, body
  // tapering to a box-finned tail, nose +x (I.orient points it along its velocity): the SBD's 1,000 lb AN-M65, the
  // Val's 250 kg, a level bomber's 500 lb class (bombK < 0.75); olive drab for the USN, dark grey for the IJN.
  // At the carrier planes' scale (aircraft.js PLANE_SCALE), as it hung under the belly.
  var ORD = {};
  function ordGeo(key, len, r, hex) {
    if (ORD[key] !== undefined) return ORD[key];
    ORD[key] = null;
    var kit = WW.models && WW.models._planeKit;
    try { if (kit && typeof THREE !== 'undefined') { kit.init(); var g = new THREE.Group(); kit.ordnance(g, false, len, r, hex); ORD[key] = kit.bake(g); } } catch (e) { ORD[key] = null; }
    return ORD[key];
  }
  function bombLook(p, bk, nation) {
    if (!p.mesh || WW.simOnly || !I.M.ord) return;
    var J = nation === 'IJN', hex = J ? 0x585e66 : 0x5c6040;
    var geo = bk >= 0.9 ? ordGeo('l' + J, 0.43, 0.058, hex) : bk >= 0.75 ? ordGeo('m' + J, 0.46, 0.04, hex) : ordGeo('s' + J, 0.36, 0.042, hex);
    if (!geo) return;
    var k = (WW.cfg && WW.cfg.PLANE_SCALE) || 0.82;
    p.mesh.geometry = geo; p.mesh.material = I.M.ord; p.mesh.scale.set(k, k, k);
  }
  function waterLook(p) {
    if (!p.mesh) return;
    p.mesh.geometry = I.G.torp; p.mesh.material = I.M.torp; p.mesh.scale.set(1, 1, 1);
  }
  function updateTorp(p, dt) {
    var c = Math.cos(p.h), s = Math.sin(p.h);
    if (p.fall) { // in the air under the plane's line: no hits; it enters the water with a splash and runs from there
      p.vy -= TORP_G * dt; p.y += p.vy * dt; p.x += c * p.vh * dt; p.z += s * p.vh * dt;
      if (p.y > 0) { I.place(p, p.x, p.y, p.z); I.orient(p, c * p.vh, p.vy - 1, s * p.vh); return; }
      p.fall = false;
      waterLook(p);
      I.place(p, p.x, -0.2, p.z); I.orient(p, c, 0, s);
      I.fx('splash', p.x, p.z, 0.9);
      return;
    }
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
      // A PT boat drew ~1-1.6 m (Elco 80 ft, the Vosper and S-boats alike); torpedoes ran at 3-6 m for a hull (an aerial
      // Mk 13 or Type 91 at 3-5 m, a destroyer's Mk 15 / Type 93 deeper against anything bigger than a destroyer): one
      // that reaches a PT runs on under her, once (a surfaced submarine, ~4.5-5 m down to the keel, is hit as before).
      if (hit && hit.type === 'pt') {
        if (p.under !== hit) { p.under = hit; if (WW.emit) WW.emit('torpedoUnder', { proj: p, ship: hit, x: p.x, z: p.z }); }
        hit = null;
      }
      if (hit && p.dud) { // a dud: it hits the hull and does not go off (fx only; no damage)
        I.fx('splash', p.x, p.z, 1.8); I.fx('sparks', p.x, 0.8, p.z); I.fx('sparks', p.x, 1.2, p.z); // a thin column, a clang: no fireball
        if (WW.dstat) WW.dstat('torpDud' + p.src, p.nation);
        if (WW.emit) { WW.emit('torpedoDud', { proj: p, ship: hit, x: p.x, z: p.z }); WW.emit('weaponImpact', { kind: 'torpedo', proj: p, x: p.x, z: p.z, ship: hit, dud: true }); }
        p.dead = true; return;
      }
      if (hit) {
        if (WW.dstat) WW.dstat('torpHit' + p.src, p.nation);
        var tv = WW.TORPEDO && WW.TORPEDO.vs && WW.TORPEDO.vs[hit.type];   // below the waterline (core.js WW.TORPEDO.vs)
        I.damage(hit, p.dmg * (tv === undefined ? 1 : tv), p.x, p.z, 'torpedo');
        if (!WW.damage) { I.fx('splash', p.x, p.z, 4); I.fx('explosion', p.x, 0.8, p.z, 2.5); }
        if (WW.emit) WW.emit('weaponImpact', { kind: 'torpedo', proj: p, x: p.x, z: p.z, ship: hit });
        p.dead = true; return;
      }
      if (p.run >= p.range) { if (WW.emit) WW.emit('weaponImpact', { kind: 'torpedo', proj: p, x: p.x, z: p.z, ship: null }); p.dead = true; return; }
    }
    I.place(p, p.x, -0.2, p.z);
    // the track on the water: a steam torpedo leaves a bubbly white streak, an oxygen one (sight < 1) a faint trace
    p.wakeT -= dt;
    if (p.wakeT <= 0) {
      if (p.sight < 1) { p.wakeT = 0.2; I.fx('wake', p.x, p.z, p.h, 0.45, true); }
      else { p.wakeT = 0.1; I.fx('wake', p.x, p.z, p.h, 0.7); if (p.run % 3 < 1) I.fx('torpBubbles', p.x, p.z, p.h); }
    }
  }

  // ---------- bombs ----------
  // AA dps of the ships (not of `nation`) within r of (x, z): the screen a dive bomber pushes over into
  function flakAt(nation, x, z, r) {
    var list = (WW.world && WW.world.ships) || [], f = 0;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!I.shipUsable(s) || s.nation === nation || s.submerged || !s.stats || !s.stats.aa) continue;
      if (WW.dist2(s.x, s.z, x, z) < r * r) f += s.stats.aa.dps * (s.sup && s.sup.aa <= 0 ? 0 : 1);   // a battery out of AA ammunition (ship_supply.js) does not count
    }
    return f;
  }
  // Dive-bombing aim error (core.js WW.BOMB.aim): a ground offset { x, z } (Gaussian, WW.rand), plus the target's
  // evasion (aim.ev by type x its way on: a ship under helm put over in the ~10 s of the real bomb's fall, which the
  // game's compressed release height does not carry; a destroyer combs most of them)
  function gauss() { return (I.rr(0, 1) + I.rr(0, 1) + I.rr(0, 1) + I.rr(0, 1) - 2) * 1.7320508; }
  function diveAim(plane, dv, y) {
    var A = (WW.BOMB && WW.BOMB.aim) || { k: 0.25, flakK: 0.035, flakR: 60, flakMax: 2 };
    var hs = Math.hypot(dv.x, dv.z) || 1e-6, sinG = Math.max(0.5, -dv.y / Math.hypot(hs, dv.y || 0));
    var slant = y / sinG, aim = plane.diveTgt || plane.target;
    var fk = 1 + Math.min(A.flakMax, A.flakK * (aim ? flakAt(plane.nation, aim.x, aim.z, A.flakR) : 0));
    if (WW.intercept && WW.intercept.harried) fk *= 1 + WW.intercept.HARRY.aim * WW.intercept.harried(plane);   // a fighter on its tail / a shot-up plane (air_intercept.js)
    var ev = aim && aim.stats && aim.stats.speed > 0 && A.ev ? (A.ev[aim.type] || 0) * Math.min(1, (aim.speed || 0) / aim.stats.speed) : 0;
    var sa = A.k * slant * fk + ev, sl = sa / sinG, fx = dv.x / hs, fz = dv.z / hs, ea = gauss() * sa, el = gauss() * sl;
    return { x: fx * el - fz * ea, z: fz * el + fx * ea };
  }
  // The pilot's error, rolled at the push-over (air_attack.js dive): he dives on the wrong point and the bomb leaves
  // along his dive line, rather than being thrown off it at the release. Estimated from the dive angle and the
  // release height ahead (the floor + ~4 of pull-out: air_attack.js pullLoss).
  function diveErr(plane) {
    var ang = (plane.pt && plane.pt.ang) || 1.2, h = plane.heading || 0;
    return diveAim(plane, { x: Math.cos(h) * Math.cos(ang), y: -Math.sin(ang), z: Math.sin(h) * Math.cos(ang) }, plane.floor ? plane.floor + 4 : 14);
  }
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
      // a land-based level bomber (land_air.js plane.level) on a ship under way: from 6,000-7,000 m the bombs fell for 35-40 s
      // and the ship turned under them (the B-17s at Midway hit nothing): the scatter grows with the real time of fall
      // (from the real height, WW.altOf inverted) and the ship's speed. Same draws: no effect on other bombs.
      if (plane.level && target && !target.isBase && target.stats && target.stats.speed > 0)
        sc += EVADE * Math.min(1, (target.speed || 0) / target.stats.speed) * Math.sqrt(2 * Math.pow(y / 0.4, 1 / 0.59) / GRAV);
      if (dv) { // dive release (air_attack.js): the plane's dive velocity, a small trim toward the point he dived on
        // (plane.aimX / aimZ: the ship at the bomb's fall plus his error, rolled at the push-over: diveErr), so the
        // bomb leaves along the dive line (~10 deg off at most); a release without one rolls the error here
        vy0 = Math.min(0, dv.y); T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * GRAV * y)) / GRAV; vx = dv.x; vz = dv.z; sc = 0;
        var pre = !!plane.aimE && plane.aimX !== undefined, ec = pre ? 4 : 5;
        if (pre || (target && target.alive)) {
          var ex = (pre ? plane.aimX : target.x + Math.cos(target.heading || 0) * (target.speed || 0) * T) - (plane.x + vx * T);
          var ez = (pre ? plane.aimZ : target.z + Math.sin(target.heading || 0) * (target.speed || 0) * T) - (plane.z + vz * T), em = Math.hypot(ex, ez) / T;
          if (em > ec) { ex *= ec / em; ez *= ec / em; }
          vx += ex / T; vz += ez / T;
        }
        if (!pre) { var ae = diveAim(plane, dv, y); vx += ae.x / T; vz += ae.z / T; }
      }
      if (sc) { vx += I.rr(-sc, sc) / T; vz += I.rr(-sc, sc) / T; }
      var p = I.acquire('bomb', I.G.bomb, I.M.bomb);
      p.x = plane.x; p.y = y; p.z = plane.z; p.vx = vx; p.vy = vy0; p.vz = vz;
      p.nation = plane.nation; p.target = target || null;
      var BK = plane.level && plane.level.bombK || (plane.pt && plane.pt.bombK) || (WW.BOMB && WW.BOMB.bombK) || 1;   // the bomb it carries (core.js WW.BOMB)
      p.dmg = ((WW.BOMB && WW.BOMB.dmg) || 180) * BK * I.rr(0.85, 1.15); p.bk = BK;
      bombLook(p, BK, plane.nation);
      I.place(p, p.x, p.y, p.z); I.orient(p, vx, vy0, vz);
      I.stat('bombsDropped');
      if (WW.emit) WW.emit('weaponDropped', { kind: 'bomb', proj: p, plane: plane, target: target || null }); // camera hand-off hook
      return p;
    } catch (e) { return null; }
  }

  // A bomb bursting in the water close aboard (WW.BOMB.near): the nearest enemy hull within r takes near.k of its
  // damage, falling off to the edge (kind 'near': splinters, sprung plates, a little flooding: ship_speed.js / ship_fires.js)
  function landK(p) { var B = WW.BOMB; return B && B.landDmg ? B.landDmg / (B.dmg * (p.bk || 1)) : 1; }   // a land target: the old 180 a bomb
  function nearMiss(p) {
    var N = WW.BOMB && WW.BOMB.near, list = (WW.world && WW.world.ships) || [];
    if (!N) return;
    var best = null, bd = N.r;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!I.shipUsable(s) || s.nation === p.nation || s.submerged || s.isBase || s.isLand || !s.stats) continue;
      var L = Math.max(5, s.stats.length || 10), c = Math.cos(s.heading || 0), sn = Math.sin(s.heading || 0), dx = p.x - s.x, dz = p.z - s.z;
      var d = Math.hypot(Math.max(0, Math.abs(dx * c + dz * sn) - L / 2), Math.max(0, Math.abs(-dx * sn + dz * c) - L * 0.12));
      if (d < bd) { bd = d; best = s; }
    }
    if (best) I.damage(best, p.dmg * N.k * (1 - 0.6 * bd / N.r), p.x, p.z, 'near');
    return best;
  }

  function updateBomb(p, dt) {
    p.vy -= GRAV * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    I.place(p, p.x, Math.max(0, p.y), p.z); I.orient(p, p.vx, p.vy, p.vz);
    if (p.y > 0.3 + (WW.landSites ? WW.landSites.groundAt(p.x, p.z) : 0)) return;   // the ground it bursts on (land_sites.js: the bluffs; 0 at sea)
    var tgt = (p.target && p.target.alive) ? p.target : null;
    var hit = I.findHit(p.nation, p.x, p.z, 0.6, false, tgt);
    if (hit) {
      var vs = WW.BOMB && WW.BOMB.vs && WW.BOMB.vs[hit.type];   // deck armour (core.js WW.BOMB.vs)
      I.damage(hit, p.dmg * (vs === undefined ? 1 : vs) * (hit.isLand || hit.isBase ? landK(p) : 1), p.x, p.z, 'bomb', undefined, p);
      if (!WW.damage || hit.isLand) { I.fx('explosion', p.x, 1.5, p.z, 2.2); I.fx('sparks', p.x, 1.5, p.z); }
    } else if (WW.landSites && WW.landSites.impact(p.nation, p.x, p.z, p.dmg * landK(p), 'bomb')) {
      I.fx('explosion', p.x, 1, p.z, 2); I.fx('smoke', p.x, 1.4, p.z, true, 2.2);   // on a land target (land_sites.js: the island base, ...)
    } else if (I.depthAt(p.x, p.z) <= 0) {
      I.fx('explosion', p.x, 0.6, p.z, 1.2); I.fx('smoke', p.x, 1, p.z, true, 1.5);
    } else {
      if (nearMiss(p)) I.fx('waterColumn', p.x, p.z, 1.3); else I.fx('splash', p.x, p.z, 3);   // close aboard: a towering column
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
      if (WW.emit) WW.emit('dcDropped', { ship: ship || null, x: x, z: z }); // sound hook
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
    if (WW.emit) WW.emit('dcBlast', { x: p.x, z: p.z, ship: p.owner }); // sound hook
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
      // Steep falloff: a charge close aboard cracks the pressure hull (3x at contact), a near miss only shakes it.
      var k = 1 - d / R, amt = D * 3 * k * k * (s.submerged ? 1 : 0.5);
      I.damage(s, amt, p.x, p.z, 'dc');
    }
  }

  I.updaters.torp = updateTorp;
  I.updaters.bomb = updateBomb;
  I.updaters.dc = updateDC;
  WW.combat.fireTorpedo = fireTorpedo;
  WW.combat.dropBomb = dropBomb;
  WW.combat.dropDepthCharge = dropDepthCharge;
  WW.combat.diveErr = diveErr;
  WW.combat.torpFall = function (y) { return Math.sqrt(2 * Math.max(0, y) / TORP_G); };   // s: an aerial torpedo's fall from y (air_attack.js run)
  WW.combat.flakAt = flakAt;                   // the AA a plane flies into round a point (air_intercept.js pressure)
})();
