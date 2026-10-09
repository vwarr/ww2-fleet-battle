// Endgame survey (diagnosis, read-only): weird or dull endgames, ship level, across scenarios and odd fleets.
// A recorder (wraps WW.air.update; never writes sim state or calls WW.rand) samples every DT s: each ship (position,
// speed, turn rate, hp, fires, sinking), each side's posture / break / pursuit, the planes attacking, and the
// action events (shells at ships, drops, ship hits, sinkings, escapes). Node side, per round, detectors:
//   finish   the winner's fit gun ships leave a broken / crippled enemy afloat with no hit on it for >= 60 s
//   dead     the longest stretch in the last third with no shell at a ship, drop or hit (>= 60 s), nearest enemy distance
//   retire   time from the loser's break to the round end, and the dead time in it
//   timeEnd  a time ending with opposing ships afloat within 500 of each other (in reach)
//   standoff (last third) both sides afloat, an enemy within 300 of an own ship, no damage for >= 60 s
//   stuck    a ship (not sinking, not alongside survivors) under 0.3 u/s for >= 20 s; spin: heading turned > 4 pi in 30 s (two full circles)
//   hulk     a ship below 15% hp or with 3+ fires for >= 60 s, afloat at the end
//   lastSink the round's last sinking: the nearest other ship then, and the time from it to the end
//   abrupt   the round ends with planes attacking, torpedoes running, or shells at ships in the last 5 s
//   cvHide   a carrier afloat in the last third > 900 from every enemy ship, launching nothing
//   airCover a side with a fit carrier that has no planes left (hangar + airborne) while not broken (TUNE.airCover
//            counts it as air cover; <= 2 planes); breaks by the air-cover rule (no fit carrier, fit gun tons above BREAK)
// Usage: node tests/endgame_survey.js [--seeds N=40] [--odd N=12] [--only a,b] [--workers K] [--json FILE]
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 40), ODD = +arg('--odd', 12), ONLY = arg('--only', null), JSON_OUT = arg('--json', null);
const rep = (t, n) => Array(n).fill(t);
const MAIN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] }
};
const ODDS = {
  carrier_vs_surface: { A: ['carrier', 'destroyer', 'destroyer'], B: ['battleship', 'cruiser', 'cruiser'] },
  asymmetric: { A: ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3), 'submarine', 'pt', 'pt'], B: ['cruiser', 'destroyer', 'destroyer'] },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], base: 'IJN', aFixed: 'USN' },
  bb_vs_base: { A: ['battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['destroyer'], base: 'IJN', aFixed: 'USN' },
  pt_vs_bb: { A: ['pt', 'pt'], B: ['battleship', 'cruiser'] },
  pt_raid: { A: rep('pt', 3), B: ['carrier', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)] },
  asw: { A: ['destroyer', 'destroyer', 'cruiser'], B: ['submarine', 'submarine', 'cruiser'] },
  sub_ambush: { A: ['submarine', 'submarine'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'] },
  cv_vs_pt: { A: rep('carrier', 3), B: rep('pt', 10) },
  pt_vs_pt: { A: rep('pt', 8), B: rep('pt', 8) },
  sub_vs_cv: { A: rep('submarine', 4), B: rep('carrier', 2) },
  dd_swarm_vs_bb: { A: rep('destroyer', 8), B: ['battleship'] },
  ss_vs_ss: { A: rep('submarine', 3), B: rep('submarine', 3) },
  bb4_vs_bb4: { A: rep('battleship', 4), B: rep('battleship', 4) },
  cv_vs_bb: { A: ['carrier'], B: ['battleship'] },
  cv2_vs_cv2: { A: rep('carrier', 2), B: rep('carrier', 2) },
  dd6_vs_ss6: { A: rep('destroyer', 6), B: rep('submarine', 6) },
  ca_vs_pt6: { A: ['cruiser'], B: rep('pt', 6) },
  dd_vs_dd: { A: ['destroyer'], B: ['destroyer'] },
  cv3_vs_bb2ca2: { A: rep('carrier', 3), B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  full_vs_pt2: { A: ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer'], B: ['pt', 'pt'] },
  ss_vs_pt: { A: ['submarine'], B: ['pt'] }
};
function specFor(name, sc, seed) {
  const s = sc.random ? { seed, random: true, light: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  s.scen = name; return s;
}

// ======================= PAGE SIDE =======================
function install() {
  const R = window.__es = { err: 0 }, DT = 2;
  let S = null, idN = 0;
  const ids = new WeakMap(), idOf = u => ids.get(u) || (ids.set(u, ++idN), idN);
  const fresh = () => { S = { next: 0, smp: [], ev: [], ships: {}, side: [], end: null }; };
  fresh(); WW.on('roundStart', fresh);
  const t = () => +WW.game.roundTime.toFixed(1);
  const live = () => S && WW.game.state === 'battle';
  WW.on('shellFired', e => { try { if (live() && e && e.cal !== 'mg' && e.proj && e.proj.target && e.proj.target.stats && e.ship && e.proj.target.nation !== e.ship.nation) S.ev.push([t(), 'shell', e.ship.nation, idOf(e.ship), +e.ship.x.toFixed(0), +e.ship.z.toFixed(0)]); } catch (er) { R.err++; } });
  WW.on('weaponDropped', e => { try { if (live() && e && e.proj) S.ev.push([t(), 'drop', e.proj.nation || '', e.kind, +e.proj.x.toFixed(0), +e.proj.z.toFixed(0)]); } catch (er) { R.err++; } });
  WW.on('shipHit', e => { try { if (live() && e && e.ship && e.amount > 0) S.ev.push([t(), 'hit', e.ship.nation, idOf(e.ship), +e.ship.x.toFixed(0), +e.ship.z.toFixed(0), e.kind || '', +e.amount.toFixed(1)]); } catch (er) { R.err++; } });
  WW.on('shipSunk', s => { try { if (S && s) S.ev.push([t(), 'sunk', s.nation, idOf(s), +s.x.toFixed(0), +s.z.toFixed(0), s.type]); } catch (er) { R.err++; } });
  WW.on('shipEscaped', s => { try { if (S && s) S.ev.push([t(), 'esc', s.nation, idOf(s), +s.x.toFixed(0), +s.z.toFixed(0), s.type]); } catch (er) { R.err++; } });
  WW.on('victory', e => { try { if (!S) return; S.end = endSnap(e); } catch (er) { R.err++; R.last = String(er.stack); } });
  function endSnap(e) {
    let att = 0, torps = 0;
    for (const p of WW.world.planes) if (p.alive && (p.state === 'attack' || p.phase) && p.kind !== 'fighter') att++;
    const A = WW.combat && WW.combat.active; if (A) for (const p of A) if (p && p.run !== undefined && p.range && p.sp && p.alive !== false) torps++;
    return { t: t(), reason: e.reason, winner: e.winner, att, torps };
  }
  const planesOf = cv => { let n = cv.hangar ? cv.hangar.fighter + cv.hangar.dive + cv.hangar.torpedo + (cv.rearm ? cv.rearm.length : 0) : 0; for (const p of WW.world.planes) if (p.alive && p.carrier === cv && p.kind !== 'scout') n++; return n; };
  const u0 = WW.air.update;
  WW.air.update = function (dt) {
    const r = u0.apply(this, arguments);
    try { if (live() && WW.game.roundTime >= S.next) { S.next = WW.game.roundTime + DT; sample(); } } catch (e) { R.err++; R.last = String(e.stack); }
    return r;
  };
  function sample() {
    const now = t(), row = [];
    for (const s of WW.world.ships) {
      if (s.isBase || !s.alive) continue;
      const id = idOf(s);
      if (!S.ships[id]) S.ships[id] = { n: s.nation, type: s.type };
      row.push([id, +s.x.toFixed(0), +s.z.toFixed(0), +s.speed.toFixed(2), +(s.turnRate || 0).toFixed(3), +(s.hp / s.maxHp).toFixed(3), s.fireN || 0, s.sinking ? 1 : 0,
        s.rescue ? 1 : 0, s.type === 'carrier' ? planesOf(s) : -1, +(s.heading || 0).toFixed(3), s.submerged ? 1 : 0, s.escapeEdge ? 1 : 0]);
    }
    const sd = {};
    for (const n of ['USN', 'IJN']) {
      const B = WW.fleetCmd && WW.fleetCmd.side(n);
      sd[n] = B ? [B.posture, B.brokenAt || 0, B.pursueAt || 0, Math.round(B.fitTons || 0), Math.round(B.startTons || 0), B.hadCV ? 1 : 0] : null;
    }
    let launches = {};
    for (const p of WW.world.planes) if (p.alive && p.state === 'takeoff' && p.carrier && !p.carrier.isBase) launches[idOf(p.carrier)] = 1;
    S.smp.push([now, row, sd, Object.keys(launches).map(Number), WW.dayNight && WW.dayNight.canFly ? (WW.dayNight.canFly() ? 1 : 0) : 1, WW.game.metT]);
  }
  R.flush = () => ({ tod: WW.dayNight ? WW.dayNight.kind : 'day', launched: WW.stats.planesLaunched, smp: S.smp, ev: S.ev, ships: S.ships, end: S.end, err: R.err, last: R.last || null });
  return true;
}

// ======================= NODE SIDE: detectors =======================
const GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, CRIP = 0.35;
function analyse(r) {
  const { smp, ev, ships, end } = r.rec, len = r.len, T3 = len * 2 / 3, out = {};
  const act = ev.filter(e => e[1] === 'shell' || e[1] === 'drop' || e[1] === 'hit').map(e => e[0]).sort((a, b) => a - b);
  const dmg = ev.filter(e => e[1] === 'hit').map(e => e[0]);
  const at = i => smp[i] ? smp[i][1] : [];
  const dist = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2]);
  const nearestEnemy = row => { let d = 1e9; for (const a of row) for (const b of row) if (ships[a[0]].n !== ships[b[0]].n && !a[7] && !b[7]) d = Math.min(d, dist(a, b)); return d; };
  // dead air in the last third
  { let prev = T3, best = 0, bs = T3; for (const x of act.filter(x => x >= T3).concat([len])) { if (x - prev > best) { best = x - prev; bs = prev; } prev = x; }
    const i0 = smp.findIndex(s => s[0] >= bs); let i1 = smp.findIndex(s => s[0] >= bs + best); if (i1 < 0) i1 = smp.length - 1;
    const d0 = i0 >= 0 ? nearestEnemy(at(i0)) : null, d1 = i1 >= 0 ? nearestEnemy(at(i1)) : d0;
    out.dead = { gap: Math.round(best), from: Math.round(bs), d0: d0 && Math.round(d0), d1: d1 && Math.round(d1) }; }
  // finish-off failure: loser broken or crippled ships afloat, winner has fit gun ships, no hit on the loser for >= 60 s
  const W = r.winner, L = W === 'USN' ? 'IJN' : W === 'IJN' ? 'USN' : null;
  if (L) {
    const hitsL = ev.filter(e => e[1] === 'hit' && e[2] === L).map(e => e[0]);
    let best = 0, bt = 0, run0 = null, closing = null, bb = false;
    for (let i = 0; i < smp.length; i++) {
      const [tt, row, sd] = smp[i];
      const lo = row.filter(a => ships[a[0]].n === L && !a[7] && ships[a[0]].type !== 'submarine'), wg = row.filter(a => ships[a[0]].n === W && GUN[ships[a[0]].type] && a[5] >= CRIP && !a[7]);
      const beaten = sd[L] && (sd[L][1] > 0 || lo.some(a => a[5] < CRIP)), broke = sd[L] && sd[L][1] > 0;
      const lastHit = hitsL.filter(x => x <= tt).pop() || 0;
      if (beaten && lo.length && wg.length && tt - lastHit >= 60) { if (run0 === null) run0 = tt; if (tt - run0 + 60 > best) { best = tt - run0 + 60; bt = run0 - 60; bb = broke; let dmin = 1e9; for (const a of wg) for (const b of lo) dmin = Math.min(dmin, dist(a, b)); closing = Math.round(dmin); } }
      else run0 = null;
    }
    out.finish = { gap: Math.round(best), from: Math.round(bt), dmin: closing, broken: bb };
    const brk = smp.length && smp[smp.length - 1][2][L] ? smp[smp.length - 1][2][L][1] : 0;
    if (brk) { const deadIn = act.filter(x => x >= brk); let prev = brk, mx = 0; for (const x of deadIn.concat([len])) { mx = Math.max(mx, x - prev); prev = x; } out.retire = { brk: Math.round(brk), tail: Math.round(len - brk), maxDead: Math.round(mx), end: r.end }; }
  }
  // time ending with ships in reach
  if (r.end === 'time' && smp.length) { const d = nearestEnemy(at(smp.length - 1)); out.timeEnd = { d: Math.round(d) }; }
  // standoff: an enemy within 300 of an own ship, no damage for >= 60 s
  { let best = 0, bt = 0, run0 = null, kinds = '';
    for (let i = 0; i < smp.length; i++) { const [tt, row] = smp[i]; const d = nearestEnemy(row); const lh = dmg.filter(x => x <= tt).pop() || 0;
      if (tt >= T3 && d < 300 && tt - lh >= 60) { if (run0 === null) run0 = tt; if (tt - run0 + 60 > best) { best = tt - run0 + 60; bt = run0 - 60; kinds = [...new Set(row.filter(a => !a[7]).map(a => ships[a[0]].n[0] + ':' + ships[a[0]].type))].join(','); } } else run0 = null; }
    out.standoff = { gap: Math.round(best), from: Math.round(bt), kinds }; }
  // stuck / spinning
  { const st = {}, sp = []; let stuck = [];
    for (let i = 0; i < smp.length; i++) for (const a of smp[i][1]) { const k = a[0]; const s = st[k] || (st[k] = { slow: 0, h: [] });
      if (a[3] < 0.3 && !a[7] && !a[8] && !a[11] && a[5] > 0.05) { s.slow += 2; if (s.slow === 20) stuck.push([ships[k].n, ships[k].type, smp[i][0] - 20, +a[5].toFixed(2)]); } else s.slow = 0;
      s.h.push([smp[i][0], a[10]]); }
    for (const k in st) { const H = st[k].h; for (let i = 15; i < H.length; i++) { let tot = 0; for (let j = i - 14; j <= i; j++) { let d = H[j][1] - H[j - 1][1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; tot += d; } if (Math.abs(tot) > 4 * Math.PI) { sp.push([ships[k].n, ships[k].type, H[i][0] - 30]); break; } } }
    out.stuck = stuck; out.spin = sp; }
  // hulks
  { const st = {}, hulk = []; const lastRow = smp.length ? smp[smp.length - 1][1] : [];
    for (const [tt, row] of smp) for (const a of row) { const bad = (a[5] < 0.15 || a[6] >= 3) && !a[7]; const s = st[a[0]] || (st[a[0]] = { run: 0, max: 0, t: 0 }); if (bad) { s.run += 2; if (s.run > s.max) { s.max = s.run; s.t = tt - s.run; } } else s.run = 0; }
    for (const a of lastRow) if (!a[7] && st[a[0]] && st[a[0]].max >= 60) hulk.push([ships[a[0]].n, ships[a[0]].type, st[a[0]].t, st[a[0]].max, +a[5].toFixed(2), a[6]]);
    out.hulk = hulk; }
  // the last sinking
  { const sk = ev.filter(e => e[1] === 'sunk'); if (sk.length) { const s = sk[sk.length - 1]; const i = smp.findIndex(q => q[0] >= s[0]); const row = at(Math.max(0, i - 1)); let dn = 1e9; for (const a of row) if (a[0] !== s[3] && !a[7]) dn = Math.min(dn, Math.hypot(a[1] - s[4], a[2] - s[5]));
    const near = act.filter(x => x >= s[0] - 10 && x <= s[0]).length; out.lastSink = { t: s[0], type: s[6], n: s[2], nearest: Math.round(dn), toEnd: Math.round(len - s[0]), act10: near }; } }
  // abrupt end
  if (end) { const sh5 = ev.filter(e => (e[1] === 'shell' || e[1] === 'drop') && e[0] >= end.t - 5).length; out.abrupt = { att: end.att, torps: end.torps, shells5: sh5 }; }
  // carriers hiding in the last third
  { const cv = {}; for (const [tt, row, , launch] of smp) { if (tt < T3) continue; for (const a of row) { if (ships[a[0]].type !== 'carrier' || a[7]) continue; let d = 1e9; for (const b of row) if (ships[b[0]].n !== ships[a[0]].n && !b[7]) d = Math.min(d, dist(a, b)); const c = cv[a[0]] || (cv[a[0]] = { n: 0, far: 0, launch: 0, planes: a[9] }); c.n++; if (d > 900) c.far++; if (launch.includes(a[0])) c.launch++; c.planes = a[9]; } }
    out.cvHide = Object.entries(cv).filter(([, c]) => c.n >= 10 && c.far >= 0.9 * c.n && !c.launch).map(([k, c]) => [ships[k].n, c.n * 2, c.planes]); }
  // air cover: a fit planeless carrier while not broken; air-cover breaks
  { const pl = {}; let breaks = [];
    for (const [tt, row, sd] of smp) for (const n of ['USN', 'IJN']) { const cvs = row.filter(a => ships[a[0]].n === n && ships[a[0]].type === 'carrier' && !a[7]); const fit = cvs.filter(a => a[5] >= CRIP);
      if (fit.length && fit.every(a => a[9] <= 2) && sd[n] && !sd[n][1]) pl[n] = (pl[n] || 0) + 2; }
    for (const n of ['USN', 'IJN']) { const i = smp.findIndex(s => s[2][n] && s[2][n][1] > 0); if (i < 0) continue; const s = smp[i], B = s[2][n]; const fitCV = s[1].some(a => ships[a[0]].n === n && ships[a[0]].type === 'carrier' && a[5] >= CRIP && !a[7]);
      if (B[5] && !fitCV && B[3] >= 0.15 * B[4]) breaks.push([n, Math.round(B[1]), Math.round(len - B[1]), B[3], B[4]]); }
    out.airCover = { planeless: pl, breaks }; }
  return out;
}

async function runAll(list) {
  const b = await HL.launch(), errs = [], res = new Array(list.length);
  let next = 0;
  async function worker() {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    p.on('pageerror', e => errs.push('PAGE ' + e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install);
    while (next < list.length) {
      const i = next++, spec = list[i];
      const o = await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, end: o.end, rec: window.__es.flush() }; }, spec);
      o.scen = spec.scen; o.seed = spec.seed; o.tod = o.rec.tod; o.launched = o.rec.launched; o.a = analyse(o); o.err = o.rec.err; o.last = o.rec.last; delete o.rec;
      res[i] = o;
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

function report(R) {
  const say = s => console.log(s), N = R.length, ex = (L, f) => L.slice(0, 4).map(f).join('; ');
  const scens = [...new Set(R.map(r => r.scen))];
  say(`ENDGAME SURVEY: ${N} rounds, recorder errors ${R.reduce((s, r) => s + r.err, 0)} ${R.find(r => r.last) ? R.find(r => r.last).last.split('\n')[0] : ''}`);
  say('ends by scenario (kill/retire/time/stall/cap) and median length:');
  for (const s of scens) { const L = R.filter(r => r.scen === s), c = k => L.filter(r => r.end === k).length, ln = L.map(r => r.len).sort((a, b) => a - b); say(`  ${s.padEnd(18)} n ${L.length}  ${c('kill')}/${c('retire')}/${c('time')}/${c('stall')}/${c('cap')}  len p50 ${ln[ln.length >> 1]}`); }
  const pat = (name, test, f, sort) => { const L = R.filter(r => test(r.a, r)); if (sort) L.sort(sort); say(`\n${name}: ${L.length}/${N} (${(100 * L.length / N).toFixed(0)}%)  by scen: ${scens.map(s => s + ' ' + L.filter(r => r.scen === s).length).filter(x => !x.endsWith(' 0')).join(', ')}`); say('  e.g. ' + ex(L, r => `${r.scen} ${r.seed} ${f(r.a, r)}`)); return L; };
  pat('finish-off failure (beaten enemy afloat, no hit on it >= 60 s, winner fit gun ships)', a => a.finish && a.finish.gap >= 60, (a, r) => `t${a.finish.from} ${a.finish.gap}s dmin ${a.finish.dmin} end ${r.end}@${r.len}`, (x, y) => y.a.finish.gap - x.a.finish.gap);
  pat('  ... >= 120 s', a => a.finish && a.finish.gap >= 120, (a, r) => `t${a.finish.from} ${a.finish.gap}s dmin ${a.finish.dmin} end ${r.end}@${r.len}`, (x, y) => y.a.finish.gap - x.a.finish.gap);
  pat('dead air in the last third >= 60 s (no shell at a ship, drop or hit)', a => a.dead.gap >= 60, (a, r) => `t${a.dead.from} ${a.dead.gap}s nearest enemy ${a.dead.d0}->${a.dead.d1} end ${r.end}@${r.len}`, (x, y) => y.a.dead.gap - x.a.dead.gap);
  pat('  ... >= 120 s', a => a.dead.gap >= 120, (a, r) => `t${a.dead.from} ${a.dead.gap}s nearest ${a.dead.d0}->${a.dead.d1} ${r.end}@${r.len}`, (x, y) => y.a.dead.gap - x.a.dead.gap);
  pat('  ... drifting apart (gap >= 60 s and nearest enemy grew > 100)', a => a.dead.gap >= 60 && a.dead.d1 - a.dead.d0 > 100, (a, r) => `t${a.dead.from} ${a.dead.gap}s ${a.dead.d0}->${a.dead.d1} ${r.end}@${r.len}`);
  const rt = R.filter(r => r.a.retire); const tails = rt.map(r => r.a.retire.tail).sort((a, b) => a - b);
  say(`\nbreak to end: ${rt.length} rounds with a broken loser, tail p50 ${tails[tails.length >> 1]} p90 ${tails[Math.floor(tails.length * 0.9)]}`);
  pat('long retirement (break to end >= 120 s with a dead stretch >= 60 s)', a => a.retire && a.retire.tail >= 120 && a.retire.maxDead >= 60, (a, r) => `brk ${a.retire.brk} tail ${a.retire.tail} dead ${a.retire.maxDead} ${a.retire.end}`, (x, y) => y.a.retire.tail - x.a.retire.tail);
  pat('time ending with enemies within 500', (a, r) => r.end === 'time' && a.timeEnd && a.timeEnd.d < 500, a => `nearest ${a.timeEnd.d}`);
  pat('time ending (any)', (a, r) => r.end === 'time' || r.end === 'cap', (a, r) => `nearest ${a.timeEnd ? a.timeEnd.d : '-'} len ${r.len}`);
  pat('standoff in the last third (enemy within 300, no damage >= 60 s)', a => a.standoff.gap >= 60, a => `t${a.standoff.from} ${a.standoff.gap}s ${a.standoff.kinds}`, (x, y) => y.a.standoff.gap - x.a.standoff.gap);
  pat('  ... >= 120 s', a => a.standoff.gap >= 120, a => `t${a.standoff.from} ${a.standoff.gap}s ${a.standoff.kinds}`, (x, y) => y.a.standoff.gap - x.a.standoff.gap);
  pat('stuck ship (< 0.3 u/s for >= 20 s, not sinking / rescuing / dived)', a => a.stuck.length, a => JSON.stringify(a.stuck.slice(0, 2)));
  pat('spinning ship (> 720 deg in 30 s)', a => a.spin.length, a => JSON.stringify(a.spin.slice(0, 2)));
  pat('hulk afloat at the end (< 15% hp or 3+ fires for >= 60 s)', a => a.hulk.length, a => JSON.stringify(a.hulk.slice(0, 2)));
  const ls = R.filter(r => r.a.lastSink); const te = ls.map(r => r.a.lastSink.toEnd).sort((a, b) => a - b);
  say(`\nlast sinking -> round end: p50 ${te[te.length >> 1]} p90 ${te[Math.floor(te.length * 0.9)]} s (${ls.length} rounds with a sinking)`);
  pat('last sinking far from every other ship (> 300) with no other action in its last 10 s', a => a.lastSink && a.lastSink.nearest > 300 && a.lastSink.act10 === 0, a => `t${a.lastSink.t} ${a.lastSink.n} ${a.lastSink.type} nearest ${a.lastSink.nearest}`);
  pat('last sinking then >= 90 s to the end', a => a.lastSink && a.lastSink.toEnd >= 90, (a, r) => `t${a.lastSink.t} ${a.lastSink.type} +${a.lastSink.toEnd}s ${r.end}`);
  pat('abrupt ending (bombers attacking / torpedoes running / shells in the last 5 s)', a => a.abrupt && (a.abrupt.att || a.abrupt.torps || a.abrupt.shells5), (a, r) => `${r.end}@${r.len} att ${a.abrupt.att} torps ${a.abrupt.torps} shells5 ${a.abrupt.shells5}`);
  pat('carrier hiding in the last third (> 900 from every enemy, no launch)', a => a.cvHide.length, a => JSON.stringify(a.cvHide));
  pat('fit planeless carrier counted as air cover (side not broken) >= 60 s', a => Object.values(a.airCover.planeless).some(v => v >= 60), a => JSON.stringify(a.airCover.planeless));
  const tc = L => ['day', 'dawn', 'dusk', 'night'].map(k => k + ' ' + L.filter(r => r.tod === k).length).join(', ');
  say(`\ntime of day: all rounds ${tc(R)}`);
  say(`  time endings > 300 s: ${tc(R.filter(r => (r.end === 'time' || r.end === 'cap') && r.len > 300))}`);
  say(`  dead air >= 120 s in the last third: ${tc(R.filter(r => r.a.dead.gap >= 120))}`);
  say(`  rounds with no plane launched though a side has a carrier: ${R.filter(r => r.launched === 0 && /carrier|standard|midway|cv/.test(r.scen)).map(r => r.scen + ' ' + r.seed + ' ' + r.tod).join('; ')}`);
  pat('finish-off failure with the loser BROKEN (>= 60 s)', a => a.finish && a.finish.gap >= 60 && a.finish.broken, (a, r) => `t${a.finish.from} ${a.finish.gap}s dmin ${a.finish.dmin} ${r.tod} end ${r.end}@${r.len}`, (x, y) => y.a.finish.gap - x.a.finish.gap);
  pat('break by the air-cover rule (no fit carrier, fit gun tons >= 15% of start)', a => a.airCover.breaks.length, (a, r) => JSON.stringify(a.airCover.breaks) + ' ' + r.end + '@' + r.len);
}

(async () => {
  const list = [];
  for (const [n, sc] of Object.entries(MAIN)) if (!ONLY || ONLY.split(',').includes(n)) for (let s = 1; s <= SEEDS; s++) list.push(specFor(n, sc, s));
  for (const [n, sc] of Object.entries(ODDS)) if (!ONLY || ONLY.split(',').includes(n)) for (let s = 1; s <= ODD; s++) list.push(specFor(n, sc, s));
  console.log(`endgame survey: ${list.length} rounds (${HL.label()})`);
  const t0 = Date.now(), R = await runAll(list);
  report(R);
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const dir = path.join(__dirname, 'shots', 'airdiag', 'survey'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(JSON_OUT || path.join(dir, 'survey.json'), JSON.stringify(R));
})();
