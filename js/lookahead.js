// lookahead.js (camera5, page side): WW.lookahead, the director's view of the round's FUTURE. With ?cam=lookahead (the
// default once camera5 is merged: see docs/camera_review.md) a Web Worker (lookahead_worker.js) runs a second copy of the
// displayed round AHEAD sim s ahead of the screen, from the round record main.js captures at roundStart (round_rec.js) and
// in the same fixed live steps, and sends back its event log (lookahead_log.js): every drop, impact, hit, sinking,
// magazine, plane shot down and where its wreck lands, attack runs beginning, strikes leaving. The director reads it
// through future(): only what is at most HORIZON sim s ahead (so what it sees does not depend on how far the worker has
// got). Checkpoint hashes compare the two copies every lookahead_log CHECK steps; a mismatch (something touched the
// displayed round: the B-29 egg) turns the look-ahead off for the rest of the round and the director falls back on the
// live forecast. Nothing here writes the sim. ?cam=forecast: camera4's forecast director, no worker.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const q = typeof location !== 'undefined' ? location.search : '';
  const m = /[?&]cam=(\w+)/.exec(q);
  const MODE = m ? m[1] : 'forecast';
  const AHEAD = 90, HORIZON = 75, PACE = 60;   // sim s the worker runs ahead; sim s the director may look; steps between pace messages
  const LA = WW.lookahead = {
    mode: MODE, on: MODE === 'lookahead' && !WW.simOnly && typeof Worker !== 'undefined',
    ready: false, failed: false, diverged: false, gen: 0, wn: 0, wstate: '', ev: [], checks: 0, mismatch: null, errs: [],
    AHEAD, HORIZON, bootMs: 0, stepsRun: 0
  };
  const L = WW.laLog;
  let worker = null, mine = new Map(), theirs = new Map();
  const h = () => (window.__sim && window.__sim.LIVE_STEP) || 1 / 120;
  const liveN = () => (WW.game && WW.game.stepN) || 0;
  function start() {
    if (!LA.on || worker) return;
    try {
      const extra = q.replace(/^\?/, '').split('&').filter(s => s && !/^(auto|infinite|cam=|sim)/.test(s)).join('&');
      worker = new Worker('js/lookahead_worker.js?sim' + (extra ? '&' + extra : ''));
    } catch (e) { LA.failed = true; LA.on = false; return; }
    worker.onmessage = e => onMsg(e.data);
    worker.onerror = e => { LA.failed = true; LA.errs.push(String(e && e.message)); console.error('lookahead worker', e && e.message); };
    const scripts = [...document.querySelectorAll('script[src]')].map(s => new URL(s.getAttribute('src'), location.href).href);
    worker.postMessage({ cmd: 'init', scripts, dbg: !!L.dbg });
  }
  function onMsg(d) {
    if (d.m === 'ready') { LA.ready = !!d.ok; LA.bootMs = d.ms; if (!d.ok) LA.failed = true; return; }
    if (d.m === 'err') { LA.errs.push(d.msg); if (LA.errs.length > 20) LA.errs.shift(); console.error('lookahead worker: ' + d.msg); return; }
    if (d.m === 'eval') { const f = evals.get(d.id); evals.delete(d.id); if (f) f(d.v); return; }
    if (d.m === 'log' && d.gen === LA.gen) {
      for (const e of d.ev) LA.ev.push(e);
      LA.stepsRun += Math.max(0, d.n - LA.wn);
      LA.wn = d.n; LA.wstate = d.state;
      for (const c of d.checks) { theirs.set(c.n, c.h); if (c.d) (LA.wdetail = LA.wdetail || new Map()).set(c.n, c.d); compare(c.n); }
    }
  }
  function compare(n) {
    if (!mine.has(n) || !theirs.has(n)) return;
    if (mine.get(n) === theirs.get(n)) LA.checks++;
    else if (!LA.diverged) { LA.diverged = true; LA.mismatch = { n, page: mine.get(n), worker: theirs.get(n) }; }
  }
  function pace() { if (worker && LA.ready !== false) worker.postMessage({ cmd: 'pace', gen: LA.gen, n: liveN(), ahead: Math.round(AHEAD / h()) }); }
  WW.on('roundStart', () => {
    if (!LA.on) return;
    if (!worker) start();
    LA.gen++; LA.ev = []; LA.wn = 0; LA.wstate = ''; LA.diverged = false; LA.mismatch = null; LA.checks = 0; mine = new Map(); theirs = new Map();
    L.on = true;
    worker.postMessage({ cmd: 'round', gen: LA.gen, rec: WW.game.rec });
    pace();
  });
  WW.on('setupStart', () => { if (worker) worker.postMessage({ cmd: 'stop' }); LA.gen++; LA.ev = []; });
  // the page's own checkpoints (lookahead_log.js runs first in the afterStep chain) and the pace
  const prev = WW.afterStep;
  WW.afterStep = function (n) {
    if (prev) prev(n);
    if (!LA.on || !worker) return;
    if (n % L.CHECK === 0) { const c = L.checks[L.checks.length - 1]; if (c && c.n === n) { mine.set(n, c.h); compare(n); } }
    if (n % PACE === 0) pace();
  };
  // ---------- the director's view ----------
  // usable: the worker is ahead of the screen on this round and still the same round
  LA.usable = () => LA.on && LA.ready && !LA.diverged && !LA.failed && LA.wn > liveN();
  // sim s the worker is ahead (0 when it is not usable); the end of what the director may look at, in live steps
  LA.aheadS = () => (LA.usable() ? (LA.wn - liveN()) * h() : 0);
  LA.horizonN = () => Math.min(LA.wn, liveN() + Math.round(HORIZON / h()));
  // the events from now (or `back` sim s ago) to the horizon; each with dt = sim s from now (negative: past)
  LA.future = function (back) {
    if (!LA.usable()) return [];
    const n0 = liveN() - Math.round((back || 0) / h()), n1 = LA.horizonN(), out = [];
    for (const e of LA.ev) if (e.n >= n0 && e.n <= n1) out.push(e);
    return out;
  };
  LA.dt = e => (e.n - liveN()) * h();
  // the live object an event names ('s12', 'p40', 'base')
  LA.obj = function (id) {
    if (!id) return null;
    if (id === 'base') return (WW.islandBase && WW.islandBase.base) || null;
    const k = id[0], v = +id.slice(1);
    if (k === 's') return WW.world.ships.find(s => s.id === v) || null;
    if (k === 'p') return L.byLid.get(v) || null;
    return null;
  };
  LA.idOf = o => (!o ? null : o.stats && !o.isBase ? 's' + o.id : o.isBase ? 'base' : o.lid ? 'p' + o.lid : null);
  // tests / the audit: resolves once the worker is `s` sim s ahead (or the round ended there, or the look-ahead is off)
  LA.waitAhead = function (s, maxMs) {
    const t0 = Date.now();
    return new Promise(res => {
      const tick = () => {
        const done = !LA.on || LA.failed || LA.diverged || (LA.ready && LA.wstate && LA.wstate !== 'battle') || (LA.ready && (LA.wn - liveN()) * h() >= s);
        if (done || Date.now() - t0 > (maxMs || 60000)) res({ ahead: (LA.wn - liveN()) * h(), done, state: LA.wstate });
        else setTimeout(tick, 5);
      };
      pace(); tick();
    });
  };
  // (debug, laLog.dbg: evaluate an expression in the worker)
  const evals = new Map(); let evalId = 0;
  LA.evalWorker = expr => new Promise(r => { const id = ++evalId; evals.set(id, r); worker.postMessage({ cmd: 'eval', id, expr }); });
  LA.stop = function () { if (worker) { worker.terminate(); worker = null; } LA.on = false; };
})(window.WW);
