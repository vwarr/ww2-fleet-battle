// rocket_barrage.js - WW.rocketBarrage: the LCT(R) rocket barrage at H-5 off Omaha (visual only; Math.random; the round
// clock drives it, so it pauses with the game). Nine LCT(R)s of Force O, each an LCT with its tank deck covered by a
// thousand 5-inch rocket tubes in racks laid back at 45 degrees, ran in with the first wave and fired ripple salvos from
// ~3,000 yd at about 06:25: some 9,000 rockets in a minute, a roar and a wall of smoke over the craft. Fired blind at a
// fixed range from rolling boats, most fell short in the surf among the obstacles and the boats, and few reached the
// bluffs (the strongpoints were untouched: the men of the first wave saw it and took heart, then landed under intact
// guns). Here: SHIPS craft on station from the start, each firing SHOWN rockets (a sample of its 1,000) over RIPPLE s;
// each rocket arcs with a smoke trail and comes down as a splash in the sea or a burst of sand or earth (WW.fx.dirt,
// and a crater: 'landImpact') ashore.
// History: first it read only from the beach (the glare a fixed streak, the trails and the ripple's smoke borrowed from
// the shared fx pools, which 1,350 rockets overran in a second). Now it reads from the ships and the director's wide
// shots too:
//  - the motor's glare: an HDR streak (bloom) that grows with the camera's distance, so a rocket stays a bright dash
//    of a few pixels from 1,000 u off
//  - its own smoke (a ring of PUFFS soft billboards): every rocket lays an unbroken trail along its arc, a chain of
//    stretches laid by distance flown (not by frame, so slow motion and a slow GPU draw the same trail), that swell,
//    fade and drift off on the wind over ~20-30 s; never thinner than MIN_PX on screen, so the trails read as a
//    lattice of grey arcs from far off
//  - the wall of smoke over each LCT(R) as its racks fire: big off-white puffs boiling up off the deck, a cloud that
//    hangs over the craft for most of a minute and drifts down-wind; a flicker of launch flashes in it
//  - the carpet of splashes in the surf: a column of white spray (two puffs, bigger with the camera's distance) hanging
//    over every rocket that falls in the sea for some seconds (the shared splash pool only for the close-up spray)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const XS = [1395, 1480, 1560, 1640, 1720, 1800, 1880, 1960, 2060], OFF = 290, SHOWN = 150, RIPPLE = 9, FLIGHT = 2.6, ARC = 26;
  const SHORT = [-24, 3];                      // where they came down: u off the H-hour waterline, mostly short (in the surf)
  const PUFFS = 24000, TRAIL_DU = 0.07, MIN_PX = 1.8, GLARE = [2.6, 1.75, 0.8];   // GLARE: HDR colour, over the bloom threshold
  let root = null, hull = null, rk = null, pts = null, ships = [], rockets = [], fired = false, built = false, lastRt = 0;
  const on = () => !WW.simOnly && WW.isScn('normandy') && !!WW.scene && !!WW.normandyTerrain && !!WW.scenarios.normandy.clock;

  // ---- the smoke: a ring of PUFFS soft billboards, each a segment A-B (a round puff when A = B: the wall, the spray; a
  // stretch of trail when not: a trail is a chain of them, so it is unbroken however far apart its puffs are laid),
  // width growing s0 -> s1 u, alpha a0 fading, shade 0 (dark) - 1 (light), drifting on the wind; aged on the round clock
  const F32 = () => new Float32Array(PUFFS);
  const S = { ax: F32(), ay: F32(), az: F32(), bx: F32(), by: F32(), bz: F32(), vx: F32(), vy: F32(), vz: F32(), age: F32(), life: F32(), s0: F32(), s1: F32(), a0: F32(), head: 0, live: 0 };
  const PV = `
    attribute vec2 corner; attribute vec3 iA; attribute vec3 iB; attribute vec3 iP;   // iP: width, alpha, shade
    uniform float uScale, uMinPx;
    varying float vAlpha; varying float vShade; varying vec2 vC; varying float vL;
    #include <fog_pars_vertex>
    void main() {
      vec4 a = viewMatrix * vec4(iA, 1.0), b = viewMatrix * vec4(iB, 1.0);
      vec3 d = b.xyz - a.xyz; float len = length(d);
      vec3 dir = len > 1e-4 ? d / len : vec3(1.0, 0.0, 0.0);
      vec2 sd = length(dir.xy) > 1e-3 ? normalize(vec2(-dir.y, dir.x)) : vec2(0.0, 1.0);
      vec3 c = mix(a.xyz, b.xyz, corner.x);
      float w = max(iP.x, uMinPx * max(0.1, -c.z) / uScale);           // never thinner than uMinPx on screen
      vAlpha = iP.y * min(1.0, sqrt(iP.x / w) * 0.8 + 0.2) * smoothstep(0.0, 1.0, -c.z / 6.0);   // held thin: fainter; at the lens: gone
      vec4 mvPosition = vec4(c + dir * (corner.x * 2.0 - 1.0) * w * 0.5 + vec3(sd, 0.0) * corner.y * w * 0.5, 1.0);
      vShade = iP.z; vC = corner; vL = len / w + 1.0;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`;
  const PF = `
    uniform vec3 cLight, cDark;
    varying float vAlpha; varying float vShade; varying vec2 vC; varying float vL;
    #include <fog_pars_fragment>
    void main() {
      float e = min(vC.x, 1.0 - vC.x) * vL;                              // widths from the nearer end
      float r = length(vec2(max(0.0, 0.5 - e) * 2.0, vC.y));             // round caps, a soft tube between
      if (r > 1.0) discard;
      float a = vAlpha * pow(1.0 - r, 1.7) * 1.6;                       // a soft gaussian-ish edge, no disc
      vec3 col = mix(cDark, cLight, vShade) * (1.0 + 0.1 * vC.y);
      gl_FragColor = vec4(col, a);
      #include <fog_fragment>
    }`;
  function buildSmoke() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0], 3));
    g.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 0, 1, 1, 1], 2));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    for (const k of ['iA', 'iB', 'iP']) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = PUFFS;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(1700, 0, 900), 3000);
    const m = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uMinPx: { value: MIN_PX },
      cLight: { value: new THREE.Color(0xd2cfc8) }, cDark: { value: new THREE.Color(0x77736c) } }]), vertexShader: PV, fragmentShader: PF, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
    pts = new THREE.Mesh(g, m); pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'rocketSmoke';
    return pts;
  }
  // a puff from (x, y, z) to (x2, y2, z2) (a trail's stretch; a round puff without them), drifting (vx, vy, vz),
  // growing s0 -> s1 u wide over life s, alpha a, shade 0 (dark) - 1 (light); returns its slot (a trail's open end)
  function puff(x, y, z, vx, vy, vz, life, s0, s1, a, shade, x2, y2, z2) {
    const i = S.head; S.head = (i + 1) % PUFFS;
    S.ax[i] = x; S.ay[i] = y; S.az[i] = z; S.bx[i] = x2 === undefined ? x : x2; S.by[i] = x2 === undefined ? y : y2; S.bz[i] = x2 === undefined ? z : z2;
    S.vx[i] = vx; S.vy[i] = vy; S.vz[i] = vz; S.age[i] = 0; S.life[i] = life; S.s0[i] = s0; S.s1[i] = s1; S.a0[i] = a;
    pts.geometry.attributes.iP.array[i * 3 + 2] = shade;
    S.live = Math.min(PUFFS, S.live + 1);
    return i;
  }
  function clearSmoke() {
    S.life.fill(0); S.live = 0; S.head = 0;
    if (pts) { const a = pts.geometry.attributes.iP; for (let i = 0; i < PUFFS; i++) a.array[i * 3] = a.array[i * 3 + 1] = 0; a.needsUpdate = true; }
  }
  function smokeUpdate(dts) {
    const g = pts.geometry, A = g.attributes.iA.array, B = g.attributes.iB.array, P = g.attributes.iP.array;
    const wx = (WW.wind ? WW.wind.x : 0.5) * 0.35, wz = (WW.wind ? WW.wind.z : 0.1) * 0.35, k = 1 - Math.exp(-dts * 0.6);   // the puff's own push dies away; the wind carries it on
    let live = 0;
    for (let i = 0; i < PUFFS; i++) {
      if (S.life[i] <= 0) continue;
      const a = (S.age[i] += dts), t = a / S.life[i], j = i * 3;
      if (t >= 1) { S.life[i] = 0; P[j] = P[j + 1] = 0; continue; }
      live++;
      S.vx[i] += (wx - S.vx[i]) * k; S.vz[i] += (wz - S.vz[i]) * k; S.vy[i] *= 1 - k * 0.5;
      const dx = S.vx[i] * dts, dy = S.vy[i] * dts, dz = S.vz[i] * dts;
      A[j] = S.ax[i] += dx; A[j + 1] = S.ay[i] += dy; A[j + 2] = S.az[i] += dz;
      B[j] = S.bx[i] += dx; B[j + 1] = S.by[i] += dy; B[j + 2] = S.bz[i] += dz;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      P[j] = S.s0[i] + (S.s1[i] - S.s0[i]) * e;
      P[j + 1] = S.a0[i] * Math.min(1, a * 6) * (1 - t) * (1 - t * 0.5);
    }
    S.live = live;
    g.attributes.iA.needsUpdate = g.attributes.iB.needsUpdate = g.attributes.iP.needsUpdate = true;
    // the width scale: drawing-buffer pixels per u at 1 u depth; the colours follow the overcast (the fog)
    const U = pts.material.uniforms, cam = WW.camera, h = WW.renderer ? WW.renderer.domElement.height : 720;
    U.uScale.value = h / (2 * Math.tan((cam ? cam.fov : 38) * Math.PI / 360));
    const fog = WW.scene.fog;
    if (fog) { const l = Math.min(1.25, Math.max(0.45, (fog.color.r + fog.color.g + fog.color.b) / 2.1)); U.cLight.value.setRGB(0.82 * l, 0.81 * l, 0.78 * l); U.cDark.value.setRGB(0.47 * l, 0.45 * l, 0.42 * l); }
  }

  function build() {
    root = new THREE.Group(); root.name = 'rocketBarrage';
    const K = WW.soldierModel, { box, cyl } = K.prims(), P = (g, c, s, p, r) => K.part(g, c, s, p, r), grad = WW.models._grad ? WW.models._grad() : null;
    const L = 3.6, B = 1.0, x0 = -L / 2, parts = [];
    parts.push(P(box, 0x2a2f33, [L - 0.1, 0.12, B - 0.02], [-0.05, -0.05, 0]));
    for (const s of [1, -1]) parts.push(P(box, 0x5f6b74, [L - 0.12, 0.27, 0.05], [-0.06, 0.135, s * (B / 2 - 0.025)]));
    parts.push(P(box, 0x5f6b74, [0.12, 0.34, B - 0.06], [L / 2 - 0.12, 0.17, 0]));                     // the bow, closed (no ramp in use)
    parts.push(P(box, 0x5f6b74, [0.88, 0.42, B - 0.06], [x0 + 0.46, 0.21, 0]));                         // deckhouse, wheelhouse, mast
    parts.push(P(box, 0x727e86, [0.32, 0.2, 0.42], [x0 + 0.38, 0.52, 0]));
    parts.push(P(box, 0x34373a, [0.025, 0.75, 0.025], [x0 + 0.26, 0.92, 0]));
    // the racks: rows of tubes laid back at 45 degrees, pointing over the bow
    for (let r = 0; r < 7; r++) {
      const x = x0 + 1.15 + r * 0.33;
      parts.push(P(box, 0x4c555c, [0.3, 0.05, B - 0.16], [x, 0.36, 0], [0, 0, 0.78]));
      for (let k = -4; k <= 4; k++) parts.push(P(cyl, 0x34373a, [0.035, 0.32, 0.035], [x + 0.02, 0.38, k * 0.095], [0, 0, -0.78]));
    }
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad });
    hull = new THREE.InstancedMesh(K.merge(parts), mat, XS.length); hull.castShadow = true; hull.frustumCulled = false;
    const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }); gm.color.setRGB(GLARE[0], GLARE[1], GLARE[2]);
    rk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.05, 2.2, 6).rotateZ(Math.PI / 2).translate(-0.9, 0, 0), gm, XS.length * SHOWN);   // the motor's glare, bigger than the rocket
    rk.frustumCulled = false; rk.count = 0; rk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(hull, rk, buildSmoke()); WW.scene.add(root);
    built = true;
  }
  function station() {
    const T = WW.normandyTerrain;
    ships = XS.map(x => ({ x, z: T.shoreZ(x) - OFF - (Math.random() - 0.5) * 6, h: Math.PI / 2 + (Math.random() - 0.5) * 0.1, st: null }));
    rockets = []; fired = false;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Vector3();
  function fire(t0) {   // each ship's sample of rockets: launch times over the ripple, targets mostly short of the beach
    const T = WW.normandyTerrain;
    for (const s of ships) for (let i = 0; i < SHOWN; i++) {
      const tx = s.x + (Math.random() - 0.5) * 70, sh = SHORT[0] + Math.pow(Math.random(), 0.7) * (SHORT[1] - SHORT[0]) + (Math.random() < 0.08 ? 10 + Math.random() * 20 : 0);
      rockets.push({ sx: s.x + (Math.random() - 0.5) * 1.2, sz: s.z + 0.4, tx, tz: T.shoreZ(tx) + sh, t0: t0 + (i / SHOWN) * RIPPLE + Math.random() * 0.2, ship: s, done: false, ut: 0, seg: -1, jx: 0, jy: 0 });
    }
    fired = true;
  }
  // a point of a rocket's arc at u (0-1 of its flight)
  const arcY = u => 0.6 + ARC * 4 * u * (1 - u);
  function update(rdt) {
    if (!on()) { if (root) root.visible = false; return; }
    if (!built) build();
    if (!ships.length) station();
    root.visible = true;
    const rt = WW.game ? WW.game.roundTime : 0, C = WW.scenarios.normandy.clock, tFire = C.at(6 * 60 + 25), cam = WW.camera.position;
    const dts = Math.max(0, Math.min(0.5, rt - lastRt)); lastRt = rt;
    // the craft: on station, riding the sea; they turn away and head out a while after firing
    hull.count = ships.length;
    ships.forEach((s, i) => {
      const gone = rt - tFire - RIPPLE - 40;
      if (gone > 0) s.z -= Math.min(0.1, rdt || 0) * 1.2;
      const y = WW.waves ? WW.waves.height(s.x, s.z) : 0, sl = WW.waves ? WW.waves.slope(s.x, s.z, 1.5) : { x: 0, z: 0 };
      _e.set(-Math.atan(sl.x) * 0.6, -s.h, Math.atan(sl.z) * 0.6, 'YXZ'); _q.setFromEuler(_e);
      hull.setMatrixAt(i, _m.compose(_p.set(s.x, y, s.z), _q, _s.set(1, 1, 1)));
    });
    hull.instanceMatrix.needsUpdate = true;
    if (rt >= tFire && !fired && rt < tFire + RIPPLE + FLIGHT + 5) fire(tFire);
    if (rt < tFire - 1 && (rockets.length || S.live)) { rockets = []; fired = false; clearSmoke(); }
    // the rockets in flight: an arc with a trail; at the end a splash or a burst
    let n = 0;
    for (const r of rockets) {
      if (r.done) continue;
      const u = (rt - r.t0) / FLIGHT;
      if (u < 0) continue;
      if (r.u0 === undefined) {   // the launch: a flash on the racks, the smoke boiling up off the deck (the wall over the craft)
        r.u0 = u;
        if (WW.fx && Math.random() < 0.3) WW.fx.muzzleFlash(r.sx, 0.6, r.sz);
        for (let k = 0; k < 2; k++) if (Math.random() < 0.6) puff(r.sx + (Math.random() - 0.5) * 3.4, 0.7 + Math.random() * 1.4, r.sz + (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.9, (Math.random() - 0.5) * 0.5 + 0.2,
          30 + Math.random() * 25, 1.0 + Math.random(), 3.5 + Math.random() * 4.5, 0.32, 0.45 + Math.random() * 0.55);   // the cloud boils up in lumps
      }
      // the trail: a stretch laid every TRAIL_DU of the flight flown, from the last one's end; the open stretch's far
      // end rides with the rocket
      const ue = Math.min(1, u), dx = r.tx - r.sx, dz = r.tz - r.sz;
      while (r.seg < 0 || r.ut + TRAIL_DU <= ue || (ue >= 1 && r.ut < 1)) {
        const v0 = r.ut, v1 = Math.min(1, r.ut + TRAIL_DU), j = r.seg;
        if (j >= 0 && S.life[j] > 0) { S.bx[j] = r.sx + dx * v0; S.by[j] = arcY(v0); S.bz[j] = r.sz + dz * v0; }   // close the open stretch where it was
        const j1 = (Math.random() - 0.5) * 0.5, j2 = (Math.random() - 0.5) * 0.5;   // the motor's smoke wavers off the true arc
        r.seg = puff(r.sx + dx * v0 + r.jx, arcY(v0) + r.jy, r.sz + dz * v0, (Math.random() - 0.5) * 0.12, 0.04, (Math.random() - 0.5) * 0.12,
          24 + Math.random() * 16, 0.3 + Math.random() * 0.12, 2.0 + Math.random() * 1.4, 0.3, 0.3 + Math.random() * 0.45, r.sx + dx * v1 + j1, arcY(v1) + j2, r.sz + dz * v1);
        r.jx = j1; r.jy = j2;
        r.ut = v1;
      }
      if (r.seg >= 0 && u < 1 && S.age[r.seg] < 0.5) { const j = r.seg; S.bx[j] = r.sx + dx * ue; S.by[j] = arcY(ue); S.bz[j] = r.sz + dz * ue; }
      if (u >= 1) {
        r.done = true;
        const wet = WW.tide ? WW.tide.depth(r.tx, r.tz) > 0 : WW.terrain.heightRaw(r.tx, r.tz) < 0, far = Math.min(2.4, Math.max(1, _c.set(r.tx, 0, r.tz).distanceTo(cam) / 110));
        if (wet) {   // the carpet of splashes in the surf: bigger with the distance, white spray hanging over it
          if (WW.fx) WW.fx.splash(r.tx, r.tz, 0.9);
          puff(r.tx, 0.5 + Math.random() * 0.4, r.tz, 0, 0.2, 0, 6 + Math.random() * 4, 0.9 * far, 2.8 * far, 0.62, 1);   // the column of spray,
          puff(r.tx, 1.6 + Math.random() * 0.8, r.tz, 0, 0.35, 0, 4 + Math.random() * 3, 0.6 * far, 2.0 * far, 0.45, 1);  // hanging, then drifting off
        } else {
          const g = Math.max(0, WW.terrain.heightRaw(r.tx, r.tz));
          if (WW.fx && WW.fx.dirt) WW.fx.dirt(r.tx, g, r.tz, 0.6 * Math.sqrt(far), r.tz < WW.normandyTerrain.shingleZ(r.tx) + 1.5); else if (WW.fx) WW.fx.explosion(r.tx, g + 0.2, r.tz, 0.55);
          WW.emit('landImpact', { nation: 'USN', x: r.tx, z: r.tz, kind: 'rocket', cal: 'small' });
        }
        continue;
      }
      const x = r.sx + dx * u, z = r.sz + dz * u, y = arcY(u), vy = ARC * 4 * (1 - 2 * u) / FLIGHT, vh = Math.hypot(dx, dz) / FLIGHT;
      // the glare grows with the distance: about the same few pixels on screen from the beach, the ships or 1,000 u up
      const k = Math.min(12, Math.max(1, _c.set(x, y, z).distanceTo(cam) / 70));
      _e.set(0, -Math.atan2(dz, dx), Math.atan2(vy, vh), 'YXZ'); _q.setFromEuler(_e);
      if (n < rk.instanceMatrix.count) rk.setMatrixAt(n++, _m.compose(_p.set(x, y, z), _q, _s.set(Math.pow(k, 0.3), k, k)));
    }
    rk.count = n; WW.instUsed(rk);
    pts.visible = S.live > 0;
    if (S.live > 0) smokeUpdate(dts);
  }
  WW.on('roundStart', () => { ships = []; rockets = []; fired = false; lastRt = 0; clearSmoke(); });
  WW.rocketBarrage = { update, get ships() { return ships; }, get rockets() { return rockets; }, get smoke() { return S.live; } };
})(window.WW);
