// camera_director.js (camera): WW.camDirector, the director's decision core (docs/camera_review.md). One module decides
// WHEN the camera cuts and to WHAT; the shot library (camera.js, camera_scenes.js, camera_story*.js, camera_action.js,
// camera_base.js) decides HOW each shot is filmed.
//  - FORECAST: the impacts about to happen, read from the live projectiles (WW.combat._i.active) and the planes in their
//    dive: heavy / medium shells in flight with their landing time and point (a predicted miss is only splashes),
//    bombs falling, torpedoes running (a closest-approach test against each enemy hull), dive bombers diving. Per
//    target ship: the first impact's ETA (sim s, and real s through camera_finder's measured rate), the impact point,
//    the incoming damage and whether it sinks her. Each becomes a 'brace' candidate on the director's one drama ladder
//    (camera_score.js), worth the most 1.2-9 real s before the impact, so the camera is on the ship, framed, BEFORE it.
//  - BRACE shot: the target ship waiting for the hit, from a pose chosen by a search over ~40 candidates scored by the
//    framing check: the hull's ends, the impact point and (when near) the source in the safe frame, the sight lines clear
//    of the island and other hulls, the camera clear of geometry, continuity with the side the camera is on. Held to
//    the last impact in its window plus a beat (camera_lock.js 'impact' / 'beat').
//  - ARBITER (4 Hz), the one place a running shot is cut for a better one (camera_score.js's tick and camera_scenes.js's
//    torpedo tick are gone; story mode's yields come here): the best candidate not about the running shot against the
//    shot's live worth plus hysteresis; a shot younger than MIN_T only for one BIG rungs higher; never in an attack's
//    release window or a hand-off; a locked shot only for one BIG rungs higher. The event interrupts (a sinking or a
//    magazine nobody predicted, a bombardment) still come through WW.cam.interrupt.
//  - FRAMING CHECK WW.cam.frameCheck(P, L, pts, own) and a per-frame SIGHT LIFT: a running shot whose subject is hidden by
//    a hull or the island rises (eased) until the sight line clears.
//  - F (camera_follow.js): bestNow(), the arbiter's single best candidate now, with a label.
// Visual only: reads the sim, never writes it; Math.random / the wall clock, never WW.rand. Load after camera_score.js.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const wall = () => performance.now() / 1000;
  const ok = p => p && !p.removed && p.alive;
  const V3 = () => new THREE.Vector3();
  const VALUE = { carrier: 1.6, battleship: 1.4, cruiser: 1.1, destroyer: 0.8, submarine: 0.6, pt: 0.4 };
  // the class at stake (user, 2026-10-13: "a carrier about to be struck should supersede anything else"): CV >> BB > CA >
  // DD > PT / sub; the island base about a cruiser
  const CLASS = { carrier: 3, battleship: 1.8, cruiser: 1.3, destroyer: 0.9, submarine: 0.5, pt: 0.5, base: 1.3 };
  const cls = o => !o ? 1 : o.isBase ? CLASS.base : CLASS[o.type] || 1;
  const TOP = { carrier: 7, battleship: 6, cruiser: 5, destroyer: 4, submarine: 2.5, pt: 2 };
  const KIND = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };
  const BASE = { torp: 8.4, bomb: 8.3, dive: 7.9, shellbig: 7.0, shellmed: 6.2 };   // the ladder rung of an impact on a ship of value 1
  const LEAD = [1.2, 9], MIN_T = 4, BIG = 3, BEAT = 2.6, MAXB = 16, TICK = 0.25, MIN_PR = 6.5, GRAV = 9.8;
  const FLOOR = { wide: 2, low: 3, flyby: 3, orbit: 3, chase: 3, story: 5, duel: 4, base: 4, aa: 4, profile: 4, ots: 4, brace: 3, field: 4 };
  const ST = { cuts: 0, braces: 0, rejected: 0, lifts: 0, f: 0, byKind: {} };
  const log = [];
  const realS = s => (WW.camFinder ? WW.camFinder.realS(s) : s * 2);
  const nameOf = o => !o ? '' : o.isBase ? 'the airfield' : o.name || 'the ' + (KIND[o.type] || 'ship');
  const sqOf = p => (p && p.squadron ? p.squadron.short : p && p.nation === 'IJN' ? 'IJN aircraft' : 'Aircraft');
  const isShip = s => s && s.stats && !s.isLand && !s.isBase && !s.removed;

  // ---------- geometry ----------
  // (x, z) on the hull of s centred at (cx, cz) (combat.js onHull: half-beam = 0.12 L)
  function onHullAt(s, cx, cz, x, z, pad) {
    const h = s.heading || 0, c = Math.cos(h), sn = Math.sin(h), dx = x - cx, dz = z - cz, L = Math.max(5, s.stats.length);
    return Math.abs(dx * c + dz * sn) < L / 2 + pad && Math.abs(-dx * sn + dz * c) < L * 0.12 + pad;
  }
  // a running torpedo q against ship s: the sim seconds to the hull, or -1 for a miss (closest approach of the
  // relative track, the ship holding her course and speed; the torpedo's range left caps it)
  function torpEta(q, s) {
    const sp = q.sp || (WW.TORPEDO && WW.TORPEDO.speed) || 14, ss = s.speed || 0, sh = s.heading || 0;
    const wx = Math.cos(q.h) * sp - Math.cos(sh) * ss, wz = Math.sin(q.h) * sp - Math.sin(sh) * ss, w2 = wx * wx + wz * wz;
    if (w2 < 1e-3) return -1;
    const dx = q.x - s.x, dz = q.z - s.z, tMax = Math.max(0, ((q.range || 100) - (q.run || 0)) / sp);
    const tc = WW.clamp(-(dx * wx + dz * wz) / w2, 0, tMax);
    const rx = dx + wx * tc, rz = dz + wz * tc, c = Math.cos(sh), sn = Math.sin(sh), L = Math.max(5, s.stats.length);
    if (Math.abs(rx * c + rz * sn) > L / 2 + 1 || Math.abs(-rx * sn + rz * c) > L * 0.12 + 1.5) return -1;
    return Math.max(0, tc - (L * 0.12) / Math.sqrt(w2));
  }

  // ---------- forecast ----------
  let fc = [], fcAt = -1e9, fcSim = -1e9;
  function forecast() {
    if (wall() - fcAt < 0.2 && Math.abs(WW.time.now - fcSim) < 0.3) return fc;
    fcAt = wall(); fcSim = WW.time.now;
    const by = new Map();
    // one incoming weapon on ship s: kind, ETA (sim s), the impact point's offset from the ship's centre, its damage, its source
    const note = (s, kind, eta, ox, oz, dmg, src, sure) => {
      let e = by.get(s);
      if (!e) by.set(s, e = { s, eta: 1e9, last: 0, n: 0, dmg: 0, kinds: {}, ox: 0, oz: 0, src: null, kind: '' });
      e.n++; e.dmg += dmg * (sure ? 1 : 0.45); e.kinds[kind] = (e.kinds[kind] || 0) + 1; e.last = Math.max(e.last, eta);
      if (eta < e.eta || (BASE[kind] > BASE[e.kind] + 0.5 && eta < e.eta + 3)) { e.eta = eta; e.ox = ox; e.oz = oz; e.src = src; e.kind = kind; }
    };
    const act = WW.combat && WW.combat._i && WW.combat._i.active;
    const ships = WW.world.ships;
    if (act) for (const q of act) {
      if (q.dead) continue;
      if (q.kind === 'shell') {
        if (q.cal !== 'big' && q.cal !== 'med') continue;
        const t = q.target, left = q.T - q.t;
        if (!isShip(t) || !t.alive || t.nation === q.nation || left <= 0) continue;
        const lx = q.x0 + q.vx * q.T, lz = q.z0 + q.vz * q.T, sp = t.speed || 0, h = t.heading || 0;
        const tx = t.x + Math.cos(h) * sp * left, tz = t.z + Math.sin(h) * sp * left;
        if (!onHullAt(t, tx, tz, lx, lz, 1.5)) continue;    // a predicted miss: splashes, not an impact
        const o = q.owner && !q.owner.removed ? q.owner : null;
        note(t, 'shell' + q.cal, left, lx - tx, lz - tz, q.dmg || 0, o ? { x: o.x, y: 4, z: o.z, obj: o } : { x: q.x0, y: 4, z: q.z0 }, true);
      } else if (q.kind === 'torp' && !q.fall) {
        let best = null, be = 1e9;
        for (const s of ships) {
          if (!isShip(s) || !s.alive || s.submerged || s.nation === q.nation) continue;
          if (WW.dist2(s.x, s.z, q.x, q.z) > 600 * 600) continue;
          const e = torpEta(q, s); if (e >= 0 && e < be && e < 60) { be = e; best = s; }
        }
        if (best) note(best, 'torp', be, 0, 0, q.dud ? 0 : q.dmg || 0, { x: q.x, y: 0, z: q.z, obj: q.owner && (q.owner.pt || q.owner.stats) && !q.owner.removed ? q.owner : null }, true);
      } else if (q.kind === 'bomb') {
        const vy = q.vy || 0, y = Math.max(0, q.y), tf = (vy + Math.sqrt(vy * vy + 2 * GRAV * y)) / GRAV, lx = q.x + q.vx * tf, lz = q.z + q.vz * tf;
        let hit = null;
        const cand = isShip(q.target) && q.target.alive ? [q.target].concat(ships) : ships;
        for (const s of cand) {
          if (!isShip(s) || !s.alive || s.submerged || s.nation === q.nation) continue;
          const sp = s.speed || 0, h = s.heading || 0, tx = s.x + Math.cos(h) * sp * tf, tz = s.z + Math.sin(h) * sp * tf;
          if (onHullAt(s, tx, tz, lx, lz, 1)) { hit = { s, ox: lx - tx, oz: lz - tz }; break; }
        }
        if (hit) note(hit.s, 'bomb', tf, hit.ox, hit.oz, q.dmg || 0, { x: q.x, y: q.y, z: q.z }, true);
      }
    }
    // dive bombers in the dive: the release from the height and the sink rate, then the bomb's fall (a likely hit, not a sure one)
    for (const p of WW.world.planes) {
      if (!ok(p) || p.kind !== 'dive' || !p.ordnance || (p.phase !== 'roll' && p.phase !== 'dive')) continue;
      const t = p.diveTgt || p.target; if (!isShip(t) || !t.alive) continue;
      const rel = p.relAlt || 18, eta = (p.vy < -1 ? Math.max(0, p.y - rel) / -p.vy : 3) + Math.sqrt(2 * rel / GRAV);
      note(t, 'dive', eta, 0, 0, ((WW.BOMB && WW.BOMB.dmg) || 180), { x: p.x, y: p.y, z: p.z, obj: p }, false);
    }
    const out = [];
    for (const e of by.values()) {
      const s = e.s, low = 1 - WW.clamp(s.hp / s.maxHp, 0, 1);
      e.kill = e.dmg >= s.hp && s.hp > 0;
      e.raw = (BASE[e.kind] || 6) + (cls(s) - 1) * 1.5 + low * 1.2 + (e.kill ? 1.6 : 0) + 0.25 * Math.min(3, e.n - 1);
      e.etaReal = realS(e.eta);
      e.pr = e.raw - (e.etaReal < 0.6 ? 2 : e.etaReal < LEAD[0] ? 0.8 : 0) - Math.max(0, e.etaReal - LEAD[1]) * 0.35;
      e.lastReal = realS(e.last);
      out.push(e);
    }
    out.sort((a, b) => b.pr - a.pr);
    return (fc = out);
  }
  const forecastFor = s => (WW.camLook && WW.camLook.active() ? WW.camLook.forecastFor(s) : forecast().find(e => e.s === s) || null);
  function labelOf(e) {
    const k = e.kind, s = nameOf(e.s), sink = e.kill ? ' · she may not survive it' : '';
    if (k === 'torp') return 'Torpedoes running at ' + s + sink;
    if (k === 'bomb') return 'Bombs falling on ' + s + sink;
    if (k === 'dive') return (e.src && e.src.obj ? sqOf(e.src.obj) : 'Dive bombers') + ' diving on ' + s + sink;
    if (k === 'sink') return s.replace(/^the /, 'The ') + ' is going down';
    if (k === 'mag') return s.replace(/^the /, 'The ') + ': the magazine';
    return (k === 'shellbig' ? 'Heavy shells' : 'Shells') + ' inbound on ' + s + (e.src && e.src.obj ? ' from ' + nameOf(e.src.obj) : '') + sink;
  }
  // ---------- the event source: ONE interface ----------
  // events(): the upcoming impacts as plain records { t: real s to the (first) impact, tLast, kind ('torp' | 'bomb' |
  // 'dive' | 'shellbig' | 'shellmed'), subject: the weapon's source (a ship, a plane, or null), target: the ship to be
  // hit, x, z: the impact point, weight: its drama on the director's ladder (class, HP left, a likely kill), kill }.
  // The arc picker, the arcs' climaxes and the brace candidates read ONLY this list, so another source (a look-ahead
  // sim's event log) can replace forecast() behind it.
  function events() {
    if (WW.camLook && WW.camLook.active()) return WW.camLook.events().map(e => ({ t: e.etaReal, tLast: e.lastReal, kind: e.kind, subject: (e.src && e.src.obj) || null, target: e.s,
      x: e.s.x + e.ox, z: e.s.z + e.oz, weight: e.raw, kill: !!e.kill, _f: e }));   // camera5: the look-ahead's known future (camera_lookahead.js)
    return forecast().map(e => ({ t: e.etaReal, tLast: e.lastReal, kind: e.kind, subject: (e.src && e.src.obj) || null, target: e.s,
      x: e.s.x + e.ox, z: e.s.z + e.oz, weight: e.raw, kill: !!e.kill, _f: e }));
  }
  // the candidates (camera.js candidates(), WW.camHooks): a brace on each ship with an impact due
  (WW.camHooks = WW.camHooks || []).push(add => {
    if (!(WW.game && WW.game.state === 'battle') || (WW.camNormandy && WW.camNormandy.on())) return;
    for (const v of events()) {
      if (v.t > 30) continue;
      const e = v._f;
      add(e.pr, 'brace', v.target, { ev: e, hold: e.raw, dur: WW.clamp(v.tLast + BEAT, 4, 14), why: v.kind, label: labelOf(e) });
    }
  });

  // ---------- the framing check ----------
  const probe = typeof THREE !== 'undefined' ? new THREE.PerspectiveCamera() : null, _v = typeof THREE !== 'undefined' ? V3() : null;
  const depth = (x, z) => (x < 0 || z < 0 || x > WW.cfg.MAP_W || z > WW.cfg.MAP_H) ? 15 : WW.terrain.depthAt(x, z);
  // is the sight line from P to point p clear of the island and of every hull but `own` / p.obj? (a hull hides what is
  // behind it up to its superstructure: TOP + 2)
  function sight(P, p, own) {
    for (let i = 1; i < 8; i++) { const f = i / 8, x = WW.lerp(P.x, p.x, f), z = WW.lerp(P.z, p.z, f), y = WW.lerp(P.y, p.y, f); if (-depth(x, z) + 1 > y) return false; }
    const dx = p.x - P.x, dz = p.z - P.z, L2 = dx * dx + dz * dz || 1;
    for (const o of WW.world.ships) {
      if (o === own || o === p.obj || o.removed || o.submerged || !o.stats) continue;
      const t = ((o.x - P.x) * dx + (o.z - P.z) * dz) / L2; if (t <= 0.03 || t >= 0.97) continue;
      if (Math.hypot(o.x - (P.x + dx * t), o.z - (P.z + dz * t)) < o.stats.length * 0.35 && WW.lerp(P.y, p.y, t) < (TOP[o.type] || 4) + 2) return false;
    }
    return true;
  }
  // the camera in or just above geometry: a hull's no-go circle low down, under or skimming the island
  function inGeometry(P, except) {
    if (-depth(P.x, P.z) + 2 > P.y) return true;
    for (const s of WW.world.ships) { if (s.removed || s === except || !s.stats) continue; if (Math.hypot(P.x - s.x, P.z - s.z) < s.stats.length * 0.5 + 6 && P.y < (TOP[s.type] || 4) + 5) return true; }
    return false;
  }
  // score a pose: each point { x, y, z, w, need, obj } inside the safe frame (+w), outside (-w, -3w if needed), hidden
  // (-2w); the camera in geometry -10; nothing at all in the frame -10
  function frameCheck(P, L, pts, own) {
    const c = WW.camera; if (!probe || !c) return 0;
    probe.fov = c.fov; probe.aspect = c.aspect; probe.near = 1; probe.far = 5000; probe.updateProjectionMatrix();
    probe.position.set(P.x, P.y, P.z); probe.lookAt(L.x, L.y, L.z); probe.updateMatrixWorld();
    let sc = 0, inN = 0;
    for (const p of pts) {
      _v.set(p.x, p.y, p.z).project(probe);
      const inF = _v.z < 1 && Math.abs(_v.x) < 0.85 && Math.abs(_v.y) < 0.8;
      if (!inF) { sc -= p.need ? 3 * p.w : p.w; continue; }
      inN++; sc += p.w;
      if (!sight(P, p, own)) sc -= (p.need ? 3 : 2) * p.w;
    }
    if (inGeometry(P, null)) sc -= 10;
    if (!inN) sc -= 10;
    return sc;
  }

  // ---------- the brace shot ----------
  function fillR(len, f) { const c = WW.camera; return len / (f * 2 * Math.tan(c.fov * Math.PI / 360) * c.aspect); }
  const _P = { x: 0, y: 0, z: 0 }, _L = { x: 0, y: 0, z: 0 };
  const _ip = { x: 0, y: 0, z: 0, obj: null };
  function bracePts(s, e) {
    const L = s.stats.length, h = s.heading || 0, fx = Math.cos(h), fz = Math.sin(h), top = (TOP[s.type] || 4) * 0.6;
    const pts = [{ x: s.x + fx * L * 0.45, y: top, z: s.z + fz * L * 0.45, w: 1, need: true, obj: s }, { x: s.x - fx * L * 0.45, y: top, z: s.z - fz * L * 0.45, w: 1, need: true, obj: s },
      { x: s.x + e.ox, y: 2, z: s.z + e.oz, w: 1.5, need: true, obj: s }];
    if (e.src && WW.dist(e.src.x, e.src.z, s.x, s.z) < 320) pts.push({ x: e.src.x, y: e.src.y, z: e.src.z, w: 0.6, need: false, obj: e.src.obj });
    return pts;
  }
  // the look point: the ship, a little toward where the weapon comes from (and up toward a diver)
  function braceLook(s, e, out) {
    const sx = e.src ? e.src.x - s.x : Math.cos(s.heading), sz = e.src ? e.src.z - s.z : Math.sin(s.heading), d = Math.hypot(sx, sz) || 1, k = Math.min(d, s.stats.length * 0.35) / d;
    out.x = s.x + sx * k; out.z = s.z + sz * k; out.y = e.kind === 'dive' || e.kind === 'bomb' ? 5 : 1.5;
    return out;
  }
  function start(shot) {
    const s = shot.subj, e = shot.ev; if (!s || !e) return;
    ST.braces++;
    const len = s.stats.length, cam = WW.cam.current().P;
    const th = e.src ? Math.atan2(e.src.z - s.z, e.src.x - s.x) : (s.heading || 0) + Math.PI / 2;
    const side0 = Math.sign(Math.cos(th) * (cam.z - s.z) - Math.sin(th) * (cam.x - s.x)) || 1;   // the side of the source -> target line the camera is on
    const pts = bracePts(s, e), look = braceLook(s, e, _L), high = e.kind === 'dive' || e.kind === 'bomb';
    let best = null;
    for (const dd of [55, 80, 105, 135, 160]) for (const sd of [1, -1]) for (const R of [fillR(len, 0.6) + 6, fillR(len, 0.42) + 8]) for (const hk of high ? [0.08, 0.2] : [0.12, 0.26]) {
      const az = th + sd * dd * Math.PI / 180;
      _P.x = s.x + Math.cos(az) * R; _P.z = s.z + Math.sin(az) * R; _P.y = Math.max(3.5, R * hk + 2);
      let sc = frameCheck(_P, look, pts, s);
      if (sd === side0) sc += 0.8;                              // no flip across the line of action
      sc += 1.5 * Math.abs(Math.sin(az - (s.heading || 0)));    // the hull broadside, not bow-on (a small ship reads)
      if (depth(_P.x, _P.z) < 2) sc -= 3;                        // over the shoals: keepSane would lift it
      if (!best || sc > best.sc) best = { sc, az, R, y: _P.y, sd };
    }
    if (best.sc < -4) ST.rejected++;
    shot.pose = { az: best.az, R: best.R, y: best.y }; shot.side = best.sd; shot.score = best.sc;
    shot.kP = 1.8; shot.kL = 2.2;
    shot.t0w = wall();
  }
  function goal(shot, gP, gL, rdt) {
    if (!shot || shot.kind !== 'brace') return false;
    const s = shot.subj;
    if (!s || s.removed || !shot.pose) { const c = WW.cam.current(); gP.copy(c.P); gL.copy(c.L); shot.t = shot.dur; return true; }
    const e = (s.alive || s.sinking) ? forecastFor(s) : null;
    if (e && shot.t < MAXB) { shot.ev = e; shot.doneAt = undefined; shot.dur = Math.max(shot.dur, Math.min(shot.t + e.lastReal + BEAT, MAXB + BEAT)); }
    else if (shot.doneAt === undefined) { shot.doneAt = shot.t; shot.dur = shot.t + BEAT; }   // the last impact (or MAXB s of them): the beat, then free
    let P = shot.pose, a = P.az + 0.02 * shot.side * shot.t;   // a slow drift round the ship
    gP.set(s.x + Math.cos(a) * P.R, P.y, s.z + Math.sin(a) * P.R);
    // camera6: the impact point hidden from the pose (the ships moved since the pose was chosen; the survey found the
    // shooter of a gun duel in front of the target's waterline at the hit): choose the pose again (at most 3 times)
    if (shot.ev && (shot.reposeT = (shot.reposeT || 0) - (rdt || 0)) <= 0) {
      shot.reposeT = 0.4;
      _ip.x = s.x + shot.ev.ox; _ip.y = 2; _ip.z = s.z + shot.ev.oz; _ip.obj = s;
      if (!sight(gP, _ip, s) && (shot.reposes || 0) < 3 && shot.doneAt === undefined) {
        shot.reposes = (shot.reposes || 0) + 1; ST.reposes = (ST.reposes || 0) + 1;
        start(shot); P = shot.pose; a = P.az + 0.02 * shot.side * shot.t;
        gP.set(s.x + Math.cos(a) * P.R, P.y, s.z + Math.sin(a) * P.R);
      }
    }
    braceLook(s, shot.ev, gL);
    shot.aim = (shot.aim || V3()).set(s.x + shot.ev.ox * 0.5, 2, s.z + shot.ev.oz * 0.5);
    return true;
  }

  // ---------- the sight lift ----------
  // the goal rises until the sight line to the shot's aim clears the island and the hulls in the way (not the shot's
  // own ships); eased up fast, down slowly
  function clearSight(gP, shot, rdt) {
    if (!shot || shot.deck || shot.field || shot.nd || shot.kind === 'wide' || shot.stage === 'bomb') return;
    const aim = shot.aim || shot.last; if (!aim) return;
    const own = [shot.subj, shot.target, shot.tship, shot.plane && shot.plane.target];
    let need = 0;
    for (let i = 1; i < 8; i++) {
      const f = i / 8, x = WW.lerp(gP.x, aim.x, f), z = WW.lerp(gP.z, aim.z, f), y = WW.lerp(gP.y, aim.y, f), g = -depth(x, z) + 1.5;
      if (g > y) need = Math.max(need, (g - f * aim.y) / (1 - f) - gP.y);
    }
    const dx = aim.x - gP.x, dz = aim.z - gP.z, L2 = dx * dx + dz * dz || 1;
    for (const o of WW.world.ships) {
      if (own.indexOf(o) >= 0 || o.removed || o.submerged || !o.stats) continue;
      const t = ((o.x - gP.x) * dx + (o.z - gP.z) * dz) / L2; if (t <= 0.05 || t >= 0.95) continue;
      if (Math.hypot(o.x - (gP.x + dx * t), o.z - (gP.z + dz * t)) > o.stats.length * 0.4) continue;
      const top = (TOP[o.type] || 4) + 2, y = WW.lerp(gP.y, aim.y, t);
      if (y < top) need = Math.max(need, (top - t * aim.y) / (1 - t) - gP.y);
    }
    need = WW.clamp(need, 0, 40);
    const cur = shot.sightY || 0;
    if (need > 0.5 && cur < 0.5) ST.lifts++;
    shot.sightY = cur + (need - cur) * (1 - Math.exp(-rdt * (need > cur ? 2.5 : 0.6)));
    gP.y += shot.sightY;
  }

  // ---------- the arbiter ----------
  // the things a shot is about: its subject, plane, target, the torpedo's ship, the attacker the deck shot looks at, a
  // story's group (its wave's dive is the story's own)
  function about(shot) {
    const A = [];
    for (const o of [shot.subj, shot.plane, shot.tship, shot.target, shot.threat, shot.att]) if (o && o.x !== undefined && A.indexOf(o) < 0) A.push(o);
    if (shot.story && shot.group) for (const m of shot.group) if (A.indexOf(m) < 0) A.push(m);
    const st = shot.story && WW.camStory && WW.camStory.story();
    if (st && st.lead && st.lead.wave) for (const m of st.lead.wave.members) if (A.indexOf(m) < 0) A.push(m);
    return A;
  }
  // a place (a diorama point, the island base) is the same subject as another place within 120 u: the base hooks build a
  // fresh point object every time
  const place = o => o && (o.diorama || o.isBase || (o.y === 0 && !o.stats && !o.pt));
  const has = (A, o) => A.indexOf(o) >= 0 || (place(o) && A.some(a => place(a) && WW.dist2(a.x, a.z, o.x, o.z) < 120 * 120));
  const mine = (c, A) => has(A, c.subj) || (c.plane && A.indexOf(c.plane) >= 0) || (c.kind !== 'brace' && c.target && A.indexOf(c.target) >= 0)
    || (c.kind === 'brace' && c.ev && c.ev.src && c.ev.src.obj && A.indexOf(c.ev.src.obj) >= 0);   // a brace on the ship the filmed plane attacks is the same moment
  function worth(shot, C, A) {
    let w = -1;
    for (const c of C) if (mine(c, A)) w = Math.max(w, c.hold !== undefined ? c.hold : c.pr);
    if (shot.kind === 'brace' && shot.ev && shot.doneAt === undefined) w = Math.max(w, shot.ev.raw);
    return w >= 0 ? w : (FLOOR[shot.kind] !== undefined ? FLOOR[shot.kind] : 3);
  }
  function bestOf(C, A) {
    let b = null;
    for (const c of C) { if (c.kind === 'wide' || !c.subj || c.subj.removed || (A && mine(c, A))) continue; if (!b || c.pr > b.pr) b = c; }
    return b;
  }
  // ---------- arcs ----------
  // The unit of filming is an ARC: a protagonist and its story from setup to outcome (user, 2026-10-13: "like a movie
  // scene ... little pieces of story in everything"). Air arcs are camera_story.js's stories (a strike's run, a CAP
  // fight, a rescue); SHIP arcs live here: a destroyer charge / torpedo run, a gun duel with hits coming, a ship under air
  // attack (the target's point of view). An arc in progress is committed: nothing cuts into it but a carrier struck or a
  // carrier / battleship blowing up or going down (arcAllows), and the camera then comes back to it. Between arcs the
  // director's filler shots (a wide establishing shot first) run under the hysteresis arbiter below.
  // Every arc is logged on WW.cam.arcs as { id, kind, who, t0, t1, outcome: 'complete' | 'protagonistDown' |
  // 'cutAway' | 'superseded', interrupted } (plain data; any director can log the same shape for the audit).
  const arcs = [];
  let arcId = 0, sa = null, wideNext = false;
  const whoOf = o => !o ? '' : o.pt ? sqOf(o) + ' ' + o.kind : o.isBase ? 'base' : (o.name || o.type || '');
  function arcOpen(kind, prot, extra) {
    const a = Object.assign({ id: ++arcId, kind, who: whoOf(prot), cls: prot && prot.stats ? prot.type : prot && prot.pt ? 'plane' : '', t0: wall(), t1: null, outcome: null, interrupted: 0 }, extra || {});
    arcs.push(a); if (arcs.length > 500) arcs.shift();
    return a;
  }
  function arcClose(a, outcome) { if (!a || a.t1) return; a.t1 = wall(); a.outcome = outcome; if (outcome !== 'cutAway' && outcome !== 'superseded') wideNext = true; }
  const storyNow = () => (WW.camStory && WW.camStory.story()) || null;
  // the arc the camera is in (a story begun, or a ship arc)
  function arcBusy() { const st = storyNow(); return !!sa || !!(st && st.begun); }
  // is o part of the running arc? (its protagonist, group, wave, target; a ship arc's two ships and their attackers)
  function arcAbout(o) {
    if (!o) return false;
    if (sa) return o === sa.subj || o === sa.target || !!(o.pt && (o.target === sa.subj || o.diveTgt === sa.subj || o.foe === sa.subj));
    const st = storyNow(); if (!st || !st.begun) return false;
    const L = st.lead, T = L && (L.diveTgt || L.target || (L.wave && L.wave.target));
    return o === L || o === T || !!(L && L.wave && o.wave === L.wave) || !!(L && L.element && o.element === L.element);
  }
  // may an interrupt c (camera_scenes.js: a sinking, a magazine, a deck going up, the base bombarded) break into the arc?
  // Only a carrier struck / burning, or a carrier or a battleship blowing up or going down; anything about the arc itself
  function arcAllows(c) {
    if (!arcBusy() || !c) return true;
    if (arcAbout(c.subj)) return true;
    const s = c.subj; return !!(s && s.stats && (s.type === 'carrier' || (s.type === 'battleship' && c.pr >= 10.5)) && c.pr >= 10);
  }
  // the ship arcs available now, by promise (the class at stake first): read from events() and the ships' own state
  function shipArcs() {
    const out = [], ev = events(), now = wall();
    for (const s of WW.world.ships) {
      if (!isShip(s) || !s.alive || s.submerged) continue;
      const fromS = ev.filter(v => v.subject === s), onS = ev.filter(v => v.target === s);
      // a destroyer charge (ai_charge.js) or a torpedo run: a torpedo-armed ship closing on its target, tubes loaded
      const ch = s.ai && s.ai.charge, t = ch && ch.foe && ch.foe.alive ? ch.foe : s.target, tp = s.stats.torpedoes;
      const rested = now - (arcRest.get(s) || -1e9) > 60;   // a ship whose arc just ended waits a minute (no 12 s arcs over and over)
      if (tp && tp.count && rested && s.type !== 'carrier' && s.type !== 'submarine' && isShip(t) && t.alive) {
        const d = WW.dist(s.x, s.z, t.x, t.z), R = tp.range || 100;
        if ((ch || d < R * 1.5) && (!(s.ai && s.ai.torpReload > 0) || fromS.some(v => v.kind === 'torp')))
          out.push({ kind: ch ? 'charge' : 'torpRun', subj: s, target: t, promise: (ch ? 9.5 : 8.5) + (cls(t) - 1) * 1.6 + (fromS.length ? 0.8 : 0) });
      }
      // a gun duel with hits coming or scored: a big ship firing on a ship
      const fr = WW.camScenes && WW.camScenes.firedBy ? WW.camScenes.firedBy(s) : null;
      if (fr && rested && now - fr.at < 6 && (s.type === 'battleship' || s.type === 'cruiser') && isShip(fr.target) && fr.target.alive) {
        const n = fromS.filter(v => v.target === fr.target).length + (WW.camScenes.recentHits ? WW.camScenes.recentHits(fr.target, 12) : 0);
        if (n) out.push({ kind: 'duel', subj: s, target: fr.target, promise: 7.5 + (cls(fr.target) - 1) * 1.6 + (cls(s) - 1) * 0.5 + Math.min(1.5, n * 0.5) + (1 - fr.target.hp / fr.target.maxHp) });
      }
      // a ship under air attack: attackers committed to the run / the dive / the anvil, or an impact on her forecast within
      // 15 s (the raid inbound, the flak, the run, the hit: the target's point of view); a carrier struck outranks all
      const at = WW.camScenes ? WW.camScenes.attackers(s, 260) : [];
      const com = at.filter(p => p.phase === 'run' || p.phase === 'roll' || p.phase === 'dive' || p.sk === 'anvil').length;
      const soon = onS.filter(v => v.t < 15 && v.kind !== 'shellbig' && v.kind !== 'shellmed').length;
      if (com >= 1 || soon) out.push({ kind: 'raid', subj: s, target: null, promise: 7 + (cls(s) - 1) * 2.4 + 0.4 * Math.min(4, com) + (soon ? 1 : 0), struck: s.type === 'carrier' && (soon > 0 || com >= 2) });
    }
    return out.sort((a, b) => b.promise - a.promise);
  }
  const ARC_MIN = 8.5;
  const MENU = { charge: ['duel', 'low', 'chase', 'duel'], torpRun: ['duel', 'low', 'chase'], duel: ['duel', 'tgt', 'duel', 'low'], raid: ['aa', 'orbit', 'aa', 'low'] };
  function build(k, s, t) {
    const len = s.stats.length, d = (a, b) => a + (b - a) * Math.random();
    if (k === 'duel' && t) return { kind: 'duel', subj: s, target: t, dur: d(9, 12), pr: 8 };
    if (k === 'tgt' && t) return { kind: 'orbit', subj: t, r: t.stats.length * 1.6 + 22, dur: d(8, 11), w: 0.04, hgt: 0.14, loa: s, pr: 8 };
    if (k === 'low') return { kind: 'low', subj: s, dur: d(8, 11), pr: 7 };
    if (k === 'chase') return { kind: 'chase', subj: s, dur: d(8, 11), pr: 7 };
    if (k === 'aa') return WW.camScenes && WW.camScenes.attackers(s, 180).length ? { kind: 'aa', subj: s, dur: d(8, 11), pr: 8 } : null;
    if (k === 'orbit') return { kind: 'orbit', subj: s, r: len * 1.8 + 24, dur: d(9, 12), w: 0.04, hgt: 0.22, pr: 7.5 };
    return null;
  }
  // the next shot inside a ship arc: the forecast times the climax (an impact due on the arc's ship: the brace, held to
  // it), else the arc's shot menu, never the same kind twice running
  function arcShot() {
    if (!sa) return null;
    const s = sa.subj, t = sa.target, A = [s, t].filter(Boolean);
    if (!s.alive && !s.sinking) return null;
    for (const v of events()) {
      if (A.indexOf(v.target) < 0 || v.t > 9 || v.t < 0.8) continue;
      const e = v._f; sa.last = 'brace'; sa.shots++;
      return { user: sa.user, fkey: sa.user, kind: 'brace', subj: v.target, ev: e, hold: e.raw, pr: e.raw, dur: WW.clamp(v.tLast + BEAT, 4, 14), why: v.kind, label: labelOf(e), arc: sa.rec.id };
    }
    const M = MENU[sa.kind] || ['orbit'];
    for (let i = 0; i < M.length; i++) {
      const k = M[(sa.shots + i) % M.length]; if (k === sa.last) continue;
      const c = build(k, s, t && (t.alive || t.sinking) ? t : null); if (!c) continue;
      sa.last = k; sa.shots++; c.arc = sa.rec.id; c.label = arcLabel(sa);
      if (sa.user) Object.assign(c, { user: true, fkey: true });
      return c;
    }
    return null;
  }
  function arcLabel(a) {
    const s = nameOf(a.subj).replace(/^the /, 'The '), t = nameOf(a.target);
    if (a.kind === 'charge') return s + ' charges in on ' + t;
    if (a.kind === 'torpRun') return s + ' runs in to torpedo ' + t;
    if (a.kind === 'duel') return s + ' in a gun duel with ' + t;
    return s + ' under air attack';
  }
  function startShipArc(b, user) {
    if (sa) closeShipArc('superseded');
    sa = { kind: b.kind, subj: b.subj, target: b.target, t0: wall(), act: wall(), shots: 0, last: '', user: !!user, struck: !!b.struck, rec: arcOpen(b.kind, b.subj, { target: b.target ? b.target.type : '', promise: +b.promise.toFixed(1) }) };
    const c = arcShot(); if (!c) { closeShipArc('cutAway'); return false; }
    if (user) Object.assign(c, { user: true, fkey: true });
    if (!WW.cam.take(c, user ? { user: true } : { steal: true, arc: true })) { closeShipArc('cutAway'); return false; }
    return true;
  }
  const arcRest = new Map();
  function closeShipArc(outcome) { if (!sa) return; arcClose(sa.rec, outcome); arcRest.set(sa.subj, wall()); sa = null; }
  function tickShipArc(shot) {
    const s = sa.subj, t = sa.target, now = wall();
    if (shot && shot.arc !== sa.rec.id && !shot.interrupt && !shot.stage && (shot.story || shot.user || shot.pr >= 99)) { closeShipArc('cutAway'); return; }   // someone else took the camera (a story, a test)
    if (shot && shot.interrupt && shot.arcInt !== sa.rec.id) { shot.arcInt = sa.rec.id; sa.rec.interrupted++; }
    // activity: the arc's ships firing, torpedoes / shells / bombs in the air for them, attackers committed, still closing
    if (events().some(v => v.target === s || v.target === t || v.subject === s)) sa.act = now;
    const fr = WW.camScenes && WW.camScenes.firedBy ? WW.camScenes.firedBy(s) : null;
    if (fr && now - fr.at < 3) sa.act = now;
    if (sa.kind === 'raid' && WW.camScenes && WW.camScenes.attackers(s, 200).length) sa.act = now;
    const gone = o => o && (o.removed || (!o.alive && !o.sinking));
    if (!sa.endAt) {
      if (gone(s) || gone(t) || (s.sinking && (s.sinkT || 0) > 4) || (t && t.sinking && (t.sinkT || 0) > 4)) sa.endAt = now + 1;   // the outcome: a sinking (its first seconds filmed)
      else if (now - sa.act > 12 || now - sa.t0 > 75) sa.endAt = now;
    }
    const L = shot && WW.camLock && WW.camLock.state(shot);
    // (camera6: nor while a brace still waits for its impact: the arc's end cut to the establishing shot on the hit)
    if (sa.endAt && now >= sa.endAt && !(shot && (shot.stage || (L && L.release) || (shot.kind === 'brace' && shot.doneAt === undefined)))) {
      const out = s.alive || s.sinking ? 'complete' : 'protagonistDown';
      closeShipArc(out);
      if (shot && !shot.interrupt) shot.dur = Math.min(shot.dur, shot.t + 0.4);   // a wide establishing shot next (pickShot)
    }
  }
  // the climax inside an arc: an impact due on the arc's target in 1.5-6 s while the camera is elsewhere in the arc (not
  // in a hand-off, not in an attack's release window, not already braced): cut to the brace, inside the arc
  function climax(shot) {
    const look = !!(WW.camLook && WW.camLook.active());   // camera5: the impact times are known, not guessed: cut in sooner, from further out
    if (!shot || shot.stage || shot.kind === 'brace' || shot.t < (look ? 0.8 : 1.5) || shot.interrupt) return null;
    const L = WW.camLock && WW.camLock.state(shot); if (L) return null;   // an attack being filmed (the run, the dive, a salvo in the air): it shows its own result
    const sp = shot.plane || shot.subj; if (sp && sp.pt && sp.alive && sp.ordnance && (sp.phase === 'run' || sp.phase === 'roll' || sp.phase === 'dive')) return null;
    let T = null, own = null;
    if (sa) { T = [sa.subj, sa.target]; }
    else {
      const st = storyNow(); if (!st || !st.begun || !shot.story) return null;
      const P = st.lead; if (!P) return null;
      const tg = P.diveTgt || P.target || (P.wave && P.wave.target); if (!isShip(tg)) return null;
      T = [tg]; own = P;
      if (P.alive && P.ordnance && (P.phase === 'run' || P.phase === 'roll' || P.phase === 'dive')) return null;   // the protagonist's own attack: its chase and hand-off show the hit
    }
    for (const v of events()) {
      if (T.indexOf(v.target) < 0 || v.t < 1.5 || v.t > (look ? 7 : 6)) continue;
      if (own && v.subject && v.subject.pt && own.wave && v.subject.wave !== own.wave && v.weight < 10) continue;   // a story: its own wave's hits (or any big one)
      const e = v._f;
      return { kind: 'brace', subj: v.target, ev: e, hold: e.raw, pr: e.raw, dur: WW.clamp(v.tLast + BEAT, 4, 12), why: v.kind, label: labelOf(e) };
    }
    return null;
  }
  // a carrier about to be struck supersedes any other arc (the raid on her, picked early: the raid inbound, the flak,
  // the run, the hit); never one whose own climax is a carrier struck, never the last seconds of an attack
  function carrierCall(shot) {
    if (sa && sa.struck) return null;
    const b = shipArcs().find(a => a.kind === 'raid' && a.struck);
    if (!b || arcAbout(b.subj)) return null;
    const L = shot && WW.camLock && WW.camLock.state(shot);
    if (shot && (shot.stage || (L && L.release))) return null;
    return b;
  }

  // ---------- the arbiter ----------
  let tk = 0;
  function tick(rdt) {
    if ((tk -= rdt) > 0) return;
    tk = TICK;
    if (!(WW.game && WW.game.state === 'battle') || WW.cam.mode !== 'director' || (WW.freecam && WW.freecam.active()) || (WW.camNormandy && WW.camNormandy.on())) { if (sa) closeShipArc('cutAway'); return; }
    if (WW.cam.forced()) return;
    const shot = WW.cam._shot();
    if (sa) tickShipArc(shot);
    const st = storyNow();
    // a carrier about to be struck: break into whatever arc runs (a clean cut; the old arc is closed, not resumed)
    const look = !!(WW.camLook && WW.camLook.owns());   // camera5: the look-ahead director picks the arcs (camera_lookahead.js)
    const cv = (!look && !(st && st.user) && !(sa && sa.user) && !(shot && shot.user && !shot.fkey)) ? carrierCall(shot) : null;
    if (cv && (arcBusy() || !(shot && shot.subj === cv.subj))) {
      if (st && WW.camStory.supersede) WW.camStory.supersede();
      if (startShipArc(cv)) { ST.cuts++; ST.byKind['arc:cv'] = (ST.byKind['arc:cv'] || 0) + 1; log.push({ at: wall(), from: st ? 'story' : shot ? shot.kind : '-', to: 'arc:raid cv' }); }
      return;
    }
    // an air story still in its quiet setup (forming up, the long transit, home) gives way to a ship arc with a big ship at
    // stake (a battleship / carrier torpedo charge, a duel on a battleship): the story is closed; its strike comes back as
    // an arc of its own when its run-in begins
    if (!look && st && st.begun && !st.user && !sa && shot && shot.story && !shot.stage && shot.t > 3) {
      const ph = (WW.camStory._dbg() || {}).phase;
      if (ph === 'transit' || ph === 'form' || ph === 'home' || ph === 'launch') {
        const b = shipArcs()[0];
        if (b && b.promise >= 10) { WW.camStory.supersede(); if (startShipArc(b)) { ST.cuts++; const k = 'arc:' + b.kind; ST.byKind[k] = (ST.byKind[k] || 0) + 1; log.push({ at: wall(), from: 'story/' + ph, to: k + ' ' + b.promise.toFixed(1) }); } return; }
      }
    }
    if (arcBusy()) {                                                    // an arc in progress: committed (no hopping); the forecast only times its climax
      if (shot && !(shot.user && !shot.fkey)) {
        const c = climax(shot);
        if (c) {
          if (sa) { c.arc = sa.rec.id; if (sa.user) Object.assign(c, { user: true, fkey: true }); sa.last = 'brace'; if (WW.cam.take(c, { steal: false, arc: true, keepUser: !!sa.user })) { ST.climax = (ST.climax || 0) + 1; } }
          else if (WW.camStory.insert && WW.camStory.insert(c)) ST.climax = (ST.climax || 0) + 1;
        }
      }
      return;
    }
    if (!shot || (shot.user && !shot.fkey) || shot.pr >= 99 || shot.finale || shot.stage) return;
    const L = WW.camLock && WW.camLock.state(shot);
    if (L && L.release) return;                                        // the final seconds of an attack: never
    if (st && (st.user || !st.begun)) return;                           // a story waiting for this shot to end
    // between arcs: start the best ship arc (an air story starts from camera_story.js's own tick)
    if (!look && shot.t > 2.5 && !L && !shot.interrupt) {
      const b = shipArcs()[0];
      if (b && b.promise >= ARC_MIN && startShipArc(b)) { ST.cuts++; const k = 'arc:' + b.kind; ST.byKind[k] = (ST.byKind[k] || 0) + 1; log.push({ at: wall(), from: shot.kind, to: k + ' ' + b.promise.toFixed(1) }); return; }
    }
    // the filler shots: the best candidate against the running shot's worth plus hysteresis
    const C = WW.cam._candidates(), A = about(shot), b = bestOf(C, A);
    if (!b || b.pr < MIN_PR || (shot.t < 1.5 && b.pr < 11)) return;
    const w = worth(shot, C, A);
    let need = shot.t < MIN_T ? w + BIG : w + WW.lerp(2, 0.8, WW.clamp((shot.t - MIN_T) / Math.max(1, (shot.dur || 10) - MIN_T), 0, 1));
    if (L) need = Math.max(need, w + (L.why === 'sinking' ? 1.5 : BIG));
    if (b.pr <= need) return;
    const from = shot.kind + ' ' + w.toFixed(1);
    if (!WW.cam.take(b)) return;
    ST.cuts++; const k = b.kind + (b.why ? ':' + b.why : ''); ST.byKind[k] = (ST.byKind[k] || 0) + 1;
    log.push({ at: wall(), from, to: k + ' ' + b.pr.toFixed(1) }); if (log.length > 100) log.shift();
  }
  if (WW.cam && WW.cam.update) { const u = WW.cam.update; WW.cam.update = function (rdt) { try { tick(rdt || 0); } catch (e) { console.error('camDirector', e); } return u.apply(this, arguments); }; }
  WW.on('roundStart', () => { tk = 0; fc = []; fcAt = -1e9; if (sa) closeShipArc('cutAway'); wideNext = false; arcs.length = 0; arcRest.clear(); });
  WW.on('setupStart', () => { if (sa) closeShipArc('cutAway'); });
  // camera.js pickShot(): the next shot of the ship arc; else, right after an arc, a short wide establishing shot
  function arcPick() {
    if (sa) { const c = arcShot(); if (c) return c; closeShipArc('complete'); }
    if (wideNext) {
      wideNext = false;
      // (camera5: a carrier hit known to land within 9 s: no establishing shot first, the brace on her; camera6: a battleship too)
      if (WW.camLook && WW.camLook.active()) for (const v of events()) if (v.target && (v.target.type === 'carrier' || v.target.type === 'battleship') && v.t > 1.5 && v.t < 9) { const e = v._f; return { kind: 'brace', subj: v.target, ev: e, hold: e.raw, pr: e.raw, dur: WW.clamp(v.tLast + BEAT, 4, 12), why: v.kind, label: labelOf(e) }; }
      return { kind: 'wide', dur: 6 + Math.random() * 2, pr: 2 };
    }
    return null;
  }

  // ---------- F: the best thing now, with a label ----------
  function describe(c) {
    const s = c.subj, t = c.target && !c.target.removed ? c.target : null;
    if (c.label) return c.label;
    if (s && s.pt && s.kind) {
      const tg = s.diveTgt || s.target || t;
      if (s.kind === 'torpedo' && s.phase === 'run') return sqOf(s) + ' torpedo run on ' + nameOf(tg);
      if (s.kind === 'dive' && (s.phase === 'roll' || s.phase === 'dive')) return sqOf(s) + ' diving on ' + nameOf(tg);
      if (c.kind === 'ots' || (s.kind === 'fighter' && s.foe)) return sqOf(s) + ' in a dogfight';
      if (tg && s.ordnance) return sqOf(s) + ' going in on ' + nameOf(tg);
      return sqOf(s);
    }
    if (c.kind === 'duel') return nameOf(s) + ' firing on ' + nameOf(t);
    if (c.kind === 'aa') return nameOf(s) + ' under air attack';
    if (c.kind === 'profile') return nameOf(s) + ' going down';
    if (c.kind === 'base') return 'The airfield under ' + (c.why === 'bombard' ? 'bombardment' : c.why === 'raid' ? 'air attack' : 'alert');
    if (c.plane) return nameOf(s) + ' under attack by ' + sqOf(c.plane);
    return s && s.stats ? nameOf(s).replace(/^the /, 'The ') : 'The action';
  }
  // F (camera_follow.js): the best ARC now. An arc running is kept and named (the user adopts it); else the best ship arc
  // or the best air story (camera_story.js bestArc), by promise on one scale: the class at stake, committed or not
  function airPromise(a) {
    const L = a.lead, T = L && (L.diveTgt || L.target || (L.wave && L.wave.target));
    const com = L && (L.phase === 'run' || L.phase === 'roll' || L.phase === 'dive' || L.sk === 'anvil');
    return (T && (T.stats || T.isBase) ? 7.5 + (cls(T) - 1) * 1.6 : 6) + (com ? 1.5 : a.item ? 0.8 : 0);
  }
  function fPick() {
    if (sa) return { keep: 'ship', label: arcLabel(sa), subj: sa.subj };
    const st = storyNow(); if (st && st.begun) return { keep: 'air', label: WW.camStory.titleOf(st.lead, st.mission).filter(Boolean).join(' · '), subj: st.lead };
    const b = shipArcs()[0], a = WW.camStory && WW.camStory.bestArc ? WW.camStory.bestArc() : null;
    const ap = a ? airPromise(a) : -1, bp = b ? b.promise : -1;
    if (bp < 0 && ap < 0) return null;
    return bp >= ap ? { ship: b, label: arcLabel(b), subj: b.subj } : { air: a, label: WW.camStory.titleOf(a.lead, a.mission).filter(Boolean).join(' · '), subj: a.lead };
  }
  function endShipArc(outcome) { if (sa && !sa.user) { closeShipArc(outcome || 'superseded'); if (outcome === 'complete') wideNext = true; const sh = WW.cam._shot(); if (sh && !sh.stage) sh.dur = Math.min(sh.dur, sh.t); } }
  function adoptShip() { if (!sa) return false; sa.user = true; sa.rec.user = true; const sh = WW.cam._shot(); if (sh && sh.arc === sa.rec.id) Object.assign(sh, { user: true, fkey: true }); return true; }
  const userArc = () => (sa && sa.user ? sa.subj : null);
  function endUserArc() { if (sa && sa.user) closeShipArc('cutAway'); }
  // F: the best candidate now; keep: the running shot is already on something at least as good (F then just names it)
  function bestNow() {
    const C = WW.cam._candidates(), b = bestOf(C, null), shot = WW.cam._shot();
    if (shot && !shot.user && !shot.story && shot.pr < 99 && shot.subj && !shot.subj.removed && shot.kind !== 'wide') {
      const A = about(shot), w = worth(shot, C, A);
      if (!b || w >= b.pr || mine(b, A)) return { keep: true, shot, subj: shot.subj, label: describe(Object.assign({}, shot, { label: shot.kind === 'brace' && shot.ev ? labelOf(shot.ev) : shot.label })) };
    }
    return b ? Object.assign(b, { label: describe(b) }) : null;
  }

  WW.camDirector = { fPick, adoptShip, endShipArc, labelOf, userArc, endUserArc, events, arcs, arcBusy, arcAbout, arcAllows, arcPick, shipArcs, startShipArc, arcOpen, arcClose, arcLabel, cls, forecast, forecastFor, torpEta, frameCheck, sight, start, goal, clearSight, bestNow, describe, about, worth, stats: ST, log, MIN_T, BIG };
  if (WW.cam) { WW.cam.frameCheck = frameCheck; WW.cam.arcs = arcs; }
})(window.WW);
