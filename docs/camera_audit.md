# Director camera audit (camera3, 2026-10-11)

User: "make it so the camera is always on the best action at any moment. Currently, there'll be estimates like
'torpedos from [squadron] in 15 seconds' and then not only does it not fire, but the torpedo often misses and the
camera gets off of it. It doesn't seem like the camera should go off something while it's attacking. I'd also like to
see the camera on ships in combat sometimes or even the base if it's the center of the action." Plus the addendum: the
right ANGLE for each kind of action (M6).

## Method: tests/camera_audit.js

Render mode (the full game in headless Chrome, swiftshader), a fake 30 fps frame clock, no pixels drawn: the
director, story mode, finder, follow label, captions and hand-offs run every frame exactly as in the game. The sim
runs at the game's pace (0.5 sim s per real s). Scenarios: `standard` (random fleets), `carrier_duel` (CV + 2 DD
each), `midway` (USN CV CA 2 DD + the Midway base vs IJN 2 CV BB CA 2 DD), `battle_line` (2 BB 2 CA each), `night`,
`dusk` (time of day forced), `odd` (CV vs 10 PT, 3 CV vs 2 BB 2 CA, 8 DD vs 1 BB, 4 BB vs 4 BB), seeds 1 to 6, 600
sim s (20 real min) or the round's end: 42 rounds, 43,696 camera seconds, 4,182 shots. The camera's own dice
(`Math.random`) are seeded per round, so a round replays and `--sheet SCEN:SEED:from:to` re-renders a window of it as
a contact sheet (ImageMagick montage) under tests/shots/camera_audit/sheets/.

Every real second it logs: the shot (kind, story sub-kind and phase, hand-off stage, subject, its target), the finder's
top items, the follow label's promise ("... in ~15 s"), the ORACLE's top actions and whether the camera is on each, and
the angle quality (subject and target in frame, occlusion by land / a hull / the sea, the sun in the lens, which side
of the line of action). Events: every plane drop and impact with the shot at that instant, every torpedo run start and
abort, every dive, every caption, sinkings, magazines, deck hits, base events, kills.

The oracle (independent of camera_finder.js; frozen, the Phase 2 director score is built from the game's own
signals, not from it): torpedo run 6-8 (+ target value), dive 7.5+, torpedoes in the water crossing a hull 6.5-8.3,
sinking 8-8.8 (its first 12 sim s), magazine / deck hit 9, a ship just hit 5.5-8, a gun duel with shells in the air
3.5-6.5 (+1 with hits), straddled 4-6, burning 4+, the base bombarded 7 / raided 6.5-7.5 / alarm 5, dogfight 3-4.
"On camera" = the shot's subject / target / torpedo target is the action's ship or plane, or its position projects
inside the frame within 240 u (320 u for the base).

Metrics (`--summarize` on the raw JSON; tests/shots/camera_audit/summary_raw_<tag>.md):
- M1 promise kept: label-seconds whose ETA event (the drop, the dive, the fighters closing to 20 u, the torpedo
  impact) happens within ±5 s of the promised time ("within ~N s" counts one-sided).
- M2 attack continuity: of the drops the camera was on (the plane the subject in the 6 s before, or at the drop),
  the share where the same coverage held through the release and 2 s past the result.
- M3 best-action coverage: of the seconds with an oracle action ≥ 3, the share with the camera on the top-1 / top-3.
- M4 variety: screen time by subject class (plane / ship / ship_combat (an oracle action ≥ 4 on it) / base /
  overview), shot length p10/p50/p90, cuts per minute.
- M5 dead air: the share of time on nothing (or a lesser subject) while an action ≥ 6 ran elsewhere.
- M6 angle: subject in frame, target in frame (overall and IN THE ATTACK: run / anvil / dive / gun duel), occlusion,
  into the sun (the sun within ~40° of the view axis by day), line of action (cuts that flip sides; in-shot crossings),
  snap frames (> 1.2 rad/s, cut frames excluded), view rate p90.

## Baseline (before), 42 rounds

