// air_patrol.js - WW.patrol: long-range patrol flying boats (USN PBY Catalina, IJN H6K Mavis). Sim code: WW.rand only.
// Load after air_flyingboats.js. Periodically a flying boat comes in from its side's map edge on a long search leg
// across the likely enemy area (the oddfleets sector claims, WW.search, when present, else the commander's scout
// sectors), reports what it sees into intel (intel.js R.PATROL, quality 'patrol', with the report errors there),
// and once it finds the enemy SHADOWS it from standoff: outside the known AA umbrella (WW.threat air channel), on the
// side toward its own home, keeping the contact fresh for its fleet. It runs from fighters (low over the water,
// toward home) and goes home when hurt or at the end of its time on station. Big and slow, they often died doing it.
// The IJN Mavis shadows closer and longer (doctrine) and may bomb a lone ship once; it never rescues.
// Frequency: one patrol per side early (the Catalina at Midway found the Kido Butai), then occasional ones.
window.WW = window.WW || {};
(function () {
  'use strict';
  if (!WW.flyingBoats) { console.error('air_patrol.js must load after air_flyingboats.js'); return; }
  var FB = WW.flyingBoats;
  // per nation (doctrine): standoff from the shadowed ship, time on station, search time, bombing
  var DOC = {
    USN: { standoff: 122, shadowT: 110, searchT: 150, bombs: 0, alt: 32 },
    IJN: { standoff: 104, shadowT: 150, searchT: 160, bombs: 2, alt: 30 }
  };
  var FIRST = [15, 45], NEXT = [170, 260], MAX_ROUND = 3, AA_OK = 1.5, HUNT_R = 75, CALM_T = 14;
  var VAL = { carrier: 6, battleship: 5, cruiser: 3, destroyer: 1.5, pt: 0.3, submarine: 0.5 };
  var sched = {}, tick = 0, bombsOut = new Set();

  function reset() { sched = {}; tick = 0; bombsOut.clear(); }
  function battle() { return WW.game && WW.game.state === 'battle'; }
  function doc(p) { return DOC[p.nation] || DOC.USN; }
  function enemyEdgeX(n) { return n === 'USN' ? WW.cfg.MAP_W : 0; }
  function air(n, x, z) { return WW.threat ? WW.threat.danger(n, x, z, { air: true }) : 0; }
  function inMap(x, z) { return { x: WW.clamp(x, 20, WW.cfg.MAP_W - 20), z: WW.clamp(z, 20, WW.cfg.MAP_H - 20) }; }

  // ---- search legs: the shared sector claims (oddfleets WW.search) when present, else the likely enemy area ----
  function plan(p) {
    p.leg = 0;
    if (WW.search && WW.search.legs) { try { p.legs = WW.search.legs(p); if (p.legs && p.legs.length) return; } catch (e) { /* fall back */ } }
    var W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, c = WW.intel && WW.intel.centre(p.nation), L = [];
    var far = enemyEdgeX(p.nation), fx = c ? c.x : far + (far ? -1 : 1) * W * 0.3, fz = c ? c.z : WW.randRange(H * 0.25, H * 0.75);
    var sp = WW.fleetCmd && WW.fleetCmd.scoutPoint ? WW.fleetCmd.scoutPoint(p.nation, fx, fz) : null;
    L.push(inMap((p.x + fx) / 2, (p.z + fz) / 2 + WW.randRange(-60, 60)));     // the long leg out, a little off the direct line
    L.push(inMap(fx, fz));
    if (sp) L.push(inMap(sp.x, sp.z));
    L.push(inMap(fx, fz < H / 2 ? fz + 160 : fz - 160));                      // a dogleg across the enemy's likely track
    p.legs = L;
  }
  // steer toward (x, z) but round the known AA: the first heading off the wanted one with a clear look ahead
  function safeFly(p, x, z, alt, spd, rate, dt) {
    var want = Math.atan2(z - p.z, x - p.x), h = want;
    for (var k = 0; k < 7; k++) {
      var a = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45;
      if (air(p.nation, p.x + Math.cos(a) * 45, p.z + Math.sin(a) * 45) <= AA_OK) { h = a; break; }
    }
    return p.fly(p.x + Math.cos(h) * 60, p.z + Math.sin(h) * 60, alt, dt, spd, rate);
  }
  // the best enemy ship this flying boat itself sees right now
  function found(p) {
    if (!WW.intel) return null;
    var cs = WW.intel.enemyShips(p.nation, { fresh: 1 }), best = null, bv = 0;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], u = c.unit; if (c.by !== p || !u || !u.alive || u.sinking || u.submerged) continue;
      var v = (VAL[WW.intel.typeOf ? WW.intel.typeOf(c) : u.type] || 1) / (1 + WW.dist(p.x, p.z, u.x, u.z) / 200);
      if (v > bv) { bv = v; best = u; }
    }
    return best;
  }
  // a lone ship for a Mavis to bomb: no other enemy ship within 90 of it, light AA, no fighters about
  function loneTarget(p) {
    if (!WW.intel || p.nation !== 'IJN' || !(p.bombs > 0)) return null;
    var cs = WW.intel.enemyShips(p.nation, { fresh: 2 }).slice();   // a copy: fighterNear() reuses intel's scratch array
    for (var i = 0; i < cs.length; i++) {
      var u = cs[i].unit; if (!u || !u.alive || u.sinking || u.submerged || u.type === 'carrier' || u.type === 'battleship' || u.type === 'pt') continue;
      if (WW.dist(p.x, p.z, u.x, u.z) > 160 || air(p.nation, u.x, u.z) > 9) continue;
      var alone = true;
      for (var j = 0; j < cs.length && alone; j++) if (cs[j].unit !== u && WW.dist(cs[j].x, cs[j].z, u.x, u.z) < 90) alone = false;
      if (alone && FB.fighterNear(p.nation, u.x, u.z, 170) >= 170) return u;
    }
    return null;
  }

  function step(p, dt) {
    var D = doc(p); p.scanT = (p.scanT || 0) - dt;
    if (p.state === 'inbound') { p.state = 'search'; p.stT = 0; p.bombs = D.bombs; p.ordnance = D.bombs > 0; }
    // fighters on it: run for home, low
    if (p.state !== 'evade' && FB.hunted(p, HUNT_R)) {
      p.resume = p.state === 'bomb' ? 'shadow' : p.state; p.setState('evade'); FB.stats.evades[p.nation]++; FB.emit(p, 'evade');
    }
    switch (p.state) {
      case 'search': return search(p, dt, D);
      case 'shadow': return shadow(p, dt, D);
      case 'bomb': return bomb(p, dt, D);
      case 'evade': return evade(p, dt, D);
    }
  }
  function search(p, dt, D) {
    p.searchT = (p.searchT || 0) + dt;
    if (p.searchT > D.searchT) { release(p); return p.setState('return'); }
    if (!p.legs || p.leg >= p.legs.length) plan(p);
    var w = p.legs[p.leg];
    safeFly(p, w.x, w.z, D.alt, p.pt.speed, 0.45, dt);
    if (WW.dist(p.x, p.z, w.x, w.z) < 20) p.leg++;
    if (p.scanT <= 0) {
      p.scanT = 0.5;
      var u = found(p);
      if (u) { p.shadowOf = u; release(p); p.setState('shadow'); FB.emit(p, 'shadow', u); }
    }
  }
  function release(p) { if (WW.search && WW.search.release) try { WW.search.release(p); } catch (e) { /* ignore */ } }
  function shadow(p, dt, D) {
    var u = p.shadowOf;
    p.shadowT = (p.shadowT || 0) + dt; FB.stats.shadowT[p.nation] += dt;
    if (p.shadowT > D.shadowT || p.hurt) return p.setState('return');
    if (!u || !u.alive || u.sinking || u.submerged) {   // lost it: the next best in sight, else search again
      p.shadowOf = found(p);
      if (!p.shadowOf) { p.legs = null; return p.setState('search'); }
      u = p.shadowOf;
    }
    // standoff: on the side toward home, swinging slowly across it, pushed out past the AA umbrella
    var hb = Math.atan2(0, (FB.edgeX(p.nation)) - u.x), a = hb + Math.sin(p.shadowT * 0.05 + (p.nation === 'USN' ? 0 : 2)) * 1.0, R = D.standoff, x, z;
    for (var k = 0; k < 5; k++) {
      var q = inMap(u.x + Math.cos(a) * R, u.z + Math.sin(a) * R); x = q.x; z = q.z;
      if (air(p.nation, x, z) <= AA_OK) break;
      R += 12;
    }
    safeFly(p, x, z, D.alt, p.pt.speed * 0.85, 0.45, dt);
    if (p.scanT <= 0) {
      p.scanT = 2;
      var b = found(p);   // something better in sight (the screen first, then the main body): shadow that
      if (b && b !== u && (VAL[b.type] || 1) > (VAL[u.type] || 1)) { p.shadowOf = b; FB.emit(p, 'shadow', b); }
      var t = loneTarget(p);
      if (t && WW.rand() < 0.5) { p.bombAt = t; p.setState('bomb'); FB.emit(p, 'bomb', t); }
    }
  }
  // level bombing run on a lone ship (WW.combat.dropBomb: scatter grows with the height), one pass
  function bomb(p, dt, D) {
    var u = p.bombAt;
    if (!u || !u.alive || u.sinking || p.stT > 40 || !(p.bombs > 0)) { p.ordnance = false; return p.setState('shadow'); }
    var lead = Math.min(3, WW.dist(p.x, p.z, u.x, u.z) / p.speed), tx = u.x + Math.cos(u.heading) * u.speed * lead, tz = u.z + Math.sin(u.heading) * u.speed * lead;
    p.fly(tx, tz, 24, dt, p.pt.speed, 0.5);
    p.relT = (p.relT || 0) - dt;
    if (WW.dist(p.x, p.z, tx, tz) < 7 && p.relT <= 0) {
      p.relT = 0.45; p.bombs--;
      var pr = WW.combat && WW.combat.dropBomb ? WW.combat.dropBomb(p, u) : null;
      if (pr) { pr.dmg *= 0.55; bombsOut.add(pr); }   // a stick of 250 kg bombs: lighter than a dive bomber's
      FB.stats.bombs[p.nation]++;
      if (p.bombs <= 0) { p.ordnance = false; p.setState('shadow'); }
    }
  }
  function evade(p, dt, D) {
    var h = FB.hunted(p, HUNT_R + 25);
    p.calmT = h ? 0 : (p.calmT || 0) + dt;
    var hx = FB.edgeX(p.nation);
    p.fly(hx, p.z + (p.z < WW.cfg.MAP_H / 2 ? -40 : 40), 7, dt, p.pt.speed * 1.12, 0.6);
    if (p.calmT > CALM_T) {
      if (p.hurt || p.hp < p.maxHp * 0.6) return p.setState('return');
      p.setState(p.resume === 'shadow' && p.shadowOf ? 'shadow' : 'search');
    }
  }

  // ---- schedule: one per side early, then occasional ones; one patrol up per side, two USN boats at most ----
  function schedule(dt) {
    if (!battle()) return;
    tick -= dt; if (tick > 0) return; tick = 1;
    var now = WW.game.roundTime, end = WW.game.deadline ? WW.game.deadline() : WW.cfg.ROUND_TIMEOUT;
    ['USN', 'IJN'].forEach(function (n) {
      var S = sched[n] || (sched[n] = { n: 0, at: WW.randRange(FIRST[0], FIRST[1]), up: null });
      if (S.up && (S.up.removed || !S.up.alive)) { S.up = null; S.at = now + WW.randRange(NEXT[0], NEXT[1]); }
      if (S.up || S.n >= MAX_ROUND || now < S.at || now > end - 90) return;
      if (WW.endgame && WW.endgame.broken && WW.endgame.broken(n)) return;   // a beaten side has other worries
      if (FB.count(n) >= (n === 'USN' ? 2 : 1)) return;
      S.up = FB.launch(n, 'patrol', WW.randRange(WW.cfg.MAP_H * 0.2, WW.cfg.MAP_H * 0.8)); S.n++;
    });
  }
  var ou = WW.air.update;
  WW.air.update = function (dt) {
    var r = ou.apply(this, arguments);
    try { schedule(dt); } catch (e) { console.error('patrol', e); }
    return r;
  };
  WW.on('weaponImpact', function (e) {
    if (!e || e.kind !== 'bomb' || !bombsOut.has(e.proj)) return;
    bombsOut.delete(e.proj);
    if (e.ship && FB.stats) FB.stats.bombHits[e.proj.nation] = (FB.stats.bombHits[e.proj.nation] || 0) + 1;
  });
  // Strikes launched on a bad report (intel.js): a misidentified target, or a plot more than WRONG_R off. The wave
  // flies to the reported position; the strike leader's arrival redirect (air_cag.js) then finds what is really there.
  var WRONG_R = 25;
  if (WW.strike && WW.strike.newWave) {
    var nw = WW.strike.newWave;
    WW.strike.newWave = function (cv, tgt) {
      var w = nw.apply(this, arguments);
      try {
        var c = WW.intel && tgt ? WW.intel.known(cv.nation, tgt) : null;
        if (w && c && (c.misid || c.err > WRONG_R)) { w.badReport = c.misid ? 'misid' : 'plot'; WW.intel.stats.wrongStrikes++; }
      } catch (e) { /* metrics only */ }
      return w;
    };
  }
  WW.on('airOrder', function (e) { if (e && e.order === 'redirect' && e.plane && e.plane.wave && e.plane.wave.badReport && !e.plane.wave.redirCount) { e.plane.wave.redirCount = 1; WW.intel.stats.wrongRedirects = WW.intel.stats.wrongRedirects + 1; } });
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.patrol = { step: step, DOC: DOC, plan: plan };
})();
