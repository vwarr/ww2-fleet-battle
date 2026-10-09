// air_render.js - instanced plane rendering (WW.planeRender). Load after aircraft.js.
// Every pooled plane model (models_planes.js / models_landplanes.js, through WW.air._pool) stays a normal
// Object3D group: the sim, air_deck.js (parking, wing fold), air_deaths.js (hidden sheared wings, poses),
// air_fx.js (prop disc / blades, dive brakes), air_aces.js and the cameras keep posing it as before. But its meshes
// are not drawn one by one: they sit on a layer the cameras do not render (LAYER), and once per render this module
// copies each visible mesh's world matrix into one InstancedMesh per (geometry, material) pair. The instances use
// the same shared geometry and the same toon material, so a plane looks exactly as it did, at any distance; only the
// draw calls change: about 8 per plane per pass (main + shadow) before, about 8 per plane TYPE now.
//   acquire(m) / release(m): a model enters / leaves the instanced set (aircraft.js getModel / release do this).
//   hero(m, on): draw this model's own meshes instead (for a future per-plane material effect); off by default.
//   enabled: false draws every model natively (A/B tests: tests/air_stress.js --off).
//   sync(): fills the instances; runs by itself from scene.onBeforeRender (after the scene's matrix update).
// A mesh is drawn when it and all its ancestors are visible and the group is in the scene: anything a game module
// hides (payload, a sheared wing, blades vs disc, a struck-below plane) is hidden here too. Meshes added to a
// plane group later (ace kill marks) are not registered and draw natively. Visual only: never touches WW.rand or
// sim state. Sim-only mode: everything is a no-op.
window.WW = window.WW || {};
(function () {
  'use strict';
  var LAYER = 7;                 // a layer no camera enables: registered meshes are skipped by the render lists
  var live = [];                 // registered models
  var buckets = {};              // geometry.uuid|material.uuid|shadow|order -> bucket
  var bucketList = [];
  var hooked = false, enabled = true, frame = 0;
  var noop = THREE.Object3D.prototype.onBeforeRender;
  var RAD = 4;                   // culling sphere around a plane (span 1.7 x ~3.2 units)
  var _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere(), culled = 0;

  function off() { return WW.simOnly || !WW.scene || !WW.renderer; }
  function bucketOf(mesh) {
    var k = mesh.geometry.uuid + '|' + mesh.material.uuid + '|' + (mesh.castShadow ? 1 : 0) + (mesh.receiveShadow ? 1 : 0) + '|' + mesh.renderOrder;
    var b = buckets[k];
    if (!b) {
      b = buckets[k] = { geo: mesh.geometry, mat: mesh.material, cast: mesh.castShadow, recv: mesh.receiveShadow, order: mesh.renderOrder, im: null, cap: 0, n: 0 };
      bucketList.push(b);
    }
    return b;
  }
  function grow(b, need) {
    var cap = Math.max(64, b.cap * 2); while (cap < need) cap *= 2;
    var im = new THREE.InstancedMesh(b.geo, b.mat, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false; im.castShadow = b.cast; im.receiveShadow = b.recv; im.renderOrder = b.order; im.count = 0;
    im.matrixAutoUpdate = false; im.name = 'planeRender';
    if (b.im) { im.instanceMatrix.array.set(b.im.instanceMatrix.array.subarray(0, b.cap * 16)); if (b.im.parent) b.im.parent.remove(b.im); b.im.dispose(); }
    b.im = im; b.cap = cap;
    WW.scene.add(im);
  }
  function setLayer(m, on) {
    for (var i = 0; i < m._ir.meshes.length; i++) { var o = m._ir.meshes[i].o; if (on) o.layers.set(LAYER); else o.layers.set(0); }
  }
  // Register a pooled model (idempotent). Its meshes are collected once: [{ o: mesh, b: bucket }].
  function acquire(m) {
    if (!m || !m.group || off()) return;
    hook();
    if (!m._ir) {
      var meshes = [];
      m.group.traverse(function (o) {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.isSkinnedMesh) return;
        meshes.push({ o: o, b: bucketOf(o), cb: o.onBeforeRender !== noop ? o.onBeforeRender : null });
      });
      m._ir = { meshes: meshes, live: false, hero: false };
    }
    if (!m._ir.live) { m._ir.live = true; live.push(m); }
    setLayer(m, enabled && !m._ir.hero);
  }
  function release(m) {
    if (!m || !m._ir || !m._ir.live) return;
    m._ir.live = false; setLayer(m, false);
    var i = live.indexOf(m); if (i >= 0) { live[i] = live[live.length - 1]; live.pop(); }
  }
  function hero(m, on) {
    if (!m || !m._ir) return;
    m._ir.hero = !!on; if (m._ir.live) setLayer(m, enabled && !on);
  }
  function setEnabled(on) {
    enabled = !!on;
    for (var i = 0; i < live.length; i++) setLayer(live[i], enabled && !live[i]._ir.hero);
    if (!enabled) for (var j = 0; j < bucketList.length; j++) if (bucketList[j].im) bucketList[j].im.count = 0;
  }

  // is the group drawn at all: visible up to the scene root
  function shown(o, root) {
    while (o) { if (!o.visible) return false; if (o === root) return true; o = o.parent; }
    return false;
  }
  function sync(renderer, scene, camera) {
    frame++;
    var i, b;
    for (i = 0; i < bucketList.length; i++) bucketList[i].n = 0;
    if (!enabled) return;
    var root = WW.scene, cull = camera && camera === WW.camera, sun = WW.sky && WW.sky.SUN_DIR;
    if (cull) { _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }
    culled = 0;
    for (i = 0; i < live.length; i++) {
      var m = live[i], ir = m._ir;
      if (ir.hero || !shown(m.group, root)) continue;
      var ms = ir.meshes, g = m.group;
      if (cull) { // out of view, and so is its shadow on the sea (the point below it along the sun): not drawn
        var w = g.matrixWorld.elements;
        _sp.center.set(w[12], w[13], w[14]); _sp.radius = RAD;
        if (!_fr.intersectsSphere(_sp)) {
          var y = Math.max(0, w[13]);
          if (!(sun && sun.y > 0.05) || (_sp.center.set(w[12] - sun.x * y / sun.y, 0, w[14] - sun.z * y / sun.y), _sp.radius = RAD + 2, !_fr.intersectsSphere(_sp))) { culled++; continue; }
        }
      }
      for (var k = 0; k < ms.length; k++) {
        var e = ms[k], o = e.o;
        if (e.cb) e.cb.call(o, renderer, scene, camera, o.geometry, o.material, null); // e.g. land planes' extra props
        // visible up to the group (the group itself was checked above)
        var p = o, vis = true;
        while (p && p !== g) { if (!p.visible) { vis = false; break; } p = p.parent; }
        if (!vis) continue;
        b = e.b;
        if (b.n >= b.cap) grow(b, b.n + 1);
        o.matrixWorld.toArray(b.im.instanceMatrix.array, b.n * 16);
        b.n++;
      }
    }
    for (i = 0; i < bucketList.length; i++) {
      b = bucketList[i];
      if (!b.im) continue;
      b.im.count = b.n;
      if (b.n) b.im.instanceMatrix.needsUpdate = true;
      if (b.im.parent !== WW.scene) WW.scene.add(b.im);
    }
  }
  // scene.onBeforeRender runs inside renderer.render after scene.updateMatrixWorld and before the render lists
  // and the shadow pass are built: the matrices are this frame's, and the instances are ready for both passes.
  function hook() {
    if (hooked || !WW.scene) return;
    hooked = true;
    var sc = WW.scene, prev = sc.onBeforeRender;
    sc.onBeforeRender = function (renderer, scene, camera, target) {
      if (prev && prev !== noop) prev.apply(this, arguments);
      sync(renderer, scene, camera);
    };
  }
  function stats() {
    var used = 0, inst = 0;
    for (var i = 0; i < bucketList.length; i++) if (bucketList[i].n) { used++; inst += bucketList[i].n; }
    return { models: live.length, culled: culled, buckets: bucketList.length, drawn: used, instances: inst, enabled: enabled };
  }

  WW.planeRender = { acquire: acquire, release: release, hero: hero, sync: sync, stats: stats, LAYER: LAYER,
    get enabled() { return enabled; }, set enabled(v) { setEnabled(v); } };
})();
