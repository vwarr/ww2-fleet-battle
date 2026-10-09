// Plane movement review (branch planes, 2026-10): how strikes, escorts, scouts and fighters move over whole rounds.
// A read-only recorder (no WW.rand, no writes to sim objects; its own per-plane state lives in Maps / WeakMaps), like
// tests/air_defense.js. It wraps WW.dogfight.fight (looked up through WW at each call) to watch the guns.
//
// Usage: node tests/plane_moves.js [--seeds N=8] [--seed0 S=1] [--only standard,carrier_duel,midway,surface,odd]
//                                  [--workers K] [--json FILE] [--trace SCEN:SEED]
//   --trace SCEN:SEED  run only that round and dump its tracks to tests/shots/planes/trace_SCEN_SEED.json
//                      (plot: node tests/plane_tracks.js tests/shots/planes/trace_SCEN_SEED.json)
// Metrics:
//  1. opposing strikes in transit (both waves gone, more than 200 from their targets): the closest approach per pair of
//     waves (centroid of their planes, horizontal) and the closest pair of planes (3D); p10 / p50, share within 100.
//  2. escorts peeling off at a passing raid (an escort of a wave in transit taking a foe that is not on its own strike).
//  3. targets of opportunity: per wave, the time from losing its target (sunk, or not in sight inside 140) to its first
//     drop on another ship; drops by armed scouts and by bombers on their way home; armed sorties home with the bomb.
//  4. enemy snoopers (scouts, flying boats, carrier searchers) inside 200 of a fleet: stint length and how it ended.
//  5. guns: per burst, the angle from the nose to the plane fired at and its range; per 0.25 s of combat the ignored
//     snapshots (an enemy inside 12 deg and gun range while the guns are not on it), foe switches, nose on the lead
//     point vs on the target.
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const FZ = require('./fuzz');

