// ai_endgame.js - WW.endgameAI: ship behaviour at a battle's end (sim code). Load after ai_pt.js.
// ships_ai.js calls steer(ship, dt) after the role; when it returns true it has the helm (the core's cripple
// withdrawal is skipped; torpedo combing and the guns still run).
//  - Broken side (fleet_cmd posture 'withdraw' with brokenAt): every ship but a sub heads for its home map edge and
//    leaves the map there (ship.escapeEdge, endgame.js). The doctrine decides how:
//      IJN (doctrine.rescue false): best speed home, each ship on its own; cripples are abandoned (endgame.js may
//        scuttle them);
//      USN (doctrine.rescue true): destroyers pick up survivors first (ship.rescue), then each fit destroyer
//        escorts a cripple home at the cripple's speed, and a free destroyer holds short of the edge until the
//        survivors are aboard (the side leaves the map last with its rescuers and escorts).
//    A carrier leaves at once (its planes still up go with it, endgame.js).
//  - Any posture, USN: a destroyer with a rescue task steams to the survivors and slows alongside (endgame.js).
//  - Pursuing side (posture 'pursue'): ai_surface.js reads pursueContact() and fairGame() (below).
window.WW = window.WW || {};
(function () {
  const HOLD = 70;          // a USN ship waits this far off its home edge while survivors are still being picked up
  const ESC_R = 26;         // escort station off the cripple, toward the enemy
  const PURSUE_AGE = 120;   // pursuit: last-known contacts this old are run down
  const ESCORTED_R = 150;   // a carrier with no fit known gun ship this close is unescorted
  const crip = () => (WW.fleetGroups ? WW.fleetGroups.CRIP : 0.35);
  const vmax = s => (WW.shipSpeed ? WW.shipSpeed.vmax(s) : s.stats.speed);
  const isCripple = s => s.hp < crip() * s.maxHp || s.speedK < 0.75;

  function steer(ship, dt) {
    if (ship.type === 'submarine' || !WW.fleetCmd || !WW.endgame) return false;
    const B = WW.fleetCmd.side(ship.nation), d = B && B.doctrine;
    if (!B) return false;
    if (WW.endgame.broken(ship.nation) && !(WW.game && WW.game.noRetire)) return retreat(ship, B, d); // noRetire: tests, no leaving
    if (WW.charge && WW.charge.steer(ship, dt)) { ship.escapeEdge = 0; return true; } // escorts charging to save a carrier (ai_charge.js)
    ship.escapeEdge = 0; // (a broken side that turns to pursue a worse-broken enemy, fleet_cmd.js)
    if (ship.rescue) return rescueSteer(ship, B);
    return false;
  }

  // ---- broken: home and off the map ----
  function retreat(ship, B, d) {
    ship.escapeEdge = ship.nation === 'USN' ? -1 : 1;
    ship.throttle = 1;
    if (d.rescue) {
      if (ship.rescue) return rescueSteer(ship, B);                       // survivors first
      if (ship.type === 'destroyer' && !isCripple(ship)) { const c = escortFor(ship); if (c) return escort(ship, c, B); }
      const hx = WW.endgame.homeX(ship.nation); // a fit destroyer waits off the edge for survivors still to be picked up
      if (ship.type === 'destroyer' && WW.endgame.pending(ship.nation) && Math.abs(ship.x - hx) < HOLD + 40) return holdOff(ship, hx);
    }
    // a surface cripple keeps its own way home (ai_surface.js crippleHome: away from every gun in reach) until close
    if (ship.ai.withdrawing && Math.abs(ship.x - WW.endgame.homeX(ship.nation)) > 90) return true;
    ship.desiredHeading = homeHeading(ship);
    return true;
  }
  // Straight for the home edge at about its own z, away from known guns (risk 0) until close to the edge.
  function homeHeading(ship) {
    const H = WW.cfg.MAP_H, hx = WW.endgame.homeX(ship.nation), tz = WW.clamp(ship.z, 70, H - 70);
    const want = Math.atan2((tz - ship.z) * 0.5, hx - ship.x);
    if (Math.abs(ship.x - hx) < 90 || !WW.threat) return want;
    return WW.threat.bestHeading(ship, want, 0, { k: 3, edge: 25 });
  }
  // Waiting for survivors: a slow beat up and down HOLD off the edge (not over it).
  function holdOff(ship, hx) {
    ship.escapeEdge = 0;
    const px = hx + (hx ? -HOLD : HOLD), pz = WW.clamp(ship.z, 90, WW.cfg.MAP_H - 90), dd = WW.dist(ship.x, ship.z, px, pz);
    if (dd > 20) { ship.desiredHeading = Math.atan2(pz - ship.z, px - ship.x); ship.throttle = 0.6; }
    else { ship.desiredHeading = ship.heading + 0.3 * (ship.ai.orbitDir || 1); ship.throttle = 0.3; }
    return true;
  }
  // The cripple this destroyer escorts: its own still-valid charge, else the nearest unescorted cripple.
  function escortFor(dd) {
    const c0 = dd.ai.escortOf;
    if (c0 && c0.alive && !c0.sinking && !c0.escaped && c0.escortBy === dd) return c0;
    dd.ai.escortOf = null;
    let best = null, bd = 1e18;
    for (const s of WW.world.ships) {
      if (s === dd || !s.alive || s.sinking || s.nation !== dd.nation || s.type === 'submarine' || s.type === 'pt' || !isCripple(s)) continue;
      const e = s.escortBy; if (e && e !== dd && e.alive && !e.escaped && e.ai.escortOf === s) continue;
      const k = WW.dist2(dd.x, dd.z, s.x, s.z); if (k < bd) { bd = k; best = s; }
    }
    if (best) { best.escortBy = dd; dd.ai.escortOf = best; }
    return best;
  }
  // Escort: a station ESC_R off the cripple on the side of the nearest known enemy, at the cripple's speed.
  function escort(dd, c, B) {
    let ex = 0, ez = 0, bd = 1e18;
    if (WW.intel) for (const k of WW.intel.enemyShips(dd.nation)) {
      const u = k.unit; if (!u || !u.alive || u.submerged || WW.time.now - k.seenAt > 60) continue;
      const q = WW.dist2(c.x, c.z, k.x, k.z); if (q < bd) { bd = q; ex = k.x - c.x; ez = k.z - c.z; }
    }
    if (bd === 1e18) { ex = dd.nation === 'USN' ? 1 : -1; ez = 0; }                     // astern, toward the enemy's side
    const el = Math.hypot(ex, ez) || 1, px = c.x + ex / el * ESC_R, pz = c.z + ez / el * ESC_R, d = WW.dist(dd.x, dd.z, px, pz);
    if (d > 18) { dd.desiredHeading = Math.atan2(pz - dd.z, px - dd.x); dd.throttle = 1; }
    else { dd.desiredHeading = c.heading; dd.throttle = WW.clamp(c.speed / dd.stats.speed + 0.03, 0.15, 1); }
    if (c.escapeEdge) dd.escapeEdge = c.escapeEdge;
    return true;
  }

  // ---- survivors: to the sinking position, slow alongside (endgame.js counts the pickup) ----
  function rescueSteer(ship, B) {
    const t = ship.rescue, d = WW.dist(ship.x, ship.z, t.x, t.z), want = Math.atan2(t.z - ship.z, t.x - ship.x);
    ship.escapeEdge = 0;
    if (d > t.r + 35) {
      ship.throttle = 1;
      ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, B.doctrine.risk.destroyer || 0.45) : want;
    } else { ship.desiredHeading = want; ship.throttle = d > t.r + 12 ? 0.45 : d > t.r - 2 ? 0.2 : 0.03; }
    return true;
  }

  // ---- pursuit seams (ai_surface.js) ----
  // A carrier that may be run down: crippled (hp or speed) or with no fit known gun ship of its own within
  // ESCORTED_R. Only for a side that pursues.
  function fairGame(ship, cv, B) {
    if (!B || B.posture !== 'pursue' || !cv || cv.type !== 'carrier') return false;
    if (isCripple(cv) || vmax(cv) < 0.95 * vmax(ship)) return true;
    if (!WW.intel) return false;
    const now = WW.time.now, k = WW.intel.known(ship.nation, cv); if (!k) return false;
    for (const c of WW.intel.enemyShips(ship.nation)) {
      const u = c.unit;
      if (!u || u === cv || !u.alive || u.submerged || !u.stats.guns.length || u.type === 'carrier' || u.type === 'pt' || now - c.seenAt > 60 || u.hp < crip() * u.maxHp) continue;
      if (WW.dist2(c.x, c.z, k.x, k.z) < ESCORTED_R * ESCORTED_R) return false;
    }
    return true;
  }
  // Pursuing with nothing in sight: the nearest last-known enemy (up to PURSUE_AGE s, moved along its course for up
  // to 40 s), carriers included when fair game; no lair or home-waters limits. Cached for 1 s per ship.
  function pursueContact(ship, B) {
    const a = ship.ai, now = WW.time.now;
    if (a.puT > now) return a.pu && a.pu.unit && a.pu.unit.alive ? a.pu : null;
    a.puT = now + 1; a.pu = null;
    if (!WW.intel) return null;
    let bd = 1e18;
    for (const c of WW.intel.enemyShips(ship.nation)) {
      const u = c.unit;
      if (!u || !u.alive || u.submerged || u.type === 'submarine' || now - c.seenAt > PURSUE_AGE) continue;
      if (ship.type === 'battleship' && u.type === 'pt') continue;
      if (u.type === 'carrier' && !fairGame(ship, u, B)) continue;
      const d = WW.dist2(ship.x, ship.z, c.x, c.z) * (isCripple(u) ? 0.6 : 1);   // cripples first
      if (d < bd) { bd = d; a.pu = c; }
    }
    return a.pu;
  }

  WW.endgameAI = { steer, fairGame, pursueContact, isCripple, PURSUE_AGE };
})();
