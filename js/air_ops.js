// air_ops.js — WW.airOps: the carrier's air boss and fighter director, and the air side's decisions.
// Air boss (plan, per carrier, from ai_carrier.js airOps): a standing CAP of 2-4 fighters relieved on fuel, CAP
// scrambles first, no strike while the carrier is under air attack (with a timeout), no strike launch while the deck
// is recovering or foul, strikes only on a detected / last-known target (WW.fleetCmd.strikeOrder, else intel).
// Fighter director (fighter, from aircraft.js Plane.fighter): CAP orbits over its carrier, shifted toward the raid
// bearing (USN radar sees raids at 250, IJN lookouts ~170: intel.js SEE_PLANE_NATION); it engages torpedo bombers on
// a run > dive bombers in the wheel > other armed bombers > fighters, only within LEASH of the carrier (2x for an
// armed bomber closing on the fleet). Escorts recall when their carrier is under air attack. Bombers jettison and
// go home when badly hurt, or when a fighter is on them and no escort is near (bomber). Search flights and scouts: air_search.js.
// Load after air_strikes.js. Sim code: WW.rand only.
window.WW = window.WW || {};
(function () {
  const CAP_R = 35, LEASH = CAP_R * 1.5, LEASH2 = CAP_R * 4.5; // CAP orbit radius, chase leash (sim_behaviour LEASH_K), armed raid closing
  const SNOOP_R = 220;         // CAP hunts a shadowing flying boat this far from its carrier while no armed raid is up
  const RAID_R = 120;          // armed enemy bomber this close to the carrier: under air attack
  const WARN_R = 260;          // raid picture radius for the fighter director (radar / lookouts decide what is in it)
  const RELIEF = 45;           // launch a relief when an on-station CAP fighter has less fuel than this (s)
  const HOLD_MAX = 30;         // a strike waits at most this long for a raid to clear
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

  // ---------- the reserve strike (Nagumo's dilemma) ----------
  // While no enemy carrier is known, a strike on anything else leaves doctrine reserveFrac of the bombers in the
  // hangar, armed for ships, for when the enemy carriers turn up: a carrier sighting launches the reserve at once.
  // Held RSV_MAX s with no carrier found, the reserve is rearmed for the targets at hand (REARM s, the deck loaded
  // with them: they sit in cv.rearm, the deck load ship_fires.js reads; cv.deckRearmUntil) and goes with the next strike.
  const RSV_MAX = 110, REARM = 20;
  const RS = { held: 0, launches: 0, rearmed: 0, targets: {} };
  const cvKnown = n => WW.intel && WW.intel.enemyShips(n, { fresh: 90 }).some(c => c.unit && c.unit.alive && c.unit.type === 'carrier');
  function reserveHold(cv, tgt) {   // bombers to hold back from this strike: { dive, torpedo }
    const a = cv.ai, d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(cv.nation) : null, now = WW.time.now;
    const frac = d ? d.reserveFrac || 0 : 0, none = { dive: 0, torpedo: 0 };
    if (a.rsv && (tgt.type === 'carrier' || cvKnown(cv.nation))) { RS.launches++; RS.targets[tgt.type] = (RS.targets[tgt.type] || 0) + 1; a.rsv = null; a.rsvGo = true; return none; }
    if (!frac || tgt.type === 'carrier' || cvKnown(cv.nation)) return none;
    const r = a.rsv || (a.rsv = { t0: now, rearmT: 0 });
    if (!a.rsvHeld) { a.rsvHeld = true; RS.held++; }
    if (now - r.t0 > RSV_MAX) {
      if (!r.rearmT) { // the swap is done on deck: the planes join the rearm cycle (ship_fires.js deck load: a bomb now is costly)
        r.rearmT = now + REARM; cv.deckRearmUntil = r.rearmT;
        const k = { dive: Math.round(cv.hangar.dive * frac), torpedo: Math.round(cv.hangar.torpedo * frac) };
        for (const kind in k) for (let i = 0; i < k[kind]; i++) { cv.hangar[kind]--; (cv.rearm = cv.rearm || []).push({ kind, at: r.rearmT }); }
      }
      if (now < r.rearmT) return none;  // the reserve is on deck being rearmed (out of the hangar)
      if (now >= r.rearmT) { RS.rearmed++; RS.targets[tgt.type] = (RS.targets[tgt.type] || 0) + 1; a.rsv = null; a.rsvGo = true; return none; }
    }
    return { dive: Math.round(cv.hangar.dive * frac), torpedo: Math.round(cv.hangar.torpedo * frac) };
  }
  function reserveTick(cv) {        // a carrier sighted while the reserve is held: strike now
    const a = cv.ai; if (!a.rsv || a.strikeT <= 1 || a.queue.some(q => q.target)) return;
    const so = WW.fleetCmd && WW.fleetCmd.strikeOrder ? WW.fleetCmd.strikeOrder(cv) : null;
    if ((so && so.target && so.target.type === 'carrier') || (a.rsv.rearmT && WW.time.now >= a.rsv.rearmT)) a.strikeT = 1;
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
  function plan(cv, dt) {
    const a = cv.ai, hg = cv.hangar, now = WW.time.now, A = picture(cv), D = cv._deck;
    const attacked = underAttack(cv);
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 1;
      const want = Math.min(4, capWanted(cv));
      const s = capState(cv), queued = a.queue.filter(q => q.kind === 'fighter' && !q.target && !q.search).length;
      let need = want - s.on - s.coming - queued;
      if (need > 0 && hg.fighter > 0) {
        need = Math.min(need, hg.fighter);
        for (let i = 0; i < need; i++) a.queue.unshift({ kind: 'fighter', target: null, cap: true });
        if (s.low) ST.reliefs++; else if (A.near) ST.scrambles++;
        if (WW.emit) WW.emit('airOrder', { carrier: cv, order: s.low && !A.near ? 'relief' : A.near ? 'scramble' : 'cap', n: need, raid: A.near ? { x: A.raidX, z: A.raidZ, d: A.raidD } : null });
      }
      if (attacked) recall(cv);
    }
    if (WW.search) WW.search.plan(cv, dt); // search flights while nothing is known (air_search.js)
    // strikes: only on a known target, and not while the carrier is under air attack (fighters first)
    reserveTick(cv);
    a.strikeT -= dt;
    a.lholdT = attacked ? (a.lholdT || 0) + dt : 0;
    if (a.strikeT <= 0 && !a.queue.some(q => q.target) && attacked && (a.holdT || 0) < HOLD_MAX) {
      if (!a.holdT) ST.holds++;
      a.holdT = (a.holdT || 0) + dt;
    } else if (a.strikeT <= 0 && !a.queue.some(q => q.target) && !(WW.endgame && WW.endgame.broken(cv.nation))) { // broken: no new strikes, it is running
      const pur = WW.fleetCmd && WW.fleetCmd.side(cv.nation) && WW.fleetCmd.side(cv.nation).posture === 'pursue';
      a.strikeT = WW.randRange(35, 55) * (pur ? 0.55 : 1); a.holdT = 0; // pursuit: every spare plane, sooner
      const tgt = pickTarget(cv);
      const hold = tgt && hg.dive + hg.torpedo > 0 ? reserveHold(cv, tgt) : null;
      const nd = hold ? hg.dive - hold.dive : 0, nt = hold ? hg.torpedo - hold.torpedo : 0;
      if (tgt && nd + nt > 0) {
        const cs = capState(cv), reserve = Math.max(0, capWanted(cv) - cs.on - cs.coming) + 1; // keep a relief back
        const esc = Math.min(Math.max(0, hg.fighter - reserve), 4);
        for (let i = 0; i < esc; i++) a.queue.push({ kind: 'fighter', target: tgt });
        const n = Math.max(nd, nt);
        for (let i = 0; i < n; i++) {
          if (i < nd) a.queue.push({ kind: 'dive', target: tgt });
          if (i < nt) a.queue.push({ kind: 'torpedo', target: tgt });
        }
        if (WW.strike) WW.strike.newWave(cv, tgt, a.queue, { reserve: !!a.rsvGo });
        a.rsvGo = false;
      }
    }
    // launches: CAP any time; strike planes not while recovering, the deck is foul, or the carrier is under attack
    a.launchT -= dt;
    if (!a.queue.length || a.launchT > 0) return;
    const q = a.queue[0];
    if (q.target) {
      const busy = D && ((D.mode === 'recover' && D.lq.length > 0) || D.launchers.filter(p => p.deckPh === 'queued').length >= 3);
      if ((attacked && a.lholdT < HOLD_MAX) || (busy && now - (a.busyT0 === undefined ? (a.busyT0 = now) : a.busyT0) < 25)) return;
    }
    a.queue.shift();
    if (!a.queue.some(e => e.target)) a.busyT0 = undefined;
    let tgt = q.target;
    if (tgt && (!tgt.alive || tgt.submerged)) tgt = pickTarget(cv);
    if (q.target && !tgt) return;
    const p = WW.air.launch(cv, q.kind, tgt);
    if (p) { a.launchT = 1.5; if (q.search && WW.search) WW.search.begin(p); }
  }
  // Own carrier under air attack: escorts in range with the fuel to get back recall to defend it.
  function recall(cv) {
    for (const p of WW.world.planes) {
      if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || !p.target || p.recall || !up(p)) continue;
      const d = WW.dist(p.x, p.z, cv.x, cv.z);
      if (d < 320 && p.fuel > d / p.pt.speed + 25) { p.recall = true; ST.recalls++; if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'recall', plane: p, squadron: p.squadron || null }); }
    }
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
      if (dc > (u.kind === 'flyingboat' ? SNOOP_R : arm && inbound(u, c) ? LEASH2 : LEASH) || !leashed(pl, u)) continue;
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
    if (f.kind === 'flyingboat') return d <= SNOOP_R;             // hunt a shadower out to the snooper leash
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

  function reset() { for (const k in ST) ST[k] = 0; RS.held = RS.launches = RS.rearmed = 0; RS.targets = {}; }
  WW.on('roundStart', reset);
  WW.airOps = { CAP_R, LEASH, LEASH2, RAID_R, stats: ST, plan, fighter, bomber, pickTarget, capWanted, picture, underAttack, armed, reserve: RS };
})();
