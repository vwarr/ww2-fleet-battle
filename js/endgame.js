// endgame.js - WW.endgame: the sim bookkeeping of a battle's end (WW.rand only; no visuals). Load after air_deaths.js.
//  - Escape: a ship of a broken side that ai_endgame.js sends home (ship.escapeEdge) and that reaches its home map
//    edge leaves the map: removed from the battle, counted as escaped ('shipEscaped'). main.js ends the round as a
//    retire when a broken side has escaped ships and none left afloat.
//  - Rescue (doctrine.rescue, USN): every own ship that sinks leaves survivors at its sinking position, and a ditched
//    or abandoned plane its crew; a nearby destroyer that is not in a gun fight is assigned (ship.rescue), steams
//    there, slows alongside for PICKUP_T s and recovers them ('rescue'). Unreached survivors are lost after a while.
//  - Scuttle (doctrine.scuttle, IJN): once broken, a slowed cripple with a faster enemy gun ship in range may be
//    scuttled by her crew ('shipScuttled'); the cripples the side leaves behind when it breaks are "abandoned".
//  - Hulks (either navy): a ship below HULK_HP that the enemy has not hit for HULK_QUIET s, HULK_T s after she was
//    wrecked, is given up: the nearest own destroyer with torpedoes (not in a gun fight) closes to TORP_D and sends her
//    down with a torpedo (ship.scuttle, ai_endgame.js steers; the USN scuttled Lexington, Hornet, Yorktown's
//    screen tried; the IJN Hiryu, Akagi). Unless one is already on the way, flooding finishes her FOUNDER_T s after
//    she was wrecked (FOUNDER_HP of her hp a second; a wrecked PT boat too): no hulk drifts on to the time limit.
//  - Stats per round (WW.endgame.stats), reset on roundStart.
window.WW = window.WW || {};
(function () {
  'use strict';
  var EXIT = 20;                                  // units from the home edge: off the map (a corner can pin a big hull short of the line)
  var ESC_PLANE_R = 200;                          // an escaping carrier's planes this close land on her past the edge
  var RESCUE_R = 320, PILOT_R = 220;              // a rescuer is sent from this far (ship survivors / aircrew)
  var WAIT_T = 150, RESCUE_AGE = 240;            // unassigned survivors are lost after WAIT_T s, any after RESCUE_AGE s
  var PICKUP_D = 10, PICKUP_V = 1.6, PICKUP_T = 10; // alongside (aircrew; a hull's survivors: + half its length + 4, clear of the wreck), nearly stopped, this long
  var SAFE_DPS = 12;                              // known enemy fire at the survivors' position a rescuer accepts (not broken)
  var BOATS = { carrier: 4, battleship: 3, cruiser: 2, destroyer: 1, submarine: 0, pt: 1 }, PER_BOAT = 12; // lifeboats.js boats
  var CREW = { fighter: 1, dive: 2, torpedo: 3, scout: 2, flyingboat: 8 };
  var SCUT_T = 4, SCUT_P = 0.08, SCUT_HP = 0.25, SCUT_K = 0.6, SCUT_GRACE = 30, SCUT_FAST = 1.3; // check interval, chance per check,
                                                  // hp share and speedK below which, s after the break, pursuer speed ratio
  var HULK_HP = 0.15, HULK_T = 20, HULK_QUIET = 12, SCUT_R = 340, TORP_D = 45, TORP_CD = 20, FOUNDER_T = 35, FOUNDER_HP = 0.012;
  var NATIONS = ['USN', 'IJN'];
  var MAJOR = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 };
  var tasks = [], nextId = 1, tick = 0, scutT = 0, broke = {}, stats = null, last = {};

  function per() { return { USN: 0, IJN: 0 }; }
  function reset() {
    tasks.length = 0; nextId = 1; tick = 0; scutT = 0; broke = {}; last = {}; watchReset();
    stats = { escaped: per(), sunk: per(), scuttled: per(), abandoned: per(), rescues: per(), survivors: per(), lost: per(),
      pilots: per(), pursuitKills: per(), escTypes: {}, lastEsc: null, brokenAt: per(), scuttledHulks: per(), foundered: per() };
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
    if (s.hp < WW.fleetGroups.CRIP * s.maxHp || (s.ai && (s.ai.dcLeft > 0 || s.ai.dcSub))) return false; // a cripple runs home
    if (WW.dist2(s.x, s.z, t.x, t.z) > Math.pow(t.kind === 'pilot' ? PILOT_R : RESCUE_R, 2)) return false;
    if (br) return true;   // broken: picking up survivors comes first
    if (t.kind === 'pilot' && !lull(s.nation, t)) return false; // F27: a destroyer is not sent off station for an airman mid-battle
    return !engaged(s) && !(WW.threat && WW.threat.danger(s.nation, t.x, t.z) > SAFE_DPS);
  }
  // a lull for an aircrew pickup: the side is not engaging, pressing or pursuing, and no enemy bomber is within
  // PILOT_AIR of the men in the water (the rest wait for a Catalina, air_flyingboats.js, or the end of the action)
  var PILOT_AIR = 400, BUSY = { engage: 1, press: 1, pursue: 1 };
  function lull(n, t) {
    var B = side(n); if (B && BUSY[B.posture]) return false;
    var P = WW.world.planes;
    for (var i = 0; i < P.length; i++) { var p = P[i]; if (p.alive && p.nation !== n && (p.kind === 'dive' || p.kind === 'torpedo') && WW.dist2(p.x, p.z, t.x, t.z) < PILOT_AIR * PILOT_AIR) return false; }
    return true;
  }
  function assign(now) {
    var ships = WW.world.ships;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i]; if (t.done) continue;
      if (t.air) { if (t.air.alive && !t.air.removed) continue; t.air = null; } // a Catalina is on it (air_flyingboats.js): no destroyer, no expiry
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
  // Survivors picked up by a rescuer that is not a destroyer (a Catalina, air_flyingboats.js): as pickup() does.
  function complete(t, by) {
    if (t.done) return;
    t.done = true; stats.rescues[t.nation]++; stats.survivors[t.nation] += t.n; if (t.kind === 'pilot') stats.pilots[t.nation] += t.n;
    if (t.air === by) t.air = null;
    release(t);
    WW.emit('rescue', { ship: null, air: by, x: t.x, z: t.z, n: t.n, kind: t.kind });
  }
  function escape(s) {
    s.escaped = true; stats.escaped[s.nation]++; if (MAJOR[s.type]) last[s.nation] = 'escaped';
    var et = s.nation + ':' + s.type; stats.escTypes[et] = (stats.escTypes[et] || 0) + 1;
    stats.lastEsc = { type: s.type, nation: s.nation, t: +WW.game.roundTime.toFixed(0), hp: +(s.hp / s.maxHp).toFixed(2) };
    for (var i = 0; i < tasks.length; i++) if (tasks[i].by === s) release(tasks[i]);
    WW.emit('shipEscaped', s);
    // its planes still up: another own deck takes them (they divert there); else those near her land on her past the
    // edge, and the rest ditch (a destroyer may pick the crews up) rather than vanish in mid-air
    var P = WW.world.planes, alt = null, ad = 1e18;
    for (var j = 0; j < WW.world.ships.length; j++) { var c = WW.world.ships[j]; if (c !== s && c.alive && !c.sinking && !c.escaped && c.type === 'carrier' && c.hangar && c.nation === s.nation) { var q = WW.dist2(c.x, c.z, s.x, s.z); if (q < ad) { ad = q; alt = c; } } }
    for (var k = 0; k < P.length; k++) {
      var pl = P[k]; if (pl.carrier !== s || !pl.alive) continue;
      if (alt) { var D = s._deck; if (D && D.lq) { var ix = D.lq.indexOf(pl); if (ix >= 0) D.lq.splice(ix, 1); } pl.carrier = alt; if (pl.state === 'landing') { pl.state = 'return'; pl.deckPh = null; } }
      else if (WW.dist2(pl.x, pl.z, s.x, s.z) < ESC_PLANE_R * ESC_PLANE_R) { if (pl.remove) pl.remove(); }
      else if (pl.ditch) pl.ditch();
    }
    s.remove();
  }
  // Doctrine scuttle: a cripple of a broken side, slowed, with a faster known enemy gun ship within reach.
  function scuttleCheck() {
    var ships = WW.world.ships, I = WW.intel, now = WW.time.now, V = WW.shipSpeed;
    if (!I || !V) return;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.sinking || s.type === 'submarine' || s.type === 'pt' || !doctrine(s.nation).scuttle || !broken(s.nation)) continue;
      if (now - side(s.nation).brokenAt < SCUT_GRACE || s.hp >= SCUT_HP * s.maxHp || s.speedK > SCUT_K) continue; // the crew tries to run first
      var cs = I.enemyShips(s.nation), hunted = false, v = V.vmax(s);
      for (var k = 0; k < cs.length && !hunted; k++) {
        var u = cs[k].unit, g = u && u.stats.guns[0];
        if (!u || !u.alive || u.submerged || !g || u.type === 'carrier' || now - cs[k].seenAt > 5) continue;
        hunted = V.vmax(u) > v * SCUT_FAST && WW.dist(s.x, s.z, cs[k].x, cs[k].z) < g.range;  // a faster hunter already in gun range
      }
      if (!hunted || WW.rand() >= SCUT_P) continue;
      s.scuttled = true; stats.scuttled[s.nation]++;
      WW.emit('shipScuttled', s);
      s.hp = 0; s.startSinking();
    }
  }
  // Hulks: give up a wreck the enemy has left alone (see HULK_HP). Runs every second.
  function hulkCheck(now) {
    var ships = WW.world.ships, i, s;
    for (i = 0; i < ships.length; i++) {
      s = ships[i];
      if (s.scuttle && (!s.alive || s.escaped || !s.scuttle.alive || s.scuttle.sinking || engaged(s))) { s.scuttle.scuttleBy = null; s.scuttle = null; } // done, or called away to fight
      if (!s.alive || s.sinking || s.isBase || s.type === 'submarine') continue;
      if (s.hp >= HULK_HP * s.maxHp) { s.hulkAt = 0; continue; }
      if (!s.hulkAt) s.hulkAt = now;
      var sb = s.scuttleBy, onWay = sb && sb.alive && sb.scuttle === s && WW.dist2(sb.x, sb.z, s.x, s.z) < 120 * 120;
      if (now - s.hulkAt > FOUNDER_T && !onWay) s.founder = true;
      if (s.type === 'pt') continue;
      if (now - s.hulkAt < HULK_T || now - (s.egHitT || 0) < HULK_QUIET) continue; // the enemy may still finish her
      var by = s.scuttleBy;
      if (!by || !by.alive || by.scuttle !== s) { s.scuttleBy = by = scuttler(s); if (by) by.scuttle = s; }
    }
  }
  function scuttler(h) {
    var best = null, bd = SCUT_R * SCUT_R, ships = WW.world.ships;
    for (var k = 0; k < ships.length; k++) {
      var d = ships[k];
      if (!d.alive || d.sinking || d.escaped || d.nation !== h.nation || d.type !== 'destroyer' || !d.stats.torpedoes || d.scuttle || d.rescue) continue;
      if (d.hp < WW.fleetGroups.CRIP * d.maxHp || (WW.supply && WW.supply.torpLeft && !WW.supply.torpLeft(d)) || engaged(d)) continue;
      var q = WW.dist2(d.x, d.z, h.x, h.z); if (q < bd) { bd = q; best = d; }
    }
    return best;
  }
  // every step: a scuttler alongside fires; a foundering hulk settles
  function hulks(dt) {
    var ships = WW.world.ships, now = WW.time.now;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (s.founder && s.alive && !s.sinking) { s.hp -= FOUNDER_HP * s.maxHp * dt; if (s.hp <= 0) { s.hp = 0; stats.foundered[s.nation]++; s.startSinking(); } continue; }
      var h = s.scuttle; if (!h || !s.alive || now - (s.scutFired || -1e9) < TORP_CD) continue;
      var d = WW.dist(s.x, s.z, h.x, h.z); if (d > TORP_D + 8 || !WW.combat || !WW.combat.fireTorpedo) continue;
      var p = WW.combat.fireTorpedo(s, s.x, s.z, Math.atan2(h.z - s.z, h.x - s.x), s.nation, Math.max(4, d - 2));
      s.scutFired = now; if (s.ai) s.ai.torpReload = Math.max(s.ai.torpReload || 0, s.stats.torpedoes.reload);
      if (p) p.scuttleOf = h;
    }
  }
  // The scuttling torpedo reaches the hull (own torpedoes pass own ships: it runs out at her side).
  WW.on('weaponImpact', function (e) {
    var h = e && e.proj && e.proj.scuttleOf; if (!h || !stats) return;
    e.proj.scuttleOf = null;
    if (!h.alive || h.sinking) return;
    var a = Math.atan2(h.z - e.z, h.x - e.x);
    if (WW.fx && WW.fx.torpedoHit) WW.fx.torpedoHit(e.x, e.z, -Math.cos(a), -Math.sin(a), WW.clamp(h.stats.length / 16, 0.9, 1.6)); // visual only
    WW.emit('shipBoom', { ship: h, x: e.x, y: 1, z: e.z, size: 1.2 });
    h.scuttled = true; stats.scuttled[h.nation]++; stats.scuttledHulks[h.nation]++;
    WW.emit('shipScuttled', h);
    h.hp = 0; h.startSinking();
  });
  WW.on('shipHit', function (e) { if (e && e.ship && e.amount > 0) e.ship.egHitT = WW.time.now; });
  // The cripples a side without the rescue doctrine leaves behind when it breaks.
  function breakCheck() {
    for (var i = 0; i < NATIONS.length; i++) {
      var n = NATIONS[i]; if (broke[n] || !broken(n)) continue;
      broke[n] = true; stats.brokenAt[n] = +WW.game.roundTime.toFixed(0);
      if (doctrine(n).rescue) continue;
      var ships = WW.world.ships, crip = WW.fleetGroups.CRIP;
      for (var k = 0; k < ships.length; k++) {
        var s = ships[k];
        if (s.alive && !s.sinking && s.nation === n && s.type !== 'submarine' && s.type !== 'pt' && (s.hp < crip * s.maxHp || s.speedK < 0.7)) { s.abandoned = true; stats.abandoned[n]++; }
      }
    }
  }

  // ---- round watch (main.js reads it to end a round that has nothing left in it) ----
  //  - pursuit closing: an enemy fit gun ship outside its gun range of a broken side's ship, closing at more than
  //    CLOSE_V u/s (an equal-speed stern chase only jitters round 0), that will have her in range within BITE_T s (in the
  //    last CLOSE_T s): the pursuit is about to bite,
  //    the broken side has not got clear yet (a stern chase that gains a knot an hour is no battle)
  //  - subs closing: a submarines-only side got nearer to the enemy (main.js's stall clock waits while it does)
  //  - night out: dark with no flying for NIGHT_AHEAD s, and neither side has business in the dark: a ship to fight a
  //    night action with (a fit gun ship, a PT boat with torpedoes left) and an enemy fleet ship (carrier, battleship,
  //    cruiser, destroyer) to fight it against (a battleship does not hunt spent PT boats in the dark): both retire for
  //    the night after NIGHT_T s
  //  - lull out: a round with a raid force (a side that never had a gun ship: PT boats, carriers alone, submarines)
  //    cannot end by a break; once it has struck, LULL_T s with no further attack (main.js game.lastHit:
  //    a hit or a weapon dropped or fired) and no armed bomber in the air on its way end it: the raid is over
  var LULL_T = 60, OUTB = { transit: 1, inbound: 1, attack: 1 };
  var WATCH_T = 5, BITE_T = 25, CLOSE_V = 0.6, CLOSE_T = 12, CLOSE_D = 4, NIGHT_AHEAD = 150, NIGHT_T = 20;
  var GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, FLEET = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 };
  var W8 = null;
  function watchReset() { W8 = { t: 0, gap: new Map(), closeT: { USN: -1e9, IJN: -1e9 }, subBest: 1e9, subT: 0, nightT: 0 }; }
  function fitGun(s) { return s.alive && !s.sinking && !s.escaped && GUN[s.type] && s.hp >= WW.fleetGroups.CRIP * s.maxHp; }
  function watch(dt) {
    var rt = WW.game.roundTime, S = WW.world.ships, i, k;
    W8.nightT = nightDead() ? W8.nightT + dt : 0;
    W8.t -= dt; if (W8.t > 0) return;
    W8.t = WATCH_T;
    for (k = 0; k < S.length; k++) { // each fit gun ship hunting a broken side: its gap to gun range, and how it changes
      var e = S[k], n = WW.enemyOf(e.nation); if (!fitGun(e) || !broken(n)) { W8.gap.delete(e.id); continue; }
      var dm = 1e9;
      for (i = 0; i < S.length; i++) { var s = S[i]; if (s.alive && !s.sinking && s.nation === n && s.type !== 'submarine') dm = Math.min(dm, WW.dist(s.x, s.z, e.x, e.z)); }
      var gap = dm - e.stats.guns[0].range, g0 = W8.gap.get(e.id), v = g0 === undefined ? 0 : (g0 - gap) / WATCH_T;
      W8.gap.set(e.id, gap);
      if (gap > 0 && v > CLOSE_V && gap / v < BITE_T) W8.closeT[n] = rt;
    }
    var sm = 1e9; // a submarines-only side: its nearest boat to an enemy ship
    for (i = 0; i < S.length; i++) {
      var b = S[i]; if (!b.alive || b.type !== 'submarine' || !subOnly(b.nation)) continue;
      for (k = 0; k < S.length; k++) if (S[k].alive && !S[k].sinking && S[k].nation !== b.nation && !S[k].isBase) sm = Math.min(sm, WW.dist(b.x, b.z, S[k].x, S[k].z));
    }
    if (sm < W8.subBest - CLOSE_D) W8.subT = rt;
    W8.subBest = Math.min(W8.subBest, sm);
  }
  function lullDead() {
    var G = WW.game, A = WW.fleetCmd && WW.fleetCmd.side('USN'), B = WW.fleetCmd && WW.fleetCmd.side('IJN');
    if (!A || !B || (A.hadFit && B.hadFit) || !G.lastHit || subOnly('USN') || subOnly('IJN') || G.roundTime - G.lastHit < LULL_T) return false; // after the first attack; a submarine side has its own stall (main.js)
    var P = WW.world.planes;
    for (var i = 0; i < P.length; i++) { var p = P[i]; if (p.alive && p.ordnance && OUTB[p.state] && (p.kind === 'dive' || p.kind === 'torpedo')) return false; }
    return true;
  }
  function subOnly(n) { var S = WW.world.ships; for (var i = 0; i < S.length; i++) if (S[i].alive && S[i].nation === n && S[i].type !== 'submarine') return false; return true; }
  function nightDead() {
    var D = WW.dayNight; if (!D || D.canFly() || D.level(D.roundT() + NIGHT_AHEAD) >= D.FLY_MIN) return false;
    var S = WW.world.ships, fights = {}, fleet = {};
    for (var i = 0; i < S.length; i++) {
      var s = S[i]; if (!s.alive || s.sinking || s.escaped || s.isBase) continue;
      if (fitGun(s) || (s.type === 'pt' && (!WW.supply || WW.supply.torpLeft(s) > 0))) fights[s.nation] = true;
      if (FLEET[s.type]) fleet[s.nation] = true;
    }
    return !(fights.USN && fleet.IJN) && !(fights.IJN && fleet.USN);
  }

  function update(dt) {
    if (!battle()) return;
    try { watch(dt); } catch (e) { console.error('endgame watch', e); }
    var now = WW.time.now, W = WW.cfg.MAP_W, ships = WW.world.ships;
    if (!(WW.game && WW.game.noRetire)) for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.sinking) continue;
      var edge = s.escapeEdge || (s.ai && s.ai.withdrawing && s.type !== 'submarine' && s.type !== 'pt' ? (s.nation === 'USN' ? -1 : 1) : 0); // a cripple sent home (ships_ai.js) leaves too: no hulk parked on the edge
      if (edge && (edge < 0 ? s.x <= EXIT : s.x >= W - EXIT)) escape(s);
    }
    pickup(dt);
    tick -= dt;
    if (tick <= 0) { tick = 1; try { breakCheck(); assign(now); hulkCheck(now); } catch (e) { console.error('endgame', e); } }
    try { hulks(dt); } catch (e) { console.error('endgame hulks', e); }
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
  // Aircrew in the water: a ditched plane or one the crew abandoned (air_deaths.js picks these modes with WW.rand); at the sim position of the moment. Not a visual bail-out (bailAt: Math.random), which would feed the sim.
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
    // round watch (main.js): the pursuit of broken side n is closing; when a submarines-only side last got nearer the
    // enemy; both sides have retired for the night
    closing: function (n) { return !!W8 && WW.game.roundTime - W8.closeT[n] < CLOSE_T; },
    subCloseT: function () { return W8 ? W8.subT : 0; },
    nightOut: function () { return !!W8 && W8.nightT >= NIGHT_T; },
    lullOut: function () { return !!W8 && battle() && lullDead(); },
    // how the side's last major ship (CV / BB / CA / DD) left the battle: 'sunk' | 'escaped' | undefined (main.js)
    lastOut: function (n) { return last[n]; },
    tasks: function () { return tasks; }, complete: complete,   // task.air: a Catalina's claim (air_flyingboats.js)
    // open survivor pickups of a side: assigned ones, and fresh ones still waiting for a rescuer
    pending: function (n) { var c = 0, now = WW.time.now; for (var i = 0; i < tasks.length; i++) { var t = tasks[i]; if (!t.done && t.nation === n && (t.by || now - t.t0 < 20)) c++; } return c; },
    // visual helpers (lifeboats.js; they read the sim only): an open survivor pickup of side n within r of (x, z)
    // that a rescuer may still come for, and the rescuer of one, or null
    taskNear: function (n, x, z, r) {
      for (var i = 0; i < tasks.length; i++) { var t = tasks[i]; if (!t.done && t.kind === 'ship' && t.nation === n && WW.dist2(t.x, t.z, x, z) < r * r) return t; }
      return null;
    },
    rescuerNear: function (n, x, z, r) {
      for (var i = 0; i < tasks.length; i++) { var t = tasks[i]; if (!t.done && t.by && t.nation === n && t.by.alive && WW.dist2(t.x, t.z, x, z) < r * r) return t.by; }
      return null;
    }
  };
  reset();
})();
