// Naval sound family verification (js/audio_naval.js + js/audio_naval_wire.js).
// node tests/audio_naval.js   (starts its own server on PORT, default 8811)
//   env: SECS1 / SECS4 = real seconds of battle at 1x / 4x (default 150 each), DEMO_DIR = where WAVs go
// 1. sound off: a long fast-forwarded battle makes no AudioContext and no AudioNode
// 2. every naval patch rendered offline: peak 0.05..1, sane duration, no NaN, little energy above 6 kHz; saved as WAV
// 3. sound on (trusted key press): minutes of battle at 1x and 4x: voices <= cap, no errors, master peak < -1 dBFS, no NaN;
//    per-patch requests / plays / culls / throttles / drops; a 20 s capture of the master output saved as WAV
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8811);
const SECS1 = +(process.env.SECS1 || 150), SECS4 = +(process.env.SECS4 || 150);
const DEMO = process.env.DEMO_DIR || path.join(__dirname, 'shots', 'audio_naval');
fs.mkdirSync(DEMO, { recursive: true });

const PATCHES = [ // name, params, render seconds, max duration
  ['gun.big', { size: 1, n: 1 }, 6, 5], ['gun.big', { size: 1.2, n: 3 }, 6, 5.5], ['gun.med', { n: 3 }, 4, 3], ['gun.small', {}, 2, 1.5], ['gun.dd', { n: 2 }, 3, 2.6], ['gun.mg', {}, 1.5, 1],
  ['shell.whistle', { size: 1 }, 2.5, 1.8], ['shell.whistle', { size: 0.6 }, 2.5, 1.8],
  ['shell.splash', { size: 1.4 }, 4, 3.5], ['shell.splash', { size: 1 }, 4, 3], ['shell.splash.small', { size: 0.7 }, 1.5, 1], ['shell.splash.small', { size: 0.35 }, 1.5, 1],
  ['shell.land', { size: 1.4 }, 2.5, 2.2],
  ['ship.hit', { size: 0.4 }, 3, 2], ['ship.hit', { size: 1 }, 3, 2.5], ['ship.hit', { size: 2 }, 4, 3.5], ['ship.hit', { size: 1.6, bang: 0 }, 3, 2.5],
  ['ship.ping', {}, 1, 0.5], ['ship.boom', { size: 1 }, 3, 2.5], ['ship.magazine', { size: 1 }, 6, 5.5], ['ship.magazine', { size: 0.4 }, 5, 4],
  ['ship.sink', { size: 1 }, 11, 11], ['ship.settle', {}, 3.5, 3],
  ['torp.launch', { tube: 'ship' }, 2, 1.5], ['torp.launch', { tube: 'pt' }, 2, 1.5], ['torp.launch', { tube: 'sub' }, 2, 1.5],
  ['torp.run', {}, 4, 4], ['torp.hit', {}, 5, 4.5], ['torp.fizz', {}, 2, 1.6],
  ['dc.splash', {}, 1, 0.7], ['dc.blast', {}, 4, 3.5], ['sub.dive', {}, 4.5, 4], ['sub.surface', {}, 5, 4.5],
  ['fire.ship', { n: 1 }, 4, 4], ['fire.ship', { n: 5 }, 4, 4],
  ['ship.engine', { size: 1, throttle: 0.8 }, 5, 5], ['ship.engine', { size: 0.5, throttle: 1 }, 5, 5],
  ['ship.engine.pt', { throttle: 0.3 }, 4, 4], ['ship.engine.pt', { throttle: 1 }, 4, 4]
];

