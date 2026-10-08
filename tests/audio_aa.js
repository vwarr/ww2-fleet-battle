// AA sound family verification (js/audio_aa.js). node tests/audio_aa.js   (own server on PORT, default 8813)
// 1. sound off: a long sim with heavy AA creates no AudioContext and no AudioNode (AA events still fire)
// 2. every aa.* / flak.* patch rendered offline: peak 0.05..1, sane duration, no NaN, not hissy (HF share), varies per play;
//    WAVs saved to OUT (env AA_DEMOS)
// 3. sound on (trusted key press) during air strikes: MINUTES_1X real minutes at 1x, MINUTES_4X at 4x:
//    (half of 1x with the director camera, the rest with the camera on AA ships) voices <= cap, each AA patch <= its max, 0 errors, master peak < -1 dBFS, no NaN; play/cull/throttle counts logged
// 4. a 20 s excerpt of the master output with the camera on the busiest AA ship, saved as a WAV
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8813);
const OUT = process.env.AA_DEMOS || path.join(__dirname, 'shots', 'audio_aa');
const M1 = +(process.env.MINUTES_1X || 2.5), M4 = +(process.env.MINUTES_4X || 2);
fs.mkdirSync(OUT, { recursive: true });

function wav(file, ch, rate, int16b64) { // interleaved 16-bit PCM
  const pcm = Buffer.from(int16b64, 'base64'), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(OUT, file), Buffer.concat([h, pcm]));
}

