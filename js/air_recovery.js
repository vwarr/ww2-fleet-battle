// air_recovery.js — bringing the air group home (part of WW.airDeck; loads after air_deck.js): the way back, the
// divert to another friendly deck, the marshal stack, the groove, the trap and the taxi forward to the park.
// - Return: a plane flies to its marshal stack. It diverts to another friendly carrier of the side (never the island
//   base) when that deck is clearly sooner: nearer, a shorter queue, or its own carrier damaged / burning.
// - Marshal: a racetrack MARSHAL_L hull lengths astern of the carrier, on the side away from the island, with
//   straight legs; each plane holds its own level (stacked 5 u apart). The stack moves with the ship.
// - Groove: in recovery mode the bottom plane of the stack is cleared to approach (straight in from astern) once the
//   plane ahead is on final and close to the deck, so two planes are in the groove at a time and traps come about
//   every 6-8 s. Final: the runway centreline (PD on the drift), wave-off when the deck is foul or the ship swings,
//   bolter past the wires; a wave-off goes back to the head of the stack. Trap: arrestor jolt, then the deck crew
//   taxis it forward past the barrier, folds it and rearms it (cv.rearm, aircraft.js REARM).
window.WW = window.WW || {};
(function () {
  if (!WW.airDeck) return;
  const K = WW.airDeck._k, PI = Math.PI;
  const { deckOf, toLocal, lenOf, colFor, newEntry, pack, clearAft, P, TD_X } = K;
  const MARSHAL_L = 4.0, LEG = 40, RT = 15, STACK0 = 15, STACK_DY = 5; // stack centre (hull lengths astern), leg length, turn radius, lowest level, spacing
  const HOME_R = 110;           // distance at which a returning plane joins the stack (landing state)
  const GATE_X = -70, GROOVE = 60;           // the groove starts this far astern (carrier local); the whole stack lies behind it
  const RS = { diverts: 0, waveoffs: 0, bolters: 0, marshal: 0, why: {} };

  // ---------- the way home and the divert ----------
  function deckScore(p, c) {     // seconds until this deck could take the plane (lower is better)
    const D = c._deck; if (!D) return 1e9;
    let s = WW.dist(p.x, p.z, c.x, c.z) / p.pt.speed + D.lq.length * 7 + (D.mode === 'launch' ? 10 : 0);
    if (c.hp < c.maxHp * 0.45) s += 60;
    if ((c.fireN || 0) >= 3) s += 45;
    return s;
  }
  function divert(p) {
    const own = p.carrier; if (own.isBase || !own.alive) return;
    let best = own, bs = deckScore(p, own) - 12;  // a margin: stay with your own ship unless the other is clearly sooner
    for (const s of WW.world.ships) {
      if (s === own || !s.alive || s.sinking || s.isBase || s.type !== 'carrier' || !s.hangar || s.nation !== p.nation) continue;
      const v = deckScore(p, s); if (v < bs) { bs = v; best = s; }
    }
    if (best === own) return;
    const D = own._deck; if (D) { const i = D.lq.indexOf(p); if (i >= 0) D.lq.splice(i, 1); }
    p.carrier = best; p.diverted = (p.diverted || 0) + 1; RS.diverts++;
    if (WW.airBoss) WW.airBoss.stats.diverts++;
    if (WW.emit) WW.emit('airOrder', { carrier: best, order: 'divert', plane: p, squadron: p.squadron || null });
  }
  // The marshal stack's centre in carrier-local coordinates.
  function stackAt(c, D) { return [-(c.stats.length || 26) * MARSHAL_L, -D.s * 26]; }
  function goHome(p, dt) {
    p.foe = null;
    p.dvT = (p.dvT || 0) - dt;
    if (p.dvT <= 0) { p.dvT = 3; if (!p.diverted || p.diverted < 2) divert(p); }
    const c = p.carrier, D = deckOf(c), m = stackAt(c, D), w = c.toWorld(m[0], m[1]), d = WW.dist(p.x, p.z, w[0], w[1]);
    p.fly(w[0], w[1], d > 120 ? 25 : STACK0 + 4, dt, p.pt.speed);
    if (d < HOME_R) { p.state = 'landing'; p.deckPh = 'marshal'; p.phT = 0; p.lqT = WW.time.now; if (D.lq.indexOf(p) < 0) D.lq.push(p); RS.marshal++; }
  }

  // ---------- marshal, groove, trap ----------
  // Placed to start the approach: well astern of the gate, on the stack's inbound leg (heading up the wake).
  function inbound(q, c) { return toLocal(c, q.x, q.z)[0] < GATE_X - 10 && Math.abs(WW.angleDiff(q.heading, c.heading)) < 1.0; }
  // Pure pursuit on the racetrack (stack-centred local coords u along the ship, v across): the far leg heads aft
  // (-u), the near leg forward (+u), the turns at each end.
  function trackPoint(u, v, la) {
    const H = LEG / 2;
    if (u > H || u < -H) { const cx = u > H ? H : -H, a = Math.atan2(v, u - cx) + la / RT; return [cx + Math.cos(a) * RT, Math.sin(a) * RT]; }
    return v >= 0 ? [u - la, RT] : [u + la, -RT];
  }
  function landing(p, dt) {
    const c = p.carrier, D = deckOf(c), ps = -D.s, L = toLocal(c, p.x, p.z), lx = L[0], lz = L[1];
    if (D.lq.indexOf(p) < 0) { D.lq.push(p); if (p.lqT === undefined) p.lqT = WW.time.now; }
    p.phT = (p.phT || 0) + dt;
    const to = (ax, az, alt, spd, rate) => { const w = c.toWorld(ax, az); return p.fly(w[0], w[1], alt, dt, spd, rate); };
    switch (p.deckPh) {
      case 'marshal': default: { // hold a level of the stack astern; the lowest waiting plane is cleared first
        p.deckPh = 'marshal';
        let lvl = 0, ahead = null, inApp = false, first = true;   // first: no plane below it in the stack is placed to go in
        for (const q of D.lq) {
          if (q === p) break;
          if (q.deckPh === 'marshal') { lvl++; if (inbound(q, c)) first = false; }
          else if (q.deckPh === 'app') inApp = true;
          else if (q.deckPh === 'final') ahead = q;
        }
        for (const q of D.lq) if (q !== p && q.deckPh === 'app') inApp = true;
        const m = stackAt(c, D), u = lx - m[0], v = (lz - m[1]) * ps, t = trackPoint(u, v, 22);
        to(m[0] + t[0], m[1] + t[1] * ps, STACK0 + STACK_DY * Math.min(lvl, 7), p.pt.speed * 0.7, 1.5);
        const groove = !ahead || (TD_X - toLocal(c, ahead.x, ahead.z)[0]) < GROOVE;   // the plane ahead is well into its final
        // the lowest plane placed to go in (a wave-off still up ahead lets the next one through first)
        if (lvl < 3 && first && D.mode === 'recover' && !D.closing && !inApp && groove && inbound(p, c)) { p.deckPh = 'app'; p.phT = 0; }
        break;
      }
      case 'app': // straight in from astern (the stack lies behind the gate) onto the centreline, descending to the groove
        if (D.mode !== 'recover') { p.deckPh = 'marshal'; p.phT = 0; break; }
        to(Math.min(lx + 30, TD_X - 12), D.run, 7, p.pt.speed * (lx < GATE_X - 15 ? 1 : 0.85), 1.8);        // a point up the centreline ahead of it
        if (lx > TD_X - 15) { p.deckPh = 'marshal'; p.phT = 0; break; }          // overshot the groove: round again from the stack
        if ((lx > GATE_X && lx < TD_X - 15 && Math.abs(lz - D.run) < 6 && Math.abs(WW.angleDiff(p.heading, c.heading)) < 0.6) || p.phT > 25) { p.deckPh = 'final'; p.phT = 0; p._lz = undefined; }
        break;
      case 'final': {
        const vlz = dt > 0 && p._lz !== undefined ? (lz - p._lz) / dt : 0; p._lz = lz; // fly the runway centreline (PD on the drift)
        p.turnTo(c.heading - WW.clamp((lz - D.run) * 0.15 + vlz * 0.12, -0.8, 0.8), dt, 2.2);
        const togo = TD_X - lx, ty = D.dy + P().deckY + WW.clamp(togo * 0.13, 0, 8);
        const slow = togo < 30 && togo > 8 && !clearAft(D);                                     // deck still foul: ease off, the LSO waits
        p.speed += WW.clamp(c.speed + (slow ? 7 : WW.clamp(togo * 0.3, 10, 17)) - p.speed, -8 * dt, 8 * dt);
        p.vy = WW.clamp((ty - p.y) * 2.5 - 0.13 * (p.speed - c.speed), -6, 4);
        const tw = c.toWorld(TD_X, D.run), dh = WW.dist(p.x, p.z, tw[0], tw[1]), b = Math.atan2(tw[1] - p.z, tw[0] - p.x);
        let wave = false;
        if (togo < 22 && togo > 2) {
          if (togo < 8 && !clearAft(D)) wave = 'foul';                                          // deck still foul a second out
          else if (p.waveOffs < 3 && dh < 25 && dh > 4 && Math.abs(WW.angleDiff(c.heading, b)) > 0.5) wave = 'line'; // lined up badly
          else if (p.waveOffs < 3 && Math.abs(c.turnRate || 0) > 0.2) wave = 'swing';              // ship swinging
          else if (p.waveOffs < 3 && togo < 10 && Math.abs(lz - D.run) > 3) wave = 'off';
        }
        if (togo < -4) { wave = 'bolter'; RS.bolters++; } // bolter (final is only entered from astern of the gate)
        if (wave) { p.waveOffs++; RS.waveoffs++; RS.why[wave] = (RS.why[wave] || 0) + 1; p.deckPh = 'waveoff'; p.phT = 0; break; }
        if (togo < 1 && Math.abs(lz - D.run) < 2 && p.y - D.dy - P().deckY < 1.3) trap(p, D, lx, lz);
        return;
      }
      case 'waveoff': // go around: power on, climb out ahead to the disengaged side, then back to the head of the stack
        to(lx + 40, ps * 12, 12, p.pt.speed, 1.2);
        if (p.phT > 3 || lx > 25) {
          p.deckPh = 'marshal'; p.phT = 0;
          const i = D.lq.indexOf(p); if (i > 0) { D.lq.splice(i, 1); D.lq.unshift(p); }
        }
        break;
    }
  }
  function trap(p, D, lx, lz) {
    const c = p.carrier;
    p.state = 'rollout'; p.deckPh = 'trap'; p.t = 0; p.lx = Math.min(lx, TD_X + 1); p.lz = lz;
    p.rel = WW.clamp(p.speed - c.speed, 6, 16); p.vy = 0; p.turn = 0;
    D.lq.splice(D.lq.indexOf(p), 1); D.recN++;
    const w = c.toWorld(p.lx, p.lz); p.x = w[0]; p.z = w[1]; p.y = D.dy + P().deckY;
    // A bad trap (ship swinging, crippled plane, forced in after wave-offs) can go over the side (deaths agent).
    const nr = WW.dayNight ? WW.dayNight.landRisk() : 0; // a night landing (daylight.js)
    if (nr) WW.dayNight.stats.nightLandings++;
    const tr = c.turnRate || 0, bad = Math.max(p.crippled ? 0.25 : 0, Math.abs(tr) > 0.18 ? 0.35 : 0, p.waveOffs >= 3 ? 0.3 : 0, nr);
    const ad = WW.airDeaths;
    if (bad > 0 && ad && typeof ad.slideOff === 'function' && WW.rand() < bad &&
        ad.slideOff(p, tr > 0.18 ? -1 : tr < -0.18 ? 1 : undefined)) { if (nr) WW.dayNight.stats.nightLandingLoss++; return; }
    WW.stats.planesLanded++;
  }
  function rollout(p, dt) {
    const c = p.carrier, D = deckOf(c);
    p.rel = Math.max(0, p.rel - 26 * dt); p.lx += p.rel * dt;
    p.lz += WW.clamp(D.run - p.lz, -2 * dt, 2 * dt);
    const w = c.toWorld(p.lx, p.lz), k = Math.min(1, p.t / 0.7);
    p.x = w[0]; p.z = w[1]; p.y = D.dy + P().deckY + Math.sin(k * PI) * 0.12;
    p.heading = c.heading; p.speed = 0; p.vy = 0; p.turn = 0;
    p.sync(dt);
    p.group.rotation.z = -0.17 * Math.sin(k * PI); // arrestor jolt: the nose dips as the wire bites
    if (p.rel <= 0 && p.t > 0.7) receive(p, D);
  }
  function receive(p, D) { // the deck crew takes over: taxi forward past the barrier, fold, rearm
    const c = D.c, at = WW.time.now + P().rearm, m = p.model;
    (c.rearm = c.rearm || []).push({ kind: p.kind, at });
    p.removed = true; p.alive = false; // the model stays on deck (not back to the pool)
    if (m.payload) m.payload.visible = false;
    const col = colFor(D, p.kind, lenOf(p.kind));
    const e = newEntry(D, m, p.kind, p.lx, p.lz, 0, at, col ? 'in' : 'elev');
    if (col) { col.e.push(e); pack(D); } else D.loose.push(e);
  }

  WW.on('roundStart', () => { for (const k in RS) RS[k] = 0; RS.why = {}; });
  Object.assign(WW.airDeck, { goHome, landing, trap, rollout, receive, recovery: RS, MARSHAL_L });
})();
