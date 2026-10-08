// models_detail.js (owner B) - 1:700-miniature fine detail for ships + static-mesh merging.
// Load after models.js. Hooks WW.models._finish(type, palette, ship), called by buildShip.
// All static (non-rotating, shared-material) meshes of a ship are merged into one mesh per material,
// cached per type+nation, so the extra detail costs almost no draw calls. Turret internals are merged
// per turret (turret obj stays a separate, rotatable object). Per-instance hullMats meshes are untouched.
window.WW = window.WW || {};
(function () {
  'use strict';
  var M, C, G2 = null;
  function g2() {
    if (G2) return G2;
    G2 = { c6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6), x6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6), s8: new THREE.SphereGeometry(0.5, 8, 6) };
    G2.c6.translate(0, 0.5, 0); G2.x6.rotateZ(-Math.PI / 2);
    for (var k in G2) WW.models._whiten(G2[k]);
    return G2;
  }
  // tiny parts: low-poly cylinder (bottom-based), cylinder along x (centred), low-poly ellipsoid, plain box (bottom-based)
  function c6(p, m, r, h, x, y, z) { return M._mesh(p, g2().c6, m, r * 2, h, r * 2, x, y, z); }
  function x6(p, m, r, len, x, y, z) { return M._mesh(p, g2().x6, m, len, r * 2, r * 2, x, y, z); }
  function s8(p, m, sx, sy, sz, x, y, z) { return M._mesh(p, g2().s8, m, sx, sy, sz, x, y, z); }
  function bx(p, m, w, h, d, x, y, z) { return M._bar(p, m, w, h, d, x, y, z); }
  function shade(hex, k) { return new THREE.Color(hex).multiplyScalar(k).getHex(); }

  var RAIL = 0xd8d2c4, BOAT = 0xe4dccb, LENS = 0xf4e2b0;

  // ---- detail parts ----
  // AA gun tub with 2 or 4 tiny barrels pointing outboard-up
  function aaTub(g, P, x, y, z, quad, ang) {
    var t = new THREE.Group(); t.position.set(x, y, z); t.rotation.y = ang || 0; g.add(t);
    c6(t, P.super, 0.27, 0.16, 0, 0, 0);
    bx(t, P.gun, 0.2, 0.14, 0.24, -0.02, 0.12, 0);
    var n = quad ? 4 : 2;
    for (var i = 0; i < n; i++) {
      var b = x6(t, P.gun, 0.025, 0.5, 0.26, 0.24, (i - (n - 1) / 2) * 0.07); b.rotation.z = 0.35;
    }
    return t;
  }
  function searchlight(g, x, y, z) {
    c6(g, C.dark, 0.05, 0.1, x, y, z);
    x6(g, C.white, 0.11, 0.16, x, y + 0.18, z);
    x6(g, LENS, 0.085, 0.02, x + 0.09, y + 0.18, z);
  }
  function lifeboat(g, x, y, z) {
    bx(g, C.dark, 0.04, 0.16, 0.04, x - 0.22, y, z); bx(g, C.dark, 0.04, 0.16, 0.04, x + 0.22, y, z); // davits
    s8(g, BOAT, 0.72, 0.18, 0.24, x, y + 0.14, z);
  }
  function vent(g, P, x, y, z) { c6(g, P.super, 0.08, 0.22, x, y, z); s8(g, C.dark, 0.17, 0.08, 0.17, x, y + 0.24, z); }
  function rangefinder(g, P, x, y, z, w) {
    bx(g, P.super, 0.28, 0.16, 0.28, x, y, z);
    x6(g, C.dark, 0.05, w, x, y + 0.1, z).rotation.y = Math.PI / 2;
    s8(g, C.dark, 0.1, 0.1, 0.1, x, y + 0.1, z + w / 2); s8(g, C.dark, 0.1, 0.1, 0.1, x, y + 0.1, z - w / 2);
  }
  function radar(g, x, y, z, w) {
    c6(g, C.dark, 0.03, 0.2, x, y, z);
    bx(g, C.dark, 0.04, w * 0.42, w * 0.75, x, y + 0.18, z);
  }
  function floatplane(g, P, x, y, z, ry) {
    var f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = ry || 0; g.add(f);
    var col = P.id === 'IJN' ? 0x7a865c : 0x6f8cab;
    s8(f, col, 1.0, 0.2, 0.2, 0, 0.32, 0);
    bx(f, col, 0.28, 0.04, 1.3, 0.08, 0.36, 0);
    bx(f, col, 0.2, 0.22, 0.03, -0.45, 0.3, 0);
    s8(f, C.white, 0.75, 0.12, 0.14, 0.05, 0.08, 0);                  // float
    bx(f, C.dark, 0.03, 0.18, 0.03, 0.05, 0.1, 0);
    s8(f, C.dark, 0.06, 0.32, 0.06, 0.52, 0.32, 0);                   // prop
  }
  function catapult(g, x, y, z, len, ry) {
    var c = bx(g, C.dark, len, 0.08, 0.16, x, y, z); c.rotation.y = ry || 0;
  }
  function crane(g, P, x, y, z, ry) {
    c6(g, P.super, 0.09, 0.9, x, y, z);
    var j = bx(g, C.dark, 1.2, 0.05, 0.05, x + 0.45 * Math.cos(ry), y + 0.95, z - 0.45 * Math.sin(ry)); j.rotation.set(0, ry, 0.45);
  }
  function flagstaff(g, P, x, y, h) {
    c6(g, C.dark, 0.025, h, x, y, 0);
    var fy = y + h - 0.3;
    if (P.id === 'IJN') { bx(g, C.white, 0.42, 0.28, 0.02, x - 0.22, fy, 0); x6(g, C.red, 0.08, 0.03, x - 0.22, fy + 0.14, 0).rotation.y = Math.PI / 2; }
    else { bx(g, P.accent, 0.42, 0.28, 0.02, x - 0.22, fy, 0); bx(g, C.red, 0.26, 0.1, 0.025, x - 0.3, fy, 0); }
  }
  // deck-edge gunwale lip following the hull outline, from u0 to u1
  function rail(g, H, u0, u1, n, y0) {
    for (var sd = -1; sd <= 1; sd += 2) {
      var a = M._hullAt.apply(null, H.concat(u0));
      for (var i = 1; i <= n; i++) {
        var b = M._hullAt.apply(null, H.concat(u0 + (u1 - u0) * i / n));
        var ax = a.x, az = sd * a.w * 1.04, bxx = b.x, bz = sd * b.w * 1.04, dx = bxx - ax, dz = bz - az;
        var hl = Math.sqrt(dx * dx + dz * dz), dy = y0 == null ? b.yt - a.yt : 0;
        var th = Math.min(1, H[0] / 12), r = bx(g, RAIL, Math.sqrt(hl * hl + dy * dy) + 0.03, 0.09 * th, 0.05 * th, (ax + bxx) / 2, (y0 == null ? (a.yt + b.yt) / 2 : y0) - 0.02, (az + bz) / 2);
        r.rotation.order = 'YZX'; r.rotation.set(0, -Math.atan2(dz, dx), Math.atan2(dy, hl));
        a = b;
      }
    }
  }
  function anchors(g, H) {
    var a = M._hullAt.apply(null, H.concat(0.9));
    for (var sd = -1; sd <= 1; sd += 2) {
      var o = bx(g, C.dark, 0.26, 0.24, 0.05, a.x, a.yt - 0.42, sd * (a.w + 0.04)); o.rotation.y = -sd * 0.35;
      s8(g, C.dark, 0.12, 0.1, 0.06, a.x + 0.1, a.yt - 0.12, sd * (a.w + 0.03));
    }
  }
  function planks(g, P, H, zs, u0, u1) {
    var a = M._hullAt.apply(null, H.concat(u0)), b = M._hullAt.apply(null, H.concat(u1)), pc = shade(P.deck, 0.86);
    zs.forEach(function (z) { bx(g, pc, b.x - a.x, 0.012, 0.035, (a.x + b.x) / 2, H[2], z); });
  }
  function common(g, P, H, flagH) {
    rail(g, H, 0.015, 0.985, 18);
    anchors(g, H);
    var st = M._hullAt.apply(null, H.concat(0.01));
    flagstaff(g, P, st.x + 0.15, st.yt, flagH);
  }
  function both(fn) { fn(1); fn(-1); }

  // ---- per-type detail ----
  var DET = {};
  DET.battleship = function (s, P, H, isJ) {
    var g = s.group, D = H[2];
    common(g, P, H, 1.2);
    planks(g, P, H, [-1.75, -1.55, 1.55, 1.75], 0.12, 0.66);
    both(function (k) {
      [-4.2, -1.9, 0.4, 2.7].forEach(function (x, i) { aaTub(g, P, x, D, k * 1.64, i % 2 === 0, k > 0 ? -Math.PI / 2 : Math.PI / 2); });
      lifeboat(g, -1.75, D + 0.8, k * 1.02);
      vent(g, P, -3.0, D + 0.8, k * 0.55);
      searchlight(g, isJ ? -0.6 + 0.9 : -0.9 + 0.95, D + 0.8, k * 0.75);
    });
    catapult(g, -10.6, D, 0.7, 1.9, 0.25);
    floatplane(g, P, -10.7, D + 0.08, -0.65, 0.25);
    crane(g, P, -11.3, D, 1.1, 0.8);
    if (isJ) {
      rangefinder(g, P, 1.7, D + 0.8 + 3.94, 0, 2.0);
      radar(g, -5.5, D + 2.4, 0, 0.7);
      both(function (k) { searchlight(g, 0.6, D + 2.5, k * 0.55); });
    } else {
      rangefinder(g, P, 2.6, D + 2.8, 0, 1.6);
      radar(g, 2.0, D + 2.8 + 2.6 + 0.08, 0, 1.0);
      radar(g, -4.6, D + 0.9 + 1.8 + 0.08, 0, 0.6);
    }
  };
  DET.cruiser = function (s, P, H, isJ) {
    var g = s.group, D = H[2];
    common(g, P, H, 1.0);
    planks(g, P, H, [-1.15, 1.15], 0.12, 0.66);
    both(function (k) {
      aaTub(g, P, -3.2, D + 0.6, k * 0.72, true, k > 0 ? -Math.PI / 2 : Math.PI / 2);
      aaTub(g, P, -0.9, D + 0.6, k * 0.76, false, k > 0 ? -Math.PI / 2 : Math.PI / 2);
      lifeboat(g, 0.1, D, k * 1.15);
      searchlight(g, -2.4, D + 0.6, k * 0.62);
    });
    catapult(g, -4.7, D, 0, 1.6, 0.5);
    floatplane(g, P, -4.7, D + 0.08, 0, 0.5);
    crane(g, P, -5.3, D, -0.9, -0.6);
    if (isJ) { rangefinder(g, P, 1.45, D + 0.6 + 2.6, 0, 1.4); radar(g, -3.6, D + 2.4, 0, 0.5); }
    else { rangefinder(g, P, 2.1, D + 1.6, 0, 1.2); radar(g, 1.5, D + 1.6 + 2.0 + 0.08, 0, 0.8); }
  };
  DET.destroyer = function (s, P, H, isJ) {
    var g = s.group, D = H[2];
    common(g, P, H, 0.8);
    both(function (k) {
      aaTub(g, P, -0.2, D, k * 0.66, false, k > 0 ? -Math.PI / 2 : Math.PI / 2);
      for (var i = 0; i < 4; i++) x6(g, C.dark, 0.09, 0.16, -5.55 + i * 0.2, D + 0.09, k * 0.42);   // depth-charge rack
      bx(g, C.dark, 0.8, 0.04, 0.05, -5.25, D + 0.18, k * 0.42);
      var kg = c6(g, C.dark, 0.06, 0.22, -4.9, D, k * 0.66); kg.rotation.x = -k * 0.5;            // K-gun
      s8(g, C.dark, 0.14, 0.14, 0.14, -4.9, D + 0.24, k * 0.76);
    });
    x6(g, P.gun, 0.17, 1.4, -3.15, D + 0.2, 0);                       // second torpedo mount
    c6(g, P.super, 0.25, 0.12, -3.15, D, 0);
    searchlight(g, 2.0, D + 0.8, 0);
    radar(g, 1.6, D + 0.8 + 1.7, 0, 0.5);
  };
  DET.pt = function (s, P, H, isJ) {
    var g = s.group, D = H[2];
    rail(g, H, 0.4, 0.97, 8);
    bx(g, C.glass, 0.04, 0.16, 0.7, 1.08, D + 0.45, 0);                // windshield
    c6(g, C.dark, 0.025, 0.7, 0.3, D + 0.45, 0);                        // little mast
    radar(g, 0.3, D + 1.12, 0, 0.25);
    aaTub(g, P, 1.4, D, 0, false, 0);
    flagstaff(g, P, -2.35, D, 0.6);
  };
  DET.carrier = function (s, P, H, isJ) {
    var g = s.group, top = 1.99, FD = 1.75;
    var pc = shade(P.deck, 0.88);
    [-2.1, -1.4, -0.7, 0.7, 1.4, 2.1].forEach(function (z) { bx(g, pc, 25.8, 0.008, 0.035, -0.4, top, z); }); // planking
    for (var i = 0; i < 6; i++) bx(g, RAIL, 0.04, 0.012, 4.4, -11.6 + i * 0.55, top, 0);             // arresting wires
    both(function (k) {
      [-9.5, -4.5, 5.5].forEach(function (x, j) {
        bx(g, P.super, 1.6, 0.1, 0.5, x, FD - 0.25, k * 2.72);                                          // gallery
        aaTub(g, P, x - 0.3 + j * 0.1, FD - 0.15, k * 2.75, j !== 1, k > 0 ? -Math.PI / 2 : Math.PI / 2);
      });
      lifeboat(g, -2.0, 1.2, k * 1.95);
    });
    rail(g, H, 0.015, 0.985, 18, H[2]);
    anchors(g, H);
    if (isJ) { radar(g, 3.8, top + 2.5, -2.0, 0.5); searchlight(g, 4.6, top + 1.0, -2.0); }
    else {
      radar(g, 2.0, top + 2.05 + 1.7 + 0.08, 2.1, 0.9);
      rangefinder(g, P, 3.0, top + 2.05, 2.1, 0.9);
      searchlight(g, 0.4, top + 1.3, 2.55);
    }
  };
  DET.submarine = function (s, P, H, isJ) {
    var g = s.group, D = H[2], tm = s.hullMats[0];                     // all fade with the hull when submerged
    both(function (k) { M._mesh(g, g2().x6, tm, 5.6, 0.04, 0.04, -0.6, D + 0.24, k * 0.27); });   // casing rails
    M._mesh(g, g2().s8, tm, 0.12, 0.12, 0.12, 0.9, D + 1.9, 0);       // periscope heads
    M._mesh(g, g2().s8, tm, 0.1, 0.1, 0.1, 0.4, D + 1.7, 0);
    M._mesh(g, g2().c6, tm, 0.24, 0.22, 0.04, 2.15, D + 0.2, 0);       // gun shield
  };

  // ---- static merge ----
  var cache = {}, _nm = new THREE.Matrix3(), _inv = new THREE.Matrix4(), _mw = new THREE.Matrix4(), _v = new THREE.Vector3();
  function collect(root, skip, keep) {
    var list = [];
    (function walk(o) {
      for (var i = 0; i < o.children.length; i++) {
        var c = o.children[i];
        if (skip.indexOf(c) >= 0) continue;
        if (c.isMesh && !Array.isArray(c.material) && keep.indexOf(c.material) < 0) list.push(c);
        walk(c);
      }
    })(root);
    return list;
  }
  // aoBase: local height of the surface parts stand on (deck); vertices near it get a soft contact-shadow darkening
  function buildMerged(root, list, aoBase) {
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    var byMat = {}, order = [];
    list.forEach(function (c) {
      var id = c.material.uuid;
      if (!byMat[id]) { byMat[id] = { mat: c.material, p: [], n: [], c: [] }; order.push(id); }
      var e = byMat[id], geo = c.geometry, pa = geo.attributes.position, na = geo.attributes.normal, ix = geo.index, cl = geo.attributes.color;
      _mw.multiplyMatrices(_inv, c.matrixWorld); _nm.getNormalMatrix(_mw);
      var cnt = ix ? ix.count : pa.count;
      for (var k = 0; k < cnt; k++) {
        var vi = ix ? ix.getX(k) : k;
        _v.fromBufferAttribute(pa, vi).applyMatrix4(_mw); e.p.push(_v.x, _v.y, _v.z);
        var ao = 1;
        if (aoBase != null) { var h = Math.max(0, Math.min(1, (_v.y - aoBase) / 0.5)); ao = 0.8 + 0.2 * h * h * (3 - 2 * h); }
        var cv = cl ? cl.getX(vi) : 1; e.c.push(ao * cv, ao * cv, ao * cv);
        _v.fromBufferAttribute(na, vi).applyMatrix3(_nm).normalize(); e.n.push(_v.x, _v.y, _v.z);
      }
    });
    return order.map(function (id) {
      var e = byMat[id], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(e.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(e.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(e.c, 3));
      g.computeBoundingSphere();
      return { mat: e.mat, geo: g };
    });
  }
  function merge(root, key, skip, keep, aoBase) {
    var list = collect(root, skip, keep);
    if (list.length < 2) return;
    var m = cache[key] || (cache[key] = buildMerged(root, list, aoBase));
    list.forEach(function (c) { c.parent.remove(c); });
    m.forEach(function (e) { root.add(new THREE.Mesh(e.geo, e.mat)); });
  }

  function finish(type, P, s) {
    M = WW.models; C = M._C;
    var H = s._hg, fn = DET[type];
    if (fn && H) fn(s, P, H, P.id === 'IJN');
    var key = type + '|' + P.id, tobjs = s.turrets.map(function (t) { return t.obj; });
    s.turrets.forEach(function (t, i) { merge(t.obj, key + '|t' + i, [], s.hullMats, 0); });
    merge(s.group, key, tobjs, s.hullMats, H ? H[2] : 0);
  }
  if (WW.models) { WW.models._finish = finish; WW.models._merge = merge; }
  else console.error('models_detail.js must load after models.js');
})();