(async () => {
  let server = null;
  if (!process.env.BASE_URL) { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1000)); }
  const URL = (process.env.BASE_URL || `http://localhost:${PORT}/`) + 'index.html?auto&v=' + Date.now();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const A = [], chk = (name, v) => { A.push((v ? 'PASS ' : 'FAIL ') + name); console.log((v ? 'PASS ' : 'FAIL ') + name); };
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    try { localStorage.removeItem('ww.audio'); } catch (e) {}
    const C = window.__ac = { contexts: 0, nodes: 0 };
    const Orig = window.AudioContext;
    if (Orig) {
      window.AudioContext = function (o) { C.contexts++; return new Orig(o); };
      window.AudioContext.prototype = Orig.prototype;
      const P = (window.BaseAudioContext || Orig).prototype;
      for (const k of Object.getOwnPropertyNames(P)) {
        if (!/^create/.test(k) || k === 'createBuffer' || k === 'createPeriodicWave') continue;
        const f = P[k]; if (typeof f !== 'function') continue;
        P[k] = function () { if (!(this instanceof OfflineAudioContext)) C.nodes++; return f.apply(this, arguments); };
      }
      // remember the node that feeds the speakers (the engine's final trim), to tap the master mix
      const con = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (d) { if (d instanceof AudioDestinationNode && !window.__toDest && !(this.context instanceof OfflineAudioContext)) window.__toDest = this; return con.apply(this, arguments); };
    }
  });
  await p.goto(URL);
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    __sim.setScale(0.1);
    // AA event counters (independent of sound) + a recent-activity window per ship
    window.__ev = { aaHeavyFired: 0, flakBurst: 0, aaLightFired: 0, recent: [] };
    for (const n of ['aaHeavyFired', 'flakBurst', 'aaLightFired']) WW.on(n, e => { __ev[n]++; __ev.recent.push([WW.time.now, n, e.ship]); if (__ev.recent.length > 400) __ev.recent.splice(0, 100); });
    window.aaRate = (secs) => { const t = WW.time.now; return __ev.recent.filter(r => t - r[0] < secs && r[1] !== 'aaLightFired').length; };
    // test camera: window.__look = { x, y, z, d, h } overrides the director
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) {
      const L = window.__look; if (!L) return camUpd(rdt);
      WW.camera.position.set(L.x + L.d * 0.8, L.y + L.h, L.z + L.d * 0.6); WW.camera.lookAt(L.x, L.y + L.h * 0.5, L.z); WW.camera.updateMatrixWorld();
    };
    window.busiest = (nation, light) => { const t = WW.time.now, n = new Map(); for (const r of __ev.recent) if (t - r[0] < 8 && r[2] && r[2].alive && (!nation || r[2].nation === nation)) n.set(r[2], (n.get(r[2]) || 0) + (r[1] === 'aaLightFired' ? (light ? 1 : 0.3) : (light ? 0 : 1)));
      let best = null, bn = 0; for (const [s, k] of n) if (k > bn) { bn = k; best = s; } return best; };
    window.strike = (max) => { for (let i = 0; i < max * 2; i++) { if (aaRate(6) >= 12 && WW.world.planes.filter(q => q.alive && q.y > 12).length >= 4) return true; __sim.fastForward(0.5); } return false; };
  });

  // ---- 1. sound off ----
  const off = await p.evaluate(() => { for (let i = 0; i < 30; i++) __sim.fastForward(10); return { ac: Object.assign({}, __ac), ev: Object.assign({}, __ev, { recent: 0 }), ctx: !!WW.audio.ctx }; });
  chk(`sound off: 300 sim s with ${off.ev.aaHeavyFired} heavy salvos, ${off.ev.flakBurst} bursts, ${off.ev.aaLightFired} light streams -> ${off.ac.contexts} contexts, ${off.ac.nodes} nodes`,
    off.ac.contexts === 0 && off.ac.nodes === 0 && !off.ctx && off.ev.flakBurst > 0 && off.ev.aaLightFired > 0);

  // ---- 2. offline renders ----
  const SPEC = [
    ['aa.heavy', {}, 3, [0.4, 2.6]], ['aa.heavy', { ijn: true }, 3, [0.4, 2.6]], ['flak.burst', {}, 3, [0.6, 2.6]], ['flak.frags', {}, 3, [0.4, 2.6]],
    ['aa.bofors', {}, 3, [0.6, 2.6]], ['aa.oerlikon', {}, 3, [0.6, 2.6]], ['aa.25mm', {}, 3, [0.5, 2.6]], ['aa.tracer', {}, 1.5, [0.05, 0.7]], ['aa.barrage', {}, 6, [5, 6]]
  ];
  const offl = await p.evaluate(async (SPEC) => {
    const enc = (buf, ch) => { // interleaved int16 -> base64
      const n = buf.length, d = [...Array(ch)].map((_, c) => buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
      const a = new Int16Array(n * ch); for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) a[i * ch + c] = Math.max(-1, Math.min(1, d[c][i])) * 32767;
      let s = ''; const u = new Uint8Array(a.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s);
    };
    const band = async (buf, type, f) => { // rms after a filter (2 poles twice = steep enough for a balance check)
      const oc = new OfflineAudioContext(1, buf.length, buf.sampleRate), s = oc.createBufferSource(); s.buffer = buf;
      const f1 = oc.createBiquadFilter(), f2 = oc.createBiquadFilter(); f1.type = f2.type = type; f1.frequency.value = f2.frequency.value = f;
      s.connect(f1); f1.connect(f2); f2.connect(oc.destination); s.start();
      const r = await oc.startRendering(), d = r.getChannelData(0); let q = 0; for (let i = 0; i < d.length; i++) q += d[i] * d[i]; return Math.sqrt(q / d.length);
    };
    const out = [];
    for (const [n, prm, secs] of SPEC) {
      const runs = [];
      for (let k = 0; k < 3; k++) runs.push(await WW.audio.renderOffline(n, prm, secs));
      const r = runs[0], hf = await band(r.buffer, 'highpass', 5000), lf = await band(r.buffer, 'lowpass', 300);
      out.push({ name: n + (prm.ijn ? '.ijn' : ''), peak: r.peak, rms: r.rms, dur: r.dur, nan: runs.some(x => x.nan), hf: hf / (r.rms || 1e-9), lf: lf / (r.rms || 1e-9),
        varies: Math.abs(runs[1].rms - runs[0].rms) / r.rms > 0.01 || Math.abs(runs[2].rms - runs[0].rms) / r.rms > 0.01,
        wav: enc(r.buffer, 2), wav2: enc(runs[1].buffer, 2), rate: r.buffer.sampleRate });
    }
    return out;
  }, SPEC);
  offl.forEach((r, i) => {
    const [lo, hi] = SPEC[i][3];
    wav(r.name + '.wav', 2, r.rate, r.wav); wav(r.name + '.take2.wav', 2, r.rate, r.wav2);
    const info = `peak ${r.peak.toFixed(3)} rms ${r.rms.toFixed(4)} dur ${r.dur.toFixed(2)} s, HF>5k ${(r.hf * 100).toFixed(1)}% LF<300 ${(r.lf * 100).toFixed(0)}% of rms, varies ${r.varies}`;
    chk(`offline ${r.name}: ${info}`, !r.nan && r.peak >= 0.05 && r.peak <= 1 && r.dur >= lo && r.dur <= hi && r.hf < (r.name === 'aa.tracer' ? 0.4 : 0.25) && (r.varies || r.name === 'aa.barrage'));
  });

  // ---- 3. sound on during air strikes ----
  const st0 = await p.evaluate(() => strike(400));
  chk('an air strike is under way (heavy AA firing)', st0);
  await p.keyboard.press('m');
  await p.waitForTimeout(400);
  const on = await p.evaluate(() => ({ live: WW.audio.live, state: WW.audio.ctx && WW.audio.ctx.state, nodes: __ac.nodes }));
  chk('M key enables sound ' + JSON.stringify(on), on.live && on.state === 'running');
  await p.evaluate(() => {
    const AA = ['aa.heavy', 'flak.burst', 'flak.frags', 'aa.bofors', 'aa.oerlikon', 'aa.25mm', 'aa.tracer', 'aa.barrage'];
    window.__au = { maxVoices: 0, peak: 0, rmsMax: 0, nan: false, samples: 0, perMax: {}, plays: {}, bedMax: 0, quietWindows: 0 };
    const mine = [], pl = WW.audio.play;
    WW.audio.play = function (n, o) { const v = pl(n, o); if (v && AA.includes(n)) { mine.push(v); __au.plays[n] = (__au.plays[n] || 0) + 1; } return v; };
    window.__poll = setInterval(() => {
      const m = WW.audio.meter(), s = WW.audio.stats(), now = WW.audio.ctx.currentTime, per = {};
      for (let i = mine.length - 1; i >= 0; i--) { const v = mine[i]; if (v.end < now) { mine.splice(i, 1); continue; } if (v.end > now + 0.16) per[v.name] = (per[v.name] || 0) + 1; }
      for (const k in per) __au.perMax[k] = Math.max(__au.perMax[k] || 0, per[k]);
      __au.samples++; __au.peak = Math.max(__au.peak, m.peak); __au.rmsMax = Math.max(__au.rmsMax, m.rms); __au.nan = __au.nan || m.nan;
      __au.maxVoices = Math.max(__au.maxVoices, s.voices); __au.bedMax = Math.max(__au.bedMax, WW.audioAA.act);
    }, 200);
  });
  // keep the battle in a strike: when AA goes quiet for a while, skip ahead to the next one
  // director camera for the first half of the 1x run; then (and at 4x) the camera cycles over the busiest heavy / light AA ships of both sides
  async function watch(scale, minutes, follow) {
    await p.evaluate(s => __sim.setScale(s), scale);
    const end = Date.now() + minutes * 60000; let skips = 0, nat = 0;
    let last = await p.evaluate(() => __ev.aaHeavyFired + __ev.flakBurst);
    while (Date.now() < end) {
      const m = nat++ % 4; // USN heavy, IJN light, USN light, IJN heavy
      if (follow) await p.evaluate(([n, l]) => { const s = busiest(n, l) || busiest(); window.__look = s ? { x: s.x, y: 2, z: s.z, d: l ? 30 : 45, h: l ? 10 : 16 } : null; }, [m % 2 ? 'IJN' : 'USN', m === 1 || m === 2]);
      await p.waitForTimeout(10000);
      const now = await p.evaluate(() => __ev.aaHeavyFired + __ev.flakBurst);
      if (now - last < 4) { skips++; await p.evaluate(() => { __sim.setScale(0.1); strike(300); }); await p.evaluate(s => __sim.setScale(s), scale); }
      last = await p.evaluate(() => __ev.aaHeavyFired + __ev.flakBurst);
    }
    await p.evaluate(() => { window.__look = null; });
    return skips;
  }
  const c0 = await p.evaluate(() => Object.assign({}, WW.audio.stats(), { aa: Object.assign({}, WW.audioAA) }));
  const sk1 = await watch(1, M1 / 2);
  const c1d = await p.evaluate(() => Object.assign({}, WW.audio.stats(), { aa: Object.assign({}, WW.audioAA) }));
  const sk1f = await watch(1, M1 / 2, true);
  const c1 = await p.evaluate(() => Object.assign({}, WW.audio.stats(), { aa: Object.assign({}, WW.audioAA) }));
  const sk4 = await watch(4, M4, true);
  const c2 = await p.evaluate(() => Object.assign({}, WW.audio.stats(), { aa: Object.assign({}, WW.audioAA) }));
  const dl = (a, b) => { const o = {}; for (const k of ['played', 'culled', 'throttled', 'stolen', 'dropped', 'errors']) o[k] = b[k] - a[k]; for (const k of ['heavy', 'burst', 'light', 'tracer', 'frags', 'bedOnly']) o['aa.' + k] = b.aa[k] - a.aa[k]; return o; };
  console.log(`1x ${M1 / 2} min, director camera (${sk1} skips to next strike):`, JSON.stringify(dl(c0, c1d)));
  console.log(`1x ${M1 / 2} min, camera on AA ships (${sk1f} skips):`, JSON.stringify(dl(c1d, c1)));
  console.log(`4x ${M4} min (${sk4} skips):`, JSON.stringify(dl(c1, c2)));

  // ---- 3b. tracer close pass: a light-AA stream aimed past the camera gets a whiz, one aimed elsewhere does not ----
  const tr = await p.evaluate(async () => {
    const L = WW.audio.listener, c0 = WW.audioAA.tracer;
    const ship = { x: L.x + 60, z: L.z + 40, nation: 'USN', type: 'destroyer', alive: true };
    const past = { x: L.x - (ship.x - L.x) * 0.3, y: 2.5 + (L.y - 2.5) * 1.3 + 1, z: L.z - (ship.z - L.z) * 0.3, alive: true };   // just past the camera
    WW.emit('aaLightFired', { ship, target: past, hit: false });
    const c1 = WW.audioAA.tracer;
    WW.emit('aaLightFired', { ship, target: { x: ship.x + 30, y: 20, z: ship.z - 30 }, hit: false });           // away from it
    return [c1 - c0, WW.audioAA.tracer - c1];
  });
  chk(`tracer whiz: stream past the camera -> ${tr[0]}, stream elsewhere -> ${tr[1]}`, tr[0] === 1 && tr[1] === 0);

  // ---- 4. 20 s master excerpt, camera on the busiest AA ship ----
  await p.evaluate(() => { __sim.setScale(0.1); strike(300); __sim.setScale(1); });
  const cap = await p.evaluate(async () => {
    const pick = () => busiest();
    const ctx = WW.audio.ctx, src = window.__toDest, sp = ctx.createScriptProcessor(4096, 2, 2), z = ctx.createGain(); z.gain.value = 0;
    const L = [], R = [], want = ctx.sampleRate * 20; let got = 0;
    sp.onaudioprocess = e => { if (got >= want) return; L.push(new Float32Array(e.inputBuffer.getChannelData(0))); R.push(new Float32Array(e.inputBuffer.getChannelData(1))); got += 4096; };
    src.connect(sp); sp.connect(z); z.connect(ctx.destination);
    const t0 = performance.now();
    while (got < want && performance.now() - t0 < 40000) {
      const s = pick(); if (s) window.__look = { x: s.x, y: 2, z: s.z, d: 45, h: 16 };
      await new Promise(r => setTimeout(r, 1000));
    }
    src.disconnect(sp); window.__look = null;
    const n = Math.min(want, got), a = new Int16Array(n * 2); let pk = 0, k = 0;
    for (let b = 0; b < L.length && k < n; b++) for (let i = 0; i < L[b].length && k < n; i++, k++) { const l = L[b][i], r = R[b][i]; pk = Math.max(pk, Math.abs(l), Math.abs(r)); a[k * 2] = l * 32767; a[k * 2 + 1] = r * 32767; }
    let s = ''; const u = new Uint8Array(a.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return { b64: btoa(s), rate: ctx.sampleRate, secs: n / ctx.sampleRate, peak: pk };
  });
  wav('mix_strike_20s.wav', 2, cap.rate, cap.b64);
  chk(`20 s master excerpt captured: ${cap.secs.toFixed(1)} s, peak ${cap.peak.toFixed(3)} (${(20 * Math.log10(cap.peak || 1e-9)).toFixed(1)} dBFS)`, cap.secs > 19 && cap.peak > 0.01 && cap.peak < 0.891);

  const st = await p.evaluate(() => { clearInterval(__poll); return Object.assign({ au: __au, cap: WW.audio.C.MAX_VOICES, max: Object.fromEntries(Object.keys(WW.audio.patches).map(k => [k, WW.audio.patches[k].max])) }, WW.audio.stats()); });
  console.log('totals', JSON.stringify({ played: st.played, culled: st.culled, throttled: st.throttled, stolen: st.stolen, dropped: st.dropped, plays: st.au.plays, perMax: st.au.perMax, bedActMax: +st.au.bedMax.toFixed(1) }));
  chk(`voices <= cap (max ${st.au.maxVoices} / ${st.cap})`, st.au.maxVoices <= st.cap);
  const over = Object.keys(st.au.perMax).filter(k => st.au.perMax[k] > st.max[k]);
  chk('each AA patch within its cap ' + JSON.stringify(st.au.perMax), over.length === 0);
  chk('all AA families played ' + JSON.stringify(st.au.plays), ['aa.heavy', 'flak.burst', 'aa.bofors', 'aa.oerlikon', 'aa.25mm'].every(k => st.au.plays[k] > 0));
  chk(`distant barrage bed was driven (max activity ${st.au.bedMax.toFixed(1)})`, st.au.bedMax > 1);
  chk(`master peak ${st.au.peak.toFixed(3)} (${(20 * Math.log10(st.au.peak || 1e-9)).toFixed(1)} dBFS) < -1 dBFS, no NaN (${st.au.samples} samples), not silent (rms ${st.au.rmsMax.toFixed(4)})`, st.au.peak < 0.891 && !st.au.nan && st.au.rmsMax > 1e-4);
  chk('no engine errors (' + st.errors + ')', st.errors === 0);
  chk('no console/page errors (' + errs.length + ')', errs.length === 0);
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));
  console.log('WAVs in', OUT);
  console.log(A.every(a => a.startsWith('PASS')) ? 'ALL PASS' : 'SOME FAILED');
  await b.close();
  if (server) server.kill();
})().catch(e => { console.error(e); process.exit(1); });
