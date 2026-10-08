// freecam.js (integrator): a free camera that takes over from the director while the user plays with it.
// Left-drag orbits, the wheel zooms, right-drag / WASD / arrows pan, Q/E rotate, R/V raise / lower, a click on a ship
// follows it (a click on a plane starts a story on it: camera_story.js) (Esc or a click on empty water stops). After IDLE seconds without input the director
// takes over again (with its usual cross-fade). Only in battle / victory; setup keeps its own clicks.
window.WW = window.WW || {};
(function (WW) {
  const IDLE = 20, MIN_D = 22, MAX_D = 900, MIN_P = 0.12, MAX_P = 1.25, MARGIN = 120;
  const W = () => WW.cfg.MAP_W, H = () => WW.cfg.MAP_H;
  let lastInput = -1e9, on = false, follow = null, drag = null;
  const T = new THREE.Vector3(), goalT = new THREE.Vector3();
  let yaw = 0, pitch = 0.3, dist = 120, gYaw = 0, gPitch = 0.3, gDist = 120;
  const keys = {};
  const now = () => performance.now() / 1000;
  const live = () => { const s = WW.game && WW.game.state; return (s === 'battle' || s === 'victory') && !(WW.cam && WW.cam.mode === 'map'); };

  // start from wherever the director's camera is, so the hand-over has no jump
  function takeOver() {
    lastInput = now();
    if (on) return;
    on = true;
    const c = WW.cam.current(), d = c.P.clone().sub(c.L);
    T.copy(c.L); T.y = 0; goalT.copy(T);
    dist = gDist = WW.clamp(d.length(), MIN_D, MAX_D);
    yaw = gYaw = Math.atan2(d.x, d.z);
    pitch = gPitch = WW.clamp(Math.asin(WW.clamp(d.y / Math.max(1e-3, d.length()), -1, 1)), MIN_P, MAX_P);
  }
  function stop() { on = false; follow = null; drag = null; for (const k in keys) keys[k] = false; }

  function clampT(v) { v.x = WW.clamp(v.x, -MARGIN, W() + MARGIN); v.z = WW.clamp(v.z, -MARGIN, H() + MARGIN); }
  function pan(dx, dz) { // dx: screen right, dz: screen forward (away from the camera), in world units
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // ground direction the camera faces
    const rx = -fz, rz = fx;                           // its right-hand side
    goalT.x += rx * dx + fx * dz; goalT.z += rz * dx + fz * dz;
    clampT(goalT); follow = null;
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
    if (drag.b === 0) { gYaw -= dx * 0.005; gPitch = WW.clamp(gPitch + dy * 0.004, MIN_P, MAX_P); }
    else if (drag.b === 2) { const k = gDist * 0.0022; pan(-dx * k, dy * k); }
  }
  function onUp(e) {
    if (!drag) return;
    const click = drag.moved < 5 && drag.b === 0;
    drag = null;
    if (!click || !live()) return;
    const o = pick(e.clientX, e.clientY);
    if (o && o.pt && o.kind && WW.camStory && WW.camStory.follow(o)) { stop(); return; } // a plane: story mode follows its element
    follow = o; // a click on empty water stops following
  }
  function onWheel(e) {
    if (!live()) return;
    e.preventDefault(); takeOver();
    gDist = WW.clamp(gDist * Math.exp(e.deltaY * 0.0012), MIN_D, MAX_D);
  }
  const KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'v', 'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  function onKey(e, down) {
    const k = e.key.toLowerCase();
    if (down && k === 'escape') { follow = null; return; }
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
      if (!live() || now() - lastInput > IDLE) { stop(); return false; }
      return true;
    },
    following() { return follow; },
    release() { stop(); }, // hand the camera back to the director now (story mode, key F)
    _dbg() { return { on, idle: now() - lastInput, keys: Object.keys(keys).filter(k => keys[k]), follow: !!follow, drag: !!drag }; },
    // fills the camera goal position / look point; called by camera.js each frame while active
    goal(gP, gL, rdt) {
      const dt = Math.min(0.1, rdt || 0), sp = gDist * 0.9 * dt;
      if (keys.w || keys.arrowup) pan(0, sp);
      if (keys.s || keys.arrowdown) pan(0, -sp);
      if (keys.a || keys.arrowleft) pan(-sp, 0);
      if (keys.d || keys.arrowright) pan(sp, 0);
      if (keys.q) gYaw += 0.8 * dt;
      if (keys.e) gYaw -= 0.8 * dt;
      if (keys.r || keys.pageup) gPitch = WW.clamp(gPitch + 0.7 * dt, MIN_P, MAX_P);   // camera up (steeper look-down)
      if (keys.v || keys.pagedown) gPitch = WW.clamp(gPitch - 0.7 * dt, MIN_P, MAX_P); // camera down (toward the sea)
      // (held keys do not refresh the idle timer here: real key presses send keydown events, so a key
      // whose keyup was lost cannot keep the free camera alive forever)
      if (follow) {
        if (follow.removed || (!follow.alive && !follow.sinking)) follow = null;
        else { goalT.set(follow.x, 0, follow.z); }
      }
      const k = 1 - Math.exp(-dt * 6); // damped, eased motion toward the goals
      T.lerp(goalT, follow ? 1 - Math.exp(-dt * 4) : k);
      yaw += (gYaw - yaw) * k; pitch += (gPitch - pitch) * k; dist += (gDist - dist) * k;
      const ly = follow && follow.y !== undefined && follow.y > 1 ? follow.y * 0.8 : 1.5;
      gL.set(T.x, ly, T.z);
      gP.set(T.x + Math.sin(yaw) * Math.cos(pitch) * dist, ly + Math.sin(pitch) * dist, T.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    }
  };
})(window.WW);
