// Per-side ledger of the balance rounds (for reading a gate shift, not a gate): what each nation's ships took and
// what each nation's planes lost. Per side, per round: bombs / aerial torpedoes dropped at it and hits, ship damage
// taken by kind (bomb / torpedo / shell), ships sunk, its planes shot down by AA and by fighters. Read-only recorder.
// Usage: node tests/ships2_side.js [--seeds N=40] [--seed0 S=1]
'use strict';
const HL = require('./headless'), SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 40), SEED0 = +arg('--seed0', 1);
function rec() {
  const Z = () => ({ bombDrop: 0, bombHit: 0, torpDrop: 0, torpHit: 0, dmgBomb: 0, dmgTorp: 0, dmgShell: 0, sunk: 0, sunkCV: 0, lostAA: 0, lostFtr: 0, lostOther: 0, wins: 0, rounds: 0 });
  const T = window.__side = { USN: Z(), IJN: Z() }, dead = new WeakSet();
  WW.on('weaponDropped', e => { const p = e && (e.proj || e.plane), pl = e && e.plane, t = pl && pl.target; if (!pl || !t || !t.nation || !T[t.nation]) return; if (pl.kind === 'dive') T[t.nation].bombDrop++; else if (pl.kind === 'torpedo') T[t.nation].torpDrop++; });
  WW.on('weaponImpact', e => { const p = e && e.proj, s = e && e.ship; if (!p || !s || !T[s.nation] || p.src !== 'Air' && !(e.kind === 'bomb')) return; if (e.dud) return; if (e.kind === 'bomb') T[s.nation].bombHit++; else if (e.kind === 'torpedo' && p.src === 'Air') T[s.nation].torpHit++; });
  WW.on('shipHit', e => { const s = e && e.ship; if (!s || !T[s.nation]) return; const k = e.kind === 'bomb' ? 'dmgBomb' : e.kind === 'torpedo' ? 'dmgTorp' : e.kind === 'shell' ? 'dmgShell' : null; if (k) T[s.nation][k] += e.amount || 0; });
  WW.on('shipSunk', s => { if (s && T[s.nation]) { T[s.nation].sunk++; if (s.type === 'carrier') T[s.nation].sunkCV++; } });
  const orig = WW.air && WW.air.update;
  if (orig) WW.air.update = function () {
    const r = orig.apply(this, arguments);
    for (const p of WW.world.planes) if (p && !p.alive && !dead.has(p)) { dead.add(p); const k = p.killedBy; if (!T[p.nation] || p.ditched) continue; if (k && k.stats) T[p.nation].lostAA++; else if (k && k.kind) T[p.nation].lostFtr++; else T[p.nation].lostOther++; }
    return r;
  };
  window.__sideEnd = w => { for (const n of ['USN', 'IJN']) { T[n].rounds++; if (w === n) T[n].wins++; } };
}
(async () => {
  const b = await HL.launch(), pages = [];
  const specs = []; for (let i = 0; i < SEEDS; i++) specs.push({ seed: SEED0 + i, random: true, light: true });
  for (let w = 0; w < HL.WORKERS; w++) {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(rec); pages.push(p);
  }
  let next = 0;
  await Promise.all(pages.map(async p => { while (next < specs.length) { const s = specs[next++]; await p.evaluate(sp => { const r = window.__beh.run(sp); __sideEnd(r.winner); }, s); } }));
  const T = { USN: {}, IJN: {} };
  for (const p of pages) { const r = await p.evaluate(() => window.__side); for (const n in T) for (const k in r[n]) T[n][k] = (T[n][k] || 0) + r[n][k]; }
  const n = T.USN.rounds;
  console.log(`${n} rounds (per round; dmg in hp, the ships of that side TOOK it; lost = that side's planes)`);
  for (const k of Object.keys(T.USN)) if (k !== 'rounds') console.log(k.padEnd(10), 'USN', (T.USN[k] / n).toFixed(2).padStart(8), '  IJN', (T.IJN[k] / n).toFixed(2).padStart(8));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
