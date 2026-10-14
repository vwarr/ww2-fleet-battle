# Director camera review (camera4, 2026-10-13)

User: "pressing F doesnt really focus on the best action, im still getting bad angles ... and i miss all the best
explosions and moments." Brief: briefs/camera4_rebuild.md.

## How the director chooses today (before camera4)
- **Subject and shot type.** `camera.js candidates()` builds a list of `{pr, kind, subj}` from its own plane / ship
  rules plus ten `WW.camHooks` (camera_scenes.js ships and base, camera_follow.js finder items, air_*.js, base_fx.js,
  night_*.js, admirals_flags.js). `pr` is one drama ladder (camera_score.js header). `pickShot()` takes the best
  `pr + jitter` (repeat / variety penalties) when the running shot's duration ends; story mode (camera_story.js)
  supplies the shot instead while a story runs.
- **Position.** Each kind has a goal function: camera.js (orbit / chase / low / flyby / wide), camera_scenes.js (duel /
  profile / aa / base), camera_story_shots.js (story sub-kinds), camera_action.js (bomb / torpedo hand-offs, ots),
  camera_base.js (the field). `keepSane()` then pushes the goal out of hulls and terrain, `compose()` puts the aim at
  the rule-of-thirds point, `capTurn()` limits the view to 1 rad/s.
- **Cuts.** Six independent paths, each wrapping `WW.cam.update` with its own thresholds:
  1. shot duration ends -> `pickShot()` (camera.js:467);
  2. camera_score.js `tick` re-evaluates once a second (MIN_T 5 s, bonus 3 -> 1) and `recut()`s;
  3. camera_scenes.js event interrupts AFTER a sinking / magazine / deck hit / bombardment / raid (`interrupt()`,
     camera_scenes.js:44-63), and its own 1 s tick for torpedoes within 12 s of a hull (camera_scenes.js:146);
  4. camera_story.js yields / switches / dive cue / fall / phase cuts (camera_story.js:334-385);
  5. camera_base.js alarm sequence (`recut`);
  6. camera_action.js hand-offs change the running shot in place.
  camera_lock.js arbitrates 2 and 3 (`locked()`, `allows(pr >= 10)`).

## Baseline (camera_audit.js, standard + carrier_duel, seeds 1-3, 600 sim s; raw_before)
| metric | before |
|---|---|
| M1 promise kept | 62% of 133 label-seconds |
| M2 attack continuity | 100% of 46 filmed drops |
| M3 best-action top-1 / top-3 | 56% / 67% |
| M4 screen time | plane 58%, ship 19%, ship_combat 18%, base 3%, overview 2%; p50 shot 10.6 s, 5.4 cuts/min |
| M5 dead air | 6% (368 s) |
| M6 target in frame in the attack | run 86%, dive 68%, gun 32%, out 52% |
| **BE-ship** (new): ship hit by bomb / torpedo / heavy shell, sinking, magazine, deck explosion: impact in the safe frame, < 420 u, unoccluded | **50% (61 / 122)**; framed 1 s before too 48% |
| BE all (+ planes shot down within 400 u of a ship) | 25% of 475 (kills 58 / 353) |

Misses are almost all "off" (not in the frame at all), not occlusion (1 hull, 0 land): the camera is somewhere else.

Contact sheets looked at (tests/shots/camera_audit/sheets/before_*):
- carrier_duel/2 782-812: 15 s of a torpedo hand-off (`chase:torp`) looking DOWN at a wake on empty sea, no target
  hull in the frame, the torpedo misses; meanwhile a ship sinks elsewhere (oracle "sinking 8.4 off"), reached only
  when the profile interrupt comes after the fact.
- standard/3 486-510: the same: 12 s down a torpedo wake on empty sea while a ship sinks elsewhere, then a
  dogfight.

## Ranked problems
1. **Reactive, not anticipatory.** Nothing models when an impact lands. Ships score from hits in the last 6-10 s
   (camera_scenes.js `recent(hits)`), sinkings / magazines cut in after the event (`shipSunk`, `magazine`). The finder
   (camera_finder.js) predicts air attacks and torpedoes in the water, but not shells in flight, falling bombs, or a
   ship about to sink. So the camera arrives after the explosion.
2. **The torpedo hand-off locks the camera on an empty sea.** camera_action.js `torp()` films the wake from behind and
   above looking down (the hull rarely in frame), holds up to 45 real s, and camera_lock.js makes every stage a
   release-window lock: nothing can pre-empt it, even when the torpedo is plainly missing (both sheets above).
