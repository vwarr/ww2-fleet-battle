// audio_aa.js: anti-aircraft sound family (patches + wiring). Events come from combat_aa.js.
//   aa.heavy     5"/38 (USN) / Type 89 (IJN) salvo report at the ship          <- 'aaHeavyFired'
//   flak.burst   dry crack-whump aloft with an airy tail, ragged timing         <- 'flakBurst'
//   flak.frags   faint patter of fragments into the water under a near burst    <- 'flakBurst'
//   aa.bofors    USN 40 mm: rhythmic pom-pom-pom                                <- 'aaLightFired'
//   aa.oerlikon  USN 20 mm: fast rattle                                         <- 'aaLightFired'
//   aa.25mm      IJN Type 96 25 mm: rattly, uneven chatter                      <- 'aaLightFired'
//   aa.tracer    faint supersonic snap + whiz of a stream passing the camera     <- 'aaLightFired'
//   aa.barrage   one non-positional loop: a far-off rumble that rises with total AA activity
// Density: near guns get their own (capped, throttled) voices; quiet far events feed the barrage bed instead.
// Light AA: each ship has a gate per gun kind, so one ship chugs one burst at a time instead of one sound per stream.
// Sound code uses Math.random only (never WW.rand). Every handler returns at once while sound is off.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A) return;
  const S = A.syn, R = S.rand;
  const nowReal = () => performance.now() / 1000;

  // pulse-train envelope on a gain param: a smooth (setTarget) attack and decay per shot, no clicks between shots
  function pulses(param, times, amps, a, tau) {
    param.setValueAtTime(0, times[0]);
    for (let i = 0; i < times.length; i++) {
      param.setTargetAtTime(amps[i], times[i], a / 3);
      param.setTargetAtTime(0, times[i] + a, tau);
    }
  }
  // A burst of gun shots built on a few shared nodes (one thump oscillator, one body noise, one crack noise).
  // o: { times: [s from t], amps: [], thump: { f0, f1, tau, amp }, body: { noise, type, f, q, tau, amp }, crack: { f, q, tau, amp } }
  function gunTrain(ctx, out, t, k, o) {
    const T = o.times.map(x => t + x / k), last = T[T.length - 1], end = last + 0.6 / k, parts = [];
    if (o.thump) {
      const g = S.gain(ctx, 0, out), os = ctx.createOscillator(); os.type = 'sine'; os.connect(g);
      for (const ti of T) { const j = R(0.95, 1.05); os.frequency.setValueAtTime(o.thump.f0 * k * j, ti); os.frequency.exponentialRampToValueAtTime(o.thump.f1 * k * j, ti + 0.07 / k); }
      pulses(g.gain, T, o.amps.map(x => x * o.thump.amp), 0.003 / k, o.thump.tau / k);
      os.start(t); os.stop(end);
      parts.push({ end, stop(tt) { try { g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.02); os.stop(tt + 0.1); } catch (e) {} } });
    }
    for (const L of [o.body, o.crack]) {
      if (!L) continue;
      const g = S.gain(ctx, 0, out), fl = S.filter(ctx, L.type || 'bandpass', L.f * k, L.q != null ? L.q : 1, g);
      const s = S.src(ctx, L.noise || 'white', t, { rate: k }); s.connect(fl); s.stop(end);
      pulses(g.gain, T, o.amps.map(x => x * L.amp * R(0.85, 1.1)), (L.a || 0.002) / k, L.tau / k);
      parts.push({ end, stop(tt) { try { g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.02); s.stop(tt + 0.1); } catch (e) {} } });
    }
    return S.join(parts);
  }
  // shot times: n shots, gap +- jitter (s); amps vary a little per shot
  function cadence(n, gap, jit) { const t = [0]; for (let i = 1; i < n; i++) t.push(t[i - 1] + gap * R(1 - jit, 1 + jit)); return t; }
  const ampsFor = n => Array.from({ length: n }, () => R(0.75, 1));

  // ---------- heavy AA: 5"/38 / Type 89 salvo ----------
  // params: { ijn: false, size: 1 }
  A.register('aa.heavy', {
    bus: 'sfx', ref: 45, max: 6, minGap: 0.07, sos: true, reverb: 0.4, duck: 0.08, dur: 1.6, params: { ijn: false },
    build(ctx, out, p) {
      const k = p.rate, sz = (p.size || 1) * R(0.9, 1.1), ijn = !!p.ijn, parts = [];
      const shot = (t, g) => {
        parts.push(S.boom(ctx, out, t, { f0: (ijn ? 92 : 104) / Math.sqrt(sz), f1: 42, dur: 0.85 * sz, gain: 0.5 * g, body: 0.75, crack: 0.62, bright: ijn ? 0.9 : 1.05, rate: k }));
        parts.push(S.burst(ctx, out, t + 0.025 / k, { noise: 'pink', type: 'lowpass', f: 1300, f1: 160, q: 0.4, a: 0.02, d: 0.9 * sz, gain: 0.16 * g, rate: k }));
      };
      shot(p.t, 1);
      if (Math.random() < 0.35) shot(p.t + R(0.05, 0.13) / k, R(0.5, 0.75)); // a second mount a beat behind
      return S.done(p, parts);
    }
  });

  // ---------- flak burst aloft ----------
  // params: { size: 1 }
  A.register('flak.burst', {
    bus: 'sfx', ref: 40, max: 10, minGap: 0.015, sos: true, reverb: 0.55, dur: 2,
    build(ctx, out, p) {
      const k = p.rate, sz = (p.size || 1) * R(0.85, 1.15), br = R(0.85, 1.15);
      return S.done(p, [
        S.burst(ctx, out, p.t, { type: 'bandpass', f: 1900 * br, f1: 850, q: 0.9, a: 0.001, d: 0.05, gain: 0.5, rate: k }),          // dry crack
        S.boom(ctx, out, p.t + 0.008 / k, { f0: 112 / Math.sqrt(sz), f1: 50, dur: 0.6 * sz, gain: 0.42, body: 0.6, crack: 0, rate: k }), // whump
        S.burst(ctx, out, p.t + 0.03 / k, { noise: 'pink', type: 'bandpass', f: 720 * br, f1: 300, q: 0.5, a: 0.03, d: 1.4 * sz, gain: 0.13, rate: k }) // airy tail
      ]);
    }
  });

  // ---------- fragments pattering into the water ----------
  A.register('flak.frags', {
    bus: 'sfx', ref: 14, max: 2, minGap: 0.4, sos: false, reverb: 0.2, dur: 2,
    build(ctx, out, p) {
      const k = p.rate, d = R(0.9, 1.5) / k, lp = S.filter(ctx, 'lowpass', 2400 * k, 0.5, out), g = S.gain(ctx, 0, lp); // soft plinks, no fizz
      g.gain.setValueAtTime(0, p.t); g.gain.linearRampToValueAtTime(1, p.t + 0.12 / k); g.gain.setTargetAtTime(0, p.t + d * 0.45, d * 0.2);
      const c = S.crackle(ctx, g, p.t, { dur: d, f: 1400, q: 1, gain: 0.9, density: 0.55, rate: k });
      const c2 = S.crackle(ctx, g, p.t + 0.05 / k, { dur: d, f: 800, q: 1.4, gain: 0.6, density: 0.3, rate: k }); // a few duller plops
      return S.done(p, [c, c2]);
    }
  });

  // ---------- light AA ----------
  // each takes { shots, gap } so the wiring knows the burst length; defaults are random
  A.register('aa.bofors', {
    bus: 'sfx', ref: 22, max: 4, minGap: 0.05, sos: true, reverb: 0.3, dur: 2,
    build(ctx, out, p) {
      const n = p.shots || 3 + Math.floor(Math.random() * 3), times = cadence(n, p.gap || R(0.28, 0.34), 0.08);
      return S.done(p, [gunTrain(ctx, out, p.t, p.rate, { times, amps: ampsFor(n),
        thump: { f0: 150, f1: 62, tau: 0.055, amp: 0.55 },
        body: { noise: 'pink', type: 'lowpass', f: 1300, q: 0.6, tau: 0.06, amp: 0.55, a: 0.003 },
        crack: { type: 'bandpass', f: 1500, q: 0.9, tau: 0.012, amp: 0.3 } })]);
    }
  });
  A.register('aa.oerlikon', {
    bus: 'sfx', ref: 15, max: 4, minGap: 0.05, sos: true, reverb: 0.25, dur: 2,
    build(ctx, out, p) {
      const n = p.shots || 7 + Math.floor(Math.random() * 5), times = cadence(n, p.gap || R(0.115, 0.135), 0.07);
      return S.done(p, [gunTrain(ctx, out, p.t, p.rate, { times, amps: ampsFor(n),
        thump: { f0: 230, f1: 110, tau: 0.03, amp: 0.35 },
        body: { noise: 'pink', type: 'lowpass', f: 2000, q: 0.6, tau: 0.03, amp: 0.35 },
        crack: { type: 'bandpass', f: 1300, q: 1.2, tau: 0.016, amp: 0.4 } })]);
    }
  });
  A.register('aa.25mm', {
    bus: 'sfx', ref: 18, max: 5, minGap: 0.05, sos: true, reverb: 0.25, dur: 2,
    build(ctx, out, p) {
      const n = p.shots || 6 + Math.floor(Math.random() * 5), times = cadence(n, p.gap || R(0.09, 0.12), 0.3); // triple mount, barrels out of step
      return S.done(p, [gunTrain(ctx, out, p.t, p.rate, { times, amps: ampsFor(n),
        thump: { f0: 190, f1: 95, tau: 0.035, amp: 0.4 },
        body: { type: 'bandpass', f: 950, q: 3.5, tau: 0.04, amp: 0.55 },     // a little metallic ring: the rattle
        crack: { type: 'bandpass', f: 1250, q: 1.4, tau: 0.014, amp: 0.38 } })]);
    }
  });

  // ---------- a tracer stream passing close to the camera ----------
  A.register('aa.tracer', {
    bus: 'sfx', ref: 6, max: 2, minGap: 0.15, sos: false, reverb: 0.05, dur: 0.6,
    build(ctx, out, p) {
      const k = p.rate, parts = [], n = Math.random() < 0.5 ? 2 : 1, lp = S.filter(ctx, 'lowpass', 3000 * k, 0.5, out); // supersonic, but not a hiss
      out = lp;
      for (let i = 0; i < n; i++) {
        const t = p.t + i * R(0.05, 0.08) / k, g = i ? 0.6 : 1;
        parts.push(S.burst(ctx, out, t, { type: 'bandpass', f: 1900 * R(0.9, 1.1), q: 1.2, a: 0.001, d: 0.014, gain: 0.4 * g, rate: k }));   // snap
        parts.push(S.burst(ctx, out, t + 0.004 / k, { type: 'bandpass', f: 1700 * R(0.9, 1.1), f1: 550, q: 2.5, a: 0.02, d: 0.2, gain: 0.42 * g, rate: k })); // whiz
      }
      return S.done(p, parts);
    }
  });

  // ---------- distant barrage bed (loop) ----------
  // set({ rate }); level comes from the handle's vol
  A.register('aa.barrage', {
    bus: 'sfx', max: 1, dur: Infinity, reverb: 0,
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out);
      m.gain.setValueAtTime(0, t); m.gain.linearRampToValueAtTime(1, t + 0.8);
      const lp = S.filter(ctx, 'lowpass', 210, 0.5), rum = S.gain(ctx, 0.75, m); lp.connect(rum);
      const br = S.src(ctx, 'brown', t); br.connect(lp);
      // sparse clicks played very slowly: soft, irregular far-off thuds
      const lp2 = S.filter(ctx, 'lowpass', 300, 0.7), th = S.gain(ctx, 2.2, m); lp2.connect(th);
      const cr = S.src(ctx, 'crackle', t, { rate: 0.13 }); cr.connect(lp2);
      const o = ctx.createOscillator(); o.frequency.value = 0.09 + Math.random() * 0.05; o.connect(S.gain(ctx, 0.25, rum.gain)); o.start(t);
      const srcs = [br, cr, o];
      return {
        dur: Infinity,
        set(q) { if (q.rate) { const now = ctx.currentTime; br.playbackRate.setTargetAtTime(q.rate, now, 0.1); cr.playbackRate.setTargetAtTime(0.13 * q.rate, now, 0.1); } },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} }
      };
    }
  });

  // ---------- wiring ----------
  const ACT_TAU = 2.5, BED_MAX = 0.55, BED_K = 14;
  // a gun or burst gets its own voice only above this estimated level (inverse falloff: level = ref / d),
  // i.e. heavy guns within ~250 units, bursts ~200, light AA ~130; anything farther only feeds the barrage bed
  const LOUD = { heavy: 0.18, burst: 0.2, light: 0.13 };
  let act = 0;
  const bed = A.loop('aa.barrage', { ui: true, vol: 0, persist: true });
  const count = WW.audioAA = { heavy: 0, burst: 0, light: 0, tracer: 0, frags: 0, bedOnly: 0, act: 0 };
  A.onUpdate(rdt => {
    act *= Math.exp(-rdt / ACT_TAU);
    if (act < 1e-3) act = 0;
    count.act = act;
    bed.set({ vol: BED_MAX * (1 - Math.exp(-act / BED_K)) });
  });
  // estimated level at the camera; feeds the bed with what near voices do not cover
  function level(x, y, z, ref) { return A.distGain(A.distTo(x, y, z), ref); }
  function feed(w, lv) { act += w * Math.max(0, 1 - lv * 4); }

  WW.on('aaHeavyFired', e => {
    if (!A.live) return;
    try {
      const lv = level(e.x, e.y, e.z, A.patches['aa.heavy'].ref);
      feed(1, lv);
      if (lv < LOUD.heavy) { count.bedOnly++; return; }
      count.heavy++;
      A.play('aa.heavy', { x: e.x, y: e.y, z: e.z, ijn: !!(e.ship && e.ship.nation === 'IJN'), vol: R(0.85, 1) });
    } catch (err) { /* never throw */ }
  });

  WW.on('flakBurst', e => {
    if (!A.live) return;
    try {
      const d = A.distTo(e.x, e.y, e.z), lv = A.distGain(d, A.patches['flak.burst'].ref);
      feed(0.6, lv);
      if (lv < LOUD.burst) { count.bedOnly++; return; }
      count.burst++;
      // a wall of bursts: a random beat per burst so it rolls raggedly instead of ticking
      A.play('flak.burst', { x: e.x, y: e.y, z: e.z, delay: Math.random() * 0.25, vol: R(0.7, 1), size: R(0.9, 1.1) });
      if (d < 70 && Math.random() < 0.4) {
        count.frags++; // fragments fall a few seconds later (plus the sound delay of the burst itself)
        A.play('flak.frags', { x: e.x + R(-4, 4), y: 0, z: e.z + R(-4, 4), delay: A.delayFor(d) + Math.min(2.5, 0.8 + e.y * 0.035) + Math.random() * 0.5, vol: R(0.6, 1) });
      }
    } catch (err) { /* never throw */ }
  });

  // light AA: a gate per ship and gun kind (real seconds), so each mount group plays one burst at a time
  const gates = new WeakMap();
  const KIND = { 'aa.bofors': { shots: [3, 5], gap: [0.28, 0.34] }, 'aa.oerlikon': { shots: [7, 11], gap: [0.115, 0.135] }, 'aa.25mm': { shots: [6, 10], gap: [0.09, 0.12] } };
  WW.on('aaLightFired', e => {
    if (!A.live) return;
    try {
      const s = e.ship; if (!s) return;
      const sy = 3;
      tracerPass(s, e.target);
      const kinds = s.nation === 'IJN' ? ['aa.25mm'] : s.type === 'pt' ? ['aa.oerlikon'] : Math.random() < 0.55 ? ['aa.bofors', 'aa.oerlikon'] : ['aa.oerlikon', 'aa.bofors'];
      const lv = level(s.x, sy, s.z, A.patches[kinds[0]].ref);
      feed(0.25, lv);
      if (lv < LOUD.light) { count.bedOnly++; return; }
      let g = gates.get(s); if (!g) gates.set(s, g = {});
      const now = nowReal();
      for (const name of kinds) {
        if ((g[name] || 0) > now) continue;
        const K = KIND[name], shots = Math.floor(R(K.shots[0], K.shots[1] + 1)), gap = R(K.gap[0], K.gap[1]);
        const v = A.play(name, { x: s.x + R(-3, 3), y: sy, z: s.z + R(-3, 3), shots, gap, vol: R(0.75, 1) });
        g[name] = now + shots * gap * R(1.1, 1.9);   // a pause between bursts, never metronomic
        if (v) count.light++;
        return;
      }
    } catch (err) { /* never throw */ }
  });

  // tracer whiz: closest point of the stream (ship -> target, rounds fly on past it) to the camera
  const TR_SPEED = 85;
  function tracerPass(s, pl) {
    if (!pl) return;
    const L = A.listener, ox = s.x, oy = 2.5, oz = s.z;
    const dx = pl.x - ox, dy = (pl.y || 5) - oy, dz = pl.z - oz, len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1) return;
    const u = ((L.x - ox) * dx + (L.y - oy) * dy + (L.z - oz) * dz) / len2;
    if (u < 0.15 || u > 1.5) return;
    const cx = ox + dx * u, cy = oy + dy * u, cz = oz + dz * u, d = Math.hypot(cx - L.x, cy - L.y, cz - L.z);
    if (d > 10) return;
    count.tracer++;
    const flight = u * Math.sqrt(len2) / TR_SPEED / Math.max(0.05, A.simRate);  // sim s -> real s
    A.play('aa.tracer', { x: cx, y: cy, z: cz, delay: Math.min(1, flight) + Math.random() * 0.05, vol: R(0.6, 0.9) });
  }
})(window.WW);
