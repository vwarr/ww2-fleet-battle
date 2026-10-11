# Common-sense audit (branch `sanity`, 2026-10-11)

User: "Even more basic. To make it seem real but not bunching around carriers, not ignoring obvious targets, not
letting bombers through, etc."

`tests/sanity.js` is a read-only recorder (rules in `tests/sanity_rules.js`) that rides every round of the behaviour
suite's scenarios plus the odd fleets (`tests/fuzz.js`). It samples every 0.5 sim s and counts EPISODES: a condition
that holds for the rule's minimum time, one episode per (rule, unit). It changes no gameplay. Rounds replay
bit-identically, so every example below (seed, scenario, t) reproduces with `--plot RULE:k` / `--shot RULE:k`.

    node tests/sanity.js --seeds 30 --workers 2          # the table below (510 rounds, ~13 min)
    JSON=out.json node tests/sanity.js ...; FROM=out.json node tests/sanity.js --plot P1:1

Score = episodes per round x severity (3 = what the user named: bombers let through, obvious targets ignored, guns
silent; 2 = plainly odd; 1 = untidy / doctrine-adjacent; 0 = info). Owners use the coordinator's five areas:
**planes2** = CAP / flight / escort, **basebattle** = base air, **airend** = recovery / marshal / strike sizing,
**endgame** = mop-up / night / finishing, **ships** = ship AI (formation, AA fire control and evasion included).

## Ranked table (30 seeds x 17 scenarios = 510 rounds incl. 60 odd fleets; `node tests/sanity.js --seeds 30`)

| rank | rule | sev | ep / round | s / round | rounds hit | score | owner |
|---|---|---|---|---|---|---|---|
| 1 | S2 AA on a departing / distant plane while an unengaged attacker closes | 2 | 9.59 | 6.4 | 65% | 19.18 | ships (combat_aa.js) |
| 2 | P1L raider nobody goes for, outside the doctrine long leash | 1 | 17.40 | 94.2 | 38% | 17.40 | planes2 (doctrine call) |
| 3 | P1 seen raider inbound, nobody on it, a fighter could reach it | 3 | 4.92 | 25.5 | 27% | 14.76 | planes2 (+ basebattle at midway) |
| 4 | P3 CAP chasing a fighter while a reachable raider drops | 3 | 3.55 | 16.6 | 33% | 10.65 | planes2 |
| 5 | P7f past bingo fuel, not heading home | 1 | 4.56 | 120.6 | 50% | 4.56 | planes2 |
| 6 | P9 through enemy heavy flak with no business there | 1 | 4.43 | 18.0 | 43% | 4.43 | planes2 |
| 7 | S8c ship circling in place, enemy known within 600 u | 1 | 4.05 | 35.0 | 60% | 4.05 | ships (endgame for the late cases) |
| 8 | S5 carrier with no escort within 150 u | 2 | 1.67 | 184.3 | 60% | 3.33 | ships (fleet_formation) |
| 9 | S7 holding course under a dive / torpedo-plane run | 2 | 1.29 | 9.1 | 51% | 2.58 | ships |
| 10 | P6c non-CAP plane circling | 1 | 2.26 | 5.8 | 37% | 2.26 | planes2 / airend |
| 11 | P2 idle CAP while a reachable raider is under-covered | 2 | 0.99 | 7.7 | 20% | 1.97 | planes2 |
| 12 | P8 escort > 80 u from its bombers while they are attacked | 2 | 0.62 | 4.0 | 13% | 1.24 | planes2 |
| 13 | P10b CAP > leash2 + 100 u from home, nothing to chase | 1 | 1.22 | 10.2 | 27% | 1.22 | planes2 |
| 14 | S3 friendly ships closer than 1.2 hull lengths | 1 | 1.21 | 8.2 | 43% | 1.21 | ships |
| 15 | P10 off the map | 1 | 0.89 | 5.3 | 16% | 0.89 | planes2 |
| 16 | P4b CAP on the far side of the carrier from the raid | 2 | 0.42 | 3.1 | 19% | 0.84 | planes2 |
| 17 | S10 damaged ship steaming at the enemy, away from friends | 2 | 0.36 | 7.9 | 20% | 0.71 | ships |
| 18 | P5 armed bomber passing a far better target | 2 | 0.30 | 1.6 | 7% | 0.60 | planes2 |
| 19 | P4 > 4 idle planes within 50 u of their carrier | 2 | 0.23 | 1.6 | 15% | 0.47 | planes2 / airend |
| 20 | P5b bomber not closing on its seen target | 2 | 0.23 | 0.6 | 8% | 0.46 | planes2 |
| 21 | S9 lone ship charging a > 3x force | 2 | 0.12 | 1.9 | 9% | 0.23 | ships |
| 22 | S1 guns silent, seen enemy in range and arc | 3 | 0.07 | 0.8 | 6% | 0.22 | ships |
| 23-26 | S6 0.15, S7t 0.05, S8 0.02, P7 0.02 ep / round | | | | | < 0.2 | ships / planes2 |
| 0 | S4 / S4c carrier inside or closing on BB / CA gun range, P6 bomber with no task, P8b escort not fighting the attacker | | 0 | | 0% | 0 | none |
| info | P1u (raider not on the plot) 82 / round, P6h (deck holding near home) 1.64, S3r (ring escort close) 1.07, P10s (scouts off map) 0.27, P4f (form-up orbit) 0.13 | 0 | | | | | intel / airend / ships |

