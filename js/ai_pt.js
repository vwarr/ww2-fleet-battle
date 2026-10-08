// ai_pt.js — PT boats: lurk at island cover in their own half, dash at a target of opportunity when the run is
// clear (WW.threat danger from ships other than the target), fire the spread as a pair from both beams, break off
// home at full speed with a jink. MG only at their own size. Registers WW.shipAI.roles.pt; uses WW.lightAI.h
// (ai_light.js, loaded first). Reads the enemy only through WW.intel and WW.threat; no randomness.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const H = WW.shipAI.h, seen = H.seen, lead = H.lead;
  const { VAL, now, danger, pen, homeX, age, contacts, ownDps, fanClear, landNear, coverPts, order } = WW.lightAI.h;
  const stats = { checks: 0, far: 0, deep: 0, shoal: 0, hot: 0 }; // PT run checks and why they were refused
  WW.on('roundStart', () => { for (const k in stats) stats[k] = 0; });

  // ---------------- PT boats ----------------
  const PT = {
    DASH: 130,        // max run length to the firing point
    FIRE: 38,         // firing distance from the target (torpedo range 70; close = fewer misses)
    FIRE_MAX: 50,
    EX_MAX: 9,        // acceptable path danger from ships other than the target (dps)
    PEN_RUN: 0.12, PEN_ABORT: 0.16, PEN_LURK: -0.06, // midline limits (x half-map)
    RUN_MAX: 24, OUT_MIN: 6, OUT_MAX: 28, GHOST_T: 240, LEAD_T: 8, FLEE_DG: 0.6, IDLE_R: 40, IDLE_THR: 0.9
  };
  function partner(ship) {
    const B = WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(ship.nation) : null;
    const m = B && B.groups && B.groups.pt ? B.groups.pt.members : null;
    if (m) { const i = m.indexOf(ship); if (i >= 0) { const p = m[i ^ 1]; return p && p.alive ? { p, lead: !(i & 1) } : { p: null, lead: true }; } }
    let best = null, bd = 220;
    for (const o of WW.world.ships) if (o !== ship && o.alive && o.type === 'pt' && o.nation === ship.nation) { const d = WW.dist(ship.x, ship.z, o.x, o.z); if (d < bd) { bd = d; best = o; } }
    return { p: best, lead: !best || ship.id < best.id };
  }
  // Where to lurk: the commander's PT station (own flank, own half), pulled to nearby island cover, kept out of
  // known gun reach. The wing of a pair lurks beside its leader.
  // Heavy ships a side has seen this round, remembered past the intel contact's expiry (a PT boat's own eye is
  // short, so a battleship it lost track of may well be inside its gun range). A lurk spot keeps clear of where it
  // may be now: its gun range plus how far it may have gone, along its last course.
  const ghosts = { USN: new Map(), IJN: new Map() };
  WW.on('roundStart', () => { ghosts.USN.clear(); ghosts.IJN.clear(); });
  function noteGhosts(ship) {
    const G = ghosts[ship.nation]; if (!G) return;
    for (const c of contacts(ship, 3)) if (c.unit.type === 'battleship' || c.unit.type === 'cruiser') G.set(c.unit.id, { u: c.unit, x: c.x, z: c.z, h: c.heading, sp: c.speed, t: c.seenAt });
  }
  function ghostNear(ship, x, z) {
    const G = ghosts[ship.nation]; if (!G) return false;
    for (const [k, g] of G) {
      const ag = now() - g.t;
      if (!g.u.alive || ag > PT.GHOST_T) { G.delete(k); continue; }
      const dr = Math.min(ag, 30), gx = g.x + Math.cos(g.h) * g.sp * dr, gz = g.z + Math.sin(g.h) * g.sp * dr;
      if (WW.dist(x, z, gx, gz) < g.u.stats.guns[0].range + 30 + Math.min(ag * 1.5, 90)) return true;
    }
    return false;
  }
  function lurkSpot(ship, L) {
    const a = ship.ai, o = order(ship), W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H, n = ship.nation;
    let bx, bz;
    if (o && isFinite(o.sx)) { bx = o.sx; bz = o.sz; }
    else { bx = (a.cn ? a.cx : ship.x) - homeX(ship) * 60; bz = WW.clamp((a.cn ? a.cz : ship.z) + a.orbitDir * 150, 40, Hh - 40); }
    if (ship.hp < ship.maxHp * 0.35) bx += homeX(ship) * 120; // cripple: stay home
    const lim = W / 2 + homeX(ship) * -PT.PEN_LURK * W / 2;    // never lurk past this x
    bx = ship.nation === 'USN' ? Math.min(bx, lim) : Math.max(bx, lim);
    bx = WW.clamp(bx, 40, W - 40);
    noteGhosts(ship);
    for (let k = 0; k < 4 && (danger(n, bx, bz) > 0.3 || ghostNear(ship, bx, bz)); k++) bx = WW.clamp(bx + homeX(ship) * 60, 40, W - 40); // out of known reach
    const ec = WW.intel && WW.intel.centre ? WW.intel.centre(n) : null;
    let best = { x: bx, z: bz }, bs = -danger(n, bx, bz) * 30 - (ghostNear(ship, bx, bz) ? 150 : 0);
    for (const c of coverPts()) {
      const dd = WW.dist(c.x, c.z, bx, bz);
      if (dd > 150 || pen(ship, c.x) > PT.PEN_LURK) continue;
      const dg = danger(n, c.x, c.z);
      let s = 25 - dd * 0.35 - dg * 30 - (dg > 0.3 ? 200 : 0) - WW.dist(c.x, c.z, ship.x, ship.z) * 0.05;
      if (ec) s -= WW.dist(c.x, c.z, ec.x, ec.z) * 0.08;
      if (s > bs && ghostNear(ship, c.x, c.z)) s -= 150;
      if (s > bs) { bs = s; best = c; }
    }
    const pr = L.pair.p && L.pair.p.ai && L.pair.p.ai.lt;
    if (!L.pair.lead && pr && pr.lx !== undefined) { L.lx = pr.lx; L.lz = WW.clamp(pr.lz + 14, 20, Hh - 20); return; }
    L.lx = best.x; L.lz = best.z;
  }
  // A target of opportunity: { c, fx, fz, score } or null. Isolated, crippled, slow, or a DD / CA near land,
  // within a short dash, with acceptable danger along the run from ships other than the target.
  function firePoint(ship, u, side) {
    const t = Math.min(PT.LEAD_T, WW.dist(ship.x, ship.z, u.x, u.z) / ship.stats.speed); // short look-ahead only
    const px = u.x + Math.cos(u.heading) * u.speed * t, pz = u.z + Math.sin(u.heading) * u.speed * t;
    const h = u.heading + side;
    return { x: px + Math.cos(h) * PT.FIRE, z: pz + Math.sin(h) * PT.FIRE };
  }
  function sideOf(ship, u, lead_) { // beam on the PT's side; the pair splits bow-ward / aft-ward of it
    const cr = Math.cos(u.heading) * (ship.z - u.z) - Math.sin(u.heading) * (ship.x - u.x);
    return (cr >= 0 ? 1 : -1) * (PI / 2 - (lead_ ? 0.5 : -0.35));
  }
  function runCheck(ship, c, side, gate) {
    const u = c.unit, n = ship.nation, f = firePoint(ship, u, side);
    const dash = WW.dist(ship.x, ship.z, f.x, f.z);
    if (WW.dist(ship.x, ship.z, u.x, u.z) > PT.DASH + PT.FIRE) { stats.far++; return null; } // the target itself is close
    stats.checks++;
    if (dash > PT.DASH) { stats.far++; return null; }
    if (pen(ship, f.x) > PT.PEN_RUN) { stats.deep++; return null; }
    if (WW.terrain.depthAt(f.x, f.z) < 2) { stats.shoal++; return null; }
    let ex = 0;
    for (let k = 1; k <= 4; k++) {
      const x = ship.x + (f.x - ship.x) * k / 4, z = ship.z + (f.z - ship.z) * k / 4;
      ex = Math.max(ex, danger(n, x, z) - ownDps(u, WW.dist(x, z, u.x, u.z)));
    }
    if (ex > gate) { stats.hot++; return null; }
    return { fx: f.x, fz: f.z, dash, ex };
  }
  function opportunity(ship, L) {
    const cs = contacts(ship, 20), guns = cs.filter(c => c.unit.stats.guns.length && !c.unit.submerged);
    let best = null;
    for (const c of cs) {
      const u = c.unit;
      if (age(c) > 3 || u.submerged || !VAL[u.type]) continue;
      let iso = true;
      for (const g of guns) if (g !== c && WW.dist(g.x, g.z, c.x, c.z) < 75) { iso = false; break; }
      const crip = u.hp < u.maxHp * 0.5, slow = u.stats.speed < 6 || u.speed < 2.5;
      const land = (u.type === 'destroyer' || u.type === 'cruiser') && landNear(u.x, u.z, 30);
      if (!(iso || crip || land || slow)) continue;
      const gate = PT.EX_MAX * (crip ? 1.6 : 1) * (land ? 1.4 : 1) * (iso ? 1.2 : 1);
      // the beam on our side, else the far beam (away from a consort), whichever run is clearer
      const s0 = sideOf(ship, u, L.pair.lead), r0 = runCheck(ship, c, s0, gate), r1 = runCheck(ship, c, -s0, gate);
      const r = r0 && (!r1 || r0.ex <= r1.ex + 2) ? r0 : r1, side = r === r0 ? s0 : -s0;
      if (!r) continue;
      const s = VAL[u.type] * (crip ? 1.6 : 1) * (iso ? 1.3 : 1) / (1 + r.dash / 60 + r.ex / 10);
      if (!best || s > best.score) best = { c, score: s, side };
    }
    return best;
  }
  function nearestBig(ship) { // nearest known enemy gun ship that out-guns a PT (flee from it)
    let b = null, bd = 1e9, near = null, nd = 1e9;
    for (const c of contacts(ship, 30)) {
      const u = c.unit;
      if (u.submerged || u.type === 'pt' || !u.stats.guns.length) continue;
      const dr = Math.min(age(c), 20), x = c.x + Math.cos(c.heading) * c.speed * dr, z = c.z + Math.sin(c.heading) * c.speed * dr; // where it may be now
      const d = WW.dist(ship.x, ship.z, x, z), r = u.stats.guns[0].range, q = { x, z, unit: u };
      if (d - r < bd) { bd = d - r; b = q; }
      if (d < nd && d < r + 40) { nd = d; near = q; } // the closest gun ship we are inside (or near) the reach of
    }
    return b ? { c: b, margin: bd, near } : null;
  }
  // MG only at its own size: PT boats, a destroyer close aboard, a surfaced sub. Never at BB / CA.
  function mgTarget(ship) {
    const ct = ship.ai.calTarget; if (!ct) return;
    let t = null, bd = 36;
    for (const c of contacts(ship, 3)) {
      const u = c.unit, d = WW.dist(ship.x, ship.z, u.x, u.z);
      if (u.submerged || !(u.type === 'pt' || u.type === 'submarine' || (u.type === 'destroyer' && d < 25))) continue;
      if (d < bd) { bd = d; t = u; }
    }
    for (const k in ct) ct[k] = t;
  }

  const L0state = a => (a.lt ? a.lt.state : 'lurk');
  function ptAI(ship, dt) {
    const a = ship.ai, n = ship.nation, T = now();
    const L = a.lt || (a.lt = { state: 'lurk', t0: T, decT: 0, lx: ship.x, lz: ship.z, tgt: null, side: 0, hp0: ship.hp, spotT: 0, leg: 'fwd', legT: 0, pair: { p: null, lead: true } });
    a.ownComb = L0state(a) !== 'lurk'; // combing a torpedo track would break a dash; at the lurk spot, comb
    a.ownWithdraw = true; // a crippled PT lurks at home and makes no runs (below) rather than the core's withdrawal
    mgTarget(ship);
    const jink = Math.sin(T * 1.7 + ship.id) * 0.45;
    L.decT -= dt;
    const decide = L.decT <= 0;
    if (decide) { L.decT = 0.5; L.pair = partner(ship); }
    if (L.state === 'run') {
      const u = L.tgt, c = u && u.alive && WW.intel ? WW.intel.known(n, u) : null;
      let abort = !c || age(c) > 6 || T - L.t0 > PT.RUN_MAX || pen(ship, ship.x) > PT.PEN_ABORT || ship.hp < L.hp0 - ship.maxHp * 0.3;
      if (!abort && decide) {
        // abort when the danger on the run spikes or a destroyer turns toward us
        const lx = ship.x + Math.cos(ship.heading) * 20, lz = ship.z + Math.sin(ship.heading) * 20;
        if (danger(n, lx, lz) - ownDps(u, WW.dist(lx, lz, u.x, u.z)) > PT.EX_MAX * 2.2) abort = true;
        for (const q of contacts(ship, 3)) {
          if (abort || q.unit === u || q.unit.type !== 'destroyer') continue;
          const d = WW.dist(ship.x, ship.z, q.x, q.z);
          if (d < 80 && Math.abs(WW.angleDiff(q.unit.heading, Math.atan2(ship.z - q.z, ship.x - q.x))) < 0.6) abort = true;
        }
      }
      if (abort) { L.state = 'out'; L.t0 = T; L.from = u; }
      else {
        const f = firePoint(ship, u, L.side), d = WW.dist(ship.x, ship.z, u.x, u.z);
        const p = lead(ship, u, WW.TORPEDO.speed), lb = Math.atan2(p.z - ship.z, p.x - ship.x);
        ship.desiredHeading = d > PT.FIRE_MAX + 8 && WW.dist(ship.x, ship.z, f.x, f.z) > 14 ? Math.atan2(f.z - ship.z, f.x - ship.x) : lb;
        ship.throttle = 1;
        if (a.torpReload <= 0 && d < PT.FIRE_MAX && d > 15 && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.3 && seen(ship, u) && fanClear(ship, lb, Math.min(ship.stats.torpedoes.range, d + 10))) {
          if (H.fireSpread(ship, u) !== false) { L.state = 'out'; L.t0 = T; L.from = u; }
        } else if (d < 15) { L.state = 'out'; L.t0 = T; L.from = u; }
      }
      if (L.state === 'run') return;
    }
    const nb = decide || L.state !== 'lurk' ? nearestBig(ship) : L.nb;
    L.nb = nb;
    if (L.state === 'out' || L.state === 'flee') {
      // Break off home at full speed with a jink: straight away from the attacker / nearest gun ship, leaning home.
      let from = L.from && L.from.alive ? L.from : null;
      if (nb && nb.near && (!from || WW.dist(ship.x, ship.z, nb.near.x, nb.near.z) < WW.dist(ship.x, ship.z, from.x, from.z))) from = nb.near;
      if (!from && nb) from = nb.c;
      let h = from ? Math.atan2(ship.z - from.z, ship.x - from.x) : (homeX(ship) < 0 ? PI : 0);
      const home = homeX(ship) < 0 ? PI : 0;
      const aw = h;
      h += WW.clamp(WW.angleDiff(h, home), -0.25, 0.25) + jink * 0.4;
      // a hard reversal bleeds speed: take the nearest heading still well clear of the threat's bearing first
      if (Math.abs(WW.angleDiff(ship.heading, h)) > 1.2) h = aw + WW.clamp(WW.angleDiff(aw, ship.heading), -0.75, 0.75);
      const deep = pen(ship, ship.x) > 0.02; // past the midline: home first, whatever the threat bearing
      if (deep) h = home + WW.clamp(WW.angleDiff(home, aw), -0.6, 0.6) + jink * 0.5;
      ship.desiredHeading = h; ship.throttle = 1;
      const el = T - L.t0, clear = (!nb || nb.margin > 60) && danger(n, ship.x, ship.z) < 1;
      if (!deep && ((el > PT.OUT_MIN && clear) || el > PT.OUT_MAX)) { L.state = 'lurk'; L.from = null; L.spotT = 0; }
      return;
    }
    // ---- lurk ----
    L.spotT -= dt;
    if (L.spotT <= 0) { L.spotT = 4; lurkSpot(ship, L); }
    if (decide && a.torpReload <= 0 && ship.hp >= ship.maxHp * 0.35) {
      // join the partner's run from the other side, else look for our own opportunity
      const pl = L.pair.p && L.pair.p.ai && L.pair.p.ai.lt;
      let tgt = null;
      if (pl && pl.state === 'run' && pl.tgt && pl.tgt.alive) {
        const c = WW.intel.known(n, pl.tgt);
        if (c && age(c) <= 3 && runCheck(ship, c, -pl.side, PT.EX_MAX * 1.6)) { tgt = pl.tgt; L.side = -pl.side; }
      }
      if (!tgt) { const o = opportunity(ship, L); if (o) { tgt = o.c.unit; L.side = o.side; } }
      if (tgt) { L.state = 'run'; L.tgt = tgt; L.t0 = T; L.hp0 = ship.hp; ship.target = tgt; return; }
    }
    // inside known gun reach with no run worth making: break off
    if (decide && nb && (nb.margin < (L.hot ? 60 : 25) || danger(n, ship.x, ship.z) > PT.FLEE_DG)) { L.state = 'flee'; L.t0 = T; L.from = nb.c.unit; return; }
    // A heavy ship we lost sight of may have closed into gun reach (its ghost): no patrol legs, full speed to the
    // spot (lurkSpot keeps it out of ghost reach), so a PT never idles where an unseen battleship can range it.
    if (decide) L.hot = ghostNear(ship, ship.x, ship.z) || danger(n, ship.x, ship.z) > 0.3;
    // At the spot: a patrol leg stern-on to the enemy (a break-off then needs no turn), and a slower leg back.
    const d = WW.dist(ship.x, ship.z, L.lx, L.lz);
    if (L.hot && d > 8) { L.leg = 'fwd'; L.legT = T; }
    if (L.leg === 'back' && (d > PT.IDLE_R || T - L.legT > 8)) { L.leg = 'fwd'; L.legT = T; } // (land astern: the timer turns it back)
    else if (L.leg !== 'back' && (d < 8 || (d < 25 && T - L.legT > 25))) { L.leg = 'back'; L.legT = T; }
    if (L.leg === 'back') {
      const ec = WW.intel && WW.intel.centre ? WW.intel.centre(n) : null;
      ship.desiredHeading = (ec ? Math.atan2(ship.z - ec.z, ship.x - ec.x) : homeX(ship) < 0 ? PI : 0) + 0.3 * Math.sin(T * 0.4 + ship.id);
      ship.throttle = PT.IDLE_THR; // brisk: a heavy ship sighted astern is already being run from
    } else {
      const want = Math.atan2(L.lz - ship.z, L.lx - ship.x);
      ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0.1) : want;
      ship.throttle = L.hot ? 1 : 0.85;
    }
    // keep way on: come about in a sweeping turn (a > 1.2 rad helm order halves the speed, ships.js), so a heavy
    // ship that closes unseen finds the boat already moving, ready to bolt
    ship.desiredHeading = ship.heading + WW.clamp(WW.angleDiff(ship.heading, ship.desiredHeading), -1.1, 1.1);
  }

  WW.shipAI.roles.pt = ptAI;
  Object.assign(WW.lightAI, { PT, stats, opportunity });
})();
