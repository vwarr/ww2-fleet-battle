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

  // The clock (docs/NORMANDY_PLAN.md "Time compression"): the round opens at 05:50 (H-40, the bombardment), H-hour
  // 06:30 comes at H sim s; after it each sim second is about 1/2.6 of a minute, so ~6 hours of the day fit the round.
  N.clock = { H: 60, START: 5 * 60 + 50, PRE_K: 40 / 60, POST_K: 1 / 2.6,
    minutes(t) { return t < this.H ? this.START + t * this.PRE_K : 6 * 60 + 30 + (t - this.H) * this.POST_K; },   // minutes after midnight
    at(min) { return min < 6 * 60 + 30 ? (min - this.START) / this.PRE_K : this.H + (min - 6 * 60 - 30) / this.POST_K; }, // sim s of a clock time
    label(t) { const m = Math.floor(this.minutes(t)); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); } };

  // The forces: Force O's bombardment group (Rear Adm. Bryant) off Omaha and Pointe du Hoc. x along the coast, d the
  // distance off the waterline (normandyTerrain.shoreZ: north is -z). fs: the fire-support role (ai_fire_support.js):
  // tasks, the strongpoints of its fire plan in order (pre-planned fire, then call fire on them first); far / near: the
  // stand-off before and after the destroyers close the beach (H+60).
  N.composition = function () {
    const out = [], T = WW.normandyTerrain;
    const put = (type, cls, name, x, d, fs, flag) => out.push({ type, nation: 'USN', cls, name, flag, x, z: T.shoreZ(x) - d, heading: 0, fs: Object.assign({ x, far: d }, fs) });
    put('battleship', 'newyork', 'Texas', 900, 520, { tasks: ['WN75', 'WN73', 'WN72'] });
    put('battleship', 'wyoming', 'Arkansas', 1880, 500, { tasks: ['WN62', 'WN61', 'WN60'] });
    put('cruiser', 'town', 'Glasgow', 1520, 470, { tasks: ['WN70', 'WN68', 'WN66'] }, 'RN');
    put('cruiser', 'galissoniere', 'Georges Leygues', 1720, 480, { tasks: ['WN65', 'WN64'] }, 'FNFL');
    put('cruiser', 'galissoniere', 'Montcalm', 2200, 520, { tasks: ['WN60', 'WN62'] }, 'FNFL');
    // the gun destroyers: Satterlee and Talybont covered the Rangers at Pointe du Hoc
    put('destroyer', 'gleaves', 'Satterlee', 760, 300, { tasks: ['WN75'], near: 110 });
    put('destroyer', 'hunt', 'Talybont', 840, 320, { tasks: ['WN75', 'WN74'], near: 120 }, 'RN');
    put('destroyer', 'gleaves', 'Thompson', 1260, 300, { tasks: ['WN74', 'WN73'], near: 100 });
    put('destroyer', 'gleaves', 'McCook', 1340, 310, { tasks: ['WN73', 'WN72'], near: 100 });
    put('destroyer', 'gleaves', 'Carmick', 1420, 300, { tasks: ['WN72', 'WN71', 'WN70'], near: 95 });
    put('destroyer', 'gleaves', 'Harding', 1580, 310, { tasks: ['WN68', 'WN66'], near: 100 });
    put('destroyer', 'gleaves', 'Baldwin', 1700, 300, { tasks: ['WN65', 'WN64'], near: 95 });
    put('destroyer', 'gleaves', 'Emmons', 1830, 310, { tasks: ['WN62', 'WN61'], near: 100 });
    put('destroyer', 'gleaves', 'Doyle', 1930, 300, { tasks: ['WN61', 'WN62'], near: 95 });
    put('destroyer', 'gleaves', 'Frankford', 2050, 310, { tasks: ['WN60'], near: 100 });
    // an S-boat raid out of Cherbourg (the 5th flotilla was out that night; none reached Omaha: flavour)
    for (let i = 0; i < 2; i++) out.push({ type: 'pt', nation: 'GER', cls: 'sboot', x: 60 + i * 40, z: T.shoreZ(60) - 420 - i * 30, heading: 0 });
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
