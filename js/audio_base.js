// audio_base.js: the first example patches, wired to real events.
//   ui.click  soft click for the panel buttons (ui.js calls it)
//   gun.big   battleship main-gun boom on 'shellFired' (cal 'big'), with the speed-of-sound delay
//   amb.sea   sea ambience loop; its level and brightness follow the camera height
// The full sound families (guns, aircraft, AA, ambience) live in their own audio_*.js files.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A) return;
  const S = A.syn;

  A.register('ui.click', {
    bus: 'ui', max: 4, minGap: 0.03, dur: 0.12,
    build(ctx, out, p) {
      return S.done(p, [
        S.tone(ctx, out, p.t, { f: 1350, f1: 900, a: 0.002, d: 0.06, gain: 0.32 }),
        S.burst(ctx, out, p.t, { type: 'highpass', f: 3500, q: 0.5, a: 0.001, d: 0.018, gain: 0.12 })
      ]);
    }
  });

  // p.size (default 1) scales length and depth
  A.register('gun.big', {
    bus: 'sfx', ref: 70, max: 6, minGap: 0.12, sos: true, reverb: 0.45, duck: 0.3, dur: 3,
    build(ctx, out, p) {
      const k = p.size || 1;
      return S.done(p, [
        S.boom(ctx, out, p.t, { f0: 64 / Math.sqrt(k), f1: 27, dur: 2.2 * k, gain: 0.6, body: 1, crack: 0.55, rate: p.rate }),
        S.burst(ctx, out, p.t + 0.05 / p.rate, { noise: 'pink', type: 'lowpass', f: 900, f1: 120, q: 0.3, a: 0.05, d: 1.6 * k, gain: 0.3, rate: p.rate })
      ]);
    }
  });
  WW.on('shellFired', e => { if (e.cal === 'big') A.play('gun.big', e); });

  // loop: { height } (camera height, units) darkens and thins the surf high up; { rate }
  A.register('amb.sea', {
    bus: 'ambience', max: 1, dur: Infinity,
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out);
      m.gain.setValueAtTime(0, t); m.gain.linearRampToValueAtTime(1, t + 1.5);
      const lp = S.filter(ctx, 'lowpass', 420, 0.5), swell = S.gain(ctx, 0.55, m); lp.connect(swell);
      const br = S.src(ctx, 'brown', t); br.connect(lp);
      const bp = S.filter(ctx, 'bandpass', 1100, 0.6), hiss = S.gain(ctx, 0.16, m); bp.connect(hiss);
      const pk = S.src(ctx, 'pink', t); pk.connect(bp);
      const lfo = (f, depth, param) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(S.gain(ctx, depth, param)); o.start(t); return o; };
      const l1 = lfo(0.07 + Math.random() * 0.02, 0.25, swell.gain), l2 = lfo(0.11 + Math.random() * 0.03, 0.08, hiss.gain);
      const srcs = [br, pk, l1, l2];
      const api = {
        dur: Infinity,
        set(q) {
          const now = ctx.currentTime;
          if (q.height != null) {
            const h = Math.max(0, q.height);
            lp.frequency.setTargetAtTime(Math.max(160, 420 - h * 0.7), now, 0.3);
            bp.frequency.setTargetAtTime(Math.max(500, 1100 - h * 1.8), now, 0.3);
            hiss.gain.setTargetAtTime(0.16 * Math.max(0.2, 1 - h / 250), now, 0.3);
          }
          if (q.rate) { br.playbackRate.setTargetAtTime(q.rate, now, 0.1); pk.playbackRate.setTargetAtTime(q.rate, now, 0.1); }
        },
        stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} }
      };
      api.set(p); // start at the current camera height
      return api;
    }
  });
  const sea = A.loop('amb.sea', { ui: true, vol: 0.8, persist: true });
  let lastH = -1e9;
  A.onUpdate(() => {
    const h = WW.camera ? WW.camera.position.y : 60;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    sea.set({ vol: 0.8 * Math.max(0.18, Math.min(1, 1.15 - h / 260)), height: h });
  });
})(window.WW);
