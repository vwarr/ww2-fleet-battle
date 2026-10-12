// Fable audit screenshots (render mode; BASE_URL and CHROMIUM as for the other render tests). Replays a probe round
// (tests/fable_probe.js scenarios, by name and seed: the suite's own placement, so the round is the probe's) up to t,
// films the ship with the given id (an orbit shot) and saves a few frames, plus a wide shot. Read-only: nothing in
// the sim is changed; the round is stopped at t by a trap in __sim.fastForward (the suite's run() has no step hook).
// Usage: node tests/fable_shots.js SEED T SHIP_ID [tag] [width=90] [outdir=docs/fable_audit] [--scen standard]
const { chromium } = require('playwright');
const path = require('path');
const SB = require('./sim_behaviour');
const A = process.argv.slice(2), si = A.indexOf('--scen'), scen = si >= 0 ? A[si + 1] : 'standard', args = A.filter((a, i) => i !== si && i !== si + 1);
const [seed, T, shipId, tag = 'shot', width = '90', out = path.join(__dirname, '..', 'docs', 'fable_audit')] = args;
require('fs').mkdirSync(out, { recursive: true });
const rep = (t, n) => Array(n).fill(t);
const SCEN = { // as tests/fable_probe.js
  standard: { random: true }, standard_dusk: { random: true, tod: 'dusk' }, standard_night: { random: true, tod: 'night' }, standard_weather: { random: true, wx: 'line' },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], base: 'IJN', aFixed: 'USN' },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  surface: { A: ['battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)], B: ['battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)] },
  pt_vs_bb: { A: ['pt', 'pt'], B: ['battleship', 'cruiser'] }, asw: { A: ['destroyer', 'destroyer', 'cruiser'], B: ['submarine', 'submarine', 'cruiser'] },
  bb4_vs_bb4: { A: rep('battleship', 4), B: rep('battleship', 4) }, cv2_vs_cv2: { A: rep('carrier', 2), B: rep('carrier', 2) },
  sub_vs_cv: { A: rep('submarine', 4), B: rep('carrier', 2) }, pt_vs_pt: { A: rep('pt', 8), B: rep('pt', 8) }, ss_vs_ss: { A: rep('submarine', 3), B: rep('submarine', 3) }, cv_vs_bb: { A: ['carrier'], B: ['battleship'] }
};
(async () => {
  const sc = SCEN[scen]; if (!sc) { console.log('no scenario ' + scen); process.exit(1); }
  const sd = +seed, spec = sc.random ? { seed: sd, random: true, light: true } : { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  if (sc.tod) spec.tod = sc.tod; if (sc.wx) spec.wx = sc.wx;
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1024, height: 576 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now(), { timeout: 120000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 120000 });
  await p.waitForTimeout(2000);
  await p.evaluate(SB.install, SB.P);
  // run the probe's round until t: the trap throws out of __beh.run, which leaves the sim standing at t
  await p.evaluate(({ spec, T }) => {
    __sim.setScale(0.1); WW.game.mode = 'auto';
    const ff = __sim.fastForward; window.__ffT = T;
    __sim.fastForward = function (s, cb) { if (WW.game.roundTime >= window.__ffT) { __sim.fastForward = ff; throw new Error('STOP_AT_T'); } return ff.call(this, s, cb); };
    try { window.__beh.run(spec); } catch (e) { if (String(e.message) !== 'STOP_AT_T') throw e; }
  }, { spec, T: +T });
  const info = await p.evaluate(({ shipId, width }) => {
    const G = WW.game, s = WW.world.ships.find(q => q.id === shipId);
    if (!s) return { err: 'no ship ' + shipId, t: G.roundTime, ships: WW.world.ships.map(q => q.id + ':' + q.nation + ' ' + q.type + ' ' + (q.name || '')) };
    const near = WW.world.ships.filter(q => q !== s && q.alive && WW.dist(q.x, q.z, s.x, s.z) < 200).map(q => `${q.nation} ${q.type} ${q.name || ''} #${q.id} d${WW.dist(q.x, q.z, s.x, s.z).toFixed(0)}${q === s.target ? ' <TARGET' : ''}`);
    const o = WW.fleetCmd.order(s), B = WW.fleetCmd.side(s.nation);
    if (WW.cam.film) WW.cam.film({ kind: 'orbit', subj: s, r: width * 0.55, dur: 40, w: 0.05 }); else __sim.focus(s.x, s.z, width, 40);
    return { t: +G.roundTime.toFixed(1), daylight: +(WW.daylight || 1).toFixed(2), who: `${s.nation} ${s.type} ${s.name || ''} #${s.id}`, hp: +(s.hp / s.maxHp).toFixed(2), speed: +s.speed.toFixed(1), throttle: +s.throttle.toFixed(2), heading: +s.heading.toFixed(2), submerged: !!s.submerged,
      target: s.target ? `${s.target.nation} ${s.target.type} ${s.target.name || ''} #${s.target.id} d${WW.dist(s.x, s.z, s.target.x, s.target.z).toFixed(0)}` : null,
      order: o ? { role: o.role, group: o.group } : null, posture: B && B.posture, broken: !!(B && B.brokenAt), near, x: +s.x.toFixed(0), z: +s.z.toFixed(0) };
  }, { shipId: +shipId, width: +width });
  console.log(JSON.stringify(info, null, 1));
  if (!info.err) {
    for (let i = 0; i < 3; i++) { await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/${tag}_${seed}_${T}_${i}.jpg`, type: 'jpeg', quality: 75, timeout: 180000 }); await p.evaluate(() => __sim.fastForward(4)); }
    await p.evaluate(({ shipId, width }) => { const s = WW.world.ships.find(q => q.id === shipId); if (s) __sim.focus(s.x, s.z, width * 3, 40); }, { shipId: +shipId, width: +width });
    await p.waitForTimeout(2000); await p.screenshot({ path: `${out}/${tag}_${seed}_${T}_wide.jpg`, type: 'jpeg', quality: 75, timeout: 180000 });
  }
  await b.close();
})();
