// Common-sense auditor, the page side (tests/sanity.js runs it over many rounds; tests/sim_behaviour.js runs a light
// subset as WARN checks). install(P) is sent to the page as source text (like sim_behaviour's install): it must not
// close over Node variables. It adds window.__san = { begin(meta), sample(dt), end() -> round record }.
// READ-ONLY: it only reads positions / states / intel contacts and listens to bus events. It never calls WW.rand or
// Math.random, never calls a game function that caches or steers (no WW.cap.bearing, no airOps.picture), and keeps
// its per-unit state in WeakMaps (no fields written on game objects), so a round runs bit-identically with or without it.
//
// Each rule is judged per sample (P.DT s). A violation is an EPISODE: the condition true for at least the rule's
// minDur s (gaps < GAP s join up); one episode per (rule, unit[, other unit]). Per round each rule reports
// n (episodes), s (episode seconds) and up to EX_KEEP examples (the longest), with ids, positions and a detail string.
// The rules, thresholds and why they are what they are: tests/sanity.js RULES (the Node side) and docs/ARCHITECTURE.md.
'use strict';
function install(P) {
  const S = window.__san = {}, PI = Math.PI;
  const live = s => s && s.alive && !s.sinking && !s.removed && !s.isBase && s.type !== 'base';
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const brg = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  const cosTo = (h, a, b) => Math.cos(WW.angleDiff(h, brg(a, b)));
  const isBomber = p => p.kind === 'dive' || p.kind === 'torpedo';
  const armed = u => u && u.alive && isBomber(u) && u.ordnance && !u.crippled;
  const flying = p => p.alive && !p.removed && (p.state === 'transit' || p.state === 'attack' || p.state === 'return') && !p.deckPh;
  const capF = p => p.kind === 'fighter' && !p.target && !p.search && (p.state === 'transit' || p.state === 'attack') && !p.deckPh && p.carrier;
  const VALUE = { carrier: 250, battleship: 180, cruiser: 80, destroyer: 20, submarine: 0, pt: -20 };   // air_ops.js VALUE
  const HEAVY = { battleship: 1, cruiser: 1, carrier: 1 };
  let R = null, M = null, seq = 0;
  let pid = new WeakMap();                 // plane -> stable number (first seen, in WW.world.planes order)
  const idOf = p => { let k = pid.get(p); if (k === undefined) { k = ++seq; pid.set(p, k); } return k; };
  const lbl = u => (u.stats ? u.nation[0] + ':' + u.type + '#' + u.id : u.nation[0] + ':' + u.kind + '#p' + idOf(u));
  const vis = (n, u, age) => !WW.intel || WW.intel.visible(n, u, age === undefined ? 3 : age);
  const broken = n => { const B = WW.fleetCmd && WW.fleetCmd.side && WW.fleetCmd.side(n); return !!(B && B.brokenAt && B.posture === 'withdraw'); };

  // ---------------- episodes ----------------
  function hit(rule, key, minDur, units, detail) {
    if (R.only && !R.only[rule]) return;
    const t = WW.game.roundTime, k = rule + '|' + key;
    let e = R.ep.get(k);
    if (e && t - e.last > P.GAP) { close(e); e = null; }
    if (!e) { e = { rule, t0: t, last: t, minDur, on: false, units, detail }; R.ep.set(k, e); }
    e.last = t;
    if (!e.on && t - e.t0 >= minDur) { e.on = true; e.detail = typeof detail === 'function' ? detail() : detail; e.pos = units.map(u => u && [lbl(u), Math.round(u.x), Math.round(u.z)]); }
  }
  function close(e) {
    R.ep.delete(e.rule + '|' + (e.units.map(u => u && (u.stats ? u.id : 'p' + idOf(u))).join(':')));   // (only used at the end)
    if (!e.on) return;
    const r = R.res[e.rule] || (R.res[e.rule] = { n: 0, s: 0, ex: [] }), dur = e.last - e.t0 + P.DT;
    r.n++; r.s += dur;
    r.ex.push({ t: +e.t0.toFixed(1), dur: +dur.toFixed(1), u: e.pos, d: e.detail });
    if (r.ex.length > P.EX_KEEP * 2) { r.ex.sort((a, b) => b.dur - a.dur); r.ex.length = P.EX_KEEP; }
  }
  const keyOf = units => units.map(u => u && (u.stats ? u.id : 'p' + idOf(u))).join(':');
  const H = (rule, units, minDur, detail) => hit(rule, keyOf(units), minDur, units, detail);

  // ---------------- events ----------------
  WW.on('shellFired', e => { if (R && e && e.ship) R.fired.set(e.ship, WW.game.roundTime); });
  function aaShot(e, heavy) {   // S2: the AA battery fired at a departing / distant plane while an attacker closes on the ship
    if (!R || !e || !e.ship || !e.target || !e.ship.stats || !e.ship.stats.aa) return;
    const s = e.ship, pl = e.target, aa = s.stats.aa, reach = aa.range * (heavy ? P.AA_HEAVY_K : P.AA_LIGHT_K);
    const d3 = p => Math.hypot(p.x - s.x, p.y || 0, p.z - s.z);
    let att = null;
    for (const q of WW.world.planes) {
      if (!armed(q) || q.nation === s.nation || q === pl || d3(q) > reach) continue;
      if (heavy ? (q.y || 0) < 10 : (q.y || 0) > 24) continue;
      if (!vis(s.nation, q, 1.5)) continue;
      if (q.target === s || cosTo(q.heading, q, s) > 0.5) { att = q; break; }
    }
    R.aaN++;
    if (!att) return;
    R.aaAtt++;
    const away = !armed(pl) && (pl.state === 'return' || cosTo(pl.heading, pl, s) < -0.3) && d3(pl) > P.AA_POINT, far = d3(pl) > 0.8 * reach && d3(att) < d3(pl) - 15;
    if (!away && !far) return;
    R.aaBad++;
    H('S2', [s, pl, att], 0, () => `${heavy ? 'heavy' : 'light'} AA on ${lbl(pl)} (${away ? 'departing' : 'distant'} ${Math.round(d3(pl))}u, ord ${pl.ordnance ? 1 : 0}) while ${lbl(att)} closes at ${Math.round(d3(att))}u`);
  }
  WW.on('aaHeavyFired', e => aaShot(e, true));
  WW.on('aaLightFired', e => aaShot(e, false));

  // ---------------- planes ----------------
  // An armed enemy bomber inbound on a ship of `nation`: its victim, the time to its drop (s) at its speed.
  function victim(u) {
    const t = u.target || (u.wave && u.wave.target);
    return t && t.stats && live(t) ? t : null;
  }
  function threats(n) {
    const out = [];
    for (const u of WW.world.planes) {
      if (!armed(u) || u.nation === n || (u.state !== 'transit' && u.state !== 'attack')) continue;
      const T = victim(u); if (!T || T.nation !== n) continue;
      const dT = dist(u, T), drop = u.kind === 'torpedo' ? P.DROP_VT : P.DROP_VB;
      const tDrop = Math.max(0, dT - drop) / Math.max(10, u.speed || u.pt.speed);
      if (tDrop > P.THREAT_T) continue;
      out.push({ u, T, tDrop, dT });
    }
    return out;
  }
  // time for fighter f to reach bomber u on a lead course (u flies at T); fuel for that and the way home
  function reach(f, th) {
    const u = th.u, v = f.pt.speed, uv = u.speed || u.pt.speed, h = brg(u, th.T);
    let px = u.x, pz = u.z, tI = 0;
    for (let i = 0; i < 3; i++) { tI = Math.hypot(px - f.x, pz - f.z) / v; const k = Math.min(tI, th.tDrop); px = u.x + Math.cos(h) * uv * k; pz = u.z + Math.sin(h) * uv * k; }
    const home = f.carrier ? Math.hypot(px - f.carrier.x, pz - f.carrier.z) / (f.pt.cruise || v * 0.8) : 0;
    return { tI, ok: tI + P.REACH_PAD < th.tDrop && f.fuel > tI + home + P.FUEL_PAD && f.hp > 0.5 * f.maxHp && !f.crippled };
  }
  // a wingman flies its section leader's vector (air_squadrons follow(): only the leader holds plane.vec)
  const vecOf = f => f.vec || (f.leader && f.leader.alive && f.leader.vec) || null;
  const onIt = (f, u) => f.foe === u || vecOf(f) === u || (f.df && f.df.foe === u);
  function planes(t) {
    const PL = WW.world.planes, W = WW.cfg.MAP_W, Hh = WW.cfg.MAP_H;
    const thr = { USN: threats('USN'), IJN: threats('IJN') };
    const ftr = PL.filter(p => p.alive && p.kind === 'fighter' && !p.removed);
    const onCount = u => { let n = 0; for (const f of ftr) if (f.nation !== u.nation && onIt(f, u)) n++; return n; };
    for (const n of ['USN', 'IJN']) {
      for (const th of thr[n]) {
        if (th.tDrop < 2) continue;
        const u = th.u, seen = vis(n, u);
        if (seen && !R.inbS.has(u)) { R.inbS.add(u); R.inb++; }   // P1's denominator: seen raiders inbound
        // P1: a bomber nobody goes for, with a fighter able to reach it before the drop (fighters already on a
        // raider are busy doing the right thing: not counted as able)
        if (onCount(u) > 0) continue;
        let best = null, bt = 1e9, cnt = 0;
        for (const f of ftr) {
          if (f.nation !== n || f.target || f.search || f.recall || armed(f.foe) || armed(vecOf(f))) continue;
          const ok = capF(f) || (f.state === 'return' && !f.crippled) || (f.state === 'landing' && f.deckPh === 'marshal');
          if (!ok) continue;
          const r = reach(f, th); if (!r.ok) continue;
          cnt++; if (r.tI < bt) { bt = r.tI; best = f; }
        }
        if (!best) continue;
        const L = WW.cap ? WW.cap.doc(n) : { leash2: 1e9 }, lsh = best.carrier && dist(best.carrier, u) > L.leash2;
        const why = () => `${lbl(u)} -> ${lbl(th.T)} drop in ${th.tDrop.toFixed(0)}s; ${cnt} able, best ${lbl(best)} ${best.state}${best.deckPh ? '/' + best.deckPh : ''} foe=${best.foe ? best.foe.kind : '-'} vec=${vecOf(best) ? vecOf(best).kind : '-'} reach ${bt.toFixed(0)}s${lsh ? ' (bomber outside leash2)' : ''}`;
        H(seen ? (lsh ? 'P1L' : 'P1') : 'P1u', [u, best], P.MIN.P1, why);
      }
    }
    for (const f of ftr) {
      if (!capF(f) || f.fuel < P.FUEL_PAD * 2 || f.crippled) continue;
      const tl = thr[f.nation];
      // P2: idle CAP fighter (no foe, no vector) while a seen raider it can reach in time is under-covered
      if (!f.foe && !vecOf(f)) {
        for (const th of tl) {
          if (th.tDrop < 2 || !vis(f.nation, th.u) || onCount(th.u) >= 2) continue;
          const L = WW.cap ? WW.cap.doc(f.nation) : { leash2: 1e9 };
          if (f.carrier && dist(f.carrier, th.u) > L.leash2) continue;
          const r = reach(f, th); if (!r.ok) continue;
          H('P2', [f], P.MIN.P2, () => `idle ${lbl(f)} (${f.state}, ${Math.round(dist(f, f.carrier))}u from ${f.carrier.isBase ? 'base' : lbl(f.carrier)}) while ${lbl(th.u)} -> ${lbl(th.T)} drops in ${th.tDrop.toFixed(0)}s (reach ${r.tI.toFixed(0)}s)`);
          break;
        }
      }
      // P3: dogfighting a fighter that is not on our tail while a raider drops on a friendly ship soon
      const fo = f.foe;
      if (fo && fo.kind === 'fighter' && fo.foe !== f && !(f.df && f.df.from === fo)) {
        for (const th of tl) {
          if (th.tDrop > P.P3_T || th.tDrop < 2 || !vis(f.nation, th.u) || onCount(th.u) >= 2) continue;
          const r = reach(f, th); if (!r.ok) continue;
          H('P3', [f], P.MIN.P3, () => `${lbl(f)} chases ${lbl(fo)} (not on its tail) while ${lbl(th.u)} -> ${lbl(th.T)} drops in ${th.tDrop.toFixed(0)}s, reach ${r.tI.toFixed(0)}s`);
          break;
        }
      }
    }
    // P4: bunching over a carrier / base (not the deck pattern, the marshal stack, take-off or returning planes);
    // P4b: CAP on the far side of the carrier from a seen raid
    for (const cv of WW.world.ships) {
      if (!live(cv) || cv.type !== 'carrier') continue;
      let n = 0, capN = 0, capT = 0, rx = 0, rz = 0, rn = 0;
      for (const th of thr[cv.nation]) if (vis(cv.nation, th.u) && dist(th.u, cv) < P.RAID_R) { rx += th.u.x; rz += th.u.z; rn++; }
      for (const p of PL) {
        if (!p.alive || p.nation !== cv.nation || p.deckPh || (p.state !== 'transit' && p.state !== 'attack')) continue;
        if (dist(p, cv) < P.BUNCH_R) n++;
        if (rn && capF(p) && p.carrier === cv && !p.foe) { capN++; if (Math.cos(WW.angleDiff(brg(cv, p), Math.atan2(rz / rn - cv.z, rx / rn - cv.x))) > 0) capT++; }
      }
      if (n > P.BUNCH_N) H('P4', [cv], P.MIN.P4, () => `${n} planes within ${P.BUNCH_R}u of ${lbl(cv)} (not landing / taking off)`);
      if (capN >= 2 && capT / capN < 0.5) H('P4b', [cv], P.MIN.P4b, () => `${capT}/${capN} free CAP of ${lbl(cv)} on the raid's side (${rn} raiders within ${P.RAID_R}u)`);
    }
    for (const p of PL) {
      if (!p.alive || p.removed) continue;
      const k = p.kind, air = flying(p);
      // P10: off the map
      if (air && (p.x < -P.OFF || p.x > W + P.OFF || p.z < -P.OFF || p.z > Hh + P.OFF)) H(p.search || k === 'scout' || k === 'flyingboat' ? 'P10s' : 'P10', [p], P.MIN.P10, () => `${lbl(p)} ${p.state} off the map at ${Math.round(p.x)},${Math.round(p.z)}`);
      if (!air || p.search || k === 'scout' || k === 'flyingboat' || !p.carrier) continue;
      const tg = p.target && p.target.stats ? p.target : null;
      if (isBomber(p)) {
        // P5: an armed bomber passing a much more valuable seen ship to hit a lesser one
        if (p.ordnance && tg && p.state === 'transit' && !p.phase) {
          for (const o of WW.world.ships) {
            if (!live(o) || o.nation === p.nation || o.submerged || (VALUE[o.type] || 0) < (VALUE[tg.type] || 0) + P.VALUE_GAP) continue;
            const d = dist(p, o); if (d > P.P5_R || d > dist(p, tg) + 30 || !vis(p.nation, o)) continue;
            H('P5', [p, o], P.MIN.P5, () => `${lbl(p)} bound for ${lbl(tg)} (${Math.round(dist(p, tg))}u) passes ${lbl(o)} at ${Math.round(d)}u`);
            break;
          }
        }
        // P5b: wandering with its target in sight (not closing for P5B_T s, target seen within P5B_R)
        if (p.ordnance && tg && p.state === 'transit' && !p.phase) {
          const w = R.wand.get(p), d = dist(p, tg);
          if (!w || w.tg !== tg || d < w.dmin - 2) R.wand.set(p, { tg, dmin: d, t: t });
          else if (t - w.t > P.P5B_T && d < P.P5B_R && vis(p.nation, tg)) H('P5b', [p, tg], 0, () => `${lbl(p)} ${Math.round(d)}u from its seen target ${lbl(tg)}, not closer for ${(t - w.t).toFixed(0)}s`);
        }
        // P6: a bomber in the air with no task (no target, no wave, not searching)
        if ((p.state === 'transit' || p.state === 'attack') && !tg && !p.wave) H('P6', [p], P.MIN.P6, () => `${lbl(p)} ${p.state} with no target / wave (ord ${p.ordnance ? 1 : 0})`);
        // P7: empty bomber not heading home
        if (!p.ordnance && (p.state === 'transit' || p.state === 'attack') && !p.phase) H('P7', [p], P.MIN.P7, () => `${lbl(p)} ${p.state} with no ordnance, ${tg ? 'target ' + lbl(tg) : 'no target'}`);
      }
      // P7: badly hit and not going home; P7f: not enough fuel to get home and not on the way
      if ((p.state === 'transit' || p.state === 'attack') && !p.phase && p.hp < P.DMG_HP * p.maxHp) H('P7', [p], P.MIN.P7, () => `${lbl(p)} at ${Math.round(p.hp / p.maxHp * 100)}% hp still ${p.state}${p.foe ? ' fighting ' + lbl(p.foe) : ''}`);
      if (p.state !== 'return' && !p.carrier.isBase && p.fuel < dist(p, p.carrier) / (p.pt.cruise || p.pt.speed * 0.8) * 1.1 + 3) H('P7f', [p], P.MIN.P7f, () => `${lbl(p)} ${p.state} fuel ${p.fuel.toFixed(0)}s, home ${(dist(p, p.carrier) / (p.pt.cruise || p.pt.speed * 0.8)).toFixed(0)}s away`);
      // P6c: circling (path long, net displacement small) when not on CAP station, not marshalling
      const tr = R.track.get(p) || (R.track.set(p, { q: [] }), R.track.get(p)), q = tr.q;
      q.push([t, p.x, p.z, p.state]); while (q.length && t - q[0][0] > P.CIRC_T) q.shift();
      if (q.length > 4 && t - q[0][0] >= P.CIRC_T - P.DT && !(capF(p) && !p.foe)) {
        let path = 0; for (let i = 1; i < q.length; i++) path += Math.hypot(q[i][1] - q[i - 1][1], q[i][2] - q[i - 1][2]);
        const net = Math.hypot(p.x - q[0][1], p.z - q[0][2]);
        if (net < P.CIRC_NET && path > P.CIRC_PATH && !p.foe && p.state !== 'attack') H('P6c', [p], 0, () => `${lbl(p)} ${p.state} circled: ${Math.round(path)}u flown, ${Math.round(net)}u net in ${P.CIRC_T}s${tg ? ', target ' + lbl(tg) + ' ' + Math.round(dist(p, tg)) + 'u' : ''}`);
      }
      // P8: escorts: away from their own bombers while those are threatened before the attack; not fighting the attackers
      if (k === 'fighter' && p.target && !p.recall && (p.state === 'transit' || p.state === 'attack')) {
        let nb = null, nd = 1e9, thr8 = null;
        for (const b of PL) {
          if (!armed(b) || b.nation !== p.nation || b.state !== 'transit' || (p.wave ? b.wave !== p.wave : b.carrier !== p.carrier || b.target !== p.target)) continue;
          const d = dist(b, p); if (d < nd) { nd = d; nb = b; }
          if (!thr8) for (const e of ftr) if (e.nation !== p.nation && e.foe === b && dist(e, b) < 60) { thr8 = e; break; }
        }
        if (nb && thr8) {
          if (nd > P.ESC_R && !(p.foe && p.foe.kind === 'fighter' && dist(p.foe, nb) < P.ESC_R)) H('P8', [p], P.MIN.P8, () => `escort ${lbl(p)} ${Math.round(nd)}u from its nearest bomber while ${lbl(thr8)} attacks ${lbl(thr8.foe)}; escort foe=${p.foe ? lbl(p.foe) : '-'}`);
          else if (dist(p, thr8) < 50 && !(p.foe && p.foe.kind === 'fighter')) H('P8b', [p, thr8], P.MIN.P8, () => `escort ${lbl(p)} ${Math.round(dist(p, thr8))}u from ${lbl(thr8)} attacking its bomber, escort foe=${p.foe ? lbl(p.foe) : '-'}`);
        }
      }
      // P9: through enemy heavy flak with no business there (not its target, its target not near that ship)
      if (p.state !== 'attack' && (p.y || 0) >= 10) {
        for (const o of WW.world.ships) {
          if (!live(o) || o.nation === p.nation || !HEAVY[o.type] || !o.stats.aa || o === tg) continue;
          const d3 = Math.hypot(p.x - o.x, p.y, p.z - o.z); if (d3 > o.stats.aa.range * P.AA_HEAVY_K * 0.9) continue;
          if (tg && dist(tg, o) < P.FLAK_NEAR) continue;
          H('P9', [p, o], P.MIN.P9, () => `${lbl(p)} ${p.state} through the flak of ${lbl(o)} (${Math.round(d3)}u)${tg ? ', target ' + lbl(tg) + ' ' + Math.round(dist(tg, o)) + 'u from it' : ''}`);
          break;
        }
      }
      // P10b: a CAP fighter far outside its long leash with no foe (wandered off)
      if (capF(p) && !p.foe && !vecOf(p) && WW.cap && dist(p, p.carrier) > WW.cap.doc(p.nation).leash2 + 100) H('P10b', [p], P.MIN.P10, () => `CAP ${lbl(p)} ${Math.round(dist(p, p.carrier))}u from its carrier, no foe / vector`);
    }
  }

  // ---------------- ships ----------------
  function ships(t) {
    const L = WW.world.ships.filter(live);
    for (const s of L) {
      const hq = R.hist.get(s) || (R.hist.set(s, []), R.hist.get(s));
      hq.push([t, s.heading, s.speed, s.x, s.z]); while (hq.length && t - hq[0][0] > P.CIRC_T) hq.shift();
    }
    for (const s of L) {
      if (broken(s.nation) || s.type === 'submarine' && s.submerged) continue;
      const en = L.filter(o => o.nation !== s.nation), fr = L.filter(o => o !== s && o.nation === s.nation && o.type !== 'submarine');
      const known = o => vis(s.nation, o, 30);
      // S1: guns silent with a seen enemy ship in range and in a turret's arc (ammunition, PT rule, disabled mounts excluded)
      if (s.ai && s.ai.turrets && s.stats.guns.length) {
        const last = R.fired.has(s) ? R.fired.get(s) : -1e9;
        let why = null;
        for (const ts of s.ai.turrets) {
          const g = ts.gun; if (!g || ts.disabled) continue;
          const main = g === s.stats.guns[0], sup = s.sup;
          if (t - last < g.reload * 2 + 3) { why = null; break; }   // the ship has fired lately
          if (main && sup && (sup.main <= 0)) continue;
          for (const o of en) {
            if (o.submerged || !vis(s.nation, o)) continue;
            const d = dist(s, o); if (d > g.range) continue;
            if (main && sup && sup.flags && sup.flags.MainLow && d > 0.8 * g.range) continue;
            if (o.type === 'pt' && (s.type === 'battleship' || s.type === 'cruiser') && main && d > g.range * 0.45) continue;
            if (g.cal === 'mg' && (o.type === 'carrier' || o.type === 'battleship' || o.type === 'cruiser')) continue;
            const rel = WW.angleDiff(s.heading, brg(s, o));
            if (Math.abs(WW.angleDiff(ts.rest, rel)) > 2.5 + 0.12) continue;
            const ct = s.ai.calTarget && s.ai.calTarget[g.cal];
            why = `${lbl(s)} ${g.cal} silent ${(t - Math.max(last, 0)).toFixed(0)}s; ${lbl(o)} seen at ${Math.round(d)}/${g.range}u in arc; mount target ${ct ? lbl(ct) + (ct === o ? '' : ' ' + Math.round(dist(s, ct)) + 'u') : 'none'}`;
            break;
          }
          if (why) break;
        }
        if (why) H('S1', [s], P.MIN.S1, why);
      }
      // S3: too close to a friendly ship (centre distance < 1.2 x the longer hull)
      for (const o of fr) {
        if (o.id < s.id || o.submerged) continue;
        const need = P.SPACE_K * Math.max(s.stats.length, o.stats.length), d = dist(s, o);
        if (d < need) H((s.ringCv === o || o.ringCv === s) ? 'S3r' : 'S3', [s, o], P.MIN.S3, () => `${lbl(s)} and ${lbl(o)} ${d.toFixed(1)}u apart (< ${need.toFixed(0)})`);
      }
      if (s.type === 'carrier') {
        // S4: inside an enemy BB / CA's gun range, or heading at a known one within 1.5x its range
        for (const o of en) {
          if (o.type !== 'battleship' && o.type !== 'cruiser') continue;
          const g = o.stats.guns[0], d = dist(s, o);
          if (d <= g.range) { H('S4', [s, o], P.MIN.S4, () => `${lbl(s)} inside ${lbl(o)} gun range (${Math.round(d)}/${g.range}u)`); break; }
          const c = WW.intel ? WW.intel.known(s.nation, o) : o;
          if (c && WW.time.now - c.seenAt < 90 && Math.hypot(c.x - s.x, c.z - s.z) < 1.5 * g.range && s.speed > 0.3 * s.stats.speed && cosTo(s.heading, s, c) > Math.cos(70 * PI / 180)) { H('S4c', [s, o], P.MIN.S4, () => `${lbl(s)} steaming at known ${lbl(o)} ${Math.round(d)}u (range ${g.range})`); break; }
        }
        // S5: no escort (BB / CA / DD) within ESC_X while the side has escorts afloat
        const esc = fr.filter(o => o.type === 'battleship' || o.type === 'cruiser' || o.type === 'destroyer');
        let ne = 1e9; for (const o of esc) ne = Math.min(ne, dist(s, o));
        if (esc.length && ne > P.ESC_X) H('S5', [s], P.MIN.S5, () => `${lbl(s)} nearest escort ${Math.round(ne)}u (${esc.length} afloat)`);
        // S6: a threat known, escorts near, none of them on the threat side
        let th = null, thd = P.S6_R;
        for (const o of en) if (o.stats.guns.length && o.type !== 'carrier' && o.type !== 'pt' && known(o)) { const d = dist(s, o); if (d < thd) { thd = d; th = o; } }
        if (th) {
          const near = esc.filter(o => dist(s, o) < P.S6_NEAR);
          if (near.length && !near.some(o => Math.cos(WW.angleDiff(brg(s, o), brg(s, th))) > 0.3)) H('S6', [s, th], P.MIN.S6, () => `${near.length} escorts within ${P.S6_NEAR}u of ${lbl(s)}, none toward ${lbl(th)} (${Math.round(thd)}u)`);
        }
      }
      // S7: under attack (a bomber on its run / dive at it, or a torpedo track at it) and holding course and speed
      let att = null;
      for (const u of WW.world.planes) if (armed(u) && u.nation !== s.nation && u.target === s && (u.phase === 'run' || u.phase === 'dive' || u.phase === 'roll' || u.sk === 'anvil') && dist(u, s) < P.ATT_R) { att = u; break; }
      let tk = false;
      if (!att) for (const c of (WW.intel ? WW.intel.torpedoes(s.nation) : [])) {   // torpedo tracks the side has seen
        const p = c.proj;
        if (!p || p.dead || p.kind !== 'torp' || p.nation === s.nation) continue;
        const dx = s.x - p.x, dz = s.z - p.z, along = dx * Math.cos(p.h) + dz * Math.sin(p.h), perp = Math.abs(-dx * Math.sin(p.h) + dz * Math.cos(p.h));
        if (along > 0 && along < P.ATT_R && perp < s.stats.length) { att = p; tk = true; break; }
      }
      if (att) {
        const hq = R.hist.get(s), i0 = hq.findIndex(r => t - r[0] <= P.EVADE_T);
        const dh = Math.abs(WW.angleDiff(hq[i0][1], s.heading)), dv = Math.abs(hq[i0][2] - s.speed) / s.stats.speed;
        if (dh < P.EVADE_DH && dv < 0.15) H(tk ? 'S7t' : 'S7', [s], P.MIN.S7, () => `${lbl(s)} held course (${(dh * 180 / PI).toFixed(0)} deg in ${P.EVADE_T}s) under ${att.kind === 'torp' ? 'a torpedo track' : lbl(att) + ' ' + (att.phase || att.sk)}`);
      }
      // S8: stopped or circling mid-battle (not alongside survivors, not an ASW hold)
      const mid = en.some(o => known(o) && dist(s, o) < P.MID_R);
      const rescuing = s.rescue && !s.rescue.done && s.rescue.by === s, asw = s.ai && s.ai.dcSub;
      if (mid && !rescuing && !asw && s.type !== 'submarine') {
        if (s.speed < 0.1 * s.stats.speed) H('S8', [s], P.MIN.S8, () => `${lbl(s)} stopped (speed ${s.speed.toFixed(1)}) with ${lbl(en.filter(known).sort((a, b) => dist(s, a) - dist(s, b))[0])} near`);
        const hq = R.hist.get(s);
        if (hq.length > 4 && t - hq[0][0] >= P.CIRC_T - P.DT) {
          let path = 0; for (let i = 1; i < hq.length; i++) path += Math.hypot(hq[i][3] - hq[i - 1][3], hq[i][4] - hq[i - 1][4]);
          const net = Math.hypot(s.x - hq[0][3], s.z - hq[0][4]), Ls = s.stats.length;
          if (net < 2 * Ls && path > 6 * Ls) H('S8c', [s], 0, () => `${lbl(s)} circling: ${Math.round(path)}u steamed, ${Math.round(net)}u net in ${P.CIRC_T}s`);
        }
      }
      // S9: a lone ship (no friend within LONE_R) steaming at a known enemy force > 3x its hp (doctrine charges apart)
      if (s.type !== 'pt' && s.type !== 'submarine' && s.speed > 0.5 * s.stats.speed) {
        let nf = 1e9; for (const o of fr) nf = Math.min(nf, dist(s, o));
        if (nf > P.LONE_R) {
          for (const o of en) {
            if (!known(o) || o.type === 'submarine' || o.type === 'pt') continue;
            const d = dist(s, o); if (d > P.CHARGE_R || cosTo(s.heading, s, o) < Math.cos(40 * PI / 180)) continue;
            let hp = 0; for (const q of en) if (dist(q, o) < 200 && q.type !== 'submarine') hp += q.hp;
            if (hp > 3 * s.hp) { H(s.ai && s.ai.charge ? 'S9d' : 'S9', [s], P.MIN.S9, () => `lone ${lbl(s)} (${Math.round(s.hp)} hp, nearest friend ${Math.round(nf)}u) steaming at ${lbl(o)} ${Math.round(d)}u, force ${Math.round(hp)} hp`); break; }
          }
        }
      }
      // S10: a damaged ship heading toward the enemy and away from its friends
      if (s.hp < P.DMG_SHIP * s.maxHp && s.speed > 0.3 * s.stats.speed && fr.length) {
        let ne = null, nd = P.MID_R; for (const o of en) if (known(o) && !o.submerged) { const d = dist(s, o); if (d < nd) { nd = d; ne = o; } }
        const cx = fr.reduce((a, o) => a + o.x, 0) / fr.length, cz = fr.reduce((a, o) => a + o.z, 0) / fr.length;
        if (ne && cosTo(s.heading, s, ne) > 0.5 && Math.cos(WW.angleDiff(s.heading, Math.atan2(cz - s.z, cx - s.x))) < 0 && Math.hypot(cx - s.x, cz - s.z) > 60)
          H('S10', [s, ne], P.MIN.S10, () => `${lbl(s)} at ${Math.round(s.hp / s.maxHp * 100)}% hp steaming at ${lbl(ne)} (${Math.round(nd)}u), away from friends${s.ai && s.ai.charge ? ' (escort charge)' : ''}`);
      }
    }
  }

  // ---------------- API ----------------
  // the unit behind an example label ('U:carrier#1', 'I:dive#p56'): ships by id, planes by the auditor's number
  S.label = lbl;
  S.unit = l => {
    const m = /#(p?)(\d+)$/.exec(l); if (!m) return null;
    if (!m[1]) return WW.world.ships.find(s => s.id === +m[2]) || null;
    return WW.world.planes.find(p => pid.get(p) === +m[2]) || null;
  };
  S.begin = meta => {
    seq = 0; pid = new WeakMap(); // plane numbers restart each round, so an example replays with the same labels
    R = { meta, ep: new Map(), res: {}, fired: new Map(), inb: 0, inbS: new WeakSet(), wand: new WeakMap(), track: new WeakMap(), hist: new WeakMap(), aaN: 0, aaAtt: 0, aaBad: 0, only: meta && meta.only ? Object.fromEntries(meta.only.map(k => [k, 1])) : null };
  };
  S.sample = () => {
    if (!R || WW.game.state !== 'battle') return;
    const t = WW.game.roundTime;
    if (!R.only || ['P1', 'P1L', 'P1u', 'P2', 'P3', 'P4', 'P4b', 'P5', 'P5b', 'P6', 'P6c', 'P7', 'P7f', 'P8', 'P8b', 'P9', 'P10', 'P10s', 'P10b'].some(k => R.only[k])) planes(t);
    ships(t);
  };
  S.end = () => {
    if (!R) return null;
    for (const e of [...R.ep.values()]) close(e);
    for (const k in R.res) { const r = R.res[k]; r.s = +r.s.toFixed(1); r.ex.sort((a, b) => b.dur - a.dur); r.ex.length = Math.min(r.ex.length, P.EX_KEEP); }
    const out = { res: R.res, aa: { n: R.aaN, att: R.aaAtt, bad: R.aaBad }, inb: R.inb };
    R = null;
    return out;
  };
}
// Thresholds (sim units: map 2400 x 1350, a carrier ~26 u long, plane speeds 25-40 u/s; see tests/sanity.js RULES)
const P = {
  DT: 0.5, GAP: 2, EX_KEEP: 4,
  THREAT_T: 45, DROP_VT: 90, DROP_VB: 5, FUEL_PAD: 8, P3_T: 25, RAID_R: 300,
  BUNCH_R: 50, BUNCH_N: 4, VALUE_GAP: 150, P5_R: 120, P5B_T: 20, P5B_R: 150,
  DMG_HP: 0.35, CIRC_T: 60, CIRC_NET: 80, CIRC_PATH: 900, ESC_R: 80, FLAK_NEAR: 150, OFF: 20, REACH_PAD: 1, AA_POINT: 15,
  AA_HEAVY_K: 2.2, AA_LIGHT_K: 2,
  SPACE_K: 1.2, ESC_X: 150, S6_R: 500, S6_NEAR: 200, ATT_R: 100, EVADE_T: 6, EVADE_DH: 0.35, MID_R: 600,
  LONE_R: 250, CHARGE_R: 300, DMG_SHIP: 0.5,
  MIN: { P1: 3, P2: 3, P3: 2, P4: 5, P4b: 5, P5: 3, P6: 10, P7: 10, P7f: 5, P8: 3, P9: 2, P10: 2,
    S1: 5, S3: 3, S4: 2, S5: 10, S6: 10, S7: 4, S8: 20, S9: 10, S10: 10 }
};
if (typeof module !== 'undefined') module.exports = { install, P };
