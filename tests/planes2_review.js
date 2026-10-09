// Planes 2 review (branch planes2, 2026-10): CAP cover over the whole task force, the ready-deck alert, natural flight
// (climb, cruise home, wingman escorts, ditching by a destroyer, formation spacing, smooth turns) and the vertical
// stacks of circling planes. A read-only recorder (no WW.rand, no writes to sim objects; its own state lives in Maps /
// WeakMaps), like tests/plane_moves.js.
//
// Usage: node tests/planes2_review.js [--seeds N=8] [--seed0 S=1] [--only standard,carrier_duel,midway,odd]
//                                     [--workers K] [--json FILE] [--trace SCEN:SEED]
//   --trace SCEN:SEED  run only that round and dump its tracks + events to tests/shots/planes2/trace_SCEN_SEED.json
//                      (plots: node tests/planes2_tracks.js <trace> <scene> ...)
// Metrics:
//  1. cover: every enemy air attack on a friendly ship (an armed bomber with that ship as its target inside 150 of it, or
//     a fighter strafing it): did a fighter of the ship's side take that attacker on (foe or vector) before the drop /
//     the end of the attack; by the ship's distance from its nearest own carrier and by ship type.
//  2. alert: harassment (an enemy PT / destroyer / cruiser within 120 of a friendly ship and closing, the friendly ship
//     a cripple or smaller; or an enemy sub surfaced within 200 of a friendly ship); the share of that time with an
//     armed bomber of ours going for the harasser; drops on harassers; alert launches (WW.airAlert.stats when present).
//  3. flight: climb after take-off (time to 90% of the transit height, climb angle), return speed / top speed, damaged
//     planes on the way home with a friendly plane on their wing (25), ditches (cause, nearest friendly ship), wingmen
//     spacing in transit far out vs near the target, turn and roll rates (p99, abrupt jumps).
//  4. stacks: circling clusters (single link 50, 4+ planes, not the marshal stack): vertical spread and distinct levels
//     (gaps > 3 u) by role; CAP heights.
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const FZ = require('./fuzz');

