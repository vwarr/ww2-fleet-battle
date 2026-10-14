// Base planes leaving a closed field (read-only recorder, apart from the forced runway closure of --close).
// Per round: when each island-base plane gives up holding (the time, its hold time, its fuel), whether it diverted to
// a carrier or ditched, landings after dark, and any crash on a friendly ship by a plane that was ditching / leaving.
// Usage: node tests/mass_ditch_probe.js [--only midway,ijnbase] [--seeds N=4] [--seed0 S=1] [--tod dusk|<sunset s>]
//        [--close T: from T s, both runways held closed for CLOSE_FOR s] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 4), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,ijnbase').split(',');
const TOD = arg('--tod', null), CLOSE = +arg('--close', -1), CLOSE_FOR = +arg('--close-for', 260);
const SC = {
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};
const spec = (sc, seed) => ({ seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN, base: SC[sc].base, cripple: -1, noStall: false, light: true, scen: sc,
  tod: TOD === null ? undefined : isNaN(+TOD) ? TOD : +TOD });

function install(o) {
  const R = window.__md = {};
  let S;
  const fresh = () => { S = { leave: [], divert: 0, ditch: 0, shipHit: 0, shipDmg: 0, darkLand: 0, landed: 0, holdMax: 0 }; };
  fresh(); WW.on('roundStart', fresh);
  WW.on('planeCrash', e => {
    const p = e.plane;
    if (e.on === 'ship' && e.ship && p && e.ship.nation === p.nation && (p.leaveT || p.ditchTo || p.state === 'ditch' || p.deathMode === 'ditch')) { S.shipHit++; S.shipDmg += e.dmg || 0; }
  });
  const seen = new WeakSet(), U0 = WW.air.update;
  WW.air.update = function () {
    const B = WW.islandBase && WW.islandBase.base, t = WW.game && WW.game.roundTime;
    if (B && o.close >= 0 && t >= o.close && t < o.close + o.closeFor) for (const r of B.runways) r.closed = true;
    const r0 = U0.apply(this, arguments);
    if (B && WW.game.state === 'battle') {
      for (const p of WW.world.planes) {
        if (p.carrier !== B && !(p.leaveT && p.nation === B.nation)) continue;
        if (p.state === 'landing') S.holdMax = Math.max(S.holdMax, p.holdT || 0);
        if (p.leaveT && !seen.has(p)) {
          seen.add(p);
          const f0 = p.pt.range / p.pt.speed * 6;
          S.leave.push({ t: +t.toFixed(1), v: p.variant || p.kind, hold: +(p.holdT || 0).toFixed(0), fuel: +(p.fuel / f0).toFixed(2), to: p.carrier !== B ? 'cv' : 'ditch', nz: B.neutralized ? 'N' : '' });
        }
      }
    }
    return r0;
  };
  const L = WW.landAir && WW.landAir.stats;
  let land0 = 0;
  WW.on('roundStart', () => { land0 = L ? L.landings : 0; });
  const U1 = WW.air.update;
  WW.air.update = function () {
    const before = L ? L.landings : 0, r = U1.apply(this, arguments);
    if (L && L.landings > before) { S.landed += L.landings - before; if (WW.daylight !== undefined && WW.daylight < 0.5) S.darkLand += L.landings - before; }
    return r;
  };
  R.flush = () => { const out = Object.assign({}, S, { ditched: L ? L.ditched : 0, diverted: L ? L.diverted : 0, ai: WW.airImpact ? Object.assign({}, WW.airImpact.stats) : {} }); fresh(); return out; };
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
    await p.evaluate(SB.install, SB.P); await p.evaluate(install, { close: CLOSE, closeFor: CLOSE_FOR });
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { window.__beh.run(sp); return window.__md.flush(); }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  for (const r of res) {
    const ts = r.leave.map(l => l.t), spread = ts.length ? (Math.max(...ts) - Math.min(...ts)).toFixed(0) : '-';
    console.log(`${r.scen} s${r.seed}: left ${r.leave.length} (spread ${spread} s) divert ${r.diverted} ditch ${r.ditched} | friendly ship hits by ditchers ${r.shipHit} (${r.shipDmg.toFixed(0)} dmg) | landed ${r.landed}, after dark ${r.darkLand} | max hold ${r.holdMax.toFixed(0)} s`);
    if (r.leave.length) console.log('   ' + r.leave.map(l => `${l.t}:${l.v}/h${l.hold}/f${l.fuel}${l.nz}`).join(' '));
  }
})();
