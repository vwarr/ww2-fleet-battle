// audio_air.js: aircraft sounds (engines, wing guns, hits, ordnance release, deaths, carrier deck).
// Patches: plane.* bomb.* deck.* chute.* (list and triggers: docs/AUDIO.md "Aircraft").
// Wiring: almost everything is polled from WW.world.planes and the carrier decks in a WW.audio.onUpdate hook
// (it runs only while sound is on), plus the 'planeHit' (aircraft.js) and 'weaponDropped' / 'weaponImpact'
// (combat_weapons.js) events. Math.random only: sound never touches WW.rand.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.syn) return;
  const S = A.syn, R = S.rand;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (v == null || v !== v ? d : +v);
  const ENGINE_N = 7;        // nearest plane engines with real voices (per-patch loop cap)

  // ---------- shared synth parts ----------
  const waves = new WeakMap();
  // band-limited pulse train (duty d), harmonics rolled off by tilt^n: the "pulse-rich" firing tone
  function pulse(ctx, d, tilt) {
    let c = waves.get(ctx); if (!c) waves.set(ctx, c = {});
    const k = d + ':' + tilt; if (c[k]) return c[k];
    const n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 1; i < n; i++) re[i] = Math.sin(Math.PI * i * d) / i * Math.pow(tilt, i);
    return (c[k] = ctx.createPeriodicWave(re, im));
  }
  // waveshaper curve turning a pulse LFO into short one-sided gate spikes (one per shot)
  let gateCurve = null;
  function gate() {
    if (gateCurve) return gateCurve;
    gateCurve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 511 * 2 - 1; gateCurve[i] = x > 0.3 ? Math.pow((x - 0.3) / 0.7, 1.6) : 0; }
    return gateCurve;
  }
  function osc(ctx, type, f, t, out) {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = f; if (out) o.connect(out); o.start(t); return o;
  }
  // a water impact (splash, ditch, torpedo drop): thump + spray + falling patter. s = size
  function water(ctx, out, t, s, r, g) {
    const k = Math.sqrt(s);
    return [
      S.tone(ctx, out, t, { f: R(80, 100) / Math.sqrt(k), f1: 38, a: 0.006, d: 0.25 * k, gain: 0.45 * g, rate: r }),
      S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 700, f1: 140, q: 0.5, a: 0.01, d: 0.7 * k, gain: 0.55 * g, rate: r }),
      S.burst(ctx, out, t + 0.01 / r, { noise: 'pink', type: 'bandpass', f: 1500 * R(0.85, 1.15), f1: 380, q: 0.6, a: 0.015, d: 0.45 * k, gain: 0.45 * g, rate: r }),
      S.burst(ctx, out, t + 0.18 / r, { noise: 'pink', type: 'bandpass', f: 2100, f1: 900, q: 0.5, a: 0.2 * k, d: 0.8 * k, gain: 0.1 * g, rate: r })
    ];
  }

  // ---------- engines ----------
  // f: firing-tone base (Hz) at cruise, lope: rev-rate divisor (radial lump), twin: second row detune,
  // duty/tilt: pulse shape, body/sub/chuff/wind: mix, chf: exhaust band (x f)
  const ENG = {
    wildcat: { f: 82, lope: 7, twin: 1.009, duty: 0.2, tilt: 0.9, body: 0.3, sub: 0.16, chuff: 0.5, chf: 2.4, wind: 0.2, lump: 0.32 }, // P&W twin-row: thick, beating
    zero:    { f: 101, lope: 7, twin: 0, duty: 0.28, tilt: 0.88, body: 0.27, sub: 0.07, chuff: 0.42, chf: 3.0, wind: 0.18, lump: 0.22 }, // lighter, smoother, higher
    dive:    { f: 68, lope: 4.5, twin: 0, duty: 0.18, tilt: 0.9, body: 0.32, sub: 0.18, chuff: 0.55, chf: 2.2, wind: 0.2, lump: 0.42 }, // 9-cylinder: lumpy
    torp:    { f: 57, lope: 7, twin: 1.006, duty: 0.2, tilt: 0.89, body: 0.32, sub: 0.24, chuff: 0.5, chf: 2.3, wind: 0.22, lump: 0.3 },  // big twin-row: deep
    scout:   { f: 118, lope: 4.5, twin: 0, duty: 0.3, tilt: 0.86, body: 0.24, sub: 0.05, chuff: 0.5, chf: 3.2, wind: 0.14, lump: 0.36 } // small, buzzy
  };
  // loop params: type, nat, thr (0 idle .. 1 cruise .. 1.3 overspeed), air (airspeed 0..1.2), dive (howl 0..1),
  // whine (falling engine 0..1), fire (0..1), cough (one-shot sputter, depth 0..1)
  A.register('plane.engine', {
    ref: 16, max: ENGINE_N, reverb: 0.12, dur: Infinity,
    params: { type: 'wildcat', thr: 0.85, air: 0.6, dive: 0, whine: 0, fire: 0 },
    build(ctx, out, p) {
      const T = ENG[p.type] || ENG.wildcat, t = p.t, det = R(0.97, 1.03) * (p.nat === 'IJN' && (p.type === 'dive' || p.type === 'torp') ? 1.06 : 1);
      const st = { rate: p.rate || 1, thr: num(p.thr, 0.85), air: num(p.air, 0.6), dive: num(p.dive, 0), whine: num(p.whine, 0), fire: num(p.fire, 0) };
      const srcs = [];
      const out2 = S.gain(ctx, 0, out); out2.gain.setValueAtTime(0, t); out2.gain.linearRampToValueAtTime(1, t + 0.25);
      const ceil = S.filter(ctx, 'lowpass', 3200, 0.5, out2);
      const am = S.gain(ctx, 1 - T.lump * 0.5, ceil);               // radial lump: amplitude mod at the rev rate
      const toneLP = S.filter(ctx, 'lowpass', 500, 0.8, am);
      const body = S.gain(ctx, T.body, toneLP);
      const wv = pulse(ctx, T.duty, T.tilt);
      const o1 = osc(ctx, wv, T.f, t, body); srcs.push(o1);
      let o2 = null; if (T.twin) { o2 = osc(ctx, wv, T.f * T.twin, t, S.gain(ctx, 0.7, body)); srcs.push(o2); }
      const sub = osc(ctx, 'sine', T.f / 2, t, S.gain(ctx, T.sub, am)); srcs.push(sub);
      const lfo = osc(ctx, 'sine', T.f / T.lope * R(0.97, 1.03), t, S.gain(ctx, T.lump * 0.5, am.gain)); srcs.push(lfo);
      // exhaust chuff: band of noise pulsed by the firing tone
      const wn = S.src(ctx, 'white', t); srcs.push(wn);
      const chBP = S.filter(ctx, 'bandpass', 300, 1.3); wn.connect(chBP);
      const chG = S.gain(ctx, T.chuff * 0.5, am); chBP.connect(chG);
      o1.connect(S.gain(ctx, T.chuff * 0.5, chG.gain));
      // slipstream / propeller wash
      const bn = S.src(ctx, 'brown', t); srcs.push(bn);
      const wLP = S.filter(ctx, 'lowpass', 400, 0.6); bn.connect(wLP); const wG = S.gain(ctx, 0, ceil); wLP.connect(wG);
      // dive howl: resonant wind that rises with the dive
      const hBP = S.filter(ctx, 'bandpass', 500, 6); wn.connect(hBP); const hG = S.gain(ctx, 0, ceil); hBP.connect(hG);
      const hBP2 = S.filter(ctx, 'bandpass', 700, 9); wn.connect(hBP2); hBP2.connect(hG);
      // falling engine whine
      const whG = S.gain(ctx, 0, ceil); const wh = osc(ctx, 'triangle', T.f * 3, t, whG); srcs.push(wh);
      let fire = null, first = true;
      function apply() {
        const now = Math.max(ctx.currentTime, t), r = st.rate, th = st.thr, tc = 0.07;
        const sv = (prm, v, k) => { if (first) prm.setValueAtTime(v, now); else prm.setTargetAtTime(v, now, tc * (k || 1)); };
        const f = T.f * det * (0.6 + 0.4 * th) * r;
        sv(o1.frequency, f); if (o2) sv(o2.frequency, f * T.twin);
        sv(sub.frequency, f * 0.5); sv(lfo.frequency, f / T.lope);
        sv(chBP.frequency, Math.min(1500, f * T.chf));
        sv(toneLP.frequency, Math.min(2600, f * (2.2 + 3.4 * Math.min(1.3, th))), 2);  // more power, brighter
        sv(body.gain, T.body * (0.5 + 0.5 * Math.min(1.2, th)), 2);
        sv(chG.gain, T.chuff * 0.5 * (0.4 + 0.6 * Math.min(1.2, th)), 2);
        sv(wLP.frequency, (220 + 700 * st.air) * r, 3); sv(wG.gain, T.wind * (0.25 + st.air), 3);
        sv(hBP.frequency, (430 + 560 * st.dive) * r, 3); sv(hBP2.frequency, (610 + 700 * st.dive) * r, 3);
        sv(hG.gain, 0.5 * st.dive * st.dive, 4);
        sv(wh.frequency, f * 3.03); sv(whG.gain, 0.045 * st.whine, 3);
        if (st.fire > 0 && !fire) { // burning: crackle and a low roar, made on first need
          const c = S.crackle(ctx, out2, now, { f: 1600, q: 0.6, gain: 0, density: 1.2, rate: r });
          const rb = S.src(ctx, 'brown', now), rl = S.filter(ctx, 'lowpass', 380, 0.7), rg = S.gain(ctx, 0, out2);
          rb.connect(rl); rl.connect(rg);
          fire = { c, rb, rg }; srcs.push(rb);
        }
        if (fire) { fire.c.gain.gain.setTargetAtTime(0.5 * st.fire, now, 0.2); fire.rg.gain.setTargetAtTime(0.5 * st.fire, now, 0.25); }
        first = false;
      }
      apply();
      return {
        dur: Infinity,
        set(q) {
          let ch = false;
          for (const k of ['rate', 'thr', 'air', 'dive', 'whine', 'fire']) if (q[k] != null && q[k] === q[k]) { st[k] = +q[k]; ch = true; }
          if (ch) apply();
          if (q.cough > 0) { // sputter: the engine catches its breath, sometimes with a backfire pop
            const now = ctx.currentTime, d = (0.05 + 0.14 * q.cough) / st.rate, g = out2.gain;
            g.cancelScheduledValues(now); g.setTargetAtTime(1 - 0.85 * Math.min(1, q.cough), now, 0.012); g.setTargetAtTime(1, now + d, 0.04);
            if (q.cough > 0.55) S.burst(ctx, ceil, now + d, { noise: 'brown', type: 'lowpass', f: 900, q: 0.8, a: 0.002, d: 0.09, gain: 0.7 * q.cough, rate: st.rate });
          }
        },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} if (fire) fire.c.stop(tt); }
      };
    }
  });

  // ---------- wing guns (a loop that lasts one burst) ----------
  // params: zero (1 = Zero: light 7.7 mm rattle + slow 20 mm thump; 0 = Wildcat: six .50s)
  A.register('plane.gun', {
    ref: 9, max: 4, reverb: 0.22, dur: Infinity, params: { zero: 0 },
    build(ctx, out, p) {
      const t = p.t, srcs = [], gates = [];
      let r = p.rate || 1;
      const g = S.gain(ctx, 0, out); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.008);
      const lp = S.filter(ctx, 'lowpass', 3600, 0.5, g);
      const n = S.src(ctx, 'white', t); srcs.push(n);
      const gun = (hz, f, q, gain, thump, tg) => {
        const bp = S.filter(ctx, 'bandpass', f * r, q); n.connect(bp);
        const vg = S.gain(ctx, 0, lp); bp.connect(vg);
        const lf = osc(ctx, pulse(ctx, 0.1, 0.92), hz * r * R(0.95, 1.05), t + Math.random() * 0.03); srcs.push(lf);
        const sh = ctx.createWaveShaper(); sh.curve = gate(); lf.connect(sh); sh.connect(S.gain(ctx, gain, vg.gain));
        const G = { lf, bp, hz, f, o: null, tf: thump };
        if (thump) { const og = S.gain(ctx, 0, lp); G.o = osc(ctx, 'sine', thump * r, t, og); sh.connect(S.gain(ctx, tg || gain, og.gain)); srcs.push(G.o); }
        gates.push(G);
      };
      if (p.zero) {
        gun(R(17, 19), 1500, 1.1, 0.34, 0, 0); gun(R(19.5, 21.5), 1750, 1.2, 0.3, 0, 0);
        gun(R(7, 8), 420, 0.8, 0.55, 78, 0.6);                         // 20 mm cannon: slow, heavy
      } else {
        gun(R(14.5, 16), 1050, 0.9, 0.42, 135, 0.4); gun(R(16.5, 18), 1250, 1, 0.38, 150, 0.32); gun(R(12.5, 13.8), 760, 0.8, 0.38, 115, 0.36);
      }
      return {
        dur: Infinity,
        set(q) {
          if (!q.rate || Math.abs(q.rate - r) < 0.01) return;
          r = q.rate; const now = ctx.currentTime;
          for (const G of gates) { G.lf.frequency.setTargetAtTime(G.hz * r, now, 0.05); G.bp.frequency.setTargetAtTime(G.f * r, now, 0.05); if (G.o) G.o.frequency.setTargetAtTime(G.tf * r, now, 0.05); }
        },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} }
      };
    }
  });

  // ---------- one-shots ----------
  // metal hit on an airframe: inharmonic ping + a short tearing rip
  A.register('plane.hit', {
    ref: 8, max: 3, minGap: 0.09, reverb: 0.12, dur: 0.4,
    build(ctx, out, p) {
      const r = p.rate, f = R(850, 1350), g = 0.8;
      return S.done(p, [
        S.tone(ctx, out, p.t, { f, f1: f * 0.94, a: 0.001, d: R(0.12, 0.2), gain: 0.16 * g, rate: r }),
        S.tone(ctx, out, p.t, { f: f * R(1.52, 1.62), a: 0.001, d: 0.09, gain: 0.1 * g, rate: r }),
        S.tone(ctx, out, p.t, { type: 'triangle', f: f * R(2.25, 2.4), a: 0.001, d: 0.05, gain: 0.05 * g, rate: r }),
        S.burst(ctx, out, p.t, { type: 'bandpass', f: R(1600, 2200), f1: 600, q: 1.4, a: 0.001, d: R(0.04, 0.09), gain: 0.4 * g, rate: r }),
        S.tone(ctx, out, p.t, { f: 160, f1: 90, a: 0.001, d: 0.06, gain: 0.25 * g, rate: r })
      ]);
    }
  });
  // close fly-by: a broad rush of air that swells and falls away
  A.register('plane.whoosh', {
    ref: 10, max: 2, minGap: 0.4, reverb: 0.1, dur: 1.3,
    build(ctx, out, p) {
      const r = p.rate, f = R(1100, 1400);
      return S.done(p, [
        S.burst(ctx, out, p.t, { noise: 'pink', type: 'bandpass', f, f1: f * 0.3, q: 0.7, a: 0.16, d: 0.6, gain: 0.55, rate: r }),
        S.burst(ctx, out, p.t, { noise: 'brown', type: 'lowpass', f: 600, f1: 200, q: 0.5, a: 0.2, d: 0.7, gain: 0.5, rate: r })
      ]);
    }
  });
  // bomb release: the rack latch clunks open
  A.register('bomb.release', {
    ref: 10, max: 3, minGap: 0.1, reverb: 0.15, dur: 0.35,
    build(ctx, out, p) {
      const r = p.rate;
      return S.done(p, [
        S.tone(ctx, out, p.t, { f: R(150, 175), f1: 65, a: 0.002, d: 0.1, gain: 0.55, rate: r }),
        S.burst(ctx, out, p.t, { type: 'bandpass', f: R(1100, 1400), q: 2.2, a: 0.001, d: 0.03, gain: 0.35, rate: r }),
        S.burst(ctx, out, p.t + 0.035 / r, { type: 'bandpass', f: R(700, 900), q: 2, a: 0.001, d: 0.05, gain: 0.25, rate: r }),
        S.burst(ctx, out, p.t, { noise: 'brown', type: 'lowpass', f: 350, q: 0.6, a: 0.003, d: 0.15, gain: 0.45, rate: r })
      ]);
    }
  });
  // falling-bomb whistle (loop that follows the bomb). set({ k }) = height left (1 at release .. 0 at the water)
  A.register('bomb.whistle', {
    ref: 14, max: 3, reverb: 0.2, dur: Infinity, params: { k: 1 },
    build(ctx, out, p) {
      const t = p.t, f0 = R(1000, 1150); let r = p.rate || 1, k = num(p.k, 1);
      const g = S.gain(ctx, 0, out); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.12);
      const o = osc(ctx, 'sine', f0 * r, t, g);
      const vib = osc(ctx, 'sine', R(5, 7), t, S.gain(ctx, 9, o.frequency));
      const n = S.src(ctx, 'pink', t), bp = S.filter(ctx, 'bandpass', f0, 12); n.connect(bp); bp.connect(S.gain(ctx, 0.9, g));
      const apply = () => { const now = Math.max(t, ctx.currentTime), f = (f0 * (0.45 + 0.55 * k)) * r; o.frequency.setTargetAtTime(f, now, 0.04); bp.frequency.setTargetAtTime(f, now, 0.04); };
      apply();
      return {
        dur: Infinity,
        set(q) { if (q.k != null) k = clamp(+q.k, 0, 1); if (q.rate) r = q.rate; apply(); },
        stop(tt) { for (const s of [o, vib, n]) try { s.stop(tt); } catch (e) {} }
      };
    }
  });
  // torpedo drop: release clunk, then the fish hits the water
  A.register('plane.torpdrop', {
    ref: 14, max: 3, minGap: 0.15, sos: true, reverb: 0.25, dur: 1.4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.tone(ctx, out, t, { f: 140, f1: 60, a: 0.002, d: 0.08, gain: 0.35, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: 1000, q: 2, a: 0.001, d: 0.03, gain: 0.2, rate: r }),
        S.tone(ctx, out, t + 0.12 / r, { f: R(200, 240), f1: 85, a: 0.003, d: 0.14, gain: 0.3, rate: r }) // plop
      ].concat(water(ctx, out, t + 0.1 / r, 0.8, r, 0.85)));
    }
  });
  // a plane hits the water. p.size 0.4 (scout alights) .. 3 (comet)
  A.register('plane.splash', {
    ref: 22, max: 4, minGap: 0.08, sos: true, reverb: 0.3, duck: 0.12, dur: 2.5, params: { size: 1.6 },
    build(ctx, out, p) {
      const s = clamp(num(p.size, 1.6), 0.3, 3.5), r = p.rate, g = clamp(0.45 + s * 0.22, 0.4, 1);
      const parts = water(ctx, out, p.t, s, r, g);
      if (s > 1.2) parts.push(S.boom(ctx, out, p.t, { f0: 70, f1: 34, dur: 0.6 * Math.sqrt(s), gain: 0.25 * g, body: 0.6, crack: 0.12, bright: 0.6, rate: r }));
      return S.done(p, parts);
    }
  });
  // wing shears off: a crunch and a long rough metal rip
  A.register('plane.wingrip', {
    ref: 18, max: 2, minGap: 0.2, sos: true, reverb: 0.3, dur: 1.2,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const env = S.gain(ctx, 0, out), bp = S.filter(ctx, 'bandpass', 2000 * r, 1.6, null), rough = S.gain(ctx, 0.5, env);
      bp.connect(rough);
      const n = S.src(ctx, 'white', t); n.connect(bp);
      const lf = osc(ctx, 'square', R(38, 55) * r, t, S.gain(ctx, 0.5, rough.gain));
      const end = S.adsr(env.gain, t, { a: 0.01, d: 0.55 / r, peak: 0.55 });
      bp.frequency.exponentialRampToValueAtTime(480 * r, end);
      n.stop(end + 0.05); lf.stop(end + 0.05);
      return S.done(p, [
        S.boom(ctx, out, t, { f0: 120, f1: 50, dur: 0.45, gain: 0.4, body: 0.6, crack: 0.3, rate: r }),
        { end, stop(tt) { try { n.stop(tt); lf.stop(tt); } catch (e) {} } }
      ]);
    }
  });
  // fuel tank goes up (shot down: small; comet / crash: big, dark, with a crackling tail). p.size
  A.register('plane.fireball', {
    ref: 22, max: 3, minGap: 0.12, sos: true, reverb: 0.35, duck: 0.15, dur: 2, params: { size: 1 },
    build(ctx, out, p) {
      const s = clamp(num(p.size, 1), 0.3, 1.5), r = p.rate, t = p.t;
      const parts = [
        S.boom(ctx, out, t, { f0: 75, f1: 34, dur: 0.6 + 0.8 * s, gain: 0.3 + 0.25 * s, body: 1, crack: 0.15, bright: 0.6, rate: r }),
        S.burst(ctx, out, t + 0.02 / r, { noise: 'brown', type: 'lowpass', f: 650, f1: 150, q: 0.6, a: 0.05, d: 0.9 * s, gain: 0.4 * s, rate: r })
      ];
      if (s > 0.7) parts.push(S.crackle(ctx, out, t + 0.1 / r, { dur: 1.2 * s, f: 1700, q: 0.6, gain: 0.35, rate: r }));
      return S.done(p, parts);
    }
  });
  // plane crashes into a ship: crunch, scrape, clanks (the ship's own hit boom is the naval family's)
  A.register('plane.crunch', {
    ref: 25, max: 2, minGap: 0.2, sos: true, reverb: 0.35, dur: 1.6,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, parts = [
        S.boom(ctx, out, t, { f0: 95, f1: 40, dur: 0.9, gain: 0.45, body: 0.9, crack: 0.45, rate: r }),
        S.burst(ctx, out, t + 0.03 / r, { type: 'bandpass', f: 950, f1: 420, q: 3, a: 0.01, d: 0.65, gain: 0.3, rate: r })
      ];
      for (let i = 0; i < 3; i++) parts.push(S.tone(ctx, out, t + R(0.05, 0.4) / r, { type: 'triangle', f: R(280, 620), f1: R(200, 260), a: 0.001, d: R(0.08, 0.16), gain: 0.12, rate: r }));
      return S.done(p, parts);
    }
  });
  // controlled ditching: the hull skids and slaps across the water, then settles
  A.register('plane.ditch', {
    ref: 20, max: 2, minGap: 0.2, sos: true, reverb: 0.3, dur: 2.4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: 1300, f1: 450, q: 0.8, a: 0.04, d: 0.5, s: 0.55, hold: 0.7, r: 0.6, gain: 0.32, rate: r }),
        S.burst(ctx, out, t + 0.25 / r, { noise: 'brown', type: 'lowpass', f: 500, f1: 150, q: 0.5, a: 0.02, d: 0.5, gain: 0.35, rate: r })
      ].concat(water(ctx, out, t + 0.05 / r, 1.1, r, 0.75)));
    }
  });
  // parachute canopy snaps open: a soft fabric whump with a short flutter
  A.register('chute.pop', {
    ref: 14, max: 3, minGap: 0.15, reverb: 0.2, dur: 0.9,
    build(ctx, out, p) {
      const r = p.rate, t = p.t + 0.25 / p.rate; // the canopy fills a beat after the bail-out
      const env = S.gain(ctx, 0, out), bp = S.filter(ctx, 'bandpass', 520 * r, 1.2, null), fl = S.gain(ctx, 0.6, env);
      bp.connect(fl); const n = S.src(ctx, 'pink', t); n.connect(bp);
      const lf = osc(ctx, 'triangle', R(18, 26) * r, t, S.gain(ctx, 0.4, fl.gain));
      const end = S.adsr(env.gain, t + 0.06 / r, { a: 0.02, d: 0.45 / r, peak: 0.28 });
      n.stop(end + 0.05); lf.stop(end + 0.05);
      return S.done(p, [
        { end, stop(tt) { try { n.stop(tt); lf.stop(tt); } catch (e) {} } },
        S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 900, f1: 180, q: 1.1, a: 0.003, d: 0.14, gain: 0.7, rate: r }) // the snap
      ]);
    }
  });

  // ---------- carrier deck ----------
  // takeoff roll: tyres rumbling over the deck planks. p.dur = real seconds of the roll
  A.register('deck.roll', {
    ref: 18, max: 2, reverb: 0.15, dur: 2, params: { dur: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, d = clamp(num(p.dur, 1), 0.25, 3);
      const g = S.gain(ctx, 0, out);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + d * 0.7); g.gain.setTargetAtTime(0, t + d, 0.08);
      const lp = S.filter(ctx, 'lowpass', 260 * r, 0.7, g), b = S.src(ctx, 'brown', t); b.connect(lp);
      lp.frequency.linearRampToValueAtTime(520 * r, t + d);
      const c = S.crackle(ctx, g, t, { f: 420, q: 0.8, gain: 1.6, density: 0.5, rate: r });
      b.stop(t + d + 0.5); c.stop(t + d + 0.4);
      return { dur: d + 0.45, stop(tt) { try { b.stop(tt); } catch (e) {} c.stop(tt); } };
    }
  });
  // arrestor wire trap: twang of the wire, thunk of the hook, a hiss of the arresting gear
  A.register('deck.trap', {
    ref: 20, max: 2, minGap: 0.3, reverb: 0.3, dur: 1.4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, f = R(95, 120);
      return S.done(p, [
        S.tone(ctx, out, t, { type: 'triangle', f, f1: f * 0.7, glide: 0.8, a: 0.002, d: 0.7, gain: 0.3, rate: r }),
        S.tone(ctx, out, t, { f: f * 1.51, f1: f * 1.1, glide: 0.8, a: 0.002, d: 0.5, gain: 0.18, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: 1900, f1: 800, q: 4, a: 0.001, d: 0.25, gain: 0.2, rate: r }),
        S.boom(ctx, out, t + 0.02 / r, { f0: 80, f1: 40, dur: 0.45, gain: 0.45, body: 0.7, crack: 0.25, rate: r }),
        S.burst(ctx, out, t + 0.15 / r, { noise: 'pink', type: 'bandpass', f: 1500, q: 0.8, a: 0.05, d: 0.6, gain: 0.06, rate: r })
      ]);
    }
  });
  // a bad trap goes over the side: wire screech, crunch on the deck edge
  A.register('deck.barrier', {
    ref: 20, max: 1, minGap: 0.5, sos: true, reverb: 0.3, dur: 1.6,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.burst(ctx, out, t, { type: 'bandpass', f: 820, f1: 500, q: 6, a: 0.02, d: 0.4, s: 0.6, hold: 0.5, r: 0.4, gain: 0.3, rate: r }),
        S.boom(ctx, out, t + 0.1 / r, { f0: 100, f1: 45, dur: 0.6, gain: 0.4, body: 0.7, crack: 0.35, rate: r }),
        S.tone(ctx, out, t + 0.2 / r, { type: 'triangle', f: R(300, 450), f1: 220, a: 0.001, d: 0.15, gain: 0.12, rate: r })
      ]);
    }
  });
  // wing-fold hydraulics: a whirring pump and a clunk as the wing locks
  A.register('deck.fold', {
    ref: 10, max: 2, minGap: 0.25, reverb: 0.15, dur: 1.6,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, d = 0.9 / r, f = R(88, 104) * r;
      const g = S.gain(ctx, 0, out), lp = S.filter(ctx, 'lowpass', 650 * r, 0.9, g);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.1); g.gain.setValueAtTime(0.22, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.15);
      const o = osc(ctx, 'sawtooth', f, t, lp); o.frequency.linearRampToValueAtTime(f * 1.25, t + d);
      const n = S.src(ctx, 'pink', t), bp = S.filter(ctx, 'bandpass', 1100 * r, 3, S.gain(ctx, 0.25, g)); n.connect(bp);
      o.stop(t + d + 0.2); n.stop(t + d + 0.2);
      return S.done(p, [
        { end: t + d + 0.2, stop(tt) { try { o.stop(tt); n.stop(tt); } catch (e) {} } },
        S.tone(ctx, out, t + d, { f: 190, f1: 90, a: 0.001, d: 0.08, gain: 0.3, rate: r }),
        S.burst(ctx, out, t + d, { type: 'bandpass', f: 900, q: 2, a: 0.001, d: 0.03, gain: 0.15, rate: r })
      ]);
    }
  });
  // deck elevator: a clunk, a low motor hum, a clunk (subtle)
  A.register('deck.elevator', {
    ref: 12, max: 2, minGap: 0.4, reverb: 0.15, dur: 2.4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, d = 1.5 / r;
      const g = S.gain(ctx, 0, out), lp = S.filter(ctx, 'lowpass', 380 * r, 0.7, g);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.3); g.gain.setValueAtTime(0.28, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.3);
      const o1 = osc(ctx, 'triangle', R(56, 62) * r, t, lp), o2 = osc(ctx, 'sine', R(118, 124) * r, t, S.gain(ctx, 0.5, lp));
      o1.stop(t + d + 0.35); o2.stop(t + d + 0.35);
      return S.done(p, [
        { end: t + d + 0.35, stop(tt) { try { o1.stop(tt); o2.stop(tt); } catch (e) {} } },
        S.tone(ctx, out, t, { f: 120, f1: 60, a: 0.002, d: 0.12, gain: 0.3, rate: r }),
        S.tone(ctx, out, t + d, { f: 110, f1: 55, a: 0.002, d: 0.14, gain: 0.32, rate: r })
      ]);
    }
  });
  // scout catapult: cordite charge bang, then the carriage slides down the rail
  A.register('deck.catapult', {
    ref: 22, max: 2, minGap: 0.3, sos: true, reverb: 0.35, duck: 0.1, dur: 1.4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: 110, f1: 45, dur: 0.55, gain: 0.5, body: 0.8, crack: 0.5, rate: r }),
        S.burst(ctx, out, t + 0.02 / r, { noise: 'pink', type: 'bandpass', f: 500, f1: 1400, q: 1.5, a: 0.03, d: 0.35, gain: 0.3, rate: r }),
        S.tone(ctx, out, t + 0.33 / r, { f: 170, f1: 80, a: 0.001, d: 0.1, gain: 0.35, rate: r })
      ]);
    }
  });

  // ---------- wiring ----------
  const recs = new Map();          // plane -> per-plane sound state
  const deckRec = new WeakMap();   // parked deck entry -> { fold, ph }
  let whistles = [], lastT = 0;
  const VOL = { wildcat: 0.85, zero: 0.75, dive: 0.9, torp: 0.95, scout: 0.6 };
  const DEATH = { spin: 1.6, wing: 1.8, comet: 3, crash: 3, abandon: 1.5 };
  const typeOf = p => p.kind === 'scout' ? 'scout' : p.kind === 'fighter' ? (p.nation === 'IJN' ? 'zero' : 'wildcat') : p.kind === 'dive' ? 'dive' : 'torp';
  const isPlane = o => !!(o && WW.Plane && o instanceof WW.Plane);
  const at = (p, dy) => ({ x: p.x, y: (p.y || 0) + (dy || 0), z: p.z });
  const simK = () => Math.max(0.25, (WW.time.scale || 1) * (WW.time.warp || 1));
  const C = { engines: 0, created: 0, stopped: 0, coughs: 0, whoosh: 0, guns: 0, events: {} };
  function fire(name, o) { C.events[name] = (C.events[name] || 0) + 1; return A.play(name, o); }

  // what the engine of p should sound like now; null = no engine (parked, in the hangar, ditching, gone)
  function engineState(p) {
    const pt = p.pt || {}, sp = pt.speed || 30, dm = p.deathMode;
    let thr = 0.85, air = 0.6, dive = 0, whine = 0, fireL = 0, vol = 1;
    if (p.removed) return null;
    if (dm) {
      if (dm === 'ditch' || dm === 'ditched' || dm === 'slide') return null;
      const k = Math.min(1, (p.dT || 0) / 5);
      if (dm === 'spin' || dm === 'abandon') { thr = 1.25 - 0.8 * k; whine = 0.9; air = 1; dive = 0.3; }
      else if (dm === 'wing') { thr = 1.3 - 0.45 * k + 0.08 * Math.sin((p.dT || 0) * 9); whine = 1; air = 1.1; dive = 0.55; }
      else { thr = 1.12; fireL = 1; air = 1; dive = dm === 'crash' ? 0.75 : 0.4; } // comet, crash
      return { thr, air, dive, whine, fire: fireL, vol };
    }
    if (!p.alive) {
      if (p.state !== 'falling') return null;
      return { thr: 1.1, air: 1, dive: 0.3, whine: 0.8, fire: 0.5, vol };
    }
    switch (p.state) {
      case 'takeoff': {
        const ph = p.deckPh;
        if (ph === 'queued') return null;
        if (ph === 'rise' || ph === 'taxi') { thr = 0.08; air = 0; vol = 0.7; }
        else if (ph === 'hold') { thr = 0.3 + 0.8 * (1 - (p.fold || 0)); air = 0.05; }  // run-up as the wings spread
        else if (ph === 'run') { thr = 1.18; air = 0.25 + Math.min(0.6, (p.rel || 0) / 30); }
        else { thr = 1.12; air = 0.7; }
        break;
      }
      case 'catapult': { const k = Math.min(1, (p.t || 0) / 2.4); thr = p.fired ? 1.15 : 0.15 + 0.95 * k * k; air = p.fired ? 0.6 : 0.05; break; }
      case 'afloat': thr = 0.05; air = 0; vol = 0.7; break;
      case 'alight': thr = 0.35; air = 0.4; break;
      case 'rollout': thr = 0.04; air = 0.05; vol = 0.75; break;
      default: {
        const v = (p.speed || sp) / sp;
        thr = clamp(0.82 + 0.7 * (v - 0.9) + 0.035 * (p.vy || 0), 0.45, 1.2);
        air = clamp(v - 0.35, 0.2, 1.2);
        if (p.state === 'landing') { if (p.deckPh === 'final' || p.deckPh === 'base') thr = 0.5; else if (p.deckPh === 'waveoff') thr = 1.2; }
        const ph = p.phase;
        if (ph === 'roll') { thr = 0.55; dive = 0.2; air = 0.9; }
        else if (ph === 'dive') { thr = 0.6; dive = clamp(((p.V || 24) - 18) / 14, 0.35, 1); air = 1.1; }
        else if (ph === 'pull') { thr = 1.3; dive = 0.45; air = 1.1; }              // the pull-out strains
        else if (ph === 'exit') thr = 1.18;
        else if (p.kind === 'fighter' && (p.vy || 0) < -4 && p.speed > sp * 1.05) dive = clamp((p.speed - sp) / Math.max(4, (pt.dive || sp * 1.4) - sp), 0, 1) * 0.55;
        if (p.hp < p.maxHp * 0.3) fireL = 0.3;
      }
    }
    return { thr, air, dive, whine, fire: fireL, vol };
  }

  function newRec(p) {
    return { type: typeOf(p), h: null, gun: null, last: null, lvol: -1, mode: p.deathMode || null, state: p.state, deckPh: p.deckPh,
      fold: p.fold, bail: p.bailAt, fired: !!p.fired, burst: false, rx: 0, ry: 0, rz: 0, tp: 0, whooshT: 0 };
  }
  function stopRec(r, fade) {
    if (r.h) { r.h.stop(fade); r.h = null; C.stopped++; }
    if (r.gun) { r.gun.stop(0.05); r.gun = null; }
  }
  function engine(p, r, now) {
    const s = engineState(p);
    if (!s) { if (r.h) { if (p.deathMode === 'ditch') r.h.set({ cough: 1 }); stopRec(r, p.deathMode === 'ditch' ? 1.6 : 0.5); } return; }
    const vol = (VOL[r.type] || 0.8) * s.vol, dop = (WW.time.scale || 1) <= 2; // at 4x real speeds pin doppler to its clamp: off
    if (!r.h || !r.h.alive) {
      r.dop = dop;
      r.h = A.loop('plane.engine', { at: p, doppler: dop, vol, type: r.type, nat: p.nation, thr: s.thr, air: s.air, dive: s.dive, whine: s.whine, fire: s.fire });
      r.last = s; r.lvol = vol; C.created++;
      return;
    }
    const l = r.last || {};
    if (!r.last || Math.abs(s.thr - l.thr) > 0.025 || Math.abs(s.air - l.air) > 0.05 || Math.abs(s.dive - l.dive) > 0.04 || s.whine !== l.whine || s.fire !== l.fire) {
      r.h.set({ thr: s.thr, air: s.air, dive: s.dive, whine: s.whine, fire: s.fire }); r.last = s;
    }
    if (Math.abs(vol - r.lvol) > 0.02) { r.h.set({ vol }); r.lvol = vol; }
    if (dop !== r.dop) { r.h.set({ doppler: dop, rate: 1 }); r.dop = dop; }
    // a damaged engine coughs and sputters (more often the worse it is)
    const f = p.hp / (p.maxHp || 1);
    if (p.alive && f < 0.55 && r.h.voice && Math.random() < (0.55 - f) * 3.2 * r.dt) { r.h.set({ cough: R(0.35, 1) }); C.coughs++; }
  }

  function poll(p, r, now, L) {
    const dm = p.deathMode || null;
    // ---- deaths ----
    if (dm !== r.mode) {
      if (dm === 'wing') { fire('plane.wingrip', at(p)); }
      else if ((dm === 'comet' || dm === 'crash') && r.mode !== 'crash' && r.mode !== 'comet') fire('plane.fireball', Object.assign(at(p), { size: 1.2 }));
      else if (dm === 'spin') fire('plane.fireball', Object.assign(at(p), { size: 0.45 }));
      else if (dm === 'slide') fire('deck.barrier', at(p));
      if (dm === 'ditched' && r.mode === 'ditch') fire('plane.ditch', at(p));
      else if (dm === 'ditched' && r.mode === 'slide') fire('plane.splash', { x: p.x, y: 0, z: p.z, size: 1.1 });
      r.mode = dm;
    }
    if (r.bail != null && p.bailAt == null && dm && p.y > 6) fire('chute.pop', at(p, 1));
    r.bail = p.bailAt;
    // ---- deck and catapult ----
    if (p.state === 'takeoff') {
      if (p.deckPh !== r.deckPh) {
        if (p.deckPh === 'rise') fire('deck.elevator', Object.assign(at(p), { vol: 0.7 }));
        else if (p.deckPh === 'run') fire('deck.roll', Object.assign(at(p), { dur: 1.05 / simK() }));
      }
      if (r.fold >= 0.99 && p.fold < 0.99) fire('deck.fold', Object.assign(at(p), { vol: 0.8 }));
    }
    if (p.state === 'rollout' && r.state !== 'rollout' && p.deckPh === 'trap') fire('deck.trap', at(p));
    if (p.fired && !r.fired) fire('deck.catapult', at(p));
    if (p.state === 'afloat' && r.state === 'alight') fire('plane.splash', { x: p.x, y: 0, z: p.z, size: 0.4, vol: 0.7 });
    r.deckPh = p.deckPh; r.fold = p.fold; r.state = p.state; r.fired = !!p.fired;
    // ---- wing guns: one short loop per burst, following the plane ----
    const df = p.df, firing = !!(p.alive && df && df.burst > 0);
    if (firing && !r.burst) {
      const d = A.distTo(p.x, p.y, p.z);
      if (d < 160) { r.gun = A.loop('plane.gun', { at: p, zero: p.nation === 'IJN' ? 1 : 0, vol: 0.85 }); C.guns++; }
    } else if (!firing && r.burst && r.gun) { r.gun.stop(0.06); r.gun = null; }
    r.burst = firing;
    // ---- close fly-by whoosh: predicted closest approach (relative velocity measured in real time) ----
    const rx = p.x - L.x, ry = p.y - L.y, rz = p.z - L.z, dtr = now - r.tp;
    if (r.tp > 0 && dtr > 0.004 && dtr < 1.5 && p.alive && (WW.time.scale || 1) <= 2) {
      const vx = (rx - r.rx) / dtr, vy = (ry - r.ry) / dtr, vz = (rz - r.rz) / dtr, v2 = vx * vx + vy * vy + vz * vz, sp = Math.sqrt(v2);
      if (sp > 16 && sp < 400) { // a cut moves the camera hundreds of units in a frame: not a pass
        const tca = -(rx * vx + ry * vy + rz * vz) / v2, mx = rx + vx * tca, my = ry + vy * tca, mz = rz + vz * tca, dmin = Math.sqrt(mx * mx + my * my + mz * mz);
        if (tca > 0 && tca < Math.max(0.35, dtr * 1.5) && dmin < 12 && now - r.whooshT > 2.5) {
          r.whooshT = now; C.whoosh++;
          fire('plane.whoosh', { x: L.x + mx, y: L.y + my, z: L.z + mz, delay: Math.max(0, tca - 0.18), vol: clamp(1.25 - dmin / 12, 0.3, 1) * clamp(sp / 40, 0.5, 1) });
        }
      }
    }
    r.rx = rx; r.ry = ry; r.rz = rz; r.tp = now;
    engine(p, r, now);
  }
  // planes that just left the world: splash / crunch, then silence
  function gone(p, r) {
    if (p.crashedInto) fire('plane.crunch', at(p));
    else if ((DEATH[r.mode] || (p.state === 'falling' && !r.mode)) && p.y < 1) fire('plane.splash', { x: p.x, y: 0, z: p.z, size: DEATH[r.mode] || 1.6 });
    stopRec(r, 0.6);
  }
  // parked planes on the carrier decks: elevator rides and wing folds
  function decks() {
    for (const s of WW.world.ships) {
      const D = s._deck; if (!D || !s.alive || typeof s.toWorld !== 'function') continue;
      if (A.distTo(s.x, D.dy || 3, s.z) > 120) continue;
      const one = e => {
        let q = deckRec.get(e);
        const w = s.toWorld(e.lx, e.lz), pos = { x: w[0], y: D.dy || 3, z: w[1] };
        if (!q) { deckRec.set(e, q = { fold: e.fold, ph: e.ph }); if (e.ph === 'up' && e.yoff < -2) fire('deck.elevator', Object.assign(pos, { vol: 0.6 })); return; }
        if (q.fold <= 0.02 && e.fold > 0.02) fire('deck.fold', Object.assign(pos, { vol: 0.7 }));
        if (e.ph === 'down' && q.ph !== 'down') fire('deck.elevator', Object.assign(pos, { vol: 0.6 }));
        q.fold = e.fold; q.ph = e.ph;
      };
      for (const col of D.cols) for (const e of col.e) one(e);
      for (const e of D.loose) one(e);
    }
  }

  A.onUpdate(tick);
  function tick(rdt) {
    const now = performance.now() / 1000, L = A.listener, gap = now - lastT > 2; // gap: sound was off / tab hidden (not just a slow frame)
    lastT = now;
    for (const [p, r] of recs) {
      if (!p.removed) continue;
      if (gap) stopRec(r, 0.3); else gone(p, r);
      recs.delete(p);
    }
    let n = 0;
    for (const p of WW.world.planes) {
      let r = recs.get(p);
      if (!r || gap) { const h = r && r.h, g = r && r.gun; r = newRec(p); r.h = h && h.alive ? h : null; r.gun = g; if (r.gun) { r.gun.stop(0.05); r.gun = null; } recs.set(p, r); }
      r.dt = rdt;
      poll(p, r, now, L);
      if (r.h && r.h.voice) n++;
    }
    C.engines = n;
    if (!gap) decks();
    for (let i = whistles.length - 1; i >= 0; i--) { // falling bombs: pitch drops with the height left
      const w = whistles[i], b = w.proj;
      if (b.dead || !w.h.alive) { w.h.stop(0.03); whistles.splice(i, 1); continue; }
      const d = A.distTo(b.x, b.y, b.z), k = clamp(b.y / w.y0, 0, 1);
      w.h.set({ k, vol: 0.75 * clamp(1.4 - d / 70, 0, 1) });
    }
  }
  WW.on('planeHit', e => {
    if (!A.live || !e || !e.plane) return;
    fire('plane.hit', Object.assign(at(e.plane), { vol: clamp(0.55 + (e.amount || 1) / 8, 0.5, 1) }));
  });
  WW.on('weaponDropped', e => {
    if (!A.live || !e || !isPlane(e.plane)) return;
    if (e.kind === 'bomb') {
      fire('bomb.release', at(e.plane, -0.3));
      const b = e.proj;
      if (b && A.distTo(b.x, b.y, b.z) < 90 && whistles.length < 4) {
        whistles.push({ proj: b, y0: Math.max(1, b.y), h: A.loop('bomb.whistle', { at: b, k: 1, vol: 0.75 }) });
        C.events['bomb.whistle'] = (C.events['bomb.whistle'] || 0) + 1;
      }
    } else if (e.kind === 'torpedo' && e.proj) fire('plane.torpdrop', { x: e.proj.x, y: 0, z: e.proj.z });
  });
  WW.on('weaponImpact', e => {
    if (!e || e.kind !== 'bomb') return;
    for (let i = whistles.length - 1; i >= 0; i--) if (whistles[i].proj === e.proj) { whistles[i].h.stop(0.03); whistles.splice(i, 1); }
  });
  const reset = () => { recs.clear(); whistles = []; };
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);

  // tests / tooling
  WW.audioAir = {
    ENGINE_N, ENG, rec: p => recs.get(p), stats() { let gunsLive = 0, eng = 0; for (const r of recs.values()) { if (r.gun && r.gun.voice) gunsLive++; if (r.h && r.h.voice) eng++; }
      return Object.assign({}, C, { events: Object.assign({}, C.events), engineVoices: eng, gunVoices: gunsLive, tracked: recs.size, whistles: whistles.length }); }
  };
})(window.WW);
