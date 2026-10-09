// base_life.js - WW.baseLife: the island base's people (visual only: Math.random, never WW.rand; off in sim-only mode;
// nothing feeds back into the sim). Driven from base_fx.js each frame after base_ground_fx.js. Figures are the shared
// crew instances (WW.crew.addFigure, with an arm pose); movement runs in sim time (it pauses and warps with the
// battle), along the ways of base_life_paths.js. The base's mood comes from the sim (read only):
//  - peace (no alarm yet): a chow line at the mess door, PT drill on the drill ground, a card game, the laundry, a
//    sentry at the command post, men idling at the hut doors and walking between the buildings.
//  - ALARM (island_base.js base.alarm, the siren): everyone sprints. Gun crews to the AA and machine-gun pits (the
//    guns elevate and train on the threat bearing), pilots from the huts to the fighters (they climb in), the rest
//    into the slit trenches; an officer waves them on at the command post; trucks and the jeep race out
//    (base_life_vehicles.js). The flag keeps flying.
//  - under attack (enemy planes low over the field, bombs or shells landing): whoever is caught in the open hits the
//    dirt; stretcher teams carry the wounded to the sick bay; fire crews run hoses to whatever burns.
//  - after the raid (the sky clear for a while): the trenches empty, the work starts again (the drill and the cards a
//    while later), the gun crews stay at their pits; the repair gangs (base_ground_fx.js) fill the craters.
// Every figure keeps out of the planes on the ground and the trucks: it waits short of a moving one's way, and
// steps clear if one comes at it (tests/base_clip.js samples it every 0.25 s).
window.WW = window.WW || {};
(function () {
  'use strict';
  const R = Math.random, rr = (a, b) => a + (b - a) * R(), PI = Math.PI;
  const FAR = 420, DRAW = 135, MAXP = 110, WALK = 0.8, RUN = 2.4, CALM = 30;
  let base = null, built = null, P = [], S = null, phase = 'peace', lastT = 0, hitSeen = -1e9, calmT = 0, threatT = -1e9, afterT = 0, nextTeam = 0;
  const FIG_K = 2 * Math.pow(WW.cfg.PLANE_K || 1, 0.73), G0 = { fail: 0 };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(), pose = { aL: 0, aR: 0, oL: null, oR: null };
  const gy = (x, z) => Math.max(base.site.padH, -WW.terrain.depthAt(x, z));
  const dir = a => [Math.cos(a), Math.sin(a)];
  const W = () => WW.baseLifePaths;

  // ---------- the places: doors, the chow line, the drill ground, trenches, pits ----------
  function door(d, out) { const c = dir(d.a); return { x: d.x + c[0] * (d.hx + (out || 1.0)), z: d.z + c[1] * (d.hx + (out || 1.0)), face: d.a + PI }; }
  function sites() {
    const D = base.decor || [], s = { doors: [], huts: [], trenches: [], pits: [], mess: null, sick: null, drill: null, table: null, laundry: null, cp: null, flag: null };
    for (const d of D) {
      if (d.kind === 'hut' || d.kind === 'tent' || d.kind === 'mess' || d.kind === 'sick' || d.kind === 'radio' || d.kind === 'cp') { const q = door(d); q.d = d; if (W().stand(q.x, q.z)) { s.doors.push(q); if (d.kind === 'hut' || d.kind === 'tent') s.huts.push(q); } }
      if (d.kind === 'mess') s.mess = d; if (d.kind === 'sick') s.sick = door(d); if (d.kind === 'drill') s.drill = d; if (d.kind === 'table') s.table = d;
      if (d.kind === 'laundry') s.laundry = d; if (d.kind === 'cp') s.cp = door(d, 0.7); if (d.kind === 'flag') s.flag = d;
      if (d.kind === 'trench') { // crouching places along the three bays (models_base_life.js trench)
        const c = dir(d.a), sl = [];
        for (const [bx, bz] of [[-2.0, 0.25], [0, -0.25], [2.0, 0.25]]) for (const o of [-0.7, 0, 0.7]) sl.push({ x: d.x + c[0] * (bx + o) - c[1] * bz, z: d.z + c[1] * (bx + o) + c[0] * bz, who: null });
        s.trenches.push({ d, slots: sl });
      }
      if (d.kind === 'mg') s.pits.push({ f: d, r: 0.6, n: 2 });
    }
    for (const f of base.facilities) if (f.kind === 'aa') s.pits.push({ f, r: 1.15, n: 3 });
    for (const p of s.pits) { p.slots = []; for (let i = 0; i < p.n; i++) { const a = (f => f.a || 0)(p.f) + PI + (i - (p.n - 1) / 2) * 1.3; p.slots.push({ x: p.f.x + Math.cos(a) * p.r, z: p.f.z + Math.sin(a) * p.r, who: null }); } }
    if (s.mess) { // the chow line: out of the mess door and away along its end wall (the side that is open)
      const c = dir(s.mess.a), dq = door(s.mess, 0.45);
      for (const sv of [1, -1]) {
        const L = [];
        for (let i = 0; i < 7; i++) { const o = sv * (0.3 + i * 0.5), x = dq.x - c[1] * o + c[0] * 0.15 * i / 6, z = dq.z + c[0] * o + c[1] * 0.15 * i / 6; if (W().stand(x, z)) L.push({ x, z, face: Math.atan2(dq.z - z, dq.x - x) }); else break; }
        if (!s.chow || L.length > s.chow.length) s.chow = L;
      }
      s.messDoor = dq;
    }
    return s;
  }
  // ---------- people ----------
  function man(x, z, role, act, o) {
    if (P.length >= MAXP) return null;
    const p = Object.assign({ x, z, face: rr(0, 2 * PI), role: role || 'c', act: act || 'idle', path: null, pi: 0, spd: WALK, ph: R() * 6.28, wait: 0, gone: false, at: 0, prone: 0 }, o || {});
    P.push(p); return p;
  }
  // send p to (x, z) along the ways; then = the act on arrival, face = its heading there
  // via: a post close to something solid (a seat at the card table) is reached, and left, straight from a point outside
  function go(p, x, z, run, then, face, via) {
    const from = p.via && Math.hypot(p.x - p.via.x, p.z - p.via.z) < 2.5 ? p.via : p, to = via || { x, z };
    const w = W().path(from.x, from.z, to.x, to.z);
    if (w === undefined) { p.pend = [x, z, run, then, face, via]; p.path = null; p.act = run ? 'ready' : p.act; return; } // planned next frame
    p.pend = null;
    if (!w) { p.path = null; p.act = run ? 'prone' : 'idle'; p.at = WW.time.now + 3; G0.fail++; return; }   // no way there: stays put (in a hurry: hits the dirt)
    p.path = (from === p ? [] : [{ x: from.x, z: from.z }]).concat(w, via ? [via] : [], [{ x, z }]); p.via = via || null; p.goal = [x, z, run, then, face, via]; p.pi = 0; p.spd = run ? RUN * rr(0.9, 1.1) : WALK * rr(0.85, 1.15);
    p.next = then || 'idle'; p.goalFace = face; p.act = run ? 'run' : 'walk'; p.wait = 0;
  }
  function peace() { // the peacetime posts (re-used after the raid)
    const out = [];
    if (S.chow) S.chow.forEach((q, i) => out.push({ act: 'chow', x: q.x, z: q.z, face: q.face, i }));
    if (S.drill) { // an instructor and three ranks
      const d = S.drill, c = dir(d.a);
      out.push({ act: 'instr', x: d.x + c[0] * 2.6, z: d.z + c[1] * 2.6, face: d.a + PI, role: 'o' });
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const a = -1 + r * 0.9, b = -1.5 + k * 1.0; out.push({ act: 'drill', x: d.x + c[0] * a - c[1] * b, z: d.z + c[1] * a + c[0] * b, face: d.a }); }
    }
    if (S.table) for (let k = 0; k < 4; k++) { const a = S.table.a + k * PI / 2, c = Math.cos(a), sn = Math.sin(a); out.push({ act: 'cards', x: S.table.x + c * 0.62, z: S.table.z + sn * 0.62, face: a + PI, via: { x: S.table.x + c * 1.9, z: S.table.z + sn * 1.9 } }); }
    if (S.laundry) { const c = dir(S.laundry.a); out.push({ act: 'laundry', x: S.laundry.x + c[0] * 0.8 - c[1] * 0.55, z: S.laundry.z + c[1] * 0.8 + c[0] * 0.55, face: S.laundry.a + PI / 2 }); }
    if (S.cp) out.push({ act: 'sentry', x: S.cp.x, z: S.cp.z, face: S.cp.face + PI, role: 'o' });
    S.doors.slice(0, 14).forEach((q, i) => { // one or two men loafing at each door, facing out (a smoke, a chat)
      const c = dir(q.face + PI), n = c[1], m = -c[0];
      for (let k = 0; k < (i % 3 ? 1 : 2); k++) { const o = (k ? -1 : 1) * 0.4; out.push({ act: 'idle', x: q.x + c[0] * 0.3 + n * o, z: q.z + c[1] * 0.3 + m * o, face: q.face + PI + (k ? 0.9 : -0.9) * (i % 3 ? 0.4 : 1) }); }
    });
    return out.filter(q => W().stand(q.x, q.z, 0.3));
  }
  function populate() {
    P = [];
    for (const q of peace()) man(q.x, q.z, q.role || (R() < 0.15 ? 'o' : 'c'), q.act, { face: q.face, post: q, via: q.via || null });
    for (let i = 0; i < 16 && S.doors.length; i++) { const d = S.doors[Math.floor(R() * S.doors.length)]; const p = man(d.x, d.z, R() < 0.2 ? 'o' : 'c', 'idle'); if (p) { p.walker = true; p.at = -rr(0, 8); } }
  }
  // ---------- the alarm: everyone to a station ----------
  function free(list) { return list.find(s => !s.who); }
  function nearest(list, x, z, ok) { let b = null, bd = 1e18; for (const s of list) { if (ok && !ok(s)) continue; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; b = s; } } return b; }
  function alarm() {
    const live = P.filter(p => !p.gone && !p.bearer && !p.casualty);
    for (const pit of S.pits) for (const sl of pit.slots) { // gun crews: the nearest men to each pit
      if (sl.who || pit.f.out) continue;
      const p = nearest(live.filter(q => !q.station && !q.fire), sl.x, sl.z); if (!p) break;
      p.station = sl; sl.who = p; go(p, sl.x, sl.z, true, 'gun', Math.atan2(pit.f.z - sl.z, pit.f.x - sl.x) + PI); p.role = 'g'; p.delay = WW.time.now + rr(0, 0.8);
    }
    for (const p of live) {
      if (p.station || p.fire) continue;
      if (p.act === 'sentry') { p.act = 'wave'; continue; }
      const t = trenchFor(p);
      if (t) { p.station = t; t.who = p; go(p, t.x, t.z, true, 'trench', rr(0, 2 * PI)); p.delay = WW.time.now + rr(0.2, 1.6); } else { p.act = 'prone'; proneFace(p); }   // a moment's stare at the sky, then the sprint
    }
    pilots();
  }
  function trenchFor(p) { let b = null, bd = 1e18; for (const t of S.trenches) for (const sl of t.slots) { if (sl.who) continue; const d = (sl.x - p.x) ** 2 + (sl.z - p.z) ** 2; if (d < bd) { bd = d; b = sl; } } return b; }
  // pilots run from the huts to the parked fighters, to the wingtip in front of the wing, and climb in
  function pilots() {
    const V = WW.landAir.VAR, fs = base.slots.filter(s => s.spot && s.state === 'parked' && V[s.v] && V[s.v].kind === 'fighter').slice(0, 6);
    let k = 0;
    for (const s of fs) {
      const d = nearest(S.huts.filter(h => (h.n || 0) < 2), s.x, s.z); if (!d) break; d.n = (d.n || 0) + 1;   // two pilots at most from a hut door, one after the other
      const sp = s.spot, C = WW.airfieldLayout.CLS[V[s.v].cls || 'S'], c = dir(sp.h), sd = R() < 0.5 ? 1 : -1;
      const lane = WW.airfieldLayout && base.layout.toW(sp.u, sp.laneV), nose = { x: sp.x + c[0] * (C.len / 2 + 0.9), z: sp.z + c[1] * (C.len / 2 + 0.9) };
      const tip = { x: sp.x + c[0] * C.len * 0.27 - c[1] * sd * (C.span / 2 + 0.35), z: sp.z + c[1] * C.len * 0.27 + c[0] * sd * (C.span / 2 + 0.35) };
      const p = man(d.x, d.z, 'o', 'idle'); if (!p) break;
      p.delay = WW.time.now + 0.4 + (d.n - 1) * 1.1 + k++ * 0.25;
      p.pilot = s; go(p, lane.x, lane.z, true, 'climb', sp.h + PI); if (p.pend) p.tail = [nose, tip]; else if (p.path) p.path.push(nose, tip); else p.gone = true;
    }
  }
  function standDown() { // after the raid: out of the trenches, back to work; the gun crews stay
    const posts = peace().filter(q => q.act !== 'drill' && q.act !== 'cards' && q.act !== 'instr');
    for (const p of P) {
      if (p.gone || p.bearer || p.casualty || p.fire || (p.station && p.act === 'gun')) continue;
      if (p.station) { p.station.who = null; p.station = null; }
      const q = posts.shift();
      if (q) { p.post = q; go(p, q.x, q.z, false, q.act, q.face, q.via); } else { p.walker = true; p.act = 'idle'; p.at = WW.time.now + rr(0, 6); }
    }
  }
  function resumeLeisure() { // the drill and the cards, a while after the raid
    for (const q of peace()) if (q.act === 'drill' || q.act === 'cards' || q.act === 'instr') {
      const d = nearest(S.doors, q.x, q.z); if (!d) continue;
      const p = man(d.x, d.z, q.role || 'c', 'idle'); if (p) { p.post = q; go(p, q.x, q.z, false, q.act, q.face, q.via); }
    }
  }
  // stretcher teams: two bearers and the wounded man from near a hit to the sick bay
  function team(x, z) {
    if (!S.sick || P.filter(p => p.bearer && !p.gone).length >= 4) return;
    const L = base.layout, q = L.toL(x, z), a = R() * 2 * PI;
    for (let k = 0; k < 8; k++) {
      const u = q.u + Math.cos(a + k) * (4 + k), v = q.v + Math.sin(a + k) * (4 + k), w = L.toW(u, v);
      if (!W().open(w.x, w.z)) continue;
      const lead = man(w.x, w.z, 'c', 'idle', { bearer: 1 }); if (!lead) return;
      lead.team = { cas: true }; go(lead, S.sick.x, S.sick.z, false, 'inside'); lead.spd = WALK * 1.1;
      return;
    }
  }
  // fire crews: three men with a hose at whatever burns (the camp or a facility), while it burns
  function fires(now) {
    const burning = [...(base.decor || []), ...base.facilities].filter(f => f.out && f.kind !== 'drill' && f.kind !== 'trench' && now - f.outAt < 140 && now - f.outAt > 2);
    for (const f of burning.slice(0, 3)) {
      if (P.some(p => p.fire === f && !p.gone)) continue;
      const d = nearest(S.doors, f.x, f.z) || S.cp; if (!d) return;
      for (let k = 0; k < 3; k++) {
        const r = (f.hx ? Math.hypot(f.hx, f.hz) : f.r) + 1.1, a0 = Math.atan2(d.z - f.z, d.x - f.x) + (k - 1) * 0.6, x = f.x + Math.cos(a0) * r, z = f.z + Math.sin(a0) * r;
        if (!W().stand(x, z)) continue;
        const p = man(d.x, d.z, k ? 'c' : 'r', 'idle'); if (!p) return;
        p.fire = f; go(p, x, z, true, 'hose', a0 + PI);
      }
    }
    for (const p of P) if (p.fire && !p.gone && p.act === 'hose' && now - p.fire.outAt > 140) { const d = nearest(S.doors, p.x, p.z); if (d) go(p, d.x, d.z, false, 'inside'); p.fire = null; }
  }
  // ---------- per frame ----------
  function threat(now) { // enemy planes low over the field / hits: the raid is on
    let near = false, around = false;
    for (const p of WW.world.planes) {
      if (!p.alive || p.nation === base.nation) continue;
      const d2 = (p.x - base.x) ** 2 + (p.z - base.z) ** 2;
      if (d2 < 120 * 120 && p.y < 90) around = true;   // still over the island: no all-clear yet
      if (d2 < 95 * 95 && p.y < 70) near = true;
    }
    const hit = now - (base.hitT || -1e9) < 8;
    if (near || hit || around) threatT = now;
    return near || hit;
  }
  function update(rdt, b, bl) {
    if (WW.simOnly || !WW.crew || !b || !b.layout || !b.decor || !WW.baseLifePaths) return;
    if (b !== base || bl !== built) { base = b; built = bl; W().build(b, bl); S = sites(); phase = 'peace'; populate(); lastT = WW.time.now; hitSeen = b.hitT || -1e9; threatT = -1e9; afterT = 0; if (WW.baseLifeCars) WW.baseLifeCars.reset(b, bl); }
    const now = WW.time.now, sdt = Math.max(0, Math.min(0.5, now - lastT)); lastT = now;
    const cam = WW.camera.position; if ((cam.x - b.x) ** 2 + (cam.z - b.z) ** 2 > FAR * FAR) return;
    const attack = threat(now), al = !!b.alarm;
    // the mood
    if (al && phase === 'peace') { phase = 'alarm'; alarm(); if (WW.baseLifeCars) WW.baseLifeCars.alarm(); }
    if (phase !== 'peace') {
      if (attack && phase === 'after') { alarm(); if (WW.baseLifeCars) WW.baseLifeCars.alarm(); }   // a second raid: back to the trenches
      if (attack) phase = 'attack';
      else if (phase === 'attack' || phase === 'alarm') { if (now - threatT > CALM && now - b.alarm.t > 45) { phase = 'after'; afterT = now; standDown(); if (WW.baseLifeCars) WW.baseLifeCars.standDown(); } }
      else if (phase === 'after' && afterT && now - afterT > 120) { afterT = 0; resumeLeisure(); }
    }
    if (b.hitT && b.hitT !== hitSeen) { hitSeen = b.hitT; if (now > nextTeam && R() < 0.6) { nextTeam = now + rr(6, 14); team(b.hitX, b.hitZ); } }
    if (phase !== 'peace') fires(now);
    const gp = (WW.baseGroundFx && WW.baseGroundFx._ground ? WW.baseGroundFx._ground() : []).slice();
    const V = WW.landAir.VAR, cls = v => WW.airfieldLayout.CLS[(V[v] && V[v].cls) || 'S'];   // the wrecks on the ground too
    for (const s of b.slots) if (s.spot && s.state === 'wreck') gp.push([s.x, s.z, s.h, cls(s.v), false, null]);
    for (const w of b.wrecks || []) gp.push([w.x, w.z, w.h, cls(w.v), false, null]);
    W().frame();
    if (WW.baseLifeCars) WW.baseLifeCars.update(sdt, gp, cam, P);
    const vs = vehicles();
    for (const p of P) if (!p.gone) step(p, sdt, now, gp, vs, attack);
    P = P.filter(p => !p.gone);
    guns(rdt, now);
    draw(cam, now, gp, vs);
  }
  function vehicles() { const v = WW.baseGroundFx && WW.baseGroundFx._vehNow ? WW.baseGroundFx._vehNow().slice() : []; if (WW.baseLifeCars) for (const c of WW.baseLifeCars.now()) v.push(c); return v; }
  // inside a ground plane (its fuselage / wing, + m) or a vehicle (+ m)? -> the box [cx, cz, cos, sin, hu, hv] or null
  function blocker(x, z, gp, vs, m, ahead) {
    for (const g of gp) {
      const C = g[3], c = Math.cos(g[2]), s = Math.sin(g[2]), dx = x - g[0], dz = z - g[1], a = dx * c + dz * s, b = -dx * s + dz * c;
      if (ahead && g[4] && a > -C.len / 2 - 1 && a < C.len / 2 + 4 && Math.abs(b) < C.span / 2 + 1) return [g[0], g[1], c, s, C.len / 2, C.span / 2];
      if ((Math.abs(a) < C.len / 2 + m && Math.abs(b) < C.len * 0.08 + m) || (Math.abs(a - C.len * 0.05) < C.len * 0.15 + m && Math.abs(b) < C.span / 2 + m)) return [g[0], g[1], c, s, C.len / 2, C.span / 2, g[4]];
    }
    const K = WW.baseModels.VEH_K || 1;
    for (const v of vs) {
      const c = Math.cos(v.h), s = Math.sin(v.h), dx = x - v.x, dz = z - v.z, a = dx * c + dz * s, b = -dx * s + dz * c, hu = 1.25 * K, hv = 0.55 * K;
      if (Math.abs(a) < hu + m + (ahead ? 1.2 * K : 0) && Math.abs(b) < hv + m) return [v.x, v.z, c, s, hu, hv];
    }
    return null;
  }
  function step(p, dt, now, gp, vs, attack) {
    if (p.pend) { const q = p.pend, tail = p.tail; go(p, q[0], q[1], q[2], q[3], q[4], q[5]); if (!p.pend && tail) { if (p.path) p.path.push(...tail); else if (p.pilot) p.gone = true; p.tail = null; } if (p.pend) { clearOf(p, gp, vs); return; } }
    if (p.walker && p.act === 'idle' && now > p.at && S.doors.length) { const d = S.doors[Math.floor(R() * S.doors.length)]; go(p, d.x, d.z, false, 'idle'); p.at = now + rr(4, 14); }
    if (p.path && dt > 0 && !(p.delay > now)) {
      const t = p.path[p.pi], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
      const spd = p.spd * (attack && p.act === 'run' ? 1.15 : 1), mv = Math.min(d, spd * dt);
      const nx = p.x + dx / (d || 1) * mv, nz = p.z + dz / (d || 1) * mv;
      if (!W().stand(nx, nz, 0.3) && W().stand(p.x, p.z, 0.3) && p.goal && now > (p.replanT || 0)) { p.replanT = now + 2; const g = p.goal, n0 = p.next, f0 = p.goalFace; go(p, g[0], g[1], g[2], g[3], g[4], g[5]); if (p.next === undefined) { p.next = n0; p.goalFace = f0; } clearOf(p, gp, vs); return; } // about to brush a wall: plan again from here
      if (!W().stand(nx, nz, 0.3) && W().stand(p.x, p.z, 0.3)) { p.wait += dt; }
      else if (blocker(nx, nz, gp, vs, 0.3, false) || (blocker(nx, nz, gp, vs, 0.3, true) && !blocker(p.x, p.z, gp, vs, 0.3, true))) { p.wait += dt; if (p.wait > 25 && !p.pilot) { p.path = null; arrive(p); } }
      else { p.x = nx; p.z = nz; p.face = Math.atan2(dz, dx); p.wait = 0; }
      if (d - mv < 0.05) { p.pi++; if (p.pi >= p.path.length) { p.path = null; arrive(p); } }
    }
    // caught in the open under attack: hit the dirt (until the bombs stop)
    if (attack && !p.path && (p.act === 'idle' || p.act === 'chow' || p.act === 'cards' || p.act === 'laundry' || p.act === 'drill' || p.act === 'instr' || p.act === 'ready')) { p.act = 'prone'; proneFace(p); }
    else if (!attack && p.act === 'prone' && phase === 'after') { p.act = 'idle'; p.walker = true; p.at = now + rr(1, 5); }
    // a plane or a truck came at him: a step clear (to the nearer side of its box)
    clearOf(p, gp, vs);
    if (p.pilot && (p.pilot.state !== 'parked' || !p.pilot.spot)) { p.pilot = null; const t = trenchFor(p); if (t) { t.who = p; p.station = t; go(p, t.x, t.z, true, 'trench'); } else p.act = 'prone'; }
  }
  // a plane or a truck came at him: the nearest step clear of its whole box (beside it, ahead of it or behind it)
  // that is clear of everything else too; nowhere to go: he is not drawn this frame (p.hid)
  function clearOf(p, gp, vs) {
    p.hid = false;
    for (let it = 0; it < 3; it++) {
      const bk = blocker(p.x, p.z, gp, vs, 0.2, false); if (!bk) return;
      const dx = p.x - bk[0], dz = p.z - bk[1], a = dx * bk[2] + dz * bk[3], b = -dx * bk[3] + dz * bk[2], E = 0.34;
      let best = null, bd = 1e9;
      for (const q of [[a, bk[5] + E], [a, -bk[5] - E], [bk[4] + E, b], [-bk[4] - E, b]]) {
        const x = bk[0] + q[0] * bk[2] - q[1] * bk[3], z = bk[1] + q[0] * bk[3] + q[1] * bk[2], d = (q[0] - a) ** 2 + (q[1] - b) ** 2;
        if (d < bd && !blocker(x, z, gp, vs, 0.2, false) && W().stand(x, z, 0.3)) { bd = d; best = [x, z]; }
      }
      if (!best) { p.hid = true; return; }
      p.x = best[0]; p.z = best[1];
    }
  }
  // lying down: a heading along which his whole length is clear of the buildings
  function proneFace(p) {
    for (let k = 0; k < 8; k++) { const a = p.face + k * PI / 4, c = Math.cos(a), s = Math.sin(a); if (W().stand(p.x + c * 0.3, p.z + s * 0.3, 0.12) && W().stand(p.x - c * 0.3, p.z - s * 0.3, 0.12)) { p.face = a; return; } }
  }
  function arrive(p) {
    p.act = p.next || 'idle'; if (p.goalFace !== undefined) p.face = p.goalFace;
    if (p.act === 'climb' || p.act === 'inside') p.gone = true;     // climbs into the cockpit / goes indoors
    if (p.act === 'prone') { p.face = p.face || 0; proneFace(p); }
  }
  // the camp's machine guns: train on the nearest enemy plane in reach (else the threat bearing), elevate at the alarm
  function guns(rdt, now) {
    const al = base.alarm;
    for (const part of built.parts) {
      if (!part.decor || !part.gun || part.f.out) continue;
      let want = null, bd = 70 * 70;
      if (al) for (const p of WW.world.planes) if (p.alive && p.nation !== base.nation) { const d = WW.dist2(p.x, p.z, part.f.x, part.f.z); if (d < bd) { bd = d; want = Math.atan2(p.z - part.f.z, p.x - part.f.x); } }
      if (want === null && al) want = Math.atan2(al.z - part.f.z, al.x - part.f.x);
      if (want !== null) part.gun.rotation.y += WW.angleDiff(part.gun.rotation.y, -want) * Math.min(1, rdt * 2.5);
      part.gun.rotation.z += ((al ? 0.55 : 0) - part.gun.rotation.z) * Math.min(1, rdt * 1.5);
    }
    for (const part of built.parts) if (part.f.kind === 'aa' && part.gun && !part.f.out) part.gun.rotation.z += ((al ? 0.3 : 0) - part.gun.rotation.z) * Math.min(1, rdt * 1.5);
  }
  // ---------- drawing ----------
  function figure(x, z, face, role, y, lean, sy, tr) {
    if (WW.baseGroundFx && WW.baseGroundFx._traceRef) { const T = WW.baseGroundFx._traceRef(); if (T) T.figs.push(tr || { x, z, role }); }
    _q.setFromEuler(_e.set(0, -face, -(lean || 0), 'YXZ')); _p.set(x, gy(x, z) + (y || 0), z); _s.set(FIG_K, FIG_K * (sy || 1), FIG_K);
    WW.crew.addFigure(_m.compose(_p, _q, _s), base.nation, role, pose);
  }
  function draw(cam, now, gp, vs) {
    const t = performance.now() / 1000;
    for (const p of P) {
      if (p.hid || (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 > DRAW * DRAW) continue;
      const moving = !!p.path && !(p.delay > now), run = moving && p.spd > 1.5, sw = moving ? Math.sin(t * (run ? 15 : 9) + p.ph) : 0;
      let y = moving ? Math.abs(sw) * (run ? 0.06 : 0.025) : 0, lean = run ? 0.25 : 0, sy = 1, face = p.face;
      pose.aL = sw * (run ? 1.0 : 0.45); pose.aR = -pose.aL; pose.oL = pose.oR = null;
      const tr = { x: p.x, z: p.z, role: p.role, act: p.act };
      if (!moving) switch (p.act) {
        case 'chow': face += Math.sin(t * 0.3 + p.ph) * 0.15; pose.aL = pose.aR = 0.25; break;
        case 'drill': case 'instr': { const k = p.act === 'drill' ? (Math.sin(t * 5.5) + 1) / 2 : 0; pose.oL = pose.oR = 0.15 + 2.3 * k; y = 0.07 * k; if (p.act === 'instr') { pose.aR = 1.4 + Math.sin(t * 5.5) * 0.4; } break; }
        case 'cards': sy = 0.66; pose.aL = 0.9 + Math.sin(t * 2 + p.ph) * 0.1; pose.aR = 0.8; break;
        case 'laundry': pose.aL = 2.5; pose.aR = 2.3 + Math.sin(t * 1.5) * 0.2; break;
        case 'sentry': face += Math.sin(t * 0.2 + p.ph) * 0.5; break;
        case 'wave': pose.aR = 2.7 + Math.sin(t * 6) * 0.35; pose.oR = 0.3; face = Math.atan2(base.alarm ? base.alarm.z - p.z : 0, base.alarm ? base.alarm.x - p.x : 1); break;
        case 'gun': pose.aL = pose.aR = 1.25; lean = -0.12; if (base.alarm) face = Math.atan2(base.alarm.z - p.z, base.alarm.x - p.x) + Math.sin(t * 0.7 + p.ph) * 0.4; break;
        case 'trench': sy = 0.55; pose.aL = pose.aR = 0.5; y = -0.04; break;
        case 'prone': lean = PI / 2 - 0.02; y = 0.05; pose.aL = pose.aR = 2.9; break;
        case 'hose': pose.aL = pose.aR = 1.3; lean = 0.15; face += Math.sin(t * 1.3 + p.ph) * 0.25; break;
        default: face += Math.sin(t * 0.5 + p.ph) * 0.2;
      }
      let fx = p.x, fz = p.z;
      if (p.act === 'prone') { fx -= Math.cos(face) * 0.2 * FIG_K / 1.17; fz -= Math.sin(face) * 0.2 * FIG_K / 1.17; }   // feet back: the body lies centred on his spot
      if (p.team) { // the bearers fore and aft must be clear too (else the team waits unseen behind it)
        const c = Math.cos(face), sn = Math.sin(face), k = 0.32 * FIG_K / 1.17;
        const ok = q => !blocker(q[0], q[1], gp, vs, 0.22, false) && W().stand(q[0], q[1], 0.25);
        if (ok([p.x + c * k, p.z + sn * k]) && ok([p.x - c * k, p.z - sn * k])) carry(p, face, y, tr);
        continue;
      }
      figure(fx, fz, face, p.role, y, lean, sy, tr);
    }
  }
  // a stretcher team: two bearers fore and aft of the leader's point, the wounded man lying on the canvas between
  function carry(p, face, y, tr) {
    const c = Math.cos(face), s = Math.sin(face), k = 0.32 * FIG_K / 1.17;
    figure(p.x + c * k, p.z + s * k, face, 'c', y, 0.05, 1, { x: p.x + c * k, z: p.z + s * k, role: 'c', act: 'stretcher' });
    figure(p.x - c * k, p.z - s * k, face, 'r', y * 0.7, 0.05, 1, { x: p.x - c * k, z: p.z - s * k, role: 'r', act: 'stretcher' });
    pose.aL = pose.aR = 2.9; pose.oL = pose.oR = null;
    _q.setFromEuler(_e.set(0, -face, PI / 2, 'YXZ')); _p.set(p.x + c * 0.2 * FIG_K, gy(p.x, p.z) + 0.2 * FIG_K, p.z + s * 0.2 * FIG_K); _s.set(FIG_K, FIG_K, FIG_K);
    WW.crew.addFigure(_m.compose(_p, _q, _s), base.nation, 'c', pose);
    if (WW.baseLifeCars) WW.baseLifeCars.stretcher(p.x, gy(p.x, p.z) + 0.17 * FIG_K, p.z, face);
  }
  function clear() { P = []; base = null; built = null; S = null; phase = 'peace'; }
  WW.on('roundStart', clear); WW.on('setupStart', clear);
  const perf = { ms: 0, max: 0 };
  WW.baseLife = { update(rdt, b, bl) { const t0 = performance.now(); try { update(rdt, b, bl); } catch (e) { if (!WW.baseLife._err) { WW.baseLife._err = e; console.error('baseLife', e); } }
      const ms = performance.now() - t0; perf.ms = perf.ms * 0.95 + ms * 0.05; perf.max = Math.max(perf.max * 0.999, ms); },
    get phase() { return phase; }, perf, fails: G0, get people() { return P; }, get sites() { return S; }, clear, FIG_K };
})();
