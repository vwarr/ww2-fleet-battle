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
PASS (the death test now waits for the fall to the water). Its informational lead check: 0/7 first releases had the camera
on them >= 10 s before (the arc picks one strike, often not the first to release); min hull clearance -6.4 in one
frame (a deck / hold shot). fps.js: 120 fps (vsync cap, as before). Normandy: out of
scope (user); camera_normandy*.js untouched, its interrupts bypass the arc gate (c.nd), camera_score.js's tick still runs
there.

# camera5: the look-ahead director (2026-10-14)

User (2026-10-13): the sim is deterministic, so precompute the best camera; "work on it afterwards, and compare. If one
seems to clearly pull ahead in cinematography, work on tuning that further". Brief: briefs/camera5_lookahead.md.

## How it works
- **Fixed live step** (main.js): the live game steps the sim in fixed 1/120 sim s steps (an accumulator over real time x
  scale x 0.5 x warp; whole steps, the remainder carried; a frame within a quarter step of a whole number takes it, so
  frame jitter never makes 0 / 2 step stutter; a frame whose steps pass 30 ms of wall time leaves the rest, backlog
  capped at 0.5 sim s). At 1x and 60 fps it is one step a frame, as before. Game speed measured in the full frame loop
  against main: 0.500 sim s per real s at 60, 30, 120 and 144 Hz on both, 0.466 on both with stutter (the 0.1 s rdt cap
  per frame, unchanged). The tests' fastForward keeps its 0.05 s steps.
- **Round record** (round_rec.js): what a round starts from, captured in startRound (the generator's state before the
  modules clear, since damage.js rolls the wind there; then the map, the clock, the composition and setup choices, the
  forced time of day / weather, the aces' rosters, the admirals' preview). startRound({ replay }) starts the same round.
- **Look-ahead worker** (lookahead_worker.js, lookahead.js, lookahead_log.js): a Web Worker loads the game's scripts in
  sim-only mode and replays the round 90 sim s ahead of the screen. Its event log (drops, impacts, hits, heavy shells
  landing on ships, sinkings, magazines, planes shot down and where the wreck lands, attack runs, strikes leaving) goes to
  the page; the director sees 75 sim s of it. Checkpoint hashes every 600 steps compare the copies; a mismatch, a test's
  fastForward or the B-29 egg switch the look-ahead off for the round (the forecast director takes over).