const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', 'standard,carrier_duel,midway,surface,odd').split(',');
const JSON_OUT = arg('--json', null), TRACE = arg('--trace', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  surface: { A: ['battleship', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'submarine'], B: ['battleship', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'submarine'] }
};
const ODD = ['cv_vs_pt', 'cv2_vs_cv2', 'cv3_vs_bb2ca2', 'full_vs_pt2', 'cv_vs_bb'].map(n => FZ.NAMED.find(x => x[0] === n));
function specFor(name, seed) {
  let s;
  if (name === 'odd') { const o = ODD[(seed - 1) % ODD.length]; s = { seed, A: o[1], B: o[2], aNation: seed % 2 ? 'USN' : 'IJN', cripple: -1, noStall: false, light: true, label: o[0] }; }
  else {
    const sc = SCEN[name]; if (!sc) throw new Error('plane_moves: unknown scenario ' + name);
    s = sc.random ? { seed, random: true, light: true } : { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  }
  s.scen = name;
  return s;
}

// ======================= PAGE SIDE =======================
function install() {
  const R = window.__pm = { err: 0, trace: false };
  const DT = 0.25, TRANSIT = 200, LOST_R = 140, SNOOP_R = 200, CONE = 0.21, GUN_R = 28, LEAD_OK = 0.17;
  const now = () => WW.game.roundTime;
  const ids = new WeakMap(); let nid = 1;
  const id = o => { let v = ids.get(o); if (!v) { v = nid++; ids.set(o, v); } return v; };
  const armedB = u => u && u.alive && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance;
  let S = null;
  function fresh() {
    S = { next: 0, k: 0, pairs: new Map(), wv: new Map(), peel: new Map(), sortie: new Map(), drops: { strike: 0, scout: 0, home: 0, other: 0 }, snoop: new Map(), stints: [],
      g: { bursts: [], samples: 0, snapOpp: 0, snapIgn: 0, switches: 0, combatT: 0, noseLead: 0, noseTgt: 0, noseNone: 0 }, gs: new WeakMap(),
      tr: R.trace ? { rows: [], bursts: [], waves: [], drops: [] } : null };
  }
  fresh();
  WW.on('roundStart', fresh);
  const sortie = p => { let r = S.sortie.get(p); if (!r) { r = { n: p.nation, k: p.kind, fate: null, opp: null }; S.sortie.set(p, r); } return r; };
  const L0 = WW.air.launch;
  WW.air.launch = function (cv) {
    const p = L0.apply(this, arguments);
    try { if (p && S && p.ordnance && (p.kind === 'dive' || p.kind === 'torpedo') && !cv.isBase) sortie(p); } catch (e) { R.err++; R.last = String(e.stack); }
    return p;
  };
  WW.on('weaponDropped', e => {
    try {
      const p = e && e.plane; if (!S || !p) return;
      const k = p.opp === 'scout' || p.search ? 'scout' : p.opp === 'home' ? 'home' : p.wave ? 'strike' : 'other';
      S.drops[k]++;
      if (S.sortie.has(p)) { const r = S.sortie.get(p); r.fate = 'dropped'; r.opp = k; }
      const w = p.wave, W = w && S.wv.get(w), tg = e.target || p.target || p.diveTgt || null;
      if (W && W.lostT !== null && W.altT === null && tg && tg !== W.lostTgt) W.altT = now();
      if (S.tr) S.tr.drops.push([+now().toFixed(1), id(p), p.nation, k, +p.x.toFixed(0), +p.z.toFixed(0)]);
    } catch (er) { R.err++; R.last = String(er.stack); }
  });
  WW.on('airOrder', e => { try { if (S && e && e.plane && (e.order === 'jettison') && S.sortie.has(e.plane)) S.sortie.get(e.plane).fate = 'jettison'; if (S && e && e.order === 'breakOff' && e.wave) for (const p of e.wave.members) if (S.sortie.has(p) && !S.sortie.get(p).fate) S.sortie.get(p).fate = 'jettison'; } catch (er) { R.err++; } });
  const PP = WW.Plane.prototype, SD0 = PP.shotDown;
  PP.shotDown = function () {
    try {
      if (S && this.alive) {
        if (S.sortie.has(this) && !S.sortie.get(this).fate) S.sortie.get(this).fate = this.ordnance ? 'killed' : 'killedEmpty';
        const st = S.snoop.get(this); if (st && st.in) { S.stints.push({ n: this.nation, k: st.k, t: +(now() - st.t0).toFixed(1), end: 'shot' }); st.in = false; }
      }
    } catch (e) { R.err++; }
    return SD0.apply(this, arguments);
  };

  // ---------- guns: wrap the dogfight step ----------
  function noseAng(p, x, y, z) {   // 3D angle between the nose (heading, flight-path pitch) and the point
    const ph = Math.atan2(p.vy || 0, Math.max(1, p.speed)), c = Math.cos(ph);
    const nx = Math.cos(p.heading) * c, ny = Math.sin(ph), nz = Math.sin(p.heading) * c;
    const rx = x - p.x, ry = y - p.y, rz = z - p.z, rl = Math.hypot(rx, ry, rz) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (nx * rx + ny * ry + nz * rz) / rl)));
  }
  function inCone(p) {   // the enemy plane most squarely in the gunsight cone within gun range, or null
    let best = null, ba = CONE;
    for (const q of WW.world.planes) {
      if (!q.alive || q.nation === p.nation || q.state === 'falling' || q.state === 'ditch' || q.state === 'rollout' || q.state === 'takeoff') continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); if (d > GUN_R) continue;
      const a = noseAng(p, q.x, q.y, q.z); if (a < ba) { ba = a; best = q; }
    }
    return best ? { q: best, a: ba, d: Math.hypot(best.x - p.x, best.y - p.y, best.z - p.z) } : null;
  }
  function nearestEnemy(p) {
    let best = null, bd = 1e9;
    for (const q of WW.world.planes) { if (!q.alive || q.nation === p.nation || q.state === 'falling') continue; const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  const DF = WW.dogfight, F0 = DF.fight;
  DF.fight = function (p, f) {
    const s0 = p.df, b0 = s0 ? s0.burst : 0;
    const r = F0.apply(this, arguments);
    try {
      if (!S) return r;
      const s = p.df, t = now(), G = S.g;
      let gs = S.gs.get(p); if (!gs) { gs = { t: -1, foe: null }; S.gs.set(p, gs); }
      const at = (s && s.gunAt && s.gunAt.alive ? s.gunAt : null) || p.foe || f;
      if (s && s.burst > 0 && !(b0 > 0) && at) {   // a burst starts
        const a = noseAng(p, at.x, at.y, at.z), d = Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z), ne = nearestEnemy(p);
        const b = { a: +a.toFixed(3), d: +d.toFixed(1), foe: at === f, k: at.kind, na: ne ? +noseAng(p, ne.x, ne.y, ne.z).toFixed(3) : null, nd: ne ? +Math.hypot(ne.x - p.x, ne.y - p.y, ne.z - p.z).toFixed(1) : null, n: p.nation };
        if (G.bursts.length < 20000) G.bursts.push(b);
        if (S.tr) S.tr.bursts.push([+t.toFixed(2), id(p), p.nation, +p.x.toFixed(1), +p.z.toFixed(1), +p.y.toFixed(1), +(a * 57.3).toFixed(1), +d.toFixed(1), at.kind, id(at)]);
      }
      if (t - gs.t >= DT) {   // one combat sample per 0.25 s per fighter
        gs.t = t; G.samples++; G.combatT += DT;
        if (gs.foe && p.foe && gs.foe !== p.foe && gs.foe.alive) G.switches++;
        gs.foe = p.foe;
        const firing = s && s.burst > 0, c = inCone(p), fo = p.foe || f;
        if (c && c.q !== fo) {
          const fa = fo ? noseAng(p, fo.x, fo.y, fo.z) : 9, fd = fo ? Math.hypot(fo.x - p.x, fo.y - p.y, fo.z - p.z) : 1e9;
          if (fa > CONE || fd > GUN_R || fd > c.d) { G.snapOpp++; if (!(firing && s.gunAt === c.q)) G.snapIgn++; }
        }
        if (fo && fo.alive) {
          const d = Math.hypot(fo.x - p.x, fo.y - p.y, fo.z - p.z), tof = d / 190;
          const lx = fo.x + Math.cos(fo.heading) * fo.speed * tof, lz = fo.z + Math.sin(fo.heading) * fo.speed * tof, ly = fo.y + (fo.vy || 0) * tof;
          const aT = noseAng(p, fo.x, fo.y, fo.z), aL = noseAng(p, lx, ly, lz);
          if (d < 60) { if (aT <= LEAD_OK) G.noseTgt++; else if (aL <= LEAD_OK) G.noseLead++; else G.noseNone++; }
        }
      }
    } catch (e) { R.err++; R.last = String(e.stack); }
    return r;
  };

  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    try { if (S && WW.game && WW.game.state === 'battle') while (now() >= S.next) { S.next += DT; sample(); } } catch (e) { R.err++; R.last = String(e.stack); }
    return r0;
  };
  function centroid(w) {
    let x = 0, z = 0, n = 0; const L = [];
    for (const p of w.members) if (p.alive && p.state !== 'return' && p.state !== 'landing' && (p.kind === 'fighter' || p.ordnance)) { x += p.x; z += p.z; n++; L.push(p); }
    return n ? { x: x / n, z: z / n, L } : null;
  }
  function sample() {
    const t = now(), half = S.k++ % 2 === 0;   // every 0.5 s
    const waves = WW.strike && WW.strike._waves ? WW.strike._waves() : [];
    // 1. opposing strikes in transit
    const tw = [];
    for (const w of waves) {
      let W = S.wv.get(w);
      if (!W) { W = { id: S.wv.size + 1, n: w.nation, lostT: null, lostTgt: null, altT: null, esc0: null, escArr: null, peel: 0 }; S.wv.set(w, W); }
      if (!w.go || w.done) continue;
      const c = centroid(w); if (!c) continue;
      const esc = c.L.filter(p => p.kind === 'fighter').length;
      if (W.esc0 === null) W.esc0 = esc;
      if (w.dT > TRANSIT) tw.push({ w, W, c });
      else if (W.escArr === null) W.escArr = esc;
      // 3. losing the target
      if (W.lostT === null) {
        const tg = w.target, seen = tg && tg.alive && !tg.sinking && WW.intel && WW.intel.visible(w.nation, tg, 4);
        if (!tg || !tg.alive || tg.sinking || (w.dT < LOST_R && !seen)) { W.lostT = t; W.lostTgt = tg; }
      }
      if (S.tr && half) S.tr.waves.push([+t.toFixed(1), W.id, w.nation, +c.x.toFixed(0), +c.z.toFixed(0), w.dT > TRANSIT ? 1 : 0]);
    }
    for (let i = 0; i < tw.length; i++) for (let j = i + 1; j < tw.length; j++) {
      const A = tw[i], B = tw[j]; if (A.w.nation === B.w.nation) continue;
      const k = Math.min(A.W.id, B.W.id) + '|' + Math.max(A.W.id, B.W.id);
      let P = S.pairs.get(k); if (!P) { P = { h: 1e9, d3: 1e9, t: t }; S.pairs.set(k, P); }
      P.h = Math.min(P.h, WW.dist(A.c.x, A.c.z, B.c.x, B.c.z));
      if (P.h < 250) for (const a of A.c.L) for (const b of B.c.L) P.d3 = Math.min(P.d3, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    // 2. peel-offs: an escort of a wave in transit with a foe that is not on its own strike
    for (const x of tw) for (const p of x.c.L) {
      if (p.kind !== 'fighter' || !p.foe || !p.foe.alive) continue;
      const f = p.foe, onUs = f.foe && f.foe.nation === p.nation && f.foe.wave === x.w, near = x.c.L.some(b => b.kind !== 'fighter' && WW.dist(b.x, b.z, f.x, f.z) < 60);
      if (onUs || near || !f.wave || !f.wave.go) continue;   // only a plane of a passing enemy strike (not the CAP, not one on our bombers)
      const k = id(p) + ':' + id(f.wave || f);
      if (!S.peel.has(k)) { S.peel.set(k, { n: p.nation, k: f.kind, t }); x.W.peel++; }
    }
    // 3. armed sorties that came home with the bomb
    for (const [p, r] of S.sortie) if (!r.fate && p.alive && (p.state === 'landing' || p.state === 'rollout') && p.ordnance) r.fate = 'home';
    // 4. snoopers inside a fleet
    for (const p of WW.world.planes) {
      if (!p.alive || p.removed) continue;
      const snoop = p.kind === 'scout' || p.kind === 'flyingboat' || p.search;
      if (!snoop) continue;
      let st = S.snoop.get(p); if (!st) { st = { in: false, t0: 0, k: p.kind === 'scout' ? 'scout' : p.kind === 'flyingboat' ? 'flyingboat' : 'search' }; S.snoop.set(p, st); }
      let inside = false;
      if (p.state === 'transit' || p.state === 'attack' || p.state === 'return') for (const s of WW.world.ships) if (s.alive && !s.isBase && s.nation !== p.nation && s.type !== 'submarine' && WW.dist2(s.x, s.z, p.x, p.z) < SNOOP_R * SNOOP_R) { inside = true; break; }
      if (inside && !st.in) { st.in = true; st.t0 = t; }
      else if (!inside && st.in) { st.in = false; S.stints.push({ n: p.nation, k: st.k, t: +(t - st.t0).toFixed(1), end: 'left' }); }
    }
    // trace rows
    if (S.tr && half) {
      for (const p of WW.world.planes) {
        if (!p.alive || p.removed || p.state === 'takeoff' || p.state === 'rollout') continue;
        const W = p.wave ? S.wv.get(p.wave) : null;
        S.tr.rows.push([+t.toFixed(1), id(p), p.nation === 'USN' ? 'U' : 'J', p.kind[0], p.state[0] + (p.search ? 's' : p.target ? 'x' : '') + (p.foe ? 'f' : ''), +p.x.toFixed(1), +p.z.toFixed(1), +p.y.toFixed(0), W ? W.id : 0, p.df && p.df.burst > 0 ? 1 : 0]);
      }
      if (S.k % 8 === 1) for (const s of WW.world.ships) if (s.alive && !s.isBase) S.tr.rows.push([+t.toFixed(1), -id(s), s.nation === 'USN' ? 'U' : 'J', s.type, s.sinking ? 'sinking' : 'ok', +s.x.toFixed(1), +s.z.toFixed(1), 0, 0, 0]);
    }
  }
  R.flush = function () {
    const t = now();
    for (const [p, st] of S.snoop) if (st.in) S.stints.push({ n: p.nation, k: st.k, t: +(t - st.t0).toFixed(1), end: 'end' });
    const waves = []; for (const W of S.wv.values()) waves.push({ n: W.n, lost: W.lostT, alt: W.altT, esc0: W.esc0, escArr: W.escArr, peel: W.peel });
    const sorties = []; for (const r of S.sortie.values()) sorties.push(r);
    const out = { pairs: [...S.pairs.values()].map(P => ({ h: Math.round(P.h), d3: P.d3 < 1e9 ? Math.round(P.d3) : null })), peel: [...S.peel.values()], waves, sorties, drops: S.drops, stints: S.stints,
      g: S.g, strafe: WW.strafe ? Object.assign({}, WW.strafe.stats) : null, opp: WW.cag && WW.cag.stats ? Object.assign({}, WW.cag.stats) : null, err: R.err, last: R.last || null };
    if (S.tr) out.trace = S.tr;
    return out;
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
    await p.evaluate(install);
    if (trace) await p.evaluate(() => { window.__pm.trace = true; });
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed, label: spec.label || null }, await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, rec: window.__pm.flush() }; }, spec));
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
const f1 = v => (v === null || !isFinite(v) ? '-' : v.toFixed(1));

