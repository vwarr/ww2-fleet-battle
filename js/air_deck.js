// air_deck.js — the flight deck (WW.airDeck): parked planes with folded wings, re-spotting, the
// launch run, the into-the-wind turn, the landing pattern queue, the trap and taxi back to the park.
// aircraft.js delegates Plane.takeoff / goHome / landing / rollout here. Deck coordinates are carrier
// local: lx along the deck (bow +x), lz across it. Parked models are children of the carrier group.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI;
  const STERN = -13.55, BOW = 12.85, AFT_FRONT = 0.6, BARRIER = -1.5; // deck ends / spot limit / barrier
  const LAUNCH_X = 3.2, TD_X = -9.5, ELEV_X = -5.5;   // start of the deck run, touchdown point, aft elevator
  const GAP = 0.2, TAXI = 3, FOLD = 1.75;          // spacing between parked planes, taxi speed, fold angle
  const decks = [];                                 // every deck made this round (sunk carriers too)
  const P = () => WW.air._pool;

  // ---- helpers ----
  function toLocal(c, x, z) {
    const dx = x - c.x, dz = z - c.z, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
    return [dx * ch + dz * sh, -dx * sh + dz * ch];
  }
  function lenOf(kind) { return ({ fighter: 2.48, dive: 2.68, torpedo: 2.78 }[kind] || 2.6) * P().scale; }
  // Wing fold: wingL / wingR pivot at the wing root; rotation.x lifts the tip (side from the pivot's z).
  function setFold(m, f) {
    if (!m.wingL || !m.wingR || m._fold === f) return;
    m._fold = f;
    const a = FOLD * f * f * (3 - 2 * f);
    for (const w of [m.wingL, m.wingR]) {
      const z = w.position.z, side = z > 1e-3 ? 1 : z < -1e-3 ? -1 : (w === m.wingL ? -1 : 1);
      w.rotation.x = -side * a;
    }
  }
  function giveBack(m) { // back to the pool: unfolded, visible, out of any carrier group
    setFold(m, 0); m.group.visible = true;
    if (m.group.parent) m.group.parent.remove(m.group);
    P().release(m);
  }
  function deckOf(c) {
    if (c._deck) return c._deck;
    const s = c.nation === 'IJN' ? -1 : 1; // island side (USN starboard, IJN port)
    const D = { c, s, run: -s * 1.05, cols: [{ z: s * 0.68, e: [] }, { z: -s * 1.2, e: [] }], loose: [],
      mode: 'idle', launchers: [], lq: [], riseT: 1, waitT: 0, recT: 0, filled: false, dy: 2, fold: true };
    c._deck = D; decks.push(D);
    return D;
  }
  function fits(D, col, extra) { // does the column (plus an extra length) fit the spot / the forward park?
    let L = extra || 0;
    for (const e of col.e) L += e.len;
    L += GAP * Math.max(0, col.e.length - (extra ? 0 : 1));
    return L <= (D.mode === 'recover' ? BOW - BARRIER : AFT_FRONT - STERN);
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
  function counts(c) {
    const t = { fighter: c.hangar.fighter, dive: c.hangar.dive, torpedo: c.hangar.torpedo };
    if (c.rearm) for (const r of c.rearm) t[r.kind]++;
    return t;
  }

  // Pack each column toward the stern (spot for launch) or toward the bow (park while recovering).
  function pack(D) {
    const fwd = D.mode === 'recover';
    for (const col of D.cols) {
      while (col.e.length && !fits(D, col, 0)) { const e = col.e.pop(); e.ph = 'down'; D.loose.push(e); }
      const n = col.e.length;
      if (fwd) { let x = BOW; for (let i = 0; i < n; i++) { const e = col.e[i]; e.tx = x - e.len / 2; x -= e.len + GAP; } }
      else { let x = STERN; for (let i = n - 1; i >= 0; i--) { const e = col.e[i]; e.tx = x + e.len / 2; x += e.len + GAP; } }
    }
  }
  function moveEntries(D, dt) {
    for (const col of D.cols) {
      const a = col.e;
      for (let i = 0; i < a.length; i++) {
        const e = a[i];
        if (e.ph === 'up') { e.yoff = Math.min(0, e.yoff + 1.4 * dt); if (e.yoff >= 0) e.ph = 'park'; }
        if (Math.abs(e.lz - col.z) > 1e-3) { e.lz += WW.clamp(col.z - e.lz, -2 * dt, 2 * dt); continue; } // taxi across first
        let nx = e.lx + WW.clamp(e.tx - e.lx, -TAXI * dt, TAXI * dt);
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
        e.lz += WW.clamp(0 - e.lz, -2 * dt, 2 * dt);
        e.lx += WW.clamp(ELEV_X - e.lx, -TAXI * dt, TAXI * dt);
        if (Math.abs(e.lz) < 0.02 && Math.abs(e.lx - ELEV_X) < 0.05) e.ph = 'down';
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
      if (p.state === 'rollout' || (p.state === 'landing' && (p.deckPh === 'final' || p.deckPh === 'base'))) landAct = true;
      if (p.state === 'return' && WW.dist(p.x, p.z, c.x, c.z) < 140) recPend = true;
    }
    for (const col of D.cols) for (const e of col.e) if (e.ph === 'in' && e.lx - e.len / 2 < BARRIER) landAct = true;
    if (D.loose.some(e => e.ph === 'elev')) landAct = true;
    const launchAct = D.launchers.some(p => p.deckPh !== 'queued');
    const launchPend = D.launchers.length > 0;
    D.waitT = launchPend && D.mode !== 'launch' ? D.waitT + dt : 0;
    if (D.mode === 'launch' && launchAct) { /* keep */ }
    else if (D.mode === 'recover' && landAct) { /* keep */ }
    else if (recPend && !(launchPend && D.waitT > 20)) D.mode = 'recover';
    else D.mode = launchPend ? 'launch' : 'idle';
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
    if (D.mode === 'idle' && D.riseT <= 0) { // bring one up from the hangar deck
      D.riseT = 1.6;
      for (const k of ['fighter', 'dive', 'torpedo']) {
        if (vis[k] >= t[k]) continue;
        const col = colFor(D, k, lenOf(k));
        if (!col || col.e.some(q => Math.abs(q.lx - q.tx) > 0.05 || Math.abs(q.lz - col.z) > 1e-3)) continue;
        const e = newEntry(D, P().get(k, c.nation), k, 0, col.z, 1, 0, 'up');
        col.e.unshift(e); pack(D); e.lx = e.tx;
        break;
      }
    }
    pack(D);
    moveEntries(D, dt);
    for (const col of D.cols) for (const e of col.e) syncEntry(D, e, now, dt);
    for (const e of D.loose) syncEntry(D, e, now, dt);
  }
  // Is the landing area (aft of the barrier) and the runway clear?
  function clearAft(D) {
    if (D.mode !== 'recover' || D.loose.some(e => e.ph === 'elev')) return false;
    for (const col of D.cols) for (const e of col.e) if (e.lx - e.len / 2 < BARRIER) return false;
    for (const p of WW.world.planes) if (p.carrier === D.c && p.alive && p.state === 'rollout') return false;
    return !D.launchers.some(p => p.deckPh !== 'queued');
  }

  // Is everything parked behind the spot line (the runway ahead of the launch point clear)?
  function spotClear(D) {
    for (const col of D.cols) for (const e of col.e) if (e.lx + e.len / 2 > AFT_FRONT + 0.05) return false;
    for (const e of D.loose) if (e.yoff > -2 && e.lx + e.len / 2 > AFT_FRONT + 0.05) return false;
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

    // carrierAI hook: into the wind while planes launch or come aboard (separation still applies after this).
    steer(ship, late) {
      const D = ship._deck, h = intoWind();
      if (!D || late || h === null || !(D.mode !== 'idle' || D.launchers.length || D.lq.length)) return;
      const a = ship.ai, w = a && a.threat && a.threatD < 160 ? 0.5 : 2.5, dh = ship.desiredHeading;
      ship.desiredHeading = Math.atan2(Math.sin(dh) + Math.sin(h) * w, Math.cos(dh) + Math.cos(h) * w);
      ship.throttle = Math.max(ship.throttle, 0.75);
    },

    launched(p) {
      const D = deckOf(p.carrier);
      p.deckPh = 'queued'; p.deckT = 0; p.lx = LAUNCH_X; p.lz = D.run; p.rel = 0; p.yoff = -2.6; p.fold = 1;
      D.launchers.push(p);
      setFold(p.model, 1); // folded, in the hangar below the launch point
      onDeck(p, D, p.lx, p.lz, p.yoff, 0, 0, 0); p.sync(0);
    },
    takeoff(p, dt) {
      const c = p.carrier, D = deckOf(c);
      p.deckT += dt;
      switch (p.deckPh) {
        case 'queued': { // in the hangar until the deck is in launch mode and it is this plane's turn
          if (D.mode !== 'launch' || D.launchers.some(q => q !== p && (q.deckPh === 'taxi' || q.deckPh === 'rise' || q.deckPh === 'hold'))) break;
          if (D.launchers.some(q => q.deckPh === 'run' && q.lx < LAUNCH_X + 5.2)) break;
          if (!spotClear(D)) break;
          let pick = null, pc = null;
          for (const col of D.cols) { const e = col.e[0]; if (e && e.kind === p.kind && e.ph === 'park' && WW.time.now >= e.readyAt && Math.abs(e.lx - e.tx) < 0.1) { pick = e; pc = col; break; } }
          if (pick) { pc.e.shift(); adopt(p, pick.m); p.lx = pick.lx; p.lz = pick.lz; p.fold = pick.fold; p.yoff = 0; p.deckPh = 'taxi'; }
          else p.deckPh = 'rise'; // nothing suitable spotted: up on the elevator at the launch point
          break;
        }
        case 'rise': p.yoff = Math.min(0, p.yoff + 3 * dt); if (p.yoff > -0.4) p.fold = Math.max(0, p.fold - 1.5 * dt); if (p.yoff >= 0) p.deckPh = 'hold'; break;
        case 'taxi': // forward along its column (folded, clear of the island), then across onto the runway
          if (p.lx < LAUNCH_X) p.lx = Math.min(LAUNCH_X, p.lx + TAXI * 1.5 * dt);
          else if (Math.abs(p.lz - D.run) > 1e-3) p.lz += WW.clamp(D.run - p.lz, -2 * dt, 2 * dt);
          else p.deckPh = 'hold';
          break;
        case 'hold': { // spread the wings; go when the ship is into the wind (or has tried long enough)
          p.fold = Math.max(0, p.fold - 1.5 * dt);
          const h = intoWind();
          if (p.fold <= 0 && (h === null || Math.abs(WW.angleDiff(c.heading, h)) < 0.35 || p.deckT > 7)) { p.deckPh = 'run'; p.rel = 0; }
          break;
        }
        case 'run':
          p.rel += 18 * dt; p.lx += p.rel * dt;
          if (p.lx >= BOW) { p.deckPh = 'climb'; p.deckT = 0; p.vy = -1.8; p.speed = c.speed + p.rel; }
          break;
        case 'climb': // off the bow: settle a little, then climb away
          p.turn = 0; p.speedTo(p.pt.speed * 0.9, dt);
          if (p.deckT < 0.6) p.vy += WW.clamp(-1.2 - p.vy, -6 * dt, 6 * dt);
          else p.vy += WW.clamp(5 - p.vy, -6 * dt, 6 * dt);
          if (p.y < 1.2) { p.y = 1.2; p.vy = Math.max(0, p.vy); }
          if (p.y > D.dy + 10) { p.state = 'transit'; p.deckPh = null; }
          return;
      }
      setFold(p.model, p.fold || 0);
      onDeck(p, D, p.lx, p.lz, p.yoff, 0, p.deckPh === 'run' ? p.rel : 0, dt);
    },

    goHome(p, dt) {
      const c = p.carrier, d = WW.dist(p.x, p.z, c.x, c.z);
      p.foe = null;
      p.fly(c.x, c.z, d > 120 ? 25 : 20, dt, p.pt.speed);
      if (d < 110) { const D = deckOf(c); p.state = 'landing'; p.deckPh = 'hold'; p.phT = 0; if (D.lq.indexOf(p) < 0) D.lq.push(p); }
    },

    // Pattern: marshal stack -> initial -> upwind over the deck -> break -> downwind -> base -> final -> trap.
    landing(p, dt) {
      const c = p.carrier, D = deckOf(c), ps = -D.s, L = toLocal(c, p.x, p.z), lx = L[0], lz = L[1];
      let i = D.lq.indexOf(p); if (i < 0) { D.lq.push(p); i = D.lq.length - 1; }
      p.phT = (p.phT || 0) + dt;
      const to = (ax, az, alt, spd, rate) => { const w = c.toWorld(ax, az); return p.fly(w[0], w[1], alt, dt, spd, rate); };
      const busy = q => q.deckPh === 'base' || q.deckPh === 'final';
      switch (p.deckPh) {
        case 'hold': { // stacked over the carrier, higher for each plane in the queue
          const a = Math.atan2(p.z - c.z, p.x - c.x) + 0.45, r = 48 + 7 * Math.min(i, 4);
          p.fly(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 20 + 4 * Math.min(i, 4), dt, p.pt.speed * 0.75);
          const prev = D.lq[i - 1], inPat = D.lq.slice(0, i).length;
          if (D.mode === 'recover' && inPat < 3 && (!prev || (prev.deckPh !== 'hold' && prev.deckPh !== 'initial' && prev.deckPh !== 'upwind'))) { p.deckPh = 'initial'; p.phT = 0; }
          break;
        }
        case 'initial':
          to(-45, ps * 5, 14, p.pt.speed * 0.8, 1.4);
          if (WW.dist(lx, lz, -45, ps * 5) < 14 || (lx < -30 && Math.abs(lz) < 15)) { p.deckPh = 'upwind'; p.phT = 0; }
          break;
        case 'upwind': to(Math.max(lx + 25, 10), ps * 5, 12, p.pt.speed * 0.75, 1.4); if (lx > 15) { p.deckPh = 'break'; p.phT = 0; } break;
        case 'break': to(lx - 4, ps * 30, 10, p.pt.speed * 0.7, 1.8); if (lz * ps > 22) { p.deckPh = 'downwind'; p.phT = 0; } break;
        case 'downwind': // abeam and past the ship; turn in when the groove is free, else extend downwind
          to(lx - 25, ps * 28, 7, p.pt.speed * 0.62, 1.6);
          if (lx < -16 && D.mode === 'recover' && !D.lq.some(q => q !== p && busy(q))) { p.deckPh = 'base'; p.phT = 0; }
          else if (lx < -80) { p.deckPh = 'initial'; p.phT = 0; } // waited too long: go round again
          break;
        case 'base':
          to(-52, ps * 5, 5, p.pt.speed * 0.6, 1.9);
          if (lx < -45 || WW.dist(lx, lz, -52, ps * 5) < 12) { p.deckPh = 'final'; p.phT = 0; p._lz = undefined; } // the final turn flies it onto the centreline
          else if (p.phT > 14) { p.deckPh = 'initial'; p.phT = 0; }
          break;
        case 'final': {
          const vlz = dt > 0 && p._lz !== undefined ? (lz - p._lz) / dt : 0; p._lz = lz; // fly the runway centreline (PD on the drift)
          p.turnTo(c.heading - WW.clamp((lz - D.run) * 0.15 + vlz * 0.12, -0.8, 0.8), dt, 2.2);
          const togo = TD_X - lx, ty = D.dy + P().deckY + WW.clamp(togo * 0.13, 0, 8);
          p.speed += WW.clamp(c.speed + WW.clamp(togo * 0.25, 9, 15) - p.speed, -8 * dt, 8 * dt);
          p.vy = WW.clamp((ty - p.y) * 2.5 - 0.13 * (p.speed - c.speed), -6, 4);
          const tw = c.toWorld(TD_X, D.run), dh = WW.dist(p.x, p.z, tw[0], tw[1]), b = Math.atan2(tw[1] - p.z, tw[0] - p.x);
          let wave = false;
          if (togo < 28 && togo > 2) {
            if (!clearAft(D)) wave = true;                                                       // deck foul
            else if (p.waveOffs < 3 && dh < 25 && dh > 4 && Math.abs(WW.angleDiff(c.heading, b)) > 0.5) wave = true; // lined up badly
            else if (p.waveOffs < 3 && Math.abs(c.turnRate || 0) > 0.2) wave = true;              // ship swinging
            else if (p.waveOffs < 3 && togo < 10 && Math.abs(lz - D.run) > 3) wave = true;
          }
          if (togo < -4) wave = true; // bolter
          if (wave) { p.waveOffs++; p.deckPh = 'waveoff'; p.phT = 0; break; }
          if (togo < 1 && Math.abs(lz - D.run) < 2 && p.y - D.dy - P().deckY < 1.3) this.trap(p, D, lx, lz);
          return;
        }
        case 'waveoff': // go around: power on, climb out ahead to the disengaged side, rejoin downwind
          to(lx + 40, ps * 10, 12, p.pt.speed, 1.2);
          if (p.phT > 4 || lx > 25) { p.deckPh = 'break'; p.phT = 0; }
          break;
      }
    },
    trap(p, D, lx, lz) {
      const c = p.carrier;
      p.state = 'rollout'; p.deckPh = 'trap'; p.t = 0; p.lx = Math.min(lx, TD_X + 1); p.lz = lz;
      p.rel = WW.clamp(p.speed - c.speed, 6, 16); p.vy = 0; p.turn = 0;
      D.lq.splice(D.lq.indexOf(p), 1);
      const w = c.toWorld(p.lx, p.lz); p.x = w[0]; p.z = w[1]; p.y = D.dy + P().deckY;
      // A bad trap (ship swinging, crippled plane, forced in after wave-offs) can go over the side (deaths agent).
      const tr = c.turnRate || 0, bad = Math.max(p.crippled ? 0.25 : 0, Math.abs(tr) > 0.18 ? 0.35 : 0, p.waveOffs >= 3 ? 0.3 : 0);
      const ad = WW.airDeaths;
      if (bad > 0 && ad && typeof ad.slideOff === 'function' && WW.rand() < bad &&
          ad.slideOff(p, tr > 0.18 ? -1 : tr < -0.18 ? 1 : undefined)) return;
      WW.stats.planesLanded++;
    },
    rollout(p, dt) {
      const c = p.carrier, D = deckOf(c);
      p.rel = Math.max(0, p.rel - 26 * dt); p.lx += p.rel * dt;
      p.lz += WW.clamp(D.run - p.lz, -2 * dt, 2 * dt);
      const w = c.toWorld(p.lx, p.lz), k = Math.min(1, p.t / 0.7);
      p.x = w[0]; p.z = w[1]; p.y = D.dy + P().deckY + Math.sin(k * PI) * 0.12;
      p.heading = c.heading; p.speed = 0; p.vy = 0; p.turn = 0;
      p.sync(dt);
      p.group.rotation.z = -0.17 * Math.sin(k * PI); // arrestor jolt: the nose dips as the wire bites
      if (p.rel <= 0 && p.t > 0.9) this.receive(p, D);
    },
    receive(p, D) { // the deck crew takes over: taxi forward past the barrier, fold, rearm
      const c = D.c, at = WW.time.now + P().rearm, m = p.model;
      (c.rearm = c.rearm || []).push({ kind: p.kind, at });
      p.removed = true; p.alive = false; // the model stays on deck (not back to the pool)
      if (m.payload) m.payload.visible = false;
      const col = colFor(D, p.kind, lenOf(p.kind));
      const e = newEntry(D, m, p.kind, p.lx, p.lz, 0, at, col ? 'in' : 'elev');
      if (col) { col.e.push(e); pack(D); } else D.loose.push(e);
    }
  };
})();
