// fleet_cmd.js - WW.fleetCmd: one commander per side, ticked every TICK s of sim time (the sides staggered by
// half a tick). It reads only what its side knows (WW.intel) and writes a blackboard that ships and planes read:
// posture, doctrine, axis of advance, groups and stations (fleet_groups.js), focus targets with the expected
// incoming fire on each, strike orders per carrier, an air-raid flag and scout search sectors. Each tick also
// rebuilds the side's danger field (WW.threat.build). Never throws into the sim: the tick is wrapped.
// Blackboard fields: see docs/ARCHITECTURE.md "fleet_cmd.js".
window.WW = window.WW || {};
(function () {
  'use strict';
  var TICK = 2;
  var NATIONS = ['USN', 'IJN'];
  var POWER = { carrier: 4, battleship: 5, cruiser: 2.5, destroyer: 1.2, submarine: 0.8, pt: 0.4 }; // known strength per type (x hp share)
  var GUNSHIP = { battleship: 1, cruiser: 1, destroyer: 1 };                                        // a fighting fleet needs one of these fit
  var BREAK = 0.15;    // broken: fit (hp >= CRIP) BB / CA / DD tonnage below this share of the side's starting BB / CA / DD tonnage
  var PURSUE_AGE = 120, PURSUE_STRIKE_R = 2000; // pursuit: strikes on contacts this old, anywhere on the map
  var VALUE = { carrier: 10, battleship: 9, cruiser: 5, destroyer: 2.5, submarine: 2, pt: 1 };      // what a kill is worth
  var ENGAGE_D = 260;   // nearest known enemy closer than this from any own ship: engage, else approach
  var LATE = 0.55;      // share of ROUND_TIMEOUT after which a stronger side presses
  var STRIKE_AGE = 45, STRIKE_R = 650, STRIKE_FAR = 1150; // strike only on contacts this fresh and this close to the carrier
  var RAID_R = 130;     // enemy bombers this close to an own carrier: air raid
  var TTK = 20;         // s: a target whose incoming fire kills it within TTK is saturated (no more shooters)
  var SECT_X = 6, SECT_Z = 4, LOOK_R = 110; // scout sectors; an own unit within LOOK_R of a sector centre has looked
  var HIT = 0.35;       // dps -> expected dps on a target at range
  var DEFEND_R = 280, DEFEND_HELP = 380; // an enemy gun ship this close to an own carrier is the defend target for
                                          // own gun ships within DEFEND_HELP of that carrier (mutual support)
  var sides = {}, stats = { ticks: 0, ms: 0, steps: 0 };

  function newSide(n) {
    var B = { nation: n, t: -1e9, tickT: n === 'USN' ? 0 : TICK / 2, posture: 'search', postureAt: 0, late: false, timeLeft: 0,
      strength: { own: 0, known: 0, ratio: 1 }, fit: 0, hadFit: false, brokenAt: 0, doctrine: WW.fleetGroups.rollDoctrine(n),
      startTons: -1, fitTons: 0, foeSeen: new Map(), foeFit: 0, foeTons: 0, pursueAt: 0,
      axis: { x: 0, z: 0, h: n === 'USN' ? 0 : Math.PI }, enemyCentre: null, searchPoint: { x: 0, z: 0 },
      groups: {}, orders: new Map(), focus: {}, incoming: new Map(), strikes: new Map(), airRaid: null, defend: [], sectors: [] };
    ['main', 'carrier', 'screen', 'flotilla', 'pt', 'sub'].forEach(function (g) { B.groups[g] = { members: [], guide: { x: 0, z: 0 } }; B.focus[g] = []; });
    var W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    for (var j = 0; j < SECT_Z; j++) for (var i = 0; i < SECT_X; i++) B.sectors.push({ x: (i + 0.5) * W / SECT_X, z: (j + 0.5) * H / SECT_Z, looked: 0, stale: 0, prio: 0 });
    return B;
  }
  // Doctrine is rolled at round start with WW.rand (after the fleets spawn), so a seed replays the same round.
  function reset() { sides = {}; for (var i = 0; i < NATIONS.length; i++) sides[NATIONS[i]] = newSide(NATIONS[i]); }

  function gunDps(st, d) {
    var v = 0;
    for (var i = 0; i < st.guns.length; i++) { var g = st.guns[i], sh = WW.SHELL[g.cal]; if (d <= g.range) v += (sh ? sh.dmg : 10) * g.count / g.reload; }
    return v * HIT;
  }

  function tick(B) {
    var now = WW.time.now, ships = WW.world.ships, I = WW.intel, d = B.doctrine, i, s, c;
    B.t = now;
    if (WW.threat) WW.threat.build(B.nation);
    WW.fleetGroups.assign(B, ships);
    // ---- strength and the enemy picture ----
    var own = 0, known = 0, cs = I ? I.enemyShips(B.nation) : [], ex = 0, ez = 0, ew = 0, dmin = 1e9;
    for (i = 0; i < ships.length; i++) { s = ships[i]; if (s.alive && s.nation === B.nation) own += POWER[s.type] * (0.3 + 0.7 * s.hp / s.maxHp); }
    for (i = 0; i < cs.length; i++) {
      c = cs[i]; var u = c.unit; if (!u || !u.alive) continue;
      var age = now - c.seenAt, w = Math.max(0.3, 1 - age / 90);
      known += (u.isBase ? u.power : POWER[u.type]) * (0.3 + 0.7 * u.hp / u.maxHp) * w; // island_base.js: base.power
      ex += c.x * w; ez += c.z * w; ew += w;
      for (var j = 0; j < ships.length; j++) { s = ships[j]; if (s.alive && s.nation === B.nation && s.type !== 'submarine') dmin = Math.min(dmin, WW.dist(s.x, s.z, c.x, c.z)); }
    }
    B.strength.own = own; B.strength.known = known; B.strength.ratio = own / Math.max(known, 0.3 * own, 0.1);
    B.enemyCentre = ew ? { x: ex / ew, z: ez / ew } : null;
    // ---- posture ----
    var T = WW.cfg.ROUND_TIMEOUT, rt = WW.game ? WW.game.roundTime : 0, prev = B.posture;
    B.timeLeft = T - rt; B.late = rt > T * LATE;
    // Broken: the fit battleship / cruiser / destroyer tonnage (hp >= CRIP) is below BREAK of what the side started
    // with. The side breaks off for home whatever the (fogged) strength ratio says (ai_endgame.js); main.js ends the
    // round when its ships have left the map ("retires") or are all sunk.
    var fit = 0, fitT = 0, allT = 0, crip = WW.fleetGroups.CRIP;
    for (i = 0; i < ships.length; i++) {
      s = ships[i]; if (!s.alive || s.sinking || s.nation !== B.nation || !GUNSHIP[s.type]) continue;
      allT += s.stats.tons; if (s.hp >= crip * s.maxHp) { fit++; fitT += s.stats.tons; }
    }
    if (B.startTons < 0) B.startTons = allT;  // first tick: the side's starting surface combatants
    B.fit = fit; B.fitTons = fitT; if (fit) B.hadFit = true;   // a side that never had gun ships (a PT / sub raid) never "breaks"
    if (B.hadFit && !B.brokenAt && fitT < BREAK * B.startTons) B.brokenAt = now;
    // Pursue a broken enemy; when both sides are broken, the side with the larger fit share (its own true one against
    // the enemy's as seen) turns to hunt instead of running.
    var pursue = foeBroken(B, cs, now) && (!B.brokenAt || fitT / Math.max(1, B.startTons) > B.foeFit / Math.max(1, B.foeTons));
    if (pursue && !B.pursueAt) B.pursueAt = now;
    if (rt > 60 && B.brokenAt && !pursue) B.posture = 'withdraw';
    else if (pursue) B.posture = 'pursue';
    else if (!cs.length) B.posture = 'search';
    else if (rt > 60 && B.strength.ratio < d.withdrawRatio) B.posture = 'withdraw';
    else if (B.late && B.strength.ratio >= d.pressRatio * (1.15 - 0.3 * d.aggression) * (WW.nightOps ? WW.nightOps.pressK(B) : 1)) B.posture = 'press'; // night_ops: readier after dark
    else B.posture = dmin < ENGAGE_D ? 'engage' : 'approach';
    if (B.posture !== prev) B.postureAt = now;
    // ---- axis of advance: toward the enemy's last-known centre, else the search point ----
    sectors(B, now);
    var tgt = B.enemyCentre || B.searchPoint;
    WW.fleetGroups.stations(B); // sets B.axis.x/z (main guide); uses last tick's axis heading
    B.axis.h = Math.atan2(tgt.z - B.axis.z, tgt.x - B.axis.x);
    WW.fleetGroups.stations(B);
    if (WW.fleetSearch) WW.fleetSearch.tick(B, cs, now); // long search, PT pair spots, PT deep runs (fleet_search.js)
    // ---- incoming fire, focus targets, strikes, air raid ----
    B.incoming.clear();
    for (i = 0; i < ships.length; i++) {
      s = ships[i]; var t = s.target;
      if (!s.alive || s.nation !== B.nation || !t || !t.alive) continue;
      B.incoming.set(t, (B.incoming.get(t) || 0) + gunDps(s.stats, WW.dist(s.x, s.z, t.x, t.z)));
    }
    defend(B, cs, now);
    focus(B, cs, now);
    strikes(B, cs, now);
    B.objective = WW.baseAI ? WW.baseAI.objective(B) : null; // the fight for the island (base_ai.js)
    B.airRaid = null;
    var pl = I ? I.enemyPlanes(B.nation) : [];
    for (i = 0; i < pl.length; i++) {
      var p = pl[i].unit; if (!p || !p.alive || (p.kind !== 'dive' && p.kind !== 'torpedo')) continue;
      for (j = 0; j < B.groups.carrier.members.length; j++) {
        s = B.groups.carrier.members[j];
        if (s.type === 'carrier' && WW.dist(s.x, s.z, pl[i].x, pl[i].z) < RAID_R) { B.airRaid = B.airRaid || { carrier: s, n: 0 }; B.airRaid.n++; }
      }
    }
  }

  // Pursuit (fog of war): every enemy gun ship the side has seen this round is remembered; the enemy is judged
  // broken when the fit (hp >= CRIP) tonnage among those still afloat is below BREAK of all of them, the same
  // rule the enemy's own commander uses (on its true starting tonnage).
  function foeBroken(B, cs, now) {
    for (var i = 0; i < cs.length; i++) { var u = cs[i].unit; if (u && GUNSHIP[u.type] && !B.foeSeen.has(u.id)) B.foeSeen.set(u.id, u); }
    var all = 0, fitT = 0, crip = WW.fleetGroups.CRIP;
    B.foeSeen.forEach(function (u) { all += u.stats.tons; if (u.alive && !u.sinking && !u.escaped && u.hp >= crip * u.maxHp) fitT += u.stats.tons; });
    B.foeTons = all; B.foeFit = fitT;
    if (!WW.game || WW.game.roundTime <= 60) return false;
    // latched: once pursuing, a side keeps at it with no contact while the enemy still has a seen gun ship or a known
    // carrier afloat (the strike range, the escape-route search and the run for the enemy's edge stay on)
    if (B.pursueAt && !cs.length) { var any = false; B.foeSeen.forEach(function (u) { if (u.alive && !u.escaped) any = true; }); return any || foeCarrier(B); }
    if (!cs.length) return false;
    if (all === 0) { // an enemy with no gun ships at all (carriers only): its carriers are unescorted, fit gun ships hunt them
      if (!B.fit) return false;
      for (var k = 0; k < cs.length; k++) if (cs[k].unit && cs[k].unit.type === 'carrier' && cs[k].unit.alive) return true;
      return false;
    }
    return fitT < BREAK * all;
  }
  function foeCarrier(B) { var S = WW.world.ships; for (var i = 0; i < S.length; i++) if (S[i].alive && S[i].type === 'carrier' && S[i].nation !== B.nation && WW.intel && WW.intel.known(B.nation, S[i])) return true; return false; }
  // Carrier defence: each own carrier's nearest known enemy gun ship inside DEFEND_R (seen in the last 30 s).
  function defend(B, cs, now) {
    B.defend.length = 0;
    var cvs = B.groups.carrier.members;
    for (var k = 0; k < cvs.length; k++) {
      var cv = cvs[k], e = null, ed = DEFEND_R; if (cv.type !== 'carrier') continue;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i], u = c.unit;
        if (!u || !u.alive || u.submerged || !u.stats.guns.length || u.type === 'carrier' || u.isBase || now - c.seenAt > 30) continue; // an island cannot close on a carrier
        var d = WW.dist(cv.x, cv.z, c.x, c.z); if (d < ed) { ed = d; e = u; }
      }
      if (e) B.defend.push({ carrier: cv, enemy: e, d: ed });
    }
  }
  // Focus: per gun group, the 1-2 best visible targets from the group's guide (value x damage x proximity).
  var GROUP_W = { main: { battleship: 1.2, cruiser: 1, carrier: 1, destroyer: 0.4 }, carrier: { destroyer: 1, pt: 1, cruiser: 0.6 },
    screen: { submarine: 2, pt: 1.4, destroyer: 1.1, cruiser: 0.4 }, flotilla: { battleship: 1, carrier: 1, cruiser: 0.8, destroyer: 0.6 } };
  function focus(B, cs, now) {
    var FRESH = WW.intel ? WW.intel.T.FRESH : 3;
    for (var g in GROUP_W) {
      var F = B.focus[g], gd = B.groups[g].guide, W = GROUP_W[g], a = null, as = 0, b = null, bs = 0;
      F.length = 0;
      if (!B.groups[g].members.length) continue;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i], u = c.unit;
        if (!u || !u.alive || now - c.seenAt > FRESH || (u.submerged && g !== 'screen')) continue;
        var sc = (W[u.type] || 0) * VALUE[u.type] * (1.8 - u.hp / u.maxHp) / (1 + WW.dist(gd.x, gd.z, c.x, c.z) / 150) * (WW.admirals ? WW.admirals.targetK(u) : 1); // the enemy flagship: a modest bump
        if (sc > as) { b = a; bs = as; a = u; as = sc; } else if (sc > bs) { b = u; bs = sc; }
      }
      if (g === 'carrier' && B.defend.length) { F.push(B.defend[0].enemy); continue; }
      if (a) F.push(a);
      if (b && bs > as * 0.6) F.push(b);
    }
  }
  // Strike orders: per carrier, the best detected / last-known target within STRIKE_R (value, freshness,
  // distance, AA around it). No contact in range: no order (a strike needs a reason).
  var STRIKE_V = { carrier: 12, battleship: 9, cruiser: 5, destroyer: 2, submarine: 1, pt: 0.5 }; // a surfaced sub is worth a strike
  function strikes(B, cs, now) {
    B.strikes.clear();
    var cvs = B.groups.carrier.members, pur = B.posture === 'pursue', AGE = pur ? PURSUE_AGE : STRIKE_AGE, RANGE = pur ? PURSUE_STRIKE_R : STRIKE_R * (B.doctrine.strikeRange || 1); // strikeRange: the admiral (admirals.js)
    for (var k = 0; k < cvs.length; k++) {
      var cv = cvs[k]; if (cv.type !== 'carrier') continue;
      var best = null, bc = null, bs = 0;
      // within STRIKE_R first; with nothing there, anything known on the map (the planes have the fuel for it)
      for (var pass = 0; pass < 2 && !best; pass++) for (var i = 0; i < cs.length; i++) {
        var c = cs[i], u = c.unit, age = now - c.seenAt;
        if (!u || !u.alive || u.submerged || age > AGE) continue;
        var dd = WW.dist(cv.x, cv.z, c.x, c.z); if (dd > (pass ? Math.max(STRIKE_FAR, RANGE) : RANGE)) continue;
        var aa = WW.threat ? WW.threat.danger(B.nation, c.x, c.z, { air: true }) : 0;
        var dfd = B.defend.some(function (q) { return q.carrier === cv && q.enemy === u; }) ? 3 : 1; // self-defence first
        var sv = u.isBase ? (WW.baseAI ? WW.baseAI.strikeValue(B, cv) : 0) : STRIKE_V[WW.intel.typeOf ? WW.intel.typeOf(c) : u.type] || 0; // the island base (base_ai.js)
        if (!sv) continue;
        var sc = dfd * Math.max(sv, dfd > 1 ? 4 : 0) * (1.6 - 0.6 * u.hp / u.maxHp) * (1 - age / (AGE * 1.5)) / (1 + dd / (pur ? 1200 : 400)) / (1 + aa / 40); // pursuit: distance matters less (the far carrier before the near cripple)
        if (pur) sc *= runaway(B, u, c);
        if (WW.admirals) sc *= WW.admirals.targetK(u);
        if (sc > bs) { bs = sc; best = u; bc = c; }
      }
      if (best) B.strikes.set(cv.id, { target: best, contact: bc, score: bs, hold: !!(B.airRaid && B.airRaid.carrier === cv) });
    }
  }
  // Pursuit division of labour: the gun ships run down the slow cripples near them; the strikes go for what they
  // cannot catch, a ship at speed (speedK >= 0.75) with no own gun ship within 150 of its last-known position.
  function runaway(B, u, c) {
    if (WW.endgameAI && WW.endgameAI.isCripple(u)) return 1;
    var ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (s.alive && s.nation === B.nation && GUNSHIP[s.type] && WW.dist2(s.x, s.z, c.x, c.z) < 150 * 150) return 1;
    }
    return 2.5;
  }
  // Scout sectors: how long since an own ship / plane looked there, plus stale contacts; the best one is the
  // search point while nothing is known.
  function sectors(B, now) {
    var S = B.sectors, ships = WW.world.ships, planes = WW.world.planes, own = [], i, k, W = WW.cfg.MAP_W;
    for (i = 0; i < ships.length; i++) if (ships[i].alive && ships[i].nation === B.nation) own.push(ships[i]);
    for (i = 0; i < planes.length; i++) if (planes[i].alive && planes[i].nation === B.nation) own.push(planes[i]);
    var cs = WW.intel ? WW.intel.enemyShips(B.nation) : [], enemyHalfEast = B.nation === 'USN';
    var best = null;
    // the enemy's half first; after a long fruitless search (fleet_search.js searchFor) it may be anywhere, even
    // behind us (two lone searchers sweeping each other's halves pass in the night)
    var eh = 60 * WW.clamp(1 - ((B.searchFor || 0) - 60) / 60, 0, 1);
    for (k = 0; k < S.length; k++) {
      var sc = S[k];
      for (i = 0; i < own.length; i++) if (WW.dist2(own[i].x, own[i].z, sc.x, sc.z) < LOOK_R * LOOK_R) { sc.looked = now; break; }
      sc.stale = 0;
      for (i = 0; i < cs.length; i++) if (now - cs[i].seenAt > 20 && Math.abs(cs[i].x - sc.x) < W / SECT_X / 2 && Math.abs(cs[i].z - sc.z) < WW.cfg.MAP_H / SECT_Z / 2) sc.stale++;
      sc.prio = Math.min(120, now - sc.looked) + ((sc.x > W / 2) === enemyHalfEast ? eh : 0) + 80 * Math.min(1, sc.stale);
      // pursuit: the enemy's escape route, the band in front of its home edge
      if (B.posture === 'pursue' && Math.abs(sc.x - (enemyHalfEast ? W : 0)) < W * 0.42) sc.prio += 70;
      if (!best || sc.prio > best.prio) best = sc;
    }
    // while searching: the nearest of the high-priority enemy-half sectors to the main body
    var g = B.axis, bp = null, bd = 1e9;
    for (k = 0; k < S.length; k++) if (S[k].prio >= best.prio - 30) { var dd = WW.dist(g.x, g.z, S[k].x, S[k].z); if (dd < bd) { bd = dd; bp = S[k]; } }
    B.searchPoint.x = bp.x; B.searchPoint.z = bp.z;
    if (B.barrier) { B.searchPoint.x = B.barrier.x; B.searchPoint.z = B.barrier.z; } // long search: barrier patrol (fleet_search.js)
  }

  function update(dt) {
    if (!WW.game || WW.game.state !== 'battle') return;
    var t0 = performance.now();
    stats.steps++;
    for (var i = 0; i < NATIONS.length; i++) {
      var B = sides[NATIONS[i]];
      B.tickT -= dt;
      if (B.tickT > 0) continue;
      B.tickT += TICK; if (B.tickT <= 0) B.tickT = TICK;
      var Adm = WW.admirals;
      try { if (Adm && Adm.before(B)) continue; } catch (e) { console.error('admirals', e); } // flagship lost: confusion, no tick
      try { tick(B); stats.ticks++; } catch (e) { console.error('fleetCmd', e); }
      try { if (Adm) Adm.after(B); } catch (e) { console.error('admirals', e); }
    }
    stats.ms += performance.now() - t0;
  }

  reset();
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);

  function side(n) { return sides[n] || null; }
  function order(ship) { var B = sides[ship.nation]; return (B && B.orders.get(ship.id)) || null; }
  WW.fleetCmd = {
    TICK: TICK, VALUE: VALUE, stats: stats, update: update, reset: reset,
    side: side, order: order,
    doctrine: function (n) { var B = sides[n]; return B ? B.doctrine : null; },
    focusFor: function (ship) { var o = order(ship), B = sides[ship.nation]; return o && B ? B.focus[o.group] || [] : []; },
    incoming: function (nation, target) { var B = sides[nation]; return (B && B.incoming.get(target)) || 0; },
    // target-score factor from the commander: an enemy gun ship near an own carrier x2.5 for ships near that
    // carrier; a focus target x1.35; a saturated one (its incoming fire kills it
    // within TTK s, not counting this shooter's own share) x0.6; else 1
    assignment: function (ship, target) {
      var B = sides[ship.nation]; if (!B) return 1;
      var bf = (WW.baseAI && WW.baseAI.assign(ship, target)) || 1; // x an enemy at the own island base (base_ai.js)
      for (var i = 0; i < B.defend.length; i++) {
        var q = B.defend[i];
        if (q.enemy === target && ship !== q.carrier && WW.dist(ship.x, ship.z, q.carrier.x, q.carrier.z) < DEFEND_HELP) return 2.5 * bf; // protect the carrier
      }
      var inc = B.incoming.get(target) || 0;
      if (ship.target === target) inc -= gunDps(ship.stats, WW.dist(ship.x, ship.z, target.x, target.z));
      if (inc * TTK > target.hp * 1.1) return 0.6 * bf;
      var F = this.focusFor(ship);
      return (F.indexOf(target) >= 0 ? 1.35 : 1) * bf;
    },
    // the strike decision for a carrier: { target, contact, score, hold } or null (ai_carrier.js / air ops)
    strikeOrder: function (cv) { var B = sides[cv.nation]; return (B && B.strikes.get(cv.id)) || null; },
    // best search point for a scout / searching ship near (x, z): high priority, not too far
    scoutPoint: function (nation, x, z) {
      var B = sides[nation]; if (!B) return null;
      var best = null, bs = -1e9;
      for (var k = 0; k < B.sectors.length; k++) { var s = B.sectors[k], v = s.prio - WW.dist(x, z, s.x, s.z) / 6; if (v > bs) { bs = v; best = s; } }
      return best ? { x: best.x, z: best.z } : null;
    }
  };
})();
