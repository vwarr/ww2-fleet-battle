# Speed and size calibration (speedcal, 2026-10-19)

## Scale (shared with gunnery)

- **Length: 1 u = 9.6 m (`WW.cfg.U_PER_M` = 0.104 u/m).** From `WW.cfg.L` = 26 u for a ~250 m carrier hull
  (ship_classes.js). The map, the ships and the planes use the same metre: an F4F's 11.6 m span is 1.2 u at
  `PLANE_SCALE` 0.41; the plane models are lofted at ~0.245 model units per metre, so 0.245 x 0.41 = 0.100 u/m
  (within 4% of the ships' 0.104). The weapons hung under them (Mk 13 4.1 m, Type 91 5.3 m, AN-M65 1.75 m, the
  Val's 250 kg 1.9 m) come out within 5% of their real sizes.
- **Altitude is not linear:** `y = 0.4 * h_real[m]^0.59` u (core.js `WW.altOf`; 15 m -> 2 u, 600 m -> 18 u,
  4,500 m -> 58 u). Near the sea a game unit of height is ~3x a metre's share of a horizontal unit.
- **The ship clock: `WW.cfg.KN_PER_U` = 32 / 5.6 = 5.714 kn per u/s.** Every sim speed is written on it: a
  carrier's 32 kn is 5.6 u/s; torpedoes and planes use the same clock. So 1 sim s stands for 3.27 s of the real
  battle (9.6 m per u against 2.94 m/s per u/s).
- **Display: `BASE_SPEED` = KN_PER_U x 0.51444 x U_PER_M = 0.3057 sim s per real s (`WW.time.base`): true speed at
  1x** (the user's choice, 2026-10-19). It was 0.5, which showed everything at 1.63x its real speed at 1x (3.27x at
  2x, 6.5x at 4x). A round (`ROUND_TIMEOUT` 720 sim s) is now ~39 min real at 1x (was 24). Display only: the sim's
  steps are the same.
- Gravity: bombs fall at 9.8 u/s^2 sim, i.e. 1.0 g real on the ship clock (9.8 m/s^2 x 3.27^2 / 9.6 m), within 10%.
- Conversions: real kn = sim u/s x 5.714 (= on-screen kn at 1x now); on-screen m/s at 1x = sim u/s x 2.94;
  real s of the battle = sim s x 3.27; real (wall) s at 1x = sim s / 0.3057.

## Audit (before = main 1879870, measured with tests/speed_probe.js, 4 scenarios x 2 seeds)

Speeds are the p50 of the measured ground speed in each flight state, in real knots on the ship clock (sim u/s x
5.714). "Screen 1x" is what the old 0.5 clock showed (x1.63); since the BASE_SPEED change the screen shows the
ship-clock knots. L/s: the thing's own lengths per real second on screen at 1x.

| what | sim u/s | ship-clock kn | old screen 1x kn | real 1942 | verdict / fix |
|---|---|---|---|---|---|
| F4U (USN fighter) transit / patrol | 30 | 171 | 280 | cruise ~180 | ok |
| F4U combat (attack state) | 40 | 229 | 374 | 230-300 in a fight, max 360-390 | ok |
| A6M transit | 33 | 188 | 308 | cruise ~180 | ok |
| A6M combat | 40-43 | 230-248 | 373-405 | max ~290 | ok |
| SBD transit | 27 | 154 | 252 | cruise ~150 | ok |
| SBD dive (3-D, brakes) | 23 | 131 | 215 | 240-250 | slow; kept (see below) |
| D3A transit | 30 | 171 | 280 | cruise 160-180 | ok |
| D3A dive | 23 | 131 | 215 | ~200 | slow; kept |
| TBD transit | 23 | 131 | 215 | cruise 110-128 | +5-15%, ok |
| TBD torpedo run / drop | 17.2 | 98 | 161 | 80-110 | ok |
| B5N transit | 27 | 154 | 252 | cruise 140-160 | ok |
| B5N torpedo run / drop | 21.6 | 123 | 202 | 140-160 | **slow: runK 0.8 -> 0.9 (139 kn)** |
| deck take-off: speed off the bow | ~20 + ship | ~145 | ~235 | ~70-80 airspeed, ~65-75 ground | **2x: run to a real lift-off** |
| deck take-off: run time | ~0.6 s sim | | ~1.3 s real | 6-9 s (~0.25 g) | **run at ~0.25 g, 2.5-3 s sim** |
| climb-out after the bow | 35-37 at once | 200-210 | 330-340 | 90-120, building | **3 u/s^2 gain, not a snap to 0.9x combat** |
| landing: marshal ovals (fighters) | 27-29 | 156-168 | 255-274 | pattern 100-110 | **capped 19 (108 kn)** |
| landing: approach leg (fighters) | 35-37 | 200-215 | 333-350 | ~90-100 | **capped 17 (97 kn)** |
| landing: final (fighters / bombers) | 22-27 / 15.5 | 125-155 / 89 | 200-255 / 145 | ~75 airspeed, closing 40-45 on the deck | **closure 9-14 u/s over the ship (was 10-19)** |
| runway take-off (island base) | to 0.78 x combat at 7 u/s^2 | fighter ~170 | ~280 | 70-80 (fighters), ~100 (B-17 / G4M), ~120 (B-26) | **per-class roll (S 3.5 / M 2.2 / L 1.8 u/s^2) to 13 / 21 / 18 u/s** |
| runway pattern / final (fighters) | 28 / 21.5 | 160 / 123 | 261 / 200 | 90-110 / 75-85 | **legs capped at 1.6 / 1.3 / 1.15 x the class's lift-off speed** |
| B-17 / B-26 / G4M cruise | 24 / 30 / 30 | 137 / 171 / 171 | 224 / 280 / 280 | 160-180 / 190-230 / 170-200 | a little slow, ok |
| PBY / H6K cruise | 22 | 126 | 205 | 110-125 / 120-140 | ok |
| PBY alight / lift-off | 17.6 / 12.6 | 100 / 72 | 164 / 118 | 65-80 | ok-ish |
| scout floatplanes (OS2U / F1M) | 22 | 126 | 205 | 120-130 / 125-160 | ok |
| catapult end speed (rel. to ship) | 18 in 0.2 s | 103 | 168 | 60-70 kn at ~3 g | **CAT_V 11 (63 kn), 0.33 s** |
| Mk 13 aerial | 5.85 | 33 | 55 | 33.5 | ok (since torpedo realism) |
| Type 91 aerial | 7.35 | 42 | 69 | 41-43 | ok |
| Mk 15 destroyer | 7.9 | 45 | 74 | 45 (high speed) / 26.5 | ok |
| Type 93 Long Lance | 8.4 | 48 | 78 | 48-50 / 36 | ok |
| Mk 14 / Type 95 (subs) | 8.05 / 8.6 | 46 / 49 | 75 / 80 | 46 / 49-51 | ok |
| Mk 8 (PT) | 6.3 | 36 | 59 | 36 / 27 | ok |
| carrier | 5.6 (class 5.1-5.9) | 32 | 52 | 32-34 | ok |
| battleship | 4.2 (class to 4.5) | 24-26 | 39-42 | 25-30 | a little slow, ok |
| cruiser | 5.5 | 31-32 | 51 | 32-35 | ok |
| destroyer | 7.5 | 43 | 70 | 35.5-38 | **+18%: 6.5 (37 kn)** |
| PT boat | 11 | 63 | 103 | 40-41 | **+55%, faster than its own torpedo: 7.2 (41 kn)** |
| submarine (surfaced) | 3.5 | 20 | 33 | 20-23 | ok |
| dive-bomb fall | 0.55 s sim from 13-15 u | | 1.1 s real | ~4-5 s from 450-600 m | short: the altitude compression (kept) |
| level bomb fall (B-17) | 3.85 s sim from 74 u | | 7.7 s real | 35-40 s from 7,000 m | short: the altitude compression (kept) |
| aerial torpedo fall | TORP_G 4 u/s^2 | | | 2.5-3.5 s from 30-60 m | ~1-1.5 s sim from the compressed drop height (kept) |
| shells | | | | | gunnery's (briefs/gunnery_arcs.md) |

**The headline.** The sim's speeds were already close to true knots on the ship clock (planes within ~15% in
cruise and combat, torpedoes and big ships at their 1942 speeds). What made everything look fast was the display
clock: BASE_SPEED 0.5 showed the ship clock at 1.63x real at 1x, which true-size planes (2026-10-18) made obvious
(a fighter in a fight crossed ~19 of its own lengths a second against ~12 real). That is now 1:1. The real outliers
on the clock were the deck and runway phases (take-off runs to ~2x a real lift-off speed in a third of the time,
fighters flying the landing pattern at 1.5-2.3x), the catapult (1.7x), the destroyers (+18%) and PT boats (+55%),
and the B5N's drop speed (-15%).

