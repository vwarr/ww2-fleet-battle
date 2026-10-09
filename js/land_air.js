// land_air.js - WW.landAir: the island base's air group in the air (sim code: WW.rand only). Loads after air_cag.js,
// island_base.js and land_ground.js. The base is an unsinkable "carrier" (plane.carrier = base, base.isBase): its
// planes are WW.Planes launched through WW.air.launch (squadrons, pilots, dogfights, AA all as usual); aircraft.js
// hands takeoff / goHome / landing / rollout to this file instead of air_deck.js, and the ground part (slots, warm-up,
// taxiways, hold-short, line-up, rollout and taxi-in) to land_ground.js.
//  - Variants (VAR): a plane kind (fighter / dive / torpedo, so every kind test elsewhere still works) with its own
//    model, stats, parking class (S / M / L) and whether it can land on a carrier (carrier: true). USN Midway-style:
//    Wildcat-type fighters, SBDs, B-26 torpedo bombers, B-17 level bombers; IJN: Zeros, Bettys (torpedo / level).
//    The group's size and mix: land_ground.js plan (one carrier air group's worth by default, WW.islandBase.TUNE).
//  - Air boss (update): a standing CAP (WW.airOps.capWanted; a SCRAMBLE when raiders are near: fighters first, a short
//    warm-up, a fast taxi), and every 55-75 s a strike on the best known enemy ship within STRIKE_R: dive and torpedo
//    bombers as a WW.strike wave, level bombers on their own. Nothing is launched while the main runway is closed,
//    the base is neutralized or it is dusk; queued launches wait for the runway to be repaired.
//  - Home: the circuit (stacked orbits), cleared to land one at a time when the field is recovering and the runway is
//    free, final down the centreline into the wind, touchdown. Main runway closed: an emergency landing on the cross
//    runway if it is open (the plane is towed off), else the plane holds over the island for HOLD_MAX s (a neutralized
//    base: LEAVE_T s) and then a carrier-capable type (VAR carrier) diverts to a friendly carrier with deck room nearby;
//    every other type (B-17, B-26, Betty, ...) ditches beside the nearest friendly ship, where it can be rescued.
//  - Level bombing (pl.level): B-17 / Betty level variants, and carrier torpedo planes sent against the island (Kates
//    carried bombs at Midway): straight and level at altitude, a stick released on the throw point; dropBomb's
//    scatter grows with height, so a B-17 rarely hits a ship (historically they hit nothing at Midway).
//  - Strikes on the base: each bomber aims at one of its facilities (aimFor), not the island's centre.
window.WW = window.WW || {};
(function () {
  'use strict';
  const HOLD_MAX = 70, LEAVE_T = 12, STRIKE_R = 560, DIVERT_R = 420;
  // variant: kind, model key, flight stats over the nation's kind, level bombing { alt, bombs }, gear height, parking class, carrier-capable
  const VAR = {
    f4f:  { kind: 'fighter', model: null, sq: 'VMF-221', cls: 'S', carrier: true },
    sbd:  { kind: 'dive', model: null, sq: 'VMSB-241', cls: 'S', carrier: true },
    b26:  { kind: 'torpedo', model: 'b26', sq: '69th BS', st: { hp: 46, speed: 30, turn: 0.85, climb: 4, range: 1300 }, gear: 1.0, cls: 'M' },
    b17:  { kind: 'dive', model: 'b17', sq: '431st BS', st: { hp: 80, speed: 24, turn: 0.55, climb: 3, range: 1500 }, gear: 1.25, level: { alt: 62, bombs: 3 }, cls: 'L' },
    a6m:  { kind: 'fighter', model: null, sq: 'Tainan Kokutai', cls: 'S', carrier: true },
    g4m:  { kind: 'torpedo', model: 'g4m', sq: 'Misawa Kokutai', st: { hp: 34, speed: 30, turn: 0.85, climb: 4, range: 1500 }, gear: 1.0, cls: 'L' },
    g4mL: { kind: 'dive', model: 'g4mL', sq: 'Chitose Kokutai', st: { hp: 34, speed: 29, turn: 0.8, climb: 3.6, range: 1500 }, gear: 1.0, level: { alt: 48, bombs: 2 }, cls: 'L' }
  };
  for (const k in VAR) if (VAR[k].gear) VAR[k].gear *= WW.cfg.PLANE_K || 1;   // gear heights above were measured at the 1.7 plane scale
  const KATE = { alt: 40, bombs: 1 };
  const ST = { launches: 0, landings: 0, ditched: 0, diverted: 0, strikes: 0, levelDrops: 0, holds: 0, emergency: 0, scrambles: 0, closedLaunches: 0, defence: 0, defStrikes: 0 };

  const groundY = b => b.site.padH;
  const gearOf = p => (p.variant && VAR[p.variant].gear) || WW.air._pool.deckY;
  const G = () => WW.landGround;

  function setup(b, counts) {
    b.ai = { queue: [], capT: 1, strikeT: 25, launchT: 0, lq: [], aimN: 0, scrT: -1e9 };
    const sq = {};
    for (const k in counts) sq[k] = { kind: VAR[k].kind, nation: b.nation, name: VAR[k].sq, short: VAR[k].sq, cvName: b.name, leader: null, sorties: 0, lost: 0 };
    const byKind = { fighter: null, dive: null, torpedo: null };
    for (const k in sq) if (!byKind[sq[k].kind]) byKind[sq[k].kind] = sq[k];
    b._sq = { name: b.name, sq: byKind, byVariant: sq };   // air_squadrons.js group(): preset, never a carrier slot
    b._roster = { idle: [] };                              // air_aces.js roster(): the base's own pilots
    const S = b.site;                                      // a ditching point: open water just off the field island
    b.ditch = null;
    for (let r = 60; r < 200 && !b.ditch; r += 6) for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
      if (WW.terrain.depthAt(x, z) > 2) { b.ditch = { x, z }; break; }
    }
  }
  function hangarLost() { /* a burnt hangar slows the rearming (land_ground.js park) */ }

  // ---------- the air boss ----------
  function capState(b) {
    let on = 0, coming = 0;
    for (const p of WW.world.planes) {
      if (!p.alive || p.carrier !== b || p.kind !== 'fighter' || p.target) continue;
      if (p.state === 'takeoff') coming++; else if ((p.state === 'transit' || p.state === 'attack') && p.fuel > 45) on++;
    }
    return { on, coming };
  }
  // The enemy warship that threatens the island most: a fresh contact within DEF_R of it, a ship shelling it (_bombT,
  // island_base.js) or a gun ship counting double; null when the sea round the island is clear.
  const DEF_R = 300, DEF_V = { battleship: 9, cruiser: 6, carrier: 8, destroyer: 3, pt: 1.2, submarine: 1.5 };
  function defTarget(b) {
    if (!WW.intel) return null;
    let best = null, bs = 0; const now = WW.time.now;
    for (const c of WW.intel.enemyShips(b.nation, { fresh: true })) {
      const u = c.unit; if (!u || !u.alive || u.sinking || u.submerged || u.isBase) continue;
      const d = WW.dist(b.x, b.z, c.x, c.z); if (d > DEF_R) continue;
      const sc = (DEF_V[u.type] || 1) * (now - (u._bombT || -1e9) < 60 ? 2 : 1) / (1 + d / 150);
      if (sc > bs) { bs = sc; best = u; }
    }
    return best;
  }
  function variants(b, kind) { const L = []; for (const s of b.slots) if (VAR[s.v].kind === kind && !VAR[s.v].level && L.indexOf(s.v) < 0) L.push(s.v); return L; }
  function pick(b, kind) { for (const v of variants(b, kind)) if (G().ready(b, v) > 0) return v; return null; }
  function canLaunch(b) { return G().opsOpen(b) && !(WW.dayNight && WW.daylight < 0.53); }
  function update(b, dt) {
    const a = b.ai, now = WW.time.now;
    G().update(b, dt);
    if (b.neutralized) { a.queue.length = 0; return; }
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 1;
      const want = Math.min(4, WW.airOps ? WW.airOps.capWanted(b) : 2), cs = capState(b);
      const raid = !!(WW.airOps && WW.airOps.picture(b).near > 0);
      const queued = a.queue.filter(q => VAR[q.v].kind === 'fighter' && !q.target).length;
      let need = want - cs.on - cs.coming - queued;
      for (; need > 0; need--) {
        const fv = pick(b, 'fighter');
        if (!fv || G().ready(b, fv) - a.queue.filter(q => q.v === fv).length <= 0) break;
        a.queue.unshift({ v: fv, target: null, fast: raid });
      }
      if (raid && now - a.scrT > 60 && canLaunch(b) && a.queue.some(q => q.fast)) { a.scrT = now; ST.scrambles++; WW.emit('baseEvent', { kind: 'scramble', base: b, nation: b.nation, x: b.x, z: b.z }); }
    }
    a.strikeT -= dt;
    const def = defTarget(b);   // self-defence first: warships off the island (the Cactus Air Force after the bombardment)
    if (def && def !== a.defFor) { a.defFor = def; a.strikeT = Math.min(a.strikeT, 4); ST.defence++; }
    if (a.strikeT <= 0 && !a.queue.some(q => q.target)) {
      a.strikeT = WW.randRange(55, 75);
      const t = def || (WW.airOps ? WW.airOps.pickTarget({ x: b.x, z: b.z, nation: b.nation }) : null);
      if (t && !canLaunch(b) && def) a.strikeT = 5;   // runway cratered / dark: the strike goes the moment it can (at dawn)
      if (t && WW.dist(b.x, b.z, t.x, t.z) < STRIKE_R && canLaunch(b)) {
        if (t === def) ST.defStrikes++;
        const wave = [], avail = {};
        for (const s of b.slots) if (s.state === 'parked' && s.readyAt <= now && !s.moved) avail[s.v] = (avail[s.v] || 0) + 1;
        for (const k in avail) {
          if (VAR[k].kind === 'fighter') continue;
          for (let i = 0; i < avail[k]; i++) { const q = { v: k, kind: VAR[k].kind, target: t, level: !!VAR[k].level }; a.queue.push(q); if (!q.level) wave.push(q); }
        }
        const f = pick(b, 'fighter'), esc = b.nation === 'IJN' && f ? Math.min(2, G().ready(b, f) - 3) : 0; // Zeros escort the Bettys
        for (let i = 0; i < esc; i++) { const q = { v: f, kind: 'fighter', target: t }; a.queue.push(q); wave.push(q); }
        if (wave.length || a.queue.some(q => q.level)) {
          ST.strikes++; WW.islandBase.stats.landStrikes++;
          if (wave.length && WW.strike) WW.strike.newWave(b, t, wave);
          WW.emit('baseEvent', { kind: 'strikeOut', base: b, nation: b.nation, x: b.x, z: b.z, target: t });
        }
      }
    }
    a.launchT -= dt;
    if (!a.queue.length || a.launchT > 0) return;
    if (!canLaunch(b)) { if (!G().opsOpen(b)) ST.closedLaunches++; return; } // runway closed / dusk: the queue waits
    const q = a.queue[0];
    let t = q.target;
    if (t && (!t.alive || t.sinking)) t = WW.airOps ? WW.airOps.pickTarget({ x: b.x, z: b.z, nation: b.nation }) : null;
    const slot = G().take(b, q.v);
    a.queue.shift();
    if ((q.target && !t) || !slot) return;
    b.nextSlot = slot; b.nextFast = !!q.fast;
    const p = WW.air.launch(b, VAR[q.v].kind, t);
    b.nextSlot = null;
    if (p) { a.launchT = q.fast ? 0.4 : 1.2; ST.launches++; WW.islandBase.stats.landSorties++; }
  }

  // ---------- launch: variant model and stats, into its spot to warm up ----------
  function launched(p) {
    const b = p.carrier, slot = b.nextSlot;
    if (!slot) { p.alive = false; p.remove(); return; }
    const v = slot.v, V = VAR[v];
    p.variant = v;
    if (V.model) { // swap the model for the land plane's
      const P = WW.air._pool, m = P.get(V.model, p.nation);
      P.release(p.model);
      p.model = m; p.group = m.group; p.prop = m.prop; p.payload = m.payload || null;
      if (p.payload) p.payload.visible = p.ordnance;
    }
    if (V.st) { p.pt = Object.assign({}, p.pt, V.st); p.hp = p.maxHp = p.pt.hp; p.fuel = p.pt.range / p.pt.speed * 6; }
    if (V.level) { p.level = V.level; p.lvLand = true; }
    const sq = b._sq.byVariant[v]; if (sq) { p.squadron = sq; }
    G().launched(p, b, slot, b.nextFast);
    G().sync(b);
    p.sync(0);
  }

  // ---------- takeoff: the ground part in land_ground.js; here the climb-out ----------
  function takeoff(p, dt) {
    const b = p.carrier;
    if (p.rwPh !== 'climb') return G().out(p, dt);
    p.speedTo(p.pt.speed * 0.9, dt); p.turn = 0;
    p.vy += WW.clamp(Math.min(4, p.pt.climb || 4) - p.vy, -6 * dt, 6 * dt);
    if (p.y > groundY(b) + 12) { p.state = 'transit'; p.rwPh = null; }
  }

  // ---------- home: circuit, final, touchdown; else hold, divert or ditch ----------
  function goHome(p, dt) {
    const b = p.carrier, d = WW.dist(p.x, p.z, b.x, b.z);
    p.foe = null;
    p.fly(b.x, b.z, d > 120 ? 25 : 20, dt, p.pt.speed);
    if (d < 150) { p.state = 'landing'; p.rwPh = 'circuit'; p.rwT = 0; if (b.ai.lq.indexOf(p) < 0) b.ai.lq.push(p); }
  }
  // the runway to land on, into the wind: the main one, else (emergency) the cross runway; null: none open
  function landRunway(b) {
    if (b.neutralized) return null;
    const o = b.ops, wh = WW.wind ? WW.wind.a + Math.PI : b.heading;
    if (G().opsOpen(b)) { const h = o.dir > 0 ? b.heading : b.heading + Math.PI, td = b.layout.toW(-o.dir * 34, 0); return { h, x: td.x, z: td.z, main: true }; }
    const r = b.runways[1]; if (!r || r.closed) return null;
    const h = Math.cos(WW.angleDiff(r.h, wh)) >= 0 ? r.h : r.h + Math.PI;
    return { h, x: r.x - Math.cos(h) * r.len * 0.36, z: r.z - Math.sin(h) * r.len * 0.36, main: false };
  }
  function stack(p, b, i, dt) {
    const ang = Math.atan2(p.z - b.z, p.x - b.x) + 0.45, r = 62 + 7 * Math.min(i, 6);
    p.fly(b.x + Math.cos(ang) * r, b.z + Math.sin(ang) * r, 20 + 3 * Math.min(i, 6), dt, p.pt.speed * 0.72);
  }
  function landing(p, dt) {
    const b = p.carrier, a = b.ai, o = b.ops;
    a.lq = a.lq.filter(q => q.alive && !q.removed && q.state === 'landing' && q.carrier === b);
    if (a.lq.indexOf(p) < 0 && !p.leaving) a.lq.push(p);
    const i = Math.max(0, a.lq.indexOf(p));
    p.rwT += dt;
    if (p.leaving) return leave(p, b, dt);
    const R = landRunway(b);
    if (!R) { // nowhere to land: hold over the island, then divert (carrier types) or ditch by a friendly ship
      const gh = 2.5 + Math.max(0, -WW.terrain.depthAt(p.x, p.z)); if (p.y < gh) { p.y = gh; p.vy = Math.max(0, p.vy); }
      if (o.occ === p) o.occ = null; if (o.crossOcc === p) o.crossOcc = null;
      p.rwPh = 'circuit'; p.holdT = (p.holdT || 0) + dt; if (p.holdT === dt) ST.holds++;
      if (p.holdT > (b.neutralized ? LEAVE_T : HOLD_MAX)) { p.leaving = true; return; }
      stack(p, b, i, dt); return;
    }
    p.holdT = 0;
    const c = Math.cos(R.h), s = Math.sin(R.h), fx = R.x - c * 75, fz = R.z - s * 75;
    if (p.rwPh === 'circuit') {
      const gh = 2.5 + Math.max(0, -WW.terrain.depthAt(p.x, p.z)); if (p.y < gh) { p.y = gh; p.vy = Math.max(0, p.vy); } // the circuit clears the hills
      const clear = R.main ? o.mode === 'recover' && !o.occ && !o.hold : !o.crossOcc;
      if (i > 0 || !clear) { stack(p, b, i, dt); p.apOut = false; return; }
      // the approach: the outer marker (150 back) first, then the final gate (75 back), so it arrives lined up
      const ox = R.x - c * 150, oz = R.z - s * 150;
      if (!p.apOut) { p.fly(ox, oz, 16, dt, p.pt.speed * 0.75, 1.4); if (WW.dist(p.x, p.z, ox, oz) < 22) p.apOut = true; return; }
      const d = WW.dist(p.x, p.z, fx, fz);
      p.fly(fx, fz, 11, dt, p.pt.speed * 0.7, 1.4);
      if (d < 14 && Math.abs(WW.angleDiff(p.heading, R.h)) < 0.7) {
        p.rwPh = 'final'; p.rwT = 0; p.rwH = R.h; p.rwX = R.x; p.rwZ = R.z; p.emergency = !R.main;
        if (R.main) o.occ = p; else { o.crossOcc = p; ST.emergency++; }
      }
      return;
    }
    // final: down the centreline (PD on the cross-track drift), descending to the touchdown point
    const h = p.rwH, ch = Math.cos(h), sh = Math.sin(h), dx = p.x - p.rwX, dz = p.z - p.rwZ;
    const along = dx * ch + dz * sh, cross = -dx * sh + dz * ch, vc = dt > 0 && p._cr !== undefined ? (cross - p._cr) / dt : 0; p._cr = cross;
    const togo = -along; p.togo = togo; p.hd = WW.angleDiff(p.heading, h);
    if (R.h !== h || R.main === !!p.emergency || p.rwT > 25) { // the runway closed under it: go round
      p.rwPh = 'circuit'; p._cr = undefined; p.apOut = false; if (o.occ === p) o.occ = null; if (o.crossOcc === p) o.crossOcc = null; return;
    }
    const want = h - WW.clamp(cross * 0.12 + vc * 0.1, -0.7, 0.7), dd = WW.angleDiff(p.heading, want);
    if (Math.abs(dd) > 2.4) { p.finSign = p.finSign || Math.sign(dd) || 1; p.heading += p.finSign * 1.8 * dt; } // far off: one committed turn
    else { p.finSign = 0; p.turnTo(want, dt, 1.8); }
    const ty = groundY(b) + gearOf(p) + WW.clamp(togo * 0.12, 0, 10);
    p.speed += WW.clamp(Math.max(p.pt.speed * 0.55, 13) - p.speed, -6 * dt, 6 * dt);
    p.vy = WW.clamp((ty - p.y) * 2.5, -6, 4);
    if (togo < 1) { // touchdown
      p.state = 'rollout'; p.y = groundY(b) + gearOf(p); p.vy = 0; p.heading = h; p.t = 0; p._cr = undefined;
      a.lq.splice(a.lq.indexOf(p), 1); WW.stats.planesLanded++; ST.landings++;
      G().touchdown(p, b);
      if (p.hp < p.maxHp * 0.5) WW.emit('baseEvent', { kind: 'crashLanding', base: b, nation: b.nation, x: p.x, z: p.z, plane: p });
    }
  }
  function rollout(p, dt) { return G().inbound(p, dt); }

  // Leaving a closed field: a carrier-capable plane diverts to the nearest friendly carrier with deck room within
  // DIVERT_R; any other type (land bombers can never land on a deck) flies to the nearest friendly ship and ditches
  // beside it (endgame.js / air_flyingboats.js send a rescue); with no friendly ship, it ditches off the reef.
  function deckRoom(cv) {
    let cap = cv.wingN || 0, n = 0; const P = cv.stats.planes || {};   // the carrier's own air group (air_boss.js), else the ship stats
    if (!cap) for (const k in P) cap += P[k];
    for (const k in cv.hangar) n += cv.hangar[k] || 0;
    n += (cv.rearm || []).length;
    for (const q of WW.world.planes) if (q.alive && q.carrier === cv) n++;
    return cap + 2 - n;
  }
  function leave(p, b, dt) {
    if (!p.leaveT) {
      p.leaveT = WW.time.now;
      let cv = null, cd = DIVERT_R, ship = null, sd = 1e9;
      for (const s of WW.world.ships) {
        if (!s.alive || s.sinking || s.nation !== p.nation) continue;
        const d = WW.dist(p.x, p.z, s.x, s.z);
        if (VAR[p.variant] && VAR[p.variant].carrier && s.type === 'carrier' && s.hangar && d < cd && deckRoom(s) > 0) { cd = d; cv = s; }
        if (s.type !== 'submarine' && d < sd) { sd = d; ship = s; }
      }
      const i = b.ai.lq.indexOf(p); if (i >= 0) b.ai.lq.splice(i, 1);
      if (cv) { // the carrier's air boss takes it (air_deck.js): it lands, rearms and joins the carrier's group
        if (p.slot) { p.slot.state = 'away'; p.slot.plane = null; }
        p.slot = null; p.carrier = cv; p.state = 'return'; p.rwPh = null; p.leaving = false; ST.diverted++;
        WW.emit('baseEvent', { kind: 'divert', base: b, nation: b.nation, x: p.x, z: p.z, plane: p, carrier: cv });
        return;
      }
      p.ditchTo = ship ? { ship, x: ship.x, z: ship.z } : b.ditch ? { x: b.ditch.x, z: b.ditch.z } : { x: p.x, z: p.z };
    }
    const D = p.ditchTo;
    if (D.ship && D.ship.alive && !D.ship.sinking) { D.x = D.ship.x; D.z = D.ship.z; }
    else if (D.ship) { // the ship it was making for has gone: the next nearest friendly ship, else its last position
      let best = null, bd = 1e9;
      for (const s of WW.world.ships) if (s.alive && !s.sinking && s.nation === p.nation && s.type !== 'submarine') { const d = WW.dist(p.x, p.z, s.x, s.z); if (d < bd) { bd = d; best = s; } }
      if (best) { D.ship = best; D.x = best.x; D.z = best.z; } else { D.ship = null; if (D.x === undefined) { D.x = p.x; D.z = p.z; } }
    }
    const tx = D.x, tz = D.z;
    const d = WW.dist(p.x, p.z, tx, tz), off = D.ship ? 22 : 0;
    p.fly(tx, tz, d > 60 ? 18 : 6, dt, p.pt.speed * 0.75);
    if ((d < off + 8 && WW.terrain.depthAt(p.x, p.z) > 1.5) || WW.time.now - p.leaveT > 150) { ST.ditched++; p.ditch(); }
  }

  // ---------- level bombing, and strikes on the base aimed at its facilities ----------
  function aimFor(pl, b) {
    if (pl.aimF && !(pl.aimF.f && pl.aimF.f.out && !pl.phase)) return pl.aimF;
    const L = [];
    for (const r of b.runways) if (!r.closed) { L.push({ x: r.x, z: r.z }); L.push({ x: r.x + r.c * r.len * 0.3, z: r.z + r.s * r.len * 0.3 }); }
    for (const f of b.facilities) if (!f.out && (f.kind === 'battery' || f.kind === 'aa' || f.kind === 'hangar' || f.kind === 'fuel')) L.push({ x: f.x, z: f.z, f });
    if (!L.length) L.push({ x: b.x, z: b.z });
    return (pl.aimF = L[(b.ai.aimN++) % L.length]);
  }
  function swap(pl, t, fn) { // run fn with the base's x / z moved to this plane's aim point
    const a = aimFor(pl, t), ox = t.x, oz = t.z;
    t.x = a.x; t.z = a.z;
    try { return fn(); } finally { t.x = ox; t.z = oz; }
  }
  function level(pl, dt) {
    if (!pl.lvLand && pl.sk !== 'atk' && WW.strike.escort(pl, dt)) return; // a carrier wave (Kates on the island): formation first
    const t = pl.validTarget(), L = pl.level || KATE;
    if (pl.lvPh === 'away') {
      pl.phaseT -= dt; pl.turn = 0; pl.climbTo(L.alt + 4, dt); pl.speedTo(pl.pt.speed, dt);
      if (pl.phaseT <= 0) { pl.lvPh = null; pl.state = pl.ordnance ? 'transit' : 'return'; }
      return;
    }
    if (!t) { pl.state = 'return'; return; }
    const isB = t.isBase, A = isB ? aimFor(pl, t) : t, d = WW.dist(pl.x, pl.z, A.x, A.z);
    pl.state = d < 150 ? 'attack' : 'transit';
    const gnd = Math.max(0, -WW.terrain.depthAt(A.x, A.z)), T = Math.sqrt(2 * Math.max(4, pl.y - gnd) / 9.8);
    const lead = isB ? 0 : t.speed * T, px = A.x + Math.cos(t.heading || 0) * lead, pz = A.z + Math.sin(t.heading || 0) * lead;
    const side = ((pl.fi || pl.wing || 0) % 3 === 1 ? -1 : (pl.fi || pl.wing || 0) % 3 === 2 ? 1 : 0) * 9; // a loose vic across the run
    const h = Math.atan2(pz - pl.z, px - pl.x), ox = -Math.sin(h) * side, oz = Math.cos(h) * side;
    const he = pl.fly(px + ox, pz + oz, L.alt, dt, pl.pt.speed, 0.8);
    const rel = pl.speed * 0.75 * T;
    if (d < rel && Math.abs(he) < 0.3 && pl.y > L.alt * 0.75) {
      for (let k = 0; k < (L.bombs || 1); k++) { if (isB) swap(pl, t, () => WW.combat.dropBomb(pl, t)); else WW.combat.dropBomb(pl, t); }
      pl.dropped(); pl.lvPh = 'away'; pl.phaseT = 5; ST.levelDrops++;
      if (pl.carrier && pl.carrier.isBase) WW.islandBase.stats.landDrops++;
    } else if (d < 12) { pl.lvPh = 'away'; pl.phaseT = 7; } // overshot: run on and come round again
  }
  if (WW.strike) {
    const dive0 = WW.strike.dive, torp0 = WW.strike.torp;
    WW.strike.dive = function (pl, dt) {
      if (pl.level) return level(pl, dt);
      const t = pl.target;
      if (t && t.isBase && t.alive) return swap(pl, t, () => dive0(pl, dt));
      return dive0(pl, dt);
    };
    WW.strike.torp = function (pl, dt) {
      if (pl.level || (pl.target && pl.target.isBase)) { if (!pl.level) pl.level = KATE; return level(pl, dt); }
      return torp0(pl, dt);
    };
  }
  // land-based hits on ships (the midway metrics): bombs and torpedoes from base planes
  const fromBase = new WeakSet();
  WW.on('weaponDropped', e => { if (e && e.proj && e.plane && e.plane.carrier && e.plane.carrier.isBase) fromBase.add(e.proj); });
  WW.on('weaponImpact', e => {
    if (!e || !e.proj || !fromBase.has(e.proj)) return;
    fromBase.delete(e.proj);                     // pooled projectiles are reused
    if (e.ship && WW.islandBase.stats) WW.islandBase.stats.landHits++;
  });
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });

  WW.landAir = { setup, update, launched, takeoff, goHome, landing, rollout, hangarLost, aimFor, VAR, stats: ST };
})();