3. **Six cut paths with different gates** (MIN_T 5 / interrupt gap 15 s / shot.t < 5 / bigNow 8 vs 8.5 / story rests
   40 s / lock PREEMPT 10). Hard to reason about; the score tick runs once a second with a 3-point bonus for 5 s,
   so a big moment 2 s away never wins in time.
4. **F jumps to the most imminent finder item**, often a strike 20-35 s out or a story on a plane in transit
   (camera_follow.js `f()`), not the best action now.
5. **No framing check.** Poses are geometric; `keepSane` pushes the camera out of hulls but nothing checks that the
   subject and its target are in the frame and the sight line is clear before committing.
6. **Story mode yields only through the score / bigNow**, which is reactive (1, 3); a story in transit keeps the
   camera through a battleship's last salvo.

## Decision: rebuild the decision core, keep the shot library
The shot goals (the dive films, the story shots, the hand-offs, the duel / profile / aa / base scenes, the field
sequence, cross-fades, slow-mo limits, night candidates, the Normandy hand-off) are good and are what the tests gate.
The problem is the brain: reactive scoring spread over six cut paths. So camera4 replaces the decision layer with one
module (js/camera_director.js) and keeps every public name other files use (`WW.camHooks`, `WW.cam.*`, `WW.camStory`,
`WW.camFollow`, `WW.camLock.state`, `WW.camScenes.goal`, the shot fields `stage` / `aim` / `user` / `pr`), so the ten
hook files, the seven `WW.cam.update` wrappers, Normandy, ui.js, freecam.js and the tests keep working.

The new core:
- **Forecast** of impacts from the live projectiles (`WW.combat._i.active`: shells with their landing time and point,
  bombs falling, torpedoes running with a closest-approach hull test) and dive bombers in their dive: per target
  ship, the ETA, the impact point, the expected drama (the ship's value, its HP left, whether the incoming damage
  sinks her). These become `brace` candidates on the ship, worth most 1.5-9 real s before the impact.
- **One arbiter** (4 Hz) instead of camera_score's tick, camera_scenes' torpedo tick and story mode's own yields:
  best candidate vs the running shot's live worth + hysteresis; a minimum shot length (4 s) unless the newcomer is
  much bigger (+3); never inside the release window of an attack or a hand-off; a `brace` shot holds until its
  impact plus a beat. The event interrupts stay as the fallback for what nobody predicted.
- **Framing check** `WW.cam.frameCheck(P, L, pts, own)`: points projected inside the safe frame, terrain / hull
  raycast to each point, the camera not in or just above geometry. The `brace` pose search scores ~20 candidate
  poses with it; every running shot gets a sight-line lift when a hull or the island blocks the subject.
- **F** cuts to the arbiter's single best candidate now, held as the user's shot (the attack lock still applies),
  labelled; a second F hands back.
- **The torpedo hand-off** frames the wake running into the target hull and lets go once a miss is certain.

Camera4 results: see the end of this file.

## Course correction: arcs (user, 2026-10-13)
The first build (forecast-driven cuts) raised ship-impact coverage (58 -> 69% on the same rounds) but doubled the
recuts and made a highlight reel: it hopped to every forecast impact and yielded stories before their dives (dive_film
0%). The user asked for "a movie scene ... little pieces of story in everything", Midway-style runs where the followed
plane sometimes dies and is followed to the water, and carriers weighted above everything. So the director's main mode
is now the ARC (js/camera_director.js "arcs"):
- Air arcs = camera_story.js stories, started by promise when a strike's run-in is 8-45 s out (not at the launch), with
  a 10-20 s rest between arcs; committed: the director never cuts into one (no score yields, no switching between
  strikes); only a carrier struck, or a carrier / battleship blowing up or going down, interrupts (`arcAllows`), and
  the camera then comes back. The protagonist is chosen by drama, never by survival; shot down, it is followed to the
  water (FALL_MAX 14 s, a far fall is tracked) plus a beat, then a wingman still committed to the attack within 90 u
  takes the story on, or the arc ends (`protagonistDown`). After the attack the arc closes ~9 s into the way home.
