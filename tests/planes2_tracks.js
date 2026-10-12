// Close-up track plots from a planes2_review trace (node tests/planes2_review.js --trace SCEN:SEED): one scene per PNG,
// a zoomed top-down panel round the event (plane paths coloured by what they are doing, ships grey-blue / red, event
// marks), the heights of the planes in the window against time (stations a few hundred feet apart, not a ladder), and
// the heading rate and roll of the key planes against time (no teleport-like turns). Renders an SVG in headless Chrome.
// Usage: CHROMIUM=<headless shell> node tests/planes2_tracks.js <trace.json> <scene> [t0 t1]
//   scene: cover   a CAP fighter taking on a bomber on its run at a destroyer / PT / cripple of its side
//          alert   the ready deck alert flight against a harasser (the 'alert' event)
//          escort  a damaged plane with a wingman on the way home (the 'escortHome' event)
//          ditch   a plane ditching beside a friendly ship (the 'ditchBy' event)
//          cap     CAP stations round a carrier (heights)
//   [t0 t1] pick the window by hand; otherwise the first good event is used. Output: <trace>_<scene>.png
// Trace rows: planes [t, id, U/J, kind0, st, x, z, y, heading, roll, hp, speed, foeId, -targetId];
//             ships  [t, -id, U/J, type, ok/crip/sinking, x, z, 0, heading, 0, hp, 0, 0, -targetId]
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const file = process.argv[2], scene = process.argv[3] || 'cover';
const J = JSON.parse(fs.readFileSync(file, 'utf8')), rows = J.rows, EV = J.ev || [];
const planes = new Map(), ships = new Map();
for (const r of rows) { const m = r[1] < 0 ? ships : planes; if (!m.has(r[1])) m.set(r[1], []); m.get(r[1]).push(r); }
const at = (L, t) => { let b = null; for (const r of L) { if (r[0] > t + 0.6) break; b = r; } return b; };
const shipType = id => { const L = ships.get(id); return L ? L[0][3] : null; };

