# Fable audit: AI, pathing, knowledge and interaction (wave 1)

An independent read of every AI module (ships_ai, ai_surface, ai_carrier, ai_light, ai_pt, ai_endgame, ai_charge,
ai_threat, fleet_cmd, fleet_groups, fleet_formation, fleet_search, admirals, intel, endgame, main; aircraft, air_ops,
air_boss, air_cap, air_strikes, air_attack, air_cag, air_staff, air_search, air_scouts, air_patrol, air_flyingboats,
air_dogfight, air_intercept, air_strafe, air_recovery; island_base, base_ai, land_air; night_ops, daylight, combat_aa)
against two bars: fun to watch (no "why did it do THAT?") and 1942 doctrine. No gameplay code is changed on this
branch. Numbers come from `tests/fable_probe.js` (a read-only recorder: 56 rounds, node runner, seeds 1-20 standard,
1-10 carrier_duel / midway / surface, 1-6 asw; `node tests/fable_probe.js --seeds 20 --workers 2`), from
`docs/airdiag/endgame_survey_output.txt` (424 rounds) and from `tests/shape_probe.js` on single seeds.

Ranking: fun impact x frequency, the "silly" ones first. Owner tags: a running agent whose scope covers the fix
(→ planes2 / basebattle / sanity / airend / endgame); untagged findings have no owner yet.

Severity: **S1** a viewer sees it in most rounds and it reads as nonsense; **S2** seen in a minority of rounds, or
subtle but a real doctrine / knowledge error; **S3** rare or cosmetic.

## Summary table

| id | severity | area | finding | owner |
|---|---|---|---|---|
| F1 | S1 | ships movement | destroyers cannot reach their own torpedo launch distance against a carrier (and the USN barely against a battleship): they shuttle in and out at 108-125 u for minutes | ships (none running) |
| F2 | S1 | ships / sub AI | a submarine must surface after 45-65 s under water, whatever is overhead: it pops up beside the destroyer hunting it and dies | none |
| F3 | S2 | fleet command | posture changes 4.6 x per side-round on a fogged strength ratio (47% of rounds 'engage' on stale contacts); target thrash A→B→A in 50% of rounds | none |
| F4 | S1 | plane AI / strikes | the strike leader's redirect sends a 24-plane deck load onto a screen destroyer, against the strike doctrine the commander just applied | → airend (strike sizing) / planes2 |
| F5 | S2 | intel / knowledge | the commander and the targeting read the TRUE hp, speed and alive state of every enemy ship ever sighted | none |
| F6 | S1 | ships movement | PT boats spin in circles (27% of rounds) at their lurk spot and on picket | → sanity S8 |
| F7 | S2 | endgame / ships | a lone destroyer and an enemy carrier stare at each other for 3 minutes (carrier_duel): CV_KEEP, `packed()` and `fairGame` all say "don't" | → endgame |
| F8 | S2 | ships / rescue | a USN destroyer lies stopped alongside survivors while dive bombers attack | none |
| F9 | S2 | carrier | a carrier runs from a single destroyer 210 u away even with a battleship and two destroyers in its ring, and the whole ring wheels with it | none |
| F10 | S2 | fleet command | a carrier task force sends ONE destroyer (of two) on a lone sortie across the map against the enemy's screen | none |
| F11 | S2 | endgame | a cripple of an unbroken side parks 60 u off its own map edge for the rest of the round (hulks afloat 13%) | → endgame |
| F12 | S2 | odd fleets | 2 PT boats vs a battleship + cruiser: twelve minutes of nothing (pt_vs_bb 11 / 12 time endings) | → endgame |
| F13 | S3 | fleet command | the air boss and the commander read the round clock (`B.timeLeft`) to decide strikes and the press | none |
| F14 | S2 | ships movement | the AA-cover rule pulls cruisers out of the battle line to a point 80 u on the raid side of the carrier and back when the raid passes | → sanity S6 / ships |
| F15 | S2 | fleet command | the "withdraw" posture of an unbroken side changes nothing a viewer can see: the ships keep fighting at 1.15 x their range; 'retire' captions with no break in 13% of rounds | none (with F3) |
| F16 | S1 | endgame | a side whose carrier sank cannot break off before the fleets have "met": a lone destroyer steams at a task force for 5 minutes (carrier_duel 23) | → endgame |
| F17 | S1 | carrier / fleet command | a PT boat counts as a gun ship: the carrier flees it, cannot turn into the wind, and its deck load is sent at it (13% of standard rounds) | none |
| F18 | S1 | intel / fleet command | the island base as the only contact switches the search off and aims the fleet at the island (78% of rounds have a side in this state, 84 s a round) | → basebattle |
| F19 | S2 | ships movement | the battle line deploys broadside across a lone destroyer (29% of rounds) | none |
| F20 | S1 | ships movement | the carrier's ring destroyer leaves it (> 150) to hunt a submarine in 30 / 30 standard rounds, 95 s a round | none |

## Findings

### F1. Destroyers cannot reach their own torpedo launch distance (S1, ships movement)

**What a viewer sees.** A destroyer "attacking" an enemy carrier runs in from the flank, turns away at ~108-125 u,
comes round, runs in again, turns away; it never fires. The carrier is at 5.6 u/s, the destroyer at 7.5, so this
can go on for minutes (it is the `U:carrier, U:destroyer, I:destroyer` standoff of the endgame survey, carrier_duel 23
at t 407 for 188 s, and the 35% "standoff in the last third" there).

