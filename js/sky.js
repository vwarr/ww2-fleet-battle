// sky.js (integrator): sky dome, lights, fog. Soft "toy box" daylight.
window.WW = window.WW || {};
(function (WW) {
  const HORIZON = 0xd6ecf4, ZENITH = 0x7fb9e6, SUN_GLOW = 0xfff1d8;
  const SUN_DIR = new THREE.Vector3(-120, 170, 90).normalize();
  let dome = null, sun = null, hemi = null;

  function init() {
    const scene = WW.scene;
    scene.background = new THREE.Color(HORIZON);
    scene.fog = new THREE.Fog(HORIZON, 320, 1500);
    hemi = new THREE.HemisphereLight(0xdcefff, 0xd8c8a8, 0.8);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1d8, 0.62);
    sun.position.copy(SUN_DIR).multiplyScalar(300);
    scene.add(sun); scene.add(sun.target);
    const mat = new THREE.ShaderMaterial({
      uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) },
                  glow: { value: new THREE.Color(SUN_GLOW) }, sunDir: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 horizon; uniform vec3 zenith; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;',
        'void main(){',
        '  float h = clamp(vDir.y, 0.0, 1.0);',
        '  vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.55, h), 0.8));',
        '  float s = max(dot(normalize(vDir), sunDir), 0.0);',
        '  c = mix(c, glow, pow(s, 6.0) * 0.45);',          // soft warm glow around the sun
        '  if (vDir.y < 0.0) c = horizon;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
    dome.renderOrder = -10; dome.frustumCulled = false;
    scene.add(dome);
  }
  function update() {
    const cam = WW.camera;
    if (!dome || !cam) return;
    dome.position.copy(cam.position);
  }
  WW.sky = { init, update, HORIZON };
})(window.WW);
