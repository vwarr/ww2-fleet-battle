// normandy_villages.js - WW.normandyVillages: the villages, the beach villas and the roads behind Omaha in close-up
// (visual only; the layout from a fixed local PRNG, the same every seed; Math.random only for the smoke). Built by
// terrain_normandy_props.js build(), its smoke ticked from its update().
// History: the villages were boxes with pyramid roofs around a church (terrain_normandy_props.js village()). Now:
//  - Norman stone farmhouses: long, steep-gabled, a chimney on each gable, dark windows with grey shutters, in creamy
//    grey Caen stone or darker schist under slate or (now and then) weathered tile; one InstancedMesh per variant for
//    every village (a handful of draw calls), the stone's shade varied per house (instance colour)
//  - the bombardment's damage, more the nearer the house stands to a strongpoint (the navy shelled the WN and what
//    stood near them): a roof holed through to the rafters, a burnt-out shell (gables and soot-blackened walls, no
//    roof, charred beams; some still smoking: SMOKERS), a heap of rubble round a corner of wall
//  - the villas along the shelf at Hamel-au-Prêtre and Les Moulins (summer houses behind the promenade): the Germans
//    pulled most of them down to clear their fields of fire, so mostly rubble and gutted shells, a few still roofed;
//    none on a draw's floor or on a strongpoint
//  - the churches: nave, square tower and a slender stone spire; Vierville's tallest (the landmark the naval gunners
//    laid on, the spire they later shot down as an observation post)
//  - the roads: the promenade along the shelf behind the sea wall from Vierville to Les Moulins, the road up the D-1
//    draw to Vierville and up D-3 to St-Laurent, a track up E-1; laid 3-4 u off each draw's centre line so the draw
//    mouths' obstacles (sim objects, another module) stand clear of them
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const C = { stone: 0xb3aa98, stoneD: 0x9a9283, schist: 0x857f74, slate: 0x575e65, tile: 0x8a6253, soot: 0x4a4540, char: 0x2b2724,
    win: 0x26282a, shutter: 0x66706c, door: 0x4b4036, road: 0x7e776b, track: 0x8a7f6a, beam: 0x3a3029 };
  const SMOKERS = 14;
  let G = null, smokers = [], lastRt = 0;
  const NT = () => WW.normandyTerrain;
  function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const gy = (x, z) => Math.max(0, WW.terrain.heightRaw(x, z));

  // ---- the house kit: a unit house (x: its length -0.5..0.5, z: its depth -0.5..0.5, the walls 0..1 high, the gable
  // to 1.75), merged by hand into one vertex-coloured geometry per variant (models_soldier.js part / merge) ----
  function prism() {   // a unit gable: x -0.5..0.5, the base z -0.5..0.5 at y 0, the ridge at y 1
    const v = [], P = [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [0.5, 0, -0.5], [0.5, 0, 0.5], [0.5, 1, 0]];
    const f = (a, b, c) => v.push(...P[a], ...P[b], ...P[c]);
    f(0, 1, 2); f(3, 5, 4); f(0, 2, 5); f(0, 5, 3); f(1, 4, 5); f(1, 5, 2); f(0, 3, 4); f(0, 4, 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
  }
  function kit() {
    const K = WW.soldierModel, { box } = K.prims(), pr = prism(), P = (g, c, s, p, r) => K.part(g, c, s, p, r);
    const RA = Math.atan2(0.56, 0.75), RL = Math.hypot(0.56, 0.75) + 0.04;   // the roof slabs' pitch and length (eave to ridge)
    const gables = (b, col) => { for (const x of [-0.47, 0.47]) b.push(P(pr, col, [0.06, 0.75, 1], [x, 1, 0])); };
    const windows = (b, sh, deep) => {   // two floors of windows on the long sides, grey shutters; a door on the front
      for (const z of [0.5, -0.5]) for (const x of [-0.3, 0, 0.3]) for (const y of [0.3, 0.68]) {
        if (z > 0 && y < 0.5 && x === 0) { b.push(P(box, C.door, [0.1, 0.36, deep], [x, 0.18, z])); continue; }
        b.push(P(box, C.win, [0.09, 0.15, deep], [x, y, z]));
        if (sh) for (const s of [-1, 1]) b.push(P(box, C.shutter, [0.045, 0.16, deep * 0.6], [x + s * 0.07, y, z]));
      }
    };
    const roof = (b, col, holed) => {
      b.push(P(pr, C.char, [0.94, 0.72, 0.96], [0, 1, 0]));            // the loft, dark (seen through a hole)
      for (const s of [1, -1]) {
        const cz = s * 0.28, cy = 1.375, rx = s * (Math.PI / 2 - RA);
        if (holed && s < 0) {   // the shell went through (the seaward side): the slates gone over a stretch, the rafters bare
          b.push(P(box, col, [1.08, 0.05, RL * 0.38], [0, cy - 0.21, cz + s * 0.155], [rx, 0, 0]));
          b.push(P(box, col, [1.08, 0.05, RL * 0.2], [0, cy + 0.27, cz - s * 0.2], [rx, 0, 0]));
          b.push(P(box, col, [0.4, 0.05, RL * 0.5], [-0.34, cy, cz], [rx, 0, 0]));
          for (const x of [-0.05, 0.12, 0.28]) b.push(P(box, C.beam, [0.03, 0.04, RL * 0.6], [x, cy + 0.01, cz], [rx, 0, 0.0]));
        } else b.push(P(box, col, [1.08, 0.05, RL], [0, cy, cz], [rx, 0, 0]));
      }
      for (const x of [-0.44, 0.44]) b.push(P(box, C.stoneD, [0.1, 0.5, 0.15], [x, 1.62, 0.04]));   // a chimney on each gable
    };
    const house = (wall, roofC, holed) => { const b = [P(box, wall, [1, 1, 1], [0, 0.5, 0])]; gables(b, wall); windows(b, true, 0.02); roof(b, roofC, holed); return K.merge(b); };
    G = {
      house: house(C.stone, C.slate), houseT: house(C.stone, C.tile), houseD: house(C.schist, C.slate),
      holed: house(C.stone, C.slate, true), holedT: house(C.schist, C.tile, true)
    };
    {   // the burnt-out shell: four walls blackened at the top, gables standing (one half down), no roof, charred beams
      const b = [], t = 0.07;
      b.push(P(box, C.stone, [1, 0.78, t], [0, 0.39, 0.465])); b.push(P(box, C.stone, [1, 0.78, t], [0, 0.39, -0.465]));
      b.push(P(box, C.stone, [t, 0.78, 1], [0.465, 0.39, 0])); b.push(P(box, C.stone, [t, 0.78, 1], [-0.465, 0.39, 0]));
      for (const z of [0.465, -0.465]) b.push(P(box, C.soot, [1.01, 0.12, t + 0.01], [0, 0.72, z]));
      for (const x of [0.465, -0.465]) b.push(P(box, C.soot, [t + 0.01, 0.12, 1.01], [x, 0.72, 0]));
      b.push(P(pr, C.stoneD, [t, 0.6, 1], [-0.465, 1, 0]));                                         // a gable standing,
      b.push(P(pr, C.soot, [t + 0.01, 0.2, 0.33], [-0.465, 1.4, 0]));                               // smoke-blackened at its top
      b.push(P(box, C.stoneD, [t, 0.16, 0.5], [0.465, 1.06, -0.24], [0.3, 0, 0]));                  // the other one a broken stump
      b.push(P(box, C.char, [0.92, 0.04, 0.92], [0, 0.03, 0]));                                      // the burnt floor
      for (const [x, r] of [[-0.2, 0.5], [0.15, -0.35], [0.3, 0.8]]) b.push(P(box, C.beam, [0.05, 0.05, 0.95], [x, 0.35 + r * 0.2, 0], [r, 0.2 * r, 0]));
      for (const z of [0.465, -0.465]) for (const x of [-0.3, 0, 0.3]) for (const y of [0.3, 0.66]) b.push(P(box, C.win, [0.09, 0.15, t + 0.02], [x, y, z]));
      for (let k = 0; k < 5; k++) b.push(P(box, k & 1 ? C.stoneD : C.soot, [0.16, 0.08, 0.14], [-0.3 + k * 0.16, 0.06, 0.25 - (k % 3) * 0.2], [0, k, 0.3]));
      G.shell = K.merge(b);
    }
    {   // rubble: a heap of stone, slates and beams round the stump of a corner
      const r = prng(1906), b = [];
      for (let k = 0; k < 16; k++) {
        const a = r() * 6.28, d = Math.sqrt(r()) * 0.45, s = 0.12 + r() * 0.2, c = [C.stoneD, C.schist, C.stone, C.slate, C.soot, C.beam][k % 6];
        b.push(P(box, c, [s * (1 + r()), s * 0.6, s], [Math.cos(a) * d, s * 0.25 + (0.45 - d) * 0.35, Math.sin(a) * d], [r() * 0.8, r() * 3, r() * 0.8]));
      }
      b.push(P(box, C.stone, [0.5, 0.42, 0.07], [-0.24, 0.21, -0.46])); b.push(P(box, C.stone, [0.07, 0.3, 0.38], [-0.47, 0.15, -0.28]));
      b.push(P(box, C.soot, [0.5, 0.05, 0.075], [-0.24, 0.43, -0.46]));
      G.rubble = K.merge(b);
    }
    {   // a church: the nave, the square tower at its west end, a slender octagonal spire
      const b = [];
      b.push(P(box, C.stoneD, [1, 0.5, 0.42], [0.15, 0.25, 0])); b.push(P(pr, C.stoneD, [1, 0.3, 0.42], [0.15, 0.5, 0]));
      for (const s of [1, -1]) b.push(P(box, C.slate, [1.04, 0.025, 0.38], [0.15, 0.65, s * 0.105], [s * 0.96, 0, 0]));
      b.push(P(box, C.stoneD, [0.3, 1.0, 0.3], [-0.5, 0.5, 0])); b.push(P(box, C.stone, [0.32, 0.05, 0.32], [-0.5, 1.0, 0]));
      for (const z of [0.151, -0.151]) b.push(P(box, C.win, [0.05, 0.12, 0.01], [-0.5, 0.82, z]));
      const sp = new THREE.CylinderGeometry(0.0, 0.17, 1.15, 8); sp.translate(0, 0.575, 0);
      b.push(P(sp, 0x6f7276, [1, 1, 1], [-0.5, 1.02, 0]));
      b.push(P(box, C.beam, [0.012, 0.12, 0.012], [-0.5, 2.22, 0])); b.push(P(box, C.beam, [0.05, 0.012, 0.012], [-0.5, 2.24, 0]));
      G.church = K.merge(b);
    }
  }

  // ---- where the houses stand ----
  // the damage: near a strongpoint (and on the shelf) the bombardment and the Germans' demolitions left little whole
  function wnDist(x, z) {
    const D = WW.defenceData, T = NT(); if (!D) return 999;
    let best = 999;
    for (const w of D.WN) for (const e of w.els) { const ex = w.x + e.dx, ez = e.at === 'top' ? T.bluffTopZ(ex) + 2 + (e.du || 0) : T.bluffFootZ(ex); best = Math.min(best, Math.hypot(x - ex, z - ez)); }
    return best;
  }
  const VAR = ['house', 'houseT', 'houseD', 'holed', 'holedT', 'shell', 'rubble'];
  function pick(r, dmg) {
    const u = r();
    if (u < dmg * 0.3) return 'rubble';
    if (u < dmg * 0.6) return 'shell';
    if (u < dmg) return r() < 0.6 ? 'holed' : 'holedT';
    const v = r(); return v < 0.55 ? 'house' : v < 0.8 ? 'houseD' : 'houseT';
  }
  function village(v, r, add) {
    const T = NT(), zt = T.bluffTopZ(v.x), cz = zt + v.u, n = Math.round(v.r * 0.9), coastal = v.u < 90 && v.x > 1300 && v.x < 2000;
    let k = 0;
    for (let i = 0; i < n * 4 && k < n; i++) {
      // houses along two crossing streets, their long sides to the street; now and then a farm's second range across
      const along = (r() - 0.5) * v.r * 2, side = (r() < 0.5 ? -1 : 1) * (2.2 + r() * 1.5), street = r() < 0.6 ? 0 : 1;
      const x = v.x + (street ? side : along), z = cz + (street ? along * 0.8 : side);
      if (T.station(x).drawK > 0.3) continue;   // the draw's floor and the road up it: clear
      const w = 1.7 + r() * 1.5, d = 1.0 + r() * 0.35, h = 0.8 + r() * 0.35, a = (street ? Math.PI / 2 : 0) + (r() < 0.2 ? Math.PI / 2 : 0) + (r() - 0.5) * 0.12;
      const dmg = coastal ? Math.min(0.75, 0.18 + 0.6 * Math.exp(-wnDist(x, z) / 55)) : 0.06;
      add(pick(r, dmg), x, z, a, w, h, d, r);
      k++;
    }
    if (v.church) { const big = /Vierville/.test(v.name), s = big ? 3.2 : 2.8; add('church', v.x + 3, cz + 2, 0, s, s * (big ? 1.18 : 1), s, r); }
  }
  // the villas along the shelf behind the promenade, Vierville to Les Moulins
  function villas(r, add) {
    const T = NT(), D = WW.defenceData;
    for (let x = 1352; x < 1606; x += 5 + r() * 4) {
      const st = T.station(x); if (st.drawK > 0.25 || st.shelf < 6) continue;
      if (D && D.WN.some(w => w.els.some(e => e.at !== 'top' && Math.abs(w.x + e.dx - x) < 5))) continue;   // a strongpoint stands there
      const z = st.zs + st.sand + 3 + Math.min(st.shelf - 2.5, 5.2 + r() * 2), u = r();
      const kind = u < 0.4 ? 'rubble' : u < 0.7 ? 'shell' : u < 0.88 ? (r() < 0.5 ? 'holed' : 'holedT') : 'houseT';
      add(kind, x, z, (r() - 0.5) * 0.2, 1.6 + r() * 0.8, kind === 'rubble' ? 1.3 : 1.15 + r() * 0.3, 1.2 + r() * 0.3, r);
    }
  }

  // ---- the roads: ribbons laid on the ground ----
  function ribbon(pts, w, col) {
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
      for (const s of [-1, 1]) { const vx = x + nx * s, vz = z + nz * s; pos.push(vx, gy(vx, vz) + 0.05, vz); }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: WW.pastel(col, 0.06), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; m.renderOrder = 0; m.name = 'road';
    return m;
  }
  function roads(g) {
    const T = NT(), Dr = id => WW.normandyData.DRAWS.find(d => d.id === id), V = n => WW.normandyData.VILLAGES.find(v => v.name === n);
    const prom = [];   // the promenade: just inland of the sea wall
    for (let x = 1340; x <= 1612; x += 2) { const st = T.station(x); prom.push([x, st.zs + st.sand + 3 + 1.6]); }
    g.add(ribbon(prom, 0.9, C.road));
    // up a draw: off its centre line, from the promenade (or the shelf) up the valley floor, then across the fields to
    // the village (an S-bend where it climbs out)
    const up = (dr, off, vil, w, col) => {
      const T0 = T, x0 = dr.x + off, z0 = T0.bluffFootZ(x0) - 4, zt = T0.bluffTopZ(x0) + 12, v = vil, vz = T0.bluffTopZ(v.x) + v.u, P = [];
      for (let z = z0; z <= zt; z += 1.5) P.push([x0 + Math.sin((z - z0) / 9) * 0.6, z]);
      const [lx, lz] = P[P.length - 1];
      for (let t = 0.05; t <= 1.001; t += 0.05) { const e = t * t * (3 - 2 * t); P.push([lx + (v.x - lx) * e, lz + (vz - lz) * t]); }
      g.add(ribbon(P, w, col));
    };
    up(Dr('D-1'), 3.6, V('Vierville-sur-Mer'), 0.9, C.road);
    up(Dr('D-3'), 4.2, V('Saint-Laurent-sur-Mer'), 0.9, C.road);
    up(Dr('E-1'), -3.8, V('Saint-Laurent-sur-Mer'), 0.6, C.track);
  }

  function build(g) {
    if (!G) kit();
    const r = prng(1944606), list = {}; VAR.concat(['church']).forEach(k => { list[k] = []; });
    smokers = [];
    const add = (kind, x, z, a, w, h, d, rr) => list[kind].push({ x, z, a, w, h, d, k: 0.86 + rr() * 0.18 });
    WW.normandyData.VILLAGES.forEach(v => village(v, r, add));
    villas(r, add);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    for (const kind in list) {
      const L = list[kind]; if (!L.length) continue;
      const im = new THREE.InstancedMesh(G[kind], mat, L.length);
      L.forEach((o, i) => {
        // sunk a little into the slope on its low side; its stone's shade
        const y = Math.min(gy(o.x - o.w / 2, o.z), gy(o.x + o.w / 2, o.z), gy(o.x, o.z - o.d / 2), gy(o.x, o.z + o.d / 2)) - 0.04;
        e.set(0, o.a, 0); q.setFromEuler(e);
        im.setMatrixAt(i, m.compose(p.set(o.x, y, o.z), q, s.set(o.w, o.h, o.d)));
        im.setColorAt(i, c.setRGB(o.k, o.k * 0.99, o.k * 0.97));
        if (kind === 'shell' && smokers.length < SMOKERS && (i % 2 === 0)) smokers.push({ x: o.x, y: y + o.h * 0.6, z: o.z, s: 0.6 + Math.min(o.w, 3) * 0.25 });
      });
      im.castShadow = true; im.receiveShadow = true; im.name = 'houses:' + kind;
      g.add(im);
    }
    roads(g);
  }
  // the gutted houses still smoking from the morning's shelling (a slow dark plume, a puff every couple of seconds)
  function update(rdt) {
    if (!WW.fx || !WW.fx.smoke || !smokers.length) return;
    const rt = WW.game ? WW.game.roundTime : 0, dts = Math.max(0, Math.min(0.5, rt - lastRt)); lastRt = rt;
    if (rt <= 0) return;
    for (const o of smokers) if (Math.random() < dts * 0.45) WW.fx.smoke(o.x + (Math.random() - 0.5) * 0.6, o.y, o.z + (Math.random() - 0.5) * 0.6, Math.random() < 0.7, o.s);
  }
  WW.on('roundStart', () => { lastRt = 0; });
  WW.normandyVillages = { build, update, get smokers() { return smokers; } };
})(window.WW);