const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', 'standard,carrier_duel,midway,odd').split(',');
const JSON_OUT = arg('--json', null), TRACE = arg('--trace', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  cvpt: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer', 'pt', 'pt'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'submarine'] }
};
const ODD = ['cv_vs_pt', 'cv2_vs_cv2', 'full_vs_pt2', 'cv_vs_bb'].map(n => FZ.NAMED.find(x => x[0] === n));
function specFor(name, seed) {
  let s;
  if (name === 'odd') { const o = ODD[(seed - 1) % ODD.length]; s = { seed, A: o[1], B: o[2], aNation: seed % 2 ? 'USN' : 'IJN', cripple: -1, noStall: false, light: true, label: o[0] }; }
  else {
    const sc = SCEN[name]; if (!sc) throw new Error('planes2_review: unknown scenario ' + name);
    s = sc.random ? { seed, random: true, light: true } : { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  }
  s.scen = name;
  return s;
}

// ======================= PAGE SIDE =======================
function install() {
  const R = window.__p2 = { err: 0, trace: false };
  const DT = 0.25, ATK_R = 150, HAR_R = 120, SUB_R = 200, CL_R = 50, LVL = 3;
  const now = () => WW.game.roundTime;
  const ids = new WeakMap(); let nid = 1;
  const id = o => { let v = ids.get(o); if (!v) { v = nid++; ids.set(o, v); } return v; };
  const armedB = u => u && u.alive && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance;
  const up = p => p.alive && !p.removed && (p.state === 'transit' || p.state === 'attack' || p.state === 'return') && !p.deckPh;
  const crip = s => WW.endgameAI && WW.endgameAI.isCripple ? WW.endgameAI.isCripple(s) : s.hp < 0.5 * s.maxHp;
  let S = null;
  function fresh() {
    S = { next: 0, k: 0, atk: new Map(), atkDone: [], har: new Map(), harDone: [], fl: new WeakMap(), climbs: [], ret: [], dmgHome: { n: 0, wing: 0 },
      ditch: [], form: { far: [], near: [] }, turn: [], roll: [], jumps: 0, rollJumps: 0, samples: 0, clusters: [], capY: [], alerts0: null,
      tr: R.trace ? { rows: [], ev: [] } : null };
    S.alerts0 = WW.airAlert && WW.airAlert.stats ? JSON.parse(JSON.stringify(WW.airAlert.stats)) : null;
  }
  fresh();
  WW.on('roundStart', fresh);
  const ev = (k, o) => { if (S && S.tr) S.tr.ev.push(Object.assign({ t: +now().toFixed(1), k }, o)); };
  WW.on('airOrder', e => { try { if (S && e && (e.order === 'alert' || e.order === 'escortHome' || e.order === 'ditchBy' || e.order === 'coverShip')) ev(e.order, { id: e.plane ? id(e.plane) : 0, n: e.carrier ? e.carrier.nation : null, tg: e.target ? -id(e.target) : 0, x: e.plane ? +e.plane.x.toFixed(0) : 0, z: e.plane ? +e.plane.z.toFixed(0) : 0 }); } catch (er) { R.err++; } });
  WW.on('weaponDropped', e => {
    try {
      const p = e && e.plane; if (!S || !p) return;
      const tg = e.target || p.target || p.diveTgt || null;
      for (const [k, A] of S.atk) if (A.p === p && !A.end) { A.end = 'drop'; A.tEnd = now(); }
      for (const H of S.har.values()) if (tg && H.u === tg) H.drops++;
      if (S.tr) ev('drop', { id: id(p), n: p.nation, tg: tg ? -id(tg) : 0, x: +p.x.toFixed(0), z: +p.z.toFixed(0) });
    } catch (er) { R.err++; R.last = String(er.stack); }
  });
  const PP = WW.Plane.prototype, D0 = PP.ditch;
  PP.ditch = function () {
    try {
      if (S && this.alive) {
        let nd = 1e9, ns = 1e9;
        for (const s of WW.world.ships) if (s.alive && !s.sinking && s.nation === this.nation && !s.isBase) { const d = WW.dist(this.x, this.z, s.x, s.z); if (d < ns) ns = d; if (s.type === 'destroyer' && d < nd) nd = d; }
        const why = !this.carrier || !this.carrier.alive ? 'noDeck' : this.fuel <= 0 ? 'fuel' : this.hp < this.maxHp * 0.5 ? 'damage' : 'other';
        S.ditch.push({ n: this.nation, k: this.kind, why, dd: Math.round(nd), ship: Math.round(ns), base: !!(this.carrier && this.carrier.isBase) });
        ev('ditch', { id: id(this), n: this.nation, why, x: +this.x.toFixed(0), z: +this.z.toFixed(0), dd: Math.round(nd) });
      }
    } catch (e) { R.err++; }
    return D0.apply(this, arguments);
  };

  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    try { if (S && WW.game && WW.game.state === 'battle') while (now() >= S.next) { S.next += DT; sample(); } } catch (e) { R.err++; R.last = String(e.stack); }
    return r0;
  };
  function nearCV(s) { let bd = 1e9; for (const c of WW.world.ships) if (c.alive && !c.sinking && c.nation === s.nation && c.type === 'carrier' && !c.isBase) bd = Math.min(bd, WW.dist(c.x, c.z, s.x, s.z)); return bd; }
  function covered(u, nation) { for (const q of WW.world.planes) if (q.alive && q.nation === nation && q.kind === 'fighter' && (q.foe === u || q.vec === u)) return q; return null; }
  function sample() {
    const t = now(), sec = S.k++ % 4 === 0;
    const planes = WW.world.planes, ships = WW.world.ships;
    // ---- 1. attacks on friendly ships ----
    for (const u of planes) {
      if (!u.alive || u.removed) continue;
      let s = null;
      if (armedB(u) && u.target && u.target.alive && !u.target.isBase && u.target.nation !== u.nation && WW.dist(u.x, u.z, u.target.x, u.target.z) < ATK_R) s = u.target;
      else if (u.kind === 'fighter' && u.strafe && u.strafe.alive && u.strafe.nation !== u.nation) s = u.strafe;
      if (!s) continue;
      const key = id(u) + ':' + id(s);
      let A = S.atk.get(key);
      if (!A) { A = { p: u, s, n: s.nation, type: s.type, crip: crip(s), dCV: Math.round(nearCV(s)), t0: t, cov: null, end: null, strafe: u.kind === 'fighter', att: u.kind }; S.atk.set(key, A); }
      A.tl = t;
      if (A.cov === null && covered(u, s.nation)) { A.cov = t - A.t0; ev('cover', { id: id(u), s: -id(s), x: +u.x.toFixed(0), z: +u.z.toFixed(0) }); }
    }
    for (const [k, A] of S.atk) {
      if (!A.end && (!A.p.alive || t - A.tl > 2)) A.end = !A.p.alive ? 'killed' : 'left';
      if (A.end) { S.atkDone.push({ n: A.n, type: A.type, crip: A.crip, dCV: A.dCV, cov: A.cov, end: A.end, strafe: A.strafe, dur: +((A.tEnd || A.tl) - A.t0).toFixed(1) }); S.atk.delete(k); }
    }
    // ---- 2. harassment by enemy ships ----
    if (sec) {
      for (const u of ships) {
        if (!u.alive || u.sinking || u.isBase || (u.type !== 'pt' && u.type !== 'destroyer' && u.type !== 'cruiser' && u.type !== 'submarine')) continue;
        if (u.type === 'submarine' && u.submerged) continue;
        let vic = null, vd = 1e9;
        for (const s of ships) {
          if (!s.alive || s.sinking || s.isBase || s.nation === u.nation || s.type === 'submarine') continue;
          const d = WW.dist(u.x, u.z, s.x, s.z);
          if (u.type === 'submarine') { if (d < SUB_R && d < vd) { vd = d; vic = s; } continue; }
          if (d > HAR_R || d >= vd) continue;
          const small = s.type === 'pt' || s.type === 'destroyer' || crip(s) || s.type === 'carrier';
          const closing = Math.abs(WW.angleDiff(u.heading, Math.atan2(s.z - u.z, s.x - u.x))) < 1.0 || u.target === s;
          if (small && closing) { vd = d; vic = s; }
        }
        const key = id(u);
        let H = S.har.get(key);
        if (vic) {
          if (!H) { H = { u, n: vic.nation, type: u.type, vic: vic.type, t0: t, T: 0, air: 0, drops: 0, seen: 0, tl: t, dCV: Math.round(nearCV(vic)), day: WW.dayNight ? +WW.daylight.toFixed(2) : 1 }; S.har.set(key, H); ev('harass', { s: -id(u), v: -id(vic), n: vic.nation, x: +u.x.toFixed(0), z: +u.z.toFixed(0) }); }
          H.T += 1; H.tl = t;
          if (WW.intel && WW.intel.known(vic.nation, u)) H.seen += 1;
          for (const q of planes) if (armedB(q) && q.nation === vic.nation && q.target === u) { H.air += 1; break; }
        }
      }
      for (const [k, H] of S.har) if (t - H.tl > 15 || !H.u.alive) { S.harDone.push({ n: H.n, type: H.type, vic: H.vic, T: H.T, air: H.air, drops: H.drops, seen: H.seen, sunk: !H.u.alive, dCV: H.dCV, day: H.day }); S.har.delete(k); }
    }
    // ---- 3. flight ----
    for (const p of planes) {
      if (!p.alive || p.removed || p.carrier && p.carrier.isBase || p.kind === 'scout' || p.kind === 'flyingboat') continue;
      let F = S.fl.get(p);
      if (!F) { F = { st: p.state, t0: null, y0: 0, done: false, h: p.heading, r: p.roll || 0, t: t, vmax: 0 }; S.fl.set(p, F); }
      if (p.state === 'transit' && F.t0 === null && !F.done && p.y < 20) { F.t0 = t; F.y0 = p.y; F.want = p.kind === 'fighter' && !p.target ? null : (p.pt.alt || 50) * 0.9; }
      if (F.t0 !== null && !F.done) {
        F.vmax = Math.max(F.vmax, p.vy || 0);
        if (p.vy > 0.3) (F.ang = F.ang || []).push(Math.atan2(p.vy, Math.max(1, p.speed)));
        const want = F.want === null ? 28 : F.want;
        if (p.y >= want || t - F.t0 > 60 || p.state !== 'transit') { F.done = true; S.climbs.push({ k: p.kind, n: p.nation, T: p.y >= want ? +(t - F.t0).toFixed(1) : null, vmax: +F.vmax.toFixed(1), ang: F.ang && F.ang.length ? +(F.ang.reduce((a, b) => a + b, 0) / F.ang.length).toFixed(3) : null }); }
      }
      if (p.state === 'return' && !p.deckPh && sec && !p.strafe) S.ret.push(+(p.speed / p.pt.speed).toFixed(2));
      if (p.state === 'return' && sec && p.hp < p.maxHp * 0.5 && WW.dist(p.x, p.z, p.carrier.x, p.carrier.z) > 120) {
        S.dmgHome.n++;
        for (const q of planes) if (q !== p && q.alive && q.nation === p.nation && WW.dist(q.x, q.z, p.x, p.z) < 25 && Math.abs(q.y - p.y) < 15) { S.dmgHome.wing++; break; }
      }
      // turn / roll smoothness (per 0.25 s)
      if (up(p) && F.t !== t) {
        const dh = Math.abs(WW.angleDiff(F.h, p.heading)) / (t - F.t), dr = Math.abs((p.roll || 0) - F.r) / (t - F.t);
        if (t - F.t < 0.3) { S.turn.push(+dh.toFixed(2)); S.roll.push(+dr.toFixed(2)); S.samples++; if (dh > 3.0) S.jumps++; if (dr > 3.0) S.rollJumps++; }
      }
      F.h = p.heading; F.r = p.roll || 0; F.t = t;
    }
    // formation spacing: bombers' nearest wave-mate in transit
    if (sec && WW.strike && WW.strike._waves) for (const w of WW.strike._waves()) {
      if (!w.go || w.done) continue;
      const B = w.members.filter(p => p.alive && p.ordnance && p.state === 'transit' && p.sk === 'form');
      for (const p of B) {
        let nd = 1e9; for (const q of B) if (q !== p && q.kind === p.kind) nd = Math.min(nd, WW.dist(p.x, p.z, q.x, q.z));
        if (nd < 200) (w.dT > 400 ? S.form.far : w.dT < 300 ? S.form.near : []).push(+nd.toFixed(1));
      }
    }
    // ---- 4. circling clusters (every 1 s) ----
    if (sec) {
      for (const n of ['USN', 'IJN']) {
        const L = planes.filter(p => p.nation === n && up(p) && p.kind !== 'scout' && p.kind !== 'flyingboat' && !(p.state === 'landing'));
        const seen = new Set();
        for (const p of L) {
          if (seen.has(p)) continue;
          const C = [p]; seen.add(p);
          for (let i = 0; i < C.length; i++) for (const q of L) if (!seen.has(q) && WW.dist2(C[i].x, C[i].z, q.x, q.z) < CL_R * CL_R) { seen.add(q); C.push(q); }
          if (C.length < 4) continue;
          const ys = C.map(q => q.y).sort((a, b) => a - b);
          let lv = 1; for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > LVL) lv++;
          const role = c => c.kind === 'fighter' ? (c.target || c.wave ? 'escort' : c.foe ? 'fight' : 'cap') : c.sk === 'form' && c.wave && !c.wave.go ? 'formup' : c.wave ? 'strike' : 'other';
          const rc = {}; for (const q of C) { const r = role(q); rc[r] = (rc[r] || 0) + 1; }
          let rb = null, rn = 0; for (const r in rc) if (rc[r] > rn) { rn = rc[r]; rb = r; }
          S.clusters.push({ n, N: C.length, role: rb, spread: +(ys[ys.length - 1] - ys[0]).toFixed(1), lv });
        }
        for (const p of L) if (p.kind === 'fighter' && !p.target && !p.foe && !p.vec && p.state === 'transit' && !p.joined && !p.search && !p.strafe) S.capY.push({ n, y: Math.round(p.y), lead: !p.leader });
      }
    }
    // ---- trace rows ----
    if (S.tr) {
      const half = S.k % 2 === 0;
      if (half) for (const p of planes) {
        if (!p.alive || p.removed || p.state === 'rollout' || p.state === 'takeoff' && p.deckPh !== 'climb') continue;
        const st = p.state[0] + (p.search ? 's' : '') + (p.target ? 'x' : '') + (p.foe ? 'f' : '') + (p.vec ? 'v' : '') + (p.escortHome ? 'e' : '') + (p.alert ? 'a' : '') + (p.deckPh === 'marshal' ? 'm' : '');
        S.tr.rows.push([+t.toFixed(2), id(p), p.nation === 'USN' ? 'U' : 'J', p.kind[0], st, +p.x.toFixed(1), +p.z.toFixed(1), +p.y.toFixed(1), +p.heading.toFixed(3), +(p.roll || 0).toFixed(3), +(p.hp / p.maxHp).toFixed(2), +p.speed.toFixed(1), p.foe ? id(p.foe) : 0, p.target ? -id(p.target) : 0]);
      }
      if (S.k % 8 === 1) for (const s of ships) if (s.alive && !s.isBase) S.tr.rows.push([+t.toFixed(2), -id(s), s.nation === 'USN' ? 'U' : 'J', s.type, s.sinking ? 'sinking' : crip(s) ? 'crip' : 'ok', +s.x.toFixed(1), +s.z.toFixed(1), 0, +s.heading.toFixed(3), 0, +(s.hp / s.maxHp).toFixed(2), 0, 0, s.target ? -id(s.target) : 0]);
    }
  }
  R.flush = function () {
    for (const [k, A] of S.atk) S.atkDone.push({ n: A.n, type: A.type, crip: A.crip, dCV: A.dCV, cov: A.cov, end: 'end', strafe: A.strafe, dur: +(A.tl - A.t0).toFixed(1) });
    for (const H of S.har.values()) S.harDone.push({ n: H.n, type: H.type, vic: H.vic, T: H.T, air: H.air, drops: H.drops, seen: H.seen, sunk: !H.u.alive, dCV: H.dCV, day: H.day });
    const qs = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    let alert = null;
    if (WW.airAlert && WW.airAlert.stats) alert = JSON.parse(JSON.stringify(WW.airAlert.stats));
    const out = { atk: S.atkDone, har: S.harDone, climbs: S.climbs, ret: S.ret, dmgHome: S.dmgHome, ditch: S.ditch, form: { far: S.form.far, near: S.form.near },
      turn: { p50: qs(S.turn, 0.5), p99: qs(S.turn, 0.99), max: qs(S.turn, 1) }, roll: { p50: qs(S.roll, 0.5), p99: qs(S.roll, 0.99), max: qs(S.roll, 1) }, jumps: S.jumps, rollJumps: S.rollJumps, samples: S.samples,
      clusters: S.clusters, capY: S.capY, alert, pilots: WW.endgame && WW.endgame.stats ? { tasks: WW.endgame.tasks ? WW.endgame.tasks().filter(x => x.kind === 'pilot').length : null, done: WW.endgame.tasks ? WW.endgame.tasks().filter(x => x.kind === 'pilot' && x.done).length : null } : null,
      err: R.err, last: R.last || null };
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
    if (trace) await p.evaluate(() => { window.__p2.trace = true; });
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed, label: spec.label || null }, await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, rec: window.__p2.flush() }; }, spec));
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
const pc = v => (v === null || v === undefined || !isFinite(v) ? '-' : (100 * v).toFixed(0) + '%');
const f1 = v => (v === null || v === undefined || !isFinite(v) ? '-' : (+v).toFixed(1));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function report(rounds) {
  const out = {}, say = s => console.log(s), N = rounds.length;
  say(`PLANES2 REVIEW: ${N} rounds (${[...new Set(rounds.map(r => r.scen))].map(s => s + ' ' + rounds.filter(r => r.scen === s).length).join(', ')}), recorder errors ${rounds.reduce((s, r) => s + r.rec.err, 0)}${rounds.find(r => r.rec.last) ? ' (' + rounds.find(r => r.rec.last).rec.last.split('\n')[0] + ')' : ''}`);
  // 1. cover
  const A = [].concat(...rounds.map(r => r.rec.atk)).filter(a => a.dur > 0.2 || a.end === 'drop');
  out.cover = {};
  const B = [['<150', 0, 150], ['150-300', 150, 300], ['300-450', 300, 450], ['450+', 450, 1e9], ['no CV', 1e8, 1e10]];
  say(`\n1. cover: enemy air attacks on own ships (armed bomber on its target inside 150, or a strafer), engaged by an own fighter before the drop / end`);
  for (const n of ['USN', 'IJN']) {
    const L = A.filter(a => a.n === n), row = {};
    for (const [nm, lo, hi] of B) { const M = L.filter(a => a.type !== 'carrier' && a.dCV >= lo && a.dCV < hi); row[nm] = { n: M.length, cov: M.length ? M.filter(a => a.cov !== null).length / M.length : null }; }
    const cv = L.filter(a => a.type === 'carrier'), nc = L.filter(a => a.type !== 'carrier' && a.dCV < 1e8);
    row.carrier = { n: cv.length, cov: cv.length ? cv.filter(a => a.cov !== null).length / cv.length : null };
    row.ships = { n: nc.length, cov: nc.length ? nc.filter(a => a.cov !== null).length / nc.length : null, strafe: nc.filter(a => a.strafe).length, crip: nc.filter(a => a.crip).length, covT: qs(nc.filter(a => a.cov !== null).map(a => a.cov), 0.5) };
    const bt = {}; for (const a of nc) { bt[a.type] = bt[a.type] || [0, 0]; bt[a.type][0]++; if (a.cov !== null) bt[a.type][1]++; }
    row.byType = bt;
    out.cover[n] = row;
    say(`   ${n} defending: carriers ${cv.length} attacks, covered ${pc(row.carrier.cov)}; other ships (a carrier afloat) ${nc.length} attacks (${row.ships.strafe} strafing, ${row.ships.crip} on cripples), covered ${pc(row.ships.cov)}, engaged after p50 ${f1(row.ships.covT)} s`);
    say(`      by distance from own carrier: ${B.map(([nm]) => `${nm} ${row[nm].n} ${pc(row[nm].cov)}`).join(' | ')}; by type ${Object.entries(bt).map(([k, v]) => `${k} ${v[0]} ${pc(v[1] / v[0])}`).join(', ')}`);
  }
  // 2. harassment / alert
  const H = [].concat(...rounds.map(r => r.rec.har));
  out.alert = {};
  say(`\n2. harassment by enemy ships (PT / DD / CA within 120 closing on a small or crippled ship; a surfaced sub within 200)`);
  for (const n of ['USN', 'IJN']) {
    const L = H.filter(h => h.n === n), T = L.reduce((s, h) => s + h.T, 0), air = L.reduce((s, h) => s + h.air, 0), seen = L.reduce((s, h) => s + h.seen, 0);
    const al = rounds.map(r => r.rec.alert && r.rec.alert[n]).filter(Boolean);
    const sum = k => al.reduce((s, a) => s + (a[k] || 0), 0);
    out.alert[n] = { episodes: L.length / N, T: T / N, seenShare: seen / Math.max(1, T), airShare: air / Math.max(1, T), drops: L.reduce((s, h) => s + h.drops, 0) / N, sunk: L.filter(h => h.sunk).length / N, launches: sum('launches') / N, planes: sum('planes') / N, triggers: sum('triggers') / N, hits: sum('hits') / N, kinds: L.reduce((m, h) => { m[h.type] = (m[h.type] || 0) + 1; return m; }, {}) };
    say(`   ${n} ships harassed: ${f1(out.alert[n].episodes)} episodes / round (${JSON.stringify(out.alert[n].kinds)}), ${f1(out.alert[n].T)} s / round, the harasser known ${pc(out.alert[n].seenShare)}; with an own armed bomber going for it ${pc(out.alert[n].airShare)}; drops on harassers ${f1(out.alert[n].drops)} / round; harassers sunk ${f1(out.alert[n].sunk)} / round`);
    const nearL = L.filter(h => h.dCV < 320), dayL = nearL.filter(h => h.day >= 0.5);
    say(`      within 320 of an own carrier: ${f1(nearL.length / N)} / round (by day ${f1(dayL.length / N)}), with an own armed bomber on the harasser ${pc(nearL.reduce((s, h) => s + h.air, 0) / Math.max(1, nearL.reduce((s, h) => s + h.T, 0)))}; victim-to-carrier p50 ${qs(L.map(h => h.dCV), 0.5)}`);
    out.alert[n].near = nearL.length / N; out.alert[n].nearDay = dayL.length / N; out.alert[n].nearAir = nearL.reduce((s, h) => s + h.air, 0) / Math.max(1, nearL.reduce((s, h) => s + h.T, 0));
    if (al.length) say(`      alert flights: triggers ${f1(out.alert[n].triggers)}, launches ${f1(out.alert[n].launches)}, planes ${f1(out.alert[n].planes)}, drops ${f1(sum('drops') / N)} per round; why ${JSON.stringify(al.reduce((m, a) => { for (const k in a.why || {}) m[k] = (m[k] || 0) + a.why[k]; return m; }, {}))}`);
  }
  // 3. flight
  const C = [].concat(...rounds.map(r => r.rec.climbs));
  out.flight = { climb: {} };
  say(`\n3. flight`);
  for (const k of ['fighter', 'dive', 'torpedo']) {
    const L = C.filter(c => c.k === k), T = L.filter(c => c.T !== null).map(c => c.T);
    out.flight.climb[k] = { n: L.length, reached: L.length ? T.length / L.length : null, Tp50: qs(T, 0.5), Tp90: qs(T, 0.9), vmax: qs(L.map(c => c.vmax), 0.5), angDeg: qs(L.filter(c => c.ang !== null).map(c => c.ang * 57.3), 0.5) };
    const c = out.flight.climb[k];
    say(`   climb after take-off, ${k}: ${c.n} sorties, reached the height ${pc(c.reached)}, time p50 ${f1(c.Tp50)} p90 ${f1(c.Tp90)} s, top climb rate p50 ${f1(c.vmax)} u/s, mean climb angle p50 ${f1(c.angDeg)} deg`);
  }
  const ret = [].concat(...rounds.map(r => r.rec.ret));
  const dh = rounds.reduce((a, r) => ({ n: a.n + r.rec.dmgHome.n, wing: a.wing + r.rec.dmgHome.wing }), { n: 0, wing: 0 });
  out.flight.ret = { p50: qs(ret, 0.5), p90: qs(ret, 0.9), atTop: ret.length ? ret.filter(v => v > 0.95).length / ret.length : null };
  out.flight.dmgHome = { s: dh.n / N, wing: dh.wing / Math.max(1, dh.n) };
  say(`   way home: speed / top speed p50 ${f1(out.flight.ret.p50)} p90 ${f1(out.flight.ret.p90)}, at top speed ${pc(out.flight.ret.atTop)}; damaged planes (< 50% hp) on the way home ${f1(dh.n / N)} plane-s / round, with a friend on the wing ${pc(out.flight.dmgHome.wing)}`);
  const Dt = [].concat(...rounds.map(r => r.rec.ditch)).filter(d => !d.base);
  const why = Dt.reduce((m, d) => { m[d.why] = (m[d.why] || 0) + 1; return m; }, {});
  out.flight.ditch = { perRound: Dt.length / N, why, nearDD: Dt.length ? Dt.filter(d => d.dd < 60).length / Dt.length : null, nearShip: Dt.length ? Dt.filter(d => d.ship < 60).length / Dt.length : null, ddP50: qs(Dt.map(d => d.dd), 0.5) };
  const pil = rounds.filter(r => r.rec.pilots && r.rec.pilots.tasks !== null).reduce((a, r) => ({ t: a.t + r.rec.pilots.tasks, d: a.d + r.rec.pilots.done }), { t: 0, d: 0 });
  say(`   carrier-plane ditches ${f1(out.flight.ditch.perRound)} / round ${JSON.stringify(why)}; within 60 of a friendly destroyer ${pc(out.flight.ditch.nearDD)} (any ship ${pc(out.flight.ditch.nearShip)}), nearest DD p50 ${f1(out.flight.ditch.ddP50)}; aircrew rescue tasks done ${pil.d} / ${pil.t}`);
  const fF = [].concat(...rounds.map(r => r.rec.form.far)), fN = [].concat(...rounds.map(r => r.rec.form.near));
  out.flight.form = { far: qs(fF, 0.5), near: qs(fN, 0.5), farN: fF.length, nearN: fN.length };
  say(`   strike bombers' nearest same-kind wave-mate: far out (> 400 from the target) p50 ${f1(out.flight.form.far)}, near (< 300) p50 ${f1(out.flight.form.near)}`);
  const tp = rounds.map(r => r.rec.turn.p99).filter(v => v !== null), rp = rounds.map(r => r.rec.roll.p99).filter(v => v !== null);
  const sm = rounds.reduce((s, r) => s + r.rec.samples, 0), jm = rounds.reduce((s, r) => s + r.rec.jumps, 0), rj = rounds.reduce((s, r) => s + r.rec.rollJumps, 0);
  out.flight.smooth = { turnP99: mean(tp), turnMax: Math.max(...rounds.map(r => r.rec.turn.max || 0)), rollP99: mean(rp), rollMax: Math.max(...rounds.map(r => r.rec.roll.max || 0)), jumps: jm / Math.max(1, sm), rollJumps: rj / Math.max(1, sm) };
  say(`   heading rate p99 ${f1(out.flight.smooth.turnP99)} rad/s (max ${f1(out.flight.smooth.turnMax)}); roll rate p99 ${f1(out.flight.smooth.rollP99)} rad/s (max ${f1(out.flight.smooth.rollMax)}); samples over 3 rad/s: heading ${(1e4 * out.flight.smooth.jumps).toFixed(1)} / roll ${(1e4 * out.flight.smooth.rollJumps).toFixed(1)} per 10k`);
  // 4. stacks
  const K = [].concat(...rounds.map(r => r.rec.clusters));
  out.stacks = {};
  say(`\n4. circling clusters (single link 50, 4+ planes, not the landing pattern): vertical spread / distinct levels (gaps > 3 u)`);
  for (const role of ['cap', 'escort', 'formup', 'strike', 'fight', 'other']) {
    const L = K.filter(c => c.role === role); if (!L.length) continue;
    out.stacks[role] = { n: L.length, spreadP50: qs(L.map(c => c.spread), 0.5), spreadP90: qs(L.map(c => c.spread), 0.9), lvP50: qs(L.map(c => c.lv), 0.5), lvP90: qs(L.map(c => c.lv), 0.9), sizeP50: qs(L.map(c => c.N), 0.5) };
    const s = out.stacks[role];
    say(`   ${role.padEnd(7)} ${String(L.length).padStart(6)} cluster-s, size p50 ${s.sizeP50}; spread p50 ${f1(s.spreadP50)} p90 ${f1(s.spreadP90)} u; levels p50 ${s.lvP50} p90 ${s.lvP90}`);
  }
  const Y = [].concat(...rounds.map(r => r.rec.capY));
  out.capY = {};
  for (const n of ['USN', 'IJN']) {
    const L = Y.filter(y => y.n === n).map(y => y.y), h = {};
    for (const y of L) { const b = Math.floor(y / 5) * 5; h[b] = (h[b] || 0) + 1; }
    out.capY[n] = { p10: qs(L, 0.1), p50: qs(L, 0.5), p90: qs(L, 0.9), hist: h };
    say(`   ${n} CAP on station heights p10 / p50 / p90: ${qs(L, 0.1)} / ${qs(L, 0.5)} / ${qs(L, 0.9)}; by 5 u: ${Object.keys(h).sort((a, b) => a - b).map(k => k + ':' + Math.round(100 * h[k] / L.length) + '%').join(' ')}`);
  }
  return out;
}

if (require.main === module) {
  (async () => {
    const t0 = Date.now(), list = [];
    if (TRACE) { const [sc, sd] = TRACE.split(':'); list.push(specFor(sc, +sd)); }
    else for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
    console.log(`planes2_review: ${list.length} rounds (${HL.label()})`);
    const rounds = await runAll(list, !!TRACE);
    const out = report(rounds);
    if (TRACE) {
      const r = rounds[0], dir = path.join(__dirname, 'shots', 'planes2'); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `trace_${r.scen}_${r.seed}${process.env.TAG ? '_' + process.env.TAG : ''}.json`);
      fs.writeFileSync(f, JSON.stringify(Object.assign({ scen: r.scen, seed: r.seed, label: r.label, winner: r.winner }, r.rec.trace)));
      console.log('trace: ' + f + ' (' + r.rec.trace.rows.length + ' rows, ' + r.rec.trace.ev.length + ' events)');
    }
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { install, specFor };
