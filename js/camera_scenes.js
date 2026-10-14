// camera_scenes.js (camera): WW.camScenes, the ships' and the base's action shots for the director (camera.js): the
// right angle for each kind of action (docs/camera_audit.md, M6), and their candidates with one drama scale shared
// with the plane shots (a sinking 10-11, torpedoes at a hull 8-9, a bombardment 8.5, a gun duel with hits 7-8, a
// ship under air attack 7, a plain gun duel 5.5-6.5). Shot kinds:
//   duel     behind the firing ship's quarter, over its turrets, the target in the distance: both ships in frame;
//   profile  a sinking: low and wide, the hull in profile, the camera drifting along it;
//   aa       from the deck of a ship under air attack, looking up at the attackers through the flak;
//   base     elevated over the island field, looking across it toward the threat: the shell bursts walking across the
//            runways, or the raid coming in over them.
// Also an orbit arc that stays on one side of the line of action (orbitArc) and the sinking / magazine interrupts.
// Visual only: Math.random and the wall clock, never WW.rand; reads the sim, never writes it. Load after camera.js.
window.WW = window.WW || {};
(function (WW) {
  const V = () => new THREE.Vector3();
  const _u = V(), _r = V();
  const wall = () => performance.now() / 1000;
  const ok = p => p && !p.removed && p.alive;
  const VALUE = { carrier: 1.6, battleship: 1.4, cruiser: 1.1, destroyer: 0.8, submarine: 0.6, pt: 0.4 };
  const TOP = { carrier: 7, battleship: 6, cruiser: 5, destroyer: 4, submarine: 2.5, pt: 2 };
  const hits = new Map(), strad = new Map(), fired = new Map(), hitBy = new Map(), crit = new Map();   // ship -> [wall times] / { at, target } / { at, kind } / wall time of a magazine or deck explosion
  let bombard = { at: -1e9, by: null }, scrambleAt = -1e9, lastInt = -1e9;
  const ST = { interrupts: 0, duels: 0, profiles: 0, aa: 0, base: 0 };
  const recent = (m, s, win) => { const a = m.get(s); if (!a) return 0; const now = wall(); let n = 0; for (const w of a) if (now - w < win) n++; return n; };
  const push = (m, s) => { const a = m.get(s) || m.set(s, []).get(s); a.push(wall()); if (a.length > 12) a.shift(); };
  const base = () => (WW.islandBase && WW.islandBase.base) || null;

  // ---------- events ----------
  WW.on('shellFired', e => { if (e && e.ship && e.proj && e.proj.target && !e.proj.target.isBase && (e.cal === 'big' || e.cal === 'med')) fired.set(e.ship, { at: wall(), target: e.proj.target }); });
  WW.on('shellLanded', e => {
    if (!e) return;
    if (e.ship) { push(hits, e.ship); return; }
    for (const s of WW.world.ships) if (s.alive && !s.submerged && WW.dist2(s.x, s.z, e.x, e.z) < 18 * 18) { push(strad, s); break; }
  });
  WW.on('shipHit', e => { if (e && e.ship && (e.kind === 'torpedo' || e.kind === 'bomb')) hitBy.set(e.ship, { at: wall(), kind: e.kind }); });
  WW.on('baseEvent', e => {
    if (!e || !e.base) return;
    if (e.kind === 'bombard') { bombard = { at: wall(), by: e.by || null }; interrupt({ kind: 'base', subj: e.base, threat: e.by && e.by.alive ? e.by : null, dur: 12 + Math.random() * 4, pr: 9, why: 'bombard', interrupt: true }); }
    else if (e.kind === 'airRaid') interrupt({ kind: 'base', subj: e.base, threat: e.by && e.by.alive ? e.by : null, dur: 12 + Math.random() * 4, pr: 8.5, why: 'raid', interrupt: true });
    else if (e.kind === 'scramble') scrambleAt = wall();
  });
  WW.on('roundStart', () => { hits.clear(); strad.clear(); fired.clear(); hitBy.clear(); crit.clear(); bombard = { at: -1e9, by: null }; scrambleAt = -1e9; lastInt = -1e9; });
  // the interrupts: a ship going down or blowing up cuts in at once (the lock decides whether the running shot allows it)
  function interrupt(c) {
    if (!WW.cam || !WW.cam.interrupt) return;
    const now = wall();
    if (c.pr < 11 && now - lastInt < 15) return;        // at most one interrupt per 15 s, unless it is the biggest kind
    if (WW.cam.interrupt(c)) { lastInt = now; ST.interrupts++; }
  }
  WW.on('shipSunk', s => {
    if (!s || s.removed || !(WW.game && WW.game.state === 'battle')) return;
    const big = s.type === 'carrier' || s.type === 'battleship';
    interrupt({ kind: 'profile', subj: s, pr: big ? 11 : s.type === 'cruiser' ? 10 : 9, dur: (big ? 11 : 9) + Math.random() * 3, interrupt: true });
  });
  // a magazine: wide and a little high, the whole column in frame (fx_critical.js); a deck load / hangar going up: the
  // flight deck from off the quarter (the director's strongest cuts after a sinking)
  WW.on('magazine', e => { if (e && e.ship && !e.ship.removed) { crit.set(e.ship, wall()); interrupt({ kind: 'orbit', subj: e.ship, r: e.ship.stats.length * 2.2 + 36, dur: 11 + Math.random() * 3, w: 0.035, hgt: 0.32, pr: 11, interrupt: true }); } });
  WW.on('deckHit', e => { if (e && e.ship && !e.ship.removed && e.ship.alive) { crit.set(e.ship, wall()); interrupt({ kind: 'orbit', subj: e.ship, r: e.ship.stats.length * 1.8 + 24, dur: 10 + Math.random() * 3, w: 0.04, hgt: 0.24, pr: e.hangar || e.load >= 6 ? 10.5 : 10, interrupt: true }); } });

  // ---------- candidates (camera.js candidates(): WW.camHooks) ----------
  function attackers(s, R) { const out = []; for (const p of WW.world.planes) if (ok(p) && p.nation !== s.nation && (p.target === s || p.diveTgt === s || p.outTgt === s) && (p.phase || p.state === 'attack') && WW.dist2(p.x, p.z, s.x, s.z) < R * R) out.push(p); return out; }
  function candidates(add, dur) {
    const now = wall();
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      // a sinking: the biggest moment at first, worth less as she settles (camera4: a forecast hit elsewhere then wins)
      if (s.sinking && (s.sinkT || 0) < 7) { add(10 + (VALUE[s.type] >= 1.4 ? 1 : 0) - Math.max(0, (s.sinkT || 0) - 3) * 0.8, 'profile', s, { dur: dur(9, 12) }); continue; }
      if (!s.alive || s.submerged) continue;
      const cr = crit.get(s); if (cr && now - cr < 20) add(9.6 + (VALUE[s.type] || 1) * 0.3 - Math.max(0, now - cr - 5) * 0.25, 'orbit', s, { r: s.stats.length * 1.8 + 24, dur: dur(11, 14), w: 0.04, hgt: 0.24 });   // the deck still going up
      const f = fired.get(s), t = f && f.target;
      if (f && now - f.at < 8 && t && t.alive && !t.removed && WW.dist(s.x, s.z, t.x, t.z) < 220) {
        const h = recent(hits, t, 10), st = recent(strad, t, 8);
        add(5.5 + (VALUE[s.type] || 1) * 0.8 + (h ? 1.5 : 0) + (st ? 0.6 : 0), 'duel', s, { target: t, dur: dur(12, 16) });
      }
      const hh = recent(hits, s, 8), ss = recent(strad, s, 8);
      if (hh || ss >= 2) { // the target of a salvo: the splashes and the straddle, low off its beam
        const by = s.target && s.target.alive ? s.target : null;
        add(6 + (VALUE[s.type] || 1) + 0.4 * Math.min(3, hh) + 0.2 * Math.min(3, ss), 'orbit', s, { r: Math.max(s.stats.length * 1.6, 24) + 10, dur: dur(11, 14), w: 0.04, hgt: 0.12, loa: by });
      }
      const at = attackers(s, 130); // under air attack: planes committed (the run, the dive) count, the ones still setting up a little
      if (at.length && at.some(p => p.phase === 'run' || p.phase === 'roll' || p.phase === 'dive')) { const com = at.filter(p => p.phase === 'run' || p.phase === 'roll' || p.phase === 'dive').length; add(5.8 + 0.7 * Math.min(4, com) + 0.1 * Math.min(5, at.length - com) + (VALUE[s.type] || 1) * 0.5, 'aa', s, { dur: dur(10, 14) }); }
    }
    const b = base();
    if (b) {
      let raid = 0, rx = 0, rz = 0;
      for (const p of WW.world.planes) if (ok(p) && p.nation !== b.nation && p.ordnance && p.target === b && WW.dist2(p.x, p.z, b.x, b.z) < 170 * 170) { raid++; rx += p.x; rz += p.z; }
      if (now - bombard.at < 25) add(8.5, 'base', b, { threat: bombard.by && bombard.by.alive ? bombard.by : null, dur: dur(12, 16), why: 'bombard' });
      else if (raid) add(7.5 + 0.2 * Math.min(5, raid), 'base', b, { threat: { x: rx / raid, z: rz / raid }, dur: dur(12, 16), why: 'raid' });
      else if (now - scrambleAt < 15) add(6, 'base', b, { threat: null, dur: dur(10, 13), why: 'scramble' });
    }
  }
  (WW.camHooks = WW.camHooks || []).push(candidates);
  // the biggest ship / base action going on (story mode yields to it from a quiet phase): its priority
  function bigNow() {
    const now = wall();
    let best = 0;
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      if (s.sinking && (s.sinkT || 0) < 6) best = Math.max(best, 10);
      const cr = crit.get(s); if (cr && now - cr < 15) best = Math.max(best, 10);
      if (!s.alive) continue;
      if (recent(hits, s, 6)) best = Math.max(best, 7.5 + (VALUE[s.type] || 1));
      const h = hitBy.get(s); if (h && now - h.at < 6) best = Math.max(best, 7 + (VALUE[s.type] || 1));
    }
    if (now - bombard.at < 20) best = Math.max(best, 8.5);
    const b = base();
    if (b) { let n = 0; for (const p of WW.world.planes) if (ok(p) && p.nation !== b.nation && p.ordnance && p.target === b && (p.phase || WW.dist2(p.x, p.z, b.x, b.z) < 120 * 120)) n++; if (n >= 2) best = Math.max(best, 8); }
    if (WW.camFinder) for (const it of WW.camFinder.list()) if (it.kind === 'torps' && it.eta < 15 && it.subj && it.subj.alive) best = Math.max(best, 8.5);
    if (WW.camDirector) for (const e of WW.camDirector.forecast()) if (e.etaReal < 10) best = Math.max(best, e.raw);   // an impact about to land (camera_director.js)
    return best;
  }
  // (torpedoes about to reach a hull: camera_director.js forecasts them and braces the ship before the hit)

  // ---------- shot goals ----------
  function openSide(x, z, a, r) { // the side with more open (deep) water: +1 / -1 for angle a / a + PI
    const o = sd => { let d = 0; for (const f of [0.4, 0.8, 1.1]) { const px = x + Math.cos(a) * sd * r * f, pz = z + Math.sin(a) * sd * r * f; d += (px < 0 || pz < 0 || px > WW.cfg.MAP_W || pz > WW.cfg.MAP_H) ? 15 : WW.clamp(WW.terrain.depthAt(px, pz), -2, 10); } return d; };
    return o(1) >= o(-1) ? 1 : -1;
  }
  function start(shot) { // once, at the cut
    const s = shot.subj;
    if (shot.kind === 'duel') { ST.duels++; shot.kP = 1.1; shot.kL = 1.4; }
    else if (shot.kind === 'profile') {
      ST.profiles++;
      const h = s.heading || 0; shot.side = openSide(s.x, s.z, h + Math.PI / 2, s.stats.length * 2.2);
      shot.kP = 0.8; shot.kL = 1.2;
    } else if (shot.kind === 'aa') { ST.aa++; shot.kP = 3; shot.kL = 2.5; }
    else if (shot.kind === 'base') { ST.base++; shot.kP = 0.7; shot.kL = 0.9; shot.side = Math.random() < 0.5 ? -1 : 1; }
  }
  // the hull `len` long, seen broadside, fills `f` of the frame width at this distance (camera.js fillR)
  function fillR(len, f) { const c = WW.camera; return len / (f * 2 * Math.tan(c.fov * Math.PI / 360) * c.aspect); }
  function goal(shot, gP, gL, rdt) {
    const s = shot.subj;
    if (!s) return false;
    switch (shot.kind) {
      case 'duel': { // over the firer's turrets toward the target
        const t = shot.target && !shot.target.removed ? shot.target : (s.target && s.target.alive ? s.target : null);
        const len = s.stats.length, h = s.heading;
        _u.set(t ? t.x - s.x : Math.cos(h), 0, t ? t.z - s.z : Math.sin(h)).normalize();
        if (!shot.u) shot.u = _u.clone(); else shot.u.lerp(_u, 1 - Math.exp(-rdt * 0.6)).normalize();
        const u = shot.u; _r.set(-u.z, 0, u.x);
        if (shot.side === undefined) shot.side = openSide(s.x, s.z, Math.atan2(_r.z, _r.x), len * 0.8);
        const back = len * 1.05 + 14, lat = shot.side * len * 0.5, d = t ? WW.dist(s.x, s.z, t.x, t.z) : 120;
        gP.set(s.x - u.x * back + _r.x * lat, len * 0.28 + 6, s.z - u.z * back + _r.z * lat);
        gL.set(s.x + u.x * Math.min(d * 0.45, 80), 1, s.z + u.z * Math.min(d * 0.45, 80));
        shot.aim = (shot.aim || V()).set(s.x + u.x * len * 0.2, 2, s.z + u.z * len * 0.2);
        if (t && !t.alive && !t.sinking) shot.dur = Math.min(shot.dur, shot.t + 2);
        return true;
      }
      case 'profile': { // low and wide, side on, drifting slowly along the hull
        const len = s.stats.length, h = shot.hS === undefined ? (shot.hS = s.heading || 0) : shot.hS;
        const fx = Math.cos(h), fz = Math.sin(h), r = fillR(len, 0.5) + 6;
        const along = (shot.t / Math.max(8, shot.dur) - 0.5) * len * 0.8;
        gP.set(s.x - fz * shot.side * r + fx * along, 3.2 + len * 0.05, s.z + fx * shot.side * r + fz * along);
        gL.set(s.x, 1.5, s.z);
        shot.aim = (shot.aim || V()).set(s.x, 1.5 + len * 0.06, s.z);
        return true;
      }
      case 'aa': { // from the deck, looking up at the attackers through the flak
        const at = s.alive ? attackers(s, 180) : [];
        let a = shot.att && ok(shot.att) && at.indexOf(shot.att) >= 0 ? shot.att : null;
        if (!a && at.length) { let bd = 1e9; for (const p of at) { const d = WW.dist2(p.x, p.z, s.x, s.z); if (d < bd) { bd = d; a = p; } } shot.att = a; }
        const len = s.stats.length, h = s.heading, fx = Math.cos(h), fz = Math.sin(h), top = (TOP[s.type] || 4) + 1.8;
        gP.set(s.x - fx * len * 0.25, top, s.z - fz * len * 0.25);
        if (a) {
          if (!shot.look) shot.look = V().set(a.x, a.y, a.z); else shot.look.lerp(_u.set(a.x, a.y, a.z), 1 - Math.exp(-rdt * 2.2));
          shot.noAtt = 0;
        } else { shot.noAtt = (shot.noAtt || 0) + rdt; if (!shot.look) shot.look = V().set(s.x + fx * 60, 40, s.z + fz * 60); if (shot.noAtt > 3) shot.dur = Math.min(shot.dur, shot.t + 1); }
        gL.copy(shot.look);
        shot.aim = (shot.aim || V()).copy(shot.look);
        shot.deck = true;
        return true;
      }
      case 'base': { // elevated over the field, looking across it toward the threat
        const b = s, th = shot.threat;
        _u.set(th ? th.x - b.x : 1, 0, th ? th.z - b.z : 0).normalize();
        if (!shot.u) shot.u = _u.clone(); else shot.u.lerp(_u, 1 - Math.exp(-rdt * 0.4)).normalize();
        const u = shot.u; _r.set(-u.z, 0, u.x);
        const sw = shot.side * (shot.t / Math.max(8, shot.dur) - 0.5) * 30;
        gP.set(b.x - u.x * 75 + _r.x * sw, 30, b.z - u.z * 75 + _r.z * sw);
        gL.set(b.x + u.x * 25, 0, b.z + u.z * 25);
        shot.aim = (shot.aim || V()).set(b.x, 1, b.z);
        return true;
      }
    }
    return false;
  }
  // an orbit's start angle: the arc of w * dur rad centred 90 deg off the line of action (subject -> target), on the
  // side with more open water, so the orbit never crosses the line (camera.js startShot picks by openness otherwise)
  function orbitArc(s, t, w, dur, openness, r) {
    const at = Math.atan2(t.z - s.z, t.x - s.x), sweep = Math.abs(w) * dur;
    const sides = [at + Math.PI / 2, at - Math.PI / 2];
    const c = openness(s.x, s.z, sides[0], r) >= openness(s.x, s.z, sides[1], r) ? sides[0] : sides[1];
    return c - Math.sign(w) * sweep / 2;
  }
  WW.camScenes = { start, goal, orbitArc, bigNow, attackers, stats: ST, _hits: hits, _strad: strad };
})(window.WW);
