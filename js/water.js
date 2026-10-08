// water.js (integrator): one big calm sea plane out to the horizon. A small depth texture drives
// a smooth pastel depth gradient, a clean animated foam outline around every island and shoal,
// soft see-through shallows and a gentle sparkle. Unlit, with fog and a fresnel blend into the sky.
window.WW = window.WW || {};
(function (WW) {
  const TEX_STEP = 2;           // units per depth texel
  const D_MIN = -4, D_MAX = 28; // depth range stored in the texture
  let mesh = null, mat = null, tex = null, t = 0;

  const vert = `
    varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const frag = `
    uniform sampler2D depthTex;
    uniform vec4 extent;          // x0, z0, width, height
    uniform float time;
    uniform vec3 cShallow, cMid, cDeep, cAbyss, cFoam, cSky;
    varying vec3 vWorld;
    #include <fog_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec2 uv = (vWorld.xz - extent.xy) / extent.zw;
      bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
      float d = texture2D(depthTex, clamp(uv, 0.0, 1.0)).r * ${(D_MAX - D_MIN).toFixed(1)} + ${D_MIN.toFixed(1)};
      if (!inside) d = max(d, 18.0);
      // smooth depth gradient
      vec3 col = mix(cShallow, cMid, smoothstep(0.0, 4.0, d));
      col = mix(col, cDeep, smoothstep(3.0, 11.0, d));
      col = mix(col, cAbyss, smoothstep(10.0, 22.0, d));
      float alpha = mix(0.56, 0.9, smoothstep(0.0, 12.0, d));
      if (!inside) alpha = 1.0;
      // gentle large-scale swell shading
      float sw = vnoise(vWorld.xz * 0.035 + vec2(time * 0.05, time * 0.03)) * 0.6 + vnoise(vWorld.xz * 0.09 - vec2(time * 0.07, 0.0)) * 0.4;
      col *= 0.96 + 0.08 * sw;
      // soft caustic ripples over sandy shallows: reads as water over sand, not a solid surface
      float cz = vnoise(vWorld.xz * 0.45 + vec2(time * 0.25, -time * 0.2)) + vnoise(vWorld.xz * 0.7 - vec2(time * 0.18, time * 0.22));
      float caust = smoothstep(0.82, 1.0, 1.0 - abs(cz - 1.0)) * (1.0 - smoothstep(1.0, 5.0, d));
      col = mix(col, vec3(0.93, 1.0, 0.97), caust * 0.35);
      // foam: a crisp outline at the shore plus a softer ring that breathes outward
      float wob = (vnoise(vWorld.xz * 0.25 + time * 0.15) - 0.5) * 0.35;
      float shore = 1.0 - smoothstep(0.75, 0.98, d + wob);
      float ringPos = 1.3 + 0.45 * sin(time * 0.8 + vWorld.x * 0.02);
      // world-space depth slope: rings only where the seabed really shelves (flat tops would give blocky contours)
      float slope = length(vec2(dFdx(d), dFdy(d))) / max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))) + length(vec2(dFdx(vWorld.z), dFdy(vWorld.z))), 1e-3);
      float ring = (1.0 - smoothstep(0.0, 0.18, abs(d + wob * 0.6 - ringPos))) * 0.55 * (1.0 - smoothstep(1.2, 2.4, d)) * smoothstep(0.08, 0.2, slope);
      float foam = max(shore, ring);
      col = mix(col, cFoam, foam);
      alpha = max(alpha, foam * 0.95);
      if (d < -0.15) discard;          // dry land
      // sparkle: rare tiny glints that twinkle
      vec2 cell = floor(vWorld.xz * 0.6);
      float h = hash(cell + floor(time * 0.7));
      float glint = step(0.994, h) * (0.5 + 0.5 * sin(time * 6.0 + h * 40.0));
      vec2 fc = fract(vWorld.xz * 0.6) - 0.5;
      glint *= 1.0 - smoothstep(0.05, 0.22, length(fc));
      col = mix(col, vec3(1.0), glint * 0.45 * smoothstep(1.5, 6.0, d));
      // fresnel: grazing angles take on the sky colour (soft horizon)
      vec3 v = normalize(cameraPosition - vWorld);
      float fr = pow(1.0 - clamp(v.y, 0.0, 1.0), 4.0);
      col = mix(col, cSky, fr * 0.3);
      alpha = mix(alpha, 1.0, fr);
      gl_FragColor = vec4(col, alpha);
      #include <fog_fragment>
    }`;

  function build() {
    mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        depthTex: { value: null }, extent: { value: new THREE.Vector4(0, 0, 1, 1) }, time: { value: 0 },
        cShallow: { value: new THREE.Color(0x8fe4da) }, cMid: { value: new THREE.Color(0x5ccad0) },
        cDeep: { value: new THREE.Color(0x3aa0c8) }, cAbyss: { value: new THREE.Color(0x2f7cb4) },
        cFoam: { value: new THREE.Color(0xffffff) }, cSky: { value: new THREE.Color(0xa6d6f2) }
      }]),
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true,
      extensions: { derivatives: true }
    });
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1); g.rotateX(-Math.PI / 2);
    mesh = new THREE.Mesh(g, mat);
    mesh.position.set(WW.cfg.MAP_W / 2, 0, WW.cfg.MAP_H / 2);
    mesh.renderOrder = 1; mesh.frustumCulled = false;
    WW.scene.add(mesh);
    // soft, cool-tinted shadow catcher just above the sea: ships and planes shade the water
    const sg = new THREE.PlaneGeometry(WW.cfg.MAP_W + 400, WW.cfg.MAP_H + 400); sg.rotateX(-Math.PI / 2);
    const catcher = new THREE.Mesh(sg, new THREE.ShadowMaterial({ color: 0x24507a, opacity: 0.22, depthWrite: false }));
    catcher.position.set(WW.cfg.MAP_W / 2, 0.06, WW.cfg.MAP_H / 2);
    catcher.receiveShadow = true; catcher.renderOrder = 2;
    WW.scene.add(catcher);
  }

  // depthFn(x, z) -> depth, sampled over the rectangle (x0, z0, w, h)
  function setDepth(depthFn, x0, z0, w, h) {
    if (!WW.scene) return;
    if (!mesh) build();
    const nx = Math.round(w / TEX_STEP) + 1, nz = Math.round(h / TEX_STEP) + 1;
    if (!tex || tex.image.width !== nx || tex.image.height !== nz) {
      if (tex) tex.dispose();
      tex = new THREE.DataTexture(new Uint8Array(nx * nz * 4), nx, nz, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    }
    const a = tex.image.data;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const d = depthFn(x0 + i * TEX_STEP, z0 + j * TEX_STEP);
      const v = Math.round(WW.clamp((d - D_MIN) / (D_MAX - D_MIN), 0, 1) * 255), k = (j * nx + i) * 4;
      a[k] = v; a[k + 1] = v; a[k + 2] = v; a[k + 3] = 255;
    }
    tex.needsUpdate = true;
    // texel centres sit on the sample points
    mat.uniforms.extent.value.set(x0 - TEX_STEP / 2, z0 - TEX_STEP / 2, nx * TEX_STEP, nz * TEX_STEP);
    mat.uniforms.depthTex.value = tex;
  }
  function update(dt) { t += dt; if (mat) mat.uniforms.time.value = t; }
  WW.water = { setDepth, update };
})(window.WW);
