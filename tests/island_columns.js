// The planes circling over the island base (read-only recorder: no WW.rand, no writes to sim state; it wraps
// WW.air.update only to look). Every 0.5 s of battle, every airborne plane within NEAR (150 u) of the field is put in a
// group (own base planes: CAP, scramble fight, strike forming, escort forming, strike out, level climb, holding,
// approach, home, guest; the side's carrier planes; the enemy's by what it is doing) and called circling when its
// heading turned faster than TURN rad/s over the last WIN s. Reports per round: the plane-seconds circling within ISLE
// (110 u) of the field by group, their mean height and height spread, and the peak number circling there at once.
// Usage: node tests/island_columns.js [--only midway,ijnbase] [--seeds N=4] [--seed0 S=1] [--workers K] [--t1 T]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 4), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'midway,ijnbase').split(',');
const MW = SB.SCEN.find(s => s.name === 'midway');
const SC = {
  midway: { A: MW.A, B: MW.B, aN: 'USN', base: 'USN' },
  ijnbase: { A: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], aN: 'USN', base: 'IJN' }
};
const spec = (sc, seed) => ({ seed, A: SC[sc].A, B: SC[sc].B, aNation: SC[sc].aN, base: SC[sc].base, cripple: -1, noStall: false, light: true, scen: sc });

