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
  var LOOSE = [[80, 0], [40, -70], [40, 70], [-60, -55], [-60, 55]]; // the loose ring (ringR 0): (forward, lateral) off the threat axis
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
    var R = o.ringR > 0 ? o.ringR : o.looseR; if (!(R > 0)) return null;   // looseR: the IJN loose ring, live as well
    out = out || {};
    out.x = cv.x + Math.cos(o.ringA) * R; out.z = cv.z + Math.sin(o.ringA) * R;
    return out;
  }
  // The threat axis of a carrier's screen: the bearing of an armed raid on the side's plot (intel: dive / torpedo
  // bombers within RAID_R of the carrier, not yet over it), else of the nearest known enemy carrier or air base, else
  // of the enemy's known centre, else the axis of advance.
  // The AA escorts go to the side the raid comes from, between it and the carrier (USN radar, IJN lookouts: what the
  // side sees decides how early). Hysteresis: the axis moves only for a change of more than RAID_HYST rad, and a raid
  // bearing is held RAID_HOLD s after the plot clears (the next wave comes from the same side).
  var RAID_R = 350, RAID_IN = 60, RAID_HYST = 0.35, RAID_HOLD = 30;
  function threatAxis(B, cv) {
    var A = B.raidAx || (B.raidAx = {}), a = A[cv.id], now = WW.time.now, rx = 0, rz = 0, n = 0, h = null;
    if (WW.intel) {
      var pl = WW.intel.enemyPlanes(B.nation);
      for (var i = 0; i < pl.length; i++) {
        var u = pl[i].unit; if (!u || !u.alive || (u.kind !== 'dive' && u.kind !== 'torpedo') || !u.ordnance) continue;
        var d = WW.dist(cv.x, cv.z, pl[i].x, pl[i].z); if (d > RAID_R || d < RAID_IN) continue;
        rx += pl[i].x; rz += pl[i].z; n++;
      }
    }
    if (n) h = Math.atan2(rz / n - cv.z, rx / n - cv.x);
    else if (a && a.raid && now - a.t < RAID_HOLD) h = a.h;
    else { // no raid on the plot: the bearing of the nearest known enemy flight deck (carrier or air base), where raids come from
      var ec = B.enemyCentre, cs = WW.intel ? WW.intel.enemyShips(B.nation) : [], bd = 1e18, bc = null;
      for (var k = 0; k < cs.length; k++) { var w = cs[k].unit; if (!w || !w.alive || !(w.type === 'carrier' || w.isBase)) continue; var d2 = WW.dist2(cv.x, cv.z, cs[k].x, cs[k].z); if (d2 < bd) { bd = d2; bc = cs[k]; } }
      h = bc ? Math.atan2(bc.z - cv.z, bc.x - cv.x) : ec ? Math.atan2(ec.z - cv.z, ec.x - cv.x) : B.axis.h;
    }
    if (!a) a = A[cv.id] = { h: h, t: now, raid: false };
    if (n) { a.t = now; a.raid = true; } else if (now - a.t >= RAID_HOLD) a.raid = false;
    if (Math.abs(WW.angleDiff(a.h, h)) > RAID_HYST) a.h = h;
    return a.h;
  }
  // stations(): the escorts' ring stations. Old loose ring (ringR 0) along the axis; tight AA ring on the threat axis.
  // Which escort takes which ring slot: the slots in use (the first k of the table) and the escorts, both in bearing
  // order round the carrier, matched by the cyclic shift that moves the screen least. When the threat axis swings, the
  // ring turns the short way and the escort already nearest the threat bearing takes it (no ship crosses the ring).
  function slotMap(cv, list, th, ang) {
    var k = list.length; if (!k) return;
    var sl = [], i, j;
    for (i = 0; i < Math.min(k, ang.length); i++) sl.push(i);
    sl.sort(function (a, b) { return WW.angleDiff(0, ang[a]) - WW.angleDiff(0, ang[b]); });
    var cur = list.map(function (q) { return { q: q, a: WW.angleDiff(th, Math.atan2(q.z - cv.z, q.x - cv.x)) }; });
    cur.sort(function (a, b) { return a.a - b.a; });
    var best = 0, bc = 1e9;
    for (var sh = 0; sh < sl.length; sh++) {
      var c = 0; for (j = 0; j < cur.length; j++) c += Math.abs(WW.angleDiff(cur[j].a, ang[sl[(j + sh) % sl.length]]));
      if (c < bc - 1e-6) { bc = c; best = sh; }
    }
    for (j = 0; j < cur.length; j++) cur[j].q.ringPos = j < sl.length ? sl[(j + best) % sl.length] : j;
  }
  var LOOSE_A = LOOSE.map(function (r) { return Math.atan2(r[1], r[0]); });
  function ringStations(B, set, at) {
    var d = B.doctrine, per = new Map();
    B.groups.carrier.members.forEach(function (q) {
      var o = q.type !== 'carrier' && B.orders.get(q.id), cv = o && o.ringCv && o.ringCv.alive ? o.ringCv : null;
      if (cv) { if (!per.has(cv)) per.set(cv, []); per.get(cv).push(q); }
    });
    per.forEach(function (list, cv) { slotMap(cv, list, threatAxis(B, cv), d.ringR > 0 ? RING_A : LOOSE_A); });
    B.groups.carrier.members.forEach(function (q) {
      if (q.type === 'carrier') return;
      var o = B.orders.get(q.id); if (!o) return;
      var cv = o.ringCv && o.ringCv.alive ? o.ringCv : null, g = cv || q;
      o.looseR = 0;
      if (!cv) { var r0 = LOOSE[(o.ringSlot || 0) % 5]; o.ringR = 0; set(q, at(g.x, g.z, r0[0], r0[1])); return; }
      var th = threatAxis(B, cv);
      if (!(d.ringR > 0)) { // the loose ring (IJN): its offsets turned onto the threat axis, live on the carrier
        var r = LOOSE[(q.ringPos !== undefined ? q.ringPos : o.ringSlot || 0) % 5], rk = WW.admirals ? WW.admirals.ringK(cv) : 1; // rk: the admiral's flagship (admirals.js) keeps its escorts closer
        o.ringR = 0; o.ringA = th + Math.atan2(r[1], r[0]); o.looseR = Math.hypot(r[0], r[1]) * rk;
        var lp = ringPoint(o); set(q, { x: WW.clamp(lp.x, 30, WW.cfg.MAP_W - 30), z: WW.clamp(lp.z, 30, WW.cfg.MAP_H - 30) }); return;
      }
      o.ringA = th + RING_A[(q.ringPos !== undefined ? q.ringPos : o.ringSlot || 0) % RING_A.length];
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
  var ARC_STEP = 0.7; // rad: the waypoint ahead round the ring when the station is across it
  function ringKeep(ship, o, B) {
    var p = ringPoint(o); if (!p) return false;
    var cv = o.ringCv, ch = Math.cos(cv.heading), sh = Math.sin(cv.heading), lead = Math.max(2, cv.speed) * 4;
    var d = WW.dist(ship.x, ship.z, p.x, p.z), want = Math.atan2(p.z + sh * lead - ship.z, p.x + ch * lead - ship.x);
    // a station across the ring (the threat axis swung): steam round the ring the short way, never through the carrier
    var R = WW.dist(cv.x, cv.z, p.x, p.z), as = Math.atan2(ship.z - cv.z, ship.x - cv.x), da = WW.angleDiff(as, Math.atan2(p.z - cv.z, p.x - cv.x));
    if (Math.abs(da) > ARC_STEP && WW.dist(ship.x, ship.z, cv.x, cv.z) < R * 1.8) {
      var wa = as + Math.sign(da) * ARC_STEP, wx = cv.x + Math.cos(wa) * R + ch * lead, wz = cv.z + Math.sin(wa) * R + sh * lead;
      want = Math.atan2(wz - ship.z, wx - ship.x);
    }
    if (d > 25) ship.throttle = WW.clamp(d / 50, 0.6, 1);
    else {
      var along = (p.x - ship.x) * ch + (p.z - ship.z) * sh;
      ship.throttle = WW.clamp((cv.speed + 0.3 * along) / ship.stats.speed, 0.15, 1);
    }
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, B.doctrine.risk[ship.type] || 0.5) : want;
    return true;
  }

  // ---- formation guides (main body, screen, flotilla) ----
  // Each surface group keeps station on a guide that persists between commander ticks: a point that steams at the
  // formation speed (FORM_V x the slowest fit member's top speed) toward the commander's aim point (the posture's lead
  // ahead of the group, or the air-war hold anchor) and turns at most GUIDE_TURN rad/s: the group turns together on the
  // signal instead of each ship chasing its own carrot. It slows as it nears the aim (GUIDE_T s out), so it never runs
  // away from its ships, and it is reseated on the members' centroid if they are dragged off (GUIDE_LEASH x L).
  // Stations are offsets (forward, lateral) in the formation's axis, live: guidePoint() moves them with the guide. The
  // course (g.h) turns at GUIDE_TURN and every ship turns with it at once (a turn together: a column becomes a line of
  // bearing); the formation axis (g.fa) follows the course only at AXIS_TURN, as the screen re-forms on the new course.
  // (Rotating the stations at the course's rate would swing the ends of a column faster than a ship can steam.)
  var GP = {};
  var FORM_V = 0.85, GUIDE_TURN = 0.08, AXIS_TURN = 0.012, GUIDE_T = 10, GUIDE_LEASH = 6;
  function guide(B, key, list, aim) {
    var G = B.fg || (B.fg = {}), g = G[key], now = WW.time.now, L = WW.cfg.L || 26, x = 0, z = 0, n = 0, v = 1e9;
    for (var i = 0; i < list.length; i++) { var q = list[i]; if (!q.alive) continue; x += q.x; z += q.z; n++; v = Math.min(v, WW.shipSpeed ? WW.shipSpeed.vmax(q) : q.stats.speed); }
    if (!n) { G[key] = null; return null; }
    x /= n; z /= n;
    if (!g) g = G[key] = { x: x, z: z, h: B.axis.h, fa: B.axis.h, v: 0, t: now };
    var dt = Math.max(0, now - g.t);
    if (dt > 0) { g.x += Math.cos(g.h) * g.v * dt; g.z += Math.sin(g.h) * g.v * dt; g.t = now; }
    if (WW.dist(g.x, g.z, x, z) > GUIDE_LEASH * L) { g.x = (g.x + x) / 2; g.z = (g.z + z) / 2; } // the group was pulled away: meet it half way
    var d = WW.dist(g.x, g.z, aim.x, aim.z), want = d > 0.5 * L ? Math.atan2(aim.z - g.z, aim.x - g.x) : B.axis.h;
    if (dt > 0) { g.h += WW.clamp(WW.angleDiff(g.h, want), -GUIDE_TURN * dt, GUIDE_TURN * dt); g.fa += WW.clamp(WW.angleDiff(g.fa, g.h), -AXIS_TURN * dt, AXIS_TURN * dt); }
    var off = Math.abs(WW.angleDiff(g.h, want));
    // forming up: the guide eases off while its ships are still far off their stations (mean RMS of the last tick, in L),
    // so a ship ordered to the head of the column can get there
    var form = WW.clamp(1.4 - (g.off || 0) / (3 * L), 0.35, 1);
    g.v = Math.min(FORM_V * v * form, d / GUIDE_T) * WW.clamp(1.2 - off, 0.25, 1); // slow while the turn is still coming round
    var se = 0, sn = 0;
    for (var j = 0; j < list.length; j++) { // (o.fg is re-set after this call: the last tick's offsets)
      var o = B.orders.get(list[j].id); if (!o || o.ff === undefined || list[j].target) continue;
      var f = o.fg; o.fg = g; var p = guidePoint(o, GP); o.fg = f; se += WW.dist2(list[j].x, list[j].z, p.x, p.z); sn++;
    }
    g.off = sn ? Math.sqrt(se / sn) : 0;
    return g;
  }
  // the live station of an order on a guide: o.fg (the guide), o.ff / o.fl (forward / lateral offset)
  function guidePoint(o, out) {
    var g = o.fg; if (!g) return null;
    out = out || {};
    var dt = Math.max(0, WW.time.now - g.t), gx = g.x + Math.cos(g.h) * g.v * dt, gz = g.z + Math.sin(g.h) * g.v * dt, c = Math.cos(g.fa), s = Math.sin(g.fa);
    out.x = WW.clamp(gx + c * o.ff - s * o.fl, 30, WW.cfg.MAP_W - 30); out.z = WW.clamp(gz + s * o.ff + c * o.fl, 30, WW.cfg.MAP_H - 30);
    return out;
  }
  // Station keeping on a guide (ai_surface.js followStation): close the live station with a lead along the guide's
  // course; on it, match the guide's course and speed (as ringKeep does on a carrier).
  function guideKeep(ship, o, B) {
    var p = guidePoint(o, GP); if (!p) return false;
    var g = o.fg, ch = Math.cos(g.h), sh = Math.sin(g.h), lead = Math.max(2, g.v) * 4, zig = B.zig || 0;
    var d = WW.dist(ship.x, ship.z, p.x, p.z), want;
    if (d > 25) { // far off: aim ahead of the station along the guide's course by half the distance, so a ship rejoining
      // converges on the formation's course instead of cutting across it
      var la = Math.max(lead, d * 0.5);
      want = Math.atan2(p.z + sh * la - ship.z, p.x + ch * la - ship.x) + zig * WW.clamp(1.6 - d / 100, 0, 1); ship.throttle = WW.clamp(d / 50, 0.6, 1);
    }
    else {
      var along = (p.x - ship.x) * ch + (p.z - ship.z) * sh;
      want = Math.atan2(p.z + sh * lead - ship.z, p.x + ch * lead - ship.x) + zig;
      ship.throttle = WW.clamp((g.v + 0.3 * along) / ship.stats.speed, 0.12, 1);
    }
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, B.doctrine.risk[ship.type] || 0.5) : want;
    return true;
  }

  WW.formation = { threatAxis: threatAxis, guide: guide, guidePoint: guidePoint, guideKeep: guideKeep, ringCounts: ringCounts, tagRing: tagRing, ringStations: ringStations, ringPoint: ringPoint, ringKeep: ringKeep,
    vanguardBack: vanguardBack, zigzag: zigzag, zig: zig, ZIG: ZIG, LEG: LEG };
})();
