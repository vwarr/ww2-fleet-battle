// normandy_sky.js - WW.normandySky: the weather of 6 June 1944 over Omaha that the sky dome alone does not give
// (visual only; Math.random; render mode). The overcast's colour and light are sky_time.js (scenario overcast); here:
//  - the low cloud deck (1,000-3,000 ft, broken to unbroken, drifting east-south-east on the WNW wind): a ceiling,
//    not a sky of separate clouds. A camera-centred noise layer (CEIL u up: fbm in world space, so it does not swim)
//    with darker, thicker lumps on its underside, thinning to a broken top seen from above (the B-24s fly over it at
//    ~6,000 m, as they did, bombing on instruments; the P-47s dive through it), fading into the grey horizon, a
//    little brighter toward the sun. Its colours follow the overcast's fog (sky_time.js overcast). (It replaced a
//    deck of flattened lumpy spheres, which read as separate grey saucers, not a ceiling.)
//  - smoke from the grass fires the bombardment lit on the bluffs, drifting along the beach on the wind (it hid some
//    of the climbs on the day: Colonel Taylor's men went up through it near E-1 / E-3)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const SMOKE_EVERY = 0.35, CEIL = 36;
  let ceil = null, smokeT = 0, sites = null, drift = 0;
  const CV = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const CF = `uniform vec3 cLit, cDark, cTop, cHz, cSun; uniform vec2 off, sunXZ; uniform float above, near, high; varying vec3 vW;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
    void main(){
      vec2 p = (vW.xz + off) * vec2(0.009, 0.0135);                  // stretched along the wind (rolls of stratocumulus)
      float d = fbm(p), d2 = fbm(p * 3.1 + 7.0);
      float dens = smoothstep(0.28, 0.72, d * 0.8 + d2 * 0.3);
      vec2 dv = vW.xz - cameraPosition.xz; float dist = length(dv), far = smoothstep(500.0, 2400.0, dist);
      float toward = pow(clamp(dot(dv / max(dist, 1.0), sunXZ) * 0.5 + 0.5, 0.0, 1.0), 3.0);   // the sun's side: brighter, warmer
      vec3 hz = mix(cHz, cSun, toward * 0.6);
      vec3 c; float a;
      if (above < 0.5) {                                             // from below: a grey ceiling, lumps darker
        c = mix(cLit, cDark, dens * (1.0 - far * 0.5));
        c = mix(c, cLit * 1.08, smoothstep(0.62, 0.8, d2) * 0.3);    // paler thin seams between the rolls
        c *= 1.0 + 0.14 * toward;
        a = mix(0.86, 1.0, dens);
      } else {                                                       // from above: a broken white-grey top
        c = mix(cTop * 0.86, cTop, dens);
        a = smoothstep(0.5, 0.8, d * 0.8 + d2 * 0.3) * 0.6 * (1.0 - high);   // thin and gone from high up: the coast shows
      }
      c = mix(c, hz, far * 0.8);
      a = mix(a, 1.0, far * (1.0 - above)) * near * (1.0 - smoothstep(2600.0, 3300.0, dist));
      gl_FragColor = vec4(c, a);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`;
  function build() {
    const C = h => new THREE.Color(h);
    ceil = new THREE.Mesh(new THREE.PlaneGeometry(6800, 6800).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { cLit: { value: C(0x9aa0a6) }, cDark: { value: C(0x6c727a) }, cTop: { value: C(0xdcdee0) }, cHz: { value: C(0x9ea4a8) }, cSun: { value: C(0xc0bfb8) }, sunXZ: { value: new THREE.Vector2(1, 0) }, high: { value: 0 }, off: { value: new THREE.Vector2() }, above: { value: 0 }, near: { value: 1 } },
      vertexShader: CV, fragmentShader: CF, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ceil.name = 'cloudCeiling'; ceil.renderOrder = -5; ceil.frustumCulled = false;
    WW.scene.add(ceil);
  }
  // the ceiling's colours from the overcast's light: its underside a shade under the horizon haze, lumps darker
  const _c = new THREE.Color();
  function shade() {
    const u = ceil.material.uniforms, fog = WW.scene.fog, cam = WW.camera;
    if (fog) { u.cHz.value.copy(fog.color); u.cLit.value.copy(fog.color).multiplyScalar(0.93); u.cDark.value.copy(fog.color).multiplyScalar(0.7); }
    const sun = WW.sky && WW.sky.sunColor && WW.sky.sunColor();
    u.cTop.value.setRGB(0.86, 0.87, 0.88); if (sun) u.cTop.value.lerp(_c.copy(sun), 0.15);
    if (fog) u.cTop.value.multiplyScalar(0.6 + 0.4 * Math.min(1, (fog.color.r + fog.color.g + fog.color.b) / 1.8));
    if (cam) { ceil.position.set(cam.position.x, CEIL, cam.position.z); u.above.value = cam.position.y > CEIL ? 1 : 0; u.near.value = WW.clamp((Math.abs(cam.position.y - CEIL) - 1.5) / 6, 0, 1); u.high.value = WW.clamp((cam.position.y - CEIL - 40) / 200, 0, 1); }
    const P = WW.sky && WW.sky.parts && WW.sky.parts();
    if (P && P.dome) { const du = P.dome.material.uniforms; u.cSun.value.copy(du.sunSide.value); u.sunXZ.value.set(du.sunDir.value.x, du.sunDir.value.z).normalize(); }
    u.off.value.set(-drift * 0.92, -drift * 0.39);
  }
  // the burning bluff tops: points along the bluffs between the draws (smoke drifts east on the wind)
  function smokeSites() {
    const T = WW.normandyTerrain, out = [];
    for (let x = 1340; x < 2120; x += 26) out.push({ x, z: T.bluffTopZ(x) - 3, y: Math.max(0, WW.terrain.heightRaw(x, T.bluffTopZ(x) - 3)) });
    return out;
  }
  function update(rdt) {
    const on = !WW.simOnly && !!WW.scene && WW.isScn('normandy') && !!WW.normandyTerrain;
    if (on && !ceil) build();
    const ovw = WW.cam && WW.cam.isOverview && WW.cam.isOverview();
    if (ceil) ceil.visible = on && !ovw;
    if (!on) return;
    const dt = Math.min(0.1, rdt || 0), w = WW.wind || { x: 0.8, z: 0.3 };
    drift += Math.hypot(w.x, w.z) * 4 * dt; shade();
    // grass fires on the bluffs: lit by the bombardment, burning from the first shells to the end of the morning
    if (!WW.game || WW.game.state !== 'battle' || !WW.fx || !WW.fx.smoke) return;
    if (!sites) sites = smokeSites();
    smokeT -= dt;
    if (smokeT <= 0 && WW.game.roundTime > 20) {
      smokeT = SMOKE_EVERY;
      const s = sites[Math.floor(Math.random() * sites.length)];
      WW.fx.smoke(s.x + (Math.random() - 0.5) * 18, s.y + 1 + Math.random() * 2, s.z + (Math.random() - 0.5) * 10, true, 3 + Math.random() * 3);
    }
  }
  WW.on('roundStart', () => { sites = null; });
  WW.normandySky = { update };
})(window.WW);
