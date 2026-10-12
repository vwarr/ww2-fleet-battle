// Island base under bombardment (sim; branch basebattle): what the ships' guns do to the island, what the base does
// back, and where everyone's AA goes. Per round: shells at the base by shooter type and calibre, the range they were
// fired from, impacts on land, facilities out, runway-closed time, planes wrecked on the ground, base hp, time from the
// first bombardment shell to neutralization; coastal battery shots / hits; base strikes by target (bombarding ships or
// others) and scrambles; light-AA streams aimed at base planes ON THE GROUND (taxiing / rolling: "AA at parked planes").
// Usage: node tests/base_bombard.js [--seeds 12] [--seed0 1] [--only bombard,bombard_ijn,midway,standard] [--json out.json]
'use strict';
const HL = require('./headless');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 12), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', null), JSON_OUT = arg('--json', null);
const SECS = +arg('--secs', 0);
// bombard: a USN base with a small covering force against an IJN bombardment group (Kongo and Haruna, 13-14 Oct 1942)
const SCEN = [
  { name: 'bombard', usn: ['carrier', 'destroyer', 'destroyer'], ijn: ['battleship', 'battleship', 'cruiser', 'destroyer', 'destroyer'], base: 'USN' },
  { name: 'bombard_ijn', usn: ['battleship', 'battleship', 'cruiser', 'destroyer', 'destroyer'], ijn: ['carrier', 'destroyer', 'destroyer'], base: 'IJN' },
  { name: 'midway', usn: ['carrier', 'cruiser', 'destroyer', 'destroyer'], ijn: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], base: 'USN' },
  { name: 'standard', random: true, base: 'alt' }
].filter(s => !ONLY || ONLY.split(',').includes(s.name));

