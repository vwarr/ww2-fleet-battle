// water.js (integrator): the sea out to the horizon. A small depth texture drives a smooth pastel depth gradient, a
// clean animated foam outline around every island and shoal, soft see-through shallows and a gentle sparkle. Unlit
// toon colours, with fog and a fresnel blend into the sky. The surface is the Pacific's sea state (sea_state.js,
// WW.sea): a camera-centred polar grid (fine near the camera, coarse to the horizon) displaced in the vertex shader by
// the swell and the wind sea (what the grid cannot resolve there is left flat), shaded per pixel with the full
// surface's normal (crest light, troughs, the glitter, the fresnel), whitecaps and wind streaks by the round's wind,
// and the surf breaking over the reef edges. In Normandy it lies flat, lowered under waves.js's Channel.
window.WW = window.WW || {};
(function (WW) {
  const TEX_STEP = 2;           // units per depth texel
  const D_MIN = -4, D_MAX = 28; // depth range stored in the texture (sea_state.js seaDepth reads it the same way)
  const SEGS = 192, R_MIN_SP = 0.4, R_MAX = 7000;   // the grid: angular segments, finest spacing (u), radius
  const CATCH = 300, CATCH_N = 150;                // the shadow catcher: size (u) and cells a side (2 u)
  let mesh = null, mat = null, tex = null, t = 0, catcher = null;
  const SU = () => WW.sea.uniforms;

  const vert = `
    attribute float aSp;
    varying vec3 vWorld; varying float vH;
    #include <fog_pars_vertex>
    ${WW.sea.GLSL}
    uniform sampler2D depthTex; uniform vec4 extent;
    float seaDepth(vec2 p) {
      vec2 uv = (p - extent.xy) / extent.zw;
      float d = texture2D(depthTex, clamp(uv, 0.0, 1.0)).r * ${(D_MAX - D_MIN).toFixed(1)} + ${D_MIN.toFixed(1)};
      if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) d = max(d, 18.0);
      return d;
    }
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      float d = seaDepth(wp.xz);
      float h = seaGrad(wp.xz, d, aSp).x;
      // the surf: breaker lines running in over the reef edge with the swell (drawn, not ridden)
      float bell = smoothstep(0.1, 0.5, d) * (1.0 - smoothstep(1.4, 2.6, d)) * uSeaAmp;
      h += bell * uSeaP[0].x * 1.3 * pow(0.5 + 0.5 * sin(5.65 * d + uSeaK[0].w * uSeaT), 6.0) * step(2.5 * aSp, 6.0);
      wp.y += h;
      vWorld = wp.xyz; vH = h;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const frag = `
    uniform sampler2D depthTex;
    uniform vec4 extent;          // x0, z0, width, height
    uniform float time;
    uniform vec3 cShallow, cMid, cDeep, cAbyss, cFoam, cSky, sunDir, sunCol, hzAway, hzSun, tint;
    uniform vec3 glit;
    uniform float moonPath;            // glitter: sheen weight, sparkle sharpness, sparkle weight
    uniform vec4 rainC[4];        // rain squalls (weather.js via sky_time.js): x, z, radius, density
    varying vec3 vWorld; varying float vH;
    #include <fog_pars_fragment>
    ${WW.sea.GLSL}
    ${WW.sea.GLSL_FRAG}
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
      float alpha = mix(0.62, 0.92, smoothstep(0.0, 10.0, d));
      // fade to fully opaque deep water toward the edge of the sea-floor mesh (no visible seam)
      float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
      float far = smoothstep(0.62, 0.95, edge);
      col = mix(col, cAbyss, far * smoothstep(8.0, 16.0, d));
      alpha = mix(alpha, 1.0, far);
      if (!inside) alpha = 1.0;
      // the sea's own surface (sea_state.js): the full wave set per pixel (components too short for this pixel's
      // footprint dropped: no shimmer far off), its normal at NORMAL_EXAG, crests lighter, troughs deeper
      float fp = max(max(fwidth(vWorld.x), fwidth(vWorld.z)), 0.02);
      // the swell is exactly the ridden surface (warped a little only far off); the wind sea's lookup is bent near
      // and far (its crests curve, no long regular trains), its slope eased and the short chop added per pixel
      // (seaDetail: many short components, slope only). Gusts: patches of rougher and smoother sea drifting downwind.
      float wk = smoothstep(30.0, 160.0, length(cameraPosition.xz - vWorld.xz)) * 5.0;
      vec2 wn = vec2(vnoise(vWorld.xz * 0.045 + 3.1), vnoise(vWorld.xz * 0.045 - 7.7)) - 0.5;
      vec2 wp2 = vWorld.xz + wk * wn;
      float L0 = max(uSeaP[3].w, 0.3);
      vec2 rq = mat2(0.6, 0.8, -0.8, 0.6) * vWorld.xz;   // the noise lattices turned off the map's axes
      vec2 n1 = vec2(vnoise(rq * (0.37 / L0) + 1.7), vnoise(rq * (0.37 / L0) - 4.2));
      vec2 n2 = vec2(vnoise(vWorld.xz * (0.23 / L0) + 8.3), vnoise(vWorld.xz * (0.23 / L0) + 2.9));
      vec2 wpc = vWorld.xz + (wk + L0 * 0.9) * wn + (n1 - 0.5) * L0 * 0.7;
      vec2 gq = vWorld.xz * 0.018 - uSeaWind * time * 0.25;
      float gust = 0.45 + 1.1 * smoothstep(0.2, 0.85, vnoise(gq) * 0.65 + vnoise(gq * 2.7 + 5.0) * 0.35);
      vec3 sg = seaGradW(wp2, wpc, d, -fp, 0.5 * gust * mix(0.6, 1.0, smoothstep(1.0, 6.0, d)));
      sg.yz += seaDetail(vWorld.xz, fp, n1, n2) * gust * seaAmpK(d) * uSeaAmp;
      vec3 n = normalize(vec3(-sg.y * uSeaN, 1.0, -sg.z * uSeaN));
      float hN = sg.x / max(1e-3, uSeaP[0].x + uSeaP[1].x + uSeaP[3].x + uSeaP[4].x);   // ~-1 (trough) .. 1 (crest)
      vec3 sd = normalize(sunDir);
      col *= clamp(1.0 + 0.9 * (dot(n, sd) - sd.y), 0.82, 1.14);
      col *= mix(0.92, 1.05, smoothstep(-0.9, 0.9, hN));
      col = mix(col, cShallow * vec3(0.96, 1.06, 1.02), smoothstep(0.3, 1.0, hN) * 0.14 * smoothstep(3.0, 10.0, d));   // the light through a crest
      float far0 = smoothstep(120.0, 900.0, length(cameraPosition - vWorld));
      // whitecaps: broken patches on the steep wind-sea crests from Beaufort 4 (none in a calm), wind streaks of old foam
      float capK = smoothstep(0.38, 0.95, uSeaS) * smoothstep(1.5, 5.0, d);
      float fn = vnoise(vWorld.xz * vec2(0.9, 1.4) + time * vec2(0.25, 0.4)) * 0.6 + vnoise(vWorld.xz * 3.1 - time * 0.35) * 0.4;
      float steep = smoothstep(0.08, 0.3, length(sg.yz));
      float capF = smoothstep(0.15, 0.6, hN) * smoothstep(0.56, 0.72, fn) * smoothstep(0.25, 0.55, vnoise(vWorld.xz * 4.0 + time)) * mix(steep, 0.6, far0) * capK * (1.0 - 0.5 * far0);
      vec2 wd = uSeaWind; vec2 wq = vec2(dot(vWorld.xz, wd), dot(vWorld.xz, vec2(-wd.y, wd.x)));
      float streak = smoothstep(0.76, 0.93, vnoise(vec2(wq.x * 0.05, wq.y * 0.45) + time * 0.03)) * smoothstep(0.45, 0.75, vnoise(wq * vec2(0.3, 1.2))) * smoothstep(0.3, 0.8, uSeaS) * 0.2 * (1.0 - far0) * smoothstep(2.0, 6.0, d);
      col = mix(col, cFoam, max(capF * 0.9, streak));
      alpha = max(alpha, capF * 0.85);
      // soft caustic ripples over sandy shallows: reads as water over sand, not a solid surface
      // (the two noises on rotated, warped lattices: axis-aligned value noise at two near scales read as a diamond net)
      vec2 cq = vWorld.xz + (n2 - 0.5) * 2.5;
      float cz = vnoise(mat2(0.8, 0.6, -0.6, 0.8) * cq * 0.3 + vec2(time * 0.08, -time * 0.06)) + vnoise(mat2(0.36, -0.93, 0.93, 0.36) * cq * 0.41 - vec2(time * 0.05, time * 0.07));
      float caust = smoothstep(0.86, 1.0, 1.0 - abs(cz - 1.0)) * (1.0 - smoothstep(1.0, 4.0, d));
      col = mix(col, vec3(0.95, 0.98, 0.94), caust * 0.18);   // calm, slow, faint
      // foam: a crisp outline at the shore plus a softer ring that breathes outward
      float wob = (vnoise(vWorld.xz * 0.25 + time * 0.15) - 0.5) * 0.35;
      // (a narrow swash line: over a wide flat reef the old 0.75 u band painted the whole shelf white, read as white sand)
      float shore = (1.0 - smoothstep(0.12, 0.42, d + wob)) * 0.9;
      float ringPos = 1.3 + 0.45 * sin(time * 0.8 + vWorld.x * 0.02);
      // world-space depth slope: rings only where the seabed really shelves (flat tops would give blocky contours)
      float slope = length(vec2(dFdx(d), dFdy(d))) / max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))) + length(vec2(dFdx(vWorld.z), dFdy(vWorld.z))), 1e-3);
      float ring = (1.0 - smoothstep(0.0, 0.18, abs(d + wob * 0.6 - ringPos))) * 0.55 * (1.0 - smoothstep(1.2, 2.4, d)) * smoothstep(0.08, 0.2, slope);
      // the surf: lines of breaking white running in over the reef edge with the swell, lacy foam behind each,
      // stronger in a bigger swell (uSeaP[0].x: the main swell's amplitude)
      float sAmp = clamp(uSeaP[0].x / 0.09, 0.5, 1.3) * uSeaAmp;
      float bellF = smoothstep(0.1, 0.4, d) * (1.0 - smoothstep(1.8, 3.2, d)) * smoothstep(0.015, 0.07, slope);
      float bp = fract(0.9 * d + uSeaK[0].w * time * 0.15915 + 0.25);
      float lipN = vnoise(vec2(vWorld.x * 0.35 + vWorld.z * 0.21, time * 0.3)) * 0.7 + vnoise(vWorld.xz * 1.7 + time) * 0.3;
      float lip = smoothstep(0.0, 0.06, bp) * (1.0 - smoothstep(0.16, 0.36, bp)) * smoothstep(0.2, 0.48, lipN);
      float lace = smoothstep(0.62, 0.8, vnoise(vWorld.xz * 0.9 + vec2(0.0, time * 0.2))) * (1.0 - smoothstep(0.0, 0.45, fract(bp + 0.6)));
      float surf = (lip * 1.0 + lace * 0.6) * bellF * sAmp * (1.0 - 0.5 * far0);
      float foam = max(max(shore, ring), clamp(surf, 0.0, 1.0));
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
      // rain: a darker sea and small rings under a squall
      float rn = 0.0;
      for (int i = 0; i < 4; i++) { vec4 rc = rainC[i]; if (rc.z > 0.0) rn = max(rn, (1.0 - smoothstep(0.35, 1.0, length(vWorld.xz - rc.xy) / rc.z)) * rc.w); }
      if (rn > 0.0) {
        col = mix(col, col * vec3(0.7, 0.75, 0.84), rn * 0.65);
        vec2 rq = vWorld.xz * 2.0; float rh = hash(floor(rq)), ph = fract(time * 0.9 + rh * 7.0);
        float rr = abs(length(fract(rq) - 0.5) - ph * 0.42);
        col += vec3(0.85, 0.9, 1.0) * (1.0 - smoothstep(0.0, 0.05, rr)) * (1.0 - ph) * step(0.5, rh) * rn * 0.2;
      }
      col *= tint;                     // time of day (sky_time.js): dusk, the blue hour, moonlit night
      // fresnel: grazing angles take on the sky colour (soft horizon)
      vec3 v = normalize(cameraPosition - vWorld);
      // warm sun-glitter path toward the low sun: a soft sheen plus fine sparkles on a rippled normal
      // (the ripples ride the sea's own normal: the glitter runs along the swell; in a calm the sheen is a mirror)
      float calm = 1.0 - smoothstep(0.05, 0.35, uSeaS);
      vec2 rip = (vec2(vnoise(vWorld.xz * 1.4 + time * 0.35), vnoise(vWorld.xz * 1.4 - time * 0.3 + 9.0)) - 0.5) * mix(1.0, 0.45, calm);
      vec3 nrm = normalize(n + vec3(rip.x * 0.35, 0.0, rip.y * 0.35));
      float rs = max(dot(reflect(-v, nrm), sunDir), 0.0);
      float sheen = pow(max(dot(reflect(-v, n), sunDir), 0.0), mix(18.0, 40.0, calm)) * (1.0 + 1.5 * calm);
      col += sunCol * (sheen * glit.x + pow(rs, glit.y) * glit.z) * smoothstep(1.0, 4.0, d) * (1.0 - foam);   // glit: day (0.1, 420, 0.35); the moon path is wider
      float fr = pow(1.0 - clamp(mix(v.y, dot(v, n), 0.7), 0.0, 1.0), 4.0);
      // the horizon colour depends on where we look: peach toward the sun, soft blue away from it
      vec2 az = normalize(-v.xz + 1e-5);
      float toward = clamp(dot(az, normalize(sunDir.xz)) * 0.5 + 0.5, 0.0, 1.0); // clamped: pow() of a hair below 0 is NaN (see sky.js)
      vec3 hz = mix(hzAway, hzSun, pow(toward, 5.0));
      col = mix(col, hz, fr * 0.35);
      alpha = mix(alpha, 1.0, fr);
      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      #ifdef USE_FOG
        float fogF = smoothstep(fogNear, fogFar, vFogDepth);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, fogF);
      #endif
      // the moon's path (night, moonPath > 0): a column of glittering ripples under the moon, out to the horizon
      if (moonPath > 0.0) {
        vec2 vd = normalize(vWorld.xz - cameraPosition.xz), md = normalize(sunDir.xz);
        float col0 = exp(-(1.0 - dot(vd, md)) * 130.0) * smoothstep(-0.2, 0.6, dot(vd, md));
        float rip2 = vnoise(vWorld.xz * vec2(1.9, 1.9) + vec2(time * 0.5, -time * 0.35)) * vnoise(vWorld.xz * 0.7 - time * 0.2);
        float sp = smoothstep(0.18, 0.42, rip2);
        float graze = 1.0 - smoothstep(0.12, 0.42, normalize(cameraPosition - vWorld).y);   // a path to the horizon, not a pool at our feet
        gl_FragColor.rgb += sunCol * col0 * graze * (0.1 + 0.55 * sp) * moonPath * smoothstep(1.0, 4.0, d);
      }
    }`;

  function build() {
    mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        time: { value: 0 },
        cShallow: { value: WW.pastel(0x86e2d8, 0.05) }, cMid: { value: WW.pastel(0x4cc4d0, 0.05) },
        cDeep: { value: WW.pastel(0x2a94c4, 0.05) }, cAbyss: { value: WW.pastel(0x236ca8, 0.05) },
        cFoam: { value: new THREE.Color(0xfffaf2) }, cSky: { value: WW.pastel(0xc4d6ea, 0.1) },
        sunDir: { value: (WW.sky && WW.sky.SUN_DIR) || new THREE.Vector3(-0.86, 0.36, 0.36).normalize() }, sunCol: { value: WW.pastel(0xffd2a0) },
        hzAway: { value: WW.pastel(0xb4d2f2, 0.1) }, hzSun: { value: WW.pastel(0xffc89a, 0.1) },
        tint: { value: new THREE.Color(1, 1, 1) }, glit: { value: new THREE.Vector3(0.1, 420, 0.35) }, moonPath: { value: 0 }, rainC: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) }
      }]),
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true,
      extensions: { derivatives: true }
    });
    const U = SU(); for (const k in U) mat.uniforms[k] = U[k];   // the sea's shared uniforms (sea_state.js), the depth texture among them
    if (!U.extent.value) U.extent.value = new THREE.Vector4(0, 0, 1, 1);
    mesh = new THREE.Mesh(grid(), mat);
    mesh.position.set(WW.cfg.MAP_W / 2, 0, WW.cfg.MAP_H / 2);
    mesh.renderOrder = 1; mesh.frustumCulled = false;
    WW.scene.add(mesh);
    // soft, cool-tinted shadow catcher just above the sea: ships and planes shade the water. It lies on the waves
    // (sea_state.js ride), so it covers the sun's shadow box (sky.js: +-120 u about what the camera looks at, +-520 in
    // the overview) and follows it; in Normandy it is the old flat sheet over the map.
    const sg = new THREE.PlaneGeometry(CATCH, CATCH, CATCH_N, CATCH_N); sg.rotateX(-Math.PI / 2);
    catcher = new THREE.Mesh(sg, WW.sea.ride(new THREE.ShadowMaterial({ color: 0x3a3f6a, opacity: 0.24, depthWrite: false }), 'conform'));
    catcher.position.set(WW.cfg.MAP_W / 2, 0.06, WW.cfg.MAP_H / 2);
    catcher.receiveShadow = true; catcher.renderOrder = 2; catcher.frustumCulled = false;
    WW.scene.add(catcher);
  }

  // The sea's grid: rings about the camera (it follows the camera in x, z), SEGS segments round, the rings R_MIN_SP
  // apart near the middle and then as far apart as the segments are wide (square-ish cells, ~43k vertices). aSp: the
  // spacing at each vertex (the vertex shader leaves out the waves too short to draw there).
  function grid() {
    const rs = [0]; let r = 0;
    while (r < R_MAX) { r += Math.max(R_MIN_SP, r * 2 * Math.PI / SEGS); rs.push(Math.min(r, R_MAX)); }
    const nv = 1 + (rs.length - 1) * SEGS, pos = new Float32Array(nv * 3), sp = new Float32Array(nv);
    sp[0] = R_MIN_SP;
    for (let i = 1; i < rs.length; i++) for (let j = 0; j < SEGS; j++) {
      const a = j / SEGS * 2 * Math.PI, k = 1 + (i - 1) * SEGS + j;
      pos[k * 3] = Math.cos(a) * rs[i]; pos[k * 3 + 2] = Math.sin(a) * rs[i];
      sp[k] = Math.max(R_MIN_SP, rs[i] - rs[i - 1], rs[i] * 2 * Math.PI / SEGS);
    }
    const idx = [];
    for (let j = 0; j < SEGS; j++) idx.push(0, 1 + (j + 1) % SEGS, 1 + j);
    for (let i = 1; i < rs.length - 1; i++) for (let j = 0; j < SEGS; j++) {
      const a = 1 + (i - 1) * SEGS + j, b = 1 + (i - 1) * SEGS + (j + 1) % SEGS, c = a + SEGS, d = b + SEGS;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSp', new THREE.BufferAttribute(sp, 1));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_MAX);
    return g;
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
    SU().extent.value.set(x0 - TEX_STEP / 2, z0 - TEX_STEP / 2, nx * TEX_STEP, nz * TEX_STEP);
    SU().depthTex.value = tex;
  }
  // Soft contact shadows: a dark radial blob under each ship hull, where it meets the water (cheap AO).
  const blobs = []; let blobGeo = null, blobMat = null;
  function blobTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function updateBlobs() {
    if (!WW.scene || typeof document === 'undefined') return;
    if (!blobGeo) {
      blobGeo = new THREE.PlaneGeometry(1, 1, 8, 3); blobGeo.rotateX(-Math.PI / 2);
      blobMat = WW.sea.ride(new THREE.MeshBasicMaterial({ color: 0x1c2a4a, alphaMap: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false }), 'conform');   // lies on the waves
    }
    let n = 0;
    for (const s of WW.world.ships) {
      if (s.removed || s.wreck || s.submerged) continue;
      let b = blobs[n];
      if (!b) { b = blobs[n] = new THREE.Mesh(blobGeo, blobMat); b.renderOrder = 2; b.rotation.order = 'YXZ'; }
      if (b.parent !== WW.scene) WW.scene.add(b);
      const L = s.stats.length, k = s.sinking ? Math.max(0, 1 - s.sinkT / 6) : 1;
      b.visible = k > 0.02;
      b.position.set(s.x, 0.1, s.z); b.rotation.y = -s.heading;
      b.scale.set(L * 1.25 * k + 0.01, 1, L * 0.42 * k + 0.01);
      n++;
    }
    for (let i = n; i < blobs.length; i++) blobs[i].visible = false;
  }
  function update(dt) {
    t += dt; if (mat) mat.uniforms.time.value = t;
    // the grid follows the camera (Normandy: the plane stays put, lowered under waves.js's mesh)
    const nm = WW.isScn && WW.isScn('normandy');
    if (mesh && WW.camera && !nm) mesh.position.set(WW.camera.position.x, mesh.position.y, WW.camera.position.z);
    if (catcher) {
      // on the shadow box's centre, snapped to whole cells (no swimming); the overview: four times larger (the waves
      // do not show from up there)
      const wide = !WW.cam || (WW.cam.isOverview && WW.cam.isOverview()), k = nm ? Math.max(WW.cfg.MAP_W, WW.cfg.MAP_H) / CATCH * 1.2 : wide ? 4 : 1;
      const c = !nm && WW.cam && WW.cam.target ? WW.cam.target() : { x: WW.cfg.MAP_W / 2, z: WW.cfg.MAP_H / 2 }, cell = CATCH / CATCH_N * k;
      catcher.scale.set(k, 1, k);
      catcher.position.set(Math.round(c.x / cell) * cell, 0.06, Math.round(c.z / cell) * cell);
    }
    updateBlobs();
  }
  WW.water = { setDepth, update, uniforms: () => mat && mat.uniforms, mesh: () => mesh };   // mesh: waves.js lowers it under the Normandy sea
})(window.WW);
