// terrain.js (owner A): procedural sea floor, islands, water, depth grid.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, CELL = WW.cfg.CELL;
  const GW = Math.round(W / CELL) + 1, GH = Math.round(H / CELL) + 1;
  const MARGIN = 160;          // floor mesh extends past the map so the view has no hard edge
  const FLOOR_STEP = 2;        // mesh cell size (units)
  const BASE_DEPTH = 17;

  // ---- local seeded RNG + value noise (independent of WW.rand) ----
  let rs = 1;
  function rnd() {
    rs = (rs + 0x6D2B79F5) >>> 0;
    let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + (b - a) * rnd();
  let perm = new Uint8Array(512), grad = new Float32Array(256);
  function seedNoise() {
    const p = []; for (let i = 0; i < 256; i++) { p.push(i); grad[i] = rnd(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const X = xi & 255, Z = zi & 255;
    const a = grad[perm[X + perm[Z]]], b = grad[perm[X + 1 + perm[Z]]];
    const c = grad[perm[X + perm[Z + 1]]], d = grad[perm[X + 1 + perm[Z + 1]]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // 0..1
  }
  function fbm(x, z) { return vnoise(x, z) * 0.6 + vnoise(x * 2.1 + 17, z * 2.1 + 9) * 0.3 + vnoise(x * 4.3 + 5, z * 4.3 + 31) * 0.1; }
  const smooth = (a, b, x) => { const t = WW.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---- features: islands, spits, sandbars, reefs ----
  let features = [];
  function addFeature(kind, cx, cz, rx, rz, rot, peak) {
    features.push({ kind, cx, cz, rx, rz, c: Math.cos(rot), s: Math.sin(rot), peak, });
  }
  // pick a centre at least `gap` units from the main features already placed (keeps features separate)
  const centres = [];
  function spot(x0, x1, z0, z1, gap) {
    let best = null, bestD = -1;
    for (let k = 0; k < 40; k++) {
      const x = rr(x0, x1), z = rr(z0, z1);
      let d = 1e9;
      for (const c of centres) d = Math.min(d, Math.hypot(x - c[0], z - c[1]));
      if (d >= gap) { best = [x, z]; break; }
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    centres.push(best);
    return best;
  }
  // Features sit in the open sea between the two start zones (x 135 .. W - 135); counts scale with that area.
  function makeFeatures() {
    features = []; centres.length = 0;
    const nIsl = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < nIsl; i++) {
      const [cx, cz] = spot(150, W - 150, 50, H - 50, 90), r = rr(10, 17);
      addFeature('island', cx, cz, r * rr(0.7, 1.3), r * rr(0.6, 1.1), rr(0, Math.PI), rr(3, 8));
      if (rnd() < 0.5) { // spit trailing off the island
        const a = rr(0, Math.PI * 2), len = r * rr(1.1, 1.8);
        addFeature('spit', cx + Math.cos(a) * len * 0.7, cz + Math.sin(a) * len * 0.7, len * 0.6, rr(1.8, 3), a, rr(0.5, 1.2));
      }
    }
    const nSmall = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < nSmall; i++) {
      const [x, z] = spot(140, W - 140, 25, H - 25, 60);
      addFeature('islet', x, z, rr(4, 7), rr(4, 7), rr(0, 3), rr(1.5, 3.5));
    }
    const nBar = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nBar; i++) {
      const edge = rnd() < 0.35, top = rnd() < 0.5; // a bar may sit near the top/bottom edges anywhere
      const [cx, cz] = edge ? spot(40, W - 40, top ? 10 : H - 35, top ? 35 : H - 10, 50) : spot(140, W - 140, 30, H - 30, 50);
      addFeature('bar', cx, cz, rr(8, 18), rr(1.5, 2.5), rr(0, Math.PI), rr(-0.4, 0.4));
    }
    const nReef = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < nReef; i++) {
      const [x, z] = spot(130, W - 130, 20, H - 20, 50);
      addFeature('reef', x, z, rr(5, 10), rr(3, 7), rr(0, 3), rr(-2.6, -1.4));
    }
  }

  let radScale = 1;
  // shelf: width (units) of the shallow ledge outside the coast; drop: width of the slope down to deep water
  const SHELF = { island: [6, 20], islet: [4, 15], spit: [3, 9], bar: [2.5, 7], reef: [3, 10] }; // gentle shelves, no cliffs
  function featureHeight(f, x, z) {
    const dx = x - f.cx, dz = z - f.cz;
    const u = dx * f.c + dz * f.s, v = -dx * f.s + dz * f.c;
    const rx = f.rx * radScale, rz = f.rz * radScale, rmin = Math.min(rx, rz);
    const sh = SHELF[f.kind];
    let n = Math.sqrt((u / rx) * (u / rx) + (v / rz) * (v / rz));
    if (n > (1 + (sh[0] + sh[1]) / rmin) / 0.75) return -99;
    n *= 0.88 + 0.24 * vnoise(x * 0.05 + 40, z * 0.05 + 40); // gently wobbly, rounded coast
    const shoreH = -0.7;
    if (n < 1) {
      if (f.peak < shoreH) return f.peak - 0.8 * n * n; // submerged reef: a gentle dome, no flat rim near the surface
      // soft rounded lump; the blend with a linear term keeps a real slope at the waterline (clean foam line)
      const k = 0.6 * smooth(1, 0.45, n) + 0.4 * WW.clamp((1 - n) / 0.55, 0, 1);
      return shoreH + (f.peak - shoreH) * k;
    }
    const e = (n - 1) * rmin; // approx distance from the coast
    if (e < sh[0]) return Math.min(f.peak, shoreH) - 2.8 * e / sh[0];
    return WW.lerp(Math.min(f.peak, shoreH) - 2.8, -BASE_DEPTH - 4, smooth(sh[0], sh[0] + sh[1], e));
  }
  // raw terrain height (negative = under water) anywhere, including outside the map
  function heightRaw(x, z) {
    let h = -BASE_DEPTH + (fbm(x * 0.012, z * 0.012) - 0.5) * 8;
    // fleet start zones (x<120, x>W-120) stay open, except along the top/bottom edges
    const open = Math.min(smooth(95, 135, x), 1 - smooth(W - 135, W - 95, x));
    const keep = Math.max(open, smooth(45, 25, z), smooth(H - 45, H - 25, z));
    if (keep > 0.01) for (let i = 0; i < features.length; i++) {
      let fh = featureHeight(features[i], x, z);
      if (keep < 1) fh = WW.lerp(-BASE_DEPTH - 4, fh, keep);
      if (fh > h) h = fh;
    }
    // small surface roughness
    h += (vnoise(x * 0.12, z * 0.12) - 0.5) * (h > 0 ? 0.4 : 0.5);
    return h;
  }

  function landFraction(step) {
    step = step || 5;
    let land = 0, tot = 0;
    for (let z = 2; z < H; z += step) for (let x = 2; x < W; x += step) { tot++; if (heightRaw(x, z) > 0) land++; }
    return land / tot;
  }

  // ---- depth grid ----
  let grid = new Float32Array(GW * GH); // depth at nodes (positive = water)
  function buildGrid() {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) grid[j * GW + i] = -heightRaw(i * CELL, j * CELL);
  }
  function depthAt(x, z) {
    if (!(x >= 0 && x <= W && z >= 0 && z <= H)) return 0;
    const fx = x / CELL, fz = z / CELL;
    const i = Math.min(GW - 2, Math.floor(fx)), j = Math.min(GH - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j, k = j * GW + i;
    const a = grid[k], b = grid[k + 1], c = grid[k + GW], d = grid[k + GW + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  // ---- colours: smooth gradients (soft pastel toy-box palette) ----
  const C = hex => WW.pastel(hex, 0.08); // soft pastel palette (ACES tone mapping desaturates a little more)
  const FLOOR = [[0, C(0xf2e4bc)], [1.5, C(0xe6e2bc)], [4, C(0xb8dcc6)], [8, C(0x86c0c4)], [14, C(0x5f9cb8)], [24, C(0x4a82a8)]];
  const LAND = [[0, C(0xf2dcae)], [0.7, C(0xead3a2)], [1.3, C(0xa6cc86)], [3, C(0x8cbf76)], [5.5, C(0x7aae68)], [8, C(0x739f62)]]; // sage-green tops, darker with height (no bald patch)
  const tmpC = new THREE.Color();
  function ramp(tbl, v) {
    if (v <= tbl[0][0]) return tmpC.copy(tbl[0][1]);
    for (let i = 1; i < tbl.length; i++) if (v <= tbl[i][0]) {
      const t = (v - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0]);
      return tmpC.copy(tbl[i - 1][1]).lerp(tbl[i][1], t * t * (3 - 2 * t));
    }
    return tmpC.copy(tbl[tbl.length - 1][1]);
  }

  // ---- meshes ----
  let root = null, floorMesh = null, propsGroup = null;
  let shared = null;
  function initShared() {
    shared = {
      floorMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      trunkGeo: new THREE.CylinderGeometry(0.16, 0.22, 1, 6),
      leafGeo: new THREE.SphereGeometry(0.9, 8, 6),
      bushGeo: new THREE.SphereGeometry(1, 8, 6),
      hutGeo: new THREE.BoxGeometry(1.8, 1.1, 1.4),
      roofGeo: new THREE.ConeGeometry(1.5, 0.9, 4),
      trunkMat: new THREE.MeshLambertMaterial({ color: 0xb08a64 }),
      leafMat: new THREE.MeshLambertMaterial({ color: 0x7cc06a }),
      bushMat: new THREE.MeshLambertMaterial({ color: 0x8ccb76 }),
      hutMat: new THREE.MeshLambertMaterial({ color: 0xe8d2a8 }),
      roofMat: new THREE.MeshLambertMaterial({ color: 0xd88a6a })
    };
    shared.leafGeo.scale(1, 0.55, 1);
  }

  // Indexed grid with smooth normals and per-vertex gradient colours.
  function buildFloorGeo(x0, z0, x1, z1, step) {
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array(pos.length);
    // heights once per vertex (the big map's floor has ~300k vertices); the AO pass reads its neighbours from here
    const NX = nx + 1, hs = new Float32Array(NX * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hs[j * NX + i] = -rawDepth(x0 + i * step, z0 + j * step);
    const hAt = (i, j) => hs[WW.clamp(j, 0, nz) * NX + WW.clamp(i, 0, nx)];
    let p = 0;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step, h = hs[j * NX + i];
      const c = h > 0 ? ramp(LAND, h) : ramp(FLOOR, -h);
      // baked ambient occlusion: darken creases/hollows and the band where land meets water
      const nb = (hAt(i + 1, j) + hAt(i - 1, j) + hAt(i, j + 1) + hAt(i, j - 1)) * 0.25;
      const crease = WW.clamp((nb - h) * 0.35, 0, 0.22);
      const wet = h > -1.5 && h < 0.35 ? 0.1 * (1 - Math.abs(h + 0.55) / 0.95) : 0;
      c.multiplyScalar(1 - crease - Math.max(0, wet));
      pos[p] = x; pos[p + 1] = h; pos[p + 2] = z;
      col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b; p += 3;
    }
    const idx = new Uint32Array(nx * nz * 6);
    let k = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }
  function rawDepth(x, z) { return (x >= 0 && x <= W && z >= 0 && z <= H) ? depthAt(x, z) : -heightRaw(x, z); }

  function buildProps() {
    propsGroup = new THREE.Group();
    let palms = 0, huts = 0;
    for (let tries = 0; tries < 12000 && palms < 120; tries++) {
      const x = rr(0, W), z = rr(0, H), h = -depthAt(x, z);
      if (h < 0.6 || h > 4.5) continue;
      const g = new THREE.Group();
      const tall = rr(1.6, 2.6);
      const trunk = new THREE.Mesh(shared.trunkGeo, shared.trunkMat);
      trunk.scale.y = tall; trunk.position.y = tall / 2; trunk.rotation.z = rr(-0.25, 0.25);
      g.add(trunk);
      const leaf = new THREE.Mesh(shared.leafGeo, shared.leafMat);
      leaf.position.y = tall; g.add(leaf);
      if (rnd() < 0.5) { // a soft round bush at the foot
        const bush = new THREE.Mesh(shared.bushGeo, shared.bushMat);
        const r = rr(0.5, 0.9); bush.scale.set(r, r * 0.7, r); bush.position.set(rr(-1, 1), 0.2, rr(-1, 1)); g.add(bush);
      }
      g.position.set(x, h - 0.1, z); g.rotation.y = rr(0, 6.28);
      propsGroup.add(g); palms++;
    }
    for (let tries = 0; tries < 6000 && huts < 14; tries++) {
      const x = rr(0, W), z = rr(0, H), h = -depthAt(x, z);
      if (h < 1.2 || h > 3.5) continue;
      const g = new THREE.Group();
      const body = new THREE.Mesh(shared.hutGeo, shared.hutMat); body.position.y = 0.55; g.add(body);
      const roof = new THREE.Mesh(shared.roofGeo, shared.roofMat); roof.position.y = 1.5; roof.rotation.y = Math.PI / 4; g.add(roof);
      g.position.set(x, h - 0.15, z); g.rotation.y = rr(0, 6.28);
      propsGroup.add(g); huts++;
    }
    propsGroup.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(propsGroup);
  }

  function disposeOld() {
    if (!root) return;
    WW.scene && WW.scene.remove(root);
    if (floorMesh) floorMesh.geometry.dispose();
    root = floorMesh = propsGroup = null; // prop geos/mats are shared, kept
  }

  function generate(seed) {
    if (!shared) initShared();
    disposeOld();
    rs = (seed >>> 0) || 1;
    seedNoise();
    makeFeatures();
    // tune feature size so land covers ~4-6.5% of the map
    const target = rr(0.04, 0.065);
    let lo = 0.3, hi = 3.2;
    for (let it = 0; it < 9; it++) {
      radScale = (lo + hi) / 2;
      if (landFraction(10) > target) hi = radScale; else lo = radScale; // coarse samples: fast enough on the big map
    }
    radScale = (lo + hi) / 2;
    buildGrid();

    root = new THREE.Group(); root.name = 'terrain';
    floorMesh = new THREE.Mesh(buildFloorGeo(-MARGIN, -MARGIN, W + MARGIN, H + MARGIN, FLOOR_STEP), shared.floorMat);
    floorMesh.receiveShadow = true;
    root.add(floorMesh);
    buildProps();
    WW.scene && WW.scene.add(root);
    if (WW.water) WW.water.setDepth(rawDepth, -MARGIN, -MARGIN, W + 2 * MARGIN, H + 2 * MARGIN);
    WW.terrain.seed = seed;
    WW.terrain.landFraction = landFraction();
  }

  function update() { /* water animates on real time (main calls WW.water.update) */ }

  function isNavigable(x, z, minDepth) { return depthAt(x, z) >= (minDepth || 0.5); }

  function randomSeaPoint(minDepth, xMin, xMax) {
    xMin = xMin == null ? 0 : xMin; xMax = xMax == null ? W : xMax;
    const need = minDepth || 1;
    let best = null, bestD = -1;
    for (let k = 0; k < 600; k++) {
      const x = WW.randRange(Math.max(4, xMin), Math.min(W - 4, xMax)), z = WW.randRange(12, H - 12);
      // require a little clearance around the point
      const d = Math.min(depthAt(x, z), depthAt(x + 6, z), depthAt(x - 6, z), depthAt(x, z + 6), depthAt(x, z - 6));
      if (d >= need + 1) return { x, z };
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    return best;
  }

  WW.terrain = { init() {}, generate, depthAt, isNavigable, randomSeaPoint, update, seed: 0, landFraction: 0 };
})(window.WW);
