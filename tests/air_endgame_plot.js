// Plots from an air endgame trace (node tests/air_endgame.js --trace SCEN:SEED [--dt 5]). SVG rendered to PNG in
// headless Chrome (no game, no server). Three images next to the trace:
//  - <trace>_roles.png: the side's planes by role over the endgame (stacked counts per sample), daylight marked.
//  - <trace>_top_T.png: top-down at time T: every ship (USN blue, IJN red, carriers boxed) and the side's planes
//    coloured by role, plus a close-up round each carrier of the side.
//  - <trace>_side_T.png: side view at time T for each of the side's carriers: every plane within 400 of it plotted
//    by distance along the carrier's axis (astern to the left) against altitude, by role (the marshal stack's levels
//    STACK0 15 + 4 u, the CAP bands ~30 / ~62-66, the strike stack ~30 / ~54 / ~70 as guides).
// Usage: CHROMIUM=<headless shell> node tests/air_endgame_plot.js tests/shots/airdiag/trace_SCEN_SEED.json [NATION=USN] [T=auto]
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const file = process.argv[2], N = process.argv[3] || 'USN';
const J = JSON.parse(fs.readFileSync(file, 'utf8')), rec = J.rec, pre = file.replace(/\.json$/, '');
const rows = rec.rows.filter(r => r[2] === N), pos = rec.pos.filter(p => p[7] === N);
const COL = { marshal: '#8e44ad', groove: '#d35400', deck: '#7f8c8d', cap: '#27ae60', cap_eng: '#145a32', escort: '#16a085', formup: '#f1c40f',
  strike: '#2980b9', attack: '#c0392b', return: '#e67e22', search: '#34495e', strafe: '#e84393', bomber_dry: '#bdc3c7', bomber_idle: '#000' };
const ORDER = ['attack', 'strike', 'escort', 'formup', 'strafe', 'search', 'cap_eng', 'cap', 'return', 'marshal', 'groove', 'deck', 'bomber_dry', 'bomber_idle'];
const times = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b);
const fly = new Map(rec.ships.filter(s => s[1] === N).map(s => [s[0], s[8]]));
// T: the sample with the largest marshal stack, unless given
let T = +process.argv[4];
if (!T) { let best = -1; for (const t of times) { const k = rows.filter(r => r[0] === t && r[4] === 'marshal').length; if (k > best) { best = k; T = t; } } }
const legend = (x, y) => ORDER.map((k, i) => `<rect x="${x}" y="${y + i * 18}" width="12" height="12" fill="${COL[k]}"/><text x="${x + 18}" y="${y + i * 18 + 11}" font-size="13" font-family="sans-serif">${k}</text>`).join('');

