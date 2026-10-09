// fleet_formation.js - WW.formation: the formation doctrine the commander's stations use (fleet_groups.js) and the
// station keeping of the ships (ai_surface.js followStation, ai_carrier.js). Pure sim, no randomness.
//  - AA ring (doctrine.ringR > 0, USN): each carrier's escorts hold a tight circle ringR out (25-45), the first
//    slot on the threat axis (the bearing of the enemy's centre, else the axis of advance), the others spread to
//    either side of it. The station is live: it moves with the carrier, so when the carrier turns into the wind
//    its escorts match its course and speed and the whole group turns together. ships.js lets a ring escort inside
//    the carrier's personal space (ship.ringCv). doctrine.ringR = 0 (IJN): the old loose ring (~80, along the axis).
//  - Escorts per carrier: a battleship when the side has two or more and doctrine.ringBB, the cruiser when the side
//    has two or more, then up to doctrine.ringDD destroyers (always one DD; the rest go to the screen / flotilla).
//  - Vanguard (doctrine.vanguard, IJN): in search, approach and engage the carriers hang back vanguard x the map width
//    behind the main body (BB / CA, the screen and flotilla DDs ahead of it), so the surface force runs ahead as
//    pickets and bait (Midway, Santa Cruz). fleet_groups.js stations() reads vanguardBack() (the carriers stay
//    in their station band, fleet_groups.js CV_LO..CV_HI; the line's lead grows by 35 in search / approach).
//  - Zigzag: with an enemy sub known within ZIG_R of the formation (contact up to ZIG_AGE s old), or a sub's
//    torpedo seen or felt in the last ZIG_HIT s (suspected), the side's formation steers a shared zigzag plan off
//    its base course: ZIG offsets, LEG s each, from the sim clock (every ship of the side on the same leg). Not
//    while pressing or pursuing; only ships keeping station (no target) and the carriers on passage follow it.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI;
  var RING_A = [0, 1.15, -1.15, 2.2, -2.2, PI];          // ring slot bearings off the threat axis
  var ZIG = [0.5, -0.35, 0.3, -0.55, 0.4, -0.3], LEG = 22, ZIG_R = 300, ZIG_AGE = 75, ZIG_HIT = 75;
  var subHit = { USN: -1e9, IJN: -1e9 };                  // sim time a side last saw or felt a sub's torpedo

  // Ring escorts: which ships of the side guard the carriers (assign()). Returns { bb: n, ca: n, dd: n } counts.
  function ringCounts(B, ncv, nbb, nca, ndd) {
    var d = B.doctrine;
    if (!ncv) return { bb: 0, ca: 0, dd: 0 };
    var bb = d.ringBB && nbb >= 2 ? 1 : 0;
    var ca = nca >= 2 ? Math.min(ncv, nca - 1) : 0;
    var dd = Math.min(ndd, Math.max(1, Math.min(Math.round(d.ringDD || 1) * ncv, ndd - 2)));
    return { bb: bb, ca: ca, dd: dd };
  }
  // after assign(): spread the escorts over the carriers (round robin, big ships first) and tag ship.ringCv
  function tagRing(B, cvs) {
    var per = {}, k = 0;
    B.orders.forEach(function (o) { o.ship.ringCv = null; });
    if (!cvs.length) return;
    B.groups.carrier.members.forEach(function (s) {
      if (s.type === 'carrier') return;
      var o = B.orders.get(s.id); if (!o) return;
      var cv = cvs[k++ % cvs.length], n = per[cv.id] = (per[cv.id] || 0) + 1;
      o.ringCv = cv; o.ringSlot = n - 1;
      if (B.doctrine.ringR > 0 && o.role === 'escort') s.ringCv = cv;
    });
  }
  // The station of ring escort o: live point { x, z } (null when it has no carrier)
  function ringPoint(o, out) {
    var cv = o.ringCv; if (!cv || !cv.alive || cv.sinking) return null;
    out = out || {};
    out.x = cv.x + Math.cos(o.ringA) * o.ringR; out.z = cv.z + Math.sin(o.ringA) * o.ringR;
    return out;
  }
  // stations(): the escorts' ring stations. Old loose ring (ringR 0) along the axis; tight AA ring on the threat axis.
  function ringStations(B, set, at) {
    var d = B.doctrine, ec = B.enemyCentre;
    B.groups.carrier.members.forEach(function (q) {
      if (q.type === 'carrier') return;
      var o = B.orders.get(q.id); if (!o) return;
      var cv = o.ringCv && o.ringCv.alive ? o.ringCv : null, g = cv || q;
      if (!(d.ringR > 0) || !cv) { var r = [[80, 0], [40, -70], [40, 70], [-60, -55], [-60, 55]][(o.ringSlot || 0) % 5]; o.ringR = 0; var rk = WW.admirals && cv ? WW.admirals.ringK(cv) : 1; set(q, at(g.x, g.z, r[0] * rk, r[1] * rk)); return; } // rk: the admiral's flagship (admirals.js) keeps its escorts closer
      var th = ec ? Math.atan2(ec.z - cv.z, ec.x - cv.x) : B.axis.h;
      o.ringA = th + RING_A[(o.ringSlot || 0) % RING_A.length];
      o.ringR = Math.max(d.ringR, (q.stats.length + cv.stats.length) * 0.6 + 6);
      var p = ringPoint(o); set(q, { x: WW.clamp(p.x, 30, WW.cfg.MAP_W - 30), z: WW.clamp(p.z, 30, WW.cfg.MAP_H - 30) });
    });
  }
  // How far behind the main body the carriers hold (the vanguard runs ahead of them) while searching / approaching.
  function vanguardBack(B, back) {
    var v = B.doctrine.vanguard || 0;
    if (!(v > 0) || (B.posture !== 'search' && B.posture !== 'approach' && B.posture !== 'engage')) return back;
    return Math.max(back, v * WW.cfg.REF_W); // a tactical distance (~12 carrier lengths): the old map width, not the new one
  }

  // ---- zigzag ----
  WW.on('weaponImpact', function (e) { // a sub's torpedo that hit (or reached) a side's ship: suspected subs about
    var o = e && e.kind === 'torpedo' && e.ship && e.proj && e.proj.owner;
    if (o && o.type === 'submarine' && subHit[e.ship.nation] !== undefined) subHit[e.ship.nation] = WW.time.now;
  });
  function reset() { subHit.USN = subHit.IJN = -1e9; }
  WW.on('roundStart', reset); WW.on('setupStart', reset);
  function subThreat(B) {
    var n = B.nation, now = WW.time.now;
    if (now - subHit[n] < ZIG_HIT) return true;
    if (!WW.intel) return false;
    var T = WW.intel.torpedoes(n);
    for (var i = 0; i < T.length; i++) { var ow = T[i].proj && T[i].proj.owner; if (ow && ow.type === 'submarine') { subHit[n] = now; return true; } }
    var cs = WW.intel.enemyShips(n), G = B.groups, r2 = ZIG_R * ZIG_R;
    for (var k = 0; k < cs.length; k++) {
      var c = cs[k]; if (!c.unit || c.unit.type !== 'submarine' || !c.unit.alive || now - c.seenAt > ZIG_AGE) continue;
      var lists = [G.main.members, G.carrier.members, G.screen.members];
      for (var l = 0; l < lists.length; l++) for (var j = 0; j < lists[l].length; j++) { var s = lists[l][j]; if (s.alive && WW.dist2(s.x, s.z, c.x, c.z) < r2) return true; }
    }
    return false;
  }
  // per commander tick: B.zig, the side's current zigzag offset (rad) off its base course; 0 when not zigzagging
  function zigzag(B) {
    var k = B.doctrine.zigzag || 0, was = B.zig || 0;
    B.zig = 0;
    if (k > 0 && B.posture !== 'press' && B.posture !== 'pursue' && subThreat(B)) B.zig = ZIG[Math.floor(WW.time.now / LEG) % ZIG.length] * k;
    if (B.zig && WW.dstat && B.zigAt !== undefined) WW.dstat('zigT', B.nation, Math.max(0, Math.min(4, WW.time.now - B.zigAt)));
    B.zigAt = WW.time.now;
    return was;
  }
  function zig(nation) { var B = WW.fleetCmd && WW.fleetCmd.side(nation); return B && B.zig || 0; }

  // Station keeping for a ring escort (ai_surface.js followStation): close the live station with a lead along the
  // carrier's course; on it, match the carrier's course and speed (the group turns together).
  function ringKeep(ship, o, B) {
    var p = ringPoint(o); if (!p) return false;
    var cv = o.ringCv, ch = Math.cos(cv.heading), sh = Math.sin(cv.heading), lead = Math.max(2, cv.speed) * 4;
    var d = WW.dist(ship.x, ship.z, p.x, p.z), want = Math.atan2(p.z + sh * lead - ship.z, p.x + ch * lead - ship.x);
    if (d > 25) ship.throttle = WW.clamp(d / 50, 0.6, 1);
    else {
      var along = (p.x - ship.x) * ch + (p.z - ship.z) * sh;
      ship.throttle = WW.clamp((cv.speed + 0.3 * along) / ship.stats.speed, 0.15, 1);
    }
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, B.doctrine.risk[ship.type] || 0.5) : want;
    return true;
  }

  WW.formation = { ringCounts: ringCounts, tagRing: tagRing, ringStations: ringStations, ringPoint: ringPoint, ringKeep: ringKeep,
    vanguardBack: vanguardBack, zigzag: zigzag, zig: zig, ZIG: ZIG, LEG: LEG };
})();