| | all | standard | carrier_duel | midway | battle_line | dusk | night | odd |
|---|---|---|---|---|---|---|---|---|
| M1 promise kept | **25%** of 9098 | 25% | 29% | 27% | 26% | 10% | – | 22% |
| … by kind | strike 18%, anvil 34%, push 25%, bandits 20% | | | | | | | |
| … happened at all (ETA + 60 s) | 68% | 65% | 72% | 72% | 78% | 64% | – | 61% |
| M2 attack continuity | **40%** of 187 filmed drops | 32% | 42% | 41% | 62% | 26% | – | 56% |
| M3 top-1 / top-3 | **36% / 52%** | 27 / 43 | 34 / 47 | 31 / 44 | 47 / 67 | 41 / 59 | 40 / 62 | 34 / 51 |
| M4 plane / ship / ship_combat / base / overview | 43 / 37 / 15 / **0** / 4 | 69/17/12/0/1 | 74/22/3/0/2 | 67/19/11/1/2 | 39/35/21/1/5 | 28/44/24/0/4 | 1/70/21/0/8 | 38/47/8/0/7 |
| M4 shot length p50, cuts/min | 10.9 s, 5.7 | 9.0, 6.5 | 8.7, 6.8 | 8.7, 6.8 | 12.0, 5.3 | 12.5, 5.2 | 13.4, 4.7 | 11.4, 5.4 |
| M5 dead air | **9%** (4151 s) | 17% | 10% | 10% | 6% | 9% | 7% | 7% |
| M6 target in frame in the attack | dive **9%**, anvil 28%, run 51%, gun duel 27% | | | | | | | |
| M6 occluded / into the sun | 1% (hulls) / 8% | | | | | | | |
| M6 line of action, snaps | in-shot crossings 17% of shots; snaps 2.7/min | | | | | | | |

Big events on camera (within the event, sinkings within their 17 real s): sinkings 185 / 245 (carrier 10/13,
battleship 38/48, cruiser 26/35, destroyer 69/92, PT 28/38, sub 14/19; lag p50 3 s, p90 15 s), kills 265 / 1322,
base alarm 3 / 28, bombardment 12 / 32, air raid on the base 3 / 17, scramble 3 / 30, deck hit 3 / 8.

Sim timings that shape the fixes (real seconds): torpedo drop → impact p10/p50/p90/max 13 / 28 / 35 / 41 (air
torpedoes run at 8 (USN) / 10 (IJN) u per sim s, dropped at 82-100 u, range 140); anvil set-up → run p10/p50/p90/max
11 / 39 / 55 / 149; run → drop p50 7.6, p90 11.7; 61 of 414 runs abort without a drop (15%); bomb drop → impact p50
1.2 s. Sinking lasts 8.5 sim s = 17 real s.

## Ranked problems

### P1. The camera leaves an attack it is filming (M2 40%; 112 of 187 filmed drops cut)
Classification of the 112 failures (tests/camera_audit.js raw, before):
1. **36: the torpedo hand-off ends before the torpedo arrives.** camera_action.js `onDrop` sets `dur: shot.t + 14`
   (real s) for the torpedo stage, but a torpedo takes 13-41 s (p50 28) to hit or run out. The camera leaves the wake
   mid-run (26 misses, 10 hits). The user's "the torpedo often misses and the camera gets off of it" is exactly this.
2. **22: the miss hold is too short.** `HOLD_MISS = 1.3` s on an empty splash; the next cut comes before the 2 s beat.
3. **14: the story's dive cut-away returns to the leader before the release.** camera_story.js `pick()` makes the dive
   shot 9 s long (`dur: 9`, `nohand`); a dive from the roll to the release takes 6-12 s, so the shot expires 1-4 s
   before the bomb goes, the story returns to its torpedo leader (`water` / `chase`) and the drop and splash are never
   seen. `nohand` also forbids the bomb hand-off on that shot.
4. **~25: a wingman's drop is not handed off.** `onDrop` hands off only when the dropping plane IS the shot's subject
   (`ev.plane === shot.subj`, or `shot.plane` / an orbit on the target for bombs). On a story shot the subject is the
   leader; the wingmen drop in frame 1-3 s apart and nothing follows them (story high 6, story ots 6, water 4, chase 4,
   director orbit 8, chase 4, flyby 1).
5. **Story cuts in the attack**: camera_story.js line 339 cuts a shot older than 2.5 s on every phase change (run →
   out, dive → pull), line 349 switches to a better imminent strike elsewhere, line 353 cuts away for a sinking, and the
   shot `dur` (10-14 s in the attack) simply expires. 5 cases cut 0-3 s before the release. The `attack` menu holds a
   `high` wide shot (weight 1) in which the drops are 100+ u away: 6 drops filmed from the high shot, none on screen.
