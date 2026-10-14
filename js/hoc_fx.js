// hoc_fx.js - WW.hocFx: the Rangers' climb at Pointe du Hoc on screen (visual only; Math.random), from hoc_climb.js:
//  - the rocket-fired grapnels: six rockets from each LCA as it grounds, trailing their ropes up the cliff in arcs (the
//    ones that fell short drop back onto the shingle, the soaked ropes too heavy)
//  - the ropes that held, hanging down the cliff face from their grapnels: plain ropes, toggle ropes, rope ladders, and
//    the light steel ladder sections the Rangers fitted together at the foot; a cut rope lies in a heap at the foot
//  - the men going up them, one above another at the squad's progress (hoc_climb.js q.ropeP), the rest at the foot
//  - the stick grenades the Germans rolled over the edge bursting at the foot of the cliff
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX_R = 600, MAX_M = 200, ROCKET_T = 1.3, PER_ROPE = 3, MAN_GAP = 0.16;
  let root = null, M = null, built = false;
  const rockets = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const on = () => !WW.simOnly && WW.isScn('normandy') && !!WW.scene && !!WW.normandyTerrain;
  const gy = (x, z) => Math.max(0, WW.terrain.heightRaw(x, z));
  function init() {
    root = new THREE.Group(); root.name = 'hocClimb';
    const grad = WW.models._grad ? WW.models._grad() : null, mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad });
    const mk = (g, n) => { const im = new THREE.InstancedMesh(g, mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    const V = WW.vehicleModel.build(), S = WW.soldierModel.build();
    M = { rope: mk(V.rope, MAX_R), ropeLadder: mk(V.ropeLadder, MAX_R), steelLadder: mk(V.steelLadder, 160), grapnel: mk(V.grapnel, MAX_R), climber: mk(S.crouch, MAX_M) };
    WW.scene.add(root);
    built = true;
  }
  // a line from a to b (unit geometry along +y), stretched to the length
  function line(key, ax, ay, az, bx, by, bz) {
    const im = M[key]; if (im.count >= im.instanceMatrix.count) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 1e-3;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _p.set(dx / L, dy / L, dz / L));
    _m.compose(_p.set(ax, ay, az), _q, _s.set(1, L, 1));
    im.setMatrixAt(im.count++, _m);
  }
  function put(key, x, y, z, yaw, pitch) {
    const im = M[key]; if (im.count >= im.instanceMatrix.count) return;
    _e.set(0, -yaw, pitch || 0, 'YXZ'); _q.setFromEuler(_e);
    im.setMatrixAt(im.count++, _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
  }
  // where a rope runs: from its grapnel at the cliff edge down the face to the foot, lying on the rock (SEG pieces, each
  // point lifted clear of the face: the cliff bulges between the foot and the edge)
  const SEG = 6, LIFT = 0.07;
  function ends(r) {
    const xf = r.x, zf = r.zFoot - 0.25, zt = r.zTop - 0.2;
    return { xf, yf: gy(xf, zf), zf, yt: gy(xf, r.zTop + 0.4) + 0.05, zt };
  }
  function at(e, f) {   // the point a fraction f up the rope
    const z = e.zf + (e.zt - e.zf) * f, y = Math.max(e.yf + (e.yt - e.yf) * f, gy(e.xf, z) + LIFT, gy(e.xf, z - 0.15) + LIFT);
    return [e.xf, y, z - 0.12];
  }
  function hang(key, e) {
    let a = at(e, 0);
    for (let i = 1; i <= SEG; i++) { const b = at(e, i / SEG); line(key, a[0], a[1], a[2], b[0], b[1], b[2]); a = b; }
  }
  function update(rdt) {
    if (!on() || !WW.hocClimb) { if (root) root.visible = false; return; }
    if (!built) init();
    root.visible = true;
    for (const k in M) M[k].count = 0;
    const rt = WW.game ? WW.game.roundTime : 0;
    // the rockets in flight
    for (let i = rockets.length - 1; i >= 0; i--) {
      const k = rockets[i], f = (rt - k.t0) / ROCKET_T;
      if (f >= 1 || f < 0) { rockets.splice(i, 1); continue; }
      const x = k.x0 + (k.x1 - k.x0) * f, z = k.z0 + (k.z1 - k.z0) * f, y = k.y0 + (k.y1 - k.y0) * f + Math.sin(Math.PI * f) * k.arc;
      if (WW.fx && WW.fx.trail) WW.fx.trail(x, y, z, false, 0.25, 0.9);
      line('rope', k.x0, k.y0, k.z0, x, y, z);
    }
    for (const r of WW.hocClimb.ropes) {
      const e = ends(r), young = rt - r.t < ROCKET_T && r.kind !== 'ladder';
      if (young) continue;
      if (!r.ok || r.cut) {   // fallen short or cut: the rope lies in a heap at the foot
        const a = (r.id * 1.7) % 6.28;
        line('rope', e.xf, e.yf + 0.02, e.zf - 0.5, e.xf + Math.cos(a) * 0.9, e.yf + 0.02, e.zf - 0.5 + Math.sin(a) * 0.5);
        continue;
      }
      const key = r.kind === 'ladder' ? 'steelLadder' : r.kind === 'ropeLadder' ? 'ropeLadder' : 'rope';
      hang(key, e);
      if (r.kind !== 'ladder') put('grapnel', e.xf, e.yt, e.zt + 0.05, 0);
    }
    // the men on the ropes
    for (const q of WW.infantry.squads) {
      if (!q.alive || q.state !== 'rope' || !q.rope) continue;
      const e = ends(q.rope), n = Math.min(PER_ROPE, q.men);
      for (let i = 0; i < n; i++) {
        const f = WW.clamp((q.ropeP || 0) - i * MAN_GAP, 0, 1);
        if (f <= 0 && i) continue;
        const p = at(e, f); put('climber', p[0], p[1] - 0.12, p[2] - 0.06, Math.PI / 2, -0.5);
      }
    }
    for (const k in M) WW.instUsed(M[k]);
  }
  WW.on('hocEvent', e => {
    if (!on() || !e) return;
    const rt = WW.game ? WW.game.roundTime : 0;
    if (e.kind === 'grapnels' && WW.hocClimb) {
      const u = e.craft;
      for (const r of WW.hocClimb.ropes) if (r.craft === u) {
        const top = r.ok, x1 = r.x, z1 = top ? r.zTop : r.zFoot - 1 - Math.random() * 1.5, y1 = top ? gy(r.x, r.zTop + 0.4) + 0.05 : gy(x1, z1);
        rockets.push({ t0: rt + Math.random() * 0.4, x0: u.x + (r.x - u.x) * 0.3, y0: 0.4, z0: u.z, x1, y1, z1, arc: top ? 0.8 : 2.2 });
        if (WW.fx && WW.fx.muzzleFlash) WW.fx.muzzleFlash(u.x, 0.4, u.z);
      }
    }
    if (e.kind === 'grenade' && e.squad && WW.fx && WW.fx.explosion) WW.fx.explosion(e.squad.x + (Math.random() - 0.5) * 2, gy(e.squad.x, e.squad.z) + 0.2, e.squad.z + (Math.random() - 0.5) * 1.5, 0.45);
  });
  WW.on('roundStart', () => { rockets.length = 0; });
  WW.hocFx = { update };
})(window.WW);
