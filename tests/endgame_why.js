// Why a broken side has not retired yet (diagnosis, read-only): every STEP s after a side breaks, what holds main.js's
// retire ending: enemy bombers bound for its ships (and how far out), an enemy gun ship within CLEAR_R, the pursuit
// closing (WW.endgame.closing), the time since the last hit on it. Usage: node tests/endgame_why.js SCEN SEED [STEP=5]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const [scen = 'carrier_duel', seed = '1', step = '5'] = HL.argv;
const rep = (t, n) => Array(n).fill(t);
const SC = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  asymmetric: { A: ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3), 'submarine', 'pt', 'pt'], B: ['cruiser', 'destroyer', 'destroyer'] },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], base: 'IJN', aFixed: 'USN' }
};
(async () => {
  const b = await HL.launch(), p = await b.newPage();
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  const sc = SC[scen], sd = +seed;
  const spec = sc.random ? { seed: sd, random: true, light: true } : { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null, light: true };
  const out = await p.evaluate(([spec, STEP]) => {
    const L = []; let next = 0, lastHit = { USN: 0, IJN: 0 };
    const OUT = { transit: 1, inbound: 1, attack: 1 }, GUNS = { battleship: 1, cruiser: 1, destroyer: 1 };
    WW.on('shipHit', e => { if (e && e.ship && WW.game.state === 'battle') lastHit[e.ship.nation] = WW.game.roundTime; });
    const u0 = WW.air.update;
    WW.air.update = function (dt) {
      const r = u0.apply(this, arguments), t = WW.game.roundTime;
      if (t < next || WW.game.state !== 'battle') return r; next = t + STEP;
      for (const n of ['USN', 'IJN']) {
        const B = WW.fleetCmd.side(n); if (!B.brokenAt || B.posture !== 'withdraw') continue;
        const mine = q => q && q.nation === n && q.alive, S = WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === n && s.type !== 'submarine');
        let bomb = 0, bd = 1e9, gun = 1e9;
        for (const q of WW.world.planes) if (q.alive && q.nation !== n && q.ordnance && OUT[q.state] && (q.kind === 'dive' || q.kind === 'torpedo') && (mine(q.target) || mine(q.wave && q.wave.target))) { bomb++; const tg = mine(q.target) ? q.target : q.wave.target; bd = Math.min(bd, WW.dist(q.x, q.z, tg.x, tg.z)); }
        for (const s of S) for (const e of WW.world.ships) if (e.alive && !e.sinking && e.nation !== n && GUNS[e.type]) gun = Math.min(gun, WW.dist(s.x, s.z, e.x, e.z));
        L.push(`${t.toFixed(0)} ${n} brk${B.brokenAt.toFixed(0)} sinceHit ${(t - lastHit[n]).toFixed(0)} bombersBound ${bomb}${bomb ? ' nearest ' + bd.toFixed(0) : ''} gunShip ${gun.toFixed(0)} closing ${WW.endgame.closing(n)} afloat ${S.map(s => s.type[0] + (s.hp / s.maxHp).toFixed(2)).join(',')}`);
      }
      return r;
    };
    const o = window.__beh.run(spec);
    L.push(`end ${o.end}@${o.len}`);
    return L;
  }, [spec, +step]);
  console.log(out.join('\n'));
  await b.close();
})();
