// terrain_normandy_data.js - WW.normandyData: the hand-written Normandy coast (docs/NORMANDY_PLAN.md P2). Data only.
// Coordinates: x east (0-2400 on the map, the coast runs on past both edges), z south (the map is 0-1350; the coast
// runs on past the south edge). 1 u = 9.6 m. North is -z: the beach faces north. Heights in u before the vertical
// exaggeration (terrain_normandy.js VEX).
// STATIONS: the cross-shore profile at an x; terrain_normandy.js interpolates every field linearly between stations.
//   zs     the waterline at H-hour (low water, 06:30): depth 0
//   flat   the tidal flat seaward of zs: depth 0 -> 1.5 over this many u (the obstacle belts stand on it)
//   sand   the dry sand above zs to the foot of the shingle (u)
//   sh     the shingle bank's height above the sand (Omaha: a 1-3 m ridge of round stones at high water)
//   wall   the sea wall's height (Vierville to Les Moulins: masonry and timber, 1-3.5 m)
//   shelf  the low ground behind the shingle (marsh, the promenade road and villas) before the bluffs (u); shH its height
//   bw, bh the bluffs (or cliffs): horizontal width and height (Omaha 30-50 m; the cliffs at Pointe du Hoc ~30 m)
//   rock   0-1: rock face colour on the steep (cliffs) rather than grass and scrub (the Omaha bluffs)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const P = {
    cliff: { flat: 10, sand: 2.5, sh: 0.12, wall: 0, shelf: 0, shH: 0.25, bw: 3, bh: 3.2, rock: 1 },
    lowCliff: { flat: 18, sand: 4, sh: 0.15, wall: 0, shelf: 3, shH: 0.3, bw: 5, bh: 1.6, rock: 0.6 },
    beach: { flat: 36, sand: 9, sh: 0.3, wall: 0, shelf: 14, shH: 0.42, bw: 13, bh: 4.2, rock: 0 },
    wallBeach: { flat: 34, sand: 7, sh: 0.28, wall: 0.32, shelf: 11, shH: 0.45, bw: 12, bh: 4.4, rock: 0 },
    narrow: { flat: 24, sand: 4, sh: 0.2, wall: 0, shelf: 0, shH: 0.3, bw: 6, bh: 3.9, rock: 0.5 }
  };
  const st = (x, zs, preset, o) => Object.assign({ x, zs }, P[preset], o || {});
  const STATIONS = [
    st(-500, 1330, 'lowCliff', { bh: 0.9, flat: 40 }),            // the Vire estuary: low ground (Utah is beyond the west edge)
    st(-150, 1250, 'lowCliff', { bh: 1.2 }),
    st(150, 1185, 'lowCliff', { bh: 1.5 }),                       // Grandcamp
    st(420, 1160, 'cliff', { bh: 2.4, rock: 0.8 }),
    st(640, 1152, 'cliff', { bh: 3.0 }),
    // Pointe du Hoc: a sheer headland jutting north, 30 m of cliff on three sides
    st(690, 1148, 'cliff', { bh: 3.2 }), st(703, 1134, 'cliff', { bh: 3.3, sand: 1.5 }), st(714, 1117, 'cliff', { bh: 3.3, sand: 1.2 }),
    st(725, 1106, 'cliff', { bh: 3.25, sand: 1 }),
    st(735, 1113, 'cliff', { bh: 3.3, sand: 1.2 }), st(747, 1131, 'cliff', { bh: 3.3, sand: 1.5 }), st(761, 1147, 'cliff', { bh: 3.2 }),
    st(820, 1152, 'cliff', { bh: 3.2 }),
    st(1000, 1150, 'cliff', { bh: 3.4 }),
    st(1180, 1143, 'cliff', { bh: 3.6 }),
    st(1250, 1136, 'cliff', { bh: 3.8 }),                         // Pointe et Raz de la Percée
    st(1305, 1148, 'narrow'),                                     // Charlie: a narrow beach under the cliffs
    st(1345, 1156, 'wallBeach'),                                  // Dog Green, Vierville
    st(1600, 1166, 'wallBeach'),                                  // Les Moulins: the sea wall ends
    st(1640, 1168, 'beach'),
    st(1800, 1171, 'beach', { bh: 4.6 }),                         // Easy Red: the deepest part of the bay
    st(2000, 1165, 'beach', { bh: 4.4 }),
    st(2125, 1156, 'beach', { flat: 30, sand: 6, shelf: 6 }),     // Fox Red
    st(2180, 1146, 'narrow', { bh: 4.2 }),
    st(2235, 1138, 'cliff', { bh: 4.0, rock: 0.7 }),
    st(2500, 1140, 'cliff', { bh: 4.2, rock: 0.7 }),              // toward Port-en-Bessin
    st(2900, 1150, 'cliff', { bh: 4.0, rock: 0.7 })
  ];
  // The five draws (the valleys through the bluffs: the exits off the beach), each a notch w u half-wide that rises
  // gently inland; the strongpoints that guard them come in P4 (coast_defence_data.js).
  const DRAWS = [
    { id: 'D-1', name: 'Vierville draw', x: 1372, w: 12 },
    { id: 'D-3', name: 'Les Moulins draw', x: 1578, w: 15 },
    { id: 'E-1', name: 'St-Laurent draw', x: 1690, w: 13 },
    { id: 'E-3', name: 'Colleville draw', x: 1862, w: 15 },
    { id: 'F-1', name: 'F-1 draw', x: 1966, w: 11 }
  ];
  // The assault sectors, west to east (x0 - x1 along the beach)
  const SECTORS = [
    { id: 'charlie', name: 'Charlie', x0: 1290, x1: 1355 },
    { id: 'dogGreen', name: 'Dog Green', x0: 1355, x1: 1450 },
    { id: 'dogWhite', name: 'Dog White', x0: 1450, x1: 1525 },
    { id: 'dogRed', name: 'Dog Red', x0: 1525, x1: 1600 },
    { id: 'easyGreen', name: 'Easy Green', x0: 1600, x1: 1665 },
    { id: 'easyRed', name: 'Easy Red', x0: 1665, x1: 1890 },
    { id: 'foxGreen', name: 'Fox Green', x0: 1890, x1: 2015 },
    { id: 'foxRed', name: 'Fox Red', x0: 2015, x1: 2150 }
  ];
  // Villages on the plateau (u: units inland of the bluff top, r: radius), with a church spire where there was one
  const VILLAGES = [
    { name: 'Vierville-sur-Mer', x: 1385, u: 55, r: 22, church: true },
    { name: 'Saint-Laurent-sur-Mer', x: 1700, u: 75, r: 26, church: true },
    { name: 'Colleville-sur-Mer', x: 1905, u: 80, r: 24, church: true },
    { name: 'Saint-Pierre-du-Mont', x: 960, u: 55, r: 16, church: true },
    { name: 'Cricqueville-en-Bessin', x: 640, u: 110, r: 16, church: true },
    { name: 'Englesqueville-la-Percée', x: 1180, u: 90, r: 12, church: false },
    { name: 'Grandcamp', x: 230, u: 20, r: 26, church: true }
  ];
  // Beach obstacle belts on the tidal flat (Omaha, Charlie to Fox Red): s is the distance seaward of the waterline,
  // dx the spacing along the beach. Outermost first: Belgian gates (Element C), then log stakes and ramps topped with
  // Teller mines, then hedgehogs nearest the shore. terrain_normandy.js lays them out with a fixed local PRNG.
  const OBSTACLES = { x0: 1295, x1: 2150, rows: [
    { kind: 'gate', s: 27, dx: 7, mined: 0.35 },
    { kind: 'stake', s: 18, dx: 4.5, mined: 0.7 },
    { kind: 'ramp', s: 13, dx: 9, mined: 0.6 },
    { kind: 'hedgehog', s: 6, dx: 4, mined: 0.1 }
  ] };
  // Pointe du Hoc: the craters of the bombardment (centre and radius, u) - a fixed field, the same every seed
  const HOC = { x: 725, z: 1124, craters: 46, r: 18 };
  WW.normandyData = { STATIONS, DRAWS, SECTORS, VILLAGES, OBSTACLES, HOC, PRESETS: P };
})(window.WW);
