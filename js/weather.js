// weather.js - WW.weather: rain squalls and cloud banks that drift across the map with WW.wind. Sim code: the front
// is rolled with WW.rand on roundStart (after damage.js has rolled the round's wind) and moved from main.js step(),
// so it is the same in sim-only mode. A front is a few soft round cells; cover(x, z) is 0 (clear) .. 1 (the heart of
// a squall). Uses: intel visual range through rain (night_ops.js visK), darker light under it, low cloud that spoils
// dive bombing (air_cag.js diveOK), strikes routed round it (air_cag.js detour), and shelter for a hunted carrier
// or a withdrawing cripple (ai_carrier.js, ai_surface.js). weather_fx.js draws it (visual only, Math.random).
window.WW = window.WW || {};
(function () {
  'use strict';
  var P = { SCATTER: 0.22, LINE: 0.13 },  // share of rounds with scattered squalls / a squall line (the rest clear)
      DRIFT = 1.6,                         // cell speed = wind x DRIFT (u/s): a front crosses the map in a round
      N = 4,                               // cells rolled per round (fixed: a forced kind replays the same sequence)
      LOW = 0.4;                           // cover above this: cloud base too low for a dive-bomb push-over
  var cells = [], stats = { rounds: 0, kinds: { clear: 0, scatter: 0, line: 0 }, diveHolds: 0, diveAborts: 0, detours: 0 };
  var W = {
    kind: 'clear', cells: cells, force: null, stats: stats, LOW: LOW,
    // 0..1 rain / cloud cover at a point
    cover: function (x, z) {
      var m = 0;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i], dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, r2 = c.r * c.r;
        if (d2 >= r2) continue;
        var k = 1 - Math.sqrt(d2 / r2); k = k * k * (3 - 2 * k) * c.dens * 1.6;
        if (k > m) m = k;
      }
      return m > 1 ? 1 : m;
    },
    // the worst cover along a line of sight (5 samples, ends included)
    along: function (ax, az, bx, bz) {
      if (!cells.length) return 0;
      var m = 0;
      for (var i = 0; i <= 4; i++) { var f = i / 4, c = W.cover(ax + (bx - ax) * f, az + (bz - az) * f); if (c > m) m = c; }
      return m;
    },
    // nearest squall heart within maxD of (x, z), led along its drift by `lead` s; null if none
    shelter: function (x, z, maxD, lead) {
      var best = null, bd = maxD * maxD;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i], px = c.x + c.vx * (lead || 0), pz = c.z + c.vz * (lead || 0), d2 = WW.dist2(x, z, px, pz);
        if (c.dens < 0.55 || d2 >= bd) continue;
        if (px < 40 || px > WW.cfg.MAP_W - 40 || pz < 40 || pz > WW.cfg.MAP_H - 40) continue;
        bd = d2; best = best || {}; best.x = px; best.z = pz; best.cell = c;
      }
      return best;
    },
    update: update, roll: roll
  };
  WW.weather = W;

  function roll() {
    var r = WW.rand(), cx = WW.cfg.MAP_W * (0.3 + 0.4 * WW.rand()), cz = WW.cfg.MAP_H * (0.3 + 0.4 * WW.rand()), cross = 120 + 180 * WW.rand();
    var raw = [];
    for (var i = 0; i < N; i++) raw.push([WW.rand(), WW.rand(), WW.rand()]);
    var f = W.force, kind = f === 'clear' || f === 'scatter' || f === 'line' ? f : r < P.LINE ? 'line' : r < P.LINE + P.SCATTER ? 'scatter' : 'clear';
    if (f === 'line') { cx = WW.cfg.MAP_W / 2; cz = WW.cfg.MAP_H / 2; cross = 140; } // test hook: the line crosses mid-map ~140 s in
    W.kind = kind; cells.length = 0; stats.rounds++; stats.kinds[kind]++;
    if (kind === 'clear') return;
    var wd = WW.wind || { x: 1, z: 0 }, wl = Math.hypot(wd.x, wd.z) || 1, ux = wd.x / wl, uz = wd.z / wl;   // drift direction
    var sp = Math.max(0.5, wl) * DRIFT, back = sp * cross;   // start upwind: the front reaches (cx, cz) `cross` s in
    for (var j = 0; j < (kind === 'line' ? N : 2); j++) {
      var q = raw[j], along, side;
      if (kind === 'line') { along = (q[0] - 0.5) * 40; side = (j - (N - 1) / 2) * 120 + (q[1] - 0.5) * 40; } // a line across the wind
      else { along = (q[0] - 0.5) * 300; side = (q[1] - 0.5) * 420; }
      cells.push({ x: cx - ux * (back - along) - uz * side, z: cz - uz * (back - along) + ux * side,
        r: (kind === 'line' ? 80 : 65) + 35 * q[2], dens: 0.75 + 0.25 * q[2], vx: ux * sp, vz: uz * sp, seed: q[0] * 1000 });
    }
  }
  WW.on('roundStart', roll);
  WW.on('setupStart', function () { cells.length = 0; W.kind = 'clear'; });
  function update(dt) {
    if (!WW.game || WW.game.state === 'setup') return;
    for (var i = 0; i < cells.length; i++) { var c = cells[i]; c.x += c.vx * dt; c.z += c.vz * dt; }
  }
})();
