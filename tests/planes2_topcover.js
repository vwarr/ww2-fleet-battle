// Top cover distance from its target ship, before vs after (planes2 round 2, Fable F23): every trace row of an escort
// fighter with a strike target ship (carrier / battleship / cruiser), no foe, above 45 u and within 200 u of the
// target, binned by its horizontal distance from the target; the target's heavy-flak radius at the plane's height
// (2.2 x aa.range in 3D, core.js aa ranges) marks inside vs outside. Traces: node tests/planes2_review.js --trace ...
// Usage: CHROMIUM=<headless shell> node tests/planes2_topcover.js before1.json,before2.json after1.json,after2.json out.png
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const AA = { carrier: 45, battleship: 40, cruiser: 42 };
function collect(files) {
  const H = new Array(20).fill(0); let n = 0, inside = 0;
  for (const f of files.split(',')) {
    const J = JSON.parse(fs.readFileSync(f, 'utf8')), ships = new Map();
    for (const r of J.rows) if (r[1] < 0) { if (!ships.has(r[1])) ships.set(r[1], []); ships.get(r[1]).push(r); }
    const at = (L, t) => { let b = null; for (const r of L) { if (r[0] > t + 2) break; b = r; } return b; };
    for (const r of J.rows) {
      if (r[1] < 0 || r[3] !== 'f' || r[12] || !r[13] || r[7] <= 45 || !/x/.test(r[4].slice(1))) continue;
      const L = ships.get(r[13]); if (!L || !AA[L[0][3]]) continue;
      const s = at(L, r[0]); if (!s) continue;
      const d = Math.hypot(r[5] - s[5], r[6] - s[6]); if (d > 200) continue;
      const fr = AA[L[0][3]] * 2.2;
      n++; if (Math.hypot(d, r[7]) < fr) inside++;
      H[Math.min(19, Math.floor(d / 10))]++;
    }
  }
  return { H, n, inside };
}
const B = collect(process.argv[2]), A = collect(process.argv[3]), out = process.argv[4] || 'topcover.png';
const W = 760, Hh = 360, bw = 32, X0 = 60, Y0 = 300, mx = Math.max(...B.H.map(v => v / Math.max(1, B.n)), ...A.H.map(v => v / Math.max(1, A.n)));
let g = `<text x="${X0}" y="22" font-size="14">Top cover (no foe, above 45 u) distance from its target ship: before vs after round 2</text>`;
g += `<text x="${X0}" y="40" font-size="11">before: ${B.n} samples, inside the heavy flak ${(100 * B.inside / Math.max(1, B.n)).toFixed(0)}%   |   after: ${A.n} samples, inside ${(100 * A.inside / Math.max(1, A.n)).toFixed(0)}%</text>`;
for (let i = 0; i < 20; i++) {
  const hb = B.H[i] / Math.max(1, B.n) / mx * 220, ha = A.H[i] / Math.max(1, A.n) / mx * 220, x = X0 + i * bw;
  g += `<rect x="${x + 2}" y="${Y0 - hb}" width="13" height="${hb}" fill="#9aa0a6"/><rect x="${x + 16}" y="${Y0 - ha}" width="13" height="${ha}" fill="#1a73e8"/>`;
  if (i % 2 === 0) g += `<text x="${x}" y="${Y0 + 14}" font-size="10">${i * 10}</text>`;
}
// heavy flak at 56 u: carrier 89, battleship 68, cruiser 73 u horizontal (sqrt((2.2 aa)^2 - 56^2))
for (const [t, r] of [['CA', 73], ['BB', 68], ['CV', 89]]) { const x = X0 + r / 10 * bw; g += `<line x1="${x}" x2="${x}" y1="${Y0 - 235}" y2="${Y0}" stroke="#d93025" stroke-dasharray="4 3"/><text x="${x + 2}" y="${Y0 - 238}" font-size="10" fill="#d93025">${t} flak</text>`; }
g += `<line x1="${X0}" x2="${X0 + 20 * bw}" y1="${Y0}" y2="${Y0}" stroke="#333"/><text x="${X0}" y="${Y0 + 30}" font-size="11">horizontal distance from the target ship (u); grey = before, blue = after; dashed red = heavy-flak edge at 56 u height</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" font-family="sans-serif" style="background:#fff">${g}</svg>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: W, height: Hh } });
  await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await p.screenshot({ path: out }); await b.close();
  console.log(`topcover: ${out}  before n ${B.n} inside ${B.inside}  after n ${A.n} inside ${A.inside}`);
})();
