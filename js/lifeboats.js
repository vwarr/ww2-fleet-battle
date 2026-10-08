// lifeboats.js - WW.lifeboats: a sinking ship's crew takes to its boats (visual only).
// ~1.2 s into a sinking, whaleboats (carrier 4, battleship 3, cruiser 2) or one yellow raft (destroyer,
// submarine, PT boat) drop from the sides and row on sim time toward the nearer of a live friendly ship
// or the shore (re-picked every few seconds). They steer around live hulls, keep off land unless the shore
// is their goal, leave a small wake and rock their oars. A friendly ship picks a boat up (it sinks out of
// sight and its sailors join that ship's crew, WW.crew.adopt); a boat that reaches land beaches and its
// sailors stand on the sand until the round ends; a boat with no goal drifts and fades out after ~90 s.
// Not in WW.world.ships, no damage, no AI interest. Math.random only. A fixed pool, cleared on
// roundStart / setupStart. Seated / standing sailors are drawn by WW.crew (addFigure).
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random, PI = Math.PI;
  var N = 36, SPEED = 1.2, TURN = 0.8, NOGOAL = 90, MAXLIFE = 260;
  var BOATS = { carrier: 4, battleship: 3, cruiser: 2, destroyer: 1, submarine: 1, pt: 1 };
  var BOAT = 0xe4dccb, WOOD = 0x9a7650, RAFT = 0xe2b448, RAFT_IN = 0xa8802e, OAR = 0xb08d62;
  var pool = [], ready = false, picked = 0, beached = 0, _m = null, _l = null, _v = null;
  // seated figure spots (boat local, feet below the gunwale): [x, z, yaw, role]
  var SEATS = { boat: [[0.28, 0, PI, 'c'], [-0.18, 0, PI, 'c'], [-0.6, 0, 0, 'o']], raft: [[0.18, 0.08, -PI / 2, 'c'], [-0.2, -0.06, PI / 2, 'c']] };

  function init() {
    if (ready || !WW.scene || !WW.models || !WW.models._geo) return ready;
    var M = WW.models, G = M._geo(), mat = M._mat;
    _m = new THREE.Matrix4(); _l = new THREE.Matrix4(); _v = new THREE.Vector3();
    for (var i = 0; i < N; i++) {
      var g = new THREE.Group(), boat = new THREE.Group(), raft = new THREE.Group(), oars = [];
      M._mesh(boat, G.sph, BOAT, 1.55, 0.36, 0.58, 0, 0.02, 0);
      M._mesh(boat, G.sph, WOOD, 1.3, 0.1, 0.44, 0, 0.15, 0);
      M._bar(boat, WOOD, 0.08, 0.03, 0.46, 0.05, 0.16, 0);           // thwart
      for (var k = 0; k < 2; k++) for (var sd = -1; sd <= 1; sd += 2) {
        var o = new THREE.Group(); o.position.set(k ? -0.15 : 0.3, 0.17, sd * 0.26); boat.add(o);
        M._mesh(o, G.box, OAR, 0.04, 0.03, 0.85, 0, 0, sd * 0.4);
        o.userData.sd = sd; oars.push(o);
      }
      M._mesh(raft, G.disc, RAFT, 1.1, 0.16, 0.78, 0, -0.04, 0);
      M._mesh(raft, G.disc, RAFT_IN, 0.8, 0.17, 0.52, 0, -0.03, 0);
      g.add(boat); g.add(raft);
      g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.visible = false; WW.scene.add(g);
      pool.push({ g: g, boat: boat, raft: raft, oars: oars, alive: false });
    }
    WW.on('roundStart', clearAll); WW.on('setupStart', clearAll);
    return (ready = true);
  }
  function free() { for (var i = 0; i < pool.length; i++) if (!pool[i].alive) return pool[i]; return null; }
  function hide(b) { b.alive = false; b.g.visible = false; }
  function clearAll() { pool.forEach(hide); picked = beached = 0; }

  function launch(ship) {
    ship._boats = true;
    if (ship.type === 'submarine' && ship.depthY < -0.6) return;
    var n = BOATS[ship.type] || 1, L = ship.stats.length, raft = n === 1;
    for (var i = 0; i < n; i++) {
      var b = free(); if (!b) return;
      var side = (i % 2 ? -1 : 1) * (R() < 0.5 ? -1 : 1);
      b.alive = true; b.kind = raft ? 'raft' : 'boat'; b.nation = ship.nation; b.from = ship; b.state = 'wait';
      b.delay = 0.2 + i * 0.7 + R() * 0.8; b.lx = (n === 1 ? 0 : (i / (n - 1) - 0.5) * L * 0.55) + (R() - 0.5) * 1.5; b.side = side;
      b.t = 0; b.noGoal = 0; b.goal = null; b.goalT = 0; b.landT = 0; b.land = null; b.ph = R() * 6.28; b.wakeT = R() * 0.5;
      b.fig = SEATS[b.kind]; b.stand = null; b.v = 0;
      b.boat.visible = !raft; b.raft.visible = raft;
    }
  }
  function appear(b) {
    var s = b.from, half = (s.beam || s.stats.length / 7) * 0.5 + 0.9, p = s.toWorld(b.lx, b.side * half);
    b.x = p[0]; b.z = p[1]; b.h = s.heading + b.side * (PI / 2) * (0.6 + R() * 0.4); b.state = 'row'; b.t = 0;
    b.g.visible = true; b.g.scale.setScalar(1);
    if (WW.fx) WW.fx.splash(b.x, b.z, 0.5);
  }

  function findLand(x, z) {          // nearest shore point by an outward ring search (map size from WW.cfg)
    var W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, maxR = 0.4 * Math.max(W, H), step = Math.max(3, maxR / 60);
    for (var r = step; r < maxR; r += step) {
      var n = Math.min(48, 12 + Math.round(r / 4));
      for (var k = 0; k < n; k++) {
        var a = k / n * PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (px < 1 || pz < 1 || px > W - 1 || pz > H - 1) continue;
        if (WW.terrain.depthAt(px, pz) <= 0) return { x: px, z: pz, d: r };
      }
    }
    return null;
  }
  function pickGoal(b) {
    // a destroyer sent to pick up survivors here (endgame.js rescue task; read only): row to it; survivors still
    // waiting for one (an open task near): stay by the sinking position, where the rescuer will come
    var E = WW.endgame, r = E && E.rescuerNear ? E.rescuerNear(b.nation, b.x, b.z, 110) : null;
    if (r && !r.sinking && !r.removed) { b.goal = { ship: r }; return; }
    var t = E && E.taskNear ? E.taskNear(b.nation, b.x, b.z, 90) : null;
    if (t) { b.goal = { x: t.x, z: t.z, wait: true }; return; }
    var best = null, bd = 1e9, ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.sinking || s.removed || s.nation !== b.nation || s.submerged) continue;
      var d = WW.dist(b.x, b.z, s.x, s.z); if (d < bd) { bd = d; best = s; }
    }
    b.landT -= 3;
    if (b.landT <= 0) { b.landT = 12; b.land = findLand(b.x, b.z); }
    var ld = b.land ? WW.dist(b.x, b.z, b.land.x, b.land.z) : 1e9;
    b.goal = best && bd < ld * 1.3 ? { ship: best } : b.land ? { x: b.land.x, z: b.land.z } : null;
  }
  function wet(x, z) { return WW.terrain.depthAt(x, z); }

  function beach(b) {
    b.state = 'beached'; b.v = 0; beached++;
    var c = Math.cos(b.h), s = Math.sin(b.h);
    b.stand = b.fig.map(function (f, i) {
      var lat = (i - (b.fig.length - 1) / 2) * 0.45, x = b.x, z = b.z, y = 0;
      for (var d = 0.6; d < 4; d += 0.2) {       // first dry spot up the beach
        x = b.x + c * d - s * lat; z = b.z + s * d + c * lat;
        if (wet(x, z) <= 0) { x += c * (0.3 + 0.3 * R()); z += s * (0.3 + 0.3 * R()); break; }
      }
      y = Math.max(0, -wet(x, z));
      return { x: x, y: y, z: z, yaw: -b.h + PI + (R() - 0.5) * 1.6, role: f[3] };
    });
  }

  function step(b, dt) {
    b.t += dt;
    if (b.state === 'wait') { b.delay -= dt; if (b.delay <= 0) appear(b); return; }
    if (b.state === 'fade') {
      b.fT += dt; var k = Math.min(1, b.fT / 1.4);
      b.g.position.y = -0.5 * k; b.g.scale.setScalar(1 - 0.6 * k);
      if (k >= 1) hide(b);
      return;
    }
    if (b.state === 'beached') return;
    b.goalT -= dt;
    if (b.goalT <= 0) { b.goalT = 3; pickGoal(b); }
    var gx, gz, wind = WW.wind || { x: 0, z: 0 }, ships = WW.world.ships, slow = 1, i;
    if (b.goal && b.goal.ship) {
      var gs = b.goal.ship;
      if (!gs.alive || gs.removed) { b.goal = null; b.goalT = 0; }
      else {
        gx = gs.x; gz = gs.z;
        var dx = b.x - gs.x, dz = b.z - gs.z, ch = Math.cos(gs.heading), sh = Math.sin(gs.heading);
        var lx = dx * ch + dz * sh, lz = -dx * sh + dz * ch;
        if (Math.abs(lx) < gs.stats.length / 2 + 2.5 && Math.abs(lz) < (gs.beam || 3) / 2 + 2.5) { // alongside: picked up
          if (WW.crew && WW.crew.adopt) WW.crew.adopt(gs, b.fig.length);
          b.state = 'fade'; b.fT = 0; picked++; return;
        }
      }
    } else if (b.goal) { gx = b.goal.x; gz = b.goal.z; }
    var want = b.h;
    if (gx !== undefined) {
      b.noGoal = 0;
      var ax = gx - b.x, az = gz - b.z, al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      for (i = 0; i < ships.length; i++) {        // stay clear of other hulls (and the sinking one)
        var o = ships[i]; if (o.removed || o.wreck || (b.goal.ship === o) || o.submerged) continue;
        var r = o.stats.length * 0.5 + 5, ex = b.x - o.x, ez = b.z - o.z, d2 = ex * ex + ez * ez;
        if (d2 < r * r) { var d = Math.sqrt(d2) || 0.1, w = (r - d) / r * 2.2; ax += ex / d * w; az += ez / d * w; if (d < r - 2 && o.speed > 1) slow = 0.4; }
      }
      want = Math.atan2(az, ax);
      if (!(b.goal && !b.goal.ship && !b.goal.wait)) { // not heading for the shore: keep off land
        for (var j = 0; j < 7; j++) {
          var aa = want + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.5;
          if (wet(b.x + Math.cos(aa) * 2, b.z + Math.sin(aa) * 2) > 0.5) { want = aa; break; }
        }
      }
    } else b.noGoal += dt;
    b.h += WW.clamp(WW.angleDiff(b.h, want), -TURN * dt, TURN * dt);
    var tv = gx !== undefined && !(b.goal && b.goal.wait && WW.dist(b.x, b.z, gx, gz) < 9) ? SPEED * slow : 0; // waiting: lie to
    b.v += WW.clamp(tv - b.v, -dt, dt * 0.6);
    var nx = b.x + Math.cos(b.h) * b.v * dt + wind.x * 0.15 * dt, nz = b.z + Math.sin(b.h) * b.v * dt + wind.z * 0.15 * dt;
    nx = WW.clamp(nx, 1, WW.cfg.MAP_W - 1); nz = WW.clamp(nz, 1, WW.cfg.MAP_H - 1);
    var dep = wet(nx, nz);
    if (b.goal && !b.goal.ship && !b.goal.wait && dep < 0.35) { beach(b); }
    else if (dep >= 0.35) { b.x = nx; b.z = nz; }
    else b.v *= 0.5;
    if (b.noGoal > NOGOAL || b.t > MAXLIFE) { b.state = 'fade'; b.fT = 0; return; }
    b.wakeT -= dt;
    if (b.wakeT <= 0 && b.v > 0.4 && WW.fx) { b.wakeT = 0.5; WW.fx.wake(b.x - Math.cos(b.h) * 0.8, b.z - Math.sin(b.h) * 0.8, b.h, 0.3); }
  }
  function pose(b, now) {
    var bob = b.state === 'beached' ? 0 : Math.sin(now * 1.7 + b.ph) * 0.04;
    if (b.state !== 'fade') b.g.position.set(b.x, (b.state === 'beached' ? 0.02 : 0.03) + bob, b.z);
    else { b.g.position.x = b.x; b.g.position.z = b.z; }
    b.g.rotation.set(Math.sin(now * 1.3 + b.ph) * 0.06, -b.h, Math.cos(now * 1.1 + b.ph) * 0.04, 'YXZ');
    var row = b.state === 'row' && b.v > 0.2, a = now * 2.6 + b.ph;
    for (var i = 0; i < b.oars.length; i++) {
      var o = b.oars[i], sd = o.userData.sd;
      o.rotation.set(sd * (row ? 0.3 + Math.cos(a) * 0.18 : 0.45), row ? sd * Math.sin(a) * 0.5 : 0, 0, 'YXZ');
    }
  }

  WW.lifeboats = {
    init: init,
    update: function (dt) {
      if (!(dt > 0) || !init()) return;
      try {
        var ships = WW.world.ships, now = WW.time.now;
        for (var i = 0; i < ships.length; i++) { var s = ships[i]; if (s.sinking && !s._boats && s.sinkT > 1.2) launch(s); }
        for (var j = 0; j < pool.length; j++) { var b = pool[j]; if (!b.alive) continue; step(b, dt); if (b.alive && b.state !== 'wait') pose(b, now); }
      } catch (e) { if (!WW.lifeboats._err) { WW.lifeboats._err = e; console.error('lifeboats', e); } }
    },
    // called by WW.crew.update each frame: seated / beached sailors as crew figures
    figures: function () {
      if (!ready || !WW.crew) return;
      for (var i = 0; i < pool.length; i++) {
        var b = pool[i]; if (!b.alive || b.state === 'wait' || b.state === 'fade') continue;
        if (b.stand) { b.stand.forEach(function (f) { _m.makeRotationY(f.yaw).setPosition(f.x, f.y, f.z); WW.crew.addFigure(_m, b.nation, f.role); }); continue; }
        b.g.updateMatrix();
        var y0 = b.kind === 'raft' ? -0.08 : -0.06;
        for (var k = 0; k < b.fig.length; k++) {
          var f = b.fig[k]; _l.makeRotationY(f[2]).setPosition(f[0], y0, f[1]);
          _m.multiplyMatrices(b.g.matrix, _l); WW.crew.addFigure(_m, b.nation, f[3]);
        }
      }
    },
    clearAll: clearAll,
    stats: function () {
      var o = { alive: 0, row: 0, beached: 0, pickedUp: picked, beachedTotal: beached, pool: pool.length };
      pool.forEach(function (b) { if (!b.alive) return; o.alive++; if (b.state === 'row') o.row++; if (b.state === 'beached') o.beached++; });
      return o;
    },
    _pool: pool, _launch: launch
  };
})();
