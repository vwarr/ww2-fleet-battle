// easter_b29_fx.js - WW.easterFx: the pieces of the B-29 easter egg (easter_b29.js runs it). Everything here is built
// on the trigger and never before, so a round without the egg pays nothing (visual only: Math.random, never WW.rand).
//  - the B-29 Superfortress: a silver land-plane type ('b29') added to models_landplanes.js TYPES (WW.models.LAND_PLANES)
//    and built with its lofting kit: natural metal, the long slender wing, four big nacelles, the rounded glazed nose,
//    the tall fin and its fillet; the "Little Boy" bomb (a lathed body and its box tail), drawn larger than true so it
//    reads on screen as the planes do;
//  - contrails: instanced puffs from the four engines (a ring buffer), growing and thinning behind the plane;
//  - the detonation at (gz, BURST_Y): the white-hot fireball, the condensation dome riding the shock front, the shock
//    ring racing out over the water, the mushroom (instanced toon puffs: a rolling cap, the stem, the base surge),
//    the screen flash and the sky tint (CSS overlays over the canvas: the dome and fog belong to sky_time.js), and the
//    sound (a deep boom and a long rolling rumble, a patch on WW.audio).
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random, PI = Math.PI;
  function rr(a, b) { return a + (b - a) * R(); }
  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  var BURST_Y = 60;
  // ---------- the B-29 (models_landplanes.js TYPES format; body [x, half width, half height, centre y] tail -> nose) ----------
  var SILVER = { top: 0xc9ced3, belly: 0xb9bec4, nac: 0xb2b8be, cowl: 0x7e858c, glass: 0x8fb4cc, sky: 0xb8d4e6, frame: 0x9aa1a8, blade: 0x3a3d42, tip: 0xe8c450, gun: 0x2a2c30, hole: 0x23261f };
  var B29 = { name: 'B-29 Superfortress', P: SILVER, nat: 'USN',
    body: [[-3.36, 0.05, 0.06, 0.15], [-3.22, 0.12, 0.14, 0.13], [-2.85, 0.2, 0.22, 0.09], [-2.1, 0.29, 0.31, 0.03], [-1.1, 0.32, 0.33, 0], [1.4, 0.32, 0.33, 0],
      [2.35, 0.31, 0.32, 0], [2.8, 0.27, 0.28, -0.01], [3.08, 0.2, 0.21, -0.02], [3.26, 0.1, 0.1, -0.02], [3.33, 0.02, 0.02, -0.02]],
    glassN: 2.55, frames: [2.72, 2.9, 3.05, 3.18], glassT: -3.24, cab: { x0: 1.98, x1: 2.24, w: 0.07, h: 0.08, frames: 0 },  // cab: the astrodome
    turret: [1.7, 0.12], ball: [-0.5, 0.12], sides: [-1.6, 0.14, 0.1, 0.06], tailGuns: [0.2, true],
    fillet: [[-1.7, 0], [-2.0, 0.05], [-2.25, 0.15], [-2.45, 0.3], [-2.6, 0.42]],
    wing: { qc: 0.45, y: -0.02, root: 1.2, tip: 0.42, semi: 4.4, z0: 0.3, dih: 0.06, sweep: 0.12, tip_: 'round', t: 0.15 },
    tail: { qc: -2.85, y: 0.1, root: 0.85, tip: 0.36, semi: 1.62, sweep: 0.18, tip_: 'round', t: 0.12 },
    fin: { qc: -2.62, y: 0.2, root: 1.55, tip: 0.5, semi: 1.55, sweep: 0.36, tip_: 'round', t: 0.12 },
    eng: [0.62, 1.55], engR: 0.2, nac: [0.5, 1.0, -0.03], prop: 0.5, markX: -2.2 };
  var ENG = [0.92, 1.85];          // engine span stations from the centre line (wing z0 + eng)
  var mats = null, parts = null;   // shared materials / the scene objects (built once, on the first trigger)
  function toonRamp() {
    var t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 190, 190, 190, 255, 236, 236, 236, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  }
  function buildPlane() {
    var M = WW.models;
    if (M.LAND_PLANES && !M.LAND_PLANES.b29) M.LAND_PLANES.b29 = B29;
    var m = M.buildPlane('b29', 'USN');
    m.group.rotation.order = 'YZX'; m.group.scale.setScalar(WW.cfg.PLANE_SCALE || 0.82);
    if (m.disc) { m.disc.visible = true; m.blades.visible = false; }   // props turning: the blur discs
    m.group.traverse(function (o) { o.castShadow = false; });
    return m;
  }
  // Little Boy: a dark olive-drab body (nose +x) and its box tail; 1.9 u long (true 3 m = 0.31 u)
  function buildBomb() {
    var g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0x5a6150 });
    var prof = [[0, -0.62], [0.17, -0.6], [0.21, -0.45], [0.21, 0.35], [0.2, 0.5], [0.16, 0.62], [0.09, 0.71], [0, 0.74]];
    var body = new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 18);
    body.rotateZ(-PI / 2); g.add(new THREE.Mesh(body, mat));
    var box = function (sx, sy, sz, x, y, z) { var b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); b.position.set(x, y, z); g.add(b); };
    [-1, 1].forEach(function (k) { box(0.42, 0.02, 0.5, -0.88, k * 0.24, 0); box(0.42, 0.5, 0.02, -0.88, 0, k * 0.24); }); // the box
    box(0.4, 0.02, 0.48, -0.86, 0, 0); box(0.4, 0.48, 0.02, -0.86, 0, 0);                                                // the cross fins
    box(0.3, 0.05, 0.05, -0.68, 0, 0);
    g.scale.setScalar(1.25);
    return g;
  }
  function inst(geo, mat, n) {
    var m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.count = n; m.castShadow = m.receiveShadow = false;
    var z = new THREE.Matrix4().makeScale(0, 0, 0); for (var i = 0; i < n; i++) m.setMatrixAt(i, z);
    return m;
  }
  function overlay(css, front) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;' + css + (front ? 'z-index:1000;' : '');
    var g = document.getElementById('game');
    if (!front && g && g.parentNode) g.parentNode.insertBefore(d, g.nextSibling); else document.body.appendChild(d);
    return d;
  }
  // ---------- the cloud's puffs (directions and sizes drawn once; placed each frame from the cloud's state) ----------
  var NCAP = 150, NSTEM = 46, NSURGE = 64, NTRAIL = 560;
  function build() {
    if (parts) return parts;
    var ramp = toonRamp(), puff = new THREE.IcosahedronGeometry(1, 2);
    mats = {
      hot: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, emissive: new THREE.Color(0xff7a30), emissiveIntensity: 1 }),
      surge: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, emissive: new THREE.Color(0x8a8078), emissiveIntensity: 0.25 }),
      trail: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, emissive: new THREE.Color(0xb8c0cc), emissiveIntensity: 0.2 }),
      fire: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
      dome: new THREE.MeshBasicMaterial({ color: 0xf4f2ee, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      ring: new THREE.MeshBasicMaterial({ color: 0xf2f4f4, transparent: true, opacity: 0, depthWrite: false }),
      spray: new THREE.MeshBasicMaterial({ color: 0xd8dcdc, transparent: true, opacity: 0, depthWrite: false })
    };
    var root = new THREE.Group(); root.visible = false;
    var cloud = inst(puff, mats.hot, NCAP + NSTEM), surge = inst(puff, mats.surge, NSURGE), trail = inst(new THREE.IcosahedronGeometry(1, 1), mats.trail, NTRAIL);
    var col = new THREE.Color(), P = [];
    for (var i = 0; i < NCAP + NSTEM; i++) {
      var cap = i < NCAP, top = cap && i < 46;
      var p = { cap: cap, top: top, a: R() * 2 * PI, ph: R() * 2 * PI, u: R(), s: rr(0.75, 1.15), j: rr(-1, 1) };
      col.setHex(top ? 0xf2e8de : cap ? (R() < 0.5 ? 0xc4906c : 0xd6aa88) : (R() < 0.5 ? 0xc89c80 : 0xb88a70)); cloud.setColorAt(i, col);
      P.push(p);
    }
    var S = [];
    for (var k = 0; k < NSURGE; k++) { S.push({ a: k / NSURGE * 2 * PI + rr(-0.05, 0.05), r: rr(0.82, 1.04), s: rr(0.8, 1.25) }); col.setHex(R() < 0.5 ? 0xe2ddd6 : 0xcfc8c0); surge.setColorAt(k, col); }
    var fire = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mats.fire);
    var dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 14, 0, 2 * PI, 0, PI / 2), mats.dome);
    var rg = new THREE.RingGeometry(0.94, 1, 180, 1); rg.rotateX(-PI / 2);
    var sg = new THREE.RingGeometry(0.78, 0.94, 180, 1); sg.rotateX(-PI / 2);
    var ring = new THREE.Mesh(rg, mats.ring), spray = new THREE.Mesh(sg, mats.spray);
    ring.renderOrder = spray.renderOrder = 3; dome.renderOrder = 4;
    [cloud, surge, fire, dome, ring, spray].forEach(function (o) { o.frustumCulled = false; o.castShadow = false; root.add(o); });
    var plane = buildPlane(), bomb = buildBomb();
    plane.group.visible = bomb.visible = false;
    WW.scene.add(root); WW.scene.add(trail); WW.scene.add(plane.group); WW.scene.add(bomb);
    trail.visible = false;
    parts = { root: root, cloud: cloud, surge: surge, trail: trail, fire: fire, dome: dome, ring: ring, spray: spray, plane: plane, bomb: bomb, P: P, S: S,
      tr: [], trHead: 0, trT: 0, flash: null, tint: null, dust: null };
    for (var q = 0; q < NTRAIL; q++) parts.tr.push({ x: 0, y: 0, z: 0, t: -1e9 });
    return parts;
  }

  // ---------- per frame ----------
  var _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3();
  function put(mesh, i, x, y, z, s) { _v.set(x, y, z); _s.set(s, s * 0.86, s); _m.compose(_v, _q.identity(), _s); mesh.setMatrixAt(i, _m); }
  // contrails: four puffs a few metres behind the engines, every 0.05 s while the plane flies high
  function contrails(now, on, dt) {
    var pp = parts, g = pp.plane.group, tr = pp.tr;
    pp.trT -= dt;
    if (on && pp.trT <= 0) {
      pp.trT = 0.03; g.updateMatrixWorld(true);
      for (var k = 0; k < 4; k++) {
        _e.set(-1.2, -0.05, (k < 2 ? -1 : 1) * ENG[k % 2]).applyMatrix4(g.matrixWorld);
        var c = tr[pp.trHead]; pp.trHead = (pp.trHead + 1) % NTRAIL;
        c.x = _e.x; c.y = _e.y; c.z = _e.z; c.t = now;
      }
    }
    for (var i = 0; i < NTRAIL; i++) {
      var a = now - tr[i].t, s = a > 14 ? 0 : Math.min(0.75, 0.16 + 0.14 * a) * (a > 9 ? 1 - (a - 9) / 5 : 1);
      put(pp.trail, i, tr[i].x, tr[i].y + a * 0.12, tr[i].z, Math.max(0, s));
    }
    pp.trail.instanceMatrix.needsUpdate = true;
  }
  // the cloud's state at tau s after the burst: cap centre height, cap radius, stem radius, surge radius
  function state(tau) {
    var yc = BURST_Y + 470 * (1 - Math.exp(-tau / 7.5)), Rc = 22 + 200 * (1 - Math.exp(-tau / 6.5));
    return { yc: yc, Rc: Rc, rs: 9 + 34 * (1 - Math.exp(-tau / 5)), rk: 24 + 360 * (1 - Math.exp(-tau / 3.6)) };
  }
  function cloud(tau, gz, wind) {
    var pp = parts, st = state(tau), yc = st.yc, Rc = st.Rc, R0 = Rc * 0.6, r0 = Rc * 0.4, grow = sstep(0.9, 2.6, tau);
    var lean = Math.min(1, tau / 30), wx = wind.x * lean, wz = wind.z * lean;   // the top drifts downwind
    for (var i = 0; i < pp.P.length; i++) {
      var p = pp.P[i], x, y, z, s;
      if (p.top) {          // the dome of the cap
        var rho = R0 * 0.85 * Math.sqrt(p.u);
        x = Math.cos(p.a) * rho; z = Math.sin(p.a) * rho; y = yc + r0 * (0.55 + 0.35 * (1 - p.u)) + p.j * r0 * 0.1; s = r0 * 0.62 * p.s;
      } else if (p.cap) {   // the rolling torus: up through the middle, out over the top, down the outside
        var ph = p.ph - tau * 0.22, rr0 = R0 + r0 * Math.cos(ph) * 0.9;
        x = Math.cos(p.a) * rr0; z = Math.sin(p.a) * rr0; y = yc + r0 * 0.75 * Math.sin(ph); s = r0 * 0.6 * p.s;
      } else {              // the stem: from the sea up into the cap, flaring at the top
        var top = Math.max(0, yc - r0 * 0.6), u = p.u, fl = u > 0.75 ? (u - 0.75) / 0.25 : 0;
        var rho2 = st.rs * (0.55 + 0.25 * u) + fl * fl * R0 * 0.5;
        x = Math.cos(p.a) * rho2 * 0.6; z = Math.sin(p.a) * rho2 * 0.6; y = u * top; s = (st.rs * 0.9 + fl * r0 * 0.3) * p.s;
        s *= sstep(1.2, 4, tau);
      }
      var k = y / Math.max(1, yc);
      put(pp.cloud, i, gz.x + x + wx * k, y, gz.z + z + wz * k, s * grow);
    }
    pp.cloud.instanceMatrix.needsUpdate = true;
    mats.hot.emissiveIntensity = 0.12 + 1.6 * Math.exp(-tau / 3.2);
    // the base surge: a low ring of spray and steam running out from under the burst, then settling
    var fade = tau > 10 ? Math.exp(-(tau - 10) / 7) : 1;
    for (var j = 0; j < NSURGE; j++) {
      var q = pp.S[j], rs = st.rk * q.r, ss = 22 * q.s * sstep(0.2, 1.6, tau) * fade;
      put(pp.surge, j, gz.x + Math.cos(q.a) * rs, ss * 0.35, gz.z + Math.sin(q.a) * rs, ss);
    }
    pp.surge.instanceMatrix.needsUpdate = true;
    // the fireball: white-hot, swelling and rising into the cap, then dimming to a dull red core
    var fb = 52 * (1 - Math.exp(-tau * 4)) * (tau < 2.5 ? 1 : Math.exp(-(tau - 2.5) / 2.2));
    pp.fire.visible = fb > 0.5;
    pp.fire.position.set(gz.x, Math.min(yc, BURST_Y + 18 * tau), gz.z); pp.fire.scale.setScalar(Math.max(0.01, fb));
    var h = Math.min(1, tau / 2.2);
    mats.fire.color.setRGB(3.2 - 1.4 * h, 3.0 - 2.0 * h, 2.8 - 2.6 * h);
    return st;
  }
  function shock(ringR, tau, gz) {
    var pp = parts, fall = Math.max(0, 1 - ringR / 3000);
    pp.ring.position.set(gz.x, 0.35, gz.z); pp.ring.scale.setScalar(Math.max(1, ringR));
    pp.spray.position.set(gz.x, 0.3, gz.z); pp.spray.scale.setScalar(Math.max(1, ringR));
    mats.ring.opacity = 0.9 * fall; mats.spray.opacity = 0.35 * fall;
    pp.dome.position.set(gz.x, 0, gz.z); pp.dome.scale.setScalar(Math.max(1, ringR));
    mats.dome.opacity = 0.32 * Math.max(0, 1 - tau / 2.4) * sstep(0, 0.15, tau);
  }
  function overlays(tau) {
    var pp = parts;
    if (!pp.flash) {
      pp.flash = overlay('background:#fff;', true);
      pp.tint = overlay('background:linear-gradient(to bottom,#ff8a3a 0%,#ffb070 55%,#ffd6b0 100%);mix-blend-mode:multiply;');
      pp.dust = overlay('background:linear-gradient(to bottom,#9c8a78 0%,#b8a690 60%,#cfc2b2 100%);mix-blend-mode:multiply;');
    }
    var f = tau < 0 ? 0 : tau < 0.08 ? tau / 0.08 : tau < 0.45 ? 1 : Math.max(0, 1 - (tau - 0.45) / 2.6);
    pp.flash.style.opacity = f.toFixed(3);
    pp.flash.style.background = tau < 0.9 ? '#fff' : '#fff4d8';
    pp.tint.style.opacity = (0.75 * sstep(0.3, 2.2, tau) * (1 - 0.7 * sstep(9, 18, tau))).toFixed(3);   // orange, then the dust
    pp.dust.style.opacity = (0.55 * sstep(7, 16, tau)).toFixed(3);
  }
  function sound() {
    var A = WW.audio, S = A && A.syn;
    if (!A || !S) return;
    if (!A._atomic) {
      A._atomic = true;
      A.register('easter.atomic', { ref: 1e4, max: 1, reverb: 0.6, duck: 0.95, dur: 16,
        build: function (ctx, out, p) {
          var r = p.rate || 1, t = p.t;
          return S.done(p, [
            S.boom(ctx, out, t, { f0: 42, f1: 15, dur: 4.5, gain: 0.8, body: 1.2, crack: 0.35, bright: 0.5, rate: r }),
            S.boom(ctx, out, t + 0.4 / r, { f0: 34, f1: 13, dur: 5, gain: 0.45, body: 1, crack: 0.1, bright: 0.35, rate: r }),
            S.burst(ctx, out, t + 0.25 / r, { noise: 'brown', type: 'lowpass', f: 240, f1: 40, q: 0.5, a: 0.8, d: 11, gain: 0.55, rate: r }),
            S.crackle(ctx, out, t + 0.15 / r, { dur: 3.5, f: 800, q: 0.6, gain: 0.3, density: 1, rate: r })
          ]);
        } });
    }
    try { A.duck(1, 1.4); A.play('easter.atomic', { ui: true, delay: 1.1 }); } catch (e) { /* sound is optional */ }
  }

  WW.easterFx = {
    BURST_Y: BURST_Y, state: state,
    // build (first time) and show the plane; o: { gz }
    start: function () { var pp = build(); pp.plane.group.visible = true; pp.trail.visible = true; pp.trHead = 0; pp.tr.forEach(function (c) { c.t = -1e9; }); return pp; },
    plane: function () { return parts && parts.plane; },
    bomb: function () { return parts && parts.bomb; },
    detonate: function () { parts.root.visible = true; parts.bomb.visible = false; sound(); },
    // per frame: now (s, the egg's clock), trail on, tau (s after the burst, < 0 before), ringR, gz, wind
    update: function (dt, now, trailOn, tau, ringR, gz, wind) {
      if (!parts) return null;
      contrails(now, trailOn, dt);
      if (tau < 0) return null;
      overlays(tau); shock(ringR, tau, gz);
      return cloud(tau, gz, wind);
    },
    stop: function () {
      if (!parts) return;
      parts.root.visible = parts.trail.visible = parts.plane.group.visible = parts.bomb.visible = false;
      ['flash', 'tint', 'dust'].forEach(function (k) { if (parts[k]) { parts[k].remove(); parts[k] = null; } });
    }
  };
})();
