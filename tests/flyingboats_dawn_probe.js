// The island's flying boats per round (read-only recorder: no WW.rand, no writes to sim objects): ramp departures and
// lagoon landings, the first sighting (any observer; a patrol boat's first report), the base alarm (time, kind), the
// base's first scramble and strike (vs the first patrol sighting), the patrol boats' time on station and losses, and
// each side's first strike launch (carrier or base).
// Usage: node tests/flyingboats_dawn_probe.js [--only midway,ijnbase] [--seeds N=12] [--seed0 S=1] [--workers K] [--log]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 12), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,ijnbase').split(','), LOG = argv.includes('--log');
const SC = {
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};
const spec = (sc, seed) => ({ seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN, base: SC[sc].base, cripple: -1, noStall: false, light: true, scen: sc });

function install() {
  let S = null;
  const t = () => +WW.game.roundTime.toFixed(1), per = () => ({ USN: null, IJN: null });
  const fresh = () => { S = { ramp: per(), lagoon: per(), launches: per(), contact: per(), fbReport: per(), fbSight: per(), strike: per(), alarm: null, scramble: null, baseStrike: null, station: [], lost: per(), log: [] }; for (const n of ['USN', 'IJN']) { S.ramp[n] = 0; S.lagoon[n] = 0; S.launches[n] = 0; S.lost[n] = 0; } };
  fresh(); WW.on('roundStart', fresh);
  const L = s => { if (S.log.length < 40) S.log.push(t() + ' ' + s); };
  const near = p => { let ds = 1e9, df = 1e9; for (const s of WW.world.ships) if (s.alive && s.nation !== p.nation && !s.isBase) ds = Math.min(ds, WW.dist(s.x, s.z, p.x, p.z)); for (const q of WW.world.planes) if (q.alive && q.nation !== p.nation && q.kind === 'fighter') df = Math.min(df, WW.dist(q.x, q.z, p.x, p.z)); return ' [' + p.state + ' ship ' + Math.round(ds) + ' ftr ' + Math.round(df) + ']'; };
  WW.on('flyingBoat', e => {
    const p = e.plane;
    if (e.order === 'lost' || e.order === 'takeoff' || e.order === 'evade') L(e.nation + ' ' + e.order + near(p)); if (!p || p.mission !== 'patrol') return;
    if (e.order === 'patrol') { S.launches[e.nation]++; p.__t0 = t(); L(e.nation + ' launch ' + (p.ramp ? 'ramp' : 'edge')); }
    if (e.order === 'takeoff') { p.__up = t(); if (p.ramp) S.ramp[e.nation]++; L(e.nation + ' takeoff'); }
    if ((e.order === 'shadow' || e.order === 'sighting') && S.fbSight[e.nation] === null) { S.fbSight[e.nation] = t(); L(e.nation + ' boat ' + e.order + ' ' + (e.unit ? e.unit.type : '')); }
    if (e.order === 'home') { if (p.ramp) S.lagoon[e.nation]++; S.station.push({ n: e.nation, up: t() - (p.__up != null ? p.__up : p.__t0), lost: 0 }); L(e.nation + ' home ' + (p.ramp ? 'lagoon' : 'edge')); }
    if (e.order === 'lost') { S.lost[e.nation]++; S.station.push({ n: e.nation, up: t() - (p.__up != null ? p.__up : p.__t0), lost: 1 }); L(e.nation + ' boat lost'); }
  });
  WW.on('contact', e => { if (e && e.first && S.contact[e.nation] === null && e.unit && !e.unit.isBase) S.contact[e.nation] = t(); });
  WW.on('report', e => { if (e && e.by && e.by.kind === 'flyingboat' && S.fbReport[e.nation] === null) S.fbReport[e.nation] = t(); });
  WW.on('baseAlarm', e => { if (!S.alarm) { S.alarm = { t: t(), kind: e.kind, d: Math.round(WW.dist(e.x, e.z, e.tx, e.tz)) }; L('ALARM ' + e.kind + ' at ' + S.alarm.d); } });
  WW.on('baseEvent', e => {
    if (e.kind === 'scramble' && S.scramble === null) { S.scramble = t(); L('scramble'); }
    if (e.kind === 'strikeOut' && S.baseStrike === null) { S.baseStrike = t(); L('base strike at ' + (e.target ? e.target.type : '?')); }
  });
  if (WW.strike && WW.strike.newWave && !WW.strike.__fbp) {
    const nw = WW.strike.newWave; WW.strike.__fbp = 1;
    WW.strike.newWave = function (cv) { const w = nw.apply(this, arguments); try { if (cv && S.strike[cv.nation] === null) S.strike[cv.nation] = t(); } catch (e) { /* metrics */ } return w; };
  }
  window.__fbp = { flush: () => { const o = JSON.parse(JSON.stringify(S)); fresh(); return o; } };
}

