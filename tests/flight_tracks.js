// Top-down track maps from a flight_review trace: plane paths coloured by phase, ships as grey / blue / red
// lines with a dot at the window's end, one panel per time window. Shows circling, loners, the strike streams and
// where the fleets are when the planes arrive. Renders an SVG to PNG in headless Chrome (no game, no server).
// Usage: node tests/flight_review.js --trace carrier_duel:2      (writes tests/shots/flight_trace_carrier_duel_2.json)
//        CHROMIUM=<headless shell> node tests/flight_tracks.js tests/shots/flight_trace_carrier_duel_2.json [window=60] [maxT=360]
// Output: the same path with .png (all panels in one image).
const fs = require('fs');
const { chromium } = require('playwright');
const file = process.argv[2], WIN = +(process.argv[3] || 60), MAXT = +(process.argv[4] || 360);
const J = JSON.parse(fs.readFileSync(file, 'utf8')), rows = J.rows;
const W = 960, H = 600, S = 0.5;   // map units, panel scale
const COL = { cap: '#9aa0a6', escort_tgt: '#c58af9', pattern: '#f29900', deck: '#000', takeoff: '#5f6368', formup: '#a142f4', transit: '#1a73e8', approach: '#1a73e8', search: '#12b5cb',
  recall: '#12b5cb', intercept: '#fbbc04', dogfight: '#fbbc04', wheel: '#ea4335', dive: '#d93025', pullout: '#d93025', anvil: '#ea4335', torprun: '#d93025', popup: '#d93025', level: '#ea4335', return: '#34a853' };
const tEnd = Math.min(MAXT, Math.max(...rows.map(r => r[0])));
const panels = [];
for (let t0 = 0; t0 < tEnd; t0 += WIN) {
  const t1 = t0 + WIN, R = rows.filter(r => r[0] >= t0 && r[0] < t1);
  const by = new Map(); for (const r of R) { if (!by.has(r[1])) by.set(r[1], []); by.get(r[1]).push(r); }
  let g = `<rect x="0" y="0" width="${W * S}" height="${H * S}" fill="#eef3f8" stroke="#99a"/>`;
  for (const [id, L] of by) {
    if (id < 0) { // ship
      const c = L[0][2] === 'U' ? '#1f4e9c' : '#b3261e', d = L.map((r, i) => (i ? 'L' : 'M') + (r[5] * S).toFixed(1) + ' ' + (r[7] * S).toFixed(1)).join(' '), e = L[L.length - 1];
      const big = e[3] === 'carrier' ? 4 : e[3] === 'battleship' || e[3] === 'cruiser' ? 3 : 2;
      g += `<path d="${d}" stroke="${c}" stroke-width="1.2" fill="none" opacity="0.6"/><circle cx="${e[5] * S}" cy="${e[7] * S}" r="${big}" fill="${e[4] === 'sinking' ? '#000' : c}"/>`;
      if (e[3] === 'carrier') g += `<rect x="${e[5] * S - 5}" y="${e[7] * S - 5}" width="10" height="10" fill="none" stroke="${c}" stroke-width="1.5"/>`;
      continue;
    }
    if (L[0][4].startsWith('o_')) continue; // scouts / flying boats
    let seg = '', ph = null, out = '';
    const flush = () => { if (seg) out += `<path d="${seg}" stroke="${COL[ph] || '#555'}" stroke-width="${ph === 'cap' || ph === 'pattern' ? 0.7 : 1.1}" fill="none" opacity="0.85"/>`; };
    for (let i = 0; i < L.length; i++) {
      const r = L[i], x = (r[5] * S).toFixed(1), z = (r[7] * S).toFixed(1);
      if (r[4] !== ph || (i && Math.hypot(r[5] - L[i - 1][5], r[7] - L[i - 1][7]) > 40)) { flush(); seg = 'M' + x + ' ' + z; ph = r[4]; }
      else seg += 'L' + x + ' ' + z;
    }
    flush(); g += out;
  }
  g += `<text x="6" y="14" font-size="12" font-family="sans-serif">${t0}-${t1} s</text>`;
  panels.push(g);
}
const cols = 2, PW = W * S + 10, PH = H * S + 10, rowsN = Math.ceil(panels.length / cols);
const legend = Object.entries({ 'CAP': 'cap', 'landing pattern': 'pattern', 'form-up': 'formup', 'transit': 'transit', 'fight': 'intercept', 'attack': 'dive', 'return': 'return', 'escort over target': 'escort_tgt', 'search': 'search' })
  .map(([k, v], i) => `<rect x="${10 + i * 105}" y="${rowsN * PH + 6}" width="12" height="4" fill="${COL[v]}"/><text x="${26 + i * 105}" y="${rowsN * PH + 12}" font-size="10" font-family="sans-serif">${k}</text>`).join('');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * PW}" height="${rowsN * PH + 40}" style="background:#fff">`;
svg += `<defs><clipPath id="pc"><rect x="0" y="0" width="${W * S}" height="${H * S}"/></clipPath></defs>`;
panels.forEach((g, i) => { svg += `<g transform="translate(${(i % cols) * PW + 5},${Math.floor(i / cols) * PH + 5})"><g clip-path="url(#pc)">${g}</g></g>`; });
svg += legend + `<text x="10" y="${rowsN * PH + 30}" font-size="10" font-family="sans-serif">${J.scen} seed ${J.seed}; USN blue ships, IJN red; squares = carriers</text></svg>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: cols * PW, height: rowsN * PH + 40 } });
  await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  const out = file.replace(/\.json$/, '.png');
  await p.screenshot({ path: out });
  await b.close();
  console.log('tracks: ' + out + ' (' + panels.length + ' panels)');
})();
