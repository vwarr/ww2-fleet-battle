// ai_threat.js - WW.threat: the danger field. For each side, a coarse grid (CELL units) over the map holds the
// expected damage per second an enemy the side KNOWS about (WW.intel contacts, weighted down with age and
// spread by how far the contact may have moved) can put on a point: main and secondary gun reach, torpedo reach
// along the shooter's bow arcs (subs included), and on a separate channel the AA umbrella for plane routing.
// The grid is rebuilt by the fleet commander tick (fleet_cmd.js, ~every 2 s per side); lookups are bilinear.
// bestHeading(ship, want, risk) samples headings around `want` and picks goal pull - danger x (1 - risk) - edge;
// the result goes into ship.desiredHeading, and ships_nav planNav keeps the final say on land and collisions.
// Pure sim code, no randomness. Overlay (key G): ai_threat_view.js.
window.WW = window.WW || {};
(function () {
  'use strict';
  var CELL = 20;
  var HIT = 0.5;          // gun dps x HIT: rough hit share at combat range
  var TORP_HIT = 0.3;     // torpedo dps x TORP_HIT
  var TAPER = 25;         // danger fades to 0 this far past a weapon's reach
  var STALE_W = 0.3, STALE_T = 90; // a contact's weight falls from 1 (fresh) to STALE_W at STALE_T s old
  var DRIFT = 20, SPREAD_MAX = 40; // a stale contact is moved along its course for <= DRIFT s; reach grows <= SPREAD_MAX
  var DREF = 20;          // danger that counts as "1" in bestHeading (about a battleship's broadside at mid range)
  var EDGE = 45;          // map-edge penalty band in bestHeading
  var OFFS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1, 2.6, -2.6, Math.PI];
  var COFFS = OFFS.map(Math.cos); // cos of each offset, once (bestHeading)
  var nx = 0, nz = 0, F = {}, stats = { builds: 0, ms: 0, lookups: 0 };

  function grid() { return { surf: new Float32Array(nx * nz), air: new Float32Array(nx * nz), max: 0, airMax: 0, t: -1e9, n: 0 }; }
  function sideF(n) {
    var W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, gx = Math.ceil(W / CELL) + 1, gz = Math.ceil(H / CELL) + 1;
    if (gx !== nx || gz !== nz) { nx = gx; nz = gz; F = {}; }
    return F[n] || (F[n] = grid());
  }
  function clear() { for (var k in F) { F[k].surf.fill(0); F[k].air.fill(0); F[k].max = F[k].airMax = 0; F[k].t = -1e9; } }

  // Damage per second of one weapon at distance d from its reach r (full inside, x1.3 point blank, taper outside).
  function fall(d, r) { return d <= r ? 1.3 - 0.3 * d / r : d < r + TAPER ? 1 - (d - r) / TAPER : 0; }
  // Stamp one radial weapon onto channel ch: dps at reach r around (x, z); arc: optional { h, k } bow bias.
  function stamp(ch, x, z, r, dps, arc) {
    var R = r + TAPER, i0 = Math.max(0, Math.floor((x - R) / CELL)), i1 = Math.min(nx - 1, Math.ceil((x + R) / CELL));
    var j0 = Math.max(0, Math.floor((z - R) / CELL)), j1 = Math.min(nz - 1, Math.ceil((z + R) / CELL));
    for (var j = j0; j <= j1; j++) {
      var pz = j * CELL - z;
      for (var i = i0; i <= i1; i++) {
        var px = i * CELL - x, d = Math.sqrt(px * px + pz * pz);
        if (d >= R) continue;
        var v = dps * fall(d, r);
        if (arc && d > 1) v *= 1 - arc.k + arc.k * Math.max(0, (px * Math.cos(arc.h) + pz * Math.sin(arc.h)) / d);
        ch[j * nx + i] += v;
      }
    }
  }

  // Rebuild nation's field from its contact table.
  function build(nation) {
    var f = sideF(nation), t0 = performance.now(), now = WW.time.now;
    f.surf.fill(0); f.air.fill(0);
    var cs = WW.intel ? WW.intel.enemyShips(nation) : [], FRESH = WW.intel ? WW.intel.T.FRESH : 3, n = 0;
    for (var c = 0; c < cs.length; c++) {
      var ct = cs[c], u = ct.unit;
      if (!u || !u.alive || !u.stats) continue;
      var st = u.stats, age = Math.max(0, now - ct.seenAt);
      var w = age <= FRESH ? 1 : Math.max(STALE_W, 1 - (1 - STALE_W) * (age - FRESH) / STALE_T);
      var dr = Math.min(age, DRIFT), x = ct.x + Math.cos(ct.heading) * ct.speed * dr, z = ct.z + Math.sin(ct.heading) * ct.speed * dr;
      var grow = Math.min(SPREAD_MAX, age * st.speed * 0.5), hpK = 0.5 + 0.5 * u.hp / u.maxHp;
      for (var g = 0; g < st.guns.length; g++) {
        var gun = st.guns[g], sh = WW.SHELL[gun.cal];
        stamp(f.surf, x, z, gun.range + grow, w * hpK * HIT * (sh ? sh.dmg : 10) * gun.count / gun.reload);
      }
      if (st.torpedoes) {
        var tp = st.torpedoes;
        stamp(f.surf, x, z, tp.range * 0.85 + grow, w * TORP_HIT * WW.TORPEDO.dmg * (1 - (tp.dud || 0)) * tp.count / tp.reload, { h: ct.heading, k: 0.6 });
      }
      if (st.aa) stamp(f.air, x, z, st.aa.range * 1.55 + grow, w * st.aa.dps);
      n++;
    }
    var m = 0, ma = 0;
    for (var k = 0; k < f.surf.length; k++) { if (f.surf[k] > m) m = f.surf[k]; if (f.air[k] > ma) ma = f.air[k]; }
    f.max = m; f.airMax = ma; f.t = now; f.n = n;
    stats.builds++; stats.ms += performance.now() - t0;
    return f;
  }

  // Bilinear lookup. opts.air: the AA channel.
  function danger(nation, x, z, opts) {
    var f = F[nation]; if (!f || !nx) return 0;
    stats.lookups++;
    var ch = opts && opts.air ? f.air : f.surf;
    var gx = WW.clamp(x / CELL, 0, nx - 1.001), gz = WW.clamp(z / CELL, 0, nz - 1.001), i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, o = j * nx + i;
    return (ch[o] * (1 - fx) + ch[o + 1] * fx) * (1 - fz) + (ch[o + nx] * (1 - fx) + ch[o + nx + 1] * fx) * fz;
  }
  // 0..1.5 penalty for a point inside the EDGE band of the map; a point off the map scores 3 and more.
  function edge(x, z, band) {
    var m = Math.min(x, WW.cfg.MAP_W - x, z, WW.cfg.MAP_H - z), E = band || EDGE;
    return m >= E ? 0 : m >= 0 ? 1.5 * (E - m) / E : 3 - m / 10; // off the map: never
  }
  // Heading near `want` with the best goal pull - danger x (1 - risk) - edge, sampled `look` units ahead
  // (and half way). risk 0: avoid all known danger; 1: ignore it. opts: { look, air, k (danger weight), edge (band
  // width for the edge penalty, default EDGE), avoid (bearings never to head toward), cone (their half-angle) }.
  function bestHeading(ship, want, risk, opts) {
    var look = (opts && opts.look) || WW.clamp(ship.stats.speed * 9, 30, 70), K = ((opts && opts.k) || 2) * (1 - WW.clamp(risk || 0, 0, 1)) / DREF;
    var best = want, bs = -1e9, n = ship.nation, av = opts && opts.avoid, cone = (opts && opts.cone) || 1.4;
    for (var i = 0; i < OFFS.length; i++) {
      var h = want + OFFS[i], c = Math.cos(h), s = Math.sin(h);
      var x1 = ship.x + c * look * 0.5, z1 = ship.z + s * look * 0.5, x2 = ship.x + c * look, z2 = ship.z + s * look;
      var dg = Math.max(danger(n, x1, z1, opts), danger(n, x2, z2, opts));
      var sc = COFFS[i] - dg * K - edge(x2, z2, opts && opts.edge) - 0.15 * Math.abs(WW.angleDiff(ship.heading, h));
      if (av) for (var j = 0; j < av.length; j++) { var off = Math.abs(WW.angleDiff(av[j], h)); if (off < cone) sc -= 3 - 1.5 * off / cone; }
      if (sc > bs) { bs = sc; best = h; }
    }
    return best;
  }
  // Downhill direction of the field at (x, z) (central differences over one cell), or null when flat.
  function away(nation, x, z, opts) {
    var dx = danger(nation, x + CELL, z, opts) - danger(nation, x - CELL, z, opts);
    var dz = danger(nation, x, z + CELL, opts) - danger(nation, x, z - CELL, opts);
    return Math.abs(dx) + Math.abs(dz) < 1e-3 ? null : Math.atan2(-dz, -dx);
  }

  WW.on('roundStart', clear);
  WW.on('setupStart', clear);
  WW.threat = {
    CELL: CELL, DREF: DREF, stats: stats,
    build: build, danger: danger, bestHeading: bestHeading, away: away, edge: edge,
    // the raw field for the overlay / tests: { surf, air, max, airMax, t, n, nx, nz, cell }
    field: function (nation) { var f = sideF(nation); f.nx = nx; f.nz = nz; f.cell = CELL; return f; }
  };
})();
