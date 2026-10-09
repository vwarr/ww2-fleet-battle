// Common-sense auditor (user: "to make it seem real but not bunching around carriers, not ignoring obvious targets,
// not letting bombers through"). A read-only recorder (tests/sanity_rules.js) rides every round of the behaviour
// suite's scenarios (tests/sim_behaviour.js SCEN, the same placement) plus the odd fleets (tests/fuzz.js), sampled
// every 0.5 sim s, and counts EPISODES of things a 1942 sailor or pilot would call plainly wrong (rules below).
// Diagnosis only: no gameplay changes, no pass / fail. Output: a ranked table (episodes per round x severity), the
// per-scenario breakdown and the longest examples (seed, scenario, t, unit ids, detail) to replay.
//
// Usage: node tests/sanity.js [--seeds N=6] [--seed0 S=1] [--only scen,..] [--rules P1,S2,..] [--workers K] [--no-fuzz]
//        JSON=path   raw per-round records and the aggregate
//        --plot RULE[:k]  re-run the k-th longest example of RULE (default 1) and draw a top-down track plot of
//                         the 60 s around it (tests/shots/sanity/<rule>_<k>.png, CHROMIUM = headless shell)
//        --shot RULE[:k]  the same example in the rendered game (BASE_URL = a served checkout, CHROMIUM): stops the
//                         replay a moment into the episode, frames the units and takes 3 shots 1.5 s apart
//        FROM=path.json   --plot / --shot from a previous JSON run instead of running the rounds again
// Rounds replay bit-identically (seeded WW.rand; the auditor never touches the sim), so every example reproduces.
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const FZ = require('./fuzz');
const SR = require('./sanity_rules');