- **The director** (camera_lookahead.js, on camera4's arcs): events() lists the known future impacts (exact times and
  points, and whether the ship goes down after); the arcs are planned by known outcome (a strike's attack on a ship with
  its hits and losses, a ship's torpedo spread that hits, a gun duel that scores, a carrier struck), worth the class at
  stake x what happens; an air arc opens ~34 real s before its climax, a ship arc ~16 s; never one that would still run
  when a bigger arc (a carrier strike) must open; a carrier strike supersedes a running arc not about her, unless that
  arc's own climax lands first and is worth it. The protagonist is drawn at the wave's real loss rate: with that
  probability one that is shot down before its drop (followed to the water), else one that hits. After its fall a wingman
  that WILL hit carries the story (or one of the wave, wherever it is). Story braces come only after the protagonist's own
  attack (or its fall); a carrier struck is braced from any source. An arc ends on its outcome (no flight home, no
  closing high shot over empty sea). A torpedo known to miss lets its wake go when another hit on the target is due; the
  beat after a result turns to a hit landing inside it; the deck AA camera looks down at its own ship's known hit. After
  dark strikes are filmed from the target (night_fx.js refuses air stories). `?cam=forecast`: camera4, no worker.

## Determinism found on the way
tests/lookahead_trace.js (render mode, time scales 1 / 4 / 2 / 0.5, the director running, then a second round carried
over) found a sim leak: air_aces.js returned a pilot to the roster when a bailed-out cripple's floating wreck sank, a
Math.random lifetime, so later strikes' pilots (and their ace skill) varied run to run. Fixed: the pilot is lost with the
plane. After the fix: 32 / 32 rounds (16 seeds of standard, carrier_duel, midway, carrier_duel_dusk x 600 s, plus 300 s
carried-over rounds) give identical checkpoints and identical event logs (where a falling wreck meets the sea is
compared apart: its last seconds are partly visual).

## Comparison (camera_audit.js, 24 rounds per director: standard, carrier_duel, midway, dusk, carrier_duel_dusk, midway_dusk x seeds 1-4, 600 sim s, same sim)
| metric | forecast (camera4) | look-ahead |
|---|---|---|
| arc completeness / time in arcs | 45% / 58% | 45% / 55% |
| BE inside arcs (the arc's own impacts and kills) | 63% of 519 | **68%** of 471 |
| BE all (framed 1 s before too) | 48% (44%) | **50%** (45%) |
| CV hits in frame (1 s before too) | 91% (84%) of 82 | 91% (82%) of 82 |
| M2 attack continuity (hits held) | 80% (100% of 13) | 79% (92% of 12) |
| recuts / cuts per min | 1.88 / 6.7 | **1.73** / 6.7 |
| dead air | 7% | 7% |
| protagonist falls filmed / held to the water | 19 / 19 | **58 / 52** |
| arcs ending with the protagonist down | 19 of 340 | **56** of 350 |
(Summaries and the judged contact sheets, named by director (m2_* / m3_f_* forecast vs m2_l_* / m4_l_* look-ahead,
v3_l_* the third VQA round): tests/shots/camera_audit/camera5/ and briefs/camera5_sheets/.) Earlier rounds of the same comparison (before the last tuning) gave the same
picture: the look-ahead ahead on in-arc coverage, recuts and the protagonist's death, level on carriers. Its weak spot:
more impacts hidden behind a hull (36 vs 13).

## Blind sheets (judged by a separate agent that did not know which director was which)
Round 1 (midway/4 a VMSB-241 dive on Kaga, midway/3 a 69th BS run shot down over the carrier, standard/1 a VT-6 run on a
battleship): the look-ahead won all three (one clearly: the B-26 ridden through the flak, past the carrier, shot down and
followed into the water, against a fixed brace on a carrier nothing hit). "The director that follows a protagonist wins
every time." Shared weakness: empty "home" shots after the climax (fixed since in the look-ahead).
Round 2 (final code; carrier_duel/1 a VB-6 dive on the carrier, carrier_duel/1 a Misawa torpedo run whose protagonist
is shot down, carrier_duel/2 an Akagi strike on Enterprise): the look-ahead won two clearly (the VB-6 ride with bandits
beside the formation, over the shoulder into the dive with the carrier growing in frame, the bomb burst and the burning
carrier, against drifting over open sea then detached braces; a torpedo run and its straddle in frame against dead air
and cross-cutting), the forecast one (its dive centred over the carrier and the hit close, against the look-ahead's
torpedo run with the burning carrier pushed to the frame edge, half behind an escort). Overall 5 of 6 to the look-ahead.
Left for later: the run shot's framing when an escort is between the plane and the carrier (the "hull" misses above),
stretches where the protagonist is a speck near the island.

## Decision
The look-ahead director is the default: it wins the blind story judgement and is ahead or level on every coverage
metric but time in arcs, and it is the one that films the user's Midway arc (the protagonist chosen without regard to
survival, at the real loss rate, followed to the water).

## Cost
perf_probe busy (seed 1, 77 planes airborne): 58.7 fps with the worker vs 58.9 without (60 cap); the page's sim + visual
JS the same (1.56 vs 1.50 ms / frame); the worker runs the sim-only copy at ~42 ms of one other core per sim second in a
busy battle, i.e. ~21 ms per real second at 1x (about 2% of a core), and a burst at round start (90 sim s ahead: ~1-4 s
of one core). Boot ~0.5 s.

## Gates
On the final code: determinism --cross 1,2 200 PASS; sim_behaviour 6 seeds PASS 352 FAIL 0 (the 3 old baseline FAILs are
gone); lookahead_trace (standard, carrier_duel x seeds 1-2, 300 s + 150 s carried over) PASS, and 32 / 32 over 16 seeds
x 600 s + 300 s earlier; dive_film (it drives frames, so the look-ahead runs): seeds 1-4 had no strike story whose wave
dived (n/a), seeds 5-10 90% (9 / 10) PASS; action_cam errors 0, max view rotation 0.65 rad/s; story_cam all PASS (its
"relative orbit / zoom" check failed once on both this branch and main, a sim-state-dependent test, and passed on the
final run), min hull clearance 4.5 (a deck camera is now measured by its height over its own deck; the old -6.4 was the
deck AA shot standing on its own carrier). Tests that call fastForward (story_cam, action_cam) desync the look-ahead and
so exercise the forecast fallback.

## Flying-boat jitter (2026-10-18)
Report: "the camera is super jumpy and jittery now when following the flying boats". Measured with tests/cam_jitter.js
(render mode on a fake rAF clock; the subject's screen position, the camera position and look direction each frame; the
shake is the distance from a quadratic fitted in time through the 5 frames around each one, so smooth motion and
steady turns score 0 and a sawtooth scores its amplitude; cuts left out). Main against this branch, same seed.

Cause: camera5's fixed live step (LIVE_STEP 1/120 sim s = 1/60 real s at 1x) had no render interpolation. At 1x on a
steady 60 Hz clock it is one step a frame and nothing shakes (0.00 px). Wherever frames and steps do not line up
(the director's slow motion: 0 / 1 steps a frame; a 120 Hz display whose frame overruns a vsync: 1 / 2; a 144 Hz
display under the 60 cap: 0 / 1 now and then; the slow-motion ramps) every plane, ship and shell moved a whole step on
some frames and stood still on others, while the camera eased on frame time: the subject shook on screen, 1-3.8 px p95
in slow motion. Not specific to the flying boats (every subject does it, a dive bomber worst) and not the director
(?cam=forecast measures the same); the PBYs are what the director films in the dawn patrol at the start of every round.
A second, smaller one: the camera's eases (P.lerp toward the goal at 1 - exp(-k dt)) treat the goal's motion over the
frame as a jump at its start, so the lag behind a moving subject depends on the frame's length (~v dt / 2): an uneven
frame clock shook a steady chase by that difference (0.2-0.4 px at 120 Hz with overruns).

Fix (visual only; the sim, determinism and the look-ahead trace untouched): js/render_interp.js keeps the pose before
each live step and draws every moving thing (ships and a broken stern, planes, projectiles) at the pose where the
frame's time lies (alpha = acc / LIVE_STEP + SNAP), and poses the sim objects' x / y / z / heading the same way while the
frame's visuals run (camera, crew, audio), all restored bit for bit before the next step. Particles and lifeboats age on
the frame's sim time in the live game. camera.js easeTo (also the free camera's follow): the exact step of
dV/dt = k (g - V) for a goal moving linearly over the frame, the same lag at any frame rate. ?nointerp turns the
interpolation off.

