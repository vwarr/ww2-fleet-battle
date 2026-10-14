// round_rec.js (sim): WW.roundRec, the record of everything a round starts from (camera5). main.js startRound() captures
// it as the modules are cleared (game.rec: the generator's state before the clear, which rolls the wind; the rest after); startRound({ replay: rec }) in another page or worker (the look-ahead
// copy, lookahead_worker.js) starts the very same round from it: the seeded generator's state, the map, the clock, the
// fleets (a user's custom composition too), the setup choices, the forced time of day / weather, and the state some
// modules carry from round to round (WW.roundRec.add: the aces' rosters, the admirals' preview). Plain JSON data.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const parts = {};
  const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const GAME = ['seed', 'mode', 'composition', 'baseChoice', 'basePreview', 'basePreviewSeed', 'custom', 'infinite', 'noRetire'];
  WW.roundRec = {
    // a module's carried-over state: get() -> JSON data, set(data) restores it
    add(name, get, set) { parts[name] = { get, set }; },
    capture(keepMap, rng) {
      const G = WW.game, g = {};
      for (const k of GAME) g[k] = copy(G[k]);
      const rec = { v: 1, rng, terrain: WW.terrain.seed, now: WW.time.now, round: WW.stats.round, keepMap: !!keepMap, game: g,
        tod: WW.dayNight ? copy(WW.dayNight.force) : undefined, wx: WW.weather ? copy(WW.weather.force) : undefined, parts: {} };
      for (const k in parts) { try { rec.parts[k] = copy(parts[k].get()); } catch (e) { console.error('roundRec ' + k, e); } }
      return rec;
    },
    apply(rec) {
      const G = WW.game;
      for (const k of GAME) G[k] = copy(rec.game[k]);
      WW.time.now = rec.now; WW.stats.round = rec.round;
      if (WW.dayNight) WW.dayNight.force = copy(rec.tod) === undefined ? null : copy(rec.tod);
      if (WW.weather) WW.weather.force = copy(rec.wx) === undefined ? null : copy(rec.wx);
      for (const k in parts) if (rec.parts[k] !== undefined) { try { parts[k].set(copy(rec.parts[k])); } catch (e) { console.error('roundRec ' + k, e); } }
    }
  };
})(window.WW);
