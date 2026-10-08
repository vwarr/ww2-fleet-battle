// air_scouts.js - scout floatplanes (WW.scouts). Load after aircraft.js and models_scout.js.
// Each cruiser and battleship carries one floatplane on its catapult (the static one from models_detail.js
// is hidden while it flies). Early in a round the ship catapults it off. The scout flies a search arc on the
// near side of the enemy fleet; every enemy ship within SPOT_R of it gets ship.spottedUntil = now + SPOT_HOLD
// (and ship.spottedBy = nation). combat.js fireShell tightens the dispersion of long-range fire (> 60 units)
// at a spotted target by SPOT_DISP (see combat.js). After SEARCH_T s (or when badly hit) the scout flies
// home, alights on the water beside its ship, taxis alongside and is hoisted back aboard. It can fly again
// after RELAUNCH s (at most MAX_SORTIES per round). A scout is a WW.Plane with kind 'scout' in
// WW.world.planes, so fighters, AA and the camera see it; it is shot down / ditches through the Plane code.
window.WW = window.WW || {};
(function () {
  'use strict';
  var SPOT_R = 85, SPOT_HOLD = 20, SEARCH_T = 130, ALT = 26, ARC_R = 90;   // SEARCH_T covers the ~35 s flight out on the big map
  var RELAUNCH = 50, MAX_SORTIES = 2, CAT_HOLD = 2.4, CAT_SLIDE = 0.35;
  var SCALE_CAT = 0.55, SCALE_FLY = 1.5;   // small on the catapult, arcade size (like carrier planes) in flight
  var SHIPS = { cruiser: 1, battleship: 1 };
  if (WW.PLANE_TYPES && !WW.PLANE_TYPES.scout) WW.PLANE_TYPES.scout = { hp: 16, speed: 22, range: 1000 };
  var pool = {};
  var stats = { launched: 0, recovered: 0, lost: 0, spotted: 0 };

  function getModel(nation) {
    var p = pool[nation], m;
    if (p && p.length) m = p.pop();
    else { m = WW.models.buildScout(nation); m.nation = nation; m.group.rotation.order = 'YZX'; }
    if (WW.scene) WW.scene.add(m.group);
    return m;
  }
  function release(m) { if (m.group.parent) m.group.parent.remove(m.group); (pool[m.nation] = pool[m.nation] || []).push(m); }
  function floatY() { return -(WW.models.SCOUT_FLOAT_Y || -0.86); }
  function inMap(x, z) { return { x: WW.clamp(x, 12, WW.cfg.MAP_W - 12), z: WW.clamp(z, 12, WW.cfg.MAP_H - 12) }; }
  function enemyCentre(nation) {
    var x = 0, z = 0, n = 0;
    for (var i = 0; i < WW.world.ships.length; i++) {
      var s = WW.world.ships[i];
      if (!s.alive || s.nation === nation || s.submerged) continue;
      x += s.x; z += s.z; n++;
    }
    return n ? { x: x / n, z: z / n } : null;
  }

  if (!WW.Plane) { console.error('air_scouts.js must load after aircraft.js'); return; }
  var base = WW.Plane.prototype;
  var OWN = { catapult: 1, transit: 1, 'return': 1, alight: 1, afloat: 1 };

  class Scout extends WW.Plane {
    constructor(ship, m) {
      super('scout', ship.nation, ship, null, m);
      var fp = ship.model && ship.model.floatplane, L = ship.stats.length;
      this.ordnance = false; this.state = 'catapult'; this.t = 0; this.scale = SCALE_CAT;
      this.cat = fp ? { x: fp.position.x, y: fp.position.y, z: fp.position.z, ry: fp.rotation.y } : { x: -L * 0.3, y: 1, z: 0, ry: 0 };
      // the catapult trains outboard (~57 deg off the bow, on the side the plane sits) before it fires
      this.cat.ry0 = this.cat.ry; this.cat.ryL = -(this.cat.z < -0.1 ? -1 : 1) * 1.0;
      if (fp) fp.visible = false;
      this.legs = null; this.leg = 0; this.searchT = 0; this.spotT = 0; this.waterT = 0; this.waveOffs = 0; this.side = 1;
      this.speed = ship.speed; this.vy = 0;
      this.onCatapult(0);
      this.sync(0);
    }
    setScale(s) { this.scale = s; this.group.scale.setScalar(s); }
    // position along the catapult rail (local model coords of the ship), float resting on the rail
    onCatapult(along) {
      var s = this.carrier, c = this.cat, lx = c.x + Math.cos(c.ry) * along, lz = c.z - Math.sin(c.ry) * along;
      var w = s.toWorld(lx, lz);
      this.x = w[0]; this.z = w[1]; this.y = c.y + 0.05 + floatY() * this.scale;
      this.heading = s.heading - c.ry; this.turn = 0; this.vy = 0;
    }
    update(dt) {
      if (!OWN[this.state]) { base.update.call(this, dt); return; }   // falling, ditch, or states other code adds
      this.t += dt;
      var s = this.carrier;
      if (!s.alive || s.sinking) {
        if (this.state === 'catapult' || this.state === 'afloat') { this.remove(); return; }
        this.ditch(); return;
      }
      switch (this.state) {
        case 'catapult': this.catapult(dt); return;
        case 'transit': this.search(dt); break;
        case 'return': this.goHome(dt); break;
        case 'alight': this.alight(dt); break;
        case 'afloat': this.afloat(dt); return;
      }
      if (this.scale < SCALE_FLY) this.setScale(Math.min(SCALE_FLY, this.scale + dt * (SCALE_FLY - SCALE_CAT) / 3));
      this.spot(dt);
      this.trail(dt, false);
      this.integrate(dt, true);
      if (this.y < 1.2 && this.state !== 'alight') { this.y = 1.2; this.vy = Math.max(0, this.vy); }
    }
    catapult(dt) {
      if (this.t < CAT_HOLD) {
        var k0 = WW.clamp((this.t - 0.2) / (CAT_HOLD - 0.4), 0, 1), c = this.cat;
        c.ry = c.ry0 + WW.angleDiff(c.ry0, c.ryL) * k0 * k0 * (3 - 2 * k0);
        this.onCatapult(0); this.speed = this.carrier.speed; this.sync(dt); return;
      }
      var k = Math.min(1, (this.t - CAT_HOLD) / CAT_SLIDE), len = 1.8;
      if (!this.fired) {
        this.fired = true;
        var fx = WW.fx; if (fx) fx.smoke(this.x, this.y, this.z, false, 0.5);   // cordite puff of the catapult charge
      }
      this.onCatapult(len * k * k);
      if (k >= 1) {
        this.state = 'transit'; this.speed = this.carrier.speed + 18; this.vy = 1.5;
        stats.launched++;
      }
      if (this.prop) this.prop.rotation.x += dt * 45;
      this.sync(dt);
    }
    plan() {
      var E = enemyCentre(this.nation), s = this.carrier;
      if (!E) { this.legs = []; return; }
      var b = Math.atan2(s.z - E.z, s.x - E.x), dir = WW.rand() < 0.5 ? 1 : -1;
      this.legs = [-90, -30, 30, 90].map(function (a) {
        var t = b + dir * a * Math.PI / 180;
        return inMap(E.x + Math.cos(t) * ARC_R, E.z + Math.sin(t) * ARC_R);
      });
      this.leg = 0;
    }
    search(dt) {
      this.searchT += dt;
      if (!this.legs) this.plan();
      if (this.searchT > SEARCH_T || this.hp < this.maxHp * 0.5 || this.fuel <= 0 || !this.legs.length) { this.state = 'return'; return; }
      this.fuel -= dt;
      var w = this.legs[this.leg];
      this.fly(w.x, w.z, ALT, dt, this.pt.speed, 0.8);
      if (WW.dist(this.x, this.z, w.x, w.z) < 12) {
        this.leg++;
        if (this.leg >= this.legs.length) { this.legs = null; }   // sweep done: re-plan around where the fleet is now
      }
    }
    spot(dt) {
      this.spotT -= dt;
      if (this.spotT > 0 || this.state === 'catapult') return;
      this.spotT = 0.5;
      var now = WW.time.now;
      for (var i = 0; i < WW.world.ships.length; i++) {
        var o = WW.world.ships[i];
        if (!o.alive || o.nation === this.nation || o.submerged) continue;
        if (WW.dist2(this.x, this.z, o.x, o.z) < SPOT_R * SPOT_R) {
          if (!(o.spottedUntil > now)) stats.spotted++;
          o.spottedUntil = now + SPOT_HOLD; o.spottedBy = this.nation;
        }
      }
    }
    // water side of the ship to alight on, and the approach / touchdown points beside it
    homePoints() {
      var s = this.carrier, L = s.stats.length;
      if (!this.sideSet) {
        var a = s.toWorld(0, 8), b = s.toWorld(0, -8);
        this.side = WW.terrain.depthAt(a[0], a[1]) >= WW.terrain.depthAt(b[0], b[1]) ? 1 : -1; this.sideSet = true;
      }
      var ap = s.toWorld(-L * 0.5 - 34, this.side * 8), td = s.toWorld(L * 0.15, this.side * 7);
      return { ax: ap[0], az: ap[1], tx: td[0], tz: td[1] };
    }
    goHome(dt) {
      var h = this.homePoints(), d = WW.dist(this.x, this.z, h.ax, h.az);
      this.fly(h.ax, h.az, d > 60 ? ALT : 9, dt, this.pt.speed, 0.9);
      if (d < 10) this.state = 'alight';
    }
    alight(dt) {
      var s = this.carrier, h = this.homePoints(), d = WW.dist(this.x, this.z, h.tx, h.tz), yw = floatY() * this.scale;
      var b = Math.atan2(h.tz - this.z, h.tx - this.x);
      if (d < 6 && this.y > yw + 1.5 && this.waveOffs < 2) { this.waveOffs++; this.state = 'return'; this.vy = 2; return; }
      this.turnTo(d < 8 ? s.heading : b, dt, 1.0);
      var ty = yw + Math.max(0, d - 14) * 0.22;
      this.vy = WW.clamp((ty - this.y) * 1.6, -3.5, 2);
      this.speed = Math.max(s.speed + 3, Math.min(this.pt.speed, s.speed + 3 + d * 0.35));
      if (this.y <= yw + 0.08 || d < 3) {
        this.state = 'afloat'; this.waterT = 0; this.y = yw; this.vy = 0;
        if (WW.fx) WW.fx.splash(this.x, this.z, 0.7);
      }
    }
    afloat(dt) {
      var s = this.carrier, h = this.homePoints(), yw = floatY() * this.scale, d = WW.dist(this.x, this.z, h.tx, h.tz);
      this.waterT += dt;
      this.turnTo(d > 2 ? Math.atan2(h.tz - this.z, h.tx - this.x) : s.heading, dt, 0.8);
      this.speed += WW.clamp(s.speed + WW.clamp(d * 0.5, -2, 3) - this.speed, -6 * dt, 6 * dt);
      this.vy = 0;
      this.x += Math.cos(this.heading) * this.speed * dt; this.z += Math.sin(this.heading) * this.speed * dt;
      this.y = yw + Math.sin(this.t * 2.1) * 0.03;   // bobbing
      if (this.speed > 1.5 && Math.random() < dt * 3 && WW.fx) WW.fx.wake(this.x, this.z, this.heading, 0.25);   // visual only
      this.sync(dt);
      if (this.waterT > 3.5 || WW.terrain.depthAt(this.x, this.z) < 0.5) this.recover();
    }
    recover() {
      var fp = this.carrier.model && this.carrier.model.floatplane;
      if (fp) fp.visible = true;
      this.recovered = true; stats.recovered++; WW.stats.planesLanded++;
      this.remove();
    }
    shotDown() { stats.lost++; base.shotDown.call(this); }
    remove() {
      if (this.removed) return;
      this.removed = true; this.alive = false;
      var sc = this.carrier && this.carrier._scout;
      if (sc && sc.plane === this) { sc.plane = null; sc.nextT = (WW.game ? WW.game.roundTime : 0) + RELAUNCH; if (!this.recovered) sc.sorties = MAX_SORTIES; }
      release(this.model);
    }
  }

  function launch(ship) {
    if (!WW.models.buildScout || !ship.alive || ship.sinking) return null;
    var p = new Scout(ship, getModel(ship.nation));
    WW.world.planes.push(p);
    WW.stats.planesLaunched++;
    return p;
  }
  function schedule() {
    var g = WW.game;
    if (!g || g.state !== 'battle') return;
    for (var i = 0; i < WW.world.ships.length; i++) {
      var s = WW.world.ships[i];
      if (!SHIPS[s.type] || !s.alive || s.sinking) continue;
      var sc = s._scout || (s._scout = { sorties: 0, nextT: WW.randRange(5, 25), plane: null });
      if (sc.plane || sc.sorties >= MAX_SORTIES || g.roundTime < sc.nextT) continue;
      if (!enemyCentre(s.nation) || g.roundTime > WW.cfg.ROUND_TIMEOUT - SEARCH_T) { sc.sorties = MAX_SORTIES; continue; }
      sc.plane = launch(s); sc.sorties++;
    }
  }

  var ou = WW.air.update;
  WW.air.update = function (dt) {
    var r = ou.apply(this, arguments);
    try { schedule(); } catch (e) { console.error('scouts', e); }
    return r;
  };

  // camera hook (camera.js candidates(): WW.camHooks): catapult launches and alightings
  (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
    var arr = WW.world.planes;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (p.kind !== 'scout' || !p.alive) continue;
      if (p.state === 'catapult' && p.t > 0.3) add(6, 'flyby', p.carrier, { dur: dur(12, 15) });
      else if (p.state === 'transit' && p.t < CAT_HOLD + 6) add(5.5, 'chase', p, { dur: dur(10, 13) });
      else if (p.state === 'alight') add(4.5, 'chase', p, { dur: dur(10, 12) });
    }
  });

  WW.Scout = Scout;
  WW.scouts = { SPOT_R: SPOT_R, SPOT_HOLD: SPOT_HOLD, stats: stats, launch: launch,
    isSpotted: function (ship) { return !!ship && ship.spottedUntil > WW.time.now; } };
})();
