// audio_base.js: the first example patch, wired to a real event.
//   gun.big   battleship main-gun boom on 'shellFired' (cal 'big'), with the speed-of-sound delay
// (the ui.click and amb.sea examples moved to audio_amb.js with the rest of the ambience / UI family)
// The full sound families (guns, aircraft, AA, ambience) live in their own audio_*.js files.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A) return;
  const S = A.syn;

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
})(window.WW);
