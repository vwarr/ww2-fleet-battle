// ships.js — owner C. WW.Ship (movement, navigation, damage) + WW.ships; sinking in ship_sinking.js.
// AI (targeting, guns, torpedoes, strikes) lives in ships_ai.js as WW.shipAI.
window.WW = window.WW || {};
(function () {
  const TAU = Math.PI * 2;
  let nextId = 1;
  const SUB_DEPTH = -1.6;
  const SPACE = { carrier: 70, battleship: 45, cruiser: 42, destroyer: 30, pt: 12, submarine: 12 }; // personal space (centre to centre; BB / CA ~1.7 L, DD ~1.15 L: a screen keeps 2-3 L)
  // the largest personal-space radius (SPACE or the default 20): with the hull term, an upper bound of the separation
  // radius in Ship.move, for an early skip of far pairs (the other hull is taken as up to 100 units long: the longest
  // ship is Lexington at 28, an island airfield 40)
  const SEP_SPACE = Math.max(20, ...Object.values(SPACE)), SEP_OTHER_L = 100;
  const HEEL = { carrier: 0.045, battleship: 0.04, cruiser: 0.08, destroyer: 0.12, pt: 0.14, submarine: 0.07 }; // rad at full speed + full turn
  const EDGE_BAND = 30; // soft edge-avoidance band (units from the map boundary)
  const BAND = 0.35, HELM = 0.4; // turn rate is proportional below BAND rad of heading error; HELM s to full rudder

  const wreckShips = [];             // settled wrecks (not in WW.world.ships)
  if (WW.world && !WW.world.wrecks) WW.world.wrecks = []; // [{x, z, radius, top}]
  const nav = (x, z, d) => WW.shipNav.nav(x, z, d), wreckAt = (x, z) => WW.shipNav.wreckAt(x, z); // ships_nav.js
  function wrap(a) { a %= TAU; return a < 0 ? a + TAU : a; }

  class Ship {
    constructor(type, nation, x, z, heading, clsKey, flag) {
      // The 1942 class (ship_classes.js): forced by clsKey, a carrier's from its slot name, else WW.rand. It sets the
      // ship's true size, its model, its name and small stat differences from the type (per-nation torpedoes: core.js).
      let slot = 0;
      if (type === 'carrier') for (const o of WW.world.ships) if (o.nation === nation && o.hangar) slot++;
      const cls = WW.pickClass ? WW.pickClass(type, nation, clsKey, slot) : null;
      const st0 = WW.shipType ? WW.shipType(type, nation) : WW.SHIP_TYPES[type], st = cls ? WW.classStats(st0, cls) : st0;
      this.id = nextId++; this.type = type; this.stats = st; this.nation = nation;
      this.flag = flag || nation; // the hull's flag (WW.FLAGS): RN / FNFL hulls on the USN side (scenario.js)
      this.cls = cls; this.mk = cls ? cls.key : type; // mk: the model key (per-class geometry: crew stations, deck, parts)
      const R = type === 'carrier' && WW.CV_ROSTER ? WW.CV_ROSTER[nation] : null; // carriers: the slot's name (air_squadrons.js)
      // a forced class (tests, lineups) whose slot name belongs to another class takes one of its own names
      const slotName = R ? R[slot % R.length][0] : null;
      if (cls) this.name = WW.pickShipName(cls, nation, slotName && cls.names.indexOf(slotName) >= 0 ? slotName : null);
      this.x = x; this.z = z; this.heading = wrap(heading || 0); this.speed = 0;
      this.hp = this.maxHp = st.hp;
      this.speedK = 1; this.flood = 0; this.engineK = 1; this.engineT = 0; // damage slows ships (ship_speed.js)
      this.escapeEdge = 0; // -1 / +1: leaving the map over the west / east edge (endgame.js), no edge avoidance there
      this.alive = true; this.sinking = false; this.removed = false;
      this.submerged = type === 'submarine';
      this.model = WW.models.buildShip(type, this.flag, this.mk);   // the palette of the hull's flag (RN, FNFL; else the side's)
      this.group = this.model.group;
      this.ownKids = new Set(this.group.children); // the model's own parts (not flags / parked planes added later): ship_breakup.js
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
      }
      // the footprint beam (nav samples, collision capsule, lifeboats) is the class's, never the mesh's: art changes
      // must not change the sim. A carrier's is its flight deck width.
      this.beam = cls ? cls.navBeam : st.length / 7;
      this.hullPts = WW.shipNav.hullPoints(st.length, this.beam); // footprint samples (ships_nav.js)
      this.bowDepth = Math.max(WW.shipNav.HARD + 0.4, st.minDepth * 0.6); // planner: hull ends/sides keep this much water
      this.depthY = this.submerged ? SUB_DEPTH : 0;
      this.hangar = st.planes ? { fighter: st.planes.fighter, dive: st.planes.dive, torpedo: st.planes.torpedo } : null;
      if (this.hangar && WW.airBoss) this.hangar = WW.airBoss.group(this, this.hangar); // air group size (air_boss.js TUNE.wing)
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
      const list = WW.world.ships, rs = SPACE[this.type] || 20, sepR = Math.max(SEP_SPACE, (st.length + SEP_OTHER_L) * 0.6 + 4) + 1, sep2 = sepR * sepR;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === this || o.removed || !(o.alive || o.sinking) || (o.submerged !== this.submerged)) continue; // steer clear of sinking hulls too
        const qx = this.x - o.x, qz = this.z - o.z;
        if (qx * qx + qz * qz >= sep2) continue; // beyond any separation radius: no push (same result, cheaper)
        const hull = (st.length + o.stats.length) * 0.6 + 4; // a carrier's AA-ring escort may come inside its personal space (fleet_formation.js)
        const r = this.ringCv === o || o.ringCv === this ? hull : Math.max(rs, SPACE[o.type] || 20, hull);
        const ex = this.x - o.x, ez = this.z - o.z, d2 = ex * ex + ez * ez;
        if (d2 < r * r && d2 > 1e-4) {
          const d = Math.sqrt(d2), k = (r - d) / r, w = (k + k * k * 4) * (o.nation === this.nation ? 1.5 : 0.6);
          dx += (ex / d) * w; dz += (ez / d) * w;
        }
        if (o.alive && o.type !== 'pt' && this.type !== 'pt') { // closing on a collision course: turn away early (a ring escort and its carrier: inside the hull term only)
          const c = WW.shipNav.cpaPush(this, o, this.ringCv === o || o.ringCv === this ? hull * 1.25 : r); if (c) { dx += c[0]; dz += c[1]; }
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

      // Watchdog: dead in the water for 6 s with way ordered (pinned on a flat at minimum depth, nothing in the plan
      // moves it): back off astern, then come about toward the deepest water.
      this.deadT = this.speed < 0.3 && this.throttle > 0.4 && !(this.asternT > 0) && !(this.escapeT > 0) ? (this.deadT || 0) + dt : 0;
      if (this.deadT > 6) {
        this.deadT = 0; this.asternT = 2.5;
        let bd = -1e9;
        for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU, d = WW.terrain.depthAt(this.x + Math.cos(a) * 8, this.z + Math.sin(a) * 8); if (d > bd) { bd = d; this.escapeH = a; } }
        this.escapeT = 4; this.escHold = 0; this.escAstern = true;
      }
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
        // the open water is astern (a bow run into a blind inlet): back out along it rather than try to swing on the spot
        // (a cruiser pressing a target into a shoal pocket swung between two escapes for 100 s, sim_behaviour stuck)
        if (Math.abs(WW.angleDiff(this.heading, this.escapeH)) > 2.3) { this.asternT = 4; this.escAstern = true; }
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
      const sf = pivot ? 1.5 : WW.clamp(this.speed / (st.speed * Math.max(0.5, this.speedK)), 0.4, 1); // rudder bite: share of what she can make now
      const diff = WW.angleDiff(this.heading, this.navHeading);
      // Helm: rate ∝ heading error (full rate past BAND), and the rudder takes HELM s to swing hard over.
      let maxR = st.turn * sf;
      // combing a torpedo track / turning against a torpedo plane (ships_ai.js realHelm): her real tactical-diameter rate
      if (this.helmUntil > WW.time.now && this.helmR > 0) maxR = Math.min(maxR, Math.max(this.speed, 0.4 * st.speed) / this.helmR);
      const cmd = maxR * WW.clamp(diff / BAND, -1, 1);
      this.rudder += WW.clamp(cmd - this.rudder, -maxR * dt / HELM, maxR * dt / HELM);
      const turn = WW.clamp(this.rudder * dt, -maxR * dt, maxR * dt), h0 = this.heading;

      // Speed: slow down when the way ahead is short or the turn is large.
      const vk = (WW.shipSpeed ? WW.shipSpeed.k(this, dt) : 1) * (WW.weather ? WW.weather.seaSpeedK(this) : 1); // hull damage, flooding, engine room (ship_speed.js)
      const fk = WW.supply ? WW.supply.fuel(this, dt) : 1;   // a destroyer short of fuel keeps to economic speed (ship_supply.js)
      let ts = st.speed * vk * WW.clamp(Math.min(this.throttle, fk), 0, 1);
      if (this.clearAhead < this.lookDist * 0.6) ts *= WW.clamp(this.clearAhead / (this.lookDist * 0.6), 0.25, 1);
      if (Math.abs(diff) > 1.2) ts *= 0.6;
      if (pivot) ts = 0;
      const acc = st.speed * (ts > this.speed ? 0.12 : 0.25) * dt;
      this.speed += WW.clamp(ts - this.speed, -acc, acc);

      // Step, with hard guarantees: the centre never ends on a non-navigable cell and no hull sample
      // (bow, stern, beams) ends on water shallower than shipNav.HARD — full turn, half turn, astern, straight.
      const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, N = WW.shipNav, m = N.EDGE, x0 = this.x, z0 = this.z;
      // hull gate: clear of the shallows, or (already clipping) no worse than here. The current pose's hullMin is only
      // needed when a probe is shallow, so it is computed then, once (pure: the pose is unchanged until a probe succeeds)
      let cur;
      const hullOK = (x, z, h) => { const mm = N.hullMin(this, x, z, h); if (mm >= N.HARD) return true; if (cur === undefined) cur = N.hullMin(this, x0, z0, h0); return cur < N.HARD && mm >= cur - 1e-6; };
      // never drive deeper into a wreck / sinking hull: the overlap here (+1e-6, so > 0) is only needed when a probe overlaps
      let fo;
      const deeper = (x, z, h) => { const ov = N.fixedOverlap(this, x, z, h); if (!(ov > 0)) return false; if (fo === undefined) fo = N.fixedOverlap(this, x0, z0, h0) + 1e-6; return ov > fo; };
      const pose = (h, v) => {
        const nx = WW.clamp(this.x + Math.cos(h) * v, m, W - m), nz = WW.clamp(this.z + Math.sin(h) * v, m, H - m);
        if (!nav(nx, nz, md) || !hullOK(nx, nz, h) || deeper(nx, nz, h)) return false;
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
          if (px > m && px < W - m && pz > m && pz < H - m && WW.terrain.isNavigable(px, pz, md) && hullOK(px, pz, h0)) { this.x = px; this.z = pz; return; }
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
      // the old small bob on the sim's clock: the carrier deck's height (air_deck.js D.dy) still reads it, so it stays
      // in the sim's pose; ship_swell.js takes it back off in the drawn pose (the hull moves to the visible sea only)
      const by = Math.sin(t * 1.1 + this.bob) * amp * 0.5, bx = Math.sin(t * 0.8 + this.bob * 1.3) * amp * 0.25, bz = Math.sin(t * 0.9 + this.bob) * amp * 0.12;
      this.bobY = by; this.bobX = bx; this.bobZ = bz;
      g.position.set(this.x, this.depthY + by, this.z);
      // one Euler.set: the quaternion is rebuilt once per call, not once per axis (same final values)
      const jt = t - (this.joltAt === undefined ? -9 : this.joltAt), jo = jt >= 0 && jt < 1 ? this.joltA * Math.exp(-5 * jt) * Math.sin(jt * 38) : 0;   // a torpedo hit's shudder (damage.js; visual)
      g.rotation.set(bx + this.heel + this.listRoll + this.cripList() + jo, -this.heading, bz + jo * 0.4);
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
          // at periscope depth with an enemy ship within 110 (checked every 1 s): the periscope's feather, a thin
          // white streak a little ahead of the hull's swirl (visual only)
          this.periT = (this.periT || 0) - 0.3;
          if (this.periT <= 0) { this.periT = 1; this.peri = WW.world.ships.some(o => o.alive && o.nation !== this.nation && !o.submerged && WW.dist2(o.x, o.z, this.x, this.z) < 12100); }
          this.wakeT = this.peri ? 0.12 : 0.3;
          const p = this.toWorld(st.length * 0.1, 0);
          fx.wake(p[0], p[1], this.heading, 0.4);
          if (this.peri) { const q = this.toWorld(st.length * 0.3, 0); fx.wake(q[0], q[1], this.heading, 0.3); }
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
      if (WW.shipSpeed) WW.shipSpeed.hit(this, amount, kind, cal, hx, hz);         // flooding, engine room (sim: WW.rand)
      if (WW.shipFires) WW.shipFires.hit(this, amount, kind, cal, hx, hz); // fires, a loaded flight deck (ship_fires.js)
      if (WW.damage) WW.damage.hit(this, amount, hx, hz, kind, cal);
      if (!this.alive) return; // a magazine or the deck already sent her down (ship_fires.js)
      if (this.hp <= 0) { this.hp = 0; this.sinkCause = { kind, cal, x: hx, z: hz }; this.startSinking(); return; } // the fatal hit (ship_breakup.js)
      this.applyLook();
    }

    // startSinking / updateSinking / becomeWreck / updateWreck: ship_sinking.js (run-on, drift, settling, wreck)

    remove() {
      if (this.removed) return;
      this.removed = true; this.sinking = false; this.alive = false; this.dmgSites.length = 0;
      if (WW.scene) WW.scene.remove(this.group);
      if (this.broken && WW.shipBreakup) WW.shipBreakup.drop(this); // the stern half and its clipped materials
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
    _wreckShips: wreckShips, // settled wrecks (ship_sinking.js becomeWreck)
    init() {},
    spawn(type, nation, x, z, heading, cls, flag) { // cls: optional class key (ship_classes.js), else picked; flag: WW.FLAGS key
      const md = WW.SHIP_TYPES[type].minDepth;
      if (!nav(x, z, md)) { // nudge to the nearest navigable point (spiral search)
        outer: for (let r = 2; r <= 80; r += 2) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
            if (nav(px, pz, md)) { x = px; z = pz; break outer; }
          }
        }
      }
      if (heading === undefined) heading = WW.sideSpec(nation).heading;
      const s = new Ship(type, nation, x, z, heading, cls, flag);
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
      if (WW.resetShipNames) WW.resetShipNames();
      nextId = 1; // ids feed sim maths (ships_ai jink phase): same ids every round for a seeded replay
      if (WW.world.wrecks) WW.world.wrecks.length = 0; else WW.world.wrecks = [];
      if (WW.damage) WW.damage.clearAll();
    }
  };
})();
