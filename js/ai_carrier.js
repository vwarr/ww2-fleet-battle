// ai_carrier.js — carrier behaviour: movement (never charges: commander station behind the screen, flee known gun
// ships, zero danger via WW.threat, into the wind for flight ops via air_deck.js) and air operations (CAP queue, strike planning, launches).
// Registers WW.shipAI.roles.carrier and WW.shipAI.pickStrikeTarget (used by aircraft.js / air_strikes.js).
window.WW = window.WW || {};
(function () {
  const STRIKE_PRIO = { carrier: 250, battleship: 180, cruiser: 80, destroyer: 20, submarine: 0, pt: -20 };
  const H = WW.shipAI.h, blend = H.blend;

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

  // Movement: the carrier never charges. It keeps its commander station (behind the main body, ring of escorts
  // around it), runs from any known gun ship inside 1.5x that ship's gun reach (+ margin), turns into the wind for
  // flight ops only while no danger is near, and every heading goes through WW.threat.bestHeading with risk 0
  // (no known danger, away from map edges). It handles its own cripple withdrawal (it always withdraws).
  const FLEE_K = 1.5, FLEE_PAD = 50, FLEE_MIN = 210, FLEE_AGE = 90, WIND_SAFE = 320, CONE_PAD = 150, CONE = 1.4, EDGE_BAND = 160; // CONE: half-angle (80 deg) kept clear around a threat's bearing // a destroyer (fast) is run from as soon as it is seen
  // Summed repulsion from every known gun ship inside its flee radius (weight (1 - d / radius)^2): the heading
  // away from all of them, or null when none is close.
  const cone = []; // bearings of known gun ships the carrier must not head toward (filled by fleeFrom)
  function fleeFrom(ship) {
    cone.length = 0;
    if (!WW.intel) return null;
    let x = 0, z = 0, n = 0;
    for (const c of WW.intel.enemyShips(ship.nation)) {
      const o = c.unit;
      if (!o || !o.alive || o.submerged || !o.stats.guns.length || o.type === 'carrier' || WW.time.now - c.seenAt > FLEE_AGE) continue;
      const age = Math.min(20, WW.time.now - c.seenAt), cx = c.x + Math.cos(c.heading) * c.speed * age, cz = c.z + Math.sin(c.heading) * c.speed * age; // where it may be now
      const r = o.stats.guns[0].range, d = WW.dist(ship.x, ship.z, cx, cz), k = d / (Math.max(FLEE_MIN, r * FLEE_K + FLEE_PAD) * (WW.nightOps ? WW.nightOps.cvFleeK() : 1)); // a wider berth in the dark
      if (d < WIND_SAFE) ship.ai.cvWary = WW.time.now;
      if (d < (ship.ai.thrD || 1e9) || ship.ai.thrT !== WW.time.now) { ship.ai.thrD = d; ship.ai.thrT = WW.time.now; ship.ai.thrB = Math.atan2(cz - ship.z, cx - ship.x); } // nearest known gun ship's bearing
      if (d < r * FLEE_K + CONE_PAD) cone.push(Math.atan2(cz - ship.z, cx - ship.x)); // never steer toward it (see carrierAI)
      if (k >= 1 || d < 1) continue;
      const w = (1 - k) * (1 - k) + 0.05;
      x += (ship.x - cx) / d * w; z += (ship.z - cz) / d * w; n++;
    }
    return n ? Math.atan2(z, x) : null;
  }
  function carrierAI(ship, dt) {
    const a = ship.ai, o = WW.fleetCmd ? WW.fleetCmd.order(ship) : null, B = o ? WW.fleetCmd.side(ship.nation) : null;
    a.ownWithdraw = true;
    const fl = fleeFrom(ship);
    let want, calm = false;
    if (fl !== null) { want = fl; ship.throttle = 1; } // run from every known gun ship close by
    // Pinned on a map edge (a night pursuit runs carriers into their home corner): run along the edge, the way that
    // keeps the nearest known gun ship farthest astern, rather than let the edge turn the bow toward it.
    if (fl !== null && WW.threat && a.thrT === WW.time.now && WW.threat.edge(ship.x, ship.z) > 0) {
      let bs = -1e9;
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const h = fl + off, e = WW.threat.edge(ship.x + Math.cos(h) * 60, ship.z + Math.sin(h) * 60), sc = -Math.cos(WW.angleDiff(h, a.thrB)) - 2 * e;
        if (sc > bs) { bs = sc; want = h; }
      }
    }
    else if (o) {
      const d = WW.dist(ship.x, ship.z, o.sx, o.sz);
      if (d > 30) { want = Math.atan2(o.sz - ship.z, o.sx - ship.x) + (B && B.zig || 0); ship.throttle = WW.clamp(d / 80, 0.5, 1); } // zigzag on passage (fleet_formation.js)
      else { want = ship.heading + 0.25 * a.orbitDir; ship.throttle = 0.45; calm = true; }
    } else if (a.cn && WW.dist(ship.x, ship.z, a.cx, a.cz) > 45) {
      want = Math.atan2(a.cz - ship.z, a.cx - ship.x); ship.throttle = 0.7;
    } else { want = ship.heading + 0.25 * a.orbitDir; ship.throttle = 0.45; calm = true; }
    ship.desiredHeading = want;
    // Hunted (a known gun ship close), the carrier makes for the nearest rain squall: cover from eyes and planes (weather.js)
    if (WW.weather && (fl !== null || WW.time.now - (a.cvWary || -1e9) < 10)) {
      const sh = WW.weather.shelter(ship.x, ship.z, 220, 25), bs = sh ? Math.atan2(sh.z - ship.z, sh.x - ship.x) : 0;
      let ok = !!sh && (fl === null || Math.abs(WW.angleDiff(fl, bs)) < 1.2);          // only a squall that lies away from the threat
      for (let i = 0; ok && i < cone.length; i++) if (Math.abs(WW.angleDiff(cone[i], bs)) < CONE) ok = false;
      if (ok && WW.dist(ship.x, ship.z, sh.x, sh.z) > 20) { ship.desiredHeading = blend(ship.desiredHeading, ship, sh.x, sh.z, 0.5); WW.weather.stats.shelter = (WW.weather.stats.shelter || 0) + dt; }
    }
    const here = WW.threat ? WW.threat.danger(ship.nation, ship.x, ship.z) : 0;
    // Into the wind while launching / recovering (air_deck.js), only with no danger near, on (or near) station and
    // clear of the map edges (a long run downwind of the station otherwise ends pinned on the edge).
    const onStation = !o || WW.dist(ship.x, ship.z, o.sx, o.sz) < 120, wary = WW.time.now - (a.cvWary || -1e9) < 10; // a gun ship known within WIND_SAFE
    if (WW.airDeck && fl === null && !wary && here < 1 && onStation && !(WW.threat && WW.threat.edge(ship.x, ship.z) > 0)) WW.airDeck.steer(ship, false);
    // An enemy ship closing inside ~90 units: turn away from it (allies are spaced by ships.js SPACE).
    const n = a.near;
    if (n && n.alive && n.nation !== ship.nation && WW.dist(ship.x, ship.z, n.x, n.z) < 90) {
      ship.desiredHeading = blend(ship.desiredHeading, ship, 2 * ship.x - n.x, 2 * ship.z - n.z, 0.8);
      ship.throttle = Math.max(ship.throttle, 0.8);
    }
    // Helm hysteresis: a big change of course (> 0.3 rad) is taken at most every 2 s; small ones pass (a hard
    // swing back and forth slows the ship to 60%, and a slowed carrier can be run down).
    const now = WW.time.now;
    if (a.cvH === undefined || now - a.cvHT >= 2) { a.cvH = ship.desiredHeading; a.cvHT = now; }
    else if (Math.abs(WW.angleDiff(a.cvH, ship.desiredHeading)) >= 0.3) ship.desiredHeading = a.cvH;
    // Then the safest heading: no known danger (risk 0), a wide edge band (room to run), and never within CONE of
    // the bearing of a known gun ship inside 1.5x its reach + CONE_PAD (into the wind and station keeping included).
    if (WW.threat) ship.desiredHeading = WW.threat.bestHeading(ship, ship.desiredHeading, B ? B.doctrine.risk.carrier : 0,
      { look: 80, k: calm ? 2 : 4, edge: EDGE_BAND, avoid: cone, cone: CONE });
    ship.navAvoid = cone.slice(); ship.navAvoidT = now; // ships_nav planNav: no detour toward them either
    // Coming about while pointed at a known gun ship: back the engines (a slow carrier turning away is not charging).
    if (Math.abs(WW.angleDiff(ship.heading, ship.desiredHeading)) > 1.2)
      for (let i = 0; i < cone.length; i++) if (Math.abs(WW.angleDiff(cone[i], ship.heading)) < 1.4) { ship.throttle = 0.25; break; }
    // A reversal of course turns away from the nearest known gun ship: if the shortest turn would swing the bow
    // across its bearing, step the other way round (90 deg at a time) instead.
    const dd = WW.angleDiff(ship.heading, ship.desiredHeading);
    if (a.thrT === now && a.thrD < 400 && Math.abs(dd) > 2) {
      const tb = WW.angleDiff(ship.heading, a.thrB);
      if (Math.sign(tb) === Math.sign(dd) && Math.abs(tb) < Math.abs(dd)) ship.desiredHeading = ship.heading - Math.sign(dd) * 1.5;
    }
    if (!WW.air || !ship.hangar) return;
    airOps(ship, dt);
  }

  // CAP: how many fighters the carrier wants over itself. A standing CAP of one element (USN 2-plane section,
  // IJN 3-plane shotai), a full 4 when enemy planes are detected inside 250 (USN carrier radar reaches that far,
  // intel.js SEE_PLANE_NATION; IJN lookouts see ~170, so the IJN scrambles later). air_ops.js keeps it relieved on fuel.
  function capWanted(ship) {
    let near = 0;
    if (WW.intel) for (const c of WW.intel.enemyPlanes(ship.nation)) if (c.unit && c.unit.kind !== 'scout' && c.unit.kind !== 'flyingboat' && WW.dist(ship.x, ship.z, c.x, c.z) < 250) near++;
    const elem = ship.nation === 'IJN' ? 3 : 2;
    return near ? 4 : elem;
  }
  // The strike decision: the commander's order for this carrier (WW.fleetCmd.strikeOrder), else the local pick.
  function strikeTarget(ship) {
    if (WW.fleetCmd && WW.fleetCmd.side(ship.nation)) { const so = WW.fleetCmd.strikeOrder(ship); return so && !so.hold ? so.target : null; }
    return pickStrikeTarget(ship);
  }

  // CAP queue, strike waves and launches.
  function airOps(ship, dt) {
    if (WW.airOps && WW.airOps.plan) return WW.airOps.plan(ship, dt); // air boss (air_ops.js); below: the fallback
    const a = ship.ai, hg = ship.hangar;
    // CAP when enemy planes come near.
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 3;
      let cap = 0; for (const p of WW.world.planes) if (p.alive && p.carrier === ship && p.kind === 'fighter' && !p.target) cap++;
      if (cap < WW.shipAI.capWanted(ship) && hg.fighter > 0 && !a.queue.some(q => q.kind === 'fighter' && !q.target)) a.queue.unshift({ kind: 'fighter', target: null });
    }
    // Strike waves.
    a.strikeT -= dt;
    if (a.strikeT <= 0 && a.queue.length === 0) {
      const doc = WW.fleetCmd && WW.fleetCmd.doctrine(ship.nation);
      a.strikeT = WW.randRange(35, 55) * (doc ? 1.25 - 0.5 * doc.carrier : 1); // carrier emphasis: strike tempo
      const tgt = strikeTarget(ship);
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
  WW.shipAI.capWanted = capWanted;
  WW.shipAI.strikeTarget = strikeTarget;
})();
