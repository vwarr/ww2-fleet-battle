// fx_critical.js - WW.fxCritical: the big ones, drawn from the sim's events (visual only: Math.random, never WW.rand;
// reads the sim, never writes it). Load after effects.js. Toon style: the same lit puffs, glows and foam as
// effects.js, through WW.fx.raw, staged over seconds (a queue run from WW.fx.update) so the ring pools keep up.
//  - 'magazine' (ship_fires.js): Hood, Arizona, the destroyers at Guadalcanal. A white flash that lights the scene
//    (night_fx.js flash at night), a fireball several beams across along the hull, a shock ring racing out over the
//    water, debris thrown in smoking arcs, secondaries, then a towering mushroom of dark cordite smoke that lingers
//    for half a minute and leans with the wind. Scaled by hull length (k = length / 12: a destroyer 1, a battleship
//    ~1.9). The hull's break-up and the sinking belong to the sinking modules.
//  - 'deckHit' (ship_fires.js): the deck load or the hangar going up (Akagi, Kaga, Soryu at Midway). A chain of big
//    secondaries walking along the flight deck over several seconds, an elevator blown out of its well (a hangar
//    hit), and towering black avgas smoke for most of a minute.
//  - 'deckOut' (ship_deck.js) without a deck-load explosion: the bomb's burst through the deck and a smoke plume.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  var jobs = [], streams = [], emit = [];   // timed spawns; smoking debris; smoke emitters on a ship
  var stats = { magazine: 0, deck: 0, holed: 0 };
  function on() { return !WW.simOnly && WW.fx && WW.fx.raw && WW.fx.raw.pool('glow'); }
  function later(t, fn) { jobs.push({ t: t, fn: fn }); }
  function P(k) { return WW.fx.raw.pool(k); }
  function C(h) { return WW.fx.raw.col(h); }
  function wx() { return WW.fx.raw.windX(); }
  function wz() { return WW.fx.raw.windZ(); }
  // a point on the ship (local lx along the keel, lz across), or where she was
  function at(s, lx, lz, home) {
    if (s && !s.removed && s.toWorld) { var w = s.toWorld(lx, lz); return [w[0], w[1]]; }
    return [home[0] + lx, home[1] + lz];
  }
  function deckY(s) { return (s.group ? s.group.position.y : 0) + (s.model && s.model.deck ? s.model.deck.position.y : 2); }
  // a point on her deck (local lx along the keel, lz across) on the hull as posed (ship_swell.js: the swell, settling)
  var _pv = null;
  function onDeck(s, lx, lz, home) {
    if (s && !s.removed && s.group && WW.shipSwell && WW.shipSwell.posedPoint && typeof THREE !== 'undefined') {
      if (!_pv) _pv = new THREE.Vector3();
      var p = WW.shipSwell.posedPoint(s, lx, s.model && s.model.deck ? s.model.deck.position.y : 2, lz, _pv);
      return [p.x, p.z, p.y];
    }
    var w = at(s, lx, lz, home); return [w[0], w[1], s && !s.removed ? deckY(s) : 0.5];
  }

  // ---------- the magazine ----------
  function magazine(e) {
    var s = e.ship, L = s.stats.length || 12, k = L / 12, sq = Math.sqrt(k), home = [s.x, s.z];
    var c = Math.cos(s.heading), sn = Math.sin(s.heading), hx = e.hx === undefined ? s.x : e.hx, hz = e.hz === undefined ? s.z : e.hz;
    var lx0 = WW.clamp((hx - s.x) * c + (hz - s.z) * sn, -L * 0.35, L * 0.35), p0 = at(s, lx0, 0, home), x = p0[0], z = p0[1];
    var H = 22 * k + 6;   // the column's height
    stats.magazine++;
    // the flash: white-hot, lighting the sea round her (and the night sky). In the dark it is as bright but smaller
    // and shorter (nk), so it reads as a flash and not a white dome over the frame
    var nt = WW.fx.raw.night ? WW.fx.raw.night() : 0, nk = 1 - 0.6 * nt, D = WW.fx.raw.dim || function (c) { return c; };
    P('halo').spawn(x, 3 * sq, z, 0, 0, 0, 0.55 * (1 - 0.4 * nt), 8 * k * nk, 34 * k * nk, D(C(0xfff4dc), 1 - 0.3 * nt), C(0x8a4a20), 0, 0, 0);
    P('halo').spawn(x, 6 * sq, z, 0, 2, 0, 1.4 * (1 - 0.5 * nt), 6 * k * nk, 20 * k * nk, D(C(0xe8a060), 1 - 0.45 * nt), C(0x401808), 0, 0, 0);
    if (WW.nightFx && WW.nightFx.flash) WW.nightFx.flash(x, 10 * sq, z, 7 - 3 * nt, 1.6 - 0.9 * nt, 260);
    if (WW.emit) WW.emit('shipBoom', { ship: s, x: x, y: 3, z: z, size: 1.6 });   // the sound (audio_naval_wire.js)
    // the fireball: hot puffs along the hull, climbing
    for (var i = 0; i < 34; i++) {
      var p = at(s, lx0 + rr(-0.4, 0.4) * L, rr(-0.6, 0.6) * sq, home), hot = i < 18;
      P('glow').spawn(p[0], rr(0.5, 3) * sq, p[1], rr(-2.5, 2.5) * sq, rr(2, 9) * sq, rr(-2.5, 2.5) * sq, rr(1.4, 2.6),
        (hot ? 2.2 : 1.6) * k, (hot ? 5.2 : 4) * k, C(hot ? 0xffd890 : 0xff9a48), C(hot ? 0xf06a28 : 0xa02810), -0.8, 1.1, rr(-1, 1));
    }
    // the shock ring: foam racing out across the water, a second slower one behind it
    for (var r = 0; r < 44; r++) {
      var a = r / 44 * 6.283 + rr(-0.05, 0.05), v = 26 * sq;
      P('flat').spawn(x + Math.cos(a) * L * 0.3, 0.12, z + Math.sin(a) * L * 0.3, Math.cos(a) * v, 0, Math.sin(a) * v, 1.5, 2 * sq, 5 * sq, C(0xe8e8e8), C(0xe8e8e8), 0, 1.3, 0);
      if (r % 2) P('flat').spawn(x + Math.cos(a) * L * 0.2, 0.1, z + Math.sin(a) * L * 0.2, Math.cos(a) * v * 0.45, 0, Math.sin(a) * v * 0.45, 2.6, 2.5 * sq, 6 * sq, C(0xc8c8c8), C(0xc8c8c8), 0, 1, 0);
    }
    WW.fx.splash(at(s, L * 0.45, 0, home)[0], at(s, L * 0.45, 0, home)[1], 4 * sq);
    WW.fx.splash(at(s, -L * 0.45, 0, home)[0], at(s, -L * 0.45, 0, home)[1], 4 * sq);
    // debris: chunks and embers thrown in high arcs, the big ones trailing smoke
    for (var d = 0; d < 26; d++) {
      var b = R() * 6.283, o = rr(4, 13) * sq;
      P('solid').spawn(x, 2 * sq, z, Math.cos(b) * o, rr(10, 22) * sq, Math.sin(b) * o, rr(2.4, 3.6), rr(0.35, 0.8) * sq, 0.25 * sq, C(0x3a3430), C(0x5a524c), 14, 0.1, rr(-6, 6), true);
      P('halo').spawn(x, 2 * sq, z, Math.cos(b) * o * 1.1, rr(8, 20) * sq, Math.sin(b) * o * 1.1, rr(1.4, 2.4), 1.2 * sq, 0.5 * sq, C(0xf0a050), C(0x401000), 14, 0.1, 0, true);
    }
    for (var t = 0; t < 5; t++) { var bb = R() * 6.283, oo = rr(5, 11) * sq; streams.push({ x: x, y: 3 * sq, z: z, vx: Math.cos(bb) * oo, vy: rr(14, 24) * sq, vz: Math.sin(bb) * oo, t: 0, e: 0, k: sq }); }
    // the column: a dark stem boiling up, its first second lit from inside
    for (var q = 0; q < 10; q++) later(q * 0.12, function () {
      for (var j = 0; j < 4; j++) P('glow').spawn(x + rr(-1, 1) * sq, 2 * sq, z + rr(-1, 1) * sq, rr(-0.6, 0.6), H * 0.4 * rr(0.6, 1.2), rr(-0.6, 0.6), rr(1.2, 1.8), 2 * k, 3.6 * k, C(0xf8c080), C(0xa03818), 0, 0.5, rr(-1, 1));
    });
    for (var m = 0; m < 26; m++) later(m * 0.15, function () {
      var f = rr(0.25, 1);
      P('smoke').spawn(x + rr(-1, 1) * sq, 3 * sq, z + rr(-1, 1) * sq, wx() * 0.5 + rr(-0.4, 0.4), H * 0.35 * f, wz() * 0.5 + rr(-0.4, 0.4), rr(20, 28),
        2.2 * k, rr(3.8, 5) * k * (0.7 + 0.3 * f), C(R() < 0.5 ? 0x3c3430 : 0x4a403a), C(0x9a928a), 0, 0.35, rr(-0.3, 0.3));
    });
    // the mushroom cap: puffs at the top of the column rolling outward, leaning downwind
    for (var u = 0; u < 34; u++) later(1.4 + u * 0.07, function () {
      var a = R() * 6.283, out = rr(0.6, 2.2) * sq, y = H * rr(0.85, 1.08);
      P('smoke').spawn(x + Math.cos(a) * 2 * sq, y, z + Math.sin(a) * 2 * sq, Math.cos(a) * out + wx() * 1.4, rr(0.2, 0.9), Math.sin(a) * out + wz() * 1.4, rr(22, 32),
        2.5 * k, rr(5, 7.5) * k, C(R() < 0.5 ? 0x463c36 : 0x564c44), C(0xb0a8a0), 0, 0.22, rr(-0.2, 0.2));
    });
    // secondaries along what is left of her, and the fires on the water
    for (var n = 0; n < 7; n++) later(rr(0.3, 4.5), function () { var p2 = at(s, rr(-0.45, 0.45) * L, rr(-0.5, 0.5), home); WW.fx.explosion(p2[0], 1.5 * sq, p2[1], rr(1.8, 3) * sq); });
    emit.push({ s: s, home: home, lx: lx0, t: 0, life: 14, dt: 0.12, e: 0, kind: 'wreck', k: sq, L: L });
  }

  // ---------- the deck load / hangar ----------
  function deckHit(e) {
    var s = e.ship, L = s.stats.length || 26, home = [s.x, s.z], y = deckY(s), big = !!e.hangar || (e.load || 0) >= 6;
    var c = Math.cos(s.heading), sn = Math.sin(s.heading), hx = e.x === undefined ? s.x : e.x, hz = e.z === undefined ? s.z : e.z;
    var lx0 = WW.clamp((hx - s.x) * c + (hz - s.z) * sn, -L * 0.4, L * 0.4), n = Math.min(12, 4 + Math.round((e.load || 2) / 2) + (e.hangar ? 3 : 0));
    stats.deck++;
    var p0 = at(s, lx0, 0, home);
    var nt = WW.fx.raw.night ? WW.fx.raw.night() : 0, nk = 1 - 0.55 * nt, D = WW.fx.raw.dim || function (c) { return c; };   // night: smaller, shorter (magazine)
    if (WW.nightFx && WW.nightFx.flash) WW.nightFx.flash(p0[0], y + 6, p0[1], (big ? 5 : 3.5) * (1 - 0.4 * nt), 1.2 - 0.6 * nt, 200);
    P('halo').spawn(p0[0], y + 2, p0[1], 0, 0, 0, 0.5 * (1 - 0.4 * nt), 6 * nk, (big ? 22 : 15) * nk, D(C(0xfff0d0), 1 - 0.3 * nt), C(0x803818), 0, 0, 0);
    // the chain: blasts walking fore and aft from the hit, a few seconds apart at the end
    for (var i = 0; i < n; i++) (function (i) {
      var side = i % 2 ? 1 : -1, lx = WW.clamp(lx0 + side * Math.ceil(i / 2) * L * 0.09 + rr(-1.5, 1.5), -L * 0.46, L * 0.46), t = i === 0 ? 0 : 0.25 + i * rr(0.35, 0.65);
      later(t, function () {
        var p = at(s, lx, rr(-0.8, 0.8), home), sz = rr(2.4, 3.4) * (big ? 1.25 : 1);
        WW.fx.explosion(p[0], y + 0.5, p[1], sz);
        for (var j = 0; j < 6; j++) P('glow').spawn(p[0] + rr(-1, 1), y + rr(0.5, 2), p[1] + rr(-1, 1), rr(-2, 2), rr(3, 8), rr(-2, 2), rr(1, 1.8), 1.6, rr(3.5, 5) * (big ? 1.2 : 1), C(0xffe0a0), C(0xc04818), -0.6, 1.2, rr(-1, 1));
        for (var m = 0; m < 5; m++) P('smoke').spawn(p[0] + rr(-1, 1), y + 2, p[1] + rr(-1, 1), wx() + rr(-0.5, 0.5), rr(3, 6), wz() + rr(-0.5, 0.5), rr(14, 20), 2, rr(4, 6), C(0x2a2624), C(0x6a6460), -0.1, 0.25, rr(-0.3, 0.3));
        if (i < 4) for (var d = 0; d < 6; d++) { var b = R() * 6.283, o = rr(3, 8); P('solid').spawn(p[0], y + 1, p[1], Math.cos(b) * o, rr(8, 16), Math.sin(b) * o, rr(1.8, 2.6), rr(0.3, 0.6), 0.2, C(0x3a3430), C(0x5a524c), 14, 0.1, rr(-6, 6), true); }
      });
    })(i);
    if (e.hangar) later(0.6, function () {   // an elevator blown out of its well: a column of fire straight up
      var p = at(s, L * 0.28, 0, home);
      for (var j = 0; j < 14; j++) P('glow').spawn(p[0] + rr(-1, 1), y, p[1] + rr(-1, 1), rr(-1, 1), rr(10, 18), rr(-1, 1), rr(1.2, 2), 2, 4.5, C(0xfff0c0), C(0xd05020), 0.5, 0.8, rr(-1, 1));
      streams.push({ x: p[0], y: y + 1, z: p[1], vx: rr(-3, 3), vy: 20, vz: rr(-3, 3), t: 0, e: 0, k: 1.6 });
    });
    // the avgas smoke: towering black columns from the burning deck for most of a minute
    emit.push({ s: s, home: home, lx: lx0, t: 0, life: big ? 45 : 30, dt: big ? 0.22 : 0.3, e: 0, kind: 'avgas', L: L, y: y });
  }

  // ---------- a bomb through the flight deck ----------
  function deckOut(e) {
    if (e.boom) return;   // the deck-load explosion draws itself (deckHit)
    var s = e.ship, L = s.stats.length || 26, home = [s.x, s.z], y = deckY(s);
    var c = Math.cos(s.heading), sn = Math.sin(s.heading), hx = e.x === undefined ? s.x : e.x, hz = e.z === undefined ? s.z : e.z;
    var lx = WW.clamp((hx - s.x) * c + (hz - s.z) * sn, -L * 0.4, L * 0.4), p = at(s, lx, 0, home);
    stats.holed++;
    WW.fx.explosion(p[0], y + 0.4, p[1], 2.4);
    for (var d = 0; d < 8; d++) { var b = R() * 6.283, o = rr(2, 6); P('solid').spawn(p[0], y + 0.5, p[1], Math.cos(b) * o, rr(6, 12), Math.sin(b) * o, rr(1.4, 2), rr(0.25, 0.45), 0.15, C(0x5a5048), C(0x6a6058), 14, 0.1, rr(-6, 6), true); }
    emit.push({ s: s, home: home, lx: lx, t: 0, life: 12, dt: 0.35, e: 0, kind: 'hole', L: L, y: y });
  }

  // ---------- per frame ----------
  function update(dt) {
    if (!(dt > 0) || !on()) return;
    for (var i = jobs.length - 1; i >= 0; i--) if ((jobs[i].t -= dt) <= 0) { var f = jobs[i].fn; jobs.splice(i, 1); try { f(); } catch (e) { /* never break the frame */ } }
    for (var j = streams.length - 1; j >= 0; j--) {   // smoking debris arcs
      var q = streams[j]; q.t += dt; q.vy -= 14 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0 || q.t > 4) { WW.fx.splash(q.x, q.z, 0.8 * q.k); streams.splice(j, 1); continue; }
      if ((q.e -= dt) <= 0) { q.e = 0.05;   // a thick trail that swells as it hangs
        P('smoke').spawn(q.x, q.y, q.z, wx() * 0.4, 0.3, wz() * 0.4, rr(2.2, 2.8), 1.1 * q.k, 2.4 * q.k, C(0x4a4440), C(0xaaa49c), 0, 0.4, rr(-0.4, 0.4));
        if (R() < 0.4) P('glow').spawn(q.x, q.y, q.z, 0, 0, 0, 0.35, 0.6 * q.k, 0.3 * q.k, C(0xffc070), C(0x803010), 0, 0, 0); }
    }
    for (var k = emit.length - 1; k >= 0; k--) {
      var m = emit[k]; m.t += dt;
      if (m.t > m.life || (m.s.removed && m.kind !== 'wreck')) { emit.splice(k, 1); continue; }
      if ((m.e -= dt) > 0) continue;
      m.e = m.dt;
      var fade = 1 - m.t / m.life, y = m.s.removed ? 0.5 : m.y !== undefined ? deckY(m.s) : 0.4;
      if (m.kind === 'avgas') {
        for (var a = 0; a < 2; a++) {
          var p = onDeck(m.s, WW.clamp(m.lx + (a ? 1 : -1) * rr(0.05, 0.22) * m.L, -m.L * 0.45, m.L * 0.45), rr(-0.6, 0.6), m.home); y = m.s.removed ? y : p[2];
          P('smoke').spawn(p[0], y + 1, p[1], wx() * 1.2 + rr(-0.3, 0.3), rr(4, 6.5) * (0.6 + 0.4 * fade), wz() * 1.2 + rr(-0.3, 0.3), rr(16, 22), 1.6, rr(4, 6) * (0.6 + 0.4 * fade), C(R() < 0.6 ? 0x24201e : 0x34302c), C(0x6a6460), -0.05, 0.12, rr(-0.3, 0.3));
          if (R() < 0.6) WW.fx.fire(p[0], y + 0.3, p[1]);
        }
      } else if (m.kind === 'hole') {
        var h = onDeck(m.s, m.lx, 0, m.home); if (!m.s.removed) y = h[2];
        P('smoke').spawn(h[0], y + 0.6, h[1], wx() + rr(-0.3, 0.3), rr(2.5, 4), wz() + rr(-0.3, 0.3), rr(8, 12), 1, rr(2.5, 3.5) * (0.5 + 0.5 * fade), C(0x4e4a46), C(0x9a958e), -0.1, 0.25, rr(-0.3, 0.3));
      } else {   // the wreck: fires on the water where she went
        var w = at(m.s, m.lx + rr(-0.3, 0.3) * m.L, rr(-1, 1), m.home);
        WW.fx.fire(w[0], 0.3, w[1]);
        if (R() < 0.5) P('smoke').spawn(w[0], 1, w[1], wx() + rr(-0.3, 0.3), rr(2, 3.5), wz() + rr(-0.3, 0.3), rr(10, 14), 1.2 * m.k, 3.5 * m.k * (0.5 + 0.5 * fade), C(0x34302c), C(0x8a847e), -0.05, 0.2, rr(-0.3, 0.3));
      }
    }
  }
  function clear() { jobs.length = 0; streams.length = 0; emit.length = 0; }
  function safe(fn) { return function (e) { if (!on() || !e || !e.ship) return; try { fn(e); } catch (err) { console.error('fxCritical', err); } }; }

  WW.on('magazine', safe(magazine));
  WW.on('deckHit', safe(deckHit));
  WW.on('deckOut', safe(deckOut));
  WW.on('roundStart', clear);
  WW.on('setupStart', clear);
  if (WW.fx) { var u0 = WW.fx.update; WW.fx.update = function (dt) { u0(dt); try { update(dt); } catch (e) { /* visual only */ } }; }
  WW.fxCritical = { magazine: safe(magazine), deckHit: safe(deckHit), deckOut: safe(deckOut), clear: clear, stats: stats };
})();
