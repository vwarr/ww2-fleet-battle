// air_flyingboats.js - WW.flyingBoats: long-range flying boats that come in from off the map (sim code: WW.rand only).
// A WW.FlyingBoat is a WW.Plane (kind 'flyingboat') in WW.world.planes, so enemy fighters, AA and the camera see it.
// It has no carrier: `carrier` is a fixed base object at its side's map edge (USN west, IJN east), where it comes
// from and goes back to (removed once it is off the map). Two missions:
//  - 'rescue' (USN PBY Catalina "Dumbo", this file): survivors in the water (endgame.js rescue tasks: a sunk ship's
//    crew, a ditched / shot-down crew) that no destroyer is assigned to. It claims the task (task.air), flies in low
//    and slow, circles, and lands only where the known enemy guns / AA do not reach (WW.threat) and no enemy fighter
//    is near (it waits, with an own fighter as escort or for a lull), taxis to the survivors, stops while the boats
//    and rafts come alongside (lifeboats.js / air_props.js, visual), takes off and flies home.
//  - 'patrol' (both nations, air_patrol.js): a long search leg, then shadowing the enemy from standoff.
// States: inbound, search, shadow, evade, bomb (air_patrol.js), circle, alight, afloat, liftoff (rescue), return.
// Stats: WW.flyingBoats.stats (reset on roundStart). Events: 'flyingBoat' { plane, nation, order, x, z, unit }.
window.WW = window.WW || {};
(function () {
  'use strict';
  if (!WW.Plane) { console.error('air_flyingboats.js must load after aircraft.js'); return; }
  var SCALE = 1.7, WATER_Y = 0.45, OFF = 34;          // flight scale (span ~11-13 units), hull resting height, spawn / exit beyond the edge
  var ALT_R = 18, CIRCLE_R = 34, SAFE_DPS = 10, HOLD_MAX = 80, FTR_R = 150, ESC_R = 70; // rescue: altitude, orbit, landing rules
  var PICK_T = { pilot: 9, ship: 16 }, SHIP_WAIT = 30, PILOT_WAIT = 5, MAX_UP = 2, MAX_RESCUE = 4;
  if (WW.PLANE_TYPES && !WW.PLANE_TYPES.flyingboat) WW.PLANE_TYPES.flyingboat = { hp: 34, speed: 22, range: 4000 };
  var pool = {}, base = WW.Plane.prototype, stats = null;
  var OWN = { inbound: 1, search: 1, shadow: 1, evade: 1, bomb: 1, circle: 1, alight: 1, afloat: 1, liftoff: 1, 'return': 1 };
  var WATER = { afloat: 1, liftoff: 1 };

  function per() { return { USN: 0, IJN: 0 }; }
  function reset() {
    stats = { dispatched: 0, landed: 0, rescues: 0, survivors: 0, pilots: 0, catLost: 0, aborted: 0, waited: 0,
      patrols: per(), sightings: per(), lost: per(), home: per(), bombs: per(), bombHits: per(), shadowT: per(), evades: per() };
    if (WW.flyingBoats) WW.flyingBoats.stats = stats;
  }
  function battle() { return WW.game && WW.game.state === 'battle'; }
  function edgeX(n) { return n === 'USN' ? -OFF : WW.cfg.MAP_W + OFF; }
  function getModel(nation) {
    var p = pool[nation], m;
    if (p && p.length) m = p.pop();
    else { m = WW.models.buildFlyingBoat(nation); m.nation = nation; m.group.rotation.order = 'YZX'; m.group.scale.setScalar(SCALE); }
    if (WW.scene) WW.scene.add(m.group);
    return m;
  }
  function release(m) {
    if (WW.airDeaths) WW.airDeaths.restore(m);
    m.floats.set(1);
    if (m.group.parent) m.group.parent.remove(m.group);
    (pool[m.nation] = pool[m.nation] || []).push(m);
  }
  function emit(p, order, unit) { WW.emit('flyingBoat', { plane: p, nation: p.nation, order: order, x: p.x, z: p.z, unit: unit || null }); }
  // known enemy fighters (fresh) within r of (x, z): the nearest one's distance, else 1e9
  function fighterNear(nation, x, z, r) {
    var bd = 1e9; if (!WW.intel) return bd;
    var cs = WW.intel.enemyPlanes(nation);
    for (var i = 0; i < cs.length; i++) { var u = cs[i].unit; if (!u || !u.alive || u.kind !== 'fighter') continue; var d = WW.dist(x, z, cs[i].x, cs[i].z); if (d < r && d < bd) bd = d; }
    return bd;
  }
  function ownFighterNear(nation, x, z, r) {
    var P = WW.world.planes;
    for (var i = 0; i < P.length; i++) { var q = P[i]; if (q.alive && q.nation === nation && q.kind === 'fighter' && q.state !== 'takeoff' && WW.dist(q.x, q.z, x, z) < r) return q; }
    return null;
  }
  // an enemy fighter on our tail (its foe is us), or a fresh one closing within r
  function hunted(p, r) {
    var P = WW.world.planes;
    for (var i = 0; i < P.length; i++) { var q = P[i]; if (q.alive && q.foe === p && q.nation !== p.nation) return q; }
    return fighterNear(p.nation, p.x, p.z, r) < r ? true : null;
  }

  class FlyingBoat extends WW.Plane {
    constructor(nation, mission, z, m) {
      var home = { x: edgeX(nation), z: z, y: 0, heading: nation === 'USN' ? 0 : Math.PI, speed: 0, alive: true, nation: nation,
        stats: { length: 0 }, model: {}, base: true };
      super('flyingboat', nation, home, null, m);
      this.boatType = nation === 'USN' ? 'PBY' : 'H6K'; this.mission = mission; this.props = m.props;
      this.x = home.x; this.z = z; this.y = mission === 'rescue' ? ALT_R + 6 : 30; this.heading = home.heading; this.speed = this.pt.speed;
      this.vy = 0; this.state = 'inbound'; this.ordnance = false; this.fuel = 1e9; this.t = 0; this.stT = 0;
      this.task = null; this.boarded = 0; this.waterT = 0; this.holdT = 0; this.shadowOf = null; this.legs = null; this.leg = 0;
      m.floats.set(0); this.floatA = 0;
      this.sync(0);
    }
    setState(s) { if (this.state !== s) { this.state = s; this.stT = 0; } }
    sync(dt) {
      base.sync.call(this, dt);
      var m = this.model, fast = this.speed > 6 || this.state === 'liftoff';
      for (var i = 0; i < m.props.length; i++) { m.props[i].rotation.x += dt * (fast ? 37 : 6 + this.speed * 2); m.discs[i].visible = fast; m.blades[i].visible = !fast; }
      if (dt > 0) {   // PBY floats: down on the water and on the approach (visual; the sim never reads them)
        var want = WATER[this.state] || this.state === 'alight' || !this.alive ? 1 : 0;
        if (this.floatA !== want) { this.floatA = WW.clamp(this.floatA + WW.clamp(want - this.floatA, -dt * 0.5, dt * 0.5), 0, 1); m.floats.set(this.floatA); }
      }
    }
    damage(amount) {
      base.damage.call(this, amount);
      if (this.alive && this.hp < this.maxHp * 0.5 && !this.hurt) {   // badly hit: abandon the mission, run for home
        this.hurt = true;
        if (this.mission === 'rescue') { stats.aborted++; this.dropTask(); }
        if (this.state !== 'afloat' && this.state !== 'liftoff') this.setState('return');
      }
    }
    shotDown() { this.dropTask(); stats.lost[this.nation]++; if (this.mission === 'rescue') stats.catLost++; emit(this, 'lost'); base.shotDown.call(this); }
    ditch() { if (this.alive) { stats.lost[this.nation]++; if (this.mission === 'rescue') stats.catLost++; } this.dropTask(); base.ditch.call(this); }
    dropTask() { var t = this.task; if (t && t.air === this) t.air = null; this.task = null; }
    update(dt) {
      if (!OWN[this.state] || this.deathMode) { base.update.call(this, dt); return; }
      this.t += dt; this.stT += dt;
      var free = WATER[this.state] || this.state === 'alight';
      switch (this.state) {
        case 'circle': this.circle(dt); break;
        case 'alight': this.alight(dt); break;
        case 'afloat': this.afloat(dt); break;
        case 'liftoff': this.liftoff(dt); break;
        case 'return': this.goHome(dt); break;
        default:
          if (this.mission === 'rescue') this.inbound(dt);
          else if (WW.patrol) WW.patrol.step(this, dt);
          else this.setState('return');
      }
      if (this.removed) return;
      this.trail(dt, false);
      this.integrate(dt, true);
      if (!free && this.y < 5) { this.y = 5; this.vy = Math.max(0, this.vy); }
    }
    // ---- shared flight: off the map to its own edge ----
    goHome(dt) {
      var hx = edgeX(this.nation) + (this.nation === 'USN' ? -10 : 10), low = hunted(this, 90), h = null;
      if (WW.search && WW.search.homeHeading) { var r = WW.search.homeHeading(this, hx, this.z); h = r.h; low = low || (r.low && this.mission === 'patrol'); } // routed round AA / CAP (air_search.js)
      if (h === null) h = Math.atan2(0, hx - this.x);
      this.fly(this.x + Math.cos(h) * 60, this.z + Math.sin(h) * 60, low ? 12 : 24, dt, this.pt.speed * (low ? 1.08 : 1), 0.5);
      if (this.nation === 'USN' ? this.x < -OFF + 2 : this.x > WW.cfg.MAP_W + OFF - 2) { stats.home[this.nation]++; emit(this, 'home'); this.remove(); }
    }
    // ---- rescue ----
    inbound(dt) {
      var t = this.task;
      if (!t || t.done || t.air !== this) { this.dropTask(); return this.setState('return'); }
      if (hunted(this, 60)) { this.flee(dt); return; }
      var d = this.fly(t.x, t.z, ALT_R, dt, this.pt.speed, 0.6);
      if (WW.dist(this.x, this.z, t.x, t.z) < CIRCLE_R + 30) this.setState('circle');
      return d;
    }
    flee(dt) { // enemy fighters on it: low over the water, toward home; the survivors wait for the next try
      var hx = edgeX(this.nation);
      this.fly(hx, this.z, 12, dt, this.pt.speed * 1.08, 0.7);
    }
    safe(t) {
      if (WW.threat && WW.threat.danger(this.nation, t.x, t.z) > SAFE_DPS) return false;            // known enemy guns reach it
      if (WW.threat && WW.threat.danger(this.nation, t.x, t.z, { air: true }) > SAFE_DPS * 0.3) return false; // or their AA
      var f = fighterNear(this.nation, t.x, t.z, FTR_R);
      return f >= FTR_R || !!ownFighterNear(this.nation, t.x, t.z, ESC_R);                          // a lull, or an escort overhead
    }
    circle(dt) {
      var t = this.task;
      if (!t || t.done || t.air !== this) { this.dropTask(); return this.setState('return'); }
      if (hunted(this, 60)) { this.flee(dt); this.holdT += dt; return; }
      var ok = this.safe(t);
      if (!ok) { this.holdT += dt; if (this.stT < 1) stats.waited++; }
      if (this.holdT > HOLD_MAX) { stats.aborted++; this.dropTask(); emit(this, 'abort'); return this.setState('return'); }
      // circle the survivors (a waiting Catalina stands off toward home, out of the danger)
      var cx = t.x, cz = t.z;
      if (!ok) { var hb = Math.atan2(0, edgeX(this.nation) - t.x); cx += Math.cos(hb) * 90; }
      var a = Math.atan2(this.z - cz, this.x - cx) + 0.45;
      this.fly(cx + Math.cos(a) * CIRCLE_R, cz + Math.sin(a) * CIRCLE_R, ok ? 13 : ALT_R, dt, this.pt.speed * 0.8, 0.7);
      if (ok && this.stT > 9) { this.setState('alight'); this.plan = null; }
    }
    // landing: into the wind, touching down short of the survivors so it stops beside them
    landPlan() {
      var t = this.task, w = WW.wind || { x: 1, z: 0 }, h = Math.atan2(-w.z, -w.x);
      if (!(w.x || w.z)) h = Math.atan2(t.z - this.z, t.x - this.x);
      var c = Math.cos(h), s = Math.sin(h), td = 26;
      // keep the touchdown run on the water
      for (var k = 0; k < 8; k++) {
        var ok = true;
        for (var j = 0; j <= 4 && ok; j++) { var f = -td - 60 + j * 22; if (WW.terrain.depthAt(t.x + c * f, t.z + s * f) < 1) ok = false; }
        if (ok) break;
        h += Math.PI / 4; c = Math.cos(h); s = Math.sin(h);
      }
      return { h: h, ax: t.x - c * (td + 70), az: t.z - s * (td + 70), tx: t.x - c * td, tz: t.z - s * td };
    }
    alight(dt) {
      var t = this.task;
      if (!t || t.done || t.air !== this) { this.dropTask(); return this.setState('return'); }
      if (!this.plan) { this.plan = this.landPlan(); this.app = true; }
      var L = this.plan;
      if (this.app) {   // to the start of the final approach
        this.fly(L.ax, L.az, 9, dt, this.pt.speed * 0.8, 0.8);
        var da = WW.dist(this.x, this.z, L.ax, L.az);   // close enough, or already past it on the approach line
        if (da < 20 || (da < 45 && Math.cos(Math.atan2(L.tz - this.z, L.tx - this.x) - L.h) > 0.9 && Math.cos(this.heading - L.h) > 0.7)) this.app = false;
        if (this.stT > 40) { this.plan = null; this.setState('circle'); }
        return;
      }
      if (hunted(this, 60) || !this.safe(t)) { this.plan = null; this.vy = 2; return this.setState('circle'); }   // wave off
      var d = WW.dist(this.x, this.z, L.tx, L.tz), b = Math.atan2(L.tz - this.z, L.tx - this.x);
      this.turnTo(Math.abs(WW.angleDiff(L.h, b)) < 1.2 && d > 6 ? b : L.h, dt, 0.6);
      var along = (L.tx - this.x) * Math.cos(L.h) + (L.tz - this.z) * Math.sin(L.h);   // to go to the touchdown point
      var ty = WATER_Y - 0.4 + Math.max(0, along) * 0.11;                                 // glide path, flared onto the water
      this.vy = WW.clamp((ty - this.y) * 1.5, -3, 1.5);
      this.speed += WW.clamp(Math.max(12, Math.min(this.pt.speed * 0.8, 10 + d * 0.12)) - this.speed, -4 * dt, 4 * dt);
      if (this.y <= WATER_Y + 0.08) {
        this.y = WATER_Y; this.vy = 0; this.setState('afloat'); this.waterT = 0; this.boarded = 0; stats.landed++;
        if (WW.fx) WW.fx.splash(this.x, this.z, 1.4);
        emit(this, 'landed');
      }
    }
    afloat(dt) {
      var t = this.task;
      this.waterT += dt; this.vy = 0;
      var gone = !t || t.done || t.air !== this;
      var near = t ? WW.dist(this.x, this.z, t.x, t.z) : 0, stop = near < 5;
      if (!gone && !stop) this.turnTo(Math.atan2(t.z - this.z, t.x - this.x), dt, 0.5);
      this.speed += WW.clamp((gone || stop ? 0 : WW.clamp(near * 0.35, 1.2, 7)) - this.speed, -5 * dt, 2 * dt);
      this.y = WATER_Y + Math.sin(this.t * 1.9) * 0.04;
      this.wakes(dt, 0.45);
      if (gone) { this.setState('liftoff'); return; }
      // danger closing in (a fresh enemy fighter, or gun ships now reaching the spot): take off with what we have
      if (fighterNear(this.nation, this.x, this.z, 110) < 110 || (WW.threat && WW.threat.danger(this.nation, this.x, this.z) > SAFE_DPS * 1.5)) {
        stats.aborted++; this.dropTask(); emit(this, 'abort'); this.setState('liftoff'); return;
      }
      if (stop) t.pickT = (t.pickT || 0) + dt;
      if (stop && !this.raftShown && t.kind === 'pilot' && WW.airProps) {   // visual: the aircrew's raft, if theirs has drifted off
        this.raftShown = true;
        var near = WW.airProps._rafts.some(function (r) { return r.alive && WW.dist(r.x, r.z, t.x, t.z) < 45; });
        if (!near) { var a = this.heading + Math.PI * 0.6; WW.airProps.raft(this.x + Math.cos(a) * 9, this.z + Math.sin(a) * 9, 40, true); }
      }
      if ((t.pickT || 0) >= (PICK_T[t.kind] || 12)) {
        stats.rescues++; stats.survivors += t.n; if (t.kind === 'pilot') stats.pilots += t.n;
        if (WW.endgame && WW.endgame.complete) WW.endgame.complete(t, this); else t.done = true;
        this.task = null; this.raftShown = false; emit(this, 'rescued');
        this.setState('liftoff');
      }
    }
    liftoff(dt) {
      if (this.stT < 1.5) { this.speed = Math.max(0, this.speed - dt * 3); this.y = WATER_Y; this.wakes(dt, 0.4); return; }
      if (this.lh == null) { var w = WW.wind || { x: 1, z: 0 }; this.lh = w.x || w.z ? Math.atan2(-w.z, -w.x) : this.heading; this.lhT = 0; }
      this.lhT += dt;
      // a heading with open water ahead (no land within 90): into the wind first, else the nearest clear one
      if (this.lhT < 0.1) for (var k = 0; k < 8; k++) {
        var h = this.lh + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 4, ok = true;
        for (var j = 1; j <= 4 && ok; j++) if (WW.terrain.depthAt(this.x + Math.cos(h) * j * 22, this.z + Math.sin(h) * j * 22) < 1) ok = false;
        if (ok) { this.lh = h; break; }
      }
      this.turnTo(this.lh, dt, 0.5);
      this.speed = Math.min(this.pt.speed, this.speed + dt * 3.2);
      if (this.speed < 15) { this.y = WATER_Y; this.vy = 0; this.wakes(dt, 0.6); return; }
      this.vy = Math.min(2.2, this.vy + dt * 1.5);
      if (this.y > 10) { this.lh = null; if (!this.nextTask()) this.setState('return'); }
    }
    nextTask() { // another open pickup close by: go for it before turning for home
      if (this.mission !== 'rescue' || this.hurt || !WW.flyingBoats) return false;
      var t = WW.flyingBoats.openTask(this.nation, this.x, this.z, 220);
      if (!t) return false;
      t.air = this; this.task = t; this.holdT = 0; this.setState('inbound'); return true;
    }
    wakes(dt, size) { // visual only (Math.random): wake and spray off the hull
      if (!WW.fx || !(this.speed > 1)) return;
      if (Math.random() < dt * (2 + this.speed * 0.3)) WW.fx.wake(this.x - Math.cos(this.heading) * 3, this.z - Math.sin(this.heading) * 3, this.heading, size + this.speed * 0.03);
      if (this.speed > 8 && Math.random() < dt * this.speed * 0.25) WW.fx.splash(this.x + Math.cos(this.heading) * 2, this.z + Math.sin(this.heading) * 2, 0.35 + this.speed * 0.02);
    }
    remove() {
      if (this.removed) return;
      this.dropTask();
      this.removed = true; this.alive = false;
      release(this.model);
    }
  }

  function launch(nation, mission, z) {
    if (!WW.models.buildFlyingBoat) return null;
    var p = new FlyingBoat(nation, mission, WW.clamp(z, 30, WW.cfg.MAP_H - 30), getModel(nation));
    WW.world.planes.push(p); WW.stats.planesLaunched++;
    if (mission === 'rescue') stats.dispatched++; else stats.patrols[nation]++;
    emit(p, mission === 'rescue' ? 'dispatch' : 'patrol');
    return p;
  }
  function count(nation, mission) {
    var n = 0, P = WW.world.planes;
    for (var i = 0; i < P.length; i++) { var p = P[i]; if (p.kind === 'flyingboat' && p.alive && p.nation === nation && (!mission || p.mission === mission)) n++; }
    return n;
  }
  // An open survivor pickup a Catalina may take: no destroyer on it, not claimed, waited long enough for one
  // (aircrew at once: a destroyer is rarely sent far for them), and in a place a flying boat can reach.
  function openTask(nation, x, z, r) {
    var T = WW.endgame && WW.endgame.tasks ? WW.endgame.tasks() : null; if (!T) return null;
    var now = WW.time.now, best = null, bs = -1e9;
    for (var i = 0; i < T.length; i++) {
      var t = T[i];
      if (t.done || t.by || (t.air && t.air.alive) || t.nation !== nation) continue;
      if (now - t.t0 < (t.kind === 'pilot' ? PILOT_WAIT : SHIP_WAIT)) continue;
      var d = x === undefined ? 0 : WW.dist(x, z, t.x, t.z); if (r && d > r) continue;
      var s = (t.kind === 'pilot' ? 60 : 0) + t.n - d * 0.1 - (now - t.t0) * 0.1;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }
  var tick = 0;
  function schedule(dt) {
    if (!battle()) return;
    tick -= dt; if (tick > 0) return; tick = 1;
    var d = WW.fleetCmd && WW.fleetCmd.doctrine('USN');
    if (!d || !d.rescue || stats.dispatched >= MAX_RESCUE || count('USN') >= MAX_UP) return;
    var t = openTask('USN');
    if (!t) return;
    if (t.fbAt === undefined) { t.fbAt = WW.time.now + WW.randRange(6, 16); return; }   // the call goes out, a Catalina is sent
    if (WW.time.now < t.fbAt) return;
    var p = launch('USN', 'rescue', t.z + WW.randRange(-40, 40));
    if (p) { t.air = p; p.task = t; }
  }

  var ou = WW.air.update;
  WW.air.update = function (dt) {
    var r = ou.apply(this, arguments);
    try { schedule(dt); } catch (e) { console.error('flyingBoats', e); }
    return r;
  };
  WW.on('roundStart', function () { reset(); tick = 0; });
  WW.on('setupStart', reset);
  // patrol sightings: each enemy ship a flying boat reports (intel.js 'report'), once per boat
  WW.on('report', function (e) { var b = e && e.by; if (!stats || !b || b.kind !== 'flyingboat') return; var S = b.seen || (b.seen = new Set()); if (!S.has(e.unit)) { S.add(e.unit); stats.sightings[e.nation]++; } });

  WW.FlyingBoat = FlyingBoat;
  WW.flyingBoats = { SCALE: SCALE, WATER_Y: WATER_Y, stats: null, launch: launch, count: count, openTask: openTask,
    edgeX: edgeX, fighterNear: fighterNear, hunted: hunted, emit: emit,
    // visual helpers (lifeboats.js, air_props.js): a Catalina of nation n (any if null) on the water within r of (x, z)
    landedNear: function (n, x, z, r) {
      var P = WW.world.planes;
      for (var i = 0; i < P.length; i++) { var p = P[i]; if (p.kind === 'flyingboat' && p.alive && p.state === 'afloat' && p.task && (!n || p.nation === n) && WW.dist(p.x, p.z, x, z) < r) return p; }
      return null;
    },
    // an open aircrew pickup within r that a Catalina has claimed (or may still take): its raft stays up (visual)
    awaiting: function (x, z, r) {
      var T = WW.endgame && WW.endgame.tasks ? WW.endgame.tasks() : null; if (!T) return false;
      for (var i = 0; i < T.length; i++) { var t = T[i]; if (!t.done && t.kind === 'pilot' && (t.air || WW.time.now - t.t0 < 120) && WW.dist(t.x, t.z, x, z) < r) return true; }
      return false;
    },
    boarded: function (p, n) { p.boarded = (p.boarded || 0) + n; }
  };
  reset();
})();
