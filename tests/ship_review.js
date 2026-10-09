// Ship movement review (docs/ARCHITECTURE.md "Ship movement review"): how well the fleets keep formation, how close
// ships come to each other, whether the guns fight broadside-on, what the main batteries shoot at, how a chase
// closes, where the AA escorts sit when a raid is known, and what sinks ships.
// The recorder is read-only (no WW.rand, no writes to sim objects: its own state lives in Maps), like air_defense.js.
//
// Usage: node tests/ship_review.js [--seeds N=5] [--seed0 S=1] [--only standard,carrier_duel,midway,surface,odd]
//        [--workers K] [--json FILE] [--trace SCEN:SEED]
//   --trace SCEN:SEED  also dump that round's ship tracks (every 1 s: position, heading, station, phase, role) to
//                      tests/shots/ship_trace_SCEN_SEED.json, for tests/ship_tracks.js.
// Metrics (per sample every 0.5 s of sim time; phase per side: 'surface' when an own gun ship has an enemy surface
// ship inside its main-battery range, else 'air' when an armed enemy bomber is within 150 of an own ship, else 'cruise'):
//   station   distance from the commander's station (a ring escort's live ring point), in L (WW.cfg.L, a carrier's
//             length), for ships on a station role (line / escort / asw / torpedo; not carriers): RMS over all, and
//             RMS over the samples with no target and no sub hunt (station keeping proper)
//   spacing   each surface ship's nearest own surface ship (BB / CA / DD / CV), in L: p1 / p5 / p50; near-collisions
//             per round: a pair of live hulls (either side) closer than NEAR_GAP between the hulls (once per pair
//             until they open past 1 L again)
//   coherence mean resultant length of the headings of a group (carrier group, main body; >= 3 ships) in cruise
//   broadside share of main-battery firing seconds (BB / CA) with the target 40-140 deg off the bow (A-arcs open)
//   pt        main-battery rounds at PT boats (BB / CA; DD reported apart: its 5-inch is the PT's answer)
//   chase     a ship whose target is beyond its main-gun range and opening or crossing: time until in range, against
//             a pure tail chase replayed on the same target track at the same speed (ratio < 1: the lead course pays)
//   aa        a carrier with an armed raid on its side's plot (intel, within 350, outside 60): the smallest angle
//             between a ring escort's bearing from the carrier and the raid's bearing
//   fatal     the fatal blow per sinking (shell / torpedo / bomb / other; 'fire/flood' when nothing hit that step)
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');