function page(spec) {
  const G = WW.game, PI = Math.PI;
  WW.terrain.generate(spec.seed); WW.seedRandom(spec.seed); G.seed = spec.seed;
  const SLOTS = { carrier: [[0, 0], [0, -50]], battleship: [[72, -28], [72, 28]], cruiser: [[36, -64], [36, 64]], destroyer: [[98, -56], [100, 0], [98, 56]] };
  function nearestOk(x, z, type, placed) {
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, md = WW.SHIP_TYPES[type].minDepth + 1;
    const clear = (px, pz) => placed.every(p => { const n = G.minSpacing(type, p.type); return WW.dist2(px, pz, p.x, p.z) >= n * n; });
    for (const strict of [true, false]) for (let r = 0; r < 200; r += 3) {
      const n = Math.max(1, Math.round(r / 2));
      for (let i = 0; i < n; i++) {
        const a = i / n * PI * 2, px = WW.clamp(x + Math.cos(a) * r, 5, W - 5), pz = WW.clamp(z + Math.sin(a) * r, 8, H - 8);
        if (WW.terrain.isNavigable(px, pz, md) && (!strict || clear(px, pz))) return { x: px, z: pz, type };
      }
    }
    return { x, z, type };
  }
  let comp = G.randomComposition();
  if (!spec.random) {
    const z = {};
    for (const n of ['USN', 'IJN']) { const cv = comp.filter(e => e.nation === n && e.type === 'carrier'); z[n] = { rx: cv.reduce((s, e) => s + e.x, 0) / cv.length, cz: cv.reduce((s, e) => s + e.z, 0) / cv.length, dir: n === 'USN' ? 1 : -1 }; }
    comp = [];
    for (const n of ['USN', 'IJN']) {
      const placed = [], idx = {};
      for (const type of spec[n.toLowerCase()]) { const i = idx[type] = (idx[type] || 0) + 1, sl = SLOTS[type][(i - 1) % SLOTS[type].length]; const p = nearestOk(z[n].rx + z[n].dir * sl[0], z[n].cz + z[n].dir * sl[1], type, placed); placed.push(p); comp.push({ type, nation: n, x: p.x, z: p.z }); }
    }
  }
  if (WW.aces) WW.aces.reset();
  WW.seedRandom(spec.seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
  G.baseChoice = spec.base === 'alt' ? (spec.seed % 2 ? 'USN' : 'IJN') : spec.base;
  G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
  const B = WW.islandBase.base, LG = WW.landGround;
  const R = { owner: B && B.nation, shells: {}, rng: [], firstBomb: null, closedT: 0, opsShutT: 0, hpMin: 1, groundAA: 0, groundAAhit: 0, airAA: 0,
    pitAA: 0, batShots: 0, batHits: 0, batRange: [], strikes: [], scr: 0, land: 0, impacts: 0, splashes: 0, facOut: {}, events: {}, bombarders: {} };
  if (!B) return R;
  const onGround = p => p.carrier === B && LG.onGround(p), tok = {}; window.__bbTok = tok;
  const on = (n, f) => WW.on(n, e => { if (window.__bbTok === tok) f(e); }); // WW.on has no off: older rounds' listeners go quiet
  const L1 = on('shellFired', e => {
    const p = e && e.proj, s = e && e.ship; if (!p || !s) return;
    if (p.target === B && !s.isBattery) {
      const k = s.type + ':' + e.cal; R.shells[k] = (R.shells[k] || 0) + 1; R.rng.push(Math.round(WW.dist(s.x, s.z, B.x, B.z)));
      if (R.firstBomb === null) R.firstBomb = G.roundTime; R.bombarders[s.id] = s.type;
      p._bb = 1;
    } else p._bb = 0;
    if (s.isBattery) { R.batShots++; p._bat = 1; R.batRange.push(Math.round(WW.dist(s.x, s.z, p.target.x, p.target.z))); } else p._bat = 0;
  });
  const L2 = on('shellLanded', e => { if (e && e.proj && e.proj._bat && e.ship) R.batHits++; });
  const L3 = null;
  const imp0 = WW.islandBase.impact;
  WW.islandBase.impact = function (n, x, z, dmg, kind) { const r = imp0.apply(this, arguments); if (r) R.impacts++; return r; };
  const L4 = on('aaLightFired', e => {
    const s = e && e.ship, t = e && e.target; if (!s || !t) return;
    if (s.isBasePit) { R.pitAA++; return; }
    if (t.carrier === B) { if (onGround(t)) { R.groundAA++; if (e.hit) R.groundAAhit++; } else R.airAA++; }
  });
  const L5 = on('baseEvent', e => {
    if (!e || e.base !== B) return; R.events[e.kind] = (R.events[e.kind] || 0) + 1;
    if (e.kind === 'strikeOut' && e.target) R.strikes.push({ t: Math.round(G.roundTime), type: e.target.type, bomb: !!R.bombarders[e.target.id], d: Math.round(WW.dist(B.x, B.z, e.target.x, e.target.z)) });
    if (e.kind === 'scramble') R.scr++;
  });
  const cap = spec.secs ||WW.cfg.ROUND_TIMEOUT + 180;
  let shotsAt = -1e9;
  for (let t = 0; t < cap && G.state === 'battle'; t += 1) {
    __sim.fastForward(1);
    if (!WW.islandBase.runwayOpen()) R.closedT++;
    if (!LG.opsOpen(B)) R.opsShutT++;
    R.hpMin = Math.min(R.hpMin, B.hp / B.maxHp);
  }
  for (const f of B.facilities) if (f.out) R.facOut[f.kind] = (R.facOut[f.kind] || 0) + 1;
  R.groundLost = LG.stats.groundLost; R.neutAt = WW.islandBase.stats.neutralizedAt; R.hpEnd = B.hp / B.maxHp; R.len = Math.round(G.roundTime);
  R.st = WW.islandBase.stats; R.defStrikes = WW.landAir.stats.defStrikes || 0; R.landHits = WW.islandBase.stats.landHits; R.winner = G.winner || null;
  WW.islandBase.impact = imp0; window.__bbTok = null; void [L1, L2, L3, L4, L5];
  delete R.bombarders;
  return R;
}

(async () => {
  const b = await HL.launch(), specs = [];
  for (const sc of SCEN) for (let i = 0; i < SEEDS; i++) specs.push(Object.assign({}, sc, { seed: SEED0 + i, sc: sc.name, secs: SECS }));
  const out = [], q = specs.slice();
  async function worker() {
    const p = await b.newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
    await p.goto(HL.url()); await p.waitForFunction(() => window.__sim && window.WW && WW.game);
    while (q.length) { const s = q.shift(); const r = await p.evaluate(page, s); r.sc = s.sc; r.seed = s.seed; out.push(r); process.stderr.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, 2) }, worker));
  await b.close();
  console.log('\n' + HL.label());
  const med = a => { const s = a.filter(v => v !== null && v !== undefined).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const avg = a => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : null;
  for (const sc of SCEN) {
    const L = out.filter(r => r.sc === sc.name && r.owner); if (!L.length) continue;
    const sh = {}; L.forEach(r => { for (const k in r.shells) sh[k] = (sh[k] || 0) + r.shells[k]; });
    const bombed = L.filter(r => r.firstBomb !== null), shellsN = r => Object.values(r.shells).reduce((s, v) => s + v, 0);
    const st = {};
    L.forEach(r => r.strikes.forEach(s => { const k = (s.bomb ? 'bombarder:' : '') + s.type; st[k] = (st[k] || 0) + 1; }));
    console.log(`\n== ${sc.name} (${L.length} rounds) ==`);
    console.log(`  shells at base / round ${avg(L.map(shellsN))}  by shooter:cal ${JSON.stringify(sh)}  range p50 ${med([].concat(...L.map(r => r.rng)))}`);
    console.log(`  rounds bombarded ${bombed.length}/${L.length}; first bombard shell p50 ${med(bombed.map(r => r.firstBomb))} s; impacts on land / round ${avg(L.map(r => r.impacts))}`);
    console.log(`  neutralized ${L.filter(r => r.neutAt !== null).length}/${L.length}; t_neut p50 ${med(L.map(r => r.neutAt))}; time from 1st bombard shell to neut p50 ${med(bombed.filter(r => r.neutAt !== null).map(r => Math.round(r.neutAt - r.firstBomb)))}`);
    console.log(`  base hp min avg ${avg(L.map(r => r.hpMin))}, end ${avg(L.map(r => r.hpEnd))}; runway closed s/round ${avg(L.map(r => r.closedT))}; ops shut ${avg(L.map(r => r.opsShutT))}; planes wrecked on ground ${avg(L.map(r => r.groundLost))}`);
    const fo = {}; L.forEach(r => { for (const k in r.facOut) fo[k] = (fo[k] || 0) + r.facOut[k]; });
    console.log(`  facilities out (total): ${JSON.stringify(fo)}`);
    console.log(`  coastal battery shots / round ${avg(L.map(r => r.batShots))}, hits ${avg(L.map(r => r.batHits))}, range p50 ${med([].concat(...L.map(r => r.batRange)))}`);
    console.log(`  ship light AA at base planes ON THE GROUND / round ${avg(L.map(r => r.groundAA))} (hits ${avg(L.map(r => r.groundAAhit))}); in the air ${avg(L.map(r => r.airAA))}; base pit AA streams ${avg(L.map(r => r.pitAA))}`);
    console.log(`  base strikes by target ${JSON.stringify(st)}; scrambles / round ${avg(L.map(r => r.scr))}; self-defence strikes / round ${avg(L.map(r => r.defStrikes))}; land hits on ships / round ${avg(L.map(r => r.landHits))}`);
  }
  if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(2); });
