// waves.js - WW.waves: the rough Channel sea of D-Day (Normandy; visual only, real time, no WW.rand). The Pacific's calm
// flat sea (water.js) lies under it, lowered out of the way; this is a displaced wave surface over the whole Normandy sea:
//  - a swell rolling in from the north-north-west plus a cross sea and a wind chop (WAVES), exaggerated to read at the
//    game's scale ("a moderate sea, 4-6 ft waves": here crests ~0.5 u, breakers ~0.8 u)
//  - shoaling: toward the beach the waves grow and their crests sharpen (SHOAL), then they break on the tidal flat
//    and run up the sand as surf (the breaker line, foam bands and a swash), where the depth gives out
//  - whitecaps on the steep crests, streaks of foam in the troughs, the toon water colours of water.js (shared uniforms)
//  - the look (a second pass): the Channel's grey-green, not the Pacific's turquoise (SEA: swapped into water.js's
//    colour uniforms while in Normandy, the Pacific's own values put back exactly on leaving it, so its sea is
//    untouched); the surf as lines of breaking surf rather than broad milky sheets: a narrow broken lip on each
//    breaker, lacy foam (ridged noise) in the bore behind it, darker green water between the breakers and in the
//    troughs, whitecaps as broken patches on the steepest crests, wind streaks, a thin lacy swash edge
// The same height function in JS (height, slope) for anything that rides the waves: the landing craft pitch, roll and
// heave on it (models_landing.js), the men wade in it (models_infantry.js), the ships bob (sea state for the sim:
// landing_craft.js reads WW.scenarios.normandy.settings.sea, not this). Time: real seconds (as water.js), so the
// sea keeps rolling in slow motion and while paused. The tide (tide.js) lifts it all and brings the surf in.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  // [wavelength u, amplitude u, direction (x, z), speed k]; +z: toward the beach
  // the swell and the wind sea come from the west-north-west (scenario.js wind): they run east-south-east, at an angle
  // onto the beach (the longshore current that set the craft east)
  const WAVES = [[34, 0.55, 0.42, 0.91, 1], [21, 0.32, 0.6, 0.8, 1.05], [12.5, 0.16, 0.2, 0.98, 1.1], [7, 0.08, 0.92, 0.39, 1.2], [4.2, 0.045, 0.75, 0.66, 1.3]];
  // the breakers: rolling lines parallel to the beach (s: u offshore), BRK.L apart, running in at BRK.V u/s, tallest
  // where the depth is BRK.d0-BRK.d1 (the bar and the flat), spilling white on their faces
  const BRK = { A: 0.55, L: 15, V: 3.2, d0: 0.5, d1: 3.2, p: 6 };
  const G = 3.2;   // dispersion: omega = sqrt(G k) x speed k (a ~6 s swell period on the real clock)
  const W = WAVES.map(([L, A, dx, dz, sk]) => { const n = Math.hypot(dx, dz), k = 2 * Math.PI / L; return { k, A, dx: dx / n, dz: dz / n, w: Math.sqrt(G * k) * sk }; });
  const SHOAL = { grow: 1.1, sharp: 2.2, deep: 9, brk: 1.3 };
  let T = 0, mesh = null, mat = null, depthOf = null, active = false;
  // the Channel on the morning of 6 June: grey-green, turbid over the sand, slate far out; foam a little off-white
  const SEA = { cShallow: 0x7f8b7a, cMid: 0x617268, cDeep: 0x4b5c58, cAbyss: 0x3f4e50, cFoam: 0xdfe2dc };
  let pacSea = null;   // the Pacific's colour values while Normandy's are in
  function seaColours(on) {
    const U = WW.water && WW.water.uniforms && WW.water.uniforms();
    if (!U) return;
    if (on && !pacSea) { pacSea = {}; for (const k in SEA) { pacSea[k] = U[k].value.clone(); U[k].value.set(SEA[k]); } }
    else if (!on && pacSea) { for (const k in pacSea) U[k].value.copy(pacSea[k]); pacSea = null; }
  }

  // amplitude factor by depth: grows over the shelf, breaks and dies out on the flat and the sand
  function ampK(d) {
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return (1 + SHOAL.grow * (1 - sm(SHOAL.brk, SHOAL.deep, d))) * sm(-0.35, SHOAL.brk + 0.4, d);
  }
  const smJ = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  function brkBell(d) { return smJ(0, BRK.d0, d) * (1 - smJ(BRK.d1 * 0.6, BRK.d1, d)); }
  // the surface at (x, z): height (u above sea level); d: the depth there; s: u offshore (breakers)
  function heightAt(x, z, d, t, s) {
    const a = ampK(d), sharp = 1 + SHOAL.sharp * (1 - Math.min(1, Math.max(0, (d - SHOAL.brk) / (SHOAL.deep - SHOAL.brk))));
    let h = 0;
    for (const c of W) {
      const ph = c.k * (c.dx * x + c.dz * z) - c.w * t, s = 0.5 + 0.5 * Math.sin(ph);
      h += c.A * (2 * Math.pow(s, sharp) - 1 + (sharp - 1) * 0.18);   // peaked crests, flat troughs in the shallows
    }
    if (s === undefined) s = WW.normandyTerrain ? WW.normandyTerrain.shoreZ(x) - z : 99;
    return h * a + BRK.A * brkBell(d) * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI / BRK.L * s + BRK.V * 2 * Math.PI / BRK.L * t), BRK.p);
  }
  // the tide (tide.js) raises the whole sea and moves the surf in with it
  const tideL = () => (WW.tide ? WW.tide.level() : 0);
  const dAt = (x, z) => (WW.terrain ? WW.terrain.depthAt(x, z) || -WW.terrain.heightRaw(x, z) : 10) + tideL();
  function height(x, z) { return active ? heightAt(x, z, dAt(x, z), T) + tideL() : 0; }
  // the surface's slope (dh/dx, dh/dz) at (x, z), by a central difference over e u (a hull's length smooths the chop)
  function slope(x, z, e) {
    if (!active) return { x: 0, z: 0 };
    e = e || 0.6; const d = dAt(x, z);   // (the breaker term reads s from x, z itself)
    return { x: (heightAt(x + e, z, d, T) - heightAt(x - e, z, d, T)) / (2 * e), z: (heightAt(x, z + e, d, T) - heightAt(x, z - e, d, T)) / (2 * e) };
  }

  // ---- the surface mesh: rows that follow the coast (z = shoreZ(x) - s), fine in the surf, coarse far out ----
  // rows from the shingle (the tide reaches it) out to sea
  function rows() { const r = []; let s = -16; while (s < 2700) { r.push(s); s += s < 60 ? 1.1 : s < 300 ? 4 : s < 800 ? 12 : 60; } return r; }
  function build() {
    const T0 = WW.normandyTerrain, X0 = -1400, X1 = 3800, DX = 5, xs = [], R = rows();
    for (let x = X0; x <= X1; x += DX) xs.push(x);
    const nx = xs.length, nz = R.length, pos = new Float32Array(nx * nz * 3), dep = new Float32Array(nx * nz), off = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = T0.shoreZ(x) - R[j], k = j * nx + i;
      pos[k * 3] = x; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = z; dep[k] = -WW.terrain.heightRaw(x, z); off[k] = R[j];
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
    g.setAttribute('aS', new THREE.BufferAttribute(off, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(1200, 0, 600), 5000);
    const U = WW.water.uniforms();
    mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uTide: { value: 0 } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, extensions: { derivatives: true }
    });
    // the toon water colours, the sun and the time-of-day tint: water.js's own uniform objects (sky_time.js updates them)
    for (const k of ['cShallow', 'cMid', 'cDeep', 'cAbyss', 'cFoam', 'sunDir', 'sunCol', 'hzAway', 'hzSun', 'tint']) mat.uniforms[k] = U[k];
    mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 1; mesh.frustumCulled = false; mesh.name = 'waves';
    WW.scene.add(mesh);
  }
  const GLSL_H = `
    float ampK(float d) { return (1.0 + ${SHOAL.grow.toFixed(2)} * (1.0 - smoothstep(${SHOAL.brk.toFixed(2)}, ${SHOAL.deep.toFixed(2)}, d))) * smoothstep(-0.35, ${(SHOAL.brk + 0.4).toFixed(2)}, d); }
    float sharpK(float d) { return 1.0 + ${SHOAL.sharp.toFixed(2)} * (1.0 - clamp((d - ${SHOAL.brk.toFixed(2)}) / ${(SHOAL.deep - SHOAL.brk).toFixed(2)}, 0.0, 1.0)); }
    float brkBell(float d) { return smoothstep(0.0, ${BRK.d0.toFixed(2)}, d) * (1.0 - smoothstep(${(BRK.d1 * 0.6).toFixed(2)}, ${BRK.d1.toFixed(2)}, d)); }
    float brkPh(float s, float t) { return ${(2 * Math.PI / BRK.L).toFixed(5)} * s + ${(BRK.V * 2 * Math.PI / BRK.L).toFixed(5)} * t; }
    float waveH(vec2 p, float d, float t, float s) {
      float h = 0.0, sh = sharpK(d);
      ${W.map((c, i) => `{ float ph = ${c.k.toFixed(5)} * dot(vec2(${c.dx.toFixed(5)}, ${c.dz.toFixed(5)}), p) - ${c.w.toFixed(5)} * t; float s = 0.5 + 0.5 * sin(ph); h += ${c.A.toFixed(4)} * (2.0 * pow(s, sh) - 1.0 + (sh - 1.0) * 0.18); }`).join('\n      ')}
      return h * ampK(d) + ${BRK.A.toFixed(3)} * brkBell(d) * pow(0.5 + 0.5 * sin(brkPh(s, t)), ${BRK.p.toFixed(1)});
    }`;
  const VERT = `
    uniform float uTime, uTide;
    attribute float aDepth; attribute float aS;
    varying vec3 vWorld; varying vec3 vN; varying float vDepth; varying float vH; varying float vS;
    #include <fog_pars_vertex>
    ${GLSL_H}
    void main() {
      vec2 p = position.xz; float d = aDepth + uTide, t = uTime, e = 0.5;
      float s = aS, h = waveH(p, d, t, s);
      // +z is toward the beach: s falls as z rises
      float hx = waveH(p + vec2(e, 0.0), d, t, s) - waveH(p - vec2(e, 0.0), d, t, s), hz = waveH(p + vec2(0.0, e), d, t, s - e) - waveH(p - vec2(0.0, e), d, t, s + e);
      vN = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
      vec4 wp = modelMatrix * vec4(position.x, h + uTide, position.z, 1.0);
      vWorld = wp.xyz; vDepth = d; vH = h / max(0.05, ampK(d)); vS = s;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const FRAG = `
    uniform float uTime;
    uniform vec3 cShallow, cMid, cDeep, cAbyss, cFoam, sunDir, sunCol, hzAway, hzSun, tint;
    varying vec3 vWorld; varying vec3 vN; varying float vDepth; varying float vH; varying float vS;
    #include <fog_pars_fragment>
    float brkBell(float d) { return smoothstep(0.0, ${BRK.d0.toFixed(2)}, d) * (1.0 - smoothstep(${(BRK.d1 * 0.6).toFixed(2)}, ${BRK.d1.toFixed(2)}, d)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      float d = vDepth;
      if (d < -0.15) discard;                                                  // up the beach (above the tide's line): dry sand
      vec3 col = mix(cShallow, cMid, smoothstep(0.0, 4.0, d));
      col = mix(col, cDeep, smoothstep(3.0, 11.0, d));
      col = mix(col, cAbyss, smoothstep(10.0, 22.0, d));
      vec3 v = normalize(cameraPosition - vWorld), n = normalize(vN);
      float lit = 0.8 + 0.22 * max(dot(n, normalize(sunDir)), 0.0);         // flat light under the overcast
      col *= lit;
      // troughs darker, crests lighter and greener (the light through a wave's thin top)
      float crest = smoothstep(0.35, 0.75, vH);
      col *= mix(0.84, 1.04, smoothstep(-0.7, 0.6, vH));
      col = mix(col, cMid * vec3(1.05, 1.22, 1.1), crest * 0.22);
      // whitecaps: broken patches on the steepest crests out at sea, not whole crests
      float fn = vnoise(vWorld.xz * vec2(1.1, 1.9) + uTime * vec2(0.3, 0.5)) * 0.65 + vnoise(vWorld.xz * 3.7 - uTime * 0.4) * 0.35;
      float cap = smoothstep(0.5, 0.8, vH) * smoothstep(0.55, 0.72, fn) * smoothstep(0.08, 0.3, 1.0 - n.y + 0.1) * 0.85;
      // streaks of old foam drawn out along the wind (WNW: running east-south-east)
      vec2 wq = vec2(dot(vWorld.xz, vec2(0.92, 0.39)), dot(vWorld.xz, vec2(-0.39, 0.92)));
      float streak = smoothstep(0.72, 0.9, vnoise(vec2(wq.x * 0.05, wq.y * 0.7) + uTime * 0.04)) * smoothstep(0.4, 0.7, vnoise(wq * vec2(0.3, 1.6))) * 0.35;
      // the surf (bp: 0..1 along one breaker, 0.25 its crest; the bore and its foam behind it, bp < 0.25)
      float surfZone = 1.0 - smoothstep(0.2, 2.2, d), bb = brkBell(d);
      float bp = fract((${(1 / BRK.L).toFixed(5)}) * vS + ${(BRK.V / BRK.L).toFixed(5)} * uTime);
      // lace: a network of thin foam lines (ridged noise, two scales), drifting shoreward
      float l1 = 1.0 - abs(2.0 * vnoise(vWorld.xz * vec2(0.9, 1.3) + vec2(uTime * 0.12, -uTime * 0.5)) - 1.0);
      float l2 = 1.0 - abs(2.0 * vnoise(vWorld.xz * vec2(2.1, 2.8) - vec2(uTime * 0.2, uTime * 0.7) + 5.0) - 1.0);
      float patchy = smoothstep(0.35, 0.7, vnoise(vWorld.xz * vec2(0.06, 0.15) + vec2(0.0, -uTime * 0.1)));   // foam in patches, not a net
      float lace = max(smoothstep(0.9, 0.98, l1), smoothstep(0.93, 0.99, l2) * 0.6) * patchy;
      lace = mix(lace, 0.15 * patchy, smoothstep(70.0, 240.0, length(cameraPosition - vWorld)));   // far off: soft, not a speckle
      // the lip: a narrow, broken line of white spilling along the crest
      float lipN = vnoise(vec2(vWorld.x * 0.35 + vWorld.z * 0.1, uTime * 0.35)) * 0.7 + vnoise(vWorld.xz * 1.6 + uTime) * 0.3;
      float lip = smoothstep(0.14, 0.2, bp) * (1.0 - smoothstep(0.23, 0.3, bp)) * smoothstep(0.32, 0.6, lipN);
      float trail = 1.0 - smoothstep(0.0, 0.16, bp) + 0.5 * smoothstep(0.82, 1.0, bp);   // the bore: just behind the lip
      float breaking = (lip * 0.95 + lace * trail * 0.75 + trail * 0.1 * lipN) * bb;
      float bands = lace * surfZone * 0.3;
      // the swash: a thin lacy edge where the water runs up the sand, not a sheet
      float edge = smoothstep(-0.15, -0.09, d) * (1.0 - smoothstep(-0.02, 0.1, d)) * (0.55 + 0.45 * lipN);
      float swash = max(edge * 0.75, lace * (1.0 - smoothstep(-0.1, 0.5, d)) * 0.5);
      float foam = clamp(max(max(cap, streak), max(breaking, max(bands, swash))), 0.0, 1.0) * 0.92;
      col *= mix(1.0, 0.86, (bb * 0.6 + surfZone * 0.3) * (1.0 - foam));     // darker green between the breakers
      col = mix(col, cFoam, foam);
      float alpha = mix(0.7, 0.95, smoothstep(0.0, 8.0, d));
      alpha = max(alpha, foam * 0.94);
      alpha *= 0.45 + 0.55 * smoothstep(-0.15, 0.05, d);
      col *= tint;
      float fr = pow(1.0 - clamp(v.y, 0.0, 1.0), 4.0);
      vec2 az = normalize(-v.xz + 1e-5);
      vec3 hz = mix(hzAway, hzSun, pow(clamp(dot(az, normalize(sunDir.xz)) * 0.5 + 0.5, 0.0, 1.0), 5.0));
      float spec = pow(max(dot(reflect(-v, n), normalize(sunDir)), 0.0), 60.0) * 0.35;
      col += sunCol * spec * (1.0 - foam);
      col = mix(col, hz, fr * 0.3);
      gl_FragColor = vec4(col, max(alpha, fr));
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      #ifdef USE_FOG
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, smoothstep(fogNear, fogFar, vFogDepth));
      #endif
    }`;

  // per frame (main.js): on in Normandy (the calm sea lowered under it), off elsewhere
  function update(rdt) {
    const want = !WW.simOnly && WW.isScn('normandy') && !!WW.normandyTerrain && !!WW.scene && !!(WW.water && WW.water.uniforms());
    const wm = WW.water && WW.water.mesh && WW.water.mesh();
    if (want && !mesh) build();
    seaColours(want);
    if (mesh) mesh.visible = want;
    if (wm) wm.position.y = want ? -1.4 : 0;
    active = want;
    T += Math.min(0.1, rdt || 0);
    if (mat) { mat.uniforms.uTime.value = T; mat.uniforms.uTide.value = tideL(); }
  }
  WW.waves = { update, height, slope, get time() { return T; }, get active() { return active; }, WAVES };
})(window.WW);
