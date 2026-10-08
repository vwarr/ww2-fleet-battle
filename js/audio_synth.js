// audio_synth.js: WW.audio.syn, shared building blocks for patches (noise buffers, envelopes,
// filtered-noise bursts, booms, crackle, tones). Every builder takes the context as its first
// argument (live or offline), works in that context's time (t = start, in ctx seconds) and returns
// a part { end, stop(t) }. `rate` (default 1) works like tape speed: pitch x rate, times / rate.
// Use Math.random here, never WW.rand: sound must not change a seeded round.
window.WW = window.WW || {};
(function (WW) {
  if (!WW.audio) return;
  const cache = new WeakMap();
  const R = (a, b) => a + (b - a) * Math.random();
  const NOISE_SECS = 3;

  // noise buffers, made once per context: 'white' | 'pink' | 'brown' | 'crackle' (sparse clicks)
  function buf(ctx, kind) {
    let c = cache.get(ctx); if (!c) cache.set(ctx, c = {});
    if (c[kind]) return c[kind];
    const n = Math.floor(ctx.sampleRate * NOISE_SECS), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    if (kind === 'pink') { // Paul Kellet's refined filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    } else if (kind === 'brown') {
      let l = 0;
      for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
    } else if (kind === 'crackle') {
      for (let i = 0; i < n; i++) d[i] = 0;
      for (let i = 0; i < n; i += Math.floor(R(60, 1400))) { // a click every 1.5..30 ms, random size and polarity
        const a = Math.pow(Math.random(), 2.2) * (Math.random() < 0.5 ? -1 : 1), len = Math.floor(R(4, 40));
        for (let k = 0; k < len && i + k < n; k++) d[i + k] += a * Math.exp(-k / (len * 0.3)) * (k % 2 ? -0.6 : 1);
      }
    } else for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // smooth the loop seam
    const f = Math.min(2000, n >> 4); for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
    return (c[kind] = b);
  }
  // a started noise source (random offset, looping); o: { rate, dur }
  function src(ctx, kind, t, o) {
    o = o || {};
    const s = ctx.createBufferSource(); s.buffer = buf(ctx, kind || 'white'); s.loop = true;
    s.playbackRate.value = o.rate || 1;
    s.start(t, Math.random() * (NOISE_SECS - 0.1));
    if (o.dur) s.stop(t + o.dur);
    return s;
  }
  function gain(ctx, v, out) { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; if (out) g.connect(out); return g; }
  function filter(ctx, type, f, q, out) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; if (out) b.connect(out); return b;
  }
  // envelope on an AudioParam: linear attack to `peak`, decay to `s` x peak, hold, release.
  // o: { a=0.005, d=0.15, s=0, hold=0, r=0.2, peak=1 }. Returns the time the envelope is silent.
  function adsr(param, t, o) {
    const a = o.a != null ? o.a : 0.005, d = o.d != null ? o.d : 0.15, s = o.s || 0, pk = o.peak != null ? o.peak : 1;
    param.cancelScheduledValues(t); param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(pk, t + a);
    if (!s) { param.setTargetAtTime(0, t + a, d / 4); return t + a + d * 1.2; }
    param.setTargetAtTime(s * pk, t + a, d / 3);
    const tr = t + a + d + (o.hold || 0), r = o.r != null ? o.r : 0.2;
    param.setTargetAtTime(0, tr, r / 4);
    return tr + r * 1.2;
  }
  // filtered noise burst. o: { noise='white', type='bandpass', f=1000, f1 (sweep to), q=1, a, d, s, hold, r, gain=1, rate=1 }
  function burst(ctx, out, t, o) {
    o = o || {}; const k = o.rate || 1;
    const g = gain(ctx, 0, out), fl = filter(ctx, o.type || 'bandpass', (o.f || 1000) * k, o.q != null ? o.q : 1, g);
    const end = adsr(g.gain, t, { a: (o.a != null ? o.a : 0.003) / k, d: (o.d != null ? o.d : 0.2) / k, s: o.s, hold: (o.hold || 0) / k, r: (o.r != null ? o.r : 0.2) / k, peak: o.gain != null ? o.gain : 1 });
    if (o.f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * k), end);
    const s = src(ctx, o.noise || 'white', t, { rate: k }); s.connect(fl); s.stop(end + 0.05);
    return { end, stop(tt) { try { g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.02); s.stop(tt + 0.1); } catch (e) {} } };
  }
  // oscillator blip. o: { type='sine', f=440, f1 (glide to), a, d, s, hold, r, gain=1, rate=1 }
  function tone(ctx, out, t, o) {
    o = o || {}; const k = o.rate || 1;
    const g = gain(ctx, 0, out), os = ctx.createOscillator();
    os.type = o.type || 'sine'; os.frequency.setValueAtTime((o.f || 440) * k, t);
    const end = adsr(g.gain, t, { a: (o.a != null ? o.a : 0.004) / k, d: (o.d != null ? o.d : 0.12) / k, s: o.s, hold: (o.hold || 0) / k, r: (o.r != null ? o.r : 0.1) / k, peak: o.gain != null ? o.gain : 1 });
    if (o.f1) os.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1 * k), t + (end - t) * (o.glide || 0.6));
    os.connect(g); os.start(t); os.stop(end + 0.05);
    return { end, stop(tt) { try { g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.02); os.stop(tt + 0.1); } catch (e) {} } };
  }
  // explosion / gun body: a sine thump falling f0 -> f1, brown-noise rumble through a closing low-pass,
  // and an optional bright crack on top. o: { f0=80, f1=32, dur=1.5, gain=1, body=0.8, crack=0.4, bright=1, rate=1 }
  function boom(ctx, out, t, o) {
    o = o || {}; const k = o.rate || 1, dur = (o.dur || 1.5) / k, gn = o.gain != null ? o.gain : 1;
    const parts = [];
    parts.push(tone(ctx, out, t, { f: (o.f0 || 80) * R(0.94, 1.06), f1: o.f1 || 32, glide: 0.5, a: 0.004, d: dur * 0.55, gain: gn * 0.9, rate: k }));
    if ((o.body != null ? o.body : 0.8) > 0) {
      const g = gain(ctx, 0, out), lp = filter(ctx, 'lowpass', 2400 * (o.bright || 1) * k, 0.7, g);
      const end = adsr(g.gain, t, { a: 0.006, d: dur, peak: gn * (o.body != null ? o.body : 0.8) * 1.6 });
      lp.frequency.setTargetAtTime(140 * k, t + 0.02, dur * 0.25);
      const s = src(ctx, 'brown', t, { rate: k }); s.connect(lp); s.stop(end + 0.05);
      parts.push({ end, stop(tt) { try { g.gain.setTargetAtTime(0, tt, 0.02); s.stop(tt + 0.1); } catch (e) {} } });
    }
    const crack = o.crack != null ? o.crack : 0.4;
    if (crack > 0) parts.push(burst(ctx, out, t, { type: 'bandpass', f: 1800 * (o.bright || 1), f1: 500, q: 0.8, a: 0.001, d: 0.12, gain: gn * crack, rate: k }));
    return join(parts);
  }
  // crackle (fire, sparks, static). o: { dur (omit = until stop), f=2500, q=0.7, gain=1, density=1, rate=1 }
  function crackle(ctx, out, t, o) {
    o = o || {}; const k = o.rate || 1;
    const g = gain(ctx, o.gain != null ? o.gain : 1, out), fl = filter(ctx, 'bandpass', (o.f || 2500) * k, o.q != null ? o.q : 0.7, g);
    const s = src(ctx, 'crackle', t, { rate: (o.density || 1) * k }); s.connect(fl);
    let end = Infinity;
    if (o.dur) { end = t + o.dur / k; g.gain.setValueAtTime(g.gain.value, Math.max(t, end - 0.1)); g.gain.linearRampToValueAtTime(0, end); s.stop(end + 0.02); }
    return { end, gain: g, filter: fl, source: s, stop(tt) { try { g.gain.setTargetAtTime(0, tt, 0.03); s.stop(tt + 0.15); } catch (e) {} } };
  }
  // combine parts into the patch return value { dur, stop(t) } (dur measured from the earliest start)
  function join(parts, t0) {
    let end = 0; for (const p of parts) if (p.end > end) end = p.end;
    return { end, dur: t0 != null ? end - t0 : undefined, stop(tt) { for (const p of parts) p.stop(tt); } };
  }
  // the usual patch return for one-shots: join(parts) with dur from p.t
  function done(p, parts) { const j = join(parts, p.t); return { dur: j.dur, stop: j.stop }; }

  WW.audio.syn = { buf, src, gain, filter, adsr, burst, tone, boom, crackle, join, done, rand: R };
})(window.WW);
