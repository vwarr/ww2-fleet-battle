// Top-down track plots from a plane_moves trace (node tests/plane_moves.js --trace SCEN:SEED). Renders SVG to PNG in
// headless Chrome (no game, no server). Two images next to the trace:
//  - <trace>_strikes.png: the whole round; each strike wave's centroid track (USN blue, IJN red; a dot every 30 s
//    with the time), its planes' tracks faint, the ships' tracks grey, drops as crosses (scouts / homebound bombers
//    ringed), and the closest approach of every pair of opposing strikes in transit (dashed, labelled).
//  - <trace>_guns.png: fighter tracks (faint) with every burst coloured by the angle from the nose to the plane fired
//    at (green < 5 deg, yellow 5-10, orange 10-20, red > 20), plus close-ups of the four busiest dogfights: the
//    shooter's track 6 s before, the target's track, and a line from each burst to its target.
// Usage: CHROMIUM=<headless shell> node tests/plane_tracks.js tests/shots/planes/trace_SCEN_SEED.json [outPrefix]
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const file = process.argv[2], pre = process.argv[3] || file.replace(/\.json$/, '');
const J = JSON.parse(fs.readFileSync(file, 'utf8')), rows = J.rows, bursts = J.bursts || [], waves = J.waves || [], drops = J.drops || [];
const NC = { U: '#1f5fbf', J: '#c0392b', USN: '#1f5fbf', IJN: '#c0392b' };
const angCol = a => (a < 5 ? '#1e9e3a' : a < 10 ? '#e0b000' : a < 20 ? '#f07b00' : '#d01010');
let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
for (const r of rows) { x0 = Math.min(x0, r[5]); x1 = Math.max(x1, r[5]); z0 = Math.min(z0, r[6]); z1 = Math.max(z1, r[6]); }
const byId = new Map(); for (const r of rows) { if (!byId.has(r[1])) byId.set(r[1], []); byId.get(r[1]).push(r); }
const path = (L, S, ox, oz) => L.map((r, i) => (i && Math.hypot(r[5] - L[i - 1][5], r[6] - L[i - 1][6]) < 60 ? 'L' : 'M') + ((r[5] - ox) * S).toFixed(1) + ' ' + ((r[6] - oz) * S).toFixed(1)).join(' ');

function shipLayer(S, ox, oz, t0, t1) {
  let g = '';
  for (const [id, L0] of byId) {
    if (id >= 0) continue;
    const L = L0.filter(r => r[0] >= t0 && r[0] <= t1); if (!L.length) continue;
    const e = L[L.length - 1], c = NC[e[2]], big = e[3] === 'carrier' ? 4 : e[3] === 'battleship' || e[3] === 'cruiser' ? 3 : 2;
    g += `<path d="${path(L, S, ox, oz)}" stroke="${c}" stroke-width="1" fill="none" opacity="0.35"/><circle cx="${((e[5] - ox) * S).toFixed(1)}" cy="${((e[6] - oz) * S).toFixed(1)}" r="${big}" fill="${e[4] === 'sinking' ? '#000' : c}" opacity="0.7"/>`;
    if (e[3] === 'carrier') g += `<rect x="${((e[5] - ox) * S - 5).toFixed(1)}" y="${((e[6] - oz) * S - 5).toFixed(1)}" width="10" height="10" fill="none" stroke="${c}" stroke-width="1.5"/>`;
  }
  return g;
}

