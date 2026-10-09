// air_tracers.js — WW.planeTracers: the plane guns' glowing tracer rounds (visual only: Math.random, nothing the sim
// reads). One instanced soft streak quad per round, additive and camera-facing, from a fixed pool (the oldest round is
// reused). air_dogfight.js fireRound spawns a round from each wing gun along the toed-in stream (and a muzzle flash);
// WW.dogfight.update steps them. Split out of air_dogfight.js. Load before air_dogfight.js.
window.WW = window.WW || {};
(function () {
  const N = 240;           // tracer pool size (oldest round is reused)
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

  WW.planeTracers = { spawn: spawnTracer, update: updateTracers, clear: clearTracers, T };
})();
