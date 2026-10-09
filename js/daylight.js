// daylight.js - WW.dayNight: the round's clock, the sun and WW.daylight (1 = day, 0 = night). Sim code: the start
// time is rolled with WW.rand on roundStart and the clock is stepped from main.js step(), so it is the same in a
// rendered page and in sim-only mode. EVERY battle passes time: the round spans CFG.SPAN_H game hours over the
// expected round length (WW.cfg.ROUND_TIMEOUT), so the sun visibly moves. Kinds (CFG.MIX): dawn (pre-dawn twilight
// into morning light), day (the sun climbs or sinks through bright day), dusk (a sunset in the middle of the fight,
// at CFG.SUNSET_AT of the round: golden light, the sun on the horizon, the blue hour, night; the fight builds as the
// light goes) and night (a night action under the moon).
// The sun: elevation elevAt(h) = NOON_ELEV x sin(pi (h - SUNRISE) / (SUNSET - SUNRISE)) (negative at night); its
// azimuth runs east (+x) at sunrise, south (+z) at noon, west (-x) at sunset. Daylight (what the AI sees by, and
// whether carriers fly) is smoothstep(DARK_E, LIGHT_E, elevation): 1 above +4 deg, 0 below -9 deg (nautical dusk).
// Flight ops: no launches below FLY_MIN (WW.air.launch returns null), airborne planes recalled below RECALL, a night
// landing is risky (air_deck.js trap reads landRisk()). Visual code reads D.sunElev / D.hour / D.morning() and
// WW.daylight (sky_time.js, water.js, post.js, night_fx.js).
window.WW = window.WW || {};
(function () {
  'use strict';
  var CFG = {
    SPAN_H: 4,                          // game hours per WW.cfg.ROUND_TIMEOUT (sim s): the clock adapts to the round length
    SUNRISE: 6, SUNSET: 18, NOON_ELEV: 70,
    LIGHT_E: 4, DARK_E: -9,             // daylight 1 above LIGHT_E deg of sun elevation, 0 below DARK_E
    MIX: { dawn: 0.13, day: 0.35, dusk: 0.45, night: 0.07 },   // shares of rounds (rolled in this order)
    DAWN_START: [5.25, 5.9],            // dawn rounds: start hour (twilight, then sunrise early in the round)
    DAY_START: [7.5, 12],               // day rounds: start hour (light all round, even a pursuit-stretched one)
    SUNSET_AT: [0.4, 0.75],             // dusk rounds: the sun sets at this fraction of ROUND_TIMEOUT
    NIGHT_START: [20, 22]               // night rounds: start hour
  };
  var FLY_MIN = 0.5,                                 // no launches below this daylight (= RECALL: what took off is not turned back at once; the follow caption reads canFly too)
      RECALL = 0.5,                                  // airborne planes recalled below this
      LAND_RISK = 0.14;                              // a landing in full dark: chance of a crash / ditch
  var stats = { rounds: 0, kinds: { dawn: 0, day: 0, dusk: 0, night: 0 }, launchesDark: 0, blocked: 0, recalls: 0,
                nightLandings: 0, nightLandingLoss: 0, struckBelow: 0, nightExempt: 0, nightTorps: { USN: 0, IJN: 0 } };
  var D = {
    kind: 'day', pin: null, pinHour: null, startHour: 13, t0: 0, force: null, stats: stats, CFG: CFG, FLY_MIN: FLY_MIN,
    hour: 13, sunElev: 50, sunAz: Math.PI / 2,
    perH: function () { return WW.cfg.ROUND_TIMEOUT / CFG.SPAN_H; },          // sim s per game hour
    hourAt: function (t) { return D.startHour + t / D.perH(); },
    elevAt: function (h) { var x = ((h - CFG.SUNRISE) % 24 + 24) % 24; return CFG.NOON_ELEV * Math.sin(Math.PI * x / (CFG.SUNSET - CFG.SUNRISE)); },
    // azimuth angle in the x-z plane: 0 = +x (east) at sunrise, pi/2 = +z at noon, pi = -x (west) at sunset
    azAt: function (h) { return Math.PI * (h - CFG.SUNRISE) / (CFG.SUNSET - CFG.SUNRISE); },
    lightAt: function (e) { var x = (e - CFG.DARK_E) / (CFG.LIGHT_E - CFG.DARK_E); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); },
    level: function (t) { return D.lightAt(D.elevAt(D.hourAt(t))); },
    morning: function () { var h = ((D.hour % 24) + 24) % 24; return h < 11 ? 1 : h < 13 ? (13 - h) / 2 : 0; }, // 1 before 11:00, 0 after 13:00
    roundT: function () { return WW.time.now - D.t0; },
    dark: function () { return 1 - WW.daylight; },
    canFly: function () { return WW.daylight >= FLY_MIN; },
    landRisk: function () { var k = (RECALL - WW.daylight) / (RECALL - 0.1); return k <= 0 ? 0 : LAND_RISK * Math.min(1, k); },
    update: update, roll: roll, setClock: setClock
  };
  WW.daylight = 1;
  WW.dayNight = D;
  function setClock(h) {
    D.hour = h; D.sunElev = D.elevAt(h); D.sunAz = D.azAt(h);
    WW.daylight = D.pin != null ? D.pin : D.lightAt(D.sunElev);
  }
  function span(a, j) { return a[0] + (a[1] - a[0]) * j; }

  // kind: 'dawn' | 'day' | 'dusk' | 'night'. Always two WW.rand calls (a forced kind replays the same random sequence).
  // force: a kind, or a number n: a dusk round whose sun sets n s in (tests).
  function roll() {
    var r = WW.rand(), j = WW.rand(), f = D.force, M = CFG.MIX, kind;
    if (f === 'dawn' || f === 'day' || f === 'dusk' || f === 'night') kind = f;
    else if (typeof f === 'number') kind = 'dusk';
    else kind = r < M.dawn ? 'dawn' : r < M.dawn + M.day ? 'day' : r < M.dawn + M.day + M.dusk ? 'dusk' : 'night';
    var L = WW.cfg.ROUND_TIMEOUT, ph = D.perH();
    if (kind === 'dawn') D.startHour = span(CFG.DAWN_START, j);
    else if (kind === 'day') D.startHour = span(CFG.DAY_START, j);
    else if (kind === 'night') D.startHour = span(CFG.NIGHT_START, j);
    else D.startHour = CFG.SUNSET - (typeof f === 'number' ? f : span(CFG.SUNSET_AT, j) * L) / ph;
    D.kind = kind;
    D.t0 = WW.time.now; D.recalled = false; D._fly = true; D.lastLaunched = WW.stats.planesLaunched;
    setClock(D.pinHour != null ? D.pinHour : D.startHour);
    stats.rounds++; stats.kinds[kind]++;
  }
  WW.on('roundStart', roll);
  WW.on('setupStart', function () { D.kind = 'day'; D.startHour = 15.5; setClock(15.5); }); // setup: the golden afternoon

  // No launches after dusk: wrap WW.air.launch once (aircraft.js loads later). Callers already handle null.
  function wrapLaunch() {
    if (!WW.air || !WW.air.launch || WW.air.launch.night) return;
    var base = WW.air.launch;
    WW.air.launch = function () { if (!D.canFly()) { stats.blocked++; return null; } return base.apply(this, arguments); };
    WW.air.launch.night = true;
  }
  // The deck: a plane launched (queued below, taxiing, spotted) before the light failed does not take off into the dark.
  // Below FLY_MIN it is struck below again (back in the hangar) before its run; a take-off run that starts in the dark
  // is counted in launchesDark (sim_behaviour dark_launch: 0). Exempt: plane.nightOK (a captioned emergency launch).
  var DECK_GATE = true;   // ?nodeckgate (A/B): the old behaviour, the queued planes take off into the dark
  if (typeof location !== 'undefined' && /[?&]nodeckgate/.test(location.search)) DECK_GATE = false;
  function wrapDeck() {
    var A = WW.airDeck;
    if (!A || !A.takeoff || A.takeoff.night) return;
    var base = A.takeoff;
    A.takeoff = function (p, dt) {
      var before = onDeck(p);
      var r = base.apply(this, arguments);
      if (before && p.deckPh === 'run' && !D.canFly()) { if (p.nightOK) stats.nightExempt++; else stats.launchesDark++; }
      return r;
    };
    A.takeoff.night = true;
  }
  function onDeck(p) { var ph = p.deckPh; return ph === 'queued' || ph === 'rise' || ph === 'taxi' || ph === 'hold'; }
  function strikeBelow() {   // every step in the dark, before the planes move (main.js steps the clock first)
    var P = WW.world.planes;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      if (!p.alive || p.removed || p.state !== 'takeoff' || p.nightOK || !onDeck(p) || !shipBorne(p) || !p.carrier.hangar) continue;
      p.carrier.hangar[p.kind] = (p.carrier.hangar[p.kind] || 0) + 1; p.alive = false; p.remove(); stats.struckBelow++;
    }
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
    wrapLaunch(); wrapDeck();
    setClock(D.pinHour != null ? D.pinHour : D.hourAt(D.roundT()));   // pin / pinHour: test hooks (screenshots)
    if (WW.game.state !== 'battle') return;
    var wasFly = D._fly !== false; D._fly = D.canFly(); // a launch in the step before the light failed was still a daylight launch
    if (WW.stats.planesLaunched > D.lastLaunched && !D._fly && !wasFly) { // metric: ship-borne launches after dusk (carrier planes, catapult
      var L = WW.world.planes;                                     // scouts); shore-based flying boats fly at night ("Black Cats")
      for (var i = 0; i < L.length; i++) if (!L[i].nightSeen) { L[i].nightSeen = true; if (shipBorne(L[i])) stats.launchesDark++; }
    }
    if (D._fly || wasFly) for (var j = 0; j < WW.world.planes.length; j++) WW.world.planes[j].nightSeen = true;
    D.lastLaunched = WW.stats.planesLaunched;
    if (WW.daylight < RECALL) { if (!D.recalled) D.recalled = true; recall(); }
    if (DECK_GATE && !D._fly) strikeBelow();
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
