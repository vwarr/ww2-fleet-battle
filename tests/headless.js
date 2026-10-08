// Shared browser settings for the headless sim tests (not a test itself).
// Default: sim-only mode (index.html?sim: the full simulation, no WebGL, no visuals, no render loop; results
// are bit-identical to the full game, see tests/determinism.js --cross) in Chrome with the GPU off.
// --render (or RENDER=1): the full game, rendered in software GL (swiftshader), as before.
const RENDER = process.argv.includes('--render') || process.env.RENDER === '1';
const argv = process.argv.slice(2).filter(a => a !== '--render'); // the script's own args, without the switch
const BASE = process.env.BASE_URL || 'http://localhost:8000/';

function launch(chromium, render = RENDER) {
  const args = render ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu'];
  return chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args });
}
// page URL; query: extra flags such as 'auto'
function url(query, render = RENDER) {
  return BASE + 'index.html?' + (render ? '' : 'sim&') + (query ? query + '&' : '') + 'v=' + Date.now();
}
// how long a fresh page settles before a test takes over (the full game compiles shaders on its first frames)
const settle = (render = RENDER) => (render ? 1500 : 100);

module.exports = { RENDER, argv, launch, url, settle };
