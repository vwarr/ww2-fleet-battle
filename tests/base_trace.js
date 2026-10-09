// Island base ground-ops trace (sim, a debugging aid): every STEP sim s, the field's mode, the runway occupant, the
// hold-short queue, the launch queue, the base planes by state / phase and the slot states (p parked, o out, r rearm,
// w wreck, e empty, a away, R reserve, g gone).
// Usage: node tests/base_trace.js [seed=1] [owner=USN] [seconds=300] [step=10] [--browser]
'use strict';
const HL = require('./headless');
const a = HL.argv.filter(x => !x.startsWith('--'));
const SEED = +(a[0] || 1), OWNER = a[1] || 'USN', SECS = +(a[2] || 300), STEP = +(a[3] || 10);
(async () => {
  const b = await HL.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(HL.url()); await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  const r = await p.evaluate(([seed, owner, secs, step]) => {
    const G = WW.game;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition(); if (WW.aces) WW.aces.reset(); WW.seedRandom(seed * 7919 + 1); WW.time.now = 0;
    G.baseChoice = owner; G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    const B = WW.islandBase.base, out = [], code = { parked: 'p', out: 'o', rearm: 'r', wreck: 'w', empty: 'e', away: 'a', reserve: 'R', gone: 'g' };
    const ev = []; WW.on('baseEvent', e => { if (e.base === B) ev.push(Math.round(G.roundTime) + ':' + e.kind); });
    for (let t = 0; t < secs && G.state === 'battle'; t += step) {
      __sim.fastForward(step);
      const c = {};
      for (const q of WW.world.planes) if (q.carrier === B && q.alive) { const k = q.state + '/' + (q.rwPh || ''); c[k] = (c[k] || 0) + 1; }
      out.push(Math.round(G.roundTime) + ' ' + B.ops.mode + ' occ ' + (B.ops.occ ? B.ops.occ.state + '/' + B.ops.occ.rwPh + (B.ops.occ.togo !== undefined ? '[' + B.ops.occ.togo.toFixed(0) + ',' + (B.ops.occ.rwT || 0).toFixed(0) + ',' + B.ops.occ.y.toFixed(0) + ',' + B.ops.occ.speed.toFixed(0) + ',' + (B.ops.occ.hd || 0).toFixed(2) + ']' : '') : '-') + ' hq ' + B.ops.holdQ.length +
        ' q ' + B.ai.queue.length + ' ' + JSON.stringify(c) + ' ' + B.slots.map(s => code[s.state] || '?').join(''));
    }
    out.push('events: ' + ev.join(' '));
    return out;
  }, [SEED, OWNER, SECS, STEP]);
  console.log(r.join('\n')); if (errs.length) console.log('errors', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
