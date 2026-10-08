// audio_naval.js: naval combat and ship sound patches (guns, shells, splashes, hits, torpedoes,
// depth charges, submarines, fires, sinking, engines). Events and polling that play them: audio_naval_wire.js.
// Calm and cinematic: low and mid frequencies, soft tops, every play varies a little (pitch, timing, layers).
// Sound code uses Math.random (S.rand), never WW.rand.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.syn) return;
  const S = A.syn, R = S.rand;
  const V = (x, a) => x * R(1 - (a || 0.08), 1 + (a || 0.08)); // vary a value by +-a

  // a started oscillator; o: { type, f }
  function osc(ctx, type, f, t) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); return o; }
  // metallic clang: inharmonic sine partials, each a fast-decaying blip (bell-like, not a tone)
  function clang(ctx, out, t, o) {
    const parts = [], f = o.f, r = o.rate || 1;
    [[1, 1, 1], [2.32, 0.6, 0.7], [3.87, 0.38, 0.5], [5.4, 0.2, 0.35]].forEach(([m, g, d]) => {
      parts.push(S.tone(ctx, out, t + R(0, 0.006), { f: f * m * R(0.98, 1.02), f1: f * m * 0.97, glide: 1, a: 0.002, d: o.d * d, gain: o.gain * g, rate: r }));
    });
    return parts;
  }
  // a few bubble blips: rising sines (gurgle). o: { n, span, f, gain, rate }
  function bubbles(ctx, out, t, o) {
    const parts = [], r = o.rate || 1;
    for (let i = 0; i < o.n; i++) {
      const f = V(o.f || 260, 0.4), tt = t + Math.pow(Math.random(), 0.8) * o.span / r;
      parts.push(S.tone(ctx, out, tt, { f, f1: f * R(1.6, 2.4), glide: 0.9, a: 0.004, d: R(0.03, 0.08), gain: (o.gain || 0.1) * R(0.4, 1), rate: r }));
    }
    return parts;
  }

  // ---------- guns ----------
  // p.size: gun weight (1 = battleship), p.n: barrels in this salvo (one play per salvo)
  A.register('gun.big', {
    ref: 140, max: 3, minGap: 0.14, sos: true, reverb: 0.55, duck: 0.6, dur: 4.5, params: { size: 1, n: 1 },
    build(ctx, out, p) {
      const k = p.size || 1, r = p.rate, t = p.t, n = Math.min(4, p.n || 1), parts = [];
      const g0 = 0.55 / (1 + 0.15 * (n - 1));
      parts.push(S.boom(ctx, out, t, { f0: V(58) / Math.sqrt(k), f1: 24, dur: 2.5 * k, gain: g0, body: 1, crack: 0.45, bright: 0.75, rate: r }));
      parts.push(S.burst(ctx, out, t, { type: 'bandpass', f: V(820), f1: 240, q: 0.7, a: 0.001, d: 0.3, gain: 0.28, rate: r })); // the muzzle blast
      for (let i = 1; i < n; i++) // the other barrels: a ragged, overlapping roll rather than separate clicks
        parts.push(S.boom(ctx, out, t + R(0.025, 0.11) * i / r, { f0: V(52, 0.12) / Math.sqrt(k), f1: 22, dur: 1.9 * k, gain: 0.24, body: 0.8, crack: 0.2, bright: 0.6, rate: r }));
      parts.push(S.burst(ctx, out, t + 0.04 / r, { noise: 'pink', type: 'lowpass', f: 650, f1: 90, q: 0.3, a: 0.06, d: 2.3 * k, gain: 0.34, rate: r }));
      // distant thunder: the report rolling back off the islands
      parts.push(S.burst(ctx, out, t + R(0.55, 0.9) / r, { noise: 'brown', type: 'lowpass', f: V(210, 0.15), f1: 70, q: 0.5, a: 0.35, d: 1.8 * k, gain: 0.3 * Math.min(1.4, 0.8 + 0.2 * n), rate: r }));
      return S.done(p, parts);
    }
  });
  A.register('gun.med', {
    ref: 55, max: 3, minGap: 0.1, sos: true, reverb: 0.4, duck: 0.12, dur: 2.5, params: { size: 1, n: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, n = Math.min(3, p.n || 1), parts = [];
      parts.push(S.boom(ctx, out, t, { f0: V(88), f1: 38, dur: 1.15, gain: 0.5 / (1 + 0.15 * (n - 1)), body: 0.85, crack: 0.5, bright: 0.85, rate: r }));
      for (let i = 1; i < n; i++) parts.push(S.boom(ctx, out, t + R(0.02, 0.07) * i / r, { f0: V(80, 0.12), f1: 36, dur: 0.9, gain: 0.22, body: 0.6, crack: 0.2, bright: 0.7, rate: r }));
      parts.push(S.burst(ctx, out, t, { type: 'bandpass', f: V(950), f1: 300, q: 0.9, a: 0.002, d: 0.22, gain: 0.3, rate: r })); // the bark
      parts.push(S.burst(ctx, out, t + 0.03 / r, { noise: 'pink', type: 'lowpass', f: 700, f1: 120, q: 0.3, a: 0.04, d: 1.1, gain: 0.2, rate: r }));
      return S.done(p, parts);
    }
  });
  A.register('gun.small', {
    ref: 40, max: 3, minGap: 0.09, sos: true, reverb: 0.3, dur: 1.2, params: { n: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(125), f1: 60, dur: 0.45, gain: 0.42, body: 0.6, crack: 0.55, bright: 1, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: V(1500), f1: 600, q: 1.1, a: 0.001, d: 0.07, gain: 0.32, rate: r }),
        S.burst(ctx, out, t + 0.02 / r, { noise: 'pink', type: 'lowpass', f: 900, f1: 180, q: 0.3, a: 0.02, d: 0.5, gain: 0.12, rate: r })
      ]);
    }
  });
  // a destroyer's main guns (5-inch): a hard, heavy crack with a short boom and a ring off the water. p.n barrels
  A.register('gun.dd', {
    ref: 75, max: 3, minGap: 0.1, sos: true, reverb: 0.4, duck: 0.25, dur: 2.6, params: { n: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, n = Math.min(2, p.n || 1), parts = [];
      parts.push(S.boom(ctx, out, t, { f0: V(96), f1: 40, dur: 1.2, gain: 0.52, body: 0.9, crack: 0.65, bright: 1, rate: r }));
      if (n > 1) parts.push(S.boom(ctx, out, t + R(0.03, 0.08) / r, { f0: V(90, 0.12), f1: 38, dur: 0.9, gain: 0.26, body: 0.7, crack: 0.3, bright: 0.85, rate: r }));
      parts.push(S.burst(ctx, out, t, { type: 'bandpass', f: V(1150), f1: 380, q: 0.9, a: 0.001, d: 0.16, gain: 0.4, rate: r })); // the crack
      parts.push(S.burst(ctx, out, t + 0.03 / r, { noise: 'pink', type: 'lowpass', f: 800, f1: 140, q: 0.3, a: 0.04, d: 1.3, gain: 0.24, rate: r }));
      return S.done(p, parts);
    }
  });
  // a short rattle: 4 to 6 rounds in one play (throttled so a PT's gun is a burst every so often, not a buzz)
  A.register('gun.mg', {
    ref: 14, max: 3, minGap: 0.28, sos: true, reverb: 0.2, dur: 0.7,
    build(ctx, out, p) {
      const r = p.rate, parts = [], n = 4 + Math.floor(Math.random() * 3), gap = R(0.065, 0.085);
      for (let i = 0; i < n; i++) {
        const tt = p.t + (i * gap + R(0, 0.012)) / r, g = R(0.7, 1);
        parts.push(S.burst(ctx, out, tt, { type: 'bandpass', f: V(1150, 0.12), q: 1.3, a: 0.001, d: 0.035, gain: 0.42 * g, rate: r }));
        parts.push(S.tone(ctx, out, tt, { f: V(170), f1: 90, a: 0.001, d: 0.04, gain: 0.3 * g, rate: r }));
      }
      return S.done(p, parts);
    }
  });

  // ---------- shells and splashes ----------
  // a shell passing the camera: a falling whistle with a low "freight train" rush; its loudest point is 0.75 s in.
  // p.size: 1 big, 0.6 med
  A.register('shell.whistle', {
    ref: 9, max: 2, minGap: 0.25, reverb: 0.1, dur: 1.5, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1, c = t + 0.75 / r, end = t + 1.4 / r;
      const m = S.gain(ctx, 0, out);
      m.gain.setValueAtTime(0, t); m.gain.linearRampToValueAtTime(0.15, t + 0.4 / r); m.gain.linearRampToValueAtTime(0.5, c);
      m.gain.setTargetAtTime(0, c + 0.05 / r, 0.16 / r);
      const f = V(k > 0.8 ? 520 : 680, 0.1) * r, o = osc(ctx, 'sine', f * 1.14, t);
      o.frequency.setTargetAtTime(f * 0.86, c - 0.15 / r, 0.18 / r);
      const og = S.gain(ctx, 0.35, m); o.connect(og); o.stop(end);
      const n = S.src(ctx, 'pink', t, { rate: r }), bp = S.filter(ctx, 'bandpass', 420 * k * r, 1.4), ng = S.gain(ctx, 0.5 * k + 0.2, m);
      bp.frequency.setTargetAtTime(240 * r, c - 0.1 / r, 0.2 / r); n.connect(bp); bp.connect(ng); n.stop(end);
      return { dur: end - t, stop(tt) { try { o.stop(tt); n.stop(tt); } catch (e) {} } };
    }
  });
  // big/med miss: a deep slap, the column of water rushing up, then falling back as spray. p.size 0.6..1.6
  A.register('shell.splash', {
    ref: 30, max: 3, minGap: 0.08, sos: true, reverb: 0.3, dur: 3, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(75) / Math.sqrt(k), f1: 38, a: 0.003, d: 0.25 * k, gain: 0.45, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: V(650), f1: 220, q: 0.8, a: 0.002, d: 0.16, gain: 0.35, rate: r }),
        S.burst(ctx, out, t + 0.02 / r, { noise: 'pink', type: 'lowpass', f: 1600, f1: 500, q: 0.4, a: 0.08, d: 0.7 * k, gain: 0.22, rate: r }),
        S.burst(ctx, out, t + R(0.5, 0.8) * k / r, { noise: 'pink', type: 'bandpass', f: V(1900, 0.15), f1: 900, q: 0.5, a: 0.15, d: 1.0 * k, gain: 0.1, rate: r }) // spray falling back
      ]);
    }
  });
  // small/mg miss: a quick plop and a short hiss. p.size 0.3..0.8
  A.register('shell.splash.small', {
    ref: 16, max: 3, minGap: 0.09, sos: true, reverb: 0.15, dur: 0.8, params: { size: 0.6 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 0.6;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(240, 0.2), f1: 110, a: 0.002, d: 0.06, gain: 0.3 * k + 0.1, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: V(1100, 0.15), f1: 500, q: 0.8, a: 0.002, d: 0.08, gain: 0.3 * k + 0.1, rate: r }),
        S.burst(ctx, out, t + 0.03 / r, { noise: 'pink', type: 'bandpass', f: 2200, f1: 1300, q: 0.6, a: 0.02, d: 0.35 * k, gain: 0.1, rate: r })
      ]);
    }
  });
  // a shell landing on an island: a dull thud and falling earth
  A.register('shell.land', {
    ref: 30, max: 2, minGap: 0.12, sos: true, reverb: 0.3, dur: 1.6, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(70), f1: 35, dur: 0.8 * k, gain: 0.45, body: 0.9, crack: 0.15, bright: 0.5, rate: r }),
        S.burst(ctx, out, t + 0.15 / r, { noise: 'brown', type: 'lowpass', f: 900, f1: 200, q: 0.4, a: 0.1, d: 0.8 * k, gain: 0.35, rate: r })
      ]);
    }
  });

  // ---------- hits and explosions ----------
  // shell or bomb on a hull: clang + crunch + (bang > 0) an explosion. p.size 0.3..2 (from damage), p.bang 0..1
  A.register('ship.hit', {
    ref: 35, max: 2, minGap: 0.22, sos: true, reverb: 0.35, dur: 2.5, params: { size: 1, bang: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1, bang = p.bang == null ? 1 : p.bang;
      const parts = clang(ctx, out, t, { f: V(260, 0.18) / Math.sqrt(k), d: 0.35 + 0.15 * k, gain: 0.04, rate: r });
      parts.push(S.burst(ctx, out, t, { type: 'bandpass', f: V(700), f1: 260, q: 0.9, a: 0.002, d: 0.18 + 0.06 * k, gain: 0.2, rate: r })); // crunch
      parts.push(S.crackle(ctx, out, t + 0.01 / r, { dur: 0.25 + 0.2 * k, f: 1100, q: 0.7, gain: 0.25, density: 0.7, rate: r }));
      if (bang > 0) parts.push(S.boom(ctx, out, t + 0.01 / r, { f0: V(72) / Math.sqrt(k), f1: 32, dur: 0.7 + 0.6 * k, gain: 0.45 * bang * Math.min(1, 0.5 + 0.3 * k), body: 0.85, crack: 0.25, bright: 0.7, rate: r }));
      return S.done(p, parts);
    }
  });
  // small arms on a hull: a soft metallic tick
  A.register('ship.ping', {
    ref: 10, max: 1, minGap: 0.8, sos: true, reverb: 0.1, dur: 0.3,
    build(ctx, out, p) { return S.done(p, clang(ctx, out, p.t, { f: V(620, 0.2), d: 0.1, gain: 0.07, rate: p.rate })); }
  });
  // secondary explosion (ammunition / fuel) on a burning or sinking ship. p.size 0.5..1.6
  A.register('ship.boom', {
    ref: 40, max: 2, minGap: 0.25, sos: true, reverb: 0.45, duck: 0.15, dur: 2.5, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(62) / Math.sqrt(k), f1: 28, dur: 1.2 * k, gain: 0.5, body: 1, crack: 0.2, bright: 0.6, rate: r }),
        S.crackle(ctx, out, t + 0.05 / r, { dur: 0.8 * k, f: 1100, q: 0.6, gain: 0.45, density: 0.8, rate: r })
      ]);
    }
  });
  // magazine / boiler explosion when a ship is killed: a double blast, debris and a long rumble. Ducks the ambience.
  A.register('ship.magazine', {
    ref: 70, max: 2, minGap: 0.3, sos: true, reverb: 0.55, duck: 0.65, dur: 5, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(48) / Math.sqrt(k), f1: 20, dur: 2.6 * k, gain: 0.48, body: 1.05, crack: 0.3, bright: 0.6, rate: r }),
        S.boom(ctx, out, t + R(0.18, 0.35) / r, { f0: V(40), f1: 18, dur: 2.2 * k, gain: 0.28, body: 0.9, crack: 0.12, bright: 0.45, rate: r }),
        S.crackle(ctx, out, t + 0.1 / r, { dur: 1.6 * k, f: 1000, q: 0.6, gain: 0.55, density: 1, rate: r }),
        S.burst(ctx, out, t + 0.5 / r, { noise: 'brown', type: 'lowpass', f: 200, f1: 60, q: 0.5, a: 0.4, d: 2.2 * k, gain: 0.3, rate: r })
      ]);
    }
  });

  // ---------- sinking ----------
  // the long death of a ship: groans of bending steel, steam venting, rising bubbles. Stopped when the wreck settles.
  // p.size 0.3..1.2 (hull length / 24)
  A.register('ship.sink', {
    ref: 45, max: 2, reverb: 0.5, dur: 10, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1, parts = [];
      for (let i = 0; i < 3; i++) { // groans: low sawtooth through a dark filter, bending pitch
        const tt = t + (0.6 + i * R(1.8, 2.8)) / r, d = R(1.3, 2.2) / r, f = V(46, 0.2) / Math.sqrt(k) * r;
        const o = osc(ctx, 'sawtooth', f, tt), lp = S.filter(ctx, 'lowpass', V(260) * r, 3), g = S.gain(ctx, 0, out);
        o.frequency.linearRampToValueAtTime(f * R(0.7, 1.35), tt + d);
        g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.16, tt + d * 0.4); g.gain.linearRampToValueAtTime(0, tt + d);
        o.connect(lp); lp.connect(g); o.stop(tt + d + 0.05);
        parts.push({ end: tt + d, stop(x) { try { o.stop(x); } catch (e) {} } });
      }
      parts.push(S.burst(ctx, out, t + 0.3 / r, { noise: 'pink', type: 'bandpass', f: V(1700), f1: 900, q: 0.6, a: 0.6, d: 2.5, s: 0.5, hold: 2.5, r: 1.5, gain: 0.14, rate: r })); // steam
      parts.push(S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 300, f1: 120, q: 0.5, a: 1.2, d: 3, s: 0.6, hold: 3, r: 2, gain: 0.3, rate: r })); // water rushing in
      parts.push.apply(parts, bubbles(ctx, out, t + 2 / r, { n: 18, span: 7, f: 220, gain: 0.12, rate: r }));
      return S.done(p, parts);
    }
  });
  // the wreck settling: a quiet last gurgle
  A.register('ship.settle', {
    ref: 30, max: 2, reverb: 0.3, dur: 3,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const parts = bubbles(ctx, out, t, { n: 10, span: 1.8, f: 160, gain: 0.12, rate: r });
      parts.push(S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 380, f1: 120, q: 0.6, a: 0.3, d: 1.6, gain: 0.25, rate: r }));
      return S.done(p, parts);
    }
  });

  // ---------- torpedoes ----------
  // tube launch: compressed-air thump, the fish hitting the water. p.tube 'ship' | 'pt' | 'sub' (sub: muffled, under water)
  A.register('torp.launch', {
    ref: 25, max: 2, minGap: 0.15, sos: true, reverb: 0.25, dur: 1.5, params: { tube: 'ship' },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, sub = p.tube === 'sub', parts = [];
      parts.push(S.tone(ctx, out, t, { f: V(sub ? 60 : 85), f1: 40, a: 0.003, d: 0.16, gain: 0.45, rate: r }));
      parts.push(S.burst(ctx, out, t, { noise: 'pink', type: sub ? 'lowpass' : 'bandpass', f: sub ? 500 : V(1000), f1: 280, q: 0.7, a: 0.005, d: 0.22, gain: 0.3, rate: r })); // the air
      if (sub) parts.push.apply(parts, bubbles(ctx, out, t + 0.1 / r, { n: 6, span: 0.6, f: 180, gain: 0.12, rate: r }));
      else {
        const ts = t + R(0.25, 0.4) / r;
        parts.push(S.burst(ctx, out, ts, { type: 'bandpass', f: V(600), f1: 250, q: 0.8, a: 0.003, d: 0.15, gain: 0.28, rate: r }));
        parts.push(S.burst(ctx, out, ts + 0.02 / r, { noise: 'pink', type: 'lowpass', f: 1500, f1: 500, q: 0.4, a: 0.05, d: 0.5, gain: 0.12, rate: r }));
      }
      return S.done(p, parts);
    }
  });
  // running torpedo, heard only close by: a faint propeller whine and churn under the water. Loop.
  A.register('torp.run', {
    ref: 8, max: 2, reverb: 0.05, dur: Infinity,
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out); m.gain.setTargetAtTime(1, t, 0.2);
      const f = V(640, 0.1), o = osc(ctx, 'triangle', f, t), lp = S.filter(ctx, 'lowpass', 1200, 0.7), og = S.gain(ctx, 0.05, m);
      o.connect(lp); lp.connect(og);
      const n = S.src(ctx, 'pink', t), bp = S.filter(ctx, 'bandpass', 380, 1.2), ng = S.gain(ctx, 0.14, m);
      n.connect(bp); bp.connect(ng);
      const lfo = osc(ctx, 'sine', V(16, 0.15), t); lfo.connect(S.gain(ctx, 0.08, ng.gain)); // screw beat
      const srcs = [o, n, lfo];
      return { dur: Infinity,
        set(q) { if (q.rate) { const now = ctx.currentTime; o.frequency.setTargetAtTime(f * q.rate, now, 0.1); n.playbackRate.setTargetAtTime(q.rate, now, 0.1); } },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } };
    }
  });
  // torpedo hit: a huge muffled underwater blow, then the water column going up and coming down. Ducks the ambience.
  A.register('torp.hit', {
    ref: 55, max: 2, minGap: 0.2, sos: true, reverb: 0.5, duck: 0.5, dur: 4.5,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(42), f1: 20, dur: 2.4, gain: 0.43, body: 0.95, crack: 0, bright: 0.35, rate: r }),
        S.burst(ctx, out, t + 0.12 / r, { noise: 'pink', type: 'lowpass', f: 1300, f1: 350, q: 0.4, a: 0.25, d: 1.4, gain: 0.32, rate: r }), // column rising
        S.burst(ctx, out, t + R(1.1, 1.5) / r, { noise: 'pink', type: 'bandpass', f: V(900), f1: 350, q: 0.5, a: 0.3, d: 1.5, gain: 0.2, rate: r }) // falling back
      ]);
    }
  });
  // a dud (USN Mk 14 / 15, 1942): the warhead strikes the hull and does not go off. A dull iron clunk through the
  // water, a ring of the plating, a small slap of spray. No boom: that missing boom is the point.
  A.register('torp.dud', {
    ref: 30, max: 2, minGap: 0.25, sos: true, reverb: 0.3, dur: 1.6,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const parts = clang(ctx, out, t, { f: V(150, 0.12), d: 0.9, gain: 0.07, rate: r });          // the plating rings, low
      parts.push(S.tone(ctx, out, t, { f: V(70), f1: 48, a: 0.002, d: 0.22, gain: 0.4, rate: r })); // the clunk
      parts.push(S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(500), f1: 220, q: 0.9, a: 0.002, d: 0.12, gain: 0.22, rate: r }));
      parts.push(S.burst(ctx, out, t + 0.05 / r, { noise: 'pink', type: 'bandpass', f: V(1500), f1: 700, q: 0.6, a: 0.02, d: 0.35, gain: 0.12, rate: r })); // spray
      return S.done(p, parts);
    }
  });
  // end of a missed run: a faint fizz
  A.register('torp.fizz', {
    ref: 10, max: 2, minGap: 0.3, sos: true, reverb: 0.1, dur: 1.5,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const parts = bubbles(ctx, out, t + 0.1 / r, { n: 5, span: 0.8, f: 300, gain: 0.18, rate: r });
      parts.push(S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(1400), f1: 800, q: 0.6, a: 0.08, d: 0.6, gain: 0.3, rate: r }));
      return S.done(p, parts);
    }
  });

  // ---------- depth charges ----------
  A.register('dc.splash', {
    ref: 18, max: 2, minGap: 0.2, sos: true, reverb: 0.1, dur: 0.6,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(150, 0.15), f1: 70, a: 0.002, d: 0.1, gain: 0.35, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: V(800), f1: 300, q: 0.8, a: 0.002, d: 0.14, gain: 0.25, rate: r })
      ]);
    }
  });
  // the detonation, deep under water: a heavy thump you feel more than hear, then the dome of water
  A.register('dc.blast', {
    ref: 45, max: 3, minGap: 0.15, sos: true, reverb: 0.4, duck: 0.35, dur: 3,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(36), f1: 19, dur: 1.7, gain: 0.44, body: 0.9, crack: 0, bright: 0.3, rate: r }),
        S.tone(ctx, out, t + 0.02 / r, { f: V(28), f1: 22, a: 0.02, d: 1.0, gain: 0.22, rate: r }),
        S.burst(ctx, out, t + 0.15 / r, { noise: 'pink', type: 'lowpass', f: 1100, f1: 300, q: 0.4, a: 0.2, d: 1.2, gain: 0.25, rate: r })
      ]);
    }
  });

  // ---------- submarines ----------
  // dive: ballast vents hiss, a very short soft two-tone klaxon, water closing over
  A.register('sub.dive', {
    ref: 22, max: 1, minGap: 1, sos: true, reverb: 0.25, dur: 3.5,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, parts = [], f = V(430, 0.05);
      for (let i = 0; i < 4; i++) { // two-tone, soft triangle through a low-pass
        const tt = t + i * 0.22 / r, lp = S.filter(ctx, 'lowpass', 1100 * r, 0.7, out);
        parts.push(S.tone(ctx, lp, tt, { type: 'triangle', f: i % 2 ? f * 0.8 : f, a: 0.02, d: 0.18, s: 0.8, hold: 0.1, r: 0.04, gain: 0.07, rate: r }));
      }
      parts.push(S.burst(ctx, out, t + 0.3 / r, { noise: 'pink', type: 'bandpass', f: V(1300), f1: 650, q: 0.6, a: 0.25, d: 1.0, s: 0.6, hold: 0.8, r: 0.8, gain: 0.2, rate: r }));
      parts.push.apply(parts, bubbles(ctx, out, t + 1.2 / r, { n: 8, span: 1.8, f: 200, gain: 0.09, rate: r }));
      return S.done(p, parts);
    }
  });
  // surface: tanks blown with high-pressure air, then water pouring off the casing
  A.register('sub.surface', {
    ref: 22, max: 1, minGap: 1, sos: true, reverb: 0.25, dur: 4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 500, f1: 200, q: 0.5, a: 0.3, d: 1.2, s: 0.5, hold: 0.4, r: 0.6, gain: 0.35, rate: r }),
        S.burst(ctx, out, t + 0.1 / r, { noise: 'pink', type: 'bandpass', f: V(900), f1: 500, q: 0.6, a: 0.3, d: 1.0, gain: 0.16, rate: r }),
        S.burst(ctx, out, t + 1.2 / r, { noise: 'pink', type: 'lowpass', f: 1600, f1: 500, q: 0.4, a: 0.5, d: 1.6, gain: 0.2, rate: r })
      ]);
    }
  });

  // ---------- fires ----------
  // a burning ship: crackle over a low roar. Loop; set({ n }) = burning sites (1..6)
  A.register('fire.ship', {
    ref: 22, max: 3, reverb: 0.15, dur: Infinity, params: { n: 1 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out); m.gain.setTargetAtTime(1, t, 0.5);
      const cr = S.crackle(ctx, m, t, { f: V(1500, 0.15), q: 0.6, gain: 0.35, density: 0.8 });
      const n = S.src(ctx, 'brown', t), lp = S.filter(ctx, 'lowpass', 260, 0.6), rg = S.gain(ctx, 0.3, m);
      n.connect(lp); lp.connect(rg);
      const lfo = osc(ctx, 'sine', V(0.4, 0.3), t); lfo.connect(S.gain(ctx, 0.1, rg.gain)); // the roar breathes
      const api = { dur: Infinity,
        set(q) {
          const now = ctx.currentTime;
          if (q.n != null) { const k = Math.min(1, 0.45 + 0.18 * q.n); rg.gain.setTargetAtTime(0.32 * k, now, 0.5); cr.gain.gain.setTargetAtTime(0.3 * k, now, 0.5); }
          if (q.rate) { n.playbackRate.setTargetAtTime(q.rate, now, 0.1); cr.source.playbackRate.setTargetAtTime(0.8 * q.rate, now, 0.1); }
        },
        stop(tt) { cr.stop(tt); try { n.stop(tt); lfo.stop(tt); } catch (e) {} } };
      api.set(p);
      return api;
    }
  });

  // ---------- engines and wakes ----------
  // a big ship under way: low machinery hum + bow-wave wash. Loop; set({ throttle 0..1 }), p.size = length / 24
  A.register('ship.engine', {
    ref: 20, max: 3, reverb: 0.1, dur: Infinity, params: { size: 1, throttle: 0.5 },
    build(ctx, out, p) {
      const t = p.t, k = p.size || 1, m = S.gain(ctx, 0, out); m.gain.setTargetAtTime(1, t, 0.6);
      const base = V(36, 0.1) / Math.sqrt(k);
      const o1 = osc(ctx, 'sawtooth', base, t), o2 = osc(ctx, 'sawtooth', base * 1.503, t);
      const lp = S.filter(ctx, 'lowpass', 150, 0.8), hum = S.gain(ctx, 0.22, m);
      o1.connect(lp); o2.connect(S.gain(ctx, 0.5, lp)); lp.connect(hum);
      const l1 = osc(ctx, 'sine', V(0.35, 0.3), t); l1.connect(S.gain(ctx, 0.05, hum.gain));
      const w = S.src(ctx, 'pink', t), bp = S.filter(ctx, 'bandpass', V(480), 0.5), wg = S.gain(ctx, 0, m);
      w.connect(bp); bp.connect(wg);
      const l2 = osc(ctx, 'sine', V(0.13, 0.3), t); l2.connect(S.gain(ctx, 0.04, wg.gain)); // the bow wave surges
      let th = p.throttle, rt = p.rate || 1;
      const srcs = [o1, o2, l1, w, l2];
      const api = { dur: Infinity,
        set(q) {
          const now = ctx.currentTime;
          if (q.throttle != null) th = Math.max(0, Math.min(1, q.throttle));
          if (q.rate) rt = q.rate;
          const f = base * (0.75 + 0.5 * th) * rt;
          o1.frequency.setTargetAtTime(f, now, 0.8); o2.frequency.setTargetAtTime(f * 1.503, now, 0.8);
          wg.gain.setTargetAtTime(0.04 + 0.2 * th, now, 0.8); w.playbackRate.setTargetAtTime(rt, now, 0.1);
        },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } };
      api.set(p);
      return api;
    }
  });
  // PT boat: throaty, high-revving petrol engines; pitch follows speed. Loop; set({ throttle 0..1 })
  A.register('ship.engine.pt', {
    ref: 14, max: 2, reverb: 0.1, dur: Infinity, params: { throttle: 0.5 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out); m.gain.setTargetAtTime(1, t, 0.4);
      const o1 = osc(ctx, 'sawtooth', 60, t), o2 = osc(ctx, 'sawtooth', 60, t), sq = osc(ctx, 'square', 30, t);
      const lp = S.filter(ctx, 'lowpass', 700, 2.5), body = S.gain(ctx, 0.14, m);
      o1.connect(lp); o2.connect(S.gain(ctx, 0.6, lp)); lp.connect(body);
      sq.connect(S.gain(ctx, 0.05, body.gain)); // firing-rate burble
      const w = S.src(ctx, 'pink', t), bp = S.filter(ctx, 'bandpass', 650, 0.6), wg = S.gain(ctx, 0, m);
      w.connect(bp); bp.connect(wg);
      const det = R(1.006, 1.014);
      let th = p.throttle, rt = p.rate || 1;
      const srcs = [o1, o2, sq, w];
      const api = { dur: Infinity,
        set(q) {
          const now = ctx.currentTime;
          if (q.throttle != null) th = Math.max(0, Math.min(1, q.throttle));
          if (q.rate) rt = q.rate;
          const f = (48 + 62 * th) * rt;
          o1.frequency.setTargetAtTime(f, now, 0.25); o2.frequency.setTargetAtTime(f * 2 * det, now, 0.25); sq.frequency.setTargetAtTime(f / 2, now, 0.25);
          lp.frequency.setTargetAtTime(450 + 700 * th, now, 0.25);
          wg.gain.setTargetAtTime(0.05 + 0.2 * th, now, 0.4); w.playbackRate.setTargetAtTime(rt, now, 0.1);
        },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } };
      api.set(p);
      return api;
    }
  });
})(window.WW);
