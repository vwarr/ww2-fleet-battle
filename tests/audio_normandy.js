// Normandy sound verification (js/audio_normandy.js + js/audio_normandy_wire.js). You cannot listen in a test, so the
// mix is checked by instrumenting the engine: every play() / loop() request is counted per patch (requested, played,
// culled, throttled, dropped), the wire's own stats (events heard, budget skips, loop handles, voices) are sampled, the
// master output is metered and 15 s of it saved as a WAV.
// node tests/audio_normandy.js   (starts its own server on PORT, default 8813; or BASE_URL; CHROMIUM)
//   env: DEMO_DIR = where the WAVs go (default tests/shots/audio_normandy), UNTIL = sim s to run the battle to (250)
// 1. sound off: a long fast-forwarded Normandy round makes no AudioContext and no AudioNode
// 2. every Normandy patch rendered offline: peak 0.05..1, sane duration, no NaN, energy above 6 kHz < 6 %; saved as WAV
// 3. sound on (trusted key press), ?auto&scn=normandy: the run-in at 4x, the rocket barrage (06:25) at 2x, the battle
//    at 4x to UNTIL, then the camera pinned on the sand by a squad under MG fire for 20 s at 1x:
//    voices <= cap, master peak < -1 dBFS, no NaN, no errors; each family heard (surf, gulls before H only, craft
//    engines and ramps, MG 42s, mortars, the casemates, the squads' rifles and BARs, the rocket ripple and carpet,
//    the B-24 drone, the ships' big guns from offshore); the budgets hold (MG, rifles, engines, fighters); bullets snap
//    past the camera on the beach; amb.gull held off in Normandy and given back on leaving it
// 4. Pacific control: a Pacific battle with sound on requests no Normandy patch and makes no Normandy loop
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = +(process.env.PORT || 8813), UNTIL = +(process.env.UNTIL || 250);
const DEMO = process.env.DEMO_DIR || path.join(__dirname, 'shots', 'audio_normandy');
fs.mkdirSync(DEMO, { recursive: true });
const NORMANDY = ['beach.', 'craft.', 'ger.', 'bullet.', 'us.', 'land.big', 'rocket.', 'air.b24'];
const isN = n => NORMANDY.some(f => n.startsWith(f));

const PATCHES = [ // name, params, render seconds, max duration
  ['beach.breaker', { size: 1 }, 5, 4.5], ['beach.breaker', { size: 1.4 }, 5, 4.5], ['beach.wash', {}, 4, 4], ['beach.gust', { pan: 0.4 }, 5, 5], ['beach.gull', {}, 3.5, 3.5],
  ['craft.engine', { type: 'lcvp', thr: 1 }, 4, 4], ['craft.engine', { type: 'lct', thr: 1 }, 4, 4], ['craft.engine', { type: 'lci', thr: 0.35 }, 4, 4], ['craft.engine', { type: 'tank', thr: 0.9 }, 4, 4],
  ['craft.slap', { size: 1 }, 1.5, 1.2], ['craft.ground', {}, 2, 1.6], ['craft.ramp', {}, 3, 2.6], ['craft.wreck', { size: 1 }, 4, 3.6], ['craft.mine', {}, 5, 4.6],
  ['craft.founder', {}, 5, 4.6], ['craft.holed', {}, 1.5, 1.3],
  ['ger.mg42', { dur: 0.6 }, 2, 1.4], ['ger.mg42', { dur: 1.6 }, 3, 2.4], ['ger.pak', {}, 2, 1.6], ['ger.pak', { big: 1 }, 2, 1.8],
  ['ger.mortar.fire', {}, 1, 0.8], ['ger.mortar.whistle', {}, 1, 0.85], ['ger.mortar.burst', { size: 1 }, 2.5, 2.2], ['ger.mortar.burst', { size: 0.5 }, 2, 1.6],
  ['bullet.snap', {}, 0.5, 0.2], ['bullet.rico', {}, 1, 0.8], ['bullet.thud', {}, 0.5, 0.4],
  ['us.rifle', { n: 3, ping: 1 }, 3, 2.6], ['us.bar', { n: 6 }, 2, 1.6], ['us.bazooka', { fl: 0.6 }, 2.5, 2.2], ['us.bangalore', {}, 3.5, 3.2],
  ['land.big', { size: 1.1 }, 4.5, 4.2],
  ['rocket.ripple', {}, 4, 4], ['rocket.whoosh', {}, 1.5, 1.2], ['rocket.carpet', { n: 6, wet: 0.5, span: 0.2 }, 2.5, 2.2], ['rocket.carpet', { n: 2, wet: 1, span: 0.1 }, 2, 1.6],
  ['air.b24', { n: 6, cloud: 1 }, 5, 5]
];