**The rule.** `ai_surface.js:189-202 torpedoRun()`: the launch distance is `L = range x (0.6 + 0.3 x doctrine.torpedo)`
and the run turns away inside `minD = max(0.8 L, secondaries + 8, CV_KEEP 108 for a carrier that is not fair game)`.
The spread itself is fired by `torpedoes()` (`ai_surface.js:213-218`) only at `d < range x k`, the same `L`.

- USN destroyer: torpedo range 100 x 0.95 = 95 (`core.js TORPEDO_NATION.USN.ship.rangeK`), torpedo emphasis 0.35 (±10%
  jitter), so `L` = 66-68. Against a carrier `minD` = 108: the run can never get inside 68. Against a battleship
  `minD` = max(53, 60 + 8) = 68 ≥ `L`: only a ship that overshoots the turn-away by a unit fires.
- IJN destroyer: range 140, emphasis 0.8, `L` = 114-121, `minD` vs a carrier 108: a 6-13 u window, but
  `keepOffCarriers()` (`ai_surface.js:350-359`) blends the heading away from the carrier inside 108 x 1.15 = 124 with
  weight 1.5 (6 inside 108), so the boat hovers at ~124, above the window.
- `fairGame()` lifts CV_KEEP only in posture `pursue` (`ai_endgame.js:108-119`), i.e. after the enemy is already
  broken. A crippled carrier (`cripReach`, `ships_ai.js:107-112`, the Hornet / Hiei case the comment cites) still
  gets CV_KEEP, so the solo "finish the cripple" run can't fire either.

**Measured.** (probe `ddcv`, 56 rounds: seconds a destroyer spends 90-140 u from an enemy carrier that is its target,
tubes loaded, no pursuit; and ship torpedo spreads by launcher > target) — see the numbers block at the end of this
file. In the 3-round smoke run: 0 spreads by any destroyer at a carrier, 24 IJN and 16 USN destroyer spreads at
destroyers, 4 IJN destroyer spreads at battleships, 0 USN. Balance pass 2 recorded IJN 21.8 ship torpedoes a round
against USN 6.5 and spent two levers on it; this geometry is the cause of the USN half.

