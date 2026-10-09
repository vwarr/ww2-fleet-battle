// base_life_fx.js - WW.baseLifeFx: the island base's birds and its night (visual only: Math.random, never WW.rand).
// Driven from base_fx.js each frame after base_life.js.
//  - Gooney birds (Laysan albatross, Midway's own): a flock standing about the open grass of the camp and the field's
//    edges, bobbing and bowing, waddling a few steps; now and then one runs, flaps hard and lifts off clumsily, glides
//    out over the reef in long slow circles and comes back down with a stumbling landing. A plane taxiing near them or
//    a bomb close by puts them up. Three InstancedMeshes (bodies, left and right wings), one matrix each per bird.
//  - Night: the camp's windows glow (models_base_life.js glow) until the alarm, then the blackout; when a raid is
//    known after dark the searchlights come on and sweep the sky toward the threat bearing, catching an enemy plane
//    that comes close (pooled additive cones; the lamp heads turn with them).
window.WW = window.WW || {};
(function () {
  'use strict';
  const R = Math.random, rr = (a, b) => a + (b - a) * R(), PI = Math.PI, NB = 16, CONES = 4;
  let base = null, birds = [], meshes = null, cones = [], sweeps = [];
  const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
  const BK = 0.85 * Math.pow(WW.cfg.PLANE_K || 1, 0.5) / 0.69;   // bird size: ~0.35 u long, 0.9 u span at the 0.82 plane scale
  const gy = (x, z) => Math.max(base.site.padH, -WW.terrain.depthAt(x, z));

  // ---------- models ----------
  function build() {
    const M = WW.models, mat = M._mat(0xffffff), B = WW.baseModels;
    let g = new THREE.Group();
    M._sph(g, 0xf6f3ea, 0.36, 0.16, 0.17, 0, 0.12, 0); M._sph(g, 0xf6f3ea, 0.12, 0.12, 0.11, 0.17, 0.22, 0);
    M._bar(g, 0xd9b77a, 0.1, 0.03, 0.03, 0.27, 0.2, 0); M._bar(g, 0x55504a, 0.03, 0.02, 0.06, 0.18, 0.25, 0); // the bill, the eye patch
    M._bar(g, 0x3e3a36, 0.1, 0.04, 0.09, -0.19, 0.13, 0); M._bar(g, 0x4c4842, 0.24, 0.05, 0.13, -0.02, 0.17, 0); // the tail, the folded wings' dark top
    M._bar(g, 0xd6c4b2, 0.03, 0.08, 0.02, 0, 0, 0.04); M._bar(g, 0xd6c4b2, 0.03, 0.08, 0.02, 0, 0, -0.04);   // pink legs
    const body = B._bake(g);
    g = new THREE.Group(); M._bar(g, 0x4c4842, 0.16, 0.02, 0.45, 0.01, 0, 0.225); M._bar(g, 0xeeeae0, 0.08, 0.021, 0.3, -0.04, 0, 0.15); // a long thin wing along +z
    const wing = B._bake(g);
    meshes = [body, wing, wing].map(geo => { const m = new THREE.InstancedMesh(geo, mat, NB); m.count = 0; m.frustumCulled = false; m.castShadow = true; WW.scene.add(m); return m; });
    const cg = new THREE.CylinderGeometry(1, 0.2, 1, 18, 1, true); cg.translate(0, 0.5, 0);
    const V = 'varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
    const F = 'uniform vec3 col; uniform float op; varying vec2 vUv; varying vec3 vN, vV; void main(){ float e = abs(dot(normalize(vN), normalize(vV))); float a = pow(e, 2.0) * (1.0 - vUv.y * 0.85) * smoothstep(0.0, 0.03, vUv.y); gl_FragColor = vec4(col * a * op, 1.0); }';
    for (let i = 0; i < CONES; i++) {
      const m = new THREE.Mesh(cg, new THREE.ShaderMaterial({ uniforms: { col: { value: new THREE.Color(0.86, 0.92, 1) }, op: { value: 0 } }, vertexShader: V, fragmentShader: F,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 5; m.visible = false; m.frustumCulled = false; WW.scene.add(m); cones.push(m);
    }
  }
  // ---------- birds ----------
  function grassy(x, z) { const G = WW.baseLifePaths.grid; if (!G) return false; const q = G.L.toL(x, z), i = Math.round(q.u + 130), j = Math.round(q.v + 115); const c = j * 261 + i; return i >= 0 && j >= 0 && i < 261 && j < 231 && !G.wall[c] && G.cost[c] === 1; }
  function spot() { // open grass near the camp or the field's edge
    const D = (base.decor || []).filter(d => d.kind === 'hut' || d.kind === 'tent' || d.kind === 'drill' || d.kind === 'light' || d.kind === 'mg');
    for (let k = 0; k < 30; k++) {
      const d = D.length ? D[Math.floor(R() * D.length)] : base, a = R() * 2 * PI, r = rr(4, 16), x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
      if (grassy(x, z)) return { x, z };
    }
    return null;
  }
  function reset(b) {
    base = b; birds = [];
    for (let i = 0; i < NB; i++) { const s = spot(); if (s) birds.push({ x: s.x, z: s.z, y: 0, h: R() * 2 * PI, st: 'stand', t: rr(0, 20), vy: 0, ph: R() * 6.28, cx: 0, cz: 0, r: 0, w: 0, bow: 0 }); }
  }
  function birdStep(B, dt, now, scare) {
    B.t -= dt;
    if (B.st === 'stand') {
      if (scare(B) || B.t <= 0 && R() < 0.25) { B.st = 'run'; B.t = rr(1.2, 2); B.spd = 0; return; }
      if (B.t <= 0) { B.t = rr(4, 14); B.goal = R() < 0.5 ? { x: B.x + rr(-1.5, 1.5), z: B.z + rr(-1.5, 1.5) } : null; B.bow = R() < 0.4 ? 2 : 0; }
      if (B.goal) { const dx = B.goal.x - B.x, dz = B.goal.z - B.z, d = Math.hypot(dx, dz); if (d < 0.05 || !grassy(B.goal.x, B.goal.z)) B.goal = null; else { B.h = Math.atan2(dz, dx); const m = Math.min(d, 0.35 * dt); B.x += dx / d * m; B.z += dz / d * m; } }
      B.bow = Math.max(0, B.bow - dt);
    } else if (B.st === 'run') { // the take-off run: faster and faster, flapping, then up
      B.spd = Math.min(3.2, B.spd + 2.2 * dt); B.x += Math.cos(B.h) * B.spd * dt; B.z += Math.sin(B.h) * B.spd * dt;
      if (B.t <= 0) { B.st = 'fly'; B.vy = 1.4; B.t = rr(25, 60); const a = R() * 2 * PI; B.cx = B.x + Math.cos(a) * 30; B.cz = B.z + Math.sin(a) * 30; B.r = rr(14, 30); B.w = (R() < 0.5 ? 1 : -1) * 2.6 / B.r; }
    } else if (B.st === 'fly') { // long slow circles, now and then a few flaps to climb
      const a = Math.atan2(B.z - B.cz, B.x - B.cx) + B.w * dt; B.x = B.cx + Math.cos(a) * B.r; B.z = B.cz + Math.sin(a) * B.r; B.h = a + (B.w > 0 ? PI / 2 : -PI / 2);
      B.y = Math.min(B.y + B.vy * dt, 7); B.vy = Math.max(-0.2, B.vy - 0.08 * dt);
      if (B.t <= 0) { const s = spot(); if (s) { B.st = 'land'; B.goal = s; } else B.t = 10; }
    } else if (B.st === 'land') { // straight in, down, a stumble
      const dx = B.goal.x - B.x, dz = B.goal.z - B.z, d = Math.hypot(dx, dz); B.h = Math.atan2(dz, dx);
      const m = Math.min(d, 2.6 * dt); B.x += dx / (d || 1) * m; B.z += dz / (d || 1) * m; B.y = Math.max(0, Math.min(B.y, d * 0.25));
      if (d < 0.1) { B.st = 'stand'; B.y = 0; B.t = rr(6, 20); B.bow = 1.2; B.goal = null; }
    }
  }
  function drawBirds(cam, t) {
    let n = 0;
    for (const B of birds) {
      if ((B.x - cam.x) ** 2 + (B.z - cam.z) ** 2 > 130 * 130) continue;
      const fly = B.st !== 'stand', flap = B.st === 'run' || (B.st === 'fly' && B.vy > 0.3) || (B.st === 'land' && B.y < 1) ? Math.sin(t * 13 + B.ph) * 0.9 : Math.sin(t * 1.5 + B.ph) * 0.06;
      const y = (B.st === 'stand' ? gy(B.x, B.z) : Math.max(gy(B.x, B.z), base.site.padH + B.y)) + (B.st === 'run' ? Math.abs(Math.sin(t * 16 + B.ph)) * 0.05 : 0);
      const bow = B.bow > 0 ? Math.max(0, Math.sin(B.bow * 4)) * 0.6 : Math.sin(t * 2.2 + B.ph) * 0.05;
      _q.setFromEuler(_e.set(0, -B.h, B.st === 'fly' ? 0 : -bow, 'YXZ')); _p.set(B.x, y, B.z); _s.setScalar(BK);
      _m.compose(_p, _q, _s); meshes[0].setMatrixAt(n, _m);
      for (let k = 0; k < 2; k++) { // wings: folded along the back on the ground, spread in the air (flapping)
        const sd = k ? -1 : 1, open = fly ? 1 : 0.25;
        _w.compose(_p.set(0.0, 0.17, sd * 0.05), _q.setFromEuler(_e.set(sd * (fly ? flap : -1.35), fly ? 0 : sd * 1.4, 0, 'YXZ')), _s.set(1, 1, sd * open));
        meshes[1 + k].setMatrixAt(n, _w.premultiply(_m));
      }
      n++;
    }
    for (const m of meshes) { m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; }
  }
  // ---------- night: windows, blackout, searchlights ----------
  function night(dt, built, life) {
    const k = WW.daylight === undefined ? 1 : WW.daylight, n = WW.clamp((0.55 - k) / 0.4, 0, 1);
    if (built.glow) built.glow.visible = n > 0.25 && life.phase === 'peace';
    let c = 0;
    const al = base.alarm, raid = al && life.phase !== 'peace' && life.phase !== 'after' && n > 0.25;
    if (raid) {
      let near = null, nd = 140 * 140;
      for (const p of WW.world.planes) if (p.alive && p.nation !== base.nation && p.y > 4) { const d = (p.x - base.x) ** 2 + (p.z - base.z) ** 2; if (d < nd) { nd = d; near = p; } }
      for (const part of built.parts) {
        if (part.f.kind !== 'light' || !part.head || part.f.out || c >= CONES) continue;
        const S = sweeps[c] || (sweeps[c] = { ph: R() * 6.28, sp: rr(0.25, 0.4) }), hx = part.head.position.x, hy = part.head.position.y + 0.45, hz = part.head.position.z;
        S.ph += dt * S.sp;
        let az = Math.atan2(al.z - hz, al.x - hx) + Math.sin(S.ph) * 0.7, el = 0.75 + Math.sin(S.ph * 0.7 + c) * 0.3;
        if (near && c === 0) { az = Math.atan2(near.z - hz, near.x - hx); el = Math.atan2(near.y - hy, Math.hypot(near.x - hx, near.z - hz)); } // a plane caught in the beam
        part.head.rotation.y = -az; part.head.rotation.z = el;
        _v.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        const m = cones[c++], len = 150; m.visible = true; m.position.set(hx, hy, hz); m.quaternion.setFromUnitVectors(UP, _v); m.scale.set(len * 0.05, len, len * 0.05);
        m.material.uniforms.op.value = 0.38 * n;
      }
    }
    for (; c < CONES; c++) cones[c].visible = false;
  }
  // ---------- per frame (base_fx.js) ----------
  let lastT = 0, built0 = null;
  function update(rdt, b, built) {
    if (WW.simOnly || !WW.scene || !b || !b.decor || !WW.baseLifePaths || !WW.baseLifePaths.grid) return;
    if (!meshes) build();
    if (b !== base || built !== built0) { built0 = built; reset(b); lastT = WW.time.now; }
    const now = WW.time.now, dt = Math.max(0, Math.min(0.5, now - lastT)); lastT = now;
    const cam = WW.camera.position;
    if ((cam.x - b.x) ** 2 + (cam.z - b.z) ** 2 > 420 * 420) { for (const m of meshes) m.visible = false; for (const m of cones) m.visible = false; return; }
    const gp = WW.baseGroundFx && WW.baseGroundFx._ground ? WW.baseGroundFx._ground() : [], hit = now - (b.hitT || -1e9) < 1.5;
    const scare = B => (hit && Math.hypot(B.x - b.hitX, B.z - b.hitZ) < 30) || gp.some(g => g[4] && Math.hypot(g[0] - B.x, g[1] - B.z) < 7);
    if (dt > 0) for (const B of birds) birdStep(B, dt, now, scare);
    drawBirds(cam, performance.now() / 1000);
    night(rdt, built, WW.baseLife);
  }
  function clear() { base = null; birds = []; if (meshes) for (const m of meshes) { m.count = 0; m.visible = false; } for (const m of cones) m.visible = false; }
  WW.on('roundStart', clear); WW.on('setupStart', clear);
  WW.baseLifeFx = { update(rdt, b, built) { try { update(rdt, b, built); } catch (e) { if (!WW.baseLifeFx._err) { WW.baseLifeFx._err = e; console.error('baseLifeFx', e); } } }, get birds() { return birds; }, clear };
})();
