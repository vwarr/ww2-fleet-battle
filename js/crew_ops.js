// crew_ops.js - WW.crewOps: what the sailors (models_crew.js) do in battle (visual only, Math.random, real time).
//  - AA crews crouch, grip and shake with the recoil while their ship's light / heavy AA fires (aaLightFired /
//    aaHeavyFired); hands go to the ears near a firing main gun; 2 loaders work beside a firing turret (shellFired).
//  - Damage-control parties: 2-4 hands per burning site (worst 1-2) run to it; the lead plays a hose (crew_props.js
//    arcing water stream, a little steam) until the fire is out, then they walk back.
//  - Lookouts (an officer and a hand) point at a first sighting (intel 'contact') or an incoming raid.
//  - Cheer: a wave of arms-up along the deck when an enemy ship sinks nearby or a plane the ship shot at goes down.
//  - Salute: near a sinking friendly ship the crew stands still facing her; officers salute.
//  - Carrier deck: plane directors signal the take-off run, the LSO holds out his paddles (waves a plane off),
//    two hands run to chock a plane that has just trapped.
//  - Abandon ship: most sailors at the rail climb down a cargo net on the hull side into the water.
// models_crew.js calls ship() every 0.5 s (job assignment), frame() per near ship, step() / atRail() for custom
// modes and pose() per sailor (arm swing aL / aR, flare oL / oR, crouch cr, lean, hop, recoil dx, still).
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random, PI = Math.PI;
  var NETS = { carrier: 4, battleship: 3, cruiser: 3, destroyer: 2 };
  function nowS() { return performance.now() / 1000; }
  function ops(rec) { return rec.ops || (rec.ops = { aaT: 0, gunT: 0, boomT: 0, shot: [], nets: [], pollT: 0, cheer: null, look: null, sal: null }); }
  function local(sh, x, z) {
    var dx = x - sh.x, dz = z - sh.z, c = Math.cos(sh.heading), sn = Math.sin(sh.heading);
    return [dx * c + dz * sn, -dx * sn + dz * c];
  }
  function bearing(sh, x, z) { var l = local(sh, x, z); return Math.atan2(-l[1], l[0]); }
  function release(s) { s.job = null; s.jk = null; s.lead = false; s.tx = s.st.x; s.mode = 'walk'; }
  function free(s) { return s.st.lane && !s.tur && !s.jk && (s.mode === 'idle' || s.mode === 'walk'); }
  function assign(s, job, kind, tx, lead) {
    s.job = job; s.jk = kind; s.lead = !!lead; s.mode = 'run'; s.tx = WW.clamp(tx, s.st.lane.x0, s.st.lane.x1);
  }
  function nearest(list, x, z) {
    list.forEach(function (s) { var ln = s.st.lane; s._k = Math.abs(WW.clamp(x, ln.x0, ln.x1) - x) + Math.abs(s.x - x) * 0.2 + Math.abs(s.z - z) * 0.5; });
    return list.sort(function (a, b) { return a._k - b._k; });
  }
  // the hull side's half width at local (x, y) (models.js hull loft)
  function hullZ(type, x, y) {
    var a = WW.crew.hp(type), h = WW.models._hullAt(a[0], a[1], a[2], a[3], a[4], a[5], WW.clamp((x + a[0] / 2) / a[0], 0, 1));
    if (y >= h.yt) return h.w * 1.06;
    var t = WW.clamp((h.yt - y) / (h.yt - h.yb), 0, 1), sn = t * t, c = Math.sqrt(1 - sn * sn);
    return h.w * Math.pow(c, 0.35) * (1 + 0.06 * (1 - sn));
  }

  // ---- jobs (every 0.5 s per near ship): damage control, loaders, deck chocks, a look at a fresh hit ----
  function ship(rec, now) {
    var sh = rec.ship, o = ops(rec), S = sh.dmgSites || [], i, list = rec.sailors;
    var fires = S.filter(function (q) { return q.fire > 0 && worldY(sh, q) > 0.05; }).sort(function (a, b) { return b.sev - a.sev; });
    fires.length = Math.min(fires.length, sh.type === 'carrier' || sh.type === 'battleship' ? 2 : 1);
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s.jk) continue;
      if ((s.jk === 'fire' && fires.indexOf(s.job) < 0) || (s.jk === 'load' && now > o.gunT) || (s.jk === 'hit' && now - s.job.t > 6) ||
          (s.jk === 'chock' && now > s.job.t)) release(s);
    }
    fires.forEach(function (site) {
      var want = WW.clamp(2 + Math.floor(site.sev), 2, 4), have = list.filter(function (s) { return s.job === site; }).length;
      if (have >= want) return;
      var c = nearest(list.filter(function (s) { return free(s) || s.jk === 'load' || s.jk === 'hit'; }), site.lx, site.lz);
      c.slice(0, want - have).forEach(function (s, k) {
        if (s.jk) release(s);
        var d = s.x < site.lx ? -1 : 1, lead = have === 0 && k === 0;
        assign(s, site, 'fire', site.lx + d * (1.55 + 0.34 * (have + k)), lead);
      });
    });
    if (!fires.length && sh._crewHit && now - sh._crewHit.t < 6 && !list.some(function (s) { return s.job === sh._crewHit; })) {
      nearest(list.filter(free), sh._crewHit.lx, sh._crewHit.lz).slice(0, 2).forEach(function (s, k) {
        assign(s, sh._crewHit, 'hit', sh._crewHit.lx + (s.x < sh._crewHit.lx ? -1 : 1) * (0.55 + 0.35 * k));
      });
    }
    if (now < o.gunT && o.gun && !list.some(function (s) { return s.jk === 'load'; })) {
      var g = o.gun, aft = g.lx > 0 ? -1 : 1;
      nearest(list.filter(free), g.lx + aft * 1.4, g.lz).slice(0, 2).forEach(function (s, k) {
        if (Math.abs(WW.clamp(g.lx, s.st.lane.x0, s.st.lane.x1) - g.lx) < 3) assign(s, g, 'load', g.lx + aft * (1.2 + 0.4 * k));
      });
    }
    if (o.chock && now < o.chock.t && !list.some(function (s) { return s.jk === 'chock'; })) {
      nearest(list.filter(function (s) { return free(s) && 'brnw'.indexOf(s.st.role) >= 0; }), o.chock.lx, o.chock.lz).slice(0, 2).forEach(function (s, k) {
        assign(s, o.chock, 'chock', o.chock.lx + (k ? -0.5 : 0.5));
      });
    }
  }
  var _w = null;
  function worldY(sh, q) {
    if (!_w) _w = new THREE.Vector3();
    sh.group.updateMatrix(); return _w.set(q.lx, q.ly, q.lz).applyMatrix4(sh.group.matrix).y;
  }

  // ---- per frame per near ship: bearings, polls, hoses ----
  function frame(rec, dt, now) {
    var sh = rec.ship, o = ops(rec), P = WW.crewProps;
    o.pollT -= dt;   // poll first: it can start a look, whose bearing is needed by pose() this frame
    if (o.pollT <= 0) { o.pollT = 0.5; poll(rec, o, now); }
    if (o.aaTgt && now < o.aaT) { o.aaB = bearing(sh, o.aaTgt.x, o.aaTgt.z); o.aaE = Math.atan2((o.aaTgt.y || 0) - 2, Math.hypot(o.aaTgt.x - sh.x, o.aaTgt.z - sh.z)); }
    if (o.look && now < o.look.t) { var lu = o.look.u, lx = lu ? lu.x : o.look.x, lz = lu ? lu.z : o.look.z; o.lookB = bearing(sh, lx, lz); o.lookE = lu && lu.y ? Math.atan2(lu.y - 2, Math.hypot(lx - sh.x, lz - sh.z)) : 0.1; }
    else o.look = null;
    if (o.sal && now < o.sal.t && !o.sal.src.removed) o.salB = bearing(sh, o.sal.src.x, o.sal.src.z); else o.sal = null;
    if (!P || rec.sink) return;
    for (var i = 0; i < rec.sailors.length; i++) {
      var s = rec.sailors[i];
      if (s.jk !== 'fire' || s.mode !== 'fight' || !s.lead) continue;
      var f = s.f, hx = s.x + Math.cos(f) * 0.2, hz = s.z - Math.sin(f) * 0.2, hy = s.y + 0.3 * WW.crew.SCALE;
      P.hose(sh, hx, hy, hz, s.job.lx, s.job.ly + 0.15, s.job.lz, dt);
      s.job._steam = (s.job._steam || 0) - dt;
      if (s.job._steam <= 0 && WW.fx) {
        s.job._steam = 0.5 + R() * 0.4; sh.group.updateMatrix();
        var w = new THREE.Vector3(s.job.lx, s.job.ly + 0.3, s.job.lz).applyMatrix4(sh.group.matrix);
        WW.fx.smoke(w.x, w.y, w.z, false, 0.35);
      }
    }
  }
  function poll(rec, o, now) {
    var sh = rec.ship, i;
    for (i = o.shot.length - 1; i >= 0; i--) {   // a plane we shot at went down
      var e = o.shot[i];
      if (!e.p.alive) { o.shot.splice(i, 1); if (e.p.killedBy === sh || now - e.t < 2.5) cheer(rec, now); }
      else if (now - e.t > 6) o.shot.splice(i, 1);
    }
    if (!o.look && now > o.aaT) {                   // an incoming raid: the lookouts point it out
      var best = null, bd = 85 * 85, P = WW.world.planes;
      for (i = 0; i < P.length; i++) {
        var p = P[i]; if (!p || !p.alive || p.nation === sh.nation || (p.y || 0) < 2) continue;
        var d = (p.x - sh.x) * (p.x - sh.x) + (p.z - sh.z) * (p.z - sh.z); if (d < bd) { bd = d; best = p; }
      }
      if (best && (!o.lastRaid || now - o.lastRaid > 12)) { o.lastRaid = now; look(rec, best, now, 3.5); }
    }
    if (sh.type === 'carrier' && sh._deck) {         // deck ops: launch signals, the LSO, chocks after a trap
      var D = sh._deck; o.launch = null; o.land = null;
      D.launchers.forEach(function (p) { if (p.deckPh === 'run') o.launch = 'run'; else if (p.deckPh === 'hold' && !o.launch) o.launch = 'hold'; });
      D.lq.forEach(function (p) { if (p.deckPh === 'final' && !o.land) o.land = 'final'; else if (p.deckPh === 'waveoff') o.land = 'waveoff'; });
      var pl = WW.world.planes;
      for (i = 0; i < pl.length; i++) {
        var q = pl[i];
        if (q && q.carrier === sh && q.state === 'rollout' && q !== o.chockP) { o.chockP = q; o.chock = { lx: (q.lx || 0) + 1.5, lz: q.lz || 0, ly: 2, t: now + 4.5 }; }
      }
    }
  }
  function look(rec, u, now, dur) {
    var o = ops(rec), c = rec.sailors.filter(function (s) { return s.mode === 'idle' && !s.jk; });
    var off = c.find(function (s) { return s.st.role === 'o'; }), hand = c.find(function (s) { return s !== off && s.st.role !== 'g'; });
    o.look = { t: now + dur, u: u, a: off || null, b: hand || null };
  }
  function cheer(rec, now) {
    var o = ops(rec); if (o.cheer && now < o.cheer.t0 + 3.5) return;
    var L = rec.ship.stats.length; o.cheer = { t0: now + 0.2, L: L };
  }

  // ---- custom sailor modes ----
  function step(s, rec, dt) {
    if (s.mode !== 'net') return false;
    if (s.wait > 0) { s.wait -= dt; return true; }
    var type = rec.ship.type;
    s.y -= 0.45 * dt;
    var hz = hullZ(type, s.x, s.y) + 0.12, k = WW.clamp(s.y / Math.max(0.1, s.y0), 0, 1);
    s.z = s.side * Math.max(hz, WW.lerp(hz, Math.abs(s.ez), k));
    s.ft = s.f = s.side > 0 ? PI / 2 : -PI / 2;     // facing the hull
    if (s.y < 0.05) { s.mode = 'gone'; if (WW.fx) { var w = new THREE.Vector3(s.x, 0, s.z).applyMatrix4(rec.ship.group.matrix); WW.fx.splash(w.x, w.z, 0.25); } }
    return true;
  }
  function abandon(rec, mk) {
    var n = 0;
    while (n < 4 && rec.spare.length) { var st = rec.spare.shift(); if (st.t != null) continue; rec.sailors.push(mk(rec.ship, st)); n++; }
    var lanes = rec.sailors.filter(function (s) { return s.st.lane && !s.tur; });
    for (var k = 0; n < 4 && lanes.length && k < 8; k++) {      // more hands up from below, along a deck lane
      var b = lanes[Math.floor(R() * lanes.length)].st, ln = b.lane, x = WW.clamp(b.x + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), ln.x0, ln.x1);
      if (Math.abs(x - b.x) < 0.35) continue;
      rec.sailors.push(mk(rec.ship, { x: x, z: b.z, y: b.y, f: b.f, role: 'c', t: null, lane: ln })); n++;
    }
  }
  function atRail(s, rec) {
    var type = rec.ship.type, max = NETS[type];
    if (!max || R() < 0.3) return false;
    var o = ops(rec), net = null;
    for (var i = 0; i < o.nets.length; i++) { var n = o.nets[i]; if (n.side === s.side && Math.abs(n.x - s.x) < 0.7 && n.n < 4) { net = n; break; } }
    if (!net) { if (o.nets.length >= max) return false; net = { x: s.x, side: s.side, y0: s.y, z0: Math.abs(s.ez), n: 0, ship: rec.ship }; o.nets.push(net); }
    net.n++; s.x = net.x + (R() - 0.5) * 0.2; s.mode = 'net'; s.y0 = s.y; s.wait = 0.2 + net.n * 0.5 + R() * 0.3;
    return true;
  }

  // ---- poses ----
  function pose(s, rec, now) {
    var o = rec.ops; s.still = false;
    if (!o) return;
    var sw = Math.sin(now * 6 + s.ph), role = s.st.role, idle = s.mode === 'idle' || s.mode === 'walk';
    if (s.mode === 'net') { s.aL = 2.7 + sw * 0.35; s.aR = 2.7 - sw * 0.35; s.oL = s.oR = 0.25; return; }
    if (s.mode === 'fight') {
      if (s.jk === 'fire') {
        if (s.lead) { s.aL = s.aR = 1.3; s.oL = s.oR = -0.12; s.cr = 0.35; s.lean = 0.18; s.dx = -0.01 * Math.abs(sw); }
        else { s.aL = s.aR = 0.95; s.oL = s.oR = -0.1; s.cr = 0.25; s.lean = 0.12; }
        return;
      }
      if (s.jk === 'load') { var ph = Math.sin(now * 3.4 + s.ph); s.aL = s.aR = 1.0 + 0.55 * ph; s.oL = s.oR = -0.05; s.cr = 0.3 * (1 - ph); s.lean = 0.25 * (1 - ph) / 2; return; }
      if (s.jk === 'chock') { s.aL = s.aR = 1.25; s.oL = s.oR = 0; s.cr = 0.8; s.lean = 0.4; return; }
    }
    // AA crews at work
    if (now < o.aaT && (role === 'g' || s.tur)) {
      if (!s.tur && s.mode === 'idle' && o.aaB != null) s.ft = o.aaB; // no bearing yet when the first report named no target
      var kick = now - (o.kickH || 0) < 0.25;
      s.cr = kick ? 1 : 0.85; s.lean = 0.3 - Math.min(0.25, (o.aaE || 0) * 0.4); s.aL = s.aR = 1.35 + Math.min(0.6, (o.aaE || 0)); s.oL = s.oR = -0.02;
      s.dx = -(kick ? 0.06 : 0.03) * Math.abs(Math.sin(now * 31 + s.ph)); return;
    }
    if (o.look && (s === o.look.a || s === o.look.b) && idle) {
      if (s.mode === 'idle') s.ft = o.lookB;
      s.aR = 1.5 + WW.clamp(o.lookE || 0, 0, 0.9); s.oR = 0.05; s.aL = 0.1; return;
    }
    if (now - o.boomT < 0.75 && idle && Math.abs(s.x - o.boomX) < 4.5) { s.aL = s.aR = 2.75; s.oL = s.oR = 0.85; s.cr = 0.25; s.lean = 0.1; return; }
    if (o.cheer && idle) {
      var d = o.cheer.t0 + (s.x / o.cheer.L + 0.5) * 0.8, t = now - d;
      if (t > 0 && t < 2.6) { var k = Math.sin(now * 9 + s.ph); s.aL = 2.8 + 0.25 * k; s.aR = 2.8 - 0.25 * k; s.oL = s.oR = 0.35; s.hop = Math.max(0, Math.sin(now * 7 + s.ph)) * 0.05; return; }
    }
    if (o.sal && idle) {
      s.still = true; if (s.mode === 'idle') s.ft = o.salB;
      if (role === 'o') { s.aR = 2.45; s.oR = 1.25; s.aL = 0; s.oL = 0.04; } else { s.aL = s.aR = 0; s.oL = s.oR = 0.04; }
      return;
    }
    if (rec.ship.type === 'carrier' && idle) {
      if (role === 'y' && o.launch) {
        if (o.launch === 'hold') { s.aR = 2.6 + 0.4 * Math.sin(now * 8 + s.ph); s.oR = 0.5 + 0.3 * Math.cos(now * 8 + s.ph); s.aL = 0.3; }
        else { if (s.mode === 'idle') s.ft = 0; s.aR = 1.4 + 0.5 * Math.max(0, Math.sin(now * 4)); s.oR = 0.1; s.lean = 0.15; s.cr = 0.2; }
        return;
      }
      if (s === lso(rec) && o.land) {
        if (s.mode === 'idle') s.ft = PI;
        if (o.land === 'waveoff') { s.aL = 2.85 + 0.35 * Math.sin(now * 11); s.aR = 2.85 - 0.35 * Math.sin(now * 11); s.oL = s.oR = 0.15; }
        else { s.aL = s.aR = 0.1 * Math.sin(now * 3); s.oL = 1.45 + 0.12 * Math.sin(now * 2.3); s.oR = 1.45 - 0.12 * Math.sin(now * 2.3); }
        return;
      }
    }
  }
  function lso(rec) {       // the deck hand nearest the stern
    if (rec._lso === undefined) { var b = null; rec.sailors.forEach(function (s) { if (s.st.lane && !s.tur && s.st.role !== 'g' && (!b || s.st.x < b.st.x)) b = s; }); rec._lso = b; }
    return rec._lso;
  }

  // ---- events (sim -> visuals; read only) ----
  function onShip(sh) { return !WW.simOnly && sh && sh._crew && !sh._crew.sink ? sh._crew : null; }
  if (WW.on) {
    var aa = function (heavy) {
      return function (d) {
        var rec = onShip(d && d.ship); if (!rec) return;
        var o = ops(rec), now = nowS(); o.aaT = now + (heavy ? 1.3 : 0.9); o.aaTgt = d.target || o.aaTgt;
        if (heavy) o.kickH = now;
        if (d.target && !o.shot.some(function (e) { return e.p === d.target; })) o.shot.push({ p: d.target, t: now }); else o.shot.forEach(function (e) { if (e.p === d.target) e.t = now; });
      };
    };
    WW.on('aaLightFired', aa(false)); WW.on('aaHeavyFired', aa(true));
    WW.on('shellFired', function (d) {
      var rec = onShip(d && d.ship); if (!rec || d.cal === 'mg' || !isFinite(d.x)) return;
      var sh = d.ship, o = ops(rec), now = nowS(), l = local(sh, d.x, d.z), T = sh.model.turrets, bi = -1, bd = 1e9;
      for (var i = 0; i < T.length; i++) { var p = T[i].obj.position, dd = Math.abs(p.x - l[0]) + Math.abs(p.z - l[1]) * 0.5; if (dd < bd) { bd = dd; bi = i; } }
      if (bi < 0) return;
      var tp = T[bi].obj.position;
      o.gunT = now + 5; if (!o.gun || o.gun.i !== bi) o.gun = { i: bi, lx: tp.x, lz: tp.z, ly: tp.y };
      if (d.cal === 'big' || d.cal === 'med') { o.boomT = now; o.boomX = tp.x; }
    });
    WW.on('contact', function (d) {
      if (WW.simOnly || !d || !d.first || !d.unit) return;
      var now = nowS();
      (WW.world.ships || []).forEach(function (s) {
        if (s.nation === d.nation && s._crew && !s._crew.sink && WW.dist(s.x, s.z, d.unit.x, d.unit.z) < 400) look(s._crew, d.unit, now, 5);
      });
    });
    WW.on('shipSunk', function (sunk) {
      if (WW.simOnly || !sunk) return;
      var now = nowS();
      (WW.world.ships || []).forEach(function (s) {
        var rec = onShip(s); if (!rec || s === sunk) return;
        var d = WW.dist(s.x, s.z, sunk.x, sunk.z);
        if (s.nation !== sunk.nation && d < 160) cheer(rec, now + d / 120);
        else if (s.nation === sunk.nation && d < 80) ops(rec).sal = { t: now + 12, src: sunk };
      });
    });
  }

  WW.crewOps = { ship: ship, frame: frame, step: step, atRail: atRail, abandon: abandon, pose: pose, hullZ: hullZ, nets: function (rec) { return rec.ops ? rec.ops.nets : null; } };
})();
