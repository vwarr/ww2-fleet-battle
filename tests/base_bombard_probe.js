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
      aaAir: 0, closures: [], reopens: [], baseStrikesAtShips: 0, baseTargets: {}, events: {}, log: [], bombarders: new Set(), dmgFac: 0, slots0: null, lastShellT: null, inWater: {}, rng: {}, shAim: new WeakMap(), shMiss: {}, shWet: {}, bmAim: new WeakMap(), bm: {}, bat: { atBombarder: 0, atOther: 0, otherWithBombarderInReach: 0 } };
  }
  fresh();
  WW.on('roundStart', fresh);
  const mark = k => { if (S.first[k] === undefined) S.first[k] = t(); };
  WW.on('shellFired', e => {
    const p = e && e.proj, b = WW.islandBase.base; if (!b || !p || p.target !== b || !e.ship || e.ship.isBattery) return;
    const k = e.ship.type + ':' + e.cal; S.fired[k] = (S.fired[k] || 0) + 1; S.bombarders.add(e.ship); mark('shell'); S.lastShellT = t();
    p.__bb = true;
    // the firing position: range to the base's centre and to the nearest live coastal battery (inside BATTERY.range?)
    let bd = 1e9; for (const f of b.facilities) if (f.kind === 'battery' && !f.out) bd = Math.min(bd, Math.hypot(e.ship.x - f.x, e.ship.z - f.z));
    const rk = e.ship.type + ':' + e.cal, R0 = S.rng[rk] = S.rng[rk] || { n: 0, d: 0, inBat: 0, dMin: 1e9, dMax: 0 }, dc = Math.hypot(e.ship.x - b.x, e.ship.z - b.z);
    R0.n++; R0.d += dc; R0.dMin = Math.min(R0.dMin, dc); R0.dMax = Math.max(R0.dMax, dc); if (bd < WW.islandBase.BATTERY.range) R0.inBat++;
    // the aim point (base_ai.js moves the base's x / z to it for the call): the miss distance at the landing
    const ak = (e.ship[e.cal === 'small' ? '_baseAimS' : '_baseAim'] || {}).key, what = !ak ? 'centre' : typeof ak === 'string' ? 'row' : ak.kind || 'runway';
    S.shAim.set(p, { x: b.x, z: b.z, cal: e.cal, what });
  });
  WW.on('shellLanded', e => {
    const a = e && e.proj && S.shAim.get(e.proj); if (!a) return; S.shAim.delete(e.proj);
    const m = S.shMiss[a.cal] = S.shMiss[a.cal] || { n: 0, d: 0, in10: 0 }, d = Math.hypot(e.x - a.x, e.z - a.z); m.n++; m.d += d; if (d < 10) m.in10++;
    const w = S.shWet[a.cal + ':' + a.what] = S.shWet[a.cal + ':' + a.what] || [0, 0]; w[0]++; if (WW.terrain.depthAt(e.x, e.z) > 0.3) w[1]++;
  });
  // the coastal batteries' replies: shots at a ship that shelled the island in the last 30 s vs others
  WW.on('shellFired', e => { if (!e || !e.ship || !e.ship.isBattery || !e.proj || !e.proj.target) return; const u = e.proj.target; const bomb = WW.time.now - (u._bombT || -1e9) < 30; S.bat[bomb ? 'atBombarder' : 'atOther']++;
    if (!bomb && WW.world.ships.some(q => q.alive && !q.sinking && q.nation !== e.ship.nation && WW.time.now - (q._bombT || -1e9) < 30 && Math.hypot(q.x - e.ship.x, q.z - e.ship.z) < WW.islandBase.BATTERY.range)) S.bat.otherWithBombarderInReach++; mark('battery'); });
  // bombs on the base: the plane (level: B-17 / Betty / Kate level run; dive), the aim point (land_air.js aimFor via the
  // swapped base x / z) and what it was (a facility kind or the runway), the miss distance and the outcome
  WW.on('weaponDropped', e => {
    const b = WW.islandBase.base; if (!b || !e || e.kind !== 'bomb' || !e.plane || e.target !== b) return;
    const pl = e.plane, how = (pl.level ? (pl.variant ? pl.variant : 'kate') + '-level' : pl.kind), what = pl.aimF ? (pl.aimF.what || (pl.aimF.f ? pl.aimF.f.kind : 'runway')) : 'centre';
    S.bmAim.set(e.proj, { x: b.x, z: b.z, how, what }); mark('bomb');
  });
  WW.on('weaponImpact', e => {
    const a = e && e.kind === 'bomb' && e.proj && S.bmAim.get(e.proj); if (!a) return; S.bmAim.delete(e.proj);
    const k = a.how, m = S.bm[k] = S.bm[k] || { n: 0, d: 0, in5: 0, in10: 0, water: 0, aims: {} }, d = Math.hypot(e.x - a.x, e.z - a.z);
    m.n++; m.d += d; if (d < 5) m.in5++; if (d < 10) m.in10++; if (WW.terrain.depthAt(e.x, e.z) > 0.3) m.water++; m.aims[a.what] = (m.aims[a.what] || 0) + 1;
  });
  // impacts on the island (combat.js landShell / combat_weapons.js updateBomb -> landSites -> the islandBase provider's
  // impact: wrapped on the provider, which holds its own reference; wrapping WW.islandBase.impact saw nothing)
  const prov = WW.landSites.providers.find(q => q.id === 'islandBase'), imp = prov.impact;
  prov.impact = function (nation, x, z, dmg, kind, cal) {
    const b = WW.islandBase.base;
    if (!b || nation === b.nation) return imp.apply(this, arguments);
    const hp0 = b.facilities.map(f => f.hp), out0 = b.facilities.map(f => f.out), cr0 = b.craters.length;
    const r = imp.apply(this, arguments);
    const k = (kind === 'bomb' ? 'bomb' : cal);
    if (!r) { if (kind !== 'bomb' && Math.hypot(x - b.x, z - b.z) < 110) {   // (a miss at a ship far off is not a splash off the island)
       S.water++; S.inWater[k] = (S.inWater[k] || 0) + 1; } return r; }
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
    return { owner: b ? b.nation : null, rng: S.rng, shMiss: S.shMiss, shWet: S.shWet, bm: S.bm, bat: S.bat, fired: S.fired, land: S.land, water: S.water, inWater: S.inWater, craters: S.craters, facHit: S.facHit, facOut: S.facOut, dmgFac: Math.round(S.dmgFac),
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
    const rg = {}; for (const o of L) for (const [a, v] of Object.entries(o.rng)) { const t = rg[a] = rg[a] || { n: 0, d: 0, inBat: 0, dMin: 1e9, dMax: 0 }; t.n += v.n; t.d += v.d; t.inBat += v.inBat; t.dMin = Math.min(t.dMin, v.dMin); t.dMax = Math.max(t.dMax, v.dMax); }
    console.log('  firing range to the base centre (mean [min-max]) and share fired from inside a live battery\'s reach', Object.entries(rg).map(([a, t]) => `${a} ${(t.d / t.n).toFixed(0)} [${t.dMin.toFixed(0)}-${t.dMax.toFixed(0)}] inBat ${(100 * t.inBat / t.n).toFixed(0)}%`).join('; '));
    const sm = {}; for (const o of L) for (const [a, v] of Object.entries(o.shMiss)) { const t = sm[a] = sm[a] || { n: 0, d: 0, in10: 0 }; t.n += v.n; t.d += v.d; t.in10 += v.in10; }
    console.log('  shell miss vs the walking aim point', Object.entries(sm).map(([a, t]) => `${a} n ${t.n} mean ${(t.d / t.n).toFixed(1)} <10u ${(100 * t.in10 / t.n).toFixed(0)}%`).join('; '));
    const sw = {}; for (const o of L) for (const [a, v] of Object.entries(o.shWet)) { const t = sw[a] = sw[a] || [0, 0]; t[0] += v[0]; t[1] += v[1]; }
    console.log('  shells by aim (fired / in the water)', JSON.stringify(sw));
    const bm = {}; for (const o of L) for (const [a, v] of Object.entries(o.bm)) { const t = bm[a] = bm[a] || { n: 0, d: 0, in5: 0, in10: 0, water: 0, aims: {} }; t.n += v.n; t.d += v.d; t.in5 += v.in5; t.in10 += v.in10; t.water += v.water; for (const [w, c] of Object.entries(v.aims)) t.aims[w] = (t.aims[w] || 0) + c; }
    console.log('  bombs on the base by plane', Object.entries(bm).map(([a, t]) => `${a} n ${t.n} miss ${(t.d / t.n).toFixed(1)} <5u ${(100 * t.in5 / t.n).toFixed(0)}% <10u ${(100 * t.in10 / t.n).toFixed(0)}% water ${t.water} aims ${JSON.stringify(t.aims)}`).join('\n    '));
    console.log('  coastal battery shots', JSON.stringify(L.reduce((o, r) => { o.atBombarder += r.bat.atBombarder; o.atOther += r.bat.atOther; o.otherWithBombarderInReach += r.bat.otherWithBombarderInReach; return o; }, { atBombarder: 0, atOther: 0, otherWithBombarderInReach: 0 })));
    const fs = L.filter(o => o.first.shell !== undefined);
    for (const o of fs) console.log(`  ${o.sc} ${o.seed}: owner ${o.owner}; first shell ${o.first.shell}, crater by shell ${o.first.craterShell}, facility hit by shell ${o.first.facShell}, out by shell ${o.first.outShell}, planes wrecked ${o.first.planesWrecked}, AA at ground planes ${o.first.aaGround}, neutralized ${o.first.neutralized}; closures ${o.closures.length} reopens ${o.reopens.length}; slots ${JSON.stringify(o.slots)}; fac ${JSON.stringify(o.fac)}; len ${o.len} ${o.end}`);
  }
})();