- Ship arcs: a destroyer charge (ai_charge.js) or torpedo run, a gun duel with hits coming, a ship under air attack
  (the target's point of view). Each has a small shot menu; the ship's own torpedo spread hands off to the wake.
- The forecast (`events()`: { t, kind, subject, target, x, z, weight }, the ONE event interface) now only TIMES THE
  CLIMAX inside an arc: an impact due on the arc's target in 1.5-6 s gets a brace insert (a story insert, or the ship
  arc's next shot), never inside an attack being filmed.
- Class weighting: CV 3 >> BB 1.8 > CA 1.3 > DD 0.9 > PT / sub 0.5 (base 1.3). A carrier about to be struck (an impact
  forecast within 15 s, or two attackers committed) supersedes any arc not already about her (`carrierCall`).
- Between arcs: a short wide establishing shot, then filler under the old hysteresis (MIN_T 4 s, +3 to cut early).
- F: the best arc now (fPick: a running arc is adopted and named; else the best ship arc or air story by promise).
Every arc is logged on WW.cam.arcs ({ id, kind, who, t0, t1, outcome, interrupted }), so any director can be measured
the same way.

## Results (camera_audit.js, standard + carrier_duel seeds 1-5, 600 sim s; raw_beforeZ vs raw_afterV)
BE is judged 4 frames after the impact (a cut made on the event counts) and 1 s before; plane kills count only inside a
raid or the running arc (far dogfight kills are reported apart). beforeZ = main's director (9 rounds: carrier_duel/4
timed out loading under the machine's load).

| metric | before | after |
|---|---|---|
| BE (ship hits, sinkings, magazines, deck fires, raid / arc kills) in frame | 33% of 496 | **42%** of 450 |
| ... framed 1 s before too | 27% | **35%** |
| ship impacts only (bomb, torpedo, heavy shell, sunk, magazine, deck) | 54% | 55% |
| raid / arc plane kills | 17% | **32%** |
| CV-BE (a carrier hit / deck / magazine / sinking in frame) | 76% of 34 (pre 56%) | **79%** of 34 (pre **65%**) |
| arc completeness (camera time in arcs filmed setup -> outcome, no cut away) | n/a (no arcs) | 52% (69% of the time in arcs; 113 arcs: 78 complete, 7 protagonistDown, 24 superseded by a carrier strike, 2 cut away) |
| BE inside arcs (the arc's own impacts / kills) | n/a | 57% of 241 |
| early cuts (recuts) per min | 1.57 | 1.51 |
| cuts per min / shot p50 | 5.5 / 11.1 s | 6.6 / 9.4 s |
| M2 attack continuity (drops held to the result) | 98% | 60% (hits: 89% -> 90%) |
| M3 oracle top-1 / M5 dead air | 53% / 5% | 39% / 11% |
| M6 run / dive with the target in frame | 83% / 74% | 61% / 55% |
| snap frames | 0 | 0 |

Reading it: the camera now stays with a story and is on the carriers' and the arcs' climaxes more often, before they
happen. The oracle metrics (M3, M5) fall by construction: they reward hopping to the momentary best action, which the
user rejected. M2 falls mostly because a torpedo plainly missing on a long run (> 6 real s left) is let go after a short
look instead of 30-45 s down an empty wake; hits filmed to the result are unchanged (90%). Plain ship-impact coverage is
flat: committing to arcs trades some unrelated impacts for whole stories. Cuts per minute rose with the story's
in-arc shot changes (6-14 s shots); recuts did not.

Sheets looked at (tests/shots/camera_audit/sheets/): before_* (the torpedo wake on empty sea); after6_* and after7_*
(forecast braces: a carrier torpedoed and sinking, framed broadside with the wakes coming in, then the profile); arc2_*
and afterV_*: a VT-6 run where Lt. Cmdr. Flatley is shot down in the run, followed down, "Ens. Vejtasa takes the lead",
the drop and the battleship under flak; an Akagi Kate strike whose leader falls over the island, the story handed to a
dive bomber of the wave who pushes over and hits Enterprise's deck, then is himself shot down and followed down; a
VT-6 run to the drop, the wake and the hit on a destroyer; a destroyer (Hibiki) under fire on a torpedo run.
Known blemishes: over-the-shoulder run shots often hold the target small at the top edge; the deck (aa) shot cannot see
a bomb hit on its own ship; a fall over the island frames the beach more than the plane.

## Gates
determinism --cross 1,2 200: PASS (render / browser / node identical). sim_behaviour 6 seeds: PASS 350 FAIL 3
(pt_pen_med, ftr_leash, crip_away; node mode loads no camera code, so not this branch). dive_film: 100% (3/3) PASS
(main's director on the same machine: 0/2 FAIL). action_cam: errors 0, max view rotation 1.0 rad/s. story_cam: all
PASS (the death test now waits for the fall to the water). fps.js: 120 fps (vsync cap, as before). Normandy: out of
scope (user); camera_normandy*.js untouched, its interrupts bypass the arc gate (c.nd), camera_score.js's tick still runs
there.
