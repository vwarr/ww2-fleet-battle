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
  const SEE_SHIP = 170, SEE_PLANE = { USN: 210, IJN: 160 }; // Midway's radar reached the raids; IJN lookouts less
  const HP = { hangar: 380, fuel: 200, tower: 170, barracks: 120, aa: 150, battery: 230 };
  const R = { hangar: 6, fuel: 3.5, tower: 3, barracks: 4, aa: 3, battery: 3.5 };
  const NAMES = { USN: { atoll: 'Midway', volcanic: 'Henderson Field' }, IJN: { atoll: 'Wake', volcanic: 'Rabaul' } };
  // Base strength knobs (the balance pass; tests: sim_behaviour.js --tune k=v,...). tons: x BASE_TONS in the tiebreak;
  // guns: coastal battery rate of fire (0: silent); pits: x 3 AA pits; air: x the ROSTER (land_air.js); radar: x the
  // radar / lookout ranges; defend: the defence weight (base_ai.js assign); target: x the attacker's bombardment weight
  // and strike value (base_ai.js); chart: the enemy knows the base (0: never a contact); power: x its known strength.
  // Defaults from the first base-strength pass (40-round runs per owner; see AI_DESIGN.md section 10).
  const TUNE = { tons: 1, guns: 0.5, pits: 1, air: 0.6, radar: 0.8, defend: 1.2, target: 0.4, chart: 1, power: 1 };
  let base = null, stats = null;

  function newStats() {
    return { owner: null, neutralizedAt: null, raids: 0, craters: 0, closures: 0, batteriesOut: 0, pitsOut: 0, hangarsOut: 0,
      landStrikes: 0, landSorties: 0, landDrops: 0, landHits: 0, bombardRuns: 0, bombardShells: 0, impacts: 0, coastalShots: 0 };
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
      for (let r = 10; r < 90; r += 2) { const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r; if (!onLand(x, z)) break; last = { x, z }; }
      if (!last) continue;
      const bx = last.x - Math.cos(a) * 4, bz = last.z - Math.sin(a) * 4;
      if (!onLand(bx, bz) || WW.terrain.padDist(bx, bz) < 4) continue;
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
    // apron side (+v): hangars, tower, fuel farm, barracks; AA pits round the field; batteries on the shore
    fac('hangar', place(S, -24, 25, true)); fac('hangar', place(S, -6, 25, true));
    fac('tower', place(S, 12, 19, true));
    fac('fuel', place(S, 27, 29)); fac('fuel', place(S, 35, 25));
    fac('barracks', place(S, -34, 34)); fac('barracks', place(S, -20, 39)); fac('barracks', place(S, 20, 38));
    [[-44, -12], [42, -12], [-44, 30], [44, 34], [-2, -16]].slice(0, Math.round(3 * TUNE.pits)).forEach(p => {
      const q = place(S, p[0], p[1]);
      const f = fac('aa', q);
      if (f) f.unit = { isBasePit: true, id: ID + 10 + base.facilities.length, type: 'base', nation: owner, alive: true, sinking: false, submerged: false,
        x: f.x, z: f.z, heading: S.h, speed: 0, stats: { aa: Object.assign({}, PIT_AA), length: 4, guns: [] }, fac: f };
    });
    shorePoints(S, TUNE.guns > 0 ? 2 : 0).forEach((p, i) => {
      const f = fac('battery', p, { a: p.a, reload: 2 + i * 1.7, aim: p.a });
      f.unit = { isBattery: true, id: ID + 30 + i, type: 'battery', nation: owner, alive: true, x: f.x, z: f.z, heading: p.a, speed: 0,
        stats: { guns: [BATTERY], length: 4, aa: null }, fac: f };
    });
    base.maxHp = base.facilities.reduce((s, f) => s + f.maxHp, 0); base.hp = base.maxHp; base.stats.hp = base.maxHp;
    refresh();
    WW.islandBase.base = base;
    if (WW.landAir) WW.landAir.setup(base);
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
      if (r.closed && !was) { stats.closures++; ev('runwayClosed', { runway: r.i, x, z }); } else ev('cratered', { runway: r.i, x, z });
    }
    for (const f of base.facilities) {
      if (f.out) continue;
      const d = Math.hypot(x - f.x, z - f.z), reach = f.r + blast;
      if (d >= reach) continue;
      f.hp -= dmg * (d < f.r ? 1 : 1 - (d - f.r) / blast * 0.8);
      if (f.hp <= 0) knockOut(f);
    }
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
        let rw = null; for (const r of base.runways) if (r.craters.length && (!rw || weight(r) > weight(rw))) rw = r;
        const c = rw.craters[0]; c.w -= REPAIR_W;
        if (c.w <= 0) { rw.craters.shift(); base.craters.splice(base.craters.indexOf(c), 1); }
        if (rw.closed && weight(rw) < CLOSE) { rw.closed = false; ev('runwayOpen', { runway: rw.i }); }
        refresh();
      }
    } else base.repairT = REPAIR_T;
    batteries(dt);
    // air raid: armed enemy bombers heading for the base
    if (now - base.raidT > 60) for (const p of WW.world.planes) {
      if (p.alive && p.nation !== base.nation && p.ordnance && p.target === base && WW.dist2(p.x, p.z, base.x, base.z) < 160 * 160) {
        base.raidT = now; stats.raids++; ev('airRaid', { by: p }); break;
      }
    }
    if (WW.landAir) WW.landAir.update(base, dt);
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

  WW.islandBase = { base: null, build, update, impact, scan, shooters, tons, refresh, runwayOpen: () => runwayOpen(),
    get stats() { return stats; }, TUNE, ID, BASE_TONS, BATTERY, PIT_AA, CLOSE, NAMES, weight };
  stats = newStats();
})();