First measurement (on the pre-sea, pre-true-scale main; the final numbers are below). Shake of the subject on screen, p95 px at 960x540, main > branch (150 frames per cell; 120o: 120 Hz with every other
frame overrunning a vsync; slow: the director's 0.5x held; ramp: 0.75x):

| case | 60 Hz | 120o | 144 | slow 60 | slow 120o | ramp | 2x 120o | 4x 120o |
|---|---|---|---|---|---|---|---|---|
| PBY patrol (chase) | 0.00 > 0.00 | 0.18 > 0.00 | 0.71 > 0.00 | 1.03 > 0.00 | 1.00 > 0.00 | 0.72 > 0.00 | 0.04 > 0.00 | 0.04 > 0.00 |
| SBD transit | 0.00 > 0.00 | 0.32 > 0.00 | 1.01 > 0.00 | 1.27 > 0.00 | 1.26 > 0.00 | 1.18 > 0.00 | 0.08 > 0.00 | 0.13 > 0.00 |
| dive bomber attack | 0.01 > 0.01 | 0.40 > 0.01 | 2.17 > 0.00 | 2.55 > 0.00 | 1.10 > 0.01 | 1.59 > 0.00 | 0.33 > 0.24 | 0.19 > 0.03 |
| torpedo run | 0.00 > 0.03 | 0.27 > 0.00 | 1.09 > 0.03 | 1.80 > 0.00 | 1.52 > 0.00 | 1.06 > 0.00 | 0.06 > 0.01 | 0.25 > 0.07 |
| fighter in a dogfight | 0.00 > 0.00 | 0.36 > 0.00 | 1.12 > 0.00 | 1.03 > 0.00 | 0.96 > 0.01 | 2.15 > 0.01 | 0.17 > 0.01 | 0.28 > 0.03 |
| scout floatplane | 0.00 > 0.00 | 0.19 > 0.00 | 0.86 > 0.00 | 1.05 > 0.00 | 0.97 > 0.00 | 0.73 > 0.00 | 0.03 > 0.00 | 0.20 > 0.02 |
| deck take-off | 0.00 > 0.00 | 0.04 > 0.00 | 0.03 > 0.00 | 1.02 > 0.00 | 0.48 > 0.00 | 0.22 > 0.00 | 0.06 > 0.00 | 0.24 > 0.00 |
| carrier landing | 0.00 > 0.00 | 0.52 > 0.00 | 0.94 > 0.00 | 1.99 > 0.00 | 1.39 > 0.03 | 0.96 > 0.04 | 0.11 > 0.00 | 0.26 > 0.19 |
| base runway plane | 0.00 > 0.00 | 0.02 > 0.05 | 0.00 > 0.00 | 0.10 > 0.07 | 0.04 > 0.10 | 0.05 > 0.15 | 0.01 > 0.00 | 0.02 > 0.02 |
| destroyer (orbit) | 0.00 > 0.00 | 0.04 > 0.00 | 0.13 > 0.00 | 0.32 > 0.00 | 0.11 > 0.00 | 0.25 > 0.00 | 0.00 > 0.00 | 0.01 > 0.00 |
| PT boat | 0.00 > 0.00 | 0.10 > 0.00 | 0.21 > 0.00 | 0.59 > 0.00 | 0.69 > 0.00 | 0.31 > 0.00 | 0.01 > 0.00 | 0.04 > 0.00 |
| turning ship | 0.00 > 0.00 | 0.02 > 0.00 | 0.17 > 0.00 | 0.18 > 0.00 | 0.17 > 0.00 | 0.13 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 |
| sinking ship | 0.00 > 0.00 | 0.01 > 0.00 | 0.06 > 0.00 | 0.10 > 0.00 | 0.10 > 0.00 | 0.13 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 |
| free camera following a DD | 0.00 > 0.00 | 0.02 > 0.00 | 0.07 > 0.00 | 0.31 > 0.00 | 0.27 > 0.00 | 0.19 > 0.00 | 0.01 > 0.00 | 0.01 > 0.00 |
| F (follow toggle) | 0.00 > 0.00 | 0.02 > 0.02 | 0.02 > 0.00 | 0.23 > 0.00 | 0.08 > 0.00 | 0.32 > 0.00 | 0.08 > 0.00 | 0.04 > 0.01 |
| director, round start (dawn patrol) | 0.00 > 0.00 | 0.23 > 0.00 | | 3.75 > 0.00 | | | | |
| director, 60 / 150 / 250 s | 0.00 > 0.00 | 0.42 / 0.28 / 0.38 > 0.00 | | 2.34 / 2.12 / 2.17 > 0.00 | | | | |
| director, dusk strikes / finale | 0.00 > 0.00 | 0.03 / 0.16 > 0.00 | | 0.11 / 0.13 > 0.00 | | | | |
| director ?cam=forecast, 150 s | 0.00 > 0.00 | 0.21 > 0.00 | | 2.12 > 0.00 | | | | |

2x and 4x at 60 Hz (2 and 4 whole steps a frame) were already smooth and stay so (all <= 0.1 px but the 4x landing,
0.61 > 0.99, and the 4x torpedo run, 0.17 > 0.11: hard manoeuvres sampled at 15 Hz of sim time, not a sawtooth). The
camera's look direction shook up to 0.46 mrad p95 on main (dive, 2x 120o), <= 0.21 on the branch; its position <= 0.02 u
on both. The free camera panning, blends between shots: no shake on either. The Dumbo (rescue Catalina) did not fly
in the seeded window; it is the same FlyingBoat class as the patrol and the PBY on the water at the ramp (director, round
start) is covered.
Rebased on pacific-sea (the ships, the decks' planes and the floating things ride a visual sea: ship_swell.js). The
order is: render_interp unposes last and poses first, so the sea pose goes on top of the interpolated sim pose and comes
off before it; nothing posed is ever fed back to the sim. With ?sea=rough the same table (main with the sea > branch):
slow motion 60 Hz: destroyer 0.13 > 0.00, PT boat 0.66 > 0.00, turning ship 0.15 > 0.00, sinking ship 0.10 > 0.00,
deck take-off 0.16 > 0.00, carrier landing 1.37 > 0.00, PBY 1.03 > 0.00, dive 1.35 > 0.00, director (start / 60 / 150 /
250 s) 3.74 / 1.71 / 2.10 / 2.16 > 0.00; 120o: every case <= 0.05 on the branch (main up to 0.52); F at 4x 2.82 > 0.08.
Left: the 4x carrier landing (0.78 > 0.99) and 4x PT boat (0.11 > 0.17) are the hook / slam motions themselves at 4x,
not a step sawtooth (the same with and without interpolation at whole steps a frame). The Dumbo did not fly in the
seeded window (no aircrew in the water early enough); it is the same FlyingBoat class as the patrol boats measured.

Final numbers, rebased on true-scale (ad7fe8a: planes at 0.41, closer plane shots, the plane follow rate PLANE_KP 1.8),
pacific-sea and flak-sky. Subject shake p95 px, main > branch (u14: uneven 14 / 19.3 ms frames, under the cap):

| case | 120o | 144 | slow 60 | slow 120o | ramp | 2x 120o | 4x 60 | 4x 120o |
|---|---|---|---|---|---|---|---|---|
| PBY patrol | 0.28 > 0.00 | 1.16 > 0.00 | 1.82 > 0.00 | 1.76 > 0.00 | 1.21 > 0.00 | 0.04 > 0.00 | 0.00 > 0.00 | 0.05 > 0.00 |
| SBD transit | 0.55 > 0.00 | 1.70 > 0.00 | 2.20 > 0.00 | 2.64 > 0.01 | 1.42 > 0.00 | 0.05 > 0.00 | 0.01 > 0.00 | 0.15 > 0.01 |
| dive bomber attack | 0.33 > 0.00 | 1.22 > 0.00 | 86 > 0.00 | 1.60 > 0.03 | 1.06 > 0.00 | 0.17 > 0.01 | 0.07 > 0.06 | 0.18 > 0.13 |
| torpedo run | 0.72 > 0.00 | 2.23 > 0.00 | 1.46 > 0.00 | 1.84 > 0.01 | 1.83 > 0.00 | 2.04 > 0.04 | 1.15 > 0.28 | 0.14 > 0.13 |
| fighter, dogfight | 0.56 > 0.00 | 2.33 > 0.00 | 3.19 > 0.00 | 5.22 > 0.02 | 2.38 > 0.02 | 0.18 > 0.07 | 0.37 > 0.00 | 0.35 > 0.02 |
| scout floatplane | 0.31 > 0.00 | 1.42 > 0.00 | 1.87 > 0.00 | 1.78 > 0.00 | 1.21 > 0.00 | 0.04 > 0.00 | 0.01 > 0.01 | 0.25 > 0.01 |
| deck take-off | 0.04 > 0.00 | 0.03 > 0.00 | 1.02 > 0.00 | 1.25 > 0.00 | 1.00 > 0.00 | 0.05 > 0.01 | 0.02 > 0.01 | 0.01 > 0.01 |
| carrier landing | 0.39 > 0.00 | 1.11 > 0.00 | 1.48 > 0.00 | 2.18 > 0.01 | 1.25 > 0.01 | 0.17 > 0.01 | 0.09 > 0.08 | 0.10 > 0.03 |
| base runway plane | 0.03 > 0.01 | 0.00 > 0.00 | 0.08 > 0.00 | 0.03 > 0.00 | 0.03 > 0.00 | 0.01 > 0.00 | 0.01 > 0.03 | 0.04 > 0.05 |
| destroyer | 0.02 > 0.00 | 0.15 > 0.00 | 0.37 > 0.00 | 0.34 > 0.00 | 0.22 > 0.00 | 0.00 > 0.00 | 0.02 > 0.02 | 0.03 > 0.03 |
| PT boat | 0.13 > 0.01 | 0.32 > 0.00 | 0.72 > 0.00 | 0.63 > 0.00 | 0.54 > 0.00 | 0.04 > 0.05 | 0.14 > 0.27 | 0.19 > 0.16 |
| turning ship | 0.01 > 0.00 | 0.20 > 0.00 | 0.16 > 0.00 | 0.07 > 0.00 | 0.08 > 0.00 | 0.00 > 0.00 | 0.01 > 0.01 | 0.02 > 0.02 |
| sinking ship | 0.01 > 0.00 | 0.03 > 0.00 | 0.08 > 0.00 | 0.13 > 0.00 | 0.05 > 0.00 | 0.00 > 0.02 | 0.00 > 0.00 | 0.01 > 0.01 |
| free camera on a DD | 0.03 > 0.00 | 0.11 > 0.00 | 0.24 > 0.00 | 0.23 > 0.00 | 0.17 > 0.00 | 0.01 > 0.00 | 0.02 > 0.01 | 0.03 > 0.03 |
| F (follow toggle) | 0.02 > 0.00 | 0.02 > 0.00 | 0.28 > 0.00 | 0.38 > 0.00 | 0.37 > 0.00 | 0.01 > 0.00 | 0.32 > 0.21 | 0.07 > 0.02 |
| free camera panning | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 |

At 60 Hz, 1x, 2x and 4x (whole steps a frame) both are smooth (<= 0.03, but the 4x torpedo run / PT boat above: their
own manoeuvres at 4x). The director, 120o / slow 60: round start (the dawn patrol) 0.21 > 0.00 / 0.25 > 0.00; 60 s
0.30 > 0.00 / 2.08 > 0.00; 150 s 0.20 > 0.01 / 0.29 > 0.00 (?cam=forecast the same); 250 s 5.77 > 0.04 / 0.11 > 0.00;
dusk strikes 0.21 > 0.00 / 0.99 > 0.00; finale 0.04 > 0.00 / 0.33 > 0.00. Blends between shots: no oscillation;
the look direction's shake in the 40 frames after a cut is <= 0.6 mrad but for one blend onto a landing chase (one frame,
6.3 mrad on main > 4.3 on the branch) and a 4x over-the-shoulder at round start (2.0 on both): the director's own
moves, not the step. (The director picks shots with Math.random, so its main / branch runs film different shots; at 4x
its per-shot numbers are a few dozen frames each, e.g. that 4x over-the-shoulder 3.5 > 7.0 px, a fighter weaving on a
flying boat's tail, under the swiftshader step budget's uneven 2-4 steps a frame.)
- Uneven frames: the dogfight at u14 1.93 > 0.015 px (its frame-to-frame velocity change 5.9 > 0.16 px), the deck
  take-off 0.058 > 0.000. tests/scale_jitter.js UNEVEN=1 (13 / 20.3 ms) reads the same on both (ots p95 4.7 / 5.7 px,
  take-off 0.47 / 0.52): its 13 ms frames fall under the 60 fps cap's 13.67 ms floor and are skipped, so the drawn frames
  are an even 33.3 ms with 4 whole steps each (no step sawtooth to remove), and its plain second difference measures
  the dogfight's own manoeuvring at 30 fps (4x its 60 fps value: 1.32 / 1.39 at UNEVEN=0).
- The follow rate: easeTo is the exact solution for any rate, so PLANE_KP 1.8 composes with it (the plane rows above).
- A per-frame visual that writes a pose after the interpolation (base_ground_fx.js sets a runway plane's height on the
  paving) keeps its own component; the rest of the sim's pose is still restored (it had left the drawn x / z for the
  next step's capture: a 0.7 px sawtooth on the runway "field" shots, now 0.01).
- The flak puffs (combat_aa.js) advanced their uTime in whole steps (0 / 8.3 ms a frame at 0.5x); they now draw on the
  frame's own time (render_interp lag()), 4.17 ms every frame.
- Not covered: the catapult scouts' one-step jump at the end of the rail (a sim speed change, not this mechanism; the
  scout rows are airborne), the Dumbo (no rescue flew in the seeded windows; same FlyingBoat class as the patrol rows).

