// Ambience / UI / cinematic sound verification (js/audio_amb.js).   node tests/audio_amb.js
// Starts its own server on PORT (default 8814). WAV renders and live captures go to AMB_OUT (default tests/shots/amb).
// 1. sound off: 600 sim s + UI events create no AudioContext and no AudioNode
// 2. every amb./cine./ui. patch rendered offline: peak 0.05-1.0, duration, no NaN, no clicks (loops cross their
//    buffer seams), spectral balance (centroid, share above 4 kHz)
// 3. sound on (trusted key press) through setup -> round start -> battle -> slow motion -> victory -> next round:
//    voices <= cap, 0 errors, master peak < -1 dBFS, no NaN, play counts; ambience loops persist over round changes
//    and come back after tab hide/show
// 4. master captures: 60 s quiet wide shot (setup, calm), 30 s low over an island, 20 s battle
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8814);
const OUT = process.env.AMB_OUT || path.join(__dirname, 'shots', 'amb');
fs.mkdirSync(OUT, { recursive: true });

// ---------- analysis (node side) ----------
function decode(b64) { const b = Buffer.from(b64, 'base64'); return new Int16Array(b.buffer, b.byteOffset, b.length / 2); }
function wav(file, i16, ch, rate) {
  const h = Buffer.alloc(44), n = i16.length * 2;
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(i16.buffer, i16.byteOffset, n)]));
}
function mono(i16, scale) { const n = i16.length >> 1, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (i16[2 * i] + i16[2 * i + 1]) / 65534 * scale; return m; }
function fft(re, im) { // in place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], xr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, xi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + xr; im[i + k] = ui + xi; re[i + k + len / 2] = ur - xr; im[i + k + len / 2] = ui - xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function spectrum(x, rate, from, to) { // centroid (Hz) and share of power above 4 kHz
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2);
  for (let s = Math.floor(from * rate); s + N <= Math.min(x.length, to * rate); s += N) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  let tot = 0, c = 0, hi = 0;
  for (let k = 1; k < N / 2; k++) { const f = k * rate / N; tot += P[k]; c += P[k] * f; if (f > 4000) hi += P[k]; }
  return { centroid: tot ? c / tot : 0, hf: tot ? hi / tot : 0 };
}
// clicks: (a) one-sample spikes in the first difference vs its local rms; (b) 20 ms rms jumping > 4x between windows
function clicks(x, rate, from, to) {
  const i0 = Math.max(1, Math.floor(from * rate)), i1 = Math.min(x.length, Math.floor(to * rate)), W = 1024;
  let spike = 0, jump = 1, pk = 0;
  for (let s = i0; s + W <= i1; s += W) {
    let e = 0; for (let i = s; i < s + W; i++) { const d = x[i] - x[i - 1]; e += d * d; }
    const r = Math.sqrt(e / W) + 2e-4;
    for (let i = s; i < s + W; i++) { const k = Math.abs(x[i] - x[i - 1]) / r; if (k > spike) spike = k; }
  }
  const w = Math.floor(rate * 0.02); let prev = -1;
  for (let s = i0; s + w <= i1; s += w) {
    let e = 0; for (let i = s; i < s + w; i++) { e += x[i] * x[i]; pk = Math.max(pk, Math.abs(x[i])); }
    const r = Math.sqrt(e / w);
    if (prev >= 0 && Math.max(r, prev) > 0.01) jump = Math.max(jump, (Math.max(r, prev) + 1e-3) / (Math.min(r, prev) + 1e-3));
    prev = r;
  }
  return { spike, jump };
}

