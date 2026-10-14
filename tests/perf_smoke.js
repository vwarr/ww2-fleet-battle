// Render smoke shot for perf work: a seeded round fast-forwarded, the sim frozen, one screenshot (real GPU, headless
// shell with ANGLE Metal). Compare a before / after pair by eye. Usage:
//   BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/perf_smoke.js <out.png> [scn=pacific|normandy] [seed=1] [ff=200]
const { chromium } = require('playwright');
const OUT = process.argv[2], SCN = process.argv[3] || 'pacific', SEED = +(process.argv[4] || 1), FF = +(process.argv[5] || 200);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?' + (SCN === 'normandy' ? 'scn=normandy' : 'auto') + '&v=' + Date.now(), { timeout: 240000 });
  await p.waitForTimeout(4000);
  await p.evaluate(([seed, ff]) => {
    const G = WW.game; WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0; G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    __sim.fastForward(ff); WW.time.scale = 1e-6;
    // the camera stays the director's: usually the same shot in both trees (seeded, frozen), not always
  }, [SEED, FF]);
  await p.waitForTimeout(3000);
  await p.screenshot({ path: OUT });
  console.log('shot', OUT, 'errors', errs.slice(0, 5));
  await b.close();
})();
