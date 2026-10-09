// Node-native sim runner (no Chrome): the game's sim-only mode (index.html?sim) in worker threads.
// Each "page" is one worker_threads Worker, its own V8 isolate and global, booted by tests/node_env.js exactly as
// index.html?sim boots (same scripts, same order, same main.js bootSim). Results are bit-identical to the browser's
// sim-only page (tests/determinism.js --node-vs-browser checks the traces).
//
// The API mimics the small part of Playwright the sim tests use, so a test switches with one line (tests/headless.js):
//   const b = await launch();              // a "browser"
//   const p = await b.newPage();           // a worker (booted on goto)
//   p.on('console' | 'pageerror', fn);     // console.error in game code, uncaught errors
//   await p.goto(url);                     // boots the game with url's query string (must contain 'sim')
//   await p.evaluate(fn, arg);             // runs `(fn)(arg)` in the worker's global; arg is JSON; returns a structured clone
//   await p.waitForFunction(fn, arg);      // polls fn until truthy
//   await p.waitForTimeout(ms);            // no-op (there is no render loop or network to settle)
//   await p.close(); await b.close();
// Functions passed to evaluate are sent as source text, as Playwright does: they cannot close over Node variables.
//
// Also a CLI smoke run:  node tests/node_sim.js [seed=1] [seconds=300]  (one seeded round, prints its timing)
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Bit-identical results need the same Math.* as the browser. Chrome >= 150 (V8 >= 15.0) computes sin, cos, tan,
// atan, atan2, asin, acos, exp, log*, expm1, log1p, cbrt and pow with LLVM libc (V8 src/base/ieee754.cc);
// V8 14.x and older (every stable Node up to 26.x) use fdlibm, which differs in the last bit for ~5-10% of inputs,
// and seeded rounds diverge within seconds. So the runner needs a Node whose V8 is >= 15: a v8-canary build
// (bash tests/get_node.sh puts a verified one in ~/.cache/fleet-battle/node) or SIM_NODE=/path/to/node.
// With an older Node, ensureV8() re-runs the whole command under that binary; NODE_SIM_ANY_V8=1 skips the check
// (results then match the browser only statistically, not bit for bit).
const V8_MIN = 15;
const DEFAULT_NODE = require('path').join(os.homedir(), '.cache', 'fleet-battle', 'node', 'bin', 'node');
function v8Major() { return +process.versions.v8.split('.')[0]; }
function ensureV8() {
  if (v8Major() >= V8_MIN || process.env.NODE_SIM_ANY_V8 === '1') return;
  const fs = require('fs'), bin = process.env.SIM_NODE || DEFAULT_NODE;
  if (!process.env.__NODE_SIM_REEXEC && fs.existsSync(bin)) {
    const r = require('child_process').spawnSync(bin, [...process.execArgv, ...process.argv.slice(1)],
      { stdio: 'inherit', env: Object.assign({}, process.env, { __NODE_SIM_REEXEC: '1' }) });
    process.exit(r.status === null ? 1 : r.status);
  }
  console.error(`node_sim: this Node's V8 is ${process.versions.v8}; bit-identical results with the browser need V8 >= ${V8_MIN} ` +
    `(LLVM libc Math, as in Chrome >= 150; V8 14 and older use fdlibm). Run  bash tests/get_node.sh  (a v8-canary Node in ` +
    `~/.cache/fleet-battle/node), or set SIM_NODE=/path/to/node, or use --browser. NODE_SIM_ANY_V8=1 runs anyway (not bit-identical).`);
  process.exit(2);
}

// default pool size: all cores but two (the machine stays usable), MAX_WORKERS caps it
function defaultWorkers() {
  const n = Math.max(1, os.cpus().length - 2), cap = +process.env.MAX_WORKERS;
  return cap > 0 ? Math.min(n, cap) : n;
}

