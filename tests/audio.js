// Audio engine verification (WW.audio). node tests/audio.js   (starts its own server on PORT, default 8794)
// 1. sound off: 10 sim minutes create no AudioContext and no AudioNode
// 2. sound on (trusted key press): a battle keeps voices <= cap, no errors
// 3. master output: not silent, peak below 0 dBFS with headroom, no NaN (also under a 200-boom stress)
// 4. each example patch rendered offline: sane rms, peak, duration
// plus: toggle off/on, hidden tab suspend, remembered "on" waits for a gesture, cost of audio update per frame.
const path = require('path'), { spawn } = require('child_process');
require('fs').mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8794);
(async () => {
  let server = null;
  if (!process.env.BASE_URL) { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1000)); }
  const URL = (process.env.BASE_URL || `http://localhost:${PORT}/`) + 'index.html';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const A = [], chk = (name, v) => A.push((v ? 'PASS ' : 'FAIL ') + name);
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    if (!sessionStorage.getItem('keepPrefs')) try { localStorage.removeItem('ww.audio'); } catch (e) {}
    const C = window.__ac = { contexts: 0, nodes: 0 };
    const Orig = window.AudioContext;
    if (Orig) {
      window.AudioContext = function (o) { C.contexts++; return new Orig(o); };
      window.AudioContext.prototype = Orig.prototype;
      const P = (window.BaseAudioContext || Orig).prototype;
      for (const k of Object.getOwnPropertyNames(P)) {
        if (!/^create/.test(k) || k === 'createBuffer' || k === 'createPeriodicWave') continue;
        const f = P[k]; if (typeof f !== 'function') continue;
        P[k] = function () { C.nodes++; return f.apply(this, arguments); };
      }
    }
  });
  await p.goto(URL);
  await p.waitForTimeout(1500);

  // ---- 1. disabled: zero cost ----
  const off = await p.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) __sim.fastForward(15); // 600 sim seconds
    const simMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 1e6; i++) WW.audio.play('gun.big', { x: 1, y: 2, z: 3 });
    const playNs = (performance.now() - t1) * 1e6 / 1e6;
    const h = WW.audio.loop('gun.big', { x: 0, z: 0 }); h.set({ x: 5 }); h.stop();
    return { ac: Object.assign({}, __ac), simMs, playNs, shells: WW.stats.shellsFired, rounds: WW.stats.round, enabled: WW.audio.enabled, ctx: !!WW.audio.ctx };
  });
  chk(`sound off: 600 sim s (${off.shells} shells, round ${off.rounds}) created ${off.ac.contexts} contexts, ${off.ac.nodes} nodes`, off.ac.contexts === 0 && off.ac.nodes === 0 && !off.ctx && !off.enabled);
  console.log('disabled play() cost', off.playNs.toFixed(1), 'ns/call; 600 sim s in', off.simMs.toFixed(0), 'ms');

  // ---- 4. offline renders (no live context) ----
  const offl = await p.evaluate(async () => {
    const out = {};
    for (const [n, prm, s] of [['ui.click', {}, 1], ['gun.big', { size: 1 }, 5], ['gun.big', { size: 1.4 }, 6], ['amb.sea', { height: 40 }, 4]]) {
      const r = await WW.audio.renderOffline(n, prm, s);
      out[n + (prm.size ? '@' + prm.size : '')] = { peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), dur: +r.dur.toFixed(2), nan: r.nan };
    }
    return out;
  });
  console.log('offline', JSON.stringify(offl));
  const o1 = offl['ui.click'], o2 = offl['gun.big@1'], o3 = offl['amb.sea'];
  chk('offline ui.click: short and soft ' + JSON.stringify(o1), !o1.nan && o1.peak > 0.05 && o1.peak < 0.8 && o1.dur > 0.01 && o1.dur < 0.3);
  chk('offline gun.big: loud, 1-4.5 s ' + JSON.stringify(o2), !o2.nan && o2.peak > 0.2 && o2.peak < 2 && o2.dur > 1 && o2.dur < 4.5 && o2.rms > 0.01);
  chk('offline amb.sea: steady bed ' + JSON.stringify(o3), !o3.nan && o3.rms > 0.01 && o3.peak < 1.5 && o3.dur > 3);

  // ---- 2. enable with a trusted key press, run a battle ----
  await p.evaluate(() => __sim.game.startRound());
  await p.keyboard.press('m');
  await p.waitForTimeout(400);
  const on = await p.evaluate(() => ({ live: WW.audio.live, state: WW.audio.ctx && WW.audio.ctx.state, label: [...document.querySelectorAll('#hud .corner button')].map(b => b.textContent).join(' | ') }));
  chk('M key enables sound (' + JSON.stringify(on) + ')', on.live && on.state === 'running');
  await p.evaluate(() => {
    window.__au = { maxVoices: 0, peak: 0, rmsMax: 0, nan: false, samples: 0, upd: 0, frames: 0 };
    const u = WW.audio.update;
    WW.audio.update = function (rdt) { const t = performance.now(); u(rdt); __au.upd += performance.now() - t; __au.frames++; };
    window.__poll = setInterval(() => {
      const m = WW.audio.meter(), s = WW.audio.stats();
      __au.samples++; __au.peak = Math.max(__au.peak, m.peak); __au.rmsMax = Math.max(__au.rmsMax, m.rms); __au.nan = __au.nan || m.nan;
      __au.maxVoices = Math.max(__au.maxVoices, s.voices);
    }, 200);
  });
  // fast-forward into the fight (voices checked every sim step), then watch it in real time at 4x and 1x
  const ffv = await p.evaluate(() => { let mx = 0; for (let i = 0; i < 12; i++) __sim.fastForward(5, () => { mx = Math.max(mx, WW.audio.stats().voices); }); return mx; });
  await p.evaluate(() => __sim.setScale(4));
  await p.waitForTimeout(12000);
  await p.evaluate(() => __sim.setScale(1));
  await p.waitForTimeout(6000);
  // slow motion: pitch follows WW.time.warp
  // (camera_action.js rewrites WW.time.warp every frame, so pin it with a getter for the probe)
  const slow = await p.evaluate(async () => {
    Object.defineProperty(WW.time, 'warp', { configurable: true, get: () => 0.5, set() {} });
    await new Promise(r => setTimeout(r, 2500)); const pt = WW.audio.pitch;
    delete WW.time.warp; WW.time.warp = 1; return pt;
  });
  const st = await p.evaluate(() => Object.assign({ au: __au, cap: WW.audio.C.MAX_VOICES }, WW.audio.stats(), { shells: WW.stats.shellsFired }));
  console.log('battle stats', JSON.stringify(st));
  chk(`voices <= cap during fast-forward (${ffv}) and real time (${st.au.maxVoices}) cap ${st.cap}`, ffv <= st.cap && st.au.maxVoices <= st.cap);
  chk('something played (' + st.played + ' one-shots, ' + st.loopVoices + ' loop voices)', st.played > 0 && st.built > 0);
  chk('slow motion lowers pitch (' + slow.toFixed(3) + ')', slow < 0.9);
  const dop = await p.evaluate(() => { const L = WW.audio.listener, s = { x: L.x + 100, y: L.y, z: L.z };
    return [WW.audio.doppler(s, { x: -30, y: 0, z: 0 }), WW.audio.doppler(s, { x: 30, y: 0, z: 0 }), WW.audio.delayFor(150)]; });
  chk('doppler: approaching ' + dop[0].toFixed(3) + ' > 1 > receding ' + dop[1].toFixed(3) + '; sound delay at 150 units ' + dop[2].toFixed(2) + ' s', dop[0] > 1.1 && dop[1] < 0.9 && dop[2] > 0.3 && dop[2] < 1);
  chk(`master not silent (max rms ${st.au.rmsMax.toFixed(4)})`, st.au.rmsMax > 1e-4);
  chk(`master peak ${st.au.peak.toFixed(3)} (${(20 * Math.log10(st.au.peak || 1e-9)).toFixed(1)} dBFS) < -1 dBFS, no NaN (${st.au.samples} samples)`, st.au.peak < 0.891 && !st.au.nan);
  chk('no engine errors (' + st.errors + ')', st.errors === 0);
  console.log('audio update cost', (st.au.upd / st.au.frames).toFixed(3), 'ms/frame over', st.au.frames, 'frames; nodes created', st.nodes, '(page count ' + (await p.evaluate(() => __ac.nodes)) + '), live nodes now', st.liveNodes);

  // ---- 3b. stress: 200 big booms right at the camera ----
  const stress = await p.evaluate(async () => {
    const c = WW.camera.position; let mx = 0;
    for (let i = 0; i < 200; i++) { const n = WW.audio.patches['gun.big']; const g = n.minGap; n.minGap = 0; WW.audio.play('gun.big', { x: c.x + Math.random() * 20 - 10, y: 0, z: c.z + Math.random() * 20 - 10, sos: false, delay: i * 0.004 }); n.minGap = g; mx = Math.max(mx, WW.audio.stats().voices); }
    let pk = 0, nan = false;
    for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 150)); const m = WW.audio.meter(); pk = Math.max(pk, m.peak); nan = nan || m.nan; }
    return { mx, pk, nan, s: WW.audio.stats() };
  });
  chk(`stress: 200 booms -> max ${stress.mx} voices (${stress.s.stolen} stolen, ${stress.s.dropped} dropped), peak ${stress.pk.toFixed(3)} (${(20 * Math.log10(stress.pk)).toFixed(1)} dBFS)`, stress.mx <= 48 && stress.pk < 0.95 && stress.pk > 0.05 && !stress.nan);

  // ---- 3c. global cap: a test patch with no per-patch cap, 300 plays at varied distances ----
  const gcap = await p.evaluate(async () => {
    const S = WW.audio.syn; WW.audio.register('test.tone', { max: 999, dur: 1.5, build: (ctx, out, q) => S.done(q, [S.tone(ctx, out, q.t, { f: 200 + Math.random() * 600, d: 1.2, gain: 0.2, rate: q.rate })]) });
    const c = WW.camera.position, s0 = WW.audio.stats(); let mx = 0;
    for (let i = 0; i < 300; i++) { const r = 5 + Math.random() * 400, a = Math.random() * 6.28; WW.audio.play('test.tone', { x: c.x + Math.cos(a) * r, y: 0, z: c.z + Math.sin(a) * r }); mx = Math.max(mx, WW.audio.stats().voices); }
    await new Promise(r => setTimeout(r, 300)); const m = WW.audio.meter(), s1 = WW.audio.stats();
    return { mx, stolen: s1.stolen - s0.stolen, dropped: s1.dropped - s0.dropped, culled: s1.culled - s0.culled, peak: m.peak, nan: m.nan, errors: s1.errors };
  });
  chk(`global cap: 300 plays -> max ${gcap.mx} voices (${gcap.stolen} stolen, ${gcap.dropped} dropped, ${gcap.culled} culled), peak ${gcap.peak.toFixed(3)}`, gcap.mx <= 48 && gcap.stolen + gcap.dropped > 0 && !gcap.nan && gcap.peak < 0.95 && gcap.errors === 0);

  // ---- loop cap: the nearest loops win; voice.stop(); pan side ----
  const lc = await p.evaluate(async () => {
    const S = WW.audio.syn, L = WW.audio.listener, got = [];
    WW.audio.register('test.hum', { max: 2, ref: 20, build(ctx, out, q) { const s = S.src(ctx, 'pink', q.t); const g = S.gain(ctx, 0.1, out); s.connect(g);
      return { dur: Infinity, set(k) { got.push(Object.keys(k).join(',')); }, stop(t) { s.stop(t); } }; } });
    const at = d => ({ x: L.x + L.rx * d, y: L.y + L.ry * d, z: L.z + L.rz * d });
    const hs = [200, 150, 100].map(d => WW.audio.loop('test.hum', { at: at(d) }));
    await new Promise(r => setTimeout(r, 1200));
    const near = WW.audio.loop('test.hum', { at: at(10) });
    await new Promise(r => setTimeout(r, 1200));
    near.set({ vol: 0.9, rate: 1.1, foo: 1 });
    const res = { near: !!near.voice, far: !!hs[0].voice, pan: near.voice ? near.voice.pan.pan.value : null, fwd: got.slice() };
    hs.concat(near).forEach(h => h.stop(0.05));
    const c = WW.camera.position, v = WW.audio.play('test.tone', { x: c.x, y: c.y, z: c.z });
    const n0 = WW.audio.stats().voices; v.stop(0.02); res.stopped = WW.audio.stats().voices === n0 - 1;
    return res;
  });
  chk('loop cap (max 2): nearest loop gets a voice, farthest lost it; pan right ' + (lc.pan || 0).toFixed(2) + '; set() forwards only patch keys ' + JSON.stringify(lc.fwd) + '; voice.stop works ' + lc.stopped,
    lc.near && !lc.far && lc.pan > 0.3 && !lc.fwd.some(k => /vol|,?x|at/.test(k) && k !== 'foo' && !/^rate$/.test(k)) && lc.fwd.includes('foo') && lc.stopped);

  // ---- fps / draw time with sound on vs off during a heavy battle ----
  const fpsOf = () => p.evaluate(() => new Promise(res => { let n = 0, worst = 0, last = performance.now(); const t0 = last;
    (function f() { const t = performance.now(); worst = Math.max(worst, t - last); last = t; n++; if (t - t0 < 5000) requestAnimationFrame(f); else res({ fps: n / ((t - t0) / 1000), worst }); })(); }));
  await p.evaluate(() => __sim.setScale(2));
  const fOn = await fpsOf();
  await p.keyboard.press('m'); await p.waitForTimeout(400);
  const offState = await p.evaluate(() => ({ live: WW.audio.live, voices: WW.audio.stats().voices, state: WW.audio.ctx.state }));
  const fOff = await fpsOf();
  console.log('fps sound on', fOn.fps.toFixed(1), 'worst frame', fOn.worst.toFixed(0), 'ms | sound off', fOff.fps.toFixed(1), 'worst', fOff.worst.toFixed(0), 'ms');
  chk('M again turns sound off: no voices, context suspended (' + JSON.stringify(offState) + ')', !offState.live && offState.voices === 0 && offState.state === 'suspended');
  await p.keyboard.press('m'); await p.waitForTimeout(800);
  const again = await p.evaluate(() => ({ live: WW.audio.live, loopVoices: WW.audio.stats().loopVoices }));
  chk('on again: ambience loop comes back (' + JSON.stringify(again) + ')', again.live && again.loopVoices >= 1);
  // hidden tab
  const hid = await p.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 300)); const a = WW.audio.ctx.state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 300)); return [a, WW.audio.ctx.state, WW.audio.live];
  });
  chk('hidden tab suspends, visible resumes (' + hid.join(',') + ')', hid[0] === 'suspended' && hid[1] === 'running' && hid[2]);
  chk('no console/page errors (' + errs.length + ')', errs.length === 0);
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));

  // ---- remembered "on": reload, wait for a gesture ----
  await p.evaluate(() => { sessionStorage.setItem('keepPrefs', '1'); WW.audio.setVolume(0.5); });
  await p.reload(); await p.waitForTimeout(1500);
  const pend = await p.evaluate(() => ({ pending: WW.audio.pending, ctx: !!WW.audio.ctx, label: document.querySelector('#hud .corner button[data-audio]').textContent, vol: WW.audio.volume }));
  await p.mouse.click(400, 300); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ live: WW.audio.live, pending: WW.audio.pending }));
  chk('remembered on: waits for a gesture (' + JSON.stringify(pend) + '), first click starts it (' + JSON.stringify(after) + ')', pend.pending && !pend.ctx && /Tap/.test(pend.label) && pend.vol === 0.5 && after.live && !after.pending);
  await p.screenshot({ path: path.join(__dirname, 'shots', 'audio_hud.png') });

  A.forEach(a => console.log(a));
  console.log(A.every(a => a.startsWith('PASS')) ? 'ALL PASS' : 'SOME FAILED');
  await b.close();
  if (server) server.kill();
})().catch(e => { console.error(e); process.exit(1); });
