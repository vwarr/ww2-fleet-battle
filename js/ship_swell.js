// ship_swell.js - WW.shipSwell: everything afloat rides the sea (visual only). The Pacific's swell and wind sea
// (sea_state.js) and Normandy's Channel (waves.js) alike, through WW.sea. The sim keeps its ships on a flat sea
// (ships.js syncGroup: x, z, heading and a small bob); here, each frame after the sim, pose() lifts and tilts what
// floats, and unpose() before the next sim advance restores exactly what the sim set (only where nothing else has
// touched it since), like damage_visuals.js's pose: nothing the sim reads ever sees the sea.
//  - Ships: heave is the surface under the hull (bow, stern, both sides, midships: a long hull averages out the short
//    chop); pitch follows the surface's heights at bow and stern (a carrier pitches slowly to the swell, a destroyer is
//    thrown about); roll is a damped oscillator at the hull's own roll period driven by the wave slope across it (a
//    destroyer rolls deep when the swell meets her roll period; a carrier hardly at all). PT boats ride bow-up at speed
//    and slam: the bow is kicked up when it meets a rising sea, then falls. Sinking ships ride less as they settle;
//    submarines at periscope depth heave with the surface (the periscope stays out of the water) but do not pitch.
//  - The deck: parked planes and the deck crew are carrier-local (children / group.matrix), so they ride already.
//    A plane on the deck in world space (spotted for launch, its take-off run, the climb-out off the bow, the
//    groove and the trap, the roll-out) gets the carrier's own sea motion (posed matrix x unposed inverse) blended in
//    by how close it is to the deck: a landing plane meets the moving deck, never sinks into it or floats over it.
//  - Floating things: ditched planes, lifeboats and rafts heave and tilt on the surface. (Foam, wakes, oil, splashes
//    and the hull contact shadows ride on the GPU: sea_state.js ride().)
//  - Bow waves and bow spray scaled by speed, the most on destroyers and PT boats, a burst when the bow buries in a sea.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  // kp: pitch gain (1: the hull lies along the surface between bow and stern, the ends stay in the drawn sea); kr: roll gain on the wave slope; Tr: roll period (real s); zr: roll damping; tp: pitch lag (s);
  // spray: bow spray per unit speed; slam: bow kicks (PT boats)
  const TYPE = {
    carrier: { kp: 1.0, kr: 0.9, Tr: 14, zr: 0.18, tp: 0.6, spray: 0.25 },
    battleship: { kp: 1.0, kr: 1.0, Tr: 14, zr: 0.16, tp: 0.5, spray: 0.35 },
    cruiser: { kp: 1.0, kr: 1.4, Tr: 11, zr: 0.14, tp: 0.35, spray: 0.6 },
    destroyer: { kp: 1.0, kr: 2.4, Tr: 8, zr: 0.12, tp: 0.18, spray: 1.0 },
    submarine: { kp: 1.0, kr: 1.8, Tr: 7, zr: 0.15, tp: 0.25, spray: 0.5 },
    pt: { kp: 1.0, kr: 1.4, Tr: 3, zr: 0.25, tp: 0.06, spray: 1.3, slam: true }
  };
  const ROLL_MAX = 0.24, R = Math.random;
  const posed = new Map(), st = new WeakMap();
  const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _e = new THREE.Euler(),
    _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1), _Y = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(),
    _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _v = new THREE.Vector3(), _qi = new THREE.Quaternion();
  const deltas = new Map();   // carrier -> { D: Matrix4 (posed x unposed^-1), q: its rotation }
  let stats = { ships: 0, planes: 0, floaters: 0 };

  function save(g) { if (!posed.has(g)) posed.set(g, { x: g.position.x, y: g.position.y, z: g.position.z, rx: g.rotation.x, ry: g.rotation.y, rz: g.rotation.z }); }
  function seal(g) { const P = posed.get(g); P.x1 = g.position.x; P.y1 = g.position.y; P.z1 = g.position.z; P.rx1 = g.rotation.x; P.ry1 = g.rotation.y; P.rz1 = g.rotation.z; }

  function shipState(s) { let o = st.get(s); if (!o) { o = { roll: 0, rv: 0, pitch: 0, pv: 0, hb: null, sprayT: 0, foamT: 0 }; st.set(s, o); } return o; }

  function poseShip(s, dt, W) {
    const g = s.group, T = TYPE[s.type] || TYPE.cruiser, o = shipState(s);
    const h = s.heading, c = Math.cos(h), sn = Math.sin(h), L = (s.stats && s.stats.length) || 10, B = (s.stats && s.stats.beam) || L * 0.12;
    const a = L * 0.42, b = Math.max(0.5, B * 0.5);
    // the surface as drawn there (the mesh's own LOD), less the waves too short to move this hull (sea_state.js hull)
    const H = (x, z) => W.hull(x, z, L).h;
    const hb = H(s.x + c * a, s.z + sn * a), hs = H(s.x - c * a, s.z - sn * a);                 // bow, stern
    const hS = H(s.x - sn * b, s.z + c * b), hP = H(s.x + sn * b, s.z - c * b);                 // starboard, port
    const hc = H(s.x, s.z);
    // sinking: rides less and less as she settles; a submarine below: heave only
    let wt = 1, tilt = 1;
    if (s.sinking) { const k = Math.min(1, (s.sinkT || 0) / 6); wt = 1 - 0.7 * k; tilt = 0.5 * (1 - k); }
    if (s.type === 'submarine') tilt *= Math.max(0, Math.min(1, 1 - (s.depthY || 0) / -1.6));
    const heave = (hb + hs + hS + hP + 2 * hc) / 6 * wt;
    // pitch: to the surface along the hull (lagged by tp); PT boats: bow-up at speed and slamming
    const spdK = s.stats ? Math.max(0, Math.min(1, s.speed / s.stats.speed)) : 0;
    let target = Math.atan2(hb - hs, 2 * a) * T.kp;
    if (T.slam) target += 0.05 * spdK;
    if (dt > 0) {
      if (T.slam) {
        const w0 = 2 * Math.PI / 1.1;
        if (o.hb !== null) { const rise = (hb - o.hb) / dt; if (rise > 0.12 && spdK > 0.5) { o.pv += rise * 0.9 * spdK * dt * 20 * (0.6 + 0.4 * R()); if (rise > 0.3 && R() < 0.5) bowSpray(s, 0.5 + 0.5 * spdK, true); } }
        o.pv += (w0 * w0 * (target - o.pitch) - 2 * 0.3 * w0 * o.pv) * dt; o.pitch += o.pv * dt;
        o.pitch = Math.max(-0.12, Math.min(0.22, o.pitch));
      } else o.pitch += (target - o.pitch) * (1 - Math.exp(-dt / T.tp));
      // roll: a damped oscillator at the hull's roll period, driven by the slope across the beam (the hull's mean)
      const slopeB = -Math.atan2(hS - hP, 2 * b) * 0.35 + -(slopeAcross(W, s, c, sn, a)) * 0.65;
      const w0 = 2 * Math.PI / T.Tr;
      o.rv += (w0 * w0 * (slopeB * T.kr - o.roll) - 2 * T.zr * w0 * o.rv) * dt; o.roll += o.rv * dt;
      if (o.roll > ROLL_MAX) { o.roll = ROLL_MAX; o.rv = Math.min(0, o.rv); } else if (o.roll < -ROLL_MAX) { o.roll = -ROLL_MAX; o.rv = Math.max(0, o.rv); }
    }
    o.hb = hb;
    let pitch = o.pitch * tilt, roll = o.roll * tilt;
    if (WW.isScn('normandy')) { pitch = Math.atan2(hb - hs, 2 * a) * 0.9; roll = -Math.atan2(hS - hP, 2 * b) * 1.1; }   // Normandy: its pose as before (the Channel's short sea: no roll resonance)
    save(g);
    g.updateMatrix(); _m0.copy(g.matrix);   // the sim's matrix (a world-space deck plane sits on its deck)
    // the sim's small constant-clock bob (ships.js syncGroup) off the drawn hull: she moves to the visible sea alone
    if (s.bobY !== undefined) { g.position.y -= s.bobY; g.rotation.x -= s.bobX; g.rotation.z -= s.bobZ; }
    _q.setFromEuler(g.rotation).multiply(_qp.setFromAxisAngle(_Z, pitch)).multiply(_qr.setFromAxisAngle(_X, roll));
    _e.setFromQuaternion(_q, g.rotation.order);
    g.position.y += heave; g.rotation.set(_e.x, _e.y, _e.z);
    seal(g);
    if (s.type === 'carrier') { g.updateMatrix(); _m1.copy(g.matrix); let d = deltas.get(s); if (!d) deltas.set(s, d = { D: new THREE.Matrix4(), q: new THREE.Quaternion() }); d.D.multiplyMatrices(_m1, _m0.invert()); d.q.setFromRotationMatrix(d.D); }
    const stern = s._bk && s._bk.stern;   // a broken ship's stern half heaves with her
    if (stern && stern.parent) { save(stern); stern.position.y += heave; seal(stern); }
    // the bow wave and spray: more with speed, most on the small fast hulls; a burst when the bow buries in a sea
    if (dt > 0 && s.alive && !(s.type === 'submarine' && s.submerged) && spdK > 0.25) {
      const bowY = heave + Math.sin(pitch) * a, bury = hb - bowY;
      o.sprayT -= dt * T.spray * spdK * spdK * (1 + Math.min(2, Math.max(0, bury) * 15));
      if (o.sprayT <= 0) { o.sprayT = 0.35 + 0.4 * R(); bowSpray(s, (0.35 + 0.6 * spdK) * (bury > 0.04 ? 1.6 : 1), false); }
      o.foamT -= dt * spdK;
      if (o.foamT <= 0) { o.foamT = 0.12; bowFoam(s, spdK); }
    }
  }
  // the mean wave slope across the hull at bow, midships and stern
  function slopeAcross(W, s, c, sn, a) {
    let m = 0;
    for (const f of [-0.6, 0, 0.6]) { const g = W.hull(s.x + c * a * f, s.z + sn * a * f, s.stats ? s.stats.length : 10); m += g.x * -sn + g.z * c; }
    return Math.atan(m / 3);
  }
  // white spray thrown up and out from the stem (carried on with the bow for a moment), small puffs, short-lived
  function bowSpray(s, k, slam) {
    const P = WW.fx && WW.fx.raw && WW.fx.raw.pool('solid'); if (!P) return;
    const L = s.stats.length, c = Math.cos(s.heading), sn = Math.sin(s.heading), a = L * (slam ? 0.4 : 0.46), v = s.speed;
    const x = s.x + c * a, z = s.z + sn * a, y = 0.15, sz = Math.min(1, k) * Math.min(1, 0.3 + L / 30), wc = WW.fx.raw.col(0xf2ece2), wc1 = WW.fx.raw.col(0xdfe6e4);
    const n = slam ? 4 : 2 + (R() < k * 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = i & 1 ? 1 : -1, out = (0.5 + R()) * (0.6 + sz), up = (1.2 + 1.4 * R()) * (0.6 + 0.6 * sz);
      P.spawn(x, y, z, c * v * 0.75 - sn * side * out, up, sn * v * 0.75 + c * side * out,
        0.45 + 0.35 * R(), 0.06 + 0.06 * sz, 0.14 + 0.2 * sz, wc, wc1, 8, 0.6, (R() - 0.5) * 1.2, true);
    }
  }
  // a bow wave: foam peeling off both sides of the stem, running aft and out (the "bone in her teeth")
  function bowFoam(s, k) {
    const P = WW.fx && WW.fx.raw && WW.fx.raw.pool('flat'); if (!P) return;
    const L = s.stats.length, B = s.stats.beam || L * 0.12, c = Math.cos(s.heading), sn = Math.sin(s.heading), v = s.speed;
    const col = WW.fx.raw.col(0xd8d8d8), sz = Math.min(1.6, 0.35 + L * 0.04) * (0.6 + 0.6 * k);
    for (const side of [-1, 1]) {
      const lx = L * 0.42, lz = side * B * 0.35, x = s.x + c * lx - sn * lz, z = s.z + sn * lx + c * lz;
      const vx = -c * v * 0.25 - sn * side * v * 0.35, vz = -sn * v * 0.25 + c * side * v * 0.35;
      const i = P.spawn(x, 0.12, z, vx + c * v * 0.6, 0, vz + sn * v * 0.6, 0.9 + 0.5 * R(), sz * 0.5, sz * 1.4, col, col, 0, 1.2, 0);
      P.ey[i] = -(s.heading + side * 0.5); P.ex[i] = 6;
    }
  }

  // a plane on (or nearly on) a posed carrier's deck in world space: how much of the deck's motion it takes
  function deckWeight(p, c) {
    if (p.removed || !p.group || p.group.parent !== WW.scene) return 0;
    const st0 = p.state, ph = p.deckPh;
    const dk = (c.group.position.y || 0) + (c.model && c.model.deck ? c.model.deck.position.y : 2);
    const above = p.y - dk;
    if (st0 === 'rollout') return 1;
    if (st0 === 'takeoff') return ph === 'climb' ? 1 - smooth(1, 9, above) : 1;
    if (st0 === 'landing' && (ph === 'final' || ph === 'app')) {
      const L = c.stats.length, d = Math.hypot(p.x - c.x, p.z - c.z);
      return (1 - smooth(L * 0.5, L * 0.5 + 45, d)) * (1 - smooth(2, 14, above));
    }
    return 0;
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function posePlanes() {
    if (!deltas.size) return;
    for (const p of WW.world.planes) {
      const c = p.carrier, d = c && deltas.get(c); if (!d) continue;
      const w = deckWeight(p, c); if (w <= 0) continue;
      const g = p.group;
      save(g);
      _v.copy(g.position).applyMatrix4(d.D).sub(g.position).multiplyScalar(w);
      g.position.add(_v);
      _qi.identity().slerp(d.q, w);
      g.quaternion.premultiply(_qi);
      seal(g); stats.planes++;
    }
  }
  // floating things: heave on the surface and tilt with its slope
  function floatObj(g, x, z, k, tilt) {
    const W = WW.sea, h = W.height(x, z), sl = W.slope(x, z);
    save(g);
    g.position.y += h * k;
    _n.set(-sl.x * tilt, 1, -sl.z * tilt).normalize();
    _qi.setFromUnitVectors(_Y, _n);
    g.quaternion.premultiply(_qi);
    seal(g); stats.floaters++;
  }
  function poseFloaters() {
    for (const p of WW.world.planes) if (p.deathMode === 'ditched' && p.group && !p.removed) floatObj(p.group, p.x, p.z, 1, 1.2);
    const LB = WW.lifeboats && WW.lifeboats.boats;
    if (LB) for (const b of LB) if (b.alive && b.g && b.g.visible && b.state !== 'beached' && b.state !== 'wait') floatObj(b.g, b.x, b.z, 1, 1.5);
  }

  // The pose as a ship-local delta (L = sim matrix^-1 x posed matrix: the swell's heave, pitch and roll and
  // damage_visuals.js's settling and trim), kept through unpose: what spawns on a ship during the sim step (fires and
  // smoke at her hit sites, funnel smoke, the avgas plumes) is placed on the deck the camera sees, posedPoint().
  // mark() (main.js, before any pose) takes the sim's matrix; seal() at the end of pose() the posed one.
  const simM = new WeakMap(), poseL = new WeakMap(), _mi = new THREE.Matrix4();
  let posedNow = false;   // between pose() and unpose() the groups already carry the pose: posedPoint must not add it again
  function mark() {
    if (WW.simOnly) return;
    for (const s of WW.world.ships) {
      if (!s.group || s.removed) continue;
      let m = simM.get(s); if (!m) simM.set(s, m = new THREE.Matrix4());
      s.group.updateMatrix(); m.copy(s.group.matrix); m.marked = true;
    }
  }
  function sealDeltas() {
    for (const s of WW.world.ships) {
      const m = s.group && simM.get(s);
      if (!m || !m.marked) { poseL.delete(s); continue; }
      m.marked = false;
      s.group.updateMatrix();
      const L = _mi.copy(m).invert().multiply(s.group.matrix), e = L.elements;
      let off = 0; for (let i = 0; i < 16; i++) off = Math.max(off, Math.abs(e[i] - (i % 5 === 0 ? 1 : 0)));
      if (off < 1e-5) { poseL.delete(s); continue; }
      let o = poseL.get(s); if (!o) poseL.set(s, o = new THREE.Matrix4());
      o.copy(L);
    }
  }
  // a ship-local point (lx, ly, lz) in the world on her posed hull: during the sim from her sim matrix and the pose
  // delta; at frame time (posed) from her matrix alone
  function posedPoint(s, lx, ly, lz, out) {
    s.group.updateMatrix();
    out.set(lx, ly, lz);
    const L = posedNow ? null : poseL.get(s); if (L) out.applyMatrix4(L);
    return out.applyMatrix4(s.group.matrix);
  }

  function pose(rdt) {
    stats.ships = stats.planes = stats.floaters = 0;
    try { poseAll(rdt); } finally { if (!WW.simOnly) { sealDeltas(); posedNow = true; } }
  }
  function poseAll(rdt) {
    if (WW.simOnly || !WW.sea || !WW.sea.active) return;
    const W = WW.sea, dt = Math.min(0.1, rdt || 0);
    deltas.clear();
    for (const s of WW.world.ships) {
      if (!s.group || s.removed || s.wreck || !(s.alive || s.sinking)) continue;
      if (WW.isScn('normandy') && (s.sinking || s.type === 'submarine')) continue;   // (Normandy: as before)
      poseShip(s, dt, W); stats.ships++;
    }
    posePlanes();
    poseFloaters();
  }
  function unpose() {
    posedNow = false;
    for (const [g, P] of posed) {
      // untouched since: give back exactly what the sim (or the module that owns it) left
      if (g.position.x === P.x1 && g.position.y === P.y1 && g.position.z === P.z1 && g.rotation.x === P.rx1 && g.rotation.y === P.ry1 && g.rotation.z === P.rz1) {
        g.position.set(P.x, P.y, P.z); g.rotation.set(P.rx, P.ry, P.rz);
      }
    }
    posed.clear();
  }
  WW.shipSwell = { pose, unpose, mark, posedPoint, stats: () => stats, TYPE };
})(window.WW);
