// air_strafe.js — WW.strafe: fighters strafe small craft with their guns. Targets: PT boats, surfaced submarines,
// destroyers below half hp (SMALL). Who:
//   - the escorts of a strike on small craft, once over the target (instead of circling it);
//   - up to CAP_N CAP fighters of a carrier or of an island base (land_air.js calls capCheck), while its side has a fresh small-craft contact within CAP_R of it and
//     no enemy plane is detected near (the fighter director's picture): plane.target is set to the boat for the
//     pass, so the CAP accounting relieves it, and cleared afterwards;
//   - a fighter on its way home (a carrier's or the field's) passing one (homeCheck);
//   - a dive bomber after its pull-out, one pass (air_gunners.js: sf.one, sf.big for the ship it bombed).
// A pass (air_intercept.js style): set up SET_R out on a run-in bearing at SET_ALT, run in on a shallow dive with the
// flight path (the fixed guns) laid on the boat's predicted position, bursts inside FIRE_R while the nose is on in
// 3D (NOSE_ON) and before the pull-out is due (each burst hits with P_HIT, BURST x the
// plane's gun factor damage through ship.takeDamage, kind 'strafe', cal 'mg'), break off past the boat, climb out
// and extend, set up again from a new bearing. Sim code: WW.rand only (hit rolls); visuals Math.random.
window.WW = window.WW || {};
(function () {
  const SMALL = { pt: 1, submarine: 1, destroyer: 1 };
  const CAP_N = 2, CAP_R = 170, SET_R = 70, SET_ALT = 20, RUN_ALT = 5, FIRE_R = 52, P_HIT = 0.55, BURST = 6, BURST_T = 0.35, EXT_T = 2.5;
  // the dive of the run: the most it steepens (rad), its vertical-speed ramp, the aim height on a boat, the nose-on
  // cone for firing, the pull-out's vertical acceleration and the lowest it may bottom out at (units, units/s^2)
  const DIVE_MAX = 0.42, DIVE_A = 16, AIM_Y = 0.8, NOSE_ON = 0.1, PULL_A = 45, BREAK_Y = 3.5, BV = 190;
  const ST = { passes: 0, bursts: 0, hits: 0, dmg: 0, cap: 0, escort: 0, home: 0, baseCap: 0, baseHome: 0 };

  const small = u => u && u.alive && !u.sinking && SMALL[u.type] && !u.submerged && (u.type !== 'destroyer' || u.hp < u.maxHp * 0.5);
  const fresh = (n, u, age) => { const c = WW.intel && WW.intel.known(n, u); return c && WW.time.now - c.seenAt <= age ? c : null; };

  // ---------- the burst seen (visual only: Math.random, nothing the sim reads) ----------
  // The burst is spread over its BURST_T as VOLLEYS volleys, one round from each wing gun (and a muzzle flash) per
  // volley. The guns are fixed: each volley goes where the nose points (the fuselage axis, heading and pitch) as it
  // is at that volley, the stream walking from a little short of the boat onto her (a hit: onto the deck; a miss:
  // past her, off to one side), held within NOSE_FX of the axis; a volley the nose is well off for (NOSE_OFF:
  // pulling out) is not fired.
  // Each volley's rounds land as a pair of bullet splashes on the water, or sparks and a hit puff on the deck.
  // A small queue stepped from WW.air.update (the dogfight's tracer step).
  const PK = WW.cfg.PLANE_K || 1, WING = 1.25 * PK, FXQ = [], VOLLEYS = 8, NOSE_FX = 0.05, NOSE_OFF = 0.3;
  function burstFx(pl, u, hit) {
    if (!WW.planeTracers || !WW.planeTracers.burst || !WW.fx) return;
    const off = hit ? 0 : (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2), deckL = Math.max(2.5, ((u.stats && u.stats.length) || 8) * 0.4);
    for (let i = 0; i < VOLLEYS && FXQ.length < 160; i++) {
      const k = -4 + i * (hit ? 4.5 : 8) / (VOLLEYS - 1);   // along the track from the boat (-: short of her)
      FXQ.push({ t: i * BURST_T / VOLLEYS, pl, u, k, off, hit, deckL });
    }
  }
  function volley(q) {
    const pl = q.pl, u = q.u, TR = WW.planeTracers;
    if (!pl.alive || !u) return;
    const ch = Math.cos(pl.heading), sh = Math.sin(pl.heading), ph = pl.pitch === undefined ? Math.atan2(pl.vy, Math.max(1, pl.speed)) : pl.pitch;
    const nx = ch * Math.cos(ph), ny = Math.sin(ph), nz = sh * Math.cos(ph);
    // the aim point on the water / deck about the boat, then held within NOSE_FX of the nose
    let ax = u.x - sh * q.off + ch * q.k + (Math.random() - 0.5) * 0.8, az = u.z + ch * q.off + sh * q.k + (Math.random() - 0.5) * 0.8;
    let deck = q.hit && Math.abs(q.k) < q.deckL, ay = deck ? 1.3 : 0;
    const oy = pl.y - 0.25 * PK;
    let dx = ax - pl.x, dy = ay - oy, dz = az - pl.z;
    const dl = Math.hypot(dx, dy, dz) || 1, off = Math.acos(WW.clamp((dx * nx + dy * ny + dz * nz) / dl, -1, 1));
    if (off > NOSE_OFF) return;   // the nose is well off her (pulling out): no volley
    if (off > NOSE_FX) {   // pull the aim back onto the edge of the cone about the nose, where that line meets the water / deck
      const k = NOSE_FX / off;
      const ux = nx + (dx / dl - nx) * k, uy = ny + (dy / dl - ny) * k, uz = nz + (dz / dl - nz) * k;
      if (uy > -0.02) return;
      const s = (oy - ay) / -uy; ax = pl.x + ux * s; az = pl.z + uz * s;
      if (deck && Math.hypot(ax - u.x, az - u.z) > q.deckL) { deck = false; ay = 0; const s0 = oy / -uy; ax = pl.x + ux * s0; az = pl.z + uz * s0; }   // off her deck: into the water
    }
    for (let side = -1; side <= 1; side += 2) {
      const gx = pl.x - sh * side * WING + nx * 0.5, gy = oy + ny * 0.5, gz = pl.z + ch * side * WING + nz * 0.5;
      TR.burst(gx, gy, gz, ax - sh * side * 0.6, ay, az + ch * side * 0.6, 1, ch * pl.speed, pl.vy, sh * pl.speed, 0.01);
    }
    FXQ.push({ t: Math.hypot(ax - pl.x, ay - pl.y, az - pl.z) / BV, x: ax, z: az, deck, hitFx: true });
  }
  function stepFx(dt) {
    let w = 0;
    const n = FXQ.length;
    for (let i = 0; i < n; i++) {
      const q = FXQ[i];
      if ((q.t -= dt) > 0) { FXQ[w++] = q; continue; }
      if (!q.hitFx) { volley(q); continue; }
      if (q.deck) { WW.fx.sparks(q.x, 1.4, q.z); if (Math.random() < 0.3 && WW.fx.smoke) WW.fx.smoke(q.x, 1.2, q.z, true, 0.25); }
      else if (WW.terrain && WW.terrain.depthAt && WW.terrain.depthAt(q.x, q.z) < 0.3) WW.fx.sparks(q.x, 0.4, q.z);   // over land: dust and sparks
      else WW.fx.splash(q.x, q.z, 0.18 + Math.random() * 0.1);
    }
    for (let i = n; i < FXQ.length; i++) FXQ[w++] = FXQ[i];   // splashes queued by this step's volleys
    FXQ.length = w;
  }

  function stop(pl) {
    const home = pl.sf && pl.sf.home;
    if (pl.sf && pl.sf.cap) pl.target = null; // back to CAP
    pl.strafe = null; pl.sf = null;
    if (home) pl.state = 'return';            // on its way home: carry on home
  }
  function pass(pl, dt) {
    const u = pl.strafe, n = pl.nation, big = pl.sf && pl.sf.big, c = (big ? u && u.alive && !u.sinking : small(u)) ? fresh(n, u, 5) : null;
    if (!c) { stop(pl); return false; }
    const S = pl.sf || (pl.sf = { ph: 'setup', t: 0, b: Math.atan2(pl.z - c.z, pl.x - c.x), fT: 0 });
    S.t += dt; S.fT -= dt;
    if (S.home && WW.time.now > S.until) { stop(pl); return false; }
    pl.state = 'attack';
    // the aim: where the boat will be when the rounds get there (time of flight + a little)
    const lt = Math.hypot(c.x - pl.x, c.z - pl.z) / BV + 0.25, px = c.x + Math.cos(c.heading) * u.speed * lt, pz = c.z + Math.sin(c.heading) * u.speed * lt;
    const d = WW.dist(pl.x, pl.z, px, pz);
    if (S.ph === 'setup') {
      const sx = WW.clamp(c.x + Math.cos(S.b) * SET_R, 10, WW.cfg.MAP_W - 10), sz = WW.clamp(c.z + Math.sin(S.b) * SET_R, 10, WW.cfg.MAP_H - 10);
      pl.fly(sx, sz, SET_ALT, dt, pl.pt.speed);
      if (WW.dist(pl.x, pl.z, sx, sz) < 18 || S.t > 14) { S.ph = 'run'; S.t = 0; ST.passes++; }
    } else if (S.ph === 'run') {
      const top = big ? ((WW.strike && WW.strike.TOP && WW.strike.TOP[u.type]) || 6) + 3.5 : 0;   // a big ship: over her masts
      // The run is a shallow dive with the flight path (the nose: fixed guns) laid on the boat: heading from fly(),
      // the descent set here, ramped (DIVE_A) toward the line of sight, no steeper than DIVE_MAX. A big ship: on her
      // masts, never below them.
      const vy0 = pl.vy, aimY = big ? top : AIM_Y;
      const err = pl.fly(px, pz, Math.max(top, RUN_ALT), dt, pl.pt.speed, 1.4);
      const los = Math.atan2(aimY - pl.y, Math.max(1, d)), gam = WW.clamp(los, -DIVE_MAX, 0);
      let tv = Math.max(1, pl.speed) * Math.tan(gam);
      if (big && pl.y + tv * 0.5 < top) tv = Math.max(tv, (top - pl.y) * 2);
      pl.vy = vy0 + WW.clamp(tv - vy0, -DIVE_A * dt, DIVE_A * dt);
      // fire only with the nose on (the flight path within NOSE_ON of the aim point, in 3D), and not once the
      // pull-out is due (the pull from this dive would bottom out under BREAK_Y)
      const path = Math.atan2(pl.vy, Math.max(1, pl.speed)), on = Math.abs(err) < NOSE_ON && Math.abs(path - los) < NOSE_ON;
      const pull = pl.y + Math.min(0, pl.vy) * 0.1 - pl.vy * pl.vy / (2 * PULL_A);
      const brk = !big && pull < BREAK_Y;
      if (d < FIRE_R && on && !brk && S.fT <= 0) {
        S.fT = BURST_T; ST.bursts++;
        // a big ship (a dive bomber's pass on the ship it bombed, air_gunners.js): the guns only keep the light AA's
        // heads down (combat_aa.js reads ship.aaSup), no hit roll
        if (big) { if (WW.gunners) WW.gunners.suppress(u, S.gk || 1); if (!WW.simOnly) burstFx(pl, u, true); }
        const hit = !big && WW.rand() < P_HIT;
        if (hit) {
          const dmg = BURST * (S.gk || pl.pt.gun || 1);
          ST.hits++; ST.dmg += dmg;
          u.takeDamage(dmg, u.x + (WW.rand() - 0.5) * 2, u.z + (WW.rand() - 0.5) * 2, 'strafe', 'mg');
        }
        if (!big && !WW.simOnly) burstFx(pl, u, hit);
      }
      if (d < 10 || brk || S.t > 12 || (d > 25 && Math.abs(err) > 1.6)) { S.ph = 'out'; S.t = 0; if (S.one) { stop(pl); return false; } }   // one pass only (a bomber's): then home
    } else { // break off past the boat: pull out of the dive (PULL_A), climb and extend, then set up from a fresh bearing
      const vy0 = pl.vy;
      pl.fly(pl.x + Math.cos(pl.heading) * 50, pl.z + Math.sin(pl.heading) * 50, SET_ALT + 6, dt, pl.pt.speed);
      if (vy0 < 3) pl.vy = Math.max(pl.vy, Math.min(3, vy0 + PULL_A * dt));
      if (S.t > EXT_T) { S.ph = 'setup'; S.t = 0; S.b = Math.atan2(pl.z - c.z, pl.x - c.x) + (pl.id & 1 ? 0.6 : -0.6); }
    }
    return true;
  }

  // CAP (a carrier's, from the air boss below; an island base's, from land_air.js update's CAP check once a second):
  // hand up to CAP_N fighters of the carrier / field a small-craft contact near it (none while enemy planes are about)
  function capCheck(cv) {
    if (!WW.intel || !WW.airOps) return;
    if (WW.airOps.picture(cv).near) return;
    let best = null, bd = CAP_R;
    for (const c of WW.intel.enemyShips(cv.nation, { fresh: 3 })) { const d = WW.dist(cv.x, cv.z, c.x, c.z); if (d < bd && small(c.unit)) { bd = d; best = c.unit; } }
    if (best) send(cv, best);
  }
  // hand up to CAP_N airborne CAP fighters of cv the boat best (capCheck; air_alert.js for a PT boat harassing the fleet)
  function send(cv, best) {
    let n = 0, k = 0;
    for (const p of WW.world.planes) if (p.alive && p.carrier === cv && p.strafe && p.sf && p.sf.cap) n++;
    for (const p of WW.world.planes) {
      if (n >= CAP_N) break;
      if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || p.target || p.search || p.strafe || p.recall || p.state !== 'transit' || p.fuel < 60 || p.foe) continue;
      p.strafe = best; p.target = best; p.sf = { ph: 'setup', t: 0, b: Math.atan2(p.z - best.z, p.x - best.x), fT: 0, cap: true };
      n++; k++; ST.cap++; if (cv.isBase) ST.baseCap++;
      if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'strafe', plane: p, squadron: p.squadron || null, target: best });
    }
    return k;
  }

  // On the way home: a fighter with fuel to spare and not badly hit strafes a PT boat, surfaced sub or crippled
  // destroyer it passes (in sight within HOME_R) for up to HOME_T s, once a sortie (the guns still had rounds).
  const HOME_R = 110, HOME_FUEL = 45, HOME_T = 20;
  function homeCheck(pl) {
    if (!WW.intel || pl.search || pl.strafed || pl.hp < pl.maxHp * 0.6 || pl.fuel < HOME_FUEL) return false;
    let best = null, bd = HOME_R;
    for (const c of WW.intel.enemyShips(pl.nation, { fresh: 3 })) { const d = WW.dist(pl.x, pl.z, c.x, c.z); if (d < bd && small(c.unit)) { bd = d; best = c.unit; } }
    if (!best) return false;
    pl.strafed = true; pl.strafe = best; pl.target = best; pl.state = 'transit'; pl.foe = null;
    pl.sf = { ph: 'setup', t: 0, b: Math.atan2(pl.z - best.z, pl.x - best.x), fT: 0, cap: true, home: true, until: WW.time.now + HOME_T };
    ST.home++; if (pl.carrier && pl.carrier.isBase) ST.baseHome++;
    if (WW.emit) WW.emit('airOrder', { carrier: pl.carrier, order: 'strafe', plane: pl, squadron: pl.squadron || null, target: best });
    return true;
  }
  if (WW.Plane) {
    const P = WW.Plane.prototype, f0 = P.fighter, g0 = P.goHome;
    P.goHome = function (dt) {
      if (this.kind === 'fighter' && !this.strafed && dt > 0 && (this.sfChk = (this.sfChk || 0) - dt) <= 0) { this.sfChk = 1; if (homeCheck(this)) return; }
      return g0.apply(this, arguments);
    };
    P.fighter = function (dt) {
      if (this.strafe) {
        if (this.foe && this.foe.alive) stop(this);           // a fight comes first
        else if (this.fuel < 25) { stop(this); this.state = 'return'; return; }
        else if (pass(this, dt)) return;
        if (this.state === 'return') return;   // a strafe on the way home is over: on home
      }
      // an escort over a small-craft target: strafe it
      const t = this.target;
      if (t && !this.recall && !this.foe && small(t) && WW.dist(this.x, this.z, t.x, t.z) < 150 && this.t > 5) {
        this.strafe = t; this.sf = null; ST.escort++;
        if (pass(this, dt)) return;
      }
      return f0.call(this, dt);
    };
  }
  if (WW.airOps) {
    const plan0 = WW.airOps.plan;
    WW.airOps.plan = function (cv, dt) {
      const r = plan0.apply(this, arguments);
      const a = cv.ai; a.sfT = (a.sfT || 0) - dt;
      if (a.sfT <= 0) { a.sfT = 2; try { capCheck(cv); } catch (e) { console.error('strafe', e); } }
      return r;
    };
  }
  if (WW.dogfight && !WW.simOnly) { const up0 = WW.dogfight.update; WW.dogfight.update = function (dt) { if (FXQ.length) stepFx(dt); return up0.apply(this, arguments); }; }
  // the director (camera.js candidates, via WW.camHooks): a strafing run in progress, from behind the fighter with the
  // boat ahead (the torpedo-run framing), worth about a dogfight
  (WW.camHooks = WW.camHooks || []).push((add, dur) => {
    for (const p of WW.world.planes) if (p.alive && p.strafe && p.sf && p.sf.ph === 'run' && p.strafe.alive && WW.dist(p.x, p.z, p.strafe.x, p.strafe.z) < 80)
      add(6.8 + (p.ace ? 1 : 0), 'chase', p, { dur: dur(8, 11), target: p.strafe });
  });
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; FXQ.length = 0; });
  WW.strafe = { stats: ST, small, pass, stop, fresh, send, capCheck: cv => { try { capCheck(cv); } catch (e) { console.error('strafe', e); } } };
})();
