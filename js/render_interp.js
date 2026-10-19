// render_interp.js (visual only): WW.renderInterp, render-side interpolation of the fixed live sim step (main.js).
// The live game steps the sim in fixed LIVE_STEP steps; a frame takes as many whole steps as its sim time holds and
// carries the rest (acc). Wherever frames and steps do not line up one to one (the director's slow motion: 0 / 1 steps
// a frame; a 120 Hz display whose frame overruns a vsync: 1 / 2; 144 Hz: 0 / 1; 2x and 4x with an uneven frame clock)
// a moving object jumped a whole step on some frames and stood still on others, while the camera eased on frame time:
// the followed plane or ship shook on screen (docs/camera_review.md "Flying-boat jitter"). So each live step keeps
// the pose before it (capture), and the frame draws every moving thing at the pose between the last two steps where the
// frame's time actually lies (pose(alpha), alpha = the carried fraction of a step), then puts the sim's own values back
// before anything else runs (unpose). Interpolated for the frame:
//   - the ships' hull groups (and a broken ship's stern half), the planes' groups, the projectiles' meshes: position
//     and rotation (Euler and quaternion restored bit for bit afterwards);
//   - visuals on the sim clock: lag() (the flak puffs' uTime, combat_aa.js);
//   - the sim objects' own x / y / z / heading, so the camera, the crew, the audio listener and every other per-frame
//     visual reads the same in-between pose as the meshes it films (restored right after the render, and at the
//     start of the next frame, only if nothing else wrote them meanwhile: setup-mode dragging, a new round).
// Nothing here runs in the sim: capture() is a no-op on sim-only pages (the tests, the look-ahead worker), and the sim
// only ever sees its own values, so determinism and the look-ahead trace are untouched. ?nointerp: off (A/B).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const OFF = typeof location !== 'undefined' && /[?&]nointerp\b/.test(location.search);
  const JUMP2 = 36, TURN = 0.8;       // a move of over 6 u or a turn of over 0.8 rad in one step is a jump (a spawn, a re-parent, a pooled mesh reused): drawn as is
  const snapO = new WeakMap(), snapG = new WeakMap();
  const posedO = [], posedG = [];
  let nO = 0, nG = 0, lagS = 0;   // lagS: sim s the frame's pose lies behind the sim's own (lag())
  const live = () => !OFF && !WW.simOnly;

  function forEach(fn) {
    const S = WW.world.ships, P = WW.world.planes;
    for (let i = 0; i < S.length; i++) { const s = S[i]; fn(s, s.group, s._bk && s._bk.stern); }
    for (let i = 0; i < P.length; i++) { const p = P[i]; fn(p, p.group, null); }
    const A = WW.combat && WW.combat._i && WW.combat._i.active;
    if (A) for (let i = 0; i < A.length; i++) { const p = A[i]; if (!p.dead) fn(p, p.mesh, null); }
  }
  const num = v => typeof v === 'number' && v === v;

  // before each live step n (main.js stepLive): the pose the step starts from
  function snapObj(o, n) {
    let r = snapO.get(o);
    if (!r) { r = { n: -1, x: 0, y: 0, z: 0, h: 0, hy: false, hh: false }; snapO.set(o, r); }
    if (!num(o.x) || !num(o.z)) { r.n = -1; return; }
    r.n = n; r.x = o.x; r.z = o.z; r.hy = num(o.y); r.y = r.hy ? o.y : 0; r.hh = num(o.heading); r.h = r.hh ? o.heading : 0;
  }
  function snapGrp(g, n) {
    let r = snapG.get(g);
    if (!r) { r = { n: -1, par: null, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }; snapG.set(g, r); }
    const p = g.position, e = g.rotation;
    r.n = n; r.par = g.parent; r.px = p.x; r.py = p.y; r.pz = p.z; r.rx = e._x; r.ry = e._y; r.rz = e._z;
  }
  function capture(n) {
    if (!live()) return;
    forEach((o, g1, g2) => { snapObj(o, n); if (g1) snapGrp(g1, n); if (g2) snapGrp(g2, n); });
  }

  const lerpA = (a, b, t) => a + WW.angleDiff(a, b) * t;
  function slot(list, k) { let e = list[k]; if (!e) e = list[k] = {}; return e; }
  // after the frame's steps: alpha in [0, 1], 0 = the pose before the last step, 1 = the sim's current pose
  function pose(alpha, n) {
    unpose();
    lagS = 0;
    if (!live() || !(alpha < 1)) return;
    const t = Math.max(0, alpha), prevN = n - 1;
    lagS = (1 - t) * ((window.__sim && window.__sim.LIVE_STEP) || 1 / 120);
    forEach((o, g1, g2) => {
      const r = snapO.get(o);
      if (r && r.n === prevN && num(o.x) && num(o.z)) {
        const dx = o.x - r.x, dz = o.z - r.z, dy = r.hy && num(o.y) ? o.y - r.y : 0;
        if (dx * dx + dy * dy + dz * dz < JUMP2 && !(r.hh && num(o.heading) && Math.abs(WW.angleDiff(r.h, o.heading)) > TURN)) {
          const e = slot(posedO, nO++);
          e.o = o; e.cx = o.x; e.cz = o.z; e.cy = o.y; e.ch = o.heading;
          o.x = r.x + dx * t; o.z = r.z + dz * t;
          if (r.hy && num(o.y)) o.y = r.y + dy * t;
          if (r.hh && num(o.heading)) o.heading = lerpA(r.h, o.heading, t);
          e.sx = o.x; e.sz = o.z; e.sy = o.y; e.sh = o.heading;
        }
      }
      if (g1) poseGrp(g1, t, prevN);
      if (g2) poseGrp(g2, t, prevN);
    });
  }
  function poseGrp(g, t, prevN) {
    const r = snapG.get(g);
    if (!r || r.n !== prevN || r.par !== g.parent) return;
    const p = g.position, E = g.rotation, Q = g.quaternion;
    const dx = p.x - r.px, dy = p.y - r.py, dz = p.z - r.pz;
    if (dx * dx + dy * dy + dz * dz >= JUMP2) return;
    const ax = WW.angleDiff(r.rx, E._x), ay = WW.angleDiff(r.ry, E._y), az = WW.angleDiff(r.rz, E._z);
    if (Math.abs(ax) > TURN || Math.abs(ay) > TURN || Math.abs(az) > TURN) return;
    if (dx === 0 && dy === 0 && dz === 0 && ax === 0 && ay === 0 && az === 0) return;   // standing still: nothing to do
    const e = slot(posedG, nG++);
    e.g = g; e.px = p.x; e.py = p.y; e.pz = p.z; e.ex = E._x; e.ey = E._y; e.ez = E._z; e.qx = Q._x; e.qy = Q._y; e.qz = Q._z; e.qw = Q._w;
    p.set(r.px + dx * t, r.py + dy * t, r.pz + dz * t);
    E.set(r.rx + ax * t, r.ry + ay * t, r.rz + az * t);
    e.sx = p.x; e.sy = p.y; e.sz = p.z; e.sex = E._x; e.sey = E._y; e.sez = E._z;
  }
  // the sim objects' own values back (right after the render: input handlers between frames see the sim's state)
  function unposeSim() {
    for (let i = 0; i < nO; i++) {
      const e = posedO[i], o = e.o;
      if (o.x === e.sx && o.z === e.sz) { o.x = e.cx; o.z = e.cz; }
      if (o.y === e.sy) o.y = e.cy;
      if (o.heading === e.sh) o.heading = e.ch;
      e.o = null;
    }
    nO = 0;
  }
  // everything back: at the start of the next frame (after damage_visuals.js / ship_swell.js have taken their own
  // poses off), before any sim step; also before a test's fastForward / stepFixed (main.js)
  function unpose() {
    unposeSim();
    for (let i = 0; i < nG; i++) {
      const e = posedG[i], g = e.g, p = g.position, E = g.rotation, Q = g.quaternion;
      if (p.x === e.sx && p.y === e.sy && p.z === e.sz && E._x === e.sex && E._y === e.sey && E._z === e.sez) {   // untouched since: exactly what the sim left
        p.x = e.px; p.y = e.py; p.z = e.pz;
        E._x = e.ex; E._y = e.ey; E._z = e.ez;
        Q._x = e.qx; Q._y = e.qy; Q._z = e.qz; Q._w = e.qw;
      }
      e.g = null;
    }
    nG = 0;
  }
  // lag(): how far (sim s) this frame's drawn pose lies behind the sim clock (0 when not interpolating): a visual on the
  // sim clock (combat_aa.js's flak puffs, uTime) draws at WW.time.now - lag() so it moves with everything else
  WW.renderInterp = { capture, pose, unpose, unposeSim, off: OFF, lag: () => lagS, stats: () => ({ objs: nO, groups: nG }) };
})(window.WW);
