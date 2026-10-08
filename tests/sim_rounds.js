// Headless AI harness: run N seeded rounds with no rendering (__sim.fastForward) and report how they play out:
// winner, end reason, length, losses by type, first contact, how close carriers get to enemy guns, stuck ships.
// Usage: bash tests/run.sh sim_rounds.js [rounds=8] [firstSeed=1] [--pages K] [--render]
//        (or BASE_URL=http://localhost:PORT/ node tests/sim_rounds.js ...)
// Sim-only mode (index.html?sim: no WebGL, identical results) unless --render. --pages K (default 6): K pages run
// seeds in parallel; the rounds print in seed order.
// Env: CHROMIUM = path to a headless shell build; JSON=path writes the raw per-round results.
const { chromium } = require('playwright');
const HL = require('./headless');
const pi = HL.argv.indexOf('--pages'), PAGES = pi >= 0 ? Math.max(1, +HL.argv[pi + 1]) : 6;
const pos = HL.argv.filter((a, i) => a !== '--pages' && HL.argv[i - 1] !== '--pages');
const N = +(pos[0] || 8), SEED0 = +(pos[1] || 1);
const errs = [];
async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(HL.url());
  await p.waitForTimeout(HL.settle());
  // Stop the render loop: it would advance the sim on real-frame timing (setScale clamps to >= 0.1) and the
  // director's slow-motion warp, making seeded rounds unrepeatable. The test drives the sim alone.
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  await p.waitForTimeout(200);
  await p.evaluate(() => {
    // fog-of-war probes (intel.js), installed once (the bus has no off()); reset per round
    const H = window.__h = { sight: {}, fire: null, blind: 0, shots: 0 };
    WW.on('contact', e => { if (e.first && H.sight[e.nation] === undefined) H.sight[e.nation] = +WW.game.roundTime.toFixed(1); });
    WW.on('shellFired', e => {
      const t = e.proj && e.proj.target;
      if (!t || !t.stats || t.nation === e.ship.nation) return;
      H.shots++;
      if (H.fire === null) H.fire = +WW.game.roundTime.toFixed(1);
      if (WW.intel && !WW.intel.visible(e.ship.nation, t)) H.blind++; // a shot at a target the side cannot see
    });
  });
  return p;
}
// one seeded round in page p
function runRound(p, seed) {
  return p.evaluate(seed => {
    const G = WW.game, cap = WW.cfg.ROUND_TIMEOUT + 30, BIG = { battleship: 1, cruiser: 1 };
    if (WW.aces) WW.aces.reset(); // aces carry over between rounds by design: start each seed with fresh rosters
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const s0 = Object.assign({}, WW.stats);
    const sunk = [];
    const onSunk = s => sunk.push({ type: s.type, nation: s.nation, t: +G.roundTime.toFixed(1) });
    WW.on('shipSunk', onSunk);
    let contact = null; // first time any two enemy surface ships are within gun range of each other's main battery
    let heavy = null;   // first time a battleship / cruiser has an enemy battleship / cruiser inside its main battery range
    const cv = {};      // per carrier id: closest approach to any live enemy gun ship
    const moved = {};   // per ship id: [x, z, t of last real move]
    let stuck = 0, nan = 0;
    const H = window.__h; H.sight = {}; H.fire = null; H.blind = 0; H.shots = 0;
    G.composition = null; G.mode = 'auto'; // the page boots into setup with its own random fleets: start from this seed's fleets
    G.startRound({ keepMap: true });
    const comp = {}; for (const s of WW.world.ships) comp[s.nation + ':' + s.type] = (comp[s.nation + ':' + s.type] || 0) + 1;
    let t = 0;
    while (G.state === 'battle' && t < cap) {
      __sim.fastForward(1); t += 1;
      const live = WW.world.ships.filter(s => s.alive && !s.sinking);
      for (const s of live) {
        if (!isFinite(s.x) || !isFinite(s.z)) nan++;
        const m = moved[s.id] || (moved[s.id] = [s.x, s.z, t]);
        if (WW.dist(m[0], m[1], s.x, s.z) > 3) { m[0] = s.x; m[1] = s.z; m[2] = t; }
        else if (t - m[2] > 30 && !m.flag) { m.flag = true; stuck++; }
        for (const o of live) {
          if (o.nation === s.nation || o.submerged) continue;
          const d = WW.dist(s.x, s.z, o.x, o.z);
          if (contact === null && s.stats.guns[0] && d <= s.stats.guns[0].range && s.type !== 'submarine') contact = t;
          if (heavy === null && BIG[s.type] && BIG[o.type] && d <= s.stats.guns[0].range) heavy = t;
          if (s.type === 'carrier' && o.stats.guns.length && o.type !== 'carrier' && o.type !== 'submarine') cv[s.id] = Math.min(cv[s.id] || 1e9, d);
        }
      }
    }
    const end = G.state === 'battle' ? 'cap' : G.endReason === 'retire' ? 'retire' : (WW.world.ships.some(s => s.alive && s.nation === 'USN') && WW.world.ships.some(s => s.alive && s.nation === 'IJN')) ? 'time' : 'kill';
    const d = k => WW.stats[k] - s0[k];
    const out = { seed, winner: G.winner, end, len: +G.roundTime.toFixed(0), contact, heavy, sunk, comp,
      cvMin: Object.values(cv).map(v => +v.toFixed(0)), stuck, nan,
      sightUSN: H.sight.USN === undefined ? null : H.sight.USN, sightIJN: H.sight.IJN === undefined ? null : H.sight.IJN,
      fire: H.fire, blind: H.blind, shotsAtShips: H.shots,
      torps: d('torpedoesFired'), shells: d('shellsFired'), launched: d('planesLaunched'), lost: d('planesLost'), hits: d('hits') };
    // detach our listener (the bus has no off(): blank it)
    onSunk.dead = true; sunk.push = () => 0;
    return out;
  }, seed);
}
function print(r) {
  const lost = n => r.sunk.filter(s => s.nation === n).map(s => s.type[0] + s.type[1]).join(',') || '-';
  console.log(`seed ${r.seed}: ${r.winner || 'draw'} by ${r.end} @${r.len}s  contact ${r.contact}s heavy ${r.heavy}s  sighted U${r.sightUSN}/J${r.sightIJN}s fire ${r.fire}s${r.blind ? ' BLIND ' + r.blind : ''}  USN lost[${lost('USN')}] IJN lost[${lost('IJN')}]  cvMin ${r.cvMin.join('/')}  torps ${r.torps} planes ${r.launched}/${r.lost}lost  stuck ${r.stuck}${r.nan ? ' NaN!' : ''}  (${r.wall}s)`);
}

