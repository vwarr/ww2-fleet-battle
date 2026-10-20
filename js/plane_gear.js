// plane_gear.js - landing gear for the pooled plane models (WW.planeGear). Load after models_landplanes.js.
// Each 1942 type gets its own gear, built once per type with the models.js primitives, baked into a few shared
// geometries (one per leg, tail wheel, hook) and drawn with the planes' one toon material, so air_render.js
// instances them like every other part: a few buckets per TYPE, none in flight where the gear is stowed and hidden.
//   F4U  main legs at the gull knees: rotate 90 deg as they swing aft, the wheel flat in the wing; tail wheel; hook
//   SBD / A6M / B5N  main legs retracting inward into the wing; tail wheel (the A6M's retracts); hook
//   TBD  main legs swinging aft, the wheels left half out under the wing when up (true to type); tail wheel; hook
//   D3A  fixed spatted main gear (never retracts); tail wheel; hook
//   B-17E mains fold forward into the inboard nacelles, the wheel half out; retracting tail wheel
//   B-26 tricycle: mains aft into the nacelles, nose wheel aft into the nose
//   G4M  mains aft into the nacelles; retracting tail wheel
// m.gear: { ext (1 down .. 0 up), hook (0 stowed .. 1 down), set(e), setHook(h), tilt, ... } on every model.
// Ride on the ground (visual only): the sim's ride height (aircraft.js DECK_Y; land_air.js gear) is unchanged. The
// chubby toon airframes are deeper than the real ones, so a carrier type stands on its gear a little higher than the
// sim's height, and a tail-dragger sits in its three-point attitude (nose up, about the main wheels' contact): both
// are offsets on the model group's pose added where the group is posed (Plane.sync via air_fx.js, the deck park
// air_deck.js syncEntry, the island base base_ground_fx.js), fading out over the first metres of the climb (and
// back in on the last of the approach), the tail coming up on the take-off run. The gear comes up a second or so
// after the wheels leave the deck or the runway, goes down on the approach (carrier: the groove, the hook with it),
// stays up for a ditching. Visual only: never reads WW.rand or writes sim state; the state lives on the model.
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, DEG = PI / 180;
  var TYRE = 0x2a2c30, HUB = 0x9aa0a6, OLEO = 0xc4c8cc, HOOK = 0x3a3d42;
  var DECK_M = -0.75 / 1.7;   // the carrier deck in model units below the centre line (aircraft.js DECK_Y / PLANE_SCALE)
  // per type: mode, x / z of the main wheel (axle, down), ym = the main wheels' bottom (model units; < DECK_M: the
  // visual lift on the deck), r / w wheel radius / width, tilt = three-point attitude, strut / door paint; tail: tail
  // wheel x, r, retract; hook: pivot x, length; nose: (B-26) x, r; wings: legs ride the wing halves (nacelles)
  var G = {
    'fighter|USN': { mode: 'aftTwist', x: 0.44, z: 0.62, ym: -0.76, r: 0.1, w: 0.075, tilt: 14, strut: 0x51709a, door: 0x51709a,
      tail: { x: -0.97, r: 0.045, retract: true }, hook: { x: -1.12, len: 0.34 } },
    'dive|USN': { mode: 'inward', x: 0.56, z: 0.5, ym: -0.56, r: 0.095, w: 0.07, tilt: 12, strut: 0xd6dadd, door: 0xd6dadd,
      tail: { x: -1.02, r: 0.045 }, hook: { x: -1.12, len: 0.3 } },
    'torpedo|USN': { mode: 'aft', keep: true, x: 0.5, z: 0.42, ym: -0.58, r: 0.1, w: 0.075, tilt: 13, A: 1.45, strut: 0xd6dadd, door: null,
      tail: { x: -1.1, r: 0.05 }, hook: { x: -1.2, len: 0.32 } },
    'fighter|IJN': { mode: 'inward', x: 0.45, z: 0.45, ym: -0.54, r: 0.085, w: 0.06, tilt: 13, strut: 0x9a9c94, door: 0xd8d6c8,
      tail: { x: -0.97, r: 0.038, retract: true }, hook: { x: -1.08, len: 0.3 } },
    'dive|IJN': { mode: 'fixed', x: 0.36, z: 0.6, ym: -0.56, r: 0.09, w: 0.065, tilt: 14, strut: 0x76845a, door: 0xcfccb8,
      tail: { x: -1.0, r: 0.042 }, hook: { x: -1.1, len: 0.3 } },
    'torpedo|IJN': { mode: 'inward', x: 0.55, z: 0.55, ym: -0.59, r: 0.09, w: 0.065, tilt: 13, strut: 0x9a9c94, door: 0xcfccb8,
      tail: { x: -1.08, r: 0.042 }, hook: { x: -1.18, len: 0.32 } },
    b17: { mode: 'fwd', keep: true, wings: true, x: 0.55, z: 0.98, gearH: 1.25, r: 0.155, w: 0.1, tilt: 10, A: 1.5, strut: 0x8a8c80, door: null,
      tail: { x: -2.0, r: 0.07, retract: true } },
    b26: { mode: 'aft', wings: true, x: 0.12, z: 0.95, gearH: 1.0, r: 0.13, w: 0.085, tilt: 0, A: 1.5, strut: 0x8a8c80, door: 0xb4b6ae,
      nose: { x: 1.3, r: 0.1 } },
    g4m: { mode: 'aft', wings: true, x: 0.45, z: 1.02, gearH: 1.0, r: 0.14, w: 0.09, tilt: 10, A: 1.5, strut: 0x9a9c94, door: 0x56623f,
      tail: { x: -1.95, r: 0.06, retract: true } }
  };
  G.g4mL = G.g4m;

  var M, TPL = {}, _rc = null;
  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  // the lowest surface of the airframe (body + wings, no prop / payload) straight above model (x, z)
  function under(m, x, z, fallback) {
    if (!_rc) _rc = new THREE.Raycaster();
    var meshes = [];
    m.group.traverse(function (o) { if (o.isMesh && o !== m.payload && o !== m.disc && o !== m.blades && o.parent !== m.prop && o.parent.parent !== m.prop) meshes.push(o); });
    m.group.updateMatrixWorld(true);
    _rc.set(new THREE.Vector3(x, -4, z).applyMatrix4(m.group.matrixWorld), new THREE.Vector3(0, 1, 0));
    var h = _rc.intersectObjects(meshes, false);
    if (!h.length) return fallback;
    return m.group.worldToLocal(h[0].point.clone()).y;
  }
  function wheel(p, r, w, y, z) { // a tyre and hub, axle along z, centred on (0, y, z)
    var wg = new THREE.Group(); wg.position.set(0, y, z); wg.rotation.x = PI / 2; p.add(wg);
    M._disc(wg, TYRE, r, w, 0, -w / 2, 0);
    M._disc(wg, HUB, r * 0.5, w + 0.012, 0, -(w + 0.012) / 2, 0);
    return wg;
  }
  // a main leg hanging from its pivot at the origin: strut, chromed oleo, wheel, the leg door on the outboard side
  function leg(S, k, L) {
    var g = new THREE.Group(), r = S.r;
    if (S.mode === 'fixed') { // Val: a broad faired leg and a lofted spat over the wheel
      var K = M._planeKit, ax = -L;
      M._bar(g, S.strut, 0.09, L - r * 0.4, 0.035, 0, ax + r * 0.4, 0).rotation.x = -k * 0.08;
      wheel(g, r, S.w, ax, 0);
      var cy = ax + 0.025, hh = r * 1.0 + 0.004, hw = S.w * 0.5 + 0.03;
      K.meshOf(g, K.tube(K.bodyRings(K.smooth([[-r * 2.6, 0.012, 0.03, cy + 0.02], [-r * 1.3, hw * 0.85, hh * 0.85, cy], [0, hw, hh, cy], [r * 1.0, hw * 0.9, hh * 0.9, cy], [r * 1.8, 0.02, 0.04, cy - 0.01]], 3), 10, 2.2,
        K.twoTone(S.strut, S.door)), true, true));
      return g;
    }
    var up = L * 0.56;
    M._cyl(g, S.strut, 0.024, up, 0, -up, 0);                  // the strut (bottom at -up)
    M._cyl(g, OLEO, 0.016, L - up + 0.02, 0, -L, 0);            // the oleo down to the axle
    M._bar(g, S.strut, 0.05, 0.03, S.w + 0.03, 0, -L + r * 0.55, 0); // the fork yoke over the tyre
    wheel(g, r, S.w, -L, 0);
    if (S.door) M._bar(g, S.door, Math.max(0.1, r * 1.3), up * 1.15, 0.01, 0, -up * 1.15 - 0.01, k * (0.04 + S.w * 0.2));
    return g;
  }
  function tailWheel(T, L, hex) { // a small fork and tyre under the tail
    var g = new THREE.Group();
    M._cyl(g, hex, 0.014, L, 0, -L, 0);
    wheel(g, T.r, T.r * 0.75, -L, 0);
    return g;
  }
  function hookGeo(H) { // the arrester hook: a shank trailing aft from its pivot, the hook point at its end
    var g = new THREE.Group();
    M._bar(g, HOOK, H.len, 0.016, 0.016, -H.len / 2, -0.008, 0);
    M._bar(g, 0xd8c040, H.len * 0.3, 0.018, 0.018, -H.len * 0.55, -0.009, 0);   // the yellow band
    M._bar(g, HOOK, 0.035, 0.04, 0.022, -H.len + 0.012, -0.04, 0);
    return g;
  }

  // the gear template of a type, measured against its built model m (once per type)
  function template(key, m) {
    if (TPL[key]) return TPL[key];
    var S = G[key], K = M._planeKit, parts = [];
    var yd = S.gearH ? -S.gearH / 1.7 : DECK_M, ym = S.ym || yd, tilt = S.tilt * DEG;
    [-1, 1].forEach(function (k) {
      var hy = under(m, S.x, k * S.z, -0.2) + 0.012, L = Math.max(0.05, hy - (ym + S.r));
      parts.push({ type: 'main', k: k, geo: K.bake(leg(S, k, L)), pos: [S.x, hy, k * S.z], mode: S.mode, hide: !S.keep && S.mode !== 'fixed', A: S.A || PI / 2, r: S.r, wing: S.wings ? k : 0 });
    });
    if (S.tail) { // to the deck line of the three-point attitude: rises aft at tan(tilt) from the main wheels' contact
      var T = S.tail, ty = under(m, T.x, 0, 0) + 0.01, yt = ym + (S.x - T.x) * Math.tan(tilt), Lt = Math.max(0.03, ty - (yt + T.r));
      parts.push({ type: 'tail', k: 0, geo: K.bake(tailWheel(T, Lt, S.strut === S.door ? S.strut : 0x6b7076)), pos: [T.x, ty, 0], mode: T.retract ? 'tail' : 'fixed', hide: !!T.retract, A: 1.35, r: T.r, wing: 0 });
    }
    if (S.nose) {
      var N = S.nose, ny = under(m, N.x, 0, -0.25) + 0.012, Ln = Math.max(0.05, ny - (ym + N.r));
      parts.push({ type: 'nose', k: 0, geo: K.bake(leg({ mode: 'nose', r: N.r, w: N.r * 0.8, strut: S.strut, door: null }, 1, Ln)), pos: [N.x, ny, 0], mode: 'aft', hide: true, A: 1.5, r: N.r, wing: 0 });
    }
    var hk = null;
    if (S.hook) { // down: the point a little above the deck line of the three-point attitude
      var H = S.hook, hyk = under(m, H.x, 0, 0) + 0.015, tipX = H.x - H.len * 0.8, line = ym + (S.x - tipX) * Math.tan(tilt) + 0.03;
      var a1 = Math.max(0.35, Math.min(1.2, Math.asin(Math.max(-1, Math.min(1, (hyk - line) / H.len)))));
      hk = { geo: K.bake(hookGeo(H)), pos: [H.x, hyk, 0], a0: -0.06, a1: a1 };
    }
    return (TPL[key] = { parts: parts, hook: hk, yd: yd, ym: ym, xm: S.x, tilt: tilt });
  }

  function setGear(e) {
    e = Math.max(0, Math.min(1, e)); this.ext = e;
    var s = 1 - e * e * (3 - 2 * e);
    for (var i = 0; i < this.parts.length; i++) {
      var q = this.parts[i], pv = q.pivot, P = q.t;
      if (P.mode !== 'fixed') {
        if (P.mode === 'inward') pv.rotation.x = P.k * PI / 2 * s;
        else if (P.mode === 'aftTwist') { pv.rotation.z = -PI / 2 * s; pv.rotation.y = P.k * PI / 2 * s; }
        else if (P.mode === 'aft' || P.mode === 'tail') pv.rotation.z = -P.A * s;
        else if (P.mode === 'fwd') pv.rotation.z = P.A * s;
        if (P.hide) pv.position.y = q.home + P.r * 0.9 * sstep(0.6, 1, s); // the last of the swing tucks the wheel into its well
      }
      var vis = !(P.hide && e < 0.02);
      if (pv.visible !== vis) pv.visible = vis;
    }
  }
  function setHook(h) {
    h = Math.max(0, Math.min(1, h)); this.hook = h;
    var k = this.hk; if (!k) return;
    var s = h * h * (3 - 2 * h);
    k.pivot.rotation.z = k.t.a0 + (k.t.a1 - k.t.a0) * s;
    var vis = h > 0.02; if (k.pivot.visible !== vis) k.pivot.visible = vis;
  }

  // attach the gear to a freshly built model (buildPlane wrapper)
  function attach(m, key) {
    if (!G[key] || !m || !m.group) return m;
    var t = template(key, m), mat = M._mat(0xffffff), gr = { ext: 1, hook: 0, parts: [], hk: null, set: setGear, setHook: setHook,
      tilt: t.tilt, xm: t.xm, ym: t.ym, yd: t.yd, ft: 1, airT: 0, fresh: true, dyT: 0 };
    t.parts.forEach(function (P) {
      var pv = new THREE.Group(), par = P.wing ? (P.wing < 0 ? m.wingL : m.wingR) : m.group;
      if (P.mode === 'aftTwist') pv.rotation.order = 'ZYX';
      pv.position.fromArray(P.pos);
      if (par !== m.group) pv.position.sub(par.position);
      var me = new THREE.Mesh(P.geo, mat); me.castShadow = true; pv.add(me); par.add(pv);
      gr.parts.push({ pivot: pv, t: P, home: pv.position.y });
    });
    if (t.hook) {
      var hp = new THREE.Group(); hp.position.fromArray(t.hook.pos);
      var hm = new THREE.Mesh(t.hook.geo, mat); hm.castShadow = true; hp.add(hm); m.group.add(hp);
      gr.hk = { pivot: hp, t: t.hook };
    }
    gr.set(1); gr.setHook(0);
    m.gear = gr;
    return m;
  }

  // ---- the pose on the ground: lift onto the gear (fl: 0 airborne .. 1 on the deck), three-point tilt (ft: tail down) ----
  // abs: the group's pitch is set (not added to); noLift: the height is already the lowest part's (base_ground_fx.js)
  function pose(g, gr, fl, ft, abs, noLift) {
    var th = gr.tilt * ft * fl, s = g.scale.y, sn = Math.sin(th), cs = Math.cos(th);
    var dyT = fl * (gr.ym - gr.xm * sn - gr.ym * cs), dy = dyT + (noLift ? 0 : fl * (gr.yd - gr.ym));
    var dx = fl * (gr.xm * (1 - cs) + gr.ym * sn), a = g.rotation.y;
    gr.dyT = dyT * s;
    if (abs) { if (!Object.is(g.rotation.z, th)) g.rotation.z = th; }
    else if (th) g.rotation.z += th;
    if (dx || dy) { g.position.x += dx * s * Math.cos(a); g.position.z -= dx * s * Math.sin(a); g.position.y += dy * s; }
  }
  function ease(cur, want, dt, rate) { return dt > 0 ? cur + Math.max(-rate * dt, Math.min(rate * dt, want - cur)) : want; }

  // a pooled model handed out again: gear down, hook up, no pose left over
  function reset(m) {
    var gr = m && m.gear; if (!gr) return;
    gr.set(1); gr.setHook(0); gr.ft = 1; gr.airT = 0; gr.fresh = true; gr.dyT = 0;
  }
  // flying models outside the sim (air_offmap_fx.js): gear and hook up
  function stow(m) { var gr = m && m.gear; if (!gr) return; gr.set(0); gr.setHook(0); }

  // per plane, from Plane.sync (air_fx.js sync): what the gear does in this state, the pose on the deck / runway
  function sync(p, dt) {
    var m = p.model, gr = m && m.gear;
    if (!gr) return;
    var st = p.state, c = p.carrier, base = !!(c && c.isBase), ph = base ? p.rwPh : p.deckPh;
    var want = gr.ext, hook = 0, onGround = false, ft = 1;
    if (st === 'takeoff') {
      var air = ph === 'climb' || (!ph && p.t > 2.2);
      gr.airT = air ? gr.airT + (dt || 0) : 0;
      want = gr.airT > 1.1 ? 0 : 1; onGround = true;
      if (air) ft = 0;
      else if (!base && ph === 'run') ft = 1 - sstep(4, 14, p.rel || 0);
      else if (base && ph === 'roll') ft = 1 - sstep(0.3, 0.7, p.speed / Math.max(1, p.pt.speed));
    } else if (st === 'landing') {
      var down = base ? ph === 'final' : (ph === 'app' || ph === 'final' || ph === 'waveoff' || !ph);
      want = down ? 1 : 0; hook = down && !base ? 1 : 0; onGround = down;
    } else if (st === 'rollout') {
      want = 1; hook = base ? 0 : 1; onGround = true;
      if (base) ft = 1 - sstep(0.35, 0.7, p.speed / Math.max(1, p.pt.speed));
    } else if (st === 'ditch') want = 0;   // a water landing: wheels up
    else if (p.alive) want = 0;            // in flight
    // shot down / falling / wrecked: the gear stays as it was
    if (gr.fresh) { gr.fresh = false; if (!onGround) { gr.set(want); gr.setHook(hook); } }
    if (gr.ext !== want) gr.set(ease(gr.ext, want, dt, want > gr.ext ? 0.4 : 0.45));
    if (gr.hook !== hook) gr.setHook(ease(gr.hook, hook, dt, 0.8));
    // the pose: only on (or just over) the deck / runway, in the ground states
    var fl = 0;
    if (onGround && p.alive) {
      var surf = base ? (c.site ? c.site.padH : 0) + ((p.variant && WW.landAir && WW.landAir.VAR[p.variant].gear) || WW.air._pool.deckY)
        : (c && c._deck ? c._deck.dy : p.deckY || 0) + WW.air._pool.deckY;
      var h = p.y - surf, sc = p.group.scale.y;
      fl = h < -3 ? 0 : 1 - sstep(0.15 * sc / 0.41, 2.5 * sc / 0.41, h);
    }
    gr.ft = dt > 0 ? gr.ft + (ft - gr.ft) * (1 - Math.exp(-dt / 0.35)) : ft;
    if (fl > 0) pose(p.group, gr, fl, gr.ft, false, false);
    else gr.dyT = 0;
  }
  // a parked model (air_deck.js syncEntry: the park, the elevator, the taxi in after the trap): gear down, the hook
  // coming up, sitting on its gear in the three-point attitude. The group's position was just set by the caller.
  function parked(m, dt) {
    var gr = m && m.gear; if (!gr) return;
    if (gr.ext !== 1) gr.set(1);
    if (gr.hook) gr.setHook(ease(gr.hook, 0, dt, 0.8));
    gr.ft = 1;
    pose(m.group, gr, 1, 1, true, false);
  }
  // an island base model on its hardstand (base_ground_fx.js place): the height there is its lowest part's
  function standing(m, wreck) {
    var gr = m && m.gear; if (!gr) return;
    if (wreck) { if (gr.ext !== 0) gr.set(0); if (gr.hook) gr.setHook(0); return; }   // a wreck: the gear collapsed
    if (gr.ext !== 1) gr.set(1);
    pose(m.group, gr, 1, 1, true, true);
  }

  if (WW.models && WW.models.buildPlane) {
    var b0 = WW.models.buildPlane;
    WW.models.buildPlane = function (kind, nationId) {
      var m = b0.apply(this, arguments); M = WW.models;
      var key = G[kind] ? kind : kind + '|' + M._nation(nationId).id;
      try { return attach(m, key); } catch (e) { console.error('plane_gear.js: ' + key + ': ' + (e && e.message)); return m; }
    };
  } else console.error('plane_gear.js must load after models_landplanes.js');
  WW.planeGear = { sync: sync, parked: parked, standing: standing, reset: reset, stow: stow, pose: pose, TYPES: G };
})();
