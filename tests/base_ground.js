// Island base ground operations check (sim): taxiways only, no overlaps, no takeoff while the runway is closed, no land
// bomber on a carrier deck, repaired runways reopen and launches resume.
// Usage: node tests/base_ground.js [rounds=12] [seed0=1] [group=1] [--workers K] [--browser]
//   group: WW.islandBase.TUNE.group (the base air group in carrier groups; beyond the spots, planes wait in reserve)
//   Each round: random fleets, the base owner alternating USN / IJN, sampled every SAMPLE sim s. At FORCE_T s two
//   bombs crater the main runway (so every round sees a closure and a reopening).
// Checks (FAIL if not met):
//   off_net      ground samples of base planes farther than TOL from the taxi network (runways, taxiways, columns,
//                lanes, spots)                                                   == 0
//   overlap      pairs of planes on the ground (parked ones too) closer than r1 + r2 (r = 0.42 x length) == 0
//   lift_closed  base planes lifting off while the main runway is closed        == 0
//   bomber_deck  land bombers (B-17, B-26, Betty) whose carrier became a ship    == 0
//   reopened     rounds where a closed main runway reopened                       >= 80%
//   resumed      rounds with a launch after a reopening (when one was queued)    >= 50% of the reopened rounds
//   crash_moved  samples of a crash-landed plane (one in the circuit is shot up to 35% hp at CRASH_T) doing anything but
//                skidding to a stop: taxiing, rolling, flying                      == 0
//   crash_wreck  rounds where a forced crash landing happened and left a wreck   == all of them
// Info: launches, landings, tows, roll aborts, ground losses, diverts, ditches, slots, mode switches.
'use strict';
const HL = require('./headless');
const args = HL.argv.filter(a => !a.startsWith('--'));
const ROUNDS = +(args[0] || 12), SEED0 = +(args[1] || 1), GROUP = +(args[2] || 1), SAMPLE = 0.25, TOL = 1.2, FORCE_T = 80, CAP = 360, CRASH_T = 150;

