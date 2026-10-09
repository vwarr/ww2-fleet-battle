// ships_ai.js — owner C. Ship AI core: setup, the per-ship update (retarget, dispatch to the role file, guns),
// turrets, and the helpers the role files share (WW.shipAI.h). Called by WW.ships.update.
// Behaviour per type lives in the role files, which register into WW.shipAI.roles:
//   ai_surface.js (battleship / cruiser / destroyer), ai_carrier.js (carrier + air ops), ai_light.js (sub + PT).
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
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

  // Torpedo spread at t (lead-aimed). Holds fire (returns false, retry in 1.5 s) when an allied surface ship is
  // inside the fan out to the torpedoes' range: the friendly-fire check along the spread.
  const AIM_ERR = 0.06; // rad of torpedo aim error (+-) per 100 units of range
  function fireSpread(ship, t, range) {
    const tp = ship.stats.torpedoes, n = tp.count;
    // fire-control error grows with the range: a long shot is fired on an estimate of the target's course and speed
    // that the target's own movements spoil (both navies: the Long Lance's reach is not a free hit)
    const p = lead(ship, t, tp.speed || WW.TORPEDO.speed), d0 = WW.dist(ship.x, ship.z, t.x, t.z);
    const b = Math.atan2(p.z - ship.z, p.x - ship.x) + (WW.rand() * 2 - 1) * AIM_ERR * d0 / 100;
    const spread = n > 2 ? 0.07 : 0.05, half = spread * (n - 1) / 2 + 0.08, R = range || tp.range;
    for (const o of WW.world.ships) {
      if (o === ship || !o.alive || o.nation !== ship.nation || o.submerged) continue;
      const d = WW.dist(ship.x, ship.z, o.x, o.z);
      if (d > R + 5 || d < 1) continue;
      const off = Math.abs(WW.angleDiff(b, Math.atan2(o.z - ship.z, o.x - ship.x)));
      if (off < half + Math.atan2(o.stats.length * 0.5 + 2, d)) { ship.ai.torpReload = 1.5; return false; }
    }
    const off = Math.min(4, ship.stats.length * 0.3);
    const ox = ship.x + Math.cos(b) * off, oz = ship.z + Math.sin(b) * off;
    for (let i = 0; i < n; i++) WW.combat.fireTorpedo(ship, ox, oz, b + (i - (n - 1) / 2) * spread, ship.nation, R);
    ship.ai.torpReload = tp.reload * WW.randRange(0.9, 1.2);
    if (WW.supply) WW.supply.torpFired(ship); // reload sets (ship_supply.js): out of torpedoes, the tubes stay empty
    return true;
  }

  // Blend a heading with a pull toward a point.
  function blend(h, ship, px, pz, w) {
    const b = Math.atan2(pz - ship.z, px - ship.x);
    return Math.atan2(Math.sin(h) + Math.sin(b) * w, Math.cos(h) + Math.cos(b) * w);
  }

  // ---- target score (spec: roleWeight x value x pHit x finishBonus x assignment - exposure) ----
  // ROLE_W[shooter type][target type]: what each type is for (main battery / torpedoes). 0 = never.
  const ROLE_W = {
    carrier:    { carrier: 0.2, battleship: 0.2, cruiser: 0.3, destroyer: 0.6, submarine: 0.3, pt: 1 },   // self-defence guns only
    battleship: { carrier: 1, battleship: 1.2, cruiser: 1, destroyer: 0.35, submarine: 0, pt: 0 },      // never main guns on PTs or subs
    cruiser:    { carrier: 0.8, battleship: 0.45, cruiser: 1, destroyer: 1.2, submarine: 0.3, pt: 0.6 },
    destroyer:  { carrier: 0.15, battleship: 0.3, cruiser: 0.5, destroyer: 1.2, submarine: 2, pt: 1.5 },
    submarine:  { carrier: 1.5, battleship: 1.2, cruiser: 1, destroyer: 0.1, submarine: 0.05, pt: 0 },
    pt:         { carrier: 0.8, battleship: 0.4, cruiser: 0.6, destroyer: 0.7, submarine: 0.05, pt: 0.3 }
  };
  // Per-calibre overrides for guns that are not the ship's main battery role (a PT's machine gun never duels a
  // battleship or cruiser) and secondaries (closest small threat first).
  const GUN_W = { mg: { carrier: 0, battleship: 0, cruiser: 0, destroyer: 0.6, submarine: 1, pt: 1.5 } };
  const SEC_W = { carrier: 0.8, battleship: 0.8, cruiser: 1, destroyer: 1.3, submarine: 1.2, pt: 1.6 };
  const VALUE = { carrier: 10, battleship: 9, cruiser: 5, destroyer: 2.5, submarine: 2, pt: 1 };
  const STICKY = 1.3; // switch targets only for a score this much better
  function reach(st) { return st.guns[0] ? st.guns[0].range : st.torpedoes ? st.torpedoes.range : 60; }
  // c: the side's contact for o (position, quality); W: weight table row; R: the weapon's reach.
  // A destroyer goes for a carrier or battleship only as part of a flotilla attack (another own destroyer within
  // PACK_R), never as a solo charge into the big ship's secondaries.
  const PACK_R = 150;
  function packed(ship) {
    for (const o of WW.world.ships) if (o !== ship && o.alive && o.nation === ship.nation && o.type === 'destroyer' && WW.dist2(ship.x, ship.z, o.x, o.z) < PACK_R * PACK_R) return true;
    return false;
  }
  function score(ship, o, c, W, R, risk) {
    let w = W[o.type]; if (!w) return 0;
    if (ship.type === 'destroyer' && (o.type === 'carrier' || o.type === 'battleship') && !packed(ship) &&
      !(WW.endgameAI && WW.endgameAI.isCripple(o) && WW.fleetCmd && (WW.fleetCmd.side(ship.nation) || {}).posture === 'pursue')) return 0; // a slowed cripple in a pursuit: alone too
    const d = WW.dist(ship.x, ship.z, c.x, c.z);
    const pHit = (d <= R ? 1 - 0.5 * (d / R) * (d / R) : 0.5 * Math.max(0.1, 1 - (d - R) / (2 * R)))
      * (0.85 + 0.15 * Math.abs(Math.sin(o.heading - Math.atan2(o.z - ship.z, o.x - ship.x))))   // aspect: broadside is easier
      * (c.quality === 'visual' || c.quality === 'sonar' ? 1 : 0.8);                               // spotted by a plane / scout
    const chase = unreachable(ship, c) ? 0.3 : 1;
    const finish = chase + 0.8 * (1 - o.hp / o.maxHp) + (o.dmgCrit ? 0.1 : 0);   // low hp / the big fire (damage.js checkCritical;
    // not dmgSites.length: hit-site fires last a Math.random time, which broke seeded replays)
    const assign = WW.fleetCmd ? WW.fleetCmd.assignment(ship, o) : 1;
    const base = w * VALUE[o.type];
    const exposure = WW.threat ? base * 0.3 * Math.min(1, WW.threat.danger(ship.nation, c.x, c.z) / (2 * WW.threat.DREF)) * (1 - risk) : 0;
    return base * pHit * finish * assign - exposure;
  }
  // A carrier out of gun range that is (nearly) as fast as we are cannot be caught: chasing it only drags the ship
  // out of formation (a battleship or cruiser never runs down a carrier; it fights it only if it comes in range).
  // Pursuing (fleet_cmd posture 'pursue'): a carrier that is fair game (crippled, slowed or unescorted,
  // ai_endgame.js) is chased.
  function unreachable(ship, t) {
    const R = reach(ship.stats), d = WW.dist(ship.x, ship.z, t.x, t.z);
    if (d <= R) return false;
    const u = t.unit || t;
    if (u.type !== 'carrier') return false;
    if (WW.endgameAI && WW.endgameAI.fairGame(ship, u, WW.fleetCmd && WW.fleetCmd.side(ship.nation))) return false;
    return u.stats.speed >= 0.9 * ship.stats.speed; // a carrier can always turn away and outrun us
  }
  function riskOf(ship) { const d = WW.fleetCmd && WW.fleetCmd.doctrine(ship.nation); return d ? d.risk[ship.type] || 0 : 0.5; }

  // Targets come from what the side knows (intel.js): only a fresh contact (a firing solution) can be a target;
  // the threat a carrier runs from and the sub a destroyer hunts may be older last-known positions.
  // Allies (formation centre, carrier, near) stay omniscient: a fleet knows where its own ships are.
  const THREAT_AGE = 20, SUB_AGE = 30;
  function retarget(ship) {
    const a = ship.ai, st = ship.stats, ships = WW.world.ships, now = WW.time.now;
    let best = null, bestS = 0, sub = null, subD = 1e9, threat = null, threatD = 1e9, any = null, anyD = 1e9, fb = null, fbD = 1e9;
    let cx = 0, cz = 0, cn = 0, cv = null, cvD = 1e9, near = null, nearD = 1e9;
    for (const o of ships) {
      if (!o.alive || o === ship || o.nation !== ship.nation) continue;
      const d = WW.dist(ship.x, ship.z, o.x, o.z);
      if (!o.submerged && d < nearD) { nearD = d; near = o; }
      if (o.type !== 'submarine' && o.type !== 'pt') { cx += o.x; cz += o.z; cn++; }
      if (o.type === 'carrier' && d < cvD) { cvD = d; cv = o; }
    }
    const cs = WW.intel ? WW.intel.enemyShips(ship.nation) : [], FRESH = WW.intel ? WW.intel.T.FRESH : 3;
    const W = ROLE_W[ship.type] || ROLE_W.cruiser, R = reach(st), risk = riskOf(ship), old = ship.target;
    let oldS = -1;
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
      if (o.submerged) continue;
      if (o.type === 'submarine' && ship.type === 'submarine' && d < fbD) { fbD = d; fb = o; } // sub vs sub: last resort
      const s = score(ship, o, c, W, R, risk);
      if (o === old) oldS = s;
      if (s > bestS) { bestS = s; best = o; }
    }
    if (old && oldS > 0 && best !== old && bestS <= oldS * STICKY) { best = old; bestS = oldS; } // no target thrash
    if (!best && W.submarine > 0) best = fb;
    a.targetScore = bestS;
    a.cv = cv; a.near = near; a.nearD = nearD;
    ship.target = best; a.any = any; a.sub = sub; a.subD = subD; a.threat = threat; a.threatD = threatD;
    a.cn = cn; if (cn) { a.cx = cx / cn; a.cz = cz / cn; }
    // Per-mount gun targets: the main battery takes the main target when it is in range, else the best-scoring
    // target in range (its own weights); secondaries take the closest small threat in their range.
    const ct = a.calTarget || (a.calTarget = {});
    for (let gi = 0; gi < st.guns.length; gi++) {
      const g = st.guns[gi], gw = GUN_W[g.cal] || (gi === 0 ? W : SEC_W);
      let t = null, bs = 0;
      if (best && gw[best.type] > 0 && WW.dist(ship.x, ship.z, best.x, best.z) <= g.range) t = best;
      else for (const c of cs) {
        const o = c.unit;
        if (!o || !o.alive || o.submerged || now - c.seenAt > FRESH || !(gw[o.type] > 0)) continue;
        const d = WW.dist(ship.x, ship.z, o.x, o.z);
        if (d > g.range) continue;
        const v = gw[o.type] * (gi === 0 && !GUN_W[g.cal] ? VALUE[o.type] : 1) / (1 + d / g.range);
        if (v > bs) { bs = v; t = o; }
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
        if (!WW.supply || WW.supply.shell(ship, ts.gun, d)) WW.combat.fireShell(ship, ts.t, tgt, ts.gun.cal); // main-battery ammunition (ship_supply.js)
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

  // ---- shared overrides, applied by the core after the role (a role can call them itself and set the flag) ----
  // Cripple withdrawal: below WW.fleetGroups.CRIP hp (not subs) a ship turns away from the nearest known enemy,
  // toward its own carrier / group when that is also away, at full speed, through the safest heading.
  // It keeps shooting (guns run after this) but no longer chases. Returns true when it took over the helm.
  function withdraw(ship) {
    const a = ship.ai, crip = WW.fleetGroups ? WW.fleetGroups.CRIP : 0.35;
    if (ship.type === 'submarine' || ship.hp >= crip * ship.maxHp) return false;
    let e = null, ed = 1e9;
    const cs = WW.intel ? WW.intel.enemyShips(ship.nation) : [], now = WW.time.now;
    for (const c of cs) {
      if (!c.unit || !c.unit.alive || c.unit.submerged || now - c.seenAt > 45) continue;
      const d = WW.dist(ship.x, ship.z, c.x, c.z);
      if (d < ed) { ed = d; e = c; }
    }
    const o = WW.fleetCmd && WW.fleetCmd.order(ship);
    let want;
    if (e) {
      want = Math.atan2(ship.z - e.z, ship.x - e.x);
      const hx = a.cv && a.cv !== ship && a.cv.alive ? a.cv.x : o ? o.sx : null, hz = a.cv && a.cv !== ship && a.cv.alive ? a.cv.z : o ? o.sz : null;
      if (hx !== null && WW.dist(ship.x, ship.z, hx, hz) > 40) {
        const home = Math.atan2(hz - ship.z, hx - ship.x);
        if (Math.abs(WW.angleDiff(want, home)) < 1.1) want = blend(want, ship, hx, hz, 0.8);
      }
    } else if (o) want = Math.atan2(o.sz - ship.z, o.sx - ship.x);
    else return false;
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0, { k: 3 }) : want;
    ship.throttle = 1;
    a.withdrawing = true;
    return true;
  }
  // Torpedo combing: a ship that has seen (WW.intel.torpedoes) a torpedo track heading for it turns parallel to
  // it (bow or stern on, whichever needs less rudder) after a reaction delay by type. Returns true while combing.
  const REACT = { pt: 0.4, destroyer: 0.7, submarine: 1, cruiser: 1.2, carrier: 1.8, battleship: 2 };
  function comb(ship) {
    const a = ship.ai, now = WW.time.now;
    if (a.combUntil > now) { ship.desiredHeading = a.combH; return true; }
    if (!WW.intel || !WW.intel.torpedoes || ship.submerged) return false;
    const T = WW.intel.torpedoes(ship.nation), L = ship.stats.length * 0.5 + 6, rt = REACT[ship.type] || 1;
    for (let i = 0; i < T.length; i++) {
      const e = T[i];
      if (now - e.firstSeenAt < rt) continue;
      const dt = now - e.seenAt, c = Math.cos(e.h), s = Math.sin(e.h);
      const px = e.x + c * e.speed * dt, pz = e.z + s * e.speed * dt, rx = ship.x - px, rz = ship.z - pz;
      const along = rx * c + rz * s, perp = Math.abs(-rx * s + rz * c);
      if (along < -2 || along > 70 || perp > L + along * 0.12) continue; // passed, too far, or missing wide
      if (WW.dstat && e.proj) { WW.dstat('combN', e.proj.nation); WW.dstat('combD', e.proj.nation, along); } // metric: by the torpedo's nation
      a.combH = Math.abs(WW.angleDiff(ship.heading, e.h)) < PI / 2 ? e.h : e.h + PI;
      a.combUntil = now + along / Math.max(1, e.speed) + 1.5;
      ship.desiredHeading = a.combH;
      return true;
    }
    return false;
  }

  const roles = {}; // type -> fn(ship, dt), filled by the role files; 'surface' is the default
  WW.shipAI = {
    roles,
    h: { bearing, seen, lead, fireSpread, blend, idle, withdraw, comb, score, riskOf, unreachable }, // shared helpers for the role files
    ROLE_W, VALUE, retarget,
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
      // Test the heading the ship wants (not the one it points), and not while it is still swinging toward it:
      // flipping every few s while a slow battleship turns left it circling in place.
      a.blockChkT = (a.blockChkT || 0) - dt;
      if (a.blockChkT <= 0) {
        a.blockChkT = 0.5;
        const turning = Math.abs(WW.angleDiff(ship.heading, ship.navHeading)) > 0.5;
        if (!turning && ship.clearance(ship.desiredHeading) < ship.lookDist * 0.4) { a.blockedT += 0.5; if (a.blockedT > 6) { a.blockedT = 0; a.orbitDir *= -1; } }
        else if (!turning) a.blockedT = 0;
      }
      const role = roles[ship.type] || roles.surface;
      a.withdrawing = false;
      if (role) role(ship, dt);
      const eg = WW.endgameAI && WW.endgameAI.steer(ship, dt); // broken side home / rescue (ai_endgame.js)
      if (!eg && !a.ownWithdraw) withdraw(ship); // a role that handles its own cripples sets ship.ai.ownWithdraw
      if (!a.ownComb) comb(ship);
      if (a.turrets.length) guns(ship, dt);
    },
    pickStrikeTarget: () => null // ai_carrier.js replaces it
  };
})();
