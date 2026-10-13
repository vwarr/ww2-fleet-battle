// night_plan.js - WW.nightPlan: what each side does with a night (1942). Sim code, no dice (the director's hook at the
// bottom is visual and uses Math.random, as camera.js does). Hooks: fleet_cmd.js (tick), fleet_groups.js
// (the carriers' station), air_deck.js (counts: the deck park), endgame.js (nightDead: a pre-dawn round), daylight.js
// (a night with no surface action in it is rolled as a pre-dawn round).
// History: carriers did not fly strikes at night, and kept clear of enemy surface forces after dark (Spruance turned
// east the night of 4 June 1942 so as not to blunder into a night action; Nagumo and Yamamoto hoped for one). The
// night belonged to the surface forces: Savo Island, Cape Esperance, the two battles of Guadalcanal, Tassafaronga.
// IJN night-fighting doctrine sought it (Long Lance torpedoes, night optics, cruiser floatplanes dropping flares over
// the enemy at Savo); the USN, with radar from late 1942, accepted it. At first light the carriers launched their
// dawn searches and strikes, the deck load spotted in the dark before it.
//  - Night orders (tick, each commander tick): dark now and for NIGHT_AHEAD s more (a pre-dawn round gives them up as
//    the light comes). B.nightMode: 'seek' (doctrine.night >= SEEK_NIGHT: the side goes for a night action with its
//    surface force, on its known contacts: no air-war hold after dark (fleet_cmd.js airWar), night_ops.js closes the
//    range and stretches the torpedo reach; and the flares below), 'accept' (a surface force that fights when found,
//    the USN's radar-led line), 'stand' (carriers and their screens alone). An 'admiralOrder' (order 'night') says so
//    once per change. (A/B, 10 forced-night battle_line seeds: pressing at once on contact as well (fleet_cmd lateNow)
//    turned IJN 8-2 into 5-5: the press posture's close range threw away the IJN's torpedo reach; left out.)
//  - Carriers (cvOpen, fleet_groups.js stations): after dark the carrier group's station is in CV_BAND (nearer its own
//    edge than the day band) and keeps CV_OPEN_K x gun range from every known enemy gun ship: the carriers open the
//    range from the night fight. (ai_carrier.js still runs from a gun ship that closes; the CAP has landed at dusk.)
//  - The deck (stowed, air_deck.js counts): from dark until SPOT_AHEAD s before flying light the planes are struck
//    below, the flight deck bare; then the dawn load is spotted, one plane up the elevator at a time.
//  - Flares (IJN, FLARE): a cruiser or battleship's floatplane, sent off before the action, drops parachute flares over a
//    fresh enemy contact FL.MIN..FL.R from its ship, FL.BEHIND beyond it (the target in silhouette; never over own
//    ships), at most FL.PER per plane, FL.MAX burning per side. The flare is a night_ops.js shell (sh.flare): it lights
//    the sea round it as a star shell does, higher and longer. The plane itself
//    is not drawn or flown (no launches in the dark, daylight.js).
//  - Camera (WW.camHooks): in the dark, the leading ship of a surface force closing on the enemy (its known centre, else
//    the search point) is a better quiet shot than a carrier waiting for the dawn (a forced-night survey filmed the
//    carriers ~50% of the first 300 s, before any contact).
// Events: 'nightPlan' { nation, what }, 'flare' (the shell), 'admiralOrder' order 'night'.
window.WW = window.WW || {};
(function () {
  'use strict';
  var NIGHT_AHEAD = 60, SPOT_AHEAD = 100, SEEK_NIGHT = 0.5,
      CV_OPEN_K = 3.2, CV_BAND = [0.08, 0.2],                   // the day's band: fleet_groups.js CV_LO..CV_HI (0.2..0.33)
      FLARE = { IJN: 1 },
      FL = { R: 260, MIN: 40, AGE: 8, PER: 3, CD: 30, MAX: 2, H: 72, DELAY: 4, LIFE: 40, BEHIND: 30 };
  var Q = typeof location !== 'undefined' ? location.search : '';   // A/B: ?noflares, ?noseek (no 'seek' orders), ?nocvopen (tests)
  if (/[?&]noflares/.test(Q)) FLARE = {};
  var SEEK_ON = !/[?&]noseek/.test(Q), CVOPEN_ON = !/[?&]nocvopen/.test(Q);
  var GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, FLEET = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 };
  var stats = { modes: {}, flares: { USN: 0, IJN: 0 } };
  var left = new Map(), nextFl = new Map();

  function D() { return WW.dayNight; }
  // dark now and still dark NIGHT_AHEAD s on
  function night() { var d = D(); return !!d && !d.canFly() && d.level(d.roundT() + NIGHT_AHEAD) < d.FLY_MIN; }
  // the deck struck below: dark, and flying light more than SPOT_AHEAD s away
  function stowed(c) { var d = D(); return !!d && !!WW.game && WW.game.state === 'battle' && !d.canFly() && d.level(d.roundT() + SPOT_AHEAD) < d.FLY_MIN; }
  function fit(s) { return s.alive && !s.sinking && !s.escaped && s.hp >= WW.fleetGroups.CRIP * s.maxHp; }
  // a surface force: fit gun ships in the main body, screen or flotilla (not the carriers' ring escorts)
  function force(B) {
    var G = B.groups, k = 0;
    ['main', 'screen', 'flotilla'].forEach(function (g) { G[g].members.forEach(function (q) { var o = B.orders.get(q.id); if (GUN[q.type] && fit(q) && (!o || o.role !== 'withdraw')) k++; }); });
    return k;
  }
  function hasCV(B) { return B.groups.carrier.members.some(function (q) { return q.type === 'carrier' && q.alive && !q.sinking; }); }
  // a side seeking a night action (the director, tests)
  function seeks(B) { return SEEK_ON && night() && B.doctrine.night >= SEEK_NIGHT && force(B) > 0 && B.posture !== 'withdraw'; }
  // fleet_groups.js stations: the carriers' night station
  function cvOpen(B) { return CVOPEN_ON && night() && B.posture !== 'withdraw' && hasCV(B); }

  var TEXT = { seek: 'night action: the surface force seeks the enemy', accept: 'surface force to engage by night', stand: 'no action in the dark: the fleet waits for the dawn',
    open: 'carriers open the range for the night', dawn: 'dawn search and strike: the deck load is spotted' };
  function say(B, what) {
    WW.emit('nightPlan', { nation: B.nation, what: what });
    stats.modes[what] = (stats.modes[what] || 0) + 1;
    var A = WW.admirals && WW.admirals.of(B.nation), fl = A && A.flagship;
    WW.emit('admiralOrder', { nation: B.nation, admiral: A ? A.name : '', title: A ? A.title : '', order: 'night', what: what,
      text: (A ? A.title + ': ' : '') + TEXT[what], t: WW.time.now, roundTime: WW.game ? WW.game.roundTime : 0, ship: fl || null, x: fl ? fl.x : 0, z: fl ? fl.z : 0 });
  }
  // each commander tick (fleet_cmd.js, after the posture and the air-war hold)
  function tick(B, cs, now) {
    var n = night(), m = null, cv = n && cvOpen(B);
    if (n && B.posture !== 'withdraw') m = force(B) ? (SEEK_ON && B.doctrine.night >= SEEK_NIGHT ? 'seek' : 'accept') : 'stand';
    if (m !== (B.nightMode || null)) { B.nightMode = m; if (m) say(B, m); }
    if (cv && !B.nightCv) say(B, 'open');
    if (!n && B.nightCv && D().canFly() === false && hasCV(B)) say(B, 'dawn');   // the light is coming: the night station given up
    B.nightCv = cv;
    if (m === 'seek' && FLARE[B.nation]) flares(B, cs, now);
  }

  // ---- flares ----
  function burning(n) { var k = 0, S = WW.nightOps.shells; for (var i = 0; i < S.length; i++) if (S[i].flare && S[i].nation === n) k++; return k; }
  function litNear(x, z) { var S = WW.nightOps.shells; for (var i = 0; i < S.length; i++) if (WW.dist2(S[i].x, S[i].z, x, z) < S[i].r * S[i].r * 0.5) return true; return false; }
  function ownNear(n, x, z, r) { var S = WW.world.ships; for (var i = 0; i < S.length; i++) if (S[i].alive && S[i].nation === n && WW.dist2(S[i].x, S[i].z, x, z) < r * r) return true; return false; }
  function flares(B, cs, now) {
    var NO = WW.nightOps; if (!NO || WW.daylight >= 0.4 || burning(B.nation) >= FL.MAX) return;
    var S = WW.world.ships;
    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      if (s.nation !== B.nation || (s.type !== 'cruiser' && s.type !== 'battleship') || !fit(s)) continue;
      if (!left.has(s.id)) left.set(s.id, FL.PER);
      if (left.get(s.id) <= 0 || (nextFl.get(s.id) || 0) > now) continue;
      var best = null, bd = FL.R * FL.R;
      for (var k = 0; k < cs.length; k++) {
        var c = cs[k], u = c.unit;
        if (!u || !u.alive || u.sinking || u.submerged || u.isBase || !FLEET[u.type] || now - c.seenAt > FL.AGE) continue;
        var d2 = WW.dist2(s.x, s.z, c.x, c.z);
        if (d2 < FL.MIN * FL.MIN || d2 >= bd || NO.lit(u) || litNear(c.x, c.z)) continue;
        bd = d2; best = c;
      }
      if (!best) continue;
      left.set(s.id, left.get(s.id) - 1); nextFl.set(s.id, now + FL.CD);
      var dx = best.x - s.x, dz = best.z - s.z, dd = Math.hypot(dx, dz) || 1, fx = best.x + dx / dd * FL.BEHIND, fz = best.z + dz / dd * FL.BEHIND;
      if (ownNear(s.nation, fx, fz, NO.STAR.LIT)) continue;   // not over our own ships
      var sh = { x: fx, z: fz, y: FL.H, nation: s.nation, by: s, flare: true, t0: now, lightAt: now + FL.DELAY,
        until: now + FL.DELAY + FL.LIFE, lit: false, r: NO.STAR.LIT, fromX: fx, fromZ: fz };
      NO.shells.push(sh);
      stats.flares[s.nation] = (stats.flares[s.nation] || 0) + 1;
      WW.emit('flare', sh);
      return;   // one a tick per side
    }
  }
  function reset() { left.clear(); nextFl.clear(); }
  WW.on('roundStart', reset); WW.on('setupStart', reset);

  // ---- the director (visual; Math.random as camera.js) ----
  (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
    if (WW.simOnly || !WW.fleetCmd || !night()) return;
    (WW.sides ? WW.sides() : ['USN', 'IJN']).forEach(function (n) {
      var B = WW.fleetCmd.side(n), ec = B && (B.enemyCentre || B.searchPoint);   // before any contact: steaming out into the dark
      if (!B || !ec || !(B.nightMode === 'seek' || B.nightMode === 'accept') || B.posture === 'withdraw') return;
      var best = null, bd = 1e9;
      ['main', 'screen', 'flotilla'].forEach(function (g) { B.groups[g].members.forEach(function (q) { if (!GUN[q.type] || !fit(q)) return; var d = WW.dist(q.x, q.z, ec.x, ec.z); if (d < bd) { bd = d; best = q; } }); });
      if (best) add(5.4 + (bd < 300 ? 0.8 : 0), Math.random() < 0.5 ? 'chase' : 'low', best, { dur: dur(12, 16) });
    });
  });

  WW.nightPlan = { tick: tick, seeks: seeks, cvOpen: cvOpen, stowed: stowed, night: night, stats: stats,
    CV_OPEN_K: CV_OPEN_K, CV_BAND: CV_BAND, FL: FL, SPOT_AHEAD: SPOT_AHEAD };
})();
