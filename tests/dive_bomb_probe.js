// Dive bombing accuracy (read-only recorder: bus events, no WW.rand, no writes to sim objects). Per dive-bomb release
// (a carrier dive bomber's bomb dropped with plane.dropV, the dive release):
//   release angle  between the bomb's initial velocity and the plane's dive velocity (deg): the bomb should leave
//                  along the dive line
//   miss distance  from the impact to the aimed ship's hull (u; 1 u ~ 9.6 m; the hull as combat.js onHull: length L,
//                  half-beam 0.12 L): hit, near miss (close aboard, <= NEAR u), or miss, by the opposition the bomber
//                  flew into (air_intercept.js pressure at the release: light < 0.2 <= medium < 0.5 <= heavy) and by
//                  target (carrier undefended / defended: other ships' AA within 60, destroyer, other)
//   near misses    ship damage from bomb near misses (shipHit kind 'near') per round
// Usage: node tests/dive_bomb_probe.js [--seeds N=8] [--seed0 S=1] [--only standard,carrier_duel,midway,cvpt,odd] [--workers K]
'use strict';
const HL = require('./headless');
const SB = require('./sim_behaviour');
const P2 = require('./planes2_review');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 8), SEED0 = +arg('--seed0', 1), ONLY = arg('--only', 'standard,carrier_duel,midway,cvpt,odd').split(',');
const NEAR = 2.5;

function install(NEAR) {
  const R = window.__db = {};
  let S;
  const fresh = () => { S = { proj: new Map(), done: [], near: 0, nearN: 0 }; };
  fresh(); WW.on('roundStart', fresh);
  const deg = (ax, ay, az, bx, by, bz) => { const d = (ax * bx + ay * by + az * bz) / ((Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) || 1); return Math.acos(Math.max(-1, Math.min(1, d))) * 57.3; };
  WW.on('weaponDropped', e => {
    const p = e && e.plane, b = e && e.proj;
    if (!p || e.kind !== 'bomb' || p.kind !== 'dive' || !p.dropV || !b || (p.carrier && p.carrier.isBase)) return;
    const t = e.target; if (!t || !t.alive || t.isBase || t.isLand || !t.stats) return;
    let esc = 0; for (const s of WW.world.ships) if (s !== t && s.alive && !s.sinking && s.nation === t.nation && s.stats && s.stats.aa && Math.hypot(s.x - t.x, s.z - t.z) < 60) esc += s.stats.aa.dps;
    const pr = WW.intercept && WW.intercept.pressure ? WW.intercept.pressure(p, t) : 0;
    const V = p.dropV;
    S.proj.set(b, { t, type: t.type, def: esc > 3, lvl: pr < 0.2 ? 'light' : pr < 0.5 ? 'medium' : 'heavy', ang: deg(b.vx, b.vy, b.vz, V.x, V.y, V.z), y: b.y, res: null, d: null });
  });
  WW.on('shipHit', e => { if (e && e.kind === 'near') { S.near += e.amount || 0; S.nearN++; } });
  WW.on('weaponImpact', e => {
    if (!e || e.kind !== 'bomb') return;
    const D = S.proj.get(e.proj); if (!D) return;
    S.proj.delete(e.proj);
    const t = D.t; D.t = null;
    if (e.ship) { D.res = e.ship === t ? 'hit' : 'other'; D.d = 0; S.done.push(D); return; }
    const L = Math.max(5, (t.stats && t.stats.length) || 10), c = Math.cos(t.heading || 0), s = Math.sin(t.heading || 0), dx = e.x - t.x, dz = e.z - t.z;
    const al = Math.abs(dx * c + dz * s) - L / 2, ac = Math.abs(-dx * s + dz * c) - L * 0.12;
    D.d = Math.hypot(Math.max(0, al), Math.max(0, ac)); D.res = D.d <= NEAR ? 'near' : 'miss';
    S.done.push(D);
  });
  R.flush = () => { const o = { drops: S.done, near: S.near, nearN: S.nearN }; fresh(); return o; };
}

function report(rounds) {
  const A = [].concat(...rounds.map(r => r.drops)), pc = x => (100 * x).toFixed(0) + '%';
  const qs = (a, q) => { if (!a.length) return '-'; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
  console.log(`\n${rounds.length} rounds, ${A.length} dive bombs released at a ship`);
  console.log(`release angle off the dive line (deg) p50/p90/max: ${qs(A.map(d => d.ang), 0.5)} / ${qs(A.map(d => d.ang), 0.9)} / ${qs(A.map(d => d.ang), 1)}; release height p50 ${qs(A.map(d => d.y), 0.5)} u`);
  const B = [[0, 1], [1, NEAR], [NEAR, 5], [5, 10], [10, 1e9]];
  console.log(`group                   bombs  hit   near(<=${NEAR}u)  miss | miss distance off the hull: ` + B.map(([a, b]) => `${a}-${b > 1e8 ? '' : b}`).join('  '));
  const row = (lab, X) => {
    if (!X.length) return;
    const H = X.filter(d => d.res === 'hit' || d.res === 'other'), N = X.filter(d => d.res === 'near'), M = X.filter(d => d.d > 0);
    console.log(`${lab.padEnd(22)}  ${String(X.length).padStart(5)}  ${pc(H.length / X.length).padStart(4)}  ${pc(N.length / X.length).padStart(10)}  ${pc((X.length - H.length - N.length) / X.length).padStart(5)} | ` + B.map(([a, b]) => String(M.filter(d => d.d >= a && d.d < b).length).padStart(5)).join(' '));
  };
  row('all', A);
  for (const L of ['light', 'medium', 'heavy']) row(L, A.filter(d => d.lvl === L));
  row('carrier, undefended', A.filter(d => d.type === 'carrier' && !d.def));
  row('carrier, defended', A.filter(d => d.type === 'carrier' && d.def));
  for (const ty of ['battleship', 'cruiser', 'destroyer']) row(ty, A.filter(d => d.type === ty));
  const nn = rounds.reduce((s, r) => s + r.nearN, 0), nd = rounds.reduce((s, r) => s + r.near, 0);
  console.log(`near-miss damage: ${nn} near misses that hurt, ${(nd / rounds.length).toFixed(0)} hp per round`);
}

(async () => {
  const list = [];
  for (const sc of ONLY) for (let s = SEED0; s < SEED0 + SEEDS; s++) list.push(P2.specFor(sc, s));
  console.log(`dive_bomb_probe: ${list.length} rounds (${HL.label()})`);
  const b = await HL.launch(); const res = []; let next = 0;
  async function worker() {
    const p = await b.newPage();
    await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; if (__sim.setScale) __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    await p.evaluate(install, NEAR);
    while (next < list.length) {
      const spec = list[next++];
      res.push(await p.evaluate(spec => { window.__beh.run(spec); return __db.flush(); }, spec));
      process.stdout.write('.');
    }
    await p.close();
  }
  await Promise.all(Array.from({ length: Math.min(HL.WORKERS, list.length) }, worker));
  await b.close();
  report(res);
})().catch(e => { console.error(e); process.exit(1); });
