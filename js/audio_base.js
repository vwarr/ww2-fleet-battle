// audio_base.js: the island base's sounds (it first held the example patches ui.click, amb.sea, gun.big, which now
// live in their sound families: audio_amb.js, audio_naval.js). See docs/AUDIO.md.
//   base.siren  shot  the air-raid siren at the base's alarm ('baseAlarm', island_base.js): a motor siren winding up
//                     to a wail, holding, falling away, twice (~16 s), from the control tower; heard across the map
// Like every patch, play() is a no-op while sound is off (muted), so nothing here costs anything then.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.syn) return;
  const S = A.syn;
  A.register('base.siren', {
    bus: 'sfx', max: 1, minGap: 10, dur: 18, ref: 140, sos: true, reverb: 0.35, params: { cycles: 2 },
    build(ctx, out, p) {
      const k = p.rate || 1, lo = 140 * k, hi = 560 * k, srcs = [];
      const bp = S.filter(ctx, 'bandpass', 900, 0.7), lp = S.filter(ctx, 'lowpass', 2600, 0.6), g = S.gain(ctx, 0, out);
      bp.connect(lp); lp.connect(g);
      let t = p.t; const t0 = t;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 1.2);
      const osc = [['sawtooth', 1, 0.6], ['square', 1.005, 0.3], ['sawtooth', 2.01, 0.15]].map(([type, m, a]) => {
        const o = ctx.createOscillator(), og = S.gain(ctx, a, bp); o.type = type; o.connect(og); o.frequency.setValueAtTime(lo * m, t); srcs.push(o); return [o, m];
      });
      for (let c = 0; c < (p.cycles || 2); c++) {   // wind up (3 s), the wail (2.5 s, a slow wobble), fall away (2.6 s)
        for (const [o, m] of osc) {
          o.frequency.setTargetAtTime(hi * m, t, 1.0);
          for (let w = 0; w < 5; w++) o.frequency.setTargetAtTime(hi * m * (w % 2 ? 0.985 : 1.01), t + 3 + w * 0.5, 0.2);
          o.frequency.setTargetAtTime(lo * 0.8 * m, t + 5.5, 1.1);
        }
        t += 8.1;
      }
      g.gain.setValueAtTime(0.2, t - 2.2); g.gain.setTargetAtTime(0, t - 2.2, 0.9);
      for (const [o] of osc) { o.start(t0); o.stop(t + 1.5); }
      return { dur: t - t0 + 2, stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } };
    }
  });
  // the siren at the alarm, from the tower (or the base's centre)
  WW.on('baseAlarm', e => {
    if (!A.live || !e || !e.base) return;
    const tw = e.base.facilities && e.base.facilities.find(f => f.kind === 'tower');
    A.play('base.siren', { x: tw ? tw.x : e.x, y: 8, z: tw ? tw.z : e.z, vol: 1 });
  });
})(window.WW);
