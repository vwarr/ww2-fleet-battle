// ship_speed.js - WW.shipSpeed: damage slows ships (sim code: WW.rand only). Load after ships.js.
// A ship's top speed is stats.speed x ship.speedK, where speedK is the product of
//   hull damage   1 above HP_HI of its hp, easing to HP_LO_K at HP_LO and below;
//   flooding      -FLOOD per torpedo hit, at most FLOOD_MAX (each hit also deepens the list, damage.js / syncGroup);
//   engine room   a heavy hit (torpedo, bomb, big shell) knocks the engines down to ENGINE_K with chance CRIT
//                 (a torpedo CRIT_TORP, in the after third CRIT_AFT: shafts, rudder and engine rooms, as Prince of
//                 Wales's port shaft and Bismarck's rudder): half the time for good, otherwise until the
//                 damage-control party has it back (CRIT_T s).
// The side's doctrine.damageControl (USN 1.5, IJN 1) divides the flooding, the repair time and the permanent share.
// Ship.takeDamage calls hit() before damage.js; Ship.move reads k() for its target speed. ship.speedK is public
// (the behaviour suite reads it), ship.flood and ship.engineT too.
window.WW = window.WW || {};
(function () {
  'use strict';
  var HP_HI = 0.7, HP_LO = 0.15, HP_LO_K = 0.5;  // hp share -> speed factor
  var FLOOD = 0.12, FLOOD_MAX = 0.45;           // per torpedo hit (was 0.08 / 0.3: a hit now visibly slows a big ship)
  var CRIT = 0.12, CRIT_TORP = 0.25, CRIT_AFT = 0.45, ENGINE_K = 0.5, CRIT_T = [25, 60], CRIT_PERM = 0.5;
  var MIN_K = 0.15;
  var stats = { crits: 0, permanent: 0, floods: 0 };

  function hpK(f) { return f >= HP_HI ? 1 : f <= HP_LO ? HP_LO_K : HP_LO_K + (1 - HP_LO_K) * (f - HP_LO) / (HP_HI - HP_LO); }
  function calc(ship) {
    var k = hpK(ship.hp / ship.maxHp) * (1 - (ship.flood || 0)) * (ship.engineK || 1);
    return (ship.speedK = Math.max(MIN_K, k));
  }
  // A hit on a live ship (Ship.takeDamage, after hp is reduced). kind: 'shell' | 'torpedo' | 'bomb' | 'dc'.
  // doctrine.damageControl (fleet_groups.js) divides flooding, repair time and the permanent share
  function dcOf(ship) { var d = WW.fleetCmd && WW.fleetCmd.doctrine(ship.nation); return d && d.damageControl > 0 ? d.damageControl : 1; }
  function hit(ship, amount, kind, cal, hx, hz) {
    if (!ship.alive || ship.hp <= 0 || !(amount > 0)) return;
    var dc = dcOf(ship);
    if (kind === 'torpedo' && ship.type !== 'submarine') { ship.flood = Math.min(FLOOD_MAX, (ship.flood || 0) + FLOOD / dc); stats.floods++; }
    var heavy = kind === 'torpedo' || kind === 'bomb' || cal === 'big';
    var cp = CRIT;
    if (kind === 'torpedo') { // aft third of the hull: the shafts and the rudder
      var aft = hx !== undefined && isFinite(hx) ? (hx - ship.x) * Math.cos(ship.heading) + (hz - ship.z) * Math.sin(ship.heading) < -ship.stats.length / 6 : false;
      cp = aft ? CRIT_AFT : CRIT_TORP;
    }
    if (heavy && ship.type !== 'pt' && WW.rand() < cp) {
      stats.crits++;
      ship.engineK = ENGINE_K;
      if (WW.rand() < CRIT_PERM / dc) { ship.engineT = Infinity; stats.permanent++; }
      else ship.engineT = Math.max(ship.engineT > 0 ? ship.engineT : 0, WW.randRange(CRIT_T[0], CRIT_T[1]) / dc);
      WW.emit('engineHit', { ship: ship, permanent: ship.engineT === Infinity });
    }
    calc(ship);
  }
  // Ship.move: the speed factor this step (the engine-room repair clock runs here).
  function k(ship, dt) {
    if (ship.engineT > 0 && ship.engineT !== Infinity) { ship.engineT -= dt; if (ship.engineT <= 0) { ship.engineT = 0; ship.engineK = 1; } }
    return calc(ship);
  }
  // Top speed now (units/s): AI code compares these (a slowed carrier can be run down).
  function vmax(ship) { return ship.stats.speed * (ship.speedK === undefined ? 1 : ship.speedK); }
  function reset() { stats.crits = stats.permanent = stats.floods = 0; }
  WW.on('roundStart', reset);
  WW.shipSpeed = { hit: hit, k: k, vmax: vmax, hpK: hpK, stats: stats, HP_HI: HP_HI, HP_LO: HP_LO };
})();
