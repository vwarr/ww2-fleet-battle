// ship_fires.js - WW.shipFires: fires, flooding and damage control as sim state, and the flight-deck hazard
// (sim code: WW.rand only; the flames and smoke are damage.js syncFires, visual). Load after air_deck.js.
//  - Fires: a hit can start a fire (bomb FIRE_P.bomb, ...); each fire burns FIRE_DPS hp/s (an avgas fire x AVGAS_K).
//    Once a second each fire may be put out (OUT_P x damageControl) or spread (SPREAD_P / damageControl^2; avgas x3).
//  - A loaded flight deck: a bomb on a carrier with planes spotted (launch queue, planes waiting on deck) or
//    rearming (carrier.rearm) can set off the avgas and ordnance (chance from the deck load x doctrine.avgas):
//    secondary explosions, the planes on deck and rearming destroyed, several avgas fires ('deckHit' event, the
//    "five fateful minutes"). With avgas fires burning, a magazine / fuel explosion may follow (CHAIN_P /
//    damageControl^2 a second while 3 or more burn). An empty deck takes the normal damage.
//  - Damage control (doctrine.damageControl; USN 1.3, IJN 1): above 1.15 flooding is slowly pumped out (some speed
//    back) and a ship over 60% hp with no fire patches up to REPAIR_MAX of its hp; at 1.15 or below flooding creeps on.
//  - Magazine: a heavy hit (torpedo, bomb, big shell) on a battleship or cruiser detonates a magazine with chance
//    MAG_P (x MAG_TURRET within MAG_R of a main turret): the ship blows up and sinks ('magazine' event).
// Ship.takeDamage calls hit(); main.js step calls update(). Public: ship.fireN, ship.avgas, ship.repaired.
window.WW = window.WW || {};
(function () {
  'use strict';
  var FIRE_P = { bomb: 0.35, torpedo: 0.1, big: 0.15, med: 0.08 }, FIRE_MAX = 8, FIRE_DPS = 3, AVGAS_K = 2.5;
  var OUT_P = 0.035, SPREAD_P = 0.012, CHAIN_P = 0.012, CHAIN_DMG = 380;
  var DECK_MIN = 2, DECK_P0 = 0.25, DECK_P1 = 0.08, DECK_BOOM = 25, DECK_BOOM_MAX = 400;
  var FLOOD_RATE = 0.0015, FLOOD_FLOOR = 0.4, REPAIR_HP = 1.5, REPAIR_MAX = 0.05, REPAIR_MIN_HP = 0.6, DC_GOOD = 1.15;
  var MAG_P = 0.0004, MAG_TURRET = 3, MAG_R = 3;   // magazine: chance per heavy hit on a BB / CA, x3 within MAG_R of a turret
  var NATIONS = ['USN', 'IJN'], tick = 0, stats = null;
  function per() { return { USN: 0, IJN: 0 }; }
  function reset() {
    tick = 0;
    stats = { started: per(), out: per(), deckHits: per(), deckFires: per(), deckPlanes: per(), deckSafe: per(), chain: per(),
      fireKills: per(), repaired: per(), magazine: per() };
    WW.shipFires.stats = stats;
  }
  function doc(n) { return (WW.fleetCmd && WW.fleetCmd.doctrine(n)) || {}; }
  function dcOf(s) { var d = doc(s.nation).damageControl; return d > 0 ? d : 1; }
  function battle() { return WW.game && WW.game.state === 'battle'; }

  // ---- the flight deck ----
  // What a carrier has spotted or servicing: strike planes queued to launch, planes waiting on deck to take off,
  // planes rearming / refuelling after landing. Read by the air boss (WW.airDeck.loaded) and the deck hazard.
  function deckLoad(cv) {
    var n = 0, D = cv._deck, q = cv.ai && cv.ai.queue;
    if (q) for (var i = 0; i < q.length; i++) if (q[i].target) n++;
    if (D) for (var j = 0; j < D.launchers.length; j++) { var p = D.launchers[j]; if (p.alive && !p.removed && p.state === 'takeoff') n++; }
    if (cv.rearm) n += cv.rearm.length;
    return n;
  }
  function deckHit(cv, x, z) {
    var load = deckLoad(cv), n = cv.nation;
    if (load < DECK_MIN) { stats.deckSafe[n]++; return; }
    var pr = Math.min(0.9, (DECK_P0 + DECK_P1 * load) * (doc(n).avgas > 0 ? doc(n).avgas : 1));
    if (WW.rand() >= pr) { stats.deckSafe[n]++; return; }
    // the spotted strike, the planes on deck and those rearming go up with the deck
    var lost = 0, q = cv.ai && cv.ai.queue, D = cv._deck;
    if (q) for (var i = q.length - 1; i >= 0; i--) if (q[i].target) { if (cv.hangar && cv.hangar[q[i].kind] > 0) { cv.hangar[q[i].kind]--; lost++; } q.splice(i, 1); }
    if (D) for (var j = D.launchers.length - 1; j >= 0; j--) {
      var p = D.launchers[j]; if (!p.alive || p.removed || p.state !== 'takeoff') continue;
      if (!WW.simOnly && WW.fx) WW.fx.fire(p.x, (p.y || 2) + 0.3, p.z);
      p.remove(); lost++;
    }
    if (cv.rearm) { lost += cv.rearm.length; cv.rearm.length = 0; }
    stats.deckHits[n]++; stats.deckPlanes[n] += lost;
    cv.fireN = Math.min(FIRE_MAX, (cv.fireN || 0) + 2 + Math.floor(load / 3)); cv.avgas = true;
    stats.deckFires[n]++; stats.started[n] += 2 + Math.floor(load / 3);
    WW.emit('deckHit', { ship: cv, load: load, planes: lost, x: x, z: z });
    cv.takeDamage(Math.min(DECK_BOOM_MAX, DECK_BOOM * load), x, z, 'deck');
    if (!WW.simOnly && WW.fx) for (var k = 0; k < 3; k++) { var w = cv.toWorld((Math.random() - 0.5) * cv.stats.length * 0.7, (Math.random() - 0.5) * 2); WW.fx.explosion(w[0], 2.5, w[1], 1.6); }
  }

  // ---- magazine (Hood, Arizona): a heavy hit on a battleship or cruiser, rarely, more often beside a turret ----
  function magazine(ship, kind, cal, x, z) {
    if ((ship.type !== 'battleship' && ship.type !== 'cruiser') || !(kind === 'torpedo' || kind === 'bomb' || cal === 'big')) return false;
    var p = MAG_P, ts = ship.ai && ship.ai.turrets;
    if (ts && x !== undefined && isFinite(x)) {
      var c = Math.cos(ship.heading), sn = Math.sin(ship.heading), ex = x - ship.x, ez = z - ship.z, lx = ex * c + ez * sn, lz = -ex * sn + ez * c;
      for (var i = 0; i < ts.length; i++) {
        var o = ts[i].t && ts[i].t.obj; if (!o || ts[i].cal !== ship.stats.guns[0].cal) continue;
        var dx = o.position.x - lx, dz = o.position.z - lz; if (dx * dx + dz * dz < MAG_R * MAG_R) { p *= MAG_TURRET; break; }
      }
    }
    if (WW.rand() >= p) return false;
    stats.magazine[ship.nation]++;
    WW.emit('magazine', { ship: ship, x: ship.x, z: ship.z });
    if (!WW.simOnly && WW.fx) {
      var L = ship.stats.length;
      for (var k = 0; k < 5; k++) { var w = ship.toWorld((Math.random() - 0.5) * L * 0.6, 0); WW.fx.explosion(w[0], 2 + Math.random() * 3, w[1], 3 + Math.random() * 1.5); }
      for (var j = 0; j < 8; j++) WW.fx.smoke(ship.x + (Math.random() - 0.5) * 6, 4 + j * 2.5, ship.z + (Math.random() - 0.5) * 6, true, 3 + j * 0.4);
      WW.fx.sparks(ship.x, 4, ship.z); WW.fx.splash(ship.x, ship.z, 4);
    }
    ship.takeDamage(ship.hp + 1, x, z, 'magazine');
    return true;
  }

  // ---- hits ----
  function hit(ship, amount, kind, cal, x, z) {
    if (!battle() || !ship.alive || ship.hp <= 0 || !(amount > 0) || kind === 'deck' || kind === 'dc' || kind === 'magazine' || ship.type === 'submarine') return;
    if (magazine(ship, kind, cal, x, z)) return;
    if (kind === 'bomb' && ship.type === 'carrier') deckHit(ship, x, z);
    var p = FIRE_P[kind === 'shell' ? cal : kind] || 0;
    if (p && ship.alive && WW.rand() < p) { ship.fireN = Math.min(FIRE_MAX, (ship.fireN || 0) + 1); stats.started[ship.nation]++; }
  }

  // ---- once a second: burn, spread, put out, flood, repair ----
  function second() {
    var ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i]; if (!s.alive || s.sinking || s.type === 'submarine') continue;
      var dc = dcOf(s), n = s.fireN || 0;
      if (n) {
        for (var k = 0, f = n; k < f; k++) if (WW.rand() < OUT_P * dc) { s.fireN--; stats.out[s.nation]++; }
        if (s.fireN && WW.rand() < SPREAD_P * (s.avgas ? 3 : 1) * s.fireN / (dc * dc) && s.fireN < FIRE_MAX) { s.fireN++; stats.started[s.nation]++; }
        if (!s.fireN) s.avgas = false;
        if (s.avgas && s.fireN >= 3 && WW.rand() < CHAIN_P / (dc * dc)) { // the fuel lines / bomb magazine go up
          stats.chain[s.nation]++; WW.emit('shipBoom', { ship: s, x: s.x, y: 2, z: s.z, size: 2 });
          s.takeDamage(CHAIN_DMG, s.x, s.z, 'deck');
          if (!s.alive) { stats.fireKills[s.nation]++; continue; }
        }
        var burn = (s.fireN || 0) * FIRE_DPS * (s.avgas ? AVGAS_K : 1);
        if (burn > 0) {
          s.hp -= burn;
          if (s.hp <= 0) { s.hp = 0; stats.fireKills[s.nation]++; s.startSinking(); continue; }
          s.applyLook();
        }
      }
      if (s.flood > 0) {
        if (dc > DC_GOOD) s.flood = Math.max(s.floodMax * FLOOD_FLOOR || 0, s.flood - FLOOD_RATE * (dc - 1) * 3);
        else s.flood = Math.min(0.4, s.flood + FLOOD_RATE);
        s.floodMax = Math.max(s.floodMax || 0, s.flood);
      }
      if (dc > DC_GOOD && !s.fireN && s.hp >= REPAIR_MIN_HP * s.maxHp && s.hp < s.maxHp && (s.repaired || 0) < REPAIR_MAX * s.maxHp) {
        var r = Math.min(REPAIR_HP, s.maxHp - s.hp, REPAIR_MAX * s.maxHp - (s.repaired || 0));
        s.hp += r; s.repaired = (s.repaired || 0) + r; stats.repaired[s.nation] += r; s.applyLook();
      }
      if (WW.damage && WW.damage.syncFires && s.fireN) WW.damage.syncFires(s, s.fireN, s.avgas);
    }
  }
  function update(dt) {
    if (!battle()) return;
    tick -= dt;
    if (tick > 0) return;
    tick += 1;
    try { second(); } catch (e) { console.error('shipFires', e); }
  }

  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.shipFires = { hit: hit, update: update, deckLoad: deckLoad, stats: null };
  // the air boss can ask whether a carrier's deck is loaded (planes spotted, waiting to launch, or rearming)
  if (WW.airDeck) WW.airDeck.loaded = function (cv) { return deckLoad(cv) >= DECK_MIN; };
  reset();
})();
