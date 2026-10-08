// sky.js (integrator): sky dome, lights, fog. Soft "toy box" daylight.
window.WW = window.WW || {};
(function (WW) {
  const HORIZON = 0xa6d6f2, ZENITH = 0x3d8ddb, SUN_GLOW = 0xfff0c8, FOG = 0xa6d6f2;
  const SUN_DIR = new THREE.Vector3(-120, 170, 90).normalize();
  let dome = null, sun = null, hemi = null, clouds = null;

  function init() {
    const scene = WW.scene;
    scene.background = new THREE.Color(HORIZON);
    scene.fog = new THREE.Fog(FOG, 700, 2400); // haze only far out, in the horizon blue
    // Soft light: a strong sky fill with a cool blue lower half (shadow sides go soft blue, never dark)
    // plus a gentle warm sun that casts soft shadows.
    hemi = new THREE.HemisphereLight(0xeef5ff, 0xc2d2e8, 1.02);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffeccc, 0.36);
    sun.position.copy(SUN_DIR).multiplyScalar(400);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 9; sun.shadow.blurSamples = 16; // wide, soft penumbra (VSM)
    const sc = sun.shadow.camera; sc.near = 10; sc.far = 1000;
    setShadowSize(110);
    scene.add(sun); scene.add(sun.target);
    const mat = new THREE.ShaderMaterial({
      uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) },
                  glow: { value: new THREE.Color(SUN_GLOW) }, sunDir: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 horizon; uniform vec3 zenith; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;',
        'void main(){',
        '  float h = clamp(vDir.y, 0.0, 1.0);',
        '  vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.5, h), 0.7));',
        '  float s = max(dot(normalize(vDir), sunDir), 0.0);',
        '  c = mix(c, glow, pow(s, 8.0) * 0.6 + pow(s, 64.0) * 0.4);',          // soft warm glow around the sun
        '  if (vDir.y < 0.0) c = horizon;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
    dome.renderOrder = -10; dome.frustumCulled = false;
    scene.add(dome);
    buildClouds(scene);
  }
  // Soft puffy low-poly clouds that drift slowly and cast soft shadows on the sea.
  function buildClouds(scene) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb8d0, emissiveIntensity: 0.35, flatShading: true, fog: false });
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
      const a = r() * Math.PI * 2, d = i < 8 ? r() * 400 : 450 + r() * 1000; // a few over the map, most toward the horizon
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
      for (const c of clouds.children) { c.position.x += 1.2 * dt; if (c.position.x > WW.cfg.MAP_W / 2 + 1800) c.position.x -= 3600; }
    }
    // the sun's shadow box follows what the camera looks at
    const wide = !WW.cam || WW.cam.isOverview();
    setShadowSize(wide ? 300 : 120);
    if (WW.cam && WW.cam.target) tgt.copy(WW.cam.target()); else tgt.set(WW.cfg.MAP_W / 2, 0, WW.cfg.MAP_H / 2);
    tgt.y = 0;
    const texel = (2 * shadowSize) / sun.shadow.mapSize.x;
    const u = Math.round(tgt.dot(R) / texel) * texel, v = Math.round(tgt.dot(U) / texel) * texel, w = tgt.dot(SUN_DIR);
    tgt.copy(R).multiplyScalar(u).addScaledVector(U, v).addScaledVector(SUN_DIR, w);
    sun.target.position.copy(tgt);
    sun.position.copy(tgt).addScaledVector(SUN_DIR, 400);
  }
  WW.sky = { init, update, HORIZON };
})(window.WW);
