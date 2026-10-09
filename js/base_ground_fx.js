// base_ground_fx.js - WW.baseGroundFx: the island airfield's ground life (visual only: Math.random, never WW.rand;
// nothing here runs in sim-only mode and nothing feeds back into the sim). Driven from base_fx.js each frame.
//  - Parked planes: one pooled plane model per slot in its revetment (parked / rearming), tilted and scorched-dark
//    wrecks where planes were hit on the ground (slots and base.wrecks), burning for a while.
//  - Engines: planes warming up in their revetments spin up their props and cough exhaust; taxiing props turn over.
//  - Ground crews (WW.crew.addFigure, the shared sailor instances): two or three men at every parked plane, a plane
//    captain at the wingtip of a plane warming up; at a SCRAMBLE (or any engine start) they back away from the props,
//    running when it is a scramble. Repair gangs and a roller at the crater being filled.
//  - Vehicles (one InstancedMesh per kind): a fuel truck from the fuel farm and a bomb cart from the ammunition dump
//    drive the taxiways to every plane that comes back to rearm, wait beside it and drive home; a red crash truck
//    races to a damaged plane's landing. Trips run in sim time (they pause and warp with the battle).
//  - LOD: beyond FAR from the camera the vehicles and figures are skipped (the figures are also culled by models_crew).
window.WW = window.WW || {};
(function () {
  'use strict';
  const R = Math.random, rr = (a, b) => a + (b - a) * R();
  const FAR = 420, NEAR_FIG = 170, FIG_K = 2 * Math.pow(WW.cfg.PLANE_K || 1, 0.73), // ground crews x the sailors' size: about a fifth of a fighter's length (2 at the 1.7 plane scale)
    MAX_FIG = 110, VCAP = { fuel: 16, bombs: 16, crash: 3, roller: 2 }, VSPD = { fuel: 14, bombs: 12, crash: 16, roller: 1.2 };
  let trace = null;   // tests/base_clip.js: this frame's figures and vehicles ({ figs, veh })
  let base = null, planes = new Map(), wrecks = new Map(), prev = new Map(), crews = new Map(), trips = [], veh = {}, scrT = -1e9, fig = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

  const V = () => WW.landAir.VAR;
  const gy = (x, z) => Math.max(base.site.padH, -WW.terrain.depthAt(x, z));
  const CLS = v => WW.airfieldLayout.CLS[V()[v].cls || 'S'];

  // ---------- pooled plane models: parked and wrecked ----------
  function model(v) { const m = WW.air._pool.get(V()[v].model || V()[v].kind, base.nation); if (m.payload) m.payload.visible = true; if (m.disc) { m.disc.visible = false; m.blades.visible = true; } return m; }
  function place(m, v, x, z, h, wreck, age) {
    const gear = V()[v].gear || WW.air._pool.deckY;
    m.group.position.set(x, gy(x, z) + gear - (wreck ? gear * 0.55 : 0), z);
    m.group.rotation.set(wreck ? 0.32 : 0, -h, wreck ? -0.12 : 0);
    if (wreck && m.payload) m.payload.visible = false;
  }
  function parkedPlanes(now) {
    const seen = new Set();
    for (const s of base.slots) {
      const want = s.spot && (s.state === 'parked' || s.state === 'rearm' || s.state === 'wreck');
      let m = planes.get(s);
      if (!want) { if (m) { WW.air._pool.release(m); planes.delete(s); } continue; }
      if (!m) { m = model(s.v); planes.set(s, m); }
      place(m, s.v, s.x, s.z, s.h, s.state === 'wreck');
      if (s.state === 'wreck') burnAt(s.x, s.z, now - (s.wreckT || now), 40);
      seen.add(s);
    }
    for (const w of base.wrecks || []) {
      let m = wrecks.get(w);
      if (!m) { m = model(w.v); wrecks.set(w, m); }
      place(m, w.v, w.x, w.z, w.h, true); burnAt(w.x, w.z, now - w.t, 25);
    }
    for (const [w, m] of wrecks) if (!(base.wrecks || []).includes(w)) { WW.air._pool.release(m); wrecks.delete(w); }
  }
  let burnDt = 0;
  function burnAt(x, z, age, life) {
    if (age > life || !(burnDt > 0)) return;
    const k = 1 - age / life, y = gy(x, z);
    if (R() < 6 * k * burnDt) WW.fx.fire(x + rr(-1, 1), y + rr(0.3, 1.2), z + rr(-1, 1));
    if (R() < 2.2 * k * burnDt) WW.fx.smoke(x + rr(-0.8, 0.8), y + 1.5, z + rr(-0.8, 0.8), true, rr(1.2, 2));
  }

  // ---------- engines: warm-up and taxi ----------
  function engines(rdt, sdt) {
    for (const p of WW.world.planes) {
      if (p.carrier !== base || !p.alive || p.removed || !WW.landGround.onGround(p)) continue;
      const warm = p.rwPh === 'warm', k = warm ? Math.min(1, p.rwT / Math.max(0.5, p.warm)) : 1;
      if (p.prop) p.prop.rotation.x += rdt * (warm ? 6 + 34 * k * k : 30);
      if (warm && sdt > 0) { // exhaust: a cough of smoke at the start, a thin haze after
        const C = CLS(p.variant), nx = p.x + Math.cos(p.heading) * C.len * 0.32, nz = p.z + Math.sin(p.heading) * C.len * 0.32;
        if (R() < (p.rwT < 1.2 ? 7 : 1.2) * sdt) WW.fx.smoke(nx + rr(-0.4, 0.4), p.y + 0.3, nz + rr(-0.4, 0.4), p.rwT < 1.2, p.rwT < 1.2 ? 0.9 : 0.5);
      }
    }
  }

  // ---------- figures ----------
  function figure(x, z, face, nation, role, run) {
    if (fig >= MAX_FIG || !WW.crew || !WW.crew.addFigure) return;
    const bob = run ? Math.abs(Math.sin(performance.now() / 70 + x)) * 0.05 : 0;
    if (trace) trace.figs.push({ x, z, role });
    _q.setFromEuler(_e.set(0, -face, 0)); _p.set(x, gy(x, z) + bob, z); _s.set(FIG_K, FIG_K, FIG_K);
    WW.crew.addFigure(_m.compose(_p, _q, _s), nation, role); fig++;
  }
  // a slot's crew: offsets in the spot frame (f along the nose, r to the right), kept per slot
  function crewOf(s) {
    let c = crews.get(s);
    if (!c) {
      const C = CLS(s.v), n = s.state === 'rearm' ? 3 : 2;
      c = { men: [], left: null };
      // nose, beside each wingtip, behind the tail: never under a wing (the figure would stand through it)
      const posts = [[C.len / 2 + 0.7, rr(-0.6, 0.6)], [rr(-0.3, 0.6) * C.len / 4.6, C.span / 2 + 0.35], [rr(-0.8, 0.2) * C.len / 4.6, -C.span / 2 - 0.35], [-C.len / 2 - 0.5, rr(-0.5, 0.5)]];
      for (let i = 0; i < 4; i++) c.men.push({ f: posts[i][0], r: posts[i][1], role: i === 0 ? 'o' : (R() < 0.3 ? 'y' : 'c'), ph: R() * 6.28, on: i < n });
      crews.set(s, c);
    }
    return c;
  }
  function crewsAt(cam, now) {
    const nat = base.nation, scramble = performance.now() / 1000 - scrT < 10;
    for (const s of base.slots) {
      if (!s.spot) continue;
      const sp = s.spot, dx = sp.x - cam.x, dz = sp.z - cam.z;
      if (dx * dx + dz * dz > NEAR_FIG * NEAR_FIG) continue;
      const c = crewOf(s), h = sp.h, fx = Math.cos(h), fz = Math.sin(h), rx = -fz, rz = fx;
      let away = 0, run = false;
      if (s.state === 'out') { // the plane is warming up or has gone: the crew backs off, then leaves
        const p = s.plane;
        if (!c.left) c.left = now;
        const t = now - c.left; if (t > 18) continue;
        away = Math.min(1, t / (scramble ? 1.2 : 3)) * (scramble ? 1.8 : 1.2); run = scramble && t < 2;   // clear of the props, short of the next revetment
        if (p && p.alive && p.rwPh === 'warm' && t < 18) { // the plane captain stays at the wingtip till it rolls
          const C = CLS(s.v); figure(p.x + rx * (C.span / 2 + 0.9) + fx * 1.2, p.z + rz * (C.span / 2 + 0.9) + fz * 1.2, h + Math.PI / 2 + Math.PI, nat, 'y', false);
        }
      } else if (s.state === 'parked' || s.state === 'rearm') c.left = null;
      else continue;
      const n = s.state === 'rearm' ? 3 : 2;
      for (let i = 0; i < c.men.length; i++) {
        const m = c.men[i]; if (i >= n && s.state !== 'out') continue; if (i >= 3) continue;
        const C = CLS(s.v), sw = i === 0 && s.state === 'out';   // the man at the nose steps out to the side: the plane taxis out past him
        const mf = sw ? C.len * 0.3 : m.f, mr = sw ? (m.r >= 0 ? 1 : -1) * (C.span / 2 + 0.6) : m.r;
        const ox = fx * mf + rx * mr, oz = fz * mf + rz * mr, d = Math.hypot(ox, oz) || 1;
        const x = sp.x + ox + ox / d * away, z = sp.z + oz + oz / d * away;
        const face = away > 0 ? Math.atan2(oz, ox) : Math.atan2(-oz, -ox) + Math.sin(now * 0.4 + m.ph) * 0.4; // toward the plane / away from it
        figure(x, z, face, nat, m.role, run);
      }
    }
  }
  function repairGang(cam, now) {
    const rp = base.repairing, c = rp && rp.crater;
    if (!c || !base.craters.includes(c) || now - rp.at > 30 || base.neutralized) { vehSet('roller', null); return; }
    if ((c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 > NEAR_FIG * NEAR_FIG) { vehSet('roller', null); return; }
    const t = performance.now() / 1000, rw = base.runways[rp.runway] || base.runways[0], hx = Math.cos(rw.h), hz = Math.sin(rw.h);
    let busy = false;   // a plane rolling or taxiing close by: the gang steps well back off the runway
    for (const p of WW.world.planes) if (p.carrier === base && p.alive && WW.landGround.onGround(p) && Math.hypot(p.x - c.x, p.z - c.z) < c.r + 12) busy = true;
    for (let i = 0; i < 6; i++) { // shovels: a bob in the figure's height is the work
      const a = i / 6 * Math.PI * 2 + 0.4, r = c.r * 1.25 + 0.6 + (busy ? 6 : 0);
      figure(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, a + Math.PI + Math.sin(t * 3 + i) * 0.3, base.nation, i === 0 ? 'o' : 'c', i % 2 === 0);
    }
    const sw = Math.sin(t * 0.5) * (c.r + 2.5); // the roller works to and fro beside the hole
    const ro = { x: c.x + hx * (c.r + 3 + sw * 0.4) - hz * 2.2, z: c.z + hz * (c.r + 3 + sw * 0.4) + hx * 2.2, h: rw.h };
    vehSet('roller', busy && inWay(ro, groundPlanes()) ? null : [ro]);   // a plane taxiing by: the roller is driven off
  }

  // ---------- vehicles ----------
  function vehMesh(kind) {
    const k = kind + base.nation;
    if (!veh[k]) {
      const m = new THREE.InstancedMesh(WW.baseModels.vehicle(kind, base.nation), WW.models._mat(0xffffff), VCAP[kind]);
      m.castShadow = true; m.count = 0; m.frustumCulled = false; WW.scene.add(m); veh[k] = { mesh: m, kind, list: null };
    }
    return veh[k];
  }
  const fixed = {}; // vehicles placed directly this frame (the roller)
  function vehSet(kind, list) { fixed[kind] = list; }
  function drawVehicles(on) {
    const per = {};
    if (on) {
      const gp = groundPlanes();
      for (const t of trips) {
        let q = tripPos(t);
        if (burnDt > 0 && !(q && inWay(q, gp, t.follow)) && inWay(tripPos(t, 0.8), gp, t.follow)) { t.t0 += burnDt; t.until += burnDt; q = tripPos(t); } // give way: wait short of a plane's path (already in it: drive on clear)
        if (q) { q.trip = t; (per[t.kind] = per[t.kind] || []).push(q); }
      }
      for (const k in fixed) if (fixed[k]) (per[k] = per[k] || []).push(...fixed[k]);
    }
    for (const kind in VCAP) {
      const list = per[kind] || [], vm = list.length || veh[kind + base.nation] ? vehMesh(kind) : null; if (!vm) continue;
      const n = Math.min(list.length, VCAP[kind]);
      for (let i = 0; i < n; i++) {
        const q = list[i]; if (trace) trace.veh.push({ kind, x: q.x, z: q.z, h: q.h, t: q.trip && { p0: q.trip.pts[0], n: q.trip.pts.length, out: (WW.time.now - q.trip.t0) * VSPD[kind], len: q.trip.len } });
        _q.setFromEuler(_e.set(0, -q.h, 0)); _p.set(q.x, gy(q.x, q.z) + 0.02, q.z); _s.setScalar(WW.baseModels.VEH_K || 1);
        vm.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      vm.mesh.count = n; vm.mesh.visible = n > 0; vm.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  // a trip: out along path (site-local points -> world), wait until t.until, back the same way
  function trip(kind, ptsL, until, follow, t0) {
    const L = base.layout, pts = ptsL.map(p => L.toW(p[0], p[1]));
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (t0 === undefined) t0 = WW.time.now;
    trips.push({ kind, pts, len, t0, until: Math.max(until, t0 + len / VSPD[kind] + 4), follow });
    if (trips.length > 40) trips.shift();
  }
  function along(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (d <= l || i === pts.length - 1) { const f = l ? Math.min(1, d / l) : 1; return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: Math.atan2(b.z - a.z, b.x - a.x) }; }
      d -= l;
    }
    return null;
  }
  // the planes on the ground (taxiing / rolling, and parked in their revetments): [x, z, heading, class, moving, plane]
  function groundPlanes() {
    const L = [];
    for (const p of WW.world.planes) if (p.carrier === base && WW.landGround.onGround(p)) L.push([p.x, p.z, p.heading, CLS(p.variant), true, p]);
    for (const s of base.slots) if (s.spot && (s.state === 'parked' || s.state === 'rearm')) L.push([s.x, s.z, s.h, CLS(s.v), false, null]);
    return L;
  }
  // is a vehicle at q in a plane's way? a parked plane: its own footprint plus a little; a moving one: well ahead and
  // beside it (it does not stop for trucks). own: the plane a crash truck races to.
  function inWay(q, gp, own) {
    if (!q) return false;
    for (const g of gp) {
      if (g[5] && g[5] === own) continue;
      const C = g[3], dx = q.x - g[0], dz = q.z - g[1], c = Math.cos(g[2]), s = Math.sin(g[2]), a = dx * c + dz * s, b = -dx * s + dz * c;
      if (g[4] ? a > -C.len / 2 - 1.2 && a < C.len / 2 + 4 && Math.abs(b) < C.span / 2 + 1.2 : Math.abs(a) < C.len / 2 + 0.5 && Math.abs(b) < C.span / 2 + 0.4) return true;
    }
    return false;
  }
  function tripPos(t, ahead) {
    const now = WW.time.now + (ahead || 0), sp = VSPD[t.kind];
    if (t.follow) { const p = t.follow; if (p.alive && !p.removed && WW.landGround.onGround(p)) { const e = t.pts[t.pts.length - 1], o = CLS(p.variant).span / 2 + 1.6; e.x = p.x - Math.sin(p.heading) * o; e.z = p.z + Math.cos(p.heading) * o; } }
    const out = (now - t.t0) * sp; if (out < 0) return null;   // not out of the garage yet
    if (out < t.len) return along(t.pts, out);
    if (now < t.until) { const q = along(t.pts, t.len); if (t.kind === 'crash' && R() < 0.15) WW.fx.smoke(q.x, gy(q.x, q.z) + 1, q.z, false, 0.8); return q; }
    const back = (now - t.until) * sp; if (back >= t.len) { t.done = true; return null; }
    const q = along(t.pts, t.len - back); q.h += Math.PI; return q;
  }
  // site-local route from a facility to a point on the network beside a spot, along the taxiways. The trucks keep to
  // the verge, clear of a taxiing plane's wingtips: k off the centreline (the biggest plane class on the taxiways and
  // columns, the row's own class on a row lane), and stop by the plane's nose.
  const HW = () => 0.55 * (WW.baseModels.VEH_K || 1) + 0.15, KL = () => WW.airfieldLayout.CLS.L.span / 2 + HW(), KR = cls => WW.airfieldLayout.CLS[cls].span / 2 + HW();
  function route(f, sp, off) {
    const L = base.layout, TU = L.TAXI_U, TV = L.TAXI_V, e = f.u >= 0 ? 1 : -1, sd = sp.side, k = KL(), kr = KR(sp.cls);
    const x = exitTo(f, e), pts = x.pts;
    if (x.fs !== sd) pts.push([e * (TU + k), x.fs * (TV + k)], [e * (TU + k), sd * (TV + k)]);   // across the overrun past the runway end
    pts.push([sp.col + k * e, sd * (TV + k)], [sp.col + k * e, sp.laneV + sd * kr], [sp.u + Math.sign(off) * 0.8, sp.laneV + sd * kr]);
    return pts;
  }
  // where a vehicle comes out of a facility: its edge (footprint radius + 1.5) toward the next point, not its middle
  function door(f, u1, v1) {
    const fr = facR(f) + 0.8;   // the model's own footprint
    const du = u1 - f.u, dv = v1 - f.v, d = Math.hypot(du, dv) || 1, r = Math.min(d, fr);
    return [f.u + du / d * r, f.v + dv / d * r];
  }
  // a site-local point inside (or within a truck's half width of) a revetment
  function inRevet(u, v, own, skipOwn) {
    if (inFac(u, v, own, skipOwn)) return true;
    for (const sp of base.layout.spots) {
      const a = (sp.v - v) * sp.side, c = u - sp.u, hl = sp.len / 2, hs = sp.span / 2;
      if (a > -hl - 2.8 && a < hl + 0.7 && Math.abs(c) < hs + 2.7) return true;
    }
    return false;
  }
  function legClear(a, b, own) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
    for (let i = 0; i <= n; i++) if (inRevet(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, own)) return false;
    return true;
  }
  // inside a facility's model footprint (a circle round it, + a truck's half width)?
  const facK = new Map();   // facility -> [radius, u, v] (site-local; shore batteries have no u / v of their own)
  function facR(f) {
    let k = facK.get(f);
    if (!k) {
      const part = WW.baseFx._built && WW.baseFx._built() && WW.baseFx._built().parts.find(q => q.f === f), g = part && part.mesh.geometry;
      if (g && !g.boundingBox) g.computeBoundingBox();
      const q = base.layout.toL(f.x, f.z);
      facK.set(f, k = [g ? Math.hypot(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.z - g.boundingBox.min.z) / 2 : (f.r || 3) + 0.5, q.u, q.v]);
    }
    return k[0];
  }
  function inFac(u, v, own, skipOwn) {
    for (const g of base.facilities) { if (skipOwn && g === own) continue; const r = facR(g), k = facK.get(g); if (Math.hypot(k[1] - u, k[2] - v) < r + (g === own ? 0.4 : 0.6)) return true; } // own: the door (+0.8) is just outside
    return false;
  }
  // from a facility's door out to the parallel taxiway (site-local points, ending on the taxiway line of side fs), round
  // the revetments: straight to the taxiway corner at the facility's end (e), else an L-shaped way to it, else the
  // shortest way round on a grid (gridWay)
  function exitTo(f, e) {
    const L = base.layout, TU = L.TAXI_U, TV = L.TAXI_V, k = KL(), fs0 = f.v >= 0 ? 1 : -1, t = [e * (TU + k), fs0 * (TV + k)];
    for (const c of [[t], [[f.u, t[1]], t], [[t[0], f.v], t]]) {
      if (Math.hypot(c[0][0] - f.u, c[0][1] - f.v) < facR(f) + 1.5) continue;   // the corner is at the building itself
      const P = [door(f, c[0][0], c[0][1])].concat(c); let ok = true;
      for (let i = 1; i < P.length && ok; i++) ok = legClear(P[i - 1], P[i], f);
      if (ok) return { pts: P, fs: fs0 };
    }
    const key = f.u.toFixed(1) + ',' + f.v.toFixed(1) + ':' + e;
    if (!ways.has(key)) ways.set(key, gridWay(f, t));
    const w = ways.get(key);
    return w ? { pts: w.map(q => q.slice()), fs: fs0 } : { pts: [door(f, t[0], t[1]), t], fs: fs0 };
  }
  // shortest way on a 1 u grid (site-local, land only, round the revetments and the other facilities), then pulled
  // straight (each point to the farthest one it sees). Null when walled in.
  const ways = new Map();
  function gridWay(f, t) {
    const L = base.layout, U0 = -90, V0 = -80, NU = 181, NV = 161, id = (i, j) => j * NU + i;
    const blocked = (u, v) => inRevet(u, v, f, true) || !L.land(u, v);   // out of its own building from the middle
    const start = [f.u, f.v], si = Math.round(start[0] - U0), sj = Math.round(start[1] - V0), ti = Math.round(t[0] - U0), tj = Math.round(t[1] - V0);
    const prev = new Int32Array(NU * NV).fill(-2), q = [id(si, sj)]; prev[q[0]] = -1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % NU, j = (c - i) / NU;
      if (i === ti && j === tj) break;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NU || b >= NV) continue;
        const n = id(a, b); if (prev[n] !== -2 || blocked(a + U0, b + V0)) continue;
        prev[n] = c; q.push(n);
      }
    }
    if (prev[id(ti, tj)] === -2) return null;
    const P = []; for (let c = id(ti, tj); c >= 0; c = prev[c]) { const i = c % NU; P.push([i + U0, (c - i) / NU + V0]); }
    P.reverse(); P[P.length - 1] = t;
    let i0 = 0; while (i0 < P.length - 2 && Math.hypot(P[i0][0] - f.u, P[i0][1] - f.v) < facR(f) + 0.8) i0++;
    P.splice(0, i0); P[0] = door(f, P[0][0], P[0][1]);  // the door: where the way leaves the building
    const out = [P[0]];
    for (let a = 0; a < P.length - 1;) { let b = P.length - 1; while (b > a + 1 && !legClear(P[a], P[b], f)) b--; out.push(P[b]); a = b; }
    return out;
  }
  function nearestFac(kind, x, z) {
    let best = null, bd = 1e18;
    for (const f of base.facilities) if (f.kind === kind && !f.out && f.u !== undefined) { const d = (f.x - x) ** 2 + (f.z - z) ** 2; if (d < bd) { bd = d; best = f; } }
    return best;
  }
  // the rearm trips are a pure function of each slot's rearm (start, ready): they survive warps and fast-forwards
  function rearmTrips() {
    const now = WW.time.now;
    for (const s of base.slots) {
      if (s.state !== 'rearm' || !s.spot || s.rearmT === undefined) continue;
      const key = s.i + ':' + s.rearmT; if (prev.get(s) === key) continue; prev.set(s, key);
      const sp = s.spot, fu = nearestFac('fuel', sp.x, sp.z), am = nearestFac('ammo', sp.x, sp.z), kind = V()[s.v].kind;
      if (fu) trip('fuel', route(fu, sp, 1.4), s.readyAt, null, s.rearmT);
      if (am && kind !== 'fighter') trip('bombs', route(am, sp, -1.4), s.readyAt, null, s.rearmT + 2);
    }
    trips = trips.filter(t => !t.done);
  }
  function onEvent(e) {
    if (WW.simOnly || !e || !e.base || e.base !== base) return;
    if (e.kind === 'scramble') scrT = performance.now() / 1000;
    if (e.kind === 'crashLanding' && e.plane) { // the crash truck from the tower (or a hangar) to the plane on the runway
      const f = nearestFac('tower', e.x, e.z) || nearestFac('hangar', e.x, e.z); if (!f) return;
      const L = base.layout, q = L.toL(e.plane.x, e.plane.z), TU = L.TAXI_U, TV = L.TAXI_V, ee = f.u >= 0 ? 1 : -1, fs = f.v >= 0 ? 1 : -1;
      // along the verge (not the taxiway or its hold-short connector), then straight across to the runway beside the plane
      const x = exitTo(f, ee), k = KL(), cu = WW.clamp(q.u + 20 * Math.sign(-ee), -TU + 4, TU - 4);
      trip('crash', [...x.pts, [cu, x.fs * (TV + k)], [cu, x.fs * 6], [q.u, x.fs * 4]], WW.time.now + 40, e.plane);
    }
  }

  // ---------- per frame (base_fx.js) ----------
  let lastT = 0;
  function update(rdt, b) {
    if (WW.simOnly || !WW.scene || !b || !b.layout || !b.slots) return;
    if (base !== b) { clear(); base = b; lastT = WW.time.now; }
    const now = WW.time.now, sdt = Math.max(0, Math.min(0.5, now - lastT)); lastT = now; burnDt = sdt;
    parkedPlanes(now);
    rearmTrips();
    const cam = WW.camera.position, near = (cam.x - b.x) ** 2 + (cam.z - b.z) ** 2 < FAR * FAR;
    fig = 0; if (trace) { trace.figs.length = 0; trace.veh.length = 0; }
    for (const k in fixed) fixed[k] = null;
    if (near) { engines(rdt, sdt); crewsAt(cam, now); repairGang(cam, now); }
    drawVehicles(near);
  }
  function clear() {
    for (const m of planes.values()) WW.air._pool.release(m);
    for (const m of wrecks.values()) WW.air._pool.release(m);
    planes.clear(); wrecks.clear(); prev.clear(); crews.clear(); ways.clear(); facK.clear(); trips = [];
    for (const k in veh) { veh[k].mesh.count = 0; veh[k].mesh.visible = false; }
    base = null;
  }
  WW.on('baseEvent', onEvent);
  WW.baseGroundFx = { update, clear, _parked: () => [...planes.values()], _trips: () => trips, _stats: () => ({ planes: planes.size, wrecks: wrecks.size, trips: trips.length, figures: fig }),
    _trace: on => { trace = on ? { figs: [], veh: [] } : null; return trace; } };
})();
