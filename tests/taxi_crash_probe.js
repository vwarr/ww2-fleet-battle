// Taxiway crash probe (sim): a wreck coming down among the island base's taxiing planes. Per round, once a base plane
// taxis out with another on the ground behind it (from T0 s), one forced crash on it:
//   fall  (seeds 1 mod 4)  a shot-down plane falls onto the lead taxiing plane (air_impact.js onLand)
//   ahead (seeds 3 mod 4)  one falls on the taxiway 9 u ahead of it, clear of it (it must stop short, not taxi through)
//   skid  (even seeds) a crash-landing plane skids into it (land_ground.js crash / inbound 'crash')
// then WATCH s of the field. Usage: node tests/taxi_crash_probe.js [rounds=8] [seed0=1] [--workers K]
// Reports (per round and summed):
//   struck     planes on the ground destroyed or damaged by the crash (planesHit within 5 s)
//   through    plane-samples of a base plane on the ground that moved while overlapping a wreck (centres closer than
//              r1 + r2): taxiing through it                                           (want 0)
//   held       plane-samples of a base plane stopped by a wreck (blocked: move() p.blk is a wreck)
//   info       launches, groundLost, wrecks made, launchClosed (hold-short samples with the field fouled / closed)
'use strict';
const HL = require('./headless');
const args = HL.argv.filter(a => !a.startsWith('--'));
const ROUNDS = +(args[0] || 8), SEED0 = +(args[1] || 1), SAMPLE = 0.25, T0 = 30, WATCH = 60, CAP = 240;

function install(P) {
  window.__tc = function (seed, owner, mode) {
    const G = WW.game, I = WW.islandBase;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.baseChoice = owner; G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    const b = I.base, LG = WW.landGround, LA = WW.landAir;
    const R = { seed, owner, mode, forced: 0, forcedT: null, struck: 0, minGap: 99, folGap: 99, through: 0, held: 0, heldPlanes: 0, wrecks: 0, exThrough: [] };
    const heldSet = new Set(), last = new Map();
    let lead = null, leadSlot = null, fol = null, endT = P.CAP;
    WW.on('baseEvent', e => { if (e.base === b && (e.kind === 'crashWreck' || e.kind === 'planesHit' || e.kind === 'fallWreck')) R.wrecks++; if (e.base === b && e.kind === 'planesHit' && R.forced && G.roundTime - R.forcedT < 5) R.struck += e.n; });
    const obstr = () => {
      const o = (b.wrecks || []).map(w => ({ x: w.x, z: w.z, r: w.r }));
      for (const q of WW.world.planes) if (!q.removed && q.state === 'wrecked' && (q.impactOn === 'land' || q.impactOn === 'runway') && WW.dist(q.x, q.z, b.x, b.z) < 110) o.push({ x: q.x, z: q.z, r: LG.rad(q.variant) });
      return o;
    };
    while (G.state === 'battle' && G.roundTime < endT) {
      __sim.fastForward(P.SAMPLE);
      // a plane taxiing behind q that will pass where q is now (its path ahead runs within 2.5 of q)
      const behind = (gp, q) => gp.find(f => f !== q && f.state === 'takeoff' && (f.rwPh === 'taxi' || f.rwPh === 'warm') && f.path && WW.dist(f.x, f.z, q.x, q.z) < 30 && f.path.slice(Math.max(1, f.pi)).some(t => WW.dist(t.x, t.z, q.x, q.z) < 2.5));
      if (!R.forced && G.roundTime >= P.T0) {
        const gp = WW.world.planes.filter(q => q.carrier === b && q.alive && LG.onGround(q));
        const cand = gp.find(q => q.state === 'takeoff' && q.rwPh === 'taxi' && q.gs > 0 && behind(gp, q));
        if (cand) {
          const air = WW.world.planes.filter(q => q.alive && !q.removed && !LG.onGround(q) && q.y > 6 && !/takeoff|landing|rollout/.test(q.state) && (mode !== 'skid' || q.carrier === b));
          if (air.length) {
            lead = cand; leadSlot = cand.slot; R.forced = 1; R.forcedT = G.roundTime; endT = Math.min(P.CAP, G.roundTime + P.WATCH);
            fol = behind(gp, cand);
            const q = air[0], hx = Math.cos(cand.heading), hz = Math.sin(cand.heading);
            if (mode !== 'skid') {
              let ax = cand.x + hx * 1.5, az = cand.z + hz * 1.5;
              if (mode === 'ahead') { // 9 u further along its path: on the taxiway in front of it, clear of it
                let left = 9, x0 = cand.x, z0 = cand.z;
                for (let k = cand.pi; k < cand.path.length && left > 0; k++) { const t = cand.path[k], d = WW.dist(x0, z0, t.x, t.z), f = Math.min(1, left / Math.max(d, 1e-6)); ax = x0 + (t.x - x0) * f; az = z0 + (t.z - z0) * f; left -= d; x0 = t.x; z0 = t.z; }
              }
              q.shotDown(); q.x = ax; q.z = az; q.y = b.site.padH + 0.5; q.vy = -14; q.speed = 20; q.heading = cand.heading + 2.5;
            } else {   // a shot-up plane down on the taxiway behind it, skidding into it
              const tx = cand.x + hx * 2.5, tz = cand.z + hz * 2.5, a = cand.heading + 1.2;   // in from the side, 6 u out, at 14 u/s
              q.state = 'rollout'; q.x = tx - Math.cos(a) * 6; q.z = tz - Math.sin(a) * 6; q.y = b.site.padH; q.vy = 0; q.speed = 14; q.heading = a;
              if (q.slot) q.slot.plane = q;
              LG.crash(q, b); q.loop = 0.15;
            }
          }
        }
      }
      if (!R.forced) continue;
      const O = obstr();
      for (const p of WW.world.planes) {
        if (p.carrier !== b || !p.alive || p.removed || !LG.onGround(p) || p.crashed) continue;
        const pr = last.get(p), moved = pr && Math.hypot(p.x - pr.x, p.z - pr.z) > 0.05; last.set(p, { x: p.x, z: p.z });
        const rp = LG.rad(p.variant);
        for (const w of O) if (moved && R.minGap > Math.hypot(p.x - w.x, p.z - w.z) - rp - w.r) R.minGap = Math.hypot(p.x - w.x, p.z - w.z) - rp - w.r;
        for (const w of O) if (moved && Math.hypot(p.x - w.x, p.z - w.z) < rp + w.r - 0.05) { R.through++; if (R.exThrough.length < 4) R.exThrough.push(p.state + '/' + p.rwPh + ' d' + Math.hypot(p.x - w.x, p.z - w.z).toFixed(1) + ' t' + G.roundTime.toFixed(1)); break; }
        if (p.gs === 0 && p.blk && p.blk.wreck) { R.held++; heldSet.add(p); }
        if (p === fol) for (const w of O) R.folGap = Math.min(R.folGap, Math.hypot(p.x - w.x, p.z - w.z) - rp - w.r);
      }
    }
    R.heldPlanes = heldSet.size; R.fol = fol ? (fol.alive ? fol.state + '/' + fol.rwPh : 'gone ' + (fol.slot && fol.slot.state)) : '-';
    Object.assign(R, { launches: LA.stats.launches, groundLost: LG.stats.groundLost, launchClosed: LG.stats.launchClosed, tows: LG.stats.tows, crashes: LG.stats.crashes, end: +G.roundTime.toFixed(0) });
    return R;
  };
}

