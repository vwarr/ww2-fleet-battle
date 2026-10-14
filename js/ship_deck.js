// ship_deck.js - WW.shipDeck: the flight-deck mission kill (sim code: WW.rand only). Load after ship_fires.js.
// A bomb through a carrier's flight deck could end her part in the battle without sinking her: the hole, the bulged
// planking and a jammed elevator left her unable to launch or recover until the deck was patched.
//  - Yorktown at Coral Sea: one bomb through the deck, she kept operating. At Midway: three bombs, the deck patched
//    and launching again in about 70 minutes. Enterprise at Eastern Solomons: three bombs, patched in about an hour
//    (her planes went to Henderson Field meanwhile); at Santa Cruz the forward elevator jammed.
//  - Shokaku at Coral Sea and Santa Cruz: three to six bombs, the flight deck wrecked, out of the battle (and of the
//    war for months), but afloat. USN damage control patched decks far faster than the IJN.
//  - A deck-load / hangar explosion (ship_fires.js deckHit: Akagi, Kaga, Soryu) wrecks the deck for the round.
// A bomb on a carrier (ship_fires.js hit) puts the deck out with chance OUT_P0 x size^2 + OUT_P1 per earlier deck
// hit (size: the bomb's damage / WW.BOMB.dmg; a crashing plane is small). Out for OUT_T s / doctrine.damageControl
// (USN 1.5: 40-67 s, IJN 1: 60-100 s; 1 sim s is about half a minute), each hit while out adds OUT_ADD; from the third hit on she may be out for
// good (PERM_P per hit past the second / damageControl). The repair clock runs at half speed while 3 or more fires burn.
// While out (cv.deckOut = { until, perm, hits, t0 }): no launches (air_boss.js, ai_carrier.js), no recoveries
// (air_deck.js holds the deck; air_recovery.js waves off a plane in the groove). Planes coming home hold in the
// stack when they have the fuel to wait (HOLD_S when another deck is open); otherwise they divert to another deck of
// the side or ditch by a friendly ship (air_flight.js orphan / ditchBy). Events: 'deckOut' { ship, until, perm,
// hits, x, z }, 'deckBack' { ship, out }. Also the hangar load (hangarLoad): bombers being armed and fuelled below
// for a strike about to go (Akagi at Midway: the strike re-arming in the hangar when Best's bomb hit).
// Out for good (wrecked(cv): Shokaku at Coral Sea, sent home; Akagi, Hiryu, scuttled): the planes waiting below are struck
// down into the hangar and the launch queue goes (they are hangar planes now: nothing waits to launch); her planes in
// the air go to another open deck of the side at once (in fuel reach: a searcher or strike plane in flight is re-homed
// before it turns for home), and one on its way home diverts or ditches wherever it is, not only once over her. The AI
// reads wrecked(): no air cover, no air-war hold, no strike orders, a withdraw role (fleet_cmd.js, fleet_groups.js);
// she makes for her home edge with an escort (ai_carrier.js, fleet_groups.js); to the enemy a high-value hull to
// finish, but no air threat (fleet_cmd.js strike value, air_staff.js bare, ai_endgame.js fair game).
// Fog of war: the enemy reads only knownWrecked(nation, cv): a wrecked deck is seen by the attacker's planes over her,
// the strike that wrecked it (the bomb's side), or a later plane of that side within SEE_R (intel R.AIR, a plane's
// sight of ships) that sees her flight deck still holed; the report holds KNOW_T s (intel SHIP_TTL) from the last
// sighting. Her own side reads wrecked().
window.WW = window.WW || {};
(function () {
  'use strict';
  var OUT_P0 = 0.4, OUT_P1 = 0.25, OUT_MAX = 0.95, OUT_T = [60, 100], OUT_ADD = 0.5, PERM_P = 0.25;
  var HOLD_S = 45, HOLD_FUEL = 25, HOME_R = 150;   // a plane home (HOME_R) holds with HOLD_FUEL s of fuel to spare for a
  // deck back within HOLD_S s (longer when no other deck of the side is open); else it diverts or ditches
  var BOOM_PERM = 6, BOOM_T = 2;       // a deck-load explosion: this big a load wrecks the deck for the round, a smaller one BOOM_T x as long
  var SEE_R = (WW.intel && WW.intel.R.AIR) || 100, KNOW_T = (WW.intel && WW.intel.T.SHIP_TTL) || 180;
  var stats = null, tick = 0, seen = {};   // seen[nation]: Map(enemy carrier -> when its planes last saw her deck wrecked)
  function per() { return WW.perSide(0); }
  function reset() { tick = 0; seen = {}; stats = { out: per(), perm: per(), back: per(), outS: per(), held: 0, diverted: 0, ditched: 0, hangarBooms: per(), struck: 0, rehomed: 0 }; S.stats = stats; }
  function dcOf(s) { var d = WW.fleetCmd && WW.fleetCmd.doctrine(s.nation); return d && d.damageControl > 0 ? d.damageControl : 1; }
  function out(cv) { return !!(cv && cv.deckOut); }
  function wrecked(cv) { return !!(cv && cv.deckOut && cv.deckOut.perm); }   // out for good
  function saw(n, cv) { (seen[n] || (seen[n] = new Map())).set(cv, WW.time.now); }
  // what side n knows: its own carriers as they are, an enemy's as its planes last saw her (within KNOW_T s)
  function knownWrecked(n, cv) {
    if (!cv) return false;
    if (cv.nation === n) return wrecked(cv);
    var m = seen[n], t = m && m.get(cv);
    return t !== undefined && WW.time.now - t <= KNOW_T;
  }

  // Bombers being armed and fuelled below: while a strike is ordered (the next deck load readied as the first is
  // spotted: the bombers in the hangar not already in the launch queue, which the deck load counts), or while the
  // reserve is re-armed for the targets at hand (air_boss.js: Nagumo's torpedo / bomb swap). Weighted
  // (ship_fires.js HANGAR_K) in the deck-load hazard (deckHit).
  function hangarLoad(cv) {
    var a = cv.ai, h = cv.hangar; if (!a || !h || cv.isBase) return 0;
    var now = WW.time.now, q = a.queue || [], queued = 0, strike = false;
    for (var i = 0; i < q.length; i++) if (q[i].target) { strike = true; if (q[i].kind !== 'fighter') queued++; }
    var arming = (strike && !cv.deckOut) || (cv.deckRearmUntil || 0) > now || (a.rsv && a.rsv.rearmT > now);
    return arming ? Math.max(0, (h.dive || 0) + (h.torpedo || 0) - queued) : 0;
  }
  // the hangar's armed bombers go up with it: returns how many were lost
  function hangarBoom(cv) {
    var h = cv.hangar, n = (h.dive || 0) + (h.torpedo || 0); h.dive = 0; h.torpedo = 0;
    stats.hangarBooms[cv.nation]++;
    return n;
  }

  // A bomb hit on a carrier (ship_fires.js hit, after the deck-load hazard; boom: the load that went up, else 0)
  function bombHit(cv, amount, x, z, boom) {
    if (!cv.alive || cv.isBase || !cv.hangar) return;
    var dc = dcOf(cv), D = cv.deckOut, hits = (cv.deckHits || 0) + 1, size = Math.min(1.4, amount / (((WW.BOMB && WW.BOMB.dmg) || 180) * 0.75));   // a Val's 250 kg = 1 (it holed Yorktown's and Enterprise's decks), an SBD's 1,000 lb ~1.33
    cv.deckHits = hits;
    if (D && D.perm) return;
    var p = boom ? 1 : Math.min(OUT_MAX, OUT_P0 * size * size + OUT_P1 * (hits - 1));
    if (!boom && WW.rand() >= p) return;
    var now = WW.time.now, t = WW.randRange(OUT_T[0], OUT_T[1]) / dc * (boom ? BOOM_T : 1);
    var perm = boom >= BOOM_PERM || (hits > 2 && WW.rand() < PERM_P * (hits - 2) / dc);
    if (D) { D.until = Math.max(D.until, now) + t * OUT_ADD; D.perm = perm; D.hits++; }
    else { D = cv.deckOut = { until: now + t, perm: perm, hits: 1, t0: now }; stats.out[cv.nation]++; }
    if (perm) stats.perm[cv.nation]++;
    WW.emit('deckOut', { ship: cv, until: D.until, perm: D.perm, hits: D.hits, x: x, z: z, boom: !!boom });
    hold(cv);
    if (perm) { strikeBelow(cv); saw(WW.enemyOf(cv.nation), cv); }   // the strike that did it saw it
  }
  // the deck shut: planes queued below stay there (air_deck.js holds them), the boss stops ordering
  function hold(cv) { if (cv.ai) cv.ai.launchT = Math.max(cv.ai.launchT || 0, 1); }
  // out for good: the planes waiting below or spotted go back into the hangar (as daylight.js strikes them below at
  // dusk), the launch queue is dropped
  var BELOW = { queued: 1, rise: 1, taxi: 1, hold: 1 };
  function strikeBelow(cv) {
    var D = cv._deck, h = cv.hangar;
    if (D) for (var i = 0; i < D.launchers.length; i++) {
      var p = D.launchers[i];
      if (!p.alive || p.removed || p.state !== 'takeoff' || !BELOW[p.deckPh]) continue;
      h[p.kind] = (h[p.kind] || 0) + 1; p.alive = false; p.remove(); stats.struck++;
    }
    if (cv.ai && cv.ai.queue) cv.ai.queue.length = 0;
  }

  // another open deck of the side
  function otherDeck(p) {
    var ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) { var s = ships[i]; if (s !== p.carrier && s.alive && !s.sinking && !s.isBase && s.type === 'carrier' && s.hangar && s.nation === p.nation && !s.deckOut) return true; }
    return false;
  }
  // an enemy plane within SEE_R sees her deck still wrecked (scouts, searchers, strikes, fighters alike)
  function sight(s) {
    var P = WW.world.planes, n = WW.enemyOf(s.nation);
    for (var i = 0; i < P.length; i++) { var p = P[i]; if (p.alive && !p.removed && p.nation === n && p.state !== 'takeoff' && WW.dist2(p.x, p.z, s.x, s.z) < SEE_R * SEE_R) { saw(n, s); return; } }
  }
  // once a second: the repair clock, and the planes coming home to a shut deck
  function second() {
    var now = WW.time.now, ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i], D = s.deckOut; if (!D) continue;
      if (!s.alive) continue;
      stats.outS[s.nation]++;
      if (D.perm) { if (s.ai && s.ai.queue && s.ai.queue.length) strikeBelow(s); sight(s); continue; }
      if ((s.fireN || 0) >= 3) D.until += 0.5;   // half the parties are fighting the fires
      if (now >= D.until) { s.deckOut = null; stats.back[s.nation]++; WW.emit('deckBack', { ship: s, out: now - D.t0 }); }
    }
    var planes = WW.world.planes, F = WW.airFlight;
    if (!F) return;
    for (var j = 0; j < planes.length; j++) {
      var p = planes[j], c = p.carrier;
      // (a scout floatplane alights beside its cruiser or battleship: no flight deck to lose)
      if (!p.alive || p.removed || !c || !c.deckOut || !c.alive || p.ditchTo || p.kind === 'flyingboat' || p.kind === 'scout') continue;
      var perm = c.deckOut.perm, home = p.state === 'return' || p.state === 'landing';
      // out for good: a plane still out on its sortie (a searcher, a strike, the CAP) takes another open deck in reach now
      if (perm && (p.state === 'transit' || p.state === 'attack')) { var b = F.nearestDeck(p); if (b) { p._deckOutDiv = true; F.divertTo(p, b); stats.rehomed++; } continue; }
      // decided on arrival: in the stack, or on the way home within HOME_R (out for good: anywhere on the way home)
      if (!home || (p.state === 'landing' ? p.deckPh === 'final' || p.deckPh === 'trap' : !perm && WW.dist2(p.x, p.z, c.x, c.z) >= HOME_R * HOME_R)) continue;
      var left = c.deckOut.perm ? Infinity : c.deckOut.until - now;
      if (p.fuel > left + HOLD_FUEL && (left < HOLD_S || !otherDeck(p))) { if (!p._deckHeld) { p._deckHeld = true; stats.held++; } continue; }
      p._deckOutDiv = true;
      var was = p.carrier;
      F.orphan(p); p.mTrack = undefined;
      if (p.ditchTo) stats.ditched++; else if (p.carrier !== was) stats.diverted++;
    }
  }
  function update(dt) {
    if (!(WW.game && WW.game.state === 'battle')) return;
    tick -= dt;
    if (tick > 0) return;
    tick += 1;
    try { second(); } catch (e) { console.error('shipDeck', e); }
  }

  var S = WW.shipDeck = { bombHit: bombHit, hangarLoad: hangarLoad, hangarBoom: hangarBoom, out: out, wrecked: wrecked, knownWrecked: knownWrecked, update: update, stats: null };
  // run with the fires' second (main.js calls WW.shipFires.update)
  if (WW.shipFires) { var u0 = WW.shipFires.update; WW.shipFires.update = function (dt) { u0(dt); update(dt); }; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  reset();
})();
