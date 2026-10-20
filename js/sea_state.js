// sea_state.js - WW.sea: the Pacific's sea state (visual only: the sim never reads it; Math.random / WW.rand never
// drawn, the round's sea comes from a hash of the round's map seed and number). A 1942 South / Central Pacific sea at
// the game's scale (1 u = 9.6 m):
//  - a long ocean swell from one direction: 1.0-2.5 m high, 10-12.5 s, 150-245 m long (three components spread
//    +-0.3 rad in direction and 0.8-1.3x in length: short crests, the sets come and go)
//  - the trade-wind sea on top from the round's wind (WW.wind: the direction it blows toward): 0.1 m (a glassy calm,
//    Midway's morning of 4 June 1942) up to ~1.7 m of short chop (fresh trades, Beaufort 5, squalls: Coral Sea / Santa
//    Cruz), 2.5-5.5 s, its crests peaked as the wind gets up (five components spread about the wind)
//  - real dispersion: omega = sqrt(g k), g = 9.81 m/s^2 = 1.022 u/s^2, on the real clock (as waves.js), so the sea
//    keeps rolling in slow motion and while paused
//  - shoaling over the reefs: the waves grow over the shelf and die on the reef flat; water.js draws the surf where
//    they break (breaker lines running in over the reef edge)
//  - HEIGHT EXAG: heights x HEIGHT_EXAG (2.0) so they read at the game's camera distances; water.js shades with the
//    surface's normal at NORMAL_EXAG (1.6) times the drawn slope again (the glitter and the crest light)
// One height function, three copies kept in step: JS (height / slope / grad, for everything that rides the sea:
// ship_swell.js), the water mesh's vertex and fragment shaders (water.js), and the ride() patch for other materials
// (effects.js foam / splashes, oil, the hull contact shadows) that lifts them onto the surface on the GPU.
// In Normandy everything here defers to waves.js (the Channel), and the Pacific surface is flattened (uSeaAmp 0).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const N = 8, G = 9.81 / 9.6, M = 9.6;
  const HEIGHT_EXAG = 2.0, NORMAL_EXAG = 1.6;
  const SHOAL = { grow: 0.8, d0: 1.2, d1: 8, die0: -0.3, die1: 1.0 };
  // the uniforms every sea material shares (same objects: one update moves them all)
  const U = {
    uSeaT: { value: 0 }, uSeaAmp: { value: 1 }, uSeaS: { value: 0.4 }, uSeaStorm: { value: 0 }, uSeaN: { value: NORMAL_EXAG },
    uSeaK: { value: [] }, uSeaP: { value: [] }, uSeaWind: { value: null },
    depthTex: { value: null }, extent: { value: null }
  };
  const W = [];   // [{dx, dz, k, w, A, p, ph, L, wind}]
  let T = 0, S = 0.4, rolled = '', want = true, forced = null, info = {};

  // a small hash -> [0, 1) stream (mulberry32 on a local state: never the sim's generator)
  function stream(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function parseForce() {
    if (typeof location === 'undefined') return null;
    const m = /[?&]sea=([a-z0-9.]+)/.exec(location.search); if (!m) return null;
    const v = { glassy: 0.02, calm: 0.08, moderate: 0.45, fresh: 0.85, rough: 1, gale: 1.4, typhoon: 1.8 }[m[1]];
    return v !== undefined ? v : Math.max(0, Math.min(2, +m[1] || 0));   // above 1: a storm (1 + storm)
  }
  forced = parseForce();
  if (typeof location !== 'undefined' && /[?&]nosea\b/.test(location.search)) want = false;   // A/B: the old flat sea

  // A sim-level sea state (WW.seaState, if a sim module rolls one from WW.rand at round start, e.g. for how easily a
  // torpedo's wake is seen) wins over the visual roll, so what is drawn agrees with what the sim plays. Read only,
  // never written: the sim does not depend on this file. Accepted: a number 0..1 (this file's S), a number > 1 (a
  // Beaufort force), or an object with S / state / level (0..1) or beaufort.
  function simSea() {
    const v = WW.seaState;
    if (v === undefined || v === null) return null;
    const fromB = b => Math.max(0, Math.min(1, (b - 1) / 4.5));
    if (typeof v === 'number') return isFinite(v) ? (v > 1 ? fromB(v) : Math.max(0, v)) : null;
    if (typeof v === 'object') {
      const k = v.S !== undefined ? v.S : v.state !== undefined ? v.state : v.level;
      if (typeof k === 'number' && isFinite(k)) return k > 1 ? fromB(k) : Math.max(0, k);
      if (typeof v.beaufort === 'number') return fromB(v.beaufort);
    }
    return null;
  }
  // heavy weather beyond S = 1 (weather.js WW.seaState.storm: Douglas 5 .. 9 -> 0 .. 1; ?sea=1.8 forces 0.8): a gale's
  // and a typhoon's sea, higher, longer and peakier
  function storm() { const v = WW.seaState; return v && typeof v.storm === 'number' && isFinite(v.storm) ? Math.max(0, Math.min(1, v.storm)) : 0; }
  // the round's sea: S in 0..1 (0 a glassy calm, 1 fresh trades with squalls about)
  function roll() {
    const g = WW.game || {}, seed = ((g.seed || (WW.terrain && WW.terrain.seed) || 1) ^ Math.imul((WW.stats && WW.stats.round) || 0, 0x9E3779B1)) >>> 0;
    const r = stream(seed ^ 0x5EA5EA);
    const u = r(), wind = WW.wind || { x: 0.6, z: 0, a: 0 }, ws = Math.hypot(wind.x, wind.z), wf = Math.max(0, Math.min(1, (ws - 0.5) / 0.4));
    const kind = WW.weather ? WW.weather.kind : 'clear';
    let s = u < 0.16 ? 0.02 + 0.08 * r() : 0.15 + 0.85 * (0.55 * Math.pow(r(), 0.9) + 0.45 * wf);   // ~1 round in 6 a calm
    if (kind === 'scatter') s = Math.max(s, 0.55 + 0.2 * r());
    if (kind === 'line') s = Math.max(s, 0.78 + 0.2 * r());
    const sim = simSea();
    if (sim !== null) s = sim;                 // the sim's own sea state when there is one: the waves agree with it
    if (forced !== null) s = Math.min(1, forced);
    set(s, r, wind, forced !== null ? Math.max(0, forced - 1) : storm());
  }
  // build the components for sea state s (r: a [0,1) stream; wind: {x, z, a})
  // st: the storm beyond S = 1 (0..1): the wind sea to ~7.7 m and 10.5 s, the swell to ~6 m, crests peakier; the
  // height exaggeration eases off as it grows (a typhoon's sea drawn ~9 m crest to trough, not 2 x 14 m: still
  // higher than a destroyer's freeboard, heavy but believable at the game's scale)
  function set(s, r, wind, st) {
    S = s; st = st || 0; r = r || stream(1234); wind = wind || WW.wind || { x: 0.6, z: 0, a: 0 };
    const calm = s < 0.2, v = r(), ex = 1 - 0.35 * st;
    const Hs = (calm ? 1.0 + 0.5 * v : 1.5 + 1.0 * v) + 3.5 * st;         // swell height (m, crest to trough)
    const Ts = 10 + 2.5 * r() + 2 * st;                                     // swell period (s)
    const Hw = (0.1 + 1.6 * Math.pow(s, 1.2) + 6 * st) * ex;              // wind sea height (m)
    const Tw = 2.5 + 3.0 * s + 5 * st;                                      // wind sea period (s)
    const Ls = G * Ts * Ts / (2 * Math.PI), Lw = G * Tw * Tw / (2 * Math.PI);   // u
    const aw = wind.a !== undefined ? wind.a : Math.atan2(wind.z, wind.x);
    const as = aw + (r() - 0.5) * 2.2;                                      // the swell: from a distant storm, off the wind
    const As = Hs / 2 / M * HEIGHT_EXAG * ex, Aw = Hw / 2 / M * HEIGHT_EXAG, pw = 1 + 0.9 * s + 0.6 * st;
    // the swell's three: one main train and two at +-0.26-0.31 rad, 0.79 / 1.27 its length, nearly as strong: the crests
    // short (~3 wavelengths), in sets that come and go (the old three, +-0.12-0.18 rad and 0.83 / 1.21 under a dominant
    // first, read as one train of ruled parallel lines over the whole sea: corduroy from above).
    // the wind sea's five: wavelengths at non-commensurate ratios (no two within ~20%, so no pair beats into a regular
    // lattice) and directions spread unevenly about the wind (the short chop is drawn per pixel only: water.js
    // seaDetail). The old set (1, 0.72, 0.55, 1.35, 0.4 at +-0.45-0.5 rad) crossed into a diamond grid in the shading.
    const spec = [[Ls, As * 0.52, as, 1, 0], [Ls * 0.79, As * 0.34, as + 0.31, 1, 0], [Ls * 1.27, As * 0.3, as - 0.26, 1, 0],
      [Lw, Aw * 0.45, aw, pw, 1], [Lw * 0.71, Aw * 0.3, aw + 0.61, pw, 1], [Lw * 1.31, Aw * 0.32, aw - 0.37, pw, 1],
      [Lw * 0.53, Aw * 0.2, aw - 1.03, pw, 1], [Lw * 1.67, Aw * 0.22, aw + 0.23, pw, 1]];
    W.length = 0;
    for (const [L, A, a, p, wd] of spec) { const k = 2 * Math.PI / L; W.push({ dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(G * k), A, p, ph: r() * 6.283, L, wind: wd }); }
    info = { S: s, storm: st, Hs, Ts, Ls: Ls * M, Hw, Tw, Lw: Lw * M, beaufort: Math.round(1 + 4.5 * s), swellDir: as, windDir: aw, exag: HEIGHT_EXAG };
    if (typeof THREE !== 'undefined') {
      if (!U.uSeaK.value.length) for (let i = 0; i < N; i++) { U.uSeaK.value.push(new THREE.Vector4()); U.uSeaP.value.push(new THREE.Vector4()); }
      if (!U.uSeaWind.value) U.uSeaWind.value = new THREE.Vector2(1, 0);
      W.forEach((c, i) => { U.uSeaK.value[i].set(c.dx, c.dz, c.k, c.w); U.uSeaP.value[i].set(c.A, c.p, c.ph, c.L); });
      U.uSeaWind.value.set(Math.cos(aw), Math.sin(aw));
      U.uSeaS.value = s; U.uSeaStorm.value = st;
    }
  }
  set(0.4);

  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function ampK(d) { return (1 + SHOAL.grow * (1 - sm(SHOAL.d0, SHOAL.d1, d))) * sm(SHOAL.die0, SHOAL.die1, d); }
  function depth(x, z) {
    const T0 = WW.terrain; if (!T0 || !T0.depthAt) return 20;
    const W0 = WW.cfg.MAP_W, H0 = WW.cfg.MAP_H;
    if (x < 0 || z < 0 || x > W0 || z > H0) return 20;
    return T0.depthAt(x, z);
  }
  // the Pacific surface (no Normandy delegation): h, dh/dx, dh/dz at (x, z)
  const _g = { h: 0, x: 0, z: 0 };
  // sp > 0: each component weighted as the water mesh draws it there (seaGrad's sp: dropped when shorter than ~3 grid
  // samples sp apart); Lh > 0: and as a hull Lh long answers it (waves much shorter than the hull cancel along it: no
  // heave, pitch or roll from them). Neither: the full surface.
  function pacGrad(x, z, d, sp, Lh) {
    if (d === undefined) d = depth(x, z);
    const a = ampK(d);
    let h = 0, gx = 0, gz = 0;
    if (a > 0) for (let i = 0; i < W.length; i++) {
      const c = W[i];
      let r = 1;
      if (sp > 0) r *= sm(2.5 * sp, 4.0 * sp, c.L);
      if (Lh > 0) r *= sm(0.35 * Lh, 0.9 * Lh, c.L);
      if (r <= 0) continue;
      const A = c.A * r, ph = c.k * (c.dx * x + c.dz * z) - c.w * T + c.ph, sn = Math.sin(ph), q = 0.5 + 0.5 * sn;
      if (c.p === 1) { h += A * sn; const dd = A * Math.cos(ph) * c.k; gx += dd * c.dx; gz += dd * c.dz; }
      else { const qp = Math.pow(q, c.p - 1); h += A * (2 * qp * q - 1 + (c.p - 1) * 0.18); const dd = A * c.p * qp * Math.cos(ph) * c.k; gx += dd * c.dx; gz += dd * c.dz; }
    }
    _g.h = h * a; _g.x = gx * a; _g.z = gz * a;
    return _g;
  }
  // The water mesh (water.js): rings about the camera, GRID.SEGS segments round, the finest GRID.R_MIN_SP apart; the
  // grid spacing at (x, z) is ~ its distance from the camera x 2 pi / SEGS (what the vertex shader's aSp is there)
  const GRID = { SEGS: 192, R_MIN_SP: 0.4 };
  function meshSp(x, z) {
    const C = WW.camera; if (!C) return GRID.R_MIN_SP;
    return Math.max(GRID.R_MIN_SP, Math.hypot(x - C.position.x, z - C.position.z) * 2 * Math.PI / GRID.SEGS);
  }
  // the surface a hull Lh long rides at (x, z): as the mesh draws it there, less the waves too short to move the hull
  function hull(x, z, Lh) {
    if (normandy() || !on()) { const g = { h: height(x, z), x: 0, z: 0 }, sl = slope(x, z); g.x = sl.x; g.z = sl.z; return g; }
    return pacGrad(x, z, undefined, meshSp(x, z), Lh);
  }
  const normandy = () => WW.isScn && WW.isScn('normandy');
  function on() { return want && !WW.simOnly && !normandy(); }
  // the surface height at (x, z) above the still-water level (0); Normandy: waves.js's sea
  function height(x, z) {
    if (normandy()) return WW.waves && WW.waves.active ? WW.waves.height(x, z) : 0;
    return on() ? pacGrad(x, z).h : 0;
  }
  function slope(x, z, e) {
    if (normandy()) return WW.waves && WW.waves.active ? WW.waves.slope(x, z, e) : { x: 0, z: 0 };
    if (!on()) return { x: 0, z: 0 };
    const g = pacGrad(x, z); return { x: g.x, z: g.z };
  }
  // per frame (main.js, real time), before the water and what rides it
  function update(rdt) {
    if (WW.simOnly) return;
    const r = WW.stats ? WW.stats.round : 0, key = r + '|' + ((WW.game && WW.game.seed) || 0) + '|' + simSea() + '|' + storm();
    if (key !== rolled) { rolled = key; roll(); }
    T += Math.min(0.1, rdt || 0);
    U.uSeaT.value = T;
    U.uSeaAmp.value = on() ? 1 : 0;
  }

  // ---- GLSL ----
  // seaGrad(p, d, sp): vec3(h, dh/dx, dh/dz); sp > 0: drop components shorter than ~3 grid samples sp apart (the mesh
  // cannot draw them: they would swim), sp < 0: drop components shorter than ~3 pixel footprints (-sp: no shimmer)
  const GLSL = `
    uniform float uSeaT, uSeaAmp, uSeaS, uSeaStorm, uSeaN;
    uniform vec4 uSeaK[${N}], uSeaP[${N}];
    uniform vec2 uSeaWind;
    float seaAmpK(float d) { return (1.0 + ${SHOAL.grow.toFixed(2)} * (1.0 - smoothstep(${SHOAL.d0.toFixed(2)}, ${SHOAL.d1.toFixed(2)}, d))) * smoothstep(${SHOAL.die0.toFixed(2)}, ${SHOAL.die1.toFixed(2)}, d); }
    vec3 seaGrad(vec2 p, float d, float sp) {
      float a = seaAmpK(d) * uSeaAmp;
      vec3 r = vec3(0.0);
      if (a <= 0.0) return r;
      for (int i = 0; i < ${N}; i++) {
        vec4 K = uSeaK[i], P = uSeaP[i];
        float res = sp > 0.0 ? smoothstep(2.5 * sp, 4.0 * sp, P.w) : smoothstep(-3.0 * sp, -6.0 * sp, P.w);
        if (res <= 0.0) continue;
        float ph = K.z * dot(K.xy, p) - K.w * uSeaT + P.z, sn = sin(ph), cs = cos(ph), q = 0.5 + 0.5 * sn;
        float qp = pow(max(q, 1e-4), P.y - 1.0);
        r.x += P.x * res * (2.0 * qp * q - 1.0 + (P.y - 1.0) * 0.18);
        r.yz += P.x * res * P.y * qp * cs * K.z * K.xy;
      }
      return r * a;
    }`;
  // (the water's fragment shader no longer sums waves per pixel: it shades with the vertex's wave normal and baked
  // chop textures, water.js)
  // depth lookup for materials other than the water (same texture and extent as water.js)
  const GLSL_DEPTH = `
    uniform sampler2D depthTex; uniform vec4 extent;
    float seaDepth(vec2 p) {
      vec2 uv = (p - extent.xy) / extent.zw;
      float d = texture2D(depthTex, clamp(uv, 0.0, 1.0)).r * 32.0 - 4.0;
      if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) d = max(d, 18.0);
      return d;
    }
    // the water mesh's grid spacing at p (meshSp): what rides the sea takes the waves the mesh draws there, no others
    float seaMeshSp(vec2 p) { return max(${GRID.R_MIN_SP.toFixed(2)}, length(p - cameraPosition.xz) * ${(2 * Math.PI / GRID.SEGS).toFixed(5)}); }`;
  // ride(material, mode): the material's vertices are lifted onto the sea in world space.
  //   'conform': every vertex by the height under it (foam, slicks, contact shadows lie on the waves)
  //   'origin': by the height under the object's / instance's origin, fading out above 1.5-6 u (a splash column rises
  //   from where the water is; smoke and flak high up are untouched)
  // cell (optional): the material's own vertex spacing in object units (x its object's x scale): waves shorter than ~3
  // cells are left out too (a coarse sheet sampling the short chop aliases: its shading and the shadows on it crawl)
  function ride(mat, mode, cell) {
    if (!mat || mat.userData.seaRide) return mat;
    mat.userData.seaRide = mode || 'conform';
    const uCell = { value: cell || 0 };
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      for (const k in U) sh.uniforms[k] = U[k];
      sh.uniforms.uRideCell = uCell;
      const origin = mat.userData.seaRide === 'origin';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL + GLSL_DEPTH + `\n    uniform float uRideCell;\n    float seaRideSp(vec2 p) { return max(seaMeshSp(p), uRideCell * length(modelMatrix[0].xyz)); }`);
      if (origin) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
          vec4 seaW = vec4(transformed, 1.0), seaO = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            seaW = instanceMatrix * seaW; seaO = instanceMatrix * seaO;
          #endif
          seaW = modelMatrix * seaW; seaO = modelMatrix * seaO;
          seaW.y += seaGrad(seaO.xz, seaDepth(seaO.xz), seaRideSp(seaO.xz)).x * (1.0 - smoothstep(1.5, 6.0, seaO.y));
          vec4 mvPosition = viewMatrix * seaW;
          gl_Position = projectionMatrix * mvPosition;`);
      // conform: the local vertex itself is lifted (so the shadow / world-position chunks after it agree); assumes the
      // object's (and instance's) y axis is the world's, unscaled: flat things turned about y only
      else sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec4 seaW = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              seaW = instanceMatrix * seaW;
            #endif
            seaW = modelMatrix * seaW;
            transformed.y += seaGrad(seaW.xz, seaDepth(seaW.xz), seaRideSp(seaW.xz)).x;
          }`);
    };
    const pkey = prev ? prev.toString() : '';
    mat.customProgramCacheKey = function () { return 'seaRide-' + mat.userData.seaRide + '|' + pkey; };
    mat.needsUpdate = true;
    return mat;
  }

  WW.sea = {
    update, height, slope, ride, set: (s) => { forced = s; rolled = ''; }, enable: (v) => { want = v !== false; },
    grad: (x, z) => (on() ? pacGrad(x, z) : (_g.h = height(x, z), _g.x = 0, _g.z = 0, _g)),
    depth, ampK, uniforms: U, GLSL, N, SHOAL, HEIGHT_EXAG, NORMAL_EXAG,
    hull, meshSp, GRID,
    get active() { return on() || (normandy() && !!(WW.waves && WW.waves.active)); },
    get pacific() { return on(); },
    get time() { return T; }, get state() { return S; }, get info() { return info; }, get waves() { return W; }
  };
})(window.WW);
