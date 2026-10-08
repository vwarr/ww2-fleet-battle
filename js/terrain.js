// terrain.js (owner A): procedural sea floor, islands, water, depth grid.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, CELL = WW.cfg.CELL;
  const GW = Math.round(W / CELL) + 1, GH = Math.round(H / CELL) + 1;
  const MARGIN = 120;          // floor mesh extends past the map so the view has no hard edge
  const FLOOR_STEP = 3;        // mesh cell size (units)
  const WATER_STEP = 6;
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
  function makeFeatures() {
    features = []; centres.length = 0;
    const nIsl = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nIsl; i++) {
      const [cx, cz] = spot(150, 330, 50, 250, 90), r = rr(10, 17);
      addFeature('island', cx, cz, r * rr(0.7, 1.3), r * rr(0.6, 1.1), rr(0, Math.PI), rr(3, 8));
      if (rnd() < 0.5) { // spit trailing off the island
        const a = rr(0, Math.PI * 2), len = r * rr(1.1, 1.8);
        addFeature('spit', cx + Math.cos(a) * len * 0.7, cz + Math.sin(a) * len * 0.7, len * 0.6, rr(1.8, 3), a, rr(0.5, 1.2));
      }
    }
    const nSmall = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nSmall; i++) {
      const [x, z] = spot(140, 340, 25, 275, 60);
      addFeature('islet', x, z, rr(4, 7), rr(4, 7), rr(0, 3), rr(1.5, 3.5));
    }
    const nBar = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nBar; i++) {
      const edge = rnd() < 0.35; // a bar may sit near the top/bottom edges anywhere
      const [cx, cz] = edge ? spot(40, 440, rnd() < 0.5 ? 10 : 265, rnd() < 0.5 ? 35 : 290, 50) : spot(140, 340, 30, 270, 50);
      addFeature('bar', cx, cz, rr(8, 18), rr(1.5, 2.5), rr(0, Math.PI), rr(-0.4, 0.4));
    }
    const nReef = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < nReef; i++) {
      const [x, z] = spot(130, 350, 20, 280, 50);
      addFeature('reef', x, z, rr(5, 10), rr(3, 7), rr(0, 3), rr(-3, -0.8));
    }
  }

  let radScale = 1;
  // shelf: width (units) of the shallow ledge outside the coast; drop: width of the slope down to deep water
  const SHELF = { island: [5, 12], islet: [3.5, 9], spit: [3, 8], bar: [2.5, 7], reef: [3, 8] };
  function featureHeight(f, x, z) {
    const dx = x - f.cx, dz = z - f.cz;
    const u = dx * f.c + dz * f.s, v = -dx * f.s + dz * f.c;
    const rx = f.rx * radScale, rz = f.rz * radScale, rmin = Math.min(rx, rz);
    const sh = SHELF[f.kind];
    let n = Math.sqrt((u / rx) * (u / rx) + (v / rz) * (v / rz));
    if (n > (1 + (sh[0] + sh[1]) / rmin) / 0.75) return -99;
    n *= 0.75 + 0.5 * vnoise(x * 0.07 + 40, z * 0.07 + 40); // ragged coast
    const shoreH = -0.7;
    if (n < 1) return f.peak - (f.peak - shoreH) * Math.pow(n, 1.6);
    const e = (n - 1) * rmin; // approx distance from the coast
    if (e < sh[0]) return Math.min(f.peak, shoreH) - 2.8 * e / sh[0];
    return WW.lerp(Math.min(f.peak, shoreH) - 2.8, -BASE_DEPTH - 4, smooth(sh[0], sh[0] + sh[1], e));
  }
  // raw terrain height (negative = under water) anywhere, including outside the map
  function heightRaw(x, z) {
    let h = -BASE_DEPTH + (fbm(x * 0.012, z * 0.012) - 0.5) * 8;
    // fleet start zones (x<120, x>360) stay open, except along the top/bottom edges
    const open = Math.min(smooth(95, 135, x), 1 - smooth(345, 385, x));
    const keep = Math.max(open, smooth(45, 25, z), smooth(255, 275, z));
    if (keep > 0.01) for (let i = 0; i < features.length; i++) {
      let fh = featureHeight(features[i], x, z);
      if (keep < 1) fh = WW.lerp(-BASE_DEPTH - 4, fh, keep);
      if (fh > h) h = fh;
    }
    // small surface roughness
    h += (vnoise(x * 0.25, z * 0.25) - 0.5) * (h > 0 ? 1.2 : 0.6);
    return h;
  }

  function landFraction() {
    let land = 0, tot = 0;
    for (let z = 2; z < H; z += 5) for (let x = 2; x < W; x += 5) { tot++; if (heightRaw(x, z) > 0) land++; }
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

  // ---- colours ----
  const C = hex => new THREE.Color(hex);
  const FLOOR_BANDS = [ // [max depth, colour]
    [0.8, C(0xe8dcaa)], [2.2, C(0xc9d6a0)], [4, C(0x8fc6a6)], [7, C(0x5a9c9c)], [11, C(0x2f5f7a)], [99, C(0x1d3c5c)]
  ];
  const WATER_BANDS = [
    [1.2, C(0x6fe6d6)], [3, C(0x38c4cc)], [5.5, C(0x22a4c0)], [9, C(0x175f94)], [13, C(0x12477a)], [99, C(0x0e3462)]
  ];
  const LAND = [[0.7, C(0xe2cf8e)], [1.4, C(0xd2bd78)], [3, C(0x5f9a3c)], [5, C(0x4a8032)], [7, C(0x7d7563)], [99, C(0x9a9384)]];
  function band(tbl, v) { for (let i = 0; i < tbl.length; i++) if (v <= tbl[i][0]) return tbl[i][1]; return tbl[tbl.length - 1][1]; }

  // ---- meshes ----
  let root = null, floorMesh = null, waterMesh = null, waterBase = null, propsGroup = null;
  let shared = null;
  function initShared() {
    shared = {
      floorMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      waterMat: new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.62,
                                              shininess: 40, specular: 0x335566, depthWrite: false }),
      trunkGeo: new THREE.BoxGeometry(0.35, 1, 0.35),
      leafGeo: new THREE.BoxGeometry(2.2, 0.2, 0.5),
      hutGeo: new THREE.BoxGeometry(1.8, 1.1, 1.4),
      roofGeo: new THREE.ConeGeometry(1.5, 0.9, 4),
      trunkMat: new THREE.MeshLambertMaterial({ color: 0x7a5a36 }),
      leafMat: new THREE.MeshLambertMaterial({ color: 0x2f7a2a }),
      hutMat: new THREE.MeshLambertMaterial({ color: 0x9c7c4c }),
      roofMat: new THREE.MeshLambertMaterial({ color: 0xc8a860 })
    };
  }

  // Non-indexed grid; one colour per triangle (flat low-poly look).
  function buildGridGeo(x0, z0, x1, z1, step, hfun, colfun) {
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const hs = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hs[j * (nx + 1) + i] = hfun(x0 + i * step, z0 + j * step);
    const pos = new Float32Array(nx * nz * 18), col = new Float32Array(nx * nz * 18);
    let p = 0;
    const put = (i, j) => { pos[p++] = x0 + i * step; pos[p++] = hs[j * (nx + 1) + i]; pos[p++] = z0 + j * step; };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const flip = (i + j) & 1;
      const tris = flip ? [[i, j, i, j + 1, i + 1, j], [i + 1, j, i, j + 1, i + 1, j + 1]]
                        : [[i, j, i, j + 1, i + 1, j + 1], [i, j, i + 1, j + 1, i + 1, j]];
      for (const t of tris) {
        const start = p;
        put(t[0], t[1]); put(t[2], t[3]); put(t[4], t[5]);
        const c = colfun(pos, start);
        for (let k = 0; k < 3; k++) { col[start + k * 3] = c.r; col[start + k * 3 + 1] = c.g; col[start + k * 3 + 2] = c.b; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const tmpC = new THREE.Color();
  function floorColour(pos, s) {
    const hMax = Math.max(pos[s + 1], pos[s + 4], pos[s + 7]), hAvg = (pos[s + 1] + pos[s + 4] + pos[s + 7]) / 3;
    if (hMax > 0.05) return band(LAND, hAvg);
    return band(FLOOR_BANDS, -hAvg);
  }
  function rawDepth(x, z) { return (x >= 0 && x <= W && z >= 0 && z <= H) ? depthAt(x, z) : -heightRaw(x, z); }
  function waterColour(pos, s) {
    const cx = (pos[s] + pos[s + 3] + pos[s + 6]) / 3, cz = (pos[s + 2] + pos[s + 5] + pos[s + 8]) / 3;
    const d = rawDepth(cx, cz);
    tmpC.copy(band(WATER_BANDS, d));
    if (d < 0.6) tmpC.lerp(C(0xffffff), 0.45); // surf line
    return tmpC;
  }

  function buildProps() {
    propsGroup = new THREE.Group();
    let palms = 0, huts = 0;
    for (let tries = 0; tries < 4000 && palms < 46; tries++) {
      const x = rr(0, W), z = rr(0, H), h = -depthAt(x, z);
      if (h < 0.6 || h > 4.5) continue;
      const g = new THREE.Group();
      const tall = rr(1.6, 2.6);
      const trunk = new THREE.Mesh(shared.trunkGeo, shared.trunkMat);
      trunk.scale.y = tall; trunk.position.y = tall / 2; trunk.rotation.z = rr(-0.25, 0.25);
      g.add(trunk);
      for (let k = 0; k < 3; k++) {
        const leaf = new THREE.Mesh(shared.leafGeo, shared.leafMat);
        leaf.position.y = tall; leaf.rotation.y = k * Math.PI / 3; leaf.rotation.z = 0.15;
        g.add(leaf);
      }
      g.position.set(x, h - 0.1, z); g.rotation.y = rr(0, 6.28);
      propsGroup.add(g); palms++;
    }
    for (let tries = 0; tries < 2000 && huts < 6; tries++) {
      const x = rr(0, W), z = rr(0, H), h = -depthAt(x, z);
      if (h < 1.2 || h > 3.5) continue;
      const g = new THREE.Group();
      const body = new THREE.Mesh(shared.hutGeo, shared.hutMat); body.position.y = 0.55; g.add(body);
      const roof = new THREE.Mesh(shared.roofGeo, shared.roofMat); roof.position.y = 1.5; roof.rotation.y = Math.PI / 4; g.add(roof);
      g.position.set(x, h - 0.15, z); g.rotation.y = rr(0, 6.28);
      propsGroup.add(g); huts++;
    }
    root.add(propsGroup);
  }

  function disposeOld() {
    if (!root) return;
    WW.scene && WW.scene.remove(root);
    if (floorMesh) floorMesh.geometry.dispose();
    if (waterMesh) waterMesh.geometry.dispose();
    root = floorMesh = waterMesh = propsGroup = waterBase = null; // prop geos/mats are shared, kept
  }

  function generate(seed) {
    if (!shared) initShared();
    disposeOld();
    rs = (seed >>> 0) || 1;
    seedNoise();
    makeFeatures();
    // tune feature size so land covers ~5-10% of the map
    const target = rr(0.04, 0.065);
    let lo = 0.3, hi = 3.2;
    for (let it = 0; it < 9; it++) {
      radScale = (lo + hi) / 2;
      if (landFraction() > target) hi = radScale; else lo = radScale;
    }
    radScale = (lo + hi) / 2;
    buildGrid();

    root = new THREE.Group(); root.name = 'terrain';
    const fg = buildGridGeo(-MARGIN, -MARGIN, W + MARGIN, H + MARGIN, FLOOR_STEP,
      (x, z) => -rawDepth(x, z), floorColour);
    floorMesh = new THREE.Mesh(fg, shared.floorMat);
    root.add(floorMesh);
    const wg = buildGridGeo(-MARGIN, -MARGIN, W + MARGIN, H + MARGIN, WATER_STEP, () => 0, waterColour);
    waterBase = Float32Array.from(wg.attributes.position.array);
    waterMesh = new THREE.Mesh(wg, shared.waterMat);
    waterMesh.renderOrder = 1;
    root.add(waterMesh);
    buildProps();
    WW.scene && WW.scene.add(root);
    WW.terrain.seed = seed;
    WW.terrain.landFraction = landFraction();
  }

  let wt = 0, lastWave = 0;
  function update(dt) {
    if (!waterMesh) return;
    wt += dt;
    const now = performance.now();
    if (now - lastWave < 50) return; // waves redraw at ~20 Hz wall-clock: cheap, retro, and free during fastForward
    lastWave = now;
    const pos = waterMesh.geometry.attributes.position, a = pos.array, b = waterBase;
    for (let i = 0; i < a.length; i += 3) {
      const x = b[i], z = b[i + 2];
      a[i + 1] = 0.16 * Math.sin(x * 0.11 + wt * 0.9) + 0.12 * Math.sin(z * 0.17 - wt * 1.3 + x * 0.05);
    }
    pos.needsUpdate = true;
  }

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