Frame strip: docs/flyingboat_jitter_sheet.png (a PBY chase in the director slow motion, 8 consecutive 60 Hz frames, main above:
the plane bobs against the red cross-hair every other frame; the branch below: steady).

# camera6: the biggest action, sampled every second (2026-10-19/20)

User: "I was watching a torpedo bomber returning home while I saw a caption that said Enterprise was hit by a torpedo.
Sample the lookahead camera at multiple points and check what the camera is outputting versus what is actually the
biggest action in that second." Brief: briefs/camera6_tune.md (plus: a lot more camera tests, surface actions as arcs,
dive-bombing angles, the true-speed clock).

## Tools
- tests/camera_audit.js: the oracle now weighs the class at stake on the director's own scale (CV 3, BB 1.8, CA 1.3, DD 0.9;
  a carrier torpedoed scores 11 and ranks top), a sinking is worth most as she goes and less as she settles (a destroyer
  going down stays under 8), a torpedo plane's "run" that has gone 30 sim s without a drop is not an attack. BB-BE (battleship
  hits in frame) next to CV-BE. `--misses`: every CV / BB big event not in frame with the shot, the story phase and the arc
  running then; the spells where the oracle's top action (>= 8) was off camera, ranked by the weight missed; the captions
  naming a CV / BB hit whose hit was not in frame. DIVES: per filmed dive (one that ends in a release), the target in frame,
  the bomber in frame and its size, side-on (60-120 deg to the flight path), flat (looking down < 15 deg), line-of-action
  flips (only while the bomber -> ship line is long enough to have a side), the bomb's impact in frame. Per second it also
  logs the sim's context (strike planes flying home, dives going in, the free camera), ship torpedo spreads and their hits.
  `--scale N` runs at game speed N (1, 4). `--sheet` replays at that speed.