**Why it breaks fun and doctrine.** The destroyer torpedo attack on a carrier IS 1942 destroyer doctrine
(Hammann / Hiryu's screen, the Samar charge); a run that turns away short of its own launch point reads as a bug, and
it leaves the fleets in the "standoff" tail the user complains about. CV_KEEP was written so that a battleship or
cruiser does not corner a carrier it cannot catch; a destroyer is faster than the carrier.

**Fix (smallest).** In `torpedoRun()`: `minD = max(0.8 L, sec.range + 8)` only (drop CV_KEEP for a destroyer with
torpedoes loaded, or for any ship whose `vmax` beats the carrier's), and `L = max(L, minD + 8)` so a launch window
always exists; `keepOffCarriers()` should skip a destroyer on a torpedo run (`a.runOut`, tubes loaded). For the USN
the emphasis-scaled launch distance should floor at `sec.range + 15` (the Mk 15 was fired from 4-6 kyd = 70-100 u).

### F2. A submarine surfaces on a timer, next to the destroyer hunting it (S1, sub AI)

**What a viewer sees.** A submarine that just fired at a cruiser, with a destroyer running in over it, surfaces
under the destroyer's guns and is shot to pieces within seconds.

**The rule.** `ai_light.js:8` `SUB_MAX_DIVE = 45`, `SUB_SURFACE = 25`, `SUB_HUNTED = 20`: after 45 s submerged
(65 s if a destroyer is inside 90) `a.forcedT = 25` and `ship.wantSurface = true` (`ai_light.js:136-146`) whatever
is overhead ("air and batteries run out"). The only exception is the scuttle at < 35% hp (line 177).

**Measured.** probe `subup`: in the smoke run 2 forced surfacings, both with an enemy gun ship within 120 (a
destroyer at 12 u, a battleship at 85), one boat sunk 2 s after it came up. Full numbers at the end.

**Doctrine.** A 1942 fleet boat stayed down 24-36 h on the battery; "air" was never the limit of a dive measured in
minutes. The current numbers model a 45 s dive on the ship clock (x3.2 = ~2.5 min of 1942 time), which is wrong by
two orders of magnitude, and the forced surfacing is the single most "why did it do THAT" moment the sub AI
produces.

**Fix.** Make the dive limit a battery, not air: ~360-480 s (one to two "hours" on the round clock) at full
submerged speed, far longer at `SILENT_THR`; never surface with a known gun ship inside `DIVE_SHIP` (80) or a plane
inside `DIVE_AIR`, and let a boat out of battery creep away at silent speed instead. Keep the scuttle. The 25 s
surfaced recharge can stay for the "sub on the surface" moments but only when nothing is in sight.

### F3. The commander's posture flickers on a fogged strength ratio; the admiral's captions follow (S1, fleet command)

**What a viewer sees.** "Adm. Fletcher: retire west and save the carriers" … 20 s later "Adm. Fletcher: engage" …
"make for the enemy" … "retire west" again, while the ships do much the same thing throughout.

**The rule.** `fleet_cmd.js:107-116` recomputes the posture every 2 s tick from `B.strength.ratio`
(`fleet_cmd.js:76-85`): `known` sums the POWER of the enemy contacts weighted by contact age (`w = max(0.3,
1 - age / 90)`). The moment the enemy drops out of sight the ratio climbs (`known` falls to 0.3 x), `withdraw`
(`ratio < withdrawRatio 0.4-0.45`) turns into `approach` / `engage`, the enemy is re-sighted and it drops back. Only the
broken `withdraw` (`B.brokenAt`) is latched; `press` / `withdraw` by ratio and `engage` / `approach` by `dmin < 260`
(line 116: the nearest contact of any age up to 180 s) have no dwell time and no hysteresis. `admirals.js:168-174`
emits a 'retire' / 'press' / 'pursue' order (BIG_GAP 60 s) or a 'posture' caption (POSTURE_GAP 20 s) on every change.

**Downstream effects of each flip.** `formHold` and `ringHold` are off in press / pursue / withdraw
(`ai_surface.js:130, 141`): the battle line stops keeping station and every ship manoeuvres alone, then re-forms;
`prefRange` x 0.72-0.87 in press, x 1.15 in withdraw (`ai_surface.js:151-152`); the formation guide's lead jumps
between +45, +30, +35 and -45 (`fleet_groups.js:170`); PT pickets form or dissolve (`ai_pt.js:42`); the zigzag plan
stops in press (`fleet_formation.js:161`).

**Measured.** probe `posture`: 11.3 transitions per round in the smoke run (3 rounds); full counts of A→B→A
reversals through withdraw / press within 30 s, time in a non-broken `withdraw`, and 'retire' captions without a
break are in the numbers block.

**Fix.** A minimum dwell per posture (30 s) and hysteresis on the ratio (enter withdraw below 0.4, leave above 0.6);
score `known` from the hp seen at the last sighting, held at full weight until the contact expires (an admiral does
not forget a battleship because the scout lost it); make 'engage' vs 'approach' a function of fresh contacts only.

### F4. The strike leader's redirect undoes the commander's strike doctrine (S1, plane AI)

**What a viewer sees.** 24 SBDs and TBDs arrive where the carrier was reported, see a destroyer of its screen, and
the whole deck load dives on the destroyer while the carrier steams on 150 u away behind it.

**The rule.** `fleet_cmd.js:248-270` (balance pass, Oct 2026): no deck-load strike is ORDERED on a destroyer or PT
boat while a carrier, battleship or cruiser is known afloat (`SMALL`, `bigFoe`). But once the wave is up,
`air_cag.js:76-85 waveTick()` redirects it after 3 s without a sighting of its target inside ARRIVE 140 (or at once
inside SEARCH_R 60) to `carrierNear()` (contacts ≤ 5 s fresh only) else `airOps.pickTarget({ near: R })`, which has
no SMALL rule: VALUE destroyer 20 plus `crip x 260` beats nothing, so a damaged destroyer in sight wins. The same
`pickTarget` serves `cag.retarget()` for every plane whose target is lost (`aircraft.js:139-144`) and
`homeward()` (`air_ops.js:204-212`). With a scout report error of `reportErr 0.07-0.09 x range` (intel.js:111-124)
a carrier reported from 200 u away is plotted ~15-25 u off, more with `misId`; planes see ships at 100
(`intel.R.AIR`), so the screen (ahead of the carrier by `cvStandoff` 200-230) comes into view first and the carrier
often does not.

**Measured.** probe `redir`: strike redirects by the new target's type while a bigger enemy ship is still known
afloat (smoke run: 2 redirects, 1 of them onto a destroyer with a carrier known). Full numbers at the end.
ARCHITECTURE's balance pass measured 35-40% of all drops on destroyers and PT pickets before the SMALL rule; the
redirect is the path that remains.

**Fix.** Give `pickTarget({ near })` the same SMALL rule when the wave's original target was a capital ship
(a destroyer only as a target of last resort, after a search leg: the CAG should fly the carrier's reported
course for 30-45 s — `aimAt()` already dead-reckons it — before settling for the screen), and prefer a
redirect to a ship of the ORIGINAL target's type. Let the first wave to find nothing report back so the
commander's next order uses the corrected plot.

### F5. Decisions read the true state of enemy ships the side cannot see (S2, intel / knowledge)

Every AI scan goes through `WW.intel` for POSITIONS, but the contact object holds `unit`, and the code reads the live
unit's hp, speed, alive and sinking flags:

- `fleet_cmd.js:166-170 foeBroken()`: every enemy gun ship EVER seen is remembered in `B.foeSeen`; the enemy is judged
  broken from the current `u.alive / u.sinking / u.hp` of all of them. A battleship seen once at t=40 and torpedoed by a
  submarine at t=400 out of everyone's sight counts as lost the instant it drops under 35% hp: posture `pursue`,
  "chase them down", the PURSUE_STRIKE_R strikes, the escape-route search, all on knowledge nobody on that side has.
  `bigFoe()` (line 249-254), `airWar()`'s "won" test (line 157) and `fitCV(enemy, B)` (line 187-195, the air-cover
  break) do the same with carriers.
- `ships_ai.js:98` score: `finish = ... + 0.8 x (1 - o.hp / o.maxHp) + (o.dmgCrit ? 0.1 : 0)`; `fleet_cmd.js:232` focus
  `(1.8 - u.hp / u.maxHp)`; `fleet_cmd.js:271` strikes `(1.6 - 0.6 x u.hp / u.maxHp)`; `air_ops.js:68-69` pickTarget
  `crip x 120-260`: a ship hit by a bomb nobody on this side saw land is "the cripple" at once.
- `ai_pt.js:158` opportunity: `u.hp`, `u.speed` (instantaneous), `ai_light.js:89` ambush `u.hp`, `u.stats.speed`.
- `ai_endgame.js:22, 110` `isCripple(u)` / `fairGame` read `speedK` and hp.
- `endgame.js:120` scuttle reads the enemy's `vmax` (fine: it is the enemy's class), `air_cag.js:98` `escorting()` reads
  `u.foe` (fine: visible behaviour).

