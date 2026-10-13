// ship_breakup.js - WW.shipBreakup: ships broken in two. Loads after ship_sinking.js.
//  - decide(ship), sim, at startSinking: exactly one WW.rand draw for every sinking ship. The chance comes from the
//    fatal hit (ship.sinkCause, set by Ship.takeDamage) and the type. A magazine going up broke most ships' backs
//    (Hood, Yamato, Juneau; Arizona's forward hull collapsed). A torpedo under a destroyer's or light cruiser's keel
//    amidships broke her (Kikuzuki, Hatsuyuki; Atlanta, Juneau; most destroyers torpedoed in the Solomons), a heavy
//    cruiser less often (Furutaka, Kako held together; Chikuma's bow tore off). PT boats were cut in two by a single
//    hit (PT-109). Battleships and carriers almost never broke except from a magazine. Fires, flooding, a capsize and
//    scuttling: no break (a destroyer foundering now and then).
//  - The break point is the fatal hit's position along the hull (clamped to the middle 60%), else amidships.
//  - pose(ship, k, dt), each sinking step: the hull is two halves pivoting about the break, which goes down first;
//    the ends rear up (a V), then settle on the seabed (the outer ends showing in shallow water). Same maths in the
//    sim-only and rendered games (the group transforms), Math.random only in the effects.
//  - Rendered: the stern half is a clone of the ship's group; both halves get their own copies of the materials with a
//    clipping plane at the break (renderer.localClippingEnabled), a dark slab closes each cut. drop(ship) disposes
//    them (Ship.remove, clearAll). Steam, smoke and debris at the break; no fireball of its own (fx_critical.js).
//  - The wreck keeps one footprint, the whole hull's: the halves stay on its line and pitch up inside it.
window.WW = window.WW || {};
(function () {
  'use strict';
  // chance of a broken back by the fatal hit's cause and the type (lc: a light cruiser, under 10 000 t)
  var P_BREAK = {
    magazine: { battleship: 0.7, carrier: 0.5, cruiser: 0.85, lc: 0.9, destroyer: 0.9, pt: 0.9 },
    torpedo:  { battleship: 0.03, carrier: 0.02, cruiser: 0.2, lc: 0.35, destroyer: 0.6, pt: 0.5 },
    bomb:     { battleship: 0.03, carrier: 0.02, cruiser: 0.08, lc: 0.12, destroyer: 0.3, pt: 0.4 },
    big:      { battleship: 0.02, carrier: 0.02, cruiser: 0.06, lc: 0.1, destroyer: 0.3, pt: 0.4 },
    med:      { cruiser: 0.03, lc: 0.04, destroyer: 0.12, pt: 0.3 },
    small:    { destroyer: 0.04, pt: 0.2 },
    deck:     { carrier: 0.05 },
    other:    { destroyer: 0.04 }
  };
  var AMID = 0.25, OFF_AMID = 0.4, BREAK_X = 0.3, GAP = 0.02, LIGHT_T = 10000;
  var stats = null;
  function reset() { stats = { sunk: 0, broken: 0, byCause: {}, byType: {} }; WW.shipBreakup.stats = stats; }

  function decide(s) {
    var r = WW.rand(); // always drawn: the sim's random stream does not depend on the cause
    var c = s.sinkCause || {}, kind = c.kind === 'shell' ? c.cal : c.kind;
    if (s._magT === WW.time.now) kind = 'magazine';
    if (!P_BREAK[kind]) kind = 'other';
    var L = s.stats.length, lx = 0, tons = (s.cls && s.cls.tons) || s.stats.tons;
    if (isFinite(c.x) && isFinite(c.z)) {
      var dx = c.x - s.x, dz = c.z - s.z; lx = dx * Math.cos(s.heading) + dz * Math.sin(s.heading);
    }
    var key = s.type === 'cruiser' && tons < LIGHT_T ? 'lc' : s.type;
    var p = P_BREAK[kind][key] || (key === 'lc' ? P_BREAK[kind].cruiser || 0 : 0);
    if (kind === 'torpedo' && Math.abs(lx) > AMID * L) p *= OFF_AMID; // under the ends: holed, but the keel holds
    if (s.capsized || s.type === 'submarine') p = 0;
    if (stats) stats.sunk++;
    if (r >= p) return;
    s.broken = true; s.breakCause = kind;
    s.breakX = WW.clamp(lx, -BREAK_X * L, BREAK_X * L);
    if (stats) { stats.broken++; stats.byCause[kind] = (stats.byCause[kind] || 0) + 1; stats.byType[s.type] = (stats.byType[s.type] || 0) + 1; }
    WW.emit('shipBreak', { ship: s, cause: kind });
  }

  // ---- the pose of the two halves (sim and render alike) ----
  var V = null, V2 = null, E = null;
  function frac(x) { return x - Math.floor(x); }
  function fy(s, d) { return Math.min(-1, -d - s.hullBot * 0.8); } // keel on the seabed
  // where the halves come to rest: the break on the seabed, each outer end pitched up (sim: sets restTop)
  function rest(s) {
    var L = s.stats.length, bx = s.breakX, dep = function (p) { return Math.max(0, WW.terrain.depthAt(p[0], p[1])); };
    var yB = fy(s, dep(s.toWorld(bx, 0))), want = WW.clamp(L * 0.2, 1.6, 5), out = [], top = -99;
    for (var h = 1; h >= -1; h -= 2) {
      var l = h > 0 ? L * 0.5 - bx : L * 0.5 + bx, sn = (want - yB - s.hullTop * 0.85) / l;
      sn = sn > 0.75 ? 0.12 : WW.clamp(sn, 0.25, 0.75);                    // deep: nearly flat; shallow: an end shows
      sn = WW.clamp(Math.max(sn, (fy(s, dep(s.toWorld(h * L * 0.5, 0))) - yB) / l), 0, 0.85); // the outer end clear of the seabed
      out.push(Math.asin(sn));
      top = Math.max(top, yB + l * sn + s.hullTop * Math.sqrt(1 - sn * sn) * Math.cos(s.sinkRoll * 0.5));
    }
    s.restY = yB; s.restTop = top;
    return { yB: yB, pF: out };
  }
  function pose(s, k, dt) {
    if (!V) { V = new THREE.Vector3(); V2 = new THREE.Vector3(); E = new THREE.Euler(0, 0, 0, 'YXZ'); }
    if (!s._bk && !WW.simOnly && WW.scene && WW.renderer) { // first step broken, rendered: the stern half
      try { build(s); } catch (err) { console.error('shipBreakup', err); s._bk = { stern: null, mats: [], pairs: [] }; }
    }
    var L = s.stats.length, t = s.sinkT, D = s.sinkDur || 8.5, R = rest(s), bx = s.breakX;
    // the break settles to the waterline at once, then goes down first (the V shows for a few seconds)
    var dip = s.startY - 0.9 * (1 - Math.exp(-t / 0.8)), yB = WW.lerp(dip, Math.min(dip, R.yB), k * k * k), up = 1 - Math.exp(-t / 1.2), set = WW.clamp((k - 0.45) / 0.55, 0, 1);
    set = set * set * (3 - 2 * set);
    var b = s.toWorld(bx, 0), g = Math.min(1, t / 1.5) * GAP * L, rl = Math.min(1, t / 4);
    var halves = [[s.group, 1, R.pF[0]], [s._bk ? s._bk.stern : null, -1, R.pF[1]]];
    for (var i = 0; i < 2; i++) {
      var grp = halves[i][0], h = halves[i][1];
      // the ends rear up (smaller hulls steeper), each half a little differently
      var pk = WW.clamp(0.95 - L * 0.016, 0.45, 0.8) * (0.85 + 0.3 * frac(s.id * 0.618 + i * 0.37));
      var p = WW.lerp(pk * up, halves[i][2], set) * h;
      var roll = WW.lerp(s.listRoll + s.heel, s.sinkRoll * (h > 0 ? 0.5 : 0.3), rl);
      E.set(roll, -s.heading, p);
      V.set(bx, 0, 0).applyEuler(E); V2.set(h, 0, 0).applyEuler(E);
      var x = b[0] - V.x + V2.x * g, y = yB - V.y + V2.y * g, z = b[1] - V.z + V2.z * g;
      if (grp) { grp.position.set(x, y, z); grp.rotation.set(roll, -s.heading, p); }
      if (i === 0) { s.halfY = y; }
    }
    s.rustLook(k);
    if (s._bk && s._bk.stern) { syncLook(s); breakFx(s, b, yB, dt); }
  }

  // ---- render: the stern half, clipped materials, the cut ----
  var capGeo = null, capMat = null;
  function build(s) {
    WW.renderer.localClippingEnabled = true;
    var stern = s.group.clone(true), bk = s._bk = { stern: stern, mats: [], pairs: [], planes: [new THREE.Plane(), new THREE.Plane()], fxT: 0 };
    var hm = s.model.hullMats;
    [s.group, stern].forEach(function (grp, i) {
      var map = new Map(), plane = bk.planes[i], h = i ? -1 : 1;
      var upd = function () { // the cut in world space, from this half's posed matrix
        var m = grp.matrixWorld; V.set(s.breakX, 0, 0).applyMatrix4(m); V2.set(h, 0, 0).transformDirection(m);
        plane.setFromNormalAndCoplanarPoint(V2, V);
      };
      var cl = function (m) {
        var c = map.get(m);
        if (!c) {
          c = m.clone(); c.clippingPlanes = [plane]; c.clipShadows = true; map.set(m, c); bk.mats.push(c);
          var j = hm.indexOf(m); if (j >= 0) bk.pairs.push([hm[j], c]);
        }
        return c;
      };
      grp.traverse(function (o) {
        if (!o.material) return;
        o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
        o.onBeforeRender = upd;
      });
      // a dark slab closes the cut (the torn hull, shadowed inside)
      if (!capGeo) { capGeo = new THREE.BoxGeometry(1, 1, 1); capMat = new THREE.MeshToonMaterial({ color: 0x2b2420, gradientMap: WW.models._grad() }); }
      var cap = new THREE.Mesh(capGeo, capMat), hb = s.hullBot, ht = Math.max(0.6, s.hullTop * 0.35);
      cap.scale.set(0.08, ht - hb, s.beam * 0.8); cap.position.set(s.breakX + h * 0.06, (ht + hb) / 2, 0);
      cap.userData.breakCap = true; grp.add(cap);
      upd();
    });
    WW.scene.add(stern);
    breakBurst(s);
  }
  function syncLook(s) { var P = s._bk.pairs; for (var i = 0; i < P.length; i++) if (P[i][0].color) { P[i][1].color.copy(P[i][0].color); P[i][1].opacity = P[i][0].opacity; } }
  // the moment she breaks: steam, smoke and debris at the break (the magazine's fireball is fx_critical.js's)
  function breakBurst(s) {
    var L = s.stats.length, b = s.toWorld(s.breakX, 0), sz = WW.clamp(L / 9, 0.8, 2.5), r = function () { return Math.random() - 0.5; };
    if (s.breakCause !== 'magazine') WW.fx.explosion(b[0], 1.2, b[1], sz);
    WW.fx.sparks(b[0], 1.5, b[1]); WW.fx.splash(b[0], b[1], sz * 1.4);
    for (var i = 0; i < 4; i++) { var w = s.toWorld(s.breakX + r() * 2, r() * s.beam); WW.fx.sparks(w[0], 1 + Math.random() * 2, w[1]); WW.fx.smoke(w[0], 1.5 + i, w[1], i % 2 === 0, sz * 0.8); }
    WW.emit('shipBoom', { ship: s, x: b[0], y: 1, z: b[1], size: WW.clamp(L / 12, 0.6, 1.6) }); // sound hook
  }
  // while the break is above or near the surface: steam and smoke pour out of it, bubbles and spray as it goes under
  function breakFx(s, b, yB, dt) {
    var bk = s._bk; bk.fxT -= dt;
    if (bk.fxT > 0 || s.sinkT > 7) return;
    bk.fxT = 0.3 + Math.random() * 0.2;
    var sz = WW.clamp(s.stats.length / 20, 0.4, 1.1), x = b[0] + (Math.random() - 0.5), z = b[1] + (Math.random() - 0.5);
    if (yB > -2.5) WW.fx.smoke(x, Math.max(0.6, yB + 1.5), z, Math.random() < 0.35, sz); // mostly white steam
    else if (Math.random() < 0.5) WW.fx.torpBubbles(x, z, Math.random() * Math.PI * 2);
    if (Math.random() < 0.2) WW.fx.splash(x, z, sz * 0.6);
  }
  function drop(s) {
    var bk = s._bk; if (!bk) return;
    if (bk.stern && bk.stern.parent) bk.stern.parent.remove(bk.stern);
    bk.mats.forEach(function (m) { m.dispose(); });
    s._bk = null;
  }

  WW.on('magazine', function (e) { if (e && e.ship) e.ship._magT = WW.time.now; });
  WW.on('roundStart', reset); WW.on('setupStart', reset);
  WW.shipBreakup = { decide: decide, pose: pose, drop: drop, rest: rest, P_BREAK: P_BREAK, stats: null };
  reset();
})();
