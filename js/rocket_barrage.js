// rocket_barrage.js - WW.rocketBarrage: the LCT(R) rocket barrage at H-5 off Omaha (visual only; Math.random; the round
// clock drives it, so it pauses with the game). Nine LCT(R)s of Force O, each an LCT with its tank deck covered by a
// thousand 5-inch rocket tubes in racks laid back at 45 degrees, ran in with the first wave and fired ripple salvos from
// ~3,000 yd at about 06:25: some 9,000 rockets in a minute, a roar and a wall of smoke over the craft. Fired blind at a
// fixed range from rolling boats, most fell short in the surf among the obstacles and the boats, and few reached the
// bluffs (the strongpoints were untouched: the men of the first wave saw it and took heart, then landed under intact
// guns). Here: SHIPS craft on station from the start, each firing SHOWN rockets (a sample of its 1,000) over RIPPLE s;
// each rocket arcs with a smoke trail (its motor's glare drawn as a streak, to read at a distance) and comes down as a
// splash in the sea or a burst (and a crater) on the sand.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const XS = [1395, 1480, 1560, 1640, 1720, 1800, 1880, 1960, 2060], OFF = 290, SHOWN = 150, RIPPLE = 9, FLIGHT = 2.6, ARC = 26;
  const SHORT = [-24, 3];                      // where they came down: u off the H-hour waterline, mostly short (in the surf)
  let root = null, hull = null, rk = null, ships = [], rockets = [], fired = false, built = false;
  const on = () => !WW.simOnly && WW.isScn('normandy') && !!WW.scene && !!WW.normandyTerrain && !!WW.scenarios.normandy.clock;
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
    rk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.05, 2.2, 6).rotateZ(Math.PI / 2).translate(-0.9, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffe2b0, fog: false }), XS.length * SHOWN);   // the motor's glare, bigger than the rocket
    rk.frustumCulled = false; rk.count = 0; rk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(hull, rk); WW.scene.add(root);
    built = true;
  }
  function station() {
    const T = WW.normandyTerrain;
    ships = XS.map(x => ({ x, z: T.shoreZ(x) - OFF - (Math.random() - 0.5) * 6, h: Math.PI / 2 + (Math.random() - 0.5) * 0.1, st: null }));
    rockets = []; fired = false;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  function fire(t0) {   // each ship's sample of rockets: launch times over the ripple, targets mostly short of the beach
    const T = WW.normandyTerrain;
    for (const s of ships) for (let i = 0; i < SHOWN; i++) {
      const tx = s.x + (Math.random() - 0.5) * 70, sh = SHORT[0] + Math.pow(Math.random(), 0.7) * (SHORT[1] - SHORT[0]) + (Math.random() < 0.08 ? 10 + Math.random() * 20 : 0);
      rockets.push({ sx: s.x + (Math.random() - 0.5) * 1.2, sz: s.z + 0.4, tx, tz: T.shoreZ(tx) + sh, t0: t0 + (i / SHOWN) * RIPPLE + Math.random() * 0.2, ship: s, done: false });
    }
    fired = true;
  }
  function update(rdt) {
    if (!on()) { if (root) root.visible = false; return; }
    if (!built) build();
    if (!ships.length) station();
    root.visible = true;
    const rt = WW.game ? WW.game.roundTime : 0, C = WW.scenarios.normandy.clock, tFire = C.at(6 * 60 + 25);
    // the craft: on station, riding the sea; they turn away and head out a while after firing
    hull.count = ships.length;
    ships.forEach((s, i) => {
      const gone = rt - tFire - RIPPLE - 40;
      if (gone > 0) s.z -= Math.min(0.1, rdt || 0) * 1.2;
      const y = WW.waves ? WW.waves.height(s.x, s.z) : 0, sl = WW.waves ? WW.waves.slope(s.x, s.z, 1.5) : { x: 0, z: 0 };
      _e.set(-Math.atan(sl.x) * 0.6, -s.h, Math.atan(sl.z) * 0.6, 'YXZ'); _q.setFromEuler(_e);
      hull.setMatrixAt(i, _m.compose(_p.set(s.x, y, s.z), _q, _s));
    });
    hull.instanceMatrix.needsUpdate = true;
    if (rt >= tFire && !fired && rt < tFire + RIPPLE + FLIGHT + 5) fire(tFire);
    if (rt < tFire - 1) { rockets = []; fired = false; }
    // the rockets in flight: an arc with a trail; at the end a splash or a burst
    let n = 0;
    for (const r of rockets) {
      if (r.done) continue;
      const u = (rt - r.t0) / FLIGHT;
      if (u < 0) continue;
      if (r.u0 === undefined) { r.u0 = u; if (WW.fx && Math.random() < 0.3) WW.fx.muzzleFlash(r.sx, 0.6, r.sz); if (WW.fx && Math.random() < 0.4) WW.fx.smoke(r.sx + (Math.random() - 0.5) * 2, 0.8 + Math.random(), r.sz + Math.random() * 2, false, 2.2 + Math.random() * 1.5); }   // the ripple's smoke over the craft
      if (u >= 1) {
        r.done = true;
        const wet = WW.tide ? WW.tide.depth(r.tx, r.tz) > 0 : WW.terrain.heightRaw(r.tx, r.tz) < 0;
        if (WW.fx) { if (wet) WW.fx.splash(r.tx, r.tz, 0.9); else { WW.fx.explosion(r.tx, Math.max(0, WW.terrain.heightRaw(r.tx, r.tz)) + 0.2, r.tz, 0.55); WW.emit('landImpact', { nation: 'USN', x: r.tx, z: r.tz, kind: 'rocket', cal: 'small' }); } }
        continue;
      }
      const x = r.sx + (r.tx - r.sx) * u, z = r.sz + (r.tz - r.sz) * u, y = 0.6 + ARC * 4 * u * (1 - u), vy = ARC * 4 * (1 - 2 * u) / FLIGHT, vh = Math.hypot(r.tx - r.sx, r.tz - r.sz) / FLIGHT;
      _e.set(0, -Math.atan2(r.tz - r.sz, r.tx - r.sx), Math.atan2(vy, vh), 'YXZ'); _q.setFromEuler(_e);
      if (n < rk.instanceMatrix.count) rk.setMatrixAt(n++, _m.compose(_p.set(x, y, z), _q, _s));
      if (WW.fx && WW.fx.trail && Math.random() < 0.8) WW.fx.trail(x, y, z, false, 0.55, 1.6);
    }
    rk.count = n; rk.instanceMatrix.needsUpdate = true;
  }
  WW.on('roundStart', () => { ships = []; rockets = []; fired = false; });
  WW.rocketBarrage = { update, get ships() { return ships; }, get rockets() { return rockets; } };
})(window.WW);