6. Nothing in camera.js protects a shot: `update()` ends any shot at `shot.t >= shot.dur` or when `dull(subj)`;
   `baseAlarm` cuts into anything that is not a hand-off stage or a story attack.

### P2. False promises (M1 25%; 32% of promised attacks never happen at all)
The follow label (camera_follow.js `labelText`: "Following VT-6 · … · VT-6 torpedo run on the destroyer in ~5 s") and
the finder's ETAs (camera_finder.js `scan`):
1. **anvil**: `eta = (distance − 55) / speed` assumes a straight run-in, but a torpedo bomber with `sk === 'anvil'` is
   still working round the ship to its set-up point and waiting for its mates (air_attack.js `torp()`): p50 39 s, p90
   55 s of real time. The label reads "~5 s" for 30-40 s. 34% kept.
2. **push**: a fixed `VB_HOLD * 0.4` = 8 sim s while the leader waits in the wheel; the real wait is the distance to
   the push-over point plus the squadron's turn (`g.nextDive`). 25% kept.
3. **bandits**: `(distance − 15) / 12` with no closing speed; 20% kept. The event (guns in range) often never comes:
   the bombers reach the fleet, the fighter is driven off by the escort.
4. **strike**: `(distance − 60) / 20 + 15 while forming`; 18% kept. Strikes slow for the join-up, climb, re-route
   round known raids (planes2), or are redirected / recalled: 32% never arrive within ETA + 60 s.
5. **No outcome captions.** air_captions.js says "VT-6 begins its run" / "VB-6 pushes over" once and nothing after: no
   "torpedo hit" / "missed astern" / "drop aborted, coming round" (15% of runs abort without a drop), no "redirected"
   on the label. The label keeps promising while the plane turns away.
6. The 15 s caption throttle (`GAP`) and the 0.25 s tick mean the "begins its run" caption often shows after the drop.

