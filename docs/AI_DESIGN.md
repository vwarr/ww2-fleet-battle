# AI design spec: targeting, engagement, allies, enemies, aircraft

Goal (user): World-of-Warships feel. Each type plays its role and avoids fights it can't win. Fog of war matters. The camera stays omniscient and gets sighting shots. Rounds run 10–14 min real time.

## 0. Shared framework (every ship, every plane)

**Knowledge (js/intel.js).** Per-side contact table: `{ unit, lastX, lastZ, lastHeading, lastSpeed, seenAt, quality: visual|radar|sonar|reported }`.
- Visual range by observer type, and by target size: big ships are seen farther. Islands block line of sight. A gun flash enlarges the shooter's visibility for a few seconds (firing gives you away).
- Detection sources: ships, airborne planes and scouts. Destroyer sonar finds submerged subs at short range; periscope or surfaced subs are visual.
- Contacts age. A stale contact is a last-known position (go look), not a firing solution. Shooting needs a current detection (seen within ~3 s) by the shooter's own side. Spotting by an allied plane is enough, at reduced accuracy.
- Every AI enemy scan goes through intel. Physics (hit tests) stays omniscient.

**Threat field.** For any point, `danger(x, z)` = the sum over detected enemies of their weapon reach × damage: big guns, torpedo ranges along the enemy's bow arcs, known sub areas, and the AA umbrella (for planes). Ships pick headings with score = goal pull − danger × role risk tolerance. That's what keeps PT boats from charging battleships and carriers away from gun lines, without special cases.

**Target score** (replaces distance − tonnage):
`score = roleWeight[type] × value × pHit(range, aspect, detection) × finishBonus(damaged) × assignment − exposure(going there)`
- roleWeight: per-type table (below).
- finishBonus: prefer targets that are burning, listing or low HP.
- Assignment: the commander de-duplicates. Each side focuses fire on 1–2 targets per group, but doesn't overkill: if a target's incoming damage is already enough, the next shooter picks another.
- Stickiness: switch only if the new score > old × 1.3, to stop target thrash.
- Per-mount targeting: secondaries and AA pick their own targets (closest threat in their arc), independent of the main battery.

