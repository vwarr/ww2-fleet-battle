// air_ops.js — WW.airOps: the carrier's air boss and fighter director, and the air side's decisions.
// Air boss (plan, per carrier, from ai_carrier.js airOps): a standing CAP of 2-4 fighters relieved on fuel, CAP
// scrambles first, no strike while the carrier is under air attack (with a timeout), no strike launch while the deck
// is recovering or foul, strikes only on a detected / last-known target (WW.fleetCmd.strikeOrder, else intel).
// Fighter director (fighter, from aircraft.js Plane.fighter): CAP orbits over its carrier, shifted toward the raid
// bearing (USN radar sees raids at 250, IJN lookouts ~170: intel.js SEE_PLANE_NATION); it engages torpedo bombers on
// a run > dive bombers in the wheel > other armed bombers > fighters, only within LEASH of the carrier (2x for an
// armed bomber closing on the fleet). Escorts recall when their carrier is under air attack. Bombers jettison and
// go home when badly hurt, or when a fighter is on them and no escort is near (bomber). Scouts fly the commander's
// search sectors and keep clear of known enemy carriers' CAP. Load after air_strikes.js. Sim code: WW.rand only.
window.WW = window.WW || {};
(function () {
  const CAP_R = 35, LEASH = CAP_R * 1.5, LEASH2 = CAP_R * 2;   // CAP orbit radius, chase leash (sim_behaviour LEASH_K)
  const RAID_R = 120;          // armed enemy bomber this close to the carrier: under air attack
  const WARN_R = 260;          // raid picture radius for the fighter director (radar / lookouts decide what is in it)
  const RELIEF = 45;           // launch a relief when an on-station CAP fighter has less fuel than this (s)
  const HOLD_MAX = 30;         // a strike waits at most this long for a raid to clear
  const VALUE = { carrier: 250, battleship: 180, cruiser: 80, destroyer: 20, submarine: 0, pt: -20 };
  const ST = { raids: 0, scrambles: 0, reliefs: 0, holds: 0, recalls: 0, jettisons: 0, leashDrops: 0 };

  const armed = u => u && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance && u.alive;
  const closing = (u, x, z, k) => Math.abs(WW.angleDiff(u.heading, Math.atan2(z - u.z, x - u.x))) < (k || 0.7);
  const up = p => p.alive && (p.state === 'transit' || p.state === 'attack') && !p.deckPh;

  // ---------- the raid picture around a carrier (what its side has detected) ----------
  function picture(cv) {
    const A = cv._air || (cv._air = { t: -1, near: 0, armed: 0, raidX: 0, raidZ: 0, raidD: 1e9, attackT: -1e9, holdT: 0 });
    const now = WW.time.now;
    if (A.t === now) return A;
    A.t = now; A.near = 0; A.armed = 0; A.raidD = 1e9;
    if (!WW.intel) return A;
    for (const c of WW.intel.enemyPlanes(cv.nation)) {
      const u = c.unit; if (!u || !u.alive || u.kind === 'scout') continue;
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
      const s = (VALUE[o.type] || 0) + crip * (near ? 260 : 120) - (now - c.seenAt) * 2 - d * (near ? 1.5 : 1) - aaAround(nation, c.x, c.z, o) * 3;
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }

  // ---------- air boss ----------
  function capWanted(cv) {
    const A = picture(cv), elem = cv.nation === 'IJN' ? 3 : 2;
    return A.near ? Math.max(elem, 4) : elem;   // a raid on the scope: a full division / shotai up
  }
  function capState(cv) {
    let on = 0, low = 0, coming = 0;
    for (const p of WW.world.planes) {
      if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || p.target) continue;
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
      const cw = WW.shipAI && WW.shipAI.capWanted, want = Math.min(4, cw ? cw(cv) : capWanted(cv));
      const s = capState(cv), queued = a.queue.filter(q => q.kind === 'fighter' && !q.target).length;
      let need = want - s.on - s.coming - queued;
      if (need > 0 && hg.fighter > 0) {
        need = Math.min(need, hg.fighter);
        for (let i = 0; i < need; i++) a.queue.unshift({ kind: 'fighter', target: null, cap: true });
        if (s.low) ST.reliefs++; else if (A.near) ST.scrambles++;
        if (WW.emit) WW.emit('airOrder', { carrier: cv, order: s.low && !A.near ? 'relief' : A.near ? 'scramble' : 'cap', n: need, raid: A.near ? { x: A.raidX, z: A.raidZ, d: A.raidD } : null });
      }
      if (attacked) recall(cv);
    }
    // strikes: only on a known target, and not while the carrier is under air attack (fighters first)
    a.strikeT -= dt;
    a.lholdT = attacked ? (a.lholdT || 0) + dt : 0;
    if (a.strikeT <= 0 && !a.queue.some(q => q.target) && attacked && (a.holdT || 0) < HOLD_MAX) {
      if (!a.holdT) ST.holds++;
      a.holdT = (a.holdT || 0) + dt;
    } else if (a.strikeT <= 0 && !a.queue.some(q => q.target)) {
      a.strikeT = WW.randRange(35, 55); a.holdT = 0;
      const tgt = pickTarget(cv);
      if (tgt && hg.dive + hg.torpedo > 0) {
        const cs = capState(cv), reserve = Math.max(0, capWanted(cv) - cs.on - cs.coming) + 1; // keep a relief back
        const esc = Math.min(Math.max(0, hg.fighter - reserve), 4);
        for (let i = 0; i < esc; i++) a.queue.push({ kind: 'fighter', target: tgt });
        const n = Math.max(hg.dive, hg.torpedo);
        for (let i = 0; i < n; i++) {
          if (i < hg.dive) a.queue.push({ kind: 'dive', target: tgt });
          if (i < hg.torpedo) a.queue.push({ kind: 'torpedo', target: tgt });
        }
        if (WW.strike) WW.strike.newWave(cv, tgt, a.queue);
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
    if (WW.air.launch(cv, q.kind, tgt)) a.launchT = 1.5;
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
      if (dc > (arm && closing(u, c.x, c.z, 1.2) ? LEASH2 : LEASH) || !leashed(pl, u)) continue;
      let pr;
      if (arm && u.kind === 'torpedo' && (u.phase === 'run' || u.sk === 'anvil' || (u.target && u.target.nation === pl.nation && u.state === 'attack'))) pr = 400;
      else if (arm && u.kind === 'dive' && (u.phase || u.state === 'attack')) pr = 320;
      else if (arm) pr = 220;
      else if (u.kind === 'fighter') pr = u.foe && u.foe.nation === pl.nation ? 140 : 100;
      else pr = 40;
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
    return d <= LEASH2 && armed(f) && closing(f, c.x, c.z, 1.2);
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
  // or a fighter on its tail for 2 s while below 70% hp with no friendly fighter within 45.
  function bomber(pl, dt) {
    if (!pl.ordnance || pl.phase || (pl.state !== 'transit' && pl.state !== 'attack')) return;
    const s = pl.df, hpf = pl.hp / pl.maxHp;
    pl.chasedT = s && s.from && s.from.alive ? (pl.chasedT || 0) + dt : 0;
    let go = hpf < 0.35;
    if (!go && pl.chasedT > 2 && hpf < 0.7) {
      go = true;
      for (const q of WW.world.planes) if (q.alive && q.kind === 'fighter' && q.nation === pl.nation && WW.dist(q.x, q.z, pl.x, pl.z) < 45) { go = false; break; }
    }
    if (!go) return;
    pl.dropped(); if (WW.fx) WW.fx.splash(pl.x, pl.z, 0.8);
    pl.state = 'return'; pl.foe = null; pl.sk = null; ST.jettisons++;
    if (WW.emit) WW.emit('airOrder', { carrier: pl.carrier, order: 'jettison', plane: pl, squadron: pl.squadron || null });
  }

  // ---------- scouts: the commander's search sectors, clear of known enemy carriers ----------
  if (WW.Scout) {
    const P = WW.Scout.prototype, plan0 = P.plan;
    P.plan = function () {
      plan0.call(this);
      try {
        const fc = WW.fleetCmd;
        if (fc && fc.scoutPoint) {
          const sp = fc.scoutPoint(this.nation, this.x, this.z);
          if (sp && this.legs && this.legs.length) { // sweep round the sector: 4 legs, 70 out
            const b = Math.atan2(this.z - sp.z, this.x - sp.x);
            this.legs = [-90, -30, 30, 90].map(a => ({ x: WW.clamp(sp.x + Math.cos(b + a * Math.PI / 180) * 70, 12, WW.cfg.MAP_W - 12), z: WW.clamp(sp.z + Math.sin(b + a * Math.PI / 180) * 70, 12, WW.cfg.MAP_H - 12) }));
          }
        }
        if (!this.legs || !WW.intel) return;
        for (const c of WW.intel.enemyShips(this.nation)) {   // known enemy carrier: its CAP is there; look from 110 out
          if (c.unit.type !== 'carrier') continue;
          for (const w of this.legs) {
            const d = WW.dist(w.x, w.z, c.x, c.z);
            if (d < 110) { const k = 110 / Math.max(1, d); w.x = WW.clamp(c.x + (w.x - c.x) * k, 12, WW.cfg.MAP_W - 12); w.z = WW.clamp(c.z + (w.z - c.z) * k, 12, WW.cfg.MAP_H - 12); }
          }
        }
      } catch (e) { /* keep the original legs */ }
    };
  }

  function reset() { for (const k in ST) ST[k] = 0; }
  WW.on('roundStart', reset);
  WW.airOps = { CAP_R, LEASH, LEASH2, RAID_R, stats: ST, plan, fighter, bomber, pickTarget, capWanted, picture, underAttack, armed };
})();