function strikes() {
  const W = 1500, S = W / (x1 - x0 + 40), H = (z1 - z0 + 40) * S, ox = x0 - 20, oz = z0 - 20;
  let g = `<rect x="0" y="0" width="${W}" height="${H}" fill="#eef3f8"/>` + shipLayer(S, ox, oz, 0, 1e9);
  // the strike planes (rows with a wave id), faint
  for (const [id, L] of byId) {
    if (id < 0) continue;
    const M = L.filter(r => r[8] > 0 && r[4][0] === 't'); if (M.length < 2) continue;
    g += `<path d="${path(M, S, ox, oz)}" stroke="${NC[M[0][2]]}" stroke-width="0.5" fill="none" opacity="0.18"/>`;
  }
  const wv = new Map(); for (const r of waves) { if (!wv.has(r[1])) wv.set(r[1], []); wv.get(r[1]).push(r); }
  const P = (r) => [((r[3] - ox) * S).toFixed(1), ((r[4] - oz) * S).toFixed(1)];
  for (const [id, L] of wv) {
    const c = NC[L[0][2]], seg = (Q, w, o, da) => { if (Q.length < 2) return; const d = Q.map((r, i) => (i && Math.hypot(r[3] - Q[i - 1][3], r[4] - Q[i - 1][4]) < 40 && r[0] - Q[i - 1][0] < 1.1 ? 'L' : 'M') + P(r).join(' ')).join(' '); g += `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" opacity="${o}" ${da ? 'stroke-dasharray="' + da + '"' : ''}/>`; };
    seg(L.filter(r => r[5]), 2.6, 0.85); seg(L.filter(r => !r[5]), 1.1, 0.6, '3 3');   // in transit thick; over the target thin dashed
    for (const r of L) if (Math.abs(r[0] / 30 - Math.round(r[0] / 30)) < 0.009) { const [x, y] = P(r); g += `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/><text x="${+x + 4}" y="${+y - 3}" font-size="9" fill="${c}" font-family="sans-serif">${Math.round(r[0])}</text>`; }
    const e = L[L.length - 1], [ex, ey] = P(e); g += `<text x="${+ex + 4}" y="${+ey + 10}" font-size="10" font-weight="bold" fill="${c}" font-family="sans-serif">W${id}</text>`;
  }
  // the closest approach of each pair of opposing waves while both were in transit
  const tr = waves.filter(r => r[5]), byT = new Map(); for (const r of tr) { if (!byT.has(r[0])) byT.set(r[0], []); byT.get(r[0]).push(r); }
  const best = new Map();
  for (const L of byT.values()) for (const a of L) for (const b of L) if (a[1] < b[1] && a[2] !== b[2]) { const k = a[1] + '|' + b[1], d = Math.hypot(a[3] - b[3], a[4] - b[4]); if (!best.has(k) || d < best.get(k).d) best.set(k, { d, a, b }); }
  for (const { d, a, b } of best.values()) {
    if (d > 400) continue;
    const [ax, ay] = P(a), [bx, by] = P(b);
    g += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#333" stroke-dasharray="4 3" stroke-width="1.2"/><text x="${(+ax + +bx) / 2 + 4}" y="${(+ay + +by) / 2}" font-size="11" font-family="sans-serif" fill="#222">${Math.round(d)} u @${Math.round(a[0])} s</text>`;
  }
  for (const d of drops) { const x = ((d[4] - ox) * S).toFixed(1), y = ((d[5] - oz) * S).toFixed(1), c = NC[d[2]]; g += `<path d="M${x - 3} ${y - 3}L${+x + 3} ${+y + 3}M${x - 3} ${+y + 3}L${+x + 3} ${y - 3}" stroke="${c}" stroke-width="1.4"/>`; if (d[3] === 'scout' || d[3] === 'home') g += `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#111" stroke-width="1.2"/>`; }
  g += `<text x="8" y="16" font-size="14" font-family="sans-serif">${J.scen} seed ${J.seed}${J.label ? ' (' + J.label + ')' : ''}: strike waves (centroid in transit thick, over the target dashed; a dot every 30 s), planes faint, ships thin; dashed = closest approach of opposing strikes in transit; x = drops (ringed: scout / homebound)</text>`;
  return { svg: g, W, H };
}

