// normandy_game.js - WW.normandyGame: how a Normandy round ends (P9 of docs/NORMANDY_PLAN.md). Sim code, no WW.rand;
// it is the Normandy scenario's updateGame (main.js calls it instead of the Pacific ending rules).
//  - a draw is open once every strongpoint that guards it is silenced (coast_defence_data.js draw); 'drawOpened'
//  - victory (the beachhead): at least DRAWS_WIN of the five draws open and at least TOP_WIN men alive on the bluff
//    tops (infantry.js onTop); reason 'beachhead'
//  - defeat: the clock runs out (ROUND_TIMEOUT, ~1000 s: the afternoon of D-Day), reason 'time'; or the waves are spent
//    (every craft of the schedule launched and none afloat) with fewer than HELD men alive ashore, reason 'repulsed'
//    (Bradley's thought of diverting the follow-up waves to Utah and Gold, at about 09:00)
// The result for the report card: WW.normandyGame.result() (men landed and lost, craft lost, strongpoints silenced, draws
// opened and when, the time the beachhead was won).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const DRAWS_WIN = 3, TOP_WIN = 500, HELD = 150;
  const N = WW.scenarios.normandy;
  let open = {}, beachheadT = null, stats = null;
  const draws = () => WW.normandyData.DRAWS;

  function reset() { open = {}; beachheadT = null; stats = { drawsOpen: 0 }; }
  function drawCheck(game) {
    const C = WW.coastDefence; if (!C) return 0;
    let n = 0;
    for (const d of draws()) {
      if (open[d.id] !== undefined) { n++; continue; }
      const w = C.wns.filter(x => x.draw === d.id);
      if (w.length && w.every(x => x.silenced)) { open[d.id] = game.roundTime; n++; WW.emit('drawOpened', { draw: d, t: game.roundTime }); }
    }
    return (stats.drawsOpen = n);
  }
  const menAshore = () => (WW.infantry ? WW.infantry.squads.reduce((k, q) => k + (q.alive && q.kind !== 'tank' ? q.men : 0), 0) : 0);
  function updateGame(dt, game) {
    if (game.state !== 'battle') return false;   // the victory banner and the next round: main.js
    game.roundTime += dt;
    const nd = drawCheck(game), top = WW.infantry ? WW.infantry.stats.onTop : 0;
    if (nd >= DRAWS_WIN && top >= TOP_WIN) { beachheadT = game.roundTime; game.endRound('USN', 'beachhead', 'GER'); return true; }
    const L = WW.landingCraft;
    const spent = L && L.planAll.length && L.craft.length >= L.planAll.length && !L.live.length;
    if (spent && menAshore() < HELD) { game.endRound('GER', 'repulsed', 'USN'); return true; }
    if (game.roundTime >= WW.cfg.ROUND_TIMEOUT) game.endRound('GER', 'time', 'USN');
    return true;
  }
  function result() {
    const I = WW.infantry ? WW.infantry.stats : {}, L = WW.landingCraft ? WW.landingCraft.stats : {}, C = WW.coastDefence ? WW.coastDefence.stats : {};
    return { landed: I.landed || 0, lost: (I.lost || 0) + (L.menLost || 0), onTop: I.onTop || 0, tanksLanded: L.tanksLanded || 0, tanksLost: (L.tanksLost || 0) + (I.tanksLost || 0),
      craft: L.launched || 0, craftLost: L.wrecked || 0, mined: L.mined || 0, foundered: L.foundered || 0, silenced: C.silenced || 0, wns: WW.coastDefence ? WW.coastDefence.wns.length : 0,
      out: C.out || 0, draws: Object.assign({}, open), hocGuns: !!I.hocGuns, beachheadT, bySector: I.bySector || {},
      // the realism pass: the gap lanes, the exits (open for vehicles), the vehicles, the prisoners
      lanes: WW.beachEng ? Object.assign({}, WW.beachEng.stats) : null, exits: WW.beachEng ? WW.beachEng.blocks.filter(b => b.state === 'open').map(b => ({ id: b.id, t: b.openT })) : [],
      vehicles: WW.vehicles ? Object.assign({}, WW.vehicles.stats) : null, prisoners: WW.prisoners ? WW.prisoners.stats.men : 0 };
  }
  N.updateGame = updateGame;
  WW.on('roundStart', reset);
  WW.normandyGame = { result, drawsOpen: () => Object.assign({}, open), DRAWS_WIN, TOP_WIN, HELD };
  reset();
})(window.WW);
