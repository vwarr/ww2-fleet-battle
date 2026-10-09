// land_ground.js - WW.landGround: the island airfield's ground operations (sim code: WW.rand only; deterministic).
// Every base plane has a slot: a parking spot (airfield_layout.js) and a state - 'parked' (ready when readyAt has
// passed), 'out' (its Plane is warming up, taxiing or flying), 'rearm' (back, refuelling), 'wreck' (destroyed on the
// ground), 'empty' (lost in the air) or 'away' (diverted to a carrier). Movement follows the layout's paths only:
//   out:  warm-up in the spot -> spot -> row lane -> column -> taxiway -> hold-short line -> line up -> roll
//   in:   touchdown -> rollout -> along the runway to the plane's column exit -> across -> column -> lane -> spot ->
//         pivot nose-out -> rearm
// The airfield is in one mode at a time, like a carrier deck: 'launch' (only outbound planes move) or 'recover'
// (only inbound), switched when the current mode's movers are done (the one waiting longer first; a scramble goes
// first). With traffic one-way per mode there is no head-on meeting and no deadlock. The runway takes one plane at a
// time (occ), the hold-short line is a FIFO, and a plane never moves to a place closer than its clearance radius
// (0.42 x length) plus a gap to another plane on the ground (parked ones included): no overlaps, ever. A plane that
// waits too long (TOW_T) for any other reason is towed (back to its spot or into it). Nothing lines up, and a roll in
// progress stops, while the main runway is closed (craters); a neutralized base freezes: the planes on the ground stay
// where they stand. Stats: WW.landGround.stats (tows, aborts, ground losses, ...).
window.WW = window.WW || {};
(function () {
  'use strict';
  var TAXI = 5.5, TAXI_FAST = 8, TAXI_RWY = 7, LAND_SEP = 45, TURN_WAIT = 18, PIVOT = 1.8, GAP = 0.6, FOLLOW = 2.4, WARM = 4, WARM_FAST = 1.5, TOW_T = 45, SHUT_T = 25;
  var REARM = 22, ROLL_A = 7, ROLL_GAP = 2.4, WRECK_T = 40, TOWOUT = 20;
  var MIX = { USN: { f4f: 0.35, sbd: 0.3, b26: 0.12, b17: 0.23 }, IJN: { a6m: 0.4, g4m: 0.35, g4mL: 0.25 } };
  var ST = { slots: 0, capped: 0, towOut: 0, tows: 0, aborts: 0, groundLost: 0, scrambles: 0, modeSwitches: 0, launchClosed: 0 };
  var obsT = -1, obs = [];

  function VAR() { return WW.landAir.VAR; }
  function cls(v) { return (VAR()[v] && VAR()[v].cls) || 'S'; }
  function rad(v) { return WW.airfieldLayout.CLS[cls(v)].len * 0.42; }
  function groundY(b) { return b.site.padH; }
  function gear(p) { return (p.variant && VAR()[p.variant].gear) || WW.air._pool.deckY; }

  // ---- the air group: one carrier air group's worth by default (TUNE.group x TUNE.air / 0.6) ----
  function carrierGroup() { var P = WW.SHIP_TYPES.carrier.planes || {}, n = 0; for (var k in P) n += P[k]; return n || 14; }
  function plan(b) {
    var T = WW.islandBase.TUNE, mix = MIX[b.nation] || MIX.USN, keys = Object.keys(mix);
    var total = Math.max(keys.length, Math.round(carrierGroup() * (T.group || 1) * (T.air === undefined ? 0.6 : T.air) / 0.6));
    var counts = {}, rem = [], used = 0;
    keys.forEach(function (k) { var x = total * mix[k], n = Math.max(1, Math.floor(x)); counts[k] = n; used += n; rem.push({ k: k, f: x - Math.floor(x) }); });
    rem.sort(function (a, c) { return c.f - a.f || (a.k < c.k ? -1 : 1); });
    for (var i = 0; used < total; i = (i + 1) % rem.length) { counts[rem[i].k]++; used++; }
    var demand = { S: 0, M: 0, L: 0 };
    for (var v in counts) demand[cls(v)] += counts[v];
    return { counts: counts, demand: demand, total: total };
  }
  function setup(b, pl) {
    var L = b.layout, byCls = { S: [], M: [], L: [] };
    L.spots.forEach(function (sp) { byCls[sp.cls].push(sp); });
    b.slots = [];
    Object.keys(pl.counts).forEach(function (v) {
      for (var i = 0; i < pl.counts[v]; i++) {
        var sp = byCls[cls(v)].shift();
        if (!sp) { ST.capped++; b.slots.push({ i: b.slots.length, v: v, spot: null, state: 'reserve', readyAt: 0, plane: null, x: 0, z: 0, h: 0, r: rad(v) }); continue; }
        b.slots.push({ i: b.slots.length, v: v, spot: sp, state: 'parked', readyAt: 0, plane: null, x: sp.x, z: sp.z, h: sp.h, r: rad(v) });
      }
    });
    ST.slots = b.slots.length;
    var wh = WW.wind ? WW.wind.a + Math.PI : b.heading;   // take off and land into the wind (fixed for a round)
    b.ops = { mode: 'idle', occ: null, holdQ: [], lastRoll: -1e9, launchSince: null, landSince: null, scrambleT: -1e9,
      dir: Math.cos(WW.angleDiff(b.heading, wh)) >= 0 ? 1 : -1, crossOcc: null, closedT: 0, gidN: 0 };
    sync(b);
  }
  // hangar counts (WW.air.launch checks them): planes parked and ready, by kind
  function sync(b) {
    var h = b.hangar, now = WW.time.now; h.fighter = h.dive = h.torpedo = 0;
    for (var i = 0; i < b.slots.length; i++) { var s = b.slots[i]; if (s.state === 'parked' && s.readyAt <= now) h[VAR()[s.v].kind]++; }
  }
  function ready(b, v) { var n = 0, now = WW.time.now; for (var i = 0; i < b.slots.length; i++) { var s = b.slots[i]; if (s.v === v && s.state === 'parked' && s.readyAt <= now) n++; } return n; }
  function take(b, v) { // the parked, ready slot of variant v nearest the departure end (deterministic)
    var now = WW.time.now, best = null, bu = 1e9;
    for (var i = 0; i < b.slots.length; i++) {
      var s = b.slots[i]; if (s.v !== v || s.state !== 'parked' || s.readyAt > now || s.moved) continue;
      var u = b.ops.dir * s.spot.u; if (u < bu) { bu = u; best = s; }
    }
    return best;
  }

  // ---- obstacles: every plane on the ground, parked or moving (cached per step) ----
  function onGround(p) { return p.alive && !p.removed && ((p.state === 'takeoff' && p.rwPh && p.rwPh !== 'climb') || (p.state === 'rollout' && p.rwPh !== 'towed')); }
  function obstacles(b) {
    if (obsT === WW.time.now) return obs;
    obsT = WW.time.now; obs.length = 0;
    for (var i = 0; i < b.slots.length; i++) { var s = b.slots[i]; if (s.state === 'parked' || s.state === 'rearm' || s.state === 'wreck') obs.push({ x: s.x, z: s.z, r: s.r, slot: s, p: null }); }
    var P = WW.world.planes;
    for (var j = 0; j < P.length; j++) { var p = P[j]; if (p.carrier === b && onGround(p)) obs.push({ x: p.x, z: p.z, r: rad(p.variant), slot: p.slot, p: p }); }
    return obs;
  }
  // one step along the path pts from point index p.pi; returns 'moving' | 'blocked' | 'arrived'
  function move(p, b, pts, spd, dt) {
    if (p.pi >= pts.length) return 'arrived';
    var t = pts[p.pi], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { p.pi++; return p.pi >= pts.length ? 'arrived' : 'moving'; }
    var want = Math.atan2(dz, dx), da = WW.angleDiff(p.heading, want);
    if (Math.abs(da) > 0.02) { p.heading += WW.clamp(da, -PIVOT * dt, PIVOT * dt); if (Math.abs(da) > 0.5) { p.gs = 0; return 'moving'; } } // pivot first
    var step = Math.min(d, spd * dt), nx = p.x + dx / d * step, nz = p.z + dz / d * step, rp = rad(p.variant), O = obstacles(b);
    for (var i = 0; i < O.length; i++) {
      var q = O[i]; if (q.p === p || (q.slot && q.slot === p.slot && !q.p)) continue;
      var d0 = Math.hypot(q.x - p.x, q.z - p.z), d1 = Math.hypot(q.x - nx, q.z - nz), min = rp + q.r + GAP;
      if (d1 < min && d1 < d0) { p.gs = 0; return 'blocked'; }
      if (q.p && p.rwPh !== 'lineup' && q.p.rwPh !== 'hold' && q.p.rwPh !== 'warm' && d0 < min + FOLLOW && ((q.x - p.x) * dx + (q.z - p.z) * dz) / d > d0 * 0.7) { // a plane ahead in the queue
        if (!(aheadOf(q.p, p) && p.gid < q.p.gid)) { p.gs = 0; return 'blocked'; } // facing each other: the older plane goes
      }
    }
    p.x = nx; p.z = nz; p.gs = step / Math.max(dt, 1e-6);
    if (step >= d) p.pi++;
    return p.pi >= pts.length ? 'arrived' : 'moving';
  }
  function aheadOf(a, b) { var hx = Math.cos(a.heading), hz = Math.sin(a.heading), dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1; return (hx * dx + hz * dz) / d > 0.7; }
  function pin(p, b) { p.y = groundY(b) + gear(p); p.vy = 0; p.turn = 0; }

  // ---- outbound (aircraft.js takeoff -> land_air.js -> here) ----
  function launched(p, b, slot, fast) {
    p.slot = slot; slot.state = 'out'; slot.plane = p; p.gid = ++b.ops.gidN;
    p.x = slot.x; p.z = slot.z; p.heading = slot.h; p.speed = 0; p.gs = 0; p.vy = 0; pin(p, b);
    p.rwPh = 'warm'; p.rwT = 0; p.warm = fast ? WARM_FAST : WARM; p.fast = !!fast; p.waitT = 0; p.pi = 0;
    p.path = WW.airfieldLayout.outPath(b.layout, slot.spot, b.ops.dir);
  }
  function opsOpen(b) { return !b.runways[0].closed && !b.neutralized; }
  function out(p, dt) {
    var b = p.carrier, o = b.ops, ph = p.rwPh;
    p.rwT += dt; p.speed = 0;
    if (ph === 'warm') {
      pin(p, b);
      if (!opsOpen(b)) { if ((p.closedT = (p.closedT || 0) + dt) > SHUT_T) shutDown(p, b); return; }
      p.closedT = 0;
      if (p.rwT >= p.warm && o.mode === 'launch' && !o.yield) { p.rwPh = 'taxi'; p.pi = 1; } // yield: planes waiting to land go next
      return;
    }
    if (ph === 'taxi') {
      var r = move(p, b, p.path, p.fast ? TAXI_FAST : TAXI, dt);
      if (p.pi > p.path.holdShort) { p.rwPh = 'hold'; o.holdQ.push(p); p.pi = p.path.holdShort + 1; }
      wait(p, b, r === 'blocked' && opsOpen(b), dt); pin(p, b); return;
    }
    if (ph === 'hold') {
      p.gs = 0; pin(p, b);
      var lt = p.path[p.path.length - 1]; p.heading += WW.clamp(WW.angleDiff(p.heading, Math.atan2(lt.z - p.z, lt.x - p.x)), -PIVOT * dt, PIVOT * dt);
      if (!opsOpen(b)) { ST.launchClosed++; return; }
      if (o.holdQ[0] === p && !o.occ && WW.time.now - o.lastRoll >= ROLL_GAP && !finalPlane(b)) { o.occ = p; o.holdQ.shift(); p.rwPh = 'lineup'; }
      return;
    }
    if (ph === 'lineup') {
      var rr = move(p, b, p.path, TAXI, dt); pin(p, b);
      if (rr === 'arrived') {
        var h = o.dir > 0 ? b.heading : b.heading + Math.PI, da = WW.angleDiff(p.heading, h);
        p.heading += WW.clamp(da, -PIVOT * dt, PIVOT * dt);
        if (Math.abs(da) < 0.02 && opsOpen(b)) { p.heading = h; p.rwPh = 'roll'; o.lastRoll = WW.time.now; p.speed = 0; }
      }
      return;
    }
    if (ph === 'roll' || ph === 'stopped') { // speed + integrate (aircraft.js) move it down the runway
      if (!opsOpen(b)) { p.speed = Math.max(0, (p.rollV || 0) - 9 * dt); p.rollV = p.speed; if (ph === 'roll') { ST.aborts++; p.rwPh = 'stopped'; } pin(p, b); return; }
      p.rwPh = 'roll'; p.turn = 0; p.rollV = Math.min(p.pt.speed * 0.95, (p.rollV || 0) + ROLL_A * dt); p.speed = p.rollV;
      if (p.speed < p.pt.speed * 0.78) { pin(p, b); return; }
      p.rwPh = 'climb'; return;
    }
  }
  function finalPlane(b) { var P = WW.world.planes; for (var i = 0; i < P.length; i++) { var q = P[i]; if (q.carrier === b && q.alive && q.state === 'landing' && q.rwPh === 'final') return q; } return null; }
  function wait(p, b, blocked, dt) { // a plane that waits too long for anything but the runway is towed
    p.waitT = blocked ? p.waitT + dt : 0;
    if (p.waitT > TOW_T) { ST.tows++; if (p.state === 'rollout') park(p, b); else shutDown(p, b); }
  }
  function shutDown(p, b) { // back into its spot (towed / engines off): the slot is parked again, the Plane goes
    var s = p.slot; if (s) { s.state = 'parked'; s.plane = null; s.x = s.spot.x; s.z = s.spot.z; s.h = s.spot.h; }
    var q = b.ops.holdQ.indexOf(p); if (q >= 0) b.ops.holdQ.splice(q, 1);
    if (b.ops.occ === p) b.ops.occ = null;
    if (p.squadron) p.squadron.sorties = Math.max(0, p.squadron.sorties - 1);
    p.alive = false; p.remove(); obsT = -1;
  }

  // ---- inbound (aircraft.js rollout -> land_air.js -> here) ----
  function touchdown(p, b) { p.rwPh = 'land'; p.rollV = p.speed; p.waitT = 0; p.tdX = p.x; p.tdZ = p.z; }
  function aheadGap(p, b) { // distance to the nearest plane on the ground straight ahead (within a hull width), else 1e9
    var O = obstacles(b), hx = Math.cos(p.heading), hz = Math.sin(p.heading), best = 1e9, rp = rad(p.variant);
    for (var i = 0; i < O.length; i++) { var q = O[i]; if (q.p === p) continue; var dx = q.x - p.x, dz = q.z - p.z, al = dx * hx + dz * hz, cr = Math.abs(-dx * hz + dz * hx);
      if (al > 0 && cr < rp + q.r + 1 && al - rp - q.r < best) best = al - rp - q.r; }
    return best;
  }
  function inbound(p, dt) {
    var b = p.carrier, o = b.ops;
    if (p.rwPh === 'land') { // decelerate along the heading, then taxi to the spot
      p.rollV = Math.max(TAXI, p.rollV - 9 * dt);
      var ah = aheadGap(p, b);
      if (ah < 1e9) p.rollV = Math.min(p.rollV, Math.max(0, (ah - 4) * 1.5));          // a plane ahead on the runway
      p.x += Math.cos(p.heading) * p.rollV * dt; p.z += Math.sin(p.heading) * p.rollV * dt;
      if (o.occ === p && Math.hypot(p.x - p.tdX, p.z - p.tdZ) > LAND_SEP) o.occ = null;
      if (p.rollV <= TAXI) {
        if (p.emergency) { p.rwPh = 'towed'; p.rwT = 0; }
        else { p.rwPh = 'taxiIn'; p.pi = 0; var q = b.layout.toL(p.x, p.z); p.path = WW.airfieldLayout.inPath(b.layout, p.slot.spot, q.u); p.gs = TAXI; }
      }
    } else if (p.rwPh === 'taxiIn') {
      var r = move(p, b, p.path, p.pi <= p.path.offRunway ? TAXI_RWY : TAXI, dt);
      if (o.occ === p && (p.pi > p.path.offRunway || Math.hypot(p.x - p.tdX, p.z - p.tdZ) > LAND_SEP)) o.occ = null; // the next may land
      if (r === 'arrived') p.rwPh = 'park';
      wait(p, b, r === 'blocked', dt);
    } else if (p.rwPh === 'park') { // pivot nose-out in the spot
      var da = WW.angleDiff(p.heading, p.slot.spot.h);
      p.heading += WW.clamp(da, -PIVOT * dt, PIVOT * dt); p.gs = 0;
      if (Math.abs(da) < 0.02) { park(p, b); return; }
    } else if (p.rwPh === 'towed') { // an emergency landing on the cross runway: towed off after a while
      p.gs = 0; p.rwT += dt;
      if (b.ops.crossOcc === p && p.rwT > 3) b.ops.crossOcc = null;
      if (p.rwT > 8) { ST.tows++; park(p, b); return; }
    }
    if (p.alive) { pin(p, b); p.speed = 0; p.sync(dt); }
  }
  function park(p, b) { // the ground crew takes it: refuel and rearm (slower with the fuel farm or the hangars hit)
    var s = p.slot, o = b.ops;
    var slow = (b.facilities.some(function (f) { return f.kind === 'fuel' && f.out; }) ? 1.6 : 1) * (b.facilities.some(function (f) { return f.kind === 'hangar' && f.out; }) ? 1.3 : 1);
    if (s) { s.state = 'rearm'; s.readyAt = WW.time.now + REARM * slow; s.plane = null; s.x = s.spot.x; s.z = s.spot.z; s.h = s.spot.h; s.rearmT = WW.time.now; }
    if (o.occ === p) o.occ = null;
    if (o.crossOcc === p) o.crossOcc = null;
    p.alive = false; p.remove(); obsT = -1;
  }

  // ---- per step: modes, runway bookkeeping, slots ----
  function update(b, dt) {
    var o = b.ops, now = WW.time.now, P = WW.world.planes, outN = 0, inN = 0, wantLaunch = false, wantLand = false, scr = false, i, p;
    if (o.occ && (!o.occ.alive || o.occ.removed || (o.occ.state !== 'takeoff' && o.occ.state !== 'rollout' && !(o.occ.state === 'landing' && o.occ.rwPh === 'final')) ||
      (o.occ.rwPh === 'climb' && o.occ.y > groundY(b) + 3))) o.occ = null;
    if (o.crossOcc && (!o.crossOcc.alive || o.crossOcc.removed)) o.crossOcc = null;
    o.holdQ = o.holdQ.filter(function (q) { return q.alive && !q.removed && q.rwPh === 'hold'; });
    for (i = 0; i < P.length; i++) {
      p = P[i]; if (p.carrier !== b || !p.alive || p.removed) continue;
      if (p.state === 'takeoff') { if (p.rwPh === 'warm') { if (p.rwT >= p.warm) { wantLaunch = true; if (p.fast) scr = true; } } else if (p.rwPh !== 'climb') outN++; }
      else if (p.state === 'rollout' && p.rwPh !== 'towed') inN++;
      else if (p.state === 'landing' && (p.rwPh === 'circuit' || p.rwPh === 'final')) { wantLand = true; if (p.rwPh === 'final') inN++; }
    }
    o.launchSince = wantLaunch ? (o.launchSince === null ? now : o.launchSince) : null;
    o.landWait = wantLand ? (o.landWait || 0) + dt : 0;
    o.landSince = wantLand ? (o.landSince === null ? now : o.landSince) : null;
    var prev = o.mode;
    if (o.mode === 'launch' && outN) { /* keep */ }
    else if (o.mode === 'recover' && inN) { /* keep */ }
    else if (wantLaunch && (scr || !wantLand || o.launchSince <= o.landSince)) o.mode = 'launch';
    else if (wantLand) o.mode = 'recover';
    else if (!outN && !inN) o.mode = 'idle';
    if (o.mode !== prev) ST.modeSwitches++;
    // turns: after TURN_WAIT s of planes waiting for the other mode, no new movers start in this one (a scramble jumps the queue)
    o.yield = o.mode === 'launch' && !scr && o.landWait > TURN_WAIT;
    o.hold = o.mode === 'recover' && wantLaunch && (scr || now - o.launchSince > TURN_WAIT * 1.5);
    // slots: rearmed planes are ready; a plane lost in the air leaves its spot empty
    for (i = 0; i < b.slots.length; i++) {
      var s = b.slots[i];
      if (s.state === 'rearm' && s.readyAt <= now) s.state = 'parked';
      else if (s.state === 'out' && s.plane && (!s.plane.alive || s.plane.removed) && s.plane.slot === s) { s.state = 'empty'; s.plane = null; }
      // a spot freed by a loss (or a cleared wreck): a plane from the hangars (the reserve) is towed out into it
      if (s.spot && (s.state === 'empty' || s.state === 'away' || (s.state === 'wreck' && now - s.wreckT > WRECK_T && !s.moved))) {
        var rs = null;
        for (var j = 0; j < b.slots.length && !rs; j++) { var q = b.slots[j]; if (q.state === 'reserve' && cls(q.v) === s.spot.cls) rs = q; }
        if (s.state === 'wreck') { s.state = 'gone'; }
        if (rs) {
          rs.spot = s.spot; s.spot = null; rs.state = 'rearm'; rs.readyAt = now + TOWOUT; rs.x = rs.spot.x; rs.z = rs.spot.z; rs.h = rs.spot.h; ST.towOut++;
          WW.emit('baseEvent', { kind: 'towOut', base: b, nation: b.nation, x: rs.x, z: rs.z, slot: rs });
        }
      }
    }
    if (b.neutralized && !o.frozen) freeze(b);
    sync(b);
  }
  // A neutralized base: the planes on the ground stay where they stand (parked in place); nothing moves again.
  function freeze(b) {
    b.ops.frozen = true;
    var P = WW.world.planes.slice();
    for (var i = 0; i < P.length; i++) {
      var p = P[i]; if (p.carrier !== b || !onGround(p) || !p.slot) continue;
      var s = p.slot; s.state = 'parked'; s.moved = true; s.x = p.x; s.z = p.z; s.h = p.heading; s.plane = null;
      p.alive = false; p.remove();
    }
    b.ops.occ = null; b.ops.holdQ.length = 0; obsT = -1;
  }
  // Bombs and shells on the field: parked planes and planes on the ground inside the blast are wrecked.
  function groundHit(b, x, z, blast) {
    if (!b || !b.slots) return 0;
    var n = 0;
    for (var i = 0; i < b.slots.length; i++) {
      var s = b.slots[i]; if (s.state !== 'parked' && s.state !== 'rearm') continue;
      if (Math.hypot(s.x - x, s.z - z) < blast * 0.6 + s.r) { s.state = 'wreck'; s.wreckT = WW.time.now; n++; ST.groundLost++; }
    }
    var P = WW.world.planes.slice();
    for (var j = 0; j < P.length; j++) {
      var p = P[j]; if (p.carrier !== b || !onGround(p)) continue;
      if (Math.hypot(p.x - x, p.z - z) < blast * 0.6 + rad(p.variant)) {
        var sl = p.slot; if (sl) { sl.state = 'wreck'; sl.wreckT = WW.time.now; sl.x = p.x; sl.z = p.z; sl.h = p.heading; sl.plane = null; sl.moved = true; }
        if (b.ops.occ === p) b.ops.occ = null;
        WW.stats.planesLost++; p.alive = false; p.remove(); n++; ST.groundLost++;
      }
    }
    if (n) { obsT = -1; WW.emit('baseEvent', { kind: 'planesHit', base: b, nation: b.nation, x: x, z: z, n: n }); }
    return n;
  }
  function reset() { for (var k in ST) ST[k] = 0; obsT = -1; }
  WW.on('roundStart', reset);

  WW.landGround = { plan: plan, setup: setup, sync: sync, ready: ready, take: take, launched: launched, out: out, touchdown: touchdown,
    inbound: inbound, update: update, groundHit: groundHit, opsOpen: opsOpen, onGround: onGround, rad: rad, finalPlane: finalPlane,
    carrierGroup: carrierGroup, MIX: MIX, stats: ST };
})();