Denominators: 18,771 seen armed raiders inbound (drop < 45 s): **13% of them had nobody on them while a fighter could
reach them** (P1). 361,906 AA shots, 55,389 of them with an armed bomber closing inside the battery's reach: **14% of
those were at a departing / distant plane while no mount was on the attacker** (S2).

Where it happens (episodes per round): the carrier scenarios carry the air rules (P1: midway 20.4, weather 15.7,
standard 12.8, carrier_duel 7.5); S8c is a night / dusk / standard matter (night 11.1, dusk 11.6, standard 10.5); S2
peaks in mirror / standard / weather (22-27). Night rounds have no air rules hit (no flying after dark: airdiag).

## Top 10: root cause, code location, owner

Examples are (seed[s = sides swapped] scenario t=start duration). Plots: `tests/shots/sanity/<rule>_<k>.png`, made with
`FROM=<json> node tests/sanity.js --plot RULE:k` (bold = the units named; USN solid, IJN dashed; colour = flight state).

1. **S2, AA on the wrong plane (ships: combat_aa.js).** Light AA takes the NEAREST detected plane in its altitude
   band, with no threat weighting: `combat_aa.js:283-289` (`if (dd < bd && detected(s, p2)) { bd = dd; lt = p2; }`).
   Heavy AA does weight it (`combat_aa.js:275`: fighters x1.7, ordnance x0.8). So a fighter that has just strafed
   and is pulling away at 63 u takes the whole light battery while a dive bomber closes at 66 u. Example: seed 5
   battle_line t=423 19 s. Fix direction: give light AA the same score as heavy (armed and closing first; departing
   x2), or split mounts between the two. Owner: ships (fire control; airdefense if that branch still owns combat_aa).
2. **P1L, raiders outside the long leash (planes2, doctrine).** USN pickets have leash2 420 and IJN overhead loops
   205 (`air_cap.js:23-24`). Raiders are left alone until they cross it, mostly dive bombers on a carrier 36 s out.
   Example: seed 28 carrier_duel t=213 35 s (IJN overhead CAP, US dive bombers). Severity 1: this is the doctrine
   working as designed. If the user wants raiders met farther out, raise the IJN leash2 (205 is tight).
