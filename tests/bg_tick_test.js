// Background battle (main.js bgBeat): with the tab hidden the sim keeps running on the Blob worker's heartbeat, and the
// page draws again when it comes back. The test fakes a hidden tab: document.hidden / visibilityState read a flag and a
// visibilitychange is dispatched; a headless page would still get rAF, so while "hidden" rAF callbacks are held back
// (no frame() runs: only the background beat can step the sim) and flushed on return. Asserts the sim clock moved by
// wall s x scale x 0.5 (BASE_SPEED: 60 live steps a wall s at 1x) within a tolerance, frames resume on return, the
// camera is sane, the look-ahead copy (idle while hidden) catches up and did not diverge, and no page errors.
// --cost: instead, the cost of one live step mid-strike in a carrier duel (the background budget is sized from it).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/bg_tick_test.js [--cost]
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const COST = process.argv.includes('--cost');
const HOLD = `(() => {
  window.__hide = false; const raf = window.requestAnimationFrame.bind(window), held = [];
  window.requestAnimationFrame = cb => { if (window.__hide) { held.push(cb); return 0; } return raf(cb); };
  window.__flush = () => held.splice(0).forEach(cb => raf(cb));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hide });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hide ? 'hidden' : 'visible') });
  window.__setHidden = h => { window.__hide = h; document.dispatchEvent(new Event('visibilitychange')); if (!h) window.__flush(); };
})();`;

async function cost(b) {
  const A = require('./camera_audit');
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  await p.addInitScript('window.__realNow = performance.now.bind(performance);' + A.INIT(7));
  await p.goto(BASE + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate(([install, cfg]) => { WW.post.render = () => {}; (new Function('return ' + install)())(cfg); }, [A.install.toString(), A.specOf('carrier_duel', 1)]);
  // on to the first strike's attack (planes on their run) or 400 sim s
  const busy = await p.evaluate(() => {
    const att = () => WW.world.planes.filter(q => q.alive && q.ordnance && (q.state === 'attack' || q.phase)).length;
    while (WW.game.state === 'battle' && WW.game.roundTime < 400 && att() < 4) __sim.stepFixed(120);
    const r = []; for (let k = 0; k < 5; k++) { const t0 = __realNow(); __sim.stepFixed(120); r.push((__realNow() - t0) / 120); }
    return { state: WW.game.state, round: WW.stats.round, sim: +WW.game.roundTime.toFixed(1), planes: WW.world.planes.filter(q => q.alive).length, attacking: att(), msPerStep: r.map(x => +x.toFixed(3)) };
  });
  console.log('carrier_duel mid-strike step cost', JSON.stringify(busy));
}

async function main(b) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(HOLD);
  await p.goto(BASE + 'index.html?auto');
  await p.waitForTimeout(4000);
  const snap = () => p.evaluate(() => ({ now: WW.time.now, n: WW.game.stepN, round: WW.stats.round, drawn: WW.frames.drawn, wall: performance.now(), state: WW.game.state, bg: Object.assign({}, WW.bgTick) }));
  let fail = 0;
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fail++; };
  for (const scale of [1, 4]) {
    await p.evaluate(s => __sim.setScale(s), scale);
    const a0 = await snap(); await p.waitForTimeout(2500);
    const a = await snap(), base = a.drawn - a0.drawn;   // (the frame rate before: swiftshader draws a few a second)
    await p.evaluate(() => __setHidden(true));
    await p.waitForTimeout(8000);
    const h = await snap();
    await p.evaluate(() => __setHidden(false));
    const wallS = (h.wall - a.wall) / 1000, simS = h.now - a.now, want = wallS * scale * 0.5;
    console.log(`scale ${scale}: hidden ${wallS.toFixed(1)} wall s -> ${simS.toFixed(2)} sim s (want ${want.toFixed(2)}), steps ${h.bg.steps - a.bg.steps}, beats ${h.bg.beats - a.bg.beats}, frames drawn while hidden ${h.drawn - a.drawn}, round ${a.round}->${h.round} ${h.state}`);
    check(h.drawn - a.drawn <= 1, 'no frames while hidden');
    check(simS > want * 0.85 && simS < want * 1.1, `sim clock follows the wall clock at ${scale}x`);
    await p.waitForTimeout(2500);
    const v = await snap();
    check(v.drawn - h.drawn >= Math.max(2, base * 0.5), `frames resume (${v.drawn - h.drawn} drawn in 2.5 s, ${base} before hiding)`);
    check(v.bg.beats === h.bg.beats || v.bg.beats - h.bg.beats <= 1, 'the beat stops stepping once visible');
  }
  // a round that ends while hidden: auto mode rolls into the next one (VICTORY_TIME 9 sim s: 4.5 wall s at 4x)
  {
    const r0 = await p.evaluate(() => { __sim.setScale(4); __setHidden(true); WW.game.endRound('USN', 'kill'); return WW.stats.round; });
    await p.waitForTimeout(7000);
    const r1 = await p.evaluate(() => ({ round: WW.stats.round, state: WW.game.state }));
    await p.evaluate(() => { __setHidden(false); __sim.setScale(1); });
    check(r1.round === r0 + 1 && r1.state === 'battle', `a round ended while hidden rolls on (round ${r0} -> ${r1.round}, ${r1.state})`);
    await p.waitForTimeout(1500);
  }
  // the look-ahead copy idled while hidden (lookahead.js pace()): it catches up and the director has it again
  const la = await p.evaluate(async () => { const L = WW.lookahead; if (!L || !L.on) return null; const t0 = performance.now(); const r = await L.waitAhead(10, 60000); return { s: +((performance.now() - t0) / 1000).toFixed(1), usable: L.usable(), ahead: +r.ahead.toFixed(1), state: WW.game.state }; });
  check(!la || la.usable || la.state !== 'battle', 'look-ahead ahead again after return ' + JSON.stringify(la));
  const cam = await p.evaluate(() => { const c = WW.camera.position; return { x: c.x, y: c.y, z: c.z, la: WW.lookahead ? { on: WW.lookahead.on, diverged: WW.lookahead.diverged, mismatch: WW.lookahead.mismatch } : null }; });
  check([cam.x, cam.y, cam.z].every(Number.isFinite) && cam.y > 0 && cam.y < 3000, `camera sane (${cam.x.toFixed(0)}, ${cam.y.toFixed(0)}, ${cam.z.toFixed(0)})`);
  check(!cam.la || !cam.la.on || !cam.la.diverged, 'look-ahead copy still in step ' + JSON.stringify(cam.la));
  await p.screenshot({ path: process.env.SHOT || require('path').join(__dirname, 'shots', 'bg_tick.png') });
  check(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  return fail;
}

(async () => {
  require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fail = 0;
  try { if (COST) await cost(b); else fail = await main(b); } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'PASS');
  process.exit(fail ? 1 : 0);
})();
