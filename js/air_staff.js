// air_staff.js - WW.staff: the attacker's air staff, as the 1942 carrier staffs planned a strike (sim code: no randomness,
// only what the side knows through WW.intel; the CAP / defence side lives in air_cap.js / air_ops.js). Loads after
// air_cag.js; air_boss.js (orderStrike, departed), air_strikes.js (tick), air_cag.js (waveTick) and base_ai.js call it.
//  - Fighter picture: a side remembers each enemy fighter it has seen (where, when) for MEM_T s (intel keeps a plane
//    contact only PLANE_TTL s). capEst(nation, x, z): the fighters it expects over a point: those remembered there, or a
//    prior for a known carrier / an open island airfield whose fighters it has not seen yet.
//  - Routes (plan / steer): at departure the strike plots its course: an initial point (IP) IP_D out from the target on
//    the bearing with the least known AA on the run in (the side of the screen away from the battleships and AA
//    cruisers), out of a low sun and through cloud where the weather gives it, then a dogleg round the strongpoints on
//    the way: the AA field (WW.threat), the enemy island base (its pits and its fighters) when it is not the target,
//    and remembered CAP concentrations, within the fuel. Replanned every REPLAN s on the side's latest picture.
//    Enemy raids the side has seen (armed bombers, RAID_MEM s) are run on along their course: a route that would meet
//    one on the way costs more, so opposing strikes pass apart rather than through each other (air_cag.js detour does
//    the same in the last minute, on what is in sight). The stack keeps the heights apart (torpedo planes ~30, dive
//    bombers ~54, escorts ~70).
//  - Sizing (size): a deck load sized to the target and to its known defences: the escort follows the expected CAP
//    (doctrine air.escortK, learned up after a mauled strike: the USN's fighter-heavy strikes after Midway), the bombers
//    stay within air.bpe per escort fighter against a strong CAP, the CAP keeps air.capHold of the fighters at home,
//    and no more than air.commit of the air group flies strikes at once (a carrier never empties itself).
//  - Losses (ledger): a strike that lost LOSS_HEAVY of its bombers cuts the next one and slows the tempo; an air group
//    that has lost MAUL_LOST of its bombers (or has fewer than MAUL_LEFT left) is mauled: it strikes only carriers, in
//    self-defence or in the pursuit, keeps more fighters home, and its carriers hang back (cvStandoff).
//  - Break-off (waveTick): a strike caught short of the target by overwhelming fighters with a weak escort, after
//    losses, jettisons and turns for home; how much it takes rises with doctrine press (the IJN veterans press on).
//  - Sun and cloud (seeK, intel.js): a plane high in a low sun's glare, or in cloud, is seen visually at a shorter range.
// Events: 'airOrder' { carrier, order: 'breakOff' | 'mauled', wave?, n? }; 'admiralOrder' order 'airDefensive'.
window.WW = window.WW || {};
(function () {
  'use strict';
  const MEM_T = 180, MEM_FULL = 60, PRIOR = { carrier: 8, base: 4 }, EST_R = 170;
  const IP_D = 230, IP_N = 12, REPLAN = 25, SAMPLE = 20, LEN_K = 0.2, EXTRA_MAX = 0.5, FINAL_IN = 70;
  const BASE_R = 140, BASE_K = 0.3, FTR_R = 110, FTR_K = 0.05, SUN_K = 15, CLOUD_K = 15, KEEP_B = 12;
  const RAID_MEM = 60, RAID_RUN = 90, RAID_R = 150, RAID_K = 0.4;   // a seen raid: kept, run on its course for at most, avoided by, cost per unit at its centre
  const SIZE_K = { carrier: 1, battleship: 1, base: 0.8, cruiser: 0.7, destroyer: 0.4, pt: 0.3, submarine: 0.3 };
  const LOSS_HEAVY = 0.4, MAUL_LOST = 0.55, MAUL_LEFT = 0.3, MAUL_MIN = 8, ESC_MAX_K = 0.6, MIN_B = 4;
  const DOC = { USN: { capHold: 0.4, escortK: 0.9, learn: 0.3, commit: 0.45, bpe: 3, brk: 1 }, IJN: { capHold: 0.3, escortK: 0.6, learn: 0.1, commit: 0.5, bpe: 4.5, brk: 1.25 } };
  const ST = { plans: 0, doglegs: 0, sunIP: 0, cloudIP: 0, breakOffs: 0, mauled: 0, cuts: 0, waits: 0, escUp: 0, learned: 0, commitHolds: 0 };
  const ESC_WAIT = 45;   // s a strike waits for fighters to come back before it goes against a strong CAP without them
  // A/B switches (tests: env Q=staff=route:0,size:0): route (plotted routes), size (sizing, CAP hold, commitment, ledger),
  // brk (break-off), sun (sun / cloud sighting), base (the escort test for a raid on the island)
  const TUNE = { route: 1, size: 1, brk: 1, sun: 1, base: 1, ipb: 1, ftr: 1, bpen: 1, raid: 1 };
  { const m = typeof location !== 'undefined' && /[?&]staff=([^&]*)/.exec(location.search); if (m) decodeURIComponent(m[1]).split(',').forEach(kv => { const q = kv.split(':'); if (q.length === 2) TUNE[q[0]] = +q[1]; }); }
  let mem = {}, side = {}, acc = 0, raidMem = {};

  const doc = n => { const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(n) : null, a = d && d.air; return Object.assign({}, DOC[n] || DOC.USN, a || {}); };
  const sideOf = n => side[n] || (side[n] = { escK: 1, defensive: false });
  const ebase = n => { const b = WW.islandBase && WW.islandBase.base; return b && b.nation !== n && !b.neutralized ? b : null; };

  // ---------- the fighter picture ----------
  function remember(dt) {
    acc += dt; if (acc < 1) return; acc = 0;
    if (!WW.intel) return;
    const now = WW.time.now;
    for (const n of ['USN', 'IJN']) {
      const M = mem[n] || (mem[n] = new Map());
      // a CAP is fighters over the enemy's ships or airfield (escorts seen over our own fleet are not a strongpoint)
      const S = WW.intel.enemyShips(n, { fresh: 120 }).slice(), b = ebase(n);   // (a copy: intel filters into one scratch array)
      for (const c of WW.intel.enemyPlanes(n)) {
        const u = c.unit; if (!u || u.kind !== 'fighter') continue;
        if ((b && WW.dist2(b.x, b.z, c.x, c.z) < 220 * 220) || S.some(s => WW.dist2(s.x, s.z, c.x, c.z) < 220 * 220)) M.set(u, { x: c.x, z: c.z, t: now });
      }
      M.forEach((e, u) => { if (now - e.t > MEM_T || (!u.alive && now - e.t < 6)) M.delete(u); });   // a fighter seen going down is off the plot
      // the raid picture: enemy bombers on their way out, where and on what course they were last seen
      const RM = raidMem[n] || (raidMem[n] = new Map());
      for (const c of WW.intel.enemyPlanes(n)) {
        const u = c.unit; if (!u || !u.alive || !u.ordnance || (u.kind !== 'dive' && u.kind !== 'torpedo') || u.state !== 'transit') continue;
        const w = u.wave, h = w && w.go ? w.h : u.heading, v = w && w.go ? (w.v || 22) : u.speed;
        RM.set(u, { x: c.x, z: c.z, h, v, t: now });
      }
      RM.forEach((e, u) => { if (now - e.t > RAID_MEM || !u.alive || !u.ordnance) RM.delete(u); });
    }
  }
  // where the side's seen raids will be tau s from now (run on along their last course, at most RAID_RUN s): an array
  // of { x, z, n } per raid (bombers seen within 60 of each other count as one raid)
  function raidsAt(n, tau) {
    const RM = raidMem[n], out = []; if (!RM || !RM.size) return out;
    const now = WW.time.now;
    RM.forEach(e => {
      const T = Math.min(RAID_RUN, now - e.t + tau), x = e.x + Math.cos(e.h) * e.v * T, z = e.z + Math.sin(e.h) * e.v * T;
      for (const r of out) if (WW.dist2(r.x, r.z, x, z) < 3600) { r.x = (r.x * r.n + x) / (r.n + 1); r.z = (r.z * r.n + z) / (r.n + 1); r.n++; return; }
      out.push({ x, z, n: 1 });
    });
    return out;
  }
  const wAge = age => age < MEM_FULL ? 1 : Math.max(0, 1 - (age - MEM_FULL) / (MEM_T - MEM_FULL));
  // the enemy fighters the side expects within R of (x, z)
  function capEst(n, x, z, R) {
    R = R || EST_R; const M = mem[n], now = WW.time.now, R2 = R * R;
    let s = 0;
    if (M) M.forEach(e => { if (WW.dist2(e.x, e.z, x, z) < R2) s += wAge(now - e.t); });
    if (s < 1 && WW.intel) {   // nothing seen there yet: the staff's guess for a known carrier, or an open airfield
      for (const c of WW.intel.enemyShips(n)) { const u = c.unit; if (u && u.alive && !u.isBase && now - c.seenAt <= 120 && WW.intel.typeOf(c) === 'carrier' && WW.dist2(c.x, c.z, x, z) < R2) s += PRIOR.carrier; }   // (unfiltered: no intel scratch array under a caller's loop)
      const b = ebase(n); if (b && WW.islandBase.runwayOpen() && WW.dist2(b.x, b.z, x, z) < R2) s += PRIOR.base;
    }
    return s;
  }
  function fighterDensity(n, x, z, skip) {   // remembered fighters about this point (not those over the target itself)
    const M = mem[n]; if (!M) return 0;
    const now = WW.time.now; let s = 0;
    M.forEach(e => { if (skip && WW.dist2(e.x, e.z, skip.x, skip.z) < 150 * 150) return; if (WW.dist2(e.x, e.z, x, z) < FTR_R * FTR_R) s += wAge(now - e.t); });
    return s;
  }

  // ---------- routes ----------
  // cost of flying a leg (dps-seconds of known AA, the base and remembered CAP as penalties per unit), sampled every SAMPLE
  function legCost(n, ax, az, bx, bz, T, v, base, s0) {
    const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / SAMPLE)), ds = L / k, RM = raidMem[n], raid = RM && RM.size && TUNE.raid;
    let c = 0;
    for (let i = 0; i < k; i++) {
      const f = (i + 0.5) / k, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      if (WW.dist2(x, z, T.x, T.z) < FINAL_IN * FINAL_IN) continue;   // the target's own umbrella is the job
      let d = WW.threat ? WW.threat.danger(n, x, z, { air: true }) : 0;
      d = d * ds / v;
      if (base) { const db = WW.dist(x, z, base.x, base.z); if (db < BASE_R) d += ds * BASE_K * TUNE.bpen * (1 - 0.5 * db / BASE_R) * (1 + base.ftr / 4); }
      if (TUNE.ftr) d += ds * FTR_K * TUNE.ftr * fighterDensity(n, x, z, T);
      if (raid) for (const r of raidsAt(n, ((s0 || 0) + f * L) / v)) { const dr = WW.dist(x, z, r.x, r.z); if (dr < RAID_R) d += ds * RAID_K * TUNE.raid * (1 - dr / RAID_R) * Math.min(1, r.n / 4); }   // meeting a raid on the way
      c += d;
    }
    return c;
  }
  const clampMap = (x, z) => ({ x: WW.clamp(x, 25, WW.cfg.MAP_W - 25), z: WW.clamp(z, 25, WW.cfg.MAP_H - 25) });
  // the bearing bonus of an IP: out of a low sun, through cloud on the run in
  function ipBonus(b, T, ip) {
    let s = 0, sun = 0, cl = 0;
    const D = WW.dayNight;
    if (D && (WW.daylight === undefined || WW.daylight > 0.5) && D.sunElev > 2 && D.sunElev < 50) sun = SUN_K * Math.max(0, Math.cos(WW.angleDiff(b, D.sunAz))) * (1 - D.sunElev / 50);
    if (WW.weather && WW.weather.cells && WW.weather.cells.length) for (let i = 1; i <= 3; i++) cl += WW.weather.cover(T.x + (ip.x - T.x) * i / 4, T.z + (ip.z - T.z) * i / 4) / 3;
    cl *= CLOUD_K;
    s = sun + cl;
    return { s, sun, cl };
  }
  function plan(w, k, t) {
    const n = w.nation, v = w.v || 22, now = WW.time.now, x0 = w.x, z0 = w.z;
    const dT = WW.dist(x0, z0, k.x, k.z), old = w.route;
    w.route = { tgt: t, t: now, via: null, b: null, final: dT < IP_D + 40 };
    ST.plans++;
    if (w.route.final) return;
    const b0 = ebase(n), base = b0 && t !== b0 ? { x: b0.x, z: b0.z, ftr: capEst(n, b0.x, b0.z, 150) } : null;
    // fuel (s): the shortest-legged bomber must fly the route at the guide's speed, the attack (~25 s) and home at cruise
    let fuel = 1e9, vr = 30; for (const p of w.members) if (p.alive && p.kind !== 'fighter' && p.fuel > 0) { fuel = Math.min(fuel, p.fuel); vr = Math.min(vr, p.pt.speed); }
    const home = w.carrier ? WW.dist(k.x, k.z, w.carrier.x, w.carrier.z) : dT, budget = fuel < 1e9 ? (fuel - 25 - home / vr) * v : 1e9;
    const direct = dT, maxLen = Math.max(Math.min(direct * (1 + EXTRA_MAX), budget), direct + 60);   // the straight run in from a near IP always fits
    let best = null, bc = 1e18;
    for (let i = 0; i < IP_N; i++) {
      const b = i / IP_N * Math.PI * 2, ip = clampMap(k.x + Math.cos(b) * IP_D, k.z + Math.sin(b) * IP_D);
      const L1 = WW.dist(x0, z0, ip.x, ip.z), Lf = WW.dist(ip.x, ip.z, k.x, k.z);
      const fin = legCost(n, ip.x, ip.z, k.x, k.z, k, v, base, L1), bon = ipBonus(b, k, ip);
      const keep = old && old.b !== null && Math.abs(WW.angleDiff(old.b, b)) < 0.3 ? 15 : 0;   // hysteresis: hold the plotted IP
      const L = L1 + Lf, ways = [null];
      const px = -(ip.z - z0) / (L1 || 1), pz = (ip.x - x0) / (L1 || 1);
      for (const o of [-0.5, -0.25, 0.25, 0.5]) ways.push(clampMap((x0 + ip.x) / 2 + px * o * L1, (z0 + ip.z) / 2 + pz * o * L1));
      for (const vp of ways) {
        const len = vp ? WW.dist(x0, z0, vp.x, vp.z) + WW.dist(vp.x, vp.z, ip.x, ip.z) + Lf : L;
        if (len > maxLen && (vp || L > maxLen)) continue;
        const c = (vp ? legCost(n, x0, z0, vp.x, vp.z, k, v, base, 0) + legCost(n, vp.x, vp.z, ip.x, ip.z, k, v, base, WW.dist(x0, z0, vp.x, vp.z)) : legCost(n, x0, z0, ip.x, ip.z, k, v, base, 0))
          + fin + (len - direct) * LEN_K - bon.s * TUNE.ipb - keep;
        if (c < bc) { bc = c; best = { b, vp, bon }; }
      }
    }
    if (WW.staff.log) WW.staff.log.push('plan ' + n + ' dT ' + dT.toFixed(0) + ' fuel ' + fuel.toFixed(0) + ' budget ' + budget.toFixed(0) + ' best ' + (best ? best.b.toFixed(2) + (best.vp ? ' via' : '') : '-') + (base ? ' base ' + WW.dist(x0, z0, base.x, base.z).toFixed(0) : ''));
    if (!best) { w.route.final = true; return; }   // no fuel for anything but the straight run
    w.route.b = best.b; w.route.via = best.vp;
    if (best.vp) ST.doglegs++;
    if (best.bon.sun > SUN_K * 0.3) ST.sunIP++;
    if (best.bon.cl > CLOUD_K * 0.3) ST.cloudIP++;
  }
  // air_strikes.js tick: the point the wave's guide steers for (null: straight at the target)
  function steer(w, k, t) {
    if (!TUNE.route) return null;
    const R = w.route, now = WW.time.now;
    const rn = raidMem[w.nation] && TUNE.raid ? raidMem[w.nation].size : 0;
    if (!R || R.tgt !== t || (!R.final && (now - R.t > REPLAN || (rn && !R.rn)))) { plan(w, k, t); w.route.rn = rn; }   // a raid newly on the plot: replot now
    const r = w.route;
    if (r.final) return null;
    if (r.via) {
      if (WW.dist(w.x, w.z, r.via.x, r.via.z) < 40) r.via = null; else return r.via;
    }
    const ip = clampMap(k.x + Math.cos(r.b) * IP_D, k.z + Math.sin(r.b) * IP_D);
    if (WW.dist(w.x, w.z, ip.x, ip.z) < 45 || WW.dist(w.x, w.z, k.x, k.z) < IP_D * 0.8) { r.final = true; return null; }
    return ip;
  }

  // ---------- the ledger: what the strikes cost ----------
  function led(cv) {
    const a = cv.ai || (cv.ai = {});
    if (!a.led) {
      let b0 = (cv.hangar ? cv.hangar.dive + cv.hangar.torpedo : 0);
      for (const p of WW.world.planes) if (p.alive && p.carrier === cv && (p.kind === 'dive' || p.kind === 'torpedo')) b0++;
      a.led = { b0: Math.max(1, b0), waves: [], sent: 0, mauled: false };
    }
    return a.led;
  }
  const bombers = w => w.members.filter(p => p.kind === 'dive' || p.kind === 'torpedo');
  const lost = L => L.filter(p => p._downed).length;   // shot down or ditched (air_aces.js marks it)
  function waveGo(e) {   // air_strikes.js 'waveGo'
    const cv = e && e.carrier; if (!cv || cv.isBase || !WW.strike) return;
    const L = led(cv);
    for (const q of WW.strike._waves()) if (q.carrier === cv && q.go && !q.led) {
      const B = bombers(q); q.led = { B, n: B.length, t: WW.time.now, esc: q.members.length - B.length, capE: cv.ai.capE };
      L.waves.push(q.led); L.sent += B.length;
    }
  }
  // a strike is over (its result known aboard) once no bomber of it is still armed and outbound, or after 150 s
  const over = (r, now) => now - r.t > 150 || r.B.every(p => !p.alive || p._downed || !p.ordnance || p.state === 'return' || p.state === 'landing');
  function judge(cv, look) {   // the ledger as the air officer reads it at the next strike order
    const L = led(cv), now = WW.time.now;
    let lostN = 0, last = null;
    for (const r of L.waves) { if (!r.done) { r.lost = lost(r.B); if (over(r, now)) r.done = true; } lostN += r.lost; if (r.done) last = r; }   // a finished strike's tally is frozen
    let left = cv.hangar ? cv.hangar.dive + cv.hangar.torpedo : 0;
    for (const p of WW.world.planes) if (p.alive && p.carrier === cv && (p.kind === 'dive' || p.kind === 'torpedo')) left++;
    if (cv.rearm) left += cv.rearm.filter(r => r.kind !== 'fighter').length;
    if (!look && !L.mauled && lostN >= MAUL_MIN && (lostN >= MAUL_LOST * L.sent || left < MAUL_LEFT * L.b0)) mauled(cv, L);
    return { lastLoss: last && last.n ? last.lost / last.n : 0, last, lostN, left };
  }
  function mauled(cv, L) {
    L.mauled = true; ST.mauled++;
    if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'mauled', squadron: null });
    const S = sideOf(cv.nation), B = WW.fleetCmd && WW.fleetCmd.side(cv.nation);
    if (S.defensive || !B) return;
    if (!B.groups.carrier.members.every(s => s.type !== 'carrier' || !s.alive || (s.ai && s.ai.led && s.ai.led.mauled))) return;
    S.defensive = true; B.doctrine.cvStandoff *= 1.15;   // the air groups are spent: the carriers hang back behind the battle line
    const A = WW.admirals && WW.admirals.of(cv.nation), fl = A && A.flagship;
    if (WW.emit) WW.emit('admiralOrder', { nation: cv.nation, admiral: A ? A.name : '', title: A ? A.title : '', order: 'airDefensive',
      text: (A ? A.title + ': ' : '') + 'the air groups are spent; fighters over the fleet, carriers stand off', t: WW.time.now,
      roundTime: WW.game ? WW.game.roundTime : 0, ship: fl || cv, x: (fl || cv).x, z: (fl || cv).z });
  }
  // after a mauled strike with a thin escort, the side sends more fighters with the next (doctrine air.learn)
  WW.on('airOrder', e => { if (e && e.order === 'breakOff' && e.carrier) sideOf(e.carrier.nation).escK = Math.min(1.8, sideOf(e.carrier.nation).escK + doc(e.carrier.nation).learn); });

  // ---------- strike sizing (air_boss.js orderStrike) ----------
  // In: the planned load { nd, nt, esc } and what the hangar / CAP can give. Out: the load, or null (no strike now).
  function size(cv, tgt, o) {
    if (!TUNE.size) { const J = judge(cv, true); if (WW.emit) WW.emit('airPlan', { carrier: cv, target: tgt, nb: o.nd + o.nt, esc: o.esc, capE: capEst(cv.nation, tgt.x, tgt.z), lastLoss: J.last ? J.lastLoss : null, lastN: J.last ? J.last.n : 0, mauled: false }); return o; }   // A/B: the ledger read, nothing changed
    const n = cv.nation, D = doc(n), S = sideOf(n), J = judge(cv), Lg = led(cv), B = WW.fleetCmd && WW.fleetCmd.side(n);
    const urgent = tgt.type === 'carrier' || (B && (B.posture === 'pursue' || B.timeLeft < 40 || B.defend.some(q => q.carrier === cv && q.enemy === tgt)));
    if (Lg.mauled && !urgent) { ST.waits++; return null; }
    // a heavy loss on the last strike: learn (more escorts) and send a smaller one
    if (J.last && !J.last.judged) { J.last.judged = true; if (J.lastLoss >= 0.3 && J.last.esc < J.last.n * 0.6) { S.escK = Math.min(1.8, S.escK + D.learn); ST.learned++; } }
    let { nd, nt, esc } = o, nb = nd + nt;
    const kt = WW.intel && WW.intel.known(n, tgt) || tgt, capE = capEst(n, kt.x, kt.z), wingF = cv.wingF || 0, hg = cv.hangar;
    // the CAP stays: capHold of the air group's fighters (more when mauled) is not for escorting
    let capUp = 0, out = 0, queued = 0;
    for (const p of WW.world.planes) if (p.alive && p.carrier === cv && p.state !== 'takeoff') { if (p.kind === 'fighter' && !p.target && !p.search) capUp++; if (p.target && !p.search && p.kind !== 'scout') out++; }
    for (const q of cv.ai.queue) if (q.target) queued++;
    const hold = Math.round(wingF * (Lg.mauled ? 0.6 : D.capHold));
    const cs = WW.airOps ? WW.airOps.capState(cv) : { on: capUp, coming: 0 }, cw = WW.airOps ? WW.airOps.capWanted(cv) : 0;
    const avail = Math.max(0, hg.fighter - Math.max(0, hold - capUp, cw - cs.on - cs.coming));   // the CAP the fighter director wants comes first
    // the escort follows the expected CAP over the target
    const want = Math.round(capE * D.escortK * S.escK), escMax = Math.max(2, Math.round(wingF * ESC_MAX_K));
    if (want > esc) ST.escUp++;
    esc = Math.min(Math.max(esc, want), escMax, Math.max(avail, Math.min(esc, 2)), hg.fighter);
    // the load for the target: a part load for a small ship; within bpe bombers per escort against a strong CAP
    let cap = Math.max(MIN_B, Math.round(KEEP_B * 2 * (SIZE_K[tgt.isBase ? 'base' : tgt.type] || 1)));
    if (capE >= 4) {
      // too thin an escort for the CAP expected: hold the strike for fighters to come back and land (ESC_WAIT s, a carrier
      // or self-defence target a third of it), then go: a coordinated, escorted strike, not a stream of small ones
      const need = Math.max(2, Math.round(capE * D.escortK * 0.5)), a = cv.ai;
      if (esc < need) { if (!a.escWait) a.escWait = WW.time.now; if (WW.time.now - a.escWait < ESC_WAIT * (urgent ? 0.33 : 1)) { ST.waits++; return null; } }
      cap = Math.min(cap, Math.max(MIN_B, Math.round(cap * 0.6), Math.round(esc * D.bpe)));
    }
    cv.ai.escWait = 0; cv.ai.capE = capE;
    if (J.lastLoss >= LOSS_HEAVY && !J.last.cut) { J.last.cut = true; cap = Math.min(cap, Math.max(MIN_B, Math.round(J.last.n * (1.2 - J.lastLoss)))); ST.cuts++; }   // smaller than the strike that was mauled
    // the commitment ceiling: strike planes out at once (bombers and escorts) within commit x the air group
    const room = Math.round((cv.wingN || 60) * D.commit * (urgent ? 1.15 : 1)) - out - queued;
    if (room < MIN_B + 1) { ST.commitHolds++; return null; }
    nb = Math.min(nb, cap);
    if (nb + esc > room) { const k = room / (nb + esc); nb = Math.max(MIN_B, Math.floor(nb * k)); esc = Math.max(0, Math.min(esc, room - nb)); ST.commitHolds++; }
    if (nb < nd + nt) { const fd = nd / Math.max(1, nd + nt); nd = Math.min(nd, Math.round(nb * fd)); nt = Math.min(nt, nb - nd); nd = Math.min(o.nd, nb - nt); }
    if (nd + nt < Math.min(MIN_B, o.nd + o.nt)) return null;
    if (WW.emit) WW.emit('airPlan', { carrier: cv, target: tgt, nb: nd + nt, esc, capE, lastLoss: J.last ? J.lastLoss : null, lastN: J.last ? J.last.n : 0, mauled: Lg.mauled });
    if (WW.staff.log) WW.staff.log.push([+WW.time.now.toFixed(0), n, cv.id, tgt.isBase ? 'base' : tgt.type, +capE.toFixed(1), o.nd + o.nt, o.esc, '->', nd + nt, esc, 'avail', avail, 'room', room, 'cap', cap, 'J', +J.lastLoss.toFixed(2), J.lostN, J.left, Lg.b0, Lg.mauled ? 'M' : '', +S.escK.toFixed(2)].join(' '));
    return { nd, nt, esc, capE };
  }
  // air_boss.js departed: the next strike's clock (slower after a costly strike, slower still when mauled)
  function tempoK(cv) {
    const L = cv.ai && cv.ai.led; if (!L || !TUNE.size) return 1;
    let r = null; for (const q of L.waves) if (over(q, WW.time.now)) r = q;
    return (L.mauled ? 1.6 : 1) * (r && r.n && lost(r.B) / r.n >= LOSS_HEAVY ? 1.5 : 1);
  }

  // ---------- the island as a target (base_ai.js strikeValue) ----------
  // a neutralization raid only with the escort to fight the airfield's fighters through
  function baseK(nation, cv) {
    const b = ebase(nation); if (!b || !cv || !cv.hangar) return 1;
    const f = capEst(nation, b.x, b.z, 150), esc = Math.max(0, cv.hangar.fighter - Math.round((cv.wingF || 0) * doc(nation).capHold));
    if (TUNE.base && f > 2 && esc < f * 0.8) return 0.25;
    return 1;
  }

  // ---------- break-off (air_cag.js waveTick) ----------
  function breakOff(w, brk) {
    const now = WW.time.now;
    if (!TUNE.brk || !w.go || w.done || w.lead || now - (w.boT || -9) < 1 || !w.led || w.dT < brk + 50) return false;
    w.boT = now;
    const B = w.led.B.filter(p => p.alive && p.ordnance && p.state !== 'return');
    if (!B.length) return false;
    let F = 0, E = 0;
    if (WW.intel) for (const c of WW.intel.enemyPlanes(w.nation)) { const u = c.unit; if (u && u.alive && u.kind === 'fighter' && WW.dist2(c.x, c.z, w.x, w.z) < 110 * 110) F++; }
    for (const p of w.members) if (p.alive && p.kind === 'fighter' && p.state !== 'return' && WW.dist2(p.x, p.z, w.x, w.z) < 130 * 130) E++;
    const loss = 1 - B.length / Math.max(1, w.led.n), pr = WW.strike.press ? WW.strike.press(B[0]) : 1;
    const tk = w.target && w.target.type === 'carrier' ? 0.1 : 0, bk = doc(w.nation).brk || 1;
    if (F < (1.5 + 1.5 * pr) * bk * (E + 1) || loss < (0.15 + 0.25 * pr) * bk + tk) return false;
    for (const p of B) { p.dropped(); p.state = 'return'; p.foe = null; p.sk = null; p.target = null; }
    w.done = true; ST.breakOffs++;
    if (WW.emit) WW.emit('airOrder', { carrier: w.carrier, order: 'breakOff', wave: w, n: B.length, plane: w.cag || B[0], leader: w.cag || B[0], squadron: w.cag ? w.cag.squadron : null, target: w.target });
    return true;
  }

  // ---------- sun and cloud (intel.js plane sighting) ----------
  function seeK(obs, pl) {
    let k = 1;
    if (!TUNE.sun) return k;
    const D = WW.dayNight, y = pl.y || 0;
    if (D && y > 25 && D.sunElev > 2 && D.sunElev < 40 && Math.abs(WW.angleDiff(Math.atan2(pl.z - obs.z, pl.x - obs.x), D.sunAz)) < 0.3) k = 0.6;   // in the glare
    if (WW.weather && WW.weather.cells && WW.weather.cells.length && y > 20) k *= 1 - 0.5 * WW.weather.cover(pl.x, pl.z);
    return k;
  }

  function reset() { mem = {}; side = {}; acc = 0; raidMem = {}; for (const k in ST) ST[k] = 0; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.on('waveGo', e => { try { waveGo(e); } catch (er) { console.error('staff', er); } });
  if (WW.air) { const u0 = WW.air.update; WW.air.update = function (dt) { const r = u0.apply(this, arguments); try { remember(dt); } catch (e) { console.error('staff', e); } return r; }; }
  WW.staff = { TUNE, capEst, raidsAt, steer, plan, size, tempoK, baseK, breakOff, seeK, judge, stats: ST, DOC, _mem: () => mem };
})();
