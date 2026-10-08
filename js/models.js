// models.js (owner B) - soft toon "toy" ship models. Planes are in models_planes.js.
// Shared MeshToonMaterial (3-step gradient), lofted hull with sheer + rounded bilge, rounded-box superstructure.
window.WW = window.WW || {};
(function () {
  'use strict';
  // Art palette (soft, desaturated pastels). Nation ids still come from WW.NATIONS.
  var PAL = {
    USN: { id: 'USN', hull: 0x7f94aa, deck: 0xa98f70, super: 0x91a5ba, accent: 0x34507e, band: 0x2b3b58, gun: 0x525c68, mark: 'star' },
    IJN: { id: 'IJN', hull: 0x8a8670, deck: 0xa88d6a, super: 0xa49f84, accent: 0xc4524a, band: 0x8a3a32, gun: 0x57564c, mark: 'disc' }
  };
  var FB_GUNS = {
    carrier: ['small', 'small'], battleship: ['big', 'big', 'big', 'small', 'small'],
    cruiser: ['med', 'med', 'med'], destroyer: ['small', 'small'], submarine: [], pt: ['mg']
  };
  var C = { white: 0xefe8da, dark: 0x464b53, gun: 0x585e66, red: 0xd2564c, glass: 0x34465a, wood: 0x9a7650, line: 0x2b313a };

  function nation(n) { return PAL[n] || PAL.USN; }
  function gunCals(type) {
    var st = WW.SHIP_TYPES && WW.SHIP_TYPES[type];
    if (st && st.guns) {
      var out = [];
      st.guns.forEach(function (g) { for (var i = 0; i < g.count; i++) out.push(g.cal); });
      return out;
    }
    return (FB_GUNS[type] || []).slice();
  }

  // ---- shared toon material + caches ----
  var GRAD = null;
  function grad() {
    if (GRAD) return GRAD;
    // 5 gentle steps with a high floor (shadow side ~0.73 of lit) so the shading stays soft
    var d = new Uint8Array([170, 170, 170, 255, 188, 188, 188, 255, 204, 204, 204, 255, 218, 218, 218, 255, 232, 232, 232, 255]);
    GRAD = new THREE.DataTexture(d, 5, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.generateMipmaps = false; GRAD.needsUpdate = true;
    return GRAD;
  }
  // golden-hour pastel: every model colour is desaturated ~20% toward its luminance
  function soft(hex) {
    var c = new THREE.Color(hex), l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
    return c.lerp(new THREE.Color(l, l, l), 0.2);
  }
  // All model toon materials use vertex colours = baked AO (every shared geometry carries a white colour attribute).
  var matCache = {};
  function mat(color) {
    var m = matCache[color];
    if (!m) m = matCache[color] = new THREE.MeshToonMaterial({ color: soft(color), gradientMap: grad(), vertexColors: true });
    return m;
  }
  function whiten(g) {
    var n = g.attributes.position.count, a = new Float32Array(n * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  var outlineMat = null;
  function lineMat() {
    return outlineMat || (outlineMat = new THREE.MeshBasicMaterial({ color: C.line, side: THREE.BackSide }));
  }
  // unit box with rounded (chamfered, smooth-normal) edges, bottom at y=0
  function roundBox(r) {
    var g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), p = g.attributes.position, n = g.attributes.normal;
    var v = new THREE.Vector3(), c = new THREE.Vector3(), h = 0.5 - r;
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      c.set(Math.max(-h, Math.min(h, v.x)), Math.max(-h, Math.min(h, v.y)), Math.max(-h, Math.min(h, v.z)));
      v.sub(c).normalize(); n.setXYZ(i, v.x, v.y, v.z);
      v.multiplyScalar(r).add(c); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.translate(0, 0.5, 0);
    return g;
  }
  var G = null;
  function geo() {
    if (G) return G;
    G = {
      rbox: roundBox(0.22),
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      cone: new THREE.CylinderGeometry(0.43, 0.5, 1, 12),
      disc: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
      xcyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      sph: new THREE.SphereGeometry(0.5, 14, 10)
    };
    G.box.translate(0, 0.5, 0); G.cyl.translate(0, 0.5, 0); G.cone.translate(0, 0.5, 0); G.disc.translate(0, 0.5, 0);
    G.xcyl.rotateZ(-Math.PI / 2);
    for (var k in G) whiten(G[k]);
    return G;
  }
  function M(m) { return typeof m === 'number' ? mat(m) : m; }
  function mesh(p, g, m, sx, sy, sz, x, y, z) {
    var o = new THREE.Mesh(g, M(m));
    o.scale.set(sx, sy, sz); o.position.set(x || 0, y || 0, z || 0);
    p.add(o); return o;
  }
  // rounded box with bottom at y
  function box(p, m, w, h, d, x, y, z) { return mesh(p, geo().rbox, m, w, h, d, x, y, z); }
  // plain sharp box (thin details), bottom at y
  function bar(p, m, w, h, d, x, y, z) { return mesh(p, geo().box, m, w, h, d, x, y, z); }
  function cyl(p, m, r, h, x, y, z, rz) { return mesh(p, geo().cyl, m, r * 2, h, (rz || r) * 2, x, y, z); }
  function disc(p, m, r, h, x, y, z) { return mesh(p, geo().disc, m, r * 2, h, r * 2, x, y, z); }
  // cylinder along x, centred on (x,y,z)
  function xc(p, m, r, len, x, y, z) { return mesh(p, geo().xcyl, m, len, r * 2, r * 2, x, y, z); }
  function sph(p, m, sx, sy, sz, x, y, z) { return mesh(p, geo().sph, m, sx, sy, sz, x, y, z); }

  // Hull: lofted, bow on +x. Rounded bilge, flared sides, sheer rising to the bow, raked forefoot.
  // Material groups: 0 = deck, 1 = sides + transom.
  // hull station at u (0 = stern, 1 = bow): x, half-width w, deck height yt, keel yb
  function hullAt(L, B, top, bowLen, sternW, sheer, u, rk) {
    var h = B / 2, xb = L / 2 - bowLen, x = -L / 2 + u * L, w = h, t;
    if (x > xb) { t = (x - xb) / bowLen; w = h * Math.pow(Math.max(0, 1 - Math.pow(Math.min(t, 1), 1.7)), 0.75); }
    else if (u < 0.12) { t = 1 - u / 0.12; w = h * (1 - (1 - sternW) * t * t); }
    w = Math.max(w, 0.04);
    var yt = top + sheer * Math.pow(Math.max(0, (u - 0.68) / 0.32), 2) + sheer * 0.3 * Math.pow(Math.max(0, (0.1 - u) / 0.1), 2);
    var yb = -0.5 + (x > xb ? Math.pow((x - xb) / bowLen, 2) * ((rk == null ? top : rk) + 0.5) * 0.55 : 0);
    if (yb > yt - 0.03) { yb = yt - 0.03; w = 0.02; }   // band copy: vanish where the hull's forefoot is raked away
    return { x: x, w: w, yt: yt, yb: yb };
  }
  var hullCache = {};
  function hullGeo(L, B, top, bowLen, sternW, sheer, rk) {
    var key = [L, B, top, bowLen, sternW, sheer, rk].join('_');
    if (hullCache[key]) return hullCache[key];
    var NS = 30, NJ = 7, pos = [], deckI = [], sideI = [], st = [];
    for (var i = 0; i <= NS; i++) st.push(hullAt(L, B, top, bowLen, sternW, sheer, i / NS, rk));
    function V(x, y, z) { pos.push(x, y, z); return pos.length / 3 - 1; }
    var base = [1, -1].map(function (sd) {
      var b = pos.length / 3;
      st.forEach(function (s) {
        for (var j = 0; j <= NJ; j++) {
          var th = j / NJ * Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
          V(s.x, s.yt - (s.yt - s.yb) * Math.pow(sn, 0.5), sd * s.w * Math.pow(c, 0.35) * (1 + 0.06 * (1 - sn)));
        }
      });
      return b;
    });
    var R = NJ + 1;
    for (i = 0; i < NS; i++) for (var j = 0; j < NJ; j++) {
      for (var k = 0; k < 2; k++) {
        var a = base[k] + i * R + j, b2 = a + R, c2 = a + 1, d2 = b2 + 1;
        if (k === 0) sideI.push(a, c2, b2, b2, c2, d2); else sideI.push(a, b2, c2, b2, d2, c2);
      }
    }
    // transom (stern, i = 0), fan from deck centre
    var tc = V(st[0].x, st[0].yt, 0), tb = [];
    for (k = 0; k < 2; k++) { tb[k] = pos.length / 3; for (j = 0; j <= NJ; j++) { var q = base[k] + j; V(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]); } }
    for (j = 0; j < NJ; j++) { sideI.push(tc, tb[0] + j + 1, tb[0] + j); sideI.push(tc, tb[1] + j, tb[1] + j + 1); }
    // deck
    var dk = pos.length / 3;
    st.forEach(function (s) { var z = s.w * 1.06; V(s.x, s.yt, z); V(s.x, s.yt, -z); });
    for (i = 0; i < NS; i++) {
      var p0 = dk + i * 2, q0 = p0 + 1, p1 = p0 + 2, q1 = p0 + 3;
      deckI.push(p0, p1, q0, q0, p1, q1);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(deckI.concat(sideI));
    g.addGroup(0, deckI.length, 0); g.addGroup(deckI.length, sideI.length, 1);
    g.computeVertexNormals();
    // baked AO: hull sides darken softly toward the waterline / keel; deck stays full
    var pa = g.attributes.position, ca = new Float32Array(pa.count * 3);
    for (var v = 0; v < pa.count; v++) {
      var y = pa.getY(v), t = Math.max(0, Math.min(1, (y + 0.1) / (top * 0.9 + 0.1))), ao = 0.8 + 0.2 * t * t * (3 - 2 * t);
      ca[v * 3] = ca[v * 3 + 1] = ca[v * 3 + 2] = v >= dk ? 1 : ao;
    }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    hullCache[key] = g;
    return g;
  }

  // ---- parts ----
  var TUR = {
    big:   { w: 2.1, h: 0.8, d: 1.9, n: 3, len: 2.1, t: 0.26, sp: 0.5 },
    med:   { w: 1.5, h: 0.62, d: 1.35, n: 3, len: 1.6, t: 0.2, sp: 0.38 },
    small: { w: 0.95, h: 0.52, d: 0.85, n: 1, len: 1.2, t: 0.17, sp: 0 },
    mg:    { w: 0.42, h: 0.32, d: 0.42, n: 2, len: 0.7, t: 0.09, sp: 0.16 }
  };
  // turret: obj pivot at (x,y,z); barrel = Object3D at the muzzle tip.
  function turret(ship, P, cal, x, y, z, rotY, nBarrels) {
    var t = TUR[cal], obj = new THREE.Group();
    obj.position.set(x, y, z || 0); obj.rotation.y = rotY || 0;
    box(obj, P.super, t.w, t.h, t.d, -t.w * 0.22, 0, 0);
    if (cal !== 'mg') bar(obj, P.accent, t.w * 0.45, 0.05, t.d * 0.6, -t.w * 0.3, t.h - 0.02, 0); // roof stripe
    var n = nBarrels || t.n, front = t.w * 0.25, by = t.h * 0.48;
    for (var i = 0; i < n; i++) {
      var bz = (i - (n - 1) / 2) * t.sp;
      xc(obj, P.gun, t.t / 2, t.len, front + t.len / 2, by, bz);
    }
    var barrel = new THREE.Object3D();
    barrel.position.set(front + t.len, by, 0);
    obj.add(barrel);
    ship.group.add(obj);
    ship.turrets.push({ obj: obj, barrel: barrel, cal: cal });
    return obj;
  }
  // tapered funnel with accent band and dark cap; rake tilts top aft. Adds a stack Object3D at the top.
  function funnel(ship, P, x, y, r, h, rake, rz, z) {
    var f = new THREE.Group(), z2 = rz || r * 0.75;
    f.position.set(x, y, z || 0); f.rotation.z = rake || 0;
    mesh(f, geo().cone, P.super, r * 2, h, z2 * 2, 0, 0, 0);
    cyl(f, P.accent, r * 0.9, 0.24, 0, h - 0.34, 0, z2 * 0.9);
    cyl(f, C.dark, r * 0.88, 0.08, 0, h - 0.02, 0, z2 * 0.88);
    var top = new THREE.Object3D(); top.position.set(0, h, 0); f.add(top);
    ship.group.add(f); ship.stacks.push(top);
    return f;
  }
  function tripod(p, P, x, y, h) {
    cyl(p, C.dark, 0.1, h, x, y, 0);
    var l1 = cyl(p, C.dark, 0.07, h * 0.85, x - 0.5, y, 0.35); l1.rotation.set(-0.35, 0, -0.4);
    var l2 = cyl(p, C.dark, 0.07, h * 0.85, x - 0.5, y, -0.35); l2.rotation.set(0.35, 0, -0.4);
    box(p, P.super, 0.9, 0.4, 0.9, x, y + h * 0.76, 0);
    bar(p, C.glass, 0.92, 0.1, 0.6, x + 0.01, y + h * 0.76 + 0.2, 0);
    xc(p, C.dark, 0.04, 1.6, x, y + h * 0.95, 0).rotation.y = Math.PI / 2; // yard
    sph(p, C.dark, 0.16, 0.16, 0.16, x, y + h, 0);
  }
  function pagoda(p, P, x, y, scale) {
    var s = scale || 1, levels = [[2.0, 1.6], [1.7, 1.4], [1.4, 1.2], [1.55, 1.35], [1.1, 1.0], [1.3, 1.2], [0.8, 0.8]];
    var yy = y;
    for (var i = 0; i < levels.length; i++) {
      var hh = (i % 2 ? 0.36 : 0.55) * s;
      box(p, P.super, levels[i][0] * s, hh, levels[i][1] * s, x - i * 0.08 * s, yy, 0);
      if (i === 5 || i === 3) bar(p, C.glass, levels[i][0] * s * 0.6 + 0.02, 0.1 * s, levels[i][1] * s * 0.8, x - i * 0.08 * s + levels[i][0] * s * 0.2, yy + hh * 0.5, 0);
      yy += hh;
    }
    cyl(p, C.dark, 0.07, 1.0 * s, x - 0.5 * s, yy, 0);
    return yy;
  }
  // bridge block with a window strip on the front face
  function bridge(p, P, w, h, d, x, y) {
    box(p, P.super, w, h, d, x, y, 0);
    bar(p, C.glass, 0.1, Math.min(0.24, h * 0.3), d * 0.75, x + w / 2 - 0.03, y + h * 0.6, 0);
  }

  // ---- ship builders ----
  function newShip(P, L, B, top, bowLen, sternW, sheer, hullColor) {
    var hullMat = mat(hullColor || P.hull).clone(), deckMat = mat(P.deck).clone(), bandMat = mat(P.band).clone();
    var g = new THREE.Group();
    g.add(new THREE.Mesh(hullGeo(L, B, top, bowLen, sternW, sheer), [deckMat, hullMat]));
    // waterline (boot-topping) band: a slightly wider low copy of the hull
    var band = new THREE.Mesh(hullGeo(L, B, 0.16, bowLen, sternW, 0, top), bandMat);
    band.scale.set(1 + 0.04 / L, 1, 1 + 0.06 / B); g.add(band);
    return { group: g, turrets: [], stacks: [], deck: null, hullMats: [hullMat, deckMat, bandMat], _hg: [L, B, top, bowLen, sternW, sheer] };
  }
  // thin dark inverted-hull outline around the hull silhouette (shared material; not for subs)
  function outline(s) {
    var a = s._hg, o = new THREE.Mesh(hullGeo(a[0], a[1], a[2], a[3], a[4], a[5]), [lineMat(), lineMat()]);
    o.scale.set(1 + 0.16 / a[0], 1.03, 1 + 0.12 / a[1]); o.position.y = 0.01;
    s.group.add(o);
  }

  var BUILD = {};
  BUILD.battleship = function (P, isJ) {
    var D = 1.0, s = newShip(P, 24, 4.0, D, 5.5, 0.72, 0.55), g = s.group;
    box(g, P.super, 8.5, 0.8, 2.7, -0.8, D, 0);                       // citadel
    box(g, P.super, 1.8, 0.6, 1.8, 4.6, D, 0);                        // barbette B
    turret(s, P, 'big', 7.6, D, 0, 0);
    turret(s, P, 'big', 4.8, D + 0.6, 0, 0);
    turret(s, P, 'big', -8.0, D, 0, Math.PI);
    turret(s, P, 'small', -3.4, D + 0.8, 1.25, -Math.PI / 2);
    turret(s, P, 'small', -3.4, D + 0.8, -1.25, Math.PI / 2);
    if (isJ) {
      pagoda(g, P, 2.2, D + 0.8, 1.2);
      funnel(s, P, -0.6, D + 0.8, 0.75, 2.3, 0.38, 0.55);
      tripod(g, P, -5.5, D, 2.4);
    } else {
      bridge(g, P, 2.6, 1.3, 2.0, 1.9, D + 0.8);
      bridge(g, P, 1.6, 0.7, 1.5, 2.1, D + 2.1);
      tripod(g, P, 2.0, D + 2.8, 2.6);
      funnel(s, P, -0.9, D + 0.8, 0.8, 2.0, 0, 0.6);
      box(g, P.super, 1.4, 0.9, 1.4, -4.6, D, 0);
      tripod(g, P, -4.6, D + 0.9, 1.8);
    }
    return s;
  };
  BUILD.cruiser = function (P, isJ) {
    var D = 0.9, s = newShip(P, 18, 2.8, D, 4.2, 0.7, 0.45), g = s.group;
    box(g, P.super, 6.2, 0.6, 2.0, -0.6, D, 0);
    box(g, P.super, 1.3, 0.45, 1.3, 3.6, D, 0);
    var nb = isJ ? 2 : 3;
    turret(s, P, 'med', 5.6, D, 0, 0, nb);
    turret(s, P, 'med', 3.7, D + 0.45, 0, 0, nb);
    turret(s, P, 'med', -6.2, D, 0, Math.PI, nb);
    if (isJ) {
      pagoda(g, P, 1.9, D + 0.6, 0.85);
      funnel(s, P, -0.9, D + 0.6, 0.9, 1.7, 0.5, 0.5);
      tripod(g, P, -3.6, D + 0.6, 1.8);
    } else {
      bridge(g, P, 1.8, 1.0, 1.5, 1.7, D + 0.6);
      tripod(g, P, 1.5, D + 1.6, 2.0);
      funnel(s, P, 0.0, D + 0.6, 0.5, 1.6, 0, 0.42);
      funnel(s, P, -1.8, D + 0.6, 0.5, 1.6, 0, 0.42);
      tripod(g, P, -3.4, D + 0.6, 1.5);
    }
    return s;
  };
  BUILD.destroyer = function (P, isJ) {
    var D = 0.7, s = newShip(P, 12, 1.8, D, 3.2, 0.7, 0.4), g = s.group;
    turret(s, P, 'small', 3.7, D, 0, 0);
    turret(s, P, 'small', -4.3, D, 0, Math.PI);
    bridge(g, P, 1.5, 0.8, 1.2, 2.1, D);
    cyl(g, C.dark, 0.06, 1.7, 1.6, D + 0.8, 0);
    sph(g, C.dark, 0.14, 0.14, 0.14, 1.6, D + 2.5, 0);
    box(g, P.super, 3.6, 0.38, 1.05, -0.7, D, 0);
    if (isJ) {
      funnel(s, P, 0.6, D + 0.35, 0.46, 1.3, 0.35, 0.36);
      funnel(s, P, -1.1, D + 0.35, 0.38, 1.1, 0.35, 0.3);
    } else {
      funnel(s, P, 0.5, D + 0.35, 0.38, 1.2, 0, 0.32);
      funnel(s, P, -0.9, D + 0.35, 0.38, 1.2, 0, 0.32);
    }
    xc(g, P.gun, 0.17, 1.4, -1.9, D + 0.45, 0);  // torpedo tubes
    box(g, P.super, 0.7, 0.28, 0.7, -2.6, D, 0);
    return s;
  };
  BUILD.submarine = function (P, isJ) {
    var hc = new THREE.Color(P.hull).multiplyScalar(0.72).getHex();
    var D = 0.4, s = newShip(P, 10, 1.25, D, 3.4, 0.25, 0.15, hc), g = s.group;
    s.hullMats[1].color.copy(soft(new THREE.Color(P.hull).multiplyScalar(0.6).getHex()));
    var tm = s.hullMats[0];                                             // tower fades with the hull when submerged
    box(g, tm, 7.0, 0.14, 0.62, -0.4, D, 0);                            // casing
    box(g, tm, isJ ? 1.9 : 1.6, 0.9, 0.62, 0.6, D, 0);                 // conning tower
    box(g, s.hullMats[2], isJ ? 0.9 : 0.7, 0.1, 0.64, 0.7, D + 0.84, 0);
    cyl(g, tm, 0.05, 1.0, 0.9, D + 0.9, 0);
    cyl(g, tm, 0.05, 0.8, 0.4, D + 0.9, 0);
    xc(g, tm, 0.06, 0.9, 2.3, D + 0.36, 0);                            // deck gun (decor)
    box(g, tm, 0.32, 0.3, 0.32, 1.9, D + 0.1, 0);
    return s;
  };
  BUILD.pt = function (P, isJ) {
    var D = 0.55, s = newShip(P, 5, 1.4, D, 1.7, 0.85, 0.2), g = s.group;
    bridge(g, P, 1.3, 0.45, 0.82, 0.4, D);
    box(g, P.accent, 0.6, 0.06, 0.5, 0.25, D + 0.43, 0);
    xc(g, P.gun, 0.14, 1.8, 0.2, D + 0.15, 0.5);
    xc(g, P.gun, 0.14, 1.8, 0.2, D + 0.15, -0.5);
    turret(s, P, 'mg', -1.2, D, 0, Math.PI);
    return s;
  };
  BUILD.carrier = function (P, isJ) {
    var D = 1.0, FD = 1.75, s = newShip(P, 26, 3.7, D, 4.8, 0.85, 0.35), g = s.group;
    var deckMat = s.hullMats[1];
    box(g, s.hullMats[0], 21, FD - D + 0.05, 3.5, -1.2, D - 0.05, 0);     // hangar (hull coloured)
    var fd = new THREE.Mesh(geo().box, deckMat);                          // flight deck (tintable deck material)
    fd.scale.set(26.5, 0.24, 5.0); fd.position.set(-0.4, FD, 0); g.add(fd);
    var top = FD + 0.24, mk = mat(C.white);
    for (var i = -4; i <= 4; i++) bar(g, mk, 1.2, 0.02, 0.16, i * 2.6, top, 0);
    bar(g, mk, 0.35, 0.02, 4.6, 12.3, top, 0);
    bar(g, mk, 0.35, 0.02, 4.6, -13.1, top, 0);
    var el = new THREE.Color(P.deck).multiplyScalar(0.8).getHex();
    bar(g, el, 2.2, 0.025, 2.2, 6.0, top, 0);
    bar(g, el, 2.2, 0.025, 2.2, -5.5, top, 0);
    bar(g, P.accent, 26.6, 0.08, 5.04, -0.4, FD + 0.08, 0);              // deck-edge trim
    s.deck = new THREE.Object3D(); s.deck.position.set(0, top, 0); g.add(s.deck);
    if (isJ) {
      disc(g, C.white, 1.25, 0.03, 9.6, top, 0);
      disc(g, C.red, 1.0, 0.04, 9.6, top, 0);
      bridge(g, P, 2.0, 1.0, 0.8, 4.2, top);                              // small island
      g.children[g.children.length - 2].position.z = -2.0; g.children[g.children.length - 1].position.z = -2.0;
      cyl(g, C.dark, 0.06, 1.5, 3.8, top + 1.0, -2.0);
      var f = new THREE.Group(); f.position.set(-0.5, FD - 0.2, 2.6); f.rotation.x = -2.1; g.add(f); // downward side funnel
      mesh(f, geo().cone, P.super, 0.95, 1.3, 0.75, 0, 0, 0);
      cyl(f, P.accent, 0.46, 0.22, 0, 1.0, 0, 0.36);
      var stk = new THREE.Object3D(); stk.position.set(0, 1.3, 0); f.add(stk); s.stacks.push(stk);
    } else {
      box(g, P.super, 4.2, 1.3, 0.95, 1.4, top, 2.1);                    // starboard island
      box(g, P.super, 2.4, 0.75, 1.0, 2.2, top + 1.3, 2.1);
      bar(g, C.glass, 0.1, 0.22, 0.85, 3.4, top + 1.6, 2.1);
      tripod(g, P, 2.0, top + 2.05, 1.7);
      g.children.slice(-7).forEach(function (o) { o.position.z += 2.1; });
      funnel(s, P, 0.2, top + 1.3, 0.6, 1.0, 0.15, 0.42, 2.1);
      bar(g, P.accent, 1.0, 0.03, 3.0, -10.5, top, 0);                  // stern recognition band
    }
    turret(s, P, 'small', 9.5, D + 0.35, 2.3, -Math.PI / 2);
    turret(s, P, 'small', 9.5, D + 0.35, -2.3, Math.PI / 2);
    box(g, P.super, 1.2, 0.38, 0.8, 9.3, D, 2.2);
    box(g, P.super, 1.2, 0.38, 0.8, 9.3, D, -2.2);
    return s;
  };

  // all ship/plane meshes cast shadows; ships also receive them (turrets/islands shade decks). Outlines never do.
  function shadows(g, receive) {
    var lm = lineMat();
    g.traverse(function (o) {
      if (!o.isMesh) return;
      var isLine = Array.isArray(o.material) ? o.material[0] === lm : o.material === lm;
      o.castShadow = !isLine; o.receiveShadow = !!receive && !isLine;
    });
  }
  WW.models = {
    init: function () { geo(); grad(); },
    buildShip: function (type, nationId) {
      var P = nation(nationId), fn = BUILD[type];
      if (!fn) throw new Error('models.buildShip: unknown type ' + type);
      var s = fn(P, P.id === 'IJN');
      if (type !== 'submarine') outline(s);
      if (WW.models._finish) WW.models._finish(type, P, s);   // models_detail.js: fine detail + static-mesh merge
      // Make turret count/cal match WW.SHIP_TYPES guns (in order).
      var cals = gunCals(type);
      if (cals.length === s.turrets.length) s.turrets.forEach(function (t, i) { t.cal = cals[i]; });
      else if (window.console) console.warn('models: turret count mismatch for', type, cals.length, s.turrets.length);
      delete s._hg;
      shadows(s.group, true);
      return s;
    },
    // shared helpers for models_planes.js
    _mat: mat, _box: box, _bar: bar, _cyl: cyl, _disc: disc, _xc: xc, _sph: sph, _nation: nation, _C: C,
    _grad: grad, _lineMat: lineMat, _hullAt: hullAt, _geo: geo, _mesh: mesh, _shadows: shadows, _whiten: whiten, _soft: soft
  };
})();
