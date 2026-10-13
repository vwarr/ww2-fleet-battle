// Normandy film layer probe (docs/NORMANDY_PLAN.md P9: camera_normandy*.js, diary_normandy.js, aar_normandy.js,
// plot_normandy.js). Render mode (software GL) on a fake 30 fps frame clock, ?scn=normandy, one seeded round:
//  - the director: every shot it takes (kind, rig, drama, subject, the camera's height over the ground and its distance
//    to the subject), screenshots ~2 s into the first shot of each kind (tests/shots/normandy_film/), the share of
//    Normandy (nd) shots, cameras under the ground or far above the men
//  - follow: F (camFollow.f), Tab, 8, 9, the label, a followed squad's heir
//  - the war diary (printed), the plot table and the report card (screenshots) when the round ends or at the end
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/normandy_film.js [seed=1] [simSecs=700] [scale=4] [shots=1]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'normandy_film');
fs.mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 1), SIM = +(process.argv[3] || 700), SCALE = +(process.argv[4] || 4), SHOTS = (process.argv[5] || '1') !== '0';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?scn=normandy&v=' + Date.now(), { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.evaluate(({ seed, scale }) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(3);
    WW.terrain.generate(seed); WW.seedRandom(seed); WW.game.seed = seed; WW.time.now = 0;
    WW.game.composition = null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    WW.time.scale = scale;
    window.__log = []; let id = 0;
    const W = WW.cam;
    window.__poll = () => {
      const s = W._shot(); if (!s) return null;
      if (!s.__id) {
        s.__id = ++id;
        const o = s.subj, c = WW.camera.position;
        __log.push({ id: s.__id, rt: +WW.game.roundTime.toFixed(1), clock: WW.scenarios.normandy.clock.label(WW.game.roundTime), kind: s.kind, rig: s.rig || '', nd: !!s.nd, pr: s.pr !== undefined ? +(+s.pr).toFixed(2) : null,
          subj: !o ? '-' : o.isCraft ? o.type + ':' + o.state : o.isSquad ? o.kind + ':' + o.state : o.isDef ? 'el:' + o.kind : o.stats ? o.type : o.diorama ? 'spot' : o.kind || '?', interrupt: !!s.interrupt, recut: !!s.recut, cap: s.cap ? s.cap[0] : '' });
      }
      return s.__id;
    };
    window.__measure = () => {   // the camera now: height over the ground under it, distance to the subject
      const s = W._shot(), c = WW.camera.position, o = s && s.subj;
      const g = Math.max(WW.terrain.heightRaw(c.x, c.z), WW.tide ? WW.tide.level() : 0);
      return { h: c.y - g, d: o ? Math.hypot(c.x - o.x, c.y - (o.y || 0), c.z - o.z) : 0, nd: !!(s && s.nd) };
    };
  }, { seed: SEED, scale: SCALE });
  const kinds = new Set(), samples = [];
  let n = 0, lastId = null, since = 0, taken = false, ended = false;
  const snap = async (tag) => {
    await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; });
    const file = String(n++).padStart(2, '0') + '_' + tag.replace(/[^a-z0-9]+/gi, '_') + '.png';
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  shot', 'tests/shots/normandy_film/' + file);
  };
  const t0 = Date.now();
  for (let fr = 0; ; fr += 6) {
    const st = await p.evaluate(() => { __render = false; __step(6); const id = __poll(); return { id, rt: WW.game.roundTime, state: WW.game.state, m: __measure() }; });
    if (st.m.nd) samples.push(st.m);
    if (st.id !== lastId) { lastId = st.id; since = 0; taken = false; } else since += 0.2;
    if (SHOTS && !taken && since >= 3.5) {
      taken = true;
      const k = await p.evaluate(() => { const s = WW.cam._shot(); return s ? s.kind + (s.rv ? '_' + s.rv : '') : '-'; });
      if (!kinds.has(k)) { kinds.add(k); await snap(k); }
    }
    if (st.state !== 'battle') { ended = true; break; }
    if (st.rt >= SIM) break;
    if (fr % 3000 === 0) console.log('  rt', st.rt.toFixed(0), 'real', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  // follow: F, Tab, 8, 9 (only while the battle runs)
  if (!ended) {
    const fol = await p.evaluate(() => {
      const out = [];
      out.push(WW.camFollow.f()); __step(30); out.push(WW.camFollow.labelText());
      out.push(WW.camFollow.cycle(1)); __step(30); out.push(WW.camFollow.labelText());
      out.push(WW.camFollow.cycle(1, 'dogfight')); out.push(WW.camFollow.cycle(1, 'danger'));
      out.push(WW.camFollow.f()); __step(10);
      const s = WW.cam._shot(); out.push('after F: ' + (s ? s.kind : '-'));
      return out;
    });
    console.log('follow:\n  ' + fol.join('\n  '));
    if (SHOTS) { await p.evaluate(() => { WW.camFollow.cycle(1); __step(60); }); await snap('follow'); await p.evaluate(() => WW.camFollow.f()); }
  }
  const log = await p.evaluate(() => __log);
  const by = {}; for (const r of log) { const k = r.kind + (r.nd ? '' : ' (pacific)'); by[k] = (by[k] || 0) + 1; }
  console.log('shots:', log.length, 'nd', log.filter(r => r.nd).length, JSON.stringify(by));
  for (const r of log) console.log(' ', r.clock, r.kind.padEnd(10), (r.rig || '').padEnd(6), String(r.pr).padEnd(5), r.subj.padEnd(16), r.interrupt ? 'INT' : r.recut ? 'RECUT' : '', r.cap);
  const under = samples.filter(s => s.h < 0.1).length, high = samples.filter(s => s.h > 12).length, far = samples.filter(s => s.d > 40).length;
  const hs = samples.map(s => s.h).sort((a, b) => a - b), q = f => (hs.length ? hs[Math.floor(f * (hs.length - 1))].toFixed(2) : '-');
  console.log(`nd camera height over ground: p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}; under 0.1: ${under}/${samples.length}; over 12: ${high}; subject over 40 u: ${far}`);
  // the diary, the plot and the card
  const dia = await p.evaluate(() => (WW.diary ? WW.diary.entries().map(e => e.clock + ' ' + (e.nation || '   ') + ' p' + e.pri + ' ' + e.text) : []));
  console.log('diary (' + dia.length + '):\n  ' + dia.join('\n  '));
  if (SHOTS) {
    await p.evaluate(() => { WW.cam.mode = 'map'; WW.plot.set(null); __render = false; __step(40); });
    await snap('plot');
    await p.evaluate(() => { WW.cam.mode = 'director'; });
    if (!ended) await p.evaluate(() => { WW.game.endRound('USN', 'beachhead', 'GER'); });
    await p.evaluate(() => { __render = false; __step(30 * 6); __render = true; __step(2); });
    const card = await p.evaluate(() => (WW.aar && WW.aar.visible() ? document.getElementById('aar').innerText : '(no card)'));
    console.log('card:\n' + card);
    await snap('aar');
  }
  console.log('errors:', errs.length, errs.slice(0, 8));
  await b.close();
})();
