// Air-staff probe: one seeded round (sim-only, node runner) with the air staff's strike-sizing log (air_staff.js size():
// time, nation, carrier, target, expected CAP, planned bombers / escorts -> sized, fighters available, commitment room,
// size cap, last strike's loss, bombers lost / left / at start, mauled, escort learning), break-offs and mauled groups.
// Usage: node tests/staff_probe.js [duel|midway|ijnbase|standard] [SEED=1]
const HL = require('./headless');
const SB = require('./sim_behaviour');
const [scen = 'duel', seed = '1'] = HL.argv;
const SC = {
  standard: { random: true },
  duel: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], base: 'USN', aFixed: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], base: 'IJN', aFixed: 'USN' }
};
(async () => {
  const b = await HL.launch(), p = await b.newPage();
  p.on('console', m => console.log(m.text()));
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sc = SC[scen], sd = +seed;
  const spec = sc.random ? { seed: sd, random: true, light: true } : { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  const o = await p.evaluate(spec => {
    WW.staff.log = [];
    WW.on('airOrder', e => { if (e.order === 'breakOff' || e.order === 'mauled') WW.staff.log.push(WW.time.now.toFixed(0) + ' ' + e.order + ' ' + e.carrier.nation + ' ' + (e.n || '')); });
    WW.on('admiralOrder', e => { if (e.order === 'airDefensive') WW.staff.log.push(WW.time.now.toFixed(0) + ' ' + e.text); });
    const o = window.__beh.run(spec);
    return { w: o.winner, len: o.len, log: WW.staff.log, st: WW.staff.stats };
  }, spec);
  console.log(o.log.join('\n')); console.log(JSON.stringify(o.st), 'winner', o.w, 'len', o.len);
  await b.close();
})();