(async () => {
  let server = null;
  if (!process.env.BASE_URL) { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1000)); }
  const URL = (process.env.BASE_URL || `http://localhost:${PORT}/`) + 'index.html?auto';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const A = [], chk = (name, v) => A.push((v ? 'PASS ' : 'FAIL ') + name);
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
    // remember the node that feeds the speakers (the engine's output trim), to record the master mix
    const con = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (d) { if (d instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext) && !window.__masterOut && !this.__tap) window.__masterOut = this; return con.apply(this, arguments); };
  });
  await p.goto(URL);
  await p.waitForTimeout(1500);
  // page helpers: WAV encoding (base64) and the energy share above 6 kHz
  await p.evaluate(() => {
    window.__wav = (chs, sr) => {
      const n = chs[0].length, nc = chs.length, buf = new ArrayBuffer(44 + n * nc * 2), v = new DataView(buf);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, nc, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, n * nc * 2, true);
      let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const s = Math.max(-1, Math.min(1, chs[c][i] || 0)); v.setInt16(o, s * 32767, true); o += 2; }
      const u = new Uint8Array(buf); let str = ''; for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(str);
    };
    window.__hf = async (buffer) => { // energy fraction above 6 kHz (two cascaded 6 kHz high-passes)
      const oc = new OfflineAudioContext(1, buffer.length, buffer.sampleRate), s = oc.createBufferSource(); s.buffer = buffer;
      const h1 = oc.createBiquadFilter(), h2 = oc.createBiquadFilter(); h1.type = h2.type = 'highpass'; h1.frequency.value = h2.frequency.value = 6000;
      s.connect(h1); h1.connect(h2); h2.connect(oc.destination); s.start();
      const r = await oc.startRendering(), a = buffer.getChannelData(0), hp = r.getChannelData(0);
      let e = 0, eh = 0; for (let i = 0; i < a.length; i++) { e += a[i] * a[i]; eh += hp[i] * hp[i]; }
      return e > 0 ? eh / e : 0;
    };
  });

  // ---- 1. sound off: zero cost ----
  const off = await p.evaluate(() => {
    for (let i = 0; i < 40; i++) __sim.fastForward(15);
    return { ac: Object.assign({}, __ac), shells: WW.stats.shellsFired, sunk: WW.stats.shipsSunk, torps: WW.stats.torpedoesFired, dcs: WW.stats.depthCharges, ctx: !!WW.audio.ctx };
  });
  chk(`sound off: 600 sim s (${off.shells} shells, ${off.torps} torpedoes, ${off.dcs} depth charges, ${off.sunk} sunk) -> ${off.ac.contexts} contexts, ${off.ac.nodes} nodes`, off.ac.contexts === 0 && off.ac.nodes === 0 && !off.ctx);

  // ---- 2. offline renders ----
  const renders = [];
  for (const [name, prm, secs, maxDur] of PATCHES) {
    const r = await p.evaluate(async ([name, prm, secs]) => {
      const r = await WW.audio.renderOffline(name, prm, secs);
      if (!r) return null;
      const hf = await __hf(r.buffer);
      let peak = r.peak, nan = r.nan, durMax = r.dur;
      for (let i = 0; i < 3; i++) { const q = await WW.audio.renderOffline(name, prm, secs); peak = Math.max(peak, q.peak); nan = nan || q.nan; durMax = Math.max(durMax, q.dur); } // random layers: check the worst of 4
      return { peak, rms: r.rms, dur: durMax, nan, hf, wav: __wav([r.buffer.getChannelData(0), r.buffer.getChannelData(1)], r.buffer.sampleRate) };
    }, [name, prm, secs]);
    const tag = name + (Object.keys(prm).length ? '_' + Object.entries(prm).map(([k, v]) => k + v).join('_') : '');
    if (!r) { chk('render ' + tag + ': missing', false); continue; }
    fs.writeFileSync(path.join(DEMO, tag + '.wav'), Buffer.from(r.wav, 'base64'));
    const ok = !r.nan && r.peak >= 0.05 && r.peak <= 1 && r.dur > 0.05 && r.dur <= maxDur && r.hf < 0.06;
    renders.push(ok);
    chk(`render ${tag.padEnd(34)} max peak of 4 ${r.peak.toFixed(3)} rms ${r.rms.toFixed(4)} dur ${r.dur.toFixed(2)}s (<= ${maxDur}) >6kHz ${(r.hf * 100).toFixed(2)}%`, ok);
  }
  // variation: two renders of the same patch differ
  const vary = await p.evaluate(async () => { const a = await WW.audio.renderOffline('gun.big', { size: 1 }, 3), b = await WW.audio.renderOffline('gun.big', { size: 1 }, 3);
    const x = a.buffer.getChannelData(0), y = b.buffer.getChannelData(0); let d = 0, e = 0; for (let i = 0; i < x.length; i++) { d += (x[i] - y[i]) ** 2; e += x[i] * x[i]; } return d / e; });
  chk('per-play variation: two gun.big renders differ (relative diff energy ' + vary.toFixed(2) + ')', vary > 0.05);

  // ---- 3. live battle with sound on ----
  // headless swiftshader draws ~1 frame/s, which would run "1x" at a tenth of real speed: draw only every 60th frame
  // so the sim, camera director and audio run at their true 1x / 4x pace (the picture does not matter here)
  await p.evaluate(() => { if (!WW.post) return; const r0 = WW.post.render; let k = 0; WW.post.render = (s, c) => { if (++k % 60 === 0) r0(s, c); }; });
  await p.evaluate(() => __sim.game.startRound());
  await p.keyboard.press('m');
  await p.waitForTimeout(500);
  const live = await p.evaluate(() => WW.audio.live);
  chk('M key enables sound', live);
  await p.evaluate(() => {
    const W = WW.audio, pc = window.__pc = {}, lc = window.__lc = {};
    const P = W.play, L = W.loop;
    W.play = function (n, o) {
      const s0 = W.stats(), r = P(n, o), s1 = W.stats(), c = pc[n] || (pc[n] = { req: 0, played: 0, culled: 0, throttled: 0, dropped: 0 });
      c.req++; if (r) c.played++; c.culled += s1.culled - s0.culled; c.throttled += s1.throttled - s0.throttled; c.dropped += s1.dropped - s0.dropped;
      return r;
    };
    W.loop = function (n, o) { lc[n] = (lc[n] || 0) + 1; return L(n, o); };
    window.__au = { maxVoices: 0, maxLoopVoices: 0, maxNodes: 0, peak: 0, rmsMax: 0, nan: false, samples: 0, upd: 0, frames: 0, naval: { engines: 0, fires: 0, runs: 0 } };
    const u = W.update;
    W.update = function (rdt) { const t = performance.now(); u(rdt); __au.upd += performance.now() - t; __au.frames++; };
    window.__poll = setInterval(() => {
      const m = W.meter(), s = W.stats(), d = WW.audioNaval._debug();
      __au.samples++; __au.peak = Math.max(__au.peak, m.peak); __au.rmsMax = Math.max(__au.rmsMax, m.rms); __au.nan = __au.nan || m.nan;
      __au.maxVoices = Math.max(__au.maxVoices, s.voices); __au.maxLoopVoices = Math.max(__au.maxLoopVoices, s.loopVoices); __au.maxNodes = Math.max(__au.maxNodes, s.liveNodes);
      for (const k in __au.naval) __au.naval[k] = Math.max(__au.naval[k], d[k]);
    }, 200);
    // master recorder (ScriptProcessor on the engine's output node)
    window.__rec = { on: false, L: [], R: [], n: 0 };
    const ctx = W.ctx, sp = ctx.createScriptProcessor(4096, 2, 2); sp.__tap = true;
    sp.onaudioprocess = e => { if (!__rec.on) return; __rec.L.push(new Float32Array(e.inputBuffer.getChannelData(0))); __rec.R.push(new Float32Array(e.inputBuffer.getChannelData(1))); __rec.n += 4096; };
    window.__masterOut.connect(sp); sp.connect(ctx.destination);
  });
  // fast-forward into the fight with sound on (voices checked every sim step), then watch in real time
  const ffv = await p.evaluate(() => { let mx = 0; for (let i = 0; i < 10; i++) __sim.fastForward(5, () => { mx = Math.max(mx, WW.audio.stats().voices); }); return mx; });
  chk('voices <= cap during a sound-on fast-forward (' + ffv + ')', ffv <= 48);
  const simT0 = await p.evaluate(() => WW.time.now);
  const t0 = Date.now();
  // 1x: let the battle develop; record 20 s once there is gunfire near the camera
  await p.evaluate(() => __sim.setScale(1));
  const half = Math.max(20, SECS1 / 2) * 1000;
  await p.waitForTimeout(half - 20000 > 0 ? half - 20000 : 0);
  // look for the busiest 20 s: start recording when a battleship or cruiser is firing near the camera (or just now)
  await p.evaluate(async () => {
    const t = performance.now();
    while (performance.now() - t < 30000) { const c = __pc['gun.big'] || {}, m = WW.audio.meter(); if (m.rms > 0.02) break; await new Promise(r => setTimeout(r, 500)); }
    __rec.on = true;
  });
  await p.waitForTimeout(20500);
  const rec = await p.evaluate(() => {
    __rec.on = false;
    const cat = a => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
    const L = cat(__rec.L), R = cat(__rec.R); let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const ab = new AudioBuffer({ length: L.length, numberOfChannels: 1, sampleRate: WW.audio.ctx.sampleRate }); ab.copyToChannel(L, 0);
    return __hf(ab).then(hf => ({ secs: L.length / WW.audio.ctx.sampleRate, peak: pk, hf, wav: __wav([L, R], WW.audio.ctx.sampleRate) }));
  });
  fs.writeFileSync(path.join(DEMO, 'battle_mix_20s.wav'), Buffer.from(rec.wav, 'base64'));
  chk(`recorded ${rec.secs.toFixed(1)} s of the master mix (peak ${rec.peak.toFixed(3)}, energy above 6 kHz ${(rec.hf * 100).toFixed(2)}%)`, rec.secs > 18 && rec.peak > 0.01 && rec.hf < 0.06);
  await p.waitForTimeout(Math.max(0, SECS1 * 1000 - (Date.now() - t0)));
  const s1 = await p.evaluate(() => JSON.parse(JSON.stringify({ au: __au, pc: __pc, st: WW.audio.stats(), round: WW.stats.round, now: WW.time.now })));
  await p.evaluate(() => __sim.setScale(4));
  await p.waitForTimeout(SECS4 * 1000);
  const st = await p.evaluate(() => JSON.parse(JSON.stringify({ au: __au, pc: __pc, lc: __lc, st: WW.audio.stats(), cap: WW.audio.C.MAX_VOICES, round: WW.stats.round, sunk: WW.stats.shipsSunk, now: WW.time.now })));

  console.log('\nper-patch (1x + 4x):  requested  played  culled  throttled  dropped');
  for (const n of Object.keys(st.pc).sort()) { const c = st.pc[n]; console.log('  ' + n.padEnd(20) + String(c.req).padStart(9) + String(c.played).padStart(8) + String(c.culled).padStart(8) + String(c.throttled).padStart(11) + String(c.dropped).padStart(9)); }
  console.log('loop handles made', JSON.stringify(st.lc));
  console.log(`sim time: 1x phase ${(s1.now - simT0).toFixed(0)} s in ${SECS1} s real, 4x phase ${(st.now - s1.now).toFixed(0)} s in ${SECS4} s real`);
  console.log('1x part:', JSON.stringify({ played: s1.st.played, maxVoices: s1.au.maxVoices, peak: +s1.au.peak.toFixed(3) }), ' total:', JSON.stringify({ rounds: st.round, sunk: st.sunk, naval: st.au.naval, maxLoopVoices: st.au.maxLoopVoices, maxLiveNodes: st.au.maxNodes }));
  console.log('engine stats', JSON.stringify(st.st));
  console.log('audio update cost', (st.au.upd / st.au.frames).toFixed(3), 'ms/frame over', st.au.frames, 'frames');
  const navalPlayed = ['gun.', 'shell.', 'ship.', 'torp.', 'dc.', 'sub.'].filter(f => Object.keys(st.pc).some(n => n.startsWith(f) && st.pc[n].played > 0));
  chk(`naval families heard in battle: ${navalPlayed.join(' ')}`, navalPlayed.length >= 4);
  chk(`voices <= cap: max ${st.au.maxVoices} (cap ${st.cap})`, st.au.maxVoices <= st.cap);
  chk(`master peak 1x ${s1.au.peak.toFixed(3)}, overall ${st.au.peak.toFixed(3)} (${(20 * Math.log10(st.au.peak || 1e-9)).toFixed(1)} dBFS) < -1 dBFS, no NaN (${st.au.samples} samples)`, st.au.peak < 0.891 && !st.au.nan);
  chk(`master not silent (max rms ${st.au.rmsMax.toFixed(4)})`, st.au.rmsMax > 1e-4);
  chk('no engine errors (' + st.st.errors + ')', st.st.errors === 0);
  chk('engines culled to the nearest few (max ' + st.au.naval.engines + ' engine handles)', st.au.naval.engines <= 5);
  const fw = await p.evaluate(() => WW.audioNaval._debug().fireWrecks);
  chk('no fire loops left on settled wrecks (' + fw + ')', fw === 0);
  chk('no console/page errors (' + errs.length + ')', errs.length === 0);
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));
  console.log('\nWAV demos in', DEMO);
  A.forEach(a => console.log(a));
  console.log(A.every(a => a.startsWith('PASS')) ? 'ALL PASS' : 'SOME FAILED');
  await b.close();
  if (server) server.kill();
})().catch(e => { console.error(e); process.exit(1); });