if (!isMainThread && workerData && workerData.nodeSim) {
  // ---------------- worker side ----------------
  const vm = require('vm');
  const env = require('./node_env');
  const post = m => parentPort.postMessage(m);
  process.on('uncaughtException', e => post({ ev: 'pageerror', msg: String(e && e.message || e) }));
  try {
    const r = env.boot({ query: workerData.query, consoleError: msg => post({ ev: 'console', type: 'error', msg }), consoleLog: workerData.echo ? msg => process.stdout.write(msg + '\n') : null });
    post({ ev: 'ready', ms: r.ms, scripts: r.scripts.length });
  } catch (e) { post({ ev: 'bootError', msg: String(e && e.message || e) }); }
  parentPort.on('message', async m => {
    try {
      const src = m.fn.startsWith('function') || m.fn.startsWith('async') || m.fn.startsWith('(') || /^[\w$]+\s*=>/.test(m.fn)
        ? `(${m.fn})(${m.arg === undefined ? '' : m.arg})` : m.fn; // a function, or an expression string
      const value = await vm.runInThisContext(src, { filename: 'evaluate' });
      try { post({ id: m.id, ok: true, value }); }
      catch (e) { post({ id: m.id, ok: true, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }); } // functions etc.: JSON, as Playwright drops them
    } catch (e) { post({ id: m.id, ok: false, msg: e && e.stack || String(e) }); }
  });
} else {
  // ---------------- main side ----------------
  class Page {
    constructor() { this.handlers = { console: [], pageerror: [] }; this.pending = new Map(); this.seq = 0; this.worker = null; }
    on(ev, fn) { (this.handlers[ev] || (this.handlers[ev] = [])).push(fn); return this; }
    emit(ev, x) { for (const f of this.handlers[ev] || []) f(x); }
    goto(url) {
      const q = String(url).includes('?') ? String(url).split('?')[1].split('#')[0] : '';
      if (this.worker) this.worker.terminate();
      const w = this.worker = new Worker(__filename, { workerData: { nodeSim: true, query: q, echo: !!process.env.NODE_SIM_ECHO } });
      return new Promise((resolve, reject) => {
        w.on('message', m => {
          if (m.ev === 'ready') { this.bootMs = m.ms; resolve(null); }
          else if (m.ev === 'bootError') reject(new Error(m.msg));
          else if (m.ev === 'console') this.emit('console', { type: () => m.type, text: () => m.msg });
          else if (m.ev === 'pageerror') this.emit('pageerror', new Error(m.msg));
          else if (m.id !== undefined) {
            const p = this.pending.get(m.id); this.pending.delete(m.id);
            if (!p) return;
            if (m.ok) p.resolve(m.value); else p.reject(new Error('evaluate: ' + m.msg));
          }
        });
        w.on('error', e => { reject(e); for (const p of this.pending.values()) p.reject(e); this.pending.clear(); this.emit('pageerror', e); });
        w.on('exit', code => { for (const p of this.pending.values()) p.reject(new Error('worker exited ' + code)); this.pending.clear(); });
      });
    }
    evaluate(fn, arg) {
      if (!this.worker) return Promise.reject(new Error('node_sim: evaluate before goto'));
      const id = this.seq++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ id, fn: typeof fn === 'function' ? fn.toString() : String(fn), arg: arg === undefined ? undefined : JSON.stringify(arg) });
      });
    }
    async waitForFunction(fn, arg, opts) {
      const t0 = Date.now(), timeout = (opts && opts.timeout) || 30000;
      for (;;) {
        if (await this.evaluate(fn, arg)) return true;
        if (Date.now() - t0 > timeout) throw new Error('node_sim: waitForFunction timed out');
        await new Promise(r => setTimeout(r, 10));
      }
    }
    waitForTimeout() { return Promise.resolve(); }
    async close() { if (this.worker) { const w = this.worker; this.worker = null; await w.terminate(); } }
  }
  class Browser {
    constructor() { this.pages = []; }
    async newPage() { const p = new Page(); this.pages.push(p); return p; }
    async close() { await Promise.all(this.pages.map(p => p.close())); this.pages = []; }
  }
  const launch = async () => new Browser();
  module.exports = { launch, defaultWorkers, ensureV8, Browser, Page };

  if (require.main === module) {
    ensureV8();
    // smoke run: one seeded round in one worker
    (async () => {
      const seed = +(process.argv[2] || 1), secs = +(process.argv[3] || 300), t0 = Date.now();
      const b = await launch(), p = await b.newPage();
      p.on('console', m => console.log('console.' + m.type(), m.text())); p.on('pageerror', e => console.log('PAGE', e.message));
      await p.goto('index.html?sim');
      const t1 = Date.now();
      const r = await p.evaluate(([seed, secs]) => {
        const G = WW.game; if (WW.aces) WW.aces.reset();
        WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
        G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
        __sim.fastForward(secs);
        return { state: G.state, winner: G.winner, t: +G.roundTime.toFixed(1), ships: WW.world.ships.filter(s => s.alive).length, shells: WW.stats.shellsFired };
      }, [seed, secs]);
      console.log(`boot ${p.bootMs.toFixed(0)} ms (worker start ${t1 - t0} ms), seed ${seed} ${secs} sim s in ${Date.now() - t1} ms:`, JSON.stringify(r));
      await b.close();
    })().catch(e => { console.error(e); process.exit(1); });
  }
}
