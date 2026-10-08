// ai_surface.js — surface combatant behaviour (battleship, cruiser, destroyer): formation stations from the fleet
// commander (WW.fleetCmd), stand-off orbit at the doctrine's preferred range, torpedo spreads, and the destroyer's
// sub hunt with depth charges (that block belongs to the depth-charge work).
// Registers WW.shipAI.roles.surface (the default role). Helpers: WW.shipAI.h (ships_ai.js).
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const SONAR = 65; // destroyer sub-detection radius (intel.js R.SONAR)
  const SUB_HUNT = 100; // a known sub inside its own torpedo reach (range 120 x 0.8) is hunted before surface targets
  const H = WW.shipAI.h, bearing = H.bearing, seen = H.seen, lead = H.lead, blend = H.blend;

  // Depth-charge attack run. Steer for where the sub will be when the charges go off; inside DC_LOCK sonar
  // loses the contact under the bow (as ASDIC did), so the run is locked on a fix with a bearing/range error
  // that grows with the sub's speed. Over the aim point the DD lays a stern stick of DC_STICK charges DC_GAP s
  // apart, with a K-gun pair thrown abeam on the middle one, then runs out and comes round to re-attack.
  const DC_STICK = 5, DC_GAP = 0.35, DC_FUSE = 2.05, DC_LOCK = 20, DC_KGUN = 6, DC_RELOAD = 7;
  function dcApproach(ship, a, s, fresh) {
    const v = Math.max(ship.speed, 3), L = ship.stats.length * 0.5;
    ship.throttle = 1;
    if (a.dcLock && a.dcReload <= 0) { // locked run: hold course for the fix
      const ax = a.dcAx - ship.x, az = a.dcAz - ship.z, along = ax * Math.cos(ship.heading) + az * Math.sin(ship.heading);
      ship.desiredHeading = Math.atan2(az, ax);
      // start the stick so its middle charge rolls off the stern over the aim point
      if (along + L <= (DC_STICK - 1) * 0.5 * DC_GAP * v) { a.dcLeft = DC_STICK; a.dcGap = 0; a.dcH = ship.heading; a.dcLock = false; }
      else if (along < -L || Math.hypot(ax, az) > DC_LOCK * 2) a.dcLock = false; // overran or lost it: new approach
      return;
    }
    // Aim at the sub's position one fuse after the DD's stern gets there.
    let px = s.x, pz = s.z;
    for (let i = 0; i < 2; i++) {
      const tt = Math.max(0, WW.dist(ship.x, ship.z, px, pz) - L) / v + DC_FUSE;
      px = s.x + Math.cos(s.heading) * s.speed * tt; pz = s.z + Math.sin(s.heading) * s.speed * tt;
    }
    ship.desiredHeading = Math.atan2(pz - ship.z, px - ship.x);
    if (fresh && a.dcReload <= 0 && WW.dist(ship.x, ship.z, px, pz) < DC_LOCK &&
        Math.abs(WW.angleDiff(ship.heading, ship.desiredHeading)) < 0.5) {
      const e = 1.5 + 0.8 * s.speed;
      a.dcAx = px + WW.randRange(-e, e); a.dcAz = pz + WW.randRange(-e, e); a.dcLock = true; a.dcSub = s;
    }
  }
  function dcPattern(ship, a, dt) {
    ship.desiredHeading = a.dcH; ship.throttle = 1;
    a.dcGap -= dt;
    if (a.dcGap > 0) return;
    const L = ship.stats.length * 0.5, q = ship.toWorld(-L, 0);
    WW.combat.dropDepthCharge(ship, q[0], q[1]);
    if (a.dcLeft === Math.ceil(DC_STICK / 2)) { // K-guns: one charge thrown to each beam
      for (const side of [-1, 1]) { const k = ship.toWorld(-L * 0.4, side * DC_KGUN); WW.combat.dropDepthCharge(ship, k[0], k[1]); }
    }
    a.dcGap = DC_GAP;
    if (--a.dcLeft <= 0) a.dcReload = DC_RELOAD;
  }

  function surfaceAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = ship.target;
    // Destroyers hunt a sub contact inside SUB_HUNT, or at any range when no surface target is left.
    // A lost sub: run to its last-known position (datum) and give it up there if sonar finds nothing.
    // A sub already under attack stays the quarry while sonar holds it (re-attack, don't switch contacts).
    const ds = a.dcSub && a.dcSub.alive && !a.dcSub.sinking && seen(ship, a.dcSub) &&
      WW.dist(ship.x, ship.z, a.dcSub.x, a.dcSub.z) < SONAR ? a.dcSub : (a.dcSub = null);
    if (st.depthCharges && (a.dcLeft > 0 || ds || (a.sub && a.sub.alive && a.subC && (a.subD < SUB_HUNT || !t || t.type === 'submarine')))) {
      a.dcReload -= dt;
      if (a.dcLeft > 0) { dcPattern(ship, a, dt); return; }
      const fresh = !!ds || seen(ship, a.sub), s = ds || (fresh ? a.sub : a.subC);
      if (!fresh && WW.dist(ship.x, ship.z, s.x, s.z) < 10) { a.datumDone = a.subC.seenAt; a.sub = a.subC = null; a.retargetT = 0; return; }
      dcApproach(ship, a, s, fresh);
      return;
    }
    const o = WW.fleetCmd ? WW.fleetCmd.order(ship) : null, B = o ? WW.fleetCmd.side(ship.nation) : null;
    if (!t) { if (o) followStation(ship, o, B); else H.idle(ship); return; }
    if (o && H.unreachable(ship, t)) followStation(ship, o, B); // never run down a target that outruns us (a carrier)
    else engage(ship, t, o, B);
    torpedoes(ship, t, B);
  }

  // ---- seams for the battle-line / destroyer role work ----
  // No target: keep the commander's formation station (group guide + offset along the axis of advance),
  // through the safest heading for the type's risk tolerance. Close to the station: steam along the axis.
  function followStation(ship, o, B) {
    const d = WW.dist(ship.x, ship.z, o.sx, o.sz), risk = B.doctrine.risk[ship.type] || 0.5;
    let want;
    if (d > 20) { want = Math.atan2(o.sz - ship.z, o.sx - ship.x); ship.throttle = WW.clamp(d / 60, 0.55, 1); }
    else { want = B.axis.h; ship.throttle = 0.55; }
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, risk) : want;
  }
  // Preferred gun range: doctrine rangeFrac of the main battery (destroyers: inside torpedo range); pressing
  // closes in by the doctrine's close-quarters style, a withdrawing side opens out.
  function prefRange(ship, B) {
    const st = ship.stats, main = st.guns[0];
    let pref = main ? main.range * (B ? B.doctrine.rangeFrac : 0.8) : 60;
    if (st.torpedoes && ship.type === 'destroyer') pref = Math.min(pref, st.torpedoes.range * 0.6);
    if (B && B.posture === 'press') pref *= 0.55 + 0.15 * (1 - B.doctrine.night); // press for a decision (IJN closer)
    else if (B && B.posture === 'withdraw') pref *= 1.15;
    return pref;
  }
  // Gun fight: orbit the target at the preferred range (close in, open out, or circle), loosely tied to the
  // formation station (escorts more tightly), then the safest heading for the type's risk tolerance.
  // Next (role agents): crossing the T / broadside angling, focus-fire use (WW.fleetCmd.focusFor), flotilla attacks.
  function engage(ship, t, o, B) {
    const a = ship.ai, d = WW.dist(ship.x, ship.z, t.x, t.z), b = bearing(ship, t), pref = prefRange(ship, B);
    let h;
    if (d > pref * 1.2) { h = b; ship.throttle = 1; }
    else if (d < pref * 0.65) { h = b + PI + a.orbitDir * 0.4; ship.throttle = 1; }
    else { h = b + a.orbitDir * (PI / 2 - WW.clamp((d - pref) / pref, -0.5, 0.5) * 1.2); ship.throttle = 0.8; }
    if (o) {
      const ds = WW.dist(ship.x, ship.z, o.sx, o.sz), esc = o.role === 'escort';
      if (ds > (esc ? 60 : 110)) h = blend(h, ship, o.sx, o.sz, esc ? 0.6 : 0.3);
    } else if (a.cn && WW.dist(ship.x, ship.z, a.cx, a.cz) > 40) h = blend(h, ship, a.cx, a.cz, 0.35);
    ship.desiredHeading = WW.threat && B ? WW.threat.bestHeading(ship, h, B.doctrine.risk[ship.type] || 0.5, { k: 1 }) : h;
  }
  // Torpedoes: launch inside (0.6 + 0.3 x doctrine torpedo emphasis) of torpedo range on a current detection
  // (fireSpread holds fire when an ally is in the fan).
  function torpedoes(ship, t, B) {
    const st = ship.stats, a = ship.ai;
    if (!st.torpedoes || a.torpReload > 0 || t.submerged) return;
    const d = WW.dist(ship.x, ship.z, t.x, t.z), k = B ? 0.6 + 0.3 * B.doctrine.torpedo : 0.8;
    if (d < st.torpedoes.range * k && d > 12 && seen(ship, t)) H.fireSpread(ship, t);
  }

  WW.shipAI.roles.surface = surfaceAI;
  WW.shipAI.surface = { followStation, prefRange, engage, torpedoes }; // seams for the role agents
})();
