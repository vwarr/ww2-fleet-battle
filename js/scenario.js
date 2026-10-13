// scenario.js - WW.scenarios, WW.scn(): the battle type (Pacific fleet battle | Normandy beach assault). Loads right
// after core.js. Sim code, no visuals, no WW.rand.
// A scenario is a table of optional hooks; a module that has a Pacific default reads the hook and falls back to it:
//   sides        the side keys, in the order every per-side loop runs (rand-draw order: the first side first)
//   enemy        side -> the other side (WW.enemyOf)
//   side[n]      start zone and home edge per side: cx, cz (centre), x0, x1 (zone x span), heading (spawn), home
//                (unit vector to the side's home edge: escapes, the edge it runs for), edge (the map coordinate of it)
//   composition  () -> [{ type, nation, x, z, cls? }]: the fleets (main.js randomComposition otherwise)
//   terrain      { heightRaw(x, z, kit) }: the map (terrain.js; P2)
//   updateGame   (dt, game) -> true when it handled the step (main.js: the Pacific ending rules otherwise)
//   timeout      ROUND_TIMEOUT override (sim s)
//   escapes      false: no ship leaves over its home edge (endgame.js)
//   base         island base owner ('none': no base and no WW.rand roll for it, island_base.js)
//   daylight     the round's clock override (daylight.js; P9)
// The current id: ?scn=normandy, else 'pacific'; WW.setScenario(id) switches (the setup screen's toggle, ui.js).
// Pacific must stay bit-identical: its tables are the literals the modules used before.
// Side keys: USN is the Allied side in Normandy too (RN and French hulls carry ship.flag 'RN' / 'FNFL', which only
// palette, ensign, crew, class picking and doctrine shading read: WW.FLAGS, core.js); GER is the German side.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const PI = Math.PI;
  WW.scenarios = {
    pacific: {
      id: 'pacific', name: 'Pacific', sides: ['USN', 'IJN'], enemy: { USN: 'IJN', IJN: 'USN' },
      side: {
        USN: { x0: 15, x1: 115, cx: 65, cz: H / 2, heading: 0, home: { x: -1, z: 0 }, edge: 0 },
        IJN: { x0: W - 115, x1: W - 15, cx: W - 65, cz: H / 2, heading: PI, home: { x: 1, z: 0 }, edge: W }
      }
    },
    // Omaha Beach + Pointe du Hoc, D-Day dawn (docs/NORMANDY_PLAN.md). The south edge is the French coast (north is
    // -z, so the beach faces north as it does); the Allies come in from the north edge, the Germans hold the coast.
    // Phase hooks (terrain, composition, updateGame, ...) are filled in by the normandy_*.js files.
    normandy: {
      id: 'normandy', name: 'Normandy', sides: ['USN', 'GER'], enemy: { USN: 'GER', GER: 'USN' },
      side: {
        USN: { x0: W * 0.35, x1: W * 0.95, cx: W * 0.65, cz: 60, heading: PI / 2, home: { x: 0, z: -1 }, edge: 0 },
        GER: { x0: W * 0.3, x1: W * 0.95, cx: W * 0.6, cz: H - 60, heading: -PI / 2, home: { x: 0, z: 1 }, edge: H }
      },
      escapes: false, base: 'none', timeout: 1000, daylight: 'dawn', weather: 'clear'
    }
  };
  let cur = WW.scenarios.pacific;
  const TIMEOUT0 = WW.cfg.ROUND_TIMEOUT;
  WW.ENEMY = cur.enemy;
  WW.scn = () => cur;
  WW.sides = () => cur.sides;
  WW.isScn = id => cur.id === id;
  // a fresh { side: v } table over this scenario's sides (v: a value, or a function of the side key)
  WW.perSide = v => { const o = {}; for (const n of cur.sides) o[n] = typeof v === 'function' ? v(n) : v; return o; };
  WW.sideSpec = n => cur.side[n] || WW.scenarios.pacific.side[n] || cur.side[cur.sides[0]];
  WW.setScenario = function (id) {
    const s = WW.scenarios[id] || WW.scenarios.pacific;
    if (s === cur) return cur;
    cur = s; WW.ENEMY = s.enemy; WW.cfg.ROUND_TIMEOUT = s.timeout || TIMEOUT0;
    WW.emit('scenario', { id: s.id });
    return cur;
  };
  const m = /[?&]scn=(\w+)/.exec(typeof location !== 'undefined' ? location.search : '');
  if (m && WW.scenarios[m[1]]) WW.setScenario(m[1]);
})(window.WW);
