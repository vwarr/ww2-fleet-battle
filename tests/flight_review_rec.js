// Page side of tests/flight_review.js: a read-only flight-data recorder. install(opts) runs inside the game page
// (sent as source text, so it is self-contained) and sets window.__rec. It never calls WW.rand and never writes to
// sim objects: it wraps WW.air.update (samples every 0.25 sim s after the air step), WW.air.launch, WW.strike.newWave,
// Plane.prototype.shotDown / ditch (pass-through), and listens to bus events. __rec.flush() returns one round's data.
//
// Phases (per plane, per sample): deck, takeoff, formup, transit, approach, search, cap, recall, escort_tgt,
// intercept (foe is a bomber), dogfight (foe is a fighter), wheel, dive, pullout, anvil, torprun, popup, level,
// return, pattern, trap; scouts / flying boats: o_<state>.
// Categories (time budgets): deck, launch, formup, transit, patrol, fight, attack, return, landing.
function install(opts) {
  opts = opts || {};
  const R = window.__rec = { err: 0 };
  const DT = opts.dt || 0.25, PI = Math.PI, ALONE = opts.alone || 30, STRAG = 60, CIRC_W = 40; // 40 samples = 10 s window
  const HS = { spd: [0, 100, 1], gs: [0, 100, 1], alt: [0, 100, 0.5], vy: [-60, 40, 1], tr: [0, 4, 0.05], bank: [0, 1.5, 0.05], fpa: [-90, 60, 1] };
  const CAT = { deck: 'deck', trap: 'deck', takeoff: 'launch', formup: 'formup', transit: 'transit', approach: 'transit', search: 'transit', recall: 'transit',
    cap: 'patrol', escort_tgt: 'patrol', intercept: 'fight', dogfight: 'fight', wheel: 'attack', dive: 'attack', pullout: 'attack', anvil: 'attack',
    torprun: 'attack', popup: 'attack', level: 'attack', return: 'return', pattern: 'landing' };
  const AIR = { formup: 1, transit: 1, approach: 1, search: 1, recall: 1, cap: 1, escort_tgt: 1, intercept: 1, dogfight: 1, wheel: 1, dive: 1, pullout: 1, anvil: 1, torprun: 1, popup: 1, level: 1, return: 1 };
  const ALONE_PH = { formup: 1, transit: 1, cap: 1, return: 1, approach: 1 };
  const isShip = o => !!(o && (o.hangar !== undefined || o.stats) && o.kind === undefined);
  const armed = u => u && u.alive && (u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance;
  const now = () => (WW.game ? WW.game.roundTime : WW.time.now);
  let S = null, nextId = 1;

  function origin(p) { return p.kind === 'scout' ? 'scout' : p.kind === 'flyingboat' ? 'fb' : p.carrier && p.carrier.isBase ? 'base' : 'cv'; }
  function tgtOf(p) { const w = p.wave; return (w && w.target) || p.target || null; }
  function phase(p) {
    const s = p.state;
    if (p.kind === 'scout' || p.kind === 'flyingboat') return 'o_' + s;
    if (s === 'rollout') return 'trap';
    if (s === 'takeoff') return p.deckPh && p.deckPh !== 'climb' ? 'deck' : 'takeoff';
    if (s === 'landing') return 'pattern';
    if (s === 'return') return 'return';
    if (s !== 'transit' && s !== 'attack') return 'o_' + s;
    if (p.search) return 'search';
    if (p.sk === 'form' && p.wave) return p.wave.go ? 'transit' : 'formup';
    if (p.kind === 'fighter') {
      if (p.foe && p.foe.alive) return p.foe.kind === 'fighter' ? 'dogfight' : 'intercept';
      if (p.recall) return 'recall';
      return p.target ? 'escort_tgt' : 'cap';
    }
    if (p.level) return 'level';
    if (p.kind === 'dive') {
      if (p.phase === 'roll' || p.phase === 'dive') return 'dive';
      if (p.phase === 'pull' || p.phase === 'exit') return 'pullout';
      const t = tgtOf(p); return t && WW.dist(p.x, p.z, t.x, t.z) < 40 ? 'wheel' : 'approach';
    }
    if (p.phase === 'run') return 'torprun';
    if (p.phase === 'out') return 'popup';
    if (p.sk === 'anvil') return 'anvil';
    return 'approach';
  }
  function role(p) { return p.search ? 'search' : p.kind === 'fighter' ? (p.target || p.wave ? 'escort' : 'cap') : 'strike'; }
  function hAdd(key, m, v) {
    const H = S.H[key] || (S.H[key] = { n: 0, mx: {} }), sp = HS[m];
    const a = H[m] || (H[m] = new Array(Math.round((sp[1] - sp[0]) / sp[2]) + 1).fill(0));
    a[Math.max(0, Math.min(a.length - 1, Math.round((v - sp[0]) / sp[2])))]++;
    if (!(H.mx[m] >= v)) H.mx[m] = +v.toFixed(2);
  }
  function minute() { const m = Math.floor(now() / 60); while (S.min.length <= m) S.min.push({ air: 0, samp: 0, eng: 0, drops: 0, bombs: 0, torps: 0, aaK: 0, ftrK: 0, otherL: 0, shells: 0, gunDmg: 0, airDmg: 0, otherDmg: 0, launch: 0, trap: 0, sunk: 0, cap: 0, strikeAir: 0, circ: 0 }); return S.min[m]; }
  function sepNow() { // min distance between enemy surface ships (no subs, no base)
    let m = 1e9; const L = WW.world.ships.filter(s => s.alive && !s.sinking && !s.isBase && s.type !== 'submarine');
    for (const a of L) for (const b of L) if (a.nation === 'USN' && b.nation === 'IJN') m = Math.min(m, WW.dist(a.x, a.z, b.x, b.z));
    return m === 1e9 ? null : Math.round(m);
  }
  function cvSep() { let m = 1e9; const L = WW.world.ships.filter(s => s.alive && s.type === 'carrier'); for (const a of L) for (const b of L) if (a.nation === 'USN' && b.nation === 'IJN') m = Math.min(m, WW.dist(a.x, a.z, b.x, b.z)); return m === 1e9 ? null : Math.round(m); }
  function first(k, extra) { if (S.first[k] === undefined) { S.first[k] = +now().toFixed(1); S.first[k + 'Sep'] = sepNow(); if (extra) Object.assign(S.first, extra); } }

  function fresh() {
    S = { H: {}, sorties: [], recs: new Map(), eng: [], drops: [], deaths: [], waves: [], wrec: new Map(), min: [], first: {}, pilots: new Map(),
      deckCycle: [], next: 0, nextSlow: 0, alone: {}, lead: [], fdir: {}, foeFirst: new Map(), proj: new Map(), hang: [], cvL: {}, cvT: {},
      escPos: [], trace: opts.trace ? [] : null, push: [], deck: {}, trapT: {}, trapGap: [], contact: {} };
  }
  fresh();
  WW.on('roundStart', fresh);

  function rec(p) {
    let r = S.recs.get(p);
    if (r) return r;
    r = { id: nextId++, nation: p.nation, kind: p.kind, v: p.variant || null, o: origin(p), cv: p.carrier ? p.carrier.id : null, t0: +now().toFixed(2), t1: null, end: null,
      role: role(p), b: {}, circ: {}, ph: null, lx: p.x, ly: p.y, lz: p.z, lh: null, ring: [], cum: 0, eng: null, pilot: null, kills: 0, air: 0, first: null, armed0: !!p.ordnance, dropped: false, jett: false };
    S.recs.set(p, r); S.sorties.push(r);
    return r;
  }
  function closeEng(r, p) {
    const e = r.eng; if (!e) return;
    const f = e.foe;
    S.eng.push({ n: r.nation, k: r.kind, role: e.role, fk: e.fk, armed: e.armed, d: +(now() - e.t0).toFixed(2), kill: !!(f && !f.alive && (f.killedBy === p || e.killed)), dcv: e.dcv, mode: e.mode });
    r.eng = null;
  }
  function endSortie(p, r, how) {
    if (r.t1 !== null) return;
    r.t1 = +now().toFixed(2); r.end = how; closeEng(r, p);
  }

  // ---------- hooks ----------
  const L0 = WW.air.launch;
  WW.air.launch = function (cv) {
    const p = L0.apply(this, arguments);
    try { if (p && S) { const r = rec(p); r.role = role(p); minute().launch++; (S.cvL[cv.id] = S.cvL[cv.id] || {})[Math.floor(now() / 60)] = ((S.cvL[cv.id] || {})[Math.floor(now() / 60)] || 0) + 1; first('launch'); } } catch (e) { R.err++; R.lastErr = String(e.stack); }
    return p;
  };
  if (WW.strike && WW.strike.newWave) {
    const N0 = WW.strike.newWave;
    WW.strike.newWave = function (carrier, target) {
      const before = new Set(WW.strike._waves());
      const w0 = N0.apply(this, arguments);
      try {
        for (const w of WW.strike._waves()) if (!before.has(w) && S) {
          const wr = { id: S.waves.length + 1, n: w.nation, cv: carrier.id, base: !!carrier.isBase, mode: w.mode, first: !!w.first, tt: target ? target.type : null,
            tOrder: +now().toFixed(1), dOrder: target ? Math.round(WW.dist(carrier.x, carrier.z, target.x, target.z)) : null, pend: Object.assign({}, w.pend),
            tUp: null, tGo: null, dGo: null, tArr: null, drops: [], fs: 0, fsN: 0, strag: 0, stragN: 0, altF: 0, altD: 0, altT: 0, nF: 0, nD: 0, nT: 0, spread: 0, sepMin: 1e9, members: 0 };
          S.waves.push(wr); S.wrec.set(w, wr);
          first('order');
        }
      } catch (e) { R.err++; R.lastErr = String(e.stack); }
      return w0;
    };
  }
  const PP = WW.Plane.prototype, SD0 = PP.shotDown, DI0 = PP.ditch;
  function death(p, how) {
    if (!S || !p.alive) return;
    const r = rec(p), kb = p.killedBy;
    let cause = how;
    if (how === 'shot') cause = kb instanceof WW.Plane ? 'fighter' : kb && (kb.type || kb.isBase || kb.stats) ? 'aa' : 'other';
    else if (p.carrier && !p.carrier.alive) cause = 'cv_lost';
    else if (p.fuel !== undefined && p.fuel <= 0) cause = 'fuel';
    const c = p.carrier;
    S.deaths.push({ n: p.nation, k: p.kind, o: r.o, v: r.v, cause, ph: r.ph || phase(p), armed: !!p.ordnance, t: +now().toFixed(1), dcv: c ? Math.round(WW.dist(p.x, p.z, c.x, c.z)) : null, role: r.role });
    const m = minute(); if (cause === 'aa') m.aaK++; else if (cause === 'fighter') m.ftrK++; else m.otherL++;
    if (cause === 'aa' || cause === 'fighter') first('kill');
    endSortie(p, r, cause);
  }
  PP.shotDown = function () { try { death(this, 'shot'); } catch (e) { R.err++; R.lastErr = String(e.stack); } return SD0.apply(this, arguments); };
  PP.ditch = function () { try { death(this, 'ditch'); } catch (e) { R.err++; R.lastErr = String(e.stack); } return DI0.apply(this, arguments); };

  WW.on('planeKill', e => { if (!S || !e || !e.shooter) return; const r = S.recs.get(e.shooter); if (r) { r.kills++; if (r.eng && r.eng.foe === e.victim) r.eng.killed = true; } });
  WW.on('weaponDropped', e => {
    if (!S || !e || !e.plane || !(e.plane instanceof WW.Plane)) return;   // ships' torpedoes emit it too
    const p = e.plane, r = rec(p), t = e.target || p.target || (p.wave && p.wave.target) || null, w = p.wave && S.wrec.get(p.wave);
    const sp = p.speed || 0, vy = p.vy || 0;
    const d = { t: +now().toFixed(2), kind: e.kind, n: p.nation, pk: p.kind, v: r.v, o: r.o, level: !!p.level, y: +p.y.toFixed(1), spd: +Math.hypot(sp, vy).toFixed(1), gs: +sp.toFixed(1),
      fpa: +(Math.atan2(vy, Math.max(0.1, sp)) * 180 / PI).toFixed(1), tt: t ? t.type : null, dT: t ? +WW.dist(p.x, p.z, t.x, t.z).toFixed(1) : null,
      off: t ? Math.round(Math.abs(WW.angleDiff(t.heading, Math.atan2(p.z - t.z, p.x - t.x))) * 180 / PI) : null,
      side: t ? Math.sign(WW.angleDiff(t.heading, Math.atan2(p.z - t.z, p.x - t.x))) : 0, wave: w ? w.id : null, tid: t ? t.id : null,
      push: r.pushY !== undefined ? r.pushY : null, rollT: r.rollT !== undefined ? +(now() - r.rollT).toFixed(2) : null, hit: null, sep: sepNow() };
    r.dropped = true;
    S.drops.push(d); if (e.proj) S.proj.set(e.proj, d);
    if (w) w.drops.push(d.t);
    const m = minute(); m.drops++; if (e.kind === 'bomb') m.bombs++; else m.torps++;
    if (r.o === 'cv' || r.o === 'base') first('drop');
  });
  WW.on('weaponImpact', e => {
    if (!S || !e) return;
    const d = S.proj.get(e.proj); if (!d) return;
    S.proj.delete(e.proj);
    d.hit = e.ship ? (e.ship.nation === d.n ? 'own' : e.dud ? 'dud' : e.ship.id === d.tid ? 'tgt' : 'other') : 'miss';
  });
  WW.on('shellFired', e => {
    if (!S || !e || !e.ship || e.cal === 'mg') return;
    minute().shells++;
    const tg = e.proj && e.proj.target, who = { gunWho: e.ship.type + (e.ship.isBase ? '(base)' : '') + '>' + (tg ? tg.type || tg.kind || '?' : '-') + ' d' + (tg ? Math.round(WW.dist(e.ship.x, e.ship.z, tg.x, tg.z)) : '-') };
    if (!e.ship.isBase && e.ship.type !== 'battery' && tg && !tg.isBase && tg.type && tg.type !== 'battery') { first('gun', who); if (e.cal === 'med' || e.cal === 'big') first('bigGun'); }
    else first('anyGun', { anyGunWho: who.gunWho });
  });
  WW.on('shipHit', e => {
    if (!S || !e || !e.ship || !(e.amount > 0)) return;
    const m = minute(), k = e.kind;
    if (k === 'bomb' || k === 'torpedo' || k === 'strafe' || k === 'crash') { m.airDmg += e.amount; first('airDmg'); }
    else if (k === 'shell' || k === 'hits' || k === undefined || k === null) { m.gunDmg += e.amount; first('gunDmg'); }
    else m.otherDmg += e.amount;
    if (k && !S.first['k_' + k]) S.first['k_' + k] = 1;
  });
  WW.on('shipSunk', () => { if (S) minute().sunk++; });

  // ---------- the sampler ----------
  const U0 = WW.air.update;
  WW.air.update = function () {
    const r0 = U0.apply(this, arguments);
    try { if (S && WW.game && WW.game.state === 'battle') while (now() >= S.next) { S.next += DT; sample(); } } catch (e) { R.err++; R.lastErr = String(e.stack); }
    return r0;
  };
  function sample() {
    const t = now(), M = minute(), P = WW.world.planes, live = [];
    for (const p of P) {
      if (!p.alive || p.removed) {
        const r = S.recs.get(p);
        if (r && r.t1 === null) endSortie(p, r, r.ph === 'trap' || r.ph === 'pattern' ? 'landed' : 'other:' + r.ph);
        continue;
      }
      live.push(p);
    }
    // landed planes are removed between samples: close sorties whose plane left the list
    if (S.nextSlow <= t) {
      for (const [p, r] of S.recs) if (r.t1 === null && (p.removed || P.indexOf(p) < 0)) endSortie(p, r, r.ph === 'trap' || r.ph === 'pattern' ? 'landed' : 'other:' + r.ph);
    }
    const byMission = new Map();
    for (const p of live) {
      const r = rec(p), ph = phase(p);
      if (r.pilot === null && p.pilot) { r.pilot = p.pilot; const lt = S.pilots.get(p.pilot); if (lt !== undefined && r.o === 'cv') S.deckCycle.push(+(r.t0 - lt).toFixed(1)); }
      if (ph === 'trap' && r.ph !== 'trap') { minute().trap++; if (r.cv !== null) (S.cvT[r.cv] = S.cvT[r.cv] || {})[Math.floor(t / 60)] = ((S.cvT[r.cv] || {})[Math.floor(t / 60)] || 0) + 1; if (p.pilot) S.pilots.set(p.pilot, t);
        const c = p.carrier, D = c && c._deck; if (c && !c.isBase) { const lt = S.trapT[c.id]; if (lt !== undefined && D && D.lq.length > 0) S.trapGap.push(+(t - lt).toFixed(2)); S.trapT[c.id] = t; } }
      if (ph === 'dive' && r.ph !== 'dive' && p.phase === 'roll') { r.pushY = +p.y.toFixed(1); r.rollT = t; S.push.push({ n: p.nation, y: +p.y.toFixed(1) }); }
      // kinematics by finite difference
      const dx = p.x - r.lx, dz = p.z - r.lz, dy = p.y - r.ly, gd = Math.hypot(dx, dz), gs = gd / DT, vy = dy / DT, spd = Math.hypot(gs, vy);
      const h = gd > 0.3 ? Math.atan2(dz, dx) : r.lh;
      const tr = r.lh !== null && h !== null && gd > 0.3 ? Math.abs(WW.angleDiff(r.lh, h)) / DT : null;
      r.lx = p.x; r.ly = p.y; r.lz = p.z; r.lh = h;
      r.cum += gd; r.ring.push([p.x, p.z, r.cum]); if (r.ring.length > CIRC_W + 1) r.ring.shift();
      let circ = false;
      if (r.ring.length > CIRC_W && AIR[ph]) { const o = r.ring[0], path = r.cum - o[2], net = Math.hypot(p.x - o[0], p.z - o[1]); circ = path > 40 && net < 0.4 * path; }
      const cat = CAT[ph] || 'other';
      r.b[cat] = (r.b[cat] || 0) + DT;
      if (ph === 'pattern' && p.deckPh === 'marshal') r.b.marshal = (r.b.marshal || 0) + DT;   // holding in the marshal stack (part of the pattern)
      if (circ) {
        const c = p.carrier, tg = tgtOf(p);
        const where = c && WW.dist(p.x, p.z, c.x, c.z) < 70 ? 'cv' : tg && WW.dist(p.x, p.z, tg.x, tg.z) < 70 ? 'tgt' : 'else';
        r.circ[cat + ':' + where] = (r.circ[cat + ':' + where] || 0) + DT;
        if (r.o === 'cv') M.circ++;
      }
      if (AIR[ph]) { r.air += DT; if (r.o === 'cv' || r.o === 'base') { M.air++; if (p.kind === 'fighter' && !p.target && !p.search) M.cap++; else M.strikeAir++; } }
      if (r.armed0 && !p.ordnance && !r.dropped && !r.jett) r.jett = true;
      if (r.wv === undefined && AIR[ph] && p.kind !== 'fighter' && !p.search && !p.level && (p.wave !== undefined || !WW.strike)) r.wv = p.wave ? (p.wave.go ? 'late' : 'formed') : 'none'; // joined its wave while it formed / after it left / never
      r.ph = ph;
      const key = r.o + '|' + p.nation + '|' + (r.v || p.kind) + '|' + ph, H = S.H[key] || (S.H[key] = { n: 0, mx: {} });
      H.n++;
      if (r.ring.length > 1 && gd < 60) {   // skip teleports (deck adoption)
        hAdd(key, 'spd', spd); hAdd(key, 'gs', gs); hAdd(key, 'alt', p.y); hAdd(key, 'vy', vy); hAdd(key, 'bank', Math.abs(p.roll || 0));
        hAdd(key, 'fpa', Math.atan2(vy, Math.max(0.1, gs)) * 180 / PI);
        if (tr !== null) hAdd(key, 'tr', tr);
      }
      // fighters: engagements, aimless time, defence
      if (p.kind === 'fighter' && (r.o === 'cv' || r.o === 'base')) {
        const foe = p.foe && p.foe.alive ? p.foe : null;
        if (!r.eng || r.eng.foe !== foe) {
          closeEng(r, p);
          if (foe) {
            const c = p.carrier;
            r.eng = { foe, t0: t, role: role(p), fk: foe.kind, armed: armed(foe), dcv: c ? Math.round(WW.dist(foe.x, foe.z, c.x, c.z)) : null, mode: p.df ? p.df.mode : null };
            if (armed(foe) && role(p) === 'cap' && !S.foeFirst.has(foe)) S.foeFirst.set(foe, { n: p.nation, d: r.eng.dcv, t });
          }
        }
        if (AIR[ph] && ph !== 'return' && ph !== 'search') {
          const rl = role(p), F = S.fdir[p.nation + '|' + rl] || (S.fdir[p.nation + '|' + rl] = { t: 0, foe: 0, foeB: 0, foeF: 0, idleRaid: 0, def: 0, circ: 0, modes: {} });
          F.t += DT; if (circ) F.circ += DT;
          if (foe) { F.foe += DT; if (foe.kind === 'fighter') F.foeF += DT; else F.foeB += DT; if (p.df && p.df.def) F.def += DT; const md = p.df ? p.df.mode : '?'; F.modes[md] = (F.modes[md] || 0) + DT; }
          else if (rl === 'cap' && p.carrier) { // a raid is near the carrier and this CAP fighter has nobody
            for (const q of live) if (q.nation !== p.nation && armed(q) && WW.dist(q.x, q.z, p.carrier.x, p.carrier.z) < 160) { F.idleRaid += DT; break; }
          }
          if (foe) M.eng++;
        }
      }
      if (ALONE_PH[ph] && (r.o === 'cv' || r.o === 'base')) {
        const k = (p.carrier ? p.carrier.id : 0) + ':' + p.kind + ':' + role(p);
        let L = byMission.get(k); if (!L) byMission.set(k, L = []); L.push(p);
      }
      if (p.leader && p.leader.alive && (ph === 'cap' || ph === 'transit' || ph === 'formup') && S.lead.length < 40000) S.lead.push(+Math.hypot(p.x - p.leader.x, p.y - p.leader.y, p.z - p.leader.z).toFixed(1));
      if (S.trace && (Math.round(t / DT) % 2 === 0)) S.trace.push([+t.toFixed(2), r.id, p.nation[0], p.kind[0], ph, +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), +spd.toFixed(1), p.foe ? (S.recs.get(p.foe) || {}).id || -1 : 0, p.wave && S.wrec.get(p.wave) ? S.wrec.get(p.wave).id : 0]);
    }
    // alone: no plane of the same mission (carrier, kind, cap / strike) within ALONE
    for (const L of byMission.values()) for (const p of L) {
      const ph = S.recs.get(p).ph, A = S.alone[p.nation + '|' + p.kind + '|' + ph] || (S.alone[p.nation + '|' + p.kind + '|' + ph] = { t: 0, alone: 0, nn: 0 });
      let nd = 1e9; for (const q of L) if (q !== p) nd = Math.min(nd, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
      A.t += DT; if (nd > ALONE) A.alone += DT; if (nd < 1e9) A.nn += nd * DT;
    }
    // waves in the air: first up, departure, formation quality in transit
    for (const [w, wr] of S.wrec) {
      if (wr.tUp === null && w.t1 >= 0) wr.tUp = +t.toFixed(1);
      if (wr.cvLost === undefined && !w.carrier.alive) wr.cvLost = +t.toFixed(1);
      if (wr.tGo === null && w.go) { wr.tGo = +t.toFixed(1); wr.formed = w.why ? w.why === 'formed' : null; const tg = w.target; wr.dGo = tg ? Math.round(WW.dist(w.x, w.z, tg.x, tg.z)) : null; }
      wr.members = Math.max(wr.members, w.members.filter(q => q.alive).length);
      if (!w.go || w.done) continue;
      if (wr.tArr === null && w.dT < 140) wr.tArr = +t.toFixed(1);
      const F = w.members.filter(q => q.alive && q.sk === 'form' && (q.state === 'transit' || q.state === 'attack') && !q.phase && !q.strafe); // a strafing escort is not in the formation
      if (F.length < 2) continue;
      let cx = 0, cz = 0; for (const q of F) { cx += q.x; cz += q.z; } cx /= F.length; cz /= F.length;
      const B = F.filter(q => q.kind !== 'fighter'); let bx = 0, bz = 0, by = 0; for (const q of B) { bx += q.x; bz += q.z; by += q.y; } if (B.length) { bx /= B.length; bz /= B.length; by /= B.length; }
      let sp = 0, st = 0;
      for (const q of F) {
        const d = WW.dist(q.x, q.z, cx, cz); sp = Math.max(sp, d); if (d > STRAG) st++;
        if (q.kind === 'fighter') { wr.altF += q.y; wr.nF++; if (B.length && S.escPos.length < 20000) { const c = Math.cos(w.h), s = Math.sin(w.h), ex = q.x - bx, ez = q.z - bz; S.escPos.push([+(ex * c + ez * s).toFixed(0), +(-ex * s + ez * c).toFixed(0), +(q.y - by).toFixed(0), q.cover === 'top' ? 1 : 0]); } }
        else if (q.kind === 'dive') { wr.altD += q.y; wr.nD++; } else { wr.altT += q.y; wr.nT++; }
        for (const o of F) if (o !== q) wr.sepMin = Math.min(wr.sepMin, Math.hypot(o.x - q.x, o.y - q.y, o.z - q.z));
      }
      wr.spread += sp; wr.fs += 1; wr.strag += st; wr.stragN += F.length;
    }
    // carriers: air group state every 5 s
    if (S.nextSlow <= t) {
      S.nextSlow = t + 5;
      if (S.trace) for (const s of WW.world.ships) if (s.alive && !s.isBase && s.type !== 'battery') S.trace.push([+t.toFixed(1), -(s.id + 1), s.nation[0], s.type, s.sinking ? 'sinking' : 'ship', +s.x.toFixed(0), 0, +s.z.toFixed(0), +(s.speed || 0).toFixed(1), 0, 0]);
      for (const s of WW.world.ships) {
        if (!s.alive || !s.hangar) continue;
        const h = s.hangar, hg = (h.fighter || 0) + (h.dive || 0) + (h.torpedo || 0), rearm = s.rearm ? s.rearm.length : 0;
        let air = 0, deck = 0; for (const p of live) if (p.carrier === s) { const ph = S.recs.get(p).ph; if (ph === 'deck' || ph === 'trap') deck++; else air++; }
        S.hang.push({ t: Math.round(t), n: s.nation, base: !!s.isBase, cv: s.id, hg, rearm, air, deck, q: s.ai && s.ai.queue ? s.ai.queue.length : 0 });
      }
    }
    for (const s of WW.world.ships) {
      const D = s._deck; if (!s.alive || !D || s.isBase) continue;
      const K = S.deck[s.nation] || (S.deck[s.nation] = { t: 0, launch: 0, recover: 0, idle: 0, lq: 0, queued: 0, blocked: 0, both: 0 });
      K.t += DT; K[D.mode] = (K[D.mode] || 0) + DT; K.lq += D.lq.length * DT;
      const q = D.launchers.filter(p => p.deckPh === 'queued').length; K.queued += q * DT;
      if (q && D.mode !== 'launch') K.blocked += DT;
      if (q && D.lq.length) K.both += DT;
    }
    if (WW.intel && WW.intel.contacts) for (const n of ['USN', 'IJN']) {
      if (S.contact[n]) continue;
      for (const c of WW.intel.contacts(n)) if (c.unit && c.unit.stats && c.unit.nation !== n && !c.unit.isBase && c.unit.type !== 'battery') { const by = c.by; S.contact[n] = { t: +c.firstSeenAt.toFixed(1), by: by ? by.kind || by.type || '?' : '?', what: c.unit.type, sep: sepNow() }; break; }
    }
    M.samp++;
  }

  R.flush = function () {
    if (!S) return null;
    for (const [p, r] of S.recs) if (r.t1 === null) endSortie(p, r, p.alive ? 'roundEnd' : 'other');
    const sorties = S.sorties.map(r => ({ n: r.nation, k: r.kind, v: r.v, o: r.o, role: r.role, t0: r.t0, t1: r.t1, end: r.end, b: r.b, circ: r.circ, air: +r.air.toFixed(1), kills: r.kills, wv: r.wv || null, out: r.armed0 ? (r.dropped ? 'dropped' : r.jett ? 'jettison' : r.end === 'roundEnd' ? 'armedAtEnd' : r.end === 'landed' ? 'landedArmed' : 'lostArmed') : null }));
    const ff = []; for (const v of S.foeFirst.values()) ff.push(v);
    const W = S.waves.map(w => Object.assign({}, w, { sepMin: w.sepMin === 1e9 ? null : +w.sepMin.toFixed(1) }));
    const out = { H: S.H, sorties, eng: S.eng, drops: S.drops, deaths: S.deaths, waves: W, min: S.min, first: S.first, deckCycle: S.deckCycle, alone: S.alone, lead: S.lead,
      fdir: S.fdir, foeFirst: ff, hang: S.hang, cvL: S.cvL, cvT: S.cvT, escPos: S.escPos, push: S.push, trace: S.trace, err: R.err, lastErr: R.lastErr || null,
      cvSep0: S.cvSep0 || null, deck: S.deck, trapGap: S.trapGap, contact: S.contact, stats: { launched: WW.stats.planesLaunched, landed: WW.stats.planesLanded, lost: WW.stats.planesLost } };
    return out;
  };
  WW.on('roundStart', () => { if (S) S.cvSep0 = cvSep(); });
  return true;
}
module.exports = { install };