(async () => {
  let server = null;
  if (!process.env.BASE_URL) { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1000)); }
  const URL = (process.env.BASE_URL || `http://localhost:${PORT}/`) + 'index.html?auto';
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const A = [], chk = (name, v) => { A.push((v ? 'PASS ' : 'FAIL ') + name); };
  const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    try { localStorage.removeItem('ww.audio'); } catch (e) {}
    const C = window.__ac = { contexts: 0, nodes: 0 };
    const Orig = window.AudioContext; if (!Orig) return;
    window.AudioContext = function (o) { C.contexts++; return new Orig(o); };
    window.AudioContext.prototype = Orig.prototype;
    const P = (window.BaseAudioContext || Orig).prototype;
    for (const k of Object.getOwnPropertyNames(P)) {
      if (!/^create/.test(k) || k === 'createBuffer' || k === 'createPeriodicWave') continue;
      const f = P[k]; if (typeof f !== 'function') continue;
      P[k] = function () { if (this instanceof Orig) C.nodes++; return f.apply(this, arguments); };
    }
    // master capture tap: whatever connects to the live destination is also recorded (test only)
    const REC = window.__rec = { on: false, L: [], R: [], n: 0, tapped: false };
    const conn = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dst) {
      const r = conn.apply(this, arguments);
      if (dst instanceof AudioDestinationNode && !REC.tapped && this.context instanceof Orig) {
        REC.tapped = true;
        const sp = this.context.createScriptProcessor(4096, 2, 2);
        sp.onaudioprocess = ev => { if (!REC.on) return; const b = ev.inputBuffer; REC.L.push(new Float32Array(b.getChannelData(0))); REC.R.push(new Float32Array(b.getChannelData(1))); REC.n += b.length; };
        conn.call(this, sp); conn.call(sp, dst);
      }
      return r;
    };
    window.__i16 = (L, R) => { // interleave to 16-bit and base64
      const n = L.length, out = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) { out[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; out[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
      const u8 = new Uint8Array(out.buffer); let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
  });
  await p.goto(URL);
  await p.waitForTimeout(1500);

  // ---------- 1. sound off ----------
  const off = await p.evaluate(() => {
    for (let i = 0; i < 40; i++) __sim.fastForward(15);
    ['uiPlace', 'uiRemove', 'uiError', 'uiToggle', 'uiVolume'].forEach(e => WW.emit(e, {}));
    WW.time.warp = 0.4; WW.audio.update(0.016); WW.time.warp = 1;
    return { ac: Object.assign({}, __ac), ctx: !!WW.audio.ctx, nodes: WW.audio.stats().nodes, round: WW.stats.round, shells: WW.stats.shellsFired };
  });
  chk(`sound off: 600 sim s (round ${off.round}, ${off.shells} shells) + UI events -> ${off.ac.contexts} contexts, ${off.ac.nodes} nodes`, off.ac.contexts === 0 && off.ac.nodes === 0 && !off.ctx && off.nodes === 0);

  // ---------- 2. offline renders ----------
  // [name, params, seconds, loop?, durMin, durMax, maxCentroid, maxHf]
  const R = [
    ['amb.sea', { height: 6, wind: 0.6 }, 14, true, 0, 0, 1600, 0.12, 'amb.sea_low'],
    ['amb.sea', { height: 200, wind: 0.6 }, 14, true, 0, 0, 1600, 0.12, 'amb.sea_high'],
    ['amb.wind', { height: 30, wind: 0.6 }, 14, true, 0, 0, 1400, 0.08, 'amb.wind_low'],
    ['amb.wind', { height: 200, wind: 0.9 }, 14, true, 0, 0, 1800, 0.12, 'amb.wind_high'],
    ['amb.surf', { size: 1 }, 26, true, 0, 0, 1800, 0.15],
    ['amb.rumble', {}, 16, true, 0, 0, 400, 0.01],
    ['amb.thud', {}, 5, false, 1, 4, 400, 0.02],
    ['amb.gull', { n: 3 }, 3, false, 0.6, 2.5, 3200, 0.2],
    ['cine.slow', {}, 4, false, 1, 3.6, 500, 0.03], // ~3.25 s incl. its reverb tail
    ['cine.whoosh', {}, 2.5, false, 0.6, 1.6, 1800, 0.12],
    ['cine.bell', { strikes: 2 }, 9, false, 2.5, 8.5, 2200, 0.12],
    ['cine.bell', { strikes: 3, gap: 1.1 }, 10, false, 3, 9.5, 2200, 0.12, 'cine.bell_3'],
    ['cine.horn', {}, 10, false, 4, 9.5, 900, 0.03],
    ['ui.click', {}, 0.5, false, 0.01, 0.2, 2500, 0.25],
    ['ui.toggle', { on: true }, 0.5, false, 0.05, 0.25, 2500, 0.25],
    ['ui.tick', { v: 0.7 }, 0.4, false, 0.01, 0.1, 2500, 0.2],
    ['ui.place', {}, 1, false, 0.1, 0.6, 2200, 0.25],
    ['ui.remove', {}, 0.6, false, 0.05, 0.35, 800, 0.08],
    ['ui.error', {}, 0.8, false, 0.15, 0.5, 900, 0.05]
  ];
  const offl = {};
  for (const [name, prm, secs, loop, d0, d1, cmax, hmax, label] of R) {
    const r = await p.evaluate(async ([n, q, s]) => {
      const r = await WW.audio.renderOffline(n, q, s); if (!r) return null;
      const b = r.buffer, L = b.getChannelData(0), Rr = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
      let pk = 0, ab = 0; for (let i = 0; i < L.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(Rr[i])); if (v > pk) pk = v; if (v !== v) ab = 1; }
      const sc = pk > 0.98 ? 0.98 / pk : 1, Ls = new Float32Array(L.length), Rs = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) { Ls[i] = L[i] * sc; Rs[i] = Rr[i] * sc; }
      return { peak: pk, rms: r.rms, dur: r.dur, nan: r.nan || !!ab, rate: b.sampleRate, scale: sc, b64: __i16(Ls, Rs) };
    }, [name, prm, secs]);
    const key = label || name;
    if (!r) { chk(key + ': renders', false); continue; }
    const i16 = decode(r.b64); wav(path.join(OUT, key + '.wav'), i16, 2, r.rate);
    const x = mono(i16, 1 / r.scale);
    const sp = spectrum(x, r.rate, loop ? 2 : 0, loop ? secs - 0.5 : secs);
    const ck = loop ? clicks(x, r.rate, 2, secs - 0.5) : clicks(x, r.rate, 0, secs);
    const head = Math.abs(x[0]) + Math.abs(x[1]);
    offl[key] = { peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), dur: +r.dur.toFixed(2), centroid: Math.round(sp.centroid), hf: +sp.hf.toFixed(3), spike: +ck.spike.toFixed(1), jump: +ck.jump.toFixed(2) };
    const o = offl[key];
    const durOk = loop ? r.dur > secs - 0.6 : r.dur >= d0 && r.dur <= d1;
    // a loop: no one-sample spikes and no sudden level steps over 12+ s (crosses the 3 s noise seams and control seams)
    const clean = loop ? ck.spike < 14 && ck.jump < 4 : ck.spike < 40 && head < 0.02;
    chk(`${key}: peak ${o.peak} rms ${o.rms} dur ${o.dur}s centroid ${o.centroid} Hz hf ${o.hf} spike ${o.spike} jump ${o.jump}`,
      !r.nan && r.peak >= 0.05 && r.peak <= 1 && durOk && clean && sp.centroid <= cmax && sp.hf <= hmax);
  }
  console.log('offline', JSON.stringify(offl));

  // ---------- 3. live: setup -> round -> battle -> slow motion -> victory -> next round ----------
  await p.evaluate(() => { WW.game.mode = 'setup'; WW.game.composition = WW.game.randomComposition(); WW.game.enterSetup(false); });
  await p.waitForTimeout(500);
  await p.keyboard.press('m'); // trusted gesture: sound on (also a toggle tick)
  await p.waitForTimeout(600);
  const on = await p.evaluate(() => ({ live: WW.audio.live, state: WW.audio.ctx && WW.audio.ctx.state }));
  chk('M enables sound ' + JSON.stringify(on), on.live);
  await p.evaluate(() => {
    window.__au = { maxVoices: 0, peak: 0, nan: false, samples: 0, loopMin: 99, phase: '', phasePeak: {} };
    window.__poll = setInterval(() => {
      const m = WW.audio.meter(), s = WW.audio.stats();
      __au.samples++; __au.peak = Math.max(__au.peak, m.peak); __au.nan = __au.nan || m.nan;
      __au.maxVoices = Math.max(__au.maxVoices, s.voices);
      __au.phasePeak[__au.phase] = Math.max(__au.phasePeak[__au.phase] || 0, m.peak);
    }, 200);
  });
  const phase = n => p.evaluate(n => { __au.phase = n; }, n);
  // setup clicks: real mouse clicks on the map (place or "too shallow"), right-click removes, panel buttons, slider
  await phase('setup');
  await p.keyboard.press('h'); await p.waitForTimeout(200);
  const pts = await p.evaluate(() => { // screen points of open water and of land
    const out = { water: [], land: [] }, v = new THREE.Vector3(), cam = WW.camera, W = innerWidth, H = innerHeight;
    for (let i = 0; i < 4000 && (out.water.length < 4 || out.land.length < 2); i++) {
      const x = Math.random() * 480, z = Math.random() * 300, d = WW.terrain.depthAt(x, z);
      v.set(x, 0, z).project(cam); const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
      if (sx < 300 || sx > W - 20 || sy < 120 || sy > H - 20 || v.z > 1) continue; // keep clear of the panels
      if (d > 14 && out.water.length < 4) out.water.push([sx, sy]); else if (d < -0.5 && out.land.length < 2) out.land.push([sx, sy]);
    }
    return out;
  });
  for (const [x, y] of pts.water) { await p.mouse.click(x, y); await p.waitForTimeout(250); }
  for (const [x, y] of pts.land) { await p.mouse.click(x, y); await p.waitForTimeout(350); }
  if (pts.water[0]) { await p.mouse.click(pts.water[0][0], pts.water[0][1], { button: 'right' }); await p.waitForTimeout(250); }
  await p.keyboard.press('t'); await p.waitForTimeout(150); await p.keyboard.press('t'); await p.waitForTimeout(150);
  await p.evaluate(async () => { const s = document.querySelector('#hud input.vol'); for (let v = 70; v >= 50; v -= 2) { s.value = v; s.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 16)); } s.value = 70; s.dispatchEvent(new Event('input')); });
  const btns = await p.$$('#hud .panel button');
  for (const bt of btns.slice(0, 2)) { if (await bt.isVisible()) { const t = await bt.textContent(); if (!/Sound|Hide|round|Set up|Back|Start|Clear|Random/i.test(t)) { await bt.click(); await p.waitForTimeout(120); } } }
  // the calm, quiet wide shot (setup): 60 s master capture
  await p.evaluate(() => { __sim.focus(240, 150, 470, 120); });
  await p.waitForTimeout(1500);
  const capture = async (secs, file) => {
    await p.evaluate(() => { __rec.L = []; __rec.R = []; __rec.n = 0; __rec.on = true; });
    await p.waitForTimeout(secs * 1000 + 300);
    const r = await p.evaluate(() => {
      __rec.on = false; const n = __rec.n, L = new Float32Array(n), R = new Float32Array(n); let o = 0;
      for (let i = 0; i < __rec.L.length; i++) { L.set(__rec.L[i], o); R.set(__rec.R[i], o); o += __rec.L[i].length; }
      let pk = 0, s = 0; for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); pk = Math.max(pk, a); s += L[i] * L[i]; }
      return { n, rate: WW.audio.ctx.sampleRate, peak: pk, rms: Math.sqrt(s / Math.max(1, n)), b64: __i16(L, R) };
    });
    if (r.n) wav(path.join(OUT, file), decode(r.b64), 2, r.rate);
    return { secs: +(r.n / r.rate).toFixed(1), peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), dbfs: +(20 * Math.log10(r.peak || 1e-9)).toFixed(1) };
  };
  const capWide = await capture(60, 'capture_quiet_wide_60s.wav');
  const st0 = await p.evaluate(() => ({ cam: WW.camera.position.y, a: WW.ambState.calm, s: WW.audio.stats() }));
  chk(`quiet wide capture ${JSON.stringify(capWide)} (cam y ${st0.cam.toFixed(0)}, calm ${st0.a.toFixed(2)}): audible, gentle`, capWide.secs > 55 && capWide.rms > 0.003 && capWide.peak < 0.6);
  // round start (Start battle): the bell; ambience loops persist
  await phase('roundStart');
  const pre = await p.evaluate(() => ({ lv: WW.audio.stats().loopVoices, loops: WW.audio.stats().loops }));
  await p.evaluate(() => { WW.game.mode = 'auto'; WW.game.composition = null; WW.game.startRound(); });
  await p.waitForTimeout(1500);
  const post = await p.evaluate(() => ({ lv: WW.audio.stats().loopVoices, loops: WW.audio.stats().loops }));
  chk(`ambience loops persist over roundStart (loop voices ${pre.lv} -> ${post.lv}, handles ${pre.loops} -> ${post.loops})`, post.lv >= 2);
  // low over an island: surf + maybe gulls
  const isl = await p.evaluate(() => {
    const st = WW.ambState, L = st.land[0] || { x: 240, z: 150 }; st.gullT = 2;
    __sim.setScale(0.1); WW.cam.focus(L.x, L.z, 70, 40); return { land: st.land.length, surf: st.surf.length };
  });
  await p.waitForTimeout(2500);
  const capIsl = await capture(30, 'capture_low_island_30s.wav');
  const isl2 = await p.evaluate(() => (__sim.setScale(1), { y: WW.camera.position.y, surfVoices: WW.audio.stats().loopVoices, counts: Object.assign({}, WW.ambState.counts) }));
  chk(`low island capture ${JSON.stringify(capIsl)}: ${isl.surf} surf sites, ${isl.land} land points, loop voices ${isl2.surfVoices} (cam y ${isl2.y.toFixed(0)})`, capIsl.secs > 25 && isl.surf > 0 && isl2.surfVoices >= 3 && capIsl.peak < 0.8);

  // battle
  await phase('battle');
  await p.evaluate(() => { const s0 = WW.stats.shellsFired; let n = 0; while (WW.stats.shellsFired - s0 < 60 && n++ < 40) __sim.fastForward(5); __sim.snapCamera(); });
  const capBattle = await capture(20, 'capture_battle_20s.wav');
  await p.evaluate(() => __sim.setScale(4)); await p.waitForTimeout(8000); await p.evaluate(() => __sim.setScale(1));
  const bt = await p.evaluate(() => ({ inten: WW.ambState.inten, heat: WW.ambState.heat, planes: WW.ambState.planes, shells: WW.stats.shellsFired }));
  chk(`battle capture ${JSON.stringify(capBattle)}; intensity ${bt.inten.toFixed(2)} (heat ${bt.heat.toFixed(1)}, planes ${bt.planes}, ${bt.shells} shells)`, capBattle.secs > 18 && capBattle.peak < 0.891 && bt.inten > 0.1);
  // wide shot of the busy battle: the rumble bed
  await p.evaluate(() => __sim.focus(240, 150, 470, 15)); await p.waitForTimeout(7000);
  const rum = await p.evaluate(() => { const h = WW.audio.stats(); return { inten: WW.ambState.inten, lv: h.loopVoices }; });
  // slow motion (pin warp like tests/audio.js)
  await phase('slow');
  const slow = await p.evaluate(async () => {
    const c0 = WW.ambState.counts['cine.slow'] || 0;
    Object.defineProperty(WW.time, 'warp', { configurable: true, get: () => 0.5, set() {} });
    await new Promise(r => setTimeout(r, 2500)); const pt = WW.audio.pitch;
    delete WW.time.warp; WW.time.warp = 1; await new Promise(r => setTimeout(r, 600));
    return { pitch: pt, plays: (WW.ambState.counts['cine.slow'] || 0) - c0 };
  });
  chk(`slow motion: cine.slow played ${slow.plays}x, pitch ${slow.pitch.toFixed(2)}`, slow.plays === 1 && slow.pitch < 0.9);
  // a director cut from wide to close: the whoosh (camera jump detection)
  const cut = await p.evaluate(async () => {
    const c0 = WW.ambState.counts['cine.whoosh'] || 0, s = WW.world.ships.find(x => x.alive) || { x: 240, z: 150 };
    __sim.focus(240, 150, 470, 6); await new Promise(r => setTimeout(r, 1800));
    __sim.focus(s.x, s.z, 40, 6);
    await new Promise(r => setTimeout(r, 2200));
    return { plays: (WW.ambState.counts['cine.whoosh'] || 0) - c0, y: WW.camera.position.y };
  });
  // victory: horn; stalemate: three slow bells
  await phase('victory');
  const vic = await p.evaluate(async () => {
    const c = WW.ambState.counts, h0 = c['cine.horn'] || 0, b0 = c['cine.bell'] || 0;
    WW.game.endRound('USN'); await new Promise(r => setTimeout(r, 7000));
    WW.game.startRound(); await new Promise(r => setTimeout(r, 2500)); // > the bell's 2 s minGap
    WW.game.endRound(null); await new Promise(r => setTimeout(r, 5000));
    return { horn: (c['cine.horn'] || 0) - h0, bell: (c['cine.bell'] || 0) - b0 };
  });
  chk(`victory horn ${vic.horn}, round-start + stalemate bells ${vic.bell}`, vic.horn === 1 && vic.bell === 2);
  // next round: loops persist; hidden tab
  await phase('next');
  await p.evaluate(() => WW.game.startRound()); await p.waitForTimeout(1500);
  const hid = await p.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 400)); const a = WW.audio.ctx.state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 1200)); return { a, b: WW.audio.ctx.state, lv: WW.audio.stats().loopVoices, live: WW.audio.live };
  });
  chk(`tab hide/show: ${hid.a} -> ${hid.b}, ambience loop voices after ${hid.lv}`, hid.a === 'suspended' && hid.b === 'running' && hid.lv >= 2);

  const fin = await p.evaluate(() => { clearInterval(__poll); return { au: __au, s: WW.audio.stats(), counts: WW.ambState.counts, cap: WW.audio.C.MAX_VOICES }; });
  console.log('play counts', JSON.stringify(fin.counts));
  console.log('engine stats', JSON.stringify(fin.s));
  console.log('peak by phase', JSON.stringify(Object.fromEntries(Object.entries(fin.au.phasePeak).map(([k, v]) => [k, +(20 * Math.log10(v || 1e-9)).toFixed(1) + ' dBFS']))));
  const c = fin.counts, ui = ['ui.place', 'ui.error', 'ui.remove', 'ui.toggle', 'ui.tick'].map(n => n + ' ' + (c[n] || 0)).join(', ');
  chk(`setup UI sounds: ${ui}`, (c['ui.place'] || 0) >= 1 && (c['ui.error'] || 0) >= 1 && (c['ui.remove'] || 0) >= 1 && (c['ui.toggle'] || 0) >= 2 && (c['ui.tick'] || 0) >= 2 && (c['ui.tick'] || 0) <= 8);
  chk(`cut whoosh on a wide -> close cut: ${cut.plays} (cam y ${cut.y.toFixed(0)}); rumble on the wide battle shot: intensity ${rum.inten.toFixed(2)}, distant thuds ${c['amb.thud'] || 0}, gulls ${c['amb.gull'] || 0}`, cut.plays >= 1 && rum.inten > 0.05);
  chk(`voices <= cap (max ${fin.au.maxVoices} / ${fin.cap})`, fin.au.maxVoices <= fin.cap);
  chk(`master peak ${fin.au.peak.toFixed(3)} (${(20 * Math.log10(fin.au.peak)).toFixed(1)} dBFS) < -1 dBFS, no NaN (${fin.au.samples} samples)`, fin.au.peak < 0.891 && !fin.au.nan);
  chk(`no engine errors (${fin.s.errors})`, fin.s.errors === 0);
  chk(`no console/page errors (${errs.length})`, errs.length === 0);
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));
  console.log('WAVs in', OUT);
  A.forEach(a => console.log(a));
  console.log(A.every(a => a.startsWith('PASS')) ? 'ALL PASS' : 'SOME FAILED');
  await b.close();
  if (server) server.kill();
  process.exit(A.every(a => a.startsWith('PASS')) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
