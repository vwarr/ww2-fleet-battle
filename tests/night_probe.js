// Night rounds probe (read-only recorder: no WW.rand, no writes to sim objects): forced night (daylight.js force) over
// standard / carrier_duel / battle_line / midway (an island base) fleets. Per round: the clock (start hour, end hour,
// daylight at the end, round kind as rolled), the first contact, the fleets meeting (main.js metT) and the first gun
// shot, the end reason and length; every SAMPLE s the fleet postures, each carrier's range to the nearest enemy gun
// ship and whether she is opening or closing it, the planes queued / spotted on deck, the strike orders the commander
// holds, and the nearest pair of opposing gun ships.
// Usage: node tests/night_probe.js [--only standard,carrier_duel,battle_line,midway] [--seeds 8] [--seed0 1] [--tod night] [--log] [--workers 2]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,battle_line,midway').split(','), LOG = argv.includes('--log');
const TOD = arg('--tod', 'night');
const SC = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'USN' }
};
const spec = (sc, seed) => {
  const c = SC[sc], tod = TOD === 'none' ? undefined : TOD;
  return c.random ? { scen: sc, seed, random: true, light: true, tod } : { scen: sc, seed, A: c.A, B: c.B, aNation: c.aN || (seed % 2 ? 'USN' : 'IJN'), base: c.base || null, cripple: -1, light: true, tod };
};

