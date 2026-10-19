// air_deck.js — the flight deck (WW.airDeck): parked planes with folded wings, re-spotting, deck modes (launch and
// recovery windows), the launch run and the into-the-wind turn. The deck shows at most one deck load (what fits at
// the current plane scale: spotCap); the rest of the air group is below in the hangar and comes up the elevators.
// The return, marshal stack, groove, trap and taxi back to the park are air_recovery.js. aircraft.js delegates
// Plane.takeoff / goHome / landing / rollout here. Deck coordinates are carrier local: lx along the deck (bow +x),
// lz across it. Parked models are children of the carrier group.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  // Deck stations per carrier class (models_cv.js model.deckDims, the DECK API): deck ends / spot limit / barrier,
  // start of the deck run, touchdown point, aft elevator; lane scales the parking columns and the run across the deck.
  // REF: the reference deck these were tuned on (a model without deckDims).
  const REF = { stern: -13.55, bow: 12.85, aftFront: 0.6, barrier: -1.5, launchX: 3.2, tdX: -9.5, elevX: -5.5, lane: 1 };
  const GAP = 0.2, TAXI = 4, FOLD = 1.75;          // spacing between parked planes, taxi speed, fold angle
  const WIND_FOE = 600, HOLD_FOE = 400;   // a known enemy gun ship this close on the wind bearing: launch and recover on the course held
  const LQ_MAX = 40, RW_N = 3, LW_MAX = 10, LW_MIN = 8, LW_RELIEF = 30; // launch window yields to planes held this long (after LW_MIN s); recovery window: traps / launch wait s (strike, CAP relief)
  const DEEP = 6, LQ_DEEP = 15, RW_DEEP = 12, LW_DEEP = 35;            // a deep stack: the launch window yields sooner, the recovery window runs longer
  // Re-spotting (1942 practice): a mode change only marks where the parked planes should be (D.spot: 'aft', spotted
  // for launch, or 'fwd', the forward park clear of the wires). The deck handlers then push them one at a time from the
  // free end (to the bow: the foremost first; aft: the rearmost first), the next starting once the last has rolled a
  // plane length: crews planes per column under way at once, HITCH s between starts in a column, at push u/s.
  // Hysteresis: idle after a recovery, the park stays forward idleHold s (a straggler may still come aboard; the IJN
  // strikes it below meanwhile); the window clocks (LW_MIN, the launch wait that ends a recovery window) run only once
  // the deck is re-spotted; a deck spotted for launch is not pushed forward for the first few back (DEFER_*).
  // Nation doctrine: the USN kept a deck park and re-spotted it by hand (pre-spotting the next deck load while idle);
  // the IJN spotted from the hangar just before each launch (only the planes ordered off) and struck recovered planes
  // below by the elevator nearest the forward park (strike), so little moves fore and aft.
  const DOC = {
    USN: { crews: 4, push: 4, idleHold: 6, preSpot: true, strike: false },
    IJN: { crews: 3, push: 4, idleHold: 30, preSpot: false, strike: true },
  };
  const HITCH = 0.35, SETTLE = 0.05;
  const DEFER_N = 3, DEFER_WAIT = 15, DEFER_FREE = 4, DEFER_FUEL = 25;
  const decks = [];                                 // every deck made this round (sunk carriers too)
  const P = () => WW.air._pool;

  // ---- helpers ----
  function toLocal(c, x, z) {
    const dx = x - c.x, dz = z - c.z, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    return [dx * ch + dz * sh, -dx * sh + dz * ch];
  }
  function lenOf(kind) { return ({ fighter: 2.66, dive: 2.68, torpedo: 2.78 }[kind] || 2.6) * ((WW.cfg && WW.cfg.PLANE_SCALE) || P().scale); } // the plane scale at run time
  // Wing fold: wingL / wingR pivot at the wing root (Corsair: at the gull knee, outer panels fold up over the top); rotation.x lifts the tip (side from the pivot's z).
  function setFold(m, f) {
    if (!m.wingL || !m.wingR) return;
    const a = FOLD * f * f * (3 - 2 * f);
    for (const w of [m.wingL, m.wingR]) {
      const z = w.position.z, side = z > 1e-3 ? 1 : z < -1e-3 ? -1 : (w === m.wingL ? -1 : 1);
      const rx = -side * a;
      if (!Object.is(w.rotation.x, rx)) w.rotation.x = rx; // parked planes stay folded: skip the unchanged quaternion rebuild
    }
  }
  function giveBack(m) { // back to the pool: unfolded, visible, out of any carrier group
    setFold(m, 0); m.group.visible = true;
    if (m.group.parent) m.group.parent.remove(m.group);
    P().release(m);
  }
  function deckOf(c) {
    if (c._deck) return c._deck;
    const k = (c.model && c.model.deckDims) || REF, s = k.islandSide || (c.nation === 'IJN' ? -1 : 1); // island side (+1 starboard)
    const D = { c, s, k, run: -s * 1.05 * k.lane, cols: [{ z: s * 0.68 * k.lane, e: [] }, { z: -s * 1.2 * k.lane, e: [] }], loose: [],
      mode: 'idle', launchers: [], lq: [], riseT: 1, waitT: 0, recT: 0, recN: 0, modeT: 0, filled: false, dy: 2, fold: true,
      spot: 'aft', doc: DOC[c.nation] || DOC.USN, idleT: 0, winT: 0, blk: 0 };
    c._deck = D; decks.push(D);
    return D;
  }
  function fits(D, col, extra) { // does the column (plus an extra length) fit the spot / the forward park?
    let L = extra || 0;
    for (const e of col.e) L += e.len;
    L += GAP * Math.max(0, col.e.length - (extra ? 0 : 1));
    return L <= (D.spot === 'fwd' ? D.k.bow - D.k.barrier : D.k.aftFront - D.k.stern);
  }
  function newEntry(D, m, kind, lx, lz, fold, readyAt, ph) {
    const e = { m, kind, len: lenOf(kind), lx, lz, tx: lx, fold, readyAt, ph, yoff: ph === 'up' ? -2.2 : 0 };
    D.c.group.add(m.group); m.group.rotation.set(0, 0, 0); setFold(m, fold);
    return e;
  }
  function colFor(D, kind, extra) {
    const a = D.cols[0], b = D.cols[1], pref = kind === 'dive' ? a : kind === 'torpedo' ? b : (a.e.length <= b.e.length ? a : b);
    if (!D.fold) return fits(D, b, extra) ? b : null; // wings cannot fold: one column, on the open side
    return fits(D, pref, extra) ? pref : fits(D, pref === a ? b : a, extra) ? (pref === a ? b : a) : null;
  }
  function counts(c) { // planes the carrier holds: hangar, rearming, and launched but still waiting below
    if (WW.nightPlan && WW.nightPlan.stowed(c)) return { fighter: 0, dive: 0, torpedo: 0 }; // dark: struck below, the deck bare (night_plan.js)
    const t = { fighter: c.hangar.fighter, dive: c.hangar.dive, torpedo: c.hangar.torpedo };
    if (c.rearm) for (const r of c.rearm) t[r.kind]++;
    if (c._deck) for (const q of c._deck.launchers) if (q.deckPh === 'queued') t[q.kind]++;
    return t;
  }

  // Targets: each column packed toward the stern (spot for launch) or toward the bow (the park while recovering).
  function pack(D) {
    const fwd = D.spot === 'fwd';
    for (const col of D.cols) {
      while (col.e.length && !fits(D, col, 0)) { const e = col.e.pop(); e.ph = 'down'; D.loose.push(e); }
      const n = col.e.length;
      if (fwd) { let x = D.k.bow; for (let i = 0; i < n; i++) { const e = col.e[i]; e.tx = x - e.len / 2; x -= e.len + GAP; } }
      else { let x = D.k.stern; for (let i = n - 1; i >= 0; i--) { const e = col.e[i]; e.tx = x + e.len / 2; x += e.len + GAP; } }
    }
  }
  // The handlers: release the next parked plane to be pushed, one per column from the free end (see DOC).
  function release(D, dt) {
    for (const col of D.cols) {
      const a = col.e; let busy = 0, chain = true;
      col.relCd = (col.relCd || 0) - dt;
      for (const e of a) if (e.go) {
        if (e.ph === 'in' || Math.abs(e.tx - e.lx) < SETTLE) { e.go = false; continue; }
        busy++; if (Math.abs(e.lx - e.x0) < e.len + GAP) chain = false;
      }
      if (col.relCd > 0 || busy >= D.doc.crews || !chain) continue;
      let pick = null;
      for (let i = 0; i < a.length && !pick; i++) { const e = a[i]; if (e.ph !== 'in' && !e.go && e.tx - e.lx > SETTLE) pick = e; }         // forward: the foremost first
      for (let i = a.length - 1; i >= 0 && !pick; i--) { const e = a[i]; if (e.ph !== 'in' && !e.go && e.lx - e.tx > SETTLE) pick = e; } // aft: the rearmost first
      if (pick) { pick.go = true; pick.x0 = pick.lx; col.relCd = HITCH; }
    }
  }
  function settled(D) { for (const col of D.cols) for (const e of col.e) if (e.ph !== 'in' && Math.abs(e.tx - e.lx) > SETTLE) return false; return true; }
  function moveEntries(D, dt) {
    release(D, dt);
    for (const col of D.cols) {
      const a = col.e;
      for (let i = 0; i < a.length; i++) {
        const e = a[i];
        if (e.ph === 'up') { e.yoff = Math.min(0, e.yoff + 1.4 * dt); if (e.yoff >= 0) e.ph = 'park'; }
        if (Math.abs(e.lz - col.z) > 1e-3) { e.lz += WW.clamp(col.z - e.lz, -2 * dt, 2 * dt); continue; } // taxi across first
        if (e.ph !== 'in' && !e.go) continue;                                       // parked: still until the handlers reach it
        const tv = e.ph === 'in' ? (e.lx < D.k.barrier + e.len ? TAXI * 2.2 : TAXI) : D.doc.push;   // clear of the wires under power, then the handlers push it
        let nx = e.lx + WW.clamp(e.tx - e.lx, -tv * dt, tv * dt);
        if (nx > e.lx && i > 0) nx = Math.min(nx, Math.max(e.lx, a[i - 1].lx - (a[i - 1].len + e.len) / 2 - GAP * 0.6));
        if (nx < e.lx && i < a.length - 1) nx = Math.max(nx, Math.min(e.lx, a[i + 1].lx + (a[i + 1].len + e.len) / 2 + GAP * 0.6));
        for (const o of D.loose) { // a plane going down the elevator (or taxiing to it) still blocks the column
          if (Math.abs(o.lz - e.lz) > 1.8 || o.yoff < -2) continue;
          const sep = (o.len + e.len) / 2 + GAP * 0.6;
          if (o.lx < e.lx && nx < e.lx) nx = Math.max(nx, Math.min(e.lx, o.lx + sep));
          if (o.lx > e.lx && nx > e.lx) nx = Math.min(nx, Math.max(e.lx, o.lx - sep));
        }
        e.lx = nx;
        if (e.ph === 'in' && Math.abs(e.lx - e.tx) < 0.05) e.ph = 'park';
      }
    }
    for (let i = D.loose.length - 1; i >= 0; i--) { // to the elevator, then struck below
      const e = D.loose[i];
      if (e.ph === 'elev') {
        const ex = e.ex === undefined ? D.k.elevX : e.ex;
        e.lz += WW.clamp(0 - e.lz, -2 * dt, 2 * dt);
        const v = e.pw && e.lx < D.k.barrier + e.len ? TAXI * 2.2 : TAXI;   // under power clear of the wires
        e.lx += WW.clamp(ex - e.lx, -v * dt, v * dt);
        if (Math.abs(e.lz) < 0.02 && Math.abs(e.lx - ex) < 0.05) e.ph = 'down';
      } else if ((e.yoff -= 1.4 * dt) < -2.4) { giveBack(e.m); D.loose.splice(i, 1); }
    }
  }
  function syncEntry(D, e, now, dt) {
    e.fold = Math.min(1, e.fold + 0.8 * dt);
    setFold(e.m, e.fold);
    e.m.group.position.set(e.lx, D.top + P().deckY + e.yoff, e.lz);
    if (e.m.payload) e.m.payload.visible = e.kind !== 'fighter' && now >= e.readyAt;
  }

  // Deck lifecycle per carrier: fill, mode, reconcile with hangar counts, re-spot.
  function updateDeck(D, dt, setup) {
    const c = D.c, now = WW.time.now;
    D.top = c.model.deck ? c.model.deck.position.y : 2;
    D.dy = c.group.position.y + D.top;
    if (!D.filled) { // spot the hangar on deck, fighters forward, wings folded
      D.filled = true;
      const t = counts(c), probe = P().get('fighter', c.nation);
      D.fold = !!(probe.wingL && probe.wingR); giveBack(probe);
      const order = [];
      const f0 = Math.min(2, t.fighter); // one fighter at the head of each column, bombers behind, spare fighters last
      for (let i = 0; i < f0; i++) order.push('fighter');
      for (let i = 0; i < Math.max(t.dive, t.torpedo); i++) { if (i < t.dive) order.push('dive'); if (i < t.torpedo) order.push('torpedo'); }
      for (let i = f0; i < t.fighter; i++) order.push('fighter');
      for (const k of order) { const col = colFor(D, k, lenOf(k)); if (col) col.e.push(newEntry(D, P().get(k, c.nation), k, 0, col.z, 1, 0, 'park')); }
      pack(D);
      for (const col of D.cols) for (const e of col.e) e.lx = e.tx;
    }
    if (!c.alive || setup) { for (const col of D.cols) for (const e of col.e) syncEntry(D, e, now, dt); return; }
    // who needs the deck
    D.launchers = D.launchers.filter(p => p.alive && !p.removed && p.state === 'takeoff' && p.carrier === c);
    D.lq = D.lq.filter(p => p.alive && !p.removed && p.state === 'landing' && p.carrier === c);
    let recPend = D.lq.length > 0, landAct = false;
    for (const p of WW.world.planes) {
      if (p.carrier !== c || !p.alive) continue;
      if (p.state === 'rollout' || (p.state === 'landing' && p.deckPh === 'final')) landAct = true;
      if (p.state === 'return' && WW.dist(p.x, p.z, c.x, c.z) < 140) recPend = true;
    }
    for (const col of D.cols) for (const e of col.e) if (e.ph === 'in' && e.lx - e.len / 2 < D.k.barrier) landAct = true;
    if (D.loose.some(e => fouls(D, e))) landAct = true;
    const launchAct = D.launchers.some(p => p.deckPh !== 'queued');
    const launchPend = D.launchers.length > 0;
    // A strike load or a scramble (raid near) may break into a recovery; a CAP relief waits for the stack to clear
    const urgent = !launchPend ? false : c._air && c._air.near > 0 && D.launchers.some(p => !p.target) ? 'scramble' : D.launchers.some(p => p.target) || (c._air && c._air.near > 0);
    let lqWait = 0; for (const p of D.lq) lqWait = Math.max(lqWait, now - (p.lqT === undefined ? now : p.lqT));
    // Hysteresis: a deck spotted for launch is not pushed forward for a short recovery. The first few back hold in
    // the stack (DEFER_N in the pattern, or the first held DEFER_WAIT s, or one short of fuel) unless only
    // DEFER_FREE planes or fewer stand in the landing area.
    D.blk = 0; for (const col of D.cols) for (const e of col.e) if (e.ph !== 'in' && e.lx - e.len / 2 < D.k.barrier) D.blk++; // parked in the landing area
    if (recPend && D.mode !== 'recover' && D.spot === 'aft' && !c.deckOut && lqWait < DEFER_WAIT && D.lq.length < DEFER_N && !D.lq.some(q => q.fuel < DEFER_FUEL) && D.blk > DEFER_FREE) recPend = false;
    const ready = settled(D);   // the deck re-spotted for the window it is in: the window clocks run from here
    D.waitT = launchPend && D.mode !== 'launch' ? D.waitT + (ready || D.spot !== 'fwd' ? dt : 0) : 0;
    D.winT += ready ? dt : 0;
    // Windows: a launch window runs until the launch queue is empty (returning planes hold in the marshal stack),
    // unless planes have held LQ_MAX s; a recovery window takes up to RW_N traps while launches wait, then yields
    // (the plane in the groove lands first). Nothing waiting: recover if anyone is home, else idle (spotted for launch).
    const prev = D.mode;
    if (D.mode === 'launch' && launchPend && !(recPend && lqWait > (D.lq.length >= DEEP && urgent !== 'scramble' ? LQ_DEEP : LQ_MAX) && !launchAct && D.winT > LW_MIN)) { /* keep the launch window */ }
    else if (D.mode === 'recover' && (landAct || (recPend && !yieldRec(D, urgent)))) { /* keep */ }
    else D.mode = launchPend ? 'launch' : recPend ? 'recover' : 'idle';
    if (c.deckOut) D.mode = 'idle';   // holed (ship_deck.js): nothing launches or lands; the queued wait below, the stack holds
    if (D.mode !== prev) { D.recN = 0; D.modeT = now; D.winT = 0; }
    // where the park should be: forward for a recovery at once; aft for a launch at once, but idle only after
    // idleHold s (no re-spot for a gap between returning flights)
    D.idleT = D.mode === 'idle' ? D.idleT + dt : 0;
    const want = D.mode === 'recover' ? 'fwd' : 'aft';
    if (want !== D.spot && (want === 'fwd' || D.mode === 'launch' || D.idleT > D.doc.idleHold)) D.spot = want;
    D.closing = D.mode === 'recover' && yieldRec(D, urgent); // no new approaches: the window is closing
    // reconcile what is shown with what the carrier holds (launched from below / rearm counts)
    const t = counts(c), vis = { fighter: 0, dive: 0, torpedo: 0 };
    for (const col of D.cols) for (const e of col.e) vis[e.kind]++;
    for (const k in vis) if (vis[k] > t[k]) {
      for (const col of D.cols) for (let i = col.e.length - 1; i >= 0 && vis[k] > t[k]; i--) {
        const e = col.e[i];
        if (e.kind === k && e.ph === 'park') { col.e.splice(i, 1); e.ph = 'down'; D.loose.push(e); vis[k]--; }
      }
    }
    D.riseT -= dt;
    // bring one up from the hangar deck: while idle, and while launching (the next load is spotted as the first goes;
    // not while a plane taxis up the deck or rides the forward elevator)
    // (the USN pre-spots the next deck load while idle; the IJN brings up only the planes ordered off, in the launch)
    const spotting = !c.deckOut && D.spot === 'aft' && ((D.mode === 'idle' && D.doc.preSpot) || (D.mode === 'launch' && !D.launchers.some(q => q.deckPh === 'taxi' || q.deckPh === 'rise')));
    let want2 = t;
    if (!D.doc.preSpot) { want2 = { fighter: 0, dive: 0, torpedo: 0 }; for (const q of D.launchers) if (q.deckPh === 'queued') want2[q.kind]++; }
    if (spotting && D.riseT <= 0) {
      D.riseT = 1.6;
      for (const k of ['fighter', 'dive', 'torpedo']) {
        if (vis[k] >= Math.min(t[k], want2[k])) continue;
        const col = colFor(D, k, lenOf(k));
        if (!col || col.e.some(q => Math.abs(q.lx - q.tx) > 0.05 || Math.abs(q.lz - col.z) > 1e-3)) continue;
        const e = newEntry(D, P().get(k, c.nation), k, 0, col.z, 1, 0, 'up');
        col.e.unshift(e); pack(D); e.lx = e.tx;
        break;
      }
    }
    if (D.doc.strike && D.spot === 'fwd' && D.mode !== 'launch' && !c.deckOut) strikeBelow(D);
    pack(D);
    moveEntries(D, dt);
    for (const col of D.cols) for (const e of col.e) syncEntry(D, e, now, dt);
    for (const e of D.loose) syncEntry(D, e, now, dt);
  }
  // A plane on its way to an elevator (or riding it down) aft of the barrier fouls the landing area.
  function fouls(D, e) { return e.ph === 'elev' && e.lx - e.len / 2 < D.k.barrier; }
  // IJN (DOC strike): recovered planes are struck below by the elevator nearest the forward park (the aftmost one
  // forward of the barrier), one at a time: the rearmost plane of a column (just out of the wires, or parked and at
  // rest), whose way to the elevator along the deck is clear of the others in its column.
  function strikeBelow(D) {
    const els = D.k.elevators; if (!els || !els.length) return;
    let ex = null; for (const x of els) { const L = lenOf('torpedo'); if (x - L / 2 > D.k.barrier + 0.1 && (ex === null || x < ex)) ex = x; }
    if (ex === null || D.loose.some(e => e.ex === ex && e.yoff > -2.4)) return;   // the elevator is busy
    // a plane just out of the wires taxis straight onto it under power; one parked is pushed there only while the
    // deck is quiet (not across the taxi way while a plane is in the groove, rolling out or taxiing in: it would hold
    // that one aft of the barrier, the deck foul)
    let quiet = !D.lq.some(q => q.deckPh === 'final') && !D.cols.some(col => col.e.some(e => e.ph === 'in'));
    if (quiet) for (const q of WW.world.planes) if (q.carrier === D.c && q.alive && q.state === 'rollout') { quiet = false; break; }
    for (const col of D.cols) {
      const a = col.e, e = a[a.length - 1];
      if (!e || e.go || !(e.ph === 'in' || (quiet && e.ph === 'park' && Math.abs(e.tx - e.lx) <= SETTLE))) continue;
      const lo = Math.min(e.lx, ex), hi = Math.max(e.lx, ex);
      if (a.some(o => o !== e && o.lx - o.len / 2 < hi + e.len / 2 + GAP / 2 && o.lx + o.len / 2 > lo - e.len / 2 - GAP / 2)) continue;
      a.pop(); e.pw = e.ph === 'in'; e.ph = 'elev'; e.ex = ex; D.loose.push(e);
      return;
    }
  }
  // Does the recovery window give the deck to the launches waiting below? A strike or a scramble after RW_N traps
  // (or LW_MAX s); a CAP relief once the stack is down to one, or after LW_RELIEF s.
  // A strike back in the stack (DEEP or more waiting) is landed before the next load is spotted (it is the next
  // strike, and the fighters in it are the next CAP): RW_DEEP traps or LW_DEEP s; a scramble still goes after RW_N.
  function yieldRec(D, urgent) {
    if (!D.launchers.length) return false;
    if (urgent && urgent !== 'scramble' && D.lq.length >= DEEP) return D.recN >= RW_DEEP || D.waitT > LW_DEEP;
    if (urgent) return D.recN >= RW_N || D.waitT > LW_MAX;
    return D.lq.length < 2 || D.waitT > LW_RELIEF;
  }
  // Is the landing area (aft of the barrier) and the runway clear?
  function clearAft(D) {
    if (D.mode !== 'recover' || D.loose.some(e => fouls(D, e))) return false;
    for (const col of D.cols) for (const e of col.e) if (e.lx - e.len / 2 < D.k.barrier) return false;
    for (const p of WW.world.planes) if (p.carrier === D.c && p.alive && p.state === 'rollout') return false;
    return !D.launchers.some(p => p.deckPh !== 'queued');
  }

  // Is the launch spot (on the runway at the launch point) taken by another plane holding, rising or starting its run?
  function spotBusy(D, p) {
    for (const q of D.launchers) if (q !== p && (q.deckPh === 'hold' || q.deckPh === 'rise' || (q.deckPh === 'taxi' && q.lx > p.lx) || (q.deckPh === 'run' && q.lx < D.k.launchX + (p.deckPh === 'queued' ? 1 : 4)))) return true; // the elevator can start up as the run begins
    return false;
  }
  // Is everything parked behind the spot line (the runway ahead of the launch point clear)?
  function spotClear(D) {
    for (const col of D.cols) for (const e of col.e) if (e.lx + e.len / 2 > D.k.aftFront + 0.05) return false;
    for (const e of D.loose) if (e.yoff > -2 && e.lx + e.len / 2 > D.k.aftFront + 0.05) return false;
    return true;
  }
  // A plane on the deck in world space: position from deck coords (integrate() adds speed * dt after us).
  function onDeck(p, D, lx, lz, yoff, yaw, rel, dt) {
    const c = D.c, w = c.toWorld(lx, lz);
    p.heading = c.heading + yaw; p.speed = c.speed + rel; p.vy = 0; p.turn = 0;
    p.x = w[0] - Math.cos(p.heading) * p.speed * dt; p.z = w[1] - Math.sin(p.heading) * p.speed * dt;
    p.y = D.dy + P().deckY + yoff;
  }
  function adopt(p, m) { // swap the plane onto a parked model
    giveBack(p.model);
    WW.scene.add(m.group);
    p.model = m; p.group = m.group; p.prop = m.prop; p.payload = m.payload || null;
    if (p.payload) p.payload.visible = p.ordnance;
  }
  function intoWind() { return WW.wind ? WW.wind.a + PI : null; }

  WW.airDeck = {
    update(dt) {
      const setup = WW.game && WW.game.state === 'setup';
      for (const s of WW.world.ships) if (s.type === 'carrier' && s.hangar && !s.removed) deckOf(s);
      for (let i = decks.length - 1; i >= 0; i--) {
        const D = decks[i];
        if (D.c.removed && !D.c.wreck) { this.drop(D); decks.splice(i, 1); continue; }
        if (D.c.alive || !D.done) { updateDeck(D, dt, setup); if (!D.c.alive) D.done = true; }
      }
    },
    drop(D) {
      for (const col of D.cols) { for (const e of col.e) giveBack(e.m); col.e.length = 0; }
      for (const e of D.loose) giveBack(e.m);
      D.loose.length = 0; D.c._deck = null;
    },
    clearAll() { for (const D of decks) this.drop(D); decks.length = 0; },
    parkedCount() { let n = 0; for (const D of decks) { n += D.loose.length; for (const col of D.cols) n += col.e.length; } return n; },
    deck: deckOf,
    unfold(m) { setFold(m, 0); }, // Plane.remove(): a plane lost on deck goes back to the pool unfolded
    // One deck spot: how many planes fit aft of the spot line at the current plane scale (both columns, wings folded;
    // one column when they cannot fold). air_boss.js sizes strikes from it (a strike is one or two deck loads).
    spotCap(c) {
      const D = deckOf(c), L = lenOf('dive') + GAP, n = Math.max(1, Math.floor((D.k.aftFront - D.k.stern + GAP) / L));
      return n * (D.fold ? D.cols.length : 1);
    },
    // The kinds spotted at the head of a column, ready to taxi (air_boss.js launches those first).
    heads(c) {
      const D = c._deck; if (!D) return null;
      const h = {};
      for (const col of D.cols) { const e = col.e[0]; if (e && e.ph === 'park' && WW.time.now >= e.readyAt) h[e.kind] = true; }
      return h;
    },
    _k: { deckOf, toLocal, lenOf, colFor, newEntry, pack, clearAft, setFold, P, decks, REF },

    // carrierAI hook: into the wind while planes launch or come aboard (separation still applies after this).
    steer(ship, late) {
      const D = ship._deck, h = intoWind();
      if (!D || late || h === null || !(D.mode !== 'idle' || D.launchers.length || D.lq.length)) return;
      const E = 80, W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H; // near the map edge: no wind turn (the standing CAP keeps the deck busy)
      if (ship.x < E || ship.x > W - E || ship.z < E || ship.z > Hh - E) return;
      const a = ship.ai, w = a && a.threat && a.threatD < 160 ? 0.5 : 2.5, dh = ship.desiredHeading;
      if (a && a.thrT === WW.time.now && a.thrD < WIND_FOE && Math.abs(WW.angleDiff(h, a.thrB)) < 1.2) return; // the wind blows from the enemy: no turn toward a known gun ship (ai_carrier.js thrB)
      const foe = a && a.thrT === WW.time.now && a.thrD < HOLD_FOE;   // a known gun ship near: no course held for the planes
      if (!foe && (D.lq.some(p => p.deckPh === 'app' || p.deckPh === 'final') || D.launchers.some(p => p.deckPh === 'run'))) { ship.desiredHeading = ship.heading; ship.throttle = Math.max(ship.throttle, 0.75); return; } // a steady deck under a plane in the groove or on its run
      ship.desiredHeading = Math.atan2(Math.sin(dh) + Math.sin(h) * w, Math.cos(dh) + Math.cos(h) * w);
      ship.throttle = Math.max(ship.throttle, 0.75);
    },

    launched(p) {
      const D = deckOf(p.carrier);
      p.deckPh = 'queued'; p.deckT = 0; p.lx = D.k.launchX; p.lz = D.run; p.rel = 0; p.yoff = -2.6; p.fold = 1;
      D.launchers.push(p);
      setFold(p.model, 1); // folded, in the hangar below the launch point
      onDeck(p, D, p.lx, p.lz, p.yoff, 0, 0, 0); p.sync(0);
    },
    takeoff(p, dt) {
      const c = p.carrier, D = deckOf(c);
      p.deckT += dt;
      switch (p.deckPh) {
        case 'queued': { // in the hangar until the deck is in launch mode and it is this plane's turn (one taxiing at a time)
          if (D.mode !== 'launch' || D.launchers.some(q => q !== p && (q.deckPh === 'taxi' || q.deckPh === 'rise'))) break;
          if (D.launchers.find(q => q.deckPh === 'queued') !== p) break; // first come, first up
          if (!spotClear(D)) break;
          let pick = null, pc = null;
          for (const col of D.cols) { const e = col.e[0]; if (e && e.kind === p.kind && e.ph === 'park' && WW.time.now >= e.readyAt && Math.abs(e.lx - e.tx) < 0.1) { pick = e; pc = col; break; } }
          if (pick) { pc.e.shift(); adopt(p, pick.m); p.lx = pick.lx; p.lz = pick.lz; p.fold = pick.fold; p.yoff = 0; p.deckPh = 'taxi'; }
          else if (!spotBusy(D, p)) p.deckPh = 'rise'; // nothing suitable spotted: up on the elevator at the launch point
          break;
        }
        case 'rise': p.yoff = Math.min(0, p.yoff + 4 * dt); if (p.yoff > -0.4) p.fold = Math.max(0, p.fold - 1.5 * dt); if (p.yoff >= 0) p.deckPh = 'hold'; break;
        case 'taxi': { // forward along its column (folded, clear of the island), hold short while the launch spot is taken, then onto the runway
          const stop = spotBusy(D, p) ? D.k.launchX - 3.4 : D.k.launchX;
          if (p.lx < stop) { p.lx = Math.min(stop, p.lx + TAXI * 2.2 * dt); if (stop - p.lx < 3) p.fold = Math.max(0.35, p.fold - 1.2 * dt); }
          else if (stop < D.k.launchX) p.fold = Math.max(0.35, p.fold - 1.2 * dt);   // spreading the wings while it waits
          else if (Math.abs(p.lz - D.run) > 1e-3) p.lz += WW.clamp(D.run - p.lz, -3 * dt, 3 * dt);
          else p.deckPh = 'hold';
          break;
        }
        case 'hold': { // spread the wings; go when the ship is into the wind (or has tried long enough) and the deck ahead is clear
          p.fold = Math.max(0, p.fold - 2.5 * dt);
          const h = intoWind();
          if (c.deckOut || D.launchers.some(q => q !== p && q.deckPh === 'run' && q.lx < D.k.launchX + 4)) break;
          if (p.fold <= 0 && (h === null || Math.abs(WW.angleDiff(c.heading, h)) < 0.35 || p.deckT > 5)) { p.deckPh = 'run'; p.rel = 0; }
          break;
        }
        case 'run':
          p.rel += 21 * dt; p.lx += p.rel * dt;
          // Off the bow at the take-off speed (the carrier's speed into the wind plus the run), and free from this step on:
          // integrate() carries it on at that speed, level (vy 0), from where the last deck step left it. (It used to fall
          // through to onDeck() below with the phase already 'climb', so rel 0: one step at the CARRIER's speed, then a
          // 1-2 s crawl back up at speedTo's 8 u/s^2, the nose dropping ~10 deg and the prop back to blades: air_fx.js.)
          if (p.lx >= D.k.bow) { p.deckPh = 'climb'; p.deckT = 0; p.speed = c.speed + p.rel; p.vy = 0; p.turn = 0; return; }
          break;
        case 'climb': // off the bow: settle a little, then climb away, never slower than it left the deck
          p.turn = 0; p.speedTo(Math.max(p.speed, p.pt.speed * 0.9), dt);
          if (p.deckT < 0.6) p.vy += WW.clamp(-1.2 - p.vy, -6 * dt, 6 * dt);
          else p.vy += WW.clamp(5 - p.vy, -6 * dt, 6 * dt);
          if (p.y < 1.2) { p.y = 1.2; p.vy = Math.max(0, p.vy); }
          if (p.y > D.dy + 10) { p.state = 'transit'; p.deckPh = null; }
          return;
      }
      setFold(p.model, p.fold || 0);
      onDeck(p, D, p.lx, p.lz, p.yoff, 0, p.deckPh === 'run' ? p.rel : 0, dt);
    },
  };
})();