The user's rule is "units acting on knowledge they shouldn't have". None of this is visible as a single silly
moment; it shows as pursuits and strike priorities that are too well informed, and it makes the fog of war partly
cosmetic. **Fix.** Snapshot `hpSeen`, `speedSeen`, `fires` on the contact in `intel.sight()` (a listing, smoking ship
is what a lookout reports), score and judge from those; a ship not seen for SHIP_TTL is "fit, position unknown"; a
sinking is known when the sinking is in sight (or by the enemy's own radio: a later feature). `foeBroken` then
becomes an estimate, which is the realistic part of a pursuit.

### F6. PT boats spin in circles (S1, ships movement) → sanity S8

The endgame survey flags "spinning ship (> 720 deg in 30 s)" in 114 / 424 rounds, all of them PT boats (standard 31 of
40, every PT scenario). probe `ptspin` (smoke run): 13 windows in one standard round, states lurk 10 / out 2 / gun 1,
at 6-10 u/s, mostly FAR from the lurk spot (d 146-524) — so it is not only the arrival orbit.

**The rules.** (a) `ai_pt.js:311-327`: at the spot the boat runs a 'back' leg away from the enemy's centre for 8 s at
throttle 0.9 and a 'fwd' leg to the spot, the arrival test `d < 8` with a turning radius of v / turn = 11 / 1.2 = 9.2 u
at full speed (`core.js` pt speed 11, turn 1.2): a 'hot' boat (throttle 1) cannot get inside 8 and orbits the spot
until the 25 s timer flips the leg. (b) On picket (`picketSpot()`, line 46-61) the spot is recomputed every 4 s from
the nearest enemy contact's last position, the pair index and a danger step-out, and `lurkSpot()` is also called every
4 s (line 289); `bestHeading(risk 0.1)` then samples 16 headings with danger and edge penalties: the wanted heading
jumps from tick to tick and the boat turns continuously. (c) `sweep()` clamps the helm to 1.1 rad but not the rate of
change of the order.

**Fix.** Arrival radius ≥ 1.5 x the turning radius (or slow to 0.5 inside 25 u); hold a lurk / picket spot for ≥ 20 s
unless it is hot (`danger > DG`); on picket, fly a racetrack along the enemy's bearing instead of chasing a point;
smooth `desiredHeading` (max 0.3 rad/s of change) for PT boats outside a run. (Measured mechanism split: see the
numbers block, `ptspin` by state / spot motion.)

### F7. A lone destroyer and an enemy carrier stare at each other (S2, endgame) → endgame

carrier_duel 23 (survey: standoff 188 s from t 407, `U:carrier, U:destroyer, I:destroyer`) and the 20 / 40 carrier_duel
standoffs. Three rules agree that nothing may happen: `ships_ai.js:89-91` gives a destroyer a carrier or battleship as
target only `packed()` (another own destroyer within 150) — a last destroyer never targets the carrier at all unless
the carrier is a cripple AND the side pursues; `fairGame()` needs posture `pursue`; pursue needs `beaten()`, and one
destroyer of two is 50% of the gun tonnage, above BREAK 15% and OUT_SHARE 35%. So a lone destroyer with a loaded
torpedo battery escorts its carrier at 300-600 u from an enemy carrier whose own last destroyer does the same. With
F1 fixed the pair case fires; the lone case needs `packed()` relaxed when the enemy has no other gun ship in sight
(a single destroyer against an unescorted carrier was exactly Hammann's / Kagero's job). Tag → endgame (standoffs).

### F8. A rescuing destroyer lies stopped under a dive-bomber attack (S2, ships / rescue)

`endgame.js:53-59 canRescue()` refuses only a fresh enemy GUN ship in range (`engaged()`) and a danger field
(`WW.threat.danger`, surface channel) above 12 dps; the air channel is not consulted, and `assign()` (line 66) only
releases a rescuer that becomes `engaged`. `ai_endgame.js:95-103 rescueSteer()` then holds throttle 0.03 alongside for
PICKUP_T 10 s. probe `rescue`: 19 s in one of 3 rounds with armed enemy bombers inside 150 of a stopped rescuer. 1942
destroyers did stop for survivors under air attack (Hammann at Yorktown — and was torpedoed for it), but a captain
with dive bombers in the wheel overhead got under way. **Fix.** `canRescue` / `assign` also require no armed enemy
bomber within ~150 of the task (and `B.airRaid` clear); a rescuer under attack goes to full speed and comes back.
Overlaps sanity S7.

### F9. The carrier runs from one destroyer 210 u away, ring and all (S2, carrier)

`ai_carrier.js:29, 33-50`: every known enemy gun ship inside `max(FLEE_MIN 210, 1.5 x its gun range + 50)` (x 1.5 in
the dark) pulls the carrier away at throttle 1, destroyers included (comment: "a destroyer (fast) is run from as soon
as it is seen"). The USN ring (`fleet_formation.js ringKeep`, live stations) turns with it. So an enemy destroyer
picket at 200 u sends a carrier with a battleship, a cruiser and two destroyers in its ring off its station at full
speed, and the air war's "hold anchor" (`holdAnchor`, 5 L ahead of the carriers' centroid) moves with it, dragging
the battle line too. probe `cvflee`: time a carrier spends fleeing by the nearest gun ship's type and range (numbers
block). **Fix.** Weigh the threat by what the ring can handle: a destroyer inside the ring's reach with a fit own
escort between it and the carrier is the escorts' business (`ai_charge.js` already sends them); flee at 210 only
from a cruiser or battleship, from a destroyer at ~1.2 x its gun range (85-100).

