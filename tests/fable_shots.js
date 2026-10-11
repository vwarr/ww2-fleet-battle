// Fable audit screenshots (render mode; BASE_URL and CHROMIUM as for the other render tests). Replays a standard
// (random-fleet) round by seed exactly as tests/fable_probe.js / sim_behaviour.js do, fast-forwards to t, films the
// ship with the given id (an orbit shot) and saves a few frames, plus a wide shot. Read-only: nothing in the sim is changed.
// Usage: node tests/fable_shots.js SEED T SHIP_ID [tag] [width=90] [outdir=docs/fable_audit]
const { chromium } = require('playwright');
const path = require('path');
const [seed, T, shipId, tag = 'shot', width = '90', out = path.join(__dirname, '..', 'docs', 'fable_audit')] = process.argv.slice(2);
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1024, height: 576 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(2000);
  const info = await p.evaluate(({ seed, T, shipId, width }) => {
    const G = WW.game;
    __sim.setScale(0.1);
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.dayNight) WW.dayNight.force = null;
    if (WW.weather) WW.weather.force = null;
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.noRetire = false; G.baseChoice = null;
    G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    while (G.state === 'battle' && G.roundTime < T) __sim.fastForward(1);
    const s = WW.world.ships.find(q => q.id === shipId);
    if (!s) return { err: 'no ship ' + shipId, ships: WW.world.ships.map(q => q.id + ':' + q.nation + ' ' + q.type + ' ' + (q.name || '')) };
    const near = WW.world.ships.filter(q => q !== s && q.alive && WW.dist(q.x, q.z, s.x, s.z) < 200).map(q => `${q.nation} ${q.type} ${q.name || ''} #${q.id} d${WW.dist(q.x, q.z, s.x, s.z).toFixed(0)}${q === s.target ? ' <TARGET' : ''}`);
    const o = WW.fleetCmd.order(s), B = WW.fleetCmd.side(s.nation);
    if (WW.cam.film) WW.cam.film({ kind: 'orbit', subj: s, r: width * 0.55, dur: 40, w: 0.05 }); else __sim.focus(s.x, s.z, width, 40);
    return { t: G.roundTime, who: `${s.nation} ${s.type} ${s.name || ''} #${s.id}`, hp: +(s.hp / s.maxHp).toFixed(2), speed: +s.speed.toFixed(1), throttle: +s.throttle.toFixed(2), heading: +s.heading.toFixed(2),
      target: s.target ? `${s.target.nation} ${s.target.type} ${s.target.name || ''} #${s.target.id} d${WW.dist(s.x, s.z, s.target.x, s.target.z).toFixed(0)}` : null,
      order: o ? { role: o.role, group: o.group } : null, posture: B && B.posture, broken: !!(B && B.brokenAt), near, x: +s.x.toFixed(0), z: +s.z.toFixed(0) };
  }, { seed: +seed, T: +T, shipId: +shipId, width: +width });
  console.log(JSON.stringify(info, null, 1));
  if (!info.err) {
    for (let i = 0; i < 3; i++) { await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${tag}_${seed}_${T}_${i}.jpg`, type: "jpeg", quality: 75, timeout: 180000 }); await p.evaluate(() => __sim.fastForward(4)); }
    await p.evaluate(({ shipId, width }) => { const s = WW.world.ships.find(q => q.id === shipId); if (s) __sim.focus(s.x, s.z, width * 3, 40); }, { shipId: +shipId, width: +width });
    await p.waitForTimeout(2000); await p.screenshot({ path: `${out}/${tag}_${seed}_${T}_wide.jpg`, type: "jpeg", quality: 75, timeout: 180000 });
  }
  await b.close();
})();
