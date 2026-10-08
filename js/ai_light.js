// ai_light.js — light forces: submarines (ambush ahead of the target's track, fire from the bow / beam, evade
// deep; surface only when nothing is near) and PT boats (lurk at island cover in their own half, dash at a
// target of opportunity when the run is clear, fire the spread as a pair, break off home with a jink).
// Registers WW.shipAI.roles.submarine / .pt. Reads the enemy only through WW.intel and WW.threat; no randomness.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const SUB_MAX_DIVE = 45, SUB_SURFACE = 25; // a sub must surface after this long submerged, for this long
  const H = WW.shipAI.h, bearing = H.bearing, seen = H.seen, lead = H.lead;
  const VAL = { carrier: 4, battleship: 3, cruiser: 2, destroyer: 1.2, submarine: 0.6, pt: 0 };

  // ---------------- shared helpers ----------------
  const now = () => WW.time.now;
  const danger = (n, x, z) => (WW.threat ? WW.threat.danger(n, x, z) : 0);
  // how far past the midline toward the enemy (x half-map): < 0 in own half. USN holds the west.
  const pen = (ship, x) => (ship.nation === 'USN' ? x - WW.cfg.MAP_W / 2 : WW.cfg.MAP_W / 2 - x) / (WW.cfg.MAP_W / 2);
  const homeX = ship => (ship.nation === 'USN' ? -1 : 1);
  const age = c => now() - c.seenAt;
  function contacts(ship, maxAge) {
    const out = [], cs = WW.intel ? WW.intel.enemyShips(ship.nation) : [];
    for (const c of cs) if (c.unit && c.unit.alive && !c.unit.sinking && age(c) <= maxAge) out.push(c);
    return out;
  }
  // The target's own share of the danger field at distance d (same weights as ai_threat.js), so a run's path
  // danger can be judged by what OTHER ships add (escorts, consorts) rather than by the target itself.
  function ownDps(u, d) {
    let v = 0;
    const fall = (r) => (d <= r ? 1.3 - 0.3 * d / r : d < r + 25 ? 1 - (d - r) / 25 : 0);
    for (const g of u.stats.guns) { const sh = WW.SHELL[g.cal]; v += 0.5 * (sh ? sh.dmg : 10) * g.count / g.reload * fall(g.range); }
    const tp = u.stats.torpedoes;
    if (tp) v += 0.3 * WW.TORPEDO.dmg * tp.count / tp.reload * fall(tp.range * 0.85);
    return v * (0.5 + 0.5 * u.hp / u.maxHp);
  }
  // Allies-in-the-fan and land check along a spread at bearing b out to range (torpedoes die in shallow water).
  function fanClear(ship, b, range) {
    if (H.fanClear) { try { return H.fanClear(ship, b, range); } catch (e) { /* fall back */ } }
    const c = Math.cos(b), s = Math.sin(b);
    for (const o of WW.world.ships) {
      if (o === ship || !o.alive || o.nation !== ship.nation || o.submerged) continue;
      const dx = o.x - ship.x, dz = o.z - ship.z, al = dx * c + dz * s;
      if (al < 0 || al > range + 10) continue;
      if (Math.abs(-dx * s + dz * c) < o.stats.length * 0.5 + 4 + al * 0.06) return false;
    }
    for (let k = 8; k < range; k += 6) if (WW.terrain.depthAt(ship.x + c * k, ship.z + s * k) < 1.2) return false;
    return true;
  }
  function landNear(x, z, r) {
    for (let i = 0; i < 8; i++) { const a = i * PI / 4; if (WW.terrain.depthAt(x + Math.cos(a) * r, z + Math.sin(a) * r) < -0.4) return true; }
    return false;
  }
  // Cover points: deep-enough water beside land that rises above the sea (blocks line of sight). Once per map.
  let cover = null;
  function coverPts() {
    if (cover) return cover;
    cover = [];
    const W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H;
    for (let x = 60; x <= W - 60; x += 15) for (let z = 30; z <= Hh - 30; z += 15) {
      if (WW.terrain.depthAt(x, z) < 4) continue;
      if (landNear(x, z, 16) || landNear(x, z, 26)) cover.push({ x, z });
    }
    return cover;
  }
  WW.on('roundStart', () => { cover = null; });
  WW.on('setupStart', () => { cover = null; });
  const order = ship => (WW.fleetCmd && WW.fleetCmd.order ? WW.fleetCmd.order(ship) : null);

  // ---------------- PT boats ----------------
  const PT = {
    DASH: 130,        // max run length to the firing point
    FIRE: 42,         // firing distance from the target (torpedo range 70; close = fewer misses)
    FIRE_MAX: 55,
    EX_MAX: 9,        // acceptable path danger from ships other than the target (dps)
    PEN_RUN: 0.12, PEN_ABORT: 0.16, PEN_LURK: -0.06, // midline limits (x half-map)
    RUN_MAX: 24, OUT_MIN: 6, OUT_MAX: 28, GHOST_T: 240, FLEE_DG: 0.6, IDLE_R: 40, IDLE_THR: 0.9
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
    const t = WW.dist(ship.x, ship.z, u.x, u.z) / ship.stats.speed;
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
    if (dash > PT.DASH || pen(ship, f.x) > PT.PEN_RUN || WW.terrain.depthAt(f.x, f.z) < 2) return null;
    let ex = 0;
    for (let k = 1; k <= 4; k++) {
      const x = ship.x + (f.x - ship.x) * k / 4, z = ship.z + (f.z - ship.z) * k / 4;
      ex = Math.max(ex, danger(n, x, z) - ownDps(u, WW.dist(x, z, u.x, u.z)));
    }
    return ex <= gate ? { fx: f.x, fz: f.z, dash, ex } : null;
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
      const r = runCheck(ship, c, sideOf(ship, u, L.pair.lead), gate);
      if (!r) continue;
      const s = VAL[u.type] * (crip ? 1.6 : 1) * (iso ? 1.3 : 1) / (1 + r.dash / 60 + r.ex / 10);
      if (!best || s > best.score) best = { c, score: s };
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
    const L = a.lt || (a.lt = { state: 'lurk', t0: T, decT: 0, lx: ship.x, lz: ship.z, tgt: null, side: 0, hp0: ship.hp, spotT: 0, pair: { p: null, lead: true } });
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
      const el = T - L.t0, clear = (!nb || nb.margin > 35) && danger(n, ship.x, ship.z) < 1;
      if (!deep && ((el > PT.OUT_MIN && clear) || el > PT.OUT_MAX)) { L.state = 'lurk'; L.from = null; L.spotT = 0; }
      return;
    }
    // ---- lurk ----
    if (decide && nb && (nb.margin < 25 || danger(n, ship.x, ship.z) > PT.FLEE_DG)) { L.state = 'flee'; L.t0 = T; L.from = nb.c.unit; return; }
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
      if (!tgt) { const o = opportunity(ship, L); if (o) { tgt = o.c.unit; L.side = sideOf(ship, tgt, L.pair.lead); } }
      if (tgt) { L.state = 'run'; L.tgt = tgt; L.t0 = T; L.hp0 = ship.hp; ship.target = tgt; return; }
    }
    // At the spot: a patrol leg stern-on to the enemy (a break-off then needs no turn), and a slower leg back.
    const d = WW.dist(ship.x, ship.z, L.lx, L.lz);
    if (L.leg === 'back' && d > PT.IDLE_R) L.leg = 'fwd';
    else if (L.leg !== 'back' && d < 8) L.leg = 'back';
    if (L.leg === 'back') {
      const ec = WW.intel && WW.intel.centre ? WW.intel.centre(n) : null;
      ship.desiredHeading = (ec ? Math.atan2(ship.z - ec.z, ship.x - ec.x) : homeX(ship) < 0 ? PI : 0) + 0.3 * Math.sin(T * 0.4 + ship.id);
      ship.throttle = PT.IDLE_THR; // brisk: a heavy ship sighted astern is already being run from
    } else {
      const want = Math.atan2(L.lz - ship.z, L.lx - ship.x);
      ship.desiredHeading = WW.threat ? WW.threat.bestHeading(ship, want, 0.1) : want;
      ship.throttle = d > 60 ? 0.85 : 0.5;
    }
  }

  // ---------------- submarines ----------------
  const SUB = { FIRE: 82, FIRE_MIN: 22, AOB: 2.0, OFF: 55, DIVE_DD: 130, DD_SAFE: 90, DD_KEEP: 85, REFRESH: 18, DIVE_SHIP: 80, DIVE_AIR: 125, DIVE_TGT: 105, EVADE: 14, CORNER: 90, SILENT: 65, SILENT_THR: 0.3, DD_FIRE: 38, AIM_T: 6, SCUTTLE: 60 }; // DD_FIRE: a destroyer is a narrow, fast target: only close shots hit
  // The best ambush: { c, ax, az, score } — a point beside the target's predicted track (from its last-known
  // heading and speed) that the sub can reach before the target passes. Never a destroyer (that is cornered fire).
  function ambush(ship) {
    const sp = ship.stats.speed * 0.9;
    let best = null;
    for (const c of contacts(ship, 30)) {
      const u = c.unit, w = VAL[u.type];
      if (u.submerged || u.type === 'destroyer' || u.type === 'pt' || !w) continue;
      const ag = Math.min(age(c), 20), ch = Math.cos(c.heading), sh = Math.sin(c.heading);
      const x0 = c.x + ch * c.speed * ag, z0 = c.z + sh * c.speed * ag;
      const side = ch * (ship.z - z0) - sh * (ship.x - x0) >= 0 ? 1 : -1;
      let pick = null;
      for (let t = 0; t <= 120; t += 6) {
        const px = x0 + ch * c.speed * t - sh * side * SUB.OFF, pz = z0 + sh * c.speed * t + ch * side * SUB.OFF;
        if (WW.dist(ship.x, ship.z, px, pz) / sp <= t + 4) { pick = { ax: px, az: pz, t }; break; }
      }
      let iso = 1;
      for (const q of contacts(ship, 20)) if (q.unit.type === 'destroyer' && WW.dist(q.x, q.z, c.x, c.z) < 80) { iso = 0.45; break; }
      const k = w * iso * (u.hp < u.maxHp * 0.5 ? 1.4 : 1) * (u.stats.speed < 5 ? 1.15 : 1);
      const s = pick ? k / (1 + pick.t / 40) : k * 0.2 / (1 + WW.dist(ship.x, ship.z, x0, z0) / 100);
      if (!best || s > best.score) best = { c, score: s, ax: pick ? pick.ax : x0, az: pick ? pick.az : z0 };
    }
    return best;
  }

  // Keep clear of destroyers' sonar: pick the heading near `want` whose point ~8 s ahead stays farthest outside
  // DD_KEEP of every known destroyer's projected position. Subs fear destroyers, not guns (they are under water).
  const SOFFS = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, PI];
  function ddSteer(ship, want, L) {
    if (!L.dds.length) return want;
    let best = want, bs = -1e9;
    for (const o of SOFFS) {
      const h = want + o, x = ship.x + Math.cos(h) * 30, z = ship.z + Math.sin(h) * 30;
      let sc = Math.cos(o);
      for (const q of L.dds) {
        const px = q.x + Math.cos(q.h) * q.sp * 8, pz = q.z + Math.sin(q.h) * q.sp * 8;
        sc -= 3 * Math.max(0, 1 - Math.min(WW.dist(x, z, px, pz), WW.dist(x, z, q.x, q.z)) / SUB.DD_KEEP);
      }
      if (sc > bs) { bs = sc; best = h; }
    }
    return best;
  }

  function subAI(ship, dt) {
    const a = ship.ai, n = ship.nation, T = now(), st = ship.stats;
    const L = a.ls || (a.ls = { decT: 0, amb: null, dds: [], dd: null, ddTgt: null, thr: null, thrD: 1e9, ddD: 1e9, air: false, near: false });
    L.decT -= dt;
    if (L.decT <= 0) {
      L.decT = 0.5;
      // what the side knows around the boat: destroyers (sonar hunters), any gun ship, aircraft
      L.dd = null; L.ddD = 1e9; L.thr = null; L.thrD = 1e9; L.near = false; L.air = false; L.dds = [];
      for (const c of contacts(ship, 12)) {
        const d = WW.dist(ship.x, ship.z, c.x, c.z), u = c.unit;
        if (u.type === 'destroyer' && d < L.ddD) { L.ddD = d; L.dd = c; }
        if (u.type === 'destroyer' && d < 220) L.dds.push({ x: c.x, z: c.z, h: c.heading, sp: age(c) < 4 ? c.speed : 0 });
        if (!u.submerged && u.stats.guns.length && d < SUB.DIVE_SHIP) L.near = true;
        if (!u.submerged && u.stats.guns.length && d < L.thrD) { L.thrD = d; L.thr = c; } // nearest gun ship
      }
      const ps = WW.intel && WW.intel.enemyPlanes ? WW.intel.enemyPlanes(n) : [];
      for (const p of ps) if (p.unit && p.unit.alive && WW.dist(ship.x, ship.z, p.x, p.z) < SUB.DIVE_AIR) { L.air = true; break; }
      L.amb = ambush(ship);
    }
    const tgt = L.amb ? L.amb.c.unit : null, d = tgt ? WW.dist(ship.x, ship.z, tgt.x, tgt.z) : 1e9;
    // ---- depth: air and batteries run out after SUB_MAX_DIVE s under water: surface for SUB_SURFACE s ----
    a.diveT = ship.submerged ? (a.diveT || 0) + dt : 0;
    if (a.diveT > SUB_MAX_DIVE && !(a.forcedT > 0)) a.forcedT = SUB_SURFACE;
    // Hard threats keep the boat down (and abort a surfacing). A destroyer out past DD_SAFE, or a target still
    // closing, only keeps it down while the air is fresh: with the clock past REFRESH it surfaces now, while it is
    // still safe, rather than be forced up later in the middle of a hunt.
    const hard = L.ddD < SUB.DD_SAFE || L.air || L.near || a.evadeT > 0 || (d < SUB.DIVE_TGT && a.diveT < SUB.REFRESH + 4);
    const soft = L.ddD < SUB.DIVE_DD || d < SUB.DIVE_TGT;
    if (a.forcedT > 0) { a.forcedT -= dt; ship.wantSurface = true; }
    else ship.wantSurface = !hard && (!soft || a.diveT > SUB.REFRESH);
    a.evadeT -= dt;
    const away = (o) => Math.atan2(ship.z - o.z, ship.x - o.x);
    // ---- cornered: a destroyer hunting the boat (inside sonar range) or bearing down on it is the one exception
    // to "never a destroyer". The boat stays deep and slow with its bow on that one destroyer, so a spread is ready
    // the moment the tubes are, and keeps on the same one (it takes three hits).
    if (L.ddTgt && (!L.ddTgt.alive || L.ddTgt.sinking || WW.dist(ship.x, ship.z, L.ddTgt.x, L.ddTgt.z) > SUB.CORNER + 30)) L.ddTgt = null;
    if (!L.ddTgt && L.dd) {
      const u = L.dd.unit, bowOn = Math.abs(WW.angleDiff(u.heading, away(L.dd))) < 0.6;
      if (L.ddD < SUB.SILENT || (bowOn && L.ddD < SUB.CORNER)) L.ddTgt = u;
    }
    if (L.ddTgt && (ship.submerged || a.forcedT > 0) && a.torpReload < SUB.AIM_T) { // tubes (nearly) ready: bow on
      const u = L.ddTgt, du = WW.dist(ship.x, ship.z, u.x, u.z), p = lead(ship, u, WW.TORPEDO.speed), lb = Math.atan2(p.z - ship.z, p.x - ship.x);
      ship.desiredHeading = lb; ship.throttle = a.torpReload > 2 ? SUB.SILENT_THR : 0.5;
      if (a.torpReload <= 0 && du > 10 && du < SUB.DD_FIRE && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.3 && seen(ship, u) && fanClear(ship, lb, du + 10)) H.fireSpread(ship, u);
      return;
    }
    // Hunted while the tubes reload: deep, slow and quiet, turning away from the destroyer's track.
    if (ship.submerged && !(a.forcedT > 0) && L.dd && L.ddD < SUB.SILENT) {
      ship.desiredHeading = ddSteer(ship, away(L.dd), L); ship.throttle = SUB.SILENT_THR;
      return;
    }
    // Air running low with a destroyer or gun ship about: open the distance before the boat has to come up.
    if (!(a.forcedT > 0) && ship.submerged && a.diveT > SUB.REFRESH && L.thr && L.thrD < SUB.DIVE_DD) {
      ship.desiredHeading = ddSteer(ship, away(L.dd && L.ddD < L.thrD + 30 ? L.dd : L.thr), L); ship.throttle = 1;
      return;
    }
    // ---- forced up, or evading after a shot: turn away from the threat ----
    if (a.forcedT > 0 && (L.ddD < 160 || L.near || L.air)) {
      // Badly hurt, out of air and forced up under the guns of a hunter it cannot outrun: the crew scuttles her.
      if (!ship.submerged && ship.hp < ship.maxHp * 0.35 && (L.ddD < SUB.SCUTTLE || L.thrD < SUB.SCUTTLE)) { ship.startSinking(); return; }
      const from = L.dd || (tgt ? { x: tgt.x, z: tgt.z } : null);
      let h = from ? away(from) : (WW.threat && WW.threat.away(n, ship.x, ship.z)) || ship.heading;
      h = ddSteer(ship, h, L);
      ship.desiredHeading = h; ship.throttle = 1;
      return;
    }
    if (a.evadeT > 0) { // after a shot: deep, slow, turned away
      let h = tgt ? away(tgt) + a.orbitDir * 0.5 : ship.heading;
      if (L.dd && L.ddD < 90) h = away(L.dd);
      ship.desiredHeading = h; ship.throttle = 0.45;
      return;
    }
    if (!tgt) { // patrol the commander's station (the flank of the enemy's approach), else ahead of our own fleet
      const o = order(ship);
      let sx = o && isFinite(o.sx) ? o.sx : (a.cn ? a.cx : ship.x) - homeX(ship) * 220, sz = o && isFinite(o.sz) ? o.sz : (a.cn ? a.cz : ship.z) + a.orbitDir * 100;
      sx = WW.clamp(sx, 40, WW.cfg.MAP_W - 40); sz = WW.clamp(sz, 40, WW.cfg.MAP_H - 40);
      const ds = WW.dist(ship.x, ship.z, sx, sz), b = Math.atan2(sz - ship.z, sx - ship.x);
      ship.desiredHeading = ddSteer(ship, ds > 25 ? b : b + a.orbitDir * PI / 2, L); ship.throttle = ds > 25 ? 0.8 : 0.4;
      return;
    }
    // ---- ambush: get to the point beside the predicted track, then wait bow-on to the lead point ----
    const p = lead(ship, tgt, WW.TORPEDO.speed), lb = Math.atan2(p.z - ship.z, p.x - ship.x);
    const da = WW.dist(ship.x, ship.z, L.amb.ax, L.amb.az);
    if (da > 14 && d > SUB.FIRE + 10) { ship.desiredHeading = ddSteer(ship, Math.atan2(L.amb.az - ship.z, L.amb.ax - ship.x), L); ship.throttle = 1; }
    else { ship.desiredHeading = lb; ship.throttle = d > SUB.FIRE ? 0.3 : 0.25; }
    const aob = Math.abs(WW.angleDiff(tgt.heading, Math.atan2(ship.z - tgt.z, ship.x - tgt.x))); // 0: we are dead ahead of it
    if (a.torpReload <= 0 && d < SUB.FIRE && d > SUB.FIRE_MIN && aob < SUB.AOB && Math.abs(WW.angleDiff(ship.heading, lb)) < 0.25 &&
        seen(ship, tgt) && fanClear(ship, lb, Math.min(st.torpedoes.range, d + 15))) {
      if (H.fireSpread(ship, tgt) !== false) a.evadeT = SUB.EVADE;
    }
  }

  WW.shipAI.roles.submarine = subAI;
  WW.shipAI.roles.pt = ptAI;
  WW.lightAI = { PT, SUB, coverPts, opportunity, fanClear }; // tuning tables and helpers (tests, overlay)
})();