### P3. The camera is not on the best action (M3 top-1 36%, M5 dead air 9%; base 0% of screen time)
1. **No unified director score.** camera.js `candidates()` ranks by fixed priorities (sinking 10 for `sinkT < 4` only,
   torpedo run 8, dive 7.5, dogfight 6.5, carrier launch 6.5, battleship firing 6, burning 5, cruiser 4.5, destroyer 4,
   transit plane 3, quiet ship 2.6-5) with random noise ±2; the finder's items add `7.5 + drama` (plane) / `8 +
   drama` (torpedoes) via camera_follow.js, base_fx.js adds a raid orbit 7.5. A bombardment of the base is never a
   candidate (only the one-off `baseAlarm` cut, 6-10 s, once a minute). Ships in a gun duel compete at 4-6 against
   every plane in transit with an ace (3 + 5).
2. **Story mode owns the cuts** for 1-3 min and only looks at planes: a strike story in `transit` cuts every other
   shot to a quiet ship (`ships` cut) while a battleship is straddled, a carrier sinks (odd/5: 56 s on a story while a
   carrier sank; standard/6: 52 s) or torpedoes cross a hull (midway/4: 33 s). The cutaway for a sinking is skipped in
   the `attack` phase and waits for the running shot (3 s), at most one per 35 s.
3. **Sinkings**: 60 of 245 never on camera; the director's candidate is live only while `sinkT < 4` (8 real s) and
   only at the next pick (shots run 11-20 s). A carrier going down (10/13 seen) must pre-empt.
4. **The base**: 0% of screen time over 42 rounds, 12 rounds with a base. Bombardment 12/32 on camera, the alarm 3/28,
   the raid 3/17, scrambles 3/30.
5. M3 by scenario: `standard` 27% (planes 69% of the time), `battle_line` 47%.

### P4. Variety (M4): planes 43% overall, 67-74% in the carrier scenarios; ship_combat 15%; base 0%
The quiet-moment ship shots (`shipShots`, 37%) are mostly ships NOT in combat (a low pass at a cruiser steaming) while
the gun duel runs elsewhere; the story's `ships` cutaways (every other transit shot) are low shots of the carrier.
Cuts: 5.7 / min overall, 6.8 in carrier_duel (story mode's 6-12 s shots plus the dive / phase cuts).

### P5. The wrong angle (M6)
1. **Dive: 9% target in frame.** camera_story_shots.js `chase` (also the dive cut-away, `back: 18`) looks 18 u ahead
   of the plane at its own height (`gL = L + f·18, ly − 2`): the plane dives at 60-70° so the deck is far below the
   frame; the user sees sky and a plane's tail. The addendum wants: from above and behind the bomber looking down at
   the deck, or from the ship looking up.
2. **Torpedo run: 51%, anvil 28%.** The director's `chase` (camera.js) and the story `chase` look ahead along the
   heading, not at the ship; `ots` keeps the target but is one of four menu picks; `water` is a fixed spot that the
   planes pass (the target never in frame).
3. **Gun duel: 27%.** `flyby` / `chase` / `orbit` on the firing ship alone; nothing frames both ships or the splashes
   on the target; no cut to the target for the straddle.
4. **Sinking**: the orbit `shipR(0.36) + 4` is fine on deep water, but `keepSane` lifts the camera over shoals and the
   compose rule puts the ship low in a frame full of island (before_carrier_duel_1_396-432 sheet, frames 9-12).
5. Line of action: 17% of shots cross it in-shot (chase / ots of a turning plane: a smooth move, acceptable); flips AT
   a cut: counted from this version on. Occlusion 1% (hulls, 282 s) and the sun 8% are not the problem.
6. Snaps 2.7 / min excluding cuts: the hand-off's `kP 6` and `ots` turn limit are the sources.

### P6. Sim-side findings to route (not fixed here)
- 15% of torpedo runs abort without a drop (`dh < dropR − 30` not lined up, or the ship combed the run): the captions
  and the camera must handle it, but it is also a lot of wasted runs (air_attack.js `run()`).
- Anvil set-up p90 55 s, max 149 s of real time: the strike circles the target for a long time with the label counting
  down; a cap on the wait (`now − p.anT > 16` is per plane, but the group `go` resets) would help the sim too.
- Air torpedoes at 8-10 u/s from 82-100 u: 28 s real p50 in the water. A fine spectacle if the camera stays.
- (Pending the module probe) A visual module changes the sim when it runs per frame: the same seed gives a different
  battle with `crew / water / lifeboats / dmgVis / baseFx / fx / audio` running than without (seen as a different
  sinking time in the replay of carrier_duel/1). `tests/determinism.js --cross` cannot see it: it runs no frames.

## Contact sheets (before)
- tests/shots/camera_audit/sheets/before_carrier_duel_1_396-432.png: a VF-6 story on a dead fighter (`fall`, `high`
  shots of empty sea) while Enterprise burns and sinks; the orbit arrives 6 s into the sinking and then drifts up and
  back over the island (the ship small and low in frame).
- (more after the replay fix: an attack cut mid-way, a bombardment off camera, a dive with the deck out of frame)

## Phase 2 plan (camera only)
1. **Attack lock** (camera.js): a shot gets `lock` once its subject is committed (torpedo `run`, dive `roll` / `dive`,
   a hand-off stage, a gun salvo on a target); while locked nothing ends it (not `dur`, not a story phase change,
   switch or cutaway, not `baseAlarm`), the torpedo stage holds until the impact event (cap 45 s), `HOLD_MISS` 2.2 s,
   the dive cut-away holds to the impact. Pre-emption only by a magazine explosion or a big ship sinking, never inside
   the release window (run with `dh < dropR + 30`, roll / dive, any stage). Hand-offs also from a wingman of the shot's
   group that drops in frame.
2. **Honest labels and captions**: numeric ETAs only where reliable (strike by the wave's own `dT` and speed; run by
   `(dh − dropR) / (speed · runK)`); the anvil shows "sets up on the destroyer's bow" with an upper bound ("within ~40
   s"); the wheel "over the carrier, pushing over next"; fighters "closing on" without a number. Outcome captions for
   the filmed subject ("torpedo hit", "torpedo missed astern", "run aborted, coming round", "bomb misses wide"), the
   label withdrawn when the plane turns away or dies.
3. **Director score** (camera.js): one score per candidate from imminence × drama × damage × novelty across planes,
   ships (a gun duel with straddles / hits, torpedoes at a ship, a ship in trouble, a sinking), the base (bombardment,
   raid, scramble) and the overview, with hysteresis (the running shot keeps a bonus) and an interrupt for a sinking /
   magazine; story mode yields to a bigger event outside its attack.
4. **Angles**: dive = above and behind the diver looking down at the deck (the ship in frame), torpedo run = low beside
   / behind the plane keeping plane and ship in frame, then the wake to the hull; gun duel = a wide two-ship shot from
   behind the firing ship's turrets, cut to the target for the splashes; AA = from the deck looking up; base =
   elevated over the field; sinking = low and wide in profile; orbits stay on one side of the line of action.
