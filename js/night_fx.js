// night_fx.js - WW.nightFx: the night battle lit by its own violence (visual only, render mode; Math.random only).
// sky_time.js calls update() every frame; it builds itself on the first call. Everything fades in with darkness, so
// by day nothing shows and nothing costs more than a few comparisons.
//   - A fixed pool of LIGHTS PointLights (never added or removed: the light count is compiled into every material),
//     handed each frame to the best sources near the camera: star shells, searchlight spots, burning ships, big-gun
//     flashes and secondary explosions. Idle lights sit at intensity 0.
//   - Star shells (night_ops.js, sim): a hot flare sprite under its parachute, a smoke thread, a pale pool of light
//     on the sea. Searchlights: pooled additive cones from the bridge to the lit ship, and a bright spot round it.
//   - Burning ships glow on the water (an orange pool). Tracers burn brighter.
//   - Camera: night candidates (WW.camHooks) for lit targets, searchlights and burning ships; a slow-motion beat when
//     a star shell bursts over what the director is filming; air stories end at dusk (no flying after dark).
window.WW = window.WW || {};
(function (WW) {
  const LIGHTS = 5, POOLS = 10, CONES = 6, FLARES = 8;
  let built = false, lights = [], pools = [], cones = [], flares = [], tex = null, flashes = [], n = 0, trailT = 0;
  const UP = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), w = new THREE.Vector3();
  const COL = { star: new THREE.Color(1, 0.94, 0.8), fire: new THREE.Color(1, 0.42, 0.12), beam: new THREE.Color(0.86, 0.92, 1),
                flash: new THREE.Color(1, 0.72, 0.38) };

  function softTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const CONE_V = 'varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
  const CONE_F = 'uniform vec3 col; uniform float op; varying vec2 vUv; varying vec3 vN, vV; void main(){ float e = abs(dot(normalize(vN), normalize(vV))); float a = pow(e, 2.0) * (1.0 - vUv.y * 0.8) * smoothstep(0.0, 0.04, vUv.y); gl_FragColor = vec4(col * a * op, 1.0); }';
  function build() {
    built = true;
    const S = WW.scene;
    tex = softTex();
    for (let i = 0; i < LIGHTS; i++) { const L = new THREE.PointLight(0xffffff, 0, 60, 2); L.castShadow = false; S.add(L); lights.push(L); }
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    for (let i = 0; i < POOLS; i++) {
      const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.renderOrder = 3; m.visible = false; S.add(m); pools.push(m);
    }
    const cg = new THREE.CylinderGeometry(1, 0.25, 1, 18, 1, true); cg.translate(0, 0.5, 0);
    for (let i = 0; i < CONES; i++) {
      const m = new THREE.Mesh(cg, new THREE.ShaderMaterial({ uniforms: { col: { value: COL.beam.clone() }, op: { value: 0 } }, vertexShader: CONE_V, fragmentShader: CONE_F,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 5; m.visible = false; m.frustumCulled = false; S.add(m); cones.push(m);
    }
    for (let i = 0; i < FLARES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.8, 1.7, 1.35), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.visible = false; s.renderOrder = 6; S.add(s); flares.push(s);
    }
    WW.on('shellFired', e => { if (n > 0.2 && e && (e.cal === 'big' || e.cal === 'med')) addFlash(e.x, (e.y || 2) + 1, e.z, e.cal === 'big' ? 2.2 : 1.4, 0.14, 70); });
    WW.on('shipBoom', e => { if (n > 0.2 && e) addFlash(e.x, (e.y || 2) + 3, e.z, 2.6, 0.6, 90); });
    WW.on('starShell', sh => { if (n > 0.1 && sh && sh.by && WW.fx) WW.fx.muzzleFlash(sh.fromX, 3, sh.fromZ); });
    WW.on('roundStart', () => { flashes.length = 0; });
    (WW.camHooks = WW.camHooks || []).push(camHook);
    wrapStory();
  }
  function addFlash(x, y, z, i, life, dist) { if (flashes.length > 6) flashes.shift(); flashes.push({ x, y, z, i, life, t: 0, dist }); }

  function topY(s) { return s.model && s.model._hg ? s.model._hg[2] : 2; }
  function burning(s) { return !s.removed && ((s.alive && (s.dmgCrit || (s.hp < 0.5 * s.maxHp && s.dmgSites && s.dmgSites.length))) || (s.sinking && (s.sinkT || 0) < 8)); }
  // ---- lights: gather sources, keep the best LIGHTS (near the camera, strongest first) ----
  const src = [];
  function gather(cam) {
    src.length = 0;
    const NO = WW.nightOps, add = (x, y, z, col, i, dist, pr, decay) => src.push({ x, y, z, col, i, dist, decay: decay || 2, s: pr / (1 + Math.hypot(x - cam.x, z - cam.z) / 150) });
    if (NO) {
      for (const sh of NO.shells) if (sh.lit) add(sh.x, sh.y, sh.z, COL.star, 1.1 * fade(sh), 170, 5, 1);
      for (const L of NO.lights) { const t = L.target; if (t) add(t.x, topY(t) + 8, t.z, COL.beam, 0.9, 40, 4); }
    }
    for (const s of WW.world.ships) if (burning(s)) add(s.x, topY(s) + 7, s.z, COL.fire, 0.85 * (0.85 + 0.15 * Math.sin(performance.now() * 0.013 + s.id)), 55, 3);
    for (const f of flashes) add(f.x, f.y, f.z, COL.flash, f.i * (1 - f.t / f.life), f.dist, 6);
    src.sort((a, b) => b.s - a.s);
  }
  function fade(sh) { const now = WW.time.now; return Math.min(1, (now - sh.lightAt) / 0.4) * Math.min(1, (sh.until - now) / 3); }

  function update(rdt) {
    if (WW.simOnly || !WW.scene) return;
    if (!built) build();
    const k = WW.daylight === undefined ? 1 : WW.daylight;
    n = WW.clamp((0.55 - k) / 0.4, 0, 1);
    for (let i = flashes.length - 1; i >= 0; i--) if ((flashes[i].t += rdt) >= flashes[i].life) flashes.splice(i, 1);
    if (n <= 0) { hideAll(); return; }
    const cam = WW.camera.position;
    gather(cam);
    for (let i = 0; i < LIGHTS; i++) {
      const L = lights[i], s = src[i];
      if (!s) { L.intensity = 0; continue; }
      L.position.set(s.x, s.y, s.z); L.color.copy(s.col); L.intensity = s.i * n; L.distance = s.dist; L.decay = s.decay;
    }
    let p = 0, f = 0, c = 0;
    const NO = WW.nightOps;
    // star shells: flare sprite, smoke thread, pool of light
    trailT -= rdt;
    const trail = trailT <= 0; if (trail) trailT = 0.25;
    if (NO) for (const sh of NO.shells) {
      if (!sh.lit) continue;
      const a = fade(sh);
      if (f < FLARES) { const s = flares[f++]; s.visible = true; s.position.set(sh.x, sh.y, sh.z); const sc = 5 + 1.5 * Math.random(); s.scale.set(sc, sc, 1); s.material.opacity = a; }
      if (p < POOLS) pool(pools[p++], sh.x, sh.z, sh.r * 1.5, COL.star, 0.11 * a * n);
      if (trail && WW.fx && WW.fx.trail) WW.fx.trail(sh.x, sh.y + 1.5, sh.z, false, 0.5, 4);
    }
    // searchlights: a cone from the bridge to the target, a bright spot round it
    if (NO) for (const L of NO.lights) {
      const s = L.ship, t = L.target;
      if (!s || !t || c >= CONES) continue;
      const hy = topY(s) + 2.5, fx = Math.cos(s.heading), fz = Math.sin(s.heading), sx = s.x + fx * s.stats.length * 0.12, sz = s.z + fz * s.stats.length * 0.12;
      v.set(t.x - sx, topY(t) * 0.6 + 0.5 - hy, t.z - sz); const len = v.length(); v.normalize();
      const m = cones[c++]; m.visible = true; m.position.set(sx, hy, sz); m.quaternion.setFromUnitVectors(UP, v);
      const rad = Math.max(3, len * 0.07); m.scale.set(rad, len, rad);
      m.material.uniforms.op.value = 0.42 * n * Math.min(1, (L.until - WW.time.now) / 1.5);
      if (p < POOLS) pool(pools[p++], t.x, t.z, t.stats.length * 1.6, COL.beam, 0.16 * n);
    }
    // burning ships: an orange pool on the water
    for (const s of WW.world.ships) if (p < POOLS && burning(s)) pool(pools[p++], s.x, s.z, s.stats.length * 2.2, COL.fire, 0.22 * n);
    for (; p < POOLS; p++) pools[p].visible = false;
    for (; f < FLARES; f++) flares[f].visible = false;
    for (; c < CONES; c++) cones[c].visible = false;
    tracers(n);
    revealBeat();
  }
  function pool(m, x, z, r, col, a) { m.visible = a > 0.005; m.position.set(x, 0.18, z); m.scale.set(r, 1, r); m.material.color.copy(col).multiplyScalar(a); }
  function hideAll() {
    if (!built) return;
    for (const L of lights) L.intensity = 0;
    for (const m of pools) m.visible = false;
    for (const m of cones) m.visible = false;
    for (const s of flares) s.visible = false;
    tracers(0);
  }
  // tracers burn brighter in the dark (combat.js shared materials)
  let trM = null;
  function tracers(k) {
    const M = WW.combat && WW.combat._i && WW.combat._i.M;
    if (!M || !M.tracer) return;
    if (!trM) trM = { a: M.tracer.color.clone(), b: M.tracerRed.color.clone() };
    M.tracer.opacity = M.tracerRed.opacity = 0.55 + 0.4 * k;
    M.tracer.color.copy(trM.a).multiplyScalar(1 + 1.2 * k); M.tracerRed.color.copy(trM.b).multiplyScalar(1 + 1.2 * k);
  }
  // A star shell bursting over what the director films: a slow-motion beat (camera_action.js limits how often).
  const seen = new Set();
  function revealBeat() {
    const NO = WW.nightOps, sh0 = WW.cam && WW.cam._shot && WW.cam._shot();
    if (!NO || !sh0) return;
    for (const sh of NO.shells) {
      if (!sh.lit || seen.has(sh)) continue;
      seen.add(sh);
      const sj = sh0.subj;
      if (sj && WW.dist(sj.x, sj.z, sh.x, sh.z) < sh.r + 30 && WW.camAction && WW.camAction.slowmo) WW.camAction.slowmo();
    }
    if (seen.size > 40) seen.clear();
  }
  // Night camera candidates: lit targets first, then searchlights and burning ships.
  function camHook(add, dur) {
    if (n < 0.4) return;
    const NO = WW.nightOps;
    if (NO) {
      for (const sh of NO.shells) {
        if (!sh.lit) continue;
        let best = null, bd = sh.r * sh.r;
        for (const s of WW.world.ships) if (s.alive && s.nation !== sh.nation && !s.submerged) { const d = WW.dist2(s.x, s.z, sh.x, sh.z); if (d < bd) { bd = d; best = s; } }
        if (best) add(9.5, 'orbit', best, { r: best.stats.length * 1.5 + 24, dur: dur(12, 16), w: 0.04, hgt: 0.26 });
      }
      for (const L of NO.lights) if (L.ship && L.ship.alive) add(8.5, 'flyby', L.ship, { dur: dur(12, 15) });
    }
    for (const s of WW.world.ships) if (s.alive && burning(s) && s.type !== 'pt') add(7.5, 'orbit', s, { r: s.stats.length * 1.4 + 16, dur: dur(12, 16), w: 0.045 });
  }
  // No flying after dusk: air stories end, and none start (camera_story.js).
  function wrapStory() {
    const S = WW.camStory;
    if (!S || S.pick.night) return;
    const dark = () => WW.dayNight && !WW.dayNight.canFly();
    const pick = S.pick;
    S.pick = function () { if (dark()) { if (S.active && S.active()) S.stop(); return null; } return pick.apply(this, arguments); };
    S.pick.night = true;
    if (S.toggle) { const tg = S.toggle; S.toggle = function () { if (dark() && !(S.active && S.active())) return 'Follow: no flying at night'; return tg.apply(this, arguments); }; }
    if (S.follow) { const fo = S.follow; S.follow = function () { if (dark()) return false; return fo.apply(this, arguments); }; }
  }
  WW.nightFx = { update, stats: () => ({ lights: lights.filter(L => L.intensity > 0).length, pools: pools.filter(m => m.visible).length, cones: cones.filter(m => m.visible).length }) };
})(window.WW);
