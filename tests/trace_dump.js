// Dump per-seed round traces to a JSON file (or compare against one): a bit-identical regression check across commits.
// The trace is tests/determinism.js's plus one WW.rand() draw per sample (a tap on the RNG stream: a change that adds
// or drops a sim draw shows at once), so compare only against a baseline made by this script. Usage: node tests/trace_dump.js <out.json> [seeds=1,2,3] [secs=300] [--cmp ref.json] [query]
const fs = require('fs'), crypto = require('crypto');
const H = require('./headless');
const ci = H.argv.indexOf('--cmp'), CMP = ci >= 0 ? H.argv[ci + 1] : null;
const pos = H.argv.filter((a, i) => a !== '--cmp' && H.argv[i - 1] !== '--cmp');
const OUT = pos[0], SEEDS = (pos[1] || '1,2,3').split(',').map(Number), SECS = +(pos[2] || 300), Q = pos[3] || '';
(async () => {
  const b = await H.launch(), errs = [];
  const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(H.url(Q));
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  const res = {};
  for (const seed of SEEDS) {
    res[seed] = await p.evaluate(([seed, secs]) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      const s0 = Object.assign({}, WW.stats);
      G.composition = null; G.mode = 'auto';
      G.startRound({ keepMap: true });
      const n = v => typeof v === 'number' ? (Object.is(v, -0) ? 0 : v) : v;
      const snap = t => {
        const ents = {};
        WW.world.ships.forEach((s, i) => { ents[`ship#${i} ${s.nation} ${s.type}`] = [s.id, s.x, s.z, s.heading, s.speed, s.hp, s.alive, s.sinking].map(n).join(','); });
        WW.world.planes.filter(q => q.alive || q.deathMode === 'crash').forEach((q, i) => { ents[`plane#${i} ${q.nation} ${q.kind}`] = [q.x, q.y, q.z, q.heading, q.hp, q.state, q.alive].map(n).join(','); });
        const st = {}; for (const k in WW.stats) if (typeof WW.stats[k] === 'number' && k !== 'round') st[k] = WW.stats[k] - (s0[k] || 0);
        return { t, ents, stats: JSON.stringify(st) + ' state=' + G.state + ' winner=' + G.winner + ' r=' + WW.rand() };
      };
      const out = [snap(0)];
      for (let t = 5; t <= secs + 1e-9; t += 5) { __sim.fastForward(5); out.push(snap(+t.toFixed(3))); }
      return out;
    }, [seed, SECS]);
    console.log(`seed ${seed}: ${crypto.createHash('sha1').update(JSON.stringify(res[seed])).digest('hex').slice(0, 12)}`);
  }
  await b.close();
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 10).join('\n'));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res));
  if (CMP) {
    const ref = JSON.parse(fs.readFileSync(CMP)); let bad = 0;
    for (const s of SEEDS) {
      const a = ref[s], c = res[s];
      for (let i = 0; i < Math.max(a.length, c.length); i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(c[i])) {
          bad++; const ka = a[i] ? a[i].ents : {}, kc = c[i] ? c[i].ents : {};
          const k = [...new Set([...Object.keys(ka), ...Object.keys(kc)])].find(k => ka[k] !== kc[k]);
          console.log(`seed ${s} diverges at t=${a[i] && a[i].t}: ${k ? k + '\n  ref ' + ka[k] + '\n  got ' + kc[k] : 'stats\n  ref ' + a[i].stats + '\n  got ' + (c[i] && c[i].stats)}`); break;
        }
      }
    }
    console.log(bad ? `FAIL: ${bad} seed(s) differ from ${CMP}` : `PASS: identical to ${CMP}`);
    process.exit(bad || errs.length ? 1 : 0);
  }
})();
