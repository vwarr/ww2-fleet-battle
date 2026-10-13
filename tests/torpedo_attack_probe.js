// Torpedo attacks under pressure, and aerial ordnance on PT boats (read-only recorder: bus events and sampled state,
// no WW.rand, no writes to sim objects). Per armed torpedo-bomber sortie from its arrival in the target area (first
// sample in the anvil set-up, on the run, or inside 170 of its target):
//   opposition   enemy fighters airborne within 100 of the plane and the AA dps of enemy ships within 60 of its target,
//                the worst sample of the first 8 s after arrival: score = 0.6 min(fighters, 4) / 4 + 0.4 min(flak / 30, 1);
//                light < 0.25 <= medium < 0.5 <= heavy
//   per level    sorties, share that released, shot down before release, time arrival -> release (p50 / p90), the
//                aerial torpedo hit rate (a dud counts as a hit on the hull)
//   drops        hit rate by release range (u; 1 u ~ 9.6 m) and by whether the target was combing / turning (heading
//                change over the run > 0.3 rad, or ai.combUntil past the drop)
//   PT boats     bombs / torpedoes released at a PT boat (the plane's target or the bomb's), armed bombers sent at one
//                (distinct planes whose target was a PT), torpedo hits on PTs (any launcher), strafing runs on PTs
// Usage: node tests/torpedo_attack_probe.js [--seeds N=8] [--seed0 S=1] [--only standard,carrier_duel,midway,cvpt,odd]
//          [--workers K] [--json FILE]
'use strict';
const fs = require('fs');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const P2 = require('./planes2_review');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,midway,cvpt,odd').split(',');
const JSON_OUT = arg('--json', null);

