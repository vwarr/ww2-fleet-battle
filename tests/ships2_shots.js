// Render shots for the ships2 work: a carrier evading a dive-bomber attack (ships_ai.js airEvade) and light AA on an
// incoming attacker (combat_aa.js priority). Pass 1 runs the behaviour rounds in the node runner and finds the first
// carrier dive evasion and the first light-AA stream at an armed bomber on its run / dive; pass 2 replays the same
// round in the rendered game (rounds replay bit-identically) up to that moment, frames it and takes shots.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/ships2_shots.js [--seeds 1,2,3] [--only standard,carrier_duel]
// Output: tests/shots/ships2/{evade,aa}_<seed>_<scen>_<i>.png
'use strict';
const fs = require('fs'), path = require('path');
const HL = require('./headless');
const SB = require('./sim_behaviour');
const SAN = require('./sanity');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = arg('--seeds', '1,2,3').split(',').map(Number), ONLY = arg('--only', 'standard,carrier_duel,midway').split(',');
const OUT = path.join(__dirname, 'shots', 'ships2'), KINDS = arg('--kinds', 'ev,aa').split(',');

function find() { // in the page: hooks that note the first carrier dive evasion and light AA on an armed attacker
  const F = window.__f2 = { ev: null, aa: null };
  WW.on('shipEvade', e => { // a carrier's dive evasion with two or more bombers rolling in / diving on her
    const n = WW.world.planes.filter(p => p.alive && p.target === e.ship && p.ordnance && (p.phase === 'roll' || p.phase === 'dive' || p.state === 'attack')).length;
    if (!F.ev && e.ship.type === 'carrier' && e.kind === 'dive' && WW.game.roundTime > 20 && n >= 3) F.ev = { t: WW.game.roundTime, id: e.ship.id };
  });
  WW.on('aaLightFired', e => {
    const p = e.target, s = e.ship;
    if (F.aa || !s || !s.stats || s.isBase || !p || !p.ordnance || p.target !== s || !(p.phase === 'run' || p.phase === 'dive')) return;
    if (Math.hypot(p.x - s.x, p.z - s.z) > 70) return;
    F.aa = { t: WW.game.roundTime, id: s.id };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const specs = [];
  for (const seed of SEEDS) for (const s of SAN.specsFor(seed)) if (ONLY.includes(s.scen) && !s.swap) specs.push(s);
  const nb = await HL.launchAs('node'), found = [];
  const np = await nb.newPage();
  for (const spec of specs) {
    await np.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await np.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await np.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await np.evaluate(SB.install, SB.P);
    await np.evaluate(find);
    const sp = Object.assign({}, spec, { san: false });
    await np.evaluate(s => window.__beh.run(s), sp);
    const f = await np.evaluate(() => window.__f2);
    console.log(spec.scen, spec.seed, JSON.stringify(f));
    if (f.ev || f.aa) found.push({ spec: sp, f });
    if (found.filter(x => x.f.ev).length >= 2 && found.filter(x => x.f.aa).length >= 2) break;
  }
  await nb.close();
  const { chromium } = require('playwright');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const { spec, f } of found.slice(0, 3)) for (const kind of KINDS) {
    try {
    const e = f[kind]; if (!e) continue;
    const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', x => console.log('PAGE', x.message));
    await p.goto((process.env.BASE_URL || 'http://localhost:8784/') + 'index.html?v=' + Date.now(), { timeout: 180000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 90000 });
    await p.waitForTimeout(2000);
    await p.evaluate(SB.install, SB.P);
    const lead = kind === 'ev' ? 3.5 : 0.3;
    const info = await p.evaluate(([spec, e, lead, kind]) => {
      __sim.setScale(0.1);
      window.__beh.run(Object.assign({}, spec, { until: e.t + lead }));
      const s = WW.world.ships.find(q => q.id === e.id); if (!s) return null;
      __sim.focus(s.x, s.z, kind === 'ev' ? 110 : 70, 60);
      
      const ev = s.ai && s.ai.airEv;
      return { t: +WW.game.roundTime.toFixed(1), ship: s.type + '#' + s.id + ' ' + s.nation, hdg: +(s.heading * 180 / Math.PI).toFixed(0), want: ev ? +(ev.h * 180 / Math.PI).toFixed(0) : null,
        planes: WW.world.planes.filter(q => q.alive && q.target === s && q.ordnance).map(q => q.kind + ':' + (q.phase || q.sk || q.state)).join(' ') };
    }, [spec, e, lead, kind]);
    console.log(kind, spec.scen, spec.seed, JSON.stringify(info));
    if (info) for (let i = 0; i < 3; i++) {
      await p.waitForTimeout(1500);
      await p.screenshot({ timeout: 120000, path: path.join(OUT, `${kind === 'ev' ? 'evade' : 'aa'}_${spec.seed}_${spec.scen}_${i}.png`) });
    }
    await p.close();
    } catch (err) { console.log('shot failed', kind, spec.scen, spec.seed, err.message.split('\n')[0]); }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
