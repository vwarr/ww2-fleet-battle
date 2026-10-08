// ship_supply.js - WW.supply: ammunition and fuel (sim code, no randomness). Load after ships.js.
// Each ship carries, from SUPPLY[type] x the nation's factors (NATION, doctrine-style stat levers):
//   main   rounds for the main battery, counted in turret shots (one fireShell). Below LOW the guns hold fire past
//          CONSERVE x range (no long-range shooting); empty: the main battery is silent (secondaries and AA go on).
//   aa     AA ammunition in battery-seconds (a heavy salvo uses HEAVY_USE, a light-AA tick LIGHT_USE). Below LOW the
//          AA is weaker (x LOW_AA) and shows fewer tracers; empty: silent.
//   torp   torpedo loads (spreads), the first in the tubes. IJN destroyers and cruisers carried a reload set (2);
//          USN destroyers none (1), its cruisers had landed theirs (1). Subs and PT boats: their magazines.
//   fuel   destroyers only, in full-speed seconds: burns (speed / top speed)^3 a second, so economic speed costs a
//          fifth of full speed. Below LOW the destroyer is held to ECON throttle; below CRIT it breaks off home.
// Bands: a normal battle (5-7 min) rarely runs anything dry; long gun duels, long raids and pursuits feel it.
// Events: one WW.dstat per ship and state (supMainLow / supMainOut / supAALow / supAAOut / supTorpOut /
// supFuelLow / supFuelOut), read by tests/doctrine.js. ship.sup holds the state (null until first use).
window.WW = window.WW || {};
(function () {
  'use strict';
  var SUPPLY = {
    carrier:    { main: 400, aa: 300 },
    battleship: { main: 90, aa: 270 },
    cruiser:    { main: 165, aa: 270, torp: 1 },
    destroyer:  { main: 220, aa: 200, torp: 1, fuel: 430 },
    submarine:  { main: 0, aa: 0, torp: 7 },
    pt:         { main: 1e9, aa: 1e9, torp: 2 }
  };
  // per-nation factors / loads: USN deeper AA magazines (the 5"/38 and 40 mm ready-use allowances) and longer-legged
  // destroyers; IJN destroyer and cruiser reloads for the Long Lance
  var NATION = {
    USN: { main: 1, aa: 1.25, fuel: 1.1, torp: { destroyer: 1, cruiser: 1 } },
    IJN: { main: 1, aa: 1, fuel: 1, torp: { destroyer: 2, cruiser: 2 } }
  };
  var LOW = 0.2, CONSERVE = 0.8, LOW_AA = 0.6, HEAVY_USE = 1.1, LIGHT_USE = 0.25, ECON = 0.6, CRIT = 0.08, CRIT_THR = 0.45;

  function sup(ship) {
    var s = ship.sup; if (s) return s;
    var b = SUPPLY[ship.type] || {}, n = NATION[ship.nation] || NATION.USN;
    var torp = b.torp ? (n.torp[ship.type] || b.torp) : 0;
    s = ship.sup = { main: (b.main || 0) * n.main, aa: (b.aa || 0) * n.aa, torp: torp, fuel: b.fuel ? b.fuel * n.fuel : 0, flags: {} };
    s.main0 = s.main; s.aa0 = s.aa; s.fuel0 = s.fuel;
    return s;
  }
  function flag(ship, s, k) { if (!s.flags[k]) { s.flags[k] = true; if (WW.dstat) WW.dstat('sup' + k, ship.nation); } }

  // main battery: may this turret shot be fired at range d? (counts it when it does)
  function shell(ship, gun, d) {
    if (!gun || gun !== ship.stats.guns[0] || ship.type === 'pt') return true; // secondaries / PT MG: plentiful
    var s = sup(ship);
    if (s.main <= 0) return false;
    if (s.main < LOW * s.main0) { flag(ship, s, 'MainLow'); if (d > CONSERVE * gun.range) return false; }
    if (--s.main <= 0) flag(ship, s, 'MainOut');
    return true;
  }
  // AA: the effectiveness factor of this battery tick (0 = silent); heavy: a salvo, else a light-AA tick
  function aa(ship, heavy) {
    var s = sup(ship);
    if (s.aa <= 0) return 0;
    s.aa -= heavy ? HEAVY_USE : LIGHT_USE;
    if (s.aa <= 0) { flag(ship, s, 'AAOut'); return LOW_AA; }
    if (s.aa < LOW * s.aa0) { flag(ship, s, 'AALow'); return LOW_AA; }
    return 1;
  }
  // a torpedo spread went (ships_ai.js fireSpread): the next load, or none (the tubes stay empty)
  function torpFired(ship) {
    var s = sup(ship);
    if (--s.torp <= 0) { s.torp = 0; ship.ai.torpReload = Infinity; flag(ship, s, 'TorpOut'); }
  }
  function torpLeft(ship) { return ship.stats.torpedoes ? sup(ship).torp : 0; }
  // Ship.move: burn fuel for the last step's speed; returns the throttle cap
  function fuel(ship, dt) {
    if (ship.type !== 'destroyer') return 1;
    var s = sup(ship), v = ship.speed / ship.stats.speed;
    s.fuel = Math.max(0, s.fuel - v * v * v * dt);
    if (s.fuel < CRIT * s.fuel0) { flag(ship, s, 'FuelOut'); return CRIT_THR; }
    if (s.fuel < LOW * s.fuel0) { flag(ship, s, 'FuelLow'); return ECON; }
    return 1;
  }
  // nothing left to fight with, or no fuel to fight on: the ship breaks off (fleet_groups.js assign: role withdraw)
  function spent(ship) {
    var s = ship.sup; if (!s) return false;
    if (s.fuel0 && s.fuel < CRIT * s.fuel0) return true;
    return ship.type !== 'carrier' && ship.type !== 'submarine' && ship.type !== 'pt' && s.main0 > 0 && s.main <= 0 && !(s.torp > 0);
  }
  function share(ship, k) { var s = ship.sup; return !s ? 1 : s[k + '0'] ? s[k] / s[k + '0'] : 1; }

  WW.supply = { SUPPLY: SUPPLY, NATION: NATION, LOW: LOW, sup: sup, shell: shell, aa: aa, torpFired: torpFired, torpLeft: torpLeft, fuel: fuel, spent: spent, share: share };
})();
