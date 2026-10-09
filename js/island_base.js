// island_base.js - WW.islandBase: the island air base, like Midway (sim code: WW.rand only, no visuals).
// One base per map, on the airfield site of the terrain (terrain_islands.js), owned by one side or by nobody:
// WW.game.baseChoice (setup mode, the ready screen's Base button) or a WW.rand roll at roundStart (auto rounds).
// The base is NOT a ship (never in WW.world.ships): it is one duck-typed object with what the planes, the AI and
// combat read (alive, nation, id, x, z, heading, speed 0, stats { guns, aa, length, tons }, hp, hangar), plus its
// facilities: runways (craters), hangars, fuel tanks, a control tower, barracks, AA pits and coastal batteries.
//  - The enemy side always knows it (an island is on the chart: intel.js scan hook); it is also its owner's radar
//    and lookout station (sees ships and planes). As a contact with stats.guns / stats.aa it stamps the coastal guns
//    and the AA into the enemy's danger field (ai_threat.js) with no extra code: ships respect the batteries.
//  - Hits: a shell or bomb that lands on the island (combat.js hooks, or a hit on the base as a "hull") goes to
//    impact(): bombs and heavy shells crater a runway (closed at CLOSE craters' weight, repair crews fill them),
//    blasts damage facilities in reach (hangars and the fuel farm burn; pits and batteries are knocked out).
//  - Coastal batteries fire at visible enemy ships in range (a gun ship that cannot move); AA pits are shooters for
//    combat_aa.js (shooters()).
//  - Neutralized (sticky) when every runway is closed, every battery is silenced and at least half the AA pits are
//    out. A base is never sunk. An intact base adds BASE_TONS to its owner's tonnage tiebreak (main.js tonnage).
// Events: 'baseEvent' { kind, base, nation (owner), x, z, by } - see docs/ARCHITECTURE.md (island bases).
// Base planes and the runway: land_air.js. Visuals: base_fx.js / models_base.js. AI hooks: base_ai.js.
window.WW = window.WW || {};
(function () {
  'use strict';
  const ID = 9001;                                   // never collides with ships.js ids (intel LOS cache, orders)
  const BASE_TONS = 26000;                           // an intact base in the time-limit tonnage tiebreak
  const CLOSE = 1.5, REPAIR_T = 13, REPAIR_W = 0.5;  // crater weight that closes a runway; a crew fills REPAIR_W every REPAIR_T s
  const CRATER = { bomb: 1, big: 0.8, med: 0.35 };   // crater weight per hit (small shells only chip the surface)
  const CRATER_MAX = 3.5;                            // a runway holds at most this much crater weight (the repair backlog)
  const BLAST = { bomb: 7, big: 5, med: 3, small: 1.5, mg: 0 };
  const BATTERY = { cal: 'med', count: 2, range: 140, reload: 10 };      // a coastal battery (7-inch / 5-inch guns)
  const PIT_AA = { range: 42, dps: 4.5 };            // one AA pit (3-inch + .50s): heavy share in combat_aa HEAVY_SHARE.base
  const ALARM_DT = 0.5;                              // the alarm check's interval (s)
  const SEE_SHIP = 170, SEE_PLANE = { USN: 210, IJN: 160 }; // Midway's radar reached the raids; IJN lookouts less
  const HP = { hangar: 380, fuel: 200, tower: 170, barracks: 120, aa: 150, battery: 230, ammo: 160 };
  const R = { hangar: 6, fuel: 3.5, tower: 3, barracks: 4, aa: 3, battery: 3.5, ammo: 3.5 };
  // facility places (site-local u, v; the ring search in airfield_layout.js free() moves them onto free ground): the
  // buildings stand beyond the runway ends and at the field's edges, clear of the runways, taxiways and dispersal rows
  const PLACES = { hangar: [[63, 9], [63, -9]], tower: [[-58, 11]], fuel: [[-61, -6], [-66, 5]], ammo: [[66, 24], [66, -24]],
    barracks: [[-64, -22], [64, 38], [-62, 34]], aa: [[68, -32], [-66, -38], [2, 66], [44, -62], [-44, 64]] };
  const NAMES = { USN: { atoll: 'Midway', volcanic: 'Henderson Field' }, IJN: { atoll: 'Wake', volcanic: 'Rabaul' } };
  // Base strength knobs (the balance pass; tests: sim_behaviour.js --tune k=v,...). tons: x BASE_TONS in the tiebreak;
  // guns: coastal battery rate of fire (0: silent); pits: x 3 AA pits; air: x the ROSTER (land_air.js); radar: x the
  // radar / lookout ranges; defend: the defence weight (base_ai.js assign); target: x the attacker's bombardment weight
  // and strike value (base_ai.js); chart: the enemy knows the base (0: never a contact); power: x its known strength.
  // Defaults from the first base-strength pass (40-round runs per owner; see AI_DESIGN.md section 10), then cut back
  // coarsely in the final pass (Oct 2026: an owned base decided battles; one air element per kind, batteries at a
  // quarter rate, 2 AA pits, 0.4 x radar, defence weight 1, half the tonnage bonus, 0.6 x its known power).
  // group: the base air group in carrier air groups (planes = carrier group x group x air / 0.6, at least one per type:
  // land_ground.js plan(); planes beyond the parking spots wait in the hangars and are towed out as spots free up)
  const TUNE = { tons: 0.5, guns: 0.25, pits: 0.67, air: 0.4, radar: 0.4, defend: 1, target: 0.4, chart: 1, power: 0.6, group: 1 };
  let base = null, stats = null;

  function newStats() {
    return { alarmAt: null, alarmKind: null, owner: null, neutralizedAt: null, raids: 0, craters: 0, closures: 0, batteriesOut: 0, pitsOut: 0, hangarsOut: 0,
      reopened: 0, landStrikes: 0, landSorties: 0, landDrops: 0, landHits: 0, bombardRuns: 0, bombardShells: 0, impacts: 0, coastalShots: 0 };
  }
  // ---- layout: site-local (u along the main runway, v to its apron side) -> world ----
  function onLand(x, z) { return WW.terrain.depthAt(x, z) < -0.6; }
  function place(S, u, v, pad) { // a land point at (u, v), pulled toward the site centre until it is on land
    const c = Math.cos(S.h), s = Math.sin(S.h);
    for (let k = 1; k >= 0.3; k -= 0.1) {
      const x = S.x + (c * u - s * v) * k, z = S.z + (s * u + c * v) * k;
      if (onLand(x, z) && WW.terrain.depthAt(x, z) > -3.2 && (pad || WW.terrain.padDist(x, z) > 2.5)) return { x, z }; // low, flat ground
    }
    return null;
  }
  // coastal batteries: shore points seaward of the site (away from the atoll centre / the volcano)
  function shorePoints(S, n) {
    const ox = S.atoll ? S.atoll.x : S.island ? S.island.x : S.x - 1, oz = S.atoll ? S.atoll.z : S.island ? S.island.z : S.z;
    const out = Math.atan2(S.z - oz, S.x - ox), cand = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      let last = null;
      for (let r = 10; r < 110; r += 2) { const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r; if (!onLand(x, z)) break; last = { x, z }; }
      if (!last) continue;
      const bx = last.x - Math.cos(a) * 4, bz = last.z - Math.sin(a) * 4;
      const lq = base && base.layout ? base.layout.toL(bx, bz) : null;
      if (!onLand(bx, bz) || (lq && (WW.airfieldLayout.onNetwork(base.layout, lq.u, lq.v, 4) || WW.airfieldLayout.climbOut(base.layout, lq.u, lq.v, 4) || base.layout.facs.some(f => Math.hypot(f.u - lq.u, f.v - lq.v) < f.r + 6) ||
        base.layout.spots.some(p => Math.hypot(p.u - lq.u, p.v - lq.v) < Math.max(p.len, p.span) / 2 + 6)))) continue;   // clear of the revetments
      cand.push({ x: bx, z: bz, a, sc: Math.cos(WW.angleDiff(a, out)) });
    }
    cand.sort((p, q) => q.sc - p.sc);
    const pick = [];
    for (const c of cand) { if (pick.every(p => Math.abs(WW.angleDiff(p.a, c.a)) > 1.1)) pick.push(c); if (pick.length >= n) break; }
    return pick;
  }
  function fac(kind, p, extra) {
    if (!p) return null;
    const f = Object.assign({ kind, x: p.x, z: p.z, r: R[kind], hp: HP[kind], maxHp: HP[kind], out: false, outAt: 0 }, extra || {});
    base.facilities.push(f);
    return f;
  }

  function build(owner) {
    stats = newStats(); stats.owner = owner || null;
    base = null;
    const S = WW.terrain && WW.terrain.site;
    if (!S || !owner || owner === 'none') { WW.islandBase.base = null; WW.emit('baseBuilt', { base: null }); return null; } // visuals clear the old airfield
    base = { isBase: true, id: ID, type: 'base', nation: owner, alive: true, sinking: false, removed: false, submerged: false,
      x: S.x, z: S.z, heading: S.h, speed: 0, kind: S.kind, name: NAMES[owner][S.kind] || 'the island', site: S,
      stats: { name: 'Airfield', type: 'base', hp: 0, speed: 0, turn: 0, length: 40, minDepth: 0, tons: BASE_TONS,
        guns: [Object.assign({}, BATTERY)], aa: { range: PIT_AA.range, dps: 0 }, planes: null, torpedoes: null, depthCharges: false },
      hp: 0, maxHp: 0, power: 3, model: { deck: null }, hangar: { fighter: 0, dive: 0, torpedo: 0 }, rearm: [],
      facilities: [], runways: S.runways.map((r, i) => ({ i, x: r.x, z: r.z, h: r.h, len: r.len, w: r.w, c: Math.cos(r.h), s: Math.sin(r.h), craters: [], closed: false })),
      craters: [], repairT: REPAIR_T, neutralized: false, raidT: -1e9,
      takeDamage(amount, x, z, kind, cal) { impact(WW.enemyOf(this.nation), x, z, amount, kind, cal); },
      toWorld(lx, lz) { const c = Math.cos(this.heading), s = Math.sin(this.heading); return [this.x + c * lx - s * lz, this.z + s * lx + c * lz]; } };
    // the ground plan (airfield_layout.js): runways, taxiways and columns first; then the facilities on free ground,
    // the air group's plan, the dispersal rows sized for it, and the slots
    const AL = WW.airfieldLayout, L = base.layout = AL.make(S);
    AL.columns(L);
    const pl = WW.landGround.plan(base);
    AL.rows(L, pl.demand);                                  // the dispersal rows first, then the buildings on free ground
    const put = (kind, list, n) => { let k = 0; for (const q of list) { if (k >= n) break; const pt = AL.free(L, q[0], q[1], R[kind] + 1, true); if (!pt) continue; AL.addFac(L, pt.u, pt.v, R[kind] + 1); const w = L.toW(pt.u, pt.v); const f = fac(kind, w); f.u = pt.u; f.v = pt.v; f.a = Math.atan2(-w.z + S.z, -w.x + S.x); k++; } };
    put('hangar', PLACES.hangar, 2); put('tower', PLACES.tower, 1); put('fuel', PLACES.fuel, 2); put('ammo', PLACES.ammo, 1);
    put('barracks', PLACES.barracks, 3); put('aa', PLACES.aa, Math.round(3 * TUNE.pits));
    base.facilities.filter(f => f.kind === 'aa').forEach(f => {
      f.unit = { isBasePit: true, id: ID + 10 + base.facilities.indexOf(f), type: 'base', nation: owner, alive: true, sinking: false, submerged: false,
        x: f.x, z: f.z, heading: S.h, speed: 0, stats: { aa: Object.assign({}, PIT_AA), length: 4, guns: [] }, fac: f,
        sup: { main: 0, aa: 1e9, aa0: 1e9, torp: 0, fuel: 0, main0: 0, fuel0: 0, flags: {} } };   // the island's own magazines
        // (ship_supply.js has no allowance for a 'base' type: without this the pits counted as out of ammunition and never fired)
    });
    shorePoints(S, TUNE.guns > 0 ? 2 : 0).forEach((p, i) => {
      const q = L.toL(p.x, p.z); AL.addFac(L, q.u, q.v, R.battery + 1);
      const f = fac('battery', p, { a: p.a, reload: 2 + i * 1.7, aim: p.a });
      f.unit = { isBattery: true, id: ID + 30 + i, type: 'battery', nation: owner, alive: true, x: f.x, z: f.z, heading: p.a, speed: 0,
        stats: { guns: [BATTERY], length: 4, aa: null }, fac: f };
    });
    if (WW.baseLifeLayout) WW.baseLifeLayout.place(base);   // the camp (huts, mess, trenches, ...) last: nothing above moves
    WW.landGround.setup(base, pl);
    base.maxHp = base.facilities.reduce((s, f) => s + f.maxHp, 0); base.hp = base.maxHp; base.stats.hp = base.maxHp;
    refresh();
    WW.islandBase.base = base;
    if (WW.landAir) WW.landAir.setup(base, pl.counts);
    WW.emit('baseBuilt', { base });
    return base;
  }
  // gun / AA strength as the enemy's danger field and the AI see it
  function refresh() {
    if (!base) return;
    let bat = 0, aa = 0, hp = 0;
    for (const f of base.facilities) {
      if (!f.out) { if (f.kind === 'battery') bat++; if (f.kind === 'aa') aa += PIT_AA.dps; }
      hp += Math.max(0, f.hp);
    }
    base.stats.guns = bat && TUNE.guns > 0 ? [Object.assign({}, BATTERY, { count: BATTERY.count * bat, reload: BATTERY.reload / TUNE.guns })] : [];
    base.stats.aa.dps = aa;
    base.hp = Math.max(1, hp);
    base.power = (base.neutralized ? 0.3 : 1 + bat * 0.6 + (runwayOpen() ? 1.2 : 0)) * TUNE.power;
  }
  function runwayOpen() { return !!base && base.runways.some(r => !r.closed); }
  const ev = (kind, o) => WW.emit('baseEvent', Object.assign({ kind, base, nation: base.nation, x: base.x, z: base.z }, o || {}));

  // ---- hits: crater the runways, damage the facilities in reach ----
  function onRunway(r, x, z, pad) {
    const dx = x - r.x, dz = z - r.z, u = dx * r.c + dz * r.s, v = -dx * r.s + dz * r.c;
    return Math.abs(u) < r.len / 2 + pad && Math.abs(v) < r.w / 2 + pad;
  }
  function impact(nation, x, z, dmg, kind, cal) {
    if (!base || nation === base.nation || !(dmg > 0)) return false;
    if (WW.dist2(x, z, base.x, base.z) > 110 * 110 || WW.terrain.depthAt(x, z) > 0.3) return false; // in the water: a splash
    stats.impacts++;
    const key = kind === 'bomb' ? 'bomb' : cal || 'small', blast = BLAST[key] || 2, cw = CRATER[key] || 0;
    if (cw) for (const r of base.runways) if (onRunway(r, x, z, 0.8) && weight(r) < CRATER_MAX) {
      const c = { x, z, w: cw, r: key === 'bomb' ? 2.2 : key === 'big' ? 1.8 : 1, rw: r.i, at: WW.time.now };
      r.craters.push(c); base.craters.push(c); stats.craters++;
      const was = r.closed; r.closed = weight(r) >= CLOSE;
      if (r.closed && !was) { stats.closures++; ev(r.i === 0 ? 'runwayClosed' : 'crossClosed', { runway: r.i, x, z }); } else ev('cratered', { runway: r.i, x, z });
    }
    for (const f of base.facilities) {
      if (f.out) continue;
      const d = Math.hypot(x - f.x, z - f.z), reach = f.r + blast;
      if (d >= reach) continue;
      f.hp -= dmg * (d < f.r ? 1 : 1 - (d - f.r) / blast * 0.8);
      if (f.hp <= 0) knockOut(f);
    }
    if (WW.baseLifeLayout) WW.baseLifeLayout.hit(base, x, z, dmg, blast);   // the camp's huts and tents (base.decor)
    base.hitT = WW.time.now; base.hitX = x; base.hitZ = z;                   // the ground life takes cover / runs to it
    if (!base.alarm) raiseAlarm(kind === 'bomb' ? 'bombed' : 'shelled', x, z);
    if (cw && WW.landGround) WW.landGround.groundHit(base, x, z, blast); // planes on the ground in the blast are wrecked
    refresh(); check();
    return true;
  }
  function weight(r) { let w = 0; for (const c of r.craters) w += c.w; return w; }
  function knockOut(f) {
    f.out = true; f.hp = 0; f.outAt = WW.time.now;
    if (f.unit) f.unit.alive = false;
    if (f.kind === 'battery') { stats.batteriesOut++; ev('battery', { x: f.x, z: f.z }); }
    else if (f.kind === 'aa') { stats.pitsOut++; ev('aa', { x: f.x, z: f.z }); }
    else if (f.kind === 'hangar') { stats.hangarsOut++; ev('hangar', { x: f.x, z: f.z }); if (WW.landAir) WW.landAir.hangarLost(base); }
    else ev(f.kind, { x: f.x, z: f.z });
  }
  function check() {
    if (!base || base.neutralized) return;
    const bats = base.facilities.filter(f => f.kind === 'battery'), pits = base.facilities.filter(f => f.kind === 'aa');
    if (runwayOpen() || bats.some(f => !f.out) || pits.filter(f => f.out).length * 2 < pits.length) return;
    base.neutralized = true; stats.neutralizedAt = WW.game ? WW.game.roundTime : WW.time.now;
    refresh();
    if (WW.baseAI) WW.baseAI.neutralized(base);
    ev('neutralized');
  }

  // ---- per step: repair crews, coastal batteries, raid warning ----
  function update(dt) {
    if (!base || !WW.game || WW.game.state !== 'battle') return;
    const now = WW.time.now;
    if (!base.neutralized && base.craters.length) { // the crews fill the oldest crater on the most damaged runway
      base.repairT -= dt;
      if (base.repairT <= 0) {
        base.repairT = REPAIR_T * (fuelOut() ? 1.3 : 1);
        let rw = base.runways[0].craters.length ? base.runways[0] : null;                 // the main runway first
        if (!rw) for (const r of base.runways) if (r.craters.length && (!rw || weight(r) > weight(rw))) rw = r;
        base.repairing = { runway: rw.i, crater: rw.craters[0], at: now };
        const c = rw.craters[0]; c.w -= REPAIR_W;
        if (c.w <= 0) { rw.craters.shift(); base.craters.splice(base.craters.indexOf(c), 1); }
        if (rw.closed && weight(rw) < CLOSE) { rw.closed = false; stats.reopened++; ev(rw.i === 0 ? 'runwayOpen' : 'crossOpen', { runway: rw.i }); }
        refresh();
      }
    } else base.repairT = REPAIR_T;
    batteries(dt);
    // the alarm: the first sighting of the enemy closing on the island (base_ai.js alarm(), every ALARM_DT s)
    if (!base.alarm && now >= (base.alarmT || 0)) {
      base.alarmT = now + ALARM_DT;
      const a = WW.baseAI && WW.baseAI.alarm(base);
      if (a) raiseAlarm(a.kind, a.x, a.z, a);
    }
    // air raid: armed enemy bombers heading for the base
    if (now - base.raidT > 60) for (const p of WW.world.planes) {
      if (p.alive && p.nation !== base.nation && p.ordnance && p.target === base && WW.dist2(p.x, p.z, base.x, base.z) < 160 * 160) {
        if (!base.alarm) raiseAlarm('raid', p.x, p.z, { unit: p, n: 1 });   // a raid nobody reported: the alarm goes late
        base.raidT = now; stats.raids++; ev('airRaid', { by: p }); break;
      }
    }
    if (WW.landAir) WW.landAir.update(base, dt);
  }
  // The alarm ("oh no" moment), once per round: base.alarm { t, kind, x, z (the threat), bearing (deg from the base) };
  // a 'baseEvent' kind 'alarm' (caption, war diary) and 'baseAlarm' { x, z (the base), t, kind, tx, tz, bearing, base }
  // for the cameras. kind: 'ship' (warships sighted), 'raid' / 'planes' (planes closing), 'shelled' / 'bombed' (hit
  // before anyone reported them)
  function raiseAlarm(kind, x, z, o) {
    if (!base || base.alarm) return;
    const brg = Math.round((Math.atan2(x - base.x, -(z - base.z)) * 180 / Math.PI + 360) % 360) % 360;
    base.alarm = { t: WW.time.now, kind, x, z, bearing: brg, n: (o && o.n) || 0, what: (o && o.what) || null };
    stats.alarmAt = WW.game ? WW.game.roundTime : WW.time.now; stats.alarmKind = kind;
    ev('alarm', { alarm: base.alarm, x: base.x, z: base.z });
    // the focus for the cameras: the camp (huts, tents, the mess), else the base's centre
    const C = (base.decor || []).filter(d => d.kind === 'hut' || d.kind === 'tent' || d.kind === 'mess');
    const fx = C.length ? C.reduce((s, d) => s + d.x, 0) / C.length : base.x, fz = C.length ? C.reduce((s, d) => s + d.z, 0) / C.length : base.z;
    WW.emit('baseAlarm', { x: base.x, z: base.z, t: WW.time.now, kind, tx: x, tz: z, bearing: brg, fx, fz, base });
  }
  function fuelOut() { return base.facilities.some(f => f.kind === 'fuel' && f.out); }
  function batteries(dt) {
    const I = WW.intel; if (!I) return;
    for (const f of base.facilities) {
      if (f.kind !== 'battery' || f.out) continue;
      f.reload -= dt;
      if (f.reload > 0) continue;
      let best = null, bs = -1;
      for (const c of I.enemyShips(base.nation, { fresh: true })) {
        const u = c.unit; if (!u || !u.alive || u.sinking || u.submerged || u.isBase) continue;
        const d = WW.dist(f.x, f.z, u.x, u.z); if (d > BATTERY.range) continue;
        const sc = (u.stats.tons || 1000) / (1 + d / 60);
        if (sc > bs) { bs = sc; best = u; }
      }
      if (!best) { f.reload = 1; continue; }
      f.aim = Math.atan2(best.z - f.z, best.x - f.x);
      for (let k = 0; k < BATTERY.count; k++) if (WW.combat.fireShell(f.unit, null, best, BATTERY.cal)) stats.coastalShots++;
      f.reload = BATTERY.reload / Math.max(0.05, TUNE.guns) * WW.randRange(0.9, 1.15);
    }
  }

  // ---- intel.js scan hook: the chart (enemy) and the base's radar and lookouts (owner) ----
  function scan(nation, sight) {
    if (!base) return;
    if (nation !== base.nation) { if (TUNE.chart) sight(base, base, 'visual'); return; }
    const tower = base.facilities.find(f => f.kind === 'tower'), k = tower && tower.out ? 0.7 : 1;
    const rs = SEE_SHIP * k * TUNE.radar, rp = (SEE_PLANE[base.nation] || 200) * k * TUNE.radar;
    for (const s of WW.world.ships) if (s.alive && !s.sinking && s.nation !== nation && !s.submerged && WW.dist2(s.x, s.z, base.x, base.z) < rs * rs) sight(s, base, 'visual');
    for (const p of WW.world.planes) if (p.alive && !p.removed && p.nation !== nation && WW.dist2(p.x, p.z, base.x, base.z) < rp * rp) sight(p, base, 'radar');
  }
  // combat_aa.js hook: the ships plus the base's live AA pits (a cached array)
  const shooterArr = [];
  function shooters(ships) {
    if (!base) return ships;
    shooterArr.length = 0;
    for (let i = 0; i < ships.length; i++) shooterArr.push(ships[i]);
    for (const f of base.facilities) if (f.unit && f.kind === 'aa' && !f.out) shooterArr.push(f.unit);
    return shooterArr;
  }
  function tons(nation) { return base && base.nation === nation && !base.neutralized ? BASE_TONS * TUNE.tons : 0; }

  WW.on('shellFired', e => {
    const p = e && e.proj;
    if (!base || !p || p.target !== base || !e.ship || e.ship.isBattery) return;
    stats.bombardShells++;
    const s = e.ship;
    if (!(WW.time.now - (s._bombT || -1e9) < 30)) { stats.bombardRuns++; ev('bombard', { by: s }); }
    s._bombT = WW.time.now;
  });
  function choice() { const g = WW.game; return g ? g.baseChoice : null; }
  // round start: the setup choice, else a WW.rand roll (USN 40%, IJN 40%, none 20%)
  WW.on('roundStart', () => {
    let o = choice();
    if (!o) { const r = WW.rand(); o = r < 0.4 ? 'USN' : r < 0.8 ? 'IJN' : 'none'; }
    build(o);
  });
  // setup: show the base the Start button will use (a preview roll on Math.random until the user picks one)
  WW.on('setupStart', () => {
    const g = WW.game;
    if (g && !g.baseChoice && (!g.basePreview || g.basePreviewSeed !== WW.terrain.seed)) { const r = Math.random(); g.basePreview = r < 0.4 ? 'USN' : r < 0.8 ? 'IJN' : 'none'; g.basePreviewSeed = WW.terrain.seed; }
    build(g ? g.baseChoice || g.basePreview : null);
  });

  // the top of the base's buildings under (x, z), above the pad (0: none): a low plane's floor (aircraft.js integrate)
  const ROOF = { hangar: 5, tower: 10, fuel: 2.6, ammo: 1.3, barracks: 3, aa: 0.8, battery: 0.9 };
  function roofAt(x, z) {
    if (!base || Math.abs(x - base.x) > 140 || Math.abs(z - base.z) > 140) return 0;
    let top = 0;
    for (const f of base.facilities) if (Math.abs(f.x - x) < f.r + 2 && Math.abs(f.z - z) < f.r + 2) top = Math.max(top, base.site.padH + (ROOF[f.kind] || 1));
    if (base.decor) for (const d of base.decor) if (d.roof && Math.abs(d.x - x) < d.r + 2 && Math.abs(d.z - z) < d.r + 2) top = Math.max(top, base.site.padH + d.roof);
    return top;
  }
  WW.islandBase = { base: null, build, update, impact, scan, shooters, tons, refresh, roofAt, runwayOpen: () => runwayOpen(),
    opsOpen: () => !!base && WW.landGround.opsOpen(base),   // main runway open, not fouled by a wreck, base not neutralized
    get stats() { return stats; }, TUNE, ID, BASE_TONS, BATTERY, PIT_AA, CLOSE, NAMES, weight };
  stats = newStats();
})();
