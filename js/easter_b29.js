// easter_b29.js - WW.easterB29: an easter egg (deliberately out of its time: the B-29 "Enola Gay", August 1945).
// A secret key sequence typed during a battle, the Konami code (up up down down left right left right B A) or the
// word "enola", sends a silver B-29 over very high, trailing contrails. It drops one bomb over the middle of the
// fleets; the flash whites out the screen, the fireball swells, a shock ring races out across the whole sea and a
// mushroom cloud towers over the map. As the ring passes, every ship sinks (the normal damage / sinking path,
// scorched), every plane falls, the island base is flattened (its facilities and runways through the base's own
// impact path, the palms laid flat, the huts gone) and the crews, boats and figures are gone. No caption about the
// event (the user's choice): the cloud stands a while, then the round ends with no victor and the next starts as usual.
//  - Nothing runs unless triggered: a key listener, and the reset on roundStart / setupStart. The models and effects
//    (easter_b29_fx.js) are built on the trigger. The sim is touched only after the trigger (kills through
//    Ship.takeDamage / Plane.damage / islandBase.impact), so traces are unchanged.
//  - Only in a live Pacific battle (game state 'battle'; not on the setup screen, in the victory hold, in Normandy or
//    in sim-only mode), once per round.
//  - While it runs it owns the camera (WW.cam.update is replaced and restored, as the test shot scripts do), the
//    round's end (WW.game.endRound is held until the caption is done), the sim pace (WW.time.warp) and the captions
//    (other captions are held off). Everything is restored on the next roundStart / setupStart, or on an error.
//  - Keys: the word's letters after the first are kept from the game's own keys while it is being typed (N new
//    battle, O, L diary, A pan): within GAP s of the previous letter only.
window.WW = window.WW || {};
(function () {
  'use strict';
  var KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  var WORD = 'enola', GAP = 0.9;
  // the timeline (real s after the trigger): release, burst (after the fall), the round's end
  var T_REL = 7, T_FALL = 5.5, T_DET = T_REL + T_FALL, T_END = T_DET + 19;
  var ALT = 240, SPEED = 24, AHEAD = 42;           // the bomber's height (above the clouds at 110-190), speed (u/s), the bomb's throw forward
  var SIM_RATE = 0.6, END_RATE = 1.2;              // sim s per real s while it runs / in the victory hold (WW.time.warp)
  var RING_T = 9;                                  // the ring reaches the farthest unit this long after the burst
  var kIdx = 0, wIdx = 0, wLast = 0, used = false, run = null;
  var now = function () { return performance.now() / 1000; };

  function ready() {
    var G = WW.game;
    return !WW.simOnly && !!G && G.state === 'battle' && !used && !run && !!WW.scene && !!WW.cam && !!WW.easterFx && (!WW.scn || WW.scn().id === 'pacific');
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    if (!ready()) { kIdx = wIdx = 0; return; }
    var k = (e.key || '').toLowerCase(), t = now();
    if (k === KONAMI[kIdx]) kIdx++;
    else kIdx = k === 'arrowup' ? (kIdx === 2 ? 2 : 1) : 0;   // up up up: still two ups in hand
    if (kIdx === KONAMI.length) { kIdx = wIdx = 0; e.stopPropagation(); fire(); return; }
    if (wIdx > 0 && k === WORD[wIdx] && t - wLast < GAP) { // the word goes on: keep this letter from the game's keys
      wIdx++; wLast = t; e.stopPropagation(); e.preventDefault();
      if (wIdx === WORD.length) { wIdx = kIdx = 0; fire(); }
      return;
    }
    wIdx = k === WORD[0] ? 1 : 0; wLast = t;
  }
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', onKey, true); // capture: before ui.js
  function reset() { used = false; kIdx = wIdx = 0; stop(); }
  if (WW.on) { WW.on('roundStart', reset); WW.on('setupStart', reset); }

  // ---------- start ----------
  function fire() {
    if (!ready()) return;
    used = true;
    if (WW.lookahead && WW.lookahead.desync) WW.lookahead.desync('b29');   // the egg rewrites the round: the look-ahead copy no longer holds
    try { start(); } catch (err) { console.error('easter_b29', err); stop(); }
  }
  function start() {
    var W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, S = WW.world.ships, sx = 0, sz = 0, n = 0;
    for (var i = 0; i < S.length; i++) if (S[i].alive) { sx += S[i].x; sz += S[i].z; n++; }
    var gz = n ? { x: WW.clamp(sx / n, 350, W - 350), z: WW.clamp(sz / n, 300, H - 300) } : { x: W / 2, z: H / 2 };
    // the bomber's run: across the map's short axis, from the south; the release point AHEAD short of ground zero
    var h0 = -Math.PI / 2 + (Math.random() - 0.5) * 0.6, f = { x: Math.cos(h0), z: Math.sin(h0) };
    var rel = { x: gz.x - f.x * AHEAD, z: gz.z - f.z * AHEAD };
    // the wide shot looks from where most of the ships are (the ring passes them in the foreground)
    var cx = 0, cz = 0;
    for (var j = 0; j < S.length; j++) if (S[j].alive) { var dx = S[j].x - gz.x, dz = S[j].z - gz.z, d = Math.hypot(dx, dz) + 1; cx += dx / d; cz += dz / d; }
    var cl = Math.hypot(cx, cz), ca = cl > 0.5 ? Math.atan2(cz, cx) : h0 + Math.PI / 2;
    var far = 300;
    S.forEach(function (s) { if (s.alive) far = Math.max(far, Math.hypot(s.x - gz.x, s.z - gz.z)); });
    WW.world.planes.forEach(function (p) { if (p.alive) far = Math.max(far, Math.hypot(p.x - gz.x, p.z - gz.z)); });
    var B = WW.islandBase && WW.islandBase.base;
    if (B) far = Math.max(far, Math.hypot(B.x - gz.x, B.z - gz.z) + 120);
    run = { t: 0, gz: gz, h0: h0, rel: rel, h: h0, x: rel.x - f.x * SPEED * T_REL, z: rel.z - f.z * SPEED * T_REL, y: ALT, roll: 0, pitch: 0,
      speed: Math.max(150, far / RING_T), ca: ca, det: false, ended: false, ringDone: false, hit: new Set(), base: false,
      props: null, wind: { x: WW.clamp((WW.wind ? WW.wind.x : 0.3) * 150, -140, 140), z: WW.clamp((WW.wind ? WW.wind.z : 0) * 150, -140, 140) },
      P: new THREE.Vector3(), L: new THREE.Vector3(), snap: true, top: WW.easterFx.BURST_Y, saved: {} };
    hold();
    WW.easterFx.start();
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
    if (WW.cam.mode === 'map') WW.cam.toggle();
  }
  // take over: the camera, the captions, the round's end, the crews' drawing; all put back by stop()
  function hold() {
    var sv = run.saved, cam = WW.cam, ui = WW.ui, G = WW.game, cr = WW.crew, lb = WW.lifeboats;
    sv.camUpdate = cam.update; cam.update = camUpdate;
    if (ui && ui.caption) { sv.caption = ui.caption; ui.caption = function () {}; }
    sv.endRound = G.endRound; G.endRound = function () {};   // the egg ends this round itself
    if (cr) {
      sv.crewUpdate = cr.update; sv.addFigure = cr.addFigure;
      cr.update = function (rdt) { // sailors of a ship the ring has passed are gone
        if (run && cr.recs) for (var i = 0; i < cr.recs.length; i++) { var rc = cr.recs[i]; if (run.hit.has(rc.ship)) { rc.sailors.length = 0; rc.spare.length = 0; } }
        return sv.crewUpdate.call(cr, rdt);
      };
      cr.addFigure = function (m) { // figures (the base's men, the boats' crews) inside the ring are not drawn
        if (run && run.det && Math.hypot(m.elements[12] - run.gz.x, m.elements[14] - run.gz.z) < run.ringR) return;
        return sv.addFigure.apply(cr, arguments);
      };
    }
    if (lb) sv.lbUpdate = lb.update;
  }
  function stop() {
    if (!run) return;
    var sv = run.saved, G = WW.game;
    run = null;
    if (sv.camUpdate) WW.cam.update = sv.camUpdate;
    if (sv.caption) WW.ui.caption = sv.caption;
    if (sv.endRound) G.endRound = sv.endRound;
    if (sv.crewUpdate) { WW.crew.update = sv.crewUpdate; WW.crew.addFigure = sv.addFigure; }
    if (sv.lbUpdate) WW.lifeboats.update = sv.lbUpdate;
    if (sv.props) sv.props.forEach(function (p) { p.o.rotation.copy(p.r); p.o.scale.copy(p.s); p.o.visible = p.v; if (p.o.children[1]) p.o.children[1].visible = true; });
    WW.time.warp = 1;
    if (WW.easterFx) WW.easterFx.stop();
    if (WW.cam && WW.cam.snap) WW.cam.snap();
  }

  // ---------- each frame (in place of the director camera) ----------
  function camUpdate(rdt) {
    try { tick(Math.min(0.1, rdt || 0)); }
    catch (err) { console.error('easter_b29', err); stop(); if (WW.cam.update !== camUpdate) WW.cam.update(rdt); }
  }
  function tick(dt) {
    var r = run, t = (r.t += dt), FX = WW.easterFx;
    WW.time.warp = WW.clamp((r.ended ? END_RATE : SIM_RATE) / Math.max(0.05, WW.time.scale * 0.5), 0.05, 8);
    fly(r, t, dt);
    var tau = t - T_DET;
    if (!r.det && tau >= 0) { r.det = true; FX.detonate(); }
    r.ringR = r.det ? r.speed * tau : 0;
    if (r.det) wipe(r);
    var st = FX.update(dt, t, t < T_DET + 14 && r.y > ALT * 0.6, r.det ? tau : -1, r.ringR, r.gz, r.wind);
    if (st) r.top = st.yc;
    if (!r.ended && t >= T_END) end(r);
    shoot(r, t, dt);
  }
  function say(main, sub, secs) { var c = run && run.saved.caption; if (c) c.call(WW.ui, main, sub, secs, false); }
  // the round's end: no victor (reason 'kill', no winner, no loser: both fleets are gone)
  function end(r) {
    r.ended = true;
    var er = r.saved.endRound; WW.game.endRound = er; r.saved.endRound = null;
    if (WW.game.state === 'battle') er.call(WW.game, null, 'kill', null);
    say('No victor', 'Both fleets lost', 7);
  }
  // the bomber: straight and level to the release, then the steep diving turn away (about 155 degrees)
  function fly(r, t, dt) {
    var m = WW.easterFx.plane(), b = WW.easterFx.bomb(), after = t - T_REL;
    var turn = after > 0.4 && after < 8.2 ? 0.34 : 0;
    r.h += turn * dt;
    r.roll += WW.clamp((turn ? 1.0 : 0) - r.roll, -0.8 * dt, 0.8 * dt);   // banked about 57 degrees in the turn
    var sp = SPEED * (after > 0 ? 1.12 : 1), vy = after > 0 && after < 9 ? -3.2 : 0;
    r.x += Math.cos(r.h) * sp * dt; r.z += Math.sin(r.h) * sp * dt; r.y += vy * dt;
    r.pitch += ((vy ? -0.1 : 0) - r.pitch) * Math.min(1, dt * 2);
    m.group.position.set(r.x, r.y, r.z); m.group.rotation.set(r.roll, -r.h, r.pitch);
    if (m.prop) m.prop.rotation.x += dt * 40;
    if (after < 0 || r.det) { b.visible = false; return; }
    // the bomb: thrown forward, falling faster, a slow tumble that settles nose-down
    var u = Math.min(1, after / T_FALL), fx = Math.cos(r.h0), fz = Math.sin(r.h0), d = AHEAD * (1 - (1 - u) * (1 - u));
    var y0 = ALT - 1.5, y1 = WW.easterFx.BURST_Y;
    b.visible = true; b.rotation.order = 'YZX'; b.position.set(r.rel.x + fx * d, y0 - (y0 - y1) * u * u, r.rel.z + fz * d);
    var vh = AHEAD * 2 * (1 - u) / T_FALL, vv = (y0 - y1) * 2 * u / T_FALL, w = Math.exp(-after * 0.9);
    b.rotation.set(Math.sin(after * 3.1) * 0.9 * w, -r.h0, -Math.atan2(vv, Math.max(0.01, vh)) + Math.sin(after * 4.3) * 0.5 * w);
  }
  // ---------- the wipe: what the ring has reached ----------
  function wipe(r) {
    var R2 = r.ringR * r.ringR, gz = r.gz, S = WW.world.ships, P = WW.world.planes;
    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      if (!s.alive || r.hit.has(s) || (s.x - gz.x) * (s.x - gz.x) + (s.z - gz.z) * (s.z - gz.z) > R2) continue;
      r.hit.add(s);
      try { s.takeDamage(s.hp + 1, s.x, s.z, 'bomb', 'big'); } catch (e) { console.error('easter_b29 ship', e); }
      try { scorch(s); } catch (e) { /* visual only */ }
    }
    for (var j = 0; j < P.length; j++) {
      var p = P[j];
      if (!p.alive || (p.x - gz.x) * (p.x - gz.x) + (p.z - gz.z) * (p.z - gz.z) > R2) continue;
      try { p.damage(p.hp + 1); } catch (e) { console.error('easter_b29 plane', e); }
    }
    var B = WW.islandBase && WW.islandBase.base;
    if (B && !r.base && Math.hypot(B.x - gz.x, B.z - gz.z) < r.ringR + 60) { r.base = true; flatten(B); }
    trees(r);
    if (!r.ringDone && r.ringR > r.speed * RING_T + 50) { // the ring has crossed it all: the boats and parachutes are gone
      r.ringDone = true;
      if (WW.lifeboats) { WW.lifeboats.clearAll(); WW.lifeboats.update = function () {}; }
      if (WW.airProps && WW.airProps.clearAll) WW.airProps.clearAll();
    }
  }
  function scorch(s) {
    var M = s.model && s.model.hullMats; if (!M) return;
    for (var i = 0; i < M.length; i++) if (M[i].color) M[i].color.multiplyScalar(0.42);
  }
  // the base: every facility and the runways through its impact path (craters, buildings out, planes on the ground)
  function flatten(B) {
    var IB = WW.islandBase, foe = WW.enemyOf(B.nation);
    B.facilities.forEach(function (f) { try { IB.impact(foe, f.x, f.z, 1e5, 'bomb'); } catch (e) { console.error('easter_b29 base', e); } });
    B.runways.forEach(function (w) { for (var k = -0.45; k <= 0.46; k += 0.15) try { IB.impact(foe, w.x + w.c * w.len * k, w.z + w.s * w.len * k, 1e5, 'bomb'); } catch (e) { /* next */ } });
  }
  // palms laid flat away from the burst, huts gone (terrain.js props; put back in stop() if the map is kept)
  function trees(r) {
    var g = WW.terrain && WW.terrain._props && WW.terrain._props();
    if (!g) return;
    if (!r.props) { r.props = g.children.slice(); r.saved.props = []; }
    var R2 = r.ringR * r.ringR, L = r.props;
    for (var i = L.length - 1; i >= 0; i--) {
      var o = L[i], dx = o.position.x - r.gz.x, dz = o.position.z - r.gz.z;
      if (dx * dx + dz * dz > R2) continue;
      L.splice(i, 1);
      r.saved.props.push({ o: o, r: o.rotation.clone(), s: o.scale.clone(), v: o.visible });
      var hut = o.children[1] && Math.abs(o.children[1].position.y - 1.5) < 1e-3;
      if (hut) { o.visible = false; continue; }
      o.rotation.set(0, -Math.atan2(dz, dx), -1.4);   // the trunk down along the blast
      if (o.children[1]) o.children[1].visible = false; // the fronds stripped
    }
  }

  // ---------- the camera ----------
  var _gP = new THREE.Vector3(), _gL = new THREE.Vector3();
  function shoot(r, t, dt) {
    var cam = WW.camera, m = WW.easterFx.plane().group, b = WW.easterFx.bomb(), k = 1 - Math.exp(-dt * 2.5);
    if (t < T_REL) {            // the bomber: alongside and a little behind, easing in closer and lower
      var f = { x: Math.cos(r.h), z: Math.sin(r.h) }, sd = { x: -f.z, z: f.x }, e = Math.min(1, t / T_REL);
      var back = 15 - 6 * e, side = 6 + 2 * e, up = 2.5 - 3 * e;
      _gP.set(r.x - f.x * back + sd.x * side, r.y + up, r.z - f.z * back + sd.z * side);
      _gL.set(r.x + f.x * 5, r.y, r.z + f.z * 5);
    } else if (!r.det) {        // the fall: above and beside the bomb, looking down on it and the sea below
      var u = Math.min(1, (t - T_REL) / T_FALL), fx = Math.cos(r.h0), fz = Math.sin(r.h0), ex = u * u * (3 - 2 * u);
      _gP.set(r.rel.x + fx * (AHEAD * 0.75 * ex - 7) - fz * 7, ALT + 5 - (ALT - WW.easterFx.BURST_Y) * 0.4 * ex, r.rel.z + fz * (AHEAD * 0.75 * ex - 7) + fx * 7);
      _gL.copy(b.position); k = 1 - Math.exp(-dt * 6);
    } else {                    // the wide shot from beyond the ships, pulling back and rising with the cloud
      var tau = t - T_DET, a = r.ca + tau * 0.006, D = 1050 + 10 * tau;
      _gP.set(r.gz.x + Math.cos(a) * D, 32 + 4 * tau, r.gz.z + Math.sin(a) * D);
      _gL.set(r.gz.x, Math.max(90, r.top * 0.5), r.gz.z);
      if (!r.wide) { r.wide = true; r.snap = true; }
      k = 1 - Math.exp(-dt * 1.5);
    }
    if (r.snap) { r.P.copy(_gP); r.L.copy(_gL); r.snap = false; }
    else { r.P.lerp(_gP, k); r.L.lerp(_gL, Math.min(1, k * 1.6)); }
    cam.position.copy(r.P); cam.lookAt(r.L); cam.updateMatrixWorld();
  }

  WW.easterB29 = { trigger: function () { fire(); return !!run; }, active: function () { return !!run; },
    _dbg: function () { return run ? { t: +run.t.toFixed(2), det: run.det, ringR: Math.round(run.ringR || 0), hit: run.hit.size, ended: run.ended, base: run.base } : null; } };
})();
