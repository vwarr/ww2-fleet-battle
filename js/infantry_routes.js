// infantry_routes.js - WW.infRoutes: where the infantry can go and what covers it on Omaha and Pointe du Hoc (P7 of
// docs/NORMANDY_PLAN.md). Sim code, no WW.rand. Reads the coast (terrain_normandy.js) and the obstacles.
//  - zone(x, z): where a point is across the beach: 'water' | 'flat' (the wet sand and the obstacle belts) | 'sand'
//    (the dry sand) | 'shingle' | 'shelf' | 'bluff' | 'top', with the draw factor (a draw is a killing ground)
//  - cover(x, z): 0-1, the share of fire it keeps off: an obstacle to lie behind on the flat, the shingle bank, the sea
//    wall, the folds and scrub of the bluffs; little in the open sand, the shelf or a draw (the guns were sited on them)
//  - gaps: the wire gaps blown behind the shingle (Bangalore torpedoes); a squad crosses the wire within GAP_R of one
//  - climbX(x): where a squad climbs: between the draws, never up one (they were the killing grounds; the men who got up
//    on the day went up the bluffs between them)
//  - assault(squad, wn): a flank or rear point to take a strongpoint from (the side away from the beach)
//  - hoc: the Rangers' cliff at Pointe du Hoc: the rope sites (grapnels fired from the LCAs) and the climb
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const GAP_R = 14, DRAW_K = 1.7;
  const T = () => WW.normandyTerrain;
  let gaps = [], obsCover = null;

  function zone(x, z) {
    const t = T(), st = t.station(x), u = z - st.zs;
    if (u < 0) return 'water';
    if (u < st.sand) return 'sand';
    if (u < st.sand + 3) return 'shingle';
    if (u < st.sand + 3 + st.shelf) return 'shelf';
    if (u < st.sand + 3 + st.shelf + st.bw) return 'bluff';
    return 'top';
  }
  // the obstacle cover: a grid of 2 u cells on the flat (the obstacles that still stand: a destroyed one gives none)
  function obstacleCover(x, z) {
    if (!obsCover) { obsCover = new Map(); for (const o of T().obstacles) obsCover.set(Math.floor(o.x / 2) * 10000 + Math.floor((o.z) / 2), o); }
    const o = obsCover.get(Math.floor(x / 2) * 10000 + Math.floor(z / 2)) || obsCover.get(Math.floor(x / 2) * 10000 + Math.floor((z + 2) / 2));
    return o && o.alive ? (o.kind === 'gate' || o.kind === 'hedgehog' ? 0.45 : 0.25) : 0;
  }
  const COVER = { water: 0.1, flat: 0.05, sand: 0.05, shingle: 0.7, shelf: 0.2, bluff: 0.5, top: 0.35 };
  function cover(x, z) {
    const zn = zone(x, z), st = T().station(x);
    let c = COVER[zn] || 0.1;
    if (zn === 'water') c = Math.max(c, obstacleCover(x, z));
    if (zn === 'shingle' && st.wall > 0.05) c = 0.85;                   // the sea wall
    if (st.drawK > 0.3 && (zn === 'shelf' || zn === 'bluff' || zn === 'top')) c *= 1 - 0.7 * st.drawK; // a draw: open, covered by every gun
    return c;
  }
  // the climb: away from the draws, to the nearest stretch of bluff between them
  function climbX(x) {
    let best = x;
    for (const d of WW.normandyData.DRAWS) {
      const lim = d.w * DRAW_K;
      if (Math.abs(x - d.x) < lim) best = d.x + (x < d.x ? -lim : lim);
    }
    return best;
  }
  // a point to take strongpoint wn from: on the bluff top beside or behind it, on the squad's side
  function assault(sq, wn) {
    const side = sq.x < wn.x ? -1 : 1, t = T();
    const x = wn.x + side * 22, z = Math.max(t.bluffTopZ(x) + 8, wn.z + 10);
    return { x, z };
  }
  function gapNear(x) { for (const g of gaps) if (Math.abs(g.x - x) < GAP_R) return g; return null; }
  function addGap(x, by) { const g = { x, t: WW.time.now, by }; gaps.push(g); WW.emit('gapBlown', g); return g; }
  // Pointe du Hoc: the rope sites on the east face (where the LCAs grounded) and the top of the cliff above them
  const HOC = { x0: 724, x1: 752 };
  function hocTop(x) { return { x, z: T().bluffTopZ(x) + 4 }; }
  function reset() { gaps = []; obsCover = null; }
  WW.on('roundStart', () => { if (WW.isScn('normandy')) reset(); });
  WW.infRoutes = { zone, cover, climbX, assault, gapNear, addGap, hocTop, HOC, GAP_R, get gaps() { return gaps; }, reset };
})(window.WW);
