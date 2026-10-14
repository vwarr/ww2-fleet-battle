// Plane crash physics probe: flak blow-ups, where falling wrecks end, and planes under the terrain / the sea.
// Usage: node tests/plane_crash_probe.js [seeds=4] [seed0=1] [--only standard,midway,carrier_duel] [--workers 2]
// Per round (sim_behaviour's light rounds), sampled every sim step (after WW.air.update):
//   instant   heavy-AA kills that blew the plane apart in the air (air_deaths 'burst'), of all heavy-AA kills
//   ends      falling wrecks by where they ended: water / ship / runway / land (classified at removal, terrain-aware)
//   crash     ship damage and runway craters from wreck impacts (WW.airImpact.stats when present)
//   under     plane-steps with the plane's centre below the surface under it (max(sea, terrain)) by more than 0.05,
//             split by state; ditched / sinking wrecks and slide-offs (meant to be in the water) are left out
//   low       plane-steps with a live airborne plane's belly (centre - 0.45) or low wing tip (roll x half span) below the
//             surface under it (wave or hill tops); planes on the base's ground (land_ground.js onGround) are left out
'use strict';
const HL = require('./headless'), SB = require('./sim_behaviour');
const args = HL.argv, pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const oi = args.indexOf('--only'), ONLY = oi >= 0 ? args[oi + 1].split(',') : ['standard', 'midway', 'carrier_duel'];
const SEEDS = +(pos[0] || 4), SEED0 = +(pos[1] || 1);

function hook() {
  if (window.__pc) return;
  const S = window.__pc = { reset() { this.r = { under: 0, underBy: {}, low: 0, lowBy: {}, ex: [], lowEx: [], seen: {}, ends: { water: 0, ship: 0, runway: 0, land: 0 }, sunkIn: 0, burst: 0, heavyK: 0 }; } };
  S.reset();
  const PK = WW.cfg.PLANE_K || 1;
  const gnd = (x, z) => Math.max(0, -WW.terrain.depthAt(x, z));
  const U0 = WW.air.update;
  WW.air.update = function () {
    const r = U0.apply(this, arguments), R = S.r;
    for (const p of WW.world.planes) {
      if (p.removed) continue;
      const dm = p.deathMode || '', st = p.state;
      if (dm === 'ditched' || dm === 'slide' || st === 'ditched' || st === 'rollout' || st === 'parked') continue;
      if ((st === 'takeoff' || st === 'landing') && p.carrier && !p.carrier.isBase) continue;            // on a carrier's deck / in its hangar
      if ((p.kind === 'flyingboat' || p.kind === 'scout') && /^(taxi|afloat|alight|liftoff|depart|catapult)/.test(st)) continue; // a hull / float on the water (air_flyingboats.js SEAT)
      const g = gnd(p.x, p.z), key = (p.alive ? 'live:' : 'dead:') + (dm || st) + (p.phase ? '/' + p.phase : '') + (p.rwPh ? '/' + p.rwPh : '') + ':' + p.kind;
      if (p.y < g - 0.05) {
        R.under++; R.underBy[key] = (R.underBy[key] || 0) + 1;
        if (R.ex.length < 6) R.ex.push({ key, t: +WW.game.roundTime.toFixed(1), y: +p.y.toFixed(2), g: +g.toFixed(2), land: g > 0 });
      } else if (p.alive && !(p.carrier && p.carrier.isBase && (st === 'takeoff' || st === 'landing'))) {   // the base's runway work: the runways agent's ground heights
        // the airframe's lowest points: the belly (gear / torpedo, ~0.45 u below the centre) and the low wing tip in a bank
        const hs = 1.45 * WW.cfg.PLANE_SCALE / 0.82, sr = Math.sin(p.roll || 0), c = Math.cos(p.heading), sn = Math.sin(p.heading);
        let bad = p.y - 0.45 < g;
        for (const sd of [-1, 1]) { const tx = p.x - sn * sd * hs * Math.cos(p.roll || 0), tz = p.z + c * sd * hs * Math.cos(p.roll || 0); if (p.y + sd * sr * hs < gnd(tx, tz)) bad = true; }
        if (bad) { R.low++; R.lowBy[key] = (R.lowBy[key] || 0) + 1; if (R.lowEx.length < 8 && !R.seen[key]) { R.seen[key] = 1; R.lowEx.push({ key, t: +WW.game.roundTime.toFixed(1), y: +p.y.toFixed(2), g: +g.toFixed(2), roll: +(p.roll || 0).toFixed(2), vy: +p.vy.toFixed(2) }); } }
      }
    }
    return r;
  };
  // where each falling wreck ends (classified at removal: the surface under it)
  const rm = WW.Plane.prototype.remove;
  WW.Plane.prototype.remove = function () {
    if (!this.removed && !this.alive && (this.state === 'falling' || /^(spin|wing|comet|crash|abandon|burst|wrecked)$/.test(this.deathMode || '')) && S.r) {
      const R = S.r, d = WW.terrain.depthAt(this.x, this.z), b = WW.islandBase && WW.islandBase.base;
      let k = this.crashedInto || this.impactOn === 'ship' ? 'ship' : 'water';
      if (k === 'water' && d < 0) {
        k = 'land';
        if (b) for (const w of b.runways) { const dx = this.x - w.x, dz = this.z - w.z, u = dx * w.c + dz * w.s, v = -dx * w.s + dz * w.c; if (Math.abs(u) < w.len / 2 && Math.abs(v) < w.w / 2) k = 'runway'; }
      }
      if (this.impactOn) k = this.impactOn;
      R.ends[k]++;
      if (this.y < Math.max(0, -d) - 0.5) R.sunkIn++;   // ended well inside the ground
    }
    return rm.apply(this, arguments);
  };
}

