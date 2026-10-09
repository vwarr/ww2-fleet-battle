// air_search.js — WW.search: one search system for scout floatplanes (air_scouts.js) and carrier search flights.
// - Sector claims: a searcher claims one of the commander's scout sectors (WW.fleetCmd blackboard `sectors`); a
//   claimed sector is not handed to another searcher of the side until the claim ends (the searcher heads home,
//   lands or is lost). New claims fan out: a sector on a bearing from the fleet away from the other claims' bearings.
// - Search legs (fan): out to the claimed sector, on along the same bearing deep into the enemy's side, a dogleg
//   across, then home.
// - Shadow: a searcher with a fresh contact close by keeps it in sight from a standoff ring (just inside its own
//   spotting range; a scout inside the 85 it spots for the guns from), on the point of that ring with the least known AA (WW.threat air channel), away from known
//   enemy carriers (their CAP) and detected enemy fighters, for at most SHADOW_T s.
// - Break away: a detected enemy fighter closing (or one on its tail, or damage taken) and the searcher dives low
//   and turns away, then goes home.
// - Home: routed round the AA umbrella and detected fighters, low while danger is near (homeHeading).
// - Carrier search flights (plan, from air_ops.js plan): while the side has no fresh contact (posture 'search', or
//   none for SEARCH_AGE s) and fewer than WANT searchers (scouts included) are out, a carrier launches dive bombers
//   (torpedo bombers, else spare fighters) as unarmed searchers. When the search finds something, the carrier's
//   next strike goes as soon as the deck allows. Sim code: no randomness.
window.WW = window.WW || {};
(function () {
  const WANT = 3, PER_CV = 2, START_T = 20, SEARCH_AGE = 45, CV_GAP = 6, PU_AGE = 45, GO_T = 2; // GO_T: a new strike target -> the strike order in this many s
  const SHADOW_T = { scout: 70, other: 55 }, STAND = { scout: 80, other: 90 }; // a scout shadows inside its gun-spotting range (intel SPOT 85), outside ships' AA (~70)
  const CAP_KEEP = 150, FTR_R = 85, SWEPT_R = 60, ALT = 30, LOW = 8;
  const ST = { sorties: 0, shadows: 0, breaks: 0, pounces: 0, lost: { out: 0, station: 0, home: 0 }, flown: 0, searched: { USN: new Set(), IJN: new Set() } };
  const claims = new Map(); // who -> { nation, k }

  const side = n => (WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(n) : null);
  const airDg = (n, x, z) => (WW.threat ? WW.threat.danger(n, x, z, { air: true }) : 0);
  const done = w => !w || !w.alive || w.removed || (w.kind && (w.state === 'return' || w.state === 'landing' || w.state === 'rollout' || w.state === 'alight' || w.state === 'afloat'));
  function prune() { for (const [w] of claims) if (done(w)) claims.delete(w); }

  // ---------- sector claims ----------
  function claim(nation, who, x, z) {
    const B = side(nation); if (!B || !B.sectors.length) return null;
    prune();
    const own = claims.get(who), S = B.sectors; // a new claim replaces the old one (and never repeats it)
    claims.delete(who);
    const taken = new Set(), brg = [], gx = B.axis.x, gz = B.axis.z;
    for (const [w, c] of claims) if (w !== who && c.nation === nation) { taken.add(c.k); brg.push(Math.atan2(S[c.k].z - gz, S[c.k].x - gx)); }
    let best = -1, bs = -1e9;
    for (let k = 0; k < S.length; k++) {
      if (taken.has(k) || (own && own.k === k)) continue;
      const s = S[k], b = Math.atan2(s.z - gz, s.x - gx);
      let sep = Math.PI;
      for (const q of brg) sep = Math.min(sep, Math.abs(WW.angleDiff(q, b)));
      const v = s.prio - WW.dist(x, z, s.x, s.z) / 6 + 40 * Math.min(1, sep / 0.6);
      if (v > bs) { bs = v; best = k; }
    }
    if (best < 0) return null;
    claims.set(who, { nation, k: best });
    return { x: S[best].x, z: S[best].z, k: best };
  }
  function release(who) { claims.delete(who); }
  // fan legs from (x, z): the claimed sector, deeper along the same bearing, a dogleg across
  function legs(pl) {
    const B = side(pl.nation), sp = claim(pl.nation, pl, pl.x, pl.z); if (!sp || !B) return [];
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, gx = B.axis.x, gz = B.axis.z, b = Math.atan2(sp.z - gz, sp.x - gx);
    const cl = (x, z) => ({ x: WW.clamp(x, 25, W - 25), z: WW.clamp(z, 25, H - 25) });
    const far = Math.min(WW.dist(gx, gz, sp.x, sp.z) + 220, 0.8 * W), dog = (pl.id || pl.carrier.id || 0) & 1 ? 0.3 : -0.3;
    return [cl(sp.x, sp.z), cl(gx + Math.cos(b) * far, gz + Math.sin(b) * far), cl(gx + Math.cos(b + dog) * far * 0.85, gz + Math.sin(b + dog) * far * 0.85)];
  }
  function noteSwept(pl) {
    const B = side(pl.nation); if (!B) return;
    for (let k = 0; k < B.sectors.length; k++) if (WW.dist2(pl.x, pl.z, B.sectors[k].x, B.sectors[k].z) < SWEPT_R * SWEPT_R) ST.searched[pl.nation].add(k);
  }

  // ---------- threats to a searcher ----------
  function fighterNear(pl, R) { // nearest detected enemy fighter within R that is closing (or on our tail)
    if (!WW.intel) return null;
    let best = null, bd = R;
    for (const c of WW.intel.enemyPlanes(pl.nation)) {
      const u = c.unit; if (!u || !u.alive || u.kind !== 'fighter') continue;
      const d = WW.dist(pl.x, pl.z, c.x, c.z); if (d >= bd) continue;
      if (u.foe === pl || Math.abs(WW.angleDiff(u.heading, Math.atan2(pl.z - c.z, pl.x - c.x))) < 0.9) { bd = d; best = u; }
    }
    return best;
  }
  // how bad a point is for a searcher: known AA, enemy carriers' CAP circle, detected fighters
  function risk(n, x, z) {
    x = WW.clamp(x, 0, WW.cfg.MAP_W); z = WW.clamp(z, 0, WW.cfg.MAP_H);
    let r = (airDg(n, x, z) || 0) / 4;
    if (WW.intel) {
      for (const c of WW.intel.enemyShips(n)) if (c.unit.type === 'carrier') { const d = WW.dist(x, z, c.x, c.z); if (d < CAP_KEEP) r += 3 * (1 - d / CAP_KEEP); }
      for (const c of WW.intel.enemyPlanes(n)) if (c.unit.kind === 'fighter') { const d = WW.dist(x, z, c.x, c.z); if (d < 70) r += 1.5 * (1 - d / 70); }
    }
    return r;
  }
  // the heading home that avoids AA / CAP / fighters (sampled round the straight line); low while risky
  const OFFS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];
  function homeHeading(pl, hx, hz) {
    const want = Math.atan2(hz - pl.z, hx - pl.x), n = pl.nation;
    let best = want, bs = -1e9;
    for (const o of OFFS) {
      const h = want + o, c = Math.cos(h), s = Math.sin(h);
      const v = Math.cos(o) - 1.2 * (risk(n, pl.x + c * 40, pl.z + s * 40) + risk(n, pl.x + c * 90, pl.z + s * 90));
      if (v > bs) { bs = v; best = h; }
    }
    return { h: best, low: risk(n, pl.x, pl.z) > 0.05 || !!fighterNear(pl, 130) };
  }
  function flyHeading(pl, h, alt, dt, spd) { pl.fly(pl.x + Math.cos(h) * 50, pl.z + Math.sin(h) * 50, alt, dt, spd); }

  // ---------- one search step (scouts and carrier searchers): break away, shadow; true = it flew the plane ----------
  function step(pl, dt) {
    const S = pl.srch || (pl.srch = { phase: 'out', evT: 0, shT: 0, from: null, hp0: pl.hp });
    noteSwept(pl);
    const sc = pl.kind === 'scout' ? 'scout' : 'other';
    // break away: a fighter closing, on our tail, or hits taken
    const f = fighterNear(pl, FTR_R);
    if (f || pl.hp < S.hp0 - pl.maxHp * 0.15) {
      if (S.evT <= 0) ST.breaks++;
      S.evT = 6; S.from = f || S.from;
    }
    if (S.evT > 0) {
      S.evT -= dt;
      const fr = S.from && S.from.alive ? S.from : null, home = pl.carrier;
      let h = fr ? Math.atan2(pl.z - fr.z, pl.x - fr.x) : Math.atan2(home.z - pl.z, home.x - pl.x);
      h += WW.clamp(WW.angleDiff(h, Math.atan2(home.z - pl.z, home.x - pl.x)), -0.6, 0.6);
      flyHeading(pl, h, LOW, dt, pl.pt.speed * 1.1);
      if (S.evT <= 0) goHome(pl);
      return true;
    }
    // shadow a fresh contact from the standoff ring
    const c = shadowContact(pl);
    if (c && S.shT < SHADOW_T[sc]) {
      if (S.shT === 0) ST.shadows++;
      S.shT += dt; S.phase = 'station';
      const R = STAND[sc], a0 = Math.atan2(pl.z - c.z, pl.x - c.x);
      let best = null, bs = -1e9;
      for (let k = -2; k <= 3; k++) {
        const a = a0 + k * 0.35 * (pl.srchDir || 1), x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R;
        const v = -risk(pl.nation, x, z) * 3 - Math.abs(k - 1) * 0.15 - (x < 20 || z < 20 || x > WW.cfg.MAP_W - 20 || z > WW.cfg.MAP_H - 20 ? 2 : 0);
        if (!best || v > bs) { bs = v; best = { x, z }; }
      }
      pl.fly(best.x, best.z, ALT, dt, pl.pt.speed * 0.85);
      return true;
    }
    if (S.shT >= SHADOW_T[sc]) { goHome(pl); return true; }
    return false;
  }
  function shadowContact(pl) {
    if (!WW.intel) return null;
    let best = null, bd = 200;
    for (const c of WW.intel.enemyShips(pl.nation, { fresh: 6 })) { const d = WW.dist(pl.x, pl.z, c.x, c.z); if (d < bd && !c.unit.submerged) { bd = d; best = c; } }
    return best;
  }
  function goHome(pl) { pl.state = 'return'; if (pl.srch) pl.srch.phase = 'home'; release(pl); }

  // ---------- carrier searchers ----------
  // Armed search (doctrine air.armedScout; USN): a scouting SBD carried a 500 lb bomb, and one that found a carrier
  // went for it (Santa Cruz: Strong and Irvine put a bomb into Zuiho's flight deck). It attacks a carrier it has in
  // sight within POUNCE_R if it has the fuel for the dive and the way home, then goes home. IJN searchers fly unarmed.
  const ARMED = { USN: 1, IJN: 0 }, POUNCE_R = 220, POUNCE_FUEL = 35;
  const armedDoc = n => { const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(n) : null; return d && d.air && d.air.armedScout !== undefined ? d.air.armedScout : ARMED[n] || 0; };
  function pounce(pl) {
    if (!pl.ordnance || pl.kind !== 'dive' || !WW.intel || pl.hp < pl.maxHp * 0.6) return false;
    let best = null, bd = POUNCE_R;
    for (const c of WW.intel.enemyShips(pl.nation, { fresh: 4 })) {
      const u = c.unit; if (!u || !u.alive || u.sinking || u.isBase || WW.intel.typeOf(c) !== 'carrier') continue;
      const d = WW.dist(pl.x, pl.z, c.x, c.z); if (d < bd) { bd = d; best = u; }
    }
    if (!best) return false;
    const cv = pl.carrier, home = WW.dist(best.x, best.z, cv.x, cv.z) / pl.pt.speed;
    if (pl.fuel < bd / pl.pt.speed + home + POUNCE_FUEL) return false;
    release(pl); pl.search = false; pl.legs = null; pl.target = best; pl.wave = null; pl.sk = null; pl.state = 'transit'; pl.opp = 'scout';
    ST.pounces++;
    if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'scoutAttack', plane: pl, leader: pl, squadron: pl.squadron || null, target: best });
    return true;
  }
  function begin(pl) {
    ST.sorties++;
    pl.search = true; pl.target = null; pl.srchDir = (pl.carrier.id + WW.world.planes.length) & 1 ? -1 : 1;
    if (pl.ordnance && !(pl.kind === 'dive' && armedDoc(pl.nation))) pl.dropped();   // unarmed search (no raid alarm, no bomb on the deck)
    const el = pl.element;                         // fly alone: leave the CAP element the launch put it in
    if (el) { el.members = el.members.filter(m => m !== pl); el.members.forEach((m, i) => { m.wing = i; m.leader = i ? el.members[0] : null; }); }
    pl.element = null; pl.leader = null; pl.wing = 0;
  }
  function fly(pl, dt) { // per step while a carrier searcher is in transit / attack
    pl.state = 'transit';
    const cv = pl.carrier, back = WW.dist(pl.x, pl.z, cv.x, cv.z) / pl.pt.speed + 25;
    if (pl.fuel < back) { goHome(pl); return; }
    if (pounce(pl)) return;
    if (step(pl, dt)) return;
    if (!pl.legs) { pl.legs = legs(pl); pl.leg = 0; if (!pl.legs.length) { goHome(pl); return; } }
    const w = pl.legs[pl.leg];
    pl.fly(w.x, w.z, ALT, dt, pl.pt.speed * 0.9);
    if (WW.dist(pl.x, pl.z, w.x, w.z) < 15) { pl.leg++; if (pl.srch) pl.srch.phase = 'station'; if (pl.leg >= pl.legs.length) goHome(pl); }
  }
  function homeStep(pl, dt) { // a searcher flying home: routed round the danger until close to its ship
    const h = pl.carrier, d = WW.dist(pl.x, pl.z, h.x, h.z);
    if (d < 120) return false;
    const r = homeHeading(pl, h.x, h.z);
    flyHeading(pl, r.h, r.low ? LOW + 4 : ALT, pl.lastDt || 0.05, pl.pt.speed);
    return true;
  }

  // ---------- air boss: launch search flights ----------
  function searchers(n) {
    let k = 0;
    for (const p of WW.world.planes) if (p.alive && p.nation === n && (p.search || p.kind === 'scout') && p.state !== 'return' && p.state !== 'landing' && p.state !== 'rollout' && p.state !== 'alight' && p.state !== 'afloat') k++;
    return k;
  }
  function plan(cv, dt) {
    const a = cv.ai, B = side(cv.nation), hg = cv.hangar, rt = WW.game ? WW.game.roundTime : 0;
    if (!B || !hg) return;
    a.srchT = (a.srchT || 0) - dt;
    const so = WW.fleetCmd.strikeOrder(cv);
    // found (by the search, a patrol, a picket): a carrier that had no strike target strikes as soon as the deck allows
    if (so && so.target && !so.hold && !a.soPrev && a.strikeT > GO_T) a.strikeT = GO_T;
    a.soPrev = !!(so && so.target);
    a.srchWant = rt > START_T && (B.posture === 'search' || B.searchFor > SEARCH_AGE) && !so;
    // pursuit (or the enemy about to break, air_ops.js beaten): the enemy's carrier lost (no contact in PU_AGE s): one searcher down its escape route (the sectors in
    // front of the enemy's home edge get the pursuit priority, fleet_cmd.js), a spare fighter before a bomber
    const pu = (B.posture === 'pursue' || (WW.airOps.beaten && WW.airOps.beaten(B))) && !WW.intel.enemyShips(cv.nation, { fresh: PU_AGE }).some(c => c.unit && c.unit.alive && c.unit.type === 'carrier');
    if (!(a.srchWant || pu) || a.srchT > 0) return;
    a.srchT = CV_GAP;
    const mine = WW.world.planes.filter(p => p.alive && p.carrier === cv && p.search && p.state !== 'return').length + a.queue.filter(q => q.search).length;
    if (mine >= (a.srchWant ? PER_CV : 1) || searchers(cv.nation) + a.queue.filter(q => q.search).length >= WANT) return;
    const kind = !a.srchWant && hg.fighter > 2 ? 'fighter' : hg.dive > 0 ? 'dive' : hg.torpedo > 0 ? 'torpedo' : hg.fighter > 3 ? 'fighter' : null;
    if (!kind) return;
    a.queue.push({ kind, target: null, search: true });
  }

  // ---------- hooks ----------
  if (WW.Plane) {
    const P = WW.Plane.prototype;
    ['diveBomber', 'torpBomber', 'fighter'].forEach(nm => {
      const f0 = P[nm];
      P[nm] = function (dt) { if (this.search) return fly(this, dt); return f0.call(this, dt); };
    });
    const gh = P.goHome;
    P.goHome = function (dt) { this.lastDt = dt; if (this.search && homeStep(this, dt)) return; return gh.call(this, dt); };
    const sd = P.shotDown;
    P.shotDown = function () {
      if (this.alive && (this.search || this.kind === 'scout')) { const ph = this.srch ? this.srch.phase : 'out'; ST.lost[ph] = (ST.lost[ph] || 0) + 1; release(this); }
      return sd.apply(this, arguments);
    };
  }
  if (WW.Scout) {
    const P = WW.Scout.prototype, s0 = P.search, g0 = P.goHome, p0 = P.plan;
    P.plan = function () { this.legs = legs(this); this.leg = 0; if (!this.legs.length) p0.call(this); };
    P.search = function (dt) {
      if (this.searchT === 0) ST.flown++;
      if (step(this, dt)) { this.searchT += dt; this.fuel -= dt; if (this.state === 'return') release(this); return; }
      const leg0 = this.leg;
      s0.call(this, dt);
      if (this.leg !== leg0 && this.srch) this.srch.phase = 'station';
      if (this.state === 'return') goHome(this);
    };
    P.goHome = function (dt) {
      const hp = this.homePoints(), d = WW.dist(this.x, this.z, hp.ax, hp.az);
      if (d > 90) { const r = homeHeading(this, hp.ax, hp.az); flyHeading(this, r.h, r.low ? LOW + 2 : 26, dt, this.pt.speed); return; }
      return g0.call(this, dt);
    };
  }
  function reset() { claims.clear(); ST.sorties = ST.shadows = ST.breaks = ST.flown = ST.pounces = 0; ST.lost = { out: 0, station: 0, home: 0 }; ST.searched = { USN: new Set(), IJN: new Set() }; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.search = { claim, release, legs, homeHeading, begin, plan, step, stats: ST };
})();
