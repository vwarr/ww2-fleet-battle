// Ship heel jitter: sample every live ship's turn heel (roll minus wave rock and damage list) every sim step
// for 60 sim s of a few seeded rounds, and report per type: heel sign flips per minute (counted only when the
// heel swings past ±0.5°), max |heel| and mean |roll rate|.
// Usage: node tests/ship_heel.js [rounds=3] [firstSeed=1] [--browser | --render]   (Chrome modes: BASE_URL=http://localhost:PORT/)
// Sim-only mode in the node runner unless --browser / --render: the heel is sim state (Ship.syncGroup), identical in all.
const HL = require('./headless');
const N = +(HL.argv[0] || 3), SEED0 = +(HL.argv[1] || 1);
(async () => {
  const b = await HL.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(HL.url('auto'));
  await p.waitForTimeout(HL.settle());
  // a seeded replay (docs/ARCHITECTURE.md): no render loop, time from 0, so --render and sim-only print the same numbers
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  const per = {};
  for (let i = 0; i < N; i++) {
    const r = await p.evaluate(seed => {
      const G = WW.game; if (WW.aces) WW.aces.reset();
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = null; G.mode = 'auto'; // the page boots into setup with its own random fleets: start from this seed's fleets
      G.startRound({ keepMap: true });
      __sim.fastForward(20); // past the opening turns
      const S = {}, D = 0.5 * Math.PI / 180;
      const heel = s => { const amp = 0.35 / Math.sqrt(s.stats.length);
        return s.group.rotation.x - s.listRoll - Math.sin(WW.time.now * 0.8 + s.bob * 1.3) * amp * 0.25; };
      __sim.fastForward(60, dt => {
        for (const s of WW.world.ships) {
          if (!s.alive || s.sinking) continue;
          const h = heel(s), o = S[s.id] || (S[s.id] = { type: s.type, n: 0, t: 0, flips: 0, side: 0, max: 0, rate: 0, last: h });
          if (Math.abs(h) > D) { const sd = Math.sign(h); if (o.side && sd !== o.side) o.flips++; o.side = sd; }
          o.max = Math.max(o.max, Math.abs(h)); o.rate += Math.abs(h - o.last); o.last = h; o.t += dt; o.n++;
        }
      });
      return Object.values(S);
    }, SEED0 + i);
    for (const o of r) {
      const q = per[o.type] || (per[o.type] = { t: 0, flips: 0, max: 0, rate: 0 });
      q.t += o.t; q.flips += o.flips; q.max = Math.max(q.max, o.max); q.rate += o.rate;
    }
  }
  const deg = 180 / Math.PI;
  console.log('type        flips/min  max|heel|deg  mean|roll rate| deg/s');
  for (const [k, q] of Object.entries(per))
    console.log(`${k.padEnd(11)} ${(q.flips / q.t * 60).toFixed(2).padStart(9)}  ${(q.max * deg).toFixed(2).padStart(12)}  ${(q.rate / q.t * deg).toFixed(2).padStart(10)}`);
  if (errs.length) console.log(errs.slice(0, 10).join('\n'));
  await b.close();
})();