(async () => {
  const b = await HL.launch(), specs = [];
  for (const sc of SB.SCEN.filter(s => ONLY.includes(s.name)))
    for (let i = 0; i < SEEDS; i++) {
      const seed = SEED0 + i;
      specs.push(Object.assign(sc.random ? { seed, random: true } : { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, base: sc.base || null }, { light: true, scen: sc.name }));
    }
  const out = [], pages = [];
  for (let k = 0; k < HL.WORKERS; k++) {
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGE', e.message));
    await p.goto(HL.url());
    await p.evaluate(SB.install, SB.P); await p.evaluate(hook);
    pages.push(p);
  }
  let next = 0;
  await Promise.all(pages.map(async p => {
    while (next < specs.length) {
      const sp = specs[next++];
      const r = await p.evaluate(sp => {
        __pc.reset(); if (WW.airImpact) WW.airImpact.reset();
        const aa0 = WW.combatAA._debug(), d0 = JSON.parse(JSON.stringify(WW.airDeaths._debug().counts)), i0 = WW.airImpact ? JSON.parse(JSON.stringify(WW.airImpact.stats)) : null;
        const res = window.__beh.run(sp);
        const aa = WW.combatAA._debug(), d = WW.airDeaths._debug().counts, I = WW.airImpact ? WW.airImpact.stats : null;
        const R = __pc.r;
        R.heavyK = aa.heavyKills; R.burst = (d.burst || 0); R.lightK = aa.lightKills;   // combat_aa / air_deaths counters reset per round? take the delta when not
        if (aa.heavyKills >= aa0.heavyKills) R.heavyK = aa.heavyKills - aa0.heavyKills;
        if ((d.burst || 0) >= (d0.burst || 0)) R.burst = (d.burst || 0) - (d0.burst || 0);
        R.crash = I ? Object.fromEntries(Object.keys(I).map(k => [k, typeof I[k] === 'number' ? +I[k].toFixed(1) : I[k]])) : null;
        R.craters = res.base ? res.base.craters : 0; R.winner = res.winner; R.len = res.len;
        return JSON.parse(JSON.stringify(R));
      }, sp);
      r.scen = sp.scen; r.seed = sp.seed; out.push(r);
      process.stdout.write('.');
    }
  }));
  console.log('');
  const agg = {};
  for (const r of out) {
    const a = agg[r.scen] = agg[r.scen] || { n: 0, under: 0, low: 0, underBy: {}, lowBy: {}, ends: { water: 0, ship: 0, runway: 0, land: 0 }, sunkIn: 0, burst: 0, heavyK: 0, craters: 0, crash: {}, ex: [], lowEx: [] };
    a.n++; a.under += r.under; a.low += r.low; a.sunkIn += r.sunkIn; a.burst += r.burst; a.heavyK += r.heavyK; a.craters += r.craters;
    for (const k in r.underBy) a.underBy[k] = (a.underBy[k] || 0) + r.underBy[k];
    for (const k in r.lowBy) a.lowBy[k] = (a.lowBy[k] || 0) + r.lowBy[k];
    for (const k in r.ends) a.ends[k] += r.ends[k];
    if (r.crash) for (const k in r.crash) if (typeof r.crash[k] === 'number') a.crash[k] = +((a.crash[k] || 0) + r.crash[k]).toFixed(1);
    for (const e of r.ex) if (a.ex.length < 8) a.ex.push(Object.assign({ seed: r.seed }, e));
    for (const e of r.lowEx) if (a.lowEx.length < 8) a.lowEx.push(Object.assign({ seed: r.seed }, e));
  }
  for (const k in agg) {
    const a = agg[k];
    console.log(`\n== ${k} (${a.n} rounds)`);
    console.log(`  instant flak kills: ${a.burst} of ${a.heavyK} heavy-AA kills (${a.heavyK ? (100 * a.burst / a.heavyK).toFixed(1) : 0}%), ${(a.burst / a.n).toFixed(2)} per round`);
    console.log(`  wreck ends: ${JSON.stringify(a.ends)}  ended inside the ground: ${a.sunkIn}`);
    console.log(`  crash impacts: ${JSON.stringify(a.crash)}  base craters (all causes): ${a.craters}`);
    console.log(`  under the surface: ${a.under} plane-steps ${JSON.stringify(a.underBy)}`);
    console.log(`  belly / wing tip below the surface (live, airborne): ${a.low} ${JSON.stringify(a.lowBy)}`);
    if (a.lowEx.length) console.log('  low examples: ' + a.lowEx.map(e => JSON.stringify(e)).join('\n                '));
    if (a.ex.length) console.log('  examples: ' + a.ex.map(e => JSON.stringify(e)).join('\n            '));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
