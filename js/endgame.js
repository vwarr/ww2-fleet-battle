// endgame.js - WW.endgame: the sim bookkeeping of a battle's end (WW.rand only; no visuals). Load after air_deaths.js.
//  - Escape: a ship of a broken side that ai_endgame.js sends home (ship.escapeEdge) and that reaches its home map
//    edge leaves the map: removed from the battle, counted as escaped ('shipEscaped'). main.js ends the round as a
//    retire when a broken side has escaped ships and none left afloat.
//  - Rescue (doctrine.rescue, USN): every own ship that sinks leaves survivors at its sinking position, and a ditched
//    or abandoned plane its crew; a nearby destroyer that is not in a gun fight is assigned (ship.rescue), steams
//    there, slows alongside for PICKUP_T s and recovers them ('rescue'). Unreached survivors are lost after a while.
//  - Scuttle (doctrine.scuttle, IJN): once broken, a slowed cripple with a faster enemy gun ship in range may be
//    scuttled by her crew ('shipScuttled'); the cripples the side leaves behind when it breaks are "abandoned".
//  - Stats per round (WW.endgame.stats), reset on roundStart.
window.WW = window.WW || {};
(function () {
  'use strict';
  var EXIT = 7;                                   // units from the home edge: off the map
  var RESCUE_R = 320, PILOT_R = 220;              // a rescuer is sent from this far (ship survivors / aircrew)
  var WAIT_T = 60, RESCUE_AGE = 150;              // unassigned survivors are lost after WAIT_T s, any after RESCUE_AGE s
  var PICKUP_D = 10, PICKUP_V = 1.6, PICKUP_T = 10; // alongside (aircrew; a hull's survivors: + half its length + 4, clear of the wreck), nearly stopped, this long
  var SAFE_DPS = 8;                               // known enemy fire at the survivors' position a rescuer accepts (not broken)
  var BOATS = { carrier: 4, battleship: 3, cruiser: 2, destroyer: 1, submarine: 0, pt: 1 }, PER_BOAT = 12; // lifeboats.js boats
  var CREW = { fighter: 1, dive: 2, torpedo: 3, scout: 2 };
  var SCUT_T = 4, SCUT_P = 0.25;                  // scuttle check interval, chance per check
  var NATIONS = ['USN', 'IJN'];
  var MAJOR = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 };
  var tasks = [], nextId = 1, tick = 0, scutT = 0, broke = {}, stats = null, last = {};

  function per() { return { USN: 0, IJN: 0 }; }
  function reset() {
    tasks.length = 0; nextId = 1; tick = 0; scutT = 0; broke = {}; last = {};
    stats = { escaped: per(), sunk: per(), scuttled: per(), abandoned: per(), rescues: per(), survivors: per(), lost: per(),
      pilots: per(), pursuitKills: per() };
    WW.endgame.stats = stats;
  }
  function side(n) { return WW.fleetCmd ? WW.fleetCmd.side(n) : null; }
  function doctrine(n) { var d = WW.fleetCmd && WW.fleetCmd.doctrine(n); return d || {}; }
  function broken(n) { var B = side(n); return !!(B && B.brokenAt && B.posture === 'withdraw'); }
  function homeX(n) { return n === 'USN' ? 0 : WW.cfg.MAP_W; }
  function battle() { return WW.game && WW.game.state === 'battle'; }

  // A destroyer in a gun fight: a fresh (3 s) enemy gun ship inside its main battery's range + 20.
  function engaged(ship) {
    if (!WW.intel) return false;
    var g = ship.stats.guns[0], R = (g ? g.range : 60) + 20, cs = WW.intel.enemyShips(ship.nation, { fresh: true });
    for (var i = 0; i < cs.length; i++) { var u = cs[i].unit; if (u && u.alive && !u.submerged && u.stats.guns.length && WW.dist2(ship.x, ship.z, cs[i].x, cs[i].z) < R * R) return true; }
    return false;
  }
  function addTask(nation, x, z, n, kind, len) {
    if (!n || !doctrine(nation).rescue || !battle() || (WW.game && WW.game.noRetire)) return;
    if (WW.terrain && WW.terrain.depthAt(x, z) < 0.5) return; // ashore / on the beach: they walk home
    tasks.push({ id: nextId++, nation: nation, x: x, z: z, n: n, kind: kind, r: PICKUP_D + (len ? len * 0.5 + 4 : 0), t0: WW.time.now, by: null, pick: 0, done: false });
  }
  function release(t) { if (t.by && t.by.rescue === t) t.by.rescue = null; t.by = null; t.pick = 0; }
  function canRescue(s, t, br) {
    if (!s.alive || s.sinking || s.nation !== t.nation || s.type !== 'destroyer' || s.rescue || s.escaped) return false;
    if (s.hp < 0.25 * s.maxHp || (s.ai && (s.ai.dcLeft > 0 || s.ai.dcSub))) return false;
    if (WW.dist2(s.x, s.z, t.x, t.z) > Math.pow(t.kind === 'pilot' ? PILOT_R : RESCUE_R, 2)) return false;
    if (br) return true;   // broken: picking up survivors comes first
    return !engaged(s) && !(WW.threat && WW.threat.danger(s.nation, t.x, t.z) > SAFE_DPS);
  }
  function assign(now) {
    var ships = WW.world.ships;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i]; if (t.done) continue;
      var br = broken(t.nation);
      if (t.by && (!t.by.alive || t.by.escaped || t.by.rescue !== t || (!br && engaged(t.by)))) release(t); // called away to fight
      var age = now - t.t0;
      if ((!t.by && age > WAIT_T) || age > RESCUE_AGE) { t.done = true; stats.lost[t.nation] += t.n; release(t); continue; }
      if (t.by) continue;
      var best = null, bd = 1e18;
      for (var k = 0; k < ships.length; k++) {
        var s = ships[k]; if (!canRescue(s, t, br)) continue;
        var d = WW.dist2(s.x, s.z, t.x, t.z); if (d < bd) { bd = d; best = s; }
      }
      if (best) { t.by = best; best.rescue = t; t.pick = 0; }
    }
    for (var j = tasks.length - 1; j >= 0; j--) if (tasks[j].done && now - tasks[j].t0 > RESCUE_AGE + 30) tasks.splice(j, 1);
  }
  // The rescuer alongside and nearly stopped: survivors come aboard.
  function pickup(dt) {
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], s = t.by; if (t.done || !s) continue;
      if (WW.dist2(s.x, s.z, t.x, t.z) < t.r * t.r && s.speed < PICKUP_V) t.pick += dt;
      if (t.pick < PICKUP_T) continue;
      t.done = true; stats.rescues[t.nation]++; stats.survivors[t.nation] += t.n; if (t.kind === 'pilot') stats.pilots[t.nation] += t.n;
      release(t);
      WW.emit('rescue', { ship: s, x: t.x, z: t.z, n: t.n, kind: t.kind });
    }
  }
  function escape(s) {
    s.escaped = true; stats.escaped[s.nation]++; if (MAJOR[s.type]) last[s.nation] = 'escaped';
    for (var i = 0; i < tasks.length; i++) if (tasks[i].by === s) release(tasks[i]);
    WW.emit('shipEscaped', s);
    var P = WW.world.planes; // its planes still up (CAP, a scout) go with it: they land on it past the edge
    for (var k = 0; k < P.length; k++) if (P[k].carrier === s && P[k].alive && P[k].remove) P[k].remove();
    s.remove();
  }
  // Doctrine scuttle: a cripple of a broken side, slowed, with a faster known enemy gun ship within reach.
  function scuttleCheck() {
    var ships = WW.world.ships, I = WW.intel, now = WW.time.now, crip = WW.fleetGroups.CRIP, V = WW.shipSpeed;
    if (!I || !V) return;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.sinking || s.type === 'submarine' || s.type === 'pt' || !doctrine(s.nation).scuttle || !broken(s.nation)) continue;
      if (s.hp >= crip * s.maxHp || s.speedK > 0.75) continue;
      var cs = I.enemyShips(s.nation), hunted = false, v = V.vmax(s);
      for (var k = 0; k < cs.length && !hunted; k++) {
        var u = cs[k].unit, g = u && u.stats.guns[0];
        if (!u || !u.alive || u.submerged || !g || u.type === 'carrier' || now - cs[k].seenAt > 10) continue;
        hunted = V.vmax(u) > v && WW.dist(s.x, s.z, cs[k].x, cs[k].z) < g.range * 1.3;
      }
      if (!hunted || WW.rand() >= SCUT_P) continue;
      s.scuttled = true; stats.scuttled[s.nation]++;
      WW.emit('shipScuttled', s);
      s.hp = 0; s.startSinking();
    }
  }
  // The cripples a side without the rescue doctrine leaves behind when it breaks.
  function breakCheck() {
    for (var i = 0; i < NATIONS.length; i++) {
      var n = NATIONS[i]; if (broke[n] || !broken(n)) continue;
      broke[n] = true;
      if (doctrine(n).rescue) continue;
      var ships = WW.world.ships, crip = WW.fleetGroups.CRIP;
      for (var k = 0; k < ships.length; k++) {
        var s = ships[k];
        if (s.alive && !s.sinking && s.nation === n && s.type !== 'submarine' && s.type !== 'pt' && (s.hp < crip * s.maxHp || s.speedK < 0.7)) { s.abandoned = true; stats.abandoned[n]++; }
      }
    }
  }

  function update(dt) {
    if (!battle()) return;
    var now = WW.time.now, W = WW.cfg.MAP_W, ships = WW.world.ships;
    if (!(WW.game && WW.game.noRetire)) for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.sinking || !s.escapeEdge) continue;
      if (s.escapeEdge < 0 ? s.x <= EXIT : s.x >= W - EXIT) escape(s);
    }
    pickup(dt);
    tick -= dt;
    if (tick <= 0) { tick = 1; try { breakCheck(); assign(now); } catch (e) { console.error('endgame', e); } }
    scutT -= dt;
    if (scutT <= 0) { scutT = SCUT_T; try { scuttleCheck(); } catch (e) { console.error('endgame scuttle', e); } }
  }

  WW.on('shipSunk', function (s) {
    if (!stats || !s || !battle()) return;
    stats.sunk[s.nation]++; if (MAJOR[s.type]) last[s.nation] = 'sunk';
    var foe = side(WW.enemyOf(s.nation));
    if (foe && foe.posture === 'pursue') stats.pursuitKills[foe.nation]++;
    addTask(s.nation, s.x, s.z, (BOATS[s.type] || 0) * PER_BOAT, 'ship', s.stats.length);
  });
  // Aircrew in the water: a ditched plane, or one the crew abandoned (air_deaths.js picks the mode with WW.rand).
  function hookPlanes() {
    var P = WW.Plane && WW.Plane.prototype; if (!P) return;
    ['shotDown', 'ditch'].forEach(function (nm) {
      var orig = P[nm];
      P[nm] = function () {
        var was = this.alive, r = orig.apply(this, arguments);
        try { if (was && !this.alive && (this.deathMode === 'ditch' || this.deathMode === 'abandon')) addTask(this.nation, this.x, this.z, CREW[this.kind] || 1, 'pilot'); } catch (e) { /* never into the air code */ }
        return r;
      };
    });
  }
  hookPlanes();
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);

  WW.endgame = {
    update: update, stats: null, EXIT: EXIT,
    broken: broken, homeX: homeX, engaged: engaged,
    // how the side's last major ship (CV / BB / CA / DD) left the battle: 'sunk' | 'escaped' | undefined (main.js)
    lastOut: function (n) { return last[n]; },
    tasks: function () { return tasks; },
    // open survivor pickups of a side: assigned ones, and fresh ones still waiting for a rescuer
    pending: function (n) { var c = 0, now = WW.time.now; for (var i = 0; i < tasks.length; i++) { var t = tasks[i]; if (!t.done && t.nation === n && (t.by || now - t.t0 < 20)) c++; } return c; },
    // visual helper (lifeboats.js): the rescuer of open survivors within r of (x, z), or null. Reads the sim only.
    rescuerNear: function (n, x, z, r) {
      for (var i = 0; i < tasks.length; i++) { var t = tasks[i]; if (!t.done && t.by && t.nation === n && t.by.alive && WW.dist2(t.x, t.z, x, z) < r * r) return t.by; }
      return null;
    }
  };
  reset();
})();
