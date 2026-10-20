// Setup screen weather and wind (weather.js preview, ui.js pickers): the weather and wind the panel shows are the
// round's when Start is pressed (random rolls, a picked kind, a picked force), the picks are remembered across a reload,
// and Random goes back to rolling. Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/wx_preview_test.js
const { chromium } = require('playwright');
process.on('unhandledRejection', e => { console.log('FAIL', e.message); process.exit(1); });
const BASE = process.env.BASE_URL || 'http://localhost:8000/';
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fail = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  p.setDefaultTimeout(240000);
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const boot = async () => { await p.goto(BASE + 'index.html', { timeout: 240000 }); await p.waitForFunction(() => window.WW && WW.game && WW.game.state === 'setup' && WW.weather.preview, null, { timeout: 240000 }); await p.waitForTimeout(800); };
  await boot();
  const toSetup = () => p.evaluate(() => WW.game.enterSetup(true, true));
  const prev = async () => { const d0 = await p.evaluate(() => WW.frames.drawn); await p.waitForFunction(d => WW.frames.drawn >= d, d0 + 2); return p.evaluate(() => { const o = WW.weather.preview(); return o && { kind: o.kind, bf: o.bf, wk: WW.weather.kind, label: document.querySelector('#hud .wx .todlbl').textContent + ' / ' + document.querySelector('#hud .wind .todlbl').textContent }; }); };
  const start = () => p.evaluate(() => { document.querySelector('#hud .setup button.go').click(); return { state: WW.game.state, kind: WW.weather.kind, bf: WW.weather.beaufort, sea: WW.seaState.douglas }; });
  const pick = (k, bf) => p.evaluate(a => {
    if (a.k !== undefined) { const s = document.querySelector('#hud select.wxsel'); s.value = a.k; s.dispatchEvent(new Event('change')); }
    if (a.bf !== undefined) { const i = document.querySelector('#hud .wind input'); i.value = a.bf; i.dispatchEvent(new Event('input')); }
  }, { k, bf });
  for (let i = 0; i < 3; i++) {
    await toSetup(); const o = await prev(); const r = await start();
    ok(o && r.state === 'battle' && r.kind === o.kind && r.bf === o.bf && o.wk === o.kind, `random ${i}: preview ${o && o.label} -> round ${r.kind} F${r.bf}`);
  }
  await toSetup(); await pick('thunder'); let o = await prev(); let r = await start();
  ok(o.kind === 'thunder' && r.kind === 'thunder' && r.bf === o.bf && o.bf >= 5 && o.bf <= 8, `picked thunderstorm: ${o.label} -> ${r.kind} F${r.bf}`);
  await toSetup(); await pick('typhoon', 3); o = await prev(); r = await start();
  ok(r.kind === 'typhoon' && r.bf === 10 && o.bf === 10, `typhoon with F3 asked: clamped to F${r.bf}, sea ${r.sea.toFixed(1)}`);
  await toSetup(); await pick('clear', 0); o = await prev(); r = await start();
  ok(r.kind === 'clear' && r.bf === 0 && r.sea < 0.5, `clear, F0: a calm (sea ${r.sea.toFixed(2)})`);
  await boot();
  o = await prev();
  ok(o.kind === 'clear' && o.bf === 0, 'reload keeps the picks: ' + o.label);
  await pick(''); await p.evaluate(() => document.querySelector('#hud .wind .btn').click());
  const st = await p.evaluate(() => ({ uk: WW.weather.userKind, ub: WW.weather.userBf, k: localStorage.getItem('ww.wxKind'), w: localStorage.getItem('ww.wxWind') }));
  ok(st.uk === null && st.ub === null && st.k === null && st.w === null, 'Random: back to rolling, storage cleared');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'PASS');
  process.exit(fail ? 1 : 0);
})();
