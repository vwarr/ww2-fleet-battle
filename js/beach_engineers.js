// beach_engineers.js - WW.beachEng: the engineers' work on Omaha (Normandy realism pass). Sim code (WW.rand), Normandy
// only, stepped from infantry.js update (after the squads); every hook returns first in another scenario and the
// roundStart listener draws nothing. Visuals: vehicles_fx.js (the buoys and flags, the blocks in the draws).
// 1. The gap lanes. The Special Engineer Task Force's gap assault teams (landing_waves.js gap: one LCM each, the 146th
//    and 299th Engineer Combat Bns with Navy demolition units) landed at H+3 to blow 16 lanes, 50 yd wide, through the
//    obstacle belts before the tide covered them; under the fire, with the infantry sheltering behind the very obstacles
//    they had charged, and the flood coming in, they blew 6 complete gaps and 3 partial ones, and could mark 2 (most of
//    the marker poles and buoys were lost with the men who carried them). Here a team's squads (infantry.js 'gap')
//    work their lane:
//      prog += min(1.5, men at work / 24) / GAP_T a second (a full team ~GAP_T s, "a few minutes' work"); nothing
//      while the squad is pinned; x SHELTER_K while pinned infantry lie in the lane (the charges cannot be fired on
//      them); a team under fire may set its own charges off (PREMATURE a second: the primacord hit, half the team lost)
//      the tide: an obstacle "goes under" when the sea's rise (tide.js level) passes COVER_L0 + COVER_K x (outer belt s -
//      its s) (the gates first, about 07:15, the hedgehogs nearest the shingle about 08:25, as on the day): a covered
//      obstacle can no longer be charged; a lane with every obstacle covered is given up
//      at prog 1 the charges are fired: every obstacle in the lane (|x - lane x| < LANE_HW) not yet covered goes
//      (terrain_normandy.js obstacles o.alive = false); 'cleared' if none is left standing in the lane, else 'partial';
//      then the team marks it (MARK_T s; MARK_P: the poles and the buoys got in) -> 'marked'; the craft steer for the
//      marked lanes (landing_craft.js)
//    The armoured dozers ashore (vehicles.js) work a lane beside the team (DOZER_MEN men's worth).
// 2. The exits. Each draw was closed at its mouth: D-1 by the concrete anti-tank wall across the Vierville road (WN 72's
//    'atwall' element), D-3 and E-3 by an anti-tank ditch and a road block, E-1 by an anti-tank ditch, F-1 by a road
//    block on its track. Nothing on wheels or tracks could leave the beach until engineers blew or filled it, and they
//    could not work at it until the draw's strongpoints were silenced (normandy_game.js drawsOpen). E-1 opened first: the
//    37th Engineers' dozers filled the ditch and cut a road up the east side about midday, and the traffic went up it in
//    the afternoon; D-1's wall was blown in the evening. Here a block is worked (prog += (engineer men / 12 + dozers) /
//    its WORK s) by the engineer squads recruited to it (infantry.js 'block', up to RECRUIT within ENG_R) and the dozers
//    that come to it; at 1 it is open ('drawExit'): vehicles.js sends the jam and the tanks up the draw.
// Events: 'gapEvent' { kind: started | blown | marked | premature | covered, lane }, 'drawExit' { draw, block, t },
// 'blockEvent' { kind: work, block }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const LANE_HW = 2.5, JOIN_R = 6, GAP_T = 30, SHELTER_K = 0.4, PREMATURE = 0.0025, MARK_T = 8, MARK_P = 0.25, DOZER_MEN = 10;
  const COVER_L0 = 0.12, COVER_K = 0.012, OUTER_S = 27;
  const BLOCKS = {
    'D-1': { kind: 'wall', work: 120, what: 'the concrete anti-tank wall across the Vierville road' },
    'D-3': { kind: 'ditch', work: 85, what: 'the anti-tank ditch and road block at Les Moulins' },
    'E-1': { kind: 'ditch', work: 60, what: 'the anti-tank ditch across the St-Laurent draw' },
    'E-3': { kind: 'ditch', work: 85, what: 'the anti-tank ditch and road block in the Colleville draw' },
    'F-1': { kind: 'block', work: 80, what: 'the road block on the F-1 track' }
  };
  const ENG_R = 260, RECRUIT = 2, BLOCK_R = 7;
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, I = () => WW.infantry;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let lanes = [], blocks = [], stats = null, nid = 0;
  function newStats() { return { lanes: 0, cleared: 0, partial: 0, failed: 0, marked: 0, premature: 0, blown: 0, exits: 0, exitOrder: [] }; }

  // ---- the lanes ----
  const coverLevel = o => COVER_L0 + COVER_K * Math.max(0, OUTER_S - o.s);
  const covered = o => WW.tide && WW.tide.level() > coverLevel(o);
  function laneObs(L) {
    if (L.obs) return L.obs;
    L.obs = T().obstacles.filter(o => Math.abs(o.x - L.x) < LANE_HW);
    return L.obs;
  }
  // a gap team's squad comes ashore: its lane (the boat team's own, or a new one where it landed)
  function join(q) {
    let L = lanes.find(l => l.state === 'work' && Math.abs(l.x - q.x) < JOIN_R);
    if (!L) {
      L = { id: nid++, x: q.x, sector: q.sector, unit: q.unit, state: 'work', prog: 0, t0: rt(), tBlown: null, markT: 0, cleared: false, marked: false, obs: null, men: 0, dozers: 0, shelter: false };
      lanes.push(L); stats.lanes++;
      WW.emit('gapEvent', { kind: 'started', lane: L });
    }
    q.lane = L;
    return L;
  }
  const workZ = L => T().shoreZ(L.x) - 12;          // between the stakes and the ramps: where the belts are thickest
  function laneStep(L, dt, squads) {
    if (L.state === 'blown') {                       // marking it: the poles up the beach, the buoys at its seaward end
      L.markT += dt;
      if (L.markT > MARK_T) {
        const team = squads.some(q => q.alive && q.lane === L);
        if (team && WW.rand() < MARK_P) { L.marked = true; L.state = 'marked'; stats.marked++; WW.emit('gapEvent', { kind: 'marked', lane: L }); }
        else L.state = 'unmarked';
      }
      return;
    }
    if (L.state !== 'work') return;
    const obs = laneObs(L);
    let open = 0; for (const o of obs) if (o.alive && !covered(o)) open++;
    if (!open) {                                     // under the sea (or gone): given up
      L.state = obs.some(o => o.alive) ? 'covered' : 'unmarked'; L.cleared = !obs.some(o => o.alive);
      if (L.state === 'covered') { stats.failed++; WW.emit('gapEvent', { kind: 'covered', lane: L }); }
      return;
    }
    let men = 0, fire = false;
    for (const q of squads) {
      if (!q.alive || q.lane !== L || q.state !== 'gap') continue;
      if (q.sup > I().PIN || Math.abs(q.x - L.x) > LANE_HW + 3 || Math.abs(q.z - workZ(L)) > 6) continue;
      men += q.men; if (q.sup > 0.5) fire = true;
    }
    men += L.dozers * DOZER_MEN;
    L.men = men; L.shelter = false;
    if (!men) return;
    for (const q of squads) {                        // the infantry lying behind the charged obstacles
      if (q.alive && q.lane !== L && (q.state === 'wade' || q.state === 'swim') && q.sup > I().PIN && Math.abs(q.x - L.x) < LANE_HW + 1.5) { L.shelter = true; break; }
    }
    if (fire && WW.rand() < PREMATURE * dt) {        // a bullet or a fragment in the primacord: the charges go off on the men
      stats.premature++; L.prog = Math.max(0, L.prog - 0.35);
      for (const q of squads) if (q.alive && q.lane === L && q.state === 'gap') I().lose(q, Math.ceil(q.men * 0.45), 'blast');
      blowSome(L, 0.3);
      WW.emit('gapEvent', { kind: 'premature', lane: L });
      return;
    }
    L.prog += Math.min(1.5, men / 24) / GAP_T * (L.shelter ? SHELTER_K : 1) * dt;
    if (L.prog >= 1) blow(L);
  }
  function blowSome(L, f) { for (const o of laneObs(L)) if (o.alive && !covered(o) && WW.rand() < f) o.alive = false; }
  function blow(L) {
    for (const o of laneObs(L)) if (o.alive && !covered(o)) o.alive = false;
    L.cleared = !laneObs(L).some(o => o.alive);
    L.state = 'blown'; L.tBlown = rt(); stats.blown++;
    if (L.cleared) stats.cleared++; else stats.partial++;
    WW.emit('gapEvent', { kind: 'blown', lane: L, cleared: L.cleared });
  }
  function markedNear(x, r) {
    let best = null, bd = r;
    for (const L of lanes) if (L.marked && Math.abs(L.x - x) < bd) { bd = Math.abs(L.x - x); best = L; }
    return best;
  }
  // a lane still being worked near x (the dozers)
  function workingNear(x, r) {
    let best = null, bd = r;
    for (const L of lanes) if (L.state === 'work' && Math.abs(L.x - x) < bd) { bd = Math.abs(L.x - x); best = L; }
    return best;
  }

  // ---- the exits ----
  function buildBlocks() {
    blocks = [];
    const C = WW.coastDefence;
    for (const d of WW.normandyData.DRAWS) {
      const B = BLOCKS[d.id]; if (!B) continue;
      let x = d.x, z = T().bluffFootZ(d.x) + 1.5, el = null;
      if (B.kind === 'wall' && C) { el = C.elements.find(e => e.kind === 'atwall' && Math.abs(e.x - d.x) < 20) || null; if (el) { x = el.x; z = el.z; } }
      blocks.push({ id: d.id, draw: d, x, z, kind: B.kind, what: B.what, work: B.work, el, state: 'closed', prog: 0, openT: null, men: 0, dozers: 0, eng: [] });
    }
  }
  const silenced = b => { const G = WW.normandyGame; return !!G && G.drawsOpen()[b.id] !== undefined; };
  const ENG_STATES = { shingle: 1, shelf: 1, climb: 1, top: 1, hold: 1 };
  function blockStep(b, dt, squads) {
    if (b.state === 'open') return;
    if (!silenced(b)) return;
    if (b.state === 'closed') { b.state = 'work'; WW.emit('blockEvent', { kind: 'work', block: b }); }
    b.eng = b.eng.filter(q => q.alive && q.block === b);
    if (b.eng.length < RECRUIT) {                    // the nearest engineers come to it
      let best = null, bd = ENG_R;
      for (const q of squads) {
        if (!q.alive || q.kind !== 'eng' || q.block || !ENG_STATES[q.state]) continue;
        const d = Math.abs(q.x - b.x) + Math.abs(q.z - b.z) * 0.5; if (d < bd) { bd = d; best = q; }
      }
      if (best) { best.block = b; b.eng.push(best); I().setState(best, 'block'); }
    }
    let men = 0;
    for (const q of b.eng) if (q.state === 'block' && q.sup <= I().PIN && Math.hypot(q.x - b.x, q.z - b.z) < BLOCK_R) men += q.men;
    b.men = men;
    const k = men / 12 + b.dozers;
    if (k > 0) b.prog += Math.min(2.5, k) / b.work * dt;
    if (b.prog >= 1) {
      b.state = 'open'; b.openT = rt(); stats.exits++; stats.exitOrder.push(b.id);
      if (b.el && b.el.alive && WW.coastDefence) WW.coastDefence.knockOut(b.el);   // D-1: the wall blown
      for (const q of b.eng) if (q.alive) I().setState(q, 'hold');
      WW.emit('drawExit', { draw: b.draw, block: b, t: rt() });
    }
  }
  const openExits = () => blocks.filter(b => b.state === 'open');
  const workBlocks = () => blocks.filter(b => b.state === 'work');

  function update(dt, squads) {
    if (!on()) return;
    if (!blocks.length && WW.normandyTerrain && WW.normandyData) buildBlocks();
    for (const L of lanes) laneStep(L, dt, squads);
    for (const b of blocks) blockStep(b, dt, squads);
    for (const L of lanes) L.dozers = 0;             // recounted by the dozers each step (vehicles.js)
    for (const b of blocks) b.dozers = 0;
  }
  function reset() { lanes = []; blocks = []; stats = newStats(); nid = 0; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.beachEng = { update, join, workZ, markedNear, workingNear, openExits, workBlocks, coverLevel, covered, LANE_HW, BLOCKS,
    get lanes() { return lanes; }, get blocks() { return blocks; }, get stats() { return stats; } };
  stats = newStats();
})(window.WW);
