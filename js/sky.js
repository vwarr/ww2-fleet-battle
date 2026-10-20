// sky.js (integrator): sky dome, lights, fog. Soft "toy box" daylight.
window.WW = window.WW || {};
(function (WW) {
  // Golden hour: a low warm sun in the west-north-west, peach horizon near the sun, lavender-blue
  // elsewhere, a gentle blue zenith. Palettes are pastel (about 20% desaturated).
  const SUN_DIR = new THREE.Vector3(-0.86, 0.36, 0.36).normalize();   // ~21 degrees above the horizon
  const C = h => WW.pastel ? WW.pastel(h, 0.1) : new THREE.Color(h);
  const HORIZON = 0xc4dcf2, ZENITH = 0x3f7fd6, SUN_SIDE = 0xffc89a, AWAY = 0xb4d2f2, SUN_GLOW = 0xffe0b0, FOG = 0xc4dcf2;
  let dome = null, sun = null, hemi = null, clouds = null;
  const qv = k => { const m = typeof location !== 'undefined' && new RegExp('[?&]' + k + '=([\\w.,-]+)').exec(location.search); return m ? m[1] : null; };

  // The sun's received shadow follows N.L (hullshadow). A face the sun only grazes (a hull side, the flank of a rounded
  // turret or deckhouse) shadowed itself unevenly: across one shadow texel (0.12 u) its depth changes by more than the
  // bias, and the lofted hull's stations, each a little differently flared, came out in PCF-softened light / dark
  // vertical stripes, the rounded turrets in smudges; the pattern hung on the texel grid, so it differed on every load.
  // Raising normalBias (0.15, 0.3 tried) did not clear it. So a face's shadow term is also multiplied by
  // smoothstep(SNL[0], SNL[1], N.L) (the shading normal): faces turned away from the sun or edge-on to it are always
  // out of the sun, smoothly, whatever the map says. That is also what keeps it consistent: the toon ramp used to give a
  // face turned away ~0.7 of the sun unless a cast shadow happened to cover it (an away face could be lit next to a
  // shadowed one facing the sun: inverted blotches), now the sun reaches only faces that face it. Faces that do keep
  // every cast shadow (decks, turret tops, the island's lee). Every lit material that receives shadows shares the chunk
  // (ships, the land: Lambert, where the change is only the grazing band). ?snl=0: the old shadows, for A/B.
  const SNL = (qv('snl') || '-0.1,0.2').split(',').map(Number);
  if (SNL[0] || SNL[1]) {
    const ch = THREE.ShaderChunk, G = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
    const k = 'directLight.color *= ( directLight.visible && receiveShadow ) ? ' + G + ' : 1.0;';
    if (ch.lights_fragment_begin.indexOf(k) >= 0) ch.lights_fragment_begin = ch.lights_fragment_begin.replace(k, 'directLight.color *= ( directLight.visible && receiveShadow ) ? ' + G +
      ' * smoothstep( ' + SNL[0].toFixed(3) + ', ' + SNL[1].toFixed(3) + ', dot( geometry.normal, directLight.direction ) ) : 1.0;');
  }

  function init() {
    const scene = WW.scene;
    scene.background = C(HORIZON);
    scene.fog = new THREE.Fog(C(FOG), 650, 2300); // haze only far out, lavender-peach like the horizon
    // Soft light: a dominant cool-lavender sky fill so nothing goes dark, plus a modest peach-gold sun.
    hemi = new THREE.HemisphereLight(C(0xe6ecfa), C(0xc4b8d8), 0.72);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(C(0xffc890), 1.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    const sc = sun.shadow.camera; sc.near = 10; sc.far = 1600;
    setShadowSize(120);
    scene.add(sun); scene.add(sun.target);
    const mat = new THREE.ShaderMaterial({
      uniforms: { zenith: { value: C(ZENITH) }, sunSide: { value: C(SUN_SIDE) }, away: { value: C(AWAY) },
                  glow: { value: C(SUN_GLOW) }, sunDir: { value: SUN_DIR.clone() },   // the dome's sun sets at dusk (sky_time.js)
                  moonDir: { value: new THREE.Vector3(0.82, 0.26, -0.5).normalize() }, night: { value: 0 }, time: { value: 0 },
                  halo: { value: 0.55 }, disc: { value: 0.6 }, discCos: { value: 0.99975 }, spread: { value: 5 } },   // the sun's look (sky_time.js)
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 zenith; uniform vec3 sunSide; uniform vec3 away; uniform vec3 glow; uniform vec3 sunDir; uniform vec3 moonDir; uniform float night, time, halo, disc, discCos, spread; varying vec3 vDir;',
        'float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }',
        'void main(){',
        '  vec3 d = normalize(vDir);',
        '  float h = clamp(d.y, 0.0, 1.0);',
        '  vec2 az = normalize(d.xz + 1e-5), sa = normalize(sunDir.xz);',
        '  float toward = clamp(dot(az, sa) * 0.5 + 0.5, 0.0, 1.0);',       // 1 = looking at the sun (clamped: rounding takes it a hair below 0 dead away from the sun, and pow() of a negative is NaN: a NaN column of sky that the bloom smeared into a 10%-wide grey-white bar)
        '  vec3 horizon = mix(away, sunSide, pow(toward, spread));',            // spread: a wide warm arc at sunset
        '  vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.5, h), 0.6));',
        '  float s = max(dot(d, sunDir), 0.0);',
        '  c = mix(c, glow, min(1.0, pow(s, 10.0) * halo + pow(s, 300.0) * 0.6));',   // soft halo + soft sun disc
        '  c += glow * (smoothstep(discCos, discCos + 0.00012, s) * disc + pow(s, 140.0) * disc * 0.25);',   // a glowing disc (HDR: blooms)
        '  if (d.y < 0.0) c = horizon;',
        '  if (night > 0.01) {',                                              // stars and a moon (sky_time.js sets night)
        '    vec3 g = d * 170.0, f = fract(g) - 0.5; float hs = hash3(floor(g));',
        '    float st = step(0.986, hs) * smoothstep(0.4, 0.05, length(f)) * smoothstep(0.03, 0.3, d.y);',
        '    c += vec3(0.85, 0.9, 1.0) * st * night * (0.55 + 0.45 * sin(time * (1.5 + hs * 3.0) + hs * 90.0)) * (0.6 + (hs - 0.986) * 60.0);',
        '    float m = max(dot(d, moonDir), 0.0);',
        '    c += vec3(0.32, 0.4, 0.62) * (pow(m, 60.0) * 0.45 + pow(m, 8.0) * 0.12) * night;',   // halo
        '    c = mix(c, vec3(1.25, 1.22, 1.1), smoothstep(0.99935, 0.9996, m) * night);',      // disc
        '  }',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false // authored at display colour, like the fog
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
    dome.renderOrder = -10; dome.frustumCulled = false;
    scene.add(dome);
    buildClouds(scene);
  }
  // 4-step soft ramp for toon clouds (smooth enough to read as soft, still cartoony)
  function cloudRamp() {
    const d = new Uint8Array([150, 150, 150, 255, 196, 196, 196, 255, 232, 232, 232, 255, 255, 255, 255, 255]);
    const t = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }
  // Soft puffy low-poly clouds that drift slowly and cast soft shadows on the sea.
  function buildClouds(scene) {
    const geo = new THREE.SphereGeometry(1, 20, 14); // smooth soft blobs
    const mat = new THREE.MeshToonMaterial({ color: 0xeee8e2, emissive: C(0xb8c4e6), emissiveIntensity: 0.26, gradientMap: cloudRamp(), fog: false }); // soft toon: warm on the sun side, cool in shade
    clouds = new THREE.Group(); clouds.name = 'clouds';
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cx = WW.cfg.MAP_W / 2, cz = WW.cfg.MAP_H / 2;
    for (let i = 0; i < 34; i++) {
      const c = new THREE.Group(), n = 4 + Math.floor(r() * 4), s = 14 + r() * 16;
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, mat), k2 = (k / (n - 1)) - 0.5, rs = s * (0.55 + r() * 0.5) * (1 - Math.abs(k2) * 0.6);
        m.scale.set(rs, rs * 0.75, rs); m.position.set(k2 * s * 2.6, (r() - 0.3) * s * 0.4, (r() - 0.5) * s * 0.9);
        c.add(m); // no shadow casting: big soft cloud shadows read as dark blots at this scale
        m.updateMatrix(); m.matrixAutoUpdate = false;   // a puff never moves in its cloud: its matrix once (power3)
      }
      const a = r() * Math.PI * 2, d = i < 8 ? r() * 600 : 650 + r() * 1100; // a few over the map, most toward the horizon
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
  // (the light direction moves at dusk: sky_time.js lowers the sun, then swaps it for the moon; the basis follows)
  // The shadow's light direction is quantised (SH): sky_time.js turns SUN_DIR a little every frame (the sun crosses the
  // sky over a round, ~0.0004 deg a frame at 1x, faster at 2x / 4x), and a light that turns every frame re-rasterises
  // every shadow edge from a new angle and slides the texel grid under the scene (a point d u from the origin moves
  // d * dtheta in light space: a texel every ~30 frames at d ~500 at 1x), so shadow edges crawled and flickered.
  // SH only follows SUN_DIR once it is Q.deg off (every ~6 s at 1x): the grid holds still between steps, and a step
  // (well under a texel on most edges) is too small to see. The dome, the water's glitter etc. keep the continuous SUN_DIR.
  // The box's depth along the light (w) snaps to whole units too (a small measured gain): a continuous w re-quantises
  // every depth in the map each frame the camera's target moves.
  // WW.sky.shadowQ: { deg, w } (0 = the old continuous behaviour, for A/B).
  const UP = new THREE.Vector3(0, 1, 0), R = new THREE.Vector3(), U = new THREE.Vector3();
  const tgt = new THREE.Vector3(), SH = new THREE.Vector3(), Q = { deg: 0.15, w: 1 };
  function update(rdt) {
    const cam = WW.camera;
    if (!dome || !cam) return;
    dome.position.copy(cam.position);
    if (clouds) { // drift with the wind; wrap far downwind back upwind. Hidden in the overview (it looks down through them)
      clouds.visible = !(WW.cam && WW.cam.isOverview());
      const dt = Math.min(0.1, rdt || 0);
      for (const c of clouds.children) { c.position.x += 1.2 * dt; if (c.position.x > WW.cfg.MAP_W / 2 + 2000) c.position.x -= 4000; }
    }
    // the sun's shadow box follows what the camera looks at
    const wide = !WW.cam || WW.cam.isOverview();
    setShadowSize(wide ? 520 : 120);   // the overview covers the whole 960 x 600 map
    const fog = WW.scene && WW.scene.fog; // the overview sits ~1300 units up: push the haze out so the far side of the map reads
    if (fog) { fog.near = wide ? 1500 : 650; fog.far = wide ? 4200 : 2300; } // sky_time.js pulls it in under rain
    if (WW.cam && WW.cam.target) tgt.copy(WW.cam.target()); else tgt.set(WW.cfg.MAP_W / 2, 0, WW.cfg.MAP_H / 2);
    tgt.y = 0;
    if (WW.skyTime) WW.skyTime.update(rdt);   // time of day and weather: palette, light, fog (sky_time.js)
    if (SH.lengthSq() === 0 || SH.dot(SUN_DIR) < Math.cos(Q.deg * Math.PI / 180)) SH.copy(SUN_DIR);
    R.crossVectors(UP, SH).normalize(); U.crossVectors(SH, R).normalize();
    const texel = (2 * shadowSize) / sun.shadow.mapSize.x;
    const u = Math.round(tgt.dot(R) / texel) * texel, v = Math.round(tgt.dot(U) / texel) * texel, w0 = tgt.dot(SH), w = Q.w ? Math.round(w0 / Q.w) * Q.w : w0;
    tgt.copy(R).multiplyScalar(u).addScaledVector(U, v).addScaledVector(SH, w);
    sun.target.position.copy(tgt);
    sun.position.copy(tgt).addScaledVector(SH, 700);
  }
  WW.sky = { init, update, HORIZON, SUN_DIR, shadowQ: Q, sunColor: () => sun && sun.color, parts: () => ({ dome, sun, hemi, clouds }) };
})(window.WW);
