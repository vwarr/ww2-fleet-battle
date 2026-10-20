// weather_fx.js - WW.weatherFx: how a rain squall looks (visual only, render mode; Math.random only). sky_time.js
// calls update() every frame; it builds itself on the first call. For each WW.weather cell (at most 4): a soft toy
// rain curtain (an open cylinder of falling streaks, thicker at its silhouette so it reads as a volume, fading at
// its foot and into the cloud) under a dark, low cloud deck of flattened puffs. The sea under it darkens and rings
// with raindrops (water.js rainC), and the fog closes in when the camera is in or near it (sky_time.js).
window.WW = window.WW || {};
(function (WW) {
  const N = 4, PUFFS = 11, H = 92;
  let built = false, curtains = [], decks = [], t = 0, cloudMat = null;
  const DAY = new THREE.Color(0.6, 0.64, 0.72), NIGHT = new THREE.Color(0.14, 0.17, 0.27), CDAY = new THREE.Color(0x7e8698), CNIGHT = new THREE.Color(0x283048);
  // the curtain's outline wobbles with the angle round the cell (a soft, uneven shower, not a tube)
  const V = `uniform float seed; varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vec3 p = position;
    float a = atan(p.z, p.x), w = 1.0 + 0.16 * sin(a * 3.0 + seed) + 0.09 * sin(a * 5.0 - seed * 1.7) - 0.1 * uv.y;
    p.xz *= w; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
  const F = `uniform vec3 col; uniform float op, time, seed; varying vec2 vUv; varying vec3 vN, vV;
    float h(float x){ return fract(sin(x * 91.7 + seed) * 43758.5453); }
    void main(){
      float x = vUv.x * 260.0, i = floor(x), fx = fract(x);
      float sp = 0.5 + h(i), y = fract(vUv.y * (3.0 + 2.0 * h(i + 7.0)) + time * sp * 0.9 + h(i + 3.0));
      float streak = smoothstep(0.5, 0.0, abs(fx - 0.5)) * smoothstep(0.0, 0.35, y) * (0.35 + 0.65 * h(i + 11.0));
      float edge = max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))); // a hair below 0 makes pow() NaN
      float a = (0.14 + 0.32 * pow(edge, 2.0)) * (0.4 + 0.6 * streak);
      a *= smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y)) * (0.75 + 0.25 * sin(vUv.x * 37.0 + seed));
      gl_FragColor = vec4(col, a * op);
    }`;
  function build() {
    built = true;
    const S = WW.scene, cg = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true); cg.translate(0, 0.5, 0);
    const pg = new THREE.SphereGeometry(1, 14, 10);
    const ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 160, 160, 160, 255, 210, 210, 210, 255, 240, 240, 240, 255]), 4, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.LinearFilter; ramp.needsUpdate = true;
    cloudMat = new THREE.MeshToonMaterial({ color: 0x9aa2b2, emissive: 0x2a3048, emissiveIntensity: 0.4, gradientMap: ramp });
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(cg, new THREE.ShaderMaterial({ uniforms: { col: { value: DAY.clone() }, op: { value: 0 }, time: { value: 0 }, seed: { value: i * 13.1 } },
        vertexShader: V, fragmentShader: F, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.renderOrder = 4; m.visible = false; m.frustumCulled = false; S.add(m); curtains.push(m);
      const g = new THREE.Group(); g.visible = false;
      for (let k = 0; k < PUFFS; k++) g.add(new THREE.Mesh(pg, cloudMat));
      S.add(g); decks.push(g);
    }
  }
  // lay a deck's puffs out for a cell once (stable while the cell lives)
  function layout(g, c) {
    if (g.cell === c) return;
    g.cell = c;
    g.children.forEach((m, k) => {
      const a = (k / PUFFS) * Math.PI * 2 + Math.random() * 0.6, d = k === 0 ? 0 : c.r * (0.3 + 0.5 * Math.random()), s = c.r * (0.24 + 0.14 * Math.random());
      m.position.set(Math.cos(a) * d, (Math.random() - 0.3) * 12, Math.sin(a) * d); m.scale.set(s, s * 0.55, s);
    });
  }
  // ---- rain round the camera (a typhoon everywhere; inside a squall): one draw of short streaks in a box that
  // follows the camera, falling and slanting with the wind in the vertex shader (wrapped, so nothing is updated per drop)
  const RN = 2600, BOX = new THREE.Vector3(150, 90, 150);
  let rainMesh = null;
  const RV = `uniform vec3 cam, box, drift; uniform float time; attribute float tip; varying float vA;
    void main(){
      vec3 p = position + drift * time;   // position: a random point in [0, box); drift: wind + fall (u/s)
      p = mod(p - cam + box * 0.5, box) - box * 0.5;   // wrapped round the camera
      p += normalize(drift) * tip * 3.2;               // the streak's other end, along the fall
      vec3 w = cam + p;
      vA = 1.0 - smoothstep(0.25, 0.5, length(p.xz) / box.x);
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`;
  const RF = `uniform vec3 col; uniform float op; varying float vA; void main(){ gl_FragColor = vec4(col, op * vA); }`;
  function buildRain() {
    const pos = new Float32Array(RN * 6), tip = new Float32Array(RN * 2);
    for (let i = 0; i < RN; i++) {
      const x = Math.random() * BOX.x, y = Math.random() * BOX.y, z = Math.random() * BOX.z;
      pos.set([x, y, z, x, y, z], i * 6); tip[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    rainMesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: { cam: { value: new THREE.Vector3() }, box: { value: BOX }, drift: { value: new THREE.Vector3(0, -40, 0) }, time: { value: 0 }, col: { value: new THREE.Color(0.75, 0.78, 0.82) }, op: { value: 0 } },
      vertexShader: RV, fragmentShader: RF, transparent: true, depthWrite: false, fog: false }));
    rainMesh.frustumCulled = false; rainMesh.renderOrder = 5; rainMesh.visible = false; WW.scene.add(rainMesh);
  }
  function rainUpdate(W, k) {
    const cam = WW.camera; if (!cam) return;
    const here = W.rain(cam.position.x, cam.position.z), low = 1 - WW.clamp((cam.position.y - 30) / 80, 0, 1);   // (from high up the streaks read as spindrift)
    const a = here * low * (WW.cam && WW.cam.isOverview && WW.cam.isOverview() ? 0 : 1);
    if (a < 0.02) { if (rainMesh) rainMesh.visible = false; return; }
    if (!rainMesh) buildRain();
    const u = rainMesh.material.uniforms, wd = WW.wind || { x: 0, z: 0 }, s = W.kind === 'typhoon' ? 26 : 12;
    rainMesh.visible = true; u.cam.value.copy(cam.position); u.time.value = t;
    u.drift.value.set(wd.x * s, -45, wd.z * s); u.op.value = 0.38 * a * (0.35 + 0.65 * k);
  }
  // ---- lightning (thunderstorm cells; a typhoon's rain bands now and then): a jagged bolt from the cloud to the sea,
  // a sky flash (sky_time.js reads flash()) and the thunder after it (audio_amb.js amb.thunder)
  let bolt = null, fl = 0, nextFl = 3, boltT = 0;
  function buildBolt() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
    bolt = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xeef2ff, transparent: true, fog: false }));
    bolt.frustumCulled = false; bolt.visible = false; bolt.renderOrder = 6; WW.scene.add(bolt);
  }
  function strike(c) {
    if (!bolt) buildBolt();
    const a = Math.random() * 6.283, d = Math.random() * c.r * 0.6, x0 = c.x + Math.cos(a) * d, z0 = c.z + Math.sin(a) * d;
    const P = bolt.geometry.attributes.position, n = P.count;
    let x = x0, z = z0;
    for (let i = 0; i < n; i++) { const y = H + 2 - (H + 2) * i / (n - 1); P.setXYZ(i, x, y, z); x += (Math.random() - 0.5) * 9; z += (Math.random() - 0.5) * 9; }
    P.needsUpdate = true; bolt.visible = true; boltT = 0.18; fl = 1;
    const cam = WW.camera, dist = cam ? Math.hypot(cam.position.x - x0, cam.position.z - z0) : 300;
    if (WW.audio && WW.audio.play) setTimeout(() => { try { WW.audio.play('amb.thunder', { x: x0, y: 40, z: z0, vol: WW.clamp(1.3 - dist / 1200, 0.35, 1) }); } catch (e) { /* audio off */ } }, Math.min(5000, dist * 6));
  }
  function lightning(W, rdt) {
    fl = Math.max(0, fl - (rdt || 0) * 5); if (fl > 0.35 && fl < 0.55 && Math.random() < 0.3) fl = 0.8;   // a flicker
    if (bolt && bolt.visible && (boltT -= rdt || 0) <= 0) bolt.visible = false;
    if ((W.kind !== 'thunder' && W.kind !== 'typhoon') || !W.cells.length) return;
    if ((nextFl -= rdt || 0) > 0) return;
    nextFl = W.kind === 'thunder' ? 2 + Math.random() * 7 : 6 + Math.random() * 14;
    strike(W.cells[Math.floor(Math.random() * W.cells.length)]);
  }
  function update(rdt) {
    if (WW.simOnly || !WW.scene) return;
    const W = WW.weather, cells = W ? W.cells : [];
    if (W) {
      rainUpdate(W, WW.daylight === undefined ? 1 : WW.daylight);
      lightning(W, rdt);
    }
    if (!built) { if (!cells.length) { t += rdt || 0; return; } build(); }
    t += rdt || 0;
    const k = WW.daylight === undefined ? 1 : WW.daylight, ov = WW.cam && WW.cam.isOverview && WW.cam.isOverview();
    cloudMat.color.copy(CNIGHT).lerp(CDAY, k); cloudMat.emissive.setRGB(0.1 + 0.07 * k, 0.12 + 0.07 * k, 0.2 + 0.08 * k);
    for (let i = 0; i < N; i++) {
      const c = cells[i], m = curtains[i], g = decks[i];
      if (!c) { m.visible = g.visible = false; continue; }
      m.visible = true; g.visible = !ov;
      m.position.set(c.x, 0, c.z); m.scale.set(c.r * 0.82, H, c.r * 0.82);
      const u = m.material.uniforms; u.time.value = t; u.op.value = 0.55 + 0.35 * c.dens; u.col.value.copy(NIGHT).lerp(DAY, k);
      layout(g, c); g.position.set(c.x, H + 4, c.z);
    }
  }
  WW.weatherFx = { update, flash: () => fl };
})(window.WW);
