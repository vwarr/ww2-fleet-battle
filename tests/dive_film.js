// Dive coverage of the story camera (camera_story.js): auto rounds in render mode on a fake frame clock (no
// pixels drawn, the director and the story camera run every frame), counting the strike stories whose wave
// dived while the story ran and how many had a diving dive bomber of that wave on screen for >= 1 s
// (WW.camStory.stats diveStories / diveFilmed). Gate: diveFilmed / diveStories >= 0.8 (PLANE_REVIEW §5).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/dive_film.js [seeds=1,2,3,4] [simSeconds=480] [speed=1]
const { chromium } = require('playwright');
const SEEDS = (process.argv[2] || '1,2,3,4').split(',').map(Number), SIM = +(process.argv[3] || 480), SPEED = +(process.argv[4] || 1);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const tot = { strikeStories: 0, diveStories: 0, diveFilmed: 0, stories: 0 };
  for (const seed of SEEDS) {
    const p = await b.newPage({ viewport: { width: 960, height: 540 } });
    const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.addInitScript(() => {
      window.__raf = []; window.__fakeT = 0;
      window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
      window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
    });
    await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto');
    await p.waitForTimeout(1500);
    await p.evaluate(([seed, speed]) => {
      WW.post.render = () => {};                    // no pixels: the camera logic still runs every frame
      const t0 = performance.now(); performance.now = () => t0 + __fakeT;
      __step(5);
      WW.seedRandom(seed); WW.time.now = 0; WW.game.mode = 'auto'; WW.game.composition = null; WW.game.startRound(); // a seeded random round
      if (__sim.setScale) __sim.setScale(speed);
      for (const k in WW.camStory.stats) WW.camStory.stats[k] = 0;
    }, [seed, SPEED]);
    let t = 0;
    while (true) {
      t = await p.evaluate(() => { __step(300); return WW.game.state === 'battle' ? WW.game.roundTime : -1; });
      if (t < 0 || t > SIM) break;
    }
    await p.evaluate(() => WW.camStory.stop());
    const st = await p.evaluate(() => Object.assign({}, WW.camStory.stats));
    if (process.env.LOG) console.log((await p.evaluate(() => WW.camStory.log.filter(e => e.start || e.end || e.sk === 'dive' || e.miss).map(e => (e.at / 1).toFixed(0) + ' ' + (e.start ? 'START ' + e.lead + ' ' + e.mission : e.end ? 'END' : e.miss ? 'MISS ' + e.miss : 'DIVE ' + e.lead)))).join('\n'));
    console.log(`seed ${seed}: sim ${t < 0 ? 'round over' : t.toFixed(0) + ' s'}  stories ${st.stories}, strike ${st.strikeStories}, wave dived ${st.diveStories}, dive on screen ${st.diveFilmed}` + (errs.length ? '  ERRORS ' + errs.slice(0, 3).join(' | ') : ''));
    for (const k in tot) tot[k] += st[k] || 0;
    await p.close();
  }
  const r = tot.diveStories ? tot.diveFilmed / tot.diveStories : null;
  console.log(`TOTAL stories ${tot.stories}, strike ${tot.strikeStories}, wave dived ${tot.diveStories}, dive on screen ${tot.diveFilmed} = ${r === null ? '-' : (100 * r).toFixed(0) + '%'} (gate >= 80%) ${r !== null && r >= 0.8 ? 'PASS' : 'FAIL'}`);
  await b.close();
})();
