// Normandy balance (docs/NORMANDY_PLAN.md P9): full seeded rounds to their end in the node runner; per seed the winner,
// the reason, the time, men landed / lost (total and the heaviest sectors), draws opened. The target: a hard-won
// victory in about 60-75% of seeds, the heaviest losses at Dog Green and Easy Red.
// Usage: node tests/normandy_balance.js [seeds=20] [seed0=1] [query]   (query: extra URL flags, e.g. cloud=0)
const H = require('./headless');
const NS = +(H.argv[0] || 20), S0 = +(H.argv[1] || 1), Q = H.argv[2] || '';
(async () => {
  const b = await H.launch(), W = Math.max(1, Math.min(H.WORKERS, NS)), pages = [], errs = [];
  for (let i = 0; i < W; i++) { const p = await b.newPage(); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message)); await p.goto(H.url('scn=normandy' + (Q ? '&' + Q : ''))); pages.push(p); }
  const seeds = []; for (let s = S0; s < S0 + NS; s++) seeds.push(s);
  const out = [];
  await Promise.all(pages.map(async p => {
    while (seeds.length) {
      const seed = seeds.shift();
      out.push(await p.evaluate(seed => {
        const G = WW.game; WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; G.composition = null; G.mode = 'auto'; WW.time.now = 0;
        G.startRound({ keepMap: true });
        while (G.state === 'battle' && G.roundTime < 1100) __sim.fastForward(5);
        const r = WW.normandyGame.result(), by = r.bySector;
        const worst = Object.keys(by).filter(k => k !== 'hoc').sort((a, c) => by[c].lost - by[a].lost).slice(0, 2).join(',');
        return { seed, winner: G.winner, reason: G.endReason, t: Math.round(G.roundTime), landed: r.landed, lost: r.lost, draws: Object.keys(r.draws).length, onTop: r.onTop, silenced: r.silenced, worst, hoc: r.hocGuns };
      }, seed));
    }
  }));
  out.sort((a, c) => a.seed - c.seed);
  for (const r of out) console.log(`seed ${r.seed}: ${r.winner} (${r.reason}) t=${r.t} landed ${r.landed} lost ${r.lost} (${Math.round(100 * r.lost / Math.max(1, r.landed))}%) draws ${r.draws} top ${r.onTop} WN ${r.silenced} worst ${r.worst}${r.hoc ? ' hoc' : ''}`);
  const wins = out.filter(r => r.winner === 'USN'), t = wins.map(r => r.t).sort((a, c) => a - c);
  const worstCount = {}; out.forEach(r => r.worst.split(',').forEach(k => { worstCount[k] = (worstCount[k] || 0) + 1; }));
  console.log(`USN wins ${wins.length}/${out.length} (${Math.round(100 * wins.length / out.length)}%), win time median ${t[t.length >> 1] || '-'} s, mean losses ${Math.round(out.reduce((k, r) => k + r.lost / Math.max(1, r.landed), 0) / out.length * 100)}%, heaviest sectors ${JSON.stringify(worstCount)}`);
  if (errs.length) console.log('errors:', [...new Set(errs)].slice(0, 5));
  await b.close();
})();
