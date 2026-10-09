// Determinism check: the same seed must give the same round, whatever ran before and in any page.
// In one page: run seed S, run S again, run another seed then S. Then run S in a fresh page.
// Each run records a trace every EVERY sim seconds (positions/hp of all ships and live planes, plus WW.stats deltas);
// all traces must match the first. On a mismatch it prints the first divergent time and entity.
// Runs in the node runner by default (tests/node_sim.js); --browser: a sim-only Chrome page; --render: the full game.
// --cross: the same seeds in each of --modes (default render,browser,node: the full game in Chrome, the sim-only
// Chrome page and the node runner) must give identical traces; the first mode is the reference.
// Usage: node tests/determinism.js [seed=1] [seconds=300] [--browser | --render]
//        node tests/determinism.js --cross [seeds=1,2,3] [seconds=300] [--modes browser,node]
//        (BASE_URL=http://localhost:PORT/ and CHROMIUM=headless shell for the Chrome modes; EVERY=5 sample interval in sim s)
//        TOD=dusk|night and WX=line force the time of day and the weather (daylight.js, weather.js)
const crypto = require('crypto');
const H = require('./headless');
const CROSS = H.argv.includes('--cross'), mi = H.argv.indexOf('--modes');
const MODES = mi >= 0 ? H.argv[mi + 1].split(',') : ['render', 'browser', 'node'];
const pos = H.argv.filter((a, i) => a !== '--cross' && a !== '--modes' && H.argv[i - 1] !== '--modes');
const SEEDS = (pos[0] || (CROSS ? '1,2,3' : '1')).split(',').map(Number), SEED = SEEDS[0];
const SECS = +(pos[1] || 300), EVERY = +(process.env.EVERY || 5);

async function openPage(b, errs, render = H.RENDER) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(H.url('', render));
  await p.waitForTimeout(H.settle(render));
  // same setup as sim_rounds.js: stop the render loop, the test drives the sim alone
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  await p.waitForTimeout(200);
  return p;
}

// Run one seeded round for `secs` sim seconds; return [{ t, ents: {key: string}, stats: string }]
function trace(p, seed, secs) {
  return p.evaluate(([seed, secs, every, tod, wx]) => {
    const G = WW.game;
    // aces carry over between rounds by design (air_aces.js); a seeded replay starts with fresh rosters
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const s0 = Object.assign({}, WW.stats);
    G.composition = null; G.mode = 'auto'; // the page boots into setup with its own random fleets: start from this seed's fleets
    if (WW.dayNight) WW.dayNight.force = tod; if (WW.weather) WW.weather.force = wx; // TOD=night|dusk|day, WX=line|scatter|clear
    G.startRound({ keepMap: true });
    const n = v => typeof v === 'number' ? (Object.is(v, -0) ? 0 : v) : v;
    const snap = t => {
      const ents = {};
      WW.world.ships.forEach((s, i) => {
        ents[`ship#${i} ${s.nation} ${s.type}`] = [s.id, s.x, s.z, s.heading, s.speed, s.hp, s.alive, s.sinking].map(n).join(',');
      });
      // live planes, and dead ones diving into a ship (sim); other falling/ditched wrecks are visual (Math.random)
      WW.world.planes.filter(q => q.alive || q.deathMode === 'crash').forEach((q, i) => {
        ents[`plane#${i} ${q.nation} ${q.kind}`] = [q.x, q.y, q.z, q.heading, q.hp, q.state, q.alive].map(n).join(',');
      });
      const st = {}; for (const k in WW.stats) if (typeof WW.stats[k] === 'number' && k !== 'round') st[k] = WW.stats[k] - (s0[k] || 0);
      const night = (WW.daylight === undefined ? '' : ' dl=' + WW.daylight) + (WW.nightOps ? ' shells=' + WW.nightOps.shells.map(q => q.x.toFixed(3) + ':' + q.z.toFixed(3)).join('|') + ' lights=' + WW.nightOps.lights.length : '') + (WW.weather ? ' wx=' + WW.weather.cells.map(c => c.x.toFixed(3)).join('|') : '');
      return { t, ents, stats: JSON.stringify(st) + ' state=' + G.state + ' winner=' + G.winner + night };
    };
    const out = [snap(0)];
    for (let t = every; t <= secs + 1e-9; t += every) { __sim.fastForward(every); out.push(snap(+t.toFixed(3))); }
    return out;
  }, [seed, secs, EVERY, process.env.TOD || null, process.env.WX || null]);
}

