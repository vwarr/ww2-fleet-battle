// Flight-data review: per-plane telemetry every 0.25 sim s over seeded rounds (sim-only, node runner by default),
// summarized per type / nation / phase, plus time budgets, formation quality, fighter behaviour, attack quality,
// pacing (air vs surface per minute), and flight ops. docs/PLANE_REVIEW.md reads its numbers from this.
// The recorder (tests/flight_review_rec.js) is read-only: it never calls WW.rand and never writes to sim objects,
// so a seeded round plays out exactly as without it (checked with --check: WW.stats with and without it).
//
// Usage: node tests/flight_review.js [--seeds N=5] [--seed0 S=1] [--only standard,carrier_duel,midway,night]
//          [--workers K] [--json FILE] [--trace SCEN:SEED] [--check] [--browser | --render]
//   --json FILE   aggregated numbers + per-round summaries (default tests/shots/flight_review.json)
//   --trace SCEN:SEED  also dump that round's raw per-plane track (every 0.5 s) to tests/shots/flight_trace_SCEN_SEED.json:
//                 rows [t, id, nation, kind, phase, x, y, z, speed, foeId, waveId]; use it to find moments to film
//   --check       run seed0 of each scenario with and without the recorder and compare WW.stats (perturbation test)
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const FR = require('./flight_review_rec');

const argv = HL.argv, has = k => argv.includes(k), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 5), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', 'standard,carrier_duel,midway,night').split(',');
const JSON_OUT = arg('--json', path.join(__dirname, 'shots', 'flight_review.json'));
const TRACE = arg('--trace', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  night: { random: true, tod: 'night' },
  carrier_vs_surface: { A: ['carrier', 'destroyer', 'destroyer'], B: ['battleship', 'cruiser', 'cruiser'] }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  if (!sc) throw new Error('flight_review: unknown scenario ' + name);
  const s = sc.random ? { seed, random: true, light: true, tod: sc.tod || null } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  s.scen = name;
  return s;
}

// ---------------- histogram helpers ----------------
const HS = { spd: [0, 100, 1], gs: [0, 100, 1], alt: [0, 100, 0.5], vy: [-60, 40, 1], tr: [0, 4, 0.05], bank: [0, 1.5, 0.05], fpa: [-90, 60, 1] };
function hMerge(A, B) {
  for (const k in B) {
    const a = A[k] || (A[k] = { n: 0, mx: {} }), b = B[k];
    a.n += b.n;
    for (const m in HS) if (b[m]) { if (!a[m]) a[m] = b[m].slice(); else for (let i = 0; i < b[m].length; i++) a[m][i] += b[m][i]; }
    for (const m in b.mx) a.mx[m] = Math.max(a.mx[m] === undefined ? -1e9 : a.mx[m], b.mx[m]);
  }
}
function hq(h, m, q) {
  const a = h[m]; if (!a) return null;
  const tot = a.reduce((s, x) => s + x, 0); if (!tot) return null;
  let c = 0; for (let i = 0; i < a.length; i++) { c += a[i]; if (c >= q * tot) return +(HS[m][0] + i * HS[m][2]).toFixed(2); }
  return null;
}
const qs = (arr, q) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const med = a => qs(a, 0.5), mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const f1 = v => (v === null || v === undefined || Number.isNaN(v) ? '-' : typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : String(v));
const pc = v => (v === null || v === undefined || Number.isNaN(v) ? '-' : (100 * v).toFixed(0) + '%');
const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);

// ---------------- run ----------------
async function runAll(list, withRec) {
  const b = await HL.launch(), errs = [], res = new Array(list.length);
  let next = 0;
  async function worker() {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    if (withRec) await p.evaluate(FR.install, { trace: !!TRACE });
    while (next < list.length) {
      const i = next++, spec = list[i];
      const out = await p.evaluate(spec => {
        const o = window.__beh.run(spec);
        const rec = window.__rec ? window.__rec.flush() : null;
        return { winner: o.winner, len: o.len, end: o.end, comp: o.comp, stats: { launched: WW.stats.planesLaunched, landed: WW.stats.planesLanded, lost: WW.stats.planesLost, shells: WW.stats.shellsFired, hits: WW.stats.hits, sunk: WW.stats.shipsSunk }, rec };
      }, spec);
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed }, out);
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close();
  process.stdout.write('\n');
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  return res;
}

