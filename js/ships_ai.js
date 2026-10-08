// ships_ai.js — owner C. Ship AI: targeting, steering goals, turrets, torpedoes,
// depth charges, submarine / PT / carrier behaviour. Called by WW.ships.update.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const STRIKE_PRIO = { carrier: 250, battleship: 180, cruiser: 80, destroyer: 20, submarine: 0, pt: -20 };
  const BIG_PRIO = { carrier: 90, battleship: 80, cruiser: 50, destroyer: 10, submarine: -999, pt: -60 };
  const SONAR = 65;      // destroyer sub-detection radius
  const SUB_MAX_DIVE = 45, SUB_SURFACE = 25; // a sub must surface after this long submerged, for this long
  const ARC = 2.5; // max turret swing either side of its rest angle
  const TURRET_RATE = { big: 0.5, med: 0.8, small: 1.6, mg: 3 };

  function bearing(a, b) { return Math.atan2(b.z - a.z, b.x - a.x); }
  function gunFor(st, cal) { return st.guns.find(g => g.cal === cal) || st.guns[0] || null; }

  // Simple lead point for a projectile of speed v.
  function lead(from, t, v) {
    let px = t.x, pz = t.z;
    for (let i = 0; i < 2; i++) {
      const tt = WW.dist(from.x, from.z, px, pz) / v;
      px = t.x + Math.cos(t.heading) * t.speed * tt; pz = t.z + Math.sin(t.heading) * t.speed * tt;
    }
    return { x: px, z: pz };
  }

  function fireSpread(ship, t, range) {
    const tp = ship.stats.torpedoes, n = tp.count;
    const p = lead(ship, t, WW.TORPEDO.speed), b = Math.atan2(p.z - ship.z, p.x - ship.x);
    const off = Math.min(4, ship.stats.length * 0.3);
    const ox = ship.x + Math.cos(b) * off, oz = ship.z + Math.sin(b) * off;
    const spread = n > 2 ? 0.07 : 0.05;
    for (let i = 0; i < n; i++) WW.combat.fireTorpedo(ship, ox, oz, b + (i - (n - 1) / 2) * spread, ship.nation, range || tp.range);
    ship.ai.torpReload = tp.reload * WW.randRange(0.9, 1.2);
  }

  // Blend a heading with a pull toward a point.
  function blend(h, ship, px, pz, w) {
    const b = Math.atan2(pz - ship.z, px - ship.x);
    return Math.atan2(Math.sin(h) + Math.sin(b) * w, Math.cos(h) + Math.cos(b) * w);
  }

  function retarget(ship) {
    const a = ship.ai, st = ship.stats, ships = WW.world.ships;
    let best = null, bestS = 1e9, sub = null, subD = 1e9, threat = null, threatD = 1e9, any = null, anyD = 1e9, fb = null, fbD = 1e9;
    let cx = 0, cz = 0, cn = 0;
    const big = ship.type === 'submarine' || ship.type === 'pt';
    for (const o of ships) {
      if (!o.alive) continue;
      if (o.nation === ship.nation) {
        if (o !== ship && o.type !== 'submarine' && o.type !== 'pt') { cx += o.x; cz += o.z; cn++; }
        continue;
      }
      const d = WW.dist(ship.x, ship.z, o.x, o.z);
      if (d < anyD) { anyD = d; any = o; }
      if (o.type === 'submarine' && d < subD) { subD = d; sub = o; }
      if (o.type === 'submarine' && ship.type === 'submarine' && d < fbD) { fbD = d; fb = o; } // sub vs sub: last resort
      if (o.submerged) continue;
      if (o.stats.guns.length && o.type !== 'carrier' && d < threatD) { threatD = d; threat = o; }
      let s = big ? d - BIG_PRIO[o.type] : d - o.stats.tons / 2000;
      if (big && o.type === 'submarine') { if (d < fbD) { fbD = d; fb = o; } continue; } // surfaced subs: last resort
      if (s < bestS) { bestS = s; best = o; }
    }
    if (!best) best = fb;
    ship.target = best; a.any = any; a.sub = sub; a.subD = subD; a.threat = threat; a.threatD = threatD;
    a.cn = cn; if (cn) { a.cx = cx / cn; a.cz = cz / cn; }
    // Per-calibre gun targets: main target if in range, else nearest visible enemy in range.
    a.calTarget = {};
    for (const g of st.guns) {
      let t = null;
      if (best && WW.dist(ship.x, ship.z, best.x, best.z) <= g.range) t = best;
      else {
        let bd = g.range;
        for (const o of ships) {
          if (!o.alive || o.nation === ship.nation || o.submerged) continue;
          const d = WW.dist(ship.x, ship.z, o.x, o.z);
          if (d < bd) { bd = d; t = o; }
        }
      }
      a.calTarget[g.cal] = t;
    }
  }

  function guns(ship, dt) {
    const a = ship.ai, st = ship.stats;
    let mw = false;
    for (const ts of a.turrets) {
      ts.reload -= dt;
      if (!ts.gun) continue;
      let tgt = a.calTarget && a.calTarget[ts.gun.cal];
      if (tgt && (!tgt.alive || tgt.submerged)) tgt = null;
      // Aim as an offset from the turret's rest angle (aft turrets rest at PI) so it never swings through the bridge.
      let off = 0, rel = 0, d = 1e9;
      if (tgt) {
        rel = WW.angleDiff(ship.heading, bearing(ship, tgt)); d = WW.dist(ship.x, ship.z, tgt.x, tgt.z);
        off = WW.clamp(WW.angleDiff(ts.rest, rel), -ARC, ARC);
      }
      const rate = (TURRET_RATE[ts.cal] || 1) * dt;
      ts.off += WW.clamp(off - ts.off, -rate, rate);
      ts.aim = ts.rest + ts.off;
      ts.t.obj.rotation.y = -ts.aim;
      if (tgt && ts.reload <= 0 && d <= ts.gun.range && Math.abs(WW.angleDiff(ts.aim, rel)) < 0.12) {
        if (!mw) { ship.group.updateMatrixWorld(true); mw = true; }
        WW.combat.fireShell(ship, ts.t, tgt, ts.gun.cal);
        ts.reload = ts.gun.reload * WW.randRange(0.9, 1.15);
      }
    }
  }

  function surfaceAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = ship.target;
    // Destroyers hunt nearby subs.
    // Destroyers hunt subs on sonar (radius SONAR), or at any range when no surface target is left.
    if (st.depthCharges && a.sub && a.sub.alive && (a.subD < SONAR || !t || t.type === 'submarine')) {
      const s = a.sub, p = lead(ship, s, st.speed);
      ship.desiredHeading = Math.atan2(p.z - ship.z, p.x - ship.x); ship.throttle = 1;
      a.dcReload -= dt;
      if (a.dcReload <= 0 && WW.dist(ship.x, ship.z, s.x, s.z) < 9) {
        const q = ship.toWorld(-st.length * 0.5, 0);
        WW.combat.dropDepthCharge(ship, q[0], q[1]);
        a.dcReload = 1.3;
      }
      return;
    }
    if (!t) { idle(ship); return; }
    const d = WW.dist(ship.x, ship.z, t.x, t.z), b = bearing(ship, t);
    const main = st.guns[0];
    let pref = main ? main.range * 0.7 : 60;
    if (st.torpedoes && ship.type === 'destroyer') pref = Math.min(pref, st.torpedoes.range * 0.6);
    if (WW.game && WW.game.roundTime > WW.cfg.ROUND_TIMEOUT * 0.6) pref *= 0.55; // late round: close in to finish it
    let h;
    if (d > pref * 1.2) { h = b; ship.throttle = 1; }
    else if (d < pref * 0.65) { h = b + PI + a.orbitDir * 0.4; ship.throttle = 1; }
    else { h = b + a.orbitDir * (PI / 2 - WW.clamp((d - pref) / pref, -0.5, 0.5) * 1.2); ship.throttle = 0.8; }
    if (a.cn && WW.dist(ship.x, ship.z, a.cx, a.cz) > 40) h = blend(h, ship, a.cx, a.cz, 0.35);
    ship.desiredHeading = h;
    // Torpedoes.
    if (st.torpedoes && a.torpReload <= 0 && !t.submerged && d < st.torpedoes.range * 0.8 && d > 12) fireSpread(ship, t);
  }

  function idle(ship) {
    const a = ship.ai, o = a.any;
    if (o) { ship.desiredHeading = bearing(ship, o); ship.throttle = 0.8; }
    else { ship.desiredHeading = Math.atan2(WW.cfg.MAP_H / 2 - ship.z, WW.cfg.MAP_W / 2 - ship.x); ship.throttle = 0.4; }
  }

  function subAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = ship.target;
    a.subT -= dt;
    // Air and batteries run out: after SUB_MAX_DIVE s under water the sub must surface for SUB_SURFACE s.
    a.diveT = ship.submerged ? (a.diveT || 0) + dt : 0;
    if (a.diveT > SUB_MAX_DIVE && !(a.forcedT > 0)) { a.forcedT = SUB_SURFACE; }
    if (a.forcedT > 0) { a.forcedT -= dt; ship.wantSurface = true; a.subT = Math.max(a.subT, 1); }
    else if (ship.hp < ship.maxHp * 0.35) ship.wantSurface = true;
    else if (a.subT <= 0) {
      if (ship.wantSurface) { ship.wantSurface = false; a.subT = WW.randRange(30, 45); }
      else { ship.wantSurface = true; a.subT = WW.randRange(12, 20); }
    }
    if (!(a.forcedT > 0) && ship.wantSurface && ship.hp >= ship.maxHp * 0.35 && a.threat && a.threat.type === 'destroyer' && a.threatD < 60) {
      ship.wantSurface = false; a.subT = WW.randRange(25, 40);
    }
    if (!t) { idle(ship); ship.throttle = 0.6; return; }
    const d = WW.dist(ship.x, ship.z, t.x, t.z), p = lead(ship, t, WW.TORPEDO.speed);
    const lb = Math.atan2(p.z - ship.z, p.x - ship.x);
    a.evadeT -= dt;
    if (a.evadeT > 0) { ship.desiredHeading = bearing(ship, t) + PI + a.orbitDir * 0.6; ship.throttle = 1; }
    else if (d > 75) { ship.desiredHeading = lb; ship.throttle = 1; }
    else { ship.desiredHeading = lb; ship.throttle = 0.5; }
    if (a.torpReload <= 0 && d < st.torpedoes.range * 0.8 && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.3) {
      fireSpread(ship, t); a.evadeT = 10;
    }
  }

  function ptAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = ship.target;
    if (!t) { idle(ship); return; }
    const d = WW.dist(ship.x, ship.z, t.x, t.z), b = bearing(ship, t);
    ship.throttle = 1;
    a.ptT -= dt;
    if (a.ptState === 'in') {
      const p = lead(ship, t, WW.TORPEDO.speed), lb = Math.atan2(p.z - ship.z, p.x - ship.x);
      ship.desiredHeading = lb;
      if (a.torpReload <= 0 && d < st.torpedoes.range * 0.7 && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.35) {
        fireSpread(ship, t); a.ptState = 'out'; a.ptT = 12;
      } else if (a.torpReload > 0 && d < 80) { a.ptState = 'out'; a.ptT = 8; }
    } else {
      // Dash out with a jink, then hold off until torpedoes are nearly reloaded.
      const jink = Math.sin(WW.time.now * 1.7 + ship.id) * 0.5;
      ship.desiredHeading = d < 100 ? b + PI + jink : b + a.orbitDir * PI / 2;
      if (a.ptT <= 0 && a.torpReload <= 3) a.ptState = 'in';
    }
  }

  function pickStrikeTarget(ship) {
    let best = null, bs = 1e9;
    for (const o of WW.world.ships) {
      if (!o.alive || o.nation === ship.nation || o.submerged) continue;
      const s = WW.dist(ship.x, ship.z, o.x, o.z) - (STRIKE_PRIO[o.type] || 0);
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  }

  function carrierAI(ship, dt) {
    const a = ship.ai;
    // Movement: stay out of enemy gun range, keep near the fleet.
    // Late in a round a carrier stops running, so a lone carrier cannot stall the round.
    const late = WW.game && WW.game.roundTime > WW.cfg.ROUND_TIMEOUT * 0.6;
    if (late && a.threat) { ship.desiredHeading = bearing(ship, a.threat); ship.throttle = 0.8; } // close in to finish the round
    else if (a.threat && a.threatD < 160) {
      let h = bearing(ship, a.threat) + PI;
      if (a.cn) h = blend(h, ship, a.cx, a.cz, 0.3);
      ship.desiredHeading = h; ship.throttle = 1;
    } else if (a.cn && WW.dist(ship.x, ship.z, a.cx, a.cz) > 45) {
      ship.desiredHeading = Math.atan2(a.cz - ship.z, a.cx - ship.x); ship.throttle = 0.7;
    } else { ship.desiredHeading = ship.heading + 0.25 * a.orbitDir; ship.throttle = 0.45; }
    if (!WW.air || !ship.hangar) return;
    const hg = ship.hangar;
    // CAP when enemy planes come near.
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 3;
      let near = 0, cap = 0;
      for (const p of WW.world.planes) {
        if (!p.alive) continue;
        if (p.nation !== ship.nation && WW.dist(ship.x, ship.z, p.x, p.z) < 140) near++;
        if (p.carrier === ship && p.kind === 'fighter' && !p.target) cap++;
      }
      if (near && cap < 3 && hg.fighter > 0 && !a.queue.some(q => q.kind === 'fighter' && !q.target)) a.queue.unshift({ kind: 'fighter', target: null });
    }
    // Strike waves.
    a.strikeT -= dt;
    if (a.strikeT <= 0 && a.queue.length === 0) {
      a.strikeT = WW.randRange(35, 55);
      const tgt = pickStrikeTarget(ship);
      if (tgt && hg.dive + hg.torpedo > 0) {
        const esc = Math.min(Math.max(0, hg.fighter - 2), 3);
        for (let i = 0; i < esc; i++) a.queue.push({ kind: 'fighter', target: tgt });
        const n = Math.max(hg.dive, hg.torpedo);
        for (let i = 0; i < n; i++) {
          if (i < hg.dive) a.queue.push({ kind: 'dive', target: tgt });
          if (i < hg.torpedo) a.queue.push({ kind: 'torpedo', target: tgt });
        }
      }
    }
    a.launchT -= dt;
    if (a.queue.length && a.launchT <= 0) {
      const q = a.queue.shift();
      let tgt = q.target;
      if (tgt && (!tgt.alive || tgt.submerged)) tgt = pickStrikeTarget(ship);
      if (q.target && !tgt) return;
      if (WW.air.launch(ship, q.kind, tgt)) a.launchT = 1.5;
    }
  }

  WW.shipAI = {
    setup(ship) {
      const st = ship.stats;
      ship.ai = {
        retargetT: WW.rand(), orbitDir: WW.rand() < 0.5 ? -1 : 1, blockedT: 0,
        turrets: ship.model.turrets.map(t => {
          const gun = gunFor(st, t.cal);
          const rest = -t.obj.rotation.y;
          return { t, cal: t.cal, gun, rest, off: 0, aim: rest, reload: gun ? WW.rand() * gun.reload : 0 };
        }),
        torpReload: WW.randRange(5, 15), dcReload: 0, subT: WW.randRange(40, 80), evadeT: 0,
        ptState: 'in', ptT: 0, strikeT: WW.randRange(6, 12), capT: 2, queue: [], launchT: 0,
        calTarget: {}, cn: 0, cx: ship.x, cz: ship.z, threatD: 1e9
      };
    },
    update(ship, dt) {
      if (!ship.ai || !ship.ai.turrets) this.setup(ship);
      const a = ship.ai;
      a.retargetT -= dt; a.torpReload -= dt;
      if (ship.target && !ship.target.alive) a.retargetT = 0;
      if (a.retargetT <= 0) { a.retargetT = 1 + WW.rand() * 0.5; retarget(ship); }
      // Flip orbit side when boxed in for a while.
      if (ship.clearAhead < ship.lookDist * 0.4) { a.blockedT += dt; if (a.blockedT > 4) { a.blockedT = 0; a.orbitDir *= -1; } }
      else a.blockedT = 0;
      switch (ship.type) {
        case 'carrier': carrierAI(ship, dt); break;
        case 'submarine': subAI(ship, dt); break;
        case 'pt': ptAI(ship, dt); break;
        default: surfaceAI(ship, dt);
      }
      if (a.turrets.length) guns(ship, dt);
    },
    pickStrikeTarget
  };
})();
