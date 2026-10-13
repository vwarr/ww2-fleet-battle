// What the island base's bombers attack (read-only recorder: no WW.rand, no writes to sim objects).
// Per scenario: every weapon a base plane drops (weaponDropped, plane.carrier.isBase) by target type x weapon
// (torpedo / dive bomb / level bomb), base strikes launched by target type (baseEvent strikeOut; def = self-defence
// strikes, land_air.js defTarget), and base hits on ships by type. The *_pt scenarios add PT boats to the side the
// base fights (the user's case: B-26 torpedoes on PT boats off Midway).
// Usage: node tests/land_target_probe.js [--only midway,midway_pt,ijnbase_pt] [--seeds N=8] [--seed0 S=1] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,midway_pt,ijnbase_pt').split(',');
const MW = SB.SCEN.find(s => s.name === 'midway');
const SC = {
  midway: { A: MW.A, B: MW.B, aN: 'USN', base: 'USN' },
  midway_pt: { A: MW.A, B: MW.B.concat(['pt', 'pt', 'pt']), aN: 'USN', base: 'USN' },
  ijnbase_pt: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'pt'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};
const spec = (sc, seed) => ({ seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN, base: SC[sc].base, cripple: -1, noStall: false, light: true, scen: sc });

function install() {
  const R = window.__lt = {};
  let S = null;
  const fresh = () => { S = { drop: {}, strike: {}, def: {}, hit: {} }; };
  fresh(); WW.on('roundStart', fresh);
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const ty = u => !u ? 'none' : u.isBase ? 'base' : u.type;
  const mine = new WeakSet();
  WW.on('weaponDropped', e => {
    const p = e && e.plane; if (!p || !p.carrier || !p.carrier.isBase) return;
    mine.add(e.proj);
    const w = e.kind === 'torpedo' ? 'torp' : p.level ? 'level' : 'dive';
    const tt = e.target || p.target; inc(S.drop, ty(tt) + '|' + w);
    if (tt && tt.type === 'destroyer') { // a destroyer with a bigger ship known within the base's strike reach (560) of the plane: the last-resort rule broken
      let bg = false; for (const c of WW.intel.enemyShips(p.nation, { fresh: 45 })) if (c.unit && c.unit.alive && !c.unit.sinking && /carrier|battleship|cruiser/.test(c.unit.type) && WW.dist(c.x, c.z, p.x, p.z) < 560) bg = true;
      if (bg) inc(S.drop, 'ddBig|' + w);
    }
  });
  WW.on('weaponImpact', e => { if (e && e.proj && mine.has(e.proj)) { mine.delete(e.proj); if (e.ship) inc(S.hit, ty(e.ship)); } });
  WW.on('baseEvent', e => { if (e && e.kind === 'strikeOut') { inc(S.strike, ty(e.target)); if (e.base.ai && e.target === e.base.ai.defFor) inc(S.def, ty(e.target)); } });
  R.flush = () => { const o = S; fresh(); return o; };
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
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { window.__beh.run(sp); return window.__lt.flush(); }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  const T = ['carrier', 'battleship', 'cruiser', 'destroyer', 'ddBig', 'pt', 'submarine', 'none'], W = ['torp', 'dive', 'level'];
  const add = (L, k) => { const o = {}; for (const r of L) for (const x in r[k]) o[x] = (o[x] || 0) + r[k][x]; return o; };
  for (const sc of ONLY.concat(ONLY.length > 1 ? ['ALL'] : [])) {
    const L = sc === 'ALL' ? res : res.filter(r => r.scen === sc), D = add(L, 'drop'), St = add(L, 'strike'), Df = add(L, 'def'), H = add(L, 'hit');
    console.log(`\n${sc} (${L.length} rounds) base-plane drops by target x weapon:`);
    console.log('  ' + 'target'.padEnd(11) + W.map(w => w.padStart(7)).join('') + '   strikes(def)   hits');
    for (const t of T) {
      const row = W.map(w => D[t + '|' + w] || 0);
      if (!row.some(Boolean) && !St[t] && !H[t]) continue;
      console.log('  ' + t.padEnd(11) + row.map(n => String(n).padStart(7)).join('') + `   ${String(St[t] || 0).padStart(4)}(${Df[t] || 0})`.padEnd(15) + String(H[t] || 0).padStart(4));
    }
  }
})();
