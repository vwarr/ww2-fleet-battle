// Air defence probe (docs/ARCHITECTURE.md "Air defence"): how a raid fares against the CAP over the ships it
// attacks, whether fighters near a carrier sit idle while bombers are in reach, the circling swarms (largest orbit
// cluster), the landing pattern, and how close the ships of a side bunch under an air attack.
// The recorder is read-only (no WW.rand, no writes to sim objects: its own per-plane state lives in Maps), like tests/flight_review_rec.js.
//
// Usage: node tests/air_defense.js [--seeds N=5] [--seed0 S=1] [--only standard,carrier_duel,midway] [--workers K] [--json FILE]
// Per raider (an armed carrier / base bomber sortie): engaged by a fighter before its drop, shot down armed,
// jettisoned, dropped; bucketed by the defending fighters within CAP_R of its target as it comes within 150 of it.
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');

const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 5), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', 'standard,carrier_duel,midway').split(',');
const JSON_OUT = arg('--json', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  const s = sc.random ? { seed, random: true, light: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  s.scen = name;
  return s;
}

// ======================= PAGE SIDE =======================
function install() {
  const R = window.__ad = { err: 0 };
  const DT = 0.25, CAP_R = 250, NEAR_T = 150, REACH = 120, CL = 50, CIRC_W = 40;
  const armed = u => u && u.alive && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance;
  const now = () => WW.game.roundTime;
  const up = p => p.alive && !p.removed && (p.state === 'transit' || p.state === 'attack' || p.state === 'return' || (p.state === 'landing' && p.deckPh === 'marshal'));
  const tgtOf = p => (p.wave && p.wave.target) || p.target || null;
  const L = () => WW.cfg.L || 26;
  let S = null;
  function cvD(p) { let d = 1e9; for (const s of WW.world.ships) if (s.alive && s.type === 'carrier' && !s.isBase && s.nation !== p.nation) d = Math.min(d, WW.dist(p.x, p.z, s.x, s.z)); return d < 1e9 ? Math.round(d) : null; }
  function fresh() {
    S = { raid: new Map(), ring: new Map(), next: 0, slow: 0, idle: {}, swarm: [], swarmPh: {}, clump: { under: [], calm: [] }, pile: { under: 0, underN: 0, calm: 0, calmN: 0 },
      patt: [], lqMax: [], trapGap: [], trapLast: new Map(), modeT: {}, ldOut: { landed: 0, inStack: 0 }, armedL: { USN: 0, IJN: 0 }, bombers0: { USN: 0, IJN: 0 }, overhead: [] };
  }
  fresh();
  WW.on('roundStart', fresh);
  function rr(p) {
    let r = S.raid.get(p);
    if (!r) { r = { n: p.nation, k: p.kind, o: p.carrier && p.carrier.isBase ? 'base' : 'cv', eng: false, engD: null, fate: null, cap: null, over: null, tt: null, t0: now(), detD: null, vecD: null, vecC: null, engC: null, hit: null, downAfter: false }; S.raid.set(p, r); }
    return r;
  }
  const L0 = WW.air.launch;
  WW.air.launch = function (cv) {
    const p = L0.apply(this, arguments);
    try { if (p && S && p.ordnance && (p.kind === 'dive' || p.kind === 'torpedo')) { rr(p); if (!cv.isBase) S.armedL[p.nation]++; } } catch (e) { R.err++; R.last = String(e.stack); }
    return p;
  };
  const proj = new Map(), adT = new WeakMap();
  WW.on('weaponDropped', e => { try { if (S && e && e.plane && S.raid.has(e.plane)) { const r = S.raid.get(e.plane); if (!r.fate) { r.fate = 'dropped'; r.hit = 'miss'; if (e.proj) proj.set(e.proj, r); } } } catch (er) { R.err++; } });
  WW.on('weaponImpact', e => { try { if (!e || !proj.has(e.proj)) return; const r = proj.get(e.proj); proj.delete(e.proj); if (e.ship && e.ship.nation !== r.n && !e.dud) r.hit = 'hit'; } catch (er) { R.err++; } });
  const PP = WW.Plane.prototype, SD0 = PP.shotDown;
  PP.shotDown = function () { try { if (S && this.alive && S.raid.has(this)) { const r = S.raid.get(this); if (!r.fate) r.fate = this.ordnance ? 'killed' : r.fate; else r.downAfter = true; } } catch (e) { R.err++; } return SD0.apply(this, arguments); };

  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    try { if (S && WW.game && WW.game.state === 'battle') while (now() >= S.next) { S.next += DT; sample(); } } catch (e) { R.err++; R.last = String(e.stack); }
    return r0;
  };
  function sample() {
    const t = now(), P = WW.world.planes, live = P.filter(p => p.alive && !p.removed);
    if (!S.b0) { S.b0 = true; for (const s of WW.world.ships) if (s.hangar && !s.isBase && s.type === 'carrier') S.bombers0[s.nation] += (s.hangar.dive || 0) + (s.hangar.torpedo || 0); }
    // raiders: engaged, jettisoned, defenders when they reach their target
    for (const p of live) if (p.kind === 'fighter' && p.foe && armed(p.foe) && S.raid.has(p.foe)) { const r = S.raid.get(p.foe); if (!r.eng) { r.eng = true; const tg = tgtOf(p.foe); r.engD = tg ? Math.round(WW.dist(p.foe.x, p.foe.z, tg.x, tg.z)) : null; r.engC = cvD(p.foe); } }
    const det = {}; for (const n of ['USN', 'IJN']) { det[n] = new Set(); if (WW.intel) for (const c of WW.intel.enemyPlanes(n)) det[n].add(c.unit); }
    const vec = new Set(); for (const q of live) if (q.vec) vec.add(q.vec);
    for (const [p, r] of S.raid) {
      if (r.fate) continue;
      const tg0 = tgtOf(p), dn = p.nation === 'USN' ? 'IJN' : 'USN';
      if (tg0 && r.detD === null && det[dn].has(p)) r.detD = Math.round(WW.dist(p.x, p.z, tg0.x, tg0.z));
      if (tg0 && r.vecD === null && vec.has(p)) { r.vecD = Math.round(WW.dist(p.x, p.z, tg0.x, tg0.z)); r.vecC = cvD(p); }
      if (!p.alive || p.removed) { r.fate = 'other'; continue; }
      if (!p.ordnance) { r.fate = 'jettison'; continue; }
      const tg = tgtOf(p);
      if (r.cap === null && tg && tg.alive && (tg.stats || tg.isBase) && WW.dist(p.x, p.z, tg.x, tg.z) < NEAR_T) {
        let n = 0, o = 0;
        for (const q of live) {
          if (WW.dist(q.x, q.z, tg.x, tg.z) > CAP_R) continue;
          if (up(q)) o++;
          if (q.nation !== p.nation && q.kind === 'fighter' && (q.state === 'transit' || q.state === 'attack')) n++;
        }
        r.cap = n; r.over = o; r.tt = tg.isBase ? 'base' : tg.type;
      }
    }
    // idle fighters: own fighters within REACH of an armed raider closing on (within 200 of) one of their carriers
    for (const n of ['USN', 'IJN']) {
      const cvs = WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === n && s.type === 'carrier' && !s.isBase);
      if (!cvs.length) continue;
      const raiders = live.filter(q => q.nation !== n && armed(q) && cvs.some(c => WW.dist(q.x, q.z, c.x, c.z) < 200));
      if (!raiders.length) continue;
      const I = S.idle[n] || (S.idle[n] = { t: 0, eng: 0, idle: 0, esc: 0, patt: 0, ret: 0, n: 0 });
      for (const f of live) {
        if (f.nation !== n || f.kind !== 'fighter' || !up(f)) continue;
        if (!raiders.some(q => WW.dist(q.x, q.z, f.x, f.z) < REACH)) continue;
        I.n++;
        if (f.foe && f.foe.alive) I.eng++;
        else if (f.state === 'landing') I.patt++;
        else if (f.state === 'return') I.ret++;
        else if (f.target) I.esc++;
        else I.idle++;
      }
      I.t += DT;
    }
    // circling: trailing 10 s path with net / path < 0.4; the largest cluster of circling planes (single link CL)
    const circ = [];
    for (const p of live) {
      if (p.state === 'takeoff' || p.state === 'rollout') { S.ring.delete(p); continue; }
      let g = S.ring.get(p); if (!g) S.ring.set(p, g = { a: [], cum: 0, lx: p.x, lz: p.z });
      g.cum += Math.hypot(p.x - g.lx, p.z - g.lz); g.lx = p.x; g.lz = p.z;
      g.a.push([p.x, p.z, g.cum]); if (g.a.length > CIRC_W + 1) g.a.shift();
      if (g.a.length > CIRC_W) { const o = g.a[0], path = g.cum - o[2]; if (path > 40 && Math.hypot(p.x - o[0], p.z - o[1]) < 0.4 * path) circ.push(p); }
    }
    if (t >= S.slow) {
      S.slow = t + 1;
      const seen = new Set(); let best = 0, bestPh = null;
      for (const p of circ) {
        if (seen.has(p)) continue;
        const st = [p], cl = []; seen.add(p);
        while (st.length) { const a = st.pop(); cl.push(a); for (const b of circ) if (!seen.has(b) && Math.abs(a.x - b.x) < CL && Math.abs(a.z - b.z) < CL && WW.dist(a.x, a.z, b.x, b.z) < CL) { seen.add(b); st.push(b); } }
        if (cl.length > best) {
          best = cl.length; const ph = {};
          for (const q of cl) { const k = q.state === 'landing' ? 'marshal' : q.state === 'return' ? 'return' : q.kind === 'fighter' && !q.target ? (q.foe ? 'fight' : 'cap') : q.sk === 'form' && q.wave && !q.wave.go ? 'formup' : q.foe ? 'fight' : q.state; ph[k] = (ph[k] || 0) + 1; }
          bestPh = Object.keys(ph).sort((x, y) => ph[y] - ph[x])[0];
          if (bestPh === 'marshal' && cl.length > 12) { const cv = new Set(cl.map(q => q.carrier)), tr = new Set(cl.filter(q => q.state === 'landing').map(q => q.carrier.id + ':' + q.mTrack + ':' + q.deckPh)); bestPh = 'marshal(' + cv.size + 'cv,' + tr.size + 'tr)'; }
        }
      }
      S.swarm.push(best); if (best > 12) S.swarmPh[bestPh] = (S.swarmPh[bestPh] || 0) + 1;
      // planes over a carrier: airborne (incl. the stack) within 250
      for (const s of WW.world.ships) if (s.alive && s.type === 'carrier' && !s.isBase) { let o = 0, f = 0; for (const q of live) if (q.nation === s.nation && up(q) && WW.dist(q.x, q.z, s.x, s.z) < CAP_R) { o++; } S.overhead.push(o); }
      for (const s of WW.world.ships) if (s._deck && s.alive) { S.lqMax.push(s._deck.lq.length); const m = s._deck.mode + (s._deck.lq.length >= 3 ? '+stack' : ''); S.modeT[m] = (S.modeT[m] || 0) + 1; }
      // ships: nearest friendly surface ship in hull lengths, under an air attack (armed raider within 150) or calm
      for (const n of ['USN', 'IJN']) {
        const sh = WW.world.ships.filter(s => s.alive && !s.sinking && !s.isBase && s.nation === n && s.type !== 'submarine' && s.type !== 'battery' && s.type !== 'pt');
        if (sh.length < 2) continue;
        const under = live.some(q => q.nation !== n && armed(q) && sh.some(s => WW.dist(q.x, q.z, s.x, s.z) < 150));
        for (const s of sh) {
          let nd = 1e9; for (const o of sh) if (o !== s) nd = Math.min(nd, WW.dist(s.x, s.z, o.x, o.z));
          const v = nd / L(); (under ? S.clump.under : S.clump.calm).push(+v.toFixed(2));
          if (under) { S.pile.underN++; if (v < 1.2) S.pile.under++; } else { S.pile.calmN++; if (v < 1.2) S.pile.calm++; }
        }
      }
    }
    // landing pattern: time from joining the stack to the trap
    for (const p of live) {
      if (p.state === 'landing') { if (!adT.has(p)) adT.set(p, t); }
      else if (p.state === 'rollout') { if (adT.has(p) && adT.get(p) >= 0) { S.patt.push(+(t - adT.get(p)).toFixed(1)); adT.set(p, -1);
        const c = p.carrier, D = c._deck, lt = S.trapLast.get(c); if (lt && D && lt.mode === 'recover' && D.lq.length >= 2 && lt.n === D.recN - 1) S.trapGap.push(+(t - lt.t).toFixed(2)); if (D) S.trapLast.set(c, { t, mode: D.mode, n: D.recN }); } }
      else if (adT.has(p) && adT.get(p) >= 0) adT.delete(p);   // left the stack (back into the fight): the next stint counts
    }
  }
  R.flush = function () {
    const raid = []; for (const r of S.raid.values()) raid.push(r);
    return { harry: WW.intercept ? Object.assign({}, WW.intercept.stats) : null, raid, idle: S.idle, swarm: S.swarm, swarmPh: S.swarmPh, clump: S.clump, pile: S.pile, patt: S.patt, lqMax: S.lqMax, trapGap: S.trapGap, modeT: S.modeT, endStack: WW.world.ships.reduce((n, s) => n + (s._deck ? s._deck.lq.length : 0), 0), armedL: S.armedL, bombers0: S.bombers0, overhead: S.overhead, err: R.err, last: R.last || null };
  };
  return true;
}

