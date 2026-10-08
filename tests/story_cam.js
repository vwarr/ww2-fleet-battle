// Story mode probe (camera_story.js): forces a story on a strike, steps it through its phases and saves a
// screenshot ~2 s into each shot (tests/shots/story/), logs the shot sequence and timings, then checks the
// protagonist-death hand-off (WW.airDeaths.force on the leader), the F key toggle and a freecam plane click.
// Usage: BASE_URL=http://localhost:PORT/ node tests/story_cam.js [seed=3] [realSeconds=150] [story,forced,death,keys,relative,lead,auto]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'story');
fs.mkdirSync(OUT, { recursive: true }); process.chdir(__dirname);
const { chromium } = require('playwright');
const SEED = +(process.argv[2] || 3), SECS = +(process.argv[3] || 150), WHICH = (process.argv[4] || 'story,forced,death,keys,relative,lead,auto').split(',');
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
    const st = await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; const c = WW.camera.position, s = WW.cam._shot(); return [c.x, c.y, c.z].map(v => v.toFixed(1)).join(',') + ' ' + (s ? s.kind + '/' + s.sk : '-'); });
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
    console.log('  ', await p.evaluate(() => { const s = WW.cam._shot(), L = s.subj, f = v => v ? [v.x, v.y, v.z].map(a => (+a).toFixed(0)).join(',') : '-'; return 'lead ' + f(L) + ' ' + L.state + ' centre ' + f(s.cS) + ' cam ' + f(WW.camera.position) + ' group ' + (s.group || []).length; }));
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

  // 4. F always does something visible; Tab / Shift+Tab cycle the upcoming attacks; F again hands back
  if (WHICH.includes('keys')) {
  const msg = () => p.evaluate(() => { const m = document.querySelector('#hud .msg'); return m ? m.textContent : ''; });
  const lab = () => p.evaluate(() => WW.camFollow.labelText());
  // a) no planes in the air yet: a fresh round
  await p.evaluate(() => { WW.camStory.stop(); WW.game.startRound(); __step(10); });
  await p.keyboard.press('f'); await p.evaluate(() => __step(40));
  const f0 = { msg: await msg(), story: await p.evaluate(() => WW.camStory.active()), shot: await p.evaluate(() => { const s = WW.cam._shot(); return s ? s.kind + (s.user ? ' user' : '') : '-'; }) };
  console.log((/^Follow: (?!off)/.test(f0.msg) ? 'PASS' : 'FAIL') + ' F with no planes up:', JSON.stringify(f0));
  await snap('keys_F_no_planes');
  await p.keyboard.press('f'); await p.evaluate(() => __step(5));
  // b) an imminent attack: F jumps to it with a lead label
  const imm = await p.evaluate(() => { __sim.setScale(1); const it = until(() => WW.camFinder.list().find(i => i.subj && i.subj.pt && i.etaReal > 8 && i.etaReal < 40), 400); return it ? it.kind + ' ' + it.label + ' eta ' + it.etaReal.toFixed(0) + ' s' : null; });
  console.log('[F] imminent:', imm);
  if (imm) {
    await p.keyboard.press('f'); await p.evaluate(() => { __render = false; __step(75); });
    const r = { msg: await msg(), label: await lab(), story: await p.evaluate(() => { const s = WW.camStory.story(); return s && s.user && s.begun; }) };
    console.log((r.story && /in ~|now/.test(r.msg) ? 'PASS' : 'FAIL') + ' F jumps to the imminent attack:', JSON.stringify(r));
    await snap('keys_F_imminent');
    // Tab, Tab, Shift+Tab
    const tabs = [];
    for (const k of ['Tab', 'Tab', 'Shift+Tab']) { await p.keyboard.press(k); await p.evaluate(() => { __render = false; __step(45); }); tabs.push(await msg()); }
    console.log('[Tab]', tabs.join(' | '));
    const n0 = (tabs[0].match(/^(\d+)\//) || [])[1], n2 = (tabs[2].match(/^(\d+)\//) || [])[1];
    console.log(/^\d+\/\d+/.test(tabs[0]) && n0 === n2 ? 'PASS Tab / Shift+Tab cycle' : (/^No attacks/.test(tabs[0]) ? 'SKIP Tab (nothing upcoming)' : 'FAIL Tab cycle'));
    await snap('keys_tab');
    await p.keyboard.press('f'); await p.evaluate(() => __step(5));
    const off = { msg: await msg(), story: await p.evaluate(() => WW.camStory.active()), fc: await p.evaluate(() => WW.freecam.active()) };
    console.log((/off/.test(off.msg) && !off.story && !off.fc ? 'PASS' : 'FAIL') + ' F hands back:', JSON.stringify(off));
  }
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

  // 7. relative camera while following: orbit / zoom / angle in the subject's frame, O toggles world-fixed
  if (WHICH.includes('relative')) {
    const st = await p.evaluate(() => {
      __sim.setScale(1); WW.freecam.release();
      const L = until(() => WW.world.planes.find(q => q.alive && q.state === 'transit' && q.y > 20 && q.squadron && q.wing === 0), 300);
      if (!L) return null;
      window.__L = L; WW.camStory.start(L); __render = false; __step(90);
      // the subject-frame angle of the camera: 0 = dead astern, + = to its right
      window.__rel = () => { const c = WW.camera.position, h = __L.heading, dx = c.x - __L.x, dz = c.z - __L.z;
        const back = -(dx * Math.cos(h) + dz * Math.sin(h)), right = dx * -Math.sin(h) + dz * Math.cos(h);
        return { ang: Math.atan2(right, back), world: Math.atan2(dx, dz), d: Math.hypot(dx, c.y - __L.y, dz), h, y: c.y - __L.y }; };
      return L.kind + ' ' + (L.squadron && L.squadron.short);
    });
    console.log('[relative] subject', st);
    if (st) {
      const fmt = r => `ang ${(r.ang * 57.3).toFixed(0)} deg, world ${(r.world * 57.3).toFixed(0)}, dist ${r.d.toFixed(0)}, above ${r.y.toFixed(0)}, heading ${(r.h * 57.3).toFixed(0)}`;
      const r0 = await p.evaluate(() => { WW.freecam._input(0, 0, 1); __step(45); return Object.assign(__rel(), { f: WW.freecam.following() === __L }); });
      console.log('  take-over (inherits the subject):', r0.f, fmt(r0));
      await snap('rel_0_takeover');
      const r1 = await p.evaluate(() => { WW.freecam._input(1.3, 0.1, 1); __step(60); return __rel(); });
      console.log('  orbit +75 deg:', fmt(r1)); await snap('rel_1_orbit');
      const r2 = await p.evaluate(() => { WW.freecam._input(0, 0, 0.55); __step(60); return __rel(); });
      console.log('  zoom in x0.55:', fmt(r2)); await snap('rel_2_zoom');
      const r3 = await p.evaluate(() => { const out = []; for (let i = 0; i < 8; i++) { WW.freecam._input(0, 0, 1); __step(30); out.push(__rel()); } return out; });
      const dh = Math.abs(r3[7].h - r3[0].h), spread = Math.max(...r3.map(r => r.ang)) - Math.min(...r3.map(r => r.ang));
      console.log(`  holding while it flies 8 s: heading changed ${(dh * 57.3).toFixed(0)} deg, subject-frame angle spread ${(spread * 57.3).toFixed(0)} deg, dist ${r3[7].d.toFixed(0)}`);
      console.log((r0.f && Math.abs(r1.ang - r0.ang) > 0.8 && r2.d < r1.d * 0.8 && spread < 0.35 ? 'PASS' : 'FAIL') + ' relative orbit / zoom');
      await p.keyboard.press('o');
      const r4 = await p.evaluate(() => { const out = []; for (let i = 0; i < 6; i++) { WW.freecam._input(0, 0, 1); __step(30); out.push(__rel()); } return { out, rel: WW.freecam.rel() }; });
      const wsp = Math.max(...r4.out.map(r => r.world)) - Math.min(...r4.out.map(r => r.world));
      console.log(`  O -> ${r4.rel ? 'heading' : 'world-fixed'}: world-angle spread ${(wsp * 57.3).toFixed(0)} deg, subject-frame ${(r4.out[0].ang * 57.3).toFixed(0)} -> ${(r4.out[5].ang * 57.3).toFixed(0)}`);
      await snap('rel_3_worldfixed');
      await p.keyboard.press('o');
      // hand back: no input for the follow idle time -> the director (the story) carries on
      const hb = await p.evaluate(() => { const a = WW.freecam.active(); __step(30 * 11); return { before: a, after: WW.freecam.active(), story: WW.camStory.active(), shot: (WW.cam._shot() || {}).kind }; });
      console.log((hb.before && !hb.after && hb.story ? 'PASS' : 'FAIL') + ' hand-back after the idle time, the story goes on:', JSON.stringify(hb));
    }
  }

  // 8. lead time: how long before each bomb / torpedo release the camera was already on that strike
  if (WHICH.includes('lead')) {
    await p.evaluate(t => { window.__TRACE = t; }, !!process.env.TRACE);
    const r = await p.evaluate((secs) => {
      WW.camStory.stop(); WW.freecam.release(); WW.game.startRound(); __sim.setScale(2); __render = false; if (window.__TRACE) window.__trace = [];
      const since = new Map(), drops = [];
      const onW = () => { const s = WW.cam._shot(), st = WW.camStory.story(), set = new Set();
        const add = o => { if (o && o.wave) set.add(o.wave); };
        if (s) { add(s.subj); add(s.plane); } if (st && st.begun) add(st.lead); return set; };
      WW.on('weaponDropped', e => { const pl = e && e.plane; if (!pl || !pl.kind || !pl.wave || (e.kind !== 'bomb' && e.kind !== 'torpedo')) return;
        const t0 = since.get(pl.wave); drops.push({ kind: e.kind, sq: pl.squadron && pl.squadron.short, lead: t0 === undefined ? null : __fakeT / 1000 - t0, sim: WW.time.now }); });
      for (let i = 0; i < secs * 30 && WW.game.state === 'battle'; i += 3) {
        __step(3);
        const on = onW();
        for (const w of [...since.keys()]) if (!on.has(w)) since.delete(w);
        for (const w of on) if (!since.has(w)) since.set(w, __fakeT / 1000);
        if (i % 150 === 0 && window.__trace) { const st = WW.camStory.story(), sh = WW.cam._shot(), t = WW.camFinder.list()[0];
          __trace.push(`sim ${WW.time.now.toFixed(0)} shot ${sh ? sh.kind + '/' + (sh.sk || '') + ' t' + sh.t.toFixed(0) + '/' + sh.dur.toFixed(0) : '-'} story ${st ? (st.lead.squadron ? st.lead.squadron.short : '') + ' ' + st.lead.kind + ' w' + (st.lead.wave ? 1 : 0) + ' ' + st.lead.state + '/' + (st.lead.phase || st.lead.sk || '') + (st.begun ? '' : ' (waiting)') + (st.item ? ' imm' : '') : '-'} top ${t ? t.kind + ' ' + (t.subj.squadron ? t.subj.squadron.short : '') + ' ' + t.etaReal.toFixed(0) + 's ' + t.score.toFixed(1) : '-'}`); }
      }
      __render = true;
      return { trace: window.__trace || [], drops, rate: WW.camFinder.rate(), stories: WW.camStory.stats };
    }, SECS * 2);
    // one entry per wave and kind (the first release)
    const seen = new Set(), first = r.drops.filter(d => { const k = d.sq + d.kind; if (seen.has(k)) return false; seen.add(k); return true; });
    if (r.trace.length) console.log(r.trace.join('\n'));
    console.log('[lead] sim rate ' + r.rate.toFixed(2) + ' sim s per real s; stories ' + JSON.stringify(r.stories));
    for (const d of first) console.log(`   ${d.sq} ${d.kind} at sim ${d.sim.toFixed(0)}: ` + (d.lead === null ? 'NOT on camera' : `camera on the strike ${d.lead.toFixed(1)} real s before (${(d.lead * r.rate).toFixed(1)} sim s)`));
    const ok10 = first.filter(d => d.lead !== null && d.lead >= 10).length;
    console.log(`[lead] ${ok10}/${first.length} first releases had the camera on them >= 10 s before`);
  }

  // 6. the director starts stories by itself (every few minutes, not back-to-back)
  if (WHICH.includes('auto')) {
    const r = await p.evaluate(() => {
      WW.camStory.stop(); WW.camStory.log.length = 0; __sim.setScale(1); WW.game.startRound();
      __render = false; const out = [];
      for (let i = 0; i < 300 * 30; i += 30) { __step(30); const s = WW.cam._shot(); if (WW.game.state !== 'battle') break; }
      for (const e of WW.camStory.log) if (e.start || e.end) out.push((e.start ? 'START ' + e.lead + ' (' + e.mission + ')' : 'END') + ' @' + e.at.toFixed(0));
      __render = true;
      return { out, stats: WW.camStory.stats, state: WW.game.state, t: WW.game.roundTime };
    });
    console.log('[auto]', r.out.join(' | '), JSON.stringify(r.stats), r.state);
    console.log(r.out.some(x => /^START/.test(x)) ? 'PASS auto story' : 'FAIL auto story');
  }

  // camera sanity over the whole recording
  const rec = await p.evaluate(() => __rec.slice());
  const offBy = {}; let minG = 99, minH = 99, out = 0, nsub = 0, maxRot = 0, rotAt = '';
  const ang = (a, c) => Math.acos(Math.min(1, a.fx * c.fx + a.fy * c.fy + a.fz * c.fz));
  rec.forEach((f, i) => {
    minG = Math.min(minG, f.ground); minH = Math.min(minH, f.hull);
    if (f.sk !== '-' && f.sk !== 'high') { nsub++; if (Math.abs(f.nx) > 0.6 || Math.abs(f.ny) > 0.6) { out++; offBy[f.sk] = (offBy[f.sk] || 0) + 1; } }
    if (i > 4 && f.id && rec[i - 4].id === f.id && rec[i - 1].sk === f.sk && f.t - rec[i - 1].t < 0.25) { const w = ang(f, rec[i - 1]) / Math.max(1e-3, f.t - rec[i - 1].t); if (w > maxRot) { maxRot = w; rotAt = f.sk + ' @' + f.t.toFixed(1); } }
  });
  console.log(`[camera] frames ${rec.length}, min height over ground ${minG.toFixed(1)}, min hull clearance (below 14) ${minH.toFixed(1)}, subject off-frame ${out}/${nsub} ${JSON.stringify(offBy)}, max view rotation ${maxRot.toFixed(2)} rad/s (${rotAt})`);
  console.log('errors', errs.length, errs.slice(0, 5).join(' / '));
  await b.close();
})();
