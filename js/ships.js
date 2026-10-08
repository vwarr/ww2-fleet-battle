// ships.js — owner C. WW.Ship (movement, navigation, damage, sinking) + WW.ships.
// AI (targeting, guns, torpedoes, strikes) lives in ships_ai.js as WW.shipAI.
window.WW = window.WW || {};
(function () {
  const TAU = Math.PI * 2;
  let nextId = 1;
  // Candidate steering offsets (radians) around the wanted heading.
  const OFFS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.15, -1.15, 1.6, -1.6, 2.2, -2.2, Math.PI];
  const SUB_DEPTH = -1.6;

  const wreckShips = [];             // settled wrecks (not in WW.world.ships)
  let wreckCol = null;
  if (WW.world && !WW.world.wrecks) WW.world.wrecks = []; // [{x, z, radius, top}]
  // Wreck whose top is above water and covers (x, z), or null.
  function wreckAt(x, z) {
    const w = WW.world.wrecks || [];
    for (let i = 0; i < w.length; i++) {
      const o = w[i], dx = x - o.x, dz = z - o.z;
      if (o.top > 0.2 && dx * dx + dz * dz < o.radius * o.radius) return o;
    }
    return null;
  }
  function nav(x, z, d) { return WW.terrain.isNavigable(x, z, d) && !((WW.world.wrecks || []).length && wreckAt(x, z)); }
  function wrap(a) { a %= TAU; return a < 0 ? a + TAU : a; }

  class Ship {
    constructor(type, nation, x, z, heading) {
      const st = WW.SHIP_TYPES[type];
      this.id = nextId++; this.type = type; this.stats = st; this.nation = nation;
      this.x = x; this.z = z; this.heading = wrap(heading || 0); this.speed = 0;
      this.hp = this.maxHp = st.hp;
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
      this.navHeading = this.heading; this.navT = 0; this.clearAhead = 99; this.turnRate = 0;
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
      this.depthY = this.submerged ? SUB_DEPTH : 0;
      this.hangar = st.planes ? { fighter: st.planes.fighter, dive: st.planes.dive, torpedo: st.planes.torpedo } : null;
      this.baseColors = this.model.hullMats.map(m => (m.color ? m.color.clone() : null));
      if (type === 'submarine') this.model.hullMats.forEach(m => { m.transparent = true; });
      this.applyLook();
      this.syncGroup(0);
    }

    // Local (bow +x) → world offset.
    toWorld(lx, lz) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      return [this.x + lx * c - lz * s, this.z + lx * s + lz * c];
    }

    // Look-ahead: how far along heading h the water stays navigable.
    clearance(h) {
      const md = this.stats.minDepth + 0.6, look = this.lookDist, step = Math.max(2.5, look / 12); // plan with a margin
      const c = Math.cos(h), s = Math.sin(h);
      if (!nav(this.x + c, this.z + s, md)) return 1;
      if (!nav(this.x + c * 2.5, this.z + s * 2.5, md)) return 2.5;
      for (let d = Math.max(4, this.stats.length * 0.5); d <= look; d += step) {
        if (!nav(this.x + c * d, this.z + s * d, md)) return d;
      }
      return look + step;
    }

    planNav(want) {
      const look = this.lookDist;
      this.clearAhead = this.clearance(this.heading);
      let best = want, bestScore = -1e9;
      for (let i = 0; i < OFFS.length; i++) {
        const h = want + OFFS[i];
        const c = this.clearance(h);
        const score = (c >= look ? 1.2 : c / look) * 4 - Math.abs(OFFS[i]) * 0.7
          - Math.abs(WW.angleDiff(this.heading, h)) * 0.3;
        if (score > bestScore) { bestScore = score; best = h; }
        if (i === 0 && c >= look) break; // straight line is clear
      }
      this.navHeading = wrap(best);
    }

    move(dt) {
      const st = this.stats, md = st.minDepth;
      // Wanted direction plus light separation from nearby ships.
      let dx = Math.cos(this.desiredHeading), dz = Math.sin(this.desiredHeading);
      const list = WW.world.ships;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === this || !o.alive || (o.submerged !== this.submerged)) continue;
        const r = (st.length + o.stats.length) * 0.6 + 4;
        const ex = this.x - o.x, ez = this.z - o.z, d2 = ex * ex + ez * ez;
        if (d2 < r * r && d2 > 1e-4) {
          const d = Math.sqrt(d2), w = ((r - d) / r) * (o.nation === this.nation ? 1.2 : 0.8);
          dx += (ex / d) * w; dz += (ez / d) * w;
        }
      }
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
          const a = (k / 16) * TAU, d = WW.terrain.depthAt(this.x + Math.cos(a) * 7, this.z + Math.sin(a) * 7);
          if (d > bd) { bd = d; this.escapeH = a; }
        }
        this.escapeT = 3;
      }
      if (this.escapeT > 0) { this.escapeT -= dt; this.navHeading = this.escapeH; this.navT = 0.3; pivot = false; this.pivotT = 0; }
      const sf = pivot ? 1.5 : WW.clamp(this.speed / st.speed, 0.4, 1);
      const diff = WW.angleDiff(this.heading, this.navHeading);
      const maxT = st.turn * sf * dt;
      const turn = WW.clamp(diff, -maxT, maxT);
      this.heading = wrap(this.heading + turn);
      this.turnRate = dt > 0 ? turn / dt : 0;

      // Speed: slow down when the way ahead is short or the turn is large.
      let ts = st.speed * WW.clamp(this.throttle, 0, 1);
      if (this.clearAhead < this.lookDist * 0.6) ts *= WW.clamp(this.clearAhead / (this.lookDist * 0.6), 0.25, 1);
      if (Math.abs(diff) > 1.2) ts *= 0.6;
      if (pivot) ts = 0;
      const acc = st.speed * (ts > this.speed ? 0.12 : 0.25) * dt;
      this.speed += WW.clamp(ts - this.speed, -acc, acc);

      // Step, with a hard guarantee: never end on a non-navigable cell.
      const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, m = 3;
      const nx = WW.clamp(this.x + Math.cos(this.heading) * this.speed * dt, m, W - m);
      const nz = WW.clamp(this.z + Math.sin(this.heading) * this.speed * dt, m, H - m);
      if (nav(nx, nz, md)) { this.x = nx; this.z = nz; this.blockedT = 0; return; }
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
            const d = Math.abs(WW.angleDiff(this.navHeading, h));
            if (d < bd) { bd = d; bh = h; }
          }
          if (bh !== null) { this.navHeading = bh; this.navT = 1.5; }
        } else if (this.navT > 1.5 || this.navT <= 0) this.navT = 0;
        const dd = WW.angleDiff(this.heading, this.navHeading);
        this.heading = wrap(this.heading + WW.clamp(dd, -st.turn * dt * 3, st.turn * dt * 3));
        return;
      }
      // Already on bad water (bad spawn, or a wreck settled on us).
      const v = Math.max(1.5, this.speed) * dt, wk = wreckAt(this.x, this.z);
      if (wk && WW.terrain.isNavigable(this.x, this.z, md)) {
        // Back away from the wreck along the most outward direction that keeps terrain depth.
        const out = Math.atan2(this.z - wk.z, this.x - wk.x);
        for (let k = 0; k < 13; k++) {
          const a = out + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
          const px = this.x + Math.cos(a) * v, pz = this.z + Math.sin(a) * v;
          if (px > m && px < W - m && pz > m && pz < H - m && WW.terrain.isNavigable(px, pz, md)) { this.x = px; this.z = pz; return; }
        }
        return; // boxed in: hold position (still on valid terrain)
      }
      let bx = 0, bz = 0, bd = -1e9;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU, d = WW.terrain.depthAt(this.x + Math.cos(a) * 5, this.z + Math.sin(a) * 5);
        if (d > bd) { bd = d; bx = Math.cos(a); bz = Math.sin(a); }
      }
      this.x = WW.clamp(this.x + bx * v, m, W - m); this.z = WW.clamp(this.z + bz * v, m, H - m);
    }

    updateDepth(dt) {
      if (this.type !== 'submarine') return;
      const tgt = this.wantSurface ? 0 : SUB_DEPTH;
      this.depthY += WW.clamp(tgt - this.depthY, -0.5 * dt, 0.5 * dt);
      this.submerged = this.depthY < SUB_DEPTH * 0.45;
      const op = WW.lerp(1, 0.35, this.depthY / SUB_DEPTH);
      this.model.hullMats.forEach(mt => { mt.opacity = op; });
    }

    syncGroup(t) {
      const g = this.group, amp = 0.35 / Math.sqrt(this.stats.length);
      g.position.set(this.x, this.depthY + Math.sin(t * 1.1 + this.bob) * amp * 0.5, this.z);
      g.rotation.y = -this.heading;
      g.rotation.x = Math.sin(t * 0.8 + this.bob * 1.3) * amp * 0.25 + this.turnRate * 0.25 + this.listRoll;
      g.rotation.z = Math.sin(t * 0.9 + this.bob) * amp * 0.12;
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
          fx.wake(p[0], p[1], this.heading, WW.clamp(st.length / 10, 0.4, 2.5) * (0.4 + 0.6 * this.speed / st.speed));
        }
      }
      const f = this.hp / this.maxHp;
      if (f >= 0.6) return;
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = (f < 0.35 ? 0.18 : 0.3) * (this.dmgSites.length ? 2 : 1) * (WW.damage ? WW.damage.load() : 1);
        const stacks = this.model.stacks || [];
        if (stacks.length) {
          this.group.updateMatrixWorld(true);
          for (const sObj of stacks) { sObj.getWorldPosition(WW._v3 || (WW._v3 = new THREE.Vector3())); fx.smoke(WW._v3.x, WW._v3.y, WW._v3.z, f < 0.35, 1 + st.length / 20); }
        } else fx.smoke(this.x, 2, this.z, f < 0.35, 1);
      }
    }

    applyLook() {
      const f = WW.clamp(this.hp / this.maxHp, 0, 1), dark = 1 - (1 - f) * 0.45;
      this.model.hullMats.forEach((m, i) => { if (m.color && this.baseColors[i]) m.color.copy(this.baseColors[i]).multiplyScalar(dark); });
    }

    // kind ('shell'|'torpedo'|'bomb'|'dc') and cal are optional: WW.damage turns the hit into a local fire/smoke site.
    takeDamage(amount, hx, hz, kind, cal) {
      if (!this.alive) return;
      this.hp -= amount;
      if (WW.damage) WW.damage.hit(this, amount, hx, hz, kind, cal);
      if (this.hp <= 0) { this.hp = 0; this.startSinking(); return; }
      this.applyLook();
    }

    startSinking() {
      this.alive = false; this.sinking = true; this.sinkT = 0; this.target = null; this.startY = this.depthY;
      if (Math.abs(this.listRoll) > 0.02) this.sinkRoll = Math.sign(this.listRoll) * Math.abs(this.sinkRoll);
      const L = this.stats.length;
      // Drift toward nearby shallows (if any) so wrecks often ground where they stay visible.
      let bd = WW.terrain.depthAt(this.x, this.z) - 2, bh;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        for (const r of [10, 18, 26]) {
          const d = WW.terrain.depthAt(this.x + Math.cos(a) * r, this.z + Math.sin(a) * r);
          if (d > 0.8 && d < bd) { bd = d; bh = a; }
        }
      }
      if (bh !== undefined) { this.driftH = bh; this.speed = Math.max(this.speed, 3); }
      WW.fx.explosion(this.x, 2 + this.depthY, this.z, WW.clamp(L / 5, 1.5, 5));
      WW.fx.oilSlick(this.x, this.z, L * 0.5);
      WW.stats.shipsSunk++;
      WW.emit('shipSunk', this);
    }

    updateSinking(dt) {
      this.sinkT += dt;
      const L = this.stats.length, k = Math.min(1, this.sinkT / 8), g = this.group;
      this.speed = Math.max(0, this.speed - dt * 0.7);
      if (this.driftH !== undefined) this.heading += WW.clamp(WW.angleDiff(this.heading, this.driftH), -0.3 * dt, 0.3 * dt);
      const nx = this.x + Math.cos(this.heading) * this.speed * dt, nz = this.z + Math.sin(this.heading) * this.speed * dt;
      if (WW.terrain.isNavigable(nx, nz, Math.max(1.2, L * 0.1))) { this.x = nx; this.z = nz; } else this.speed = 0; // grounded
      // Ease down to rest on the seabed (shallow water leaves the upperworks above the surface).
      // Model heights (~3-5) are less than navigable depth, so in moderately shallow water the wreck
      // rests with one end on the seabed and the other end raised clear of the surface.
      const D = Math.max(0, WW.terrain.depthAt(this.x, this.z));
      const flatY = Math.min(-1, -D - this.hullBot * 0.8);
      // In shallow water one end rests on the seabed and the other end rears clear of the surface.
      const want = WW.clamp(L * 0.2, 1.6, 5);             // how far the raised end should show
      let roll = this.sinkRoll, sn = (want - flatY - this.hullTop * 0.85) / L;
      if (sn > 0.5) sn = 0;                               // too deep: settle flat on the bottom
      else { sn = WW.clamp(sn, 0.24, 0.5); roll *= 0.6; } // clearly tilted: reads as a wreck, not a ship
      const th = Math.asin(sn) * Math.sign(this.sinkPitch || 1);
      this.restY = flatY + L * 0.5 * sn;
      this.restTop = flatY + this.hullTop * Math.cos(roll) + L * sn;
      g.position.set(this.x, WW.lerp(this.startY, this.restY, k * k), this.z);
      g.rotation.y = -this.heading;
      g.rotation.x = WW.lerp(this.listRoll, roll, Math.min(1, this.sinkT / 4));
      g.rotation.z = WW.lerp(this.sinkPitch, th || this.sinkPitch, k) * k;
      if (!wreckCol) wreckCol = new THREE.Color(0x7a5a44); // rust: stays visible under the water
      this.model.hullMats.forEach((m, i) => {
        if (m.color && this.baseColors[i]) m.color.copy(this.baseColors[i]).multiplyScalar(0.7).lerp(wreckCol, k * 0.75);
        if (this.type === 'submarine') m.opacity = Math.max(m.opacity, k);
      });
      this.boomT -= dt;
      if (this.boomT <= 0 && this.sinkT < 5) {
        this.boomT = WW.randRange(0.6, 1.4);
        const p = this.toWorld(WW.randRange(-L * 0.4, L * 0.4), 0);
        WW.fx.explosion(p[0], 1, p[1], WW.clamp(L / 9, 0.8, 2.5));
      }
      if (this.sinkT < 6 && !this.dmgSites.length) { // damaged ships burn at their hit sites (WW.damage)
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = 0.12;
          const p = this.toWorld(WW.randRange(-L * 0.3, L * 0.3), 0);
          WW.fx.fire(p[0], 0.8, p[1]);
          if (WW.rand() < 0.4) WW.fx.smoke(p[0], 2, p[1], true, 1.5);
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
        this.smokeT = WW.randRange(0.6, 1.2) * (this.dmgSites.length ? 2.5 : 1); // lighter when hit sites smoke too
        WW.fx.smoke(this.x + WW.randRange(-1, 1), Math.max(0.5, Math.min(this.wreckInfo.top, 4)), this.z + WW.randRange(-1, 1), true, 0.5);
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
        s.effects(dt);
        s.updateDepth(dt);
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
      if (WW.world.wrecks) WW.world.wrecks.length = 0; else WW.world.wrecks = [];
      if (WW.damage) WW.damage.clearAll();
    }
  };
})();
