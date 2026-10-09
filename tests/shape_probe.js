// Battle-shape probe: one seeded round (sim-only, node runner) with a log every LOG sim s of each side's posture,
// air-war hold, break / pursuit and what keeps a broken side from retiring (enemy gun ships near, strikes bound
// for it, last hit on it). Usage: node tests/shape_probe.js SCEN SEED [LOG=30]   (scenarios as in flight_review.js)
const HL = require('./headless');
// POS=1: also each ship's position, order role, target and station
const SB = require('./sim_behaviour');
const [scen = 'standard', seed = '1', LOG = '30'] = HL.argv.filter(a => !a.startsWith('--'));
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' }
};
(async () => {
  const sc = SCEN[scen], sd = +seed;
  const spec = sc.random ? { seed: sd, random: true, light: true } : { seed: sd, A: sc.A, B: sc.B, aNation: sc.aFixed || (sd % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null, light: true };
  const b = await HL.launch(), p = await b.newPage();
  p.on('console', m => console.log(m.text()));
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  await p.evaluate(LOG => {
    let nextT = 0; window.__shapeLog = []; const by = window.__shapeBy = {};
    WW.on('contact', e => { const o = e.by, k = !o ? '?' : o.type || o.kind || 'other'; const t = WW.game.roundTime; (by[k] = by[k] || { n: 0, first: null }).n++; if (by[k].first === null) by[k].first = +t.toFixed(0); }); const u0 = WW.fleetCmd.update;
    WW.fleetCmd.update = function (dt) {
      u0.call(this, dt);
      const t = WW.game.roundTime; if (t < nextT) return; nextT = t + LOG;
      const S = WW.world.ships, P = WW.world.planes, line = [t.toFixed(0)];
      for (const n of ['USN', 'IJN']) {
        const B = WW.fleetCmd.side(n); if (!B) continue;
        let gd = 1e9, inb = 0, near = 0;
        for (const s of S) if (s.alive && !s.sinking && s.nation === n && s.type !== 'submarine')
          for (const e of S) if (e.alive && !e.sinking && e.nation !== n && /battleship|cruiser|destroyer/.test(e.type)) gd = Math.min(gd, WW.dist(s.x, s.z, e.x, e.z));
        for (const q of P) if (q.alive && q.nation !== n && q.ordnance && (q.kind === 'dive' || q.kind === 'torpedo')) {
          const tg = q.target || (q.wave && q.wave.target); if (tg && tg.nation === n) { inb++; if (B.brokenAt) line.push(`  ${q.kind} ${q.state || q.phase || q.mission} y${q.y.toFixed(0)} d${WW.dist(q.x, q.z, tg.x, tg.z).toFixed(0)} tgt ${tg.type}${tg.alive ? '' : ' DEAD'} wave ${q.wave ? q.wave.id + ':' + (q.wave.state || q.wave.phase) : '-'}`); } else near++;
        }
        const ns = S.filter(s => s.alive && s.nation === n).map(s => { const o = B.orders.get(s.id); return s.type[0] + (s.hp / s.maxHp).toFixed(1) + (process.env.POS ? '@' + s.x.toFixed(0) + ',' + s.z.toFixed(0) + (o ? ':' + o.role + (s.target ? '>' + s.target.type[0] : '') + (isFinite(o.sx) ? '→' + o.sx.toFixed(0) + ',' + o.sz.toFixed(0) : '') : '') : ''); }).join(' ');
        const ptSeen = WW.intel.enemyShips(n).filter(c => c.by && c.by.type === 'pt' && WW.time.now - c.seenAt < 3).length;
        line.push(`${n} ${B.posture}${ptSeen ? ' ptSees ' + ptSeen : ''}${B.airWar ? ' HOLD' : ''}${B.brokenAt ? ' brk' + B.brokenAt.toFixed(0) : ''} gun ${gd.toFixed(0)} inb ${inb}/${near} [${ns}]`);
      }
      window.__shapeLog.push(line.join(' | '));
    };
  }, +LOG);
  const o = await p.evaluate(spec => { const o = window.__beh.run(spec); return { winner: o.winner, len: o.len, end: o.end, log: window.__shapeLog, by: window.__shapeBy }; }, spec);
  console.log(o.log.join('\n')); delete o.log; console.log('contacts (re)gained by observer: ' + JSON.stringify(o.by)); delete o.by; console.log(JSON.stringify(o));
  await b.close();
})();
