// ai_pt.js — PT boats: lurk at island cover in their own half; AMBUSH a ship whose track they can get ahead of (the
// Solomons doctrine: lie in wait off the enemy's bow, let him come on, fire from ahead of the beam at short range, then
// turn away at full speed); else dash at a close target of opportunity when the run is clear (WW.threat danger from
// ships other than the target), fire the spread as a pair from both bows / beams, break off home at full speed with a jink. MG only at their own size. During the air-war hold (fleet_cmd.js airWar) and the
// approach (posture search / approach: until the fleets engage) they are the fleet's forward PICKETS instead: the
// pairs run far out toward the enemy, on one flank of its line of approach, and shadow its nearest known ships from
// just inside their own sighting range (edging out of the guns' reach where they can), so what they see reaches
// the plot (intel.js) and the strikes; no torpedo runs while picketing. Registers WW.shipAI.roles.pt;
// uses WW.lightAI.h (ai_light.js, loaded first). Reads the enemy only through WW.intel and WW.threat; no randomness.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const H = WW.shipAI.h, seen = H.seen, lead = H.lead;
  const { VAL, now, danger, pen, homeX, age, contacts, ownDps, fanClear, landNear, coverPts, order } = WW.lightAI.h;
  const stats = { checks: 0, far: 0, deep: 0, shoal: 0, hot: 0, astern: 0, picket: 0, amb: 0, ambWait: 0, ambRun: 0, ambLost: 0, ambTime: 0, ambFlee: 0, ambFire: 0, ambAbort: 0 }; // PT run checks and why they were refused (astern: a stern chase); picket: picket station updates; amb*: ambushes set, waits reached, runs from one, dropped (target gone / no plan left), waits timed out, broken off (inside another gun ship's reach); runs from an ambush that fired / were aborted
  WW.on('roundStart', () => { for (const k in stats) stats[k] = 0; });

  // ---------------- PT boats ----------------
  const PT = {
    DASH: 130,        // max run length to the firing point
    FIRE: 38,         // firing distance from the target (torpedo range 70; close = fewer misses)
    FIRE_MAX: 50,
    EX_MAX: 9,        // acceptable path danger from ships other than the target (dps)
    PEN_RUN: 0.12, PEN_ABORT: 0.16, PEN_LURK: -0.06, // midline limits (x half-map)
    DEEP: { PEN_RUN: 0.95, PEN_ABORT: 1.05, PEN_LURK: 0.85, PEN_HOME: 1.05 }, PEN_HOME: 0.02, // deep: PT_DEEP limits
    GUN_R: 160, GUN_T: 40, GUN_OFF: 18, // skirmish: an enemy PT / surfaced sub this close, at most this long, beam offset
    RUN_MAX: 24, OUT_MIN: 6, OUT_MAX: 28, GHOST_T: 90, LEAD_T: 8, FLEE_DG: 0.6, IDLE_R: 70, IDLE_THR: 0.7, BACK_T: 14,
    ASTERN: 2.1,      // rad off the target's bow (~120 deg): a boat further aft than this makes no dash at a ship under way
    STALK: 35, BOLD_GATE: 0.8, BOLD_FLEE: 4, BOLD_DASH: 1.8, DARK: 0.35 // BOLD_DASH: x DASH; bold boats: stalk this far outside the guns' reach; run gate x (1 + BOLD_GATE x bold); flee danger
  };
  // AMBUSH doctrine by nation, [day, night] (Solomons 1942-43: the USN's PT squadrons at Tulagi against the Tokyo
  // Express; the IJN's few torpedo boats and its night torpedo school). A PT boat cannot catch a ship from astern with a
  // 27-36 kn Mk 8 (core.js WW.TORPEDO_NATION): it gets ahead of the target's track (the heading and speed its side's plot
  // holds, intel.js, dead-reckoned) and waits off her bow, idling (a small wake: intel.js PT_WAKE), then runs in as she
  // closes and fires from ahead of the beam: a short torpedo run at a big target angle. The pair works both bows.
  //   OFF   wait this far off the predicted track (u; on the boat's own side; the pair's wing on the other bow)
  //   TRIG  the run starts when the target is this close (a battleship or cruiser: on entering its main battery's reach,
  //         so a boat never idles inside it: the wait is outside the guns, the run is the dash)
  //   FIRE  fire at about this range on the run (FIRE + 5 the limit)
  //   LEAD  s the boat must be at the wait point before the target reaches TRIG of it (a plan it cannot make in time is none)
  //   DMAX  the furthest ahead along the track a wait point is put (u); REACH: the furthest from the boat (a boat lies in
  //         wait for what comes its way; it does not cross the sea to get ahead of a ship far off)
  //   WAIT  s a boat waits before it re-plans; AGE: the oldest contact worth ambushing (s, dead-reckoned)
  //   CREEP throttle while waiting (idling bow on to the enemy's line: little wake, and way on to bolt)
  // Night favours the boats: closer to the track, a closer shot, a longer wait, a staler plot dead-reckoned further
  // (the guns cannot see them either); by day the lookouts see a boat sooner (intel.js), so it waits further off.
  // IJN: the faster Type 91 and the night torpedo school: a little further off and a longer shot by day, as close at night.
  const AMB = {
    USN: { OFF: [50, 30], TRIG: [90, 70], FIRE: [40, 30], LEAD: [5, 3], DMAX: [300, 420], REACH: [220, 300], WAIT: [45, 100], AGE: [30, 60], CREEP: 0.14 },
    IJN: { OFF: [54, 30], TRIG: [95, 75], FIRE: [44, 34], LEAD: [5, 3], DMAX: [300, 440], REACH: [220, 320], WAIT: [40, 110], AGE: [30, 60], CREEP: 0.14 }
  };
  const AMB_BIG = { battleship: 1, cruiser: 1 }; // main batteries the boats keep out of while waiting (sim_behaviour pt_loiter)
  // Boldness (PT doctrine): 2 once the enemy's escorts are gone (no fit destroyer of its seen this round: nothing
  // left that hunts PT boats; the side has seen the enemy), 1 in the dark (the PT boat's hour: Guadalcanal, Surigao),
  // else 0. A bold boat may run deep (the PT_DEEP limits), stalks the enemy's heavy ships just outside the reach of
  // their guns instead of lurking at home, takes any heavy ship for a target and accepts more fire on the run (a
  // standoff of PT boats and a battleship until the time limit was no battle).
  function bold(ship) {
    const B = WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(ship.nation) : null;
    if (!B || !B.foeSeen) return 0;
    let seenAny = B.foeSeen.size > 0, dd = false;
    B.foeSeen.forEach(u => { if (u.type === 'destroyer' && u.alive && !u.sinking && !u.escaped && u.hp >= WW.fleetGroups.CRIP * u.maxHp) dd = true; });
    if (!seenAny) seenAny = contacts(ship, 60).some(c => !c.unit.submerged);
    if (seenAny && !dd) return 2;
    return WW.daylight < PT.DARK ? 1 : 0;
  }
  // Midline limits: PT_DEEP (the commander's ptDeep: no enemy gun ship seen this round, and a carrier known or a long
  // search) lets the boats run deep; the danger field still steers them.
  const deepOK = ship => { const B = WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(ship.nation) : null; return !!(B && (B.ptDeep || picketing(ship, B) || (ship.ai.lt && ship.ai.lt.bold))); };
  // ---- pickets (the air-war hold and the approach) ----
  // PICKET: SEE the share of its own sighting range of the shadowed ship (intel.js SEEN x EYE.pt) a picket keeps
  // from it, ARC (rad) round from the line home where the first pair sits and LANE (rad) between pairs (each further
  // pair also SPREAD further out across the line of approach), all on the
  // same hand in the side's own frame (so the two sides' pickets work opposite flanks, not into each other), WING
  // beside the leader, FAR (x W past the midline) where to look with nothing known, AGE (s) of the contacts worth
  // shadowing, DG the danger (dps) a station may sit in, BACK the step out along the radius while it is hotter
  // (never past MAXK x the sighting range: a picket that cannot see is no picket).
  const PICKET = { SEE: 0.85, ARC: 0.55, LANE: 0.45, SPREAD: 150, WING: 14, FAR: 0.3, AGE: 60, DG: 4, BACK: 12, MAXK: 1.05, CLOSE: 30 }; // CLOSE: a picket's MG takes on only an enemy this close (it scouts; it does not hunt the enemy's PTs)
  // a side whose fleet is only PT boats (and subs) has nothing to picket for: its boats fight as usual
  function picketing(ship, B) {
    if (!B || !(B.airWar || B.posture === 'search' || B.posture === 'approach') || ship.hp < ship.maxHp * 0.5) return false;
    for (const k of ['main', 'carrier', 'screen', 'flotilla']) if (B.groups[k] && B.groups[k].members.length) return true;
    return false;
  }
  function picketSpot(ship, B, L) {
    const n = ship.nation, W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H, M = B.groups.pt.members, i = Math.max(0, M.indexOf(ship));
    let tx = W / 2 - homeX(ship) * W * PICKET.FAR, tz = B.axis.z, bd = 1e9, tu = null; // nothing known: the enemy's likely approach
    for (const c of contacts(ship, PICKET.AGE)) { // the nearest known enemy surface ship to our main body: its screen
      if (c.unit.submerged || c.unit.isBase || c.unit.isLand || c.unit.type === 'pt' || c.unit.type === 'submarine') continue; // not the enemy's own pickets
      const d = WW.dist(B.axis.x, B.axis.z, c.x, c.z); if (d < bd) { bd = d; tx = c.x; tz = c.z; tu = c.unit; }
    }
    const IR = WW.intel && WW.intel.R, sight = (IR ? (IR.SEEN[tu ? tu.type : 'destroyer'] || 170) * (IR.EYE.pt || 0.55) : 95);
    const h0 = Math.atan2(B.axis.z - tz, B.axis.x - tx), k = i >> 1, a = h0 + PICKET.ARC + k * PICKET.LANE, ca = Math.cos(a), sa = Math.sin(a);
    const sp = k * PICKET.SPREAD, px = -Math.sin(h0) * sp, pz = Math.cos(h0) * sp; // the further pairs further out on the flank: a picket line, and apart on the way out
    let r = sight * PICKET.SEE, x = tx + px + ca * r - sa * (i & 1 ? PICKET.WING : 0), z = tz + pz + sa * r + ca * (i & 1 ? PICKET.WING : 0);
    for (let q = 0; q < 6 && r < sight * PICKET.MAXK && (danger(n, x, z) > PICKET.DG || ghostNear(ship, x, z)); q++) { r += PICKET.BACK; x += ca * PICKET.BACK; z += sa * PICKET.BACK; }
    L.lx = WW.clamp(x, 40, W - 40); L.lz = WW.clamp(z, 40, Hh - 40);
    for (let q = 0; q < 4 && !WW.terrain.isNavigable(L.lx, L.lz, 2.5); q++) { L.lx = WW.clamp(L.lx + ca * 20, 40, W - 40); L.lz = WW.clamp(L.lz + sa * 20, 40, Hh - 40); }
    stats.picket++;
  }
  const lim = (ship, k) => (deepOK(ship) ? PT.DEEP[k] : PT[k]);
  function partner(ship) {
    const B = WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(ship.nation) : null;
    const m = B && B.groups && B.groups.pt ? B.groups.pt.members : null;
    if (m) { const i = m.indexOf(ship); if (i >= 0) { const p = m[i ^ 1]; return p && p.alive ? { p, lead: !(i & 1) } : { p: null, lead: true }; } }
    let best = null, bd = 220;
    for (const o of WW.world.ships) if (o !== ship && o.alive && o.type === 'pt' && o.nation === ship.nation) { const d = WW.dist(ship.x, ship.z, o.x, o.z); if (d < bd) { bd = d; best = o; } }
    return { p: best, lead: !best || ship.id < best.id };
  }
  // Where to lurk: the commander's PT station (own flank, own half), pulled to nearby island cover, kept out of
  // known gun reach. The wing of a pair lurks beside its leader.
  // Heavy ships a side has seen this round, remembered past the intel contact's expiry (a PT boat's own eye is
  // short, so a battleship it lost track of may well be inside its gun range). A lurk spot keeps clear of where it
  // may be now: its gun range plus how far it may have gone, along its last course.
  const ghosts = { USN: new Map(), IJN: new Map() };
  WW.on('roundStart', () => { ghosts.USN.clear(); ghosts.IJN.clear(); });
  function noteGhosts(ship) {
    const G = ghosts[ship.nation]; if (!G) return;
    for (const c of contacts(ship, 3)) if (c.unit.type === 'battleship' || c.unit.type === 'cruiser') G.set(c.unit.id, { u: c.unit, x: c.x, z: c.z, h: c.heading, sp: c.speed, t: c.seenAt });
  }
  function ghostNear(ship, x, z, except) {
    const G = ghosts[ship.nation]; if (!G) return false;
    for (const [k, g] of G) {
      if (g.u === except) continue;
      const ag = now() - g.t;
      if (!g.u.alive || ag > PT.GHOST_T) { G.delete(k); continue; }
      const dr = Math.min(ag, 30), gx = g.x + Math.cos(g.h) * g.sp * dr, gz = g.z + Math.sin(g.h) * g.sp * dr;
      if (WW.dist(x, z, gx, gz) < g.u.stats.guns[0].range + 30 + Math.min(ag * 1.5, 90)) return true;
    }
    return false;
  }
  function lurkSpot(ship, L) {
    const a = ship.ai, o = order(ship), W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H, n = ship.nation;
    noteGhosts(ship);
    const B = WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(n) : null;
    L.stalk = false;
    if (picketing(ship, B)) return picketSpot(ship, B, L);
    if (L.bold && ship.hp >= ship.maxHp * 0.35 && stalkSpot(ship, L)) return;
    // the commander's spot for this boat (fleet_search.js: one per pair, spread out), unless it is hot now
    if (o && o.spot && ship.hp >= ship.maxHp * 0.35 && danger(n, o.spot.x, o.spot.z) <= 0.3 && !ghostNear(ship, o.spot.x, o.spot.z)) { L.lx = o.spot.x; L.lz = o.spot.z; return; }
    let bx, bz;
    if (o && isFinite(o.sx)) { bx = o.sx; bz = o.sz; }
    else { bx = (a.cn ? a.cx : ship.x) - homeX(ship) * 60; bz = WW.clamp((a.cn ? a.cz : ship.z) + a.orbitDir * 150, 40, Hh - 40); }
    if (ship.hp < ship.maxHp * 0.35) bx += homeX(ship) * 120; // cripple: stay home
    const lx = W / 2 + homeX(ship) * -lim(ship, 'PEN_LURK') * W / 2;    // never lurk past this x
    bx = ship.nation === 'USN' ? Math.min(bx, lx) : Math.max(bx, lx);
    bx = WW.clamp(bx, 40, W - 40);
    for (let k = 0; k < 4 && (danger(n, bx, bz) > 0.3 || ghostNear(ship, bx, bz)); k++) bx = WW.clamp(bx + homeX(ship) * 60, 40, W - 40); // out of known reach
    const ec = WW.intel && WW.intel.centre ? WW.intel.centre(n) : null;
    let best = { x: bx, z: bz }, bs = -danger(n, bx, bz) * 30 - (ghostNear(ship, bx, bz) ? 150 : 0);
    for (const c of coverPts()) {
      const dd = WW.dist(c.x, c.z, bx, bz);
      if (dd > 150 || pen(ship, c.x) > lim(ship, 'PEN_LURK')) continue;
      const dg = danger(n, c.x, c.z);
      let s = 25 - dd * 0.35 - dg * 30 - (dg > 0.3 ? 200 : 0) - WW.dist(c.x, c.z, ship.x, ship.z) * 0.05;
      if (ec) s -= WW.dist(c.x, c.z, ec.x, ec.z) * 0.08;
      if (s > bs && ghostNear(ship, c.x, c.z)) s -= 150;
      if (s > bs) { bs = s; best = c; }
    }
    const pr = L.pair.p && L.pair.p.ai && L.pair.p.ai.lt;
    if (!L.pair.lead && pr && pr.lx !== undefined) { L.lx = pr.lx; L.lz = WW.clamp(pr.lz + 15, 20, Hh - 20); return; }
    L.lx = best.x; L.lz = best.z;
  }
  // A bold boat's spot: STALK outside the reach of the nearest known heavy ship (the guns that fire on a PT boat,
  // ptReach), on the boat's own side of it, kept out of the reach of the others; the wing beside its leader.
  function stalkSpot(ship, L) {
    let t = null, bd = 1e9;
    const dark = WW.daylight < PT.DARK;
    for (const c of contacts(ship, dark ? 180 : 45)) { // in the dark: an old contact too, run down along its course
      if (c.unit.submerged || !VAL[c.unit.type] || c.unit.isBase || c.unit.isLand || c.unit.type === 'submarine') continue;
      const d = WW.dist(ship.x, ship.z, c.x, c.z); if (d < bd) { bd = d; t = c; }
    }
    if (!t) return false;
    const pr = L.pair.p && L.pair.p.ai && L.pair.p.ai.lt;
    if (!L.pair.lead && pr && pr.lx !== undefined && pr.stalk) { L.lx = pr.lx; L.lz = WW.clamp(pr.lz + 15, 20, WW.cfg.MAP_H - 20); L.stalk = true; return true; }
    const dr = Math.min(age(t), dark ? 60 : 20), tx = t.x + Math.cos(t.heading) * t.speed * dr, tz = t.z + Math.sin(t.heading) * t.speed * dr;
    let a = Math.atan2(ship.z - tz, ship.x - tx), r = (ptReach(t.unit) + PT.STALK) * (dark ? 0.55 : 1), x = 0, z = 0; // at night closer: the guns cannot see the boat either
    for (let q = 0; q < 7; q++) {
      x = tx + Math.cos(a) * r; z = tz + Math.sin(a) * r;
      if (WW.terrain.isNavigable(x, z, 2.5) && danger(ship.nation, x, z) - ownDps(t.unit, r) <= PT.EX_MAX) break;
      a += (q % 2 ? -1 : 1) * (q + 1) * 0.35;
    }
    L.lx = WW.clamp(x, 40, WW.cfg.MAP_W - 40); L.lz = WW.clamp(z, 40, WW.cfg.MAP_H - 40); L.stalk = true;
    return true;
  }
  // A target of opportunity: { c, fx, fz, score } or null. Isolated, crippled, slow, or a DD / CA near land,
  // within a short dash, with acceptable danger along the run from ships other than the target.
  function firePoint(ship, u, side) {
    const t = Math.min(PT.LEAD_T, WW.dist(ship.x, ship.z, u.x, u.z) / ship.stats.speed); // short look-ahead only
    const px = u.x + Math.cos(u.heading) * u.speed * t, pz = u.z + Math.sin(u.heading) * u.speed * t;
    const h = u.heading + side;
    return { x: px + Math.cos(h) * PT.FIRE, z: pz + Math.sin(h) * PT.FIRE };
  }
  function sideOf(ship, u, lead_) { // beam on the PT's side; the pair splits bow-ward / aft-ward of it
    const cr = Math.cos(u.heading) * (ship.z - u.z) - Math.sin(u.heading) * (ship.x - u.x);
    return (cr >= 0 ? 1 : -1) * (PI / 2 - (lead_ ? 0.5 : -0.35));
  }
  function runCheck(ship, c, side, gate) {
    const u = c.unit, n = ship.nation, f = firePoint(ship, u, side);
    const dash = WW.dist(ship.x, ship.z, f.x, f.z), DASH = PT.DASH * (ship.ai.lt && ship.ai.lt.bold ? PT.BOLD_DASH : 1); // a bold boat runs in from its stalking spot
    if (WW.dist(ship.x, ship.z, u.x, u.z) > DASH + PT.FIRE) { stats.far++; return null; } // the target itself is close
    stats.checks++;
    // no stern chase: a ship under way with the boat well abaft her beam outruns the dash and the torpedo (the ambush
    // plans ahead of her instead)
    if (u.speed > 2.5 && Math.abs(WW.angleDiff(c.heading, Math.atan2(ship.z - c.z, ship.x - c.x))) > PT.ASTERN) { stats.astern++; return null; }
    if (dash > DASH) { stats.far++; return null; }
    if (pen(ship, f.x) > lim(ship, 'PEN_RUN')) { stats.deep++; return null; }
    if (WW.terrain.depthAt(f.x, f.z) < 2) { stats.shoal++; return null; }
    let ex = 0;
    for (let k = 1; k <= 4; k++) {
      const x = ship.x + (f.x - ship.x) * k / 4, z = ship.z + (f.z - ship.z) * k / 4;
      ex = Math.max(ex, danger(n, x, z) - ownDps(u, WW.dist(x, z, u.x, u.z)));
    }
    if (ex > gate) { stats.hot++; return null; }
    return { fx: f.x, fz: f.z, dash, ex };
  }
  // ---- the ambush ----
  const dark = () => WW.daylight < PT.DARK;
  const amb = ship => AMB[ship.nation] || AMB.USN;
  const ready = ship => ship.ai.torpReload <= 0.5;
  // the target's range at which the run starts: TRIG, or a big ship's main battery reach (+5), whichever is further
  function trigR(u, k, D) { return Math.max(D.TRIG[k], AMB_BIG[u.type] && u.stats.guns[0] ? u.stats.guns[0].range + 5 : 0); }
  // Her mean course: the plotted heading smoothed over COURSE_T s, per side and ship (a zigzag or a jink about a base
  // course is not a new track: the plotting officer draws the line through it). Kept per round.
  const COURSE_T = 20, courses = { USN: new Map(), IJN: new Map() };
  WW.on('roundStart', () => { courses.USN.clear(); courses.IJN.clear(); });
  function course(n, c) {
    const M = courses[n]; if (!M) return c.heading;
    let e = M.get(c.unit);
    if (!e || now() - e.t > 30) { e = { s: Math.sin(c.heading), c: Math.cos(c.heading), t: now() }; M.set(c.unit, e); return c.heading; }
    const w = 1 - Math.exp(-(now() - e.t) / COURSE_T);
    e.s += (Math.sin(c.heading) - e.s) * w; e.c += (Math.cos(c.heading) - e.c) * w; e.t = now();
    return Math.atan2(e.s, e.c);
  }
  // the target's dead-reckoned position now (on her plotted heading) and her mean course / speed (the side's plot, not the truth)
  function track(c, n) { const dr = Math.min(age(c), 60); return { x: c.x + Math.cos(c.heading) * c.speed * dr, z: c.z + Math.sin(c.heading) * c.speed * dr, h: n ? course(n, c) : c.heading, v: c.speed }; }
  // the boat's place relative to the predicted track: along (> 0 ahead of the target), cross (> 0 on her one side)
  function rel(ship, t) { const rx = ship.x - t.x, rz = ship.z - t.z, c = Math.cos(t.h), s = Math.sin(t.h); return { along: rx * c + rz * s, cross: -rx * s + rz * c, d: Math.hypot(rx, rz) }; }
  // A wait point ahead of c's track on side sd (+1 / -1), or null: the nearest one along the track that the boat can
  // reach LEAD s before the target comes within TRIG of it, in navigable water, inside the boat's run limits, out of
  // every OTHER known big ship's main battery reach, with acceptable danger on the way from ships other than the
  // target (gate, dps).
  function planAt(ship, c, sd, gate, offK) {
    const u = c.unit, n = ship.nation, D = amb(ship), k = dark() ? 1 : 0, t = track(c, n);
    if (t.v < 1.2) return null; // stopped or creeping: the dash (opportunity) takes her
    const off = D.OFF[k] * (offK || 1), trig = trigR(u, k, D), dT = Math.sqrt(Math.max(0, trig * trig - off * off));
    const cs = Math.cos(t.h), sn = Math.sin(t.h), W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H, vb = ship.stats.speed * 0.9;
    const others = contacts(ship, 30).filter(q => q.unit !== u && AMB_BIG[q.unit.type] && !q.unit.submerged);
    for (let dd = dT + 20; dd <= D.DMAX[k]; dd += 20) {
      const ax = t.x + cs * dd - sn * off * sd, az = t.z + sn * dd + cs * off * sd;
      if (ax < 40 || ax > W - 40 || az < 40 || az > Hh - 40) continue;
      const dB = WW.dist(ship.x, ship.z, ax, az), tp = dB / vb, tt = (dd - dT) / t.v;
      if (dB > D.REACH[k] || tp + D.LEAD[k] > tt) continue;           // too far for the boat, or she would be there first
      if (pen(ship, ax) > lim(ship, 'PEN_RUN') || !WW.terrain.isNavigable(ax, az, 2.5) || WW.terrain.depthAt(ax, az) < 2) continue;
      if (ghostNear(ship, ax, az, u)) continue;
      let bad = false;
      for (const q of others) { const g = q.unit.stats.guns[0]; if (g && WW.dist(ax, az, q.x, q.z) < g.range + 15) { bad = true; break; } }
      if (bad) continue;
      let ex = 0;
      for (let j = 1; j <= 4; j++) {
        const x = ship.x + (ax - ship.x) * j / 4, z = ship.z + (az - ship.z) * j / 4;
        ex = Math.max(ex, danger(n, x, z) - ownDps(u, WW.dist(x, z, t.x, t.z)));
      }
      if (ex > gate) continue;
      return { x: ax, z: az, sd, tt, tp, ex };
    }
    return null;
  }
  const seenCrip = (n, u) => (WW.fleetCmd && WW.fleetCmd.seenHp ? WW.fleetCmd.seenHp(n, u) : u.hp / u.maxHp) < 0.5;
  const ambGate = (L, crip) => PT.EX_MAX * (crip ? 1.6 : 1) * (1 + PT.BOLD_GATE * (L.bold || 0)) * (dark() ? 1.5 : 1);
  // The best ambush for this boat: { u, p } or null. The wing of a pair whose leader is setting one takes the same
  // target from the other bow (or, if it cannot get there in time, on the leader's side further out).
  function ambush(ship, L) {
    const n = ship.nation, D = amb(ship), k = dark() ? 1 : 0;
    const pl = L.pair.p && L.pair.p.ai && L.pair.p.ai.lt;
    if (!L.pair.lead && pl && (pl.state === 'set' || pl.state === 'wait') && pl.amb && pl.amb.u.alive) {
      const c = WW.intel.known(n, pl.amb.u);
      if (c && age(c) <= D.AGE[k]) {
        const g = ambGate(L, seenCrip(n, c.unit)) * 1.3;
        const p = planAt(ship, c, -pl.amb.sd, g) || planAt(ship, c, pl.amb.sd, g, 1.35);
        if (p) return { u: c.unit, p };
      }
    }
    let best = null;
    for (const c of contacts(ship, D.AGE[k])) {
      const u = c.unit;
      if (u.submerged || !VAL[u.type] || u.isBase || u.isLand || u.type === 'submarine' || u.type === 'pt') continue;
      const crip = seenCrip(n, u), r = rel(ship, track(c, n));
      const p = planAt(ship, c, r.cross >= 0 ? 1 : -1, ambGate(L, crip)); // the boat's own side of her track: no crossing her bow
      if (!p) continue;
      const s = VAL[u.type] * (crip ? 1.6 : 1) / (1 + p.tt / 40 + p.ex / 10);
      if (!best || s > best.s) best = { u, p, s };
    }
    return best;
  }
  // Each decision while setting or waiting: run when the target comes within TRIG (from ahead of her beam), re-plan when
  // her track no longer passes the boat (she turned away, or passed) or the wait is long, give it up when no plan is
  // left. Returns true when the boat is now on its run.
  function ambushTick(ship, L, T, nb) {
    const n = ship.nation, A = L.amb, u = A && A.u, D = amb(ship), k = dark() ? 1 : 0;
    const c = u && u.alive && !u.sinking && WW.intel ? WW.intel.known(n, u) : null;
    const drop = () => { stats.ambLost++; L.state = 'lurk'; L.amb = null; L.spotT = 0; };
    if (!c || age(c) > D.AGE[k] || ship.hp < ship.maxHp * 0.35) { drop(); return false; }
    // inside the reach of an enemy gun ship that is not the target: break off
    if (nb && nb.near && nb.near.unit !== u && nb.margin < 0) { stats.ambFlee++; L.state = 'flee'; L.t0 = T; L.from = nb.near.unit; L.amb = null; return false; }
    const t = track(c, n), r = rel(ship, t), trig = trigR(u, k, D);
    let bigIn = false; // a known big ship's main battery about to reach the boat: the run starts now, or the boat goes
    for (const q of contacts(ship, 30)) {
      const g = q.unit.stats.guns[0];
      if (AMB_BIG[q.unit.type] && !q.unit.submerged && g && WW.dist(ship.x, ship.z, q.x, q.z) < g.range + 5) { bigIn = true; break; }
    }
    if (r.d <= trig || bigIn) {
      if (r.along > -5 && ready(ship) && r.d < trig + 40 && Math.abs(r.cross) < ship.stats.torpedoes.range) {
        stats.ambRun++; L.state = 'run'; L.ambRun = true; L.tgt = u; L.t0 = T; L.hp0 = ship.hp; L.side = 0; L.fire = D.FIRE[k]; L.amb = null; ship.target = u;
        return true;
      }
      if (bigIn) { stats.ambFlee++; L.state = 'out'; L.t0 = T; L.from = u; L.amb = null; return false; }
    }
    // the wait point still lies ahead on her track, within a torpedo shot of it (as the plot now has her)? Else re-plan:
    // she turned away or zigged, or passed; a wait too long is re-planned as well
    const ra = rel(A, t), dT = Math.sqrt(Math.max(0, trig * trig - D.OFF[k] * D.OFF[k]));
    const lost = !(ra.along > dT * 0.5 && Math.abs(ra.cross) < ship.stats.torpedoes.range * 0.85) || (L.state === 'wait' && r.along < 0);
    const long = L.state === 'wait' && T - A.waitT > D.WAIT[k];
    if (lost || long) {
      if (long) stats.ambTime++;
      const g = ambGate(L, seenCrip(n, u)), p = planAt(ship, c, A.sd, g) || planAt(ship, c, -A.sd, g);
      if (!p) { drop(); return false; }
      // waiting: a small shift of her track is followed at idle (the wait steering); a big one sends the boat on again
      const far = WW.dist(p.x, p.z, ship.x, ship.z) > 60;
      A.x = p.x; A.z = p.z; A.sd = p.sd; A.planT = T;
      if (L.state === 'wait') { if (far) { L.state = 'set'; A.waitT = 0; } else if (long) A.waitT = T; }
    }
    return false;
  }
  function opportunity(ship, L) {
    const cs = contacts(ship, 20), guns = cs.filter(c => c.unit.stats.guns.length && !c.unit.submerged);
    let best = null;
    for (const c of cs) {
      const u = c.unit;
      if (age(c) > 3 || u.submerged || !VAL[u.type]) continue;
      let iso = true;
      for (const g of guns) if (g !== c && WW.dist(g.x, g.z, c.x, c.z) < 75) { iso = false; break; }
      const crip = (WW.fleetCmd && WW.fleetCmd.seenHp ? WW.fleetCmd.seenHp(ship.nation, u) : u.hp / u.maxHp) < 0.5, slow = u.stats.speed < 6 || u.speed < 2.5;
      const land = (u.type === 'destroyer' || u.type === 'cruiser') && landNear(u.x, u.z, 30);
      if (!(iso || crip || land || slow || (L.bold && u.type !== 'destroyer'))) continue;
      const gate = PT.EX_MAX * (crip ? 1.6 : 1) * (land ? 1.4 : 1) * (iso ? 1.2 : 1) * (1 + PT.BOLD_GATE * (L.bold || 0));
      // the beam on our side, else the far beam (away from a consort), whichever run is clearer
      const s0 = sideOf(ship, u, L.pair.lead), r0 = runCheck(ship, c, s0, gate), r1 = runCheck(ship, c, -s0, gate);
      const r = r0 && (!r1 || r0.ex <= r1.ex + 2) ? r0 : r1, side = r === r0 ? s0 : -s0;
      if (!r) continue;
      const s = VAL[u.type] * (crip ? 1.6 : 1) * (iso ? 1.3 : 1) / (1 + r.dash / 60 + r.ex / 10);
      if (!best || s > best.score) best = { c, score: s, side };
    }
    return best;
  }
  // Skirmish: an enemy PT boat or surfaced sub (MG work) within GUN_R, not past the run limit, no other danger there.
  function skirmish(ship) {
    let best = null, bd = PT.GUN_R;
    for (const c of contacts(ship, 3)) {
      const u = c.unit, d = WW.dist(ship.x, ship.z, c.x, c.z);
      if (u.submerged || !(u.type === 'pt' || u.type === 'submarine') || d >= bd || pen(ship, c.x) > lim(ship, 'PEN_RUN')) continue;
      if (danger(ship.nation, c.x, c.z) - ownDps(u, 0) > PT.EX_MAX) continue;
      let busy = 0; // other pairs already on it: spread the boats over the enemy's (no pile-up on one)
      for (const o of WW.world.ships) if (o !== ship && o.alive && o.type === 'pt' && o.nation === ship.nation && o.ai.lt && o.ai.lt.state === 'gun' && o.ai.lt.tgt === u && o !== (ship.ai.lt && ship.ai.lt.pair.p)) busy++;
      const v = d + busy * 80; if (v >= bd) continue;
      bd = v; best = u;
    }
    return best;
  }
  // the reach of the guns that would fire on a PT (ships_ai.js ROLE_W / secondaries): a battleship's main battery
  // never does, its secondaries do
  function ptReach(u) {
    const G = u.stats.guns, W = WW.shipAI.ROLE_W[u.type]; let r = 0;
    for (let k = 0; k < G.length; k++) if (k > 0 || !W || W.pt > 0) r = Math.max(r, G[k].range);
    return r || (G[0] ? G[0].range : 0);
  }
  function nearestBig(ship) { // nearest known enemy gun ship that out-guns a PT (flee from it)
    let b = null, bd = 1e9, near = null, nd = 1e9;
    for (const c of contacts(ship, 30)) {
      const u = c.unit;
      if (u.submerged || u.type === 'pt' || !u.stats.guns.length) continue;
      const dr = Math.min(age(c), 20), x = c.x + Math.cos(c.heading) * c.speed * dr, z = c.z + Math.sin(c.heading) * c.speed * dr; // where it may be now
      const d = WW.dist(ship.x, ship.z, x, z), r = ptReach(u), q = { x, z, unit: u };
      if (d - r < bd) { bd = d - r; b = q; }
      if (d < nd && d < r + 40) { nd = d; near = q; } // the closest gun ship we are inside (or near) the reach of
    }
    return b ? { c: b, margin: bd, near } : null;
  }
  // MG only at its own size: PT boats, a destroyer close aboard, a surfaced sub. Never at BB / CA.
  function mgTarget(ship) {
    const ct = ship.ai.calTarget; if (!ct) return;
    let t = null, bd = 36;
    for (const c of contacts(ship, 3)) {
      const u = c.unit, d = WW.dist(ship.x, ship.z, u.x, u.z);
      if (u.submerged || !(u.type === 'pt' || u.type === 'submarine' || (u.type === 'destroyer' && d < 25))) continue;
      if (d < bd) { bd = d; t = u; }
    }
    for (const k in ct) ct[k] = t;
  }

  const L0state = a => (a.lt ? a.lt.state : 'lurk');
  // keep way on: a helm order past 1.2 rad cuts the speed (ships.js); a sweeping turn keeps it (same turn rate)
  const sweep = ship => { ship.desiredHeading = ship.heading + WW.clamp(WW.angleDiff(ship.heading, ship.desiredHeading), -1.1, 1.1); };
  function ptAI(ship, dt) {
    const a = ship.ai, n = ship.nation, T = now();
    const L = a.lt || (a.lt = { state: 'lurk', t0: T, decT: 0, lx: ship.x, lz: ship.z, tgt: null, side: 0, hp0: ship.hp, spotT: 0, leg: 'fwd', legT: 0, pair: { p: null, lead: true } });
    a.ownComb = L0state(a) !== 'lurk' && L0state(a) !== 'gun' && L0state(a) !== 'wait'; // combing a torpedo track would break a dash; at the lurk spot or the wait, comb
    a.ownWithdraw = true; // a crippled PT lurks at home and makes no runs (below) rather than the core's withdrawal
    mgTarget(ship);
    const jink = Math.sin(T * 1.7 + ship.id) * 0.45;
    L.decT -= dt;
    const decide = L.decT <= 0;
    if (decide) { L.decT = 0.5; L.pair = partner(ship); L.bold = bold(ship); if (!L.bold) L.stalk = false; }
    if (L.state === 'run') {
      const u = L.tgt, c = u && u.alive && WW.intel ? WW.intel.known(n, u) : null;
      let abort = !c || age(c) > (L.ambRun ? amb(ship).AGE[dark() ? 1 : 0] : 6) || T - L.t0 > PT.RUN_MAX || pen(ship, ship.x) > lim(ship, 'PEN_ABORT') || ship.hp < L.hp0 - ship.maxHp * 0.3;
      if (!abort && decide) {
        // abort when the danger on the run spikes or a destroyer turns toward us
        const lx = ship.x + Math.cos(ship.heading) * 20, lz = ship.z + Math.sin(ship.heading) * 20;
        if (danger(n, lx, lz) - ownDps(u, WW.dist(lx, lz, u.x, u.z)) > PT.EX_MAX * 2.2 * (1 + PT.BOLD_GATE * (L.bold || 0))) abort = true;
        for (const q of contacts(ship, 3)) {
          if (abort || q.unit === u || q.unit.type !== 'destroyer') continue;
          const d = WW.dist(ship.x, ship.z, q.x, q.z);
          // (from an ambush the target's screen comes on toward the boat on her course anyway: only a destroyer that has
          // turned off it toward the boat counts)
          if (d < 80 && Math.abs(WW.angleDiff(q.unit.heading, Math.atan2(ship.z - q.z, ship.x - q.x))) < 0.6 && !(L.ambRun && c && Math.abs(WW.angleDiff(q.unit.heading, c.heading)) < 0.35)) abort = true;
        }
      }
      if (abort) { if (L.ambRun) stats.ambAbort++; L.state = 'out'; L.t0 = T; L.from = u; L.ambRun = false; }
      else {
        const d = WW.dist(ship.x, ship.z, u.x, u.z), FM = L.ambRun ? L.fire + 5 : PT.FIRE_MAX;
        const p = lead(ship, u, ship.stats.torpedoes.speed || WW.TORPEDO.speed), lb = Math.atan2(p.z - ship.z, p.x - ship.x);
        if (L.ambRun) ship.desiredHeading = lb; // from the ambush: straight in on the firing bearing, she is coming to the boat
        else { const f = firePoint(ship, u, L.side); ship.desiredHeading = d > PT.FIRE_MAX + 8 && WW.dist(ship.x, ship.z, f.x, f.z) > 14 ? Math.atan2(f.z - ship.z, f.x - ship.x) : lb; }
        ship.throttle = 1;
        if (a.torpReload <= 0 && d < FM && d > 15 && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.3 && seen(ship, u) && fanClear(ship, lb, Math.min(ship.stats.torpedoes.range, d + 10))) {
          if (H.fireSpread(ship, u) !== false) { if (L.ambRun) stats.ambFire++; L.state = 'out'; L.t0 = T; L.from = u; L.ambRun = false; }
        } else if (d < 15) { L.state = 'out'; L.t0 = T; L.from = u; L.ambRun = false; }
      }
      if (L.state === 'run') { sweep(ship); return; }
    }
    if (L.state === 'gun') { // close and fight with the MG: up the target's beam, then pace it
      const u = L.tgt, c = u && u.alive && !u.sinking && !u.submerged && WW.intel ? WW.intel.known(n, u) : null;
      if (!c || age(c) > 5 || T - L.t0 > PT.GUN_T || ship.hp < L.hp0 - ship.maxHp * 0.35 || pen(ship, ship.x) > lim(ship, 'PEN_ABORT')) { L.state = 'out'; L.t0 = T; L.from = null; }
      else {
        const sd = L.pair.lead ? 1 : -1, d = WW.dist(ship.x, ship.z, c.x, c.z);
        const fx = c.x + Math.cos(c.heading + sd * PI / 2) * PT.GUN_OFF, fz = c.z + Math.sin(c.heading + sd * PI / 2) * PT.GUN_OFF;
        ship.desiredHeading = d < 28 && WW.dist(ship.x, ship.z, fx, fz) < 10 ? c.heading : Math.atan2(fz - ship.z, fx - ship.x);
        ship.throttle = d < 28 ? WW.clamp(0.5 + (u.speed || 0) / ship.stats.speed, 0.5, 1) : 1;
        ship.target = u;
        return;
      }
    }
    const nb = decide || L.state !== 'lurk' ? nearestBig(ship) : L.nb;
    L.nb = nb;
    if (L.state === 'set' || L.state === 'wait') {
      if (decide && ambushTick(ship, L, T, nb)) { sweep(ship); return; }
      if (L.state === 'set' || L.state === 'wait') {
        const A = L.amb, D = amb(ship), d = WW.dist(ship.x, ship.z, A.x, A.z), want = Math.atan2(A.z - ship.z, A.x - ship.x);
        if (L.state === 'set') {
          ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0.1) : want;
          ship.throttle = d < 30 ? 0.6 : 1; // at full speed to get there first
          if (d < 16) { L.state = 'wait'; A.waitT = T; stats.ambWait++; }
          sweep(ship);
        } else {
          // idle at the wait point, bow on to the enemy's line of advance (little wake, way on): a slow circle round it
          const u = A.u, c = WW.intel.known(n, u), t = c ? track(c) : null;
          if (d > 22) { ship.desiredHeading = want; ship.throttle = 0.5; }
          else if (d > 9) { ship.desiredHeading = want + A.sd * 0.6; ship.throttle = D.CREEP; }
          else { ship.desiredHeading = (t ? Math.atan2(t.z - ship.z, t.x - ship.x) : want) + A.sd * 1.1; ship.throttle = D.CREEP; }
        }
        return;
      }
    }
    if (L.state === 'out' || L.state === 'flee') {
      // Break off home at full speed with a jink: straight away from the attacker / nearest gun ship, leaning home.
      let from = L.from && L.from.alive ? L.from : null;
      if (nb && nb.near && (!from || WW.dist(ship.x, ship.z, nb.near.x, nb.near.z) < WW.dist(ship.x, ship.z, from.x, from.z))) from = nb.near;
      if (!from && nb) from = nb.c;
      let h = from ? Math.atan2(ship.z - from.z, ship.x - from.x) : (homeX(ship) < 0 ? PI : 0);
      const home = homeX(ship) < 0 ? PI : 0;
      const aw = h;
      const inReach = nb && nb.near && nb.margin < 0; // inside a gun ship's reach: the shortest way out first
      h += inReach ? jink * 0.15 : WW.clamp(WW.angleDiff(h, home), -0.25, 0.25) + jink * 0.4;
      // a hard reversal bleeds speed: take the nearest heading still well clear of the threat's bearing first
      if (Math.abs(WW.angleDiff(ship.heading, h)) > 1.2) h = aw + WW.clamp(WW.angleDiff(aw, ship.heading), -0.75, 0.75);
      const deep = pen(ship, ship.x) > lim(ship, 'PEN_HOME'); // past the midline: home first, whatever the threat bearing
      if (deep) h = home + WW.clamp(WW.angleDiff(home, aw), -0.6, 0.6) + jink * 0.5;
      ship.desiredHeading = h; ship.throttle = 1; if (!deep) sweep(ship); // deep: the nav layer needs the real course home
      const el = T - L.t0, clear = (!nb || nb.margin > 60) && danger(n, ship.x, ship.z) < 1;
      if (!deep && ((el > PT.OUT_MIN && clear) || el > PT.OUT_MAX)) { L.state = 'lurk'; L.from = null; L.spotT = 0; }
      return;
    }
    // ---- lurk ----
    L.spotT -= dt;
    if (L.spotT <= 0) { L.spotT = L.hot ? 4 : 12; lurkSpot(ship, L); } // a quiet spot is held a while (re-picked every 4 s the boat chased it in circles)
    const pk = picketing(ship, WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(n) : null);
    if (decide && !pk && a.torpReload <= 0 && ship.hp >= ship.maxHp * 0.35) {
      // join the partner's run from the other side, else look for our own opportunity
      const pl = L.pair.p && L.pair.p.ai && L.pair.p.ai.lt;
      let tgt = null;
      if (pl && pl.state === 'run' && pl.tgt && pl.tgt.alive) {
        const c = WW.intel.known(n, pl.tgt);
        if (c && age(c) <= 3 && runCheck(ship, c, -pl.side, PT.EX_MAX * 1.6)) { tgt = pl.tgt; L.side = -pl.side; }
      }
      if (!tgt) { const o = opportunity(ship, L); if (o) { tgt = o.c.unit; L.side = o.side; } }
      if (tgt) { L.state = 'run'; L.ambRun = false; L.tgt = tgt; L.t0 = T; L.hp0 = ship.hp; ship.target = tgt; return; }
      // no close run: lie in wait ahead of a ship's track (or join the leader's ambush from the other bow)
      const am = ambush(ship, L);
      if (am) {
        stats.amb++; L.state = 'set';
        L.amb = { u: am.u, x: am.p.x, z: am.p.z, sd: am.p.sd, planT: T, waitT: 0 }; ship.target = am.u;
        return;
      }
    }
    if (decide && ship.hp >= ship.maxHp * 0.5) {
      const g = skirmish(ship);
      if (g && (!pk || WW.dist(ship.x, ship.z, g.x, g.z) < PICKET.CLOSE)) { L.state = 'gun'; L.tgt = g; L.t0 = T; L.hp0 = ship.hp; ship.target = g; return; } // a picket fights only what is on it
    }
    // inside known gun reach with no run worth making: break off
    if (decide && nb && (nb.margin < (L.hot ? 60 : pk ? 15 : L.stalk ? 10 : 25) || danger(n, ship.x, ship.z) > (pk ? PICKET.DG * 1.5 : L.stalk ? PT.BOLD_FLEE : PT.FLEE_DG))) { L.state = 'flee'; L.t0 = T; L.from = nb.c.unit; return; }
    // A heavy ship we lost sight of may have closed into gun reach (its ghost): no patrol legs, full speed to the
    // spot (lurkSpot keeps it out of ghost reach), so a PT never idles where an unseen battleship can range it.
    if (decide) L.hot = !L.stalk && (ghostNear(ship, ship.x, ship.z) || danger(n, ship.x, ship.z) > (pk ? PICKET.DG : 0.3)); // a picket works inside the edge of it; a stalker on purpose
    // At the spot: a patrol leg stern-on to the enemy (a break-off then needs no turn), and a slower leg back.
    const d = WW.dist(ship.x, ship.z, L.lx, L.lz);
    // ARRIVE: the arrival radius is ~1.5 x the boat's turning circle at speed (11 / 1.2 = 9 u): inside 8 it could never
    // get there and orbited the spot (Fable F6: PT boats spinning)
    const ARRIVE = 16;
    if (L.hot && d > ARRIVE) { L.leg = 'fwd'; L.legT = T; }
    if (L.leg === 'back' && (d > PT.IDLE_R || T - L.legT > PT.BACK_T)) { L.leg = 'fwd'; L.legT = T; } // (land astern: the timer turns it back)
    else if (L.leg !== 'back' && (d < ARRIVE || (d < 25 && T - L.legT > 25))) { L.leg = 'back'; L.legT = T; }
    if (L.leg === 'back') {
      const ec = WW.intel && WW.intel.centre ? WW.intel.centre(n) : null;
      ship.desiredHeading = (ec ? Math.atan2(ship.z - ec.z, ship.x - ec.x) : homeX(ship) < 0 ? PI : 0) + 0.3 * Math.sin(T * 0.4 + ship.id);
      ship.throttle = PT.IDLE_THR; // brisk: a heavy ship sighted astern is already being run from
    } else {
      const want = Math.atan2(L.lz - ship.z, L.lx - ship.x);
      ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0.1) : want;
      ship.throttle = L.hot ? 1 : d < 35 ? 0.55 : 0.85; // easing in to the spot
    }
    // keep way on: come about in a sweeping turn (a > 1.2 rad helm order halves the speed, ships.js), so a heavy
    // ship that closes unseen finds the boat already moving, ready to bolt
    sweep(ship);
  }

  // Lurking or on picket, the helm order changes at most HELM_RATE rad/s: the spot and the safest heading are re-picked
  // every few seconds and the order jumped with them, so the boat turned continuously (Fable F6: PT boats spinning).
  // A run, a break-off, a flight or a gun fight keep the raw order.
  const HELM_RATE = 0.5;
  function ptHelm(ship, dt) {
    ptAI(ship, dt);
    const a = ship.ai, L = a.lt;
    if (!L || (L.state !== 'lurk' && L.state !== 'wait') || L.hot) { a.ptH = undefined; return; }
    if (a.ptH === undefined) a.ptH = ship.heading;
    a.ptH += WW.clamp(WW.angleDiff(a.ptH, ship.desiredHeading), -HELM_RATE * dt, HELM_RATE * dt);
    ship.desiredHeading = a.ptH;
  }
  WW.shipAI.roles.pt = ptHelm;
  Object.assign(WW.lightAI, { PT, AMB, stats, opportunity, ambush });
})();
