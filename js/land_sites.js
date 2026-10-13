// land_sites.js - WW.landSites: the land targets that are not ships, one list for the sim's hooks (docs/NORMANDY_PLAN.md
// P3). Sim code: no WW.rand, no visuals. Each provider registers once at load (in load order, which is the order every
// hook runs them in) and answers the hooks it has; every hook is optional:
//   impact(nation, x, z, dmg, kind, cal) -> true   a shell or bomb that hit no ship landed here and was taken
//                                                   (combat.js landShell, combat_weapons.js updateBomb)
//   hitTest(nation, x, z, pad, prefer) -> unit     a unit of the provider whose footprint covers (x, z) (combat.js findHit,
//                                                   after the ships); the unit has alive and takeDamage(amt, x, z, kind, cal)
//   scan(nation, sight)                            intel.js: what the provider shows each side (sight(unit, by, quality))
//   shooters(out)                                  combat_aa.js: push the provider's live AA units onto out
//   roofAt(x, z) -> y                              aircraft.js: the top of its buildings under (x, z) (a low plane's floor)
//   groundAt(x, z) -> y                            the ground under (x, z) where bombs burst (0: the sea level)
//   bombardRange(ship, pref, t) -> pref            ai_surface.js prefRange for a target t the provider owns (owns(t))
// The island base (island_base.js) is the Pacific provider; Normandy's strongpoints (coast_defence.js) and landing
// craft (landing_craft.js) are the others. With one provider the hooks give exactly what island_base gave before.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const P = [], HIT = [], SHOOT = [], ROOF = [], GROUND = [];
  function register(p) {
    P.push(p);
    if (p.hitTest) HIT.push(p);
    if (p.shooters) SHOOT.push(p);
    if (p.roofAt) ROOF.push(p);
    if (p.groundAt) GROUND.push(p);
    return p;
  }
  function impact(nation, x, z, dmg, kind, cal) {
    for (let i = 0; i < P.length; i++) if (P[i].impact && P[i].impact(nation, x, z, dmg, kind, cal)) return true;
    return false;
  }
  function hitTest(nation, x, z, pad, prefer) {
    for (let i = 0; i < HIT.length; i++) { const u = HIT[i].hitTest(nation, x, z, pad, prefer); if (u) return u; }
    return null;
  }
  function scan(nation, sight) { for (let i = 0; i < P.length; i++) if (P[i].scan) P[i].scan(nation, sight); }
  // the ships plus every provider's AA units (a cached array; the ships array itself when no provider adds any)
  const arr = [];
  function shooters(ships) {
    if (!SHOOT.length) return ships;
    arr.length = 0;
    for (let i = 0; i < ships.length; i++) arr.push(ships[i]);
    const n = arr.length;
    for (let i = 0; i < SHOOT.length; i++) SHOOT[i].shooters(arr);
    return arr.length === n ? ships : arr;
  }
  function roofAt(x, z) { let t = 0; for (let i = 0; i < ROOF.length; i++) t = Math.max(t, ROOF[i].roofAt(x, z)); return t; }
  function groundAt(x, z) { let t = 0; for (let i = 0; i < GROUND.length; i++) t = Math.max(t, GROUND[i].groundAt(x, z)); return t; }
  function bombardRange(ship, pref, t) {
    for (let i = 0; i < P.length; i++) if (P[i].bombardRange && P[i].owns && P[i].owns(t)) return P[i].bombardRange(ship, pref, t);
    return pref;
  }
  // A gun on land's reload cycle (the island batteries, the strongpoints): the reload runs down; at 0, pick a target
  // (none: look again in 1 s), fire at it, and reload for next() x a WW.rand jitter of 0.9-1.15. One draw per shot,
  // after the shells' own (the order the island batteries always had).
  function gunTick(f, dt, pick, fire, next) {
    f.reload -= dt;
    if (f.reload > 0) return false;
    const t = pick();
    if (!t) { f.reload = 1; return false; }
    fire(t);
    f.reload = next(t) * WW.randRange(0.9, 1.15);
    return true;
  }
  WW.landSites = { register, gunTick, impact, hitTest, scan, shooters, roofAt, groundAt, bombardRange, providers: P, hasHit: () => HIT.length > 0 };
})(window.WW);