// ---------- pick the scene: window, centre, key planes ----------
function pick() {
  let t0 = +process.argv[4], t1 = +process.argv[5], key = [], cx, cz, R = 160, marks = [], rings = [], title = '';
  const manual = isFinite(t0) && isFinite(t1);
  if (scene === 'cover') {
    // an enemy armed bomber with a non-carrier ship as its target, a fighter of the ship's side with that bomber as its foe
    let best = null;
    for (const [id, L] of planes) for (const r of L) {
      if ((r[3] !== 'd' && r[3] !== 't') || !r[13] || !/x/.test(r[4])) continue;
      const ty = shipType(r[13]); if (!ty || ty === 'carrier') continue;
      if (manual && (r[0] < t0 || r[0] > t1)) continue;
      const s = at(ships.get(r[13]) || [], r[0]); if (!s || Math.hypot(s[5] - r[5], s[6] - r[6]) > 300) continue;
      let f = null;
      for (const [fid, F] of planes) { if (F[0][2] === r[2] || F[0][3] !== 'f') continue; const q = at(F, r[0]); if (q && q[12] === id && Math.abs(q[0] - r[0]) < 0.6) { f = fid; break; } }
      if (!f) continue;
      // a clear scene: the fighter came out to the ship (30 s before it was >= 100 away), few other planes around it
      const f0 = at(planes.get(f), r[0] - 30); if (!f0 || Math.hypot(f0[5] - s[5], f0[6] - s[6]) < 100) continue;
      // ... and reached the raider (within 30 u) inside 30 s
      let tc = null; for (const q of planes.get(f)) { if (q[0] < r[0] || q[0] > r[0] + 30) continue; const u = at(L, q[0]); if (u && Math.abs(u[0] - q[0]) < 0.6 && Math.hypot(u[5] - q[5], u[6] - q[6]) < 30) { tc = q[0]; break; } }
      if (tc === null) continue;
      let crowd = 0; for (const L of planes.values()) { const q = at(L, r[0]); if (q && Math.abs(q[0] - r[0]) < 0.6 && Math.hypot(q[5] - s[5], q[6] - s[6]) < 170) crowd++; }
      const sc = (ty === 'destroyer' ? 100 : ty === 'pt' ? 90 : 50) + (s[4] === 'crip' ? 20 : 0) + (r[2] === 'J' ? 15 : 0) - crowd * 2;
      if (!best || sc > best.sc) best = { sc, t: r[0], tc, raider: id, fighter: f, ship: r[13], ty };
    }
    if (!best) throw new Error('no cover scene in this trace');
    if (!manual) { t0 = best.t - 35; t1 = best.tc + 12; }
    const s = at(ships.get(best.ship), best.t), f0 = at(planes.get(best.fighter), t0) || planes.get(best.fighter)[0];
    const mq = at(planes.get(best.fighter), best.tc); cx = (s[5] + mq[5] + f0[5]) / 3; cz = (s[6] + mq[6] + f0[6]) / 3; R = Math.max(150, Math.hypot(s[5] - cx, s[6] - cz) + 40, Math.hypot(mq[5] - cx, mq[6] - cz) + 40, Math.hypot(f0[5] - cx, f0[6] - cz) + 20);
    key = [best.fighter, best.raider];
    marks.push({ t: best.t, x: s[5], z: s[6], txt: best.ty + ' under attack' });
    { const q = at(planes.get(best.fighter), best.tc); marks.push({ t: best.tc, x: q[5], z: q[6], txt: 'fighter on the raider' }); }
    title = `CAP covering a ${best.ty}: fighter #${best.fighter} on raider #${best.raider} at t=${best.t}`;
  } else if (scene === 'alert') {
    const e = EV.find(e => e.k === 'alert' && (!manual || (e.t >= t0 && e.t <= t1))); if (!e) throw new Error('no alert event');
    const AL = [...planes].filter(([id, L]) => L.some(r => r[0] >= e.t && r[0] < e.t + 60 && /a/.test(r[4].slice(1)) && r[13] === e.tg)).map(([id]) => id);
    const tg = e.tg, S = ships.get(tg) || [];
    let tDrop = null; for (const d of EV) if (d.k === 'drop' && d.t >= e.t && AL.includes(d.id)) { tDrop = tDrop === null ? d.t : tDrop; marks.push({ t: d.t, x: d.x, z: d.z, txt: 'drop' }); }
    if (!manual) { t0 = e.t - 5; t1 = (tDrop || e.t + 60) + 25; }
    const s0 = at(S, e.t) || at(S, e.t + 5); const cvRow = AL.length ? planes.get(AL[0]).find(r => r[0] >= e.t) : null;
    cx = s0 ? (s0[5] + (cvRow ? cvRow[5] : s0[5])) / 2 : 0; cz = s0 ? (s0[6] + (cvRow ? cvRow[6] : s0[6])) / 2 : 0;
    R = s0 && cvRow ? Math.max(140, Math.hypot(s0[5] - cvRow[5], s0[6] - cvRow[6]) * 0.75) : 300;
    key = AL.slice(0, 4);
    const h = EV.find(x => x.k === 'harass' && Math.abs(x.s) === Math.abs(tg) && x.t <= e.t + 1);
    if (s0) marks.push({ t: e.t, x: s0[5], z: s0[6], txt: 'alert: ' + (shipType(tg) || '?') + (h ? ' (harassing since ' + h.t + ' s)' : '') });
    title = `Ready deck alert: ${AL.length} planes at a ${shipType(tg) || '?'} (t=${e.t})`;
  } else if (scene === 'escort') {
    const L = EV.filter(e => e.k === 'escortHome' && (!manual || (e.t >= t0 && e.t <= t1)));
    // the pairing with the longest flight together
    let e = null, best = -1;
    for (const x of L) { const P = planes.get(Math.abs(x.tg)) || []; const n = P.filter(r => r[0] >= x.t && r[0] < x.t + 90).length; if (n > best) { best = n; e = x; } }
    if (!e) throw new Error('no escortHome event');
    const dmg = Math.abs(e.tg), wing = e.id, P = planes.get(dmg);
    const last = P[P.length - 1][0];
    if (!manual) { t0 = e.t - 15; t1 = Math.min(last, e.t + 100); }
    const W = P.filter(r => r[0] >= t0 && r[0] <= t1);
    const xs = W.map(r => r[5]), zs = W.map(r => r[6]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2; cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    R = Math.max(90, (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))) * 0.6);
    key = [dmg, wing];
    marks.push({ t: e.t, x: e.x, z: e.z, txt: 'wingman joins' });
    title = `Damaged plane #${dmg} escorted home by #${wing} (t=${e.t})`;
  } else if (scene === 'ditch') {
    const e = EV.find(e => e.k === 'ditchBy' && (!manual || (e.t >= t0 && e.t <= t1))); if (!e) throw new Error('no ditchBy event');
    const P = planes.get(e.id) || []; const last = P[P.length - 1][0];
    if (!manual) { t0 = e.t - 5; t1 = last + 3; }
    const end = P[P.length - 1]; cx = (e.x + end[5]) / 2; cz = (e.z + end[6]) / 2; R = Math.max(80, Math.hypot(e.x - end[5], e.z - end[6]) * 0.7);
    key = [e.id]; marks.push({ t: e.t, x: e.x, z: e.z, txt: 'ditch order' }, { t: last, x: end[5], z: end[6], txt: 'ditched' });
    title = `Plane #${e.id} ditching beside a ${shipType(e.tg) || 'ship'} (t=${e.t})`;
  } else if (scene === 'preempt') {
    // a fighter breaking off a dogfight (a fighter / an empty bomber) onto an armed raider (air_dogfight.js pick);
    // the first in the round: up to it the round is the same as before the change (KEYS= the same ids on the old trace)
    const L = EV.filter(e => e.k === 'preempt' && (!manual || (e.t >= t0 && e.t <= t1)));
    const e = +process.env.K ? L[+process.env.K - 1] : L[0]; if (!e) throw new Error('no preempt event');
    if (!manual) { t0 = e.t - 15; t1 = e.t + 20; }
    const f = at(planes.get(e.id), e.t); cx = f[5]; cz = f[6]; R = 130;
    key = [e.id, e.fr, Math.abs(e.tg)];
    marks.push({ t: e.t, x: f[5], z: f[6], txt: 'breaks off onto the raider' });
    title = `#${e.id} breaks off #${e.fr} (${(planes.get(e.fr) || [[0, 0, 0, '?']])[0][3]}) for armed raider #${Math.abs(e.tg)} (t=${e.t})`;
  } else if (scene === 'topcover') {
    // escorts circling over their strike's target ship while the bombers attack, with the target's heavy-flak ring at
    // the top cover's height (2.2 x aa.range in 3D: core.js aa ranges) and the old 45 u orbit dashed
    const AA = { carrier: 45, battleship: 40, cruiser: 42 };   // a destroyer's ring at 56 u (35 u) is inside the 45 u orbit anyway
    let best = null;
    for (const [id, L] of planes) {
      if (L[0][3] !== 'f') continue;
      let run = 0, r0 = null;
      for (const r of L) {
        const ty = r[13] ? shipType(r[13]) : null, sh = ty && AA[ty] ? at(ships.get(r[13]), r[0]) : null;
        const ok = sh && r[7] > 45 && !r[12] && /x/.test(r[4]) && Math.hypot(r[5] - sh[5], r[6] - sh[6]) < 140 && (!manual || (r[0] >= t0 && r[0] <= t1));
        if (ok) { if (!r0) r0 = r; run++; if (!best || run > best.run) best = { run, id, r0, t: r[0], ship: r[13], ty }; } else { run = 0; r0 = null; }
      }
    }
    if (!best) throw new Error('no top cover orbit in this trace');
    if (!manual) { t0 = best.r0[0]; t1 = best.t; }
    const sh = at(ships.get(best.ship), (t0 + t1) / 2); cx = sh[5]; cz = sh[6]; R = 150;
    key = [best.id]; for (const [id, L] of planes) if (id !== best.id && L[0][3] === 'f' && key.length < 4 && L.some(r => r[0] >= t0 && r[0] <= t1 && r[13] === best.ship && r[7] > 45 && Math.hypot(r[5] - sh[5], r[6] - sh[6]) < 140)) key.push(id);
    const fr = AA[best.ty] * 2.2, ry = Math.sqrt(Math.max(0, fr * fr - 56 * 56));
    rings.push({ x: sh[5], z: sh[6], r: ry, txt: 'heavy flak at 56 u (' + Math.round(ry) + ' u)', dash: false }, { x: sh[5], z: sh[6], r: 45, txt: 'old top cover orbit (45 u)', dash: true });
    title = `Top cover over the target ${best.ty} (t=${t0.toFixed(0)}-${t1.toFixed(0)})`;
  } else if (scene === 'climbjump') {
    // a fighter jumping a bomber climbing out of its field / off its deck ('jumpClimb' event)
    const L = EV.filter(e => e.k === 'jumpClimb' && (!manual || (e.t >= t0 && e.t <= t1)));
    const e = +process.env.K ? L[+process.env.K - 1] : L[0]; if (!e) throw new Error('no jumpClimb event');
    if (!manual) { t0 = e.t - 15; t1 = e.t + 20; }
    const f = at(planes.get(e.id), e.t), u = at(planes.get(Math.abs(e.tg)), e.t) || f; cx = (f[5] + u[5]) / 2; cz = (f[6] + u[6]) / 2; R = 140;
    key = [e.id, Math.abs(e.tg)];
    marks.push({ t: e.t, x: u[5], z: u[6], txt: 'bomber climbing out (y ' + Math.round(u[7]) + ')' });
    title = `#${e.id} jumps #${Math.abs(e.tg)} climbing out (t=${e.t})`;
  } else if (scene === 'keys') {
    // the given planes over the given window (KEYS=a,b,c, t0 t1): the same moment on another trace
    key = process.env.KEYS.split(',').map(Number);
    const f = at(planes.get(key[0]), (t0 + t1) / 2) || planes.get(key[0])[0]; cx = +process.env.CX || f[5]; cz = +process.env.CZ || f[6]; R = +process.env.R || 130;
    title = (process.env.TITLE || 'planes ' + key.join(', ')) + ` (t=${t0}-${t1})`;
  } else if (scene === 'cap') {
    if (!manual) { t0 = 60; t1 = 120; }
    const cv = [...ships.values()].find(L => L[0][3] === 'carrier' && L[0][2] === 'U') || [...ships.values()].find(L => L[0][3] === 'carrier');
    const s = at(cv, (t0 + t1) / 2); cx = s[5]; cz = s[6]; R = 220;
    for (const [id, L] of planes) if (L[0][2] === cv[0][2] && L[0][3] === 'f' && L.some(r => r[0] >= t0 && r[0] <= t1 && r[4] === 't')) key.push(id);
    key = key.slice(0, 8); title = `${cv[0][2] === 'U' ? 'USN' : 'IJN'} CAP stations round the carrier, t=${t0}-${t1}`;
  }
  return { t0, t1, cx, cz, R, key, marks, rings, title };
}
const P = pick();