(async () => {
  const T0 = Date.now(), b = await HL.launch(chromium), k = Math.min(PAGES, N);
  const pages = HL.RENDER ? [] : await Promise.all([...Array(k)].map(() => openPage(b)));
  if (HL.RENDER) for (let i = 0; i < k; i++) pages.push(await openPage(b)); // the full game: one page at a time
  const rounds = new Array(N);
  let next = 0, shown = 0;
  await Promise.all(pages.map(async p => {
    while (next < N) {
      const i = next++, t0 = Date.now();
      const r = await runRound(p, SEED0 + i);
      r.wall = ((Date.now() - t0) / 1000).toFixed(1);
      rounds[i] = r;
      while (shown < N && rounds[shown]) print(rounds[shown++]); // in seed order
    }
  }));
  const avg = f => (rounds.reduce((s, r) => s + f(r), 0) / rounds.length).toFixed(1);
  const cvs = rounds.flatMap(r => r.cvMin);
  console.log('---');
  console.log(`USN ${rounds.filter(r => r.winner === 'USN').length}  IJN ${rounds.filter(r => r.winner === 'IJN').length}  draw ${rounds.filter(r => !r.winner).length}` +
    `   ends: kill ${rounds.filter(r => r.end === 'kill').length} retire ${rounds.filter(r => r.end === 'retire').length} time ${rounds.filter(r => r.end === 'time').length}`);
  console.log(`avg length ${avg(r => r.len)}s  median ${rounds.map(r => r.len).sort((a, b) => a - b)[rounds.length >> 1]}s  avg first contact ${avg(r => r.contact || 0)}s (heavy ${avg(r => r.heavy || 0)}s)  avg sunk ${avg(r => r.sunk.length)}  avg torps ${avg(r => r.torps)}  planes lost ${avg(r => r.lost)}`);
  const avgN = f => { const v = rounds.map(f).filter(x => x !== null && x !== undefined); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-'; };
  console.log(`first sighting: USN ${avgN(r => r.sightUSN)}s  IJN ${avgN(r => r.sightIJN)}s   first fire at a ship ${avgN(r => r.fire)}s   shots at unseen targets ${rounds.reduce((s, r) => s + r.blind, 0)} / ${rounds.reduce((s, r) => s + r.shotsAtShips, 0)}`);
  console.log(`carrier closest approach to enemy gun ships: median ${cvs.sort((a, b) => a - b)[cvs.length >> 1]}  min ${Math.min(...cvs)}`);
  console.log(`stuck ships ${rounds.reduce((s, r) => s + r.stuck, 0)}  NaN ${rounds.reduce((s, r) => s + r.nan, 0)}  errors ${errs.length}` +
    `   (${HL.RENDER ? 'render' : 'sim-only'}, ${k} page${k > 1 ? 's' : ''}, wall ${((Date.now() - T0) / 1000).toFixed(1)}s)`);
  if (errs.length) console.log(errs.slice(0, 10).join('\n'));
  if (process.env.JSON) require('fs').writeFileSync(process.env.JSON, JSON.stringify(rounds, null, 1));
  await b.close();
})();
