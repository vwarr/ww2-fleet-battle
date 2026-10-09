// fleet_groups.js - WW.fleetGroups: the commander's tables (fleet_cmd.js uses them). Doctrine per nation
// (rolled per round with WW.rand), group assignment (each ship gets a group and role), and formation station
// points relative to the group's guide and the side's axis of advance. Pure functions over the blackboard.
window.WW = window.WW || {};
(function () {
  'use strict';
  // Doctrine: USN carrier-centric gunnery at long range; IJN torpedo-aggressive, closes in (night-fighting style).
  //   aggression   0..1  how readily the side engages and presses (approach speed, press threshold)
  //   rangeFrac    BB/CA preferred gun range as a fraction of main battery range
  //   torpedo      0..1  torpedo emphasis: launch distance (x torpedo range) and the flotilla's size
  //   carrier      0..1  carrier emphasis: strike tempo
  //   night        0..1  night-fighting style: how much closer the side fights when it presses, and after dark
  //                       (night_ops.js: closer range, longer torpedo reach, readier to press)
  //   nightEye     0..1  visual range in full dark, x the day range (lookouts, night optics; night_ops.js visK)
  //   radar        0..1  surface search radar on BB / CA / DD (> 0.5: fitted; night_ops.js radarR)
  //   searchlight  0..1  share of the side's BB / CA / DD that use searchlights at night (night_ops.js)
  //   cvStandoff   carrier station distance behind the main body
  //   screenAhead  ASW screen distance ahead of the main body
  //   flotilla     destroyers in the torpedo flotilla (the rest screen / escort)
  //   pressRatio   known strength ratio needed to press late in the round; withdrawRatio: below it, withdraw
  //   risk         per-type risk tolerance 0..1 for WW.threat.bestHeading (carrier 0: never into danger)
  //   damageControl  divides torpedo flooding, engine-room repair time and the chance an engine-room hit is for good
  //                (ship_speed.js); puts fires out sooner, spreads them less, and above 1.15 pumps flooding out and
  //                patches minor damage (ship_fires.js); USN 1.5: its damage-control training was the better of the two
  //   avgas        chance factor that a bomb on a loaded flight deck sets off the fuel and ordnance (ship_fires.js);
  //                USN 0.8: fuel lines drained and CO2-purged under attack, ordnance struck below
  //   escortCharge how readily the carrier's destroyers charge an enemy gun ship closing on it (ai_charge.js); USN 1
  //                (Samar), IJN 0.6
  //   rescue       (flag) destroyers pick up survivors of sunk ships and ditched aircrew, escort cripples home once
  //                broken, and the fleet leaves only with its survivors aboard (endgame.js, ai_endgame.js)
  //   reportErr    air sighting reports (intel.js): position error per unit of the observer's range; misId: chance
  //                to report the wrong type (cruiser -> carrier...). IJN 0.07 / 0.12: its observers were the better
  //                trained early in the war; USN 0.09 / 0.18 (the Midway PBY and SBD reports)
  //   patrol*      long-range flying boats (air_patrol.js): standoff from the shadowed ship, time on station (s),
  //                mean s between patrols after the first, bombs carried (IJN 2: a Mavis may bomb a lone ship; it
  //                shadows closer and longer)
  //   scuttle      (flag) once broken, every ship runs home at its best speed; a slowed cripple about to be caught
  //                may be scuttled
  //   jointStrike  the first deck loads of all the side's carriers form up together into one strike (Kido Butai)
  //   followUp     later strikes: 'deckload' (each carrier's load goes once it is all up, no form-up orbit) or
  //                'squadron' (each squadron goes as soon as it is up: USN 1942, Midway-style, less coordinated)
  //   reserveFrac  share of the strike aircraft held back, armed for ships, until enemy carriers are found (Nagumo)
  //   pursuitReserve share of the bombers a carrier keeps back from its follow-up strikes once the enemy battle line
  //                has been seen, for the strike on the beaten fleet (air_ops.js; Hiryu's second strike, the 4 June
  //                afternoon strike on Hiryu, Mikuma on 6 June): released when the enemy breaks or is about to
  //   ringR        AA ring radius of each carrier's escorts, on the threat axis (fleet_formation.js); 0: the old loose
  //                ring (~80). USN 35: the 1942 circular screen, the AA umbrella over the carrier
  //   ringDD       destroyers per carrier in its ring (at least one); ringBB (flag): a side with two or more
  //                battleships gives one to the carrier's ring (USN: North Carolina with Enterprise, Eastern Solomons)
  //   vanguard     search / approach / engage: the carriers hold this x map width behind the main body, the surface force
  //                running ahead as pickets and bait (IJN 0.33: Kido Butai's vanguard at Santa Cruz); 0: cvStandoff
  //   zigzag       zigzag plan scale under sub threat (fleet_formation.js; both navies zigzagged)
  //   subLine      (flag) submarines form a patrol line across the enemy's predicted approach (IJN; USN subs
  //                patrol the flank)
  //   subCV        sub ambush weight of a carrier contact (IJN 2.2: carriers above all); subNear: the time scale (s) of
  //                the reach discount (USN 25: the nearest worthwhile target); subShadow (flag, IJN): shadow what it
  //                cannot get ahead of; lifeguard (flag, USN): surfaced boats pick up survivors and aircrew (ai_sub_roles.js)
  //   aaAmmo       AA ammunition factor (ship_supply.js; USN 1.25: deeper ready-use allowances); ddFuel: destroyer fuel
  //                factor (USN 1.1: longer legs); torpReloads: reload sets for destroyer / cruiser tubes (IJN 1, USN 0)
  // Torpedo performance per nation (range, speed, dud rate, wake sighting) is a stat table: core.js WW.TORPEDO_NATION.
  //   air          air style (an object, not rolled; air_cap.js, air_attack.js): cap 'picket' (USN: radar-vectored pickets
  //                out on the threat bearing, high and low bands) | 'overhead' (IJN: Zeros over the fleet, reacting to
  //                lookouts); press0 / pressT: how hard the strike presses its attack (1 = veterans: low release, close
  //                drop), rising from press0 to 1 over pressT s and with the first strike flown; x the admiral's aggression;
  //                sweep: the second escort element flies ahead of the strike to take on the CAP
  //   (jointStrike, followUp, reserveFrac, pursuitReserve, patrolBombs and air are not rolled: they are doctrine, not tuning)
  var BASE = {
    USN: { aggression: 0.5, rangeFrac: 0.84, torpedo: 0.35, carrier: 0.8, night: 0.2, nightEye: 0.3, radar: 1, searchlight: 0.15, cvStandoff: 230, screenAhead: 70, flotilla: 1,
      pressRatio: 1.2, withdrawRatio: 0.45, damageControl: 1.5, avgas: 0.8, escortCharge: 1, rescue: true, scuttle: false, reportErr: 0.09, misId: 0.18,
      jointStrike: false, followUp: 'squadron', reserveFrac: 0.2, pursuitReserve: 0.4,
      ringR: 35, ringDD: 2, ringBB: true, vanguard: 0, zigzag: 1, subLine: false, subCV: 1, subNear: 25, subShadow: false, lifeguard: true,
      aaAmmo: 1.25, ddFuel: 1.1, torpReloads: 0,
      patrolStandoff: 122, patrolShadowT: 110, patrolEvery: 215, patrolBombs: 0,
      air: { cap: 'picket', press0: 0.35, pressT: 160, sweep: true },
      risk: { carrier: 0, battleship: 0.55, cruiser: 0.45, destroyer: 0.45, submarine: 0.35, pt: 0.2 } },
    IJN: { aggression: 0.65, rangeFrac: 0.78, torpedo: 0.8, carrier: 0.55, night: 0.8, nightEye: 0.5, radar: 0, searchlight: 0.8, cvStandoff: 200, screenAhead: 60, flotilla: 2,
      pressRatio: 1.1, withdrawRatio: 0.4, damageControl: 1, avgas: 1, escortCharge: 0.6, rescue: false, scuttle: true, reportErr: 0.07, misId: 0.12,
      jointStrike: true, followUp: 'deckload', reserveFrac: 0.4, pursuitReserve: 0.4,
      ringR: 0, ringDD: 1, ringBB: false, vanguard: 0.33, zigzag: 1, subLine: true, subCV: 2.2, subNear: 40, subShadow: true, lifeguard: false,
      aaAmmo: 1, ddFuel: 1, torpReloads: 1,
      patrolStandoff: 104, patrolShadowT: 150, patrolEvery: 215, patrolBombs: 2,
      air: { cap: 'overhead', press0: 1, pressT: 0, sweep: true },
      risk: { carrier: 0, battleship: 0.5, cruiser: 0.55, destroyer: 0.6, submarine: 0.4, pt: 0.3 } }
  };
  var FIXED = { jointStrike: 1, followUp: 1, reserveFrac: 1, pursuitReserve: 1, patrolBombs: 1, ringDD: 1, torpReloads: 1, air: 1 }; // doctrine fields that are not rolled
  var JITTER = 0.1; // +-10% per round on every numeric parameter (risk.carrier stays 0)
  function rollDoctrine(nation) {
    var b = BASE[nation] || BASE.USN, d = { nation: nation, risk: {} }, k, j = function () { return 1 + JITTER * (WW.rand() * 2 - 1); };
    for (k in b) if (typeof b[k] === 'number' && !FIXED[k]) d[k] = b[k] * j();
    for (k in FIXED) d[k] = b[k];
    for (k in b.risk) d.risk[k] = WW.clamp(b.risk[k] * j(), 0, 1);
    d.rangeFrac = WW.clamp(d.rangeFrac, 0.7, 0.92); d.flotilla = b.flotilla; d.risk.carrier = 0; d.rescue = !!b.rescue; d.scuttle = !!b.scuttle;
    d.ringBB = !!b.ringBB; d.subLine = !!b.subLine; d.subShadow = !!b.subShadow; d.lifeguard = !!b.lifeguard;
    d.pressRatio = Math.max(1.02, d.pressRatio); // only a stronger side presses
    d.aggression = WW.clamp(d.aggression, 0, 1); d.torpedo = WW.clamp(d.torpedo, 0, 1); d.carrier = WW.clamp(d.carrier, 0, 1); d.night = WW.clamp(d.night, 0, 1); d.searchlight = WW.clamp(d.searchlight, 0, 1); d.nightEye = WW.clamp(d.nightEye, 0.1, 1);
    for (k in DSET) if (k.split('.')[0] === nation) d[k.split('.')[1]] = DSET[k];
    return d;
  }
  // Test hook (balance A/B runs, Q=dset=USN.rangeFrac:0.9,IJN.torpReloads:0): a doctrine field set after the roll
  var DSET = {}, mq = typeof location !== 'undefined' && /[?&]dset=([^&]*)/.exec(location.search);
  if (mq) decodeURIComponent(mq[1]).split(',').forEach(function (kv) { var p = kv.split(':'); if (p.length === 2) DSET[p[0]] = +p[1]; });

  var CV_LO = 0.2, CV_HI = 0.33; // carrier station band, share of the width in from its own edge
  var CV_SAFE = 0.06;            // cvSafe slides the station home no closer than this to the own edge (was 0.06: a carrier parked
                                 // on its edge was off the map within seconds of a break, out of any pursuit's reach)
  var CRIP = 0.35; // below this hp share a ship withdraws (ships_ai.js reads WW.fleetGroups.CRIP too)
  // Groups: main (battle line), carrier (CV + escorts), screen (ASW, ahead of main), flotilla (torpedo DDs),
  // pt (ambush), sub (patrol). Roles: line, carrier, escort, asw, torpedo, ambush, patrol, withdraw.
  function assign(B, ships) {
    var G = B.groups, k, cvs = [], bbs = [], cas = [], dds = [], pts = [], subs = [];
    for (k in G) G[k].members.length = 0;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.nation !== B.nation) continue;
      ({ carrier: cvs, battleship: bbs, cruiser: cas, destroyer: dds, pt: pts, submarine: subs })[s.type].push(s);
    }
    var put = function (s, g, role) {
      G[g].members.push(s);
      var o = B.orders.get(s.id) || { ship: s, sx: s.x, sz: s.z };
      o.group = g; o.role = (s.hp < CRIP * s.maxHp && s.type !== 'submarine') || (WW.supply && WW.supply.spent(s)) ? 'withdraw' : role; // spent: ship_supply.js o.slot = G[g].members.length - 1; o.t = B.t;
      B.orders.set(s.id, o);
    };
    // carrier escorts (fleet_formation.js ringCounts: doctrine ringBB / ringDD): big ships first, so the first ring
    // slot (on the threat axis) gets the heaviest AA
    var rc = WW.formation ? WW.formation.ringCounts(B, cvs.length, bbs.length, cas.length, dds.length) : { bb: 0, ca: cvs.length && cas.length > 1 ? 1 : 0, dd: cvs.length ? 1 : 0 };
    cvs.forEach(function (s) { put(s, 'carrier', 'carrier'); });
    bbs.forEach(function (s, n) { if (n < rc.bb) put(s, 'carrier', 'escort'); else put(s, 'main', 'line'); });
    cas.forEach(function (s, n) { if (n < rc.ca) put(s, 'carrier', 'escort'); else put(s, 'main', 'line'); });
    var fl = 0;
    dds.forEach(function (s, n) {
      if (n < rc.dd) put(s, 'carrier', 'escort');
      else if (G.screen.members.length === 0 || fl >= B.doctrine.flotilla) put(s, 'screen', 'asw');
      else { put(s, 'flotilla', 'torpedo'); fl++; }
    });
    pts.forEach(function (s) { put(s, 'pt', 'ambush'); });
    subs.forEach(function (s) { put(s, 'sub', 'patrol'); });
    B.orders.forEach(function (o, id) { if (!o.ship.alive) B.orders.delete(id); });
    if (WW.formation) WW.formation.tagRing(B, cvs);
  }

  function centroid(list, out) {
    var x = 0, z = 0, n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].alive) { x += list[i].x; z += list[i].z; n++; }
    if (!n) return null;
    out.x = x / n; out.z = z / n; return out;
  }
  // Station points. Offsets are (forward f, lateral l) along the axis of advance B.axis.h from the guide.
  var RING = [[80, 0], [40, -70], [40, 70], [-60, -55], [-60, 55]];        // carrier escorts (radius ~80: SPACE.carrier is 70)
  var LINE = [0, -45, 45, -90, 90, -135, 135];                              // battle line, lateral slots
  // Carrier station safety: no closer than 1.9 x gun range + 20 to any known enemy gun ship (contacts up to 60 s
  // old): the station slides straight away from it (then back into the band x0..x1 and 80 off the north / south
  // edges). Keeps a pressing or advancing side from leading its carrier toward the enemy's guns.
  function cvSafe(B, p, x0, x1) {
    if (!WW.intel) return;
    var cs = WW.intel.enemyShips(B.nation), now = WW.time.now, H = WW.cfg.MAP_H;
    for (var pass = 0; pass < 2; pass++) for (var i = 0; i < cs.length; i++) {
      var c = cs[i], u = c.unit;
      if (!u || !u.alive || u.submerged || u.type === 'carrier' || !u.stats.guns.length || now - c.seenAt > 60) continue;
      var R = u.stats.guns[0].range * 1.9 + 20, d = WW.dist(p.x, p.z, c.x, c.z);
      if (d >= R || d < 1) continue;
      p.x = WW.clamp(c.x + (p.x - c.x) / d * R, x0, x1); p.z = WW.clamp(c.z + (p.z - c.z) / d * R, 80, H - 80);
    }
  }
  function stations(B) {
    var G = B.groups, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, h = B.axis.h, c = Math.cos(h), s = Math.sin(h);
    var lead = { search: 45, approach: 45, engage: 0, press: 35, pursue: 60, withdraw: -45 }[B.posture] || 0;
    var van = WW.formation ? WW.formation.vanguardBack(B, 0) > 0 : false; // IJN vanguard: the line pushes on ahead
    if (van && B.posture !== 'engage') lead += 35;
    // guides: the main body's centroid, else the first group that has ships
    // (withdrawing cripples are left out of the main guide: they would drag the battle line home with them)
    var fitMain = G.main.members.filter(function (q) { var o = B.orders.get(q.id); return !o || o.role !== 'withdraw'; });
    var mg = centroid(fitMain, G.main.guide) || centroid(G.screen.members, G.main.guide) || centroid(G.flotilla.members, G.main.guide) || centroid(G.carrier.members, G.main.guide)
      || centroid(G.pt.members, G.main.guide) || centroid(G.sub.members, G.main.guide); // a PT / sub-only side still gets stations
    if (!mg) return;
    B.axis.x = mg.x; B.axis.z = mg.z;
    for (var k in G) if (k !== 'main' && !centroid(G[k].members, G[k].guide)) { G[k].guide.x = mg.x; G[k].guide.z = mg.z; }
    var cv = G.carrier.members.filter(function (q) { return q.type === 'carrier'; });
    var cvg = cv.length ? cv[0] : null, ownX = B.nation === 'USN' ? 0 : W, half = W / 2;
    var at = function (gx, gz, f, l) { return { x: WW.clamp(gx + c * f - s * l, 30, W - 30), z: WW.clamp(gz + s * f + c * l, 30, H - 30) }; };
    var set = function (q, p) { var o = B.orders.get(q.id); if (o) { o.sx = p.x; o.sz = p.z; } };
    // main body: line abreast across the axis, advancing by `lead`
    G.main.members.forEach(function (q, i) { set(q, at(mg.x, mg.z, lead, LINE[i % LINE.length])); });
    // carriers: cvStandoff behind the main body (never ahead of it); escorts in a ring around the first carrier
    var back = B.doctrine.cvStandoff * (B.posture === 'search' ? 0.8 : 1);
    if (WW.formation) back = WW.formation.vanguardBack(B, back); // IJN: the surface vanguard well ahead of the carriers
    var ci = 0;
    G.carrier.members.forEach(function (q) {
      if (q.type === 'carrier') {
        // with no battle line to hide behind: a fixed home in its own fifth of the map (never trails the destroyers)
        const p = G.main.members.length ? at(mg.x, mg.z, -back, (ci ? 60 : 0) * (ci % 2 ? -1 : 1))
          : { x: ownX === 0 ? W * 0.2 : W * 0.8, z: WW.clamp(q.z, 150, H - 150) + (ci ? 80 : 0) };
        ci++;
        // in its own band of the map (0.15-0.35 of the width from its own edge) and 150 off the north / south edges:
        // room to run in every direction
        // a side that has broken off (withdraw) takes its carrier home, close to its own edge (main.js retire)
        // CV_LO..CV_HI of the width in from its own edge, withdrawing or not: a broken side's carrier then has a long
        // run home (ai_endgame.js), and a pursuer a real window to catch it (user, Oct 2026); the IJN vanguard (fleet_formation.js) keeps to this band too
        var wd = B.posture === "withdraw", lo = CV_LO, hi = CV_HI; // withdrawing too: the run home starts at the break (ai_endgame.js)
        if (wd) p.z = q.z; // straight home, not across the front
        p.x = ownX === 0 ? WW.clamp(p.x, W * lo, W * hi) : WW.clamp(p.x, W * (1 - hi), W * (1 - lo)); p.z = WW.clamp(p.z, wd ? 100 : 150, H - (wd ? 100 : 150));
        cvSafe(B, p, ownX === 0 ? W * CV_SAFE : W * (1 - CV_HI - 0.02), ownX === 0 ? W * (CV_HI + 0.02) : W * (1 - CV_SAFE)); // safety may slide it home, not onto the edge
        set(q, p); return;
      }
      if (!WW.formation) { var r = RING[(G.carrier.members.indexOf(q) - cv.length) % RING.length], g = cvg || q, rk = WW.admirals && cvg ? WW.admirals.ringK(cvg) : 1; set(q, at(g.x, g.z, r[0] * rk, r[1] * rk)); } // rk: the flagship's escorts close in
    });
    if (WW.formation) { WW.formation.ringStations(B, set, at); WW.formation.zigzag(B); }
    G.screen.members.forEach(function (q, i) { set(q, at(mg.x, mg.z, lead + B.doctrine.screenAhead, LINE[i % LINE.length] * 1.2)); });
    G.flotilla.members.forEach(function (q, i) { set(q, at(mg.x, mg.z, lead + 30, (i % 2 ? -1 : 1) * (110 + 25 * (i >> 1)))); });
    // PT boats: own-side flanks, never past the midline; subs: out on the flank of the enemy's approach
    G.pt.members.forEach(function (q, i) {
      var p = at(mg.x, mg.z, 60, (i % 2 ? -1 : 1) * (150 + 30 * (i >> 1)));
      p.x = ownX === 0 ? Math.min(p.x, half - 40) : Math.max(p.x, half + 40); set(q, p);
    });
    // subs: out on the flank of the enemy's approach; doctrine subLine (IJN): a patrol line across it, 90 apart,
    // a little over half way to the enemy's known centre (220 ahead with none known)
    var nsub = G.sub.members.length, ec = B.enemyCentre;
    var sf = B.doctrine.subLine && ec ? WW.clamp(0.55 * WW.dist(mg.x, mg.z, ec.x, ec.z), 160, 320) : 220;
    G.sub.members.forEach(function (q, i) { set(q, B.doctrine.subLine ? at(mg.x, mg.z, sf, (i - (nsub - 1) / 2) * 90) : at(mg.x, mg.z, 220, (i % 2 ? -1 : 1) * 100)); });
    // withdrawing ships: behind their own carrier (or the main body)
    B.orders.forEach(function (o) {
      if (o.role !== 'withdraw' || o.ship.type === 'carrier') return; // a carrier keeps its own (safe) station
      var g = cvg && cvg !== o.ship ? cvg : mg, p = at(g.x, g.z, -70, 0);
      o.sx = p.x; o.sz = p.z;
    });
  }

  WW.fleetGroups = { BASE: BASE, CRIP: CRIP, rollDoctrine: rollDoctrine, assign: assign, stations: stations, centroid: centroid };
})();