// ---------------- report ----------------
function report(rounds) {
  const L = [], out = { rounds: rounds.length, kin: {}, budgets: {}, waves: {}, form: {}, fighters: {}, attack: {}, losses: {}, pacing: {}, ops: {}, first: [] };
  const say = s => L.push(s);
  const cvRounds = rounds.filter(r => r.comp && Object.keys(r.comp).some(k => k.endsWith(':carrier')) && r.rec && r.rec.first.launch !== undefined); // carriers that flew (not night)
  say(`FLIGHT REVIEW: ${rounds.length} rounds (${[...new Set(rounds.map(r => r.scen))].map(s => s + ' ' + rounds.filter(r => r.scen === s).length).join(', ')}); ${cvRounds.length} with carrier flight ops (pacing and per-round figures use these). ` +
    `recorder errors ${rounds.reduce((s, r) => s + (r.rec ? r.rec.err : 0), 0)}${rounds.find(r => r.rec && r.rec.lastErr) ? ' (' + rounds.find(r => r.rec && r.rec.lastErr).rec.lastErr.split('\n')[0] + ')' : ''}`);
  say(`round length median ${med(rounds.map(r => r.len))} s; winners USN ${rounds.filter(r => r.winner === 'USN').length} IJN ${rounds.filter(r => r.winner === 'IJN').length} other ${rounds.filter(r => r.winner !== 'USN' && r.winner !== 'IJN').length}`);

  // 1. kinematics by origin / nation / type / phase
  const H = {}; for (const r of rounds) if (r.rec) hMerge(H, r.rec.H);
  say('\n== 1. KINEMATICS by phase (units: u, u/s, rad/s; 1 u ~ 2 m nominal; carrier hull 26 u). p50 [p10-p90], max ==');
  say(pad('origin|nation|type|phase', 40) + lp('time s', 8) + lp('speed', 18) + lp('alt', 18) + lp('vy p90/p10', 13) + lp('turn p50/p90/max', 18) + lp('bank p90', 9) + lp('fpa p10', 8));
  const keys = Object.keys(H).filter(k => H[k].n >= 40 && !k.split('|')[3].startsWith('o_rollout')).sort();
  for (const k of keys) {
    const h = H[k], row = { t: h.n * 0.25, spd: [hq(h, 'spd', 0.1), hq(h, 'spd', 0.5), hq(h, 'spd', 0.9), h.mx.spd], gs: hq(h, 'gs', 0.5), alt: [hq(h, 'alt', 0.1), hq(h, 'alt', 0.5), hq(h, 'alt', 0.9), h.mx.alt],
      vy: [hq(h, 'vy', 0.9), hq(h, 'vy', 0.1)], tr: [hq(h, 'tr', 0.5), hq(h, 'tr', 0.9), h.mx.tr], bank: hq(h, 'bank', 0.9), fpa: hq(h, 'fpa', 0.1) };
    out.kin[k] = row;
    say(pad(k, 40) + lp(f1(row.t), 8) + lp(`${f1(row.spd[1])} [${f1(row.spd[0])}-${f1(row.spd[2])}]`, 18) + lp(`${f1(row.alt[1])} [${f1(row.alt[0])}-${f1(row.alt[2])}]`, 18) +
      lp(`${f1(row.vy[0])}/${f1(row.vy[1])}`, 13) + lp(`${f1(row.tr[0])}/${f1(row.tr[1])}/${f1(row.tr[2])}`, 18) + lp(f1(row.bank), 9) + lp(f1(row.fpa), 8));
  }

  // 2. time budgets per sortie
  say('\n== 2. TIME BUDGETS (carrier + base sorties; share of sortie time by category; circling = trailing 10 s path with net/path < 0.4) ==');
  const S = []; for (const r of rounds) if (r.rec) for (const s of r.rec.sorties) S.push(s);
  const cats = ['deck', 'launch', 'formup', 'transit', 'patrol', 'fight', 'attack', 'return', 'landing'];
  say(pad('nation role kind', 26) + lp('n', 5) + lp('len p50', 8) + lp('air p50', 8) + cats.map(c => lp(c, 8)).join('') + lp('circ/air', 9) + lp('circ@cv', 8) + lp('circ@tgt', 9));
  const groups = {};
  for (const s of S) if (s.o === 'cv' || s.o === 'base') { const k = `${s.o === 'base' ? 'B:' : ''}${s.n} ${s.role} ${s.v || s.k}`; (groups[k] = groups[k] || []).push(s); }
  for (const k of Object.keys(groups).sort()) {
    const G = groups[k], tot = {}, circ = { all: 0, cv: 0, tgt: 0 }; let T = 0, A = 0;
    for (const s of G) { for (const c in s.b) { tot[c] = (tot[c] || 0) + s.b[c]; T += s.b[c]; } A += s.air; for (const c in s.circ) { circ.all += s.circ[c]; if (c.endsWith(':cv')) circ.cv += s.circ[c]; if (c.endsWith(':tgt')) circ.tgt += s.circ[c]; } }
    const lens = G.filter(s => s.t1 !== null).map(s => s.t1 - s.t0), row = { n: G.length, len: med(lens), air: med(G.map(s => s.air)), share: {}, circAir: A ? circ.all / A : null, circCv: A ? circ.cv / A : null, circTgt: A ? circ.tgt / A : null, circByCat: {} };
    for (const c of cats) row.share[c] = T ? (tot[c] || 0) / T : 0;
    for (const s of G) for (const c in s.circ) row.circByCat[c] = (row.circByCat[c] || 0) + s.circ[c];
    out.budgets[k] = row;
    say(pad(k, 26) + lp(row.n, 5) + lp(f1(row.len), 8) + lp(f1(row.air), 8) + cats.map(c => lp(pc(row.share[c]), 8)).join('') + lp(pc(row.circAir), 9) + lp(pc(row.circCv), 8) + lp(pc(row.circTgt), 9));
  }
  const circCat = {}; let airAll = 0;
  for (const s of S) if (s.o === 'cv') { airAll += s.air; for (const c in s.circ) circCat[c] = (circCat[c] || 0) + s.circ[c]; }
  out.budgets._circCat = {}; for (const c in circCat) out.budgets._circCat[c] = circCat[c] / airAll;
  say('carrier planes, circling time by category:location as a share of all airborne time: ' + Object.keys(circCat).sort((a, b) => circCat[b] - circCat[a]).slice(0, 10).map(c => `${c} ${pc(circCat[c] / airAll)}`).join(', '));
  const LW = S.filter(s => s.o === 'cv' && s.end === 'landed').map(s => s.b.landing || 0), LS = S.filter(s => s.o === 'cv' && s.end === 'landed').map(s => (s.b.landing || 0) / Math.max(1, s.air + (s.b.landing || 0)));
  out.budgets._landing = { n: LW.length, p50: med(LW), p90: qs(LW, 0.9), shareP50: med(LS) };
  const LM = S.filter(s => s.o === 'cv' && s.end === 'landed').map(s => s.b.marshal || 0), LG = S.filter(s => s.o === 'cv' && s.end === 'landed').map(s => (s.b.landing || 0) - (s.b.marshal || 0));
  out.budgets._landing.marshalP50 = med(LM); out.budgets._landing.marshalP90 = qs(LM, 0.9); out.budgets._landing.grooveP50 = med(LG); out.budgets._landing.grooveP90 = qs(LG, 0.9);
  say(`landing pattern time per recovered carrier sortie: p50 ${f1(med(LW))} s, p90 ${f1(qs(LW, 0.9))} s (n ${LW.length}); share of that sortie's flying time p50 ${pc(med(LS))}`);
  say(`  of which holding in the marshal stack p50 ${f1(med(LM))} s, p90 ${f1(qs(LM, 0.9))} s; the rest (approach, groove, wave-offs) p50 ${f1(med(LG))} s, p90 ${f1(qs(LG, 0.9))} s`);
  const ends = {}; for (const s of S) if (s.o === 'cv') ends[s.end] = (ends[s.end] || 0) + 1;
  say('carrier sortie ends: ' + JSON.stringify(ends));
  for (const n of ['USN', 'IJN']) { const G = S.filter(s => s.o === 'cv' && s.n === n && s.wv), o = {}; for (const s of G) o[s.wv] = (o[s.wv] || 0) + 1; say(`${n} carrier bomber sorties: joined the wave while it formed / after it had left / never had a wave: ${pc((o.formed || 0) / G.length)} / ${pc((o.late || 0) / G.length)} / ${pc((o.none || 0) / G.length)} (n ${G.length})`); (out.budgets._wave = out.budgets._wave || {})[n] = o; }
  out.budgets._outcomes = {};
  for (const n of ['USN', 'IJN']) { const G = S.filter(s => s.o === 'cv' && s.n === n && s.out), o = {}; for (const s of G) o[s.out] = (o[s.out] || 0) + 1; out.budgets._outcomes[n] = o; say(`${n} armed carrier bomber sorties by outcome: ` + Object.keys(o).map(k => `${k} ${o[k]} (${pc(o[k] / G.length)})`).join(', ')); }

  // 3. strike timelines
  say('\n== 3. STRIKES (per wave: order -> first up -> departs -> within 140 -> first drop; first -> last drop) ==');
  const W = []; for (const r of rounds) if (r.rec) for (const w of r.rec.waves) W.push(Object.assign({ scen: r.scen, seed: r.seed }, w));
  const wg = {};
  for (const w of W) { const k = `${w.base ? 'base ' : ''}${w.n} ${w.mode}${w.first ? ' first' : ''}`; (wg[k] = wg[k] || []).push(w); }
  say(pad('nation mode', 24) + lp('waves', 6) + lp('dOrder', 7) + lp('->up', 6) + lp('form', 6) + lp('->arr', 7) + lp('go->drop', 9) + lp('ord->drop', 10) + lp('drop span', 10) + lp('noDrop', 7) + lp('planes', 7));
  for (const k of Object.keys(wg).sort()) {
    const G = wg[k], dr = G.filter(w => w.drops.length);
    const row = { n: G.length, dOrder: med(G.map(w => w.dOrder).filter(x => x !== null)), toUp: med(G.filter(w => w.tUp !== null).map(w => w.tUp - w.tOrder)), form: med(G.filter(w => w.tGo !== null && w.tUp !== null).map(w => w.tGo - w.tUp)),
      toArr: med(G.filter(w => w.tArr !== null && w.tGo !== null).map(w => w.tArr - w.tGo)), goDrop: med(dr.filter(w => w.tGo !== null).map(w => Math.min(...w.drops) - w.tGo)), ordDrop: med(dr.map(w => Math.min(...w.drops) - w.tOrder)),
      span: med(dr.map(w => Math.max(...w.drops) - Math.min(...w.drops))), noDrop: 1 - dr.length / G.length, planes: med(G.map(w => w.members)) };
    out.waves[k] = row;
    say(pad(k, 24) + lp(row.n, 6) + lp(f1(row.dOrder), 7) + lp(f1(row.toUp), 6) + lp(f1(row.form), 6) + lp(f1(row.toArr), 7) + lp(f1(row.goDrop), 9) + lp(f1(row.ordDrop), 10) + lp(f1(row.span), 10) + lp(pc(row.noDrop), 7) + lp(f1(row.planes), 7));
  }
  const cvW = W.filter(w => !w.base);
  const eff = {}; for (const w of cvW) if (w.drops.length) { const k = w.scen + w.seed + ':' + w.cv; (eff[k] = eff[k] || []).push(Math.min(...w.drops)); }
  const effN = Object.values(eff).map(a => a.length), second = Object.values(eff).filter(a => a.length > 1).map(a => { a.sort((x, y) => x - y); return a[1] - a[0]; });
  out.waves._effective = { perCarrierWithDrops: mean(effN), secondGapP50: med(second), carriersWithSecond: effN.filter(n => n > 1).length / Math.max(1, effN.length) };
  say(`waves that dropped, per carrier that struck at all: ${f1(mean(effN))}; carriers with a second effective strike ${pc(out.waves._effective.carriersWithSecond)}, first -> second strike's first drop p50 ${f1(med(second))} s`);
  // real strikes: first drops of a carrier's waves at least 60 s apart count as separate strikes; waves that left formed
  const real = Object.values(eff).map(a => { a.sort((x, y) => x - y); let n = 0, last = -1e9; for (const t of a) if (t - last >= 60) { n++; last = t; } return n; });
  const cvRoundsN = cvRounds.reduce((s, r) => s + Object.entries(r.comp || {}).filter(([k]) => k.endsWith(':carrier')).reduce((a, [, v]) => a + v, 0), 0);
  // no-drop waves cut short: the carrier was lost before the strike arrived, or the round ended before it could (left < 60 s before the end, or never left)
  const lenOf = {}; for (const r of rounds) lenOf[r.scen + r.seed] = r.len;
  const cut = w => !w.drops.length && ((w.cvLost !== undefined && (w.tArr === null || w.cvLost < w.tArr)) || (w.tArr === null && (w.tGo === null || lenOf[w.scen + w.seed] - w.tGo < 60)));
  const fair = cvW.filter(w => !cut(w));
  const gone = cvW.filter(w => w.tGo !== null && w.formed !== undefined && w.formed !== null), cvNo = cvW.filter(w => !w.drops.length).length / Math.max(1, cvW.length);
  out.waves._real = { perStrikingCv: mean(real), perCv: real.reduce((s, x) => s + x, 0) / Math.max(1, cvRoundsN), threePlus: real.filter(x => x >= 3).length / Math.max(1, real.length), noDrop: cvNo, departedFormed: gone.filter(w => w.formed).length / Math.max(1, gone.length), departedN: gone.length };
  say(`real strikes (first drops >= 60 s apart) per carrier that struck: ${f1(mean(real))} (per carrier in the round ${f1(out.waves._real.perCv)}; 3 or more ${pc(out.waves._real.threePlus)}); carrier waves with no drop ${pc(cvNo)} (n ${cvW.length}); waves that departed formed (not on the timer) ${pc(out.waves._real.departedFormed)} (n ${gone.length})`);
  out.waves._real.noDropFair = fair.filter(w => !w.drops.length).length / Math.max(1, fair.length);
  say(`  carrier waves with no drop, leaving out the ${cvW.length - fair.length} cut short (carrier lost before arrival, or the round ended first): ${pc(out.waves._real.noDropFair)} (n ${fair.length})`);
  say(`carrier waves per carrier-round: ${f1(cvW.length / Math.max(1, rounds.reduce((s, r) => s + Object.entries(r.comp || {}).filter(([k]) => k.endsWith(':carrier')).reduce((a, [, v]) => a + v, 0), 0)))}; ` +
    `waves per round with carriers: ${f1(cvW.length / Math.max(1, cvRounds.length))}; first order at median ${f1(med(rounds.map(r => r.rec && r.rec.first.order).filter(x => x !== undefined && x !== null)))} s`);
  // carrier hunting (item 5): per side, in rounds where the enemy has a carrier (not the island base)
  {
    const cvOf = (r, n) => (r.comp && r.comp[n + ':carrier']) || 0, sides = [];
    for (const r of rounds) if (r.rec) for (const n of ['USN', 'IJN']) { const e = n === 'USN' ? 'IJN' : 'USN'; if (cvOf(r, e)) sides.push({ r, n, e }); }
    const air = d => d.o === 'cv' || d.o === 'base';
    const dr = sides.map(x => x.r.rec.drops.filter(d => d.n === x.n && air(d) && d.tt === 'carrier'));
    const all = sides.map(x => x.r.rec.drops.filter(d => d.n === x.n && air(d)).length);
    const sunkCv = sides.map(x => (x.r.rec.sunk || []).filter(s => s.n === x.e && s.type === 'carrier' && !s.base));
    const byAir = sunkCv.map(a => a.filter(s => s.by === 'bomb' || s.by === 'torpedo' || s.by === 'crash').length);
    const eCv = sides.reduce((s, x) => s + cvOf(x.r, x.e), 0);
    const hits = dr.map(a => a.filter(d => d.hit === 'tgt').length);
    out.waves._cv = { sides: sides.length, dropsAtCv: mean(dr.map(a => a.length)), shareAtCv: dr.reduce((s, a) => s + a.length, 0) / Math.max(1, all.reduce((s, x) => s + x, 0)),
      hitsOnCv: mean(hits), cvSunk: sunkCv.reduce((s, a) => s + a.length, 0) / Math.max(1, eCv), cvSunkAir: byAir.reduce((s, x) => s + x, 0) / Math.max(1, eCv),
      wipe: rounds.filter(r => r.rec && ['USN', 'IJN'].some(n => cvOf(r, n) && (r.rec.sunk || []).filter(s => s.n === n && s.type === 'carrier' && !s.base).length >= cvOf(r, n))).length / Math.max(1, rounds.filter(r => r.rec && (cvOf(r, 'USN') || cvOf(r, 'IJN'))).length) };
    const bs = rounds.reduce((o, r) => { const b = r.rec && r.rec.boss; if (b) for (const k in b) o[k] = (o[k] || 0) + b[k]; return o; }, {});
    const C = out.waves._cv;
    say(`carrier hunting, per side per round facing enemy carriers (n ${C.sides}): air drops at a carrier ${f1(C.dropsAtCv)} (${pc(C.shareAtCv)} of its air drops), hits on a carrier ${f1(C.hitsOnCv)}; ` +
      `enemy carriers sunk ${pc(C.cvSunk)} (by air ${pc(C.cvSunkAir)}); rounds where a side lost all its carriers ${pc(C.wipe)}; air boss: strikes turned to a carrier ${bs.cvFirst || 0} at the order, ${bs.cvRetarget || 0} while forming, of ${bs.strikes || 0}`);
  }

  // 4. formation quality
  say('\n== 4. FORMATION QUALITY ==');
  const AL = {}; for (const r of rounds) if (r.rec) for (const k in r.rec.alone) { const a = AL[k] || (AL[k] = { t: 0, alone: 0, nn: 0 }), b = r.rec.alone[k]; a.t += b.t; a.alone += b.alone; a.nn += b.nn; }
  say('alone share (no same-mission plane within 30 u), by nation|kind|phase: ' + Object.keys(AL).sort().filter(k => AL[k].t > 30).map(k => `${k} ${pc(AL[k].alone / AL[k].t)} (t ${AL[k].t.toFixed(0)})`).join('; '));
  out.form.alone = {}; for (const k in AL) out.form.alone[k] = { t: AL[k].t, share: AL[k].alone / AL[k].t };
  const LD = []; for (const r of rounds) if (r.rec) for (const x of r.rec.lead) LD.push(x);
  out.form.lead = { p10: qs(LD, 0.1), p50: med(LD), p90: qs(LD, 0.9), n: LD.length };
  say(`wingman-leader distance (cap/transit/formup): p10 ${f1(out.form.lead.p10)} p50 ${f1(out.form.lead.p50)} p90 ${f1(out.form.lead.p90)} (slot ~11.7 u)`);
  const WF = W.filter(w => w.fs > 0);
  out.form.wave = { spread: mean(WF.map(w => w.spread / w.fs)), strag: WF.reduce((s, w) => s + w.strag, 0) / Math.max(1, WF.reduce((s, w) => s + w.stragN, 0)),
    altF: mean(WF.filter(w => w.nF).map(w => w.altF / w.nF)), altD: mean(WF.filter(w => w.nD).map(w => w.altD / w.nD)), altT: mean(WF.filter(w => w.nT).map(w => w.altT / w.nT)), sepMin: med(WF.map(w => w.sepMin).filter(x => x !== null)) };
  say(`strike in transit: max radius from centroid ${f1(out.form.wave.spread)} u, stragglers (>60 u from centroid) ${pc(out.form.wave.strag)}, stack: fighters ${f1(out.form.wave.altF)} / dive ${f1(out.form.wave.altD)} / torpedo ${f1(out.form.wave.altT)} u, closest pair p50 ${f1(out.form.wave.sepMin)} u`);
  const EP = []; for (const r of rounds) if (r.rec) for (const e of r.rec.escPos) EP.push(e);
  for (const top of [0, 1]) { const E = EP.filter(e => e[3] === top); if (E.length) { const o = { along: med(E.map(e => e[0])), across: med(E.map(e => Math.abs(e[1]))), dy: med(E.map(e => e[2])), dist: med(E.map(e => Math.hypot(e[0], e[1]))) }; out.form['escort_' + (top ? 'top' : 'close')] = o; say(`escort ${top ? 'top' : 'close'} cover vs bomber centroid: along ${f1(o.along)} across |${f1(o.across)}| dy ${f1(o.dy)} dist ${f1(o.dist)} u`); } }

  // 5. fighters
  say('\n== 5. FIGHTERS ==');
  const FD = {}; for (const r of rounds) if (r.rec) for (const k in r.rec.fdir) { const a = FD[k] || (FD[k] = { t: 0, foe: 0, foeB: 0, foeF: 0, idleRaid: 0, def: 0, circ: 0, modes: {} }), b = r.rec.fdir[k]; for (const f of ['t', 'foe', 'foeB', 'foeF', 'idleRaid', 'def', 'circ']) a[f] += b[f]; for (const m in b.modes) a.modes[m] = (a.modes[m] || 0) + b.modes[m]; }
  for (const k of Object.keys(FD).sort()) {
    const F = FD[k], o = { t: F.t, withFoe: F.foe / F.t, onBombers: F.foeB / F.t, onFighters: F.foeF / F.t, aimless: 1 - F.foe / F.t, idleRaid: F.idleRaid / F.t, defending: F.foe ? F.def / F.foe : null, circ: F.circ / F.t, modes: {} };
    for (const m in F.modes) o.modes[m] = F.modes[m] / Math.max(1e-9, F.foe);
    out.fighters[k] = o;
    say(`${pad(k, 12)} airborne ${f1(F.t)} s: with a foe ${pc(o.withFoe)} (bombers ${pc(o.onBombers)}, fighters ${pc(o.onFighters)}), no foe ${pc(o.aimless)}, no foe while a raid is within 160 of the carrier ${pc(o.idleRaid)}, circling ${pc(o.circ)}; defending ${pc(o.defending)} of fight time; modes ${Object.keys(o.modes).map(m => m + ' ' + pc(o.modes[m])).join(' ')}`);
  }
  const EN = []; for (const r of rounds) if (r.rec) for (const e of r.rec.eng) EN.push(e);
  const eg = {}; for (const e of EN) { const k = `${e.n} ${e.role} vs ${e.fk === 'fighter' ? 'fighter' : e.armed ? 'armed bomber' : e.fk}`; (eg[k] = eg[k] || []).push(e); }
  out.fighters.eng = {};
  for (const k of Object.keys(eg).sort()) { const G = eg[k], o = { n: G.length, durP50: med(G.map(e => e.d)), durP90: qs(G.map(e => e.d), 0.9), killRate: G.filter(e => e.kill).length / G.length, short: G.filter(e => e.d < 2).length / G.length }; out.fighters.eng[k] = o; say(`engagements ${pad(k, 34)} n ${lp(o.n, 4)} dur p50 ${f1(o.durP50)} p90 ${f1(o.durP90)} s, <2 s ${pc(o.short)}, kill / engagement ${f1(o.killRate)}`); }
  const FF = []; for (const r of rounds) if (r.rec) for (const x of r.rec.foeFirst) FF.push(x);
  for (const n of ['USN', 'IJN']) { const d = FF.filter(x => x.n === n && x.d !== null).map(x => x.d); if (d.length) { out.fighters['icept_' + n] = { n: d.length, p10: qs(d, 0.1), p50: med(d), p90: qs(d, 0.9) }; say(`${n} CAP first contact with each armed raider: distance of the raider from the CAP's carrier p10 ${f1(qs(d, 0.1))} p50 ${f1(med(d))} p90 ${f1(qs(d, 0.9))} u (n ${d.length})`); } }

  // 6. attacks and losses
  say('\n== 6. ATTACKS ==');
  const D = []; for (const r of rounds) if (r.rec) for (const d of r.rec.drops) D.push(d);
  const hitR = G => { const g = G.filter(d => d.hit); return g.length ? g.filter(d => d.hit === 'tgt' || d.hit === 'other').length / g.length : null; };
  const db = D.filter(d => d.kind === 'bomb' && !d.level && d.pk === 'dive');
  for (const n of ['USN', 'IJN']) {
    const G = db.filter(d => d.n === n); if (!G.length) continue;
    const o = { n: G.length, push: med(G.map(d => d.push).filter(x => x !== null)), relY: med(G.map(d => d.y)), relYp10: qs(G.map(d => d.y), 0.1), angle: med(G.map(d => -d.fpa)), angleP10: qs(G.map(d => -d.fpa), 0.1), spd: med(G.map(d => d.spd)), rollT: med(G.map(d => d.rollT).filter(x => x !== null)), hit: hitR(G) };
    out.attack['dive_' + n] = o;
    say(`${n} dive bombing: n ${o.n}, push-over alt p50 ${f1(o.push)} u, release alt p50 ${f1(o.relY)} (p10 ${f1(o.relYp10)}), dive angle at release p50 ${f1(o.angle)} deg (p10 ${f1(o.angleP10)}), speed ${f1(o.spd)} u/s, push-over -> release ${f1(o.rollT)} s, hit rate ${pc(o.hit)}`);
  }
  const lv = D.filter(d => d.level); if (lv.length) { out.attack.level = { n: lv.length, y: med(lv.map(d => d.y)), hit: hitR(lv) }; say(`level bombing: n ${lv.length}, release alt p50 ${f1(out.attack.level.y)} u, hit rate ${pc(out.attack.level.hit)}`); }
  const tp = D.filter(d => d.kind === 'torpedo');
  for (const n of ['USN', 'IJN']) {
    const G = tp.filter(d => d.n === n); if (!G.length) continue;
    const o = { n: G.length, y: med(G.map(d => d.y)), spd: med(G.map(d => d.gs)), range: med(G.map(d => d.dT)), rangeP10: qs(G.map(d => d.dT), 0.1), rangeP90: qs(G.map(d => d.dT), 0.9), off: med(G.map(d => d.off)), offP10: qs(G.map(d => d.off), 0.1), offP90: qs(G.map(d => d.off), 0.9), hit: hitR(G) };
    out.attack['torp_' + n] = o;
    say(`${n} torpedo drops: n ${o.n}, alt p50 ${f1(o.y)} u, speed ${f1(o.spd)} u/s, range p50 ${f1(o.range)} [${f1(o.rangeP10)}-${f1(o.rangeP90)}] u, angle off the target's bow p50 ${f1(o.off)} [${f1(o.offP10)}-${f1(o.offP90)}] deg, hit rate ${pc(o.hit)}`);
  }
  // anvil: per (wave, target) torpedo drops from both bows?
  const av = {}; for (const d of tp) if (d.wave) { const k = d.wave + ':' + d.tid + ':' + d.t.toFixed(0).slice(0, -1); (av[d.wave + ':' + d.tid] = av[d.wave + ':' + d.tid] || []).push(d); }
  const avG = Object.values(av).filter(G => G.length >= 2);
  out.attack.anvil = { groups: avG.length, bothBows: avG.filter(G => G.some(d => d.side > 0) && G.some(d => d.side < 0)).length / Math.max(1, avG.length), spanP50: med(avG.map(G => Math.max(...G.map(d => d.t)) - Math.min(...G.map(d => d.t)))) };
  say(`torpedo groups (>= 2 drops, same wave and target): ${avG.length}, from both bows ${pc(out.attack.anvil.bothBows)}, first -> last drop p50 ${f1(out.attack.anvil.spanP50)} s`);
  // VB / VT together: per wave with both kinds, the gap between the first bomb and the first torpedo
  const sync = []; for (const r of rounds) if (r.rec) { const byW = {}; for (const d of r.rec.drops) if (d.wave) (byW[d.wave] = byW[d.wave] || []).push(d); for (const w in byW) { const b = byW[w].filter(d => d.kind === 'bomb'), t = byW[w].filter(d => d.kind === 'torpedo'); if (b.length && t.length) sync.push(Math.abs(Math.min(...b.map(d => d.t)) - Math.min(...t.map(d => d.t)))); } }
  out.attack.vbvtGap = { n: sync.length, p50: med(sync), p90: qs(sync, 0.9) };
  say(`first bomb vs first torpedo of the same wave: p50 ${f1(med(sync))} s, p90 ${f1(qs(sync, 0.9))} s (n ${sync.length}; waves in 'squadron' mode split VB / VT into separate waves and are not counted here)`);
  const DE = []; for (const r of rounds) if (r.rec) for (const d of r.rec.deaths) DE.push(d);
  say('losses (carrier and base planes) by nation kind cause [phase]:');
  const lg = {}; for (const d of DE) if (d.o === 'cv' || d.o === 'base') { const k = `${d.n} ${d.k}`; const g = lg[k] || (lg[k] = { n: 0, cause: {}, ph: {}, armed: 0 }); g.n++; g.cause[d.cause] = (g.cause[d.cause] || 0) + 1; g.ph[d.ph] = (g.ph[d.ph] || 0) + 1; if (d.armed) g.armed++; }
  out.losses = lg;
  for (const k of Object.keys(lg).sort()) say(`  ${pad(k, 14)} ${lp(lg[k].n, 4)}  ${JSON.stringify(lg[k].cause)}  armed ${lg[k].armed}  ${JSON.stringify(lg[k].ph)}`);
  const sorAll = S.filter(s => s.o === 'cv' && s.role === 'strike');
  say(`per round with carriers: plane losses ${f1(DE.filter(d => d.o === 'cv').length / Math.max(1, cvRounds.length))}, strike sorties ${f1(sorAll.length / Math.max(1, cvRounds.length))}, drops ${f1(D.filter(d => d.o === 'cv').length / Math.max(1, cvRounds.length))}`);

  // 7. pacing
  say('\n== 7. PACING (mean per round with carriers, per sim minute; air = carrier/base planes airborne, eng = fighters with a foe, both mean per sample) ==');
  const nMin = Math.max(...cvRounds.map(r => r.rec ? r.rec.min.length : 0), 0);
  const PM = [];
  for (let m = 0; m < nMin; m++) {
    const R = cvRounds.filter(r => r.rec && r.rec.min[m]), o = { m, rounds: R.length };
    for (const f of ['drops', 'aaK', 'ftrK', 'shells', 'gunDmg', 'airDmg', 'launch', 'trap', 'sunk']) o[f] = R.length ? R.reduce((s, r) => s + r.rec.min[m][f], 0) / R.length : 0;
    for (const f of ['air', 'eng', 'cap', 'strikeAir', 'circ']) o[f] = R.length ? R.reduce((s, r) => s + r.rec.min[m][f] / Math.max(1, r.rec.min[m].samp), 0) / R.length : 0;
    PM.push(o);
  }
  out.pacing.perMinute = PM;
  say(pad('min', 4) + lp('rnds', 5) + lp('air', 6) + lp('cap', 6) + lp('strk', 6) + lp('circ', 6) + lp('eng', 6) + lp('launch', 7) + lp('trap', 6) + lp('drops', 6) + lp('aaK', 5) + lp('ftrK', 5) + lp('shells', 7) + lp('gunDmg', 7) + lp('airDmg', 7) + lp('sunk', 5));
  for (const o of PM) say(pad(o.m, 4) + lp(o.rounds, 5) + lp(f1(o.air), 6) + lp(f1(o.cap), 6) + lp(f1(o.strikeAir), 6) + lp(f1(o.circ), 6) + lp(f1(o.eng), 6) + lp(f1(o.launch), 7) + lp(f1(o.trap), 6) + lp(f1(o.drops), 6) + lp(f1(o.aaK), 5) + lp(f1(o.ftrK), 5) + lp(f1(o.shells), 7) + lp(f1(o.gunDmg), 7) + lp(f1(o.airDmg), 7) + lp(f1(o.sunk), 5));
  say('first events per round (sim s; sep = closest enemy surface ships at that moment):');
  say(pad('scen seed', 18) + lp('cvSep0', 7) + lp('contact', 8) + lp('launch', 7) + lp('order', 7) + lp('drop', 7) + lp('dropSep', 8) + lp('airDmg', 7) + lp('kill', 6) + lp('gun', 6) + lp('gunSep', 7) + lp('bigGun', 7) + lp('gunDmg', 7) + lp('len', 5) + '  air first?');
  let airFirst = 0, both = 0;
  const ct = r => { const C = r.rec && r.rec.contact; if (!C) return null; const v = Object.values(C).map(c => c.t); return v.length ? Math.min(...v) : null; };
  for (const r of rounds) {
    const F = (r.rec && r.rec.first) || {}, af = F.drop !== undefined && (F.gun === undefined || F.drop < F.gun);
    if (F.drop !== undefined || F.gun !== undefined) { both++; if (af) airFirst++; }
    out.first.push(Object.assign({ scen: r.scen, seed: r.seed, len: r.len, cvSep0: r.rec && r.rec.cvSep0, contact: r.rec && r.rec.contact }, F));
    say(pad(r.scen + ' ' + r.seed, 18) + lp(f1(r.rec && r.rec.cvSep0), 7) + lp(f1(ct(r)), 8) + lp(f1(F.launch), 7) + lp(f1(F.order), 7) + lp(f1(F.drop), 7) + lp(f1(F.dropSep), 8) + lp(f1(F.airDmg), 7) + lp(f1(F.kill), 6) + lp(f1(F.gun), 6) + lp(f1(F.gunSep), 7) + lp(f1(F.bigGun), 7) + lp(f1(F.gunDmg), 7) + lp(r.len, 5) + '  ' + (F.drop === undefined ? '(no drop)' : af ? 'yes' : 'no') + (F.gunWho ? '  first gun ' + F.gunWho : '') + (r.rec && r.rec.contact ? '  contact ' + Object.entries(r.rec.contact).map(([n, c]) => `${n} ${c.t}s by ${c.by} (${c.what}, sep ${c.sep})`).join(' / ') : ''));
  }
  const cvF = cvRounds.map(r => r.rec.first);
  out.pacing.airFirst = { rounds: cvF.length, dropBeforeGun: cvF.filter(F => F.drop !== undefined && (F.gun === undefined || F.drop < F.gun)).length / Math.max(1, cvF.length),
    dropP50: med(cvF.map(F => F.drop).filter(x => x !== undefined)), gunP50: med(cvF.map(F => F.gun).filter(x => x !== undefined)), leadP50: med(cvF.filter(F => F.drop !== undefined && F.gun !== undefined).map(F => F.gun - F.drop)) };
  out.pacing.byScen = {};
  for (const sc of [...new Set(cvRounds.map(r => r.scen))]) { const R = cvRounds.filter(r => r.scen === sc), F = R.map(r => r.rec.first); out.pacing.byScen[sc] = { rounds: R.length, airFirst: F.filter(F => F.drop !== undefined && (F.gun === undefined || F.drop < F.gun)).length, dropP50: med(F.map(F => F.drop).filter(x => x !== undefined)), gunP50: med(F.map(F => F.gun).filter(x => x !== undefined)), contactP50: med(R.map(ct).filter(x => x !== null)) };
    const o = out.pacing.byScen[sc]; say(`  ${pad(sc, 14)} air drop before fleet gunfire in ${o.airFirst}/${o.rounds} rounds; contact p50 ${f1(o.contactP50)} s, first drop p50 ${f1(o.dropP50)} s, first fleet gunfire p50 ${f1(o.gunP50)} s`); }
  out.pacing.contactP50 = med(cvRounds.map(ct).filter(x => x !== null));
  say(`first enemy ship contact (either side) p50 ${f1(out.pacing.contactP50)} s`);
  say(`rounds with carriers: first air drop before the first surface gunfire in ${pc(out.pacing.airFirst.dropBeforeGun)}; first drop p50 ${f1(out.pacing.airFirst.dropP50)} s, first gunfire p50 ${f1(out.pacing.airFirst.gunP50)} s, lead p50 ${f1(out.pacing.airFirst.leadP50)} s`);
  // rising action: drops + kills + gun damage events by thirds of the round
  const thirds = cvRounds.map(r => { const m = r.rec.min, n = m.length, t = [0, 0, 0]; m.forEach((x, i) => { t[Math.min(2, Math.floor(i * 3 / n))] += x.drops + x.aaK + x.ftrK + x.sunk * 5 + x.gunDmg / 200 + x.airDmg / 200; }); return t; });
  out.pacing.thirds = [0, 1, 2].map(i => mean(thirds.map(t => t[i])));
  say(`action index by thirds of the round (drops + kills + 5 x sinkings + damage / 200): ${out.pacing.thirds.map(f1).join(' / ')}`);

  // 8. flight ops
  say('\n== 8. FLIGHT OPS (carriers) ==');
  const HG = []; for (const r of cvRounds) for (const h of r.rec.hang) if (!h.base) HG.push(h);
  for (const n of ['USN', 'IJN']) {
    const G = HG.filter(h => h.n === n); if (!G.length) continue;
    const tot = h => h.hg + h.rearm + h.air + h.deck;
    const o = { samples: G.length, hangarShare: mean(G.map(h => h.hg / Math.max(1, tot(h)))), airShare: mean(G.map(h => h.air / Math.max(1, tot(h)))), rearmShare: mean(G.map(h => h.rearm / Math.max(1, tot(h)))), deckShare: mean(G.map(h => h.deck / Math.max(1, tot(h)))), group: mean(G.map(tot)) };
    const byMin = []; for (const h of G) { const m = Math.floor(h.t / 60); (byMin[m] = byMin[m] || []).push(h.air / Math.max(1, tot(h))); }
    o.airByMin = byMin.map(a => (a ? mean(a) : null));
    out.ops[n] = o;
    say(`${n}: air group ${f1(o.group)} planes per carrier (mean); share in the hangar ${pc(o.hangarShare)}, rearming ${pc(o.rearmShare)}, on deck ${pc(o.deckShare)}, airborne ${pc(o.airShare)}; airborne share by minute ${o.airByMin.map(pc).join(' ')}`);
  }
  for (const n of ['USN', 'IJN']) {
    const K = { t: 0, launch: 0, recover: 0, idle: 0, lq: 0, queued: 0, blocked: 0, both: 0 };
    for (const r of cvRounds) { const k = r.rec.deck && r.rec.deck[n]; if (k) for (const f in K) K[f] += k[f] || 0; }
    if (!K.t) continue;
    out.ops['deck_' + n] = { launch: K.launch / K.t, recover: K.recover / K.t, idle: K.idle / K.t, lq: K.lq / K.t, queued: K.queued / K.t, blocked: K.blocked / K.t, both: K.both / K.t };
    const o = out.ops['deck_' + n];
    say(`${n} deck mode share: launch ${pc(o.launch)}, recover ${pc(o.recover)}, idle ${pc(o.idle)}; mean planes waiting to land ${f1(o.lq)}, waiting below to launch ${f1(o.queued)}; launches waiting on a non-launch deck ${pc(o.blocked)} of the time; both queues non-empty ${pc(o.both)}`);
  }
  const TG = []; for (const r of cvRounds) for (const x of r.rec.trapGap || []) TG.push(x);
  out.ops.trapGap = { n: TG.length, p10: qs(TG, 0.1), p50: med(TG), p90: qs(TG, 0.9) };
  say(`recovery interval with planes waiting (trap to trap, one carrier): p10 ${f1(out.ops.trapGap.p10)} p50 ${f1(out.ops.trapGap.p50)} p90 ${f1(out.ops.trapGap.p90)} s (n ${TG.length})`);
  const DC = []; for (const r of rounds) if (r.rec) for (const x of r.rec.deckCycle) DC.push(x);
  out.ops.deckCycle = { n: DC.length, p10: qs(DC, 0.1), p50: med(DC), p90: qs(DC, 0.9) };
  say(`time on deck between sorties (a pilot's trap -> next launch): p10 ${f1(out.ops.deckCycle.p10)} p50 ${f1(out.ops.deckCycle.p50)} p90 ${f1(out.ops.deckCycle.p90)} s (n ${DC.length})`);
  const lpm = [], tpm = []; for (const r of cvRounds) { for (const cv in r.rec.cvL) for (const m in r.rec.cvL[cv]) lpm.push(r.rec.cvL[cv][m]); for (const cv in r.rec.cvT) for (const m in r.rec.cvT[cv]) tpm.push(r.rec.cvT[cv][m]); }
  out.ops.launchPerActiveMin = mean(lpm); out.ops.trapPerActiveMin = mean(tpm);
  const cvCount = cvRounds.reduce((s, r) => s + Object.entries(r.comp).filter(([k]) => k.endsWith(':carrier')).reduce((a, [, v]) => a + v, 0), 0);
  const sumL = cvRounds.reduce((s, r) => s + Object.values(r.rec.cvL).reduce((a, o) => a + Object.values(o).reduce((x, y) => x + y, 0), 0), 0);
  const sumT = cvRounds.reduce((s, r) => s + Object.values(r.rec.cvT).reduce((a, o) => a + Object.values(o).reduce((x, y) => x + y, 0), 0), 0);
  out.ops.launchesPerCv = sumL / Math.max(1, cvCount); out.ops.trapsPerCv = sumT / Math.max(1, cvCount);
  say(`per carrier-round: launches ${f1(out.ops.launchesPerCv)}, recoveries ${f1(out.ops.trapsPerCv)} (incl. base); in a minute with any launches: ${f1(out.ops.launchPerActiveMin)} launches; with any recoveries: ${f1(out.ops.trapPerActiveMin)}`);
  return { text: L.join('\n'), out };
}

