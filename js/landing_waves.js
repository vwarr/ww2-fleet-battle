// landing_waves.js - WW.landingWaves: the Omaha and Pointe du Hoc landing schedule (P6 of docs/NORMANDY_PLAN.md).
// Data, plus the expansion into one record per craft (no WW.rand: the lane jitter is a fixed pattern). Times are clock
// times (normandy.js clock); sectors are terrain_normandy_data.js SECTORS ids, or 'hoc' (the foot of the Pointe du Hoc
// cliffs, east side, where the Rangers' LCAs grounded).
// Scale: about half the craft of the day (the first waves are close to whole: two to four boats a company's sector),
// so the beach fills as it did without more units than the step budget allows (P7: <= 200 squads).
// Craft (landing_craft.js CRAFT): lcvp (Higgins boat, 30 men), lca (British, the Rangers' boats, 30 men), lct (tanks:
// 3 Shermans of the 743rd landed straight onto the beach), lci (LCI(L), 90 men down two bow ramps), dd (a swimming
// Sherman of the 741st, launched from its LCT ~5 km out: 27 of 32 foundered in the chop), lcm (engineers' gap teams),
// dukw (the 2.5-ton amphibious truck, swimming in from the LSTs like the DDs).
// Options on a wave:
//   gap      the Special Engineer Task Force's gap assault teams (one LCM each; beach_engineers.js lanes): 16 teams on
//            the day, here 8, one lane each
//   load     a vehicle LCT's or DUKW's cargo (vehicles.js KIND), unloaded one by one down the ramp:
//            [kind, n] pairs; an LCT carries no Shermans then
//   veh      a vehicle wave: from 08:30 the beachmaster (Navy) stopped the vehicle landings on most of the beach (the
//            vehicles already ashore were jammed at the shingle, burning, and no draw was open): a vehicle wave due
//            after HALT holds off the line of departure until a draw is open for vehicles (landing_craft.js 'hold')
//   named    a craft with its own story (landing_craft.js NAMED): LCI(L)-91 and LCI(L)-85
//   ladder   the four DUKWs with the London Fire Brigade's 100-ft extension ladders (Pointe du Hoc)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const w = (time, sector, craft, n, unit, o) => Object.assign({ time, sector, craft, n, unit }, o || {});
  // [h, m] clock times
  const WAVES = [
    // H-5: the tanks first
    w([6, 25], 'easyRed', 'dd', 4, '741st Tank Bn (B Co)', { launch: 'far' }),
    w([6, 25], 'foxGreen', 'dd', 4, '741st Tank Bn (C Co)', { launch: 'far' }),
    w([6, 27], 'dogGreen', 'lct', 2, '743rd Tank Bn (B Co)'),
    w([6, 27], 'dogWhite', 'lct', 1, '743rd Tank Bn (C Co)'),
    w([6, 28], 'dogRed', 'lct', 1, '743rd Tank Bn (C Co)'),
    // H-hour: the assault companies
    w([6, 30], 'dogGreen', 'lcvp', 4, '116th RCT, A Co'),
    w([6, 30], 'dogWhite', 'lcvp', 2, '116th RCT, G Co'),
    w([6, 30], 'dogRed', 'lcvp', 2, '116th RCT, F Co'),
    w([6, 30], 'easyGreen', 'lcvp', 2, '116th RCT, E Co'),
    w([6, 31], 'easyRed', 'lcvp', 4, '16th RCT, E and F Co'),
    w([6, 31], 'foxGreen', 'lcvp', 4, '16th RCT, I and L Co'),
    // H+3: the gap teams of the Special Engineer Task Force (one LCM each, a lane each: 8 here of the day's 16, with Dog
    // Red's below; they cleared 6 gaps, and could mark 2)
    w([6, 33], 'dogGreen', 'lcm', 1, '146th Engineer Combat Bn (gap team)', { gap: true }), w([6, 33], 'dogWhite', 'lcm', 1, '146th Engineer Combat Bn (gap team)', { gap: true }),
    w([6, 33], 'easyGreen', 'lcm', 1, '299th Engineer Combat Bn (gap team)', { gap: true }), w([6, 33], 'easyRed', 'lcm', 2, '299th Engineer Combat Bn (gap team)', { gap: true }),
    w([6, 33], 'foxGreen', 'lcm', 2, '299th Engineer Combat Bn (gap team)', { gap: true }),
    // H+15: the Rangers' C Company under the cliffs at Charlie
    w([6, 45], 'charlie', 'lca', 2, '2nd Ranger Bn, C Co'),
    // H+30: the second wave
    w([7, 0], 'dogGreen', 'lcvp', 2, '116th RCT, B Co'), w([7, 0], 'dogWhite', 'lcvp', 2, '116th RCT, H Co'),
    w([7, 0], 'dogRed', 'lcvp', 2, '116th RCT, 2nd Bn HQ'), w([7, 0], 'easyRed', 'lcvp', 3, '16th RCT, G Co'),
    w([7, 0], 'foxGreen', 'lcvp', 3, '16th RCT, K Co'), w([7, 2], 'easyRed', 'lct', 2, '741st Tank Bn (A Co)'),
    // H+40: the Rangers at Pointe du Hoc (Rudder's D, E and F companies, 40 minutes late after the run to the Percée)
    w([7, 10], 'hoc', 'lca', 8, '2nd Ranger Bn, D E F Co'),
    // H+50 to H+60: the reserve battalions and the LCIs (LCI(L)-85 among them: holed by shellfire off Easy Red, she got
    // off burning and sank offshore later)
    w([7, 20], 'dogWhite', 'lcvp', 3, '116th RCT, C Co'), w([7, 25], 'easyRed', 'lcvp', 3, '16th RCT, 1st Bn'),
    w([7, 30], 'dogRed', 'lci', 1, '116th RCT, 3rd Bn'), w([7, 30], 'easyRed', 'lci', 1, '16th RCT, 2nd Bn', { named: 'LCI(L)-85' }),
    w([7, 35], 'foxGreen', 'lcvp', 3, '16th RCT, 3rd Bn'),
    // H+80: the 5th Rangers and the 2nd Rangers' A and B companies (Dog White: "Rangers, lead the way!")
    w([7, 50], 'dogWhite', 'lca', 4, '5th Ranger Bn'), w([7, 50], 'dogGreen', 'lca', 2, '2nd Ranger Bn, A and B Co'),
    // the follow-up: the 18th RCT on Easy Red, the 115th on Dog, the beach battalions (the 745th's tanks landed in the
    // afternoon, through E-1: a vehicle wave after the halt)
    w([8, 30], 'easyRed', 'lci', 2, '18th RCT'), w([8, 45], 'easyRed', 'lcvp', 4, '18th RCT'),
    w([9, 15], 'dogRed', 'lcvp', 3, '115th RCT'), w([9, 30], 'easyGreen', 'lcvp', 3, '115th RCT'),
    w([10, 0], 'easyRed', 'lct', 3, '745th Tank Bn', { veh: true }), w([10, 30], 'dogWhite', 'lci', 2, '115th RCT'),
    w([11, 0], 'foxGreen', 'lcvp', 4, '18th RCT'), w([11, 30], 'easyRed', 'lci', 2, '26th RCT'),
    // ---- the realism pass (appended: the waves above keep their indices, which other modules and shots refer to) ----
    // H+3: the last gap team, and the armoured bulldozers that were to work the lanes with the teams (16 on the day:
    // tank dozers of the tank battalions and armoured D-7s, two to an LCT here; only 6 got ashore and working, and 3 of
    // those were soon knocked out)
    w([6, 33], 'dogRed', 'lcm', 1, '146th Engineer Combat Bn (gap team)', { gap: true }),
    w([6, 34], 'dogGreen', 'lct', 1, '743rd Tank Bn (dozers)', { load: [['tankdozer', 1], ['d7', 1]] }),
    w([6, 34], 'dogWhite', 'lct', 1, '743rd Tank Bn (dozers)', { load: [['tankdozer', 1], ['d7', 1]] }),
    w([6, 34], 'easyRed', 'lct', 1, '741st Tank Bn (dozers)', { load: [['tankdozer', 1], ['d7', 1]] }),
    w([6, 34], 'foxGreen', 'lct', 1, '741st Tank Bn (dozers)', { load: [['tankdozer', 1], ['d7', 1]] }),
    // H+30: the engineers who were to open the exits (the 121st on Dog for D-1 and D-3)
    w([7, 0], 'dogWhite', 'lcvp', 1, '121st Engineer Combat Bn'),
    // H+42: the four DUKWs with the London Fire Brigade's extension ladders at Pointe du Hoc (the cratered shingle kept
    // them off the cliff)
    w([7, 12], 'hoc', 'dukw', 4, '2nd Ranger Bn (fire-brigade ladders)', { ladder: true }),
    // LCI(L)-91 (Coast Guard Flotilla 10): struck a mined stake off Dog White, hit again as her men went down the ramps,
    // and burned on the beach
    w([7, 40], 'dogWhite', 'lci', 1, '116th RCT', { named: 'LCI(L)-91' }),
    // H+60: the first vehicles: the AA half-tracks (197th and 467th AAA), jeeps and trucks; the 37th Engineers
    w([7, 30], 'easyRed', 'lct', 2, 'vehicles: 467th AAA Bn, 16th RCT', { veh: true, load: [['halftrack', 2], ['jeep', 1], ['truck', 1]] }),
    w([7, 32], 'dogWhite', 'lct', 1, 'vehicles: 197th AAA Bn, 116th RCT', { veh: true, load: [['halftrack', 2], ['jeep', 2]] }),
    w([7, 40], 'easyRed', 'lcvp', 2, '37th Engineer Combat Bn'),
    // H+90: the 111th Field Artillery's 105 mm howitzers in DUKWs (overloaded with the gun and sandbags, launched far out
    // in the chop: all but one swamped and sank; the 7th FA's fared little better); more vehicles; the 149th Engineers
    w([8, 0], 'dogWhite', 'dukw', 3, '111th FA Bn (105 mm)', { load: [['dukw105', 1]] }),
    w([8, 0], 'easyGreen', 'dukw', 3, '111th FA Bn (105 mm)', { load: [['dukw105', 1]] }),
    w([8, 10], 'easyGreen', 'lcvp', 1, '149th Engineer Combat Bn'),
    w([8, 15], 'easyRed', 'lct', 2, 'vehicles: 1st Div, 7th FA Bn', { veh: true, load: [['halftrack', 1], ['truck', 2], ['jeep', 1]] }),
    w([8, 18], 'dogRed', 'lct', 1, 'vehicles: 29th Div', { veh: true, load: [['jeep', 2], ['truck', 2]] }),
    // after the beachmaster's halt (08:30): the vehicle waves hold offshore until a draw is open
    w([9, 0], 'easyRed', 'lct', 2, 'vehicles: 1st Div', { veh: true, load: [['truck', 2], ['jeep', 1], ['halftrack', 1]] }),
    w([9, 40], 'dogWhite', 'lct', 2, 'vehicles: 29th Div', { veh: true, load: [['truck', 2], ['jeep', 2]] }),
    w([10, 40], 'easyRed', 'lct', 2, 'vehicles: 5th Engineer Special Brigade', { veh: true, load: [['d7', 1], ['truck', 2], ['jeep', 1]] }),
    w([11, 40], 'easyRed', 'lct', 2, 'vehicles: 1st Div', { veh: true, load: [['truck', 3], ['jeep', 1]] })
  ];
  const HALT = [8, 30];   // the beachmaster's halt on vehicle landings (landing_craft.js holds a veh wave due after it)
  // one record per craft: spawn time (sim s), lane x, sector, type, unit; lanes spread over the sector (fixed pattern)
  function expand() {
    const C = WW.scenarios.normandy.clock, D = WW.normandyData, out = [];
    WAVES.forEach((wv, wi) => {
      const sec = wv.sector === 'hoc' ? { id: 'hoc', name: 'Pointe du Hoc', x0: 726, x1: 752 } : D.SECTORS.find(s => s.id === wv.sector);
      const t = C.at(wv.time[0] * 60 + wv.time[1]);
      for (let i = 0; i < wv.n; i++) {
        const f = (i + 0.5) / wv.n, jit = ((wi * 7 + i * 13) % 10) / 10 - 0.45;   // a fixed spread, not a draw
        out.push({ t: t + i * 1.5, sector: sec.id, sectorName: sec.name, x: sec.x0 + (sec.x1 - sec.x0) * WW.clamp(f + jit * 0.15, 0.05, 0.95), craft: wv.craft, unit: wv.unit, wave: wi, launch: wv.launch || null,
          gap: !!wv.gap, load: wv.load || null, named: wv.named || null, ladder: !!wv.ladder,
          hold: !!wv.veh && wv.time[0] * 60 + wv.time[1] > HALT[0] * 60 + HALT[1] });
      }
    });
    out.sort((a, b) => a.t - b.t || a.x - b.x);
    return out;
  }
  WW.landingWaves = { WAVES, expand, HALT };
})(window.WW);
