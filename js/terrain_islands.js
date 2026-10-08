// terrain_islands.js: the island layout of a map (WW.terrainIslands), used by terrain.js. Loads before terrain.js.
// Each map has 1-3 substantial islands and a few islets, sandbars and reefs:
//  - 'atoll' maps (60%): a Midway-style reef ring (a submerged crest with foam, a shallow lagoon inside, one shallow
//    channel) holding a low sandy island and a flat 'field' island with the airfield, and a volcanic island elsewhere.
//  - 'volcanic' maps (40%): one big volcanic island with the airfield on a coastal plain on its flank (a terrace cut
//    by the pad), fringing reefs, and a second, smaller island.
// The airfield pad (runways + apron) is flattened to PAD_H so the base (island_base.js) sits on flat land. All of
// it comes from terrain.js's own seeded generator (never WW.rand), and the depth grid is built from it in both modes.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const PAD_H = 1.2;                 // airfield ground height above the sea
  const RUN1 = 86, RUN2 = 60, RUN_W = 4.5, X_ANG = 0.95; // main / cross runway lengths, half width, crossing angle
  // shelf: width (units) of the shallow ledge outside the coast; drop: width of the slope down to deep water
  const SHELF = { island: [6, 20], low: [8, 18], field: [8, 18], islet: [4, 15], spit: [3, 9], bar: [2.5, 7], reef: [3, 10] };
  let K = null;                      // terrain.js helpers: { rnd, rr, vnoise, smooth, BASE }
  let features = [], centres = [], pads = [], site = null;

  function add(kind, cx, cz, rx, rz, rot, peak, fixed) {
    const f = { kind, cx, cz, rx, rz, c: Math.cos(rot), s: Math.sin(rot), rot, peak, fixed: !!fixed };
    features.push(f);
    return f;
  }
  // a centre at least `gap` from the main features already placed (else the farthest of 40 tries)
  function spot(x0, x1, z0, z1, gap) {
    let best = null, bestD = -1;
    for (let k = 0; k < 40; k++) {
      const x = K.rr(x0, x1), z = K.rr(z0, z1);
      let d = 1e9;
      for (const c of centres) d = Math.min(d, Math.hypot(x - c[0], z - c[1]) - c[2]);
      if (d >= gap) { best = [x, z]; break; }
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    centres.push([best[0], best[1], 0]);
    return best;
  }

  // ---- the airfield: two crossing runways and an apron, on a flat 'field' island ----
  function rect(cx, cz, h, hl, hw) { return { cx, cz, c: Math.cos(h), s: Math.sin(h), hl, hw }; }
  function airfield(cx, cz, h, kind, extra) {
    const c = Math.cos(h), s = Math.sin(h), h2 = h + X_ANG, o2 = 14;   // the cross runway crosses the main one 14 ahead of its centre
    const r2x = cx + c * o2, r2z = cz + s * o2;
    const ap = 17;                                                     // apron along the main runway, on its +lateral side
    pads = [rect(cx, cz, h, RUN1 / 2 + 4, RUN_W + 3), rect(r2x, r2z, h2, RUN2 / 2 + 4, RUN_W + 3),
      rect(cx - c * 6 - s * ap, cz - s * 6 + c * ap, h, 30, 10)];
    site = Object.assign({ kind, x: cx, z: cz, h, padH: PAD_H, apron: { x: cx - c * 6 - s * ap, z: cz - s * 6 + c * ap, h },
      runways: [{ x: cx, z: cz, h, len: RUN1, w: RUN_W * 2 }, { x: r2x, z: r2z, h: h2, len: RUN2, w: RUN_W * 2 }] }, extra || {});
    // the flat island under it: long along the main runway, wide enough for the cross runway and the apron
    return add('field', cx - s * 6, cz + c * 6, RUN1 / 2 + 15, 40, h, PAD_H + 0.5, true);
  }

  function makeAtoll() {
    const R = K.rr(115, 128), cx = K.rr(W * 0.37, W * 0.63), cz = K.rr(R + 75, H - R - 75);
    const ring = add('ring', cx, cz, R, R, 0, -0.85, true);
    ring.w = 7; ring.gapA = K.rr(0, Math.PI * 2); ring.lagoon = -3.4;
    centres.push([cx, cz, R + 40]);
    // Eastern Island (the field) and Sand Island inside the ring, roughly opposite each other
    const a1 = K.rr(0, Math.PI * 2), d1 = R * 0.38, fx = cx + Math.cos(a1) * d1, fz = cz + Math.sin(a1) * d1;
    const h = a1 + Math.PI / 2 + K.rr(-0.5, 0.5);   // the main runway roughly along the ring
    airfield(fx, fz, h, 'atoll', { atoll: { x: cx, z: cz, R } });
    const a2 = a1 + Math.PI + K.rr(-0.6, 0.6), d2 = R * 0.42;
    add('low', cx + Math.cos(a2) * d2, cz + Math.sin(a2) * d2, R * K.rr(0.42, 0.5), R * K.rr(0.26, 0.32), a2 + Math.PI / 2 + K.rr(-0.4, 0.4), 2.4, true);
    if (K.rnd() < 0.55) add('islet', cx + Math.cos(a1 + 1.7) * R * 0.55, cz + Math.sin(a1 + 1.7) * R * 0.55, 6, 5, K.rr(0, 3), 1.6, true); // a sandy cay
    second(220);
  }
  function makeVolcanic() {
    const rx = K.rr(58, 70), rz = rx * K.rr(0.7, 0.85), rot = K.rr(0, Math.PI);
    const cx = K.rr(W * 0.4, W * 0.6), cz = K.rr(rz + 120, H - rz - 120);
    add('island', cx, cz, rx, rz, rot, K.rr(9, 12), true);
    centres.push([cx, cz, rx + 30]);
    // the field on the flank: a coastal plain a little outside the island's long axis
    const side = K.rnd() < 0.5 ? 1 : -1, a = rot + Math.PI / 2 * side + K.rr(-0.4, 0.4), d = rz * 0.85;
    let h = rot + K.rr(-0.25, 0.25);
    if (-Math.sin(h) * Math.cos(a) + Math.cos(h) * Math.sin(a) < 0) h += Math.PI; // the apron side (+lateral) faces the sea, not the mountain
    airfield(cx + Math.cos(a) * d, cz + Math.sin(a) * d, h, 'volcanic', { island: { x: cx, z: cz } });
    for (let i = 0; i < 2; i++) { // fringing reefs off the far side
      const b = a + Math.PI + K.rr(-1, 1), r = rx + K.rr(14, 24);
      add('reef', cx + Math.cos(b) * r, cz + Math.sin(b) * r, K.rr(8, 14), K.rr(4, 7), b + Math.PI / 2, K.rr(-2.2, -1.3), true);
    }
    second(200);
  }
  // a second, smaller volcanic island away from the first
  function second(gap) {
    const [x, z] = spot(185, W - 185, 90, H - 90, gap), r = K.rr(30, 44);
    add('island', x, z, r * K.rr(0.8, 1.2), r * K.rr(0.6, 0.9), K.rr(0, Math.PI), K.rr(4, 8));
    if (K.rnd() < 0.5) { const a = K.rr(0, Math.PI * 2), len = r * K.rr(1.1, 1.6); add('spit', x + Math.cos(a) * len * 0.7, z + Math.sin(a) * len * 0.7, len * 0.6, K.rr(2, 3.2), a, K.rr(0.5, 1.2)); }
  }
  function make(k) {
    K = k; features = []; centres = []; pads = []; site = null;
    if (K.rnd() < 0.6) makeAtoll(); else makeVolcanic();
    const nSmall = 3 + Math.floor(K.rnd() * 3);
    for (let i = 0; i < nSmall; i++) { const [x, z] = spot(150, W - 150, 30, H - 30, 70); add('islet', x, z, K.rr(5, 9), K.rr(4, 8), K.rr(0, 3), K.rr(1.5, 3.5)); }
    const nBar = 1 + Math.floor(K.rnd() * 3);
    for (let i = 0; i < nBar; i++) {
      const edge = K.rnd() < 0.35, top = K.rnd() < 0.5; // a bar may sit near the top/bottom edges anywhere
      const [cx, cz] = edge ? spot(40, W - 40, top ? 10 : H - 35, top ? 35 : H - 10, 50) : spot(140, W - 140, 30, H - 30, 50);
      add('bar', cx, cz, K.rr(8, 18), K.rr(1.5, 2.5), K.rr(0, Math.PI), K.rr(-0.4, 0.4));
    }
    const nReef = 2 + Math.floor(K.rnd() * 3);
    for (let i = 0; i < nReef; i++) { const [x, z] = spot(130, W - 130, 20, H - 20, 50); add('reef', x, z, K.rr(5, 10), K.rr(3, 7), K.rr(0, 3), K.rr(-2.6, -1.4)); }
    return { features, site };
  }

  // ---- heights ----
  function ringHeight(f, x, z) {
    const dx = x - f.cx, dz = z - f.cz, d0 = Math.hypot(dx, dz), R = f.rx, BASE = K.BASE;
    if (d0 > R + 45) return -99;
    const d = d0 + (K.vnoise(x * 0.04 + 70, z * 0.04 + 70) - 0.5) * 7;   // a wobbly crest line
    let crest = f.peak;
    const ga = Math.abs(WW.angleDiff(Math.atan2(dz, dx), f.gapA));
    if (ga < 0.12) crest = WW.lerp(-1.9, crest, ga / 0.12);                 // the channel: deeper, still too shallow for a ship
    const e = d - R, hw = f.w * 0.5;
    if (Math.abs(e) < hw) return crest - 0.25 * (e / hw) * (e / hw);
    if (e > 0) { const t = e - hw; return t < 4 ? crest - 0.25 - t * 0.5 : WW.lerp(crest - 2.25, -BASE - 4, K.smooth(4, 34, t)); }
    return WW.lerp(crest - 0.25, f.lagoon, K.smooth(0, 9, -e - hw)) + (K.vnoise(x * 0.09, z * 0.09) - 0.5) * 0.9; // lagoon floor
  }
  function featureHeight(f, x, z, radScale) {
    if (f.kind === 'ring') return ringHeight(f, x, z);
    const dx = x - f.cx, dz = z - f.cz;
    const u = dx * f.c + dz * f.s, v = -dx * f.s + dz * f.c, k = f.fixed ? 1 : radScale;
    const rx = f.rx * k, rz = f.rz * k, rmin = Math.min(rx, rz);
    const sh = SHELF[f.kind];
    let n = Math.sqrt((u / rx) * (u / rx) + (v / rz) * (v / rz));
    if (n > (1 + (sh[0] + sh[1]) / rmin) / 0.75) return -99;
    n *= 0.88 + 0.24 * K.vnoise(x * 0.05 + 40, z * 0.05 + 40); // gently wobbly, rounded coast
    const shoreH = -0.7;
    if (n < 1) {
      if (f.peak < shoreH) return f.peak - 0.8 * n * n; // submerged reef: a gentle dome, no flat rim near the surface
      if (f.kind === 'field' || f.kind === 'low') // flat coral island: a quick rise from the beach to a low plateau
        return shoreH + (f.peak - shoreH) * K.smooth(1, 0.72, n) + (f.kind === 'low' ? 0.8 * K.smooth(0.6, 0, n) : 0);
      // soft rounded lump; the blend with a linear term keeps a real slope at the waterline (clean foam line)
      const t = 0.6 * K.smooth(1, 0.45, n) + 0.4 * WW.clamp((1 - n) / 0.55, 0, 1);
      return shoreH + (f.peak - shoreH) * t;
    }
    const e = (n - 1) * rmin; // approx distance from the coast
    if (e < sh[0]) return Math.min(f.peak, shoreH) - 2.8 * e / sh[0];
    return WW.lerp(Math.min(f.peak, shoreH) - 2.8, -K.BASE - 4, K.smooth(sh[0], sh[0] + sh[1], e));
  }
  // distance from (x, z) outside the nearest pad rectangle (0 inside)
  function padDist(x, z) {
    let best = 1e9;
    for (const p of pads) {
      const dx = x - p.cx, dz = z - p.cz, u = Math.abs(dx * p.c + dz * p.s) - p.hl, v = Math.abs(-dx * p.s + dz * p.c) - p.hw;
      const e = Math.hypot(Math.max(0, u), Math.max(0, v));
      if (e < best) best = e;
    }
    return best;
  }
  // the pad: flat ground at PAD_H, blended into the island over 10 units
  function flatten(h, x, z) {
    if (!pads.length) return h;
    const e = padDist(x, z);
    if (e >= 10) return h;
    return WW.lerp(h, PAD_H, K.smooth(10, 0, e));
  }

  WW.terrainIslands = { make, featureHeight, flatten, padDist, PAD_H, get site() { return site; }, get features() { return features; } };
})(window.WW);
