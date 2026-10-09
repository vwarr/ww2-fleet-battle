// base_life_paths.js - WW.baseLifePaths: the ways round the island base for its people and its trucks (visual only:
// no randomness, nothing feeds the sim). A 1 u grid in site-local u / v (airfield_layout.js) over the whole island:
//  - walls: the solid buildings of the camp (base.decor) and the facilities (their models' footprints), the revetment
//    berms and the parked planes' hardstands, the sea. Pits, trenches, the laundry line and the drill ground are open.
//  - cost: people keep off the taxi network (x3) and the runways (x6) unless it is the only way; trucks use the network
//    (x1.5) and keep a wider berth from the walls.
//  - path(x0, z0, x1, z1, veh): the cheapest way (A*, 8 neighbours), pulled straight where the line is clear;
//    world points, cached; at most 2 new ones a frame (path() returns undefined: ask again). The ends are snapped to the nearest open cell (a caller adds its own last steps).
window.WW = window.WW || {};
(function () {
  'use strict';
  const U0 = -130, V0 = -115, NU = 261, NV = 231, N = NU * NV, MAXEXP = 240000;
  let G = null, budget = 2;
  const ST = { ms: 0, n: 0 };   // planning cost (all new paths so far)   // new (uncached) paths per frame: a crowd starting at once spreads its planning over frames
  const id = (i, j) => j * NU + i;

  // a rotated rectangle (site-local centre u, v; yaw from the u axis; half extents) stamped into a grid
  function stamp(arr, val, u, v, yaw, hx, hz, pad) {
    const c = Math.cos(yaw), s = Math.sin(yaw), R = Math.hypot(hx, hz) + pad;
    for (let dj = Math.floor(v - R); dj <= Math.ceil(v + R); dj++) for (let di = Math.floor(u - R); di <= Math.ceil(u + R); di++) {
      const du = di - u, dv = dj - v, a = du * c + dv * s, b = -du * s + dv * c;
      if (Math.abs(a) > hx + pad || Math.abs(b) > hz + pad) continue;
      const i = di - U0, j = dj - V0; if (i < 0 || j < 0 || i >= NU || j >= NV) continue;
      if (arr[id(i, j)] < val) arr[id(i, j)] = val;
    }
  }
  function build(b, built) {
    const L = b.layout, AL = WW.airfieldLayout, S = b.site;
    const wall = new Uint8Array(N), vwall = new Uint8Array(N), cost = new Uint8Array(N), vcost = new Uint8Array(N);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const u = U0 + i, v = V0 + j, w = L.toW(u, v), d = WW.terrain.depthAt(w.x, w.z), k = id(i, j);
      if (!(d < -0.35)) { wall[k] = vwall[k] = 1; continue; }
      if (d < -2.6) { vwall[k] = 1; cost[k] = 3; continue; }        // the hillside: people only
      const run = (Math.abs(u) < 47 && Math.abs(v) < AL.RUN_HALF_W + 1.5) || L.crossD(u, v) < AL.RUN_HALF_W + 1.5;
      const net = run || AL.onNetwork(L, u, v, 0);
      cost[k] = run ? 6 : net ? 3 : 1; vcost[k] = run ? 4 : net ? 1 : 2;
    }
    const site = (x, z) => L.toL(x, z);
    for (const d of b.decor || []) { if (d.solid) stamp(wall, 1, d.u, d.v, d.a - S.h, d.hx, d.hz, 0.8); if (d.kind !== 'drill' && d.kind !== 'yard') stamp(vwall, 1, d.u, d.v, d.a - S.h, d.hx, d.hz, 1.0); }
    if (built) for (const part of built.parts) {
      if (part.decor || !part.mesh) continue;
      const k = part.f.kind; if (k === 'aa' || k === 'battery') { const q = site(part.f.x, part.f.z); stamp(vwall, 1, q.u, q.v, 0, 3.5, 3.5, 0.5); continue; }
      const m = part.mesh, g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, h = -m.rotation.y, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const q = site(m.position.x + Math.cos(h) * cx - Math.sin(h) * cz, m.position.z + Math.sin(h) * cx + Math.cos(h) * cz);
      stamp(wall, 1, q.u, q.v, h - S.h, (bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2, 0.8);
      stamp(vwall, 1, q.u, q.v, h - S.h, (bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2, 1.0);
    }
    for (const sp of L.spots) { // the hardstand (a plane parks there) and its berms
      const yaw = sp.h - S.h;
      stamp(wall, 1, sp.u, sp.v, yaw, sp.len / 2 + 0.3, sp.span / 2 + 0.3, 0.2); stamp(vwall, 1, sp.u, sp.v, yaw, sp.len / 2 + 0.3, sp.span / 2 + 0.3, 0.8);
      for (const w of WW.baseModels.revetWalls(sp)) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        stamp(wall, 1, sp.u + c * w[0] - s * w[1], sp.v + s * w[0] + c * w[1], yaw - w[4], w[2] / 2, w[3] / 2, 0.35);
        stamp(vwall, 1, sp.u + c * w[0] - s * w[1], sp.v + s * w[0] + c * w[1], yaw - w[4], w[2] / 2, w[3] / 2, 0.9);
      }
    }
    // exact footprints (site-local rects) for spot checks finer than the grid: [u, v, yaw, hx, hz]
    const rects = [];
    for (const d of b.decor || []) if (d.kind !== 'drill' && d.kind !== 'yard') rects.push([d.u, d.v, d.a - S.h, d.hx, d.hz, d.solid ? 1 : 0]);
    if (built) for (const part of built.parts) {
      if (part.decor || !part.mesh || part.f.kind === 'aa' || part.f.kind === 'battery') continue;
      const m = part.mesh, g = m.geometry, bb = g.boundingBox, h = -m.rotation.y, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const q = site(m.position.x + Math.cos(h) * cx - Math.sin(h) * cz, m.position.z + Math.sin(h) * cx + Math.cos(h) * cz);
      rects.push([q.u, q.v, h - S.h, (bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2, 1]);
    }
    for (const sp of L.spots) rects.push([sp.u, sp.v, sp.h - S.h, sp.len / 2 + 1.6, sp.span / 2 + 1.6, 1]);   // a revetment and its berms
    // the exact footprints on a 0.5 u grid (people: pad 0.35, vehicles: pad 1.0): the straight-leg test reads these
    const fine = new Uint8Array(N * 4);
    const fstamp = (r, pad, bit) => {
      const c = Math.cos(r[2]), sn = Math.sin(r[2]), R2 = Math.hypot(r[3], r[4]) + pad;
      for (let v2 = Math.floor((r[1] - R2) * 2); v2 <= Math.ceil((r[1] + R2) * 2); v2++) for (let u2 = Math.floor((r[0] - R2) * 2); u2 <= Math.ceil((r[0] + R2) * 2); u2++) {
        const du = u2 / 2 - r[0], dv = v2 / 2 - r[1];
        if (Math.abs(du * c + dv * sn) > r[3] + pad || Math.abs(-du * sn + dv * c) > r[4] + pad) continue;
        const i = u2 - 2 * U0, j = v2 - 2 * V0; if (i < 0 || j < 0 || i >= NU * 2 || j >= NV * 2) continue;
        fine[j * NU * 2 + i] |= bit;
      }
    };
    for (const r of rects) { if (r[5]) fstamp(r, 0.35, 1); fstamp(r, 1.0, 2); }
    G = { base: b, L, wall, vwall, cost, vcost, rects, fine, cache: new Map(), made: 0 };
    return G;
  }
  function cell(u, v) { const i = Math.round(u - U0), j = Math.round(v - V0); return i < 0 || j < 0 || i >= NU || j >= NV ? -1 : id(i, j); }
  function open(x, z, veh) { if (!G) return false; const q = G.L.toL(x, z), c = cell(q.u, q.v); return c >= 0 && !(veh ? G.vwall : G.wall)[c]; }
  // a place to stand (finer than the grid): on land and outside every solid footprint by pad (default 0.25)
  function stand(x, z, pad, veh) {
    if (!G || !(WW.terrain.depthAt(x, z) < -0.35)) return false;
    const q = G.L.toL(x, z), p = pad === undefined ? 0.25 : pad;
    for (const r of G.rects) { if (!veh && !r[5]) continue; const du = q.u - r[0], dv = q.v - r[1], c = Math.cos(r[2]), s = Math.sin(r[2]); if (Math.abs(du * c + dv * s) < r[3] + p && Math.abs(-du * s + dv * c) < r[4] + p) return false; }
    return true;
  }
  // the nearest open cell to a site-local point (rings out to r), or -1
  function snap(u, v, W, r) {
    const c0 = cell(u, v); if (c0 >= 0 && !W[c0]) return c0;
    for (let d = 1; d <= (r || 4); d++) for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
      const c = cell(u + di, v + dj); if (c >= 0 && !W[c]) return c;
    }
    return -1;
  }
  // a straight leg clear of walls (sampled every 0.3 u), and not cheaper to go round (no shortcut across a runway)
  function clear(a, b, W, C, veh) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3), c0 = C[cell(a[0], a[1])] || 1;
    for (let k = 1; k <= n; k++) {
      const u = a[0] + (b[0] - a[0]) * k / n, v = a[1] + (b[1] - a[1]) * k / n, c = cell(u, v);
      if (c < 0 || W[c] || C[c] > Math.max(c0, C[cell(b[0], b[1])] || 1)) return false;
      const fi = Math.round(u * 2) - 2 * U0, fj = Math.round(v * 2) - 2 * V0;           // the exact footprints too
      if (fi < 0 || fj < 0 || fi >= NU * 2 || fj >= NV * 2 || (G.fine[fj * NU * 2 + fi] & (veh ? 2 : 1))) return false;
    }
    return true;
  }
  // a straight world leg clear of the footprints (people: pad 0.3; vehicles: wider)
  function legOK(x0, z0, x1, z1, veh) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25);
    for (let k = 0; k <= n; k++) if (!stand(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n, veh ? 0.9 : 0.3, veh)) return false;
    return true;
  }
  // binary heap of [cost, cell]
  // -> world points, null (no way) or undefined (over this frame's budget: ask again next frame; force: never)
  function path(x0, z0, x1, z1, veh, force) {
    if (!G) return null;
    const L = G.L, W = veh ? G.vwall : G.wall, C = veh ? G.vcost : G.cost, a = L.toL(x0, z0), b = L.toL(x1, z1);
    const s = snap(a.u, a.v, W, 5), t = snap(b.u, b.v, W, 6); if (s < 0 || t < 0) return null;
    const key = (veh ? 'v' : 'w') + s + ':' + t;
    if (G.cache.has(key)) return G.cache.get(key);
    if (!force && budget <= 0) return undefined;
    budget--; const t0 = performance.now();
    const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), hc = [], hk = [];
    const push = (c, k) => { hc.push(c); hk.push(k); let i = hc.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hc[p] <= hc[i]) break; [hc[p], hc[i]] = [hc[i], hc[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; } };
    const pop = () => { const c = hc[0], k = hk[0], lc = hc.pop(), lk = hk.pop(); if (hc.length) { hc[0] = lc; hk[0] = lk; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hc.length && hc[l] < hc[m]) m = l; if (r < hc.length && hc[r] < hc[m]) m = r; if (m === i) break; [hc[m], hc[i]] = [hc[i], hc[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; } } return [c, k]; };
    const ti = t % NU, tj = (t - ti) / NU, hr = k => { const i = k % NU, dx = Math.abs(i - ti), dy = Math.abs((k - i) / NU - tj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); }; // A*: octile distance x the lowest cost
    dist[s] = 0; push(hr(s), s); let exp = 0, found = false;
    while (hc.length && exp++ < MAXEXP) {
      const [f, k] = pop(), d = dist[k]; if (f > d + hr(k) + 1e-3) continue;
      if (k === t) { found = true; break; }
      const i = k % NU, j = (k - i) / NU;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a2 = i + di, b2 = j + dj; if (a2 < 0 || b2 < 0 || a2 >= NU || b2 >= NV) continue;
        const n = id(a2, b2); if (W[n]) continue;
        if (di && dj && (W[id(i + di, j)] || W[id(i, j + dj)])) continue;   // no squeezing past a corner
        const nd = d + (di && dj ? 1.414 : 1) * (C[n] || 1);
        if (nd < dist[n]) { dist[n] = nd; prev[n] = k; push(nd + hr(n), n); }
      }
    }
    let out = null;
    if (found) {
      const P = []; for (let k = t; k >= 0; k = prev[k]) { const i = k % NU; P.push([i + U0, (k - i) / NU + V0]); }
      P.reverse();
      const S = [P[0]];
      for (let i = 0; i < P.length - 1;) { let j = Math.min(P.length - 1, i + 30); while (j > i + 1 && !clear(P[i], P[j], W, C, veh)) j--; S.push(P[j]); i = j; }
      out = S.map(q => L.toW(q[0], q[1]));
    }
    G.cache.set(key, out); G.made++; ST.ms += performance.now() - t0; ST.n++;
    return out;
  }
  WW.baseLifePaths = { ST, build, path, open, stand, legOK, frame: () => { budget = 2; }, get grid() { return G; }, clear: () => { G = null; } };
})();
