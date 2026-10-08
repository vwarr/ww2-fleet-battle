// ai_light.js — light forces: submarines (ambush ahead of the target's track, fire from the bow / beam, evade
// deep; surface only when nothing is near) and the helpers the PT boat file (ai_pt.js) shares with them.
// Registers WW.shipAI.roles.submarine; WW.lightAI.h holds the shared helpers. Reads the enemy only through
// WW.intel and WW.threat; no randomness.
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
  // shared with ai_pt.js (PT boats), which adds PT, stats and opportunity
  WW.lightAI = { SUB, h: { VAL, now, danger, pen, homeX, age, contacts, ownDps, fanClear, landNear, coverPts, order } };
})();
