// Recovery-rate probe (diagnosis, read-only): why a carrier's marshal stack drains slowly. One seeded round; every
// STEP s per carrier: landing queue, traps since the last line, wave-offs by reason, the deck park (planes parked on
// deck, loose / on the elevator), the hangar count, the deck mode and whether the window is closing, the ship's turn
// rate and the daylight. Usage: node tests/air_recovery_probe.js SCEN SEED [STEP=10] [FROM=0]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const [scen = 'standard', seed = '9', step = '10', from = '0'] = HL.argv;
const SC = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' }
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
  const out = await p.evaluate(([spec, STEP, FROM]) => {
    const L = [], last = new Map(); let next = FROM;
    const u0 = WW.air.update;
    WW.air.update = function (dt) {
      const r = u0.apply(this, arguments);
      const t = WW.game.roundTime; if (t < next) return r; next = t + STEP;
      const RS = WW.airDeck.recovery, IB = WW.islandBase, b = IB && IB.base;
      if (b && b.ai) {   // the island base: circuit, ground, runway
        const st = {}; for (const q of WW.world.planes) if (q.alive && q.carrier === b) { const k = q.state + (q.rwPh ? ':' + q.rwPh : '') + (q.gPh ? ':' + q.gPh : ''); st[k] = (st[k] || 0) + 1; }
        L.push([t.toFixed(0), 'BASE', b.nation, 'runwayOpen', IB.runwayOpen() ? 1 : 0, 'neutralized', b.neutralized ? 1 : 0, 'mode', b.ops ? b.ops.mode : '', 'lq', b.ai.lq ? b.ai.lq.length : 0, 'landings', WW.landAir ? WW.landAir.stats.landings : '', 'holds', WW.landAir ? WW.landAir.stats.holds : '', JSON.stringify(st)].join(' '));
      }
      for (const c of WW.world.ships) {
        const D = c._deck; if (!c.alive || !D || c.isBase) continue;
        const ph = {}; for (const q of D.lq) ph[q.deckPh] = (ph[q.deckPh] || 0) + 1;
        let park = 0; for (const col of D.cols) park += col.e.length;
        const tr = WW.stats.planesLanded, w = JSON.stringify(RS.why), l = last.get(c) || { traps: 0, n: 0 };
        let ret = 0; for (const q of WW.world.planes) if (q.alive && q.carrier === c && q.state === 'return') ret++;
        const hg = c.hangar.fighter + c.hangar.dive + c.hangar.torpedo + (c.rearm ? c.rearm.length : 0);
        L.push([t.toFixed(0), c.nation, c.id, D.mode, D.closing ? 'closing' : '', 'lq', D.lq.length, JSON.stringify(ph), 'ret', ret, 'trapsTot', D.recN, 'park', park, 'loose', D.loose.length, D.loose.filter(e => e.ph === 'elev').length,
          'aboard', hg, 'launchers', D.launchers.length, 'turn', (c.turnRate || 0).toFixed(2), 'spd', c.speed.toFixed(1), 'day', WW.daylight.toFixed(2), 'fly', WW.dayNight.canFly() ? 1 : 0, 'why', w].join(' '));
      }
      return r;
    };
    const o = window.__beh.run(spec);
    return { L, len: o.len, w: o.winner, RS: WW.airDeck.recovery };
  }, [spec, +step, +from]);
  console.log(out.L.join('\n')); console.log('len', out.len, 'winner', out.w, JSON.stringify(out.RS));
  await b.close();
})();
