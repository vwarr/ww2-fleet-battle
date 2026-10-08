// ai_carrier.js — carrier behaviour: movement (stay out of enemy gun range, keep near the fleet, into the wind
// for flight ops via air_deck.js) and air operations (CAP queue, strike planning, launches).
// Registers WW.shipAI.roles.carrier and WW.shipAI.pickStrikeTarget (used by aircraft.js / air_strikes.js).
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const STRIKE_PRIO = { carrier: 250, battleship: 180, cruiser: 80, destroyer: 20, submarine: 0, pt: -20 };
  const H = WW.shipAI.h, bearing = H.bearing, blend = H.blend;

  // Strikes go only after what the side knows: a fresh contact, or one seen in the last STRIKE_AGE s (at a penalty).
  // ship may be a bare { x, z, nation } (air_strikes.js wave guide) or a Plane.
  const STRIKE_AGE = 45;
  function pickStrikeTarget(ship) {
    if (!WW.intel) return null;
    let best = null, bs = 1e9;
    const now = WW.time.now;
    for (const c of WW.intel.enemyShips(ship.nation, { fresh: STRIKE_AGE })) {
      const o = c.unit;
      if (!o || !o.alive || o.submerged) continue;
      const s = WW.dist(ship.x, ship.z, c.x, c.z) - (STRIKE_PRIO[o.type] || 0) + (now - c.seenAt) * 2;
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
    if (WW.airDeck) WW.airDeck.steer(ship, late); // into the wind while launching / recovering (air_deck.js)
    // Any ship closing inside ~90 units: turn away from it (separation in ships.js enforces the 70-unit space).
    const n = a.near;
    if (n && n.alive && (!late || n.nation === ship.nation) && WW.dist(ship.x, ship.z, n.x, n.z) < 90) {
      ship.desiredHeading = blend(ship.desiredHeading, ship, 2 * ship.x - n.x, 2 * ship.z - n.z, 0.8);
      ship.throttle = Math.max(ship.throttle, 0.8);
    }
    if (!WW.air || !ship.hangar) return;
    airOps(ship, dt);
  }

  // CAP queue, strike waves and launches.
  function airOps(ship, dt) {
    const a = ship.ai, hg = ship.hangar;
    // CAP when enemy planes come near.
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 3;
      let near = 0, cap = 0;
      if (WW.intel) for (const c of WW.intel.enemyPlanes(ship.nation)) if (WW.dist(ship.x, ship.z, c.x, c.z) < 200) near++; // detected raiders (strikes come from far off: scramble early)
      for (const p of WW.world.planes) if (p.alive && p.carrier === ship && p.kind === 'fighter' && !p.target) cap++;
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
        if (WW.strike) WW.strike.newWave(ship, tgt, a.queue); // air_strikes.js: form up before departing
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

  WW.shipAI.roles.carrier = carrierAI;
  WW.shipAI.pickStrikeTarget = pickStrikeTarget;
})();