### F10. The carrier task force's lone sortie (S2, fleet command)

`fleet_groups.js:242-273`: with no battle line, screen or flotilla the carrier's escorts "sortie toward the enemy as a
surface group … one per carrier stays while there is another to go": `keep = min(ncv, n - 1)`. In carrier_duel
(1 CV + 2 DD a side) that is ONE destroyer sent alone across 1,500 u at the freshest enemy contact, into two
destroyers and a carrier's AA, with no formation (role 'sortie', `followStation` to a point). The user's "suicidal
charges" and "a lone ship charging overwhelming force" (sanity S9). **Fix.** Sortie only as a group of ≥ 2 (keep the
carrier with one DD only when 3+ escorts exist), or let the carrier close with its whole group (it was the air war's
hold that kept the fleets apart; after it the carrier can follow at `cvStandoff`).

### F11. Cripples park on the map edge (S2, endgame) → endgame

`ai_surface.js:322-346 crippleHome()`: a ship under 35% hp whose side is NOT broken runs for a point 60 u inside its
own edge (behind its carrier if it has one) and, once there (`hd < 30`), holds at throttle 0.5 turning away from any
known enemy. It stays there, guns answering, for the rest of the round; the survey's "hulk afloat at the end" (13%,
standard 17 / 40) is largely these. A broken side leaves the map (`ai_endgame.js retreat`); an unbroken side's cripple
cannot. 1942: a cripple was sent home (off the map) with or without an escort. **Fix.** Let an unbroken side's cripple
escape over its edge too (`escapeEdge`), counted as "retired damaged", once no own fit ship is within ~200 (it is out
of the fight either way); a USN destroyer may escort it (`escortFor` already exists). Tag → endgame (hulks).

### F12. PT boats vs a battleship: nothing happens for 12 minutes (S2, odd fleets) → endgame

