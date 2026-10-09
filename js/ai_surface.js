// ai_surface.js — surface combatant behaviour (battleship, cruiser, destroyer): formation stations from the fleet
// commander (WW.fleetCmd); the battle line's kite at the doctrine's preferred range, crossing the enemy's T;
// destroyer flotilla torpedo attacks (in pairs, from the flank, launch, turn away); the press (close on last-known
// contacts late in the round); AA cover for a raided carrier; early torpedo combing and torpedo-boat angling for big
// ships; a keep-off ring around enemy carriers; and the destroyer's sub hunt with depth charges (that block belongs
// to the depth-charge work).
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


  // ---- tuning ----
  const BIG = { battleship: 1, cruiser: 1 }, CAPITAL = { battleship: 1, carrier: 1 };
  const CV_KEEP = 108;     // no surface ship closes inside this of a known enemy carrier (the carrier is never caught)
  const CV_LAIR = 230;      // the press does not run down ships under an enemy carrier's wing (it would corner the carrier)
  const PRESS_AGE = 60;
  const HOME_K = 0.35;     // ... nor into the enemy's home waters (its carrier band: 0.15-0.35 W from its edge)    // a pressing ship with nothing in sight steams for last-known (non-carrier) contacts this old
  const SUB_HELP = 70, SUB_HELP_R = 250; // a DD answers a known sub this close to an ally, from this far away
  const RAID_R = 300, RAID_CLOSE = 45;   // AA cover: cruisers (and the carrier group's battleship) close on a raided carrier
  const TDIR_T = 20;       // s between crossing-the-T orbit side choices (a battleship turns slowly)
  const BAND = 0.1;        // +-10% of the preferred range: hold a pure broadside there
  const RUN_OUT = 14;      // s: a destroyer turns away after its torpedo spread
  const WARN = { battleship: 150, cruiser: 120 }; // early torpedo warning horizon (side-wide intel tracks)
  const REACT = { battleship: 2, cruiser: 1.2 };

  function surfaceAI(ship, dt) {
    const a = ship.ai, st = ship.stats, t = WW.supply && WW.supply.spent(ship) ? null : ship.target; // spent (ammo / fuel): breaks off, guns still answer
    a.ownWithdraw = true; // cripples: crippleHome below, after everything else
    surfaceRole(ship, dt, a, st, t);
    crippleHome(ship);
  }
  function surfaceRole(ship, dt, a, st, t) {
    // Destroyers hunt a sub contact inside SUB_HUNT, or at any range when no surface target is left.
    // A lost sub: run to its last-known position (datum) and give it up there if sonar finds nothing.
    // A sub already under attack stays the quarry while sonar holds it (re-attack, don't switch contacts).
    // Mutual support: a sub known close to an ally is hunted from SUB_HELP_R away.
    const ds = a.dcSub && a.dcSub.alive && !a.dcSub.sinking && seen(ship, a.dcSub) &&
      WW.dist(ship.x, ship.z, a.dcSub.x, a.dcSub.z) < SONAR ? a.dcSub : (a.dcSub = null);
    if (st.depthCharges && (a.dcLeft > 0 || ds || (a.sub && a.sub.alive && a.subC && (a.subD < SUB_HUNT * (aswRole(ship) ? 2 : 1) || !t || t.type === 'submarine' || subNearAlly(ship, a))))) {
      a.dcReload -= dt;
      if (a.dcLeft > 0) { dcPattern(ship, a, dt); return; }
      const fresh = !!ds || seen(ship, a.sub), s = ds || (fresh ? a.sub : a.subC);
      if (!fresh && WW.dist(ship.x, ship.z, s.x, s.z) < 10) { a.datumDone = a.subC.seenAt; a.sub = a.subC = null; a.retargetT = 0; return; }
      dcApproach(ship, a, s, fresh);
      return;
    }
    const o = WW.fleetCmd ? WW.fleetCmd.order(ship) : null, B = o ? WW.fleetCmd.side(ship.nation) : null;
    if (aaCover(ship, t, o, B)) { /* steaming to the raided carrier */ }
    else if (ringHold(o, B)) followStation(ship, o, B); // AA ring escort: holds its ring station and shoots from it
    else if (!t || (o && H.unreachable(ship, t)) || homeWaters(ship, t, B)) { // nothing to shoot, a carrier that outruns us
      const pur = B && B.posture === 'pursue' && WW.endgameAI;
      const pc = pur ? WW.endgameAI.pursueContact(ship, B) : B && B.posture === 'press' ? pressContact(ship) : null;
      if (pc) closeOn(ship, pc, B, pur);
      else if (o) followStation(ship, o, B); else H.idle(ship);
    } else engage(ship, t, o, B);
    if (t) torpedoes(ship, t, B);
    if (ship.type === 'battleship') angleOnBoats(ship);
    earlyComb(ship);
    keepOffCarriers(ship);
  }

  // ---- seams for the battle-line / destroyer role work ----
  // No target: keep the commander's formation station (group guide + offset along the axis of advance),
  // through the safest heading for the type's risk tolerance. Close to the station: steam along the axis.
  // A ring escort (doctrine ringR, fleet_formation.js) keeps its live station on its carrier instead, matching the
  // carrier's course and speed. Under sub threat the formation zigzags: B.zig is added to the course (shared plan).
  function followStation(ship, o, B) {
    if (o.role === 'escort' && o.ringR > 0 && WW.formation && WW.formation.ringKeep(ship, o, B)) return;
    const d = WW.dist(ship.x, ship.z, o.sx, o.sz), risk = B.doctrine.risk[ship.type] || 0.5, zig = B.zig || 0;
    let want;
    if (d > 20) { want = Math.atan2(o.sz - ship.z, o.sx - ship.x) + zig * WW.clamp(1.6 - d / 100, 0, 1); ship.throttle = WW.clamp(d / 60, 0.55, 1); }
    else { want = B.axis.h + zig; ship.throttle = 0.55; }
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, risk) : want;
  }
  // A carrier's AA-ring escort (doctrine ringR) keeps the ring whatever it is shooting at, while its carrier lives
  // and the side is not pressing, pursuing or withdrawing (fleet_formation.js; the escort charge is ai_charge.js).
  function ringHold(o, B) {
    return !!(o && B && o.role === 'escort' && o.ringR > 0 && o.ringCv && o.ringCv.alive && !o.ringCv.sinking &&
      B.posture !== 'press' && B.posture !== 'pursue' && B.posture !== 'withdraw');
  }
  // Preferred gun range: doctrine rangeFrac of the main battery (destroyers: inside torpedo range). Pressing
  // closes in by the doctrine's close-quarters style (IJN closer), a withdrawing side opens out. Never inside
  // CV_KEEP of a carrier.
  function prefRange(ship, B, t) {
    const st = ship.stats, main = st.guns[0];
    let pref = main ? main.range * (B ? B.doctrine.rangeFrac : 0.8) : 60;
    if (st.torpedoes && ship.type === 'destroyer') pref = Math.min(pref, st.torpedoes.range * 0.6);
    if (B && (B.posture === 'press' || B.posture === 'pursue')) pref *= 0.72 + 0.15 * (1 - B.doctrine.night);
    else if (B && B.posture === 'withdraw') pref *= 1.15;
    if (B && WW.nightOps) pref *= WW.nightOps.rangeK(B); // the night-fighting side closes in the dark
    if (t && t.type === 'carrier' && !fair(ship, t, B)) pref = Math.max(pref, CV_KEEP + 5);
    return pref;
  }
  // Gun fight: orbit the target at the preferred range, holding a pure broadside within +-BAND of it. The orbit
  // side is chosen to run across the target's bow (crossing the T: every turret bears, only its forward guns
  // answer). Loosely tied to the formation station (escorts more tightly; not while pressing), then the safest
  // heading for the type's risk. A destroyer with a capital target makes a torpedo attack instead (torpedoRun).
  function engage(ship, t, o, B) {
    const a = ship.ai, d = WW.dist(ship.x, ship.z, t.x, t.z), b = bearing(ship, t), pref = prefRange(ship, B, t), now = WW.time.now;
    if (ship.type === 'destroyer' && CAPITAL[t.type] && ship.stats.torpedoes && !(WW.supply && !WW.supply.torpLeft(ship))) return torpedoRun(ship, t, o, B, d, b); // (no reloads left: guns only)
    if (BIG[ship.type] && (a.tdFor !== t || now > a.tdT)) {
      // we sit at angle rel from the target; orbitDir +1 swings rel clockwise (decreasing): pick the side that
      // moves us toward its bow
      const rel = b + PI, toBow = WW.angleDiff(rel, t.heading);
      if (Math.abs(toBow) > 0.2 && t.speed > 0.5) a.orbitDir = toBow > 0 ? -1 : 1;
      a.tdFor = t; a.tdT = now + TDIR_T;
    }
    let e = (d - pref) / pref, h;
    e = Math.sign(e) * Math.max(0, Math.abs(e) - BAND);
    if (d > pref * 1.3) { h = b + a.orbitDir * 0.3; ship.throttle = 1; }
    else if (d < pref * 0.6) { h = b + PI + a.orbitDir * 0.4; ship.throttle = 1; }
    else { h = b + a.orbitDir * (PI / 2 - WW.clamp(e, -0.5, 0.5) * 1.4); ship.throttle = Math.abs(e) > 0.15 ? 1 : 0.8; }
    if (o && !(B && (B.posture === 'press' || B.posture === 'pursue') && o.role !== 'escort')) {
      const ds = WW.dist(ship.x, ship.z, o.sx, o.sz), esc = o.role === 'escort';
      if (ds > (esc ? 60 : 110)) h = blend(h, ship, o.sx, o.sz, esc ? 0.6 : 0.3);
    } else if (!o && a.cn && WW.dist(ship.x, ship.z, a.cx, a.cz) > 40) h = blend(h, ship, a.cx, a.cz, 0.35);
    ship.desiredHeading = WW.threat && B ? WW.threat.bestHeading(ship, h, B.doctrine.risk[ship.type] || 0.5, { k: 1 }) : h;
  }
  // Destroyer torpedo attack on a battleship or carrier (scored only as a flotilla: another own DD near, see
  // ships_ai.js score). Wait outside the launch distance until a second destroyer is on the same quarry, then
  // run in from the flank (alternate sides by flotilla slot, so the pair come from different angles), launch
  // beam-on at the doctrine's launch distance, then turn away for RUN_OUT s. Never inside the capital ship's
  // secondaries, never inside CV_KEEP of a carrier: no ram-closing.
  function torpedoRun(ship, t, o, B, d, b) {
    const a = ship.ai, tp = ship.stats.torpedoes, now = WW.time.now;
    const L = tp.range * (B && WW.nightOps ? WW.nightOps.torpK(B, 0.6 + 0.3 * B.doctrine.torpedo) : B ? 0.6 + 0.3 * B.doctrine.torpedo : 0.8), sec = t.stats.guns[1] || t.stats.guns[0];
    const minD = Math.max(L * 0.8, (sec ? sec.range : 60) + 8, t.type === 'carrier' && !fair(ship, t, B) ? CV_KEEP : 0);
    if (o && o.group === 'flotilla') a.orbitDir = o.slot % 2 ? -1 : 1;
    let h;
    ship.throttle = 1;
    if (a.runOut > now) h = b + PI + a.orbitDir * 0.5;                       // spread away: open out
    else if (a.torpReload > 0 || !mate(ship, t, L * 1.8)) { const R = L * 1.35; h = b + a.orbitDir * (d > R ? 0.6 : d < R * 0.85 ? 2.2 : PI / 2); ship.throttle = 0.85; }
    else if (d > L) h = b + a.orbitDir * 0.45;                               // run in from the flank
    else h = b + a.orbitDir * PI / 2;                                        // beam on: torpedoes() launches
    if (d < minD) h = b + PI + a.orbitDir * 0.6;
    ship.desiredHeading = WW.threat && B ? WW.threat.bestHeading(ship, h, B.doctrine.risk.destroyer || 0.5, { k: 0.6 }) : h;
  }
  // another own destroyer (fit, not hunting a sub) within r of the quarry: the flotilla attacks together
  function mate(ship, t, r) {
    for (const s of WW.world.ships) {
      if (s === ship || !s.alive || s.nation !== ship.nation || s.type !== 'destroyer' || s.ai && s.ai.withdrawing) continue;
      if (WW.dist2(s.x, s.z, t.x, t.z) < r * r) return true;
    }
    return false;
  }
  // Torpedoes: launch inside (0.6 + 0.3 x doctrine torpedo emphasis) of torpedo range on a current detection
  // (fireSpread holds fire when an ally is in the fan). A destroyer then turns away (torpedoRun).
  function torpedoes(ship, t, B) {
    const st = ship.stats, a = ship.ai;
    if (!st.torpedoes || a.torpReload > 0 || t.submerged || t.type === 'submarine') return; // a sub is depth-charged or shot, not torpedoed
    const d = WW.dist(ship.x, ship.z, t.x, t.z), k0 = B ? 0.6 + 0.3 * B.doctrine.torpedo : 0.8, k = B && WW.nightOps ? WW.nightOps.torpK(B, k0) : k0; // night: longer reach
    if (d < st.torpedoes.range * k && d > 12 && seen(ship, t) && H.fireSpread(ship, t) && ship.type === 'destroyer') a.runOut = WW.time.now + RUN_OUT;
  }

  // ---- press, support and safety layers ----
  // Pressing with nothing in sight: the nearest last-known enemy that is worth a gun ship's run (never a carrier:
  // a lone carrier is left to retire; battleships and cruisers ignore PT boats). Cached for 1 s.
  function pressContact(ship) {
    const a = ship.ai, now = WW.time.now;
    if (a.pcT > now) return a.pc && a.pc.unit && a.pc.unit.alive ? a.pc : null;
    a.pcT = now + 1; a.pc = null;
    if (!WW.intel) return null;
    let bd = 1e9;
    const cs = WW.intel.enemyShips(ship.nation), cvs = [], W = WW.cfg.MAP_W, foeHome = ship.nation === 'USN' ? W : 0;
    for (const c of cs) if (c.unit && c.unit.alive && c.unit.type === 'carrier' && now - c.seenAt <= PRESS_AGE) cvs.push(c);
    for (const c of cs) {
      const u = c.unit;
      if (!u || !u.alive || u.submerged || u.type === 'carrier' || u.type === 'submarine' || now - c.seenAt > PRESS_AGE) continue;
      if (BIG[ship.type] && u.type === 'pt') continue;
      if (cvs.some(k => WW.dist2(k.x, k.z, c.x, c.z) < CV_LAIR * CV_LAIR)) continue; // not into the enemy carrier's lair
      if (Math.abs(c.x - foeHome) < W * HOME_K) continue;                             // nor into its home waters
      const d = WW.dist(ship.x, ship.z, c.x, c.z);
      if (d < bd) { bd = d; a.pc = c; }
    }
    return a.pc;
  }
  // Pressing: a target out of gun range inside the enemy's home waters is not chased (the press holds at the edge
  // of that band; a broken enemy that gets home retires, main.js).
  function homeWaters(ship, t, B) {
    if (!B || B.posture !== 'press' || !t) return false; // (not while pursuing: a broken enemy is run down to its edge)
    const W = WW.cfg.MAP_W, foeHome = ship.nation === 'USN' ? W : 0, g = ship.stats.guns[0];
    return Math.abs(t.x - foeHome) < W * HOME_K && WW.dist(ship.x, ship.z, t.x, t.z) > (g ? g.range : 60);
  }
  // Pursuing: aim ahead of a running contact, where it will be when we get there (at most 60 s on).
  function closeOn(ship, c, B, pursuit) {
    const lead = pursuit ? WW.dist(ship.x, ship.z, c.x, c.z) / ship.stats.speed : 0;
    const age = Math.min(pursuit ? 60 : 20, WW.time.now - c.seenAt + lead), px = c.x + Math.cos(c.heading) * c.speed * age, pz = c.z + Math.sin(c.heading) * c.speed * age;
    ship.throttle = 1;
    const want = Math.atan2(pz - ship.z, px - ship.x);
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, B.doctrine.risk[ship.type] || 0.5) : want;
  }
  // AA cover: while the commander reports an air raid on an own carrier, cruisers (and a battleship of the carrier
  // group) within RAID_R that have nothing in gun range close on the carrier's AA umbrella.
  function aaCover(ship, t, o, B) {
    const R = B && B.airRaid, cv = R && R.carrier;
    if (!cv || !cv.alive || ship.type === 'destroyer' || (ship.type === 'battleship' && !(o && o.group === 'carrier'))) return false;
    const d = WW.dist(ship.x, ship.z, cv.x, cv.z);
    if (d > RAID_R || d < RAID_CLOSE) return false;
    if (t && WW.dist(ship.x, ship.z, t.x, t.z) <= ship.stats.guns[0].range) return false;
    ship.throttle = 1;
    const want = Math.atan2(cv.z - ship.z, cv.x - ship.x);
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, B.doctrine.risk[ship.type] || 0.5) : want;
    return true;
  }
  // the commander's ASW screen (and a carrier escort) hunts subs out to twice SUB_HUNT
  function aswRole(ship) { const o = WW.fleetCmd && WW.fleetCmd.order(ship); return !!o && (o.role === 'asw' || o.role === 'escort'); }
  function subNearAlly(ship, a) {
    if (a.subD > SUB_HELP_R) return false;
    const c = a.subC;
    for (const s of WW.world.ships) if (s !== ship && s.alive && s.nation === ship.nation && s.type !== 'submarine' && WW.dist2(s.x, s.z, c.x, c.z) < SUB_HELP * SUB_HELP) return true;
    return false;
  }
  // Big ships: an enemy torpedo track seen anywhere by the side (escorts' sightings, WW.intel.torpedoes) that
  // will pass close inside WARN: turn parallel early (a battleship needs ~7 s to swing 90 deg); the core comb
  // (ships_ai.js, 70 units) then holds it.
  function earlyComb(ship) {
    const W = WARN[ship.type];
    if (!W || !WW.intel || !WW.intel.torpedoes) return;
    const T = WW.intel.torpedoes(ship.nation), L = ship.stats.length * 0.5 + 8, now = WW.time.now;
    for (let i = 0; i < T.length; i++) {
      const e = T[i];
      if (now - e.firstSeenAt < REACT[ship.type]) continue;
      const dt = now - e.seenAt, c = Math.cos(e.h), s = Math.sin(e.h);
      const rx = ship.x - (e.x + c * e.speed * dt), rz = ship.z - (e.z + s * e.speed * dt);
      const along = rx * c + rz * s, perp = Math.abs(-rx * s + rz * c);
      if (along < 0 || along > W || perp > L + along * 0.25) continue;
      ship.desiredHeading = Math.abs(WW.angleDiff(ship.heading, e.h)) < PI / 2 ? e.h : e.h + PI;
      return;
    }
  }
  // Battleship: a known torpedo boat (DD / PT, seen in the last 5 s) inside 1.1x its torpedo range with us in its
  // bow arc: angle bow or stern on to it (a narrow target for the spread). Trades some broadside for safety.
  function angleOnBoats(ship) {
    if (!WW.intel) return;
    const now = WW.time.now;
    for (const c of WW.intel.enemyShips(ship.nation)) {
      const u = c.unit;
      if (!u || !u.alive || (u.type !== 'destroyer' && u.type !== 'pt') || now - c.seenAt > 5 || !u.stats.torpedoes) continue;
      const d = WW.dist(ship.x, ship.z, c.x, c.z);
      if (d > u.stats.torpedoes.range * 1.1) continue;
      const toUs = Math.atan2(ship.z - c.z, ship.x - c.x);
      if (Math.abs(WW.angleDiff(c.heading, toUs)) > 1.0) continue;
      const b = toUs + PI, ax = Math.abs(WW.angleDiff(ship.desiredHeading, b)) < PI / 2 ? b : toUs; // bow on or stern on
      ship.desiredHeading = Math.atan2(Math.sin(ship.desiredHeading) + 1.2 * Math.sin(ax), Math.cos(ship.desiredHeading) + 1.2 * Math.cos(ax));
      return;
    }
  }
  // Cripple withdrawal (replaces the core's h.withdraw for surface ships): below WW.fleetGroups.CRIP hp, head home
  // (behind the own carrier, else the own map edge) at full speed, pushed away from every known enemy that could
  // shoot (contacts <= 45 s old within 1.2 x its gun range + 20), through the safest heading. Home first: a cripple
  // that only ran from the nearest enemy could end up deep on the enemy's side, cornering the enemy carrier.
  function crippleHome(ship) {
    const crip = WW.fleetGroups ? WW.fleetGroups.CRIP : 0.35, a = ship.ai, now = WW.time.now;
    if (ship.hp >= crip * ship.maxHp) return false;
    let ax = 0, az = 0, n = 0;
    if (WW.intel) for (const c of WW.intel.enemyShips(ship.nation)) {
      const u = c.unit;
      if (!u || !u.alive || u.submerged || now - c.seenAt > 45) continue;
      const r = u.isBase ? (u.stats.guns[0] ? u.stats.guns[0].range + 10 : 0) : (u.stats.guns[0] ? u.stats.guns[0].range : 60) * 1.2 + 20, d = WW.dist(ship.x, ship.z, c.x, c.z); // the island base: only its own gun reach
      if (d > r || d < 1) continue;
      const w = 1.2 - d / r;
      ax += (ship.x - c.x) / d * w; az += (ship.z - c.z) / d * w; n++;
    }
    const W = WW.cfg.MAP_W, east = ship.nation !== 'USN', cv = a.cv && a.cv !== ship && a.cv.alive ? a.cv : null;
    const hx = cv ? cv.x + (east ? 60 : -60) : east ? W - 60 : 60, hz = cv ? cv.z : WW.clamp(ship.z, 120, WW.cfg.MAP_H - 120);
    const hd = WW.dist(ship.x, ship.z, hx, hz);
    if (hd > 30) { const k = n ? 0.7 : 1; ax += (hx - ship.x) / hd * k; az += (hz - ship.z) / hd * k; }
    const sh = n && WW.weather ? WW.weather.shelter(ship.x, ship.z, 160, 20) : null; // hide in a rain squall (weather.js)
    if (sh) { const sd = WW.dist(ship.x, ship.z, sh.x, sh.z); if (sd > 15) { ax += (sh.x - ship.x) / sd * 0.8; az += (sh.z - ship.z) / sd * 0.8; } }
    if (Math.abs(ax) + Math.abs(az) < 1e-3) return false;
    const want = Math.atan2(az, ax);
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0, { k: 3 }) : want;
    ship.throttle = hd > 30 || n ? 1 : 0.5;
    a.withdrawing = true;
    return true;
  }
  // Never close inside CV_KEEP of a known enemy carrier (contact <= 10 s old): steer off it. Pursuing, a carrier
  // that is fair game (crippled, slowed or unescorted: ai_endgame.js) is run down instead.
  function fair(ship, cv, B) { return !!(WW.endgameAI && WW.endgameAI.fairGame(ship, cv, B)); }
  function keepOffCarriers(ship) {
    if (!WW.intel) return;
    const now = WW.time.now, B = WW.fleetCmd && WW.fleetCmd.side(ship.nation);
    for (const c of WW.intel.enemyShips(ship.nation)) {
      const u = c.unit;
      if (!u || u.type !== 'carrier' || !u.alive || now - c.seenAt > 10 || fair(ship, u, B)) continue;
      const age = WW.time.now - c.seenAt, px = c.x + Math.cos(c.heading) * c.speed * age, pz = c.z + Math.sin(c.heading) * c.speed * age;
      const d = WW.dist(ship.x, ship.z, px, pz);
      if (d < CV_KEEP * 1.15) ship.desiredHeading = blend(ship.desiredHeading, ship, 2 * ship.x - px, 2 * ship.z - pz, d < CV_KEEP ? 6 : 1.5);
    }
  }

  WW.shipAI.roles.surface = surfaceAI;
  WW.shipAI.surface = { followStation, prefRange, engage, torpedoes, torpedoRun, pressContact }; // seams for the role agents
})();
