// night_fx.js - WW.nightFx: the night battle lit by its own violence (visual only, render mode; Math.random only).
// sky_time.js calls update() every frame; it builds itself on the first call. Everything fades in with darkness, so
// by day nothing shows and nothing costs more than a few comparisons.
//   - A fixed pool of LIGHTS PointLights (never added or removed: the light count is compiled into every material),
//     handed each frame to the best sources near the camera: star shells, searchlight spots, burning ships, big-gun
//     flashes and secondary explosions. Idle lights sit at intensity 0.
//   - Star shells (night_ops.js, sim): a hot flare sprite under its parachute, a smoke thread, a pale pool of light
//     on the sea. Searchlights: pooled additive cones from the bridge to the lit ship, and a bright spot round it.
//   - Burning ships are lit by their own fires: a dim deep red-orange light at each of the biggest fires (deck or
//     superstructure height, among the flames), flickering on noise with gusts and flare-ups, so the superstructure by
//     the fire and the underside of its smoke catch the glow and the rest of her stays a dark silhouette. Their
//     reflection is a broken, shimmering streak on the water toward the camera, sized by how badly she burns.
//     Tracers burn brighter.
//   - Camera: at sunrise / sunset a big ship steaming into the sun (a silhouette shot); night candidates (WW.camHooks)
//     for lit targets, searchlights and burning ships; a slow-motion beat when
//     a star shell bursts over what the director is filming; air stories end at dusk (no flying after dark).
window.WW = window.WW || {};
(function (WW) {
  const LIGHTS = 5, POOLS = 10, CONES = 6, FLARES = 8, STREAKS = 5;
  let built = false, lights = [], pools = [], cones = [], flares = [], streaks = [], tex = null, flashes = [], n = 0, trailT = 0;
  const UP = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), w = new THREE.Vector3();
  const COL = { star: new THREE.Color(1, 0.94, 0.8), fire: new THREE.Color(1, 0.3, 0.07), beam: new THREE.Color(0.86, 0.92, 1),
                flash: new THREE.Color(1, 0.72, 0.38) };

  function softTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  // the fire's reflection: broken glints across the streak (canvas x runs along it, y across), scrolled by the shader
  function glintTex() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * 128, w = 1 + Math.random() * 2.5, h = 4 + Math.random() * 22, y = 32 + (Math.random() - 0.5) * (64 - h) - h / 2, b = 90 + Math.random() * 165;
      g.fillStyle = `rgb(${b | 0},${b | 0},${b | 0})`; g.fillRect(x, y, w, h);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const STREAK_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const STREAK_F = `uniform sampler2D map; uniform vec3 col; uniform float t, seed; varying vec2 vUv;
    void main(){ float a = vUv.x, c = abs(vUv.y - 0.5) * 2.0, w = 0.45 + 0.55 * a;
      float env = (1.0 - a) * (1.0 - a) * smoothstep(1.0, 0.25, c / w) * smoothstep(0.0, 0.06, a);
      float g = texture2D(map, vec2(a * 2.5 - t * 0.21 + seed, vUv.y * 0.8 + sin(a * 31.0 - t * 2.3 + seed * 7.0) * 0.06)).r;
      float h = texture2D(map, vec2(a * 1.7 + t * 0.13 + seed * 0.5, vUv.y * 0.6 + 0.37)).r;
      gl_FragColor = vec4(col * env * g * (0.4 + 0.9 * h), 1.0); }`;
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
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2); sg.translate(0.5, 0, 0); // from the fire (x 0) toward the camera (x 1)
    const gt = glintTex();
    for (let i = 0; i < STREAKS; i++) {
      const m = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: { map: { value: gt }, col: { value: new THREE.Color() }, t: { value: 0 }, seed: { value: Math.random() } },
        vertexShader: STREAK_V, fragmentShader: STREAK_F, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.renderOrder = 3; m.visible = false; m.frustumCulled = false; S.add(m); streaks.push(m);
    }
    for (let i = 0; i < FLARES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.8, 1.7, 1.35), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.visible = false; s.renderOrder = 6; S.add(s); flares.push(s);
    }
    WW.on('shellFired', e => { if (n > 0.2 && e && (e.cal === 'big' || e.cal === 'med')) addFlash(e.x, (e.y || 2) + 1, e.z, e.cal === 'big' ? 2.2 : 1.4, 0.14, 70); });
    WW.on('shipBoom', e => { if (n > 0.2 && e) { addFlash(e.x, (e.y || 2) + 3, e.z, 1.8, 0.35, 70); if (e.ship) flareShip(e.ship); } });   // short: a flash, not a floodlight
    WW.on('starShell', sh => { if (n > 0.1 && sh && sh.by && WW.fx) WW.fx.muzzleFlash(sh.fromX, 3, sh.fromZ); });
    WW.on('roundStart', () => { flashes.length = 0; });
    (WW.camHooks = WW.camHooks || []).push(camHook);
    wrapStory();
  }
  // flashes at one spot in the same instant (a sinking ship's boom, her break and the blast all at once) merge into one:
  // the brightest, not their sum
  function addFlash(x, y, z, i, life, dist) {
    for (const f of flashes) if (f.t < 0.25 && Math.abs(f.x - x) + Math.abs(f.z - z) < 8) {
      const left = f.i * (1 - f.t / f.life);
      if (i > left) { f.life = Math.max(life, f.life - f.t); f.i = i; f.t = 0; f.dist = Math.max(dist, f.dist); f.x = x; f.y = y; f.z = z; }
      return;
    }
    if (flashes.length > 6) flashes.shift(); flashes.push({ x, y, z, i, life, t: 0, dist });
  }

  function topY(s) { return s.model && s.model._hg ? s.model._hg[2] : 2; }
  function burning(s) { return !s.removed && ((s.alive && (s.dmgCrit || (s.hp < 0.5 * s.maxHp && s.dmgSites && s.dmgSites.length))) || (s.sinking && (s.sinkT || 0) < 8)); }
  // ---- lights: gather sources, keep the best LIGHTS (near the camera, strongest first) ----
  const src = [];
  function gather(cam, rdt) {
    src.length = 0;
    const NO = WW.nightOps, add = (x, y, z, col, i, dist, pr, decay) => src.push({ x, y, z, col, i, dist, decay: decay || 2, s: pr / (1 + Math.hypot(x - cam.x, z - cam.z) / 150) });
    if (NO) {
      for (const sh of NO.shells) if (sh.lit) add(sh.x, sh.y, sh.z, COL.star, 1.1 * fade(sh), 170, 5, 1);
      for (const L of NO.lights) { const t = L.target; if (t) add(t.x, topY(t) + 8, t.z, COL.beam, 0.9, 40, 4); }
    }
    collectFires(rdt);
    let fc = 0;
    for (const F of fireList) {
      // light from the fires themselves: the two biggest, at deck / superstructure height among the flames; more and
      // bigger fires burn brighter (the two lights carry the rest), a small fire is a small glow
      const k = Math.min(1.7, Math.sqrt(F.src.length / Math.min(2, F.src.length)));
      for (let j = 0; j < Math.min(2, F.src.length); j++) {
        const q = F.src[j], col = fireCols[fc++ % fireCols.length], hot = Math.min(1, Math.max(0, q.f - 0.9));
        col.copy(COL.fire).lerp(COL.flash, hot * 0.6); // a flare-up burns yellower
        add(q.x + (Math.random() - 0.5) * 0.3 * q.f, q.y + 0.8 + 0.3 * q.sev, q.z + (Math.random() - 0.5) * 0.3 * q.f, col,
          0.26 * (0.5 + 0.4 * q.sev) * q.f * k, 8 + 5 * q.sev + 4 * Math.min(1, q.f - 1), 3 * (0.6 + 0.4 * q.sev) / (1 + j), 2);
      }
    }
    for (const f of flashes) add(f.x, f.y, f.z, COL.flash, f.i * (1 - f.t / f.life), f.dist, 6);
    src.sort((a, b) => b.s - a.s);
  }
  // ---- fires: per ship, the sites aflame (damage.js dmgSites), each with its own render-only flicker ----
  const fstate = new WeakMap(), fireList = [], fireCols = [];
  for (let i = 0; i < 2 * LIGHTS + 2; i++) fireCols.push(new THREE.Color());
  // gusts (a random walk between levels), a quick shimmer at three rates, and now and then a flare-up that dies away
  function flick(key, sev, rdt, t) {
    let st = fstate.get(key);
    if (!st) { st = { ph: Math.random() * 100, g: 1, gt: 1, gT: 0, fl: 0 }; fstate.set(key, st); }
    if ((st.gT -= rdt) <= 0) { st.gT = 0.12 + Math.random() * 0.55; st.gt = 0.5 + Math.random() * 0.75; }
    st.g += (st.gt - st.g) * Math.min(1, rdt * 5);
    if (Math.random() < rdt * (0.04 + 0.04 * sev)) st.fl = Math.max(st.fl, 0.4 + Math.random() * 0.7);
    st.fl *= Math.exp(-rdt * 3.5);
    const p = st.ph, w = 0.5 * Math.sin(t * 6.3 + p) + 0.3 * Math.sin(t * 11.9 + p * 1.7) + 0.2 * Math.sin(t * 21.7 + p * 2.9);
    return Math.max(0.2, st.g * (1 + 0.25 * w) + st.fl);
  }
  // a secondary explosion: every fire aboard flares at once
  function flareShip(s) {
    const S = s.dmgSites || [];
    for (const q of S) { const st = fstate.get(q); if (st) st.fl = Math.max(st.fl, 1.6); }
    const st = fstate.get(s); if (st) st.fl = Math.max(st.fl, 1.6);
  }
  function collectFires(rdt) {
    fireList.length = 0;
    const t = performance.now() / 1000, D = WW.damage;
    for (const s of WW.world.ships) {
      if (s.removed || s.wreck || !s.group) continue;
      const S = s.dmgSites, src = [];
      if (S && D && D.siteWorld) for (let i = 0; i < S.length; i++) {
        const q = S[i]; if (!(q.fire > 0)) continue;
        const p = D.siteWorld(s, i); if (!p || p.y < 0.05 || (s.type === 'submarine' && s.depthY < -0.6)) continue;
        const sev = Math.min(3, q.sev || 1), f = flick(q, sev, rdt, t);
        src.push({ x: p.x, y: p.y, z: p.z, sev, f });
      }
      // a ship going down without hit sites burns along her length (ship_sinking.js)
      if (!src.length && s.sinking && (s.sinkT || 0) < 6 && !(S && S.length)) src.push({ x: s.x, y: topY(s) * 0.5, z: s.z, sev: 1.5, f: flick(s, 1.5, rdt, t) });
      if (!src.length) continue;
      let str = 0, x = 0, z = 0, wt = 0;
      for (const q of src) { const a = (0.35 + 0.3 * q.sev) * q.f; str += a; x += q.x * a; z += q.z * a; wt += a; }
      src.sort((a, b) => b.sev * b.f - a.sev * a.f);
      fireList.push({ s, src, str: Math.min(3, str), x: x / wt, z: z / wt });
    }
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
    gather(cam, rdt);
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
    // burning ships: a broken, flickering reflection streaked across the water toward the camera (nearest first)
    let k2 = 0;
    if (fireList.length) {
      fireList.sort((a, b) => WW.dist2(a.x, a.z, cam.x, cam.z) - WW.dist2(b.x, b.z, cam.x, cam.z));
      const tt = performance.now() / 1000;
      for (const F of fireList) {
        if (k2 >= STREAKS) break;
        const m = streaks[k2++], L = F.s.stats.length, dx = cam.x - F.x, dz = cam.z - F.z, d = Math.hypot(dx, dz) || 1;
        const f = F.src[0].f, len = Math.min(d * 0.8, L * (0.5 + 0.35 * F.str) + 4), wid = L * 0.07 + 0.8 + 0.7 * F.str;
        m.visible = true; m.position.set(F.x, 0.2, F.z); m.rotation.set(0, -Math.atan2(dz, dx), 0);
        m.scale.set(len, 1, wid * (0.9 + 0.2 * Math.random()));
        m.material.uniforms.col.value.copy(COL.fire).multiplyScalar(0.6 * n * Math.min(1.6, 0.35 + 0.35 * F.str) * (0.6 + 0.4 * f));
        m.material.uniforms.t.value = tt;
      }
    }
    for (; k2 < STREAKS; k2++) streaks[k2].visible = false;
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
    for (const m of streaks) m.visible = false;
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
    // The sun on the horizon (dawn or dusk, elevation -1.5 .. 8 deg): chase a big ship steaming toward it, so it rides
    // in silhouette against the glowing sky and the gold path on the water.
    const D = WW.dayNight;
    if (D && D.sunElev > -1.5 && D.sunElev < 8) {
      for (const s of WW.world.ships) {
        if (!s.alive || s.sinking || !(s.type === 'battleship' || s.type === 'cruiser' || s.type === 'carrier')) continue;
        if (Math.cos(s.heading - D.sunAz) > 0.75) add(8.8, 'chase', s, { dur: dur(14, 18) });
      }
    }
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
  // No flying after dusk: the director's own air stories end, and none start (camera_story.js). The user's story (key F,
  // a click on a plane still up at last light) runs on until its plane lands or falls; F itself (camera_follow.js)
  // goes to the night gun action when no plane is up, so it is not gated here.
  function wrapStory() {
    const S = WW.camStory;
    if (!S || S.pick.night) return;
    const dark = () => WW.dayNight && !WW.dayNight.canFly();
    const user = () => { const st = S.story && S.story(); return !!(st && st.user); };
    const pick = S.pick;
    S.pick = function () { if (dark() && !user()) { if (S.active && S.active()) S.stop(); return null; } return pick.apply(this, arguments); };
    S.pick.night = true;
  }
  // a big flash that lights the scene at night (fx_critical.js: a magazine, a hangar going up)
  function flash(x, y, z, i, life, dist) { if (n > 0.2) addFlash(x, y, z, i, life, dist); }
  WW.nightFx = { update, flash, stats: () => ({ lights: lights.filter(L => L.intensity > 0).length, pools: pools.filter(m => m.visible).length, cones: cones.filter(m => m.visible).length,
    streaks: streaks.filter(m => m.visible).length, fires: fireList.length }) };
})(window.WW);
