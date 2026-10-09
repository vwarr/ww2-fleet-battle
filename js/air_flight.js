// air_flight.js — WW.airFlight: natural flight for carrier planes between the deck and the fight (aircraft.js keeps the
// flight model; this file decides how a plane uses it). Sim code, deterministic (no WW.rand).
// - Climb: a bomber climbs to its cruise height at a cruise climb (~0.7 x its best climb, 6-8 deg: the SBD's 1,200 ft/min
//   with a load), not the 7 u/s zoom it used for everything; fighters keep their full climb (a scramble). Descents
//   and the attack itself are unchanged (air_attack.js lets the torpedo planes down on the approach).
// - The way home (air_recovery.js goHome asks home()): economic cruise (pt.cruise, else 0.8 x top speed; fuel burns at
//   CRUISE_BURN), full speed when the fuel is short or a fighter is on it. With fuel to spare and more than SKIRT_R to
//   go, the course skirts the known AA and fighters (air_search.js homeHeading); short of fuel it flies straight.
// - Ditching: a plane whose deck is gone diverts to another carrier of the side; with none, or with the fuel for the
//   way home gone, or shot up below DITCH_HP and nearer a friendly destroyer than its deck, it flies to the nearest
//   friendly ship (a destroyer first) and puts down on the water beside it (endgame.js makes it a rescue task).
//   Before, a plane whose carrier sank ditched at once wherever it was.
// - A damaged plane (< 50% hp) going home gets a wingman: a friendly plane also going home within PAIR_R with the fuel
//   flies on its wing (plane.escortHome) until it is near its deck (or the deck it is ditching by).
// Events: airOrder 'escortHome', 'ditchBy' (plane, carrier, target ship). Stats: WW.airFlight.stats.
window.WW = window.WW || {};
(function () {
  const CLIMB_K = 0.7, CRUISE_BURN = 0.6, SKIRT_R = 220, DITCH_HP = 0.2, PAIR_R = 90, ESC_DONE = 140, MARGIN = 20;
  const ST = { diverts: 0, ditchBy: 0, fuelDitch: 0, dmgDitch: 0, noDeck: 0, escorts: 0, fullSpeed: 0 };
  const cruise = p => p.pt.cruise || p.pt.speed * 0.8;

  // the climb rate fly() uses to go up (aircraft.js)
  function climbV(p) {
    const c = p.pt.climb || 7;
    if (p.kind === 'fighter' || p.phase || p.state === 'attack' || p.y < 10) return Math.max(7, c);
    return c * CLIMB_K;
  }
  function deckOK(s, n) { return s && s.alive && !s.sinking && !s.isBase && s.type === 'carrier' && s.hangar && s.nation === n; }
  // the friendly ship to ditch beside: a destroyer first (within 1.5 x the nearest ship), else any surface ship
  function ditchShip(p) {
    let best = null, bd = 1e9, dd = null, ddd = 1e9;
    for (const s of WW.world.ships) {
      if (!s.alive || s.sinking || s.isBase || s.nation !== p.nation || s.type === 'submarine') continue;
      const d = WW.dist(p.x, p.z, s.x, s.z);
      if (d < bd) { bd = d; best = s; }
      if (s.type === 'destroyer' && d < ddd) { ddd = d; dd = s; }
    }
    return dd && ddd < bd * 1.5 + 40 ? dd : best;
  }
  function ditchBy(p, why) {
    const s = ditchShip(p);
    p.ditchTo = { ship: s, x: s ? s.x : p.x, z: s ? s.z : p.z, why };
    p.state = 'return'; p.foe = null; p.deckPh = null; p.wave = null; p.sk = null;
    if (p.ordnance) p.dropped();
    ST.ditchBy++; ST[why] = (ST[why] || 0) + 1;
    if (WW.emit) WW.emit('airOrder', { carrier: p.carrier, order: 'ditchBy', plane: p, target: s, why });
  }
  // aircraft.js update(): this plane's carrier is gone. true = handled (it flies on), false = the old instant ditch.
  function orphan(p) {
    if (p.ditchTo) return true;
    if (p.state === 'takeoff' || p.state === 'rollout' || p.deckPh === 'final' || p.deckPh === 'trap' || p.carrier.isBase) return false;
    let best = null, bd = 1e9;
    for (const s of WW.world.ships) if (deckOK(s, p.nation)) { const d = WW.dist(p.x, p.z, s.x, s.z); if (d < bd) { bd = d; best = s; } }
    if (best && bd / cruise(p) < Math.max(p.fuel, 40) + MARGIN) {
      p.carrier = best; p.diverted = (p.diverted || 0) + 1; ST.diverts++;
      if (p.state === 'landing') { p.state = 'return'; p.deckPh = null; }
      if (WW.emit) WW.emit('airOrder', { carrier: best, order: 'divert', plane: p, squadron: p.squadron || null });
      return true;
    }
    ditchBy(p, 'noDeck');
    return true;
  }
  // air_recovery.js goHome: fly toward (wx, wz) at the right speed and height for the way home
  function home(p, wx, wz, alt, dt) {
    const d = WW.dist(p.x, p.z, wx, wz), v = cruise(p), need = d / v;
    const chased = p.df && p.df.from && p.df.from.alive && WW.dist(p.df.from.x, p.df.from.z, p.x, p.z) < 60;
    const short = p.fuel < need + MARGIN;
    const spd = chased || short ? p.pt.speed : v * (p.hp < p.maxHp * 0.5 ? 0.9 : 1);
    if ((chased || short) && dt > 0) ST.fullSpeed += dt;
    p.fuel -= dt * (spd < p.pt.speed * 0.95 ? CRUISE_BURN : 1);
    if (d > SKIRT_R && !short && WW.search && WW.search.homeHeading) {
      const H = WW.search.homeHeading(p, wx, wz);
      p.fly(p.x + Math.cos(H.h) * 60, p.z + Math.sin(H.h) * 60, H.low ? Math.min(alt, 14) : alt, dt, spd);
      return;
    }
    p.fly(wx, wz, alt, dt, spd);
  }
  // the way home is out of fuel, or the plane is too shot up to trust a deck landing with a destroyer nearer
  function ditchCheck(p) {
    if (p.ditchTo || p.carrier.isBase || !deckOK(p.carrier, p.nation)) return;
    const dc = WW.dist(p.x, p.z, p.carrier.x, p.carrier.z);
    if (p.fuel <= 0 && dc > 60) { ditchBy(p, 'fuelDitch'); return; }
    if (p.hp < p.maxHp * DITCH_HP && dc > 150) {
      const s = ditchShip(p);
      if (s && s.type === 'destroyer' && WW.dist(p.x, p.z, s.x, s.z) < dc * 0.6) ditchBy(p, 'dmgDitch');
    }
  }
  function flyDitch(p, dt) {
    const D = p.ditchTo;
    if (D.ship && D.ship.alive && !D.ship.sinking) { D.x = D.ship.x; D.z = D.ship.z; }
    else if (D.ship) { const s = ditchShip(p); D.ship = s; if (s) { D.x = s.x; D.z = s.z; } }
    const off = D.ship ? 16 : 0, b = D.ship ? D.ship.heading + Math.PI / 2 : 0;   // abeam of the ship, clear of its bow
    const tx = D.x + Math.cos(b) * off, tz = D.z + Math.sin(b) * off, d = WW.dist(p.x, p.z, tx, tz);
    p.fly(tx, tz, d > 80 ? 18 : 5, dt, cruise(p) * (d > 80 ? 1 : 0.8));
    if (d < 12 || (p.t - (D.t0 === undefined ? (D.t0 = p.t) : D.t0)) > 120) p.ditch();
  }
  // a damaged plane on its way home: find it a wingman (a friendly plane going home nearby, not already escorting)
  function pair(p) {
    if (p.escortedBy && p.escortedBy.alive && p.escortedBy.escortHome === p) return;
    p.escortedBy = null;
    let best = null, bd = PAIR_R;
    for (const q of WW.world.planes) {
      if (q === p || !q.alive || q.nation !== p.nation || q.state !== 'return' || q.escortHome || q.ditchTo || q.deckPh || q.hp < q.maxHp * 0.6 || q.carrier.isBase) continue;
      if (q.kind !== 'fighter' && q.ordnance) continue;
      const d = WW.dist(p.x, p.z, q.x, q.z) - (q.element && q.element === p.element ? 30 : 0) - (q.kind === 'fighter' ? 15 : 0);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) return;
    best.escortHome = p; p.escortedBy = best; ST.escorts++;
    if (WW.emit) WW.emit('airOrder', { carrier: p.carrier, order: 'escortHome', plane: best, target: p, squadron: best.squadron || null });
  }
  function escortFly(q, dt) {
    const p = q.escortHome;
    const goal = p && p.alive && p.state === 'return' && !p.deckPh ? (p.ditchTo ? { x: p.ditchTo.x, z: p.ditchTo.z } : p.carrier) : null;
    if (!goal || WW.dist(p.x, p.z, goal.x, goal.z) < ESC_DONE || q.fuel < 8) { q.escortHome = null; if (p && p.escortedBy === q) p.escortedBy = null; return false; }
    if (WW.dogfight && WW.dogfight.threat && WW.dogfight.threat(q, 40)) return false;   // a fight first (air_dogfight.js home fights)
    const c = Math.cos(p.heading), s = Math.sin(p.heading), side = (q.kind === 'fighter' ? 1 : -1) * 9 * (WW.cfg.PLANE_K || 1) + (q.kind === 'fighter' ? 2 : -2);
    const sx = p.x - c * 4 - s * side, sz = p.z - s * 4 + c * side, d = WW.dist(q.x, q.z, sx, sz);
    q.fuel -= dt * CRUISE_BURN;
    q.fly(sx + c * 10, sz + s * 10, p.y + (q.kind === 'fighter' ? 3 : 0), dt, WW.clamp(p.speed + (d > 12 ? Math.min(10, d * 0.4) : 0), p.speed * 0.8, q.pt.speed));
    return true;
  }
  if (WW.Plane) {
    const P = WW.Plane.prototype, g0 = P.goHome;
    P.goHome = function (dt) {
      if (this.kind !== 'scout' && this.kind !== 'flyingboat' && this.carrier && !this.carrier.isBase && dt > 0) {
        if (this.ditchTo) { flyDitch(this, dt); return; }
        if ((this.fhChk = (this.fhChk || 0) - dt) <= 0) {
          this.fhChk = 1; ditchCheck(this);
          if (this.ditchTo) { flyDitch(this, dt); return; }
          if (this.hp < this.maxHp * 0.5 && WW.dist(this.x, this.z, this.carrier.x, this.carrier.z) > ESC_DONE + 40) pair(this);
        }
        if (this.escortHome && escortFly(this, dt)) return;
      }
      return g0.apply(this, arguments);
    };
  }
  function reset() { for (const k in ST) ST[k] = 0; }
  WW.on('roundStart', reset);
  WW.airFlight = { climbV, orphan, home, ditchShip, cruise, stats: ST };
})();
