// Render-mode screenshots of the plotting room (BASE_URL, CHROMIUM as for the other tests):
//   node tests/plot_shots.js [seed] [seconds] [outdir]
// Plays seed `seed` to `seconds` of sim time, then shoots the same moment as the omniscient plot, the USN plot
// and the IJN plot (map view, war diary card on the side), the war diary card over the director view, and,
// after playing the round out, the after-action report card. Also prints the diary and any misidentified contacts.
const { chromium } = require('playwright');
const seed = +(process.argv[2] || 3), secs = +(process.argv[3] || 170), out = process.argv[4] || require('path').join(__dirname, 'shots', 'plot');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.plot);
  await p.waitForTimeout(1500);
  const info = await p.evaluate(({ seed, secs, misid }) => {
    const G = WW.game;
    __sim.setScale(0.05);
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    // MISID=1: stop at the first moment after secs / 2 that a side holds a misidentified contact (flying-boat reports)
    const mis0 = () => ['USN', 'IJN'].some(n => WW.intel.contacts(n).some(c => c.misid && c.unit.alive));
    while (G.state === 'battle' && G.roundTime < secs) { __sim.fastForward(1); if (misid && G.roundTime > secs / 2 && mis0()) break; }
    WW.cam.mode = 'map';
    const mis = [];
    for (const n of ['USN', 'IJN']) for (const c of WW.intel.contacts(n)) if (c.misid) mis.push(n + ' sees ' + c.unit.type + ' as ' + c.reportedType);
    return { t: G.roundTime, state: G.state, mis };
  }, { seed, secs, misid: !!process.env.MISID });
  console.log('at', JSON.stringify(info));
  const shot = async (name, fn, wait) => { if (fn) await p.evaluate(fn); await p.waitForTimeout(wait || 1600); await p.screenshot({ path: `${out}/${name}.png` }); };
  await shot('plot_omniscient', () => WW.plot.set(null), 2500);
  await shot('plot_usn', () => WW.plot.set('USN'));
  await shot('plot_ijn', () => WW.plot.set('IJN'));
  await shot('plot_usn_danger', () => { WW.plot.set('USN'); WW.plot.toggleDanger(); });
  await p.evaluate(() => WW.plot.toggleDanger());
  await shot('diary_film', () => { WW.cam.mode = 'director'; WW.diary.show(true); __sim.snapCamera(); }, 3500);
  const diary = await p.evaluate(() => WW.diary.entries().map(e => e.clock + ' ' + (e.nation || '   ') + ' [' + e.pri + '] ' + e.text));
  console.log(diary.join('\n'));
  await p.evaluate(() => { WW.diary.show(false); while (WW.game.state === 'battle') __sim.fastForward(1); });
  await shot('aar', () => WW.aar.show(), 2500);
  const r = await p.evaluate(() => document.getElementById('aar').innerText);
  console.log('AAR', r);
  await b.close();
})();
