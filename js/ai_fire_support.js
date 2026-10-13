// ai_fire_support.js - WW.fireSupport: Force O's gunfire support at Omaha and Pointe du Hoc (P5 of
// docs/NORMANDY_PLAN.md). Sim code: no WW.rand of its own (the guns draw theirs in ships_ai.js). The ship role for
// every ship with a fire-support order (ship.fs, normandy.js composition): it replaces the Pacific search / strike
// roles (ships_ai.js update dispatches here), and the endgame never sends these ships home.
// The fire plan, on the compressed clock (normandy.js clock; H = H-hour 06:30):
//  - pre-planned fire, H-40 to H-5: each ship shells the strongpoints of its task list (fs.tasks) on their charted
//    positions (WN 75 at Pointe du Hoc for Texas), from its bombardment station (fs.far u off the waterline),
//    steaming a slow line along the coast. Ships out of reach of their task close along the coast until in range.
//  - the lift, H-5 to H+8: fire lifts inland (the troops are on the beach): the shells fall on the plateau behind
//    the bluffs (an inland aim point), where they only rattle the mortar crews.
//  - call fire, from H+8: shore fire control parties and spotting planes call targets: only elements that have shown
//    themselves (muzzle flashes, coast_defence.js revealed) are fired on, the ship's own tasks first; a spotted
//    element (spottedUntil) gets the tighter spotted dispersion (combat.js SPOT_DISP). Self-defence: a gun keeps an
//    enemy boat that retarget picked inside half its range.
//  - the destroyers close the beach from about H+60 (CLOSE_T): to fs.near (90-120 u, depth >= 4), and for a casemate
//    to a spot inside its embrasure arc (angled fire along the beach, the only fire that killed them on the day); they
//    take any element in sight within SEE_R, not only the revealed ones.
// Danger: the shore guns stamp the danger field (ai_threat.js); the role heads by it with RISK.far before the close
// and RISK.near after (the destroyer captains accepted the 88s at 1,000 yd).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const RETARGET = 2, LIFT0 = -3, CALL0 = 8, CLOSE_T = 150, SEE_R = 170, LEG = 40, SPOT_T = 6;
  const RISK = { far: 0.45, near: 0.95 };
  const SUP = { battleship: 400, cruiser: 600, destroyer: 900 };   // turret shots: a day's bombardment load
  const PRIO = { casemate: 5, battery: 4.5, gunpit: 4, tobruk: 3, bunker: 2.5, mg: 2, mortar: 2, flak: 1.5, wall: 0 };
  const now = () => WW.time.now;
  const N = () => WW.scenarios.normandy;
  const T = () => WW.normandyTerrain;
  const CD = () => WW.coastDefence;
  const rt = () => (WW.game ? WW.game.roundTime : 0);

  function phase() {
    const H = N().clock.H, t = rt();
    return t < H + LIFT0 ? 'pre' : t < H + CALL0 ? 'lift' : 'call';
  }
  const closing = ship => ship.type === 'destroyer' && rt() >= N().clock.H + CLOSE_T;
  const mainRange = ship => (ship.stats.guns[0] ? ship.stats.guns[0].range : 60);

  // an inland aim point behind the ship's first task (the lift): a dummy target the guns can lay on
  function liftPoint(ship) {
    const a = ship.ai, fs = ship.fs;
    if (!a.fsLift) {
      const w = CD().wnOf(fs.tasks[0]), x = w ? w.x : fs.x, z = T().bluffTopZ(x) + 70;
      a.fsLift = { isLand: true, isDef: true, isDummy: true, alive: true, x, z, y: Math.max(0, WW.terrain.heightRaw(x, z)), heading: 0, speed: 0, type: 'aimpoint', takeDamage() {} };
    }
    return a.fsLift;
  }
  function score(ship, e, own, d) {
    return (PRIO[e.type] || 1) * (own ? 2 : 1) / (1 + d / 150) * (e.revealUntil > now() ? 1.5 : 1);
  }
  function pick(ship) {
    const fs = ship.fs, ph = phase(), R = mainRange(ship), C = CD();
    if (!C || !C.elements.length) return null;
    if (ph === 'lift') return liftPoint(ship);
    const own = new Set(fs.tasks), close = closing(ship);
    let best = null, bs = 0;
    for (const e of C.elements) {
      if (!e.alive || e.dormant || e.type === 'wall') continue;
      const d = WW.dist(ship.x, ship.z, e.x, e.z), mine = own.has(e.wn.wid);
      if (ph === 'pre') { if (!mine) continue; }                          // the fire plan: the charted strongpoints of its tasks
      else if (!(e.revealUntil > now()) && !(close && d < SEE_R)) continue; // call fire: what has shown itself (or is in sight close in)
      const s = score(ship, e, mine, d) * (d <= R ? 1 : 0.35);             // in reach first; out of reach: worth moving for
      if (s > bs) { bs = s; best = e; }
    }
    return best;
  }

  // where to steer: the bombardment station, closed toward the target when it is out of reach, or the close-in spot
  function station(ship, tgt) {
    const fs = ship.fs, a = ship.ai, R = mainRange(ship);
    if (closing(ship) && tgt && !tgt.isDummy) return closeSpot(ship, tgt);
    let x = fs.x;
    if (tgt && !tgt.isDummy) { const d = WW.dist(ship.x, ship.z, tgt.x, tgt.z); if (d > R * 0.92) x = tgt.x; }   // close along the coast until in reach
    const z = T().shoreZ(x) - (closing(ship) ? fs.near || 100 : fs.far);
    if (!a.fsLeg || Math.abs(a.fsLeg.cx - x) > 1) a.fsLeg = { cx: x, dir: 1 };
    return { x: x + a.fsLeg.dir * LEG, z, leg: true };
  }
  // a destroyer's firing spot for element e: inside a casemate's embrasure arc, angled from the sea, in water deep
  // enough (depth >= minDepth + 1); an open position: straight off it
  function closeSpot(ship, e) {
    const a = ship.ai;
    if (a.fsSpot && a.fsSpot.e === e) return a.fsSpot;
    const need = ship.stats.minDepth + 1, near = ship.fs.near || 100;
    let bs = [-Math.PI / 2];
    if (e.K && e.K.wall) { const k = e.arc * 0.7; bs = [e.heading - k, e.heading + k].filter(b => Math.sin(b) < -0.2); if (!bs.length) bs = [-Math.PI / 2]; }
    let spot = null;
    for (const b of bs) for (let r = near; r <= 280 && !spot; r += 10) {
      const x = e.x + Math.cos(b) * r, z = e.z + Math.sin(b) * r;
      if (WW.terrain.depthAt(x, z) >= need && WW.terrain.depthAt(x, z - 15) >= need) spot = { x, z, e };
    }
    return (a.fsSpot = spot || { x: e.x, z: T().shoreZ(e.x) - near - 20, e });
  }

  function steer(ship, goal, dt) {
    const a = ship.ai, d = WW.dist(ship.x, ship.z, goal.x, goal.z);
    if (goal.leg && d < 12) { a.fsLeg.dir = -a.fsLeg.dir; }               // the slow line along the coast: turn at each end
    const want = Math.atan2(goal.z - ship.z, goal.x - ship.x);
    const risk = closing(ship) ? RISK.near : RISK.far;
    ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, risk, { k: 1 }) : want;
    ship.throttle = goal.leg ? (d > 60 ? 0.8 : 0.35) : d > 30 ? 1 : d > 8 ? 0.5 : 0.15;
  }

  function role(ship, dt) {
    const a = ship.ai;
    if (!ship.sup && WW.supply) { WW.supply.sup(ship); ship.sup.main = ship.sup.main0 = SUP[ship.type] || ship.sup.main; }
    a.fsT = (a.fsT || 0) - dt;
    if (a.fsT <= 0 || (a.fsTarget && !a.fsTarget.alive)) {
      a.fsT = RETARGET;
      const t = pick(ship);
      if (t !== a.fsTarget) a.fsSpot = null;
      a.fsTarget = t;
    }
    const t = a.fsTarget;
    steer(ship, station(ship, t), dt);
    // the guns: every mount on the target when it reaches; a boat close aboard keeps the mount retarget gave it
    const ct = a.calTarget || (a.calTarget = {});
    for (const g of ship.stats.guns) {
      const cur = ct[g.cal], self = cur && !cur.isLand && cur.alive && WW.dist(ship.x, ship.z, cur.x, cur.z) < g.range * 0.5;
      if (self) continue;
      ct[g.cal] = t && WW.dist(ship.x, ship.z, t.x, t.z) <= g.range ? t : null;
    }
    if (t && !t.isDummy && phase() === 'call') t.spottedUntil = Math.max(t.spottedUntil || 0, now() + SPOT_T);   // the spotting plane / SFCP on it
    ship.target = null;
  }
  // ships_ai.js guns(): may this ship fire on land target t (not an intel contact)? Its own fire-support target only
  function sees(ship, t) { return !!(ship.ai && ship.ai.fsTarget === t && t.alive); }

  WW.fireSupport = { role, sees, pick, phase, closing, CLOSE_T, RISK };
})(window.WW);
