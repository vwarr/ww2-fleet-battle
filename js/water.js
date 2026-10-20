// water.js (integrator): the sea out to the horizon. A small depth texture drives a smooth pastel depth gradient, a
// clean animated foam outline around every island and shoal, soft see-through shallows and a gentle sparkle. Unlit
// toon colours, with fog and a fresnel blend into the sky. The surface is the Pacific's sea state (sea_state.js,
// WW.sea): a camera-centred polar grid (fine near the camera, coarse to the horizon) displaced in the vertex shader by
// the swell and the wind sea (what the grid cannot resolve there is left flat), their normal from the vertex, the short
// chop from baked mipmapped slope tiles and every noise from one baked texture (no wave sums per pixel: perf6), shaded
// with crest light, troughs, the glitter and the fresnel, whitecaps and wind streaks by the round's wind, and the surf
// breaking over the reef edges; a skirt carries it to the horizon. In Normandy it lies flat, under waves.js's Channel.
window.WW = window.WW || {};
(function (WW) {
  const TEX_STEP = 2;           // units per depth texel
  const D_MIN = -4, D_MAX = 28; // depth range stored in the texture (sea_state.js seaDepth reads it the same way)
  const SEGS = WW.sea.GRID.SEGS, R_MIN_SP = WW.sea.GRID.R_MIN_SP, R_MAX = 4800;   // the grid: angular segments, finest spacing (u) (sea_state.js: meshSp), radius
  const NOISE_CELLS = 128, NOISE_RES = 512;        // the baked noise: lattice cells a side (its period), texels a side
  const CHOP_RES = 256, CHOP_ENC = 8, CHOP_GAIN = 0.6;   // the baked chop tile: texels a side, slope encoding range, strength
  const CATCH = 300, CATCH_N = 150;                // the shadow catcher: size (u) and cells a side (2 u)
  let mesh = null, mat = null, tex = null, t = 0, catcher = null;
  const SU = () => WW.sea.uniforms;

  // The vertex shader carries the waves: the swell and the wind sea (as far as the grid resolves them there, aSp: the
  // same components and LOD the ships ride, sea_state.js hull) give the height AND its gradient per vertex, passed on
  // as varyings (no per-pixel wave sums). The outermost ring is a skirt raised to the camera's eye height: it fills the
  // last sliver up to the true horizon (the camera's far plane ends the grid short of it: a pale band where distant
  // ships floated in the sky).
  const vert = `
    attribute float aSp;
    varying vec3 vWorld; varying float vH; varying vec2 vG; varying float vRes;
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
      vH = 0.0; vG = vec2(0.0); vRes = 0.0;
      if (aSp < 0.0) {
        vRes = -1.0;   // (the fragment shader: no glitter on the skirt's wall)
        if (uSeaAmp > 0.0) wp.y = cameraPosition.y * 0.999;   // the skirt: at the horizon (the Pacific's camera-centred grid only)
      } else {
        float d = seaDepth(wp.xz);
        vec3 g = seaGrad(wp.xz, d, aSp);
        float h = g.x;
        // the surf: breaker lines running in over the reef edge with the swell (drawn, not ridden)
        float bell = smoothstep(0.1, 0.5, d) * (1.0 - smoothstep(1.4, 2.6, d)) * uSeaAmp;
        h += bell * uSeaP[0].x * 1.3 * pow(0.5 + 0.5 * sin(5.65 * d + uSeaK[0].w * uSeaT), 6.0) * step(2.5 * aSp, 6.0);
        wp.y += h;
        vH = h; vG = g.yz;
        vRes = smoothstep(2.5 * aSp, 4.0 * aSp, uSeaP[3].w);   // how much of the wind sea the grid draws here
      }
      vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  // The fragment shader: the vertex's wave normal plus the short chop from two baked, mipmapped, tiling slope maps
  // (chopTex, made once from the old per-pixel spectrum: sea_state.js bakeChop) in three rotated, scrolled layers at
  // non-commensurate scales; the mipmaps fade the chop to its mean far off by themselves (no aliasing, no streaks at the
  // horizon). One baked RGBA value-noise texture (noiseTex: four fields) stands in for every noise lookup. The surf,
  // rings and caustics are drawn only over the shallows; whitecaps and streaks only when the wind is up.
  const frag = `
    uniform sampler2D depthTex, chopTex, noiseTex;
    uniform vec4 extent;          // x0, z0, width, height
    uniform float time;
    uniform vec3 cShallow, cMid, cDeep, cAbyss, cFoam, cSky, sunDir, sunCol, hzAway, hzSun, tint;
    uniform vec3 glit;
    uniform float moonPath;            // glitter: sheen weight, sparkle sharpness, sparkle weight
    uniform vec4 rainC[4];        // rain squalls (weather.js via sky_time.js): x, z, radius, density
    varying vec3 vWorld; varying float vH; varying vec2 vG; varying float vRes;
    #include <fog_pars_fragment>
    ${WW.sea.GLSL}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // four independent smooth value-noise fields (lattice 1, period ${NOISE_CELLS}), as the old vnoise(p) in each channel
    vec4 nz(vec2 p) { return texture2D(noiseTex, p * ${(1 / NOISE_CELLS).toFixed(6)}); }
    // a chop layer: slope in the world from tile coordinates q (rotation c, s about the wind frame), RG or BA
    vec2 chopL(vec2 wq, float c, float s, float sc, vec2 scroll, bool second) {
      vec2 q = vec2(c * wq.x - s * wq.y, s * wq.x + c * wq.y) * sc + scroll;
      vec4 t = texture2D(chopTex, q);
      vec2 g = (second ? t.ba : t.rg) * 2.0 - 1.0;
      return vec2(c * g.x + s * g.y, -s * g.x + c * g.y);   // back to the wind frame
    }
    void main() {
      vec2 uv = (vWorld.xz - extent.xy) / extent.zw;
      bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
      float d = texture2D(depthTex, clamp(uv, 0.0, 1.0)).r * ${(D_MAX - D_MIN).toFixed(1)} + ${D_MIN.toFixed(1)};
      if (!inside) d = max(d, 18.0);
      if (d < -0.15) discard;          // dry land
      // smooth depth gradient (to the abyss colour by ~13 u, 125 m: below that the sea floor no longer shows in the
      // water's colour, so its relief 100-270 m down does not paint soft dark blotches over the open sea)
      vec3 col = mix(cShallow, cMid, smoothstep(0.0, 4.0, d));
      col = mix(col, cDeep, smoothstep(3.0, 8.0, d));
      col = mix(col, cAbyss, smoothstep(6.5, 13.0, d));
      float alpha = mix(0.62, 0.92, smoothstep(0.0, 10.0, d));
      // fade to fully opaque deep water toward the edge of the sea-floor mesh (no visible seam)
      float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
      float far = smoothstep(0.62, 0.95, edge);
      col = mix(col, cAbyss, far * smoothstep(8.0, 16.0, d));
      alpha = mix(alpha, 1.0, far);
      if (!inside) alpha = 1.0;
      float dist = length(cameraPosition - vWorld);
      float far0 = smoothstep(120.0, 900.0, dist);
      float fp = max(max(fwidth(vWorld.x), fwidth(vWorld.z)), 0.02);
      float aK = seaAmpK(d) * uSeaAmp;
      vec2 wd = uSeaWind; vec2 wq = vec2(dot(vWorld.xz, wd), dot(vWorld.xz, vec2(-wd.y, wd.x)));   // the wind frame
      // gusts: cat's-paws drawn out downwind, a gentle range (a 3x swing on round blobs read as stains on the sea)
      float gust = 0.72 + 0.56 * smoothstep(0.25, 0.8, nz(wq * vec2(0.007, 0.02) - vec2(time * 0.006, 0.0)).r);
      // the short chop: three layers of the baked slope tiles (6 wind-sea wavelengths a tile), turned 0 / +0.65 /
      // -0.95 rad off the wind, at 1, 1.64 and 2.7x the frequency, each scrolled downwind at its own phase speed; a slow
      // mask trades them off (no repeat). Where the grid no longer draws the wind sea (vRes) the chop stands in for it.
      float L0 = max(uSeaP[3].w, 0.3), A0 = uSeaP[3].x / 0.45;
      vec2 chop = vec2(0.0);
      if (aK > 0.0 && fp < L0 * 1.5) {
        vec2 wt = wq / (6.0 * L0);
        float c0 = sqrt(${(9.81 / 9.6).toFixed(4)} * L0 / 6.2832) / (6.0 * L0) * time;   // the wind sea's phase speed, in tiles
        float m = nz(vWorld.xz * 0.011 + 4.0).g;
        chop = chopL(wt, 1.0, 0.0, 1.0, vec2(c0, 0.0), false) * (0.75 + 0.5 * m)
             + chopL(wt, 0.796, 0.605, 1.64, vec2(c0 * 0.78, 0.13), true) * (1.25 - 0.5 * m) * 0.8
             + chopL(wt, 0.582, -0.813, 2.7, vec2(c0 * 0.61, -0.37), false) * 0.55;
        chop *= ${(CHOP_ENC * CHOP_GAIN).toFixed(3)} * A0 / L0 * gust * aK * mix(1.6, 1.0, vRes) * (1.0 - smoothstep(0.6 * L0, 1.5 * L0, fp));
        chop = wd * chop.x + vec2(-wd.y, wd.x) * chop.y;   // the wind frame to the world's
      }
      vec2 sg = vG * mix(1.0, 0.35, smoothstep(0.15, 1.2, fp)) + chop;   // the swell's slope eases off from high up (no corduroy)
      vec3 n = normalize(vec3(-sg.x * uSeaN, 1.0, -sg.y * uSeaN));
      float hN = vH / max(1e-3, uSeaP[0].x + uSeaP[1].x + uSeaP[3].x + uSeaP[4].x);   // ~-1 (trough) .. 1 (crest)
      vec3 sd = normalize(sunDir);
      col *= clamp(1.0 + 0.9 * (dot(n, sd) - sd.y), 0.82, 1.14);
      // crests a little lighter, troughs deeper, and the light through a crest: only close in (low over the water, a
      // crest against the sky behind it); from higher up a wave's height does not show, only its slope (the sheen)
      float hK = 1.0 - smoothstep(0.06, 0.45, fp);
      col *= 1.0 + hK * mix(-0.05, 0.035, smoothstep(-0.9, 0.9, hN));
      col = mix(col, cShallow * vec3(0.96, 1.06, 1.02), smoothstep(0.3, 1.0, hN) * 0.14 * hK * smoothstep(3.0, 10.0, d));
      // whitecaps: broken patches on the steep wind-sea crests from Beaufort 4 (none in a calm), wind streaks of old foam
      float capF = 0.0, streak = 0.0;
      if (uSeaS > 0.38 && d > 1.5) {
        vec4 na = nz(vWorld.xz * vec2(0.9, 1.4) + time * vec2(0.25, 0.4)), nb = nz(vWorld.xz * 3.1 - time * 0.35);
        float fn = na.b * 0.6 + nb.b * 0.4;
        float steep = smoothstep(0.08, 0.3, length(sg));
        float st = uSeaStorm;   // a gale / typhoon (weather.js via sea_state.js): more and bigger caps, crests breaking
        capF = smoothstep(mix(0.15, -0.1, st), 0.6, hN) * smoothstep(mix(0.56, 0.42, st), mix(0.72, 0.6, st), fn) * smoothstep(mix(0.25, 0.1, st), 0.55, nb.a) * mix(steep, 0.6, far0) * smoothstep(0.38, 0.95, uSeaS) * smoothstep(1.5, 5.0, d) * (1.0 - 0.5 * far0 * (1.0 - st));
        // storm: the big crests break, a tumbling white along each swell crest with a torn edge; the spray off it
        capF = max(capF, 0.8 * st * smoothstep(0.45, 0.85, hN) * smoothstep(0.45, 0.7, na.b * 0.5 + nb.g * 0.5) * smoothstep(0.35, 0.65, na.a) * smoothstep(1.5, 5.0, d));   // (broken: patches along the crest, not ruled lines)
      }
      if (uSeaS > 0.3 && far0 < 1.0 && d > 2.0) {
        float st = uSeaStorm;
        float s1 = nz(vec2(wq.x * 0.05, wq.y * 0.45) + time * 0.03).a, s2 = nz(wq * vec2(0.3, 1.2) + 7.0).g;
        streak = smoothstep(0.76, 0.93, s1) * smoothstep(0.45, 0.75, s2) * smoothstep(0.3, 0.8, uSeaS) * 0.2 * (1.0 - far0) * smoothstep(2.0, 6.0, d);
        // spindrift: dense streaks of blown foam laid along the wind, and old foam lying in broad patches; far off the
        // whole sea goes grey-white with it
        if (st > 0.0) {
          // (in drifting bands ~200 u across, broken along their length: no ruled lattice)
          float sd2 = nz(vec2(wq.x * 0.07, wq.y * 0.9) + vec2(time * 0.12, 0.0)).r, band = smoothstep(0.35, 0.7, s1);   // (s1: the long streak field, reused)
          float spin = smoothstep(mix(0.9, 0.68, st), 0.97, sd2) * smoothstep(0.3, 0.7, s2) * band * (0.3 + 0.3 * st);
          float oldF = smoothstep(0.55, 0.8, s1) * 0.3 * st;
          streak = max(streak, max(spin, oldF) * mix(1.0, 0.5, far0) * smoothstep(2.0, 6.0, d));
        }
      }
      streak += 0.12 * uSeaStorm * far0;   // far off a storm sea is grey-white with blown foam
      // a storm sea: greyer and darker, the light gone out of it
      col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))) * vec3(0.82, 0.9, 0.92), 0.55 * uSeaStorm);
      col = mix(col, cFoam, min(1.0, max(capF * 0.9, streak)));
      alpha = max(alpha, capF * 0.85);
      // over the shallows only (most of the screen is deep water: a coherent branch): caustics, the swash line, the
      // breathing ring and the surf
      float foam = 0.0;
      if (d < 4.0) {
        // soft caustic ripples over sandy shallows, by day: reads as water over sand, not a solid surface
        if (tint.g > 0.45) {
          vec2 cq = vWorld.xz;
          float cz = nz(mat2(0.8, 0.6, -0.6, 0.8) * cq * 0.3 + vec2(time * 0.08, -time * 0.06)).r + nz(mat2(0.36, -0.93, 0.93, 0.36) * cq * 0.41 - vec2(time * 0.05, time * 0.07)).g;
          float caust = smoothstep(0.86, 1.0, 1.0 - abs(cz - 1.0)) * (1.0 - smoothstep(1.0, 4.0, d));
          col = mix(col, vec3(0.95, 0.98, 0.94), caust * 0.18);   // calm, slow, faint
        }
        vec4 nw = nz(vWorld.xz * 0.25 + time * 0.15);
        float wob = (nw.b - 0.5) * 0.35;
        // (a narrow swash line: over a wide flat reef the old 0.75 u band painted the whole shelf white, read as white sand)
        float shore = (1.0 - smoothstep(0.12, 0.42, d + wob)) * 0.9;
        float ringPos = 1.3 + 0.45 * sin(time * 0.8 + vWorld.x * 0.02);
        // the seabed's slope from the depth texture a texel either side (not the screen derivatives of d: the 8-bit
        // texture's filtered depth moves in steps, so dFdx(d) flickered pixel to pixel at low angles and the surf and
        // rings that key on it came out as a dotted moire over the reef)
        vec2 te = vec2(${TEX_STEP.toFixed(1)}) / extent.zw;
        float dgx = texture2D(depthTex, clamp(uv + vec2(te.x, 0.0), 0.0, 1.0)).r - texture2D(depthTex, clamp(uv - vec2(te.x, 0.0), 0.0, 1.0)).r;
        float dgz = texture2D(depthTex, clamp(uv + vec2(0.0, te.y), 0.0, 1.0)).r - texture2D(depthTex, clamp(uv - vec2(0.0, te.y), 0.0, 1.0)).r;
        float slope = length(vec2(dgx, dgz)) * ${((D_MAX - D_MIN) / (2 * TEX_STEP) * 0.5).toFixed(3)};   // ~ half the seabed gradient
        float ring = (1.0 - smoothstep(0.0, 0.18, abs(d + wob * 0.6 - ringPos))) * 0.55 * (1.0 - smoothstep(1.2, 2.4, d)) * smoothstep(0.08, 0.2, slope);
        // the surf: lines of breaking white running in over the reef edge with the swell, lacy foam behind each,
        // stronger in a bigger swell (uSeaP[0].x: the main swell's amplitude)
        float sAmp = clamp(uSeaP[0].x / 0.09, 0.5, 1.3) * uSeaAmp;
        float bellF = smoothstep(0.1, 0.4, d) * (1.0 - smoothstep(1.8, 3.2, d)) * smoothstep(0.015, 0.07, slope);
        float surf = 0.0;
        if (bellF > 0.0) {
          float bp = fract(0.9 * d + uSeaK[0].w * time * 0.15915 + 0.25);
          float lipN = nz(vec2(vWorld.x * 0.35 + vWorld.z * 0.21, time * 0.3)).r * 0.7 + nz(vWorld.xz * 1.7 + time).g * 0.3;
          float lip = smoothstep(0.0, 0.06, bp) * (1.0 - smoothstep(0.16, 0.36, bp)) * smoothstep(0.2, 0.48, lipN);
          float lace = smoothstep(0.62, 0.8, nw.a) * (1.0 - smoothstep(0.0, 0.45, fract(bp + 0.6)));
          surf = (lip * 1.0 + lace * 0.6) * bellF * sAmp * (1.0 - 0.5 * far0);
        }
        foam = max(max(shore, ring), clamp(surf, 0.0, 1.0));
        col = mix(col, cFoam, foam);
        alpha = max(alpha, foam * 0.95);
      }
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
      vec3 v = (cameraPosition - vWorld) / dist;
      // warm sun-glitter path toward the low sun: a soft sheen plus fine sparkles on a rippled normal
      // (the ripples ride the sea's own normal: the glitter runs along the swell; in a calm the sheen is a mirror)
      float calm = 1.0 - smoothstep(0.05, 0.35, uSeaS);
      if (glit.z > 0.0 && vRes > -0.5) {
        vec2 rip = (nz(vWorld.xz * 1.4 + time * vec2(0.35, -0.3)).ra - 0.5) * mix(1.0, 0.45, calm);
        vec3 nrm = normalize(n + vec3(rip.x * 0.35, 0.0, rip.y * 0.35));
        float rs = max(dot(reflect(-v, nrm), sunDir), 0.0);
        float sheen = pow(max(dot(reflect(-v, n), sunDir), 0.0), mix(18.0, 40.0, calm)) * (1.0 + 1.5 * calm);
        col += sunCol * (sheen * glit.x + pow(rs, glit.y) * glit.z * (1.0 - smoothstep(3.0, 12.0, fp))) *   // (no sparkle on the far rim: it aliased into a row of dashes)
           smoothstep(1.0, 4.0, d) * (1.0 - foam);   // glit: day (0.1, 420, 0.35); the moon path is wider
      }
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
        // (the haze takes the sea only part way out to the fog's far distance, 0.6: what floats there sits on water,
        // not in a pale band of sky; beyond it the haze keeps thickening, smoothly, to the sky's own horizon colour at
        // the grid's rim / skirt, so the sea meets the sky with no seam and no flat band of capped fog)
        float fogF = smoothstep(fogNear, fogFar, vFogDepth) * 0.6 + smoothstep(fogFar * 0.6, min(${R_MAX.toFixed(1)}, fogFar * 2.1), vFogDepth) * 0.4;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, fogF);
      #endif
      // the moon's path (night, moonPath > 0): a column of glittering ripples under the moon, out to the horizon
      if (moonPath > 0.0 && vRes > -0.5) {
        vec2 vd = normalize(vWorld.xz - cameraPosition.xz), md = normalize(sunDir.xz);
        float col0 = exp(-(1.0 - dot(vd, md)) * 130.0) * smoothstep(-0.2, 0.6, dot(vd, md));
        if (col0 > 0.002) {
          float rip2 = nz(vWorld.xz * 1.9 + vec2(time * 0.5, -time * 0.35)).g * nz(vWorld.xz * 0.7 - time * 0.2).b;
          float sp = smoothstep(0.18, 0.42, rip2);
          float graze = 1.0 - smoothstep(0.12, 0.42, v.y);   // a path to the horizon, not a pool at our feet
          gl_FragColor.rgb += sunCol * col0 * graze * (0.1 + 0.55 * sp) * moonPath * smoothstep(1.0, 4.0, d);
        }
      }
    }`;


  // a small local [0, 1) stream (never the sim's generator: these are visual only)
  function stream(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let q = Math.imul(s ^ (s >>> 15), 1 | s); q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q; return ((q ^ (q >>> 14)) >>> 0) / 4294967296; }; }
  function mipTex(data, n) {
    const tx = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.generateMipmaps = true; tx.anisotropy = WW.renderer && WW.renderer.capabilities ? Math.min(8, WW.renderer.capabilities.getMaxAnisotropy()) : 1;
    tx.needsUpdate = true; return tx;
  }
  // The short chop, baked once: two tiling slope fields (RG and BA), each the old per-pixel spectrum (sea_state.js's
  // 14 components, 1.2x down to ~0.1x the wind sea's wavelength at a ratio of 0.81, spread about the wind, wider for
  // the shorter ones, a few across it), three directions a scale, wave vectors on the tile's lattice (the tile is 6
  // wind-sea wavelengths: it tiles exactly). Slopes per unit of the wind sea's amplitude / wavelength.
  function bakeChop() {
    const N = CHOP_RES, out = new Uint8Array(N * N * 4), gx = new Float32Array(N * N), gz = new Float32Array(N * N);
    const cx = new Float32Array(N), sx = new Float32Array(N), cz = new Float32Array(N), sz = new Float32Array(N);
    for (let f = 0; f < 2; f++) {
      const r = stream(0xC40F + f * 977); gx.fill(0); gz.fill(0);
      let L = 1.2;
      for (let i = 0; i < 12; i++, L *= 0.81) {
        const fi = i / 11, spread = 0.45 + 1.15 * fi, A = 0.18 * Math.pow(L, 1.6) / Math.sqrt(3);   // (steeper than the old L^1.2: the finest ripples no longer as steep as the wind sea's, no grain)
        for (let j = 0; j < 3; j++) {
          const u = (((i * 3 + j + f * 7) * 0.6180339887 + 0.31) % 1) * 2 - 1, off = spread * u + ((i + j) % 5 === 3 ? 1.9 : 0);
          const m = 6 / L, nx = Math.round(m * Math.cos(off)), nz = Math.round(m * Math.sin(off));
          if (!nx && !nz) continue;
          const kk = 2 * Math.PI * Math.hypot(nx, nz) / 6, ph = r() * 6.2832, amp = A * kk / Math.hypot(nx, nz);   // slope = A k (dir), dir = n / |n|
          for (let x = 0; x < N; x++) { const a = 2 * Math.PI * nx * x / N; cx[x] = Math.cos(a); sx[x] = Math.sin(a); }
          for (let z = 0; z < N; z++) { const a = 2 * Math.PI * nz * z / N + ph; cz[z] = Math.cos(a); sz[z] = Math.sin(a); }
          for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
            const c = cx[x] * cz[z] - sx[x] * sz[z], k = z * N + x;   // cos(ax + az + ph): h = A sin(.), slope = A k cos(.) dir
            gx[k] += amp * nx * c; gz[k] += amp * nz * c;
          }
        }
      }
      for (let k = 0; k < N * N; k++) {
        out[k * 4 + f * 2] = Math.max(0, Math.min(255, Math.round((gx[k] / CHOP_ENC * 0.5 + 0.5) * 255)));
        out[k * 4 + f * 2 + 1] = Math.max(0, Math.min(255, Math.round((gz[k] / CHOP_ENC * 0.5 + 0.5) * 255)));
      }
    }
    return mipTex(out, N);
  }
  // Four independent smooth value-noise fields (one a channel), lattice NOISE_CELLS a side, tiling: what vnoise(p) gave
  // (smoothstep between random lattice values), one texture fetch for four of them
  function bakeNoise() {
    const N = NOISE_RES, C = NOISE_CELLS, T = N / C, out = new Uint8Array(N * N * 4), lat = new Float32Array(C * C);
    for (let ch = 0; ch < 4; ch++) {
      const r = stream(0x5EED + ch * 131); for (let i = 0; i < C * C; i++) lat[i] = r();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / T, fy = y / T, ix = Math.floor(fx), iy = Math.floor(fy);
        let ux = fx - ix, uy = fy - iy; ux = ux * ux * (3 - 2 * ux); uy = uy * uy * (3 - 2 * uy);
        const a = lat[iy * C + ix], b = lat[iy * C + (ix + 1) % C], c = lat[((iy + 1) % C) * C + ix], d = lat[((iy + 1) % C) * C + (ix + 1) % C];
        out[(y * N + x) * 4 + ch] = Math.round(((a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy) * 255);
      }
    }
    return mipTex(out, N);
  }
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
    mat.uniforms.chopTex = { value: bakeChop() }; mat.uniforms.noiseTex = { value: bakeNoise() };
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
    catcher = new THREE.Mesh(sg, WW.sea.ride(new THREE.ShadowMaterial({ color: 0x3a3f6a, opacity: 0.24, depthWrite: false }), 'conform', CATCH / CATCH_N));
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
    rs.push(R_MAX);   // the skirt ring (aSp -1): the vertex shader raises it to the horizon
    const nv = 1 + (rs.length - 1) * SEGS, pos = new Float32Array(nv * 3), sp = new Float32Array(nv);
    sp[0] = R_MIN_SP;
    for (let i = 1; i < rs.length; i++) for (let j = 0; j < SEGS; j++) {
      const a = j / SEGS * 2 * Math.PI, k = 1 + (i - 1) * SEGS + j;
      pos[k * 3] = Math.cos(a) * rs[i]; pos[k * 3 + 2] = Math.sin(a) * rs[i];
      sp[k] = i === rs.length - 1 ? -1 : Math.max(R_MIN_SP, rs[i] - rs[i - 1], rs[i] * 2 * Math.PI / SEGS);
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
      blobMat = WW.sea.ride(new THREE.MeshBasicMaterial({ color: 0x1c2a4a, alphaMap: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false }), 'conform', 1 / 8);   // lies on the waves (the long ones: 8 cells along a hull)
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
