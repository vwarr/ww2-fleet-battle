// terrain_normandy.js - WW.normandyTerrain: the Normandy coast as a height function (docs/NORMANDY_PLAN.md P2).
// terrain.js calls heightRaw(x, z) for the depth grid, the floor mesh and the water's depth texture when the scenario
// has a terrain (scenario.js normandy.terrain = this). Defined everywhere, past the map edges too: the coast runs on
// out of view, as if the Pacific map had been scrolled until it reached France.
// The layout is the same on every seed (terrain_normandy_data.js: one cross-shore profile per station, interpolated
// along x); the seeded noise (terrain.js kit) adds detail only. Sim data built here: the beach obstacles (fixed
// local PRNG: the same belts every seed; their state resets each round).
// Profile across the shore (s = zs(x) - z: + seaward, u = -s inland): the sea bed (destroyers find depth 4 about
// 95 u out, battleships depth 8 about 400-450 u out), the tidal flat (0-1.5 deep over 30-40 u at low water), the dry
// sand, the shingle bank, the sea wall, the marsh shelf, the bluffs and the plateau; the draws cut notches.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const D = WW.normandyData;
  const X0 = -700, X1 = 3100, NC = X1 - X0 + 1;      // the column table (1 u steps) covers the map and its margins
  const FIELDS = ['zs', 'flat', 'sand', 'sh', 'wall', 'shelf', 'shH', 'bw', 'bh', 'rock'];
  const VEX = (() => { const m = typeof location !== 'undefined' && /[?&]vex=([0-9.]+)/.exec(location.search); return m ? +m[1] : 1.3; })();
  const col = {}; FIELDS.forEach(f => { col[f] = new Float32Array(NC); });
  const drawK = new Float32Array(NC), drawI = new Int8Array(NC);
  let kit = null, built = false;
  const sm = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  function buildColumns() {
    const S = D.STATIONS;
    for (let i = 0; i < NC; i++) {
      const x = X0 + i;
      let k = 0; while (k < S.length - 2 && S[k + 1].x < x) k++;
      const a = S[k], b = S[k + 1], t = WW.clamp((x - a.x) / (b.x - a.x), 0, 1);
      for (const f of FIELDS) col[f][i] = a[f] + (b[f] - a[f]) * t;
      let g = 0, gi = -1;
      D.DRAWS.forEach((d, j) => { const q = Math.exp(-Math.pow((x - d.x) / d.w, 2)); if (q > g) { g = q; gi = j; } });
      drawK[i] = g > 0.02 ? g : 0; drawI[i] = g > 0.02 ? gi : -1;
    }
  }
  const ci = x => { const i = Math.round(x) - X0; return i < 0 ? 0 : i >= NC ? NC - 1 : i; };

  // fixed local PRNG (mulberry32): the obstacle belts and the Pointe du Hoc craters are the same every seed
  function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  let craters = [];
  function buildCraters() {
    const r = prng(19440606), H = D.HOC; craters = [];
    for (let k = 0; k < H.craters; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * H.r;
      craters.push({ x: H.x + Math.cos(a) * d, z: H.z + Math.sin(a) * d * 1.3 + 6, r: 1.2 + r() * 2.2, d: 0.18 + r() * 0.22 });
    }
  }

  // depth below the waterline at s u seaward (the station's tidal flat width)
  function seaDepth(s, flat) {
    if (s < flat) return 1.5 * Math.pow(s / flat, 1.15);
    if (s < 100) return 1.5 + 3.0 * sm((s - flat) / (100 - flat));
    if (s < 460) return 4.5 + 4.7 * (s - 100) / 360;
    return 9.2 + 7.1 * sm((s - 460) / 620);
  }
  // land height (before VEX) u inland of the waterline, for column i
  function landH(u, i) {
    const sand = col.sand[i], sh = col.sh[i], shelf = col.shelf[i], shH = col.shH[i], bw = col.bw[i], bh = col.bh[i];
    const sTop = 0.2, b0 = sand + 3 + shelf, b1 = b0 + bw;
    let h;
    if (u < sand) h = 0.03 + (sTop - 0.03) * (u / sand);
    else if (u < sand + 3) { const t = (u - sand) / 3; h = sTop + (shH - sTop) * t + sh * Math.sin(Math.PI * Math.min(1, t * 1.15)); }
    else if (u < b0) h = shH + (col.wall[i] > 0 && u < sand + 4.2 ? col.wall[i] : 0);
    else if (u < b1) { const t = (u - b0) / bw, rk = col.rock[i]; h = shH + (bh - shH) * (rk * Math.pow(t, 0.6) + (1 - rk) * sm(t)); }
    else h = bh + 0.55 * sm((u - b1) / 90);
    const g = drawK[i];   // a draw: a valley floor rising gently inland from the shelf, its sides sloping into the bluffs
    if (g > 0 && u > sand + 3) { const v = shH + Math.max(0, u - b0) * 0.032; if (v < h) h -= g * (h - v); }
    return h;
  }

  function heightRaw(x, z) {
    const i = ci(x), s = col.zs[i] - z;
    const n = kit ? kit.vnoise(x * 0.11, z * 0.11) - 0.5 : 0;
    if (s >= 0) {
      const far = WW.clamp((s - 120) / 220, 0, 1), m = kit ? kit.vnoise(x * 0.012 + 40, z * 0.012 + 7) - 0.5 : 0;
      return -(seaDepth(s, col.flat[i]) + m * 1.0 * far + n * 0.12 * far);
    }
    const u = -s;
    let h = landH(u, i);
    const b1 = col.sand[i] + 3 + col.shelf[i] + col.bw[i];
    if (u > b1) {   // the plateau: rolling fields
      const m = kit ? kit.vnoise(x * 0.02 + 11, z * 0.02 + 3) - 0.5 : 0;
      h += (m * 0.7 + n * 0.12) * sm((u - b1) / 25);
    }
    if (u > 2 && Math.abs(x - D.HOC.x) < 50 && Math.abs(z - D.HOC.z - 6) < 45) for (const c of craters) {   // Pointe du Hoc
      const dx = x - c.x, dz = z - c.z, q = (dx * dx + dz * dz) / (c.r * c.r);
      if (q < 1.6 && h > 2) h += q < 1 ? -c.d * (1 - q) : 0.08 * (1.6 - q) / 0.6;
    }
    return h * VEX;
  }

  // ---- queries (sim and visuals) ----
  const shoreZ = x => col.zs[ci(x)];                               // the waterline at H-hour
  const station = x => { const i = ci(x), o = {}; FIELDS.forEach(f => { o[f] = col[f][i]; }); o.draw = drawI[i] >= 0 ? D.DRAWS[drawI[i]] : null; o.drawK = drawK[i]; return o; };
  // the z of the shingle (the high-water line), the foot and the top of the bluffs at x (inland is +z)
  const shingleZ = x => { const i = ci(x); return col.zs[i] + col.sand[i] + 1.5; };
  const bluffFootZ = x => { const i = ci(x); return col.zs[i] + col.sand[i] + 3 + col.shelf[i]; };
  const bluffTopZ = x => { const i = ci(x); return col.zs[i] + col.sand[i] + 3 + col.shelf[i] + col.bw[i]; };
  const sectorAt = x => D.SECTORS.find(q => x >= q.x0 && x < q.x1) || null;

  // ---- the beach obstacles: sim data (fixed layout; per-round state: alive) ----
  const obstacles = [];
  function buildObstacles() {
    const r = prng(606), O = D.OBSTACLES; obstacles.length = 0;
    for (const row of O.rows) for (let x = O.x0 + r() * row.dx; x < O.x1; x += row.dx * (0.75 + r() * 0.5)) {
      const i = ci(x); if (col.flat[i] < 20) continue;               // only on the beach's tidal flat
      const s = row.s * col.flat[i] / 36 + (r() - 0.5) * 3, z = col.zs[i] - s;
      obstacles.push({ i: obstacles.length, kind: row.kind, x, z, s, y: heightRaw(x, z), heading: (r() - 0.5) * 0.5, mined: r() < row.mined, alive: true });
    }
  }
  function resetObstacles() { for (const o of obstacles) o.alive = true; }

  // the colour of the ground (terrain.js floor mesh; null: the default ramps). slope: |grad h| (rise per u)
  const C = {}, tmp = new THREE.Color();
  function cc(k, hex) { return C[k] || (C[k] = WW.pastel(hex, 0.08)); }
  function color(x, z, h, slope) {
    const i = ci(x), s = col.zs[i] - z;
    // a June morning under cloud on the Channel coast, not a coral island: dull grey sand, wet and darker where the tide
    // left it, grey stones, olive and khaki grass, the sea bed a murky grey-green under the water
    if (s >= 0) { const d = -h; return tmp.copy(cc('wet', 0x8f8870)).lerp(cc('bedM', 0x6d705e), WW.clamp(d / 1.5, 0, 1)).lerp(cc('bedD', 0x4f5a52), WW.clamp((d - 1.5) / 6, 0, 1)); }
    const u = -s, sand = col.sand[i], b0 = sand + 3 + col.shelf[i], b1 = b0 + col.bw[i], rk = col.rock[i];
    if (u < sand) return tmp.copy(cc('sandW', 0x9d9478)).lerp(cc('sand', 0xbdb08e), WW.clamp(u / Math.max(1, sand * 0.6), 0, 1));
    if (u < sand + 3) return tmp.copy(cc('shingle', 0x8f8b82));
    if (u < b0) return tmp.copy(cc('shelf', 0x7a7c58));
    if (slope > 0.9 && rk > 0.3) return tmp.copy(cc('rock', 0xa39a84)).lerp(cc('rockD', 0x857d6c), WW.clamp((slope - 0.9) / 2, 0, 1));
    if (u < b1 + 2) return tmp.copy(cc('bluff', 0x75794f)).lerp(cc('scrub', 0x5c6242), WW.clamp(slope / 1.5, 0, 1));
    if (Math.abs(x - D.HOC.x) < 40 && Math.abs(z - D.HOC.z - 6) < 36) return tmp.copy(cc('hoc', 0x847a60));   // the cratered point
    // the plateau: a patchwork of fields (a fixed hash of a slightly rotated field grid)
    const fx = Math.floor((x * 0.98 + z * 0.2) / 46), fz = Math.floor((z * 0.98 - x * 0.2) / 34);
    const hsh = ((fx * 73856093) ^ (fz * 19349663)) >>> 0, k = hsh % 5;
    return tmp.copy(cc('f' + k, [0x667545, 0x737d4c, 0x898459, 0x5f6c43, 0x7c8150][k]));
  }

  function build(k) {
    kit = k;
    if (!built) { buildColumns(); buildCraters(); built = true; }
    buildObstacles();
  }
  // the floor mesh's skirts past the map (terrain.js): [x0, z0, x1, z1, step]
  const waterExtent = (W, H, M) => [-1400, -M, W + 2800, H + 1100 + M];
  const skirts = (W, H, M) => [[-1400, H + M - 6, W + 1400, H + 1100, 6], [-1400, 800, -M + 6, H + M, 6], [W + M - 6, 800, W + 1400, H + M, 6]];
  WW.normandyTerrain = { build, heightRaw, color, skirts, waterExtent, shoreZ, station, shingleZ, bluffFootZ, bluffTopZ, sectorAt, seaDepth,
    obstacles, resetObstacles, VEX, get craters() { return craters; } };
  WW.scenarios.normandy.terrain = WW.normandyTerrain;
  WW.on('roundStart', () => { if (WW.isScn('normandy')) resetObstacles(); });
})(window.WW);
