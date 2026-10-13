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
// Grey morning pass (after review: "the casemates' turf a bright pastel lime that pops out of the olive bluffs, the
// concrete near white"): the concrete a weathered grey-brown with rain streaks run down from under the slab and the
// blast's soot over the embrasure; the earth bank grassed in lumps and tussocks of the bluff's own olive (terrain
// colour bluff / scrub) instead of a flat lime panel; sandbags and spoil a dull khaki; the embrasures black. Hits on
// the concrete leave pock marks (up to 10); knocked out: no longer a featureless black box (a lighter burnt tint so
// the detail shows) but soot fanned up the front and over the door, cracks, a corner of the roof slab broken off and
// lying tilted at the foot, the rebar standing out of the break.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  let root = null, MAT = null;
  const byEl = new Map();
  // a grey June morning (after review: "the turf a pastel lime that pops out of the olive bluffs"): weathered concrete
  // in a grey-brown, stained under the roof, the turf the bluff's own olive (terrain_normandy.js color(): bluff
  // 0x75794f, scrub 0x5c6242; merge() pastels both the same way), the sandbags and the spoil a dull khaki, the
  // embrasures black holes
  const C = { conc: 0x7a7365, concD: 0x625c51, concL: 0x857e70, slit: 0x121314, stain: 0x6b655a, camoB: 0x6b5c45, camoG: 0x5d6346,
    earth: 0x695c45, grass: 0x6f734b, grassD: 0x5c6242, tuft: 0x4c5238, bagA: 0x8a7b5d, bagB: 0x776a50, pit: 0x4c4234, gun: 0x4f554a,
    gunD: 0x34372f, scorch: 0x1c1a18, soot: 0x1e1c1a, crack: 0x2a2724 };
  function mats() {
    if (MAT) return MAT;
    const grad = WW.models && WW.models._grad ? WW.models._grad() : null;
    const toon = c => new THREE.MeshToonMaterial({ color: c, vertexColors: true, gradientMap: grad });
    MAT = { body: toon(0xffffff), burnt: toon(0x8a847c), scar: new THREE.MeshToonMaterial({ color: 0x3a3631, gradientMap: grad }), soot: toon(0xffffff), scorch: new THREE.MeshBasicMaterial({ color: C.scorch, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }) };
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
    const { box, sph } = prims(), part = WW.soldierModel.part, r = e.rad, h = e.K.top;
    const sv = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.heading);   // world north in the local frame
    const seaX = Math.abs(sv.x) > 0.5, sz = seaX ? 0 : Math.sign(sv.z), L = r * 1.5, W = r * 1.3, dig = 1.2;
    const y0 = Math.min(gnd(0, 0), gnd(L / 2, 0), gnd(-L / 2, 0), gnd(0, W / 2), gnd(0, -W / 2));
    const yb = y0 - dig, top = gnd(0, 0) + h, R = Math.random;
    P.push(part(box, C.conc, [L, top - yb, W], [0, (top + yb) / 2, 0]));                                // the block, dug in
    P.push(part(box, C.concL, [L + 0.24, 0.16, W + 0.24], [0, top + 0.06, 0]));                         // the roof slab's overhang
    // the weather: rain streaks run down the faces from under the slab (the land face, the front, the rear)
    const streak = (x, z, ax) => { const w = 0.04 + R() * 0.08, l = h * (0.25 + R() * 0.45); P.push(part(box, C.stain, ax ? [0.02, l, w] : [w, l, 0.02], [x, top - 0.03 - l / 2, z])); };
    for (let i = 0; i < 4; i++) streak(-L / 2 + L * (i + 0.3 + R() * 0.4) / 4, (seaX ? 1 : -sz) * (W / 2 + 0.012), false);
    for (let i = 0; i < 2; i++) { streak(L / 2 + 0.012, (R() - 0.5) * W * 0.8, true); streak(-L / 2 - 0.012, (R() - 0.5) * W * 0.8, true); }
    const dim = { L, W, top, yb, sz, h, seaX };
    if (!seaX) {
      // the flanking wall to the sea: thick, higher, run out past the embrasure to shield it from the sea
      const wz = sz * (W / 2 + 0.22);
      P.push(part(box, C.concD, [L + 1.0, top + 0.12 - yb, 0.45], [0.45, (top + 0.12 + yb) / 2, wz]));
      P.push(part(box, C.concL, [L + 1.06, 0.08, 0.5], [0.45, top + 0.16, wz]));
      // the earth banked against it and over the roof: the bare ramp, and the turf on it in lumps and tussocks (not
      // a flat panel), the bluff's own olive; the earth shows at the toe and the ends
      const bh = top + 0.1 - yb;
      P.push(part(box, C.earth, [L + 0.5, bh, 1.1], [0.2, yb + bh / 2 - 0.15, sz * (W / 2 + 0.95)], [-sz * 0.55, 0, 0]));
      P.push(part(box, C.grassD, [L + 0.2, bh * 0.9, 1.1], [0.2, yb + bh / 2 - 0.05, sz * (W / 2 + 1.02)], [-sz * 0.55, 0, 0]));
      for (let i = 0; i < 5; i++) {
        const x = -L / 2 + L * (i + 0.5) / 5 + (R() - 0.5) * 0.3, f = 0.35 + R() * 0.45, yy = yb + bh * (1 - f) + 0.25, zz = sz * (W / 2 + 0.55 + f * 0.95);
        P.push(part(sph, i & 1 ? C.grass : C.grassD, [L / 4 + R() * 0.4, 0.45 + R() * 0.25, 0.9 + R() * 0.3], [x, Math.min(yy, top + 0.05), zz], [R() * 0.3, R() * 3, 0]));
      }
      for (let i = 0; i < 3; i++) P.push(part(sph, C.tuft, [0.25, 0.18, 0.25], [-L / 2 + L * R(), top - h * R() * 0.6, sz * (W / 2 + 0.9 + R() * 0.6)]));
      P.push(part(sph, C.grass, [L * 0.8, 0.22, W * 0.62], [-L * 0.1, top + 0.13, sz * W * 0.18]));            // the turf on the roof
      P.push(part(sph, C.grassD, [L * 0.45, 0.2, W * 0.4], [-L * 0.25, top + 0.17, sz * W * 0.28]));
      // the embrasure: a stepped mouth in the front face beside the wing wall, black inside
      P.push(part(box, C.concD, [0.14, h * 0.6, W * 0.66], [L / 2 + 0.04, top - h * 0.5, -sz * 0.05]));
      P.push(part(box, C.slit, [0.16, h * 0.4, W * 0.46], [L / 2 + 0.07, top - h * 0.48, -sz * 0.05]));
      P.push(part(box, C.stain, [0.02, h * 0.18, W * 0.5], [L / 2 + 0.115, top - h * 0.17, -sz * 0.05]));     // the blast's soot over it
      P.push(part(box, C.slit, [0.3, 0.45, 0.5], [-L / 2 - 0.02, gnd(-L / 2, -sz * W * 0.2) + 0.25, -sz * W * 0.2]));   // the rear door
      // camouflage patches on the faces that show
      for (const [x, y, z, sx, sy, sz2, c] of [[0.1, 0.55, -sz * (W / 2 + 0.016), L * 0.4, 0.35, 0.02, C.camoB], [-0.3 * L, 0.3, -sz * (W / 2 + 0.016), L * 0.3, 0.3, 0.02, C.camoG],
        [L / 2 + 0.016, 0.85, sz * 0.25 * W, 0.02, 0.25, W * 0.3, C.camoG], [-L / 2 - 0.016, 0.6, sz * 0.2 * W, 0.02, 0.35, W * 0.35, C.camoB]])
        P.push(part(box, c, [sx, sy * h, sz2], [x, top - h + y * h, z]));
      return { mx: L / 2 + 0.02, my: top - h * 0.48, mz: -sz * 0.05, dim };
    }
    // the observation bunker: the slit to the sea on +x, earth over the sides and the back
    P.push(part(box, C.slit, [0.06, h * 0.16, W * 0.6], [L / 2 + 0.02, top - h * 0.3, 0]));
    P.push(part(box, C.concL, [0.4, 0.06, W * 0.7], [L / 2 + 0.2, top - h * 0.2, 0]));
    for (const z of [-1, 1]) P.push(part(sph, C.earth, [L * 1.1, top - y0 + 0.5, 1.4], [-0.2, y0 + (top - y0) * 0.3, z * (W / 2 + 0.5)]));
    for (const z of [-1, 1]) P.push(part(sph, C.grassD, [L * 0.9, top - y0 + 0.4, 1.2], [-0.3, y0 + (top - y0) * 0.35, z * (W / 2 + 0.6)]));
    P.push(part(sph, C.grass, [1.6, top - y0 + 0.6, W * 1.1], [-L / 2 - 0.5, y0 + (top - y0) * 0.3, 0]));
    P.push(part(sph, C.grassD, [L * 0.6, 0.2, W * 0.5], [-0.2, top + 0.13, 0.2]));
    return { mx: L / 2, my: top - h * 0.3, mz: 0, dim, op: true };
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
  // knocked out: burnt, the barrel drooped or blown askew, a scorch and rubble around it. A casemate: the fire's soot
  // fanned up the face over the embrasure and the door, cracks across the faces, a corner of the roof slab broken off
  // and lying tilted at the foot with the rebar standing out of the break, the turf burnt
  function knocked(e) {
    const g = byEl.get(e); if (!g || g.userData.out) return;
    g.userData.out = true;
    const M = mats(), part = WW.soldierModel.part, { box, sph, cyl } = prims(), R = Math.random;
    g.traverse(o => { if (o.isMesh && o.material === M.body) o.material = M.burnt; });
    const b = g.userData.barrel;
    if (b) { b.rotation.z = -0.3 - R() * 0.15; b.rotation.y += (R() - 0.5) * 0.5; }
    const gnd = groundFn(e, e.y), r = e.rad, P = [], S = [];   // P: burnt rubble; S: soot and cracks (unlit-dark)
    const mo = g.userData.mouth, d = mo && mo.dim;
    for (let i = 0; i < (d ? 12 : 9); i++) {      // rubble: concrete chunks off a casemate, burst sandbags off a pit
      const a = R() * 6.28, dd = r * (0.8 + R() * 0.9), x = Math.cos(a) * dd, z = Math.sin(a) * dd;
      const conc = e.K.wall;
      P.push(part(conc ? box : sph, conc ? C.concD : (i & 1 ? C.bagB : C.earth), conc ? [0.3 + R() * 0.3, 0.2, 0.25 + R() * 0.2] : [0.35, 0.12, 0.25],
        [x, gnd(x, z) + 0.06, z], [R() * 0.6, R() * 6, R() * 0.6]));
    }
    if (d) {
      const { L, W, top, h, sz, seaX } = d, fz = seaX ? 1 : -sz;   // fz: the land face (the side that shows)
      if (!mo.op) {     // soot up the front over the embrasure, and over the rear door
        S.push(part(box, C.soot, [0.02, h * 0.55, W * 0.6], [L / 2 + 0.125, top - h * 0.3, mo.mz]));
        S.push(part(box, C.soot, [0.02, h * 0.3, W * 0.85], [L / 2 + 0.125, top - h * 0.08, mo.mz]));
      }
      S.push(part(box, C.soot, [0.02, h * 0.5, 0.75], [-L / 2 - 0.03, top - h * 0.35, -sz * W * 0.2]));
      for (let i = 0; i < 6; i++) {    // cracks: dark slivers across the land face, the front and the roof
        const k = i % 3, t = (R() - 0.5) * 1.6, l = 0.35 + R() * 0.6;
        if (k === 0) S.push(part(box, C.crack, [l, 0.035, 0.02], [(R() - 0.5) * L * 0.8, top - h * (0.2 + R() * 0.6), fz * (W / 2 + 0.03)], [0, 0, t]));
        else if (k === 1) S.push(part(box, C.crack, [0.02, 0.035, l], [L / 2 + 0.03, top - h * (0.1 + R() * 0.3), (R() - 0.5) * W * 0.8], [t, 0, 0]));
        else S.push(part(box, C.crack, [l, 0.02, 0.035], [(R() - 0.5) * L * 0.7, top + 0.15, (R() - 0.5) * W * 0.7], [0, t, 0]));
      }
      // the roof slab's front corner on the land side broken off: the hole black, the slab lying tilted at the foot
      const cx = L / 2 - 0.35, cz = fz * (W / 2 - 0.3);
      S.push(part(box, C.soot, [0.75, 0.04, 0.75], [cx, top + 0.15, cz]));
      P.push(part(box, C.concL, [0.9, 0.16, 0.8], [L / 2 + 0.5, gnd(L / 2 + 0.5, cz + fz * 0.4) + 0.2, cz + fz * 0.4], [0.5 * fz, 0.4, -0.45]));
      for (let i = 0; i < 4; i++) S.push(part(cyl, C.crack, [0.018, 0.4 + R() * 0.3, 0.018], [cx + (R() - 0.5) * 0.6, top + 0.2, cz + (R() - 0.5) * 0.6], [(R() - 0.5) * 1.2, 0, (R() - 0.5) * 1.2]));
    }
    g.add(mesh(WW.soldierModel.merge(P), M.burnt));
    if (S.length) { const m = mesh(WW.soldierModel.merge(S), M.soot); m.castShadow = false; g.add(m); }
    const sc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.7, 14), M.scorch);   // the scorch on the ground
    sc.rotation.x = -Math.PI / 2; sc.position.set(0, gnd(0, 0) + 0.06, 0); sc.renderOrder = 1;
    g.add(sc);
    if (WW.fx && WW.fx.smoke) for (let k = 0; k < 4; k++) WW.fx.smoke(e.x + (R() - 0.5) * 2, e.y + 1 + k * 0.8, e.z + (R() - 0.5) * 2, true, 1.2 + k * 0.3);
  }
  // a shell bursting on a casemate's concrete: a pock mark (a dark gouge) left where it struck the land face or the
  // front, up to 10 a casemate; the sea wall takes the rest unseen
  function scar(e, wx, wz) {
    const g = byEl.get(e), mo = g && g.userData.mouth, d = mo && mo.dim; if (!d || (g.userData.scars | 0) >= 10) return;
    g.userData.scars = (g.userData.scars | 0) + 1;
    const c = Math.cos(e.heading), s = Math.sin(e.heading), dx = wx - e.x, dz = wz - e.z, lx = c * dx + s * dz, lz = -s * dx + c * dz;
    const { L, W, top, h, sz, seaX } = d, fz = seaX ? 1 : -sz, R = Math.random, k = 0.25 + R() * 0.25;
    const front = Math.abs(lx) / L > Math.abs(lz) / W && lx > 0;
    const y = top - h * (0.15 + R() * 0.7), m = new THREE.Mesh(prims().sph, mats().scar);
    if (front) m.position.set(L / 2 + 0.02, y, Math.max(-W / 2 + 0.2, Math.min(W / 2 - 0.2, lz)));
    else m.position.set(Math.max(-L / 2 + 0.2, Math.min(L / 2 - 0.2, lx)), y, fz * (W / 2 + 0.02));
    m.scale.set(front ? 0.06 : k, k * 0.8, front ? k : 0.06);
    g.add(m);
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
    if (e.K.wall && ev.kind !== 'bomb' && e.alive) scar(e, ev.x, ev.z);
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
