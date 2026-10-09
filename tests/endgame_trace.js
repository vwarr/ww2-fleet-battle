// One round's endgame, printed (diagnosis, read-only): every STEP s from FROM, each side's posture / break / pursuit
// and each ship: type, hp, position, speed, its commander's role, its nearest enemy (true distance, and the age of
// its own side's contact on it), carriers' planes aboard + up, the side's strike order. For the examples of
// tests/endgame_survey.js. Usage: node tests/endgame_trace.js SCEN SEED [STEP=15] [FROM=0]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const [scen = 'carrier_duel', seed = '1', step = '15', from = '0'] = HL.argv;
const rep = (t, n) => Array(n).fill(t);
const SC = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  cv2_vs_cv2: { A: rep('carrier', 2), B: rep('carrier', 2) },
  pt_vs_pt: { A: rep('pt', 8), B: rep('pt', 8) },
  pt_vs_bb: { A: ['pt', 'pt'], B: ['battleship', 'cruiser'] },
  cv_vs_pt: { A: rep('carrier', 3), B: rep('pt', 10) },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], base: 'IJN', aFixed: 'USN' },
  bb4_vs_bb4: { A: rep('battleship', 4), B: rep('battleship', 4) }
};
(async () => {
  const b = await HL.launch(), p = await b.newPage();
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sc = SC[scen], sd = +seed;
  const spec = sc.random ? { seed: sd, random: true, light: true } : { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  const out = await p.evaluate(([spec, STEP, FROM]) => {
    const L = []; let next = FROM, lastHit = { USN: 0, IJN: 0 }, shots = { USN: 0, IJN: 0 };
    WW.on('shellFired', e => { const tg = e && e.proj && e.proj.target; if (e && e.ship && e.cal !== 'mg' && tg && tg.stats && tg.nation !== e.ship.nation && WW.game.state === 'battle') shots[e.ship.nation]++; });
    WW.on('shipHit', e => { if (e && e.ship && WW.game.state === 'battle') lastHit[e.ship.nation] = WW.game.roundTime; });
    const u0 = WW.air.update;
    WW.air.update = function (dt) {
      const r = u0.apply(this, arguments);
      const t = WW.game.roundTime; if (t < next || WW.game.state !== 'battle') return r; next = t + STEP;
      const parts = [t.toFixed(0) + 's day' + (+WW.daylight).toFixed(2) + ' fly' + (WW.dayNight.canFly() ? 1 : 0)];
      for (const n of ['USN', 'IJN']) { const B = WW.fleetCmd.side(n); parts.push(n + ' ' + B.posture + (B.brokenAt ? ' BRK' + B.brokenAt.toFixed(0) : '') + (B.pursueAt ? ' PUR' + B.pursueAt.toFixed(0) : '') + ' lastHitOn' + lastHit[n].toFixed(0) + ' shotsFired' + shots[n] + ' metT' + WW.game.metT); }
      L.push(parts.join(' | '));
      for (const s of WW.world.ships) {
        if (!s.alive || s.isBase) continue;
        let bd = 1e9, be = null; for (const e of WW.world.ships) if (e.alive && !e.isBase && e.nation !== s.nation) { const d = WW.dist(s.x, s.z, e.x, e.z); if (d < bd) { bd = d; be = e; } }
        const k = be && WW.intel.known(s.nation, be), o = WW.fleetCmd.order(s);
        let pl = ''; if (s.hangar) { let up = 0; for (const q of WW.world.planes) if (q.alive && q.carrier === s) up++; const so = WW.fleetCmd.strikeOrder(s); pl = ' aboard' + (s.hangar.fighter + s.hangar.dive + s.hangar.torpedo) + ' up' + up + ' so:' + (so && so.target ? so.target.type : '-'); }
        L.push('   ' + s.nation + ' ' + s.type + ' hp' + (s.hp / s.maxHp).toFixed(2) + ' (' + s.x.toFixed(0) + ',' + s.z.toFixed(0) + ') v' + s.speed.toFixed(1) + ' role ' + (o ? o.role : '-') + (s.ai && s.ai.withdrawing ? ' WD' : '') + (s.escapeEdge ? ' ESC' : '') + ' near ' + (be ? be.type + ' ' + bd.toFixed(0) + ' seen' + (k ? (WW.time.now - k.seenAt).toFixed(0) : 'never') : '-') + pl);
      }
      return r;
    };
    const o = window.__beh.run(spec);
    return { L, len: o.len, w: o.winner, end: o.end };
  }, [spec, +step, +from]);
  console.log(out.L.join('\n')); console.log('len', out.len, 'winner', out.w, 'end', out.end);
  await b.close();
})();
