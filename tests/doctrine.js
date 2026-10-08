// Doctrine metrics: per-nation formation shape, zigzag, torpedoes, submarine roles, ammunition and fuel, over N
// seeded random rounds (sim-only mode unless --render). It reads the sim's own counters (WW.docStats, core.js
// WW.dstat) plus observable state (positions, fleet orders) and bus events. Report only: no pass / fail.
// Usage: BASE_URL=http://localhost:PORT/ node tests/doctrine.js [rounds=24] [firstSeed=1] [--pages K]
//   formation   ring_r: median distance of a carrier's ring escorts from it (fleet order role 'escort');
//               ring_n: escorts in that ring; van_d: how far the main body's centroid is ahead of the first carrier,
//               along the line toward the enemy's edge; both sampled every 2 s while the side is in search / approach
//   zigzag      zig_s: sim s per round that the side's formation zigzagged (subs known or suspected near)
//   torpedoes   per launcher (ship / air): fired, hits, duds, hit rate, dud share of hulls struck;
//               seen_d: mean distance at which the target side first saw a track (the wake);
//               comb_d: mean distance ahead at which a ship started to comb one
//   subs        sub_kills: ships sunk with a sub torpedo as the last torpedo hit, by target type;
//               lifeguard: survivors / aircrew picked up by a surfaced sub (endgame.js 'rescue' events)
//   supply      ammo / fuel events (ship_supply.js): low and empty counts per kind
// Env: CHROMIUM = headless shell; JSON=path writes the raw per-round results.
const { chromium } = require('playwright');
const fs = require('fs');
const HL = require('./headless');
const pi = HL.argv.indexOf('--pages'), PAGES = pi >= 0 ? Math.max(1, +HL.argv[pi + 1]) : 2;
const pos = HL.argv.filter((a, i) => a !== '--pages' && HL.argv[i - 1] !== '--pages');
const N = +(pos[0] || 24), SEED0 = +(pos[1] || 1);
const errs = [];

async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto(HL.url());
  await p.waitForTimeout(HL.settle());
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; });
  await p.evaluate(() => {
    const H = window.__d = { R: null };
    WW.on('weaponImpact', e => {
      const R = H.R; if (!R || !e || e.kind !== 'torpedo' || !e.ship || e.dud) return;
      const o = e.proj && e.proj.owner; R.lastTorp[e.ship.id] = o && o.type === 'submarine' ? o.nation : null;
    });
    WW.on('shipSunk', s => {
      const R = H.R; if (!R || !s) return;
      const n = R.lastTorp[s.id]; if (n) { const k = n + ':' + s.type; R.subKills[k] = (R.subKills[k] || 0) + 1; }
    });
    WW.on('rescue', e => {
      const R = H.R; if (!R || !e || !e.ship) return;
      const k = e.ship.nation + ':' + e.ship.type + ':' + e.kind; R.rescues[k] = (R.rescues[k] || 0) + (e.n || 0);
    });
  });
  return p;
}

function runRound(p, seed) {
  return p.evaluate(seed => {
    const G = WW.game, H = window.__d, cap = WW.cfg.ROUND_TIMEOUT + 180;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    G.composition = null; G.mode = 'auto';
    G.startRound({ keepMap: true });
    const R = H.R = { lastTorp: {}, subKills: {}, rescues: {}, ring: { USN: [], IJN: [] }, ringN: { USN: [], IJN: [] }, van: { USN: [], IJN: [] } };
    const comp = {}; for (const s of WW.world.ships) comp[s.nation + ':' + s.type] = (comp[s.nation + ':' + s.type] || 0) + 1;
    let t = 0;
    while (G.state === 'battle' && t < cap) {
      __sim.fastForward(2); t += 2;
      for (const n of ['USN', 'IJN']) {
        const B = WW.fleetCmd && WW.fleetCmd.side(n); if (!B || (B.posture !== 'search' && B.posture !== 'approach')) continue;
        const cvs = WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === n && s.type === 'carrier');
        if (!cvs.length) continue;
        const cv = cvs[0], dir = n === 'USN' ? 1 : -1;
        let k = 0;
        for (const s of WW.world.ships) {
          if (!s.alive || s.sinking || s.nation !== n || s === cv) continue;
          const o = WW.fleetCmd.order(s); if (!o || o.role !== 'escort') continue;
          const c = s.ringCv || cvs.reduce((a, q) => (WW.dist(s.x, s.z, q.x, q.z) < WW.dist(s.x, s.z, a.x, a.z) ? q : a), cv);
          R.ring[n].push(+WW.dist(s.x, s.z, c.x, c.z).toFixed(1)); k++;
        }
        R.ringN[n].push(k / cvs.length);
        const main = WW.world.ships.filter(s => s.alive && !s.sinking && s.nation === n && (s.type === 'battleship' || s.type === 'cruiser') && (WW.fleetCmd.order(s) || {}).group === 'main');
        if (main.length) { const mx = main.reduce((a, s) => a + s.x, 0) / main.length; R.van[n].push(+((mx - cv.x) * dir).toFixed(1)); }
      }
    }
    const out = { seed, winner: G.winner, len: +G.roundTime.toFixed(0), comp, doc: JSON.parse(JSON.stringify(WW.docStats || {})),
      subKills: R.subKills, rescues: R.rescues, ring: R.ring, ringN: R.ringN, van: R.van };
    H.R = null;
    return out;
  }, seed);
}

