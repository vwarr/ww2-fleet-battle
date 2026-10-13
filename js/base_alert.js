// base_alert.js - WW.baseAlert: the island base's "we're under attack" moment on its own flying boat's report (sim
// code: no randomness). Loads after land_air.js. Midway, 4 June 1942: on Ady's 05:34 report of carriers and Chase's
// 05:45 "Many planes heading Midway" the island launched everything: VMF-221 scrambled to meet the raid, the bombers
// (VMSB-241, the B-26s and the B-17s) went out at the carriers; radar confirmed the raid at 05:53.
// On a 'flyingBoat' order 'sighting' (air_patrol.js radio / raid) by a boat of the base's owner:
//  - the alarm (island_base.js alarm, kind 'patrol', or 'raid' for planes heading in), once per round: the siren, the
//    camp to its stations (base_life.js), the caption and the war diary line (base_fx.js), the camera's cut to the
//    field (camera.js 'baseAlarm');
//  - base.alertT: until then the field treats the sky as a raid (land_air.js update): its fighters scramble to the
//    raid CAP (a fast launch, baseEvent 'scramble'); ALERT_T s on a fleet report, RAID_T on a raid report;
//  - the strike: a reported cruiser within STRIKE_R of the field, a carrier or battleship within the bombers' combat
//    radius (land_air.js longR), cuts the base's strike timer
//    to GO s (land_air.js picks the target, carriers first, and launches what is ready); a later report with carriers
//    in it does so again.
// Stats: WW.baseAlert.stats (per round).
window.WW = window.WW || {};
(function () {
  'use strict';
  const ALERT_T = 120, RAID_T = 90, GO = 3, FRESH = 10;
  const STRIKE_R = 560;   // land_air.js STRIKE_R: the base's bombers' reach
  const RANK = { carrier: 4, battleship: 3, cruiser: 2, destroyer: 1, submarine: 0.5, pt: 0.2 };
  const ST = { reports: 0, alarms: 0, raids: 0, strikes: 0 };

  function ownBase(n) { const b = WW.islandBase && WW.islandBase.base; return b && b.nation === n && !b.neutralized && b.ai ? b : null; }
  function top(comp) { let t = null; for (const k in comp || {}) if (!t || (RANK[k] || 0) > (RANK[t] || 0)) t = k; return t; }
  // a big ship the side believes is within the bombers' reach of the field (fresh report)
  function inReach(b) {
    for (const c of WW.intel.enemyShips(b.nation, { fresh: FRESH })) {
      const t = WW.intel.typeOf(c);
      const R = RANK[t] >= 3 && WW.landAir.longR ? WW.landAir.longR(b) : STRIKE_R;   // carriers / battleships: the bombers' combat radius (land_air.js)
      if (c.unit && c.unit.alive && !c.unit.isBase && RANK[t] >= 2 && WW.dist(b.x, b.z, c.x, c.z) < R) return true;
    }
    return false;
  }
  WW.on('flyingBoat', e => {
    if (!e || e.order !== 'sighting' || !WW.game || WW.game.state !== 'battle' || !WW.intel) return;
    const b = ownBase(e.nation); if (!b) return;
    const now = WW.time.now, p = e.plane;
    ST.reports++;
    b.alertT = Math.max(b.alertT || 0, now + (e.planes ? RAID_T : ALERT_T));
    if (e.planes) ST.raids++;
    if (!b.alarm && WW.islandBase.alarm) {
      WW.islandBase.alarm(e.planes ? 'raid' : 'patrol', e.x, e.z, { n: e.planes || 0, what: top(e.comp), cv: e.carriers || 0, by: p ? p.boatType : null });
      if (b.alarm) ST.alarms++;
    }
    if (!e.planes && (e.carriers || !b.alertStrike) && inReach(b)) { b.alertStrike = true; b.ai.strikeT = Math.min(b.ai.strikeT, GO); ST.strikes++; }
  });
  WW.on('roundStart', () => { for (const k in ST) ST[k] = 0; });
  WW.baseAlert = { stats: ST, ALERT_T, RAID_T };
})();
