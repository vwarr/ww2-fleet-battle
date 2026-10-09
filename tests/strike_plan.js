// Strike-planning review (the attacker's air staff): seeded rounds (sim-only, node runner by default) with a read-only
// recorder on every strike wave (air_strikes.js waves) and every carrier's air group. It never calls WW.rand and never
// writes to sim objects. Numbers (per nation):
//  - route exposure in transit (the wave guide, outside TGT_R of its target): AA dps-seconds from enemy ships and the
//    island base's AA pits (omniscient), seconds within BASE_R of an enemy base not the target, share of waves that
//    flew over such a base, share of waves with the base as the target
//  - losses: share of strike bombers killed before their drop, drops per bomber, by the enemy fighters airborne within
//    CAP_R of the target when the wave arrived (CAP buckets), escorts per bomber by the same buckets
//  - the next strike's size after a strike that lost >= 40% of its bombers (vs after one that did not)
//  - commitment: a wave's planes / its carrier's starting air group; the most strike planes (bombers + escorts with a
//    target) airborne at once / the side's starting carrier air groups; break-offs, mauled air groups
// Usage: node tests/strike_plan.js [--seeds N=12] [--seed0 S=1] [--only standard,midway,ijnbase,duel] [--workers K] [--json FILE]
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 12), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,midway,ijnbase,duel').split(',');
const JSON_OUT = arg('--json', path.join(__dirname, 'shots', 'strike_plan.json'));
const SCEN = {
  standard: { random: true },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'IJN' },
  duel: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'] }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  return sc.random ? { seed, random: true, light: true, scen: name } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true, scen: name };
}

// ---------------- the recorder (runs in the page) ----------------
function install() {
  const TGT_R = 120, BASE_R = 100, CAP_R = 150, DT = 0.5;
  let R = null, acc = 0, D = new WeakSet();
  const bomber = p => p.kind === 'dive' || p.kind === 'torpedo';
  function reset() {
    R = { waves: [], byW: new Map(), pl: new Map(), wing: {}, wingN: { USN: 0, IJN: 0 }, maxUp: { USN: 0, IJN: 0 }, orders: [], breaks: { USN: 0, IJN: 0 }, mauled: { USN: 0, IJN: 0 } };
  }
  function wingOf(cv) {
    if (R.wing[cv.id] !== undefined) return R.wing[cv.id];
    const h = cv.hangar || {}; let n = (h.fighter || 0) + (h.dive || 0) + (h.torpedo || 0);
    for (const p of WW.world.planes) if (p.carrier === cv) n++;
    R.wing[cv.id] = n; if (!cv.isBase) R.wingN[cv.nation] += n;
    return n;
  }
  function aaAt(nation, x, z, tgt) {   // enemy AA dps on a point (omniscient), the target's own area excluded by the caller
    let s = 0;
    const L = WW.islandBase ? WW.islandBase.shooters(WW.world.ships) : WW.world.ships;
    for (const o of L) {
      if (!o || !o.alive || o.sinking || o.nation === nation || !o.stats || !o.stats.aa || o === tgt) continue;
      const r = o.stats.aa.range * 1.3;
      if (WW.dist2(o.x, o.z, x, z) < r * r) s += o.stats.aa.dps || 0;
    }
    return s;
  }
  function track(w) {
    const B = WW.islandBase && WW.islandBase.base, t = w.target;
    let nb = 0, ne = 0;
    for (const p of w.members) if (p.alive) { if (bomber(p)) nb++; else if (p.kind === 'fighter') ne++; }
    const r = { nation: w.nation, base: !!w.carrier.isBase, t: +WW.game.roundTime.toFixed(0), tgt: t ? (t.isBase ? 'base' : t.type) : '-', nb, ne,
      wing: w.carrier.isBase ? 0 : wingOf(w.carrier), cvId: w.carrier.id, exp: 0, baseT: 0, overBase: false, minBase: 1e9,
      capArr: null, dropped: 0, killed: 0, jett: 0, mem: [], route: !!w.route, fuelOut: 0 };
    r.enemyBase = !!(B && B.nation !== w.nation);
    for (const p of w.members) if (p.alive && bomber(p)) { r.mem.push(p); R.pl.set(p, r); }
    R.waves.push(r); R.byW.set(w, r);
    if (!w.carrier.isBase) R.orders.push(r);
  }
  function sample(dt) {
    const B = WW.islandBase && WW.islandBase.base;
    for (const w of WW.strike._waves()) {
      if (!w.go) continue;
      if (!R.byW.has(w)) track(w);
      const r = R.byW.get(w), t = w.target;
      if (w.done || !t) continue;
      const dT = WW.dist(w.x, w.z, t.x, t.z);
      if (dT > TGT_R && !w.lead) {
        r.exp += aaAt(w.nation, w.x, w.z, t) * dt;
        if (B && B.nation !== w.nation && !t.isBase) { const db = WW.dist(w.x, w.z, B.x, B.z); r.minBase = Math.min(r.minBase, db); if (db < BASE_R) { r.baseT += dt; r.overBase = true; } }
      }
      if (r.capArr === null && dT < 200) {
        let n = 0; for (const p of WW.world.planes) if (p.alive && p.kind === 'fighter' && p.nation !== w.nation && p.y > 4 && WW.dist2(p.x, p.z, t.x, t.z) < CAP_R * CAP_R) n++;
        r.capArr = n;
      }
    }
    // strike planes in the air at once (carrier groups only)
    const up = { USN: 0, IJN: 0 };
    for (const p of WW.world.planes) if (p.alive && p.target && p.carrier && !p.carrier.isBase && p.y > 4 && p.state !== 'takeoff' && p.kind !== 'scout' && !p.search) up[p.nation]++;
    for (const n in up) if (R.wingN[n]) R.maxUp[n] = Math.max(R.maxUp[n], up[n] / R.wingN[n]);
  }
  WW.on('roundStart', reset);
  WW.on('weaponDropped', e => { const p = e && e.plane, r = p && R && R.pl.get(p); if (r && !D.has(p)) { D.add(p); r.dropped++; } });
  WW.on('airOrder', e => {
    if (!R || !e) return;
    if (e.order === 'jettison' && e.plane) { const r = R.pl.get(e.plane); if (r) r.jett++; }
    if (e.order === 'breakOff') R.breaks[e.carrier ? e.carrier.nation : 'USN']++;
    if (e.order === 'mauled' && e.carrier) R.mauled[e.carrier.nation]++;
  });
  const u0 = WW.air.update;
  WW.air.update = function (dt) {
    const r = u0.apply(this, arguments);
    if (R && WW.game && WW.game.state === 'battle') {
      for (const s of WW.world.ships) if (s.hangar && s.type === 'carrier') wingOf(s);
      acc += dt; if (acc >= DT) { sample(acc); acc = 0; }
    }
    return r;
  };
  window.__sp = {
    flush() {
      for (const r of R.waves) { for (const p of r.mem) if (!D.has(p) && p._downed) r.killed++; r.mem = null; if (r.minBase === 1e9) r.minBase = null; }
      const o = { waves: R.waves, maxUp: R.maxUp, wingN: R.wingN, breaks: R.breaks, mauled: R.mauled, orders: R.orders.map(r => ({ cv: r.cvId, nation: r.nation, n: r.nb, t: r.t, loss: r.nb ? (r.killed + r.jett) / r.nb : 0 })) };
      for (const r of o.orders) { delete r.mem; }
      return JSON.parse(JSON.stringify(o));
    }
  };
  reset();
}