const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const f = (v, d = 2) => (v === null || v === undefined || !isFinite(v) ? 'n/a' : (+v).toFixed(d));
(async () => {
  const T0 = Date.now(), b = await HL.launch(chromium);
  const pages = await Promise.all([...Array(PAGES).keys()].map(() => openPage(b)));
  const rounds = new Array(N); let next = 0;
  await Promise.all(pages.map(async pg => { while (next < N) { const i = next++; rounds[i] = await runRound(pg, SEED0 + i); } }));
  await b.close();
  const sum = (k, n) => rounds.reduce((a, r) => a + ((r.doc[k] || {})[n] || 0), 0);
  const cat = (k, n) => rounds.flatMap(r => r[k][n]);
  const keys = new Set(); rounds.forEach(r => Object.keys(r.doc).forEach(k => keys.add(k)));
  console.log(`doctrine metrics: ${N} rounds from seed ${SEED0} (${HL.RENDER ? 'render' : 'sim-only'}, ${PAGES} pages, ${((Date.now() - T0) / 1000).toFixed(0)} s)` +
    `   wins USN ${rounds.filter(r => r.winner === 'USN').length} IJN ${rounds.filter(r => r.winner === 'IJN').length}`);
  for (const n of ['USN', 'IJN']) {
    console.log(`\n== ${n}`);
    const rg = cat('ring', n), rn = cat('ringN', n), vn = cat('van', n);
    console.log(`  formation  ring_r med ${f(med(rg), 0)} (p10 ${f(med(rg.filter(v => v <= med(rg))), 0)}, n ${rg.length})  ring_n ${f(rn.length ? rn.reduce((a, b) => a + b, 0) / rn.length : null)}` +
      `  van_d med ${f(med(vn), 0)} (n ${vn.length})`);
    console.log(`  zigzag     zig_s/round ${f(sum('zigT', n) / N, 0)}  rounds with zigzag ${rounds.filter(r => ((r.doc.zigT || {})[n] || 0) > 0).length}/${N}`);
    for (const src of ['Ship', 'Air']) {
      const fi = sum('torpFired' + src, n), hi = sum('torpHit' + src, n), du = sum('torpDud' + src, n);
      console.log(`  torp ${src.padEnd(5)} fired ${fi}  hits ${hi}  duds ${du}  hit rate ${f(fi ? hi / fi : null, 3)}  dud share ${f(hi + du ? du / (hi + du) : null)}`);
    }
    console.log(`  torp seen  first-sighting dist ${f(sum('torpSeenD', n) / sum('torpSeenN', n), 1)} (n ${sum('torpSeenN', n)})   comb start dist ${f(sum('combD', n) / sum('combN', n), 1)} (n ${sum('combN', n)})   [${n} torpedoes, seen by the other side]`);
    const sk = {}; rounds.forEach(r => { for (const k in r.subKills) if (k.startsWith(n + ':')) sk[k.slice(4)] = (sk[k.slice(4)] || 0) + r.subKills[k]; });
    const rs = {}; rounds.forEach(r => { for (const k in r.rescues) if (k.startsWith(n + ':')) rs[k.slice(4)] = (rs[k.slice(4)] || 0) + r.rescues[k]; });
    console.log(`  subs       kills by target ${JSON.stringify(sk)}  shadow_s/round ${f(sum('subShadowT', n) / N, 0)}  patrol_s/round ${f(sum('subPatrolT', n) / N, 0)}`);
    console.log(`  rescues    ${JSON.stringify(rs)}  (sub lifeguard claims ${sum('lifeguardClaim', n)}, pickups ${sum('lifeguardPick', n)})`);
    const sup = [...keys].filter(k => k.startsWith('sup')).sort().map(k => `${k.slice(3)} ${sum(k, n)}`).join('  ');
    console.log(`  supply     ${sup || 'n/a'}`);
  }
  if (errs.length) console.log('\npage errors:\n' + errs.slice(0, 10).join('\n'));
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(rounds, null, 1));
})().catch(e => { console.error(e); process.exit(2); });
