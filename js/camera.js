// camera.js (integrator): screensaver camera. 'track' mode drifts toward the action and frames it
// closely; 'map' mode shows the whole map (always used in setup so the user can click ships in).
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const VFOV = 32, PITCH = 47 * Math.PI / 180;
  const MIN_W = 175;        // narrowest view width (units) when tracking
  const R_SCORE = 90, R_FRAME = 105, PAD = 22;
  const HOLD = 9;           // seconds to keep an anchor before switching
  let camera = null, realT = 0, mapDist = 500, mapTz = H / 2;
  const cur = { x: W / 2, z: H / 2, d: 500 }, goal = { x: W / 2, z: H / 2, d: 500 };
  let anchor = null, anchorScore = 0, anchorT = 0, scanT = 0, forced = null;
  const target = new THREE.Vector3(), _c = new THREE.Vector3();

  function place(d, yaw, pitch, tx, tz) {
    camera.position.set(tx + Math.sin(yaw) * d * Math.cos(pitch), d * Math.sin(pitch), tz + Math.cos(yaw) * d * Math.cos(pitch));
    target.set(tx, 0, tz);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  // ---- full-map fit (binary searches, as before) ----
  const CORNERS = [[-4, -4], [W + 4, -4], [-4, H + 4], [W + 4, H + 4]];
  function ndcRange(d, tz) {
    place(d, 0, PITCH, W / 2, tz);
    let mx = 0, y0 = 9, y1 = -9;
    for (const [x, z] of CORNERS) {
      _c.set(x, 0, z).project(camera);
      mx = Math.max(mx, Math.abs(_c.x)); y0 = Math.min(y0, _c.y); y1 = Math.max(y1, _c.y);
    }
    return { mx, y0, y1 };
  }
  function centreTz(d) {
    let lo = H / 2 - 150, hi = H / 2 + 150;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, r = ndcRange(d, m); if (r.y0 + r.y1 > 0) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }
  function fitMap() {
    let lo = 100, hi = 3000;
    for (let it = 0; it < 22; it++) {
      const d = (lo + hi) / 2, r = ndcRange(d, centreTz(d));
      if (r.mx <= 0.95 && r.y1 <= 0.93 && r.y0 >= -0.95) hi = d; else lo = d;
    }
    mapTz = centreTz(hi); mapDist = hi;
  }
  // distance that shows a ground box of size wx * wz
  function distFor(wx, wz) {
    const tv = Math.tan(VFOV * Math.PI / 360), th = tv * camera.aspect;
    return Math.max(wx / (2 * th), wz * Math.sin(PITCH) / (2 * tv) * 1.1);
  }

  // ---- points of interest ----
  const pois = [];
  function gather() {
    pois.length = 0;
    for (const s of WW.world.ships) {
      if (s.removed || s.wreck) continue;
      if (s.sinking) { if (s.sinkT < 9) pois.push({ x: s.x, z: s.z, w: 6, n: null }); continue; }
      pois.push({ x: s.x, z: s.z, w: s.hp < s.maxHp ? 1.4 : 1, n: s.nation });
    }
    for (const p of WW.world.planes) {
      if (p.removed || p.state === 'rollout' || p.state === 'takeoff') continue;
      pois.push({ x: p.x, z: p.z, w: p.state === 'attack' ? 3.5 : p.alive ? 1.2 : 2, n: null });
    }
  }
  function scoreAt(x, z) {
    let s = 0, u = 0, j = 0;
    for (const q of pois) {
      if (WW.dist2(x, z, q.x, q.z) > R_SCORE * R_SCORE) continue;
      s += q.w; if (q.n === 'USN') u++; else if (q.n === 'IJN') j++;
    }
    return s + 4 * Math.sqrt(Math.min(u, j)); // contact between the fleets is the best show
  }
  function pickAnchor(dt) {
    gather();
    if (!pois.length) { anchor = null; return; }
    let best = null, bs = -1;
    for (const q of pois) { const s = scoreAt(q.x, q.z); if (s > bs) { bs = s; best = q; } }
    anchorT += dt;
    if (anchor) anchorScore = scoreAt(anchor.x, anchor.z);
    if (!anchor || (anchorT > HOLD && bs > anchorScore * 1.25) || bs > anchorScore * 2.2 || anchorScore < 1) {
      anchor = { x: best.x, z: best.z }; anchorScore = bs; anchorT = 0;
    } else { // follow the action as it moves: drift the anchor to the local centre of mass
      let sx = 0, sz = 0, sw = 0;
      for (const q of pois) if (WW.dist2(anchor.x, anchor.z, q.x, q.z) < 60 * 60) { sx += q.x * q.w; sz += q.z * q.w; sw += q.w; }
      if (sw) { anchor.x = WW.lerp(anchor.x, sx / sw, 0.3); anchor.z = WW.lerp(anchor.z, sz / sw, 0.3); }
    }
  }
  function frameGoal() {
    if (!anchor) { goal.x = W / 2; goal.z = mapTz; goal.d = mapDist; return; }
    let x0 = anchor.x, x1 = anchor.x, z0 = anchor.z, z1 = anchor.z;
    for (const q of pois) {
      if (WW.dist2(anchor.x, anchor.z, q.x, q.z) > R_FRAME * R_FRAME) continue;
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
    }
    const wx = Math.max(MIN_W, x1 - x0 + PAD * 2), wz = Math.max(MIN_W * 0.5, z1 - z0 + PAD * 2);
    goal.d = Math.min(mapDist, distFor(wx, wz));
    goal.x = (x0 + x1) / 2; goal.z = (z0 + z1) / 2 + 4; // ships sit slightly above centre (HP bars, smoke)
  }

  const cam = {
    mode: 'track',
    init() {
      camera = WW.camera; cam.resize(); cur.x = W / 2; cur.z = mapTz; cur.d = mapDist;
      // new round: cut to the whole new map, then glide in toward the action
      WW.on('roundStart', () => { forced = null; anchor = null; scanT = 0; cur.x = W / 2; cur.z = mapTz; cur.d = mapDist; });
      WW.on('setupStart', () => { forced = null; anchor = null; cur.x = W / 2; cur.z = mapTz; cur.d = mapDist; });
    },
    resize() { if (!camera) return; fitMap(); },
    toggle() { cam.mode = cam.mode === 'track' ? 'map' : 'track'; return cam.mode; },
    // test hook: frame (x, z) with the given width for `hold` seconds
    focus(x, z, width, hold) { forced = { x, z, w: width || MIN_W, t: hold || 6 }; cam.update(0, true); },
    snap() { forced = null; cam.update(0, true); },
    update(rdt, snap) {
      if (!camera) return;
      realT += rdt;
      const st = WW.game && WW.game.state;
      if (forced) {
        forced.t -= rdt;
        goal.x = forced.x; goal.z = forced.z; goal.d = Math.min(mapDist, distFor(forced.w, forced.w * 0.5));
        if (forced.t <= 0) forced = null;
      } else if (cam.mode === 'map' || st === 'setup' || !st) {
        goal.x = W / 2; goal.z = mapTz; goal.d = mapDist;
      } else {
        scanT -= rdt;
        if (scanT <= 0 || snap) { scanT = 0.5; pickAnchor(0.5); frameGoal(); }
      }
      const kp = snap ? 1 : 1 - Math.exp(-rdt * 0.55), kd = snap ? 1 : 1 - Math.exp(-rdt * 0.4);
      cur.x += (goal.x - cur.x) * kp; cur.z += (goal.z - cur.z) * kp; cur.d += (goal.d - cur.d) * kd;
      const still = st === 'setup'; // no sway while the user places ships
      const yaw = still ? 0 : Math.sin(realT * 0.031) * 0.05;
      const pitch = PITCH + (still ? 0 : Math.sin(realT * 0.023) * 0.02);
      const d = cur.d * (still ? 1 : 1 + Math.sin(realT * 0.019) * 0.02);
      place(d, yaw, pitch, cur.x, cur.z);
    },
    // pixels per world unit at the view centre (for HP bar sizing)
    pxPerUnit() {
      const h = window.innerHeight, tv = Math.tan(VFOV * Math.PI / 360);
      return h / (2 * tv * cur.d);
    }
  };
  WW.cam = cam;
})(window.WW);
