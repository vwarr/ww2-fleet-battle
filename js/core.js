// core.js (owner A): config, helpers, event bus, data tables. Matches CONTRACT.md.
window.WW = window.WW || {};
(function (WW) {
  // 2400 x 1350 (was 960 x 600): the carriers start ~2350 apart, about 10x a big ship's visual range (240), as in
  // 1942 when the carrier forces never sighted each other: the battle opens with an air war while the fleets are out of
  // sight, and the surface forces close later (fleet_cmd.js air-war hold). Ships keep their size; the sea grows.
  // REF_W: the old width, for the few tactical distances that were written as a share of it (fleet_formation vanguard).
  // ROUND_TIMEOUT sim s (x3.27 real at 1x, BASE_SPEED 0.306 = true speed: WW.time.base): see docs/ARCHITECTURE.md "Time" for how it was picked.
  WW.cfg = { MAP_W: 2400, MAP_H: 1350, REF_W: 960, CELL: 2, ROUND_TIMEOUT: 720 /* sim seconds */ };
  // Sim-only mode (index.html?sim, headless tests): the full simulation with no rendering, no visuals and no
  // render loop (main.js boot). Results are bit-identical to normal mode (tests/determinism.js --cross).
  WW.simOnly = WW.cfg.SIM_ONLY = /[?&]sim(&|=|$)/.test(location.search);

  // Seedable RNG (mulberry32). WW.seedRandom(n) resets it; default seeded from Math.random.
  let _s = (Math.random() * 4294967296) >>> 0;
  WW.seedRandom = function (seed) { _s = (seed >>> 0) || 1; };
  // the generator's whole state (main.js round record: a look-ahead copy of the round starts from the same draws)
  WW.randState = () => _s;
  WW.setRandState = s => { _s = s >>> 0; };
  WW.rand = function () {
    _s = (_s + 0x6D2B79F5) >>> 0;
    let t = _s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  WW.randRange = (a, b) => a + (b - a) * WW.rand();
  WW.randInt = (a, b) => Math.floor(a + (b - a + 1) * WW.rand()); // inclusive
  WW.pick = arr => arr[Math.floor(WW.rand() * arr.length)];
  WW.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // An InstancedMesh written densely in [0, count): upload only those instances (and their colours too with
  // `color`, when it has them) instead of the whole capacity every frame, and nothing when none are drawn. For visual modules only.
  // Several calls before one render keep the widest range (three resets updateRange.count to -1 on upload).
  const usedRange = WW.attrUsed = (a, c) => { const r = a.updateRange; r.offset = 0; r.count = Math.max(r.count, c); a.needsUpdate = true; }; // any attribute: its first c floats
  WW.instUsed = function (im, color) {
    const n = im.count; if (!(n > 0)) return;
    usedRange(im.instanceMatrix, n * 16);
    if (color && im.instanceColor) usedRange(im.instanceColor, n * 3);
  };
  WW.lerp = (a, b, t) => a + (b - a) * t;
  // signed shortest diff b-a in (-PI, PI]
  WW.angleDiff = function (a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d <= -Math.PI) d += Math.PI * 2;
    else if (d > Math.PI) d -= Math.PI * 2;
    return d;
  };
  WW.dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
  WW.dist2 = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; };

  // Event bus
  const _handlers = {};
  WW.on = function (name, fn) { (_handlers[name] = _handlers[name] || []).push(fn); };
  WW.emit = function (name, data) {
    const hs = _handlers[name];
    if (!hs) return;
    for (let i = 0; i < hs.length; i++) {
      try { hs[i](data); } catch (e) { console.error('WW event ' + name, e); }
    }
  };

  // Doctrine metrics (formation, zigzag, torpedoes, subs, ammo / fuel): per-round counters per nation, read by
  // tests/doctrine.js. Sim code adds to them; nothing reads them back. Reset on roundStart / setupStart.
  WW.docStats = {};
  WW.dstat = function (key, nation, v) {
    const o = WW.docStats[key] || (WW.docStats[key] = { USN: 0, IJN: 0 });
    o[nation] = (o[nation] || 0) + (v === undefined ? 1 : v);
  };
  WW.on('roundStart', () => { WW.docStats = {}; });
  WW.on('setupStart', () => { WW.docStats = {}; });

  WW.time = { now: 0, dt: 0, scale: 1 };
  WW.scene = null; WW.camera = null; WW.renderer = null;

  WW.stats = { planesLaunched: 0, planesLanded: 0, planesLost: 0, shellsFired: 0, torpedoesFired: 0,
               bombsDropped: 0, depthCharges: 0, hits: 0, shipsSunk: 0, round: 0 };

  WW.NATIONS = {
    USN: { id: 'USN', name: 'USN', hull: 0x7d8a99, deck: 0x9a8f78, super: 0x6c7a8a, accent: 0x2b4f8c, mark: 'star', ui: '#7fb2ff' },
    IJN: { id: 'IJN', name: 'IJN', hull: 0x6b7366, deck: 0x8c7a5a, super: 0x5d6658, accent: 0xb02a2a, mark: 'disc', ui: '#ff7a6b' },
    // Normandy (scenario.js): the German side. Kriegsmarine light grey S-boats, field-grey coast defences
    GER: { id: 'GER', name: 'Germany', hull: 0x8a8f8c, deck: 0x7d7a6e, super: 0x9a9e9a, accent: 0x3b3b3b, mark: 'cross', ui: '#d9c27a' }
  };
  // Allied flags within a side (ship.flag): the side key stays USN for every Allied hull; only the palette, the ensign,
  // the crew's uniform, class picking and doctrine shading read the flag
  WW.FLAGS = {
    USN: { id: 'USN', name: 'USN', nation: 'USN' },
    RN: { id: 'RN', name: 'Royal Navy', nation: 'USN', hull: 0x8f969c, deck: 0x9a8f78, super: 0xa3a9ad, accent: 0xb03030, mark: 'roundel', ui: '#9fc2ff' },
    FNFL: { id: 'FNFL', name: 'Forces navales françaises libres', nation: 'USN', hull: 0x7f8890, deck: 0x9a8f78, super: 0x8d969c, accent: 0x2b4f8c, mark: 'roundel', ui: '#9fb8ff' }
  };
  // side -> the other side: a table set by the scenario (scenario.js WW.setScenario; Pacific USN <-> IJN)
  WW.ENEMY = { USN: 'IJN', IJN: 'USN' };
  WW.enemyOf = n => WW.ENEMY[n];

  WW.SHIP_TYPES = {
    carrier:    { name: 'Carrier',    hp: 900, speed: 5.6, turn: 0.25, length: 26, minDepth: 6, tons: 30000,
                  guns: [{ cal: 'small', count: 2, range: 60, reload: 3 }], aa: { range: 45, dps: 6 },
                  planes: { fighter: 6, dive: 4, torpedo: 4 }, torpedoes: null, depthCharges: false },
    battleship: { name: 'Battleship', hp: 1200, speed: 4.2, turn: 0.22, length: 24, minDepth: 7, tons: 45000,
                  guns: [{ cal: 'big', count: 3, range: 170, reload: 9 }, { cal: 'small', count: 2, range: 60, reload: 3 }], aa: { range: 40, dps: 7 },
                  planes: null, torpedoes: null, depthCharges: false },
    cruiser:    { name: 'Cruiser',    hp: 650, speed: 5.5, turn: 0.35, length: 18, minDepth: 5, tons: 12000,
                  guns: [{ cal: 'med', count: 3, range: 120, reload: 5 }], aa: { range: 42, dps: 8 },
                  planes: null, torpedoes: { count: 4, range: 110, reload: 40 }, depthCharges: false },
    destroyer:  { name: 'Destroyer',  hp: 300, speed: 6.5, turn: 0.6, length: 12, minDepth: 3, tons: 2000,
                  guns: [{ cal: 'small', count: 2, range: 70, reload: 2.5 }], aa: { range: 30, dps: 3 },
                  planes: null, torpedoes: { count: 4, range: 100, reload: 30 }, depthCharges: true },
    submarine:  { name: 'Submarine',  hp: 200, speed: 3.5, turn: 0.4, length: 10, minDepth: 9, tons: 1500,
                  guns: [], aa: null, planes: null, torpedoes: { count: 2, range: 120, reload: 25 }, depthCharges: false },
    pt:         { name: 'PT Boat',    hp: 80,  speed: 7.2, turn: 1.2, length: 5,  minDepth: 1.5, tons: 50,
                  guns: [{ cal: 'mg', count: 1, range: 35, reload: 0.4 }], aa: { range: 20, dps: 1 },
                  planes: null, torpedoes: { count: 2, range: 70, reload: 35 }, depthCharges: false }
  };

  // Speeds on the ship clock (1 u/s ~ 5.71 kn, docs/speed_calibration.md): carrier 5.6 = 32 kn, cruiser 5.5 = 31, battleship
  // 4.2 = 24 (class mods up to ~27), submarine 3.5 = 20 surfaced, destroyer 6.5 = 37 (Fletcher 36.5, Kagero 35.5, Fubuki
  // 38; was 7.5 = 43), PT 7.2 = 41 (Elco 80 ft; was 11 = 63, faster than its own 36 kn Mk 8 torpedo) (speedcal, 2026-10-19).
  // Ship HP scale: tuned so a round at 1x lasts about 3-4 minutes.
  const HP_SCALE = 2.0;
  for (const k in WW.SHIP_TYPES) WW.SHIP_TYPES[k].hp = Math.round(WW.SHIP_TYPES[k].hp * HP_SCALE);

  WW.SHELL = { mg: { dmg: 2, speed: 120, splash: 0.6 }, small: { dmg: 12, speed: 90, splash: 1.2 },
               med: { dmg: 35, speed: 80, splash: 2 }, big: { dmg: 110, speed: 70, splash: 3.5 } };
  // vs: a torpedo hit's direct damage x this by the target type (combat_weapons.js updateTorp), on top of the flooding
  // it lets in (ship_fires.js breaches): the torpedo was 1942's ship killer, because it opens the hull below the
  // waterline where no armour deck helps. Set from the record of hits to sink (with the flooding): a carrier 3-4
  // (Yorktown dead in the water after 2 at Midway, Hornet after 2-3, Shoho 7 with 13 bombs), a battleship 5-7 (Prince
  // of Wales 6, Yamato 10+), a cruiser 2-3 (Northampton and Chicago: 2), a destroyer 1 (often broken in two), a
  // submarine 1. Before (balance pass, Oct 2026) every type took the bare warhead: a carrier needed ~8 hits.
  WW.TORPEDO = { dmg: 220, speed: 8, vs: { carrier: 2.3, battleship: 1.8, cruiser: 2.1, destroyer: 2.8, submarine: 2.5 } };   // raw hits to sink (x HP_SCALE): CV ~3.5, BB ~6, CA ~2.8, DD 1 (Oct 2026 lethality pass)
  // Torpedoes per nation and launcher (ship = destroyer / cruiser tubes): rangeK x the type's torpedo range, speed,
  // dud (share of hits that do not go off, rolled with WW.rand at launch), sight (the wake: x the range at which a
  // ship's lookouts can see the track, intel.js TL.WAKE). IJN Type 93 "Long Lance": oxygen-driven, long, fast and
  // nearly wakeless (its exhaust is mostly CO2, which dissolves: a faint trace, 0.4); Type 95 (sub) likewise; Type 91
  // (aerial, and the IJN PT) an ordinary air-driven wake (1). USN 1942 Mk 15 / Mk 14 / Mk 13 / Mk 8: wet-heater steam
  // torpedoes, a clear white wake (1.1), and the notorious exploder duds, worst in the Mk 14 (subs); the aerial
  // Mk 13's troubles were its slow, fragile run, not its exploder (no duds). Balance levers (AI_DESIGN §4, §8).
  // Speeds (torpedo realism, 2026-10-18): every torpedo at its real 1942 speed on the ship clock, where 1 u/s is
  // ~5.71 kn (a carrier's 32 kn = 5.6 u/s). Sources: J. Campbell, Naval Weapons of World War Two (1985), and the
  // NavWeaps torpedo pages (navweaps.com/Weapons/WTJAP_WWII.php, WTUS_WWII.php):
  //   Type 93 Mod 1 (IJN DD / CA): 48-50 kn for 20-22 km (36 kn for 40 km)            48 kn -> 8.4 u/s
  //   Mk 15 (USN DD): 45 kn for 6,000 yd (26.5 kn for 15,000 yd)                     45 kn -> 7.9
  //   Type 95 Mod 1 (IJN sub): 49-51 kn for 9,000 m                                   49 kn -> 8.6 (was 15)
  //   Mk 14 (USN sub): 46 kn for 4,500 yd (31 kn for 9,000 yd)                        46 kn -> 8.05 (was 13.5)
  //   Mk 8 (USN PT, 1942): 36 kn for 8,000 yd (27 kn for 16,000 yd); PTs fired inside 2,000 yd   36 kn -> 6.3 (was 13.5)
  //   Type 91 Mod 2 (IJN aerial, and the IJN's few torpedo boats): 41-43 kn for 2,000 m   42 kn -> 7.35 (air was 10, PT 14)
  //   Mk 13 (USN aerial, 1942): 33.5 kn for 6,300 yd                                  33.5 kn -> 5.85 (was 8)
  // The aerial torpedoes had been sped up (10 / 8) because ships combed them with perfect, certain sightings and the
  // nav turn rate (about twice the real one); with the lookouts' real odds (intel.js) and the real turn while
  // combing (ships.js combR), they run at their real speed. GER (Normandy, out of scope) is unchanged.
  // dmgK: the warhead, x WW.TORPEDO.dmg (balance pass, Oct 2026): Type 93 490 kg against the Mk 15's 374 kg (1.31x),
  // Type 95 405 kg against the Mk 14's 230 kg (1.76x; here 1.5x), Type 91 Mod 2 204 kg against the 1942 Mk 13's 182 kg
  // (1.12x), Mk 8 (PT) 211 kg; set about the old common 220 so a torpedo hit stays as deadly on average.
  // USN duds (balance pass): Mk 15 0.2 and Mk 14 0.3, nearer the 1942 record (the Mk 6 exploder both carried; the
  // Mk 14's failures were only fixed in 1943).
  WW.TORPEDO_NATION = {
    IJN: { ship: { rangeK: 1.4, speed: 8.4, dud: 0, sight: 0.4, dmgK: 1.2 }, submarine: { rangeK: 1.2, speed: 8.6, dud: 0, sight: 0.4, dmgK: 1.2 },
           pt: { rangeK: 1, speed: 7.35, dud: 0, sight: 1, dmgK: 1 }, air: { rangeK: 1, speed: 7.35, dud: 0, sight: 1, dmgK: 1.1 } },
    USN: { ship: { rangeK: 0.95, speed: 7.9, dud: 0.2, sight: 1.1, dmgK: 0.9 }, submarine: { rangeK: 1, speed: 8.05, dud: 0.3, sight: 1.1, dmgK: 0.8 },
           pt: { rangeK: 1, speed: 6.3, dud: 0.1, sight: 1.1, dmgK: 0.9 }, air: { rangeK: 1, speed: 5.85, dud: 0, sight: 1.1, dmgK: 1 } },
    // Normandy (scenario.js): S-boat G7a / G7e, 44 kn and 30 kn, 280 kg warheads, reliable by 1944
    GER: { pt: { rangeK: 1.2, speed: 12, dud: 0.03, sight: 0.9, dmgK: 1.15 } }
  };
  WW.torpSpec = function (nation, launcher) { // launcher: a ship type, or 'air'
    const N = WW.TORPEDO_NATION[nation] || {};
    return N[launcher === 'destroyer' || launcher === 'cruiser' ? 'ship' : launcher] || { rangeK: 1, speed: WW.TORPEDO.speed, dud: 0, sight: 1 };
  };
  // Per-nation ship stats: WW.SHIP_TYPES[type] with the nation's torpedoes (range, speed, dud, sight) merged in.
  // ships.js gives each Ship this object as ship.stats; cached, so every ship of a type and nation shares one.
  const _stCache = {};
  WW.shipType = function (type, nation) {
    const key = type + '|' + nation;
    if (_stCache[key]) return _stCache[key];
    const b = WW.SHIP_TYPES[type], st = Object.assign({}, b);
    if (b.torpedoes) {
      const q = WW.torpSpec(nation, type);
      st.torpedoes = Object.assign({}, b.torpedoes, { range: Math.round(b.torpedoes.range * q.rangeK), speed: q.speed, dud: q.dud, sight: q.sight, dmgK: q.dmgK || 1 });
    }
    return (_stCache[key] = st);
  };
  // Bombs (combat_weapons.js). vs: share of a bomb's damage that reaches the vitals, by the target's protection: a
  // battleship's 5-6 in armoured deck stops a dive bomber's 1000 lb SAP / 250 kg bomb above the citadel (the hit wrecks
  // superstructure and secondaries: South Dakota's turret at Santa Cruz, Hiei and Kirishima were finished by guns and
  // torpedoes, not bombs); a cruiser's 1-2.5 in deck keeps out part of it (Mogami lived through six 1000 lb hits,
  // Mikuma took five or more); carriers, destroyers, PT boats and submarines have no deck armour to speak of.
  // aim: dive-bombing aim error at release, Gaussian (combat_weapons.js diveAim): sigma across the dive line = k x the
  // slant range at release (the pilot's sighting and release error, ~35 m at the game's release height), along the
  // ground track / sin(dive angle) (a shallower dive stretches it along the track), x (1 + flakK x the AA dps of the
  // target's side's ships within flakR, capped at flakMax): a dense AA screen spoils the aim (its main effect in 1942);
  // + ev[type] x the target's way on (u, her evasion under the bomb: Midway's carriers dodged most, a destroyer more).
  // near: a bomb that bursts in the water within near.r of a hull (close aboard) hurts her: near.k x the bomb's damage
  // (falling off to the edge: splinters, sprung plates, the mining effect: combat_weapons.js updateBomb).
  // dmg: a 1,000 lb bomb (the SBD's); a plane's bomb x its bombK (PLANE_NATION / land_air.js level: the Val's 250 kg SAP
  // 0.75, a 500 lb GP 0.5 = any plane without one); raw hits to sink (x HP_SCALE) with a 1,000 lb bomb: CV ~5 (fires, the
  // deck load and the deck out on top), BB ~14, CA ~6, DD ~1.6. landDmg: any bomb on a land target (the island base,
  // land sites: their balance was set for the old 180 a bomb).
  WW.BOMB = { dmg: 380, bombK: 0.5, landDmg: 180, vs: { battleship: 0.45, cruiser: 0.6 }, aim: { k: 0.25, flakK: 0.035, flakR: 60, flakMax: 2, ev: { carrier: 0.5, battleship: 0.5, cruiser: 2, destroyer: 7, pt: 4 } },
    near: { r: 2.5, k: 0.14 } };   // k: x the bomb (0.25 at the old 180; at 380 a near miss stays shock and leaks)
  WW.DEPTH_CHARGE = { dmg: 120, radius: 6 };
  // range sets the fuel budget (aircraft.js: fuel = range / speed * 6 s of transit + attack): enough to cross the map and loiter.
  // Speeds follow docs/PLANE_REVIEW.md §3.3: planes fly on a clock ~1.15x the ship clock (real speed / carrier speed x 5.6
  // u/s x 1.15). speed: the plane's working speed (a fighter's combat speed, a bomber's cruise); cruise: a fighter's
  // patrol / formation speed. Turn rates keep the real turn radius in hull lengths (fighters 0.7-1.2 L).
  WW.PLANE_TYPES = { fighter: { hp: 20, speed: 40, cruise: 31, range: 1000 }, dive: { hp: 28, speed: 28, range: 1000 },
                     torpedo: { hp: 30, speed: 25, range: 1000 } };
  // Altitude: a separate, non-linear compression (§3.3): y = 0.4 * h_real[m]^0.59 game units (at a 26 u carrier).
  // 15 m -> 2, 600 m -> 18, 1,500 m -> 30, 3,000 m -> 46, 4,500 m -> 58, 6,000 m -> 69, 7,500 m -> 79.
  WW.altOf = h => 0.4 * Math.pow(Math.max(0, h), 0.59);
  // Flight model for air combat: turn (rad/s), climb (units/s), dive (top speed in a dive). Added to each type,
  // so WW.PLANE_TYPES[kind] keeps working; WW.PLANE_NATION overrides per nation (Zero: nimble, fragile, light guns; Corsair: tough, dives, six .50s); gun = damage per hitting round.
  // alt: transit altitude in a strike (VT ~1,500-2,000 m, VB 3,000-4,500 m, escorts above); dive bombers: push (push-over
  // altitude), ang (dive angle, rad), brake (dive speed held by the dive brakes); torpedo bombers: runK (run speed x cruise).
  const PLANE_FLIGHT = { fighter: { turn: 1.7, climb: 7, dive: 52, alt: 68 }, dive: { turn: 1.1, climb: 5, dive: 44, alt: 54, push: 60, ang: 1.2, brake: 22 },
                         torpedo: { turn: 1.0, climb: 4.5, dive: 38, alt: 32, runK: 0.78 } };
  for (const k in PLANE_FLIGHT) for (const f in PLANE_FLIGHT[k]) if (WW.PLANE_TYPES[k][f] === undefined) WW.PLANE_TYPES[k][f] = PLANE_FLIGHT[k][f];
  // SBD-3 Dauntless: 70 deg from ~4,500 m (58-70 u), split flaps hold ~240 kt; D3A1 Val: 55-60 deg from ~3,000-3,500 m (45-55 u).
  // TBD-1 Devastator slow (110 kt cruise), B5N2 Kate faster; A6M2 faster and nimbler than the F4F-4 Wildcat.
  WW.PLANE_NATION = {
    IJN: { fighter: { hp: 11, speed: 42, cruise: 33, turn: 2.05, climb: 8.5, dive: 47, gun: 0.8, style: 'turn' },
           dive: { hp: 26, speed: 30, alt: 50, push: 52, ang: 1.0, brake: 23, bombK: 0.75 }, torpedo: { hp: 27, speed: 27, alt: 36, runK: 0.9 } },
    USN: { fighter: { hp: 28, speed: 39, cruise: 30, turn: 1.55, climb: 6, dive: 57, gun: 1.15, style: 'slash' },
           dive: { hp: 30, speed: 27, alt: 56, push: 66, ang: 1.2, brake: 23, bombK: 1 }, torpedo: { hp: 33, speed: 23, alt: 30, runK: 0.75 } }
  };
  const _ptCache = {};
  WW.planeType = function (kind, nation) { // merged per-nation stats (cached; falls back to WW.PLANE_TYPES[kind])
    const key = kind + '|' + nation;
    return _ptCache[key] || (_ptCache[key] = Object.assign({}, WW.PLANE_TYPES[kind], (WW.PLANE_NATION[nation] || {})[kind]));
  };

  WW.world = { ships: [], planes: [] };
  // Soft pastel palette helper: a colour moved ~20% toward its own grey.
  WW.pastel = function (hex, k) {
    const c = new THREE.Color(hex), l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    return c.lerp(new THREE.Color(l, l, l), k === undefined ? 0.2 : k);
  };
})(window.WW);
