// The island base's land bombers (B-17, B-26, Betty) at home and over the target (read-only recorder: no WW.rand, no
// writes to sim state; it wraps Plane damage / shotDown / ditch and WW.air.update only to look).
// (a) home: per land-bomber sortie the time from reaching the field (state 'landing') to touchdown, the time stacked or
//     holding (circuit, not cleared; or holding / leaving with no runway), its mean height, how much of it was spent
//     within an enemy ship's heavy-AA reach or with an enemy fighter within 80 u, the damage taken in each phase (out /
//     home / hold / approach / leaving) by source (ship AA, enemy base AA pits, own AA, enemy fighters), and losses per
//     phase (shot down; ditched or diverted after a hold).
// (b) level bombing (B-17 / Betty level variants): the release height, the time from take-off to release and the share of
//     the run's last 150 u flown above 90% of the bombing height, and the hits: ship bombs that hit, base bombs within
//     6 u of the aim point.
// (c) the field: touchdowns per round (every type) and the touchdown-to-touchdown interval (gaps under 60 s).
// Usage: node tests/land_bomber_probe.js [--only midway,ijnbase] [--seeds N=8] [--seed0 S=1] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,ijnbase').split(',');
const MW = SB.SCEN.find(s => s.name === 'midway');
const SC = {
  midway: { A: MW.A, B: MW.B, aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};
const spec = (sc, seed) => ({ seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN, base: SC[sc].base, cripple: -1, noStall: false, light: true, scen: sc });

function install() {
  const R = window.__lb = {}, BIG = { b17: 1, b26: 1, g4m: 1, g4mL: 1 }, DT = 0.5;
  let S = null, next = 0, seen = null;
  const fresh = () => { S = { sorties: {}, home: [], dmg: {}, lost: {}, drops: [], bombs: new Map(), holdN: 0, homeLoss: [], td: [], tdSeen: new WeakSet() }; next = 0; seen = new Map(); };
  fresh(); WW.on('roundStart', fresh);
  const inc = (o, k, v) => { o[k] = (o[k] || 0) + (v === undefined ? 1 : v); };
  const big = p => p && p.carrier && p.carrier.isBase && BIG[p.variant];
  function phase(p) {
    if (p.leaving) return 'leave';
    if (p.state === 'landing') return p.rwPh === 'final' || p.cleared ? 'app' : 'hold';
    if (p.state === 'return') return 'home';
    if (p.state === 'takeoff' || p.state === 'rollout') return 'ground';
    return 'out';
  }
  function rec(p) {
    let r = seen.get(p);
    if (!r) { r = { v: p.variant, t0: WW.game.roundTime, land0: null, td: null, hold: 0, holdY: 0, holdAA: 0, holdF: 0, holdIsle: 0, end: null, run: 0, runHi: 0 }; seen.set(p, r); inc(S.sorties, p.variant); }
    return r;
  }
  const P = WW.Plane.prototype, D0 = P.damage, SD0 = P.shotDown, DI0 = P.ditch;
  P.damage = function (amt) {
    if (big(this) && this.alive) {
      const kb = this.killedBy, src = kb && kb.isBasePit ? (kb.nation === this.nation ? 'ownAA' : 'baseAA') : kb && kb.stats ? 'shipAA' : 'fighter';
      inc(S.dmg, phase(this) + '|' + src, Math.min(amt, Math.max(0, this.hp)));
    }
    return D0.apply(this, arguments);
  };
  P.shotDown = function () {
    if (big(this) && this.alive) {
      const ph = phase(this), kb = this.killedBy, B = this.carrier;
      inc(S.lost, ph); rec(this).end = 'shot:' + ph;
      if (ph === 'home') S.homeLoss.push({ db: Math.round(Math.hypot(this.x - B.x, this.z - B.z)), y: Math.round(this.y), by: kb && kb.isBasePit ? 'pit' : kb && kb.stats ? 'ship' : 'ftr', crip: !!this.crippled });
    }
    return SD0.apply(this, arguments);
  };
  P.ditch = function () { if (big(this) && this.alive) { const ph = phase(this); inc(S.lost, ph === 'leave' ? 'ditchHold' : 'ditch:' + ph); rec(this).end = 'ditch'; } return DI0.apply(this, arguments); };
  WW.on('baseEvent', e => { if (e && e.kind === 'divert' && big(e.plane)) inc(S.lost, 'divert'); });
  WW.on('weaponDropped', e => {
    const p = e && e.plane; if (!big(p) || !p.level || e.kind !== 'bomb') return;
    const t = e.target, r = rec(p);
    const d = { v: p.variant, y: +p.y.toFixed(1), alt: +(p.lvA || p.level.alt).toFixed(1), ship: !!(t && !t.isBase), ax: t ? t.x : 0, az: t ? t.z : 0, tt: +(WW.game.roundTime - r.t0).toFixed(0), hi: r.run ? r.runHi / r.run : 0, hit: 0, miss: null };
    S.drops.push(d); S.bombs.set(e.proj, d);
  });
  WW.on('weaponImpact', e => {
    const d = e && S.bombs.get(e.proj); if (!d) return; S.bombs.delete(e.proj);
    if (d.ship) { d.hit = e.ship ? 1 : 0; } else { d.miss = Math.hypot(e.x - d.ax, e.z - d.az); d.hit = d.miss < 6 ? 1 : 0; }
  });
  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += DT; sample(); }
    return r0;
  };
  function sample() {
    const PL = WW.world.planes, B = WW.islandBase && WW.islandBase.base;
    for (const p of PL) if (B && p.carrier === B && p.alive && p.state === 'rollout' && !S.tdSeen.has(p)) { S.tdSeen.add(p); S.td.push(WW.game.roundTime); }
    for (const p of PL) {
      if (!big(p) || !p.alive || p.removed) continue;
      const r = rec(p), ph = phase(p);
      if (p.state === 'landing' && r.land0 === null) r.land0 = WW.game.roundTime;
      if (p.state === 'rollout' && r.td === null) { r.td = WW.game.roundTime; if (r.land0 !== null) S.home.push({ v: r.v, t: r.td - r.land0, hold: r.hold }); }
      if (p.level && p.ordnance && (p.state === 'transit' || p.state === 'attack') && p.target) {
        const t = p.target, d = WW.dist(p.x, p.z, t.x, t.z);
        if (d < 150) { r.run += DT; if (p.y > (p.lvA || p.level.alt) * 0.9) r.runHi += DT; }
      }
      if (ph !== 'hold' && ph !== 'leave') continue;
      r.hold += DT; r.holdY += p.y * DT; S.holdN += DT;
      let aa = false, f = false;
      for (const s of WW.world.ships) {
        if (!s.alive || s.sinking || s.submerged || s.nation === p.nation || !s.stats || !s.stats.aa) continue;
        if (Math.hypot(s.x - p.x, s.z - p.z, p.y) < s.stats.aa.range * 2.2) { aa = true; break; }
      }
      for (const q of PL) if (q.alive && q.nation !== p.nation && q.kind === 'fighter' && q.y > 2 && Math.hypot(q.x - p.x, q.z - p.z) < 80) { f = true; break; }
      if (aa) r.holdAA += DT; if (f) r.holdF += DT;
      if (B && Math.hypot(p.x - B.x, p.z - B.z) < 110) r.holdIsle += DT;
    }
  }
  R.flush = () => {
    const rs = [...seen.values()];
    const gaps = []; for (let i = 1; i < S.td.length; i++) if (S.td[i] - S.td[i - 1] < 60) gaps.push(S.td[i] - S.td[i - 1]);
    const o = { gaps, tdN: S.td.length, homeLoss: S.homeLoss, sorties: S.sorties, home: S.home, dmg: S.dmg, lost: S.lost, drops: S.drops.map(d => ({ v: d.v, y: d.y, alt: d.alt, ship: d.ship, tt: d.tt, hi: d.hi, hit: d.hit, miss: d.miss })),
      hold: rs.filter(r => r.hold > 0).map(r => ({ v: r.v, t: r.hold, y: r.holdY / r.hold, aa: r.holdAA, f: r.holdF, isle: r.holdIsle })) };
    fresh(); return o;
  };
}

