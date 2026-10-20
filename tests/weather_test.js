// Weather kinds, wind-driven seas and the storm rules (weather.js), sim-only (node runner by default):
//  - every kind starts and runs (forced: WW.weather.force), sea state follows the wind (Beaufort -> Douglas)
//  - the WW.rand draw count of the roll is the same for every kind (a forced kind replays the same sequence)
//  - typhoon: no plane launched, PT boats held, ships founder only small (~0-1 per round), never a capital ship
//  - no foundering in any other kind
// Usage: node tests/weather_test.js [roundsPerKind=4] [typhoonRounds=40] [--workers K]
const HL = require('./headless');
const N = +(HL.argv[0] || 4), NT = +(HL.argv[1] || 40);
const KINDS = ['clear', 'cumulus', 'overcast', 'scatter', 'line', 'thunder', 'typhoon'];
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

async function openPage(b, errs) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(HL.url());
  await p.waitForTimeout(HL.settle());
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  return p;
}
function runRound(p, a) {
  return p.evaluate(a => {
    const G = WW.game, W = WW.weather;
    WW.terrain.generate(a.seed); WW.seedRandom(a.seed); G.seed = a.seed; WW.time.now = 0;
    W.force = a.kind;
    const sw0 = Object.assign({}, W.stats.swamped), pl0 = WW.stats.planesLaunched, pt0 = W.stats.ptHeld;
    G.composition = null; G.mode = 'auto';
    if (!window.__wxS) { window.__wxS = []; WW.on('swamped', e => { if (window.__wxOn) window.__wxS.push({ type: e.ship.type, t: +WW.game.roundTime.toFixed(0) }); }); }
    const sinkT = window.__wxS; sinkT.length = 0;
    window.__wxOn = true;
    G.startRound({ keepMap: true });
    const ss = WW.seaState, kind = W.kind, nf = W.noFly;
    let t = 0, pts = 0;
    for (const s of WW.world.ships) if (s.type === 'pt') pts++;
    while (G.state === 'battle' && t < (a.secs || WW.cfg.ROUND_TIMEOUT + 150)) { __sim.fastForward(1); t += 1; }
    window.__wxOn = false;
    // the roll's WW.rand draw count (after the round: a re-roll here changes nothing that is measured)
    const R0 = WW.rand; let cnt = 0; WW.rand = function () { cnt++; return R0.apply(this, arguments); }; W.roll(); WW.rand = R0;
    const sw = {}; for (const k in W.stats.swamped) sw[k] = W.stats.swamped[k] - sw0[k];
    const small = WW.world.ships.filter(s => s.type === 'destroyer' || s.type === 'pt').length;
    return { kind, douglas: +ss.douglas.toFixed(2), bf: ss.beaufort, noFly: nf, draws: cnt, sw, launched: WW.stats.planesLaunched - pl0, ptHeld: W.stats.ptHeld - pt0, pts, small, t, sinkT: sinkT.slice() };
  }, a);
}
(async () => {
  const b = await HL.launch();
  const errs = [], pages = [];
  for (let i = 0; i < HL.WORKERS; i++) pages.push(await openPage(b, errs));
  const jobs = [];
  for (const k of KINDS) for (let i = 0; i < (k === 'typhoon' ? NT : N); i++) jobs.push({ kind: k, seed: 100 + i * 7 + KINDS.indexOf(k) });
  const res = [];
  let next = 0;
  await Promise.all(pages.map(async p => { while (next < jobs.length) { const j = jobs[next++]; res.push(Object.assign({ job: j }, await runRound(p, j))); } }));
  const draws = new Set(res.map(r => r.draws));
  ok(draws.size === 1, 'roll draws the same number of WW.rand values for every kind: ' + [...draws].join(','));
  for (const k of KINDS) {
    const R = res.filter(r => r.job.kind === k), n = R.length;
    const swS = R.reduce((a, r) => a + (r.sw.destroyer || 0) + (r.sw.pt || 0) + (r.sw.submarine || 0), 0);
    const swB = R.reduce((a, r) => a + (r.sw.cruiser || 0) + (r.sw.battleship || 0) + (r.sw.carrier || 0), 0);
    const maxR = Math.max(...R.map(r => Object.values(r.sw).reduce((a, b) => a + b, 0)));
    const D = R.map(r => r.douglas), B = R.map(r => r.bf), L = R.reduce((a, r) => a + r.launched, 0);
    console.log(`  ${k.padEnd(8)} rounds ${n}  Bf ${Math.min(...B)}-${Math.max(...B)}  Douglas ${Math.min(...D).toFixed(1)}-${Math.max(...D).toFixed(1)}  launched ${L}  ptHeld ${R.reduce((a, r) => a + r.ptHeld, 0)}/${R.reduce((a, r) => a + r.pts, 0)}  swamped small ${swS} big ${swB} (max ${maxR}/round)  len ${(R.reduce((a, r) => a + r.t, 0) / n).toFixed(0)} s`);
    ok(R.every(r => r.kind === k), k + ': every round has the forced kind');
    if (k !== 'typhoon') ok(swS + swB === 0, k + ': no ship founders');
    else {
      ok(swB <= Math.max(1, n / 40), `typhoon: almost never a cruiser / capital ship founders (${swB} in ${n} rounds)`);
      ok(swS / n >= 0.1 && swS / n <= 1.2, `typhoon: small ships foundered per round ${(swS / n).toFixed(2)} (target ~0-1)`);
      ok(L === 0 && R.every(r => r.noFly), 'typhoon: no flight ops');
      if (R.some(r => r.pts)) ok(R.reduce((a, r) => a + r.ptHeld, 0) > 0, 'typhoon: PT boats held');
      console.log('  typhoon founderings: ' + R.flatMap(r => r.sinkT.map(s => s.type + '@' + s.t)).join(' '));
    }
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'all ok');
  process.exit(fail ? 1 : 0);
})();
