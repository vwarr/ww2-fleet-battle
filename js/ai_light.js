// ai_light.js — light craft behaviour: submarines (dive / surface cycle, torpedo attack, evasion after firing)
// and PT boats (torpedo dash in, jinking run out). Registers WW.shipAI.roles.submarine / .pt.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const SUB_MAX_DIVE = 45, SUB_SURFACE = 25; // a sub must surface after this long submerged, for this long
  const H = WW.shipAI.h, bearing = H.bearing, seen = H.seen, lead = H.lead;

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
    if (!t) { H.idle(ship); ship.throttle = 0.6; return; }
    const d = WW.dist(ship.x, ship.z, t.x, t.z), p = lead(ship, t, WW.TORPEDO.speed);
    const lb = Math.atan2(p.z - ship.z, p.x - ship.x);
    a.evadeT -= dt;
    if (a.evadeT > 0) { ship.desiredHeading = bearing(ship, t) + PI + a.orbitDir * 0.6; ship.throttle = 1; }
    else if (d > 75) { ship.desiredHeading = lb; ship.throttle = 1; }
    else { ship.desiredHeading = lb; ship.throttle = 0.5; }
    if (a.torpReload <= 0 && d < st.torpedoes.range * 0.8 && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.3 && seen(ship, t)) {
      H.fireSpread(ship, t); a.evadeT = 10;
    }
  }

  function ptAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = ship.target;
    if (!t) { H.idle(ship); return; }
    const d = WW.dist(ship.x, ship.z, t.x, t.z), b = bearing(ship, t);
    ship.throttle = 1;
    a.ptT -= dt;
    if (a.ptState === 'in') {
      const p = lead(ship, t, WW.TORPEDO.speed), lb = Math.atan2(p.z - ship.z, p.x - ship.x);
      ship.desiredHeading = lb;
      if (a.torpReload <= 0 && d < st.torpedoes.range * 0.7 && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.35 && seen(ship, t)) {
        H.fireSpread(ship, t); a.ptState = 'out'; a.ptT = 12;
      } else if (a.torpReload > 0 && d < 80) { a.ptState = 'out'; a.ptT = 8; }
    } else {
      // Dash out with a jink, then hold off until torpedoes are nearly reloaded.
      const jink = Math.sin(WW.time.now * 1.7 + ship.id) * 0.5;
      ship.desiredHeading = d < 100 ? b + PI + jink : b + a.orbitDir * PI / 2;
      if (a.ptT <= 0 && a.torpReload <= 3) a.ptState = 'in';
    }
  }

  WW.shipAI.roles.submarine = subAI;
  WW.shipAI.roles.pt = ptAI;
})();
