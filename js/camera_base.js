// camera_base.js (camera): WW.camBase, the island base running into action, as the director films it. Visual only:
// reads the sim, never writes it; Math.random only (never WW.rand). Load after camera_score.js.
// On the base's alarm ('baseAlarm', island_base.js: its own flying boat's report, warships or planes closing; not a
// raid that came in unseen, 'bombed' / 'shelled', which the scenes' interrupts film) a SEQUENCE of cuts over ~30-45 s:
//   camp     a low orbit over the camp: the siren, the men running to the guns and the trenches (base_life.js)
//   line     the flight line: the pilots running to the fighters, the props spinning up, the exhaust (base_ground_fx.js)
//   scramble the first fighter out: followed down the taxiway, then from beside the runway as it rolls and lifts off
//   strike   the bombers taxiing out for the strike (if one goes in the window): the lead followed out and off
// A base's first strike of the round that goes out later on its own ('strikeOut') gets the strike beat alone.
// Each beat is cut in with WW.cam.recut (an automatic story ends for it), never into a hand-off, a locked attack, a
// story's attack phase, the user's or a test shot, nor over a bigger action (camScenes.bigNow() >= 8.5: a sinking,
// a bombardment, torpedoes at a hull); a beat that cannot get the camera waits, then lapses. While a beat runs, a
// base candidate (pr 8.2) keeps the score (camera_score.js) from recutting it for anything short of 9.2. The beats'
// captions ('Scramble!', the strike going out) come with the pictures; base_fx.js leaves those two to the sequence
// while it runs (owns()). Shot kind 'field' (the follow / trackside goal below) and 'orbit' with shot.field: the
// camera may come down to the airfield pad (camera.js keepSane, field).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const wall = () => performance.now() / 1000, rr = (a, b) => a + (b - a) * Math.random();
  const WIN = 45, STRIKE_WIN = 30, CAMP = 5, LINE = [4.5, 10], RUN_MAX = 22, STRIKE_MAX = 18, BEAT_WAIT = 14, BIG = 8.5, HOLD_PR = 8.2;
  const ORDER = { warm: 0, taxi: 1, hold: 2, lineup: 3, roll: 4, stopped: 2, climb: 5 };
  const SHIP = { carrier: 'carriers', battleship: 'battleships', cruiser: 'cruisers', destroyer: 'destroyers' };
  const PFK = WW.cfg.PLANE_FRAME || 1;   // camera.js: plane framing distances close in with the plane size
  const CK = () => (WW.baseLifeLayout && WW.baseLifeLayout.CAMP_K) || 1;   // the camp at true size: the orbit over it closes in
  let S = null, sid = 0, struck = false;
  const ST = { seqs: 0, beats: {}, lapsed: 0 };
  const base = () => (WW.islandBase && WW.islandBase.base) || null;
  const battle = () => WW.game && WW.game.state === 'battle';
  const padH = b => (b.site && b.site.padH) || 1.2;
  const VAR = () => (WW.landAir && WW.landAir.VAR) || {};
  // the base's planes on their way out (warming up to the climb-out), fighters or bombers, furthest along first
  function outbound(b, bombers) {
    const L = [];
    for (const p of WW.world.planes) {
      if (!p.alive || p.removed || p.carrier !== b || p.state !== 'takeoff' || ORDER[p.rwPh] === undefined) continue;
      if (bombers ? p.kind === 'fighter' || !p.target : p.kind !== 'fighter' || p.target) continue;
      L.push(p);
    }
    return L.sort((a, c) => ORDER[c.rwPh] - ORDER[a.rwPh] || (c.pi || 0) - (a.pi || 0));   // (pi: its point along the taxi path)
  }
  function name(b, p, many) { // 'VMF-221 Wildcats' / 'VMSB-241 Dauntlesses' / 'B-26s'
    const v = p && VAR()[p.variant], sq = p && p.squadron ? p.squadron.short : v ? v.sq : '';
    const T = { f4f: 'Wildcats', a6m: 'Zeros', sbd: 'Dauntlesses', b26: 'B-26s', b17: 'B-17s', g4m: 'Bettys', g4mL: 'Bettys' }[p && p.variant] || 'planes';
    return many ? (sq ? sq + ' ' : '') + T : T;
  }
  function say(a, b2) { if (WW.ui && WW.ui.caption && !WW.simOnly) WW.ui.caption(a, b2, 4.5, true); }

  // the start angle of an orbit's arc (sweep rad) round (x, z) at radius r that keeps clearest of the camp's buildings,
  // masts and the base's facilities (the radio masts, the water tower in the foreground)
  function clearArc(b, x, z, r, sweep) {
    const O = (b.decor || []).filter(d => d.kind !== 'trench' && d.kind !== 'drill' && d.kind !== 'yard').concat(b.facilities || []);
    let best = 0, bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const a0 = i / 16 * Math.PI * 2; let m = 1e9;
      for (let k = 0; k <= 4; k++) { const a = a0 + sweep * k / 4, cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r; for (const o of O) m = Math.min(m, Math.hypot(o.x - cx, o.z - cz) - (o.r || 2)); }
      if (m > bs) { bs = m; best = a0; }
    }
    return best;
  }
  // ---------- the beats: each returns the shot to cut to, null (not ready: wait) or 'skip' ----------
  function beat(k, b) {
    if (k === 'camp') {
      const C = (b.decor || []).filter(d => d.kind === 'hut' || d.kind === 'tent' || d.kind === 'mess');
      const fx = C.length ? C.reduce((s, d) => s + d.x, 0) / C.length : b.x, fz = C.length ? C.reduce((s, d) => s + d.z, 0) / C.length : b.z;
      const r = C.length ? 22 * CK() + 5 : 42, w = (Math.random() < 0.5 ? -1 : 1) * 0.05;
      return { kind: 'field', subj: { x: fx, z: fz, y: 0, diorama: true }, ring: { r, w, hgt: 0.22, a0: clearArc(b, fx, fz, r, w * CAMP) }, dur: CAMP + 1, max: CAMP };
    }
    if (k === 'line') { // a fighter starting up in its revetment: the pilot running to it, the prop spinning up, the exhaust
      const A = outbound(b, false), F = A.filter(p => p.rwPh === 'warm'), sl = (b.slots || []).filter(s => s.spot && VAR()[s.v] && VAR()[s.v].kind === 'fighter' && s.state === 'parked');
      if (!F.length) return A.length || !sl.length ? 'skip' : null;   // (all out of their revetments: on to the scramble; none starting up yet: wait - at dusk nothing launches and the beat lapses)
      const q = F[F.length - 1];   // a fighter starting up in its revetment
      return { kind: 'orbit', subj: { x: q.x, z: q.z, y: padH(b), diorama: true }, r: 14 * PFK + 2.5, dur: LINE[1] + 1, max: LINE[1], min: LINE[0], w: 0.07, hgt: 0.35 };
    }
    if (k === 'scramble' || k === 'strike') {
      const P = outbound(b, k === 'strike').filter(q => q.rwPh !== 'climb');   // (one already lifting off is gone before the cut lands)
      const p = P.find(q => q.rwPh !== 'warm') || (k === 'strike' ? P[0] : null);
      if (!p) return null;
      return { kind: 'field', subj: p, dur: (k === 'strike' ? STRIKE_MAX : RUN_MAX) + 1, max: k === 'strike' ? STRIKE_MAX : RUN_MAX, kP: 1.6, kL: 3, many: P.length };
    }
    return 'skip';
  }
  function caption(k, b, c) {
    const p = c.subj;
    if (k === 'line') say('Pilots run for their planes', name(b, outbound(b, false)[0] || { variant: b.nation === 'USN' ? 'f4f' : 'a6m' }, true) + ': engines start on the flight line');
    else if (k === 'scramble') say('Scramble!', name(b, p, true) + ' roll for the runway');
    else if (k === 'strike') say('The strike goes out', name(b, p, true) + ' taxi out for the ' + (SHIP[p.target && p.target.type] || 'enemy ships'));
  }
  // a beat's shot is done: its time is up, or (the field shots) its plane is off and climbing away, or gone
  function over(c) {
    if (c.t >= c.max) return true;
    if (c.kind !== 'field') return c.beat === 'line' && c.t >= c.min && outbound(base(), false).some(p => p.rwPh !== 'warm');
    const p = c.subj; if (c.ring) return false;
    if (!p.alive || p.removed) return c.t > 2;
    if (p.state !== 'takeoff' || p.rwPh === 'climb') {
      c.upT = (c.upT || 0) + (c.dt || 0);
      if (c.upT < 2.5 || !c.track) return c.upT > 3.5;
      // off and climbing: the next one on the runway or at the hold-short line takes its place (the same camera spot),
      // unless the strike's bombers are on their way out (their beat is next)
      const nx = c.t < c.max - 5 && !(c.beat === 'scramble' && outbound(base(), true).length) && outbound(base(), c.beat === 'strike').find(q => q !== p && (q.rwPh === 'hold' || q.rwPh === 'lineup' || q.rwPh === 'roll'));
      if (nx) { c.subj = nx; c.upT = 0; return false; }
      return c.upT > 3.5;
    }
    return false;
  }
  // the running shot may be cut for the next beat
  function free(cur, first) {
    if (WW.cam.forced() || (WW.freecam && WW.freecam.active())) return false;
    if (cur && (cur.stage || cur.user || cur.pr >= 99 || cur.finale || WW.cam.locked())) return false;
    if (cur && cur.story && WW.camStory && (WW.camStory._dbg() || {}).phase === 'attack') return false;
    if (cur && cur.interrupt && cur.t < 8) return false;   // a sinking / magazine just cut in
    return first || !(WW.camScenes && WW.camScenes.bigNow() >= BIG);
  }
  function cue(c, k, b) {
    Object.assign(c, { baseSeq: S.id, beat: k, field: true, threat: b, pr: HOLD_PR, hard: false });
    if (!WW.cam.recut(c)) return false;
    S.cued[k] = wall(); ST.beats[k] = (ST.beats[k] || 0) + 1;
    caption(k, b, c);
    return true;
  }
  function start(b, beats, win) { S = { id: ++sid, b, t0: wall(), win, beats, i: 0, waitT: wall(), cued: {} }; ST.seqs++; }
  function end(cur) { if (cur && S && cur.baseSeq === S.id) cur.dur = Math.min(cur.dur, cur.t + 0.05); S = null; }
  function tick(rdt) {
    if (!S) return;
    const b = base(), now = wall(), cur = WW.cam._shot();
    if (!b || b !== S.b || !battle() || b.neutralized || now - S.t0 > S.win || WW.cam.mode !== 'director') return end(cur);
    const mine = cur && cur.baseSeq === S.id;
    if (mine) { cur.dt = rdt; if (!over(cur) && cur.t + rdt * 2 < cur.dur) { S.waitT = now; return; } }   // (the next beat's wait runs from this one's end)
    for (;;) {
      if (S.i >= S.beats.length) return end(cur);
      const k = S.beats[S.i], c = beat(k, b);
      if (c === 'skip' || now - S.waitT > BEAT_WAIT) { if (c !== 'skip') ST.lapsed++; S.i++; S.waitT = now; continue; }
      if (!c) { // the next beat is not ready: the flight line holds a little longer, a plane gone off ends now (the director goes on)
        if (mine) { if (cur.overT === undefined) cur.overT = cur.t; cur.dur = Math.min(cur.dur, cur.overT + (cur.kind === 'field' ? 0.3 : 3)); }
        return;
      }
      if (!free(mine ? null : cur, S.i === 0)) return;
      if (cue(c, k, b)) { S.i++; S.waitT = now; }
      return;
    }
  }
  // the field shot: on the ground, low behind the plane's quarter (its heading eased through the taxiway turns); from
  // the hold-short line on, from beside the runway ahead of its line-up point (its path's last point, land_ground.js /
  // airfield_layout.js outPath), panning as it rolls past and lifts off
  const _r = { x: 0, z: 0 };
  function fieldGoal(shot, gP, gL, rdt) {
    const p = shot.subj, b = base(); if (!p || !b) return false;
    const g = padH(b), py = Math.max(p.y, g + 0.4);
    if (shot.ring) { const R = shot.ring, a = R.a0 + R.w * shot.t; gP.set(p.x + Math.cos(a) * R.r, R.r * R.hgt, p.z + Math.sin(a) * R.r); gL.set(p.x, 1.5, p.z); shot.aim = null; return true; }   // the camp: a low orbit
    if (p.rwPh === 'hold' || p.rwPh === 'lineup' || p.rwPh === 'roll' || p.rwPh === 'climb' || p.state !== 'takeoff') {
      if (!shot.track) {
        const Q = p.path && p.path.holdShort !== undefined && p.state === 'takeoff' ? p.path[p.path.length - 1] : p;   // the line-up point
        let rw = b.runways[0], bd = 1e18;
        for (const r of b.runways) { const d = Math.abs((Q.x - r.x) * -r.s + (Q.z - r.z) * r.c); if (!r.closed && d < bd) { bd = d; rw = r; } }   // the runway it lines up on
        const e1 = WW.dist2(Q.x, Q.z, rw.x + rw.c * rw.len / 2, rw.z + rw.s * rw.len / 2), e2 = WW.dist2(Q.x, Q.z, rw.x - rw.c * rw.len / 2, rw.z - rw.s * rw.len / 2);
        const sg = e1 > e2 ? 1 : -1, dx = rw.c * sg, dz = rw.s * sg, side = Math.random() < 0.5 ? -1 : 1, off = rw.w / 2 + 10 * PFK;
        const ahead = Math.min(rw.len * 0.3, 22 * PFK);
        shot.track = { x: Q.x + dx * ahead - dz * side * off, z: Q.z + dz * ahead + dx * side * off };
      }
      gP.set(shot.track.x, g + 2.6, shot.track.z);
      gL.set(p.x, g + (py - g) * 0.6, p.z);   // (the climb-out: a little under the plane, so the horizon stays in frame)
    } else {
      const h = shot.hS = shot.hS === undefined ? p.heading : shot.hS + WW.angleDiff(shot.hS, p.heading) * (1 - Math.exp(-rdt * 1.2));
      const fx = Math.cos(h), fz = Math.sin(h), back = 11 * PFK, lat = (shot.side || 1) * 6 * PFK;
      _r.x = -fz; _r.z = fx;
      gP.set(p.x - fx * back + _r.x * lat, g + 3.4 * PFK + 0.7, p.z - fz * back + _r.z * lat);
      gL.set(p.x + fx * 5 * PFK, g + 0.6, p.z + fz * 5 * PFK);
    }
    shot.aim = (shot.aim || new THREE.Vector3()).set(p.x, py, p.z);
    return true;
  }

  // ---------- wiring ----------
  WW.on('baseAlarm', e => {
    const b = e && e.base; if (!b || !battle() || WW.simOnly) return;
    if (e.kind === 'bombed' || e.kind === 'shelled') return;   // (the scenes' raid / bombardment interrupts)
    start(b, ['camp', 'line', 'scramble', 'strike'], WIN);
  });
  WW.on('baseEvent', e => {
    if (!e || !e.base || e.kind !== 'strikeOut' || WW.simOnly) return;
    if (!S && !struck && battle()) start(e.base, ['strike'], STRIKE_WIN);
    struck = true;
  });
  WW.on('roundStart', () => { S = null; struck = false; });
  WW.on('setupStart', () => { S = null; });
  // a base candidate while a beat runs: the shot's worth on the score (it carries threat: the base)
  (WW.camHooks = WW.camHooks || []).push((add, dur) => {
    const cur = WW.cam._shot(); if (!S || !cur || cur.baseSeq !== S.id || cur.overT !== undefined) return;
    add(HOLD_PR, 'base', S.b, { threat: null, dur: dur(10, 13), why: 'alarm' });
  });
  if (WW.camScenes) { const g = WW.camScenes.goal; WW.camScenes.goal = function (shot, gP, gL, rdt) { if (shot && shot.kind === 'field' && shot.baseSeq) return fieldGoal(shot, gP, gL, rdt); return g.apply(this, arguments); }; }
  if (WW.cam && WW.cam.update) { const u = WW.cam.update; WW.cam.update = function (rdt) { try { tick(rdt || 0); } catch (e) { console.error('camBase', e); S = null; } return u.apply(this, arguments); }; }
  WW.camBase = {
    active: () => !!S,
    // base_fx.js: leave this caption to the sequence (it comes with the beat's pictures)
    owns(kind) { if (!S) return false; const k = kind === 'scramble' ? 'scramble' : kind === 'strikeOut' ? 'strike' : null; return !!k && S.beats.indexOf(k) >= S.i; },
    stats: ST, _dbg: () => S
  };
})(window.WW);
