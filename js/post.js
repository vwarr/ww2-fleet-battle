// post.js (integrator): a small post stack. The scene renders into an HDR render target; a cheap
// bloom (bright pass + separable blur at quarter resolution) is added back softly; then one
// fullscreen pass applies a soft filmic shoulder (tone mapping) and a gentle desaturation to everything.
// (Three's ACES greyed the pastel palette too much, so the curve is hand-rolled here.)
window.WW = window.WW || {};
(function (WW) {
  const BLOOM = { threshold: 1.25, knee: 0.3, strength: 0.2 };
  const GRADE = { exposure: 1.0, shoulder: 0.72, saturation: 0.9 };
  let r, rtScene, rtA, rtB, quad, qScene, qCam, mBright, mBlur, mComp, enabled = true;

  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  function mat(frag, uniforms, toneMapped) {
    return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: !!toneMapped });
  }
  function init() {
    r = WW.renderer;
    const opts = { type: THREE.HalfFloatType, depthBuffer: true };
    rtScene = new THREE.WebGLRenderTarget(4, 4, Object.assign({ samples: 4 }, opts));
    rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    rtB = rtA.clone();
    mBright = mat(`uniform sampler2D tex; uniform float threshold, knee; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = max(c.r, max(c.g, c.b));
        float w = smoothstep(threshold - knee, threshold + knee, l); gl_FragColor = vec4(c * w, 1.0); }`,
      { tex: { value: null }, threshold: { value: BLOOM.threshold }, knee: { value: BLOOM.knee } });
    mBlur = mat(`uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 s = texture2D(tex, vUv).rgb * 0.227;
        s += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * 0.316;
        s += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(s, 1.0); }`, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    // Filmic shoulder: colours below the shoulder stay exactly as authored (pastel palette intact);
    // brighter values roll off smoothly toward white, so sand, foam and flashes never clip flat.
    mComp = mat(`uniform sampler2D tex; uniform sampler2D bloom; uniform float strength, exposure, shoulder, saturation; varying vec2 vUv;
      vec3 roll(vec3 x) { vec3 over = max(x - shoulder, 0.0); return min(x, vec3(shoulder)) + (1.0 - shoulder) * (1.0 - exp(-over / (1.0 - shoulder))); }
      void main(){ vec3 c = (texture2D(tex, vUv).rgb + texture2D(bloom, vUv).rgb * strength) * exposure;
        c = roll(c);
        float l = dot(c, vec3(0.3, 0.59, 0.11));
        c = mix(vec3(l), c, saturation);
        gl_FragColor = vec4(c, 1.0);
      }`, { tex: { value: null }, bloom: { value: null }, strength: { value: BLOOM.strength },
            exposure: { value: GRADE.exposure }, shoulder: { value: GRADE.shoulder }, saturation: { value: GRADE.saturation } });
    qScene = new THREE.Scene(); qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mComp); quad.frustumCulled = false;
    qScene.add(quad);
    resize();
  }
  const sz = new THREE.Vector2();
  function resize() {
    if (!r) return;
    r.getDrawingBufferSize(sz);
    rtScene.setSize(sz.x, sz.y);
    const qw = Math.max(1, Math.round(sz.x / 4)), qh = Math.max(1, Math.round(sz.y / 4));
    rtA.setSize(qw, qh); rtB.setSize(qw, qh);
  }
  function pass(m, target) { quad.material = m; r.setRenderTarget(target); r.render(qScene, qCam); }
  function render(scene, camera) {
    if (!enabled || !rtScene) { r.setRenderTarget(null); r.render(scene, camera); return; }
    r.getDrawingBufferSize(sz);
    if (sz.x !== rtScene.width || sz.y !== rtScene.height) resize();
    r.setRenderTarget(rtScene); r.render(scene, camera);
    mBright.uniforms.tex.value = rtScene.texture; pass(mBright, rtA);
    for (let i = 0; i < 2; i++) { // two separable blur rounds at quarter resolution
      mBlur.uniforms.tex.value = rtA.texture; mBlur.uniforms.dir.value.set((1 + i) / rtA.width, 0); pass(mBlur, rtB);
      mBlur.uniforms.tex.value = rtB.texture; mBlur.uniforms.dir.value.set(0, (1 + i) / rtA.height); pass(mBlur, rtA);
    }
    mComp.uniforms.tex.value = rtScene.texture; mComp.uniforms.bloom.value = rtA.texture;
    pass(mComp, null);
  }
  // Night (sky_time.js, k = 1 - daylight): a lower bloom threshold and a stronger bloom, so gun flashes, fires,
  // star shells and searchlights glow against the dark; a touch more saturation keeps the moonlit blue clean.
  function setNight(k) {
    if (!mBright) return;
    mBright.uniforms.threshold.value = BLOOM.threshold - 0.45 * k;
    mComp.uniforms.strength.value = BLOOM.strength + 0.3 * k;
    mComp.uniforms.saturation.value = GRADE.saturation + 0.08 * k;
  }
  WW.post = { init, resize, render, setNight, toggle() { enabled = !enabled; return enabled; } };
})(window.WW);
