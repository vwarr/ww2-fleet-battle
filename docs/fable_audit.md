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
| F3 | S1 | fleet command | posture flickers every few seconds on a fogged strength ratio; "retire" / "engage" captions chase it | none |
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
| F15 | S2 | fleet command | the "withdraw" posture of an unbroken side changes nothing a viewer can see: the ships keep fighting at 1.15 x their range | none (with F3) |

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

## Numbers block (tests/fable_probe.js, 56 rounds)

(filled in below from the probe's output; see the commit history for the raw run)
