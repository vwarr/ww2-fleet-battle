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
  var BLAST_K = 0.9;          // a parked plane inside BLAST_K x the blast radius (+ its own size) is wrecked (was 0.6: ~4 u for a 14-inch shell)
  var SPREAD_T = 8, SPREAD_P = 0.35, SPREAD_GAP = 2.5;   // a burning wreck sets a neighbour within SPREAD_GAP of it alight after SPREAD_T s (fuel, ammunition), with SPREAD_P
  var REARM = 22, ROLL_A = 7, ROLL_GAP = 2.4, WRECK_T = 40, TOWOUT = 20, FOUL_T = 25;
  var MIX = { USN: { f4f: 0.35, sbd: 0.3, b26: 0.12, b17: 0.23 }, IJN: { a6m: 0.4, g4m: 0.35, g4mL: 0.25 } };
  var TOWLOG = [];
  var ST = { slots: 0, capped: 0, towOut: 0, tows: 0, aborts: 0, groundLost: 0, modeSwitches: 0, launchClosed: 0, crashes: 0 };
  var obsT = -1, obs = [];

  function VAR() { return WW.landAir.VAR; }
  function cls(v) { return (VAR()[v] && VAR()[v].cls) || 'S'; }
  function rad(v) { return WW.airfieldLayout.CLS[cls(v)].len * 0.42; }
  function groundY(b) { return b.site.padH; }
  function gear(p) { return (p.variant && VAR()[p.variant].gear) || WW.air._pool.deckY; }

  // ---- the air group: one carrier air group's worth by default (TUNE.group x TUNE.air / 0.6) ----
  function carrierGroup(nation) { // the side's carrier air group at the air boss's TUNE.wing (air_boss.js groupSize), else the ship stats
    if (WW.airBoss && WW.airBoss.groupSize) return WW.airBoss.groupSize(nation);
    var P = WW.SHIP_TYPES.carrier.planes || {}, n = 0; for (var k in P) n += P[k]; return n || 14;
  }
  function plan(b) {
    var T = WW.islandBase.TUNE, mix = MIX[b.nation] || MIX.USN, keys = Object.keys(mix);
    var total = Math.max(keys.length, Math.round(carrierGroup(b.nation) * (T.group || 1) * (T.air === undefined ? 0.6 : T.air) / 0.6));
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
    b.slots = []; ST.capped = 0;
    Object.keys(pl.counts).forEach(function (v) {
      for (var i = 0; i < pl.counts[v]; i++) {
        var sp = byCls[cls(v)].shift();
        if (!sp) { ST.capped++; b.slots.push({ i: b.slots.length, v: v, spot: null, state: 'reserve', readyAt: 0, plane: null, x: 0, z: 0, h: 0, r: rad(v) }); continue; }
        b.slots.push({ i: b.slots.length, v: v, spot: sp, state: 'parked', readyAt: 0, plane: null, x: sp.x, z: sp.z, h: sp.h, r: rad(v) });
      }
    });
    ST.slots = b.slots.length;
    var wh = WW.wind ? WW.wind.a + Math.PI : b.heading;   // take off and land into the wind (fixed for a round)
    b.ops = { mode: 'idle', occ: null, holdQ: [], lastRoll: -1e9, modeT: 0, lastL: -1e9, lastR: -1e9, scrambleT: -1e9,
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
    for (var k = 0; k < (b.wrecks || []).length; k++) { var w = b.wrecks[k]; obs.push({ x: w.x, z: w.z, r: w.r, slot: null, p: null, wreck: w }); }
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
      if (d1 < min && d1 < d0) { p.gs = 0; p.blk = q; return 'blocked'; }
      if (q.p && p.rwPh !== 'lineup' && q.p.rwPh !== 'hold' && q.p.rwPh !== 'warm' && d0 < min + FOLLOW && ((q.x - p.x) * dx + (q.z - p.z) * dz) / d > d0 * 0.7) { // a plane ahead in the queue
        if (!(aheadOf(q.p, p) && p.gid < q.p.gid)) { p.gs = 0; p.blk = q; return 'blocked'; } // facing each other: the older plane goes
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
  // One plane at a time on a row lane and its column (they meet head-on at the column otherwise): the token is held from
  // the revetment to the parallel taxiway (path point 3); a scrambling fighter waiting for the same column goes first.
  function colFree(p, b) {
    var key = p.path.lanes[1], P = WW.world.planes;
    for (var i = 0; i < P.length; i++) {
      var q = P[i]; if (q === p || q.carrier !== b || !q.alive || q.removed || q.state !== 'takeoff' || !q.path || q.path.lanes[1] !== key) continue;
      if (q.rwPh === 'taxi' && q.pi <= 3) return false;
      if (q.rwPh === 'warm' && q.fast && !p.fast && q.rwT >= q.warm) return false;
    }
    return true;
  }
  function wreckAt(b, sp) { var W = b.wrecks; if (W) for (var i = 0; i < W.length; i++) if (Math.hypot(W[i].x - sp.x, W[i].z - sp.z) < W[i].r + sp.r + GAP) return true; return false; }
  function fouled(b) { var W = b.wrecks; if (W) for (var i = 0; i < W.length; i++) if (W[i].runway) return true; return false; }
  function opsOpen(b) { return !b.runways[0].closed && !b.neutralized && !fouled(b); }
  function out(p, dt) {
    var b = p.carrier, o = b.ops, ph = p.rwPh;
    p.rwT += dt; p.speed = 0;
    if (ph === 'warm') {
      pin(p, b);
      if (!opsOpen(b)) { if ((p.closedT = (p.closedT || 0) + dt) > SHUT_T) shutDown(p, b); return; }
      p.closedT = 0;
      if (o.mode === 'recover' && p.rwT > p.warm + SHUT_T * 2 && !p.fast) { shutDown(p, b); return; }   // engines off while the field recovers
      if (p.rwT >= p.warm && o.mode === 'launch' && !o.yield && colFree(p, b)) { p.rwPh = 'taxi'; p.pi = 1; } // yield: planes waiting to land go next
      return;
    }
    if (ph === 'taxi') {
      var r = move(p, b, p.path, p.fast ? TAXI_FAST : TAXI, dt);
      if (p.pi > p.path.holdShort) { p.rwPh = 'hold'; o.holdQ.push(p); p.pi = p.path.holdShort + 1; }
      wait(p, b, r === 'blocked' && opsOpen(b), dt); pin(p, b); return;
    }
    if (ph === 'hold') {
      p.gs = 0; pin(p, b);
      var lt = p.path[p.path.holdShort + 1]; p.heading += WW.clamp(WW.angleDiff(p.heading, Math.atan2(lt.z - p.z, lt.x - p.x)), -PIVOT * dt, PIVOT * dt);
      if (!opsOpen(b)) { ST.launchClosed++; if ((p.closedT = (p.closedT || 0) + dt) > SHUT_T * 2) shutDown(p, b); return; } // a long closure: engines off, towed back
      p.closedT = 0;
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
      var blockedAhead = aheadGap(p, b) < (p.rollV || 0) * (p.rollV || 0) / 24 + 3;   // something on the runway ahead: abort (12/s2 brakes)
      if (!opsOpen(b) || blockedAhead) { p.speed = Math.max(0, (p.rollV || 0) - (blockedAhead ? 12 : 9) * dt); p.rollV = p.speed; if (ph === 'roll') { ST.aborts++; p.rwPh = 'stopped'; } pin(p, b); return; }
      p.rwPh = 'roll'; p.turn = 0; p.rollV = Math.min(p.pt.speed * 0.95, (p.rollV || 0) + ROLL_A * dt); p.speed = p.rollV;
      if (p.speed < p.pt.speed * 0.78) { pin(p, b); return; }
      p.rwPh = 'climb'; return;
    }
  }
  function finalPlane(b) { var P = WW.world.planes; for (var i = 0; i < P.length; i++) { var q = P[i]; if (q.carrier === b && q.alive && q.state === 'landing' && q.rwPh === 'final') return q; } return null; }
  function wait(p, b, blocked, dt) { // a plane that waits too long for anything but the runway is towed
    p.waitT = blocked ? p.waitT + dt : 0;
    if (p.waitT > TOW_T) { ST.tows++; if (TOWLOG.length < 40) { var q = p.blk || {}, Lq = b.layout.toL(p.x, p.z); TOWLOG.push(p.state + '/' + p.rwPh + ' pi' + p.pi + ' at ' + Lq.u.toFixed(0) + ',' + Lq.v.toFixed(0) + ' by ' + (q.p ? q.p.state + '/' + q.p.rwPh + ' gid' + q.p.gid + ' me' + p.gid : q.slot ? 'slot ' + q.slot.state : '?') + (q.x !== undefined ? ' @' + b.layout.toL(q.x, q.z).u.toFixed(0) + ',' + b.layout.toL(q.x, q.z).v.toFixed(0) : '')); } if (p.state === 'rollout') park(p, b); else shutDown(p, b); }
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
  // A crash landing (a badly shot-up plane, land_air.js): it skids and ground-loops to a stop, never taxis again. It is
  // a WRECK where it stops (b.wrecks, crash: true: it burns; one on the runway fouls it, so the field stays shut until
  // the crash crew have bulldozed it off, FOUL_T), the plane is lost to the group (its spot freed for a reserve one).
  function crash(p, b) {
    p.rwPh = 'crash'; p.rollV = p.speed; p.waitT = 0; p.tdX = p.x; p.tdZ = p.z; p.crashed = true; ST.crashes++;
    p.loop = ((p.id || 0) % 2 ? 1 : -1) * (0.5 + ((p.id || 0) % 5) * 0.2);   // which way it ground-loops (deterministic)
  }
  function wreckAtStop(p, b) {
    var q = b.layout.toL(p.x, p.z), r = rad(p.variant), rw = Math.abs(q.v) < WW.airfieldLayout.RUN_HALF_W + r && Math.abs(q.u) < 48;
    rw = rw || b.layout.crossD(q.u, q.v) < WW.airfieldLayout.RUN_HALF_W + r;
    var w = { x: p.x, z: p.z, h: p.heading, r: r, v: p.variant, t: WW.time.now, runway: rw, crash: true };
    (b.wrecks = b.wrecks || []).push(w); p.wreck = w;
    var sl = p.slot; if (sl && sl.plane === p) { sl.state = 'empty'; sl.plane = null; }
    if (b.ops.occ === p) b.ops.occ = null;
    if (b.ops.crossOcc === p) b.ops.crossOcc = null;
    WW.stats.planesLost++; ST.groundLost++; p.alive = false; p.remove(); obsT = -1;
    WW.emit('baseEvent', { kind: 'crashWreck', base: b, nation: b.nation, x: w.x, z: w.z, wreck: w, runway: rw });
  }
  function aheadGap(p, b) { // distance to the nearest plane on the ground straight ahead (within a hull width), else 1e9
    var O = obstacles(b), hx = Math.cos(p.heading), hz = Math.sin(p.heading), best = 1e9, rp = rad(p.variant);
    for (var i = 0; i < O.length; i++) { var q = O[i]; if (q.p === p) continue; var dx = q.x - p.x, dz = q.z - p.z, al = dx * hx + dz * hz, cr = Math.abs(-dx * hz + dz * hx);
      if (al > 0 && cr < rp + q.r + 1 && al - rp - q.r < best) best = al - rp - q.r; }
    return best;
  }
  function inbound(p, dt) {
    var b = p.carrier, o = b.ops;
    if (p.rwPh === 'crash') { // skidding on its belly / a collapsed leg: hard braking, slewing round, then a wreck
      p.rollV = Math.max(0, p.rollV - 11 * dt);
      p.heading += p.loop * dt * Math.min(1, p.rollV / 8);
      p.x += Math.cos(p.heading) * p.rollV * dt; p.z += Math.sin(p.heading) * p.rollV * dt;
      if (p.rollV <= 0.2) { pin(p, b); wreckAtStop(p, b); return; }
    } else if (p.rwPh === 'land') { // decelerate along the heading, then taxi to the spot
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
      else if (p.state === 'landing' && (p.rwPh === 'circuit' || p.rwPh === 'final')) { wantLand = true; if (p.rwPh === 'final' || p.cleared) inN++; } // a cleared approach keeps the field recovering
    }
    // Turns, like a carrier deck. A mode keeps the field while its planes move; with none moving it keeps it for
    // TURN_WAIT s while it still has demand; otherwise the side served longer ago gets it (a scramble always does).
    // Once the other side waits and the mode is TURN_WAIT old, no new movers start in it (yield / hold), so it drains.
    var prev = o.mode, age = now - o.modeT;
    if (o.mode === 'launch') o.lastL = now; else if (o.mode === 'recover') o.lastR = now;
    if (o.mode === 'launch' && outN) { /* keep */ }
    else if (o.mode === 'recover' && inN) { /* keep */ }
    else if (scr) o.mode = 'launch';
    else if (o.mode === 'launch' && wantLaunch && (!wantLand || age < TURN_WAIT)) { /* keep */ }
    else if (o.mode === 'recover' && wantLand && (!wantLaunch || age < TURN_WAIT * 1.5)) { /* keep */ }
    else if (wantLaunch && (!wantLand || o.lastL <= o.lastR)) o.mode = 'launch';
    else if (wantLand) o.mode = 'recover';
    else if (!outN && !inN) o.mode = 'idle';
    if (o.mode !== prev) { ST.modeSwitches++; o.modeT = now; age = 0; }
    o.yield = o.mode === 'launch' && !scr && wantLand && age > TURN_WAIT;
    o.hold = o.mode === 'recover' && wantLaunch && (scr || age > TURN_WAIT * 3);   // a long recovery window: the circuit empties
    // slots: rearmed planes are ready; a plane lost in the air leaves its spot empty
    for (i = 0; i < b.slots.length; i++) {
      var s = b.slots[i];
      if (s.state === 'rearm' && s.readyAt <= now) s.state = 'parked';
      else if (s.state === 'out' && s.plane && (!s.plane.alive || s.plane.removed) && s.plane.slot === s) { s.state = 'empty'; s.plane = null; }
      // a spot freed by a loss (or a cleared wreck): a plane from the hangars (the reserve) is towed out into it
      if (s.spot && (s.state === 'empty' || s.state === 'away' || (s.state === 'wreck' && now - s.wreckT > WRECK_T && !s.moved)) && !wreckAt(b, s.spot)) {
        var rs = null;
        for (var j = 0; j < b.slots.length && !rs; j++) { var q = b.slots[j]; if (q.state === 'reserve' && cls(q.v) === s.spot.cls) rs = q; }
        if (s.state === 'wreck') { s.state = 'gone'; }
        if (rs) {
          rs.spot = s.spot; s.spot = null; rs.state = 'rearm'; rs.readyAt = now + TOWOUT; rs.x = rs.spot.x; rs.z = rs.spot.z; rs.h = rs.spot.h; ST.towOut++;
          WW.emit('baseEvent', { kind: 'towOut', base: b, nation: b.nation, x: rs.x, z: rs.z, slot: rs });
        }
      }
    }
    // fire spreads along the plane parks: a fuelled, armed plane burning in its revetment can set the next one alight
    for (i = 0; i < b.slots.length; i++) {
      var w = b.slots[i]; if (w.state !== 'wreck' || w.spreadDone || now - w.wreckT < SPREAD_T) continue;
      w.spreadDone = true;
      for (var j2 = 0; j2 < b.slots.length; j2++) {
        var nb = b.slots[j2]; if (nb === w || (nb.state !== 'parked' && nb.state !== 'rearm')) continue;
        if (Math.hypot(nb.x - w.x, nb.z - w.z) < w.r + nb.r + SPREAD_GAP && WW.rand() < SPREAD_P) { nb.state = 'wreck'; nb.wreckT = now; ST.groundLost++; ST.spread = (ST.spread || 0) + 1; obsT = -1; }
      }
    }
    // wrecks off the spots: bulldozed after FOUL_T (one on the runway fouls it until then: no takeoff, no landing)
    if (b.wrecks && b.wrecks.length && !b.neutralized) for (i = b.wrecks.length - 1; i >= 0; i--) if (now - b.wrecks[i].t > FOUL_T) {
      var wk = b.wrecks.splice(i, 1)[0]; obsT = -1; WW.emit('baseEvent', { kind: 'wreckCleared', base: b, nation: b.nation, x: wk.x, z: wk.z, runway: wk.runway });
      if (wk.crash) hulk(b, wk);
    }
    if (b.neutralized && !o.frozen) freeze(b);
    sync(b);
  }
  // a crash wreck bulldozed off the runway: a burned-out hulk on the grass beside it (b.hulks: visual, it blocks
  // nothing), unless that ground is the taxi network (then it is hauled away)
  function hulk(b, w) {
    var L = b.layout, q = L.toL(w.x, w.z), AL = WW.airfieldLayout, sv = q.v >= 0 ? 1 : -1, v = w.runway ? sv * (AL.RUN_HALF_W + w.r + 3) : q.v;
    if (AL.onNetwork(L, q.u, v, w.r) || L.crossD(q.u, v) < AL.RUN_HALF_W + w.r) return;
    var p = L.toW(q.u, v); (b.hulks = b.hulks || []).push({ x: p.x, z: p.z, h: w.h + 0.4, r: w.r, v: w.v, t: WW.time.now });
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
      if (Math.hypot(s.x - x, s.z - z) < blast * BLAST_K + s.r) { s.state = 'wreck'; s.wreckT = WW.time.now; n++; ST.groundLost++; }
    }
    var P = WW.world.planes.slice();
    for (var j = 0; j < P.length; j++) {
      var p = P[j]; if (p.carrier !== b || !onGround(p)) continue;
      if (Math.hypot(p.x - x, p.z - z) < blast * BLAST_K + rad(p.variant)) {
        // a wreck where it was hit (a taxiway, the runway): its spot is free for a reserve plane; the crash crew clears it
        var q = b.layout.toL(p.x, p.z), rw = Math.abs(q.v) < WW.airfieldLayout.RUN_HALF_W + rad(p.variant) && Math.abs(q.u) < 48;
        (b.wrecks = b.wrecks || []).push({ x: p.x, z: p.z, h: p.heading, r: rad(p.variant), v: p.variant, t: WW.time.now, runway: rw });
        var sl = p.slot; if (sl && sl.plane === p) { sl.state = 'empty'; sl.plane = null; }
        if (b.ops.occ === p) b.ops.occ = null;
        WW.stats.planesLost++; p.alive = false; p.remove(); n++; ST.groundLost++;
      }
    }
    if (n) { obsT = -1; WW.emit('baseEvent', { kind: 'planesHit', base: b, nation: b.nation, x: x, z: z, n: n }); }
    return n;
  }
  // per round; slots / capped belong to the field built in island_base's roundStart handler (it runs first), kept
  function reset() { for (var k in ST) if (k !== 'slots' && k !== 'capped') ST[k] = 0; obsT = -1; }
  WW.on('roundStart', reset);

  WW.landGround = { plan: plan, setup: setup, sync: sync, ready: ready, take: take, launched: launched, out: out, touchdown: touchdown,
    inbound: inbound, crash: crash, update: update, groundHit: groundHit, opsOpen: opsOpen, fouled: fouled, onGround: onGround, rad: rad, finalPlane: finalPlane,
    carrierGroup: carrierGroup, MIX: MIX, stats: ST, towLog: TOWLOG };
})();