function rolesChart() {
  const W = 1400, H = 520, L = 60, B = 40, w = (W - L - 180) / Math.max(1, times.length), maxN = Math.max(...times.map(t => rows.filter(r => r[0] === t).length));
  const ky = (H - B - 20) / maxN;
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  times.forEach((t, i) => {
    const x = L + i * w; if (!fly.get(t)) g += `<rect x="${x}" y="10" width="${w + 0.5}" height="${H - B - 10}" fill="#dfe6f0"/>`;
    let y = H - B; const by = {}; for (const r of rows) if (r[0] === t) by[r[4]] = (by[r[4]] || 0) + 1;
    for (const k of ORDER.slice().reverse()) if (by[k]) { const h = by[k] * ky; y -= h; g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(w + 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="${COL[k]}"/>`; }
    if (i % Math.ceil(times.length / 12) === 0) g += `<text x="${x}" y="${H - B + 16}" font-size="12" font-family="sans-serif">${t}s</text>`;
  });
  for (let n = 0; n <= maxN; n += 20) g += `<line x1="${L - 4}" x2="${W - 180}" y1="${H - B - n * ky}" y2="${H - B - n * ky}" stroke="#0002"/><text x="${L - 30}" y="${H - B - n * ky + 4}" font-size="12" font-family="sans-serif">${n}</text>`;
  g += `<text x="${L}" y="${H - 6}" font-size="13" font-family="sans-serif">${N} planes by role, ${J.scen} seed ${J.seed} (grey-blue background: dark, no launches)</text>` + legend(W - 160, 20);
  return { W, H, g };
}
function topDown() {
  const P = pos.filter(p => p[0] === T), R = rows.filter(r => r[0] === T);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of P) { x0 = Math.min(x0, p[4]); x1 = Math.max(x1, p[4]); z0 = Math.min(z0, p[5]); z1 = Math.max(z1, p[5]); }
  for (const r of R) { x0 = Math.min(x0, r[5]); x1 = Math.max(x1, r[5]); z0 = Math.min(z0, r[6]); z1 = Math.max(z1, r[6]); }
  const W = 1400, S = (W - 200) / (x1 - x0 + 80), H = Math.max(500, (z1 - z0 + 80) * S + 30), ox = x0 - 40, oz = z0 - 40;
  let g = `<rect width="${W}" height="${H}" fill="#eef3f8"/>`;
  for (const p of P) { const c = p[2] === 'USN' ? '#1f5fbf' : '#c0392b', x = (p[4] - ox) * S, y = (p[5] - oz) * S; g += `<circle cx="${x}" cy="${y}" r="${p[3] === 'carrier' ? 5 : 3}" fill="${c}"/>`; if (p[3] === 'carrier') g += `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" fill="none" stroke="${c}" stroke-width="1.5"/>`; }
  for (const r of R) g += `<circle cx="${((r[5] - ox) * S).toFixed(1)}" cy="${((r[6] - oz) * S).toFixed(1)}" r="2.2" fill="${COL[r[4]] || '#000'}" opacity="0.85"/>`;
  g += `<text x="10" y="${H - 8}" font-size="14" font-family="sans-serif">${J.scen} ${J.seed}, t = ${T} s, ${N}: ${R.length} planes; ${R.filter(r => r[4] === 'marshal').length} in the marshal stacks${fly.get(T) ? '' : ' (dark)'}</text>` + legend(W - 160, 20);
  return { W, H, g };
}
function sideView() {
  const CV = pos.filter(p => p[0] === T && p[3] === 'carrier' && p[2] === N), R = rows.filter(r => r[0] === T);
  const PW = 1300, PH = 330, H = CV.length * (PH + 30) + 20, W = 1500;
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  CV.forEach((c, i) => {
    const y0 = 20 + i * (PH + 30), ch = Math.cos(c[6]), sh = Math.sin(c[6]), sx = PW / 800, sy = (PH - 30) / 90;   // along: -600..+200, altitude 0..90
    g += `<rect x="40" y="${y0}" width="${PW}" height="${PH - 30}" fill="#f4f7fb" stroke="#0003"/>`;
    for (let a = 0; a <= 90; a += 10) g += `<line x1="40" x2="${40 + PW}" y1="${y0 + PH - 30 - a * sy}" y2="${y0 + PH - 30 - a * sy}" stroke="#0001"/><text x="8" y="${y0 + PH - 30 - a * sy + 4}" font-size="11" font-family="sans-serif">${a}</text>`;
    for (let a = 15; a <= 75; a += 4) g += `<line x1="40" x2="${40 + PW}" y1="${y0 + PH - 30 - a * sy}" y2="${y0 + PH - 30 - a * sy}" stroke="#8e44ad22" stroke-dasharray="3 5"/>`;
    const cx = 40 + 600 * sx; g += `<rect x="${cx - 13 * sx}" y="${y0 + PH - 30 - 6 * sy}" width="${26 * sx}" height="${6 * sy}" fill="#1f5fbf"/><text x="${cx - 30}" y="${y0 + PH - 12}" font-size="12" font-family="sans-serif">carrier ${c[1]} (bow to the right)</text>`;
    let n = 0;
    for (const r of R) {
      const dx = r[5] - c[4], dz = r[6] - c[5], u = dx * ch + dz * sh, v = -dx * sh + dz * ch;
      if (u < -600 || u > 200 || Math.abs(v) > 300) continue; n++;
      g += `<circle cx="${(40 + (u + 600) * sx).toFixed(1)}" cy="${(y0 + PH - 30 - r[7] * sy).toFixed(1)}" r="3" fill="${COL[r[4]] || '#000'}" opacity="0.8"/>`;
    }
    for (let u = -600; u <= 200; u += 100) g += `<text x="${40 + (u + 600) * sx - 10}" y="${y0 + PH - 12}" font-size="11" font-family="sans-serif">${u}</text>`;
    g += `<text x="50" y="${y0 + 16}" font-size="13" font-family="sans-serif">side view, ${J.scen} ${J.seed} t = ${T} s: ${n} planes within 600 astern / 200 ahead / 300 abeam of carrier ${c[1]} (x: u along the ship axis, y: altitude)</text>`;
  });
  return { W, H: H + 10, g: g + legend(W - 160, 20) };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }), p = await b.newPage();
  for (const [name, f] of [['roles', rolesChart], ['top_' + T, topDown], ['side_' + T, sideView]]) {
    const { W, H, g } = f();
    await p.setViewportSize({ width: Math.ceil(W), height: Math.ceil(H) });
    await p.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g}</svg></body></html>`);
    const out = `${pre}_${N}_${name}.png`; await p.screenshot({ path: out }); console.log(out);
  }
  await b.close();
})();
