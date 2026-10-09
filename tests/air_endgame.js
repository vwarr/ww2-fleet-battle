// Air endgame probe (diagnosis, read-only): what a carrier side's planes do once the enemy's air group is gone and
// enemy ships remain (user: "USN 94 aircraft, IJN CV CA DD and 1 aircraft at 3:13 left, large vertical stacks").
// Every SAMPLE s, for a side whose enemy has <= GONE planes (airborne + hangar + rearm) and >= 1 ship afloat, it
// classifies each of the side's planes by role (deck / CAP / escort / form-up / strike / attack / return / marshal /
// groove / search / scout / strafe), and each of its carriers by why no strike is flying (no order: contacts stale /
// small-ship rule; busy forming; strike clock; staff hold: escort wait / commitment / mauled; too few bombers).
// The recorder never writes sim state or calls WW.rand, except FORCE mode (below), which empties one side's hangar.
//
// Usage: node tests/air_endgame.js [--seeds N=10] [--seed0 S=1] [--only standard,carrier_duel,midway,panel] [--workers K]
//          [--trace SCEN:SEED] [--dt 10] [--json FILE]
//   panel: the user's panel (USN CV BB CA CA DD SS PT PT vs IJN CV CA DD), the IJN air group emptied at the start (FORCE)
//   --trace writes tests/shots/airdiag/trace_SCEN_SEED.json (every plane every --dt s from the endgame on) for
//   tests/air_endgame_plot.js.
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 10), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,midway').split(',');
const TRACE = arg('--trace', null), DT = +arg('--dt', 10), JSON_OUT = arg('--json', null);
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
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
function install(o) {
  const R = window.__ae = { err: 0 };
  const GONE = 4, SAMPLE = o.dt;
  let S = null, idN = 0;
  const ids = new WeakMap(), idOf = p => ids.get(p) || (ids.set(p, ++idN), idN);
  const fresh = () => { S = { next: 0, rows: [], cv: [], ships: [], pos: [], forced: false, first: {}, size: [] }; };
  fresh(); WW.on('roundStart', fresh);
  R.force = null; R.trace = false;
  const hangN = n => { let k = 0; for (const s of WW.world.ships) if (s.alive && s.nation === n && s.hangar) { k += s.hangar.fighter + s.hangar.dive + s.hangar.torpedo + (s.rearm ? s.rearm.length : 0); } return k; };
  const isAir = p => p.kind === 'fighter' || p.kind === 'dive' || p.kind === 'torpedo';
  function role(p) {
    if (p.kind === 'scout' || p.kind === 'flyingboat' || !isAir(p)) return 'scout';
    if (p.state === 'takeoff' || p.state === 'rollout') return 'deck';
    if (p.state === 'landing') return p.deckPh === 'marshal' ? 'marshal' : 'groove';
    if (p.state === 'return') return 'return';
    if (p.search) return 'search';
    if (p.kind === 'fighter') {
      if (p.strafe && p.target === p.strafe) return 'strafe';
      if (p.target) return p.wave && !p.wave.go ? 'formup' : 'escort';
      return p.foe || p.vec ? 'cap_eng' : 'cap';
    }
    if (p.wave && !p.wave.go) return 'formup';
    if (!p.ordnance) return 'bomber_dry';
    if (p.state === 'attack' || p.phase) return 'attack';
    return p.target ? 'strike' : 'bomber_idle';
  }
  // the staff's sizing calls: why a strike order came to nothing
  if (WW.staff && !WW.staff.__ae) {
    const sz = WW.staff.size, ST = WW.staff.stats;
    WW.staff.size = function (cv, tgt) {
      const w0 = ST.waits, c0 = ST.commitHolds, L = cv.ai && cv.ai.led, m = L && L.mauled;
      const r = sz.apply(this, arguments);
      try {
        const why = r ? 'ok' : m ? 'mauled' : ST.commitHolds > c0 ? 'commit' : ST.waits > w0 ? 'escWait' : 'small';
        if (S) S.size.push([+WW.game.roundTime.toFixed(0), cv.nation, cv.id, tgt.isBase ? 'base' : tgt.type, why, r ? r.nd + r.nt : 0, r ? r.esc : 0, +(r ? r.capE : WW.staff.capEst(cv.nation, tgt.x, tgt.z)).toFixed(1)]);
      } catch (e) { R.err++; R.last = String(e.stack); }
      return r;
    };
    WW.staff.__ae = true;
  }
  const u0 = WW.air.update;
  WW.air.update = function (dt) {
    const r = u0.apply(this, arguments);
    try { tick(); } catch (e) { R.err++; R.last = String(e.stack); }
    return r;
  };
  function tick() {
    if (!S || WW.game.state !== 'battle') return;
    const t = WW.game.roundTime;
    if (R.force && !S.forced && t > 0.2) {   // FORCE: the side's air group is gone (test state, as after a lost air battle)
      S.forced = true;
      for (const s of WW.world.ships) if (s.nation === R.force && s.hangar) { s.hangar.fighter = s.hangar.dive = s.hangar.torpedo = 0; if (s.rearm) s.rearm.length = 0; }
      for (const p of WW.world.planes.slice()) if (p.nation === R.force && p.alive && isAir(p) && p.carrier && !p.carrier.isBase) { p.alive = false; p.remove(); }
    }
    if (t < S.next) return;
    S.next = t + SAMPLE;
    for (const n of ['USN', 'IJN']) {
      const e = WW.enemyOf(n);
      let eAir = hangN(e), mine = 0;
      for (const p of WW.world.planes) if (p.alive && isAir(p)) { if (p.nation === e) eAir++; else if (p.nation === n) mine++; }
      const eShips = WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === e && !s.isBase);
      const eCV = eShips.filter(s => s.type === 'carrier').length;
      if (eAir > GONE || !eShips.length || mine < 10) continue;
      if (S.first[n] === undefined) S.first[n] = +t.toFixed(0);
      const B = WW.fleetCmd.side(n), BE = WW.fleetCmd.side(e);
      // enemy ships as this side knows them
      const kn = eShips.map(s => { const c = WW.intel.known(n, s); return [s.type, c ? +(WW.time.now - c.seenAt).toFixed(0) : -1, +(s.hp / s.maxHp).toFixed(2)]; });
      S.ships.push([+t.toFixed(0), n, B.posture, BE ? BE.posture : '', BE && BE.brokenAt ? 1 : 0, eCV, kn, WW.game.metT === null ? 0 : 1, WW.dayNight && WW.dayNight.canFly ? (WW.dayNight.canFly() ? 1 : 0) : 1]);
      // the ships (for the plots)
      for (const s of WW.world.ships) if (s.alive && !s.isBase) S.pos.push([+t.toFixed(0), s.id, s.nation, s.type, +s.x.toFixed(0), +s.z.toFixed(0), +s.heading.toFixed(2), n]);
      // the planes
      for (const p of WW.world.planes) {
        if (!p.alive || p.nation !== n || !isAir(p)) continue;
        const ro = role(p);
        S.rows.push([+t.toFixed(0), idOf(p), n, p.kind[0], ro, +p.x.toFixed(0), +p.z.toFixed(0), +p.y.toFixed(1), p.carrier ? p.carrier.id : -1,
          p.mTrack === undefined ? -1 : p.mTrack, p.target ? (p.target.isBase ? 'base' : p.target.type) : '', +(p.fuel || 0).toFixed(0), p.wave && p.wave.go ? 1 : 0, p.carrier && p.carrier.isBase ? 1 : 0, p.ordnance ? 1 : 0]);
      }
      // the carriers: why no strike
      for (const cv of WW.world.ships) {
        if (!cv.alive || cv.nation !== n || cv.type !== 'carrier' || !cv.hangar || !cv.ai) continue;
        const a = cv.ai, so = WW.fleetCmd.strikeOrder(cv), busy = WW.airBoss.strikeBusy(cv), D = cv._deck, L = a.led;
        let strikeUp = 0, homeTgt = 0;
        for (const p of WW.world.planes) if (p.alive && p.carrier === cv && p.target && !p.search && p.state !== 'takeoff') { strikeUp++; if (p.state === 'return' || p.state === 'landing' || p.state === 'rollout') homeTgt++; }
        const cs = WW.airOps.capState(cv);
        S.cv.push([+t.toFixed(0), n, cv.id, so && so.target ? so.target.type : '', so && so.contact ? +(WW.time.now - so.contact.seenAt).toFixed(0) : -1, so && so.hold ? 1 : 0,
          busy ? 1 : 0, +a.strikeT.toFixed(0), cv.hangar.fighter, cv.hangar.dive, cv.hangar.torpedo, cv.rearm ? cv.rearm.length : 0,
          a.queue.filter(q => q.target).length, a.queue.filter(q => !q.target && !q.search).length, D ? D.mode : '', D ? D.lq.length : 0,
          WW.airOps.capWanted(cv), cs.on, cs.low, L && L.mauled ? 1 : 0, strikeUp, homeTgt, cv.wingN || 0, a.rsv ? 1 : 0, a.puHeld && !a.puGo ? 1 : 0, +(cv.hp / cv.maxHp).toFixed(2)]);
      }
    }
  }
  R.flush = function () { return { first: S.first, rows: S.rows, cv: S.cv, ships: S.ships, pos: S.pos, size: S.size, err: R.err, last: R.last || null }; };
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
    await p.evaluate(install, { dt: DT });
    while (next < list.length) {
      const i = next++, spec = list[i];
      res[i] = Object.assign({ scen: spec.scen, seed: spec.seed }, await p.evaluate(spec => {
        window.__ae.force = spec.force; const o = window.__beh.run(spec);
        return { winner: o.winner, len: o.len, end: o.end, rec: window.__ae.flush() };
      }, spec));
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
const pc = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');

// why a carrier with a fit deck has no strike in the air at this sample (one reason, first match)
function why(c, sizes) {
  const [t, , id, soT, soAge, hold, busy, strikeT, hf, hd, ht, rearm, qS, , mode, , , , , mauled, strikeUp, homeTgt] = c;
  if (strikeUp - homeTgt > 0) return 'strike_out';
  if (!soT) return 'no_order';
  if (hold) return 'order_hold_raid';
  if (busy) return 'busy_forming';
  if (hd + ht < 4) return 'few_bombers';
  const z = sizes.filter(s => s[2] === id && s[0] <= t && s[0] > t - 12).map(s => s[4]);
  if (z.length && z[z.length - 1] !== 'ok') return 'staff_' + z[z.length - 1];
  if (strikeT > 0) return 'clock';
  return 'other';
}

function report(rounds) {
  const say = s => console.log(s);
  say(`AIR ENDGAME: ${rounds.length} rounds, recorder errors ${rounds.reduce((s, r) => s + r.rec.err, 0)}${rounds.find(r => r.rec.last) ? ' (' + rounds.find(r => r.rec.last).rec.last.split('\n')[0] + ')' : ''}`);
  const hit = rounds.filter(r => r.rec.rows.length);
  say(`rounds with an endgame (enemy air <= 4 planes, enemy ships afloat, own >= 10 planes): ${hit.length} / ${rounds.length}`);
  for (const r of hit) say(`  ${r.scen} ${r.seed}: from ${JSON.stringify(r.rec.first)} s, round ${r.len} s (${r.end}, winner ${r.winner})`);
  for (const n of ['USN', 'IJN']) {
    const rows = [].concat(...hit.map(r => r.rec.rows.filter(x => x[2] === n)));
    if (!rows.length) continue;
    const tot = rows.length, by = {};
    for (const x of rows) by[x[4]] = (by[x[4]] || 0) + 1;
    say(`\n${n} in the endgame: ${tot} plane-samples (x ${DT} s = ${tot * DT} plane-s), mean airborne+deck per sample ${(tot / new Set(hit.map(r => r.rec.rows.filter(x => x[2] === n).map(x => r.scen + r.seed + ':' + x[0])).flat()).size).toFixed(1)}`);
    say('  role         share   mean y   (strike-armed: target type)');
    for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) {
      const R = rows.filter(x => x[4] === k), my = R.reduce((s, x) => s + x[7], 0) / R.length;
      const tg = {}; for (const x of R) if (x[10]) tg[x[10]] = (tg[x[10]] || 0) + 1;
      say(`  ${k.padEnd(12)} ${pc(v, tot).padStart(5)}   ${my.toFixed(0).padStart(5)}   ${Object.entries(tg).map(e => e[0] + ' ' + e[1]).join(', ')}`);
    }
    // planes with a target but homebound (they count in the staff's "strike planes out" commitment)
    const tgtHome = rows.filter(x => x[10] && (x[4] === 'return' || x[4] === 'marshal' || x[4] === 'groove' || x[4] === 'deck')).length;
    say(`  homebound / landing / on deck still holding a strike target (count as "out" in air_staff size): ${pc(tgtHome, tot)}`);
    // the marshal stack: heights and overflow
    const M = rows.filter(x => x[4] === 'marshal'), hb = {};
    for (const x of M) { const b = Math.min(80, Math.floor(x[7] / 10) * 10); hb[b] = (hb[b] || 0) + 1; }
    say(`  marshal heights (10 u bins): ${Object.entries(hb).map(e => e[0] + ':' + e[1]).join('  ')}`);
    const stk = {}; for (const r of hit) for (const x of r.rec.rows) if (x[2] === n && x[4] === 'marshal') { const k = r.scen + r.seed + ':' + x[0] + ':' + x[8]; stk[k] = (stk[k] || 0) + 1; }
    const sv = Object.values(stk).sort((a, b) => a - b);
    if (sv.length) say(`  marshal stack per carrier-sample: p50 ${sv[sv.length >> 1]}  p90 ${sv[Math.floor(sv.length * 0.9)]}  max ${sv[sv.length - 1]}`);
    const caps = rows.filter(x => x[4] === 'cap' || x[4] === 'cap_eng'), ch = {};
    for (const x of caps) { const b = Math.floor(x[7] / 10) * 10; ch[b] = (ch[b] || 0) + 1; }
    say(`  CAP heights (10 u bins): ${Object.entries(ch).map(e => e[0] + ':' + e[1]).join('  ')}`);
    // carriers
    const C = [].concat(...hit.map(r => r.rec.cv.filter(c => c[1] === n).map(c => ({ c, r }))));
    const W = {}; for (const { c, r } of C) { const w = why(c, r.rec.size); W[w] = (W[w] || 0) + 1; }
    say(`  carrier-samples ${C.length}; strike state: ${Object.entries(W).sort((a, b) => b[1] - a[1]).map(e => e[0] + ' ' + pc(e[1], C.length)).join(', ')}`);
    const mean = i => (C.reduce((s, o) => s + o.c[i], 0) / Math.max(1, C.length)).toFixed(1);
    say(`  per carrier mean: hangar F/D/T ${mean(8)}/${mean(9)}/${mean(10)}, rearm ${mean(11)}, capWanted ${mean(16)}, CAP on ${mean(17)} (+low ${mean(18)}), landing queue ${mean(15)}, planes with a target airborne ${mean(20)} (of them homebound ${mean(21)}), mauled ${pc(C.filter(o => o.c[19]).length, C.length)}, pursuit reserve held ${pc(C.filter(o => o.c[24]).length, C.length)}`);
    const sot = {}; for (const { c } of C) sot[c[3] || '(none)'] = (sot[c[3] || '(none)'] || 0) + 1;
    say(`  strike order target: ${Object.entries(sot).map(e => e[0] + ' ' + pc(e[1], C.length)).join(', ')}`);
    const dm = {}; for (const { c } of C) dm[c[14]] = (dm[c[14]] || 0) + 1;
    say(`  deck mode: ${Object.entries(dm).map(e => e[0] + ' ' + pc(e[1], C.length)).join(', ')}`);
    const Z = [].concat(...hit.map(r => r.rec.size.filter(s => s[1] === n && r.rec.first[n] !== undefined && s[0] >= r.rec.first[n])));
    const zw = {}; for (const s of Z) zw[s[4] + ':' + s[3]] = (zw[s[4] + ':' + s[3]] || 0) + 1;
    say(`  staff sizing calls in the endgame: ${Z.length}: ${Object.entries(zw).map(e => e[0] + ' ' + e[1]).join(', ')}; capE p50 ${Z.length ? Z.map(s => s[7]).sort((a, b) => a - b)[Z.length >> 1] : '-'}`);
    const ok = Z.filter(s => s[4] === 'ok');
    if (ok.length) say(`  strikes sized: ${ok.length}, bombers p50 ${ok.map(s => s[5]).sort((a, b) => a - b)[ok.length >> 1]}, escorts p50 ${ok.map(s => s[6]).sort((a, b) => a - b)[ok.length >> 1]}`);
    // what the side knows of the enemy ships
    const SH = [].concat(...hit.map(r => r.rec.ships.filter(s => s[1] === n)));
    let kn = 0, fr = 0, all = 0; const post = {}, epost = {}; let broke = 0, met = 0, fly = 0;
    for (const s of SH) { post[s[2]] = (post[s[2]] || 0) + 1; epost[s[3]] = (epost[s[3]] || 0) + 1; broke += s[4]; met += s[7]; fly += s[8]; for (const k of s[6]) { all++; if (k[1] >= 0) kn++; if (k[1] >= 0 && k[1] <= 45) fr++; } }
    say(`  enemy ships: known ${pc(kn, all)}, seen within 45 s (strikeable) ${pc(fr, all)}; own posture ${Object.entries(post).map(e => e[0] + ' ' + pc(e[1], SH.length)).join(', ')}; enemy posture ${Object.entries(epost).map(e => e[0] + ' ' + pc(e[1], SH.length)).join(', ')}; enemy broken ${pc(broke, SH.length)}; fleets met ${pc(met, SH.length)}; can fly ${pc(fly, SH.length)}`);
  }
}

(async () => {
  const list = [];
  if (TRACE) { const [sc, sd] = TRACE.split(':'); list.push(specFor(sc, +sd)); }
  else for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(specFor(sc, s));
  console.log(`air endgame probe: ${list.length} rounds (${HL.label()}), sample ${DT} s`);
  const t0 = Date.now(), rounds = await runAll(list);
  report(rounds);
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (TRACE) {
    const dir = path.join(__dirname, 'shots', 'airdiag'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `trace_${TRACE.replace(':', '_')}.json`); fs.writeFileSync(f, JSON.stringify(rounds[0])); console.log('trace ' + f);
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rounds));
})();
