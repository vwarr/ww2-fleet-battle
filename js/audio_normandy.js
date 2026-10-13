// audio_normandy.js: the sound patches of Normandy (Omaha Beach and Pointe du Hoc, D-Day): the surf, the run-in, the
// German fire, the American squads, the LCT(R) rocket barrage and the planes over the cloud. Events and polling that
// play them: audio_normandy_wire.js (Normandy only). Same engine, graph, listener and rules as every family
// (docs/AUDIO.md): Math.random only, nodes only through ctx.createX(), build() works in a live or an offline context.
// What the Pacific families already play in Normandy, and is not doubled here: the ships' guns and their shells
// (gun.big / gun.dd / gun.med, shell.whistle, shell.splash, shell.land: Texas, Arkansas and the destroyers, the German
// casemates' and the 155s' reports, the Shermans' 75 mm as gun.small), the P-47s' guns (gun.mg on 'shellFired' cal mg),
// bomb impacts (audio_air.js weaponImpact), the sea and wind beds (amb.sea, amb.wind: WW.wind is the scenario's WNW
// force 4-5), the 2 cm Flak (aa.oerlikon, played from here at the gun).
// Scale: 1 u ~ 9.6 m here (a man is a speck, an LCVP 1.5 u): the refs below are a few u for small arms, tens for guns.
//   beach.breaker  shot  a breaker crashing on the flat: the lip, the body thump, the foam running up and hissing back
//   beach.wash     loop  the bore and the swash at the waterline (positional, follows the tide in)
//   beach.gust     loop  non-positional: gusts off the sea through the wire and over the sand (panned toward the WNW)
//   beach.gull     shot  the gulls over the flat at first light (only before H-hour; amb.gull is held off in Normandy)
//   craft.engine   loop  a landing craft's diesel: type lcvp|lca|lcm (Gray Marine 6-71 clatter), lct (three, deeper),
//                        lci (the GM quads: heavy), dd (a swimming tank), tank (a Sherman ashore); set({ thr })
//   craft.slap     shot  the bow slamming into a sea, the spray coming over
//   craft.ground   shot  the keel grinding onto the sand
//   craft.ramp     shot  the ramp chain paying out, the ramp slamming down, the splash
//   craft.wreck    shot  a craft hit and wrecked: the shell bursting in the well, the steel torn, the water
//   craft.mine     shot  a Teller mine on an obstacle under the bow: a heavy wet blast and the water column
//   craft.founder  shot  a DD tank swamped: the screen collapsing, the sea pouring in, the bubbles
//   craft.holed    shot  holed on a stake: a crunch and a scrape
//   ger.mg42       shot  an MG 42 burst (p.dur s at ~1,200 rpm): the tearing buzz-saw, rounds too fast to hear apart
//   ger.pak        shot  the hard high-velocity crack of an 88/75 in its casemate and the slap-back off the concrete and the
//                        bluff (laid over the naval family's gun report, not a second boom)
//   ger.mortar.fire    shot  an 8 cm mortar firing: the hollow tube "thoonk"
//   ger.mortar.whistle shot  a bomb coming down near the camera: a short falling whistle (0.7 s, its loudest at the end)
//   ger.mortar.burst   shot  the crump, the earth and shingle thrown up (p.size 0.5 for a grenade)
//   bullet.snap    shot  a round passing the camera: the supersonic crack
//   bullet.rico    shot  a ricochet off an obstacle: a falling whine
//   bullet.thud    shot  rounds into the sand nearby
//   us.rifle       shot  M1 Garands: p.n shots out of step; p.ping: the empty clip's ping
//   us.bar         shot  a BAR burst (~550 rpm)
//   us.bazooka     shot  the rocket's whoosh and its burst on the embrasure (p.fl s later)
//   us.bangalore   shot  a Bangalore torpedo: a sharp heavy blast, the wire whipping, shingle coming down
//   land.big       shot  a 14"/12" shell on the bluff (over shell.land): the ground heaving, the earth and chalk raining
//   rocket.ripple  loop  an LCT(R) firing: a thousand 5-inch rockets in ripples, a roar and a crackle (vol: the launch rate)
//   rocket.whoosh  shot  rockets passing over the camera
//   rocket.carpet  shot  a patch of rockets landing: p.n bursts (or splashes, p.wet 0..1) over p.span s
//   air.b24        loop  a box of B-24s above the overcast: four engines each, beating, muffled by the cloud
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.syn) return;
  const S = A.syn, R = S.rand;
  const V = (x, a) => x * R(1 - (a || 0.08), 1 + (a || 0.08));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function osc(ctx, type, f, t) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); return o; }
  const part = (srcs, end) => ({ end, stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} } });
  // pulse-train envelope on a gain param (one per round: a fast attack, an exponential decay), no clicks between rounds
  function pulses(param, times, amps, a, tau) {
    param.setValueAtTime(0, times[0]);
    for (let i = 0; i < times.length; i++) { param.setTargetAtTime(amps[i], times[i], a / 3); param.setTargetAtTime(0, times[i] + a, tau); }
  }
  // a train of rounds on three shared sources (crack noise, body noise, thump oscillator). o: { times (ctx s), amps,
  // crack: { f, q, tau, amp }, body: { f, tau, amp }, thump: { f0, f1, tau, amp } }
  function train(ctx, out, o) {
    const T = o.times, t0 = T[0], end = T[T.length - 1] + 0.4, srcs = [];
    if (o.crack) {
      const n = S.src(ctx, 'white', t0), bp = S.filter(ctx, 'bandpass', o.crack.f, o.crack.q), g = S.gain(ctx, 0, out);
      n.connect(bp); bp.connect(g); pulses(g.gain, T, o.amps.map(a => a * o.crack.amp), 0.0015, o.crack.tau); n.stop(end); srcs.push(n);
    }
    if (o.body) {
      const n = S.src(ctx, 'pink', t0), lp = S.filter(ctx, 'lowpass', o.body.f, 0.6), g = S.gain(ctx, 0, out);
      n.connect(lp); lp.connect(g); pulses(g.gain, T, o.amps.map(a => a * o.body.amp), 0.003, o.body.tau); n.stop(end); srcs.push(n);
    }
    if (o.thump) {
      const th = o.thump, s = osc(ctx, 'sine', th.f0, t0), g = S.gain(ctx, 0, out);
      for (const t of T) { s.frequency.setValueAtTime(th.f0 * R(0.95, 1.05), t); s.frequency.setTargetAtTime(th.f1, t + 0.004, th.tau); }
      s.connect(g); pulses(g.gain, T, o.amps.map(a => a * th.amp), 0.002, th.tau); s.stop(end); srcs.push(s);
    }
    return part(srcs, end);
  }
  // one gunshot: crack, thump, a tail rolling off the bluffs. o: { f (crack band), g, tail, low }
  function shot(ctx, out, t, r, o) {
    const g = o.g || 1;
    return [
      S.burst(ctx, out, t, { type: 'bandpass', f: V(o.f || 1700, 0.12), f1: 700, q: 0.8, a: 0.001, d: 0.045, gain: 0.5 * g, rate: r }),
      S.tone(ctx, out, t, { f: V(o.low || 150), f1: 60, a: 0.001, d: 0.07, gain: 0.32 * g, rate: r }),
      S.burst(ctx, out, t + 0.02 / r, { noise: 'pink', type: 'lowpass', f: 1300, f1: 250, q: 0.4, a: 0.02, d: o.tail || 0.4, gain: 0.13 * g, rate: r })
    ];
  }
  // metallic clang: inharmonic partials (the ramp, a hull torn open)
  function clang(ctx, out, t, o) {
    const parts = [], f = o.f, r = o.rate || 1;
    [[1, 1, 1], [2.32, 0.6, 0.7], [3.87, 0.38, 0.5], [5.4, 0.2, 0.35]].forEach(([m, g, d]) => {
      parts.push(S.tone(ctx, out, t + R(0, 0.006), { f: f * m * R(0.98, 1.02), f1: f * m * 0.97, glide: 1, a: 0.002, d: o.d * d, gain: o.gain * g, rate: r }));
    });
    return parts;
  }
  function bubbles(ctx, out, t, o) {
    const parts = [], r = o.rate || 1;
    for (let i = 0; i < o.n; i++) {
      const f = V(o.f || 260, 0.4), tt = t + Math.pow(Math.random(), 0.8) * o.span / r;
      parts.push(S.tone(ctx, out, tt, { f, f1: f * R(1.6, 2.4), glide: 0.9, a: 0.004, d: R(0.03, 0.08), gain: (o.gain || 0.1) * R(0.4, 1), rate: r }));
    }
    return parts;
  }
  // a water column: the slap, the column rushing up, the spray falling back
  function water(ctx, out, t, r, k, g) {
    return [
      S.tone(ctx, out, t, { f: V(70) / Math.sqrt(k), f1: 36, a: 0.003, d: 0.25 * k, gain: 0.35 * g, rate: r }),
      S.burst(ctx, out, t + 0.02 / r, { noise: 'pink', type: 'lowpass', f: 1500, f1: 450, q: 0.4, a: 0.08, d: 0.8 * k, gain: 0.25 * g, rate: r }),
      S.burst(ctx, out, t + R(0.6, 0.9) * k / r, { noise: 'pink', type: 'bandpass', f: V(1700, 0.15), f1: 800, q: 0.5, a: 0.2, d: 1.1 * k, gain: 0.12 * g, rate: r })
    ];
  }
  // a continuous source's api for loops: set(q) with rate, stop
  function loopEnd(srcs) { return tt => { for (const s of srcs) try { s.stop(tt); } catch (e) {} }; }

  // ======================= the beach =======================
  A.register('beach.breaker', {
    bus: 'ambience', ref: 26, max: 4, minGap: 0.05, sos: true, reverb: 0.25, dur: 4, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = clamp(p.size || 1, 0.3, 1.6), parts = [];
      // the lip coming over: pink noise whose low-pass opens with the crash, then closes as it spills
      const n = S.src(ctx, 'pink', t, { rate: r }), lp = S.filter(ctx, 'lowpass', 300 * r, 0.6), g = S.gain(ctx, 0, out);
      n.connect(lp); lp.connect(g);
      const tc = t + R(0.18, 0.3) / r, end = t + (2.6 + 0.8 * k) / r;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1 * k, tc - 0.05 / r); g.gain.linearRampToValueAtTime(0.42 * k, tc + 0.04 / r);
      g.gain.setTargetAtTime(0.12 * k, tc + 0.1 / r, 0.35 / r); g.gain.setTargetAtTime(0, tc + 0.9 / r, 0.5 / r);
      lp.frequency.setValueAtTime(300 * r, t); lp.frequency.linearRampToValueAtTime(V(2300) * r, tc + 0.05 / r); lp.frequency.setTargetAtTime(700 * r, tc + 0.15 / r, 0.5 / r);
      n.stop(end); parts.push(part([n], end));
      parts.push(S.burst(ctx, out, tc, { noise: 'brown', type: 'lowpass', f: 170, f1: 70, q: 0.6, a: 0.02, d: 0.7 * k, gain: 0.45 * k, rate: r })); // the body thump
      // the foam running up and the backwash hissing down the sand
      parts.push(S.burst(ctx, out, tc + 0.3 / r, { noise: 'white', type: 'bandpass', f: V(2100, 0.1), f1: 1500, q: 0.55, a: 0.5, d: 1.4, s: 0.5, hold: 0.4, r: 0.9, gain: 0.07 * k, rate: r }));
      return S.done(p, parts);
    }
  });
  A.register('beach.wash', {
    bus: 'ambience', ref: 20, max: 1, reverb: 0.15, dur: Infinity, params: { rough: 0.8 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out); m.gain.setTargetAtTime(1, t, 0.8);
      const a = S.src(ctx, 'pink', t), ab = S.filter(ctx, 'bandpass', V(600), 0.6), ag = S.gain(ctx, 0.12, m); a.connect(ab); ab.connect(ag);
      const b = S.src(ctx, 'white', t), bb = S.filter(ctx, 'bandpass', V(1900), 0.7), bg = S.gain(ctx, 0.035, m); b.connect(bb); bb.connect(bg);
      const l1 = osc(ctx, 'sine', V(0.21, 0.2), t), l2 = osc(ctx, 'sine', V(0.13, 0.2), t);
      l1.connect(S.gain(ctx, 0.07, ag.gain)); l2.connect(S.gain(ctx, 0.025, bg.gain));   // the bore surging, the swash breathing
      const srcs = [a, b, l1, l2];
      return { dur: Infinity, stop: loopEnd(srcs),
        set(q) { const now = ctx.currentTime; if (q.rate) { a.playbackRate.setTargetAtTime(q.rate, now, 0.1); b.playbackRate.setTargetAtTime(q.rate, now, 0.1); } } };
    }
  });
  A.register('beach.gust', {
    bus: 'ambience', max: 1, dur: Infinity, params: { pan: 0 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out); m.gain.setTargetAtTime(1, t, 1);
      const pn = ctx.createStereoPanner(); pn.pan.value = clamp(p.pan || 0, -0.8, 0.8); pn.connect(m);
      // two gust bands (low buffeting, the wire singing a little) on slow random-ish curves (sum of slow sines)
      const n = S.src(ctx, 'pink', t), lp = S.filter(ctx, 'bandpass', 380, 0.5), g = S.gain(ctx, 0.12, pn); n.connect(lp); lp.connect(g);
      const w = S.src(ctx, 'white', t), bp = S.filter(ctx, 'bandpass', V(1250), 4), wg = S.gain(ctx, 0.008, pn); w.connect(bp); bp.connect(wg);
      const s = S.src(ctx, 'white', t), sb = S.filter(ctx, 'bandpass', 3200, 0.8), sg = S.gain(ctx, 0.012, pn); s.connect(sb); sb.connect(sg); // sand blowing
      const l1 = osc(ctx, 'sine', V(0.11, 0.3), t), l2 = osc(ctx, 'sine', V(0.29, 0.3), t), l3 = osc(ctx, 'sine', V(0.07, 0.3), t);
      l1.connect(S.gain(ctx, 0.07, g.gain)); l2.connect(S.gain(ctx, 0.04, g.gain)); l2.connect(S.gain(ctx, 0.006, wg.gain));
      l1.connect(S.gain(ctx, 160, lp.frequency)); l3.connect(S.gain(ctx, 0.008, sg.gain)); l3.connect(S.gain(ctx, 90, bp.frequency));
      const srcs = [n, w, s, l1, l2, l3];
      return { dur: Infinity, stop: loopEnd(srcs),
        set(q) { const now = ctx.currentTime; if (q.pan != null) pn.pan.setTargetAtTime(clamp(q.pan, -0.8, 0.8), now, 0.5); } };
    }
  });
  // the gulls: amb.gull's own recipe under a Normandy name (held to before H-hour by the wire)
  if (A.patches['amb.gull']) A.register('beach.gull', Object.assign({}, A.patches['amb.gull'], { ref: 40, max: 2, minGap: 1.5 }));

  // ======================= the run-in =======================
  // f: firing tone at full power (Hz), n: engines (beating), lp: tone ceiling, wash: bow-wave level, clat: diesel clatter
  const CRAFT = {
    lcvp: { f: 118, n: 1, lp: 900, wash: 0.16, clat: 0.5, sub: 0.12, g: 0.85 },
    lca: { f: 104, n: 2, lp: 800, wash: 0.15, clat: 0.35, sub: 0.12, g: 0.8 },
    lcm: { f: 98, n: 2, lp: 850, wash: 0.17, clat: 0.45, sub: 0.15, g: 0.9 },
    lct: { f: 72, n: 3, lp: 600, wash: 0.2, clat: 0.4, sub: 0.22, g: 1 },
    lci: { f: 62, n: 2, lp: 520, wash: 0.24, clat: 0.3, sub: 0.26, g: 1 },
    dd: { f: 54, n: 1, lp: 420, wash: 0.1, clat: 0.2, sub: 0.14, g: 0.7 },
    tank: { f: 46, n: 2, lp: 380, wash: 0, clat: 0.55, sub: 0.2, g: 0.8 }
  };
  A.register('craft.engine', {
    ref: 9, max: 5, reverb: 0.1, dur: Infinity, params: { type: 'lcvp', thr: 1 },
    build(ctx, out, p) {
      const C = CRAFT[p.type] || CRAFT.lcvp, t = p.t, m = S.gain(ctx, 0, out), srcs = [];
      m.gain.setTargetAtTime(1, t, 0.4);
      const lp = S.filter(ctx, 'lowpass', C.lp, 1.2), body = S.gain(ctx, 0.18 * C.g, m); lp.connect(body);
      const det = [1, 1.012, 0.991], os = [];
      for (let i = 0; i < C.n; i++) { const o = osc(ctx, 'sawtooth', C.f, t); o.connect(S.gain(ctx, 1 / C.n, lp)); os.push(o); srcs.push(o); }
      const sub = osc(ctx, 'triangle', C.f / 2, t); sub.connect(S.gain(ctx, C.sub, m)); srcs.push(sub);
      // the clatter: band noise gated by a square at the firing rate (two-stroke diesel knock)
      const cn = S.src(ctx, 'white', t), cb = S.filter(ctx, 'bandpass', V(1200), 0.9), cg = S.gain(ctx, 0, m); cn.connect(cb); cb.connect(cg); srcs.push(cn);
      const gate = osc(ctx, 'square', C.f / 2, t); gate.connect(S.gain(ctx, 0.03 * C.clat, cg.gain)); srcs.push(gate);
      cg.gain.value = 0.03 * C.clat;
      // the wash: the bow wave and the hull working in the sea (a slow surge)
      const wn = S.src(ctx, 'pink', t), wb = S.filter(ctx, 'bandpass', V(520), 0.5), wg = S.gain(ctx, 0, m); wn.connect(wb); wb.connect(wg); srcs.push(wn);
      const sl = osc(ctx, 'sine', V(0.19, 0.3), t); sl.connect(S.gain(ctx, C.wash * 0.35, wg.gain)); srcs.push(sl);
      let th = 1, rt = p.rate || 1;
      const api = { dur: Infinity, stop: loopEnd(srcs),
        set(q) {
          const now = ctx.currentTime;
          if (q.thr != null) th = clamp(q.thr, 0, 1.1);
          if (q.rate) rt = q.rate;
          const f = C.f * (0.55 + 0.45 * th) * rt;
          os.forEach((o, i) => o.frequency.setTargetAtTime(f * det[i], now, 0.6));
          sub.frequency.setTargetAtTime(f / 2, now, 0.6); gate.frequency.setTargetAtTime(f / 2, now, 0.6);
          lp.frequency.setTargetAtTime(C.lp * (0.6 + 0.5 * th) * rt, now, 0.6);
          body.gain.setTargetAtTime(0.18 * C.g * (0.55 + 0.45 * th), now, 0.6);
          wg.gain.setTargetAtTime(C.wash * th, now, 0.8); wn.playbackRate.setTargetAtTime(rt, now, 0.1);
        } };
      api.set(p);
      return api;
    }
  });
  A.register('craft.slap', {
    ref: 7, max: 4, minGap: 0, reverb: 0.1, dur: 1.2, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(95, 0.15), f1: 48, a: 0.002, d: 0.08 * k, gain: 0.4 * k, rate: r }),
        S.burst(ctx, out, t, { type: 'bandpass', f: V(700), f1: 300, q: 0.8, a: 0.002, d: 0.07, gain: 0.25 * k, rate: r }),
        S.burst(ctx, out, t + R(0.08, 0.16) / r, { noise: 'pink', type: 'bandpass', f: V(1600, 0.15), f1: 900, q: 0.5, a: 0.06, d: 0.45 * k, gain: 0.16 * k, rate: r }) // the spray over the ramp
      ]);
    }
  });
  A.register('craft.ground', {
    ref: 8, max: 2, minGap: 0.2, sos: true, reverb: 0.1, dur: 1.5,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(60), f1: 40, a: 0.01, d: 0.25, gain: 0.3, rate: r }),
        S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 600, f1: 200, q: 0.6, a: 0.05, d: 0.7, gain: 0.4, rate: r }), // the keel in the sand
        S.burst(ctx, out, t + 0.05 / r, { noise: 'pink', type: 'bandpass', f: V(1100), f1: 600, q: 1.2, a: 0.05, d: 0.5, gain: 0.12, rate: r })
      ]);
    }
  });
  A.register('craft.ramp', {
    ref: 10, max: 3, minGap: 0.1, sos: true, reverb: 0.25, dur: 2.2,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, parts = [], td = t + R(0.35, 0.55) / r;
      parts.push(S.crackle(ctx, out, t, { dur: td - t + 0.02, f: 1800, q: 0.9, gain: 0.35, density: 1.4, rate: r }));       // the chain paying out
      parts.push.apply(parts, clang(ctx, out, td, { f: V(118, 0.1), d: 0.6, gain: 0.07, rate: r }));                    // the ramp slamming down
      parts.push(S.boom(ctx, out, td, { f0: V(80), f1: 40, dur: 0.45, gain: 0.4, body: 0.7, crack: 0.3, bright: 0.6, rate: r }));
      parts.push.apply(parts, water(ctx, out, td + 0.03 / r, r, 0.6, 0.7));                                               // the splash
      return S.done(p, parts);
    }
  });
  A.register('craft.wreck', {
    ref: 22, max: 3, minGap: 0.12, sos: true, reverb: 0.4, duck: 0.2, dur: 3.5, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      const parts = clang(ctx, out, t, { f: V(190, 0.15), d: 0.5, gain: 0.05, rate: r });
      parts.push(S.boom(ctx, out, t, { f0: V(66) / Math.sqrt(k), f1: 30, dur: 1.1 * k, gain: 0.5, body: 0.9, crack: 0.45, bright: 0.8, rate: r }));
      parts.push(S.crackle(ctx, out, t + 0.02 / r, { dur: 0.6 * k, f: 1300, q: 0.7, gain: 0.35, density: 0.9, rate: r }));
      parts.push.apply(parts, water(ctx, out, t + 0.1 / r, r, 0.8 * k, 0.6));
      return S.done(p, parts);
    }
  });
  A.register('craft.mine', {
    ref: 28, max: 2, minGap: 0.2, sos: true, reverb: 0.45, duck: 0.35, dur: 4.5,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const parts = [S.boom(ctx, out, t, { f0: V(46), f1: 22, dur: 1.9, gain: 0.5, body: 1, crack: 0.35, bright: 0.6, rate: r })];
      parts.push.apply(parts, water(ctx, out, t + 0.06 / r, r, 1.5, 0.9));
      parts.push.apply(parts, clang(ctx, out, t + R(0.4, 0.8) / r, { f: V(240, 0.2), d: 0.3, gain: 0.03, rate: r }));    // a bit of the boat coming down
      return S.done(p, parts);
    }
  });
  A.register('craft.founder', {
    ref: 12, max: 2, minGap: 0.3, sos: true, reverb: 0.25, dur: 4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const parts = [S.burst(ctx, out, t, { noise: 'brown', type: 'lowpass', f: 420, f1: 150, q: 0.5, a: 0.3, d: 1.5, s: 0.4, hold: 0.6, r: 0.8, gain: 0.35, rate: r })]; // the sea pouring in
      parts.push(S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(900), f1: 500, q: 0.6, a: 0.05, d: 0.5, gain: 0.15, rate: r }));   // the screen collapsing
      parts.push.apply(parts, bubbles(ctx, out, t + 0.6 / r, { n: 14, span: 2.4, f: 200, gain: 0.13, rate: r }));
      return S.done(p, parts);
    }
  });
  A.register('craft.holed', {
    ref: 9, max: 2, minGap: 0.2, sos: true, reverb: 0.15, dur: 1.2,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      const parts = clang(ctx, out, t, { f: V(260, 0.15), d: 0.25, gain: 0.04, rate: r });
      parts.push(S.burst(ctx, out, t, { type: 'bandpass', f: V(650), f1: 260, q: 0.9, a: 0.003, d: 0.2, gain: 0.35, rate: r }));
      parts.push(S.burst(ctx, out, t + 0.05 / r, { noise: 'pink', type: 'bandpass', f: 1300, f1: 500, q: 1.4, a: 0.05, d: 0.5, gain: 0.14, rate: r })); // the scrape
      return S.done(p, parts);
    }
  });

  // ======================= the German fire =======================
  // MG 42: ~1,200 rpm (20 a second), a little uneven; p.dur s. Each round: a sharp crack band, a short body, a thump.
  A.register('ger.mg42', {
    ref: 8, max: 8, sos: true, reverb: 0.3, dur: 1.6, params: { dur: 0.6, rpm: 1200 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, dur = clamp(p.dur || 0.6, 0.12, 2.2), gap = 60 / (p.rpm || 1200) * R(0.95, 1.06) / r, times = [], amps = [];
      for (let x = 0; x < dur / r; x += gap) { times.push(t + x + R(0, 0.004)); amps.push(R(0.75, 1)); }
      const last = times.length - 1; amps[0] *= 1.15;
      const parts = [train(ctx, out, { times, amps, crack: { f: V(1500, 0.1) * r, q: 0.7, tau: 0.009, amp: 0.55 }, body: { f: 1100 * r, tau: 0.02, amp: 0.45 }, thump: { f0: 150 * r, f1: 75 * r, tau: 0.018, amp: 0.3 } })];
      parts.push(S.burst(ctx, out, times[last] + 0.04 / r, { noise: 'pink', type: 'lowpass', f: 900, f1: 220, q: 0.4, a: 0.05, d: 0.5, gain: 0.1, rate: r })); // rolling off the bluff
      return S.done(p, parts);
    }
  });
  A.register('ger.pak', {
    ref: 26, max: 3, minGap: 0, sos: true, reverb: 0.45, dur: 1.6, params: { big: 0 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, big = p.big ? 1 : 0;
      return S.done(p, [
        S.burst(ctx, out, t, { type: 'bandpass', f: V(2100 - 600 * big), f1: 900, q: 0.7, a: 0.001, d: 0.06, gain: 0.45, rate: r }),   // the whip-crack
        S.burst(ctx, out, t, { type: 'bandpass', f: V(800), f1: 300, q: 0.8, a: 0.002, d: 0.12, gain: 0.3, rate: r }),
        S.burst(ctx, out, t + R(0.12, 0.25) / r, { noise: 'pink', type: 'bandpass', f: V(700), f1: 260, q: 0.6, a: 0.01, d: 0.4 + 0.3 * big, gain: 0.2, rate: r }) // the slap-back
      ]);
    }
  });
  A.register('ger.mortar.fire', {
    ref: 10, max: 3, minGap: 0, sos: true, reverb: 0.3, dur: 1,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(210), f1: 85, a: 0.002, d: 0.14, gain: 0.45, rate: r }),
        S.tone(ctx, out, t, { f: V(340), f1: 320, glide: 1, a: 0.002, d: 0.22, gain: 0.08, rate: r }),            // the tube ringing
        S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(450), f1: 200, q: 0.8, a: 0.002, d: 0.18, gain: 0.3, rate: r })
      ]);
    }
  });
  A.register('ger.mortar.whistle', {
    ref: 9, max: 3, minGap: 0.12, reverb: 0.1, dur: 0.9,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, end = t + 0.72 / r, f = V(1500, 0.1) * r;
      const o = osc(ctx, 'sine', f, t), g = S.gain(ctx, 0, out);
      o.frequency.exponentialRampToValueAtTime(f * 0.55, end); o.connect(g); o.stop(end + 0.03);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.3 / r); g.gain.linearRampToValueAtTime(0.2, end - 0.02 / r); g.gain.linearRampToValueAtTime(0, end);
      const n = S.burst(ctx, out, t + 0.2 / r, { noise: 'pink', type: 'bandpass', f: 900, f1: 500, q: 1.2, a: 0.45, d: 0.08, gain: 0.12, rate: r });
      return { dur: end - t + 0.05, stop(tt) { try { o.stop(tt); } catch (e) {} n.stop(tt); } };
    }
  });
  A.register('ger.mortar.burst', {
    ref: 16, max: 4, minGap: 0, sos: true, reverb: 0.35, duck: 0.12, dur: 2.2, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(95) / Math.sqrt(k), f1: 42, dur: 0.75 * k, gain: 0.48, body: 0.85, crack: 0.55, bright: 1, rate: r }),
        S.burst(ctx, out, t + 0.08 / r, { noise: 'brown', type: 'lowpass', f: 800, f1: 200, q: 0.4, a: 0.05, d: 0.6 * k, gain: 0.3, rate: r }),   // the earth thrown up
        S.crackle(ctx, out, t + R(0.2, 0.4) / r, { dur: 0.6 * k, f: 1500, q: 0.6, gain: 0.18, density: 0.6, rate: r })                        // shingle and stones coming down
      ]);
    }
  });
  // rounds past and around the camera
  A.register('bullet.snap', {
    ref: 4, max: 4, minGap: 0, reverb: 0.05, dur: 0.3,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.burst(ctx, out, t, { type: 'bandpass', f: V(2600, 0.15), q: 0.6, a: 0.0005, d: 0.012, gain: 0.5, rate: r }),
        S.burst(ctx, out, t + 0.003, { type: 'bandpass', f: V(1100), q: 1, a: 0.001, d: 0.04, gain: 0.2, rate: r })
      ]);
    }
  });
  A.register('bullet.rico', {
    ref: 5, max: 2, minGap: 0.15, reverb: 0.15, dur: 0.8,
    build(ctx, out, p) {
      const r = p.rate, t = p.t, d = R(0.3, 0.55) / r, f = V(2600, 0.15) * r;
      const o = osc(ctx, 'sine', f, t), g = S.gain(ctx, 0, out); o.connect(g);
      o.frequency.exponentialRampToValueAtTime(f * R(0.3, 0.45), t + d); o.stop(t + d + 0.03);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.01); g.gain.setTargetAtTime(0, t + d * 0.4, d * 0.25);
      const c = S.burst(ctx, out, t, { type: 'bandpass', f: V(1800), q: 1.4, a: 0.001, d: 0.03, gain: 0.3, rate: r });   // the strike
      return { dur: d + 0.1, stop(tt) { try { o.stop(tt); } catch (e) {} c.stop(tt); } };
    }
  });
  A.register('bullet.thud', {
    ref: 4, max: 3, minGap: 0, reverb: 0.05, dur: 0.4,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(120, 0.2), f1: 60, a: 0.001, d: 0.04, gain: 0.3, rate: r }),
        S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(1500, 0.2), f1: 700, q: 0.7, a: 0.002, d: 0.12, gain: 0.2, rate: r })   // the sand kicked up
      ]);
    }
  });

  // ======================= the American side =======================
  A.register('us.rifle', {
    ref: 6, max: 6, minGap: 0, sos: true, reverb: 0.3, dur: 2.5, params: { n: 2, ping: 0 },
    build(ctx, out, p) {
      const r = p.rate, n = clamp(p.n || 1, 1, 5), parts = [];
      let t = p.t;
      for (let i = 0; i < n; i++) { parts.push.apply(parts, shot(ctx, out, t, r, { f: 1900, g: R(0.7, 1), tail: 0.35 })); t += R(0.18, 0.55) / r; }
      if (p.ping) parts.push(S.tone(ctx, out, t + 0.05 / r, { f: V(2900, 0.05), f1: 2850, glide: 1, a: 0.001, d: 0.35, gain: 0.05, rate: r }));   // the empty clip
      return S.done(p, parts);
    }
  });
  A.register('us.bar', {
    ref: 7, max: 4, minGap: 0, sos: true, reverb: 0.3, dur: 1.6, params: { n: 6 },
    build(ctx, out, p) {
      const r = p.rate, n = clamp(p.n || 6, 2, 12), gap = R(0.1, 0.12) / r, times = [], amps = [];
      for (let i = 0; i < n; i++) { times.push(p.t + i * gap + R(0, 0.006)); amps.push(R(0.8, 1)); }
      return S.done(p, [
        train(ctx, out, { times, amps, crack: { f: V(1700) * r, q: 0.8, tau: 0.012, amp: 0.5 }, body: { f: 1200 * r, tau: 0.03, amp: 0.4 }, thump: { f0: 140 * r, f1: 65 * r, tau: 0.025, amp: 0.35 } }),
        S.burst(ctx, out, times[n - 1] + 0.03 / r, { noise: 'pink', type: 'lowpass', f: 1100, f1: 250, q: 0.4, a: 0.04, d: 0.45, gain: 0.1, rate: r })
      ]);
    }
  });
  A.register('us.bazooka', {
    ref: 9, max: 2, minGap: 0.3, sos: true, reverb: 0.3, dur: 2.4, params: { fl: 0.6 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, tb = t + clamp(p.fl || 0.6, 0.2, 1.5) / r;
      return S.done(p, [
        S.tone(ctx, out, t, { f: V(160), f1: 90, a: 0.002, d: 0.06, gain: 0.3, rate: r }),                                           // the pop
        S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(700), f1: 1700, q: 0.9, a: 0.01, d: 0.4, gain: 0.3, rate: r }), // the whoosh
        S.boom(ctx, out, tb, { f0: V(100), f1: 45, dur: 0.6, gain: 0.4, body: 0.75, crack: 0.5, bright: 1, rate: r })              // on the embrasure
      ]);
    }
  });
  A.register('us.bangalore', {
    ref: 18, max: 2, minGap: 0.2, sos: true, reverb: 0.45, duck: 0.3, dur: 3,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(78), f1: 34, dur: 1.3, gain: 0.52, body: 0.95, crack: 0.65, bright: 1.1, rate: r }),
        S.crackle(ctx, out, t + 0.02 / r, { dur: 0.5, f: 2200, q: 0.8, gain: 0.3, density: 1.2, rate: r }),      // the wire whipping
        S.burst(ctx, out, t + R(0.35, 0.6) / r, { noise: 'pink', type: 'lowpass', f: 1400, f1: 400, q: 0.4, a: 0.15, d: 0.9, gain: 0.16, rate: r }),
        S.crackle(ctx, out, t + R(0.4, 0.7) / r, { dur: 0.9, f: 1300, q: 0.6, gain: 0.16, density: 0.5, rate: r })   // the shingle coming down
      ]);
    }
  });
  // a heavy shell on the bluffs (14" / 12" / 6"), over the naval family's shell.land: the ground heaving and the debris
  A.register('land.big', {
    ref: 45, max: 3, minGap: 0.1, sos: true, reverb: 0.55, duck: 0.35, dur: 4, params: { size: 1 },
    build(ctx, out, p) {
      const r = p.rate, t = p.t, k = p.size || 1;
      return S.done(p, [
        S.boom(ctx, out, t, { f0: V(40) / Math.sqrt(k), f1: 20, dur: 2 * k, gain: 0.45, body: 1, crack: 0.25, bright: 0.55, rate: r }),
        S.burst(ctx, out, t + R(0.4, 0.7) / r, { noise: 'pink', type: 'lowpass', f: 1100, f1: 250, q: 0.4, a: 0.3, d: 1.6 * k, gain: 0.2, rate: r }),   // earth and chalk raining down
        S.crackle(ctx, out, t + R(0.5, 0.8) / r, { dur: 1.4 * k, f: 1200, q: 0.5, gain: 0.14, density: 0.5, rate: r })
      ]);
    }
  });

  // ======================= the rocket barrage =======================
  A.register('rocket.ripple', {
    ref: 40, max: 4, reverb: 0.4, dur: Infinity,
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out), srcs = []; m.gain.setTargetAtTime(1, t, 0.15);
      const a = S.src(ctx, 'brown', t), al = S.filter(ctx, 'lowpass', 320, 0.6), ag = S.gain(ctx, 0.5, m); a.connect(al); al.connect(ag);   // the roar
      const b = S.src(ctx, 'pink', t), bb = S.filter(ctx, 'bandpass', V(950), 0.5), bg = S.gain(ctx, 0.2, m); b.connect(bb); bb.connect(bg); // the motors' rush
      const c = S.crackle(ctx, m, t, { f: 1500, q: 0.5, gain: 0.35, density: 2.2 });                                                           // the ripple: launches crackling off
      const l = osc(ctx, 'sine', V(5.5, 0.2), t); l.connect(S.gain(ctx, 0.1, bg.gain)); srcs.push(a, b, l);
      return { dur: Infinity, stop(tt) { for (const s of srcs) try { s.stop(tt); } catch (e) {} c.stop(tt); },
        set(q) { const now = ctx.currentTime; if (q.rate) { a.playbackRate.setTargetAtTime(q.rate, now, 0.1); b.playbackRate.setTargetAtTime(q.rate, now, 0.1); } } };
    }
  });
  A.register('rocket.whoosh', {
    ref: 10, max: 3, minGap: 0.08, reverb: 0.15, dur: 1.2,
    build(ctx, out, p) {
      const r = p.rate, t = p.t;
      return S.done(p, [
        S.burst(ctx, out, t, { noise: 'pink', type: 'bandpass', f: V(1500), f1: 450, q: 1.1, a: 0.3, d: 0.5, gain: 0.35, rate: r }),
        S.burst(ctx, out, t + 0.1 / r, { noise: 'brown', type: 'lowpass', f: 500, f1: 150, q: 0.6, a: 0.25, d: 0.5, gain: 0.3, rate: r })
      ]);
    }
  });
  A.register('rocket.carpet', {
    ref: 24, max: 6, minGap: 0, sos: true, reverb: 0.4, duck: 0.15, dur: 2.5, params: { n: 4, wet: 0.5, span: 0.25 },
    build(ctx, out, p) {
      const r = p.rate, n = clamp(Math.round(p.n || 4), 1, 8), parts = [], span = clamp(p.span || 0.25, 0.05, 1);
      for (let i = 0; i < n; i++) {
        const t = p.t + Math.random() * span / r, g = R(0.45, 0.8) / Math.sqrt(n * 0.5 + 0.5);
        if (Math.random() < (p.wet || 0)) parts.push.apply(parts, [   // a splash in the surf
          S.tone(ctx, out, t, { f: V(110, 0.2), f1: 50, a: 0.002, d: 0.12, gain: 0.45 * g, rate: r }),
          S.burst(ctx, out, t, { type: 'bandpass', f: V(800), f1: 300, q: 0.8, a: 0.002, d: 0.12, gain: 0.35 * g, rate: r }),
          S.burst(ctx, out, t + 0.03 / r, { noise: 'pink', type: 'lowpass', f: 1500, f1: 500, q: 0.4, a: 0.06, d: 0.5, gain: 0.2 * g, rate: r })]);
        else parts.push(S.boom(ctx, out, t, { f0: V(100, 0.15), f1: 45, dur: 0.55, gain: 0.55 * g, body: 0.75, crack: 0.5, bright: 0.9, rate: r }));
      }
      return S.done(p, parts);
    }
  });

  // ======================= the planes =======================
  A.register('air.b24', {
    ref: 70, max: 3, reverb: 0.3, dur: Infinity, params: { n: 6, cloud: 1 },
    build(ctx, out, p) {
      const t = p.t, m = S.gain(ctx, 0, out), srcs = []; m.gain.setTargetAtTime(1, t, 1.5);
      const lp = S.filter(ctx, 'lowpass', p.cloud ? 420 : 900, 0.7), am = S.gain(ctx, 0.6, m); lp.connect(am);
      const n = 4 + Math.min(4, (p.n || 6) >> 1), f = V(68, 0.05), os = [];
      for (let i = 0; i < n; i++) { const o = osc(ctx, i % 2 ? 'sawtooth' : 'square', f * R(0.985, 1.015), t); o.connect(S.gain(ctx, 0.35 / n, lp)); os.push(o); srcs.push(o); }
      const sub = osc(ctx, 'sine', f / 2, t); sub.connect(S.gain(ctx, 0.12, m)); srcs.push(sub);
      const w = S.src(ctx, 'brown', t), wl = S.filter(ctx, 'lowpass', 260, 0.5); w.connect(wl); wl.connect(S.gain(ctx, 0.25, m)); srcs.push(w);
      const sw = osc(ctx, 'sine', V(0.09, 0.3), t); sw.connect(S.gain(ctx, 0.18, am.gain)); srcs.push(sw);   // the drone swelling through the cloud
      return { dur: Infinity, stop: loopEnd(srcs),
        set(q) { const now = ctx.currentTime; if (q.rate) { os.forEach((o, i) => o.frequency.setTargetAtTime(f * (1 + (i - n / 2) * 0.004) * q.rate, now, 0.2)); sub.frequency.setTargetAtTime(f / 2 * q.rate, now, 0.2); } } };
    }
  });
})(window.WW);
