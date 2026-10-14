// land_flow.js - WW.landFlow: the island field's landing traffic (sim code: it draws no WW.rand). Loads after
// land_hold.js, before land_air.js, which calls it from update / goHome / landing; land_ground.js asks it whether a
// lander has the runway (inbound) and whether a plane taxiing in may cross the taxiway (cross / colBusy).
//  - Priority (order, once per step): the landing queue b.ai.lq keeps its cleared approaches in front as they are; the
//    rest by need: an emergency first (mayday: crippled, or under MAYDAY_HP of its hp), then the low on fuel (under
//    LOW_FUEL of a full load: the CAP that flew its tanks dry), then the rest in arrival order.
//  - Mixed operations (update): while the field launches, a plane waiting to land gets a landing slot between take-offs
//    (b.ops.lslot; Midway and Henderson ran mixed operations on their strips): an emergency at once, anyone else after
//    SLOT_WAIT s in the queue, SLOT_GAP s after the last slot ended and once a departure has rolled since (or none is
//    waiting at the hold-short line), not during a scramble. The departures hold
//    short while a cleared lander is near the outer marker, on final or still on the runway (inbound); in launch mode
//    a lander keeps the runway until it has turned off it (land_ground.js), then crosses the taxiway to its column only
//    when no departure is taxiing there (cross), and holds the column until it is parked (colBusy).
//  - An emergency: straight in (no holding fix, no raid hold), cleared even in a long recovery window, the cross runway
//    if the main is shut (land_air.js landRunway). Coming home it flies the bearing toward the field that keeps
//    clearest of the enemy fighters and heavy-AA reach it knows of (route, re-chosen every ROUTE_T s; as land_hold.js
//    picks the fix), straight in once within DIRECT of the field.
//  - Guests (field): a carrier plane whose deck is out or gone may divert to its side's base (air_flight.js orphan,
//    through addField) while a runway is open and the base is not neutralized; it lands as a small plane with no
//    parking slot, is towed clear off the runway and stays parked, out of the fight.
window.WW = window.WW || {};
(function () {
  'use strict';
  const MAYDAY_HP = 0.6, LOW_FUEL = 0.1, SLOT_WAIT = 12, SLOT_GAP = 5, NEAR_OM = 60, CROSS_R = 12;
  const ROUTE_T = 1, DIRECT = 90, LEG = 110, FTR_R = 75, THREAT_R = 400;
  const SEC = 3, SEC_L = 2;   // planes called in together: a section of small planes, a pair of land bombers
  const ST = { slots: 0, maydaySlots: 0, maydays: 0, reroutes: 0, crossWaits: 0, guests: 0, calls: 0, sections: 0 };

  const mayday = p => !!p.crippled || p.hp < p.maxHp * MAYDAY_HP;
  const lowFuel = p => p.fuel < p.pt.range / p.pt.speed * 6 * LOW_FUEL;
  const need = p => (mayday(p) ? 2 : lowFuel(p) ? 1 : 0);
  const inQ = (q, b) => q.alive && !q.removed && q.state === 'landing' && q.carrier === b;

  // the landing queue in order of need (stable; cleared approaches stay in front), and the landing slot
  function update(b) {
    const a = b.ai, o = b.ops, now = WW.time.now;
    a.lq = a.lq.filter(q => inQ(q, b));
    const done = [], wait = [];
    for (const q of a.lq) {
      if (q.lqT === undefined) { q.lqT = now; if (mayday(q)) ST.maydays++; }
      (q.cleared || q.rwPh === 'final' ? done : wait).push(q);
    }
    wait.sort((x, y) => need(y) - need(x) || x.lqT - y.lqT);
    a.lq = done.concat(wait);
    call(b, wait);
    // the slot ends once its lander has turned off the runway (or is lost, towed, gone round to leave)
    const s = o.lslot, LH = WW.landHold;
    if (s && (!s.alive || s.removed || s.carrier !== b || s.leaving || (s.state !== 'landing' && s.state !== 'rollout') ||
      (s.state === 'rollout' && (s.rwPh !== 'land' && s.rwPh !== 'crash' && !(s.rwPh === 'taxiIn' && s.pi <= s.path.offRunway))) ||
      (s.state === 'landing' && !s.cleared && LH.big(s) && a.raid && !mayday(s)))) { o.lslot = null; o.slotT = now; }   // (a raid sent it back to hold)
    if (o.lslot || o.mode !== 'launch' || !WW.landGround.opsOpen(b) || done.length) return;
    for (const q of wait) {
      if (q.leaving) continue;
      const m = mayday(q);
      if (!m && (o.scr || LH.big(q) && a.raid)) continue;   // a scramble goes first; a raid keeps the bombers off
      if (m || (now - q.lqT >= SLOT_WAIT && now - (o.slotT || -1e9) >= SLOT_GAP && (o.lastRoll > (o.slotT || -1e9) || !o.holdQ.length))) { o.lslot = q; ST.slots++; if (m) ST.maydaySlots++; }
      break;
    }
  }
  // The call-in (the carriers' "Charlie"): the planes wait at their marshal points far out (land_hold.js) and the
  // field calls them in a section at a time (SEC; SEC_L land bombers), the next once the last one called is past its outer marker,
  // so they arrive, land and taxi in with no orbiting over the field. The maydays are called at once (a section of them, even while it launches); the need order
  // (emergency, low fuel, arrival) picks the section. Not while the field launches (the landing slot below), holds a
  // long recovery window, or is shut; the land bombers not while a raid is over the field. With the cross runway open,
  // every second plane of a section lands on it (towed clear: land_air.js useCross).
  function call(b, wait) {
    const a = b.ai, o = b.ops, LH = WW.landHold;
    let em = false; for (const q of a.lq) if (q.called && mayday(q) && q.rwPh === 'circuit') em = true;
    if (!em) { let k = 0; for (const q of wait) if (!q.called && !q.leaving && mayday(q)) { q.called = true; q.trailK = k; q.useCross = false; ST.calls++; if (++k >= SEC) break; } }   // the maydays: a section of them at once, in trail
    const main = WW.landGround.opsOpen(b), cross = !b.neutralized && !!(b.runways[1] && !b.runways[1].closed);
    if (main ? o.mode === 'launch' || o.hold : !cross) return;   // (the main shut: sections onto the cross runway)
    for (const q of a.lq) if (q.called && q.state === 'landing' && q.rwPh === 'circuit' && !q.apOut) return;   // a section still inbound (the next is called as the last one passes its outer marker)
    let k = 0, n = 0, km = 0, kc = 0;
    for (const q of wait) {
      if (q.called || q.leaving || (LH.big(q) && a.raid)) continue;
      if (!k) n = LH.big(q) ? SEC_L : SEC;
      q.called = true; q.useCross = main && cross && k % 2 === 1; q.trailK = q.useCross || !main ? kc++ : km++; ST.calls++;   // trailK: its place in trail on its runway
      if (++k >= n) break;
    }
    if (k) ST.sections++;
  }
  // cleared to approach the main runway: the field recovering (an emergency even in a long recovery window), or this
  // plane holds the landing slot
  function clear(p, b) { const o = b.ops; return (o.mode === 'recover' && (!o.hold || mayday(p))) || o.lslot === p; }
  // a lander has the main runway (land_ground.js: the departures hold short): cleared on the main and near the outer
  // marker, past it or on final, or the slot lander still on the runway
  function inbound(b) {
    const o = b.ops, h = o.dir > 0 ? b.heading : b.heading + Math.PI, td = b.layout.toW(-o.dir * 34, 0);
    const ox = td.x - Math.cos(h) * 150, oz = td.z - Math.sin(h) * 150;
    for (const q of b.ai.lq) {
      if (!q.alive || q.removed || q.state !== 'landing' || !q.clearedMain) continue;
      if (q.rwPh === 'final' || (q.cleared && (q.apOut || WW.dist(q.x, q.z, ox, oz) < NEAR_OM))) return true;
    }
    const s = o.lslot;
    return !!(s && s.alive && s.state === 'rollout');
  }
  // a plane taxiing in (launch mode) may cross the taxiway to its column: no departure taxiing in its row or column,
  // nor along the taxiway within CROSS_R of the crossing
  function cross(p, b) {
    if (b.ops.mode !== 'launch') return true;
    const c = p.path[p.path.offRunway + 1], P = WW.world.planes;
    for (const q of P) {
      if (q.carrier !== b || !q.alive || q.removed || q.state !== 'takeoff' || q.rwPh !== 'taxi' || !q.path) continue;
      if (((q.path.lanes[1] === p.path.lanes[1] || q.path.lanes[0] === p.path.lanes[0]) && q.pi <= 3) || WW.dist(q.x, q.z, c.x, c.z) < CROSS_R) {
        if (!p.xWait) ST.crossWaits++;
        return false;
      }
    }
    return true;
  }
  // a plane taxiing in holds its column and row lane (land_ground.js colFree: no departure starts down them)
  function colBusy(p, b) {
    const P = WW.world.planes;
    for (const q of P) if (q !== p && q.carrier === b && q.alive && !q.removed && q.state === 'rollout' && q.rwPh === 'taxiIn' && q.path &&
      q.pi > q.path.offRunway && (q.path.lanes[1] === p.path.lanes[1] || q.path.lanes[0] === p.path.lanes[0])) return true;
    return false;
  }
  // home for an emergency: the point LEG ahead on the bearing toward the field (within +-1.2 rad of it) clearest of the
  // enemy fighters (FTR_R) and the ships' heavy-AA reach it knows of; the field itself once within DIRECT
  function route(p, b) {
    const d = WW.dist(p.x, p.z, b.x, b.z);
    if (d < DIRECT || !WW.intel) return b;
    const now = WW.time.now;
    if (p.rtP && now - p.rtT < ROUTE_T && now >= p.rtT) return p.rtP;
    p.rtT = now;
    const T = [];   // threats near the way home, copied (intel.js filter() hands back a shared array)
    for (const c of WW.intel.enemyShips(p.nation, { fresh: 60 })) {
      const u = c.unit; if (u && u.alive && !u.sinking && u.stats && u.stats.aa && WW.dist(c.x, c.z, p.x, p.z) < THREAT_R) T.push({ x: c.x, z: c.z, r: u.stats.aa.range * 2.2 });
    }
    for (const c of WW.intel.enemyPlanes(p.nation)) {
      const u = c.unit; if (u && u.alive && u.kind === 'fighter' && u.y > 3 && WW.dist(c.x, c.z, p.x, p.z) < THREAT_R) T.push({ x: c.x, z: c.z, r: FTR_R });
    }
    const a0 = Math.atan2(b.z - p.z, b.x - p.x), L = Math.min(LEG, d);
    let best = null, bs = -1e9;
    for (let k = -4; k <= 4; k++) {
      const ang = a0 + k * 0.3, x = p.x + Math.cos(ang) * L, z = p.z + Math.sin(ang) * L, mx = (p.x + x) / 2, mz = (p.z + z) / 2;
      let clr = 120; for (const t of T) clr = Math.min(clr, WW.dist(x, z, t.x, t.z) - t.r, WW.dist(mx, mz, t.x, t.z) - t.r);
      const sc = Math.min(clr, 60) - 25 * Math.abs(k) * 0.3;
      if (sc > bs) { bs = sc; best = { x, z, k }; }
    }
    if (best && best.k && !(p.rtP && p.rtP.k)) ST.reroutes++;
    return (p.rtP = best || b);
  }
  // a carrier plane looking for somewhere to land (air_flight.js orphan): its side's base, if it can take it
  function field(p) {
    const b = WW.islandBase && WW.islandBase.base;
    if (!b || !b.ai || !b.alive || b.neutralized || b.nation !== p.nation || p.carrier === b || p.kind === 'scout' || p.kind === 'flyingboat') return null;
    if (!WW.landGround.opsOpen(b) && !(b.runways[1] && !b.runways[1].closed)) return null;
    return { base: b, d: WW.dist(p.x, p.z, b.x, b.z), accept: q => {
      q.carrier = b; q.slot = null; q.variant = null; q.state = 'return'; q.deckPh = null; q.rwPh = null; q.cleared = false; q.apOut = false;
      q.diverted = (q.diverted || 0) + 1; ST.guests++;
      WW.emit('baseEvent', { kind: 'guest', base: b, nation: b.nation, x: q.x, z: q.z, plane: q });
    } };
  }
  if (WW.airFlight && WW.airFlight.addField) WW.airFlight.addField(field);
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });

  WW.landFlow = { mayday, lowFuel, need, update, clear, inbound, cross, colBusy, route, stats: ST };
})();
