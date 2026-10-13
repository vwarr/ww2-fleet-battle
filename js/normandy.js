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

  // Settings (URL: ?hoc=casemates&cloud=0&fw190=1): the historical choices the plan leaves open
  //   hocGuns  'moved': the Pointe du Hoc 155s had been moved ~1 km inland to an orchard, unmanned (the Rangers found
  //            and spiked them); 'casemates': in their pits on the point, firing on the fleet (the planners' fear)
  //   cloud    true: the B-24s bomb through cloud and drop about 3 mi inland, as on the day (P8)
  //   fw190    true: Priller and Wodarczyk's two Fw 190s strafe the beach (they were over Sword and Juno: flavour, P8)
  const q = k => { const m = typeof location !== 'undefined' && new RegExp('[?&]' + k + '=(\\w+)').exec(location.search); return m ? m[1] : null; };
  N.settings = { hocGuns: q('hoc') === 'casemates' ? 'casemates' : 'moved', cloud: q('cloud') !== '0', fw190: q('fw190') === '1' };

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
  // positions: x along the coast, z by the distance off the waterline (normandyTerrain.shoreZ: north is -z)
  N.composition = function () {
    const out = [], T = WW.normandyTerrain;
    const off = (x, d) => T.shoreZ(x) - d;
    const put = (type, nation, x, d, extra) => out.push(Object.assign({ type, nation, x, z: off(x, d) }, extra || {}));
    const E = 0;   // heading east, along the coast (the bombardment ships steamed slow lines parallel to the beach)
    put('battleship', 'USN', 820, 470, { heading: E });     // Texas, off Pointe du Hoc
    put('battleship', 'USN', 1720, 450, { heading: E });    // Arkansas, off Omaha
    put('cruiser', 'USN', 1480, 420, { heading: E, flag: 'RN' });    // HMS Glasgow
    for (let i = 0; i < 6; i++) put('destroyer', 'USN', 1000 + i * 190, 260 + (i % 2) * 40, { heading: E });
    for (let i = 0; i < 3; i++) put('pt', 'GER', 60 + i * 40, 380 + i * 30, { heading: E, cls: 'sboot' });   // S-boats out of Cherbourg
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