**Kept on purpose.** Dive speed: the brakes hold ~23 u/s (131 kn) against a real 200-250 kn. The dive's height is
compressed ~8x (`WW.altOf`), so at its real speed it would last ~1.3 s sim (4 s real at 1x); at 23 u/s it lasts
~2.5 s sim (8 s real at 1x, longer under the director's slow motion). Raising `brake` toward 35-42 is the lever if a
faster dive is wanted. The bomb and torpedo falls are short for the same reason (the heights are compressed). The
deck cycle is still compressed (a trap every few sim seconds, against 30-40 s real): the final's closure is kept at
9 u/s (51 kn over the deck) at the ramp, a little above a real 40-45 kn.

## Sizes (true metre)

| what | drawn | real | verdict |
|---|---|---|---|
| Mk 13 hung under the TBD | 1.0 x 0.14 model -> 3.9 m x 0.55 m | 4.1 x 0.57 | ok |
| Type 91 under the B5N | 1.3 x 0.11 -> 5.1 x 0.44 | 5.3 x 0.45 | ok |
| AN-M65 1,000 lb under the SBD | 0.43 x 0.116 -> 1.7 x 0.46 | 1.75 x 0.47 | ok |
| Val's 250 kg | 0.46 x 0.08 -> 1.8 x 0.31 | 1.9 x 0.3 | ok |
| 500 lb (level bombers) | 0.36 x 0.084 -> 1.4 x 0.33 | 1.45 x 0.36 | ok |
| dropped bomb / falling torpedo | the hung geometry at the plane's scale | | no size jump at release |
| torpedo in the water (all types) | a 2.0 x 0.3 u box: 19 m x 2.9 m | 4.1-9 m x 0.45-0.61 m | **4-5x: now scaled per type (Mk 13 4.1 m ... Type 93 9 m)** |

## Before / after (main 1879870 vs speedcal; node sim, 6 seeds x standard / carrier_duel / midway)

The BASE_SPEED change is display only, so these shifts come from the sim fixes (deck, pattern, runway, catapult,
DD / PT speed, B5N runK):

| measure | before | after |
|---|---|---|
| round length median (flight_review, 18 rounds) | 576 s | 495 s |
| winners USN / IJN (18 rounds, noisy) | 11 / 7 | 5 / 13 |
| landing pattern time per recovered sortie p50 / p90 | 36 / 114 s | 54 / 168 s |
| carrier sorties recovered (landed) | 1183 | 821 (more end the round airborne: 462 -> 673) |
| strike sorties / drops per carrier round | 75.4 / 38.7 | 64.5 / 35.2 |
| first -> second strike's first drop p50 | 123 s | 102 s |
| USN / IJN dive hit rate (flight_review) | 24 / 16% | 29 / 14% |
| dive bombs hitting a ship (dive_bomb_probe) | 21% | 25% |
| USN / IJN aerial torpedo hit rate (torpedo_review, all) | 24 / 14% | 22 / 26% |
| USN ship torpedo hit rate | 15% | 25% |
| AA share of USN / IJN strike planes shot down | 32 / 10% | 28 / 11% |
| behaviour suite (15 scenarios x 6 seeds) | FAIL 1 (pt_pen_med, mirror) | FAIL 1 (the same check) |

The biggest shift is the deck cycle: the pattern at real speeds makes each recovery ~50% longer, so fewer sorties
come back aboard before the round ends. If that needs to be won back, the levers are `CLOSE` and `GROOVE`
(air_recovery.js: more planes in the groove at once), not the speeds. Side balance is left to the end-of-batch pass.

VQA strips (real 1x timing, fixed camera beside the path, a frame every 0.5 s real): scratchpad
speedcal/strip_before and strip_after (sheet_ots, sheet_ship, sheet_torp, sheet_dive, sheet_takeoff). Before, a
fighter closed ~1 km and passed in ~2 s, and a ship crossed the frame in 1.5 s. After, the same pass takes ~4 s and
a destroyer at 37 kn moves at a ship's pace. The bow waves and wakes (seastreak's) read right at the new speed.