// ---------- draw ----------
const SZ = 560, sc = SZ / (2 * P.R), X = x => ((x - P.cx) * sc + SZ / 2).toFixed(1), Z = z => ((z - P.cz) * sc + SZ / 2).toFixed(1);
const KC = ['#000000', '#a142f4', '#e8710a', '#12b5cb', '#795548', '#5f6368'];   // key planes: not the nation / phase colours
const stCol = (st, nat) => /m/.test(st) ? '#f29900' : /e/.test(st) ? '#188038' : /a/.test(st.slice(1)) ? '#d93025' : st[0] === 'r' ? (nat === 'U' ? '#6fa8dc' : '#e6a0a0') : /f|v/.test(st) ? '#fbbc04' : st[0] === 'a' ? '#c5221f' : nat === 'U' ? '#7baaf7' : '#f28b82';
const inWin = r => r[0] >= P.t0 && r[0] <= P.t1;
let top = `<rect width="${SZ}" height="${SZ}" fill="#eef3f8" stroke="#99a"/>`;
// scale bar: 100 u
top += `<line x1="10" y1="${SZ - 12}" x2="${10 + 100 * sc}" y2="${SZ - 12}" stroke="#333" stroke-width="2"/><text x="10" y="${SZ - 16}" font-size="10">100 u</text>`;
for (const [id, L] of ships) {
  const W = L.filter(inWin); if (!W.length) continue;
  const c = W[0][2] === 'U' ? '#1f4e9c' : '#b3261e', e = W[W.length - 1];
  top += `<path d="${W.map((r, i) => (i ? 'L' : 'M') + X(r[5]) + ' ' + Z(r[6])).join('')}" stroke="${c}" stroke-width="2" fill="none" opacity="0.5"/>`;
  const big = e[3] === 'carrier' ? 7 : e[3] === 'battleship' || e[3] === 'cruiser' ? 5 : e[3] === 'pt' ? 2.5 : 4;
  top += `<circle cx="${X(e[5])}" cy="${Z(e[6])}" r="${big}" fill="${e[4] === 'sinking' ? '#000' : e[4] === 'crip' ? '#fff' : c}" stroke="${c}" stroke-width="1.5"/>`;
  top += `<text x="${+X(e[5]) + 7}" y="${+Z(e[6]) + 3}" font-size="9" fill="${c}">${e[3]}${e[4] === 'crip' ? ' (cripple)' : ''}</text>`;
}
for (const [id, L] of planes) {
  const W = L.filter(inWin); if (W.length < 2) continue;
  const k = P.key.indexOf(id), nat = W[0][2];
  if (k >= 0) {
    top += `<path d="${W.map((r, i) => (i ? 'L' : 'M') + X(r[5]) + ' ' + Z(r[6])).join('')}" stroke="${KC[k % KC.length]}" stroke-width="2.2" fill="none"/>`;
    for (const r of W) if (Math.round(r[0] * 2) % 20 === 0) top += `<circle cx="${X(r[5])}" cy="${Z(r[6])}" r="2.2" fill="${KC[k % KC.length]}"/>`;   // a dot every 10 s
    const e = W[W.length - 1]; top += `<text x="${+X(e[5]) + 4}" y="${+Z(e[6]) - 4}" font-size="10" font-weight="bold" fill="${KC[k % KC.length]}">#${id} ${e[3]}</text>`;
  } else {
    let seg = '', col = null;
    for (let i = 0; i < W.length; i++) {
      const c = stCol(W[i][4], nat);
      if (c !== col || (i && Math.hypot(W[i][5] - W[i - 1][5], W[i][6] - W[i - 1][6]) > 30)) { if (seg) top += `<path d="${seg}" stroke="${col}" stroke-width="0.8" fill="none" opacity="0.35"/>`; seg = 'M' + X(W[i][5]) + ' ' + Z(W[i][6]); col = c; }
      else seg += 'L' + X(W[i][5]) + ' ' + Z(W[i][6]);
    }
    if (seg) top += `<path d="${seg}" stroke="${col}" stroke-width="0.8" fill="none" opacity="0.35"/>`;
  }
}
for (const g of P.rings || []) top += `<circle cx="${X(g.x)}" cy="${Z(g.z)}" r="${(g.r * sc).toFixed(1)}" fill="${g.dash ? 'none' : 'rgba(217,48,37,0.08)'}" stroke="#d93025" stroke-width="1.5" ${g.dash ? 'stroke-dasharray="5 4"' : ''}/><text x="${+X(g.x) + g.r * sc * 0.72}" y="${+Z(g.z) - g.r * sc * 0.72}" font-size="10" fill="#d93025">${g.txt}</text>`;
for (const m of P.marks) top += `<circle cx="${X(m.x)}" cy="${Z(m.z)}" r="9" fill="none" stroke="#000" stroke-dasharray="3 2"/><text x="${+X(m.x) + 10}" y="${+Z(m.z) + 14}" font-size="10">${m.txt} (${m.t} s)</text>`;

