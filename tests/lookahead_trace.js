// Look-ahead trace check (camera5, js/lookahead.js): the worker's copy of a round must BE the displayed round. The full
// game (render mode, ?cam=lookahead, the director running) plays seeded rounds on a fake 30 fps frame clock at changing
// time scales (1x, 4x, 2x, 0.5x: the fixed live step makes them all the same round) and the director's own slow motion;
// then the page's own checkpoint hashes (lookahead_log.js, every 600 live steps) must equal the worker's, and the
// worker's event log up to the page's step must equal the page's own log, event for event (where a falling wreck meets
// the sea is reported apart: the full game's wreck has a visual last few seconds). A second round follows on
// from the first without reseeding (the RNG state, the aces' rosters and the admirals carried over: round_rec.js).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/lookahead_trace.js [--scen standard,carrier_duel] [--seeds 1,2] [--sim 300] [--sim2 150]
const { chromium } = require('playwright');
const A = require('./camera_audit');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SCENS = arg('--scen', 'standard,carrier_duel').split(','), SEEDS = arg('--seeds', '1,2').split(',').map(Number);
const SIM = +arg('--sim', 300), SIM2 = +arg('--sim2', 150);
const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const WAIT = `(async () => { const L = WW.lookahead; if (L && L.on) await L.waitAhead(L.HORIZON + 10, 120000); })()`;

async function play(p, secs, scales) {
  let i = 0, t0 = await p.evaluate(() => WW.game.roundTime), t = t0;
  while (t - t0 < secs) {
    const sc = scales[i++ % scales.length];
    await p.evaluate(WAIT);
    t = await p.evaluate(sc => { __sim.setScale(sc); __step(150); return WW.game.state === 'battle' ? WW.game.roundTime : 1e9; }, sc);
  }
  await p.evaluate(() => __sim.setScale(1));
}
async function check(p, label) {
  // let the worker's last messages arrive
  await p.evaluate(() => new Promise(r => setTimeout(r, 300)));
  return p.evaluate(label => {
    // ('wet', where a falling wreck meets the sea, is compared apart: a wreck's last seconds are partly visual in the full game)
    const L = WW.lookahead, n = WW.game.stepN, wetP = WW.laLog.ev.filter(e => e.k === 'wet'), wetW = L.ev.filter(e => e.k === 'wet' && e.n <= n);
    const mine = WW.laLog.ev.filter(e => e.k !== 'wet'), theirs = L.ev.filter(e => e.n <= n && e.k !== 'wet');
    const wk = e => e.p + '@' + e.n, wset = new Set(wetW.map(wk)), wetSame = wetP.filter(e => wset.has(wk(e))).length;
    const key = e => JSON.stringify(e);
    let diff = null;
    for (let i = 0; i < Math.max(mine.length, theirs.length); i++) if (key(mine[i]) !== key(theirs[i])) { diff = { i, page: mine[i], worker: theirs[i] }; break; }
    const kinds = {}; for (const e of mine) kinds[e.k] = (kinds[e.k] || 0) + 1;
    let where = null;
    if (L.diverged && L.wdetail) for (const c of WW.laLog.checks) {
      const w = L.wdetail.get(c.n); if (!w || !c.d) continue;
      const d = []; for (let i = 0; i < Math.max(w.length, c.d.length); i++) if (w[i] !== c.d[i]) d.push('page ' + c.d[i] + ' | worker ' + w[i]);
      if (d.length) { where = c.n + ': ' + d.slice(0, 6).join('\n      '); break; }
    }
    return { where, label, n, sim: +WW.game.roundTime.toFixed(1), checks: L.checks, diverged: L.diverged, mismatch: L.mismatch, events: mine.length, worker: theirs.length, diff, kinds, ahead: +((L.wn - n) * __sim.LIVE_STEP).toFixed(1), errs: L.errs.slice(0, 3), boot: Math.round(L.bootMs), wet: wetSame + '/' + wetP.length };
  }, label);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fail = 0;
  for (const sc of SCENS) for (const sd of SEEDS) {
    const spec = A.specOf(sc, sd);
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.addInitScript((process.env.LA_DBG ? 'window.__laDbg = true;' : '') + A.INIT(sd * 31 + 7));   // LA_DBG=1: on a divergence, the entities that differ
    await p.goto(BASE + 'index.html?auto&cam=lookahead');
    await p.waitForTimeout(1500);
    await p.evaluate(([install, cfg]) => {
      WW.post.render = () => {};
      const t0 = performance.now(); performance.now = () => t0 + __fakeT;
      __step(5);
      (new Function('return ' + install)())(cfg);
    }, [A.install.toString(), spec]);
    await play(p, SIM, [1, 4, 2, 0.5]);
    const r1 = await check(p, `${sc}/${sd} round 1`);
    await p.evaluate(() => { WW.game.startRound(); });   // the next round, carried on (no reseed)
    await play(p, SIM2, [2, 1]);
    const r2 = await check(p, `${sc}/${sd} round 2`);
    for (const r of [r1, r2]) {
      const bad = r.diverged || r.diff || !r.checks || r.events === 0;
      if (bad) fail++;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${r.label}: ${r.sim} sim s (${r.n} steps), ${r.checks} checkpoints equal${r.diverged ? ', DIVERGED at ' + JSON.stringify(r.mismatch) : ''}, ` +
        `${r.events} events (worker ${r.worker}, wreck landings same ${r.wet})${r.diff ? ' FIRST DIFF #' + r.diff.i + ' page ' + JSON.stringify(r.diff.page) + ' worker ' + JSON.stringify(r.diff.worker) : ' identical'}, worker ${r.ahead} s ahead, boot ${r.boot} ms ${JSON.stringify(r.kinds)}${r.errs.length ? ' worker errors: ' + r.errs.join(' | ') : ''}`);
    }
    for (const r of [r1, r2]) if (r.where) console.log('    first difference at step ' + r.where);
    if (errs.length) { fail++; console.log('  page errors: ' + errs.slice(0, 5).join(' | ')); }
    await p.close();
  }
  await b.close();
  console.log(fail ? `FAIL: ${fail}` : 'PASS: the look-ahead worker replays the displayed rounds exactly');
  process.exit(fail ? 1 : 0);
})();
