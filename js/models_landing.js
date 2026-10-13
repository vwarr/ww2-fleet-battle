// models_landing.js - WW.landingFx: the landing craft on screen (visual only; Math.random). Hand-merged, vertex-coloured
// models (models_soldier.js part / merge) in the toon style, one InstancedMesh per craft type and part, re-posed each
// frame from WW.landingCraft.craft (main.js frame) and from the boats still on their way in (WW.normandyFleet.boats(),
// normandy_fleet.js: in the davits, circling at the rendezvous, running in to the line of departure):
//   LCVP    the Higgins boat: plywood sides, the steel bow ramp, the engine deck aft with the coxswain's armoured
//           cockpit and the two .30-cal guns in their tubs; the assault section packed in the well, helmets over the
//           gunwale (30 men: a boat team, six rows of five on the day, here three files)
//   LCA     the British armoured boat (the Rangers at Pointe du Hoc): low, side decks over the well, the coxswain's
//           shelter forward; a file standing in the open centre, the side files crouched under the armour
//   LCM     the bigger steel ramp boat (the engineers' gap assault teams with their explosives)
//   LCT     the open tank deck with its Shermans (or dozers), the aft deckhouse, wheelhouse and mast, two 20 mm tubs
//   LCI(L)  a small ship: the round conning tower, the deckhouse, 20 mm tubs, the two gangway ramps run out at the bow;
//           the troops crowded on the forward deck, and going down the ramps when they are out
//   DD      a Sherman swimming in its raised canvas screen, the commander's head over the top (models_tank.js)
// Every boat rides the sea (waves.js height and slope: heave, pitch and roll, small boats thrown about more, with
// inertia), slams into the seas and throws spray over the bow; the ramp drops over ~1 s. Wrecks: a craft wrecked in the
// shallows stays there, listing and burning, for the round (Omaha's beach was strewn with them); one sunk in deep water
// goes down in ~25 s; a foundered DD in seconds.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const COL = { hull: 0x5f6b74, hullL: 0x727e86, boot: 0x2a2f33, deck: 0x464d52, ply: 0x66727a, steel: 0x535c63, wood: 0x8a7556, metal: 0x34373a,
    armour: 0x58626a, rn: 0x84919a, rnD: 0x69757d, glass: 0x34465a, crate: 0x7a6a48 };
  const MAN_S = 0.78, MAXB = { lcvp: 260, lca: 60, lcm: 60, lct: 80, lci: 40 }, MAX_MEN = 5000, MAX_TANK = 260, MAX_DD = 64, MAX_WRECK = 90;
  const DEEP_SINK_T = 25, DD_SINK_T = 6, SPRAY_DP = 0.3;
  let root = null, T = null, DEF = null, men = null, tank = null, dd = null, built = false;
  const vis = new WeakMap();
  let wrecks = [];
  // ---- geometry ----
  function taperGeo() {   // a unit box (x -0.5..0.5) narrowing over its forward 30% to a 12% stem, the forefoot lifted
    const g = new THREE.BoxGeometry(1, 1, 1, 10, 1, 1).toNonIndexed(), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), t = Math.max(0, Math.min(1, (x - 0.2) / 0.3)), k = t * t;
      p.setZ(i, p.getZ(i) * (1 - 0.88 * k));
      if (p.getY(i) < 0) p.setY(i, p.getY(i) + 0.55 * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function defs() {
    const K = WW.soldierModel, { box, cyl } = K.prims(), tp = taperGeo(), CR = WW.landingCraft.CRAFT;
    const P = (geo, col, s, c, r) => K.part(geo, col, s, c, r);
    const D = {};
    // the small ramp boats share a pattern: a hull, sides, a well, a ramp hinged at the bow
    function rampBoat(C, o) {
      const L = C.len, B = C.beam, x0 = -L / 2, xh = L / 2 - 0.1, yt = o.yt, side = o.side, b = [], ramp = [], slots = [], crew = [];
      b.push(P(box, COL.boot, [L - 0.1, 0.12, B - 0.02], [-0.05, -0.05, 0]));
      for (const s of [1, -1]) {
        b.push(P(box, side, [L - 0.1, yt + 0.01, 0.03], [-0.05, yt / 2, s * (B / 2 - 0.015)]));
        b.push(P(box, COL.hullL, [L - 0.12, 0.02, 0.05], [-0.05, yt, s * (B / 2 - 0.02)]));
        b.push(P(box, COL.wood, [L - 0.2, 0.022, 0.012], [-0.05, yt * 0.4, s * (B / 2 + 0.002)]));
        b.push(P(box, COL.steel, [0.08, yt, 0.03], [xh - 0.02, yt / 2, s * (B / 2 - 0.015)]));           // the ramp's cheeks
      }
      b.push(P(box, COL.deck, [xh - x0 - o.aft, 0.02, B - 0.06], [(xh + x0 + o.aft) / 2, 0.02, 0]));      // the well's floor
      b.push(P(box, side, [0.03, yt, B], [x0 + 0.035, yt / 2, 0]));                                      // transom
      b.push(P(box, COL.hull, [o.aft - 0.04, 0.05, B - 0.05], [x0 + o.aft / 2, yt * 0.72, 0]));          // engine deck
      b.push(P(box, COL.hull, [0.02, yt * 0.75, B - 0.06], [x0 + o.aft, yt * 0.38, 0]));                 // the well's after bulkhead
      // the ramp, in its own frame: hinged at the bow, standing up along +y when raised
      const rh = o.rh, rw = B * 0.86;
      ramp.push(P(box, COL.steel, [0.025, rh, rw], [0, rh / 2, 0]));
      for (let k = -1; k <= 1; k++) ramp.push(P(box, COL.metal, [0.012, rh * 0.92, 0.014], [0.018, rh / 2, k * rw * 0.3]));
      ramp.push(P(box, COL.steel, [0.04, 0.02, rw], [0.005, rh, 0]));
      // the men: files across the well, rows from the after bulkhead to the ramp; listed aft first (the bow empties first)
      const xs = x0 + o.aft + 0.07, xe = xh - 0.08;
      for (let x = xs; x <= xe + 1e-6; x += o.row) for (const z of o.files) slots.push({ x, y: 0.03, z: z.z, pose: z.pose || ((Math.round(x * 97) + Math.round(z.z * 31)) % 4 ? 'stand' : 'crouch') });
      return { b, ramp, slots, crew, x0, xh, yt, ramps: [{ h: [xh, 0.02, 0], up: [0, o.rake || 0], down: [0, -(Math.PI / 2 + 0.14)] }] };
    }
    {   // LCVP
      const C = CR.lcvp, R = rampBoat(C, { yt: 0.28, side: COL.ply, aft: 0.45, rh: 0.3, row: 0.095, files: [{ z: -0.12 }, { z: 0 }, { z: 0.12 }] });
      const x0 = R.x0;
      R.b.push(P(box, COL.armour, [0.1, 0.1, 0.12], [x0 + 0.3, 0.27, 0.1]));                           // the coxswain's cockpit (starboard)
      R.b.push(P(box, COL.glass, [0.012, 0.025, 0.09], [x0 + 0.352, 0.3, 0.1]));
      for (const s of [1, -1]) {
        R.b.push(P(cyl, COL.armour, [0.11, 0.07, 0.11], [x0 + 0.14, 0.255, s * 0.13]));                // the gun tubs
        R.b.push(P(box, COL.metal, [0.13, 0.012, 0.012], [x0 + 0.22, 0.31, s * 0.13], [0, 0, 0.12]));   // .30-cal
      }
      R.crew.push({ x: x0 + 0.24, y: 0.2, z: 0.1, pose: 'stand' }, { x: x0 + 0.06, y: 0.2, z: 0.13, pose: 'stand' }, { x: x0 + 0.06, y: 0.2, z: -0.13, pose: 'stand' });
      D.lcvp = R;
    }
    {   // LCA (Royal Navy): armoured, low; side decks over the well; the coxswain's shelter forward to starboard
      const C = CR.lca, R = rampBoat(C, { yt: 0.24, side: COL.rn, aft: 0.38, rh: 0.25, row: 0.095, files: [{ z: -0.12, pose: 'crouch' }, { z: 0, pose: 'stand' }, { z: 0.12, pose: 'crouch' }] });
      for (const s of [1, -1]) R.b.push(P(box, COL.rnD, [C.len - 0.62, 0.02, 0.085], [0.04, 0.245, s * (C.beam / 2 - 0.05)]));
      R.b.push(P(box, COL.rnD, [0.16, 0.12, 0.11], [R.xh - 0.16, 0.3, 0.15]));
      R.b.push(P(box, COL.glass, [0.012, 0.02, 0.08], [R.xh - 0.078, 0.33, 0.15]));
      R.crew.push({ x: R.xh - 0.26, y: 0.03, z: 0.15, pose: 'stand' });
      D.lca = R;
    }
    {   // LCM(3): steel, a wheelhouse aft, demolition stores forward
      const C = CR.lcm, R = rampBoat(C, { yt: 0.3, side: COL.steel, aft: 0.5, rh: 0.32, row: 0.1, files: [{ z: -0.19 }, { z: -0.065 }, { z: 0.065 }, { z: 0.19 }] });
      const x0 = R.x0;
      R.b.push(P(box, COL.armour, [0.22, 0.16, 0.26], [x0 + 0.24, 0.33, 0]));
      R.b.push(P(box, COL.glass, [0.012, 0.03, 0.2], [x0 + 0.352, 0.37, 0]));
      for (const s of [1, -1]) R.b.push(P(box, COL.metal, [0.13, 0.012, 0.012], [x0 + 0.38, 0.43, s * 0.1], [0, 0, 0.12]));
      for (let k = 0; k < 5; k++) R.b.push(P(box, COL.crate, [0.09, 0.07, 0.11], [R.xh - 0.1 - (k % 2) * 0.1, 0.07 + (k > 2 ? 0.07 : 0), -0.2 + k * 0.1]));
      R.crew.push({ x: x0 + 0.1, y: 0.22, z: 0, pose: 'stand' });
      D.lcm = R;
    }
    {   // LCT(5): the tank deck, the after deckhouse and wheelhouse
      const C = CR.lct, L = C.len, B = C.beam, x0 = -L / 2, xh = L / 2 - 0.18, b = [], ramp = [];
      b.push(P(box, COL.boot, [L - 0.1, 0.12, B - 0.02], [-0.05, -0.05, 0]));
      for (const s of [1, -1]) {
        b.push(P(box, COL.hull, [L - 0.12, 0.27, 0.05], [-0.06, 0.135, s * (B / 2 - 0.025)]));
        b.push(P(box, COL.hullL, [L - 0.14, 0.02, 0.07], [-0.06, 0.27, s * (B / 2 - 0.03)]));
        b.push(P(box, COL.steel, [0.14, 0.32, 0.05], [xh - 0.02, 0.16, s * (B / 2 - 0.025)]));
      }
      b.push(P(box, COL.deck, [xh - x0 - 0.9, 0.02, B - 0.1], [(xh + x0 + 0.9) / 2, 0.02, 0]));
      b.push(P(box, COL.hull, [0.88, 0.42, B - 0.06], [x0 + 0.46, 0.21, 0]));                            // deckhouse
      b.push(P(box, COL.hullL, [0.32, 0.2, 0.42], [x0 + 0.38, 0.52, 0]));                                // wheelhouse
      b.push(P(box, COL.glass, [0.012, 0.05, 0.34], [x0 + 0.542, 0.55, 0]));
      b.push(P(box, COL.metal, [0.025, 0.75, 0.025], [x0 + 0.26, 0.92, 0]));                             // mast and yard
      b.push(P(box, COL.metal, [0.02, 0.02, 0.42], [x0 + 0.26, 1.18, 0]));
      for (const s of [1, -1]) {
        b.push(P(cyl, COL.armour, [0.15, 0.08, 0.15], [x0 + 0.8, 0.46, s * 0.3]));                       // 20 mm tubs
        b.push(P(box, COL.metal, [0.2, 0.014, 0.014], [x0 + 0.9, 0.53, s * 0.3], [0, 0, 0.35]));
      }
      const rh = 0.55, rw = B * 0.84;
      ramp.push(P(box, COL.steel, [0.03, rh, rw], [0, rh / 2, 0]));
      for (let k = -2; k <= 2; k++) ramp.push(P(box, COL.metal, [0.014, rh * 0.94, 0.016], [0.02, rh / 2, k * rw * 0.2]));
      const slots = [], crew = [{ x: x0 + 0.55, y: 0.42, z: 0.28, pose: 'stand' }, { x: x0 + 0.7, y: 0.42, z: -0.3, pose: 'stand' }, { x: x0 + 0.25, y: 0.62, z: 0.12, pose: 'stand' }];
      for (const x of [x0 + 1.1, x0 + 1.9, x0 + 2.7]) for (const z of [0.38, -0.38]) slots.push({ x, y: 0.03, z, pose: 'crouch' });
      D.lct = { b, ramp, slots, crew, x0, xh, tanks: [x0 + 1.35, x0 + 2.2, x0 + 3.05], ramps: [{ h: [xh, 0.02, 0], up: [0, -0.22], down: [0, -(Math.PI / 2 + 0.1)] }] };
    }
    {   // LCI(L): the small ship
      const C = CR.lci, L = C.len, B = C.beam, b = [], ramp = [];
      b.push(P(tp, COL.hull, [L, 0.58, B], [0, 0.11, 0]));
      b.push(P(tp, COL.boot, [L + 0.02, 0.16, B + 0.01], [0, -0.1, 0]));
      b.push(P(tp, COL.deck, [L - 0.1, 0.02, B - 0.06], [-0.02, 0.405, 0]));
      b.push(P(cyl, COL.hull, [0.42, 0.44, 0.42], [-0.55, 0.62, 0]));                                    // the round conning tower
      b.push(P(cyl, COL.hullL, [0.47, 0.04, 0.47], [-0.55, 0.85, 0]));
      b.push(P(box, COL.glass, [0.02, 0.05, 0.2], [-0.34, 0.76, 0]));
      b.push(P(box, COL.hullL, [1.5, 0.28, 0.62], [-1.42, 0.54, 0]));                                    // deckhouse
      b.push(P(box, COL.hull, [0.42, 0.16, 0.4], [-1.95, 0.76, 0]));
      b.push(P(box, COL.metal, [0.03, 1.0, 0.03], [-0.85, 1.3, 0]));
      b.push(P(box, COL.metal, [0.02, 0.02, 0.5], [-0.85, 1.65, 0]));
      for (const [x, y, z] of [[1.45, 0.45, 0], [-0.55, 0.87, 0], [-1.0, 0.68, 0.2], [-2.1, 0.84, 0]]) {   // 20 mm tubs
        b.push(P(cyl, COL.armour, [0.16, 0.09, 0.16], [x, y + 0.045, z]));
        b.push(P(box, COL.metal, [0.2, 0.014, 0.014], [x + 0.1, y + 0.12, z], [0, 0, 0.3]));
      }
      for (const x of [0.25, 0.85]) b.push(P(box, COL.hullL, [0.18, 0.06, 0.24], [x, 0.43, 0]));       // troop hatches
      b.push(P(box, COL.metal, [0.12, 0.08, 0.2], [-2.42, 0.45, 0]));                                    // stern anchor winch
      // the gangways (one geometry, two ramps): hinged on the bow's sides, running forward along +x
      ramp.push(P(box, COL.wood, [1.4, 0.025, 0.13], [0.7, 0, 0]));
      for (const s of [1, -1]) ramp.push(P(box, COL.metal, [1.4, 0.014, 0.01], [0.7, 0.08, s * 0.065]));
      for (let k = 0; k < 4; k++) for (const s of [1, -1]) ramp.push(P(box, COL.metal, [0.01, 0.08, 0.01], [0.15 + k * 0.38, 0.04, s * 0.065]));
      const slots = [], crew = [{ x: -0.5, y: 0.87, z: 0.1, pose: 'stand' }, { x: 1.38, y: 0.42, z: 0, pose: 'stand' }, { x: -1.2, y: 0.68, z: -0.18, pose: 'stand' }];
      for (let x = -0.15; x <= 1.95; x += 0.13) for (const z of x < 1.3 ? [-0.25, -0.085, 0.085, 0.25] : [-0.085, 0.085]) slots.push({ x, y: 0.41, z, pose: (Math.round(x * 50) + Math.round(z * 40)) % 5 ? 'stand' : 'crouch' });
      D.lci = { b, ramp, slots, crew, x0: -L / 2, xh: L / 2, ramps: [{ h: [0.95, 0.42, 0.33], up: [-0.06, 0.1], down: [-0.55, -0.42], side: 1 }, { h: [0.95, 0.42, -0.33], up: [0.06, 0.1], down: [0.55, -0.42], side: -1 }] };
    }
    for (const k in D) { D[k].bodyGeo = K.merge(D[k].b); D[k].rampGeo = K.merge(D[k].ramp); }
    return D;
  }
  function init() {
    root = new THREE.Group(); root.name = 'landingCraft';
    const grad = WW.models._grad ? WW.models._grad() : null;
    // two materials: three keeps one program per material, and the instance-coloured meshes (the hulls: burnt
    // wrecks) need the instancing-colour variant, the men and tanks not
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad }), matI = mat.clone();
    const mk = (g, n, tinted) => { const im = new THREE.InstancedMesh(g, tinted ? matI : mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    DEF = defs();
    T = {};
    for (const k in DEF) {
      T[k] = { body: mk(DEF[k].bodyGeo, MAXB[k], true), ramp: mk(DEF[k].rampGeo, MAXB[k] * DEF[k].ramps.length) };
      T[k].body.setColorAt(0, new THREE.Color(1, 1, 1));   // instance colours: burnt wrecks
    }
    const G = WW.soldierModel.build(), TK = WW.tankModel.build();
    men = {}; for (const p of ['stand', 'crouch', 'runA', 'runB']) men[p] = mk(G[p], MAX_MEN);
    tank = mk(TK.sherman, MAX_TANK); dd = mk(TK.dd, MAX_DD, true); dd.setColorAt(0, new THREE.Color(1, 1, 1));
    WW.scene.add(root);
    built = true;
  }
  // ---- posing ----
  const _M = new THREE.Matrix4(), _R = new THREE.Matrix4(), _L = new THREE.Matrix4(), _W = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
  const _rY = new THREE.Matrix4(), _rZ = new THREE.Matrix4(), _sM = new THREE.Matrix4().makeScale(MAN_S, MAN_S, MAN_S);
  let n = null, wreckCol = new THREE.Color(0.42, 0.4, 0.38), white = new THREE.Color(1, 1, 1);
  function craftMatrix(x, y, z, h, pitch, roll) { _e.set(roll, -h, pitch, 'YXZ'); _q.setFromEuler(_e); return _M.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)); }
  function local(x, y, z, yaw, pitch) { _L.makeTranslation(x, y, z); if (yaw) _L.multiply(_rY.makeRotationY(yaw)); if (pitch) _L.multiply(_rZ.makeRotationZ(pitch)); return _L; }
  function man(pose, M, x, y, z, yaw) {
    const im = men[pose]; if (im.count >= MAX_MEN) return;
    _W.multiplyMatrices(M, local(x, y, z, yaw || 0, 0)).multiply(_sM);
    im.setMatrixAt(im.count++, _W);
  }
  // the sea under a boat: heave, pitch and roll toward the surface's, with the hull's inertia (small boats quicker and
  // thrown about more); spray when the bow slams down
  function ride(u, dt, now) {
    let st = vis.get(u);
    const C = u.C, small = C.len < 2, W = WW.waves, h = u.heading, c = Math.cos(h), s = Math.sin(h);
    if (!st) { st = { y: W ? W.height(u.x, u.z) : 0, p: 0, r: 0, pp: 0, ra: u.rampDown ? 1 : 0, sprayT: 0, rollPh: Math.random() * 6.28 }; vis.set(u, st); }
    st.ra += ((u.rampDown ? 1 : 0) - st.ra) * Math.min(1, dt * 2.2);
    if (u.pose) { st.y = u.pose.y; st.p = u.pose.pitch || 0; st.r = u.pose.roll || 0; st.pp = st.p; return st; }
    const hw = W && W.active ? W.height(u.x, u.z) : 0, sl = W && W.active ? W.slope(u.x, u.z, Math.max(0.35, C.len * 0.45)) : { x: 0, z: 0 };
    const along = sl.x * c + sl.z * s, across = -sl.x * s + sl.z * c, K = small ? 1.2 : 0.75, run = u.state === 'run' || u.state === 'off';
    const pt = WW.clamp(Math.atan(along) * K + (run && u.type !== 'dd' ? 0.035 : 0), -0.5, 0.5);
    const rt = WW.clamp(-Math.atan(across) * K + (small ? 0.03 * Math.sin(now * 1.7 + st.rollPh) : 0), -0.45, 0.45);
    const k = Math.min(1, dt * (small ? 6 : 3));
    st.pp = st.p; st.p += (pt - st.p) * k; st.r += (rt - st.r) * k;
    st.y += (hw - st.y) * Math.min(1, dt * (small ? 9 : 5));
    const g = WW.terrain.heightRaw(u.x, u.z);
    if (u.type !== 'dd' && st.y < g + 0.09) st.y = g + 0.09;                         // aground: the hull sits on the sand
    if (run && dt > 0 && (st.p - st.pp) / dt < -SPRAY_DP && now - st.sprayT > 0.35 && WW.fx && WW.fx.spray) {
      st.sprayT = now;
      const bx = u.x + c * C.len * 0.48, bz = u.z + s * C.len * 0.48;
      WW.fx.spray(bx, st.y + 0.15, bz, h, small ? 0.35 : 0.6);
    }
    return st;
  }
  function draw(u, st, wreck) {
    const D = DEF[u.type], P = T[u.type];
    if (!D || P.body.count >= MAXB[u.type]) return;
    const M = craftMatrix(u.x, st.y, u.z, u.heading, st.p, st.r);
    const i = P.body.count++;
    P.body.setMatrixAt(i, M); P.body.setColorAt(i, wreck ? wreckCol : white);
    const ra = st.ra;
    for (const r of D.ramps) {
      const yaw = r.up[0] + (r.down[0] - r.up[0]) * ra, pitch = r.up[1] + (r.down[1] - r.up[1]) * ra;
      _W.multiplyMatrices(M, local(r.h[0], r.h[1], r.h[2], yaw, pitch));
      P.ramp.setMatrixAt(P.ramp.count++, _W);
      // the LCI's troops going down the gangways
      if (u.type === 'lci' && ra > 0.8 && u.men > 0 && !wreck) {
        _R.copy(_W);
        for (let k = 0; k < 3; k++) { const im = men[((performance.now() / 140 | 0) + k) & 1 ? 'runA' : 'runB']; if (im.count < MAX_MEN) im.setMatrixAt(im.count++, _W.multiplyMatrices(_R, local(0.3 + k * 0.38, 0.01, 0, 0, 0)).multiply(_sM)); }
      }
    }
    if (wreck) return;
    // the men: as many as are aboard (the slots listed aft first: the bow empties first), the crew always
    const f = Math.min(1, D.slots.length / Math.max(1, u.C.men || 1)), shown = u.men > 0 ? Math.min(D.slots.length, Math.ceil(u.men * f)) : 0;
    for (let k = 0; k < shown; k++) { const m = D.slots[k]; man(m.pose, M, m.x, m.y, m.z, m.yaw); }
    for (const m of D.crew) man(m.pose, M, m.x, m.y, m.z, 0);
    if (D.tanks) for (let k = 0; k < Math.min(u.tanks || 0, D.tanks.length) && tank.count < MAX_TANK; k++) {
      _W.multiplyMatrices(M, local(D.tanks[k], 0.03, 0, 0, 0)); tank.setMatrixAt(tank.count++, _W);
    }
  }
  function drawDD(u, st, sink) {
    if (u.state === 'run' || sink !== undefined) {
      if (dd.count >= MAX_DD) return;
      const y = st.y - (WW.tankModel.SCREEN_TOP - 0.27) - (sink || 0);   // ~0.27 u of screen over the sea, the turret top just awash
      const M = craftMatrix(u.x, y, u.z, u.heading, st.p * 0.6, st.r * 0.6);
      dd.setColorAt(dd.count, sink !== undefined ? wreckCol : white); dd.setMatrixAt(dd.count++, M);
      if (sink === undefined) man('stand', M, -0.3, 0.3, 0, 0);          // the commander, steering from the rear deck
    } else if (tank.count < MAX_TANK) {                                 // out of the water, the screen down
      const g = Math.max(WW.terrain.heightRaw(u.x, u.z), st.y - 0.25);
      tank.setMatrixAt(tank.count++, craftMatrix(u.x, g, u.z, u.heading, 0, 0));
    }
  }
  function update(rdt) {
    if (WW.simOnly || !WW.landingCraft || !WW.isScn('normandy') || !WW.scene) { if (root) root.visible = false; return; }
    if (!built) init();
    root.visible = true;
    const dt = Math.min(0.1, rdt || 0.016), now = performance.now() / 1000, rt = WW.game ? WW.game.roundTime : 0;
    for (const k in T) { T[k].body.count = 0; T[k].ramp.count = 0; }
    for (const p in men) men[p].count = 0;
    tank.count = 0; dd.count = 0;
    const L = WW.landingCraft.craft;
    for (const u of L) {
      if (u.removed || !u.alive) continue;
      const st = ride(u, dt, now);
      if (u.type === 'dd') { drawDD(u, st); continue; }
      draw(u, st, false);
      if (u.state === 'run' && Math.random() < dt * 6 && WW.fx && WW.fx.wake) WW.fx.wake(u.x - Math.cos(u.heading) * u.C.len * 0.5, u.z - Math.sin(u.heading) * u.C.len * 0.5, u.heading, u.C.len < 2 ? 0.2 : 0.35);
    }
    // the boats still on their way in (normandy_fleet.js)
    const F = WW.normandyFleet && WW.normandyFleet.boats ? WW.normandyFleet.boats() : null;
    if (F) for (const u of F) {
      if (!u || !DEF[u.type]) continue;
      const st = ride(u, dt, now);
      draw(u, st, false);
      if (!u.pose && Math.random() < dt * 4 && WW.fx && WW.fx.wake) WW.fx.wake(u.x - Math.cos(u.heading) * u.C.len * 0.5, u.z - Math.sin(u.heading) * u.C.len * 0.5, u.heading, 0.2);
    }
    // the wrecks
    for (let i = wrecks.length - 1; i >= 0; i--) {
      const w = wrecks[i], age = rt - w.t0;
      if (age < 0 || (!w.stranded && age > (w.type === 'dd' ? DD_SINK_T : DEEP_SINK_T))) { wrecks.splice(i, 1); continue; }
      const st = vis.get(w) || ride(w, dt, now);
      if (w.type === 'dd') { drawDD(w, st, age * 0.12); continue; }
      if (w.stranded) { const g = WW.terrain.heightRaw(w.x, w.z); st.y = Math.max(g + 0.02, Math.min(st.y, (WW.waves ? WW.waves.height(w.x, w.z) : 0) - 0.12)); st.p = 0.06; st.r = w.list; }
      else { ride(w, dt, now); }
      const sk = w.stranded ? st : { y: st.y - Math.min(0.9, age * 0.04), p: Math.min(0.3, age * 0.02), r: Math.min(0.6, age * 0.05) * Math.sign(w.list), ra: st.ra };
      draw(w, sk, true);
      if (age < (w.stranded ? 90 : 14) && Math.random() < dt * 1.5 && WW.fx && WW.fx.smoke) WW.fx.smoke(w.x, st.y + 0.4, w.z, true, w.C.len < 2 ? 0.5 : 0.9);
    }
    for (const k in T) { for (const im of [T[k].body, T[k].ramp]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } }
    for (const p in men) men[p].instanceMatrix.needsUpdate = true;
    tank.instanceMatrix.needsUpdate = true; dd.instanceMatrix.needsUpdate = true; if (dd.instanceColor) dd.instanceColor.needsUpdate = true;
  }
  WW.on('craftEvent', e => {
    if (WW.simOnly || !WW.isScn('normandy')) return;
    const u = e.craft;
    if (e.kind === 'wrecked' || e.kind === 'mined' || e.kind === 'foundered') {
      const d = WW.terrain.depthAt ? WW.terrain.depthAt(u.x, u.z) : 9;
      const w = { type: u.type, C: u.C, x: u.x, z: u.z, heading: u.heading, men: 0, tanks: 0, state: 'wrecked', rampDown: u.type !== 'dd' && Math.random() < 0.4, t0: WW.game ? WW.game.roundTime : 0,
        stranded: u.type !== 'dd' && d < u.C.draft + 0.7, list: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.25) };
      const old = vis.get(u); if (old) vis.set(w, Object.assign({}, old));
      wrecks.push(w); if (wrecks.length > MAX_WRECK) wrecks.splice(wrecks.findIndex(x => !x.stranded) >= 0 ? wrecks.findIndex(x => !x.stranded) : 0, 1);
    }
    if (!WW.fx) return;
    if ((e.kind === 'mined' || e.kind === 'wrecked') && WW.fx.explosion) WW.fx.explosion(u.x, 0.6, u.z, e.kind === 'mined' ? 1.6 : 1.1);
    if (e.kind === 'mined' && WW.fx.splash) WW.fx.splash(u.x, u.z, 2.2);
  });
  WW.on('roundStart', () => { wrecks = []; });
  WW.landingFx = { update, get wrecks() { return wrecks; } };
})(window.WW);