(async () => {
  const list = []; for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(spec(sc, s));
  const b = await HL.launch(), res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    p.on('pageerror', e => console.error('PAGE', e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
    await p.evaluate(SB.install, SB.P); await p.evaluate(install);
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { const r = window.__beh.run(sp); const o = window.__fbp.flush(); o.winner = r && r.winner; return o; }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  res.sort((a, b) => a.scen < b.scen ? -1 : a.scen > b.scen ? 1 : a.seed - b.seed);
  const f = v => v === null || v === undefined ? '  -  ' : String(v).padStart(5);
  const med = a => { a = a.filter(v => v !== null && v !== undefined).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  const mean = a => { a = a.filter(v => v !== null && v !== undefined); return a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : null; };
  for (const sc of ONLY) {
    const R = res.filter(r => r.scen === sc), own = SC[sc].base, oth = own === 'USN' ? 'IJN' : 'USN';
    console.log(`\n== ${sc} (island: ${own}) ==`);
    console.log('seed  ramp lagoon | contact ' + own + '/' + oth + ' | boatSight ' + own + '/' + oth + ' | alarm(kind)   scramble baseStrike | 1stStrike ' + own + '/' + oth + ' | boats lost ' + own + '/' + oth);
    for (const r of R) {
      console.log(`${String(r.seed).padStart(4)}  ${f(r.ramp[own])} ${f(r.lagoon[own])} | ${f(r.contact[own])} ${f(r.contact[oth])} | ${f(r.fbSight[own])} ${f(r.fbSight[oth])} | ${f(r.alarm && r.alarm.t)} ${(r.alarm ? r.alarm.kind : '-').padEnd(7)} ${f(r.scramble)} ${f(r.baseStrike)} | ${f(r.strike[own])} ${f(r.strike[oth])} | ${r.lost[own]}/${r.lost[oth]}`);
      if (LOG) console.log('     ' + r.log.join('\n     '));
    }
    const col = k => R.map(k), d = R.map(r => r.baseStrike !== null && r.fbSight[own] !== null ? +(r.baseStrike - r.fbSight[own]).toFixed(1) : null);
    const da = R.map(r => r.alarm && r.fbSight[own] !== null ? +(r.alarm.t - r.fbSight[own]).toFixed(1) : null);
    const st = R.flatMap(r => r.station.filter(s => s.n === own)), so = R.flatMap(r => r.station.filter(s => s.n === oth));
    console.log(`SUMMARY ${sc}: ramp departures ${mean(col(r => r.ramp[own]))}/rd, lagoon landings ${mean(col(r => r.lagoon[own]))}/rd, patrol launches ${own} ${mean(col(r => r.launches[own]))} ${oth} ${mean(col(r => r.launches[oth]))}`);
    console.log(`  first contact (median s) ${own} ${med(col(r => r.contact[own]))} ${oth} ${med(col(r => r.contact[oth]))} | boat's first sighting ${own} ${med(col(r => r.fbSight[own]))} (${col(r => r.fbSight[own]).filter(v => v !== null).length}/${R.length}) ${oth} ${med(col(r => r.fbSight[oth]))}`);
    console.log(`  alarm: reported enemy's range from the base median ${med(col(r => r.alarm && r.alarm.kind === 'patrol' ? r.alarm.d : null))} (base strike reach 560)`);
    console.log(`  base alarm median ${med(col(r => r.alarm && r.alarm.t))} kinds ${JSON.stringify(R.reduce((m, r) => { const k = r.alarm ? r.alarm.kind : 'none'; m[k] = (m[k] || 0) + 1; return m; }, {}))} | alarm - boat sighting median ${med(da)} | scramble median ${med(col(r => r.scramble))} | base strike median ${med(col(r => r.baseStrike))}, minus boat sighting median ${med(d)}`);
    console.log(`  first strike launch median ${own} ${med(col(r => r.strike[own]))} ${oth} ${med(col(r => r.strike[oth]))} | boat sorties ${own} ${st.length} mean airborne ${mean(st.map(s => s.up))}s lost ${st.filter(s => s.lost).length} | ${oth} ${so.length} mean ${mean(so.map(s => s.up))}s lost ${so.filter(s => s.lost).length} | wins ${JSON.stringify(R.reduce((m, r) => { m[r.winner || 'draw'] = (m[r.winner || 'draw'] || 0) + 1; return m; }, {}))}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
