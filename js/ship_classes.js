// ship_classes.js - real 1942 ship classes (WW.SHIP_CLASSES) and the true-size scale. Load right after core.js.
//
// SCALE: ships are at true relative size. A carrier hull (~250 m) is WW.cfg.L = 26 u, so 1 u = 9.6 m
// (WW.cfg.U_PER_M = 0.104 u/m). Every class's length and beam come from its real dimensions in metres x U_PER_M.
// Distances tied to ship size should be written in L (e.g. 2.7 * L), so they survive any later change of L.
// Two deliberate exaggerations remain, both tied to the open plane-scale question (WW.cfg.PLANE_SCALE):
//   - carrier flight decks are DECK_K x their real width (and the hull beam half that much) so that parked
//     planes at the arcade plane scale still fit; DECK_K = 1 at true plane scale (see deckK below);
//   - sailor figures (models_crew.js) are about 3.8 m tall at the default plane scale (readable, not true scale).
//
// A class: { key, type, nation, name, lenM, beamM, tons, names[], hull{...}, mod{hp, speed, turn, aa}, guns[] }.
//   hull: model loft parameters in fractions (top = deck height u, bowF = bow entry share of L, sternW, sheer u).
//   mod: small multipliers on the type baseline (balance comes later). guns: the class's mounts per calibre; when
//   reload is omitted it keeps the type's fire rate (reload x count / baseline count), so firepower is unchanged.
// The class is picked per ship at spawn (ships.js, WW.rand), except carriers: a carrier's class follows its
// name, and the name follows its slot (air_squadrons.js, persistent squadrons and aces), so Kaga looks like Kaga.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  var L = 26, U = L / 250;
  // Plane scale: 0.82, about 2x true (user's choice, 2026-10-09; an F4F spans 2.4 u, a Yorktown is 26 u long). True
  // scale is ~0.41 (an F4F's 11.6 m span = 1.2 u; the fighter model spans 2.94 u at scale 1); 1.7 is the old arcade
  // scale (~4x) the game was first tuned at. ?planeScale=x overrides (tests, comparison shots).
  // PLANE_K = PLANE_SCALE / 1.7: every length tied to the plane's size (deck spots, wingman slots, hit boxes, gear
  // height, trails, base parking, ground crews) was written at 1.7 and is multiplied by PLANE_K at run time.
  var m = /[?&]planeScale=([0-9.]+)/.exec(typeof location !== 'undefined' ? location.search : '');
  var PS = m ? parseFloat(m[1]) : 0.82, PS_TRUE = 0.41, PS_REF = 1.7;
  var DK = Math.pow(WW.clamp(PS / PS_TRUE, 1, 5), 0.42);   // flight deck widening for the plane scale (1.34 at 0.82, 1.8 at 1.7)
  Object.assign(WW.cfg, { L: L, U_PER_M: U, PLANE_SCALE: PS, PLANE_SCALE_TRUE: PS_TRUE, PLANE_K: PS / PS_REF, DECK_K: DK });

  // Type baselines at true size (the class table below overrides per ship).
  var BASE_LEN = { carrier: 26, battleship: 23, cruiser: 19.5, destroyer: 12, submarine: 10.5, pt: 2.5 };
  for (var t in BASE_LEN) if (WW.SHIP_TYPES[t]) WW.SHIP_TYPES[t].length = BASE_LEN[t];

  function C(o) { return o; }
  var K = [
    // ---------------- USN ----------------
    C({ key: 'yorktown', type: 'carrier', nation: 'USN', name: 'Yorktown class', lenM: 247, beamM: 25.4, deckM: [244, 26.2], tons: 25500,
      names: ['Enterprise', 'Yorktown', 'Hornet', 'Wasp'], island: 1, hull: { top: 1.0, bowF: 0.19, sternW: 0.85, sheer: 0.3 } }),
    C({ key: 'lexington', type: 'carrier', nation: 'USN', name: 'Lexington class', lenM: 270, beamM: 32.3, deckM: [266, 32], tons: 43000,
      names: ['Saratoga', 'Lexington'], island: 1, hull: { top: 1.05, bowF: 0.2, sternW: 0.8, sheer: 0.3 },
      mod: { hp: 1.06, speed: 1.0, turn: 0.9 } }),
    C({ key: 'northcarolina', type: 'battleship', nation: 'USN', name: 'North Carolina class', lenM: 222, beamM: 33, tons: 44800,
      names: ['North Carolina', 'Washington'], hull: { top: 1.0, bowF: 0.24, sternW: 0.72, sheer: 0.5 },
      guns: [{ cal: 'big', count: 3 }, { cal: 'small', count: 2 }] }),
    C({ key: 'southdakota', type: 'battleship', nation: 'USN', name: 'South Dakota class', lenM: 207, beamM: 33, tons: 44500,
      names: ['South Dakota', 'Massachusetts', 'Indiana', 'Alabama'], hull: { top: 1.0, bowF: 0.24, sternW: 0.74, sheer: 0.5 },
      mod: { hp: 1.04, speed: 0.98, turn: 1.05 }, guns: [{ cal: 'big', count: 3 }, { cal: 'small', count: 2 }] }),
    C({ key: 'northampton', type: 'cruiser', nation: 'USN', name: 'Northampton class', lenM: 183, beamM: 20.1, tons: 12000,
      names: ['Northampton', 'Chester', 'Louisville', 'Chicago', 'Houston', 'Augusta'], hull: { top: 0.95, bowF: 0.23, sternW: 0.7, sheer: 0.4 },
      guns: [{ cal: 'med', count: 3 }] }),
    C({ key: 'neworleans', type: 'cruiser', nation: 'USN', name: 'New Orleans class', lenM: 179, beamM: 18.8, tons: 12500,
      names: ['New Orleans', 'Astoria', 'Minneapolis', 'San Francisco', 'Quincy', 'Vincennes', 'Tuscaloosa'],
      hull: { top: 0.9, bowF: 0.23, sternW: 0.7, sheer: 0.4 }, mod: { hp: 1.05, speed: 0.98 }, guns: [{ cal: 'med', count: 3 }] }),
    C({ key: 'atlanta', type: 'cruiser', nation: 'USN', name: 'Atlanta class (AA)', lenM: 165, beamM: 16.2, tons: 8300,
      names: ['Atlanta', 'Juneau', 'San Diego', 'San Juan'], hull: { top: 0.85, bowF: 0.24, sternW: 0.7, sheer: 0.4 },
      mod: { hp: 0.85, speed: 1.03, turn: 1.1, aa: 1.35 }, guns: [{ cal: 'med', count: 6 }], weight: 0.6 }),
    C({ key: 'fletcher', type: 'destroyer', nation: 'USN', name: 'Fletcher class', lenM: 114.8, beamM: 12, tons: 2900,
      names: ['Fletcher', "O'Bannon", 'Nicholas', 'Radford', 'La Vallette', 'Jenkins', 'Chevalier', 'Strong', 'De Haven', 'Saufley'],
      hull: { top: 0.7, bowF: 0.26, sternW: 0.7, sheer: 0.35 }, mod: { hp: 1.05, speed: 0.98, aa: 1.1 }, guns: [{ cal: 'small', count: 5 }] }),
    C({ key: 'benson', type: 'destroyer', nation: 'USN', name: 'Benson class', lenM: 106, beamM: 11, tons: 2400,
      names: ['Benson', 'Laffey', 'Gwin', 'Meredith', 'Monssen', 'Lansdowne', 'Aaron Ward', 'Buchanan', 'Woodworth', 'Farenholt'],
      hull: { top: 0.68, bowF: 0.26, sternW: 0.7, sheer: 0.35 }, mod: { hp: 0.95, speed: 1.0, turn: 1.05 }, guns: [{ cal: 'small', count: 4 }] }),
    C({ key: 'gato', type: 'submarine', nation: 'USN', name: 'Gato class', lenM: 95, beamM: 8.3, tons: 2400,
      names: ['Gato', 'Wahoo', 'Grayback', 'Growler', 'Flying Fish', 'Grouper', 'Drum', 'Silversides', 'Trigger', 'Guardfish'],
      hull: { top: 0.4, bowF: 0.32, sternW: 0.25, sheer: 0.15 } }),
    C({ key: 'elco', type: 'pt', nation: 'USN', name: 'Elco 80 ft PT', lenM: 24.4, beamM: 6.3, tons: 56,
      names: ['PT-109', 'PT-59', 'PT-48', 'PT-61', 'PT-157', 'PT-162', 'PT-37', 'PT-44', 'PT-36', 'PT-60'],
      hull: { top: 0.27, bowF: 0.34, sternW: 0.85, sheer: 0.1 } }),
    // ---------------- IJN ----------------
    C({ key: 'akagi', type: 'carrier', nation: 'IJN', name: 'Akagi', lenM: 261, beamM: 31.3, deckM: [249, 30.5], tons: 42000,
      names: ['Akagi'], island: -1, hull: { top: 1.0, bowF: 0.2, sternW: 0.8, sheer: 0.3 }, mod: { hp: 1.04, speed: 0.95, turn: 0.92 } }),
    C({ key: 'kaga', type: 'carrier', nation: 'IJN', name: 'Kaga', lenM: 247.6, beamM: 32.5, deckM: [248.6, 30.5], tons: 42500,
      names: ['Kaga'], island: 1, hull: { top: 0.95, bowF: 0.19, sternW: 0.82, sheer: 0.25 }, mod: { hp: 1.06, speed: 0.9, turn: 0.9 } }),
    C({ key: 'soryu', type: 'carrier', nation: 'IJN', name: 'Soryu class', lenM: 227.5, beamM: 21.3, deckM: [216.9, 26], tons: 19500,
      names: ['Soryu'], island: 1, hull: { top: 0.95, bowF: 0.2, sternW: 0.82, sheer: 0.3 }, mod: { hp: 0.92, speed: 1.05, turn: 1.08 } }),
    C({ key: 'hiryu', type: 'carrier', nation: 'IJN', name: 'Hiryu', lenM: 227.4, beamM: 22.3, deckM: [216.9, 27], tons: 21000, build: 'soryu',
      names: ['Hiryu'], island: -1, hull: { top: 0.95, bowF: 0.2, sternW: 0.82, sheer: 0.3 }, mod: { hp: 0.94, speed: 1.04, turn: 1.06 } }),
    C({ key: 'shokaku', type: 'carrier', nation: 'IJN', name: 'Shokaku class', lenM: 257.5, beamM: 26, deckM: [242.2, 29], tons: 32000,
      names: ['Shokaku', 'Zuikaku'], island: 1, hull: { top: 1.0, bowF: 0.2, sternW: 0.82, sheer: 0.3 }, mod: { hp: 1.02, speed: 1.03 } }),
    C({ key: 'kongo', type: 'battleship', nation: 'IJN', name: 'Kongo class', lenM: 222, beamM: 31, tons: 37000,
      names: ['Kongo', 'Hiei', 'Kirishima', 'Haruna'], hull: { top: 0.95, bowF: 0.24, sternW: 0.72, sheer: 0.55 },
      mod: { hp: 0.9, speed: 1.08, turn: 1.05 }, guns: [{ cal: 'big', count: 4 }, { cal: 'small', count: 2 }] }),
    C({ key: 'nagato', type: 'battleship', nation: 'IJN', name: 'Nagato class', lenM: 224.9, beamM: 34.6, tons: 46000,
      names: ['Nagato', 'Mutsu'], hull: { top: 1.0, bowF: 0.24, sternW: 0.72, sheer: 0.6 },
      mod: { hp: 1.05, speed: 0.95, turn: 0.95 }, guns: [{ cal: 'big', count: 4 }, { cal: 'small', count: 2 }] }),
    C({ key: 'takao', type: 'cruiser', nation: 'IJN', name: 'Takao class', lenM: 203.8, beamM: 20.7, tons: 15500,
      names: ['Takao', 'Atago', 'Maya', 'Chokai'], hull: { top: 0.9, bowF: 0.25, sternW: 0.68, sheer: 0.5 },
      mod: { hp: 1.04, speed: 1.0 }, guns: [{ cal: 'med', count: 5 }] }),
    C({ key: 'mogami', type: 'cruiser', nation: 'IJN', name: 'Mogami class', lenM: 200.6, beamM: 20.2, tons: 13700,
      names: ['Mogami', 'Mikuma', 'Suzuya', 'Kumano'], hull: { top: 0.88, bowF: 0.25, sternW: 0.68, sheer: 0.5 },
      mod: { hp: 0.97, speed: 1.02, turn: 1.04 }, guns: [{ cal: 'med', count: 5 }] }),
    C({ key: 'kagero', type: 'destroyer', nation: 'IJN', name: 'Kagero class', lenM: 118.5, beamM: 10.8, tons: 2500,
      names: ['Kagero', 'Shiranui', 'Kuroshio', 'Oyashio', 'Hatsukaze', 'Yukikaze', 'Amatsukaze', 'Tokitsukaze', 'Isokaze', 'Hamakaze', 'Tanikaze', 'Nowaki', 'Arashi', 'Hagikaze', 'Maikaze'],
      hull: { top: 0.7, bowF: 0.27, sternW: 0.7, sheer: 0.45 }, mod: { hp: 1.02, speed: 1.0 }, guns: [{ cal: 'small', count: 3 }] }),
    C({ key: 'fubuki', type: 'destroyer', nation: 'IJN', name: 'Fubuki class', lenM: 118.4, beamM: 10.4, tons: 2100,
      names: ['Fubuki', 'Shirayuki', 'Hatsuyuki', 'Murakumo', 'Ayanami', 'Shikinami', 'Amagiri', 'Sagiri', 'Akatsuki', 'Ikazuchi', 'Inazuma', 'Hibiki'],
      hull: { top: 0.7, bowF: 0.27, sternW: 0.7, sheer: 0.45 }, mod: { hp: 0.94, speed: 1.02, turn: 1.04 }, guns: [{ cal: 'small', count: 3 }] }),
    C({ key: 'iboat', type: 'submarine', nation: 'IJN', name: 'Type B1 I-boat', lenM: 108.7, beamM: 9.3, tons: 3650,
      names: ['I-15', 'I-17', 'I-19', 'I-21', 'I-23', 'I-25', 'I-26', 'I-27', 'I-29', 'I-31'],
      hull: { top: 0.42, bowF: 0.3, sternW: 0.25, sheer: 0.2 }, mod: { hp: 1.05, speed: 1.02, turn: 0.92 } }),
    C({ key: 'gyoraitei', type: 'pt', nation: 'IJN', name: 'Gyoraitei T-14', lenM: 20, beamM: 4.4, tons: 20,
      names: ['Gyoraitei 1', 'Gyoraitei 3', 'Gyoraitei 7', 'Gyoraitei 11', 'Gyoraitei 14', 'Gyoraitei 22', 'Gyoraitei 25', 'Gyoraitei 31'],
      hull: { top: 0.25, bowF: 0.36, sternW: 0.85, sheer: 0.1 }, mod: { hp: 0.9, speed: 0.96, turn: 1.05 } })
  ];
  var BY = {}, LIST = { USN: {}, IJN: {} };
  K.forEach(function (c) {
    c.len = +(c.lenM * U).toFixed(2); c.beam = +(c.beamM * U).toFixed(2);
    if (c.deckM) {   // flight deck: true length; width (and so the hull) widened by DECK_K for the plane scale
      c.deckLen = +(c.deckM[0] * U).toFixed(2); c.deckW = +(c.deckM[1] * U * DK).toFixed(2);
      c.beam = +(c.beam * (1 + (DK - 1) * 0.5)).toFixed(2);
    }
    c.navBeam = c.deckW || c.beam;     // the footprint for collision / navigation (the flight deck overhangs)
    c.mod = c.mod || {}; c.weight = c.weight || 1;
    BY[c.key] = c;
    (LIST[c.nation][c.type] = LIST[c.nation][c.type] || []).push(c);
  });
  WW.SHIP_CLASSES = BY;

  // Carrier slot -> name (air_squadrons.js reads this roster; squadrons and aces belong to the slot).
  WW.CV_ROSTER = {
    USN: [['Enterprise', 6], ['Yorktown', 5], ['Hornet', 8], ['Saratoga', 3], ['Lexington', 2], ['Wasp', 7]],
    IJN: [['Akagi'], ['Kaga'], ['Shokaku'], ['Hiryu'], ['Zuikaku'], ['Soryu']]
  };
  function classOfName(nation, type, name) {
    var l = LIST[nation] && LIST[nation][type] || [];
    for (var i = 0; i < l.length; i++) if (l[i].names.indexOf(name) >= 0) return l[i];
    return l[0] || null;
  }
  WW.shipClasses = function (type, nation) { return (LIST[nation] && LIST[nation][type]) || []; };
  WW.classOfName = classOfName;
  // The class for a new ship. key: a forced class key (tests, lineups); else carriers by slot name, others WW.rand.
  WW.pickClass = function (type, nation, key, slot) {
    if (key && BY[key] && BY[key].type === type) return BY[key];
    var l = WW.shipClasses(type, nation);
    if (!l.length) return null;
    if (type === 'carrier') {
      var R = WW.CV_ROSTER[nation] || WW.CV_ROSTER.USN, e = R[(slot || 0) % R.length];
      return classOfName(nation, type, e[0]);
    }
    if (l.length === 1) return l[0];
    var tw = 0, i; for (i = 0; i < l.length; i++) tw += l[i].weight;
    var r = WW.rand() * tw;
    for (i = 0; i < l.length; i++) { r -= l[i].weight; if (r < 0) return l[i]; }
    return l[l.length - 1];
  };
  // Name for a new ship of class c (unique per round per nation; WW.rand picks where to start). ships.js clearAll resets.
  var used = {};
  WW.resetShipNames = function () { used = {}; };
  WW.pickShipName = function (c, nation, fixed) {
    var u = used[nation] || (used[nation] = {});
    if (fixed) { u[fixed] = (u[fixed] || 0) + 1; return u[fixed] > 1 ? fixed + ' II' : fixed; }
    var n = c.names.length, s = n > 1 ? Math.floor(WW.rand() * n) : 0;
    for (var i = 0; i < n; i++) { var nm = c.names[(s + i) % n]; if (!u[nm]) { u[nm] = 1; return nm; } }
    var b = c.names[s]; u[b]++; return b + ' II';
  };

  // Per-class stats: the type's per-nation stats (core.js WW.shipType) shaded by the class. Cached per class.
  var cache = {}, SPD_K = 0.03, TURN_K = 0.05;
  WW.classStats = function (base, c) {
    if (!c) return base;
    var key = c.key, hit = cache[key];
    if (hit && hit._base === base) return hit;
    var st = Object.assign({}, base), md = c.mod;
    st.cls = c.key; st.className = c.name; st.length = c.len; st.beam = c.beam; st.tons = c.tons;
    // speed and turn shading is capped (SPD_K / TURN_K): speed moves distances, and a slow Kaga run down at night by
    // a fast Kongo broke the carrier stand-off (sim_behaviour night cv_min_dist). The table keeps the true ratios.
    st.hp = Math.round(base.hp * (md.hp || 1));
    st.speed = +(base.speed * WW.clamp(md.speed || 1, 1 - SPD_K, 1 + SPD_K)).toFixed(3);
    st.turn = +(base.turn * WW.clamp(md.turn || 1, 1 - TURN_K, 1 + TURN_K)).toFixed(4);
    if (base.aa) st.aa = Object.assign({}, base.aa, { dps: base.aa.dps * (md.aa || 1) });
    if (c.guns) {
      st.guns = c.guns.map(function (g) {
        var b = null; for (var i = 0; i < base.guns.length; i++) if (base.guns[i].cal === g.cal) b = base.guns[i];
        b = b || base.guns[0];
        return Object.assign({}, b, { cal: g.cal, count: g.count, reload: g.reload || +(b.reload * g.count / b.count).toFixed(3) });
      });
    }
    Object.defineProperty(st, '_base', { value: base, enumerable: false });
    return (cache[key] = st);
  };
})(window.WW);