(async () => {
  const t0 = Date.now(), list = [];
  for (const sc of ONLY) for (let i = 0; i < SEEDS; i++) list.push(specFor(sc, SEED0 + i));
  if (has('--check')) {
    const L2 = ONLY.map(sc => specFor(sc, SEED0));
    const a = await runAll(L2, false), b = await runAll(L2, true);
    let bad = 0;
    for (let i = 0; i < L2.length; i++) { const same = JSON.stringify(a[i].stats) === JSON.stringify(b[i].stats) && a[i].len === b[i].len && a[i].winner === b[i].winner; if (!same) bad++; console.log(`${L2[i].scen} ${L2[i].seed}: ${same ? 'same' : 'DIFFERENT'} ${JSON.stringify(a[i].stats)} len ${a[i].len} / ${JSON.stringify(b[i].stats)} len ${b[i].len}`); }
    console.log(bad ? `recorder perturbs the sim in ${bad} rounds` : 'recorder is read-only: identical rounds');
    process.exit(bad ? 1 : 0);
  }
  if (TRACE) { const [sc, sd] = TRACE.split(':'); const sp = specFor(sc, +sd); sp.trace = true; list.length = 0; list.push(sp); }
  console.log(`flight_review: ${list.length} rounds (${HL.label()})`);
  const rounds = await runAll(list, true);
  if (TRACE) {
    const r = rounds[0], f = path.join(__dirname, 'shots', `flight_trace_${r.scen}_${r.seed}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ scen: r.scen, seed: r.seed, rows: r.rec.trace, waves: r.rec.waves, drops: r.rec.drops, deaths: r.rec.deaths, first: r.rec.first }));
    console.log('trace: ' + f + ' (' + (r.rec.trace || []).length + ' rows)');
  }
  const R = report(rounds);
  console.log(R.text);
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), args: argv, summary: R.out, rounds: rounds.map(r => ({ scen: r.scen, seed: r.seed, winner: r.winner, len: r.len, end: r.end, comp: r.comp, stats: r.stats, first: r.rec && r.rec.first, waves: r.rec && r.rec.waves, drops: r.rec && r.rec.drops, deaths: r.rec && r.rec.deaths, min: r.rec && r.rec.min, hang: r.rec && r.rec.hang, deck: r.rec && r.rec.deck, contact: r.rec && r.rec.contact })) }));
  console.log(`\njson: ${JSON_OUT}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
})().catch(e => { console.error(e); process.exit(1); });