(async () => {
  const list = []; for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(spec(sc, s));
  const b = await HL.launch(), res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P); await p.evaluate(install);
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { window.__beh.run(sp); return window.__lb.flush(); }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '-'), pc = (a, n) => (n ? (100 * a / n).toFixed(1) + '%' : '-');
  const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  for (const sc of ONLY.concat(ONLY.length > 1 ? ['ALL'] : [])) {
    const L = sc === 'ALL' ? res : res.filter(r => r.scen === sc), N = L.length || 1;
    const add = k => { const o = {}; for (const r of L) for (const x in r[k]) o[x] = (o[x] || 0) + r[k][x]; return o; };
    const so = add('sorties'), dm = add('dmg'), lo = add('lost'), H = L.flatMap(r => r.hold), HM = L.flatMap(r => r.home), DR = L.flatMap(r => r.drops);
    console.log(`\n${sc} (${L.length} rounds) land-bomber sorties: ${Object.keys(so).map(k => k + ' ' + so[k]).join(', ')}`);
    const ht = H.reduce((s, h) => s + h.t, 0);
    console.log(`  home: field -> touchdown median ${f1(med(HM.map(h => h.t)))} s (max ${f1(Math.max(0, ...HM.map(h => h.t)))}, n ${HM.length}); holding: ${H.length} sorties, ${f1(ht / N)} plane-s/rd, median ${f1(med(H.map(h => h.t)))} s, max ${f1(Math.max(0, ...H.map(h => h.t)))} s`);
    const G = L.flatMap(r => r.gaps);
    console.log(`  field: ${f1(L.reduce((s, r) => s + r.tdN, 0) / N)} touchdowns/rd (all types), touchdown-to-touchdown median ${f1(med(G))} s (gaps < 60 s, n ${G.length})`);
    console.log(`  holding: mean height ${f1(ht ? H.reduce((s, h) => s + h.y * h.t, 0) / ht : NaN)} u, over the island (<110 u) ${pc(H.reduce((s, h) => s + h.isle, 0), ht)}, in enemy ship heavy-AA reach ${pc(H.reduce((s, h) => s + h.aa, 0), ht)}, enemy fighter within 80 u ${pc(H.reduce((s, h) => s + h.f, 0), ht)}`);
    const PH = ['out', 'home', 'hold', 'app', 'leave'], SRC = ['shipAA', 'baseAA', 'ownAA', 'fighter'];
    console.log('  damage /rd ' + 'phase'.padEnd(6) + SRC.map(s => s.padStart(9)).join('') + '   lost (shot down)');
    for (const ph of PH) console.log('             ' + ph.padEnd(6) + SRC.map(s => f1((dm[ph + '|' + s] || 0) / N).padStart(9)).join('') + String(lo[ph] || 0).padStart(9));
    console.log('  lost going home (base dist / height / by / crippled): ' + L.flatMap(r => r.homeLoss).map(h => `${h.db}/${h.y}/${h.by}${h.crip ? '/c' : ''}`).join(' '));
    console.log(`  ditched after a hold ${lo.ditchHold || 0}, diverted ${lo.divert || 0}, other ditch ${Object.keys(lo).filter(k => /^ditch:/.test(k)).map(k => k + ' ' + lo[k]).join(' ') || 0}`);
    for (const v of ['b17', 'g4mL']) for (const ship of [true, false]) {
      const D = DR.filter(d => d.v === v && d.ship === ship); if (!D.length) continue;
      const miss = D.filter(d => d.miss !== null).map(d => d.miss);
      console.log(`  level ${v.padEnd(4)} on ${ship ? 'ships' : 'base '}: ${D.length} bombs, release height median ${f1(med(D.map(d => d.y)))} u (want ${D[0].alt}, min ${f1(Math.min(...D.map(d => d.y)))}), take-off -> release median ${f1(med(D.map(d => d.tt)))} s, run (last 150 u) at height ${pc(D.reduce((s, d) => s + d.hi, 0), D.length)}, hits ${D.reduce((s, d) => s + d.hit, 0)} (${pc(D.reduce((s, d) => s + d.hit, 0), D.length)})` + (miss.length ? `, miss median ${f1(med(miss))} u` : ''));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
