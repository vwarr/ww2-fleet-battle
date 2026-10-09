// base_life_cars.js - WW.baseLifeCars: the island base's motor pool on the move, and the stretchers (visual only:
// Math.random, nothing feeds the sim). The trucks, the jeeps and the fire truck parked in the motor pool (base.decor,
// models_base_life.js) are their own models, moved in place:
//  - at the ALARM (base_life.js) the trucks race to the hangars and the AA pits, a jeep to the command post / tower;
//    after the raid they drive home. The fire truck goes to whatever burns (the camp or a facility) and back.
//  - they drive the vehicle ways of base_life_paths.js (wide of the walls, the taxiways allowed) in sim time, and wait
//    short of a plane on the ground or another vehicle in their way; people step clear of them (base_life.js).
//  - stretcher(x, y, z, face): one stretcher this frame (an InstancedMesh, base_life.js's stretcher teams).
window.WW = window.WW || {};
(function () {
  'use strict';
  const R = Math.random, SPD = { truck: 7, jeep: 9, fire: 8 };
  let base = null, cars = [], stretchers = null, nS = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const K = () => WW.baseModels.VEH_K || 1;

  function reset(b, bl) {
    base = b; cars = [];
    for (const part of bl.parts) {
      const d = part.f;
      if (!part.decor || !part.mesh || !SPD[d.kind]) continue;
      cars.push({ d, part, kind: d.kind, x: d.x, z: d.z, h: d.a, home: { x: d.x, z: d.z, h: d.a }, path: null, pi: 0, wait: 0, away: false, job: null });
    }
    if (stretchers) stretchers.count = 0;
  }
  // drive c to (x, z): out of (or back into) its motor-pool bay straight along its nose, the rest along the ways
  function send(c, x, z, job) {
    const H = c.home, out = { x: H.x + Math.cos(H.h) * 2.8 * K(), z: H.z + Math.sin(H.h) * 2.8 * K() }, fromHome = !c.away, toHome = job === 'home';
    const a = fromHome ? out : c, b = toHome ? out : { x, z };
    const w = WW.baseLifePaths.path(a.x, a.z, b.x, b.z, true); if (!w) return false;
    c.path = (fromHome ? [out] : []).concat(w.slice(1), [b]);
    if (toHome) c.path.push({ x: H.x, z: H.z, rev: true });   // backs into the bay
    c.pi = 0; c.job = job; c.wait = 0; c.away = true;
    return true;
  }
  // a vehicle-open point beside a thing (radius r from its centre), toward p (the car)
  function beside(f, r, from) {
    const a0 = Math.atan2(from.z - f.z, from.x - f.x);
    for (let k = 0; k < 12; k++) { const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45, x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r; if (WW.baseLifePaths.open(x, z, true)) return { x, z }; }
    return null;
  }
  function alarm() {
    const hang = base.facilities.filter(f => f.kind === 'hangar' && !f.out), pits = base.facilities.filter(f => f.kind === 'aa' && !f.out);
    const tw = base.facilities.find(f => f.kind === 'tower'), cp = (base.decor || []).find(d => d.kind === 'cp');
    let ti = 0;
    for (const c of cars) {
      if (c.kind === 'fire' || c.d.out) continue;
      const tgt = c.kind === 'jeep' ? (ti++ === 0 ? cp || tw : tw) : [...hang, ...pits][ti++ % Math.max(1, hang.length + pits.length)];
      if (!tgt) continue;
      const q = beside(tgt, (tgt.hx ? Math.hypot(tgt.hx, tgt.hz) : tgt.r) + 2.6 + R() * 1.5, c); if (q) send(c, q.x, q.z, 'alarm');
    }
  }
  function standDown() { for (const c of cars) if (c.kind !== 'fire' && c.away && !c.d.out) send(c, c.home.x, c.home.z, 'home'); }
  // the fire truck: to the newest fire nobody fights, home when it is out
  function fireTruck(now) {
    const c = cars.find(q => q.kind === 'fire' && !q.d.out); if (!c) return;
    const burning = f => f.out && f.kind !== 'drill' && f.kind !== 'trench' && now - f.outAt < 140;
    if (c.job && c.job.f && !burning(c.job.f) && !c.path) { send(c, c.home.x, c.home.z, 'home'); c.job = null; return; }
    if (c.job || c.path) return;
    const f = [...(base.decor || []), ...base.facilities].filter(f => burning(f) && now - f.outAt > 3 && f !== c.d).sort((a, b) => b.outAt - a.outAt)[0];
    if (!f) return;
    const q = beside(f, (f.hx ? Math.hypot(f.hx, f.hz) : f.r) + 3.2, c); if (q && send(c, q.x, q.z, null)) c.job = { f };
  }
  function blocked(c, x, z, gp, others) {
    const k = K(), hl = 1.25 * k + 0.5, hw = 0.55 * k + 0.35, ch = Math.cos(c.h), sh = Math.sin(c.h);
    for (const g of gp) { // a plane on the ground near the car's box (+ a margin), ahead or beside
      const C = g[3], d = Math.hypot(g[0] - x, g[1] - z); if (d > C.len / 2 + C.span / 2 + hl + 2) continue;
      for (let t = -1; t <= 1; t += 0.5) {
        const px = x + ch * hl * t, pz = z + sh * hl * t, c2 = Math.cos(g[2]), s2 = Math.sin(g[2]), dx = px - g[0], dz = pz - g[1];
        const a = dx * c2 + dz * s2, b = -dx * s2 + dz * c2, m = hw + (g[4] ? 1.2 : 0.3);
        if (Math.abs(a) < C.len / 2 + m + (g[4] && a > 0 ? 3 : 0) && Math.abs(b) < C.span / 2 + m) return true;
      }
    }
    for (const o of others) { if (o === c) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < 2.6 * k + 0.4 && Math.hypot(o.x - c.x, o.z - c.z) > d) return true; }
    return false;
  }
  function update(dt, gp, cam, people) {
    if (!base) return;
    nS = 0; if (stretchers) stretchers.count = 0;
    const now = WW.time.now, others = cars.concat((WW.baseGroundFx && WW.baseGroundFx._vehNow ? WW.baseGroundFx._vehNow() : []));
    fireTruck(now);
    const T = WW.baseGroundFx && WW.baseGroundFx._traceRef ? WW.baseGroundFx._traceRef() : null;
    for (const c of cars) {
      if (c.d.out) { if (T && c.away) T.veh.push({ kind: c.kind === 'fire' ? 'crash' : c.kind, x: c.x, z: c.z, h: c.h, parked: c.d }); continue; }
      if (c.path && dt > 0) {
        const t = c.path[c.pi], dx = t.x - c.x, dz = t.z - c.z, d = Math.hypot(dx, dz), want = t.rev ? Math.atan2(-dz, -dx) : Math.atan2(dz, dx);
        const turn = WW.angleDiff(c.h, want);
        c.h += WW.clamp(turn, -3 * dt, 3 * dt);                     // it steers onto the leg (slows into a sharp turn)
        const v = SPD[c.kind] * (Math.abs(turn) > 0.6 ? 0.35 : 1) * (t.rev ? 0.3 : 1), mv = Math.min(d, v * dt);
        const nx = c.x + (t.rev ? dx / (d || 1) : Math.cos(c.h)) * mv, nz = c.z + (t.rev ? dz / (d || 1) : Math.sin(c.h)) * mv;
        if (blocked(c, nx, nz, gp, others)) c.wait += dt;
        else { c.x = nx; c.z = nz; c.wait = 0; }
        if (d < 0.35 || c.wait > 40) { c.pi++; if (c.pi >= c.path.length || c.wait > 40) { c.path = null; if (c.job === 'home') { c.x = c.home.x; c.z = c.home.z; c.h = c.home.h; c.away = false; c.job = null; } } }
      }
      const m = c.part.mesh; m.position.x = c.x; m.position.z = c.z; m.position.y = Math.max(base.site.padH, -WW.terrain.depthAt(c.x, c.z)) - 0.03; m.rotation.y = -c.h;
      if (T && c.away) T.veh.push({ kind: c.kind === 'fire' ? 'crash' : c.kind, x: c.x, z: c.z, h: c.h, parked: c.d });
      if (c.path && c.kind === 'fire' && R() < 0.3) { /* the bell: nothing to draw */ }
    }
  }
  function now() { return cars.filter(c => c.away).map(c => ({ x: c.x, z: c.z, h: c.h, kind: c.kind })); }
  function stretcher(x, y, z, face) {
    if (!stretchers) {
      stretchers = new THREE.InstancedMesh(WW.baseLifeModels.vehicle('stretcher', 'USN'), WW.models._mat(0xffffff), 8);
      stretchers.count = 0; stretchers.frustumCulled = false; stretchers.castShadow = true; WW.scene.add(stretchers);
    }
    if (nS >= 8) return;
    const k = 0.24 * (WW.baseLife ? WW.baseLife.FIG_K : 1);
    _q.setFromEuler(_e.set(0, -face, 0)); _p.set(x, y, z); _s.set(k, k, k);
    stretchers.setMatrixAt(nS++, _m.compose(_p, _q, _s)); stretchers.count = nS; stretchers.instanceMatrix.needsUpdate = true;
  }
  WW.on('roundStart', () => { base = null; cars = []; if (stretchers) stretchers.count = 0; });
  WW.on('setupStart', () => { base = null; cars = []; if (stretchers) stretchers.count = 0; });
  WW.baseLifeCars = { reset, alarm, standDown, update, now, stretcher, get cars() { return cars; } };
})();
