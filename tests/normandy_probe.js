// Normandy probe (docs/NORMANDY_PLAN.md): seeded Normandy rounds in the sim-only runner (?sim&scn=normandy).
// Checks per seed: no page errors, no NaN positions or hp, the sides are USN and GER, the round runs to its end
// (or SECS), and the same seed replays the same trace (determinism). Grows with each phase (P4 defences, ...).
// P2 terrain (per seed): along Omaha (x 1350-2150) depth >= 8 at 450 u out and >= 4 at 100 u out (battleships /
// destroyers), the tidal flat 0-1.5 deep over its first 30 u, land behind the waterline and the bluff top 3-7 u
// high, the five draws lower than the bluffs beside them, Pointe du Hoc a headland (land 30 u north of the cliff
// line beside it), and the same layout on every seed (shoreline and bluff heights within the detail noise).
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
    // the coast (P2)
    const T = WW.normandyTerrain, d = (x, z) => WW.terrain.depthAt(x, z), terr = [];
    for (let x = 1350; x <= 2150; x += 25) {
      const zs = T.shoreZ(x), st = T.station(x);
      if (d(x, zs - 450) < 8) terr.push(`x=${x} depth ${d(x, zs - 450).toFixed(1)} at 450 out`);
      if (d(x, zs - 100) < 4) terr.push(`x=${x} depth ${d(x, zs - 100).toFixed(1)} at 100 out`);
      for (const s of [3, 15, 30]) if (!(d(x, zs - s) >= -0.05 && d(x, zs - s) <= 1.6)) terr.push(`x=${x} flat depth ${d(x, zs - s).toFixed(2)} at ${s} out`);
      if (!(d(x, zs + 5) < 0)) terr.push(`x=${x} not land 5 u inland`);
      const top = -d(x, T.bluffTopZ(x) + 6);
      if (!st.draw && !(top > 3 && top < 7.5)) terr.push(`x=${x} bluff top ${top.toFixed(1)}`);
    }
    for (const dr of WW.normandyData.DRAWS) { const z = T.bluffTopZ(dr.x) + 4, a = -d(dr.x, z), b = -d(dr.x + 3 * dr.w, z); if (!(a < b - 1)) terr.push(`draw ${dr.id} ${a.toFixed(1)} vs bluff ${b.toFixed(1)}`); }
    if (!(d(725, T.shoreZ(680) - 25) < 0)) terr.push('Pointe du Hoc is not a headland');
    const layout = [700, 725, 1372, 1700, 2000].map(x => [T.shoreZ(x), -d(x, T.bluffTopZ(x) + 10)]);
    const tr = [], sides = WW.sides().join(',');
    const nations = new Set(WW.world.ships.map(s => s.nation));
    for (let t = 5; t <= secs + 1e-9 && G.state === 'battle'; t += 5) {
      __sim.fastForward(5);
      for (const s of WW.world.ships) if (![s.x, s.z, s.hp, s.heading].every(Number.isFinite)) bad.push(`t=${t} ship ${s.id} ${s.nation} ${s.type} NaN`);
      for (const q of WW.world.planes) if (q.alive && ![q.x, q.y, q.z].every(Number.isFinite)) bad.push(`t=${t} plane ${q.nation} ${q.kind} NaN`);
      tr.push(WW.world.ships.map(s => [s.id, s.x, s.z, s.hp].join(',')).join(';'));
    }
    return { terr: terr.slice(0, 6), layout, obst: T.obstacles.length, sides, nations: [...nations].join(','), ships: WW.world.ships.length, state: G.state, t: +G.roundTime.toFixed(1), winner: G.winner, reason: G.endReason,
      sunk: WW.world.ships.filter(s => !s.alive || s.sinking).map(s => s.nation + ' ' + s.type).join(', '), shells: WW.stats.shellsFired, bad: bad.slice(0, 5), tr };
  }, [seed, SECS]);
  let layout0 = null;
  for (const seed of SEEDS) {
    const a = await run(seed), c = await run(seed);
    const ha = crypto.createHash('sha1').update(JSON.stringify(a.tr)).digest('hex').slice(0, 12), hc = crypto.createHash('sha1').update(JSON.stringify(c.tr)).digest('hex').slice(0, 12);
    const probs = [...a.bad];
    if (a.sides !== 'USN,GER') probs.push('sides ' + a.sides);
    probs.push(...a.terr);
    if (layout0 === null) layout0 = a.layout;
    else if (a.layout.some((q, i) => Math.abs(q[0] - layout0[i][0]) > 0.01 || Math.abs(q[1] - layout0[i][1]) > 1.2)) probs.push(`layout ${JSON.stringify(a.layout)} differs from the first seed's`);
    if (ha !== hc) probs.push(`replay differs ${ha} / ${hc}`);
    if (probs.length) fail++;
    console.log(`seed ${seed}: ${ha} ${a.state} t=${a.t} ${a.winner || '-'} (${a.reason || '-'}) ships ${a.ships} [${a.nations}] obstacles ${a.obst} sunk: ${a.sunk || 'none'}  ${probs.length ? 'FAIL ' + probs.join('; ') : 'ok'}`);
  }
  await b.close();
  if (errs.length) { fail++; console.log('page errors:\n' + [...new Set(errs)].slice(0, 10).join('\n')); }
  console.log(fail ? `FAIL: ${fail} problem(s)` : 'PASS');
  process.exit(fail ? 1 : 0);
})();
