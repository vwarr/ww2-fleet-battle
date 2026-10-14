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
