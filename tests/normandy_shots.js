// Normandy screenshots (render mode, software GL) -> tests/shots/normandy/*.png (docs/NORMANDY_PLAN.md: the look)
//   overview   the whole coast from high over the Channel: Pointe du Hoc, the cliffs, Omaha's bay
//   fleet      the coast seen from the bombardment line, ~450 u out
//   beach      Dog Green at low water: the obstacle belts, the shingle, the sea wall, the bluffs behind
//   draw       the E-1 draw (St-Laurent) from just off the beach: the notch in the bluffs
//   hoc        Pointe du Hoc from the north-east: the sheer headland, the cratered top
//   plateau    the bluff top and the bocage behind Vierville: fields, hedgerows, the church
//   wn72       WN 72 at Vierville: the 88 casemate in the sea wall, enfilading Dog Green, the 50 mm beside it
//   wn62       WN 62 above Easy Red / Fox Green: the two 75 mm casemates on the slope, MG nests, mortar pits
//   texas      USS Texas on her bombardment line, Pointe du Hoc beyond (sim 30 s: the pre-planned fire)
//   transports the Transport Area (sim 80 s): Dorothea L. Dix lowering the 11:00 wave's LCVPs, men on the cargo nets,
//              empty boats in the other davits (normandy_fleet.js boats(), drawn by models_landing.js)
//   lod        a wave reaching the line of departure past its control vessel (the hand-over to the sim's craft)
//   rendezvous the last LCVP wave circling off the transports as its boats peel off for the run in, the transports beyond
//   anchorage  the transport area down the line from Ancon: the transports, the barrage balloons, the holding circles
//   ddrun      a destroyer closed on the beach firing along it (sim 300 s, after the H+60 close)
//   run_in     the first wave running in to Dog Green (sim 50 s): LCVPs in line abreast, the DD tanks swimming
//   lcvp_close / dd_close / lct_close / lci_close / lci_ramps: the craft up close (men aboard, riding the sea)
//   ramps      Easy Red at H+40 (sim 160 s): craft beached with their ramps down, a wreck burning
//   shingle    Easy Red at H+35 (sim 150 s): men at the shingle, the wounded and the dead on the sand, craft behind
//   bluff      the men climbing the bluff between the draws (sim 300 s)
//   soldiers   close up on a squad ashore (the figures: run / crouch / prone poses, the fallen)
//   pinned     close up on men pinned down (prone: the test forces their suppression for the still)
//   wn_close   an MG 42 nest firing (sim ~110 s): the crew in Feldgrau, the gun on the parapet, tracers down the beach
//   mg_fire    the beach under MG fire (sim ~130 s): tracer streams from the bluffs onto the men, sand kicked up
//   wn_out     a knocked-out strongpoint position: burnt, scorched, rubble, bodies, smoke (sim ~200 s)
//   b24        a B-24 box crossing the coast at ~6,000 m (sim 40 s)
//   p47        a P-47 flight diving on a strongpoint (sim 240 s)
//   inland     the plateau running on past the map's south edge (the terrain skirts)
//   plot       the plot table (map view): the coastline chart from the depth grid
//   dozer / hoc_grapnels / hoc_ropes / hoc_ladder / leader / lci91 / lci85 / dukw_swim / vehicles_jam / lane_marked /
//   ditch / prisoners / exit_e1: the realism pass: a dozer at a gap lane, the Rangers' grapnels going up and the men on
//              the ropes, the fire-brigade ladder up, Cota on the shingle, the two burning LCIs, a 111th FA DUKW low in the
//              chop, the vehicle jam at the shingle, a marked lane's buoys and flags, E-3's ditch, prisoners marched down
//              (forced: WN 65 taken), vehicles going up E-1 (forced: its block blown)
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<chrome> node tests/normandy_shots.js [seed=1] [shot,...]
const { chromium } = require('playwright');
const path = require('path'), OUT = path.join(__dirname, 'shots', 'normandy');
require('fs').mkdirSync(OUT, { recursive: true });
const SEED = +(process.argv[2] || 1), ONLY = process.argv[3] || null;
// [name, page-side function returning the camera [x, y, z, tx, ty, tz]]; T = WW.normandyTerrain
const SHOTS = [
  ['overview', () => [1350, 520, 300, 1350, 0, 1120]],
  ['fleet', () => { const z = T.shoreZ(1600); return [1450, 14, z - 430, 1640, 3, z - 20]; }],
  ['beach', () => { const z = T.shoreZ(1400); return [1385, 4, z - 45, 1410, 2, z + 30]; }],
  ['draw', () => { const z = T.shoreZ(1690); return [1690, 12, z - 70, 1690, 3, z + 50]; }],
  ['hoc', () => { const z = T.shoreZ(725); return [800, 20, z - 60, 725, 3, z + 15]; }],
  ['wn72', () => { const e = WW.coastDefence.wnOf('WN72').elements[0]; return [e.x + 22, e.y + 6, e.z - 16, e.x, e.y + 0.5, e.z]; }],
  ['wn62', () => { const e = WW.coastDefence.wnOf('WN62').elements[0]; return [e.x - 26, e.y + 9, e.z - 22, e.x + 4, e.y, e.z + 2]; }],
  ['texas', () => { const s = WW.world.ships.find(q => q.name === 'Texas'); return [s.x - 30, 9, s.z - 22, s.x + 10, 2, s.z + 40]; }],
  ['transports', () => { __sim.fastForward(Math.max(0, 80 - WW.game.roundTime)); WW.normandyFleet.update(0); const t = WW.game.roundTime, q = WW.normandyFleet.recs.find(r => r.kind === 'davit' && r.slot && r.tLower - 5 < t && t < r.tLeave) || WW.normandyFleet.recs.find(r => r.kind === 'reserve'), s = q.ship, c = Math.cos(s.heading), n = Math.sin(s.heading), k = q.slot.side; return [s.x - n * 12 * k + c * 6, 4.5, s.z + c * 12 * k + n * 6, s.x - c * 1.5, 1.0, s.z - n * 1.5]; }],
  ['lod', () => { __sim.fastForward(Math.max(0, Math.min(...WW.normandyFleet.recs.filter(r => r.kind === 'davit' && r.r.wave === 32).map(r => r.r.spawnT)) - 6 - WW.game.roundTime)); WW.normandyFleet.update(0); const o = WW.normandyFleet.recs.find(r => r.kind === 'davit' && r.r.wave === 32).o, c = WW.normandyFleet.ships().filter(s => s.cls === 'lcc' || s.cls === 'pc').sort((a, b) => Math.abs(a.x - o.x) - Math.abs(b.x - o.x))[0], mx = (o.x + c.x) / 2, mz = (o.z + c.z) / 2; return [mx - 2, 9, mz + 34, mx, 0.2, mz - 2]; }],
  ['rendezvous', () => { const R = WW.normandyFleet.recs, qs = R.filter(r => r.kind === 'davit' && r.r.wave === 37), tr = Math.min(...qs.map(q => q.tr)); __sim.fastForward(Math.max(0, tr + 3 - WW.game.roundTime)); WW.normandyFleet.update(0); const w = qs[0].w; return [w.cx + 3, 3.2, w.cz + w.R + 9, w.cx - 1, 0, w.cz - 6]; }],
  ['anchorage', () => { const s = WW.normandyFleet.ships().find(q => q.name === 'Ancon'); return [s.x - 25, 10, s.z - 28, s.x - 185, 5, s.z - 103]; }],
  ['ddrun', () => { __sim.fastForward(300); const s = WW.world.ships.filter(q => q.type === 'destroyer' && q.alive).sort((a, b) => b.z - a.z)[0]; return [s.x - 25, 7, s.z - 25, s.x + 10, 2, s.z + 50]; }],
  ['run_in', () => { __sim.fastForward(20); const u = WW.landingCraft.live.find(q => q.sector === 'dogGreen' && q.state === 'run') || WW.landingCraft.live[0]; return [u.x - 18, 5, u.z - 16, u.x + 6, 0.5, u.z + 30]; }],
  ['lcvp_close', () => { const u = WW.landingCraft.live.find(q => q.type === 'lcvp' && q.state === 'run'); const c = Math.cos(u.heading), s = Math.sin(u.heading); return [u.x - c * 3 + s * 2.2, 1.8, u.z - s * 3 - c * 2.2, u.x + c * 0.4, 0.2, u.z + s * 0.4]; }],
  ['dd_close', () => { const u = WW.landingCraft.live.find(q => q.type === 'dd' && q.state === 'run'); return [u.x - 2.2, 1.3, u.z - 2.4, u.x, 0.1, u.z]; }],
  ['dd_sink', () => { let w; for (let k = 0; k < 300 && !(w = WW.landingFx.wrecks.find(x => x.type === 'dd')); k++) __sim.fastForward(1); __sim.fastForward(3); return [w.x - 3.5, 1.8, w.z - 3.5, w.x, 0, w.z]; }],
  ['dd_ground', () => { for (const q of WW.landingCraft.live) if (q.type === 'dd') q.leak = 0; let u; for (let k = 0; k < 400 && !(u = WW.landingCraft.live.find(q => q.type === 'dd' && WW.terrain.depthAt(q.x, q.z) < 0.6)); k++) __sim.fastForward(1); return [u.x - 3.2, 1.4, u.z - 2.2, u.x, 0.1, u.z + 0.5]; }],
  ['dd_ashore', () => { let q; for (let k = 0; k < 90 && !(q = WW.infantry.squads.find(t => t.dd && t.alive)); k++) __sim.fastForward(1); __sim.fastForward(3); return [q.x - 3, 1.6, q.z - 2.5, q.x, 0.2, q.z]; }],
  ['lct_close', () => { __sim.fastForward(25); const u = WW.landingCraft.live.find(q => q.type === 'lct' && q.state === 'run' && q.tanks > 1) || WW.landingCraft.live.find(q => q.type === 'lct'); return [u.x - 5, 3.2, u.z - 4, u.x, 0.2, u.z + 0.5]; }],
  ['lci_close', () => { let u; for (let k = 0; k < 40 && !(u = WW.landingCraft.live.find(q => q.type === 'lci' && q.state !== 'off')); k++) __sim.fastForward(10); return [u.x - 7, 3.5, u.z - 5, u.x, 0.3, u.z + 1]; }],
  ['lci_ramps', () => { let u; for (let k = 0; k < 60 && !(u = WW.landingCraft.live.find(q => q.type === 'lci' && q.rampDown && q.men > 20)); k++) __sim.fastForward(3); return [u.x - 6, 3, u.z - 1, u.x + 0.5, 0.3, u.z + 2.5]; }],
  ['wading', () => { let q; for (let k = 0; k < 60 && !(q = WW.infantry.squads.find(s => s.alive && s.kind !== 'tank' && (s.state === 'wade' || s.state === 'swim') && WW.terrain.depthAt(s.x, s.z) > 0.2)); k++) __sim.fastForward(2); return [q.x - 4, 1.5, q.z - 4.5, q.x, 0, q.z + 1]; }],
  ['shingle_close', () => { let q; for (let k = 0; k < 120 && !(q = WW.infantry.squads.filter(s => s.alive && s.state === 'shingle').sort((a, b) => b.men - a.men)[0]); k++) __sim.fastForward(2); return [q.x - 3, 1.6, q.z - 4, q.x, 0.2, q.z + 0.5]; }],
  ['wounded', () => { let u; for (let k = 0; k < 200 && !(u = WW.infantryFx.wounded.find(w => w.medic && w.state !== 'crawl')); k++) __sim.fastForward(1); return [u.x - 2.5, 1.3, u.z - 2.5, u.x, 0.1, u.z]; }],
  ['climb_file', () => { let q; for (let k = 0; k < 80 && !(q = WW.infantry.squads.find(s => s.alive && s.state === 'climb' && s.men > 6)); k++) __sim.fastForward(3); return [q.x + 6, q.y + 3, q.z - 4, q.x, q.y, q.z + 1]; }],
  ['tide_0700', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(7 * 60)) __sim.fastForward(1); const z = T.shoreZ(1700); return [1665, 7, z - 26, 1700, 0, z + 6]; }],
  ['tide_0830', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(8 * 60 + 30)) __sim.fastForward(1); const z = T.shoreZ(1700); return [1665, 7, z - 26, 1700, 0, z + 6]; }],
  ['beachhead', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(8 * 60)) __sim.fastForward(1); const z = T.shingleZ(1650); return [1630, 6, z - 22, 1660, 1.5, z + 18]; }],
  ['bluff_view', () => { const z = T.bluffTopZ(1640); return [1610, 8, z + 6, 1650, 0, z - 30]; }],
  ['bluff_close', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(8 * 60 + 45)) __sim.fastForward(1); const x = 1690, z = T.shingleZ(x); return [x - 14, 5, z - 6, x + 2, 1.5, z + 14]; }],
  ['rockets', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(6 * 60 + 25) + 4) __sim.fastForward(0.5); const z = T.shoreZ(1720) - 290; return [1700, 7, z - 16, 1726, 9, z + 70]; }],
  ['swell_dd', () => { const s = WW.world.ships.find(q => q.name === 'Thompson') || WW.world.ships.find(q => q.type === 'destroyer'); return [s.x - 14, 2.2, s.z - 9, s.x, 1, s.z]; }],
  ['rockets_beach', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(6 * 60 + 25) + 5) __sim.fastForward(0.5); const z = T.shoreZ(1740); return [1740, 2.5, z + 4, 1730, 9, z - 160]; }],
  ['ramps', () => { __sim.fastForward(110); const z = T.shoreZ(1760); return [1740, 6, z - 40, 1765, 0.5, z + 5]; }],
  ['shingle', () => { __sim.fastForward(120); const q = WW.infantry.squads.find(q => q.alive && q.sector === 'easyRed' && q.kind !== 'tank') || WW.infantry.squads.find(q => q.alive); return [q.x - 14, 5, q.z - 18, q.x + 2, 0.5, q.z + 4]; }],
  ['bluff', () => { __sim.fastForward(270); const q = WW.infantry.squads.find(q => q.alive && q.state === 'climb') || WW.infantry.squads.find(q => q.alive); return [q.x - 16, q.y + 6, q.z - 16, q.x, q.y, q.z + 3]; }],
  ['soldiers', () => { __sim.fastForward(140); const q = WW.infantry.squads.filter(q => q.alive && q.kind !== 'tank' && q.men > 6).sort((a, b) => b.speed - a.speed)[0]; return [q.x - 3.2, q.y + 1.3, q.z - 2.6, q.x, q.y + 0.2, q.z]; }],
  ['pinned', () => { __sim.fastForward(190); const q = WW.infantry.squads.filter(q => q.alive && q.kind !== 'tank' && (q.state === 'shingle' || q.state === 'cross')).sort((a, b) => b.men - a.men)[0] || WW.infantry.squads.find(q => q.alive); WW.infantry.squads.forEach(o => { if (o.alive && Math.hypot(o.x - q.x, o.z - q.z) < 12) o.sup = 3; }); return [q.x - 3.5, q.y + 1.6, q.z - 4, q.x, q.y, q.z - 0.5]; }],
  ['b24', () => { __sim.fastForward(25); const p = WW.offmapAir.planes.find(q => q.alive && q.kind === 'b24'); return [p.x - 40, p.y - 6, p.z - 30, p.x, p.y, p.z + 10]; }],
  ['p47', () => { __sim.fastForward(160); for (let i = 0; i < 200 && !WW.offmapAir.planes.some(q => q.alive && q.kind === 'p47' && q.state === 'dive'); i++) __sim.fastForward(0.5); const p = WW.offmapAir.planes.find(q => q.alive && q.kind === 'p47' && q.state === 'dive') || WW.offmapAir.planes.find(q => q.alive && q.kind === 'p47'); return [p.x - 20, p.y + 4, p.z - 18, p.x + 8, p.y - 4, p.z + 20]; }],
  // the defence shots step the sim and the defence visuals together for a second (software GL draws a frame a second,
  // too slow to fill the air with tracers on its own): the bursts, the tracers and the strikes are in flight
  ['wn_close', () => { __sim.fastForward(Math.max(0, 110 - WW.game.roundTime)); const now = WW.time.now, ok = e => e.alive && e.kind === 'mg' && !(e.suppressedUntil > now) && WW.defenceFx._state(e) && now - WW.defenceFx._state(e).actT < 1 && WW.defenceFx._state(e).tgt; let e; for (let i = 0; i < 40 && !(e = WW.coastDefence.elements.find(ok)); i++) __sim.fastForward(1); e = e || WW.coastDefence.elements.find(q => q.alive && q.kind === 'mg'); const t = WW.defenceFx._state(e) && WW.defenceFx._state(e).tgt, a = t ? Math.atan2(t.z - e.z, t.x - e.x) : e.heading, c = Math.cos(a), s = Math.sin(a); warm(); return [e.x - c * 3.2 + s * 1.6, e.y + 1.6, e.z - s * 3.2 - c * 1.6, e.x + c * 6, e.y - 0.6, e.z + s * 6]; }],
  ['mg_fire', () => { __sim.fastForward(Math.max(0, 130 - WW.game.roundTime)); const now = WW.time.now; let e = null, t = null; for (let i = 0; i < 40 && !t; i++) { for (const q of WW.coastDefence.elements) { const st = WW.defenceFx._state(q); if (q.alive && q.kind === 'mg' && st && st.tgt && st.tgt.isSquad && st.tgt.alive && WW.terrain.heightRaw(st.tgt.x, st.tgt.z) > 0.05 && now - st.actT < 1) { e = q; t = st.tgt; break; } } if (!t) __sim.fastForward(1); } if (!t) { e = WW.coastDefence.elements.find(q => q.alive && q.kind === 'mg'); t = e; } warm(); const dx = e.x - t.x, dz = e.z - t.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d; const px = t.x - ux * 4 + uz * 12, pz = t.z - uz * 4 - ux * 12; return [px, Math.max(0, WW.terrain.heightRaw(px, pz)) + 2.6, pz, (t.x * 3 + e.x) / 4, 0.8, (t.z * 3 + e.z) / 4]; }],
  ['wn_out', () => { __sim.fastForward(Math.max(0, 200 - WW.game.roundTime)); const now = WW.time.now; const e = WW.coastDefence.elements.filter(q => !q.alive && !q.dormant && q.type !== 'wall').sort((a, b) => (b.K.wall ? 1 : 0) - (a.K.wall ? 1 : 0) || b.outAt - a.outAt)[0] || WW.coastDefence.elements[0]; warm(); return [e.x - 7, e.y + 4, e.z - 6, e.x, e.y + 0.3, e.z]; }],
  ['inland', () => [1400, 40, 1420, 1400, 4, 1750]],
  ['plateau', () => { const z = T.bluffTopZ(1385); return [1330, 16, z - 15, 1395, 3, z + 60]; }],
  // the realism pass (vehicles.js, beach_engineers.js, leaders.js, hoc_climb.js, prisoners.js; drawn by vehicles_fx.js
  // and hoc_fx.js), in clock order; the last ones force the state they show (a lane marked, E-1 open, a surrender)
  ['dozer', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(6 * 60 + 50)) __sim.fastForward(1); const v = WW.vehicles.live.find(q => q.K.dozer && q.working) || WW.vehicles.live.find(q => q.K.dozer) || WW.vehicles.all[0]; return [v.x - 3.5, 1.8, v.z - 3, v.x, 0.2, v.z]; }],
  ['hoc_grapnels', () => { for (let i = 0; i < 2000 && !WW.hocClimb.ropes.length; i++) __sim.fastForward(0.25); __sim.fastForward(0.7); const r = WW.hocClimb.ropes[0], u = r.craft; return [u.x + 4, 2.5, u.z - 9, r.x, 2.4, r.zFoot]; }],
  ['hoc_ropes', () => { let q; for (let i = 0; i < 200 && !(q = WW.infantry.squads.find(s => s.alive && s.state === 'rope' && s.rope && s.ropeP > 0.3)); i++) __sim.fastForward(0.5); q = q || WW.infantry.squads.find(s => s.sector === 'hoc'); const r = q.rope || { x: q.x, zFoot: T.bluffFootZ(q.x) }; return [r.x + 5, 3.2, r.zFoot - 6, r.x, 2.2, r.zFoot + 1]; }],
  ['hoc_ladder', () => { let u; for (let i = 0; i < 120 && !(u = WW.landingCraft.live.find(q => q.type === 'dukw' && q.ladderUp)); i++) __sim.fastForward(1); __sim.fastForward(6); u = u || WW.landingCraft.craft.find(q => q.type === 'dukw' && q.ladder); return [u.x + 5, 2.5, u.z - 5, u.x, 2.2, u.z + 2]; }],
  ['leader', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(7 * 60 + 36)) __sim.fastForward(1); const L = WW.leaders.list.find(q => q.key === 'cota' && q.ashore) || WW.leaders.list.find(q => q.ashore) || WW.leaders.list[0]; return [L.cx - 3, 1.4, L.z - 3, L.cx, 0.3, L.z]; }],
  ['lci91', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(7 * 60 + 50)) __sim.fastForward(1); const u = WW.landingCraft.craft.find(q => q.named === 'LCI(L)-91'); return [u.x - 9, 3.5, u.z - 8, u.x, 0.4, u.z]; }],
  ['lci85', () => { const u = WW.landingCraft.craft.find(q => q.named === 'LCI(L)-85'); return [u.x - 10, 4, u.z - 9, u.x, 0.4, u.z]; }],
  ['dukw_swim', () => { let u; for (let i = 0; i < 200 && !(u = WW.landingCraft.live.find(q => q.type === 'dukw' && !q.ladder && q.state === 'run')); i++) __sim.fastForward(1); u = u || WW.landingCraft.craft.find(q => q.type === 'dukw'); return [u.x - 2.6, 1.2, u.z - 2.2, u.x, 0.1, u.z]; }],
  ['vehicles_jam', () => { const C = WW.scenarios.normandy.clock; while (WW.game.roundTime < C.at(8 * 60 + 20)) __sim.fastForward(1); const L = WW.vehicles.live.filter(v => v.state === 'jam'), v = L.sort((a, b) => L.filter(o => Math.abs(o.x - b.x) < 5).length - L.filter(o => Math.abs(o.x - a.x) < 5).length)[0] || WW.vehicles.all[0]; return [v.x - 6, 2.6, v.z - 6, v.x + 1, 0.3, v.z + 0.5]; }],
  ['lane_marked', () => { const E = WW.beachEng, L = E.lanes.find(l => l.marked) || Object.assign(E.lanes[0], { marked: true }); const z = T.shoreZ(L.x); return [L.x - 10, 4, z - 40, L.x, 0.3, z - 6]; }],
  ['ditch', () => { const b = WW.beachEng.blocks.find(q => q.id === 'E-3'); return [b.x - 6, 3, b.z - 7, b.x, gy0(b.x, b.z), b.z]; }],
  ['prisoners', () => { const C = WW.coastDefence, w = C.wnOf('WN65'); if (!w.silenced) { const q = WW.infantry.squads.find(s => s.alive && s.kind !== 'tank'); q.state = 'top'; q.x = w.x; q.z = w.z + 2; w.elements.forEach(e => C.knockOut(e)); } __sim.fastForward(40); const r = WW.prisoners.recs.find(x => x.state === 'march') || WW.prisoners.recs[0], p = WW.prisoners.pos(r); return [p.x + 3, gy0(p.x, p.z) + 1.6, p.z - 3, p.x, gy0(p.x, p.z) + 0.2, p.z]; }],
  ['exit_e1', () => { const C = WW.coastDefence; for (const id of ['WN65', 'WN64']) C.wnOf(id).elements.forEach(e => C.knockOut(e)); __sim.fastForward(2); const b = WW.beachEng.blocks.find(q => q.id === 'E-1'); b.prog = 1.2; __sim.fastForward(22); return [b.x - 9, 4, b.z - 10, b.x, gy0(b.x, b.z), b.z + 6]; }]
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?scn=normandy&v=' + Date.now(), { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .msg { display: none !important; }' });
  await p.evaluate(seed => {
    WW.terrain.generate(seed); WW.seedRandom(seed);
    WW.game.composition = null; WW.game.mode = 'auto'; WW.game.startRound({ keepMap: true });
    __sim.fastForward(30); WW.time.scale = 0.0001;
    window.T = WW.normandyTerrain;
    window.gy0 = (x, z) => Math.max(0, WW.terrain.heightRaw(x, z));
    window.warm = () => { for (let i = 0; i < 36; i++) { __sim.fastForward(1 / 30); WW.defenceFx.update(); } };
  }, SEED);
  const done = [];
  for (const [name, fn] of SHOTS.concat([['plot', null]])) {
    if (ONLY && !ONLY.split(',').includes(name)) continue;
    if (!fn) { await p.evaluate(() => { delete WW.cam.update; WW.cam.mode = 'map'; WW.plot.set(null); }); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 }); done.push(name); continue; }
    await p.evaluate(src => {
      WW.time.scale = 0.0001;   // a shot may run the sim during its wait (the defence shots); the next starts still
      const v = eval('(' + src + ')')();
      WW.cam.update = function () { WW.camera.position.set(v[0], v[1], v[2]); WW.camera.lookAt(v[3], v[4], v[5]); WW.camera.updateMatrixWorld(); };
    }, fn.toString());
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, name + '.png'), timeout: 180000 });
    done.push(name);
  }
  console.log('shots in', OUT, done.join(' '), ' errors:', errs.length, errs.slice(0, 5));
  await b.close();
})();
