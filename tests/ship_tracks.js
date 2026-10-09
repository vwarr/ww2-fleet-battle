// Top-down ship track maps from a ship_review trace (tests/ship_review.js --trace SCEN:SEED): ship tracks with the
// commander's stations overlaid, one panel per time window. Renders an SVG to PNG in headless Chrome (no game).
//   overview: the whole map, tracks of the window, hulls at the window's end (to scale), stations as hollow circles
//             with a dashed line from each ship to its station, armed bombers as small dots (blue USN, red IJN).
//   zoom:     a box of SIZE units that follows one side's formation (the centroid of its carrier group, else its
//             main body), hull outlines every 5 s (spacing and the group's turns read off them), main-battery fire
//             as thin orange lines from the shooter to its target, the phase of that side in the panel title.
// Usage: CHROMIUM=<headless shell> node tests/ship_tracks.js tests/shots/ship_trace_SCEN_SEED.json
//          [--win 60] [--from 0] [--to 720] [--zoom USN|IJN] [--size 520] [--follow ID] [--out FILE] [--cols 3]
// Trace row: [t, id, nation U/I, type, phase, x, z, heading, sx, sz, role, targetId, ringCvId, firedAtId, length, beam]
const fs = require('fs');
const { chromium } = require('playwright');
const A = process.argv.slice(2), file = A[0], arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const WIN = +arg('--win', 60), FROM = +arg('--from', 0), TO = +arg('--to', 1e9), ZOOM = arg('--zoom', null), SIZE = +arg('--size', 520), FOLLOW = arg('--follow', null);
const J = JSON.parse(fs.readFileSync(file, 'utf8')), rows = J.rows, air = J.air || [];
const MW = 2400, MH = 1350;
const OUT = arg('--out', file.replace(/\.json$/, ZOOM ? `_${ZOOM}${FOLLOW ? '_' + FOLLOW : ''}.png` : '.png'));
const COLS = +arg('--cols', ZOOM ? 3 : 2);
const PW = ZOOM ? 420 : 600, PH = ZOOM ? 420 : Math.round(600 * MH / MW);
const NC = { U: ['#1f4e9c', '#6d93d6'], I: ['#b3261e', '#e0837d'] };
const tEnd = Math.min(TO, Math.max(...rows.map(r => r[0])));
const byT = new Map(); for (const r of rows) { if (!byT.has(r[0])) byT.set(r[0], []); byT.get(r[0]).push(r); }
const times = [...byT.keys()].sort((a, b) => a - b);
function hull(r, sx, ox, oz, cls, op) {   // oriented rectangle with a pointed bow, to scale
  const L = r[14] || 10, B = Math.max(1.2, r[15] || 2), c = Math.cos(r[7]), s = Math.sin(r[7]);
  const pts = [[L / 2, 0], [L * 0.3, B / 2], [-L / 2, B / 2], [-L / 2, -B / 2], [L * 0.3, -B / 2]].map(([a, b]) => [((r[5] + a * c - b * s) - ox) * sx, ((r[6] + a * s + b * c) - oz) * sx]);
  return `<polygon points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" class="${cls}" opacity="${op}"/>`;
}
const panels = [];
for (let t0 = FROM; t0 < tEnd; t0 += WIN) {
  const t1 = Math.min(t0 + WIN, tEnd), R = rows.filter(r => r[0] >= t0 && r[0] <= t1);
  if (!R.length) continue;
  let ox = 0, oz = 0, sc = PW / MW, title = `${t0}-${t1} s`;
  const last = R.filter(r => r[0] === Math.max(...R.map(q => q[0])));
  if (ZOOM) {   // follow the side's carrier group / main body centroid at the window's middle
    const tm = times.reduce((b, t) => (Math.abs(t - (t0 + t1) / 2) < Math.abs(b - (t0 + t1) / 2) ? t : b), times[0]);
    const nat = ZOOM === 'USN' ? 'U' : 'I', at = byT.get(tm).filter(r => r[2] === nat && r[4] !== 'sinking');
    let g = FOLLOW ? at.filter(r => String(r[1]) === FOLLOW) : at.filter(r => r[3] === 'carrier' || r[12] !== null);
    if (!g.length) g = at.filter(r => r[10] === 'line');
    if (!g.length) g = at.filter(r => r[3] !== 'pt' && r[3] !== 'submarine');
    if (!g.length) continue;
    const cx = g.reduce((a, r) => a + r[5], 0) / g.length, cz = g.reduce((a, r) => a + r[6], 0) / g.length;
    sc = PW / SIZE; ox = cx - SIZE / 2; oz = cz - SIZE / 2;
    const ph = {}; for (const r of R) if (r[2] === nat) ph[r[4]] = (ph[r[4]] || 0) + 1;
    title += '  ' + Object.keys(ph).filter(k => k !== 'sinking').sort((a, b) => ph[b] - ph[a]).join(' / ');
  }
  const X = x => ((x - ox) * sc).toFixed(1), Z = z => ((z - oz) * sc).toFixed(1);
  let g = `<rect x="0" y="0" width="${PW}" height="${PH}" fill="#eef3f8" stroke="#99a"/>`;
  if (ZOOM) { const step = 26 * 2 * sc; for (let k = 0; k * step < PW; k++) g += `<line x1="${(k * step).toFixed(1)}" y1="0" x2="${(k * step).toFixed(1)}" y2="${PH}" stroke="#dde5ee" stroke-width="0.5"/><line x1="0" y1="${(k * step).toFixed(1)}" x2="${PW}" y2="${(k * step).toFixed(1)}" stroke="#dde5ee" stroke-width="0.5"/>`; }
  // armed bombers
  for (const a of air) if (a[0] >= t0 && a[0] <= t1) g += `<circle cx="${X(a[3])}" cy="${Z(a[4])}" r="${ZOOM ? 1.4 : 0.9}" fill="${a[1] === 'U' ? '#4a7fd9' : '#d9534f'}" opacity="0.5"/>`;
  // tracks
  const by = new Map(); for (const r of R) { if (!by.has(r[1])) by.set(r[1], []); by.get(r[1]).push(r); }
  for (const [, P] of by) {
    const c = NC[P[0][2]][P[0][3] === 'carrier' || P[0][3] === 'battleship' || P[0][3] === 'cruiser' ? 0 : 1];
    g += `<path d="${P.map((r, i) => (i ? 'L' : 'M') + X(r[5]) + ' ' + Z(r[6])).join(' ')}" stroke="${c}" stroke-width="${ZOOM ? 1 : 0.8}" fill="none" opacity="0.7"/>`;
    if (ZOOM) for (const r of P) if (Math.round(r[0]) % 5 === 0 && r !== P[P.length - 1]) g += hull(r, sc, ox, oz, P[0][2] === 'U' ? 'hu' : 'hi', 0.25);
    if (ZOOM) for (const r of P) if (r[13] !== null) { const tg = (byT.get(r[0]) || []).find(q => q[1] === r[13]); if (tg) g += `<line x1="${X(r[5])}" y1="${Z(r[6])}" x2="${X(tg[5])}" y2="${Z(tg[6])}" stroke="#f29900" stroke-width="0.6" opacity="0.45"/>`; }
  }
  // ships at the window's end, stations
  for (const r of last) {
    const c = NC[r[2]][0];
    if (r[8] !== null && r[3] !== 'pt' && r[3] !== 'submarine' && r[4] !== 'sinking') g += `<line x1="${X(r[5])}" y1="${Z(r[6])}" x2="${X(r[8])}" y2="${Z(r[9])}" stroke="${c}" stroke-width="0.7" stroke-dasharray="3,2" opacity="0.8"/><circle cx="${X(r[8])}" cy="${Z(r[9])}" r="${ZOOM ? 4 : 2.5}" fill="none" stroke="${c}" stroke-width="1"/>`;
    if (ZOOM) g += hull(r, sc, ox, oz, r[4] === 'sinking' ? 'hs' : r[2] === 'U' ? 'hu' : 'hi', 1);
    else { const big = r[3] === 'carrier' ? 4 : r[3] === 'battleship' || r[3] === 'cruiser' ? 3 : 2; g += `<circle cx="${X(r[5])}" cy="${Z(r[6])}" r="${big}" fill="${r[4] === 'sinking' ? '#000' : c}"/>`; if (r[3] === 'carrier') g += `<rect x="${+X(r[5]) - 5}" y="${+Z(r[6]) - 5}" width="10" height="10" fill="none" stroke="${c}" stroke-width="1.5"/>`; }
    if (ZOOM && r[3] !== 'pt') g += `<text x="${+X(r[5]) + 6}" y="${+Z(r[6]) - 4}" font-size="8" font-family="sans-serif" fill="${c}">${r[3][0].toUpperCase()}${r[3] === 'carrier' ? 'V' : r[3] === 'battleship' ? 'B' : r[3] === 'cruiser' ? 'A' : r[3] === 'destroyer' ? 'D' : ''} ${r[10] || ''}</text>`;
  }
  g += `<text x="6" y="14" font-size="12" font-family="sans-serif">${title}</text>`;
  panels.push(g);
}
const W0 = PW + 10, H0 = PH + 10, rowsN = Math.ceil(panels.length / COLS);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * W0}" height="${rowsN * H0 + 36}" style="background:#fff"><style>.hu{fill:#1f4e9c}.hi{fill:#b3261e}.hs{fill:#000}</style>`;
svg += `<defs><clipPath id="pc"><rect x="0" y="0" width="${PW}" height="${PH}"/></clipPath></defs>`;
panels.forEach((g, i) => { svg += `<g transform="translate(${(i % COLS) * W0 + 5},${Math.floor(i / COLS) * H0 + 5})"><g clip-path="url(#pc)">${g}</g></g>`; });
svg += `<text x="10" y="${rowsN * H0 + 14}" font-size="11" font-family="sans-serif">${J.scen}${J.label ? ' (' + J.label + ')' : ''} seed ${J.seed}: USN blue, IJN red; hollow circle + dashed line = the commander's station; dots = armed bombers${ZOOM ? '; faint hulls every 5 s; orange = gunfire; grid 2 L (52 u); ' + ZOOM + ' formation, ' + SIZE + ' u box' : ''}</text>`;
svg += `<text x="10" y="${rowsN * H0 + 29}" font-size="11" font-family="sans-serif">labels: CV carrier, BB battleship, CA cruiser, DD destroyer, then the commander's role (escort, line, asw, torpedo, withdraw, sortie)</text></svg>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: COLS * W0, height: rowsN * H0 + 36 } });
  await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await p.screenshot({ path: OUT });
  await b.close();
  console.log('tracks: ' + OUT + ' (' + panels.length + ' panels)');
})();
