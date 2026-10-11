// Fable audit probe (read-only diagnosis, docs/fable_audit.md): counts the "why did it do THAT?" moments the audit
// hypothesised from the AI code, across scenarios and seeds, each with a repro example { scen, seed, t, who }.
// A recorder (wraps WW.air.update; never writes sim state or calls WW.rand) samples every DT s. Detectors:
//   baseOnly     a side's only enemy contact is the island base (the chart): posture never 'search', searchFor 0
//   staleEngage  posture 'engage' from contacts > 20 s old (fleet_cmd dmin uses any contact up to SHIP_TTL)
//   ratioWd      posture 'withdraw' by the strength ratio with no break: nobody runs; own gun ships fighting meanwhile
//   lineOnDD     the battle line deployed (B.battle) across a lone destroyer
//   thrash       a gun ship's target A -> B -> A within 10 s with A still fresh
//   loneDD       a destroyer circling a capital target waiting for a flotilla mate (ships_ai packed vs ai_surface mate)
//   cvDance      a destroyer with a carrier target held 100-135 off by CV_KEEP, firing nothing (USN: can never launch)
//   caVsBB       a cruiser gun-dueling a battleship with no own battleship within 250
//   ptFlee       a carrier fleeing (throttle 1) with a PT boat as the nearest "gun ship" (ai_carrier fleeFrom)
//   ptDefend     a PT boat in the commander's defend list (strike dfd 3, assignment x2.5)
//   ringAway     a ring escort more than 150 from its carrier while hunting a sub
//   raidShuttle  a line cruiser steaming to the raided carrier (ai_surface aaCover) and back
//   ptSpin       a PT boat turning > 4 pi in 30 s at its lurk spot
//   subUp        a submarine forced to surface (dive clock) with an enemy gun ship within 120; deaths within 40 s
//   rescueRaid   a destroyer stopped alongside survivors with an armed enemy bomber within 150
//   smallDrop    a bomb / torpedo dropped on a DD / PT while a bigger enemy ship (CV / BB / CA) is afloat and was seen
//                within 120 s; redirSmall: the wave's first target was big (the strike leader's redirect)
//   unseenSink   an enemy gun ship sank with no contact on it fresher than 10 s, yet it counts in foeBroken (fleet_cmd)
//   retireCap    an admiral 'retire' caption while the side is not broken; pursueBlind: 'pursue' with no contact < 60 s
// Usage: node tests/fable_probe.js [--seeds N=20] [--only a,b] [--workers K] [--json FILE]   (--merge a.json,b.json: report saved batches)
'use strict';
const fs = require('fs');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 20), ONLY = arg('--only', null), JSON_OUT = arg('--json', null);
const rep = (t, n) => Array(n).fill(t);
const SCEN = {
  standard: { random: true, n: 1.5 },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN', n: 0.6 },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], base: 'IJN', aFixed: 'USN', n: 0.6 },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'], n: 0.6 },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'], n: 0.6 },
  surface: { A: ['battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)], B: ['battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)], n: 0.6 },
  pt_vs_bb: { A: ['pt', 'pt'], B: ['battleship', 'cruiser'], n: 0.3 },
  asw: { A: ['destroyer', 'destroyer', 'cruiser'], B: ['submarine', 'submarine', 'cruiser'], n: 0.3 }
};
function specFor(name, sc, seed) {
  const s = sc.random ? { seed, random: true, light: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  s.scen = name; return s;
}

// ======================= PAGE SIDE =======================
function install() {
  const R = window.__fp = { err: 0 }, DT = 2;
  let S = null;
  const fresh = () => { S = { next: 0, m: {}, ex: {}, post: { USN: [], IJN: [] }, waves: new WeakMap(), prev: new Map(), hist: new Map(), subs: new Map(), ptH: new Map(), raids: new Map(), srch: new Set() }; };
  const ebase = n => { const b = WW.islandBase && WW.islandBase.base; return b && b.nation !== n ? b : null; };
  fresh(); WW.on('roundStart', fresh);
  const t = () => +WW.game.roundTime.toFixed(0);
  const live = () => S && WW.game.state === 'battle';
  const add = (k, v, ex) => { S.m[k] = (S.m[k] || 0) + (v === undefined ? 1 : v); if (ex && !S.ex[k]) S.ex[k] = Object.assign({ t: t() }, ex); };
  const who = s => s.nation + ' ' + s.type + (s.name ? ' ' + s.name : '') + ' #' + s.id;
  const age = (n, u) => { const c = WW.intel.known(n, u); return c ? WW.time.now - c.seenAt : 1e9; };
  const GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, BIG = { carrier: 1, battleship: 1, cruiser: 1 }, SMALL = { destroyer: 1, pt: 1 }, CAPITAL = { battleship: 1, carrier: 1 };
  const bigSeen = n => { // an enemy CV / BB / CA afloat that side n has seen within 120 s
    for (const c of WW.intel.enemyShips(n)) { const u = c.unit; if (u && u.alive && !u.sinking && !u.isBase && BIG[u.type] && WW.time.now - c.seenAt <= 120) return u; }
    return null;
  };
  // ---- events ----
  WW.on('weaponDropped', e => { try {
    if (!live() || !e || !e.plane || !e.plane.kind || (e.plane.kind !== 'dive' && e.plane.kind !== 'torpedo')) return;
    const p = e.plane, tg = p.target; if (!tg || !tg.type || tg.isBase) return;
    add('drops');
    if (SMALL[tg.type]) {
      const big = bigSeen(p.nation);
      if (big) {
        add('smallDrop', 1, { who: p.nation + ' ' + p.kind + ' on ' + who(tg), big: who(big), bigAge: +age(p.nation, big).toFixed(0), opp: p.opp || null });
        const w0 = p.wave && S.waves.get(p.wave);
        if (w0 && BIG[w0.t0]) add('redirSmall', 1, { who: p.nation + ' ' + p.kind + ' on ' + who(tg), first: w0.t0 });
        if (p.opp) add('oppSmall');
      }
    }
  } catch (er) { R.err++; R.last = String(er.stack); } });
  WW.on('shipSunk', s => { try {
    if (!live() || !s || !GUN[s.type]) return;
    const n = WW.enemyOf(s.nation), a = age(n, s), B = WW.fleetCmd.side(n);
    if (B && B.foeSeen && B.foeSeen.has(s.id) && a > 10) add('unseenSink', 1, { who: who(s), age: a > 1e8 ? 'never' : +a.toFixed(0) });
    for (const [k, v] of S.subs) if (k === s && v.upAt !== undefined && WW.time.now - v.upAt < 40 && v.near) add('subUpDeath', 1, { who: who(s), after: +(WW.time.now - v.upAt).toFixed(0) });
  } catch (er) { R.err++; R.last = String(er.stack); } });
  WW.on('admiralOrder', e => { try {
    if (!live() || !e) return;
    const B = WW.fleetCmd.side(e.nation);
    if (e.order === 'retire' && B && !B.brokenAt) add('retireCap', 1, { who: e.nation + ' ' + e.admiral, ratio: +B.strength.ratio.toFixed(2) });
    if (e.order === 'pursue') { let f = 1e9; for (const c of WW.intel.enemyShips(e.nation)) if (c.unit && c.unit.alive && !c.unit.isBase) f = Math.min(f, WW.time.now - c.seenAt); if (f > 60) add('pursueBlind', 1, { who: e.nation, freshest: f > 1e8 ? 'none' : +f.toFixed(0) }); }
  } catch (er) { R.err++; R.last = String(er.stack); } });
  // ---- the sampler ----
  const u0 = WW.air.update;
  WW.air.update = function (dt) {
    const r = u0.apply(this, arguments);
    try { if (live() && WW.game.roundTime >= S.next) { S.next = WW.game.roundTime + DT; sample(); } } catch (e) { R.err++; R.last = String(e.stack); }
    return r;
  };
  function sample() {
    const now = WW.time.now, ships = WW.world.ships, planes = WW.world.planes, I = WW.intel;
    if (WW.strike && WW.strike._waves) for (const w of WW.strike._waves()) if (w.target && !S.waves.has(w)) S.waves.set(w, { t0: w.target.type });
    for (const p of planes) if (p.alive && p.search && !S.srch.has(p)) { S.srch.add(p); add('searchSortie_' + p.nation + (ebase(p.nation) ? '_vsBase' : '_noBase')); }
    for (const n of ['USN', 'IJN']) {
      const B = WW.fleetCmd.side(n); if (!B) continue;
      const P = S.post[n]; if (!P.length || P[P.length - 1][1] !== B.posture) P.push([t(), B.posture, B.brokenAt ? 1 : 0]);
      const cs = I.enemyShips(n);
      let any = false, baseOnly = cs.length > 0, freshNear = false;
      for (const c of cs) { if (!c.unit || !c.unit.alive) continue; any = true; if (!c.unit.isBase) baseOnly = false; }
      if (baseOnly && any) { add('baseOnly_' + n, DT, { who: n, posture: B.posture, searchFor: +(B.searchFor || 0).toFixed(0) }); if (B.posture !== 'search') add('baseOnlyNoSearch', DT); if (now > 60) add('baseOnlyLate', DT, { who: n, posture: B.posture }); }
      if (ebase(n) && now < 5) add('hasEnemyBase_' + n);
      if (B.posture === 'engage') {
        for (const c of cs) { if (!c.unit || !c.unit.alive || now - c.seenAt > 20) continue; for (const s of ships) if (s.alive && s.nation === n && s.type !== 'submarine' && s.type !== 'pt' && WW.dist2(s.x, s.z, c.x, c.z) < 260 * 260) { freshNear = true; break; } if (freshNear) break; }
        if (!freshNear) add('staleEngage', DT, { who: n });
      }
      if (B.posture === 'withdraw' && !B.brokenAt) {
        add('ratioWd', DT, { who: n, ratio: +B.strength.ratio.toFixed(2) });
        for (const s of ships) if (s.alive && s.nation === n && GUN[s.type] && s.target && s.target.alive && s.stats.guns[0] && WW.dist(s.x, s.z, s.target.x, s.target.z) <= s.stats.guns[0].range) { add('ratioWdFighting', DT, { who: who(s) + ' at ' + who(s.target) }); break; }
      }
      if (B.battle && B.battle.c && B.battle.c.type === 'destroyer') add('lineOnDD', DT, { who: n + ' line across ' + who(B.battle.c) });
      if (B.airRaid && B.airRaid.carrier) { const cv = B.airRaid.carrier; const k = S.raids.get(cv) || 0; if (!k) add('raids'); S.raids.set(cv, now); }
      for (const q of B.defend) if (q.enemy && q.enemy.type === 'pt') add('ptDefend', DT, { who: n + ' carrier defends against ' + who(q.enemy), d: +q.d.toFixed(0) });
    }
    for (const s of ships) {
      if (!s.alive || s.sinking || s.isBase) continue;
      const n = s.nation, B = WW.fleetCmd.side(n), d = B && B.doctrine, o = WW.fleetCmd.order(s), tg = s.target;
      // target thrash (gun ships): A -> B -> A within 10 s with A still fresh
      if (GUN[s.type]) {
        const pv = S.prev.get(s);
        if (tg !== (pv ? pv.t : undefined)) {
          const H = S.hist.get(s) || []; H.push([now, tg]); while (H.length > 6) H.shift(); S.hist.set(s, H);
          if (pv && pv.t && pv.t.alive && tg && tg !== pv.t && age(n, pv.t) <= 3) add('switch');
          if (tg && H.length >= 3) { const a = H[H.length - 3], b = H[H.length - 2]; if (a[1] === tg && b[1] && b[1] !== tg && b[1].alive && tg.alive && now - a[0] <= 10) add('thrash', 1, { who: who(s), a: who(tg), b: who(b[1]) }); }
          S.prev.set(s, { t: tg });
        }
      }
      if (s.type === 'destroyer' && tg && tg.alive && CAPITAL[tg.type] && s.stats.torpedoes && d) {
        const dd = WW.dist(s.x, s.z, tg.x, tg.z), L = s.stats.torpedoes.range * (0.6 + 0.3 * d.torpedo);
        if (tg.type === 'carrier' && dd >= 100 && dd <= 135) add('cvDance_' + n, DT, { who: who(s) + ' off ' + who(tg), d: +dd.toFixed(0), L: +L.toFixed(0) });
        if (tg.type === 'battleship' && s.ai.torpReload <= 0 && dd > L * 0.9 && dd < L * 1.6) {
          let mate = false; for (const q of ships) if (q !== s && q.alive && q.nation === n && q.type === 'destroyer' && !(q.ai && q.ai.withdrawing) && WW.dist2(q.x, q.z, tg.x, tg.z) < (L * 1.8) * (L * 1.8)) { mate = true; break; }
          if (!mate) add('loneDD', DT, { who: who(s) + ' circling ' + who(tg), d: +dd.toFixed(0), L: +L.toFixed(0), hp: +(s.hp / s.maxHp).toFixed(2) });
        }
      }
      if (s.type === 'cruiser' && tg && tg.alive && tg.type === 'battleship' && WW.dist(s.x, s.z, tg.x, tg.z) < 170) {
        let bb = false; for (const q of ships) if (q !== s && q.alive && q.nation === n && q.type === 'battleship' && WW.dist2(q.x, q.z, s.x, s.z) < 250 * 250) { bb = true; break; }
        if (!bb) add('caVsBB', DT, { who: who(s) + ' vs ' + who(tg), d: +WW.dist(s.x, s.z, tg.x, tg.z).toFixed(0), hp: +(s.hp / s.maxHp).toFixed(2) });
      }
      if (s.type === 'carrier') { // ai_carrier fleeFrom: the nearest known gun ship (a PT has a gun)
        let best = null, bd = 1e9, cnt = 0;
        for (const c of I.enemyShips(n)) {
          const u = c.unit; if (!u || !u.alive || u.submerged || !u.stats.guns.length || u.type === 'carrier' || u.isBase || now - c.seenAt > 90) continue;
          const ag = Math.min(20, now - c.seenAt), cx = c.x + Math.cos(c.heading) * c.speed * ag, cz = c.z + Math.sin(c.heading) * c.speed * ag, dd = WW.dist(s.x, s.z, cx, cz);
          const r = u.stats.guns[0].range, k = dd / (Math.max(210, r * 1.5 + 50) * (WW.nightOps ? WW.nightOps.cvFleeK() : 1));
          if (k < 1) { cnt++; if (dd < bd) { bd = dd; best = u; } }
        }
        if (best && best.type === 'pt' && s.throttle >= 0.95) add('ptFlee', DT, { who: who(s) + ' from ' + who(best), d: +bd.toFixed(0), others: cnt - 1 });
        if (best && best.type === 'pt' && cnt === 1) add('ptFleeOnly', DT);
      }
      if (s.ringCv && s.ringCv.alive && (s.ai.dcLeft > 0 || s.ai.dcSub || (s.ai.sub && s.ai.sub.alive && s.ai.subC && (s.ai.subD < 200 || !tg || tg.type === 'submarine')))) { // ai_surface surfaceRole's hunt test (escort: SUB_HUNT x 2)
        const dd = WW.dist(s.x, s.z, s.ringCv.x, s.ringCv.z);
        if (dd > 150) add('ringAway', DT, { who: who(s) + ' ' + dd.toFixed(0) + ' from ' + who(s.ringCv) });
      }
      if (s.type === 'cruiser' && o && o.role === 'line' && B && B.airRaid && B.airRaid.carrier && B.airRaid.carrier.alive) {
        const cv = B.airRaid.carrier, dd = WW.dist(s.x, s.z, cv.x, cv.z);
        if (dd <= 300 && dd > 100 && Math.abs(WW.angleDiff(s.heading, Math.atan2(cv.z - s.z, cv.x - s.x))) < 0.5 && !(tg && tg.alive && WW.dist(s.x, s.z, tg.x, tg.z) <= s.stats.guns[0].range)) add('raidShuttle', DT, { who: who(s) + ' to ' + who(cv), d: +dd.toFixed(0) });
      }
      if (s.type === 'pt') {
        const E = S.ptH.get(s) || { H: [], spinT: -1e9 }, H = E.H; H.push([now, s.heading]); while (H.length && now - H[0][0] > 30) H.shift(); S.ptH.set(s, E);
        let sum = 0; for (let i = 1; i < H.length; i++) sum += WW.angleDiff(H[i - 1][1], H[i][1]);
        if (Math.abs(sum) > 4 * Math.PI && H.length > 10 && now - E.spinT > 30) {
          E.spinT = now; const L = s.ai.lt; add('ptSpin', 1, { who: who(s), state: L ? L.state : '?', toSpot: L ? +WW.dist(s.x, s.z, L.lx, L.lz).toFixed(0) : null, leg: L ? L.leg : null, thr: +s.throttle.toFixed(2), v: +s.speed.toFixed(1), hot: L ? !!L.hot : null });
        }
      }
      if (s.type === 'submarine') {
        const v = S.subs.get(s) || { sub: s.submerged }; const was = v.sub; v.sub = s.submerged;
        if (was && !s.submerged) {
          let near = 1e9; for (const q of ships) if (q.alive && q.nation !== n && GUN[q.type]) near = Math.min(near, WW.dist(q.x, q.z, s.x, s.z));
          v.upAt = now; v.near = near < 120;
          if (s.ai.forcedT > 0) { add('subUp'); if (near < 120) add('subUpNear', 1, { who: who(s), near: +near.toFixed(0), dive: +(s.ai.diveT || 0).toFixed(0) }); }
        }
        S.subs.set(s, v);
      }
      if (s.type === 'destroyer' && s.rescue && s.speed < 1.6) {
        for (const p of planes) if (p.alive && p.nation !== n && p.ordnance && (p.kind === 'dive' || p.kind === 'torpedo') && WW.dist2(p.x, p.z, s.x, s.z) < 150 * 150) { add('rescueRaid', DT, { who: who(s) }); break; }
      }
    }
  }
  R.flush = () => ({ m: S.m, ex: S.ex, post: S.post, searchSorties: WW.search ? WW.search.stats.sorties : null, base: WW.islandBase && WW.islandBase.base ? WW.islandBase.base.nation : null, err: R.err, last: R.last || null });
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
      const o = await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, end: o.end, rec: window.__fp.flush() }; }, spec);
      o.scen = spec.scen; o.seed = spec.seed; res[i] = o;
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
  const say = s => console.log(s), N = R.length;
  say(`FABLE PROBE: ${N} rounds, recorder errors ${R.reduce((s, r) => s + r.rec.err, 0)} ${R.find(r => r.rec.last) ? R.find(r => r.rec.last).rec.last.split('\n')[0] : ''}`);
  const keys = new Set(); for (const r of R) for (const k in r.rec.m) keys.add(k);
  const scens = [...new Set(R.map(r => r.scen))];
  for (const k of [...keys].sort()) {
    const L = R.filter(r => r.rec.m[k]), tot = R.reduce((s, r) => s + (r.rec.m[k] || 0), 0);
    const byS = scens.map(s => { const M = R.filter(r => r.scen === s); const n = M.filter(r => r.rec.m[k]).length; return n ? `${s} ${n}/${M.length} (${Math.round(M.reduce((a, r) => a + (r.rec.m[k] || 0), 0) / M.length)}/rd)` : null; }).filter(Boolean);
    say(`\n${k}: rounds ${L.length}/${N} (${(100 * L.length / N).toFixed(0)}%), total ${Math.round(tot)}, per round ${(tot / N).toFixed(1)}  [${byS.join(', ')}]`);
    const ex = L.map(r => r.rec.ex[k] ? `${r.scen} ${r.seed} t${r.rec.ex[k].t} ${JSON.stringify(Object.assign({}, r.rec.ex[k], { t: undefined }))}` : null).filter(Boolean).slice(0, 4);
    if (ex.length) say('  e.g. ' + ex.join('\n       '));
  }
  // posture flip statistics
  let flips = 0, wdFlips = 0, maxFlips = 0, ex = null;
  for (const r of R) for (const n of ['USN', 'IJN']) {
    const P = r.rec.post[n]; if (!P) continue;
    flips += P.length - 1;
    let w = 0; for (let i = 1; i < P.length; i++) if ((P[i][1] === 'withdraw' && !P[i][2]) || (P[i - 1][1] === 'withdraw' && !P[i - 1][2])) w++;
    wdFlips += w; if (w > maxFlips) { maxFlips = w; ex = `${r.scen} ${r.seed} ${n}: ` + P.map(p => p[0] + ':' + p[1][0] + (p[2] ? '!' : '')).join(' '); }
  }
  say(`\nposture changes per side-round ${(flips / (2 * N)).toFixed(1)}; changes into / out of an unbroken 'withdraw' ${wdFlips} (${(wdFlips / N).toFixed(2)}/round), max ${maxFlips}\n  e.g. ${ex}`);
  const ss = R.filter(r => r.rec.searchSorties !== null);
  say(`carrier search sorties per round: ${scens.map(s => { const M = ss.filter(r => r.scen === s); return M.length ? s + ' ' + (M.reduce((a, r) => a + r.rec.searchSorties, 0) / M.length).toFixed(1) : null; }).filter(Boolean).join(', ')}`);
}

(async () => {
  const MERGE = arg('--merge', null);   // --merge a.json,b.json: report saved batches together (no rounds run)
  if (MERGE) { const R = [].concat(...MERGE.split(',').map(f => JSON.parse(fs.readFileSync(f, 'utf8')))); report(R); return; }
  const list = [];
  for (const name in SCEN) {
    if (ONLY && ONLY.split(',').indexOf(name) < 0) continue;
    const sc = SCEN[name], n = Math.max(1, Math.round(SEEDS * (sc.n || 1)));
    for (let seed = 1; seed <= n; seed++) list.push(specFor(name, sc, seed));
  }
  const t0 = Date.now();
  console.log(`fable probe: ${list.length} rounds (${HL.label()})`);
  const R = await runAll(list);
  report(R);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(R));
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
