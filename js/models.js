// models.js (owner B) - soft toon "toy" ship models: the shared kit and buildShip. The 1942 class builders are in
// models_usn.js / models_ijn.js (true sizes from ship_classes.js). Planes are in models_planes.js.
// Shared MeshToonMaterial (3-step gradient), lofted hull with sheer + rounded bilge, rounded-box superstructure.
window.WW = window.WW || {};
(function () {
  'use strict';
  // Art palette (soft, desaturated pastels). Nation ids still come from WW.NATIONS.
  var PAL = {
    USN: { id: 'USN', hull: 0x7f94aa, deck: 0xa98f70, super: 0x91a5ba, accent: 0x34507e, band: 0x2b3b58, gun: 0x525c68, mark: 'star' },
    IJN: { id: 'IJN', hull: 0x8a8670, deck: 0xa88d6a, super: 0xa49f84, accent: 0xc4524a, band: 0x8a3a32, gun: 0x57564c, mark: 'disc' }
  };
  var C = { white: 0xefe8da, dark: 0x464b53, gun: 0x585e66, red: 0xd2564c, glass: 0x34465a, wood: 0x9a7650, line: 0x2b313a };

  function nation(n) { return PAL[n] || PAL.USN; }
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
  // Every class builder (models_usn.js, models_ijn.js) composes a ship from these. Masts and funnels register a
  // topple box (damage_visuals.js): [kind 'm' | 'f', x0, x1, foot y, z centre, z half range, height, pivot x].
  var CUR = null;   // the ship being built
  function part(kind, x0, x1, yb, z, zr, h, px) { if (CUR) CUR.parts.push([kind, x0, x1, yb, z, zr, h, px]); }
  var TUR = {
    big:   { w: 2.1, h: 0.8, d: 1.9, n: 3, len: 2.1, t: 0.26, sp: 0.5 },
    med:   { w: 1.5, h: 0.62, d: 1.35, n: 3, len: 1.6, t: 0.2, sp: 0.38 },
    small: { w: 0.95, h: 0.52, d: 0.85, n: 1, len: 1.2, t: 0.17, sp: 0 },
    mg:    { w: 0.42, h: 0.32, d: 0.42, n: 2, len: 0.7, t: 0.09, sp: 0.16 }
  };
  // turret: obj pivot at (x,y,z); barrel = Object3D at the muzzle tip. k: size factor; look: another calibre's shape.
  function turret(ship, P, cal, x, y, z, rotY, nBarrels, k, look) {
    var t = TUR[look || cal], obj = new THREE.Group(), q = k || 1;
    obj.position.set(x, y, z || 0); obj.rotation.y = rotY || 0;
    box(obj, P.super, t.w * q, t.h * q, t.d * q, -t.w * q * 0.22, 0, 0);
    if ((look || cal) !== 'mg') bar(obj, P.accent, t.w * q * 0.45, 0.05 * q, t.d * q * 0.6, -t.w * q * 0.3, t.h * q - 0.02, 0); // roof stripe
    var n = nBarrels || t.n, front = t.w * q * 0.25, by = t.h * q * 0.48, sp = (n === 2 && t.sp === 0 ? 0.3 : t.sp) * q;
    for (var i = 0; i < n; i++) xc(obj, P.gun, t.t * q / 2, t.len * q, front + t.len * q / 2, by, (i - (n - 1) / 2) * sp);
    var barrel = new THREE.Object3D();
    barrel.position.set(front + t.len * q, by, 0);
    obj.add(barrel);
    ship.group.add(obj);
    ship.turrets.push({ obj: obj, barrel: barrel, cal: cal });
    return obj;
  }
  // tapered funnel with accent band and dark cap; rake tilts top aft. Adds a stack Object3D at the top.
  function funnel(ship, P, x, y, r, h, rake, rz, z, noBand) {
    var f = new THREE.Group(), z2 = rz || r * 0.75;
    f.position.set(x, y, z || 0); f.rotation.z = rake || 0;
    mesh(f, geo().cone, P.super, r * 2, h, z2 * 2, 0, 0, 0);
    if (!noBand) cyl(f, P.accent, r * 0.9, Math.min(0.24, h * 0.18), 0, h - Math.min(0.34, h * 0.25), 0, z2 * 0.9);
    cyl(f, C.dark, r * 0.88, 0.08, 0, h - 0.02, 0, z2 * 0.88);
    var top = new THREE.Object3D(); top.position.set(0, h, 0); f.add(top);
    ship.group.add(f); ship.stacks.push(top);
    var dx = Math.sin(rake || 0) * h;
    part('f', x - r - Math.max(0, dx) - 0.05, x + r + Math.max(0, -dx) + 0.05, y + 0.05, z || 0, z2 + 0.05, h, x);
    return f;
  }
  // Japanese carrier funnel: out over the side and curving down toward the sea (side: +1 starboard).
  // an IJN carrier's down-curved funnel: a trunk out of the hull side at z0 (side +1 starboard), then the cone turned
  // down and outboard (tilt rad from upright), the smoke exhaust at its mouth
  function downFunnel(ship, P, x, y, r, len, side, tilt, z0) {
    var zs = z0 || 0, tr = r * 1.7;
    box(ship.group, P.super, r * 2.2, r * 1.6, tr, x, y - r * 0.8, side * (zs + tr / 2 - 0.05));   // trunk
    var f = new THREE.Group(); f.position.set(x, y, side * (zs + tr - 0.1)); f.rotation.x = side * (tilt || 2.1); ship.group.add(f);
    mesh(f, geo().cone, P.super, r * 2, len, r * 1.6, 0, 0, 0);
    cyl(f, C.dark, r * 0.9, 0.06, 0, len - 0.02, 0, r * 0.72);
    var stk = new THREE.Object3D(); stk.position.set(0, len, 0); f.add(stk); ship.stacks.push(stk);
    return f;
  }
  function tripod(p, P, x, y, h, k) {
    var q = k || 1;
    cyl(p, C.dark, 0.1 * q, h, x, y, 0);
    var l1 = cyl(p, C.dark, 0.07 * q, h * 0.85, x - 0.5 * q, y, 0.35 * q); l1.rotation.set(-0.35, 0, -0.4);
    var l2 = cyl(p, C.dark, 0.07 * q, h * 0.85, x - 0.5 * q, y, -0.35 * q); l2.rotation.set(0.35, 0, -0.4);
    box(p, P.super, 0.9 * q, 0.4 * q, 0.9 * q, x, y + h * 0.76, 0);
    bar(p, C.glass, 0.92 * q, 0.1 * q, 0.6 * q, x + 0.01, y + h * 0.76 + 0.2 * q, 0);
    xc(p, C.dark, 0.04, 1.6 * q, x, y + h * 0.95, 0).rotation.y = Math.PI / 2; // yard
    sph(p, C.dark, 0.16 * q, 0.16 * q, 0.16 * q, x, y + h, 0);
    part('m', x - 0.9 * q, x + 0.5 * q, y + 0.05, 0, 0.9 * q, h, x);
  }
  // plain pole mast with a yard (destroyers, light cruisers, aft masts)
  function pole(p, x, y, h, yard, z) {
    cyl(p, C.dark, 0.05, h, x, y, z || 0);
    xc(p, C.dark, 0.03, yard || 1.0, x, y + h * 0.82, z || 0).rotation.y = Math.PI / 2;
    part('m', x - 0.3, x + 0.3, y + 0.05, z || 0, (yard || 1) * 0.5 + 0.05, h, x);
  }
  // pagoda foremast: levels [[x length, z width, height], ...] from the bottom, each set back by dx; returns the top y
  function pagoda(p, P, x, y, levels, dx, glassAt) {
    var yy = y;
    for (var i = 0; i < levels.length; i++) {
      var l = levels[i], xi = x - i * (dx || 0);
      box(p, P.super, l[0], l[2], l[1], xi, yy, 0);
      if (glassAt && glassAt.indexOf(i) >= 0) bar(p, C.glass, 0.1, Math.min(0.14, l[2] * 0.4), l[1] * 0.8, xi + l[0] / 2 - 0.02, yy + l[2] * 0.45, 0);
      yy += l[2];
    }
    return yy;
  }
  // bridge block with a window strip on the front face
  function bridge(p, P, w, h, d, x, y, z) {
    box(p, P.super, w, h, d, x, y, z || 0);
    bar(p, C.glass, 0.1, Math.min(0.24, h * 0.3), d * 0.75, x + w / 2 - 0.03, y + h * 0.6, z || 0);
  }

  // ---- hull ----
  function newShip(P, L, B, top, bowLen, sternW, sheer, hullColor) {
    var hullMat = mat(hullColor || P.hull).clone(), deckMat = mat(P.deck).clone(), bandMat = mat(P.band).clone();
    var g = new THREE.Group();
    g.add(new THREE.Mesh(hullGeo(L, B, top, bowLen, sternW, sheer), [deckMat, hullMat]));
    // waterline (boot-topping) band: a slightly wider low copy of the hull
    var band = new THREE.Mesh(hullGeo(L, B, Math.min(0.16, top * 0.4), bowLen, sternW, 0, top), bandMat);
    band.scale.set(1 + 0.04 / L, 1, 1 + 0.06 / B); g.add(band);
    var hg = [L, B, top, bowLen, sternW, sheer];
    return { group: g, turrets: [], stacks: [], deck: null, hullMats: [hullMat, deckMat, bandMat], _hg: hg, hull: hg, parts: CUR ? CUR.parts : [] };
  }
  // the class hull: true length and beam (ship_classes.js), loft shape from the class
  function classHull(P, c, color) { var h = c.hull; return newShip(P, c.len, c.beam, h.top, h.bowF * c.len, h.sternW, h.sheer, color); }
  // deck height of hull s at local x
  function deckAt(s, x) { var a = s.hull; return hullAt(a[0], a[1], a[2], a[3], a[4], a[5], WW.clamp((x + a[0] / 2) / a[0], 0, 1)).yt; }
  // thin dark inverted-hull outline around the hull silhouette (shared material; not for subs)
  function outline(s) {
    var a = s.hull, o = new THREE.Mesh(hullGeo(a[0], a[1], a[2], a[3], a[4], a[5]), [lineMat(), lineMat()]);
    o.scale.set(1 + 0.16 / a[0], 1.03, 1 + Math.min(0.12, a[1] * 0.08) / a[1]); o.position.y = 0.01;
    s.group.add(o);
  }

  // all ship/plane meshes cast shadows; ships also receive them (turrets/islands shade decks). Outlines never do.
  function shadows(g, receive) {
    var lm = lineMat();
    g.traverse(function (o) {
      if (!o.isMesh) return;
      var isLine = Array.isArray(o.material) ? o.material[0] === lm : o.material === lm;
      o.castShadow = !isLine; o.receiveShadow = !!receive && !isLine;
    });
  }
  function classOf(type, nationId, key) {
    var c = WW.SHIP_CLASSES && WW.SHIP_CLASSES[key];
    if (c && c.type === type) return c;
    var l = WW.shipClasses ? WW.shipClasses(type, nationId) : [];
    return l[0] || null;
  }
  function gunCals(type, c) {
    var g = (c && c.guns) || (WW.SHIP_TYPES[type] && WW.SHIP_TYPES[type].guns) || [], out = [];
    g.forEach(function (q) { for (var i = 0; i < q.count; i++) out.push(q.cal); });
    return out;
  }
  var HULLS = {}, PARTS = {};
  WW.models = {
    CLASS: {},        // class builders by key: fn(P, c, isJ, K) -> ship model (models_usn.js, models_ijn.js)
    init: function () { geo(); grad(); },
    // buildShip(type, nation[, classKey]): the model of a ship class (default: the type's first class of the nation).
    // The model carries: turrets (one per gun mount, in the class's guns order), stacks, parts (topple boxes), hull
    // (loft parameters), cls, and on carriers deck (Object3D at the flight deck) + deckDims (air_deck.js).
    buildShip: function (type, nationId, key) {
      var P = nation(nationId), c = classOf(type, P.id, key), fn = c && WW.models.CLASS[c.build || c.key];
      if (!fn) throw new Error('models.buildShip: no class builder for ' + type + ' / ' + key);
      CUR = { parts: [] };
      if (WW.models.D) WW.models.D.bind();
      var s;
      try { s = fn(P, c, P.id === 'IJN', WW.models.K); } finally { CUR = null; }
      s.cls = c.key;
      if (type !== 'submarine') outline(s);
      if (WW.models._finish) WW.models._finish(type, P, s, c);   // models_detail.js: common detail + static-mesh merge
      var cals = gunCals(type, c);
      if (cals.length === s.turrets.length) s.turrets.forEach(function (t, i) { t.cal = cals[i]; });
      else if (window.console) console.warn('models: turret count mismatch for', c.key, cals.length, s.turrets.length);
      HULLS[c.key] = s.hull; PARTS[c.key + '|' + P.id] = s.parts;
      delete s._hg;
      shadows(s.group, true);
      return s;
    },
    // per-class geometry for the visual modules (crew, damage visuals), by model key (ship.mk) or by type
    classOf: classOf,
    hull: function (k) {
      if (HULLS[k]) return HULLS[k];
      var c = WW.SHIP_CLASSES[k] || classOf(k, 'USN');
      if (!c) return null;
      if (!HULLS[c.key]) WW.models.buildShip(c.type, c.nation, c.key).hullMats.forEach(function (m) { m.dispose(); });
      return HULLS[c.key];
    },
    parts: function (k, n) { return PARTS[k + '|' + n] || []; },
    // shared helpers for models_planes.js
    _mat: mat, _box: box, _bar: bar, _cyl: cyl, _disc: disc, _xc: xc, _sph: sph, _nation: nation, _C: C,
    _grad: grad, _lineMat: lineMat, _hullAt: hullAt, _geo: geo, _mesh: mesh, _shadows: shadows, _whiten: whiten, _soft: soft
  };
  // the class builders' kit
  WW.models.K = { mat: mat, box: box, bar: bar, cyl: cyl, disc: disc, xc: xc, sph: sph, mesh: mesh, geo: geo, C: C, soft: soft,
    turret: turret, funnel: funnel, downFunnel: downFunnel, tripod: tripod, pole: pole, pagoda: pagoda, bridge: bridge,
    newShip: newShip, classHull: classHull, deckAt: deckAt, hullAt: hullAt, part: part, TUR: TUR };
})();
