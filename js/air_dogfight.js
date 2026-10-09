// air_dogfight.js — fighter-vs-plane combat (WW.dogfight): energy-based dogfight manoeuvres
// (lead pursuit, overshoot / extend / zoom, boom-and-zoom, break / scissors / dive, Thach weave),
// wing guns with per-round hit checks, and pooled glowing tracer rounds. Load after aircraft.js.
// Hooks in aircraft.js: Plane.fighter() target pick + `if (f)` branch, Plane.update() bomber jink,
// WW.air.launch() nation stats, WW.air.update() tracer step.
window.WW = window.WW || {};
(function () {
  const BV = 190;          // bullet speed (units/s, slowed a bit so the tracers read)
  const ROUND = 0.08;      // one round per wing every 0.08 s while the trigger is held
  const CONV = 15;         // wing-gun convergence distance
  const RANGE = 28;        // no firing beyond this (open fire inside ~2x convergence)
  const PK = WW.cfg.PLANE_K || 1;           // plane size vs the 1.7 tuning scale (ship_classes.js)
  const WING = 1.25 * PK;  // wing-gun offset from the centre line (scaled model)
  const DMG = 0.75;        // damage per hitting round (times the type's pt.gun)
  const BOMBER_K = 5;    // a bomber is a big, steady, lightly protected target: hits on it count this much more
  const FIGHTER_K = 2.2;   // fighter-on-fighter lethality (P5: 1-3 fighters lost per side per carrier round)
  const LOCK = [5, 7];   // s a fighter stays committed to a new foe (through its passes)
  const SWITCH_D = 50, SWITCH_BEHIND = 1.6, FRONT_R = 45, FRONT_CONE = 0.45;   // pick(): foe out of reach / behind; an enemy this close and this far off the nose instead
  const N = 240;           // tracer pool size (oldest round is reused)
  const DS = { gunKills: 0, weaves: 0, rounds: 0, hits: 0, defences: {} }; // counters for tests

  // ---------- tracer pool: one instanced soft streak quad per round, additive, camera-facing ----------
  const T = { mesh: null, seg: [], idx: 0, dirty: false };
  let m4, v3a, v3b, v3c, v3d, colTmp;
  function streakTexture() { // hot yellow-white core inside a soft orange glow, fading along the tail
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const g = c.getContext('2d'), img = g.createImageData(128, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) {
      const v = Math.abs(y - 15.5) / 16, u = x / 127;                  // u: 0 tail .. 1 head
      const along = Math.min(1, u * 1.3) * (u > 0.92 ? 1 - (u - 0.92) / 0.08 * 0.7 : 1);
      const core = Math.max(0, 1 - v / 0.22), glow = Math.exp(-v * v * 9);
      const i = (y * 128 + x) * 4, k = along;
      img.data[i] = 255 * Math.min(1, (core + glow * 0.9) * k);
      img.data[i + 1] = 255 * Math.min(1, (core * 0.95 + glow * 0.5) * k);
      img.data[i + 2] = 255 * Math.min(1, (core * 0.6 + glow * 0.12) * k);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  }
  function initTracers() {
    if (T.mesh || !WW.scene || WW.simOnly) return !!T.mesh;
    m4 = new THREE.Matrix4(); v3a = new THREE.Vector3(); v3b = new THREE.Vector3(); v3c = new THREE.Vector3(); v3d = new THREE.Vector3();
    colTmp = new THREE.Color();
    const geo = new THREE.PlaneGeometry(1, 1); // x along the round's path, y across, faces +z
    const mat = new THREE.MeshBasicMaterial({ map: streakTexture(), transparent: true, blending: THREE.AdditiveBlending,
                                              depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    T.mesh = new THREE.InstancedMesh(geo, mat, N);
    T.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    T.mesh.frustumCulled = false; T.mesh.renderOrder = 6;
    m4.makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) {
      T.mesh.setMatrixAt(i, m4); T.mesh.setColorAt(i, colTmp.setRGB(0, 0, 0));
      T.seg.push({ life: 0, life0: 1, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heat: 1 });
    }
    WW.scene.add(T.mesh);
    return true;
  }
  // One tracer round from (x,y,z) moving with world velocity v (visual only).
  function spawnTracer(x, y, z, vx, vy, vz, life, flash) {
    if (!initTracers()) return;
    const s = T.seg[T.idx]; T.idx = (T.idx + 1) % N;
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz; s.life = s.life0 = life; s.age = 0; s.flash = !!flash;
    s.heat = flash ? 1.3 : 0.9 + Math.random() * 0.25;
    T.dirty = true;
  }
  function updateTracers(dt) {
    if (!T.mesh || !T.dirty) return;
    const cam = WW.camera && WW.camera.position;
    let any = false;
    for (let i = 0; i < N; i++) {
      const s = T.seg[i];
      if (s.life <= 0) continue;
      s.life -= dt; s.age += dt;
      if (s.life <= 0 || !cam) { m4.makeScale(0, 0, 0); T.mesh.setMatrixAt(i, m4); continue; }
      any = true;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
      v3a.set(s.vx / sp, s.vy / sp, s.vz / sp);                          // along the path
      v3c.set(cam.x - s.x, cam.y - s.y, cam.z - s.z);                    // toward the camera
      const k = Math.max(1, v3c.length() / 30);                          // keep a readable size on screen when far away
      const L = (s.flash ? 1.1 + Math.random() * 0.5 : Math.min(5, sp * s.age * 0.9 + 0.8)) * Math.sqrt(k), W = s.flash ? 0.8 * Math.sqrt(k) : 0.9 * k;
      v3b.crossVectors(v3c, v3a); if (v3b.lengthSq() < 1e-6) v3b.set(0, 1, 0); v3b.normalize(); // across, in view
      v3c.crossVectors(v3a, v3b);
      m4.makeBasis(v3d.copy(v3a).multiplyScalar(L), v3b.multiplyScalar(W), v3c);
      m4.setPosition(s.x - v3a.x * L * 0.5, s.y - v3a.y * L * 0.5, s.z - v3a.z * L * 0.5); // the head leads
      T.mesh.setMatrixAt(i, m4);
      const f = Math.min(1, s.life / s.life0 * 2) * s.heat;
      T.mesh.setColorAt(i, colTmp.setRGB(1.0 * f, 0.72 * f, 0.32 * f));
    }
    T.mesh.instanceMatrix.needsUpdate = true;
    if (T.mesh.instanceColor) T.mesh.instanceColor.needsUpdate = true;
    T.dirty = any;
  }
  function clearTracers() {
    if (!T.mesh) return;
    m4.makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) { T.seg[i].life = 0; T.mesh.setMatrixAt(i, m4); }
    T.mesh.instanceMatrix.needsUpdate = true; T.dirty = false;
  }

  // ---------- helpers ----------
  const st = p => p.df || (p.df = { mode: 'pursue', foe: null, t: 0, mt: 0, def: null, defT: 0, defCool: 0, dir: 1, revT: 0,
                                     from: null, mate: null, threatT: 0, react: 0.3 + WW.rand() * 0.6, lock: 0,
                                     burst: 0, cool: 0, roundT: 0, flashT: 0, chkT: 0, jinkPh: WW.rand() * 6 });
  const bearing = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  const d3 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const slasher = p => p.pt.style === 'slash';

  // Enemy fighter on p's tail: it is chasing p, its nose is on p, and it sits in p's rear cone.
  function threat(p, R) {
    let best = null, bd = R;
    for (const q of WW.world.planes) {
      if (!q.alive || q.kind !== 'fighter' || q.nation === p.nation || q.foe !== p || q.state !== 'attack') continue;
      const d = d3(q, p);
      if (d >= bd) continue;
      if (Math.abs(WW.angleDiff(q.heading, bearing(q, p))) > 0.6) continue;
      if (Math.abs(WW.angleDiff(p.heading, bearing(p, q))) < 1.9) continue;
      bd = d; best = q;
    }
    return best;
  }

  // The plane's own element: its leader and wingmen (air_squadrons.js), alive, not itself.
  function elementMates(p) {
    const el = p.element;
    return el ? el.members.filter(w => w !== p && w.alive && w.kind === 'fighter').concat(el.div && el.div.members[0] && el.div.members[0] !== p ? [el.div.members[0]] : []) : [];
  }

  // Energy: climbing bleeds speed, diving builds it, hard turns cost speed; the engine pulls back to cruise.
  function energy(p, dt, cruise) {
    const pt = p.pt;
    p.speed += (-p.vy * 0.55 - Math.abs(p.turn) * 2.0) * dt;
    p.speed += WW.clamp(cruise - p.speed, -3 * dt, 4 * dt);
    p.speed = WW.clamp(p.speed, pt.speed * 0.55, pt.dive);
  }
  // Turn rate falls off away from corner speed (slow = mushy, very fast = wide).
  function rate(p, k) {
    const r = p.speed / p.pt.speed;
    return p.pt.turn * (k || 1) * WW.clamp(r < 1 ? 0.45 + 0.55 * r : 1.25 - 0.25 * r, 0.5, 1.05);
  }
  function climb(p, alt, dt, maxV) { // like Plane.climbTo, but the climb rate is the type's
    const tv = WW.clamp((alt - p.y) * 0.8, -(maxV || 14), maxV || p.pt.climb);
    p.vy += WW.clamp(tv - p.vy, -12 * dt, 12 * dt);
  }

  // ---------- the gunsight ----------
  // Angle between the nose (heading and flight-path pitch) and a point, in 3D.
  function noseOff(p, x, y, z) {
    const ph = Math.atan2(p.vy || 0, Math.max(1, p.speed)), c = Math.cos(ph);
    const rx = x - p.x, ry = y - p.y, rz = z - p.z, rl = Math.hypot(rx, ry, rz) || 1;
    return Math.acos(WW.clamp((Math.cos(p.heading) * c * rx + Math.sin(ph) * ry + Math.sin(p.heading) * c * rz) / rl, -1, 1));
  }
  const FLYING = { transit: 1, attack: 1, 'return': 1, landing: 1 };
  const flying = q => q.alive && FLYING[q.state] && q.y > 3 && q.state !== 'rollout';
  // The enemy plane most squarely ahead: inside `cone` of the nose and within R; a bomber before a fighter
  // (a fighter scores `fk` rad worse). null if none.
  function ahead(p, R, cone, fk) {
    let best = null, bs = 1e9;
    for (const q of WW.world.planes) {
      if (q.nation === p.nation || !flying(q)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      const a = noseOff(p, q.x, q.y, q.z); if (a > cone) continue;
      const sc = a + (q.kind === 'fighter' ? fk : 0);
      if (sc < bs) { bs = sc; best = q; }
    }
    return best;
  }
  // Snapshot (1942 practice): an enemy in the gunsight cone within gun range gets a burst whoever the assigned foe
  // is. Looked up every SNAP_DT s of sim time.
  const SNAP_CONE = 0.2, SNAP_DT = 0.1;
  function snapTarget(p, s) {
    const now = WW.time.now;
    if (s.snapT === undefined || now - s.snapT >= SNAP_DT || now < s.snapT) { s.snapT = now; s.snapQ = ahead(p, RANGE, SNAP_CONE, 0.06); }
    return s.snapQ && s.snapQ.alive ? s.snapQ : null;
  }

  // ---------- wing guns ----------
  // can: the foe is on the gun line (open fire); keep: near enough to hold the trigger. With no shot at the foe, a
  // plane in the gunsight cone is fired at instead (snapshot). s.gunAt: the plane being fired at (tests, visuals).
  function guns(p, f, s, dt, can, keep) {
    s.cool -= dt; s.flashT -= dt;
    let snap = false;
    if (!can) { const q = snapTarget(p, s); if (q) { snap = q !== f; f = q; can = keep = true; } }
    if (!f) { s.burst = 0; s.gunAt = null; s.roundT = 0; return; }
    if (s.burst > 0) { s.burst -= dt; if (!keep) s.burst = 0; }
    else if (can && s.cool <= 0) { s.burst = WW.randRange(0.4, 0.85); s.cool = s.burst + WW.randRange(0.5, 1.1); s.roundT = 0; if (snap) DS.snaps = (DS.snaps || 0) + 1; }
    s.gunAt = s.burst > 0 ? f : null;
    if (s.burst <= 0) { s.roundT = 0; return; }
    s.roundT -= dt;
    while (s.roundT <= 0) { s.roundT += ROUND; fireRound(p, f, s); }
  }
  function fireRound(p, f, s) {
    const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
    const dh = Math.hypot(f.x - p.x, f.z - p.z) || 1;
    let ph = Math.atan2(p.vy, Math.max(1, p.speed));
    ph += WW.clamp(Math.atan2(f.y - p.y, dh) - ph, -0.1, 0.1); // the pilot holds a little pull to put the pipper on
    const cp = Math.cos(ph), nx = ch * cp, ny = Math.sin(ph), nz = sh * cp;
    const vmx = ch * p.speed, vmy = p.vy, vmz = sh * p.speed;
    const vfx = Math.cos(f.heading) * f.speed, vfy = f.vy || 0, vfz = Math.sin(f.heading) * f.speed;
    // hit radius: the burst's spread at convergence (~0.9, any plane size) + the airframe's half-size (x PLANE_K)
    const R = 0.9 + (f.kind === 'fighter' ? 0.8 : 0.9) * PK, flash = s.flashT <= 0;
    if (flash) s.flashT = 0.07;
    for (let side = -1; side <= 1; side += 2) {
      // gun at the wing, stream toed in so both streams meet CONV ahead of the nose
      const gx = p.x - sh * side * WING + nx * 0.5, gy = p.y - 0.25 * PK + ny * 0.5, gz = p.z + ch * side * WING + nz * 0.5;
      let ux = nx + sh * side * WING / CONV, uy = ny, uz = nz - ch * side * WING / CONV;
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      let rx = f.x - gx, ry = f.y - gy, rz = f.z - gz;
      const tof = Math.hypot(rx, ry, rz) / BV;
      rx += (vfx - vmx) * tof; ry += (vfy - vmy) * tof; rz += (vfz - vmz) * tof; // where the foe will be vs the round
      const along = rx * ux + ry * uy + rz * uz;
      const px = rx - ux * along, py = ry - uy * along, pz = rz - uz * along, miss = Math.hypot(px, py, pz);
      let hit = false;
      if (along > 1.5 && along < RANGE) {
        const conv = 1 - 0.35 * Math.min(1, Math.abs(along - CONV) / CONV); // tightest pattern near convergence
        const pHit = WW.clamp(1 - miss / R, 0, 1) * 0.8 * conv;
        hit = WW.rand() < pHit;
      }
      // tracer round (visual only): bullet velocity = plane velocity + muzzle velocity along the stream
      const j = 0.012, life = hit ? Math.max(0.03, tof) : 0.24 + Math.random() * 0.06;
      spawnTracer(gx, gy, gz, vmx + (ux + (Math.random() - 0.5) * j) * BV, vmy + (uy + (Math.random() - 0.5) * j) * BV,
                  vmz + (uz + (Math.random() - 0.5) * j) * BV, life);
      if (flash) spawnTracer(gx + nx * 0.9, gy + ny * 0.9, gz + nz * 0.9, vmx + nx * 6, vmy + ny * 6, vmz + nz * 6, 0.05, true); // muzzle flash
      DS.rounds++; if (hit) { DS.hits++; hitPlane(p, f); }
      if (!f.alive) return;
    }
  }
  function hitPlane(p, f) {
    if (!f.alive) return;
    const dmg = DMG * (p.pt.gun || 1) * (f.kind === 'fighter' ? FIGHTER_K : BOMBER_K), lethal = f.hp - dmg <= 0;
    if (lethal && !f.killedBy) f.killedBy = p;
    f.damage(dmg);
    if (Math.random() < 0.35) WW.fx.sparks(f.x, f.y, f.z);
    if (!f.alive) { DS.gunKills++; WW.emit('planeKill', { victim: f, shooter: p }); }
    else if (lethal && f.killedBy === p) f.killedBy = null;
  }

  // ---------- defence ----------
  function startDefence(p, s, q) {
    const pt = p.pt, r = WW.rand();
    s.from = q; s.dir = WW.angleDiff(p.heading, bearing(p, q)) >= 0 ? 1 : -1; // break into the attacker's side
    let mate = null;
    if (slasher(p)) { // Thach weave: turn toward a wingman who swings head-on into the attacker
      let bd = 75;
      for (const w of elementMates(p)) if (!(w.df && w.df.def) && (w.state === 'attack' || w.state === 'transit') && d3(w, p) < 110) { mate = w; bd = -1; break; } // own section first
      if (!mate) for (const w of WW.world.planes) {
        if (w === p || !w.alive || w.kind !== 'fighter' || w.nation !== p.nation || (w.df && w.df.def)) continue;
        if (w.state !== 'attack' && w.state !== 'transit') continue;
        const d = d3(w, p); if (d < bd) { bd = d; mate = w; }
      }
    }
    if (mate && r < 0.75) {
      s.def = 'weave'; s.defT = WW.randRange(3, 4.2); s.mate = mate;
      const ws = st(mate); mate.foe = q; ws.lock = 4.5; ws.mode = 'pursue'; ws.foe = q; ws.mt = 0; ws.weave = 4;
      DS.weaves++;
    } else if (p.y > 14 && r < (slasher(p) ? 0.55 : 0.2) + (mate ? 0.2 : 0)) {
      s.def = 'dive'; s.defT = WW.randRange(3, 4.5);
    } else if (WW.rand() < (slasher(p) ? 0.35 : 0.45)) {
      s.def = 'scissors'; s.defT = WW.randRange(2.6, 3.6); s.revT = WW.randRange(0.7, 1.0);
    } else { s.def = 'break'; s.defT = WW.randRange(1.8, 2.6); }
    p.dfMove = s.def; // readable by the camera / visuals
    DS.defences[s.def] = (DS.defences[s.def] || 0) + 1;
  }
  function defend(p, s, dt) {
    const pt = p.pt;
    s.defT -= dt;
    if (s.defT <= 0 || !s.from || !s.from.alive) { s.def = null; p.dfMove = null; s.defCool = WW.randRange(1.2, 2.2); s.threatT = 0; return false; }
    switch (s.def) {
      case 'break':
        p.turnTo(p.heading + s.dir * 2, dt, rate(p, 1.2)); climb(p, p.y - 3, dt); energy(p, dt, pt.speed * 1.05); break;
      case 'scissors': // reversing hard turns while slowing down so the attacker slides past
        s.revT -= dt; if (s.revT <= 0) { s.dir = -s.dir; s.revT = WW.randRange(0.7, 1.0); }
        p.turnTo(p.heading + s.dir * 2, dt, rate(p, 1.15)); climb(p, p.y + 1, dt); energy(p, dt, pt.speed * 0.7); break;
      case 'dive': // split-S style run for the deck: trade altitude for speed
        p.turnTo(p.heading + s.dir * 0.4, dt, 0.4); climb(p, Math.max(5, p.y - 30), dt, 16); energy(p, dt, pt.dive); break;
      case 'weave': {
        const m = s.mate;
        if (!m || !m.alive) { s.def = 'break'; break; }
        p.turnTo(bearing(p, m), dt, rate(p, 1.1)); climb(p, m.y, dt); energy(p, dt, pt.speed * 1.05);
        if (d3(p, m) < 8) s.defT = Math.min(s.defT, 0.6);
        break;
      }
    }
    return true;
  }

  // ---------- offence ----------
  function setMode(s, m) { s.mode = m; s.mt = 0; }
  // the gun line's error in height: the climb angle to (x, y, z) against the flight path's
  function elev(p, x, y, z) { return Math.abs(Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z) || 1) - Math.atan2(p.vy || 0, Math.max(1, p.speed))); }
  function offence(p, f, s, dt) {
    if (f.kind !== 'fighter' && WW.intercept && WW.intercept.attack(p, f, s, dt)) return; // gun passes on bombers (air_intercept.js)
    const pt = p.pt, dist = d3(p, f), dy = f.y - p.y, adv = -dy;
    if (s.foe !== f) { // new engagement: dive on it from above if we have the height; commit to it for a few passes
      s.foe = f; setMode(s, adv > 8 && dist > 22 && (slasher(p) || WW.rand() < 0.4) ? 'boom' : 'pursue');
      s.lock = Math.max(s.lock, WW.randRange(LOCK[0], LOCK[1])); s.pursT = 0;
    }
    s.mt += dt;
    // gunsight lead: aim where the foe will be when the rounds arrive
    const tof = dist / (BV + p.speed * 0.3), fs = f.speed;
    const lx = f.x + Math.cos(f.heading) * fs * tof, lz = f.z + Math.sin(f.heading) * fs * tof, ly = f.y + (f.vy || 0) * tof;
    const ang = WW.angleDiff(p.heading, Math.atan2(lz - p.z, lx - p.x));
    const aspect = Math.abs(WW.angleDiff(p.heading, bearing(p, f)));
    let can = false, keep = false;
    switch (s.mode) {
      case 'pursue': {
        const tt = Math.min(1.2, dist / 45); // turn inside the foe toward an intercept point, close in
        const ix = f.x + Math.cos(f.heading) * fs * tt, iz = f.z + Math.sin(f.heading) * fs * tt;
        const tx = dist < RANGE ? lx : ix, tz = dist < RANGE ? lz : iz;
        p.turnTo(Math.atan2(tz - p.z, tx - p.x), dt, rate(p, 1.1));
        climb(p, dist < 7 ? Math.max(ly, f.y + 3) : ly, dt); // never fly into the foe
        energy(p, dt, dist > 16 ? pt.speed * 1.12 : dist > 9 ? Math.max(pt.speed * 0.75, fs + 1) : Math.max(pt.speed * 0.6, fs - 4)); // throttle back in the saddle
        const el = elev(p, lx, ly, lz);   // the pipper on the lead point in height too (fireRound pulls up to 0.1 rad)
        can = dist < RANGE && Math.abs(ang) < 0.12 && el < 0.16; keep = Math.abs(ang) < 0.22 && el < 0.24 && dist < RANGE;
        s.pursT = can ? 0 : (s.pursT || 0) + dt;
        if (s.pursT > (slasher(p) ? 4 : 7) && !s.weave) { setMode(s, 'extend'); s.ext = WW.randRange(1.6, 2.4); s.side = ang >= 0 ? -1 : 1; s.pursT = 0; break; } // no shot: break off, extend, come back for another pass
        if ((dist < 7 && aspect > 0.8) || dist < 4.5) { setMode(s, 'extend'); s.ext = WW.randRange(1.5, 2.4); s.side = ang >= 0 ? -1 : 1; break; } // overshoot
        if (slasher(p) && !s.weave && s.mt > 2.8 && aspect > 0.7) { setMode(s, 'extend'); s.ext = WW.randRange(1.8, 2.6); break; } // refuse the turning fight
        if (adv > 12 && dist > 26 && s.mt > 2) setMode(s, 'boom');
        break;
      }
      case 'boom': { // dive on the lead point at high speed, short burst, keep going
        const dh = Math.hypot(lx - p.x, lz - p.z) || 1;
        p.turnTo(Math.atan2(lz - p.z, lx - p.x), dt, rate(p, 0.9));
        const tv = WW.clamp((ly - p.y) / dh * p.speed, -pt.dive * 0.6, 3);
        p.vy += WW.clamp(tv - p.vy, -14 * dt, 14 * dt);
        energy(p, dt, pt.dive);
        const el = elev(p, lx, ly, lz);
        can = dist < RANGE && Math.abs(ang) < 0.14 && el < 0.16; keep = Math.abs(ang) < 0.22 && el < 0.24 && dist < RANGE;
        if (dist < 6 || (dist < 20 && aspect > 1.2) || adv < 1) { setMode(s, slasher(p) || WW.rand() < 0.4 ? 'zoom' : 'pursue'); }
        break;
      }
      case 'extend': // unload and run straight out, then come back around
        p.turnTo(p.heading + (s.mt < 0.6 ? (s.side || 1) * 0.5 : 0), dt, rate(p, 0.6)); climb(p, s.mt < 0.6 ? f.y + 5 : p.y + 1, dt); energy(p, dt, pt.speed * 1.2);
        if ((s.ext -= dt) <= 0 || dist > 55) setMode(s, slasher(p) || WW.rand() < 0.5 ? 'zoom' : 'pursue');
        break;
      case 'zoom': // trade speed for height, swinging gently back toward the foe
        p.turnTo(bearing(p, f), dt, rate(p, 0.45)); climb(p, f.y + 16, dt); energy(p, dt, pt.speed * 0.9);
        if (adv > 11 || s.mt > 5 || p.speed < pt.speed * 0.62) setMode(s, adv > 6 ? 'boom' : 'pursue');
        break;
    }
    if (can) s.lock = Math.max(s.lock, 2);     // on the gun line: stay with it
    guns(p, f, s, dt, can, keep);
  }

  WW.dogfight = {
    // Plane.fighter() `if (f)` branch: one step of air combat against foe f.
    fight(p, f, dt) {
      const s = st(p);
      s.lock -= dt; s.defCool -= dt; if (s.weave) s.weave = Math.max(0, s.weave - dt);
      if (s.def && defend(p, s, dt)) { guns(p, null, s, dt, false, false); return; }   // breaking: only a snapshot at a plane that crosses the nose
      if (s.defCool <= 0) {
        const q = threat(p, 34);
        s.threatT = q ? s.threatT + dt : 0;
        if (q && s.threatT > s.react) { startDefence(p, s, q); if (defend(p, s, dt)) return; }
      }
      offence(p, f, s, dt);
    },
    // Fighter target pick (scan): stick with a foe, but answer anyone sitting on our tail.
    // A committed fight (lock, set per engagement in offence) is kept through its passes; the defence against a
    // fighter on the tail runs inside fight() without dropping the foe, so engagements do not flicker.
    pick(p, best) {
      const s = st(p), cur = p.foe;
      // the foe behind or out of reach and another enemy in front, close: take the one in front (a bomber first)
      if (cur && cur.alive && (d3(p, cur) > SWITCH_D || noseOff(p, cur.x, cur.y, cur.z) > SWITCH_BEHIND)) {
        const q = ahead(p, FRONT_R, FRONT_CONE, 0.15);
        if (q && q !== cur && d3(p, q) < d3(p, cur)) { s.lock = 0; DS.switches = (DS.switches || 0) + 1; return q; }
      }
      if (s.lock > 0 && cur && cur.alive && d3(p, cur) < 190) return cur;   // the CAP tally is at 130 u (air_cap.js ENGAGE), plus the height
      const q = threat(p, 45);
      if (q && (!slasher(p) || !s.def)) return q;
      for (const m of elementMates(p)) { const t = threat(m, 60); if (t && d3(p, t) < 90) return t; } // cover the leader / wingman
      if (cur && cur.alive && cur !== best && (!best || d3(p, cur) < d3(p, best) * 1.5 + 10) && d3(p, cur) < (best ? 120 : 140)) return cur;
      return best;
    },
    // Plane.update() hook for bombers: weave a little and close up on the nearest friendly bomber under attack.
    jink(p, dt) {
      if (!(dt > 0) || !p.alive || p.phase || (p.state !== 'transit' && p.state !== 'attack')) return;
      const s = st(p);
      if ((s.chkT -= dt) <= 0) {
        s.chkT = 0.3; s.from = threat(p, 36); s.mate = null;
        if (s.from) {
          let bd = 30;
          for (const w of WW.world.planes) {
            if (w === p || !w.alive || w.carrier !== p.carrier || w.kind === 'fighter' || !w.ordnance) continue;
            const d = d3(w, p); if (d < bd && d > 6) { bd = d; s.mate = w; }
          }
        }
      }
      if (!s.from) return;
      s.jinkPh += dt;
      let dh = Math.sin(s.jinkPh * 2.6) * 0.55 * dt;
      if (s.mate) dh += WW.clamp(WW.angleDiff(p.heading, bearing(p, s.mate)), -0.35, 0.35) * dt;
      p.heading += dh; p.turn += dh / dt;
      p.vy += Math.sin(s.jinkPh * 1.9 + 1) * 2.5 * dt;
    },
    // WW.air.launch() hook: nation flight stats.
    equip(p) {
      if (!WW.planeType) return;
      p.pt = WW.planeType(p.kind, p.nation); p.hp = p.maxHp = p.pt.hp;
    },
    update: updateTracers,
    clearAll: clearTracers,
    threat, noseOff, ahead, _k: { guns, energy, rate, climb, BV, RANGE }, _tracers: T, stats: DS
  };
  // A fighter on its way home (or in the landing circle) still fights back when an enemy fighter gets on its tail:
  // it breaks, weaves or turns on the attacker while the threat lasts, then carries on home (state stays 'return').
  if (WW.Plane) {
    const home0 = WW.Plane.prototype.goHome;
    WW.Plane.prototype.goHome = function (dt) {
      if (this.kind === 'fighter' && this.alive && this.fuel > 6 && !(this.carrier && this.carrier.isBase) && dt > 0) {
        const s = st(this);
        s.homeT = (s.homeT || 0) - dt;
        if ((s.homeChk = (s.homeChk || 0) - dt) <= 0) {
          s.homeChk = 0.4;
          const q = threat(this, 40);
          if (q && q !== s.homeQ) { s.homeQ = q; s.homeT = WW.randRange(4, 6); DS.homeFights = (DS.homeFights || 0) + 1; }
          else if (!q && s.homeT <= 0) s.homeQ = null;    // the fight lasts a few passes, then home
        }
        const q = s.homeQ;
        if (q && q.alive && d3(this, q) < 70) { this.foe = q; WW.dogfight.fight(this, q, dt); return; }
        if (this.foe) this.foe = null;
      }
      return home0.apply(this, arguments);
    };
  }
  WW.on('roundStart', clearTracers);
  WW.on('setupStart', clearTracers);
})();