**Engagement stance** per type: kite (hold at the edge of own range, outside the enemy's), brawl, ambush, screen or stand-off. A ship angles to keep all turrets bearing (broadside) when gun-fighting, and angles bow or stern toward an enemy torpedo threat.

**Allies.**
- Formation stations from the commander (main body, screen, carrier group).
- Mutual support: answer a nearby ally under attack (DD to an ally hunted by a sub, CA/BB AA to a carrier under air attack).
- Don't cross the fire line of allied heavy guns. Don't fire torpedoes when an ally is in the spread's path (friendly-fire check along the fan).
- Spacing and deconfliction stay as they are.

**Aircraft awareness (ships).**
- AA priority: a plane in an attack run on self > on a protected ship (the carrier) > closest.
- Evasion: turn parallel to detected torpedo tracks, or toward the drop point of torpedo bombers on a run. Hard rudder under a dive-bomb wheel. Detection of the attack is required, with a reaction delay by ship type (PT and DD fast, BB slow).
- Under an air raid, escorts close on the carrier (AA umbrella). The carrier calls CAP to its own position.

**Morale / withdrawal.** HP < ~30–35%, or flooding, or alone and outgunned → withdraw toward own carrier, own fleet or land cover. A DD lays smoke if available. A withdrawing ship still shoots back but doesn't chase.

**Breaking off and retiring (implemented).** A side whose last battleship, cruiser or destroyer in fighting shape (hp ≥ 35%) is gone is *broken*: its commander goes to `withdraw`, its cripples head home, and its carrier runs for its own edge. Once it has stayed broken for 30 s and every ship it has left (subs aside) is either back in its home waters or out of the enemy's sight for 45 s, the round ends: "<winner> victory / <loser> fleet retires" (`victory` event with `reason: 'retire'`). That gives a decision without hunting a lone carrier for minutes. The stronger side presses late with its gun ships, but not into the enemy carrier's lair or the enemy's home waters. Round ends: kill (annihilation), retire, stall (only subs left), time (tonnage at the cap).

**Commander (js/fleet_cmd.js)**, per side, every ~2 s:
- Posture from known strength ratio × time: search → approach → engage → (withdraw | press). Late round, the stronger side presses for a decision with gun ships. The carrier never presses.
- Assigns: focus targets, screen stations, ASW hunter group, PT ambush spots, strike targets (only on detected or last-known contacts), scout search sectors.
- Doctrine parameters per side per round (aggression, range preference, torpedo emphasis, carrier emphasis, night-torpedo-ish IJN vs carrier/radar USN). These also tune the IJN 7–1 imbalance.

## 1. Per type

### Carrier
- Targets: none with guns except self-defence (its small guns shoot what's close). The real weapon is the air group.
- Engagement: stand-off. Stays behind its screen, upwind for flight ops, far from detected gun ships (keeps danger ~0). Withdraws on any detected surface threat inside ~1.5× the enemy's best gun range. Never charges, even late round.
- Allies: it's the centre of the formation. Escorts hold stations around it. When alone, it runs toward the nearest friendly group.
- Air: keeps a standing CAP (2–4 fighters, rotated on fuel). Launches strikes only on detected targets, picking by value, detection freshness, distance, and the AA around the target. Holds strikes back when its own position is under air attack (fighters first). Recovers planes when they return.

### Battleship
- Targets: enemy battleships and cruisers first, the carrier if reachable, destroyers only when close or nothing else is available. Never wastes main guns on PT boats (secondaries handle them). Submarines are ignored.
- Engagement: kite at 70–90% of main battery range, in the battle line with cruisers. Crosses the T (broadside to the enemy's bow). Turns away from detected torpedo threats. Focus fire with the line.
- Allies: anchors the battle line; covers the carrier group's threat axis.
- Air: strong AA; moves to cover the carrier under air raid if it's in the carrier group.

### Cruiser
- Targets: destroyers and cruisers first (good matchups), battleships only with torpedoes or when focus-firing with the line. Secondaries and guns go after PT boats close in.
- Engagement: kite at mid range. Flanks the battle line. Uses torpedoes on big targets when inside 80% of torpedo range with a clean spread (no allies in the fan).
- Allies: leads destroyer flotillas or screens the carrier. Best AA → the carrier's AA escort under air raid.
- Air: carries the scout floatplane (spots for the line).

### Destroyer
- Role split by the commander: **ASW screen** (ahead of the main body, sweeping), **escort** (carrier ring) and **torpedo flotilla** (2–3 DDs attack together from different angles).
- Targets: submarines first (sonar or sightings) → PT boats near the fleet → enemy destroyers → torpedo runs on capital ships only as a coordinated flotilla attack, never a solo charge into battleship secondaries.
- Engagement:
  - Sub hunt: run to the last-known sub position, sonar sweep, depth-charge pattern, keep hunting the datum for a while after contact is lost.
  - Gun duels: brawl other DDs.
  - Torpedo attack: approach, fire the spread, turn away, lay smoke.
- Allies: defends allies under sub or PT attack. Smoke for cripples.
- Air: light AA; jinks hard under attack.

### Submarine
- Targets: carriers, then battleships, then cruisers; isolated or slow targets preferred. Never targets DDs unless cornered.
- Engagement: ambush. Gets ahead of the target's predicted track (or a choke point between islands), submerges, waits, and fires from the beam at medium range. After firing, goes deep or evades (turn away, slow, submerged). Surfaces only when no enemy is detected nearby; abort surfacing if a DD or aircraft is seen.
- Allies: operates independently on the flank of the enemy's approach.
- Air: dives when planes are detected.

### PT boat
- Targets: targets of opportunity: isolated, crippled or slow ships, transports in a channel, destroyers or cruisers near land. Never a gun fight with BB/CA. Avoids DD screens.
- Engagement: ambush. Lurks near islands or own-fleet flanks (commander assigns ambush spots). Sprint in only when the target is within a short dash and the run is mostly clear (low danger on the path). Fire, break off home at full speed, jinking. Abort if danger on the run spikes (heavy fire, DD turning toward).
- Allies: stays in its own half; never deep in enemy territory. Pairs up (2 PTs attack together from different angles).
- Air: jinks; tiny AA only.

### Fighters
- Home carrier first. CAP orbits over own carrier and engages bombers before fighters: torpedo bombers on a run > dive bombers in the wheel > others > fighters. It only chases out to a leash radius, then returns.
- Escort: close cover stays with the bombers; top cover engages enemy fighters attacking the strike. Breaks off to save a bomber under attack.
- Recall: if own carrier is under air attack and fuel allows, escorts and fighters return to defend.
- Gun fights and dogfight manoeuvres stay as they are (air_dogfight.js is good).

### Dive and torpedo bombers
- Strike target: the commander's choice, using intel (detected or last-known). Retargets to a better or crippled target in the same area if the original is gone or hidden. Avoids flying through heavy AA umbrellas en route (route around the detected AA field).
- Damaged or attacked by fighters with no escort: jettison and RTB. Torpedo bombers keep the anvil; dive bombers keep the wheel.

### Scout floatplanes
- Search sectors assigned by the commander, where contacts are stale or missing. Report contacts into intel. Avoid known CAP.

### Flying boats (implemented: air_flyingboats.js, air_patrol.js; 1942 practice)
- Patrol (USN PBY Catalina, IJN H6K Mavis): from the side's own map edge, one per side early (the Catalina at Midway found the Kido Butai), then one every `doctrine.patrolEvery` s or so. A long search leg on the shared sector claims (air_search.js), then shadow from standoff outside the AA umbrella on the home side, reporting into intel; run from fighters (low, toward home). Big and slow: CAP hunts a shadower out to its long leash (157, as for an inbound raid) when no raid is up. The Mavis shadows closer and longer and may bomb a lone ship once (doctrine `patrolStandoff` / `patrolShadowT` / `patrolBombs`); the IJN had no comparable air-sea rescue.
- Rescue ("Dumbo", USN only): survivors no destroyer is sent to (endgame.js tasks, aircrew first). Lands only out of known gun / AA reach with no enemy fighter near (or with an own fighter overhead); waits, else gives up; takes off at once when threatened.
- Sighting reports (intel.js): air reports carry a position error (range × `doctrine.reportErr`, firming up while the same observer keeps reporting) and a first report may misidentify the type (`doctrine.misId`: a cruiser as a carrier, a destroyer as a cruiser, the Midway "two carriers"). The strike scorers believe the report; a strike on a bad report flies to the wrong spot and its leader redirects on arrival, often onto the escort. Gunnery is unaffected (a real current sighting is still required).
- Measured (sim-only, seeds 1-12, info only, no balance tuning on this branch): per round 0.9 Catalina rescues, ~10 survivors, Catalinas lost 0-0.2, patrols 1 per side, ships reported per patrol USN 3.7 / IJN 1.4, patrol boats lost USN 0-0.2 / IJN 0.1-0.25, misidentifications ~1.6, strikes on bad reports ~0.35. Balance gate seeds 1-100 (100-round runs, SD ~5): all on USN 60 / IJN 39; without patrols 53; without Catalina rescues 59; with exact reports 54; none of it 50. Patrols and imperfect reports each lean USN by a few points; left for the post-merge balance pass (URL switches nopatrol / nodumbo / norep).

## 2. Harness checks (tests/sim_rounds.js additions)
- Carrier closest approach to enemy gun ships ≫ baseline (12–147).
- PT boats: no time spent inside BB/CA main gun range except during a run; never beyond map midline + margin. Torpedo runs per PT and their hit rate.
- DD: sub kills by DDs vs total sub deaths; time to kill a detected sub.
- Fighter time over own carrier vs away; bombers shot down before release.
- Focus fire: average distinct targets per side per minute (should drop); overkill shells.
- First-contact time, round length (median 300–420 s), win split by nation (aim ~50/50 across seeds), end reasons (kill / retire / time; at least ~60% decided before the cap).
- Stuck 0, NaN 0, errors 0.

## 3. Acceptance (user requirement)
Once the AI is implemented, run the behaviour suite (tests/sim_behaviour.js) many times over many fleet combinations: standard random fleets plus targeted matchups. Every desired behaviour in sections 1–2 must show up in the metrics before the work counts as done.

## 4. Balance gate (user requirement)
Over 100 rounds of randomized fleets for both sides, each nation wins 50 ± 5. Noise: a perfectly fair coin has SD = 5 wins over 100 rounds, so the 100-round gate alone fails ~1/3 of the time on noise. So:
- The tuning target is the true win rate, measured with 400+ rounds (SE ≈ 2.5%) plus mirrored-fleet rounds (same composition, sides swapped) to separate nation bias from fleet luck. Aim for 48–52%.
- The 100-round gate: a fixed set of 100 seeds, which must land 45–55 for USN.
- Draws are reported separately; balance is computed on decided rounds and on all rounds.
- Balance levers: per-nation stats (plane stats in core.js PLANE_NATION, AA, torpedo range/speed) and doctrine parameters, not hidden per-nation handicaps in the AI.
- Final tuning (Oct 2026). Diagnosis over 900 rounds (seeds 1-400, 1001-1100, a 400-round mirror) before the change: USN 48.3%, an IJN edge of ~1.7 points, within one SE. Fleet composition decides most rounds (battleships 1v2: USN 12%, 2v1: 89%; carriers 1v2: 30%, 2v1: 65%); every decided round ends by retire, none by annihilation. Air is not the driver: carriers almost never sink (11 of ~2270 fielded), 78% of rounds are even on planes lost and the USN loses fewer (14% of sorties vs 16%). The one per-nation gap: USN battleships sunk 42-43% of those fielded vs IJN 34-36% (more torpedo and shell damage taken). Lever: USN rangeFrac 0.78 -> 0.84 (USN long-range gunnery doctrine; restores the value before an earlier change made on 100-round gates). At 0.82 (with the PT, air spacing and sub changes) seeds 1-400 gave 0.49 and the 1001-1100 gate 44 (FAIL); at 0.84: seeds 1-400 USN 204 / IJN 195 / draw 1 (0.511 [0.462, 0.560]); gates seeds 1-100 USN 49 / IJN 51, 1001-1100 USN 47 / IJN 52 / draw 1 (both PASS). A 400-round run cannot resolve a 2-point lever effect (SE 2.5%).
- Seed structure: outcomes agree on ~70% of seeds across code versions (the seed fixes fleets and map), and seeds 1-200 lean IJN, 201-400 USN, in every run. So a fixed 100-seed gate is pinned near its seeds' own rate (seeds 1-100: 45-46 under three code versions, though their BB/CV mix predicts 50.6): expect it to sit at its edge, and to flip under unrelated changes.

## 5. Air command structure (user asked: air boss? squadrons?)
- Squadrons per carrier (VF/VB/VT with names) and persistent pilots (aces belong to squadrons). Elements: USN 2-plane sections in 4-plane divisions, IJN 3-plane shōtai. The Thach weave uses the actual wingman.
- Air boss per carrier: launch/recovery cycle, CAP relief, no strike launch while under attack or recovering.
- CAG leads each strike, assigns squadrons to targets, times the VT anvil and VB dive together, redirects if the target is lost, and hands off on loss.
- Fighter director: USN radar vectors CAP to raids (~250 detection); IJN visual only. Balance via doctrine/stats.
- Events and plane fields for camera captions ("VT-8 begins its run").

## 6. Cinema: follow cams (after airops lands). RADIO CHATTER DEFERRED by the user: a later improvement; notes below kept for then.
- Story mode: the director picks a protagonist (division, strike squadron or named pilot) and follows the whole mission for 1–3 min, cutting between members, with brief cutaways for big moments. If the protagonist dies, hand off to the wingman. User-selectable follow (click a plane in freecam, or a key to follow the active strike).
- Radio chatter: event-driven lines (pilots, fighter director, ship crews; IJN in Japanese with English subtitles), tied to squadron and pilot callsigns. Voice: synthesized radio "garble" (speech-like syllables, radio filter, static, squelch) plus film subtitles. NO speechSynthesis toggle (user chose option 1 only). No period slurs. Chatter follows what the camera shows, plus important fleet-wide calls.

- Future-proof for pre-synthesized voices (user idea): line catalog as data (stable id, speaker role, text, fragment structure for callsigns and bearings), plus a voice-backend interface (garble now; sample playback later). Recordings would be dry; the radio filter is applied live in WebAudio. Fall back to garble when files are missing or under file://. Later: an offline tools/ script generates clips per line × voice from the same catalog (model must do Japanese; license must allow distribution; no real-person cloning).

## 7. Endgame and doctrine (user asked: more of the winner hunting down the last ships)
- Damage slows ships (`ship_speed.js`): full speed above 70% hp easing to 50% at 15%; torpedo flooding −8% per hit (cap −30%); engine-room hits (12% of heavy hits) halve speed, temporarily or for good. Cripples list harder and leave a smaller wake.
- A side breaks when its fit (hp ≥ 35%) BB / CA / DD tonnage is below 15% of its starting tonnage (`fleet_cmd BREAK`; the design said ~25%, see the numbers below; 15% confirmed by the user, Oct 2026), and runs for its home edge; its ships that reach the edge leave the map (escaped). The winner's commander sees the break through its own contacts and takes posture `pursue`: gun ships run down last-known contacts (fair-game carriers included), strikes cover the map and go for what the ships cannot catch, scouts search the escape route. Both broken: the side with the larger fit share pursues.
- End reasons: the side with no CV / BB / CA / DD left is out; `kill` when its last one was sunk, `retire` when its last one left the map. The time limit stretches up to 150 s for a pursuit.
- Nations (doctrine flags, no hidden handicaps): USN destroyers pick up survivors (sim tasks from the sinking position; the lifeboats row to them) and escort cripples home; IJN runs at best speed, abandons its cripples and may scuttle one about to be caught.
- Doctrine additions: damageControl (USN 1.5, IJN 1: fires out faster, flooding pumped out, minor damage patched / fires spread, flooding creeps on), avgas (USN 0.8, IJN 1: a bomb on a loaded flight deck), escortCharge (USN 1, IJN 0.6: destroyers charge an enemy closing on their carrier, making smoke). Rare magazine explosions on battleships and cruisers.
- Measured (sim-only, Oct 2026). Before: kill 0%, retire ~81%, time ~19%, median ~336 s. Break threshold vs kill share on seeds 1-100: 25% → 27%, 20% → 26%, 15% → 45-48%, 12% → 45%, 10% → 44%. With the endgame (before the doctrine additions): seeds 1-400 kill 39%, retire 53%, time 7%, median 340 s; the strict wipeout (no major ship escaped at all) is about 1%, because the losing carrier sits 0.08-0.35 W from its edge and is off the map within 15-60 s of the break (it escapes in nearly every round). Holding the carrier back (recovering its strike) made it the last ship out and dropped kills to 30%. With the doctrine additions and USN damageControl 1.5: gates seeds 1-100 USN 47 / IJN 53 (kill 35%, time 8%), 1001-1100 USN 46 / IJN 54 (kill 36%, time 7%). Final (after the rudder-bite and no-torpedoes-at-subs fixes): seeds 1-100 USN 43 / IJN 57 (FAIL; kill 36%, time 6%, median 330 s), 1001-1100 USN 48 / IJN 52 (kill 39%, time 7%, median 338 s); damageControl 1.7 did not move seeds 1-100 (43). After merging oddfleets and flyingboats (information only; balance is tuned once after all branches merge): seeds 1-100 USN 58 / IJN 42, kill 36%, time 8%, median 350 s.
- Balance: the USN rescue costs about 0.5 point (400 rounds with and without it: 0.479 / 0.479), so nothing was added for it; the doctrine additions moved about 1.5 points to the IJN (400 rounds 0.479 → 0.464), compensated by USN damageControl 1.3 → 1.5. A final 400-round pass is left to the merge.
- Carriers escaping (user chose "give pursuit a real window", Oct 2026): the carrier station band moved to 0.2-0.33 of the width from its own edge, also while withdrawing (was 0.15-0.35, and 0.08-0.1 while withdrawing); the safety slide away from known gun ships may still take it home. Pursuit is latched (it no longer drops to search when contacts expire). The broken side's ships leave within 20 of the edge. Result on the info gate (seeds 1-100, after the oddfleets / flyingboats merges): before kill 36% / retire 56% / time 8% / wipeout 0% / carriers escaped 1.21 per round / median 350 s; after kill 35% / retire 59% / time 6% / wipeout 0% / 1.21 / 358 s. No change: at the break the winner's nearest gun ship is typically 300+ from the losing carrier (a destroyer closes at 1.9 units/s against a 30-60 s run home) and the winner's carriers have no strike aircraft left (hangar 0 on the seeds probed); holding the losing carrier to recover its strike raised time endings (17-20% on 30 seeds) without moving wipeouts. Catching carriers needs the strike side (aircraft kept in reserve for the pursuit, oddfleets' reserveFrac), not the station.

## 8. Odd fleets: search, small craft, strike doctrine (user report: "3 carriers vs PT boats: the boats swarm, the planes stay home")

- Root causes found: a carrier-only side had no searchers (scout floatplanes ride only on cruisers and battleships) and the air boss strikes only known targets; strikes were also cut off at 650; PT boats are blind (their lookouts see ~40) and their commander stations crowded all leaders onto one flank (pair slots alternated flanks, so every leader got the same side), so every boat lurked round the same islands; a PT-only or sub-only side got no stations at all; floatplane scouts all took the same best sector and loitered inside the enemy's AA and plane-detection range, then flew straight home through it; the sub stall rule ended sub rounds 60 s in, before anyone could meet.
- Search is one system (air_search.js): sector claims fanned across the enemy's side, carrier search flights (unarmed SBDs, TBDs, or spare fighters) while nothing is known, shadowing from a standoff ring outside the AA umbrella and away from enemy carriers' CAP, break-away from fighters, a routed low return. Measured on 6 standard rounds: scouts lost 0 (base 26 of 54 launched), recovered 49 of 71 (base 21 of 54), gun spotting about the same (193 vs 221 spots); time to first sighting the same or earlier in every suite scenario.
- Small craft: strikes go after PT boats and surfaced subs when that is what is known (value relative to what is there); fighters strafe PT boats, surfaced subs and damaged destroyers (escorts over a small-craft target, and up to 2 CAP fighters on boats near the carrier).
- A commander that cannot find the enemy goes looking (fleet_search.js): PT lanes sweep forward and scan; with no enemy gun ship seen the PT boats may run deep (PT_DEEP) and close on a known carrier; the enemy-half search bias fades and a surface force patrols a barrier line near the midline. The carrier never charges.
- PT pairs: each pair its own spot, 75 apart, the wing 15 beside its leader; skirmishes spread the boats over the enemy's boats.
- Strike doctrine (doctrine parameters, not rolled): IJN joint first strike and deck-load follow-ups, USN group first strike and squadron-by-squadron follow-ups (less coordinated, no fuel burned circling); form-up circling costs fuel; the reserve strike (IJN 0.4, USN 0.2 of the bombers held for enemy carriers; rearmed after 110 s, 20 s on a loaded deck).
- Composition fuzz (`--only fuzz`): per seed one named odd fleet (3 CV vs 10 PT, 8 PT vs 8 PT, 4 SS vs 2 CV, 8 DD vs BB, and the coordinator's survey list) and one random lopsided one. Checks: first sighting within 120 s (240 when both sides are only PT boats and subs), first damage within 150 s of it (240 when a side is only subs; a sub hunt the stall rule ends with no damage passes), stale time-outs, PT spacing (10th percentile of the nearest same-side boat that is not the pair-mate >= 25, after the first 30 s), stuck, NaN (ships and planes), errors.
- Balance is not tuned on this branch (one 100-round gate run as information: USN 55 / IJN 45).
## 9. Admirals, flagships and command (user asked: toys manned by 1942 admirals)

- **The admirals.** Each round, each side gets a named admiral, picked with `WW.rand`:
  - USN: Spruance (calculating), Halsey (aggressive) or Fletcher (cautious);
  - IJN: Nagumo (cautious, by the book), Yamaguchi (aggressive), Kondo (gunnery) or Tanaka (destroyers, night torpedoes).
- **The personality.** It is a set of moderate changes to the side's rolled doctrine (×0.85–1.2, plus the reserve share and strike modes). A personality flavours a battle; it must not decide it. Check this with the per-matchup table that the balance gate prints.
- **The flagship.** The admiral flies his flag in a flagship. Losing it (sunk or crippled) freezes the side's commander for 30 to 60 s: no new posture, stations or strike orders. Then the flag passes to the best ship left, as Nagumo moved to Nagara at Midway. The enemy rates the flagship a little higher as a target (×1.15).
- **The orders.** The admiral's orders are `admiralOrder` events (launch, reserve, press, retire, pursue, flag lost, transfer), for the captions and the war diary.
- **What you see.** Flag hoists, a pennant and night blinker lamps show the command on the models.
- **Details.** See ARCHITECTURE.md, "Admirals".

## 10. The fight for an island (user asked: "as if we're actually fighting for Midway")

- **The map.** Fewer, larger islands: a Midway-style atoll (a reef ring with Sand Island and the airfield's flat island inside) or a big volcanic island with the airfield on its coastal plain, plus one more island and a few islets and reefs. The reef ring is too shallow for any ship, so the atoll is one convex obstacle.
- **The base** (`island_base.js`) is an unsinkable "carrier" with coastal batteries and AA pits. It belongs to one side (the ready screen's Base button, else a `WW.rand` roll: USN 40%, IJN 40%, none 20%). It is never in `WW.world.ships`; the enemy always knows it (an island is on the chart), and its owner uses it as a radar station. As a contact with guns and AA it is in the enemy's danger field like a ship, so ships and strikes route round its guns.
- **The objective** (`base_ai.js`, `B.objective`): the side without the base wants it neutralized (every runway closed, every battery silenced, at least half the AA out); the owner defends it (an enemy ship near the base is worth more to own ships near it).
  - Bombardment comes from the ships' own target score (battleships and cruisers only; each ship aims at one facility, batteries first); the batteries are in the danger field, so a battleship stands off outside them and a cruiser accepts the risk its doctrine allows.
  - Carrier strikes: the base is a strike target worth less than an enemy carrier or battleship. **The dilemma**: in the first runs the attacker sent its first strike at the island (Nagumo's first wave) and lost the carrier battle (an IJN base: the USN won 3%). The doctrine now: no strike on the island in the first 150 s (search for the fleet first) unless it is within 350 of the carrier, and while an enemy carrier or gun ship has been seen in the last 60 s the island's bombardment weight and strike value are × 0.3: the fleet first, the island when the sea is clear. The reserve doctrine (`air_ops.js`) still holds back its share for carriers.
- **The base air group** (`land_air.js`): Midway-style for the USN (Wildcat-type fighters, SBDs, B-26 torpedo bombers, B-17s), Zeros and Bettys for the IJN. It flies CAP over the island and strikes the best known enemy ship within 560 every 55 to 75 s. The B-17s bomb from high level and rarely hit a ship (as at Midway). Planes take off and land on the runways (one at a time, into the wind) and cannot while the runways are cratered.
- **The end**: neutralizing the base does not end the round by itself (the naval fight decides kill / retire); an intact base adds 26000 tons to its owner at the time limit.
- **Balance by base owner** (the first base-strength pass, `--tune` knobs in `WW.islandBase.TUNE`, 40-round runs, seeds 1-40): with no base the merged game gave the USN 35%; at full strength a USN base made it 72% and an IJN base 3% (about ± 35 points). Every component contributed (coastal guns about 12 points, the air group 7, radar 4, the island on the chart 2, the attacker's misplaced first strike most of the rest; the tonnage bonus nothing measurable). The defaults now: batteries at half rate (`guns` 0.5), 0.6 × the roster, 0.8 × the radar, defence weight 1.2, the attacker's island weight × 0.4, plus the fleet-first doctrine above. The 100-round gate (seeds 1-100) after the pass and the final merges (node runner): USN 39 / IJN 61 overall (the merged baseline is IJN-heavy: no base 6 / 12 of 18); a USN base 22 / 9 of 31 (USN 71%), an IJN base 11 / 40 of 51 (USN 22%): the owner still gains about 10 to 35 points, more with a USN base. The base is no longer a carrier-defence enemy (`fleet_cmd.js defend`: an island cannot close on a carrier). The defence weight now multiplies the commander's assignment instead of replacing it (it had switched off the saturation and focus factors near the base). The final balance pass can tune it with `--tune` (see ARCHITECTURE.md, island base "Tuning knobs").

## 11. Dusk, night and weather (daylight.js, night_ops.js, weather.js)
- Time of day: `WW.daylight` (1 day .. 0 night) comes from the round's clock, rolled on roundStart with `WW.rand`: about 81% day (11:00 to 13:00, light all round, even through a 570 s pursuit), 12% dusk (dusk starts 90 to 200 s in, dark 150 s later), 7% night. In the balance gate about 15 to 20% of rounds end in the dark. It is sim state, the same in sim-only mode.
- Sight (intel.js hooks, no dice): the visual range of a hull is the day range × (nightEye + (1 − nightEye) × light). `doctrine.nightEye` is USN 0.3, IJN 0.5: IJN night optics and trained lookouts. The light is darker under rain. Rain on the line of sight cuts the visual range by up to 70%. A gun flash reaches 30% farther in full dark than by day. A ship with its searchlight on shows like a big-gun flash. A target under a star shell or in a searchlight beam is seen as in daylight, by both sides. Planes see ships at 0.3 to 1 × their range by the light, less under cloud.
- USN SG radar (`doctrine.radar` > 0.5, USN only): BB, CA and DD find surface ships at 170 × target size (CA 0.9, DD 0.7, sub 0.4, PT 0.3), through dark and rain, quality `'radar'`. It is imperfect: one sweep every other intel tick, islands block it, and a target in shallow water near land is lost in the clutter. By day the eyes outrange it, so it matters at night and in squalls.
- Star shells: in the dark (daylight < 0.4) a cruiser or destroyer (and a USN battleship) fires one over a known enemy 15 to 160 away that is not already lit. Cooldown 48 − 22 × `doctrine.night` s, at most 3 per side at a time. It bursts behind the target after 2.5 s, hangs 24 s, falls and drifts with the wind, and lights a radius of ~95. Firing it is a gun flash.
- Searchlights (daylight < 0.3): a share `doctrine.searchlight` of a side's BB / CA / DD (USN 0.15, IJN 0.8) lights its gun target inside 120 for 14 s (cooldown 30 s). The beam reveals the target and its own ship.
- Night doctrine (`doctrine.night`, USN 0.2, IJN 0.8): in the dark, the preferred gun range × (1 − 0.3 × night × darkness) (the IJN closes in), the torpedo launch distance × (1 + 0.3 × night × darkness) (capped at 0.97 of torpedo range: the long-lance night attacks of Savo Island and Tassafaronga), and the press threshold × (1 − 0.25 × night × darkness).
- Carriers: no launches below daylight 0.45 (`WW.air.launch` returns null; scouts too). Below 0.5, airborne planes are recalled (bombers in an attack finish it). A landing below 0.5 daylight has up to a 14% chance (full dark) of going over the side (air_deck.js trap). In the dark a carrier flees known gun ships from 1.5 × farther.
- Submarines attack on the surface at night (daylight < 0.3): a target close no longer keeps them down.
- Weather: 22% of rounds have scattered squalls and 13% a squall line, rolled on roundStart, drifting with `WW.wind` (wind × 1.6 u/s) so a front crosses the map in a round. A hunted carrier (a known gun ship near) makes for the nearest squall within 220, and a withdrawing cripple for one within 160. Dive bombers wait up to 18 s for a gap in low cloud over the target (cover > 0.4), then take their bombs home. Strikes route round the worst of the rain (air_cag.js detour).
- Tests: the `night`, `dusk` and `weather` scenarios of `tests/sim_behaviour.js` report the detection ranges by daylight (det_day / det_dusk / det_night / det_radar / det_flash, the distance at which a ship first acquires an enemy), the night torpedo spreads per nation, star shells, searchlights, radar sightings, night landings and losses, dive holds and aborts, and the carrier time spent sheltering in rain; `dark_launch` (carrier and scout launches after dusk) must be 0. `node tests/night_shots.js` takes the screenshots.

## 12. Historical doctrine items (formations, torpedoes, submarines, supply)
Every nation difference below is a doctrine parameter (fleet_groups.js BASE) or a per-nation stat table (core.js WW.TORPEDO_NATION), so the balance pass can tune it. Details: ARCHITECTURE.md (Formation doctrine, Submarine doctrine, Ammunition and fuel).
- Formations: USN AA ring (escorts 25-45 around each carrier on the threat axis, turning with it); IJN surface vanguard well ahead of the carriers (Santa Cruz); both zigzag under sub threat on a shared plan.
- Torpedoes: IJN Type 93 / 95 longer, faster, nearly wakeless (tracks seen at ~27 instead of 45, so combing comes late); USN Mk 13 / 14 / 15 slower, shorter, visible wakes, 12-28% duds.
- Submarines: IJN carriers first, shadowing, patrol line; USN nearest target, lifeguard pickups.
- Supply: finite main / AA ammunition, torpedo reload sets (IJN DD / CA one, USN none), destroyer fuel.
- Measured effect on the 100-round gate (seed0 1, Oct 2026, each item switched off alone): the torpedo table is by far the largest; ring, vanguard, zigzag and sub roles are each within noise; supply favours the USN (it caps the IJN reloads). See tests/doctrine.js for the per-nation metrics.

- Measured on the merged tree (endgame + oddfleets + flyingboats), seeds 1-100 (USN wins; 1001-1100 in brackets), Oct 2026, each item switched off alone: everything on 39 (37), everything off 58; torpedo table off 49-57 (51); supply off 24 (the IJN DD / CA reloads become unlimited: supply is worth ~+15 to the USN while the Long Lance is in); formation (ring + vanguard + zigzag) off 40; sub roles off 34. Inside the torpedo table: the Long Lance entries ~0-2 points; the USN entries together ~10 (duds ~6, the visible wake ~4; range / speed alone within noise). Fix: USN duds to 10% (DD / PT) and 20% (Mk 14 subs), none on the aerial Mk 13, wake x1.1; plus a range-dependent torpedo aim error for both navies. A 100-round gate moves ±5 between equivalent code versions (chaos), so single items under ~5 points need 200+ rounds to see. See tests/doctrine.js for the per-nation metrics.
