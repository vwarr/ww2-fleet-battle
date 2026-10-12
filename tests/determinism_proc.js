// Cross-process determinism check (node runner): the same seeded round must be bit-identical in every fresh
// process and whatever ran before it in the same worker. tests/determinism.js compares runs inside one process;
// this one spawns a fresh Node process per run, so JIT tiering, hash seeds, isolate start-up and module-level
// state left by earlier rounds all get a chance to differ.
// Per (scenario, seed) it runs, each in its own fresh process (one worker):
//   - --procs N runs of the seed alone;
//   - --prior K runs where the seed follows other rounds in the same worker (prior seeds seed+1000.., and another
//     scenario), as sim_behaviour.js does when a worker plays several specs in a row.
// A run records a trace every --every sim seconds (default 0.5): all ships (id, x, z, heading, speed, hp, alive,
// sinking), live planes (x, y, z, heading, hp, state) and WW.stats, plus the count of WW.rand and Math.random calls
// (the sim must not call Math.random). Every trace must equal the first; on a mismatch it prints the first
// divergent time and entity, and the WW.rand counts at that sample.
// Rounds use sim_behaviour.js B.run (the suite's own setup) with spec.light and spec.step = --every.
// Usage: node tests/determinism_proc.js [--seeds 1-20 | 1,4,7] [--only midway,standard] [--procs 2] [--prior 2]
//        [--secs S (stop each round at S sim s; default the round's end)] [--workers 2 (processes at once)]
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const NS = require('./node_sim');
NS.ensureV8();
const A = process.argv.slice(2), arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };

const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  surface: { A: ['battleship', 'cruiser', 'destroyer', 'destroyer'], B: ['battleship', 'cruiser', 'destroyer', 'destroyer'] }
};
function spec(scen, seed, every, secs) {
  const sc = SCEN[scen];
  const s = sc.random ? { seed, random: true } :
    { seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: -1, noStall: false, base: sc.base || null };
  return Object.assign(s, { light: true, step: every, until: secs || undefined, scen });
}

// ---------------- child: one fresh process, one worker, runs `prior` specs then traces `spec` ----------------
async function child(job) {
  const SB = require('./sim_behaviour');
  const b = await NS.launch(), p = await b.newPage(), errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto('index.html?sim');
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
  await p.evaluate(SB.install, SB.P);
  for (const s of job.prior) await p.evaluate(s => window.__beh.run(s), s);
  const tr = await p.evaluate(s => {
    const n = v => typeof v === 'number' ? (Object.is(v, -0) ? 0 : v) : v;
    let nr = 0, nm = 0;
    const R0 = WW.rand, M0 = Math.random;
    WW.rand = function () { nr++; return R0(); };
    Math.random = function () { nm++; return M0(); };
    const FF = __sim.fastForward, out = [];
    let s0 = null;
    __sim.fastForward = function (sec, onStep) {
      if (!s0) s0 = Object.assign({}, WW.stats);
      const r = FF(sec, onStep);
      const ents = {};
      WW.world.ships.forEach((s, i) => { ents[`ship#${i} ${s.nation} ${s.type}`] = [s.id, s.x, s.z, s.heading, s.speed, s.hp, s.alive, s.sinking].map(n).join(','); });
      WW.world.planes.filter(q => q.alive || q.deathMode === 'crash').forEach((q, i) => {
        ents[`plane#${i} ${q.nation} ${q.kind}${q.carrier ? ' cv' + q.carrier.id : ''}`] = [q.x, q.y, q.z, q.heading, q.hp, q.state, q.alive].map(n).join(',');
      });
      const st = {}; for (const k in WW.stats) if (typeof WW.stats[k] === 'number' && k !== 'round') st[k] = WW.stats[k] - (s0[k] || 0);
      out.push({ t: +WW.game.roundTime.toFixed(4), ents, stats: JSON.stringify(st), nr, nm });
      return r;
    };
    // count from the seeding on: B.run seeds, then builds the fleets
    const SR0 = WW.seedRandom; WW.seedRandom = function (x) { nr = 0; nm = 0; return SR0(x); };
    let res;
    try { res = window.__beh.run(s); } finally { __sim.fastForward = FF; WW.rand = R0; Math.random = M0; WW.seedRandom = SR0; }
    return { out, winner: res.winner, len: res.len };
  }, job.spec);
  await b.close();
  return { tr, errs };
}

function compare(ref, tr) {
  for (let i = 0; i < Math.max(ref.length, tr.length); i++) {
    const a = ref[i], b = tr[i];
    if (!a || !b) return { t: (a || b).t, what: `trace length differs at sample ${i} (${ref.length} vs ${tr.length})` };
    const keys = [...new Set([...Object.keys(a.ents), ...Object.keys(b.ents)])];
    for (const k of keys) if (a.ents[k] !== b.ents[k]) return { t: a.t, what: `${k}\n      ref: ${a.ents[k] || '(missing)'}\n      got: ${b.ents[k] || '(missing)'}\n      WW.rand calls ref ${a.nr} got ${b.nr}; Math.random calls during the round ref ${a.nm} got ${b.nm}` };
    if (a.stats !== b.stats) return { t: a.t, what: `WW.stats\n      ref: ${a.stats}\n      got: ${b.stats}` };
    if (a.nr !== b.nr) return { t: a.t, what: `WW.rand call count ref ${a.nr} got ${b.nr}` };
  }
  return null;
}

