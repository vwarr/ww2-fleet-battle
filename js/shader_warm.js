// shader_warm.js (render only) - WW.shaderWarm: build every shader program BEFORE it is first seen.
// WebGL compiles a program the first time a material variant is drawn, and in three r149 that compile is synchronous
// (100-450 ms on an M1 Pro's ANGLE Metal for a toon variant, cold). Seen lazily, it froze the picture: the effect pools
// on the first action shot, a ship breaking in two (her clipped materials and their shadow variants), the first plane
// of a type (its instanced variant), flags, a cut to a part of the scene not yet drawn (tests/cut_freeze.js).
// So, before a frame is rendered (wrapping WW.post.render):
//   - every object in the scene whose (material, kind) has not been warmed yet, shown or hidden (the effect pools,
//     pooled models, hidden flags), plus proxies for variants made later: each ship material clipped as
//     ship_breakup.js clips it, the break's cut slab, every plane type's meshes as air_render.js instances them, the
//     flying boats and float planes;
//   - all their programs are created in one batch with renderer.compile() and status checks off, so ANGLE compiles
//     them in parallel (KHR_parallel_shader_compile) instead of one by one; the clipped ones under one global plane (the
//     same program as one local plane);
//   - then one tiny offscreen render of just those objects (a layer of their own) realises the rest: the shadow-map
//     depth variants (instanced, clipped).
// Runs at load, at each round start, and on a light sweep every 2 s for objects added since. The proxies are kept for
// the session: a program dies with its last material (ship_breakup.js disposes its clones), the proxies keep it alive.
// Visual only: no WW.rand, no sim state; the models built for the proxies use no random numbers. Off in sim-only mode.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  var LAYER = 30;                 // a layer no camera renders: the warm pass's own
  var R = null, rt = null, cam = null, clipPlane = null, empty = null, ext = null;
  var done = new Set();           // material uuid + object kind already warmed
  var clipped = new Map();        // ship material -> its clipped proxy mesh
  var proxies = [], clipProxies = [], fresh = [], freshClip = [];
  var pending = true, built = false, sweepT = 0, lastT = 0;
  var stats = { runs: 0, objects: 0, ms: 0, programs: 0, lastMs: 0, log: [] };   // log: ['A' create | 'B' draw, time, ms, objects, new programs, B: ms waited]

  function kindKey(o, m) { return m.uuid + (o.isInstancedMesh ? 'I' : o.isSprite ? 'S' : o.isPoints ? 'P' : o.isLine ? 'L' : '') + (o.isSkinnedMesh ? 'k' : '') + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : ''); }
  function mats(o) { return Array.isArray(o.material) ? o.material : [o.material]; }
  function isNew(o) { var ms = mats(o), n = false; for (var i = 0; i < ms.length; i++) { var k = kindKey(o, ms[i]); if (!done.has(k)) { done.add(k); n = true; } } return n; }

  // ---- proxies for the variants made later ----
  function addProxy(o, list) { if (isNew(o)) list.push(o); }
  function clipOf(o) { // one clipped copy per ship material, as ship_breakup.js build() makes them
    var ms = mats(o);
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!m || clipped.has(m) || m.clippingPlanes) continue;
      var c = m.clone(); c.clippingPlanes = [clipPlane]; c.clipShadows = true;
      var p = new THREE.Mesh(o.geometry, c); p.castShadow = o.castShadow; p.receiveShadow = o.receiveShadow;
      clipped.set(m, p); addProxy(p, freshClip); clipProxies.push(p);
    }
  }
  function shipProxies() {
    var ships = (WW.world && WW.world.ships) || [];
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i]; if (!s.group || s.removed) continue;
      var own = s.ownKids;
      s.group.children.forEach(function (k) { if (!own || own.has(k)) k.traverse(function (o) { if (o.material && (o.isMesh)) clipOf(o); }); });
    }
  }
  function buildOnce() { // planes (instanced like air_render.js), flying boats, float planes, the break's cut slab
    built = true;
    var M = WW.models; if (!M) return;
    var seen = new Set();
    var inst = function (o) {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.isSkinnedMesh) return;
      var k = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
      if (seen.has(k)) return; seen.add(k);
      var im = new THREE.InstancedMesh(o.geometry, o.material, 1); im.castShadow = o.castShadow; im.receiveShadow = o.receiveShadow; im.renderOrder = o.renderOrder;
      proxies.push(im); addProxy(im, fresh);
      if (o.material.transparent || !o.castShadow) { // the disc etc. are drawn natively too when a model is a hero
        var nm = new THREE.Mesh(o.geometry, o.material); nm.castShadow = o.castShadow; nm.receiveShadow = o.receiveShadow; proxies.push(nm); addProxy(nm, fresh);
      }
    };
    var native = function (o) { if (o.material && (o.isMesh || o.isSprite || o.isLine || o.isPoints)) { o.visible = true; proxies.push(o); addProxy(o, fresh); } };
    var kinds = Object.keys(WW.PLANE_TYPES || {}).concat(Object.keys(M.LAND_PLANES || {}));
    Object.keys(WW.NATIONS || {}).forEach(function (n) {   // every side's planes (Normandy's GER included)
      kinds.forEach(function (k) { try { var pm = M.buildPlane && M.buildPlane(k, n); if (pm) pm.group.traverse(inst); } catch (e) { /* a type that nation lacks */ } });
      try { if (M.buildFlyingBoat) { var fb = M.buildFlyingBoat(n); fb.group.updateMatrixWorld(true); fb.group.traverse(native); } } catch (e) { /* none */ }
      try { if (M.buildScout) { var sc = M.buildScout(n); sc.group.updateMatrixWorld(true); sc.group.traverse(native); } } catch (e) { /* none */ }
    });
    // materials put on pooled meshes as they are fired (combat.js shells, torpedoes, bombs, tracers; combat_aa.js rounds;
    // M.ord: the toon material of a falling bomb / aerial torpedo, drawn as a plain, non-instanced mesh)
    var box = new THREE.BoxGeometry(1, 1, 1);
    var bag = function (o) { for (var k in o) { var m = o[k]; if (m && m.isMaterial) { var p = new THREE.Mesh(box, m); proxies.push(p); addProxy(p, fresh); } } };
    var ci = WW.combat && WW.combat._i; if (ci) { if (ci.buildShared) ci.buildShared(); bag(ci.M); }
    var V = WW.combatAA && WW.combatAA._vis && WW.combatAA._vis();
    if (V) { bag(V); ['puff', 'core'].forEach(function (k) { var r = V[k]; if (r && r.mesh && !r.mesh.parent) { proxies.push(r.mesh); addProxy(r.mesh, fresh); } }); }
    // the shadow map's depth variants (three's WebGLShadowMap: RGBA-packed depth, the side flipped, clipped like the
    // caster): instanced or not, clipped or not, each side, receiving or not; three keeps one program per distinct key
    [false, true].forEach(function (inst) { [0, 1].forEach(function (cl) { [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].forEach(function (side) { [false, true].forEach(function (recv) {
      var m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: side });
      if (cl) { m.clippingPlanes = [clipPlane]; m.clipShadows = true; }
      var o = inst ? new THREE.InstancedMesh(box, m, 1) : new THREE.Mesh(box, m); o.castShadow = true; o.receiveShadow = recv; o.userData.depthOnly = true;
      if (cl) { clipProxies.push(o); addProxy(o, freshClip); } else { proxies.push(o); addProxy(o, fresh); }
    }); }); }); });
    if (M._grad) { // ship_breakup.js: the dark slab that closes the cut
      var cap = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshToonMaterial({ color: 0x2b2420, gradientMap: M._grad() }));
      proxies.push(cap); addProxy(cap, fresh);
    }
  }

  // ---- the warm pass ----
  // three r149 reads a new program's uniforms right after linking it (a blocking wait for that one link), so a plain
  // renderer.compile() still compiles one program after another. Here each new program's getUniforms is stubbed to throw
  // while compile() runs: every program is created and linking, none is waited for; three finishes the bookkeeping the
  // first time the material is drawn (its program found in its cache: a cheap, already-linked getUniforms).
  var SENT = { warm: 1 };
  function stub() { throw SENT; }
  function compileList(scene, camera, list, made) { // renderer.compile over just these objects (scene: its lights, fog)
    if (!list.length) return;
    var progs = R.info.programs;
    progs.push = function (pr) { pr._gu = pr.getUniforms; pr.getUniforms = stub; made.push(pr); return Array.prototype.push.apply(this, arguments); };
    scene.traverse = function (cb) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i], ms = mats(o), sides = ms.map(function (m) { return m && m.side; }), fog = scene.fog;
        if (ms[0] && ms[0].isMeshDepthMaterial) scene.fog = null;   // the shadow pass draws its depth materials without the fog
        try { cb(o); } catch (e) { if (e !== SENT) throw e; }
        finally {
          scene.fog = fog;
          for (var j = 0; j < ms.length; j++) if (ms[j] && ms[j].side !== sides[j]) ms[j].side = sides[j]; // compile() flips double-sided transparents
        }
      }
    };
    try { R.compile(scene, camera); }
    finally {
      delete scene.traverse; delete progs.push;
      for (var k = 0; k < made.length; k++) if (made[k]._gu) { made[k].getUniforms = made[k]._gu; delete made[k]._gu; }
    }
  }
  var batch = null;   // programs linking in the background: { all, made, t }
  function warm(scene, camera) {
    var t0 = performance.now(), p0 = R.info.programs.length;
    if (!built) buildOnce();
    shipProxies();
    var list = fresh; fresh = [];
    var clip = freshClip; freshClip = [];
    scene.traverse(function (o) { if (o.material && (o.layers.mask & 1) && isNew(o)) list.push(o); });
    if (!list.length && !clip.length) return;
    stats.runs++; stats.objects += list.length + clip.length;
    // 1) create every program at once, no status reads: they compile side by side
    var chk = R.debug.checkShaderErrors, prevRT = R.getRenderTarget(), made = [];
    R.debug.checkShaderErrors = false;
    try {
      compileList(scene, camera, list, made);
      if (clip.length) { // one global plane: the clipping state the clipped proxies will be drawn with
        R.clippingPlanes = [clipPlane]; R.setRenderTarget(rt); R.render(empty, camera);
        compileList(scene, camera, clip, made);
      }
    } finally { R.clippingPlanes = []; R.debug.checkShaderErrors = chk; R.setRenderTarget(prevRT); }
    batch = { all: list.concat(clip), made: made, t: performance.now() };
    stats.programs += R.info.programs.length - p0;
    stats.lastMs = performance.now() - t0; stats.ms += stats.lastMs;
    if (stats.log.length < 40) stats.log.push(['A', Math.round(t0), Math.round(stats.lastMs), batch.all.length, R.info.programs.length - p0]);
  }
  function linked(b) {
    if (!ext) return true;
    var gl = R.getContext();
    for (var i = 0; i < b.made.length; i++) { var p = b.made[i].program; if (p && !gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR)) return false; }
    return true;
  }
  // 2) once they have linked: one tiny render of just these objects (their own layer, shown, unculled) with the shadow
  // pass, which builds the shadow-map depth variants (instanced, clipped) and settles three's bookkeeping
  function realise(scene, camera, b) {
    var t0 = performance.now(), p0 = R.info.programs.length, prevRT = R.getRenderTarget();
    var all = b.all.filter(function (o) { return !o.userData.depthOnly; }), saved = [], lights = [];   // depth proxies: compiled, never drawn
    var tmp = new THREE.Group(); tmp.name = 'shaderWarm';
    for (var i = 0; i < all.length; i++) {
      var o = all[i];
      var top = o; while (top.parent) top = top.parent;
      if (top !== scene && top !== tmp) tmp.add(top);   // a proxy (or a proxy model's root) joins the pass
      saved.push([o, o.frustumCulled, o.layers.mask]); o.frustumCulled = false; o.layers.enable(LAYER);
      for (var a = o; a; a = a.parent) if (!a.visible) { saved.push([a, null, null]); a.visible = true; }
    }
    scene.add(tmp);
    scene.traverseVisible(function (o) { if (o.isLight && !o.layers.isEnabled(LAYER)) { o.layers.enable(LAYER); lights.push(o); } });
    cam.copy(camera); cam.layers.set(LAYER);
    try { R.setRenderTarget(rt); R.render(scene, cam); }
    catch (e) { console.error('shaderWarm', e); }
    finally {
      for (var j = saved.length - 1; j >= 0; j--) { var sv = saved[j]; if (sv[1] === null) sv[0].visible = false; else { sv[0].frustumCulled = sv[1]; sv[0].layers.mask = sv[2]; } }
      for (var k = 0; k < lights.length; k++) lights[k].layers.disable(LAYER);
      scene.remove(tmp);
      for (var q = tmp.children.length - 1; q >= 0; q--) tmp.remove(tmp.children[q]);
      R.setRenderTarget(prevRT);
      if (R.shadowMap) R.shadowMap.needsUpdate = true;
    }
    // the link checks three skipped (checkShaderErrors off while they were made): a broken shader still says so
    var gl = R.getContext();
    for (var m = 0; m < b.made.length; m++) {
      var pr = b.made[m];
      if (pr.program && !gl.getProgramParameter(pr.program, gl.LINK_STATUS)) console.error('THREE.WebGLProgram (shaderWarm): ' + pr.name + ' did not link: ' + gl.getProgramInfoLog(pr.program));
    }
    var ms = performance.now() - t0;
    stats.ms += ms; stats.programs += R.info.programs.length - p0;
    if (stats.log.length < 40) stats.log.push(['B', Math.round(t0), Math.round(ms), all.length, R.info.programs.length - p0, Math.round(t0 - b.t)]);
  }

  function init() {
    if (WW.simOnly || !WW.renderer || !WW.post || init.done) return;
    init.done = true;
    R = WW.renderer;
    ext = R.getContext().getExtension('KHR_parallel_shader_compile');   // lets the driver compile programs side by side
    R.localClippingEnabled = true;   // as ship_breakup.js sets it on the first break: the clipped variants warm right
    rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });   // linear, like post.js's scene target
    cam = new THREE.PerspectiveCamera(); empty = new THREE.Scene();
    clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);           // clips nothing
    var render = WW.post.render;
    WW.post.render = function (scene, camera) {
      var now = performance.now(), dt = lastT ? (now - lastT) / 1000 : 0; lastT = now;
      sweepT -= dt;
      try {
        if (batch) { if (linked(batch) || now - batch.t > 3000) { var b = batch; batch = null; realise(scene, camera, b); } }
        else if (pending || sweepT <= 0) { pending = false; sweepT = 2; warm(scene, camera); }
      } catch (e) { batch = null; console.error('shaderWarm', e); }
      return render.apply(this, arguments);
    };
  }
  WW.on('roundStart', function () { pending = true; });
  WW.shaderWarm = { init: init, stats: stats, warmNow: function () { pending = true; } };
  // main.js calls the modules' init in order; post.js's renderer exists once WW.post.init has run
  var pInit = WW.post && WW.post.init;
  if (pInit) WW.post.init = function () { var r = pInit.apply(this, arguments); init(); return r; };
})(window.WW);