(async () => {
  let server = null;
  if (!process.env.BASE_URL) { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1000)); }
  const BASE = process.env.BASE_URL || `http://localhost:${PORT}/`;
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const A = [], chk = (name, v) => A.push((v ? 'PASS ' : 'FAIL ') + name);
  const errs = [];
  async function page(q) {
    const p = await b.newPage({ viewport: { width: 800, height: 450 } });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
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
      const con = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (d) { if (d instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext) && !window.__masterOut && !this.__tap) window.__masterOut = this; return con.apply(this, arguments); };
    });
    await p.goto(BASE + 'index.html?auto' + q + '&v=' + Date.now(), { timeout: 120000 });
    await p.waitForTimeout(2000);
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
      window.__hf = async (buffer) => {
        const oc = new OfflineAudioContext(1, buffer.length, buffer.sampleRate), s = oc.createBufferSource(); s.buffer = buffer;
        const h1 = oc.createBiquadFilter(), h2 = oc.createBiquadFilter(); h1.type = h2.type = 'highpass'; h1.frequency.value = h2.frequency.value = 6000;
        s.connect(h1); h1.connect(h2); h2.connect(oc.destination); s.start();
        const r = await oc.startRendering(), a = buffer.getChannelData(0), hp = r.getChannelData(0);
        let e = 0, eh = 0; for (let i = 0; i < a.length; i++) { e += a[i] * a[i]; eh += hp[i] * hp[i]; }
        return e > 0 ? eh / e : 0;
      };
      // headless swiftshader draws ~1 frame/s: draw only every 60th frame so the sim, the director and the audio run at pace
      if (WW.post) { const r0 = WW.post.render; let k = 0; WW.post.render = (s, c) => { if (++k % 60 === 0) r0(s, c); }; }
    });
    return p;
  }
  // sound on, with the engine instrumented: per-patch counters, max voices, the master meter, a recorder
  async function soundOn(p) {
    await p.keyboard.press('m');
    await p.waitForTimeout(500);
    return p.evaluate(() => {
      const W = WW.audio, pc = window.__pc = {}, lc = window.__lc = {}, gulls = window.__gulls = [];
      const P = W.play, L = W.loop;
      W.play = function (n, o) {
        const s0 = W.stats(), r = P(n, o), s1 = W.stats(), c = pc[n] || (pc[n] = { req: 0, played: 0, culled: 0, throttled: 0, dropped: 0 });
        c.req++; if (r) c.played++; c.culled += s1.culled - s0.culled; c.throttled += s1.throttled - s0.throttled; c.dropped += s1.dropped - s0.dropped;
        if (r && (n === 'beach.gull' || n === 'amb.gull')) gulls.push([n, WW.game.roundTime]);
        return r;
      };
      W.loop = function (n, o) { lc[n] = (lc[n] || 0) + 1; return L(n, o); };
      window.__au = { maxVoices: 0, peak: 0, rmsMax: 0, nan: false, samples: 0, upd: 0, frames: 0, maxEng: 0, maxEngV: 0, maxFight: 0, maxAct: {}, hy: [] };
      const u = W.update;
      W.update = function (rdt) { const t = performance.now(); u(rdt); __au.upd += performance.now() - t; __au.frames++; };
      window.__poll = setInterval(() => {
        const m = W.meter(), s = W.stats(), n = WW.audioNormandy ? WW.audioNormandy.stats() : null;
        __au.samples++; __au.peak = Math.max(__au.peak, m.peak); __au.rmsMax = Math.max(__au.rmsMax, m.rms); __au.nan = __au.nan || m.nan;
        __au.maxVoices = Math.max(__au.maxVoices, s.voices);
        if (n) {
          __au.maxEng = Math.max(__au.maxEng, n.engines); __au.maxEngV = Math.max(__au.maxEngV, n.engineVoices); __au.maxFight = Math.max(__au.maxFight, n.fighters);
          for (const k in n.active) __au.maxAct[k] = Math.max(__au.maxAct[k] || 0, n.active[k]);
        }
        // where the director puts the listener: height and distance to the waterline
        const Ls = W.listener; if (WW.normandyTerrain && __au.hy.length < 4000) __au.hy.push([Math.round(Ls.y), Math.round(Math.abs(Ls.z - WW.normandyTerrain.shoreZ(Math.max(650, Math.min(2250, Ls.x)))))]);
      }, 200);
      window.__rec = { on: false, L: [], R: [], n: 0 };
      const ctx = W.ctx, sp = ctx.createScriptProcessor(4096, 2, 2); sp.__tap = true;
      sp.onaudioprocess = e => { if (!__rec.on) return; __rec.L.push(new Float32Array(e.inputBuffer.getChannelData(0))); __rec.R.push(new Float32Array(e.inputBuffer.getChannelData(1))); __rec.n += 4096; };
      window.__masterOut.connect(sp); sp.connect(ctx.destination);
      return W.live;
    });
  }
  const untilRt = (p, t, maxMs) => p.waitForFunction(t => WW.game.roundTime >= t || WW.game.state !== 'battle', t, { timeout: maxMs, polling: 250 }).catch(() => null);

  // ---- 1. sound off ----
  const p = await page('&scn=normandy');
  const off = await p.evaluate(() => {
    __sim.game.startRound();
    for (let i = 0; i < 20; i++) __sim.fastForward(15);
    return { ac: Object.assign({}, __ac), ctx: !!WW.audio.ctx, scn: WW.scn().id, craft: WW.landingCraft.stats.launched, squads: WW.infantry.stats.squads, shells: WW.stats.shellsFired };
  });
  chk(`sound off: 300 sim s of Normandy (${off.scn}: ${off.craft} craft, ${off.squads} squads, ${off.shells} shells) -> ${off.ac.contexts} contexts, ${off.ac.nodes} nodes`, off.scn === 'normandy' && off.ac.contexts === 0 && off.ac.nodes === 0 && !off.ctx);

  // ---- 2. offline renders ----
  for (const [name, prm, secs, maxDur] of PATCHES) {
    const r = await p.evaluate(async ([name, prm, secs]) => {
      const r = await WW.audio.renderOffline(name, prm, secs);
      if (!r) return null;
      const hf = await __hf(r.buffer);
      let peak = r.peak, nan = r.nan, durMax = r.dur;
      for (let i = 0; i < 3; i++) { const q = await WW.audio.renderOffline(name, prm, secs); peak = Math.max(peak, q.peak); nan = nan || q.nan; durMax = Math.max(durMax, q.dur); }
      return { peak, rms: r.rms, dur: durMax, nan, hf, wav: __wav([r.buffer.getChannelData(0), r.buffer.getChannelData(1)], r.buffer.sampleRate) };
    }, [name, prm, secs]);
    const tag = name + (Object.keys(prm).length ? '_' + Object.entries(prm).map(([k, v]) => k + v).join('_') : '');
    if (!r) { chk('render ' + tag + ': missing', false); continue; }
    fs.writeFileSync(path.join(DEMO, tag + '.wav'), Buffer.from(r.wav, 'base64'));
    const ok = !r.nan && r.peak >= 0.05 && r.peak <= 1 && r.dur > 0.02 && r.dur <= maxDur && r.hf < 0.06;
    chk(`render ${tag.padEnd(40)} max peak of 4 ${r.peak.toFixed(3)} rms ${r.rms.toFixed(4)} dur ${r.dur.toFixed(2)}s (<= ${maxDur}) >6kHz ${(r.hf * 100).toFixed(2)}%`, ok);
  }

  // ---- 3. a Normandy round with sound on ----
  await p.evaluate(() => { __sim.game.startRound(); __sim.setScale(6); });
  chk('M key enables sound', await soundOn(p));
  await p.evaluate(() => { window.__t0 = performance.now(); });
  await untilRt(p, 47, 120000);                                        // the run-in, the B-24s over the cloud (06:05-06:11)
  const pre = await p.evaluate(() => ({ rt: WW.game.roundTime, n: WW.audioNormandy.stats(), lc: Object.assign({}, __lc) }));
  await p.evaluate(() => __sim.setScale(4));
  await untilRt(p, 68, 150000);                                         // the rocket barrage (06:25 = 52.5 sim s), at 2x
  const rk = await p.evaluate(() => ({ rt: WW.game.roundTime, n: WW.audioNormandy.stats(), rockets: WW.rocketBarrage ? WW.rocketBarrage.rockets.length : 0 }));
  await p.evaluate(() => __sim.setScale(16));
  await untilRt(p, UNTIL, 500000);                                     // the battle
  const mid = await p.evaluate(() => ({ rt: WW.game.roundTime, state: WW.game.state, n: WW.audioNormandy.stats(), pc: JSON.parse(JSON.stringify(__pc)), real: (performance.now() - __t0) / 1000 }));
  // the camera pinned on the sand by a squad under MG fire (the director rarely goes there): the near field
  await p.evaluate(() => { window.__tg = new Map(); WW.on('defenceFire', e => { if (e && e.kind === 'mg' && e.target && e.target.isSquad) __tg.set(e.target, (__tg.get(e.target) || 0) + 1); }); });
  await p.waitForTimeout(4000);   // which squads the MGs are firing on now
  const pin = await p.evaluate(() => {
    const els = WW.coastDefence.elements.filter(e => e.alive && (e.kind === 'mg' || e.kind === 'tob') && e.suppressedUntil < WW.time.now);
    let best = null, bs = -1;
    for (const q of WW.infantry.squads) {
      if (!q.alive || q.kind === 'tank') continue;
      const n = els.filter(e => Math.hypot(e.x - q.x, e.z - q.z) < (e.K.range || 90)).length;
      const fights = ['shingle', 'shelf', 'climb', 'top', 'assault', 'hold'].includes(q.state), s = (__tg.get(q) || 0) * 10 + Math.min(n, 4) * 3 + (fights ? 20 : ['cross', 'wade'].includes(q.state) ? 5 : 0) + Math.random() * 0.1;
      if (s > bs) { bs = s; best = q; }
    }
    if (!best) return null;
    const q = best, at = { x: q.x, z: q.z - 3 }, look = { x: q.x, z: q.z + 30 };
    const cu = WW.cam.update;
    WW.cam.update = function () { cu.apply(this, arguments); const g = Math.max(0, WW.terrain.heightRaw(at.x, at.z)); WW.camera.position.set(at.x, g + 2.5, at.z); WW.camera.lookAt(look.x, g + 4, look.z); WW.camera.updateMatrixWorld(); };
    window.__pinQ = q; window.__pinBase = JSON.parse(JSON.stringify(__pc));
    __sim.setScale(2);
    return { x: Math.round(q.x), z: Math.round(q.z), state: q.state, fired: __tg.get(q) || 0 };
  });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { __rec.on = true; });
  await p.waitForTimeout(15500);
  const rec = await p.evaluate(() => {
    __rec.on = false;
    const cat = a => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
    const L = cat(__rec.L), R = cat(__rec.R); let pk = 0, s = 0; for (let i = 0; i < L.length; i++) { pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); s += L[i] * L[i]; }
    const ab = new AudioBuffer({ length: L.length, numberOfChannels: 1, sampleRate: WW.audio.ctx.sampleRate }); ab.copyToChannel(L, 0);
    return __hf(ab).then(hf => ({ secs: L.length / WW.audio.ctx.sampleRate, peak: pk, rms: Math.sqrt(s / (L.length || 1)), hf, wav: __wav([L, R], WW.audio.ctx.sampleRate) }));
  });
  fs.writeFileSync(path.join(DEMO, 'beach_mix_15s.wav'), Buffer.from(rec.wav, 'base64'));
  await p.waitForTimeout(2000);
  const st = await p.evaluate(() => JSON.parse(JSON.stringify({ au: __au, pc: __pc, lc: __lc, gulls: __gulls, base: __pinBase, st: WW.audio.stats(), cap: WW.audio.C.MAX_VOICES, n: WW.audioNormandy.stats(),
    rt: WW.game.roundTime, H: WW.scenarios.normandy.clock.H, gullHeld: WW.audio.patches['amb.gull'].minGap === Infinity })));
  // leaving Normandy gives amb.gull its own gate back
  const back = await p.evaluate(() => { WW.setScenario('pacific'); WW.emit('setupStart'); return { gap: WW.audio.patches['amb.gull'].minGap, held: WW.audioNormandy.stats().gullHeld }; });

  const fam = (pre) => Object.keys(st.pc).filter(n => n.startsWith(pre) && st.pc[n].played > 0);
  console.log('\nper-patch over the round:  requested  played  culled  throttled  dropped');
  for (const n of Object.keys(st.pc).sort()) { const c = st.pc[n]; console.log('  ' + n.padEnd(20) + String(c.req).padStart(9) + String(c.played).padStart(8) + String(c.culled).padStart(8) + String(c.throttled).padStart(11) + String(c.dropped).padStart(9)); }
  console.log('loop handles made', JSON.stringify(st.lc));
  console.log('wire events', JSON.stringify(st.n.ev));
  console.log('wire budget skips', JSON.stringify(st.n.skipped), ' max active per family', JSON.stringify(st.au.maxAct), ' max queue', st.n.maxPend, 'max timers', st.n.maxLater);
  const perMin = Object.fromEntries(Object.entries(st.pc).filter(([n]) => isN(n) || /^gun\.|^shell\./.test(n)).map(([n, c]) => [n, +(c.played / Math.max(1, mid.real) * 60).toFixed(1)]));
  console.log(`plays per real minute (run-in + barrage + battle: ${mid.real.toFixed(0)} s real to rt ${mid.rt.toFixed(0)}):`, JSON.stringify(perMin));
  const hist = {}; for (const [y, d] of st.au.hy) { const k = (y < 20 ? 'low' : y < 80 ? 'mid' : 'high') + '/' + (d < 60 ? 'beach' : d < 300 ? 'near' : 'off'); hist[k] = (hist[k] || 0) + 1; }
  console.log('listener (height / distance to the waterline) samples', JSON.stringify(hist));
  console.log('pinned on the beach', JSON.stringify(pin), 'beach mix', JSON.stringify({ secs: +rec.secs.toFixed(1), peak: +rec.peak.toFixed(3), rms: +rec.rms.toFixed(4), hf: +(rec.hf * 100).toFixed(2) }));
  console.log('engine stats', JSON.stringify(st.st), ' audio update', (st.au.upd / st.au.frames).toFixed(3), 'ms/frame');
  const pl = n => (st.pc[n] ? st.pc[n].played : 0), dpin = n => pl(n) - ((st.base[n] && st.base[n].played) || 0);
  chk(`the round ran (rt ${mid.rt.toFixed(0)} by the battle, ${st.rt.toFixed(0)} at the end; ${mid.state})`, mid.rt >= Math.min(UNTIL, 200));
  chk(`voices <= cap: max ${st.au.maxVoices} (cap ${st.cap})`, st.au.maxVoices <= st.cap);
  chk(`master peak ${st.au.peak.toFixed(3)} (${(20 * Math.log10(st.au.peak || 1e-9)).toFixed(1)} dBFS) < -1 dBFS, no NaN (${st.au.samples} samples), not silent (max rms ${st.au.rmsMax.toFixed(4)})`, st.au.peak < 0.891 && !st.au.nan && st.au.rmsMax > 1e-4);
  chk('no engine errors (' + st.st.errors + ')', st.st.errors === 0);
  chk(`the surf: ${pl('beach.breaker')} breakers, wash ${st.lc['beach.wash'] || 0} / gust ${st.lc['beach.gust'] || 0} loops`, pl('beach.breaker') > 5 && st.lc['beach.wash'] > 0);
  const gl = st.gulls.filter(g => g[0] === 'beach.gull'), late = gl.filter(g => g[1] >= st.H), amb = st.gulls.filter(g => g[0] === 'amb.gull');
  chk(`gulls only before H-hour: ${gl.length} beach.gull (${late.length} after H), ${amb.length} amb.gull; amb.gull held (${st.gullHeld})`, gl.length > 0 && late.length === 0 && amb.length === 0 && st.gullHeld);
  chk(`amb.gull given back on leaving Normandy (minGap ${back.gap}, held ${back.held})`, back.gap === 2 && !back.held);
  chk(`the run-in: craft.engine loops ${st.lc['craft.engine'] || 0} (max ${st.au.maxEng} handles, ${st.au.maxEngV} voiced), ramps ${pl('craft.ramp')}, slaps ${pl('craft.slap')}, wrecks/mines/founders ${pl('craft.wreck')}/${pl('craft.mine')}/${pl('craft.founder')}`,
    st.lc['craft.engine'] > 0 && st.au.maxEng <= 6 && pl('craft.ramp') > 0);
  chk(`the German fire: MG 42 ${pl('ger.mg42')} bursts (max ${st.au.maxAct['ger.mg42'] || 0} at once, budget 5), mortars ${pl('ger.mortar.burst')} bursts / ${pl('ger.mortar.fire')} launches, casemates ${pl('ger.pak')}, flak ${pl('aa.oerlikon')}`,
    pl('ger.mg42') > 10 && (st.au.maxAct['ger.mg42'] || 0) <= 5 && pl('ger.mortar.burst') + pl('ger.mortar.fire') > 0 && pl('ger.pak') > 0);
  chk(`the US side: rifles ${pl('us.rifle')}, BARs ${pl('us.bar')}, bazookas ${pl('us.bazooka')}, Bangalores ${pl('us.bangalore')}, Shermans/75s (gun.small) ${pl('gun.small')}`, pl('us.rifle') + pl('us.bar') > 5 && pl('us.bangalore') > 0);
  chk(`the bombardment from offshore: gun.big ${pl('gun.big')}, gun.dd ${pl('gun.dd')}, land.big ${pl('land.big')} on the bluffs`, pl('gun.big') + pl('gun.dd') > 0 && pl('land.big') > 0);
  chk(`the rocket barrage (${rk.rockets} rockets by rt ${rk.rt.toFixed(0)}): ${st.n.ev.rippleLoop || 0} ripple loops, ${st.n.ev.rocketImpact || 0} impacts heard -> ${pl('rocket.carpet')} carpets, ${pl('rocket.whoosh')} whooshes`,
    (st.n.ev.rippleLoop || 0) > 0 && pl('rocket.carpet') > 5);
  chk(`the planes: air.b24 loops ${st.lc['air.b24'] || 0}, fighter engines ${st.lc['plane.engine'] || 0} (max ${st.au.maxFight} handles <= 4)`, (st.lc['air.b24'] || 0) > 0 && st.au.maxFight <= 4);
  chk(`on the beach (${pin ? pin.state : '-'}, under fire from ${pin ? pin.fired : 0} MG bursts before the pin): ${dpin('bullet.snap')} snaps, ${dpin('bullet.rico')} ricochets, ${dpin('bullet.thud')} thuds, ${dpin('ger.mg42')} MG bursts, ${dpin('us.rifle') + dpin('us.bar')} US`, pin && dpin('bullet.snap') > 0 && dpin('ger.mg42') > 0);
  chk(`beach mix recorded (${rec.secs.toFixed(1)} s, peak ${rec.peak.toFixed(3)}, >6 kHz ${(rec.hf * 100).toFixed(2)}%)`, rec.secs > 14 && rec.peak > 0.01 && rec.peak < 0.891);
  chk(`ambience ducked under heavy fire (${st.n.ev.duck || 0} ducks)`, (st.n.ev.duck || 0) > 0);
  chk(`the wire's queue and timers stay bounded (queue ${st.n.maxPend} <= 96, timers ${st.n.maxLater} <= 200)`, st.n.maxPend <= 96 && st.n.maxLater <= 200);
  await p.close();

  // ---- 4. Pacific control ----
  const q = await page('');
  await q.evaluate(() => { __sim.game.startRound(); __sim.setScale(4); });
  await soundOn(q);
  await q.waitForTimeout(40000);
  const pc = await q.evaluate(() => JSON.parse(JSON.stringify({ pc: __pc, lc: __lc, scn: WW.scn().id, gap: WW.audio.patches['amb.gull'].minGap, n: WW.audioNormandy.stats(), st: WW.audio.stats() })));
  const nreq = Object.keys(pc.pc).filter(isN), nloop = Object.keys(pc.lc).filter(isN);
  chk(`Pacific control (${pc.scn}, ${pc.st.played} plays): no Normandy patch requested (${nreq.join(',') || 'none'}), no Normandy loop (${nloop.join(',') || 'none'}), wire idle (${Object.keys(pc.n.req).length} requests), amb.gull minGap ${pc.gap}`,
    pc.scn === 'pacific' && !nreq.length && !nloop.length && !Object.keys(pc.n.req).length && pc.gap === 2 && pc.st.played > 0);
  chk('no console/page errors (' + errs.length + ')', errs.length === 0);
  if (errs.length) console.log('ERRORS', errs.slice(0, 10));
  console.log('\nWAV demos in', DEMO);
  A.forEach(a => console.log(a));
  console.log(A.every(a => a.startsWith('PASS')) ? 'ALL PASS' : 'SOME FAILED');
  await b.close();
  if (server) server.kill();
})().catch(e => { console.error(e); process.exit(1); });
