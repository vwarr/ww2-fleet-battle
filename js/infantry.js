// infantry.js - WW.infantry: the men ashore at Omaha and Pointe du Hoc as squads (P7 of docs/NORMANDY_PLAN.md).
// Sim code (WW.rand), Normandy only. Fire, casualties and the fight for the strongpoints: infantry_fire.js; routes and
// cover: infantry_routes.js; visuals: models_infantry.js.
// The sim unit is a squad of about SQUAD men, an alive count (the figures on screen are visual). A squad comes off a
// craft's ramp (landing_craft.js 'craftUnload'), and works its way up the beach as on the day:
//   wade      from the ramp through the surf, behind the obstacles when the fire is heavy (pinned: a crawl)
//   cross     over the dry sand to the shingle (no cover: the killing ground)
//   shingle   in the lee of the shingle bank or the sea wall until there is a gap in the wire behind it: engineers blow
//             one at once, a rifle squad after BLOW_T s if it is not pinned (a Bangalore torpedo)
//   shelf     across the low ground behind, to a climb point between the draws (infantry_routes.js climbX)
//   climb     up the bluff (folds and scrub: some cover)
//   top       on the bluff top: off to the nearest strongpoint not yet silenced, from its flank or rear
//   assault   at the strongpoint: closing on its positions (infantry_fire.js fights it out)
//   hold      on the plateau with nothing left in reach: the beachhead
// Rangers at Pointe du Hoc: 'rope' at the foot of the cliff (the grapnels and ladders, ROPE_T s under fire from the top),
// then top / assault on WN 75, then 'guns': inland to the orchard where the 155s stood unmanned, and they spike them.
// Tanks ashore are single-vehicle squads ('tank'): up to the shingle line, then they fire at the embrasures
// (infantry_fire.js). Swimmers from a wrecked craft start in the water at half speed, and some drown.
// The realism pass (beach_engineers.js, vehicles.js, leaders.js, hoc_climb.js, prisoners.js, all stepped from here):
//   gap       a gap assault team's squad at its lane in the obstacle belts (beach_engineers.js works it), then ashore
//   shingle   the stall: a squad's time at the shingle is cut (q.leadK) when a leader gets them up (leaders.js)
//   rope      Pointe du Hoc: up a rope that reached the top and is still there (hoc_climb.js), or wait for the ladders
//   block     engineers at a draw's road block or ditch (beach_engineers.js), after its strongpoints are silenced
//   exit      a tank going up an open draw (vehicles.js drive), then 'inland': off the beach
// Events: 'squadEvent' { kind: landed | lost | captured | gunsSpiked | leader (leaders.js), or the new state (shingle |
// shelf | climb | top | assault | guns | hold | block | exit | inland), squad }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const SQUAD = 12, MIN_SQUAD = 3, ID0 = 30000;
  // speeds (u/s, on the compressed clock: about 4x a man's real pace), x (1 - PIN_K x pinned)
  const V = { wade: 0.35, cross: 0.7, shingle: 0.4, shelf: 0.55, climb: 0.15, top: 0.5, assault: 0.3, rope: 0, guns: 0.5, tank: 0.6, swim: 0.18, gap: 0.3, block: 0.5 };
  const DEEP = 0.3, DROWN = 0.004, PIN = 1, PIN_K = 0.8, BLOW_T = { eng: 8, ranger: 18, rifle: 35, tank: 1e9 }, ROPE_T = 22, WN_R = 260, TANK_HP = 70;
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, R = () => WW.infRoutes;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let squads = [], acc = new Map(), stats = null, nid = 0, targets = [];

  function newStats() { return { landed: 0, squads: 0, tanks: 0, lost: 0, tanksLost: 0, drowned: 0, onTop: 0, captured: 0, gaps: 0, hocGuns: false, bySector: {} }; }
  function sec(s) { return stats.bySector[s] || (stats.bySector[s] = { landed: 0, lost: 0, onTop: 0 }); }
  function kindOf(c) { return c.type === 'lcm' || /Engineer/.test(c.unit || '') ? 'eng' : /Ranger/.test(c.unit || '') ? 'ranger' : 'rifle'; }
  function make(c, men, x, z, kind, swim) {
    const y = Math.max(0, WW.terrain.heightRaw(x, z));
    const q = { isLand: true, isSquad: true, id: ID0 + nid++, nation: 'USN', kind, type: kind === 'tank' ? 'tank' : 'squad', unit: c ? c.unit : '', sector: c ? c.sector : '',
      x, z, y, men, men0: men, hp: kind === 'tank' ? TANK_HP : men * 10, maxHp: kind === 'tank' ? TANK_HP : men * 10, alive: true, sinking: false, removed: false, submerged: false,
      state: swim ? 'swim' : kind === 'tank' ? 'tank' : c && c.sector === 'hoc' ? 'rope' : 'wade', stateT: rt(), sup: 0, heading: Math.PI / 2, speed: 0,
      value: kind === 'tank' ? 4 : 1, goal: null, wn: null, reload: 3 + (nid % 5), muzzleY: y + 0.5,
      stats: { length: kind === 'tank' ? 0.8 : 2, guns: [], aa: null, tons: 30 },
      takeDamage(amount, hx, hz, kd, cal) { WW.infFire.hit(this, amount, kd === 'bomb' ? 'bomb' : cal || 'small'); } };
    if (c && c.gap && !swim && kind === 'eng' && WW.beachEng) { q.state = 'gap'; WW.beachEng.join(q); }   // the gap team: to its lane first
    squads.push(q); stats.squads++;
    if (kind === 'tank') stats.tanks++; else { stats.landed += men; sec(q.sector).landed += men; }
    WW.emit('squadEvent', { kind: 'landed', squad: q });
    return q;
  }
  // men off a ramp: gathered per craft into squads of SQUAD (the remainder when the craft is done)
  function unload(e) {
    const c = e.craft, a = acc.get(c) || { men: 0, n: 0 };
    a.men += e.men; acc.set(c, a);
    const jit = k => (((c.id * 31 + k * 17) % 11) / 11 - 0.5) * 3;   // a fixed spread along the ramp, no draw
    for (let k = 0; k < (e.tanks || 0); k++) { const t = e.dd ? make(c, 0, e.x, e.z, 'tank') : make(c, 0, e.x + jit(a.n++), e.z + 0.5, 'tank'); if (e.dd) { t.dd = true; t.heading = c.heading; t.y = WW.terrain.heightRaw(e.x, e.z); } }   // a DD drives on from where it grounded
    const done = e.swim || c.men <= 0;
    while (a.men >= SQUAD || (done && a.men >= MIN_SQUAD)) {
      const m = Math.min(SQUAD, a.men); a.men -= m;
      make(c, m, e.x + jit(a.n++), e.z, kindOf(c), !!e.swim);
    }
    if (done) { if (a.men > 0) { stats.lost += 0; } acc.delete(c); }
  }
  function setState(q, s) { if (q.state === s) return; q.state = s; q.stateT = rt(); if (s !== 'wade' && s !== 'cross' && s !== 'swim') WW.emit('squadEvent', { kind: s, squad: q }); }

  // the next strongpoint for a squad on the top: the nearest not silenced within WN_R along the coast
  function pickWN(q) {
    const C = WW.coastDefence; if (!C) return null;
    let best = null, bd = 1e9;
    for (const w of C.wns) {
      if (w.silenced || (q.kind !== 'ranger' && w.hoc)) continue;
      const d = Math.abs(w.x - q.x) + Math.max(0, w.z - q.z) * 0.5;
      if (d < WN_R && d < bd) { bd = d; best = w; }
    }
    return best;
  }
  function moveTo(q, gx, gz, v, dt) {
    const dx = gx - q.x, dz = gz - q.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    const s = Math.min(d, v * dt);
    q.x += dx / d * s; q.z += dz / d * s; q.heading = Math.atan2(dz, dx); q.speed = v;
    return d - s < 0.3;
  }
  function step(q, dt) {
    const t = T(), r = R(), pinned = q.sup > PIN, k = pinned ? 1 - PIN_K : 1, now = rt();
    const st = q.state;
    if (st === 'swim' || st === 'wade') {
      // the surf: slower the deeper it is (chest-deep with 60 lb of kit); off a wreck, men swim until they find their
      // feet, and some go under (DROWN a man a second while it is over their heads)
      // the waterline comes in with the tide (tide.js): later, the surf is up at the shingle and there is no sand to cross
      const zs = Math.min(WW.tide.waterZ(q.x), t.shingleZ(q.x) - 0.5), d = Math.max(0, WW.tide.depth(q.x, q.z));
      moveTo(q, q.x, zs + 1, V[st] * k * (st === 'wade' ? (d > DEEP ? 0.55 : d > DEEP / 2 ? 0.8 : 1) : 1), dt);
      if (st === 'swim') {
        if (d > DEEP && WW.rand() < q.men * DROWN * dt) { stats.drowned++; lose(q, 1, 'drowned'); if (!q.alive) return; }
        if (d <= DEEP) setState(q, 'wade');
      }
      if (q.z >= zs) setState(q, 'cross');
    } else if (st === 'cross') {
      if (moveTo(q, q.x, t.shingleZ(q.x), V.cross * k, dt)) { setState(q, 'shingle'); }
    } else if (st === 'shingle') {
      q.speed = 0;
      const g = r.gapNear(q.x);
      if (g) { q.gx = g.x; setState(q, 'shelf'); }
      // pinned: it takes three times as long, but someone gets the Bangalore up at last
      // a leader among them (leaders.js leadK) cuts the stall: someone stands up and the rest follow
      else if (now - q.stateT > (BLOW_T[q.kind] || 20) * (pinned ? (q.leadK ? 1.5 : 3) : 1) * (q.leadK || 1)) { r.addGap(q.x, q); stats.gaps++; q.gx = q.x; setState(q, 'shelf'); }
    } else if (st === 'shelf') {
      const cx = r.climbX(q.gx !== undefined ? q.gx : q.x), gz = t.bluffFootZ(cx);
      if (moveTo(q, cx, gz, V.shelf * k, dt)) setState(q, 'climb');
    } else if (st === 'climb') {
      if (moveTo(q, q.x, t.bluffTopZ(q.x) + 5, V.climb * k, dt)) { setState(q, 'top'); stats.onTop += q.men; sec(q.sector).onTop += q.men; q.topped = true; }
    } else if (st === 'gap') {                                                // a gap team at work in its lane (beach_engineers.js)
      const L = q.lane, E = WW.beachEng;
      if (!L || L.state !== 'work' || !E) setState(q, 'wade');
      else moveTo(q, L.x + ((q.id % 3) - 1) * 1.2, E.workZ(L), V.gap * k, dt);
    } else if (st === 'block') {                                              // engineers at a draw's block (beach_engineers.js)
      const b = q.block;
      if (!b || b.state === 'open') setState(q, 'hold');
      else moveTo(q, b.x + ((q.id % 3) - 1) * 1.5, b.z - 1.5, V.block * k, dt);
    } else if (st === 'exit') {                                               // a tank up an open draw (vehicles.js)
      if (!WW.vehicles || WW.vehicles.drive(q, dt, V.tank)) { setState(q, 'inland'); if (WW.vehicles) WW.vehicles.tankOff(q); }
    } else if (st === 'inland') {
      q.speed = 0;
    } else if (st === 'rope') {                                               // Pointe du Hoc: up the ropes and ladders
      q.speed = 0;
      const up = WW.hocClimb ? WW.hocClimb.climb(q, dt, pinned) : now - q.stateT > ROPE_T * (pinned ? 1.6 : 1);
      if (up) { const p = r.hocTop(q.x); q.x = p.x; q.z = p.z; setState(q, 'top'); stats.onTop += q.men; sec(q.sector).onTop += q.men; q.topped = true; }
    } else if (st === 'top') {
      if (!q.wn || q.wn.silenced) { q.wn = pickWN(q); q.goal = q.wn ? r.assault(q, q.wn) : null; }
      if (!q.wn) {
        if (q.kind === 'ranger' && q.sector === 'hoc' && !stats.hocGuns) { setState(q, 'guns'); return; }
        setState(q, 'hold'); return;
      }
      if (moveTo(q, q.goal.x, q.goal.z, V.top * k, dt)) setState(q, 'assault');
    } else if (st === 'assault') {
      if (!q.wn || q.wn.silenced) { setState(q, 'top'); return; }
      let e = null, bd = 1e9;                                                  // close on the nearest live position of the strongpoint
      for (const x of q.wn.elements) if (x.alive && !x.dormant) { const d = Math.hypot(x.x - q.x, x.z - q.z); if (d < bd) { bd = d; e = x; } }
      if (!e) { setState(q, 'top'); return; }
      q.foe = e;
      if (bd > 6) moveTo(q, e.x, e.z, V.assault * k, dt); else q.speed = 0;
    } else if (st === 'guns') {                                               // the Rangers find the 155s in the orchard
      const g = WW.coastDefence.elements.filter(x => x.kind === 'h155' && x.alive);
      if (!g.length) { stats.hocGuns = true; setState(q, 'hold'); return; }
      const e = g[0];
      if (moveTo(q, e.x, e.z, V.guns * k, dt)) { for (const x of g) if (Math.hypot(x.x - q.x, x.z - q.z) < 25) WW.coastDefence.knockOut(x); }
      if (!WW.coastDefence.elements.some(x => x.kind === 'h155' && x.alive)) { if (!stats.hocGuns) WW.emit('squadEvent', { kind: 'gunsSpiked', squad: q }); stats.hocGuns = true; setState(q, 'hold'); }
    } else if (st === 'hold') {
      q.speed = 0;
      if (now - q.stateT > 10) { const w = pickWN(q); if (w) { q.wn = w; q.goal = r.assault(q, w); setState(q, 'top'); } else q.stateT = now; }
    } else if (st === 'tank') {
      const gz = t.shingleZ(q.x) - 3;
      if (q.z < gz) moveTo(q, q.x, gz, V.tank, dt); else q.speed = 0;
    }
    q.y = Math.max(0, WW.terrain.heightRaw(q.x, q.z)); q.muzzleY = q.y + 0.5;
  }

  function update(dt) {
    if (!on() || !WW.game || WW.game.state !== 'battle') return;
    if (WW.leaders) WW.leaders.update(dt, squads);       // before the squads: who gets up this step
    for (const q of squads) if (q.alive) step(q, dt);
    if (WW.infFire) WW.infFire.update(dt, squads);
    if (WW.hocClimb) WW.hocClimb.update(dt, squads);
    if (WW.vehicles) WW.vehicles.update(dt, squads);     // before the engineers: the dozers sign on to their work
    if (WW.beachEng) WW.beachEng.update(dt, squads);
    if (WW.prisoners) WW.prisoners.update(dt);
    // the defences' target list: the craft afloat and everyone ashore (coast_defence_fire.js picks from it)
    targets.length = 0;
    if (WW.landingCraft) for (const u of WW.landingCraft.live) targets.push(u);
    for (const q of squads) if (q.alive && q.state !== 'inland') targets.push(q);
    if (WW.vehicles) for (const v of WW.vehicles.live) if (v.state !== 'exit') targets.push(v);
    if (squads.length > 600) squads = squads.filter(q => q.alive || rt() - q.stateT < 60);
  }
  function lose(q, n, why) {   // casualties: n men (a tank: knocked out); why: 'drowned' (the visuals)
    if (!q.alive) return 0;
    if (q.kind === 'tank') { q.alive = false; stats.tanksLost++; WW.emit('squadEvent', { kind: 'lost', squad: q }); return 0; }
    n = Math.min(n, q.men); if (n <= 0) return 0;
    q.men -= n; stats.lost += n; sec(q.sector).lost += n;
    if (q.topped) { stats.onTop -= n; sec(q.sector).onTop -= n; }
    WW.emit('squadCasualty', { squad: q, n, x: q.x, z: q.z, why });
    if (q.men <= 0) { q.alive = false; q.stateT = rt(); WW.emit('squadEvent', { kind: 'lost', squad: q }); }
    return n;
  }
  function reset() { squads = []; acc = new Map(); stats = newStats(); nid = 0; targets = []; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.on('craftUnload', e => { if (on() && e && e.craft) unload(e); });
  WW.landTargets = function () { return targets; };
  WW.infantry = { update, lose, setState, get squads() { return squads; }, get stats() { return stats; }, get targets() { return targets; }, SQUAD, V, PIN };
  stats = newStats();
})(window.WW);
