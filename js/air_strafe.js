// air_strafe.js — WW.strafe: fighters strafe small craft with their guns. Targets: PT boats, surfaced submarines,
// destroyers below half hp (SMALL). Who:
//   - the escorts of a strike on small craft, once over the target (instead of circling it);
//   - up to CAP_N CAP fighters of a carrier, while its side has a fresh small-craft contact within CAP_R of it and
//     no enemy plane is detected near (the fighter director's picture): plane.target is set to the boat for the
//     pass, so the CAP accounting relieves it, and cleared afterwards.
// A pass (air_intercept.js style): set up SET_R out on a run-in bearing at SET_ALT, run in low (RUN_ALT) on the
// boat's predicted position, bursts inside FIRE_R while the nose is on (each burst hits with P_HIT, BURST x the
// plane's gun factor damage through ship.takeDamage, kind 'strafe', cal 'mg'), break off past the boat, climb out
// and extend, set up again from a new bearing. Sim code: WW.rand only (hit rolls); visuals Math.random.
window.WW = window.WW || {};
(function () {
  const SMALL = { pt: 1, submarine: 1, destroyer: 1 };
  const CAP_N = 2, CAP_R = 170, SET_R = 70, SET_ALT = 20, RUN_ALT = 5, FIRE_R = 42, P_HIT = 0.55, BURST = 6, BURST_T = 0.35, EXT_T = 2.5;
  const ST = { passes: 0, bursts: 0, hits: 0, dmg: 0, cap: 0, escort: 0 };

  const small = u => u && u.alive && !u.sinking && SMALL[u.type] && !u.submerged && (u.type !== 'destroyer' || u.hp < u.maxHp * 0.5);
  const fresh = (n, u, age) => { const c = WW.intel && WW.intel.known(n, u); return c && WW.time.now - c.seenAt <= age ? c : null; };

  function stop(pl) {
    if (pl.sf && pl.sf.cap) pl.target = null; // back to CAP
    pl.strafe = null; pl.sf = null;
  }
  function pass(pl, dt) {
    const u = pl.strafe, n = pl.nation, c = small(u) ? fresh(n, u, 5) : null;
    if (!c) { stop(pl); return false; }
    const S = pl.sf || (pl.sf = { ph: 'setup', t: 0, b: Math.atan2(pl.z - c.z, pl.x - c.x), fT: 0 });
    S.t += dt; S.fT -= dt;
    pl.state = 'attack';
    const lt = 1.2, px = c.x + Math.cos(c.heading) * u.speed * lt, pz = c.z + Math.sin(c.heading) * u.speed * lt;
    const d = WW.dist(pl.x, pl.z, px, pz);
    if (S.ph === 'setup') {
      const sx = WW.clamp(c.x + Math.cos(S.b) * SET_R, 10, WW.cfg.MAP_W - 10), sz = WW.clamp(c.z + Math.sin(S.b) * SET_R, 10, WW.cfg.MAP_H - 10);
      pl.fly(sx, sz, SET_ALT, dt, pl.pt.speed);
      if (WW.dist(pl.x, pl.z, sx, sz) < 18 || S.t > 14) { S.ph = 'run'; S.t = 0; ST.passes++; }
    } else if (S.ph === 'run') {
      const err = pl.fly(px, pz, RUN_ALT + Math.min(15, d * 0.2), dt, pl.pt.speed, 1.4);
      if (d < FIRE_R && Math.abs(err) < 0.25 && S.fT <= 0) {
        S.fT = BURST_T; ST.bursts++;
        if (WW.rand() < P_HIT) {
          const dmg = BURST * (pl.pt.gun || 1);
          ST.hits++; ST.dmg += dmg;
          u.takeDamage(dmg, u.x + (WW.rand() - 0.5) * 2, u.z + (WW.rand() - 0.5) * 2, 'strafe', 'mg');
        } else if (WW.fx && WW.fx.splash && !WW.simOnly) WW.fx.splash(u.x + (Math.random() - 0.5) * 8, u.z + (Math.random() - 0.5) * 8, 0.3);
      }
      if (d < 10 || S.t > 12 || (d > 25 && Math.abs(err) > 1.6)) { S.ph = 'out'; S.t = 0; }
    } else { // break off past the boat, climb and extend, then set up from a fresh bearing
      pl.fly(pl.x + Math.cos(pl.heading) * 50, pl.z + Math.sin(pl.heading) * 50, SET_ALT + 6, dt, pl.pt.speed);
      if (S.t > EXT_T) { S.ph = 'setup'; S.t = 0; S.b = Math.atan2(pl.z - c.z, pl.x - c.x) + (pl.id & 1 ? 0.6 : -0.6); }
    }
    return true;
  }

  // CAP: hand up to CAP_N fighters of the carrier a small-craft contact near it (none while enemy planes are about)
  function capCheck(cv) {
    if (!WW.intel || !WW.airOps) return;
    if (WW.airOps.picture(cv).near) return;
    let best = null, bd = CAP_R;
    for (const c of WW.intel.enemyShips(cv.nation, { fresh: 3 })) { const d = WW.dist(cv.x, cv.z, c.x, c.z); if (d < bd && small(c.unit)) { bd = d; best = c.unit; } }
    if (!best) return;
    let n = 0;
    for (const p of WW.world.planes) if (p.alive && p.carrier === cv && p.strafe && p.sf && p.sf.cap) n++;
    for (const p of WW.world.planes) {
      if (n >= CAP_N) break;
      if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || p.target || p.search || p.strafe || p.recall || p.state !== 'transit' || p.fuel < 60 || p.foe) continue;
      p.strafe = best; p.target = best; p.sf = { ph: 'setup', t: 0, b: Math.atan2(p.z - best.z, p.x - best.x), fT: 0, cap: true };
      n++; ST.cap++;
      if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'strafe', plane: p, squadron: p.squadron || null, target: best });
    }
  }

  if (WW.Plane) {
    const P = WW.Plane.prototype, f0 = P.fighter;
    P.fighter = function (dt) {
      if (this.strafe) {
        if (this.foe && this.foe.alive) stop(this);           // a fight comes first
        else if (this.fuel < 25) { stop(this); this.state = 'return'; return; }
        else if (pass(this, dt)) return;
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
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });
  WW.strafe = { stats: ST, small };
})();
