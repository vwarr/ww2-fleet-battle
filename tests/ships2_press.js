// Probe (Fable F26): a pressing side held at the enemy's home band. Every 1 s per gun ship (BB / CA / DD, fit, not
// withdrawing) of a side in posture 'press': 'held' when it has no target in its gun range and every known enemy
// surface ship (contact <= 60 s, not a carrier / sub / base) lies inside the enemy's home band (|x - its edge| <
// HOME_K x W) or within CV_LAIR of a known enemy carrier: the press has nothing it is allowed to close on.
// Also: time in 'press', and rounds that end undecided while a side presses.
// Usage: node tests/ships2_press.js [--seeds N=8] [--only standard,mirror,..]
'use strict';
const HL = require('./headless'), SB = require('./sim_behaviour'), SAN = require('./sanity');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), ONLY = arg('--only', 'standard,mirror,battle_line,midway,carrier_vs_surface,weather').split(',');
function rec() {
  const R = window.__pr = { held: 0, press: 0, rounds: 0, drawPress: 0, heldR: 0 };
  let next = 0, cur = null;
  const orig = WW.ships.update;
  WW.ships.update = function () {
    const r = orig.apply(this, arguments), t = WW.game.roundTime;
    if (t < next) return r;
    next = Math.floor(t) + 1;
    const W = WW.cfg.MAP_W, now = WW.time.now;
    for (const n of ['USN', 'IJN']) {
      const B = WW.fleetCmd.side(n); if (!B || B.posture !== 'press') continue;
      R.press++; cur && (cur[n] = true);
      const foeHome = n === 'USN' ? W : 0, cs = WW.intel.enemyShips(n).filter(c => c.unit && c.unit.alive && now - c.seenAt <= 60);
      const cvs = cs.filter(c => c.unit.type === 'carrier'), sf = cs.filter(c => !c.unit.isBase && c.unit.type !== 'carrier' && c.unit.type !== 'submarine');
      if (!sf.length) continue;
      const allBarred = sf.every(c => Math.abs(c.x - foeHome) < W * 0.35 || cvs.some(k => Math.hypot(k.x - c.x, k.z - c.z) < 230));
      if (!allBarred) continue;
      for (const s of WW.world.ships) {
        if (!s.alive || s.sinking || s.nation !== n || !(s.type === 'battleship' || s.type === 'cruiser' || s.type === 'destroyer') || s.ai.withdrawing) continue;
        const g = s.stats.guns[0], tg = s.target;
        if (tg && tg.alive && Math.hypot(tg.x - s.x, tg.z - s.z) <= (g ? g.range : 60)) continue;
        R.held++; R.heldR = 1;
      }
    }
    return r;
  };
  window.__prBegin = () => { cur = {}; R.heldR = 0; };
  window.__prEnd = (winner) => { R.rounds++; if (!winner && cur && (cur.USN || cur.IJN)) R.drawPress++; R.heldRounds = (R.heldRounds || 0) + R.heldR; };
}
(async () => {
  const b = await HL.launch(), pages = [];
  const specs = []; for (let i = 1; i <= SEEDS; i++) specs.push(...SAN.specsFor(i).filter(s => ONLY.includes(s.scen)));
  for (let w = 0; w < HL.WORKERS; w++) {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(rec); pages.push(p);
  }
  let next = 0;
  await Promise.all(pages.map(async p => { while (next < specs.length) { const s = specs[next++]; await p.evaluate(sp => { __prBegin(); const r = window.__beh.run(sp); __prEnd(r.winner); }, Object.assign({}, s, { san: false })); } }));
  const T = { held: 0, press: 0, rounds: 0, drawPress: 0, heldRounds: 0 };
  for (const p of pages) { const r = await p.evaluate(() => window.__pr); for (const k in T) T[k] += r[k] || 0; }
  console.log(`${T.rounds} rounds: press side-s / round ${(T.press / T.rounds).toFixed(1)}; gun-ship-s held at the home band / lair per round ${(T.held / T.rounds).toFixed(1)} (in ${T.heldRounds} rounds); undecided rounds with a press ${T.drawPress}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
