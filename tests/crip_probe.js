// Cripple episodes in one lone_cripple round (diagnosis of crip_away): each ship under CRIP_HP, its first CRIP_WIN s,
// share of samples moving away from the nearest enemy ship, and what it was doing. Usage: node tests/crip_probe.js <checkout> <seed>
const path = process.argv[2] + '/tests/';
const HL = require(path + 'headless'), SB = require(path + 'sim_behaviour');
(async () => {
  const b = await HL.launch(), p = await b.newPage();
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(HL.settle());
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sc = SB.SCEN.find(s => s.name === 'lone_cripple'), seed = +process.argv[3];
  const spec = { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: sc.cripple === undefined ? -1 : sc.cripple, noStall: !!sc.noStall, base: sc.base || null };
  const out = await p.evaluate(([spec, P]) => {
    const E = {}; let next = 0;
    const U0 = WW.air.update;
    WW.air.update = function () { const r = U0.apply(this, arguments); const t = WW.game.roundTime; if (t >= next) { next += 0.5;
      for (const s of WW.world.ships) { if (!s.alive || s.isBase || s.type === 'submarine' || s.hp >= P.CRIP_HP * s.maxHp) continue;
        const c = E[s.id] || (E[s.id] = { id: s.id, type: s.type, n: s.nation, t0: t, k: 0, away: 0, why: {} });
        if (t - c.t0 > P.CRIP_WIN) continue;
        let nn = null, nd = 1e9; for (const o of WW.world.ships) if (o.alive && !o.isBase && o.nation !== s.nation && !o.submerged) { const d = WW.dist(s.x, s.z, o.x, o.z); if (d < nd) { nd = d; nn = o; } }
        if (!nn) continue; c.k++;
        const aw = s.speed > 0.2 && Math.cos(WW.angleDiff(s.heading, Math.atan2(nn.z - s.z, nn.x - s.x))) < 0; if (aw) c.away++;
        const tag = (s.speed <= 0.2 ? 'stopped' : aw ? 'away' : 'toward') + ' tgt=' + (s.target ? s.target.type : '-') + ' near=' + nn.type + '@' + Math.round(nd) + ' spd' + s.speed.toFixed(1) + ' hp' + (s.hp / s.maxHp).toFixed(2) + ' role=' + (s.ai && (s.ai.role || s.ai.mode) || '-') + ' cr=' + !!s.__beCripple;
        if (c.k % 6 === 1) c.why[t.toFixed(0)] = tag;
      } } return r; };
    window.__beh.run(spec);
    return Object.values(E);
  }, [spec, SB.P]);
  for (const c of out) console.log(`${c.n} ${c.type}#${c.id} t0=${c.t0.toFixed(0)} away ${c.away}/${c.k}  ` + Object.entries(c.why).map(([t, w]) => t + ':' + w).join(' | '));
  await b.close();
})();