(async () => {
  const b = await HL.launch();
  const pages = [];
  for (let k = 0; k < Math.min(HL.WORKERS, ROUNDS); k++) {
    const p = await b.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(HL.url()); await p.waitForFunction(() => window.__sim && window.WW && WW.game); await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(install, { SAMPLE, T0, WATCH, CAP });
    p.errs = errs; pages.push(p);
  }
  const specs = []; for (let i = 0; i < ROUNDS; i++) { const s = SEED0 + i; specs.push({ seed: s, owner: s % 4 < 2 ? 'USN' : 'IJN', mode: s % 2 ? (s % 4 === 1 ? 'fall' : 'ahead') : 'skid' }); }
  const out = new Array(specs.length); let next = 0;
  await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; out[i] = await pg.evaluate(s => window.__tc(s.seed, s.owner, s.mode), specs[i]); } }));
  const sum = (k, f) => out.filter(f || (() => true)).reduce((s, r) => s + (r[k] || 0), 0);
  for (const r of out) console.log(`seed ${r.seed} ${r.owner} ${r.mode}: forced ${r.forced}${r.forced ? ' @' + r.forcedT.toFixed(0) : ''}  struck ${r.struck}  minGap ${r.minGap.toFixed(1)} folGap ${r.folGap.toFixed(1)} fol ${r.fol}  through ${r.through}  held ${r.held} (${r.heldPlanes} planes)  wrecks ${r.wrecks}  launches ${r.launches} groundLost ${r.groundLost} launchClosed ${r.launchClosed} tows ${r.tows}` + (r.exThrough.length ? '\n   through: ' + r.exThrough.join(' | ') : ''));
  const forced = out.filter(r => r.forced);
  console.log('\n=== taxiway crash (' + HL.label() + ') ===');
  for (const m of ['fall', 'ahead', 'skid']) { const f = r => r.forced && r.mode === m; console.log(`  ${m}: forced ${sum('forced', r => r.mode === m)}  struck ${sum('struck', f)}  through ${sum('through', f)}  held ${sum('held', f)} (${sum('heldPlanes', f)} planes)`); }
  console.log(`  info (all rounds, to the end of the watch): launches ${sum('launches')} groundLost ${sum('groundLost')} launchClosed ${sum('launchClosed')} tows ${sum('tows')} (${forced.length} forced)`);
  const errs = pages.flatMap(p => p.errs);
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  await b.close();
  process.exitCode = errs.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
