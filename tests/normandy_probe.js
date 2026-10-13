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
// P6 landing craft: the schedule's craft launch, men are ashore by 300 s, every craft that beached did so within 45 u
// of its sector (the flood current sets them east), and with the DD tanks launched far most of them founder.
// P7 infantry: squads come ashore, some reach the bluff tops by 400 s, at least one strongpoint is silenced by then,
// and the infantry step (infantry.js update, fire and the realism modules included) averages under 1.5 ms on the fastest
// seed (the timing is wall-clock: on a machine shared with other jobs every seed slows alike).
// P8 air: the B-24 boxes drop their sticks ~3 mi inland (cloud: no bomb within 200 u of the bluff tops), and a P-47
// flight strikes a strongpoint by 400 s.
// The realism pass (by 400 s, ~08:40): the vehicles come ashore (and the dozers), the 111th FA's DUKWs mostly
// founder, the gap teams blow lanes (beach_engineers.js) and mark some, the leaders get the men up at the shingle
// (Cota by 07:30-ish; Taylor's 08:15 in at least one seed), LCI(L)-91 burns out on Dog White and LCI(L)-85 is adrift
// burning, the Rangers' grapnels go up at Pointe du Hoc; the replay hash covers the lanes, vehicles, exits and leaders
// too. Craft released from the beachmaster's hold to an open draw may beach outside their sector (exempt from the
// stray check). Then a unit test on a fresh round: E-1's strongpoints silenced with engineers and vehicles at the
// shingle, the block is worked and opens, the jam drains up the draw; the strongpoint's garrison surrenders to the
// squad on it (prisoners.js).
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
    let infMs = 0, infN = 0;
    const iu = WW.infantry.update; WW.infantry.update = dt => { const t0 = performance.now(); iu(dt); infMs += performance.now() - t0; infN++; };
    const b24z = []; WW.on('weaponImpact', e => { if (e.kind === 'bomb' && e.proj && e.proj.nation === 'USN' && e.proj.dmg > 0 && b24z.length < 200 && e.proj.target === null) b24z.push(e.z - WW.normandyTerrain.bluffTopZ(e.x)); });
    const C0 = WW.coastDefence, nm = WW.world.ships.filter(s => s.nation === 'USN').map(s => s.name + (s.flag !== 'USN' ? '/' + s.flag : '')).join(',');
    let ddMin = 99;
    const lead = {}; WW.on('squadEvent', e => { if (e.kind === 'leader') lead[e.key] = (lead[e.key] || 0) + 1; });
    const named = {}; WW.on('craftEvent', e => { if (e.craft && e.craft.named) named[e.craft.named] = (named[e.craft.named] || '') + e.kind[0]; });
    for (let t = 5; t <= secs + 1e-9 && G.state === 'battle'; t += 5) {
      __sim.fastForward(5);
      for (const s of WW.world.ships) if (![s.x, s.z, s.hp, s.heading].every(Number.isFinite)) bad.push(`t=${t} ship ${s.id} ${s.nation} ${s.type} NaN`);
      for (const q of WW.world.planes) if (q.alive && ![q.x, q.y, q.z].every(Number.isFinite)) bad.push(`t=${t} plane ${q.nation} ${q.kind} NaN`);
      if (WW.fireSupport && WW.fireSupport.closing({ type: 'destroyer' })) for (const s of WW.world.ships) if (s.alive && s.type === 'destroyer' && s.nation === 'USN') ddMin = Math.min(ddMin, WW.terrain.depthAt(s.x, s.z));
      tr.push(WW.world.ships.map(s => [s.id, s.x, s.z, s.hp].join(',')).join(';') + '|' + C0.elements.map(e => e.hp.toFixed(3) + (e.alive ? '' : 'x')).join(',') +
        '|' + WW.beachEng.lanes.map(l => l.state + l.prog.toFixed(4)).join(',') + '|' + WW.vehicles.all.map(v => v.state + v.x.toFixed(3) + ',' + v.z.toFixed(3)).join(';') +
        '|' + WW.beachEng.blocks.map(b => b.state + b.prog.toFixed(4)).join(',') + '|' + WW.leaders.stats.squads + ',' + WW.hocClimb.stats.cut + ',' + WW.prisoners.stats.men);
    }
    const shots = C0.stats.shots, dHits = C0.stats.hits, LS = WW.landingCraft.stats;
    const DS = WW.normandyData.SECTORS, secOf = id => id === 'hoc' ? { x0: 726, x1: 752 } : DS.find(s => s.id === id);
    const stray = WW.landingCraft.craft.filter(u => u.state !== 'run' && u.state !== 'wrecked' && !u.exitTo && (u.x < secOf(u.sector).x0 - 45 || u.x > secOf(u.sector).x1 + 45)).length;
    const EB = WW.beachEng.stats, VS = WW.vehicles.stats, HC = WW.hocClimb.stats;
    const real = { lanes: EB.lanes, blown: EB.blown, cleared: EB.cleared, marked: EB.marked, veh: VS.landed, vehLost: VS.lost + VS.drowned, jamMax: VS.jamMax, dozers: VS.dozersAshore,
      dukw: LS.dukwLaunched, dukwF: LS.dukwFoundered, held: LS.held, lead, named, grapnels: HC.fired, ropesUp: HC.reached, cut: HC.cut, pris: WW.prisoners.stats.men };
    WW.infantry.update = iu;
    const inf = { squads: WW.infantry.stats.squads, top: WW.infantry.stats.onTop, lost: WW.infantry.stats.lost, sil: C0.stats.silenced, ms: infMs / Math.max(1, infN) };
    const lc = { launched: LS.launched, men: LS.menLanded, lost: LS.menLost, foundered: LS.foundered, dd: WW.landingCraft.plan.filter(r => r.craft === 'dd').length, stray };
    const C = WW.coastDefence, def = { els: C.elements.length, wns: C.wns.length, shots: 0 };
    return { terr: terr.slice(0, 6), layout, obst: T.obstacles.length, def, sides, nations: [...nations].join(','), ships: WW.world.ships.length, state: G.state, t: +G.roundTime.toFixed(1), winner: G.winner, reason: G.endReason,
      shots, dHits, lc, inf, nm, real, air: { b24: b24z.length, b24Near: b24z.filter(z => z < 200).length, p47: WW.offmapAir.stats.p47Bombs }, ddMin, out: C0.stats.out, sunk: WW.world.ships.filter(s => !s.alive || s.sinking).map(s => s.nation + ' ' + s.type).join(', '), shells: WW.stats.shellsFired, bad: bad.slice(0, 5), tr };
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
    // the exits: E-1's strongpoints silenced (a squad on WN 64 takes the surrender), engineers and vehicles at the shingle
    const T = WW.normandyTerrain, d = WW.normandyData.DRAWS.find(q => q.id === 'E-1'), fake = (unit, sector) => ({ id: 99000 + out.length, unit, sector, type: 'lcvp', men: 0, heading: Math.PI / 2 });
    WW.emit('craftUnload', { craft: fake('16th RCT', 'easyRed'), men: 12, tanks: 0, x: 1716, z: T.bluffTopZ(1716) + 8, sector: 'easyRed', swim: false });
    const taker = WW.infantry.squads[WW.infantry.squads.length - 1]; taker.state = 'top'; taker.x = 1716; taker.z = WW.coastDefence.wnOf('WN64').z + 3;
    for (let k = 0; k < 2; k++) WW.emit('craftUnload', { craft: fake('37th Engineer Combat Bn', 'easyRed'), men: 12, tanks: 0, x: d.x + 20 + k * 3, z: T.shingleZ(d.x + 20) - 0.5, sector: 'easyRed' });
    for (const q of WW.infantry.squads) if (q.kind === 'eng') { q.state = 'shingle'; q.z = T.shingleZ(q.x) - 0.5; }
    WW.emit('craftUnload', { craft: fake('vehicles', 'easyRed'), men: 0, tanks: 0, vehicles: ['truck', 'jeep', 'halftrack', 'tankdozer'], x: d.x + 30, z: T.shingleZ(d.x + 30) - 3, sector: 'easyRed', dd: true });
    for (const id of ['WN65', 'WN64']) C.wnOf(id).elements.forEach(e => C.knockOut(e));
    let tOpen = null;
    for (let k = 0; k < 60 && G.state === 'battle'; k++) { __sim.fastForward(2); const b = WW.beachEng.blocks.find(q => q.id === 'E-1'); if (b.state === 'open' && tOpen === null) tOpen = G.roundTime; if (tOpen !== null && WW.vehicles.stats.offBeach > 0) break; }
    if (tOpen === null) out.push('E-1 never opened for vehicles (' + JSON.stringify(WW.beachEng.blocks.find(q => q.id === 'E-1'), (k, v) => k === 'draw' || k === 'eng' || k === 'el' ? undefined : v) + ')');
    else if (!(WW.vehicles.stats.offBeach > 0) && !WW.vehicles.all.some(v => v.state === 'exit')) out.push('no vehicle went up E-1');
    if (!(WW.prisoners.stats.men > 0)) out.push('no prisoners from WN 64 / 65');
    return out;
  });
  let silTot = 0, taylor = 0, msMin = 1e9;
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
    if (!(a.lc.launched > 20)) probs.push(`only ${a.lc.launched} craft launched`);
    if (SECS >= 300 && !(a.lc.men > 0)) probs.push('no men ashore');
    if (a.lc.stray) probs.push(`${a.lc.stray} craft beached outside their sector`);
    if (SECS >= 400 && a.lc.foundered < a.lc.dd / 2) probs.push(`only ${a.lc.foundered} of ${a.lc.dd} DD tanks foundered`);
    if (SECS >= 400 && !(a.inf.top > 0)) probs.push('no squad on the bluff top');
    silTot += a.inf.sil || 0;   // a seed with none silenced by ~08:40 is history (the DDs gone); none over all seeds is a bug
    msMin = Math.min(msMin, a.inf.ms);   // the step budget: judged on the fastest seed (a loaded machine slows them all alike)
    if (SECS >= 400 && !(a.air.b24 > 0)) probs.push('no B-24 bomb fell');
    if (a.air.b24Near) probs.push(`${a.air.b24Near} B-24 bombs within 200 u of the bluffs under cloud`);
    if (SECS >= 400 && !(a.air.p47 > 0)) probs.push('no P-47 strike');
    if (a.ddMin < 3) probs.push(`a closing destroyer in ${a.ddMin.toFixed(1)} u of water`);
    const R = a.real;
    if (SECS >= 400) {
      if (!(R.veh > 5)) probs.push(`only ${R.veh} vehicles ashore`);
      if (!(R.dozers > 0)) probs.push('no dozer ashore');
      if (!(R.lanes >= 4 && R.blown >= 1)) probs.push(`gap lanes ${R.blown} blown of ${R.lanes}`);
      if (!(R.dukwF >= 3)) probs.push(`only ${R.dukwF} DUKWs foundered`);
      if (!R.lead.cota) probs.push('Cota got nobody up');
      if (!/w/.test(R.named['LCI(L)-91'] || '')) probs.push('LCI(L)-91 not burnt out: ' + R.named['LCI(L)-91']);
      if (!/a|w/.test(R.named['LCI(L)-85'] || '')) probs.push('LCI(L)-85 not adrift: ' + R.named['LCI(L)-85']);
      if (!(R.grapnels > 0 && R.ropesUp > 0)) probs.push('no grapnels at Pointe du Hoc');
      if (!(R.held > 0)) probs.push('no vehicle wave held off');
      taylor += R.lead.taylor || 0;
    }
    if (layout0 === null) layout0 = a.layout;
    else if (a.layout.some((q, i) => Math.abs(q[0] - layout0[i][0]) > 0.01 || Math.abs(q[1] - layout0[i][1]) > 1.2)) probs.push(`layout ${JSON.stringify(a.layout)} differs from the first seed's`);
    if (ha !== hc) probs.push(`replay differs ${ha} / ${hc}`);
    if (probs.length) fail++;
    console.log(`  realism: lanes ${R.blown}/${R.lanes} blown (${R.cleared} cleared, ${R.marked} marked) vehicles ${R.veh} (lost ${R.vehLost}, jam max ${R.jamMax}, dozers ${R.dozers}) DUKWs ${R.dukwF}/${R.dukw} foundered, held ${R.held} leaders ${JSON.stringify(R.lead)} LCIs ${JSON.stringify(R.named)} hoc ropes ${R.ropesUp}/${R.grapnels} (cut ${R.cut}) prisoners ${R.pris}`);
    console.log(`seed ${seed}: ${ha} ${a.state} t=${a.t} ${a.winner || '-'} (${a.reason || '-'}) ships ${a.ships} [${a.nations}] obstacles ${a.obst} GER shots ${a.shots} hits on defences ${a.dHits} out ${a.out} craft ${a.lc.launched} men ashore ${a.lc.men} lost ${a.lc.lost} DD foundered ${a.lc.foundered}/${a.lc.dd} squads ${a.inf.squads} on top ${a.inf.top} lost ${a.inf.lost} WN silenced ${a.inf.sil} inf ${a.inf.ms.toFixed(3)} ms B-24 bombs ${a.air.b24} P-47 bombs ${a.air.p47} dd depth >= ${a.ddMin.toFixed(1)} sunk: ${a.sunk || 'none'}  ${probs.length ? 'FAIL ' + probs.join('; ') : 'ok'}`);
  }
  if (SECS >= 400 && !silTot) { fail++; console.log('FAIL no strongpoint silenced in any seed'); }
  if (msMin > 1.5) { fail++; console.log(`FAIL infantry step ${msMin.toFixed(2)} ms on the fastest seed`); }
  if (SECS >= 400 && !taylor) { fail++; console.log('FAIL Col. Taylor got nobody up in any seed'); }
  const u = await unit();
  console.log('damage model: ' + (u.length ? 'FAIL ' + u.join('; ') : 'ok'));
  if (u.length) fail++;
  await b.close();
  if (errs.length) { fail++; console.log('page errors:\n' + [...new Set(errs)].slice(0, 10).join('\n')); }
  console.log(fail ? `FAIL: ${fail} problem(s)` : 'PASS');
  process.exit(fail ? 1 : 0);
})();
