// air_strikes.js — WW.strike: coordinated carrier strikes. Waves form up over the carrier and fly out in
// vics (escorts weaving above), dive bombers echelon, circle and peel off one by one into a steep dive with
// a hard pull-out, torpedo bombers split for an anvil attack at wave height. Loads after aircraft.js.
// Hooks: aircraft.js diveBomber/torpBomber -> dive/torp, fighter() escort -> escort, ships_ai carrierAI -> newWave.
window.WW = window.WW || {};
(function () {
  const S = (WW.strike = WW.strike || {});
  const PI = Math.PI;
  // Tallest point of each ship type above the water (measured model bounds), for pull-out / pop-up clearance (air_attack.js).
  const TOP = { carrier: 6.4, battleship: 7.2, cruiser: 5.2, destroyer: 3.7, submarine: 0.7, pt: 2.0 };
  const FORM_R = 55, GUIDE_V = 20, FORM_WAIT = 20;
  let waves = [];
  const gv = w => w.v || (w.nation === 'IJN' ? 25 : 22);   // the guide's speed in transit (doctrine: USN 22, IJN 25 u/s)

  // ---------- waves ----------
  // Form-up by doctrine (WW.fleetCmd doctrine: jointStrike, followUp). A carrier's first strike (its first deck load)
  // forms up over the carrier: 'group' (by air group, USN) or 'joint' (IJN: the first loads of all the side's carriers
  // form up together and fly as one strike behind the lead carrier's wave). Later strikes: 'deckload' (IJN: the load
  // goes once it is all up, no orbit) or 'squadron' (USN: each squadron is its own wave and goes as soon as its
  // first plane is up; the escorts ride with the torpedo squadron). Form-up time comes out of the planes' fuel.
  const JOINT_WAIT = 20, SQ_KINDS = ['torpedo', 'dive'];
  const ST = { forms: [] }; // { nation, first, mode, formT } per wave at departure
  function mk(carrier, target, mode, first) {
    return { carrier, target, nation: carrier.nation, pend: { fighter: 0, dive: 0, torpedo: 0 }, pendN: 0, mode, first,
      members: [], t0: WW.time.now, t1: -1, lt: WW.time.now, go: false, done: false,
      ang: WW.rand() * PI * 2, dir: WW.rand() < 0.5 ? -1 : 1, x: carrier.x, z: carrier.z, h: 0, dT: 1e9 };
  }
  // carrierAI hook: a strike was queued; count its planes so the wave(s) know who to wait for.
  function newWave(carrier, target, queue, opts) {
    const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(carrier.nation) : null, a = carrier.ai || {};
    const first = !a.struck, mode = !d ? 'group' : first ? (d.jointStrike ? 'joint' : 'group') : d.followUp || 'group';
    a.struck = true;
    for (let i = waves.length - 1; i >= 0; i--) if (waves[i].done || waves[i].carrier === carrier) waves.splice(i, 1);
    const out = [];
    if (mode === 'squadron') { // one wave per bomber squadron; fighters escort the torpedo squadron (else the dive bombers)
      const n = { fighter: 0, dive: 0, torpedo: 0 };
      for (const q of queue) if (q.target === target && n[q.kind] !== undefined) n[q.kind]++;
      for (const k of SQ_KINDS) {
        if (!n[k]) continue;
        const w = mk(carrier, target, mode, first); w.pend[k] = n[k]; w.pendN = n[k];
        if (!out.length && n.fighter) { w.pend.fighter = n.fighter; w.pendN += n.fighter; }
        out.push(w);
      }
    }
    if (!out.length) {
      const w = mk(carrier, target, mode, first);
      for (const q of queue) if (q.target === target && w.pend[q.kind] !== undefined) { w.pend[q.kind]++; w.pendN++; }
      out.push(w);
    }
    for (const w of out) { if (opts && opts.reserve) w.reserve = true; waves.push(w); }
    if (mode === 'joint') for (const s of WW.world.ships) // Kido Butai: the other carriers spot their first deck loads now
      if (s !== carrier && s.alive && s.hangar && s.nation === carrier.nation && s.ai && !s.ai.struck && s.ai.strikeT > 2) s.ai.strikeT = 2;
    return out[0];
  }
  function depart(w, now) {
    w.go = true; w.goT = now;
    const formT = w.t1 >= 0 ? now - w.t1 : 0;
    ST.forms.push({ nation: w.nation, first: w.first, mode: w.mode, formT: +formT.toFixed(1) });
    if (WW.emit) WW.emit('waveGo', { carrier: w.carrier, nation: w.nation, first: w.first, mode: w.mode, formT, reserve: !!w.reserve, target: w.target });
  }
  // Ready to leave the carrier, by form-up mode.
  function ready(w, formed, now) {
    const up = w.t1 >= 0, all = w.pendN <= 0, late = (up && now - w.t1 > FORM_WAIT) || now - w.t0 > FORM_WAIT + 25;
    if (w.mode === 'squadron') return up;
    if (w.mode === 'deckload') return (up && (all || now - w.t1 > 10)) || late; // the load goes when it is up (a straggler catches up)
    return (all && formed && up) || late;
  }
  // First call from a launched plane once airborne: join this carrier's forming wave if a slot is pending.
  function claim(pl) {
    pl.wave = null;
    if (!pl.target) return null;
    for (const w of waves) {
      if (w.done || w.carrier !== pl.carrier || !(w.pend[pl.kind] > 0)) continue;
      w.pend[pl.kind]--; w.pendN--; w.members.push(pl); pl.wave = w; pl.sk = 'form';
      if (w.t1 < 0) w.t1 = WW.time.now;
      if (w.target && w.target.alive && !w.target.submerged) pl.target = w.target;
      return w;
    }
    return null;
  }
  function inForm(p) { return p.alive && p.sk === 'form' && (p.state === 'transit' || p.state === 'attack') && !p.phase; }
  // Advance the wave's virtual guide (lazily, once per sim step) and re-index the formation slots.
  function tick(w) {
    const now = WW.time.now, dt = Math.min(0.1, now - w.lt);
    if (dt <= 0) return;
    w.lt = now;
    const c = w.carrier, n = { fighter: 0, dive: 0, torpedo: 0 };
    let formed = true;
    for (const p of w.members) {
      if (!inForm(p)) continue;
      p.fi = n[p.kind]++;
      if (p.slotD > 14) formed = false;
    }
    w.nDive = n.dive;
    if (!n.fighter && !n.dive && !n.torpedo && w.t1 >= 0) { w.done = true; return; }
    if (!w.go) { // orbit over the carrier while the deck launches the rest of the wave
      w.ang += (GUIDE_V * 0.85 / FORM_R) * dt * w.dir;
      w.x = c.x + Math.cos(w.ang) * FORM_R; w.z = c.z + Math.sin(w.ang) * FORM_R; w.h = w.ang + w.dir * PI / 2;
      w.ok = ready(w, formed, now);
      if (w.mode !== 'joint') { if (w.ok) depart(w, now); return; }
      // joint: every first deck load of the side forming now is ready (or the joint wait ran out): all go together
      const J = waves.filter(q => q.mode === 'joint' && q.nation === w.nation && !q.go && !q.done);
      if (J.indexOf(w) < 0) J.push(w);
      const t0 = Math.min.apply(null, J.map(q => q.t0));
      if (J.every(q => q.ok) || now - t0 > FORM_WAIT + 25 + JOINT_WAIT) {
        const lead = J.reduce((a, q) => (q.carrier.id < a.carrier.id ? q : a), J[0]);
        J.forEach((q, i) => { q.lead = q === lead ? null : lead; q.slot = i; depart(q, now); });
      }
      return;
    }
    if (w.lead && !w.lead.done && w.lead.go && w.lead.target === w.target && w.lead.dT > 160) { // joint strike: fly on the lead's wave
      const L = w.lead, c2 = Math.cos(L.h), s2 = Math.sin(L.h), sd = (w.slot & 1 ? 1 : -1) * (35 + 15 * (w.slot >> 1));
      w.x += WW.clamp(L.x - c2 * 20 - s2 * sd - w.x, -gv(w) * 1.3 * dt, gv(w) * 1.3 * dt);
      w.z += WW.clamp(L.z - s2 * 20 + c2 * sd - w.z, -gv(w) * 1.3 * dt, gv(w) * 1.3 * dt);
      w.h = L.h; w.dT = L.dT;
      if (WW.cag) WW.cag.waveTick(w);
      return;
    }
    let t = w.target;
    if (WW.cag) t = WW.cag.waveTick(w);                        // strike leader: redirect, handover (air_cag.js)
    if (!t || !t.alive || t.submerged) t = w.target = WW.airOps ? WW.airOps.pickTarget({ x: w.x, z: w.z, nation: w.nation }, { near: 200 }) : WW.shipAI ? WW.shipAI.pickStrikeTarget({ x: w.x, z: w.z, nation: w.nation }) : null;
    if (!t) { w.done = true; return; }
    const k = WW.intel && WW.intel.known(w.nation, t) || t;   // fly to where the side last saw it (intel.js)
    let want = Math.atan2(k.z - w.z, k.x - w.x);
    if (WW.cag) want = WW.cag.detour(w, want, t);              // round the AA umbrella of escorts
    w.h += WW.clamp(WW.angleDiff(w.h, want), -0.3 * dt, 0.3 * dt);
    w.x += Math.cos(w.h) * gv(w) * dt; w.z += Math.sin(w.h) * gv(w) * dt;
    w.dT = WW.dist(w.x, w.z, k.x, k.z);
  }
  // Fly to slot (a = ahead, s = right of the guide, alt): aim a little ahead of the slot, speed by along-track error.
  // Far off the slot (a straggler, a late launch), it cuts across at up to 1.3x the guide's speed until it is in.
  function keep(pl, w, a, s, alt, dt) {
    const c = Math.cos(w.h), sn = Math.sin(w.h), V = gv(w), vmax = Math.max(pl.pt.speed * 1.2, V * 1.3);
    const sx = w.x + c * a - sn * s, sz = w.z + sn * a + c * s;
    const ex = sx - pl.x, ez = sz - pl.z, d = Math.hypot(ex, ez), ea = ex * c + ez * sn;
    // ahead of the slot: throttle back rather than turn round; far off: intercept where the slot will be (cuts the circle)
    const la = d > 30 ? Math.min(60, d * V / vmax) : 10 + Math.max(0, -ea);
    pl.slotD = d;
    const v = d > 30 && ea > 0 ? vmax : WW.clamp(V + ea * 0.7, V * 0.75, vmax);
    pl.fly(sx + c * la, sz + sn * la, alt, dt, v, d > 30 ? 1.4 : 0.9);
  }
  // Slot of the i-th bomber of a kind (docs/PLANE_REVIEW.md P3): 3-plane vics (wingmen 10 abeam, 6 back, stepped up),
  // two vics to a division (the second echeloned right, 16 back, stepped down), divisions 34 apart in trail, stepped
  // down. Returns [ahead, right, up] off the kind's group lead.
  const SL = [0, 0, 0];
  function bomberSlot(i) {
    const k = Math.floor(i / 3), j = i % 3, d = Math.floor(k / 2), s2 = k % 2, wing = j === 1 ? -1 : j === 2 ? 1 : 0;
    SL[0] = -d * 34 - s2 * 16 - Math.abs(wing) * 6; SL[1] = s2 * 22 + wing * 10; SL[2] = -d * 2.5 - s2 * 2 + Math.abs(wing) * (j === 2 ? 1.5 : 1);
    return SL;
  }
  const SWEEP_D = 280;         // the sweep (top cover with doctrine air.sweep) runs ahead from this far out
  function sweeping(pl, w) {
    if (pl.cover !== 'top' || !w.go || w.dT > SWEEP_D) return false;
    const d = WW.fleetCmd && WW.fleetCmd.doctrine ? WW.fleetCmd.doctrine(pl.nation) : null;
    return !!(d && d.air && d.air.sweep);
  }
  // Formation flight for a wave member. Returns true while the plane is still in formation.
  // The stack (altitude rule y = 0.4 h^0.59): torpedo bombers ~30 (1,500 m), dive bombers 50-56 (3,000-4,000 m), close
  // escort just above the dive bombers, top cover ~70 (6,000 m), all on one guide: one strike, not a stream.
  function formation(pl, dt) {
    if (pl.wave === undefined) claim(pl);
    const w = pl.wave;
    if (!w || pl.sk !== 'form') return false;
    tick(w);
    const brk = pl.kind === 'dive' ? (S.wheelR ? S.wheelR(pl.pt) : 30) + 60 : pl.kind === 'torpedo' ? (S.SET_R || 140) + 40 : 60;
    if (w.done || (w.go && w.dT < brk)) { pl.sk = 'atk'; return false; }
    pl.state = 'transit';
    const i = pl.fi || 0, nb = Math.max(w.nDive || 0, 1);
    if (pl.kind === 'fighter') { // escorts weave (S-turns): close cover just above the bombers, top cover higher and ahead
      const ph = WW.time.now * 0.8 + (pl.element ? pl.element.id : i) * 1.9, top = pl.cover === 'top', wg = pl.wing || 0;
      const side = top ? 1 : -1, ws = wg === 2 ? -10 : wg ? 10 : 0, vb = WW.planeType ? WW.planeType('dive', pl.nation).alt : 54;
      if (sweeping(pl, w)) { // the sweep: well ahead of the strike, high, to clear the CAP before the bombers arrive
        keep(pl, w, 95 - (wg ? 8 : 0), ws * 1.4, (pl.pt.alt || 66) + 4 + wg, dt);
        return true;
      }
      keep(pl, w, (top ? 14 : -12) - (wg ? 6 : 0) + Math.cos(ph) * 3, side * (top ? 26 : 18) + ws + Math.sin(ph) * 7,
        (top ? (pl.pt.alt || 66) + 2 : vb + 7) + wg, dt);
    } else {
      const sl = bomberSlot(i), alt = pl.pt.alt || (pl.kind === 'dive' ? 54 : 30);
      if (pl.kind === 'dive') keep(pl, w, sl[0], sl[1], alt + sl[2], dt);
      else keep(pl, w, sl[0] - 6 - Math.min(2, Math.ceil(nb / 3) - 1) * 8, sl[1] - 6, alt + sl[2], dt);   // under the dive bombers
    }
    return true;
  }

  // ---------- the attack: dive bombers and torpedo bombers live in air_attack.js (WW.strike.dive / torp) ----------

  // ---------- escorts ----------
  // fighter() hook (has a strike target, no foe): weave over the forming / transiting wave.
  function escort(pl, dt) { return formation(pl, dt); }

  function reset() { waves = []; ST.forms = []; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  Object.assign(S, { newWave, escort, formation, reset, TOP, stats: ST, _waves: () => waves });   // dive / torp: air_attack.js
})();