// side panel: height against time for every plane in the window within the map, key planes bold
const GW = 520, GH = 260, T = t => (40 + (t - P.t0) / (P.t1 - P.t0) * (GW - 50)).toFixed(1);
let ymax = 20; for (const [id, L] of planes) for (const r of L) if (inWin(r) && Math.abs(r[5] - P.cx) < P.R && Math.abs(r[6] - P.cz) < P.R) ymax = Math.max(ymax, r[7]);
ymax = Math.ceil(ymax / 10) * 10;
const Yh = y => (GH - 20 - y / ymax * (GH - 40)).toFixed(1);
let side = `<rect width="${GW}" height="${GH}" fill="#fff" stroke="#99a"/><text x="40" y="12" font-size="11">height (u; 1 u = 100 ft ~ 30 m at the PLANE_REVIEW scale) against time</text>`;
for (let y = 0; y <= ymax; y += 10) side += `<line x1="40" x2="${GW - 10}" y1="${Yh(y)}" y2="${Yh(y)}" stroke="#eee"/><text x="8" y="${+Yh(y) + 3}" font-size="9">${y}</text>`;
for (const [id, L] of planes) {
  const W = L.filter(r => inWin(r) && Math.abs(r[5] - P.cx) < P.R && Math.abs(r[6] - P.cz) < P.R); if (W.length < 2) continue;
  const k = P.key.indexOf(id);
  side += `<path d="${W.map((r, i) => (i && r[0] - W[i - 1][0] < 1.5 ? 'L' : 'M') + T(r[0]) + ' ' + Yh(r[7])).join('')}" stroke="${k >= 0 ? KC[k % KC.length] : stCol(W[0][4], W[0][2])}" stroke-width="${k >= 0 ? 2 : 0.7}" fill="none" opacity="${k >= 0 ? 1 : 0.5}"/>`;
}
side += `<text x="40" y="${GH - 4}" font-size="9">${P.t0.toFixed(0)} s</text><text x="${GW - 40}" y="${GH - 4}" font-size="9">${P.t1.toFixed(0)} s</text>`;

