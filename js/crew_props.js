// crew_props.js - WW.crewProps: the small things the crews handle (visual only, Math.random, real time).
//  - Hose streams: pooled water droplets (one InstancedMesh) flying a parabola in ship-local space from a
//    damage-control hoseman's hands to the fire, so the stream stays on the deck while the ship steams on.
//  - Cargo nets: pooled rope nets (one InstancedMesh, alpha-tested canvas texture) hung on the hull side from
//    the rail to the water while a crew abandons ship (crew_ops.js atRail). They sink with the hull.
// Drawn after WW.crew.update (models_crew.js calls update), with the ship group matrices of this frame.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  var NDROP = 500, NNET = 40, G = -6.5, RATE = 70;
  var drops = [], dMesh = null, nMesh = null, ready = false, _m = null, _l = null, _v = null, _q = null, _s = null, _e = null;

  function netTex() {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'); x.strokeStyle = '#c9b48a'; x.lineWidth = 3;
    for (var i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16, 64); x.stroke(); x.beginPath(); x.moveTo(0, i * 16); x.lineTo(64, i * 16); x.stroke(); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3);
    return t;
  }
  function init() {
    if (ready || !WW.scene || !WW.models) return ready;
    _m = new THREE.Matrix4(); _l = new THREE.Matrix4(); _v = new THREE.Vector3(); _q = new THREE.Quaternion(); _s = new THREE.Vector3(); _e = new THREE.Euler();
    var dg = new THREE.IcosahedronGeometry(1, 0);
    dMesh = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: 0xc4e4fa, transparent: true, opacity: 0.9 }), NDROP);
    dMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); dMesh.frustumCulled = false; dMesh.count = 0;
    var ng = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);   // top edge at y = 0
    nMesh = new THREE.InstancedMesh(ng, new THREE.MeshToonMaterial({ map: netTex(), alphaTest: 0.5, side: THREE.DoubleSide, gradientMap: WW.models._grad(), color: 0xffffff }), NNET);
    nMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nMesh.frustumCulled = false; nMesh.count = 0; nMesh.castShadow = true;
    WW.scene.add(dMesh); WW.scene.add(nMesh);
    WW.on('roundStart', clear); WW.on('setupStart', clear);
    return (ready = true);
  }
  function clear() { drops.length = 0; if (dMesh) { dMesh.count = 0; nMesh.count = 0; } }

  // one hoseman's stream this frame: droplets from (hx, hy, hz) to (tx, ty, tz), all ship-local
  function hose(sh, hx, hy, hz, tx, ty, tz, dt) {
    if (!init()) return;
    var n = Math.floor(RATE * dt + R());
    for (var k = 0; k < n && drops.length < NDROP; k++) {
      var dx = tx - hx + (R() - 0.5) * 0.25, dz = tz - hz + (R() - 0.5) * 0.25, dy = ty - hy, d = Math.hypot(dx, dz);
      var T = 0.35 + d * 0.1, a = R() * dt;
      drops.push({ sh: sh, x: hx, y: hy, z: hz, vx: dx / T, vy: (dy - 0.5 * G * T * T) / T, vz: dz / T, t: a, T: T * (0.92 + R() * 0.12), r: 0.035 + R() * 0.03 });
    }
  }

  function update(dt) {
    if (!init()) return;
    var n = 0, cam = WW.camera.position, FAR = WW.crew.FAR, i, w = 0;
    for (i = 0; i < drops.length; i++) {
      var p = drops[i]; p.t += dt;
      if (p.t >= p.T || p.sh.removed || p.sh.sinking) continue;
      drops[w++] = p;
      var t = p.t, g = p.sh.group;
      _v.set(p.x + p.vx * t, p.y + p.vy * t + 0.5 * G * t * t, p.z + p.vz * t).applyMatrix4(g.matrix);
      if (cam.distanceToSquared(_v) > FAR * FAR) continue;
      var sc = p.r * (1 + t * 1.5);
      _m.makeScale(sc, sc * 1.3, sc).setPosition(_v); _m.toArray(dMesh.instanceMatrix.array, n * 16); n++;
    }
    drops.length = w;
    dMesh.count = n; dMesh.visible = n > 0; dMesh.instanceMatrix.needsUpdate = true;
    // cargo nets of abandoning crews
    var m = 0, recs = WW.crew.recs || [];
    for (i = 0; i < recs.length && m < NNET; i++) {
      var rec = recs[i], nets = rec.ops && rec.ops.nets; if (!nets || !nets.length) continue;
      var sh = rec.ship; if (sh.removed || cam.distanceToSquared(sh.group.position) > FAR * FAR) continue;
      sh.group.updateMatrix();
      for (var j = 0; j < nets.length && m < NNET; j++) {
        var nt = nets[j], zb = WW.crewOps.hullZ(sh.mk || sh.type, nt.x, 0) + 0.06, h = nt.y0 + 0.5, a = Math.atan2(nt.z0 - zb, h);
        _l.compose(_v.set(nt.x, nt.y0 + 0.05, nt.side * (nt.z0 + 0.02)), _q.setFromEuler(_e.set(nt.side * a, 0, 0)), _s.set(0.75, h / Math.cos(a), 1));
        _m.multiplyMatrices(sh.group.matrix, _l); _m.toArray(nMesh.instanceMatrix.array, m * 16); m++;
      }
    }
    nMesh.count = m; nMesh.visible = m > 0; nMesh.instanceMatrix.needsUpdate = true;
  }

  WW.crewProps = { init: init, hose: hose, update: function (dt) { try { update(dt); } catch (e) { if (!WW.crewProps._err) { WW.crewProps._err = e; console.error('crewProps', e); } } },
    clearAll: clear, stats: function () { return { drops: drops.length, nets: nMesh ? nMesh.count : 0 }; } };
})();
