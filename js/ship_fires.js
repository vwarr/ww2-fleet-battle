// ship_fires.js - WW.shipFires: fires, flooding and damage control as sim state, and the flight-deck hazard
// (sim code: WW.rand only; the flames and smoke are damage.js syncFires, visual). Load after air_deck.js.
//  - Fires: a hit can start a fire (bomb FIRE_P.bomb, ...); each fire burns FIRE_DPS hp/s (an avgas fire x AVGAS_K).
//    Once a second each fire may be put out (OUT_P x damageControl) or spread (SPREAD_P / damageControl^2; avgas x3).
//  - A loaded flight deck: a bomb on a carrier with planes spotted (launch queue, planes waiting on deck) or
//    rearming (carrier.rearm) can set off the avgas and ordnance (chance from the deck load x doctrine.avgas):
//    secondary explosions, the planes on deck and rearming destroyed, several avgas fires ('deckHit' event, the
//    "five fateful minutes"). With avgas fires burning, a magazine / fuel explosion may follow (CHAIN_P /
//    damageControl^2 a second while 3 or more burn). An empty deck takes the normal damage.
//  - Damage control (doctrine.damageControl; USN 1.5, IJN 1): above 1.15 flooding is slowly pumped out (some speed
//    back) and a ship over 60% hp with no fire patches up to REPAIR_MAX of its hp; at 1.15 or below flooding creeps on.
//  - Torpedo breaches: each torpedo hit opens a breach below the waterline (ship.breach). Each open breach floods
//    BREACH_DPS x max hp a second (ship.floodHp: hp lost to flooding) until the damage-control party shores it
//    (SHORE_P x damageControl a second); shoring one counter-floods (the list eases by COUNTER). With the list at
//    CAPSIZE or more and breaches still open she may roll over (CAPSIZE_P / damageControl a second: Yorktown
//    listed 26 deg after two hits at Midway; Hiei, Kirishima and Musashi went over). A torpedo in a carrier may
//    also rupture the avgas tanks and lines (FIRE_P.torpCv, an avgas fire: Lexington at Coral Sea).
//  - Magazine: a heavy hit (torpedo, bomb, big shell) may detonate a magazine (magP): the ship blows up and sinks
//    ('magazine' event, { ship, x, z, kind, cause }: fx_critical.js draws it, the break-up hooks it). MAG by type: a
//    destroyer's unarmoured magazines fore and aft go most easily (Laffey, Barton, Monssen at Guadalcanal; Akatsuki;
//    Yudachi), a treaty cruiser's less (Mikuma's torpedoes, Kinugasa), an armoured battleship's rarely (Arizona's one
//    bomb; Hood, the thin-decked battlecruiser: the MAG_CLS class factors), a carrier's bomb room and avgas tanks
//    now and then (Liscome Bay, Taiho). x MAG_KIND (a torpedo bursts below the belt, by the magazines: Juneau,
//    Barham) and x MAG_TURRET within MAG_R of a main turret (the shell rooms under the barbettes).
//    Calibrated (tests/crit_probe.js, after the 1942 bomb / torpedo rescale) to about one magazine every 4-5 rounds over
//    standard, battle_line, midway and carrier_duel together.
// Ship.takeDamage calls hit(); main.js step calls update(). Public: ship.fireN, ship.avgas, ship.repaired.
window.WW = window.WW || {};
(function () {
  'use strict';
  var FIRE_P = { bomb: 0.35, near: 0.06, torpedo: 0.1, torpCv: 0.3, big: 0.15, med: 0.08 }, FIRE_MAX = 8, FIRE_DPS = 3, AVGAS_K = 2.5;
  var OUT_P = 0.035, SPREAD_P = 0.012, CHAIN_P = 0.012, CHAIN_DMG = 380;
  var DECK_MIN = 2, DECK_P0 = 0.25, DECK_P1 = 0.08, DECK_BOOM = 25, DECK_BOOM_MAX = 400, HANGAR_K = 0.4;
  var FLOOD_RATE = 0.0015, FLOOD_FLOOR = 0.4, REPAIR_HP = 1.5, REPAIR_MAX = 0.05, REPAIR_MIN_HP = 0.6, DC_GOOD = 1.15;
  var BREACH_DPS = 0.003, SHORE_P = 0.03, COUNTER = 0.75, CAPSIZE = 0.19, CAPSIZE_P = 0.05, CAPSIZE_ROLL = 1.7;
  // magazine: chance per heavy hit by type, x MAG_KIND, x MAG_CLS (class key), x MAG_TURRET within MAG_R of a main turret
  var MAG = { destroyer: 0.022, cruiser: 0.011, battleship: 0.0028, carrier: 0.004 }, MAG_TURRET = 2.5, MAG_R = 3;
  var MAG_KIND = { torpedo: 1.5, bomb: 1, shell: 1 };
  var MAG_CLS = { kongo: 2, atlanta: 1.6 };   // Kongo: a rebuilt battlecruiser's thin deck (Hood); Atlanta: a light AA cruiser (Juneau)
  var tick = 0, stats = null;
  function per() { return WW.perSide(0); }
  function reset() {
    tick = 0;
    stats = { started: per(), out: per(), deckHits: per(), deckFires: per(), deckPlanes: per(), deckSafe: per(), chain: per(),
      fireKills: per(), repaired: per(), magazine: per(), breaches: per(), shored: per(), floodHp: per(), floodKills: per(), capsized: per() };
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
    if (q && !cv.deckOut) for (var i = 0; i < q.length; i++) if (q[i].target) n++;   // a holed deck: the strike is struck below, defuelled
    if (D) for (var j = 0; j < D.launchers.length; j++) { var p = D.launchers[j]; if (p.alive && !p.removed && p.state === 'takeoff' && !(cv.deckOut && p.deckPh === 'queued')) n++; }
    if (cv.rearm) n += cv.rearm.length;
    return n;
  }
  // The hangar counts too (ship_deck.js hangarLoad, HANGAR_K a plane): bombers being armed and fuelled below for the
  // next strike (Akagi, Kaga at Midway). Returns the load that went up (0: none).
  function deckHit(cv, x, z) {
    var SD = WW.shipDeck, hg = SD ? SD.hangarLoad(cv) : 0, onDeck = deckLoad(cv), load = onDeck + hg * HANGAR_K, n = cv.nation;
    if (load < DECK_MIN) { stats.deckSafe[n]++; return 0; }
    var pr = Math.min(0.9, (DECK_P0 + DECK_P1 * load) * (doc(n).avgas > 0 ? doc(n).avgas : 1));
    if (WW.rand() >= pr) { stats.deckSafe[n]++; return 0; }
    // the spotted strike, the planes on deck and those rearming go up with the deck
    var lost = 0, q = cv.ai && cv.ai.queue, D = cv._deck;
    if (q) for (var i = q.length - 1; i >= 0; i--) if (q[i].target) { if (cv.hangar && cv.hangar[q[i].kind] > 0) { cv.hangar[q[i].kind]--; lost++; } q.splice(i, 1); }
    if (D) for (var j = D.launchers.length - 1; j >= 0; j--) {
      var p = D.launchers[j]; if (!p.alive || p.removed || p.state !== 'takeoff') continue;
      if (!WW.simOnly && WW.fx) WW.fx.fire(p.x, (p.y || 2) + 0.3, p.z);
      p.remove(); lost++;
    }
    if (cv.rearm) { lost += cv.rearm.length; cv.rearm.length = 0; }
    var below = hg > 0;   // armed bombers below went up too (Akagi). hg > 0 only while a strike is spotted or the reserve rearmed,
    // both of which load the deck too, so this is not 'the deck all but empty' (that never happened: 0 in 48 rounds)
    if (hg > 0) lost += SD.hangarBoom(cv);
    load = Math.round(load);
    stats.deckHits[n]++; stats.deckPlanes[n] += lost;
    cv.fireN = Math.min(FIRE_MAX, (cv.fireN || 0) + 2 + Math.floor(load / 3)); cv.avgas = true;
    stats.deckFires[n]++; stats.started[n] += 2 + Math.floor(load / 3);
    WW.emit('deckHit', { ship: cv, load: load, planes: lost, x: x, z: z, hangar: below, armed: hg });   // fx_critical.js: the chain along the deck
    cv.takeDamage(Math.min(DECK_BOOM_MAX, DECK_BOOM * load), x, z, 'deck');
    return load;
  }

  // ---- magazine: the chance a heavy hit sets one off (pure: the probe sums it), then the roll ----
  function magP(ship, kind, cal, x, z) {
    var p = MAG[ship.type];
    if (!p || !(kind === 'torpedo' || kind === 'bomb' || cal === 'big')) return 0;
    p *= MAG_KIND[kind] || 1;
    if (ship.cls && MAG_CLS[ship.cls.key]) p *= MAG_CLS[ship.cls.key];
    var ts = ship.ai && ship.ai.turrets, g = ship.stats.guns && ship.stats.guns[0];
    if (ts && g && x !== undefined && isFinite(x)) {
      var c = Math.cos(ship.heading), sn = Math.sin(ship.heading), ex = x - ship.x, ez = z - ship.z, lx = ex * c + ez * sn, lz = -ex * sn + ez * c;
      for (var i = 0; i < ts.length; i++) {
        var o = ts[i].t && ts[i].t.obj; if (!o || ts[i].cal !== g.cal) continue;
        var dx = o.position.x - lx, dz = o.position.z - lz; if (dx * dx + dz * dz < MAG_R * MAG_R) { p *= MAG_TURRET; break; }
      }
    }
    return p;
  }
  function magazine(ship, kind, cal, x, z) {
    var p = magP(ship, kind, cal, x, z);
    if (!p || WW.rand() >= p) return false;
    stats.magazine[ship.nation]++;
    var hx = x !== undefined && isFinite(x) ? x : ship.x, hz = z !== undefined && isFinite(z) ? z : ship.z;
    WW.emit('magazine', { ship: ship, x: ship.x, z: ship.z, hx: hx, hz: hz, kind: kind, cal: cal });   // fx_critical.js: the fireball, the column
    ship.takeDamage(ship.hp + 1, x, z, 'magazine');
    return true;
  }

  // ---- hits ----
  function hit(ship, amount, kind, cal, x, z) {
    if (kind === 'crash') kind = 'bomb';   // a burning wreck on the deck (air_impact.js): fires and a loaded deck as a bomb hit
    if (!battle() || !ship.alive || ship.hp <= 0 || !(amount > 0) || kind === 'deck' || kind === 'dc' || kind === 'magazine' || ship.type === 'submarine') return;
    if (magazine(ship, kind, cal, x, z)) return;
    if (kind === 'bomb' && ship.type === 'carrier') {   // the deck load, then the hole in the flight deck (ship_deck.js)
      var boom = deckHit(ship, x, z);
      if (WW.shipDeck && ship.alive) WW.shipDeck.bombHit(ship, amount, x, z, boom);
    }
    var cvT = kind === 'torpedo' && ship.type === 'carrier', p = cvT ? FIRE_P.torpCv : FIRE_P[kind === 'shell' ? cal : kind] || 0;
    if (p && ship.alive && WW.rand() < p) { ship.fireN = Math.min(FIRE_MAX, (ship.fireN || 0) + 1); stats.started[ship.nation]++; if (cvT) ship.avgas = true; }
    if (kind === 'torpedo' && ship.alive) { ship.breach = (ship.breach || 0) + 1; stats.breaches[ship.nation]++; }
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
      if (s.breach > 0 && flooding(s, dc)) continue;
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
  // open torpedo breaches: flood (hp), shore, counter-flood, capsize. Returns true when she went down.
  function flooding(s, dc) {
    var d = BREACH_DPS * s.maxHp * s.breach;
    s.hp -= d; s.floodHp = (s.floodHp || 0) + d; stats.floodHp[s.nation] += d;
    if (s.hp <= 0) { s.hp = 0; stats.floodKills[s.nation]++; s.startSinking(); return true; }
    for (var k = 0, n = s.breach; k < n; k++) if (WW.rand() < SHORE_P * dc) { s.breach--; stats.shored[s.nation]++; s.listRoll = (s.listRoll || 0) * COUNTER; }
    if (s.breach > 0 && Math.abs(s.listRoll || 0) >= CAPSIZE && WW.rand() < CAPSIZE_P / dc) { // she rolls over on the holed side
      stats.capsized[s.nation]++; s.capsized = true;
      s.sinkRoll = Math.sign(s.listRoll) * CAPSIZE_ROLL; s.hp = 0;
      WW.emit('capsize', { ship: s, x: s.x, z: s.z });
      s.startSinking(); return true;
    }
    s.applyLook();
    return false;
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
  WW.shipFires = { hit: hit, update: update, deckLoad: deckLoad, magP: magP, MAG: MAG, stats: null };
  // the air boss can ask whether a carrier's deck is loaded (planes spotted, waiting to launch, or rearming)
  if (WW.airDeck) WW.airDeck.loaded = function (cv) { return deckLoad(cv) >= DECK_MIN; };
  reset();
})();
