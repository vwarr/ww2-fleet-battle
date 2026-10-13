// normandy.js - the Normandy scenario's hooks (scenario.js WW.scenarios.normandy): the forces, the commanders and
// the round's ending. Sim code: no visuals; no WW.rand on the Pacific path (every hook runs only in Normandy).
// Geography (docs/NORMANDY_PLAN.md): north is -z; the French coast runs along the south edge, Omaha Beach about
// x 1350-2180 and Pointe du Hoc about x 725; the Allies come in from the north edge.
// Phases fill this in: P1 the plumbing (a bombardment group off the coast and an S-boat patrol, a timeout ending),
// P2 the coast, P4 the defences, P5 the fire-support ships, P6 the landing craft, P9 the victory rules.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const N = WW.scenarios.normandy;
  const PI = Math.PI;

  // the sides that must field ships before Start (ui.js): the Germans hold the coast, their boats are optional
  N.fleetSides = ['USN'];
  N.patrol = false;   // no flying-boat patrols (air_patrol.js)

  // the commanders (admirals.js rosters): Force O off Omaha and the German 352nd Division / the S-boat flotillas
  N.admirals = {
    USN: [
      { key: 'hall', name: 'Hall', full: 'Rear Adm. John L. Hall', style: 'methodical', flag: 'battleship',
        blurb: 'Force O: the assault on Omaha, by the timetable',
        mul: { aggression: 0.95, rangeFrac: 1.0 },
        say: { strike: 'all ships, commence the bombardment', press: 'close the beach and support the troops', retire: 'hold the transport area' } },
      { key: 'bryant', name: 'Bryant', full: 'Rear Adm. Carleton F. Bryant', style: 'gunnery', flag: 'battleship',
        blurb: 'the bombardment group: get on them, get on them',
        mul: { aggression: 1.1, rangeFrac: 0.95 }, riskT: { destroyer: 1.15 },
        say: { strike: 'open fire', press: 'get on them, men, get on them', retire: 'check fire' } }
    ],
    GER: [
      { key: 'kraiss', name: 'Kraiss', full: 'Generalleutnant Dietrich Kraiß', style: 'defensive', flag: 'pt',
        blurb: '352nd Infantry Division: hold the beach at the water line',
        mul: { aggression: 0.9 },
        say: { strike: 'open fire on the landing craft', press: 'counter-attack', retire: 'fall back to the second line' } },
      { key: 'hoffmann', name: 'Hoffmann', full: 'Korvettenkapitän Heinrich Hoffmann', style: 'raider', flag: 'pt',
        blurb: '5th S-boat flotilla: torpedo runs out of the smoke',
        mul: { aggression: 1.1, torpedo: 1.1 },
        say: { strike: 'torpedoes los', press: 'attack the transports', retire: 'return to Le Havre' } }
    ]
  };

  // the forces (P1: a placeholder bombardment group and an S-boat patrol; P5 / P6 bring the real order of battle)
  N.composition = function () {
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, out = [];
    const put = (type, nation, x, z, extra) => out.push(Object.assign({ type, nation, x, z }, extra || {}));
    put('battleship', 'USN', W * 0.32, H * 0.42, { heading: PI / 2 });   // Texas, off Pointe du Hoc
    put('battleship', 'USN', W * 0.7, H * 0.38, { heading: PI / 2 });    // Arkansas, off Omaha
    put('cruiser', 'USN', W * 0.82, H * 0.35, { heading: PI / 2, flag: 'RN' });   // HMS Glasgow
    for (let i = 0; i < 6; i++) put('destroyer', 'USN', W * (0.42 + i * 0.08), H * 0.55, { heading: PI / 2 });
    for (let i = 0; i < 3; i++) put('pt', 'GER', W * (0.12 + i * 0.05), H - 260 + i * 20, { heading: -PI / 2, cls: 'sboot' });
    return out;
  };

  // the round's ending (P1: the time limit only; P9: the draws opened and the beachhead held)
  N.updateGame = function (dt, game) {
    if (game.state !== 'battle') return false;   // the victory banner: main.js
    game.roundTime += dt;
    if (game.roundTime >= WW.cfg.ROUND_TIMEOUT) game.endRound('GER', 'time', 'USN');
    return true;
  };
})(window.WW);
