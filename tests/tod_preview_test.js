// Setup screen time of day (daylight.js preview, ui.js start-time slider): the hour the ready screen shows is the hour
// the battle starts at when Start is pressed. Checks, in the full game (setup mode):
//  - Random: a few preview rolls; Start (the panel's button) starts the round at exactly the shown hour and kind
//  - a carriers-only night roll previews as a pre-dawn round; a battleship placed flips nightAction(): the preview
//    becomes a night action, and Start gives that night
//  - the slider: a manual hour previews live, is remembered (localStorage), starts the round at that hour, the clock
//    runs on; Random (the button) goes back to rolling
//  - the setup sky blends to the preview (no snap) and the first frame after Start shows the same hour
// --shots DIR: headless screenshots of the setup screen (two random rolls, slider dawn / noon / dusk / night) and the
// first frame after Start.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/tod_preview_test.js [--shots DIR]
const { chromium } = require('playwright');
process.on('unhandledRejection', e => { console.log('FAIL', e.message); process.exit(1); });
const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const si = process.argv.indexOf('--shots'), SHOTS = si >= 0 ? process.argv[si + 1] : null;

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fail = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  try {
    const p = await b.newPage({ viewport: { width: 800, height: 450 } });
    p.setDefaultTimeout(240000);
    const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE + 'index.html', { timeout: 240000 });
    await p.waitForFunction(() => window.WW && WW.game && WW.game.state === 'setup' && WW.dayNight.preview, null, { timeout: 120000 });
    await p.waitForTimeout(1500);
    const shot = async name => { if (SHOTS) await p.screenshot({ path: require('path').join(SHOTS, name + '.png'), timeout: 240000 }); };
    const toSetup = () => p.evaluate(() => { WW.dayNight.setUserHour(null); WW.game.enterSetup(true, true); });
    const frames = async n => { const d0 = await p.evaluate(() => WW.frames.drawn); await p.waitForFunction(d => WW.frames.drawn >= d, d0 + n, { timeout: 240000 }); };
    const prev = async () => { await frames(1); return p.evaluate(() => { const o = WW.dayNight.preview(); return o && { h: o.startHour, kind: o.kind, pre: o.predawn, random: o.random, label: document.querySelector('#hud .todlbl').textContent }; }); };
    const start = () => p.evaluate(() => {   // the panel's Start (ui.js startBattle), read in the same task (no frame between)
      document.querySelector('#hud .setup button.go').click();
      return { state: WW.game.state, h: WW.dayNight.startHour, hour: WW.dayNight.hour, kind: WW.dayNight.kind, pre: WW.dayNight.predawn };
    });
    const settle = async () => {
      const t0 = Date.now();
      await p.waitForFunction(() => Math.abs(WW.dayNight.hour - WW.dayNight.previewHour()) < 1e-9, null, { timeout: 240000 });
      if (process.env.DBG) console.log('  settled in ' + (Date.now() - t0) + ' ms');
    };

    // Random rolls
    for (const [k, rj] of [[0, [0.05, 0.3]], [1, [0.3, 0.8]], [2, [0.7, 0.5]], [3, null]].entries()) {
      await toSetup();
      if (rj[1]) await p.evaluate(rj => WW.dayNight.rerollPreview(rj[0], rj[1]), rj[1]);
      const o = await prev();
      await settle();
      if (k < 2) await shot('setup_random_' + (k + 1));
      const r = await start();
      await p.waitForTimeout(80);
      if (k === 0) await shot('after_start');
      ok(o && r.state === 'battle' && r.h === o.h && r.hour === o.h && r.kind === o.kind, `random ${k}: preview ${o && o.label} (${o && o.h.toFixed(4)}) -> round ${r.kind} ${r.h.toFixed(4)}`);
    }

    // nightAction flip: carriers with their destroyers only, a night roll; then a battleship placed
    await toSetup();
    const flip = await p.evaluate(() => {
      const G = WW.game, D = WW.dayNight;
      // a random composition: the carriers and their destroyers stay, a battleship's slot is kept for later
      let rc = null, bb = null;
      for (let i = 0; i < 30 && !bb; i++) { rc = G.randomComposition(); bb = rc.find(c => c.nation === 'USN' && c.type === 'battleship'); }
      G.composition = rc.filter(c => c.type === 'carrier' || c.type === 'destroyer'); G.custom = true; G.enterSetup(false);
      D.rerollPreview(0.97, 0.5);
      const a = D.preview(), na0 = D.nightAction();
      // place the battleship (as ui.js does)
      if (bb) { G.composition.push(bb); G.spawnComposition([bb]); }
      const b = D.preview();
      return { a: { h: a.startHour, kind: a.kind, pre: a.predawn }, na0, na1: D.nightAction(), b: { h: b.startHour, kind: b.kind, pre: b.predawn }, n: G.composition.length, bb: !!bb };
    });
    ok(!flip.na0 && flip.a.pre && flip.a.kind === 'dawn', `carriers only: no night action, preview a pre-dawn round at ${flip.a.h.toFixed(2)}`);
    ok(flip.na1 && flip.b.kind === 'night' && !flip.b.pre, `battleship placed: night action, preview night at ${flip.b.h.toFixed(2)}`);
    await settle();
    let r = await start();
    ok(r.kind === flip.b.kind && r.h === flip.b.h && r.hour === flip.b.h, `flip: round ${r.kind} at ${r.h.toFixed(4)}`);

    // the slider: a manual hour
    await toSetup();
    const slide = async h => {
      await p.evaluate(v => { const i = document.querySelector('#hud input.tod'); i.value = v; i.dispatchEvent(new Event('input')); }, Math.round(h * 4));
      await p.waitForTimeout(50);
      return prev();
    };
    for (const [h, name] of [[5.5, 'dawn'], [12, 'noon'], [16.75, 'dusk'], [21.25, 'night']]) {
      const o = await slide(h);
      await settle();
      await shot('setup_slider_' + name);
      ok(o.h === h && !o.random, `slider ${h}: ${o.label}`);
    }
    const o = await slide(5.75);
    const stored = await p.evaluate(() => localStorage.getItem('ww.todHour'));
    ok(stored === '5.75', 'slider choice stored: ' + stored);
    await settle();
    r = await start();
    ok(r.h === 5.75 && r.hour === 5.75 && r.kind === 'dawn', `manual start: ${r.kind} at ${r.h} (preview ${o.label})`);
    const ran = await p.evaluate(() => { __sim.fastForward(60); return WW.dayNight.hour; });
    ok(ran > 5.75 + 0.05, 'the clock runs from the manual hour: ' + ran.toFixed(3));
    // a reload keeps it; Random clears it
    await p.reload({ timeout: 240000 });
    await p.waitForFunction(() => window.WW && WW.game && WW.game.state === 'setup' && WW.dayNight.preview, null, { timeout: 120000 });
    await p.waitForTimeout(500);
    const kept = await prev();
    ok(kept.h === 5.75 && !kept.random, 'reload keeps the start time: ' + kept.label);
    await p.$eval('#hud .tod button', b => b.click());
    const rnd = await prev(), cleared = await p.evaluate(() => localStorage.getItem('ww.todHour'));
    ok(rnd.random && cleared === null, 'Random: back to the roll (' + rnd.label + ', ' + rnd.h.toFixed(4) + ', r/j ' + JSON.stringify(await p.evaluate(() => WW.roundRec.capture(true, 0).parts.daylight)) + '), storage cleared');

    // blend: a new roll eases in (not a snap)
    await p.evaluate(() => WW.dayNight.rerollPreview(0.3, 0.0));   // day 07:30
    await settle();
    const h0 = await p.evaluate(() => WW.dayNight.hour);
    await p.evaluate(() => WW.dayNight.rerollPreview(0.3, 1.0));   // day 12:00
    await frames(2);
    const h1 = await p.evaluate(() => WW.dayNight.hour);
    await settle();
    ok(h1 > h0 + 0.01 && h1 < 12 - 0.01, `the sky blends: ${h0.toFixed(2)} -> ${h1.toFixed(2)} -> 12`);

    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'PASS');
  process.exit(fail ? 1 : 0);
})();
