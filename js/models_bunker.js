// models_bunker.js - WW.bunkerModels: the German strongpoints on screen (visual only, render mode; Math.random).
// Built on 'defencesBuilt' (coast_defence.js): one group per element in the toy style of the ships:
//  - casemate: a concrete block with a thick wall to the sea and its embrasure on the side it fires from, the gun
//    barrel poking out along the beach; observation bunker: a block with a slit to the sea
//  - gun pit / 155: a sandbag ring with a field gun; Tobruk: a ring with a small turret; MG nest: a sandbag horseshoe
//    with an MG; mortar: a round pit; flak: a ring with a 2 cm gun; anti-tank wall: a concrete slab across the draw
// Knocked out ('defenceEvent' out): blackened, the barrel drooped, smoke; hits: an explosion on the concrete.
// Polish pass (after review: "plain grey boxes, the same colour as the sand"): every element is one merged
// vertex-coloured geometry (WW.soldierModel.part / merge) with the ships' toon shading, so it can carry detail:
//  - casemates: warm weathered concrete with brown and olive camouflage patches, the roof slab's overhang, the
//    flanking wing wall to the sea run out past the embrasure, the stepped embrasure, the rear door, and the earth
//    banked up over the sea wall and the roof (grassed): an H 677 / H 612 as the surveys photographed them. The block
//    runs down into the ground, so on the slope it is dug in on the uphill side instead of floating on the downhill.
//  - pits: rings of single sandbags in two courses (two tones), each bag set on the ground under it (the bluffs are
//    steep), the dark pit floor inside, the spoil heaped outside; the MG nest a horseshoe open to the rear.
//  - knocked out: the burnt material (the same vertex colours darkened), the barrel drooped or blown askew, a scorch
//    on the ground, rubble (concrete chunks, burst sandbags). The crews, the MG 42s, the tracers and the gun flashes
//    are defence_fx.js. 'defenceFire' (gun): the barrel trains on the target (local yaw = heading - aim), in its arc.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  let root = null, MAT = null;
  const byEl = new Map();
  const C = { conc: 0xb3ab98, concD: 0x968f7f, concL: 0xc4bca8, slit: 0x26272a, camoB: 0x8b7556, camoG: 0x7f8a62, earth: 0x8c7a58, grass: 0x93a96a,
    bagA: 0xbfa97c, bagB: 0xa99470, pit: 0x6a5c45, gun: 0x5a6152, gunD: 0x3e423d, scorch: 0x2a2724 };
  function mats() {
    if (MAT) return MAT;
    const grad = WW.models && WW.models._grad ? WW.models._grad() : null;
    const toon = c => new THREE.MeshToonMaterial({ color: c, vertexColors: true, gradientMap: grad });
    MAT = { body: toon(0xffffff), burnt: toon(0x4c4844), scorch: new THREE.MeshBasicMaterial({ color: C.scorch, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }) };
    return MAT;
  }
  const prims = () => WW.soldierModel.prims();
  // local (x along where it looks, z across) -> the ground height under it, relative to the group's origin
  function groundFn(e, oy) {
    const c = Math.cos(e.heading), s = Math.sin(e.heading);
    return (lx, lz) => Math.max(-0.2, WW.terrain.heightRaw(e.x + c * lx - s * lz, e.z + s * lx + c * lz)) - oy;
  }
  function mesh(geo, mat) { const o = new THREE.Mesh(geo, mat); o.castShadow = true; o.receiveShadow = true; return o; }
  // a ring of sandbags: radius rr, from angle a0 to a1 (the gap at the rear for an MG nest), two courses
  function bags(P, gnd, rr, a0, a1, tall) {
    const { box } = prims(), part = WW.soldierModel.part;
    const n = Math.max(6, Math.round((a1 - a0) * rr / 0.32));
    for (let course = 0; course < (tall ? 3 : 2); course++) for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i + (course & 1) * 0.5) / n; if (a > a1 + 1e-6) continue;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr, y = gnd(x, z);
      P.push(part(box, (i + course) % 3 ? C.bagA : C.bagB, [0.2, 0.1, 0.34 * Math.max(1, rr / 1.4)], [x, y + 0.05 + course * 0.095, z], [0, -a + (course & 1) * 0.08, 0]));
    }
    for (let i = 0; i < 8; i++) {      // the spoil heaped outside the ring
      const a = a0 + (a1 - a0) * (i + 0.5) / 8, x = Math.cos(a) * (rr + 0.35), z = Math.sin(a) * (rr + 0.35);
      P.push(part(prims().sph, C.earth, [0.55, 0.16, 0.5], [x, gnd(x, z), z], [0, -a, 0]));
    }
  }
  function pitFloor(P, gnd, rr) { P.push(WW.soldierModel.part(prims().cyl, C.pit, [rr * 2, 0.04, rr * 2], [0, gnd(0, 0) + 0.02, 0])); }

  // the casemate / observation bunker. Local frame: +x where it looks; the sea is local -z (east-facing), +z (west), or
  // +x (a bunker looking out to sea)
  function casemate(e, P, gnd) {
    const { box } = prims(), part = WW.soldierModel.part, r = e.rad, h = e.K.top;
    const sv = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.heading);   // world north in the local frame
    const seaX = Math.abs(sv.x) > 0.5, sz = seaX ? 0 : Math.sign(sv.z), L = r * 1.5, W = r * 1.3, dig = 1.2;
    const y0 = Math.min(gnd(0, 0), gnd(L / 2, 0), gnd(-L / 2, 0), gnd(0, W / 2), gnd(0, -W / 2));
    const yb = y0 - dig, top = gnd(0, 0) + h;
    P.push(part(box, C.conc, [L, top - yb, W], [0, (top + yb) / 2, 0]));                                // the block, dug in
    P.push(part(box, C.concL, [L + 0.24, 0.16, W + 0.24], [0, top + 0.06, 0]));                         // the roof slab's overhang
    if (!seaX) {
      // the flanking wall to the sea: thick, higher, run out past the embrasure to shield it from the sea
      const wz = sz * (W / 2 + 0.22);
      P.push(part(box, C.concD, [L + 1.0, top + 0.12 - yb, 0.45], [0.45, (top + 0.12 + yb) / 2, wz]));
      P.push(part(box, C.concL, [L + 1.06, 0.08, 0.5], [0.45, top + 0.16, wz]));
      // the earth banked against it and over the roof, grassed
      const bh = top + 0.1 - yb;   // the bank: a grassed ramp leaning on the sea wall, the bare earth showing at its ends
      P.push(part(box, C.earth, [L + 0.5, bh, 1.1], [0.2, yb + bh / 2 - 0.15, sz * (W / 2 + 0.95)], [-sz * 0.55, 0, 0]));
      P.push(part(box, C.grass, [L + 0.3, bh, 1.1], [0.2, yb + bh / 2 - 0.1, sz * (W / 2 + 1.0)], [-sz * 0.55, 0, 0]));
      P.push(part(box, C.grass, [L * 0.75, 0.1, W * 0.6], [-L * 0.1, top + 0.18, sz * W * 0.18]));
      // the embrasure: stepped mouth in the front face, beside the wing wall
      P.push(part(box, C.concD, [0.12, h * 0.55, W * 0.62], [L / 2 + 0.04, top - h * 0.5, -sz * 0.05]));
      P.push(part(box, C.slit, [0.12, h * 0.34, W * 0.42], [L / 2 + 0.07, top - h * 0.48, -sz * 0.05]));
      P.push(part(box, C.slit, [0.3, 0.45, 0.5], [-L / 2 - 0.02, gnd(-L / 2, -sz * W * 0.2) + 0.25, -sz * W * 0.2]));   // the rear door
      // camouflage patches on the faces that show
      for (const [x, y, z, sx, sy, sz2, c] of [[0.1, 0.55, -sz * (W / 2 + 0.01), L * 0.4, 0.35, 0.02, C.camoB], [-0.3 * L, 0.3, -sz * (W / 2 + 0.01), L * 0.3, 0.3, 0.02, C.camoG],
        [L / 2 + 0.01, 0.85, sz * 0.25 * W, 0.02, 0.25, W * 0.3, C.camoG], [-L / 2 - 0.01, 0.6, sz * 0.2 * W, 0.02, 0.35, W * 0.35, C.camoB], [0.2 * L, 0.98, -sz * 0.2, L * 0.35, 0.02, W * 0.4, C.camoB]])
        P.push(part(box, c, [sx, sy * h, sz2], [x, top - h + y * h, z]));
      return { mx: L / 2 + 0.02, my: top - h * 0.48, mz: -sz * 0.05 };
    }
    // the observation bunker: the slit to the sea on +x, earth over the sides and the back
    P.push(part(box, C.slit, [0.06, h * 0.16, W * 0.6], [L / 2 + 0.02, top - h * 0.3, 0]));
    P.push(part(box, C.concL, [0.4, 0.06, W * 0.7], [L / 2 + 0.2, top - h * 0.2, 0]));
    for (const z of [-1, 1]) P.push(part(prims().sph, C.earth, [L * 1.1, top - y0 + 0.5, 1.4], [-0.2, y0 + (top - y0) * 0.3, z * (W / 2 + 0.5)]));
    P.push(part(prims().sph, C.grass, [1.6, top - y0 + 0.6, W * 1.1], [-L / 2 - 0.5, y0 + (top - y0) * 0.3, 0]));
    P.push(part(box, C.camoB, [L * 0.5, 0.02, W * 0.4], [-0.2, top + 0.15, 0.2]));
    return null;
  }

  function build(e) {
    const g = new THREE.Group(), r = e.rad, h = e.K.top, M = mats(), part = WW.soldierModel.part, { box, cyl } = prims();
    g.position.set(e.x, e.y, e.z);
    g.rotation.y = -e.heading;   // local +x: where it looks
    const gnd = groundFn(e, e.y), P = [], B = [];   // P: the body; B: the barrel (it trains and droops)
    let mouth = null, pivot = [0, 0.35, 0];
    if (e.type === 'casemate' || e.type === 'bunker') {
      mouth = casemate(e, P, gnd);
      if (e.K.gun && mouth) {
        pivot = [mouth.mx - 0.5, mouth.my, mouth.mz];
        const k = e.K.gun.cal === 'small' ? 0.8 : 1.1;
        B.push(part(cyl, C.gunD, [0.13 * k, 0.5, 0.13 * k], [0.45, 0, 0], [0, 0, Math.PI / 2]));
        B.push(part(cyl, C.gunD, [0.09 * k, r * 0.9, 0.09 * k], [0.5 + r * 0.45, 0, 0], [0, 0, Math.PI / 2]));
        if (e.kind === 'c88') B.push(part(cyl, C.gunD, [0.13, 0.12, 0.13], [0.5 + r * 0.9, 0, 0], [0, 0, Math.PI / 2]));   // the muzzle brake
      }
    } else if (e.type === 'wall') {
      const y0 = Math.min(gnd(0, -r), gnd(0, r), gnd(0, 0));
      P.push(part(box, C.conc, [0.6, h + (gnd(0, 0) - y0) + 0.4, r * 2], [0, (gnd(0, 0) + h + y0 - 0.4) / 2, 0]));
      P.push(part(box, C.concL, [0.7, 0.08, r * 2.05], [0, gnd(0, 0) + h, 0]));
      for (let i = -2; i <= 2; i++) P.push(part(box, C.camoB, [0.02, h * 0.4, 0.5], [0.31, gnd(0, i * r * 0.4) + h * 0.5, i * r * 0.4]));
    } else {
      const ringR = r * (e.type === 'mg' ? 0.75 : e.type === 'mortar' ? 0.8 : e.type === 'tobruk' ? 0.7 : 0.95);
      pitFloor(P, gnd, ringR);
      // an MG nest is a horseshoe open to the rear (local -x); the rest are full rings
      if (e.type === 'mg') bags(P, gnd, ringR, -2.3, 2.3, false);
      else bags(P, gnd, ringR, 0, Math.PI * 2 - 0.25, e.type === 'battery' || e.type === 'gunpit');
      const y = gnd(0, 0);
      if (e.type === 'tobruk') {        // the Tobruk: the concrete ring-stand with its small turret
        P.push(part(cyl, C.conc, [0.8, 0.22, 0.8], [0, y + 0.1, 0]));
        P.push(part(cyl, C.slit, [0.45, 0.04, 0.45], [0, y + 0.22, 0]));
        P.push(part(box, C.gun, [0.4, 0.2, 0.36], [0, y + 0.32, 0]));
        pivot = [0.1, y + 0.33, 0];
        B.push(part(cyl, C.gunD, [0.06, 0.6, 0.06], [0.3, 0, 0], [0, 0, Math.PI / 2]));
      } else if (e.type === 'battery' || e.type === 'gunpit') {   // the field gun: shield, trail, wheels, barrel
        const big = e.type === 'battery', k = big ? 1.6 : 1;
        P.push(part(box, C.gun, [0.12 * k, 0.4 * k, 0.75 * k], [0.15 * k, y + 0.3 * k, 0]));                   // the shield
        P.push(part(box, C.gunD, [0.9 * k, 0.08 * k, 0.1 * k], [-0.4 * k, y + 0.1 * k, 0.12 * k], [0, -0.2, -0.12]));   // the split trail
        P.push(part(box, C.gunD, [0.9 * k, 0.08 * k, 0.1 * k], [-0.4 * k, y + 0.1 * k, -0.12 * k], [0, 0.2, -0.12]));
        for (const z of [-1, 1]) P.push(part(cyl, C.gunD, [0.36 * k, 0.07 * k, 0.36 * k], [0, y + 0.18 * k, z * 0.32 * k], [Math.PI / 2, 0, 0]));
        pivot = [0.05 * k, y + 0.3 * k, 0];
        B.push(part(cyl, C.gunD, [0.08 * k, (big ? 2.4 : 1.3), 0.08 * k], [(big ? 1.2 : 0.65), 0, 0], [0, 0, Math.PI / 2]));
      } else if (e.type === 'flak') {   // the 2 cm Flak 38 on its cruciform mount
        P.push(part(box, C.gunD, [1.0, 0.06, 0.12], [0, y + 0.05, 0]));
        P.push(part(box, C.gunD, [0.12, 0.06, 1.0], [0, y + 0.05, 0]));
        P.push(part(box, C.gun, [0.3, 0.25, 0.3], [0, y + 0.2, 0]));
        pivot = [0, y + 0.32, 0];
        B.push(part(cyl, C.gunD, [0.045, 0.8, 0.045], [0.4, 0, 0], [0, 0, Math.PI / 2]));
      }
      // MG nests and mortar pits carry their weapon in defence_fx.js (the MG 42 on the parapet, the Granatwerfer)
    }
    const body = mesh(WW.soldierModel.merge(P), M.body); g.add(body);
    let barrel = null;
    if (B.length) {
      barrel = new THREE.Group(); barrel.position.set(pivot[0], pivot[1], pivot[2]);
      barrel.add(mesh(WW.soldierModel.merge(B), M.body));
      if (e.type === 'flak') barrel.rotation.z = 0.6;
      g.add(barrel);
    }
    g.userData = { barrel, mouth, body };
    root.add(g);
    byEl.set(e, g);
  }
  // knocked out: burnt, the barrel drooped or blown askew, a scorch and rubble around it
  function knocked(e) {
    const g = byEl.get(e); if (!g) return;
    const M = mats(), part = WW.soldierModel.part, { box, sph } = prims();
    g.traverse(o => { if (o.isMesh && o.material === M.body) o.material = M.burnt; });
    const b = g.userData.barrel;
    if (b) { b.rotation.z = -0.3 - Math.random() * 0.15; b.rotation.y += (Math.random() - 0.5) * 0.5; }
    const gnd = groundFn(e, e.y), r = e.rad, P = [];
    for (let i = 0; i < 9; i++) {      // rubble: concrete chunks off a casemate, burst sandbags off a pit
      const a = Math.random() * 6.28, d = r * (0.8 + Math.random() * 0.9), x = Math.cos(a) * d, z = Math.sin(a) * d;
      const conc = e.K.wall;
      P.push(part(conc ? box : sph, conc ? C.concD : (i & 1 ? C.bagB : C.earth), conc ? [0.3 + Math.random() * 0.3, 0.2, 0.25 + Math.random() * 0.2] : [0.35, 0.12, 0.25],
        [x, gnd(x, z) + 0.06, z], [Math.random() * 0.6, Math.random() * 6, Math.random() * 0.6]));
    }
    g.add(mesh(WW.soldierModel.merge(P), M.burnt));
    const sc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.7, 14), M.scorch);   // the scorch on the ground
    sc.rotation.x = -Math.PI / 2; sc.position.set(0, gnd(0, 0) + 0.06, 0); sc.renderOrder = 1;
    g.add(sc);
    if (WW.fx && WW.fx.smoke) for (let k = 0; k < 4; k++) WW.fx.smoke(e.x + (Math.random() - 0.5) * 2, e.y + 1 + k * 0.8, e.z + (Math.random() - 0.5) * 2, true, 1.2 + k * 0.3);
  }
  function clear() { if (root && WW.scene) WW.scene.remove(root); root = null; byEl.clear(); }
  WW.on('defencesBuilt', d => {
    if (WW.simOnly || !WW.scene || !WW.soldierModel) return;
    clear();
    root = new THREE.Group(); root.name = 'bunkers';
    d.elements.forEach(e => { if (!e.dormant || e.type === 'battery') build(e); });
    WW.scene.add(root);
  });
  WW.on('roundStart', () => { if (!WW.isScn('normandy')) clear(); });
  WW.on('setupStart', () => { if (!WW.isScn('normandy')) clear(); });
  WW.on('defenceEvent', ev => { if (ev.kind === 'out' && ev.el && !WW.simOnly) knocked(ev.el); });
  WW.on('defenceHit', ev => {
    if (WW.simOnly || !WW.fx) return;
    const e = ev.el, big = ev.cal === 'big' || ev.kind === 'bomb';
    if (WW.fx.explosion) WW.fx.explosion(ev.x, e.y + 0.8, ev.z, big ? 2.2 : ev.cal === 'med' ? 1.3 : 0.8);
    if (!ev.through && WW.fx.sparks) WW.fx.sparks(ev.x, e.y + 0.8, ev.z);   // the shell bursts on the concrete
  });
  // a gun firing: the barrel trains on the target (inside its arc); the flash and the blast are defence_fx.js
  WW.on('defenceFire', ev => {
    if (WW.simOnly || !ev.el || ev.kind !== 'gun' || ev.el.aim === undefined) return;
    const e = ev.el, g = byEl.get(e), b = g && g.userData.barrel; if (!b || !e.alive) return;
    const d = WW.angleDiff(e.aim, e.heading), lim = e.arc >= Math.PI - 1e-6 ? Math.PI : e.arc;
    b.rotation.y = Math.max(-lim, Math.min(lim, d));
  });
  WW.bunkerModels = { get root() { return root; }, groupOf: e => byEl.get(e) };
})(window.WW);
