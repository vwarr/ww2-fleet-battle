// air_attack.js — the strike's attack (WW.strike.dive / torp, split out of air_strikes.js). Loads right after air_strikes.js
// (land_air.js wraps these two). Sim code: WW.rand only.
// - Dive bombers (docs/PLANE_REVIEW.md P7): a short, wide wheel at the push-over height just outside the dive point
//   (USN SBD ~66 u at 70 deg, IJN D3A ~52 u at 57 deg: PLANE_NATION dive.push / ang), peel off in turn, wing over,
//   push over, dive with the dive brakes holding ~21-23 u/s (dive.brake), release on the dive line and pull out hard.
//   Push-over -> release takes ~2.2-3 s, long enough to film.
// - Torpedo bombers (P8): descend on the approach, split for an anvil (both bows) at SET_R, turn in together, run in
//   low and slow (runK x cruise) and drop 80-100 u out, then pop up over the ship.
// - Under fire (P8b): the anvil was doctrine and veteran IJN units flew it (Lexington at Coral Sea, Hornet at Santa
//   Cruz), but under heavy CAP and flak real attacks came apart: crews cut the set-up and went straight in from their
//   present bearing, often releasing early, wide or at a poor angle (VT-8 and VT-6 at Midway; the Japanese attacks on
//   radar-directed CAP later). The pilot's reading of the target area (air_intercept.js pressure: fighters he can see,
//   the screen's flak, a fighter on him) shortens the set-up: light opposition, the full anvil; moderate, one bow and
//   a set-up cut short; heavy, straight in from where he is, the squadron with him, released further out and wider.
//   A plane that lost its target, or has been setting up too long, goes straight in at whatever it has.
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
  const CLEAR = 1 * (WW.cfg.PLANE_K || 1) + 2.5; // plane half-extent (~1 at the 1.7 tuning scale, x PLANE_K) + 2.5 margin
  const DIVE_V0 = 18;                          // the dive starts at least this fast; the brakes then hold pt.brake
  const Q = 3.5, Q_MAX = 6;                    // pull-out pitch rate (rad/s); raised if the bottom would be low
  // Anvil spread: the n-th torpedo bomber on a side sets up AV[n] x AV_DA rad round from the 54-degree point (~28 u
  // apart at SET_R) and runs in from its own bearing, a clear gap between wingtips.
  const AV = [0, 1, -1, 2, -2], AV_DA = 0.2;
  const WHEEL_W = 6;                           // the wheel sits this far outside the horizontal reach of the dive
  const SET_R = 140, DROP_FAR = 100, DROP_NEAR = 82, TORP_RANGE = 140;   // anvil radius, drop range by press, torpedo run
  // Pressure (0..1, air_intercept.js) bands: below PR_LIGHT the full anvil; above PR_ONE one bow only (no split) and a
  // set-up cut to SETUP_MAX..SETUP_MIN s (SETUP_CAP s unopposed: no orbiting); at PR_HEAVY (+ PR_VET x press: veterans hold their set-up under more fire)
  // straight in. A hasty drop is PR_LONG x pressure further out (up to ~1,250 m), much wider (PR_ERR x pressure as the
  // harried error, air_intercept.js HARRY.torp: about +-0.2 rad typical) and taken off a worse bearing (OFF_HASTY):
  // calibrated so straight-in drops hit ~8-12% (the Midway TBDs none; the IJN's rushed drops at Santa Cruz did poorly
  // against a turning Enterprise) while a good anvil drop keeps ~30-40%. A long drop is also combed (ships_ai.js COMB_R).
  const PR_LIGHT = 0.2, PR_ONE = 0.35, PR_HEAVY = 0.5, PR_VET = 0.15, PR_LONG = 30, PR_ERR = 4.5, SETUP_MAX = 40, SETUP_MIN = 10, SETUP_CAP = 60, LOST_T = 30;
  const OFF = [0.35, 2.8], OFF_HASTY = [0, 3.2], EXT_R = 50, Y_HASTY = 4.5;
  // OFF: the bearing off the target's bow a drop is taken from (a hasty one from anywhere); EXT_R: the run-in a hasty
  // attack needs past its drop range; Y_HASTY: a hurried drop from ~60 m (3: ~30 m, air_strikes.js altitude rule)
  let grps = new Map();
  const ST = { dives: 0, runs: 0, pass: 0, flips: 0, rebal: 0, pushT: [], straight: 0, cut: 0, single: 0, lost: 0 };

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
    pl.aimX = t.x + Math.cos(t.heading) * t.speed * tt + (pl.aimE ? pl.aimE.x : 0); pl.aimZ = t.z + Math.sin(t.heading) * t.speed * tt + (pl.aimE ? pl.aimE.z : 0);   // + his error (diveErr)
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
        if (!pl.push && Math.atan2(pl.y - pl.aimY - 6, Math.max(0.1, hd - 6)) >= ang - 0.02) pl.push = true; // the sight line from where the push-over ends (~6 on, ~6 down)
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
        WW.combat.dropBomb(pl, t); pl.dropped(); pl.dropV = null; pl.aimE = null;
        if (ST.pushT.length < 400) ST.pushT.push(+(now - pl.rollT).toFixed(2));
        startPull(pl);
      }
      return;
    }
    const g = grp(t), R = wheelR(pt), alt = pt.push || 60;
    pl.state = dh < R + 50 ? 'attack' : 'transit';
    // Run-in, no wheel (P7): the squadron comes on in echelon straight from its approach heading and pushes over in
    // turn as each plane reaches the push-over point; a plane only circles if it must wait (the torpedo planes, or the
    // plane ahead still pushing over). A section's wingmen follow their leader down ~0.6 s apart, the next section
    // after ~1.2 s; a pressing squadron follows sooner.
    const rel = Math.abs(WW.angleDiff(pl.heading, Math.atan2(t.z - pl.z, t.x - pl.x)));
    const ok = dh > R - 12 && dh < R + 16 && rel < 1.9 && pl.y > alt - 12 && pl.ordnance;
    if (ok && now >= g.nextDive && (!WW.cag || WW.cag.diveOK(pl, t, g))) {
      const pr = press(pl), sec = g.lastEl && pl.element && g.lastEl === pl.element;
      g.lastEl = pl.element || null;
      g.nextDive = now + (sec ? WW.randRange(0.5, 0.75) : WW.randRange(1.0, 1.4) * (1.35 - 0.35 * pr));
      pl.phase = 'roll'; pl.phaseT = 0; pl.rollT = now; pl.diveTgt = t; pl.push = false; pl.gam = Math.atan2(pl.vy, Math.max(1, pl.speed)); pl.V = Math.max(DIVE_V0, Math.hypot(pl.vy, pl.speed));
      pl.floor = Math.max(topNear(t, 40), 4, ground(t.x, t.z), groundAhead(pl, 6)) + CLEAR + (1 - pr) * 4; // cautious: release higher
      pl.relAlt = pl.floor + 8; ST.dives++;
      pl.aimE = WW.combat.diveErr ? WW.combat.diveErr(pl) : null;   // where he will put it (combat_weapons.js): the dive line runs at that point
      return;
    }
    if (dh < R + 20 && (ok || dh < R - 12)) { pl.orbit(t.x, t.z, R + 6, alt + (pl.fi || 0) % 4 * 1.2, dt); } // waiting: hold just outside the push-over point
    else pl.fly(t.x, t.z, alt, dt, pt.speed);   // the run-in, straight at the ship
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
    for (const p of WW.world.planes) if (p !== pl && p.alive && p.kind === 'torpedo' && p.target === t && p.side === pl.side && (p.sk === 'anvil' || p.phase === 'run' || p.phase === 'out')) used.add(p.av);
    for (const a of AV) if (!used.has(a)) return a;
    return AV[used.size % AV.length];
  }
  // planes of the attack on t on this bow (setting up, running in, or just past the ship after the drop)
  // (w: only this wave's planes)
  function sideCount(t, side, w) { let n = 0; for (const p of WW.world.planes) if (p.alive && p.kind === 'torpedo' && p.side === side && (w === undefined || p.wave === w) && (p.target === t || p.outTgt === t) && (p.sk === 'anvil' || p.phase === 'run' || p.phase === 'out')) n++; return n; }
  // this strike's weight on a bow of t: its planes there plus the torpedoes it already dropped from that bow
  function bowLoad(t, side, w) { return sideCount(t, side, w) + (w && w.bow && w.bowT === t ? w.bow[side] || 0 : 0); }
  function clearOf(pl) { // { x, z } 20 u away from the nearest same-side bomber inside 10 u, else null
    let n = null, bd = 100;
    for (const p of WW.world.planes) {
      if (p === pl || !p.alive || p.nation !== pl.nation || p.kind !== 'torpedo' || p.state !== 'attack') continue;
      const d2 = WW.dist2(p.x, p.z, pl.x, pl.z); if (d2 < bd) { bd = d2; n = p; }
    }
    if (!n) return null;
    const d = Math.sqrt(bd) || 1; return { x: (pl.x - n.x) / d * 20, z: (pl.z - n.z) / d * 20 };
  }
  const AV_OFF = [0.3, -0.3, 0.55, -0.55, 0.8];
  // A setup-angle offset on this bow whose torpedo track to the ship is open water, else null (the bow is blocked).
  function openSide(t, px, pz, side, base) {
    for (const o of AV_OFF) {
      const a = t.heading + side * (0.95 + base + o), sx = px + Math.cos(a) * SET_R, sz = pz + Math.sin(a) * SET_R;
      if (wet(WW.lerp(sx, px, 0.25), WW.lerp(sz, pz, 0.25), WW.lerp(sx, px, 0.8), WW.lerp(sz, pz, 0.8))) return o;
    }
    return null;
  }
  // the bow of t the plane is on now (-1 / 1)
  function bowOf(pl, t) { return WW.angleDiff(t.heading, Math.atan2(pl.z - t.z, pl.x - t.x)) < 0 ? -1 : 1; }
  const prOf = (pl, t) => (WW.intercept && WW.intercept.pressure ? WW.intercept.pressure(pl, t) : 0);
  function heavyAt(pl) { return PR_HEAVY + PR_VET * press(pl); }
  // Straight in from the present bearing: on to the run now, the drop further out (pl.hasty: the pressure it went in under)
  // Straight in, the run starts from HOT_R out, low and steady the whole way (VT-8 began its run some miles out): the
  // strike's torpedo planes leave the formation that far out when it is hot (air_strikes.js formation, vtBreak)
  const HOT_R = SET_R + 130;
  S.vtBreak = (pl, w) => (w.target && w.dT < HOT_R + 60 && prOf(pl, w.target) >= heavyAt(pl) ? HOT_R + 10 - SET_R : 40);
  const hastyR = (pl, P) => WW.lerp(DROP_FAR, DROP_NEAR, press(pl)) + PR_LONG * P;
  // room to get down and lined up before the drop point (too close, just past the ship after a pass: open out first)
  const room = (pl, dh, P) => dh > hastyR(pl, P) + EXT_R;
  const facing = (pl, t, k) => Math.abs(WW.angleDiff(pl.heading, Math.atan2(t.z - pl.z, t.x - pl.x))) < k;
  function goIn(pl, t, P, g, now) {
    pl.side = bowOf(pl, t); pl.sk = null; pl.phase = 'run'; pl.hasty = Math.max(P, 0.01); pl.ready = false; pl.runHp = pl.hp; pl.runAbort = false;
    pl.dropR = hastyR(pl, P); ST.runs++;
    g.goT = now; g.hastyT = now;   // the squadron turns in with it
  }
  function torp(pl, dt) {
    const t = pl.validTarget();
    pl.phaseT -= dt;
    if (pl.phase === 'out') { popUp(pl, pl.outTgt && pl.outTgt.alive ? pl.outTgt : null, dt); return; } // the ship we just ran at
    if (!t) { pl.state = 'return'; pl.phase = null; pl.sk = null; return; }
    if (S.formation(pl, dt)) return;
    const dh = pl.hd(t), now = WW.time.now, g = grp(t);
    // the target changed under it (sunk, lost, redirected) in the attack: no new set-up, straight in at the new one
    if (pl.atkT && pl.atkT !== t && (pl.phase === 'run' || pl.sk === 'anvil')) { pl.phase = null; pl.sk = null; pl.lostT = now; ST.lost++; }
    pl.atkT = t;
    if (pl.phase === 'run') { run(pl, t, dh, dt); return; }
    if (pl.sk !== 'anvil') { // approach: let down from the cruise height, then split for the anvil
      pl.state = 'transit';
      const P = dh < SET_R + 120 ? prOf(pl, t) : 0, hot = P >= heavyAt(pl) || now - (g.hastyT || -99) < 10 || now - (pl.lostT || -99) < LOST_T;
      if (hot && dh < HOT_R && !room(pl, dh, P)) pl.ext = true;   // too close (just past the ship): open out low, then in
      // a teardrop come-round, low: out on a leg ~35 deg off the line from the ship, then hard round and in again (not
      // a run straight away from her, which reads as a break-off)
      if (pl.ext && dh < hastyR(pl, P) + EXT_R + 30) { const b = Math.atan2(pl.z - t.z, pl.x - t.x) + (pl.side || 1) * 0.6; pl.fly(t.x + Math.cos(b) * (dh + 60), t.z + Math.sin(b) * (dh + 60), 8, dt, pl.pt.speed); return; }
      pl.ext = false;
      pl.fly(t.x, t.z, dh > SET_R + 80 && P < PR_LIGHT ? (pl.pt.alt || 30) : hot ? 6 : 14, dt, pl.pt.speed);   // under fire: down low early
      if (hot && dh < HOT_R && facing(pl, t, 0.8)) { pl.prs = P; pl.prsMax = P; goIn(pl, t, P, g, now); ST.straight++; return; }
      if (dh < SET_R + 30) {
        pl.prs = P; pl.prsMax = P;
        if (hot) return;   // turning in
        // the bow with fewer of this strike's planes on it (then fewer of anyone's), else alternate; under fire, the
        // bow it is on (no split)
        const wa = bowLoad(t, -1, pl.wave), wb = bowLoad(t, 1, pl.wave), a = sideCount(t, -1), b = sideCount(t, 1);
        if (P >= PR_ONE) { pl.side = bowOf(pl, t); ST.single++; }
        else pl.side = wa !== wb ? (wa < wb ? -1 : 1) : a !== b ? (a < b ? -1 : 1) : g.side++ % 2 ? 1 : -1;
        pl.av = freeAV(pl, t); pl.anT = now; pl.avOff = 0; pl.prsT = now;
        pl.sk = 'anvil';
      }
      return;
    }
    // Under fire in the set-up: read the area again every second; it gets hot, or the set-up has run long for what
    // it is facing, or a squadron mate went straight in: turn in now from here.
    if (now - (pl.prsT || 0) >= 1) {
      pl.prsT = now; pl.prs = prOf(pl, t); pl.prsMax = Math.max(pl.prsMax || 0, pl.prs);
      const lim = pl.prsMax < PR_LIGHT ? SETUP_CAP : WW.lerp(SETUP_MAX, SETUP_MIN, WW.clamp((pl.prsMax - PR_LIGHT) / (heavyAt(pl) - PR_LIGHT), 0, 1));
      if ((pl.prs >= heavyAt(pl) || now - (g.hastyT || -99) < 10 || now - pl.anT > lim) && room(pl, pl.hd(t), pl.prs) && facing(pl, t, 1.2)) { goIn(pl, t, pl.prs, g, now); ST.cut++; return; }
    }
    // Anvil setup: work round the target at SET_R to a point ~54 deg off its bow on our side, then hold low.
    pl.state = 'attack';
    const R = SET_R, ts = 6, px = t.x + Math.cos(t.heading) * t.speed * ts, pz = t.z + Math.sin(t.heading) * t.speed * ts;
    const want = t.heading + pl.side * (0.95 + (pl.av || 0) * AV_DA + (pl.avOff || 0)), cur = Math.atan2(pl.z - pz, pl.x - px), da = WW.angleDiff(cur, want);
    const a = Math.abs(da) > 0.5 ? cur + Math.sign(da) * 0.5 : want;   // circle round rather than cross the target
    const sx = WW.clamp(px + Math.cos(a) * R, 10, WW.cfg.MAP_W - 10), sz = WW.clamp(pz + Math.sin(a) * R, 10, WW.cfg.MAP_H - 10); // torpedoes die off-map
    const ds = WW.dist(pl.x, pl.z, sx, sz);
    if (a === want && now > (pl.flipT || 0) && !wet(WW.lerp(sx, px, 0.25), WW.lerp(sz, pz, 0.25), WW.lerp(sx, px, 0.8), WW.lerp(sz, pz, 0.8))) {
      // land in the way: swing the setup point toward the bow or the quarter on the same side (the anvil keeps both
      // bows); only if this whole side is blocked, try the other bow
      pl.flipT = now + 3;
      const o = openSide(t, px, pz, pl.side, (pl.av || 0) * AV_DA);
      if (o !== null) pl.avOff = o; else { pl.side = -pl.side; pl.av = freeAV(pl, t); pl.avOff = 0; pl.flipT = now + 6; pl.flips = (pl.flips || 0) + 1; ST.flips++; }
    }
    if (!pl.ready && now > (pl.balT || 0) && (pl.prsMax || 0) < PR_ONE) { // a bow lost planes (shot down, redirected): the strike evens the anvil out (not under fire: one bow)
      pl.balT = now + 1;
      if (bowLoad(t, pl.side, pl.wave) - bowLoad(t, -pl.side, pl.wave) >= 2) { pl.side = -pl.side; pl.av = freeAV(pl, t); pl.avOff = 0; ST.rebal++; }
    }
    pl.ready = Math.abs(da) < 0.5 && ds < 18;
    const sep = clearOf(pl), hy = Math.abs(pl.av || 0) * 1.5;   // sidestep a squadron mate closer than 10; stepped heights
    if (ds < 12 && !sep) pl.orbit(sx, sz, 12, overLand(pl, 5, 6 + hy), dt);
    else pl.fly(sx + (sep ? sep.x : 0), sz + (sep ? sep.z : 0), overLand(pl, 5, (Math.abs(da) < 0.5 ? 6 : 14) + hy), dt, pl.pt.speed);
    // Both groups turn in together: all ready, someone has waited too long, or a run just started.
    let go = now - g.goT < 7;
    if (!go && pl.ready && !((pl.prsMax || 0) < PR_LIGHT && WW.cag && WW.cag.vtWait(pl, t, g))) {   // under fire: no holding for the dive bombers
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
      pl.phase = 'run'; pl.sk = null; pl.hasty = 0; pl.runHp = pl.hp; pl.runAbort = false; pl.dropR = WW.lerp(DROP_FAR, DROP_NEAR, press(pl)); ST.runs++;
    }
  }
  // Hit on the run (P8c): aircraft.js damage() lets a bomber jettison and turn for home only before its attack, but a
  // torpedo plane hit on its low, steady run was often done for: VT-8 lost all 15 at Midway, VT-3 and VT-6 most of
  // theirs, and many that released were holed. Each hit taken on the run may end it: the chance grows with the damage
  // (how far below RUN_HP the plane is, and how big this hit was, x RUN_K / RUN_HIT), x how hot the pilot read the area
  // going in (prsMax past RUN_P0, over RUN_PW, squared, RUN_PK; the top of it with a fighter on him: fighters on his tail and a wall of flak finish a holed plane; the odd
  // gunner's hits on a lightly defended ship do not stop it: the Kates at Pearl Harbor pressed on through holed wings),
  // to RUN_MAX; RUN_DOWN of those go into the sea (engine, controls, the pilot), the rest jettison the torpedo and break
  // away. One WW.rand draw per hit that counts.
  const RUN_HP = 1, RUN_K = 5, RUN_HIT = 10, RUN_MAX = 0.9, RUN_DOWN = 0.6, RUN_P0 = 0.1, RUN_PW = 0.3, RUN_PK = [0.1, 1.5];   // calibrated: ~45-55% of a heavily opposed attack releases (VT-3 / VT-6 / VT-8)
  function hitOnRun(pl) {
    const h0 = pl.runHp === undefined ? pl.hp : pl.runHp;
    pl.runHp = pl.hp;
    if (pl.hp >= h0) return false;
    let pk = WW.clamp((Math.max(pl.prsMax || 0, pl.hasty || 0) - RUN_P0) / RUN_PW, RUN_PK[0], RUN_PK[1]);
    if (pk < RUN_PK[1]) for (const q of WW.world.planes) if (q.alive && q.foe === pl && q.kind === 'fighter' && WW.dist2(q.x, q.z, pl.x, pl.z) < 80 * 80) { pk = RUN_PK[1]; break; }   // a fighter on him
    const pb = Math.min(RUN_MAX, pk * pk * ((RUN_HP - pl.hp / pl.maxHp) * RUN_K + (h0 - pl.hp) / pl.maxHp * RUN_HIT));
    const r = WW.rand();
    if (r >= pb) return false;   // presses on
    if (r < pb * RUN_DOWN) { ST.runDown = (ST.runDown || 0) + 1; pl.shotDown(); return true; }
    ST.runAbort = (ST.runAbort || 0) + 1;
    pl.crippled = true; pl.runAbort = true; pl.dropped(); if (WW.fx) WW.fx.splash(pl.x, pl.z, 0.8);
    pl.phase = null; pl.sk = null; pl.state = 'return'; pl.foe = null;
    return true;
  }
  function run(pl, t, dh, dt) {
    pl.state = 'attack';
    if (hitOnRun(pl)) return;
    const tv = WW.torpSpec ? WW.torpSpec(pl.nation, 'air').speed : WW.TORPEDO.speed;
    const tt = dh / tv;
    let px = t.x + Math.cos(t.heading) * t.speed * tt, pz = t.z + Math.sin(t.heading) * t.speed * tt;
    // the ship turned and put us on its other bow: swing out to keep our own bow (the anvil holds whichever way it turns;
    // a straight-in run takes the bow it gets)
    if (pl.side && !pl.hasty && dh > (pl.dropR || DROP_FAR) + 8 && Math.sign(WW.angleDiff(t.heading, Math.atan2(pl.z - t.z, pl.x - t.x))) !== pl.side) {
      const a = t.heading + pl.side * 1.2; px += Math.cos(a) * 45; pz += Math.sin(a) * 45;
    }
    // the aim point stays on the map (a target near the edge); a plane that has run off the map breaks off and sets up again
    px = WW.clamp(px, 10, WW.cfg.MAP_W - 10); pz = WW.clamp(pz, 10, WW.cfg.MAP_H - 10);
    if (pl.x < -30 || pl.z < -30 || pl.x > WW.cfg.MAP_W + 30 || pl.z > WW.cfg.MAP_H + 30) { pl.phase = null; pl.sk = null; ST.offMap = (ST.offMap || 0) + 1; return; }
    const d = pl.turnTo(Math.atan2(pz - pl.z, px - pl.x), dt, 1.0), alt = overLand(pl, 5, 1.8); // wave height, hop any land
    pl.speedTo(pl.pt.speed * (pl.pt.runK || 0.8), dt);    // slowed for the drop (Mk 13 / Type 91 limits)
    pl.vy += WW.clamp(WW.clamp((alt - pl.y) * 2.5, pl.hasty ? -12 : -7, 9) - pl.vy, -14 * dt, 14 * dt);   // straight in from height: a steeper let-down
    const c = Math.cos(pl.heading), s = Math.sin(pl.heading), dropR = pl.dropR || DROP_FAR;
    if (pl.y < 2.8) { // prop wash spray on the water under the plane (visual)
      pl.sprayT = (pl.sprayT || 0) - dt;
      if (pl.sprayT <= 0 && WW.fx) { pl.sprayT = 0.1; WW.fx.wake(pl.x - c * 1.2, pl.z - s * 1.2, pl.heading, 0.55); }
    }
    const off = Math.abs(WW.angleDiff(t.heading, Math.atan2(pl.z - t.z, pl.x - t.x)));   // where we are off the ship's bow
    const hy = pl.hasty || 0, OK = hy ? OFF_HASTY : OFF;   // a hasty run takes a rougher line, any bearing and a higher drop
    const drop = dh < dropR && pl.y < (hy ? Y_HASTY : 3) && Math.abs(d) < (hy ? 0.5 : 0.3) && off > OK[0] && off < OK[1] && wet(pl.x + c, pl.z + s, WW.lerp(pl.x, px, 0.8), WW.lerp(pl.z, pz, 0.8));
    if (drop) {
      // harried: thrown off its line (air_intercept.js); a hasty drop under fire is wider
      const hz = Math.max(WW.intercept && WW.intercept.harried ? WW.intercept.harried(pl) : 0, PR_ERR * hy);
      WW.combat.fireTorpedo(pl, pl.x + c, pl.z + s, pl.heading + (hz > 0 ? (WW.rand() + WW.rand() - 1) * 1.7 * WW.intercept.HARRY.torp * hz : 0), pl.nation, TORP_RANGE);
      const w = pl.wave; if (w) { if (w.bowT !== t) { w.bowT = t; w.bow = {}; } const sd = WW.angleDiff(t.heading, Math.atan2(pl.z - t.z, pl.x - t.x)) < 0 ? -1 : 1; w.bow[sd] = (w.bow[sd] || 0) + 1; }
      if (WW.fx) WW.fx.splash(pl.x + c * 3, pl.z + s * 3, 0.9);
      pl.dropped();
    }
    // Released, or not lined up by 30 inside the drop range (or the ship combed the run, bow- or stern-on): pop up over
    // the ship; the latter keeps its torpedo and comes round again.
    if (!drop && dh < dropR - (hy ? 45 : 30)) ST.pass++;   // not lined up: a pass, the torpedo kept for another run
    if (drop || dh < dropR - (hy ? 45 : 30)) { pl.outTgt = t; pl.phase = 'out'; pl.phaseT = drop ? 4 : 3; pl.passed = false; pl.lastD = dh; pl.floor = Math.max(topNear(t, 30), 2, groundAhead(pl, 8)) + CLEAR; }
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
    if (pl.ordnance && t && pl.hasty) { pl.sk = null; pl.lostT = WW.time.now; }   // under fire: round and straight in again
    else if (pl.ordnance && t) { pl.sk = 'anvil'; pl.av = freeAV(pl, t); pl.anT = WW.time.now; pl.prsT = WW.time.now; } else { pl.state = 'return'; pl.sk = null; }
  }

  function reset() { grps = new Map(); ST.dives = ST.runs = ST.flips = ST.rebal = ST.offMap = ST.straight = ST.cut = ST.single = ST.lost = ST.runDown = ST.runAbort = ST.pass = 0; ST.pushT = []; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  Object.assign(S, { dive, torp, TOP, press, wheelR, attackStats: ST, SET_R });
})();
