// tide.js - WW.tide: the flood tide at Omaha on 6 June 1944 (Normandy). Sim-safe: a pure function of the round clock
// (normandy.js clock), no WW.rand, 0 in any other scenario.
// Low water was at about 05:25 and high water about 11:00, a range of ~6 m (spring tides: the invasion was timed for
// the obstacles to be dry at H-hour, an hour after low water). The flood came in fast over the flat sand: by about
// 08:00 the water was at the shingle along much of the beach, the wounded on the sand drowned as it came in, and the
// later waves had no beach to cross and no dry obstacles to see. Level 0 is the H-hour waterline (terrain shoreZ: the
// sea bed and the sand are measured from it); before H the sea is a little lower.
//   level()      the sea's rise over the H-hour datum now (world u, the terrain's vertical exaggeration applied)
//   depth(x, z)  the water's depth there now (< 0: dry, that high above the sea)
//   waterZ(x)    the z of the waterline now (inland of shoreZ as the tide rises; cached per u of x and per level)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const LW = 5 * 60 + 25, HW = 11 * 60, RANGE_M = 6.0, M_PER_U = 9.6;
  const on = () => WW.isScn('normandy') && !!WW.normandyTerrain && !!WW.scenarios.normandy.clock;
  const f = min => (1 - Math.cos(Math.PI * WW.clamp((min - LW) / (HW - LW), 0, 1))) / 2;
  function levelAt(t) {
    if (!on()) return 0;
    const C = WW.scenarios.normandy.clock, A = RANGE_M / M_PER_U * WW.normandyTerrain.VEX;
    return A * (f(C.minutes(t)) - f(C.minutes(C.H)));
  }
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  const level = () => levelAt(rt());
  const d0 = (x, z) => WW.terrain.depthAt(x, z) || -WW.terrain.heightRaw(x, z);
  function depth(x, z) { return d0(x, z) + level(); }
  let cache = new Map(), cacheL = NaN;
  function waterZ(x) {
    const L = level(), T = WW.normandyTerrain, z0 = T.shoreZ(x);
    if (!(L > 0)) return z0;
    if (Math.abs(L - cacheL) > 0.004) { cache.clear(); cacheL = L; }
    const k = Math.round(x);
    let z = cache.get(k);
    if (z === undefined) {                                  // inland from the H-hour line to where the sand is above the sea
      z = z0; for (let i = 0; i < 160 && d0(k, z + 0.25) + L > 0; i++) z += 0.25;
      cache.set(k, z);
    }
    return z;
  }
  WW.on('roundStart', () => { cache.clear(); cacheL = NaN; });
  WW.tide = { level, levelAt, depth, waterZ, LW, HW };
})(window.WW);
