// land_hold.js - WW.landHold: where the island base's planes wait to land (sim code: it draws no WW.rand). Loads after
// land_ground.js, before land_air.js, which calls it from goHome / landing. Two classes, each with its own fix (C):
// the land bombers (B-17, B-26, Betty: the VAR types that cannot land on a deck) far out and high; the small planes
// (F4F, SBD, Zero, and any carrier plane diverted to the field) closer in and lower: they are short-legged. The CAP
// over the field is not holding (it flies transit, never comes here).
//  - The holding fix: one per base and class, re-chosen every FIX_T s, FIX_R from the field on the bearing that keeps
//    clear of every known enemy ship's heavy-AA reach (aa.range x 2.2, the combat_aa.js HEAVY reach, + the orbit) and
//    of the enemy planes seen near the field (PLANE_R) by the most, tie-broken toward the approach end (downwind of the
//    runway, so the run in to the outer marker is short).
//  - Home: a plane comes home at its class's holding height (HOLD_Y: the bombers 2,400-4,400 m), not low over the
//    island. With the field free (recovering or idle, nobody in the circuit, no raid) it goes straight in; else it makes for the fix and joins the queue there.
//  - Holding: a slow orbit round the fix, stacked HOLD_DY apart by its place in the queue, until cleared (land_air.js
//    landing); with no runway open it holds there (land_air.js HOLD_MAX / HOLD_BIG), then diverts or ditches.
//  - A raid over the field (enemy planes within RAID_R of it): the bombers are kept off until it has passed (at Midway
//    the returning planes were held clear while the Japanese raid was on); an approach not yet past the outer marker is
//    sent back to the fix. After RAID_MAX s of holding under a raid they come in anyway.
window.WW = window.WW || {};
(function () {
  'use strict';
  const FIX_T = 3, RAID_R = 220, RAID_MAX = 60, FAR = 120, PLANE_R = 70, ARC = 0.6;
  // per class: fix distance, orbit radius, holding height and step (the small planes: 1,200-2,000 m, 140 u out)
  const C = { L: { FIX_R: 190, ORB_R: 40, HOLD_Y: 40, HOLD_DY: 4 }, S: { FIX_R: 140, ORB_R: 26, HOLD_Y: 24, HOLD_DY: 3 } };
  const ST = { holds: 0, raidHolds: 0, sentBack: 0, smallHolds: 0 };

  const big = p => { const V = WW.landAir && WW.landAir.VAR[p.variant]; return !!(V && !V.carrier); };
  const cls = p => C[big(p) ? 'L' : 'S'];
  // the base's holding fix for class K and the raid flag (b.ai.hfix[K], b.ai.raid), re-chosen every FIX_T s
  function update(b, K) {
    const a = b.ai, now = WW.time.now, k = K === C.S ? 'S' : 'L';
    a.hfix = a.hfix || {};
    if (a.hfix[k] && now - a.hfix[k].t < FIX_T && now >= a.hfix[k].t) return a.hfix[k];
    if (!(a.thrT !== undefined && now - a.thrT < FIX_T && now >= a.thrT)) threats(b);
    const ships = a.thr, Q = C[k], FIX_R = Q.FIX_R, ORB_R = Q.ORB_R;
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, app = (WW.wind ? WW.wind.a : b.heading + Math.PI);   // the approach end: downwind of the field
    let best = null, bs = -1e9;
    for (let n = 0; n < 16; n++) {
      const ang = n / 16 * Math.PI * 2, x = b.x + Math.cos(ang) * FIX_R, z = b.z + Math.sin(ang) * FIX_R;
      if (x < ORB_R || z < ORB_R || x > W - ORB_R || z > H - ORB_R) continue;
      let clr = 150; for (const s of ships) clr = Math.min(clr, WW.dist(x, z, s.x, s.z) - s.r - ORB_R);
      const sc = clr + 25 * Math.cos(WW.angleDiff(ang, app));
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    return (a.hfix[k] = Object.assign(best || { x: b.x, z: b.z }, { t: now }));
  }
  // the threats round the field (b.ai.thr) and the raid flag, every FIX_T s
  function threats(b) {
    const a = b.ai; a.thrT = WW.time.now;
    const ships = a.thr = [];   // the threats { x, z, r }, copied: intel.js filter() hands back a shared array
    if (WW.intel) for (const c of WW.intel.enemyShips(b.nation, { fresh: 60 })) {
      const u = c.unit; if (u && u.alive && !u.sinking && !u.isBase && u.stats && u.stats.aa) ships.push({ x: c.x, z: c.z, r: u.stats.aa.range * 2.2 });
    }
    a.raid = false;   // and the enemy planes round the field (a raid, a sweep, CAP over the fleet): kept clear of by PLANE_R
    if (WW.intel) for (const c of WW.intel.enemyPlanes(b.nation)) {
      const u = c.unit; if (!u || !u.alive || u.y <= 3) continue;
      const d = WW.dist(c.x, c.z, b.x, b.z);
      if (d < RAID_R) a.raid = true;
      if (d < C.L.FIX_R + PLANE_R + C.L.ORB_R) ships.push({ x: c.x, z: c.z, r: PLANE_R });
    }
  }
  // free to come straight in: the field recovering or idle, the runway open, nobody waiting, no raid
  function free(b) { update(b, C.L); const o = b.ops; return !b.ai.raid && !b.ai.lq.length && o.mode !== 'launch' && WW.landGround.opsOpen(b); }
  // home: at holding height to the field (free) or the fix; true once
  // there (land_air.js goHome enters 'landing') (to the fix round the island, not over it: along the FIX_R circle, ARC
  // rad ahead, while the fix is round the side)
  function goHome(p, b, dt) {
    const Q = cls(p), F = free(b) ? b : update(b, Q), d = WW.dist(p.x, p.z, F.x, F.z), FIX_R = Q.FIX_R;
    let tx = F.x, tz = F.z;
    if (F !== b) {
      const pa = Math.atan2(p.z - b.z, p.x - b.x), da = WW.angleDiff(pa, Math.atan2(F.z - b.z, F.x - b.x));
      if (Math.abs(da) > ARC) { const a = pa + Math.sign(da) * ARC; tx = b.x + Math.cos(a) * FIX_R; tz = b.z + Math.sin(a) * FIX_R; }
    }
    p.fly(tx, tz, Q.HOLD_Y, dt, p.pt.speed);
    return d < (F === b ? 150 : Q.ORB_R + 30);
  }
  // the orbit round the fix, n-th of the holders (its place in the queue)
  function orbit(p, b, n, dt) {
    const Q = cls(p), F = update(b, Q), a = Math.atan2(p.z - F.z, p.x - F.x) + 0.5;
    if (!p.held) { p.held = true; if (Q === C.L) ST.holds++; else ST.smallHolds++; }
    p.fly(F.x + Math.cos(a) * Q.ORB_R, F.z + Math.sin(a) * Q.ORB_R, Q.HOLD_Y + Q.HOLD_DY * (n % 5), dt, p.pt.speed * (Q === C.L ? 0.8 : 0.72));
  }
  // kept off by a raid over the field (counts the time; RAID_MAX s, then it comes in); a cleared approach short of the
  // outer marker is sent back to hold
  function raidHold(p, b, dt) {
    update(b, C.L);
    if (!b.ai.raid || (p.raidT || 0) > RAID_MAX) return false;
    if (!p.raidT) ST.raidHolds++;
    p.raidT = (p.raidT || 0) + dt;
    if (p.cleared && !p.apOut && p.rwPh === 'circuit') { p.cleared = false; ST.sentBack++; }
    return !p.cleared;
  }
  // far out at the fix (cleared together with the plane ahead, to cover the run in to the outer marker)
  const far = (p, ox, oz) => WW.dist(p.x, p.z, ox, oz) > FAR;
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });

  WW.landHold = { big, update, free, goHome, orbit, raidHold, far, C, stats: ST };
})();
