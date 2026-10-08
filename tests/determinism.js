// Determinism check: the same seed must give the same round, whatever ran before and in any page.
// In one page: run seed S, run S again, run another seed then S. Then run S in a fresh page.
// Each run records a trace every EVERY sim seconds (positions/hp of all ships and live planes, plus WW.stats deltas);
// all traces must match the first. On a mismatch it prints the first divergent time and entity.
// Usage: node tests/determinism.js [seed=1] [seconds=300]   (BASE_URL=http://localhost:PORT/, CHROMIUM=headless shell,
//        EVERY=5 sample interval in sim s)
const { chromium } = require('playwright');
const crypto = require('crypto');
const SEED = +(process.argv[2] || 1), SECS = +(process.argv[3] || 300), EVERY = +(process.env.EVERY || 5);
const URL = (process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now();

async function openPage(b, errs) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(URL);
  await p.waitForTimeout(1500);
  // same setup as sim_rounds.js: stop the render loop, the test drives the sim alone
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  await p.waitForTimeout(200);
  return p;
}

// Run one seeded round for `secs` sim seconds; return [{ t, ents: {key: string}, stats: string }]
function trace(p, seed, secs) {
  return p.evaluate(([seed, secs, every]) => {
    const G = WW.game;
    // aces carry over between rounds by design (air_aces.js); a seeded replay starts with fresh rosters
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const s0 = Object.assign({}, WW.stats);
    G.composition = null; G.mode = 'auto'; // the page boots into setup with its own random fleets: start from this seed's fleets
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
      return { t, ents, stats: JSON.stringify(st) + ' state=' + G.state + ' winner=' + G.winner };
    };
    const out = [snap(0)];
    for (let t = every; t <= secs + 1e-9; t += every) { __sim.fastForward(every); out.push(snap(+t.toFixed(3))); }
    return out;
  }, [seed, secs, EVERY]);
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

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
  console.log(`seed ${SEED}, ${SECS} sim s, ${ref.length} samples; at end: ${Object.keys(last.ents).length} entities, ${last.stats}`);
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 10).join('\n'));
  console.log(fail ? `FAIL: ${fail} run(s) diverged` : 'PASS: identical traces');
  process.exit(fail ? 1 : 0);
})();
