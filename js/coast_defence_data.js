// coast_defence_data.js - WW.defenceData: the German strongpoints at Omaha and Pointe du Hoc (docs/NORMANDY_PLAN.md P4).
// Data only. Positions are relative to the coast (terrain_normandy.js): x along the beach, `at` where across it:
//   beach  just behind the shingle / in the sea wall (the casemates that enfilade the beach)
//   foot   the foot of the bluffs; slope halfway up them; top the bluff top (+ du u further inland)
// face: which way the embrasure or the gun looks: 'east' / 'west' (along the beach: an enfilade, behind a concrete
// wall that faces the sea), 'sea' (north), 'all' (a turret or an open pit that can traverse).
// Weapons and positions after the 352nd Division's records and the post-battle surveys, simplified: each
// Widerstandsnest (WN) keeps its main guns, its MG42 nests and its mortar pits.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  // the kinds of element. gun: { cal (combat.js WW.SHELL), range u, reload s } or null (MG / mortar: abstract fire,
  // coast_defence_fire.js); hp; crew; rad (the hit footprint, u); wall: a casemate (sea wall 0.15x, the embrasure 1x);
  // arc: half-width of the embrasure / field of fire (rad); top: the roof height above the ground (u, the models and
  // the planes' floor); aa: a flak gun's AA (combat_aa.js shooter)
  const KIND = {
    c88: { name: '8.8 cm Pak 43/41 casemate', type: 'casemate', gun: { cal: 'med', range: 300, reload: 6 }, hp: 260, crew: 6, rad: 2.6, wall: true, arc: 0.75, top: 1.3 },
    c75: { name: '7.5 cm casemate', type: 'casemate', gun: { cal: 'med', range: 230, reload: 6.5 }, hp: 240, crew: 5, rad: 2.4, wall: true, arc: 0.8, top: 1.2 },
    c50: { name: '5 cm KwK casemate', type: 'casemate', gun: { cal: 'small', range: 150, reload: 3.5 }, hp: 200, crew: 4, rad: 2.0, wall: true, arc: 0.85, top: 1.0 },
    g75: { name: '7.5 cm field gun', type: 'gunpit', gun: { cal: 'med', range: 220, reload: 7 }, hp: 120, crew: 5, rad: 1.8, wall: false, arc: 1.4, top: 0.5 },
    g76: { name: '7.62 cm FK 296(r)', type: 'gunpit', gun: { cal: 'med', range: 220, reload: 7 }, hp: 120, crew: 5, rad: 1.8, wall: false, arc: 1.4, top: 0.5 },
    tob: { name: 'Tobruk (5 cm KwK)', type: 'tobruk', gun: { cal: 'small', range: 120, reload: 3 }, hp: 160, crew: 3, rad: 1.2, wall: false, armour: 0.5, arc: Math.PI, top: 0.4 },
    mg: { name: 'MG 42 nest', type: 'mg', gun: null, hp: 70, crew: 3, rad: 1.2, wall: false, arc: 1.1, top: 0.3, range: 95 },
    mortar: { name: '8 cm mortar pit', type: 'mortar', gun: null, hp: 80, crew: 4, rad: 1.3, wall: false, arc: Math.PI, top: 0.2, range: 170 },
    flak: { name: '2 cm Flak 38', type: 'flak', gun: null, hp: 80, crew: 4, rad: 1.4, wall: false, arc: Math.PI, top: 0.4, range: 70, aa: { range: 40, dps: 2 } },
    h155: { name: '15.5 cm K 418(f)', type: 'battery', gun: { cal: 'big', range: 1100, reload: 25 }, hp: 180, crew: 8, rad: 2.2, wall: false, arc: 1.6, top: 0.8 },
    op: { name: 'observation bunker', type: 'bunker', gun: null, hp: 400, crew: 4, rad: 3, wall: true, arc: 0.6, top: 1.6 },
    atwall: { name: 'anti-tank wall', type: 'wall', gun: null, hp: 500, crew: 0, rad: 3.5, wall: false, arc: 0, top: 0.6 }
  };
  const e = (kind, dx, at, face, o) => Object.assign({ kind, dx, at, face }, o || {});
  // west to east; draw: the exit the strongpoint guards (P9: a draw is open when its strongpoints are silenced)
  const WN = [
    { id: 'WN75', name: 'Pointe du Hoc', x: 725, draw: null, hoc: true, els: [
      e('op', 0, 'top', 'sea', { du: -1 }), e('flak', -16, 'top', 'all', { du: 6 }), e('flak', 18, 'top', 'all', { du: 8 }),
      e('mg', -22, 'top', 'sea', { du: 2 }), e('mg', 20, 'top', 'sea', { du: 3 }), e('mg', 2, 'top', 'all', { du: 16 }),
      // the six 155s: in the open pits on the point (the planners' fear), or moved ~1 km inland to an orchard
      // (what the Rangers found: unmanned, laid on Utah; normandy.js settings.hocGuns)
      e('h155', -14, 'top', 'sea', { du: 12, gun: 1 }), e('h155', -4, 'top', 'sea', { du: 20, gun: 2 }), e('h155', 8, 'top', 'sea', { du: 14, gun: 3 }),
      e('h155', 16, 'top', 'sea', { du: 24, gun: 4 }), e('h155', -10, 'top', 'sea', { du: 30, gun: 5 }), e('h155', 4, 'top', 'sea', { du: 34, gun: 6 })] },
    { id: 'WN74', name: 'WN 74 (Pointe de la Percée)', x: 1250, draw: null, els: [
      e('g75', -6, 'top', 'sea', { du: 4 }), e('g75', 8, 'top', 'sea', { du: 6 }), e('mg', 0, 'top', 'east', { du: 1 }), e('mg', 14, 'top', 'east', { du: 2 })] },
    { id: 'WN73', name: 'WN 73', x: 1335, draw: 'D-1', els: [
      e('c75', 0, 'slope', 'east'), e('mg', -6, 'top', 'east', { du: 1 }), e('mg', 8, 'top', 'sea', { du: 2 }), e('mortar', 0, 'top', 'all', { du: 10 })] },
    { id: 'WN72', name: 'WN 72 (Vierville)', x: 1366, draw: 'D-1', els: [
      e('c88', 0, 'beach', 'east'), e('c50', 7, 'beach', 'east'), e('tob', -4, 'foot', 'all'), e('mg', -8, 'foot', 'east'), e('mg', 3, 'slope', 'east'),
      e('atwall', 6, 'foot', 'sea', { du: 3 })] },
    { id: 'WN71', name: 'WN 71', x: 1398, draw: 'D-1', els: [
      e('mg', -6, 'top', 'west', { du: 1 }), e('mg', 2, 'top', 'sea', { du: 1 }), e('mg', 9, 'slope', 'west'), e('tob', 4, 'slope', 'all'),
      e('mortar', -2, 'top', 'all', { du: 9 }), e('mortar', 7, 'top', 'all', { du: 11 })] },
    { id: 'WN70', name: 'WN 70', x: 1482, draw: null, els: [
      e('g75', 0, 'top', 'sea', { du: 3 }), e('mg', -8, 'top', 'sea', { du: 1 }), e('mg', 8, 'top', 'east', { du: 1 }), e('mortar', 0, 'top', 'all', { du: 10 })] },
    { id: 'WN68', name: 'WN 68 (Les Moulins)', x: 1562, draw: 'D-3', els: [
      e('c50', 0, 'foot', 'east'), e('tob', -5, 'foot', 'all'), e('mg', -9, 'slope', 'east'), e('mg', 4, 'slope', 'sea')] },
    { id: 'WN66', name: 'WN 66', x: 1598, draw: 'D-3', els: [
      e('c75', 0, 'foot', 'west'), e('mg', -4, 'slope', 'west'), e('mg', 6, 'slope', 'sea'), e('mortar', 0, 'top', 'all', { du: 8 }), e('mortar', 8, 'top', 'all', { du: 10 })] },
    { id: 'WN65', name: 'WN 65 (St-Laurent)', x: 1680, draw: 'E-1', els: [
      e('c75', 0, 'foot', 'east'), e('c50', 6, 'foot', 'west'), e('mg', -6, 'slope', 'east'), e('mg', 3, 'slope', 'sea')] },
    { id: 'WN64', name: 'WN 64', x: 1716, draw: 'E-1', els: [
      e('g76', 0, 'top', 'sea', { du: 3 }), e('mg', -6, 'top', 'west', { du: 1 }), e('mg', 6, 'top', 'sea', { du: 1 }), e('mortar', 0, 'top', 'all', { du: 9 })] },
    { id: 'WN62', name: 'WN 62 (Colleville)', x: 1876, draw: 'E-3', els: [
      e('c75', 0, 'slope', 'west'), e('c75', 10, 'slope', 'west'), e('tob', 5, 'slope', 'all'),
      e('mg', -6, 'slope', 'west'), e('mg', 3, 'top', 'sea', { du: 1 }), e('mg', 13, 'top', 'west', { du: 2 }),
      e('mortar', 2, 'top', 'all', { du: 10 }), e('mortar', 12, 'top', 'all', { du: 12 })] },
    { id: 'WN61', name: 'WN 61', x: 1896, draw: 'E-3', els: [
      e('c88', 0, 'beach', 'west'), e('tob', 6, 'foot', 'all'), e('mg', 10, 'foot', 'west')] },
    { id: 'WN60', name: 'WN 60', x: 2040, draw: 'F-1', els: [
      e('g75', -4, 'top', 'sea', { du: 3 }), e('g75', 8, 'top', 'west', { du: 4 }), e('mg', -10, 'top', 'west', { du: 1 }), e('mg', 2, 'slope', 'west'),
      e('mortar', 0, 'top', 'all', { du: 10 }), e('mortar', 10, 'top', 'all', { du: 12 })] }
  ];
  // the orchard the Pointe du Hoc guns were moved to (settings.hocGuns 'moved'): ~1 km south-west of the point
  const ORCHARD = { x: 700, du: 105 };
  WW.defenceData = { KIND, WN, ORCHARD };
})(window.WW);
