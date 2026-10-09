// Sim profiler: runs seeded rounds in this process (node runner, sim-only mode) and prints the per-round time and,
// with --prof, a self-time table of the hottest functions (V8 CPU profile, warm rounds only).
// Usage: node tests/sim_profile.js [rounds=4] [firstSeed=1] [secs=300] [--prof] [--top N] [--warm W] [--root DIR] [--lines]
//   --root DIR: load the game from another checkout (A/B timing against a baseline tree)
//   --warm W (default 1): rounds run first and not counted (JIT warm-up). The game state carries over between
//   rounds as in the other tests (each round is a fresh seeded replay).
'use strict';
require('./node_sim').ensureV8();
const inspector = require('inspector');
const env = require('./node_env');
const args = process.argv.slice(2), flag = k => args.includes(k), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const N = +(pos[0] || 4), SEED0 = +(pos[1] || 1), SECS = +(pos[2] || 300), TOP = opt('--top', 30), WARM = opt('--warm', 1);
const out = s => process.stdout.write(s + '\n');
let errors = 0; const cpu = [], setup = []; // setup: terrain.generate + startRound (map and fleets), per round
const ROOT = args.includes('--root') ? require('path').resolve(args[args.indexOf('--root') + 1]) : undefined;
env.boot({ root: ROOT, consoleError: m => { errors++; if (errors < 5) out('console.error: ' + m); } });
const round = seed => {
  const G = WW.game; if (WW.aces) WW.aces.reset();
  const g0 = performance.now(); WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
  G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true }); setup.push(performance.now() - g0);
  const c0 = process.cpuUsage(), t0 = performance.now(); __sim.fastForward(SECS); const c = process.cpuUsage(c0); cpu.push((c.user + c.system) / 1000); return performance.now() - t0;
};
for (let i = 0; i < WARM; i++) round(SEED0 + 1000 + i);
const session = new inspector.Session();
const post = (m, p) => new Promise((res, rej) => session.post(m, p || {}, (e, r) => (e ? rej(e) : res(r))));
(async () => {
  if (flag('--prof')) { session.connect(); await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 200 }); await post('Profiler.start'); }
  const times = [];
  for (let i = 0; i < N; i++) { const ms = round(SEED0 + i); times.push(ms); out(`seed ${SEED0 + i}: ${(ms / 1000).toFixed(3)} s for ${SECS} sim s`); }
  const sum = times.reduce((a, b) => a + b, 0);
  const su = setup.slice(WARM), sus = su.reduce((a, b) => a + b, 0);
  const c = cpu.slice(WARM), cs = c.reduce((a, b) => a + b, 0);
  out(`total ${(sum / 1000).toFixed(2)} s, mean ${(sum / N / 1000).toFixed(3)} s/round, min ${(Math.min(...times) / 1000).toFixed(3)} s; cpu mean ${(cs / N / 1000).toFixed(3)} s/round, min ${(Math.min(...c) / 1000).toFixed(3)} s; setup (map + fleets) mean ${(sus / N).toFixed(0)} ms  (errors ${errors})`);
  if (!flag('--prof')) return;
  const { profile: p } = await post('Profiler.stop');
  const byId = new Map(p.nodes.map(n => [n.id, n])), self = new Map();
  let tot = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const n = byId.get(p.samples[i]), dt = p.timeDeltas[i] || 0, cf = n.callFrame;
    const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + dt); tot += dt;
  }
  // per file
  const files = new Map();
  for (const [k, v] of self) { const f = k.split(' ').pop().split(':')[0] || '(native)'; files.set(f, (files.get(f) || 0) + v); }
  out('\nself time by function');
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP)) out(`${(v / 1000).toFixed(0).padStart(7)} ms ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`);
  out('\nself time by file');
  for (const [k, v] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 20)) out(`${(v / 1000).toFixed(0).padStart(7)} ms ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`);
  // inclusive time: each sample counts once for every distinct function on its stack
  const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const keyOf = n => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  const incl = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i] || 0, seen = new Set();
    for (let id = p.samples[i]; id !== undefined; id = parent.get(id)) { const k = keyOf(byId.get(id)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + dt); } }
  }
  out('\ninclusive time by function (game code)');
  for (const [k, v] of [...incl].filter(e => /\.js:/.test(e[0]) && !/sim_profile|node:/.test(e[0])).sort((a, b) => b[1] - a[1]).slice(0, TOP)) out(`${(v / 1000).toFixed(0).padStart(7)} ms ${(100 * v / tot).toFixed(1).padStart(5)}%  ${k}`);
  if (!flag('--lines')) return;
  // hottest source lines (sample ticks per line, inlined callees count where they were inlined)
  const lines = new Map(); let ticks = 0;
  for (const n of p.nodes) for (const t of n.positionTicks || []) { const k = `${n.callFrame.url.split('/').pop()}:${t.line}`; lines.set(k, (lines.get(k) || 0) + t.ticks); ticks += t.ticks; }
  out('\nhottest lines (share of line ticks)');
  for (const [k, v] of [...lines].sort((a, b) => b[1] - a[1]).slice(0, TOP)) out(`${(100 * v / ticks).toFixed(1).padStart(5)}%  ${k}`);
})();
