// air_boss.js — WW.airBoss: the carrier's air boss (WW.airOps.plan, called from ai_carrier.js airOps). It sets the
// air group (doctrine airGroup x TUNE.wing), keeps the CAP up and relieves it by whole elements, and runs the strike
// cycle: one deck load at a time (sized to the deck spot, air_deck.js spotCap), never a new strike while the last
// one is still queued, on deck or forming (no ghost waves), the next strike's clock started when the last one
// departs (air_strikes.js depart -> departed). Known enemy carriers come first. The reserve strike (doctrine
// reserveFrac) and the pursuit reserve (pursuitReserve) hold bombers back. Escorts recall to defend the carrier.
// Load after air_ops.js (before air_strafe.js, which wraps plan). Sim code: WW.rand only.
window.WW = window.WW || {};
(function () {
  const HOLD_MAX = 30;         // a strike waits at most this long for a raid to clear
  const MIN_B = 4;             // bombers for a strike (fewer: they join the next one, unless no more are coming)
  const RETRY = 2;             // s between strike checks while nothing can go
  const CV_AGE = 120;
  const LOADS = 2;             // deck loads per strike: the spotted load, then one more up the elevators while it forms up          // a carrier contact this fresh draws the strike (Midway: the carriers first)
  // Air groups, 1942 (doctrine, not rolled): Yorktown class 27 F4F / 37 SBD / 15 TBD; Shokaku 18 A6M / 27 D3A / 27 B5N.
  // TUNE.wing blends from the toy group (core.js ship stats, 6 / 4 / 4) to the full group: 0 toy, 1 full.
  const FULL = { USN: { fighter: 27, dive: 37, torpedo: 15 }, IJN: { fighter: 18, dive: 27, torpedo: 27 } };
  const TUNE = { wing: 0 };
  { const m = typeof location !== 'undefined' && /[?&]wing=([\d.]+)/.exec(location.search); if (m) TUNE.wing = +m[1]; } // ?wing=K (tests: env Q=wing=K)
  const BS = { strikes: 0, waits: 0, small: 0, cvFirst: 0, cvRetarget: 0, capBatches: 0, capHome: 0, diverts: 0 };
  const O = () => WW.airOps;

  function group(ship, base) {   // ships.js: the hangar a new carrier starts with
    const F = FULL[ship.nation], k = TUNE.wing;
    if (base) ship.wingF = base.fighter;
    if (!F || !base || ship.type !== 'carrier' || !(k > 0)) return base;
    const g = {};
    for (const kind of ['fighter', 'dive', 'torpedo']) g[kind] = Math.round(base[kind] + (F[kind] - base[kind]) * Math.min(1, k));
    ship.wingF = g.fighter;   // the CAP scales with it (ai_carrier.js capWanted)
    return g;
  }

  // ---------- the reserve strike (Nagumo's dilemma) ----------
  // While no enemy carrier is known, a strike on anything else leaves doctrine reserveFrac of the bombers in the
  // hangar, armed for ships, for when the enemy carriers turn up: a carrier sighting launches the reserve at once.
  // Held RSV_MAX s with no carrier found, the reserve is rearmed for the targets at hand (REARM s, the deck loaded
  // with them: they sit in cv.rearm, the deck load ship_fires.js reads; cv.deckRearmUntil) and goes with the next strike.
  const RSV_MAX = 110, REARM = 20;
  const RS = { held: 0, launches: 0, rearmed: 0, targets: {} };
  function cvContact(n, x, z) {  // the nearest fresh enemy carrier contact (not the island base)
    if (!WW.intel) return null;
    let best = null, bd = 1e9;
    for (const c of WW.intel.enemyShips(n, { fresh: CV_AGE })) {
      const u = c.unit;
      if (!u || !u.alive || u.sinking || u.isBase || (WW.intel.typeOf ? WW.intel.typeOf(c) : u.type) !== 'carrier') continue;
      const d = WW.dist(x, z, c.x, c.z); if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
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
      RS.rearmed++; RS.targets[tgt.type] = (RS.targets[tgt.type] || 0) + 1; a.rsv = null; a.rsvGo = true; return none;
    }
    return { dive: Math.round(cv.hangar.dive * frac), torpedo: Math.round(cv.hangar.torpedo * frac) };
  }
  function reserveTick(cv) {        // a carrier sighted while the reserve is held: strike now
    const a = cv.ai; if (!a.rsv || a.strikeT <= 1) return;
    const so = WW.fleetCmd && WW.fleetCmd.strikeOrder ? WW.fleetCmd.strikeOrder(cv) : null;
    if ((so && so.target && so.target.type === 'carrier') || cvContact(cv.nation, cv.x, cv.z) || (a.rsv.rearmT && WW.time.now >= a.rsv.rearmT)) a.strikeT = 1;
  }

  // ---------- the pursuit reserve (the follow-up strike on a beaten fleet) ----------
  // Once the carrier has flown its first strike and the enemy battle line has been seen (and the side has a battle
  // line of its own to win the gun fight: a carrier force alone uses everything), a follow-up strike leaves
  // doctrine pursuitReserve of the bombers in the hangar, armed, for the end of the battle: Hiryu's second strike on
  // Yorktown, Enterprise's and Hornet's afternoon strike on Hiryu, the 6 June strikes on Mikuma and Mogami. It is
  // released (the strike timer drops to 1 s) when the enemy is beaten: the side pursues, or the enemy's seen fit gun
  // tonnage is below WAVER of all it has seen with a carrier or a cripple of it known (it is about to break); in the
  // last LATE_T s of the round (no bombs go home); or when an enemy gun ship closes on this carrier (fleet_cmd defend:
  // self-defence first, a carrier's strikes are its only weapon against a battleship).
  const WAVER = 0.3, LATE_T = 30;
  const PS = { held: 0, released: 0, why: {} };
  function beaten(B) {
    if (B.posture === 'pursue') return 'pursue';
    if (!(B.foeTons > 0) || B.foeFit >= WAVER * B.foeTons) return null;
    for (const c of WW.intel.enemyShips(B.nation, { fresh: 60 })) { const u = c.unit; if (u && u.alive && !u.isBase && (u.type === 'carrier' || (WW.endgameAI && u.stats.guns.length && WW.endgameAI.isCripple(u)))) return 'waver'; }
    return null;
  }
  function pursuitWhy(cv, B) {
    return beaten(B) || (B.timeLeft < LATE_T ? 'late' : null) || (B.defend.some(q => q.carrier === cv) ? 'defend' : null);
  }
  function pursuitHold(cv, B) {     // bombers kept back from this strike: { dive, torpedo }, or null
    const a = cv.ai, frac = B.doctrine.pursuitReserve || 0;
    if (!frac || !a.struck || !B.foeSeen || !B.foeSeen.size || a.puGo || !B.groups.main.members.length) return null; // no battle line of its own: every plane now
    if (pursuitWhy(cv, B)) return null;
    if (!a.puHeld) { a.puHeld = true; PS.held++; }
    return { dive: Math.round(cv.hangar.dive * frac), torpedo: Math.round(cv.hangar.torpedo * frac) };
  }
  function pursuitTick(cv) {        // the enemy beaten while the reserve is held: strike now
    const a = cv.ai, B = WW.fleetCmd && WW.fleetCmd.side(cv.nation);
    if (!a.puHeld || a.puGo || !B) return;
    const why = pursuitWhy(cv, B); if (!why) return;
    a.puGo = true; PS.released++; PS.why[why] = (PS.why[why] || 0) + 1;
    if (a.strikeT > 1) a.strikeT = 1;
  }

  // ---------- CAP: standing elements, relieved as a batch ----------
  function elem(cv) { return cv.nation === 'IJN' ? 3 : 2; }
  function capTick(cv, A) {
    const a = cv.ai, hg = cv.hangar, E = elem(cv);
    const want = O().capWanted(cv), s = O().capState(cv);
    const queued = a.queue.filter(q => q.kind === 'fighter' && !q.target && !q.search).length;
    let need = want - s.on - s.coming - queued;
    if (need > 0 && hg.fighter > 0) {
      need = Math.min(Math.ceil(need / E) * E, hg.fighter);      // a whole element (section / shotai) goes up together
      for (let i = 0; i < need; i++) a.queue.unshift({ kind: 'fighter', target: null, cap: true });
      const ST = O().stats; if (s.low) ST.reliefs++; else if (A.near) ST.scrambles++;
      if (need >= E) BS.capBatches++;
      if (WW.emit) WW.emit('airOrder', { carrier: cv, order: s.low && !A.near ? 'relief' : A.near ? 'scramble' : 'cap', n: need, raid: A.near ? { x: A.raidX, z: A.raidZ, d: A.raidD } : null });
    }
    // the relief is on station: the tired element comes home together (not while a raid is near)
    if (s.low && s.on >= want && !A.armed) {
      for (const p of WW.world.planes) {
        if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || p.target || p.search || p.foe || p.state !== 'transit' || p.deckPh) continue;
        if (p.fuel <= O().RELIEF) { p.state = 'return'; BS.capHome++; }
      }
    }
  }

  // ---------- strikes ----------
  // Planes of this carrier still committed to the last strike: queued, below / on deck, or forming overhead.
  function strikeBusy(cv) {
    const a = cv.ai, D = cv._deck;
    for (const q of a.queue) if (q.target) return true;
    if (D) for (const p of D.launchers) if (p.target && p.alive && p.state === 'takeoff') return true;
    return !!(WW.strike && WW.strike.forming && WW.strike.forming(cv));
  }
  function owned(cv, kind) {        // this carrier's bombers of a kind still flying a strike, or being rearmed
    let n = 0;
    for (const p of WW.world.planes) if (p.alive && p.carrier === cv && p.kind === kind && p.state !== 'takeoff') n++;
    if (cv.rearm) for (const r of cv.rearm) if (r.kind === kind) n++;
    return n;
  }
  function tempo(cv) {              // s from a strike's departure to the next order (doctrine carrier emphasis)
    const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(cv.nation) : null, B = WW.fleetCmd && WW.fleetCmd.side(cv.nation);
    return WW.randRange(24, 38) * (d ? 1.25 - 0.5 * d.carrier : 1) * (B && B.posture === 'pursue' ? 0.6 : 1);
  }
  function orderStrike(cv) {
    const a = cv.ai, hg = cv.hangar;
    let tgt = O().pickTarget(cv);
    let cvf = false;
    if (tgt && tgt.type !== 'carrier') { const k = cvContact(cv.nation, cv.x, cv.z); if (k) { tgt = k; cvf = true; } } // the carriers first
    if (!tgt || hg.dive + hg.torpedo <= 0) { a.strikeT = RETRY; return; }
    const SB = WW.fleetCmd && WW.fleetCmd.side(cv.nation);
    if (SB && SB.timeLeft < 30 + WW.dist(cv.x, cv.z, tgt.x, tgt.z) / 22) { a.strikeT = RETRY; return; } // it could not get there before the end
    let hold = reserveHold(cv, tgt);
    const ph = SB ? pursuitHold(cv, SB) : null;    // the larger of the two reserves stays aboard
    if (ph) hold = { dive: Math.min(hg.dive, Math.max(hold.dive, ph.dive)), torpedo: Math.min(hg.torpedo, Math.max(hold.torpedo, ph.torpedo)) };
    let nd = Math.max(0, hg.dive - hold.dive), nt = Math.max(0, hg.torpedo - hold.torpedo);
    if (nd + nt < MIN_B && (owned(cv, 'dive') + owned(cv, 'torpedo') > 0 || hold.dive + hold.torpedo > 0) && !(SB && SB.timeLeft < LATE_T)) {
      a.strikeT = RETRY; BS.waits++; return;        // too few for a strike: wait for the rest to come back and rearm
    }
    if (nd + nt <= 0) { a.strikeT = RETRY; return; }
    // the deck spot (air_deck.js) and the next load spotted from the hangar while the first forms up, escorts first
    const cap = WW.airDeck && WW.airDeck.spotCap ? WW.airDeck.spotCap(cv) * LOADS : 99;
    const cs = O().capState(cv), keep = Math.max(0, O().capWanted(cv) - cs.on - cs.coming) + elem(cv); // a relief element stays back
    let esc = Math.min(Math.max(0, hg.fighter - keep), Math.max(2, Math.round(cap * 0.3)), 12);
    const nb = Math.min(nd + nt, Math.max(MIN_B, cap - esc));
    if (nb < nd + nt) { const fd = nd / (nd + nt); nd = Math.min(nd, Math.round(nb * fd)); nt = Math.min(nt, nb - nd); nd = nb - nt; }
    if (nd + nt < MIN_B) BS.small++;
    for (let i = 0; i < esc; i++) a.queue.push({ kind: 'fighter', target: tgt });
    for (let i = 0; i < Math.max(nd, nt); i++) {
      if (i < nd) a.queue.push({ kind: 'dive', target: tgt });
      if (i < nt) a.queue.push({ kind: 'torpedo', target: tgt });
    }
    BS.strikes++; if (cvf) BS.cvFirst++;
    if (WW.strike) WW.strike.newWave(cv, tgt, a.queue, { reserve: !!a.rsvGo });
    a.rsvGo = false;
    a.strikeT = 1e9;                // the clock restarts when this strike departs (departed)
  }
  // air_strikes.js: a wave left; the next strike is ordered tempo() s later (sooner when the strike was small).
  function departed(w) {
    const a = w.carrier.ai; if (!a) return;
    if (WW.strike.forming(w.carrier)) return;      // its squadron partner is still forming
    a.strikeT = tempo(w.carrier);
  }
  // While a strike forms: a carrier sighted that it is not going for turns it round (members too).
  function formTarget(w) {
    const t = w.target;
    if (w.carrier.isBase || (t && t.type === 'carrier' && t.alive)) return;
    const k = cvContact(w.nation, w.carrier.x, w.carrier.z); if (!k || k === w.hunted) return;   // (a reported carrier may be a cruiser: once)
    w.target = w.hunted = k; BS.cvRetarget++;
    for (const p of w.members) if (p.alive && p.target) p.target = k;
  }

  // ---------- the air boss ----------
  function plan(cv, dt) {
    const a = cv.ai, A = O().picture(cv), attacked = O().underAttack(cv);
    a.capT -= dt;
    if (a.capT <= 0) { a.capT = 1; capTick(cv, A); if (attacked) recall(cv); }
    if (WW.search) WW.search.plan(cv, dt); // search flights while nothing is known (air_search.js)
    reserveTick(cv); pursuitTick(cv);
    a.strikeT -= dt;
    a.lholdT = attacked ? (a.lholdT || 0) + dt : 0;
    const busy = strikeBusy(cv);
    if (a.strikeT > 1e8 && !busy) a.strikeT = tempo(cv);     // the strike was lost before it left (deck hit, stale wave)
    if (a.strikeT <= 0 && !busy) {
      if (attacked && (a.holdT || 0) < HOLD_MAX) { if (!a.holdT) O().stats.holds++; a.holdT = (a.holdT || 0) + dt; }
      else if ((WW.endgame && WW.endgame.broken(cv.nation)) || (WW.dayNight && !WW.dayNight.canFly())) a.strikeT = RETRY;   // broken: no new strikes, it is running; no launches in the dark
      else { a.holdT = 0; orderStrike(cv); }
    }
    launch(cv, dt);
  }
  // Launches: CAP any time; strike planes not while the carrier is under attack. The deck runs launch windows
  // (air_deck.js); keep at most 3 waiting below, and pick the kind that is spotted at the head of a deck column.
  function launch(cv, dt) {
    const a = cv.ai, D = cv._deck;
    a.launchT -= dt;
    if (!a.queue.length || a.launchT > 0) return;
    let i = 0;
    if (a.queue[0].target) {
      if (a.lholdT > 0 && a.lholdT < HOLD_MAX) return;
      if (D && D.launchers.filter(p => p.deckPh === 'queued').length >= 3) return;
      const heads = WW.airDeck && WW.airDeck.heads ? WW.airDeck.heads(cv) : null;
      if (heads) for (let j = 0; j < a.queue.length; j++) { const q = a.queue[j]; if (q.target && heads[q.kind]) { i = j; break; } }
    }
    const q = a.queue.splice(i, 1)[0];
    let tgt = q.target;
    if (tgt && (!tgt.alive || tgt.submerged)) tgt = O().pickTarget(cv);
    if (q.target && !tgt) return;
    const p = WW.air.launch(cv, q.kind, tgt);
    if (p) { a.launchT = 0.8; if (q.search && WW.search) WW.search.begin(p); }
  }
  // Own carrier under air attack: escorts in range with the fuel to get back recall to defend it.
  function recall(cv) {
    for (const p of WW.world.planes) {
      if (!p.alive || p.carrier !== cv || p.kind !== 'fighter' || !p.target || p.recall || !(p.state === 'transit' || p.state === 'attack') || p.deckPh) continue;
      const d = WW.dist(p.x, p.z, cv.x, cv.z);
      if (d < 320 && p.fuel > d / p.pt.speed + 25) { p.recall = true; O().stats.recalls++; if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'recall', plane: p, squadron: p.squadron || null }); }
    }
  }

  function reset() { RS.held = RS.launches = RS.rearmed = 0; RS.targets = {}; PS.held = PS.released = 0; PS.why = {}; for (const k in BS) BS[k] = 0; }
  WW.on('roundStart', reset);
  WW.airBoss = { plan, departed, formTarget, group, strikeBusy, cvContact, TUNE, FULL, stats: BS };
  if (WW.airOps) Object.assign(WW.airOps, { plan, reserve: RS, pursuit: PS, beaten });
})();
