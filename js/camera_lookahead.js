// camera_lookahead.js (camera5): WW.camLook, the LOOK-AHEAD director. With ?cam=lookahead the look-ahead worker
// (lookahead.js) tells the camera what WILL happen in the next HORIZON sim s; this module turns that into the director's
// choices, on top of camera4's arc machinery (camera_director.js ship arcs, camera_story.js air stories, the shot library):
//  - EVENTS: camera_director.js events() / forecastFor() read the known future impacts from here instead of the live
//    forecast (every bomb / torpedo / heavy shell that WILL hit, with its exact time and point, and whether the ship goes
//    down after it): the braces and climax inserts are timed by what happens, not by a guess.
//  - ARCS chosen by their known outcome (plan()): a strike's attack on a ship (the wave, its hits, its losses), a ship's
//    torpedo spread that hits, a gun duel that scores, a carrier struck. Each is worth the class at stake (CV >> BB > CA >
//    DD > PT) times what happens (hits, a sinking, a magazine) and has a climax time. The director starts the best one
//    whose setup window is open: an air arc LEAD_AIR real s before its climax (the formation wide on the run-in), a ship
//    arc LEAD_SHIP s before; never one that would still be running when a bigger arc (a carrier strike) must start.
//  - The PROTAGONIST of an air arc is drawn from the wave with the real odds (the user, 2026-10-13: "sometimes the
//    protagonist is shot down"): with the wave's loss rate before the drop, one that is shot down (camera_story.js
//    follows it down to the water, then hands the story to a wingman that WILL hit: successorHint); else one that drops
//    and hits (the hand-off films the hit), else one that drops.
//  - A CARRIER STRIKE (the user: "a carrier about to be struck supersedes anything else") is known from the raid inbound:
//    its arc is set up in time, and supersedes a running arc not about her when its window opens.
// The forecast director (camera4) still runs underneath: the filler between arcs, the event interrupts, F. Off, or the
// worker not usable on this round (diverged, failed, not ahead yet): camera4 exactly.
// Visual only: reads the sim and the look-ahead log, never writes the sim; Math.random and the wall clock, never WW.rand.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const wall = () => performance.now() / 1000;
  const ok = p => p && !p.removed && p.alive;
  const isShip = s => s && s.stats && !s.isLand && !s.isBase && !s.removed;
  const CLASS = { carrier: 3, battleship: 1.8, cruiser: 1.3, destroyer: 0.9, submarine: 0.5, pt: 0.5 };
  const cls = s => (s && s.type ? CLASS[s.type] || 1 : 1);
  const BASE = { torp: 8.4, bomb: 8.3, dive: 7.9, shellbig: 7.0, shellmed: 6.2, sink: 8.8, mag: 9.2 };
  const LEAD_AIR = [10, 34, 48], LEAD_SHIP = [5, 16, 24];   // real s before the climax an arc opens: [latest, wanted, earliest]
  const TAIL = 12, TICK = 0.25, EV_MAX = 40;                // real s an arc runs past its climax (for planning); sim s of impacts events() lists
  const ST = { plans: 0, air: 0, ship: 0, cv: 0, doomed: 0, superseded: 0, hints: 0, rejected: 0, byKind: {} };
  const log = [];
  // the nominal rate (the director's slow motion is a beat, not the plan): sim s per real s at 1x is main.js's BASE_SPEED
  // (WW.time.base when exposed: 0.5 before speedcal, ~0.31 after), times the game speed
  const sim2real = s => s / Math.max(0.05, (WW.time.scale || 1) * ((WW.time && WW.time.base) || 0.5));
  const realS = s => (WW.camFinder ? WW.camFinder.realS(s) : s * 2);

  // is the look-ahead in charge on this round?
  const active = () => !!(WW.lookahead && WW.lookahead.mode === 'lookahead' && WW.lookahead.usable() && !(WW.camNormandy && WW.camNormandy.on()));

  // ---------- events(): the known future impacts, in camera_director.js's shape ----------
  let evCache = null, evAt = -1;
  function evs() {
    const n = WW.game.stepN || 0;
    if (evCache && evAt === n) return evCache;
    evAt = n;
    const by = new Map(), F = WW.lookahead.future(0), sunkAt = new Map();
    for (const e of F) if (e.k === 'sunk' && !sunkAt.has(e.s)) sunkAt.set(e.s, WW.lookahead.dt(e));
    for (const e of F) {
      let kind = null, tgt = null;
      if (e.k === 'imp' && e.hit) { kind = e.w === 'torpedo' ? 'torp' : 'bomb'; tgt = e.hit; }
      else if (e.k === 'sh') { kind = e.cal === 'big' ? 'shellbig' : 'shellmed'; tgt = e.hit; }
      else if (e.k === 'sunk' || e.k === 'mag') { kind = e.k === 'sunk' ? 'sink' : 'mag'; tgt = e.s; }   // (known ahead: the camera is on her when she goes)
      if (!kind) continue;
      const dt = WW.lookahead.dt(e); if (dt < 0 || dt > EV_MAX) continue;
      const s = WW.lookahead.obj(tgt); if (!isShip(s) || (!s.alive && !s.sinking)) continue;
      let r = by.get(s);
      if (!r) by.set(s, r = { s, eta: 1e9, last: 0, n: 0, kinds: {}, ox: 0, oz: 0, src: null, kind: '', la: true, dmg: 0 });
      r.n++; r.kinds[kind] = (r.kinds[kind] || 0) + 1; r.last = Math.max(r.last, dt);
      if (!e.dud) r.dmg += 1;
      if (dt < r.eta || (BASE[kind] > BASE[r.kind] + 0.5 && dt < r.eta + 3)) {
        r.eta = dt; r.kind = kind; r.ox = e.sx !== undefined ? e.x - e.sx : 0; r.oz = e.sz !== undefined ? e.z - e.sz : 0;
        const o = WW.lookahead.obj(e.src);
        r.src = o && !o.removed ? { x: o.x, y: o.y || 4, z: o.z, obj: o } : { x: e.x, y: 4, z: e.z };
      }
    }
    const out = [];
    for (const r of by.values()) {
      const s = r.s, low = 1 - WW.clamp(s.hp / s.maxHp, 0, 1), sk = sunkAt.get('s' + s.id);
      r.kill = sk !== undefined && sk >= r.eta - 0.5 && sk - r.last < 90;
      r.raw = (BASE[r.kind] || 6) + (cls(s) - 1) * 1.5 + low * 1.2 + (r.kill ? 1.6 : 0) + 0.25 * Math.min(3, r.n - 1);
      r.etaReal = realS(r.eta); r.lastReal = realS(r.last);
      r.pr = r.raw - (r.etaReal < 0.6 ? 2 : r.etaReal < 1.2 ? 0.8 : 0) - Math.max(0, r.etaReal - 9) * 0.35;
      out.push(r);
    }
    out.sort((a, b) => b.pr - a.pr);
    return (evCache = out);
  }

  // camera_story.js pick(): inside an air arc, an impact due on the story's target in 0.8-8 real s from ANOTHER plane of
  // the wave (or a ship), while the protagonist is not in its own run / dive: the brace on the target, timed by the log
  function storyBrace(st) {
    if (!active() || !st || !st.lead) return null;
    const P = st.lead, T = (isShip(st.laTarget) && st.laTarget) || P.diveTgt || P.target || (P.wave && P.wave.target);   // (the planned arc's target: a plane past its drop may have dropped its own)
    if (!isShip(T) || (!T.alive && !T.sinking)) return null;
    if (ok(P) && P.ordnance && (P.phase === 'run' || P.phase === 'roll' || P.phase === 'dive')) return null;
    const dead = !ok(P);   // (the protagonist fell: the attack it died in still lands: its climax, from anyone)
    if (!dead && P.ordnance && P.kind !== 'fighter') return null;   // still on its way in: its own run is the story (others' hits: camera_director.js climax())
    const e = evs().find(v => v.s === T); if (!e || e.etaReal < 0.8 || e.etaReal > (dead ? 14 : 10)) return null;
    if (e.src && e.src.obj === P && ok(P) && P.ordnance) return null;   // (its own bomb / torpedo already away: the target, braced)
    // past its own attack, the story waits only for its own wave's hits (another strike's are another story)
    const past = !ok(P) || !P.ordnance, so = e.src && e.src.obj;
    if (past && !dead && T.type !== 'carrier' && so && so !== P && (!so.pt || !P.wave || so.wave !== P.wave)) return null;   // (a carrier struck: from anyone)
    ST.storyBraces = (ST.storyBraces || 0) + 1;
    return { kind: 'brace', subj: T, ev: e, hold: e.raw, pr: e.raw, dur: WW.clamp(e.lastReal + 2.6, 4, 12), why: e.kind, label: D() && D().labelOf ? D().labelOf(e) : '' };
  }

  // camera_action.js torpedo hand-off: the plane's own torpedo is known to MISS and another hit on its target is due
  // within 1.5-6 real s: let the wake go now (the story braces for the hit)
  function handoffLetGo(shot) {
    if (!active() || !shot || shot.stage !== 'torp' || !shot.proj) return false;
    const o = shot.proj.owner, T = shot.tship; if (!o || !o.lid || !isShip(T)) return false;
    const id = 'p' + o.lid; let mine = null;
    for (const e of WW.lookahead.future(0)) if (e.k === 'imp' && e.src === id) { mine = e; break; }
    if (!mine || mine.hit) return false;
    const e = evs().find(v => v.s === T);
    if (!e || e.etaReal < 1.5 || e.etaReal > 6 || (e.src && e.src.obj === o)) return false;
    ST.letGo = (ST.letGo || 0) + 1; return true;
  }
  // camera_action.js hold (the beat on a result): another hit on the same ship lands within the beat: aim at it
  function holdAim(shot) {
    if (!active() || !shot) return null;
    const T = shot.tship || (shot.subj && (shot.subj.diveTgt || shot.subj.target)); if (!isShip(T)) return null;
    const e = evs().find(v => v.s === T); if (!e || e.etaReal > (shot.hold || 2.2) - (shot.st || 0) + 1.5 || e.etaReal < 0) return null;
    return { x: T.x + e.ox, y: 1.5, z: T.z + e.oz, eta: e.etaReal };
  }

  // ---------- plan(): the arcs the future holds ----------
  // { kind: 'strike' | 'torpRun' | 'duel' | 'raid', subj, target, wave, climax (sim s), value, members, hits, sinks }
  let plCache = null, plAt = -1, wk = 0, pref = null;
  const waves = new WeakMap(), waveKey = w => waves.get(w) || (waves.set(w, ++wk), wk);
  function plan() {
    const n = WW.game.stepN || 0;
    if (plCache && n - plAt < 30) return plCache;   // (a quarter sim s)
    plAt = n;
    const F = WW.lookahead.future(2), items = [], strikes = new Map(), ships = new Map();
    const sunk = new Map(), mag = new Set();
    for (const e of F) { if (e.k === 'sunk' && !sunk.has(e.s)) sunk.set(e.s, WW.lookahead.dt(e)); if (e.k === 'mag') mag.add(e.s); }
    const fate = new Map();   // plane id -> { drop, hit, down, downAt, wet }
    const F_ = id => fate.get(id) || (fate.set(id, {}), fate.get(id));
    for (const e of F) {
      if (e.k === 'drop' && e.p) { const f = F_(e.p); if (f.drop === undefined) { f.drop = WW.lookahead.dt(e); f.dropTg = e.tg; f.w = e.w; } }
      else if (e.k === 'imp' && e.src && e.src[0] === 'p') { const f = F_(e.src); if (e.hit && !e.dud) { f.hit = f.hit === undefined ? WW.lookahead.dt(e) : f.hit; f.hitTg = e.hit; } else if (f.miss === undefined) f.miss = WW.lookahead.dt(e); }
      else if (e.k === 'down' && e.p) { const f = F_(e.p); if (f.down === undefined) { f.down = WW.lookahead.dt(e); f.dx = e.x; f.dz = e.z; f.ph = e.ph; } }
      else if (e.k === 'wet' && e.p) { const f = F_(e.p); if (f.wet === undefined) f.wet = WW.lookahead.dt(e); }
      else if (e.k === 'phase' && e.p && e.tg) { const f = F_(e.p); if (f.att === undefined) { f.att = WW.lookahead.dt(e); f.attTg = e.tg; } }
    }
    // strikes: the planes now in the air whose attack (a drop or a run begun) on a ship lies ahead, by wave and target
    for (const [id, f] of fate) {
      const p = WW.lookahead.obj(id); if (!ok(p) || !p.pt) continue;
      // (a strike cut to pieces before it can drop is a story too: its wave's target)
      const tg = f.dropTg || f.attTg || f.hitTg || (f.down !== undefined && p.ordnance && p.wave && isShip(p.wave.target) ? 's' + p.wave.target.id : null);
      if (!tg || tg[0] !== 's') continue;
      const T = WW.lookahead.obj(tg); if (!isShip(T) || !T.alive || T.nation === p.nation) continue;
      const key = (p.wave ? 'w' + waveKey(p.wave) : 'p' + id) + '>' + tg;
      let it = strikes.get(key);
      if (!it) strikes.set(key, it = { kind: 'strike', target: T, wave: p.wave || null, members: [], hits: 0, hitT: 1e9, dropT: 1e9, downs: 0, nation: p.nation });
      it.members.push({ p, f, id });
      if (f.hit !== undefined && f.hitTg === tg) { it.hits++; it.hitT = Math.min(it.hitT, f.hit); }
      if (f.drop !== undefined) it.dropT = Math.min(it.dropT, f.drop);
      if (f.down !== undefined && (f.drop === undefined || f.down < f.drop)) { it.downs++; it.downT = Math.min(it.downT || 1e9, f.down); }
    }
    for (const it of strikes.values()) {
      const T = it.target, tid = 's' + T.id, sk = sunk.get(tid);
      it.climax = it.hitT < 1e9 ? it.hitT : it.dropT < 1e9 ? it.dropT + 3 : Math.min(it.downT || 1e9, ...it.members.map(m => m.f.att !== undefined ? m.f.att + 8 : 1e9));
      if (!(it.climax < 1e8)) continue;
      it.sinks = sk !== undefined && sk >= it.climax - 1 && sk < it.climax + 60;
      it.value = cls(T) * (it.hits ? 1 + 0.9 * Math.min(4, it.hits) + (it.sinks ? 2.5 : 0) + (mag.has(tid) && it.sinks ? 1 : 0) : 0.35) + 0.3 * Math.min(5, it.downs);
      items.push(it);
    }
    // ship arcs: a torpedo spread that hits (or a charge), a gun duel that scores
    for (const e of F) {
      if (e.k === 'tfire' && e.s) { const s = WW.lookahead.obj(e.s), T = WW.lookahead.obj(e.tg); if (!isShip(s) || !s.alive || !isShip(T)) continue; const k = 'tr' + e.s + e.tg; if (!ships.has(k)) ships.set(k, { kind: s.ai && s.ai.charge ? 'charge' : 'torpRun', subj: s, target: T, fire: WW.lookahead.dt(e), hits: 0, hitT: 1e9 }); }
    }
    for (const e of F) {
      if (e.k === 'imp' && e.w === 'torpedo' && e.hit && e.src && e.src[0] === 's') { const it = ships.get('tr' + e.src + e.hit); if (it && !e.dud) { it.hits++; it.hitT = Math.min(it.hitT, WW.lookahead.dt(e)); } }
      if (e.k === 'sh' && e.src && e.hit && e.src[0] === 's') {
        const k = 'du' + e.src + e.hit; let it = ships.get(k);
        if (!it) { const s = WW.lookahead.obj(e.src), T = WW.lookahead.obj(e.hit); if (!isShip(s) || !s.alive || !isShip(T) || (s.type !== 'battleship' && s.type !== 'cruiser')) continue; ships.set(k, it = { kind: 'duel', subj: s, target: T, hits: 0, hitT: 1e9, big: 0 }); }
        it.hits++; it.hitT = Math.min(it.hitT, WW.lookahead.dt(e)); if (e.cal === 'big') it.big++;
      }
    }
    for (const it of ships.values()) {
      const T = it.target, sk = sunk.get('s' + T.id);
      if (it.kind === 'duel' && it.hits < 2) continue;
      it.climax = it.hitT < 1e9 ? it.hitT : (it.fire || 0) + 10;
      it.sinks = sk !== undefined && sk >= it.climax - 1 && sk < it.climax + 60;
      it.value = cls(T) * (it.kind === 'duel' ? 0.5 + 0.25 * Math.min(6, it.hits) + 0.2 * Math.min(4, it.big) : 0.8 + 0.9 * Math.min(3, it.hits)) + (it.sinks ? 2.5 * cls(T) : 0) + (it.hits ? 0 : -0.8);
      items.push(it);
    }
    // camera6: a CRIPPLE FINISHED OFF: a ship that goes down within the horizon with no arc above leading to it (shells, a
    // destroyer's torpedoes, the last of her flooding): her last minutes from her own deck / an orbit, the sinking the climax
    for (const [tid, dt] of sunk) {
      if (dt < 3) continue;
      const T = WW.lookahead.obj(tid); if (!isShip(T) || !T.alive || T.type === 'pt' || T.type === 'submarine') continue;
      if (items.some(it => it.target === T && it.sinks)) continue;
      items.push({ kind: 'finish', target: T, subj: T, climax: dt, sinks: true, hits: 1, value: cls(T) * 1.6 });
    }
    for (const it of items) {
      it.climaxR = sim2real(it.climax);
      const L = it.kind === 'strike' ? LEAD_AIR : LEAD_SHIP;
      it.openR = it.climaxR - L[1]; it.lateR = it.climaxR - L[0]; it.earlyR = it.climaxR - L[2];
      // camera6: a ship's torpedo attack is told from the RUN-IN: the arc opens before the spread leaves (the survey: the
      // run-in was on camera 0 s of the 25 before the spread in most hits), and runs to the hits
      if ((it.kind === 'torpRun' || it.kind === 'charge') && it.fire !== undefined && it.hits) {
        const fR = sim2real(it.fire);
        it.openR = Math.min(it.openR, fR - LEAD_SHIP[1]); it.earlyR = Math.min(it.earlyR, fR - LEAD_SHIP[2]);
      }
      it.endR = it.climaxR + TAIL + (it.sinks ? 6 : 0);
      it.cv = it.target && it.target.type === 'carrier' && (it.hits > 0 || it.kind === 'strike');
    }
    // the after-battle reel (highlights): prefer(spec) points the director at a known clip: the items about its ship with
    // a climax inside its live-step window are worth x4 and take a carrier arc's priority (nothing changes while unset)
    if (pref) {
      const h = (window.__sim && window.__sim.LIVE_STEP) || 1 / 120, n = WW.game.stepN || 0;
      for (const it of items) {
        const id = o => WW.lookahead.idOf(o), nc = n + Math.round(it.climax / h);
        if ((id(it.target) === pref.tg || id(it.subj) === pref.tg || (pref.src && id(it.subj) === pref.src)) && nc >= (pref.n0 || 0) && nc <= (pref.n1 === undefined ? 1e12 : pref.n1)) { it.value *= 4; it.cv = true; it.pref = true; }
      }
    }
    items.sort((a, b) => b.value - a.value);
    return (plCache = items);
  }

  // ---------- the protagonist ----------
  function protagonist(it) {
    const att = it.members.filter(m => ok(m.p) && m.p.ordnance && m.p.kind !== 'fighter');
    if (!att.length) return null;
    const doomed = att.filter(m => m.f.down !== undefined && (m.f.drop === undefined || m.f.down < m.f.drop) && m.f.down < it.climax + 4 && m.f.down > 4);
    const hitters = att.filter(m => m.f.hit !== undefined && m.f.hitTg === 's' + it.target.id && (m.f.down === undefined || m.f.down > m.f.hit + 2));
    const droppers = att.filter(m => m.f.drop !== undefined && (m.f.down === undefined || m.f.down > m.f.drop));
    const loss = att.length ? doomed.length / att.length : 0;
    // nearest the climax first (the fall is part of the tension, the hit the climax); leaders and torpedo planes first
    const by = (arr, key) => arr.slice().sort((a, b) => (key(a) - key(b)) + (a.p.wing === 0 ? -1.5 : 0) - (b.p.wing === 0 ? -1.5 : 0));
    let pick = null, doom = false;
    if (doomed.length && Math.random() < loss) { pick = by(doomed, m => Math.abs(m.f.down - it.climax))[0]; doom = true; }
    else if (hitters.length) pick = by(hitters, m => m.f.hit + (m.p.kind === 'torpedo' ? -2 : 0))[0];
    else if (droppers.length) pick = by(droppers, m => m.f.drop)[0];
    else pick = att[0];
    return pick ? { p: pick.p, doom, loss } : null;
  }
  // camera_story.js successor(): of the wingmen able to take the story on, the one that will hit
  function successorHint(cands, any) {   // any: one candidate is enough (the wave-wide hand-on)
    if (!active() || !cands || cands.length < (any ? 1 : 2)) return null;
    const F = WW.lookahead.future(0), hit = new Set();
    for (const e of F) if (e.k === 'imp' && e.hit && !e.dud && e.src && e.src[0] === 'p') hit.add(e.src);
    const h = cands.find(c => hit.has(WW.lookahead.idOf(c)));
    if (h) ST.hints++;
    return h || null;
  }

  // ---------- the arbiter ----------
  let tk = 0, cur = null, rest = 0, ban = new WeakMap();
  const D = () => WW.camDirector, S = () => WW.camStory;
  const SUPER = 1.6, MINV = 0.6;
  // the arc the planner started is still running
  const mineRunning = () => !!(cur && cur.arc && !cur.arc.t1);
  // a planned arc is open or opens within 12 real s: camera4's own arc pickers stand down (else they fill in)
  function owns() {
    if (!active()) return false;
    if (mineRunning()) return true;
    const P = plan();
    return P.some(it => it.value >= MINV && it.openR <= 12 && it.lateR > 0);
  }
  function arcRunning() { return !!(D() && D().arcBusy()); }
  function runningAbout(it) {
    const d = D(); if (!d || !d.arcBusy()) return false;
    if (it.target && d.arcAbout(it.target)) return true;
    if (it.subj && d.arcAbout(it.subj)) return true;
    return false;
  }
  function startItem(it, why) {
    let okd = false;
    // after last light the director tells no air stories (night_fx.js): the strike is filmed from its target (her raid)
    if (it.kind === 'strike' && WW.dayNight && WW.dayNight.canFly && !WW.dayNight.canFly()) it = cvRaid(it);
    if (it.kind === 'strike') {
      const pr = protagonist(it); if (!pr) { ST.rejected++; return false; }
      const mission = 'strike';
      okd = S() && S().plan ? S().plan({ lead: pr.p, mission, item: { la: true }, target: it.target }, { doom: pr.doom, loss: pr.loss, value: it.value, climaxR: it.climaxR, target: it.target.type }) : false;
      if (okd) { ST.air++; if (pr.doom) ST.doomed++; }
    } else {
      const pov = it.kind === 'cvraid' || it.kind === 'finish';   // (the target's point of view: her raid, her last minutes)
      const b = { kind: pov ? 'raid' : it.kind, subj: pov ? it.target : it.subj, target: pov ? null : it.target, promise: 8 + it.value, struck: it.cv };
      okd = D().startShipArc(b);
      if (okd) ST.ship++;
    }
    if (!okd) { ST.rejected++; return false; }
    ST.plans++; if (it.cv) ST.cv++;
    const k = it.kind + ':' + (it.target ? it.target.type : '');
    ST.byKind[k] = (ST.byKind[k] || 0) + 1;
    const A = D().arcs; cur = { it, at: wall(), climaxAt: wall() + it.climaxR, endAt: wall() + Math.max(8, it.endR), arc: A[A.length - 1] || null };
    log.push({ at: wall(), why, kind: it.kind, tgt: it.target ? it.target.type : '', climaxR: +it.climaxR.toFixed(1), value: +it.value.toFixed(2), hits: it.hits }); if (log.length > 200) log.shift();
    return true;
  }
  // the carrier arc for a carrier struck by something no air arc can carry (a ship's torpedo, no attacker left): her raid
  function cvRaid(it) { return { kind: 'cvraid', strike: it, target: it.target, subj: it.target, climax: it.climax, climaxR: it.climaxR, value: it.value, endR: it.endR, cv: !!(it.target && it.target.type === 'carrier'), hits: it.hits }; }
  // every frame: the running shot of an arc is not cut in the last seconds before a known impact on the arc's target
  // (it is held through the impact and a beat), when it shows the target
  function hold() {
    const shot = WW.cam._shot(); if (!shot || shot.stage || shot.t < 1 || shot.dur - shot.t > 1.2 || shot.kind === 'brace') return;
    const st = S() && S().story(), d = D();
    let T = null;
    if (st && st.begun && shot.story) T = isShip(st.laTarget) ? st.laTarget : st.lead && (st.lead.diveTgt || st.lead.target || (st.lead.wave && st.lead.wave.target));
    else if (shot.arc && d && d.arcBusy()) T = shot.subj;
    if (!isShip(T)) return;
    const e = evs().find(v => v.s === T); if (!e || e.etaReal > 3.5 || e.etaReal < 0) return;
    const c = WW.camera; if (!c) return;
    _hv.set(T.x, 2, T.z).project(c);
    if (!(_hv.z < 1 && Math.abs(_hv.x) < 0.95 && Math.abs(_hv.y) < 0.95)) return;   // the target is not in this shot: the cut may go
    shot.dur = Math.max(shot.dur, shot.t + e.etaReal + 1.8); ST.holds = (ST.holds || 0) + 1;
  }
  const _hv = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  // ---------- the big impact guard (camera6) ----------
  // The survey (docs/camera_review.md, camera6) found every carrier / battleship hit the camera missed was KNOWN 7-15 s
  // ahead: the director was committed elsewhere (a CAP or snooper story, a flight home, a wide establishing shot, an arc
  // on another ship). Whatever runs, a carrier hit (any weapon) or a battleship hit by a bomb / torpedo / heavy shell, a
  // magazine or a sinking due in GUARD_WIN real s gets the brace on her, unless the camera already shows her (the impact
  // point in frame and near), or the running shot is the last seconds of an attack (a carrier struck still breaks into an
  // attack on a smaller ship). Inside a story the brace is an insert (the story resumes after); else a cut.
  const GUARD_WIN = [1.0, 8], GUARD_K = { torp: 1, bomb: 1, dive: 1, mag: 1, sink: 1, shellbig: 1 };
  let guarded = new WeakMap();
  const guardStats = () => (ST.guard = ST.guard || { n: 0, insert: 0, cut: 0, inView: 0, release: 0 });
  function inView(x, y, z, maxD) {
    const c = WW.camera; if (!c || !_hv) return false;
    if (Math.hypot(c.position.x - x, c.position.z - z) > maxD) return false;
    _hv.set(x, y, z).project(c); return _hv.z < 1 && Math.abs(_hv.x) < 0.85 && Math.abs(_hv.y) < 0.8;
  }
  function lockTarget(shot) {
    if (shot.tship) return shot.tship;
    const p = shot.plane || shot.subj; if (!p) return null;
    return p.stats ? p : p.diveTgt || p.target || null;
  }
  function guard(shot, st) {
    const now = wall();
    for (const e of evs()) {
      const s = e.s, cv = s.type === 'carrier';
      if (!cv && s.type !== 'battleship') continue;
      if (!GUARD_K[e.kind] || e.etaReal < GUARD_WIN[0] || e.etaReal > GUARD_WIN[1]) continue;
      if ((guarded.get(s) || -1e9) > now - 3) continue;                       // (no flapping: a guard brace runs to its hits and beat)
      if (shot && shot.kind === 'brace' && shot.subj === s) continue;
      if (inView(s.x + e.ox, 2, s.z + e.oz, 380)) { guardStats().inView++; continue; }   // already in the shot
      const L = shot && WW.camLock && WW.camLock.state(shot);
      if (shot && (shot.stage || (L && L.release))) {                        // the last seconds of an attack
        const tg = lockTarget(shot);
        if (!cv || (tg && tg.stats && (tg.type === 'carrier' || tg.type === 'battleship'))) { guardStats().release++; continue; }
      }
      const b = { kind: 'brace', subj: s, ev: e, hold: e.raw, pr: e.raw, dur: WW.clamp(e.lastReal + 2.6, 4, 12), why: e.kind, label: D().labelOf ? D().labelOf(e) : '', guard: true };
      guarded.set(s, now);
      const G = guardStats(); G.n++;
      if (st && st.begun && S().insert && !(shot && shot.stage) && S().insert(b)) { G.insert++; return true; }
      if (WW.cam.take(b, { steal: true })) { G.cut++; return true; }
    }
    return false;
  }
  function tick(rdt) {
    if (active() && _hv) { try { hold(); } catch (e) { /* never break the camera */ } }
    if ((tk -= rdt) > 0) return;
    tk = TICK;
    if (!active() || !(WW.game && WW.game.state === 'battle') || WW.cam.mode !== 'director' || (WW.freecam && WW.freecam.active()) || WW.cam.forced()) return;
    const shot = WW.cam._shot();
    if (shot && shot.user && !shot.fkey) return;
    const st = S() && S().story();
    if ((st && st.user) || (D().userArc && D().userArc())) return;
    if (guard(shot, st)) return;
    // a planned story that never got the camera (night_fx.js refused it, the lead lost before its first shot): that strike
    // rests 30 s (no re-planning it every tick)
    if (cur && cur.arc && cur.arc.t1 && cur.arc.never && !cur.banned) { cur.banned = true; ban.set(cur.it.wave || cur.it.target, wall() + 30); ST.never = (ST.never || 0) + 1; }
    const P = plan().filter(it => !((ban.get(it.wave || it.target) || 0) > wall())); if (!P.length) return;
    const L = shot && WW.camLock && WW.camLock.state(shot);
    const busy = arcRunning();
    // a carrier strike whose window is open supersedes an arc not about her (a clean cut, from the raid inbound)
    // (the biggest carrier arc open now, unless a bigger one opens before it would be over)
    const cvs = P.filter(it => it.cv && it.openR <= 0 && it.lateR > 0 && !runningAbout(it));
    const cv = cvs.find(it => !P.some(o => o !== it && o.cv && o.value > it.value * 1.5 && o.openR > 0 && o.earlyR < it.endR && o.lateR > 0));
    if (cv && busy) {
      if (cur && cur.it.cv && cur.it.target === cv.target) return;
      if (shot && (shot.stage || (L && L.release))) return;                 // never the last seconds of an attack
      const mine = cur && cur.it;
      if (mine && mine.cv && mine.value >= cv.value) return;
      const left = cur ? cur.climaxAt - wall() : 1e9;
      if (mineRunning() && left > -2 && left < 10 && left < cv.climaxR - 2 && cur.it.value >= cv.value * 0.6) return; // the running arc's own climax lands first and soon (and is worth it): let it land
      if (mineRunning() && left > -2 && left < 4) return;
      if (st && S().supersede) S().supersede();
      const target = cv.kind === 'strike' && protagonist(cv) ? cv : cvRaid(cv);
      if (startItem(target, 'cv-supersede')) ST.superseded++;
      return;
    }
    // a running arc camera4's pickers started (no plan opened then): a planned arc worth more takes over in its quiet part
    if (busy && !mineRunning() && shot && !shot.stage && !(L && L.release)) {
      const ph = st && st.begun ? (S()._dbg() || {}).phase : 'ship';
      const quiet = ph === 'transit' || ph === 'form' || ph === 'home' || ph === 'launch' || ph === 'after' || ph === 'ship';
      // (camera6: a story nobody planned that is not a strike (a CAP fight, a flying boat, an ace) is filler: any planned
      // arc whose window opens takes over in any phase (they held 55% of the camera time while ships were struck))
      const filler = !!(st && st.begun && st.mission !== 'strike');
      const b = P.find(it => it.openR <= 0 && it.lateR > 0 && it.value >= (filler ? MINV : SUPER) && !runningAbout(it));
      if (b && filler) {
        if (S().supersede) S().supersede();
        if (startItem(b, 'take-over')) ST.superseded++;
        return;
      }
      if (b && quiet) {
        if (st && S().supersede) S().supersede(); else if (D().endShipArc) D().endShipArc('superseded');
        if (startItem(b, 'take-over')) ST.superseded++;
        return;
      }
    }
    // a planned ship arc is over a beat after its climax (no minutes of orbiting the aftermath)
    if (busy && mineRunning() && cur.it.kind !== 'strike' && wall() > cur.endAt && shot && !shot.stage && !(L && L.release) && D().endShipArc) { D().endShipArc('complete'); return; }
    if (busy) return;
    if (st && !st.begun) return;                                             // a planned story waiting for the running shot to end
    if (shot && (shot.stage || (L && L.release) || shot.pr >= 99 || shot.finale)) return;
    if (shot && shot.t < 2.5 && !(cv)) return;
    // the best arc whose window is open now, and that ends before a bigger arc must start
    const open = P.filter(it => it.openR <= 0 && it.lateR > 0 && it.value >= MINV);
    for (const it of open) {
      const clash = P.find(o => o !== it && o.value > it.value * 1.2 && o.earlyR < it.endR && o.lateR > 0 && o.openR > 0 && (o.cv || o.value > it.value * 2));
      if (clash) continue;                                                   // a bigger arc opens before this one would end: wait for it
      if (it.kind === 'strike') { if (startItem(it, 'plan')) return; }
      else if (startItem(it, 'plan')) return;
    }
    // a carrier struck with no arc open on her (a ship's torpedo, a late discovery): her raid arc, the hit in frame
    const late = P.find(it => it.cv && it.climaxR > 3 && it.climaxR < 14);
    if (late) startItem(late.kind === 'strike' && protagonist(late) ? late : cvRaid(late), 'cv-late');
  }
  if (WW.cam && WW.cam.update) { const u = WW.cam.update; WW.cam.update = function (rdt) { try { tick(rdt || 0); } catch (e) { console.error('camLook', e); } return u.apply(this, arguments); }; }
  WW.on('roundStart', () => { cur = null; tk = 0; ban = new WeakMap(); guarded = new WeakMap(); evCache = plCache = null; evAt = plAt = -1; });

  WW.camLook = {
    active, storyBrace, handoffLetGo, holdAim, events: evs, forecastFor: s => evs().find(e => e.s === s) || null, plan, protagonist, successorHint, stats: ST, log,
    // camera_director.js / camera_story.js: the look-ahead chooses the arcs (their own pickers stand down)
    owns,
    // the after-battle reel: prefer({ tg: 's12' | 'base', src: 's4' (optional), n0, n1 (live steps) }) or prefer(null)
    prefer(spec) { pref = spec || null; plCache = null; }
  };
})(window.WW);