// ---------------- run ----------------
async function runAll(list) {
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
    await p.evaluate(install);
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = await p.evaluate(spec => { const o = window.__beh.run(spec); return { scen: spec.scen, seed: spec.seed, winner: o.winner, len: o.len, lost: o.planesLost, flown: o.planesFlown, sp: window.__sp.flush() }; }, spec);
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
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const qs = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f = v => (v === null || v === undefined || Number.isNaN(v) ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
const pc = v => (v === null || v === undefined || Number.isNaN(v) ? '-' : (100 * v).toFixed(0) + '%');
function report(rounds) {
  const out = {};
  for (const scen of ONLY) {
    const RS = rounds.filter(r => r.scen === scen); if (!RS.length) continue;
    console.log(`\n== ${scen}: ${RS.length} rounds, USN ${RS.filter(r => r.winner === 'USN').length} / IJN ${RS.filter(r => r.winner === 'IJN').length}`);
    const S = out[scen] = {};
    for (const n of ['USN', 'IJN']) {
      const W = [].concat(...RS.map(r => r.sp.waves)).filter(w => w.nation === n && !w.base && w.nb > 0);
      if (!W.length) { console.log(`  ${n}: no carrier strikes`); continue; }
      const nb = W.reduce((s, w) => s + w.nb, 0), killed = W.reduce((s, w) => s + w.killed, 0), dropped = W.reduce((s, w) => s + w.dropped, 0), jett = W.reduce((s, w) => s + w.jett, 0);
      const eb = W.filter(w => w.enemyBase && w.tgt !== 'base');
      const bk = (lo, hi) => { const L = W.filter(w => w.capArr !== null && w.capArr >= lo && w.capArr < hi); const b = L.reduce((s, w) => s + w.nb, 0); return { n: L.length, esc: b ? L.reduce((s, w) => s + w.ne, 0) / b : null, killed: b ? L.reduce((s, w) => s + w.killed, 0) / b : null, drops: b ? L.reduce((s, w) => s + w.dropped, 0) / b : null }; };
      const B = { lo: bk(0, 5), mid: bk(5, 12), hi: bk(12, 1e9) };
      // the next strike of the same carrier after a heavy-loss strike
      const after = { heavy: [], light: [] };
      for (const r of RS) { const O = r.sp.orders.filter(o => o.nation === n); for (let i = 1; i < O.length; i++) { const pv = O.filter((o, j) => j < i && o.cv === O[i].cv).pop(); if (pv) (pv.loss >= 0.4 ? after.heavy : after.light).push(O[i].n / Math.max(1, pv.n)); } }
      const commit = W.filter(w => w.wing).map(w => (w.nb + w.ne) / w.wing);
      const S1 = S[n] = {
        waves: W.length, bombersPerWave: nb / W.length, escPerBomber: W.reduce((s, w) => s + w.ne, 0) / nb,
        killedBeforeDrop: killed / nb, dropsPerBomber: dropped / nb, jettPerBomber: jett / nb,
        expTransit: mean(W.map(w => w.exp)), expP90: qs(W.map(w => w.exp), 0.9),
        baseTargeted: W.filter(w => w.tgt === 'base').length / W.length, overBase: eb.length ? eb.filter(w => w.overBase).length / eb.length : null,
        baseSec: eb.length ? mean(eb.map(w => w.baseT)) : null, minBaseP10: eb.length ? qs(eb.map(w => w.minBase).filter(v => v !== null), 0.1) : null,
        cap: B, nextAfterHeavy: mean(after.heavy), nAfterHeavy: after.heavy.length, nextAfterLight: mean(after.light),
        commitP50: qs(commit, 0.5), commitP90: qs(commit, 0.9), commitMax: commit.length ? Math.max(...commit) : null,
        maxUpP50: qs(RS.map(r => r.sp.maxUp[n]), 0.5), maxUpMax: Math.max(...RS.map(r => r.sp.maxUp[n])),
        breaks: RS.reduce((s, r) => s + r.sp.breaks[n], 0) / RS.length, mauled: RS.reduce((s, r) => s + r.sp.mauled[n], 0) / RS.length,
        lostPerRound: mean(RS.map(r => r.lost[n])), cvTargeted: W.filter(w => w.tgt === 'carrier').length / W.length
      };
      console.log(`  ${n}: ${W.length} strikes, ${f(S1.bombersPerWave)} bombers / strike, escorts ${f(S1.escPerBomber)} per bomber; killed before drop ${pc(S1.killedBeforeDrop)}, drops ${pc(S1.dropsPerBomber)}, jettisoned ${pc(S1.jettPerBomber)}; on carriers ${pc(S1.cvTargeted)}; planes lost / round ${f(S1.lostPerRound)}`);
      console.log(`     route: transit AA exposure mean ${f(S1.expTransit)} p90 ${f(S1.expP90)} dps-s; island base: targeted ${pc(S1.baseTargeted)}, over it ${pc(S1.overBase)} of ${eb.length} strikes passing, ${f(S1.baseSec)} s within 100, closest p10 ${f(S1.minBaseP10)}`);
      console.log(`     by CAP at the target (fighters within 150): ` + ['lo', 'mid', 'hi'].map(k => `${k === 'lo' ? '0-4' : k === 'mid' ? '5-11' : '12+'}: ${B[k].n} strikes, esc/b ${f(B[k].esc)}, killed ${pc(B[k].killed)}, drops ${pc(B[k].drops)}`).join('; '));
      console.log(`     next strike size after >=40% loss x${f(S1.nextAfterHeavy)} (${after.heavy.length}), after lighter x${f(S1.nextAfterLight)}; commitment per strike p50 ${pc(S1.commitP50)} p90 ${pc(S1.commitP90)} max ${pc(S1.commitMax)}; strike planes airborne at once max p50 ${pc(S1.maxUpP50)} max ${pc(S1.maxUpMax)}; break-offs ${f(S1.breaks)} / round, mauled ${f(S1.mauled)} / round`);
    }
  }
  return out;
}

(async () => {
  const list = [];
  for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
  console.log(`strike_plan: ${list.length} rounds (${HL.label()})`);
  const t0 = Date.now(), rounds = await runAll(list);
  const out = report(rounds);
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify({ out, rounds: rounds.map(r => ({ scen: r.scen, seed: r.seed, winner: r.winner, len: r.len })) }, null, 1));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s) -> ${JSON_OUT}`);
})();