function install(P) {
  window.__bg = function (seed, owner) {
    const G = WW.game, I = WW.islandBase;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    I.TUNE.group = P.GROUP; G.baseChoice = owner; G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    const b = I.base, L = b.layout, LG = WW.landGround, LA = WW.landAir, AL = WW.airfieldLayout, R = { seed, owner,
      offNet: 0, offMax: 0, overlap: 0, liftClosed: 0, bomberDeck: 0, reopenedT: null, closedT: null, launchAfter: 0, queuedAtReopen: 0, samples: 0, maxQ: 0, maxTaxi: 0,
      crashForced: 0, crashed: 0, crashWreck: 0, crashMoved: 0, slots: b.slots.length, spots: L.spots.length, cls: L.spots.reduce((o, s) => (o[s.cls] = (o[s.cls] || 0) + 1, o), {}) };
    const ph = new Map(), BIG = { b17: 1, b26: 1, g4m: 1, g4mL: 1 };
    let forced = false, lastLaunches = 0, openPrev = true;
    WW.on('baseEvent', e => {
      if (e.base !== I.base) return;
      if (e.kind === 'runwayClosed' && R.closedT === null) R.closedT = G.roundTime;
      if (e.kind === 'crashLanding') R.crashed++;
      if (e.kind === 'crashWreck') R.crashWreck++;
      if (e.kind === 'runwayOpen' && R.closedT !== null && R.reopenedT === null) { R.reopenedT = G.roundTime; R.queuedAtReopen = b.ai ? b.ai.queue.length : 0; lastLaunches = LA.stats.launches; }
    });
    const r = p => LG.rad(p.variant);
    while (G.state === 'battle' && G.roundTime < P.CAP) {
      __sim.fastForward(P.SAMPLE);
      const open0 = LG.opsOpen(b);   // before this sample's forced bombs (a lift-off earlier in the step is legal)
      if (!forced && G.roundTime >= P.FORCE_T) { // two bombs on the main runway: a closure every round
        forced = true; const rw = b.runways[0], en = WW.enemyOf(b.nation);
        I.impact(en, rw.x + rw.c * 10, rw.z + rw.s * 10, 180, 'bomb'); I.impact(en, rw.x - rw.c * 12, rw.z - rw.s * 12, 180, 'bomb');
      }
      if (G.roundTime >= P.CRASH_T && !R.crashForced) { // shoot up a plane in the circuit: it must crash-land, not taxi in
        const q = WW.world.planes.find(q => q.carrier === b && q.alive && q.state === 'landing' && q.rwPh === 'circuit' && q.hp > q.maxHp * 0.4);
        if (q) { q.hp = q.maxHp * 0.35; R.crashForced = 1; }
      }
      R.samples++;
      const open = LG.opsOpen(b), wasOpen = openPrev || open0, bodies = []; openPrev = open;
      for (const s of b.slots) if (s.state === 'parked' || s.state === 'rearm' || s.state === 'wreck') bodies.push({ x: s.x, z: s.z, r: s.r, k: 's' + s.i });
      for (const w of b.wrecks || []) bodies.push({ x: w.x, z: w.z, r: w.r, k: 'wreck' });
      for (const p of WW.world.planes) {
        if (p.variant && BIG[p.variant] && p.carrier && !p.carrier.isBase) R.bomberDeck++;
        if (p.carrier !== b) continue;
        const prev = ph.get(p), now = p.alive ? p.rwPh : null; ph.set(p, now);
        if (p.crashed && p.alive && !(p.state === 'rollout' && p.rwPh === 'crash')) R.crashMoved++;
        if (now === 'climb' && prev !== 'climb' && !open && !wasOpen) R.liftClosed++;   // closed all through the step
        if (!LG.onGround(p)) continue;
        bodies.push({ x: p.x, z: p.z, r: r(p), k: p.state + '/' + p.rwPh + ' pi' + p.pi + ' gid' + p.gid });
        if (p.rwPh === 'roll' || p.rwPh === 'stopped' || p.rwPh === 'land' || p.rwPh === 'towed' || p.rwPh === 'crash') continue; // on a runway (a crash skids where it will)
        const d = AL.netDist(L, p.x, p.z);
        if (d > P.TOL) { R.offNet++; R.offMax = Math.max(R.offMax, d); if ((R.offEx = R.offEx || []).length < 6) { const q = L.toL(p.x, p.z); R.offEx.push(p.state + '/' + p.rwPh + ' pi' + p.pi + ' u' + q.u.toFixed(1) + ' v' + q.v.toFixed(1) + ' d' + d.toFixed(1) + (p.slot && p.slot.spot ? ' sp' + p.slot.spot.u.toFixed(0) + ',' + p.slot.spot.v.toFixed(0) + ' col' + p.slot.spot.col : '')); } }
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j];
        if (Math.hypot(a.x - c.x, a.z - c.z) < a.r + c.r - 0.05) { R.overlap++; if ((R.ovEx = R.ovEx || []).length < 4) { const qa = L.toL(a.x, a.z), qc = L.toL(c.x, c.z); R.ovEx.push(a.k + ' @' + qa.u.toFixed(1) + ',' + qa.v.toFixed(1) + ' ~ ' + c.k + ' @' + qc.u.toFixed(1) + ',' + qc.v.toFixed(1) + ' t' + G.roundTime.toFixed(0)); } }
      }
      if (R.reopenedT !== null && LA.stats.launches > lastLaunches) R.launchAfter = 1;
      let q = 0, tx = 0; for (const p of WW.world.planes) if (p.carrier === b && p.alive) { if (p.rwPh === 'hold' || p.rwPh === 'lineup') q++; else if (p.rwPh === 'taxi' || p.rwPh === 'warm') tx++; }
      R.maxQ = Math.max(R.maxQ, q); R.maxTaxi = Math.max(R.maxTaxi, tx + q);
    }
    R.towLog = LG.towLog.splice(0);
    const nSpot = b.slots.filter(s => s.spot).length;
    Object.assign(R, JSON.parse(JSON.stringify(LG.stats)), { launches: LA.stats.launches, landings: LA.stats.landings, diverted: LA.stats.diverted, ditched: LA.stats.ditched,
      emergency: LA.stats.emergency, closedLaunches: LA.stats.closedLaunches, scrambles: LA.stats.scrambles }, { slots: nSpot, group: b.slots.length });
    return R;
  };
}