// ======================= NODE SIDE =======================
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
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed }, await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, rec: window.__ad.flush() }; }, spec));
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
const pc = v => (v === null || !isFinite(v) ? '-' : (100 * v).toFixed(0) + '%');

function report(rounds) {
  const out = {}, say = s => console.log(s);
  say(`AIR DEFENCE: ${rounds.length} rounds, recorder errors ${rounds.reduce((s, r) => s + r.rec.err, 0)}${rounds.find(r => r.rec.last) ? ' (' + rounds.find(r => r.rec.last).rec.last.split('\n')[0] + ')' : ''}`);
  // 1. raids against ships, by the defending fighters over the target
  const B = [[0, 0], [1, 5], [6, 11], [12, 23], [24, 999]], raid = [];
  for (const r of rounds) for (const x of r.rec.raid) if (x.cap !== null && x.tt !== 'base') raid.push(x);
  say('\n== 1. RAIDS on ships (armed bombers that came within 150 of a ship target), by enemy fighters within 250 of the target then ==');
  say('nation  CAP      n  engaged  eng@d p50  killed armed  jettison  dropped  other  hit/drop  hit/sortie  downed (any time)  det@d vec@d p50');
  out.raids = {};
  for (const n of ['USN', 'IJN', 'all']) for (const [lo, hi] of B) {
    const G = raid.filter(x => (n === 'all' || x.n === n) && x.cap >= lo && x.cap <= hi); if (!G.length) continue;
    const f = k => G.filter(x => x.fate === k).length / G.length, ed = G.filter(x => x.engD !== null).map(x => x.engD);
    const row = { n: G.length, eng: G.filter(x => x.eng).length / G.length, engD: qs(ed, 0.5), killed: f('killed'), jett: f('jettison'), dropped: f('dropped'), other: f('other') + G.filter(x => !x.fate).length / G.length,
      hitD: G.filter(x => x.hit === 'hit').length / Math.max(1, G.filter(x => x.fate === 'dropped').length), hitS: G.filter(x => x.hit === 'hit').length / G.length,
      down: G.filter(x => x.fate === 'killed' || x.downAfter).length / G.length, detD: qs(G.filter(x => x.detD !== null).map(x => x.detD), 0.5), vecD: qs(G.filter(x => x.vecD !== null).map(x => x.vecD), 0.5) };
    out.raids[n + ':' + lo] = row;
    say(`${n.padEnd(7)} ${(lo + '-' + (hi > 99 ? '' : hi)).padEnd(6)} ${String(row.n).padStart(4)}  ${pc(row.eng).padStart(7)}  ${String(row.engD === null ? '-' : row.engD).padStart(9)}  ${pc(row.killed).padStart(12)}  ${pc(row.jett).padStart(8)}  ${pc(row.dropped).padStart(7)}  ${pc(row.other).padStart(5)}  ${pc(row.hitD).padStart(8)}  ${pc(row.hitS).padStart(10)}  ${pc(row.down).padStart(17)}  ${String(row.detD)} ${String(row.vecD)}`);
  }
  const all = []; for (const r of rounds) for (const x of r.rec.raid) all.push(x);
  const vc = all.filter(x => x.vecC !== null).map(x => x.vecC), ec = all.filter(x => x.engC !== null).map(x => x.engC);
  say(`distance from the nearest enemy carrier: first vectored p10 ${qs(vc, 0.1)} p50 ${qs(vc, 0.5)} p90 ${qs(vc, 0.9)}, first engaged p10 ${qs(ec, 0.1)} p50 ${qs(ec, 0.5)} p90 ${qs(ec, 0.9)}`);
  out.vecC = qs(vc, 0.5); out.engC = qs(ec, 0.5);
  const fa = k => all.filter(x => x.fate === k).length;
  say(`all armed sorties (n ${all.length}): engaged before drop ${pc(all.filter(x => x.eng).length / all.length)}, killed armed ${pc(fa('killed') / all.length)}, jettisoned ${pc(fa('jettison') / all.length)}, dropped ${pc(fa('dropped') / all.length)}`);
  const hy = { releases: 0, harried: 0, harriedSum: 0 }; for (const r of rounds) if (r.rec.harry) for (const k in hy) hy[k] += r.rec.harry[k] || 0;
  say(`releases (dive / torpedo) harried by a fighter or damage: ${pc(hy.harried / hy.releases)} of ${hy.releases}, mean factor ${(hy.harriedSum / Math.max(1, hy.harried)).toFixed(2)}`);
  out.harried = hy.harried / hy.releases;
  const ov = []; for (const r of rounds) for (const v of r.rec.overhead) ov.push(v);
  say(`own planes airborne within 250 of a carrier (every 1 s): p50 ${qs(ov, 0.5)} p90 ${qs(ov, 0.9)} max ${qs(ov, 1)}`);
  out.overhead = { p50: qs(ov, 0.5), p90: qs(ov, 0.9), max: qs(ov, 1) };
  // 2. idle fighters
  say('\n== 2. FIGHTERS within 120 of an armed raider that is within 200 of their carrier (fighter-samples) ==');
  out.idle = {};
  for (const n of ['USN', 'IJN']) {
    const I = { n: 0, eng: 0, idle: 0, esc: 0, patt: 0, ret: 0 };
    for (const r of rounds) { const x = r.rec.idle[n]; if (x) for (const k in I) I[k] += x[k] || 0; }
    out.idle[n] = I;
    if (I.n) say(`${n}: n ${I.n}: engaged ${pc(I.eng / I.n)}, CAP with no foe (idle) ${pc(I.idle / I.n)}, escort ${pc(I.esc / I.n)}, returning ${pc(I.ret / I.n)}, in the marshal stack ${pc(I.patt / I.n)}`);
  }
  // 3. swarms and the landing pattern
  const sw = [], ph = {}, pt = [], lq = []; for (const r of rounds) { for (const v of r.rec.swarm) sw.push(v); for (const k in r.rec.swarmPh) ph[k] = (ph[k] || 0) + r.rec.swarmPh[k]; for (const v of r.rec.patt) pt.push(v); for (const v of r.rec.lqMax) lq.push(v); }
  say('\n== 3. SWARMS (largest cluster of circling planes, single link 50 u, every 1 s) and the landing pattern ==');
  say(`largest orbit cluster p50 ${qs(sw, 0.5)} p90 ${qs(sw, 0.9)} p99 ${qs(sw, 0.99)} max ${qs(sw, 1)}; seconds with a cluster > 12: ${sw.filter(v => v > 12).length} (${pc(sw.filter(v => v > 12).length / sw.length)}), by what most of it was doing ${JSON.stringify(ph)}`);
  say(`landing pattern (stack -> trap) p50 ${qs(pt, 0.5)} p90 ${qs(pt, 0.9)} s (n ${pt.length}); planes waiting to land per carrier p50 ${qs(lq, 0.5)} p90 ${qs(lq, 0.9)} max ${qs(lq, 1)}`);
  const tg = [], md = {}; let es = 0; for (const r of rounds) { for (const v of r.rec.trapGap) tg.push(v); for (const k in r.rec.modeT) md[k] = (md[k] || 0) + r.rec.modeT[k]; es += r.rec.endStack; }
  const mt = Object.values(md).reduce((a, b) => a + b, 0);
  say(`trap to trap inside one recovery window with 2+ waiting: p10 ${qs(tg, 0.1)} p50 ${qs(tg, 0.5)} p90 ${qs(tg, 0.9)} s (n ${tg.length}); deck mode (+stack: 3 or more waiting) ${Object.keys(md).sort().map(k => k + ' ' + pc(md[k] / mt)).join(', ')}; still in the stack at the round's end ${(es / rounds.length).toFixed(1)} per round`);
  out.trapGap = { p50: qs(tg, 0.5), p90: qs(tg, 0.9) }; out.deckMode = md; out.endStack = es / rounds.length;
  out.swarm = { p50: qs(sw, 0.5), p90: qs(sw, 0.9), max: qs(sw, 1), over12: sw.filter(v => v > 12).length / sw.length, ph }; out.patt = { p50: qs(pt, 0.5), p90: qs(pt, 0.9), n: pt.length }; out.lq = { p50: qs(lq, 0.5), p90: qs(lq, 0.9), max: qs(lq, 1) };
  // 4. ship dispersal
  const cu = [], cc = [], pl = { under: 0, underN: 0, calm: 0, calmN: 0 };
  for (const r of rounds) { for (const v of r.rec.clump.under) cu.push(v); for (const v of r.rec.clump.calm) cc.push(v); for (const k in pl) pl[k] += r.rec.pile[k]; }
  say('\n== 4. SHIPS: nearest friendly surface ship (hull lengths L) ==');
  say(`under air attack: p10 ${qs(cu, 0.1)} p50 ${qs(cu, 0.5)} p90 ${qs(cu, 0.9)} L, within 1.2 L ${pc(pl.under / pl.underN)} (n ${cu.length}); calm: p10 ${qs(cc, 0.1)} p50 ${qs(cc, 0.5)} p90 ${qs(cc, 0.9)} L, within 1.2 L ${pc(pl.calm / pl.calmN)}`);
  out.ships = { under: [qs(cu, 0.1), qs(cu, 0.5), qs(cu, 0.9)], calm: [qs(cc, 0.1), qs(cc, 0.5), qs(cc, 0.9)], pileUnder: pl.under / pl.underN, pileCalm: pl.calm / pl.calmN };
  // 5. bomber sorties per bomber
  const aL = { USN: 0, IJN: 0 }, b0 = { USN: 0, IJN: 0 }; for (const r of rounds) for (const n in aL) { aL[n] += r.rec.armedL[n]; b0[n] += r.rec.bombers0[n]; }
  say(`\narmed carrier bomber launches per bomber in the starting air groups: USN ${(aL.USN / b0.USN).toFixed(2)} IJN ${(aL.IJN / b0.IJN).toFixed(2)}`);
  out.sortiesPerBomber = { USN: aL.USN / b0.USN, IJN: aL.IJN / b0.IJN };
  return out;
}

if (require.main === module) {
  (async () => {
    const t0 = Date.now(), list = [];
    for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
    console.log(`air_defense: ${list.length} rounds (${HL.label()})`);
    const rounds = await runAll(list);
    const out = report(rounds);
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { install };