function report(rounds) {
  const out = {}, say = s => console.log(s), N = rounds.length;
  say(`PLANE MOVES: ${N} rounds (${[...new Set(rounds.map(r => r.scen))].map(s => s + ' ' + rounds.filter(r => r.scen === s).length).join(', ')}), recorder errors ${rounds.reduce((s, r) => s + r.rec.err, 0)}${rounds.find(r => r.rec.last) ? ' (' + rounds.find(r => r.rec.last).rec.last.split('\n')[0] + ')' : ''}`);
  // 1
  const pr = [].concat(...rounds.map(r => r.rec.pairs)), h = pr.map(p => p.h), d3 = pr.filter(p => p.d3 !== null).map(p => p.d3);
  out.pairs = { n: pr.length, p10: qs(h, 0.1), p50: qs(h, 0.5), within100: pr.length ? h.filter(v => v < 100).length / pr.length : null, d3p10: qs(d3, 0.1), d3p50: qs(d3, 0.5) };
  say(`\n1. opposing strikes in transit: pairs ${pr.length}; closest approach (centroids) p10 ${out.pairs.p10} p50 ${out.pairs.p50}, within 100: ${pc(out.pairs.within100)}; closest planes 3D (pairs that came within 250) p10 ${out.pairs.d3p10} p50 ${out.pairs.d3p50}`);
  // 2
  const pe = [].concat(...rounds.map(r => r.rec.peel)), wv = [].concat(...rounds.map(r => r.rec.waves));
  out.peel = {};
  for (const n of ['USN', 'IJN']) {
    const P = pe.filter(x => x.n === n), W = wv.filter(w => w.n === n && w.esc0 !== null && w.escArr !== null && w.esc0 > 0);
    out.peel[n] = { perRound: P.length / N, atBomber: P.filter(x => x.k === 'dive' || x.k === 'torpedo').length / N, escKept: W.length ? W.reduce((s, w) => s + w.escArr / w.esc0, 0) / W.length : null, wavesPeeled: wv.filter(w => w.n === n && w.peel > 0).length };
    say(`2. ${n}: escort peel-offs per round ${f1(out.peel[n].perRound)} (at bombers ${f1(out.peel[n].atBomber)}), waves with a peel-off ${out.peel[n].wavesPeeled}; escorts still with the strike at 200 from the target / at departure ${pc(out.peel[n].escKept)}`);
  }
  // 3
  const lost = wv.filter(w => w.lost !== null), alt = lost.filter(w => w.alt !== null).map(w => w.alt - w.lost);
  const so = [].concat(...rounds.map(r => r.rec.sorties)), dr = { strike: 0, scout: 0, home: 0, other: 0 };
  for (const r of rounds) for (const k in dr) dr[k] += r.rec.drops[k] || 0;
  const back = so.filter(s => s.fate === 'home' || s.fate === 'dropped' || s.fate === 'jettison');
  out.opp = { lostWaves: lost.length, altN: alt.length, altP50: qs(alt, 0.5), altP90: qs(alt, 0.9), scoutDrops: dr.scout / N, homeDrops: dr.home / N, drops: dr, homeArmed: so.filter(s => s.fate === 'home').length / Math.max(1, so.length), sorties: so.length,
    fates: so.reduce((m, s) => { m[s.fate || 'none'] = (m[s.fate || 'none'] || 0) + 1; return m; }, {}) };
  const sf = { passes: 0, home: 0, cap: 0, escort: 0 }; for (const r of rounds) if (r.rec.strafe) for (const k in sf) sf[k] += r.rec.strafe[k] || 0;
  out.strafe = sf;
  say(`3. waves that lost their target ${lost.length} (of ${wv.filter(w => w.esc0 !== null).length} that left); attacked another ${alt.length}: lost -> first drop p50 ${f1(out.opp.altP50)} s, p90 ${f1(out.opp.altP90)} s`);
  say(`   drops: strike ${dr.strike}, armed scouts ${dr.scout} (${f1(out.opp.scoutDrops)}/round), bombers on the way home ${dr.home} (${f1(out.opp.homeDrops)}/round), other ${dr.other}`);
  say(`   armed carrier sorties ${so.length}: fates ${JSON.stringify(out.opp.fates)}; came home with the bomb ${pc(out.opp.homeArmed)} of all sorties`);
  say(`   strafing passes ${sf.passes} (CAP ${sf.cap}, escort ${sf.escort}, on the way home ${sf.home})`);
  // 4
  const st = [].concat(...rounds.map(r => r.rec.stints)).filter(s => s.t > 0);
  out.snoop = {};
  for (const k of ['scout', 'search', 'flyingboat', 'all']) {
    const L = st.filter(s => k === 'all' || s.k === k); if (!L.length) continue;
    const T = L.map(s => s.t);
    out.snoop[k] = { n: L.length, p50: qs(T, 0.5), p90: qs(T, 0.9), mean: T.reduce((a, b) => a + b, 0) / T.length, shot: L.filter(s => s.end === 'shot').length / L.length };
    say(`4. ${k.padEnd(10)} stints inside 200 of an enemy fleet: n ${L.length}, length p50 ${f1(out.snoop[k].p50)} p90 ${f1(out.snoop[k].p90)} mean ${f1(out.snoop[k].mean)} s, ended shot down ${pc(out.snoop[k].shot)}`);
  }
  // 5
  const G = { samples: 0, snapOpp: 0, snapIgn: 0, switches: 0, combatT: 0, noseLead: 0, noseTgt: 0, noseNone: 0 }, B = [];
  for (const r of rounds) { for (const k in G) G[k] += r.rec.g[k]; for (const b of r.rec.g.bursts) B.push(b); }
  const onT = B.filter(b => b.a <= 0.175 && b.d <= 28).length, nn = G.noseLead + G.noseTgt + G.noseNone;
  const nearBetter = B.filter(b => b.na !== null && b.nd < b.d - 3 && b.na < b.a).length;
  out.guns = { bursts: B.length, onTarget: onT / Math.max(1, B.length), aP50: qs(B.map(b => b.a * 57.3), 0.5), aP90: qs(B.map(b => b.a * 57.3), 0.9), dP50: qs(B.map(b => b.d), 0.5), notFoe: B.filter(b => !b.foe).length / Math.max(1, B.length),
    nearerInFront: nearBetter / Math.max(1, B.length), snapOpp: G.snapOpp / Math.max(1, G.combatT), snapIgn: G.snapIgn / Math.max(1, G.combatT), snapIgnShare: G.snapIgn / Math.max(1, G.snapOpp),
    switchPerMin: G.switches / Math.max(1, G.combatT) * 60, noseTgt: G.noseTgt / Math.max(1, nn), noseLead: G.noseLead / Math.max(1, nn), combatT: G.combatT };
  say(`5. guns: bursts ${B.length}; target inside 10 deg and gun range ${pc(out.guns.onTarget)}; angle off p50 ${f1(out.guns.aP50)} p90 ${f1(out.guns.aP90)} deg; range p50 ${f1(out.guns.dP50)}; at a plane other than the assigned foe ${pc(out.guns.notFoe)}; a nearer enemy squarer in front ${pc(out.guns.nearerInFront)}`);
  say(`   per combat second (${Math.round(G.combatT)} fighter-s): snapshot chances ${out.guns.snapOpp.toFixed(3)}/s, ignored ${out.guns.snapIgn.toFixed(3)}/s (${pc(out.guns.snapIgnShare)} of chances); foe switches ${f1(out.guns.switchPerMin)}/min; within 60 of the foe: nose on target ${pc(out.guns.noseTgt)}, on the lead point only ${pc(out.guns.noseLead)}, neither ${pc(1 - out.guns.noseTgt - out.guns.noseLead)}`);
  return out;
}

if (require.main === module) {
  (async () => {
    const t0 = Date.now(), list = [];
    if (TRACE) { const [sc, sd] = TRACE.split(':'); list.push(specFor(sc, +sd)); }
    else for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
    console.log(`plane_moves: ${list.length} rounds (${HL.label()})`);
    const rounds = await runAll(list, !!TRACE);
    const out = report(rounds);
    if (TRACE) {
      const r = rounds[0], dir = path.join(__dirname, 'shots', 'planes'); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `trace_${r.scen}_${r.seed}.json`);
      fs.writeFileSync(f, JSON.stringify(Object.assign({ scen: r.scen, seed: r.seed, label: r.label, winner: r.winner }, r.rec.trace)));
      console.log('trace: ' + f + ' (' + r.rec.trace.rows.length + ' rows, ' + r.rec.trace.bursts.length + ' bursts)');
    }
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { install, specFor };
