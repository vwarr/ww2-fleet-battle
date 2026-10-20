// post.js (integrator): a small post stack. The scene renders into an HDR render target; a cheap
// bloom (bright pass + separable blur at quarter resolution) is added back softly; then one
// fullscreen pass applies a soft filmic shoulder (tone mapping) and a gentle desaturation to everything.
// (Three's ACES greyed the pastel palette too much, so the curve is hand-rolled here.)
window.WW = window.WW || {};
(function (WW) {
  const BLOOM = { threshold: 1.25, knee: 0.3, strength: 0.2 };
  const GRADE = { exposure: 1.0, shoulder: 0.72, saturation: 0.9 };
  let r, rtScene, rtA, rtB, quad, qScene, qCam, mBright, mBlur, mComp, enabled = true;

  // the scene target's MSAA samples: 2 (power, 2026-10-20). At a Retina ratio of 2 the 4x target's resolve was the
  // biggest single GPU cost of the frame (render 5.0 -> 3.6 ms at 3200x1800, tests/gpu_probe.js busy) and the same-frame
  // shots are indistinguishable (mean |diff| 0.14 / 255). ?msaa=N: N samples (4: the old look; 0: none)
  const MSAA = (m => (m ? +m[1] : 2))(/[?&]msaa=(\d)/.exec(location.search));
  // ?inval=0: the old resolve (power2 A/B; WW.post.opts.inval flips it live): the MSAA depth and stencil blitted to the
  // resolve target too. Without them: GPU -0.25 ms a frame at 3200x1800 (busy), the frame identical to the bit
  const O = { inval: !/[?&]inval=0/.test(location.search) };
  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  function mat(frag, uniforms, toneMapped) {
    return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: !!toneMapped });
  }
  function init() {
    r = WW.renderer;
    // stencilBuffer: r149 gives a render target with a depth but no stencil buffer a 16-bit depth (DEPTH_COMPONENT16):
    // anything layered on the ground (the runways, taxiways and their paint, the crater decals) hatched beyond ~40 u;
    // with the stencil it is DEPTH24_STENCIL8
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true };
    rtScene = new THREE.WebGLRenderTarget(4, 4, Object.assign({ samples: MSAA }, opts));
    rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    rtB = rtA.clone();
    mBright = mat(`uniform sampler2D tex; uniform float threshold, knee, cap; varying vec2 vUv;
      void main(){ vec3 c = min(texture2D(tex, vUv).rgb, vec3(cap)); float l = max(c.r, max(c.g, c.b));
        float w = smoothstep(threshold - knee, threshold + knee, l); gl_FragColor = vec4(c * w, 1.0); }`,
      { tex: { value: null }, threshold: { value: BLOOM.threshold }, knee: { value: BLOOM.knee }, cap: { value: 1e4 } });
    mBlur = mat(`uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 s = texture2D(tex, vUv).rgb * 0.227;
        s += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * 0.316;
        s += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(s, 1.0); }`, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    // Filmic shoulder: colours below the shoulder stay exactly as authored (pastel palette intact);
    // brighter values roll off smoothly toward white, so sand, foam and flashes never clip flat.
    mComp = mat(`uniform sampler2D tex; uniform sampler2D bloom; uniform float strength, exposure, shoulder, saturation; uniform vec3 grade; varying vec2 vUv;
      vec3 roll(vec3 x) { vec3 over = max(x - shoulder, 0.0); return min(x, vec3(shoulder)) + (1.0 - shoulder) * (1.0 - exp(-over / (1.0 - shoulder))); }
      void main(){ vec3 c = (texture2D(tex, vUv).rgb + texture2D(bloom, vUv).rgb * strength) * exposure;
        c = roll(c);
        float l = dot(c, vec3(0.3, 0.59, 0.11));
        c = mix(vec3(l), c, saturation) * grade;
        gl_FragColor = vec4(c, 1.0);
      }`, { tex: { value: null }, bloom: { value: null }, strength: { value: BLOOM.strength },
            exposure: { value: GRADE.exposure }, shoulder: { value: GRADE.shoulder }, saturation: { value: GRADE.saturation }, grade: { value: new THREE.Vector3(1, 1, 1) } });
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
  // The render's matrix update (power2): a hidden top-level object (the pooled lifeboats, plane props, flak and fx
  // pools: ~1000 nodes in a busy battle) is left out, and so is a frozen tree (userData.frozen: terrain.js, whose
  // matrices are made once); main.js leaves the scene root's own matrix alone, so nothing forces them. One shown again
  // is updated by this same render before it is drawn. Visual only: the sim never reads the render's matrices (the
  // look-ahead worker and ?sim pages render nothing). scene.updateMatrixWorld 0.49 -> 0.34 ms in a busy battle.
  function matrixSkip(scene) {
    const ch = scene.children;
    for (let i = 0; i < ch.length; i++) { const c = ch[i]; c.matrixWorldAutoUpdate = c.visible && !c.userData.frozen; }
  }
  const MSKIP = !/[?&]mskip=0/.test(location.search);   // ?mskip=0: every node updated every frame (A/B)
  function render(scene, camera) {
    if (MSKIP) matrixSkip(scene); else scene.matrixAutoUpdate = true;
    if (!enabled || !rtScene) { r.setRenderTarget(null); r.render(scene, camera); return; }
    r.getDrawingBufferSize(sz);
    if (sz.x !== rtScene.width || sz.y !== rtScene.height) resize();
    // nothing reads the scene's depth after the frame: the resolve blits the colour only, and the depth / stencil are
    // invalidated (three.js's XR flag; set every frame: a resize drops the target's properties)
    r.properties.get(rtScene).__ignoreDepthValues = O.inval;
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
    // the HDR fed to the bloom is capped in the dark, so a blast's white-hot core glows instead of flooding the frame
    // with a halo the size of the screen (by day: no cap)
    mBright.uniforms.cap.value = k > 0 ? 1 / (1 / 1e4 + k * (1 / 2.5 - 1 / 1e4)) : 1e4;
    mComp.uniforms.strength.value = BLOOM.strength + 0.3 * k;
    mComp.uniforms.saturation.value = GRADE.saturation + 0.08 * k + gSat;
  }
  // A scenario's colour grade (sky_time.js: Normandy's grey morning, a cold desaturated look): a saturation shift and
  // a per-channel gain applied after the tone curve. The Pacific never sets it (0 and 1, 1, 1: the identity).
  let gSat = 0;
  function setGrade(sat, cr, cg, cb) { gSat = sat; if (mComp) mComp.uniforms.grade.value.set(cr, cg, cb); }
  WW.post = { init, resize, render, setNight, setGrade, toggle() { enabled = !enabled; return enabled; }, opts: O };
})(window.WW);
