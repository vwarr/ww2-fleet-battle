// lookahead_worker.js (Web Worker, camera5): a second copy of the displayed round, run 60-90 sim s ahead of the screen,
// so the director camera knows what is going to happen (lookahead.js is the page side; docs/camera_review.md).
// The worker loads the game's own scripts (the page sends index.html's list) under a small browser stub, in sim-only mode
// (?sim: no renderer, no visuals; tests/node_env.js does the same in Node), and steps the round in the page's fixed live
// steps (main.js LIVE_STEP) from the page's round record (main.js game.rec, round_rec.js): bit-identical to the page's
// round, which the checkpoint hashes (lookahead_log.js) confirm. Messages:
//   page -> worker: { cmd: 'init', scripts } | { cmd: 'round', gen, rec } | { cmd: 'pace', gen, n, ahead } | { cmd: 'stop' }
//   worker -> page: { m: 'ready', ms } | { m: 'log', gen, n, ev: [...], checks: [...], state } | { m: 'err', msg }
'use strict';
(function () {
  const g = self;
  const post = o => g.postMessage(o);
  // ---------- the browser stub (as tests/node_env.js) ----------
  function anyStub() {
    const store = {};
    const fn = function () { return proxy; };
    const proxy = new Proxy(fn, {
      get(t, k) {
        if (k in store) return store[k];
        if (k === Symbol.toPrimitive) return () => 0;
        if (k === 'then') return undefined;
        if (k === 'length') return 0;
        if (k === 'data') return (store.data = new Uint8ClampedArray(4));
        return proxy;
      },
      set(t, k, v) { store[k] = v; return true; },
      apply() { return proxy; }
    });
    return proxy;
  }
  function element(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), width: 300, height: 150, style: {}, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      appendChild(c) { el.children.push(c); return c; }, removeChild(c) { return c; }, remove() {}, append() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: el.width, height: el.height, right: el.width, bottom: el.height }; },
      getContext() { return el._ctx || (el._ctx = anyStub()); },
      toDataURL() { return 'data:,'; },
      innerHTML: '', textContent: ''
    };
    return el;
  }
  const listeners = { DOMContentLoaded: [], load: [] };
  const on = (type, fn) => { if (listeners[type]) listeners[type].push(fn); };
  const elements = {};
  const document = {
    readyState: 'loading', hidden: true, body: element('body'), documentElement: element('html'), head: element('head'),
    fullscreenElement: null, webkitFullscreenElement: null,
    createElement: element, createElementNS: (ns, tag) => element(tag),
    getElementById: id => elements[id] || (elements[id] = Object.assign(element('div'), { id })),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: on, removeEventListener() {}
  };
  const def = (k, v) => { try { Object.defineProperty(g, k, { value: v, writable: true, configurable: true, enumerable: true }); } catch (e) { /* keep the worker's own */ } };
  def('window', g);
  def('document', document);
  def('innerWidth', 640); def('innerHeight', 360); def('devicePixelRatio', 1);
  def('requestAnimationFrame', () => 0); def('cancelAnimationFrame', () => {});
  def('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  def('Image', function Image() { return element('img'); });
  def('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const fmt = v => (v instanceof Error ? v.stack || v.message : typeof v === 'object' && v !== null ? (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })() : String(v));
  const con = Object.create(console);
  con.error = (...a) => post({ m: 'err', msg: a.map(fmt).join(' ') });
  con.log = con.info = con.warn = con.debug = () => {};
  def('console', con);
  g.addEventListener('error', e => post({ m: 'err', msg: 'worker: ' + (e && e.message) }));

  // ---------- the round ----------
  let booted = false, gen = -1, target = 0, sentEv = 0, sentCk = 0, running = false, queue = [];
  const SLICE = 10;   // ms of stepping per turn of the worker's event loop (messages are read between turns)
  function boot(scripts) {
    const t0 = performance.now();
    for (const src of scripts) {
      try { importScripts(src); } catch (e) { post({ m: 'err', msg: 'worker: ' + src + ' threw while loading: ' + (e && e.stack || e) }); }
    }
    document.readyState = 'interactive';
    for (const f of listeners.DOMContentLoaded) f({ type: 'DOMContentLoaded' });
    document.readyState = 'complete';
    for (const f of listeners.load) f({ type: 'load' });
    booted = !!(g.WW && g.WW.game && g.__sim);
    if (booted) g.WW.laLog.on = true;
    post({ m: 'ready', ms: performance.now() - t0, ok: booted });
  }
  function round(m) {
    const WW = g.WW;
    gen = m.gen; target = 0; sentEv = 0; sentCk = 0;
    WW.game.startRound({ replay: m.rec });
  }
  function flush() {
    const L = g.WW.laLog, G = g.WW.game;
    if (L.ev.length > sentEv || L.checks.length > sentCk || true) {
      post({ m: 'log', gen, n: G.stepN || 0, t: g.WW.time.now, state: G.state, ev: L.ev.slice(sentEv), checks: L.checks.slice(sentCk) });
      sentEv = L.ev.length; sentCk = L.checks.length;
    }
  }
  function loop() {
    running = false;
    if (!booted || gen < 0) return;
    const G = g.WW.game;
    if (G.state !== 'battle' || (G.stepN || 0) >= target) { flush(); return; }
    const t0 = performance.now();
    while (G.state === 'battle' && (G.stepN || 0) < target && performance.now() - t0 < SLICE) g.__sim.stepFixed(1);
    flush();
    kick();
  }
  function kick() { if (!running) { running = true; setTimeout(loop, 0); } }
  function handle(m) {
    if (m.cmd === 'init') { boot(m.scripts); if (booted && m.dbg) g.WW.laLog.dbg = true; return; }
    if (!booted) return;
    if (m.cmd === 'round') { round(m); return kick(); }
    if (m.cmd === 'pace' && m.gen === gen) { target = Math.max(target, m.n + m.ahead); return kick(); }
    if (m.cmd === 'stop') { gen = -1; }
    if (m.cmd === 'eval' && g.WW.laLog.dbg) { let v; try { v = JSON.stringify((0, eval)(m.expr)); } catch (e) { v = 'ERR ' + e.message; } post({ m: 'eval', id: m.id, v }); }   // (debug)
  }
  g.onmessage = e => { try { handle(e.data); } catch (err) { post({ m: 'err', msg: 'worker: ' + (err && err.stack || err) }); } };
})();