const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 5), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', 'standard,carrier_duel,midway,surface,odd').split(',');
const JSON_OUT = arg('--json', null), TRACE = arg('--trace', null);
const rep = (t, n) => Array(n).fill(t);
const ODD = [['dd_swarm_vs_bb', rep('destroyer', 8), ['battleship']], ['bb4_vs_bb4', rep('battleship', 4), rep('battleship', 4)],
  ['cv3_vs_bb2ca2', rep('carrier', 3), ['battleship', 'battleship', 'cruiser', 'cruiser']], ['asymmetric', ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3), 'submarine', 'pt', 'pt'], ['cruiser', 'destroyer', 'destroyer']],
  ['full_vs_pt2', ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer'], ['pt', 'pt', 'pt', 'pt']]];
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  surface: { A: ['battleship', 'battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer'], B: ['battleship', 'battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer'] },
  odd: { odd: true }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  let s;
  if (sc.random) s = { seed, random: true, light: true };
  else if (sc.odd) { const o = ODD[seed % ODD.length]; s = { seed, A: o[1], B: o[2], aNation: seed % 2 ? 'USN' : 'IJN', cripple: -1, noStall: false, base: null, light: true, label: o[0] }; }
  else s = { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  s.scen = name;
  return s;
}

// ======================= PAGE SIDE =======================
function install(opt) {
  const R = window.__sr = { err: 0 };
  const DT = 0.5, TR_DT = 1, NEAR_GAP = 0.15, AIR_R = 150, RAID_R = 350;
  const L = () => WW.cfg.L || 26, now = () => WW.game.roundTime;
  const GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, SURF = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 }, STATION = { line: 1, escort: 1, asw: 1, torpedo: 1 };
  const armed = u => u && u.alive && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance;
  let S = null;
  function fresh() {
    S = { next: 0, trNext: 0, st: { cruise: [], air: [], surface: [] }, stKeep: { cruise: [], air: [], surface: [] }, roleT: { cruise: 0, air: 0, surface: 0 }, roleN: { cruise: 0, air: 0, surface: 0 },
      nn: { cruise: [], air: [], surface: [] }, near: 0, nearSet: new Set(), coh: [], fire: new Map(), broad: 0, broadN: 0, ptMain: 0, ptMainDD: 0, mainShots: 0,
      chase: new Map(), chases: [], aa: [], lastHit: new Map(), fatal: {}, sunk: 0, trace: opt && opt.trace ? [] : null, fired: new Map(), air: [], phaseT: { cruise: 0, air: 0, surface: 0 } };
  }
  fresh();
  WW.on('roundStart', fresh);
  WW.on('shipHit', e => { try { if (S && e && e.ship) S.lastHit.set(e.ship, { t: WW.time.now, kind: e.kind || 'other' }); } catch (er) { R.err++; } });
  WW.on('shipSunk', s => { try { if (!S || !s || s.isBase) return; const h = S.lastHit.get(s), k = h && WW.time.now - h.t < 0.05 ? (h.kind === 'shell' || h.kind === 'torpedo' || h.kind === 'bomb' ? h.kind : 'other') : 'fire/flood'; S.fatal[k] = (S.fatal[k] || 0) + 1; S.sunk++; } catch (er) { R.err++; } });
  WW.on('shellFired', e => {
    try {
      if (!S || !e || !e.ship || !e.proj) return;
      const s = e.ship, g = s.stats.guns[0], t = e.proj.target;
      if (!g || e.cal !== g.cal || !t) return;
      if (S.trace && s.type === 'destroyer') S.fired.set(s, { t: WW.time.now, tg: t.id });
      if (t.type === 'pt') { if (s.type === 'battleship' || s.type === 'cruiser') S.ptMain++; else if (s.type === 'destroyer') S.ptMainDD++; }
      if (s.type !== 'battleship' && s.type !== 'cruiser') return;
      S.mainShots++;
      const k = s.id + ':' + Math.floor(WW.time.now);
      if (S.fire.has(k)) return;
      const rel = Math.abs(WW.angleDiff(s.heading, Math.atan2(t.z - s.z, t.x - s.x))) * 180 / Math.PI;
      S.fire.set(k, 1); S.broadN++; if (rel >= 40 && rel <= 140) S.broad++;
      if (S.trace) S.fired.set(s, { t: WW.time.now, tg: t.id });
    } catch (er) { R.err++; }
  });
  const U0 = WW.ships.update;
  WW.ships.update = function () {
    const r0 = U0.apply(this, arguments);
    try { if (S && WW.game && WW.game.state === 'battle') { while (now() >= S.next) { S.next += DT; sample(); } if (S.trace) while (now() >= S.trNext) { S.trNext += TR_DT; trace(); } } } catch (e) { R.err++; R.last = String(e.stack); }
    return r0;
  };
  function stationOf(s) {
    const o = WW.fleetCmd && WW.fleetCmd.order(s); if (!o) return null;
    if (o.role === 'escort' && o.ringR > 0 && WW.formation && WW.formation.ringPoint) { const p = WW.formation.ringPoint(o); if (p) return { x: p.x, z: p.z, o }; }
    return { x: o.sx, z: o.sz, o };
  }
  function phases() {
    const P = {}, ships = WW.world.ships, planes = WW.world.planes;
    for (const n of ['USN', 'IJN']) {
      let ph = 'cruise';
      for (const s of ships) {
        if (!s.alive || s.nation !== n || !GUN[s.type] || !s.stats.guns[0]) continue;
        const R2 = s.stats.guns[0].range * s.stats.guns[0].range;
        for (const o of ships) if (o.alive && o.nation !== n && !o.submerged && !o.isBase && o.type !== 'submarine' && WW.dist2(s.x, s.z, o.x, o.z) < R2) { ph = 'surface'; break; }
        if (ph === 'surface') break;
      }
      if (ph === 'cruise') {
        for (const p of planes) {
          if (p.nation === n || !armed(p) || p.removed) continue;
          for (const s of ships) if (s.alive && s.nation === n && SURF[s.type] && WW.dist2(s.x, s.z, p.x, p.z) < AIR_R * AIR_R) { ph = 'air'; break; }
          if (ph === 'air') break;
        }
      }
      P[n] = ph;
    }
    return P;
  }
  // distance between two hulls (keel segments, minus the half beams), sampled
  function gap(a, b) {
    let m = 1e9;
    const ca = Math.cos(a.heading), sa = Math.sin(a.heading), cb = Math.cos(b.heading), sb = Math.sin(b.heading), la = a.stats.length * 0.5, lb = b.stats.length * 0.5;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const ax = a.x + ca * la * i / 2, az = a.z + sa * la * i / 2, bx = b.x + cb * lb * j / 2, bz = b.z + sb * lb * j / 2;
      const d = Math.hypot(ax - bx, az - bz); if (d < m) m = d;
    }
    return m - (a.beam || 2) * 0.5 - (b.beam || 2) * 0.5;
  }
  function sample() {
    const t = now(), ships = WW.world.ships, Lu = L(), P = phases();
    for (const n in P) S.phaseT[P[n]] += DT;
    // station keeping
    for (const s of ships) {
      if (!s.alive || s.sinking || !SURF[s.type] || s.type === 'carrier' || s.isBase) continue;
      const st = stationOf(s); if (!st || !STATION[st.o.role]) continue;
      const ph = P[s.nation], d = WW.dist(s.x, s.z, st.x, st.z) / Lu;
      S.st[ph].push(d); S.roleN[ph]++;
      const busy = !!s.target || !!(s.ai && (s.ai.dcLeft > 0 || s.ai.dcSub)) || !!(s.ai && s.ai.withdrawing);
      if (busy) S.roleT[ph]++; else S.stKeep[ph].push(d);
    }
    // spacing: nearest own surface ship; near-collisions between any two live hulls
    const live = ships.filter(s => s.alive && !s.sinking && !s.isBase && !s.submerged && s.type !== 'battery');
    for (const s of live) {
      if (!SURF[s.type]) continue;
      let nd = 1e9;
      for (const o of live) if (o !== s && o.nation === s.nation && SURF[o.type]) { const d = WW.dist(s.x, s.z, o.x, o.z); if (d < nd) nd = d; }
      if (nd < 1e9) S.nn[P[s.nation]].push(nd / Lu);
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], k = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
      const R = (a.stats.length + b.stats.length) * 0.5 + Lu * 1.2;
      if (WW.dist2(a.x, a.z, b.x, b.z) > R * R) { S.nearSet.delete(k); continue; }
      const g = gap(a, b);
      if (g < NEAR_GAP * Lu) { if (!S.nearSet.has(k)) { S.nearSet.add(k); S.near++; } }
      else if (g > Lu) S.nearSet.delete(k);
    }
    // heading coherence in cruise
    if (WW.fleetCmd) for (const n of ['USN', 'IJN']) {
      if (P[n] !== 'cruise') continue;
      const B = WW.fleetCmd.side(n); if (!B || !B.groups) continue;
      for (const g of ['carrier', 'main']) {
        const m = (B.groups[g] && B.groups[g].members || []).filter(s => s.alive && !s.sinking && (!B.orders.get(s.id) || B.orders.get(s.id).role !== 'withdraw'));
        if (m.length < 3) continue;
        let cx = 0, cz = 0; for (const s of m) { cx += Math.cos(s.heading); cz += Math.sin(s.heading); }
        S.coh.push(Math.hypot(cx, cz) / m.length);
      }
    }
    // chases: target beyond main range and not closing faster than half our speed
    for (const s of ships) {
      if (!s.alive || !GUN[s.type] || !s.stats.guns[0]) continue;
      const tg = s.target, R0 = s.stats.guns[0].range;
      let c = S.chase.get(s);
      if (c && (c.t !== tg || !tg || !tg.alive)) { S.chase.delete(s); c = null; }
      if (!tg || !tg.alive || tg.submerged || tg.isBase) continue;
      const d = WW.dist(s.x, s.z, tg.x, tg.z);
      if (!c) {
        if (d < R0 * 1.15) continue;
        const away = Math.atan2(tg.z - s.z, tg.x - s.x), opening = Math.cos(tg.heading - away) * tg.speed; // target's speed away from us
        if (opening < -0.3 * s.stats.speed || s.stats.speed < tg.stats.speed * 0.9) continue;      // coming at us, or one we cannot catch
        c = { t: tg, t0: t, d0: d, vx: s.x, vz: s.z, vt: null, at: null, R: R0 }; S.chase.set(s, c);
      }
      if (c.vt === null) { // the pure-pursuit ghost: same speed, always straight at the target
        const vd = WW.dist(c.vx, c.vz, tg.x, tg.z), step = s.speed * DT;
        if (vd <= c.R) c.vt = t - c.t0; else { c.vx += (tg.x - c.vx) / vd * Math.min(step, vd); c.vz += (tg.z - c.vz) / vd * Math.min(step, vd); }
      }
      if (c.at === null && d <= c.R) c.at = t - c.t0;
      if (c.at !== null && c.vt !== null) { S.chases.push({ at: c.at, vt: c.vt, d0: Math.round(c.d0), type: s.type }); S.chase.delete(s); }
      else if (t - c.t0 > 180) S.chase.delete(s);
    }
    // AA escorts and the raid bearing
    if (WW.intel && WW.fleetCmd) for (const cv of ships) {
      if (!cv.alive || cv.type !== 'carrier' || cv.isBase) continue;
      let rx = 0, rz = 0, rn = 0;
      for (const c of WW.intel.enemyPlanes(cv.nation)) { const u = c.unit; if (!armed(u)) continue; const d = WW.dist(cv.x, cv.z, c.x, c.z); if (d > RAID_R || d < 60) continue; rx += c.x; rz += c.z; rn++; }
      if (!rn) continue;
      const rb = Math.atan2(rz / rn - cv.z, rx / rn - cv.x);
      let best = 1e9, ne = 0;
      for (const s of ships) { if (!s.alive || s === cv || s.nation !== cv.nation) continue; const o = WW.fleetCmd.order(s); if (!o || o.role !== 'escort' || o.ringCv !== cv) continue; ne++; const off = Math.abs(WW.angleDiff(rb, Math.atan2(s.z - cv.z, s.x - cv.x))) * 180 / Math.PI; if (off < best) best = off; }
      if (ne) S.aa.push({ n: cv.nation, off: Math.round(best), ne });
    }
  }
  function trace() {
    const t = +now().toFixed(1), P = phases();
    for (const p of WW.world.planes) if (armed(p) && !p.removed && (p.state === 'transit' || p.state === 'attack')) S.air.push([t, p.nation === 'USN' ? 'U' : 'I', p.kind[0], +p.x.toFixed(0), +p.z.toFixed(0)]);
    for (const s of WW.world.ships) {
      if (s.isBase || s.type === 'battery' || (!s.alive && !s.sinking)) continue;
      const st = s.alive ? stationOf(s) : null, o = st && st.o;
      S.trace.push([t, s.id, s.nation === 'USN' ? 'U' : 'I', s.type, s.sinking ? 'sinking' : P[s.nation], +s.x.toFixed(1), +s.z.toFixed(1), +s.heading.toFixed(2),
        st ? +st.x.toFixed(1) : null, st ? +st.z.toFixed(1) : null, o ? o.role : null, s.target ? s.target.id : null, o && o.ringCv ? o.ringCv.id : null,
        S.fired.has(s) && WW.time.now - S.fired.get(s).t < TR_DT ? S.fired.get(s).tg : null, +s.stats.length.toFixed(1), +(s.beam || 2).toFixed(1)]);
    }
  }
  R.flush = function () {
    for (const [s, c] of S.chase) if (c.at !== null && c.vt === null) S.chases.push({ at: c.at, vt: null, d0: Math.round(c.d0), type: s.type });
    return { st: S.st, stKeep: S.stKeep, roleT: S.roleT, roleN: S.roleN, nn: S.nn, near: S.near, coh: S.coh, broad: S.broad, broadN: S.broadN, ptMain: S.ptMain, ptMainDD: S.ptMainDD, mainShots: S.mainShots,
      chases: S.chases, aa: S.aa, fatal: S.fatal, sunk: S.sunk, phaseT: S.phaseT, trace: S.trace, air: S.trace ? S.air : null, err: R.err, last: R.last || null };
  };
  return true;
}

