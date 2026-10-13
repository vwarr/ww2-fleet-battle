// hoc_climb.js - WW.hocClimb: the Rangers' climb at Pointe du Hoc (Normandy realism pass). Sim code (WW.rand), Normandy
// only, stepped from infantry.js update; the roundStart listener draws nothing. Visuals: hoc_fx.js.
// Rudder's three companies came in under the east face at 07:10, 40 minutes late. Each LCA carried three pairs of
// rocket-fired grapnels (plain 3/4-inch ropes, toggle ropes and rope ladders) in launchers at its gunwales; fired at the
// foot of the 30 m cliff, many fell short, the ropes soaked by the spray too heavy for the rockets (REACH_P). The men
// went up the ropes that held, and up the light tubular steel ladders they carried in 4-ft sections and fitted together
// at the foot (LADDER_WAIT s for a squad with no rope). The Germans on the top cut the ropes and rolled stick grenades
// over the edge onto the men at the foot (CUT_RATE and GREN_RATE a second per German position still in action on the
// point: WN 75's MG nests, flak and the observation bunker; Satterlee's and Talybont's fire and the Rangers' own BARs
// kept their heads down: a suppressed position does neither). The first men were on the top within 5 minutes; all the
// companies within 15 to 30.
// The four DUKWs with the London Fire Brigade's 100-ft extension ladders could not get in to the foot of the cliff over
// the cratered shingle; one ran its ladder up all the same, Sgt. William Stivison on top firing the Lewis guns at the
// German positions as it swayed through 70 degrees (STIV_T: his fire suppresses the nearest one).
// Interface: climb(q, dt, pinned) for infantry.js 'rope' (true when the squad is up). The ropes: { x, zFoot, zTop, kind
// plain | toggle | ladder (rope ladders and the steel sections), ok (reached the top), cut, load, t }.
// Events: 'hocEvent' { kind: grapnels | cut | grenade | ladder | dukwLadder, craft?, rope?, squad? }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const PAIRS = ['plain', 'toggle', 'ropeLadder'], REACH_P = 0.5, ROPE_T = 20, ROPE_R = 9, LADDER_WAIT = 10;
  const CUT_RATE = 0.0035, GREN_RATE = 0.004, FALL_P = 0.15, STIV_T = 3, STIV_R = 45, TOP_KINDS = { mg: 1, flak: 1, op: 1 };
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, rt = () => (WW.game ? WW.game.roundTime : 0);
  let ropes = [], stats = null, nid = 0, stivT = 0;
  function newStats() { return { fired: 0, reached: 0, ladders: 0, cut: 0, grenades: 0, fell: 0, dukwLadder: false }; }
  function rope(x, kind, ok, craft) {
    const t = T(), r = { id: nid++, x, zFoot: t.bluffFootZ(x) - 0.2, zTop: t.bluffTopZ(x) + 0.3, kind, ok, cut: false, load: 0, t: rt(), craft: craft || null };
    ropes.push(r); return r;
  }
  // an LCA grounds at the foot: its six rockets go up with the ropes
  function grapnels(u) {
    let ok = 0;
    for (let i = 0; i < 6; i++) {
      const reach = WW.rand() < REACH_P;
      rope(u.x + (i - 2.5) * 0.55, i < 2 ? PAIRS[0] : i < 4 ? PAIRS[1] : PAIRS[2], reach, u);
      if (reach) ok++;
    }
    stats.fired += 6; stats.reached += ok;
    WW.emit('hocEvent', { kind: 'grapnels', craft: u, n: 6, ok });
  }
  // the German positions still in action on the point (they cut the ropes and drop grenades)
  function defenders() {
    const C = WW.coastDefence, w = C && C.wnOf('WN75'); if (!w || w.silenced) return 0;
    let n = 0; const now = WW.time.now;
    for (const e of w.elements) if (e.alive && !e.dormant && TOP_KINDS[e.kind] && !(e.suppressedUntil > now)) n++;
    return n;
  }
  function climb(q, dt, pinned) {
    if (q.rope && (!q.rope.ok || q.rope.cut)) { q.rope.load = Math.max(0, q.rope.load - 1); q.rope = null; }
    if (!q.rope) {
      let best = null, bl = 1e9;
      for (const r of ropes) if (r.ok && !r.cut && Math.abs(r.x - q.x) < ROPE_R && r.load * 4 + Math.abs(r.x - q.x) < bl) { bl = r.load * 4 + Math.abs(r.x - q.x); best = r; }
      if (!best) {
        q.waitT = (q.waitT || 0) + dt;
        if (q.waitT > LADDER_WAIT) { q.waitT = 0; best = rope(q.x + ((q.id % 3) - 1) * 0.4, 'ladder', true); stats.ladders++; WW.emit('hocEvent', { kind: 'ladder', rope: best, squad: q }); }
        else return false;
      }
      q.rope = best; best.load++; q.ropeP = q.ropeP || 0; q.x = best.x;
    }
    q.ropeP += dt / ROPE_T * (pinned ? 0.6 : 1) * (q.rope.kind === 'ladder' ? 0.85 : 1);
    if (q.ropeP >= 1) { q.rope.load = Math.max(0, q.rope.load - 1); q.rope = null; q.ropeP = 0; return true; }
    return false;
  }
  function update(dt, squads) {
    if (!on() || !ropes.length) return;
    const n = defenders();
    if (n) {
      for (const r of ropes) {
        if (!r.ok || r.cut || WW.rand() >= CUT_RATE * n * dt) continue;
        r.cut = true; stats.cut++;
        WW.emit('hocEvent', { kind: 'cut', rope: r });
        for (const q of squads) if (q.alive && q.rope === r && q.ropeP > 0.15) {          // a man on it falls
          if (WW.rand() < 0.6 + FALL_P) { stats.fell++; WW.infantry.lose(q, 1, 'fell'); }
          q.ropeP *= 0.4;
        }
      }
      for (const q of squads) {
        if (!q.alive || q.state !== 'rope' || WW.rand() >= GREN_RATE * n * dt) continue;
        stats.grenades++; WW.infantry.lose(q, 1, 'grenade'); q.sup = Math.min(3, q.sup + 0.6);
        WW.emit('hocEvent', { kind: 'grenade', squad: q });
      }
    }
    // Stivison on the swaying ladder: the Lewis guns on the nearest German position
    const L = WW.landingCraft; if (!L) return;
    for (const u of L.live) {
      if (u.type !== 'dukw' || !u.ladder || u.state !== 'ladder') continue;
      if (!stats.dukwLadder) { stats.dukwLadder = true; u.ladderUp = true; WW.emit('hocEvent', { kind: 'dukwLadder', craft: u }); }
      if (!u.ladderUp || (stivT -= dt) > 0) continue;
      stivT = STIV_T;
      const C = WW.coastDefence, w = C && C.wnOf('WN75'); if (!w) continue;
      let best = null, bd = STIV_R;
      for (const e of w.elements) if (e.alive && !e.dormant && TOP_KINDS[e.kind]) { const d = Math.hypot(e.x - u.x, e.z - u.z); if (d < bd) { bd = d; best = e; } }
      if (best) best.suppressedUntil = Math.max(best.suppressedUntil, WW.time.now + STIV_T * 0.8);
    }
  }
  WW.on('craftEvent', e => { if (on() && e && e.kind === 'beached' && e.craft && e.craft.sector === 'hoc' && e.craft.type === 'lca') grapnels(e.craft); });
  function reset() { ropes = []; stats = newStats(); nid = 0; stivT = 0; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.hocClimb = { update, climb, get ropes() { return ropes; }, get stats() { return stats; } };
  stats = newStats();
})(window.WW);
