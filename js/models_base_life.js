// models_base_life.js - WW.baseLifeModels: the island base's camp in the toy style (visual only; never built in
// sim-only mode). The items of base.decor (base_life_layout.js): USN Quonset huts / IJN wooden barracks, pyramidal
// tents, the mess hall (a stovepipe), the sick bay (a red cross), the radio shack and its two lattice masts with the
// aerial between them, a water tower, the sandbagged command post, the flagpole (the owner's flag, models_base.js),
// machine-gun pits (twin .50s / a Type 93 on a mount that trains and elevates), zigzag slit trenches with sandbag
// lips, fuel-drum stacks, searchlights (the lamp head turns), a laundry line, a card table, parked trucks and jeeps;
// the flight line's clutter: bomb dumps, fuel-drum rows, crates, Marston-mat stacks (IJN: lumber piles), open-sided
// maintenance tents, the line shack with its windsock and sortie board.
// Each kind is baked once per nation into one geometry (vertex colours x the shared toon material, as models_base.js),
// drawn as one InstancedMesh per kind (all but the vehicles, which move).
// build(base, mat) -> { parts: [{ f, mesh, inst, gun, head, flag, decor: true, y }], glow, insts } (glow: one merged
// mesh of lit windows for the night, hidden by day and after the blackout; insts: the InstancedMeshes). vehicle(kind, nation): 'truck' | 'jeep' | 'stretcher'
// (nose +x, wheels on y = 0, x VEH_K like base_ground_fx's vehicles).
window.WW = window.WW || {};
(function () {
  'use strict';
  var PI = Math.PI, M = null, B = null, TPL = {}, VEH = {};
  var C = { quon: 0x8c977f, quonDk: 0x6f7a66, wood: 0xb08a62, woodDk: 0x8a6a4a, roofI: 0x6f7468, tentU: 0x8f9a6a, tentI: 0xc8b88a,
    door: 0x5d5a52, win: 0x86aac4, cream: 0xeadfc6, red: 0xd2564c, white: 0xf4efe4, steel: 0x7e858a, gun: 0x5a5f62, sand: 0xc9b688,
    sandDk: 0xb29e70, dirt: 0x6d5a45, dirtDk: 0x4e4236, pole: 0xd8d8d0, tank: 0xd9d4c6, drumO: 0x6b7350, drumR: 0xb8473f,
    canvas: 0x8b8f62, canvasI: 0xa49c72, olive: 0x6b7350, ijnV: 0x7c7f60, tyre: 0x2e2e2c, lamp: 0xe9e4cf, glass: 0xfff2c0,
    crate: 0x8d7a52, crateDk: 0x6f603f, drumI: 0x8a8672, bombU: 0x5e6444, bombI: 0x5b5f5d, yellow: 0xd9b84a, psp: 0x8a9096,
    pspDk: 0x5f666b, sock: 0xe0763a, cloth: [0xf4efe4, 0x84a4cc, 0xe8c55a, 0xcc8a6a, 0x9fb9a0] };

  function quonset(g, len, w, h, col, dk) { // a half-barrel along x, end walls, ribs
    var A = B._arch(), a = new THREE.Mesh(A.arch, M._mat(col)); a.scale.set(len, h * 2, w); g.add(a);
    for (var i = -2; i <= 2; i++) { var rb = new THREE.Mesh(A.arch, M._mat(dk)); rb.scale.set(0.08, h * 2 + 0.03, w + 0.03); rb.position.x = i * len / 5; g.add(rb); }
    [-1, 1].forEach(function (e) { var en = new THREE.Mesh(A.end, M._mat(e > 0 ? col : dk)); en.scale.set(1, h * 2, w); en.position.x = e * len / 2; if (e < 0) en.rotation.y = PI; g.add(en); });
  }
  function woodHut(g, len, w, h, roof) { // IJN: a wooden barracks with a low pitched roof
    M._box(g, C.wood, len, h * 0.62, w, 0, 0, 0);
    var r1 = M._bar(g, roof, len + 0.3, 0.12, w * 0.62, 0, h * 0.62, -w * 0.24); r1.rotation.x = -0.42;   // each slab rises to the ridge
    var r2 = M._bar(g, roof, len + 0.3, 0.12, w * 0.62, 0, h * 0.62, w * 0.24); r2.rotation.x = 0.42;
    for (var i = -2; i <= 2; i++) M._bar(g, C.win, 0.42, 0.26, w + 0.04, i * len / 5.5, h * 0.3, 0);
  }
  function door(g, x, w, h) { M._bar(g, C.door, 0.06, h, w, x, 0, 0); }
  function sandbags(g, len, x, z, yaw, h) { // a short wall of sandbags (two courses)
    var n = Math.max(2, Math.round(len / 0.42));
    for (var k = 0; k < 2; k++) for (var i = 0; i < n; i++) {
      var t = (i + (k ? 0.5 : 0)) / n - 0.5; if (k && i === n - 1) continue;
      var b = M._box(g, k ? C.sand : C.sandDk, 0.4, h / 2, 0.3, x + Math.cos(yaw) * t * len, k * h / 2, z + Math.sin(yaw) * t * len); b.rotation.y = -yaw;
    }
  }
  function lattice(g, x, z, h) { // a radio mast: three legs and cross braces, tapering
    for (var i = 0; i < 3; i++) { var a = i / 3 * PI * 2, l = M._bar(g, C.steel, 0.07, h, 0.07, x + Math.cos(a) * 0.22, 0, z + Math.sin(a) * 0.22); l.rotation.set(Math.sin(a) * 0.025, 0, -Math.cos(a) * 0.025); }
    for (var y = 0.8; y < h - 0.3; y += 1.1) M._bar(g, C.steel, 0.38 * (1 - y / h * 0.6), 0.05, 0.38 * (1 - y / h * 0.6), x, y, z);
    M._bar(g, C.red, 0.12, 0.12, 0.12, x, h, z);
  }
  function bomb(g, usn, x, y) { // a bomb lying across the dump (along z): body, nose, fuze band, tail fins
    var col = usn ? C.bombU : C.bombI, b = M._xc(g, col, 0.13, 0.7, x, y, 0); b.rotation.y = PI / 2;
    M._sph(g, col, 0.26, 0.26, 0.3, x, y, 0.35);
    var bd = M._xc(g, usn ? C.yellow : C.red, 0.135, 0.05, x, y, 0.22); bd.rotation.y = PI / 2;
    M._bar(g, col, 0.04, 0.3, 0.2, x, y - 0.15, -0.42); M._bar(g, col, 0.3, 0.04, 0.2, x, y - 0.02, -0.42);
  }
  function tpl(kind, nat) {
    var k = kind + nat; if (TPL[k] !== undefined) return TPL[k];
    var g = new THREE.Group(), usn = nat !== 'IJN';
    switch (kind) {
      case 'hut': case 'sick':
        if (usn) { quonset(g, 4.2, 2.0, 1.15, C.quon, C.quonDk); door(g, 2.11, 0.55, 0.8); M._bar(g, C.win, 0.06, 0.3, 0.3, 2.11, 0.5, 0.65); M._bar(g, C.win, 0.06, 0.3, 0.3, 2.11, 0.5, -0.65); }
        else { woodHut(g, 4.2, 2.0, 1.3, C.roofI); door(g, 2.12, 0.55, 0.7); }
        if (kind === 'sick') { M._bar(g, C.white, 1.0, 0.04, 1.0, 0, usn ? 1.15 : 1.1, 0); M._bar(g, C.red, 0.8, 0.06, 0.24, 0, usn ? 1.15 : 1.1, 0); M._bar(g, C.red, 0.24, 0.06, 0.8, 0, usn ? 1.15 : 1.1, 0); }
        break;
      case 'tent': case 'tentL': // a pyramidal tent with a door flap
        var t = M._cyl(g, usn ? C.tentU : C.tentI, 0.78, 0.35, 0, 0, 0); t.scale.set(1.56, 0.35, 1.56);
        var tp = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.8, 4, 1).translate(0, 0.4, 0).rotateY(PI / 4), M._mat(usn ? C.tentU : C.tentI)); tp.position.y = 0.35; tp.scale.set(1.35, 1, 1.35); g.add(tp);
        M._bar(g, C.door, 0.05, 0.42, 0.36, 0.79, 0, 0); M._bar(g, C.pole, 0.04, 0.25, 0.04, 0, 1.12, 0);
        break;
      case 'mess':
        if (usn) { quonset(g, 6.0, 2.8, 1.5, C.quon, C.quonDk); door(g, 3.01, 0.8, 1.0); }
        else { woodHut(g, 6.0, 2.8, 1.8, C.roofI); door(g, 3.02, 0.8, 0.95); }
        M._cyl(g, C.steel, 0.12, 0.9, -1.6, usn ? 1.25 : 1.4, 0.6); M._cyl(g, C.dirtDk, 0.14, 0.08, -1.6, usn ? 2.12 : 2.27, 0.6);
        M._bar(g, C.cream, 0.05, 0.4, 1.4, 3.03, 1.05, 0);   // the mess sign over the door
        break;
      case 'radio':
        M._box(g, usn ? C.cream : C.wood, 2.0, 1.0, 1.5, 0, 0, 0); M._bar(g, usn ? C.quonDk : C.roofI, 2.2, 0.14, 1.7, 0, 1.0, 0);
        door(g, 1.01, 0.45, 0.75); M._bar(g, C.win, 0.5, 0.3, 1.52, -0.4, 0.5, 0);
        lattice(g, -3.4, 0, 8.4); lattice(g, 3.4, 0, 8.4);
        M._bar(g, C.tyre, 6.8, 0.03, 0.03, 0, 8.25, 0);                                     // the aerial between the masts
        var lead = M._bar(g, C.tyre, 0.03, 7.2, 0.03, 0.6, 1.05, 0); lead.rotation.z = -0.06;  // the lead-in down to the shack
        break;
      case 'water':
        for (var i = 0; i < 4; i++) { var a = i / 4 * PI * 2 + PI / 4, lg = M._bar(g, C.steel, 0.12, 4.5, 0.12, Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82); lg.rotation.set(-Math.sin(a) * 0.05, 0, Math.cos(a) * 0.05); }
        M._bar(g, C.steel, 1.7, 0.06, 0.06, 0, 2.2, 0); M._bar(g, C.steel, 0.06, 0.06, 1.7, 0, 2.2, 0);
        M._cyl(g, C.tank, 1.05, 1.5, 0, 4.4, 0); M._cyl(g, C.red, 1.06, 0.18, 0, 5.2, 0);
        var cn = new THREE.Mesh(new THREE.ConeGeometry(1.12, 0.5, 12).translate(0, 0.25, 0), M._mat(C.quonDk)); cn.position.y = 5.9; g.add(cn);
        break;
      case 'cp': // a sandbagged dugout: bag walls, a log-and-earth roof, a doorway on +x, a whip aerial
        sandbags(g, 3.0, 0, -1.2, 0, 0.7); sandbags(g, 3.0, 0, 1.2, 0, 0.7); sandbags(g, 2.2, -1.5, 0, PI / 2, 0.7);
        sandbags(g, 0.8, 1.5, 0.75, PI / 2, 0.7); sandbags(g, 0.8, 1.5, -0.75, PI / 2, 0.7);
        M._box(g, C.dirt, 3.3, 0.35, 2.8, 0, 0.7, 0); M._bar(g, C.sand, 2.4, 0.1, 2.0, -0.1, 1.05, 0);
        M._bar(g, C.steel, 0.04, 2.2, 0.04, -1.0, 1.05, 0.8);
        break;
      case 'flag':
        M._cyl(g, C.white, 0.42, 0.18, 0, 0, 0); M._bar(g, C.pole, 0.1, 6.6, 0.1, 0, 0, 0); M._bar(g, C.pole, 0.24, 0.24, 0.24, 0, 6.6, 0);
        break;
      case 'mg': // sandbag ring, open to the rear (+x is where the gun points at rest)
        for (var j = 0; j < 9; j++) { var aa = PI * 0.25 + j / 8 * PI * 1.5, sb = M._box(g, j % 2 ? C.sand : C.sandDk, 0.5, 0.55, 0.36, Math.cos(aa + PI) * 1.05, 0, Math.sin(aa + PI) * 1.05); sb.rotation.y = -(aa + PI) + PI / 2; }
        M._disc(g, C.dirt, 0.95, 0.04, 0, 0, 0);
        break;
      case 'mggun': // the gun on its pedestal: twin .50s (USN), a Type 93 13 mm twin (IJN); +x forward
        M._cyl(g, C.gun, 0.1, 0.55, 0, 0, 0); M._box(g, C.gun, 0.4, 0.22, 0.3, 0.05, 0.5, 0);
        M._xc(g, C.gun, 0.035, 1.0, 0.55, 0.66, 0.08); M._xc(g, C.gun, 0.035, 1.0, 0.55, 0.66, -0.08);
        M._bar(g, C.olive, 0.16, 0.2, 0.16, 0.08, 0.6, 0.0);
        break;
      case 'trench': // a zigzag of three bays: a dark floor, spoil heaped both sides, a few sandbags on the lips
        [[-2.0, 0.25, 1], [0, -0.25, -1], [2.0, 0.25, 1]].forEach(function (s) {
          var ry = -s[2] * 0.4, f = M._bar(g, C.dirtDk, 2.25, 0.04, 0.6, s[0], 0.06, s[1]); f.rotation.y = ry;
          [-1, 1].forEach(function (e) {
            var ox = Math.sin(-ry) * e * 0.5, oz = Math.cos(-ry) * e * 0.5;
            var sp = M._box(g, C.dirt, 2.2, 0.28, 0.36, s[0] - ox, 0.02, s[1] + oz); sp.rotation.y = ry;
            if (e > 0) sandbags(g, 1.4, s[0] - ox * 1.05, s[1] + oz * 1.05, -ry, 0.36);
          });
        });
        break;
      case 'drums': // two stacks of fuel drums
        for (var d = 0; d < 6; d++) M._cyl(g, d % 3 === 1 ? C.drumR : C.drumO, 0.2, 0.5, -0.6 + (d % 3) * 0.44, 0, d < 3 ? -0.25 : 0.25);
        for (d = 0; d < 3; d++) M._cyl(g, C.drumO, 0.2, 0.5, -0.38 + d * 0.44, 0.5, 0);
        break;
      case 'light': // a searchlight platform: a low sandbag ring; the lamp head is separate (it turns)
        for (var q = 0; q < 8; q++) { var qa = q / 8 * PI * 2, qb = M._box(g, C.sand, 0.4, 0.4, 0.3, Math.cos(qa) * 0.55, 0, Math.sin(qa) * 0.55); qb.rotation.y = -qa + PI / 2; }
        M._cyl(g, C.gun, 0.16, 0.5, 0, 0, 0);
        break;
      case 'lamp':
        M._bar(g, C.gun, 0.06, 0.45, 0.6, 0, 0, 0); var lb = M._xc(g, C.gun, 0.26, 0.55, 0.05, 0.42, 0); lb.scale.y = 0.52; lb.scale.z = 0.52;
        M._xc(g, C.glass, 0.24, 0.04, 0.33, 0.42, 0);
        break;
      case 'laundry':
        [-1.9, 1.9].forEach(function (x) { M._bar(g, C.pole, 0.07, 1.4, 0.07, x, 0, 0); M._bar(g, C.pole, 0.07, 0.07, 0.5, x, 1.36, 0); });
        M._bar(g, C.pole, 3.8, 0.02, 0.02, 0, 1.35, 0.18); M._bar(g, C.pole, 3.8, 0.02, 0.02, 0, 1.35, -0.18);
        for (var c = 0; c < 6; c++) M._bar(g, C.cloth[c % 5], 0.36, 0.42, 0.03, -1.5 + c * 0.6, 0.92, c % 2 ? 0.18 : -0.18);
        break;
      case 'table': M._box(g, C.crate, 0.6, 0.42, 0.6, 0, 0, 0); M._bar(g, C.white, 0.1, 0.01, 0.14, 0.1, 0.42, 0.05); M._bar(g, C.red, 0.1, 0.01, 0.14, -0.1, 0.42, -0.08); break;
      // ---- the flight line's clutter (base_life_layout.js KITS); every model inside its K half extents ----
      case 'bombs': // a bomb dump: two layers of bombs on dunnage inside a sandbag U, open toward +x (the trolleys)
        sandbags(g, 4.0, 0, -1.15, 0, 0.55); sandbags(g, 4.0, 0, 1.15, 0, 0.55); sandbags(g, 2.0, -2.05, 0, PI / 2, 0.55);
        M._bar(g, C.woodDk, 3.4, 0.08, 0.1, 0.1, 0, -0.38); M._bar(g, C.woodDk, 3.4, 0.08, 0.1, 0.1, 0, 0.38);
        for (var bi = 0; bi < 11; bi++) bomb(g, usn, bi < 6 ? -1.3 + bi * 0.5 : -1.05 + (bi - 6) * 0.5, bi < 6 ? 0.21 : 0.44);
        break;
      case 'drumrow': // fuel drums on their sides on two log rails, a second tier on top
        M._xc(g, C.woodDk, 0.07, 4.0, 0, 0.07, -0.42); M._xc(g, C.woodDk, 0.07, 4.0, 0, 0.07, 0.42);
        for (var di = 0; di < 15; di++) {
          var top = di >= 8, dx = top ? -1.5 + (di - 8) * 0.5 : -1.75 + di * 0.5, dc = usn ? (di % 5 === 2 ? C.drumR : C.drumO) : (di % 4 === 1 ? C.drumR : C.drumI);
          var dr = M._xc(g, dc, 0.21, 0.62, dx, top ? 0.56 : 0.21 + 0.14, 0); dr.rotation.y = PI / 2;
          var rim = M._xc(g, C.tyre, 0.215, 0.03, dx, top ? 0.56 : 0.35, 0.2); rim.rotation.y = PI / 2;
        }
        break;
      case 'crates': // a stack of supply crates and ammunition boxes
        M._box(g, C.crate, 0.95, 0.62, 0.75, -0.55, 0, -0.35); M._box(g, C.crateDk, 0.8, 0.55, 0.7, 0.45, 0, -0.38);
        M._box(g, C.crate, 0.85, 0.5, 0.65, -0.3, 0.62, -0.3); M._box(g, C.olive, 0.6, 0.35, 0.4, 0.6, 0, 0.4);
        M._box(g, C.olive, 0.6, 0.35, 0.4, 0.6, 0.35, 0.4); M._box(g, C.crateDk, 0.7, 0.45, 0.55, -0.55, 0, 0.45);
        M._bar(g, usn ? C.white : C.red, 0.3, 0.12, 0.01, -0.55, 0.25, -0.73);
        break;
      case 'mat':
        if (usn) { // Marston mat (pierced steel planking) in pallet stacks on skids, the holes' rows dark on top
          [-0.52, 0.52].forEach(function (z, i) {
            M._bar(g, C.woodDk, 2.3, 0.08, 0.1, 0, 0, z - 0.3); M._bar(g, C.woodDk, 2.3, 0.08, 0.1, 0, 0, z + 0.3);
            M._bar(g, i ? C.psp : C.pspDk, 2.4, 0.38 - i * 0.1, 0.85, i * 0.06, 0.08, z);
            for (var r = -1; r <= 1; r++) M._bar(g, C.pspDk, 2.2, 0.01, 0.06, i * 0.06, 0.46 - i * 0.1, z + r * 0.26);
          });
        } else { // IJN: a lumber pile (sawn planks and coconut logs) for the revetments and the huts
          M._bar(g, C.wood, 2.4, 0.3, 0.9, 0, 0, -0.5); M._bar(g, C.woodDk, 2.3, 0.04, 0.9, 0, 0.3, -0.5);
          for (var lg = 0; lg < 5; lg++) M._xc(g, lg % 2 ? C.woodDk : C.dirt, 0.15, 2.4, 0, lg < 3 ? 0.15 : 0.41, 0.25 + (lg < 3 ? lg : lg - 2.5) * 0.3);
        }
        break;
      case 'shop': // an open-sided maintenance tent: a canvas fly on poles over an engine on its stand, a hoist, a bench
        [[-2.3, -1.4], [2.3, -1.4], [-2.3, 1.4], [2.3, 1.4], [0, -1.4], [0, 1.4]].forEach(function (q) { M._bar(g, C.pole, 0.07, 1.5, 0.07, q[0], 0, q[1]); });
        var f1 = M._bar(g, usn ? C.canvas : C.canvasI, 4.9, 0.06, 1.75, 0, 1.47, -0.72); f1.rotation.x = -0.36;
        var f2 = M._bar(g, usn ? C.canvas : C.canvasI, 4.9, 0.06, 1.75, 0, 1.47, 0.72); f2.rotation.x = 0.36;
        M._bar(g, C.pole, 4.9, 0.08, 0.08, 0, 1.78, 0);
        M._box(g, C.gun, 0.55, 0.42, 0.55, 0.3, 0, 0); M._xc(g, C.steel, 0.3, 0.7, 0.3, 0.72, 0); M._cyl(g, C.gun, 0.33, 0.12, 0.65, 0.42, 0);
        [-1, 1].forEach(function (s) { var l = M._bar(g, C.steel, 0.06, 1.35, 0.06, 0.3, 0, s * 0.55); l.rotation.x = -s * 0.25; });
        M._bar(g, C.steel, 0.06, 0.06, 1.0, 0.3, 1.3, 0);
        M._box(g, C.wood, 1.3, 0.42, 0.4, -1.5, 0, -1.0); M._box(g, C.olive, 0.4, 0.3, 0.3, -1.6, 0.42, -1.0);
        var pr = M._bar(g, C.gun, 0.08, 1.3, 0.14, 1.7, 0.05, 0.95); pr.rotation.z = 0.12;   // a spare propeller blade
        M._box(g, C.crate, 0.5, 0.35, 0.4, -1.6, 0, 0.9);
        break;
      case 'ops': // the line shack: the operations hut, its sortie board and the windsock
        if (usn) { M._box(g, C.cream, 2.4, 0.95, 1.4, 0.3, 0, 0); M._bar(g, C.quonDk, 2.6, 0.1, 1.6, 0.3, 0.95, 0); M._bar(g, C.win, 2.0, 0.24, 1.42, 0.3, 0.5, 0); door(g, 1.51, 0.45, 0.75); }
        else { var sub = new THREE.Group(); sub.position.x = 0.3; g.add(sub); woodHut(sub, 2.4, 1.4, 1.5, C.roofI); door(g, 1.52, 0.45, 0.7); }
        M._bar(g, C.tyre, 0.9, 0.55, 0.05, -1.25, 0.45, 1.05); M._bar(g, C.pole, 0.06, 0.5, 0.06, -1.6, 0, 1.05); M._bar(g, C.pole, 0.06, 0.5, 0.06, -0.9, 0, 1.05);
        for (var ln = 0; ln < 4; ln++) M._bar(g, C.white, 0.6 - (ln % 2) * 0.2, 0.02, 0.01, -1.27, 0.55 + ln * 0.11, 1.08);
        M._bar(g, C.pole, 0.06, 2.6, 0.06, -1.7, 0, -1.0);
        for (var sk = 0; sk < 4; sk++) { var ws = M._xc(g, sk % 2 ? C.white : C.sock, 0.13 - sk * 0.022, 0.2, -1.6 + sk * 0.2, 2.5 - sk * 0.03, -1.0); ws.rotation.z = -0.15; }
        break;
      case 'truck': case 'jeep': return (TPL[k] = vehicle(kind, nat));
      case 'fire': return (TPL[k] = B.vehicle('crash', nat));
      default: TPL[k] = null; return null;
    }
    TPL[k] = B._bake(g); TPL[k].scale(CK(), CK(), CK()); TPL[k].computeBoundingSphere(); return TPL[k];   // drawn at true size
  }
  function CK() { return (WW.baseLifeLayout && WW.baseLifeLayout.CAMP_K) || 1; }   // the camp's true-size factor (base_life_layout.js)
  // ---- vehicles: nose +x, wheels on y = 0, ~2.4 long at x1 (drawn x VEH_K) ----
  function wheels(g, xs, w, r) { xs.forEach(function (x) { [-1, 1].forEach(function (s) { var t = M._cyl(g, C.tyre, r, 0.2, x, r, s * w + s * 0.1); t.rotation.x = PI / 2; t.position.y = r; }); }); }
  function vehicle(kind, nation) {
    var k = kind + (nation || 'USN'); if (VEH[k]) return VEH[k];
    init();
    var g = new THREE.Group(), body = nation === 'IJN' ? C.ijnV : C.olive;
    if (kind === 'truck') {          // a cargo truck: cab, a canvas tilt over the bed
      M._box(g, body, 0.75, 0.95, 1.05, 0.95, 0.3, 0); M._bar(g, C.win, 0.08, 0.32, 0.8, 1.33, 0.78, 0);
      M._bar(g, body, 1.6, 0.35, 1.08, -0.3, 0.32, 0); M._box(g, nation === 'IJN' ? C.canvasI : C.canvas, 1.55, 0.75, 1.02, -0.3, 0.62, 0);
      wheels(g, [0.9, -0.55, -0.95], 0.45, 0.26);
    } else if (kind === 'jeep') {    // an open jeep: a flat body, the windscreen, a spare wheel on the back
      M._box(g, body, 1.8, 0.42, 0.95, 0, 0.22, 0); M._bar(g, C.win, 0.05, 0.32, 0.85, 0.25, 0.62, 0); M._bar(g, body, 0.35, 0.18, 0.7, -0.35, 0.6, 0);
      var sp = M._cyl(g, C.tyre, 0.22, 0.14, -0.95, 0.5, 0); sp.rotation.z = PI / 2;
      wheels(g, [0.6, -0.6], 0.42, 0.22);
    } else if (kind === 'stretcher') { // two poles and a canvas bed (carried at hand height)
      M._bar(g, C.canvas, 1.5, 0.04, 0.42, 0, 0, 0); M._bar(g, C.pole, 2.0, 0.05, 0.05, 0, 0.02, 0.22); M._bar(g, C.pole, 2.0, 0.05, 0.05, 0, 0.02, -0.22);
    } else return null;
    VEH[k] = B._bake(g); return VEH[k];
  }
  function init() { if (!M) { M = WW.models; B = WW.baseModels; } }

  // ---- the camp on the map ----
  var WIN = { hut: [[2.12, 0.5, 0.65], [2.12, 0.5, -0.65], [-2.12, 0.5, 0]], sick: [[2.12, 0.5, 0.65], [2.12, 0.5, -0.65], [-2.12, 0.5, 0]],
    mess: [[3.03, 0.6, 0.9], [3.03, 0.6, -0.9], [-3.03, 0.6, 0.5], [-3.03, 0.6, -0.5]], radio: [[-0.4, 0.5, 0.77], [-0.4, 0.5, -0.77]], cp: [[1.55, 0.3, 0]], tent: [[0.8, 0.2, 0]], tentL: [[0.8, 0.2, 0]],
    ops: [[0.3, 0.5, 0.72], [0.3, 0.5, -0.72], [1.52, 0.5, 0.4]] };
  // the parked vehicles move (base_life_cars.js): one mesh each. Every other kind is drawn as ONE InstancedMesh per
  // kind (the camp and the flight line's clutter: ~200 items in ~20 draws); its part keeps an invisible mesh (the
  // footprint the paths, the trucks and tests/base_clip.js read; shown, scorched, when the item is wrecked)
  var MOVES = { truck: 1, jeep: 1, fire: 1 }, _sp = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function build(base, mat) {
    init();
    var S = base.site, parts = [], nat = base.nation, glowG = [], wg = new THREE.BoxGeometry(1, 1, 1), batch = {}, insts = [];
    var gy = function (x, z) { return Math.max(S.padH, -WW.terrain.depthAt(x, z)) - 0.05; };
    (base.decor || []).forEach(function (d) {
      var geo = tpl(d.kind, nat), y = gy(d.x, d.z), part = { f: d, mesh: null, gun: null, head: null, flag: null, decor: true, y: y };
      if (geo) {
        var m = new THREE.Mesh(geo, mat); m.position.set(d.x, y, d.z); m.rotation.y = -d.a;
        if (d.kind === 'truck' || d.kind === 'jeep' || d.kind === 'fire') m.scale.setScalar(B.VEH_K || 1);
        m.castShadow = d.kind !== 'trench'; m.receiveShadow = true; part.mesh = m;
        if (!MOVES[d.kind]) { m.visible = false; m.updateMatrix(); m.matrixAutoUpdate = false; (batch[d.kind] = batch[d.kind] || []).push(part); }
      }
      if (d.kind === 'mg') { var gn = new THREE.Mesh(tpl('mggun', nat), mat); gn.position.set(d.x, y + 0.02, d.z); gn.rotation.y = -d.a; gn.castShadow = true; part.gun = gn; }
      if (d.kind === 'light') { var hd = new THREE.Mesh(tpl('lamp', nat), mat); hd.position.set(d.x, y + 0.5 * CK(), d.z); hd.rotation.y = -d.a; part.head = hd; }
      if (d.kind === 'flag') { var fl = new THREE.Mesh(B._tpl().flag[nat], mat); fl.position.set(d.x, y + 5.3 * CK(), d.z); fl.scale.setScalar(CK()); part.flag = fl; }
      (WIN[d.kind] || []).forEach(function (w) { // lit windows: tiny boxes just proud of the walls
        var c = Math.cos(d.a), s = Math.sin(d.a), q = wg.clone(), ck = CK(); q.scale(0.04 * ck, 0.24 * ck, 0.26 * ck); q.rotateY(Math.abs(w[0]) < 1 ? PI / 2 : 0);
        q.rotateY(-d.a); q.translate(d.x + (c * w[0] - s * w[2]) * ck, y + (w[1] + 0.12) * ck, d.z + (s * w[0] + c * w[2]) * ck); glowG.push(q);
      });
      parts.push(part);
    });
    var glow = null;
    if (glowG.length) {
      var P = []; glowG.forEach(function (q) { var a = q.toNonIndexed().attributes.position; for (var i = 0; i < a.count; i++) P.push(a.getX(i), a.getY(i), a.getZ(i)); });
      var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      glow = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0xffc56a, toneMapped: false, fog: false })); glow.visible = false;
    }
    for (var k in batch) { // one InstancedMesh per kind; its own copy of the geometry, bounded round all its instances (culling)
      var L = batch[k], g0 = tpl(k, nat), geo = g0.clone(), c = new THREE.Vector3(), rad = 0;
      L.forEach(function (q) { c.add(q.mesh.position); }); c.multiplyScalar(1 / L.length);
      L.forEach(function (q) { rad = Math.max(rad, _sp.copy(q.mesh.position).sub(c).length()); });
      geo.boundingSphere = new THREE.Sphere(c, rad + g0.boundingSphere.center.length() + g0.boundingSphere.radius);
      var im = new THREE.InstancedMesh(geo, mat, L.length); im.castShadow = k !== 'trench'; im.receiveShadow = true;
      L.forEach(function (q, i) { im.setMatrixAt(i, q.mesh.matrix); q.inst = { im: im, i: i }; });
      im.instanceMatrix.needsUpdate = true; insts.push(im);
    }
    return { parts: parts, glow: glow, insts: insts };
  }
  // a hit item: burnt / flattened (huts and tents slump and blacken, the masts and the tower lean, a vehicle burns out)
  function wreck(part, scorch) {
    if (part.wrecked || !part.mesh) return;
    part.wrecked = true;
    var k = part.f.kind, m = part.mesh;
    m.material = scorch;
    if (part.inst) { part.inst.im.setMatrixAt(part.inst.i, ZERO); part.inst.im.instanceMatrix.needsUpdate = true; m.visible = true; m.matrixAutoUpdate = true; }   // its own mesh now
    if (k === 'tent' || k === 'tentL') m.scale.set(1.1, 0.25, 1.1);
    else if (k === 'hut' || k === 'sick' || k === 'mess' || k === 'cp' || k === 'ops' || k === 'shop') { m.scale.set(1, 0.45, 0.95); m.rotation.z = 0.05; }
    else if (k === 'radio' || k === 'water' || k === 'flag') { m.rotation.z = 0.35; m.rotation.x = 0.12; }
    else if (k === 'laundry' || k === 'table' || k === 'drums' || k === 'drumrow' || k === 'bombs' || k === 'crates' || k === 'mat') m.scale.set(1, 0.3, 1);
    if (part.gun) { part.gun.material = scorch; part.gun.rotation.z = -0.4; }
    if (part.head) part.head.material = scorch;
    if (part.flag) part.flag.visible = false;
  }
  WW.baseLifeModels = { build: build, wreck: wreck, vehicle: vehicle, tpl: function (k, n) { init(); return tpl(k, n); }, C: C };
})();
