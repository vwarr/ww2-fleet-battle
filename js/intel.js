// intel.js - WW.intel: fog of war. Each side keeps a contact table of the enemy ships and planes it has seen.
// Every TICK s of sim time (both sides in the same tick, so a line-of-sight test is shared) the side's ships,
// airborne planes and scouts look for the enemy: visual range by target size x observer height, a long range
// on a ship that just fired its guns (gun flash), islands block a ship's line of sight, destroyer sonar finds
// submerged subs, and ships / planes see enemy planes. AI decision code asks intel what is known; physics
// (hit tests, flak, crashes) stays omniscient. Detection has no dice, so a seeded round stays the same.
// A contact is { unit, x, z, heading, speed, seenAt, firstSeenAt, quality, by }: x..speed are the last seen
// values, quality 'visual' | 'radar' | 'sonar' | 'scout' | 'air', by = the observer. A contact seen within FRESH s is a
// firing solution (visible); an older one is a last-known position, dropped after SHIP_TTL / PLANE_TTL s.
// Events: 'contact' { nation, unit, first, by } when a ship is sighted for the first time this round, or again
// after REGAIN s out of sight; 'firstSighting' { nation, unit } once per side per enemy carrier or battleship.
window.WW = window.WW || {};
(function () {
  'use strict';
  // Every detection range, in world units (sized for the 960 x 600 map; the biggest gun reaches 170).
  var R = {
    SEEN: { carrier: 240, battleship: 240, cruiser: 210, destroyer: 170, submarine: 70, pt: 75 }, // target size: seen this far by a tall lookout
    EYE: { carrier: 1, battleship: 1, cruiser: 0.95, destroyer: 0.85, submarine: 0.65, pt: 0.55 }, // observer height factor
    PERISCOPE: 0.5,                                    // a submerged sub's eye factor
    FLASH: { big: 400, med: 320, small: 240, mg: 110 }, FLASH_T: 6, // a ship that fired in the last FLASH_T s
    SONAR: 65,                                         // destroyer sonar on submerged subs (ships_ai.js SONAR)
    AIR: 100, SCOUT: 120, SPOT: 85,                    // airborne planes / scouts see ships; scouts spot for the guns within SPOT
    SEE_PLANE: { carrier: 170, battleship: 130, cruiser: 130, destroyer: 110, submarine: 40, pt: 60 }, // ships see planes (AA directors, lookouts)
    SEE_PLANE_NATION: { USN: { carrier: 250 } },       // per-nation override: USN carrier radar fighter direction (quality 'radar' beyond SEE_PLANE)
    PLANE_PLANE: 100,                                  // planes see planes
    LAND: 0.4,                                         // land higher than this above the sea blocks a ship's line of sight
    TORP: 45                                           // a ship sees an enemy torpedo track this close (scanTorps)
  };
  var T = { TICK: 0.5, FRESH: 3, SHIP_TTL: 90, PLANE_TTL: 10, REGAIN: 30, SPOT_HOLD: 20 };
  var CAPITAL = { carrier: 1, battleship: 1 };
  var NATIONS = ['USN', 'IJN'];
  var side = {}, tickT = 0, losCache = new Map(), scratch = [];
  var stats = { ticks: 0, los: 0, losHit: 0, contacts: 0 };

  function newSide() { return { list: [], map: new Map(), ships: [], planes: [], ever: new Set(), first: new Set(), torps: [] }; }
  function clear() {
    for (var i = 0; i < NATIONS.length; i++) {
      side[NATIONS[i]] = newSide();
    }
    tickT = 0; losCache.clear();
  }
  clear();
  function sideOf(n) { return side[n] || (side[n] = newSide()); }

  // Islands block the view: a handful of samples along the line, cached per pair for this tick.
  function los(a, b) {
    var key = a.id < b.id ? a.id * 100000 + b.id : b.id * 100000 + a.id, v = losCache.get(key);
    if (v !== undefined) return v;
    stats.los++;
    var d = WW.dist(a.x, a.z, b.x, b.z), n = Math.min(10, Math.max(3, Math.ceil(d / 25))), ok = true;
    for (var i = 1; i <= n && ok; i++) {
      var f = i / (n + 1);
      if (WW.terrain.depthAt(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f) < -R.LAND) ok = false;
    }
    if (!ok) stats.losHit++;
    losCache.set(key, ok);
    return ok;
  }
  function usableShip(s) { return s.alive && !s.sinking && !s.removed; }
  function airborne(p) { return p.alive && !p.removed && p.y > 4 && p.state !== 'catapult' && p.state !== 'afloat' && p.state !== 'alight'; }

  // Record a sighting of unit u by observer `by` this tick (best quality wins: visual > sonar > scout > air).
  var QRANK = { visual: 4, radar: 3.5, sonar: 3, scout: 2, air: 1 };
  function sight(nation, S, u, by, q, now) {
    var c = S.map.get(u);
    if (c && c.seenAt === now && QRANK[c.quality] >= QRANK[q]) return;
    var isShip = !!u.stats, regained = c && now - c.seenAt > T.REGAIN;
    if (!c) {
      c = {};   // not pooled: AI code may hold a contact across ticks, so one object stays one unit for the round
      c.unit = u; c.firstSeenAt = now; c.seenAt = -1e9;
      S.map.set(u, c); S.list.push(c); stats.contacts++;
    }
    var fresh = c.seenAt !== now;
    c.x = u.x; c.z = u.z; c.heading = u.heading || 0; c.speed = u.speed || 0;
    c.quality = q; c.by = by;
    if (fresh && isShip && (c.seenAt < 0 || regained)) {
      var first = !S.ever.has(u);
      S.ever.add(u);
      c.seenAt = now;
      WW.emit('contact', { nation: nation, unit: u, first: first, by: by });
      if (first && CAPITAL[u.type] && !S.first.has(u)) { S.first.add(u); WW.emit('firstSighting', { nation: nation, unit: u }); }
    }
    c.seenAt = now;
  }

  function scan(nation, now) {
    var S = sideOf(nation), ships = WW.world.ships, planes = WW.world.planes, i, j, o, s, p, d2, r;
    // enemy ships
    for (i = 0; i < ships.length; i++) {
      o = ships[i];
      if (o.nation === nation || !usableShip(o)) continue;
      var size = o.submerged ? 0 : R.SEEN[o.type] || 100;
      if (o.firedAt > now - R.FLASH_T) size = Math.max(size, R.FLASH[o.firedCal] || 0);
      var seen = false;
      for (j = 0; j < ships.length && !seen; j++) {
        s = ships[j];
        if (s.nation !== nation || !usableShip(s)) continue;
        d2 = WW.dist2(s.x, s.z, o.x, o.z);
        if (o.type === 'submarine' && s.stats.depthCharges && d2 < R.SONAR * R.SONAR) { sight(nation, S, o, s, o.submerged ? 'sonar' : 'visual', now); seen = !o.submerged; continue; }
        if (!size) continue;
        r = size * (s.submerged ? R.PERISCOPE : R.EYE[s.type] || 0.8);
        if (d2 < r * r && los(s, o)) { sight(nation, S, o, s, 'visual', now); seen = true; }
      }
      if (o.submerged) continue;
      for (j = 0; j < planes.length; j++) {
        p = planes[j];
        if (p.nation !== nation || !airborne(p)) continue;
        var sc = p.kind === 'scout';
        if (seen && !sc) continue;
        d2 = WW.dist2(p.x, p.z, o.x, o.z);
        r = sc ? R.SCOUT : R.AIR;
        if (d2 >= r * r) continue;
        if (!seen) sight(nation, S, o, p, sc ? 'scout' : 'air', now);
        if (sc && d2 < R.SPOT * R.SPOT) { // scouts spot for the guns: combat.js SPOT_DISP
          if (!(o.spottedUntil > now) && WW.scouts) WW.scouts.stats.spotted++;
          o.spottedUntil = now + T.SPOT_HOLD; o.spottedBy = nation;
        }
      }
    }
    // enemy planes
    for (i = 0; i < planes.length; i++) {
      o = planes[i];
      if (o.nation === nation || !o.alive || o.removed) continue;
      var got = false;
      for (j = 0; j < ships.length && !got; j++) {
        s = ships[j];
        if (s.nation !== nation || !usableShip(s)) continue;
        if (s.submerged) continue;
        r = R.SEE_PLANE[s.type] || 110;
        var rn = R.SEE_PLANE_NATION[nation], rr = (rn && rn[s.type]) || r;   // radar fighter direction reaches farther
        d2 = WW.dist2(s.x, s.z, o.x, o.z);
        if (d2 < r * r) { sight(nation, S, o, s, 'visual', now); got = true; }
        else if (d2 < rr * rr) sight(nation, S, o, s, 'radar', now);   // keep looking: another ship may see it
      }
      for (j = 0; j < planes.length && !got; j++) {
        p = planes[j];
        if (p.nation !== nation || !airborne(p)) continue;
        if (WW.dist2(p.x, p.z, o.x, o.z) < R.PLANE_PLANE * R.PLANE_PLANE) { sight(nation, S, o, p, 'air', now); got = true; }
      }
    }
    // expire and sort into ships / planes (in place, no allocation)
    var L = S.list, w = 0;
    S.ships.length = 0; S.planes.length = 0;
    for (i = 0; i < L.length; i++) {
      var c = L[i], u = c.unit, ship = !!u.stats;
      var gone = ship ? !usableShip(u) || now - c.seenAt > T.SHIP_TTL : !u.alive || u.removed || now - c.seenAt > T.PLANE_TTL;
      if (gone) { S.map.delete(u); continue; } // a held contact keeps its unit (check unit.alive / known())
      L[w++] = c;
      (ship ? S.ships : S.planes).push(c);
    }
    L.length = w;
  }

  // Torpedo tracks: an enemy torpedo within R.TORP of any of the side's ships is seen (its wake). One entry
  // object per running torpedo, { proj, x, z, h, speed, seenAt, firstSeenAt }, dropped when the torpedo ends.
  // Pooled projectiles are reused, so a track ends on the torpedo's own events (weaponImpact when it ends,
  // weaponDropped when the pooled object is fired again), never on the pool's state: replays stay exact.
  function dropTrack(proj) {
    for (var n = 0; n < NATIONS.length; n++) { var T = sideOf(NATIONS[n]).torps; for (var i = T.length - 1; i >= 0; i--) if (T[i].proj === proj) T.splice(i, 1); }
  }
  WW.on('weaponImpact', function (e) { if (e && e.kind === 'torpedo' && e.proj) dropTrack(e.proj); });
  WW.on('weaponDropped', function (e) { if (e && e.kind === 'torpedo' && e.proj) dropTrack(e.proj); });
  function scanTorps(nation, now) {
    var S = sideOf(nation), T = S.torps, act = WW.combat && WW.combat._i && WW.combat._i.active, ships = WW.world.ships, i, j;
    for (i = T.length - 1; i >= 0; i--) if (T[i].proj.dead || T[i].proj.kind !== 'torp') T.splice(i, 1);
    if (!act) return;
    for (i = 0; i < act.length; i++) {
      var p = act[i];
      if (p.kind !== 'torp' || p.dead || p.nation === nation) continue;
      var e = null;
      for (j = 0; j < T.length; j++) if (T[j].proj === p) { e = T[j]; break; }
      if (!e) {
        var r2 = R.TORP * R.TORP, seen = false;
        for (j = 0; j < ships.length && !seen; j++) { var s = ships[j]; if (s.nation === nation && usableShip(s) && WW.dist2(s.x, s.z, p.x, p.z) < r2) seen = true; }
        if (!seen) continue;
        e = { proj: p, firstSeenAt: now }; T.push(e);
      }
      e.x = p.x; e.z = p.z; e.h = p.h; e.speed = p.sp; e.run = p.run; e.seenAt = now;
    }
  }

  function update(dt) {
    if (!WW.game || WW.game.state !== 'battle') return;
    tickT -= dt;
    if (tickT > 0) return;
    tickT += T.TICK; if (tickT <= 0) tickT = T.TICK;
    try {
      var now = WW.time.now;
      losCache.clear(); stats.ticks++;
      for (var i = 0; i < NATIONS.length; i++) { scan(NATIONS[i], now); scanTorps(NATIONS[i], now); }
    } catch (e) { console.error('intel', e); }
  }

  WW.on('shellFired', function (e) { if (e && e.ship) { e.ship.firedAt = WW.time.now; e.ship.firedCal = e.cal; } });
  WW.on('roundStart', clear);
  WW.on('setupStart', clear);

  function known(nation, unit) { var S = side[nation]; return (S && unit && S.map.get(unit)) || null; }
  WW.intel = {
    R: R, T: T, stats: stats, update: update, clear: clear,
    contacts: function (nation) { return sideOf(nation).list; },   // all live contacts (shared array: do not modify)
    known: known,                                                  // contact or null (any age up to its TTL)
    lastKnown: function (nation, unit) { return known(nation, unit); }, // same object: read x, z, heading, speed, seenAt
    // a current firing solution: seen within maxAge s (default FRESH) by any ship, plane or scout of the side
    visible: function (nation, unit, maxAge) {
      var c = known(nation, unit);
      return !!c && WW.time.now - c.seenAt <= (maxAge === undefined ? T.FRESH : maxAge);
    },
    torpedoes: function (nation) { return sideOf(nation).torps; }, // enemy torpedo tracks the side has seen (shared array)
    canSee: function (nation, unit) { return WW.intel.visible(nation, unit); }, // alias (tests/sim_behaviour.js)
    age: function (c) { return c ? WW.time.now - c.seenAt : 1e9; },
    // enemy ship / plane contacts. opts.fresh: only those seen within that many s (true = FRESH).
    // The filtered result is a shared scratch array, valid until the next call.
    enemyShips: function (nation, opts) { return filter(sideOf(nation).ships, opts); },
    enemyPlanes: function (nation, opts) { return filter(sideOf(nation).planes, opts || FRESH_OPT); },
    // centre of the side's ship contacts (last-known positions), or null
    centre: function (nation) {
      var L = sideOf(nation).ships, x = 0, z = 0;
      for (var i = 0; i < L.length; i++) { x += L[i].x; z += L[i].z; }
      return L.length ? { x: x / L.length, z: z / L.length } : null;
    }
  };
  var FRESH_OPT = { fresh: true };
  function filter(L, opts) {
    if (!opts || !opts.fresh) return L;
    var max = opts.fresh === true ? T.FRESH : opts.fresh, now = WW.time.now;
    scratch.length = 0;
    for (var i = 0; i < L.length; i++) if (now - L[i].seenAt <= max) scratch.push(L[i]);
    return scratch;
  }
})();
