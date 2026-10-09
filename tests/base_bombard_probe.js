// Base bombardment probe (diagnosis, read-only): when enemy ships shell the island base, which guns fire at it (by
// shooter type and calibre), where the shells land (water / land / runway / facility in reach), what they do in sim
// state (craters, runway closures, facility hp and knock-outs, parked planes wrecked, repairs), how long until the
// first effect, whether the ships' AA fires at the base's planes on the ground, and what the base's planes do
// (scrambles, strikes on the bombarding ships). Sim-only (node runner), one line per round plus a summary.
// Usage: node tests/base_bombard_probe.js [--only midway,ijnbase,bbbase,bbbase_usn] [--seeds N=8] [--seed0 1] [--workers K] [--log SCEN:SEED]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,ijnbase,bbbase,bbbase_usn').split(','), LOG = arg('--log', null);
const SC = {
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' },
  bbbase: { A: ['battleship', 'battleship', 'cruiser', 'destroyer'], B: ['destroyer', 'destroyer'], aN: 'IJN', base: 'USN' },       // Henderson Field, 13-14 Oct 1942
  bbbase_usn: { A: ['battleship', 'battleship', 'cruiser', 'destroyer'], B: ['destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};

function install() {
  const R = window.__bb = {};
  let S = null;
  const t = () => +WW.game.roundTime.toFixed(1);
  function fresh() {
    S = { fired: {}, land: {}, water: 0, onRw: 0, craters: 0, facHit: {}, facOut: {}, planesWrecked: 0, groundLostTotal: 0, first: {}, aaGround: { shots: 0, hits: 0, kills: 0, byType: {} },
      aaAir: 0, closures: [], reopens: [], baseStrikesAtShips: 0, baseTargets: {}, events: {}, log: [], bombarders: new Set(), dmgFac: 0, slots0: null, lastShellT: null, inWater: {} };
  }
  fresh();
  WW.on('roundStart', fresh);
  const mark = k => { if (S.first[k] === undefined) S.first[k] = t(); };
  WW.on('shellFired', e => {
    const p = e && e.proj, b = WW.islandBase.base; if (!b || !p || p.target !== b || !e.ship || e.ship.isBattery) return;
    const k = e.ship.type + ':' + e.cal; S.fired[k] = (S.fired[k] || 0) + 1; S.bombarders.add(e.ship); mark('shell'); S.lastShellT = t();
    p.__bb = true;
  });
  // impacts on the island (combat.js landShell -> islandBase.impact)
  const imp = WW.islandBase.impact;
  WW.islandBase.impact = function (nation, x, z, dmg, kind, cal) {
    const b = WW.islandBase.base;
    if (!b || nation === b.nation) return imp.apply(this, arguments);
    const hp0 = b.facilities.map(f => f.hp), out0 = b.facilities.map(f => f.out), cr0 = b.craters.length;
    const r = imp.apply(this, arguments);
    const k = (kind === 'bomb' ? 'bomb' : cal);
    if (!r) { if (kind !== 'bomb') { S.water++; S.inWater[k] = (S.inWater[k] || 0) + 1; } return r; }
    S.land[k] = (S.land[k] || 0) + 1;
    if (b.craters.length > cr0) { S.craters += b.craters.length - cr0; if (kind !== 'bomb') mark('craterShell'); }
    b.facilities.forEach((f, i) => {
      if (f.hp < hp0[i]) { S.facHit[f.kind] = (S.facHit[f.kind] || 0) + 1; S.dmgFac += hp0[i] - Math.max(0, f.hp); if (kind !== 'bomb') mark('facShell'); }
      if (f.out && !out0[i]) { S.facOut[f.kind + (kind === 'bomb' ? '/bomb' : '/shell')] = (S.facOut[f.kind + (kind === 'bomb' ? '/bomb' : '/shell')] || 0) + 1; if (kind !== 'bomb') mark('outShell'); }
    });
    return r;
  };
  const gh = WW.landGround.groundHit;
  WW.landGround.groundHit = function (b, x, z, blast) { const n = gh.apply(this, arguments); S.planesWrecked += n; if (n) mark('planesWrecked'); return n; };
  // ships' light AA at the base's planes on the ground (or on the runway)
  WW.on('aaLightFired', e => {
    const p = e && e.target; if (!p || !p.carrier || !p.carrier.isBase) { S.aaAir++; return; }
    const g = WW.landGround.onGround(p) || (p.y || 0) < 3;
    if (!g) { S.aaAir++; return; }
    S.aaGround.shots++; if (e.hit) S.aaGround.hits++; if (!p.alive) S.aaGround.kills++;
    const k = e.ship.type + ':' + (p.state + '/' + (p.rwPh || '')); S.aaGround.byType[k] = (S.aaGround.byType[k] || 0) + 1;
    mark('aaGround');
  });
  WW.on('baseEvent', e => {
    if (!e) return; S.events[e.kind] = (S.events[e.kind] || 0) + 1;
    if (e.kind === 'runwayClosed' || e.kind === 'crossClosed') S.closures.push(t());
    if (e.kind === 'runwayOpen' || e.kind === 'crossOpen') S.reopens.push(t());
    if (e.kind === 'strikeOut' && e.target && !e.target.isBase) { S.baseStrikesAtShips++; S.baseTargets[e.target.type] = (S.baseTargets[e.target.type] || 0) + 1; }
    if (e.kind === 'neutralized') mark('neutralized');
  });
  R.flush = function () {
    const b = WW.islandBase.base, st = WW.islandBase.stats;
    const slots = b && b.slots ? b.slots.reduce((o, s) => { o[s.state] = (o[s.state] || 0) + 1; return o; }, {}) : null;
    const fac = b ? b.facilities.reduce((o, f) => { o[f.kind] = (o[f.kind] || '') + (f.out ? 'X' : Math.round(100 * f.hp / f.maxHp) + ' '); return o; }, {}) : null;
    return { owner: b ? b.nation : null, fired: S.fired, land: S.land, water: S.water, inWater: S.inWater, craters: S.craters, facHit: S.facHit, facOut: S.facOut, dmgFac: Math.round(S.dmgFac),
      planesWrecked: S.planesWrecked, first: S.first, lastShellT: S.lastShellT, aaGround: S.aaGround, aaAir: S.aaAir, closures: S.closures, reopens: S.reopens,
      baseStrikesAtShips: S.baseStrikesAtShips, baseTargets: S.baseTargets, events: S.events, slots, fac, neutralized: b ? b.neutralized : null, runwayOpen: WW.islandBase.runwayOpen(),
      st: st ? { bombardRuns: st.bombardRuns, bombardShells: st.bombardShells, impacts: st.impacts, coastalShots: st.coastalShots, landStrikes: st.landStrikes, raids: st.raids, alarmAt: st.alarmAt, alarmKind: st.alarmKind } : null,
      la: WW.landAir && WW.landAir.stats ? Object.assign({}, WW.landAir.stats) : null, lg: Object.assign({}, WW.landGround.stats), bombarders: [...S.bombarders].map(s => s.type) };
  };
  return true;
}

(async () => {
  const list = [];
  if (LOG) { const [sc, sd] = LOG.split(':'); list.push({ sc, seed: +sd }); }
  else for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push({ sc, seed: s });
  const b = await HL.launch(), res = [];
  let next = 0;
  async function worker() {
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGE', e.message));
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install);
    while (next < list.length) {
      const it = list[next++], sc = SC[it.sc];
      const spec = { seed: it.seed, A: sc.A, B: sc.B, aNation: sc.aN, cripple: -1, base: sc.base, light: true };
      const o = await p.evaluate(spec => { const o = window.__beh.run(spec); return Object.assign({ w: o.winner, len: o.len, end: o.end }, window.__bb.flush()); }, spec);
      o.sc = it.sc; o.seed = it.seed; res.push(o); process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  res.sort((a, b) => (a.sc < b.sc ? -1 : a.sc > b.sc ? 1 : a.seed - b.seed));
  for (const o of res) console.log(JSON.stringify(o));
  // summary per scenario
  for (const sc of [...new Set(res.map(o => o.sc))]) {
    const L = res.filter(o => o.sc === sc), sum = k => { const t = {}; for (const o of L) for (const [a, v] of Object.entries(o[k] || {})) t[a] = (t[a] || 0) + v; return t; };
    const n = L.length, any = L.filter(o => Object.keys(o.fired).length);
    console.log(`\n== ${sc}: ${n} rounds, ${any.length} with ship shells at the base`);
    console.log('  shells fired at the base by shooter:cal', JSON.stringify(sum('fired')));
    console.log('  landed on the island by cal', JSON.stringify(sum('land')), ' in the water', L.reduce((s, o) => s + o.water, 0), JSON.stringify(sum('inWater')));
    console.log('  craters', L.reduce((s, o) => s + o.craters, 0), ' facility hits', JSON.stringify(sum('facHit')), ' knocked out', JSON.stringify(sum('facOut')), ' facility hp removed', L.reduce((s, o) => s + o.dmgFac, 0));
    console.log('  parked / ground planes wrecked', L.reduce((s, o) => s + o.planesWrecked, 0), ' neutralized', L.filter(o => o.neutralized).length, ' runway open at the end', L.filter(o => o.runwayOpen).length);
    console.log('  light AA at base planes on the ground: ticks', L.reduce((s, o) => s + o.aaGround.shots, 0), 'hits', L.reduce((s, o) => s + o.aaGround.hits, 0), 'kills', L.reduce((s, o) => s + o.aaGround.kills, 0), ' (light AA ticks at planes in the air', L.reduce((s, o) => s + o.aaAir, 0) + ')');
    const ag = {}; for (const o of L) for (const [a, v] of Object.entries(o.aaGround.byType)) ag[a] = (ag[a] || 0) + v; console.log('  ...by shooter:plane state', JSON.stringify(ag));
    console.log('  base strikes at ships', L.reduce((s, o) => s + o.baseStrikesAtShips, 0), JSON.stringify(sum('baseTargets')), ' scrambles', L.reduce((s, o) => s + (o.la ? o.la.scrambles : 0), 0), ' closedLaunches', L.reduce((s, o) => s + (o.la ? o.la.closedLaunches : 0), 0));
    const fs = L.filter(o => o.first.shell !== undefined);
    for (const o of fs) console.log(`  ${o.sc} ${o.seed}: owner ${o.owner}; first shell ${o.first.shell}, crater by shell ${o.first.craterShell}, facility hit by shell ${o.first.facShell}, out by shell ${o.first.outShell}, planes wrecked ${o.first.planesWrecked}, AA at ground planes ${o.first.aaGround}, neutralized ${o.first.neutralized}; closures ${o.closures.length} reopens ${o.reopens.length}; slots ${JSON.stringify(o.slots)}; fac ${JSON.stringify(o.fac)}; len ${o.len} ${o.end}`);
  }
})();