function runChild(job, tmp) {
  return new Promise((resolve, reject) => {
    const f = path.join(tmp, `job${job.id}.json`);
    fs.writeFileSync(f, JSON.stringify(job));
    const c = cp.spawn(process.execPath, [__filename, '--child', f], { stdio: ['ignore', 'ignore', 'pipe'], env: Object.assign({}, process.env, { __NODE_SIM_REEXEC: '1' }) });
    let err = '';
    c.stderr.on('data', d => { err += d; });
    c.on('exit', code => {
      if (code !== 0) return reject(new Error(`child ${job.label} exited ${code}: ${err.slice(-2000)}`));
      try { resolve(JSON.parse(fs.readFileSync(f + '.out', 'utf8'))); } catch (e) { reject(e); } finally { try { fs.unlinkSync(f); fs.unlinkSync(f + '.out'); } catch (e) {} }
    });
  });
}

function parseSeeds(s) {
  const out = [];
  for (const part of String(s).split(',')) { const m = part.match(/^(\d+)-(\d+)$/); if (m) for (let i = +m[1]; i <= +m[2]; i++) out.push(i); else out.push(+part); }
  return out;
}

if (A[0] === '--child') {
  const job = JSON.parse(fs.readFileSync(A[1], 'utf8'));
  child(job).then(r => { fs.writeFileSync(A[1] + '.out', JSON.stringify(r)); process.exit(0); }).catch(e => { console.error(e && e.stack || e); process.exit(1); });
} else (async () => {
  const T0 = Date.now();
  const SEEDS = parseSeeds(arg('--seeds', '4')), ONLY = arg('--only', 'midway').split(',');
  const PROCS = +arg('--procs', 2), PRIOR = +arg('--prior', 2), EVERY = +arg('--every', 0.5), SECS = +arg('--secs', 0);
  const WK = Math.max(1, Math.min(+arg('--workers', 2), 4));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detproc-'));
  const jobs = [];
  let id = 0;
  for (const scen of ONLY) for (const seed of SEEDS) {
    const tgt = spec(scen, seed, EVERY, SECS), key = `${scen} ${seed}`;
    for (let i = 0; i < PROCS; i++) jobs.push({ id: id++, key, label: `fresh process #${i + 1}`, prior: [], spec: tgt });
    // prior rounds in the same worker: other seeds of this scenario, then a different scenario (plays to its end)
    const others = Object.keys(SCEN).filter(k => k !== scen);
    for (let i = 0; i < PRIOR; i++) {
      const pr = [spec(scen, seed + 1000 + i, 5, 0), spec(others[i % others.length], seed + 2000 + i, 5, 0)].slice(0, i + 1);
      jobs.push({ id: id++, key, label: `after ${pr.map(x => x.scen + ' ' + x.seed).join(', ')}`, prior: pr, spec: tgt });
    }
  }
  const res = new Array(jobs.length);
  let next = 0;
  await Promise.all([...Array(WK)].map(async () => { while (next < jobs.length) { const i = next++; res[i] = await runChild(jobs[i], tmp); } }));
  let fail = 0, errN = 0;
  const keys = [...new Set(jobs.map(j => j.key))];
  for (const key of keys) {
    const idx = jobs.map((j, i) => (j.key === key ? i : -1)).filter(i => i >= 0), ref = res[idx[0]].tr;
    const lines = [];
    let bad = 0;
    for (const i of idx) {
      const r = res[i], d = i === idx[0] ? null : compare(ref.out, r.tr.out);
      errN += r.errs.length;
      if (d) bad++;
      lines.push(`    ${jobs[i].label.padEnd(44)} ${d ? 'DIVERGED at t=' + d.t + 's  ' + d.what : 'identical'}${r.errs.length ? '  page errors: ' + r.errs.slice(0, 3).join(' | ') : ''}`);
    }
    if (bad) fail++;
    const nm = ref.out.length ? ref.out[ref.out.length - 1].nm : 0;
    console.log(`${key}: ${bad ? 'DIVERGED' : 'identical'} (${idx.length} runs, ${ref.out.length} samples, winner ${ref.winner}, ${ref.len} s${nm ? `, ${nm} Math.random calls (visual code)` : ''})`);
    if (bad || process.env.VERBOSE) console.log(lines.join('\n'));
  }
  try { fs.rmdirSync(tmp); } catch (e) {}
  console.log(`${keys.length} rounds x ${PROCS} fresh + ${PRIOR} after-prior processes, ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  console.log(fail || errN ? `FAIL: ${fail} round(s) diverged${errN ? `, ${errN} page errors` : ''}` : 'PASS: identical in every process and after every prior round');
  process.exit(fail || errN ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