const hash = tr => crypto.createHash('sha1').update(JSON.stringify(tr)).digest('hex').slice(0, 12);

function compare(ref, tr) {
  for (let i = 0; i < Math.max(ref.length, tr.length); i++) {
    const a = ref[i], b = tr[i];
    if (!a || !b) return `trace length differs at sample ${i}`;
    const keys = [...new Set([...Object.keys(a.ents), ...Object.keys(b.ents)])];
    for (const k of keys) {
      if (a.ents[k] !== b.ents[k]) return `t=${a.t}s  ${k}\n      ref: ${a.ents[k] || '(missing)'}\n      got: ${b.ents[k] || '(missing)'}`;
    }
    if (a.stats !== b.stats) return `t=${a.t}s  WW.stats\n      ref: ${a.stats}\n      got: ${b.stats}`;
  }
  return null;
}

// --cross: per seed, one page in each mode (one browser each) must match the first mode's trace exactly
async function cross() {
  const errs = [], pages = [];
  for (const m of MODES) { const b = await H.launchAs(m); pages.push({ m, b, p: await openPage(b, errs, m === 'render') }); }
  let fail = 0;
  for (const seed of SEEDS) {
    const tr = [];
    for (const x of pages) { const t0 = Date.now(); tr.push(await trace(x.p, seed, SECS)); x.ms = Date.now() - t0; }
    const ds = tr.map((t, i) => (i ? compare(tr[0], t) : null)), bad = ds.filter(Boolean);
    if (bad.length) fail++;
    const last = tr[0][tr[0].length - 1];
    console.log(`seed ${seed}: ` + pages.map((x, i) => `${x.m} ${hash(tr[i])} (${(x.ms / 1000).toFixed(1)}s)`).join('  ') +
      `  ${bad.length ? 'DIVERGED: ' + ds.map((d, i) => (d ? pages[i].m + ' at ' + d : '')).filter(Boolean).join('; ') : 'identical'}` +
      `  (${SECS} sim s, ${tr[0].length} samples, ${Object.keys(last.ents).length} entities at end, ${last.stats})`);
  }
  for (const x of pages) await x.b.close();
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 10).join('\n'));
  console.log(fail || errs.length ? `FAIL: ${fail} seed(s) diverged between ${MODES.join(', ')}` : `PASS: ${MODES.join(', ')} traces identical`);
  process.exit(fail || errs.length ? 1 : 0);
}

(async () => {
  if (CROSS) return cross();
  const b = await H.launch();
  const errs = [];
  const other = SEED + 1000;
  const runs = [];
  const p1 = await openPage(b, errs);
  runs.push(['page A: seed ' + SEED, await trace(p1, SEED, SECS)]);
  runs.push(['page A: seed ' + SEED + ' again', await trace(p1, SEED, SECS)]);
  await trace(p1, other, Math.min(SECS, 120));
  runs.push([`page A: seed ${other} then seed ${SEED}`, await trace(p1, SEED, SECS)]);
  await p1.close();
  const p2 = await openPage(b, errs);
  runs.push(['page B (fresh): seed ' + SEED, await trace(p2, SEED, SECS)]);
  await p2.close();
  await b.close();

  const ref = runs[0][1];
  let fail = 0;
  for (const [name, tr] of runs) {
    const d = tr === ref ? null : compare(ref, tr);
    if (d) fail++;
    console.log(`${hash(tr)}  ${name}${d ? '  DIVERGED at ' + d : ''}`);
  }
  const last = ref[ref.length - 1];
  console.log(`${H.MODE} mode, seed ${SEED}, ${SECS} sim s, ${ref.length} samples; at end: ${Object.keys(last.ents).length} entities, ${last.stats}`);
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 10).join('\n'));
  console.log(fail ? `FAIL: ${fail} run(s) diverged` : 'PASS: identical traces');
  process.exit(fail ? 1 : 0);
})();
