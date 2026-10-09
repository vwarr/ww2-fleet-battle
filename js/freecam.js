// freecam.js (integrator): the camera the user drives. It takes over from the director while the user plays with it.
// Left-drag orbits, the wheel (or a trackpad pinch) zooms, right-drag / WASD / arrows pan (panning lets go of a
// followed subject), Q/E rotate, R/V raise / lower the angle.
// Following: a click on a ship follows it; a click on a plane starts a story on it (camera_story.js). Touching the
// camera while the director films a ship or plane (a story shot, a chase, an orbit) keeps that subject and lets the
// user move RELATIVE to it. While following, the orbit, zoom and angle are an offset in the subject's frame:
// heading-relative by default (the camera stays e.g. off its left quarter as it turns), or world-fixed (key O,
// toggleRel()). Its heading and position are smoothed (a calm chase cam).
// Hand-back: after IDLE s without input (FOLLOW_IDLE when the subject came from the director, CLICK_IDLE after a
// click), or Esc / F (ui.js), the director takes over again with its usual cross-fade. Only in battle / victory.
window.WW = window.WW || {};
(function (WW) {
  const IDLE = 20, FOLLOW_IDLE = 10, CLICK_IDLE = 25, MIN_D = 22, MAX_D = 900, MIN_P = 0.12, MAX_P = 1.25, MARGIN = 120;
  const W = () => WW.cfg.MAP_W, H = () => WW.cfg.MAP_H;
  let lastInput = -1e9, on = false, follow = null, drag = null, idle = IDLE, takeT = -1e9, rel = true, hS = 0, fT = 0;
  const T = new THREE.Vector3(), goalT = new THREE.Vector3();
  let yaw = 0, pitch = 0.3, dist = 120, gYaw = 0, gPitch = 0.3, gDist = 120;
  const keys = {};
  const now = () => performance.now() / 1000;
  const live = () => { const s = WW.game && WW.game.state; return (s === 'battle' || s === 'victory') && !(WW.cam && WW.cam.mode === 'map') && !WW.game.infinite; }; // infinite: the director only
  const isPlane = o => !!(o && o.pt && o.kind);
  const followable = o => !!(o && !o.removed && !o.diorama && (isPlane(o) || o.stats) && o.heading !== undefined);
  // the yaw that puts the camera astern of heading h (freecam's offset is (sin yaw, cos yaw) on x / z)
  const base = h => Math.atan2(-Math.cos(h), -Math.sin(h));
  const worldYaw = y => (follow && rel ? y + base(hS) : y);
  const minD = () => (!follow ? MIN_D : isPlane(follow) ? 12 : follow.stats.length * 0.7 + 10);
  const minP = () => (follow && isPlane(follow) && follow.y > 15 ? -0.3 : MIN_P);

  // start from wherever the director's camera is, so the hand-over has no jump; keep the director's subject
  function takeOver() {
    lastInput = now();
    if (on) return;
    on = true; takeT = now(); idle = IDLE; follow = null;
    const c = WW.cam.current(), d = c.P.clone().sub(c.L);
    T.copy(c.L); T.y = 0; goalT.copy(T);
    dist = gDist = WW.clamp(d.length(), MIN_D, MAX_D);
    yaw = gYaw = Math.atan2(d.x, d.z);
    pitch = gPitch = WW.clamp(Math.asin(WW.clamp(d.y / Math.max(1e-3, d.length()), -1, 1)), MIN_P, MAX_P);
    const shot = WW.cam._shot && WW.cam._shot();
    const s = shot && (shot.subj && followable(shot.subj) ? shot.subj : null);
    if (s) setFollow(s, 'inherit');
  }
  // follow o from where the camera is now: the offset is measured from the subject, so the camera does not move
  function setFollow(o, how) {
    if (!followable(o)) return false;
    if (!on) { on = true; takeT = now(); }
    lastInput = now();
    follow = o; fT = 0; hS = o.heading || 0;
    idle = how === 'click' ? CLICK_IDLE : how === 'inherit' ? FOLLOW_IDLE : IDLE;
    const P = WW.cam.current().P, oy = isPlane(o) ? o.y : 1.5;
    const d = new THREE.Vector3(P.x - o.x, P.y - oy, P.z - o.z), len = Math.max(1e-3, d.length());
    T.set(o.x, oy, o.z); goalT.copy(T);
    dist = WW.clamp(len, minD(), MAX_D);
    gDist = WW.clamp(len, minD(), isPlane(o) ? 48 : o.stats.length * 2.5 + 40); // glide in to a chase-cam distance
    const wy = Math.atan2(d.x, d.z);
    yaw = gYaw = rel ? wy - base(hS) : wy;
    pitch = gPitch = WW.clamp(Math.asin(WW.clamp(d.y / len, -1, 1)), minP(), MAX_P);
    return true;
  }
  function stop() { on = false; follow = null; drag = null; for (const k in keys) keys[k] = false; }
  function unfollow() { // keep the camera where it is, world-fixed, without a subject
    if (!follow) return;
    yaw = worldYaw(yaw); gYaw = worldYaw(gYaw); follow = null; T.y = 0; goalT.copy(T); idle = IDLE;
  }

  function clampT(v) { v.x = WW.clamp(v.x, -MARGIN, W() + MARGIN); v.z = WW.clamp(v.z, -MARGIN, H() + MARGIN); }
  function pan(dx, dz) { // dx: screen right, dz: screen forward (away from the camera), in world units
    unfollow();
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // ground direction the camera faces
    const rx = -fz, rz = fx;                           // its right-hand side
    goalT.x += rx * dx + fx * dz; goalT.z += rz * dx + fz * dz;
    clampT(goalT);
  }

  // pick the nearest ship or plane to the click on screen
  const v = new THREE.Vector3();
  function pick(px, py) {
    let best = null, bd = 1e9;
    const consider = (o, y, r) => {
      v.set(o.x, y, o.z).project(WW.camera);
      if (v.z > 1) return;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight, d = Math.hypot(sx - px, sy - py);
      if (d < r && d < bd) { bd = d; best = o; }
    };
    for (const s of WW.world.ships) if (s.alive && !s.submerged) consider(s, 2, 34 + s.stats.length);
    for (const p of WW.world.planes) if (p.alive) consider(p, p.y, 30);
    return best;
  }

  function onDown(e) {
    if (!live()) return;
    drag = { b: e.button, x: e.clientX, y: e.clientY, moved: 0 };
    takeOver();
  }
  function onMove(e) {
    if (!drag || !live()) return;
    if (e.buttons === 0) { drag = null; return; } // the mouseup was missed (released outside the window)
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    lastInput = now();
    if (drag.b === 0) { gYaw -= dx * 0.005; gPitch = WW.clamp(gPitch + dy * 0.004, minP(), MAX_P); }
    else if (drag.b === 2) { const k = gDist * 0.0022; pan(-dx * k, dy * k); }
  }
  function onUp(e) {
    if (!drag) return;
    const click = drag.moved < 5 && drag.b === 0;
    drag = null;
    if (!click || !live()) return;
    const o = pick(e.clientX, e.clientY);
    if (isPlane(o) && WW.camStory && WW.camStory.follow(o)) { stop(); return; } // a plane: story mode follows its element
    if (o) setFollow(o, 'click'); else unfollow(); // a click on empty water stops following
  }
  function onWheel(e) {
    if (!live()) return;
    e.preventDefault(); takeOver();
    gDist = WW.clamp(gDist * Math.exp(e.deltaY * (e.ctrlKey ? 0.006 : 0.0012)), minD(), MAX_D); // ctrlKey: trackpad pinch
  }
  const KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'v', 'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  function onKey(e, down) {
    const k = e.key.toLowerCase();
    if (down && k === 'escape') { if (follow) unfollow(); else if (on) stop(); return; }
    if (KEYS.indexOf(k) < 0) return;
    if (down && !live()) return;
    keys[k] = down;
    if (down) { e.preventDefault(); takeOver(); }
  }

  WW.freecam = {
    init() {
      const c = document.getElementById('game');
      c.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      c.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('keydown', e => onKey(e, true));
      window.addEventListener('keyup', e => onKey(e, false));
      const release = () => { for (const k in keys) keys[k] = false; drag = null; };
      window.addEventListener('blur', release);
      document.addEventListener('visibilitychange', release);
      WW.on('roundStart', stop); WW.on('setupStart', stop);
    },
    active() {
      if (!on) return false;
      if (!live() || (now() - lastInput > idle && !drag)) { stop(); return false; }
      return true;
    },
    following() { return on ? follow : null; },
    // follow o relative to it now (Tab / story hand-offs); how: 'click' | 'inherit' | 'user'
    follow(o, how) { return setFollow(o, how || 'user'); },
    // hand over to a new subject in place (a story's next leader), keeping the user's offset
    retarget(o) { if (!followable(o) || !follow) return false; const y = worldYaw(gYaw), y0 = worldYaw(yaw); follow = o; hS = o.heading || 0; if (rel) { gYaw = y - base(hS); yaw = y0 - base(hS); } return true; },
    release() { stop(); }, // hand the camera back to the director now (key F, Esc)
    // key O: heading-relative <-> world-fixed offsets, without a jump
    toggleRel() {
      const wy = worldYaw(yaw), wg = worldYaw(gYaw);
      rel = !rel;
      if (follow) { yaw = rel ? wy - base(hS) : wy; gYaw = rel ? wg - base(hS) : wg; }
      return rel ? 'heading-relative' : 'world-fixed';
    },
    rel: () => rel,
    soft() { return on && now() - takeT < 1.2 ? 0.35 : 1; }, // eased rates right after the take-over (camera.js)
    _dbg() { return { on, idle: now() - lastInput, limit: idle, keys: Object.keys(keys).filter(k => keys[k]), follow: !!follow, drag: !!drag, rel, yaw, gYaw, pitch, dist, gDist }; },
    // test hook: user input without a mouse (orbit by dYaw rad, tilt by dPitch rad, zoom by factor)
    _input(dYaw, dPitch, zoom) { takeOver(); gYaw += dYaw || 0; gPitch = WW.clamp(gPitch + (dPitch || 0), minP(), MAX_P); gDist = WW.clamp(gDist * (zoom || 1), minD(), MAX_D); },
    // fills the camera goal position / look point; called by camera.js each frame while active
    goal(gP, gL, rdt) {
      const dt = Math.min(0.1, rdt || 0), sp = gDist * 0.9 * dt;
      if (keys.w || keys.arrowup) pan(0, sp);
      if (keys.s || keys.arrowdown) pan(0, -sp);
      if (keys.a || keys.arrowleft) pan(-sp, 0);
      if (keys.d || keys.arrowright) pan(sp, 0);
      if (keys.q) gYaw += 0.8 * dt;
      if (keys.e) gYaw -= 0.8 * dt;
      if (keys.r || keys.pageup) gPitch = WW.clamp(gPitch + 0.7 * dt, minP(), MAX_P);   // camera up (steeper look-down)
      if (keys.v || keys.pagedown) gPitch = WW.clamp(gPitch - 0.7 * dt, minP(), MAX_P); // camera down (toward the sea)
      // (held keys do not refresh the idle timer here: real key presses send keydown events, so a key
      // whose keyup was lost cannot keep the free camera alive forever)
      if (follow && (follow.removed || (follow.stats && !follow.alive && !follow.sinking))) unfollow(); // a falling plane is followed down
      const k = 1 - Math.exp(-dt * 6); // damped, eased motion toward the goals
      if (follow) {
        fT += dt;
        hS += WW.angleDiff(hS, follow.heading || 0) * (1 - Math.exp(-dt * 1.5)); // calm: the camera swings round slowly
        goalT.set(follow.x, isPlane(follow) ? follow.y : 1.5, follow.z);
        T.lerp(goalT, 1 - Math.exp(-dt * (3 + 9 * Math.min(1, fT / 1.5)))); // tight once settled: no lag behind a fast plane
      } else T.lerp(goalT, k);
      yaw += (gYaw - yaw) * k; pitch += (gPitch - pitch) * k; dist += (gDist - dist) * k;
      const ly = follow ? T.y : 1.5, wy = worldYaw(yaw);
      gL.set(T.x, ly, T.z);
      gP.set(T.x + Math.sin(wy) * Math.cos(pitch) * dist, ly + Math.sin(pitch) * dist, T.z + Math.cos(wy) * Math.cos(pitch) * dist);
    }
  };
})(window.WW);
