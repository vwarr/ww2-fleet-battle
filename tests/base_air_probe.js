// Base air defence and climb-out probe (read-only recorder: no WW.rand, no writes to sim objects).
// (a) climb-out: an enemy bomber climbing out from its field or deck (state takeoff in the air, or transit below 22 u
//     within 200 u of its base / carrier and climbing): bomber-seconds with an enemy fighter within 120 u, and how many
//     of those had a fighter on it (foe); fighter-seconds within 120 u of such a bomber with no foe at all (flying by).
// (b) overflight: enemy plane-seconds in the air within 150 u of an island base, and the share engaged by the base
//     (its AA fired at that plane in the last 3 s, or a fighter of the base's side has it as its foe), by kind.
// Usage: node tests/base_air_probe.js [--only midway,bbbase,ijnbase,standard] [--seeds N=10] [--seed0 S=1] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 10), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,bbbase,ijnbase,standard').split(',');
const SC = {
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' },
  bbbase: { A: ['battleship', 'battleship', 'cruiser', 'destroyer'], B: ['destroyer', 'destroyer'], aN: 'IJN', base: 'USN' }
};
const spec = (sc, seed) => sc === 'standard' ? { seed, random: true, light: true, scen: sc } : { seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN, base: SC[sc].base, cripple: -1, noStall: false, light: true, scen: sc };

function install() {
  const R = window.__ba = {};
  let S = null, next = 0;
  const fresh = () => { S = { aa: new Map(), climbS: 0, climbNear: 0, climbEng: 0, fBy: 0, bNear: 0, bEng: 0, bBy: 0, bBusyF: 0, bBusyB: 0, ex: [], over: { fighter: [0, 0], bomber: [0, 0], other: [0, 0] }, overF: 0 }; next = 0; };
  fresh(); WW.on('roundStart', fresh);
  const aaHit = e => { if (e && e.ship && (e.ship.isBase || e.ship.isBasePit) && e.target) S.aa.set(e.target, WW.game.roundTime); };
  WW.on('aaHeavyFired', aaHit); WW.on('aaLightFired', aaHit);
  const air = q => q.alive && !q.removed && q.y > 2 && q.state !== 'rollout' && q.state !== 'ditch' && !q.deathMode;
  const climbing = q => (q.kind === 'dive' || q.kind === 'torpedo') && air(q) && q.carrier && (q.state === 'takeoff' || (q.state === 'transit' && q.y < 22 && (q.vy || 0) > 0.3 && WW.dist(q.x, q.z, q.carrier.x, q.carrier.z) < 200));
  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += 0.5; sample(); }
    return r0;
  };
  function sample() {
    const t = WW.game.roundTime, P = WW.world.planes;
    const F = P.filter(q => q.kind === 'fighter' && air(q) && (q.state === 'transit' || q.state === 'attack' || q.state === 'return'));
    for (const b of P) {
      if (!climbing(b)) continue;
      S.climbS += 0.5;
      const near = F.filter(f => f.nation !== b.nation && WW.dist(f.x, f.z, b.x, b.z) < 120);
      if (!near.length) continue;
      S.climbNear += 0.5; const bs = b.carrier.isBase; if (bs) S.bNear += 0.5;
      if (near.some(f => f.foe === b)) { S.climbEng += 0.5; if (bs) S.bEng += 0.5; }
      if (bs) for (const f of near) { if (!f.foe) S.bBy += 0.5; else if (f.foe.kind === 'fighter') S.bBusyF += 0.5; else S.bBusyB += 0.5; }
      for (const f of near) if (!f.foe) { S.fBy += 0.5; if (S.ex.length < 6 && !S.ex.some(x => x.t > t - 10)) S.ex.push({ t: +t.toFixed(1), f: f.nation + ' ' + (f.target ? 'escort' : 'cap') + ' ' + f.state, b: b.nation + ' ' + b.kind + ' ' + b.state + ' y' + Math.round(b.y) + (b.carrier.isBase ? ' base' : ' cv'), d: Math.round(WW.dist(f.x, f.z, b.x, b.z)) }); }
    }
    const B = WW.islandBase && WW.islandBase.base;
    if (B && B.alive !== false) for (const q of P) {
      if (q.nation === B.nation || !air(q) || WW.dist(q.x, q.z, B.x, B.z) > 150) continue;
      const k = q.kind === 'fighter' ? 'fighter' : q.kind === 'dive' || q.kind === 'torpedo' ? 'bomber' : 'other';
      const eng = t - (S.aa.get(q) || -99) < 3 || P.some(f => f.alive && f.nation === B.nation && f.foe === q);
      S.over[k][0] += 0.5; if (eng) S.over[k][1] += 0.5;
    }
  }
  R.flush = () => { const o = { bNear: S.bNear, bEng: S.bEng, bBy: S.bBy, bBusyF: S.bBusyF, bBusyB: S.bBusyB, climbS: S.climbS, climbNear: S.climbNear, climbEng: S.climbEng, fBy: S.fBy, ex: S.ex, over: S.over }; fresh(); return o; };
}

(async () => {
  const list = []; for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(spec(sc, s));
  const b = await HL.launch(), res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(install);
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { window.__beh.run(sp); return window.__ba.flush(); }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  const pc = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '-';
  for (const sc of ONLY.concat(['ALL'])) {
    const L = sc === 'ALL' ? res : res.filter(r => r.scen === sc), N = L.length || 1, sum = k => L.reduce((s, r) => s + r[k], 0);
    const ov = k => [L.reduce((s, r) => s + r.over[k][0], 0), L.reduce((s, r) => s + r.over[k][1], 0)];
    const of = ov('fighter'), ob = ov('bomber');
    console.log(`${sc.padEnd(9)} FROM THE BASE: bomber-s with an enemy fighter within 120 ${(sum('bNear') / N).toFixed(1)}/rd, engaged ${pc(sum('bEng'), sum('bNear'))}; those fighters: no foe ${(sum('bBy') / N).toFixed(1)}, on a fighter ${(sum('bBusyF') / N).toFixed(1)}, on a bomber ${(sum('bBusyB') / N).toFixed(1)} fighter-s/rd`);
    console.log(`${sc.padEnd(9)} climb-out bomber-s ${(sum('climbS') / N).toFixed(1)}/rd, with an enemy fighter within 120: ${(sum('climbNear') / N).toFixed(1)}/rd, engaged ${pc(sum('climbEng'), sum('climbNear'))}; fighters flying by (no foe) ${(sum('fBy') / N).toFixed(1)} fighter-s/rd | over the field: enemy fighters ${(of[0] / N).toFixed(1)} s/rd engaged ${pc(of[1], of[0])}, bombers ${(ob[0] / N).toFixed(1)} s/rd engaged ${pc(ob[1], ob[0])}`);
  }
  console.log('fly-by examples: ' + res.flatMap(r => r.ex.map(e => `${r.scen}:${r.seed} t=${e.t} ${e.f} by ${e.b} at ${e.d}u`)).slice(0, 10).join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
