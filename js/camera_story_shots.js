// camera_story_shots.js (camera): the shot goals of story mode (camera_story.js). Each story shot is a
// director shot of kind 'story' with a sub-kind `sk`; camera.js calls goal() for it each frame (after
// camera_action.js, so a bomb / torpedo hand-off still takes over a story shot). Every goal is built from
// smoothed inputs (heading, formation centre), and sets shot.aim for camera.js compose(). Shot kinds:
//   chase  behind and above the leader;           wing   beside a wingman, looking across at the leader;
//   ots    over the shoulder toward the target;   side   side-on tracking shot of the formation;
//   water  low over the sea as torpedo bombers pass;  high  high wide shot of the strike and the enemy;
//   deck   the carrier deck at launch;             fall   holds still and watches the leader go down.
// Visual only: Math.random, never WW.rand; reads the sim, never writes it.
window.WW = window.WW || {};
(function (WW) {
  const V = () => new THREE.Vector3();
  const _f = V(), _r = V(), _c = V(), _t = V();
  const ok = p => p && !p.removed && p.alive;
  const airborne = p => ok(p) && p.state !== 'takeoff' && p.state !== 'rollout' && p.state !== 'landing';

  // eased heading: hard turns swing the camera round slowly
  function smoothH(shot, h, rdt, rate) {
    if (shot.hS === undefined) shot.hS = h;
    shot.hS += WW.angleDiff(shot.hS, h) * (1 - Math.exp(-rdt * (rate || 1.2)));
    return shot.hS;
  }
  // eased formation centre of the story's group (falls back to the leader)
  function centre(shot, rdt) {
    const L = shot.subj, M = (shot.group || []).filter(m => airborne(m) && Math.hypot(m.x - L.x, m.y - L.y, m.z - L.z) < 60); // stragglers stay out
    _c.set(0, 0, 0);
    if (M.length) { for (const m of M) _c.x += m.x, _c.y += m.y, _c.z += m.z; _c.multiplyScalar(1 / M.length); }
    else _c.set(L.x, L.y || 0, L.z);
    if (!shot.cS) shot.cS = _c.clone();
    else shot.cS.lerp(_c, 1 - Math.exp(-rdt * 2.5));
    return shot.cS;
  }
  function tgtOf(p) {
    const t = p.diveTgt || p.outTgt || p.target || (p.wave && p.wave.target);
    return t && !t.removed && t.stats ? t : null;
  }
  function enemyCentre(nation) {
    let x = 0, z = 0, n = 0;
    for (const s of WW.world.ships) if (s.alive && s.nation !== nation) { x += s.x; z += s.z; n++; }
    return n ? { x: x / n, z: z / n } : null;
  }
  // the wingman to ride beside: the nearest other member of the leader's group
  function wingOf(shot) {
    const L = shot.subj; let best = null, bd = 1e9;
    for (const m of shot.group || []) {
      if (m === L || !airborne(m)) continue;
      const d = Math.hypot(m.x - L.x, m.y - L.y, m.z - L.z);
      if (d < bd && d < 45) { bd = d; best = m; }
    }
    return best;
  }

  const S = {
    // can sub-kind sk be filmed on leader L right now?
    valid(sk, L, group) {
      if (!ok(L)) return sk === 'fall' || sk === 'high';
      const air = airborne(L);
      if (sk === 'deck') return L.state === 'takeoff' && L.carrier && L.carrier.alive;
      if (sk === 'wing') return air && !!wingOf({ subj: L, group });
      if (sk === 'ots') return air && !!tgtOf(L) && L.ordnance;
      if (sk === 'water') return air && L.kind === 'torpedo' && L.y < 22 && (L.phase === 'run' || L.sk === 'anvil');
      if (sk === 'side' || sk === 'chase') return air || L.state === 'landing';
      return true;
    },
    goal(shot, gP, gL, rdt) {
      if (!shot || shot.kind !== 'story') return false;
      const L = shot.subj;
      if (!L || L.removed) { const c = WW.cam.current(); gP.copy(c.P); gL.copy(c.L); shot.t = shot.dur; return true; }
      const ly = L.y || 0;
      shot.aim = shot.aim || V();
      switch (shot.sk) {
        case 'wing': {
          const w = (shot.wingP && airborne(shot.wingP)) ? shot.wingP : (shot.wingP = wingOf(shot));
          if (!w) { shot.sk = 'chase'; return S.goal(shot, gP, gL, rdt); }
          const h = smoothH(shot, L.heading, rdt, 1.4);
          _f.set(Math.cos(h), 0, Math.sin(h)); _r.set(-_f.z, 0, _f.x);
          // the wingman's side of the leader: the camera sits outboard of it, a little behind and above
          if (shot.wSide === undefined) shot.wSide = ((w.x - L.x) * _r.x + (w.z - L.z) * _r.z) >= 0 ? 1 : -1;
          gP.set(w.x - _f.x * 9 + _r.x * shot.wSide * 7, w.y + 3.2, w.z - _f.z * 9 + _r.z * shot.wSide * 7);
          gL.set(L.x + _f.x * 6, ly, L.z + _f.z * 6);
          shot.aim.set((L.x + w.x) / 2, (ly + w.y) / 2, (L.z + w.z) / 2);
          break;
        }
        case 'ots': {
          const T = tgtOf(L);
          if (T) shot.tP = (shot.tP || V()).set(T.x, 2, T.z);
          const tp = shot.tP || _t.set(L.x + Math.cos(L.heading) * 100, 0, L.z + Math.sin(L.heading) * 100);
          _t.set(tp.x - L.x, 0, tp.z - L.z);
          const want = Math.atan2(_t.z, _t.x), h = smoothH(shot, want, rdt, 1.0);
          _f.set(Math.cos(h), 0, Math.sin(h)); _r.set(-_f.z, 0, _f.x);
          gP.set(L.x - _f.x * 15 + _r.x * shot.side * 4, ly + 5.5, L.z - _f.z * 15 + _r.z * shot.side * 4);
          const d = Math.min(_t.length(), 160);
          gL.set(L.x + _f.x * d, Math.max(1.5, ly * (1 - d / 160)), L.z + _f.z * d);
          shot.aim.set(L.x, ly, L.z);
          break;
        }
        case 'side': {
          const C = centre(shot, rdt), h = smoothH(shot, L.heading, rdt, 0.6);
          _f.set(Math.cos(h), 0, Math.sin(h)); _r.set(-_f.z, 0, _f.x);
          const R = shot.R || (shot.R = 46 + 10 * Math.random());
          gP.set(C.x + _r.x * shot.side * R + _f.x * 8, C.y + 3, C.z + _r.z * shot.side * R + _f.z * 8);
          gL.set(C.x + _f.x * 4, C.y, C.z + _f.z * 4);
          shot.aim.copy(C);
          break;
        }
        case 'water': { // a fixed spot low over the sea ahead of the run; the bombers pass across the frame
          if (!shot.A) {
            const h = L.heading; _f.set(Math.cos(h), 0, Math.sin(h)); _r.set(-_f.z, 0, _f.x);
            const dd = (x, z) => (x < 0 || z < 0 || x > WW.cfg.MAP_W || z > WW.cfg.MAP_H) ? 15 : WW.terrain.depthAt(x, z);
            let s = shot.side; const ax = s2 => L.x + _f.x * 70 + _r.x * s2 * 18, az = s2 => L.z + _f.z * 70 + _r.z * s2 * 18;
            if (dd(ax(s), az(s)) < 3) s = -s;
            shot.A = V().set(ax(s), 5, az(s));
          }
          gP.copy(shot.A);
          gL.set(L.x, ly, L.z);
          shot.aim.set(L.x, ly, L.z);
          // once the bombers are well past, the shot is over
          const past = (L.x - shot.A.x) * Math.cos(L.heading) + (L.z - shot.A.z) * Math.sin(L.heading);
          if (past > 35) shot.dur = Math.min(shot.dur, shot.t + 0.5);
          break;
        }
        case 'high': {
          const C = centre(shot, rdt);
          if (!shot.T) { // the enemy fleet (or the target), fixed for the shot
            const T = ok(L) && tgtOf(L), e = T || enemyCentre(shot.nation || L.nation) || { x: C.x + 100, z: C.z };
            shot.T = V().set(e.x, 0, e.z);
          }
          _t.set(shot.T.x - C.x, 0, shot.T.z - C.z);
          const dist = Math.max(1, _t.length()); _t.multiplyScalar(1 / dist);
          if (shot.u === undefined) shot.u = _t.clone(); else shot.u.lerp(_t, 1 - Math.exp(-rdt * 0.5)).normalize();
          const u = shot.u, far = Math.min(dist, 260);
          // well behind and above the strike, looking down the line of its run: strike in front, the enemy beyond, horizon on top
          gP.set(C.x - u.x * 130 - u.z * shot.side * 45, Math.max(C.y, 20) + 38, C.z - u.z * 130 + u.x * shot.side * 45);
          gL.set(C.x + u.x * far * 0.6, 0, C.z + u.z * far * 0.6);
          shot.aim.set(C.x + u.x * far * 0.35, C.y * 0.5, C.z + u.z * far * 0.35);
          break;
        }
        case 'deck': {
          const cv = L.carrier && !L.carrier.removed ? L.carrier : null;
          if (!cv) { shot.sk = 'side'; return S.goal(shot, gP, gL, rdt); }
          const h = cv.heading; _f.set(Math.cos(h), 0, Math.sin(h)); _r.set(-_f.z, 0, _f.x);
          gP.set(cv.x + _f.x * 4 + _r.x * shot.side * 42, 12, cv.z + _f.z * 4 + _r.z * shot.side * 42);
          gL.set(L.x, ly, L.z);
          shot.aim.set(L.x, ly, L.z);
          if (L.state !== 'takeoff' && ly > 25) shot.dur = Math.min(shot.dur, shot.t + 1.5);
          break;
        }
        case 'fall': { // hold the camera still and watch the plane go down
          if (!shot.fP) shot.fP = WW.cam.current().P.clone();
          gP.copy(shot.fP);
          gL.set(L.x, Math.max(0.5, ly), L.z);
          shot.aim.copy(gL);
          shot.kP = 1.5; shot.kL = 4;
          break;
        }
        default: { // chase: behind, above and a little to the side of the leader
          const h = smoothH(shot, L.heading, rdt, 1.3);
          _f.set(Math.cos(h), 0, Math.sin(h)); _r.set(-_f.z, 0, _f.x);
          const back = shot.back || 22;
          gP.set(L.x - _f.x * back + _r.x * shot.side * 6, ly + 6.5, L.z - _f.z * back + _r.z * shot.side * 6);
          gL.set(L.x + _f.x * 18, Math.max(1, ly - 2), L.z + _f.z * 18);
          shot.aim.set(L.x, ly, L.z);
        }
      }
      return true;
    }
  };
  WW.storyShots = S;
})(window.WW);