// id, severity (3 = what the user named: bombers through, obvious targets ignored, guns silent; 2 = plainly odd;
// 1 = untidy / doctrine-adjacent; 0 = info), owner (who would fix it), what counts and why the threshold
const RULES = [
  ['P1', 3, 'planes2', 'seen armed bomber inbound (drop < 45 s) on a friendly ship, NO fighter on it or vectored to it, while a CAP / returning / stacked fighter could reach it on a lead course 1 s before the drop with fuel home; fighters already on or vectored to a raider are not counted as able (3 s)'],
  ['P1L', 1, 'planes2', 'as P1 but the bomber is outside the fighter carrier\'s doctrine long leash (air_cap DOC.leash2): doctrine, not a blunder'],
  ['P1u', 0, 'intel', 'as P1 but the bomber is not on the side\'s plot (undetected): a detection matter'],
  ['P2', 2, 'planes2', 'CAP fighter with no foe and no vector while a seen raider it can reach before the drop, inside its leash2, has < 2 fighters on it (3 s)'],
  ['P3', 3, 'planes2', 'CAP fighter dogfighting an enemy fighter that is not on its tail while a seen raider it can reach drops on a friendly ship within 25 s with < 2 fighters on it (2 s)'],
  ['P4', 2, 'planes2/endgame', 'more than 4 of a side\'s planes in transit / attack within 50 u (~2 carrier lengths) of its carrier, deck pattern / marshal / take-off / returning excluded (5 s); no doctrine station is that close (USN pickets 115-140 u, IJN loops 80-115 u)'],
  ['P4b', 2, 'planes2', 'a seen raid within 300 u of a carrier and fewer than half of its free CAP fighters on the raid\'s side of it (5 s)'],
  ['P5', 2, 'planes2/strike', 'armed bomber in transit to a target passes a seen enemy ship worth 150 more (air_ops VALUE: CV 250, BB 180, CA 80, DD 20) within 120 u, no farther than its own target (3 s)'],
  ['P5b', 2, 'planes2/strike', 'armed bomber in transit, its target seen within 150 u, not getting closer for 20 s'],
  ['P6', 1, 'planes2', 'bomber in the air (transit / attack) with no target and no wave (10 s)'],
  ['P6c', 1, 'planes2/endgame', 'non-CAP plane circling: > 900 u flown with < 80 u net in 60 s (no foe, not in an attack)'],
  ['P7', 2, 'planes2', 'bomber with no ordnance still in transit / attack, or any plane under 35% hp not going home (10 s)'],
  ['P7f', 2, 'planes2', 'not returning with less fuel than the way home x1.1 + 3 s (5 s)'],
  ['P8', 2, 'planes2', 'escort > 80 u from its strike\'s nearest bomber while an enemy fighter attacks one of them, before the attack (3 s)'],
  ['P8b', 2, 'planes2', 'escort within 50 u of an enemy fighter attacking its bomber and not fighting a fighter (3 s)'],
  ['P9', 1, 'planes2', 'plane (not attacking) inside the heavy-flak reach (0.9 x aa.range x 2.2) of an enemy BB / CA / CV that is not its target nor within 150 u of it (the target\'s screen is unavoidable) (2 s)'],
  ['P10', 1, 'planes2', 'plane in the air > 20 u off the map (2 s)'],
  ['P10s', 0, 'planes2', 'as P10 for a scout / search plane / flying boat (info)'],
  ['P10b', 1, 'planes2', 'CAP fighter > leash2 + 100 u from its carrier with no foe / vector (2 s)'],
  ['S1', 3, 'ships (ships_ai.js)', 'no shell from the ship for 2 x reload + 3 s while a SEEN enemy ship is inside a mount\'s range and arc (ammunition out / conserve, the PT rule for BB / CA mains, PT MG vs big ships, knocked-out mounts excluded) (5 s)'],
  ['S2', 2, 'airdefense (combat_aa.js)', 'an AA salvo / stream at a departing plane (no ordnance and leaving, or returning) or a distant one (> 0.8 reach) while a seen armed bomber closes inside the same battery\'s reach (departing planes inside 15 u, point blank, excluded)'],
  ['S3', 1, 'ships (ships.js / formation)', 'two friendly ships closer than 1.2 x the longer hull (stats.length, centre to centre) (3 s)'],
  ['S3r', 0, 'formation', 'as S3 between a carrier and its own AA-ring escort (ships.js lets ring escorts close: info)'],
  ['S4', 3, 'ships (ai_carrier.js)', 'carrier inside an enemy BB / CA main-battery range (raw positions; broken side skipped) (2 s)'],
  ['S4c', 2, 'ships (ai_carrier.js)', 'carrier steaming (> 30% speed, within 70 deg) at a known BB / CA inside 1.5 x its range (2 s)'],
  ['S5', 2, 'formation', 'carrier with no BB / CA / DD within 150 u (~2 x the IJN loose ring, ~4 x the USN ring) while the side has some afloat (10 s)'],
  ['S6', 1, 'formation', 'a known gun ship within 500 u of a carrier, escorts within 200 u, none of them on the threat side (10 s)'],
  ['S7', 2, 'ships (ai_surface / ships_nav)', 'a bomber on its run / dive at the ship within 100 u, and < 20 deg of turn and < 15% speed change in the last 6 s (4 s)'],
  ['S7t', 2, 'ships (ai_surface comb)', 'as S7 under a torpedo track the side has SEEN (intel.torpedoes) running at the ship within 100 u'],
  ['S8', 2, 'ships', 'ship (not sub) below 10% speed for 20 s with a known enemy within 600 u (rescue alongside, ASW hold excluded)'],
  ['S8c', 1, 'ships', 'ship circling: > 6 L steamed with < 2 L net in 60 s, enemy known within 600 u'],
  ['S9', 2, 'ships (ai_surface / fleet_groups)', 'lone ship (no friend within 250 u, not PT / sub) at > 50% speed heading (40 deg) at a known enemy within 300 u whose group has > 3 x its hp (10 s)'],
  ['S9d', 0, 'doctrine', 'as S9 for a ship on an escort charge (ai_charge.js): doctrine, info'],
  ['S10', 2, 'ships (ships_ai withdraw)', 'ship under 50% hp at > 30% speed heading at the nearest known enemy (60 deg) and away from its friends\' centre (> 60 u) (10 s)']
];
const RULE = Object.fromEntries(RULES.map(r => [r[0], { id: r[0], sev: r[1], owner: r[2], desc: r[3] }]));

