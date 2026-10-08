// damage.js — owner C/D. Localized persistent ship damage (WW.damage).
// Each hit becomes a "site" stored in ship-LOCAL coordinates (bow +x, side z, deck y). Every frame the
// sites are transformed with the ship's group matrix (so they move, turn, list and sink with the hull)
// and emit fire / smoke columns there. Emission is budgeted globally so the finite fx pools are not
// exhausted. Loads after effects.js and before combat.js / ships.js.
// Visual randomness uses Math.random (never WW.rand) so effects do not change the sim's random sequence.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var burning = [];               // ships that carry damage sites (alive, sinking or wreck)
  var v = null;                   // scratch vector
  var load = 1, demand = 0;       // emission scale from last frame's demand (>= 1 when over budget)
  var BUDGET = 80;                // wanted site smoke puffs per sim second across all ships (+ fires ~2x)
  var WRECK_SMOKE = 30;           // seconds of residual smoke after a wreck settles

  function pickWind() {
    var a = R() * Math.PI * 2, s = rr(0.5, 0.9);
    WW.wind = { x: Math.cos(a) * s, z: Math.sin(a) * s, a: a };
  }
  pickWind();

  // ---- ship geometry helpers ----
  function hullInfo(ship) {
    if (ship._dmgHull) return ship._dmgHull;
    var L = (ship.stats && ship.stats.length) || 12, hg = ship.model && ship.model._hg;
    var beam = hg ? hg[1] * 0.5 : L * 0.08, deck = hg ? hg[2] : 0.8;
    if (ship.model && ship.model.deck) deck = ship.model.deck.position.y; // carrier flight deck
    var tons = (ship.stats && ship.stats.tons) || 5000;
    // heavier ships burn longer: PT 0.5 .. battleship ~1.3
    var heavy = clamp(0.6 + 0.4 * Math.log10(tons / 1000), 0.5, 1.4);
    return (ship._dmgHull = { L: L, beam: beam, deck: deck, heavy: heavy, maxSites: clamp(Math.round(L / 4), 1, 6) });
  }
  function worldOf(ship, s) {
    if (!v) v = new THREE.Vector3();
    ship.group.updateMatrix();     // group is a direct child of the scene: matrix == world matrix
    return v.set(s.lx, s.ly, s.lz).applyMatrix4(ship.group.matrix);
  }

  // ---- hits ----
  // kind: 'shell' | 'torpedo' | 'bomb' | 'dc' | undefined; cal: shell calibre.
  function hit(ship, amount, hx, hz, kind, cal) {
    if (!ship || !ship.group || typeof THREE === 'undefined') return;
    var H = hullInfo(ship), L = H.L, fx = WW.fx;
    if (hx === undefined || hz === undefined || !isFinite(hx) || !isFinite(hz)) {
      var a0 = rr(-L * 0.35, L * 0.35); hx = ship.x + Math.cos(ship.heading) * a0; hz = ship.z + Math.sin(ship.heading) * a0;
    }
    var ex = hx - ship.x, ez = hz - ship.z, c = Math.cos(ship.heading), sn = Math.sin(ship.heading);
    var lx = clamp(ex * c + ez * sn, -L * 0.45, L * 0.45), lz = clamp(-ex * sn + ez * c, -H.beam, H.beam);
    var side = lz >= 0 ? 1 : -1, sub = ship.type === 'submarine', under = sub && ship.depthY < -0.6;
    var big = kind === 'torpedo' || kind === 'bomb' || cal === 'big' || cal === 'med';
    var ly = H.deck;
    if (kind === 'torpedo') { lz = side * H.beam; ly = 0.5; }
    // impact fx at the true hit point on the hull
    var site = { lx: lx, ly: ly, lz: lz };
    var p = worldOf(ship, site), px = p.x, py = p.y, pz = p.z;
    if (fx) {
      if (kind === 'torpedo') {
        fx.splash(px, pz, 3.5); fx.splash(px + rr(-1, 1), pz + rr(-1, 1), 2.2);
        fx.explosion(px, 0.8, pz, 1.4);
      } else if (kind === 'dc') {
        // the depth charge already threw its water column
      } else if (under) {
        fx.splash(px, pz, 1.5);
      } else if (kind === 'bomb') {
        fx.explosion(px, py + 0.3, pz, 1.7); fx.sparks(px, py + 0.5, pz);
        fx.smoke(px, py + 0.8, pz, true, 1.3);
      } else if (cal === 'mg') {
        fx.sparks(px, py + 0.2, pz);
      } else {
        var sz = cal === 'big' ? 1.6 : cal === 'med' ? 1.0 : 0.6;
        fx.explosion(px, py + 0.2, pz, sz); fx.sparks(px, py + 0.4, pz);
        if (cal === 'big') fx.smoke(px, py + 0.6, pz, true, 1.4); // debris puff
      }
    }
    if (cal === 'mg' || kind === 'dc' || amount <= 0) return; // no persistent site
    // fire duration (sim seconds) scales with damage and ship weight
    var dur = clamp(amount * 0.32 * H.heavy, 4, 60);
    var ignite = kind === 'torpedo' ? 0 : kind === 'bomb' ? 1 : cal === 'small' ? 0.4 : 0.9;
    var burn = R() < ignite ? dur * rr(0.6, 1.2) : 0;
    var smoke = dur * (kind === 'torpedo' ? 2 : 1.2);
    ship.dmgSites = ship.dmgSites || [];
    var S = ship.dmgSites, best = null, bd = (L * 0.12 + 1.5);
    bd *= bd;
    for (var i = 0; i < S.length; i++) {
      var dx = S[i].lx - lx, dz = S[i].lz - lz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = S[i]; }
    }
    if (!best && S.length >= H.maxSites) { // full: merge into the nearest
      bd = 1e9;
      for (var j = 0; j < S.length; j++) { var ddx = S[j].lx - lx, ddz = S[j].lz - lz; if (ddx * ddx + ddz * ddz < bd) { bd = ddx * ddx + ddz * ddz; best = S[j]; } }
    }
    if (best) {
      best.sev = Math.min(3, best.sev + amount / 120);
      best.fire = Math.max(best.fire, burn) + burn * 0.3;
      best.smoke = Math.max(best.smoke, smoke);
      if (kind === 'torpedo') best.low = true;
    } else {
      S.push({ lx: lx, ly: ly, lz: lz, sev: Math.min(3, 0.4 + amount / 120), fire: burn, smoke: smoke,
        low: kind === 'torpedo', fT: R() * 0.1, sT: R() * 0.3, boomT: rr(6, 14), perm: false });
    }
    if (kind === 'torpedo' && !sub) ship.listRoll = clamp((ship.listRoll || 0) + side * 0.035, -0.12, 0.12);
    if (big) disableTurret(ship, lx, lz);
    if (burning.indexOf(ship) < 0) burning.push(ship);
  }

  // A heavy hit within ~2 units of a turret knocks it out (gameplay: uses WW.rand).
  function disableTurret(ship, lx, lz) {
    var ts = ship.ai && ship.ai.turrets;
    if (!ts) return;
    for (var i = 0; i < ts.length; i++) {
      var o = ts[i].t && ts[i].t.obj;
      if (!o || ts[i].disabled) continue;
      var dx = o.position.x - lx, dz = o.position.z - lz;
      if (dx * dx + dz * dz < 4 && WW.rand() < 0.6) { ts[i].disabled = true; break; }
    }
  }

  // Under ~30% hp a ship gets one extra big fire that burns until it sinks.
  function checkCritical(ship) {
    if (ship.dmgCrit || !ship.alive || ship.hp / ship.maxHp >= 0.3 || ship.type === 'submarine') return;
    ship.dmgCrit = true;
    var H = hullInfo(ship), S = ship.dmgSites = ship.dmgSites || [];
    var s = { lx: rr(-0.2, 0.15) * H.L, ly: H.deck, lz: 0, sev: 2.5, fire: 1e9, smoke: 1e9, low: false,
      fT: 0, sT: 0, boomT: rr(4, 10), perm: true };
    if (S.length >= H.maxSites) S[S.length - 1] = s; else S.push(s);
    if (burning.indexOf(ship) < 0) burning.push(ship);
  }

  // ---- per-frame emission ----
  function emitShip(ship, dt) {
    var S = ship.dmgSites, fx = WW.fx, H = hullInfo(ship);
    var hpLoss = 1 - clamp(ship.hp / ship.maxHp, 0, 1);
    var wreckT = ship.wreck ? (ship.wreckT || 0) : -1;
    var sinking = ship.sinking || !ship.alive;
    var sub = ship.type === 'submarine';
    var wind = WW.wind;
    for (var i = S.length - 1; i >= 0; i--) {
      var s = S[i];
      if (wreckT < 0) {
        if (!s.perm) { s.fire -= dt; s.smoke -= dt; }
        if (s.fire <= 0 && s.smoke <= 0) { S.splice(i, 1); continue; }
      }
      var p = worldOf(ship, s), y = p.y;
      if (y < 0.05 || (sub && ship.depthY < -0.6)) continue; // under water: no fire or smoke
      var inten = 0.6 + 0.5 * s.sev + hpLoss;
      demand += 2.2 * inten;
      // smoke column, drifting downwind (puffs start a little downwind/higher as the column bends)
      s.sT -= dt;
      if (s.sT <= 0) {
        var onFire = s.fire > 0 && wreckT < 0;
        s.sT = (onFire ? 0.58 : 1.05) / Math.min(2.5, inten) * load; // lazy columns
        if (wreckT >= 0) s.sT = rr(1.0, 1.9) * load;
        var h = R() * (onFire ? 1.4 : 0.6), size = wreckT >= 0 ? 0.6 : (onFire ? 1.0 + 0.35 * s.sev + 0.5 * hpLoss : 0.7 + 0.2 * s.sev);
        var dark = wreckT >= 0 ? R() < 0.5 : (onFire || s.low || hpLoss > 0.4);
        fx.smoke(p.x + wind.x * h * 2, y + 0.5 + h, p.z + wind.z * h * 2, dark, size);
      }
      if (wreckT >= 0) continue;
      // flames
      if (s.fire > 0) {
        s.fT -= dt;
        if (s.fT <= 0) {
          s.fT = 0.15 / Math.min(2, 0.5 + 0.5 * s.sev) * load; // soft flicker
          var spread = 0.3 + 0.25 * s.sev;
          fx.fire(p.x + rr(-spread, spread), y + 0.1, p.z + rr(-spread, spread));
          if (s.sev > 1.5 && R() < 0.3) fx.fire(p.x + rr(-spread, spread), y + 0.2, p.z + rr(-spread, spread));
        }
        // occasional secondary explosion (ammunition / fuel) at a big fire
        s.boomT -= dt;
        if (s.boomT <= 0) {
          s.boomT = rr(12, 25);
          if (s.sev > 1.2 && R() < 0.2 && !sinking) { fx.explosion(p.x, y + 0.3, p.z, 0.6 + 0.15 * s.sev); }
        }
      }
    }
  }

  WW.damage = {
    init: function () {},
    hit: function (ship, amount, x, z, kind, cal) {
      try { hit(ship, amount, x, z, kind, cal); checkCritical(ship); } catch (e) { /* never throw into combat */ }
    },
    update: function (dt) {
      if (!(dt > 0) || !WW.fx) return;
      load = clamp(demand / BUDGET, 1, 6); demand = 0;
      for (var i = burning.length - 1; i >= 0; i--) {
        var s = burning[i];
        if (s.wreck && (s.wreckT || 0) > WRECK_SMOKE && s.dmgSites) s.dmgSites.length = 0;
        if (s.removed || !s.dmgSites || !s.dmgSites.length) { if (s.dmgSites) s.dmgSites.length = 0; burning.splice(i, 1); continue; }
        try { emitShip(s, dt); } catch (e) { s.dmgSites.length = 0; }
      }
    },
    // Share of the smoke budget in use (>1 = over budget). Other emitters (planes, stacks) scale by this.
    load: function () { return load; },
    want: function (perSec) { demand += perSec * 0.35; }, // other emitters (plane trails) report their puff rate
    clearAll: function () {
      for (var i = 0; i < burning.length; i++) if (burning[i].dmgSites) burning[i].dmgSites.length = 0;
      burning.length = 0; load = 1; demand = 0;
      pickWind();
    },
    // site world position (tests)
    siteWorld: function (ship, i) { var s = ship.dmgSites && ship.dmgSites[i || 0]; if (!s) return null; var p = worldOf(ship, s); return { x: p.x, y: p.y, z: p.z }; },
    _debug: function () { var n = 0; for (var i = 0; i < burning.length; i++) n += burning[i].dmgSites ? burning[i].dmgSites.length : 0; return { ships: burning.length, sites: n, load: load }; }
  };
})();