function install() {
  const R = window.__ta = {};
  let S = null;
  const fresh = () => { S = { m: new Map(), done: [], drops: [], proj: new Map(), pt: { torpAt: 0, bombAt: 0, sent: new Set(), torpHitPT: 0, torpUnderPT: 0, strafeRuns: 0, strafeOrders: 0 }, sfPh: new WeakMap(), jet: new WeakSet(), lost: { torpedo: 0, dive: 0, fighter: 0 } }; };
  fresh(); WW.on('roundStart', fresh);
  const now = () => WW.game.roundTime;
  const isPT = u => u && u.type === 'pt';
  WW.on('airOrder', e => {
    if (e && e.order === 'jettison' && e.plane) S.jet.add(e.plane);
    if (e && e.order === 'strafe' && isPT(e.target)) S.pt.strafeOrders++;
  });
  WW.on('planeKill', e => { const v = e && e.victim; if (v && S.lost[v.kind] !== undefined && !(v.carrier && v.carrier.isBase)) S.lost[v.kind]++; });
  WW.on('weaponDropped', e => {
    const p = e && e.plane; if (!p || !p.kind || p.stats) return;
    if (e.kind === 'bomb' && (isPT(e.target) || (!e.target && isPT(p.target)))) S.pt.bombAt++;
    if (e.kind !== 'torpedo') return;
    const t = p.target;
    if (isPT(t)) S.pt.torpAt++;
    const E = S.m.get(p); if (E && !E.tR) { E.tR = now(); E.end = 'drop'; }
    if (!t || !t.alive) return;
    const D = { t: now(), range: Math.hypot(t.x - p.x, t.z - p.z), off: Math.abs(WW.angleDiff(t.heading, Math.atan2(p.z - t.z, p.x - t.x))), tgt: t, type: t.type, h0: t.heading,
      spdK: t.stats && t.stats.speed ? (t.speed || 0) / t.stats.speed : 0, comb0: !!(t.ai && (t.ai.combUntil || 0) > WW.time.now), opp: E ? E.lvl : null, res: null, n: p.nation, pr: E ? E.pr : null };
    S.proj.set(e.proj, D); S.drops.push(D);
  });
  WW.on('torpedoUnder', e => { if (e && isPT(e.ship)) S.pt.torpUnderPT++; });
  WW.on('weaponImpact', e => {
    if (!e || e.kind !== 'torpedo') return;
    if (e.ship && isPT(e.ship)) S.pt.torpHitPT++;
    const D = S.proj.get(e.proj); if (!D) return;
    S.proj.delete(e.proj);
    const tg = D.tgt;
    D.res = e.ship ? (e.ship === tg ? 'hit' : 'other') : 'miss';
    D.turn = tg ? Math.abs(WW.angleDiff(D.h0, tg.heading)) : 0;
    D.comb = D.comb0 || !!(tg && tg.ai && (tg.ai.combUntil || 0) > WW.time.now - 0.5);
    D.tgt = null;
  });
  let next = 0;
  WW.on('roundStart', () => { next = 0; });
  const U0 = WW.air.update;
  WW.air.update = function () { const r0 = U0.apply(this, arguments); if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += 0.25; R.sample(); } return r0; };
  // the target area: enemy fighters airborne within 130 of the target, AA dps of enemy ships within 60 of it
  function opp(n, t) {
    let f = 0, fl = 0;
    for (const q of WW.world.planes) if (q.alive && q.kind === 'fighter' && q.nation !== n && (q.state === 'transit' || q.state === 'attack') && !q.deckPh && Math.hypot(q.x - t.x, q.z - t.z) < 130) f++;
    for (const s of WW.world.ships) if (s.alive && !s.sinking && !s.submerged && s.nation !== n && s.stats && s.stats.aa && Math.hypot(s.x - t.x, s.z - t.z) < 60) fl += s.stats.aa.dps;
    return { f, fl, sc: 0.6 * Math.min(f, 4) / 4 + 0.4 * Math.min(fl / 30, 1) };
  }
  R.sample = () => {
    const t = now();
    for (const E of S.m.values()) if (E.T && t - E.tA <= 8) { const o = opp(E.n, E.T); if (o.sc >= E.sc) { E.sc = o.sc; E.f = o.f; E.fl = o.fl; } E.lvl = E.sc < 0.25 ? 'light' : E.sc < 0.5 ? 'medium' : 'heavy'; } else E.T = null;
    for (const p of WW.world.planes) {
      if (p.alive && p.ordnance && (p.kind === 'torpedo' || p.kind === 'dive' || p.level) && isPT(p.target)) S.pt.sent.add(p);
      if (p.alive && p.strafe && isPT(p.strafe) && p.sf) { const ph = S.sfPh.get(p); if (p.sf.ph === 'run' && ph !== 'run') S.pt.strafeRuns++; S.sfPh.set(p, p.sf.ph); }
      if (p.kind !== 'torpedo' || (p.carrier && p.carrier.isBase)) continue;
      let E = S.m.get(p);
      if (!E && p.alive && p.ordnance && p.target && (p.sk === 'anvil' || p.phase === 'run' || Math.hypot(p.target.x - p.x, p.target.z - p.z) < 170) && p.state !== 'return') {
        E = { tA: t, tR: null, end: null, f: 0, fl: 0, sc: 0, n: p.nation, tgt: p.target.type, runs: 0, wasRun: false, T: p.target }; S.m.set(p, E);
      }
      if (!E || E.end) continue;
      if (p.phase === 'run' && !E.wasRun) E.runs++;
      E.wasRun = p.phase === 'run';
      if (p.prs !== undefined) E.pr = p.prs;
      E.ph = p.phase || p.sk || p.state;
      if (!p.alive || p.removed || p.state === 'ditch' || p.deathMode) { E.end = 'shot down'; E.tEnd = t; continue; }   // a drop ends the record first (weaponDropped)
      if (!p.ordnance) { E.end = S.jet.has(p) ? 'jettison' : 'crippled'; E.tEnd = t; continue; }   // crippled (aircraft.js damage) or jettisoned (air_ops.js bomber)
      if (p.state === 'landing' || p.state === 'rollout' || p.deckPh) { E.end = 'landed armed'; E.tEnd = t; continue; }
      if (p.state === 'return') { const tg = p.target; E.end = S.jet.has(p) ? 'jettison' : !tg || !tg.alive || tg.sinking ? 'target gone' : p.fuel < 30 ? 'bingo' : 'home armed'; E.tEnd = t; }
    }
  };
  R.flush = () => {
    for (const E of S.m.values()) { if (!E.end) { E.end = 'round end'; E.tEnd = now(); } if (!E.lvl) E.lvl = 'light'; E.T = null; S.done.push(E); }
    for (const D of S.proj.values()) { D.res = D.res || 'open'; D.tgt = null; }
    const o = { sorties: S.done, drops: S.drops.map(D => { const c = Object.assign({}, D); delete c.tgt; return c; }), pt: Object.assign({}, S.pt, { sent: S.pt.sent.size }), lost: S.lost,
      strafe: WW.strafe ? Object.assign({}, WW.strafe.stats) : null, atk: WW.strike && WW.strike.attackStats ? JSON.parse(JSON.stringify(Object.assign({}, WW.strike.attackStats, { pushT: null }))) : null };
    fresh(); return o;
  };
}

