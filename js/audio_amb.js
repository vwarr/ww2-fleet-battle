// audio_amb.js: the world's ambience, the UI sounds and the cinematic cues (no music). See docs/AUDIO.md.
//   amb.sea     loop  open-ocean swell + wash; lapping and slaps near the water, broad soft hiss high up; wind roughens it
//   amb.wind    loop  gusty wind; louder with altitude and wind speed, a gentle whistle high up
//   amb.surf    loop  positional, waves breaking on the nearest shores, reefs and sandbars (one handle per shore cluster)
//   amb.rumble  loop  far-off battle thunder; its level follows the battle intensity (shots, hits, sinkings, planes)
//   amb.thud    shot  one distant boom from the direction of the fight (wide shots of a busy battle)
//   amb.gull    shot  1-4 soft gull calls near an island, when the camera is low and the fight nearby is quiet
//   cine.slow   shot  low "whoomp" + swell when slow motion starts (WW.time.warp drops)
//   cine.whoosh shot  very soft air whoosh on a director cut from a wide shot to a close one
//   cine.bell   shot  distant, reverberant ship's bell: two strikes at round start (3 slow strikes for a stalemate)
//   cine.horn   shot  distant ship's horn, two long low blasts, on victory
//   ui.click / ui.toggle / ui.tick / ui.place / ui.remove / ui.error   panel and setup sounds (events from ui.js)
// The slow modulation comes from "control" buffers (smooth random curves at a low sample rate, minutes long,
// played at random offsets and rates), so the beds do not repeat audibly and also work in renderOffline.
// All world logic runs in one WW.audio.onUpdate hook (only while sound is live). Event handlers only bump counters.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.syn) return;
  const S = A.syn, R = S.rand;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------- control buffers (cached per context) ----------
  // 3 kHz keeps them small; the spec only promises 8 kHz and up (Firefox), so fall back to that
  let CTL_RATE = 3000;
  const cache = new WeakMap();
  function cbuf(ctx, key, secs, fill) {
    let c = cache.get(ctx); if (!c) cache.set(ctx, c = {});
    if (c[key]) return c[key];
    let b;
    try { b = ctx.createBuffer(1, Math.floor(CTL_RATE * secs), CTL_RATE); }
    catch (e) { CTL_RATE = 8000; b = ctx.createBuffer(1, Math.floor(CTL_RATE * secs), CTL_RATE); }
    fill(b.getChannelData(0), b.length);
    return (c[key] = b);
  }
  // smooth random curve in [-1, 1], knots every `lo..hi` s, cosine-interpolated, periodic (no seam)
  function drift(d, n, lo, hi) {
    const ks = []; let t = 0;
    while (t < n / CTL_RATE - hi) { ks.push([t * CTL_RATE, R(-1, 1)]); t += R(lo, hi); }
    ks.push([n, ks[0][1]]);
    for (let k = 0; k < ks.length - 1; k++) {
      const [a, va] = ks[k], [b, vb] = ks[k + 1];
      for (let i = Math.floor(a); i < Math.min(n, b); i++) { const u = (i - a) / (b - a); d[i] = va + (vb - va) * (0.5 - 0.5 * Math.cos(Math.PI * u)); }
    }
  }
  // a train of envelopes: every lo..hi s an event of random size; attack (smoothstep) a, exponential decay tau. Periodic.
  function events(d, n, lo, hi, a0, a1, tau0, tau1, skew) {
    for (let i = 0; i < n; i++) d[i] = 0;
    let t = R(0, lo);
    while (t < n / CTL_RATE) {
      const amp = Math.pow(R(0.25, 1), skew || 1), a = R(a0, a1), tau = R(tau0, tau1), i0 = Math.floor(t * CTL_RATE);
      const len = Math.floor((a + tau * 5) * CTL_RATE);
      for (let k = 0; k < len; k++) {
        const s = k / CTL_RATE, e = s < a ? sm(0, a, s) : Math.exp(-(s - a) / tau);
        d[(i0 + k) % n] += amp * e;
      }
      t += R(lo, hi);
    }
  }
  const CTL = {
    drift: c => cbuf(c, 'drift', 240, (d, n) => drift(d, n, 1.8, 5.5)),             // slow swells, gust curves
    gust: c => cbuf(c, 'gust', 200, (d, n) => { drift(d, n, 1.2, 4.5); for (let i = 0; i < n; i++) { const u = (d[i] + 1) / 2; d[i] = u * u * u; } }), // 0..1, mostly low, bursts
    lap: c => cbuf(c, 'lap', 61, (d, n) => events(d, n, 0.35, 1.6, 0.03, 0.09, 0.08, 0.22, 1.4)),  // water lapping on a hull
    surf: c => cbuf(c, 'surf', 127, (d, n) => events(d, n, 6.5, 11, 0.7, 1.4, 0.9, 1.6, 0.8)),    // waves breaking
    foam: c => cbuf(c, 'foam', 127, (d, n) => events(d, n, 6.5, 11, 1.2, 2.0, 2.2, 3.4, 0.8)),    // the hiss of foam running back
    thunder: c => cbuf(c, 'thunder', 173, (d, n) => events(d, n, 1.2, 6, 0.05, 0.3, 0.6, 2.2, 1.6)) // far-off gunfire rolls
  };
  function ctlSrc(ctx, buf, t, rate) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate || 1;
    s.start(t, Math.random() * buf.duration * 0.95); return s;
  }
  function mod(ctx, src, depth, param) { const g = ctx.createGain(); g.gain.value = depth; src.connect(g); g.connect(param); return g; }
  function fadeOut(param, tt, tc) {
    try { if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(tt); else param.cancelScheduledValues(tt); param.setTargetAtTime(0, tt, tc); } catch (e) {}
  }
  // loop return value: master gain fades in over `fin` s, stop() fades out then stops every source
  function loopApi(ctx, m, t, fin, srcs, noise, set) {
    m.gain.setValueAtTime(0, t); m.gain.linearRampToValueAtTime(1, t + fin);
    return {
      dur: Infinity,
      set(q) {
        if (q.rate) { const now = ctx.currentTime; for (const s of noise) s.playbackRate.setTargetAtTime(q.rate, now, 0.1); }
        if (set) set(q, ctx.currentTime);
      },
      stop(tt) { fadeOut(m.gain, tt, 0.03); for (const s of srcs) try { s.stop(tt + 0.2); } catch (e) {} }
    };
  }
  // a dark outdoor reverb for the distant cues (bell, horn): one impulse per context
  function longVerb(ctx) {
    let c = cache.get(ctx); if (!c) cache.set(ctx, c = {});
    if (!c.verb) {
      const n = Math.floor(ctx.sampleRate * 4), b = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch); let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / ctx.sampleRate, k = 0.55 + 0.42 * Math.min(1, t / 2.5);
          lp += (Math.random() * 2 - 1 - lp) * (1 - k);
          d[i] = lp * Math.exp(-t * 1.5) * sm(0, 0.04, t) * 1.6;
        }
      }
      c.verb = b;
    }
    const v = ctx.createConvolver(); v.buffer = c.verb; return v;
  }
  function stopAllOf(list) { return tt => { for (const s of list) try { s.stop(tt); } catch (e) {} }; }

  // ======================= ambience =======================
  // amb.sea { height (camera y), wind 0..1 (roughness), calm 0..1, rate }
  A.register('amb.sea', {
    bus: 'ambience', max: 1, dur: Infinity, params: { height: 40, wind: 0.5, calm: 1 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out), noise = [], srcs = [];
      const nz = (k, r) => { const s = S.src(ctx, k, t, { rate: r || 1 }); noise.push(s); srcs.push(s); return s; };
      const cs = (b, r) => { const s = ctlSrc(ctx, b, t, r); srcs.push(s); return s; };
      // deep swell: brown noise, slowly breathing
      const swLp = S.filter(ctx, 'lowpass', 380, 0.6), swell = S.gain(ctx, 0.42, m); swLp.connect(swell); nz('brown').connect(swLp);
      mod(ctx, cs(CTL.drift(ctx), R(0.9, 1.1)), 0.24, swell.gain);
      // wash: mid pink noise, out of step with the swell; two of them panned apart for width
      const wash = [];
      for (const side of [-0.55, 0.55]) {
        const pn = ctx.createStereoPanner(); pn.pan.value = side; pn.connect(m);
        const bp = S.filter(ctx, 'bandpass', 850, 0.7), g = S.gain(ctx, 0.11, pn); bp.connect(g); nz('pink', R(0.96, 1.04)).connect(bp);
        mod(ctx, cs(CTL.drift(ctx), R(1.2, 1.6)), 0.07, g.gain);
        wash.push({ bp, g });
      }
      // broad soft hiss (high up: the whole sea surface far below)
      const hHp = S.filter(ctx, 'highpass', 1400, 0.5), hLp = S.filter(ctx, 'lowpass', 5200, 0.5), hiss = S.gain(ctx, 0.04, m);
      hHp.connect(hLp); hLp.connect(hiss); nz('pink').connect(hHp);
      mod(ctx, cs(CTL.drift(ctx), R(0.5, 0.7)), 0.015, hiss.gain);
      // lapping + slaps close to the water: event envelopes on band-passed and low noise, left and right
      const laps = [];
      for (const side of [-0.6, 0.6]) {
        const pn = ctx.createStereoPanner(); pn.pan.value = side; pn.connect(m);
        const lvl = S.gain(ctx, 0, pn);
        const bp = S.filter(ctx, 'bandpass', 1150, 1.1), gs = S.gain(ctx, 0, lvl); bp.connect(gs); nz('pink', R(0.95, 1.05)).connect(bp);
        const lp = S.filter(ctx, 'lowpass', 320, 0.7), gp = S.gain(ctx, 0, lvl); lp.connect(gp); nz('brown').connect(lp);
        const env = cs(CTL.lap(ctx), R(0.85, 1.15));
        mod(ctx, env, 0.32, gs.gain); mod(ctx, env, 0.55, gp.gain);
        laps.push(lvl);
      }
      const api = loopApi(ctx, m, t, 1.5, srcs, noise, (q, now) => {
        const h = Math.max(0, q.height != null ? q.height : p.height), w = clamp(q.wind != null ? q.wind : p.wind, 0, 1);
        const near = 1 - sm(4, 45, h), far = sm(25, 220, h), tc = q.snap ? 0.01 : 0.6;
        swLp.frequency.setTargetAtTime(380 - 200 * far + 80 * w, now, tc);
        swell.gain.setTargetAtTime(0.42 * (1 - 0.35 * far), now, tc);
        for (const k of wash) { k.bp.frequency.setTargetAtTime(850 - 350 * far + 250 * w, now, tc); k.g.gain.setTargetAtTime(0.11 * (0.75 + 0.5 * w) * (1 - 0.3 * far), now, tc); }
        hiss.gain.setTargetAtTime(0.035 + 0.05 * far + 0.025 * w, now, tc);
        for (const l of laps) l.gain.setTargetAtTime(near * (0.7 + 0.6 * w), now, tc);
      });
      api.set(Object.assign({ snap: true }, p));
      return api;
    }
  });

  // amb.wind { height, wind 0..1, rate }
  A.register('amb.wind', {
    bus: 'ambience', max: 1, dur: Infinity, params: { height: 40, wind: 0.5 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out), noise = [], srcs = [];
      const nz = (k, r) => { const s = S.src(ctx, k, t, { rate: r || 1 }); noise.push(s); srcs.push(s); return s; };
      const cs = (b, r) => { const s = ctlSrc(ctx, b, t, r); srcs.push(s); return s; };
      const lvl = S.gain(ctx, 0.5, m);
      // two gust bands, each with its own gust curve, panned apart; the gust also lifts the band's pitch
      const bands = [];
      for (const [f, q, pan, depth] of [[330, 0.9, -0.45, 0.9], [760, 1.4, 0.45, 0.5]]) {
        const pn = ctx.createStereoPanner(); pn.pan.value = pan; pn.connect(lvl);
        const bp = S.filter(ctx, 'bandpass', f, q), g = S.gain(ctx, depth * 0.15, pn); bp.connect(g); nz('pink', R(0.95, 1.05)).connect(bp);
        const gs = cs(CTL.gust(ctx), R(0.8, 1.25));
        mod(ctx, gs, depth, g.gain); mod(ctx, gs, f * 0.45, bp.frequency);
        bands.push(bp);
      }
      // whistle at height: a narrow resonance that bends with the gusts
      const wbp = S.filter(ctx, 'bandpass', 1350, 22), wg = S.gain(ctx, 0, lvl); wbp.connect(wg); nz('white').connect(wbp);
      const wctl = cs(CTL.gust(ctx), R(0.7, 0.9));
      mod(ctx, wctl, 420, wbp.frequency);
      const wdepth = mod(ctx, wctl, 0, wg.gain);
      const api = loopApi(ctx, m, t, 2.5, srcs, noise, (q, now) => {
        const h = Math.max(0, q.height != null ? q.height : p.height), w = clamp(q.wind != null ? q.wind : p.wind, 0, 1);
        const alt = sm(20, 200, h), tc = q.snap ? 0.01 : 1;
        lvl.gain.setTargetAtTime(1.5 * (0.35 + 0.65 * w) * (0.45 + 0.75 * alt), now, tc);
        wdepth.gain.setTargetAtTime(1.6 * sm(50, 220, h) * (0.5 + 0.5 * w), now, tc);
      });
      api.set(Object.assign({ snap: true }, p));
      return api;
    }
  });

  // amb.surf (positional) { size 0.3..1 }
  A.register('amb.surf', {
    bus: 'ambience', ref: 22, max: 3, reverb: 0.2, dur: Infinity, params: { size: 1 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out), noise = [], srcs = [], k = clamp(p.size || 1, 0.2, 1.5);
      const nz = (kind, r) => { const s = S.src(ctx, kind, t, { rate: r || 1 }); noise.push(s); srcs.push(s); return s; };
      const rate = R(0.88, 1.12), off = Math.random() * 120;
      const env = (b) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(t, off); srcs.push(s); return s; };
      const crash = env(CTL.surf(ctx)), foam = env(CTL.foam(ctx));
      // the wave breaking: pink noise whose low-pass opens with the crash, plus a soft body thump
      const cLp = S.filter(ctx, 'lowpass', 500, 0.6), cg = S.gain(ctx, 0, m); cLp.connect(cg); nz('pink').connect(cLp);
      mod(ctx, crash, 0.42 * k, cg.gain); mod(ctx, crash, 2200, cLp.frequency);
      const bLp = S.filter(ctx, 'lowpass', 180, 0.7), bg = S.gain(ctx, 0, m); bLp.connect(bg); nz('brown').connect(bLp);
      mod(ctx, crash, 0.5 * k, bg.gain);
      // the foam hissing back down the beach
      const fBp = S.filter(ctx, 'bandpass', 2300, 0.55), fg = S.gain(ctx, 0, m); fBp.connect(fg); nz('white').connect(fBp);
      mod(ctx, foam, 0.09 * k, fg.gain);
      // a constant small wash
      const wBp = S.filter(ctx, 'bandpass', 650, 0.6); wBp.connect(S.gain(ctx, 0.05 * k, m)); nz('pink').connect(wBp);
      return loopApi(ctx, m, t, 1.2, srcs, noise, null);
    }
  });

  // amb.rumble { } : the level is the handle's vol (battle intensity)
  A.register('amb.rumble', {
    bus: 'ambience', max: 1, dur: Infinity,
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out), noise = [], srcs = [];
      const nz = (kind, r) => { const s = S.src(ctx, kind, t, { rate: r || 1 }); noise.push(s); srcs.push(s); return s; };
      const bed = S.filter(ctx, 'lowpass', 95, 0.7), bg = S.gain(ctx, 0.35, m); bed.connect(bg); nz('brown', 0.8).connect(bed);
      const th = ctlSrc(ctx, CTL.thunder(ctx), t, R(0.9, 1.1)); srcs.push(th);
      for (const [pan, r] of [[-0.5, 1], [0.5, 1.13]]) { // two rolling layers, panned apart
        const pn = ctx.createStereoPanner(); pn.pan.value = pan; pn.connect(m);
        const lp = S.filter(ctx, 'lowpass', 140, 0.8), g = S.gain(ctx, 0, pn); lp.connect(g); nz('brown', 0.9).connect(lp);
        const e = r === 1 ? th : ctlSrc(ctx, CTL.thunder(ctx), t, r); if (e !== th) srcs.push(e);
        mod(ctx, e, 0.85, g.gain); mod(ctx, e, 160, lp.frequency);
      }
      const rl = S.filter(ctx, 'lowpass', 380, 0.5), rg = S.gain(ctx, 0, m); rl.connect(rg); nz('pink', 0.7).connect(rl);
      mod(ctx, th, 0.06, rg.gain);
      return loopApi(ctx, m, t, 2, srcs, noise, null);
    }
  });

  A.register('amb.thud', {
    bus: 'ambience', ref: 260, max: 3, minGap: 0.6, reverb: 0.7, dur: 3.5,
    build(ctx, out, p) {
      return S.done(p, [
        S.boom(ctx, out, p.t, { f0: R(42, 58), f1: 26, dur: R(1.8, 2.8), gain: 0.42, body: 0.9, crack: 0, bright: 0.25, rate: p.rate }),
        S.burst(ctx, out, p.t + 0.08, { noise: 'brown', type: 'lowpass', f: 260, f1: 90, q: 0.5, a: 0.12, d: 1.6, gain: 0.28, rate: p.rate })
      ]);
    }
  });

  // amb.gull (positional) { n calls, f base pitch }
  A.register('amb.gull', {
    bus: 'ambience', ref: 45, max: 2, minGap: 2, reverb: 0.4, dur: 3, params: { n: 0, f: 0 },
    build(ctx, out, p) {
      const k = p.rate || 1, n = p.n || 1 + Math.floor(Math.random() * 4), f0 = (p.f || R(1250, 1550)) * k;
      const lp = S.filter(ctx, 'lowpass', 3600, 0.6, out), bp = S.filter(ctx, 'bandpass', 2300, 1.6), bg = S.gain(ctx, 0.5, lp); bp.connect(bg);
      const srcs = []; let t = p.t;
      for (let i = 0; i < n; i++) {
        const d = (i === 0 ? R(0.32, 0.45) : R(0.18, 0.3)) / k, g = S.gain(ctx, 0, lp), gh = S.gain(ctx, 0, bp);
        const o = ctx.createOscillator(), oh = ctx.createOscillator(); o.type = 'triangle'; oh.type = 'sawtooth';
        const fa = f0 * R(0.97, 1.03), path = [[0, 0.82], [0.12, 1.32], [0.35, 1.25], [1, 0.78]];
        for (const os of [o, oh]) {
          os.frequency.setValueAtTime(fa * path[0][1], t);
          for (let j = 1; j < path.length; j++) os.frequency.exponentialRampToValueAtTime(fa * path[j][1], t + d * path[j][0]);
        }
        const vib = ctx.createOscillator(); vib.frequency.value = R(22, 30); mod(ctx, vib, fa * 0.025, o.frequency); mod(ctx, vib, fa * 0.025, oh.frequency);
        const amp = 0.24 * (i === 0 ? 1 : R(0.6, 0.9));
        for (const [gg, pk] of [[g, amp], [gh, amp * 0.18]]) {
          gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(pk, t + 0.03 / k);
          gg.gain.setTargetAtTime(pk * 0.7, t + 0.05 / k, d * 0.3); gg.gain.setTargetAtTime(0, t + d * 0.75, d * 0.1);
        }
        o.connect(g); oh.connect(gh);
        for (const os of [o, oh, vib]) { os.start(t); os.stop(t + d + 0.1); srcs.push(os); }
        t += d + R(0.12, 0.28) / k;
      }
      return { dur: t - p.t + 0.2, stop: stopAllOf(srcs) };
    }
  });

  // ======================= cinematic =======================
  A.register('cine.slow', { // slow motion starts: a low whoomp with a swell under it (ui bus: not pitched or filtered again)
    bus: 'ui', max: 1, minGap: 3, dur: 3,
    build(ctx, out, p) {
      const t = p.t, srcs = [], g = S.gain(ctx, 0, out), o = ctx.createOscillator();
      o.frequency.setValueAtTime(74, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.9);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.05); g.gain.setTargetAtTime(0, t + 0.12, 0.35);
      o.connect(g); o.start(t); o.stop(t + 2.2); srcs.push(o);
      const parts = [
        S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 160, f1: 60, q: 0.6, a: 0.35, d: 2.2, gain: 0.5 }),
        S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: 900, f1: 180, q: 0.8, a: 0.08, d: 0.9, gain: 0.07 })
      ];
      return { dur: 2.6, stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} for (const q of parts) q.stop(tt); } };
    }
  });

  A.register('cine.whoosh', { // soft air past the lens on a wide -> close cut
    bus: 'ui', max: 1, minGap: 4, dur: 1.6,
    build(ctx, out, p) {
      const t = p.t, pn = ctx.createStereoPanner(), dir = Math.random() < 0.5 ? -1 : 1; pn.connect(out);
      pn.pan.setValueAtTime(-0.6 * dir, t); pn.pan.linearRampToValueAtTime(0.6 * dir, t + 1.1);
      const bp = S.filter(ctx, 'bandpass', 380, 1.1), g = S.gain(ctx, 0, pn); bp.connect(g);
      bp.frequency.setValueAtTime(380, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.45); bp.frequency.exponentialRampToValueAtTime(520, t + 1.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.42, t + 0.42); g.gain.setTargetAtTime(0, t + 0.5, 0.22);
      const s = S.src(ctx, 'pink', t); s.connect(bp); s.stop(t + 1.6);
      return { dur: 1.5, stop(tt) { try { s.stop(tt); } catch (e) {} } };
    }
  });

  // cine.bell { strikes 2, gap s } : a ship's bell far across the water, with its own long reverb
  A.register('cine.bell', {
    bus: 'ambience', max: 1, minGap: 2, dur: 8, params: { strikes: 2, gap: 0.42 },
    build(ctx, out, p) {
      const k = p.rate || 1, f = 712 * k, dry = S.gain(ctx, 0.45, out), verb = longVerb(ctx), wet = S.gain(ctx, 0.5, out);
      const lp = S.filter(ctx, 'lowpass', 3200, 0.5); lp.connect(dry); lp.connect(verb); verb.connect(wet);
      const P = [[0.5, 0.3, 5], [1, 1, 3.6], [1.19, 0.55, 2.8], [1.5, 0.3, 2.2], [2, 0.42, 1.8], [2.51, 0.18, 1.2], [2.66, 0.14, 1.0], [3.01, 0.1, 0.8], [4.07, 0.05, 0.5]];
      const srcs = []; let end = 0;
      for (let i = 0; i < (p.strikes || 2); i++) {
        const t = p.t + i * (p.gap || 0.42) / k, amp = 0.13 * (i ? 0.85 : 1);
        for (const [r, a, dec] of P) for (const det of r === 1 || r === 2 ? [0, 1.3] : [0]) {
          const o = ctx.createOscillator(), g = S.gain(ctx, 0, lp); o.frequency.value = f * r + det;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * a * (det ? 0.6 : 1), t + 0.004);
          g.gain.setTargetAtTime(0, t + 0.004, dec / 4.5);
          o.connect(g); o.start(t); o.stop(t + dec * 1.3); srcs.push(o); end = Math.max(end, t + dec * 1.3);
        }
        srcs.push(S.burst(ctx, lp, t, { type: 'bandpass', f: 3000, q: 1.2, a: 0.001, d: 0.015, gain: 0.05 }));
      }
      return { dur: end - p.t + 3.5, stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } };
    }
  });

  // cine.horn : two long low blasts from a distant ship, with its own long reverb (not a fanfare)
  A.register('cine.horn', {
    bus: 'ambience', max: 1, minGap: 4, dur: 10,
    build(ctx, out, p) {
      const k = p.rate || 1, f = 96 * k, dry = S.gain(ctx, 0.5, out), verb = longVerb(ctx), wet = S.gain(ctx, 0.55, out);
      const lp = S.filter(ctx, 'lowpass', 760, 0.9); lp.connect(dry); lp.connect(verb); verb.connect(wet);
      const srcs = []; let t = p.t;
      for (const hold of [2.1, 1.4]) {
        const g = S.gain(ctx, 0, lp);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.3); g.gain.setValueAtTime(0.16, t + hold); g.gain.setTargetAtTime(0, t + hold, 0.18);
        for (const [type, mult, a, det] of [['sawtooth', 1, 1, 0], ['sawtooth', 1, 0.7, 0.6], ['square', 2, 0.25, -0.4]]) {
          const o = ctx.createOscillator(), og = S.gain(ctx, a, g); o.type = type;
          o.frequency.setValueAtTime(f * mult * 0.93 + det, t); o.frequency.setTargetAtTime(f * mult + det, t, 0.12);
          o.connect(og); o.start(t); o.stop(t + hold + 1.2); srcs.push(o);
        }
        t += hold + 0.9;
      }
      return { dur: t - p.t + 3.5, stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } };
    }
  });

  // ======================= UI =======================
  A.register('ui.click', { // soft tactile tick: a woody body + a short bright edge
    bus: 'ui', max: 4, minGap: 0.03, dur: 0.12,
    build(ctx, out, p) {
      return S.done(p, [
        S.tone(ctx, out, p.t, { f: 720, f1: 520, a: 0.001, d: 0.035, gain: 0.34 }),
        S.burst(ctx, out, p.t, { type: 'bandpass', f: 2600, q: 1.4, a: 0.0008, d: 0.012, gain: 0.16 })
      ]);
    }
  });
  A.register('ui.toggle', { // { on }: two quick ticks, rising for on, falling for off
    bus: 'ui', max: 2, minGap: 0.05, dur: 0.2, params: { on: true },
    build(ctx, out, p) {
      const a = p.on ? 620 : 900, b = p.on ? 900 : 620;
      return S.done(p, [
        S.tone(ctx, out, p.t, { f: a, a: 0.001, d: 0.03, gain: 0.26 }),
        S.tone(ctx, out, p.t + 0.06, { f: b, a: 0.001, d: 0.035, gain: 0.26 }),
        S.burst(ctx, out, p.t, { type: 'bandpass', f: 2600, q: 1.4, a: 0.0008, d: 0.01, gain: 0.1 })
      ]);
    }
  });
  A.register('ui.tick', { // { v 0..1 }: volume slider detent, a little higher with the value
    bus: 'ui', max: 2, minGap: 0.06, dur: 0.06, params: { v: 0.5 },
    build(ctx, out, p) {
      return S.done(p, [S.tone(ctx, out, p.t, { f: 900 + 700 * clamp(p.v, 0, 1), a: 0.001, d: 0.02, gain: 0.2 })]);
    }
  });
  A.register('ui.place', { // a ship set on the water: a small splash and a plip
    bus: 'ui', max: 3, minGap: 0.05, dur: 0.6,
    build(ctx, out, p) {
      return S.done(p, [
        S.burst(ctx, out, p.t, { noise: 'pink', type: 'bandpass', f: 1600, f1: 500, q: 0.9, a: 0.004, d: 0.32, gain: 0.32 }),
        S.burst(ctx, out, p.t, { noise: 'brown', type: 'lowpass', f: 380, q: 0.6, a: 0.003, d: 0.16, gain: 0.3 }),
        S.tone(ctx, out, p.t + 0.03, { f: 420, f1: 980, glide: 0.8, a: 0.002, d: 0.07, gain: 0.12 })
      ]);
    }
  });
  A.register('ui.remove', { // a ship taken off: a soft wooden thunk
    bus: 'ui', max: 3, minGap: 0.05, dur: 0.3,
    build(ctx, out, p) {
      return S.done(p, [
        S.tone(ctx, out, p.t, { f: 170, f1: 95, a: 0.002, d: 0.14, gain: 0.5 }),
        S.burst(ctx, out, p.t, { noise: 'brown', type: 'lowpass', f: 600, q: 0.7, a: 0.001, d: 0.06, gain: 0.3 })
      ]);
    }
  });
  A.register('ui.error', { // "nope": two soft low falling tones
    bus: 'ui', max: 1, minGap: 0.25, dur: 0.45,
    build(ctx, out, p) {
      const lp = S.filter(ctx, 'lowpass', 1100, 0.5, out);
      return S.done(p, [
        S.tone(ctx, lp, p.t, { type: 'triangle', f: 300, a: 0.006, d: 0.11, gain: 0.42 }),
        S.tone(ctx, lp, p.t + 0.13, { type: 'triangle', f: 228, f1: 214, a: 0.006, d: 0.2, gain: 0.42 })
      ]);
    }
  });

  // ======================= wiring =======================
  const sea = A.loop('amb.sea', { ui: true, vol: 0.85, persist: true });
  const wind = A.loop('amb.wind', { ui: true, vol: 0.35, persist: true });
  const rumble = A.loop('amb.rumble', { ui: true, vol: 0, persist: true });
  const st = { heat: 0, cx: 240, cz: 150, calm: 1, inten: 0, planes: 0, planeT: 0, slowArm: true, lx: 0, ly: 0, lz: 0, lok: false,
               quietUntil: 0, gullT: 8, thudT: 3, slowT: 0, setT: 0, seed: -1, surf: [], land: [], counts: {} };
  WW.ambState = st; // read-only debug view for the tests
  const count = n => { st.counts[n] = (st.counts[n] || 0) + 1; };
  const now = () => performance.now() / 1000;
  function play(n, o) { const v = A.play(n, o); if (v) count(n); return v; }
  // battle intensity: events add heat (decays over ~12 s real time) and move the battle centroid
  function heat(h, x, z) {
    if (!A.live) return;
    st.heat += h;
    if (x != null && isFinite(x)) { const k = Math.min(1, h * 0.15); st.cx += (x - st.cx) * k; st.cz += (z - st.cz) * k; }
  }
  WW.on('shellFired', e => heat(e.cal === 'big' ? 0.45 : 0.15, e.x, e.z));
  WW.on('weaponImpact', e => heat(0.8, e.x, e.z));
  WW.on('shipSunk', s => heat(3, s && s.x, s && s.z));
  WW.on('planeKill', e => heat(1, e && e.victim && e.victim.x, e && e.victim && e.victim.z));
  WW.on('roundStart', () => {
    st.heat = 0; st.quietUntil = now() + 1.5; // a new map is noticed by WW.terrain.seed
    if (A.live) play('cine.bell', { ui: true, delay: 0.7, vol: 0.9 });
  });
  WW.on('setupStart', () => { st.heat = 0; st.quietUntil = now() + 1.5; });
  WW.on('victory', d => {
    if (!A.live) return;
    if (d && d.winner) play('cine.horn', { ui: true, delay: 1.2, vol: 0.9 });
    else play('cine.bell', { ui: true, delay: 1.2, strikes: 3, gap: 1.1, vol: 0.8 });
  });
  // UI events (ui.js emits them; nothing here runs while sound is off because play() is a no-op)
  WW.on('uiPlace', () => play('ui.place', { ui: true }));
  WW.on('uiRemove', () => play('ui.remove', { ui: true }));
  WW.on('uiError', () => play('ui.error', { ui: true }));
  WW.on('uiToggle', d => play('ui.toggle', { ui: true, on: !!(d && d.on) }));
  WW.on('uiVolume', d => play('ui.tick', { ui: true, v: d ? d.v : 0.5 }));

  // shore scan for a map: surf sites (shallow water at a coast, reef or bar) and land points (gulls)
  function scanShores() {
    for (const s of st.surf) s.h.stop(1.5);
    st.surf = []; st.land = [];
    const T = WW.terrain; if (!T || !T.depthAt) return;
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, STEP = 3, CELL = 26, cells = new Map();
    for (let z = 1; z < H; z += STEP) for (let x = 1; x < W; x += STEP) {
      const d = T.depthAt(x, z);
      const kind = d < -0.4 ? 'land' : d < 1.7 ? 'surf' : null; if (!kind) continue;
      const key = kind + ((x / CELL) | 0) + ',' + ((z / CELL) | 0);
      let c = cells.get(key); if (!c) cells.set(key, c = { kind, x: 0, z: 0, n: 0 });
      c.x += x; c.z += z; c.n++;
    }
    for (const c of cells.values()) {
      if (c.n < 3) continue;
      const pos = { x: c.x / c.n, y: 0.5, z: c.z / c.n };
      if (c.kind === 'land') { st.land.push(pos); continue; }
      const w = clamp(Math.sqrt(c.n) / 7, 0.35, 1);
      st.surf.push({ pos, w, h: A.loop('amb.surf', { at: pos, vol: 0, size: w, persist: true }) });
    }
  }
  function nearestLand(x, z) {
    let best = null, bd = 1e9;
    for (const p of st.land) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best ? { p: best, d: bd } : null;
  }

  A.onUpdate(rdt => {
    const L = A.listener, t = now(), g = WW.game || {};
    // ---- cuts: a jump of the listener in one frame (the director's cross-fade cut) ----
    if (st.lok && rdt > 0) {
      const jump = Math.hypot(L.x - st.lx, L.y - st.ly, L.z - st.lz);
      if (jump > 35 && t > st.quietUntil && g.state === 'battle' && st.ly > 55 && L.y < 40) play('cine.whoosh', { ui: true, vol: 0.8 });
    }
    st.lx = L.x; st.ly = L.y; st.lz = L.z; st.lok = true;
    // ---- slow motion: the edge of WW.time.warp dropping ----
    const warp = WW.time.warp || 1;
    if (st.slowArm && warp < 0.9) { st.slowArm = false; if (play('cine.slow', { ui: true, vol: 0.85 })) A.duck(0.35, 2.2); }
    else if (!st.slowArm && warp > 0.98) st.slowArm = true;

    // ---- slower world logic, 5 times a second ----
    // (wall-clock, not rdt: main.js clamps rdt to 0.1 s, so slow frames would stretch the timers)
    if (t - st.setT < 0.2) return;
    const dt = Math.min(1, t - st.setT); st.setT = t;
    if (st.seed !== WW.terrain.seed) { st.seed = WW.terrain.seed; scanShores(); }
    st.heat *= Math.exp(-dt / 12);
    if ((st.planeT -= dt) <= 0) { st.planeT = 1; let n = 0; for (const p of WW.world.planes) if (p.alive) n++; st.planes = n; }
    const battle = g.state === 'battle';
    st.inten = battle ? 1 - Math.exp(-(st.heat + st.planes * 0.12) / 12) : 0; // ~0.65 for a busy 1x battle
    const calmT = battle ? 1 - st.inten : 1;
    st.calm += (calmT - st.calm) * Math.min(1, dt / 4);
    const h = Math.max(0, L.y), ws = WW.wind ? Math.hypot(WW.wind.x, WW.wind.z) : 0.7, rough = clamp((ws - 0.35) / 0.6, 0, 1);
    const far = sm(25, 220, h);
    // night (daylight.js): a hushed sea and lighter wind; rain (weather.js) near the camera adds to the wind's hiss
    const dl = WW.daylight === undefined ? 1 : WW.daylight, hush = 0.72 + 0.28 * dl, wet = WW.skyTime ? WW.skyTime.wx() : 0;
    sea.set({ vol: 0.85 * (0.8 + 0.25 * st.calm) * (1 - 0.35 * far) * hush, height: h, wind: Math.min(1, rough + 0.4 * wet) });
    wind.set({ vol: 0.35 * (0.8 + 0.3 * st.calm) * (0.8 + 0.2 * dl) * (1 + 0.8 * wet), height: h, wind: Math.min(1, rough + 0.5 * wet) });
    // distant rumble: louder on wide/high shots (close shots have the real guns)
    const dBattle = Math.hypot(st.cx - L.x, st.cz - L.z, L.y);
    rumble.set({ vol: 0.75 * st.inten * (0.45 + 0.55 * sm(60, 260, dBattle)) });
    if (battle && st.inten > 0.25 && dBattle > 160 && (st.thudT -= dt) <= 0) {
      st.thudT = R(1.2, 5) / st.inten;
      const a = Math.atan2(st.cz - L.z, st.cx - L.x) + R(-0.35, 0.35), r = Math.max(240, dBattle);
      play('amb.thud', { x: L.x + Math.cos(a) * r, y: 0, z: L.z + Math.sin(a) * r, vol: R(0.5, 1) * st.inten });
    }
    // surf: only the nearer shores (vol falls to 0 by ~190 units), the engine keeps the 3 loudest
    for (const s of st.surf) {
      const d = Math.hypot(s.pos.x - L.x, s.pos.z - L.z, L.y);
      s.h.set({ vol: s.w * Math.pow(1 - sm(50, 190, d), 1.5) * (0.85 + 0.3 * rough) });
    }
    // gulls: rare, low camera, near land, quiet nearby
    if ((st.gullT -= dt) <= 0) {
      st.gullT = R(14, 40);
      const nl = nearestLand(L.x, L.z);
      if (nl && h < 70 && nl.d < 140 && st.calm > 0.55 && dl > 0.5 && Math.random() < 0.75) { // no gulls after dusk
        const a = Math.random() * Math.PI * 2, r = R(4, 25);
        play('amb.gull', { x: nl.p.x + Math.cos(a) * r, y: R(10, 30), z: nl.p.z + Math.sin(a) * r, vol: R(0.5, 0.9) });
      }
    }
  });
})(window.WW);
