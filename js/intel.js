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
  // Every detection range, in world units (sized to the ships, not the map: the 2400 x 1350 map is ~10 x a big ship's
  // visual range across; the biggest gun reaches 170).
  var R = {
    SEEN: { carrier: 240, battleship: 240, cruiser: 210, destroyer: 170, submarine: 70, pt: 75 }, // target size: seen this far by a tall lookout
    EYE: { carrier: 1, battleship: 1, cruiser: 0.95, destroyer: 0.85, submarine: 0.65, pt: 0.55 }, // observer height factor
    PERISCOPE: 0.5,                                    // a submerged sub's eye factor
    FLASH: { big: 400, med: 320, small: 240, mg: 110 }, FLASH_T: 6, // a ship that fired in the last FLASH_T s
    SONAR: 65,                                         // destroyer sonar on submerged subs (ships_ai.js SONAR)
    AIR: 100, SCOUT: 120, SPOT: 85,                    // airborne planes / scouts see ships; scouts spot for the guns within SPOT
    PATROL: 140,                                       // patrol flying boats (air_patrol.js): trained observers, high and steady
    CLOSE_ID: 45,                                      // an air observer this close identifies the type correctly
    SEE_PLANE: { carrier: 170, battleship: 130, cruiser: 130, destroyer: 110, submarine: 40, pt: 60 }, // ships see planes (AA directors, lookouts)
    SEE_PLANE_NATION: { USN: { carrier: 250 } },       // per-nation override: USN carrier radar fighter direction (quality 'radar' beyond SEE_PLANE)
    PLANE_PLANE: 100,                                  // planes see planes
    LAND: 0.4,                                         // land higher than this above the sea blocks a ship's line of sight
    TORP: 45,                                          // a ship sees an enemy torpedo track this close (scanTorps)
    DROP: 130                                          // ...and an aerial torpedo's drop this close (the plane on its run and the splash, watched by
                                                       // the lookouts: the ship combs the tracks from the drop; balance pass, Oct 2026)
  };
  var T = { TICK: 0.5, FRESH: 3, SHIP_TTL: 180, PLANE_TTL: 10, REGAIN: 30, SPOT_HOLD: 20 }; // SHIP_TTL 180 (was 90): the plot keeps a last-known position longer on the big map (the searches go back to it)
  var CAPITAL = { carrier: 1, battleship: 1 };
  var NATIONS = ['USN', 'IJN'];
  var side = {}, tickT = 0, losCache = new Map(), scratch = [];
  var stats = { ticks: 0, los: 0, losHit: 0, contacts: 0, reports: 0, misid: 0, resolved: 0, errSum: 0, wrongStrikes: 0, wrongRedirects: 0 };

  function newSide() { return { list: [], map: new Map(), ships: [], planes: [], ever: new Set(), first: new Set(), torps: [] }; }
  function clear() {
    for (var i = 0; i < NATIONS.length; i++) {
      side[NATIONS[i]] = newSide();
    }
    tickT = 0; losCache.clear();
    for (var k in stats) if (k !== 'ticks' && k !== 'los' && k !== 'losHit' && k !== 'contacts') stats[k] = 0;   // per-round report stats
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
    if (ok && WW.smoke && WW.smoke.blocks(a.x, a.z, b.x, b.z)) ok = false; // a smoke screen (ai_charge.js)
    if (!ok) stats.losHit++;
    losCache.set(key, ok);
    return ok;
  }
  function usableShip(s) { return s.alive && !s.sinking && !s.removed; }
  function airborne(p) { return p.alive && !p.removed && p.y > 4 && p.state !== 'catapult' && p.state !== 'afloat' && p.state !== 'alight'; }

  // Record a sighting of unit u by observer `by` this tick (best quality wins: visual > sonar > scout > air).
  var QRANK = { visual: 4, radar: 3.5, sonar: 3, patrol: 2.5, scout: 2, air: 1 };
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
    c.heading = u.heading || 0; c.speed = u.speed || 0;
    c.quality = q; c.by = by;
    if (isShip) report(nation, c, u, by, q, now, c.seenAt < 0 || now - c.seenAt > T.REGAIN); else { c.x = u.x; c.z = u.z; }
    if (fresh && isShip && (c.seenAt < 0 || regained)) {
      var first = !S.ever.has(u);
      S.ever.add(u);
      c.seenAt = now;
      WW.emit('contact', { nation: nation, unit: u, first: first, by: by });
      if (first && CAPITAL[u.type] && !S.first.has(u)) { S.first.add(u); WW.emit('firstSighting', { nation: nation, unit: u }); }
    }
    c.seenAt = now;
  }

  // Imperfect sighting reports (scouts, carrier planes, patrol flying boats; never a ship's own lookouts): a position
  // error that grows with the observer's range (navigation and plotting) and shrinks while the same observer keeps
  // reporting, and a chance to misidentify the type (a cruiser reported as a carrier, a destroyer as a cruiser: the
  // Midway "two carriers" report). The error is rolled per report (a new observer, or after a gap), the type only on a
  // first sighting (or one regained after T.REGAIN), from WW.rand, with the
  // side's doctrine rates (fleet_groups.js reportErr / misId). A visual sighting by a ship, or an air observer within
  // R.CLOSE_ID, puts it right. contact.reportedType / misid / err; events 'report' and 'misidResolved'.
  var NOREP = typeof location !== 'undefined' && location.search.includes('norep');
  var AIRQ = { scout: 1, air: 1.25, patrol: 1 };                                   // carrier aircrews: not trained observers
  var MISTAKE = { cruiser: ['carrier', 1], destroyer: ['cruiser', 1], battleship: ['carrier', 0.6], carrier: ['battleship', 0.4] };
  function report(nation, c, u, by, q, now, first) {
    if (!AIRQ[q] || NOREP) {   // a ship's own eyes / radar / sonar: exact, and the type is plain
      c.x = u.x; c.z = u.z;
      if (c.misid) resolve(nation, c, u, by);
      c.ex = c.ez = 0; c.err = 0; c.reportedType = u.type; c.repBy = null;
      return;
    }
    var d = WW.dist(by.x, by.z, u.x, u.z), D = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(nation) : null;
    var kErr = (D && D.reportErr !== undefined ? D.reportErr : 0.08) * AIRQ[q], kId = (D && D.misId !== undefined ? D.misId : 0.15) * AIRQ[q];
    if (c.repBy !== by || now - c.repAt > 6 || c.ex === undefined) {   // a new report
      var a = WW.rand() * Math.PI * 2, m = d * kErr * (0.4 + WW.rand() * 1.2);
      c.ex = Math.cos(a) * m; c.ez = Math.sin(a) * m; stats.reports++;
      var mk = MISTAKE[u.type], wrong = first && mk && d > R.CLOSE_ID && WW.rand() < kId * mk[1] * WW.clamp(d / 120, 0.3, 1.2);
      if (wrong && !c.misid) { c.misid = true; c.reportedType = mk[0]; stats.misid++; }
      else if (!c.reportedType) c.reportedType = u.type;
      c.x = u.x + c.ex; c.z = u.z + c.ez; c.err = m; stats.errSum += m;
      WW.emit('report', { nation: nation, unit: u, reportedType: c.reportedType, misid: !!c.misid, x: c.x, z: c.z, err: m, by: by });
    } else { c.ex *= 0.88; c.ez *= 0.88; }   // the same observer keeps reporting: the plot firms up
    if (c.misid && d < R.CLOSE_ID) resolve(nation, c, u, by);
    c.repBy = by; c.repAt = now;
    c.x = u.x + c.ex; c.z = u.z + c.ez; c.err = Math.hypot(c.ex, c.ez);
  }
  function resolve(nation, c, u, by) {
    c.misid = false; c.reportedType = u.type; stats.resolved++;
    WW.emit('misidResolved', { nation: nation, unit: u, type: u.type, by: by });
  }

  function scan(nation, now) {
    var S = sideOf(nation), ships = WW.world.ships, planes = WW.world.planes, i, j, o, s, p, d2, r;
    // enemy ships
    for (i = 0; i < ships.length; i++) {
      o = ships[i];
      if (o.nation === nation || !usableShip(o)) continue;
      var size = o.submerged ? 0 : R.SEEN[o.type] || 100, glow = o.firedAt > now - R.FLASH_T ? R.FLASH[o.firedCal] || 0 : 0;
      var NO = WW.nightOps; // night_ops.js: darkness, rain, star shells, searchlights (seeR), USN ship radar (radarR)
      if (!NO) size = Math.max(size, glow);
      var seen = false;
      for (j = 0; j < ships.length && !seen; j++) {
        s = ships[j];
        if (s.nation !== nation || !usableShip(s)) continue;
        d2 = WW.dist2(s.x, s.z, o.x, o.z);
        if (o.type === 'submarine' && s.stats.depthCharges && d2 < R.SONAR * R.SONAR) { sight(nation, S, o, s, o.submerged ? 'sonar' : 'visual', now); seen = !o.submerged; continue; }
        if (!size) continue;
        r = (NO ? NO.seeR(s, o, size, glow) : size) * (s.submerged ? R.PERISCOPE : R.EYE[s.type] || 0.8);
        if (d2 < r * r && los(s, o)) { sight(nation, S, o, s, 'visual', now); seen = true; }
      }
      for (j = 0; j < ships.length && !seen && NO && !o.submerged; j++) { // USN SG surface radar: through dark and rain
        s = ships[j];
        if (s.nation !== nation || !usableShip(s) || !(r = NO.radarR(s, o))) continue;
        if (WW.dist2(s.x, s.z, o.x, o.z) < r * r && los(s, o)) { sight(nation, S, o, s, 'radar', now); seen = true; NO.stats.radarSights++; }
      }
      if (o.submerged) continue;
      for (j = 0; j < planes.length; j++) {
        p = planes[j];
        if (p.nation !== nation || !airborne(p)) continue;
        var sc = p.kind === 'scout', pb = p.kind === 'flyingboat';
        if (seen && !sc) continue;
        d2 = WW.dist2(p.x, p.z, o.x, o.z);
        r = (sc ? R.SCOUT : pb ? R.PATROL : R.AIR) * (NO ? NO.airK(o) : 1);
        if (d2 >= r * r) continue;
        if (!seen) sight(nation, S, o, p, sc ? 'scout' : pb ? 'patrol' : 'air', now);
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
    // the island base: on the enemy's chart, and its owner's radar / lookout station (island_base.js)
    if (WW.islandBase && WW.islandBase.base) WW.islandBase.scan(nation, function (u, by, q) { sight(nation, S, u, by, q, now); });
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
        // the track's wake: an oxygen torpedo (sight < 1, IJN) is seen only closer in (core.js WW.TORPEDO_NATION)
        var rt = p.src === 'Air' && p.run < 12 ? R.DROP : R.TORP * (p.sight || 1), r2 = rt * rt, seen = false, sd = 1e9;
        for (j = 0; j < ships.length; j++) { var s = ships[j]; if (s.nation === nation && usableShip(s)) { var q2 = WW.dist2(s.x, s.z, p.x, p.z); if (q2 < r2) { seen = true; if (q2 < sd) sd = q2; } } }
        if (!seen) continue;
        e = { proj: p, firstSeenAt: now }; T.push(e);
        if (WW.dstat) { WW.dstat('torpSeenN', p.nation); WW.dstat('torpSeenD', p.nation, Math.sqrt(sd)); }
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
    typeOf: function (c) { return c ? c.reportedType || (c.unit && c.unit.type) : null; },   // the type the side believes (misidentification)
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
