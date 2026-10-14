// air_impact.js (air deaths) - where a falling plane meets the world (WW.airImpact). Load after air_deaths.js.
// Every dying plane (air_deaths.js modes, the stock fall / ditch in aircraft.js) asks hit(p) each step; the wreck ends
// at the first surface its lowest point touches, never below it:
//   ship    a surfaced ship's deck or superstructure under it: crash damage (Ship.takeDamage, kind 'crash') scaled by
//           the plane's size, its speed, the fuel left in it and any bomb or torpedo still aboard (that goes off: cal
//           'big'). ship_fires / damage treat a crash like a bomb hit (fires, a loaded flight deck). Burning wrecks
//           hit ships in 1942: Smith at Santa Cruz (26 Oct, a Kate onto her forecastle, its torpedo exploded; she
//           steamed into South Dakota's wake to put the fire out), San Francisco off Guadalcanal (12 Nov, a Betty
//           into the after control station), and Hornet's signal bridge (a Val, Santa Cruz). Only uncontrolled
//           wrecks: a controlled ditching (belly) is flown beside a ship and never resolves on one.
//   land    the island base: WW.landSites.impact(kind 'crash'): a runway hit craters it (the existing crater / repair
//           path), facilities in reach take damage, parked planes in the blast are wrecked (land_ground.js groundHit).
//           Elsewhere on land (an island hillside, the Normandy bluffs): a ground burst and a burning wreck that
//           smoulders on the ground for a while. A controlled ditching over land is a belly landing: a wreck, no burst.
//   water   the caller's own splash (air_deaths.js: each mode's splash size).
// Sim: the surface, the damage and the land-site hit are deterministic (no draws here); the fire chance is ship_fires'
// own WW.rand. Visuals (bursts, smoke, the smouldering wreck's look and lifetime) use Math.random.
window.WW = window.WW || {};
(function () {
  'use strict';
  var R = Math.random;
  function rr(a, b) { return a + (b - a) * R(); }
  var PS = (WW.cfg.PLANE_SCALE || 0.82) / 0.82, PK = WW.cfg.PLANE_K || 1, FXK = Math.sqrt(PK);
  var CRASH = 60;            // airframe damage of a fighter-sized plane at full speed with full tanks (the deliberate crash's old 70)
  var ORD_K = 0.9;           // a bomb or torpedo still aboard goes off: x WW.BOMB.dmg (the crash's old ordnance hit)
  var SHIP_BAND = 3;         // a wreck lower than deck - SHIP_BAND inside a footprint came in from the side (below: the sea)
  var stats = { water: 0, ship: 0, runway: 0, base: 0, land: 0, belly: 0, shipDmg: 0, shipFires: 0, craters: 0, facilities: 0, parked: 0 };
  var v3 = null;

  function deckY(s) {
    if (s.model && s.model.deck) { if (!v3) v3 = new THREE.Vector3(); s.group.updateMatrixWorld(true); return Math.max(1, s.model.deck.getWorldPosition(v3).y); }
    return 1.4 + (s.depthY || 0);
  }
  // the ground (or sea) under (x, z): the terrain (the island pad is flattened into it), the base's and Normandy's
  // buildings (land_sites.js roofAt), and their ground (groundAt)
  function ground(x, z) {
    var g = Math.max(0, -WW.terrain.depthAt(x, z));
    if (WW.landSites) g = Math.max(g, WW.landSites.roofAt(x, z), WW.landSites.groundAt(x, z));
    return g;
  }
  // the airframe's lowest point below its centre: belly, the nose of a steep dive, a wing tip in a bank
  function reach(p) {
    var pi = p.pitch || 0, ro = p.rollA !== undefined ? p.rollA : p.roll || 0;
    return PS * Math.max(0.35, 1.1 * Math.max(0, -Math.sin(pi)), p.wingless ? 0.3 : 1.35 * Math.abs(Math.sin(ro)));
  }
  // the ship whose deck / superstructure is under the wreck's lowest point (x, z, y): { s, top, al } or null
  function shipUnder(x, z, y) {
    var ships = WW.world.ships;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!s.alive || s.removed || s.submerged || !s.stats) continue;
      var L = s.stats.length, ex = x - s.x, ez = z - s.z;
      if (ex * ex + ez * ez > L * L * 0.3) continue;
      var c = Math.cos(s.heading), sn = Math.sin(s.heading), al = ex * c + ez * sn, la = -ex * sn + ez * c;
      if (Math.abs(al) > L * 0.5 + 0.3 || Math.abs(la) > L * 0.07 + 0.6 * PS) continue;
      var top = deckY(s) + (Math.abs(al) < L * 0.15 ? 1.2 : 0.3);   // the bridge and the stack amidships stand higher
      if (y <= top && y > top - SHIP_BAND) return { s: s, top: top, al: al };
    }
    return null;
  }
  // crash damage: the airframe (size x speed x fuel left) plus any ordnance aboard
  function damage(p, k) {
    var m = WW.clamp((p.maxHp || 20) / 22, 0.8, 3);
    var v = Math.hypot(p.speed || 0, p.vy || 0), e = WW.clamp(v / 26, 0.25, 1.2);
    var f0 = p.pt ? p.pt.range / p.pt.speed * 6 : 0, fuel = f0 > 0 ? WW.clamp((p.fuel || 0) / f0, 0, 1) : 0.5;
    var air = CRASH * m * e * (0.7 + 0.3 * fuel) * (k || 1);
    return p.ordnance && !p.wingless ? WW.BOMB.dmg * ((p.pt && p.pt.bombK) || WW.BOMB.bombK || 0.5) * ORD_K + air * 0.25 : air;   // the plane's own bomb (bombK)
  }

  // Each step of a dying plane. onWater(p): the caller's splash (it removes the plane or starts a float). belly: a
  // controlled ditching (gentle contact on land). Returns true when the wreck met a surface (it is then resolved).
  function hit(p, onWater, belly) {
    var lo = reach(p), y = p.y - lo;
    var sh = belly ? null : shipUnder(p.x, p.z, y);   // a controlled ditching is flown beside a ship, never into her
    if (sh) { onShip(p, sh); return true; }
    var g = ground(p.x, p.z);
    if (y > g) return false;
    p.y = g + lo;                                     // at contact, never below
    if (p.group) p.group.position.y = p.y;
    if (g <= 0 && WW.terrain.depthAt(p.x, p.z) > 0) { stats.water++; onWater(p); return true; }
    onLand(p, g, belly);
    return true;
  }

  function onShip(p, h) {
    var s = h.s, fx = WW.fx, c = Math.cos(s.heading), sn = Math.sin(s.heading), hx = s.x + c * h.al, hz = s.z + sn * h.al;
    var dmg = damage(p, p.wingless ? 0.5 : 1), big = p.ordnance && !p.wingless;
    p.y = h.top; p.impactOn = 'ship'; p.crashedInto = s;
    if (fx) {
      fx.explosion(p.x, h.top + 0.3, p.z, (big ? 2 : 1.4) * FXK + 0.4); fx.sparks(p.x, h.top + 0.6, p.z);
      fx.fire(p.x, h.top + 0.4, p.z); fx.smoke(p.x, h.top + 0.8, p.z, true, 1.5);
    }
    var f0 = s.fireN || 0;
    try { s.takeDamage(dmg, hx, hz, 'crash', big ? 'big' : undefined); } catch (e) { /* never throw */ }
    stats.ship++; stats.shipDmg += dmg; if ((s.fireN || 0) > f0) stats.shipFires++;
    if (WW.emit) WW.emit('planeCrash', { plane: p, on: 'ship', ship: s, x: p.x, y: h.top, z: p.z, dmg: dmg });
    p.remove();
  }

  function onLand(p, g, belly) {
    var b = WW.islandBase && WW.islandBase.base, rw = false, cr0 = 0, ib = WW.islandBase && WW.islandBase.stats, gl0 = WW.landGround && WW.landGround.stats ? WW.landGround.stats.groundLost : 0;
    if (b) { for (var i = 0; i < b.runways.length; i++) { var r = b.runways[i], dx = p.x - r.x, dz = p.z - r.z, u = dx * r.c + dz * r.s, v = -dx * r.s + dz * r.c; if (Math.abs(u) < r.len / 2 && Math.abs(v) < r.w / 2) rw = true; } }
    if (ib) cr0 = ib.craters;
    var dmg = damage(p, belly ? 0.35 : p.wingless ? 0.5 : 1), big = p.ordnance && !p.wingless && !belly, site = false, fac0 = 0;
    if (b) for (var j = 0; j < b.facilities.length; j++) if (b.facilities[j].out) fac0++;
    if (WW.landSites) try { site = WW.landSites.impact(null, p.x, p.z, dmg, 'crash', big ? 'big' : undefined); } catch (e) { site = false; }
    if (site && b) {
      if (ib) stats.craters += ib.craters - cr0;
      var fac1 = 0; for (var k = 0; k < b.facilities.length; k++) if (b.facilities[k].out) fac1++;
      stats.facilities += fac1 - fac0;
      if (WW.landGround && WW.landGround.stats) stats.parked += WW.landGround.stats.groundLost - gl0;
    }
    if (belly) stats.belly++;
    if (rw) stats.runway++; else if (site) stats.base++; else stats.land++;
    p.impactOn = rw ? 'runway' : 'land';
    if (WW.emit) WW.emit('planeCrash', { plane: p, on: rw ? 'runway' : site ? 'base' : 'land', x: p.x, y: g, z: p.z, dmg: dmg });
    var fx = WW.fx;
    if (fx) {
      if (!belly) {
        fx.explosion(p.x, g + 0.3, p.z, (big ? 2.2 : 1.3) * FXK + 0.3);
        if (fx.dirt) fx.dirt(p.x, g, p.z, big ? 1.4 : 0.8, false);
        for (var n = 0; n < 3; n++) fx.fire(p.x + rr(-0.6, 0.6) * PS, g + 0.3, p.z + rr(-0.6, 0.6) * PS);
      } else if (fx.dirt) fx.dirt(p.x, g, p.z, 0.4, false);
      fx.smoke(p.x, g + 0.8, p.z, true, 1.3 * FXK);
    }
    startWreck(p, g, belly);
  }

  // A wreck on the ground: the airframe stays where it hit, nose down (a belly landing sits level), burning and
  // smoking, then burns out. Dead (not in any sim list as a plane: alive is false); the look and the lifetime are
  // visual (Math.random), as the floating wrecks of air_deaths.js.
  function startWreck(p, g, belly) {
    p.deathMode = 'wrecked'; p.state = 'wrecked'; p.speed = 0; p.vy = 0; p.turn = 0;
    p.wkLife = belly ? rr(14, 22) : rr(18, 30); p.wkT = 0; p.wkFire = belly ? rr(3, 8) : p.wkLife * 0.7; p.wkF = 0;
    p.wkPitch = belly ? 0.03 : -rr(0.25, 0.5); p.wkRoll = belly ? rr(-0.08, 0.08) : rr(-0.6, 0.6);
    p.y = g + (belly ? 0.2 : 0.1) * PS;
    var gr = p.group; if (gr) { gr.position.set(p.x, p.y, p.z); gr.rotation.set(p.wkRoll, -p.heading, p.wkPitch); }
  }
  function wreck(p, dt) {
    var fx = WW.fx;
    p.wkT += dt;
    if (fx && p.wkT < p.wkLife) {
      p.wkF -= dt;
      if (p.wkF <= 0) {
        var burning = p.wkT < p.wkFire;
        p.wkF = burning ? 0.18 : 0.6;
        if (burning) fx.fire(p.x + rr(-0.4, 0.4) * PS, p.y + 0.3, p.z + rr(-0.4, 0.4) * PS);
        fx.smoke(p.x, p.y + 0.6, p.z, true, (burning ? 1.1 : 0.7) * FXK);
      }
    }
    if (p.wkT >= p.wkLife) p.remove();
  }

  WW.airImpact = { hit: hit, ground: ground, deckY: deckY, shipUnder: shipUnder, damage: damage, wreck: wreck, stats: stats,
    CRASH: CRASH, reset: function () { for (var k in stats) stats[k] = 0; } };
  if (WW.on) WW.on('roundStart', WW.airImpact.reset);
})();
