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
// Events: 'craftEvent' { kind: launched | beached | ramp | unloaded | wrecked | mined | foundered | holed | gone, craft },
// 'craftUnload' { craft, men, tanks, x, z, sector } once a second while unloading (P7 picks the men up as squads).
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
    dd: { name: 'DD tank', len: 0.8, beam: 0.35, speed: 0.9, hp: 25, men: 0, tanks: 1, draft: 0, value: 4 }
  };
  const LOD = 420, DD_FAR = 280, DD_CLOSE = 40;
  const CURRENT = 0.3, STEER = 0.36, RAMP_T = 2.5, UNLOAD_RATE = 6, TANK_T = 3, WAIT_T = 3, BACK_D = 25;
  const MINE_P = 0.55, HOLE_P = 0.25, AVOID_SEEN = 0.75, AVOID_COVERED = 0.2, TIDE_MIN = 60;   // TIDE_MIN: minutes after H the obstacles go under
  const KILL_K = { mine: 0.35, big: 0.6, med: 0.4, small: 0.25, mg: 0.05, bomb: 0.5, mortar: 0.2 };
  const DD_GROUND = 0.35, FLOOD_K = 0.0108, LEAK_A = 0.2, LEAK_B = 1.8, MORTAR_TICK = 0.5, MORTAR_P = 0.05, MORTAR_DMG = 22;
  const ID0 = 20000;
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, N = () => WW.scenarios.normandy;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let plan = [], next = 0, craft = [], live = [], stats = null, nid = 0, mortT = 0, buckets = null;

  function newStats() { return { launched: 0, beached: 0, wrecked: 0, mined: 0, holed: 0, foundered: 0, menLanded: 0, menLost: 0, tanksLanded: 0, tanksLost: 0, gone: 0, bySector: {} }; }
  function secStat(s) { return stats.bySector[s] || (stats.bySector[s] = { craft: 0, men: 0, tanks: 0, lost: 0, wrecked: 0 }); }
  // the obstacles by x bucket (8 u), for the collision check
  function bucketize() {
    buckets = new Map();
    for (const o of T().obstacles) { const k = Math.floor(o.x / 8); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(o); }
  }
  function reset() {
    plan = []; next = 0; craft = []; live = []; stats = newStats(); nid = 0; mortT = 0; buckets = null;
    if (!on() || !WW.landingWaves || !WW.normandyTerrain) return;
    const S = N().settings || {};
    plan = WW.landingWaves.expand().map(r => {
      const C = CRAFT[r.craft], s0 = r.craft === 'dd' ? (S.dd === 'close' ? DD_CLOSE : DD_FAR) : LOD;
      const run = (s0 - 12) / C.speed;
      return Object.assign({}, r, { s0, spawnT: r.craft === 'dd' ? 0 : r.t - run });
    });
    plan.sort((a, b) => a.spawnT - b.spawnT || a.x - b.x);
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
    craft.push(u); stats.launched++; secStat(u.sector).craft++;
    WW.emit('craftEvent', { kind: 'launched', craft: u });
    return u;
  }
  function setState(u, s) { u.state = s; u.stateT = rt(); }
  function lose(u, k) {   // men and tanks lost when the craft is wrecked (the rest swim for it: P7 strays)
    const m = Math.round(u.men * (KILL_K[k] || 0.3)), tk = u.tanks;
    u.men -= m; stats.menLost += m; secStat(u.sector).lost += m;
    if (u.type === 'dd' || u.type === 'lct') { stats.tanksLost += tk; u.tanks = 0; }
  }
  function wreck(u, why) {
    if (!u.alive) return;
    lose(u, why);
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

  function step(u, dt) {
    const C = u.C, t = rt();
    if (u.state === 'run') {
      const zs = T().shoreZ(u.x), s = zs - u.z, ex = u.laneX - u.x;
      // the flood current sets the craft east; the coxswain steers back toward his lane, never quite enough (the
      // equilibrium is ~CURRENT / (0.03 x STEER) east of the lane: ~28 u; historically whole companies landed 1,000 yd east)
      const vx = (s > 4 ? CURRENT : 0) + WW.clamp(ex * 0.03, -1, 1) * STEER;
      const vz = C.speed;
      u.x += vx * dt; u.z += vz * dt; u.heading = Math.atan2(vz, vx); u.speed = Math.hypot(vx, vz);
      if (u.type === 'dd') {
        if (s > 25 && (u.flood += FLOOD_K * u.leak * dt) >= 1) { u.flood = 1; stats.foundered++; wreck(u, 'founder'); return; }
        if (s <= 0 || WW.tide.depth(u.x, u.z) <= DD_GROUND) { ashore(u); return; }   // tracks on the bottom: it drives up out of the water
      } else if (WW.tide.depth(u.x, u.z + C.len / 2) <= C.draft) { beach(u); return; }   // on the tide: later waves ground further in
      obstacles(u);
    } else if (u.state === 'beached') {
      if (t - u.stateT > 0.6) { setState(u, 'ramp'); u.rampDown = true; WW.emit('craftEvent', { kind: 'ramp', craft: u }); }
    } else if (u.state === 'ramp') {
      if (t - u.stateT > RAMP_T) { setState(u, 'unload'); u.unloadAcc = 0; u.tankT = 0; }
    } else if (u.state === 'unload') {
      u.unloadAcc += dt; u.tankT -= dt;
      if (u.unloadAcc >= 1 || (u.men <= 0 && u.tanks <= 0)) {
        const m = Math.min(u.men, Math.round(UNLOAD_RATE * u.unloadAcc)); u.unloadAcc = 0;
        let tk = 0; if (u.tanks > 0 && u.tankT <= 0) { tk = 1; u.tankT = TANK_T; }
        u.men -= m; u.tanks -= tk;
        stats.menLanded += m; stats.tanksLanded += tk; secStat(u.sector).men += m; secStat(u.sector).tanks += tk;
        if (m || tk) WW.emit('craftUnload', { craft: u, men: m, tanks: tk, x: u.x, z: u.z + u.C.len * 0.5 + 0.4, sector: u.sector });
        if (u.men <= 0 && u.tanks <= 0) { setState(u, 'off'); u.rampDown = false; WW.emit('craftEvent', { kind: 'unloaded', craft: u }); }
      }
      if (u.type === 'dd' && u.tanks <= 0) { u.alive = false; u.removed = true; }   // the tank is ashore: P7's unit now
    } else if (u.state === 'off') {
      const back = t - u.stateT - WAIT_T;
      if (back < 0) return;
      const zs = T().shoreZ(u.x), s = zs - u.z;
      const v = s < BACK_D ? -0.8 : -C.speed;                              // astern off the sand, then out
      u.z += v * dt; u.speed = Math.abs(v); u.heading = s < BACK_D ? Math.PI / 2 : -Math.PI / 2;
      if (s > LOD) { u.alive = false; u.removed = true; stats.gone++; WW.emit('craftEvent', { kind: 'gone', craft: u }); }
    }
  }
  // mortars: a bomb on a beached craft inside an active mortar's zone
  function mortars(dt) {
    mortT -= dt; if (mortT > 0) return; mortT = MORTAR_TICK;
    const C = WW.coastDefence; if (!C) return;
    for (const e of C.elements) {
      if (e.kind !== 'mortar' || !e.active || !e.alive) continue;
      const near = live.filter(u => u.state !== 'run' && u.state !== 'off' && Math.hypot(u.x - e.x, u.z - e.z) < e.K.range);
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
  WW.on('setupStart', () => { plan = []; craft = []; live = []; stats = newStats(); });
  WW.landingCraft = { update, CRAFT, get craft() { return craft; }, get live() { return live; }, get stats() { return stats; }, get plan() { return plan; }, LOD };
  stats = newStats();
})(window.WW);
