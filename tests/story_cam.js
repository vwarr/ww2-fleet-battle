// Story mode probe (camera_story.js): forces a story on a strike, steps it through its phases and saves a
// screenshot ~2 s into each shot (tests/shots/story/), logs the shot sequence and timings, then checks the
// protagonist-death hand-off (WW.airDeaths.force on the leader), the F key toggle and a freecam plane click.
// Usage: BASE_URL=http://localhost:PORT/ node tests/story_cam.js [seed=3] [realSeconds=150] [story,forced,death,keys]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'story');
fs.mkdirSync(OUT, { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3), SECS = +(process.argv[3] || 150), WHICH = (process.argv[4] || 'story,forced,death,keys').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate((seed) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    // performance.now follows the fake frame clock, so the story's wall clock matches the stepped frames
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    const f = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 }, { type: 'cruiser', nation: n, x: x + s * 60, z: H / 2 - 50 }, { type: 'destroyer', nation: n, x: x + s * 70, z: H / 2 + 50 }];
    G.composition = [...f('USN', 70, 1), ...f('IJN', W - 70, -1)];
    G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    window.__rec = []; __rec.ids = 0;
    const orig = WW.cam.afterRender;
    WW.cam.afterRender = function () {
      orig.call(this);
      const c = WW.camera, s = WW.cam._shot();
      let hull = 99; for (const o of WW.world.ships) if (!o.removed) hull = Math.min(hull, Math.hypot(c.position.x - o.x, c.position.z - o.z) - o.stats.length / 2 + (c.position.y > 14 ? 99 : 0));
      const am = s && (s.aim || s.last), nd = am ? am.clone().project(c) : { x: 0, y: 0 };
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
      if (s && !s.__id) s.__id = ++__rec.ids;
      __rec.push({ id: s ? s.__id : 0, t: __fakeT / 1000, sk: s ? (s.sk || s.kind) + (s.stage ? ':' + s.stage : '') : '-', x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z,
        hull, nx: nd.x, ny: nd.y, ground: c.position.y + Math.min(0, WW.terrain.depthAt(c.position.x, c.position.z)) });
    };
  }, SEED);
  const shotTag = () => p.evaluate(() => { const s = WW.cam._shot(); return s ? (s.sk || s.kind) + (s.stage ? ':' + s.stage : '') : '-'; });
  let n = 0;
  const snap = async (tag) => {
    const st = await p.evaluate(() => { __render = true; __step(1); const c = WW.camera.position, s = WW.cam._shot(); return [c.x, c.y, c.z].map(v => v.toFixed(1)).join(',') + ' ' + (s ? s.kind + '/' + s.sk : '-'); });
    console.log('  cam', st);
    const file = `story_${String(n++).padStart(2, '0')}_${tag.replace(/[^a-z0-9]+/gi, '_')}.png`;
    const ts = Date.now(); await p.screenshot({ path: path.join(OUT, file), timeout: 180000 }); console.log("  (" + (Date.now() - ts) + " ms)"); console.log('  shot', 'tests/shots/story/' + file);
  };
  // run the camera for `secs` real seconds, screenshot each new shot ~2 s in
  const run = async (secs, label, stopWhen) => {
    let cur = null, since = 0, shotTaken = false;
    for (let fr = 0; fr < secs * 30; fr += 6) {
      await p.evaluate(() => { __render = false; __step(5); __render = true; __step(1); });
      const tag = await shotTag();
      if (tag !== cur) { cur = tag; since = 0; shotTaken = false; } else since += 0.2;
      if (!shotTaken && since >= 2 && tag !== '-') { shotTaken = true; const ph = await p.evaluate(() => (WW.camStory._dbg() || {}).phase || 'director'); await snap(label + '_' + ph + '_' + tag); }
      if (stopWhen && await p.evaluate(stopWhen)) return true;
    }
    return false;
  };

  // 1. a strike launching: follow its torpedo (else dive) squadron leader
  let kinds = new Set();
  if (WHICH.includes('story')) {
  const lead = await p.evaluate(() => {
    __sim.setScale(1);
    const L = until(() => WW.world.planes.find(q => q.alive && q.nation === 'USN' && q.kind === 'torpedo' && q.target && q.state === 'takeoff' && q.wing === 0), 200) || until(() => {
      const ws = WW.strike._waves().filter(w => !w.done && w.nation === 'USN' && w.members.some(m => m.alive && m.kind !== 'fighter'));
      for (const w of ws) { const m = w.members.find(q => q.alive && q.kind === 'torpedo' && q.wing === 0) || w.members.find(q => q.alive && q.kind === 'dive' && q.wing === 0); if (m) return m; }
      return null;
    }, 200);
    if (!L) return null;
    WW.camStory.start(L, 'strike'); __step(2);
    return L.kind + ' ' + (L.squadron && L.squadron.short) + ' state=' + L.state + ' sim=' + WW.time.now.toFixed(0);
  });
  console.log('[story] protagonist', lead);
  if (!lead) { console.log('FAIL no strike'); await b.close(); process.exit(1); }
  await p.evaluate(() => __sim.setScale(2));
  await run(SECS, 'strike', () => !WW.camStory.active());
  const log1 = await p.evaluate(() => WW.camStory.log.splice(0));
  const t0 = log1.length ? log1[0].at : 0;
  console.log('[story] sequence:');
  for (const e of log1) console.log('   ' + (e.at - t0).toFixed(1).padStart(6) + 's  ' + (e.start ? 'START ' + e.lead + ' (' + e.mission + ')' : e.end ? 'END' : e.fall ? 'FALL ' + e.fall : e.handoff ? 'HANDOFF -> ' + e.handoff : `${e.sk.padEnd(8)} ${e.phase.padEnd(8)} ${e.dur}s ${e.hard ? 'hard cut' : 'fade'}  ${e.lead || ''}`));
  kinds = new Set(log1.filter(e => e.sk).map(e => e.sk));
  }

  // 2. force the shot kinds the story did not reach (on whatever strike is up)
  const want = !WHICH.includes('forced') ? [] : ['chase', 'wing', 'ots', 'side', 'water', 'high'].filter(k => !kinds.has(k));
  for (const k of want) {
    const r = await p.evaluate((k) => {
      __sim.setScale(1);
      const L = until(() => WW.world.planes.find(q => q.alive && q.squadron && (k === 'wing' || q.kind !== 'fighter') && q.state !== 'takeoff' && q.state !== 'landing' && WW.storyShots.valid(k, q, q.element ? q.element.members : [q])), 300);
      if (!L) return 'none';
      WW.camStory.start(L, 'strike');
      WW.cam.film({ kind: 'story', sk: k, subj: L, group: L.element ? L.element.members.slice() : [L], dur: 12, story: true, kP: k === 'high' || k === 'side' ? 2.5 : 4.5, kL: 4.5, side: 1 });
      return L.kind + ' ' + L.state + ' ' + (L.phase || L.sk || '');
    }, k);
    console.log(`[forced ${k}]`, r);
    if (r === 'none') continue;
    await p.evaluate(() => { __render = false; __step(65); });
    await snap('forced_' + k);
    await p.evaluate(() => WW.camStory.stop());
  }

  // 3. protagonist death: the camera stays on the fall, then hands off to the wingman / next leader
  const dz = !WHICH.includes('death') ? null : await p.evaluate(() => {
    __sim.setScale(1); WW.camStory.log.length = 0;
    const L = until(() => WW.world.planes.find(q => q.alive && q.wing === 0 && q.element && q.element.members.filter(m => m.alive && m.state === 'transit').length >= 2 && q.state === 'transit' && q.y > 15), 300);
    if (!L) return null;
    WW.camStory.start(L); __step(90);
    window.__dead = L; WW.airDeaths.force('spin', L);
    return L.kind + ' ' + (L.squadron && L.squadron.short);
  });
  console.log('[death] leader', dz);
  if (dz) {
    for (let i = 0; i < 5; i++) { await p.evaluate(() => { __render = false; __step(17); }); if (i === 1 || i === 3) await snap('death_' + (await shotTag())); }
    await p.evaluate(() => { __render = false; __step(120); });
    await snap('after_handoff_' + (await shotTag()));
    const r = await p.evaluate(() => ({ log: WW.camStory.log.map(e => e.fall ? 'FALL' : e.handoff ? 'HANDOFF ' + e.handoff : e.start ? 'START' : e.end ? 'END' : e.sk), lead: WW.camStory.lead() && WW.camStory.lead() !== __dead, active: WW.camStory.active() }));
    console.log('  ', r.log.join(' > '), '| new leader:', r.lead, '| active:', r.active);
    console.log(r.log.indexOf('FALL') >= 0 && r.log.some(x => /^HANDOFF|^END/.test(x)) ? 'PASS death hand-off' : 'FAIL death hand-off');
  }

  // 4. the F key toggles story mode; a click on a plane in the free camera starts one on it
  if (WHICH.includes('keys')) {
  await p.evaluate(() => { WW.camStory.stop(); __step(2); });
  await p.keyboard.press('f'); await p.evaluate(() => __step(2));
  const on = await p.evaluate(() => WW.camStory.active());
  await p.keyboard.press('f'); await p.evaluate(() => __step(2));
  const off = await p.evaluate(() => WW.camStory.active());
  console.log(on && !off ? 'PASS F toggle' : 'FAIL F toggle', on, off);
  const click = await p.evaluate(() => {
    const L = until(() => WW.world.planes.find(q => q.alive && q.state === 'transit' && q.y > 10), 200);
    if (!L) return null;
    WW.cam.film({ kind: 'chase', subj: L, dur: 20 }); __step(60);
    const v = new THREE.Vector3(L.x, L.y, L.z).project(WW.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, id: WW.world.planes.indexOf(L) };
  });
  if (click) {
    await p.mouse.click(click.x, click.y); await p.evaluate(() => __step(3));
    const r = await p.evaluate((id) => ({ active: WW.camStory.active(), same: WW.camStory.lead() === WW.world.planes[id], fc: WW.freecam.active() }), click.id);
    console.log(r.active && r.same && !r.fc ? 'PASS freecam plane click' : 'FAIL freecam plane click', JSON.stringify(r));
  }
  // 5. stops cleanly on map view and on a new round
  const stops = await p.evaluate(() => {
    const out = [];
    WW.camStory.toggle(); __step(2); WW.cam.toggle(); __step(2); out.push(!WW.camStory.active()); WW.cam.toggle();
    WW.camStory.toggle(); __step(2); WW.game.startRound(); __step(2); out.push(!WW.camStory.active());
    return out;
  });
  console.log(stops.every(Boolean) ? 'PASS stops in map view / new round' : 'FAIL stops', stops);
  }

  // camera sanity over the whole recording
  const rec = await p.evaluate(() => __rec.slice());
  let minG = 99, minH = 99, out = 0, nsub = 0, maxRot = 0, rotAt = '';
  const ang = (a, c) => Math.acos(Math.min(1, a.fx * c.fx + a.fy * c.fy + a.fz * c.fz));
  rec.forEach((f, i) => {
    minG = Math.min(minG, f.ground); minH = Math.min(minH, f.hull);
    if (f.sk !== '-' && f.sk !== 'high') { nsub++; if (Math.abs(f.nx) > 0.6 || Math.abs(f.ny) > 0.6) out++; }
    if (i > 4 && f.id && rec[i - 4].id === f.id && rec[i - 1].sk === f.sk && f.t - rec[i - 1].t < 0.25) { const w = ang(f, rec[i - 1]) / Math.max(1e-3, f.t - rec[i - 1].t); if (w > maxRot) { maxRot = w; rotAt = f.sk + ' @' + f.t.toFixed(1); } }
  });
  console.log(`[camera] frames ${rec.length}, min height over ground ${minG.toFixed(1)}, min hull clearance (below 14) ${minH.toFixed(1)}, subject off-frame ${out}/${nsub}, max view rotation ${maxRot.toFixed(2)} rad/s (${rotAt})`);
  console.log('errors', errs.length, errs.slice(0, 5).join(' / '));
  await b.close();
})();
