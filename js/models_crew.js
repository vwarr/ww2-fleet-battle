// models_crew.js - WW.crew: tiny stylised sailors on every ship (visual only).
// All sailors of the scene are 4 InstancedMeshes (shirt+arms, trousers, head, cap) that share one
// instance-matrix buffer; per-instance colours give the uniforms (USN dungarees + white dixie cup,
// IJN whites + dark cap, coloured carrier deck jerseys). Stations are ship-local (bow +x); their deck
// heights come from vertical-line hits on a throwaway model of each type + nation (cached), so sailors
// stand on the real deck and are never inside superstructure. Each frame (real time) sailors idle,
// shuffle along a short deck lane, run toward fires / fresh hits, turn with PT / carrier gun mounts
// and abandon a sinking ship (run to the rail, jump, splash). Ships far from the camera are skipped.
// Math.random only (never WW.rand). Lifeboat figures (lifeboats.js) are drawn through addFigure().
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random, PI = Math.PI;
  var SCALE = 1.1;                       // figure height ~0.48 units (see report: readable at close shots)
  var MAX = 400, FAR = 115;              // instance capacity, LOD distance from the camera
  var COUNT = { carrier: 13, battleship: 10, cruiser: 7, destroyer: 5, pt: 3, submarine: 3 };
  // Per-class geometry: a ship's model key k (ship.mk, the class key; a type name means its first class). The
  // stations below were laid out on these reference hulls [L, B, top, bowLen, sternW, sheer] (the pre-class models);
  // each class maps them onto its own hull: x by length, z by beam (carriers: by flight-deck width, island side).
  var REF = { carrier: [26, 3.7, 1.0, 4.8, 0.85, 0.35], battleship: [24, 4.0, 1.0, 5.5, 0.72, 0.55], cruiser: [18, 2.8, 0.9, 4.2, 0.7, 0.45],
    destroyer: [12, 1.8, 0.7, 3.2, 0.7, 0.4], submarine: [10, 1.25, 0.4, 3.4, 0.25, 0.15], pt: [5, 1.4, 0.55, 1.7, 0.85, 0.2] };
  // Stations (priority order; invalid ones are dropped per nation, the first COUNT valid are used, the rest are spares
  // for rescued sailors): [x, z, deckY ('d' = main deck from the hull loft), face, role, turret index]
  // face: 'o' outboard, 'i' inboard, 'f' bow, 'a' stern, or radians. role: c crew, o officer, g gunner, y/b/r/n/w deck jerseys.
  function hp(k) { return WW.models.hull(k); }                              // the class's hull loft (models.js)
  function cl(k) { return WW.SHIP_CLASSES[k] || WW.models.classOf(k, 'USN'); }
  function tp(k) { var c = cl(k); return c ? c.type : k; }
  var ST = {
    battleship: [[10.2, 0.35, 'd', 'f', 'c'], [1.5, 1.75, 'd', 'o', 'c'], [-3.0, -1.78, 'd', 'o', 'c'], [2.4, 1.18, 1.8, 'o', 'o'],
      [-1.73, 1.62, 1.16, 'o', 'g'], [0.57, -1.62, 1.16, 'o', 'g'], [1.5, -1.75, 'd', 'o', 'c'], [-3.0, 1.78, 'd', 'o', 'c'],
      [-6.1, 1.45, 'd', 'a', 'c'], [2.4, -1.18, 1.8, 'o', 'o'], [-6.1, -1.45, 'd', 'a', 'c'], [9.3, -0.9, 'd', 'o', 'c'], [-9.0, 1.2, 'd', 'a', 'c']],
    cruiser: [[1.4, 1.2, 'd', 'o', 'c'], [-2.2, -1.2, 'd', 'o', 'c'], [7.9, 0.3, 'd', 'f', 'c'], [1.6, 0.88, 1.5, 'o', 'o'],
      [-0.9, -0.38, 1.5, 'o', 'g'], [-2.6, -0.4, 1.5, 'o', 'g'], [-8.0, 0.6, 'd', 'a', 'c'], [-2.2, 1.2, 'd', 'o', 'c'], [1.4, -1.2, 'd', 'o', 'c'], [-8.0, -0.6, 'd', 'a', 'c']],
    destroyer: [[0.6, 0.72, 'd', 'o', 'c'], [-1.4, -0.72, 'd', 'o', 'c'], [-5.3, 0.2, 'd', 'a', 'c'], [2.4, 0.38, 1.5, 'f', 'o'],
      [4.6, -0.35, 'd', 'f', 'c'], [-1.4, 0.72, 'd', 'o', 'c'], [0.6, -0.72, 'd', 'o', 'c'], [-5.3, -0.2, 'd', 'a', 'c']],
    pt: [[-0.45, 0, 'd', 0, 'g', 0], [-0.35, 0.02, 'd', 'f', 'o'], [1.8, 0.2, 'd', 'f', 'c'], [1.8, -0.2, 'd', 'f', 'c']],
    submarine: [[1.2, 0.12, 1.32, 'f', 'o'], [0.05, -0.1, 1.32, 'a', 'c'], [1.62, 0.18, 0.54, 'f', 'g'], [-1.4, 0.15, 0.54, 'a', 'g'], [0.05, 0.12, 1.32, 'o', 'c']],
    // carrier: z is multiplied by the island side (USN +1 starboard, IJN -1 port); keep off the park / run lanes (|z| < 1.6)
    carrier: [[4.3, 2.2, 2.0, 'i', 'y'], [-9.05, 2.8, 1.6, 'o', 'g'], [-1.6, 2.25, 2.0, 'i', 'b'], [5.95, -2.8, 1.6, 'o', 'g'],
      [8.5, 2.25, 2.0, 'i', 'r'], [-4.05, -2.8, 1.6, 'o', 'g'], [-7.5, 2.3, 2.0, 'i', 'n'], [5.1, 2.05, 2.0, 'f', 'o'],
      [-2.6, 2.1, 2.0, 'i', 'w'], [-4.05, 2.8, 1.6, 'o', 'g'], [5.95, 2.8, 1.6, 'o', 'g'], [11.0, 2.15, 2.0, 'i', 'y'],
      [-11.5, 2.3, 2.0, 'i', 'b'], [-9.05, -2.8, 1.6, 'o', 'g'], [6.4, 2.1, 2.0, 'i', 'b'], [2.4, 2.15, 2.0, 'i', 'r']]
  };
  // uniforms: [shirt, trousers, cap]
  var PAL = {
    USN: { c: [0x84a4cc, 0x3f5b86, 0xf3efe6], o: [0xcdb98f, 0xb5a27b, 0xf3efe6], g: [0x84a4cc, 0x3f5b86, 0x66707a],
      y: [0xe8c55a, 0x3f5b86, 0xe8c55a], b: [0x4f78b8, 0x3f5b86, 0x4f78b8], r: [0xcc5c52, 0x3f5b86, 0xcc5c52], n: [0x6fa476, 0x3f5b86, 0x6fa476], w: [0x8f6c4c, 0x3f5b86, 0x8f6c4c] },
    IJN: { c: [0xeae5d7, 0xd2ccbc, 0x2d3442], o: [0x8b875f, 0x7a774f, 0x2d3442], g: [0xeae5d7, 0xd2ccbc, 0x5d5b4a],
      y: [0xeae5d7, 0xd2ccbc, 0xe8c55a], b: [0x44506a, 0x3a445a, 0x2d3442], r: [0xeae5d7, 0xd2ccbc, 0xcc5c52], n: [0x44506a, 0x3a445a, 0x2d3442], w: [0xeae5d7, 0xd2ccbc, 0x2d3442] }
  };
  var SKIN = 0xe2b994;

  var meshes = null, arms = null, mat4 = null, recs = [], cache = {}, colCache = {}, figs = [], nFigs = 0;
  var _m, _l, _t, _v, _e, _a, _q, perf = { ms: 0, max: 0, n: 0, vis: 0, build: 0, model: 0 };

  // ---- figure geometry (bottom at y = 0, facing +x), merged by hand: no BufferGeometryUtils in the UMD build ----
  function merged(parts) {
    var pos = [], nor = [], v = new THREE.Vector3(), nm = new THREE.Matrix3();
    parts.forEach(function (pt) {
      var g = pt[0].index ? pt[0].toNonIndexed() : pt[0], m = pt[1], pa = g.attributes.position, na = g.attributes.normal;
      nm.getNormalMatrix(m);
      for (var i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m); pos.push(v.x * SCALE, v.y * SCALE, v.z * SCALE);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    g.computeBoundingSphere();
    return g;
  }
  function P(g, sx, sy, sz, x, y, z, rx) {
    return [g, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, 0, 0)), new THREE.Vector3(sx, sy, sz))];
  }
  function build() {
    var G = WW.models._geo(), box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), sph = new THREE.SphereGeometry(0.5, 8, 6);
    var cap = new THREE.CylinderGeometry(0.5, 0.4, 1, 8).translate(0, 0.5, 0);
    var geos = [
      merged([P(G.rbox, 0.09, 0.17, 0.155, 0, 0.16, 0)]),
      merged([P(box, 0.06, 0.175, 0.05, 0, 0, 0.033), P(box, 0.06, 0.175, 0.05, 0, 0, -0.033)]),
      merged([P(sph, 0.115, 0.12, 0.115, 0, 0.38, 0)]),
      merged([P(cap, 0.135, 0.042, 0.135, -0.004, 0.405, 0)])
    ];
    mat4 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 16), 16); mat4.setUsage(THREE.DynamicDrawUsage);
    meshes = geos.map(function (g, i) {
      var m = new THREE.InstancedMesh(g, new THREE.MeshToonMaterial({ color: i === 2 ? WW.models._soft(SKIN) : 0xffffff, gradientMap: WW.models._grad(), vertexColors: true }), MAX);
      m.instanceMatrix = mat4;
      if (i !== 2) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.visible = false;
      WW.scene.add(m);
      return m;
    });
    // arms: their own instanced mesh (2 per figure, own matrix buffer), pivot at the shoulder, hanging down -y
    var ag = merged([P(box, 0.045, 0.155, 0.042, 0, -0.155, 0)]);
    arms = new THREE.InstancedMesh(ag, meshes[0].material, MAX * 2);
    arms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    arms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 6), 3); arms.instanceColor.setUsage(THREE.DynamicDrawUsage);
    arms.count = 0; arms.frustumCulled = false; arms.castShadow = true; arms.receiveShadow = true; arms.visible = false;
    WW.scene.add(arms); meshes.push(arms);
    _m = new THREE.Matrix4(); _l = new THREE.Matrix4(); _t = new THREE.Matrix4(); _v = new THREE.Vector3(); _e = new THREE.Euler(); _a = new THREE.Matrix4(); _q = new THREE.Matrix4();
  }
  function cols(nation, role) {
    var k = nation + role;
    if (!colCache[k]) colCache[k] = ((PAL[nation] || PAL.USN)[role] || PAL.USN.c).map(function (h) { return WW.models._soft(h); });
    return colCache[k];
  }

  // ---- stations: deck heights from vertical-line hits on a throwaway model (once per type + nation) ----
  // Every non-vertical triangle of the model is bucketed into a 0.5-unit xz grid; a query lists the heights
  // where a vertical line at (x, z) crosses the model, with the face direction (up = a floor, down = a ceiling).
  var GC = 0.5;
  function triGrid(list) {
    var cells = {}, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    list.forEach(function (mesh) {
      var g = mesh.geometry, pa = g.attributes.position, ix = g.index, n = ix ? ix.count : pa.count, mw = mesh.matrixWorld;
      for (var i = 0; i + 2 < n; i += 3) {
        a.fromBufferAttribute(pa, ix ? ix.getX(i) : i).applyMatrix4(mw);
        b.fromBufferAttribute(pa, ix ? ix.getX(i + 1) : i + 1).applyMatrix4(mw);
        c.fromBufferAttribute(pa, ix ? ix.getX(i + 2) : i + 2).applyMatrix4(mw);
        var ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        if (Math.abs(ny) < 1e-9) continue;               // vertical: a vertical line never crosses it
        var t = [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, ny > 0 ? 1 : -1];
        var x0 = Math.floor(Math.min(a.x, b.x, c.x) / GC), x1 = Math.floor(Math.max(a.x, b.x, c.x) / GC);
        var z0 = Math.floor(Math.min(a.z, b.z, c.z) / GC), z1 = Math.floor(Math.max(a.z, b.z, c.z) / GC);
        for (var gx = x0; gx <= x1; gx++) for (var gz = z0; gz <= z1; gz++) (cells[gx + ',' + gz] || (cells[gx + ',' + gz] = [])).push(t);
      }
    });
    return cells;
  }
  function hits(grid, x, z, out) {     // [y, dir, y, dir, ...] where the vertical line at (x, z) crosses the model
    out.length = 0;
    var L = grid[Math.floor(x / GC) + ',' + Math.floor(z / GC)];
    if (!L) return out;
    for (var i = 0; i < L.length; i++) {
      var t = L[i], d = (t[5] - t[2]) * (t[6] - t[0]) - (t[3] - t[0]) * (t[8] - t[2]);
      var u = ((t[5] - t[2]) * (x - t[0]) - (t[3] - t[0]) * (z - t[2])) / d, v = ((z - t[2]) * (t[6] - t[0]) - (x - t[0]) * (t[8] - t[2])) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      out.push(t[1] + (t[4] - t[1]) * v + (t[7] - t[1]) * u, t[9]);
    }
    return out;
  }
  var _h = [];
  function surf(grid, x, z, ys, quick) { // standing height near ys at (x, z) with head room, or null
    var best = null;
    for (var k = quick ? 1 : 0; k < (quick ? 2 : 3); k++) { // centre and both shoulders (lane samples: centre only)
      hits(grid, x, z + (k - 1) * 0.085 * SCALE, _h);
      var top = -1e9, i;
      for (i = 0; i < _h.length; i += 2) if (_h[i] <= ys + 3 && _h[i] > top) top = _h[i]; // what a ray from above meets first
      if (top > ys + 0.12 || top < ys - 0.22) return null;
      for (i = 0; i < _h.length; i += 2) if (_h[i + 1] < 0 && _h[i] > top + 0.03 && _h[i] < top + 0.46 * SCALE) return null; // no head room
      if (k === 1) best = top; else if (best != null && Math.abs(top - best) > 0.1) return null;
    }
    return best;
  }
  // top-surface height map (0.25-unit cells, ship-local) for scorch decals (damage_visuals.js): the median of the
  // highest surface over a 3 x 3 sample, so thin masts and rails do not count
  function topMap(grid, type) {
    var a = hp(type), c = cl(type), S = 0.25, nx = Math.ceil(a[0] / S) + 2, nz = Math.ceil((c && c.deckW ? c.deckW + 1.2 : a[1]) / S) + 2;
    var x0 = -a[0] / 2 - S, z0 = -(nz - 1) * S / 2, y = new Float32Array(nx * nz), smp = [];
    for (var i = 0; i < nx; i++) for (var k = 0; k < nz; k++) {
      smp.length = 0;
      for (var di = -1; di <= 1; di++) for (var dk = -1; dk <= 1; dk++) {
        hits(grid, x0 + i * S + di * 0.09, z0 + k * S + dk * 0.09, _h);
        var tp = -1e9, lim = deckY(type, x0 + i * S) + 1.4;   // decks and low roofs, not mast platforms
        for (var j = 0; j < _h.length; j += 2) if (_h[j + 1] > 0 && _h[j] > tp && _h[j] < lim) tp = _h[j];
        smp.push(tp);
      }
      smp.sort(function (p, q) { return p - q; }); y[i * nz + k] = smp[4];
    }
    return { x0: x0, z0: z0, S: S, nx: nx, nz: nz, y: y };
  }
  function topAt(c, x, z) {
    var i = Math.round((x - c.x0) / c.S), k = Math.round((z - c.z0) / c.S);
    if (i < 0 || k < 0 || i >= c.nx || k >= c.nz) return null;
    var y = c.y[i * c.nz + k]; return y > -1e8 ? y : null;
  }
  function deckY(type, x) { var a = hp(type); return WW.models._hullAt(a[0], a[1], a[2], a[3], a[4], a[5], WW.clamp((x + a[0] / 2) / a[0], 0, 1)).yt; }
  function halfW(type, x) { var a = hp(type); return WW.models._hullAt(a[0], a[1], a[2], a[3], a[4], a[5], WW.clamp((x + a[0] / 2) / a[0], 0, 1)).w; }
  function lane(list, x, z, y, range) {   // contiguous walkable strip along x at this z (same deck level)
    var STEP = 0.25, n = Math.round(range / STEP), L = [], Rr = [], prev = y, i, yy;
    for (i = 1; i <= n; i++) { yy = surf(list, x - i * STEP, z, prev, true); if (yy == null || Math.abs(yy - prev) > 0.07) break; L.push(yy); prev = yy; }
    prev = y;
    for (i = 1; i <= n; i++) { yy = surf(list, x + i * STEP, z, prev, true); if (yy == null || Math.abs(yy - prev) > 0.07) break; Rr.push(yy); prev = yy; }
    if (L.length + Rr.length < 3) return null;
    return { x0: x - L.length * STEP, x1: x + Rr.length * STEP, step: STEP, ys: L.reverse().concat([y], Rr) };
  }
  function laneY(ln, x) { var f = (x - ln.x0) / ln.step, i = Math.max(0, Math.min(ln.ys.length - 2, Math.floor(f))), t = WW.clamp(f - i, 0, 1); return ln.ys[i] + (ln.ys[i + 1] - ln.ys[i]) * t; }
  function faceOf(f, z) { return typeof f === 'number' ? f : f === 'f' ? 0 : f === 'a' ? PI : (f === 'o') === (z >= 0) ? -PI / 2 : PI / 2; }
  function stations(k, nation) {
    var c = cl(k), type = c ? c.type : k, key = (c ? c.key : k) + '|' + nation;
    k = c ? c.key : k;
    if (cache[key]) return cache[key];
    var out = [], m = null, tb = performance.now();
    if (!_v) _v = new THREE.Vector3();
    try {
      m = WW.models.buildShip(type, nation, k);
      perf.model += performance.now() - tb;
      m.group.updateMatrixWorld(true);
      var lm = WW.models._lineMat(), list = [];
      m.group.traverse(function (o) { if (o.isMesh && o.material !== lm && !(Array.isArray(o.material) && o.material[0] === lm)) list.push(o); });
      list = triGrid(list);
      out.top = topMap(list, k);
      var dd = m.deckDims, side = dd ? dd.islandSide : 1, r = REF[type], h = m.hull;
      var kx = h[0] / r[0], kz = dd ? dd.halfW / 2.5 : h[1] / r[1];   // reference hull -> this class
      (ST[type] || []).forEach(function (s) {
        var tu = s[5] != null ? m.turrets[s[5]] : null, x = s[0] * kx, z = s[1] * side * kz, gx = x, gz = z;
        if (tu) { tu.obj.updateMatrix(); _v.set(x, 0, z).applyMatrix4(tu.obj.matrix); gx = _v.x; gz = _v.z; }
        var ys = s[2] === 'd' ? deckY(k, gx) : s[2] + (dd ? dd.top - 1.99 : 0), y = surf(list, gx, gz, ys);
        if (y == null && s[2] !== 'd') {   // a raised station on another class: the highest floor up to ~ys there
          hits(list, gx, gz, _h); var t = -1e9;
          for (var j = 0; j < _h.length; j += 2) if (_h[j + 1] > 0 && _h[j] <= ys + 0.6 && _h[j] > t) t = _h[j];
          if (t > deckY(k, gx) - 0.1) y = surf(list, gx, gz, t);
        }
        if (y == null) return;
        var st = { x: x, z: z, y: tu ? y - tu.obj.position.y : y, f: faceOf(s[3], z), role: s[4], t: tu ? s[5] : null, lane: null };
        if (!tu && type !== 'submarine') st.lane = lane(list, x, z, y, type === 'pt' ? 0.6 : 4.5);
        out.push(st);
      });
    } catch (e) { if (window.console) console.warn('crew: stations', key, e); }
    if (m) m.hullMats.forEach(function (x) { x.dispose(); });
    perf.build += performance.now() - tb;
    return (cache[key] = out);
  }

  // ---- per-ship crews ----
  function sailor(ship, st) {
    return { st: st, x: st.x, z: st.z, y: st.y, f: st.f + (R() - 0.5) * 0.8, ft: st.f, mode: 'idle', wait: R() * 6, ph: R() * 10,
      tx: st.x, sc: 0.93 + R() * 0.12, tur: st.t != null ? ship.model.turrets[st.t].obj : null, col: cols(ship.nation, st.role), job: null };
  }
  function makeCrew(ship) {
    var all = stations(ship.mk || ship.type, ship.nation), n = COUNT[ship.type] || 0, rec = { ship: ship, sailors: [], spare: [], fireT: R() * 0.5, sink: false, job: null };
    all.forEach(function (st, i) { if (i < n) rec.sailors.push(sailor(ship, st)); else rec.spare.push(st); });
    ship._crew = rec; recs.push(rec);
    return rec;
  }
  function clear() {
    recs.length = 0; nFigs = 0;
    (WW.world.ships || []).forEach(function (s) { s._crew = undefined; });
    if (meshes) meshes.forEach(function (m) { m.count = 0; m.visible = false; });
  }

  // crew_ops.js runs inside guards: an error there logs once and the crews fall back to the plain behaviour
  var opsErr = null;
  function opsFail(e) { opsErr = e; console.error('crewOps', e); }
  function opsStep(s, rec, dt, t) { try { return WW.crewOps.step(s, rec, dt, t); } catch (e) { opsFail(e); return false; } }
  // fire or fresh hit -> 2 deck hands run to it (crew_ops.js replaces this with damage-control parties and much more)
  function fireCheck(rec, now) {
    if (WW.crewOps && !opsErr) { try { return WW.crewOps.ship(rec, now); } catch (e) { opsFail(e); } }
    var sh = rec.ship, best = null, S = sh.dmgSites || [];
    for (var i = 0; i < S.length; i++) if (S[i].fire > 0 && (!best || S[i].sev > best.sev)) best = S[i];
    var tgt = best || (sh._crewHit && now - sh._crewHit.t < 6 ? sh._crewHit : null);
    if (tgt === rec.job) return;
    rec.job = tgt;
    rec.sailors.forEach(function (s) { if (s.job) { s.job = null; s.tx = s.st.x; s.mode = 'walk'; } });
    if (tgt) rec.sailors.filter(function (s) { return s.st.lane && !s.tur && s.mode === 'idle'; }).slice(0, 2).forEach(function (s) {
      s.job = tgt; s.tx = WW.clamp(tgt.lx, s.st.lane.x0, s.st.lane.x1); s.mode = 'run';
    });
  }
  function startAbandon(rec) {   // far ships keep this state frozen until the camera comes close
    rec.sink = true;
    if (WW.crewOps && !opsErr && rec.ship.type !== 'submarine') { try { WW.crewOps.abandon(rec, sailor); } catch (e) { opsFail(e); } }   // hands pour up from below
    var below = rec.ship.type === 'submarine' && (rec.ship.depthY < -0.08 || !rec.ship.wantSurface); // crew was below
    rec.sailors.forEach(function (s) {
      if (below) { s.mode = 'gone'; return; }
      if (s.tur) { s.tur.updateMatrix(); _v.set(s.x, s.y, s.z).applyMatrix4(s.tur.matrix); s.x = _v.x; s.y = _v.y; s.z = _v.z; s.f += s.tur.rotation.y; s.tur = null; }
      s.mode = 'flee'; s.wait = R() * 2.2; s.below = R() < 0.25; s.job = null; s.jk = null;
      s.side = Math.abs(s.z) > 0.05 ? Math.sign(s.z) : (R() < 0.5 ? -1 : 1);
      var dd = rec.ship.model.deckDims, mk = rec.ship.mk || rec.ship.type;
      s.ez = s.side * (dd && s.y > dd.top - 0.1 ? dd.halfW + 0.1 : halfW(mk, s.x) + 0.1);
    });
  }

  function stepSailor(s, rec, dt, t) {
    var a, ln = s.st.lane;
    if (WW.crewOps && !opsErr && opsStep(s, rec, dt, t)) { a = WW.angleDiff(s.f, s.ft); s.f += a * Math.min(1, dt * 6); return; }
    switch (s.mode) {
      case 'idle':
        s.wait -= dt;
        if (s.wait <= 0) {
          s.wait = 3 + R() * 7;
          if (ln && R() < 0.45) { s.tx = WW.clamp(s.st.x + (R() * 2 - 1) * 0.8, ln.x0, ln.x1); s.mode = 'walk'; }
          else s.ft = s.st.f + (R() * 2 - 1) * 1.0;
        }
        break;
      case 'walk': case 'run': {
        var d = s.tx - s.x, sp = (s.mode === 'run' ? 1.5 : 0.4) * dt;
        if (Math.abs(d) <= sp) { s.x = s.tx; s.mode = s.job ? 'fight' : 'idle'; s.ft = s.job ? Math.atan2(-(s.job.lz - s.z), s.job.lx - s.x) : s.st.f; s.wait = 1 + R() * 4; }
        else { s.x += d > 0 ? sp : -sp; s.ft = d > 0 ? 0 : PI; }
        if (ln) s.y = laneY(ln, s.x);
        break;
      }
      case 'fight':
        if (s.job) s.ft = Math.atan2(-(s.job.lz - s.z), s.job.lx - s.x) + (s.job.fire > 0 ? Math.sin(t * 1.3 + s.ph) * 0.12 : Math.sin(t * 2.6 + s.ph) * 0.35);
        break;
      case 'flee':
        s.wait -= dt;
        if (s.wait > 0) break;
        if (s.below) { s.mode = 'gone'; break; }
        s.ft = s.side > 0 ? -PI / 2 : PI / 2;
        a = 1.6 * dt;
        if (Math.abs(s.ez - s.z) > a && Math.abs(s.z) < Math.abs(s.ez)) s.z += s.side * a;
        else if (!(WW.crewOps && !opsErr && WW.crewOps.atRail(s, rec))) { // over the side (or down a cargo net, crew_ops.js): world space
          var sh = rec.ship, G = sh.group.matrix;
          _v.set(s.x, s.y, s.z).applyMatrix4(G);
          var dx = G.elements[8] * s.side, dz = G.elements[10] * s.side, l = Math.hypot(dx, dz) || 1;
          s.wp = _v.clone(); s.wv = new THREE.Vector3(dx / l * 1.3, 1.7, dz / l * 1.3); s.yaw = Math.atan2(-dz, dx); s.tum = 0; s.mode = 'jump';
        }
        break;
      case 'jump':
        s.wv.y -= 6.5 * dt; s.wp.addScaledVector(s.wv, dt); s.tum += dt * 2.4;
        if (s.wp.y < -0.1) { s.mode = 'gone'; if (WW.fx) WW.fx.splash(s.wp.x, s.wp.z, 0.3); }
        break;
    }
    if (s.mode !== 'jump') { a = WW.angleDiff(s.f, s.ft); s.f += a * Math.min(1, dt * (s.mode === 'run' || s.mode === 'flee' ? 9 : 4)); }
  }

  // write one instance (world matrix in _m); returns false when full or under water (wet: lifeboat seats sit low)
  // arms (s: sailor with aL / aR forward swing and oL / oR outward flare, radians; none: hanging)
  function put(n, c, wet, s) {
    if (n >= MAX || (!wet && _m.elements[13] < 0.03)) return false;
    _m.toArray(mat4.array, n * 16);
    for (var k = 0; k < 3; k++) { var a = meshes[k === 2 ? 3 : k].instanceColor.array; a[n * 3] = c[k].r; a[n * 3 + 1] = c[k].g; a[n * 3 + 2] = c[k].b; }
    var ca = arms.instanceColor.array;
    for (k = 0; k < 2; k++) {
      var sd = k ? -1 : 1, fw = s ? (k ? s.aR : s.aL) || 0 : 0.15, o = s ? (k ? s.oR : s.oL) : 0.12;
      if (o == null) o = 0.12;
      _a.makeTranslation(0, 0.325 * SCALE, sd * 0.098 * SCALE);
      _a.multiply(_q.makeRotationFromEuler(_e.set(-sd * o * (Math.cos(fw) < 0 ? -1 : 1), 0, fw, 'XZY')));
      _t.multiplyMatrices(_m, _a); _t.toArray(arms.instanceMatrix.array, (n * 2 + k) * 16);
      ca[(n * 2 + k) * 3] = c[0].r; ca[(n * 2 + k) * 3 + 1] = c[0].g; ca[(n * 2 + k) * 3 + 2] = c[0].b;
    }
    return true;
  }

  function update(rdt) {
    if (!meshes || !WW.camera) return;
    var t0 = performance.now(), b0 = perf.build, dt = Math.min(0.1, rdt || 0), now = t0 / 1000, cam = WW.camera.position, n = 0, i, j;
    var ships = WW.world.ships;
    for (i = 0; i < ships.length; i++) { var s0 = ships[i]; if (!s0._crew && !s0.removed && !s0.wreck && s0.alive) makeCrew(s0); }
    for (i = recs.length - 1; i >= 0; i--) {
      var rec = recs[i], sh = rec.ship;
      if (sh.removed || sh.wreck || sh._crew !== rec) { recs.splice(i, 1); continue; }
      var g = sh.group, near = cam.distanceToSquared(g.position) < FAR * FAR;
      if (sh.sinking && !rec.sink) startAbandon(rec);
      if (!near) continue;
      if (sh.type === 'submarine' && !rec.sink && (!sh.wantSurface || sh.depthY < -0.08)) continue; // crew below
      g.updateMatrix();
      rec.fireT -= dt;
      if (rec.fireT <= 0 && !rec.sink) { rec.fireT = 0.5; fireCheck(rec, now); }
      if (WW.crewOps && !opsErr) { try { WW.crewOps.frame(rec, dt, now); } catch (e) { opsFail(e); } }
      for (j = 0; j < rec.sailors.length; j++) {
        var s = rec.sailors[j];
        if (s.mode === 'gone') continue;
        stepSailor(s, rec, dt, now);
        if (s.mode === 'jump') { _m.makeRotationFromEuler(_e.set(0, s.yaw, -s.tum, 'YXZ')).setPosition(s.wp); s.aL = 2.7; s.aR = 2.3; s.oL = s.oR = 0.5; }
        else {
          var walk = s.mode === 'walk' || s.mode === 'run' || (s.mode === 'flee' && s.wait <= 0);
          var sw = walk ? Math.sin(now * (s.mode === 'walk' ? 9 : 15) + s.ph) : 0, bob = Math.abs(sw) * 0.025;
          s.aL = sw * 0.45; s.aR = -sw * 0.45; s.oL = s.oR = null; s.cr = 0; s.lean = 0; s.hop = 0; s.dx = 0;
          if (WW.crewOps && !opsErr) { try { WW.crewOps.pose(s, rec, now); } catch (e) { opsFail(e); } } // working poses
          _l.makeRotationY(s.f + (s.mode === 'idle' && !s.still ? Math.sin(now * 0.7 + s.ph) * 0.06 : 0));
          if (s.lean) _l.multiply(_t.makeRotationZ(-s.lean));
          if (s.sc !== 1 || s.cr) _l.scale(_v.set(s.sc, s.sc * (1 - 0.28 * s.cr), s.sc));
          _l.setPosition(s.x + Math.cos(s.f) * s.dx, s.y + bob + s.hop, s.z - Math.sin(s.f) * s.dx);
          if (s.tur) { s.tur.updateMatrix(); _t.multiplyMatrices(s.tur.matrix, _l); _m.multiplyMatrices(g.matrix, _t); }
          else _m.multiplyMatrices(g.matrix, _l);
        }
        if (put(n, s.col, false, s)) n++;
      }
    }
    if (WW.lifeboats && WW.lifeboats.figures) WW.lifeboats.figures();
    for (i = 0; i < nFigs; i++) { var fg = figs[i]; if (cam.distanceToSquared(_v.setFromMatrixPosition(fg.m)) > FAR * FAR) continue; _m.copy(fg.m); if (put(n, fg.c, true)) n++; }
    nFigs = 0;
    if (WW.crewProps) WW.crewProps.update(dt);   // hose streams and cargo nets (crew_props.js)
    meshes.forEach(function (m) { m.count = m === arms ? n * 2 : n; m.visible = n > 0; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    mat4.needsUpdate = true; arms.instanceMatrix.needsUpdate = true;
    var ms = performance.now() - t0 - (perf.build - b0); // steady-state cost (one-time station builds excluded)
    perf.ms = perf.ms * 0.95 + ms * 0.05; perf.max = Math.max(perf.max * 0.999, ms); perf.vis = n;
  }

  WW.on && WW.on('shipHit', function (d) {
    var sh = d && d.ship; if (!sh || !sh._crew || !isFinite(d.x) || !isFinite(d.z)) return;
    var dx = d.x - sh.x, dz = d.z - sh.z, c = Math.cos(sh.heading), sn = Math.sin(sh.heading);
    sh._crewHit = { lx: dx * c + dz * sn, lz: -dx * sn + dz * c, t: performance.now() / 1000 };
  });

  WW.crew = {
    init: function () {
      if (meshes || !WW.scene || !WW.models) return;
      build();
      // ray-cast every class now (one-time boot cost) so no battle frame hitches on a first sighting
      Object.keys(WW.SHIP_CLASSES).forEach(function (k) { stations(k, WW.SHIP_CLASSES[k].nation); });
      WW.on('roundStart', clear); WW.on('setupStart', clear);
    },
    update: function (rdt) { try { update(rdt); } catch (e) { if (!WW.crew._err) { WW.crew._err = e; console.error('crew', e); } } },
    clearAll: clear,
    // one extra figure this frame (lifeboats.js): world matrix m (feet at the origin, facing +x), nation, role
    addFigure: function (m, nation, role) {
      var f = figs[nFigs] || (figs[nFigs] = { m: new THREE.Matrix4(), c: null });
      f.m.copy(m); f.c = cols(nation, role || 'c'); nFigs++;
    },
    // rescued sailors join a ship's crew at its spare stations
    adopt: function (ship, k) {
      var rec = ship && ship._crew; if (!rec || rec.sink) return 0;
      var n = 0; while (n < k && rec.spare.length) { rec.sailors.push(sailor(ship, rec.spare.shift())); n++; }
      return n;
    },
    stations: stations, halfW: halfW, deckY: deckY, hp: hp, recs: recs,      // k: a model key (ship.mk) or a type
    top: function (k, nation, x, z) { var c = stations(k, nation).top; return c ? topAt(c, x, z) : null; },
    stats: function () {
      var sl = 0; recs.forEach(function (r) { sl += r.sailors.filter(function (s) { return s.mode !== 'gone'; }).length; });
      return { ships: recs.length, sailors: sl, visible: perf.vis, ms: +perf.ms.toFixed(3), maxMs: +perf.max.toFixed(3), buildMs: Math.round(perf.build), modelMs: Math.round(perf.model) };
    },
    SCALE: SCALE, FAR: FAR
  };
})();
