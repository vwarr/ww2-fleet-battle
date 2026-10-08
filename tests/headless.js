// Shared launch settings for the headless sim tests (not a test itself). Three modes:
//   --node (default): sim-only mode run natively in Node worker threads, no Chrome, no web server (tests/node_sim.js;
//                     bit-identical to the browser's sim-only page, see tests/determinism.js --cross).
//   --browser:        sim-only mode (index.html?sim: the full simulation, no WebGL, no visuals, no render loop) in
//                     headless Chrome with the GPU off. Needs BASE_URL (a served checkout) and CHROMIUM.
//   --render (or RENDER=1): the full game in Chrome, rendered in software GL (swiftshader).
// --workers N (alias --pages N): parallel games: worker threads (node) or pages (browser). Default: node
// os.cpus().length - 2 (MAX_WORKERS env caps it), browser 6.
const RAW = process.argv.slice(2);
const RENDER = RAW.includes('--render') || process.env.RENDER === '1';
const BROWSER = RENDER || RAW.includes('--browser');
const MODE = RENDER ? 'render' : BROWSER ? 'browser' : 'node';
const wi = Math.max(RAW.indexOf('--workers'), RAW.indexOf('--pages'));
const NS = () => require('./node_sim');
const WORKERS = wi >= 0 ? Math.max(1, +RAW[wi + 1] || 1) : MODE === 'node' ? NS().defaultWorkers() : 6;
if (MODE === 'node') NS().ensureV8(); // needs a V8 >= 15 Node (same Math as Chrome): may re-run this command under it
const FLAGS = ['--render', '--browser', '--node'];
// the script's own args, without the mode switches and --workers / --pages N
const argv = RAW.filter((a, i) => !FLAGS.includes(a) && a !== '--workers' && a !== '--pages' && RAW[i - 1] !== '--workers' && RAW[i - 1] !== '--pages');
const BASE = process.env.BASE_URL || 'http://localhost:8000/';

// launchAs('node' | 'browser' | 'render'): a Playwright browser, or the node runner's look-alike
function launchAs(mode) {
  if (mode === 'node') return NS().launch();
  const { chromium } = require('playwright');
  const args = mode === 'render' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu'];
  return chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args });
}
// launch(_, render): this run's mode; render = true forces the full game (the first argument is ignored: old callers pass chromium)
function launch(_chromium, render = RENDER) { return launchAs(render ? 'render' : MODE === 'render' ? 'browser' : MODE); }
// page URL; query: extra flags such as 'auto' (the node runner reads only the query string)
function url(query, render = RENDER) {
  return BASE + 'index.html?' + (render ? '' : 'sim&') + (query ? query + '&' : '') + 'v=' + Date.now();
}
// how long a fresh page settles before a test takes over (the full game compiles shaders on its first frames)
const settle = (render = RENDER) => (render ? 1500 : MODE === 'node' ? 0 : 100);
const label = () => (MODE === 'node' ? `node, ${WORKERS} worker${WORKERS > 1 ? 's' : ''}` : `${MODE === 'render' ? 'render' : 'sim-only browser'}, ${WORKERS} page${WORKERS > 1 ? 's' : ''}`);

module.exports = { RENDER, BROWSER, MODE, NODE: MODE === 'node', WORKERS, argv, launch, launchAs, url, settle, label };
