// ai_surface.js — surface combatant behaviour (battleship, cruiser, destroyer): stand-off orbit at a preferred
// range, screen loosely around the carrier, torpedo spreads, and the destroyer's sub hunt with depth charges.
// Registers WW.shipAI.roles.surface (the default role). Helpers: WW.shipAI.h (ships_ai.js).
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const SONAR = 65; // destroyer sub-detection radius (intel.js R.SONAR)
  const H = WW.shipAI.h, bearing = H.bearing, seen = H.seen, lead = H.lead, blend = H.blend;

  function surfaceAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = ship.target;
    // Destroyers hunt subs on sonar (radius SONAR), or at any range when no surface target is left.
    // A lost sub: run to its last-known position (datum) and give it up there if sonar finds nothing.
    if (st.depthCharges && a.sub && a.sub.alive && a.subC && (a.subD < SONAR || !t || t.type === 'submarine')) {
      const fresh = seen(ship, a.sub), s = fresh ? a.sub : a.subC, p = lead(ship, s, st.speed);
      ship.desiredHeading = Math.atan2(p.z - ship.z, p.x - ship.x); ship.throttle = 1;
      a.dcReload -= dt;
      if (!fresh && WW.dist(ship.x, ship.z, s.x, s.z) < 10) { a.datumDone = a.subC.seenAt; a.sub = a.subC = null; a.retargetT = 0; return; }
      if (fresh && a.dcReload <= 0 && WW.dist(ship.x, ship.z, s.x, s.z) < 9) {
        const q = ship.toWorld(-st.length * 0.5, 0);
        WW.combat.dropDepthCharge(ship, q[0], q[1]);
        a.dcReload = 1.3;
      }
      return;
    }
    if (!t) { H.idle(ship); return; }
    const d = WW.dist(ship.x, ship.z, t.x, t.z), b = bearing(ship, t);
    const main = st.guns[0];
    let pref = main ? main.range * 0.7 : 60;
    if (st.torpedoes && ship.type === 'destroyer') pref = Math.min(pref, st.torpedoes.range * 0.6);
    if (WW.game && WW.game.roundTime > WW.cfg.ROUND_TIMEOUT * 0.6) pref *= 0.55; // late round: close in to finish it
    let h;
    if (d > pref * 1.2) { h = b; ship.throttle = 1; }
    else if (d < pref * 0.65) { h = b + PI + a.orbitDir * 0.4; ship.throttle = 1; }
    else { h = b + a.orbitDir * (PI / 2 - WW.clamp((d - pref) / pref, -0.5, 0.5) * 1.2); ship.throttle = 0.8; }
    const cv = a.cv && a.cv.alive ? a.cv : null;
    if (cv && ship.type !== 'pt') { // loose screen around the carrier: 50-70 units out, never bunched on it
      const dc = WW.dist(ship.x, ship.z, cv.x, cv.z);
      if (dc > 80) h = blend(h, ship, cv.x, cv.z, 0.3);
      else if (dc < 50) h = blend(h, ship, 2 * ship.x - cv.x, 2 * ship.z - cv.z, 0.6 * (50 - dc) / 50 + 0.2);
    } else if (a.cn && WW.dist(ship.x, ship.z, a.cx, a.cz) > 40) h = blend(h, ship, a.cx, a.cz, 0.35);
    ship.desiredHeading = h;
    // Torpedoes.
    if (st.torpedoes && a.torpReload <= 0 && !t.submerged && d < st.torpedoes.range * 0.8 && d > 12 && seen(ship, t)) H.fireSpread(ship, t);
  }

  WW.shipAI.roles.surface = surfaceAI;
})();