- tests/camera_cases.js (new): scripted pass / fail cases on real rounds (the sim is deterministic per seed and the camera
  never writes it, so each case's event happens at the same sim time whatever the camera does): the user's case (a carrier
  torpedoed while a strike flies home, hit AND the frame 1 s before), two carriers struck within 5 s, a carrier hit while a dive
  goes in elsewhere, a magazine, a sinking, the protagonist shot down (held to the water), a night torpedo hit, a PT boat's
  hit, a submarine's hit, a gun duel's shell hits, a destroyer's torpedo attack from the run-in to the hit, dive angles (SBD
  and Val, on a carrier, on a small ship, at low sun), dead air (no cut storm, no snaps), hits in the first 2 s of a shot, a
  manual pan let go. `--mine DIR` finds rounds for each case in a survey; `--sheets` makes a contact sheet of every failed
  case. `npm run test:camera` = the cases plus a short survey held to thresholds (CV-BE >= 90%, BB-BE >= 75%, M3 >= 40%,
  <= 8.5 cuts/min, dead air <= 12%). Needs BASE_URL (a snapshot server) and CHROMIUM like the other browser tests.

## What the survey found (main, standard / carrier_duel / midway, seeds 1-12)
Every carrier / battleship hit the camera missed was KNOWN 7-15 s ahead (the look-ahead had it): the director was
committed elsewhere. The miss classes, by weight:
1. **Filler stories held the camera**: CAP fights (air:cap 40% of the camera time), flying-boat snoopers and Dumbo rescues are
   camera4 picks made when nothing was planned within 12 s; once begun they were committed arcs that only a carrier strike
   window could break, so a battleship bombed, a ship sinking, a gun duel went unfilmed.
