// camera_action.js (camera): action shots for the director in camera.js.
//  - bomb cam: a filmed dive-bomb attack hands off to the falling bomb, then holds on the impact;
//  - torpedo hand-off: a filmed torpedo run hands off to the torpedo's wake, to the hit (or the miss);
//  - over-the-shoulder: behind and a little above an attacking fighter, its target ahead (heavily damped);
//  - slow motion: ~0.5x for ~1.5 s (eased) on a kill or a direct hit that is being filmed right now; a filmed dive
//    (camera_story.js) holds it while the dive lasts (slowmo(until, max)), so the push-over to the release reads.
// Hand-offs never cut: they change the live shot in place, so the camera glides on.
// Slow motion only sets WW.time.warp (main.js scales the sim dt by it); everything else is real time.
window.WW = window.WW || {};
(function (WW) {
  const HOLD_HIT = 2.6, HOLD_MISS = 1.3;     // real seconds on the explosion / the empty splash
  const SLOW_GAP = 20;                       // at most one slow motion per 20 real seconds
  const ease = x => x * x * (3 - 2 * x);
  const V = () => new THREE.Vector3();
  let clock = 0, slowAt = -1e9, slowLast = -1e9, live = false, holdFn = null, holdMax = 0;

  // until (optional): hold the 0.5x while until() is true, at most max real s
  function slowmo(until, max) {
    if (!live || clock - slowLast < SLOW_GAP) return false;
    slowAt = slowLast = clock; holdFn = typeof until === 'function' ? until : null; holdMax = max || 0;
    return true;
  }
  // 1 -> 0.5 over 0.3 s, hold to 1.3 s, back to 1 by 1.8 s
  function warpAt(t) {
    if (t < 0 || t > 1.8) return 1;
    if (t < 0.3) return 1 - 0.5 * ease(t / 0.3);
    if (t < 1.3) return 0.5;
    return 0.5 + 0.5 * ease((t - 1.3) / 0.5);
  }

  function shipOf(o) { return o && o.stats && !o.removed ? o : null; }

  // ---------- hand-offs (events come from combat_weapons.js during the sim step) ----------
  function onDrop(ev) {
    const shot = WW.cam && WW.cam._shot && WW.cam._shot();
    if (!live || !shot || shot.stage || shot.nohand || !ev || !ev.proj) return; // nohand: a brief cut away (camera_story.js dive) returns to its story
    const p = ev.proj, cur = WW.cam.current();
    if (ev.kind === 'bomb') {
      const mine = ev.plane && (ev.plane === shot.subj || ev.plane === shot.plane);
      const onShip = shot.kind === 'orbit' && shot.subj && !shot.subj.diorama && ev.target === shot.subj;
      if (!mine && !onShip) return;
      const y0 = Math.max(0.5, p.y), tf = Math.sqrt(2 * y0 / 9.8);
      const I = V().set(p.x + p.vx * tf, 0, p.z + p.vz * tf);
      // camera spot: on the side the camera already is, beside the impact point, clear of the target hull
      const u = V().set(cur.P.x - I.x, 0, cur.P.z - I.z);
      if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
      u.normalize();
      const C = I.clone().addScaledVector(u, 24); C.y = 11;
      const s = shipOf(ev.target) || shipOf(shot.subj);
      if (s) { // broadside on the target, on the camera's side, a little toward where the camera was along the hull
        const fx = Math.cos(s.heading), fz = Math.sin(s.heading), nx = -fz, nz = fx, L = s.stats.length;
        const sg = (cur.P.x - s.x) * nx + (cur.P.z - s.z) * nz >= 0 ? 1 : -1;
        const al = WW.clamp((cur.P.x - s.x) * fx + (cur.P.z - s.z) * fz, -L * 0.6, L * 0.6), off = L * 0.5 + 18;
        C.set(s.x + nx * sg * off + fx * al, 12, s.z + nz * sg * off + fz * al);
      }
      Object.assign(shot, { stage: 'bomb', proj: p, y0, I, C, st: 0, dur: shot.t + 12, kP: 6, kL: 6, aim: V().set(p.x, p.y, p.z),
        P0: cur.P.clone(), L0: cur.L.clone() });
      handFrom(shot);
    } else if (ev.kind === 'torpedo') {
      if (!ev.plane || ev.plane !== shot.subj || !ev.plane.kind) return; // torpedo bombers only (ships have no .kind)
      const h = p.h, f = V().set(Math.cos(h), 0, Math.sin(h));
      const off = V().copy(cur.P).sub(V().set(p.x, 0, p.z));   // start from where the camera is: no jump
      Object.assign(shot, { stage: 'torp', proj: p, fwd: f, off, tship: shipOf(ev.plane.target), st: 0, dur: shot.t + 14,
        kP: 4, kL: 5, side: shot.side || 1, aim: V().set(p.x, 0.3, p.z), L0: cur.L.clone() });
      handFrom(shot);
    }
  }
  function onImpact(ev) {
    const shot = WW.cam && WW.cam._shot && WW.cam._shot();
    if (!shot || !shot.stage || !ev || ev.proj !== shot.proj || shot.stage === 'hold') return;
    const hit = !!ev.ship;
    shot.stage = 'hold'; shot.proj = null; shot.st = 0; shot.hold = hit ? HOLD_HIT : HOLD_MISS;
    shot.from = shot.aim.clone(); shot.fromObj = null;
    shot.aim.set(ev.x, hit ? 1.8 : 0.8, ev.z);
    if (hit) shot.slow = slowmo();
  }

  // the composition subject eases from the old one (still moving) to the new one: no snap in the framing
  function handFrom(shot) {
    const o = shot.subj && !shot.subj.diorama && !shot.subj.removed ? shot.subj : null;
    shot.fromObj = o; shot.from = shot.last ? shot.last.clone() : WW.cam.current().L.clone();
  }
  function settle(shot, T) {
    if (!shot.from) return;
    const e = ease(WW.clamp(shot.st / T, 0, 1)), o = shot.fromObj;
    if (o && !o.removed) shot.from.set(o.x, o.y !== undefined ? o.y : 0, o.z);
    shot.aim.lerpVectors(shot.from, shot.aim, e);
    if (e >= 1) shot.from = null;
  }

  // a fast-moving goal rises smoothly before it reaches a hull's no-go circle (camera.js would shove it sideways)
  // The lift ramps in over `band` units and is itself eased (quick up, slow down), so a camera racing
  // past a ship floats over it instead of bobbing.
  function lift(v, shot, band, rdt) {
    let need = 0;
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      const R = s.stats.length * 0.5 + 7, d = Math.hypot(v.x - s.x, v.z - s.z);
      if (d < R + band) need = Math.max(need, 16 * ease(WW.clamp(1 - (d - R) / band, 0, 1)));
    }
    const want = Math.max(0, need - v.y), cur = shot.liftD || 0;
    shot.liftD = cur + (want - cur) * (1 - Math.exp(-rdt * (want > cur ? 5 : 0.8)));
    v.y += shot.liftD;
  }

  // ---------- per-frame goals ----------
  const _d = V(), _r = V(), _a = V(), _q = new THREE.Quaternion(), _q0 = new THREE.Quaternion();
  function bomb(shot, gP, gL) {
    const p = shot.proj;
    if (!p || p.dead || p.kind !== 'bomb') { shot.stage = 'hold'; shot.st = 0; shot.hold = HOLD_MISS; return hold(shot, gP, gL); }
    // the camera rides along with the bomb at first and settles beside the impact point as it falls
    const f = ease(WW.clamp(1 - p.y / shot.y0, 0, 1));
    gP.set(shot.C.x + (p.x - shot.I.x) * (1 - f), shot.C.y + Math.max(0, p.y - 2) * 0.5 * (1 - f), shot.C.z + (p.z - shot.I.z) * (1 - f));
    shot.aim.set(p.x, Math.max(0.5, p.y), p.z);
    gL.copy(shot.aim);
    settle(shot, 0.8);
    // ease out of the previous shot (no velocity step at the hand-off)
    const b = ease(WW.clamp(shot.st / 1.1, 0, 1));
    gP.lerpVectors(shot.P0, gP, b); gL.lerpVectors(shot.L0, gL, ease(WW.clamp(shot.st / 0.7, 0, 1)));
  }
  function torp(shot, gP, gL, rdt) {
    const p = shot.proj;
    if (!p || p.dead || p.kind !== 'torp') { shot.stage = 'hold'; shot.st = 0; shot.hold = HOLD_MISS; return hold(shot, gP, gL); }
    const f = shot.fwd, back = 13, s = shot.tship;
    // low over the wake, a little to the side; climb as the hull comes near so we never sit beside it
    let hgt = 5.5;
    if (s && !s.removed) {
      const d = Math.hypot(s.x - p.x, s.z - p.z), R = s.stats.length * 0.5 + 7 + back + 10;
      hgt += WW.clamp((R - d) * 0.6, 0, 10);
    }
    _d.set(-f.x * back - f.z * shot.side * 4, hgt, -f.z * back + f.x * shot.side * 4);
    shot.off.lerp(_d, 1 - Math.exp(-rdt * 1.6));
    gP.set(p.x + shot.off.x, shot.off.y, p.z + shot.off.z);
    shot.aim.set(p.x + f.x * 5, 0.3, p.z + f.z * 5);
    settle(shot, 0.9);
    gL.set(p.x + f.x * 10, 0.5, p.z + f.z * 10);
    gL.lerpVectors(shot.L0, gL, ease(WW.clamp(shot.st / 0.9, 0, 1))); // turn from the plane to the wake gently
  }
  function hold(shot, gP, gL) {
    if (shot.lastP) gP.copy(shot.lastP); else gP.copy(WW.cam.current().P);
    if (shot.from && !shot.fromObj) { // the hold eases its aim onto the explosion
      shot.to = shot.to || shot.aim.clone(); shot.aim.copy(shot.to); settle(shot, 0.5);
    }
    gL.copy(shot.aim);
    if (shot.st >= shot.hold) shot.t = shot.dur; // the director cuts to the next shot
  }
  // over the shoulder of an attacking fighter, framing its target ahead
  function ots(shot, gP, gL, rdt) {
    const a = shot.subj, k = 1 - Math.exp(-rdt * 1.4);
    shot.kP = shot.kP || 6; shot.kL = shot.kL || 6; // the aim is damped below; the follow itself stays tight
    let f = shot.foe;
    if (a.foe && a.foe !== f && a.foe.alive && (!f || !f.alive || f.removed)) f = shot.foe = a.foe, shot.foeDead = 0;
    if (f && (f.removed || (!f.alive && shot.foeDead > 2.8))) f = shot.foe = (a.foe && a.foe.alive ? a.foe : null), shot.foeDead = 0;
    if (f && !f.alive && !(f.hp > 0)) { // shot down (a landing or a ditching is not a kill)
      if (!shot.foeDead) { // the latched foe just went down: a kill on camera
        shot.foeDead = 1e-3;
        if (Math.hypot(f.x - a.x, f.y - a.y, f.z - a.z) < 40) shot.slow = slowmo();
        shot.dur = Math.max(shot.dur, shot.t + 3);
      } else shot.foeDead += rdt;
    }
    shot.noFoe = f ? 0 : (shot.noFoe || 0) + rdt;
    if (shot.noFoe > 3) shot.dur = Math.min(shot.dur, shot.t + 1); // the dogfight is over: move on
    if (f) _d.set(f.x - a.x, WW.clamp(f.y - a.y, -25, 25), f.z - a.z);
    else _d.set(Math.cos(a.heading), 0, Math.sin(a.heading));
    const dist = f ? _d.length() : 0;
    _d.normalize(); _d.y = WW.clamp(_d.y, -0.45, 0.45); _d.normalize();
    if (!shot.dir) shot.dir = _d.clone();
    // the aim turns slowly (eased, at most 0.7 rad/s): hard maneuvers and head-on passes do not whip the frame
    const ang = shot.dir.angleTo(_d);
    if (ang > 1e-4) {
      _q.setFromUnitVectors(shot.dir, _d); _q0.identity().slerp(_q, Math.min(k, 0.7 * rdt / ang));
      shot.dir.applyQuaternion(_q0).normalize();
    }
    const dir = shot.dir, back = 16;
    _r.set(-dir.z, 0, dir.x).normalize();
    shot.lat = shot.lat === undefined ? shot.side * 3 : shot.lat;
    gP.set(a.x - dir.x * back + _r.x * shot.lat, a.y - dir.y * back + 5, a.z - dir.z * back + _r.z * shot.lat);
    const want = WW.clamp(dist * 0.5, 8, 30);
    shot.ahead = shot.ahead === undefined ? want : shot.ahead + (want - shot.ahead) * k; // a new foe: no jump
    const ahead = shot.ahead;
    gL.set(a.x + dir.x * ahead, a.y + dir.y * ahead, a.z + dir.z * ahead);
    shot.aim = shot.aim || V();
    _a.set(a.x, a.y, a.z);
    shot.aim.copy(_a).lerp(gL, 0.35);
  }

  WW.camAction = {
    slowmo, // night_fx.js: a star shell revealing a target
    init() {
      WW.on('weaponDropped', onDrop);
      WW.on('weaponImpact', onImpact);
      WW.on('roundStart', () => { slowAt = -1e9; holdFn = null; WW.time.warp = 1; });
    },
    // shot goals for the action kinds; returns true when it filled gP / gL
    goal(shot, gP, gL, rdt) {
      if (!shot) return false;
      if (shot.stage) {
        shot.st += rdt;
        if (shot.stage === 'bomb') bomb(shot, gP, gL);
        else if (shot.stage === 'torp') torp(shot, gP, gL, rdt);
        else hold(shot, gP, gL);
        if (shot.stage !== 'hold') shot.lastP = (shot.lastP || V()).copy(gP);
        lift(gP, shot, 16, rdt); // (also while holding: a ship steaming into a still camera lifts it, rather than shoving it)
        return true;
      }
      if (shot.kind === 'ots') {
        if (!shot.subj || shot.subj.removed) { const c = WW.cam.current(); gP.copy(c.P); gL.copy(c.L); shot.t = shot.dur; return true; }
        ots(shot, gP, gL, rdt); lift(gP, shot, 30, rdt); return true;
      }
      return false;
    },
    // real-time clock and slow-motion envelope; `on` = the director is filming a battle right now
    tick(rdt, on) {
      clock += rdt; live = on;
      if (!on) { slowAt = -1e9; holdFn = null; }
      if (holdFn) { // a held slow motion: stay at 0.5x, then ease out from where it lets go
        let go = false; try { go = clock - slowAt < holdMax && holdFn(); } catch (e) { go = false; }
        if (go && clock - slowAt > 1.3) slowAt = clock - 1.3;
        if (!go) holdFn = null;
      }
      WW.time.warp = warpAt(clock - slowAt);
    },
    _dbg() { return { clock, slowAt, slowLast, warp: WW.time.warp, live }; }
  };
})(window.WW);