3. **P1, a raider nobody goes for (planes2).** In 247 of 494 examples the best-placed "able" fighter was chasing an
   enemy FIGHTER that was not on its tail. In 109 it was chasing an EMPTY bomber (59 dive bombers that had already
   dropped, 25 torpedo planes, 14 scouts). In 124 it was on patrol with no vector. Causes:
   (a) `air_dogfight.js:294`: `pick()` keeps a committed foe while `s.lock > 0` (LOCK 5-7 s, `air_dogfight.js:17`),
   and `air_intercept.js:26` re-arms lock >= 1.5 s on every pass. A fighter that started on a bomber stays on it after
   the drop, with an armed torpedo plane 1 s away (seed 30 carrier_duel t=239 17 s, `P1_1.png`: U:fighter#p21
   circles a spent torpedo plane while three armed ones run in on U:carrier#4).
   (b) `air_cap.js:76-95` `raidFor()` has no claim count for armed raiders. Only snoopers use `chasing()`, so every
   picket section scores the same best raider and the rest go unvectored. capPick's `claimed() * 70` spread
   (`air_ops.js:120`) works only inside ENGAGE (130 u, `inReach`).
   (c) the inner picket section only takes raiders within 150 u of the carrier (`air_cap.js:85`, `inner ? 150`).
   Midway (20.4 / round) has twice the standard rate. Most victims are USN ships with the island base's fighters on
   the same side, so basebattle should check the base CAP's vectoring there too.
4. **P3, the fighter-on-fighter trap (planes2).** Same lock: `air_dogfight.js:294` returns `cur` while lock > 0. The
   armed-bomber priority is applied only on a fresh scan (`capPick` pr 220-400 vs a fighter's 100-140,
   `air_ops.js:116-121`), so it never pre-empts a running dogfight. Example: seed 30 standard t=223.5 21 s:
   U:fighter#p112 chases I:fighter#p101 while I:torpedo#p90 runs in on U:carrier#1, 4 s away (`P3_1.png`). Fix
   direction: let pick() drop a fighter foe that is not on our tail when an armed raider with drop < 25 s is within
   reach (the brief's 1942 rule: the CAP goes for the bombers).
5. **P7f, no bingo fuel (planes2).** `aircraft.js:167-168` burns fuel only in transit / attack and turns home only
   at fuel 0. The way home is free, so nobody ditches, but escorts and dogfighters fight long past the point where
   they could get home. The planners already budget the way home (`air_cag.js:48,142`, `air_boss.js:262`,
   `air_ops.js:208`), so the airframe disagrees with them. Example: seed 19 weather t=142.5: U:fighter#p59 in a
   dogfight with 56 s of fuel and 54 s from home, for 61 s. Not visible on screen. Fix direction: return at
   fuel < home / cruise + margin, and burn fuel on the way home.
6. **P9, needless flak (planes2).** What's left are escorts and strike fighters orbiting over an enemy BB / CA that
   is neither their target nor near it, while other strikes wheel there. Example: seed 23 standard t=182 20.5 s:
   three US escorts bound for I:carrier#12 circle over I:battleship#13, 244 u from their target (`P9_1.png`). Route
   cost: `air_staff.js` already avoids flak on the way OUT. The escort's own orbit while waiting for or after its
   strike (`air_cag.js:235` `escort()`) has no flak term.
7. **S8c, ships circling in place (ships / endgame).** Probe of seed 4 night t=350-405 (I:cruiser#14,
   role=escort, group=carrier, posture engage): speed falls to 0 every ~25 s and the desired heading sits 90-180 deg
   off the actual heading. The ship overruns its ring station and turns back round, which points at the ring
   station-keeping, `fleet_formation.js:171` `ringKeep()`, when its carrier is slow. The late cases (t > 600, e.g.
   seed 3 carrier_vs_surface t=643.5 75 s, `S8c_1.png`: two cruisers shuttling back and forth) overlap airdiag's
   "standoff in the last third" (35% of rounds, docs/airdiag/endgame_survey_output.txt): endgame.
8. **S5, carrier left without escort (ships: fleet_formation).** `fleet_formation.js:28-33` `ringCounts()` gives the
   ring at least one DD, but the escorts are pulled off by other roles (the screen / flotilla run ahead of the main
   body, `fleet_formation.js:11`). With few ships afloat the carrier can steam alone for minutes. Example: seed 23
   pt_raid t=186.5: I:carrier#4 nearest escort 173 u for 534 s with 6 escorts afloat; seed 11 carrier_duel t=287.5:
   260 u for 433 s (`S5_2.png`).
9. **S7, no evasion from bombers (ships).** Ship AI has no manoeuvre against a dive or torpedo-plane run. The only
   reactions are combing a torpedo already in the water (`ships_ai.js:282` `comb()`) and the anti-sub zigzag
   (`fleet_formation.js:158`). In 1942 a ship under dive-bomber attack put her rudder hard over as the bombers
   tipped over. Example: seed 3 weather t=460.5: I:battleship#14 holds 0 deg for 18.5 s under a US dive (`S7_2.png`,
   with the bombers' wheel overhead). S7t (torpedo tracks) is nearly clean once `canComb` is respected (0.05 / round).
10. **P6c, planes circling with no purpose (planes2 / airend).** 2.26 / round, after removing attack runs, top
    cover and deck holding. What's left: (a) returning planes circling more than 200 u from home: the airdiag
    marshal / recovery area, airend. (b) Escorts orbiting near their own carrier while their strike forms up (seed
    29s mirror t=199: U:fighter#p80, target the base 634 u away, 134 u from its carrier: the form-up orbit,
    `air_strikes.js`; airend strike sizing / form-up). (c) Escorts left orbiting over a target after their bombers
    have gone (`air_cag.js:235`: no "strike done, go home"): planes2.

Also worth routing (below the top 10): **P10**, torpedo planes orbiting OFF the map in the anvil setup (seed 19
weather t=530: two IJN torpedo planes 106 s at x=-82, `P10_1.png`). The anvil set-up point at SET_R 140 around a
target near the edge is not clamped to the map (`air_attack.js:26`, approach `:194-214`): planes2. **P2** (idle CAP
83 u from a carrier while a dive bomber 7 s away is under-covered, seed 16 weather t=293.5): same `raidFor`
band / inner-section filters as P1 (b-c). **P8** (escorts 170-350 u from their torpedo planes while US fighters
attack them, seed 15 midway t=117.5): the escort had its own fighter foe and `pick()` keeps it
(`air_dogfight.js:289-294`), planes2.


## False-positive pass (what changed in the rules after looking at the worst cases)

Each change came from a plot or probe of a longest example that turned out not to be a blunder:

| rule | false positive seen | change |
|---|---|---|
| S2 | 95% of "departing" hits were the NEAREST plane (light AA takes the nearest) while other mounts were on the attacker | counts only if no mount of the ship fired at the closing attacker in the last 2 s |
| P1 | 248 / 433 "able" fighters were dogfighting; some had an enemy on their tail. Stacked fighters with too little fuel to join (air_cap JOIN_FUEL 22 s) were counted too | fighters with an enemy on their tail and stacked fighters below the join terms are not counted as able |
| P6c | `P6c_4` (old run): the 60 s window held the bomber's own attack run. `P6c_1` / `P6c_2`: escorts orbiting over their strike's wheel, including after a retarget | no attack run in the window; an escort within 150 u of an armed or attacking bomber of its strike is skipped; a returning plane within 200 u of home is P6h (deck holding, info: airend / docs/airdiag) |
| P9 | `P9_1` (old run): a CAP fighter on its loop over its own fleet, with an enemy cruiser inside the fleet. `P9_1` (new): an escort following its bombers to a new target | skips CAP when the flak ship is inside the carrier's CAP leash, and escorts with their bombers |
| P4 | `P4_1`: 16 IJN fighters FIGHTING a raid over their carrier counted as "bunching" | planes with a foe are not counted |
| S7t | the torpedo-track cases were mostly ships that `ships_ai.js canComb` judges too late to turn (holding course is the designed answer) | counts only ships that could have combed |
| P7f | the sim burns fuel only on the way out (`aircraft.js:167-168`: return at fuel 0, the way home is free); nobody ditches | severity 2 -> 1, described as a realism matter |
| all | the unswapped `mirror` round is the same round as `standard` (same seed, same fleet): it was counted twice | deduplicated in `specsFor` |

Tool fix found while doing this: `--plot` labelled every plane it recorded. The rules number planes lazily (first
mention), so a plane first seen inside the plot window could get a different number than in the survey: the first
`P3_1` showed the "chased" fighter 2,000 u away. The plot now labels planes after the replay, using only the
survey's numbering (`__san.labelIf`). Counts were never affected. Earlier plane plots were redrawn.

## Light version in the suite (`tests/sim_behaviour.js`)

`san_p1`, `san_p3`, `san_p4`, `san_s1`, `san_s2` and `san_s7` ride the behaviour rounds as WARN checks. They have no
`levelIn`, so they cannot FAIL by construction.

## Verification (Step 3)

- `node tests/sim_behaviour.js --workers 2` (default scenarios, 8 seeds): exit 0, **no FAIL**. The `san_*` WARNs
  that fire: carrier rounds `san_p1` 0.27, `san_p3` 1.6-10 per round, `san_s7` 2.1-2.3 (dusk / weather / standard).
  `san_s1`, `san_s2` and `san_p4` pass everywhere. They are WARN with no `levelIn`, so they never become FAILs.
- `node tests/determinism.js 1 200`: PASS (identical traces, hash 817920f3d05d).
- `node tests/determinism.js --cross 1 200` (render, browser, node): PASS, identical. The auditor is read-only (no
  WW.rand, no fields written on game objects, WeakMaps only), so rounds are bit-identical with and without it.
- The 100-round balance gate was not run: no gameplay code changed on this branch.
- Survey wall time: 774 s for 510 rounds on 2 workers when the lock is free.

## Plots looked at (tests/shots/sanity/)

`S2_1` (bold units mostly out of frame; the detail line carries it), `P1_1` (fighter circling a spent torpedo plane
while three armed ones run in), `P3_1`, `P7f_3`, `P9_1` (escorts orbiting a battleship that is not their target),
`S8c_1` (two cruisers shuttling in place late in the round), `S5_2` (a carrier steaming alone), `S7_2` (a battleship
holding course under a dive wheel), `P6c_1`, `P2_1`, `P10_1` (torpedo planes orbiting off the map edge). Earlier
false positives (looked at, then rules fixed): the old `P6c_1` / `P6c_4`, `P9_1` and `P4_1` described above.