function report(rounds) {
  const so = [], dr = [], PT = { torpAt: 0, bombAt: 0, sent: 0, torpHitPT: 0, strafeRuns: 0, strafeOrders: 0, torpUnderPT: 0 }, lost = { torpedo: 0, dive: 0, fighter: 0 };
  for (const r of rounds) {
    so.push(...r.sorties); dr.push(...r.drops);
    for (const k in PT) PT[k] += r.pt[k] || 0;
    for (const k in lost) lost[k] += r.lost[k];
  }
  const pc = x => (100 * x).toFixed(0) + '%', qs = (a, q) => { if (!a.length) return '-'; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
  const isHit = d => d.res === 'hit' || d.res === 'other';   // a torpedo meant for the carrier that hits her escort is a hit
  const out = { levels: {}, range: {}, manoeuvre: {}, pt: PT, lost, n: rounds.length };
  console.log(`(hits on a ship other than the one aimed at: ${dr.filter(d => d.res === 'other').length} of ${dr.filter(isHit).length})`);
  console.log(`\n${rounds.length} rounds, ${so.length} carrier torpedo sorties reached the target area, ${dr.length} aerial torpedoes released at a ship`);
  console.log('opposition  sorties  released  shot down  jettison  other  t(arrive->drop) p50/p90  hit rate (n)');
  for (const L of ['light', 'medium', 'heavy', 'all']) {
    const A = so.filter(e => L === 'all' || e.lvl === L); if (!A.length) continue;
    const rel = A.filter(e => e.end === 'drop'), sd = A.filter(e => e.end === 'shot down'), jt = A.filter(e => e.end === 'jettison' || e.end === 'crippled');
    const T = rel.filter(e => e.tR !== null && e.tR !== undefined).map(e => e.tR - e.tA);
    const D = dr.filter(d => (L === 'all' || d.opp === L) && d.res !== 'open');
    out.levels[L] = { n: A.length, rel: rel.length / A.length, shot: sd.length / A.length, jet: jt.length / A.length, t50: qs(T, 0.5), t90: qs(T, 0.9), hit: D.filter(isHit).length / (D.length || 1), nd: D.length };
    console.log(`${L.padEnd(10)}  ${String(A.length).padStart(7)}  ${pc(rel.length / A.length).padStart(8)}  ${pc(sd.length / A.length).padStart(9)}  ${pc(jt.length / A.length).padStart(8)}  ${pc((A.length - rel.length - sd.length - jt.length) / A.length).padStart(5)}  ${(qs(T, 0.5) + ' / ' + qs(T, 0.9)).padStart(22)}  ${pc(out.levels[L].hit)} (${D.length})`);
  }
  const ends = {}; for (const e of so) ends[e.end] = (ends[e.end] || 0) + 1;
  console.log('sortie ends: ' + Object.entries(ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  const ph = {}; for (const e of so) if (e.end !== 'drop') { const k = e.end + ' in ' + e.ph; ph[k] = (ph[k] || 0) + 1; }
  console.log('not released, by end and phase: ' + Object.entries(ph).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log(`runs started per sortie (1 = no come-round): mean ${(so.reduce((s, e) => s + e.runs, 0) / (so.length || 1)).toFixed(2)}`);
  const Dd = dr.filter(d => d.res !== 'open');
  console.log('\nrelease range (u / m)   drops  hit   | target combing/turning: drops hit | steady: drops hit');
  const B = [[0, 70], [70, 85], [85, 100], [100, 115], [115, 140], [140, 1e9]];
  for (const [a, b] of B) {
    const A = Dd.filter(d => d.range >= a && d.range < b); if (!A.length) continue;
    const man = d => d.comb || d.turn > 0.3, M = A.filter(man), St = A.filter(d => !man(d));
    const lab = `${a}-${b > 1e8 ? '' : b} / ${Math.round(a * 9.6)}-${b > 1e8 ? '' : Math.round(b * 9.6)}`;
    out.range[lab] = { n: A.length, hit: A.filter(isHit).length / A.length, nm: M.length, hm: M.filter(isHit).length / (M.length || 1), ns: St.length, hs: St.filter(isHit).length / (St.length || 1) };
    console.log(`${lab.padEnd(22)}  ${String(A.length).padStart(5)}  ${pc(out.range[lab].hit).padStart(4)}  |  ${String(M.length).padStart(5)} ${pc(out.range[lab].hm).padStart(4)}  |  ${String(St.length).padStart(5)} ${pc(out.range[lab].hs).padStart(4)}`);
  }
  const ty = {}; for (const d of Dd) { const k = d.type; (ty[k] = ty[k] || []).push(d); }
  console.log('by target type: ' + Object.entries(ty).map(([k, a]) => `${k} ${a.length} drops ${pc(a.filter(isHit).length / a.length)}`).join(', '));
  const nat = {}; for (const d of Dd) (nat[d.n] = nat[d.n] || []).push(d);
  console.log('by nation: ' + Object.entries(nat).map(([k, a]) => `${k} ${a.length} drops ${pc(a.filter(isHit).length / a.length)}, range p50 ${qs(a.map(d => d.range), 0.5)}`).join('; '));
  console.log(`\nPT boats: torpedoes released at a PT ${PT.torpAt}, bombs at a PT ${PT.bombAt}, armed bombers sent at a PT ${PT.sent}, torpedo hits on PTs ${PT.torpHitPT}, torpedoes run under a PT ${PT.torpUnderPT}, strafing orders on PTs ${PT.strafeOrders}, strafing runs on PTs ${PT.strafeRuns} (per round: ${(PT.torpAt / rounds.length).toFixed(2)} torp, ${(PT.bombAt / rounds.length).toFixed(2)} bomb, ${(PT.strafeRuns / rounds.length).toFixed(2)} strafe runs)`);
  const AS = {}; for (const r of rounds) if (r.atk) for (const k in r.atk) { const v = r.atk[k]; if (typeof v === 'number') AS[k] = (AS[k] || 0) + v; else if (v && typeof v === 'object') for (const j in v) AS[k + '.' + j] = (AS[k + '.' + j] || 0) + v[j]; }
  console.log('air_attack.js stats (sum): ' + Object.entries(AS).map(([k, v]) => k + ' ' + v).join(', '));
  console.log(`carrier planes shot down: torpedo ${lost.torpedo}, dive ${lost.dive}, fighter ${lost.fighter}`);
  return out;
}

(async () => {
  const list = [];
  for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(P2.specFor(sc, s));
  console.log(`torpedo_attack_probe: ${list.length} rounds (${HL.label()})`);
  const b = await HL.launch(); const res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install);
    while (next < list.length) {
      const spec = list[next++];
      res.push(await p.evaluate(spec => { window.__beh.run(spec); return Object.assign(__ta.flush(), { scen: spec.scen, seed: spec.seed }); }, spec));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close();
  const out = report(res);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
