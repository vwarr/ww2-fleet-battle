// models_planes.js (owner B) - six named carrier types in the chubby toon style. Load after models.js.
// USN: F4U Corsair (fighter), SBD Dauntless (dive), TBD Devastator (torpedo)
// IJN: A6M Zero (fighter), D3A Val (dive), B5N Kate (torpedo)
// Every part is lofted with baked vertex colours (paint x soft AO) and merged into a few meshes that all
// share ONE toon material: body, wingL, wingR (pivots at the wing roots, or the Corsair's gull knees), prop blades, prop disc, payload,
// and the dive-brake flaps. Geometry is built once per kind+nation and shared by every pooled plane.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI;
  // ---- paint ----
  var US = { top: 0x5f7d9c, belly: 0xd6dadd, cowl: 0x5f7d9c, lip: 0x3e4a58, spin: 0x5f7d9c, blade: 0x3a3d42, tip: 0xe8c450,
    glass: 0x4a7392, frame: 0x55687c, mark: 'star' };
  var PAINT = {   // Corsair: overall sea blue, a shade lighter underneath, star-and-bar
    'fighter|USN': { top: 0x3d5a84, belly: 0x51709a, cowl: 0x3d5a84, lip: 0x323d4c, spin: 0x3d5a84, blade: 0x3a3d42, tip: 0xe8c450,
      glass: 0x4a7392, frame: 0x3a5272, mark: 'star', bars: true }, 'dive|USN': US, 'torpedo|USN': US,
    'fighter|IJN': { top: 0xcac6b0, belly: 0xd8d6c8, cowl: 0x2f343b, lip: 0x24282e, spin: 0xbfbdb2, blade: 0x6e6252, tip: 0xc85448,
      glass: 0x4a7392, frame: 0x6a6c64, mark: 'disc' },
    'dive|IJN': { top: 0x76845a, belly: 0xcfccb8, cowl: 0x2f343b, lip: 0x24282e, spin: 0xbfbdb2, blade: 0x6e6252, tip: 0xc85448,
      glass: 0x4a7392, frame: 0x4a5240, mark: 'disc' },
    'torpedo|IJN': { top: 0x5f6c49, belly: 0xcfccb8, cowl: 0x2f343b, lip: 0x24282e, spin: 0xbfbdb2, blade: 0x6e6252, tip: 0xc85448,
      glass: 0x4a7392, frame: 0x424a38, mark: 'disc' }
  };
  // ---- shapes (model units, nose on +x, centre line y = 0). body: [x, half width, half height, centre y] tail -> nose.
  // wing: qc = quarter-chord x at the root, y, chord root/tip, semi-span from the pivot z0, dih (rise per unit span),
  //       sweep (quarter-chord moves aft per unit of s), tip: 'square' | 'round' | 'ellipse', t = thickness/chord.
  //       gull: inverted gull wing - the inner panel (fixed to the body) runs down at anh (rise per unit span) to the
  //       knee at gull * semi; the outer panel (wingL / wingR, pivot at the knee, folds up) rises at dih.
  var TYPES = {
    'fighter|USN': { name: 'F4U Corsair', cowlX: 0.86, exhX: 0.8,   // long nose, cockpit far aft, big prop
      body: [[-1.24, 0.03, 0.05, 0.12], [-0.92, 0.1, 0.14, 0.08], [-0.42, 0.21, 0.27, 0.04], [0.1, 0.28, 0.31, 0.01], [0.6, 0.31, 0.32, 0], [0.96, 0.33, 0.33, 0], [1.18, 0.3, 0.3, 0]],
      canopy: { x0: -0.5, x1: -0.02, w: 0.15, h: 0.19, frames: 2 },
      wing: { qc: 0.3, y: -0.15, root: 0.86, tip: 0.44, semi: 1.26, z0: 0.24, gull: 0.36, anh: -0.62, dih: 0.22, sweep: 0.05, tip_: 'round', t: 0.17 },
      tail: { qc: -0.98, y: 0.07, root: 0.4, tip: 0.24, semi: 0.56, tip_: 'round' },
      fin: { qc: -1.04, y: 0.1, root: 0.56, tip: 0.26, semi: 0.56, tip_: 'round' },
      inlets: true, markX: -0.72, prop: 0.6 },
    'dive|USN': { name: 'SBD Dauntless', cowlX: 0.82, exhX: 0.78,
      body: [[-1.26, 0.03, 0.05, 0.12], [-0.92, 0.1, 0.14, 0.09], [-0.3, 0.2, 0.25, 0.05], [0.3, 0.27, 0.31, 0.02], [0.8, 0.3, 0.32, 0], [1.1, 0.29, 0.29, 0], [1.22, 0.25, 0.25, 0]],
      canopy: { x0: -0.42, x1: 0.58, w: 0.15, h: 0.18, frames: 4 },
      wing: { qc: 0.4, y: -0.18, root: 0.92, tip: 0.44, semi: 1.3, z0: 0.22, dih: 0.1, sweep: 0.28, tip_: 'round', t: 0.16 },
      tail: { qc: -0.98, y: 0.1, root: 0.42, tip: 0.24, semi: 0.62, tip_: 'round' },
      fin: { qc: -1.04, y: 0.12, root: 0.52, tip: 0.22, semi: 0.5, tip_: 'round' },
      brakes: 'split', bomb: true, prop: 0.52 },
    'torpedo|USN': { name: 'TBD Devastator', cowlX: 0.92, exhX: 0.88,
      body: [[-1.32, 0.03, 0.05, 0.15], [-0.98, 0.11, 0.16, 0.11], [-0.3, 0.22, 0.31, 0.06], [0.3, 0.28, 0.35, 0.03], [0.85, 0.3, 0.33, 0], [1.2, 0.28, 0.28, 0], [1.3, 0.24, 0.24, 0]],
      canopy: { x0: -0.82, x1: 0.62, w: 0.15, h: 0.22, frames: 6 },
      wing: { qc: 0.36, y: -0.2, root: 1.02, tip: 0.44, semi: 1.56, z0: 0.24, dih: 0.09, sweep: 0.2, tip_: 'round', t: 0.17 },
      tail: { qc: -1.06, y: 0.12, root: 0.44, tip: 0.24, semi: 0.7, tip_: 'round' },
      fin: { qc: -1.12, y: 0.14, root: 0.52, tip: 0.26, semi: 0.58, tip_: 'round' },
      torpedo: true, prop: 0.55 },
    'fighter|IJN': { name: 'A6M Zero', cowlX: 0.62, exhX: 0.55,
      body: [[-1.18, 0.025, 0.045, 0.1], [-0.86, 0.08, 0.11, 0.07], [-0.3, 0.16, 0.2, 0.04], [0.2, 0.23, 0.26, 0.02], [0.62, 0.27, 0.27, 0], [0.98, 0.27, 0.27, 0], [1.16, 0.23, 0.23, 0]],
      canopy: { x0: -0.24, x1: 0.56, w: 0.13, h: 0.16, frames: 4 },
      wing: { qc: 0.36, y: -0.15, root: 0.82, tip: 0.4, semi: 1.26, z0: 0.18, dih: 0.1, sweep: 0.12, tip_: 'round', t: 0.14 },
      tail: { qc: -0.92, y: 0.07, root: 0.34, tip: 0.18, semi: 0.52, tip_: 'round' },
      fin: { qc: -0.98, y: 0.08, root: 0.44, tip: 0.18, semi: 0.42, tip_: 'round' },
      prop: 0.5 },
    'dive|IJN': { name: 'D3A Val', cowlX: 0.76, exhX: 0.7,
      body: [[-1.22, 0.03, 0.05, 0.12], [-0.9, 0.1, 0.14, 0.09], [-0.3, 0.2, 0.25, 0.05], [0.3, 0.26, 0.29, 0.02], [0.75, 0.29, 0.3, 0], [1.08, 0.28, 0.28, 0], [1.2, 0.24, 0.24, 0]],
      canopy: { x0: -0.46, x1: 0.56, w: 0.14, h: 0.18, frames: 4 },
      wing: { qc: 0.36, y: -0.17, root: 0.96, tip: 0.0, semi: 1.42, z0: 0.2, dih: 0.1, sweep: 0.0, tip_: 'ellipse', t: 0.16 },
      tail: { qc: -0.96, y: 0.1, root: 0.42, tip: 0.2, semi: 0.62, tip_: 'round' },
      fin: { qc: -1.0, y: 0.1, root: 0.62, tip: 0.22, semi: 0.52, tip_: 'round' },
      brakes: 'slat', bomb: true, spats: true, prop: 0.52 },
    'torpedo|IJN': { name: 'B5N Kate', cowlX: 0.86, exhX: 0.8,
      body: [[-1.3, 0.03, 0.05, 0.12], [-0.95, 0.1, 0.14, 0.09], [-0.3, 0.2, 0.25, 0.05], [0.3, 0.25, 0.28, 0.02], [0.82, 0.28, 0.29, 0], [1.16, 0.27, 0.27, 0], [1.26, 0.23, 0.23, 0]],
      canopy: { x0: -0.78, x1: 0.64, w: 0.13, h: 0.19, frames: 6 },
      wing: { qc: 0.38, y: -0.18, root: 1.0, tip: 0.46, semi: 1.62, z0: 0.2, dih: 0.11, sweep: 0.16, tip_: 'round', t: 0.16 },
      tail: { qc: -1.02, y: 0.1, root: 0.42, tip: 0.2, semi: 0.66, tip_: 'round' },
      fin: { qc: -1.08, y: 0.1, root: 0.52, tip: 0.22, semi: 0.52, tip_: 'round' },
      torpedo: true, prop: 0.55 }
  };

  var M, soft, _c = new THREE.Color();
  // ---- tube builder: rings of [x, y, z, hex] -> indexed geometry, end caps, outward winding, smooth normals ----
  function tube(rings, capA, capB) {
    var N = rings[0].length, pos = [], col = [], idx = [];
    function V(p) { pos.push(p[0], p[1], p[2]); _c.copy(soft(p[3])); col.push(_c.r, _c.g, _c.b); return pos.length / 3 - 1; }
    rings.forEach(function (r) { r.forEach(V); });
    for (var i = 0; i < rings.length - 1; i++) for (var j = 0; j < N; j++) {
      var a = i * N + j, b = i * N + (j + 1) % N, c = a + N, d = b + N;
      idx.push(a, c, b, b, c, d);
    }
    function cap(r, front, hex) {
      var s = pos.length / 3, cx = 0, cy = 0, cz = 0;
      r.forEach(function (p) { V([p[0], p[1], p[2], hex == null ? p[3] : hex]); cx += p[0]; cy += p[1]; cz += p[2]; });
      var ci = V([cx / N, cy / N, cz / N, hex == null ? r[0][3] : hex]);
      for (var j = 0; j < N; j++) { var a = s + j, b = s + (j + 1) % N; if (front) idx.push(ci, b, a); else idx.push(ci, a, b); }
    }
    if (capA !== false) cap(rings[0], false, capA === true ? null : capA);
    if (capB !== false) cap(rings[rings.length - 1], true, capB === true ? null : capB);
    // orient outward: flip if the signed volume is negative
    var vol = 0, P = pos;
    for (var k = 0; k < idx.length; k += 3) {
      var a3 = idx[k] * 3, b3 = idx[k + 1] * 3, c3 = idx[k + 2] * 3;
      vol += P[a3] * (P[b3 + 1] * P[c3 + 2] - P[b3 + 2] * P[c3 + 1]) - P[a3 + 1] * (P[b3] * P[c3 + 2] - P[b3 + 2] * P[c3]) + P[a3 + 2] * (P[b3] * P[c3 + 1] - P[b3 + 1] * P[c3]);
    }
    if (vol < 0) for (k = 0; k < idx.length; k += 3) { var t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function cr(a, b, c, d, t) { return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t); }
  // Catmull-Rom through control stations, k samples per span
  function smooth(st, k) {
    var out = [], n = st.length;
    for (var i = 0; i < n - 1; i++) for (var s = 0; s < k; s++) {
      var t = s / k, row = [];
      for (var f = 0; f < 4; f++) row.push(cr(st[Math.max(0, i - 1)][f], st[i][f], st[i + 1][f], st[Math.min(n - 1, i + 2)][f], t));
      out.push(row);
    }
    out.push(st[n - 1].slice());
    return out;
  }
  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  // superellipse cross-section rings along x; colf(station, sinθ, cosθ, i) -> hex
  function bodyRings(st, N, p, colf) {
    return st.map(function (s, i) {
      var r = [];
      for (var j = 0; j < N; j++) {
        var th = j / N * 2 * PI, c = Math.cos(th), sn = Math.sin(th);
        r.push([s[0], s[3] + s[2] * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p), s[1] * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), colf(s, sn, c, i)]);
      }
      return r;
    });
  }
  function twoTone(top, belly) { return function (s, sn) { return sstep(-0.3, 0.25, sn) > 0.5 ? top : belly; }; }
  // lifting surface along +z*side (span s in 0..1 from the pivot). Airfoil: rounded LE (+x), sharp TE, fuller on top.
  function chordAt(o, s) {
    var c = o.root + (o.tip - o.root) * s, k = 1;
    if (o.tip_ === 'square') k = s < 0.93 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.93) / 0.07, 2)));
    else if (o.tip_ === 'round') k = s < 0.68 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.68) / 0.32, 2)));
    else if (o.tip_ === 'cut') k = 1;   // gull inner panel: full chord to the knee
    else { c = o.root; k = Math.sqrt(Math.max(0, 1 - s * s)); }
    return { c: c * k, t: (o.t || 0.13) * c * Math.sqrt(k) };
  }
  function airfoil(o, s, z, side, paint, N) {
    var ca = chordAt(o, s), qc = o.qc - (o.sweep || 0) * s * o.semi, mid = qc - 0.25 * ca.c, y0 = o.y + s * o.semi * (o.dih || 0), r = [];
    if (o.tip_ === 'ellipse') mid = o.qc - 0.25 * o.root + (0.5 * o.root - 0.5 * ca.c) * 0.35; // elliptical: LE curves back, TE straighter
    for (var j = 0; j < N; j++) {
      var th = j / N * 2 * PI, u = Math.cos(th), sn = Math.sin(th);
      var y = ca.t * 0.5 * sn * (0.6 + 0.4 * u) * (sn < 0 ? 0.65 : 1);
      var x = mid + ca.c * 0.5 * u, hex = sn > 0.05 || (u > 0.85 && sn > -0.2) ? paint.top : paint.belly;
      r.push([x, y0 + y, side * z, hex]);
    }
    return r;
  }
  function surface(o, side, paint, inset, lo, NS) {
    var rings = [], N = lo ? 10 : 14, cut = o.tip_ === 'cut';
    NS = NS || (lo ? 7 : 11);
    rings.push(airfoil(o, 0, -(inset || 0), side, paint, N));
    for (var i = 0; i <= NS; i++) { var s = cut ? i / NS : 1 - Math.pow(1 - i / NS, 1.25); rings.push(airfoil(o, s, s * o.semi, side, paint, N)); }
    return tube(rings, true, cut);
  }
  // gull wing -> { inner, outer, kz, ky }: two straight panels (y = 0 at the root) and the knee offset from the root
  function gullPanels(wo) {
    var kz = wo.semi * wo.gull, kc = wo.root + (wo.tip - wo.root) * wo.gull, sw = wo.sweep || 0;
    return { kz: kz, ky: kz * wo.anh,
      inner: { qc: wo.qc, y: 0, root: wo.root, tip: kc, semi: kz, dih: wo.anh, sweep: sw, tip_: 'cut', t: wo.t },
      outer: { qc: wo.qc - sw * kz, y: 0, root: kc, tip: wo.tip, semi: wo.semi - kz, dih: wo.dih, sweep: sw, tip_: wo.tip_, t: wo.t } };
  }
  function meshOf(p, geo, x, y, z) { var o = new THREE.Mesh(geo, M._mat(0xffffff)); o.position.set(x || 0, y || 0, z || 0); p.add(o); return o; }

  // ---- bake a temp group into one geometry (vertex colour = paint x AO) ----
  var _inv = new THREE.Matrix4(), _mw = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _v = new THREE.Vector3();
  function bake(root) {
    root.updateMatrixWorld(true); _inv.copy(root.matrixWorld).invert();
    var p = [], n = [], c = [];
    root.traverse(function (o) {
      if (!o.isMesh) return;
      var g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, ix = g.index, mc = o.material.color;
      _mw.multiplyMatrices(_inv, o.matrixWorld); _nm.getNormalMatrix(_mw);
      var flip = _mw.determinant() < 0, cnt = ix ? ix.count : pa.count;
      for (var k = 0; k < cnt; k++) {
        var kk = flip ? (k % 3 === 1 ? k + 1 : k % 3 === 2 ? k - 1 : k) : k, vi = ix ? ix.getX(kk) : kk;
        _v.fromBufferAttribute(pa, vi).applyMatrix4(_mw); p.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(na, vi).applyMatrix3(_nm).normalize(); n.push(_v.x, _v.y, _v.z);
        c.push(mc.r * (ca ? ca.getX(vi) : 1), mc.g * (ca ? ca.getY(vi) : 1), mc.b * (ca ? ca.getZ(vi) : 1));
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  var starGeo = null, hexGeo = null;
  function star() {
    if (starGeo) return starGeo;
    var s = new THREE.Shape(), r1 = 0.5, r2 = 0.2;
    for (var i = 0; i < 10; i++) {
      var a = PI / 2 + i * PI / 5, r = i % 2 ? r2 : r1;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    starGeo = new THREE.ShapeGeometry(s); starGeo.rotateX(-PI / 2); M._whiten(starGeo);
    return starGeo;
  }
  function hexDot() { // tiny flat hexagon facing +y (flap perforations)
    if (!hexGeo) { hexGeo = new THREE.CircleGeometry(0.5, 6); hexGeo.rotateX(-PI / 2); M._whiten(hexGeo); }
    return hexGeo;
  }
  var circGeo = null;
  function flat(p, hex, r, y) { // flat round decal facing +y (16 tris)
    if (!circGeo) { circGeo = new THREE.CircleGeometry(0.5, 18); circGeo.rotateX(-PI / 2); M._whiten(circGeo); }
    var o = new THREE.Mesh(circGeo, M._mat(hex)); o.scale.set(r * 2, 1, r * 2); o.position.y = y; p.add(o); return o;
  }
  // national marking lying in the local xz plane facing +y (or -y when down). P.bars: star-and-bar; sl = fuselage
  // taper (outward rise per unit x) that the bars follow, or null on a wing (star points forward, bars spanwise)
  function mark(p, P, nat, r, x, y, z, down, tilt, sl) {
    var g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = tilt || 0; if (down) g.rotation.x += PI; p.add(g);
    if (P.bars && sl == null) g.rotation.y = -PI / 2;
    if (nat === 'IJN') {
      if (P.top !== 0xcac6b0) flat(g, C().white, r * 1.18, 0);
      flat(g, C().red, r, 0.004);
    } else {
      if (P.bars) [-1, 1].forEach(function (k) {
        M._bar(g, C().white, r * 0.9, 0.004, r * 0.56, k * r * 1.25, k * r * 1.25 * (sl || 0) - 0.003, 0).rotation.z = Math.atan(sl || 0);
      });
      flat(g, 0x2f4a78, r, 0);
      var st = new THREE.Mesh(star(), M._mat(C().white)); st.scale.set(r * 1.9, 1, r * 1.9); st.position.y = 0.004; g.add(st);
    }
    return g;
  }
  function C() { return M._C; }

  // ---- templates (built once per kind+nation) ----
  var TPL = {}, DISC = {}, discGeoCache = {};
  function discMat(nat, tipHex) {
    if (DISC[nat]) return DISC[nat];
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var x = cv.getContext('2d'), tc = new THREE.Color(tipHex), ts = 'rgba(' + (tc.r * 255 | 0) + ',' + (tc.g * 255 | 0) + ',' + (tc.b * 255 | 0) + ',';
    var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(60,62,66,0.55)'); gr.addColorStop(0.2, 'rgba(60,62,66,0.3)'); gr.addColorStop(0.72, 'rgba(70,72,76,0.22)');
    gr.addColorStop(0.8, ts + '0.5)'); gr.addColorStop(0.92, ts + '0.4)'); gr.addColorStop(1, ts + '0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(cv);
    return (DISC[nat] = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  }

  function template(kind, nat) {
    var key = kind + '|' + nat;
    if (TPL[key]) return TPL[key];
    var T = TYPES[key] || TYPES['fighter|' + nat] || TYPES['fighter|USN'], P = PAINT[key] || US;
    var st = smooth(T.body, 3), nose = T.body[T.body.length - 1], tail = T.body[0], J = nat === 'IJN';
    var hwAt = function (x) { for (var i = 1; i < st.length; i++) if (st[i][0] >= x) return st[i]; return st[st.length - 1]; };
    // body
    var b = new THREE.Group();
    meshOf(b, tube(bodyRings(st, 16, 2.3, function (s, sn, c, i) {
      if (s[0] > T.cowlX) return i === st.length - 1 ? P.lip : P.cowl;
      return twoTone(P.top, P.belly)(s, sn);
    }), true, P.lip));
    var cp = T.canopy, top = hwAt((cp.x0 + cp.x1) / 2), cy = top[3] + top[2] - cp.h * 0.45, cst = [];
    for (var i = 0; i <= 24; i++) {
      var u = i / 24, f = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), 3.2)), 0.35), fx = cp.x0 + (cp.x1 - cp.x0) * u;
      var hb = hwAt(fx);
      cst.push([fx, cp.w * f + 0.004, cp.h * f + 0.004, Math.max(cy, hb[3] + hb[2] - cp.h * 0.55)]);
    }
    meshOf(b, tube(bodyRings(cst, 10, 2.2, function (s, sn, c, i) {
      var fu = i / 24 * (cp.frames + 1);
      if (Math.abs(fu - Math.round(fu)) * 24 / (cp.frames + 1) < 0.5) return P.top;   // body-coloured frames
      return sn > 0.96 ? 0x9cc0d8 : sn < 0.15 ? P.top : P.glass;           // sky-reflection stripe on top, sill below
    }), false, false));
    var hasSpine = cp.x1 - cp.x0 > 0.9; // two/three-seaters: a frame rail along the greenhouse
    if (hasSpine) M._bar(b, P.frame, cp.x1 - cp.x0 - 0.1, 0.02, 0.02, (cp.x0 + cp.x1) / 2, cy + cp.h - 0.012, 0);
    M._sph(b, P.spin, 0.3, nose[2] * 1.05, nose[2] * 1.05, nose[0] + 0.02, nose[3], 0);                   // spinner
    // tailplane (both sides) and fin
    meshOf(b, surface(T.tail, 1, P, 0.05, true)); meshOf(b, surface(T.tail, -1, P, 0.05, true));
    var fin = surface(Object.assign({}, T.fin, { y: 0, dih: 0 }), 1, { top: P.top, belly: P.top }, 0.05, true);
    fin.rotateX(-PI / 2); fin.translate(0, T.fin.y, 0); meshOf(b, fin);
    // exhaust stubs, Val spats
    var ch = hwAt(T.exhX);
    [-1, 1].forEach(function (k) {
      M._xc(b, P.lip, 0.03, 0.12, T.exhX - 0.04, ch[3] - ch[2] * 0.35, k * (ch[1] + 0.005));
      if (T.spats) {
        var sx = T.wing.qc - 0.02, sz = k * 0.62;
        M._bar(b, P.top, 0.08, 0.38, 0.05, sx, -0.62, sz).rotation.x = k * 0.12;
        meshOf(b, tube(bodyRings(smooth([[sx - 0.3, 0.02, 0.04, -0.6], [sx - 0.12, 0.08, 0.15, -0.6], [sx + 0.08, 0.08, 0.16, -0.62], [sx + 0.18, 0.04, 0.08, -0.64]], 3), 10, 2.2, twoTone(P.top, P.belly)), true, true), 0, 0, sz);
      }
      // fuselage roundel/hinomaru, behind the wing
      var mx = T.markX || (J ? -0.48 : -0.42), ms = hwAt(mx), sl = (hwAt(mx + 0.2)[1] - hwAt(mx - 0.2)[1]) / 0.4;
      mark(b, P, nat, J ? 0.13 : T.markX ? 0.13 : 0.15, mx, ms[3] + 0.02, k * (ms[1] + 0.012), false, k * PI / 2, sl);
    });
    // wings: wingL / wingR are built from z = 0 outward at their pivot (the root, or the knee of a gull wing)
    var wo = T.wing, rootS = hwAt(wo.qc), z0 = Math.max(0.12, Math.min(rootS[1] * 0.9, wo.z0));
    var G = wo.gull ? gullPanels(wo) : null, wp = G ? G.outer : Object.assign({}, wo, { y: 0 });
    if (G) [-1, 1].forEach(function (k) {   // gull inner panels stay on the body; oil-cooler slots in their leading edges
      meshOf(b, surface(G.inner, k, P, wo.z0 * 0.9, false, 5), 0, wo.y, k * z0);
      if (!T.inlets) return;
      var ln = new THREE.Group(), ic = chordAt(G.inner, 0.32);
      ln.position.set(G.inner.qc + 0.25 * ic.c - (G.inner.sweep || 0) * 0.32 * G.kz - 0.004, wo.y + 0.32 * G.ky + ic.t * 0.04, k * (z0 + 0.32 * G.kz));
      ln.rotation.x = k * Math.atan(-wo.anh); b.add(ln);
      M._bar(ln, P.lip, 0.03, ic.t * 0.3, G.kz * 0.42, 0, 0, 0);
    });
    var tpl = { name: T.name, body: bake(b), wings: [], flaps: [], fx: {} };
    [-1, 1].forEach(function (k) {
      var w = new THREE.Group();
      meshOf(w, surface(wp, k, P, G ? 0.04 : wo.z0 * 0.9));
      var s = G ? 0.44 : 0.58, ca = chordAt(wp, s), qx = wp.qc - (wp.sweep || 0) * s * wp.semi, mzz = s * wp.semi, my = mzz * (wp.dih || 0);
      var mr = Math.min(P.bars ? 0.19 : 0.24, ca.c * 0.36), tilt = -k * Math.atan(wp.dih || 0);
      mark(w, P, nat, mr, qx - 0.12 * ca.c, my + ca.t * 0.4 + 0.006, k * mzz, false, tilt);
      mark(w, P, nat, mr, qx - 0.12 * ca.c, my - ca.t * 0.26 - 0.006, k * mzz, true, tilt);
      tpl.wings.push({ geo: bake(w), pos: G ? [0, wo.y + G.ky, k * (z0 + G.kz)] : [0, wo.y, k * z0] });
      var tc = chordAt(wp, 0.97);
      tpl.fx[k < 0 ? 'tipL' : 'tipR'] = new THREE.Vector3(wp.qc - (wp.sweep || 0) * 0.97 * wp.semi - 0.25 * tc.c, 0.97 * wp.semi * (wp.dih || 0), k * 0.97 * wp.semi);
      // dive brakes: parts live in the wing group (fold / detach with it)
      if (T.brakes === 'split') {
        var fc = 0.24, span = wo.semi * 0.62, te = wo.qc - 0.75 * wo.root, hx = te + fc, rc = chordAt(wo, 0.2);
        [1, -1].forEach(function (ud) { // upper flap opens up, lower flap opens down
          var f = new THREE.Group();
          M._bar(f, P.top, fc, 0.022, span, -fc / 2, -0.011, k * span / 2);
          for (var a = 0; a < 2; a++) for (var c = 0; c < 8; c++) {
            var hx2 = -fc * (0.3 + a * 0.36), hz = k * span * (0.07 + c * 0.123);
            var d = new THREE.Mesh(hexDot(), M._mat(0x2a2e34)); d.scale.setScalar(0.05); d.position.set(hx2, 0.0125 * ud, hz); if (ud < 0) d.rotation.x = PI; f.add(d);
            var d2 = d.clone(); d2.position.y = -0.0125 * ud; d2.rotation.x = ud < 0 ? 0 : PI; f.add(d2);
          }
          var slope = Math.atan2(rc.t * 0.5 * 0.4 * (ud > 0 ? 1 : 0.65), fc);
          tpl.flaps.push({ wing: k, geo: bake(f), pos: [hx, ud * rc.t * 0.2, 0], tilt: -k * Math.atan(wo.dih || 0),
            a0: ud > 0 ? slope : -slope, a1: ud > 0 ? -1.05 : 1.05 });
        });
      } else if (T.brakes === 'slat') {
        var f2 = new THREE.Group(), sp2 = wo.semi * 0.3, s0 = 0.36;
        M._bar(f2, P.belly, 0.12, 0.018, sp2, -0.06, -0.009, k * sp2 / 2);
        var c0 = chordAt(wo, s0);
        tpl.flaps.push({ wing: k, geo: bake(f2), pos: [wo.qc - 0.05, s0 * wo.semi * (wo.dih || 0) - c0.t * 0.3, k * s0 * wo.semi], tilt: -k * Math.atan(wo.dih || 0), a0: 0, a1: 1.45 });
      }
    });
    // payload
    var pl = new THREE.Group(), by = T.wing.y - 0.24;
    if (T.torpedo) {
      meshOf(pl, tube(bodyRings(smooth([[-0.62, 0.02, 0.02, 0], [-0.5, 0.08, 0.08, 0], [0.4, 0.09, 0.09, 0], [0.58, 0.06, 0.06, 0], [0.64, 0.01, 0.01, 0]], 3), 10, 2, function () { return J ? 0x7a7e80 : 0x8a9098; }), true, true));
      M._bar(pl, 0x4a4e54, 0.12, 0.012, 0.22, -0.56, -0.006, 0); M._bar(pl, 0x4a4e54, 0.12, 0.22, 0.012, -0.56, -0.11, 0);
      tpl.payload = { geo: bake(pl), pos: [0.05, by - 0.06, 0] };
    } else if (T.bomb) {
      meshOf(pl, tube(bodyRings(smooth([[-0.36, 0.03, 0.03, 0], [-0.2, 0.08, 0.08, 0], [0.12, 0.1, 0.1, 0], [0.26, 0.06, 0.06, 0], [0.3, 0.01, 0.01, 0]], 3), 10, 2, function () { return 0x585e66; }), true, true));
      M._bar(pl, 0x4a4e54, 0.12, 0.012, 0.2, -0.32, -0.006, 0); M._bar(pl, 0x4a4e54, 0.12, 0.2, 0.012, -0.32, -0.1, 0);
      M._bar(pl, 0x4a4e54, 0.04, 0.12, 0.03, 0.0, 0.06, 0);    // crutch / rack
      tpl.payload = { geo: bake(pl), pos: [T.wing.qc - 0.15, by, 0] };
    }
    // propeller: 3 blades with painted tips + translucent disc for the blurred state
    var pr = new THREE.Group(), R = T.prop || 0.5;
    for (var bl = 0; bl < 3; bl++) {
      var arm = new THREE.Group(); arm.rotation.x = bl * 2 * PI / 3; pr.add(arm);
      var bb = M._bar(arm, P.blade, 0.04, R - 0.14, 0.13, 0, 0.06, 0); bb.rotation.x = 0.25;
      M._bar(arm, P.tip, 0.042, 0.1, 0.12, 0, R - 0.12, 0).rotation.x = 0.25;
    }
    tpl.blades = bake(pr);
    tpl.prop = [nose[0] + 0.1, nose[3], 0]; tpl.R = R;
    if (!discGeoCache[R]) { var dg = new THREE.CircleGeometry(R, 24); dg.rotateY(PI / 2); discGeoCache[R] = dg; }
    tpl.disc = discGeoCache[R]; tpl.discMat = discMat(nat, P.tip);
    tpl.fx.exh = [new THREE.Vector3(T.exhX - 0.1, ch[3] - ch[2] * 0.35, -(ch[1] + 0.03)), new THREE.Vector3(T.exhX - 0.1, ch[3] - ch[2] * 0.35, ch[1] + 0.03)];
    tpl.fx.canopy = new THREE.Vector3((cp.x0 + cp.x1) / 2 + 0.1, cy + cp.h, 0);
    return (TPL[key] = tpl);
  }

  // brakes.set(a): 0 = closed, 1 = fully open (shared function, no per-plane closures)
  function setBrakes(a) {
    this.open = a;
    for (var i = 0; i < this.parts.length; i++) { var p = this.parts[i]; p.pivot.rotation.z = p.a0 + (p.a1 - p.a0) * a; }
  }

  // buildPlane(kind, nation) -> { group, prop, payload, wingL, wingR, brakes, blades, disc, fx, name }
  //   wingL (-z, port) / wingR (+z, starboard): Groups at the wing roots (Corsair: at the gull knee, outer panels only). Fold up: wingL.rotation.x = +a, wingR.rotation.x = -a.
  //   brakes: null or { open, parts, set(a) }; prop spins about local x; payload: bomb / torpedo mesh or null.
  function buildPlane(kind, nationId) {
    M = WW.models; soft = M._soft;
    var nat = M._nation(nationId).id, t = template(kind, nat), mat = M._mat(0xffffff);
    var g = new THREE.Group(), body = new THREE.Mesh(t.body, mat); g.add(body);
    var wings = t.wings.map(function (w) {
      var wg = new THREE.Group(); wg.position.fromArray(w.pos); wg.add(new THREE.Mesh(w.geo, mat)); g.add(wg);
      wg.userData.home = w.pos.slice();
      return wg;
    });
    var brakes = null;
    if (t.flaps.length) {
      brakes = { open: 0, parts: [], set: setBrakes };
      t.flaps.forEach(function (f) {
        var hinge = new THREE.Group(), pv = new THREE.Group();
        hinge.rotation.x = f.tilt; hinge.position.fromArray(f.pos);
        pv.add(new THREE.Mesh(f.geo, mat)); hinge.add(pv); (f.wing < 0 ? wings[0] : wings[1]).add(hinge);
        brakes.parts.push({ pivot: pv, a0: f.a0, a1: f.a1 });
      });
      brakes.set(0);
    }
    var payload = null;
    if (t.payload) { payload = new THREE.Mesh(t.payload.geo, mat); payload.position.fromArray(t.payload.pos); g.add(payload); }
    var prop = new THREE.Group(); prop.position.fromArray(t.prop); g.add(prop);
    var blades = new THREE.Mesh(t.blades, mat); prop.add(blades);
    var disc = new THREE.Mesh(t.disc, t.discMat); disc.visible = false; disc.renderOrder = 5; prop.add(disc);
    if (M._shadows) M._shadows(g, false);
    disc.castShadow = false;
    return { group: g, prop: prop, payload: payload, wingL: wings[0], wingR: wings[1], brakes: brakes,
      blades: blades, disc: disc, fx: t.fx, name: t.name };
  }
  if (WW.models) { WW.models.buildPlane = buildPlane; WW.models.PLANE_TYPES = TYPES;   // _planeKit: the lofting kit (models_flyingboats.js)
    WW.models._planeKit = { tube: tube, bodyRings: bodyRings, smooth: smooth, surface: surface, chordAt: chordAt, bake: bake, mark: mark, meshOf: meshOf, twoTone: twoTone, discMat: discMat, init: function () { M = WW.models; soft = M._soft; } }; }
  else console.error('models_planes.js must load after models.js');
})();
