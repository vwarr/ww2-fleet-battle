// Normandy probe (docs/NORMANDY_PLAN.md): seeded Normandy rounds in the sim-only runner (?sim&scn=normandy).
// Checks per seed: no page errors, no NaN positions or hp, the sides are USN and GER, the round runs to its end
// (or SECS), and the same seed replays the same trace (determinism). Grows with each phase (P4 defences, ...).
// P2 terrain (per seed): along Omaha (x 1350-2150) depth >= 8 at 450 u out and >= 4 at 100 u out (battleships /
// destroyers), the tidal flat 0-1.5 deep over its first 30 u, land behind the waterline and the bluff top 3-7 u
// high, the five draws lower than the bluffs beside them, Pointe du Hoc a headland (land 30 u north of the cliff
// line beside it), and the same layout on every seed (shoreline and bluff heights within the detail noise).
// P4 defences: 13 strongpoints / 70 elements built, the Germans fire (shells) within the run, and after it a unit
// test on a fresh round: a casemate hit on its sea wall takes WALL_K x, through its embrasure 1x; a near miss
// suppresses; knocking out every weapon of a WN silences it (event, intel contact gone).
// P5 fire support: the bombardment group is the real one (Texas, Arkansas, HMS Glasgow, the French cruisers, the
// Gleaves destroyers and HMS Talybont, with their flags), the fire plan knocks out at least 3 elements by 400 s, and
// the destroyers that close the beach stay in navigable water (>= 3, the type's minDepth).
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
    const C0 = WW.coastDefence, nm = WW.world.ships.filter(s => s.nation === 'USN').map(s => s.name + (s.flag !== 'USN' ? '/' + s.flag : '')).join(',');
    let ddMin = 99;
    for (let t = 5; t <= secs + 1e-9 && G.state === 'battle'; t += 5) {
      __sim.fastForward(5);
      for (const s of WW.world.ships) if (![s.x, s.z, s.hp, s.heading].every(Number.isFinite)) bad.push(`t=${t} ship ${s.id} ${s.nation} ${s.type} NaN`);
      for (const q of WW.world.planes) if (q.alive && ![q.x, q.y, q.z].every(Number.isFinite)) bad.push(`t=${t} plane ${q.nation} ${q.kind} NaN`);
      if (WW.fireSupport && WW.fireSupport.closing({ type: 'destroyer' })) for (const s of WW.world.ships) if (s.alive && s.type === 'destroyer' && s.nation === 'USN') ddMin = Math.min(ddMin, WW.terrain.depthAt(s.x, s.z));
      tr.push(WW.world.ships.map(s => [s.id, s.x, s.z, s.hp].join(',')).join(';') + '|' + C0.elements.map(e => e.hp.toFixed(3) + (e.alive ? '' : 'x')).join(','));
    }
    const shots = C0.stats.shots, dHits = C0.stats.hits;
    const C = WW.coastDefence, def = { els: C.elements.length, wns: C.wns.length, shots: 0 };
    return { terr: terr.slice(0, 6), layout, obst: T.obstacles.length, def, sides, nations: [...nations].join(','), ships: WW.world.ships.length, state: G.state, t: +G.roundTime.toFixed(1), winner: G.winner, reason: G.endReason,
      shots, dHits, nm, ddMin, out: C0.stats.out, sunk: WW.world.ships.filter(s => !s.alive || s.sinking).map(s => s.nation + ' ' + s.type).join(', '), shells: WW.stats.shellsFired, bad: bad.slice(0, 5), tr };
  }, [seed, SECS]);
  let layout0 = null;
  // the damage model, on a fresh round (after the seeded runs: it draws WW.rand)
  const unit = () => p.evaluate(() => {
    const G = WW.game, C = WW.coastDefence, out = [];
    WW.terrain.generate(9); WW.seedRandom(9); G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    const c88 = C.elements.find(e => e.kind === 'c88' && e.wn.wid === 'WN72'), h0 = c88.hp;
    c88.takeDamage(100, c88.x, c88.z, 'shell', 'med', { x0: c88.x + 20, z0: c88.z - 300 });   // from the sea: the wall
    const wall = h0 - c88.hp;
    if (Math.abs(wall - 100 * C.WALL_K) > 1e-6) out.push('wall hit took ' + wall.toFixed(1));
    const c50 = C.elements.find(e => e.kind === 'c50' && e.wn.wid === 'WN72'), h1 = c50.hp;
    c50.takeDamage(40, c50.x, c50.z, 'shell', 'small', { x0: c50.x + 160, z0: c50.z - 70 });   // from the east, along the beach: the embrasure
    if (c50.alive && Math.abs(h1 - c50.hp - 40) > 1e-6) out.push('embrasure hit took ' + (h1 - c50.hp).toFixed(1));
    const mg = C.elements.find(e => e.kind === 'mg' && e.wn.wid === 'WN70');
    C.impact('USN', mg.x + 6, mg.z, 110, 'shell', 'big');
    if (!(mg.suppressedUntil > WW.time.now)) out.push('near miss did not suppress');
    let ev = null; WW.on('defenceEvent', e => { if (e.kind === 'silenced' && e.wn.wid === 'WN61') ev = e; });
    const wn = C.wnOf('WN61'); wn.elements.forEach(e => C.knockOut(e));
    if (!ev || wn.alive || !wn.silenced) out.push('WN61 not silenced');
    WW.intel.update(1);
    if (WW.intel.enemyShips('USN').some(c => c.unit === wn)) out.push('silenced WN still a contact');
    return out;
  });
  for (const seed of SEEDS) {
    const a = await run(seed), c = await run(seed);
    const ha = crypto.createHash('sha1').update(JSON.stringify(a.tr)).digest('hex').slice(0, 12), hc = crypto.createHash('sha1').update(JSON.stringify(c.tr)).digest('hex').slice(0, 12);
    const probs = [...a.bad];
    if (a.sides !== 'USN,GER') probs.push('sides ' + a.sides);
    probs.push(...a.terr);
    if (a.def.els !== 70 || a.def.wns !== 13) probs.push(`defences built ${a.def.wns} WN / ${a.def.els} elements`);
    if (!(a.shots > 0)) probs.push('no German gun fired');
    for (const n of ['Texas', 'Arkansas', 'Glasgow/RN', 'Montcalm/FNFL', 'Georges Leygues/FNFL', 'Talybont/RN', 'Satterlee', 'Carmick']) if (!a.nm.split(',').includes(n)) probs.push('missing ' + n);
    if (SECS >= 400 && a.out < 3) probs.push(`only ${a.out} elements knocked out`);
    if (a.ddMin < 3) probs.push(`a closing destroyer in ${a.ddMin.toFixed(1)} u of water`);
    if (layout0 === null) layout0 = a.layout;
    else if (a.layout.some((q, i) => Math.abs(q[0] - layout0[i][0]) > 0.01 || Math.abs(q[1] - layout0[i][1]) > 1.2)) probs.push(`layout ${JSON.stringify(a.layout)} differs from the first seed's`);
    if (ha !== hc) probs.push(`replay differs ${ha} / ${hc}`);
    if (probs.length) fail++;
    console.log(`seed ${seed}: ${ha} ${a.state} t=${a.t} ${a.winner || '-'} (${a.reason || '-'}) ships ${a.ships} [${a.nations}] obstacles ${a.obst} GER shots ${a.shots} hits on defences ${a.dHits} out ${a.out} dd depth >= ${a.ddMin.toFixed(1)} sunk: ${a.sunk || 'none'}  ${probs.length ? 'FAIL ' + probs.join('; ') : 'ok'}`);
  }
  const u = await unit();
  console.log('damage model: ' + (u.length ? 'FAIL ' + u.join('; ') : 'ok'));
  if (u.length) fail++;
  await b.close();
  if (errs.length) { fail++; console.log('page errors:\n' + [...new Set(errs)].slice(0, 10).join('\n')); }
  console.log(fail ? `FAIL: ${fail} problem(s)` : 'PASS');
  process.exit(fail ? 1 : 0);
})();
