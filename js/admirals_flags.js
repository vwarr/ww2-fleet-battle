// admirals_flags.js - command made visible (visual only: Math.random and the wall clock, never WW.rand; reads the
// sim, never writes it; nothing in sim-only mode). On each side's flagship (WW.admirals, the 'flagship' event):
//  - the admiral's pennant at the masthead (USN: blue with white stars; IJN: white with a red sun and band);
//  - a toy signal hoist of 1-3 flags on the yardarm, changed with the posture and the orders ('admiralOrder'):
//    search / approach / engage / press / withdraw / pursue, a strike hoist for 20 s at a launch, the IJN Z flag
//    when it presses (Tsushima);
//  - blinker lamps at night (only when the sim exposes WW.daylight as a number or { level } below 0.35): the
//    flagship's lamp and the replies of its two nearest escorts.
// Captions: the admirals at the start, the first strike, press / retire / pursue (WW.airCaptions.say, throttled),
// and the flag transfer (WW.ui.caption at the first free moment: it must be seen).
// The rig: 2 pooled sets (pennant, 3 flags, halyard, lamp), shared geometry and 10 shared materials. The masthead
// comes from the highest vertex of the ship's model (cached per type and nation). Load after air_captions.js.
window.WW = window.WW || {};
(function () {
  'use strict';
  var FW = 0.9, FH = 0.6, GAP_Y = 0.68, STRIKE_SHOW = 20, NIGHT = 0.35;
  var mats = null, geo = null, rigs = {}, tops = {}, lamps = [], queue = [], strikeUntil = {}, cmd = {}, newFlag = null;
  var wall = function () { return performance.now() / 1000; };
  // signal flags: 0 Z (quartered), 1 B red, 2 N checks, 3 G stripes, 4 P blue/white, 5 V saltire, 6 O diagonal, 7 E blue/red, 8 H white/red
  var HOIST = { search: [4, 2], approach: [3, 8, 2], engage: [1, 6, 8], press: [1, 5, 1], withdraw: [7, 4], pursue: [6, 1, 3], strike: [3, 3, 1] };
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); draw(g, w, h);
    var t = new THREE.CanvasTexture(c); t.magFilter = THREE.LinearFilter; return t;
  }
  var R = '#c8322c', Y = '#f2c230', BL = '#24479a', W = '#f4f1e8', K = '#1d1d1d';
  var DRAW = [
    function (g, w, h) { tri(g, [[0, 0], [w, 0], [w / 2, h / 2]], Y); tri(g, [[0, 0], [0, h], [w / 2, h / 2]], K); tri(g, [[0, h], [w, h], [w / 2, h / 2]], R); tri(g, [[w, 0], [w, h], [w / 2, h / 2]], BL); },
    function (g, w, h) { g.fillStyle = R; g.fillRect(0, 0, w, h); },
    function (g, w, h) { for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? W : BL; g.fillRect(i * w / 4, j * h / 4, w / 4, h / 4); } },
    function (g, w, h) { for (var i = 0; i < 6; i++) { g.fillStyle = i % 2 ? BL : Y; g.fillRect(i * w / 6, 0, w / 6, h); } },
    function (g, w, h) { g.fillStyle = BL; g.fillRect(0, 0, w, h); g.fillStyle = W; g.fillRect(w / 3, h / 3, w / 3, h / 3); },
    function (g, w, h) { g.fillStyle = W; g.fillRect(0, 0, w, h); g.strokeStyle = R; g.lineWidth = h / 5; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke(); },
    function (g, w, h) { tri(g, [[0, 0], [w, 0], [0, h]], R); tri(g, [[w, 0], [w, h], [0, h]], Y); },
    function (g, w, h) { g.fillStyle = BL; g.fillRect(0, 0, w, h / 2); g.fillStyle = R; g.fillRect(0, h / 2, w, h / 2); },
    function (g, w, h) { g.fillStyle = W; g.fillRect(0, 0, w / 2, h); g.fillStyle = R; g.fillRect(w / 2, 0, w / 2, h); }
  ];
  function tri(g, p, c) { g.fillStyle = c; g.beginPath(); g.moveTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]); g.lineTo(p[2][0], p[2][1]); g.closePath(); g.fill(); }
  function lambert(map) { return new THREE.MeshLambertMaterial({ map: map, side: THREE.DoubleSide }); }
  function setup() {
    if (mats || WW.simOnly || typeof THREE === 'undefined' || !WW.scene) return !!mats;
    mats = { flag: DRAW.map(function (d) { return lambert(canvasTex(48, 32, d)); }) };
    mats.USN = lambert(canvasTex(96, 24, function (g, w, h) { g.fillStyle = BL; g.fillRect(0, 0, w, h); g.fillStyle = W; [18, 36].forEach(function (x) { star(g, x, h / 2, 6); }); }));
    mats.IJN = lambert(canvasTex(96, 24, function (g, w, h) { g.fillStyle = W; g.fillRect(0, 0, w, h); g.fillStyle = R; g.fillRect(0, h * 0.72, w, h * 0.28); g.beginPath(); g.arc(20, h * 0.4, 7, 0, 7); g.fill(); }));
    mats.line = new THREE.LineBasicMaterial({ color: 0x2a2a2a });
    mats.lamp = new THREE.SpriteMaterial({ map: canvasTex(32, 32, function (g, w) { var r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,250,225,1)'); r.addColorStop(0.3, 'rgba(255,225,150,0.7)'); r.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    geo = { flag: new THREE.PlaneGeometry(FW, FH).translate(-FW / 2, -FH / 2, 0), // hoist edge on the line (x 0), flying aft
      pennant: new THREE.BufferGeometry() };
    geo.pennant.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.42, 0, -1.6, -0.21, 0], 3));
    geo.pennant.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0.5], 2));
    geo.pennant.computeVertexNormals();
    for (var i = 0; i < 4; i++) { var l = new THREE.Sprite(mats.lamp); l.scale.set(2.2, 2.2, 1); l.visible = false; l.name = 'admLamp'; WW.scene.add(l); lamps.push(l); }
    return true;
  }
  function star(g, x, y, r) { g.beginPath(); for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.closePath(); g.fill(); }
  function rigFor(n) {
    if (rigs[n]) return rigs[n];
    var g = new THREE.Group(); g.name = 'admRig';
    var pen = new THREE.Mesh(geo.pennant, mats[n]); g.add(pen);
    var flags = [0, 1, 2].map(function () { var m = new THREE.Mesh(geo.flag, mats.flag[0]); g.add(m); return m; });
    var hal = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), mats.line); g.add(hal);
    var lamp = new THREE.Sprite(mats.lamp); lamp.scale.set(2.2, 2.2, 1); lamp.visible = false; g.add(lamp);
    return (rigs[n] = { group: g, pen: pen, flags: flags, hal: hal, lamp: lamp, ship: null, code: null, nation: n });
  }
  // the masthead in ship-local coordinates: the highest model vertex (rigs and crew left out)
  function masthead(s) {
    var key = s.type + ':' + s.nation; if (tops[key]) return tops[key];
    var grp = s.group, inv = new THREE.Matrix4(), v = new THREE.Vector3(), best = null;
    grp.updateMatrixWorld(true); inv.copy(grp.matrixWorld).invert();
    grp.traverse(function (o) {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position || o.name === 'admRig' || (o.parent && o.parent.name === 'admRig')) return;
      var p = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); if (!best || v.y > best.y) best = v.clone(); }
    });
    return (tops[key] = best || new THREE.Vector3(0, s.hullTop || 6, 0));
  }
  function attach(n, s) {
    if (!setup()) return;
    var r = rigFor(n); r.ship = s;
    if (r.group.parent) r.group.parent.remove(r.group);
    if (!s || !s.group) return;
    var m = masthead(s), Z = m.z + 0.75;
    r.group.position.set(m.x, m.y, 0); s.group.add(r.group);
    r.pen.position.set(0, 0.02, m.z);
    r.flags.forEach(function (f, i) { f.position.set(0, -0.45 - i * GAP_Y, Z); });
    r.hal.geometry.setFromPoints([new THREE.Vector3(0, -0.3, Z), new THREE.Vector3(-0.15, -0.45 - 3 * GAP_Y, Z)]);
    r.lamp.position.set(0.4, -Math.min(2.4, m.y * 0.35), m.z);
    r.code = null; show(n);
  }
  // the hoist for the side's current posture (or a launch)
  function show(n) {
    var r = rigs[n], A = WW.admirals && WW.admirals.of(n); if (!r || !A) return;
    var p = wall() < (strikeUntil[n] || 0) ? 'strike' : A.posture, code = (HOIST[p] || HOIST.search).slice();
    if (p === 'press' && n === 'IJN') code = [0];
    var key = p + code.join(); if (r.code === key) return; r.code = key;
    r.flags.forEach(function (f, i) { f.visible = i < code.length; if (f.visible) f.material = mats.flag[code[i]]; });
  }
  function daylight() {
    var d = WW.daylight; if (typeof d === 'function') { try { d = d(); } catch (e) { return null; } }
    if (d && typeof d === 'object') d = d.level !== undefined ? d.level : d.light;
    return typeof d === 'number' && isFinite(d) ? d : null;
  }
  // per frame (real time): flutter, hoist changes, night lamps, captions
  var lampT = 0, lampOn = [], phase = 0;
  function frame(rdt) {
    var t = wall(), n, r;
    for (n in rigs) {
      r = rigs[n]; if (!r.ship || !r.group.parent) continue;
      show(n);
      r.pen.rotation.y = Math.sin(t * 5.3) * 0.2;
      for (var i = 0; i < r.flags.length; i++) r.flags[i].rotation.y = Math.sin(t * 6 + i * 1.7) * 0.28 + 0.1;
    }
    var dl = daylight(), night = dl !== null && dl < NIGHT && WW.game && WW.game.state === 'battle';
    lampT -= rdt;
    if (lampT <= 0) { lampT = 0.12 + Math.random() * 0.16; phase = (phase + 1) % 40; for (var k = 0; k < 3; k++) lampOn[k] = Math.random() < 0.55; }
    var li = 0;
    for (n in rigs) {
      r = rigs[n]; var s = r.ship, live = night && s && s.alive && !s.sinking && r.group.parent;
      r.lamp.visible = !!(live && phase < 20 && lampOn[0]);   // the flagship signals, then its escorts answer
      if (!live) continue;
      var es = escorts(s);
      for (var j = 0; j < es.length && li < lamps.length; j++, li++) {
        var e = es[j], L = lamps[li];
        L.visible = phase >= 20 && lampOn[1 + j];
        L.position.set(e.x, (e.hullTop || 4) * 0.7, e.z);
      }
    }
    for (; li < lamps.length; li++) lamps[li].visible = false;
    captions(t);
  }
  function escorts(s) {
    var out = [], d1 = 160 * 160, a = null, ad = d1, b = null, bd = d1;
    for (var i = 0; i < WW.world.ships.length; i++) {
      var q = WW.world.ships[i]; if (q === s || !q.alive || q.sinking || q.nation !== s.nation || q.submerged) continue;
      var d = WW.dist2(q.x, q.z, s.x, s.z);
      if (d < ad) { b = a; bd = ad; a = q; ad = d; } else if (d < bd) { b = q; bd = d; }
    }
    if (a) out.push(a); if (b) out.push(b);
    return out;
  }
  // captions: queued, shown when the throttle allows (dropped after `until`); a flag transfer bypasses the throttle
  function captions(t) {
    if (!queue.length || !WW.ui || !WW.ui.caption || !WW.game || WW.game.state !== 'battle') return;
    queue = queue.filter(function (q) { return t < q.until; });
    var q = queue[0]; if (!q || t < q.at) return;
    var shown = q.must ? (!(WW.ui.captionOn && WW.ui.captionOn()) && (WW.ui.caption(q.main, q.sub, 5, true), true)) : WW.airCaptions && WW.airCaptions.say(q.main, q.sub);
    if (shown) queue.shift();
  }
  function add(main, sub, opts) {
    opts = opts || {}; var t = wall();
    queue.push({ main: main, sub: sub || '', at: t + (opts.delay || 0), until: t + (opts.delay || 0) + (opts.keep || 10), must: !!opts.must, nation: opts.nation, lost: !!opts.lost });
    queue.sort(function (a, b) { return (b.must - a.must) || (a.at - b.at); });
  }
  if (!WW.simOnly) {
    WW.on('flagship', function (e) { if (e) attach(e.nation, e.ship); });
    WW.on('admiralOrder', function (e) {
      if (!e) return;
      if (e.order === 'strike') { strikeUntil[e.nation] = wall() + STRIKE_SHOW; if (e.first) add(e.text, e.carrier && e.carrier.name ? 'strike away from ' + e.carrier.name : ''); }
      else if (e.order === 'command') {
        cmd[e.nation] = e;
        if (cmd.USN && cmd.IJN) {
          var u = WW.admirals.of('USN'), j = WW.admirals.of('IJN');
          add(u.title + '  vs  ' + j.title, (u.flagName && j.flagName ? 'flags in ' + u.flagName + ' and ' + j.flagName + ' · ' : '') + u.style + ' vs ' + j.style, { delay: 7, keep: 25 });
          cmd = {};
        }
      } else if (e.order === 'press' || e.order === 'retire' || e.order === 'pursue' || e.order === 'reserve') add(e.text, '', { keep: 8 });
      else if (e.order === 'transfer') { queue = queue.filter(function (q) { return q.nation !== e.nation || !q.lost; }); newFlag = { ship: e.ship, until: wall() + 25 }; add(e.text, 'command passes after ' + Math.round(e.t - ((WW.admirals.of(e.nation) || {}).confusedAt || e.t)) + ' s of confusion', { must: true, keep: 20 }); }
      else if (e.order === 'flagLost') add(e.text, e.sub || '', { keep: 6, nation: e.nation, lost: true });
      var r = rigs[e.nation]; if (r) show(e.nation);
    });
    var clear = function () { queue = []; newFlag = null; cmd = {}; strikeUntil = {}; for (var n in rigs) { var r = rigs[n]; r.ship = null; if (r.group.parent) r.group.parent.remove(r.group); } lamps.forEach(function (l) { l.visible = false; }); };
    WW.on('setupStart', clear);
    // roundStart: admirals.js (loaded earlier) has already emitted 'flagship' for this round; nothing to clear here
    // the director's candidate: the new flagship, for 25 s after a flag transfer (the caption goes with it)
    (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
      var f = newFlag; if (!f || wall() > f.until || !f.ship || !f.ship.alive) return;
      add(9, 'orbit', f.ship, { r: f.ship.stats.length * 1.3 + 12, dur: dur(12, 15), w: 0.045 });
    });
    if (WW.cam && WW.cam.update) {
      var u0 = WW.cam.update;
      WW.cam.update = function (rdt) { var res = u0.apply(this, arguments); try { frame(rdt || 0); } catch (e) { /* flags never break the camera */ } return res; };
    }
  }
  WW.admiralFlags = { rigs: rigs, masthead: masthead, HOIST: HOIST, daylight: daylight, queue: function () { return queue; } };
})();