// smoothness strip: heading rate (rad/s) and roll (rad) of the key planes
const SH = 200, Ys = (v, lo, hi) => (SH - 15 - (v - lo) / (hi - lo) * (SH - 30)).toFixed(1);
let strip = `<rect width="${GW}" height="${SH}" fill="#fff" stroke="#99a"/><text x="40" y="12" font-size="11">key planes: heading rate (solid, rad/s, -1.5..1.5) and roll (dashed, rad)</text>`;
strip += `<line x1="40" x2="${GW - 10}" y1="${Ys(0, -1.5, 1.5)}" y2="${Ys(0, -1.5, 1.5)}" stroke="#ccc"/>`;
let maxRate = 0, maxDR = 0;
P.key.forEach((id, k) => {
  const W = (planes.get(id) || []).filter(inWin); if (W.length < 3) return;
  let a = '', b = '';
  for (let i = 1; i < W.length; i++) {
    const dt = W[i][0] - W[i - 1][0]; if (dt <= 0 || dt > 1.5) continue;
    let dh = W[i][8] - W[i - 1][8]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const rate = WWclamp(dh / dt, -1.5, 1.5); maxRate = Math.max(maxRate, Math.abs(dh / dt)); maxDR = Math.max(maxDR, Math.abs(W[i][9] - W[i - 1][9]) / dt);
    a += (a ? 'L' : 'M') + T(W[i][0]) + ' ' + Ys(rate, -1.5, 1.5); b += (b ? 'L' : 'M') + T(W[i][0]) + ' ' + Ys(WWclamp(W[i][9], -1.5, 1.5), -1.5, 1.5);
  }
  strip += `<path d="${a}" stroke="${KC[k % KC.length]}" stroke-width="1.4" fill="none"/><path d="${b}" stroke="${KC[k % KC.length]}" stroke-width="1" stroke-dasharray="3 2" fill="none"/>`;
});
function WWclamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
strip += `<text x="40" y="${SH - 3}" font-size="9">max |heading rate| ${maxRate.toFixed(2)} rad/s, max |roll rate| ${maxDR.toFixed(2)} rad/s (sampled every 0.5 s)</text>`;

