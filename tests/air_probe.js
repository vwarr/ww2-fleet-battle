// Air ops probe: runs one seeded carrier round headless and prints the air picture every few sim seconds
// (per carrier: CAP up / coming / hangar, queue, deck mode; strikes; airOps stats). For debugging air_ops.js.
// Usage: BASE_URL=http://localhost:PORT/ node tests/air_probe.js [seed=1] [seconds=240] [fleet=carrier_duel|random]
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 1), SECS = +(process.argv[3] || 240), FLEET = process.argv[4] || 'carrier_duel';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', e => console.log('PAGE', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(1500);
  const out = await p.evaluate(([seed, secs, fleet, STEP]) => { window.__detailArg = STEP < 10;
    window.requestAnimationFrame = () => 0; WW.time.warp = 1;
    const G = WW.game; if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    if (fleet === 'random') G.composition = null;
    else {
      const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, f = (n, x) => [{ type: 'carrier', nation: n, x, z: H / 2 }, { type: 'destroyer', nation: n, x: x + (n === 'USN' ? 60 : -60), z: H / 2 - 40 }, { type: 'destroyer', nation: n, x: x + (n === 'USN' ? 60 : -60), z: H / 2 + 40 }];
      G.composition = [...f('USN', 60), ...f('IJN', W - 60)];
    }
    G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    const lines = [], K = {};
    WW.on('planeKill', e => { const s = e.shooter, v = e.victim; if (!s || !v) return; const k = (s.target ? 'esc' : 'cap') + '>' + v.kind + (v.ordnance ? '*' : '') + (s.carrier ? ' d' + Math.round(WW.dist(v.x, v.z, s.carrier.x, s.carrier.z) / 25) * 25 : ''); K[k] = (K[k] || 0) + 1; });
    window.__detail = !!window.__detailArg;
    for (let t = 0; t < secs && G.state === 'battle'; t += STEP) {
      __sim.fastForward(STEP);
      const row = [];
      for (const cv of WW.world.ships.filter(s => s.type === 'carrier' && s.alive)) {
        const P = WW.world.planes.filter(q => q.alive && q.carrier === cv);
        const cap = P.filter(q => q.kind === 'fighter' && !q.target);
        const st = k => cap.filter(q => q.state === k).length;
        row.push(`${cv.nation} hg ${cv.hangar.fighter}/${cv.hangar.dive}/${cv.hangar.torpedo} cap tr${st('transit')} at${st('attack')} to${st('takeoff')} rt${st('return')} ld${st('landing')} esc ${P.filter(q => q.kind === 'fighter' && q.target).length} bmb ${P.filter(q => q.kind !== 'fighter').length} q[${cv.ai.queue.map(q => q.kind[0] + (q.target ? '*' : '')).join('')}] deck ${cv._deck && cv._deck.mode} fuel ${cap.map(q => q.fuel | 0).join(',')} dk ${cap.map(q => q.deckPh || '-').join(',')}`);
      }
      lines.push(`t=${G.roundTime.toFixed(0)} ` + row.join(' | '));
      if (window.__detail) for (const q of WW.world.planes) if (q.alive && q.kind === 'fighter' && q.state === 'attack' && q.foe) { const f = q.foe; lines.push(`   ${q.nation} ${q.target ? 'esc' : 'cap'} w${q.wing} foe ${f.kind}${f.ordnance ? '*' : ''} ${f.phase || f.sk || f.state} d3 ${Math.hypot(f.x - q.x, f.y - q.y, f.z - q.z).toFixed(0)} dy ${(f.y - q.y).toFixed(0)} mode ${q.df && q.df.mode}/${q.df && q.df.def} spd ${q.speed.toFixed(0)} cv ${WW.dist(q.x, q.z, q.carrier.x, q.carrier.z).toFixed(0)}`); }
    }
    lines.push('airOps ' + JSON.stringify(WW.airOps && WW.airOps.stats));
    lines.push('kills ' + JSON.stringify(K) + ' df ' + JSON.stringify(WW.dogfight.stats) + ' lost ' + WW.stats.planesLost);
    return lines;
  }, [SEED, SECS, FLEET, +(process.env.STEP || 10)]);
  console.log(out.join('\n'));
  await b.close();
})();