2. **A stuck attack lock**: a torpedo plane on a "run" that never dropped (jockeying for a destroyer's beam) held ONE shot
   for 190 s while a carrier sank (the run lock had no end).
3. **The flight home**: a strike story whose lead turned for home without having attacked (an aborted run, its wave cut up)
   flew home; the story's "ships" cutaway then filmed the carrier home while the target sank (the user's case).
4. **No battleship priority**: only carriers broke into arcs, skipped the establishing shot, or got a late brace.
5. **The brace occluded**: in a gun duel the shooter (another battleship) moved in front of the target's waterline during the
   brace (BE "hull" misses).
6. **Hand-off away from the hit**: a brace on a destroyer followed HER OWN outgoing spread (the torpedo hand-off) and missed
   the torpedo hitting her; an arc's end cut to the establishing shot on the very hit it was braced for.
7. **Dives**: the dive chase sat 16 u back on the flight path, composed on a point 30% toward the ship: in the push-over it
   looked level (the ship out of the 38 deg frame), in the dive straight down at the deck with the bomber a speck or gone (in
   frame 44% of dive frames); the story's over-the-shoulder on its own diver never showed the bomber.
8. Ship torpedo attacks opened 16 s before the HIT, after the spread had left: the run-in was on camera 0 s of the 25 before
   the spread in most hits.

