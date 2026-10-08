// Aircraft sound verification (js/audio_air.js). node tests/audio_air.js   (own server on PORT, default 8812)
//   OUT=<dir>  also writes WAV renders of every patch + a 20 s master excerpt there
//   QUICK=1    shorter live battle (for iterating)
// 1. sound off: a long battle with planes creates no AudioContext / AudioNode; the air events still fire
// 2. offline: every patch renders with sane peak / duration / no NaN, not hissy (rms of the first difference)
// 3. engine loop: pitch follows set({ thr }) and set({ rate }); a fly-by past the camera gets doppler up, then down
// 4. live battle with sound on (trusted key press) at 4x and 1x: voices <= cap, engine voices <= N, no errors,
//    master peak < -1 dBFS, no NaN; per-patch play / cull / throttle counts
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8812), OUT = process.env.OUT || '', QUICK = !!process.env.QUICK;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
(async () => {
  let server = null;
  if (!process.env.BASE_URL) { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1000)); }
  const URL = (process.env.BASE_URL || `http://localhost:${PORT}/`) + 'index.html?auto';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const A = [], chk = (name, v) => { A.push((v ? 'PASS ' : 'FAIL ') + name); };
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    try { localStorage.removeItem('ww.audio'); } catch (e) {}
    const C = window.__ac = { contexts: 0, nodes: 0 };
    const Orig = window.AudioContext;
    if (!Orig) return;
    window.AudioContext = function (o) { C.contexts++; return new Orig(o); };
    window.AudioContext.prototype = Orig.prototype;
    const P = (window.BaseAudioContext || Orig).prototype;
    for (const k of Object.getOwnPropertyNames(P)) {
      if (!/^create/.test(k) || k === 'createBuffer' || k === 'createPeriodicWave') continue;
      const f = P[k]; if (typeof f !== 'function') continue;
      P[k] = function () { if (!(this instanceof OfflineAudioContext)) C.nodes++; return f.apply(this, arguments); };
    }
    // master recorder: whatever the engine connects to the speakers is also fed to a ScriptProcessor (silent output)
    const conn = AudioNode.prototype.connect;
    window.__rec = { on: false, L: [], R: [], n: 0, max: 48000 * 21 };
    AudioNode.prototype.connect = function (dst) {
      const r = conn.apply(this, arguments);
      if (dst instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext) && !this.__tap && !window.__tapNode) {
        const sp = this.context.createScriptProcessor(4096, 2, 2); window.__tapNode = sp; this.__tap = true;
        sp.onaudioprocess = ev => {
          const R = window.__rec; if (!R.on || R.n >= R.max) return;
          R.L.push(new Float32Array(ev.inputBuffer.getChannelData(0))); R.R.push(new Float32Array(ev.inputBuffer.getChannelData(1))); R.n += 4096;
        };
        conn.call(this, sp); conn.call(sp, dst);
      }
      return r;
    };
    // 16-bit stereo WAV as base64
    window.__wav = (L, R, sr) => {
      const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
      const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
      return btoa(s);
    };
  });
  await p.goto(URL);
  await p.waitForTimeout(1500);
  const save = (name, b64) => { if (OUT && b64) fs.writeFileSync(path.join(OUT, name + '.wav'), Buffer.from(b64, 'base64')); };

  // ---- 1. sound off: zero cost, events fire ----
  const off = await p.evaluate(() => {
    const ev = {}; for (const n of ['planeHit', 'weaponDropped']) WW.on(n, () => { ev[n] = (ev[n] || 0) + 1; });
    let modes = {};
    __sim.game.startRound();
    for (let i = 0; i < 30; i++) __sim.fastForward(10, () => { for (const q of WW.world.planes) if (q.deathMode) modes[q.deathMode] = 1; });
    return { ac: Object.assign({}, __ac), ev, modes: Object.keys(modes), planes: WW.stats.planesLaunched, ctx: !!WW.audio.ctx, air: WW.audioAir.stats() };
  });
  chk(`sound off: 300 sim s (${off.planes} planes launched, ${off.ev.planeHit} planeHit, ${off.ev.weaponDropped} weaponDropped, deaths ${off.modes.join('/')}) -> ${off.ac.contexts} contexts, ${off.ac.nodes} nodes, ${off.air.tracked} tracked`,
    off.ac.contexts === 0 && off.ac.nodes === 0 && !off.ctx && off.ev.planeHit > 0 && off.air.tracked === 0);

  // ---- 2. offline renders ----
  const LIST = [
    ['plane.engine', { type: 'wildcat' }, 3], ['plane.engine', { type: 'zero' }, 3], ['plane.engine', { type: 'dive' }, 3],
    ['plane.engine', { type: 'torp' }, 3], ['plane.engine', { type: 'scout' }, 3],
    ['plane.engine', { type: 'dive', thr: 0.6, dive: 1, air: 1.1 }, 3, 'dive_howl'], ['plane.engine', { type: 'wildcat', thr: 1.1, fire: 1, whine: 0.9, air: 1 }, 3, 'burning'],
    ['plane.gun', { zero: 0 }, 1.2, 'wildcat'], ['plane.gun', { zero: 1 }, 1.2, 'zero'],
    ['plane.hit', {}, 1], ['plane.whoosh', {}, 2], ['bomb.release', {}, 1], ['bomb.whistle', { k: 1 }, 1.5], ['plane.torpdrop', {}, 2.5],
    ['plane.splash', { size: 0.4 }, 2.5, 'small'], ['plane.splash', { size: 1.6 }, 3, 'med'], ['plane.splash', { size: 3 }, 4, 'big'],
    ['plane.wingrip', {}, 2], ['plane.fireball', { size: 0.45 }, 2.5, 'small'], ['plane.fireball', { size: 1.2 }, 3.5, 'big'], ['plane.crunch', {}, 3],
    ['plane.ditch', {}, 3.5], ['chute.pop', {}, 1.5], ['deck.roll', { dur: 1 }, 2.5], ['deck.trap', {}, 2.5], ['deck.barrier', {}, 2.5],
    ['deck.fold', {}, 2], ['deck.elevator', {}, 3], ['deck.catapult', {}, 2.5]
  ];
  const offl = await p.evaluate(async ({ LIST, save }) => {
    const out = [];
    for (const [n, prm, secs, tag] of LIST) {
      const r = await WW.audio.renderOffline(n, prm, secs);
      const d = r.buffer.getChannelData(0); let s = 0, s1 = 0;
      for (let i = 1; i < d.length; i++) { s += d[i] * d[i]; const e = d[i] - d[i - 1]; s1 += e * e; }
      const name = n + (tag ? '.' + tag : prm.type ? '.' + prm.type : '');
      out.push({ name, loop: !isFinite(WW.audio.patches[n].dur), peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), dur: +r.dur.toFixed(2), nan: r.nan, hf: +Math.sqrt(s1 / (s || 1e-12)).toFixed(3),
        wav: save ? __wav(r.buffer.getChannelData(0), r.buffer.getChannelData(1), r.buffer.sampleRate) : null });
    }
    return out;
  }, { LIST, save: !!OUT });
  for (const o of offl) {
    save(o.name, o.wav);
    console.log('offline', o.name.padEnd(26), 'peak', o.peak, 'rms', o.rms, 'dur', o.dur, 'hf', o.hf);
    const durOk = o.loop ? o.dur > 0.5 : o.dur > 0.05 && o.dur < 3.5;
    const hfMax = /engine/.test(o.name) ? 0.2 : 0.6;
    chk(`offline ${o.name}: peak ${o.peak} in 0.05..1, dur ${o.dur}, hf ${o.hf} < ${hfMax}, no NaN`, !o.nan && o.peak >= 0.05 && o.peak <= 1 && durOk && o.hf < hfMax);
  }

  // ---- 3. engine loop responds to set(): pitch by autocorrelation before / after a mid-render set() ----
  const eng = await p.evaluate(async () => {
    const def = WW.audio.patches['plane.engine'];
    function pitch(d, sr, a, b) { // fundamental by harmonic product (f, 2f, 3f) over 40..200 Hz (Goertzel, 0.25 Hz steps)
      const i0 = Math.floor(a * sr), n = Math.floor((b - a) * sr);
      const pw = f => { const w = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0;
        for (let i = 0; i < n; i++) { const s0 = d[i0 + i] + w * s1 - s2; s2 = s1; s1 = s0; } return s1 * s1 + s2 * s2 - w * s1 * s2 + 1e-12; };
      let best = -1e9, bf = 0;
      for (let f = 40; f <= 200; f += 0.25) { const v = Math.log(pw(f)) + Math.log(pw(2 * f)) + Math.log(pw(3 * f)); if (v > best) { best = v; bf = f; } }
      return bf;
    }
    async function run(type, q) {
      const oc = new OfflineAudioContext(1, 48000 * 4, 48000), out = oc.createGain(); out.connect(oc.destination);
      const pp = Object.assign({}, def.params, { type, thr: 0.6, t: 0.01, rate: 1 });
      const inst = def.build(oc, out, pp);
      oc.suspend(2).then(() => { inst.set(q); oc.resume(); });
      const buf = await oc.startRendering(), d = buf.getChannelData(0);
      return [pitch(d, 48000, 1.2, 1.9), pitch(d, 48000, 3.0, 3.8)];
    }
    const thr = await run('wildcat', { thr: 1.2 }), rate = await run('torp', { rate: 1.5 });
    return { thr, rate, wantThr: (0.6 + 0.4 * 1.2) / (0.6 + 0.4 * 0.6) };
  });
  const rThr = eng.thr[1] / eng.thr[0], rRate = eng.rate[1] / eng.rate[0];
  chk(`engine pitch follows set({thr: 0.6 -> 1.2}): ${eng.thr.map(v => v.toFixed(1)).join(' -> ')} Hz, x${rThr.toFixed(3)} (want x${eng.wantThr.toFixed(3)})`, Math.abs(rThr / eng.wantThr - 1) < 0.08);
  chk(`engine pitch follows set({rate: 1.5}): ${eng.rate.map(v => v.toFixed(1)).join(' -> ')} Hz, x${rRate.toFixed(3)}`, Math.abs(rRate / 1.5 - 1) < 0.08);

  // engine demo renders: a dive with the pull-out, a fly-by with doppler, a damaged sputtering engine
  if (OUT) {
    const demos = await p.evaluate(async () => {
      const def = WW.audio.patches['plane.engine'], res = {};
      async function demo(type, secs, steps, gainAt) {
        const oc = new OfflineAudioContext(2, 48000 * secs, 48000), out = oc.createGain(); out.connect(oc.destination);
        const inst = def.build(oc, out, Object.assign({}, def.params, steps[0][1], { type, t: 0.01, rate: 1 }));
        for (const [t, q] of steps.slice(1)) oc.suspend(t).then(() => { inst.set(q); oc.resume(); });
        if (gainAt) for (const [t, g] of gainAt) out.gain.linearRampToValueAtTime(g, t);
        inst.stop(secs - 0.1);
        const buf = await oc.startRendering();
        return __wav(buf.getChannelData(0), buf.getChannelData(1), 48000);
      }
      const dive = [[0, { thr: 0.9, air: 0.7 }], [1.5, { thr: 0.55, dive: 0.2, air: 0.9 }]];
      for (let i = 1; i <= 12; i++) dive.push([2 + i * 0.25, { thr: 0.6, dive: Math.min(1, 0.35 + i * 0.06), air: 1.1 }]);
      dive.push([5.2, { thr: 1.3, dive: 0.45 }], [6.4, { thr: 1.18, dive: 0 }], [8, { thr: 0.95, air: 0.7 }]);
      res['plane.engine.demo_dive_pullout'] = await demo('dive', 10, dive);
      const fly = [[0, { thr: 1, air: 0.8 }]];
      for (let i = 1; i <= 40; i++) { const t = i * 0.15, x = (t - 3) * 40, d = Math.hypot(x, 8), v = -x / d * 40; fly.push([t, { rate: Math.min(2, 150 / (150 - v)) }]); }
      const g = []; for (let i = 0; i <= 40; i++) { const t = i * 0.15, x = (t - 3) * 40; g.push([t + 0.001, Math.min(1, 16 / Math.hypot(x, 8))]); }
      res['plane.engine.demo_flyby_doppler'] = await demo('wildcat', 6.5, fly, g);
      const sp = [[0, { thr: 0.85 }]]; let t = 0.4; while (t < 6) { sp.push([t, { cough: 0.4 + Math.random() * 0.6 }]); t += 0.2 + Math.random() * 0.6; }
      res['plane.engine.demo_damaged_sputter'] = await demo('zero', 6.5, sp);
      res['plane.engine.demo_takeoff_runup'] = await demo('torp', 9, [[0, { thr: 0.08, air: 0 }], [2, { thr: 0.5 }], [2.6, { thr: 0.8 }], [3.3, { thr: 1.1 }], [5, { thr: 1.18, air: 0.4 }], [5.5, { air: 0.7 }], [6.3, { thr: 1.12, air: 0.8 }]]);
      return res;
    });
    for (const k in demos) save(k, demos[k]);
  }

  // ---- 4. live battle with sound on ----
  await p.evaluate(() => { __sim.game.startRound(); __sim.fastForward(40); });
  await p.keyboard.press('m');
  await p.waitForTimeout(500);
  const live = await p.evaluate(() => ({ live: WW.audio.live, state: WW.audio.ctx && WW.audio.ctx.state }));
  chk('M key enables sound ' + JSON.stringify(live), live.live && live.state === 'running');
  // doppler on a fly-by: a fake plane passes 8 units in front of the camera at 25 units / real s (slow: headless frames are slow)
  const dop = await p.evaluate(async () => {
    WW.audio.register('test.engine', Object.assign({}, WW.audio.patches['plane.engine'])); // same patch, no competition from the battle's engines
    const L = WW.audio.listener, obj = { x: 0, y: 0, z: 0 }, h = WW.audio.loop('test.engine', { at: obj, doppler: true, type: 'wildcat', vol: 3 });
    const t0 = performance.now(), app = [], rec = [];
    await new Promise(res => { const iv = setInterval(() => {
      const t = (performance.now() - t0) / 1000, s = (t - 6) * 25;
      obj.x = L.x + L.fx * 8 + L.rx * s; obj.y = L.y + L.fy * 8 + L.ry * s; obj.z = L.z + L.fz * 8 + L.rz * s;
      if (h.voice && t > 2 && t < 5.4) app.push(h.lr); if (h.voice && t > 6.6 && t < 10) rec.push(h.lr);
      if (t > 10.5) { clearInterval(iv); res(); } }, 20); });
    h.stop(0.1);
    const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    return { app: avg(app), rec: avg(rec), n: app.length + rec.length };
  });
  chk(`engine loop doppler on a fly-by: approaching rate ${dop.app.toFixed(3)} > 1.05, receding ${dop.rec.toFixed(3)} < 0.95 (${dop.n} samples)`, dop.app > 1.05 && dop.rec < 0.95);

  // close fly-by whoosh: a stand-in plane (no AI) passes 5 units from the camera at 30 units / real s
  const wh = await p.evaluate(async () => {
    const L = WW.audio.listener, w0 = WW.audioAir.stats().whoosh;
    const f = { kind: 'fighter', nation: 'USN', state: 'transit', alive: true, removed: false, hp: 28, maxHp: 28, speed: 38, vy: 0, heading: 0,
      pt: WW.planeType('fighter', 'USN'), x: 0, y: 0, z: 0, update() {}, damage() {}, remove() {}, trail() {} };
    WW.world.planes.push(f);
    const t0 = performance.now(); let voiced = false;
    await new Promise(res => { const iv = setInterval(() => {
      const t = (performance.now() - t0) / 1000, s = (t - 4) * 30;
      f.x = L.x + L.fx * 5 + L.rx * s; f.y = L.y + L.fy * 5 + L.ry * s; f.z = L.z + L.fz * 5 + L.rz * s;
      if (WW.audioAir.stats().engineVoices > 0) voiced = true;
      if (t > 6) { clearInterval(iv); res(); } }, 20); });
    f.removed = true; f.alive = false; const i = WW.world.planes.indexOf(f); if (i >= 0) WW.world.planes.splice(i, 1);
    return { whoosh: WW.audioAir.stats().whoosh - w0, voiced };
  });
  chk(`close fly-by plays one whoosh (${wh.whoosh}), engine voiced ${wh.voiced}`, wh.whoosh === 1 && wh.voiced);

  // per-patch counters + samplers
  await p.evaluate(() => {
    const per = window.__per = {}, play = WW.audio.play;
    WW.audio.play = function (name, o) {
      const s0 = WW.audio.stats(), v = play.call(this, name, o), s1 = WW.audio.stats(), c = per[name] || (per[name] = { req: 0, played: 0, culled: 0, throttled: 0, dropped: 0 });
      c.req++; c.played += s1.played - s0.played; c.culled += s1.culled - s0.culled; c.throttled += s1.throttled - s0.throttled; c.dropped += s1.dropped - s0.dropped;
      return v;
    };
    window.__au = { maxVoices: 0, maxEng: 0, maxGun: 0, peak: 0, nan: false, samples: 0, rmsMax: 0 };
    window.__poll = setInterval(() => {
      const m = WW.audio.meter(), s = WW.audio.stats(), a = WW.audioAir.stats();
      __au.samples++; __au.peak = Math.max(__au.peak, m.peak); __au.rmsMax = Math.max(__au.rmsMax, m.rms); __au.nan = __au.nan || m.nan;
      __au.maxVoices = Math.max(__au.maxVoices, s.voices); __au.maxEng = Math.max(__au.maxEng, a.engineVoices); __au.maxGun = Math.max(__au.maxGun, a.gunVoices);
    }, 150);
  });
  // film the air war: chase a fighter in a fight (or any flying plane) every few seconds
  const filmAir = () => p.evaluate(() => {
    const ps = WW.world.planes.filter(q => q.alive && (q.state === 'attack' || q.state === 'transit'));
    const f = ps.find(q => q.kind === 'fighter' && q.foe && q.foe.alive) || ps.find(q => q.phase === 'dive' || q.phase === 'roll') || ps[0];
    if (f && WW.cam.film) WW.cam.film({ kind: 'chase', subj: f, dur: 14 });
    return f ? f.kind + '/' + f.state : 'none';
  });
  const T4 = QUICK ? 15 : 60, T1 = QUICK ? 20 : 90;
  await p.evaluate(() => __sim.setScale(4));
  for (let t = 0; t < T4; t += 6) { await filmAir(); await p.waitForTimeout(6000); }
  await p.evaluate(() => __sim.setScale(1));
  // force each death near the camera
  const forced = await p.evaluate(async () => {
    const out = [];
    for (const m of ['wing', 'comet', 'spin', 'ditch', 'abandon', 'crash', 'slide']) {
      const q = WW.airDeaths.force(m); if (!q) { out.push(m + ':none'); continue; }
      WW.cam.film({ kind: 'chase', subj: q, dur: 8 }); out.push(m);
      await new Promise(r => setTimeout(r, 2500));
    }
    return out;
  });
  console.log('forced deaths', forced.join(' '));
  for (let t = 0; t < T1; t += 8) { await filmAir(); await p.waitForTimeout(8000); }

  // 20 s mixed excerpt from the master: wait for a dogfight or a strike, chase it, record
  const exc = await p.evaluate(async () => {
    let f = null;
    for (let i = 0; i < 120 && !f; i++) {
      f = WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.foe && q.foe.alive && q.df && q.df.mode) ||
          WW.world.planes.find(q => q.alive && (q.phase === 'roll' || q.sk === 'anvil'));
      if (!f) { __sim.fastForward(1); await new Promise(r => setTimeout(r, 50)); }
    }
    if (f) WW.cam.film({ kind: 'chase', subj: f, dur: 22 });
    const a0 = WW.audioAir.stats();
    __rec.L = []; __rec.R = []; __rec.n = 0; __rec.on = true;
    await new Promise(r => setTimeout(r, 20500));
    __rec.on = false;
    const a1 = WW.audioAir.stats(), n = __rec.n, L = new Float32Array(n), R = new Float32Array(n);
    let o = 0; for (let i = 0; i < __rec.L.length; i++) { L.set(__rec.L[i], o); R.set(__rec.R[i], o); o += __rec.L[i].length; }
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    return { what: f ? f.kind + ' ' + (f.foe ? 'dogfight' : 'strike') : 'none', secs: n / WW.audio.ctx.sampleRate, pk, guns: a1.guns - a0.guns,
             wav: n ? __wav(L, R, WW.audio.ctx.sampleRate) : null };
  });
  save('mix_excerpt_20s', exc.wav);
  console.log('excerpt', exc.what, exc.secs.toFixed(1), 's, peak', exc.pk.toFixed(3), 'gun bursts', exc.guns);
  chk(`master excerpt recorded (${exc.secs.toFixed(1)} s, ${exc.what}, peak ${exc.pk.toFixed(3)})`, exc.secs > 15 && exc.pk > 0.005 && exc.pk < 0.891);

  const st = await p.evaluate(() => { clearInterval(__poll); return { au: __au, s: WW.audio.stats(), a: WW.audioAir.stats(), per: __per, cap: WW.audio.C.MAX_VOICES, N: WW.audioAir.ENGINE_N }; });
  console.log('per patch (requests / played / culled / throttled / dropped):');
  for (const k of Object.keys(st.per).sort()) { const c = st.per[k]; console.log('  ' + k.padEnd(18), c.req, c.played, c.culled, c.throttled, c.dropped); }
  console.log('air stats', JSON.stringify(Object.assign({}, st.a, { events: undefined })), 'events', JSON.stringify(st.a.events));
  console.log('engine stats', JSON.stringify(st.s));
  chk(`voices <= ${st.cap} (max ${st.au.maxVoices}, ${st.au.samples} samples)`, st.au.maxVoices <= st.cap);
  chk(`plane engine voices <= ${st.N} (max ${st.au.maxEng}), engines created ${st.a.created}, gun voices max ${st.au.maxGun}`, st.au.maxEng <= st.N && st.au.maxEng >= 2 && st.a.created > 10);
  const airPlayed = Object.keys(st.per).filter(k => /^(plane|bomb|deck|chute)\./.test(k) && st.per[k].played > 0);
  chk(`air one-shots played: ${airPlayed.join(', ')}`, airPlayed.length >= 6);
  chk(`master peak ${st.au.peak.toFixed(3)} (${(20 * Math.log10(st.au.peak || 1e-9)).toFixed(1)} dBFS) < -1 dBFS, not silent (rms max ${st.au.rmsMax.toFixed(4)}), no NaN`, st.au.peak < 0.891 && st.au.rmsMax > 1e-4 && !st.au.nan);
  chk('no engine errors (' + st.s.errors + ')', st.s.errors === 0);
  chk('no console/page errors (' + errs.length + ')', errs.length === 0);
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));

  A.forEach(a => console.log(a));
  console.log(A.every(a => a.startsWith('PASS')) ? 'ALL PASS' : 'SOME FAILED');
  await b.close();
  if (server) server.kill();
})().catch(e => { console.error(e); process.exit(1); });