function guns() {
  const W = 1500, S = W / (x1 - x0 + 40), H0 = (z1 - z0 + 40) * S, ox = x0 - 20, oz = z0 - 20;
  let g = `<rect x="0" y="0" width="${W}" height="${H0}" fill="#f4f4ef"/>` + shipLayer(S, ox, oz, 0, 1e9);
  for (const [id, L] of byId) { if (id < 0 || L[0][3] !== 'f') continue; g += `<path d="${path(L, S, ox, oz)}" stroke="${NC[L[0][2]]}" stroke-width="0.5" fill="none" opacity="0.2"/>`; }
  for (const b of bursts) g += `<circle cx="${((b[3] - ox) * S).toFixed(1)}" cy="${((b[4] - oz) * S).toFixed(1)}" r="2.2" fill="${angCol(b[6])}" opacity="0.85"/>`;
  // the four busiest fights: 120 x 75 boxes, 6 s windows round the densest burst clusters (each burst counted once)
  const used = new Set(), zooms = [], BX = 60, BZ = 37, BT = 3;
  const inBox = (a, c) => Math.abs(a[0] - c[0]) < BT && Math.abs(a[3] - c[3]) < BX && Math.abs(a[4] - c[4]) < BZ;
  for (let k = 0; k < 4; k++) {
    let bi = -1, bn = 0;
    for (let i = 0; i < bursts.length; i++) { if (used.has(i)) continue; let n = 0; for (let j = 0; j < bursts.length; j++) if (!used.has(j) && inBox(bursts[j], bursts[i])) n++; if (n > bn) { bn = n; bi = i; } }
    if (bi < 0 || bn < 2) break;
    const c = bursts[bi], Z = { t: c[0], x: c[3], z: c[4], L: [] };
    for (let j = 0; j < bursts.length; j++) if (inBox(bursts[j], c)) { used.add(j); Z.L.push(bursts[j]); }
    zooms.push(Z);
  }
  const ZW = 740, ZS = ZW / (2 * BX), ZH = 2 * BZ * ZS;
  let z = `<defs><clipPath id="zc"><rect x="0" y="0" width="${ZW}" height="${ZH}"/></clipPath></defs>`;
  zooms.forEach((Z, i) => {
    const zx = (i % 2) * (ZW + 20), zy = H0 + 30 + Math.floor(i / 2) * (ZH + 30), zox = Z.x - BX, zoz = Z.z - BZ;
    const P = (x, y) => ((x - zox) * ZS).toFixed(1) + ' ' + ((y - zoz) * ZS).toFixed(1);
    let q = `<rect x="0" y="0" width="${ZW}" height="${ZH}" fill="#fbfbf6" stroke="#999"/>`;
    const sh = new Set(Z.L.map(b => b[1])), tg = new Set(Z.L.map(b => b[9])), t0 = Math.min(...Z.L.map(b => b[0])) - 3, t1 = Math.max(...Z.L.map(b => b[0])) + 1;
    for (const id of new Set([...sh, ...tg])) {
      const L = (byId.get(id) || []).filter(r => r[0] >= t0 && r[0] <= t1); if (L.length < 2) continue;
      q += `<path d="${path(L, ZS, zox, zoz)}" stroke="${NC[L[0][2]]}" stroke-width="${sh.has(id) ? 1.8 : 1.2}" fill="none" opacity="0.8" ${sh.has(id) ? '' : 'stroke-dasharray="4 3"'}/>`;
      const e = L[L.length - 1]; q += `<text x="${((e[5] - zox) * ZS + 3).toFixed(1)}" y="${((e[6] - zoz) * ZS).toFixed(1)}" font-size="10" fill="${NC[e[2]]}" font-family="sans-serif">${e[3] === 'f' ? 'F' : e[3].toUpperCase()}${id}</text>`;
    }
    for (const b of Z.L) {
      const c = angCol(b[6]), hx = b[3] + Math.cos(b[10]) * 8, hz = b[4] + Math.sin(b[10]) * 8;
      q += `<path d="M${P(b[3], b[4])}L${P(b[11], b[12])}" stroke="${c}" stroke-width="1.2" stroke-dasharray="2 2"/>`;   // to the plane fired at
      q += `<path d="M${P(b[3], b[4])}L${P(hx, hz)}" stroke="#111" stroke-width="2"/>`;                                     // the nose
      q += `<circle cx="${((b[3] - zox) * ZS).toFixed(1)}" cy="${((b[4] - zoz) * ZS).toFixed(1)}" r="4" fill="${c}" stroke="#222" stroke-width="0.5"/>`;
      q += `<circle cx="${((b[11] - zox) * ZS).toFixed(1)}" cy="${((b[12] - zoz) * ZS).toFixed(1)}" r="2.5" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    }
    q += `<text x="6" y="14" font-size="12" font-family="sans-serif">t ${Math.round(t0)}-${Math.round(t1)} s, ${Z.L.length} bursts; solid = shooters, dashed = targets; black tick = nose, dotted = to the plane fired at</text>`;
    z += `<g transform="translate(${zx},${zy})"><g clip-path="url(#zc)">${q}</g></g>`;
  });
  const lg = [['< 5 deg', 2], ['5-10', 7], ['10-20', 15], ['> 20', 30]].map(([k, a], i) => `<circle cx="${20 + i * 90}" cy="${H0 + 14}" r="5" fill="${angCol(a)}"/><text x="${30 + i * 90}" y="${H0 + 18}" font-size="12" font-family="sans-serif">${k}</text>`).join('');
  const on = bursts.filter(b => b[6] < 10 && b[7] < 28).length;
  g += `<text x="8" y="16" font-size="14" font-family="sans-serif">${J.scen} seed ${J.seed}: fighter tracks and gun bursts by angle off the nose to the plane fired at (${bursts.length} bursts, ${Math.round(100 * on / Math.max(1, bursts.length))}% inside 10 deg and gun range)</text>`;
  return { svg: g + lg + z, W, H: H0 + 40 + Math.ceil(zooms.length / 2) * (ZH + 30) };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  for (const [name, f] of [['strikes', strikes], ['guns', guns]]) {
    const { svg, W, H } = f();
    const p = await b.newPage({ viewport: { width: Math.ceil(W), height: Math.ceil(H) } });
    await p.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff">${svg}</svg></body></html>`);
    const out = `${pre}_${name}.png`;
    await p.screenshot({ path: out });
    await p.close();
    console.log('tracks: ' + out);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
