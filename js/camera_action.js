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
  const HOLD_HIT = 2.6, HOLD_MISS = 2.2;     // real seconds on the explosion / the empty splash (the beat after the result)
  const TORP_MAX = 45;                       // a torpedo stage holds to the impact event; air torpedoes run up to ~41 real s
  const _n = new THREE.Vector3();
  // a plane in the frame, within 140 u (a wingman of the filmed group dropping in view: its drop is handed off too)
  function inFrame(o) {
    const c = WW.camera; if (!c || !o) return false;
    if (Math.hypot(c.position.x - o.x, c.position.y - o.y, c.position.z - o.z) > 140) return false;
    _n.set(o.x, o.y, o.z).project(c); return _n.z < 1 && Math.abs(_n.x) < 0.9 && Math.abs(_n.y) < 0.9;
  }
  // the dropping plane is the shot's subject, or a wingman of its group / wave in frame attacking the same target
  function mineOrWing(ev, shot) {
    const p = ev.plane, s = shot.subj;
    if (!p || !p.kind) return false;
    if (p === s || p === shot.plane) return true;
    const sub = s && s.pt ? s : shot.plane;
    if (!sub || !sub.pt) return false;
    const same = (shot.group && shot.group.indexOf(p) >= 0) || (sub.wave && p.wave === sub.wave) || (sub.element && p.element === sub.element);
    if (!same || !inFrame(p)) return false;
    const L = WW.camLock && WW.camLock.state(shot);   // the subject about to drop itself keeps the camera
    if (L && L.release) return false;
    // a torpedo bomber on its run drops within ~8 real s of its drop range + 80 u: a wingman's bomb (1 s fall + the beat) would end the
    // shot just before the subject's own release (docs/camera_audit.md, the midway/1 VT-6 case)
    if (sub.kind === 'torpedo' && sub.phase === 'run' && sub.target && WW.dist(sub.x, sub.z, sub.target.x, sub.target.z) < (sub.dropR || 100) + 80) return false;
    return true;
  }
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
    if (!live || !shot || (shot.stage && shot.stage !== 'hold') || shot.nohand || !ev || !ev.proj) return; // a new drop may take over the beat on a result
    const p = ev.proj, cur = WW.cam.current();
    if (ev.kind === 'bomb') {
      const mine = mineOrWing(ev, shot);
      const onShip = (shot.kind === 'orbit' || shot.kind === 'aa') && shot.subj && !shot.subj.diorama && ev.target === shot.subj;
      if (!mine && !onShip) return;
      const y0 = Math.max(0.5, p.y), tf = Math.sqrt(2 * y0 / 9.8);
      const I = V().set(p.x + p.vx * tf, 0, p.z + p.vz * tf);
      // camera spot: on the side the camera already is, beside the impact point, clear of the target hull
      const u = V().set(cur.P.x - I.x, 0, cur.P.z - I.z);
      if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
      u.normalize();
      const C = I.clone().addScaledVector(u, 24); C.y = 11;
      const s = shipOf(ev.target) || shipOf(shot.subj);
      if (shot.deck) C.copy(cur.P); // from the deck (camera_scenes.js aa): stay there and watch the bomb come down (a move off the deck in the bomb's 1-2 s fall whips the view)
      else if (s) { // broadside on the target, on the camera's side, a little toward where the camera was along the hull
        const fx = Math.cos(s.heading), fz = Math.sin(s.heading), nx = -fz, nz = fx, L = s.stats.length;
        const sg = (cur.P.x - s.x) * nx + (cur.P.z - s.z) * nz >= 0 ? 1 : -1;
        const al = WW.clamp((cur.P.x - s.x) * fx + (cur.P.z - s.z) * fz, -L * 0.6, L * 0.6), off = L * 0.5 + 18;
        C.set(s.x + nx * sg * off + fx * al, 12, s.z + nz * sg * off + fz * al);
      }
      Object.assign(shot, { stage: 'bomb', proj: p, y0, I, C, st: 0, dur: shot.t + 12, kP: 6, kL: 6, aim: V().set(p.x, p.y, p.z),
        P0: cur.P.clone(), L0: cur.L.clone() });
      handFrom(shot);
    } else if (ev.kind === 'torpedo') {
      const ship = ev.plane && ev.plane.stats && ev.plane === shot.subj && !shot.story ? ev.plane : null;   // camera4: the filmed ship's own spread (a destroyer charge)
      if (!ship && (!ev.plane || !ev.plane.kind || !mineOrWing(ev, shot))) return; // torpedo bombers (ships have no .kind), or the filmed ship
      const h = p.h, f = V().set(Math.cos(h), 0, Math.sin(h));
      const off = V().copy(cur.P).sub(V().set(p.x, 0, p.z));   // start from where the camera is: no jump
      const tg = ship ? (ship.ai && ship.ai.charge && ship.ai.charge.foe) || ship.target || shot.target : ev.plane.target;
      Object.assign(shot, { stage: 'torp', proj: p, fwd: f, off, tship: shipOf(tg), st: 0, dur: shot.t + TORP_MAX, // the impact ends it
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
    const f = shot.fwd, s = shot.tship && !shot.tship.removed && (shot.tship.alive || shot.tship.sinking) ? shot.tship : null;
    // camera4: a torpedo plainly missing (no hull on its track: camera_director.js torpEta) lets go after a short look at
    // the wake (the impact event never comes for a miss, and 40 s down an empty wake is dead air)
    if (shot.st > 2.5 && WW.camDirector) {
      const e = s && s.alive ? WW.camDirector.torpEta(p, s) : -1, hits = e >= 0;
      // (and a run that is still far from the hull after 14 s: the shot has shown the wake; the director braces the ship later)
      shot.missT = hits && !(shot.st > 14 && (WW.camFinder ? WW.camFinder.realS(e) : e) > 4) ? 0 : (shot.missT || 0) + rdt;
      // (a miss whose run ends within ~6 real s is ridden out: the miss is the result, "missed astern"; only a long empty run is let go)
      const left = Math.max(0, ((p.range || 100) - (p.run || 0)) / (p.sp || 14)), leftR = WW.camFinder ? WW.camFinder.realS(left) : left;
      // (camera5: or a miss known ahead, with another hit on the target due)
      if ((shot.missT > 1.2 && (leftR > 6 || hits)) || (WW.camLook && WW.camLook.handoffLetGo(shot))) { shot.stage = 'hold'; shot.st = 0; shot.hold = HOLD_MISS; shot.proj = null; shot.from = shot.aim.clone(); shot.fromObj = null; shot.aim.set(p.x + f.x * 6, 0.5, p.z + f.z * 6); return hold(shot, gP, gL); }
    }
    let far = ease(WW.clamp((shot.st - 6) / 8, 0, 1)), back = 13 + 9 * far, hgt = 5.5 + 5 * far, look = 10;
    if (s) {
      // the wake running into the hull: back along the track, high enough over the wake that the target sits beyond it in
      // the frame; the look point slides from the wake to the hull as she comes near
      const d = Math.hypot(s.x - p.x, s.z - p.z), R = s.stats.length * 0.5 + 7 + back + 10;
      far = Math.max(far, ease(WW.clamp(d / 160, 0, 1)));
      back = 13 + 9 * far; hgt = 6 + 7 * far + WW.clamp((R - d) * 0.25, 0, 4);
      look = WW.clamp(d * 0.55, 10, 90);
      shot.hullK = WW.clamp(1 - (d - 40) / 80, 0, 1);   // the last 120 u: the aim slides onto the hull (no top-down look at the wake)
    }
    _d.set(-f.x * back - f.z * shot.side * (4 + 3 * far), hgt, -f.z * back + f.x * shot.side * (4 + 3 * far));
    shot.off.lerp(_d, 1 - Math.exp(-rdt * 1.6));
    gP.set(p.x + shot.off.x, shot.off.y, p.z + shot.off.z);
    shot.lk = shot.lk === undefined ? 10 : shot.lk + (look - shot.lk) * (1 - Math.exp(-rdt * 1.2));
    shot.aim.set(p.x + f.x * shot.lk * 0.5, 0.6, p.z + f.z * shot.lk * 0.5);
    if (s && shot.hullK) { shot.hk = (shot.hk || 0) + (shot.hullK - (shot.hk || 0)) * (1 - Math.exp(-rdt * 1.5)); shot.aim.lerp(_a.set(s.x, 2, s.z), shot.hk * 0.7); }
    settle(shot, 0.9);
    gL.set(p.x + f.x * shot.lk, 0.8, p.z + f.z * shot.lk);
    gL.lerpVectors(shot.L0, gL, ease(WW.clamp(shot.st / 1.5, 0, 1))); // turn from the plane to the wake gently
  }
  function hold(shot, gP, gL) {
    if (shot.lastP) gP.copy(shot.lastP); else gP.copy(WW.cam.current().P);
    // (camera5: another hit on the same ship, known to land inside the beat: the beat turns to it and lasts through it)
    const ha = WW.camLook && !shot.toLA ? WW.camLook.holdAim(shot) : null;
    if (ha) { shot.toLA = true; shot.from = shot.from || shot.aim.clone(); shot.fromObj = null; shot.to = V().set(ha.x, ha.y, ha.z); shot.hold = Math.max(shot.hold || 0, (shot.st || 0) + ha.eta + 1.5); }
    if (shot.from && !shot.fromObj) { // the hold eases its aim onto the explosion
      shot.to = shot.to || shot.aim.clone(); shot.aim.copy(shot.to); settle(shot, 0.5);
    }
    gL.copy(shot.aim);
    if (shot.st >= shot.hold) { // the beat is over
      const s = shot.subj;
      if (s && s.pt && s.alive && !s.removed && s.ordnance && (s.phase === 'run' || s.phase === 'roll' || s.phase === 'dive')) {
        // the shot's own subject is still committed to its attack (a wingman's result was a beat inside it): back to the chase, no cut
        shot.stage = null; shot.proj = null; shot.from = null; shot.fromObj = null; shot.lastP = null; shot.to = null;
        shot.dur = Math.max(shot.dur, shot.t + 8); shot.kP = 4; shot.kL = 4;
        return;
      }
      shot.t = shot.dur; // the director cuts to the next shot
    }
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
    const FK = Math.pow(WW.cfg.PLANE_K || 1, 0.6), dir = shot.dir, back = 16 * FK;   // closer in for smaller planes (16 at the 1.7 plane scale)
    _r.set(-dir.z, 0, dir.x).normalize();
    shot.lat = shot.lat === undefined ? shot.side * 3 * FK : shot.lat;
    gP.set(a.x - dir.x * back + _r.x * shot.lat, a.y - dir.y * back + 5 * FK, a.z - dir.z * back + _r.z * shot.lat);
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
    // the round's last sinking (camera.js finale): 0.5x held for max real s, whatever the gap since the last one
    finale(max) { slowAt = slowLast = clock; holdFn = () => true; holdMax = max || 3; },
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
        if (!shot.deck) lift(gP, shot, shot.stage === 'torp' ? 8 : 16, rdt); // (the wake running in: a shorter band, the camera stays low to the hull) // (also while holding: a ship steaming into a still camera lifts it, rather than shoving it; not a deck camera off its own hull)
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
