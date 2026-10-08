// ai_sub_roles.js - WW.subRoles: the submarine doctrine of each navy, used by ai_light.js (subAI and ambush).
//  - Target choice (doctrine.subCV, subNear): IJN boats hunted warships, the carriers above all (subCV 2.2: a carrier
//    contact counts 2.2x); USN boats attacked what they found (subNear: a far ambush point counts for less, so the
//    nearest worthwhile target wins).
//  - Shadowing (doctrine.subShadow, IJN): a contact the boat cannot get ahead of is shadowed from 110 off its
//    quarter instead of chased, so the side's contact table stays fresh (intel shares every sighting).
//  - Patrol line (doctrine.subLine, IJN): fleet_groups.js stations lay the boats across the enemy's predicted approach.
//  - Lifeguard (doctrine.lifeguard, USN): a surfaced boat with nothing on its hands, no enemy close and safe water
//    claims an open pickup of its own side's survivors or aircrew from endgame.js (the shared rescue task list:
//    destroyers get first call for LG_WAIT s), runs there surfaced, stops alongside and takes them aboard
//    (endgame.js pickup: within reach and nearly stopped for its PICKUP_T s). Lifeboats row to her (lifeboats.js
//    rescuerNear). Given up when a destroyer, aircraft or gun ship comes near, or the boat is hurt.
// Reads the enemy only through WW.intel / WW.threat; no randomness.
window.WW = window.WW || {};
(function () {
  'use strict';
  var LG_R = 380, LG_WAIT = 6, LG_SAFE = 8, LG_HP = 0.5, SHADOW = 110;
  function doctrine(n) { return (WW.fleetCmd && WW.fleetCmd.doctrine(n)) || {}; }
  // ambush score factor for a target type, and the time scale of the "can get ahead of it" discount (s)
  function weight(ship, type) { var d = doctrine(ship.nation); return type === 'carrier' ? d.subCV || 1 : 1; }
  function nearT(ship) { return doctrine(ship.nation).subNear || 40; }
  // the shadowing point for contact c (IJN): SHADOW off the target's quarter on the boat's side; null for USN
  function shadowPoint(ship, c, x0, z0, side) {
    if (!doctrine(ship.nation).subShadow) return null;
    var ch = Math.cos(c.heading), sh = Math.sin(c.heading), k = SHADOW * 0.7;
    return { ax: x0 - ch * k - sh * side * k, az: z0 - sh * k + ch * side * k };
  }
  function tasks() {
    if (WW.rescue && typeof WW.rescue.tasks === 'function') return WW.rescue.tasks(); // the shared list (flyingboats)
    return WW.endgame && WW.endgame.tasks ? WW.endgame.tasks() : [];
  }
  function release(ship) { var t = ship.rescue; if (t && t.by === ship) { t.by = null; t.pick = 0; } ship.rescue = null; }
  // Lifeguard duty. L: the boat's picture (ai_light.js subAI). Returns true while it has the helm.
  function lifeguard(ship, dt, L) {
    var a = ship.ai, d = doctrine(ship.nation), now = WW.time.now;
    var t = ship.rescue;
    if (t && (t.done || t.by !== ship)) { ship.rescue = null; t = null; }
    var safe = ship.hp >= LG_HP * ship.maxHp && L.ddD > 160 && !L.air && L.thrD > 130 && !(a.evadeT > 0) && !L.ddTgt;
    if (!d.lifeguard || !safe) { if (t) release(ship); return false; }
    if (!t) {
      a.lgT = (a.lgT || 0) - dt;
      if (a.lgT > 0 || (L.amb && WW.dist(ship.x, ship.z, L.amb.c.x, L.amb.c.z) < 200)) return false; // a target close by comes first
      a.lgT = 1;
      var T = tasks(), best = null, bd = LG_R * LG_R;
      for (var i = 0; i < T.length; i++) {
        var q = T[i];
        if (q.done || q.by || q.nation !== ship.nation || now - q.t0 < LG_WAIT) continue;
        var d2 = WW.dist2(ship.x, ship.z, q.x, q.z);
        if (d2 >= bd || (WW.threat && WW.threat.danger(ship.nation, q.x, q.z) > LG_SAFE)) continue;
        bd = d2; best = q;
      }
      if (!best) return false;
      best.by = ship; best.pick = 0; ship.rescue = t = best;
      if (WW.dstat) WW.dstat('lifeguardClaim', ship.nation);
    }
    // surfaced, to the pickup point, slow alongside (rescueSteer's profile)
    ship.wantSurface = true;
    var dd = WW.dist(ship.x, ship.z, t.x, t.z), want = Math.atan2(t.z - ship.z, t.x - ship.x);
    if (dd > t.r + 30) { ship.throttle = 1; ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0.2) : want; }
    else { ship.desiredHeading = want; ship.throttle = dd > t.r + 10 ? 0.45 : dd > t.r - 2 ? 0.2 : 0.03; }
    if (WW.dstat) WW.dstat('lifeguardT', ship.nation, dt);
    return true;
  }
  WW.on('rescue', function (e) { if (e && e.ship && e.ship.type === 'submarine' && WW.dstat) WW.dstat('lifeguardPick', e.ship.nation, e.n || 1); });

  WW.subRoles = { weight: weight, nearT: nearT, shadowPoint: shadowPoint, lifeguard: lifeguard, release: release, LG_R: LG_R, SHADOW: SHADOW };
})();
