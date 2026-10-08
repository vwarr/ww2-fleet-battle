// ai_charge.js - WW.smoke (smoke screens) and WW.charge (escorts charge to save the carriers: Samar, "Taffy 3").
// Sim code: WW.rand is not used; the smoke puffs are visual (Math.random). Load after ai_endgame.js.
//  - Smoke: a destroyer making smoke drops a cloud every SMOKE_DT s (radius growing to SMOKE_R, drifting with the
//    wind, gone after SMOKE_LIFE s). intel.js los() treats a line of sight through a cloud as blocked (ship to ship),
//    so a ship behind the screen cannot be seen or fired on by ships.
//  - Charge: once a second per side, an own carrier with a known enemy gun ship (seen in the last 10 s) inside
//    1.5 x that ship's main gun range x doctrine.escortCharge (USN 1, IJN 0.6), or closing on it inside 300 (USN
//    only: eagerness >= 0.8), sends every fit destroyer within CHARGE_R of it at that ship: full speed at its lead
//    point, making smoke, torpedoes at the doctrine's launch distance, then guns. The charge ends when the foe is
//    sunk or turned back (beyond 1.3 x the trigger), the destroyer drops below 30% hp, or after CHARGE_T s.
//    Events: 'escortCharge' { carrier, foe, ships }. ai_endgame.js steer() hands the helm to steer() here first.
window.WW = window.WW || {};
(function () {
  'use strict';
  var SMOKE_R = 18, SMOKE_LIFE = 40, SMOKE_DT = 2, SMOKE_MAX = 60;
  var CHARGE_R = 320, CHARGE_T = 75, CLOSING_R = 300;
  var clouds = [], tick = 0, puffT = 0, stats = null;
  function per() { return { USN: 0, IJN: 0 }; }
  function reset() {
    clouds.length = 0; tick = 0;
    stats = { charges: per(), ships: per(), lost: per(), torpHits: per(), turned: per(), cvSunk: per(), smoke: per() };
    WW.charge.stats = stats;
  }

  // ---- smoke ----
  function add(x, z, nation) {
    if (clouds.length >= SMOKE_MAX) clouds.shift();
    clouds.push({ x: x, z: z, t: 0, r: 4 }); if (stats) stats.smoke[nation]++;
  }
  // segment (ax, az)-(bx, bz) through a cloud's core (0.8 r)
  function blocks(ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i], u = WW.clamp(((c.x - ax) * dx + (c.z - az) * dz) / L2, 0, 1), px = ax + dx * u - c.x, pz = az + dz * u - c.z, r = c.r * 0.8;
      if (px * px + pz * pz < r * r) return true;
    }
    return false;
  }
  function smokeUpdate(dt) {
    var w = WW.wind || { x: 0, z: 0 };
    for (var i = clouds.length - 1; i >= 0; i--) {
      var c = clouds[i]; c.t += dt;
      if (c.t > SMOKE_LIFE) { clouds.splice(i, 1); continue; }
      c.r = Math.min(SMOKE_R, 4 + c.t * 2.5) * (c.t > SMOKE_LIFE - 8 ? (SMOKE_LIFE - c.t) / 8 : 1);
      c.x += w.x * 0.4 * dt; c.z += w.z * 0.4 * dt;
    }
    if (WW.simOnly || !WW.fx) return;                                    // the screen itself: visual only
    puffT -= dt; if (puffT > 0) return; puffT = 0.25;
    for (var k = 0; k < clouds.length; k++) {
      var q = clouds[k], a = Math.random() * 6.28, d = Math.random() * q.r * 0.7;
      WW.fx.smoke(q.x + Math.cos(a) * d, 1 + Math.random() * 2, q.z + Math.sin(a) * d, false, 1.5 + q.r / 6);
    }
  }

  // ---- the charge ----
  var GUN = { battleship: 1, cruiser: 1, destroyer: 1 };
  function eager(n) { var d = WW.fleetCmd && WW.fleetCmd.doctrine(n); return d && d.escortCharge > 0 ? d.escortCharge : 0; }
  function threatTo(cv, now) {
    var e = eager(cv.nation); if (!e || !WW.intel) return null;
    var cs = WW.intel.enemyShips(cv.nation), best = null, bk = 1e9;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], u = c.unit; if (!u || !u.alive || u.sinking || !GUN[u.type] || now - c.seenAt > 10) continue;
      var g = u.stats.guns[0], d = WW.dist(cv.x, cv.z, c.x, c.z), R = g.range * 1.5 * e;
      var closing = e >= 0.8 && d < CLOSING_R && c.speed > 1 && Math.abs(WW.angleDiff(c.heading, Math.atan2(cv.z - c.z, cv.x - c.x))) < 0.5;
      if ((d < R || closing) && d / R < bk) { bk = d / R; best = u; }
    }
    return best;
  }
  function fit(s) { return s.alive && !s.sinking && s.type === 'destroyer' && s.hp >= 0.3 * s.maxHp && !s.rescue; }
  function plan(now) {
    var ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var cv = ships[i]; if (!cv.alive || cv.sinking || cv.type !== 'carrier') continue;
      var foe = threatTo(cv, now); if (!foe) continue;
      var sent = [];
      for (var k = 0; k < ships.length; k++) {
        var s = ships[k]; if (s.nation !== cv.nation || !fit(s) || (s.ai.charge && s.ai.charge.foe.alive)) continue;
        if (WW.dist2(s.x, s.z, cv.x, cv.z) > CHARGE_R * CHARGE_R) continue;
        s.ai.charge = { foe: foe, cv: cv, t0: now, R: foe.stats.guns[0].range * 1.5 * eager(cv.nation), smokeT: 0 }; sent.push(s);
      }
      if (sent.length) { stats.charges[cv.nation]++; stats.ships[cv.nation] += sent.length; WW.emit('escortCharge', { carrier: cv, foe: foe, ships: sent }); }
    }
  }
  function update(dt) {
    if (!WW.game || WW.game.state !== 'battle') return;
    smokeUpdate(dt);
    tick -= dt; if (tick > 0) return; tick += 1;
    try { plan(WW.time.now); } catch (e) { console.error('charge', e); }
  }
  // ai_endgame.js steer: a charging destroyer has the helm. Returns true while charging.
  function steer(ship, dt) {
    var ch = ship.ai && ship.ai.charge; if (!ch) return false;
    var f = ch.foe, cv = ch.cv, now = WW.time.now, n = ship.nation;
    var over = !f.alive || f.sinking || ship.hp < 0.3 * ship.maxHp || now - ch.t0 > CHARGE_T || !cv.alive ||
      WW.dist(f.x, f.z, cv.x, cv.z) > ch.R * 1.3;
    if (over) {
      if (cv.alive && f.alive && !f.sinking && WW.dist(f.x, f.z, cv.x, cv.z) > ch.R * 1.3) stats.turned[n]++;
      ship.ai.charge = null; return false;
    }
    var c = WW.intel ? WW.intel.known(n, f) : f; if (!c) { ship.ai.charge = null; return false; }
    var d = WW.dist(ship.x, ship.z, c.x, c.z), k = Math.min(20, d / ship.stats.speed);
    var px = c.x + Math.cos(c.heading) * c.speed * k, pz = c.z + Math.sin(c.heading) * c.speed * k;
    var h = Math.atan2(pz - ship.z, px - ship.x);
    if (d < 25) h += (ship.ai.orbitDir || 1) * 1.2;           // close aboard: swing across, guns bearing
    else h += Math.sin(now * 0.7 + ship.id) * 0.25;           // weave (spoil the enemy's aim)
    ship.desiredHeading = h; ship.throttle = 1; ship.target = f;
    var g = ship.stats.guns[0]; if (g && ship.ai.calTarget && d <= g.range) ship.ai.calTarget[g.cal] = f;
    var B = WW.fleetCmd && WW.fleetCmd.side(n);
    if (WW.shipAI.surface && WW.shipAI.surface.torpedoes) WW.shipAI.surface.torpedoes(ship, f, B);
    ch.smokeT -= dt; if (ch.smokeT <= 0) { ch.smokeT = SMOKE_DT; var q = ship.toWorld(-ship.stats.length * 0.5, 0); add(q[0], q[1], n); }
    return true;
  }
  WW.on('weaponImpact', function (e) {
    var o = e && e.kind === 'torpedo' && e.ship && !e.dud && e.proj && e.proj.owner;
    if (o && o.ai && o.ai.charge && stats) stats.torpHits[o.nation]++;
  });
  WW.on('shipSunk', function (s) {
    if (!stats || !s) return;
    if (s.ai && s.ai.charge) stats.lost[s.nation]++;
    if (s.type === 'carrier') for (var i = 0; i < WW.world.ships.length; i++) { var q = WW.world.ships[i]; if (q.ai && q.ai.charge && q.ai.charge.cv === s) { stats.cvSunk[s.nation]++; break; } }
  });
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.smoke = { add: add, blocks: blocks, clouds: function () { return clouds; } };
  WW.charge = { update: update, steer: steer, stats: null, CHARGE_R: CHARGE_R };
  reset();
})();
