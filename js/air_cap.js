// air_cap.js — WW.cap: CAP doctrine for the fighter director (docs/PLANE_REVIEW.md P4). air_ops.js fighter() hands
// a CAP element leader with no foe to WW.cap.patrol(); wingmen fly their slot (air_squadrons.js follow()).
// - Threat bearing: the nearest detected raid, else the nearest known enemy carrier, else the nearest enemy contact,
//   else the enemy's side of the map; it swings slowly (no snapping).
// - USN ('picket', doctrine air.cap; CXAM radar and a fighter director): each CAP section holds a station 4-5 hull
//   lengths out on the threat bearing, in two height bands (high ~62 against dive bombers, low ~32 against torpedo
//   planes), flying a wide racetrack across the bearing (long straight legs, gentle 20-25 deg turns, a ~25 s lap).
//   A raid on radar: the pickets are vectored out to meet it on a lead course, high band over the dive bombers, low
//   band onto the torpedo planes; the inner section (the 4th station) stays back until the raid is close.
// - IJN ('overhead': lookouts, no radar): shotai patrol over the fleet in wide loops (3.5-4 hull lengths), low and
//   medium; they react only when a raid is seen and every shotai goes for it, the torpedo planes first.
// Engagement (plane.foe) starts only at visual range (ENGAGE): the vector is flown with plane.vec, no foe.
// Sim code: WW.rand never needed (deterministic geometry). State: cv._cap (per carrier), plane.capWp / vec.
window.WW = window.WW || {};
(function () {
  const ENGAGE = 130;                    // a vectored fighter takes the raider as its foe inside this range (the tally: ~5 L)
  // Per doctrine: leash (CAP stays inside), long leash (armed raid inbound, fighters escorting it), vector range.
  const DOC = {
    // vecR: a raid this far from the carrier is vectored on. USN: the CXAM plot and a fighter director, 15-25 nm out
    // in 1942, so the meeting point is 2-3 x the drop range out and the CAP works the bombers over all the way in.
    // IJN: no radar and few fighter radios: the Zeros go for what their own loops and the lookouts see (200; 270 put
    // them onto raids reported by scouts, and moved the 100-round gate from USN 52 to 44)
    picket:   { leash: 190, leash2: 420, vecR: 420, spd: 0.85 },   // the racetrack ends reach ~185 (140 out, 90 across, the turns)
    overhead: { leash: 160, leash2: 205, vecR: 200, spd: 0.8 }   // the loops reach ~155 (115 + 12% + 25 toward the threat)
  };
  // USN stations by section index: distance out, angle off the threat bearing, altitude band, inner (kept back)
  const PICKET = [{ d: 140, a: 0, y: 62 }, { d: 115, a: 0.5, y: 32 }, { d: 135, a: -0.5, y: 66 }, { d: 60, a: 0, y: 30, inner: true }];
  const LEG = 90, TURN = 0.42;           // racetrack half-leg (u) and turn rate (rad/s)
  const LOOP = [{ r: 95, y: 27, dir: 1 }, { r: 115, y: 45, dir: -1 }, { r: 80, y: 36, dir: 1 }]; // IJN loops round the fleet
  const ST = { vectors: 0, contacts: 0, joins: 0 };

  function doc(nation) {
    const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(nation) : null;
    return DOC[(d && d.air && d.air.cap) || (nation === 'IJN' ? 'overhead' : 'picket')];
  }
  function style(nation) { const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(nation) : null; return (d && d.air && d.air.cap) || (nation === 'IJN' ? 'overhead' : 'picket'); }

  // ---------- the threat bearing (per carrier, every 1 s, swinging at most 0.25 rad/s) ----------
  function bearing(cv) {
    const C = cv._cap || (cv._cap = { t: -1, b: null });
    const now = WW.time.now;
    if (now - C.t < 1 && C.b !== null) return C.b;
    const dt = C.t < 0 ? 0 : now - C.t; C.t = now;
    let want = null;
    const A = WW.airOps && WW.airOps.picture ? WW.airOps.picture(cv) : null;
    if (A && A.near) want = Math.atan2(A.raidZ - cv.z, A.raidX - cv.x);
    if (want === null && WW.intel) {
      let bc = 1e9, bs = 1e9, cvB = null, anyB = null;
      for (const c of WW.intel.enemyShips(cv.nation, { fresh: 120 })) {
        const u = c.unit; if (!u || !u.alive) continue;
        const d = WW.dist(cv.x, cv.z, c.x, c.z), b = Math.atan2(c.z - cv.z, c.x - cv.x);
        if (u.type === 'carrier' && d < bc) { bc = d; cvB = b; }
        if (d < bs) { bs = d; anyB = b; }
      }
      want = cvB !== null ? cvB : anyB;
    }
    if (want === null) want = cv.x < WW.cfg.MAP_W / 2 ? 0 : Math.PI;   // nothing known: the enemy's side of the map
    C.b = C.b === null ? want : WW.angleDiff(0, C.b + WW.clamp(WW.angleDiff(C.b, want), -0.25 * dt, 0.25 * dt));   // kept in -pi..pi
    return C.b;
  }

  // CAP section index of this element on its carrier (stable: element ids in launch order)
  function sectionIndex(pl) {
    const el = pl.element; if (!el || !WW.squadrons) return 0;
    let n = 0;
    for (const e of WW.squadrons.elements()) if (e !== el && e.key === el.key && e.id < el.id && e.members.length && e.members[0].alive && !e.members[0].target) n++;
    return n;
  }

  // ---------- vectors: the raid contact this section should meet ----------
  function raidFor(pl, band, inner, D) {
    if (!WW.intel) return null;
    const c = pl.carrier, armed = WW.airOps.armed;
    let best = null, bs = -1e9;
    for (const ct of WW.intel.enemyPlanes(pl.nation)) {
      const u = ct.unit; if (!u || !u.alive || u.kind === 'scout') continue;
      const dc = WW.dist(c.x, c.z, ct.x, ct.z);
      if (dc > (inner ? 150 : D.vecR)) continue;
      const arm = armed(u);
      if (!arm && u.kind !== 'fighter' && u.kind !== 'flyingboat') continue;   // empty bombers going home: not worth a vector
      let s = arm ? 200 : u.kind === 'fighter' ? 60 : 90;
      if (arm && u.kind === 'torpedo') s += band === 'low' ? 80 : style(pl.nation) === 'overhead' ? 60 : -20;   // the Zeros go for the torpedo planes
      if (arm && u.kind === 'dive') s += band === 'high' ? 60 : -30;
      s -= WW.dist(pl.x, pl.z, ct.x, ct.z) * 0.5 + dc * 0.2;
      if (s > bs) { bs = s; best = u; }
    }
    return best;
  }
  // Lead course onto the raider: where it will be when we get there, above it (high band) or onto its height (low).
  function vector(pl, u, band, dt) {
    const d = WW.dist(pl.x, pl.z, u.x, u.z), cl = Math.max(20, pl.pt.speed + (u.speed || 20) * 0.5), tg = Math.min(6, d / cl);
    const px = u.x + Math.cos(u.heading) * (u.speed || 0) * tg, pz = u.z + Math.sin(u.heading) * (u.speed || 0) * tg;
    const alt = band === 'high' ? Math.max(u.y + 10, 40) : Math.max(u.y + 6, 16);
    pl.fly(px, pz, alt, dt, pl.pt.speed, 0.5);
  }

  // ---------- stations ----------
  function racetrack(pl, cx, cz, axis, alt, D, dt) { // two turn points across the threat bearing; teardrop turns between them
    const ux = Math.cos(axis + Math.PI / 2), uz = Math.sin(axis + Math.PI / 2);
    if (pl.capWp === undefined) pl.capWp = ((pl.x - cx) * ux + (pl.z - cz) * uz) > 0 ? -1 : 1;
    let wx = cx + ux * LEG * pl.capWp, wz = cz + uz * LEG * pl.capWp;
    const d = WW.dist(pl.x, pl.z, wx, wz), behind = Math.abs(WW.angleDiff(pl.heading, Math.atan2(wz - pl.z, wx - pl.x))) > 1.7;
    if (d < 25 || (behind && d < 60)) { pl.capWp = -pl.capWp; wx = cx + ux * LEG * pl.capWp; wz = cz + uz * LEG * pl.capWp; }
    const far = WW.dist(pl.x, pl.z, cx, cz) > LEG * 1.8;   // still on the way out to the station: straight there
    pl.fly(wx, wz, alt, dt, (pl.pt.cruise || pl.pt.speed * 0.8) * (far ? 1.1 : D.spd / 0.85), far ? 0.7 : TURN);
  }
  function inMap(x, z, m) { return [WW.clamp(x, m, WW.cfg.MAP_W - m), WW.clamp(z, m, WW.cfg.MAP_H - m)]; }

  // A CAP leader (or a lone fighter) with no foe: vector onto a raid, or fly the station. Returns true if it flew.
  function patrol(pl, dt) {
    const c = pl.carrier, D = doc(pl.nation), b = bearing(c), sty = style(pl.nation), i = sectionIndex(pl);
    if (sty === 'picket') {
      const S = PICKET[i % PICKET.length], band = S.y > 45 ? 'high' : 'low';
      pl.capBand = band;                  // capPick: the high band takes the dive bombers, the low band the torpedo planes
      const u = raidFor(pl, band, S.inner, D);
      if (u) { if (pl.vec !== u) { pl.vec = u; ST.vectors++; } vector(pl, u, band, dt); return true; }
      pl.vec = null;
      const a = b + S.a, p = inMap(c.x + Math.cos(a) * S.d, c.z + Math.sin(a) * S.d, 60);
      racetrack(pl, p[0], p[1], a, S.y + Math.floor(i / PICKET.length) * 8, D, dt);
      return true;
    }
    // overhead: loops round the fleet, shifted a little toward the threat; all react to a seen raid
    const L = LOOP[i % LOOP.length], u = raidFor(pl, L.y < 35 ? 'low' : 'high', false, D);
    pl.capBand = null;                    // the Zeros all go for whatever is lowest and nearest (drawn to the torpedo planes)
    if (u) { if (pl.vec !== u) { pl.vec = u; ST.vectors++; } vector(pl, u, L.y < 35 ? 'low' : 'high', dt); return true; }
    pl.vec = null;
    const cx = c.x + Math.cos(b) * 25, cz = c.z + Math.sin(b) * 25;
    const r = L.r * (1 + 0.12 * Math.sin(WW.time.now * 0.11 + i)), a = Math.atan2(pl.z - cz, pl.x - cx) + L.dir * 0.4;
    const p = inMap(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 40);
    const far = WW.dist(pl.x, pl.z, cx, cz) > r * 1.6;
    pl.fly(p[0], p[1], L.y, dt, (pl.pt.cruise || pl.pt.speed * 0.8) * (far ? 1.1 : 1), far ? 0.7 : 0.5);
    return true;
  }
  // The CAP's foe at visual range: the nearest raider of note within ENGAGE of this fighter (capPick scores it).
  function inReach(pl, u) { return WW.dist(pl.x, pl.z, u.x, u.z) < ENGAGE || u === pl.vec && WW.dist(pl.x, pl.z, u.x, u.z) < ENGAGE * 1.3; }

  // the height band a CAP fighter flies in (its section leader's): 'high' | 'low' | null
  function band(pl) { return pl.capBand || (pl.leader && pl.leader.capBand) || null; }

  // ---------- every fighter in reach joins in ----------
  // A raid on the plot inside JOIN_R of the carrier: its fighters coming home (on the way back within JOIN_R, or holding
  // in the marshal stack) with the fuel for a fight (JOIN_FUEL s) and not badly hit leave the stack and fight as CAP
  // until the raid is gone (Yorktown's VF-3 at Midway, Enterprise's returning VF-10 at Santa Cruz). Called every 1 s
  // by the air boss (air_boss.js capTick). air_ops.js fighter() sends a joined fighter home once no raid is near.
  const JOIN_R = 300, JOIN_FUEL = 22, JOIN_MIN = 8;   // fuel (s): to join in / a joined fighter fights down to
  function raidNear(cv, R) {
    if (!WW.intel) return false;
    for (const c of WW.intel.enemyPlanes(cv.nation)) { const u = c.unit; if (u && u.alive && WW.airOps.armed(u) && WW.dist(cv.x, cv.z, c.x, c.z) < R) return true; }
    return false;
  }
  function join(cv) {
    if (!raidNear(cv, JOIN_R)) return;
    cv._joinT = WW.time.now;
    const D = cv._deck;
    for (const p of WW.world.planes) {
      if (!p.alive || p.removed || p.carrier !== cv || p.kind !== 'fighter' || p.search || p.fuel < JOIN_FUEL || p.hp < p.maxHp * 0.6) continue;
      const stack = p.state === 'landing' && p.deckPh === 'marshal', home = p.state === 'return' && !p.nightRecall && WW.dist(p.x, p.z, cv.x, cv.z) < JOIN_R;
      if (!stack && !home) continue;
      if (D) { const i = D.lq.indexOf(p); if (i >= 0) D.lq.splice(i, 1); }
      p.state = 'transit'; p.deckPh = null; p.lqT = undefined; p.phT = 0; p.target = null; p.wave = null; p.sk = null; p.recall = false; p.foe = null; p.scanT = 0;
      p.joined = WW.time.now; ST.joins++;
      if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'join', plane: p, squadron: p.squadron || null });
    }
  }
  // a joined fighter with no foe goes back home once no raid has been near its carrier for 3 s
  function joinDone(pl) { return !!pl.joined && (pl.fuel < JOIN_MIN || !pl.foe && WW.time.now - (pl.carrier._joinT || -1e9) > 3); }

  function reset() { ST.vectors = ST.contacts = ST.joins = 0; }
  WW.on('roundStart', reset);
  WW.cap = { patrol, bearing, band, doc, style, inReach, sectionIndex, join, joinDone, ENGAGE, DOC, stats: ST };
})();
