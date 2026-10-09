// air_attack.js — the strike's attack (WW.strike.dive / torp, split out of air_strikes.js). Loads right after air_strikes.js
// (land_air.js wraps these two). Sim code: WW.rand only.
// - Dive bombers (docs/PLANE_REVIEW.md P7): a short, wide wheel at the push-over height just outside the dive point
//   (USN SBD ~66 u at 70 deg, IJN D3A ~52 u at 57 deg: PLANE_NATION dive.push / ang), peel off in turn, wing over,
//   push over, dive with the dive brakes holding ~21-23 u/s (dive.brake), release on the dive line and pull out hard.
//   Push-over -> release takes ~2.2-3 s, long enough to film.
// - Torpedo bombers (P8): descend on the approach, split for an anvil (both bows) at SET_R, turn in together, run in
//   low and slow (runK x cruise) and drop 80-100 u out, then pop up over the ship.
// - Doctrine (fleetGroups air.press0 / pressT x the admiral's aggression): how hard the attack presses: a pressing
//   pilot releases lower, drops closer and follows the plane ahead sooner. IJN veterans press from the start; the USN
//   is cautious early and presses later in the battle.
window.WW = window.WW || {};
(function () {
  const S = WW.strike;
  if (!S) return;
  const G = 9.8;                               // G matches combat_weapons.js bomb gravity
  // Tallest point of each ship type above the water (measured model bounds), for pull-out / pop-up clearance.
  const TOP = S.TOP || { carrier: 6.4, battleship: 7.2, cruiser: 5.2, destroyer: 3.7, submarine: 0.7, pt: 2.0 };
  const CLEAR = 3.5;                           // plane half-extent at PLANE_SCALE 1.7 (~1) + 2.5 margin
  const DIVE_V0 = 18;                          // the dive starts at least this fast; the brakes then hold pt.brake
  const Q = 3.5, Q_MAX = 6;                    // pull-out pitch rate (rad/s); raised if the bottom would be low
  // Anvil spread: the n-th torpedo bomber on a side sets up AV[n] x AV_DA rad round from the 54-degree point (~28 u
  // apart at SET_R) and runs in from its own bearing, a clear gap between wingtips.
  const AV = [0, 1, -1, 2, -2], AV_DA = 0.2;
  const WHEEL_W = 6;                           // the wheel sits this far outside the horizontal reach of the dive
  const SET_R = 140, DROP_FAR = 100, DROP_NEAR = 82, TORP_RANGE = 140;   // anvil radius, drop range by press, torpedo run
  let grps = new Map();
  const ST = { dives: 0, runs: 0, pushT: [] };

  // ---------- doctrine: how hard this plane presses its attack (0 cautious .. 1 veterans) ----------
  function press(pl) {
    const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(pl.nation) : null, a = d && d.air;
    if (!a) return 1;
    const p0 = a.press0 === undefined ? 1 : a.press0;
    let p = a.pressT > 0 ? p0 + (1 - p0) * Math.min(1, WW.time.now / a.pressT) : p0;
    const B = WW.fleetGroups && WW.fleetGroups.BASE[pl.nation];
    if (B && d.aggression > 0) p *= d.aggression / B.aggression;   // the admiral's temperament
    return WW.clamp(p, 0, 1);
  }

  // ---------- per-target attack coordination ----------
  function grp(t) {
    let g = grps.get(t);
    if (!g) { g = { nextDive: 0, side: 0, goT: -99 }; grps.set(t, g); }
    return g;
  }
  function ground(x, z) { return WW.terrain ? Math.max(0, -WW.terrain.depthAt(x, z)) : 0; }
  function overLand(pl, n, a) { const g = groundAhead(pl, n); return g > 0 ? Math.max(a, g + 3) : a; } // a, or 3 over land ahead
  function groundAhead(pl, n) { // highest ground under and ahead of the plane (n samples, 6 apart)
    const c = Math.cos(pl.heading), s = Math.sin(pl.heading);
    let m = 0;
    for (let i = 0; i <= n; i++) m = Math.max(m, ground(pl.x + c * i * 6, pl.z + s * i * 6));
    return m;
  }
  function wet(x0, z0, x1, z1) { // open water (depth >= 1.2) all along a torpedo track
    if (!WW.terrain) return true;
    const n = Math.ceil(WW.dist(x0, z0, x1, z1) / 4);
    for (let i = 0; i <= n; i++) if (WW.terrain.depthAt(WW.lerp(x0, x1, i / n), WW.lerp(z0, z1, i / n)) < 1.2) return false;
    return true;
  }
  function topNear(t, r) { // highest ship top within r of the target (escorts under the pull-out)
    let m = TOP[t.type] || 6;
    for (const s of WW.world.ships) if (s.alive && !s.submerged && WW.dist2(s.x, s.z, t.x, t.z) < r * r) m = Math.max(m, TOP[s.type] || 6);
    return m;
  }

  // ---------- dive bombers ----------
  function setDV(pl) { pl.speed = pl.V * Math.cos(pl.gam); pl.vy = pl.V * Math.sin(pl.gam); }
  // Altitude lost in a pull-out from flight-path angle gam at speed V and pitch rate q (plus the ramp-up).
  // Integrates the same pull model as pullOut() (ramp, pitch rate, bleed) + 0.5 margin; release fires a step early.
  function pullLoss(V, gam, q) {
    let y = 0, qq = 0; const h = 0.02;
    for (let i = 0; i < 100 && gam < 0; i++) { qq = Math.min(q, qq + Q / 0.06 * h); gam += qq * h; V = Math.max(18, V - 3 * h); y -= V * Math.sin(gam) * h; }
    return y + 0.5;
  }
  function startPull(pl) { pl.phase = 'pull'; pl.q = 0; pl.turn = 0; }
  // Dive-line aim: the target's position at bomb impact, raised by the bomb's gravity sag below the line.
  function diveAim(pl, t) {
    const ang = pl.pt.ang || 1.2;
    const vy0 = Math.min(pl.V * Math.sin(pl.gam), -Math.sin(ang) * pl.V), rel = pl.relAlt || 18;
    const tb = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * rel)) / G, tt = Math.max(0, pl.y - rel) / -vy0 + tb;
    pl.aimX = t.x + Math.cos(t.heading) * t.speed * tt; pl.aimZ = t.z + Math.sin(t.heading) * t.speed * tt;
    pl.aimY = 0.5 * G * tb * tb;
  }
  function wheelR(pt) { return (pt.push || 60) / Math.tan(pt.ang || 1.2) + WHEEL_W; }
  function dive(pl, dt) {
    if (pl.phase === 'pull' || pl.phase === 'exit') { pullOut(pl, dt); return; }
    const t = pl.validTarget();
    if (pl.phase && t !== pl.diveTgt) { startPull(pl); pullOut(pl, dt); return; } // target gone mid-dive: recover, keep the bomb
    if (!t) { pl.state = 'return'; pl.sk = null; return; }
    if (S.formation(pl, dt)) return;
    const pt = pl.pt, ang = pt.ang || 1.2, brake = pt.brake || 22, dh = pl.hd(t), now = WW.time.now;
    if (pl.phase === 'roll' || pl.phase === 'dive') {
      pl.state = 'attack'; pl.phaseT += dt;
      diveAim(pl, t);
      const dx = pl.aimX - pl.x, dz = pl.aimZ - pl.z, hd = Math.hypot(dx, dz);
      const gw = WW.clamp(Math.atan2(pl.aimY - pl.y, hd), -ang - 0.12, -ang + 0.1);   // the nation's dive angle
      if (pl.phase === 'roll') { // wing-over: roll toward the target, hold until the sight line is at the dive angle, push over
        const he = pl.turnTo(Math.atan2(dz, dx), dt, 2.4);
        if (!pl.push && Math.atan2(pl.y - pl.aimY + 6, Math.max(0.1, hd - 8)) >= ang - 0.04) pl.push = true; // from where the push-over ends
        if (pl.push) pl.gam = Math.max(gw, pl.gam - 1.8 * dt);
        else pl.gam += WW.clamp(-0.1 - pl.gam, -dt, dt);
        pl.V += WW.clamp(brake - pl.V, -5 * dt, 3 * dt);
        if (pl.push && ((pl.gam <= gw + 0.05 && Math.abs(he) < 0.25) || pl.phaseT > 3)) pl.phase = 'dive';
        else if (!pl.push && (hd < 4 || pl.phaseT > 3.5)) { pl.phase = null; setDV(pl); return; } // overshot: go round
      } else {
        pl.turnTo(Math.atan2(dz, dx), dt, 1.0);
        pl.gam += WW.clamp(gw - pl.gam, -1.0 * dt, 1.0 * dt);
        pl.V += WW.clamp(brake - pl.V, -6 * dt, 4 * dt);             // the dive brakes hold it near brake speed
      }
      setDV(pl);
      pl.relAlt = pl.floor + pullLoss(pl.V, Math.min(pl.gam, gw), Q);
      if (pl.y + pl.vy * dt <= pl.relAlt) { // release on the dive line: the bomb keeps the plane's velocity
        pl.dropV = { x: Math.cos(pl.heading) * pl.speed, y: pl.vy, z: Math.sin(pl.heading) * pl.speed };
        WW.combat.dropBomb(pl, t); pl.dropped(); pl.dropV = null;
        if (ST.pushT.length < 400) ST.pushT.push(+(now - pl.rollT).toFixed(2));
        startPull(pl);
      }
      return;
    }
    const g = grp(t), R = wheelR(pt), alt = pt.push || 60;
    pl.state = dh < R + 50 ? 'attack' : 'transit';
    // Peel off in turn from the wheel; a pressing squadron follows the plane ahead sooner.
    const rel = Math.abs(WW.angleDiff(pl.heading, Math.atan2(t.z - pl.z, t.x - pl.x)));
    if (now >= g.nextDive && dh > R - 12 && dh < R + 16 && rel < 1.9 && pl.y > alt - 12 && pl.ordnance && (!WW.cag || WW.cag.diveOK(pl, t, g))) {
      const pr = press(pl);
      g.nextDive = now + WW.randRange(0.8, 1.3) * (1.45 - 0.45 * pr);
      pl.phase = 'roll'; pl.phaseT = 0; pl.rollT = now; pl.diveTgt = t; pl.push = false; pl.gam = Math.atan2(pl.vy, Math.max(1, pl.speed)); pl.V = Math.max(DIVE_V0, Math.hypot(pl.vy, pl.speed));
      pl.floor = Math.max(topNear(t, 40), 4, ground(t.x, t.z), groundAhead(pl, 6)) + CLEAR + (1 - pr) * 4; // cautious: release higher
      pl.relAlt = pl.floor + 8; ST.dives++;
      return;
    }
    if (dh < R + 20) pl.orbit(t.x, t.z, R, alt + (pl.fi || 0) % 4 * 1.2, dt);
    else pl.fly(t.x, t.z, alt, dt, pt.speed);
  }
  // Hard, fast recovery: pitch rate ramps to Q in ~0.06 s (more if the bottom would be under the floor).
  function pullOut(pl, dt) {
    pl.turn = 0;
    if (pl.phase === 'pull') {
      const need = pl.y - pullLoss(pl.V, pl.gam, Q) < (pl.floor || 11) ? Q_MAX : Q;
      pl.q = Math.min(need, pl.q + Q / 0.06 * dt);
      pl.gam = Math.min(0.35, pl.gam + pl.q * dt); pl.V = Math.max(pl.pt.speed * 0.8, pl.V - 3 * dt);
      if (pl.gam >= 0.35) { pl.phase = 'exit'; pl.phaseT = 1.6; }
    } else { // climb away straight ahead, then head home
      pl.phaseT -= dt; pl.gam += WW.clamp(0.25 - pl.gam, -0.3 * dt, 0.3 * dt); pl.V += WW.clamp(pl.pt.speed - pl.V, -4 * dt, 4 * dt);
      if (pl.phaseT <= 0) { pl.phase = null; pl.sk = null; if (!pl.ordnance) pl.state = 'return'; } // still armed: back to the wheel
    }
    setDV(pl);
  }

  // ---------- torpedo bombers ----------
  function freeAV(pl, t) { // the first anvil bearing on this side not held by a live bomber on the same target
    const used = new Set();
    for (const p of WW.world.planes) if (p !== pl && p.alive && p.kind === 'torpedo' && p.target === t && p.side === pl.side && (p.sk === 'anvil' || p.phase === 'run')) used.add(p.av);
    for (const a of AV) if (!used.has(a)) return a;
    return AV[used.size % AV.length];
  }
  function sideCount(t, side) { let n = 0; for (const p of WW.world.planes) if (p.alive && p.kind === 'torpedo' && p.target === t && p.side === side && (p.sk === 'anvil' || p.phase === 'run')) n++; return n; }
  function clearOf(pl) { // { x, z } 20 u away from the nearest same-side bomber inside 10 u, else null
    let n = null, bd = 100;
    for (const p of WW.world.planes) {
      if (p === pl || !p.alive || p.nation !== pl.nation || p.kind !== 'torpedo' || p.state !== 'attack') continue;
      const d2 = WW.dist2(p.x, p.z, pl.x, pl.z); if (d2 < bd) { bd = d2; n = p; }
    }
    if (!n) return null;
    const d = Math.sqrt(bd) || 1; return { x: (pl.x - n.x) / d * 20, z: (pl.z - n.z) / d * 20 };
  }
  function torp(pl, dt) {
    const t = pl.validTarget();
    pl.phaseT -= dt;
    if (pl.phase === 'out') { popUp(pl, pl.outTgt && pl.outTgt.alive ? pl.outTgt : null, dt); return; } // the ship we just ran at
    if (!t) { pl.state = 'return'; pl.phase = null; pl.sk = null; return; }
    if (S.formation(pl, dt)) return;
    const dh = pl.hd(t), now = WW.time.now, g = grp(t);
    if (pl.phase === 'run') { run(pl, t, dh, dt); return; }
    if (pl.sk !== 'anvil') { // approach: let down from the cruise height, then split for the anvil
      pl.state = 'transit';
      pl.fly(t.x, t.z, dh > SET_R + 80 ? (pl.pt.alt || 30) : 14, dt, pl.pt.speed);
      if (dh < SET_R + 30) { // alternate the bows, and even them out if one side lost planes
        const a = sideCount(t, -1), b = sideCount(t, 1);
        pl.side = a === b ? (g.side++ % 2 ? 1 : -1) : a < b ? -1 : 1;
        pl.av = freeAV(pl, t); pl.anT = now;
        pl.sk = 'anvil';
      }
      return;
    }
    // Anvil setup: work round the target at SET_R to a point ~54 deg off its bow on our side, then hold low.
    pl.state = 'attack';
    const R = SET_R, ts = 6, px = t.x + Math.cos(t.heading) * t.speed * ts, pz = t.z + Math.sin(t.heading) * t.speed * ts;
    const want = t.heading + pl.side * (0.95 + (pl.av || 0) * AV_DA), cur = Math.atan2(pl.z - pz, pl.x - px), da = WW.angleDiff(cur, want);
    const a = Math.abs(da) > 0.5 ? cur + Math.sign(da) * 0.5 : want;   // circle round rather than cross the target
    const sx = WW.clamp(px + Math.cos(a) * R, 10, WW.cfg.MAP_W - 10), sz = WW.clamp(pz + Math.sin(a) * R, 10, WW.cfg.MAP_H - 10); // torpedoes die off-map
    const ds = WW.dist(pl.x, pl.z, sx, sz);
    if (a === want && now > (pl.flipT || 0) && !wet(WW.lerp(sx, px, 0.25), WW.lerp(sz, pz, 0.25), WW.lerp(sx, px, 0.8), WW.lerp(sz, pz, 0.8))) {
      pl.side = -pl.side; pl.av = freeAV(pl, t); pl.flipT = now + 6; // land in the way: try the other bow
    }
    pl.ready = Math.abs(da) < 0.5 && ds < 18;
    const sep = clearOf(pl), hy = Math.abs(pl.av || 0) * 1.5;   // sidestep a squadron mate closer than 10; stepped heights
    if (ds < 12 && !sep) pl.orbit(sx, sz, 12, overLand(pl, 5, 6 + hy), dt);
    else pl.fly(sx + (sep ? sep.x : 0), sz + (sep ? sep.z : 0), overLand(pl, 5, (Math.abs(da) < 0.5 ? 6 : 14) + hy), dt, pl.pt.speed);
    // Both groups turn in together: all ready, someone has waited too long, or a run just started.
    let go = now - g.goT < 7;
    if (!go && pl.ready && !(WW.cag && WW.cag.vtWait(pl, t, g))) {
      go = true;
      for (const p of WW.world.planes) {
        if (!p.alive || p.kind !== 'torpedo' || p.target !== t || p.sk !== 'anvil' || p.phase) continue;
        if (now - p.anT > 16) { go = true; break; }
        if (!p.ready) go = false;
      }
      if (go) g.goT = now;
    }
    // Turn in once pointing at the target (or after 3 s), so nobody starts the run with a 180-degree turn.
    if (go && ((ds < 30 && Math.abs(WW.angleDiff(pl.heading, Math.atan2(t.z - pl.z, t.x - pl.x))) < 1) || now - g.goT > 6)) {
      pl.phase = 'run'; pl.sk = null; pl.dropR = WW.lerp(DROP_FAR, DROP_NEAR, press(pl)); ST.runs++;
    }
  }
  function run(pl, t, dh, dt) {
    pl.state = 'attack';
    const tv = WW.torpSpec ? WW.torpSpec(pl.nation, 'air').speed : WW.TORPEDO.speed;
    const tt = dh / tv, px = t.x + Math.cos(t.heading) * t.speed * tt, pz = t.z + Math.sin(t.heading) * t.speed * tt;
    const d = pl.turnTo(Math.atan2(pz - pl.z, px - pl.x), dt, 1.0), alt = overLand(pl, 5, 1.8); // wave height, hop any land
    pl.speedTo(pl.pt.speed * (pl.pt.runK || 0.8), dt);    // slowed for the drop (Mk 13 / Type 91 limits)
    pl.vy += WW.clamp(WW.clamp((alt - pl.y) * 2.5, -7, 9) - pl.vy, -14 * dt, 14 * dt);
    const c = Math.cos(pl.heading), s = Math.sin(pl.heading), dropR = pl.dropR || DROP_FAR;
    if (pl.y < 2.8) { // prop wash spray on the water under the plane (visual)
      pl.sprayT = (pl.sprayT || 0) - dt;
      if (pl.sprayT <= 0 && WW.fx) { pl.sprayT = 0.1; WW.fx.wake(pl.x - c * 1.2, pl.z - s * 1.2, pl.heading, 0.55); }
    }
    const drop = dh < dropR && pl.y < 3 && Math.abs(d) < 0.3 && wet(pl.x + c, pl.z + s, WW.lerp(pl.x, px, 0.8), WW.lerp(pl.z, pz, 0.8));
    if (drop) {
      WW.combat.fireTorpedo(pl, pl.x + c, pl.z + s, pl.heading, pl.nation, TORP_RANGE);
      if (WW.fx) WW.fx.splash(pl.x + c * 3, pl.z + s * 3, 0.9);
      pl.dropped();
    }
    // Released, or not lined up by 30 inside the drop range: pop up over the ship (the latter keeps its torpedo and comes round again).
    if (drop || dh < dropR - 30) { pl.outTgt = t; pl.phase = 'out'; pl.phaseT = drop ? 4 : 3; pl.passed = false; pl.lastD = dh; pl.floor = Math.max(topNear(t, 30), 2, groundAhead(pl, 8)) + CLEAR; }
  }
  // After release: pop up and fly over the target ship, then climb away and head home.
  function popUp(pl, t, dt) {
    pl.speedTo(pl.pt.speed, dt);
    let alt = 18;
    if (t && !pl.passed) {
      const dh = pl.hd(t);
      if (dh > pl.lastD + 0.01) pl.passed = true;
      pl.lastD = dh;
      alt = pl.floor + 1.5 + Math.abs(pl.av || 0) * 2.5 + (pl.side > 0 ? 1.5 : 0); // stepped: crossing runs pass apart
      if (dh > t.stats.length * 0.5 + 6) pl.turnTo(Math.atan2(t.z - pl.z, t.x - pl.x), dt, 0.6); else pl.turn = 0;
    } else pl.turn = 0;
    pl.vy += WW.clamp(WW.clamp((alt - pl.y) * 2.5, -3, 17) - pl.vy, -34 * dt, 34 * dt);
    if (pl.phaseT > 0 || (t && !pl.passed)) return;
    pl.phase = null;
    if (pl.ordnance && t) { pl.sk = 'anvil'; pl.av = freeAV(pl, t); pl.anT = WW.time.now; } else { pl.state = 'return'; pl.sk = null; }
  }

  function reset() { grps = new Map(); ST.dives = ST.runs = 0; ST.pushT = []; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  Object.assign(S, { dive, torp, TOP, press, wheelR, attackStats: ST, SET_R });
})();