const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 6), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', null), RULES_ON = arg('--rules', null), PLOT = arg('--plot', null), SHOT = arg('--shot', null);
const NOFUZZ = argv.includes('--no-fuzz');

function specsFor(seed) {
  const out = [];
  for (const sc of SB.SCEN) {
    if (sc.optIn && !(sc.fuzz && !NOFUZZ)) continue;
    if (ONLY && !ONLY.split(',').includes(sc.name)) continue;
    if (sc.fuzz) { for (const f of FZ.specs(seed)) out.push(Object.assign(f, { scen: 'odd:' + f.label })); continue; }
    if (sc.random) { out.push({ seed, random: true, tod: sc.tod, wx: sc.wx, scen: sc.name }); if (sc.mirror) out.push({ seed, random: true, swap: true, scen: sc.name }); }
    else out.push({ seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: sc.cripple === undefined ? -1 : sc.cripple, noStall: !!sc.noStall, base: sc.base || null, scen: sc.name });
  }
  for (const s of out) Object.assign(s, { light: true, step: SR.P.DT, san: RULES_ON ? RULES_ON.split(',') : true });
  return out;
}

async function openPage(b, errs) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  await p.evaluate(SR.install, SR.P);
  return p;
}

function aggregate(rounds) {
  const A = {}, nR = rounds.length, byScen = {};
  for (const r of rounds) {
    const sk = r.scen.startsWith('odd:') ? 'odd' : r.scen;
    byScen[sk] = byScen[sk] || { rounds: 0 }; byScen[sk].rounds++;
    for (const [k, v] of Object.entries(r.san.res)) {
      const a = A[k] || (A[k] = { n: 0, s: 0, rounds: 0, ex: [] });
      a.n += v.n; a.s += v.s; if (v.n) a.rounds++;
      byScen[sk][k] = (byScen[sk][k] || 0) + v.n;
      for (const e of v.ex) a.ex.push(Object.assign({ seed: r.seed, scen: r.scen, swap: !!r.swap }, e));
    }
  }
  for (const k in A) { A[k].ex.sort((x, y) => y.dur - x.dur); A[k].ex.length = Math.min(A[k].ex.length, 8); }
  const aa = rounds.reduce((o, r) => ({ n: o.n + r.san.aa.n, att: o.att + r.san.aa.att, bad: o.bad + r.san.aa.bad, inb: o.inb + (r.san.inb || 0) }), { n: 0, att: 0, bad: 0, inb: 0 });
  return { A, nR, byScen, aa };
}

function report(G) {
  const { A, nR, byScen, aa } = G;
  const rows = RULES.map(([id]) => {
    const a = A[id] || { n: 0, s: 0, rounds: 0, ex: [] }, R = RULE[id];
    return { id, sev: R.sev, perR: a.n / nR, sPerR: a.s / nR, share: a.rounds / nR, score: a.n / nR * R.sev, owner: R.owner, a };
  }).sort((x, y) => y.score - x.score || y.perR - x.perR);
  console.log(`\nSANITY: ${nR} rounds (${HL.label()})   score = episodes per round x severity\n`);
  console.log('rank rule  sev  ep/round  s/round  rounds_hit  score   owner');
  rows.forEach((r, i) => console.log(`${String(i + 1).padStart(3)}  ${r.id.padEnd(5)} ${r.sev}   ${r.perR.toFixed(2).padStart(7)}  ${r.sPerR.toFixed(1).padStart(7)}  ${(r.share * 100).toFixed(0).padStart(6)}%    ${r.score.toFixed(2).padStart(5)}   ${r.owner}`));
  console.log(`\nP1: ${aa.inb} seen armed raiders inbound (drop < ${SR.P.THREAT_T} s), ${(A.P1 ? A.P1.n : 0)} P1 episodes (${aa.inb ? ((A.P1 ? A.P1.n : 0) / aa.inb * 100).toFixed(0) : 0}% of them with nobody on them while a fighter could reach)`);
  console.log(`S2 AA: ${aa.n} AA shots, ${aa.att} with an armed bomber closing inside the battery's reach, ${aa.bad} of those at a departing / distant plane (${aa.att ? (aa.bad / aa.att * 100).toFixed(0) : 0}%)`);
  const scen = Object.keys(byScen), top = rows.filter(r => r.perR > 0).slice(0, 14).map(r => r.id);
  console.log('\nper scenario (episodes per round):\n' + 'scenario'.padEnd(20) + 'n'.padStart(4) + top.map(k => k.padStart(6)).join(''));
  for (const s of scen) console.log(s.padEnd(20) + String(byScen[s].rounds).padStart(4) + top.map(k => ((byScen[s][k] || 0) / byScen[s].rounds).toFixed(1).padStart(6)).join(''));
  console.log('\nlongest examples (seed scenario t dur: detail):');
  for (const r of rows.filter(r => r.perR > 0).slice(0, 18)) {
    console.log(`  ${r.id} - ${RULE[r.id].desc}`);
    for (const e of r.a.ex.slice(0, 3)) console.log(`    seed ${e.seed}${e.swap ? 's' : ''} ${e.scen} t=${e.t} ${e.dur}s: ${e.d}`);
  }
  return rows;
}

