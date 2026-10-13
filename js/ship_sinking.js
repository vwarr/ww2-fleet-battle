// ship_sinking.js - the sinking of a WW.Ship: run-on, drift, settling on the seabed, the wreck (sim: no WW.rand here;
// the booms, fires and smoke use Math.random). Methods on WW.Ship.prototype; loads after ships.js and ships_nav.js.
//  - Run-on: a ship sunk under way carries her way on. Her speed at the fatal hit decays exponentially over TAU s
//    (heavier hulls longer; flooding, a capsize or a broken back shorten it): a fast destroyer runs on 2-3 lengths, a
//    carrier 1-2 (Hood went down in about three minutes but still under way; Yorktown and Hornet were stopped).
//    The helm is left as it was: she keeps swinging with the turn she had, slowing with her speed, else holds course.
//  - Late phase: once the way is off (speed < COAST_END), the old drift: a little (<= DRIFT_MAX from there) toward
//    nearby shallows so wrecks often stay visible, or a slide clear of a wreck she sank on top of.
//  - Every step is rejected if the hull would touch the shallows (shipNav.GROUND) or overlap another wreck or sinking
//    hull: a sinking ship never slides onto land or another wreck. She settles over sinkDur s (8.5 s at rest, up to
//    3 s more for a ship under way), then becomes a wreck.
//  - A ship broken in two (ship_breakup.js) stops quickly and poses her two halves there.
window.WW = window.WW || {};
(function () {
  const TAU2 = Math.PI * 2, DRIFT_MAX = 15, COAST_END = 1.2;
  const TAU = { carrier: 7, battleship: 6.5, cruiser: 5, destroyer: 4, submarine: 2.5, pt: 1 }; // run-on time constant (s)
  const vr = (a, b) => a + (b - a) * Math.random(); // visual-only randomness
  let wreckCol = null;
  // A settled wreck or another sinking ship whose footprint overlaps a circle of radius r at (x, z).
  function wreckNear(x, z, r, self) {
    const w = WW.world.wrecks || [];
    for (let i = 0; i < w.length; i++) { const R = r + w[i].radius; if (WW.dist2(x, z, w[i].x, w[i].z) < R * R) return true; }
    const s = WW.world.ships;
    for (let i = 0; i < s.length; i++) {
      const o = s[i]; if (o === self || !o.sinking) continue;
      const R = r + o.stats.length * 0.5 + 3; if (WW.dist2(x, z, o.x, o.z) < R * R) return true;
    }
    return false;
  }
  // Late phase: drift toward the shallowest nearby water (not onto another wreck), from where the run-on ended.
  function driftPlan(s) {
    const L = s.stats.length;
    let bd = WW.terrain.depthAt(s.x, s.z) - 2, bh;
    s.sx0 = s.x; s.sz0 = s.z;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU2;
      for (const r of [6, 10, 14]) {
        const px = s.x + Math.cos(a) * r, pz = s.z + Math.sin(a) * r, d = WW.terrain.depthAt(px, pz);
        if (d > 0.8 && d < bd && !wreckNear(px, pz, L * 0.5 + 3, s)) { bd = d; bh = a; }
      }
    }
    if (bh !== undefined) { s.driftH = bh; s.speed = WW.clamp(s.speed, 1.5, 3); }
  }
  const P = WW.Ship.prototype;

  P.startSinking = function () {
    this.alive = false; this.sinking = true; this.sinkT = 0; this.target = null; this.startY = this.depthY;
    if (Math.abs(this.listRoll) > 0.02) this.sinkRoll = Math.sign(this.listRoll) * Math.abs(this.sinkRoll);
    const st = this.stats, L = st.length;
    if (WW.shipBreakup) WW.shipBreakup.decide(this); // sim: the one WW.rand draw of the sinking (broken in two?)
    this.sx0 = this.x; this.sz0 = this.z;
    const v0 = Math.max(0, this.speed);
    let tau = (TAU[this.type] || 4) / (1 + 2.5 * (this.flood || 0)); // flooding / down by the head: she loses way sooner
    if (this.capsized) tau *= 0.5;
    if (this.broken) tau = Math.min(tau, 1.4);                       // a broken back: the halves stop in their own length
    this.coastTau = tau; this.coastV0 = v0; this.coastTr = this.turnRate || 0; this.coasting = true;
    const way = WW.clamp(v0 / st.speed, 0, 1);
    this.sinkDur = 8.5 + (this.broken || L < 8 ? 0 : 3 * way);
    this.sinkPow = 2 + 1.5 * way; // under way she stays up longer, low in the water, then goes
    if (wreckNear(this.x, this.z, L * 0.5 + 3, this)) { // sinking on top of a wreck: slide clear of it
      let ax = 0, az = 0;
      for (const w of WW.world.wrecks) { const d = WW.dist(this.x, this.z, w.x, w.z) + 0.1; if (d < 40) { ax += (this.x - w.x) / d; az += (this.z - w.z) / d; } }
      this.pushH = Math.atan2(az, ax || 1e-3); this.speed = 4; this.coasting = false; // slides sideways; no visible yaw snap
    } else if (v0 < COAST_END) { this.coasting = false; driftPlan(this); }
    this.turnRate = 0; this.rudder = 0;
    WW.fx.explosion(this.x, 2 + this.depthY, this.z, WW.clamp(L / 7, 1.2, 3.5));
    WW.fx.oilSlick(this.x, this.z, L * 0.5);
    WW.stats.shipsSunk++;
    WW.emit('shipSunk', this);
  };

  P.updateSinking = function (dt) {
    this.sinkT += dt;
    const L = this.stats.length, D = this.sinkDur || 8.5, k = Math.min(1, this.sinkT / (D - 0.5));
    const N = WW.shipNav;
    if (this.coasting) {
      this.speed *= Math.exp(-dt / this.coastTau);
      if (k > 0.7) this.speed *= Math.exp(-dt * 2); // settling: the last of her way comes off
      const nh = this.heading + this.coastTr * (this.speed / Math.max(0.1, this.coastV0)) * dt; // the helm she had
      if (nh !== this.heading && N.hullMin(this, this.x, this.z, nh) >= N.GROUND) this.heading = nh;
      if (this.speed < COAST_END) { this.coasting = false; if (!this.broken) driftPlan(this); }
    } else {
      this.speed = Math.max(0, this.speed - dt * 0.7);
      if (this.driftH !== undefined) { // swing toward the drift heading unless an end would touch the shallows
        const nh = this.heading + WW.clamp(WW.angleDiff(this.heading, this.driftH), -0.3 * dt, 0.3 * dt);
        if (N.hullMin(this, this.x, this.z, nh) >= N.GROUND) this.heading = nh;
      }
    }
    if (this.speed > 0) {
      const mh = this.pushH !== undefined ? this.pushH : this.heading, r = L * 0.5 + 3;
      const nx = this.x + Math.cos(mh) * this.speed * dt, nz = this.z + Math.sin(mh) * this.speed * dt;
      if ((!this.coasting && WW.dist(nx, nz, this.sx0, this.sz0) > DRIFT_MAX) || (wreckNear(nx, nz, r, this) && !wreckNear(this.x, this.z, r, this))) this.speed = 0; // near the spot, apart from other wrecks
      else if (WW.terrain.isNavigable(nx, nz, Math.max(1.2, L * 0.1)) && N.hullMin(this, nx, nz, this.heading) >= N.GROUND) { this.x = nx; this.z = nz; }
      else { this.speed = 0; this.coasting = false; } // aground: no hull sample reaches the beach
    }
    if (this.broken && WW.shipBreakup) WW.shipBreakup.pose(this, k, dt);
    else this.settlePose(k);
    this.sinkFx(dt, L, D);
    if (this.sinkT >= D) this.becomeWreck();
  };

  // Ease down to rest on the seabed (shallow water leaves the upperworks above the surface).
  // The deeper end goes down (bow up when the stern has deeper water); keels follow the seabed.
  P.settlePose = function (k) {
    const L = this.stats.length, g = this.group, N = WW.shipNav, dep = (p) => Math.max(0, WW.terrain.depthAt(p[0], p[1]));
    const Dm = dep([this.x, this.z]), Db = dep(this.toWorld(L * 0.5, 0)), Ds = dep(this.toWorld(-L * 0.5, 0));
    if (Math.abs(Db - Ds) > 0.5) this.pitchSgn = Ds > Db ? 1 : -1;
    const sg = this.pitchSgn || Math.sign(this.sinkPitch || 1), fy = d => Math.min(-1, -d - this.hullBot * 0.8);
    const flatY = fy(sg > 0 ? Ds : Db), snMin = Math.max((fy(sg > 0 ? Db : Ds) - flatY) / L, (fy(Dm) - flatY) / (L * 0.5));
    // In shallow water one end rests on the seabed and the other end rears clear of the surface.
    const want = WW.clamp(L * 0.2, 1.6, 5);             // how far the raised end should show
    let roll = this.sinkRoll, sn = (want - flatY - this.hullTop * 0.85) / L;
    if (sn > 0.5) sn = 0;                               // too deep: settle flat on the bottom
    else { sn = WW.clamp(sn, 0.24, 0.5); roll *= 0.6; } // clearly tilted: reads as a wreck, not a ship
    sn = WW.clamp(Math.max(sn, snMin), 0, 0.7);         // never let the high end or midships sink into the seabed
    for (let r = 0; r < 3; r++) { // don't roll the upperworks over a beach
      const p = this.toWorld(0, this.hullTop * Math.sin(roll)); if (WW.terrain.depthAt(p[0], p[1]) >= N.GROUND) break; roll *= 0.4;
    }
    const th = Math.asin(sn) * sg;
    this.restY = flatY + L * 0.5 * sn;
    this.restTop = flatY + this.hullTop * Math.cos(roll) + L * sn;
    g.position.set(this.x, WW.lerp(this.startY, this.restY, Math.pow(k, this.sinkPow || 2)), this.z);
    g.rotation.set(WW.lerp(this.listRoll + this.heel, roll, Math.min(1, this.sinkT / 4)), // heel at the fatal hit eases out
      -this.heading, WW.lerp(this.sinkPitch, th || this.sinkPitch, k) * k);
    this.rustLook(k);
  };
  P.rustLook = function (k) {
    if (!wreckCol) wreckCol = new THREE.Color(0x7a5a44); // rust: stays visible under the water
    this.model.hullMats.forEach((m, i) => {
      if (m.color && this.baseColors[i]) m.color.copy(this.baseColors[i]).multiplyScalar(0.7).lerp(wreckCol, k * 0.75);
      if (this.type === 'submarine') m.opacity = Math.max(m.opacity, k);
    });
  };

  // booms, fires, the oil slick and the final splash (visual)
  P.sinkFx = function (dt, L, D) {
    this.wakeT -= dt;
    if (this.wakeT <= 0 && this.speed > 0.8 && this.sinkT < D * 0.6) { // still under way: her wake, fading
      this.wakeT = 0.15;
      const p = this.toWorld(-L * 0.45, 0);
      WW.fx.wake(p[0], p[1], this.heading, WW.clamp(L / 10, 0.4, 2.5) * (0.3 + 0.5 * this.speed / this.stats.speed));
    }
    this.boomT -= dt;
    if (this.boomT <= 0 && this.sinkT < 5) {
      this.boomT = vr(1.4, 2.8);
      const p = this.toWorld(vr(-L * 0.4, L * 0.4), 0);
      WW.fx.explosion(p[0], 1, p[1], WW.clamp(L / 12, 0.6, 1.8));
      WW.emit('shipBoom', { ship: this, x: p[0], y: 1, z: p[1], size: WW.clamp(L / 16, 0.5, 1.4) }); // sound hook
    }
    if (this.sinkT < 6 && !this.dmgSites.length) { // damaged ships burn at their hit sites (WW.damage)
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = 0.12;
        const p = this.toWorld(vr(-L * 0.3, L * 0.3), 0);
        WW.fx.fire(p[0], 0.8, p[1]);
        if (Math.random() < 0.4) WW.fx.smoke(p[0], 2, p[1], true, 1.5);
      }
    }
    const tS = D - 5.5, tG = D - 3.5; // the second slick where she goes down; the plunge
    if (!this.slickDone && this.sinkT > tS) { this.slickDone = true; WW.fx.oilSlick(this.x, this.z, L * 0.8); }
    if (this.sinkT > tG && this.sinkT - dt <= tG) {
      WW.fx.splash(this.x, this.z, WW.clamp(L / 7, 1, 4));
      // the air in her goes up as she goes under: a burst of bubbles and spray along the hull (size by length)
      for (let i = 0, n = Math.min(5, 1 + Math.floor(L / 6)); i < n; i++) {
        const p = this.toWorld(vr(-L * 0.4, L * 0.4), vr(-1, 1));
        WW.fx.torpBubbles(p[0], p[1], vr(0, TAU2)); WW.fx.splash(p[0], p[1], WW.clamp(L / 14, 0.6, 2));
      }
    }
  };

  // Settled: stays in the scene until clearAll; leaves WW.world.ships; blocks navigation if it breaks the surface.
  P.becomeWreck = function () {
    this.sinking = false; this.wreck = true; this.wreckT = 0; this.speed = 0;
    const top = this.restTop;
    this.wreckInfo = { x: this.x, z: this.z, radius: this.stats.length * 0.5 + 3, top, born: WW.time.now, type: this.type };
    WW.world.wrecks.push(this.wreckInfo);
    WW.ships._wreckShips.push(this);
  };

  P.updateWreck = function (dt) {
    this.wreckT += dt;
    if (this.wreckT > 30 || this.wreckInfo.top < 0.3) return;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = vr(0.6, 1.2) * (this.dmgSites.length ? 2.5 : 1); // lighter when hit sites smoke too
      WW.fx.smoke(this.x + vr(-1, 1), Math.max(0.5, Math.min(this.wreckInfo.top, 4)), this.z + vr(-1, 1), true, 0.5);
    }
  };
  WW.shipSinking = { wreckNear: wreckNear, DRIFT_MAX: DRIFT_MAX };
})();
