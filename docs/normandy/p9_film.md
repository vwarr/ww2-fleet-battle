# Normandy P9: the film layer

Plan: [docs/NORMANDY_PLAN.md](../NORMANDY_PLAN.md) P9 "film layer". Every hook is gated on the scenario: the Pacific director, diary, report card and plot are unchanged.

## What changed
- **Director** (`js/camera_normandy.js`, new): the land battle's shots, added through the Pacific machinery (`WW.camHooks` candidates on the camera_score.js ladder, `WW.cam.interrupt`, the camera_lock.js lock).
  - Human-scale rigs a few units off the subject, 0.5-3 u over the sand or the sea: astern of a coxswain on the run-in, over his shoulder as the ramp drops (or from the sand looking at the ramp), beside a DD tank shipping water, behind men crossing the sand toward the MG firing on them (or over the MG 42's shoulder), along the shingle, up the bluff, behind an assault, up the Pointe du Hoc cliff at the ropes, a casemate enfilading the beach, a destroyer closed on the beach firing, the rocket barrage, the B-24s from the beach, a P-47 dive.
  - Events cut in: the first ramps of each wave, a DD tank foundering, an LCI / LCT wrecked, a gap blown, the Rangers at the cliff, a strongpoint silenced (9), a draw opened and the Pointe du Hoc guns found (9.5), the rocket barrage at 06:25 (9.5).
  - The Pacific's ship-scale candidates (the sunrise chase, the gun duels) are capped at 6.2 (`damp`). A kind just filmed loses up to 1.8 for 30 s. The establishing shot is the first wave from the water, a German position looking down on the beach, or along the waterline.
  - `camera.js`: `shot.nd` goal, `sane()`/`floor()` in place of keepSane (whose floor over a beach is 11 u), and `wide()`.
  - `camera_lock.js`: `shot.nd` locks (a ramp until the men are off). A wrecked craft is `sinking` with no `sinkT`, which used to lock forever.
  - Film captions name the sector, the unit and the D-Day clock.
- **Follow** (`js/camera_normandy_follow.js`, new; camera_follow.js and freecam.js gated):
  - F follows the best land action as a heading-relative chase at the men's scale.
  - Tab cycles the units, 8 the squads under fire, 9 the craft in trouble.
  - A wiped-out squad hands the camera to the nearest of its unit.
  - The free camera picks craft, squads and tanks and comes down to 2.5-3 u.
- **War diary** (`js/diary_normandy.js`, new; war_diary.js gated): the land battle on the D-Day clock (`0630`), aggregated per sector and per batch.
  - The bombardment and the B-24s, the rocket barrage, the DD tanks (launched, foundering, how many reached the beach), and H-Hour.
  - The touchdowns, the craft lost, the first men across the shingle and on the bluff, gaps, and the leaders (leaders.js lines; juniors at most one per 45 s).
  - Positions taken and strongpoints silenced (by assault or by naval gunfire), draws and their road blocks, and the destroyers closing.
  - The Rangers (the ropes, the top, the guns), prisoners, the tide (07:30, 08:15, 11:00), Bradley's 09:00 doubt when few men are up, the hourly state of the beach, and the end.
  - The fleet's opening line, the sighting reports and the Pacific victory line are skipped in Normandy.
- **Report card** (`js/aar_normandy.js`, new; aar_card.js gated): "Report of Operations, V Corps".
  - The outcome, the men landed, lost and on the bluffs, the craft and tanks, and the DD tanks.
  - Pointe du Hoc, the strongpoints silenced with their times, and the draws (held, or open at a time).
  - The prisoners, a by-sector table, the key moments, and a comparison with 6 June 1944: ~2,400 casualties of ~34,000 landed, 27 of 29 DD tanks, E-1 open about midday, the Rangers atop at 07:10.
- **Plot table** (`js/plot_normandy.js`, new; plot_table.js / plot_tokens.js gated): the chart's window is Omaha and Pointe du Hoc, x 600-2280 and z 590-1310. The Transport Area is an arrow off the top edge. G cycles Omniscient, USN and GER.
  - The static ink: the sectors and lanes, the line of departure, the DD launch line, the draws, the villages and the Pointe.
  - The live layer: the tide line, the craft and the waves (labelled by clock time), the wrecks, the men by state (pinned ringed), the tanks, the strongpoints (firing ticks, struck through with the time once silenced), the draws (barred or open with the time), the 155s and the beachhead line.

## Test
`tests/normandy_film.js [seed] [simSecs] [scale] [shots]` (render mode): the director's shot log, the camera height over the ground (seed 1, 450 s: p10 0.6, p50 0.8, p90 3.2; never under the surface), follow, the diary, the plot and the card; screenshots go to `tests/shots/normandy_film/`.
