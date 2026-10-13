// Normandy probe (docs/NORMANDY_PLAN.md): seeded Normandy rounds in the sim-only runner (?sim&scn=normandy).
// Checks per seed: no page errors, no NaN positions or hp, the sides are USN and GER, the round runs to its end
// (or SECS), and the same seed replays the same trace (determinism). Grows with each phase (P2 terrain, P4 defences, ...).
// Usage: node tests/normandy_probe.js [seeds=1,2,3] [secs=400]
const crypto = require('crypto');
const H = require('./headless');
const SEEDS = (H.argv[0] || '1,2,3').split(',').map(Number), SECS = +(H.argv[1] || 400);
(async () => {
  const b = await H.launch(), errs = [];
  const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(H.url('scn=normandy'));
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  let fail = 0;
  const run = seed => p.evaluate(([seed, secs]) => {
    const G = WW.game, bad = [];
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    G.composition = null; G.mode = 'auto';
    G.startRound({ keepMap: true });
    const tr = [], sides = WW.sides().join(',');
    const nations = new Set(WW.world.ships.map(s => s.nation));
    for (let t = 5; t <= secs + 1e-9 && G.state === 'battle'; t += 5) {
      __sim.fastForward(5);
      for (const s of WW.world.ships) if (![s.x, s.z, s.hp, s.heading].every(Number.isFinite)) bad.push(`t=${t} ship ${s.id} ${s.nation} ${s.type} NaN`);
      for (const q of WW.world.planes) if (q.alive && ![q.x, q.y, q.z].every(Number.isFinite)) bad.push(`t=${t} plane ${q.nation} ${q.kind} NaN`);
      tr.push(WW.world.ships.map(s => [s.id, s.x, s.z, s.hp].join(',')).join(';'));
    }
    return { sides, nations: [...nations].join(','), ships: WW.world.ships.length, state: G.state, t: +G.roundTime.toFixed(1), winner: G.winner, reason: G.endReason,
      sunk: WW.world.ships.filter(s => !s.alive || s.sinking).map(s => s.nation + ' ' + s.type).join(', '), shells: WW.stats.shellsFired, bad: bad.slice(0, 5), tr };
  }, [seed, SECS]);
  for (const seed of SEEDS) {
    const a = await run(seed), c = await run(seed);
    const ha = crypto.createHash('sha1').update(JSON.stringify(a.tr)).digest('hex').slice(0, 12), hc = crypto.createHash('sha1').update(JSON.stringify(c.tr)).digest('hex').slice(0, 12);
    const probs = [...a.bad];
    if (a.sides !== 'USN,GER') probs.push('sides ' + a.sides);
    if (ha !== hc) probs.push(`replay differs ${ha} / ${hc}`);
    if (probs.length) fail++;
    console.log(`seed ${seed}: ${ha} ${a.state} t=${a.t} ${a.winner || '-'} (${a.reason || '-'}) ships ${a.ships} [${a.nations}] sunk: ${a.sunk || 'none'}  ${probs.length ? 'FAIL ' + probs.join('; ') : 'ok'}`);
  }
  await b.close();
  if (errs.length) { fail++; console.log('page errors:\n' + [...new Set(errs)].slice(0, 10).join('\n')); }
  console.log(fail ? `FAIL: ${fail} problem(s)` : 'PASS');
  process.exit(fail ? 1 : 0);
})();