const legend = [['CAP / transit', '#7baaf7'], ['fight / vector', '#fbbc04'], ['attack', '#c5221f'], ['alert flight', '#d93025'], ['escorting home', '#188038'], ['return', '#6fa8dc'], ['marshal', '#f29900']]
  .map(([t, c], i) => `<rect x="${10 + i * 105}" y="${SZ + 18}" width="14" height="4" fill="${c}"/><text x="${28 + i * 105}" y="${SZ + 24}" font-size="10">${t}</text>`).join('');
const Wd = SZ + GW + 30, Ht = SZ + 50;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Ht}" font-family="sans-serif" style="background:#fff">
<defs><clipPath id="c"><rect width="${SZ}" height="${SZ}"/></clipPath></defs>
<g transform="translate(5,5)" clip-path="url(#c)">${top}</g><g transform="translate(${SZ + 20},5)">${side}</g><g transform="translate(${SZ + 20},${GH + 20})">${strip}</g>
${legend}<text x="10" y="${SZ + 42}" font-size="11">${P.title} - ${J.scen} seed ${J.seed}; window ${P.t0.toFixed(0)}-${P.t1.toFixed(0)} s; key planes bold with a dot every 10 s; white ship = cripple</text></svg>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: Wd, height: Ht } });
  await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  const out = file.replace(/\.json$/, '_' + scene + (process.env.TAG ? '_' + process.env.TAG : '') + '.png');
  await p.screenshot({ path: out });
  await b.close();
  console.log('tracks: ' + out + ' | ' + P.title + ' | key ' + P.key.join(','));
})().catch(e => { console.error(e); process.exit(1); });
