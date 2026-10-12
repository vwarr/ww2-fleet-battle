// Probe for sanity S8c (ships circling in place): which helm mode a circling ship was in. Rides the behaviour rounds
// with the auditor's S8c rule, wraps the station-keeping calls (fleet_formation.js ringKeep / guideKeep) to stamp the
// mode, and on every sample where the ship has steamed > 6 L with < 2 L net in 60 s (S8c's test, a known enemy
// within 600 u) adds the window's samples to a per-mode tally: ring / guide (formation keeping), evade (air
// evasion), withdraw, target (fighting), other (role's own steering). Read-only apart from the wrappers (which call
// through unchanged), so rounds replay as without it.
// Usage: node tests/ships2_probe.js [--seeds N=4] [--only scen,..]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const SR = require('./sanity_rules');
const SAN = require('./sanity');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 4), ONLY = arg('--only', null);

function probe() {
  const F = WW.formation, T = window.__p2 = { mode: {}, ep: {}, ex: [] }, H = new WeakMap(), ON = new WeakMap();
  ['ringKeep', 'guideKeep'].forEach(k => { const f = F[k]; F[k] = function (s) { const r = f.apply(this, arguments); if (r) { s.__km = k === 'ringKeep' ? 'ring' : 'guide'; s.__kt = WW.time.now; } return r; }; });
  T.spread = {};   // ship torpedo spreads by launcher > target type (Fable F1: destroyers vs carriers / battleships)
  const tf = WW.supply.torpFired;
  WW.supply.torpFired = function (s) { const t = s.target, k = s.type[0].toUpperCase() + '>' + (t ? t.type : '-'); T.spread[k] = (T.spread[k] || 0) + 1; return tf.apply(this, arguments); };
  const S = window.__san, smp = S.sample;
  S.sample = function () {
    const r = smp.apply(this, arguments), t = WW.time.now;
    for (const s of WW.world.ships) {
      if (!s.alive || s.sinking || s.type === 'submarine') continue;
      const a = s.ai || {}, m = a.airEv ? 'evade' : a.withdrawing ? 'withdraw' : s.__kt > t - 0.2 ? s.__km : s.target ? 'target' : 'other';
      const q = H.get(s) || (H.set(s, []), H.get(s));
      q.push([t, s.x, s.z, m]); while (q.length && t - q[0][0] > 60) q.shift();
      if (q.length < 100) continue;
      let path = 0; for (let i = 1; i < q.length; i++) path += Math.hypot(q[i][1] - q[i - 1][1], q[i][2] - q[i - 1][2]);
      const L = s.stats.length, net = Math.hypot(s.x - q[0][1], s.z - q[0][2]);
      const mid = WW.world.ships.some(o => o.alive && !o.sinking && o.nation !== s.nation && (!WW.intel || WW.intel.visible(s.nation, o, 30)) && Math.hypot(o.x - s.x, o.z - s.z) < 600);
      if (net < 2 * L && path > 6 * L && mid) {
        const c = {}; q.forEach(e => { c[e[3]] = (c[e[3]] || 0) + 1; });
        const dom = Object.keys(c).sort((x, y) => c[y] - c[x])[0];
        for (const k in c) T.mode[k] = (T.mode[k] || 0) + c[k] / q.length * 0.5;
        if (!ON.get(s)) { ON.set(s, true); T.ep[dom] = (T.ep[dom] || 0) + 1; if (T.ex.length < 40) T.ex.push(`${s.nation}:${s.type}#${s.id} t=${t.toFixed(0)} ${dom} ${JSON.stringify(c)}`); }
      } else ON.set(s, false);
    }
    return r;
  };
}

(async () => {
  const b = await HL.launch(), pages = [];
  const specs = []; for (let i = 1; i <= SEEDS; i++) specs.push(...SAN.specsFor(i).filter(s => !ONLY || ONLY.split(',').includes(s.scen)));
  for (let w = 0; w < HL.WORKERS; w++) {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(SR.install, SR.P); await p.evaluate(probe);
    pages.push(p);
  }
  let next = 0;
  await Promise.all(pages.map(async p => { while (next < specs.length) { const s = specs[next++]; await p.evaluate(sp => window.__beh.run(sp), Object.assign({}, s, { san: ['S8c'] })); } }));
  const tot = { mode: {}, ep: {}, ex: [], spread: {} };
  for (const p of pages) { const r = await p.evaluate(() => window.__p2); for (const k in r.spread) tot.spread[k] = (tot.spread[k] || 0) + r.spread[k]; for (const k in r.mode) tot.mode[k] = (tot.mode[k] || 0) + r.mode[k]; for (const k in r.ep) tot.ep[k] = (tot.ep[k] || 0) + r.ep[k]; tot.ex.push(...r.ex); }
  const n = specs.length;
  console.log(`${n} rounds. circling s / round by helm mode:`, Object.fromEntries(Object.entries(tot.mode).map(([k, v]) => [k, +(v / n).toFixed(1)])));
  console.log('circling episodes / round by dominant mode:', Object.fromEntries(Object.entries(tot.ep).map(([k, v]) => [k, +(v / n).toFixed(2)])));
  console.log('ship torpedo spreads / round by launcher > target:', Object.fromEntries(Object.entries(tot.spread).sort().map(([k, v]) => [k, +(v / n).toFixed(2)])));
  console.log(tot.ex.slice(0, 25).join('\n'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
