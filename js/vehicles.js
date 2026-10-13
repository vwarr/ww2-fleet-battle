// vehicles.js - WW.vehicles: the wheeled and tracked vehicles ashore at Omaha (Normandy realism pass). Sim code
// (WW.rand), Normandy only, stepped from infantry.js update; every hook returns first in another scenario and the
// roundStart listener draws nothing. Visuals: models_vehicles.js / vehicles_fx.js.
// They come off the vehicle LCTs' ramps one by one and out of the water in the DUKWs (landing_craft.js 'craftUnload'
// vehicles) from about H+60, and there was nowhere for them to go: the draws were closed (beach_engineers.js blocks)
// and the shingle stopped wheels. So they piled up along the shingle, nose to tail, the half-tracks and trucks and
// jeeps a jam that the German gunners shelled at leisure (KIND: what each can take), and the flood tide drowned the
// ones parked too low (DROWN: the water over the engine; they shift up the beach while there is room). At about 08:30
// the beachmaster stopped the vehicle landings on most of the beach (landing_craft.js 'hold').
//   land      off the ramp, driving up the beach to a place in the jam (a slot along the shingle, row 0 against the
//             stones, the rows behind it seaward: JAM_DX apart along the beach, JAM_DZ across)
//   jam       parked in the jam; every RESLOT s a vehicle whose place is going under looks for a drier one
//   exit      a draw open for vehicles (beach_engineers.js openExits): the jam drains through it, one vehicle every
//             EXIT_GAP s per exit, nearest first: along the shingle to the draw's mouth, up the draw, and off the beach
//             (stats.offBeach), as the traffic went up E-1 in the afternoon
//   work      the armoured dozers (tank dozers and armoured D-7s; 16 landed for the gap teams, only 6 got ashore and
//             working, 3 of them soon knocked out: dozers drowned off the ramps, DOZER_DROWN): they work a gap lane in
//             the shallows beside the engineers, and once a draw's strongpoints are silenced they go to its block and fill
//             the ditch (the 37th Engineers' dozers at E-1)
// The 111th FA's one 105 mm howitzer that got ashore (dukw105) fires on the strongpoints it can see (HOW_RELOAD).
// Tanks (infantry.js squads) take the exits too: an open exit drains the tanks at the shingle as it drains the jam.
// Mortars: a vehicle in an active mortar's zone may take a bomb (MORTAR_P a tick).
// Events: 'vehicleEvent' { kind: landed | drowned | lost | exit | offBeach | howitzer, v }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  // hp; value (the German gunners' pick, coast_defence_fire.js: a squad is 1, a Sherman 4); armK: x damage from a 5 cm
  // ('small') round, mgK from MG fire; drown: the water over the engine (u); v: speed (u/s)
  const KIND = {
    jeep: { name: 'jeep', hp: 10, value: 0.7, len: 0.42, armK: 1, mgK: 0.6, drown: 0.22, v: 0.8 },
    truck: { name: '2½-ton truck', hp: 16, value: 0.9, len: 0.75, armK: 1, mgK: 0.5, drown: 0.32, v: 0.6 },
    halftrack: { name: 'M15 half-track', hp: 28, value: 1.1, len: 0.7, armK: 0.7, mgK: 0.2, drown: 0.38, v: 0.6 },
    tankdozer: { name: 'tank dozer', hp: 80, value: 2.2, len: 0.85, armK: 0.3, mgK: 0, drown: 0.5, v: 0.5, dozer: true },
    d7: { name: 'armoured D-7 dozer', hp: 60, value: 2, len: 0.7, armK: 0.5, mgK: 0.1, drown: 0.45, v: 0.4, dozer: true },
    dukw105: { name: 'DUKW (105 mm howitzer)', hp: 16, value: 1.2, len: 1.0, armK: 1, mgK: 0.5, drown: 0.9, v: 0.6 }
  };
  const JAM_DX = 1.15, JAM_DZ = 1.25, JAM_ROWS = 6, JAM_WIN = 14, RESLOT = 4, EXIT_GAP = 2.5, OFF_U = 45, DOZER_DROWN = 0.35;
  const MORTAR_TICK = 0.5, MORTAR_P = 0.004, MORTAR_DMG = 12, HOW_RELOAD = 14, HOW_R = 280, LANE_R = 70, ID0 = 40000;
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, E = () => WW.beachEng;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let vehicles = [], live = [], slots = new Map(), stats = null, nid = 0, mortT = 0, exitT = {};
  function newStats() { return { landed: 0, drowned: 0, lost: 0, offBeach: 0, tanksOff: 0, jam: 0, jamMax: 0, dozersAshore: 0, dozersWorking: 0, howShots: 0, byKind: {}, lostBy: {} }; }

  // ---- the jam: slots along the shingle ----
  const slotZ = (x, r) => T().shingleZ(x) - 1.7 - r * JAM_DZ;
  const key = (i, r) => i * 16 + r;
  function wet(x, z) { return WW.tide ? WW.tide.depth(x, z) : -1; }
  function takeSlot(v, x) {
    const i0 = Math.round(x / JAM_DX);
    let best = null, bs = 1e9;
    for (let d = 0; d <= JAM_WIN; d++) for (const i of d ? [i0 - d, i0 + d] : [i0]) for (let r = 0; r < JAM_ROWS; r++) {
      const k = key(i, r); if (slots.has(k)) continue;
      const sx = i * JAM_DX, sz = slotZ(sx, r), w = wet(sx, sz);
      const sc = d + r * 2.5 + (w > -0.05 ? 30 + w * 50 : 0);   // near where it landed, against the stones, out of the water
      if (sc < bs) { bs = sc; best = { k, x: sx, z: sz }; }
    }
    if (!best) return false;
    if (v.slot) slots.delete(v.slot.k);
    v.slot = best; slots.set(best.k, v);
    return true;
  }
  function freeSlot(v) { if (v.slot) { if (slots.get(v.slot.k) === v) slots.delete(v.slot.k); v.slot = null; } }

  function make(c, kind, x, z) {
    const K = KIND[kind] || KIND.truck, y = Math.max(0, WW.terrain.heightRaw(x, z));
    const v = { isLand: true, isVeh: true, id: ID0 + nid++, nation: 'USN', kind, K, type: 'vehicle', name: K.name, unit: c ? c.unit : '', sector: c ? c.sector : '',
      x, z, y, heading: Math.PI / 2, speed: 0, hp: K.hp, maxHp: K.hp, value: K.value, alive: true, sinking: false, removed: false, submerged: false,
      state: 'land', stateT: rt(), slot: null, job: null, reload: HOW_RELOAD * 0.5, muzzleY: y + 0.4, men: 2,
      stats: { length: K.len, beam: 0.3, guns: [], aa: null, tons: 10 },
      takeDamage(amount, hx, hz, kd, cal) { hit(this, amount, kd === 'bomb' ? 'bomb' : cal || 'small'); } };
    vehicles.push(v); stats.landed++; stats.byKind[kind] = (stats.byKind[kind] || 0) + 1;
    if (K.dozer) {
      // off the ramp into water too deep for it: the LCTs dropped their ramps where they grounded, and dozers drowned
      if (WW.tide.depth(x, z) > 0.35 && WW.rand() < DOZER_DROWN) { drown(v); return v; }
      stats.dozersAshore++; v.state = 'work';
    }
    WW.emit('vehicleEvent', { kind: 'landed', v });
    return v;
  }
  function setState(v, s) { v.state = s; v.stateT = rt(); }
  function drown(v) { v.alive = false; freeSlot(v); setState(v, 'drowned'); stats.drowned++; WW.emit('vehicleEvent', { kind: 'drowned', v }); }
  function hit(v, amount, key) {
    if (!v.alive || !(amount > 0)) return;
    v.hp -= amount * (key === 'mg' ? v.K.mgK : key === 'small' ? v.K.armK : 1); v.hitT = WW.time.now;
    if (v.hp <= 0) { v.alive = false; freeSlot(v); setState(v, 'lost'); stats.lost++; stats.lostBy[key] = (stats.lostBy[key] || 0) + 1; WW.emit('vehicleEvent', { kind: 'lost', v, cause: key }); }
  }
  function moveTo(v, gx, gz, sp, dt) {
    const dx = gx - v.x, dz = gz - v.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { v.speed = 0; return true; }
    const s = Math.min(d, sp * dt);
    v.x += dx / d * s; v.z += dz / d * s; v.heading = Math.atan2(dz, dx); v.speed = sp;
    return d - s < 0.1;
  }

  // ---- the exits: the route up a draw (vehicles and tanks) ----
  // legs: 0 along the beach to the draw's mouth (on the jam line), 1 up the draw past the block, 2 inland and gone
  function route(u, ex, dt, sp) {
    const t = T();
    if (u.leg === 0) { if (moveTo(u, ex.x, Math.min(u.z, slotZ(ex.x, 0)), sp, dt) || Math.abs(u.x - ex.x) < 0.5) u.leg = 1; return false; }
    if (u.leg === 1) { if (moveTo(u, ex.x, t.bluffTopZ(ex.x) + 4, sp, dt)) u.leg = 2; return false; }
    return moveTo(u, ex.x + ((u.id % 3) - 1) * 0.6, t.bluffTopZ(ex.x) + OFF_U, sp, dt);
  }
  function drive(u, dt, sp) { return u.exit ? route(u, u.exit, dt, sp) : true; }
  // the open exits drain the jam and the tanks: one vehicle a gap per exit, nearest first
  function exits(squads) {
    const ex = E() ? E().openExits() : []; if (!ex.length) return;
    const now = rt();
    for (const b of ex) {
      if (now - (exitT[b.id] || -1e9) < EXIT_GAP) continue;
      let best = null, bd = 1e9;
      for (const v of live) if (v.state === 'jam' || (v.state === 'land' && v.speed === 0)) { const d = Math.abs(v.x - b.x); if (d < bd && nearestExit(v.x, ex) === b) { bd = d; best = v; } }
      for (const q of squads) if (q.alive && q.kind === 'tank' && q.state === 'tank') { const d = Math.abs(q.x - b.x); if (d < bd && nearestExit(q.x, ex) === b) { bd = d; best = q; } }
      if (!best) continue;
      exitT[b.id] = now; best.exit = b; best.leg = 0;
      if (best.isVeh) { freeSlot(best); setState(best, 'exit'); } else WW.infantry.setState(best, 'exit');
      WW.emit('vehicleEvent', { kind: 'exit', v: best, block: b });
    }
  }
  function nearestExit(x, ex) { let b = ex[0]; for (const e of ex) if (Math.abs(e.x - x) < Math.abs(b.x - x)) b = e; return b; }

  // ---- the dozers: a lane in the shallows, then a draw's block ----
  function dozer(v, dt) {
    const Eg = E(); if (!Eg) return;
    let job = v.job;
    if (job && (job.state !== 'work')) job = v.job = null;
    if (!job || !job.draw) {                                        // a draw's block outranks a lane
      let best = null, bd = 400;
      for (const b of Eg.workBlocks()) { const d = Math.abs(b.x - v.x); if (d < bd) { bd = d; best = b; } }
      if (best) job = v.job = best;
    }
    if (!job) { const L = Eg.workingNear(v.x, LANE_R); if (L && WW.tide.depth(L.x, Eg.workZ(L)) < 0.7) job = v.job = L; }
    if (!job) { if (!v.slot) takeSlot(v, v.x); if (v.slot) moveTo(v, v.slot.x, v.slot.z, v.K.v, dt); return; }
    freeSlot(v);
    const gx = job.draw ? job.x + ((v.id % 2) ? 1.2 : -1.2) : job.x + ((v.id % 2) ? 0.9 : -0.9);
    const gz = job.draw ? job.z - 1.2 : Eg.workZ(job) + 2;
    if (job.draw) {   // along the beach first, then up to the block
      if (Math.abs(v.x - gx) > 2 && v.z < slotZ(v.x, 0) + 0.5) { moveTo(v, gx, slotZ(v.x, 0), v.K.v, dt); return; }
    }
    if (moveTo(v, gx, gz, v.K.v, dt) || Math.hypot(v.x - gx, v.z - gz) < 1.2) { job.dozers++; v.working = true; if (!v.worked) { v.worked = true; stats.dozersWorking++; } } else v.working = false;
  }
  // the one howitzer ashore: direct fire on what it can see
  function howitzer(v, dt) {
    v.reload -= dt; if (v.reload > 0) return;
    const C = WW.coastDefence; if (!C) return;
    let best = null, bd = HOW_R;
    for (const e of C.elements) if (e.alive && !e.dormant && e.type !== 'wall' && e.revealUntil > WW.time.now) { const d = Math.hypot(e.x - v.x, e.z - v.z); if (d < bd) { bd = d; best = e; } }
    v.reload = best ? HOW_RELOAD * WW.randRange(0.85, 1.2) : 2;
    if (best && WW.combat.fireShell(v, null, best, 'med')) { stats.howShots++; WW.emit('vehicleEvent', { kind: 'howitzer', v, target: best }); }
  }
  function step(v, dt) {
    const K = v.K, now = rt();
    if (v.state === 'land') {
      if (!v.slot && !takeSlot(v, v.x)) { v.speed = 0; }
      else if (v.slot && moveTo(v, v.slot.x, v.slot.z, K.v, dt)) setState(v, 'jam');
    } else if (v.state === 'jam') {
      v.speed = 0;
      if (now - v.stateT > RESLOT) {                                // the tide coming in under it: a drier place if there is one
        v.stateT = now;
        if (wet(v.x, v.z) > -0.02) { const old = v.slot; if (takeSlot(v, v.x) && v.slot !== old) setState(v, 'land'); }
      }
      if (v.kind === 'dukw105') howitzer(v, dt);
    } else if (v.state === 'work') dozer(v, dt);
    else if (v.state === 'exit') {
      if (drive(v, dt, K.v)) { v.alive = false; v.removed = true; setState(v, 'off'); stats.offBeach++; WW.emit('vehicleEvent', { kind: 'offBeach', v }); return; }
    }
    if (v.alive && v.state !== 'exit' && wet(v.x, v.z) > K.drown && v.speed === 0) drown(v);   // the flood over its engine
    v.y = Math.max(0, WW.terrain.heightRaw(v.x, v.z)); v.muzzleY = v.y + 0.4;
  }
  function mortars(dt) {
    mortT -= dt; if (mortT > 0) return; mortT = MORTAR_TICK;
    const C = WW.coastDefence; if (!C || !live.length) return;
    for (const e of C.elements) {
      if (e.kind !== 'mortar' || !e.alive || e.suppressedUntil > WW.time.now || !e.active) continue;
      const near = live.filter(v => v.state !== 'exit' && Math.hypot(v.x - e.x, v.z - e.z) < e.K.range);
      if (near.length && WW.rand() < Math.min(0.03, MORTAR_P * near.length)) hit(near[Math.floor(WW.rand() * near.length)], MORTAR_DMG, 'mortar');
    }
  }
  function update(dt, squads) {
    if (!on() || !WW.game || WW.game.state !== 'battle') return;
    for (const v of vehicles) if (v.alive) step(v, dt);
    live.length = 0; let jam = 0;
    for (const v of vehicles) if (v.alive && !v.removed) { live.push(v); if (v.state === 'jam' || v.state === 'land') jam++; }
    stats.jam = jam; stats.jamMax = Math.max(stats.jamMax, jam);
    mortars(dt);
    exits(squads);
    if (vehicles.length > 500) vehicles = vehicles.filter(v => v.alive || rt() - v.stateT < 120);
  }
  // a tank that has gone up a draw: off the beach (infantry.js 'exit')
  function tankOff(q) { stats.tanksOff++; WW.emit('vehicleEvent', { kind: 'offBeach', v: q }); }

  // ---- land_sites.js: German shells on the vehicles ----
  function hitTest(nation, x, z, pad, prefer) {
    if (nation !== 'GER' || !live.length) return null;
    if (prefer && prefer.isVeh && prefer.alive && Math.hypot(x - prefer.x, z - prefer.z) < prefer.K.len * 0.6 + pad) return prefer;
    for (const v of live) if (Math.abs(x - v.x) < v.K.len * 0.6 + pad && Math.abs(z - v.z) < v.K.len * 0.6 + pad) return v;
    return null;
  }
  WW.landSites.register({ id: 'vehicles', hitTest });
  function unload(e) {
    const c = e.craft;
    e.vehicles.forEach((k, i) => make(c, k, e.x + (i - (e.vehicles.length - 1) / 2) * 0.8, e.z + (e.dd ? 0 : 0.3)));
  }
  function reset() { vehicles = []; live = []; slots = new Map(); stats = newStats(); nid = 0; mortT = 0; exitT = {}; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.on('craftUnload', e => { if (on() && e && e.vehicles && e.vehicles.length) unload(e); });
  WW.vehicles = { update, drive, tankOff, KIND, get all() { return vehicles; }, get live() { return live; }, get stats() { return stats; }, slotZ };
  stats = newStats();
})(window.WW);