(async () => {
  const b = await HL.launch();
  const pages = [];
  for (let k = 0; k < Math.min(HL.WORKERS, ROUNDS); k++) {
    const p = await b.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(HL.url()); await p.waitForFunction(() => window.__sim && window.WW && WW.game); await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(install, { SAMPLE, TOL, FORCE_T, CAP, GROUP, CRASH_T });
    p.errs = errs; pages.push(p);
  }
  const specs = []; for (let i = 0; i < ROUNDS; i++) specs.push({ seed: SEED0 + i, owner: (SEED0 + i) % 2 ? 'USN' : 'IJN' });
  const out = new Array(specs.length); let next = 0;
  await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; out[i] = await pg.evaluate(s => window.__bg(s.seed, s.owner), specs[i]); } }));
  const sum = k => out.reduce((s, r) => s + (r[k] || 0), 0);
  for (const r of out) { console.log(`seed ${r.seed} ${r.owner}: slots ${r.slots}/${r.spots} of ${r.group} ${JSON.stringify(r.cls)}  launches ${r.launches} landings ${r.landings}  offNet ${r.offNet} (max ${r.offMax.toFixed(2)})  overlap ${r.overlap}  liftClosed ${r.liftClosed}  closed ${r.closedT === null ? '-' : r.closedT.toFixed(0)} reopened ${r.reopenedT === null ? '-' : r.reopenedT.toFixed(0)} resumed ${r.launchAfter}  tows ${r.tows} aborts ${r.aborts} groundLost ${r.groundLost} diverted ${r.diverted} ditched ${r.ditched} emergency ${r.emergency}  crash ${r.crashForced}/${r.crashed}/${r.crashWreck}  queue ${r.maxQ}/${r.maxTaxi}`); if (r.offEx) console.log('   off: ' + r.offEx.join(' | ')); if (r.ovEx) console.log('   ov: ' + r.ovEx.join(' | ')); if (r.towLog.length) console.log('   tow: ' + r.towLog.join(' | ')); }
  const reopened = out.filter(r => r.reopenedT !== null), resumed = reopened.filter(r => r.launchAfter);
  const checks = [
    ['off_net', sum('offNet'), v => v === 0], ['overlap', sum('overlap'), v => v === 0], ['lift_closed', sum('liftClosed'), v => v === 0],
    ['bomber_deck', sum('bomberDeck'), v => v === 0], ['reopened', reopened.length / out.length, v => v >= 0.8],
    ['resumed', reopened.length ? resumed.length / reopened.length : 0, v => v >= 0.5],
    ['crash_moved', sum('crashMoved'), v => v === 0], ['crash_wreck', sum('crashWreck') + '/' + sum('crashed'), v => +v.split('/')[0] === +v.split('/')[1]]];
  let fails = 0;
  console.log('\n=== base ground ops (' + HL.label() + ') ===');
  for (const [k, v, ok] of checks) { const pass = ok(v); if (!pass) fails++; console.log(`  ${k.padEnd(12)} ${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v}  ${pass ? 'PASS' : 'FAIL'}`); }
  console.log(`  info: launches ${sum('launches')} landings ${sum('landings')} tows ${sum('tows')} aborts ${sum('aborts')} groundLost ${sum('groundLost')} diverted ${sum('diverted')} ditched ${sum('ditched')} emergency ${sum('emergency')} scrambles ${sum('scrambles')} modeSwitches ${sum('modeSwitches')} capped ${sum('capped')} towOut ${sum('towOut')} (group ${GROUP})`);
  const errs = pages.flatMap(p => p.errs);
  if (errs.length) { console.log('page errors:', errs.slice(0, 5)); fails++; }
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
