// Node loader for the game (not a test itself): boots what index.html?sim boots, in the current JS realm.
// Used by tests/node_sim.js, one game per worker thread (each worker is its own V8 isolate and global).
// - The <script src> list comes from index.html, so new modules are picked up without edits here.
// - Each script runs with vm.runInThisContext (classic-script semantics: top-level const/let share one global
//   lexical scope, `this` is the global), in order. A script that throws while loading fails loudly, by name.
// - Stub browser environment: window = self = globalThis, a minimal document (createElement returns a stub
//   element whose canvas 2D context accepts every call), location.search '?sim&...', requestAnimationFrame no-op,
//   performance (Node's), no AudioContext / localStorage writes. Sim-only mode (WW.simOnly, main.js bootSim)
//   never touches the renderer, WebGL, audio, UI or camera modules, so nothing else is needed.
// - DOMContentLoaded / load listeners fire after the last script, as in the browser (main.js boots there or inline).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// <script src="..."> in document order (index.html is the single source of the load order)
function scriptList(root = ROOT) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const out = [], re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1].split('?')[0]);
  return out;
}

// any property is a no-op function that returns the stub itself (canvas 2D context, gradients, style, classList)
function anyStub() {
  const fn = function () { return proxy; };
  const store = {};
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined; // not a thenable
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

// install the browser stubs on globalThis. query: the page's query string without '?', e.g. 'sim' or 'sim&auto'
function installStubs(query, hooks) {
  const g = globalThis, listeners = { DOMContentLoaded: [], load: [] };
  const on = (type, fn) => { if (listeners[type]) listeners[type].push(fn); };
  const elements = {};
  const body = element('body');
  const document = {
    readyState: 'loading', hidden: true, body, documentElement: element('html'), head: element('head'),
    fullscreenElement: null, webkitFullscreenElement: null,
    createElement: element, createElementNS: (ns, tag) => element(tag),
    getElementById: id => elements[id] || (elements[id] = Object.assign(element('div'), { id })),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: on, removeEventListener() {}
  };
  const def = (k, v) => Object.defineProperty(g, k, { value: v, writable: true, configurable: true, enumerable: true });
  def('window', g); def('self', g);
  def('document', document);
  def('location', { search: '?' + query, href: 'http://node/index.html?' + query, hash: '', pathname: '/index.html', reload() {} });
  def('navigator', { userAgent: 'node', language: 'en', hardwareConcurrency: 1 });
  def('innerWidth', 640); def('innerHeight', 360); def('devicePixelRatio', 1);
  def('addEventListener', on); def('removeEventListener', () => {});
  def('requestAnimationFrame', () => 0); def('cancelAnimationFrame', () => {});
  def('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  def('Image', function Image() { return element('img'); });
  def('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // console.error from game code (main.js init failures, caught errors) is a page error, as in the browser tests
  const con = Object.create(console);
  con.error = (...a) => hooks.consoleError(a.map(fmt).join(' '));
  con.log = con.info = con.warn = con.debug = (...a) => hooks.consoleLog && hooks.consoleLog(a.map(fmt).join(' '));
  def('console', con);
  return () => {
    document.readyState = 'interactive';
    for (const f of listeners.DOMContentLoaded) f({ type: 'DOMContentLoaded' });
    document.readyState = 'complete';
    for (const f of listeners.load) f({ type: 'load' });
  };
}
const fmt = v => (v instanceof Error ? v.stack || v.message : typeof v === 'object' && v !== null ? safeJSON(v) : String(v));
const safeJSON = v => { try { return JSON.stringify(v); } catch (e) { return String(v); } };

// Load the game into this realm. Returns { scripts, ms }. Throws (script name in the message) on a load error.
function boot({ query = 'sim', root = ROOT, consoleError = m => process.stderr.write('console.error: ' + m + '\n'), consoleLog = null } = {}) {
  if (!/(^|&)sim(&|=|$)/.test(query)) throw new Error('node_env: only sim-only mode (?sim) runs in Node; query was ' + query);
  const t0 = performance.now();
  const fire = installStubs(query, { consoleError, consoleLog });
  const scripts = scriptList(root);
  // CommonJS names visible as globals (node -e, the REPL) would make the THREE UMD export into them: hide them
  const hidden = {};
  for (const k of ['module', 'exports', 'define']) if (Object.prototype.hasOwnProperty.call(globalThis, k)) { hidden[k] = globalThis[k]; delete globalThis[k]; }
  for (const src of scripts) {
    const file = path.join(root, src);
    let code;
    try { code = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`node_env: cannot read ${src}: ${e.message}`); }
    try { vm.runInThisContext(code, { filename: file }); }
    catch (e) { const err = new Error(`node_env: ${src} threw while loading: ${e && e.stack || e}`); err.script = src; throw err; }
  }
  Object.assign(globalThis, hidden);
  fire();
  if (!globalThis.__sim || !globalThis.WW || !globalThis.WW.game) throw new Error('node_env: the game did not boot (no __sim / WW.game)');
  return { scripts, ms: performance.now() - t0 };
}

module.exports = { scriptList, boot, ROOT };
