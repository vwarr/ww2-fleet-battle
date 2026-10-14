// fleet_resolve.js - WW.fleetResolve: when a side holds on and when it gives up the fight (sim code, no WW.rand).
// Load after fleet_cmd.js; fleet_cmd.js tick() asks it, and fleet_cmd works the same without it.
//  - Striking power holds a side in the fight. The break rules in fleet_cmd.js (beaten: the fit battleship / cruiser /
//    destroyer tonnage gone, or outfought by the enemy's gun ships) count only gun ships; a side whose screen was shot
//    up but whose carrier still flies a real air group did not leave. Spruance on 4-5 June 1942 kept Enterprise and
//    Hornet in the fight with Yorktown lost and a thin screen; Fletcher left Coral Sea only with Lexington sunk and
//    Yorktown's air group worn down; Nagumo and Yamamoto retired once all four carriers were burning. So: while the
//    side has a carrier afloat, fit (hp >= CRIP), her deck not out for good (ship_deck.js wrecked; a deck out for a
//    while is patched and still counts) and STRIKE_K of the strike planes (dive + torpedo: hangar, re-arming, in the
//    air) the side started with, at least STRIKE_MIN of them, and the light to fly by now or within FLY_AHEAD s, the
//    gun-ship break rules do not fire and the strength picture only opens the range (no break after WD_BREAK).
//    STRIKE_K per navy: the USN of 1942 husbanded its few carriers (Nimitz's "calculated risk"), the IJN pressed on
//    with what it had (Yamaguchi's Hiryu struck twice alone). By night the carriers cannot strike: a carrier force
//    whose screen is gone gives up the fight in the dark (Spruance turned east the night of 4 June rather than meet
//    Yamamoto's battleships; the game has no coming back next morning, so that is the end of its part).
//    The enemy judges it the same way, on what it knows (fleet_cmd.js foeBroken): a known enemy carrier, fit as last
//    seen and not seen wrecked or proven bare, is no fleet that is beaten.
//  - Hysteresis on the strength picture: the posture turns to 'withdraw' on the ratio only after it has stayed below
//    doctrine.withdrawRatio for CONFIRM s, and turns back only once the ratio is RESUME x withdrawRatio (one bad
//    exchange, or a contact blinking in and out of sight, flipped a side between withdraw and approach every 16 s,
//    and the withdraw then became a break; midway seeds 4, 5).
// Retreat probe (tests/retreat_probe.js, 30 rounds standard / carrier_duel / midway): 19 of 33 breaks came while the
// side had a fit carrier with more than half its planes, all on the gun-ship rules.
window.WW = window.WW || {};
(function () {
  'use strict';
  var STRIKE_K = { USN: 0.4, IJN: 0.3 }, STRIKE_KD = 0.35, STRIKE_MIN = 12, FLY_AHEAD = 60;
  var CONFIRM = 6, RESUME = 1.2;
  var TUNE = { hold: 1 };   // 0: off (A/B)
  var crip = function () { return WW.fleetGroups ? WW.fleetGroups.CRIP : 0.35; };
  var wrecked = function (s) { return !!(WW.shipDeck && WW.shipDeck.wrecked(s)); };
  function light() {   // flying now, or within FLY_AHEAD s (fleet_cmd.js airWar's dawn look-ahead)
    var D = WW.dayNight;
    return !D || D.canFly() || D.level(D.roundT() + FLY_AHEAD) >= D.FLY_MIN;
  }
  // the strike planes of nation n's carriers that can still fly a strike (fit, deck not wrecked)
  function strikeN(n, fitOnly) {
    var S = WW.world.ships, k = 0, F = WW.fleetCmd;
    for (var i = 0; i < S.length; i++) {
      var q = S[i]; if (!q.alive || q.sinking || q.isBase || q.nation !== n || q.type !== 'carrier') continue;
      if (fitOnly && (q.hp < crip() * q.maxHp || wrecked(q))) continue;
      k += F.airGroup(q);
    }
    return k;
  }
  // does side B still have the striking power to stay in the fight? (its own true state)
  function striking(B) {
    if (B.strike0 === undefined) B.strike0 = strikeN(B.nation, false);   // the first tick: the air groups it brought
    if (!TUNE.hold || !B.strike0 || !light()) return false;
    var k = STRIKE_K[B.nation] !== undefined ? STRIKE_K[B.nation] : STRIKE_KD;
    return strikeN(B.nation, true) >= Math.max(STRIKE_MIN, k * B.strike0);
  }
  // the enemy as side B knows it: airUp = a known enemy carrier, fit as last seen, not seen wrecked or proven bare
  function foeStriking(airUp) { return !!(TUNE.hold && airUp && light()); }
  // The strength-picture withdraw with hysteresis. low: the ratio is under the doctrine's withdrawRatio (and the
  // other conditions of fleet_cmd.js hold). Returns true while the side should take / keep posture 'withdraw'.
  function ratioWithdraw(B, low, now) {
    if (!low) {
      B.lowSince = 0;
      // already opening the range: hold it until the picture is clearly better
      return B.posture === 'withdraw' && !B.brokenAt && B.strength.ratio < RESUME * B.doctrine.withdrawRatio && B.ratioHold;
    }
    if (!B.lowSince) B.lowSince = now;
    var on = B.posture === 'withdraw' || now - B.lowSince >= CONFIRM;
    B.ratioHold = on;
    return on;
  }
  WW.fleetResolve = { TUNE: TUNE, STRIKE_K: STRIKE_K, striking: striking, foeStriking: foeStriking, ratioWithdraw: ratioWithdraw };
})();
