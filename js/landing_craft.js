// landing_craft.js - WW.landingCraft: the landing craft at Omaha and Pointe du Hoc (P6 of docs/NORMANDY_PLAN.md).
// Sim code (WW.rand), Normandy only: every hook returns first in another scenario, and the roundStart listener draws
// nothing. Visuals: models_landing.js. Schedule: landing_waves.js.
// Craft are duck-typed land units, NOT in WW.world.ships (fleet_cmd, intel, endgame and tonnage never see them); the
// German guns pick them through WW.landTargets (coast_defence_fire.js) and hit them through the land_sites.js hitTest.
// A craft's life: 'run' from the line of departure (LOD u off the waterline) at its speed, drifting east on the flood
// current (CURRENT u/s; the coxswain steers back toward his lane with up to STEER u/s), through the obstacle belts (a mined obstacle may
// wreck it; the coxswain avoids those he can see, fewer once the rising tide covers them after TIDE_T) -> 'beached'
// where the water is as shallow as its draft -> 'ramp' (RAMP_T s) -> 'unload' (UNLOAD_RATE men a second; the tanks one by
// one) -> 'off' (backs off, turns and heads out) -> gone at the LOD. Hits: a shell does its damage to the hull; at 0 the
// craft is 'wrecked' and a share of the men aboard are lost (KILL_K by what hit it). DD tanks swim from far out
// (settings.dd 'far', as the 741st) and flood in the chop: each tank's leak (one draw at launch: how badly its screen
// struts buckle and the seas break over it, LEAK_A..LEAK_A+LEAK_B) fills it at FLOOD_K x leak a second while it is in
// deep water (s > 25 u: in the surf it soon has its tracks on the bottom); flood 1: it founders. Tuned so ~7% of the
// tanks swimming from 'far' reach the beach (27 of the 29 the 741st launched sank, on the day; most crews got out in
// their rafts). A DD that grounds drives straight out of the water: it is handed to infantry.js where it touches.
// Mortars: a craft beached inside an active mortar's zone may take a bomb (MORTAR_P a tick).
// DUKWs (the 111th FA's 105 mm howitzers, overloaded with the gun and sandbags) swim in from the LSTs like the DDs and flood
// faster (all but one of the 111th's swamped in the chop); ashore they drive out as vehicles (vehicles.js). The four
// fire-brigade ladder DUKWs at Pointe du Hoc stand off the cratered shingle with their ladders up ('ladder', LADDER_T s).
// Vehicle LCTs carry a cargo (landing_waves.js load: dozers, half-tracks, jeeps, trucks) unloaded one every TANK_T s.
// The beachmaster's halt (08:30, landing_waves.js HALT): a vehicle wave due after it 'hold's at the line of departure
// until a draw is open for vehicles (beach_engineers.js exits), then runs in to the open draw.
// The gap teams' marked lanes (beach_engineers.js): a craft on its run whose lane has a marked lane within LANE_SEEK
// steers for it (the coxswains could see the buoys and the flags), and corrects for the current once in sight of them.
// Named craft (NAMED): LCI(L)-91 struck a mined stake off Dog White (07:40), was hit again as the men went down the
// ramps, burned out on the beach and stayed there burning; LCI(L)-85 was holed by some 25 shells off Easy Red, the
// fire in her troop spaces, got off with her wounded, and sank offshore later (here 'adrift' ADRIFT_S out, then down
// after SINK_T s).
// Events: 'craftEvent' { kind: launched | beached | ramp | unloaded | wrecked | mined | foundered | holed | gone | held |
// released | struck | burning | adrift, craft },
// 'craftUnload' { craft, men, tanks, vehicles?, x, z, sector } once a second while unloading (P7 picks the men up as
// squads; vehicles.js the vehicles).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  // len / beam (u, true size x ~1.3 for the small boats), speed (u/s), hp, men, tanks, draft (the depth it grounds in)
  const CRAFT = {
    lcvp: { name: 'LCVP', len: 1.5, beam: 0.45, speed: 2.0, hp: 30, men: 30, tanks: 0, draft: 0.5, value: 3 },
    lca: { name: 'LCA', len: 1.7, beam: 0.45, speed: 1.8, hp: 35, men: 30, tanks: 0, draft: 0.5, value: 3 },
    lcm: { name: 'LCM', len: 1.9, beam: 0.6, speed: 1.6, hp: 45, men: 25, tanks: 0, draft: 0.6, value: 3.5 },
    lct: { name: 'LCT', len: 3.6, beam: 1.0, speed: 1.4, hp: 120, men: 6, tanks: 3, draft: 0.9, value: 5 },
    lci: { name: 'LCI(L)', len: 5.0, beam: 0.8, speed: 2.4, hp: 160, men: 90, tanks: 0, draft: 1.2, value: 6 },
    dd: { name: 'DD tank', len: 0.8, beam: 0.35, speed: 0.9, hp: 25, men: 0, tanks: 1, draft: 0, value: 4 },
    dukw: { name: 'DUKW', len: 1.25, beam: 0.33, speed: 1.15, hp: 22, men: 0, tanks: 0, draft: 0, value: 2.5 }
  };
  const LOD = 420, DD_FAR = 280, DD_CLOSE = 40;
  const CURRENT = 0.3, STEER = 0.36, RAMP_T = 2.5, UNLOAD_RATE = 6, TANK_T = 3, WAIT_T = 3, BACK_D = 25;
  const MINE_P = 0.55, HOLE_P = 0.25, AVOID_SEEN = 0.75, AVOID_COVERED = 0.2, TIDE_MIN = 60;   // TIDE_MIN: minutes after H the obstacles go under
  const KILL_K = { mine: 0.35, big: 0.6, med: 0.4, small: 0.25, mg: 0.05, bomb: 0.5, mortar: 0.2 };
  const DD_GROUND = 0.35, FLOOD_K = 0.0108, LEAK_A = 0.2, LEAK_B = 1.8, MORTAR_TICK = 0.5, MORTAR_P = 0.05, MORTAR_DMG = 22;
  const DUKW_FAR = 210, DUKW_FLOOD = 1.7, DUKW_GROUND = 0.3, LADDER_T = 150, LANE_SEEK = 40, LANE_SEE = 90, LANE_K = 0.5;
  const NAMED = { 'LCI(L)-91': { fate: 'mine', kill: 0.25 }, 'LCI(L)-85': { fate: 'shell', kill: 0.15 } };
  const SHELL_DT = 1.4, SHELL_DMG = 7, ADRIFT_S = 48, SINK_T = 190, HOLD_SPREAD = 9;
  const ID0 = 20000;
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, N = () => WW.scenarios.normandy;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let plan = [], fleetPlan = [], next = 0, craft = [], live = [], stats = null, nid = 0, mortT = 0, buckets = null;

  function newStats() { return { launched: 0, beached: 0, wrecked: 0, mined: 0, holed: 0, foundered: 0, menLanded: 0, menLost: 0, tanksLanded: 0, tanksLost: 0, gone: 0,
    vehLanded: 0, vehLost: 0, dukwLaunched: 0, dukwFoundered: 0, held: 0, released: 0, inLane: 0, bySector: {} }; }
  function secStat(s) { return stats.bySector[s] || (stats.bySector[s] = { craft: 0, men: 0, tanks: 0, lost: 0, wrecked: 0 }); }
  // the obstacles by x bucket (8 u), for the collision check
  function bucketize() {
    buckets = new Map();
    for (const o of T().obstacles) { const k = Math.floor(o.x / 8); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(o); }
  }
  function reset() {
    plan = []; fleetPlan = []; next = 0; craft = []; live = []; stats = newStats(); nid = 0; mortT = 0; buckets = null;
    if (!on() || !WW.landingWaves || !WW.normandyTerrain) return;
    const S = N().settings || {};
    plan = WW.landingWaves.expand().map(r => {
      const C = CRAFT[r.craft], s0 = r.craft === 'dd' ? (S.dd === 'close' ? DD_CLOSE : DD_FAR) : r.craft === 'dukw' && !r.ladder ? DUKW_FAR : LOD;
      const run = (s0 - 12) / C.speed;
      return Object.assign({}, r, { s0, spawnT: r.craft === 'dd' ? 0 : r.t - run });
    });
    plan.sort((a, b) => a.spawnT - b.spawnT || a.x - b.x);
    // what the transport area shows before the sim has a boat (normandy_fleet.js): not the DUKWs (off the LSTs)
    fleetPlan = plan.filter(r => r.craft !== 'dukw');
    bucketize();
  }

  function spawn(r, late) {
    const C = CRAFT[r.craft], T0 = T();
    const adv = Math.max(0, late) * C.speed;                       // a craft whose run began before the round: already on its way
    const s = Math.max(20, r.s0 - adv), x = r.x;
    const u = { isLand: true, isCraft: true, id: ID0 + nid++, nation: 'USN', type: r.craft, kind: r.craft, C, name: C.name, unit: r.unit, sector: r.sector, sectorName: r.sectorName,
      laneX: r.x, x, z: T0.shoreZ(x) - s, y: 0, heading: Math.PI / 2, speed: C.speed, hp: C.hp, maxHp: C.hp, alive: true, sinking: false, removed: false, submerged: false,
      state: 'run', stateT: rt(), men: C.men, tanks: C.tanks, men0: C.men, tanks0: C.tanks, value: C.value, rampDown: false, hitT: -1e9, seen: new Set(), wave: r.wave,
      stats: { length: C.len, beam: C.beam, guns: [], aa: null, tons: 300 },
      takeDamage(amount, hx, hz, kind, cal) { hit(this, amount, kind === 'bomb' ? 'bomb' : cal || 'small'); } };
    if (u.type === 'dd') { u.flood = 0; u.leak = LEAK_A + LEAK_B * WW.rand(); }
    if (u.type === 'dukw') { u.flood = 0; u.ladder = !!r.ladder; u.leak = u.ladder ? 0.1 : (LEAK_A + LEAK_B * WW.rand()) * DUKW_FLOOD; stats.dukwLaunched++; }
    u.gap = !!r.gap; u.named = r.named || null; u.burning = false;
    if (r.load) { u.cargo = []; for (const [k, n] of r.load) for (let i = 0; i < n; i++) u.cargo.push(k); u.tanks = 0; u.tanks0 = 0; u.cargo0 = u.cargo.length; }
    if (u.named) { u.name = u.named; u.N = NAMED[u.named]; u.shellT = 0; u.shellN = 0; }
    if (r.hold) { u.holdX = r.x; setState(u, 'hold'); u.speed = 0; stats.held++; WW.emit('craftEvent', { kind: 'held', craft: u }); }
    craft.push(u); stats.launched++; secStat(u.sector).craft++;
    WW.emit('craftEvent', { kind: 'launched', craft: u });
    return u;
  }
  function setState(u, s) { u.state = s; u.stateT = rt(); }
  function lose(u, k) {   // men and tanks lost when the craft is wrecked (the rest swim for it: P7 strays)
    const m = Math.round(u.men * (KILL_K[k] || 0.3)), tk = u.tanks;
    u.men -= m; stats.menLost += m; secStat(u.sector).lost += m;
    if (u.type === 'dd' || u.type === 'lct') { stats.tanksLost += tk; u.tanks = 0; }
    if (u.cargo && u.cargo.length) { stats.vehLost += u.cargo.length; u.cargoLost = u.cargo.length; u.cargo = []; }
  }
  function wreck(u, why) {
    if (!u.alive) return;
    lose(u, why);
    if (u.named) u.burning = true;                                         // the named LCIs burned
    u.alive = false; u.sinking = true; u.speed = 0; setState(u, 'wrecked'); stats.wrecked++; secStat(u.sector).wrecked++;
    WW.emit('craftEvent', { kind: why === 'founder' ? 'foundered' : why === 'mine' ? 'mined' : 'wrecked', craft: u, cause: why });
    if (u.men > 0) WW.emit('craftUnload', { craft: u, men: u.men, tanks: 0, x: u.x, z: u.z, sector: u.sector, swim: true }); // survivors in the water
    u.men = 0;
  }
  function hit(u, amount, key) {
    if (!u.alive || !(amount > 0)) return;
    u.hp -= amount; u.hitT = WW.time.now;
    if (u.hp <= 0) wreck(u, key);
  }

  // the obstacles under the craft's bow this step
  function obstacles(u) {
    const s = T().shoreZ(u.x) - u.z; if (s > 34 || s < 0) return;
    if (u.named) return;                                                   // the named craft's run is scripted (strike)
    const k0 = Math.floor((u.x - 2) / 8), k1 = Math.floor((u.x + 2) / 8), C = u.C;
    const covered = rt() > N().clock.H + TIDE_MIN / N().clock.POST_K;
    for (let k = k0; k <= k1; k++) for (const o of buckets.get(k) || []) {
      if (!o.alive || u.seen.has(o.i) || Math.abs(o.x - u.x) > C.beam / 2 + 0.35 || Math.abs(o.z - u.z) > C.len / 2 + 0.3) continue;
      u.seen.add(o.i);
      if (u.type === 'dd' && o.kind !== 'hedgehog') continue;            // a tank's low hull runs between the stakes
      if (WW.rand() < (covered ? AVOID_COVERED : AVOID_SEEN)) continue;   // the coxswain sees it and steers round
      if (o.mined) {
        o.alive = false;                                                   // the Teller mine goes off
        if (WW.rand() < MINE_P) { stats.mined++; wreck(u, 'mine'); return; }
        hit(u, u.C.hp * 0.4, 'mine');
      } else if (o.kind !== 'hedgehog' && WW.rand() < HOLE_P) {           // holed on a stake: grounds where it is
        stats.holed++; WW.emit('craftEvent', { kind: 'holed', craft: u }); beach(u); return;
      }
    }
  }
  function ashore(u) {   // a DD tank out of the water: the infantry's tank from here, where it stands (no ramp)
    u.speed = 0; u.tanks = 0; u.alive = false; u.removed = true; setState(u, 'unload');
    stats.beached++; stats.tanksLanded++; secStat(u.sector).tanks++;
    WW.emit('craftEvent', { kind: 'beached', craft: u });
    WW.emit('craftUnload', { craft: u, men: 0, tanks: 1, x: u.x, z: u.z, sector: u.sector, dd: true });
  }
  function beach(u) {
    u.speed = 0; setState(u, 'beached'); stats.beached++;
    WW.emit('craftEvent', { kind: 'beached', craft: u });
  }
  // a DUKW whose wheels find the bottom drives up out of the water: the vehicles' from here (vehicles.js); a ladder DUKW
  // at Pointe du Hoc stops in the shallows and runs its ladder up toward the cliff
  function dukwAshore(u) {
    if (u.ladder) { u.speed = 0; setState(u, 'ladder'); stats.beached++; WW.emit('craftEvent', { kind: 'beached', craft: u }); return; }
    const v = u.cargo || []; u.cargo = [];
    u.speed = 0; u.alive = false; u.removed = true; setState(u, 'unload');
    stats.beached++; stats.vehLanded += v.length;
    WW.emit('craftEvent', { kind: 'beached', craft: u });
    WW.emit('craftUnload', { craft: u, men: 0, tanks: 0, vehicles: v, x: u.x, z: u.z, sector: u.sector, dd: true });
  }
  // LCI(L)-91: a mined stake under the bow off Dog White, and the fire
  function strike(u) {
    u.struck = true;
    let best = null, bd = 6;
    for (let k = Math.floor((u.x - 6) / 8); k <= Math.floor((u.x + 6) / 8); k++) for (const o of buckets.get(k) || []) {
      const d = Math.abs(o.x - u.x) + Math.abs(o.z - u.z) * 0.3; if (o.alive && d < bd) { bd = d; best = o; }
    }
    if (best) best.alive = false;
    u.hp -= u.C.hp * 0.45; u.hitT = WW.time.now; u.burning = true;
    WW.emit('craftEvent', { kind: 'struck', craft: u, cause: 'mine', ob: best });
    WW.emit('craftEvent', { kind: 'burning', craft: u });
  }
  // LCI(L)-85: shell after shell while she lies on the sand unloading (never quite enough to wreck her there)
  function shelled(u, dt) {
    if ((u.shellT -= dt) > 0) return;
    u.shellT = SHELL_DT * WW.randRange(0.6, 1.4);
    if (u.hp - SHELL_DMG < u.C.hp * 0.15) return;
    u.hp -= SHELL_DMG; u.hitT = WW.time.now; u.shellN++;
    WW.emit('craftEvent', { kind: 'shellHit', craft: u, n: u.shellN });
    if (u.shellN === 4 && !u.burning) { u.burning = true; WW.emit('craftEvent', { kind: 'burning', craft: u }); }
  }
  // the vehicle waves held off the beach: released when a draw is open for vehicles, toward the nearest open one
  function release(u) {
    const E = WW.beachEng; if (!E) return;
    const ex = E.openExits(); if (!ex.length) return;
    let best = ex[0]; for (const d of ex) if (Math.abs(d.x - u.holdX) < Math.abs(best.x - u.holdX)) best = d;
    u.laneX = best.x + (((u.id * 7) % 5) - 2) / 2 * HOLD_SPREAD; u.exitTo = best.id;
    setState(u, 'run'); u.speed = u.C.speed; stats.released++;
    WW.emit('craftEvent', { kind: 'released', craft: u, draw: best });
  }
  // a marked lane for a craft on its run (the coxswain makes for the buoys)
  function laneFor(u, s) {
    if (u.lane || s < 45 || !WW.beachEng) return;
    const L = WW.beachEng.markedNear(u.laneX, LANE_SEEK);
    if (L) { u.lane = L; u.laneX = L.x; stats.inLane++; }
  }

  function step(u, dt) {
    const C = u.C, t = rt();
    if (u.state === 'run') {
      const zs = T().shoreZ(u.x), s = zs - u.z;
      laneFor(u, s);
      const ex = u.laneX - u.x;
      // the flood current sets the craft east; the coxswain steers back toward his lane, never quite enough (the
      // equilibrium is ~CURRENT / (0.03 x STEER) east of the lane: ~28 u; historically whole companies landed 1,000 yd east);
      // in sight of a marked lane's buoys he corrects for it (gain LANE_K: ~1 u off)
      const vx = (s > 4 ? CURRENT : 0) + (u.lane && s < LANE_SEE ? WW.clamp(ex * LANE_K, -1, 1) * (CURRENT + 0.25) : WW.clamp(ex * 0.03, -1, 1) * STEER);
      const vz = C.speed;
      u.x += vx * dt; u.z += vz * dt; u.heading = Math.atan2(vz, vx); u.speed = Math.hypot(vx, vz);
      if (u.type === 'dd') {
        if (s > 25 && (u.flood += FLOOD_K * u.leak * dt) >= 1) { u.flood = 1; stats.foundered++; wreck(u, 'founder'); return; }
        if (s <= 0 || WW.tide.depth(u.x, u.z) <= DD_GROUND) { ashore(u); return; }   // tracks on the bottom: it drives up out of the water
      } else if (u.type === 'dukw') {
        if (s > 25 && (u.flood += FLOOD_K * u.leak * dt) >= 1) { u.flood = 1; stats.dukwFoundered++; wreck(u, 'founder'); return; }
        if (s <= 0 || WW.tide.depth(u.x, u.z) <= (u.ladder ? 0.55 : DUKW_GROUND)) { dukwAshore(u); return; }
      } else if (WW.tide.depth(u.x, u.z + C.len / 2) <= C.draft) { beach(u); return; }   // on the tide: later waves ground further in
      if (u.named && !u.struck && u.N.fate === 'mine' && s < 33) { strike(u); if (!u.alive) return; }   // in the outer belt, just before she grounds
      obstacles(u);
    } else if (u.state === 'beached') {
      if (t - u.stateT > 0.6) { setState(u, 'ramp'); u.rampDown = true; WW.emit('craftEvent', { kind: 'ramp', craft: u }); }
    } else if (u.state === 'ramp') {
      if (u.named && u.N.fate === 'shell') shelled(u, dt);
      if (t - u.stateT > RAMP_T) {
        setState(u, 'unload'); u.unloadAcc = 0; u.tankT = 0;
        if (u.named) { const m = Math.round(u.men * u.N.kill); u.men -= m; stats.menLost += m; secStat(u.sector).lost += m; }   // the fire in the troop spaces, the shells
      }
    } else if (u.state === 'unload') {
      if (u.named && u.N.fate === 'shell') shelled(u, dt);
      u.unloadAcc += dt; u.tankT -= dt;
      const cargo = u.cargo ? u.cargo.length : 0;
      if (u.unloadAcc >= 1 || (u.men <= 0 && u.tanks <= 0 && !cargo)) {
        const m = Math.min(u.men, Math.round(UNLOAD_RATE * u.unloadAcc)); u.unloadAcc = 0;
        let tk = 0, veh = null; if (u.tanks > 0 && u.tankT <= 0) { tk = 1; u.tankT = TANK_T; } else if (cargo && u.tankT <= 0) { veh = [u.cargo.shift()]; u.tankT = TANK_T; stats.vehLanded++; }
        u.men -= m; u.tanks -= tk;
        stats.menLanded += m; stats.tanksLanded += tk; secStat(u.sector).men += m; secStat(u.sector).tanks += tk;
        if (m || tk || veh) WW.emit('craftUnload', { craft: u, men: m, tanks: tk, vehicles: veh, x: u.x, z: u.z + u.C.len * 0.5 + 0.4, sector: u.sector });
        if (u.men <= 0 && u.tanks <= 0 && !(u.cargo && u.cargo.length)) {
          u.rampDown = false; WW.emit('craftEvent', { kind: 'unloaded', craft: u });
          if (u.named && u.N.fate === 'mine') { wreck(u, 'fire'); return; }         // LCI(L)-91: burned out where she lay
          setState(u, 'off');
        }
      }
      if (u.type === 'dd' && u.tanks <= 0) { u.alive = false; u.removed = true; }   // the tank is ashore: P7's unit now
    } else if (u.state === 'off') {
      const back = t - u.stateT - WAIT_T;
      if (back < 0) return;
      const zs = T().shoreZ(u.x), s = zs - u.z;
      const v = s < BACK_D ? -0.8 : -C.speed;                              // astern off the sand, then out
      u.z += v * dt; u.speed = Math.abs(v); u.heading = s < BACK_D ? Math.PI / 2 : -Math.PI / 2;
      if (u.named && u.N.fate === 'shell' && s > ADRIFT_S) { u.speed = 0; setState(u, 'adrift'); WW.emit('craftEvent', { kind: 'adrift', craft: u }); return; }   // LCI(L)-85
      if (s > LOD) { u.alive = false; u.removed = true; stats.gone++; WW.emit('craftEvent', { kind: 'gone', craft: u }); }
    } else if (u.state === 'adrift') {                                        // burning offshore, her wounded taken off; then she goes down
      u.speed = 0;
      if (t - u.stateT > SINK_T) wreck(u, 'sank');
    } else if (u.state === 'hold') {                                          // the beachmaster's halt: milling about off the LOD
      u.speed = 0; release(u);
    } else if (u.state === 'ladder') {                                        // Pointe du Hoc: the ladder up, then away
      u.speed = 0;
      if (t - u.stateT > LADDER_T) { setState(u, 'off'); WW.emit('craftEvent', { kind: 'unloaded', craft: u }); }
    }
  }
  // mortars: a bomb on a beached craft inside an active mortar's zone
  function mortars(dt) {
    mortT -= dt; if (mortT > 0) return; mortT = MORTAR_TICK;
    const C = WW.coastDefence; if (!C) return;
    for (const e of C.elements) {
      if (e.kind !== 'mortar' || !e.active || !e.alive) continue;
      const near = live.filter(u => u.state !== 'run' && u.state !== 'off' && u.state !== 'hold' && u.state !== 'adrift' && Math.hypot(u.x - e.x, u.z - e.z) < e.K.range);
      if (near.length && WW.rand() < MORTAR_P) hit(near[Math.floor(WW.rand() * near.length)], MORTAR_DMG, 'mortar');
    }
  }

  function update(dt) {
    if (!on() || !plan.length || !WW.game || WW.game.state !== 'battle') return;
    const t = rt();
    while (next < plan.length && plan[next].spawnT <= t) { const r = plan[next++]; spawn(r, t - r.spawnT); }
    for (const u of craft) if (u.alive || u.state === 'wrecked') { if (u.alive) step(u, dt); }
    live.length = 0;
    for (const u of craft) if (u.alive && !u.removed) live.push(u);
    mortars(dt);
    if (craft.length > 400) craft = craft.filter(u => u.alive || rt() - u.stateT < 120);   // old wrecks off the books
  }

  // ---- land_sites.js: the German guns' shells hit craft ----
  function hitTest(nation, x, z, pad, prefer) {
    if (nation !== 'GER' || !live.length) return null;
    if (prefer && prefer.isCraft && prefer.alive && Math.abs(x - prefer.x) < prefer.C.beam / 2 + pad + 0.3 && Math.abs(z - prefer.z) < prefer.C.len / 2 + pad) return prefer;
    for (const u of live) if (Math.abs(x - u.x) < u.C.beam / 2 + pad + 0.3 && Math.abs(z - u.z) < u.C.len / 2 + pad) return u;
    return null;
  }
  WW.landSites.register({ id: 'landingCraft', hitTest });
  // what the defences can shoot at (coast_defence_fire.js): the craft afloat, near the beach first (P7 adds the men and
  // tanks ashore by wrapping this)
  WW.landTargets = function () { return live; };

  WW.on('roundStart', reset);
  WW.on('setupStart', () => { plan = []; fleetPlan = []; craft = []; live = []; stats = newStats(); });
  // plan: the boats the transport area launches (normandy_fleet.js: the same array all round); planAll: every craft
  WW.landingCraft = { update, CRAFT, NAMED, get craft() { return craft; }, get live() { return live; }, get stats() { return stats; }, get plan() { return fleetPlan; }, get planAll() { return plan; }, LOD };
  stats = newStats();
})(window.WW);
