// ships_nav.js — owner C (dev-nav). Hull footprint vs land, look-ahead steering (Ship.clearance / planNav), and the hard ship–ship / ship–wreck
// collision pass that backs up the soft personal-space steering in ships.js. Runtime calls only.
window.WW = window.WW || {};
(function () {
  const HARD = 0.5;    // a live hull sample never sits on water shallower than this
  const GROUND = 0.3;  // a sinking hull stops drifting before any sample gets this shallow
  const GAP = 0.4;     // hard minimum gap between hulls
  const EDGE = 3;

  // Hull sample points in local coords (bow +x): keel every <= 3 units bow→stern, plus both sides at
  // the quarters and midships. The same set is used by the planner, the hard gate and the wreck drift.
  function hullPoints(L, B) {
    const out = [], n = Math.max(2, Math.ceil(L / 3));
    for (let i = 0; i <= n; i++) out.push(-L / 2 + (L * i) / n, 0);
    for (const a of [-L / 4, 0, L / 4]) out.push(a, -B / 2, a, B / 2);
    return out; // flat [lx, lz, lx, lz, ...]
  }
  // Depth for a hull sample or planner probe: the map edge is open sea, not a wall, so a sample past it reads
  // the water at the edge. Only the centre is bounded (EDGE); a hull may overhang while it turns away.
  function depthIn(x, z) {
    return WW.terrain.depthAt(WW.clamp(x, 0, WW.cfg.MAP_W), WW.clamp(z, 0, WW.cfg.MAP_H));
  }
  function edgeDist(x, z) { return Math.min(x, z, WW.cfg.MAP_W - x, WW.cfg.MAP_H - z); }
  // Shallowest water under the hull of ship s placed at (x, z) heading h.
  function hullMin(s, x, z, h) {
    const P = s.hullPts, c = Math.cos(h), sn = Math.sin(h);
    let m = 1e9;
    for (let i = 0; i < P.length; i += 2) {
      const d = depthIn(x + P[i] * c - P[i + 1] * sn, z + P[i] * sn + P[i + 1] * c);
      if (d < m) m = d;
    }
    return m;
  }
  // Hard gate: hull clear of land, or (when already clipping) at least not getting worse.
  function hullOK(s, x, z, h, cur) {
    const m = hullMin(s, x, z, h);
    return m >= HARD || (cur !== undefined && cur < HARD && m >= cur - 1e-6);
  }

  // Capsule: keel segment shortened by the half-beam at each end, radius = half-beam.
  function capsule(s, out, x, z, h) {
    if (x === undefined) { x = s.x; z = s.z; h = s.heading; }
    const r = s.beam * 0.5, a = Math.max(0, s.stats.length * 0.5 - r), c = Math.cos(h), sn = Math.sin(h);
    out[0] = x - c * a; out[1] = z - sn * a; out[2] = x + c * a; out[3] = z + sn * a; out[4] = r;
    return out;
  }
  // Closest points between segments p0p1 and q0q1 (Ericson). Writes [px, pz, qx, qz], returns distance.
  const CP = [0, 0, 0, 0];
  function segSeg(p, q) {
    const d1x = p[2] - p[0], d1z = p[3] - p[1], d2x = q[2] - q[0], d2z = q[3] - q[1], rx = p[0] - q[0], rz = p[1] - q[1];
    const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
    let s = 0, t = 0;
    if (a < 1e-9 && e < 1e-9) { s = t = 0; }
    else if (a < 1e-9) { t = WW.clamp(f / e, 0, 1); }
    else {
      const c = d1x * rx + d1z * rz;
      if (e < 1e-9) s = WW.clamp(-c / a, 0, 1);
      else {
        const b = d1x * d2x + d1z * d2z, den = a * e - b * b;
        s = den > 1e-9 ? WW.clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = WW.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = WW.clamp((b - c) / a, 0, 1); }
      }
    }
    CP[0] = p[0] + d1x * s; CP[1] = p[1] + d1z * s; CP[2] = q[0] + d2x * t; CP[3] = q[1] + d2z * t;
    return Math.hypot(CP[0] - CP[2], CP[1] - CP[3]);
  }

  // Can ship s be pushed to (x, z)? Terrain depth at the centre plus the hull gate (wreck circles ignored:
  // the push itself is what moves it off a wreck).
  function canPlace(s, x, z) {
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (x < EDGE || x > W - EDGE || z < EDGE || z > H - EDGE) return false;
    if (!WW.terrain.isNavigable(x, z, s.stats.minDepth) && WW.terrain.depthAt(x, z) < WW.terrain.depthAt(s.x, s.z)) return false;
    return hullOK(s, x, z, s.heading, hullMin(s, s.x, s.z, s.heading));
  }
  function nudge(s, dx, dz) {
    if (!canPlace(s, s.x + dx, s.z + dz)) return false;
    s.x += dx; s.z += dz;
    // Driving into the contact: bleed speed and replan so the soft steering takes over again.
    const l = Math.hypot(dx, dz) || 1;
    if (Math.cos(s.heading) * dx / l + Math.sin(s.heading) * dz / l < -0.3) s.speed *= 0.92;
    s.navT = Math.min(s.navT, 0.05);
    return true;
  }

  const PA = [0, 0, 0, 0, 0], PB = [0, 0, 0, 0, 0];
  // Separation along the closest-point normal (or centre line / beam when the keels cross).
  function overlap(a, b) {
    capsule(a, PA); capsule(b, PB);
    const d = segSeg(PA, PB), ov = PA[4] + PB[4] + GAP - d;
    if (ov <= 0) return null;
    let nx = CP[0] - CP[2], nz = CP[1] - CP[3], l = Math.hypot(nx, nz);
    if (l < 1e-3) { nx = a.x - b.x; nz = a.z - b.z; l = Math.hypot(nx, nz); }
    if (l < 1e-3) { nx = -Math.sin(b.heading); nz = Math.cos(b.heading); l = 1; }
    return { ov, nx: nx / l, nz: nz / l };
  }

  // Deepest overlap of ship s (posed at x, z, h) with an immovable hull: a sinking ship or an above-water wreck.
  // Ship.move rejects any step that makes this worse, so ships never drive into them.
  const FA = [0, 0, 0, 0, 0], FB = [0, 0, 0, 0, 0];
  let wreckList = [];
  function fixedOverlap(s, x, z, h) {
    let worst = 0;
    const L = s.stats.length * 0.5 + GAP, sh = WW.world.ships, nS = sh.length, nW = wreckList.length;
    // ships that are sinking, then above-water wrecks (no per-call closure: this runs several times per ship per step)
    for (let i = 0; i < nS + nW; i++) {
      const f = i < nS ? sh[i] : wreckList[i - nS];
      if (i < nS ? !f.sinking : !(f.wreckInfo && f.wreckInfo.top > 0.2)) continue;
      if (f === s || f.removed || !f.hullPts) continue;
      const R = L + f.stats.length * 0.5, dx = x - f.x, dz = z - f.z;
      if (dx * dx + dz * dz > R * R) continue;
      capsule(s, FA, x, z, h); capsule(f, FB);
      const ov = FA[4] + FB[4] + GAP - segSeg(FA, FB);
      if (ov > worst) worst = ov;
    }
    return worst;
  }

  // Hard backstop after all ships moved: live pairs pushed apart (heavier moves less, by tonnage);
  // sinking ships and above-water wrecks are immovable obstacles.
  function resolve(ships, wrecks) {
    wreckList = wrecks;
    const live = [], fixed = [];
    for (const s of ships) {
      if (s.removed || !s.hullPts) continue;
      if (s.alive && !s.sinking) live.push(s); else if (s.sinking) fixed.push(s);
    }
    for (const w of wrecks) if (!w.removed && w.hullPts && w.wreckInfo && w.wreckInfo.top > 0.2) fixed.push(w);
    for (let it = 0; it < 3; it++) {
      let any = false;
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          if (a.submerged !== b.submerged) continue; // a submerged sub passes under surface ships
          const R = (a.stats.length + b.stats.length) * 0.5 + GAP, dx = a.x - b.x, dz = a.z - b.z;
          if (dx * dx + dz * dz > R * R) continue;
          const o = overlap(a, b); if (!o) continue;
          any = true;
          const ta = a.stats.tons, tb = b.stats.tons, wa = tb / (ta + tb), d = o.ov + 0.02;
          const okA = canPlace(a, a.x + o.nx * d * wa, a.z + o.nz * d * wa);
          const okB = canPlace(b, b.x - o.nx * d * (1 - wa), b.z - o.nz * d * (1 - wa));
          if (okA && okB) { nudge(a, o.nx * d * wa, o.nz * d * wa); nudge(b, -o.nx * d * (1 - wa), -o.nz * d * (1 - wa)); }
          else if (!nudge(a, o.nx * d, o.nz * d)) nudge(b, -o.nx * d, -o.nz * d);
        }
        for (const f of fixed) {
          const R = (a.stats.length + f.stats.length) * 0.5 + GAP, dx = a.x - f.x, dz = a.z - f.z;
          if (dx * dx + dz * dz > R * R) continue;
          const o = overlap(a, f); if (!o) continue;
          any = true;
          const d = o.ov + 0.02;
          if (!nudge(a, o.nx * d, o.nz * d)) { // pinned against land: try sliding along the beam either way
            const px = -o.nz, pz = o.nx;
            if (!nudge(a, (o.nx + px) * d, (o.nz + pz) * d)) nudge(a, (o.nx - px) * d, (o.nz - pz) * d);
          }
        }
      }
      if (!any) break;
    }
  }

  // Spawn: if the hull (not just the centre) touches the shallows, move to the nearest pose that clears.
  function placeHull(s, nav) {
    if (hullMin(s, s.x, s.z, s.heading) >= HARD) return;
    const md = s.stats.minDepth, x0 = s.x, z0 = s.z;
    for (let r = 2; r <= 60; r += 2) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      if (nav(x, z, md) && hullMin(s, x, z, s.heading) >= HARD + 0.3) { s.x = x; s.z = z; s.syncGroup(0); return; }
    }
  }

  // Wreck whose top is above water and covers (x, z), or null.
  function wreckAt(x, z) {
    const w = WW.world.wrecks || [];
    for (let i = 0; i < w.length; i++) {
      const o = w[i], dx = x - o.x, dz = z - o.z;
      if (o.top > 0.2 && dx * dx + dz * dz < o.radius * o.radius) return o;
    }
    return null;
  }
  function nav(x, z, d) { return WW.terrain.isNavigable(x, z, d) && !((WW.world.wrecks || []).length && wreckAt(x, z)); }

  // Look-ahead steering (WW.Ship methods). Candidate offsets (radians) around the wanted heading.
  const OFFS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.15, -1.15, 1.6, -1.6, 2.2, -2.2, Math.PI];
  const P = WW.Ship.prototype;
  // How far along heading h the hull stays clear: centre on deep water, bow and both beams on bow-depth water,
  // centre at least EM off the map edge. Inside either margin already, a probe that is no worse than here
  // (no shallower, no nearer the edge) still counts as clear, so a ship in a marginal spot sees its way out.
  P.clearance = function (h) {
    const md = this.stats.minDepth + 0.6, look = this.lookDist, step = Math.max(2.5, look / 12); // plan with a margin
    const c = Math.cos(h), s = Math.sin(h), hl = this.stats.length * 0.5, hb = this.beam * 0.5 + 0.5, bt = this.bowDepth;
    // a ship leaving the map (escapeEdge, endgame.js) plans as if the sea went on past that edge
    const ex = this.escapeEdge, W = WW.cfg.MAP_W, eDist = ex ? (x, z) => Math.min(ex < 0 ? 1e9 : x, ex > 0 ? 1e9 : W - x, z, WW.cfg.MAP_H - z) : edgeDist;
    const D = depthIn, em = Math.min(this.beam + 4, eDist(this.x, this.z)), d0 = WW.terrain.depthAt(this.x, this.z);
    const ok = d => {
      const x = ex ? WW.clamp(this.x + c * d, EDGE + 1, W - EDGE - 1) : this.x + c * d, z = this.z + s * d;
      if (eDist(x, z) < em) return false;
      if (!nav(x, z, md) && !(d0 < md && nav(x, z, this.stats.minDepth) && WW.terrain.depthAt(x, z) >= d0)) return false;
      return D(x + c * hl, z + s * hl) >= bt && D(x - s * hb, z + c * hb) >= bt && D(x + s * hb, z - c * hb) >= bt;
    };
    if (!ok(1)) return 1;
    if (!ok(2.5)) return 2.5;
    for (let d = Math.max(4, hl); d <= look; d += step) if (!ok(d)) return d;
    return look + step;
  };
  P.planNav = function (want) {
    const look = this.lookDist;
    this.clearAhead = this.clearance(this.heading);
    let best = want, bestScore = -1e9;
    // navAvoid: bearings the AI must not steer toward (a carrier's known gun ships), fresh for 0.5 s
    const av = this.navAvoid && WW.time.now - this.navAvoidT < 0.5 && this.navAvoid.length ? this.navAvoid : null;
    for (let i = 0; i < OFFS.length; i++) {
      const h = want + OFFS[i];
      const c = this.clearance(h);
      let score = (c >= look ? 1.2 : c / look) * 4 - Math.abs(OFFS[i]) * 0.7
        - Math.abs(WW.angleDiff(this.heading, h)) * 0.3;
      if (av) for (let j = 0; j < av.length; j++) if (Math.abs(WW.angleDiff(av[j], h)) < 1.2) score -= 2.5; // never detour toward a known threat
      if (score > bestScore) { bestScore = score; best = h; }
      if (i === 0 && c >= look && !(av && score < 4)) break; // straight line is clear (and not toward a threat)
    }
    best %= Math.PI * 2; this.navHeading = best < 0 ? best + Math.PI * 2 : best;
  };

  // Collision course (Ship.move): two ships closing so that their closest point of approach within CPA_T s falls inside
  // r (the pair's personal space): a push away from the other's position at the CPA, growing as the CPA nears and
  // tightens, so each turns off well before the hulls meet (head-on, both turn to starboard: the rule of the road).
  const CPA_T = 20, CPA_W = 2.2, CPA_OUT = [0, 0];
  function cpaPush(a, b, r) {
    const rx = a.x - b.x, rz = a.z - b.z, vx = Math.cos(a.heading) * a.speed - Math.cos(b.heading) * b.speed, vz = Math.sin(a.heading) * a.speed - Math.sin(b.heading) * b.speed;
    const v2 = vx * vx + vz * vz; if (v2 < 0.04) return null;
    const tc = -(rx * vx + rz * vz) / v2; if (tc <= 0 || tc > CPA_T) return null;     // opening, or too far off
    const cx = rx + vx * tc, cz = rz + vz * tc, dc = Math.hypot(cx, cz);
    if (dc >= r) return null;
    const w = CPA_W * (1 - tc / CPA_T) * (1 - dc / r);
    if (dc > r * 0.15) { CPA_OUT[0] = cx / dc * w; CPA_OUT[1] = cz / dc * w; }
    else { CPA_OUT[0] = -Math.sin(a.heading) * w; CPA_OUT[1] = Math.cos(a.heading) * w; } // head on: starboard (+z of the heading is to starboard, x east z south)
    return CPA_OUT;
  }

  WW.shipNav = { cpaPush, HARD, GROUND, EDGE, edgeDist, hullPoints, hullMin, hullOK, fixedOverlap, resolve, placeHull, wreckAt, nav };
})();
