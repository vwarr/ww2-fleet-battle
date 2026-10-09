// daylight.js - WW.dayNight: the round's clock and WW.daylight (1 = day, 0 = night). Sim code: the start time is
// rolled with WW.rand on roundStart and WW.daylight is stepped from main.js step(), so it is the same in a rendered
// page and in sim-only mode. Most battles are fought by day (golden hour, as before); some start late in the
// afternoon so dusk falls mid-battle; a few are night actions from the start.
// Flight ops: no launches after dusk (WW.air.launch returns null), planes airborne at dusk are recalled, and a
// night landing is risky (air_deck.js trap reads landRisk()). Visual code reads WW.daylight (sky, water, post, night_fx).
// The clock: hourAt(t) = startHour + t / 120 (1 sim s = 0.5 game minute). Daylight falls from 1 at DUSK_H (17:45)
// to 0 at DUSK_H + DUSK_LEN / 120 (19:00).
window.WW = window.WW || {};
(function () {
  'use strict';
  var DUSK_H = 17.75, DUSK_LEN = 150, PER_H = 120;    // sim s per game hour
  var P = { NIGHT: 0.07, DUSK: 0.12 };               // share of night / dusk starts (the rest: day)
  var FLY_MIN = 0.45,                                // no launches below this daylight
      RECALL = 0.5,                                  // airborne planes recalled below this
      LAND_RISK = 0.14;                              // a landing in full dark: chance of a crash / ditch
  var stats = { rounds: 0, kinds: { day: 0, dusk: 0, night: 0 }, launchesDark: 0, blocked: 0, recalls: 0,
                nightLandings: 0, nightLandingLoss: 0, nightTorps: { USN: 0, IJN: 0 } };
  var D = {
    kind: 'day', pin: null, startHour: 13, duskAt: 1e9, t0: 0, force: null, stats: stats, FLY_MIN: FLY_MIN,
    DUSK_LEN: DUSK_LEN, PER_H: PER_H,
    hourAt: function (t) { return D.startHour + t / PER_H; },
    level: function (t) { var x = (t - D.duskAt) / DUSK_LEN; x = x < 0 ? 0 : x > 1 ? 1 : x; return 1 - x * x * (3 - 2 * x); },
    roundT: function () { return WW.time.now - D.t0; },
    dark: function () { return 1 - WW.daylight; },
    canFly: function () { return WW.daylight >= FLY_MIN; },
    landRisk: function () { var k = (RECALL - WW.daylight) / (RECALL - 0.1); return k <= 0 ? 0 : LAND_RISK * Math.min(1, k); },
    update: update, roll: roll
  };
  WW.daylight = 1;
  WW.dayNight = D;

  // kind: 'day' | 'dusk' | 'night'. Always two WW.rand calls (a forced kind replays the same random sequence).
  function roll() {
    var r = WW.rand(), j = WW.rand(), f = D.force;
    var kind = f === 'day' || f === 'dusk' || f === 'night' ? f : r < P.NIGHT ? 'night' : r < P.NIGHT + P.DUSK ? 'dusk' : 'day';
    if (kind === 'night') D.startHour = 20.5 + 1.5 * j;
    else if (kind === 'dusk') D.startHour = DUSK_H - (90 + 110 * j) / PER_H;    // dusk begins 90-200 s in
    else D.startHour = 11 + 2 * j;                                            // 11:00-13:00: light all round (a pursuit can run 570 s)
    if (typeof f === 'number') { kind = 'dusk'; D.startHour = DUSK_H - f / PER_H; } // test hook: dusk begins f s in
    D.kind = kind;
    D.duskAt = (DUSK_H - D.startHour) * PER_H;
    D.t0 = WW.time.now; D.recalled = false; D._fly = true; D.lastLaunched = WW.stats.planesLaunched;
    WW.daylight = D.level(0);
    stats.rounds++; stats.kinds[kind]++;
  }
  WW.on('roundStart', roll);
  WW.on('setupStart', function () { D.kind = 'day'; D.startHour = 13; D.duskAt = 1e9; WW.daylight = 1; });

  // No launches after dusk: wrap WW.air.launch once (aircraft.js loads later). Callers already handle null.
  function wrapLaunch() {
    if (!WW.air || !WW.air.launch || WW.air.launch.night) return;
    var base = WW.air.launch;
    WW.air.launch = function () { if (!D.canFly()) { stats.blocked++; return null; } return base.apply(this, arguments); };
    WW.air.launch.night = true;
  }
  // carrier planes and catapult scouts (not the shore-based flying boats: air_flyingboats.js, base objects)
  function shipBorne(p) { return p.kind !== 'flyingboat' && p.carrier && p.carrier.stats && !p.carrier.base && !p.carrier.isBase; } // isBase: the island air base (island_base.js) is shore-based too
  // Recall: once below RECALL, every airborne carrier plane in transit (and fighters in a fight) turns for home;
  // bombers already in an attack finish it. Re-applied each step, so a plane that is sent out again is turned back.
  function recall() {
    var P = WW.world.planes;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (!p.alive || p.removed || p.deathMode || !shipBorne(p)) continue;
      if (p.state === 'transit' || (p.state === 'attack' && p.kind === 'fighter')) {
        if (p.kind === 'scout') { if (p.state === 'transit') { p.state = 'return'; stats.recalls++; } continue; }
        p.state = 'return'; p.foe = null; p.nightRecall = true; stats.recalls++;
      }
    }
  }
  function update() {
    if (!WW.game || WW.game.state === 'setup') return;
    wrapLaunch();
    WW.daylight = D.pin != null ? D.pin : D.level(D.roundT());   // pin: test hook (screenshots)
    if (WW.game.state !== 'battle') return;
    var wasFly = D._fly !== false; D._fly = D.canFly(); // a launch in the step before the light failed was still a daylight launch
    if (WW.stats.planesLaunched > D.lastLaunched && !D._fly && !wasFly) { // metric: ship-borne launches after dusk (carrier planes, catapult
      var L = WW.world.planes;                                     // scouts); shore-based flying boats fly at night ("Black Cats")
      for (var i = 0; i < L.length; i++) if (!L[i].nightSeen) { L[i].nightSeen = true; if (shipBorne(L[i])) stats.launchesDark++; }
    }
    if (D._fly || wasFly) for (var j = 0; j < WW.world.planes.length; j++) WW.world.planes[j].nightSeen = true;
    D.lastLaunched = WW.stats.planesLaunched;
    if (WW.daylight < RECALL) { if (!D.recalled) D.recalled = true; recall(); }
  }
  // night torpedo attacks (metrics): ship-fired spreads (one per ship per 2 s) while daylight < 0.35
  var lastSpread = new Map();
  WW.on('roundStart', function () { lastSpread.clear(); });
  WW.on('weaponDropped', function (e) {
    var o = e && e.plane;
    if (!e || e.kind !== 'torpedo' || !o || !o.stats || WW.daylight >= 0.35) return;
    var t = lastSpread.get(o.id);
    if (t !== undefined && WW.time.now - t < 2) return;
    lastSpread.set(o.id, WW.time.now);
    stats.nightTorps[o.nation] = (stats.nightTorps[o.nation] || 0) + 1;
  });
})();
