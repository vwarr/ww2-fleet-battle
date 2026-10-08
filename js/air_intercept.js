// air_intercept.js — WW.intercept: fighter gun passes on bombers (air_dogfight.js offence() hands over any foe
// that is not a fighter). A turning fight loses to a dive bomber circling in the wheel, so the fighter flies
// passes instead: set up above and outside the bomber's track (ahead along the wheel's arc), dive onto it with the
// gun lead taken along the arc, a short burst, break away and extend, then set up again. A dive bomber in its dive
// is chased down the dive line; a torpedo bomber low on its run gets a stern / high-side pass from behind and above.
// Uses the dogfight's guns (wing guns, per-round hit checks), energy, rate and climb. Sim code: WW.rand only.
window.WW = window.WW || {};
(function () {
  const ST = { passes: 0, firing: 0 };
  const P = { x: 0, y: 0, z: 0 };
  // Where plane f will be in t s, along its current turn (an arc) and climb rate (t < 0: where it was).
  function predict(f, t, o) {
    const v = f.speed || 0, h = f.heading, w = WW.clamp(f.turn || 0, -2, 2);
    if (Math.abs(w) < 0.05) { o.x = f.x + Math.cos(h) * v * t; o.z = f.z + Math.sin(h) * v * t; }
    else { const r = v / w; o.x = f.x + r * (Math.sin(h + w * t) - Math.sin(h)); o.z = f.z - r * (Math.cos(h + w * t) - Math.cos(h)); }
    o.y = Math.max(1, f.y + (f.vy || 0) * t);
    return o;
  }
  function attack(p, f, s, dt) {
    const D = WW.dogfight, K = D && D._k;
    if (!K) return false;
    const pt = p.pt, dist = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
    const diving = f.kind === 'dive' && (f.phase === 'roll' || f.phase === 'dive');
    const low = f.kind === 'torpedo';                // low and slow: stern / high-side pass from behind and above
    if (s.ipFoe !== f) { s.ipFoe = f; s.ip = dist < 70 ? 'run' : 'setup'; s.ipT = 0; s.foe = f; s.ipDir = WW.rand() < 0.5 ? -1 : 1; if (s.ip === 'run') ST.passes++; }
    if (s.lock < 1.5) s.lock = 1.5;                  // stay on this bomber through the pass (dogfight.pick honours the lock)
    s.ipT += dt; s.mt += dt;
    if (diving && s.ip === 'setup') { s.ip = 'run'; s.ipT = 0; ST.passes++; }
    let can = false, keep = false;
    if (s.ip === 'setup') {
      predict(f, low ? -1.0 : 2.2, P);              // ahead on its track (wheel: the arc); torpedo run: behind it
      let sx = P.x, sz = P.z;
      const w = f.turn || 0;
      if (!low && Math.abs(w) > 0.05) {             // outside the wheel: push the start point away from its centre
        const r = f.speed / w, cx = f.x - Math.sin(f.heading) * r, cz = f.z + Math.cos(f.heading) * r;
        const ox = sx - cx, oz = sz - cz, ol = Math.hypot(ox, oz) || 1, R = Math.abs(r) + 16;
        sx = cx + ox / ol * R; sz = cz + oz / ol * R;
      }
      const alt = f.y + (low ? 8 : 15), d = Math.hypot(sx - p.x, sz - p.z);
      p.turnTo(Math.atan2(sz - p.z, sx - p.x), dt, K.rate(p, 1));
      K.climb(p, alt, dt); K.energy(p, dt, pt.speed * 1.1);
      const fa = Math.abs(WW.angleDiff(p.heading, Math.atan2(f.z - p.z, f.x - p.x)));
      if ((d < 16 && p.y > f.y + 5) || (dist < 50 && fa < 0.9) || s.ipT > 7) { s.ip = 'run'; s.ipT = 0; ST.passes++; }
    } else if (s.ip === 'run') {
      // aim at the gun lead (arc-predicted at the rounds' time of flight) and dive down onto it
      predict(f, dist / (K.BV + p.speed * 0.3) + 0.04, P);
      const dh = Math.hypot(P.x - p.x, P.z - p.z) || 1;
      const ang = p.turnTo(Math.atan2(P.z - p.z, P.x - p.x), dt, K.rate(p, 1.35));
      const tv = WW.clamp((P.y - p.y) / dh * p.speed, -pt.dive * 0.8, 6);
      p.vy += WW.clamp(tv - p.vy, -22 * dt, 22 * dt);
      // close fast, then throttle back inside ~30 to stay on the gun line longer (a slower fighter also turns tighter)
      K.energy(p, dt, diving ? pt.dive : dist > 30 ? pt.speed : Math.max(f.speed + 5, pt.speed * 0.62));
      const el = Math.abs(Math.atan2(P.y - p.y, dh) - Math.atan2(p.vy, Math.max(1, p.speed)));
      can = dist < K.RANGE && Math.abs(ang) < 0.2 && el < 0.18;
      s.ipAng = ang; s.ipEl = el; s.ipD = dist;                // for tests / tuning
      keep = dist < K.RANGE && Math.abs(ang) < 0.3;
      const aspect = Math.abs(WW.angleDiff(p.heading, Math.atan2(f.z - p.z, f.x - p.x)));
      if (dist < 5 || (dist < 14 && aspect > 1.3) || s.ipT > 6 || p.y + Math.min(0, p.vy) * 0.8 < 7) { s.ip = 'ext'; s.ipT = 0; }
    } else { // break away and extend, then set up again
      p.turnTo(p.heading + s.ipDir * 0.4, dt, K.rate(p, 0.6));
      K.climb(p, Math.max(p.y + 2, f.y + 10), dt); K.energy(p, dt, pt.speed * 1.15);
      if (s.ipT > 1.6) { s.ip = 'setup'; s.ipT = 0; s.ipDir = -s.ipDir; }
    }
    if (can) ST.firing += dt;
    K.guns(p, f, s, dt, can, keep);
    return true;
  }
  function reset() { ST.passes = 0; ST.firing = 0; }
  WW.on('roundStart', reset);
  WW.intercept = { attack, predict, stats: ST };
})();