function install() {
  const R = window.__ic = {}, DT = 0.5, NEAR = 150, ISLE = 110, WIN = 6, TURN = 0.12;
  let S = null, next = 0, hist = null;
  const fresh = () => { S = { g: {}, peak: 0, peakT: 0, peakG: null, tl: [] }; next = 0; hist = new WeakMap(); };
  fresh(); WW.on('roundStart', fresh);
  function group(p, B) {
    if (p.carrier === B) {
      if (!p.variant) return 'guest:' + p.state + (R.detail && p.state === 'landing' ? ':' + (p.rwPh === 'final' ? 'final' : p.cleared ? (p.apOut ? 'gate' : 'om') : p.called ? 'called' : 'wait') : '');
      if (p.state === 'landing') { if (p.rwPh === 'final' || p.cleared) return 'approach'; if (!R.detail) return 'hold';
        const F = p.mfix || (B.ai.hfix && B.ai.hfix[WW.landHold.big(p) ? 'L' : 'S']), df = F ? Math.hypot(p.x - F.x, p.z - F.z) : -1;
        return 'hold:' + (p.holdT > 0 ? 'shut' : B.ai.raid ? 'raid' : 'q') + ':' + (df < 0 ? 'nofix' : df < 70 ? 'atFix' : 'toFix'); }
      if (p.state === 'return') return 'home';
      if (p.state === 'takeoff') return 'climbout';
      if (p.sk === 'form' && p.wave) return (p.kind === 'fighter' ? 'escort' : 'strike') + (p.wave.go ? 'Out' : 'Form');
      if (p.level && p.lvC) return 'levelClimb';
      if (p.level) return 'level:' + (p.lvPh || p.state);
      if (R.detail && p.kind === 'fighter' && !p.target && !p.foe && !p.vec) return 'cap:' + (p.leader ? 'wing' : 's' + WW.cap.sectionIndex(p)) + (p.joined ? ':join' : '') + ':' + p.state;
      if (p.kind === 'fighter' && !p.target) return p.foe ? 'capFight' : p.vec ? 'capVector' : p.joined ? 'capJoin' : 'cap';
      return 'own:' + p.kind + ':' + p.state + (p.sk ? ':' + p.sk : '');
    }
    if (p.nation === B.nation) return 'cv:' + p.kind + ':' + p.state;
    return 'enemy:' + p.kind + ':' + (p.sk === 'form' ? 'form' : p.state) + (p.level ? ':lvl' : '');
  }
  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    if (WW.game && WW.game.state === 'battle') while (WW.game.roundTime >= next) { next += DT; sample(); }
    return r0;
  };
  function sample() {
    const B = WW.islandBase && WW.islandBase.base; if (!B) return;
    const now = WW.game.roundTime; let nC = 0; const cg = {};
    for (const p of WW.world.planes) {
      if (!p.alive || p.removed || p.y < B.site.padH + 3 || p.state === 'rollout') continue;
      const d = Math.hypot(p.x - B.x, p.z - B.z); if (d > NEAR) continue;
      let h = hist.get(p); if (!h) hist.set(p, h = []);
      h.push({ t: now, a: p.heading }); while (h.length && now - h[0].t > WIN) h.shift();
      let turned = 0; for (let i = 1; i < h.length; i++) turned += Math.abs(WW.angleDiff(h[i - 1].a, h[i].a));
      const span = h.length > 1 ? h[h.length - 1].t - h[0].t : 0, circ = span >= WIN * 0.8 && turned / span > TURN;
      const g = group(p, B), o = S.g[g] || (S.g[g] = { near: 0, isle: 0, circ: 0, y: 0, y2: 0, ymin: 1e9, ymax: -1e9 });
      o.near += DT; if (d < ISLE) o.isle += DT;
      if (d < ISLE && circ) { o.circ += DT; o.y += p.y * DT; o.y2 += p.y * p.y * DT; o.ymin = Math.min(o.ymin, p.y); o.ymax = Math.max(o.ymax, p.y); nC++; cg[g] = (cg[g] || 0) + 1; }
    }
    if (nC > S.peak) { S.peak = nC; S.peakT = now; S.peakG = cg; }
    if (Math.round(now * 2) % 20 === 0) S.tl.push(nC);
  }
  R.flush = () => { const o = { g: S.g, peak: S.peak, peakT: S.peakT, peakG: S.peakG, tl: S.tl }; fresh(); return o; };
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
    await p.evaluate(SB.install, SB.P); await p.evaluate(install); if (argv.includes('--detail')) await p.evaluate(() => { window.__ic.detail = true; });
    while (next < list.length) { const sp = list[next++]; res.push(Object.assign({ scen: sp.scen, seed: sp.seed }, await p.evaluate(sp => { window.__beh.run(sp); return window.__ic.flush(); }, sp))); process.stdout.write('.'); }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close(); console.log('');
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '-');
  for (const sc of ONLY) {
    const L = res.filter(r => r.scen === sc), N = L.length || 1, G = {};
    for (const r of L) for (const k in r.g) { const a = G[k] || (G[k] = { near: 0, isle: 0, circ: 0, y: 0, y2: 0, ymin: 1e9, ymax: -1e9 }), o = r.g[k]; for (const f of ['near', 'isle', 'circ', 'y', 'y2']) a[f] += o[f]; a.ymin = Math.min(a.ymin, o.ymin); a.ymax = Math.max(a.ymax, o.ymax); }
    const tot = Object.values(G).reduce((s, o) => s + o.circ, 0);
    console.log(`\n${sc} (${L.length} rounds): circling within 110 u of the field ${f1(tot / N)} plane-s/rd; peak at once (median of rounds) ${L.map(r => r.peak).sort((a, b) => a - b)[L.length >> 1]}`);
    console.log('  group                       near/rd  isle/rd  CIRC/rd   mean y   sd y   min-max y');
    for (const k of Object.keys(G).sort((a, b) => G[b].circ - G[a].circ || G[b].isle - G[a].isle)) {
      const o = G[k], m = o.circ ? o.y / o.circ : NaN, sd = o.circ ? Math.sqrt(Math.max(0, o.y2 / o.circ - m * m)) : NaN;
      console.log(`  ${k.padEnd(26)} ${f1(o.near / N).padStart(8)} ${f1(o.isle / N).padStart(8)} ${f1(o.circ / N).padStart(8)} ${f1(m).padStart(8)} ${f1(sd).padStart(6)}   ${o.circ ? f1(o.ymin) + '-' + f1(o.ymax) : ''}`);
    }
    for (const r of L) console.log(`  seed ${r.seed}: peak ${r.peak} at ${f1(r.peakT)} s ${JSON.stringify(r.peakG)}; circling every 10 s: ${r.tl.join(' ')}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
