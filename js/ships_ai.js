// ships_ai.js — owner C. Ship AI core: setup, the per-ship update (retarget, dispatch to the role file, guns),
// turrets, and the helpers the role files share (WW.shipAI.h). Called by WW.ships.update.
// Behaviour per type lives in the role files, which register into WW.shipAI.roles:
//   ai_surface.js (battleship / cruiser / destroyer), ai_carrier.js (carrier + air ops), ai_light.js (sub + PT).
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const BIG_PRIO = { carrier: 90, battleship: 80, cruiser: 50, destroyer: 10, submarine: -999, pt: -60 };
  const ARC = 2.5; // max turret swing either side of its rest angle
  const TURRET_RATE = { big: 0.5, med: 0.8, small: 1.6, mg: 3 };

  function bearing(a, b) { return Math.atan2(b.z - a.z, b.x - a.x); }
  function seen(ship, t) { return !WW.intel || WW.intel.visible(ship.nation, t); } // a current detection (intel.js)
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

  // Targets come from what the side knows (intel.js): only a fresh contact (a firing solution) can be a target;
  // the threat a carrier runs from and the sub a destroyer hunts may be older last-known positions.
  // Allies (formation centre, carrier, near) stay omniscient: a fleet knows where its own ships are.
  const THREAT_AGE = 20, SUB_AGE = 30;
  function retarget(ship) {
    const a = ship.ai, st = ship.stats, ships = WW.world.ships, now = WW.time.now;
    let best = null, bestS = 1e9, sub = null, subD = 1e9, threat = null, threatD = 1e9, any = null, anyD = 1e9, fb = null, fbD = 1e9;
    let cx = 0, cz = 0, cn = 0, cv = null, cvD = 1e9, near = null, nearD = 1e9;
    const big = ship.type === 'submarine' || ship.type === 'pt';
    for (const o of ships) {
      if (!o.alive || o === ship || o.nation !== ship.nation) continue;
      const d = WW.dist(ship.x, ship.z, o.x, o.z);
      if (!o.submerged && d < nearD) { nearD = d; near = o; }
      if (o.type !== 'submarine' && o.type !== 'pt') { cx += o.x; cz += o.z; cn++; }
      if (o.type === 'carrier' && d < cvD) { cvD = d; cv = o; }
    }
    const cs = WW.intel ? WW.intel.enemyShips(ship.nation) : [], FRESH = WW.intel ? WW.intel.T.FRESH : 3;
    a.subC = null; a.anyC = null;
    for (const c of cs) {
      const o = c.unit;
      if (!o || !o.alive) continue;
      const age = now - c.seenAt, d = WW.dist(ship.x, ship.z, c.x, c.z);
      if (d < anyD) { anyD = d; any = o; a.anyC = c; }
      if (o.type === 'submarine' && age <= SUB_AGE && a.datumDone !== c.seenAt && d < subD) { subD = d; sub = o; a.subC = c; }
      if (age <= THREAT_AGE && !o.submerged && o.stats.guns.length && o.type !== 'carrier' && d < threatD) { threatD = d; threat = o; }
      if (age > FRESH) continue;
      if (!o.submerged && d < nearD) { nearD = d; near = o; }
      if (o.type === 'submarine' && ship.type === 'submarine' && d < fbD) { fbD = d; fb = o; } // sub vs sub: last resort
      if (o.submerged) continue;
      let s = big ? d - BIG_PRIO[o.type] : d - o.stats.tons / 2000;
      if (big && o.type === 'submarine') { if (d < fbD) { fbD = d; fb = o; } continue; } // surfaced subs: last resort
      if (s < bestS) { bestS = s; best = o; }
    }
    if (!best) best = fb;
    a.cv = cv; a.near = near; a.nearD = nearD;
    ship.target = best; a.any = any; a.sub = sub; a.subD = subD; a.threat = threat; a.threatD = threatD;
    a.cn = cn; if (cn) { a.cx = cx / cn; a.cz = cz / cn; }
    // Per-calibre gun targets: main target if in range, else nearest visible enemy in range.
    const ct = a.calTarget || (a.calTarget = {});
    for (const g of st.guns) {
      let t = null;
      if (best && WW.dist(ship.x, ship.z, best.x, best.z) <= g.range) t = best;
      else {
        let bd = g.range;
        for (const c of cs) {
          const o = c.unit;
          if (!o || !o.alive || o.submerged || now - c.seenAt > FRESH) continue;
          const d = WW.dist(ship.x, ship.z, o.x, o.z);
          if (d < bd) { bd = d; t = o; }
        }
      }
      ct[g.cal] = t;
    }
  }

  function guns(ship, dt) {
    const a = ship.ai;
    let mw = false;
    for (const ts of a.turrets) {
      ts.reload -= dt;
      if (!ts.gun || ts.disabled) continue; // knocked out by a heavy hit (WW.damage)
      let tgt = a.calTarget && a.calTarget[ts.gun.cal];
      if (tgt && (!tgt.alive || tgt.submerged || !seen(ship, tgt))) tgt = null; // fire only on a current detection
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

  // Nothing to shoot: go to the nearest last-known contact, else search toward the enemy's half of the map
  // (the side away from our own fleet), then sweep north / south of it.
  function idle(ship) {
    const a = ship.ai, c = a.anyC && a.anyC.unit && a.anyC.unit.alive ? a.anyC : null;
    if (c && WW.dist(ship.x, ship.z, c.x, c.z) > 15) { ship.desiredHeading = bearing(ship, c); ship.throttle = 0.8; return; }
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, sp = a.search || (a.search = { x: 0, z: 0, leg: 0, east: (a.cn ? a.cx : ship.x) < W / 2 });
    if (!sp.leg || WW.dist(ship.x, ship.z, sp.x, sp.z) < 30) {
      sp.leg++;
      const k = sp.leg > 1 ? 0.85 : 0.7;
      sp.x = sp.east ? W * k : W * (1 - k);
      sp.z = H * (0.5 + (sp.leg > 1 ? (sp.leg & 1 ? 0.3 : -0.3) * a.orbitDir : 0));
      if (sp.leg > 2) sp.east = !sp.east; // swept the far side: come back the other way
    }
    ship.desiredHeading = Math.atan2(sp.z - ship.z, sp.x - ship.x); ship.throttle = 0.75;
  }

  const roles = {}; // type -> fn(ship, dt), filled by the role files; 'surface' is the default
  WW.shipAI = {
    roles,
    h: { bearing, seen, lead, fireSpread, blend, idle }, // shared helpers for the role files
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
      const role = roles[ship.type] || roles.surface;
      if (role) role(ship, dt);
      if (a.turrets.length) guns(ship, dt);
    },
    pickStrikeTarget: () => null // ai_carrier.js replaces it
  };
})();
