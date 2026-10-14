// Doomed bombers (read-only recorder): per round, IJN jibaku (air_deaths.js mode 'crash' by choice), USN stricken
// releases (a shot-down bomber on its attack letting go) and how many of those hit, and the accidental wreck-on-ship
// hits (air_impact.js) of either side.
// Usage: node tests/jibaku_probe.js [--only standard,midway] [--seeds N=8] [--seed0 S=1] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,midway').split(',');
const MW = SB.SCEN.find(s => s.name === 'midway');
const spec = (sc, seed) => sc === 'standard' ? { seed, random: true, light: true, scen: sc } : { seed, A: MW.A, B: MW.B, aNation: 'USN', base: 'USN', cripple: -1, noStall: false, light: true, scen: sc };

(async () => {
  const list = []; for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(spec(sc, s));
  const b = await HL.launch(), res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    while (next < list.length) {
      const sp = list[next++];
      res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => {
        window.__beh.run(sp);
        const c = WW.airDeaths._debug().counts, I = WW.airImpact ? WW.airImpact.stats : {};
        return { jI: c.jibaku.IJN, jU: c.jibaku.USN, st: c.stricken, sh: c.strickenHits, so: c.strickenOut, wreckShip: I.ship || 0 };
      }, sp)));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  for (const sc of ONLY.concat(['ALL'])) {
    const L = sc === 'ALL' ? res : res.filter(r => r.scen === sc), N = L.length || 1, sum = k => L.reduce((s, r) => s + r[k], 0);
    const st = sum('st'), sh = sum('sh'), so = sum('so');
    console.log(`${sc.padEnd(9)} ${N} rounds: IJN jibaku ${(sum('jI') / N).toFixed(2)}/rd, USN jibaku ${(sum('jU') / N).toFixed(2)}/rd | USN stricken releases ${(st / N).toFixed(2)}/rd, hit ${sh}/${sh + so} resolved (${sh + so ? (100 * sh / (sh + so)).toFixed(0) : '-'}%) | wrecks on a ship (all, incl. jibaku) ${(sum('wreckShip') / N).toFixed(2)}/rd`);
  }
})();