function install() {
  const SAMPLE = 20, GUN = { battleship: 1, cruiser: 1, destroyer: 1 };
  let S = null;
  const rt = () => WW.game.roundTime;
  const fresh = () => { S = { next: 0, series: [], firstShot: null, firstShotBy: null, cvD: { USN: [], IJN: [] }, deckMax: 0, deckSum: 0, deckN: 0, lit: 0, flares: 0, events: [], prev: {} }; };
  fresh(); WW.on('roundStart', fresh);
  WW.on('shellFired', e => { if (S.firstShot === null && e && e.ship && !e.ship.isBase && e.cal !== 'mg' && e.proj && e.proj.target && e.proj.target.nation !== e.ship.nation) { S.firstShot = +rt().toFixed(0); S.firstShotBy = e.ship.nation + ' ' + e.ship.type; } });
  WW.on('nightPlan', e => { if (S.events.length < 30) S.events.push(+rt().toFixed(0) + ' ' + (e && e.nation) + ' ' + (e && e.what)); });
  WW.on('flare', () => { S.flares++; });
  WW.on('weaponDropped', e => { const p = e && e.plane; if (S.firstDrop === undefined && p && (p.kind === 'dive' || p.kind === 'torpedo')) S.firstDrop = +rt().toFixed(0); });
  const u0 = WW.fleetCmd.update;
  WW.fleetCmd.update = function (dt) {
    const r = u0.apply(this, arguments);
    if (S && WW.game.state === 'battle') { if (S.l0 === undefined) S.l0 = WW.stats.planesLaunched; else if (S.firstLaunch === undefined && WW.stats.planesLaunched > S.l0) S.firstLaunch = +rt().toFixed(0); }
    if (!S || WW.game.state !== 'battle' || rt() < S.next) return r;
    S.next = rt() + SAMPLE;
    const ships = WW.world.ships, row = { t: +rt().toFixed(0), h: +WW.dayNight.hour.toFixed(2), dl: +WW.daylight.toFixed(2), post: {}, cv: [], deck: 0, orders: 0, gg: null, park: WW.airDeck && WW.airDeck.parkedCount ? WW.airDeck.parkedCount() : 0 };
    for (const n of ['USN', 'IJN']) { const B = WW.fleetCmd.side(n); row.post[n] = B ? B.posture + (B.nightMode ? '/' + B.nightMode : '') : '-'; if (B) row.orders += B.strikes.size; }
    let gg = 1e9;
    for (const s of ships) {
      if (!s.alive || s.sinking || s.isBase) continue;
      if (GUN[s.type]) for (const e of ships) if (e.alive && !e.sinking && !e.isBase && e.nation !== s.nation && GUN[e.type]) gg = Math.min(gg, WW.dist(s.x, s.z, e.x, e.z));
      if (s.type !== 'carrier') continue;
      let d = 1e9; for (const e of ships) if (e.alive && !e.sinking && !e.isBase && e.nation !== s.nation && GUN[e.type]) d = Math.min(d, WW.dist(s.x, s.z, e.x, e.z));
      const q = (s.ai && s.ai.queue ? s.ai.queue.length : 0), spot = s._deck ? s._deck.launchers.length : 0;
      row.deck += q + spot;
      const prev = S.prev[s.id]; S.prev[s.id] = d;
      row.cv.push(s.nation[0] + Math.round(d) + (prev !== undefined && d < 1e8 ? (d > prev + 5 ? '+' : d < prev - 5 ? '-' : '=') : '') + ' q' + q + ' s' + spot + ' v' + (s.speed !== undefined ? s.speed.toFixed(1) : '?'));
      if (d < 1e8) S.cvD[s.nation].push(d);
    }
    row.gg = gg < 1e8 ? Math.round(gg) : null;
    S.deckMax = Math.max(S.deckMax, row.deck); if (row.dl < 0.5) { S.parkDark = Math.max(S.parkDark || 0, row.park); S.parkDarkSum = (S.parkDarkSum || 0) + row.park; S.darkN = (S.darkN || 0) + 1; }
    if (S.cvMinNight === undefined) S.cvMinNight = 1e9; if (row.dl < 0.5) for (const c of row.cv) { const m = /^[UI](\d+)/.exec(c); if (m && +m[1] < 1e8) S.cvMinNight = Math.min(S.cvMinNight, +m[1]); } S.deckSum += row.deck; S.deckN++;
    S.series.push(row);
    return r;
  };
  window.__np = { flush: () => { const o = JSON.parse(JSON.stringify(S)); delete o.prev; fresh(); return o; } };
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
    while (next < list.length) {
      const sp = list[next++];
      res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => {
        const r = window.__beh.run(sp), o = window.__np.flush(), D = WW.dayNight;
        o.winner = r.winner; o.len = r.len; o.end = r.end; o.kind = D.kind; o.h0 = +D.startHour.toFixed(2); o.h1 = +D.hour.toFixed(2); o.dl1 = +WW.daylight.toFixed(2);
        o.contact = WW.game.contactT === null ? null : +WW.game.contactT.toFixed(0); o.predawn = !!D.predawn; o.met = r.met; o.sunk = r.sunk ? r.sunk.length : 0;
        o.launches = r.planesFlown; o.dark = r.night && r.night.d ? { launchesDark: r.night.d.launchesDark, struck: r.night.d.struckBelow, blocked: r.night.d.blocked } : null;
        o.stars = r.night && r.night.n ? r.night.n.starShells : null;
        return o;
      }, sp)));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  res.sort((a, b) => a.scen < b.scen ? -1 : a.scen > b.scen ? 1 : a.seed - b.seed);
  const med = a => { a = a.filter(v => v !== null && v !== undefined).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  for (const sc of ONLY) {
    const R = res.filter(r => r.scen === sc);
    console.log(`\n== ${sc} (tod ${TOD}) ==`);
    for (const r of R) {
      console.log(`seed ${r.seed}: ${r.kind}${r.predawn ? '(predawn)' : ''} ${r.h0}h -> ${r.h1}h dl ${r.dl1} | contact ${r.contact} met ${r.met} 1st shot ${r.firstShot} (${r.firstShotBy || '-'}) | end ${r.end} at ${r.len} winner ${r.winner} sunk ${r.sunk} | deck max ${r.deckMax} parked in the dark max ${r.parkDark || 0} cv min range dark ${r.cvMinNight === 1e9 || r.cvMinNight === undefined ? '-' : Math.round(r.cvMinNight)} | 1st launch ${r.firstLaunch === undefined ? '-' : r.firstLaunch} 1st air drop ${r.firstDrop === undefined ? '-' : r.firstDrop} | planes flown ${JSON.stringify(r.launches)} dark ${JSON.stringify(r.dark)} stars ${JSON.stringify(r.stars)} flares ${r.flares}`);
      if (LOG) { for (const w of r.series) console.log(`   t${w.t} ${w.h}h dl${w.dl} ${w.post.USN}|${w.post.IJN} gg ${w.gg} deck ${w.deck} park ${w.park} ord ${w.orders} ${w.cv.join(' ')}`); if (r.events.length) console.log('   events: ' + r.events.join('; ')); }
    }
    const ends = R.reduce((m, r) => { m[r.end] = (m[r.end] || 0) + 1; return m; }, {});
    console.log(`SUMMARY ${sc}: kinds ${JSON.stringify(R.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}))} | contact med ${med(R.map(r => r.contact))} (${R.filter(r => r.contact !== null).length}/${R.length}) | met ${R.filter(r => r.met !== null).length}/${R.length} med ${med(R.map(r => r.met))} | 1st shot med ${med(R.map(r => r.firstShot))} (${R.filter(r => r.firstShot !== null).length}/${R.length}) | len med ${med(R.map(r => r.len))} | ends ${JSON.stringify(ends)} | sunk mean ${(R.reduce((s, r) => s + r.sunk, 0) / R.length).toFixed(1)} | deck max med ${med(R.map(r => r.deckMax))} | end hour med ${med(R.map(r => r.h1))} | flares ${R.reduce((s, r) => s + r.flares, 0)} | parked-in-dark mean ${(R.reduce((s, r) => s + (r.darkN ? r.parkDarkSum / r.darkN : 0), 0) / R.length).toFixed(1)} | cv min range in dark med ${med(R.map(r => r.cvMinNight === 1e9 ? null : r.cvMinNight && Math.round(r.cvMinNight)))} | 1st launch med ${med(R.map(r => r.firstLaunch))} 1st air drop med ${med(R.map(r => r.firstDrop))} (${R.filter(r => r.firstDrop !== undefined).length}/${R.length}) | wins ${JSON.stringify(R.reduce((m, r) => { m[r.winner || 'draw'] = (m[r.winner || 'draw'] || 0) + 1; return m; }, {}))}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
