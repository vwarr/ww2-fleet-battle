// air_alert.js — WW.airAlert: the ready deck alert. A carrier keeps a few armed bombers back from its strikes,
// spotted and ready (doctrine air.alert: USN 4, IJN 2; the USN carriers kept a deck-alert section of SBDs, the IJN
// sent every bomber it had with the deck load). When enemy ships harass one of ours near the fleet (PT boats or a
// destroyer chasing a destroyer or a cripple, a cruiser closing on a cripple) or a submarine is seen on the surface
// near the fleet, a small flight (2 to 6, by the target: PT / sub 2, destroyer 4, cruiser 6) launches against it at
// once: dive bombers (torpedo planes only against a destroyer or a cruiser when no dive bomber is aboard). It is self
// defence, so the strike doctrine's "no deck load on small craft" rule does not apply; it flies only by day (no
// exception: the 1942 carriers did not launch in the dark), not while the carrier itself is under air attack, at most
// one flight per carrier every COOL s, and only on what the side has detected (WW.intel, fresh). The flight has no
// strike wave (plane.alert, plane.wave = null): it goes straight out and attacks (air_attack.js), then comes home.
// Hooks: wraps WW.airOps.plan (like air_strafe.js); air_boss.js orderStrike leaves hold(cv) bombers aboard and its
// launch() marks the alert planes. Events: airOrder 'alert' { carrier, target, n, why }. Sim code: no WW.rand.
window.WW = window.WW || {};
(function () {
  const ALERT = { USN: 4, IJN: 2 };       // armed bombers kept back from the strikes (doctrine air.alert overrides)
  const SIZE = { pt: 2, submarine: 2, destroyer: 4, cruiser: 6 };
  const REACH = 650;                      // the harasser within this of the carrier (a short sortie: ~25 s out at cruise, a fifth of a bomber's fuel)
  const HAR_R = 130, SUB_R = 220, COOL = 40, FRESH = 8, CHECK = 1;
  const ST = { USN: {}, IJN: {} };
  const reset0 = () => { for (const n in ST) ST[n] = { triggers: 0, launches: 0, planes: 0, drops: 0, hits: 0, why: {} }; };
  reset0();
  const doc = n => { const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(n) : null; return d && d.air && typeof d.air.alert === 'number' ? d.air.alert : ALERT[n] || 0; };
  const crip = s => (WW.endgameAI && WW.endgameAI.isCripple ? WW.endgameAI.isCripple(s) : s.hp < 0.5 * s.maxHp);

  // bombers to keep aboard from a strike (air_boss.js orderStrike): the ready section, dive bombers first
  function hold(cv) {
    if (cv.isBase || !cv.hangar) return { dive: 0, torpedo: 0 };
    const n = doc(cv.nation), d = Math.min(n, cv.hangar.dive || 0);
    return { dive: d, torpedo: Math.min(n - d, cv.hangar.torpedo || 0) };
  }
  // The harasser to strike near this carrier, or null: { u, why, victim }
  function harasser(cv) {
    if (!WW.intel) return null;
    const own = WW.world.ships.filter(s => s.alive && !s.sinking && !s.isBase && s.nation === cv.nation && s.type !== 'submarine');
    let best = null, bs = -1e9;
    for (const c of WW.intel.enemyShips(cv.nation, { fresh: FRESH })) {
      const u = c.unit; if (!u || !u.alive || u.sinking || u.isBase || !SIZE[u.type] || (u.type === 'submarine' && u.submerged)) continue;
      const dcv = WW.dist(cv.x, cv.z, c.x, c.z); if (dcv > REACH) continue;
      let vic = null, why = null, vd = 1e9;
      for (const s of own) {
        const d = WW.dist(c.x, c.z, s.x, s.z);
        if (u.type === 'submarine') { if (d < SUB_R && d < vd) { vd = d; vic = s; why = 'sub'; } continue; }
        if (d > HAR_R || d >= vd) continue;
        const toward = Math.abs(WW.angleDiff(c.heading || 0, Math.atan2(s.z - c.z, s.x - c.x))) < 1.0;
        const weak = crip(s) || (u.type !== 'cruiser' && (s.type === 'pt' || s.type === 'destroyer'));
        if (toward && weak) { vd = d; vic = s; why = crip(s) ? 'cripple' : 'chase'; }
      }
      if (!vic) continue;
      let on = 0; for (const p of WW.world.planes) if (p.alive && p.nation === cv.nation && p.ordnance && p.target === u) on++;
      if (on >= SIZE[u.type]) continue;   // already being dealt with (a strike, or another carrier's alert)
      const s = (crip(vic) ? 60 : 0) + (u.type === 'cruiser' ? 40 : u.type === 'destroyer' ? 30 : 10) - vd * 0.3 - dcv * 0.1;
      if (s > bs) { bs = s; best = { u, why, victim: vic }; }
    }
    return best;
  }
  function tick(cv) {
    const a = cv.ai; if (!a || cv.isBase || !cv.hangar || !doc(cv.nation)) return;
    if (WW.time.now - (a.alertT || -1e9) < COOL) return;
    if (WW.dayNight && !WW.dayNight.canFly()) return;
    if (WW.airOps.underAttack && WW.airOps.underAttack(cv)) return;
    if (a.queue.some(q => q.alert)) return;
    const h = harasser(cv); if (!h) return;
    const S = ST[cv.nation]; S.triggers++;
    const want = SIZE[h.u.type], hg = cv.hangar;
    let nd = Math.min(want, hg.dive || 0), nt = 0;
    if (nd < 2 && (h.u.type === 'destroyer' || h.u.type === 'cruiser')) nt = Math.min(want - nd, hg.torpedo || 0);
    if (nd + nt < 2) return;
    for (let i = 0; i < nt; i++) a.queue.unshift({ kind: 'torpedo', target: h.u, alert: true });
    for (let i = 0; i < nd; i++) a.queue.unshift({ kind: 'dive', target: h.u, alert: true });
    a.alertT = WW.time.now; S.launches++; S.planes += nd + nt; S.why[h.why] = (S.why[h.why] || 0) + 1;
    if (WW.emit) WW.emit('airOrder', { carrier: cv, order: 'alert', target: h.u, n: nd + nt, why: h.why, victim: h.victim });
  }
  // air_boss.js launch(): an alert plane leaves without a strike wave
  function launched(p, q) { if (!p || !q || !q.alert) return; p.alert = true; p.wave = null; }

  if (WW.airOps && WW.airOps.plan) {
    const plan0 = WW.airOps.plan;
    WW.airOps.plan = function (cv, dt) {
      const a = cv.ai;
      if (a && (a.alertChk = (a.alertChk || 0) - dt) <= 0) { a.alertChk = CHECK; tick(cv); }
      return plan0.apply(this, arguments);
    };
  }
  WW.on('weaponDropped', e => { const p = e && e.plane; if (p && p.alert && ST[p.nation]) ST[p.nation].drops++; });
  WW.on('roundStart', reset0);
  WW.airAlert = { hold, harasser, launched, ALERT, SIZE, stats: ST };
})();
