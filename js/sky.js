// sky.js (integrator): sky dome, lights, fog. Soft "toy box" daylight.
window.WW = window.WW || {};
(function (WW) {
  // Golden hour: a low warm sun in the west-north-west, peach horizon near the sun, lavender-blue
  // elsewhere, a gentle blue zenith. Palettes are pastel (about 20% desaturated).
  const SUN_DIR = new THREE.Vector3(-0.86, 0.36, 0.36).normalize();   // ~21 degrees above the horizon
  const C = h => WW.pastel ? WW.pastel(h, 0.1) : new THREE.Color(h);
  const HORIZON = 0xc4dcf2, ZENITH = 0x3f7fd6, SUN_SIDE = 0xffc89a, AWAY = 0xb4d2f2, SUN_GLOW = 0xffe0b0, FOG = 0xc4dcf2;
  let dome = null, sun = null, hemi = null, clouds = null;

  function init() {
    const scene = WW.scene;
    scene.background = C(HORIZON);
    scene.fog = new THREE.Fog(C(FOG), 650, 2300); // haze only far out, lavender-peach like the horizon
    // Soft light: a dominant cool-lavender sky fill so nothing goes dark, plus a modest peach-gold sun.
    hemi = new THREE.HemisphereLight(C(0xe6ecfa), C(0xc4b8d8), 0.72);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(C(0xffc890), 1.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    const sc = sun.shadow.camera; sc.near = 10; sc.far = 1600;
    setShadowSize(120);
    scene.add(sun); scene.add(sun.target);
    const mat = new THREE.ShaderMaterial({
      uniforms: { zenith: { value: C(ZENITH) }, sunSide: { value: C(SUN_SIDE) }, away: { value: C(AWAY) },
                  glow: { value: C(SUN_GLOW) }, sunDir: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 zenith; uniform vec3 sunSide; uniform vec3 away; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;',
        'void main(){',
        '  vec3 d = normalize(vDir);',
        '  float h = clamp(d.y, 0.0, 1.0);',
        '  vec2 az = normalize(d.xz + 1e-5), sa = normalize(sunDir.xz);',
        '  float toward = dot(az, sa) * 0.5 + 0.5;',                       // 1 = looking at the sun
        '  vec3 horizon = mix(away, sunSide, pow(toward, 5.0));',
        '  vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.5, h), 0.6));',
        '  float s = max(dot(d, sunDir), 0.0);',
        '  c = mix(c, glow, pow(s, 10.0) * 0.55 + pow(s, 300.0) * 0.6);',   // soft halo + soft sun disc
        '  if (d.y < 0.0) c = horizon;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false // authored at display colour, like the fog
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
    dome.renderOrder = -10; dome.frustumCulled = false;
    scene.add(dome);
    buildClouds(scene);
  }
  // 4-step soft ramp for toon clouds (smooth enough to read as soft, still cartoony)
  function cloudRamp() {
    const d = new Uint8Array([150, 150, 150, 255, 196, 196, 196, 255, 232, 232, 232, 255, 255, 255, 255, 255]);
    const t = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }
  // Soft puffy low-poly clouds that drift slowly and cast soft shadows on the sea.
  function buildClouds(scene) {
    const geo = new THREE.SphereGeometry(1, 20, 14); // smooth soft blobs
    const mat = new THREE.MeshToonMaterial({ color: 0xeee8e2, emissive: C(0xb8c4e6), emissiveIntensity: 0.26, gradientMap: cloudRamp(), fog: false }); // soft toon: warm on the sun side, cool in shade
    clouds = new THREE.Group(); clouds.name = 'clouds';
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cx = WW.cfg.MAP_W / 2, cz = WW.cfg.MAP_H / 2;
    for (let i = 0; i < 34; i++) {
      const c = new THREE.Group(), n = 4 + Math.floor(r() * 4), s = 14 + r() * 16;
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, mat), k2 = (k / (n - 1)) - 0.5, rs = s * (0.55 + r() * 0.5) * (1 - Math.abs(k2) * 0.6);
        m.scale.set(rs, rs * 0.75, rs); m.position.set(k2 * s * 2.6, (r() - 0.3) * s * 0.4, (r() - 0.5) * s * 0.9);
        c.add(m); // no shadow casting: big soft cloud shadows read as dark blots at this scale
      }
      const a = r() * Math.PI * 2, d = i < 8 ? r() * 600 : 650 + r() * 1100; // a few over the map, most toward the horizon
      c.position.set(cx + Math.cos(a) * d, 110 + r() * 80, cz + Math.sin(a) * d);
      c.rotation.y = r() * Math.PI;
      clouds.add(c);
    }
    scene.add(clouds);
  }
  let shadowSize = 0;
  function setShadowSize(s) {
    if (s === shadowSize) return;
    shadowSize = s;
    const sc = sun.shadow.camera; sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.updateProjectionMatrix();
  }
  // light-space basis, for snapping the shadow frustum to whole texels (no shimmer as the camera moves)
  const R = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
  const U = new THREE.Vector3().crossVectors(SUN_DIR, R).normalize();
  const tgt = new THREE.Vector3();
  function update(rdt) {
    const cam = WW.camera;
    if (!dome || !cam) return;
    dome.position.copy(cam.position);
    if (clouds) { // drift with the wind; wrap far downwind back upwind. Hidden in the overview (it looks down through them)
      clouds.visible = !(WW.cam && WW.cam.isOverview());
      const dt = Math.min(0.1, rdt || 0);
      for (const c of clouds.children) { c.position.x += 1.2 * dt; if (c.position.x > WW.cfg.MAP_W / 2 + 2000) c.position.x -= 4000; }
    }
    // the sun's shadow box follows what the camera looks at
    const wide = !WW.cam || WW.cam.isOverview();
    setShadowSize(wide ? 520 : 120);   // the overview covers the whole 960 x 600 map
    const fog = WW.scene && WW.scene.fog; // the overview sits ~1300 units up: push the haze out so the far side of the map reads
    if (fog) { fog.near = wide ? 1500 : 650; fog.far = wide ? 4200 : 2300; }
    if (WW.cam && WW.cam.target) tgt.copy(WW.cam.target()); else tgt.set(WW.cfg.MAP_W / 2, 0, WW.cfg.MAP_H / 2);
    tgt.y = 0;
    const texel = (2 * shadowSize) / sun.shadow.mapSize.x;
    const u = Math.round(tgt.dot(R) / texel) * texel, v = Math.round(tgt.dot(U) / texel) * texel, w = tgt.dot(SUN_DIR);
    tgt.copy(R).multiplyScalar(u).addScaledVector(U, v).addScaledVector(SUN_DIR, w);
    sun.target.position.copy(tgt);
    sun.position.copy(tgt).addScaledVector(SUN_DIR, 700);
  }
  WW.sky = { init, update, HORIZON, SUN_DIR, sunColor: () => sun && sun.color };
})(window.WW);
