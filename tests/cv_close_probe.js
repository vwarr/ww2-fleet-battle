// Carrier closest approach to an enemy battleship / cruiser / destroyer in one midway round, per second (diagnosis).
// Usage: node tests/cv_close_probe.js <checkout dir> <seed>
const path = process.argv[2] + '/tests/';
const HL = require(path + 'headless'), SB = require(path + 'sim_behaviour');
(async () => {
  const b = await HL.launch(), p = await b.newPage();
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(HL.settle());
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sc = SB.SCEN.find(s => s.name === 'midway'), seed = +process.argv[3];
  const spec = { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: sc.cripple === undefined ? -1 : sc.cripple, noStall: !!sc.noStall, base: sc.base || null };
  const out = await p.evaluate(spec => {
    const L = []; let next = 0, best = { d: 1e9 };
    const U0 = WW.air.update;
    WW.air.update = function () { const r = U0.apply(this, arguments); const t = WW.game.roundTime; if (t >= next) { next += 1;
      for (const s of WW.world.ships) { if (!s.alive || s.sinking || s.type !== 'carrier' || s.isBase) continue;
        let dm = 1e9, o0 = null; for (const o of WW.world.ships) { if (!o.alive || o.sinking || o.nation === s.nation || (o.type !== 'battleship' && o.type !== 'cruiser' && o.type !== 'destroyer')) continue; const d = WW.dist(s.x, s.z, o.x, o.z); if (o.type === 'destroyer' && !(o.target === s || ((!o.target || WW.dist(o.target.x, o.target.z, s.x, s.z) < 80) && Math.abs(WW.angleDiff(o.heading, Math.atan2(s.z - o.z, s.x - o.x))) < 0.52) || (s.speed > 0.5 && Math.abs(WW.angleDiff(s.heading, Math.atan2(o.z - s.z, o.x - s.x))) < Math.PI / 2))) continue; if (d < dm) { dm = d; o0 = o; } }   // the suite's cv_min_dist rule
        if (!o0) continue;
        const FS = WW.fleetCmd.side(s.nation), brg = Math.atan2(o0.z - s.z, o0.x - s.x), toward = Math.abs(WW.angleDiff(s.heading, brg)) < 1.2;
        const known = WW.intel.known(s.nation, o0);
        const row = `t=${t.toFixed(0)} ${s.nation} cv#${s.id} hp ${(s.hp / s.maxHp).toFixed(2)} spd ${s.speed.toFixed(1)} -> ${o0.type}#${o0.id} d=${dm.toFixed(0)} toward=${toward} known=${!!known} broken=${!!(FS && FS.brokenAt)} posture=${FS && FS.posture} role=${s.ai && s.ai.role || ''} o.target=${o0.target ? o0.target.type : '-'} o.spd ${o0.speed.toFixed(1)} cvhdg-away ${(Math.abs(WW.angleDiff(s.heading, brg + Math.PI))).toFixed(2)} thrD ${s.ai && s.ai.thrT === WW.time.now ? s.ai.thrD.toFixed(0) : '-'} throttle ${s.throttle}`;
        if (dm < 160) L.push(row); if (dm < best.d) best = { d: dm, row };
      } } return r; };
    window.__beh.run(spec);
    return { L: L.filter(r => +r.match(/d=(\d+)/)[1] < 140), best };
  }, spec);
  console.log('closest: ' + out.best.row); console.log(out.L.join('\n')); await b.close();
})();