// ======================= NODE SIDE =======================
async function runAll(list, trace) {
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
    await p.evaluate(install, { trace });
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed, label: spec.label || null }, await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, rec: window.__sr.flush() }; }, spec));
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
const qs = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const rms = a => a.length ? Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length) : null;
const f2 = v => (v === null || v === undefined || !isFinite(v) ? '-' : v.toFixed(2));
const pc = v => (v === null || !isFinite(v) ? '-' : (100 * v).toFixed(0) + '%');

function report(rounds, label) {
  const out = {}, say = s => console.log(s), PH = ['cruise', 'air', 'surface'];
  say(`SHIP REVIEW${label ? ' (' + label + ')' : ''}: ${rounds.length} rounds, recorder errors ${rounds.reduce((s, r) => s + r.rec.err, 0)}${rounds.find(r => r.rec.last) ? ' (' + rounds.find(r => r.rec.last).rec.last.split('\n')[0] + ')' : ''}`);
  const cat = k => { const o = { cruise: [], air: [], surface: [] }; for (const r of rounds) for (const p of PH) for (const v of r.rec[k][p]) o[p].push(v); return o; };
  const st = cat('st'), sk = cat('stKeep'), nn = cat('nn');
  out.station = {}; out.spacing = {};
  say('== 1. STATION (L) ==  phase: RMS all / RMS keeping station (no target) / share of samples on a role (target, sub hunt, cripple) / n');
  for (const p of PH) {
    let rt = 0, rn = 0; for (const r of rounds) { rt += r.rec.roleT[p]; rn += r.rec.roleN[p]; }
    out.station[p] = { all: rms(st[p]), keep: rms(sk[p]), keepP50: qs(sk[p], 0.5), keepP90: qs(sk[p], 0.9), role: rn ? rt / rn : null, n: st[p].length };
    say(`  ${p.padEnd(8)} ${f2(out.station[p].all)} / ${f2(out.station[p].keep)} (p50 ${f2(out.station[p].keepP50)} p90 ${f2(out.station[p].keepP90)}) / ${pc(out.station[p].role)} / ${st[p].length}`);
  }
  say('== 2. SPACING: nearest own surface ship (L) p1 / p5 / p50, share under 1.2 L ==');
  const all = [].concat(nn.cruise, nn.air, nn.surface);
  for (const p of [...PH, 'all']) { const a = p === 'all' ? all : nn[p]; out.spacing[p] = { p1: qs(a, 0.01), p5: qs(a, 0.05), p50: qs(a, 0.5), u12: a.length ? a.filter(v => v < 1.2).length / a.length : null }; say(`  ${p.padEnd(8)} ${f2(out.spacing[p].p1)} / ${f2(out.spacing[p].p5)} / ${f2(out.spacing[p].p50)}  under 1.2 L ${pc(out.spacing[p].u12)}  (n ${a.length})`); }
  const near = rounds.reduce((s, r) => s + r.rec.near, 0);
  out.nearPerRound = near / rounds.length; say(`  near-collisions (hulls < 0.15 L apart) per round: ${out.nearPerRound.toFixed(2)} (${near})`);
  const coh = []; for (const r of rounds) for (const v of r.rec.coh) coh.push(v);
  out.coh = { mean: coh.length ? coh.reduce((a, b) => a + b, 0) / coh.length : null, p10: qs(coh, 0.1) };
  say(`== 3. COHERENCE in cruise (mean resultant length of group headings): mean ${f2(out.coh.mean)} p10 ${f2(out.coh.p10)} (n ${coh.length})`);
  let br = 0, bn = 0, pm = 0, pd = 0, ms = 0; for (const r of rounds) { br += r.rec.broad; bn += r.rec.broadN; pm += r.rec.ptMain; pd += r.rec.ptMainDD; ms += r.rec.mainShots; }
  out.broad = bn ? br / bn : null; out.ptMain = pm / rounds.length; out.ptMainDD = pd / rounds.length;
  say(`== 4. GUNS: BB / CA main-battery firing seconds with the A-arcs open (40-140 deg): ${pc(out.broad)} (n ${bn}); main-battery rounds at PT boats per round: BB / CA ${out.ptMain.toFixed(2)}, DD ${out.ptMainDD.toFixed(2)} (BB / CA main shells ${ms})`);
  const ch = []; for (const r of rounds) for (const c of r.rec.chases) ch.push(c);
  const both = ch.filter(c => c.vt !== null && c.at !== null), ratio = both.map(c => c.at / Math.max(1, c.vt));
  out.chase = { n: ch.length, both: both.length, ratioP50: qs(ratio, 0.5), ratioP25: qs(ratio, 0.25), ratioP75: qs(ratio, 0.75), atP50: qs(both.map(c => c.at), 0.5), vtP50: qs(both.map(c => c.vt), 0.5), ghostOnly: ch.filter(c => c.vt === null).length };
  say(`== 5. CHASE: ${ch.length} closed (${out.chase.ghostOnly} where the tail chase never got there); time to gun range / pure tail chase p25 ${f2(out.chase.ratioP25)} p50 ${f2(out.chase.ratioP50)} p75 ${f2(out.chase.ratioP75)}; actual p50 ${out.chase.atP50} s, tail chase p50 ${out.chase.vtP50} s`);
  out.aa = {};
  for (const n of ['USN', 'IJN']) { const a = []; for (const r of rounds) for (const x of r.rec.aa) if (x.n === n) a.push(x.off); out.aa[n] = { p50: qs(a, 0.5), p90: qs(a, 0.9), u45: a.length ? a.filter(v => v <= 45).length / a.length : null, n: a.length }; }
  say(`== 6. AA ESCORTS: nearest ring escort's bearing off the raid bearing (deg) USN p50 ${out.aa.USN.p50} p90 ${out.aa.USN.p90} within 45 ${pc(out.aa.USN.u45)} (n ${out.aa.USN.n}); IJN p50 ${out.aa.IJN.p50} p90 ${out.aa.IJN.p90} within 45 ${pc(out.aa.IJN.u45)} (n ${out.aa.IJN.n})`);
  const fa = {}; let sk2 = 0; for (const r of rounds) { for (const k in r.rec.fatal) fa[k] = (fa[k] || 0) + r.rec.fatal[k]; sk2 += r.rec.sunk; }
  out.fatal = fa; say(`== 7. FATAL BLOWS (${sk2} sunk): ${Object.keys(fa).sort().map(k => k + ' ' + fa[k]).join(', ')}`);
  const ph = { cruise: 0, air: 0, surface: 0 }; for (const r of rounds) for (const p of PH) ph[p] += r.rec.phaseT[p];
  out.phaseT = ph; say(`(side-seconds by phase: ${PH.map(p => p + ' ' + Math.round(ph[p])).join(', ')})`);
  return out;
}

if (require.main === module) {
  (async () => {
    const t0 = Date.now(), list = [];
    if (TRACE) { const [sc, sd] = TRACE.split(':'); list.push(specFor(sc, +sd)); }
    else for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
    console.log(`ship_review: ${list.length} rounds (${HL.label()})`);
    const rounds = await runAll(list, !!TRACE);
    const out = { all: report(rounds) };
    if (!TRACE && ONLY.length > 1) for (const sc of ONLY) { const R = rounds.filter(r => r.scen === sc); if (R.length) { console.log(''); out[sc] = report(R, sc); } }
    if (TRACE) {
      const r = rounds[0], f = path.join(__dirname, 'shots', `ship_trace_${r.scen}_${r.seed}.json`);
      fs.writeFileSync(f, JSON.stringify({ scen: r.scen, seed: r.seed, label: r.label, L: 26, rows: r.rec.trace, air: r.rec.air }));
      console.log('trace: ' + f + ' (' + r.rec.trace.length + ' rows)');
    }
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { install, report };
