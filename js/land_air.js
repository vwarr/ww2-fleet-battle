// land_air.js - WW.landAir: the island base's air group and its runway (sim code: WW.rand only). Loads after
// air_cag.js and island_base.js. The base is an unsinkable "carrier" (plane.carrier = base, base.isBase): its planes
// are WW.Planes launched through WW.air.launch (squadrons, pilots, dogfights, AA all as usual); aircraft.js hands
// takeoff / goHome / landing / rollout to this file instead of air_deck.js.
//  - Roster (ROSTER): USN Midway-style - Wildcat-type fighters (CAP), SBD dive bombers, B-26 torpedo bombers and
//    B-17 high-level bombers; IJN - Zeros, G4M "Betty" torpedo bombers and Bettys as level bombers. A variant is a
//    plane kind (fighter / dive / torpedo, so every kind test elsewhere still works) with its own model and stats.
//  - Runway: taxi from the apron to the runway end most into the wind, wait for the runway, roll, lift off, climb.
//    Home: join the circuit, one plane at a time on final down the centreline, touch down, roll out, taxi to the
//    apron, rearm (REARM s; slower with the fuel farm burning). Closed runways (craters): planes hold over the island
//    and, after HOLD_MAX s, ditch off the reef. A neutralized base launches nothing more.
//  - Air boss (plan): a standing CAP (WW.airOps.capWanted: 2, 4 with raiders near), and every 55-75 s a strike on the
//    best known enemy ship within STRIKE_R: dive and torpedo bombers as a WW.strike wave, level bombers on their own.
//  - Level bombing (pl.level): B-17 / Betty level variants, and carrier torpedo planes sent against the island (Kates
//    carried bombs at Midway): straight and level at altitude, a stick released on the throw point; dropBomb's
//    scatter grows with height, so a B-17 rarely hits a ship (historically they hit nothing at Midway).
//  - Strikes on the base: each bomber aims at one of its facilities (aimFor), not the island's centre.
window.WW = window.WW || {};
(function () {
  'use strict';
  const REARM = 22, HOLD_MAX = 70, STRIKE_R = 560, TAXI_V = 4, ROLL_A = 7;
  // variant: kind, model key, flight stats over the nation's kind, level bombing { alt, bombs }, gear height
  const VAR = {
    f4f:  { kind: 'fighter', model: null, sq: 'VMF-221' },
    sbd:  { kind: 'dive', model: null, sq: 'VMSB-241' },
    b26:  { kind: 'torpedo', model: 'b26', sq: '69th BS', st: { hp: 46, speed: 30, turn: 0.85, climb: 4, range: 1300 }, gear: 1.0 },
    b17:  { kind: 'dive', model: 'b17', sq: '431st BS', st: { hp: 80, speed: 24, turn: 0.55, climb: 3, range: 1500 }, gear: 1.25, level: { alt: 62, bombs: 3 } },
    a6m:  { kind: 'fighter', model: null, sq: 'Tainan Kokutai' },
    g4m:  { kind: 'torpedo', model: 'g4m', sq: 'Misawa Kokutai', st: { hp: 34, speed: 30, turn: 0.85, climb: 4, range: 1500 }, gear: 1.0 },
    g4mL: { kind: 'dive', model: 'g4m', sq: 'Chitose Kokutai', st: { hp: 34, speed: 29, turn: 0.8, climb: 3.6, range: 1500 }, gear: 1.0, level: { alt: 48, bombs: 2 } }
  };
  const ROSTER = { USN: { f4f: 5, sbd: 4, b26: 2, b17: 3 }, IJN: { a6m: 5, g4m: 4, g4mL: 3 } };
  const KATE = { alt: 40, bombs: 1 };
  const ST = { launches: 0, landings: 0, ditched: 0, strikes: 0, levelDrops: 0, holds: 0 };

  const groundY = b => b.site.padH;
  const gearOf = p => (p.variant && VAR[p.variant].gear) || WW.air._pool.deckY;
  function stockSync(b) { const h = b.hangar; h.fighter = h.dive = h.torpedo = 0; for (const k in b.stock) h[VAR[k].kind] += b.stock[k]; }

  function setup(b) {
    b.stock = Object.assign({}, ROSTER[b.nation]);
    b.ai = { queue: [], capT: 1, strikeT: 25, launchT: 0, lq: [], rollT: -1e9, finalT: -1e9, aimN: 0 };
    stockSync(b);
    const sq = {};
    for (const k in b.stock) sq[k] = { kind: VAR[k].kind, nation: b.nation, name: VAR[k].sq, short: VAR[k].sq, cvName: b.name, leader: null, sorties: 0, lost: 0 };
    const byKind = { fighter: null, dive: null, torpedo: null };
    for (const k in sq) if (!byKind[sq[k].kind]) byKind[sq[k].kind] = sq[k];
    b._sq = { name: b.name, sq: byKind, byVariant: sq };   // air_squadrons.js group(): preset, never a carrier slot
    b._roster = { idle: [] };                              // air_aces.js roster(): the base's own pilots
    // parking spots on the apron (site-local u along the main runway, v = 11 toward the hangars)
    const S = b.site, c = Math.cos(S.h), s = Math.sin(S.h);
    b.spots = [];
    for (let i = 0; i < 12; i++) { const u = -34 + i * 6.5, v = 11; b.spots.push({ x: S.x + c * u - s * v, z: S.z + s * u + c * v, h: S.h - Math.PI / 2 }); }
    // a ditching point: open water just off the field island, toward the open sea
    b.ditch = null;
    for (let r = 40; r < 160 && !b.ditch; r += 6) for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
      if (WW.terrain.depthAt(x, z) > 2) { b.ditch = { x, z }; break; }
    }
  }
  function hangarLost(b) { for (const k in b.stock) b.stock[k] = Math.floor(b.stock[k] * 0.7); stockSync(b); }

  // ---------- the air boss ----------
  function capState(b) {
    let on = 0, coming = 0;
    for (const p of WW.world.planes) {
      if (!p.alive || p.carrier !== b || p.kind !== 'fighter' || p.target) continue;
      if (p.state === 'takeoff') coming++; else if ((p.state === 'transit' || p.state === 'attack') && p.fuel > 45) on++;
    }
    return { on, coming };
  }
  function pick(b, kind) { for (const k in b.stock) if (VAR[k].kind === kind && !VAR[k].level && b.stock[k] > 0) return k; return null; }
  function update(b, dt) {
    const a = b.ai, now = WW.time.now;
    for (let i = b.rearm.length - 1; i >= 0; i--) if (b.rearm[i].at <= now) { b.stock[b.rearm[i].v]++; b.rearm.splice(i, 1); }
    stockSync(b);
    if (b.neutralized) { a.queue.length = 0; return; }
    a.capT -= dt;
    if (a.capT <= 0) {
      a.capT = 1;
      const want = Math.min(4, WW.airOps ? WW.airOps.capWanted(b) : 2), cs = capState(b);
      const fv = pick(b, 'fighter'), queued = a.queue.filter(q => VAR[q.v].kind === 'fighter' && !q.target).length;
      let need = want - cs.on - cs.coming - queued;
      for (; need > 0 && fv && b.stock[fv] - a.queue.filter(q => q.v === fv).length > 0; need--) a.queue.unshift({ v: fv, target: null });
    }
    a.strikeT -= dt;
    if (a.strikeT <= 0 && !a.queue.some(q => q.target)) {
      a.strikeT = WW.randRange(55, 75);
      const t = WW.airOps ? WW.airOps.pickTarget({ x: b.x, z: b.z, nation: b.nation }) : null;
      if (t && WW.dist(b.x, b.z, t.x, t.z) < STRIKE_R) {
        const wave = [];
        for (const k in b.stock) {
          if (VAR[k].kind === 'fighter') continue;
          for (let i = 0; i < b.stock[k]; i++) { const q = { v: k, kind: VAR[k].kind, target: t, level: !!VAR[k].level }; a.queue.push(q); if (!q.level) wave.push(q); }
        }
        const f = pick(b, 'fighter'), esc = b.nation === 'IJN' && f ? Math.min(2, b.stock[f] - 3) : 0; // Zeros escort the Bettys
        for (let i = 0; i < esc; i++) { const q = { v: f, kind: 'fighter', target: t }; a.queue.push(q); wave.push(q); }
        if (wave.length || a.queue.some(q => q.level)) {
          ST.strikes++; WW.islandBase.stats.landStrikes++;
          if (wave.length && WW.strike) WW.strike.newWave(b, t, wave);
          WW.emit('baseEvent', { kind: 'strikeOut', base: b, nation: b.nation, x: b.x, z: b.z, target: t });
        }
      }
    }
    a.launchT -= dt;
    if (!a.queue.length || a.launchT > 0 || !WW.islandBase.runwayOpen()) return;
    const q = a.queue.shift();
    let t = q.target;
    if (t && (!t.alive || t.sinking)) t = WW.airOps ? WW.airOps.pickTarget({ x: b.x, z: b.z, nation: b.nation }) : null;
    if (q.target && !t) return;
    if (!(b.stock[q.v] > 0)) return;
    b.nextVariant = q.v;
    const p = WW.air.launch(b, VAR[q.v].kind, t);
    b.nextVariant = null;
    if (p) { a.launchT = 2.4; ST.launches++; WW.islandBase.stats.landSorties++; }
  }

  // ---------- launch: variant model and stats, onto the apron ----------
  function launched(p) {
    const b = p.carrier, v = b.nextVariant || pick(b, p.kind) || Object.keys(b.stock)[0], V = VAR[v];
    b.stock[v] = Math.max(0, b.stock[v] - 1); stockSync(b);
    p.variant = v;
    if (V.model) { // swap the model for the land plane's
      const P = WW.air._pool, m = P.get(V.model, p.nation);
      P.release(p.model);
      p.model = m; p.group = m.group; p.prop = m.prop; p.payload = m.payload || null;
      if (p.payload) p.payload.visible = p.ordnance;
    }
    if (V.st) { p.pt = Object.assign({}, p.pt, V.st); p.hp = p.maxHp = p.pt.hp; p.fuel = p.pt.range / p.pt.speed * 6; }
    if (V.level) { p.level = V.level; p.lvLand = true; }
    const sq = b._sq.byVariant[v]; if (sq) { p.squadron = sq; }
    const sp = b.spots[(b.ai.spotN = ((b.ai.spotN || 0) + 1)) % b.spots.length];
    p.x = sp.x; p.z = sp.z; p.y = groundY(b) + gearOf(p); p.heading = sp.h; p.speed = 0; p.vy = 0;
    p.rwPh = 'taxi'; p.rwT = 0; p.sync(0);
  }

  // ---------- runway geometry ----------
  // the open runway and direction most into the wind: { r, dir (heading), sx, sz (start end), ex, ez }
  function choose(b) {
    const wh = WW.wind ? WW.wind.a + Math.PI : b.heading;
    let best = null, bs = -9;
    for (const r of b.runways) {
      if (r.closed) continue;
      for (const sg of [1, -1]) {
        const h = sg > 0 ? r.h : r.h + Math.PI, sc = Math.cos(WW.angleDiff(h, wh)) + (r.i === 0 ? 0.3 : 0);
        if (sc > bs) { bs = sc; best = { r, h, sx: r.x - Math.cos(h) * r.len * 0.46, sz: r.z - Math.sin(h) * r.len * 0.46 }; }
      }
    }
    return best;
  }
  function busy(b, p) { // a plane rolling, or one on short final, or rolling out
    const a = b.ai, now = WW.time.now;
    if (now - a.rollT < 2.2) return true;
    for (const q of WW.world.planes) if (q !== p && q.carrier === b && q.alive && (q.rwPh === 'roll' || q.rwPh === 'final' || q.rwPh === 'land')) return true;
    return false;
  }
  function onGround(p, b, dt) { p.vy = 0; p.y = groundY(b) + gearOf(p); p.turn = 0; }
  function steerTo(p, x, z, dt, rate) { const h = Math.atan2(z - p.z, x - p.x); p.turnTo(h, dt, rate || 1.6); return WW.dist(p.x, p.z, x, z); }

  function takeoff(p, dt) {
    const b = p.carrier;
    p.rwT += dt;
    if (p.rwPh === 'taxi' || p.rwPh === 'hold') {
      const R = p.rw || (p.rw = choose(b));
      if (!R) { p.speed = 0; onGround(p, b, dt); return; }  // runways closed: wait on the apron
      if (p.rwPh === 'taxi') { const d = steerTo(p, R.sx, R.sz, dt, 2); p.speed = d > 3 ? TAXI_V : d; if (d < 1.2) p.rwPh = 'hold'; }
      else {
        p.speed = 0; p.turnTo(R.h, dt, 1.2);
        if (R.r.closed) { p.rw = null; p.rwPh = 'taxi'; }
        else if (Math.abs(WW.angleDiff(p.heading, R.h)) < 0.08 && !busy(b, p)) { p.rwPh = 'roll'; b.ai.rollT = WW.time.now; p.heading = R.h; }
      }
      onGround(p, b, dt); return;
    }
    if (p.rwPh === 'roll') {
      p.turn = 0; p.speed = Math.min(p.pt.speed * 0.95, p.speed + ROLL_A * dt);
      if (p.speed < p.pt.speed * 0.78) { onGround(p, b, dt); return; }
      p.rwPh = 'climb';
    }
    // climb out straight ahead, then into the mission
    p.speedTo(p.pt.speed * 0.9, dt); p.turn = 0;
    p.vy += WW.clamp(Math.min(4, p.pt.climb || 4) - p.vy, -6 * dt, 6 * dt);
    if (p.y > groundY(b) + 12) { p.state = 'transit'; p.rwPh = null; p.rw = null; }
  }

  // ---------- home: circuit, final, touchdown, rollout, taxi in ----------
  function goHome(p, dt) {
    const b = p.carrier, d = WW.dist(p.x, p.z, b.x, b.z);
    p.foe = null;
    p.fly(b.x, b.z, d > 120 ? 25 : 20, dt, p.pt.speed);
    if (d < 150) { p.state = 'landing'; p.rwPh = 'circuit'; p.rwT = 0; if (b.ai.lq.indexOf(p) < 0) b.ai.lq.push(p); }
  }
  function landing(p, dt) {
    const b = p.carrier, a = b.ai;
    a.lq = a.lq.filter(q => q.alive && !q.removed && q.state === 'landing' && q.carrier === b);
    if (a.lq.indexOf(p) < 0) a.lq.push(p);
    const i = a.lq.indexOf(p);
    p.rwT += dt;
    const R = choose(b);
    if (!R || b.neutralized) { // nowhere to land: hold over the island, then ditch off the reef
      p.holdT = (p.holdT || 0) + dt; if (p.holdT === dt) ST.holds++;
      if (p.holdT > HOLD_MAX && b.ditch) {
        if (steerTo(p, b.ditch.x, b.ditch.z, dt) < 10 || WW.terrain.depthAt(p.x, p.z) > 2 && p.holdT > HOLD_MAX + 20) { ST.ditched++; p.ditch(); return; }
        p.climbTo(8, dt); p.speedTo(p.pt.speed * 0.6, dt); return;
      }
      const ang = Math.atan2(p.z - b.z, p.x - b.x) + 0.45, r = 55 + 7 * Math.min(i, 5);
      p.fly(b.x + Math.cos(ang) * r, b.z + Math.sin(ang) * r, 22 + 3 * Math.min(i, 5), dt, p.pt.speed * 0.7);
      p.rwPh = 'circuit'; return;
    }
    p.holdT = 0;
    const tdx = R.sx + Math.cos(R.h) * 6, tdz = R.sz + Math.sin(R.h) * 6;   // touchdown just past the runway end
    const fx = tdx - Math.cos(R.h) * 75, fz = tdz - Math.sin(R.h) * 75;
    if (p.rwPh === 'circuit') {
      if (i > 0 || busy(b, p)) { // stacked: orbit the island, higher for each plane ahead
        const ang = Math.atan2(p.z - b.z, p.x - b.x) + 0.45, r = 55 + 7 * Math.min(i, 5);
        p.fly(b.x + Math.cos(ang) * r, b.z + Math.sin(ang) * r, 20 + 3 * Math.min(i, 5), dt, p.pt.speed * 0.72);
        return;
      }
      const d = WW.dist(p.x, p.z, fx, fz);
      p.fly(fx, fz, 11, dt, p.pt.speed * 0.7, 1.4);
      if (d < 14) { p.rwPh = 'final'; p.rwT = 0; p.rwH = R.h; p.rwX = tdx; p.rwZ = tdz; }
      return;
    }
    // final: down the centreline (PD on the cross-track drift), descending to the touchdown point
    const h = p.rwH, c = Math.cos(h), s = Math.sin(h), dx = p.x - p.rwX, dz = p.z - p.rwZ;
    const along = dx * c + dz * s, cross = -dx * s + dz * c, vc = dt > 0 && p._cr !== undefined ? (cross - p._cr) / dt : 0; p._cr = cross;
    const togo = -along;
    if (R.h !== h || p.rwT > 25) { p.rwPh = 'circuit'; p._cr = undefined; return; }   // the runway closed under it: go round
    p.turnTo(h - WW.clamp(cross * 0.12 + vc * 0.1, -0.7, 0.7), dt, 1.8);
    const ty = groundY(b) + gearOf(p) + WW.clamp(togo * 0.12, 0, 10);
    p.speed += WW.clamp(Math.max(p.pt.speed * 0.55, 13) - p.speed, -6 * dt, 6 * dt);
    p.vy = WW.clamp((ty - p.y) * 2.5, -6, 4);
    if (togo < 1) { // touchdown
      p.state = 'rollout'; p.rwPh = 'land'; p.y = groundY(b) + gearOf(p); p.vy = 0; p.heading = h; p.t = 0; p._cr = undefined;
      a.lq.splice(a.lq.indexOf(p), 1); WW.stats.planesLanded++; ST.landings++;
    }
  }
  function rollout(p, dt) {
    const b = p.carrier;
    if (p.rwPh === 'land') {
      p.speed = Math.max(TAXI_V, p.speed - 9 * dt);
      if (p.speed <= TAXI_V) { p.rwPh = 'taxiIn'; p.spot = b.spots[(b.ai.spotIn = ((b.ai.spotIn || 0) + 5)) % b.spots.length]; }
    } else {
      const d = steerTo(p, p.spot.x, p.spot.z, dt, 2);
      p.speed = Math.min(TAXI_V, d);
      if (d < 1) { receive(p, b); return; }
    }
    p.x += Math.cos(p.heading) * p.speed * dt; p.z += Math.sin(p.heading) * p.speed * dt;
    onGround(p, b, dt); p.turn = 0;
    p.sync(dt);
  }
  function receive(p, b) { // the ground crew takes it: refuel and rearm (slower with the fuel farm burning)
    const slow = b.facilities.some(f => f.kind === 'fuel' && f.out) ? 1.6 : 1;
    b.rearm.push({ v: p.variant, at: WW.time.now + REARM * slow });
    p.alive = false; p.remove();
  }

  // ---------- level bombing, and strikes on the base aimed at its facilities ----------
  function aimFor(pl, b) {
    if (pl.aimF && !(pl.aimF.f && pl.aimF.f.out && !pl.phase)) return pl.aimF;
    const L = [];
    for (const r of b.runways) if (!r.closed) { L.push({ x: r.x, z: r.z }); L.push({ x: r.x + r.c * r.len * 0.3, z: r.z + r.s * r.len * 0.3 }); }
    for (const f of b.facilities) if (!f.out && (f.kind === 'battery' || f.kind === 'aa' || f.kind === 'hangar' || f.kind === 'fuel')) L.push({ x: f.x, z: f.z, f });
    if (!L.length) L.push({ x: b.x, z: b.z });
    return (pl.aimF = L[(b.ai.aimN++) % L.length]);
  }
  function swap(pl, t, fn) { // run fn with the base's x / z moved to this plane's aim point
    const a = aimFor(pl, t), ox = t.x, oz = t.z;
    t.x = a.x; t.z = a.z;
    try { return fn(); } finally { t.x = ox; t.z = oz; }
  }
  function level(pl, dt) {
    if (!pl.lvLand && pl.sk !== 'atk' && WW.strike.escort(pl, dt)) return; // a carrier wave (Kates on the island): formation first
    const t = pl.validTarget(), L = pl.level || KATE;
    if (pl.lvPh === 'away') {
      pl.phaseT -= dt; pl.turn = 0; pl.climbTo(L.alt + 4, dt); pl.speedTo(pl.pt.speed, dt);
      if (pl.phaseT <= 0) { pl.lvPh = null; pl.state = pl.ordnance ? 'transit' : 'return'; }
      return;
    }
    if (!t) { pl.state = 'return'; return; }
    const isB = t.isBase, A = isB ? aimFor(pl, t) : t, d = WW.dist(pl.x, pl.z, A.x, A.z);
    pl.state = d < 150 ? 'attack' : 'transit';
    const gnd = Math.max(0, -WW.terrain.depthAt(A.x, A.z)), T = Math.sqrt(2 * Math.max(4, pl.y - gnd) / 9.8);
    const lead = isB ? 0 : t.speed * T, px = A.x + Math.cos(t.heading || 0) * lead, pz = A.z + Math.sin(t.heading || 0) * lead;
    const side = ((pl.fi || pl.wing || 0) % 3 === 1 ? -1 : (pl.fi || pl.wing || 0) % 3 === 2 ? 1 : 0) * 9; // a loose vic across the run
    const h = Math.atan2(pz - pl.z, px - pl.x), ox = -Math.sin(h) * side, oz = Math.cos(h) * side;
    const he = pl.fly(px + ox, pz + oz, L.alt, dt, pl.pt.speed, 0.8);
    const rel = pl.speed * 0.75 * T;
    if (d < rel && Math.abs(he) < 0.3 && pl.y > L.alt * 0.75) {
      for (let k = 0; k < (L.bombs || 1); k++) { if (isB) swap(pl, t, () => WW.combat.dropBomb(pl, t)); else WW.combat.dropBomb(pl, t); }
      pl.dropped(); pl.lvPh = 'away'; pl.phaseT = 5; ST.levelDrops++;
      if (pl.carrier && pl.carrier.isBase) WW.islandBase.stats.landDrops++;
    } else if (d < 12) { pl.lvPh = 'away'; pl.phaseT = 7; } // overshot: run on and come round again
  }
  if (WW.strike) {
    const dive0 = WW.strike.dive, torp0 = WW.strike.torp;
    WW.strike.dive = function (pl, dt) {
      if (pl.level) return level(pl, dt);
      const t = pl.target;
      if (t && t.isBase && t.alive) return swap(pl, t, () => dive0(pl, dt));
      return dive0(pl, dt);
    };
    WW.strike.torp = function (pl, dt) {
      if (pl.level || (pl.target && pl.target.isBase)) { if (!pl.level) pl.level = KATE; return level(pl, dt); }
      return torp0(pl, dt);
    };
  }
  // land-based hits on ships (the midway metrics): bombs and torpedoes from base planes
  const fromBase = new WeakSet();
  WW.on('weaponDropped', e => { if (e && e.proj && e.plane && e.plane.carrier && e.plane.carrier.isBase) fromBase.add(e.proj); });
  WW.on('weaponImpact', e => {
    if (!e || !e.proj || !fromBase.has(e.proj)) return;
    fromBase.delete(e.proj);                     // pooled projectiles are reused
    if (e.ship && WW.islandBase.stats) WW.islandBase.stats.landHits++;
  });
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });

  WW.landAir = { setup, update, launched, takeoff, goHome, landing, rollout, hangarLost, aimFor, VAR, ROSTER, stats: ST };
})();