pt_vs_bb: 11 / 12 time endings at 720 s, dead air ≥ 120 s in 8 / 12. `ai_pt.js:150-170 opportunity()` needs a
target that is isolated (no other gun ship within 75), crippled, slow or near land AND a run of ≤ 130 with path danger
≤ 9 dps from ships other than the target; a BB + CA pair 40 u apart is never "isolated" and the BB's secondaries plus
the cruiser put > 9 dps on every run. The battleship side sees nothing (a PT is seen at 75 x 1 = 75 u; the PT lurks in
cover) and `pressContact()` ignores PT boats for big ships (`ai_surface.js:234`), so it never hunts them either. Both
sides are "right" and the round is empty. **Fix.** At night (`nightOps.subUp()`-style: daylight < 0.3) and in the last
third, a PT pair with nothing better attacks the biggest target in reach regardless of isolation (the Guadalcanal PT
attacks on Tanaka's destroyers were exactly that); the big-ship side with no other contact sweeps its PT contacts' last
known positions with the cruiser (`pressContact` should take PT boats for a cruiser with secondaries).

### F13. The AI reads the round clock (S3, fleet command)

`air_boss.js:167` "it could not get there before the end" (`SB.timeLeft`), `air_boss.js:93, 102` the pursuit reserve
released "in the last LATE_T s of the round", `fleet_cmd.js:27, 89, 115` `LATE = 0.55 x ROUND_TIMEOUT` to press,
`air_scouts.js:208` and `air_patrol.js:175` stop flying before the deadline. Harmless to watch, but "knowledge they
shouldn't have": the admiral knows when the screensaver round ends. **Fix (optional).** Express the late-round press
as the sun (dusk rounds: "press before dark", `D.level(roundT + 120)`), and the pursuit reserve release on the enemy's
state only; let the last strike fly and be cut by the round end.

### F14. The AA-cover rule drags cruisers out of the line (S2, ships movement) → sanity S6 / ships

`ai_surface.js:257-273 aaCover()`: while the commander reports an air raid on a carrier (`B.airRaid`: an armed enemy
bomber within RAID_R 130 of it, `fleet_cmd.js:138-145`), every cruiser (and the carrier group's battleship) within
300 that has no target inside its own gun range steams at full speed for a point 80 u out on the raid side, and
back when the raid passes; a two-wave strike toggles it twice. A cruiser of the battle line 250 u from the carrier
leaves the line (the line's guide keeps going) and rejoins 90 s later, in the middle of the surface approach. The
intent (the Atlanta-class AA cruisers with the carriers) is right; the trigger is too wide. **Fix.** Only ring /
escort-role ships and ships inside ~120 of the carrier answer; a line ship stays in the line (`GUIDED` roles exempt).

### F15. "Withdraw" without a break is a caption, not a behaviour (S2, fleet command)

The ratio `withdraw` of `fleet_cmd.js:114` (after `metT`, ratio < 0.4-0.45) changes: `prefRange` x 1.15
(`ai_surface.js:152`), `formHold` / `ringHold` off, the guide's lead -45 (`fleet_groups.js:170`), the carrier band
(`CV_LO..CV_HI`), and the admiral says "retire". The ships with a target in range keep engaging it (`surfaceRole`
line 103 `engage()`), orbiting at 1.15 x their preferred range: the fleet does not retire; it circles the enemy a
little wider. The viewer hears "make smoke and retire" and watches a gun duel. A broken side (`brokenAt`) is the only
one that leaves. **Fix.** Make a ratio withdraw a real disengagement (steer for the home edge with the guide, fight
only what closes, break contact for 60 s, then re-evaluate) or stop captioning it as a retirement ("Adm.: open the
range"). Pairs with F3.

### F16. A side that has lost its carrier cannot break off until the fleets have "met" (S1 in carrier rounds, endgame) → endgame

**Seen** (`POS=1 node tests/shape_probe.js carrier_duel 23 30`): the IJN carrier is sunk at t≈300 and one of its two
destroyers at t≈180. From 300 to 594 the last IJN destroyer, alone, with no air cover, holds posture `engage` /
`approach` and makes for the USN task force (carrier, two destroyers, ~70 planes); 11 USN bombers attack it at
t 390-420 and miss; the USN destroyers never get a gun on it (distance 164-278 for 200 s: a stern chase at equal speed,
7.5 u/s each); the first shell between the fleets falls at t 594, only then does the air-cover rule break the IJN
and the USN `pursue` (kill at 699). Five minutes of a destroyer steaming at a fleet it cannot hurt, under bombs.

**The rules.** `fleet_cmd.js:199-204 beaten()`: the "outfought" and the "air cover lost" breaks apply only once
`WW.game.metT !== null` (the first shell between fleet ships, `main.js:207-210`), a rule written so that a side is
not broken by the air war alone and the fleets still meet (balance pass). One destroyer of two is 50% of the
tonnage, above BREAK 15%. So the lone survivor's commander stays in `engage` (`fleet_cmd.js:116`, `dmin < 260`) and
the ship's `engage()` steers an intercept on a target of its own speed (`ai_surface.js:174`, `lead()` with
`ship.stats.speed`), which for equal speeds is a point it never reaches.

**Fix.** "Met" should also count a side whose carrier was sunk by air (`metT` or `foeCV` sunk and the side's own
carriers all gone): Nagumo's screen did not steam at TF 16 after the four carriers went; or let `beaten()` take
`bare` without `metT` when the side's fit gun tonnage is a single destroyer / under ~20% of the enemy's seen tonnage.
And the stern-chase: a pursuer that cannot close at its own speed should be given the carrier's strikes (it was:
they missed) and give up the chase; the quarry should run (F15).

### F17. A PT boat is a "gun ship" to the carrier: it flees it, won't turn into the wind, and sends its deck load at it (S1, carrier / fleet command)

**The rules.** A PT boat has a gun (`core.js` pt `guns: [{ cal: 'mg', range: 35 }]`), so every "known enemy gun
ship" test that reads `u.stats.guns.length` includes it:
- `ai_carrier.js:39-47 fleeFrom()`: flee radius `max(FLEE_MIN 210, 1.5 x 35 + 50)` = 210 — a carrier runs at
  throttle 1 from a PT boat 200 u away; and line 42 `cvWary` (any gun ship inside WIND_SAFE 320) blocks the turn into
  the wind for launches and recoveries (line 89-90) for 10 s after each sighting.
- `fleet_cmd.js:214 defend()`: a PT boat inside DEFEND_R 280 of the carrier is the carrier's "defend" enemy:
  `assignment()` x 2.5 for every own ship within 380, and `strikes()` `dfd = 3` (line 268): the whole deck load goes
  for the PT (`SMALL` is bypassed when `dfd > 1`). ARCHITECTURE notes "bombs on PTs 74 per 200 gate rounds".
- `fleet_groups.js:157-167 cvSafe()`: the carrier's station slides 1.9 x 35 + 20 = 87 away from it.
- Meanwhile the PT pickets (`ai_pt.js:46-61`) are told to shadow the nearest enemy big ship from 0.85 x their own
  sighting range (a carrier: 240 x 0.55 x 0.85 = 112 u): the picket sits exactly where it triggers all of the above.

**What a viewer sees.** During the air war a carrier with a picket boat in sight runs at full speed away from a
24 m boat, cannot launch (no wind turn), and its next strike dives on the boat. (twin probe detectors `ptFlee`,
`ptDefend`: numbers block.) **Fix.** Define "gun ship" for these tests as battleship / cruiser / destroyer (a
`GUNSHIP` table exists in fleet_cmd.js already); a PT boat is a torpedo threat inside ~80 (its torpedo range 70),
handled by the escorts' guns and the carrier's own secondaries, not by the fleet's posture.

### F18. The island base as the only contact turns the search off and aims the fleet at the island (S2, intel / fleet command) → basebattle

The enemy's base is always on the chart (`island_base.js:271 scan()`: `sight(base, base, 'visual')` every tick), so
for the side facing it `WW.intel.enemyShips()` is never empty and the contact is always fresh: `fleet_cmd.js:109`
(`!cs.length` → 'search') never fires; `fleet_search.js:33` `B.contactT = rt` every tick → `searchFor` stays 0, no
sweep, no `ptDeep`, no barrier; `air_search.js:208` `srchWant` (posture 'search' or `searchFor > 45`) is never true:
NO carrier search flights are launched by a side facing an enemy base until something else finds the enemy fleet;
`fleet_cmd.js:81-86` `enemyCentre` is the base (weight 1): the axis of advance (`B.axis.h`, line 123) and the whole
surface force point at the island; `strength.known` carries `base.power`. The dawn flying-boat patrol usually finds
the fleet anyway, which hides this; when it does not (it is shot down, or the far side's boat), the side steams at
the island with its search planes aboard. **Fix.** Exclude `isBase` contacts from `cs.length`, `contactT`,
`enemyCentre` and the strength ratio (the base gets its own objective in `base_ai.js` already).

### F19. The battle line deploys across a lone destroyer (S2, ships movement)

`fleet_formation.js:233-255 battleAim()`: with a known enemy gun ship within 1.5 x the line's main-battery range
(255 for a battleship line) the guide stops steaming at the enemy and turns across its bearing at the doctrine's
preferred range (0.84 x 170 = 143), "crossing the T"; BIGG (battleship / cruiser) first, else ANY gun ship, destroyer
included. A single destroyer picket 250 u ahead therefore makes two battleships and two cruisers turn broadside and
hold 143 u from a ship whose guns reach 70 and which is faster than they are; `formHold` (`ai_surface.js:135`)
keeps every line ship on station while `d > pref x 0.5`. The line crawls sideways after a destroyer instead of
advancing. (twin probe `lineOnDD`.) **Fix.** Deploy only for a battleship / cruiser contact; a destroyer alone is
the screen's business, the line keeps closing (its secondaries answer).

### F20. The carrier's only escort leaves it to chase a submarine (S2, ships movement)

`ai_surface.js:86`: a destroyer in role `escort` hunts a known sub out to 2 x SUB_HUNT = 200 (`aswRole`) and at any
range when it has no surface target, and the hunt comes before `ringHold`. In carrier_duel / midway the one or two
ring destroyers run 200+ u off to a datum (then sit on it: `datumDone`) while the carrier steams on alone; the sub
contact may be a scout's 30 s old report. (twin probe `ringAway`.) **Fix.** A ring escort hunts only inside the
ring's reach (~100) or when a torpedo track has been seen; otherwise it reports the datum and keeps station
(1942 carrier screens did not detach their last destroyer).

## Contradictions between modules (checked, for the record)

- Strike doctrine SMALL (fleet_cmd) vs the CAG's redirect / retarget / homeward (air_cag, air_ops): F4.
- CV_KEEP (ai_surface) vs the destroyer's launch distance (ai_surface torpedoes, core TORPEDO_NATION): F1.
- `endgame.canRescue` (surface danger only) vs the air raid picture (fleet_cmd.airRaid): F8.
- `ai_carrier` flee (any gun ship at 210) vs `ai_charge` (the escorts charge the same ship) vs `ringKeep` (the ring
  follows the fleeing carrier): F9 — three modules answer one destroyer three ways at once.
- Night / dusk thresholds: carriers stop launching at daylight 0.5 (`daylight.js FLY_MIN`), the island base at 0.53
  (`land_air.js:73`), flying boats at 0.5 (`air_flyingboats.js:262`), star shells below 0.4, searchlights below 0.3,
  subs attack surfaced below 0.3: consistent enough, but the base's 0.53 is a stray number (→ basebattle).
- `fleet_cmd` `dmin < ENGAGE_D` uses contacts up to 180 s old; `battleAim` (fleet_formation) uses ≤ 20 s;
  `pressContact` ≤ 60 s; `pursueContact` ≤ 120 s: four freshness windows for "the enemy is there".

## Checked and found sound (no finding)

Torpedo combing only from a seen drop / wake with the real turn time (`ships_ai.js comb / canComb`); the destroyer
depth-charge run (locked fix, sonar lost under the bow); the carrier's edge-pinned run; `fireSpread` friendly-fire
check along the fan; the PT `ghost` memory of lost battleships; the IJN `overhead` / USN `picket` CAP split and the
vector-at-visual-range rule (`air_cap.js ENGAGE 130`); the join-from-the-stack rule; the anvil's bow balancing and
land checks; the CAG's AA detour and the staff's IP / dogleg routing; the air-war hold ending in the dark; the
Catalina's landing rules; the island alarm by intel only; the admiral's confusion freezing orders (realistic: the
formation steams on its last course).

## Numbers block (tests/fable_probe.js, 102 rounds)

`node tests/fable_probe.js --seeds 20 --workers 2` (node runner, light mode): standard x30, midway / ijnbase /
carrier_duel / battle_line / surface x12, pt_vs_bb / asw x6; 180 s. "rounds" = rounds in which the detector fired at
all; "per round" = the total over all 102 rounds / 102 (seconds for time detectors, counts for events).

| detector (finding) | rounds | per round | worst scenarios | example |
|---|---|---|---|---|
| baseOnlyNoSearch: the island base is the side's only contact and it is not searching (F18) | 80 (78%) | 84 s | midway 174 s/rd, carrier_duel 169, pt_vs_bb 210 | standard 2 t0 USN 'approach', searchFor 0 |
| baseOnlyLate: the same after t 60 (F18) | 40 (39%) | 59 s | midway 139 s/rd, carrier_duel 134 | standard 12 t200 IJN 'engage' |
| carrier search sorties per round (F18) | - | standard 2.9, midway 3.6, carrier_duel 6.2 (vs the base: ~half) | | |
| ringAway: a ring escort > 150 from its carrier on a sub hunt (F20) | 30 (29%) | 28 s (standard 30/30, 95 s/rd) | standard | standard 1 t90 Woodworth 156 from Enterprise |
| smallDrop: a bomb / torpedo on a DD or PT while an enemy CV / BB / CA is afloat and seen ≤ 120 s (F4) | 56 (55%) | 8.0 | standard 16/rd, midway 12 | standard 2 t560 IJN dive on DD Chevalier, cruiser Chicago seen 0 s ago |
| redirSmall: ... and the wave's first target was a capital ship (F4) | 24 (24%) | 1.6 | standard 3/rd, ijnbase 4 | standard 1 t492 USN dive on DD Hatsuyuki, first target a carrier |
| thrash: a gun ship's target A→B→A within 10 s, A still fresh (F3 / targeting) | 51 (50%) | 2.5 | standard 7/rd | standard 2 t314 Washington: Haruna → DD Hibiki → Haruna |
| switch: any target change with the old target still fresh | 92 (90%) | 24 | standard 48/rd, surface 38 | |
| staleEngage: posture 'engage' on contacts > 20 s old only (F3) | 48 (47%) | 15 s | standard 42 s/rd | standard 1 t176 IJN |
| posture changes per side-round (F3) | - | 4.6 | | pt_vs_bb 3 USN: s a w s w a w p |
| raidShuttle: a line cruiser steaming to the raided carrier (F14) | 38 (37%) | 6.7 s | standard 13 s/rd, ijnbase 15 | standard 5 t224 Chokai to Akagi from 252 |
| caVsBB: a cruiser duelling a battleship with no own BB within 250 (F10 note / cruiser doctrine) | 33 (32%) | 12.7 s | battle_line 41 s/rd, midway 20 | standard 5 t456 Augusta vs Hiei at 59 u |
| lineOnDD: the battle line deployed across a lone destroyer (F19) | 30 (29%) | 4.7 s | standard 12 s/rd | standard 1 t368 IJN line across DD Chevalier |
| ptSpin: a PT boat turning > 720° in 30 s (F6) | 26 (25%) | 1.8 | pt_vs_bb 6/6 (17/rd), standard 20/30 | standard 5 t176: lurk, 14 from the spot, leg 'back', throttle 0.9, 8.8 u/s |
| loneDD: a destroyer circling a battleship at 0.9-1.6 L waiting for a flotilla mate (F1 / F7) | 23 (23%) | 3.4 s | surface 10/12 (14 s/rd) | standard 4 t388 Fubuki circling Indiana at 164, L 119 |
| subUp: a submarine forced up by the dive clock (F2) | 24 (24%) | 0.4 | standard 24/30 | |
| subUpNear: ... with an enemy gun ship within 120 (F2) | 13 (13%) | 0.2 (18 cases) | standard | standard 2 t402 Grouper up at 14 u from a gun ship after 67 s down; standard 3 t462 Silversides at 12 u |
| rescueRaid: a rescuer stopped with armed enemy bombers within 150 (F8) | 14 (14%) | 2.5 s | standard 5 s/rd | standard 3 t194 Gwin |
| ptDefend: a PT boat in the carrier's defend list (F17) | 13 (13%) | 2.9 s | standard 13/30 (10 s/rd) | standard 4 t162 IJN carrier "defends" against PT-36 at 272 |
| ptFlee: a carrier at throttle 1 with a PT boat as its nearest "gun ship" (F17) | 6 (6%) | 0.7 s | standard | standard 7 t202 Akagi from PT-59 at 222 |
| ratioWd: posture 'withdraw' by the strength ratio, not broken (F15) | 13 (13%) | 29 s | pt_vs_bb 6/6 (450 s/rd!) | midway 5 t346 USN ratio 0.47 |
| ratioWdFighting: ... with own gun ships firing in range (F15) | 5 (5%) | 1.5 s | | midway 5 t346 Vincennes at Nagato |
| retireCap: an admiral 'retire' caption with no break (F15) | 13 (13%) | 0.2 (19) | pt_vs_bb 6/6 | midway 5 t346 Fletcher, ratio 0.47 |
| unseenSink: an enemy gun ship sank with no contact fresher than 10 s, yet counted in foeBroken (F5) | 10 (10%) | 0.1 (12) | | standard 3 t217 North Carolina, last seen 16 s before |
| pursueBlind: a 'pursue' order with no contact fresher than 60 s (F5) | 5 (5%) | 0.1 | carrier_duel 5/12 | carrier_duel 2 t357 IJN, no contact at all |
| cvDance: a destroyer with a carrier target held 100-135 off (F1) | 0 | 0 | | the boats are kept beyond 124 by `keepOffCarriers` and prefer the escorts: see F7 |

Smoke run of the first recorder (3 rounds): ship torpedo spreads by launcher > target: IJN DD > DD 24, IJN CA > DD 16,
USN DD > DD 16, IJN DD > CA 8, IJN CA > BB 8, IJN DD > BB 4, USN DD > BB 0, any DD > carrier 0.

The PT-vs-battleship round (pt_vs_bb): the PT side is in an unbroken 'withdraw' for 450 s of 720 and its admiral
captions 'retire' twice a round, while nothing happens (F12, F15).
