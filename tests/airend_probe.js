// airend probe (read-only): the carrier air group's recovery and endgame, as the airend fixes measure it.
//  - marshal: each carrier plane's wait in the marshal stack (joined -> cleared to approach), p50 / p90, day vs dark;
//    marshal plane-s day (daylight >= 0.5) and dark; the landing queue per carrier (samples with a queue); the
//    tallest column (planes on one racetrack) and the height spread of the stack; diverts and where the diverted
//    plane went in the new queue (its place kept, or the back).
//  - endgame (the enemy's air group gone: <= 4 planes airborne + aboard, own >= 10): the share of own airborne
//    plane-s on a strike (outbound armed, attacking) vs the marshal / CAP; and for each enemy ship afloat, the time
//    from the side knowing it (fresh contact) to the side's first drop on it (struck within 90 s?).
//  - CAP with no enemy air: fighters on CAP per carrier in the endgame.
// Usage: node tests/airend_probe.js [--seeds 10] [--seed0 1] [--only standard,carrier_duel,midway,panel] [--workers 2] [--json F]
'use strict';
const fs = require('fs');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 10), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,midway,panel').split(','), JSON_OUT = arg('--json', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  cv2_vs_cv2: { A: ['carrier', 'carrier'], B: ['carrier', 'carrier'] },
  panel: { A: ['carrier', 'battleship', 'cruiser', 'cruiser', 'destroyer', 'submarine', 'pt', 'pt'], B: ['carrier', 'cruiser', 'destroyer'], aFixed: 'USN', base: 'none', force: 'IJN' }
};
function specFor(name, seed) {
  const sc = SCEN[name];
  const s = sc.random ? { seed, random: true, light: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  s.scen = name; s.force = sc.force || null;
  return s;
}

// ======================= PAGE SIDE =======================
function install() {
  const R = window.__ap = { err: 0, force: null };
  const isAir = p => p.kind === 'fighter' || p.kind === 'dive' || p.kind === 'torpedo';
  let S = null;
  const fresh = () => { S = { waits: [], mDay: 0, mDark: 0, lq: [], col: [], hy: [], dv: { n: 0, kept: 0, back: 0 }, eg: { USN: null, IJN: null }, egRole: { USN: {}, IJN: {} }, egCap: [], mMode: {}, blk: {}, ti: [], gap: {}, sp: [0, 0, 0], inEg: {}, lqE: [], hid: [0, 0, 0], p9: {}, found: new Map(), struck: [], forced: false, nextS: 0 }; };
  fresh(); WW.on('roundStart', fresh);
  const hangN = n => { let k = 0; for (const s of WW.world.ships) if (s.alive && s.nation === n && s.hangar && !s.isBase) k += s.hangar.fighter + s.hangar.dive + s.hangar.torpedo + (s.rearm ? s.rearm.length : 0); return k; };
  const st = new WeakMap();   // per plane: { ph, t0, c }
  WW.on('weaponDropped', e => {
    try {
      const p = e && e.plane; if (!S || !p || !isAir(p)) return;
      const t = (e.target) || p.target || (p.wave && p.wave.target); if (!t || !t.stats) return;
      const k = S.found.get(t); if (k && k[p.nation] && k[p.nation].drop === undefined) k[p.nation].drop = WW.game.roundTime;
    } catch (er) { R.err++; R.last = String(er.stack); }
  });
  const u0 = WW.air.update;
  WW.air.update = function (dt) {
    const r = u0.apply(this, arguments);
    try { tick(dt); } catch (e) { R.err++; R.last = String(e.stack); }
    return r;
  };
  function tick(dt) {
    if (!S || WW.game.state !== 'battle') return;
    const t = WW.game.roundTime, day = WW.daylight >= 0.5;
    if (R.force && !S.forced && t > 0.2) {   // the panel: the enemy air group emptied at the start (as air_endgame.js FORCE)
      S.forced = true;
      for (const s of WW.world.ships) if (s.nation === R.force && s.hangar) { s.hangar.fighter = s.hangar.dive = s.hangar.torpedo = 0; if (s.rearm) s.rearm.length = 0; }
      for (const p of WW.world.planes.slice()) if (p.nation === R.force && p.alive && isAir(p) && p.carrier && !p.carrier.isBase) { p.alive = false; p.remove(); }
    }
    // marshal waits (every step)
    for (const p of WW.world.planes) {
      if (!p.alive || !isAir(p) || !p.carrier || p.carrier.isBase) continue;
      let o = st.get(p); if (!o) { o = { ph: null, t0: 0, c: null }; st.set(p, o); }
      const m = p.state === 'landing' && p.deckPh === 'marshal';
      if (m) { if (day) S.mDay += dt; else S.mDark += dt; const D = p.carrier._deck, k = D ? (D.mode === 'recover' && D.closing ? 'closing' : D.mode) : '-'; S.mMode[k] = (S.mMode[k] || 0) + dt; }
      if (m && o.ph !== 'm') {
        const dv = o.ph === 'r' && o.c && o.c !== p.carrier;   // diverted from another carrier's stack: the wait goes on
        if (o.ph !== 'a' && !dv) o.t0 = t;   // joined (a wave-off goes round again: the wait goes on)
        if (dv) {   // a divert while queued
          S.dv.n++; const D = p.carrier._deck, i = D ? D.lq.indexOf(p) : -1;
          if (D && i >= 0 && i < D.lq.length - 1) S.dv.kept++; else S.dv.back++;
        }
        o.ph = 'm'; o.c = p.carrier; o.day = day;
      } else if (!m && o.ph === 'm' && p.state === 'landing' && p.deckPh === 'app') { S.waits.push([+(t - o.t0).toFixed(1), o.day ? 1 : 0, t - (S.inEg[p.nation] || -99) < 6 ? 1 : 0]); o.ph = 'a'; }
      else if (!m && o.ph === 'm' && p.state === 'return') { o.ph = 'r'; }   // off the stack homebound again (its deck sank: a divert)
      else if (!m && o.ph === 'm' && p.state !== 'landing') { o.ph = null; }   // left the stack (CAP join, ditch)
      if (o.ph === 'a' && p.state === 'landing' && p.deckPh === 'marshal') { o.ph = 'm'; }   // wave-off / overshoot: back on the stack, the wait resumes
      if (p.state === 'rollout' || p.state === 'transit' || (p.state === 'landing' && o.ph === 'r' && p.deckPh !== 'marshal')) o.ph = null;
    }
    // why the stack is not draining (marshal plane-s by the deck's state): launch / closing / flowing (a plane on the
    // approach or in the groove) / head not placed (the first in the queue is on the wrong part of its oval) / held
    for (const c of WW.world.ships) {
      const D = c._deck; if (!c.alive || !D || c.isBase || !D.lq.length) continue;
      let m = 0, flow = false, head = null; for (const q of D.lq) { if (q.deckPh === 'marshal') { m++; if (!head) head = q; } else flow = true; }
      const G = D._g || (D._g = {});   // this gap's make-up: s in launch / closing / swinging / empty pipe, wave-offs
      if (D.mode !== 'recover') G.launch = (G.launch || 0) + dt; else if (D.closing) G.closing = (G.closing || 0) + dt;
      else if (Math.abs(c.turnRate || 0) > 0.2) G.swing = (G.swing || 0) + dt;
      else if (!D.lq.some(q => q.deckPh === 'app' || q.deckPh === 'final')) G.empty = (G.empty || 0) + dt; else G.pipe = (G.pipe || 0) + dt;
      for (const q of D.lq) if (q.deckPh === 'waveoff' && !q._wo) { q._wo = 1; G.wo = (G.wo || 0) + 1; } else if (q.deckPh !== 'waveoff') q._wo = 0;
      if (D._apN !== D.recN) {
        if (D._apT !== undefined && D.recN > (D._apN || 0) && m >= 2) { const iv = WW.time.now - D._apT; S.ti.push(+iv.toFixed(1)); if (iv > 10) for (const k in G) S.gap[k] = (S.gap[k] || 0) + G[k]; }
        D._apN = D.recN; D._apT = WW.time.now; D._g = {};
      }
      if (!m) continue;
      const k = D.mode !== 'recover' ? D.mode : D.closing ? 'closing' : flow ? 'flow' : 'head:' + (WW.airDeck._k.toLocal(c, head.x, head.z)[0] < -(c.stats.length || 26) * 2.7 - 10 ? 'astern' : 'notAstern');
      S.blk[k] = (S.blk[k] || 0) + m * dt;
      if (D.mode === 'recover' && Math.abs(c.turnRate || 0) > 0.2) S.blk.swinging = (S.blk.swinging || 0) + m * dt;
    }
    // P9 (tests/sanity_rules.js): a plane (not attacking) inside the heavy-flak reach of an enemy BB / CA / CV that is
    // neither its target nor within 150 of it; plane-s by role
    for (const p of WW.world.planes) {
      if (!p.alive || !isAir(p) || p.state === 'attack' || (p.y || 0) < 10 || p.state === 'takeoff' || p.state === 'rollout') continue;
      if (p.kind === 'fighter' && !p.target && !p.search && p.state !== 'return' && p.state !== 'landing') continue;   // CAP (its leash rule)
      const tg = p.target || (p.wave && p.wave.target);
      for (const o of WW.world.ships) {
        if (!o.alive || o.sinking || o.nation === p.nation || !(o.type === 'battleship' || o.type === 'cruiser' || o.type === 'carrier') || o.isBase || !o.stats.aa || o === tg) continue;
        if (Math.hypot(p.x - o.x, p.y, p.z - o.z) > o.stats.aa.range * 2.2 * 0.9 || (tg && WW.dist(tg.x, tg.z, o.x, o.z) < 150)) continue;
        const ro = p.alert ? 'alert' : p.search ? 'search' : p.state === 'return' ? (p.fk ? 'homeDetour' : 'home') : p.state === 'landing' ? 'landing' : p.kind === 'fighter' ? (p.wave ? (p.wave.go ? 'escort' : 'escortForming') : 'ftrNoWave') : p.wave ? (p.wave.go ? 'strikeGo' : 'forming') : p.opp ? 'opp' : 'bomberNoWave';
        S.p9[ro] = (S.p9[ro] || 0) + dt; break;
      }
    }
    if (t < S.nextS) return;
    S.nextS = t + 5;
    // landing queues, columns, the stack's height spread
    for (const c of WW.world.ships) {
      const D = c._deck; if (!c.alive || !D || c.isBase || !D.lq.length) continue;
      S.lq.push(D.lq.length); if (t - (S.inEg[c.nation] || -99) < 6) S.lqE.push(D.lq.length);
      const tr = {}; let lo = 1e9, hi = -1e9;
      for (const q of D.lq) if (q.deckPh === 'marshal') { const k = q.mTrack === undefined ? -1 : q.mTrack; tr[k] = (tr[k] || 0) + 1; lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); }
      const v = Object.values(tr); if (v.length) { S.col.push(Math.max(...v)); S.hy.push(+(hi - lo).toFixed(1)); }
    }
    // F28: an enemy carrier afloat the side has never found, while it has a carrier that could search: is the search on?
    if (!WW.dayNight || WW.dayNight.canFly()) for (const n of ['USN', 'IJN']) {
      const mine = WW.world.ships.filter(s => s.alive && s.nation === n && s.type === 'carrier' && s.hangar && s.ai && !s.isBase);
      if (!mine.length) continue;
      const hid = WW.world.ships.some(s => s.alive && !s.sinking && s.nation !== n && s.type === 'carrier' && !s.isBase && !(WW.intel && WW.intel.known(n, s)));
      const anyCV = WW.world.ships.some(s => s.alive && !s.sinking && s.nation !== n && s.type === 'carrier' && !s.isBase && WW.intel && WW.intel.known(n, s));
      if (!hid || anyCV) continue;
      S.hid[0] += 5; if (mine.some(c => c.ai.srchWant || c.ai.cvHunt)) S.hid[1] += 5;
      let up = 0; for (const p of WW.world.planes) if (p.alive && p.nation === n && (p.search || p.kind === 'scout') && p.state !== 'return' && p.state !== 'landing') up++;
      if (up) S.hid[2] += 5;
    }
    // the endgame
    for (const n of ['USN', 'IJN']) {
      const e = WW.enemyOf(n);
      let eAir = hangN(e), mine = 0;
      for (const p of WW.world.planes) if (p.alive && isAir(p) && p.carrier && !p.carrier.isBase) { if (p.nation === e) eAir++; else if (p.nation === n) mine++; }
      const eShips = WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === e && !s.isBase);
      if (eAir > 4 || !eShips.length || mine < 10) continue;
      if (S.eg[n] === null) S.eg[n] = t;
      S.inEg[n] = t;
      S.sp[n === 'USN' ? 0 : 1] += 5; if (WW.staff.airSpent && WW.staff.airSpent(n)) S.sp[2] += 5;
      const R0 = S.egRole[n];
      for (const p of WW.world.planes) {
        if (!p.alive || p.nation !== n || !isAir(p) || !p.carrier || p.carrier.isBase || p.state === 'takeoff' || p.state === 'rollout') continue;
        const ro = p.state === 'landing' ? (p.deckPh === 'marshal' ? 'marshal' : 'groove') : p.state === 'return' ? 'return' : p.kind === 'fighter' ? (p.target ? 'escort' : 'cap') :
          !p.ordnance ? 'dry' : (p.state === 'attack' || p.phase || (p.target && p.wave && p.wave.go) || (p.target && !p.wave)) ? 'strike' : p.wave && !p.wave.go ? 'formup' : 'idle';
        R0[ro] = (R0[ro] || 0) + 5;
      }
      for (const c of WW.world.ships) if (c.alive && c.nation === n && c.type === 'carrier' && c.hangar && !c.isBase) {
        let cap = 0; for (const p of WW.world.planes) if (p.alive && p.carrier === c && p.kind === 'fighter' && !p.target && !p.search && (p.state === 'transit' || p.state === 'attack')) cap++;
        S.egCap.push(cap);
      }
      if (!WW.dayNight || WW.dayNight.canFly()) for (const s of eShips) {   // found: a fresh contact (seen within 45 s) by day
        const c = WW.intel && WW.intel.known(n, s); if (!c || WW.time.now - c.seenAt > 45) continue;
        let k = S.found.get(s); if (!k) { k = {}; S.found.set(s, k); }
        if (!k[n]) k[n] = { t, type: s.type, hp: +(s.hp / s.maxHp).toFixed(2) };
      }
    }
  }
  R.flush = function () {
    const f = []; S.found.forEach((k, s) => { for (const n in k) f.push([n, k[n].type, k[n].t, k[n].drop === undefined ? null : +(k[n].drop - k[n].t).toFixed(0), s.alive && !s.sinking ? 1 : 0]); });
    const RS = WW.airDeck && WW.airDeck.recovery;
    return { why: RS ? Object.assign({ waveoffs: RS.waveoffs, bolters: RS.bolters, marshal: RS.marshal, appT: RS.appT || 0, appN: RS.appN || 0, steps: RS.steps || 0, kept: RS.keptPlace || 0 }, RS.why) : {}, mMode: S.mMode, blk: S.blk, ti: S.ti, gap: S.gap, sp: S.sp, st: Object.assign({}, WW.staff.stats), waits: S.waits, mDay: S.mDay, mDark: S.mDark, lq: S.lq, lqE: S.lqE, hid: S.hid, p9: S.p9, col: S.col, hy: S.hy, dv: S.dv, eg: S.eg, egRole: S.egRole, egCap: S.egCap, found: f, err: R.err, last: R.last || null };
  };
  return true;
}

