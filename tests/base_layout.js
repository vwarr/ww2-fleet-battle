// Island base ground-plan report (sim): spots per class, rows, columns, facilities and the air group per seed.
// Usage: node tests/base_layout.js [seeds=8] [seed0=1] [group=1] [--browser]
'use strict';
const HL = require('./headless');
const args = HL.argv.filter(a => !a.startsWith('--'));
const N = +(args[0] || 8), S0 = +(args[1] || 1), GROUP = +(args[2] || 1); // group: WW.islandBase.TUNE.group
(async () => {
  const b = await HL.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(HL.url()); await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  const out = await p.evaluate(([n, s0, grp]) => {
    const res = []; WW.islandBase.TUNE.group = grp;
    for (let seed = s0; seed < s0 + n; seed++) {
      WW.terrain.generate(seed); WW.seedRandom(seed);
      const base = WW.islandBase.build(seed % 2 ? 'USN' : 'IJN'), L = base.layout, pl = WW.landGround.plan(base);
      res.push({ seed, kind: L.S.kind, land: +(WW.terrain.landFraction * 100).toFixed(1), want: pl.demand, spots: L.spots.reduce((o, s) => (o[s.cls] = (o[s.cls] || 0) + 1, o), {}),
        slots: base.slots.length, rows: L.rows.map(r => r.cls + (r.side > 0 ? '+' : '-') + Math.abs(r.laneV).toFixed(0) + ':' + r.spots.length).join(' '),
 facs: base.facilities.map(f => f.kind[0]).join(''), dbg: L.dbg, dr: (L.dbgRows || []).join(' ') });
    }
    return res;
  }, [N, S0, GROUP]);
  for (const r of out) console.log(JSON.stringify(r));
  if (errs.length) console.log('errors', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
