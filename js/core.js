// core.js (owner A): config, helpers, event bus, data tables. Matches CONTRACT.md.
window.WW = window.WW || {};
(function (WW) {
  // 960 x 600: room for an approach phase between fleets (ships keep their size; the sea between them grows).
  // ROUND_TIMEOUT 420 sim s = 14 min real at 1x (BASE_SPEED 0.5): it only caps stalemates.
  WW.cfg = { MAP_W: 960, MAP_H: 600, CELL: 2, ROUND_TIMEOUT: 420 /* sim seconds */ };
  // Sim-only mode (index.html?sim, headless tests): the full simulation with no rendering, no visuals and no
  // render loop (main.js boot). Results are bit-identical to normal mode (tests/determinism.js --cross).
  WW.simOnly = WW.cfg.SIM_ONLY = /[?&]sim(&|=|$)/.test(location.search);

  // Seedable RNG (mulberry32). WW.seedRandom(n) resets it; default seeded from Math.random.
  let _s = (Math.random() * 4294967296) >>> 0;
  WW.seedRandom = function (seed) { _s = (seed >>> 0) || 1; };
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
    IJN: { id: 'IJN', name: 'IJN', hull: 0x6b7366, deck: 0x8c7a5a, super: 0x5d6658, accent: 0xb02a2a, mark: 'disc', ui: '#ff7a6b' }
  };
  WW.enemyOf = n => (n === 'USN' ? 'IJN' : 'USN');

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
    destroyer:  { name: 'Destroyer',  hp: 300, speed: 7.5, turn: 0.6, length: 12, minDepth: 3, tons: 2000,
                  guns: [{ cal: 'small', count: 2, range: 70, reload: 2.5 }], aa: { range: 30, dps: 3 },
                  planes: null, torpedoes: { count: 4, range: 100, reload: 30 }, depthCharges: true },
    submarine:  { name: 'Submarine',  hp: 200, speed: 3.5, turn: 0.4, length: 10, minDepth: 9, tons: 1500,
                  guns: [], aa: null, planes: null, torpedoes: { count: 2, range: 120, reload: 25 }, depthCharges: false },
    pt:         { name: 'PT Boat',    hp: 80,  speed: 11,  turn: 1.2, length: 5,  minDepth: 1.5, tons: 50,
                  guns: [{ cal: 'mg', count: 1, range: 35, reload: 0.4 }], aa: { range: 20, dps: 1 },
                  planes: null, torpedoes: { count: 2, range: 70, reload: 35 }, depthCharges: false }
  };

  // Ship HP scale: tuned so a round at 1x lasts about 3-4 minutes.
  const HP_SCALE = 2.0;
  for (const k in WW.SHIP_TYPES) WW.SHIP_TYPES[k].hp = Math.round(WW.SHIP_TYPES[k].hp * HP_SCALE);

  WW.SHELL = { mg: { dmg: 2, speed: 120, splash: 0.6 }, small: { dmg: 12, speed: 90, splash: 1.2 },
               med: { dmg: 35, speed: 80, splash: 2 }, big: { dmg: 110, speed: 70, splash: 3.5 } };
  WW.TORPEDO = { dmg: 220, speed: 14 };
  // Torpedoes per nation and launcher (ship = destroyer / cruiser tubes): rangeK x the type's torpedo range, speed,
  // dud (share of hits that do not go off, rolled with WW.rand at launch), sight (x intel R.TORP: how close a ship
  // must be to see the track; the wake). IJN Type 93 "Long Lance": oxygen-driven, long, fast and nearly wakeless;
  // Type 95 (sub) likewise; Type 91 (aerial) an ordinary air-driven wake. USN 1942 Mk 15 / Mk 14 / Mk 13: slower,
  // shorter, steam wakes easy to see, and the notorious exploder duds, worst in the Mk 14 (subs, 20%); the aerial
  // Mk 13's troubles were its slow, fragile run, not its exploder (no duds). Balance levers (AI_DESIGN §4, §8): on
  // the 200-round gate (Oct 2026) the USN entries were worth ~10 points together at 18-28% duds (duds ~6, the wake
  // ~4), so they sit lower; the Long Lance entries move it ~0-2.
  WW.TORPEDO_NATION = {
    IJN: { ship: { rangeK: 1.4, speed: 16, dud: 0, sight: 0.7 }, submarine: { rangeK: 1.2, speed: 15, dud: 0, sight: 0.7 },
           pt: { rangeK: 1, speed: 14, dud: 0, sight: 1 }, air: { rangeK: 1, speed: 14, dud: 0, sight: 1 } },
    USN: { ship: { rangeK: 0.95, speed: 13.5, dud: 0.1, sight: 1.1 }, submarine: { rangeK: 1, speed: 13.5, dud: 0.2, sight: 1.1 },
           pt: { rangeK: 1, speed: 13.5, dud: 0.1, sight: 1.1 }, air: { rangeK: 1, speed: 14, dud: 0, sight: 1.1 } }
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
      st.torpedoes = Object.assign({}, b.torpedoes, { range: Math.round(b.torpedoes.range * q.rangeK), speed: q.speed, dud: q.dud, sight: q.sight });
    }
    return (_stCache[key] = st);
  };
  WW.BOMB = { dmg: 180 };
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
           dive: { hp: 26, speed: 30, alt: 50, push: 52, ang: 1.0, brake: 23 }, torpedo: { hp: 27, speed: 27, alt: 36, runK: 0.8 } },
    USN: { fighter: { hp: 28, speed: 39, cruise: 30, turn: 1.55, climb: 6, dive: 57, gun: 1.15, style: 'slash' },
           dive: { hp: 30, speed: 27, alt: 56, push: 66, ang: 1.2, brake: 23 }, torpedo: { hp: 33, speed: 23, alt: 30, runK: 0.75 } }
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