## What changed (camera / lookahead code only; the sim is untouched)
- camera_lookahead.js: **the big impact guard**: whatever runs, a carrier hit (any weapon) or a battleship hit by bomb /
  torpedo / heavy shell, a magazine or a sinking due in 1-8 real s gets the brace on her, unless the impact point is already in
  frame within 380 u, or the shot is the last seconds of an attack (a carrier struck still breaks an attack on a smaller ship;
  a battleship hit does not break the protagonist's fall). Inside a story it is an insert (the story resumes). **Filler
  stories give way**: a story nobody planned that is not a strike yields to any planned arc whose window opens, in any phase.
  **Ship torpedo arcs open on the run-in** (16 s before the spread). **Cripples finished off**: a ship that sinks within the
  horizon with no arc leading to it gets an arc from her point of view. sim2real reads WW.time.base. prefer(spec) for the
  after-battle reel (highlights): the clip's items x4 and carrier priority; while set the guard, the director's braces and
  the event interrupts keep to the clip's ship.
- camera_lock.js: a torpedo run is held only when its drop (or its fall) is due within 24 real s (look-ahead), else 30 s.
- camera_story.js: with the look-ahead a strike turned for home ends (attack or not); the "ships" cutaway prefers the
  target going down to the carrier home; a filler story waits while a surface action is on; the dive cue reframes the
  over-the-shoulder on the diver to the dive chase (also the protagonist's own push-over after a wingman's); no ots on a
  diver; the fall shot is held to the water at any clock (FALL_CAP 32 s).
- camera_story_shots.js: the dive chase on the ship -> bomber line, 11 u past the bomber and 4 to the side (eased): the ship
  below at the composition point, the bomber big above it with its brakes out, from the push-over to the release.
- camera_director.js: the brace re-poses (at most 3 times) when the impact point is hidden from it; a ship arc does not end
  while its brace waits for the hit; no establishing shot when a battleship hit is due in 9 s.
- camera_action.js: no torpedo hand-off from a brace still waiting for the hit on its ship.
- camera_finder.js: the measured rate is seeded from WW.time.base x the game speed.

## Clocks
Before speedcal 1x was 0.5 sim s per real s; now (main) 0.3057 (true speed; a round ~39 min real). The camera's real-time
constants: LEAD_AIR [10, 34, 48] and LEAD_SHIP [5, 16, 24] real s before a climax, the brace LEAD [1.2, 9], the climax
insert window 1.5-7 s, the hold 3.5 s, TAIL 12 s, MAXB 16 s, the guard window 1-8 s, the run lock 24 s: all real s by design
(a shot's length is a viewer's attention, not sim action), converted from sim s through camFinder's measured rate (now
seeded from WW.time.base) or sim2real (WW.time.base). Sim-time constants: HORIZON 75 sim s (150 real s at 0.5, 245 at 0.31),
EV_MAX 40 sim s. One real-time constant broke at the slower clock: FALL_MAX 14 s no longer covered a fall from a dive's
height, so the fall shot is now held to the water (FALL_CAP 32 s).

