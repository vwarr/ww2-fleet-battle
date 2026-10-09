// air_cag.js — WW.cag: the strike leader (CAG) and the strike escort. Hooks in air_strikes.js (tick, dive, torp,
// formation) and air_ops.js (escort fighters); the anvil and dive-wheel shapes stay in air_strikes.js.
// - CAG: the senior bomber of a wave leads it (a VB leader, else a VT leader, else any armed bomber). If the CAG
//   is lost, the next senior leader takes over. En route the CAG routes the wave round the detected AA umbrella
//   (WW.threat AA channel, else known ships' aa.range). On arrival, if the target is gone or no longer visible,
//   the CAG redirects the whole strike to the best visible target near the strike point (cripples preferred).
// - Timing: dive bombers hold in the wheel until the torpedo bombers of the strike turn in (or 20 s), and torpedo
//   bombers wait for the dive bombers to reach the wheel (or 15 s), so VT and VB hit together and split the AA.
// - Escort: close cover (first fighter element) stays with the bombers and takes on fighters attacking them; top
//   cover (next element) flies higher and meets fighters approaching the strike. Any escort breaks off to save a
//   bomber with a fighter on its tail. Escorts stay over the strike and come home with the bombers.
// Events: 'airOrder' { carrier, squadron, order: 'strikeAway' | 'cag' | 'attack' | 'redirect', plane, leader, target, squadrons }.
window.WW = window.WW || {};
(function () {
  const ARRIVE = 140, DETOUR_FAR = 120, VB_HOLD = 20, VT_HOLD = 15, SEARCH_R = 60, UNSEEN_T = 8, CV_NEAR = 250;
  const ST = { redirects: 0, handovers: 0, detours: 0, saves: 0, syncHolds: 0 };
  const bomber = p => p.alive && (p.kind === 'dive' || p.kind === 'torpedo');
  const emit = (o) => { if (WW.emit) WW.emit('airOrder', o); };
  const sqNames = (w) => { const s = []; for (const p of w.members) if (p.squadron && s.indexOf(p.squadron.short) < 0) s.push(p.squadron.short); return s; };

  function senior(w) {
    let best = null, bs = -1;
    for (const p of w.members) {
      if (!bomber(p) || !p.ordnance) continue;
      const s = (p.wing === 0 ? 4 : 0) + (p.kind === 'dive' ? 2 : 1) + (p.pilot && p.squadron && p.squadron.leader === p.pilot ? 8 : 0);
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  }
  function aaAt(nation, x, z, tgt) {
    if (tgt && WW.dist(x, z, tgt.x, tgt.z) < 70) return 0; // the target's own umbrella is the job
    if (WW.threat && WW.threat.danger) return WW.threat.danger(nation, x, z, { air: true });
    let s = 0;
    if (WW.intel) for (const c of WW.intel.enemyShips(nation)) { const o = c.unit, a = o.stats && o.stats.aa; if (a && o !== tgt && WW.dist(c.x, c.z, x, z) < a.range * 1.4) s += a.dps; }
    return s;
  }

  // the nearest freshly seen enemy carrier within CV_NEAR of a strike, or null
  function carrierNear(from) {
    if (!WW.intel) return null;
    let best = null, bd = CV_NEAR;
    for (const c of WW.intel.enemyShips(from.nation, { fresh: WW.intel.T.FRESH + 2 })) {
      const o = c.unit; if (!o || !o.alive || o.sinking || (WW.intel.typeOf ? WW.intel.typeOf(c) : o.type) !== 'carrier') continue;   // what the side believes it is
      const d = WW.dist(from.x, from.z, c.x, c.z); if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  // air_strikes.js tick() once the wave has left: CAG, redirect, timing state. Returns the target (may change).
  function waveTick(w) {
    const now = WW.time.now;
    if (!w.cag || !w.cag.alive || !w.cag.ordnance) {
      const old = w.cag; w.cag = senior(w);
      if (w.cag && old) { ST.handovers++; emit({ carrier: w.carrier, squadron: w.cag.squadron, order: 'cag', plane: w.cag, leader: w.cag, target: w.target }); }
    }
    if (!w.away) { w.away = true; emit({ carrier: w.carrier, squadron: w.cag && w.cag.squadron, order: 'strikeAway', plane: w.cag, leader: w.cag, target: w.target, squadrons: sqNames(w) }); }
    let t = w.target;
    const seen = t && t.alive && !t.submerged && (!WW.intel || WW.intel.visible(w.nation, t, 4));
    // Redirect only once the strike has reached the plotted position and found nothing (planes see ships out to ~100,
    // so the screen comes into view before the carrier behind it), or the target stayed unseen for UNSEEN_T inside
    // ARRIVE; a fresh carrier contact within CV_NEAR is taken before anything closer.
    if (seen || w.dT >= ARRIVE) w.unseen0 = null; else if (w.unseen0 == null) w.unseen0 = now;
    if (w.dT < ARRIVE && !seen && (w.dT < SEARCH_R || now - w.unseen0 > UNSEEN_T) && now - (w.rtT || -99) > 3) {
      w.rtT = now;
      const from = { x: w.x, z: w.z, nation: w.nation };
      const n = WW.airOps ? carrierNear(from) || WW.airOps.pickTarget(from, { near: 170 }) : null;
      if (n && n !== t) {
        w.target = t = n; ST.redirects++;
        for (const p of w.members) if (p.alive && p.target) p.target = n;
        emit({ carrier: w.carrier, squadron: w.cag && w.cag.squadron, order: 'redirect', plane: w.cag, leader: w.cag, target: n });
      }
    }
    if (w.dT < ARRIVE && !w.attackSaid && t) { w.attackSaid = true; emit({ carrier: w.carrier, squadron: w.cag && w.cag.squadron, order: 'attack', plane: w.cag, leader: w.cag, target: t, squadrons: sqNames(w) }); }
    return t;
  }
  // Wave heading: steer round the detected AA umbrella of escorts while far from the target.
  function detour(w, want, t) {
    if (w.dT < DETOUR_FAR) return want;
    let best = want, bc = 1e9;
    for (const o of [0, -0.35, 0.35, -0.7, 0.7]) {
      const h = want + o;
      let c = 0;
      for (const r of [30, 60]) c += aaAt(w.nation, w.x + Math.cos(h) * r, w.z + Math.sin(h) * r, t);
      if (WW.weather) for (const r of [40, 80]) c += WW.weather.cover(w.x + Math.cos(h) * r, w.z + Math.sin(h) * r) * 8; // round the worst of a squall
      c += Math.abs(o) * 6;
      if (c < bc - 0.5) { bc = c; best = h; }
    }
    if (best !== want) ST.detours++;
    return best;
  }
  // Retarget for a plane (aircraft.js validTarget): its wave's target, else the best visible target nearby, else any known.
  function retarget(pl) {
    const w = pl.wave;
    if (w && w.target && w.target.alive && !w.target.submerged) return w.target;
    if (!WW.airOps) return WW.shipAI ? WW.shipAI.pickStrikeTarget(pl) : null;
    return WW.airOps.pickTarget(pl, { near: 170 }) || WW.airOps.pickTarget(pl);
  }

  // ---------- VT / VB timing ----------
  function armedOn(nation, t, kind) {
    const L = [];
    for (const p of WW.world.planes) if (p.alive && p.kind === kind && p.nation === nation && p.ordnance && p.target === t && p.state !== 'return') L.push(p);
    return L;
  }
  // dive(): may this dive bomber peel off now?
  const CLOUD_WAIT = 18;
  function diveOK(pl, t, g) {
    const now = WW.time.now;
    // Low cloud over the target (weather.js): no push-over without a clear view. Wait up to CLOUD_WAIT s for a gap,
    // then the bomber gives up and takes its bomb home.
    if (WW.weather && WW.weather.cover(t.x, t.z) > WW.weather.LOW) {
      if (!pl.cloudT) { pl.cloudT = now; WW.weather.stats.diveHolds++; }
      if (now - pl.cloudT > CLOUD_WAIT) { pl.state = 'return'; pl.target = null; WW.weather.stats.diveAborts++; }
      return false;
    }
    if (g.vb0 === undefined || now - g.vb0 > 90) { g.vb0 = now; g.held = false; }
    if (now - g.goT < 15 || now - g.vb0 > VB_HOLD) return true;
    const vt = armedOn(pl.nation, t, 'torpedo').filter(p => WW.dist(p.x, p.z, t.x, t.z) < 260);
    if (!vt.length) return true;
    if (!g.held) { g.held = true; ST.syncHolds++; }
    return false;
  }
  // torp(): hold the anvil turn-in until the dive bombers are in the wheel (they then dive with the run)
  function vtWait(pl, t, g) {
    const now = WW.time.now;
    if (g.vt0 === undefined || now - g.vt0 > 90) g.vt0 = now;
    if (now - g.vt0 > VT_HOLD) return false;
    const vb = armedOn(pl.nation, t, 'dive');
    return vb.some(p => WW.dist(p.x, p.z, t.x, t.z) > 45 && WW.dist(p.x, p.z, t.x, t.z) < 300);
  }

  // ---------- escorts ----------
  function cover(pl) {
    if (pl.cover) return pl.cover;
    const w = pl.wave; let idx = 0;
    if (w === undefined) return 'close';   // not claimed a wave slot yet: decide once it has
    if (w && pl.element) { const seen = []; for (const p of w.members) if (p.kind === 'fighter' && p.element && seen.indexOf(p.element) < 0) seen.push(p.element); idx = Math.max(0, seen.indexOf(pl.element)); }
    else idx = (pl.wing || 0) % 2;
    pl.coverN = idx >> 1;                  // the n-th element of this cover (a full air wing's strike carries several)
    return (pl.cover = idx % 2 ? 'top' : 'close');
  }
  function strikeBombers(pl) { const L = []; for (const p of WW.world.planes) if (bomber(p) && p.carrier === pl.carrier && (p.state === 'transit' || p.state === 'attack' || p.state === 'return') && WW.dist(p.x, p.z, pl.x, pl.z) < 220) L.push(p); return L; }
  // air_ops fighter(): the escort's foe. Saving a bomber first, then by cover role.
  function escortPick(pl) {
    const B = strikeBombers(pl), DF = WW.dogfight;
    let best = null, bd = 1e9;
    if (DF && DF.threat) for (const b of B) { const q = DF.threat(b, 40); if (q) { const d = WW.dist(pl.x, pl.z, q.x, q.z); if (d < bd && d < 110) { bd = d; best = q; } } }
    if (best) { ST.saves++; return best; }
    if (!WW.intel) return null;
    const top = cover(pl) === 'top';
    for (const c of WW.intel.enemyPlanes(pl.nation)) {
      const u = c.unit; if (!u.alive || u.kind !== 'fighter') continue;
      let dmin = 1e9;
      for (const b of B) dmin = Math.min(dmin, WW.dist(u.x, u.z, b.x, b.z));
      const onUs = u.foe && u.foe.nation === pl.nation;
      if (top ? dmin < 100 : dmin < 35 && onUs) { const d = WW.dist(pl.x, pl.z, u.x, u.z) - (onUs ? 20 : 0); if (d < bd) { bd = d; best = u; } }
    }
    return best;
  }
  // air_ops fighter() with a strike target and no foe: formation, then over the target, then home with the bombers.
  function escort(pl, t, dt) {
    cover(pl);
    if (WW.strike && WW.strike.escort(pl, dt)) return true;  // forming up / in transit (formation slots by cover)
    const B = strikeBombers(pl), top = pl.cover === 'top';
    const armed = B.filter(b => b.ordnance && b.state !== 'return');
    if (armed.length && t) { // over the attack: close cover low over the bombers, top cover above the target
      let lx = 0, lz = 0; for (const b of armed) { lx += b.x; lz += b.z; } lx /= armed.length; lz /= armed.length;
      const cx = top ? t.x : lx, cz = top ? t.z : lz, r = top ? 45 : 25;
      const a = Math.atan2(pl.z - cz, pl.x - cx) + 0.5;
      pl.fly(cx + Math.cos(a) * r, cz + Math.sin(a) * r, top ? 56 : 42, dt, pl.pt.speed * 0.9);
      return true;
    }
    const home = B.filter(b => b.state === 'return' && WW.dist(b.x, b.z, pl.carrier.x, pl.carrier.z) > 130);
    if (home.length) { // ride home over the nearest returning bomber
      let n = home[0], nd = 1e9; for (const b of home) { const d = WW.dist(b.x, b.z, pl.x, pl.z); if (d < nd) { nd = d; n = b; } }
      pl.fly(n.x - Math.cos(n.heading) * 8, n.z - Math.sin(n.heading) * 8, n.y + (top ? 16 : 8), dt, nd > 20 ? pl.pt.speed : Math.max(n.speed + 3, pl.pt.speed * 0.7));
      return true;
    }
    pl.state = 'return';
    return true;
  }

  function reset() { for (const k in ST) ST[k] = 0; }
  WW.on('roundStart', reset);
  WW.cag = { stats: ST, waveTick, detour, retarget, diveOK, vtWait, escortPick, escort, cover };
})();
