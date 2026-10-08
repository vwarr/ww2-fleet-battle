// night_ops.js - WW.nightOps: how darkness and weather change what the fleets see and do. Sim code (no dice in the
// detection math; star shells and searchlights are sim entities with deterministic timing), stepped from main.js
// step() after WW.dayNight and WW.weather.
//   Sight (intel.js hooks): seeR() = the visual range of a hull, cut by darkness (IJN night optics and lookouts see
//   farther than USN eyes), by a rainy dusk (cover darkens the light) and by rain on the line of sight; a gun flash
//   reaches farther at night than by day; a ship with its searchlight on shows like a big-gun flash; a target under a
//   star shell or in a searchlight beam is seen as by day. radarR(): USN SG surface radar (late 1942) on BB / CA / DD:
//   sees through dark and rain, shorter on small targets, blind near land (clutter), one sweep every other tick.
//   Star shells: cruisers and destroyers (and USN battleships) fire one over a known enemy 15-160 away that is not
//   lit; it bursts behind the target, hangs under a parachute, drifts with the wind and lights the sea round it.
//   Searchlights (mostly IJN): a ship lights its gun target inside SL_R for SL_ON s; the beam shows its own ship too.
//   Doctrine (fleet_cmd / ai_surface / ai_carrier / ai_light hooks): torpK, rangeK, pressK, cvFleeK, subUp.
// Events: 'starShell' (the shell object), 'searchlight' { ship, on }. night_fx.js draws them.
window.WW = window.WW || {};
(function () {
  'use strict';
  var NIGHT_EYE = { USN: 0.3, IJN: 0.5 },                 // visual range in full dark (x the day range)
      FLASH_NIGHT = 0.3,                                  // gun flash range + 30% in full dark
      RADAR = 170, RADAR_SIZE = { carrier: 1, battleship: 1, cruiser: 0.9, destroyer: 0.7, submarine: 0.4, pt: 0.3 },
      RADAR_SHIPS = { battleship: 1, cruiser: 1, destroyer: 1 }, CLUTTER = 2.5,  // a target in water shallower than this: lost in the land echo
      RAIN_VIS = 0.7,                                     // rain on the line of sight: visual range x (1 - RAIN_VIS x cover)
      STAR = { R: 160, MIN: 15, AGE: 15, CD: { USN: 45, IJN: 28 }, MAX: 3, H: 50, FLIGHT: 2.5, LIFE: 24, FALL: 1.2, LIT: 95, BEHIND: 22,
               SHIPS: { USN: { cruiser: 1, destroyer: 1, battleship: 1 }, IJN: { cruiser: 1, destroyer: 1 } } },
      SL = { R: 120, ON: 14, CD: 30, AGE: 8, BEAM: 18 },  // searchlight reach, time on, cooldown, contact age, lit radius round the target
      DARK_OPS = 0.4;                                     // star shells and searchlights below this daylight
  var shells = [], lights = [], nextStar = new Map(), nextLight = new Map(), tickT = 0;
  var stats = { starShells: { USN: 0, IJN: 0 }, searchlights: { USN: 0, IJN: 0 }, radarSights: 0, litSights: 0 };

  function dark() { return 1 - WW.daylight; }
  function doc(n) { var B = WW.fleetCmd && WW.fleetCmd.side(n); return B ? B.doctrine : null; }
  function cover(x, z) { return WW.weather ? WW.weather.cover(x, z) : 0; }
  // local light: a rain squall darkens it (a rainy dusk is very dark)
  function dayAt(x, z) { return WW.daylight * (1 - 0.55 * cover(x, z)); }
  // visual range factor of observer s on target o (no flash): darkness by the observer's night optics, rain on the LOS
  function visK(s, o) {
    var d = dayAt(o.x, o.z), ne = NIGHT_EYE[s.nation] || 0.35, k = ne + (1 - ne) * d;
    var rain = WW.weather ? WW.weather.along(s.x, s.z, o.x, o.z) : 0;
    if (lit(o)) k = Math.max(k, 0.9);
    return k * (1 - RAIN_VIS * rain);
  }
  // seeR(s, o, size, glow): the range (before the observer's eye factor) at which s sees o. size: the hull's day
  // range (0 for a submerged sub); glow: a gun-flash range (0 if it did not fire). Searchlight on: a big flash.
  function seeR(s, o, size, glow) {
    if (o.searchOn) glow = Math.max(glow, WW.intel.R.FLASH.big);
    var g = glow ? glow * (1 + FLASH_NIGHT * dark()) * (1 - 0.4 * (WW.weather ? WW.weather.along(s.x, s.z, o.x, o.z) : 0)) : 0;
    return Math.max(size ? size * visK(s, o) : 0, g);
  }
  // a target lit by a burning star shell or a searchlight beam
  function lit(o) {
    if (o.searchLit && o.searchLit > WW.time.now) return true;
    for (var i = 0; i < shells.length; i++) {
      var sh = shells[i];
      if (!sh.lit) continue;
      var r = sh.r; if (WW.dist2(sh.x, sh.z, o.x, o.z) < r * r) return true;
    }
    return false;
  }
  // USN ship radar range on o (0: no radar / this sweep / clutter). Every other 0.5 s tick, offset by ship id.
  function radarR(s, o) {
    var d = doc(s.nation);
    if (!d || !(d.radar > 0.5) || !RADAR_SHIPS[s.type] || o.submerged) return 0;
    if ((Math.floor(WW.time.now * 2 + 0.01) + s.id) & 1) return 0;
    if (WW.terrain.depthAt(o.x, o.z) < CLUTTER) return 0;
    return RADAR * (RADAR_SIZE[o.type] || 0.6);
  }
  // planes see ships: darkness (min 0.3) and cloud over the target
  function airK(o) {
    var k = lit(o) ? 1 : 0.3 + 0.7 * dayAt(o.x, o.z);
    return k * (1 - 0.6 * cover(o.x, o.z));
  }

  // ---- doctrine hooks ----
  // torpedo launch distance factor k (0.6 + 0.3 x torpedo): longer reach at night by the night doctrine, capped
  function torpK(B, k) { var d = B && B.doctrine, n = d ? d.night : 0.5; return Math.min(0.97, k * (1 + 0.3 * n * dark())); }
  // preferred gun range: the night-fighting side closes in the dark
  function rangeK(B) { var n = B && B.doctrine ? B.doctrine.night : 0.5; return 1 - 0.3 * n * dark(); }
  // press threshold factor: a night-fighting side presses on a smaller edge after dark
  function pressK(B) { var n = B && B.doctrine ? B.doctrine.night : 0.5; return 1 - 0.25 * n * dark(); }
  // carrier flee radius factor: in the dark a carrier gives surface ships a wider berth
  function cvFleeK() { return 1 + 0.5 * dark(); }
  // a submarine attacks on the surface at night (radar-less escorts can hardly see it)
  function subUp() { return WW.daylight < 0.3; }

  // ---- star shells and searchlights ----
  function litNear(x, z) { for (var i = 0; i < shells.length; i++) if (WW.dist2(shells[i].x, shells[i].z, x, z) < shells[i].r * shells[i].r * 0.5) return true; return false; }
  function active(n) { var k = 0; for (var i = 0; i < shells.length; i++) if (shells[i].nation === n) k++; return k; }
  function usable(s) { return s.alive && !s.sinking && !s.removed && !s.submerged; }
  function fireStar(s, c, now) {
    var dx = c.x - s.x, dz = c.z - s.z, d = Math.hypot(dx, dz) || 1;
    var sh = { x: c.x + dx / d * STAR.BEHIND, z: c.z + dz / d * STAR.BEHIND, y: STAR.H, nation: s.nation, by: s, t0: now,
      lightAt: now + STAR.FLIGHT, until: now + STAR.FLIGHT + STAR.LIFE, lit: false, r: STAR.LIT, fromX: s.x, fromZ: s.z };
    shells.push(sh);
    s.firedAt = now; s.firedCal = 'med';   // the star shell gun's flash (intel.js)
    stats.starShells[s.nation]++;
    WW.emit('starShell', sh);
  }
  function tryStar(s, now) {
    if (!(STAR.SHIPS[s.nation] || {})[s.type] || (nextStar.get(s.id) || 0) > now || active(s.nation) >= STAR.MAX) return;
    var best = null, bd = STAR.R * STAR.R;
    var cs = WW.intel.enemyShips(s.nation);
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], u = c.unit;
      if (!u || !u.alive || u.submerged || u.type === 'submarine' || now - c.seenAt > STAR.AGE) continue;
      var d2 = WW.dist2(s.x, s.z, c.x, c.z);
      if (d2 < STAR.MIN * STAR.MIN || d2 >= bd || litNear(c.x, c.z)) continue;
      bd = d2; best = c;
    }
    if (!best) return;
    nextStar.set(s.id, now + STAR.CD[s.nation]);
    fireStar(s, best, now);
  }
  function lightOff(L, i) { L.ship.searchOn = false; lights.splice(i, 1); WW.emit('searchlight', { ship: L.ship, on: false }); }
  function trySearch(s, now) {
    var d = doc(s.nation), t = s.target;
    if (!d || !(STAR.SHIPS.USN[s.type]) || (nextLight.get(s.id) || 0) > now || s.searchOn) return;
    if ((s.id * 7) % 10 >= (d.searchlight || 0) * 10) return;           // the ships of the side that use them
    if (!t || !usable(t) || WW.dist2(s.x, s.z, t.x, t.z) > SL.R * SL.R || lit(t)) return;
    var c = WW.intel.known(s.nation, t);
    if (!c || now - c.seenAt > SL.AGE) return;
    s.searchOn = true; s.searchTgt = t;
    lights.push({ ship: s, target: t, until: now + SL.ON });
    nextLight.set(s.id, now + SL.ON + SL.CD);
    stats.searchlights[s.nation]++;
    WW.emit('searchlight', { ship: s, on: true, target: t });
  }
  function update(dt) {
    var G = WW.game;
    if (!G || G.state === 'setup') return;
    var now = WW.time.now, w = WW.wind || { x: 0, z: 0 }, i;
    for (i = shells.length - 1; i >= 0; i--) {
      var sh = shells[i];
      if (now >= sh.until) { shells.splice(i, 1); continue; }
      if (now < sh.lightAt) continue;
      sh.lit = true;
      sh.y = Math.max(8, sh.y - STAR.FALL * dt); sh.x += w.x * 2 * dt; sh.z += w.z * 2 * dt;
      sh.r = STAR.LIT * (0.75 + 0.25 * sh.y / STAR.H);
    }
    for (i = lights.length - 1; i >= 0; i--) {
      var L = lights[i], s = L.ship, t = L.target;
      if (now > L.until || !usable(s) || !t || !usable(t) || WW.dist2(s.x, s.z, t.x, t.z) > SL.R * SL.R * 1.3) { lightOff(L, i); continue; }
      t.searchLit = now + 0.6;
    }
    if (G.state !== 'battle' || WW.daylight >= DARK_OPS || !WW.intel) return;
    tickT -= dt; if (tickT > 0) return; tickT += 0.5; if (tickT <= 0) tickT = 0.5;
    var ships = WW.world.ships;
    for (i = 0; i < ships.length; i++) {
      var o = ships[i];
      if (!usable(o) || o.type === 'carrier' || o.type === 'pt' || o.type === 'submarine') continue;
      tryStar(o, now);
      if (WW.daylight < 0.3) trySearch(o, now);
    }
  }
  function clear() {
    shells.length = 0; nextStar.clear(); nextLight.clear(); tickT = 0;
    for (var i = 0; i < lights.length; i++) lights[i].ship.searchOn = false;
    lights.length = 0;
  }
  WW.on('roundStart', clear); WW.on('setupStart', clear);

  WW.nightOps = { update: update, clear: clear, seeR: seeR, visK: visK, lit: lit, radarR: radarR, airK: airK, dayAt: dayAt,
    torpK: torpK, rangeK: rangeK, pressK: pressK, cvFleeK: cvFleeK, subUp: subUp,
    shells: shells, lights: lights, stats: stats, NIGHT_EYE: NIGHT_EYE, RADAR: RADAR, STAR: STAR, SL: SL };
})();
