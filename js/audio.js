// audio.js: WW.audio, the synthesized sound engine (Web Audio, no files). Starts muted.
// Patches (sound recipes) are registered by name; play() makes a one-shot at a world position,
// loop() returns a virtual handle for continuous sources. Spatial model, buses, voice caps: docs/AUDIO.md.
// When sound is off (or Web Audio is missing) play/loop are near-free no-ops: no AudioContext, no nodes.
window.WW = window.WW || {};
(function (WW) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const C = {
    MAX_VOICES: 48,      // global voice cap (one-shots + realized loops)
    PATCH_MAX: 8,        // default per-patch cap (register opts.max)
    CULL: 0.004,         // a one-shot whose estimated level (vol x distance gain) is below this is never built (-48 dB)
    LOOP_IN: 0.006, LOOP_OUT: 0.003, // a loop gets real nodes above LOOP_IN and loses them below LOOP_OUT
    REF: 30,             // default reference distance (units): full level inside it, inverse falloff outside
    ROLLOFF: 1,
    ABSORB: 60,          // air absorption: low-pass cutoff = LP_MAX / (1 + d / ABSORB)
    LP_MAX: 16000, LP_MIN: 450,
    SOUND_SPEED: 250,    // fake speed of sound, world units per real second at 1x (real ~170 u/s); see delayFor()
    MAX_SOS: 1.5,        // longest speed-of-sound delay (s)
    DOPPLER_SPEED: 150,  // speed used by doppler() (smaller = stronger shift)
    PAN: 0.85            // stereo width
  };
  const BUS_GAIN = { sfx: 0.9, ambience: 0.55, ui: 0.45 };
  const ENGINE_KEYS = { x: 1, y: 1, z: 1, at: 1, ui: 1, vol: 1, rate: 1, delay: 1, sos: 1, ref: 1, duck: 1, persist: 1, doppler: 1 };
  const patches = Object.create(null), lastPlay = Object.create(null), hooks = [];
  const voices = [], dying = [], loops = [];
  const S = { played: 0, culled: 0, throttled: 0, stolen: 0, dropped: 0, errors: 0, nodes: 0, built: 0 };
  let ctx = null, M = null, live = false, hidden = false, pending = false, enabled = false, volume = 0.7;
  let slowF = 1, pitch = 1, lastLp = -1, offTimer = 0;
  const L = { x: 0, y: 50, z: 0, vx: 0, vy: 0, vz: 0, rx: 1, ry: 0, rz: 0, fx: 0, fy: 0, fz: -1, ok: false };
  const NULL_HANDLE = { set() { return this; }, stop() {}, alive: false, virtual: true };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const nowReal = () => performance.now() / 1000;

  // ---------- prefs ----------
  try {
    const s = JSON.parse(localStorage.getItem('ww.audio') || 'null');
    if (s) { volume = clamp(+s.volume || 0, 0, 1); if (s.on && AC) pending = true; }
  } catch (e) { /* storage blocked */ }
  function save() { try { localStorage.setItem('ww.audio', JSON.stringify({ on: enabled || pending, volume })); } catch (e) {} }

  // ---------- graph ----------
  function impulse(c) { // algorithmic outdoor reverb: 2.2 s of decaying, darkening stereo noise
    const n = Math.floor(c.sampleRate * 2.2), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate, k = 0.25 + 0.7 * Math.min(1, t / 1.2); // darker as it decays
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * Math.exp(-t * 2.6) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return b;
  }
  function countNodes(c) { // count every node this context makes (stats.nodes, per-voice node counts)
    const P = Object.getPrototypeOf(c);
    for (const k of ['createGain', 'createBiquadFilter', 'createOscillator', 'createBufferSource', 'createStereoPanner',
      'createDelay', 'createWaveShaper', 'createConvolver', 'createDynamicsCompressor', 'createAnalyser', 'createConstantSource', 'createPanner']) {
      const f = c[k] || P[k]; if (typeof f !== 'function') continue;
      c[k] = function () { S.nodes++; return f.apply(c, arguments); };
    }
  }
  function build() {
    ctx = new AC({ latencyHint: 'playback' });
    countNodes(ctx);
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    M = { master: g(0), slow: ctx.createBiquadFilter(), comp: ctx.createDynamicsCompressor(), lim: ctx.createDynamicsCompressor(), trim: g(0.85),
          duck: g(1), verb: ctx.createConvolver(), verbRet: g(0.55), bus: {} };
    M.slow.type = 'lowpass'; M.slow.frequency.value = 20000; M.slow.Q.value = 0.5;
    const cp = (n, th, kn, ra, at, re) => { n.threshold.value = th; n.knee.value = kn; n.ratio.value = ra; n.attack.value = at; n.release.value = re; };
    cp(M.comp, -18, 10, 4, 0.006, 0.3);   // glue: big battles get squeezed, not clipped
    cp(M.lim, -4, 0, 20, 0.001, 0.12);    // limiter
    for (const b in BUS_GAIN) M.bus[b] = g(BUS_GAIN[b]);
    M.verb.buffer = impulse(ctx);
    M.bus.sfx.connect(M.slow); M.verb.connect(M.verbRet); M.verbRet.connect(M.slow);
    M.bus.ambience.connect(M.duck); M.duck.connect(M.slow);
    M.slow.connect(M.master); M.bus.ui.connect(M.master);
    M.master.connect(M.comp); M.comp.connect(M.lim); M.lim.connect(M.trim); M.trim.connect(ctx.destination);
    ctx.onstatechange = refreshLive;
  }
  function refreshLive() { live = !!(enabled && ctx && ctx.state === 'running' && !hidden); }

  // ---------- enable / disable ----------
  function start() { // must run inside a user gesture
    pending = false;
    if (!AC) return false;
    try {
      if (!ctx) build();
      clearTimeout(offTimer);
      enabled = true;
      const r = ctx.resume(); if (r && r.then) r.then(refreshLive, () => {});
      M.master.gain.cancelScheduledValues(ctx.currentTime);
      M.master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.05);
      refreshLive();
    } catch (e) { S.errors++; enabled = false; }
    save(); return enabled;
  }
  function stopEngine() {
    enabled = false; pending = false; refreshLive(); save();
    if (!ctx) return;
    try {
      M.master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      clearTimeout(offTimer);
      offTimer = setTimeout(() => {
        if (enabled) return;
        killAll();
        try { ctx.suspend(); } catch (e) {}
      }, 200);
    } catch (e) { S.errors++; }
  }
  function killAll() {
    while (voices.length) drop(voices.pop());
    for (const d of dying) disc(d);
    dying.length = 0;
    for (const h of loops) h.voice = null;
  }
  function onGesture(e) {
    if (!pending) return;
    if (e.type === 'keydown' && (e.key === 'Escape' || e.key === 'm' || e.key === 'M')) return; // M is the toggle itself
    if (e.target && e.target.closest && e.target.closest('[data-audio]')) return;       // so is the sound button
    start();
  }
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden; refreshLive();
    if (!ctx || !enabled) return;
    try { if (hidden) ctx.suspend(); else ctx.resume(); } catch (e) {}
  });

  // ---------- spatial model ----------
  function distGain(d, ref) { return d <= ref ? 1 : ref / (ref + C.ROLLOFF * (d - ref)); }
  function posOf(o, out) {
    const a = o.at || o;
    out.x = +a.x || 0; out.y = a.y !== undefined ? +a.y || 0 : 0; out.z = +a.z || 0; return out;
  }
  const _p = { x: 0, y: 0, z: 0 };
  function distTo(x, y, z) { return Math.hypot(x - L.x, y - L.y, z - L.z); }
  // speed-of-sound delay (real seconds) for a sound d units away: the boom lands a beat after the flash
  function delayFor(d) {
    const sim = Math.max(0.25, (WW.time.scale || 1) * (WW.time.warp || 1));
    return Math.min(C.MAX_SOS, d / C.SOUND_SPEED / sim);
  }
  // doppler playback-rate factor; positions in world units, velocities in units per REAL second
  function doppler(src, vel, c) {
    c = c || C.DOPPLER_SPEED;
    const dx = L.x - src.x, dy = L.y - src.y, dz = L.z - src.z, d = Math.hypot(dx, dy, dz) || 1;
    const vs = ((vel.x || 0) * dx + (vel.y || 0) * dy + (vel.z || 0) * dz) / d; // source speed toward listener
    const vl = -(L.vx * dx + L.vy * dy + L.vz * dz) / d;                          // listener speed toward source
    return clamp((c + vl) / Math.max(c * 0.2, c - vs), 0.5, 2);
  }
  function spatial(v, x, y, z, t, tc) { // set gain / low-pass / pan of a positional voice
    const dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.hypot(dx, dy, dz) || 0.001;
    const gain = v.vol * distGain(d, v.ref);
    let f = C.LP_MAX / (1 + d / C.ABSORB);
    const fw = (dx * L.fx + dy * L.fy + dz * L.fz) / d;
    if (fw < 0) f *= 1 + 0.35 * fw; // behind the camera: a little duller
    const pan = clamp((dx * L.rx + dy * L.ry + dz * L.rz) / d * C.PAN * Math.min(1, d / 8), -1, 1);
    v.level = gain;
    if (tc === 0) { v.g.gain.setValueAtTime(gain, t); v.lp.frequency.setValueAtTime(Math.max(C.LP_MIN, f), t); v.pan.pan.setValueAtTime(pan, t); }
    else {
      if (Math.abs(gain - v.lg) > v.lg * 0.02 + 1e-4) { v.g.gain.setTargetAtTime(gain, t, tc); v.lg = gain; }
      if (Math.abs(f - v.lf) > v.lf * 0.03) { v.lp.frequency.setTargetAtTime(Math.max(C.LP_MIN, f), t, tc); v.lf = f; }
      if (Math.abs(pan - v.lpn) > 0.02) { v.pan.pan.setTargetAtTime(pan, t, tc); v.lpn = pan; }
    }
    if (tc === 0) { v.lg = gain; v.lf = f; v.lpn = pan; }
    if (v.send) { const s = v.verb * (0.35 + 0.65 * Math.min(1, d / 250)); if (tc === 0 || Math.abs(s - v.ls) > 0.01) { v.send.gain.setTargetAtTime(s, t, tc || 0.01); v.ls = s; } }
    return d;
  }

  // ---------- voices ----------
  function disc(v) { try { v.g.disconnect(); if (v.lp) { v.lp.disconnect(); v.pan.disconnect(); } if (v.send) v.send.disconnect(); } catch (e) {} }
  function drop(v) { // stop now, with a short fade (steal / release)
    const t = ctx.currentTime;
    try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.02); if (v.inst && v.inst.stop) v.inst.stop(t + 0.12); } catch (e) {}
    v.end = t + 0.15; dying.push(v);
    if (v.loop) v.loop.voice = null;
  }
  function estimate(v, now) { // audible level now (one-shots fade over their duration)
    if (v.loop) return v.level;
    const k = 1 - (now - v.t0) / Math.max(0.05, v.end - v.t0);
    return now < v.t0 ? v.level : v.level * clamp(k, 0, 1);
  }
  // make room for a new voice of patch `def` at `level`; false = the new one loses
  function room(def, name, level) {
    let n = 0, oldest = null;
    for (const v of voices) if (v.name === name) { n++; if (!oldest || v.t0 < oldest.t0) oldest = v; }
    if (n >= def.max) { if (oldest.loop) return false; remove(oldest); S.stolen++; }
    if (voices.length < C.MAX_VOICES) return true;
    const now = ctx.currentTime; let q = null, ql = 1e9;
    for (const v of voices) { const e = estimate(v, now) * (v.loop ? 1.5 : 1); if (e < ql) { ql = e; q = v; } }
    if (!q || ql >= level) return false;
    remove(q); S.stolen++; return true;
  }
  function remove(v) { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); drop(v); }

  function makeVoice(name, def, o, level, pos, t0) {
    const n0 = S.nodes;
    const v = { name, def, t0, end: t0 + def.dur, level, vol: o.vol == null ? 1 : +o.vol, ref: o.ref || def.ref, loop: null,
                pos, g: ctx.createGain(), lp: null, pan: null, send: null, verb: def.reverb, lg: 0, lf: 0, lpn: 0, ls: -1, nodes: 0, inst: null };
    const bus = M.bus[def.bus] || M.bus.sfx;
    if (pos) {
      v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.Q.value = 0.4;
      v.pan = ctx.createStereoPanner();
      v.g.connect(v.lp); v.lp.connect(v.pan); v.pan.connect(bus);
      if (v.verb > 0) { v.send = ctx.createGain(); v.send.gain.value = 0; v.lp.connect(v.send); v.send.connect(M.verb); }
      v.dist = spatial(v, pos.x, pos.y, pos.z, ctx.currentTime, 0);
    } else { v.g.gain.value = v.vol; v.g.connect(bus); v.dist = 0; }
    const p = Object.assign({}, def.params, o);
    p.t = t0; p.dist = v.dist; p.rate = (o.rate || 1) * (def.bus === 'ui' ? 1 : pitch);
    let r;
    try { r = def.build(ctx, v.g, p); } catch (e) { S.errors++; console.error('audio patch ' + name, e); disc(v); return null; }
    v.inst = r && typeof r === 'object' ? r : null;
    const dur = typeof r === 'number' ? r : v.inst && v.inst.dur != null ? v.inst.dur : def.dur;
    v.end = t0 + dur;
    v.nodes = S.nodes - n0; S.built++;
    voices.push(v);
    return v;
  }

  // ---------- public: register / play / loop ----------
  // register(name, build) or register(name, { build, bus, ref, max, minGap, sos, reverb, dur, duck, params })
  function register(name, def) {
    if (typeof def === 'function') def = { build: def };
    patches[name] = Object.assign({ bus: 'sfx', ref: C.REF, max: C.PATCH_MAX, minGap: 0, sos: false, reverb: 0.15, dur: 2, duck: 0, params: null }, def);
    return patches[name];
  }
  function play(name, o) {
    if (!live) return null; // the whole cost when sound is off
    try {
      o = o || {};
      const def = patches[name]; if (!def) return null;
      const now = nowReal();
      if (def.minGap && now - (lastPlay[name] || -1e9) < def.minGap) { S.throttled++; return null; }
      const pos = o.ui ? null : posOf(o, _p);
      const vol = o.vol == null ? 1 : +o.vol;
      const d = pos ? distTo(pos.x, pos.y, pos.z) : 0;
      const level = vol * (pos ? distGain(d, o.ref || def.ref) : 1);
      if (level < C.CULL) { S.culled++; return null; }
      if (!room(def, name, level)) { S.dropped++; return null; }
      lastPlay[name] = now;
      let delay = Math.max(0, +o.delay || 0);
      if (pos && (o.sos != null ? o.sos : def.sos)) delay += delayFor(d);
      const v = makeVoice(name, def, o, level, pos && { x: pos.x, y: pos.y, z: pos.z }, ctx.currentTime + delay + 0.005);
      if (!v) return null;
      S.played++;
      const dk = o.duck != null ? o.duck : def.duck;
      if (dk > 0) duck(dk * Math.min(1, level * 1.5), 1.6, delay);
      return v;
    } catch (e) { S.errors++; return null; }
  }
  // loop(name, opts) -> handle. Virtual: nodes exist only while sound is on and the source is audible.
  function loop(name, o) {
    if (!AC) return NULL_HANDLE;
    const h = { name, p: Object.assign({}, o), voice: null, alive: true, persist: !!(o && o.persist), virtual: true,
      px: null, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, lr: 0,
      set(q) {
        if (!this.alive || !q) return this;
        Object.assign(this.p, q);
        const v = this.voice;
        if (v && v.inst && v.inst.set) {
          let fwd = false; for (const k in q) if (!ENGINE_KEYS[k]) { fwd = true; break; }
          if (fwd) try { v.inst.set(q); } catch (e) { S.errors++; }
        }
        return this;
      },
      stop(fade) {
        if (!this.alive) return; this.alive = false;
        const i = loops.indexOf(this); if (i >= 0) loops.splice(i, 1);
        const v = this.voice; if (!v || !ctx) return;
        this.voice = null; const k = voices.indexOf(v); if (k >= 0) voices.splice(k, 1);
        const t = ctx.currentTime, f = fade == null ? 0.3 : Math.max(0.02, fade);
        try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, f / 4); if (v.inst && v.inst.stop) v.inst.stop(t + f + 0.05); } catch (e) {}
        v.end = t + f + 0.1; v.loop = null; dying.push(v);
      }
    };
    loops.push(h);
    return h;
  }
  function stopAll(fade, all) { for (const h of loops.slice()) if (all || !h.persist) h.stop(fade); }
  function updateLoop(h, rdt, t) {
    const p = h.p, def = patches[h.name];
    if (!def) return;
    const pos = p.ui ? null : posOf(p, _p);
    let d = 0;
    if (pos) {
      if (h.px !== null && rdt > 0) { // smoothed source velocity (units per real second), for doppler
        const k = Math.min(1, rdt * 6), ix = (pos.x - h.px) / rdt, iy = (pos.y - h.py) / rdt, iz = (pos.z - h.pz) / rdt;
        if (Math.abs(ix) + Math.abs(iy) + Math.abs(iz) < 600) { h.vx += (ix - h.vx) * k; h.vy += (iy - h.vy) * k; h.vz += (iz - h.vz) * k; }
      }
      h.px = pos.x; h.py = pos.y; h.pz = pos.z;
      d = distTo(pos.x, pos.y, pos.z);
    }
    const level = (p.vol == null ? 1 : +p.vol) * (pos ? distGain(d, p.ref || def.ref) : 1);
    let v = h.voice;
    if (!v) {
      if (level < C.LOOP_IN || !room(def, h.name, level)) return;
      v = makeVoice(h.name, def, p, level, pos && { x: pos.x, y: pos.y, z: pos.z }, t + 0.01);
      if (!v) { h.stop(0); return; }
      v.end = Infinity; v.loop = h; h.voice = v; h.lr = 0;
      v.g.gain.setValueAtTime(0, t); v.g.gain.setTargetAtTime(v.lg || v.vol, t, 0.08); // fade in
    } else if (level < C.LOOP_OUT) { remove(v); return; }
    v.vol = p.vol == null ? 1 : +p.vol;
    if (pos) spatial(v, pos.x, pos.y, pos.z, t, 0.06);
    else { v.level = v.vol; if (Math.abs(v.vol - v.lg) > 1e-3) { v.g.gain.setTargetAtTime(v.vol, t, 0.08); v.lg = v.vol; } }
    let rate = (p.rate || 1) * (def.bus === 'ui' ? 1 : pitch);
    if (pos && p.doppler) rate *= doppler(_p, { x: h.vx, y: h.vy, z: h.vz });
    if (Math.abs(rate - h.lr) > 0.002 && v.inst && v.inst.set) { h.lr = rate; try { v.inst.set({ rate }); } catch (e) { S.errors++; } }
  }

  // ---------- ducking ----------
  let duckDepth = 0, duckEnd = 0;
  function duck(amount, secs, delay) { // briefly lower the ambience bus (big explosions)
    if (!live || !(amount > 0)) return;
    const t = ctx.currentTime + (delay || 0), a = clamp(amount, 0, 0.9);
    if (t < duckEnd && a <= duckDepth) return;
    duckDepth = a; duckEnd = t + (secs || 1.5);
    const g = M.duck.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(1 - a, t, 0.04); g.setTargetAtTime(1, t + 0.25, (secs || 1.5) / 3);
  }

  // ---------- per-frame ----------
  let lastT = -1, simRate = 0.5;
  function update(rdt) {
    if (!live) return;
    try {
      const t = ctx.currentTime, cam = WW.camera;
      if (cam) { // listener follows the camera
        cam.updateMatrixWorld();
        const e = cam.matrixWorld.elements, x = e[12], y = e[13], z = e[14];
        if (L.ok && rdt > 0) {
          const ix = (x - L.x) / rdt, iy = (y - L.y) / rdt, iz = (z - L.z) / rdt, k = Math.min(1, rdt * 5);
          if (Math.abs(ix) + Math.abs(iy) + Math.abs(iz) > 400) { L.vx = L.vy = L.vz = 0; } // a cut
          else { L.vx += (ix - L.vx) * k; L.vy += (iy - L.vy) * k; L.vz += (iz - L.vz) * k; }
        }
        L.x = x; L.y = y; L.z = z; L.ok = true;
        L.rx = e[0]; L.ry = e[1]; L.rz = e[2]; L.fx = -e[8]; L.fy = -e[9]; L.fz = -e[10];
      }
      if (lastT >= 0 && rdt > 0) simRate += (clamp((WW.time.now - lastT) / rdt, 0, 64) - simRate) * Math.min(1, rdt * 3);
      lastT = WW.time.now;
      // slow motion: pitch and the sfx filter drop smoothly with WW.time.warp
      slowF += ((WW.time.warp || 1) - slowF) * Math.min(1, rdt * 4);
      pitch = Math.pow(clamp(slowF, 0.1, 1), 0.45);
      const lp = slowF > 0.995 ? 20000 : Math.max(900, 20000 * Math.pow(slowF, 3.6));
      if (Math.abs(lp - lastLp) > lastLp * 0.01) { M.slow.frequency.setTargetAtTime(lp, t, 0.05); lastLp = lp; }
      for (let i = 0; i < loops.length; i++) updateLoop(loops[i], rdt, t);
      for (let i = voices.length - 1; i >= 0; i--) {
        const v = voices[i];
        if (v.loop) continue;
        if (t > v.end + 0.1) { voices.splice(i, 1); disc(v); continue; }
        if (v.pos) spatial(v, v.pos.x, v.pos.y, v.pos.z, t, 0.06);
      }
      for (let i = dying.length - 1; i >= 0; i--) if (t > dying[i].end) { disc(dying[i]); dying.splice(i, 1); }
      for (let i = 0; i < hooks.length; i++) { try { hooks[i](rdt); } catch (e) { S.errors++; } }
    } catch (e) { S.errors++; }
  }

  // ---------- test / tooling ----------
  let an = null, abuf = null;
  // peak / rms / NaN of the master output over the last ~0.68 s (analyser made on first call)
  function meter() {
    if (!ctx) return null;
    if (!an) { an = ctx.createAnalyser(); an.fftSize = 32768; abuf = new Float32Array(an.fftSize); M.trim.connect(an); }
    an.getFloatTimeDomainData(abuf);
    let pk = 0, s = 0, nan = false;
    for (let i = 0; i < abuf.length; i++) { const a = abuf[i]; if (a !== a) nan = true; else { const m = Math.abs(a); if (m > pk) pk = m; s += a * a; } }
    return { peak: pk, rms: Math.sqrt(s / abuf.length), nan };
  }
  // render one patch offline (no live context needed): resolves { peak, rms, dur, nan, buffer }
  function renderOffline(name, params, secs) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, def = patches[name];
    if (!OAC || !def) return Promise.resolve(null);
    secs = secs || 4;
    const oc = new OAC(2, Math.ceil(48000 * secs), 48000), out = oc.createGain();
    out.connect(oc.destination);
    const p = Object.assign({}, def.params, params, { t: 0.01, dist: 0 }); p.rate = (params && params.rate) || 1;
    let inst = null;
    try { inst = def.build(oc, out, p); } catch (e) { return Promise.reject(e); }
    if (inst && inst.stop && secs > 1) inst.stop(secs - 0.3);
    return oc.startRendering().then(buf => {
      const d = buf.getChannelData(0); let pk = 0, s = 0, nan = false, last = 0;
      for (let i = 0; i < d.length; i++) { const a = d[i]; if (a !== a) { nan = true; continue; } const m = Math.abs(a); if (m > pk) pk = m; s += a * a; if (m > 0.001) last = i; }
      return { peak: pk, rms: Math.sqrt(s / d.length), dur: last / buf.sampleRate, nan, buffer: buf };
    });
  }

  WW.on('roundStart', () => stopAll(0.5));
  WW.on('setupStart', () => stopAll(0.5));

  WW.audio = {
    C, SOUND_SPEED: C.SOUND_SPEED, available: !!AC, listener: L, patches,
    get enabled() { return enabled; }, get pending() { return pending; }, get live() { return live; },
    get volume() { return volume; }, get ctx() { return ctx; }, get pitch() { return pitch; }, get simRate() { return simRate; },
    init() {}, update, register, play, loop, stopAll, duck, doppler, delayFor, distGain, distTo,
    onUpdate(fn) { hooks.push(fn); },
    setEnabled(b) { return b ? start() : (stopEngine(), false); },
    toggle() { return pending || !enabled ? start() : (stopEngine(), false); },
    setVolume(v) {
      volume = clamp(+v || 0, 0, 1); save();
      if (ctx && enabled) try { M.master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.05); } catch (e) {}
    },
    stats() { let nodes = 0, lv = 0; for (const v of voices) { nodes += v.nodes; if (v.loop) lv++; }
      return Object.assign({ voices: voices.length, loopVoices: lv, loops: loops.length, dying: dying.length, liveNodes: nodes, state: ctx ? ctx.state : 'none' }, S); },
    meter, renderOffline
  };
})(window.WW);
