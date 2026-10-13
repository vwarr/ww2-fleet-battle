// air_gunners.js — WW.gunners: the bombers' own guns. Loads after air_strafe.js, before land_air.js (which wraps
// WW.strike.dive / torp: its level bombers never reach the wrapper here).
// - Rear gunners: a dive / torpedo bomber (and the land bombers, by variant) fires its flexible guns at an enemy fighter
//   in its rear arc (a turret bomber: all round) within REAR_R, in bursts every BURST_T s: one WW.rand() hit roll per
//   burst. The chance falls with the range and with the fighter's speed across the gunner (a fast high-side or diving
//   pass is hard to track; a fighter sitting on the tail is not), and the gunner cannot shoot from a dive or a pull-out.
//   Damage is the gun data's rear factor (WW.PLANE_GUNS) x REAR_DMG. In 1942 a Zero or a Wildcat lost to a rear
//   gunner was an event, not routine (SBD gunners did get Zeros at Coral Sea and Midway): keep it modest.
// - Forward guns: (a) a dive bomber with forward guns, after its pull-out, with fuel and not badly hit, makes ONE
//   strafing pass (air_strafe.js pass, sf.one) on a small craft near it, or now and then on the ship it just bombed,
//   which only keeps that ship's light AA's heads down (suppress); then home. (b) A torpedo bomber with forward guns
//   (TBD, B-26; not the Kate, which had none) fires at the target's deck inside FWD_R with the nose on: the last of
//   the run-in (the drop is 80-100 out, past gun range) and the pop-up over the ship after it (air_attack.js 'out'):
//   suppression only (ship.aaSup, read by combat_aa.js light AA), deterministic (no draw).
// Sim code: WW.rand only (rear-gunner hit rolls, the big-ship strafe choice); tracers Math.random (visual only).
window.WW = window.WW || {};
(function () {
  // Defensive / forward firepower per nation and kind (rear: flexible guns, one 7.7 mm / .30 = 1; fwd: fixed forward
  // guns, two .50s = 1; 0 = none), and per land-plane variant (land_air.js VAR). arc: the rear gunner's field of fire
  // off the tail (rad; a turret bomber covers all round).
  //   SBD-3 Dauntless: 2 x .50 cowl, twin .30 flexible.        TBD-1 Devastator: 1 x .30 cowl, 1 x .30 flexible.
  //   D3A1 Val: 2 x 7.7 mm cowl, 1 x 7.7 mm flexible.           B5N2 Kate: no forward guns, 1 x 7.7 mm flexible.
  //   B-26B Marauder: .50 nose, dorsal turret, tail.            B-17E: twin .50 dorsal / ball / tail turrets + waist.
  //   G4M1 Betty: 20 mm tail cannon, 7.7 mm dorsal / waist / nose.
  WW.PLANE_GUNS = {
    USN: { dive: { fwd: 1, rear: 1.6, arc: 1.6 }, torpedo: { fwd: 0.3, rear: 1, arc: 1.5 } },
    IJN: { dive: { fwd: 0.45, rear: 1, arc: 1.6 }, torpedo: { fwd: 0, rear: 1, arc: 1.5 } },
    _: { dive: { fwd: 0.5, rear: 1, arc: 1.5 }, torpedo: { fwd: 0.3, rear: 1, arc: 1.5 } },
    variant: { b26: { fwd: 0.6, rear: 3, arc: 3.2 }, b17: { fwd: 0.3, rear: 5, arc: 3.2 },
               g4m: { fwd: 0.2, rear: 2.2, arc: 2.2 }, g4mL: { fwd: 0.2, rear: 2.2, arc: 2.2 } }
  };
  const REAR_R = 34, BURST_T = 0.35, P0 = 0.2, REAR_DMG = 0.7;
  const FWD_R = 60, FWD_T = 0.4, SUP_T = 3;
  const PD_R = 80, PD_FUEL = 40, PD_T = 18, PD_BIG = 0.2;
  const ST = { bursts: 0, hits: 0, kills: 0, fwdBursts: 0, sups: 0, pdStrafes: 0, pdBig: 0 };
  const PK = WW.cfg.PLANE_K || 1;
  const NOGUN = { fwd: 0, rear: 0, arc: 0 };

  function guns(p) {
    if (p.gd) return p.gd;
    const V = WW.PLANE_GUNS.variant[p.variant], N = WW.PLANE_GUNS[p.nation] || WW.PLANE_GUNS._;
    return (p.gd = V || N[p.kind] || NOGUN);
  }
  const AIR = { transit: 1, attack: 1, 'return': 1 };
  // the enemy fighter the gunner can bear on: in the rear arc within REAR_R, coming at us (its foe) or very close
  function rearTarget(p, g) {
    let best = null, bd = REAR_R;
    const tail = p.heading + Math.PI;
    for (const q of WW.world.planes) {
      if (!q.alive || q.kind !== 'fighter' || q.nation === p.nation || !AIR[q.state] || q.y < 2) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d >= bd || (q.foe !== p && d > 16)) continue;
      if (Math.abs(WW.angleDiff(tail, Math.atan2(q.z - p.z, q.x - p.x))) > g.arc && d > 6) continue;
      bd = d; best = q;
    }
    return best;
  }
  // the chance a burst connects: range, and how fast the fighter moves relative to the bomber (a sitting tail chase
  // ~1, a fast high-side / diving pass ~0.25)
  function pHit(p, q, d) {
    const vx = Math.cos(q.heading) * q.speed - Math.cos(p.heading) * p.speed, vz = Math.sin(q.heading) * q.speed - Math.sin(p.heading) * p.speed;
    const rel = Math.hypot(vx, (q.vy || 0) - (p.vy || 0), vz);
    return P0 * WW.clamp(1.15 - d / REAR_R, 0.15, 1) * WW.clamp(1.3 - rel / 22, 0.25, 1);
  }
  function rear(p, g, s, dt) {
    if (p.phase === 'roll' || p.phase === 'dive' || p.phase === 'pull' || !AIR[p.state] || p.y < 1) { s.at = null; return; }
    if ((s.t -= dt) > 0) { s.fireT -= dt; return; }
    s.t = BURST_T;
    const q = rearTarget(p, g);
    s.at = q; s.fireT = q ? BURST_T : 0;
    if (!q) return;
    const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    ST.bursts++;
    const hit = WW.rand() < pHit(p, q, d) * Math.min(1.6, Math.sqrt(g.rear));
    if (!WW.simOnly) rearFx(p, q, hit);
    if (!hit) return;
    ST.hits++;
    const lethal = q.hp - REAR_DMG * g.rear <= 0;
    if (lethal && !q.killedBy) q.killedBy = p;
    q.damage(REAR_DMG * g.rear);
    if (!q.alive) { ST.kills++; WW.emit('planeKill', { victim: q, shooter: p, gunner: true }); }
    else if (lethal && q.killedBy === p) q.killedBy = null;
  }
  function rearFx(p, q, hit) {   // visual only
    const TR = WW.planeTracers; if (!TR || !TR.burst) return;
    const ch = Math.cos(p.heading), sh = Math.sin(p.heading), gx = p.x - ch * 0.9 * PK, gy = p.y + 0.45 * PK, gz = p.z - sh * 0.9 * PK;
    const m = hit ? 0.3 : 2.5;
    TR.burst(gx, gy, gz, q.x + (Math.random() - 0.5) * m, q.y + (Math.random() - 0.5) * m, q.z + (Math.random() - 0.5) * m, 4, ch * p.speed, p.vy, sh * p.speed, 0.04);
  }

  // ---------- forward guns ----------
  // AA suppression: the ship's light AA hits less for SUP_T s (combat_aa.js: hit chance x ship.aaSup.k); stronger guns
  // suppress more; the strongest running suppression holds
  function suppress(u, gk) {
    const now = WW.time.now, k = WW.clamp(1 - 0.3 * Math.sqrt(gk), 0.55, 0.95);
    if (!u.aaSup || u.aaSup.until < now || k <= u.aaSup.k) u.aaSup = { until: now + SUP_T, k };
    else u.aaSup.until = Math.max(u.aaSup.until, now + SUP_T * 0.5);
    ST.sups++;
  }
  // (b) the torpedo run: the nose on the ship inside FWD_R
  function fwdRun(p, g, s, dt) {
    s.fwdT -= dt;
    const t = p.phase === 'out' ? p.outTgt : p.phase === 'run' ? p.target : null;
    if (!t || !t.alive || t.sinking || !t.stats) { s.fwdAt = null; return; }
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d > FWD_R || d < 8 || s.fwdT > 0 || Math.abs(WW.angleDiff(p.heading, Math.atan2(t.z - p.z, t.x - p.x))) > 0.25) return;
    s.fwdT = FWD_T; s.fwdAt = t; ST.fwdBursts++;
    suppress(t, g.fwd);
    if (!WW.simOnly && WW.planeTracers && WW.planeTracers.burst) {
      const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
      WW.planeTracers.burst(p.x + ch * 1.2 * PK, p.y + 0.2 * PK, p.z + sh * 1.2 * PK, t.x + (Math.random() - 0.5) * 4, 2 + Math.random() * 2, t.z + (Math.random() - 0.5) * 4,
        3, ch * p.speed, p.vy, sh * p.speed, 0.02);
    }
  }
  // (a) after the pull-out: one strafing pass on a small craft near, or (PD_BIG of the time) on the ship just bombed
  function postDive(pl, g) {
    if (!g.fwd || !WW.strafe || pl.pdDone || pl.search || pl.crippled || pl.hp < pl.maxHp * 0.6 || pl.fuel < PD_FUEL || !WW.intel) return;
    pl.pdDone = true;
    let best = null, bd = PD_R, big = false;
    for (const c of WW.intel.enemyShips(pl.nation, { fresh: 3 })) { const d = WW.dist(pl.x, pl.z, c.x, c.z); if (d < bd && WW.strafe.small(c.unit)) { bd = d; best = c.unit; } }
    const t = pl.diveTgt;
    if (!best && t && t.alive && !t.sinking && !t.isBase && t.stats && WW.dist(pl.x, pl.z, t.x, t.z) < PD_R && WW.strafe.fresh(pl.nation, t, 5) && WW.rand() < PD_BIG) { best = t; big = true; }
    if (!best) return;
    pl.strafe = best; pl.state = 'attack';
    pl.sf = { ph: 'setup', t: 0, b: Math.atan2(pl.z - best.z, pl.x - best.x), fT: 0, home: true, until: WW.time.now + PD_T, one: true, big, gk: g.fwd };
    ST.pdStrafes++; if (big) ST.pdBig++;
    if (WW.emit) WW.emit('airOrder', { carrier: pl.carrier, order: 'strafe', plane: pl, squadron: pl.squadron || null, target: best });
  }

  // ---------- hooks ----------
  const st = p => p.gnr || (p.gnr = { t: 0, fireT: 0, at: null, fwdT: 0, fwdAt: null });
  if (WW.Plane) {
    const P = WW.Plane.prototype, up0 = P.update;
    P.update = function (dt) {
      up0.apply(this, arguments);
      if (!(dt > 0) || !this.alive || this.removed || (this.kind !== 'dive' && this.kind !== 'torpedo')) return;
      const g = guns(this), s = st(this);
      if (g.rear > 0) rear(this, g, s, dt);
      if (g.fwd > 0 && this.kind === 'torpedo') fwdRun(this, g, s, dt);
    };
  }
  if (WW.strike) {
    const dive0 = WW.strike.dive;
    WW.strike.dive = function (pl, dt) {
      if (pl.strafe) { if (WW.strafe.pass(pl, dt)) return; if (pl.state !== 'return') pl.state = 'return'; return; }   // the post-dive pass
      const exit = pl.phase === 'exit';
      dive0(pl, dt);
      if (exit && !pl.phase && !pl.ordnance && pl.state === 'return' && !pl.level) { const g = guns(pl); if (g.fwd > 0) postDive(pl, g); }
    };
  }
  // the director (camera.js candidates via WW.camHooks): a rear gunner hosing a fighter on the tail, close
  (WW.camHooks = WW.camHooks || []).push((add, dur) => {
    for (const p of WW.world.planes) if (p.alive && p.gnr && p.gnr.at && p.gnr.at.alive && p.gnr.fireT > 0 && Math.hypot(p.gnr.at.x - p.x, p.gnr.at.z - p.z) < 20)
      add(6.4, 'chase', p, { dur: dur(8, 10) });
  });
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });
  WW.gunners = { stats: ST, guns, suppress, REAR_R };
})();
