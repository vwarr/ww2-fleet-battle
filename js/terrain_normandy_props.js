// terrain_normandy_props.js - WW.normandyProps: the Normandy coast's props (visual only; Math.random is fine but the
// layout is fixed: a local PRNG so the same villages stand on every seed). terrain.js buildProps calls build(group).
//  - villages: stone houses with slate or tile roofs around a church with a spire (Vierville, St-Laurent, Colleville...)
//  - hedgerows (the bocage behind the coast): bush rows along the field edges of the plateau
//  - the beach obstacles (terrain_normandy.js obstacles, sim data): hedgehogs, Belgian gates, stakes and log ramps with
//    Teller mines; instanced, each hidden once the sim marks it destroyed (update)
//  - the scrub on the bluffs (gorse, bramble, bracken) and marram on the shelf
//  - the sea wall from Vierville to Les Moulins
// Performance: the hedgerows (~100,000 bushes) and the scrub were single InstancedMeshes, drawn whole (and again into
// the shadow map) every frame: 5-6 M triangles a pass. Now they are cut into CHUNK u tiles (chunked()), each tile an
// InstancedMesh with its own bounds, so the camera's and the shadow map's frustums drop the tiles out of view, and a
// tile beyond LO_D from the camera draws a low-poly bush (lods, swapped in update()).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  let shared = null, obstMeshes = null, lastAlive = -1, lods = [];
  const CHUNK = 120, LO_D = 200;
  const D = () => WW.normandyData, NT = () => WW.normandyTerrain;
  function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const gy = (x, z) => Math.max(0, WW.terrain.heightRaw(x, z));
  const soft = hex => WW.pastel(hex, 0.1);

  function initShared() {
    const lam = c => new THREE.MeshLambertMaterial({ color: soft(c) });
    shared = {
      house: new THREE.BoxGeometry(1, 1, 1), roof: (() => { const g = new THREE.CylinderGeometry(0, 0.75, 0.6, 4, 1); g.rotateY(Math.PI / 4); g.scale(1.42, 1, 1); return g; })(),
      tower: new THREE.BoxGeometry(1, 1, 1), spire: new THREE.ConeGeometry(0.6, 2.4, 6),
      bush: new THREE.SphereGeometry(1, 7, 5), bushLo: new THREE.IcosahedronGeometry(1, 0), wall: new THREE.BoxGeometry(1, 1, 1),
      // obstacles at about 2x true size, as the sailors (models_crew.js): a hedgehog's 2 m beams 0.45 u, a 3 m stake 0.6 u
      beam: new THREE.BoxGeometry(0.45, 0.05, 0.05), pole: new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5), mine: new THREE.CylinderGeometry(0.08, 0.08, 0.035, 8),
      gate: new THREE.BoxGeometry(0.1, 0.1, 0.1),
      stone: lam(0xd8ccb4), stoneD: lam(0xbfb39a), slate: lam(0x6f7b86), tile: lam(0xb9775f), hedge: lam(0x52633c), concrete: lam(0xc8c4b8),
      steel: lam(0x6b625a), wood: lam(0x8a6e52), mineM: lam(0x5d6150)
    };
    shared.bush.scale(1, 0.62, 1); shared.bushLo.scale(1, 0.62, 1);
  }

  // ---- villages ----
  function village(g, v, r) {
    const T = NT(), zt = T.bluffTopZ(v.x), cz = zt + v.u, n = Math.round(v.r * 0.9);
    const houses = new THREE.InstancedMesh(shared.house, shared.stone, n), roofs = new THREE.InstancedMesh(shared.roof, r() < 0.5 ? shared.slate : shared.tile, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n * 4 && k < n; i++) {
      // houses along two crossing streets
      const along = (r() - 0.5) * v.r * 2, side = (r() < 0.5 ? -1 : 1) * (2.2 + r() * 1.5), street = r() < 0.6 ? 0 : 1;
      const x = v.x + (street ? side : along), z = cz + (street ? along * 0.8 : side);
      if (T.drawK && T.station(x).drawK > 0.5) continue;
      const w = 1.6 + r() * 1.4, d = 1.2 + r() * 0.6, h = 0.9 + r() * 0.5, a = (street ? Math.PI / 2 : 0) + (r() - 0.5) * 0.15, y = gy(x, z);
      e.set(0, a, 0); q.setFromEuler(e);
      houses.setMatrixAt(k, m.compose(p.set(x, y + h / 2 - 0.05, z), q, s.set(w, h, d)));
      roofs.setMatrixAt(k, m.compose(p.set(x, y + h + 0.28, z), q, s.set(w * 0.72, 1, d * 1.0)));
      k++;
    }
    houses.count = roofs.count = k;
    houses.castShadow = roofs.castShadow = true; houses.receiveShadow = true;
    g.add(houses, roofs);
    if (v.church) { // the church: a nave and a tower with a stone spire
      const x = v.x + 3, z = cz + 2, y = gy(x, z);
      const nave = new THREE.Mesh(shared.house, shared.stoneD); nave.scale.set(4.2, 1.6, 1.8); nave.position.set(x - 2.6, y + 0.75, z);
      const tw = new THREE.Mesh(shared.tower, shared.stoneD); tw.scale.set(1.3, 3, 1.3); tw.position.set(x, y + 1.45, z);
      const sp = new THREE.Mesh(shared.spire, shared.slate); sp.position.set(x, y + 4.1, z);
      [nave, tw, sp].forEach(o => { o.castShadow = true; g.add(o); });
    }
  }

  // ---- hedgerows: bush rows on the edges of the plateau's fields (the same rotated grid as the field colours) ----
  function hedgerows(g, r) {
    const T = NT(), pts = [];
    const W = WW.cfg.MAP_W;
    for (let fx = -20; fx < W / 46 + 20; fx++) for (let fz = 25; fz < 75; fz++) {
      // field corner in the rotated grid -> world (inverse of terrain_normandy.js color's rotation, approximately)
      const gx = fx * 46, gz = fz * 34, x = (gx * 0.98 - gz * 0.2) / 1.0004 + (r() - 0.5) * 8, z = (gz * 0.98 + gx * 0.2) / 1.0004 + (r() - 0.5) * 6;
      if (x < -700 || x > W + 700 || z > WW.cfg.MAP_H + 900) continue;
      for (const [dx, dz, len] of [[0.98, 0.2, 46], [-0.2, 0.98, 34]]) {
        if (r() < 0.35) continue;                           // a gap: a gate or a lane
        const bend = (r() - 0.5) * 0.25;                    // hedges wander a little
        for (let t = 0; t < len; t += 1.4) {
          const px = x + (dx - dz * bend) * t, pz = z + (dz + dx * bend) * t;
          if (pz < T.bluffTopZ(px) + 8 || T.station(px).drawK > 0.4) continue;   // only on the plateau, clear of the draws
          pts.push(px + (r() - 0.5) * 0.4, pz + (r() - 0.5) * 0.4, 0.45 + r() * 0.35);
        }
      }
    }
    const n = pts.length / 3, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    chunked(g, shared.bush, shared.bushLo, shared.hedge, n, i => pts[i * 3], i => pts[i * 3 + 1], (i, x, z) => { const k = pts[i * 3 + 2]; return m.compose(p.set(x, gy(x, z) + 0.3 * k, z), q, s.set(k * 1.1, k * 1.3, k * 1.1)); }, 1.6);
  }
  // n instances (position xOf(i), zOf(i), matrix mOf(i, x, z)) cut into CHUNK u tiles: an InstancedMesh per tile, its
  // geometry a view of the shared one with the tile's own bounding sphere (three culls an InstancedMesh by its
  // geometry's bounds), the low-poly geometry (lo) swapped in beyond LO_D; pad: the largest instance's reach
  function chunked(g, hi, lo, mat, n, xOf, zOf, mOf, pad) {
    const tiles = new Map();
    for (let i = 0; i < n; i++) { const key = Math.floor(xOf(i) / CHUNK) * 100000 + Math.floor(zOf(i) / CHUNK); if (!tiles.has(key)) tiles.set(key, []); tiles.get(key).push(i); }
    const view = (geo, sph) => { const v = new THREE.BufferGeometry(); for (const k in geo.attributes) v.setAttribute(k, geo.attributes[k]); if (geo.index) v.setIndex(geo.index); v.boundingSphere = sph; return v; };
    for (const L of tiles.values()) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      const im = new THREE.InstancedMesh(hi, mat, L.length);
      L.forEach((i, k) => { const x = xOf(i), z = zOf(i), M = mOf(i, x, z), y = M.elements[13]; im.setMatrixAt(k, M); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
      const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), sph = new THREE.Sphere(c, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + pad);
      const rec = { im, hiG: view(hi, sph), loG: lo ? view(lo, sph) : null, c, r: sph.radius, lo: false };
      im.geometry = rec.hiG; im.frustumCulled = true; im.castShadow = true; im.receiveShadow = true; im.name = 'chunk';   // (this three's InstancedMesh is not culled by default)
      g.add(im); if (lo) lods.push(rec);
    }
  }
  // the tiles' detail by their distance from the camera (per frame: a few hundred distance checks)
  function lodUpdate() {
    const cam = WW.camera; if (!cam || !lods.length) return;
    const cp = cam.position;
    for (const L of lods) {
      const far = L.c.distanceTo(cp) - L.r > LO_D;
      if (far !== L.lo) { L.lo = far; L.im.geometry = far ? L.loG : L.hiG; }
    }
  }

  // ---- the bluffs' cover: gorse, bramble and last year's bracken in clumps up the slopes (the folds and the scrub the
  // men climbed through), thinner on the steepest faces; marram tufts on the shelf behind the shingle ----
  function scrub(g) {
    const T = NT(), r = prng(6061944), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const kinds = [[0x46553a, []], [0x8c8460, []], [0x76683f, []], [0x9a9168, []]];   // gorse, dry dune grass, bracken, marram   // gorse, bramble, bracken, marram
    for (let x = 380; x < 2500; x += 0.7) {                      // Pointe du Hoc to Colleville
      const st = T.station(x); if (st.drawK > 0.6) continue;
      const z0 = T.bluffFootZ(x), z1 = T.bluffTopZ(x) + 4;
      for (let k = 0; k < 6; k++) {
        const z = z0 + r() * (z1 - z0), dens = patch(x, z);                       // thickets and open grass, not an even scatter
        if (r() > dens) continue;
        const c = r(), kind = c < 0.18 ? 0 : c < 0.8 ? 1 : 2;
        kinds[kind][1].push(x + (r() - 0.5) * 0.7, z, kind === 2 ? 0.14 + r() * 0.12 : 0.1 + r() * 0.2);   // clumps 1-4 m across, ~1.5x
      }
      if (r() < 0.5) { const zs = T.shingleZ(x) + 2.5, z = zs + r() * Math.max(0.5, z0 - zs - 0.5); kinds[3][1].push(x, z, 0.07 + r() * 0.06); }
    }
    // a tuft of dune grass: a few thin blades fanned out (the gorse and bracken stay clumps)
    if (!shared.tuft) {
      const parts = [];
      for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28, g = new THREE.ConeGeometry(0.09, 1.6, 3); g.translate(0, 0.8, 0); g.rotateZ(0.35 + (i % 3) * 0.12); g.rotateY(a); parts.push(g.toNonIndexed()); }
      const n = parts.reduce((k, g) => k + g.attributes.position.count, 0), pos = new Float32Array(n * 3); let o = 0;
      for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
      shared.tuft = new THREE.BufferGeometry(); shared.tuft.setAttribute('position', new THREE.BufferAttribute(pos, 3)); shared.tuft.computeVertexNormals();
    }
    kinds.forEach(([col, pts], ki) => {
      const tuft = ki === 1 || ki === 3;
      const n = pts.length / 3, mat = new THREE.MeshLambertMaterial({ color: soft(col), side: tuft ? THREE.DoubleSide : THREE.FrontSide });
      chunked(g, tuft ? shared.tuft : shared.bush, tuft ? null : shared.bushLo, mat, n, i => pts[i * 3], i => pts[i * 3 + 1], (i, x, z) => { const k = pts[i * 3 + 2]; q.setFromAxisAngle(_Y, r() * 6.28); return m.compose(p.set(x, gy(x, z) + (tuft ? 0 : 0.15 * k), z), q, tuft ? s.set(k * 1.3, k * 0.9, k * 1.3) : s.set(k * (1.1 + r() * 0.6), k * 0.95, k)); }, 1);
    });
  }
  const _Y = new THREE.Vector3(0, 1, 0);
  // smooth value noise (two octaves) 0-1, squared: most of the slope open, the scrub in patches ~10-30 u across
  function patch(x, z) {
    const h = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
    const v = (x, z) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
      return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - w) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * w; };
    const n = v(x / 18, z / 9) * 0.7 + v(x / 6, z / 4) * 0.3;
    return Math.min(1, Math.max(0, (n - 0.35) * 1.9)) ** 1.5;
  }

  // ---- the sea wall (Vierville to Les Moulins) ----
  function seaWall(g) {
    const T = NT(), pts = [];
    for (let x = 1345; x < 1600; x += 2) { const st = T.station(x); if (st.wall < 0.05 || st.drawK > 0.6) continue; pts.push(x); }
    const im = new THREE.InstancedMesh(shared.wall, shared.concrete, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    pts.forEach((x, i) => { const st = T.station(x), z = st.zs + st.sand + 3.4, y = gy(x, z); im.setMatrixAt(i, m.compose(p.set(x, y - 0.1, z), q, s.set(2.05, st.wall * T.VEX + 0.25, 0.5))); });
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
  }

  // ---- the obstacles: one InstancedMesh per part, an instance per obstacle (hidden when destroyed) ----
  function obstacles(g) {
    const L = NT().obstacles, n = L.length;
    const mk = (geo, mat, k) => { const im = new THREE.InstancedMesh(geo, mat, n * k); im.castShadow = true; g.add(im); return im; };
    obstMeshes = { L, beams: mk(shared.beam, shared.steel, 3), poles: mk(shared.pole, shared.wood, 2), mines: mk(shared.mine, shared.mineM, 1), gates: mk(shared.gate, shared.steel, 6) };
    lastAlive = -1;
    place();
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function put(im, i, x, y, z, rx, ry, rz, sx, sy, sz) { _e.set(rx, ry, rz); _q.setFromEuler(_e); im.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))); }
  function place() {
    const O = obstMeshes; if (!O) return;
    const Z = 0, hide = (im, i) => put(im, i, 0, -50, 0, 0, 0, 0, Z, Z, Z);
    let nb = 0, np = 0, nm = 0, ng = 0, alive = 0;
    for (const o of O.L) {
      const y = o.y, a = o.heading;
      if (o.alive) alive++;
      const on = o.alive;
      if (o.kind === 'hedgehog') { // three crossed steel beams
        for (let k = 0; k < 3; k++) on ? put(O.beams, nb++, o.x, y + 0.14, o.z, k === 0 ? 0.8 : 0, a + k * 2.1, k === 0 ? 0 : 0.8, 1, 1, 1) : hide(O.beams, nb++);
      } else if (o.kind === 'gate') { // Element C: a steel lattice gate facing the sea
        // the frame: three uprights and a top and a bottom rail, 0.65 u wide and 0.5 u tall
        for (let k = 0; k < 6; k++) {
          const up = k < 3, lx = up ? (k - 1) * 0.3 : 0, ly = up ? 0.25 : k === 3 ? 0.5 : k === 4 ? 0.03 : 0.27;
          on ? put(O.gates, ng++, o.x + lx * Math.cos(a), y + ly, o.z + lx * Math.sin(a), 0, -a, 0, up ? 0.35 : 6.5, up ? 5 : 0.35, 0.35) : hide(O.gates, ng++);
        }
      } else { // a stake or a log ramp leaning toward the sea, a Teller mine on its tip
        // the pole leans seaward (-z) so a craft running in rides up it onto the mine
        const ramp = o.kind === 'ramp', tilt = ramp ? 0.9 : 0.45, len = ramp ? 1.8 : 1.3, L = 0.5 * len;
        on ? put(O.poles, np++, o.x, y + 0.5 * L * Math.cos(tilt), o.z - 0.5 * L * Math.sin(tilt), -tilt, a, 0, 1, len, 1) : hide(O.poles, np++);
        on && ramp ? put(O.poles, np++, o.x, y + 0.13, o.z - 0.2, 0, a, 0, 1, 0.6, 1) : hide(O.poles, np++);
        on && o.mined ? put(O.mines, nm++, o.x, y + L * Math.cos(tilt), o.z - L * Math.sin(tilt), -tilt, 0, 0, 1, 1, 1) : hide(O.mines, nm++);
      }
    }
    for (const im of [O.beams, O.poles, O.mines, O.gates]) { im.instanceMatrix.needsUpdate = true; }
    O.beams.count = nb; O.poles.count = np; O.mines.count = nm; O.gates.count = ng;
    lastAlive = alive;
  }
  // per frame (base_fx-style hook, cheap): re-place only when the number of standing obstacles changed
  function update(rdt) {
    if (!obstMeshes || !WW.isScn('normandy')) return;
    if (WW.normandyVillages) WW.normandyVillages.update(rdt);   // the gutted houses' smoke
    lodUpdate();
    let alive = 0; for (const o of obstMeshes.L) if (o.alive) alive++;
    if (alive !== lastAlive) place();
  }

  function build(g) {
    if (!shared) initShared();
    lods = [];
    const r = prng(1944);
    if (WW.normandyVillages) WW.normandyVillages.build(g); else D().VILLAGES.forEach(v => village(g, v, r));   // normandy_villages.js: the house kit, the damage, the villas, the roads
    hedgerows(g, r);
    scrub(g);
    seaWall(g);
    obstacles(g);
  }
  WW.normandyProps = { build, update };
  WW.on('roundStart', () => { lastAlive = -1; });
})(window.WW);
