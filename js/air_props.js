// air_props.js (air deaths) - pooled props for plane deaths (WW.airProps): parachutes, life rafts with a
// dye marker, and tumbling sheared-off wings. Load after aircraft.js, before air_deaths.js.
// Everything is visual: Math.random only, never WW.rand. Pools are fixed; meshes stay in the scene and
// are shown / hidden. Geometries and materials are made once and shared.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  var CHUTE_N = 12, RAFT_N = 16, WING_PER_KEY = 3;
  var chutes = [], rafts = [], wings = {}, ready = false;
  var _m = null, _t, _p, _q, _s, _c, _box;

  function init() {
    if (ready || !WW.scene || !WW.models || !WW.models._geo) return ready;
    var M = WW.models, G = M._geo(), mat = M._mat;
    _m = new THREE.Matrix4(); _t = new THREE.Matrix4(); _p = new THREE.Vector3(); _q = new THREE.Quaternion(); _s = new THREE.Vector3(); _c = new THREE.Vector3(); _box = new THREE.Box3();
    // canopy: a shallow dome open at the bottom (radius 1, height ~0.55)
    var dome = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.36);
    dome.translate(0, -Math.cos(Math.PI * 0.36), 0); M._whiten(dome);
    var canopyMat = new THREE.MeshToonMaterial({ color: M._soft(0xe9e1cf), gradientMap: M._grad(), vertexColors: true, side: THREE.DoubleSide }), figMat = mat(0x6a6550), headMat = mat(0xd9b48e);
    var raftMat = mat(0xe2b448), raftIn = mat(0xa8802e);
    // shroud lines: 6 segments from the canopy rim to the harness (one shared geometry)
    var lp = [];
    for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; lp.push(Math.cos(a) * 0.93, 0.02, Math.sin(a) * 0.93, 0, -1.75, 0); }
    var lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    var lineMat = new THREE.LineBasicMaterial({ color: 0x5a564e, transparent: true, opacity: 0.7 });
    var dyeGeo = new THREE.CircleGeometry(1, 20); dyeGeo.rotateX(-Math.PI / 2);
    var dyeMat = new THREE.MeshBasicMaterial({ color: 0x8fd6b4, transparent: true, opacity: 0.38, depthWrite: false });
    function figure(parent, y, sit) {           // tiny airman: body + head
      M._mesh(parent, G.sph, figMat, 0.26, sit ? 0.3 : 0.5, 0.22, 0, y, 0);
      M._mesh(parent, G.sph, headMat, 0.17, 0.17, 0.17, 0, y + (sit ? 0.22 : 0.33), 0);
    }
    for (var c = 0; c < CHUTE_N; c++) {
      var g = new THREE.Group(), can = new THREE.Group();
      var cm = new THREE.Mesh(dome, canopyMat); cm.castShadow = true; can.add(cm);
      g.add(can);
      var ln = new THREE.LineSegments(lineGeo, lineMat); ln.frustumCulled = false; g.add(ln);
      var fig = new THREE.Group(); fig.position.y = -1.95; figure(fig, -0.25, false); g.add(fig);
      fig.children.forEach(function (o) { o.castShadow = true; });
      g.visible = false; WW.scene.add(g);
      chutes.push({ g: g, can: can, ln: ln, fig: fig, alive: false, t: 0, x: 0, y: 0, z: 0, ph: 0, land: 0, raft: 0 });
    }
    for (var r = 0; r < RAFT_N; r++) {
      var rg = new THREE.Group(), boat = new THREE.Group();
      M._mesh(boat, G.disc, raftMat, 1.0, 0.16, 0.7, 0, -0.04, 0);
      M._mesh(boat, G.disc, raftIn, 0.72, 0.17, 0.46, 0, -0.03, 0);
      var who = new THREE.Group(); who.position.y = 0.12; figure(who, 0.05, true); boat.add(who);
      rg.add(boat);
      var dye = new THREE.Mesh(dyeGeo, dyeMat); dye.renderOrder = 2; dye.position.y = 0.06;
      rg.visible = false; WW.scene.add(rg); WW.scene.add(dye); dye.visible = false;
      rafts.push({ g: rg, boat: boat, dye: dye, who: who, alive: false, t: 0, life: 30, x: 0, z: 0, ph: 0 });
    }
    // sheared-wing copies for every plane type, made up front so the scene does not grow mid-battle
    var kinds = Object.keys(WW.PLANE_TYPES || {});
    ['USN', 'IJN'].forEach(function (n) {
      kinds.forEach(function (k) {
        var pm = M.buildPlane ? M.buildPlane(k, n) : null;
        if (!pm || !pm.wingL || !pm.wingR) return;
        for (var j = 0; j < WING_PER_KEY; j++) { makeWing(k + n + 'L', pm.wingL); makeWing(k + n + 'R', pm.wingR); }
      });
    });
    ready = true;
    return ready;
  }
  function makeWing(key, w) {
    var list = wings[key] || (wings[key] = []), h = new THREE.Group(), inner = w.clone();
    inner.position.set(0, 0, 0); inner.rotation.set(0, 0, 0); inner.scale.set(1, 1, 1); inner.visible = true;
    inner.traverse(function (o) { o.visible = true; if (o.isMesh) o.castShadow = true; });
    inner.updateMatrixWorld(true); _box.setFromObject(inner); _box.getCenter(_c);
    var d = { h: h, ctr: _c.clone(), alive: false, t: 0 };
    inner.position.copy(_c).negate(); h.add(inner); h.visible = false; WW.scene.add(h); list.push(d);
    return d;
  }

  function oldest(list) { var o = null; for (var i = 0; i < list.length; i++) { if (!list[i].alive) return list[i]; if (!o || list[i].t > o.t) o = list[i]; } return o; }

  // A parachute opening at (x, y, z). onLand: raft on the water after the canopy collapses.
  function chute(x, y, z, raft) {
    if (!init()) return null;
    var c = oldest(chutes);
    c.alive = true; c.t = 0; c.x = x; c.y = y; c.z = z; c.vy = -3; c.ph = R() * 6.28; c.land = -1; c.raft = raft !== false;
    c.g.visible = true; c.can.scale.set(0.15, 0.3, 0.15); c.can.position.set(0, 0, 0); c.ln.visible = true; c.fig.visible = true;
    c.g.rotation.set(0, R() * 6.28, 0); c.g.position.set(x, y, z);
    return c;
  }
  function raft(x, z, life, dye) {
    if (!init()) return null;
    var r = oldest(rafts);
    r.alive = true; r.t = 0; r.life = life || rr(28, 40); r.x = x; r.z = z; r.ph = R() * 6.28; r.dyeOn = dye !== false;
    r.g.visible = true; r.g.position.set(x, 0, z); r.g.rotation.set(0, R() * 6.28, 0); r.who.visible = true;
    r.dye.visible = r.dyeOn; r.dye.scale.set(0.3, 1, 0.3); r.dye.position.set(x, 0.06, z);
    if (WW.fx) WW.fx.splash(x, z, 0.4);
    return r;
  }

  // Sheared wing: a pooled copy of the model's wing group (shared geometry + materials), centred on its own
  // middle so it tumbles about itself. Spawned at the wing's current world pose with the given velocity.
  function wing(m, w, vx, vy, vz) {
    if (!init() || !w) return null;
    var key = (m.key || 'p') + (w === m.wingL ? 'L' : 'R'), list = wings[key] || (wings[key] = []), d = null;
    for (var i = 0; i < list.length; i++) if (!list[i].alive) { d = list[i]; break; }
    if (!d && list.length < WING_PER_KEY) d = makeWing(key, w);   // unknown plane key: grow once
    if (!d) d = oldest(list);
    m.group.updateMatrixWorld(true);
    _m.copy(w.matrixWorld).multiply(_t.makeTranslation(d.ctr.x, d.ctr.y, d.ctr.z));
    _m.decompose(_p, _q, _s);
    d.h.position.copy(_p); d.h.quaternion.copy(_q); d.h.scale.copy(_s); d.h.visible = true;
    d.alive = true; d.t = 0; d.vx = vx; d.vy = vy; d.vz = vz; d.wx = rr(4, 8) * (R() < 0.5 ? -1 : 1); d.wy = rr(-2, 2); d.wz = rr(-1.5, 1.5); d.smT = 0;
    return d;
  }

  function update(dt) {
    if (!(dt > 0) || !init()) return;
    var fx = WW.fx, wind = WW.wind || { x: 0.3, z: 0 }, i;
    for (i = 0; i < chutes.length; i++) {
      var c = chutes[i]; if (!c.alive) continue;
      c.t += dt;
      if (c.land < 0) {
        var open = Math.min(1, c.t / 1.1), e = 1 - (1 - open) * (1 - open);
        c.can.scale.set(0.15 + 0.85 * e, 0.3 + 0.7 * e, 0.15 + 0.85 * e);
        c.vy += ((open < 1 ? -4 : -1.6) - c.vy) * Math.min(1, dt * 1.5);
        var k = 1.2 + Math.min(1, c.y / 30);     // stronger wind aloft
        c.x += wind.x * k * dt; c.z += wind.z * k * dt; c.y += c.vy * dt;
        var sw = Math.sin(c.t * 1.3 + c.ph) * 0.14 * e;
        c.g.position.set(c.x, c.y, c.z); c.g.rotation.x = sw; c.g.rotation.z = Math.cos(c.t * 1.1 + c.ph) * 0.1 * e;
        if (c.y - 2.3 <= 0.05) {               // airman in the water: canopy collapses downwind
          c.land = 0; c.fig.visible = false; c.ln.visible = false;
          var wet = !WW.terrain || WW.terrain.depthAt(c.x, c.z) > 0.3;   // drifted ashore: no raft
          if (fx && wet) fx.splash(c.x, c.z, 0.35);
          if (c.raft && wet) raft(c.x, c.z);
        }
      } else {
        c.land += dt;
        var f = Math.min(1, c.land / 2.6);
        c.x += wind.x * 0.5 * dt; c.z += wind.z * 0.5 * dt;
        c.y += (0.06 - c.y) * Math.min(1, dt * 2.5);                      // canopy settles flat on the water
        c.g.position.set(c.x, c.y, c.z); c.g.rotation.x *= 1 - Math.min(1, dt * 2); c.g.rotation.z *= 1 - Math.min(1, dt * 2);
        c.can.scale.set(1 + 0.25 * f, Math.max(0.06, 1 - f), 1 + 0.25 * f);
        if (c.land > 5) { c.y -= 0.4 * dt * (c.land - 5); if (c.land > 7.5) { c.alive = false; c.g.visible = false; } }
      }
    }
    for (i = 0; i < rafts.length; i++) {
      var r = rafts[i]; if (!r.alive) continue;
      r.t += dt;
      r.x += wind.x * 0.25 * dt; r.z += wind.z * 0.25 * dt;
      var left = r.life - r.t, sink = left < 3 ? (3 - Math.max(0, left)) / 3 : 0;
      r.g.position.set(r.x, 0.06 + Math.sin(r.t * 1.7 + r.ph) * 0.05 - sink * 0.6, r.z);
      r.g.rotation.x = Math.sin(r.t * 1.3 + r.ph) * 0.07; r.g.rotation.z = Math.cos(r.t * 1.1 + r.ph) * 0.06;
      if (r.dyeOn) { var ds = Math.min(1, r.t / 12) * 2.2 + 0.3; r.dye.scale.set(ds * (1 - sink), 1, ds * 0.8 * (1 - sink)); r.dye.position.set(r.x - wind.x * 0.6, 0.06, r.z - wind.z * 0.6); }
      if (left < 2.5) r.who.visible = false;
      if (left <= 0) { r.alive = false; r.g.visible = false; r.dye.visible = false; if (fx) fx.splash(r.x, r.z, 0.3); }
    }
    for (var k2 in wings) {
      var L = wings[k2];
      for (i = 0; i < L.length; i++) {
        var d = L[i]; if (!d.alive) continue;
        d.t += dt;
        var dr = 1 - Math.min(1, 0.5 * dt);
        d.vx *= dr; d.vz *= dr; d.vy = Math.max(-13, d.vy - 9.8 * dt);
        var h = d.h; h.position.x += d.vx * dt; h.position.y += d.vy * dt; h.position.z += d.vz * dt;
        h.rotateX(d.wx * dt); h.rotateY(d.wy * dt); h.rotateZ(d.wz * dt);
        d.smT -= dt;
        if (fx && d.t < 3 && d.smT <= 0) { d.smT = 0.1 * (WW.damage ? WW.damage.load() : 1); fx.trail(h.position.x, h.position.y, h.position.z, d.t < 0.8, 0.7, 1.0); }
        if (WW.damage && d.t < 3) WW.damage.want(3);
        if (h.position.y < 0.1) { d.alive = false; h.visible = false; if (fx) fx.splash(h.position.x, h.position.z, 0.9); }
      }
    }
  }

  function clearAll() {
    chutes.forEach(function (c) { c.alive = false; c.g.visible = false; });
    rafts.forEach(function (r) { r.alive = false; r.g.visible = false; r.dye.visible = false; });
    for (var k in wings) wings[k].forEach(function (d) { d.alive = false; d.h.visible = false; });
  }
  function stats() {
    var n = function (l) { return l.filter(function (o) { return o.alive; }).length; }, w = 0, wl = 0;
    for (var k in wings) { w += n(wings[k]); wl += wings[k].length; }
    return { chutes: n(chutes), rafts: n(rafts), wings: w, wingPool: wl, chutePool: chutes.length, raftPool: rafts.length };
  }

  WW.airProps = { init: init, chute: chute, raft: raft, wing: wing, update: update, clearAll: clearAll, stats: stats, _chutes: chutes, _rafts: rafts };
})();
