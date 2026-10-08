// air_deaths.js (air deaths) - how planes die (WW.airDeaths). Load after aircraft.js and air_props.js.
// Plane.shotDown() / ditch() / damage() call in here; Plane.update() hands any plane with a deathMode to
// updatePlane(). Modes:
//   spin    classic spin and fall                 wing    one wing shears off, hard roll, spiral down
//   comet   fireball, long burning arc, big splash crash  a burning plane steers into an enemy ship
//   ditch   controlled water landing, floating wreck (tail up) + raft, sinks after 20-30 s
//   abandon crew bails out of a crippled plane, the empty plane spirals in
//   slide   tipped over a carrier's deck edge (slideOff, for the deck code)
// Sim choices that change the battle (which mode, crash target, crippled bail-out) use WW.rand;
// looks (bail-outs from a falling plane, timings, wobble) use Math.random.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  var DECK_Y = 0.75, DECK_HALF = 2.5;   // fuselage above the flight deck (aircraft.js), flight-deck half width
  var v3 = null, P = function () { return WW.airProps; };
  var count = { spin: 0, wing: 0, comet: 0, crash: 0, ditch: 0, abandon: 0, slide: 0, chutes: 0, shipHits: 0 };

  function deckY(s) {
    if (s.model && s.model.deck) { if (!v3) v3 = new THREE.Vector3(); s.group.updateMatrixWorld(true); return Math.max(1, s.model.deck.getWorldPosition(v3).y); }
    return 1.4 + (s.depthY || 0);
  }
  // nearest alive, surfaced enemy ship within maxD and roughly ahead
  function shipAhead(p, maxD) {
    var best = null, bd = maxD;
    for (var i = 0; i < WW.world.ships.length; i++) {
      var s = WW.world.ships[i];
      if (!s.alive || s.removed || s.submerged || s.nation === p.nation) continue;
      var d = WW.dist(p.x, p.z, s.x, s.z);
      if (d < bd && Math.abs(WW.angleDiff(p.heading, Math.atan2(s.z - p.z, s.x - p.x))) < 1.4) { bd = d; best = s; }
    }
    return best;
  }
  function cause(p) { var b = p.killedBy; return !b ? null : (b === 'aa' || b === 'AA' || b.kind === 'aa' || b.stats) ? 'aa' : 'gun'; } // a ship (has stats) = AA

  // Weighted mode for a shoot-down (WW.rand: a crash damages a ship).
  function pick(p) {
    if (p._force) { var f = p._force; p._force = null; return f; }
    var wings = !!(p.model && p.model.wingL && p.model.wingR), by = cause(p);
    var tgt = p.y > 6 ? shipAhead(p, 60) : null;
    if (tgt && WW.rand() < (p.crippled ? 0.22 : 0.08)) { p.crashTgt = tgt; return 'crash'; }
    var w = { spin: 0.25, wing: wings ? 0.25 : 0, comet: 0.3, ditch: p.y < 10 ? 0.35 : 0.04 };
    if (by === 'aa') { w.comet += 0.25; w.wing *= 0.6; } else if (by === 'gun') { w.wing *= 1.4; w.ditch *= 1.3; }
    var tot = 0, k; for (k in w) tot += w[k];
    var r = WW.rand() * tot;
    for (k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'spin';
  }

  function bail(p, at) { p.bailAt = at; }
  function startDitch(p) {
    p.deathMode = 'ditch'; p.state = 'ditch'; if (p.hp <= 0) p.hp = p.maxHp * 0.45; p.crew = true; p.roll = 0; // shot down: grey smoke, no flames
  }
  function onShotDown(p) {
    try {
      var fx = WW.fx, mode = pick(p); p.deathMode = mode; p.dT = 0; count[mode === 'bail' ? 'spin' : mode]++;
      if (mode === 'bail') { p.deathMode = 'spin'; bail(p, rr(0.3, 0.8)); return; }
      if (mode === 'spin') { if (R() < 0.4 && p.y > 10) bail(p, rr(0.4, 1.2)); return; }
      if (mode === 'ditch') { p.state = 'ditch'; startDitch(p); p.vy = Math.min(p.vy, -0.5); return; }
      if (mode === 'wing') {
        var m = p.model, side = R() < 0.5 ? -1 : 1, w = side < 0 ? m.wingL : m.wingR;
        var c = Math.cos(p.heading), s = Math.sin(p.heading), sp = p.speed * 0.8;
        var lat = side * 3;                      // outward kick: local +z is world (-sin h, cos h)
        if (P()) P().wing(m, w, c * sp - s * lat, p.vy + 2.5, s * sp + c * lat);
        w.visible = false; p.side = side; p.rollA = p.roll; p.rollRate = side * rr(3.5, 5.5);
        p.spin = side * rr(0.9, 1.4);
        if (fx) { fx.explosion(p.x - s * side * 1.2, p.y, p.z + c * side * 1.2, 0.45); fx.sparks(p.x, p.y, p.z); }
        if (R() < 0.35 && p.y > 12) bail(p, rr(0.6, 1.4));
        return;
      }
      if (mode === 'comet') {
        if (fx) { fx.explosion(p.x, p.y, p.z, 1.2); fx.fire(p.x, p.y, p.z); }
        p.vy = Math.max(p.vy, 0.5); p.speed = Math.max(p.speed, 18); p.spin = (R() - 0.5) * 0.3; p.rollA = p.roll;
        if (R() < 0.12 && p.y > 14) bail(p, rr(0.2, 0.6));
        return;
      }
      if (mode === 'crash') { p.crashTgt = p.crashTgt || shipAhead(p, 400); p.rollA = p.roll; if (!p.crashTgt) p.deathMode = 'comet'; }
    } catch (e) { p.deathMode = null; } // fall back to the stock spin in aircraft.js
  }
  function onDitch(p) {
    try { startDitch(p); p.dT = 0; count.ditch++; } catch (e) { p.deathMode = null; }
  }
  // A plane just became crippled: sometimes the crew bails out and the empty plane goes in (WW.rand: the
  // plane leaves the battle). Returns true when the plane is lost.
  function onCrippled(p) {
    try {
      if (p.y < 14 || WW.rand() >= 0.15) return false;
      p.alive = false; p.state = 'falling'; WW.stats.planesLost++;
      p.deathMode = 'abandon'; p.dT = 0; p.spin = (R() < 0.5 ? -1 : 1) * rr(0.5, 0.9); p.rollA = p.roll; count.abandon++;
      bail(p, 0.25);
      return true;
    } catch (e) { return false; }
  }

  // ---- per-step update of a dying plane ----
  function splashDown(p, size) {
    var fx = WW.fx;
    if (fx) { fx.splash(p.x, p.z, size); fx.explosion(p.x, 0.3, p.z, size * 0.35); }
    p.remove();
  }
  function poseRoll(p, pitch) { var g = p.group; g.rotation.x = p.rollA; if (pitch !== undefined) g.rotation.z = pitch; }

  function updatePlane(p, dt) {
    var fx = WW.fx, mode = p.deathMode;
    p.dT = (p.dT || 0) + dt;
    if (p.bailAt != null && p.dT >= p.bailAt) {
      p.bailAt = null;
      if (P() && p.y > 6) { P().chute(p.x, p.y + 1, p.z); count.chutes++; }
    }
    switch (mode) {
      case 'spin':
        p.vy -= 9 * dt; p.heading += p.spin * dt; p.turn = p.spin * 2; p.speed *= 1 - 0.3 * dt;
        p.trail(dt, true); p.integrate(dt, true);
        if (p.y <= 0) splashDown(p, 1.6);
        return;
      case 'abandon':
        p.vy = Math.max(-14, p.vy - 4 * dt); p.heading += p.spin * dt; p.turn = p.spin * 1.5; p.speed = Math.max(16, p.speed * (1 - 0.1 * dt));
        p.trail(dt, false); p.integrate(dt, true);
        if (p.y <= 0) splashDown(p, 1.5);
        return;
      case 'wing': {
        p.vy = Math.max(-15, p.vy - 7.5 * dt); p.speed *= 1 - 0.35 * dt; p.heading += p.spin * dt; p.turn = 0;
        p.rollA += p.rollRate * dt;
        p.trail(dt, true); p.integrate(dt, true); poseRoll(p);
        p.fT = (p.fT || 0) - dt;
        if (fx && p.fT <= 0) { // fuel burning at the torn wing root
          p.fT = 0.07; var c = Math.cos(p.heading), s = Math.sin(p.heading);
          fx.fire(p.x - s * p.side * 0.8, p.y, p.z + c * p.side * 0.8);
        }
        if (p.y <= 0) splashDown(p, 1.8);
        return;
      }
      case 'comet': {
        p.vy = Math.max(-26, p.vy - 3.4 * dt); p.speed = Math.max(14, p.speed * (1 - 0.06 * dt)); p.heading += p.spin * dt; p.turn = 0;
        p.rollA += 0.7 * dt;
        p.trail(dt, true); cometTail(p, dt); p.integrate(dt, true); poseRoll(p);
        if (p.y <= 0) cometSplash(p);
        return;
      }
      case 'crash': return crash(p, dt);
      case 'ditch': return glide(p, dt);
      case 'ditched': return floatWreck(p, dt);
      case 'slide': return slide(p, dt);
    }
    p.deathMode = null; // unknown: hand back to the stock code
  }

  // A thick black tail with fire at the head, on top of the normal falling trail.
  function cometTail(p, dt) {
    var fx = WW.fx; if (!fx || !fx.trail) return;
    var ld = WW.damage ? WW.damage.load() : 1;
    p.cT = (p.cT || 0) - dt;
    if (WW.damage) WW.damage.want(1 / (0.06 * ld) * 2.6 / 3);
    if (p.cT > 0) return;
    p.cT = 0.06 * ld;
    var c = Math.cos(p.heading), s = Math.sin(p.heading);
    fx.trail(p.x - c * 1.6, p.y + 0.2, p.z - s * 1.6, true, rr(1.4, 1.9), 2.4);
    fx.fire(p.x, p.y, p.z); fx.fire(p.x - c, p.y, p.z - s);
  }
  function cometSplash(p) {
    var fx = WW.fx, c = Math.cos(p.heading), s = Math.sin(p.heading);
    if (fx) {
      fx.splash(p.x, p.z, 3.2); fx.splash(p.x + c * 2.5, p.z + s * 2.5, 2.2);
      fx.explosion(p.x, 0.4, p.z, 1.2); fx.oilSlick(p.x, p.z, 3);
      for (var i = 0; i < 3; i++) fx.smoke(p.x + rr(-1, 1), 0.6, p.z + rr(-1, 1), true, 1.1);
    }
    p.remove();
  }

  function crash(p, dt) {
    var t = p.crashTgt, fx = WW.fx;
    if (!t || !t.alive || t.removed) { p.deathMode = 'comet'; return; }
    var dy0 = deckY(t), d = Math.hypot(t.x - p.x, t.z - p.z), v = Math.max(26, p.speed), tt = d / v;
    var px = t.x + Math.cos(t.heading) * t.speed * tt, pz = t.z + Math.sin(t.heading) * t.speed * tt;
    var dx = px - p.x, dz = pz - p.z, dy = dy0 + 0.3 - p.y, len = Math.hypot(dx, dy, dz) || 1;
    var off = Math.abs(p.turnTo(Math.atan2(dz, dx), dt, 1.8));
    p.speed += (v * Math.hypot(dx, dz) / len - p.speed) * Math.min(1, dt * 2);
    p.vy += ((off < 0.6 ? dy / len * v : -1) - p.vy) * Math.min(1, dt * 2);
    p.rollA += (WW.clamp(p.turn * 0.7, -1.2, 1.2) + Math.sin(p.dT * 6) * 0.2 - p.rollA) * Math.min(1, dt * 3);
    p.trail(dt, true); cometTail(p, dt * 0.5); p.integrate(dt, true); poseRoll(p);
    // hit test in the ship's frame
    var ex = p.x - t.x, ez = p.z - t.z, c = Math.cos(t.heading), s = Math.sin(t.heading);
    var al = ex * c + ez * s, la = -ex * s + ez * c, L = t.stats.length;
    if (Math.abs(al) < L * 0.5 && Math.abs(la) < L * 0.1 + 0.8 && p.y < dy0 + 1.5) {
      var hx = t.x + c * al, hz = t.z + s * al; // on the centre line under the plane
      if (fx) { fx.explosion(p.x, dy0 + 0.5, p.z, 1.8); fx.sparks(p.x, dy0 + 1, p.z); fx.smoke(p.x, dy0 + 1, p.z, true, 1.5); }
      try { t.takeDamage(p.ordnance ? WW.BOMB.dmg * 0.9 : 70, hx, hz, 'bomb'); } catch (e) { /* never throw */ }
      count.shipHits++; p.crashedInto = t;
      p.remove(); return;
    }
    if (p.y <= 0) cometSplash(p);
  }

  // Controlled water landing: steady glide, flare, touch down, then float tail-up.
  function glide(p, dt) {
    var flare = p.y < 2.5;
    p.vy += ((flare ? -0.7 : -2.4) - p.vy) * Math.min(1, dt * 1.5);
    p.speed = Math.max(9, p.speed - 3 * dt); p.turn = 0;
    p.trail(dt, false); p.integrate(dt, true);
    p.group.rotation.z = flare ? 0.12 : Math.atan2(p.vy, Math.max(1, p.speed)) * 0.6;
    if (p.y <= 0.35) {
      if (WW.fx) { WW.fx.splash(p.x, p.z, 1.3); WW.fx.wake(p.x, p.z, p.heading, 1.5); }
      startFloat(p, rr(20, 30), true);
    }
  }
  function startFloat(p, life, raft) {
    p.deathMode = 'ditched'; p.state = 'ditched'; p.fT = 0; p.floatLife = life; p.vy = 0; p.wkT = 0;
    if (raft && P()) { p.raftDelay = rr(1.2, 2.5); p.raftSide = R() < 0.5 ? -1 : 1; p.raftLife = life + rr(4, 10); }
    else p.raftDelay = null;
  }
  function floatWreck(p, dt) {
    var fx = WW.fx, g = p.group, c = Math.cos(p.heading), s = Math.sin(p.heading);
    p.fT += dt;
    if (p.speed > 0) {
      p.speed = Math.max(0, p.speed - 9 * dt);
      p.x += c * p.speed * dt; p.z += s * p.speed * dt;
      p.wkT -= dt; if (fx && p.speed > 2 && p.wkT <= 0) { p.wkT = 0.15; fx.wake(p.x, p.z, p.heading, 0.9); }
    }
    if (p.raftDelay != null && p.fT >= p.raftDelay && P()) {   // crew climbs out beside the wreck
      p.raftDelay = null;
      P().raft(p.x - s * p.raftSide * 2.4, p.z + c * p.raftSide * 2.4, p.raftLife, true);
    }
    var left = p.floatLife - p.fT, sink = left < 6 ? (6 - left) / 6 : 0;
    var settle = Math.min(1, p.fT / 3);
    var pitch = -(0.12 + 0.3 * settle + 0.9 * sink * sink);         // nose under, tail rising
    var y = -0.15 - 0.35 * settle - 3.5 * sink * sink + Math.sin(p.fT * 1.6) * 0.04;
    g.position.set(p.x, y, p.z); g.rotation.y = -p.heading; g.rotation.z = pitch;
    g.rotation.x = Math.sin(p.fT * 1.2) * 0.05 + (p.rollA || 0) * (1 - settle);
    p.y = y;
    if (sink > 0.2 && fx && R() < dt * 4) fx.splash(p.x + c * 1.5, p.z + s * 1.5, 0.25); // air bubbling out
    if (left <= 0) p.remove();
  }

  // ---- deck slide-off (hook for the deck code) ----
  // Tips a plane over the flight-deck edge into the sea. plane: a WW.Plane in WW.world.planes whose x/z is on its
  // carrier's deck. side: +1 starboard, -1 port, omitted = the nearer edge. Returns true when started.
  function slideOff(p, side) {
    try {
      var c = p && p.carrier;
      if (!c || p.removed || (p.deathMode && p.deathMode !== 'ditch')) return false;
      if (p.alive) { p.alive = false; WW.stats.planesLost++; }
      var ex = p.x - c.x, ez = p.z - c.z, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      p.slA = ex * ch + ez * sh; p.slL = WW.clamp(-ex * sh + ez * ch, -DECK_HALF, DECK_HALF);
      p.slSide = side ? Math.sign(side) : (p.slL >= 0 ? 1 : -1);
      p.slV = 0.4; p.slYaw = 0; p.slOn = true; p.rollA = 0; p.dT = 0;
      p.deathMode = 'slide'; p.state = 'slide'; p.speed = 0; p.vy = 0; p.turn = 0; count.slide++;
      return true;
    } catch (e) { return false; }
  }
  function slide(p, dt) {
    var c = p.carrier, g = p.group;
    if (p.slOn) {
      var ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      p.slV += 2.2 * dt; p.slL += p.slSide * p.slV * dt; p.slYaw += p.slSide * 0.25 * dt;
      var over = Math.abs(p.slL) - (DECK_HALF - 0.9);                     // main wheels at the edge: tips over
      p.rollA = over > 0 ? p.slSide * Math.min(1.1, over * 0.9) : 0;
      p.x = c.x + ch * p.slA - sh * p.slL; p.z = c.z + sh * p.slA + ch * p.slL; p.y = deckY(c) + DECK_Y - Math.max(0, over) * 0.5;
      p.heading = c.heading + p.slYaw;
      g.position.set(p.x, p.y, p.z); g.rotation.y = -p.heading; g.rotation.z = 0; g.rotation.x = p.rollA;
      if (Math.abs(p.slL) > DECK_HALF + 0.4) { // off the deck: keep the carrier's speed plus the sideways push
        p.slOn = false;
        p.vx = ch * c.speed - sh * p.slSide * p.slV; p.vz = sh * c.speed + ch * p.slSide * p.slV; p.vy = -0.5;
      }
      return;
    }
    p.vy -= 9.8 * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
    p.rollA += p.slSide * 2.2 * dt;
    g.position.set(p.x, p.y, p.z); g.rotation.x = p.rollA; g.rotation.z = Math.max(-0.6, p.vy * 0.05);
    if (p.y <= 0.2) {
      if (WW.fx) WW.fx.splash(p.x, p.z, 1.6);
      p.speed = Math.hypot(p.vx, p.vz) * 0.3; p.heading = Math.atan2(p.vz, p.vx);
      startFloat(p, rr(9, 14), R() < 0.5);
      p.rollA = p.slSide * 1.6; // floats on its back-ish, settles as it sinks
    }
  }

  // Pooled models come back whole: both wings shown, nothing left hidden.
  function restore(m) {
    if (!m) return;
    [m.wingL, m.wingR].forEach(function (w) { // shown, unfolded, back at the root (deck folds them)
      if (!w) return;
      w.visible = true; w.rotation.set(0, 0, 0);
      if (w.userData.home) w.position.fromArray(w.userData.home);
    });
    if (m.group) { m.group.visible = true; m.group.rotation.x = 0; m.group.rotation.z = 0; }
  }

  // ---- debug: force a death on a plane (tests). mode: spin|bail|wing|comet|ditch|crash|abandon|slide ----
  function force(mode, plane) {
    var ps = WW.world.planes, p = plane;
    if (!p) for (var i = 0; i < ps.length && !p; i++) if (ps[i].alive && (mode === 'slide' || ps[i].y > 15) && ps[i].state !== 'rollout' && ps[i].state !== 'takeoff') p = ps[i];
    if (!p) return null;
    if (mode === 'slide') {
      var c = p.carrier; if (!c || !c.alive) return null;
      var a = -c.stats.length * 0.15, l = 1.2;
      p.x = c.x + Math.cos(c.heading) * a - Math.sin(c.heading) * l; p.z = c.z + Math.sin(c.heading) * a + Math.cos(c.heading) * l;
      return slideOff(p) ? p : null;
    }
    if (mode === 'abandon') { count.abandon++; p.y = Math.max(p.y, 20); p.alive = false; p.state = 'falling'; WW.stats.planesLost++; p.deathMode = 'abandon'; p.dT = 0; p.spin = 0.7; p.rollA = 0; bail(p, 0.25); return p; }
    if (mode === 'crash') {
      var best = null, bd = 1e9;
      WW.world.ships.forEach(function (s) { if (s.alive && !s.submerged && s.nation !== p.nation) { var d = WW.dist(p.x, p.z, s.x, s.z); if (d < bd) { bd = d; best = s; } } });
      if (!best) return null;
      var h = WW.rand() * 6.28; p.x = best.x + Math.cos(h) * 45; p.z = best.z + Math.sin(h) * 45; p.y = 22; p.heading = h + Math.PI;
      p.crashTgt = best;
    }
    if (mode === 'ditch' && p.y > 9) p.y = 9;
    p._force = mode; p.shotDown();
    return p;
  }

  WW.airDeaths = {
    onShotDown: onShotDown, onDitch: onDitch, onCrippled: onCrippled, updatePlane: updatePlane,
    slideOff: slideOff, restore: restore, force: force,
    update: function (dt) { if (P()) P().update(dt); },
    clearAll: function () { if (P()) P().clearAll(); },
    _debug: function () { var o = { counts: count }; if (P()) o.props = P().stats(); return o; }
  };
})();
