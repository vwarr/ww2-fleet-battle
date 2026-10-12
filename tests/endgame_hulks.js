// Hulks given up (diagnosis): per scenario, the endgame stats of N rounds: hulks scuttled by an own destroyer's
// torpedo, hulks foundered, crews' scuttlings (IJN, hunted), escapes. Usage: node tests/endgame_hulks.js [SCEN=standard] [N=20]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const [scen = 'standard', n = '20'] = HL.argv;
const SC = { standard: { random: true }, midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] } };
(async () => {
  const b = await HL.launch(), p = await b.newPage();
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sum = {}, hits = [];
  for (let sd = 1; sd <= +n; sd++) {
    const sc = SC[scen], spec = sc.random ? { seed: sd, random: true, light: true } : { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
    const eg = await p.evaluate(spec => window.__beh.run(spec).eg, spec);
    for (const k of ['scuttledHulks', 'foundered', 'scuttled', 'escaped']) { const v = eg[k].USN + eg[k].IJN; sum[k] = (sum[k] || 0) + v; if (k === 'scuttledHulks' && v) hits.push(sd); }
  }
  console.log(scen, n, 'rounds', JSON.stringify(sum), 'scuttled-hulk seeds', hits.join(' '));
  await b.close();
})();
