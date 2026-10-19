// Take-off hand-off probe: every live sim step (1/120 s, __sim.stepFixed, as the live game steps) of the first few
// carrier deck launches (USN and IJN) and catapult scout launches of a round, from the start of the deck run (or the
// catapult slide) to 4 s after the bow. Per step: phase, p.speed, the ground speed along the plane's heading measured
// from its positions (dx / dt), the speed relative to the carrier, vy, height over the deck, pitch, and (render mode)
// the prop look (disc / blades visible). Reports per launch: the bow speed, the lowest speed in the 4 s after the bow
// (a drop = the bug), the first climb, and every step where the prop look goes back to blades after the disc showed.
// Usage: node tests/takeoff_probe.js [--seeds 1,2,3] [--n 3] [--json out.json] [--render | --browser]
'use strict';
const HL = require('./headless');
const argv = HL.argv, arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = arg('--seeds', '1,2,3,4').split(',').map(Number), NMAX = +arg('--n', 3), JSON_OUT = arg('--json', null);

function install() {
  window.__tp = function (seed, nmax, cap) {
    const G = WW.game;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.composition = comp; G.startRound({ keepMap: true }); G.composition = null;
    const dt = __sim.LIVE_STEP, rec = new Map(), done = [], per = {};
    const want = p => p.alive && !p.removed && p.carrier && !p.carrier.isBase &&
      ((p.state === 'takeoff' && p.deckPh === 'run') || (p.kind === 'scout' && p.state === 'catapult' && p.t > 2.4));
    let steps = 0;
    const limit = cap / dt;
    while (G.state === 'battle' && steps < limit) {
      __sim.stepFixed(1); steps++;
      for (const p of WW.world.planes) {
        let R = rec.get(p);
        if (!R) {
          if (!want(p)) continue;
          const key = p.nation + ':' + p.kind;
          if ((per[key] = (per[key] || 0) + 1) > nmax) { rec.set(p, null); continue; }
          R = { seed, nation: p.nation, kind: p.kind, cv: (p.carrier.cls && p.carrier.cls.key) || p.carrier.type, rows: [], bowT: null, px: p.x, pz: p.z, py: p.y };
          rec.set(p, R); continue;
        }
        if (R === null || R.end) continue;
        const c = p.carrier, gx = (p.x - R.px) / dt, gz = (p.z - R.pz) / dt, gy = (p.y - R.py) / dt;
        R.px = p.x; R.pz = p.z; R.py = p.y;
        const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
        const ground = gx * ch + gz * sh, cvAlong = c.speed * Math.cos(c.heading - p.heading);
        const m = p.model, ph = p.state === 'takeoff' ? p.deckPh : p.state;
        const off = ph === 'climb' || (p.kind === 'scout' && p.state !== 'catapult');
        if (off && R.bowT === null) R.bowT = R.rows.length;
        R.rows.push({ ph, sp: +p.speed.toFixed(3), gs: +ground.toFixed(3), rel: +(ground - cvAlong).toFixed(3), cv: +c.speed.toFixed(2),
          vy: +gy.toFixed(3), h: +(p.y - (c._deck ? c._deck.dy : c.group.position.y)).toFixed(3), pitch: +(p.pitch || 0).toFixed(4),
          disc: m && m.disc ? (m.disc.visible ? 1 : 0) : -1, blades: m && m.blades ? (m.blades.visible ? 1 : 0) : -1 });
        if (R.bowT !== null && R.rows.length - R.bowT > 4 / dt) { R.end = true; done.push(R); }
        if (!p.alive || p.removed) { R.end = 'lost'; done.push(R); }
      }
      if (done.length >= nmax * 5 && [...rec.values()].every(r => r === null || r.end)) break;
    }
    return done.map(R => { delete R.px; delete R.pz; delete R.py; return R; });
  };
}

function summary(R) {
  const rows = R.rows, b = R.bowT;
  if (b === null || b < 1) return { ...R, rows: undefined, note: 'never left' };
  const pre = rows[b - 1], after = rows.slice(b), dt = 1 / 120;
  let minGs = 1e9, minAt = 0, maxDrop = 0, peak = pre.gs;
  after.forEach((r, i) => { if (r.gs < minGs) { minGs = r.gs; minAt = i; } peak = Math.max(peak, r.gs); maxDrop = Math.max(maxDrop, peak - r.gs); });
  // biggest single-step speed change around the bow (a snap), and the steepest deceleration over any 0.25 s window after it
  let snap = 0; for (let i = Math.max(1, b - 5); i < Math.min(rows.length, b + 6); i++) snap = Math.max(snap, Math.abs(rows[i].sp - rows[i - 1].sp));
  let minAcc = 1e9; const W = 30; for (let i = b - 30; i + W < rows.length; i++) if (i >= 0) minAcc = Math.min(minAcc, (rows[i + W].gs - rows[i].gs) / (W * dt));
  let sawDisc = false, flick = [];
  rows.forEach((r, i) => { if (r.disc === 1) sawDisc = true; else if (sawDisc && r.disc === 0) flick.push(i - b); });
  const discOn = rows.findIndex(r => r.disc === 1);
  const minH = Math.min(...after.map(r => r.h)), climb = after.findIndex(r => r.vy > 0.5);
  return { seed: R.seed, plane: R.nation + ' ' + R.kind, carrier: R.cv, end: R.end, cvSpeed: pre.cv, bowSp: pre.sp, bowGs: pre.gs, bowRel: pre.rel,
    firstAfterGs: after[0].gs, minGsAfter: +minGs.toFixed(2), minAtS: +(minAt * dt).toFixed(2), dropFromPeak: +maxDrop.toFixed(2), snapStep: +snap.toFixed(3),
    minAccel: +minAcc.toFixed(2), gs4s: after[after.length - 1].gs, dipBelowDeck: +minH.toFixed(2), climbAtS: climb < 0 ? null : +(climb * dt).toFixed(2),
    discOnStep: discOn < 0 ? null : discOn - b, propFlickerSteps: flick.length, flickAt: flick.slice(0, 6) };
}

(async () => {
  const b = await HL.launch(), p = await b.newPage();
  p.on('pageerror', e => console.error('pageerror', e.message || e));
  await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
  await p.waitForTimeout(HL.settle());
  await p.evaluate(install);
  const all = [];
  for (const s of SEEDS) {
    const r = await p.evaluate(a => window.__tp(a[0], a[1], a[2]), [s, NMAX, 400]);
    all.push(...r);
  }
  const S = all.map(summary);
  console.log(`takeoff probe (${HL.label()}), seeds ${SEEDS.join(',')}: ${S.length} launches`);
  for (const s of S) console.log(JSON.stringify(s));
  const agg = k => { const v = S.filter(x => x[k] !== undefined && x[k] !== null).map(x => x[k]); return v.length ? { min: Math.min(...v), max: Math.max(...v), mean: +(v.reduce((a, c) => a + c, 0) / v.length).toFixed(2) } : null; };
  console.log('dropFromPeak', JSON.stringify(agg('dropFromPeak')), ' minAccel', JSON.stringify(agg('minAccel')), ' snapStep', JSON.stringify(agg('snapStep')),
    ' propFlickerSteps', JSON.stringify(agg('propFlickerSteps')));
  if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(all));
  await b.close();
})();