// ---------------- track plot of one example (re-run the round, record, draw) ----------------
// The units named in the example (and in its detail line) are drawn bold with their labels; everything else within
// the frame thin and faint. Window: 20 s before the episode to 5 s after (at most 35 s of it).
const LBL_RE = /[UI]:[a-z]+#p?\d+/g;
const SHIP_T = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1, submarine: 1, pt: 1 };
async function plot(G, b, errs) {
  const [rule, kk] = PLOT.split(':'), k = +(kk || 1), a = G.A[rule];
  if (!a || !a.ex[k - 1]) { console.log(`plot: no example ${k} of ${rule}`); return; }
  const e = a.ex[k - 1], spec = specsFor(e.seed).find(s => s.scen === e.scen && !!s.swap === e.swap);
  const p = await openPage(b, errs), t0 = Math.max(0, e.t - 20), t1 = e.t + Math.min(e.dur, 35) + 5;
  const rows = await p.evaluate(([spec, t0, t1]) => {
    const rows = [], G = WW.game, w = window.__san, s0 = w.sample;
    const rec = () => {
      const t = G.roundTime; if (t < t0 || t > t1) return;
      for (const s of WW.world.ships) if (s.alive && !s.isBase && s.stats) rows.push([+t.toFixed(1), w.label(s), s.nation[0], s.type, s.sinking ? 'sinking' : 'ok', +s.x.toFixed(1), 0, +s.z.toFixed(1)]);
      for (const q of WW.world.planes) if (q.alive && !q.removed && q.state !== 'parked' && q.state !== 'rearm' && q.pt) rows.push([+t.toFixed(1), w.label(q), q.nation[0], q.kind, q.deckPh ? 'deck' : q.state === 'attack' ? (q.foe ? 'dogfight' : 'attack') : q.state === 'return' ? 'return' : q.kind === 'fighter' && !q.target ? (q.vec ? 'intercept' : 'cap') : 'transit', +q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)]);
    };
    w.sample = () => { s0(); rec(); };
    try { window.__beh.run(Object.assign({}, spec, { until: t1 + 1 })); } finally { w.sample = s0; }
    return rows;
  }, [spec, t0, t1]);
  await p.close();
  const out = path.join(__dirname, 'shots', 'sanity'); fs.mkdirSync(out, { recursive: true });
  const f = path.join(out, `${rule}_${k}`);
  fs.writeFileSync(f + '.json', JSON.stringify({ ex: e, rows }));
  await draw(rows, e, f + '.png', `${rule} #${k}: seed ${e.seed}${e.swap ? 's' : ''} ${e.scen} t=${e.t}+${e.dur}s`, e.d);
  console.log('plot: ' + f + '.png');
}
async function draw(rows, e, png, title, detail) {
  const { chromium } = require('playwright');
  const hl = new Set([...e.u.filter(Boolean).map(u => u[0]), ...(String(detail).match(LBL_RE) || [])]);
  const pts = rows.filter(r => hl.has(r[1]) && Math.abs(r[0] - e.t) < 0.3);
  const use = pts.length ? pts.map(r => [r[5], r[7]]) : e.u.filter(Boolean).map(u => [u[1], u[2]]);
  const xs = use.map(q => q[0]), zs = use.map(q => q[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const half = Math.max(160, (Math.max(...xs) - Math.min(...xs)) * 0.8, (Math.max(...zs) - Math.min(...zs)) * 1.2);
  const VW = 900, VH = 600, S = VW / (2 * half), X = x => ((x - cx) * S + VW / 2).toFixed(1), Z = z => ((z - cz) * S + VH / 2).toFixed(1);
  const inF = r => Math.abs(r[5] - cx) < half * 1.1 && Math.abs(r[7] - cz) < half * 0.75;
  const COL = { cap: '#9aa0a6', intercept: '#fbbc04', dogfight: '#f29900', attack: '#d93025', transit: '#1a73e8', return: '#34a853', deck: '#555' };
  const by = new Map(); for (const r of rows) { if (!by.has(r[1])) by.set(r[1], []); by.get(r[1]).push(r); }
  let g = '', top = '';
  for (const [id, L0] of by) {
    const L = L0.filter(inF); if (!L.length) continue;
    const on = hl.has(id), nc = L[0][2] === 'U' ? '#1f4e9c' : '#b3261e', ship = !!SHIP_T[L[0][3]];
    const w0 = on ? 3 : 1, op = on ? 1 : 0.25, l = L[L.length - 1];
    let s = '';
    if (ship) {
      s += `<path d="${L.map((r, i) => (i ? 'L' : 'M') + X(r[5]) + ' ' + Z(r[7])).join(' ')}" stroke="${nc}" stroke-width="${w0 + 0.5}" fill="none" opacity="${on ? 1 : 0.6}"/>`;
      const sz = l[3] === 'carrier' ? 7 : l[3] === 'battleship' || l[3] === 'cruiser' ? 5 : 3.5;
      s += l[3] === 'carrier' ? `<rect x="${X(l[5]) - sz}" y="${Z(l[7]) - sz}" width="${2 * sz}" height="${2 * sz}" fill="${nc}"/>` : `<circle cx="${X(l[5])}" cy="${Z(l[7])}" r="${sz}" fill="${nc}"/>`;
      s += `<text x="${+X(l[5]) + 8}" y="${+Z(l[7]) + 4}" font-size="11" fill="${nc}">${id}</text>`;
    } else {
      let seg = '', ph = null, prev = null;
      const flush = () => { if (seg) s += `<path d="${seg}" stroke="${COL[ph] || '#555'}" stroke-width="${w0}" stroke-dasharray="${L[0][2] === 'I' ? '5 3' : ''}" fill="none" opacity="${op}"/>`; };
      for (const r of L) { if (r[4] !== ph || (prev && r[0] - prev[0] > 1)) { flush(); seg = 'M' + X(r[5]) + ' ' + Z(r[7]); ph = r[4]; } else seg += 'L' + X(r[5]) + ' ' + Z(r[7]); prev = r; }
      flush();
      s += `<circle cx="${X(l[5])}" cy="${Z(l[7])}" r="${on ? 3.5 : 1.5}" fill="${nc}" opacity="${op}"/>`;
      if (on) { const f0 = L[0]; s += `<rect x="${X(f0[5]) - 3}" y="${Z(f0[7]) - 3}" width="6" height="6" fill="none" stroke="${nc}"/><text x="${+X(l[5]) + 6}" y="${+Z(l[7]) - 6}" font-size="12" font-weight="bold" fill="${nc}">${id}</text>`; }
    }
    if (on) top += s; else g += s;
  }
  for (const r of pts) top += `<circle cx="${X(r[5])}" cy="${Z(r[7])}" r="9" fill="none" stroke="#000" stroke-width="1.5"/>`;
  const leg = Object.entries(COL).map(([k, c], i) => `<rect x="${10 + i * 95}" y="${VH + 8}" width="14" height="4" fill="${c}"/><text x="${28 + i * 95}" y="${VH + 14}" font-size="11">${k}</text>`).join('');
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH + 26}" font-family="sans-serif"><rect width="100%" height="100%" fill="#eef3f8"/>${g}${top}${leg}<text x="8" y="16" font-size="13">${esc(title)}</text><text x="8" y="32" font-size="11">${esc(detail)}</text><text x="8" y="47" font-size="10" fill="#555">bold: the units in the example (square = track start, black ring = at the episode start); USN solid, IJN dashed; frame ${Math.round(half * 2)} u wide</text></svg>`;
  const br = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const pg = await br.newPage({ viewport: { width: VW, height: VH + 26 } });
  await pg.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await pg.screenshot({ path: png });
  await br.close();
}

// ---------------- render screenshots of one example ----------------
async function shot(G) {
  const [rule, kk] = SHOT.split(':'), k = +(kk || 1), a = G.A[rule];
  if (!a || !a.ex[k - 1]) { console.log(`shot: no example ${k} of ${rule}`); return; }
  const e = a.ex[k - 1], spec = specsFor(e.seed).find(s => s.scen === e.scen && !!s.swap === e.swap);
  const { chromium } = require('playwright');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', x => console.log('PAGE', x.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8783/') + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 90000 });
  await p.waitForTimeout(2000);
  await p.evaluate(SB.install, SB.P); await p.evaluate(SR.install, SR.P);
  const f = await p.evaluate(([spec, e]) => {
    __sim.setScale(0.1);
    window.__beh.run(Object.assign({}, spec, { until: e.t + Math.min(e.dur, 3) }));
    const U = e.u.filter(Boolean).map(u => window.__san.unit(u[0])).filter(u => u && u.alive);
    if (!U.length) return null;
    let x = 0, z = 0; U.forEach(u => { x += u.x; z += u.z; }); x /= U.length; z /= U.length;
    const w = Math.max(60, ...U.map(u => Math.hypot(u.x - x, u.z - z) * 2.4));
    __sim.focus(x, z, w, 30);
    return { x: Math.round(x), z: Math.round(z), w: Math.round(w), t: +WW.game.roundTime.toFixed(1), units: U.map(u => (u.stats ? u.type + '#' + u.id : u.kind + ' ' + u.state) + '@' + Math.round(u.x) + ',' + Math.round(u.z) + (u.y ? ' y' + Math.round(u.y) : '')) };
  }, [spec, e]);
  console.log('shot', rule, k, JSON.stringify(e), JSON.stringify(f));
  const out = path.join(__dirname, 'shots', 'sanity'); fs.mkdirSync(out, { recursive: true });
  if (f) for (let i = 0; i < 3; i++) { await p.waitForTimeout(1500); await p.screenshot({ path: path.join(out, `${rule}_${k}_render${i}.png`) }); }
  await b.close();
}
if (require.main === module) (async () => {
  const T0 = Date.now(), errs = [];
  const b = await HL.launch();
  const specs = []; for (let i = 0; i < SEEDS; i++) specs.push(...specsFor(SEED0 + i));
  if ((PLOT || SHOT) && process.env.FROM) { // re-use a previous JSON run for the plot / shots
    const J = JSON.parse(fs.readFileSync(process.env.FROM, 'utf8'));
    if (PLOT) await plot(J.agg, b, errs);
    if (SHOT) await shot(J.agg);
    await b.close(); return;
  }
  const pages = await Promise.all([...Array(HL.WORKERS).keys()].map(() => openPage(b, errs)));
  const rounds = new Array(specs.length); let next = 0, done = 0;
  await Promise.all(pages.map(async pg => {
    while (next < specs.length) {
      const i = next++, r = await pg.evaluate(s => window.__beh.run(s), specs[i]);
      rounds[i] = { seed: r.seed, scen: specs[i].scen, swap: !!specs[i].swap, winner: r.winner, len: r.len, san: r.san };
      if (++done % 20 === 0) process.stderr.write(`  ${done}/${specs.length} rounds\n`);
    }
  }));
  const G = aggregate(rounds);
  report(G);
  console.log(`\npage errors ${errs.length}${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}   wall ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ agg: G, rounds }));
  if (PLOT) await plot(G, b, errs);
  if (SHOT) await shot(G);
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });

module.exports = { RULES, specsFor, aggregate };
