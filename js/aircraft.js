// aircraft.js — owner C. Carrier planes (WW.air): take-off, transit, attack,
// dogfights, return, landing, rearm, shoot-down and ditching.
window.WW = window.WW || {};
(function () {
  const pool = {};            // kind+nation -> [model]
  const tracers = [];         // pooled THREE.Line
  let tracerIdx = 0, v3 = null;
  const REARM = 10;
  const PLANE_SCALE = WW.cfg.PLANE_SCALE || 0.82, PK = WW.cfg.PLANE_K || 1, FXK = Math.sqrt(PK); // ~2x true (ship_classes.js; ?planeScale=); FXK: puff sizes
  const DECK_Y = 0.75 * PK;   // fuselage centre above the flight deck (0.75 at the 1.7 tuning scale)

  function getModel(kind, nation) {
    const k = kind + nation, p = pool[k];
    let m;
    if (p && p.length) m = p.pop();
    else {
      m = WW.models.buildPlane(kind, nation); m.key = k; m.group.rotation.order = 'YZX';
      m.group.scale.setScalar(PLANE_SCALE);
    }
    if (WW.scene) WW.scene.add(m.group); // real shadow maps now: no fake silhouette shadow
    if (WW.planeRender) WW.planeRender.acquire(m); // drawn as instances (air_render.js)
    return m;
  }
  function release(m) { if (WW.airDeaths) WW.airDeaths.restore(m); if (WW.planeRender) WW.planeRender.release(m); if (WW.scene) WW.scene.remove(m.group); (pool[m.key] = pool[m.key] || []).push(m); }

  function deckInfo(c) {
    if (!v3) v3 = new THREE.Vector3();
    if (c.model.deck) { c.group.updateMatrixWorld(true); c.model.deck.getWorldPosition(v3); return { x: v3.x, y: Math.max(1, v3.y), z: v3.z }; }
    return { x: c.x, y: 3, z: c.z };
  }

  // Short soft streak from the gun toward the foe, fading out (visual only: Math.random, every other burst).
  function tracer(a, b) {
    if (!tracers.length || Math.random() < 0.5) return;
    const ln = tracers[tracerIdx++ % tracers.length], pos = ln.geometry.attributes.position;
    const tx = b.x + (Math.random() - 0.5) * 1.6, tz = b.z + (Math.random() - 0.5) * 1.6;
    const dx = tx - a.x, dy = b.y - a.y, dz = tz - a.z, d = Math.hypot(dx, dy, dz) || 1, s0 = Math.min(1.5, d * 0.2) / d, s1 = s0 + Math.min(4, d * 0.4) / d;
    pos.setXYZ(0, a.x + dx * s0, a.y + dy * s0, a.z + dz * s0); pos.setXYZ(1, a.x + dx * s1, a.y + dy * s1, a.z + dz * s1);
    pos.needsUpdate = true; ln.geometry.computeBoundingSphere(); ln.visible = true; ln.life = ln.life0 = 0.16;
    ln.material.opacity = 0.5;
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
        if (WW.emit) WW.emit('planeHit', { plane: this, amount: amount }); // sound hook (audio_air.js), throttled with the hit flash
        WW.fx.sparks(this.x, this.y, this.z);
        if (Math.random() < 0.5) WW.fx.smoke(this.x, this.y, this.z, true, 0.35 * FXK);
      }
      if (this.hp <= 0) { this.shotDown(); return; }
      // Badly hit: jettison the payload and turn for home (not mid-dive / mid-run).
      if (!this.crippled && this.hp < this.maxHp * 0.35 && (this.state === 'transit' || this.state === 'attack') && !this.phase) {
        this.crippled = true;
        if (WW.airDeaths && WW.airDeaths.onCrippled(this)) return;
        if (this.ordnance) { this.dropped(); WW.fx.splash(this.x, this.z, 0.8 * FXK); }
        this.state = 'return'; this.foe = null;
      }
    }
    // Damage trail from the engine: thin grey < 70% hp, thick black + flames < 40%, burning when falling.
    // Damage trail from the engine, emitted by distance travelled so the puffs overlap into one soft ribbon.
    // >= 70% hp: nothing; 50-70%: an occasional single wisp; < 50%: grey ribbon; < 30% / falling: charcoal + flames.
    trail(dt, falling) {
      const f = this.hp / this.maxHp, fx = WW.fx;
      if (!falling && f >= 0.7) return;
      const n = 1.25 * PLANE_SCALE * 0.6, c = Math.cos(this.heading), sn = Math.sin(this.heading);
      const ex = this.x + c * (n - 0.8 * PK), ey = this.y + 0.1 * PK, ez = this.z + sn * (n - 0.8 * PK);
      if (!falling && f >= 0.5) {
        this.trailT -= dt;
        if (this.trailT <= 0) { this.trailT = 1.5 + Math.random() * 2; fx.smoke(ex, ey, ez, true, 0.25 * FXK); }
        this.tx = undefined; return;
      }
      const heavy = falling || f < 0.3;
      this.flameT = (this.flameT || 0) - dt; // flickering flames at the engine
      if (heavy && this.flameT <= 0) { this.flameT = falling ? 0.08 : 0.2; fx.fire(ex + c * 0.8 * PK, ey, ez + sn * 0.8 * PK); }
      const ld = WW.damage ? WW.damage.load() : 1, ribbon = !!fx.trail;
      const sp = (ribbon ? 0.7 : 3.5) * FXK * Math.min(2, ld), size = (heavy ? 1.35 : 1.05) * FXK, life = falling ? 1.4 : heavy ? 1.1 : 0.85; // size ~1.5-2x spacing: overlapping ribbon
      if (WW.damage) WW.damage.want((this.speed || 20) / sp * life / 3);
      if (this.tx === undefined) { this.tx = ex; this.ty = ey; this.tz = ez; return; }
      let dx = ex - this.tx, dy = ey - this.ty, dz = ez - this.tz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 30) { this.tx = ex; this.ty = ey; this.tz = ez; return; } // jumped (e.g. new sortie): restart the ribbon
      if (d < sp) return;
      dx /= d; dy /= d; dz /= d;
      for (let k = 0; k < 12 && d >= sp; k++, d -= sp) {
        this.tx += dx * sp; this.ty += dy * sp; this.tz += dz * sp;
        if (ribbon) fx.trail(this.tx, this.ty, this.tz, heavy, size * (0.85 + Math.random() * 0.3), life);
        else fx.smoke(this.tx, this.ty, this.tz, true, (heavy ? 0.6 : 0.4) * FXK);
      }
      if (d >= sp) { this.tx = ex; this.ty = ey; this.tz = ez; }
    }
    shotDown() {
      this.alive = false; this.state = 'falling'; WW.stats.planesLost++;
      WW.fx.explosion(this.x, this.y, this.z, 0.6 * FXK);
      this.spin = (WW.rand() < 0.5 ? -1 : 1) * WW.randRange(1.5, 3); this.vy = Math.min(this.vy, -1);
      if (WW.airDeaths) WW.airDeaths.onShotDown(this);
    }
    ditch() {
      if (!this.alive) return;
      this.alive = false; this.state = 'ditch'; WW.stats.planesLost++;
      if (WW.airDeaths) WW.airDeaths.onDitch(this);
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
      if (t && t.alive && !t.submerged && (!WW.intel || WW.intel.known(this.nation, t))) return t; // still a known contact (intel.js)
      this.target = WW.cag ? WW.cag.retarget(this) : WW.airOps ? WW.airOps.pickTarget(this) : WW.shipAI ? WW.shipAI.pickStrikeTarget(this) : null;
      return this.target;
    }

    update(dt) {
      this.t += dt;
      const fx = WW.fx;
      if (this.deathMode && WW.airDeaths) { WW.airDeaths.updatePlane(this, dt); return; }
      if (this.state === 'falling') {
        this.vy -= 9 * dt; this.heading += this.spin * dt; this.turn = this.spin * 2; this.speed *= 1 - 0.3 * dt;
        this.trail(dt, true);
        this.integrate(dt, true);
        if (this.y <= 0) { fx.splash(this.x, this.z, 1.6 * FXK); fx.explosion(this.x, 0.3, this.z, 0.6 * FXK); this.remove(); }
        return;
      }
      if (this.state === 'ditch') {
        this.vy += WW.clamp(-3 - this.vy, -4 * dt, 4 * dt); this.speed = Math.max(8, this.speed - 4 * dt); this.turn = 0;
        this.integrate(dt, true);
        if (this.y <= 0.3) { fx.splash(this.x, this.z, FXK); this.remove(); }
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
          if (WW.dogfight && this.kind !== 'fighter') WW.dogfight.jink(this, dt); // bombers under attack weave
          if (WW.airOps && this.kind !== 'fighter' && this.alive) WW.airOps.bomber(this, dt); // jettison and go home
          break;
        case 'return': this.goHome(dt); break;
        case 'landing': this.landing(dt); break;
        case 'rollout': this.rollout(dt); return;
      }
      if (this.jink && WW.combatAA) WW.combatAA.applyJink(this, dt); // flak weave (combat_aa.js)
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

    // Visual attitude (order 'YZX': heading, then pitch, then roll). Coordinated bank: tan(bank) = v * turnRate / g,
    // reached with a short roll-in / roll-out lag; pitch follows the flight path. gload (units/s^2) feeds wing-tip vapour.
    sync(dt) {
      const g = this.group, G_EFF = 35;
      g.position.set(this.x, this.y, this.z);
      const path = Math.atan2(this.vy, Math.max(1, this.speed)), p0 = this.pitch === undefined || !(dt > 0) ? path : this.pitch;
      this.pitch = p0 + (path - p0) * (dt > 0 ? 1 - Math.exp(-dt / 0.12) : 1);
      const pr = dt > 0 ? (this.pitch - p0) / dt : 0;
      this.tr = dt > 0 ? (this.tr || 0) + (this.turn - (this.tr || 0)) * (1 - Math.exp(-dt / 0.15)) : this.turn;
      let bank = WW.clamp(Math.atan2(this.speed * this.tr, G_EFF), -1.3, 1.3);
      if (this.alive) bank *= Math.max(0, Math.cos(this.pitch)); // no steep bank while pointing down a dive
      const dr = bank - this.roll, maxR = 2.6 * dt;               // roll rate limit = the roll-in / roll-out lag
      this.roll += WW.clamp(dr * Math.min(1, dt * 7), -maxR, maxR);
      const v = Math.hypot(this.speed, this.vy);
      this.gload = Math.hypot(this.speed * this.tr, v * Math.max(0, pr));
      const f = this.hp / this.maxHp; // a badly damaged plane wobbles (visual only)
      // x: roll (+ wobble), y: heading, z: pitch (+ a touch of nose-up while pulling out); one Euler.set, so the
      // quaternion is rebuilt once, not once per axis (same final values)
      g.rotation.set(this.roll + (f < 0.4 && this.alive && this.state !== 'rollout' ? Math.sin(this.t * 7.3) * 0.12 + Math.sin(this.t * 3.1) * 0.08 : 0),
        -this.heading, this.pitch + WW.clamp(pr * 0.05, 0, 0.08));
      if (WW.airFx) WW.airFx.sync(this, dt); else if (this.prop && !WW.simOnly) this.prop.rotation.x += dt * 45; // prop spin: visual only
    }

    takeoff(dt) {
      if (this.carrier.isBase && WW.landAir) return WW.landAir.takeoff(this, dt); // runway (land_air.js)
      if (WW.airDeck) return WW.airDeck.takeoff(this, dt); // deck spot, taxi, run, climb-out (air_deck.js)
      const c = this.carrier, dk = deckInfo(c);
      this.deckY = dk.y; this.heading = c.heading; this.turn = 0;
      this.speedTo(this.pt.speed * 0.8, dt);
      if (this.t < 2.2) { this.y = dk.y + DECK_Y; this.vy = 0; }
      else this.vy += WW.clamp(5 - this.vy, -6 * dt, 6 * dt);
      if (this.y > dk.y + 10) this.state = 'transit';
    }

    fighter(dt) {
      if (WW.airOps) return WW.airOps.fighter(this, dt); // CAP / escort / fighter director (air_ops.js); below: the fallback
      const c = this.carrier;
      this.scanT -= dt; this.burstT -= dt;
      if (this.foe && !this.foe.alive) this.foe = null;
      if (this.scanT <= 0) {
        this.scanT = 0.4;
        const cx = this.target ? this.x : c.x, cz = this.target ? this.z : c.z, R = this.target ? 90 : 180;
        let best = null, bd = R;
        const foes = WW.intel ? WW.intel.enemyPlanes(this.nation) : [];   // detected enemy planes (intel.js)
        for (const c of foes) {
          const p = c.unit;
          if (!p.alive) continue;
          const d = WW.dist(cx, cz, p.x, p.z);
          if (d < bd) { bd = d; best = p; }
        }
        this.foe = WW.dogfight ? WW.dogfight.pick(this, best) : best;
      }
      const f = this.foe;
      if (f) {
        this.state = 'attack';
        if (WW.dogfight) { WW.dogfight.fight(this, f, dt); return; } // air_dogfight.js
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
        if (WW.strike && WW.strike.escort(this, dt)) return; // weave over the forming / transiting wave
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

    // Strike attacks live in air_strikes.js (WW.strike): form-up, vics, sequential dive, anvil torpedo run.
    diveBomber(dt) { if (WW.strike) WW.strike.dive(this, dt); else this.state = 'return'; }
    torpBomber(dt) { if (WW.strike) WW.strike.torp(this, dt); else this.state = 'return'; }

    goHome(dt) {
      if (this.carrier.isBase && WW.landAir) return WW.landAir.goHome(this, dt);
      if (WW.airDeck) return WW.airDeck.goHome(this, dt);
      const c = this.carrier, dk = deckInfo(c), L = c.stats.length, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      this.foe = null;
      const ex = dk.x - ch * (L * 0.5 + 35), ez = dk.z - sh * (L * 0.5 + 35);
      const de = WW.dist(this.x, this.z, ex, ez);
      this.fly(ex, ez, de > 80 ? 25 : 10, dt, this.pt.speed);
      if (de < 10) this.state = 'landing';
    }

    landing(dt) {
      if (this.carrier.isBase && WW.landAir) return WW.landAir.landing(this, dt);
      if (WW.airDeck) return WW.airDeck.landing(this, dt); // pattern, groove, wave-off, trap
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
      if (this.carrier.isBase && WW.landAir) return WW.landAir.rollout(this, dt);
      if (WW.airDeck) return WW.airDeck.rollout(this, dt); // arrestor jolt, then the deck takes the model
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
      if (WW.airDeck) WW.airDeck.unfold(this.model);
      release(this.model);
    }
  }

  WW.Plane = Plane;
  WW.air = {
    _pool: { get: getModel, release, scale: PLANE_SCALE, deckY: DECK_Y, rearm: REARM, pool }, // for air_deck.js
    init() {
      if (WW.airFx) WW.airFx.init();
      if (tracers.length || !WW.scene || WW.simOnly) return;
      for (let i = 0; i < 16; i++) { // one material per pooled line (created once) so each can fade on its own
        const mat = new THREE.LineBasicMaterial({ color: 0xe6c27a, transparent: true, opacity: 0.5, depthWrite: false });
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
      if (WW.dogfight) WW.dogfight.equip(p); // per-nation flight stats
      WW.world.planes.push(p);
      WW.stats.planesLaunched++;
      if (carrier.isBase && WW.landAir) WW.landAir.launched(p); // an island base: its runway (land_air.js)
      else if (WW.airDeck) WW.airDeck.launched(p);
      return p;
    },
    update(dt) {
      if (WW.airDeaths) WW.airDeaths.update(dt);
      if (WW.airDeck) WW.airDeck.update(dt);
      for (const ln of tracers) if (ln.visible) { if ((ln.life -= dt) <= 0) ln.visible = false; else ln.material.opacity = 0.5 * ln.life / ln.life0; }
      if (WW.dogfight) WW.dogfight.update(dt); // wing-gun tracer rounds
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
      if (WW.airFx) WW.airFx.update(dt);
    },
    clearAll() {
      for (const p of WW.world.planes) p.remove();
      WW.world.planes.length = 0;
      if (WW.airDeck) WW.airDeck.clearAll();
      for (const ln of tracers) ln.visible = false;
      if (WW.dogfight) WW.dogfight.clearAll();
      if (WW.airDeaths) WW.airDeaths.clearAll();
      if (WW.airFx) WW.airFx.clearAll();
    }
  };
})();
