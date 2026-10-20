// weather.js - WW.weather: the round's weather, wind force and sea, and the rain squalls and cloud banks that drift
// across the map with WW.wind. Sim code: rolled with WW.rand on roundStart (after damage.js has rolled the round's
// wind) and moved from main.js step(), so it is the same in sim-only mode. Kinds:
//   clear     fair trade-wind day                   cumulus  scattered fair-weather cumulus (a look; no rain)
//   overcast  a low grey deck, broken: holes drift with the wind (dive bombers wait for a gap), duller light
//   scatter   scattered rain squalls                 line     a squall line crossing the map
//   thunder   heavy thunderstorm cells under a dark sky (lightning: weather_fx.js), gusty fresh-to-gale wind
//   typhoon   storm force 10-12: huge seas, driving rain everywhere, very low visibility, no flying, small ships
//             may founder (Typhoon Cobra, 18 Dec 1944: Hull, Monaghan and Spence capsized, light on fuel)
// cover(x, z) 0 (clear) .. 1 (the heart of a squall / the deck): cloud + rain (low cloud spoils dive bombing: air_cag.js
// diveOK; darker light: night_ops.js dayAt; strikes routed round it: air_cag.js detour). rain(x, z) / along(): rain
// only (visual range through rain: night_ops.js visK, gunnery). shelter(): a squall heart a hunted carrier or a
// cripple can hide in (ai_carrier.js, ai_surface.js). weather_fx.js / sky_time.js draw it (visual only).
// The setup panel (ui.js) previews the round's weather and wind and lets the user pick them (as daylight.js's start
// time): the preview's values are rolled with Math.random in setup and Start uses them; roll() still draws its own
// WW.rand values, the same number in the same order whatever the pick, so seeded / auto / sim-only rounds replay.
window.WW = window.WW || {};
(function () {
  'use strict';
  var KINDS = ['clear', 'cumulus', 'overcast', 'scatter', 'line', 'thunder', 'typhoon'];
  // shares of random rounds, rolled in this order (the rest clear: ~0.32)
  var MIX = [['line', 0.12], ['scatter', 0.20], ['thunder', 0.05], ['typhoon', 0.01], ['overcast', 0.12], ['cumulus', 0.18]];
  // Beaufort force: a random round's range for the kind, and what the setup slider may ask of it
  var BF = { clear: [1, 6], cumulus: [2, 5], overcast: [2, 6], scatter: [3, 6], line: [4, 7], thunder: [5, 8], typhoon: [10.5, 12] };
  var BF_USER = { clear: [0, 7], cumulus: [0, 7], overcast: [0, 8], scatter: [2, 8], line: [3, 9], thunder: [4, 9], typhoon: [10, 12] };
  // how developed the wind sea is (fetch and duration): the trades blow for days; a squall's or a thunderstorm's
  // gusts for minutes; a typhoon's confused sea round the eye runs higher than a steady gale's
  var FETCH = { clear: 0.95, cumulus: 0.95, overcast: 0.95, scatter: 0.88, line: 0.85, thunder: 0.8, typhoon: 1.3 };
  var DRIFT = 1.6,                         // cell speed = wind x DRIFT (u/s): a front crosses the map in a round
      N = 4,                               // cells rolled per round (fixed: a forced kind replays the same sequence)
      LOW = 0.4,                           // cover above this: cloud base too low for a dive-bomb push-over
      NOFLY_BF = 9, NOFLY_D = 7,           // no flight ops at or above this wind force / sea state (daylight.js canFly)
      SWAMP_D = 7.5,                       // foundering only in seas at least this high (typhoon-grade)
      SWAMP_P = 2e-5;                      // per s, a destroyer beam-on to a Douglas 8 sea, undamaged (balance19: 3.5e-5 gave 0.65 small ships per typhoon round, max 3; rare is the ask)
  // WMO: the probable wave height (m) of a fully developed wind sea at Beaufort 0..12, and the Douglas sea-state band
  // edges (m) for Douglas 0..9
  var HS = [0, 0.1, 0.2, 0.6, 1.0, 2.0, 3.0, 4.0, 5.5, 7.0, 9.0, 11.5, 14.0];
  var DOUG = [0, 0.1, 0.5, 1.25, 2.5, 4, 6, 9, 14, 20];
  var BF_NAME = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze',
    'near gale', 'gale', 'strong gale', 'storm', 'violent storm', 'hurricane force'];
  var cells = [], kinds = {};
  KINDS.forEach(function (k) { kinds[k] = 0; });
  var stats = { rounds: 0, kinds: kinds, diveHolds: 0, diveAborts: 0, detours: 0, swamped: { pt: 0, destroyer: 0, submarine: 0, cruiser: 0, battleship: 0, carrier: 0 },
    swampedRounds: [], ptHeld: 0 };
  var W = {
    kind: 'clear', cells: cells, force: null, stats: stats, LOW: LOW, KINDS: KINDS, BF_NAME: BF_NAME,
    deck: 0,          // overcast cloud deck 0..1 (cover floor, broken by drifting holes)
    rainAll: 0,       // rain everywhere (typhoon)
    overcast: 0,      // how grey the sky is (sky_time.js), 0..1
    beaufort: 4, noFly: false,
    userKind: null, userBf: null,   // the setup panel's picks (null: random)
    // 0..1 rain / cloud cover at a point
    cover: function (x, z) {
      var m = cellAt(x, z);
      if (W.deck > 0) { var d = deckAt(x, z); if (d > m) m = d; }
      if (W.rainAll > m) m = W.rainAll;
      return m > 1 ? 1 : m;
    },
    // 0..1 rain at a point (no cloud deck)
    rain: function (x, z) { var m = cellAt(x, z); return m > W.rainAll ? m : W.rainAll; },
    // the worst rain along a line of sight (5 samples, ends included)
    along: function (ax, az, bx, bz) {
      if (!cells.length) return W.rainAll;
      var m = W.rainAll;
      for (var i = 0; i <= 4; i++) { var f = i / 4, c = cellAt(ax + (bx - ax) * f, az + (bz - az) * f); if (c > m) m = c; }
      return m > 1 ? 1 : m;
    },
    // nearest squall heart within maxD of (x, z), led along its drift by `lead` s; null if none (none in a typhoon:
    // the rain is everywhere)
    shelter: function (x, z, maxD, lead) {
      if (W.rainAll > 0.5) return null;
      var best = null, bd = maxD * maxD;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i], px = c.x + c.vx * (lead || 0), pz = c.z + c.vz * (lead || 0), d2 = WW.dist2(x, z, px, pz);
        if (c.dens < 0.55 || d2 >= bd) continue;
        if (px < 40 || px > WW.cfg.MAP_W - 40 || pz < 40 || pz > WW.cfg.MAP_H - 40) continue;
        bd = d2; best = best || {}; best.x = px; best.z = pz; best.cell = c;
      }
      return best;
    },
    // heavy weather (sim): a ship's top-speed factor in this sea (ships.js move): small hulls slow first
    seaSpeedK: function (s) {
      var d = WW.seaState ? WW.seaState.douglas : 3, t = s.type;
      if (t === 'pt') return d <= 3 ? 1 : d >= 6 ? 0.3 : 1 - 0.7 * (d - 3) / 3;
      if (s.submerged) return 1;
      if (t === 'destroyer' || t === 'submarine') return d <= 5 ? 1 : d >= 8 ? 0.5 : 1 - 0.5 * (d - 5) / 3;
      if (t === 'cruiser') return d <= 6 ? 1 : d >= 8.5 ? 0.7 : 1 - 0.3 * (d - 6) / 2.5;
      return d <= 7 ? 1 : d >= 9 ? 0.8 : 1 - 0.2 * (d - 7) / 2;
    },
    // a PT boat cannot keep the sea (ai_pt.js: she runs for home and makes no attack runs)
    ptHold: function () { var d = WW.seaState ? WW.seaState.douglas : 3; return d >= 5; },
    // gunnery in a seaway and through rain (combat.js fireShell): dispersion factor for the firing ship
    gunK: function (s, t) {
      var d = WW.seaState ? WW.seaState.douglas : 3, small = s && (s.type === 'destroyer' || s.type === 'pt' || s.type === 'submarine');
      var k = 1 + Math.max(0, d - 3) * (small ? 0.14 : 0.08);
      if (t && (cells.length || W.rainAll)) k *= 1 + 0.35 * W.along(s.x, s.z, t.x, t.z);
      return k;
    },
    beaufortOf: function () { return W.beaufort; },
    update: update, roll: roll, plan: plan, seaOf: seaOf
  };
  WW.weather = W;

  function cellAt(x, z) {
    var m = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, r2 = c.r * c.r;
      if (d2 >= r2) continue;
      var k = 1 - Math.sqrt(d2 / r2); k = k * k * (3 - 2 * k) * c.dens * 1.6;
      if (k > m) m = k;
    }
    return m > 1 ? 1 : m;
  }
  // the overcast deck: W.deck with holes and thicker patches (two drifting octaves of smooth value noise, ~300 u)
  var deckOff = { x: 0, z: 0, seed: 0 };
  function hash(i, j) { var h = Math.sin(i * 127.1 + j * 311.7 + deckOff.seed * 74.7) * 43758.5453; return h - Math.floor(h); }
  function vnoise(x, z) {
    var i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function deckAt(x, z) {
    var u = (x - deckOff.x) / 320, v = (z - deckOff.z) / 320, n = 0.65 * vnoise(u, v) + 0.35 * vnoise(u * 2.3 + 5.1, v * 2.3 - 3.7);
    return W.deck * (0.55 + 0.9 * n);   // deck 0.45: ~0.25 in the holes, ~0.65 in the thick of it
  }

  // ---- wind and sea ----
  // WW.seaState = { douglas 0..9, beaufort 0..12, S 0..1, storm 0..1, Hs (m), kind }. The round's Beaufort force
  // gives a WMO fully developed wind-sea height, times how developed it is (FETCH); the height's Douglas band is the
  // sea state (continuous within the band). S = (douglas - 1) / 4 clamped to 0..1 is what sea_state.js (the drawn
  // sea) reads; storm (Douglas 5 .. 9 -> 0 .. 1) carries the heavy-weather look. Readers: intel.js seaK (whitecaps
  // hide torpedo wakes), this file's storm rules, ship motion through the drawn sea.
  function hsOf(bf) { bf = WW.clamp(bf, 0, 12); var i = Math.min(11, Math.floor(bf)); return HS[i] + (HS[i + 1] - HS[i]) * (bf - i); }
  function douglasOf(h) {
    for (var i = 0; i < DOUG.length - 1; i++) if (h < DOUG[i + 1]) return i + (h - DOUG[i]) / (DOUG[i + 1] - DOUG[i]);
    return 9;
  }
  function seaOf(bf, kind) {
    var hs = hsOf(bf) * (FETCH[kind] || 0.95), d = Math.min(9, douglasOf(hs));
    return { douglas: d, beaufort: bf, S: WW.clamp((d - 1) / 4, 0, 1), storm: WW.clamp((d - 5) / 4, 0, 1), Hs: hs, kind: kind };
  }
  // wind speed in map units (smoke, spray, cells' drift; damage.js's random rounds roll 0.5-0.9) for a Beaufort force
  var MAG = [0.06, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4];
  function magOf(bf) { bf = WW.clamp(bf, 0, 12); var i = Math.min(11, Math.floor(bf)); return MAG[i] + (MAG[i + 1] - MAG[i]) * (bf - i); }

  // The round's outcome from its values (pure: the setup preview and roll() share it). v: { r, s, sea } (the kind's
  // draw, the wind speed damage.js rolled 0.5-0.9, the sea's spread draw)
  function forcedKind() { var f = W.force != null ? W.force : WW.scn && WW.scn().weather ? WW.scn().weather : null; return f; }   // scn.weather: Normandy's (no squalls; the overcast is a look)
  function plan(v) {
    var f = forcedKind(), kind;
    if (KINDS.indexOf(f) < 0) f = null;
    if (!f && W.userKind && KINDS.indexOf(W.userKind) >= 0 && !(WW.scn && WW.scn().weather)) f = W.userKind;
    if (f) kind = f;
    else { kind = 'clear'; var acc = 0; for (var i = 0; i < MIX.length; i++) { acc += MIX[i][1]; if (v.r < acc) { kind = MIX[i][0]; break; } } }
    var wf = WW.clamp((v.s - 0.5) / 0.4, 0, 1), u = 0.6 * wf + 0.4 * v.sea, R = BF[kind], bf = R[0] + (R[1] - R[0]) * u, user = false;
    if (W.userBf != null && !(WW.scn && WW.scn().weather) && W.force == null) { var U = BF_USER[kind]; bf = WW.clamp(W.userBf, U[0], U[1]); user = true; }
    bf = Math.round(bf * 10) / 10;
    var mag = user || kind === 'thunder' || kind === 'typhoon' || bf < 2 ? magOf(bf) : v.s;
    return { kind: kind, bf: bf, mag: mag, random: W.userKind == null, windRandom: W.userBf == null };
  }

  function build(kind, h, raw) {
    var cx = WW.cfg.MAP_W * (0.3 + 0.4 * h[0]), cz = WW.cfg.MAP_H * (0.3 + 0.4 * h[1]), cross = 120 + 180 * h[2];
    cells.length = 0;
    W.deck = kind === 'overcast' ? 0.45 : kind === 'thunder' ? 0.3 : kind === 'typhoon' ? 0.9 : 0;
    W.rainAll = kind === 'typhoon' ? 0.85 : 0;
    W.overcast = kind === 'overcast' ? 0.55 : kind === 'thunder' ? 0.8 : kind === 'typhoon' ? 1 : 0;
    deckOff.x = 0; deckOff.z = 0; deckOff.seed = h[2] * 100;
    if (W.force === 'line' && kind === 'line') { cx = WW.cfg.MAP_W / 2; cz = WW.cfg.MAP_H / 2; cross = 140; } // test hook: the line crosses mid-map ~140 s in
    if (kind === 'clear' || kind === 'cumulus' || kind === 'overcast') return;
    var wd = WW.wind || { x: 1, z: 0 }, wl = Math.hypot(wd.x, wd.z) || 1, ux = wd.x / wl, uz = wd.z / wl;   // drift direction
    var sp = Math.max(0.5, Math.min(1, wl)) * DRIFT, back = sp * cross;   // start upwind: the front reaches (cx, cz) `cross` s in
    var many = kind === 'line' || kind === 'thunder' || kind === 'typhoon';
    for (var j = 0; j < (many ? N : 2); j++) {
      var q = raw[j], along, side, r, dens;
      if (kind === 'line') { along = (q[0] - 0.5) * 40; side = (j - (N - 1) / 2) * 120 + (q[1] - 0.5) * 40; r = 80 + 35 * q[2]; dens = 0.75 + 0.25 * q[2]; } // a line across the wind
      else if (kind === 'thunder') { along = (q[0] - 0.5) * 380; side = (q[1] - 0.5) * 560; r = 95 + 45 * q[2]; dens = 0.92 + 0.08 * q[2]; }   // big, heavy cells
      else if (kind === 'typhoon') { along = (q[0] - 0.5) * 600; side = (q[1] - 0.5) * 700; r = 110 + 60 * q[2]; dens = 1; }   // the heaviest rain bands
      else { along = (q[0] - 0.5) * 300; side = (q[1] - 0.5) * 420; r = 65 + 35 * q[2]; dens = 0.75 + 0.25 * q[2]; }
      cells.push({ x: cx - ux * (back - along) - uz * side, z: cz - uz * (back - along) + ux * side, r: r, dens: dens, vx: ux * sp, vz: uz * sp, seed: q[0] * 1000, kind: kind });
    }
  }
  // apply an outcome: the wind (keeping its direction a), the sea, the flags, the cells
  function apply(o, a, h, raw) {
    W.kind = o.kind; W.beaufort = o.bf;
    WW.wind = { x: Math.cos(a) * o.mag, z: Math.sin(a) * o.mag, a: a, bf: o.bf };
    WW.seaState = seaOf(o.bf, o.kind);
    W.noFly = o.bf >= NOFLY_BF || WW.seaState.douglas >= NOFLY_D;
    build(o.kind, h, raw);
  }

  // ---- the setup preview (ui.js) ----
  var P = null, usePreview = false, pkey = null;
  function reroll() {
    var M = Math.random, raw = [];
    for (var i = 0; i < N; i++) raw.push([M(), M(), M()]);
    P = { r: M(), h: [M(), M(), M()], raw: raw, sea: M(), a: M() * Math.PI * 2, s: 0.5 + 0.4 * M() };
  }
  function previewOn() { return !WW.simOnly && !(WW.scn && WW.scn().weather) && W.force == null; }
  function showPreview() {
    if (!previewOn() || !WW.game || WW.game.state !== 'setup') return;
    if (!P) reroll();
    apply(plan(P), P.a, P.h, P.raw);
  }

  function roll() {
    var r = WW.rand(), h = [WW.rand(), WW.rand(), WW.rand()];
    var raw = [];
    for (var i = 0; i < N; i++) raw.push([WW.rand(), WW.rand(), WW.rand()]);
    var sea = WW.rand();
    var wd = WW.wind || { x: 0.7, z: 0 }, v = { r: r, s: Math.hypot(wd.x, wd.z), sea: sea }, a = wd.a !== undefined ? wd.a : Math.atan2(wd.z, wd.x);
    if (usePreview && P) { v = P; h = P.h; raw = P.raw; a = P.a; }
    usePreview = false;
    var o = plan(v);
    if (WW.scn && WW.scn().wind) o.mag = Math.hypot(wd.x, wd.z);   // a scenario's own wind (damage.js: Normandy's WNW 4-5)
    apply(o, a, h, raw);
    stats.rounds++; stats.kinds[W.kind]++;
    swampT = 0; swampN = 0;
  }
  WW.on('roundStart', roll);
  if (WW.roundRec) WW.roundRec.add('weather', function () { return { p: P, use: usePreview, uk: W.userKind, ub: W.userBf }; },
    function (d) { P = d.p || null; usePreview = !!d.use; W.userKind = d.uk || null; W.userBf = d.ub == null ? null : d.ub; });   // the look-ahead copy rolls the same weather
  function calm() { cells.length = 0; W.kind = 'clear'; W.deck = W.rainAll = W.overcast = 0; W.noFly = false; W.beaufort = 4; WW.seaState = seaOf(4, 'clear'); }
  calm();
  WW.on('setupStart', function () {
    calm();
    var key = (WW.terrain ? WW.terrain.seed : 0) + '|' + (WW.stats ? WW.stats.round : 0);
    if (!P || key !== pkey) reroll();   // a new map or a new round: a new roll (a ship placed or removed keeps it)
    pkey = key;
    showPreview();
  });
  // main.js startRound from setup: back to plain setup's state before the spawn (roll() then sets the round's)
  W.preRound = function () { if (previewOn()) calm(); };
  // the setup panel: { kind, bf, mag, random, windRandom } the Start button gives (null: no preview)
  W.preview = function () { if (!previewOn()) return null; if (!P) reroll(); return plan(P); };
  W.startFromPreview = function () { if (!P) reroll(); usePreview = true; };
  W.rerollPreview = function () { reroll(); showPreview(); };
  W.setUserKind = function (k) { W.userKind = KINDS.indexOf(k) >= 0 ? k : null; showPreview(); };
  W.setUserBf = function (b) { W.userBf = b == null || isNaN(+b) ? null : WW.clamp(Math.round(+b), 0, 12); showPreview(); };
  W.bfRange = function (k) { return BF_USER[k || W.kind] || [0, 12]; };

  // ---- foundering (sim) ----
  // Typhoon-grade seas only (Douglas >= SWAMP_D): once a second each surface ship may founder: a small hull far more
  // than a big one, more if she is already flooding or holed and low on hp, and most beam-on to the sea (the wind).
  // Through the capsize path (ship_fires.js): she rolls over and goes down; 'swamped' captions it (ui.js), the diary
  // and the AAR say she foundered. WW.rand draws only in such seas, so every other round's sequence is untouched.
  var SIZE = { pt: 1.4, destroyer: 1, submarine: 0.4, cruiser: 0.004, battleship: 0.0004, carrier: 0.0006 };
  var swampT = 0, swampN = 0;
  function founder(dt) {
    var ss = WW.seaState, d = ss ? ss.douglas : 0;
    if (W.kind !== 'typhoon' || d < SWAMP_D || !WW.game || WW.game.state !== 'battle') return;
    swampT += dt; if (swampT < 1) return; swampT -= 1;
    var seaK = (d - 6.5) / 1.5, wa = WW.wind ? WW.wind.a : 0, ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.sinking || s.submerged || s.escaped || s.removed || !s.stats) continue;
      var sz = SIZE[s.type]; if (!sz) continue;
      var hp = s.maxHp ? s.hp / s.maxHp : 1, dmg = 1 + 3 * (s.flood || 0) + 2 * (s.breach || 0) + 2.5 * (1 - hp);
      var beam = 0.25 + 1.5 * Math.abs(Math.sin(s.heading - wa));
      var p = SWAMP_P * seaK * sz * dmg * beam;
      if (WW.rand() >= p) continue;
      // she rolls over to leeward
      s.swamped = true; s.capsized = true; swampN++;
      var lee = Math.sin(wa - s.heading) >= 0 ? 1 : -1;
      s.listRoll = lee * 0.5; s.sinkRoll = lee * 1.5; s.hp = 0;
      stats.swamped[s.type] = (stats.swamped[s.type] || 0) + 1;
      WW.emit('capsize', { ship: s, x: s.x, z: s.z });
      WW.emit('swamped', { ship: s, kind: W.kind });
      s.startSinking();
    }
  }
  W.swampedThisRound = function () { return swampN; };

  function update(dt) {
    if (!WW.game || WW.game.state === 'setup') return;
    for (var i = 0; i < cells.length; i++) { var c = cells[i]; c.x += c.vx * dt; c.z += c.vz * dt; }
    if (W.deck > 0 && WW.wind) { deckOff.x += WW.wind.x * DRIFT * 0.6 * dt; deckOff.z += WW.wind.z * DRIFT * 0.6 * dt; }
    founder(dt);
  }
})();
