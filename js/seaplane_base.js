// seaplane_base.js - WW.seaplaneBase: the island base's seaplane ramp (sim code: deterministic, no randomness).
// Midway's PBYs (VP-23, VP-44) flew from the seaplane base on Sand Island, in the lagoon; the Japanese flew H6K Mavis
// boats from their island bases (Jaluit, Wake). When a side owns the island, its flying boats (air_flyingboats.js:
// the Dumbo rescues and the air_patrol.js search patrols) start on the water at the foot of the ramp, taxi out, take
// off along a clear run, and come home to land in the lagoon, taxi in and are hauled up the ramp onto the apron.
// With no base (or the ramp knocked out) they come and go from their map edge, as before.
//  - place(base) (island_base.js build, before the camp is laid out): the ramp site - open water MIN_D deep a few
//    units off a low, flat shore; inside the reef ring on an atoll (the lagoon), on the lee side of a volcanic island
//    (away from the open sea); with at least one take-off run of RUN u of clear water; the apron on land, clear of the
//    taxiways, the climb-out lanes, the revetments and the facilities. It is a facility ('ramp': shells and bombs can
//    wreck it; the camp keeps off it). base.seaplane = { wx, wz (the ramp foot, afloat), lx, lz (the waterline),
//    ax, az (the apron), h (water -> apron), runs: [headings of clear take-off runs from the foot] }.
//  - Flight states (FlyingBoat.update hands them here): 'depart' (run-up at the ramp, taxi out, take-off run into the
//    wind, climb out -> 'inbound'), 'alightHome' (the approach to the lagoon and the touchdown short of the ramp) and
//    'taxiIn' (taxi to the foot, up the ramp, engines off: the boat is stowed, stats.home).
window.WW = window.WW || {};
(function () {
  'use strict';
  const SHORE = 10, RUN = 80, MIN_D = 1.3, R0 = 30, R1 = 190, APRON = 6;
  function ownedRamp(nation) {
    const b = WW.islandBase && WW.islandBase.base;
    if (!b || b.nation !== nation || !b.seaplane || b.seaplane.f.out) return null;
    return b.seaplane;
  }
  function water(x, z) { return WW.terrain.depthAt(x, z) >= MIN_D; }
  function runsFrom(x, z) { // headings with RUN u of open water ahead (every 6 u)
    const out = [];
    for (let i = 0; i < 24; i++) {
      const h = i / 24 * Math.PI * 2, c = Math.cos(h), s = Math.sin(h); let ok = true;
      for (let k = 6; k <= RUN && ok; k += 6) ok = water(x + c * k, z + s * k);
      if (ok) out.push(h);
    }
    return out;
  }
  function place(b) {
    const S = b.site, L = b.layout, AL = WW.airfieldLayout;
    const flat = (x, z) => { const d = WW.terrain.depthAt(x, z); return d < -0.6 && d > -3.2; };
    const clear = (x, z, r) => {
      const q = L.toL(x, z);
      if (AL.onNetwork(L, q.u, q.v, r) || AL.climbOut(L, q.u, q.v, r)) return false;
      if (b.facilities.some(f => Math.hypot(f.x - x, f.z - z) < f.r + r + 3)) return false;
      return !L.spots.some(p => Math.hypot(p.u - q.u, p.v - q.v) < Math.max(p.len, p.span) / 2 + r + 3);
    };
    const ox = S.atoll ? S.atoll.x : S.island ? S.island.x : S.x - 1, oz = S.atoll ? S.atoll.z : S.island ? S.island.z : S.z;
    const sea = Math.atan2(S.z - oz, S.x - ox);     // toward the open sea from the field
    let best = null, bs = -1e9;
    for (let r = R0; r <= R1; r += 4) for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2, wx = S.x + Math.cos(a) * r, wz = S.z + Math.sin(a) * r;
      if (!water(wx, wz) || WW.terrain.depthAt(wx, wz) > 6) continue;
      let lx = 0, lz = 0, hd = -1;   // the nearest shore toward the field, within SHORE
      for (let k = 2; k <= SHORE && hd < 0; k += 1) {
        const h = Math.atan2(S.z - wz, S.x - wx) + (k % 2 ? 0.3 : -0.3) * (k > 6 ? 1 : 0), x = wx + Math.cos(h) * k, z = wz + Math.sin(h) * k;
        if (WW.terrain.depthAt(x, z) < -0.3) { lx = x; lz = z; hd = h; }
      }
      if (hd < 0) continue;
      const ax = lx + Math.cos(hd) * APRON, az = lz + Math.sin(hd) * APRON;
      if (!flat(ax, az) || !flat(lx + Math.cos(hd) * 2, lz + Math.sin(hd) * 2) || !clear(ax, az, APRON)) continue;
      const runs = runsFrom(wx, wz); if (!runs.length) continue;
      const lagoon = S.atoll ? WW.dist(wx, wz, S.atoll.x, S.atoll.z) < S.atoll.R - 14 : false;
      const lee = -Math.cos(WW.angleDiff(Math.atan2(wz - S.z, wx - S.x), sea));    // 1: the side away from the open sea
      const sc = (lagoon ? 120 : 0) + lee * 40 + runs.length * 2 - r * 0.6;
      if (sc > bs) { bs = sc; best = { wx, wz, lx, lz, ax, az, h: hd, runs, lagoon }; }
    }
    b.seaplane = null;
    if (!best) return null;
    const f = { kind: 'ramp', x: best.ax, z: best.az, r: 4.5, hp: 220, maxHp: 220, out: false, outAt: 0, a: best.h };
    const q = L.toL(f.x, f.z); f.u = q.u; f.v = q.v; AL.addFac(L, q.u, q.v, APRON);
    b.facilities.push(f); best.f = f;
    return (b.seaplane = best);
  }

  // ---- flight: the flying boat's own states while it is homed on the ramp ----
  const WY = () => WW.flyingBoats.WATER_Y;
  function intoWind(R) { // the clear run most into the wind
    const w = WW.wind || { x: 1, z: 0 }, up = Math.atan2(-w.z, -w.x);
    let best = R.runs[0], bc = -2;
    for (const h of R.runs) { const c = Math.cos(WW.angleDiff(h, up)); if (c > bc) { bc = c; best = h; } }
    return best;
  }
  function depart(p, dt) {
    const R = p.ramp;
    if (p.speed < 15) { p.y = WY(); p.vy = 0; }                       // on the step until flying speed
    if (p.stT < 2.5) { p.speed = 0; return; }                         // the run-up at the ramp foot
    if (p.lh == null) p.lh = intoWind(R);
    p.turnTo(p.lh, dt, 0.55);
    if (Math.abs(WW.angleDiff(p.heading, p.lh)) > 0.25) { p.speed += WW.clamp(3 - p.speed, -3 * dt, 2 * dt); p.wakes(dt, 0.35); return; } // taxi round
    p.speed = Math.min(p.pt.speed, p.speed + dt * 3.2); p.wakes(dt, 0.6); // the take-off run
    if (p.speed < 15) return;
    p.vy = Math.min(2.2, p.vy + dt * 1.5);                             // unstick and climb out (integrate moves it)
    if (p.y > 10 || p.stT > 40) { p.lh = null; p.setState('inbound'); WW.flyingBoats.emit(p, 'takeoff'); }
  }
  // the landing: into the wind on one of the runs, touching down 55 u short of the ramp foot, rolling toward it
  function plan(p) {
    const R = p.ramp, up = intoWind(R), hl = up + Math.PI;         // land along a run, back toward the ramp
    const c = Math.cos(hl), s = Math.sin(hl), td = 55;
    return { h: hl, ax: R.wx - c * (td + 70), az: R.wz - s * (td + 70), tx: R.wx - c * td, tz: R.wz - s * td };
  }
  function alightHome(p, dt) {
    if (!p.plan) { p.plan = plan(p); p.app = true; }
    const L = p.plan;
    if (p.app) {
      p.fly(L.ax, L.az, 9, dt, p.pt.speed * 0.8, 0.8);
      const da = WW.dist(p.x, p.z, L.ax, L.az);
      if (da < 18 || (da < 45 && Math.cos(Math.atan2(L.tz - p.z, L.tx - p.x) - L.h) > 0.9 && Math.cos(p.heading - L.h) > 0.7)) p.app = false;
      if (p.stT > 60) { p.plan = null; p.stT = 0; }
      return;
    }
    const d = WW.dist(p.x, p.z, L.tx, L.tz), b = Math.atan2(L.tz - p.z, L.tx - p.x);
    p.turnTo(Math.abs(WW.angleDiff(L.h, b)) < 1.2 && d > 6 ? b : L.h, dt, 0.6);
    const along = (L.tx - p.x) * Math.cos(L.h) + (L.tz - p.z) * Math.sin(L.h);
    p.vy = WW.clamp((WY() - 0.4 + Math.max(0, along) * 0.11 - p.y) * 1.5, -3, 1.5);
    p.speed += WW.clamp(Math.max(12, Math.min(p.pt.speed * 0.8, 10 + d * 0.12)) - p.speed, -4 * dt, 4 * dt);
    if (p.y <= WY() + 0.08) { p.y = WY(); p.vy = 0; p.plan = null; p.setState('taxiIn'); if (WW.fx) WW.fx.splash(p.x, p.z, 1.4); }
  }
  function taxiIn(p, dt) {
    const R = p.ramp, b = WW.islandBase.base, gy = b ? b.site.padH : 1.2;
    p.vy = 0;
    if (!p.upT) {
      const d = WW.dist(p.x, p.z, R.wx, R.wz);
      p.y = WY() + Math.sin(p.t * 1.9) * 0.04;
      p.turnTo(Math.atan2(R.wz - p.z, R.wx - p.x), dt, 0.5);
      p.speed += WW.clamp(WW.clamp(d * 0.3, 1, 7) - p.speed, -4 * dt, 2 * dt); p.wakes(dt, 0.45);
      if (d < 2.5 || p.stT > 90) { p.upT = WW.time.now; p.speed = 0; }
      return;
    }
    // hauled up the ramp onto the apron (the beaching gear, a tractor): foot -> waterline -> apron over UP_T s
    const k = WW.clamp((WW.time.now - p.upT) / 9, 0, 1), k1 = Math.min(1, k * 2), k2 = Math.max(0, k * 2 - 1);
    p.x = k < 0.5 ? R.wx + (R.lx - R.wx) * k1 : R.lx + (R.ax - R.lx) * k2; p.z = k < 0.5 ? R.wz + (R.lz - R.wz) * k1 : R.lz + (R.az - R.lz) * k2;
    p.heading += WW.angleDiff(p.heading, R.h + Math.PI) * Math.min(1, dt * 1.2);   // hauled up tail first, nose to the water
    p.y = WY() + (gy + 0.5 - WY()) * k; p.speed = 0;
    if (k >= 1) { WW.flyingBoats.stats.home[p.nation]++; WW.flyingBoats.emit(p, 'home'); p.remove(); }
  }
  // the way home: to the ramp (at the lagoon: the landing), else null (the map edge)
  function home(p) { return p.ramp && !p.ramp.f.out ? p.ramp : null; }
  WW.seaplaneBase = { place, ramp: ownedRamp, depart, alightHome, taxiIn, home, runsFrom, STATES: { depart: 1, alightHome: 1, taxiIn: 1 } };
})();
