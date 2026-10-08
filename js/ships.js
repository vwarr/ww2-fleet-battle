// ships.js — owner C. WW.Ship (movement, navigation, damage, sinking) + WW.ships.
// AI (targeting, guns, torpedoes, strikes) lives in ships_ai.js as WW.shipAI.
window.WW = window.WW || {};
(function () {
  const TAU = Math.PI * 2;
  let nextId = 1;
  const SUB_DEPTH = -1.6, DRIFT_MAX = 15;
  const SPACE = { carrier: 70, battleship: 35, cruiser: 35, destroyer: 20, pt: 12, submarine: 12 }; // personal space
  const HEEL = { carrier: 0.045, battleship: 0.04, cruiser: 0.08, destroyer: 0.12, pt: 0.14, submarine: 0.07 }; // rad at full speed + full turn
  const EDGE_BAND = 30; // soft edge-avoidance band (units from the map boundary)
  const BAND = 0.35, HELM = 0.4; // turn rate is proportional below BAND rad of heading error; HELM s to full rudder

  const wreckShips = [];             // settled wrecks (not in WW.world.ships)
  let wreckCol = null;
  if (WW.world && !WW.world.wrecks) WW.world.wrecks = []; // [{x, z, radius, top}]
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
  const nav = (x, z, d) => WW.shipNav.nav(x, z, d), wreckAt = (x, z) => WW.shipNav.wreckAt(x, z); // ships_nav.js
  function wrap(a) { a %= TAU; return a < 0 ? a + TAU : a; }
  const vr = (a, b) => a + (b - a) * Math.random(); // visual-only randomness (sinking booms, fires, wreck smoke): keeps WW.rand for the sim

  class Ship {
    constructor(type, nation, x, z, heading) {
      const st = WW.SHIP_TYPES[type];
      this.id = nextId++; this.type = type; this.stats = st; this.nation = nation;
      this.x = x; this.z = z; this.heading = wrap(heading || 0); this.speed = 0;
      this.hp = this.maxHp = st.hp;
      this.speedK = 1; this.flood = 0; this.engineK = 1; this.engineT = 0; // damage slows ships (ship_speed.js)
      this.escapeEdge = 0; // -1 / +1: leaving the map over the west / east edge (endgame.js), no edge avoidance there
      this.alive = true; this.sinking = false; this.removed = false;
      this.submerged = type === 'submarine';
      this.model = WW.models.buildShip(type, nation);
      this.group = this.model.group;
      this.group.rotation.order = 'YXZ'; // yaw, then roll (x = long axis), then pitch (z)
      // Steering inputs (written by AI).
      this.desiredHeading = this.heading; this.throttle = 0.7;
      this.target = null; this.ai = {};
      this.wantSurface = !this.submerged;
      // Navigation state.
      this.navHeading = this.heading; this.navT = 0; this.clearAhead = 99; this.turnRate = 0; this.rudder = 0; this.trS = 0; this.heel = 0;
      this.lookDist = Math.max(30, 2.2 * st.speed / st.turn);
      // Visual / fx state.
      this.bob = WW.rand() * TAU; this.wakeT = WW.rand() * 0.2; this.smokeT = 0; this.fireT = 0;
      this.dmgSites = []; this.listRoll = 0; this.sinkT = 0; this.boomT = 0; this.slickDone = false;
      this.sinkDir = WW.rand() < 0.5 ? -1 : 1; this.sinkPitch = (WW.rand() - 0.5) * 0.3;
      this.sinkRoll = this.sinkDir * WW.randRange(0.5, 0.9); this.wreck = false; this.wreckInfo = null;
      this.hullBot = -1; this.hullTop = 6; // local vertical extent, for resting on the seabed
      if (typeof THREE !== 'undefined') {
        const b = new THREE.Box3().setFromObject(this.group);
        if (isFinite(b.min.y) && isFinite(b.max.y)) { this.hullBot = Math.min(-0.3, b.min.y); this.hullTop = Math.max(1, b.max.y); }
        if (isFinite(b.min.z)) this.beam = WW.clamp(b.max.z - b.min.z, st.length / 10, st.length / 3); // bow is +x: z extent = beam
      }
      if (!this.beam) this.beam = st.length / 7;
      this.hullPts = WW.shipNav.hullPoints(st.length, this.beam); // footprint samples (ships_nav.js)
      this.bowDepth = Math.max(WW.shipNav.HARD + 0.4, st.minDepth * 0.6); // planner: hull ends/sides keep this much water
      this.depthY = this.submerged ? SUB_DEPTH : 0;
      this.hangar = st.planes ? { fighter: st.planes.fighter, dive: st.planes.dive, torpedo: st.planes.torpedo } : null;
      this.baseColors = this.model.hullMats.map(m => (m.color ? m.color.clone() : null));
      if (type === 'submarine') this.model.hullMats.forEach(m => { m.transparent = true; });
      this.applyLook();
      this.updateDepth(0); // sets sub opacity / shadow flags before the first frame
      this.syncGroup(0);
    }

    // Local (bow +x) → world offset.
    toWorld(lx, lz) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      return [this.x + lx * c - lz * s, this.z + lx * s + lz * c];
    }

    // clearance(h) / planNav(want): look-ahead steering, in ships_nav.js.

    move(dt) {
      const st = this.stats, md = st.minDepth;
      // Heel: outward lean ∝ speed × (smoothed) turn rate, easing in and out over about a roll period.
      this.trS += (this.turnRate - this.trS) * (1 - Math.exp(-dt / 0.3));
      const hm = HEEL[this.type] || 0.06, hw = WW.clamp(-hm * this.speed * this.trS / (st.speed * st.turn), -hm, hm);
      this.heel += (hw - this.heel) * (1 - Math.exp(-dt / Math.max(0.6, st.length * 0.08)));
      // Wanted direction plus separation: each type keeps a personal space (the larger of the two applies).
      let dx = Math.cos(this.desiredHeading), dz = Math.sin(this.desiredHeading);
      const list = WW.world.ships, rs = SPACE[this.type] || 20;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === this || o.removed || !(o.alive || o.sinking) || (o.submerged !== this.submerged)) continue; // steer clear of sinking hulls too
        const r = Math.max(rs, SPACE[o.type] || 20, (st.length + o.stats.length) * 0.6 + 4);
        const ex = this.x - o.x, ez = this.z - o.z, d2 = ex * ex + ez * ez;
        if (d2 < r * r && d2 > 1e-4) {
          const d = Math.sqrt(d2), k = (r - d) / r, w = (k + k * k * 4) * (o.nation === this.nation ? 1.5 : 0.6);
          dx += (ex / d) * w; dz += (ez / d) * w;
        }
      }
      // Soft edge avoidance: an inward push that grows fast inside EDGE_BAND, so ships turn off the map
      // boundary long before the hull gets pinned against it.
      const eb = Math.max(EDGE_BAND, this.lookDist * 0.6), MW = WW.cfg.MAP_W, MH = WW.cfg.MAP_H;
      const ep = e => (e < eb ? 2.5 * ((eb - e) / eb) * ((eb - e) / eb) : 0);
      dx += (this.escapeEdge < 0 ? 0 : ep(this.x)) - (this.escapeEdge > 0 ? 0 : ep(MW - this.x)); dz += ep(this.z) - ep(MH - this.z);
      const want = Math.atan2(dz, dx);
      this.navT -= dt;
      if (this.navT <= 0) { this.navT = 0.2 + WW.rand() * 0.1; this.planNav(want); }

      // Turn (slower at low speed, but never zero so a stopped ship can come about).
      let pivot = this.clearAhead < 3; // nose against shallows: stop and come about
      // Stuck pivoting (every heading looks shallow with the planning margin): head for deeper water.
      this.pivotT = pivot ? (this.pivotT || 0) + dt : 0;
      if (this.pivotT > 2 && !(this.escapeT > 0)) {
        let bd = -1e9;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * TAU, d = this.clearance(a) + 0.5 * WW.terrain.depthAt(this.x + Math.cos(a) * 7, this.z + Math.sin(a) * 7);
          if (d > bd) { bd = d; this.escapeH = a; } // most open water for the whole hull (never off the map edge)
        }
        this.escapeT = 3; this.escHold = 0; this.escAstern = false;
      }
      // A jammed swing (an end against the shallows or a wreck, turn rate 0 for 1 s): come about the other
      // way instead, as an escape toward the clearest heading on the free side. An escape that jams again
      // backs off astern first (bow run up on a shoal).
      const dj = WW.angleDiff(this.heading, this.escapeT > 0 ? this.escapeH : this.navHeading);
      this.escStall = Math.abs(dj) > 0.4 && Math.abs(this.turnRate) < 1e-3 && !(this.asternT > 0) ? (this.escStall || 0) + dt : 0;
      if (this.escStall > 1 && this.escapeT > 0 && !this.escAstern) { this.asternT = 2.5; this.escAstern = true; this.escStall = 0; }
      if (this.escStall > 1) {
        this.escAstern = false;
        let bc = -1;
        for (const o of [1.2, 2, 2.8]) { const h = this.heading - Math.sign(dj) * o, c = this.clearance(h); if (c > bc) { bc = c; this.escapeH = wrap(h); } }
        this.escStall = 0; this.escapeT = 3; this.escHold = 0;
      }
      if (this.escapeT > 0) { // swing to face it first (up to 15 s for a big hull), then go for escapeT s
        const off = Math.abs(WW.angleDiff(this.heading, this.escapeH)) > 0.3;
        if (off && this.escHold < 15) this.escHold += dt; else this.escapeT -= dt;
        this.navHeading = this.escapeH; this.navT = 0.3; this.pivotT = 0; pivot = pivot && off;
      }
      const sf = pivot ? 1.5 : WW.clamp(this.speed / st.speed, 0.4, 1);
      const diff = WW.angleDiff(this.heading, this.navHeading);
      // Helm: rate ∝ heading error (full rate past BAND), and the rudder takes HELM s to swing hard over.
      const maxR = st.turn * sf, cmd = maxR * WW.clamp(diff / BAND, -1, 1);
      this.rudder += WW.clamp(cmd - this.rudder, -maxR * dt / HELM, maxR * dt / HELM);
      const turn = WW.clamp(this.rudder * dt, -maxR * dt, maxR * dt), h0 = this.heading;

      // Speed: slow down when the way ahead is short or the turn is large.
      const vk = WW.shipSpeed ? WW.shipSpeed.k(this, dt) : 1; // hull damage, flooding, engine room (ship_speed.js)
      let ts = st.speed * vk * WW.clamp(this.throttle, 0, 1);
      if (this.clearAhead < this.lookDist * 0.6) ts *= WW.clamp(this.clearAhead / (this.lookDist * 0.6), 0.25, 1);
      if (Math.abs(diff) > 1.2) ts *= 0.6;
      if (pivot) ts = 0;
      const acc = st.speed * (ts > this.speed ? 0.12 : 0.25) * dt;
      this.speed += WW.clamp(ts - this.speed, -acc, acc);

      // Step, with hard guarantees: the centre never ends on a non-navigable cell and no hull sample
      // (bow, stern, beams) ends on water shallower than shipNav.HARD — full turn, half turn, astern, straight.
      const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, N = WW.shipNav, m = N.EDGE, cur = N.hullMin(this, this.x, this.z, h0);
      const fo = N.fixedOverlap(this, this.x, this.z, h0) + 1e-6; // never drive deeper into a wreck / sinking hull
      const pose = (h, v) => {
        const nx = WW.clamp(this.x + Math.cos(h) * v, m, W - m), nz = WW.clamp(this.z + Math.sin(h) * v, m, H - m);
        if (!nav(nx, nz, md) || !N.hullOK(this, nx, nz, h, cur) || N.fixedOverlap(this, nx, nz, h) > fo) return false;
        this.x = nx; this.z = nz; this.heading = wrap(h); return true;
      };
      this.turnRate = 0;
      const v = this.speed * dt, back = -0.35 * st.speed * dt;
      if (this.asternT > 0) { // backing off a shoal / wreck, rudder toward the plan
        this.asternT -= dt; this.speed = 0;
        if (pose(h0 - turn * 0.5, back) || pose(h0, back)) return;
        this.asternT = 0;
      }
      for (const f of [1, 0.5]) if (pose(h0 + turn * f, v)) { this.turnRate = dt > 0 ? turn * f / dt : 0; this.blockedT = 0; return; }
      // Slow and the swing is blocked (an end would touch the shallows / map edge): turn in place, else go astern.
      if (Math.abs(turn) > 1e-4 && this.speed < st.speed * 0.3) {
        if (pose(h0 + turn, 0) || pose(h0 + turn * 0.5, 0)) { this.speed *= 0.5; this.turnRate = turn / dt; return; }
        if (pose(h0 + turn, back) || pose(h0 + turn * 0.5, back)) { this.speed = 0; return; }
        const crawl = 0.3 * st.speed; // stern in the shallows: creep ahead into deeper water instead
        for (const f of [1, 0.5, 0]) if (pose(h0 + turn * f, crawl * dt)) { this.speed = crawl; this.turnRate = turn * f / dt; return; }
        if (pose(h0, back)) { this.speed = 0; return; }
      }
      if (pose(h0, v)) { this.blockedT = 0; return; }
      if (nav(this.x, this.z, md)) {
        // Blocked: stay, bleed speed, turn hard toward the planned heading.
        this.speed *= 0.5;
        this.blockedT = (this.blockedT || 0) + dt;
        if (this.blockedT > 0.5) { // pick the open heading nearest the plan and hold it for a while
          this.blockedT = 0;
          let bh = null, bd = 9;
          for (let k = 0; k < 24; k++) {
            const h = (k / 24) * TAU, c = Math.cos(h), s = Math.sin(h);
            if (!nav(this.x + c * 0.4, this.z + s * 0.4, md) || !nav(this.x + c * 1.5, this.z + s * 1.5, md + 0.2) || !nav(this.x + c * 4, this.z + s * 4, md + 0.4)) continue;
            if (N.hullMin(this, this.x + c * 3, this.z + s * 3, h) < N.HARD) continue;
            const d = Math.abs(WW.angleDiff(this.navHeading, h));
            if (d < bd) { bd = d; bh = h; }
          }
          if (bh !== null) { this.navHeading = bh; this.navT = 1.5; }
        } else if (this.navT > 1.5 || this.navT <= 0) this.navT = 0;
        const dd = WW.clamp(WW.angleDiff(h0, this.navHeading), -st.turn * dt * 3, st.turn * dt * 3);
        if (pose(h0 + dd, 0) || pose(h0 + dd * 0.4, 0)) return;
        // Bow or stern against the shore: go astern a little while swinging (a three-point turn).
        if (pose(h0 + dd * 0.5, back) || pose(h0, back)) { this.speed = 0; return; }
        return;
      }
      // Already on bad water (bad spawn, or a wreck settled on us).
      const ve = Math.max(1.5, this.speed) * dt, wk = wreckAt(this.x, this.z);
      if (wk && WW.terrain.isNavigable(this.x, this.z, md)) {
        // Back away from the wreck along the most outward direction that keeps terrain depth.
        const out = Math.atan2(this.z - wk.z, this.x - wk.x);
        for (let k = 0; k < 13; k++) {
          const a = out + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
          const px = this.x + Math.cos(a) * ve, pz = this.z + Math.sin(a) * ve;
          if (px > m && px < W - m && pz > m && pz < H - m && WW.terrain.isNavigable(px, pz, md) && N.hullOK(this, px, pz, h0, cur)) { this.x = px; this.z = pz; return; }
        }
        return; // boxed in: hold position (still on valid terrain)
      }
      let bx = 0, bz = 0, bd = -1e9;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU, d = WW.terrain.depthAt(this.x + Math.cos(a) * 5, this.z + Math.sin(a) * 5);
        if (d > bd) { bd = d; bx = Math.cos(a); bz = Math.sin(a); }
      }
      this.x = WW.clamp(this.x + bx * ve, m, W - m); this.z = WW.clamp(this.z + bz * ve, m, H - m);
    }

    updateDepth(dt) {
      if (this.type !== 'submarine') return;
      const tgt = this.wantSurface ? 0 : SUB_DEPTH;
      this.depthY += WW.clamp(tgt - this.depthY, -0.5 * dt, 0.5 * dt);
      this.submerged = this.depthY < SUB_DEPTH * 0.45;
      const op = WW.lerp(1, 0.35, this.depthY / SUB_DEPTH);
      this.model.hullMats.forEach(mt => { mt.opacity = op; });
      if (this.shadowOff !== this.submerged) { // a submerged sub casts no shadow; restore each mesh's own flag on surfacing
        this.shadowOff = this.submerged;
        this.group.traverse(o => { if (!o.isMesh) return; if (o.userData.cs0 === undefined) o.userData.cs0 = o.castShadow; o.castShadow = !this.submerged && o.userData.cs0; });
      }
    }

    syncGroup(t) {
      const g = this.group, amp = 0.35 / Math.sqrt(this.stats.length);
      g.position.set(this.x, this.depthY + Math.sin(t * 1.1 + this.bob) * amp * 0.5, this.z);
      g.rotation.y = -this.heading;
      g.rotation.x = Math.sin(t * 0.8 + this.bob * 1.3) * amp * 0.25 + this.heel + this.listRoll + this.cripList();
      g.rotation.z = Math.sin(t * 0.9 + this.bob) * amp * 0.12;
    }

    // A cripple lists heavier: flooding and lost buoyancy, on the side of its torpedo list (else its sinking side).
    cripList() {
      const f = this.hp / this.maxHp, x = Math.min(0.16, (this.flood || 0) * 0.3 + Math.max(0, 0.6 - f) * 0.22); // up to ~9 deg more
      return x ? (this.listRoll ? Math.sign(this.listRoll) : this.sinkDir) * x : 0;
    }

    // Wakes, smoke and fire while afloat.
    effects(dt) {
      const st = this.stats, fx = WW.fx;
      this.wakeT -= dt;
      if (this.wakeT <= 0 && this.speed > 0.6) {
        if (this.type === 'submarine' && this.submerged) {
          this.wakeT = 0.3;
          const p = this.toWorld(st.length * 0.1, 0);
          fx.wake(p[0], p[1], this.heading, 0.4);
        } else {
          this.wakeT = 0.12;
          const p = this.toWorld(-st.length * 0.45, 0);
          fx.wake(p[0], p[1], this.heading, WW.clamp(st.length / 10, 0.4, 2.5) * (0.4 + 0.6 * this.speed / st.speed) * (0.55 + 0.45 * this.speedK)); // a cripple churns less
        }
      }
      const f = this.hp / this.maxHp;
      if (f >= 0.6) return;
      if (WW.damage) WW.damage.stackSmoke(this, f, dt); // funnel smoke plume (damage.js)
    }

    applyLook() {
      const f = WW.clamp(this.hp / this.maxHp, 0, 1), dark = 1 - (1 - f) * 0.45;
      this.model.hullMats.forEach((m, i) => { if (m.color && this.baseColors[i]) m.color.copy(this.baseColors[i]).multiplyScalar(dark); });
    }

    // kind ('shell'|'torpedo'|'bomb'|'dc') and cal are optional: WW.damage turns the hit into a local fire/smoke site.
    takeDamage(amount, hx, hz, kind, cal) {
      if (!this.alive) return;
      this.hp -= amount;
      WW.emit('shipHit', { ship: this, amount, x: hx, z: hz, kind, cal }); // sound hook (audio_naval_wire.js)
      if (WW.shipSpeed) WW.shipSpeed.hit(this, amount, kind, cal);         // flooding, engine room (sim: WW.rand)
      if (WW.damage) WW.damage.hit(this, amount, hx, hz, kind, cal);
      if (this.hp <= 0) { this.hp = 0; this.startSinking(); return; }
      this.applyLook();
    }

    startSinking() {
      this.alive = false; this.sinking = true; this.sinkT = 0; this.target = null; this.startY = this.depthY;
      if (Math.abs(this.listRoll) > 0.02) this.sinkRoll = Math.sign(this.listRoll) * Math.abs(this.sinkRoll);
      const L = this.stats.length;
      // Drift a little (<= DRIFT_MAX) toward nearby shallows so wrecks often stay visible, but never onto another wreck.
      let bd = WW.terrain.depthAt(this.x, this.z) - 2, bh;
      this.sx0 = this.x; this.sz0 = this.z;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        for (const r of [6, 10, 14]) {
          const px = this.x + Math.cos(a) * r, pz = this.z + Math.sin(a) * r, d = WW.terrain.depthAt(px, pz);
          if (d > 0.8 && d < bd && !wreckNear(px, pz, L * 0.5 + 3, this)) { bd = d; bh = a; }
        }
      }
      if (bh !== undefined) { this.driftH = bh; this.speed = WW.clamp(this.speed, 2, 3); }
      else if (wreckNear(this.x, this.z, L * 0.5 + 3, this)) { // sinking on top of a wreck: slide clear of it
        let ax = 0, az = 0;
        for (const w of WW.world.wrecks) { const d = WW.dist(this.x, this.z, w.x, w.z) + 0.1; if (d < 40) { ax += (this.x - w.x) / d; az += (this.z - w.z) / d; } }
        this.pushH = Math.atan2(az, ax || 1e-3); this.speed = 4; // slides sideways; no visible yaw snap
      } else this.speed = Math.min(this.speed, 2);
      WW.fx.explosion(this.x, 2 + this.depthY, this.z, WW.clamp(L / 7, 1.2, 3.5));
      WW.fx.oilSlick(this.x, this.z, L * 0.5);
      WW.stats.shipsSunk++;
      WW.emit('shipSunk', this);
    }

    updateSinking(dt) {
      this.sinkT += dt;
      const L = this.stats.length, k = Math.min(1, this.sinkT / 8), g = this.group;
      this.speed = Math.max(0, this.speed - dt * 0.7);
      const N = WW.shipNav, dep = (p) => Math.max(0, WW.terrain.depthAt(p[0], p[1]));
      if (this.driftH !== undefined) { // swing toward the drift heading unless an end would touch the shallows
        const nh = this.heading + WW.clamp(WW.angleDiff(this.heading, this.driftH), -0.3 * dt, 0.3 * dt);
        if (N.hullMin(this, this.x, this.z, nh) >= N.GROUND) this.heading = nh;
      }
      const mh = this.pushH !== undefined ? this.pushH : this.heading;
      const nx = this.x + Math.cos(mh) * this.speed * dt, nz = this.z + Math.sin(mh) * this.speed * dt;
      if (WW.dist(nx, nz, this.sx0, this.sz0) > DRIFT_MAX || (wreckNear(nx, nz, L * 0.5 + 3, this) && !wreckNear(this.x, this.z, L * 0.5 + 3, this))) this.speed = 0; // stay near the sinking spot, apart from other wrecks
      else if (WW.terrain.isNavigable(nx, nz, Math.max(1.2, L * 0.1)) && N.hullMin(this, nx, nz, this.heading) >= N.GROUND) { this.x = nx; this.z = nz; }
      else this.speed = 0; // grounded: no hull sample reaches the beach
      // Ease down to rest on the seabed (shallow water leaves the upperworks above the surface).
      // The deeper end goes down (bow up when the stern has deeper water); keels follow the seabed.
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
      g.position.set(this.x, WW.lerp(this.startY, this.restY, k * k), this.z);
      g.rotation.y = -this.heading;
      g.rotation.x = WW.lerp(this.listRoll + this.heel, roll, Math.min(1, this.sinkT / 4)); // heel at the fatal hit eases out
      g.rotation.z = WW.lerp(this.sinkPitch, th || this.sinkPitch, k) * k;
      if (!wreckCol) wreckCol = new THREE.Color(0x7a5a44); // rust: stays visible under the water
      this.model.hullMats.forEach((m, i) => {
        if (m.color && this.baseColors[i]) m.color.copy(this.baseColors[i]).multiplyScalar(0.7).lerp(wreckCol, k * 0.75);
        if (this.type === 'submarine') m.opacity = Math.max(m.opacity, k);
      });
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
      if (!this.slickDone && this.sinkT > 3) { this.slickDone = true; WW.fx.oilSlick(this.x, this.z, L * 0.8); }
      if (this.sinkT > 5 && this.sinkT - dt <= 5) WW.fx.splash(this.x, this.z, WW.clamp(L / 7, 1, 4));
      if (this.sinkT >= 8.5) this.becomeWreck();
    }

    // Settled: stays in the scene until clearAll; leaves WW.world.ships; blocks navigation if it breaks the surface.
    becomeWreck() {
      this.sinking = false; this.wreck = true; this.wreckT = 0;
      const top = this.restTop;
      this.wreckInfo = { x: this.x, z: this.z, radius: this.stats.length * 0.5 + 3, top, born: WW.time.now, type: this.type };
      WW.world.wrecks.push(this.wreckInfo);
      wreckShips.push(this);
    }

    updateWreck(dt) {
      this.wreckT += dt;
      if (this.wreckT > 30 || this.wreckInfo.top < 0.3) return;
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = vr(0.6, 1.2) * (this.dmgSites.length ? 2.5 : 1); // lighter when hit sites smoke too
        WW.fx.smoke(this.x + vr(-1, 1), Math.max(0.5, Math.min(this.wreckInfo.top, 4)), this.z + vr(-1, 1), true, 0.5);
      }
    }

    remove() {
      if (this.removed) return;
      this.removed = true; this.sinking = false; this.alive = false; this.dmgSites.length = 0;
      if (WW.scene) WW.scene.remove(this.group);
      this.model.hullMats.forEach(m => { if (m.dispose) m.dispose(); });
    }
  }

  function prune() {
    const a = WW.world.ships;
    let j = 0;
    for (let i = 0; i < a.length; i++) if (!a[i].removed && !a[i].wreck) a[j++] = a[i];
    a.length = j;
  }

  WW.Ship = Ship;
  WW.ships = {
    init() {},
    spawn(type, nation, x, z, heading) {
      const md = WW.SHIP_TYPES[type].minDepth;
      if (!nav(x, z, md)) { // nudge to the nearest navigable point (spiral search)
        outer: for (let r = 2; r <= 80; r += 2) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
            if (nav(px, pz, md)) { x = px; z = pz; break outer; }
          }
        }
      }
      if (heading === undefined) heading = nation === 'USN' ? 0 : Math.PI;
      const s = new Ship(type, nation, x, z, heading);
      WW.shipNav.placeHull(s, nav);  // whole hull clear of land too, not just the centre
      if (WW.scene) WW.scene.add(s.group);
      WW.world.ships.push(s);
      if (WW.shipAI && WW.shipAI.setup) WW.shipAI.setup(s);
      return s;
    },
    alive(nation) {
      return WW.world.ships.filter(s => s.alive && (!nation || s.nation === nation));
    },
    update(dt) {
      // Only AI / weapons are gated on 'battle'. In 'victory' ships keep sailing; in 'setup' they hold still.
      const gs = WW.game && WW.game.state, battle = gs === 'battle', live = battle || gs === 'victory';
      const t = WW.time.now, arr = WW.world.ships.slice();
      for (const s of arr) {
        if (s.removed || s.wreck) continue;
        if (s.sinking) { s.updateSinking(dt); continue; }
        if (battle) { if (WW.shipAI) WW.shipAI.update(s, dt); }
        else if (live) s.throttle = Math.min(s.throttle, 0.5);
        if (live) s.move(dt); else { s.turnRate = 0; s.speed = 0; }
        s.updateDepth(dt); // before the collision pass: a sub surfacing under a ship gets pushed clear
      }
      if (live) WW.shipNav.resolve(arr, wreckShips); // hard backstop: no hulls through each other or through wrecks
      for (const s of arr) {
        if (s.removed || s.wreck || s.sinking) continue;
        if (!WW.simOnly) s.effects(dt); // wakes and funnel smoke: visual only
        s.syncGroup(t);
      }
      prune();
      for (const w of wreckShips) w.updateWreck(dt);
      if (WW.damage) WW.damage.update(dt);
    },
    clearAll() {
      for (const s of WW.world.ships) s.remove();
      for (const s of wreckShips) s.remove();
      WW.world.ships.length = 0; wreckShips.length = 0;
      nextId = 1; // ids feed sim maths (ships_ai jink phase): same ids every round for a seeded replay
      if (WW.world.wrecks) WW.world.wrecks.length = 0; else WW.world.wrecks = [];
      if (WW.damage) WW.damage.clearAll();
    }
  };
})();
