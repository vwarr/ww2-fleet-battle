// aircraft.js — owner C. Carrier planes (WW.air): take-off, transit, attack,
// dogfights, return, landing, rearm, shoot-down and ditching.
window.WW = window.WW || {};
(function () {
  const pool = {};            // kind+nation -> [model]
  const tracers = [];         // pooled THREE.Line
  let tracerIdx = 0, v3 = null;
  const REARM = 10;
  const PLANE_SCALE = 1.7;    // arcade scale: planes read clearly at the battle camera distance
  const DECK_Y = 0.75;        // fuselage centre above the flight deck (scaled model)
  let shadowGeo = null, shadowMat = null;

  function getModel(kind, nation) {
    const k = kind + nation, p = pool[k];
    let m;
    if (p && p.length) m = p.pop();
    else {
      m = WW.models.buildPlane(kind, nation); m.key = k; m.group.rotation.order = 'YZX';
      m.group.scale.setScalar(PLANE_SCALE);
      if (!shadowGeo) {
        const sp = new THREE.Shape(), P = [[1.3, 0.2], [0.65, 0.2], [0.65, 1.4], [0.05, 1.4], [0.05, 0.2], [-0.9, 0.15], [-0.9, 0.5], [-1.25, 0.5],
          [-1.25, -0.5], [-0.9, -0.5], [-0.9, -0.15], [0.05, -0.2], [0.05, -1.4], [0.65, -1.4], [0.65, -0.2], [1.3, -0.2]];
        P.forEach((q, i) => (i ? sp.lineTo(q[0], q[1]) : sp.moveTo(q[0], q[1])));
        shadowGeo = new THREE.ShapeGeometry(sp); shadowGeo.rotateX(-Math.PI / 2); // plane silhouette (symmetric), facing up, lying flat
        shadowMat = new THREE.MeshBasicMaterial({ color: 0x041018, transparent: true, opacity: 0.38, depthWrite: false });
      }
      m.shadow = new THREE.Mesh(shadowGeo, shadowMat); m.shadow.renderOrder = 2;
      m.shadow.rotation.order = 'YXZ';
    }
    if (WW.scene) { WW.scene.add(m.group); WW.scene.add(m.shadow); }
    return m;
  }
  function release(m) { if (WW.scene) { WW.scene.remove(m.group); WW.scene.remove(m.shadow); } (pool[m.key] = pool[m.key] || []).push(m); }

  function deckInfo(c) {
    if (!v3) v3 = new THREE.Vector3();
    if (c.model.deck) { c.group.updateMatrixWorld(true); c.model.deck.getWorldPosition(v3); return { x: v3.x, y: Math.max(1, v3.y), z: v3.z }; }
    return { x: c.x, y: 3, z: c.z };
  }

  function tracer(a, b) {
    if (!tracers.length) return;
    const ln = tracers[tracerIdx++ % tracers.length], pos = ln.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x + WW.randRange(-0.8, 0.8), b.y, b.z + WW.randRange(-0.8, 0.8));
    pos.needsUpdate = true; ln.geometry.computeBoundingSphere(); ln.visible = true; ln.life = 0.09;
  }

  class Plane {
    constructor(kind, nation, carrier, target, m) {
      this.kind = kind; this.nation = nation; this.carrier = carrier; this.target = target || null;
      this.model = m; this.group = m.group; this.prop = m.prop;
      this.pt = WW.PLANE_TYPES[kind]; this.hp = this.maxHp = this.pt.hp; this.trailT = 0; this.hitFxT = 0; this.crippled = false; this.alive = true; this.state = 'takeoff';
      const dk = deckInfo(carrier), L = carrier.stats.length, c = Math.cos(carrier.heading), s = Math.sin(carrier.heading);
      this.deckY = dk.y;
      this.x = dk.x - c * L * 0.38; this.z = dk.z - s * L * 0.38; this.y = dk.y + DECK_Y;
      this.heading = carrier.heading; this.speed = carrier.speed; this.vy = 0; this.turn = 0; this.roll = 0;
      this.t = 0; this.fuel = (this.pt.range / this.pt.speed) * 6; this.ordnance = kind !== 'fighter';
      this.foe = null; this.burstT = 0; this.scanT = 0; this.smokeT = 0; this.waveOffs = 0;
      this.phase = null; this.phaseT = 0; this.spin = 0; this.removed = false; this.lx = 0;
      this.payload = m.payload || null;
      if (this.payload) this.payload.visible = this.ordnance; // rearmed on the carrier
      this.sync(0);
    }

    damage(amount) {
      if (!this.alive) return;
      this.hp -= amount;
      if (this.hitFxT <= this.t) { // throttled hit flash: sparks + a puff of debris smoke at the airframe
        this.hitFxT = this.t + 0.18;
        WW.fx.sparks(this.x, this.y, this.z);
        if (Math.random() < 0.5) WW.fx.smoke(this.x, this.y, this.z, true, 0.35);
      }
      if (this.hp <= 0) { this.shotDown(); return; }
      // Badly hit: jettison the payload and turn for home (not mid-dive / mid-run).
      if (!this.crippled && this.hp < this.maxHp * 0.35 && (this.state === 'transit' || this.state === 'attack') && !this.phase) {
        this.crippled = true;
        if (WW.rand() < 0.6) {
          if (this.ordnance) { this.dropped(); WW.fx.splash(this.x, this.z, 0.8); }
          this.state = 'return'; this.foe = null;
        }
      }
    }
    // Damage trail from the engine: thin grey < 70% hp, thick black + flames < 40%, burning when falling.
    trail(dt, falling) {
      const f = this.hp / this.maxHp;
      if (!falling && f >= 0.7) return;
      const heavy = falling || f < 0.4, ld = WW.damage ? WW.damage.load() : 1, fx = WW.fx;
      const n = 1.25 * PLANE_SCALE, c = Math.cos(this.heading), sn = Math.sin(this.heading);
      const nx = this.x + c * n * 0.6, nz = this.z + sn * n * 0.6;
      this.flameT = (this.flameT || 0) - dt; // flickering flames at the engine (fire puffs trail behind fast planes, so keep them sparse)
      if (heavy && this.flameT <= 0) { this.flameT = falling ? 0.06 : 0.16; fx.fire(nx, this.y + 0.1, nz); }
      const iv = falling ? 0.07 : heavy ? 0.08 : 0.11;
      if (WW.damage) WW.damage.want(1 / iv);
      this.trailT -= dt;
      if (this.trailT > 0) return;
      this.trailT = iv * Math.min(3, ld);
      fx.smoke(nx - c * 0.8, this.y + 0.1, nz - sn * 0.8, heavy, falling ? 0.9 : heavy ? 0.75 : 0.42);
    }
    shotDown() {
      this.alive = false; this.state = 'falling'; WW.stats.planesLost++;
      WW.fx.explosion(this.x, this.y, this.z, 0.6);
      this.spin = (WW.rand() < 0.5 ? -1 : 1) * WW.randRange(1.5, 3); this.vy = Math.min(this.vy, -1);
    }
    ditch() {
      if (!this.alive) return;
      this.alive = false; this.state = 'ditch'; WW.stats.planesLost++;
    }

    turnTo(want, dt, rate) {
      const d = WW.angleDiff(this.heading, want), tr = WW.clamp(d, -rate * dt, rate * dt);
      this.heading += tr; this.turn = dt > 0 ? tr / dt : 0;
      return d;
    }
    climbTo(alt, dt, maxV) {
      const tv = WW.clamp((alt - this.y) * 0.8, -(maxV || 7), maxV || 7);
      this.vy += WW.clamp(tv - this.vy, -10 * dt, 10 * dt);
    }
    speedTo(v, dt) { this.speed += WW.clamp(v - this.speed, -10 * dt, 8 * dt); }
    fly(px, pz, alt, dt, spd, rate) {
      const d = this.turnTo(Math.atan2(pz - this.z, px - this.x), dt, rate || 1.1);
      this.climbTo(alt, dt); this.speedTo(spd || this.pt.speed, dt);
      return d;
    }
    dropped() { this.ordnance = false; if (this.payload) this.payload.visible = false; }
    hd(o) { return WW.dist(this.x, this.z, o.x, o.z); }
    validTarget() {
      const t = this.target;
      if (t && t.alive && !t.submerged) return t;
      this.target = WW.shipAI ? WW.shipAI.pickStrikeTarget(this) : null;
      return this.target;
    }

    update(dt) {
      this.t += dt;
      const fx = WW.fx;
      if (this.state === 'falling') {
        this.vy -= 9 * dt; this.heading += this.spin * dt; this.turn = this.spin * 2; this.speed *= 1 - 0.3 * dt;
        this.trail(dt, true);
        this.integrate(dt, true);
        if (this.y <= 0) { fx.splash(this.x, this.z, 1.6); fx.explosion(this.x, 0.3, this.z, 0.6); this.remove(); }
        return;
      }
      if (this.state === 'ditch') {
        this.vy += WW.clamp(-3 - this.vy, -4 * dt, 4 * dt); this.speed = Math.max(8, this.speed - 4 * dt); this.turn = 0;
        this.integrate(dt, true);
        if (this.y <= 0.3) { fx.splash(this.x, this.z, 1); this.remove(); }
        return;
      }
      const c = this.carrier;
      if (!c.alive) { if (this.state === 'rollout' || this.state === 'takeoff') { this.ditch(); this.vy = -2; } else this.ditch(); return; }
      if (this.state === 'transit' || this.state === 'attack') {
        this.fuel -= dt;
        if (this.fuel <= 0) this.state = 'return';
      }
      switch (this.state) {
        case 'takeoff': this.takeoff(dt); break;
        case 'transit': case 'attack':
          if (this.kind === 'fighter') this.fighter(dt);
          else if (this.kind === 'dive') this.diveBomber(dt);
          else this.torpBomber(dt);
          break;
        case 'return': this.goHome(dt); break;
        case 'landing': this.landing(dt); break;
        case 'rollout': this.rollout(dt); return;
      }
      this.trail(dt, false);
      this.integrate(dt, false);
    }

    integrate(dt, free) {
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.z += Math.sin(this.heading) * this.speed * dt;
      this.y += this.vy * dt;
      if (!free && this.state !== 'takeoff' && this.state !== 'landing' && this.y < 1.5) { this.y = 1.5; this.vy = Math.max(0, this.vy); }
      this.sync(dt);
    }

    sync(dt) {
      const g = this.group;
      g.position.set(this.x, this.y, this.z);
      g.rotation.y = -this.heading;
      g.rotation.z = Math.atan2(this.vy, Math.max(1, this.speed));
      this.roll += (WW.clamp(this.turn * 0.7, -1.2, 1.2) - this.roll) * Math.min(1, dt * 4);
      const f = this.hp / this.maxHp; // a badly damaged plane wobbles (visual only)
      g.rotation.x = this.roll + (f < 0.4 && this.alive && this.state !== 'rollout' ? Math.sin(this.t * 7.3) * 0.12 + Math.sin(this.t * 3.1) * 0.08 : 0);
      const sh = this.model.shadow;
      if (sh) { // dark blob on the water below the plane; hidden over the deck and while falling
        const over = this.state === 'takeoff' || this.state === 'rollout' || this.state === 'landing' && this.y < this.deckY + 3;
        sh.visible = !over && this.y > 0.5;
        const k = WW.clamp(1.25 - this.y / 60, 0.55, 1.2) * PLANE_SCALE * 0.55;
        const so = Math.min(4, this.y * 0.12); // sun is high in the west-north-west
        sh.position.set(this.x + so, 0.32, this.z - so * 0.6); sh.rotation.y = -this.heading; sh.scale.set(k, 1, k * 0.95);
      }
      if (this.prop) this.prop.rotation.x += dt * 45;
    }

    takeoff(dt) {
      const c = this.carrier, dk = deckInfo(c);
      this.deckY = dk.y; this.heading = c.heading; this.turn = 0;
      this.speedTo(this.pt.speed * 0.8, dt);
      if (this.t < 2.2) { this.y = dk.y + DECK_Y; this.vy = 0; }
      else this.vy += WW.clamp(5 - this.vy, -6 * dt, 6 * dt);
      if (this.y > dk.y + 10) this.state = 'transit';
    }

    fighter(dt) {
      const c = this.carrier;
      this.scanT -= dt; this.burstT -= dt;
      if (this.foe && !this.foe.alive) this.foe = null;
      if (this.scanT <= 0) {
        this.scanT = 0.4;
        const cx = this.target ? this.x : c.x, cz = this.target ? this.z : c.z, R = this.target ? 90 : 140;
        let best = null, bd = R;
        for (const p of WW.world.planes) {
          if (!p.alive || p.nation === this.nation) continue;
          const d = WW.dist(cx, cz, p.x, p.z);
          if (d < bd) { bd = d; best = p; }
        }
        this.foe = best;
      }
      const f = this.foe;
      if (f) {
        this.state = 'attack';
        const tt = Math.min(1, this.hd(f) / 60);
        const px = f.x + Math.cos(f.heading) * f.speed * tt, pz = f.z + Math.sin(f.heading) * f.speed * tt;
        const d = this.fly(px, pz, f.y, dt, this.pt.speed * 1.1, 1.7);
        const d3 = Math.hypot(f.x - this.x, f.y - this.y, f.z - this.z);
        if (d3 < 12 && Math.abs(d) < 0.35 && this.burstT <= 0) {
          this.burstT = 0.7; tracer(this, f);
          if (WW.rand() < 0.65) { f.damage(5); WW.fx.sparks(f.x, f.y, f.z); }
        }
        return;
      }
      this.state = 'transit';
      const t = this.target ? this.validTarget() : null;
      if (this.target === null && this.t > 1 && this.wasEscort) { this.state = 'return'; return; }
      if (t) {
        this.wasEscort = true;
        // Escort: stay with the nearest friendly bomber of this carrier, else orbit the target.
        let lead = null, bd = 1e9;
        for (const p of WW.world.planes) {
          if (!p.alive || p.carrier !== c || p.kind === 'fighter' || !p.ordnance) continue;
          const d = this.hd(p); if (d < bd) { bd = d; lead = p; }
        }
        if (lead) { this.fly(lead.x - Math.cos(lead.heading) * 6, lead.z - Math.sin(lead.heading) * 6, Math.max(lead.y + 5, 12), dt, bd > 15 ? this.pt.speed : lead.speed + 2); return; }
        if (this.t > 25) { this.state = 'return'; return; }
        this.orbit(t.x, t.z, 35, 32, dt);
        return;
      }
      this.orbit(c.x, c.z, 35, 28, dt); // CAP
    }

    orbit(cx, cz, r, alt, dt) {
      const a = Math.atan2(this.z - cz, this.x - cx) + 0.5;
      this.fly(cx + Math.cos(a) * r, cz + Math.sin(a) * r, alt, dt, this.pt.speed * 0.85);
    }

    diveBomber(dt) {
      const t = this.validTarget();
      if (!t && this.phase !== 'pull') { this.state = 'return'; return; }
      if (this.phase === 'pull') {
        this.climbTo(25, dt, 9); this.speedTo(this.pt.speed, dt); this.turn = 0;
        if (this.y > 15) { this.state = 'return'; this.phase = null; }
        return;
      }
      const dh = this.hd(t);
      if (this.phase === 'dive') {
        const tt = this.y / 40, px = t.x + Math.cos(t.heading) * t.speed * tt, pz = t.z + Math.sin(t.heading) * t.speed * tt;
        const dx = px - this.x, dz = pz - this.z, dy = 1 - this.y, len = Math.hypot(dx, dy, dz) || 1, v = 42;
        this.turnTo(Math.atan2(dz, dx), dt, 3);
        this.speed = (Math.hypot(dx, dz) / len) * v; this.vy = (dy / len) * v;
        if (this.y < 9) { WW.combat.dropBomb(this, t); this.dropped(); this.phase = 'pull'; }
        return;
      }
      this.state = dh < 80 ? 'attack' : 'transit';
      const d = this.fly(t.x, t.z, 38, dt, this.pt.speed);
      if (dh < 24 && Math.abs(d) < 0.4 && this.y > 28) this.phase = 'dive';
    }

    torpBomber(dt) {
      const t = this.validTarget();
      if (!t && this.phase !== 'out') { this.state = 'return'; return; }
      this.phaseT -= dt;
      if (this.phase === 'out') {
        this.climbTo(20, dt); this.speedTo(this.pt.speed, dt); this.turn = 0;
        if (this.phaseT <= 0) { this.state = 'return'; this.phase = null; }
        return;
      }
      if (this.phase === 'reset') {
        this.climbTo(12, dt); this.turnTo(Math.atan2(this.z - t.z, this.x - t.x), dt, 1.1);
        if (this.phaseT <= 0) this.phase = 'run';
        return;
      }
      const dh = this.hd(t);
      if (this.phase !== 'run') {
        this.state = 'transit';
        this.fly(t.x, t.z, 22, dt, this.pt.speed);
        if (dh < 110) this.phase = 'run';
        return;
      }
      this.state = 'attack';
      const tt = dh / WW.TORPEDO.speed;
      const px = t.x + Math.cos(t.heading) * t.speed * tt, pz = t.z + Math.sin(t.heading) * t.speed * tt;
      const d = this.fly(px, pz, dh < 70 ? 2 : 10, dt, this.pt.speed, 1.2);
      if (dh < 45 && this.y < 4 && Math.abs(d) < 0.25) {
        WW.combat.fireTorpedo(this, this.x + Math.cos(this.heading), this.z + Math.sin(this.heading), this.heading, this.nation, 70);
        this.dropped(); this.phase = 'out'; this.phaseT = 4;
      } else if (dh < 18) { this.phase = 'reset'; this.phaseT = 6; }
    }

    goHome(dt) {
      const c = this.carrier, dk = deckInfo(c), L = c.stats.length, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      this.foe = null;
      const ex = dk.x - ch * (L * 0.5 + 35), ez = dk.z - sh * (L * 0.5 + 35);
      const de = WW.dist(this.x, this.z, ex, ez);
      this.fly(ex, ez, de > 80 ? 25 : 10, dt, this.pt.speed);
      if (de < 10) this.state = 'landing';
    }

    landing(dt) {
      const c = this.carrier, dk = deckInfo(c), L = c.stats.length, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      const px = dk.x - ch * L * 0.25, pz = dk.z - sh * L * 0.25, dh = WW.dist(this.x, this.z, px, pz);
      const b = Math.atan2(pz - this.z, px - this.x);
      if (dh < 25 && dh > 4 && this.waveOffs < 3 && Math.abs(WW.angleDiff(c.heading, b)) > 0.5) {
        this.waveOffs++; this.state = 'return'; this.vy = 3; return;
      }
      this.turnTo(b, dt, 1.5);
      const ty = dk.y + DECK_Y + Math.min(10, Math.max(0, dh - 3) * 0.25);
      this.vy = WW.clamp((ty - this.y) * 2, -6, 6);
      this.speed = c.speed + WW.clamp(dh * 0.5, 4, 16);
      if (dh < 2.5) {
        this.state = 'rollout'; this.t = 0; this.y = dk.y + DECK_Y; this.vy = 0; this.turn = 0;
        this.lx = -L * 0.25; this.rel = this.speed - c.speed;
        WW.stats.planesLanded++;
      }
    }

    rollout(dt) {
      const c = this.carrier, dk = deckInfo(c), ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      this.rel = Math.max(0, this.rel - 12 * dt); this.lx += this.rel * dt;
      const ox = dk.x - c.x, oz = dk.z - c.z;
      this.x = c.x + ox + ch * this.lx; this.z = c.z + oz + sh * this.lx; this.y = dk.y + DECK_Y;
      this.heading = c.heading; this.vy = 0; this.speed = 0;
      this.sync(dt);
      if (this.t > 1.2) {
        (c.rearm = c.rearm || []).push({ kind: this.kind, at: WW.time.now + REARM });
        this.alive = false; this.remove();
      }
    }

    remove() {
      if (this.removed) return;
      this.removed = true; this.alive = false;
      release(this.model);
    }
  }

  WW.Plane = Plane;
  WW.air = {
    init() {
      if (tracers.length || !WW.scene) return;
      const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 16; i++) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const ln = new THREE.Line(g, mat); ln.visible = false; ln.life = 0; ln.frustumCulled = false;
        WW.scene.add(ln); tracers.push(ln);
      }
    },
    launch(carrier, kind, target) {
      if (!carrier || !carrier.alive || !carrier.hangar || !(carrier.hangar[kind] > 0)) return null;
      carrier.hangar[kind]--;
      const p = new Plane(kind, carrier.nation, carrier, target, getModel(kind, carrier.nation));
      WW.world.planes.push(p);
      WW.stats.planesLaunched++;
      return p;
    },
    update(dt) {
      for (const ln of tracers) if (ln.visible && (ln.life -= dt) <= 0) ln.visible = false;
      const now = WW.time.now;
      for (const s of WW.world.ships) {
        if (!s.rearm || !s.rearm.length || !s.alive) continue;
        for (let i = s.rearm.length - 1; i >= 0; i--) if (s.rearm[i].at <= now) { s.hangar[s.rearm[i].kind]++; s.rearm.splice(i, 1); }
      }
      const setup = WW.game && WW.game.state === 'setup';
      const arr = WW.world.planes;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (p.removed || (setup && p.alive)) continue;
        p.update(dt);
      }
      let j = 0;
      for (let i = 0; i < arr.length; i++) if (!arr[i].removed) arr[j++] = arr[i];
      arr.length = j;
    },
    clearAll() {
      for (const p of WW.world.planes) p.remove();
      WW.world.planes.length = 0;
      for (const ln of tracers) ln.visible = false;
    }
  };
})();
