// core.js (owner A): config, helpers, event bus, data tables. Matches CONTRACT.md.
window.WW = window.WW || {};
(function (WW) {
  WW.cfg = { MAP_W: 480, MAP_H: 300, CELL: 2, ROUND_TIMEOUT: 330 /* sim seconds */ };

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
    carrier:    { name: 'Carrier',    hp: 900, speed: 5.0, turn: 0.25, length: 26, minDepth: 6, tons: 30000,
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
  const HP_SCALE = 1.6;
  for (const k in WW.SHIP_TYPES) WW.SHIP_TYPES[k].hp = Math.round(WW.SHIP_TYPES[k].hp * HP_SCALE);

  WW.SHELL = { mg: { dmg: 2, speed: 120, splash: 0.6 }, small: { dmg: 12, speed: 90, splash: 1.2 },
               med: { dmg: 35, speed: 80, splash: 2 }, big: { dmg: 110, speed: 70, splash: 3.5 } };
  WW.TORPEDO = { dmg: 220, speed: 14 };
  WW.BOMB = { dmg: 180 };
  WW.DEPTH_CHARGE = { dmg: 120, radius: 6 };
  WW.PLANE_TYPES = { fighter: { hp: 20, speed: 38, range: 500 }, dive: { hp: 28, speed: 30, range: 500 },
                     torpedo: { hp: 30, speed: 26, range: 500 } };

  WW.world = { ships: [], planes: [] };
})(window.WW);
