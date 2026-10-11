// Dusk recall probe (diagnosis, read-only): in rounds where the light fails (daylight.js RECALL 0.5), how many carrier
// planes are in the air at the recall, how many strike planes were launched in the RISK s before it (they cannot be
// back aboard by dark), how long until the side's landing queues are down to 5, and how many are still waiting at the
// end. Usage: node tests/air_dusk_probe.js [--seeds 40] [--only standard,carrier_duel,midway] [--workers 2]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 40), ONLY = arg('--only', 'standard,carrier_duel,midway').split(',');
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' }
};
const RISK = 120;
function install(RISK) {
  const R = window.__dk = {};
  let S = null;
  WW.on('roundStart', () => { S = { rec: null, launches: [], series: [], next: 0, done: {} }; });
  const L0 = WW.air.launch;
  WW.air.launch = function (cv, kind, tgt) { const p = L0.apply(this, arguments); if (p && S && !cv.isBase && tgt) S.launches.push([WW.game.roundTime, cv.nation]); return p; };
  const u0 = WW.air.update;
  WW.air.update = function (dt) {
    const r = u0.apply(this, arguments);
    if (!S || WW.game.state !== 'battle') return r;
    const t = WW.game.roundTime;
    if (!S.rec && WW.daylight < 0.5 && WW.dayNight.kind !== 'night') {
      const air = { USN: 0, IJN: 0 }, late = { USN: 0, IJN: 0 };
      for (const p of WW.world.planes) if (p.alive && p.carrier && !p.carrier.isBase && (p.kind === 'fighter' || p.kind === 'dive' || p.kind === 'torpedo') && p.state !== 'takeoff' && p.state !== 'rollout') air[p.nation]++;
      for (const l of S.launches) if (l[0] > t - RISK) late[l[1]]++;
      S.rec = { t: +t.toFixed(0), air, late, clear: {} };
    }
    if (S.rec && t >= S.next) {
      S.next = t + 5;
      for (const n of ['USN', 'IJN']) {
        let lq = 0; for (const s of WW.world.ships) if (s.alive && s.nation === n && s._deck && !s.isBase) lq += s._deck.lq.length;
        if (S.rec.clear[n] === undefined && lq <= 5) S.rec.clear[n] = +(t - S.rec.t).toFixed(0);
        S.rec['end' + n] = lq;
      }
    }
    return r;
  };
  R.flush = () => S.rec;
  return true;
}
(async () => {
  const list = []; for (const sc of ONLY) for (let s = 1; s <= SEEDS; s++) { const c = SCEN[sc]; list.push(c.random ? { scen: sc, seed: s, random: true, light: true } : { scen: sc, seed: s, A: c.A, B: c.B, aNation: c.aFixed || (s % 2 ? 'USN' : 'IJN'), cripple: -1, base: c.base || null, light: true }); }
  const b = await HL.launch(), res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(install, RISK);
    while (next < list.length) { const spec = list[next++]; const o = await p.evaluate(spec => { const o = window.__beh.run(spec); return { len: o.len, end: o.end, tod: WW.dayNight.kind, rec: window.__dk.flush() }; }, spec); res.push(Object.assign({ scen: spec.scen, seed: spec.seed }, o)); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker)); await b.close(); console.log();
  const tods = {}; for (const r of res) tods[r.tod] = (tods[r.tod] || 0) + 1;
  const D = res.filter(r => r.rec);
  console.log(`${res.length} rounds (${JSON.stringify(tods)}); light failed during ${D.length}`);
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : '-'; };
  for (const n of ['USN', 'IJN']) {
    const air = D.map(r => r.rec.air[n]), late = D.map(r => r.rec.late[n]), clr = D.map(r => r.rec.clear[n] === undefined ? 999 : r.rec.clear[n]), end = D.map(r => r.rec['end' + n] || 0);
    console.log(`${n}: airborne at the recall p50 ${q(air, .5)} p90 ${q(air, .9)} max ${Math.max(...air)}; strike planes launched in the ${RISK} s before p50 ${q(late, .5)} p90 ${q(late, .9)}; time to <=5 waiting p50 ${q(clr, .5)} p90 ${q(clr, .9)} (999 = never); still waiting at the end p50 ${q(end, .5)} max ${Math.max(...end)}; rounds with >= 40 airborne at the recall ${air.filter(a => a >= 40).length}`);
  }
  for (const r of D) console.log(`  ${r.scen} ${r.seed}: recall t ${r.rec.t}, len ${r.len} (${r.end}), airborne ${JSON.stringify(r.rec.air)}, late launches ${JSON.stringify(r.rec.late)}, clear after ${JSON.stringify(r.rec.clear)}, waiting at end USN ${r.rec.endUSN} IJN ${r.rec.endIJN}`);
})();
