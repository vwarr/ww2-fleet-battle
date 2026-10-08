// Flying boats and sighting reports, per round: Catalina rescues (survivors recovered, Catalinas lost), patrol
// sightings / losses per nation, misidentifications and strikes sent on bad reports. Sim-only unless --render.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/flyingboats_probe.js [rounds=6] [firstSeed=1] [--pages K] [--log]
const { chromium } = require('playwright');
const HL = require('./headless');
const pi = HL.argv.indexOf('--pages'), PAGES = pi >= 0 ? Math.max(1, +HL.argv[pi + 1]) : 2, LOG = HL.argv.includes('--log');
const pos = HL.argv.filter((a, i) => a[0] !== '-' && HL.argv[i - 1] !== '--pages');
const N = +(pos[0] || 6), SEED0 = +(pos[1] || 1);
const errs = [];
async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(HL.url(HL.argv.includes('--trace') ? 'trace' : '')); await p.waitForTimeout(HL.settle());
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1;
    const L = window.__fbLog = [];
    WW.on('flyingBoat', e => L.push(WW.game.roundTime.toFixed(0) + ' ' + e.nation + ' ' + e.plane.mission + ' ' + e.order + (e.unit ? ' ' + e.unit.type : '') + ' @' + e.x.toFixed(0) + ',' + e.z.toFixed(0)));
    if (location.search.includes('trace')) { const ss = WW.FlyingBoat.prototype.setState; WW.FlyingBoat.prototype.setState = function (st) { if (st !== this.state && this.mission === 'rescue') L.push(WW.game.roundTime.toFixed(0) + ' dumbo ' + this.state + '->' + st + ' hold ' + this.holdT.toFixed(0) + ' safe ' + (this.task ? this.safe(this.task) + ' dps ' + WW.threat.danger('USN', this.task.x, this.task.z).toFixed(1) + ' air ' + WW.threat.danger('USN', this.task.x, this.task.z, { air: true }).toFixed(1) + ' ftr ' + WW.flyingBoats.fighterNear('USN', this.task.x, this.task.z, 150).toFixed(0) : 'notask')); return ss.call(this, st); }; }
  });
  return p;
}
function runRound(p, seed) {
  return p.evaluate(seed => {
    const G = WW.game; if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0; window.__fbLog.length = 0;
    G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
    let t = 0, snap = null, eg = null, I = null, maxUp = { USN: 0, IJN: 0 };
    while (G.state === 'battle' && t < WW.cfg.ROUND_TIMEOUT + 180) {
      __sim.fastForward(1); t++;
      for (const n of ['USN', 'IJN']) maxUp[n] = Math.max(maxUp[n], WW.world.planes.filter(q => q.kind === 'flyingboat' && q.alive && q.nation === n).length);
      if (G.state === 'battle') { snap = JSON.parse(JSON.stringify(WW.flyingBoats.stats)); eg = WW.endgame && JSON.parse(JSON.stringify(WW.endgame.stats)); I = Object.assign({}, WW.intel.stats); }
    }
    return { seed, winner: G.winner, len: +G.roundTime.toFixed(0), fb: snap, eg, intel: I, maxUp, log: window.__fbLog.slice(0, 60) };
  }, seed);
}
(async () => {
  const b = await HL.launch(chromium), pages = [];
  for (let i = 0; i < Math.min(PAGES, N); i++) pages.push(await openPage(b));
  const seeds = []; for (let i = 0; i < N; i++) seeds.push(SEED0 + i);
  const out = []; let next = 0;
  await Promise.all(pages.map(async p => { while (next < seeds.length) { const s = seeds[next++]; out.push(await runRound(p, s)); } }));
  out.sort((a, b) => a.seed - b.seed);
  const tot = {};
  const add = (k, v) => { tot[k] = (tot[k] || 0) + (v || 0); };
  for (const r of out) {
    const f = r.fb, I = r.intel;
    console.log(`seed ${r.seed}  ${r.winner || 'draw'} ${r.len}s  dumbo sent ${f.dispatched} landed ${f.landed} rescues ${f.rescues} survivors ${f.survivors} (aircrew ${f.pilots}) catLost ${f.catLost} waited ${f.waited} aborted ${f.aborted}` +
      `  | patrols U${f.patrols.USN}/I${f.patrols.IJN} sight U${f.sightings.USN}/I${f.sightings.IJN} lost U${f.lost.USN}/I${f.lost.IJN} home U${f.home.USN}/I${f.home.IJN} shadow U${f.shadowT.USN.toFixed(0)}/I${f.shadowT.IJN.toFixed(0)}s bombs ${f.bombs.IJN} hits ${f.bombHits.IJN || 0}` +
      `  | reports ${I.reports} misid ${I.misid} resolved ${I.resolved} wrongStrikes ${I.wrongStrikes} redirected ${I.wrongRedirects}  maxUp U${r.maxUp.USN}/I${r.maxUp.IJN}  | eg USN rescues ${r.eg ? r.eg.rescues.USN : '-'} surv ${r.eg ? r.eg.survivors.USN : '-'} lost ${r.eg ? r.eg.lost.USN : '-'}`);
    if (LOG) console.log('   ' + r.log.join('\n   '));
    for (const k of ['dispatched', 'landed', 'rescues', 'survivors', 'pilots', 'catLost', 'aborted']) add(k, f[k]);
    for (const n of ['USN', 'IJN']) { add('patrols' + n, f.patrols[n]); add('sight' + n, f.sightings[n]); add('lost' + n, f.lost[n]); }
    add('misid', I.misid); add('wrongStrikes', I.wrongStrikes); add('reports', I.reports); add('usnWins', r.winner === 'USN' ? 1 : 0);
  }
  const n = out.length, per = k => ((tot[k] || 0) / n).toFixed(2);
  console.log(`\nper round over ${n}: rescues ${per('rescues')} survivors ${per('survivors')} (aircrew ${per('pilots')}) Catalinas sent ${per('dispatched')} lost(rescue) ${per('catLost')} aborted ${per('aborted')}`);
  console.log(`  patrols USN ${per('patrolsUSN')} IJN ${per('patrolsIJN')}  sightings USN ${per('sightUSN')} IJN ${per('sightIJN')}  patrol-boat losses USN ${per('lostUSN')} IJN ${per('lostIJN')} (all flying boats)`);
  console.log(`  reports ${per('reports')} misidentifications ${per('misid')} strikes on bad reports ${per('wrongStrikes')}   USN wins ${tot.usnWins}/${n}`);
  console.log(errs.length ? 'ERRORS ' + errs.length + '\n' + errs.slice(0, 8).join('\n') : 'errors 0');
  await b.close();
})();
