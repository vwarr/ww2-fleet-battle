// air_ops.js — WW.airOps: the fighter director and the air side's decisions. The air boss (plan: CAP, strikes,
// launches, reserves, recalls) lives in air_boss.js and is attached here as WW.airOps.plan. Strike targets
// (pickTarget) are only detected / last-known ones (WW.fleetCmd.strikeOrder, else intel).
// Fighter director (fighter, from aircraft.js Plane.fighter): CAP orbits over its carrier, shifted toward the raid
// bearing (USN radar sees raids at 250, IJN lookouts ~170: intel.js SEE_PLANE_NATION); it engages torpedo bombers on
// a run > dive bombers in the wheel > other armed bombers > fighters, only within LEASH of the carrier (2x for an
// armed bomber closing on the fleet). Escorts recall when their carrier is under air attack. Bombers jettison and
// go home when badly hurt, or when a fighter is on them and no escort is near (bomber). Search flights and scouts: air_search.js.
// Load after air_strikes.js. Sim code: WW.rand only.
window.WW = window.WW || {};
(function () {
  const CAP_R = 35, LEASH = CAP_R * 1.5, LEASH2 = CAP_R * 4.5; // CAP orbit radius, chase leash (sim_behaviour LEASH_K), armed raid closing
  const RAID_R = 120;          // armed enemy bomber this close to the carrier: under air attack
  const WARN_R = 260;          // raid picture radius for the fighter director (radar / lookouts decide what is in it)
  const RELIEF = 45;           // launch a relief when an on-station CAP fighter has less fuel than this (s)
  const VALUE = { carrier: 250, battleship: 180, cruiser: 80, destroyer: 20, submarine: 0, pt: -20 };
  const ST = { raids: 0, scrambles: 0, reliefs: 0, holds: 0, recalls: 0, jettisons: 0, leashDrops: 0 };

  const armed = u => u && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance && u.alive;
  const closing = (u, x, z, k) => Math.abs(WW.angleDiff(u.heading, Math.atan2(z - u.z, x - u.x))) < (k || 0.7);
  // an armed bomber heading at the fleet: closing on the carrier, or attacking (wheel, anvil, run) one of our ships
  const inbound = (u, c) => closing(u, c.x, c.z, 1.2) || (u.target && u.target.nation === c.nation && u.target.alive && WW.dist(u.x, u.z, u.target.x, u.target.z) < 130);
  const up = p => p.alive && (p.state === 'transit' || p.state === 'attack') && !p.deckPh;

  // ---------- the raid picture around a carrier (what its side has detected) ----------
  function picture(cv) {
    const A = cv._air || (cv._air = { t: -1, near: 0, armed: 0, raidX: 0, raidZ: 0, raidD: 1e9, attackT: -1e9, holdT: 0 });
    const now = WW.time.now;
    if (A.t === now) return A;
    A.t = now; A.near = 0; A.armed = 0; A.raidD = 1e9;
    if (!WW.intel) return A;
    for (const c of WW.intel.enemyPlanes(cv.nation)) {
      const u = c.unit; if (!u || !u.alive || u.kind === 'scout' || u.kind === 'flyingboat') continue;   // snoopers: CAP hunts them (capPick), no scramble
      const d = WW.dist(cv.x, cv.z, c.x, c.z); if (d > WARN_R) continue;
      A.near++;
      if (armed(u)) { A.armed++; if (d < RAID_R) A.attackT = now; }
      if (d < A.raidD) { A.raidD = d; A.raidX = c.x; A.raidZ = c.z; }
    }
    return A;
  }
  function underAttack(cv) { return WW.time.now - picture(cv).attackT < 6; }

  // ---------- strike targets ----------
  // A known target for a strike from `from` (carrier, plane or wave guide): the commander's order if any, else the
  // best intel contact by value, damage, freshness, distance and the AA around it. opts.near: only within that radius.
  function aaAround(nation, x, z, skip) {
    if (WW.threat && WW.threat.danger) return WW.threat.danger(nation, x, z, { air: true });
    let s = 0;
    for (const c of WW.intel.enemyShips(nation)) { const o = c.unit; if (o !== skip && o.stats.aa && WW.dist(c.x, c.z, x, z) < o.stats.aa.range * 1.5) s += o.stats.aa.dps; }
    return s;
  }
  function pickTarget(from, opts) {
    if (!WW.intel) return WW.shipAI && WW.shipAI.pickStrikeTarget ? WW.shipAI.pickStrikeTarget(from) : null;
    const nation = from.nation, now = WW.time.now, near = opts && opts.near;
    if (!near && from.stats && WW.fleetCmd && WW.fleetCmd.strikeOrder) {
      const o = WW.fleetCmd.strikeOrder(from);
      if (o && o.target && o.target.alive && !o.target.submerged) return o.target;
      if (WW.fleetCmd.side && WW.fleetCmd.side(nation)) return null;   // the commander has spoken: no order, no strike
    }
    const cs = WW.intel.enemyShips(nation, { fresh: near ? WW.intel.T.FRESH + 2 : 45 }), L = [];
    for (const c of cs) L.push(c);   // shared scratch array: copy before aaAround asks intel again
    let best = null, bs = -1e9;
    for (const c of L) {
      const o = c.unit;
      if (!o || !o.alive || o.submerged || o.sinking) continue;
      const d = WW.dist(from.x, from.z, c.x, c.z);
      if (near && d > near) continue;
      const crip = 1 - o.hp / o.maxHp;
      const s = (VALUE[WW.intel.typeOf ? WW.intel.typeOf(c) : o.type] || 0) + crip * (near ? 260 : 120) - (now - c.seenAt) * 2 - d * (near ? 1.5 : 1) - aaAround(nation, c.x, c.z, o) * 3;
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }

  // ---------- air boss ----------
  function capWanted(cv) { // ai_carrier.js capWanted when present (standing element, 4 under a raid)
    if (WW.shipAI && WW.shipAI.capWanted) return +WW.shipAI.capWanted(cv) || 0;
    return picture(cv).near ? 4 : cv.nation === 'IJN' ? 3 : 2;
  }
  function capState(cv) {
    let on = 0, low = 0, coming = 0;
    for (const p of WW.world.planes) {
      if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || p.target || p.search) continue;
      if (p.state === 'takeoff') coming++;
      else if (up(p)) { if (p.fuel > RELIEF) on++; else low++; }
    }
    return { on, low, coming };
  }
  // ---------- fighter director: CAP pick, leash, orbit ----------
  // CAP priority: a torpedo bomber on its run (or heading at a ship of ours) > a dive bomber in the wheel / dive >
  // other armed bombers > fighters > the rest; nearer is better. Only targets inside the leash of the carrier.
  function capPick(pl) {
    const c = pl.carrier;
    if (!WW.intel) return null;
    let best = null, bs = -1e9;
    for (const ct of WW.intel.enemyPlanes(pl.nation)) {
      const u = ct.unit;
      if (!u || !u.alive) continue;
      const dc = WW.dist(c.x, c.z, u.x, u.z), arm = armed(u);
      if (dc > (arm && inbound(u, c) || u.kind === 'flyingboat' ? LEASH2 : LEASH) || !leashed(pl, u)) continue;
      if (u.kind === 'flyingboat' && picture(c).armed) continue;   // bombers first: the snooper waits
      let pr;
      if (arm && u.kind === 'torpedo' && (u.phase === 'run' || u.sk === 'anvil' || (u.target && u.target.nation === pl.nation && u.state === 'attack'))) pr = 400;
      else if (arm && u.kind === 'dive' && (u.phase || u.state === 'attack')) pr = 320;
      else if (arm) pr = 220;
      else if (u.kind === 'flyingboat') pr = 200;   // a snooper shadowing the fleet: shoot it down before it reports
      else if (u.kind === 'fighter') pr = u.foe && u.foe.nation === pl.nation ? 140 : 100;
      else pr = u.hp < u.maxHp * 0.5 ? 160 : 40;   // a damaged bomber going home: finish it
      const s = pr - WW.dist(pl.x, pl.z, u.x, u.z) * 0.8 - dc * 0.4;
      if (s > bs) { bs = s; best = u; }
    }
    return best;
  }
  // Keep the foe? A CAP fighter beyond the leash lets go, unless the foe is an armed bomber still closing on the
  // fleet (to 2x), or an enemy fighter on its own tail (air_dogfight's defence).
  function leashed(pl, f) {
    const c = pl.carrier, d = WW.dist(pl.x, pl.z, c.x, c.z);
    if (d <= LEASH) return true;
    if (f.kind === 'fighter' && f.foe === pl) return true;
    if (f.kind === 'flyingboat') return d <= LEASH2;              // a shadower: the long leash, as for an inbound raid
    if (f.kind !== 'fighter' && f.hp < f.maxHp * 0.5 && d <= LEASH2 * 0.75) return true;   // finish a damaged bomber turning for home
    return d <= LEASH2 && armed(f) && inbound(f, c);
  }
  function fighter(pl, dt) {
    const c = pl.carrier;
    pl.scanT -= dt; pl.burstT -= dt;
    if (pl.foe && !pl.foe.alive) pl.foe = null;
    if (pl.recall && pl.target && WW.dist(pl.x, pl.z, c.x, c.z) < LEASH) { pl.target = null; pl.wave = null; pl.sk = null; pl.recall = false; }
    const esc = !!pl.target;
    if (pl.scanT <= 0) {
      pl.scanT = 0.4;
      const best = esc ? (WW.cag ? WW.cag.escortPick(pl) : near(pl, 90)) : capPick(pl);
      pl.foe = WW.dogfight ? WW.dogfight.pick(pl, best) : best;
    }
    if (pl.foe && !esc && !leashed(pl, pl.foe)) { pl.foe = null; ST.leashDrops++; }
    if (pl.foe && esc && pl.recall) pl.foe = pl.foe.foe === pl ? pl.foe : null;   // recalled: only self-defence on the way
    const f = pl.foe;
    if (f) { pl.state = 'attack'; WW.dogfight.fight(pl, f, dt); return; }
    pl.state = 'transit';
    if (pl.recall) { pl.fly(c.x, c.z, 34, dt, pl.pt.speed * 1.05); return; }
    if (esc) {
      const t = pl.validTarget();
      if (WW.cag && WW.cag.escort(pl, t, dt)) return;
      if (WW.strike && t && WW.strike.escort(pl, dt)) return;
      if (pl.t > 1) { pl.state = 'return'; return; }
    }
    // relieved: low on fuel and a fresh fighter is on station
    if (pl.fuel < 20 || (pl.fuel < RELIEF * 0.6 && capState(c).on >= 2)) { pl.state = 'return'; return; }
    if (WW.squadrons && WW.squadrons.follow(pl, dt)) return;      // wingman: hold the slot on the element leader
    const A = picture(c);
    let cx = c.x, cz = c.z;
    if (A.near) { const b = Math.atan2(A.raidZ - c.z, A.raidX - c.x); cx += Math.cos(b) * 15; cz += Math.sin(b) * 15; } // vectored toward the raid
    const a = Math.atan2(pl.z - cz, pl.x - cx) + 0.5;
    pl.fly(cx + Math.cos(a) * CAP_R, cz + Math.sin(a) * CAP_R, A.near ? 38 : 28, dt, pl.pt.speed * (A.near ? 1 : 0.85));
  }
  function near(pl, R) {
    let best = null, bd = R;
    if (!WW.intel) return null;
    for (const c of WW.intel.enemyPlanes(pl.nation)) { const u = c.unit; if (!u.alive) continue; const d = WW.dist(pl.x, pl.z, u.x, u.z); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  // ---------- bombers: jettison and go home ----------
  // Every step for an armed dive / torpedo bomber in transit or attack (aircraft.js update). Deterministic: < 35% hp,
  // or a fighter on its tail for 3 s while below 55% hp with no friendly fighter within 45.
  function bomber(pl, dt) {
    if (!pl.ordnance || pl.phase || (pl.state !== 'transit' && pl.state !== 'attack')) return;
    const s = pl.df, hpf = pl.hp / pl.maxHp;
    pl.chasedT = s && s.from && s.from.alive ? (pl.chasedT || 0) + dt : 0;
    let go = hpf < 0.35;
    if (!go && pl.chasedT > 3 && hpf < 0.55) {
      go = true;
      for (const q of WW.world.planes) if (q.alive && q.kind === 'fighter' && q.nation === pl.nation && WW.dist(q.x, q.z, pl.x, pl.z) < 45) { go = false; break; }
    }
    if (!go) return;
    pl.dropped(); if (WW.fx) WW.fx.splash(pl.x, pl.z, 0.8);
    pl.state = 'return'; pl.foe = null; pl.sk = null; ST.jettisons++;
    if (WW.emit) WW.emit('airOrder', { carrier: pl.carrier, order: 'jettison', plane: pl, squadron: pl.squadron || null });
  }

  // scouts: search sectors, shadowing and the way home live in air_search.js (WW.search)

  function reset() { for (const k in ST) ST[k] = 0; }
  WW.on('roundStart', reset);
  WW.airOps = { CAP_R, LEASH, LEASH2, RAID_R, RELIEF, stats: ST, fighter, bomber, pickTarget, capWanted, capState, picture, underAttack, armed }; // + plan, reserve, pursuit, beaten (air_boss.js)
})();
