// air_strikes.js — WW.strike: coordinated carrier strikes. Waves form up over the carrier and fly out in
// vics (escorts weaving above), dive bombers echelon, circle and peel off one by one into a steep dive with
// a hard pull-out, torpedo bombers split for an anvil attack at wave height. Loads after aircraft.js.
// Hooks: aircraft.js diveBomber/torpBomber -> dive/torp, fighter() escort -> escort, ships_ai carrierAI -> newWave.
window.WW = window.WW || {};
(function () {
  const PI = Math.PI, G = 9.8;                 // G matches combat_weapons.js bomb gravity
  // Tallest point of each ship type above the water (measured model bounds), for pull-out / pop-up clearance.
  const TOP = { carrier: 6.4, battleship: 7.2, cruiser: 5.2, destroyer: 3.7, submarine: 0.7, pt: 2.0 };
  const CLEAR = 3.5;                           // plane half-extent at PLANE_SCALE 1.7 (~1) + 2.5 margin
  const DIVE_V = 32, DIVE_V0 = 24;             // dive brakes: the dive accelerates from ~24 to 32
  const Q = 3.5, Q_MAX = 6;                    // pull-out pitch rate (rad/s); raised if the bottom would be low
  // Anvil spread: the n-th torpedo bomber on a side sets up AV[n] x AV_DA rad round from the 54-degree point (~23 u
  // apart at R 82, so their setup orbits never stack) and runs in from its own bearing, a clear gap between wingtips.
  const AV = [0, 1, -1, 2, -2], AV_DA = 0.28;
  const WHEEL_ALT = 39, WHEEL_R = 20;          // dive bombers circle over the target (inside 3D AA range) before peeling off
  const FORM_R = 55, GUIDE_V = 20, FORM_WAIT = 20;
  let waves = [], grps = new Map();

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
    if (w.mode === 'deckload') return (up && all) || late;
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
      w.x += WW.clamp(L.x - c2 * 20 - s2 * sd - w.x, -GUIDE_V * 1.3 * dt, GUIDE_V * 1.3 * dt);
      w.z += WW.clamp(L.z - s2 * 20 + c2 * sd - w.z, -GUIDE_V * 1.3 * dt, GUIDE_V * 1.3 * dt);
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
    w.x += Math.cos(w.h) * GUIDE_V * dt; w.z += Math.sin(w.h) * GUIDE_V * dt;
    w.dT = WW.dist(w.x, w.z, k.x, k.z);
  }
  // Fly to slot (a = ahead, s = right of the guide, alt): aim a little ahead of the slot, speed by along-track error.
  function keep(pl, w, a, s, alt, dt) {
    const c = Math.cos(w.h), sn = Math.sin(w.h);
    const sx = w.x + c * a - sn * s, sz = w.z + sn * a + c * s;
    const ex = sx - pl.x, ez = sz - pl.z, d = Math.hypot(ex, ez), ea = ex * c + ez * sn;
    // ahead of the slot: throttle back rather than turn round; far off: intercept where the slot will be (cuts the circle)
    const la = d > 30 ? Math.min(60, d * GUIDE_V / (pl.pt.speed * 1.25)) : 10 + Math.max(0, -ea);
    pl.slotD = d;
    const v = d > 30 && ea > 0 ? pl.pt.speed * 1.25 : WW.clamp(GUIDE_V + ea * 0.7, GUIDE_V * 0.75, pl.pt.speed * 1.25);
    pl.fly(sx + c * la, sz + sn * la, alt, dt, v, 1.4);
  }
  // Formation flight for a wave member. Returns true while the plane is still in formation.
  function formation(pl, dt) {
    if (pl.wave === undefined) claim(pl);
    const w = pl.wave;
    if (!w || pl.sk !== 'form') return false;
    tick(w);
    const brk = pl.kind === 'dive' ? 35 : pl.kind === 'torpedo' ? 115 : 60;
    if (w.done || (w.go && w.dT < brk)) { pl.sk = 'atk'; return false; }
    pl.state = 'transit';
    // vic: wingmen 11 abeam (~2 spans: a span of clear air between wingtips), 6 back; vics 18 apart in trail
    const i = pl.fi || 0, k = Math.floor(i / 3), j = i % 3, wing = j === 1 ? -1 : j === 2 ? 1 : 0, nd = Math.ceil((w.nDive || 0) / 3) * 18;
    if (pl.kind === 'fighter') { // escorts weave (S-turns): close cover just above the bombers, top cover higher and ahead
      const ph = WW.time.now * 0.8 + (pl.element ? pl.element.id : i) * 1.9, top = pl.cover === 'top', wg = pl.wing || 0;
      const side = top ? 1 : -1, ws = wg === 2 ? -10 : wg ? 10 : 0;
      keep(pl, w, (top ? 6 : -10) - (wg ? 5 : 0) + Math.cos(ph) * 3, side * (top ? 18 : 12) + ws + Math.sin(ph) * 8, (top ? 54 : 44) + wg, dt);
    } else if (pl.kind === 'dive') {
      if (w.go && w.dT < 90) keep(pl, w, -i * 6, i * 11, 36 + i * 0.8, dt);                        // echelon right
      else keep(pl, w, -k * 18 - Math.abs(wing) * 6, wing * 11, 34 + k * 1.5, dt);               // vic
    } else keep(pl, w, -nd - 8 - k * 18 - Math.abs(wing) * 6, wing * 11, 24 - k, dt);        // torpedo vics trail below
    return true;
  }

  // ---------- per-target attack coordination ----------
  function grp(t) {
    let g = grps.get(t);
    if (!g) { g = { nextDive: 0, side: 0, goT: -99 }; grps.set(t, g); }
    return g;
  }
  function ground(x, z) { return WW.terrain ? Math.max(0, -WW.terrain.depthAt(x, z)) : 0; }
  function overLand(pl, n, a) { const g = groundAhead(pl, n); return g > 0 ? Math.max(a, g + 3) : a; } // a, or 3 over land ahead
  function groundAhead(pl, n) { // highest ground under and ahead of the plane (n samples, 6 apart)
    const c = Math.cos(pl.heading), s = Math.sin(pl.heading);
    let m = 0;
    for (let i = 0; i <= n; i++) m = Math.max(m, ground(pl.x + c * i * 6, pl.z + s * i * 6));
    return m;
  }
  function wet(x0, z0, x1, z1) { // open water (depth >= 1.2) all along a torpedo track
    if (!WW.terrain) return true;
    const n = Math.ceil(WW.dist(x0, z0, x1, z1) / 4);
    for (let i = 0; i <= n; i++) if (WW.terrain.depthAt(WW.lerp(x0, x1, i / n), WW.lerp(z0, z1, i / n)) < 1.2) return false;
    return true;
  }
  function topNear(t, r) { // highest ship top within r of the target (escorts under the pull-out)
    let m = TOP[t.type] || 6;
    for (const s of WW.world.ships) if (s.alive && !s.submerged && WW.dist2(s.x, s.z, t.x, t.z) < r * r) m = Math.max(m, TOP[s.type] || 6);
    return m;
  }

  // ---------- dive bombers ----------
  function setDV(pl) { pl.speed = pl.V * Math.cos(pl.gam); pl.vy = pl.V * Math.sin(pl.gam); }
  // Altitude lost in a pull-out from flight-path angle gam at speed V and pitch rate q (plus the ramp-up).
  // Integrates the same pull model as pullOut() (ramp, pitch rate, bleed) + 0.5 margin; release fires a step early.
  function pullLoss(V, gam, q) {
    let y = 0, qq = 0; const h = 0.02;
    for (let i = 0; i < 100 && gam < 0; i++) { qq = Math.min(q, qq + Q / 0.06 * h); gam += qq * h; V = Math.max(20, V - 3 * h); y -= V * Math.sin(gam) * h; }
    return y + 0.5;
  }
  function startPull(pl) { pl.phase = 'pull'; pl.q = 0; pl.turn = 0; }
  // Dive-line aim: the target's position at bomb impact, raised by the bomb's gravity sag below the line.
  function diveAim(pl, t) {
    const vy0 = Math.min(pl.V * Math.sin(pl.gam), -0.9 * pl.V), rel = pl.relAlt || 18; // lead as for a ~65-70 deg dive
    const tb = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * rel)) / G, tt = Math.max(0, pl.y - rel) / -vy0 + tb;
    pl.aimX = t.x + Math.cos(t.heading) * t.speed * tt; pl.aimZ = t.z + Math.sin(t.heading) * t.speed * tt;
    pl.aimY = 0.5 * G * tb * tb;
  }
  function dive(pl, dt) {
    if (pl.phase === 'pull' || pl.phase === 'exit') { pullOut(pl, dt); return; }
    const t = pl.validTarget();
    if (pl.phase && t !== pl.diveTgt) { startPull(pl); pullOut(pl, dt); return; } // target gone mid-dive: recover, keep the bomb
    if (!t) { pl.state = 'return'; pl.sk = null; return; }
    if (formation(pl, dt)) return;
    const dh = pl.hd(t), now = WW.time.now;
    if (pl.phase === 'roll' || pl.phase === 'dive') {
      pl.state = 'attack'; pl.phaseT += dt;
      diveAim(pl, t);
      const dx = pl.aimX - pl.x, dz = pl.aimZ - pl.z, hd = Math.hypot(dx, dz);
      const gw = WW.clamp(Math.atan2(pl.aimY - pl.y, hd), -1.4, -0.8);   // 46..80 deg (65-75 typical)
      if (pl.phase === 'roll') { // wing-over: roll toward the target, hold until the sight line is ~66 deg, push over
        const he = pl.turnTo(Math.atan2(dz, dx), dt, 2.6);
        if (!pl.push && Math.atan2(pl.aimY - pl.y + 7, Math.max(0.1, hd - 10)) <= -1.15) pl.push = true; // from where the push-over ends
        if (pl.push) pl.gam = Math.max(gw, pl.gam - 1.9 * dt);
        else pl.gam += WW.clamp(-0.12 - pl.gam, -dt, dt);
        pl.V = Math.min(DIVE_V, pl.V + 3 * dt);
        if (pl.push && ((pl.gam <= gw + 0.05 && Math.abs(he) < 0.25) || pl.phaseT > 2.5)) pl.phase = 'dive';
        else if (!pl.push && (hd < 5 || pl.phaseT > 3)) { pl.phase = null; setDV(pl); return; } // overshot: go round
      } else {
        pl.turnTo(Math.atan2(dz, dx), dt, 1.2);
        pl.gam += WW.clamp(gw - pl.gam, -1.2 * dt, 1.2 * dt); pl.V = Math.min(DIVE_V, pl.V + 5 * dt);
      }
      setDV(pl);
      pl.relAlt = pl.floor + pullLoss(pl.V, Math.min(pl.gam, gw), Q);
      if (pl.y + pl.vy * dt <= pl.relAlt) { // release on the dive line: the bomb keeps the plane's velocity
        pl.dropV = { x: Math.cos(pl.heading) * pl.speed, y: pl.vy, z: Math.sin(pl.heading) * pl.speed };
        WW.combat.dropBomb(pl, t); pl.dropped(); pl.dropV = null;
        startPull(pl);
      }
      return;
    }
    pl.state = dh < 80 ? 'attack' : 'transit';
    const g = grp(t);
    // Peel off in turn from the wheel: one plane every ~1.5-2.5 s.
    const rel = Math.abs(WW.angleDiff(pl.heading, Math.atan2(t.z - pl.z, t.x - pl.x)));
    if (now >= g.nextDive && dh > 13 && dh < 28 && rel < 1.9 && pl.y > 30 && pl.ordnance && (!WW.cag || WW.cag.diveOK(pl, t, g))) {
      g.nextDive = now + WW.randRange(1.5, 2.5);
      pl.phase = 'roll'; pl.phaseT = 0; pl.diveTgt = t; pl.push = false; pl.gam = Math.atan2(pl.vy, Math.max(1, pl.speed)); pl.V = Math.max(DIVE_V0, Math.hypot(pl.vy, pl.speed));
      pl.floor = Math.max(topNear(t, 40), 4, ground(t.x, t.z), groundAhead(pl, 6)) + CLEAR; pl.relAlt = pl.floor + 8;
      return;
    }
    if (dh < 36) pl.orbit(t.x, t.z, WHEEL_R, WHEEL_ALT + (pl.fi || 0) % 4 * 1.2, dt);
    else pl.fly(t.x, t.z, WHEEL_ALT, dt, pl.pt.speed);
  }
  // Hard, fast recovery: pitch rate ramps to Q in ~0.06 s (more if the bottom would be under the floor).
  function pullOut(pl, dt) {
    pl.turn = 0;
    if (pl.phase === 'pull') {
      const need = pl.y - pullLoss(pl.V, pl.gam, Q) < (pl.floor || 11) ? Q_MAX : Q;
      pl.q = Math.min(need, pl.q + Q / 0.06 * dt);
      pl.gam = Math.min(0.35, pl.gam + pl.q * dt); pl.V = Math.max(pl.pt.speed * 0.9, pl.V - 3 * dt);
      if (pl.gam >= 0.35) { pl.phase = 'exit'; pl.phaseT = 1.6; }
    } else { // climb away straight ahead, then head home
      pl.phaseT -= dt; pl.gam += WW.clamp(0.25 - pl.gam, -0.3 * dt, 0.3 * dt); pl.V += WW.clamp(pl.pt.speed - pl.V, -4 * dt, 4 * dt);
      if (pl.phaseT <= 0) { pl.phase = null; pl.sk = null; if (!pl.ordnance) pl.state = 'return'; } // still armed: back to the wheel
    }
    setDV(pl);
  }

  // ---------- torpedo bombers ----------
  function freeAV(pl, t) { // the first anvil bearing on this side not held by a live bomber on the same target
    const used = new Set();
    for (const p of WW.world.planes) if (p !== pl && p.alive && p.kind === 'torpedo' && p.target === t && p.side === pl.side && (p.sk === 'anvil' || p.phase === 'run')) used.add(p.av);
    for (const a of AV) if (!used.has(a)) return a;
    return AV[used.size % AV.length];
  }
  function clearOf(pl) { // { x, z } 20 u away from the nearest same-side bomber inside 10 u, else null
    let n = null, bd = 100;
    for (const p of WW.world.planes) {
      if (p === pl || !p.alive || p.nation !== pl.nation || p.kind !== 'torpedo' || p.state !== 'attack') continue;
      const d2 = WW.dist2(p.x, p.z, pl.x, pl.z); if (d2 < bd) { bd = d2; n = p; }
    }
    if (!n) return null;
    const d = Math.sqrt(bd) || 1; return { x: (pl.x - n.x) / d * 20, z: (pl.z - n.z) / d * 20 };
  }
  function torp(pl, dt) {
    const t = pl.validTarget();
    pl.phaseT -= dt;
    if (pl.phase === 'out') { popUp(pl, pl.outTgt && pl.outTgt.alive ? pl.outTgt : null, dt); return; } // the ship we just ran at
    if (!t) { pl.state = 'return'; pl.phase = null; pl.sk = null; return; }
    if (formation(pl, dt)) return;
    const dh = pl.hd(t), now = WW.time.now, g = grp(t);
    if (pl.phase === 'run') { run(pl, t, dh, dt); return; }
    if (pl.sk !== 'anvil') { // approach at cruise height, then split for the anvil
      pl.state = 'transit';
      pl.fly(t.x, t.z, 22, dt, pl.pt.speed);
      if (dh < 115) { pl.sk = 'anvil'; pl.side = g.side++ % 2 ? 1 : -1; pl.av = freeAV(pl, t); pl.anT = now; }
      return;
    }
    // Anvil setup: work round the target at R to a point ~54 deg off its bow on our side, then hold low.
    pl.state = 'attack';
    const R = 82, ts = 3, px = t.x + Math.cos(t.heading) * t.speed * ts, pz = t.z + Math.sin(t.heading) * t.speed * ts;
    const want = t.heading + pl.side * (0.95 + (pl.av || 0) * AV_DA), cur = Math.atan2(pl.z - pz, pl.x - px), da = WW.angleDiff(cur, want);
    const a = Math.abs(da) > 0.5 ? cur + Math.sign(da) * 0.5 : want;   // circle round rather than cross the target
    const sx = WW.clamp(px + Math.cos(a) * R, 10, WW.cfg.MAP_W - 10), sz = WW.clamp(pz + Math.sin(a) * R, 10, WW.cfg.MAP_H - 10); // torpedoes die off-map
    const ds = WW.dist(pl.x, pl.z, sx, sz);
    if (a === want && now > (pl.flipT || 0) && !wet(WW.lerp(sx, px, 0.25), WW.lerp(sz, pz, 0.25), WW.lerp(sx, px, 0.8), WW.lerp(sz, pz, 0.8))) {
      pl.side = -pl.side; pl.av = freeAV(pl, t); pl.flipT = now + 6; // land in the way: try the other bow
    }
    pl.ready = Math.abs(da) < 0.5 && ds < 16;
    const sep = clearOf(pl), hy = Math.abs(pl.av || 0) * 1.5;   // sidestep a squadron mate closer than 10; stepped heights
    if (ds < 12 && !sep) pl.orbit(sx, sz, 9, overLand(pl, 5, 5 + hy), dt);
    else pl.fly(sx + (sep ? sep.x : 0), sz + (sep ? sep.z : 0), overLand(pl, 5, (Math.abs(da) < 0.5 ? 5 : 16) + hy), dt, pl.pt.speed);
    // Both groups turn in together: all ready, someone has waited too long, or a run just started.
    let go = now - g.goT < 7;
    if (!go && pl.ready && !(WW.cag && WW.cag.vtWait(pl, t, g))) {
      go = true;
      for (const p of WW.world.planes) {
        if (!p.alive || p.kind !== 'torpedo' || p.target !== t || p.sk !== 'anvil' || p.phase) continue;
        if (now - p.anT > 14) { go = true; break; }
        if (!p.ready) go = false;
      }
      if (go) g.goT = now;
    }
    // Turn in once pointing at the target (or after 3 s), so nobody starts the run with a 180-degree turn.
    if (go && ((ds < 30 && Math.abs(WW.angleDiff(pl.heading, Math.atan2(t.z - pl.z, t.x - pl.x))) < 1) || now - g.goT > 6)) { pl.phase = 'run'; pl.sk = null; }
  }
  function run(pl, t, dh, dt) {
    pl.state = 'attack';
    const tt = dh / WW.TORPEDO.speed, px = t.x + Math.cos(t.heading) * t.speed * tt, pz = t.z + Math.sin(t.heading) * t.speed * tt;
    const d = pl.turnTo(Math.atan2(pz - pl.z, px - pl.x), dt, 1.2), alt = overLand(pl, 5, 1.8); // wave height, hop any land
    pl.speedTo(pl.pt.speed, dt); pl.vy += WW.clamp(WW.clamp((alt - pl.y) * 2.5, -7, 9) - pl.vy, -14 * dt, 14 * dt);
    const c = Math.cos(pl.heading), s = Math.sin(pl.heading);
    if (pl.y < 2.8) { // prop wash spray on the water under the plane (visual)
      pl.sprayT = (pl.sprayT || 0) - dt;
      if (pl.sprayT <= 0 && WW.fx) { pl.sprayT = 0.1; WW.fx.wake(pl.x - c * 1.2, pl.z - s * 1.2, pl.heading, 0.55); }
    }
    const drop = dh < 62 && pl.y < 3 && Math.abs(d) < 0.3 && wet(pl.x + c, pl.z + s, WW.lerp(pl.x, px, 0.8), WW.lerp(pl.z, pz, 0.8));
    if (drop) {
      WW.combat.fireTorpedo(pl, pl.x + c, pl.z + s, pl.heading, pl.nation, 75);
      if (WW.fx) WW.fx.splash(pl.x + c * 3, pl.z + s * 3, 0.9);
      pl.dropped();
    }
    // Released, or not lined up by 42 out: pop up over the ship (the latter keeps its torpedo and comes round again).
    if (drop || dh < 44) { pl.outTgt = t; pl.phase = 'out'; pl.phaseT = drop ? 4 : 3; pl.passed = false; pl.lastD = dh; pl.floor = Math.max(topNear(t, 30), 2, groundAhead(pl, 8)) + CLEAR; }
  }
  // After release: pop up hard and fly over the target ship, then climb away and head home.
  function popUp(pl, t, dt) {
    pl.speedTo(pl.pt.speed, dt);
    let alt = 18;
    if (t && !pl.passed) {
      const dh = pl.hd(t);
      if (dh > pl.lastD + 0.01) pl.passed = true;
      pl.lastD = dh;
      alt = pl.floor + 1.5 + Math.abs(pl.av || 0) * 2.5 + (pl.side > 0 ? 1.5 : 0); // stepped: crossing runs pass apart
      if (dh > t.stats.length * 0.5 + 6) pl.turnTo(Math.atan2(t.z - pl.z, t.x - pl.x), dt, 0.6); else pl.turn = 0;
    } else pl.turn = 0;
    pl.vy += WW.clamp(WW.clamp((alt - pl.y) * 2.5, -3, 17) - pl.vy, -34 * dt, 34 * dt);
    if (pl.phaseT > 0 || (t && !pl.passed)) return;
    pl.phase = null;
    if (pl.ordnance && t) { pl.sk = 'anvil'; pl.av = freeAV(pl, t); pl.anT = WW.time.now; } else { pl.state = 'return'; pl.sk = null; }
  }

  // ---------- escorts ----------
  // fighter() hook (has a strike target, no foe): weave over the forming / transiting wave.
  function escort(pl, dt) { return formation(pl, dt); }

  function reset() { waves = []; grps = new Map(); ST.forms = []; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.strike = { newWave, dive, torp, escort, reset, TOP, stats: ST, _waves: () => waves };
})();
