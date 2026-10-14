// land_hold.js - WW.landHold: where the island base's planes wait to land (sim code: it draws no WW.rand). Loads after
// land_ground.js, before land_air.js, which calls it from goHome / landing. Two classes (C): the land bombers (B-17,
// B-26, Betty: the VAR types that cannot land on a deck) farther out and higher; the small planes (F4F, SBD, Zero, and
// any carrier plane diverted to the field) a little closer in and lower. The CAP is not holding (it flies transit).
//  - The marshal point (the carriers' "Charlie" pattern): each plane its own, FIX_R out (10-15 nm; a shorter radius
//    where the map edge cuts the circle) on the bearing nearest its own return track (TRACK_K) that keeps clear of
//    every known enemy ship's heavy-AA reach (aa.range x 2.2, the combat_aa.js HEAVY reach, + the orbit) and of the
//    enemy planes seen near the field (PLANE_R), re-chosen every FIX_T s; it moves only for a bearing clearer by HYST.
//    There it waits until the field calls its section in (land_flow.js call), so nobody orbits over the field.
//  - Home: a plane comes home at its class's holding height (HOLD_Y), not low over the island. With the field free
//    (recovering or idle, nobody in the circuit, no raid, nobody else already straight in) it goes straight in, called
//    at once (into the circuit DIRECT_R out); a mayday flies its route to the field (land_flow.js); the rest make for
//    their marshal points and join the queue there.
//  - Holding: a slow orbit round the marshal (a holder far from it, sent back from the circuit or the point moved, flies
//    round the island to it along its circle, as home, not across the field), stacked HOLD_DY apart by its place in the queue, until cleared (land_air.js
//    landing); with no runway open it holds there until its own bingo (land_air.js bingoOut), then diverts or ditches.
//  - A raid over the field (enemy planes within RAID_R of it): the bombers are kept off until it has passed (at Midway
//    the returning planes were held clear while the Japanese raid was on); an approach not yet past the outer marker is
//    sent back to the fix. After RAID_MAX s of holding under a raid they come in anyway (an emergency at once).
window.WW = window.WW || {};
(function () {
  'use strict';
  const FIX_T = 3, HYST = 30, RAID_R = 220, RAID_MAX = 60, FAR = 120, PLANE_R = 70, ARC = 0.6;
  // per class: marshal distance, orbit radius, holding height and step
  // (the marshal: 10-15 nm out on the plane's own return track, the small planes ~420 u out at ~1,800 m, the land
  // bombers ~500 u at ~3,000 m; a shorter radius where the map edge cuts it)
  const C = { L: { FIX_R: 500, ORB_R: 40, HOLD_Y: 50, HOLD_DY: 4 }, S: { FIX_R: 420, ORB_R: 30, HOLD_Y: 35, HOLD_DY: 3 } };
  const TRACK_K = 60;   // the marshal's pull toward the plane's own bearing from the field (its return track)
  const DIRECT_R = 400; // straight in: into the circuit this far out, so it turns onto the approach out there, not over the field
  const ST = { holds: 0, raidHolds: 0, sentBack: 0, smallHolds: 0 };

  const big = p => { const V = WW.landAir && WW.landAir.VAR[p.variant]; return !!(V && !V.carrier); };
  const cls = p => C[big(p) ? 'L' : 'S'];
  // the raid flag and the threats (b.ai.raid, b.ai.thr), every FIX_T s; with a plane p: its marshal point (p.mfix),
  // re-chosen every FIX_T s
  function update(b, K, p) {
    const a = b.ai, now = WW.time.now;
    if (!(a.thrT !== undefined && now - a.thrT < FIX_T && now >= a.thrT)) threats(b);
    if (!p) return null;
    if (p.mfix && now - p.mfix.t < FIX_T && now >= p.mfix.t) return p.mfix;
    if (p.mtrk === undefined) p.mtrk = Math.atan2(p.z - b.z, p.x - b.x);   // its return track: the bearing it came home on
    const ships = a.thr, ORB_R = K.ORB_R, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, old = p.mfix;
    let best = null, bs = -1e9, os = -1e9;
    for (let r = K.FIX_R; r >= K.FIX_R * 0.45 && !best; r *= 0.8) {   // the map edge cuts the circle: a shorter radius
      for (let n = 0; n < 16; n++) {
        const ang = n / 16 * Math.PI * 2, x = b.x + Math.cos(ang) * r, z = b.z + Math.sin(ang) * r;
        if (x < ORB_R || z < ORB_R || x > W - ORB_R || z > H - ORB_R) continue;
        let clr = 150; for (const s of ships) clr = Math.min(clr, WW.dist(x, z, s.x, s.z) - s.r - ORB_R);
        const sc = clr + TRACK_K * Math.cos(WW.angleDiff(ang, p.mtrk));
        if (old && old.n === n && old.r === r) os = sc;
        if (sc > bs) { bs = sc; best = { x, z, n, r }; }
      }
    }
    if (old && os > bs - HYST) best = { x: old.x, z: old.z, n: old.n, r: old.r };   // not clearer by HYST: the marshal stays
    return (p.mfix = Object.assign(best || { x: b.x, z: b.z, r: 0 }, { t: now }));
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
  function free(b) {
    update(b); const o = b.ops, q = b.ai.direct;
    if (q && q.alive && !q.removed && q.state === 'return' && q.carrier === b) return false;   // one straight in at a time (b.ai.direct): the rest to the marshal
    return !b.ai.raid && !b.ai.lq.length && o.mode !== 'launch' && WW.landGround.opsOpen(b);
  }
  // home: at holding height to the field (free, or an emergency: on its route, land_flow.js) or the fix; true once
  // there (land_air.js goHome enters 'landing') (to the fix round the island, not over it: along the FIX_R circle, ARC
  // rad ahead, while the fix is round the side)
  function goHome(p, b, dt) {
    const Q = cls(p), LF = WW.landFlow, em = LF && LF.mayday(p), F = em || p.direct || (p.direct = free(b)) && (b.ai.direct = p) ? b : update(b, Q, p), d = WW.dist(p.x, p.z, F.x, F.z);
    let tx = F.x, tz = F.z;
    if (em) { const r = LF.route(p, b); tx = r.x; tz = r.z; }
    if (F !== b) { const r = round(p, b, F, F.r); tx = r.x; tz = r.z; }
    p.fly(tx, tz, Q.HOLD_Y, dt, p.pt.speed);
    if (F === b && d < DIRECT_R && !em) p.called = true;   // straight in (the field free, or a mayday): called at once (land_flow.js); once sent straight in it keeps on (direct), no turning back for the marshal
    return d < (F === b ? DIRECT_R : Q.ORB_R + 30);
  }
  // the way to the fix F round the island: along the R circle, ARC rad ahead, while the fix is round the side
  const RP = { x: 0, z: 0 };
  function round(p, b, F, R) {
    const pa = Math.atan2(p.z - b.z, p.x - b.x), da = WW.angleDiff(pa, Math.atan2(F.z - b.z, F.x - b.x));
    if (Math.abs(da) <= ARC) { RP.x = F.x; RP.z = F.z; return RP; }
    const a = pa + Math.sign(da) * ARC; RP.x = b.x + Math.cos(a) * R; RP.z = b.z + Math.sin(a) * R; return RP;
  }
  // the orbit round the fix, n-th of the holders (its place in the queue)
  function orbit(p, b, n, dt) {
    const Q = cls(p), F = update(b, Q, p), a = Math.atan2(p.z - F.z, p.x - F.x) + 0.5;
    if (!p.held) { p.held = true; if (Q === C.L) ST.holds++; else ST.smallHolds++; }
    if (WW.dist(p.x, p.z, F.x, F.z) > Q.ORB_R + 40) { const r = round(p, b, F, F.r); p.fly(r.x, r.z, Q.HOLD_Y, dt, p.pt.speed); return; }
    p.fly(F.x + Math.cos(a) * Q.ORB_R, F.z + Math.sin(a) * Q.ORB_R, Q.HOLD_Y + Q.HOLD_DY * (n % 5), dt, p.pt.speed * (Q === C.L ? 0.8 : 0.72));
  }
  // kept off by a raid over the field (counts the time; RAID_MAX s, then it comes in); a cleared approach short of the
  // outer marker is sent back to hold
  function raidHold(p, b, dt) {
    update(b);
    if (!b.ai.raid || (WW.landFlow && WW.landFlow.mayday(p)) || (p.raidT || 0) > RAID_MAX) return false;
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
