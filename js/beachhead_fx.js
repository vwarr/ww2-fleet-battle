// beachhead_fx.js - WW.beachheadFx: the marks of the fighting on the ground at Omaha (visual only; Math.random, and a
// fixed local PRNG for what was there before the round). What turns a clean coast into a beachhead:
//  - craters: every shell, bomb and mortar bomb that lands on dry ground (land_sites.js 'landImpact', 'mortarBurst')
//    leaves one, sized by the calibre, on the sand a shallow scoop of wet sand, on the bluff a ring of turned earth in
//    a scorch; and the pre-H bombardment's (Texas's 14-inch and the destroyers on the strongpoints from 05:50, the
//    cruisers on the bluffs) appear over the first minutes
//  - the grass fires the shelling lit on the bluffs (normandy_sky.js smokes them): black patches spreading through the
//    morning
//  - the German wire: concertina along the top of the shingle and the sea wall and along the foot of the bluff, gone
//    where the engineers' Bangalores blew a gap (infantry_routes.js 'gapBlown')
//  - 'Achtung Minen' boards on the shelf (the minefields between the shingle and the bluffs)
//  - the Shermans knocked out on the sand stay there, burning for a few minutes and smoking for longer
//  - the debris of the landing piling up along the waterline: packs, life belts, ammunition boxes, rifles, gas masks
//    (where men came off the ramps and where they fell; the flood tide covers it as it comes in)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX_CR = 1400, MAX_BURN = 420, MAX_HULK = 40, MAX_DEB = 900, WIRE_SEG = 2.4, WIRE_X0 = 1180, WIRE_X1 = 2260;
  // crater radii (the scorch is ~2x): about 1.5x true (a 14-inch shell's crater ~8 m across, a 5-inch's ~3 m, a 500 lb bomb's ~9 m)
  const CAL_R = { big: 0.62, med: 0.38, small: 0.22, bomb: 0.7, mortar: 0.15 };
  const HULK_FIRE_T = 150, HULK_SMOKE_T = 420;
  let root = null, M = null, built = false, wireDirty = true, lastRt = 0;
  let craters = [], ci = 0, pre = [], burns = [], hulks = [], deb = [], di = 0;
  const on = () => !WW.simOnly && WW.isScn('normandy') && !!WW.scene && !!WW.normandyTerrain;
  function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hAt = (x, z) => WW.terrain.heightRaw(x, z);
  const dry = (x, z) => !WW.tide || WW.tide.depth(x, z) < -0.02;

  function geos() {
    const K = WW.soldierModel, { box, cyl } = K.prims(), P = (g, c, s, p, r) => K.part(g, c, s, p, r), G = {};
    const crater = (scorch, rim, pit) => K.merge([P(cyl, scorch, [2.1, 0.01, 2.1], [0, 0.005, 0]), P(cyl, rim, [1.25, 0.05, 1.25], [0, 0.02, 0]), P(cyl, pit, [0.85, 0.02, 0.85], [0, 0.045, 0])]);
    G.crE = crater(0x5d5245, 0x8b7a5e, 0x3b342c);        // earth: a scorch, the turned rim, the dark pit
    G.crS = crater(0xb9a77e, 0xe2d2a4, 0x8e7d5c);        // sand: a scoop of wet sand
    G.burn = K.merge([P(cyl, 0x3a342d, [2, 0.008, 2], [0, 0.004, 0]), P(cyl, 0x5e5850, [1.1, 0.008, 1.3], [0.2, 0.01, 0.1])]);
    // a 2.4 u run of concertina: coils on pickets
    const tor = new THREE.TorusGeometry(0.13, 0.009, 3, 8), W = [];
    for (let i = 0; i < 9; i++) W.push(P(tor, 0x3c3833, [1, 1, 1], [-1.1 + i * 0.275, 0.13, ((i * 7) % 3 - 1) * 0.015], [0.2 * ((i % 3) - 1), Math.PI / 2, 0]));
    for (const x of [-1.1, 0, 1.1]) W.push(P(box, 0x5a4a38, [0.02, 0.3, 0.02], [x, 0.15, 0]));
    G.wire = K.merge(W);
    G.sign = K.merge([P(box, 0x6a5a44, [0.03, 0.42, 0.03], [0, 0.21, 0]), P(box, 0xe6dfc6, [0.02, 0.16, 0.24], [0.02, 0.38, 0]), P(box, 0x2f2f2f, [0.022, 0.03, 0.18], [0.02, 0.36, 0])]);
    G.debris = [
      K.merge([P(box, 0x6f7550, [0.09, 0.07, 0.11], [0, 0.035, 0]), P(box, 0x8a8460, [0.1, 0.012, 0.115], [0, 0.07, 0])]),                       // a pack
      K.merge([P(new THREE.TorusGeometry(0.06, 0.02, 4, 10), 0x4f5546, [1, 1, 1], [0, 0.02, 0], [Math.PI / 2, 0, 0])]),                       // a life belt
      K.merge([P(box, 0x55593f, [0.12, 0.06, 0.06], [0, 0.03, 0]), P(box, 0xd8c890, [0.06, 0.004, 0.03], [0, 0.062, 0])]),                    // an ammunition box
      K.merge([P(box, 0x3a3c3e, [0.22, 0.014, 0.014], [0.03, 0.01, 0]), P(box, 0x8a5a34, [0.1, 0.022, 0.02], [-0.1, 0.012, 0])]),             // a rifle
      K.merge([P(cyl, 0x5c6243, [0.06, 0.05, 0.06], [0, 0.025, 0])])                                                                          // a gas mask can
    ];
    return G;
  }
  function init() {
    root = new THREE.Group(); root.name = 'beachhead';
    const G = geos(), grad = WW.models._grad ? WW.models._grad() : null;
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad }), matI = mat.clone();
    const mk = (g, n, tint, shadow) => { const im = new THREE.InstancedMesh(g, tint ? matI : mat, n); im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.castShadow = !!shadow; root.add(im); return im; };
    M = { crE: mk(G.crE, MAX_CR), crS: mk(G.crS, MAX_CR), burn: mk(G.burn, MAX_BURN), wire: mk(G.wire, 1000, false, true), sign: mk(G.sign, 120, false, true),
      hulk: mk(WW.tankModel.build().sherman, MAX_HULK, true, true), debris: G.debris.map(g => mk(g, MAX_DEB / 4 | 0, false, true)) };
    M.hulk.setColorAt(0, new THREE.Color(0.35, 0.33, 0.3));
    WW.scene.add(root);
    built = true;
  }
  // ---- placing things on the ground, tilted to it ----
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function ground(x, z, yaw, sx, sy, sz, tilt) {
    const e = 0.4, hx = WW.clamp((hAt(x + e, z) - hAt(x - e, z)) / (2 * e), -0.7, 0.7), hz = WW.clamp((hAt(x, z + e) - hAt(x, z - e)) / (2 * e), -0.7, 0.7);   // never stood on edge
    _n.set(-hx * (tilt === undefined ? 1 : tilt), 1, -hz * (tilt === undefined ? 1 : tilt)).normalize();
    _q.setFromUnitVectors(_up, _n).multiply(_q2.setFromAxisAngle(_up, yaw || 0));
    return _m.compose(_p.set(x, hAt(x, z) + 0.01, z), _q, _s.set(sx, sy, sz));
  }
  function addCrater(x, z, r, t0) {
    if (!(r > 0) || !dry(x, z)) return;
    const c = { x, z, r: r * (0.8 + Math.random() * 0.4), sand: WW.normandyTerrain.color && hAt(x, z) < 0.6 && z < WW.normandyTerrain.shingleZ(x) + 1.5, yaw: Math.random() * 6.28, t0: t0 || 0 };
    craters[ci] = c; ci = (ci + 1) % MAX_CR;
  }
  // the morning's bombardment before H-hour, and the grass fires (a fixed pattern: the same every round)
  function prePlan() {
    const r = prng(19440606), T = WW.normandyTerrain, C = WW.coastDefence, H = WW.scenarios.normandy.clock.H;
    pre = [];
    if (C) for (const w of C.wns) for (let k = 0; k < (w.hoc ? 26 : 14); k++) {
      const a = r() * 6.28, d = 4 + r() * (w.hoc ? 40 : 28);
      pre.push({ x: w.x + Math.cos(a) * d, z: w.z + Math.sin(a) * d * 0.7, r: r() < 0.25 ? CAL_R.big : CAL_R.med, t0: r() * H });
    }
    for (let k = 0; k < 160; k++) {                                         // the cruisers and destroyers on the bluffs
      const x = 1200 + r() * 1100, z = T.bluffFootZ(x) + r() * (T.bluffTopZ(x) - T.bluffFootZ(x) + 14);
      pre.push({ x, z, r: CAL_R.med * (0.6 + r() * 0.6), t0: r() * H * 1.3 });
    }
    burns = [];
    for (let k = 0; k < MAX_BURN; k++) {                                   // fires in clusters of ~6 patches
      if (k % 6 === 0) { burns.cx = 1150 + r() * 1150; burns.cf = r(); }
      const x = burns.cx + (r() - 0.5) * 7, z = T.bluffFootZ(x) + 2 + ((burns.cf + (r() - 0.5) * 0.25) % 1 + 1) % 1 * Math.max(2, T.bluffTopZ(x) - T.bluffFootZ(x) - 2);
      const sl = Math.abs(hAt(x, z + 0.6) - hAt(x, z - 0.6)) / 1.2; if (sl > 0.8) continue;   // not on the steepest faces
      burns.push({ x, z, r: 0.45 + r() * 0.9, ry: r() * 6.28, t0: 15 + r() * 360, sx: 0.7 + r() * 0.5 });
    }
  }
  // ---- the wire: along the shingle's crest and the bluff foot, gaps where the Bangalores went off ----
  function layWire() {
    const T = WW.normandyTerrain, gaps = WW.infRoutes ? WW.infRoutes.gaps : [], im = M.wire;
    let n = 0;
    for (const line of [x => T.shingleZ(x) + 1.7, x => T.bluffFootZ(x) - 0.8]) {
      for (let x = WIRE_X0; x < WIRE_X1 && n < im.instanceMatrix.count; x += WIRE_SEG) {
        if (gaps.some(g => Math.abs(g.x - x) < 3.5)) continue;
        const z = line(x), dz = line(x + 1) - line(x - 1);
        if (!dry(x, z)) continue;
        im.setMatrixAt(n++, ground(x, z, -Math.atan2(dz, 2), 1, 1, 1, 0.5));
      }
    }
    im.count = n; im.instanceMatrix.needsUpdate = true;
    // the minefield boards on the shelf
    const S = M.sign, r = prng(4471); let m = 0;
    for (let x = WIRE_X0; x < WIRE_X1 && m < S.instanceMatrix.count; x += 14 + r() * 10) {
      const z = T.shingleZ(x) + 3 + r() * Math.max(1, T.bluffFootZ(x) - T.shingleZ(x) - 4);
      S.setMatrixAt(m++, ground(x, z, Math.PI / 2 + (r() - 0.5) * 0.6, 1, 1, 1, 0.2));
    }
    S.count = m; S.instanceMatrix.needsUpdate = true;
    wireDirty = false;
  }
  function update(rdt) {
    if (!on()) { if (root) root.visible = false; return; }
    if (!built) init();
    root.visible = true;
    const rt = WW.game ? WW.game.roundTime : 0, dts = Math.max(0, Math.min(0.5, rt - lastRt)); lastRt = rt;
    if (!pre.length) prePlan();
    if (wireDirty) layWire();
    // craters: the ones fired this round and the pre-H bombardment's as their time comes
    let ne = 0, ns = 0;
    const put = c => {
      const im = c.sand ? M.crS : M.crE, k = c.sand ? ns++ : ne++;
      if (k < MAX_CR) im.setMatrixAt(k, ground(c.x, c.z, c.yaw, c.r, 1, c.r));
    };
    for (const c of pre) if (rt >= c.t0 && dry(c.x, c.z)) { if (c.sand === undefined) { c.sand = false; c.yaw = Math.random() * 6.28; } put(c); }
    for (const c of craters) if (c && dry(c.x, c.z)) put(c);
    M.crE.count = Math.min(MAX_CR, ne); M.crS.count = Math.min(MAX_CR, ns);
    M.crE.instanceMatrix.needsUpdate = true; M.crS.instanceMatrix.needsUpdate = true;
    // grass fires, spreading over a couple of minutes
    let nb = 0;
    for (const b of burns) if (rt > b.t0) { const g = Math.min(1, (rt - b.t0) / 120) * b.r; M.burn.setMatrixAt(nb++, ground(b.x, b.z, b.ry, g * b.sx, 1, g)); M.burn.getMatrixAt(nb - 1, _m); _m.elements[13] -= 0.004; M.burn.setMatrixAt(nb - 1, _m); }
    M.burn.count = nb; M.burn.instanceMatrix.needsUpdate = true;
    // the knocked-out tanks: burning, then smoking
    let nh = 0;
    for (const h of hulks) {
      const age = rt - h.t0;
      M.hulk.setMatrixAt(nh, ground(h.x, h.z, -h.h, 1, 1, 1, 0.7)); M.hulk.setColorAt(nh, _c); nh++;
      if (age < HULK_FIRE_T && WW.fx && WW.fx.fire) WW.fx.fire(h.x, hAt(h.x, h.z) + 0.35, h.z);
      if (age < HULK_SMOKE_T && WW.fx && WW.fx.smoke && Math.random() < (rdt || 0.016) * (age < HULK_FIRE_T ? 3 : 1.2)) WW.fx.smoke(h.x, hAt(h.x, h.z) + 0.5, h.z, true, age < HULK_FIRE_T ? 0.9 : 0.6);
    }
    M.hulk.count = nh; M.hulk.instanceMatrix.needsUpdate = true; if (M.hulk.instanceColor) M.hulk.instanceColor.needsUpdate = true;
    // the debris (the tide covers it: it is under the sea surface, nothing to do)
    const nd = [0, 0, 0, 0, 0];
    for (const d of deb) if (d) { const im = M.debris[d.k]; if (nd[d.k] < im.instanceMatrix.count) im.setMatrixAt(nd[d.k]++, ground(d.x, d.z, d.yaw, 1, 1, 1, 0.8)); }
    M.debris.forEach((im, k) => { im.count = nd[k]; im.instanceMatrix.needsUpdate = true; });
  }
  const _c = new THREE.Color(0.35, 0.33, 0.3);
  function drop(x, z, n, spread) {
    for (let i = 0; i < n; i++) {
      const dx = (Math.random() - 0.5) * spread, dz = (Math.random() - 0.3) * spread;
      deb[di] = { x: x + dx, z: z + dz, k: Math.floor(Math.random() * 5), yaw: Math.random() * 6.28 }; di = (di + 1) % MAX_DEB;
    }
  }
  WW.on('landImpact', e => {
    if (!on() || !e) return;
    const r = e.kind === 'bomb' ? CAL_R.bomb : CAL_R[e.cal] || CAL_R.small;
    addCrater(e.x, e.z, r);
  });
  WW.on('mortarBurst', e => { if (on()) addCrater(e.x, e.z, CAL_R.mortar); });
  WW.on('gapBlown', () => { wireDirty = true; });
  WW.on('squadEvent', e => {
    if (!on() || !e || !e.squad || e.kind !== 'lost' || e.squad.kind !== 'tank' || hulks.length >= MAX_HULK) return;
    const q = e.squad; hulks.push({ x: q.x, z: q.z, h: q.heading, t0: WW.game ? WW.game.roundTime : 0 });
  });
  WW.on('craftUnload', e => { if (on() && e && e.men > 0 && Math.random() < 0.6) drop(e.x, e.z + 1, 1 + (Math.random() * 2 | 0), 3); });
  WW.on('squadCasualty', e => { if (on() && e && Math.random() < 0.5) drop(e.x, e.z, 1, 2); });
  WW.on('roundStart', () => { craters = []; ci = 0; pre = []; burns = []; hulks = []; deb = []; di = 0; wireDirty = true; lastRt = 0; });
  WW.beachheadFx = { update, get craters() { return craters; }, get hulks() { return hulks; } };
})(window.WW);