## Results
Same 6 rounds (standard + carrier_duel seeds 1-3, 700 sim s, the true-speed clock), main vs camera6
(raw: scratchpad camera6/audit/raw_i_base, raw_i_new2):
| metric | main | camera6 |
|---|---|---|
| CV-BE (carrier hit / deck / magazine / sinking in frame) | 100% of 24 | 100% of 24 |
| BB-BE (battleship hit / sinking in frame) | 58% of 40 | **93%** of 40 |
| M3 the oracle's top action on screen (top-3) | 43% (56%) | **49%** (61%) |
| dead air | 10% | 8% |
| cuts / min (recuts / min) | 6.4 (0.98) | 6.6 (1.17) |
| arc completeness / time in arcs | 57% / 77% | 55% / 68% |
| dives: target in frame / bomber in frame / side-on / flat / flips / impact in frame | 99% / 44% / 9% / 0% / 2 / 100% | 100% / **91%** / 18% / 3% / 0 / 100% |

On main before the true-speed clock (0.5 sim s per real s), 27 rounds of standard / carrier_duel / midway, the same rounds
compared: CV-BE 94% (91 / 97) -> 98% (94 / 96), BB-BE 80% (85 / 106) -> 91% (97 / 107).

Broad survey of camera6 at the true-speed clock (one pass at the end): standard / carrier_duel / midway seeds 1-12 at 1x
(36 rounds): CV-BE 97% of 152, BB-BE 91% of 184, M3 46% (57%), dead air 7%, 6.6 cuts / min, dives 105: target 99%,
bomber 81%, impact in frame 99%. battle_line, night, night_cv, night_bl, dusk, carrier_duel_dusk, midway_dusk, odd,
pt_raid, sub_raid seeds 1-4 at 1x (40 rounds): CV-BE 100% of 42, BB-BE 93% of 405, M3 64%, dead air 3%, 6.1 cuts / min.
The main three seeds 1-4 at 4x (12): CV-BE 91% of 43, BB-BE 91% of 56, 8.2 cuts / min. The others seeds 1-2 at 4x (20):
CV-BE 100% of 27, BB-BE 88% of 130. (The dive-chase and dive-cue changes came after the broad pass; the dive numbers above
are from the 6-round re-run.)

camera_cases: 18 / 18 pass. `npm run test:camera` (the 7 quick cases + 2 rounds at 4x): ~4 min, PASS.
Left: the 4x main rounds' CV-BE (91%: at 4x a carrier hit 8 real s ahead is 2 sim s ahead, short for a cut and a pose);
the remaining battleship misses are mostly two battleships trading salvos (a brace on one, the other's hit behind it or out
of frame); side-on frames in the push-over (the bomber still level as the camera already looks down the line to the ship).
