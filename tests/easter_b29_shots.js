// The B-29 easter egg (easter_b29.js), render mode: N alone still starts a new battle; the Konami code typed with the
// keyboard triggers the egg; shots of the approach, the release, the fall, the flash, the shock ring, the mushroom,
// the cloud standing and the end card; the next round must start cleanly. Then "enola" typed in the next round triggers it
// again (and its N must not start a new battle). Page errors are reported.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/easter_b29_shots.js [--seed N=2] [--warm secs=150]
// Shots in tests/shots/easter_b29/*.png (not committed).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEED = +arg('--seed', 2), WARM = +arg('--warm', 150);
const DIR = path.join(__dirname, 'shots', 'easter_b29'); fs.mkdirSync(DIR, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.setDefaultTimeout(600000);
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8134/') + 'index.html?auto&v=' + Date.now(), { timeout: 120000 });
  await p.waitForTimeout(4000);
  const st = () => p.evaluate(() => ({ round: WW.stats.round, state: WW.game.state, egg: WW.easterB29._dbg(), ships: WW.world.ships.filter(s => s.alive).length, planes: WW.world.planes.filter(q => q.alive).length, base: WW.islandBase.base ? !!WW.islandBase.base.neutralized : null }));
  // N alone: a new battle (the capture listener must not eat it)
  const r0 = (await st()).round; await p.keyboard.press('n'); await p.waitForTimeout(500);
  console.log('N alone: round', r0, '->', (await st()).round);
  await p.evaluate(([seed, warm]) => {
    const G = WW.game; if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    if (WW.dayNight) WW.dayNight.force = 'day';
    G.composition = null; G.mode = 'auto'; G.baseChoice = 'USN'; G.startRound({ keepMap: true }); G.baseChoice = null;
    G.noRetire = true; __sim.fastForward(warm); G.noRetire = false;
  }, [SEED, WARM]);
  console.log('before:', JSON.stringify(await st()));
  const shot = async name => { const f = path.join(DIR, name + '.png'); await p.screenshot({ path: f, timeout: 300000 }); console.log('shot', f, JSON.stringify(await st())); };
  const at = async (t, name) => { await p.waitForFunction(t => { const d = WW.easterB29._dbg(); return !d || d.t >= t; }, t, { polling: 100, timeout: 900000 }); await shot(name); };
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) { await p.keyboard.press(k); await p.waitForTimeout(80); }
  console.log('konami: active', await p.evaluate(() => WW.easterB29.active()));
  await at(2.5, '1_approach'); await at(6.0, '2_approach_close'); await at(8.2, '3_release'); await at(11.0, '4_fall');
  await at(12.62, '5_flash'); await at(13.6, '6_fireball'); await at(16.0, '7_shock_ring'); await at(19.5, '8_ring_wipe');
  await at(23.5, '9_mushroom'); await at(27, '10_cloud_stands'); await at(31.55, '11_end_card');
  await p.waitForTimeout(3000); await shot('12_aftermath_victory');
  const r1 = (await st()).round;
  await p.waitForFunction(r => WW.stats.round > r && WW.game.state === 'battle', r1, { polling: 250, timeout: 900000 });
  await p.waitForTimeout(3000); await shot('13_next_round');
  // "enola" in the next round: the N in it must not start a new battle
  const r2 = (await st()).round;
  for (const k of 'enola') { await p.keyboard.press(k); await p.waitForTimeout(120); }
  console.log('enola: active', await p.evaluate(() => WW.easterB29.active()), 'round', r2, '->', (await st()).round);
  await at(3, '14_enola_approach');
  console.log(errs.length ? 'page errors so far:\n' + errs.slice(0, 20).join('\n') : 'no page errors so far');
  await p.keyboard.press('n'); await p.waitForTimeout(1500);   // abort mid-sequence: a new battle, everything restored
  console.log('abort by N:', JSON.stringify(await st()), 'cam restored', await p.evaluate(() => !WW.easterB29.active() && WW.time.warp === 1));
  await p.waitForTimeout(2000); await shot('15_after_abort');
  console.log(errs.length ? 'page errors:\n' + errs.slice(0, 20).join('\n') : 'no page errors');
  await b.close();
})();