// ======================= NODE SIDE =======================
async function runAll(list) {
  const b = await HL.launch(), res = new Array(list.length); let next = 0;
  async function worker() {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install);
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed }, await p.evaluate(spec => {
        window.__ap.force = spec.force; const o = window.__beh.run(spec);
        return { winner: o.winner, len: o.len, end: o.end, tod: WW.dayNight.kind, rec: window.__ap.flush() };
      }, spec));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); process.stdout.write('\n');
  return res;
}
const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : '-'; };
const pc = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
function report(R) {
  const say = s => console.log(s), all = k => [].concat(...R.map(r => r.rec[k]));
  say(`AIREND PROBE: ${R.length} rounds, recorder errors ${R.reduce((s, r) => s + r.rec.err, 0)}${R.find(r => r.rec.last) ? ' (' + R.find(r => r.rec.last).rec.last.split('\n')[0] + ')' : ''}`);
  const W = all('waits'), wd = W.filter(w => w[1]).map(w => w[0]), wn = W.filter(w => !w[1]).map(w => w[0]);
  say(`marshal wait (joined -> cleared in): all n ${W.length} p50 ${q(W.map(w => w[0]), .5)} p90 ${q(W.map(w => w[0]), .9)} max ${q(W.map(w => w[0]), 1)}; day n ${wd.length} p50 ${q(wd, .5)} p90 ${q(wd, .9)}; dark n ${wn.length} p50 ${q(wn, .5)} p90 ${q(wn, .9)}`);
  say(`marshal plane-s: day ${R.reduce((s, r) => s + r.rec.mDay, 0).toFixed(0)}  dark ${R.reduce((s, r) => s + r.rec.mDark, 0).toFixed(0)}  (per round ${(R.reduce((s, r) => s + r.rec.mDay + r.rec.mDark, 0) / R.length).toFixed(0)})`);
  const WE = W.filter(w => w[2]).map(w => w[0]), WM = W.filter(w => !w[2]).map(w => w[0]), LE = all('lqE');
  say(`  endgame: marshal wait n ${WE.length} p50 ${q(WE, .5)} p90 ${q(WE, .9)}; queue per carrier p50 ${q(LE, .5)} p90 ${q(LE, .9)}  |  main battle: marshal wait n ${WM.length} p50 ${q(WM, .5)} p90 ${q(WM, .9)}`);
  const L = all('lq'), C = all('col'), H = all('hy');
  say(`landing queue per carrier (samples with a queue): p50 ${q(L, .5)} p90 ${q(L, .9)} max ${q(L, 1)}; tallest column p50 ${q(C, .5)} p90 ${q(C, .9)} max ${q(C, 1)} (> 12: ${pc(C.filter(c => c > 12).length, C.length)}); stack height spread p50 ${q(H, .5)} p90 ${q(H, .9)} max ${q(H, 1)}`);
  const mm = {}; for (const r of R) for (const k in r.rec.mMode) mm[k] = (mm[k] || 0) + r.rec.mMode[k];
  const mt = Object.values(mm).reduce((s, v) => s + v, 0);
  say(`marshal plane-s by deck mode: ${Object.entries(mm).map(e => e[0] + ' ' + pc(e[1], mt)).join(', ')}`);
  const bk = {}; for (const r of R) for (const k in r.rec.blk || {}) bk[k] = (bk[k] || 0) + r.rec.blk[k];
  say(`marshal plane-s by why: ${Object.entries(bk).sort((a, b) => b[1] - a[1]).map(e => e[0] + ' ' + pc(e[1], mt)).join(', ')}`);
  const TI = all('ti'); say(`trap interval with >= 2 in the stack (recovering): n ${TI.length} p10 ${q(TI, .1)} p50 ${q(TI, .5)} p90 ${q(TI, .9)} mean ${(TI.reduce((s, v) => s + v, 0) / Math.max(1, TI.length)).toFixed(1)}`);
  const gp = {}; for (const r of R) for (const k in r.rec.gap || {}) gp[k] = (gp[k] || 0) + r.rec.gap[k];
  say(`gaps > 10 s, made of (s): ${Object.entries(gp).map(e => e[0] + ' ' + e[1].toFixed(0)).join(', ')}`);
  const wy = {}; for (const r of R) for (const k in r.rec.why) wy[k] = (wy[k] || 0) + r.rec.why[k];
  say(`recovery per round: ${Object.entries(wy).map(e => e[0] + ' ' + (e[1] / R.length).toFixed(1)).join(', ')}; approach leg mean ${(wy.appT / Math.max(1, wy.appN)).toFixed(1)} s`);
  const dv = R.reduce((s, r) => { s.n += r.rec.dv.n; s.kept += r.rec.dv.kept; s.back += r.rec.dv.back; return s; }, { n: 0, kept: 0, back: 0 });
  say(`diverts while queued: ${dv.n} (place kept ${dv.kept}, at the back ${dv.back})`);
  const p9 = {}; for (const r of R) for (const k in r.rec.p9 || {}) p9[k] = (p9[k] || 0) + r.rec.p9[k];
  say(`P9 plane-s in non-target heavy flak per round, by role: ${Object.entries(p9).sort((a, b) => b[1] - a[1]).map(e => e[0] + ' ' + (e[1] / R.length).toFixed(0)).join(', ')}`);
  const hdn = R.reduce((s, r) => s.map((v, i) => v + (r.rec.hid ? r.rec.hid[i] : 0)), [0, 0, 0]);
  say(`F28: side-s with an enemy carrier never found (by day): ${hdn[0]} (${(hdn[0] / R.length).toFixed(0)}/round); carrier search wanted ${pc(hdn[1], hdn[0])}, a searcher or scout up ${pc(hdn[2], hdn[0])}`);
  const eg = R.filter(r => r.rec.eg.USN !== null || r.rec.eg.IJN !== null);
  say(`\nENDGAME (enemy air <= 4): ${eg.length} / ${R.length} rounds`);
  const role = {}; for (const r of eg) for (const n of ['USN', 'IJN']) for (const k in r.rec.egRole[n]) role[k] = (role[k] || 0) + r.rec.egRole[n][k];
  const tot = Object.values(role).reduce((s, v) => s + v, 0);
  say(`  airborne plane-s ${tot}: ${Object.entries(role).sort((a, b) => b[1] - a[1]).map(e => e[0] + ' ' + pc(e[1], tot)).join(', ')}  -> strike share ${pc((role.strike || 0) + (role.formup || 0), tot)} (strike+formup)`);
  const sp = R.reduce((s, r) => s + (r.rec.sp ? r.rec.sp[2] : 0), 0), spT = R.reduce((s, r) => s + (r.rec.sp ? r.rec.sp[0] + r.rec.sp[1] : 0), 0);
  const stS = {}; for (const r of R) for (const k in r.rec.st || {}) stS[k] = (stS[k] || 0) + r.rec.st[k];
  say(`  airSpent believed in ${pc(sp, spT)} of endgame side-seconds; staff per round: ${['packets', 'deckHolds', 'waits', 'commitHolds'].map(k => k + ' ' + ((stS[k] || 0) / R.length).toFixed(1)).join(', ')}`);
  const cp = all('egCap'); say(`  CAP fighters per carrier in the endgame: p50 ${q(cp, .5)} p90 ${q(cp, .9)} mean ${(cp.reduce((s, v) => s + v, 0) / Math.max(1, cp.length)).toFixed(1)}`);
  const F = all('found'), Fd = F.filter(f => f[3] !== null).map(f => f[3]);
  const heavy = F.filter(f => f[1] === 'battleship' || f[1] === 'cruiser' || f[1] === 'carrier'), hd = heavy.filter(f => f[3] !== null).map(f => f[3]);
  say(`  enemy ships found in the endgame: ${F.length}; struck: ${Fd.length} (${pc(Fd.length, F.length)}), within 90 s ${pc(Fd.filter(d => d <= 90).length, F.length)}; delay p50 ${q(Fd, .5)} p90 ${q(Fd, .9)}`);
  say(`  heavy (CV/BB/CA): ${heavy.length}; struck ${pc(hd.length, heavy.length)}, within 90 s ${pc(hd.filter(d => d <= 90).length, heavy.length)}; delay p50 ${q(hd, .5)} p90 ${q(hd, .9)}`);
  const by = {}; for (const f of F) { const k = by[f[1]] || (by[f[1]] = [0, 0, 0]); k[0]++; if (f[3] !== null) k[1]++; if (f[3] !== null && f[3] <= 90) k[2]++; }
  say(`  by type (found / struck / within 90): ${Object.entries(by).map(e => e[0] + ' ' + e[1].join('/')).join(', ')}`);
}
(async () => {
  const list = []; for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
  console.log(`airend probe: ${list.length} rounds (${HL.label()})`);
  const t0 = Date.now(), R = await runAll(list);
  report(R);
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(R));
})();
