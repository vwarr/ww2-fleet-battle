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
//    warm-up, a fast taxi), and every 55-75 s a strike on the best known enemy ship within STRIKE_R (on the island
//    patrol's fresh report of carriers or battleships: the bombers' combat radius, longPick): dive and torpedo
//    bombers as a WW.strike wave, level bombers on their own. Nothing is launched while the main runway is closed,
//    the base is neutralized or it is dusk; queued launches wait for the runway to be repaired.
//  - Home: every plane holds at a fix away from the island and the enemy's ships (land_hold.js: the land bombers, B-17,
//    B-26, Betty, high and far out, kept off while a raid is over the field; the small planes closer in and lower),
//    called in from its marshal point a section at a time when the field is recovering (land_flow.js call: each in
//    trail, its outer marker TRAIL farther out than the one ahead; with the cross runway open every second plane lands
//    on it and is towed clear, useCross), or in a landing slot between take-offs while it launches, the maydays first; final down the centreline
//    into the wind, touchdown. Main runway closed: an emergency landing on the cross
//    runway if it is open (the plane is towed off), else the plane holds for the repair (burning HOLD_BURN) until its own
//    bingo (bingoOut: its fuel and reserve just cover the way out; a neutralized base: LEAVE_T s, 6 s more per place in the stack), so a stack leaves one
//    by one; then a carrier-capable type (VAR carrier) diverts to a friendly carrier with deck room in its reach, and
//    every other type (B-17, B-26, Betty, ...) ditches abeam of a friendly ship, ahead of her (air_flight.js ditchFly).
//    Darkness does not shut the field: Midway lit its strip with flare pots and recovered at night.
//  - Level bombing (pl.level): B-17 / Betty level variants, and carrier torpedo planes sent against the island (Kates
//    carried bombs at Midway): a land bomber first climbs to its bombing height (circling out of the target's reach
//    if it is close), then straight and level, a stick released on the throw point; dropBomb's scatter grows with
//    height and, on a ship under way, with the real time of fall (the ship turned under the bombs), so a B-17 at
//    7,000 m rarely hits a ship (historically they hit nothing at Midway).
//  - Strikes on the base: each bomber aims at one of its points (aimFor: AA pits, hangars, fuel, tower, ramp, parked rows; runways last); a level stick walks across it.
window.WW = window.WW || {};
(function () {
  'use strict';
  const HOLD_BURN = 0.35, BINGO_M = 4, LEAVE_T = 12, RUN_R = 260, STRIKE_R = 560;   // hold burn per s (lean, throttled back), bingo margin (fuel s)
  // variant: kind, model key, flight stats over the nation's kind, level bombing { alt, ship: alt on a ship, bombs } (WW.altOf
  // of the historical height: B-17 7,000 m as at Midway; Betty 6,500 m over an island, 5,800 m on ships), gear height, parking class, carrier-capable
  const VAR = {
    f4f:  { kind: 'fighter', model: null, sq: 'VMF-221', cls: 'S', carrier: true },
    sbd:  { kind: 'dive', model: null, sq: 'VMSB-241', cls: 'S', carrier: true },
    b26:  { kind: 'torpedo', model: 'b26', sq: '69th BS', st: { hp: 46, speed: 30, turn: 0.85, climb: 4, range: 1300 }, gear: 1.0, cls: 'M' },
    b17:  { kind: 'dive', model: 'b17', sq: '431st BS', st: { hp: 80, speed: 24, turn: 0.55, climb: 3, range: 1500 }, gear: 1.25, level: { alt: WW.altOf(7000), bombs: 3, bombK: 0.5 }, cls: 'L' },
    a6m:  { kind: 'fighter', model: null, sq: 'Tainan Kokutai', cls: 'S', carrier: true },
    g4m:  { kind: 'torpedo', model: 'g4m', sq: 'Misawa Kokutai', st: { hp: 34, speed: 30, turn: 0.85, climb: 4, range: 1500 }, gear: 1.0, cls: 'L' },
    g4mL: { kind: 'dive', model: 'g4mL', sq: 'Chitose Kokutai', st: { hp: 34, speed: 29, turn: 0.8, climb: 3.6, range: 1500 }, gear: 1.0, level: { alt: WW.altOf(6500), ship: WW.altOf(5800), bombs: 2, bombK: 0.6 }, cls: 'L' }
  };
  for (const k in VAR) if (VAR[k].gear) VAR[k].gear *= WW.cfg.PLANE_K || 1;   // gear heights above were measured at the 1.7 plane scale
  const KATE = { alt: 40, bombs: 1 };
  const SCRAMBLE_MAX = 6, OVER_R = 220;    // base fighters in the air under a raid (VMF-221 put up 25 at Midway; the roster limits it)
  const TRAIL = 110;                        // a called section in trail on one runway: its outer markers this far apart (the one ahead is past LAND_SEP on its roll as the next reaches the gate)
  const CAP_QUIET = 2;                      // the standing CAP with no raid on the plot: one section, out on the threat bearing (air_cap.js)
  const ST = { launches: 0, landings: 0, ditched: 0, diverted: 0, strikes: 0, levelDrops: 0, holds: 0, emergency: 0, crossLand: 0, goRound: 0, scrambles: 0, closedLaunches: 0, defence: 0, defStrikes: 0 };

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
  // island_base.js) or a gun ship counting double; null when the sea round the island is clear. Never a PT boat or a
  // submarine: the bombers are not sent at small craft (the shore batteries' job), and a destroyer only when no bigger
  // ship is in reach (strikeTarget).
  const DEF_R = 300, DEF_V = { battleship: 9, cruiser: 6, carrier: 8, destroyer: 3 };
  function defTarget(b) {
    if (!WW.intel) return null;
    let best = null, bs = 0; const now = WW.time.now;
    for (const c of WW.intel.enemyShips(b.nation, { fresh: true })) {
      const u = c.unit; if (!u || !u.alive || u.sinking || u.submerged || u.isBase || !DEF_V[u.type]) continue;
      const d = WW.dist(b.x, b.z, c.x, c.z); if (d > DEF_R) continue;
      const sc = (DEF_V[u.type] || 1) * (now - (u._bombT || -1e9) < 60 ? 2 : 1) / (1 + d / 150);
      if (sc > bs) { bs = sc; best = u; }
    }
    return best;
  }
  // The base's bombers go for the big ships (air_ops.js pickTarget opts.big): the best carrier, battleship or cruiser
  // in reach; the self-defence target first unless it is a destroyer and a bigger ship is in reach
  const bigPick = b => (WW.airOps ? WW.airOps.pickTarget({ x: b.x, z: b.z, nation: b.nation }, { big: true, reach: STRIKE_R }) : null);
  // On the island patrol's fresh report (base.alertT, base_alert.js) of carriers (first) or battleships: out to the bombers'
  // fuel radius (out and back, ATTACK_T s over the target, RES_K in reserve: air_cag.js reach), as Midway's on the PBY report
  const ATTACK_T = 25, RES_K = 0.15, LONG = { carrier: 2, battleship: 1 };
  function radius(v) { const P = Object.assign({}, WW.PLANE_TYPES[VAR[v].kind], VAR[v].st); return (P.range / P.speed * 6 * (1 - RES_K) - ATTACK_T) * P.speed / 2; }
  function longR(b) { let R = STRIKE_R; for (const s of b.slots) if (VAR[s.v].kind !== 'fighter') R = Math.max(R, radius(s.v)); return R; }
  const alerted = b => (b.alertT || 0) > WW.time.now;
  function longPick(b) {
    let best = null, bs = -1e9; const R = WW.intel && alerted(b) ? longR(b) : 0;
    if (R) for (const c of WW.intel.enemyShips(b.nation, { fresh: 45 })) { const u = c.unit, k = LONG[WW.intel.typeOf(c)], d = WW.dist(b.x, b.z, c.x, c.z); if (u && u.alive && !u.sinking && !u.isBase && k && d < R && k * 1e4 - d > bs) { bs = k * 1e4 - d; best = u; } }
    return best;
  }
  function strikeTarget(b, def) {
    const t = longPick(b) || bigPick(b);
    return def && (def.type !== 'destroyer' || !t || t.type === 'destroyer') ? def : t;
  }
  function variants(b, kind) { const L = []; for (const s of b.slots) if (VAR[s.v].kind === kind && !VAR[s.v].level && L.indexOf(s.v) < 0) L.push(s.v); return L; }
  function pick(b, kind) { for (const v of variants(b, kind)) if (G().ready(b, v) > 0) return v; return null; }
  function canLaunch(b) { return G().opsOpen(b) && !(WW.dayNight && WW.daylight < 0.53); }
  function update(b, dt) {
    const a = b.ai, now = WW.time.now;
    G().update(b, dt);
    WW.landFlow.update(b);   // the landing queue by need, a landing slot between take-offs (land_flow.js)
    if (b.neutralized) { a.queue.length = 0; return; }
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 1;
      const pic = WW.airOps ? WW.airOps.picture(b) : null, raid = !!(pic && pic.near > 0) || (b.alertT || 0) > now; // alertT: the own flying boat's report (base_alert.js)
      // enemy planes over the field (inside OVER_R; fighters too: a sweep draws a fight, Zeros over Midway): the field
      // scrambles more, up to SCRAMBLE_MAX in the air, one more for each of them (a raid on the fleet farther out: no)
      let over = (b.alertT || 0) > now ? 2 : 0; if (raid && WW.intel) for (const c of WW.intel.enemyPlanes(b.nation)) if (c.unit && c.unit.alive && WW.dist(c.x, c.z, b.x, b.z) < OVER_R) over++;
      const cw = WW.airOps ? WW.airOps.capWanted(b) : 2, want = over ? Math.min(SCRAMBLE_MAX, Math.max(4, cw + over)) : raid ? Math.min(4, cw) : Math.min(CAP_QUIET, cw), cs = capState(b);
      const queued = a.queue.filter(q => VAR[q.v].kind === 'fighter' && !q.target).length;
      let need = want - cs.on - cs.coming - queued;
      for (; need > 0; need--) {
        const fv = pick(b, 'fighter');
        if (!fv || G().ready(b, fv) - a.queue.filter(q => q.v === fv).length <= 0) break;
        a.queue.unshift({ v: fv, target: null, fast: raid });
      }
      if (WW.strafe && !raid) WW.strafe.capCheck(b);   // the field's CAP strafes small craft off the island (air_strafe.js)
      if (raid && now - a.scrT > 60 && canLaunch(b) && a.queue.some(q => q.fast)) { a.scrT = now; ST.scrambles++; WW.emit('baseEvent', { kind: 'scramble', base: b, nation: b.nation, x: b.x, z: b.z }); }
    }
    a.strikeT -= dt;
    const def = defTarget(b);   // self-defence first: warships off the island (the Cactus Air Force after the bombardment)
    if (def && def !== a.defFor) { a.defFor = def; a.strikeT = Math.min(a.strikeT, 4); ST.defence++; }
    const lp = longPick(b); if (lp && lp !== a.longFor) { a.longFor = lp; a.strikeT = Math.min(a.strikeT, 3); }   // carriers on the patrol's plot: go
    if (a.strikeT <= 0 && !a.queue.some(q => q.target)) {
      a.strikeT = WW.randRange(55, 75);
      const t = strikeTarget(b, def);
      if (t && !canLaunch(b) && def) a.strikeT = 5;   // runway cratered / dark: the strike goes the moment it can (at dawn)
      const td = t ? WW.dist(b.x, b.z, t.x, t.z) : 0;
      if (t && td < (LONG[t.type] && alerted(b) ? longR(b) : STRIKE_R) && canLaunch(b)) {
        if (t === def) ST.defStrikes++;
        const wave = [], avail = {};
        for (const s of b.slots) if (s.state === 'parked' && s.readyAt <= now && !s.moved) avail[s.v] = (avail[s.v] || 0) + 1;
        for (const k in avail) {
          if (VAR[k].kind === 'fighter' || radius(k) < td) continue;   // (beyond its reach: stays home)
          for (let i = 0; i < avail[k]; i++) { const q = { v: k, kind: VAR[k].kind, target: t, level: !!VAR[k].level }; a.queue.push(q); if (!q.level) wave.push(q); }
        }
        const f = pick(b, 'fighter'), esc = b.nation === 'IJN' && f && radius(f) >= td ? Math.min(2, G().ready(b, f) - 3) : 0; // Zeros escort the Bettys
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
    if (t && (!t.alive || t.sinking)) t = bigPick(b);
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
  function goHome(p, dt) { // at its class's holding height to the field or its fix (land_hold.js)
    const b = p.carrier;
    p.foe = null;
    if (WW.landHold.goHome(p, b, dt)) { p.state = 'landing'; p.rwPh = 'circuit'; p.rwT = 0; if (b.ai.lq.indexOf(p) < 0) b.ai.lq.push(p); }
  }
  // the runway to land on, into the wind: the main one, else (emergency) the cross runway; null: none open
  function landRunway(b) {
    if (b.neutralized) return null;
    const o = b.ops;
    if (G().opsOpen(b)) { const h = o.dir > 0 ? b.heading : b.heading + Math.PI, td = b.layout.toW(-o.dir * 34, 0); return { h, x: td.x, z: td.z, main: true }; }
    return crossR(b);
  }
  // the cross runway into the wind (null: shut)
  function crossR(b) {
    const r = b.runways[1], wh = WW.wind ? WW.wind.a + Math.PI : b.heading; if (!r || r.closed || b.neutralized || G().crossFouled(b)) return null;   // (a wreck on it: shut too)
    const h = Math.cos(WW.angleDiff(r.h, wh)) >= 0 ? r.h : r.h + Math.PI;
    return { h, x: r.x - Math.cos(h) * r.len * 0.36, z: r.z - Math.sin(h) * r.len * 0.36, main: false };
  }
  function landing(p, dt) {
    const b = p.carrier, a = b.ai, o = b.ops;
    a.lq = a.lq.filter(q => q.alive && !q.removed && q.state === 'landing' && q.carrier === b);
    if (a.lq.indexOf(p) < 0 && !p.leaving) a.lq.push(p);
    const i = Math.max(0, a.lq.indexOf(p));
    p.rwT += dt;
    if (p.leaving) return leave(p, b, dt);
    const R0 = landRunway(b), LH = WW.landHold, bg = LH.big(p), R = p.useCross && R0 && R0.main ? crossR(b) || R0 : R0;   // (useCross: called to the cross runway, land_flow.js)
    if (!R) { // nowhere to land: hold at the fix, then divert (carrier types) or ditch by a friendly ship
      p.called = false; p.useCross = false;
      const gh = 2.5 + Math.max(0, -WW.terrain.depthAt(p.x, p.z)); if (p.y < gh) { p.y = gh; p.vy = Math.max(0, p.vy); }
      if (o.occ === p) o.occ = null; if (o.crossOcc === p) o.crossOcc = null;
      p.rwPh = 'circuit'; p.cleared = false; p.holdT = (p.holdT || 0) + dt; if (p.holdT === dt) ST.holds++;
      p.fuel -= dt * HOLD_BURN;   // throttled back in the hold: the repair is waited out while the tanks allow
      if (b.neutralized ? (p.nzT = (p.nzT || 0) + dt) > LEAVE_T + 6 * i : (p.boT = (p.boT || 0) - dt) <= 0 && (p.boT = 1, bingoOut(p))) { p.leaving = true; return; }
      LH.orbit(p, b, i, dt);
      return;
    }
    p.holdT = 0;
    const c = Math.cos(R.h), s = Math.sin(R.h), fx = R.x - c * 75, fz = R.z - s * 75;
    if (p.rwPh === 'circuit') {
      const gh = 2.5 + Math.max(0, -WW.terrain.depthAt(p.x, p.z)); if (p.y < gh) { p.y = gh; p.vy = Math.max(0, p.vy); } // the circuit clears the hills
      // cleared to approach while the field recovers (or in a landing slot): at most two on the approach (cleared, not
      // yet on final), the second in trail once the one ahead is past the outer marker (a plane far out at its fix as
      // soon as the one ahead is cleared: its run in is long); a cleared approach is never cancelled by the field changing mode (only a
      // closed runway sends it round, and a raid over the field a land bomber short of the outer marker: land_hold.js)
      const om = 150 + TRAIL * (p.trailK || 0), ox = R.x - c * om, oz = R.z - s * om;   // a section in trail: each its own outer marker, TRAIL apart
      const clear = R.main ? WW.landFlow.clear(p, b) : !o.crossOcc && (R === R0 || WW.landFlow.clear(p, b));   // the field recovering, or a landing slot (land_flow.js); the cross free
      const go = p.called || o.lslot === p;   // called in from the marshal (land_flow.js call), or a landing slot
      const off = bg && LH.raidHold(p, b, dt);
      if (off || (!(p.cleared && p.clearedMain === R.main) && (!go || !clear))) { LH.orbit(p, b, i, dt); p.apOut = false; return; }
      p.cleared = true; p.clearedMain = R.main;
      // the approach: the outer marker (150 back) first, then the final gate (75 back), so it arrives lined up
      if (!p.apOut) { const dm = WW.dist(p.x, p.z, ox, oz); p.fly(ox, oz, 16, dt, p.pt.speed * (dm > 120 ? 0.9 : 0.75), 1.4); if (dm < 22) p.apOut = true; return; }   // (in from the marshal at cruise, slowing near the marker)
      const d = WW.dist(p.x, p.z, fx, fz);
      p.fly(fx, fz, 11, dt, p.pt.speed * 0.7, 1.4);
      if (d < 14 && Math.abs(WW.angleDiff(p.heading, R.h)) < 0.7 && (R.main ? !o.occ : !o.crossOcc)) {   // the runway free: on final (else round the gate again)
        p.rwPh = 'final'; p.rwT = 0; p.rwH = R.h; p.rwX = R.x; p.rwZ = R.z; p.emergency = !R.main;
        if (R.main) o.occ = p; else { o.crossOcc = p; if (p.useCross) ST.crossLand++; else ST.emergency++; }
      } else if (d < 14) { p.apOut = false; ST.goRound++; }
      return;
    }
    // final: down the centreline (PD on the cross-track drift), descending to the touchdown point
    const h = p.rwH, ch = Math.cos(h), sh = Math.sin(h), dx = p.x - p.rwX, dz = p.z - p.rwZ;
    const along = dx * ch + dz * sh, cross = -dx * sh + dz * ch, vc = dt > 0 && p._cr !== undefined ? (cross - p._cr) / dt : 0; p._cr = cross;
    const togo = -along; p.togo = togo; p.hd = WW.angleDiff(p.heading, h);
    if (R.h !== h || R.main === !!p.emergency || p.rwT > 25) { // the runway closed under it: go round
      p.rwPh = 'circuit'; p._cr = undefined; p.apOut = false; p.cleared = false; if (o.occ === p) o.occ = null; if (o.crossOcc === p) o.crossOcc = null; return;
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
      if (p.hp < p.maxHp * 0.5) { G().crash(p, b); WW.emit('baseEvent', { kind: 'crashLanding', base: b, nation: b.nation, x: p.x, z: p.z, plane: p }); } // a wreck (land_ground.js crash)
      else G().touchdown(p, b);
    }
  }
  function rollout(p, dt) { return G().inbound(p, dt); }

  // Leaving a closed field: a carrier-capable plane diverts to the nearest friendly carrier with deck room within its
  // fuel's reach; any other type (land bombers can never land on a deck) flies to the nearest friendly ship and ditches
  // beside it (endgame.js / air_flyingboats.js send a rescue); with no friendly ship, it ditches off the reef.
  function deckRoom(cv) {
    let cap = cv.wingN || 0, n = 0; const P = cv.stats.planes || {};   // the carrier's own air group (air_boss.js), else the ship stats
    if (!cap) for (const k in P) cap += P[k];
    for (const k in cv.hangar) n += cv.hangar[k] || 0;
    n += (cv.rearm || []).length;
    for (const q of WW.world.planes) if (q.alive && q.carrier === cv) n++;
    return cap + 2 - n;
  }
  // where a plane leaving the field would go: a friendly carrier with deck room it has the fuel to reach (carrier types),
  // else the friendly ship to ditch beside (air_flight.js ditchShip: a destroyer first); d: the way there
  function outlet(p) {
    const F = WW.airFlight, f = p.fuel + F.reserve(p);
    let cv = null, cd = 1e9;
    if (!p.variant || VAR[p.variant].carrier) for (const s of WW.world.ships) {
      if (!s.alive || s.sinking || s.nation !== p.nation || s.type !== 'carrier' || !s.hangar || s.deckOut) continue;   // (not a holed deck, ship_deck.js)
      const d = WW.dist(p.x, p.z, s.x, s.z);
      if (d < cd && d / F.cruise(p) * F.CRUISE_BURN * 1.1 < f && deckRoom(s) > 0) { cd = d; cv = s; }
    }
    if (cv) return { cv, d: cd };
    const ship = F.ditchShip(p);
    return { ship, d: ship ? WW.dist(p.x, p.z, ship.x, ship.z) : 0 };
  }
  // bingo in the hold: each plane by its own tanks (the fuel and its reserve just cover the way to its outlet, at
  // cruise, plus BINGO_M), so a stack over a shut field breaks up one by one, never all together
  function bingoOut(p) { const F = WW.airFlight; return p.fuel + F.reserve(p) < outlet(p).d / F.cruise(p) * F.CRUISE_BURN * 1.1 + BINGO_M; }
  function leave(p, b, dt) {
    if (!p.ditchTo) {   // (a plane that diverted once and came back to a shut field chooses again)
      p.leaveT = WW.time.now;
      const o = outlet(p), cv = o.cv, ship = o.ship;
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
    else if (D.ship) { // the ship it was making for has gone: the next one (air_flight.js ditchShip), else its last position
      const s = WW.airFlight.ditchShip(p); D.ship = s; D.side = undefined; D.gate = false; if (s) { D.x = s.x; D.z = s.z; }
    }
    // the ditching run abeam of her, along her course (air_flight.js ditchFly), over water deep enough
    if ((WW.airFlight.ditchFly(p, D, dt, p.pt.speed * 0.75) && WW.terrain.depthAt(p.x, p.z) > 1.5) || WW.time.now - p.leaveT > 150) { ST.ditched++; p.ditch(); }
  }

  // ---------- level bombing, and strikes on the base aimed at its facilities ----------
  // The aim points, weighted the historical way (Midway, 4 June 1942: the fuel tanks, hangars, power plant and seaplane
  // hangar burned, the runways stayed usable): the dive bombers go for the AA pits first (flak suppression), then the
  // hangars, the fuel, the tower, the seaplane ramp and the planes parked in their rows; the level bombers for the
  // hangars, the fuel and the rows; an open runway (one point, its middle third) last. Each point is listed W times,
  // pass by pass (every point once, then those worth 2, ...), and the round-robin aimN spreads a raid over them.
  const AIM_W = {
    dive: { aa: 3, hangar: 2, fuel: 2, tower: 2, ramp: 2, ammo: 1, battery: 1, row: 2, runway: 1 },
    level: { aa: 1, hangar: 3, fuel: 3, tower: 2, ramp: 2, ammo: 1, battery: 0, row: 3, runway: 1 }
  };
  const STICK = 8;   // u between the bombs of a level bomber's stick, released in train along the run line
  function rowAim(b, ri) {   // the parked planes of dispersal row ri: their centre and count
    let x = 0, z = 0, n = 0;
    for (const s of b.slots || []) if (s.spot && s.spot.row === ri && (s.state === 'parked' || s.state === 'rearm')) { x += s.x; z += s.z; n++; }
    return n ? { x: x / n, z: z / n, n } : null;
  }
  function stale(a, b) { return a.f ? a.f.out : a.rw ? a.rw.closed : a.row !== undefined ? !rowAim(b, a.row) : false; }
  function aimFor(pl, b) {
    if (pl.aimF && !(!pl.phase && stale(pl.aimF, b))) return pl.aimF;
    const W = AIM_W[pl.level ? 'level' : 'dive'], P = [];
    for (const f of b.facilities) if (!f.out && W[f.kind]) P.push({ w: W[f.kind], a: { x: f.x, z: f.z, f, what: f.kind } });
    const rows = (b.layout && b.layout.rows) || [];
    for (let i = 0; i < rows.length; i++) { const r = rowAim(b, i); if (r) P.push({ w: W.row, a: { x: r.x, z: r.z, row: i, what: 'row' } }); }
    for (const r of b.runways) if (!r.closed) { const k = ((b.ai.aimN * 0.618) % 1 - 0.5) * 0.6 * r.len; P.push({ w: W.runway, a: { x: r.x + r.c * k, z: r.z + r.s * k, rw: r, what: 'runway' } }); }
    P.sort((p, q) => q.w - p.w);   // stable: the heaviest first in every pass
    const L = [];
    for (let p = 0; L.length < 200; p++) { let any = false; for (const q of P) if (q.w > p) { L.push(q.a); any = true; } if (!any) break; }
    if (!L.length) L.push({ x: b.x, z: b.z, what: 'centre' });
    return (pl.aimF = L[(b.ai.aimN++) % L.length]);
  }
  function swap(pl, t, fn, off) { // run fn with the base's x / z moved to this plane's aim point (off: u along his heading)
    const a = aimFor(pl, t), ox = t.x, oz = t.z, o = off || 0;
    t.x = a.x + Math.cos(pl.heading || 0) * o; t.z = a.z + Math.sin(pl.heading || 0) * o;
    try { return fn(); } finally { t.x = ox; t.z = oz; }
  }
  function level(pl, dt) {
    if (!pl.lvLand && pl.sk !== 'atk' && WW.strike.escort(pl, dt)) return; // a carrier wave (Kates on the island): formation first
    const t = pl.validTarget(), L = pl.level || KATE;
    if (pl.lvPh === 'away') {
      pl.phaseT -= dt; pl.turn = 0; pl.climbTo((pl.lvA || L.alt) + 4, dt); pl.speedTo(pl.pt.speed, dt);
      if (pl.phaseT <= 0) { pl.lvPh = null; pl.state = pl.ordnance ? 'transit' : 'return'; }
      return;
    }
    if (!t) { pl.state = 'return'; return; }
    const isB = t.isBase, A = isB ? aimFor(pl, t) : t, d = WW.dist(pl.x, pl.z, A.x, A.z), LA = pl.lvA = !isB && L.ship ? L.ship : L.alt;
    // a land bomber short of its height within RUN_R of the aim point: it circles there, out of the target's reach, in a
    // cruise climb (state transit: the type's climb rate, no zoom) until near the height, then turns in for the run
    if (pl.lvLand && pl.y < LA * (pl.lvC ? 0.96 : 0.9) && d < RUN_R) {
      if (!pl.lvC) { const k = RUN_R / Math.max(1, d); pl.lvC = { x: WW.clamp(A.x + (pl.x - A.x) * k, 50, WW.cfg.MAP_W - 50), z: WW.clamp(A.z + (pl.z - A.z) * k, 50, WW.cfg.MAP_H - 50) }; }
      const C = pl.lvC, ca = Math.atan2(pl.z - C.z, pl.x - C.x) + 0.5;
      pl.state = 'transit'; pl.fly(C.x + Math.cos(ca) * 40, C.z + Math.sin(ca) * 40, LA + 3, dt, pl.pt.speed);
      return;
    }
    pl.lvC = null;
    pl.state = d < 150 ? 'attack' : 'transit';
    const gnd = Math.max(0, -WW.terrain.depthAt(A.x, A.z)), T = Math.sqrt(2 * Math.max(4, pl.y - gnd) / 9.8);
    const lead = isB ? 0 : t.speed * T, px = A.x + Math.cos(t.heading || 0) * lead, pz = A.z + Math.sin(t.heading || 0) * lead;
    const side = ((pl.fi || pl.wing || 0) % 3 === 1 ? -1 : (pl.fi || pl.wing || 0) % 3 === 2 ? 1 : 0) * 9; // a loose vic across the run
    const h = Math.atan2(pz - pl.z, px - pl.x), ox = -Math.sin(h) * side, oz = Math.cos(h) * side;
    const he = pl.fly(px + ox, pz + oz, LA, dt, pl.pt.speed, 0.8);
    const rel = pl.speed * 0.75 * T;
    if (d < rel && Math.abs(he) < 0.3 && pl.y > LA * (pl.lvLand ? 0.9 : 0.75)) {
      // the stick in train: on the field each bomb falls STICK u further along the run line, walked across the aim point
      const nb = L.bombs || 1;
      for (let k = 0; k < nb; k++) { if (isB) swap(pl, t, () => WW.combat.dropBomb(pl, t), (k - (nb - 1) / 2) * STICK); else WW.combat.dropBomb(pl, t); }
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

  WW.landAir = { longR, setup, update, launched, takeoff, goHome, landing, rollout, hangarLost, aimFor, VAR, stats: ST };
})();
